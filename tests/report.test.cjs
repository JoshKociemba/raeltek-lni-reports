const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderReportHtml, listedCount, replyText, buildReply, buildClarification, reportFileName, fmtDate } = require('../src/report.cjs');

const query = { report: 'insurance', days: 14, trades: ['plumbing'], filters: [], cities: [], counties: [] };
const window = { from: '2026-10-20', to: '2026-11-03' };
const row = { license: 'AAA', name: 'A & B <Plumbing>', ubi: '603568919', phone: '3605550100', address: '1 Main St, VANCOUVER, WA 98682', specialties: 'PLUMBING', ends: '2026-10-25', insurer: 'Acme', policy: 'P1', amount: '1000000', verify: 'https://secure.lni.wa.gov/verify/Detail.aspx?UBI=603568919&LIC=AAA&SAW=' };
const inquiry = { sender: { address: 'pat@example.com', name: 'Pat Smith' }, subject: '[L&I Report] plumbers', threadId: 't1' };

test('the report lists rows, escapes text and links to Verify', () => {
  const html = renderReportHtml({ title: 'Plumbing', query, window, rows: [row], generatedAt: 'Oct 20, 2026', stats: { renewedCount: 2 } });
  assert.match(html, /A &amp; B &lt;Plumbing&gt;/);
  assert.match(html, /href="https:\/\/secure\.lni\.wa\.gov\/verify\/Detail\.aspx\?UBI=603568919&amp;LIC=AAA&amp;SAW="/);
  assert.match(html, /\$1,000,000/);
  assert.match(html, /Oct 25, 2026/);
  assert.match(html, /2 contractors with a policy ending in this window were left out/);
  assert.match(html, /data\.wa\.gov/);
  assert.match(html, /<img src="data:image\/png;base64,[A-Za-z0-9+/=]{1000,}" alt="Raeltek">/);
  assert.match(html, /#073F43/);
});

test('an empty report says so and long reports are cut with a note', () => {
  assert.match(renderReportHtml({ title: 't', query, window, rows: [], generatedAt: '' }), /No active contractors matched/);
  const many = renderReportHtml({ title: 't', query, window, rows: Array(5).fill(row), generatedAt: '', maxRows: 2 });
  assert.equal((many.match(/<tr><td>/g) || []).length, 2);
  assert.match(many, /first 2 of 5/);
});

test('reply text uses the model when it behaves, and a template otherwise', () => {
  const ok = { message: { content: "Here's the report you asked for, attached. It covers plumbers with insurance ending soon." } };
  assert.equal(replyText(ok, { title: 'X', count: 3 }), ok.message.content);
  assert.match(replyText({ message: { content: 'See [REPORT] — thanks' } }, { title: 'Plumbing things', count: 3 }), /^Here's the report you requested/);
  assert.match(replyText({ error: 'down' }, { title: 'Plumbing things', count: 1 }), /lists 1 contractor\./);
});

test('the reply goes back to the sender in the same thread subject', () => {
  const d = buildReply({ inquiry, title: 'Plumbing', count: 1, ollama: null, signature: 'Thanks,' });
  assert.equal(d.to, 'pat@example.com');
  assert.equal(d.subject, 'Re: [L&I Report] plumbers');
  assert.match(d.body_html, /^<p>Hi Pat,<\/p>/);
  assert.match(d.body_html, /<p>Thanks,<\/p>/);
  assert.ok(!/Raeltek<\/p>/.test(d.body_html), 'no signature; Workspace adds it');
  assert.match(d.body_html, /Report prepared from Washington L&amp;I open data\./);
  const c = buildClarification({ inquiry, question: 'Which trade?', signature: '' });
  assert.ok(!/<p><\/p>/.test(c.body_html));
  assert.match(c.body_html, /Which trade\?/);
});

test('file names and dates are readable', () => {
  assert.equal(reportFileName(query, '2026-10-20'), 'LI report 2026-10-20 plumbing insurance.pdf');
  assert.equal(fmtDate('2026-11-03'), 'Nov 3, 2026');
});

test('a requested count lists only the soonest rows and says so', () => {
  const rows = ['2026-10-30', '2026-10-21', '2026-10-25'].map((ends, i) => ({ ...row, license: `L${i}`, ends }))
    .sort((a, b) => a.ends.localeCompare(b.ends));
  const html = renderReportHtml({ title: 't', query: { ...query, limit: 2 }, window, rows, generatedAt: '' });
  assert.equal((html.match(/<tr><td>/g) || []).length, 2);
  assert.match(html, /<b>2 of 3<\/b>matching contractors, soonest first/);
  assert.match(html, /As asked, this lists the 2 whose coverage or registration ends soonest, of 3 matches/);
  assert.doesNotMatch(html, /Oct 30, 2026/);
  assert.equal(listedCount(rows, { limit: 2 }), 2);
  assert.equal(listedCount(rows, { limit: null }), 3);
});
