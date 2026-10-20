#!/usr/bin/env node
// Check that the column names in src/lni.cjs still exist in L&I's datasets on data.wa.gov.
// Usage: npm run check:fields   (needs Node 18+ and internet access; exits 1 if a column is missing)
const { DATASETS, FIELDS } = require('../src/lni.cjs');

async function main() {
  let missing = 0;
  for (const [key, id] of Object.entries(DATASETS)) {
    const res = await fetch(`https://data.wa.gov/api/views/${id}.json`);
    if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
    const view = await res.json();
    const cols = new Map(view.columns.map((c) => [c.fieldName, c.dataTypeName]));
    console.log(`\n${view.name} (${id}), rows updated ${new Date(view.rowsUpdatedAt * 1000).toISOString().slice(0, 10)}`);
    for (const [name, field] of Object.entries(FIELDS[key])) {
      for (const f of [].concat(field).filter(Boolean)) {
        const type = cols.get(f);
        if (!type) missing++;
        console.log(`  ${type ? 'ok     ' : 'MISSING'} ${name.padEnd(12)} ${f}${type ? ` (${type})` : ''}`);
      }
    }
    console.log(`  All columns: ${[...cols].map(([f, t]) => `${f}:${t}`).join(', ')}`);
  }
  if (missing) {
    console.error(`\n${missing} column(s) missing. Fix FIELDS in src/lni.cjs, then npm test and npm run build:workflow.`);
    process.exit(1);
  }
  console.log('\nAll columns found.');
}

main().catch((err) => { console.error(err.message); process.exit(1); });
