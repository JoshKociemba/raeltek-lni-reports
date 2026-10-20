const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planQuery, parseRows, matchCandidates, buildRows, windowFor, coverageEnd } = require('../src/lni.cjs');

const q = (o = {}) => ({ report: 'insurance', days: 14, trades: ['plumbing'], terms: ['PLUMB'], cities: [], counties: [], ...o });
const contractor = (lic, o = {}) => ({ contractorlicensenumber: lic, businessname: `${lic} Plumbing LLC`, ubi: '603 568 919', contractorlicensestatus: 'ACTIVE', city: 'VANCOUVER', state: 'WA', zip: '98682', specialtycode1desc: 'PLUMBING', licenseexpirationdate: '2027-03-01T00:00:00.000', ...o });
const policy = (lic, exp, o = {}) => ({ contractorlicensenumber: lic, insurancecompanyname: 'Acme Mutual', policynumber: `P-${lic}`, insuranceamount: '1000000', expirationdate: `${exp}T00:00:00.000`, ...o });

test('the window runs from today through today + days', () => {
  assert.deepEqual(windowFor('2026-10-20', 14), { from: '2026-10-20', to: '2026-11-03' });
  assert.deepEqual(windowFor('2026-12-25', 10), { from: '2026-12-25', to: '2027-01-04' });
});

test('planQuery builds SoQL for trade, city and window', () => {
  const p = planQuery({ query: q({ cities: ["O'BRIEN"] }), today: '2026-10-20' });
  const general = decodeURIComponent(p.urls.general);
  assert.match(general, /resource\/m8qx-ubtq\.json\?\$where=/);
  assert.match(general, /upper\(specialtycode1desc\) like '%PLUMB%' OR upper\(specialtycode2desc\) like '%PLUMB%'/);
  assert.match(general, /upper\(city\) in \('O''BRIEN'\)/);
  const ins = decodeURIComponent(p.urls.insurance);
  assert.match(ins, /ciwg-agsx\.json/);
  assert.match(ins, /expirationdate between '2026-10-20T00:00:00' and '2026-11-03T23:59:59'/);
  assert.deepEqual(p.window, { from: '2026-10-20', to: '2026-11-03' });
});

test('county filters are noted when the data has no county column', () => {
  const p = planQuery({ query: q({ counties: ['CLARK'] }), today: '2026-10-20' });
  assert.equal(p.notes.length, 1);
  assert.ok(!/county/.test(decodeURIComponent(p.urls.general)));
});

test('license reports filter registrations by expiry instead', () => {
  const p = planQuery({ query: q({ report: 'license' }), today: '2026-10-20' });
  assert.match(decodeURIComponent(p.urls.general), /licenseexpirationdate between/);
});

test('parseRows surfaces Socrata errors', () => {
  assert.deepEqual(parseRows('[{"a":1}]', 'x'), [{ a: 1 }]);
  assert.throws(() => parseRows('{"error":true,"message":"No such column: foo"}', 'Insurance data'), /No such column/);
  assert.throws(() => parseRows('<html>', 'x'), /did not return JSON/);
});

test('match keeps active contractors with a policy ending in the window, and asks about newer policies', () => {
  const w = windowFor('2026-10-20', 14);
  const m = matchCandidates({
    query: q(), window: w,
    generalRows: [contractor('AAA'), contractor('BBB'), contractor('CCC', { contractorlicensestatus: 'EXPIRED' })],
    insuranceRows: [policy('AAA', '2026-10-25'), policy('BBB', '2026-11-01'), policy('CCC', '2026-10-22'), policy('ZZZ', '2026-10-22')],
  });
  assert.deepEqual(m.candidates.map((c) => c.license), ['AAA', 'BBB']);
  assert.equal(m.stats.inactiveSkipped, 1);
  assert.equal(m.renewalUrls.length, 1);
  assert.match(decodeURIComponent(m.renewalUrls[0]), /in \('AAA', 'BBB'\) AND expirationdate > '2026-11-03T23:59:59'/);

  const { rows, renewedCount } = buildRows({ query: q(), window: w, candidates: m.candidates, renewalRows: [policy('BBB', '2027-11-01')] });
  assert.equal(renewedCount, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].license, 'AAA');
  assert.equal(rows[0].ends, '2026-10-25');
  assert.equal(rows[0].insurer, 'Acme Mutual');
  assert.equal(rows[0].verify, 'https://secure.lni.wa.gov/verify/Detail.aspx?UBI=603568919&LIC=AAA&SAW=');
});

test('a cancelled newer policy does not count as renewed, and cancellation ends coverage', () => {
  const w = windowFor('2026-10-20', 14);
  const cands = [{ license: 'AAA', contractor: contractor('AAA'), policies: [policy('AAA', '2027-06-01', { canceldate: '2026-10-28T00:00:00.000' })] }];
  assert.equal(coverageEnd(cands[0].policies[0]), '2026-10-28');
  const { rows } = buildRows({ query: q(), window: w, candidates: cands, renewalRows: cands[0].policies });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ends, '2026-10-28');
  assert.equal(rows[0].cancelled, true);
});

test('with no candidates there is still one harmless renewal query, so the workflow keeps going', () => {
  const m = matchCandidates({ query: q(), window: windowFor('2026-10-20', 14), generalRows: [], insuranceRows: [] });
  assert.equal(m.renewalUrls.length, 1);
  assert.match(decodeURIComponent(m.renewalUrls[0]), /= 'NONE'/);
});

test('renewal queries are split into chunks', () => {
  const lics = Array.from({ length: 301 }, (_, i) => `L${i}`);
  const m = matchCandidates({ query: q(), window: windowFor('2026-10-20', 14), generalRows: lics.map((l) => contractor(l)), insuranceRows: lics.map((l) => policy(l, '2026-10-30')) });
  assert.equal(m.renewalUrls.length, 3);
  assert.ok(m.renewalUrls.every((u) => u.length < 8000));
});
