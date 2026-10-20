// The PDF report (as HTML for Gotenberg to print) and the reply email that carries it.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

const money = (s) => {
  const n = Number(String(s).replace(/[^0-9.]/g, ''));
  return s && Number.isFinite(n) && n > 0 ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : esc(s);
};

/** File name for the PDF, e.g. "LI report 2026-10-20 plumbing insurance.pdf". */
function reportFileName(query, today) {
  const what = [query.trades.join(' ') || 'all trades', query.report].join(' ').replace(/[^a-z0-9 -]/gi, '').trim();
  return `LI report ${today} ${what}.pdf`.replace(/\s+/g, ' ');
}

function renderReportHtml({ title, query, window, rows, notes = [], stats = {}, generatedAt, maxRows = 300 }) {
  const shown = rows.slice(0, maxRows);
  const insurance = query.report === 'insurance';
  const head = insurance
    ? ['Coverage ends', 'Business', 'License / UBI', 'License type', 'Phone', 'Address', 'Insurer and policy']
    : ['Registration expires', 'Business', 'License / UBI', 'License type', 'Phone', 'Address'];
  const body = shown.map((r) => {
    const cells = [
      `<strong>${esc(fmtDate(r.ends))}</strong>${r.cancelled ? '<br><span class="flag">Cancellation</span>' : ''}`,
      esc(r.name),
      `<a href="${esc(r.verify)}">${esc(r.license)}</a><br><span class="muted">${esc(r.ubi)}</span>`,
      esc(r.specialties),
      esc(r.phone),
      esc(r.address),
    ];
    if (insurance) cells.push(`${esc(r.insurer)}${r.policy ? `<br><span class="muted">${esc(r.policy)}</span>` : ''}${r.agency ? `<br><span class="muted">Agent: ${esc(r.agency)}</span>` : ''}${r.amount ? `<br><span class="muted">${money(r.amount)}</span>` : ''}`);
    return `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  }).join('\n');
  const allNotes = [...notes];
  if (rows.length > shown.length) allNotes.push(`Showing the first ${shown.length} of ${rows.length} matches. Narrow the request (a city or a shorter window) for the rest.`);
  if (stats.truncated) allNotes.push('L&I returned the maximum number of rows for one query, so some matches may be missing. Narrow the request.');
  if (stats.renewedCount) allNotes.push(`${stats.renewedCount} contractor${stats.renewedCount === 1 ? '' : 's'} with a policy ending in this window ${stats.renewedCount === 1 ? 'was' : 'were'} left out because a newer policy is already on file.`);
  if (query.daysCapped) allNotes.push(`The window was capped at ${query.days} days.`);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: 11in 8.5in; margin: 0.5in; }
  body { font-family: Helvetica, Arial, sans-serif; color: #1a1a1a; font-size: 9.5pt; }
  h1 { font-size: 16pt; margin: 0 0 4px; }
  .sub { color: #555; margin: 0 0 14px; }
  .summary { display: flex; gap: 28px; margin: 0 0 14px; }
  .summary b { display: block; font-size: 15pt; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .03em; color: #555; border-bottom: 1.5px solid #1a1a1a; padding: 5px 6px; }
  td { vertical-align: top; border-bottom: 1px solid #ddd; padding: 5px 6px; }
  tr { page-break-inside: avoid; }
  a { color: #0b57d0; text-decoration: none; }
  .muted { color: #666; font-size: 8.5pt; }
  .flag { color: #b3261e; font-size: 8pt; font-weight: bold; }
  .notes { margin: 14px 0 0; color: #333; }
  .notes li { margin: 2px 0; }
  .source { margin-top: 16px; color: #666; font-size: 8pt; }
</style></head><body>
<h1>${esc(title)}</h1>
<p class="sub">${esc(fmtDate(window.from))} to ${esc(fmtDate(window.to))} · Prepared ${esc(generatedAt)} by Raeltek</p>
<div class="summary"><div><b>${rows.length}</b>matching contractor${rows.length === 1 ? '' : 's'}</div></div>
${rows.length ? `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>
${body}
</tbody></table>` : '<p>No active contractors matched this request.</p>'}
${allNotes.length ? `<ul class="notes">${allNotes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
<p class="source">Source: Washington State Department of Labor &amp; Industries contractor open data on data.wa.gov (General and Insurance datasets), refreshed each business day. Only active registrations are listed. Each license number links to the L&amp;I Verify page; check it before relying on a record.</p>
</body></html>
`;
}

/** Ask the local model for two or three friendly sentences. The facts (count, title) are added by us, not the model. */
function replyRequest({ senderName, title, count, model }) {
  const prompt = `Write the body of a short, friendly reply email from Josh to ${senderName || 'a colleague'}, who asked for a report.
Say the report they asked for is attached. Mention in plain words that it covers: ${title}. It lists ${count} contractor${count === 1 ? '' : 's'}.
Two or three sentences. No greeting line, no sign-off, no subject, no placeholders, no dashes. Plain text only.`;
  return {
    model: model || 'qwen3:4b',
    messages: [{ role: 'user', content: prompt }],
    think: false,
    stream: false,
    options: { temperature: 0.6 },
  };
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0].replace(/[^A-Za-z'-]/g, '');

function htmlBody(greeting, paragraphs, signature) {
  const p = (t) => `<p>${esc(t).replace(/\n/g, '<br>')}</p>`;
  return [p(greeting), ...paragraphs.map(p), p(signature)].join('\n');
}

/** Check the model's text and fall back to a plain template if it's missing, too long or has placeholders. */
function replyText(ollama, { title, count }) {
  const fallback = `Here's the report you requested, attached as a PDF. It covers ${title.charAt(0).toLowerCase()}${title.slice(1)}, and lists ${count} contractor${count === 1 ? '' : 's'}. Let me know if you'd like it narrowed down or run again.`;
  let t = '';
  try { t = String(ollama.message.content || ''); } catch { return fallback; }
  t = t.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^\s*(hi|hello|hey)\b[^\n]*\n/i, '').replace(/\n*(best|thanks|cheers|regards)[\s\S]*$/i, '').trim();
  if (!t || t.length > 600 || /[[\]{}]|—|–/.test(t) || !/attach/i.test(t)) return fallback;
  return t;
}

const reSubject = (s) => (/^re:/i.test(s) ? s : `Re: ${s}`);

function buildReply({ inquiry, title, count, ollama, signature }) {
  const greeting = firstName(inquiry.sender.name) ? `Hi ${firstName(inquiry.sender.name)},` : 'Hi,';
  return {
    to: inquiry.sender.address,
    subject: reSubject(inquiry.subject),
    body_html: htmlBody(greeting, [replyText(ollama, { title, count })], signature),
  };
}

function buildClarification({ inquiry, question, signature }) {
  const greeting = firstName(inquiry.sender.name) ? `Hi ${firstName(inquiry.sender.name)},` : 'Hi,';
  const ask = question || 'Could you tell me which trade you need, and whether it is insurance or contractor registration you want to check, and over how many days?';
  return {
    to: inquiry.sender.address,
    subject: reSubject(inquiry.subject),
    body_html: htmlBody(greeting, [`I want to make sure I pull the right report. ${ask}`, 'I can report on contractors whose liability insurance or contractor registration expires within a number of days, by trade and city.'], signature),
  };
}

module.exports = { esc, fmtDate, reportFileName, renderReportHtml, replyRequest, replyText, buildReply, buildClarification };
