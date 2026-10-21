// The PDF report (as HTML for Gotenberg to print) and the reply email that carries it.
const { REPLY_MARKER } = require('./inquiry.cjs');
const { BRAND } = require('./brand.cjs');

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

/** How many rows the report lists: a count the request asked for ("5 painters"), else everything up to maxRows. */
const listedCount = (rows, query, maxRows = 300) => Math.min(rows.length, maxRows, query.limit || Infinity);

/** File name for the PDF, e.g. "LI report 2026-10-20 plumbing insurance.pdf". */
function reportFileName(query, today) {
  const what = [query.trades.join(' ') || 'all trades', query.report].join(' ').replace(/[^a-z0-9 -]/gi, '').trim();
  return `LI report ${today} ${what}.pdf`.replace(/\s+/g, ' ');
}

function renderReportHtml({ title, query, window, rows, notes = [], stats = {}, generatedAt, maxRows = 300 }) {
  const shown = rows.slice(0, listedCount(rows, query, maxRows));
  const insurance = query.report === 'insurance';
  const head = insurance
    ? ['Coverage ends', 'Business', 'License / UBI', 'License type', 'Phone', 'Address', 'Insurer and policy']
    : ['Registration expires', 'Business', 'License / UBI', 'License type', 'Phone', 'Address'];
  const body = shown.map((r) => {
    const cells = [
      `<strong>${esc(fmtDate(r.ends))}</strong>${r.cancelled ? '<br><span class="flag">Cancellation</span>' : ''}${r.verified === 'failed' || r.verified === 'unchecked' ? '<br><span class="flag">Not checked on Verify</span>' : ''}`,
      esc(r.name),
      `<a href="${esc(r.verify)}">${esc(r.license)}</a><br><span class="muted">${esc(r.ubi)}</span>`,
      esc(r.specialties),
      `<span class="nowrap">${esc(r.phone)}</span>`,
      esc(r.address),
    ];
    if (insurance) cells.push(`${esc(r.insurer)}${r.policy ? `<br><span class="muted">${esc(r.policy)}</span>` : ''}${r.agency ? `<br><span class="muted">Agent: ${esc(r.agency)}</span>` : ''}${r.amount ? `<br><span class="muted">${money(r.amount)}</span>` : ''}${r.alsoOnFile ? `<br><span class="muted">Also on file: ${esc(r.alsoOnFile.insurer || r.alsoOnFile.policy)} to ${esc(fmtDate(r.alsoOnFile.ends))}</span>` : ''}`);
    return `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  }).join('\n');
  const allNotes = [...notes];
  if (query.limit && rows.length > shown.length) allNotes.push(`As asked, this lists the ${shown.length} whose coverage or registration ends soonest, of ${rows.length} matches.`);
  else if (rows.length > shown.length) allNotes.push(`Showing the first ${shown.length} of ${rows.length} matches. Narrow the request (a city or a shorter window) for the rest.`);
  if (stats.truncated) allNotes.push('L&I returned the maximum number of rows for one query, so some matches may be missing. Narrow the request.');
  if (stats.endedCount) allNotes.push(`${stats.endedCount} contractor${stats.endedCount === 1 ? '' : 's'} whose policy would have expired in this window ${stats.endedCount === 1 ? 'was' : 'were'} left out because it was already cancelled earlier.`);
  if (stats.renewedCount) allNotes.push(`${stats.renewedCount} contractor${stats.renewedCount === 1 ? '' : 's'} with a policy ending in this window ${stats.renewedCount === 1 ? 'was' : 'were'} left out because another policy on file runs past it (renewed, or other coverage).`);
  if (stats.verifiedAt) allNotes.push(`Each listed contractor was checked on L&I's Verify site on ${stats.verifiedAt}.`);
  if (stats.renewedOnVerify) allNotes.push(`${stats.renewedOnVerify} more ${stats.renewedOnVerify === 1 ? 'was' : 'were'} left out because L&I's Verify site shows a policy running past this window (often a renewal that starts later, which the open data doesn't list yet).`);
  const unchecked = shown.filter((r) => r.verified === 'failed' || r.verified === 'unchecked').length;
  if (unchecked) allNotes.push(`${unchecked} listed contractor${unchecked === 1 ? '' : 's'} couldn't be checked on Verify and ${unchecked === 1 ? 'is' : 'are'} marked; check ${unchecked === 1 ? 'it' : 'them'} by hand before relying on ${unchecked === 1 ? 'it' : 'them'}.`);
  if (query.daysCapped) allNotes.push(`The window was capped at ${query.days} days.`);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: 11in 8.5in; margin: 0.45in 0.5in 0.5in; }
  body { font-family: Helvetica, Arial, sans-serif; color: ${BRAND.ink}; font-size: 9.5pt; margin: 0; }
  .masthead { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 0 0 10px; border-bottom: 3px solid ${BRAND.gold}; margin: 0 0 16px; }
  .masthead img { height: 58px; width: auto; }
  .nowrap { white-space: nowrap; }
  .masthead .contact { text-align: right; color: ${BRAND.muted}; font-size: 8.5pt; line-height: 1.5; }
  .masthead .contact b { color: ${BRAND.teal}; font-size: 10pt; letter-spacing: .04em; text-transform: uppercase; }
  h1 { font-size: 17pt; margin: 0 0 4px; color: ${BRAND.teal}; }
  .sub { color: ${BRAND.muted}; margin: 0 0 14px; }
  .summary { display: inline-block; background: ${BRAND.paleTeal}; border-left: 4px solid ${BRAND.teal}; padding: 8px 16px 8px 12px; margin: 0 0 16px; color: ${BRAND.muted}; }
  .summary b { display: block; font-size: 18pt; color: ${BRAND.teal}; line-height: 1.1; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: .04em; color: #fff; background: ${BRAND.teal}; padding: 6px; }
  td { vertical-align: top; border-bottom: 1px solid ${BRAND.rule}; padding: 5px 6px; }
  tbody tr:nth-child(even) td { background: ${BRAND.tint}; }
  tr { page-break-inside: avoid; }
  a { color: ${BRAND.teal}; text-decoration: underline; text-decoration-color: ${BRAND.gold}; }
  .muted { color: ${BRAND.muted}; font-size: 8.5pt; }
  .flag { color: #b3261e; font-size: 8pt; font-weight: bold; }
  .notes { margin: 14px 0 0; color: ${BRAND.ink}; }
  .notes li { margin: 2px 0; }
  .source { margin-top: 16px; padding-top: 8px; border-top: 1px solid ${BRAND.rule}; color: ${BRAND.muted}; font-size: 8pt; }
</style></head><body>
<div class="masthead"><img src="${BRAND.logo}" alt="${esc(BRAND.name)}"><div class="contact"><b>Contractor report</b><br>${esc(BRAND.site)} · ${esc(BRAND.email)}</div></div>
<h1>${esc(title)}</h1>
<p class="sub">${esc(fmtDate(window.from))} to ${esc(fmtDate(window.to))} · Prepared ${esc(generatedAt)} by ${esc(BRAND.name)}</p>
<div class="summary"><div><b>${shown.length < rows.length && query.limit ? `${shown.length} of ${rows.length}` : rows.length}</b>matching contractor${rows.length === 1 ? '' : 's'}${shown.length < rows.length && query.limit ? ', soonest first' : ''}</div></div>
${rows.length ? `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>
${body}
</tbody></table>` : '<p>No active contractors matched this request.</p>'}
${allNotes.length ? `<ul class="notes">${allNotes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
<p class="source">Source: Washington State Department of Labor &amp; Industries contractor open data on data.wa.gov (General and Insurance datasets), refreshed each business day. Only active registrations are listed, and each listed contractor is checked on L&amp;I's Verify site, which also shows policies that haven't started yet. When a contractor has several policies on file, only the newest (latest effective date) is shown; an older policy that runs later is noted as also on file. Each license number links to the L&amp;I Verify page; check it before relying on a record.</p>
</body></html>
`;
}

/**
 * What the report holds, said once, e.g. "the 5 painting contractors whose insurance … in the next 14 days" or
 * "16 painting contractors whose …". The title already carries a requested count, so the count isn't repeated.
 */
function reportSummary({ title, count }) {
  const lower = title.charAt(0).toLowerCase() + title.slice(1);
  const asked = lower.match(/^the (\d+) /);
  if (!count) return null;
  if (asked) return Number(asked[1]) > count ? lower.replace(/^the \d+ /, `the ${count} `) : lower;
  return `${count} ${count === 1 ? lower.replace(/\bcontractors\b/, 'contractor') : lower}`;
}

/** Ask the local model for a couple of friendly sentences. The facts come from us; the model only words them. */
function replyRequest({ senderName, title, count, model }) {
  const summary = reportSummary({ title, count });
  const facts = summary ? `It lists ${summary}.` : `No contractors matched: ${title}.`;
  const prompt = `Write the body of a short, friendly reply email from Josh to ${senderName || 'a colleague'}, who asked for a report.
Say the report they asked for is attached. ${facts}
Say each fact once. One or two sentences. No greeting line, no sign-off, no subject, no placeholders, no dashes.
Return JSON with the email body in "note".`;
  return {
    model: model || 'qwen3:4b',
    messages: [{ role: 'user', content: prompt }],
    // qwen3 reasons out loud in plain text despite think:false; a JSON answer (as Understand request uses) stops that.
    format: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] },
    think: false,
    stream: false,
    options: { temperature: 0.6, num_predict: 400 },
  };
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0].replace(/[^A-Za-z'-]/g, '');

function htmlBody(greeting, paragraphs, signature) {
  const p = (t) => `<p>${esc(t).replace(/\n/g, '<br>')}</p>`;
  // The marker reads as part of the note, before the sign-off; Workspace appends the signature after it.
  return [p(greeting), ...paragraphs.map(p), p(REPLY_MARKER), ...(String(signature || '').trim() ? [p(signature)] : [])].join('\n');
}

/** Check the model's text and fall back to a plain template if it's missing, too long or has placeholders. */
function replyText(ollama, { title, count }) {
  const summary = reportSummary({ title, count });
  const fallback = summary
    ? `Attached is the report you asked for: ${summary}. Let me know if you'd like it narrowed down or run again.`
    : `I didn't find any ${title.charAt(0).toLowerCase()}${title.slice(1)}. The attached report has the details; let me know if you'd like a wider search.`;
  let t = '';
  try { t = String(ollama.message.content || ''); } catch { return fallback; }
  try { t = String(JSON.parse(t).note || ''); } catch { /* older answers were plain text */ }
  // Its reasoning can arrive with only the closing </think> tag, so drop everything up to the last one.
  if (t.includes('</think>')) t = t.slice(t.lastIndexOf('</think>') + '</think>'.length);
  else if (/<think>/.test(t)) return fallback;
  // The email adds its own "Hi Josh,", so drop a greeting the model starts with, on its own line or not.
  t = t.replace(/^\s*(hi|hello|hey|dear)\b[^,.!\n]*([,.!]\s*|\n)/i, '').replace(/\n*(best|thanks|cheers|regards)[\s\S]*$/i, '')
    .replace(/\s*[—–]\s*/g, ', ').replace(/^["']|["']$/g, '').trim();
  if (!t || t.length > 500 || /[[\]{}]/.test(t) || !/attach/i.test(t)) return fallback;
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
    body_html: htmlBody(greeting, [`I want to make sure I pull the right report. ${ask}`, 'I can report on contractors whose insurance on file with L&I or contractor registration expires within a number of days, by trade and city.'], signature),
  };
}

module.exports = { esc, fmtDate, listedCount, reportFileName, renderReportHtml, reportSummary, replyRequest, replyText, buildReply, buildClarification };
