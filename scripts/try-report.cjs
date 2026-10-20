#!/usr/bin/env node
// Run the data half of the workflow against live data.wa.gov, without n8n, Ollama or Gmail, and write the
// report HTML. Useful after changing src/lni.cjs.
// Usage: npm run try -- --trade plumbing --days 14 [--report insurance|license] [--city Vancouver] [--out report.html]
const fs = require('node:fs');
const { tradeFilters, describeQuery } = require('../src/understand.cjs');
const { planQuery, parseRows, planLookups, buildRows } = require('../src/lni.cjs');
const { renderReportHtml } = require('../src/report.cjs');

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
    filters: trades.flatMap((t) => t.filters), cities: all('city').map((c) => c.toUpperCase()), counties: [], daysCapped: false,
  };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const plan = planQuery({ query, today });
  console.log(describeQuery(query));
  const firstRows = await get(plan.urls.first);
  console.log(`First query: ${firstRows.length} rows`);
  const lookups = [];
  for (const l of planLookups({ query, window: plan.window, firstRows })) {
    lookups.push({ kind: l.kind, rows: await get(l.url) });
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`Lookups: ${lookups.map((l) => `${l.kind} ${l.rows.length}`).join(', ')}`);
  const { rows, renewedCount, truncated } = buildRows({ query, window: plan.window, firstRows, lookups });
  console.log(`Report rows: ${rows.length}, left out as renewed: ${renewedCount}${truncated ? ', TRUNCATED' : ''}`);
  for (const r of rows.slice(0, 10)) console.log(`  ${r.ends}  ${r.name}  ${r.license}  ${r.city}  ${r.insurer || ''}`);
  const out = opt('out', 'report.html');
  fs.writeFileSync(out, renderReportHtml({
    title: describeQuery(query), query, window: plan.window, rows, notes: plan.notes,
    stats: { renewedCount, truncated }, generatedAt: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
  }));
  console.log(`Wrote ${out}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
