#!/usr/bin/env node
// Run the data half of the workflow against live data.wa.gov, without n8n, Ollama or Gmail, and write the
// report HTML. Useful after changing src/lni.cjs.
// Usage: npm run try -- --trade plumbing --days 14 [--report insurance|license] [--city Vancouver] [--limit 10] [--no-verify] [--out report.html]
// The Verify check posts to secure.lni.wa.gov one contractor at a time, 750 ms apart, as the workflow does.
const fs = require('node:fs');
const { tradeFilters, describeQuery } = require('../src/understand.cjs');
const { planQuery, parseRows, planLookups, buildRows } = require('../src/lni.cjs');
const { renderReportHtml } = require('../src/report.cjs');
const { VERIFY_URL, verifyBody, verifyCount, applyVerification } = require('../src/verify.cjs');

const args = process.argv.slice(2);
const opt = (name, def) => { const k = args.indexOf(`--${name}`); return k >= 0 ? args[k + 1] : def; };
const all = (name) => args.flatMap((a, k) => (a === `--${name}` ? [args[k + 1]] : []));

async function get(url) {
  const res = await fetch(url);
  return parseRows(await res.text(), url.slice(0, 80));
}

async function main() {
  const trades = all('trade').map(tradeFilters).filter(Boolean);
  const query = {
    report: opt('report', 'insurance'), days: Number(opt('days', 14)), trades: trades.map((t) => t.trade),
    filters: trades.flatMap((t) => t.filters), cities: all('city').map((c) => c.toUpperCase()), counties: [], daysCapped: false, limit: Number(opt('limit', 0)) || null,
  };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const plan = planQuery({ query, today });
  console.log(describeQuery(query));
  const firstRows = await get(plan.urls.first);
  console.log(`First query: ${firstRows.length} rows`);
  const lookups = [];
  for (const l of planLookups({ query, start: plan.start, firstRows })) {
    lookups.push({ kind: l.kind, rows: await get(l.url) });
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`Lookups: ${lookups.map((l) => `${l.kind} ${l.rows.length}`).join(', ') || 'none'}`);
  const built = buildRows({ query, window: plan.window, start: plan.start, firstRows, lookups });
  const { renewedCount, endedCount, truncated } = built;
  console.log(`Open-data rows: ${built.rows.length}, left out as renewed: ${renewedCount}, already cancelled: ${endedCount}${truncated ? ', TRUNCATED' : ''}`);
  let rows = built.rows;
  let verify = {};
  const n = args.includes('--no-verify') ? 0 : verifyCount(rows, query);
  if (n) {
    const checks = [];
    for (const r of rows.slice(0, n)) {
      try {
        const res = await fetch(VERIFY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(verifyBody(r)) });
        checks.push(res.ok ? { body: await res.text() } : { error: `HTTP ${res.status}` });
      } catch (err) { checks.push({ error: err.message }); }
      await new Promise((ok) => setTimeout(ok, 750));
    }
    const v = applyVerification({ rows, checks, window: plan.window });
    rows = v.rows;
    verify = { verifiedAt: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }), renewedOnVerify: v.renewedOnVerify, verifyFailed: v.verifyFailed, notChecked: v.notChecked };
    console.log(`Checked ${n} on Verify: ${v.renewedOnVerify} left out (policy past the window), ${v.verifyFailed} failed`);
  }
  for (const r of rows.slice(0, 10)) console.log(`  ${r.ends}  ${r.name}  ${r.license}  ${r.city}  ${r.insurer || ''}  ${r.verified || ''}`);
  const out = opt('out', 'report.html'); // gitignored
  fs.writeFileSync(out, renderReportHtml({
    title: describeQuery(query), query, window: plan.window, rows, notes: plan.notes,
    stats: { renewedCount, endedCount, truncated, ...verify }, generatedAt: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
  }));
  console.log(`Wrote ${out}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
