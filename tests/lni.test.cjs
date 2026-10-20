const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planQuery, parseRows, planLookups, buildRows, windowFor, coverageEnd, dedupePolicies, tradeWhere } = require('../src/lni.cjs');
const { TRADES } = require('../src/understand.cjs');

const q = (o = {}) => ({ report: 'insurance', days: 14, trades: ['plumbing'], filters: TRADES.plumbing, cities: [], counties: [], ...o });
// Shapes copied from docs/datasets.md samples.
const contractor = (lic, o = {}) => ({ contractorlicensenumber: lic, businessname: `${lic} PLUMBING LLC`, contractorlicensetypecode: 'PC', contractorlicensetypecodedesc: 'PLUMBING CONTRACTOR', ubi: '603320569', statuscode: 'A', contractorlicensestatus: 'ACTIVE', address1: '1 MAIN ST', city: 'VANCOUVER', state: 'WA', zip: '98661', phonenumber: '5039573452', specialtycode1: '01', specialtycode1desc: 'JOURNEY LEVEL', licenseexpirationdate: '2027-08-15T00:00:00.000', ...o });
const policy = (lic, exp, o = {}) => ({ contractorlicensenumber: lic, contractorlicensetypecode: 'PC', licensestatus: 'A', insurancecompany: 'Ohio Security Ins Co', insurancepolicyno: `P-${lic}`, insuranceamt: '1000000.0000', insuranceagencyname: 'Collup Insurance', effectivedate: '2025-11-01T00:00:00.000', expirationdate: `${exp}T00:00:00.000`, lastupdatedate: '2026-04-24T00:00:00.000', ...o });
const W = windowFor('2026-10-20', 14);
const dec = (u) => decodeURIComponent(u);

test('the window runs from today through today + days', () => {
  assert.deepEqual(W, { from: '2026-10-20', to: '2026-11-03' });
  assert.deepEqual(windowFor('2026-12-25', 10), { from: '2026-12-25', to: '2027-01-04' });
});

test('plumbing means plumbing contractors plus construction contractors with the plumbing specialty', () => {
  assert.equal(tradeWhere(TRADES.plumbing), "((contractorlicensetypecode = 'PC') OR (contractorlicensetypecode = 'CC' AND specialtycode1 in ('AD')))");
  assert.equal(tradeWhere([]), '');
  assert.equal(tradeWhere([{ type: 'CC', like: 'SANDBLAST' }]), "((contractorlicensetypecode = 'CC' AND upper(specialtycode1desc) like '%SANDBLAST%'))");
});

test('insurance reports start from active policies ending or cancelled in the window', () => {
  const p = planQuery({ query: q(), today: '2026-10-20' });
  const u = dec(p.urls.first);
  assert.match(u, /resource\/ciwg-agsx\.json\?\$where=/);
  assert.match(u, /\(expirationdate between '2026-10-20T00:00:00' and '2026-11-03T23:59:59' OR canceldate between '2026-10-20T00:00:00' and '2026-11-03T23:59:59'\)/);
  assert.match(u, /licensestatus = 'A'/);
  assert.match(u, /contractorlicensetypecode in \('PC', 'CC'\)/);
  assert.deepEqual(p.notes, []);
});

test('registration reports query the General dataset directly, with city and trade', () => {
  const u = dec(planQuery({ query: q({ report: 'license', cities: ["O'BRIEN"] }), today: '2026-10-20' }).urls.first);
  assert.match(u, /m8qx-ubtq\.json/);
  assert.match(u, /licenseexpirationdate between/);
  assert.match(u, /statuscode = 'A'/);
  assert.match(u, /upper\(city\) in \('O''BRIEN'\)/);
});

test('counties and electrical insurance get a note', () => {
  const p = planQuery({ query: q({ counties: ['CLARK'], filters: TRADES.electrical }), today: '2026-10-20' });
  assert.equal(p.notes.length, 2);
  assert.ok(!/county/i.test(dec(p.urls.first)));
});

test('parseRows surfaces Socrata errors', () => {
  assert.deepEqual(parseRows('[{"a":1}]', 'x'), [{ a: 1 }]);
  assert.throws(() => parseRows('{"error":true,"message":"No such column: foo"}', 'Insurance data'), /No such column/);
  assert.throws(() => parseRows('<html>', 'x'), /did not return JSON/);
});

test('lookups check trade, city and newer policies in chunks', () => {
  const rows = Array.from({ length: 151 }, (_, k) => policy(`L${k}`, '2026-10-30'));
  const l = planLookups({ query: q({ cities: ['VANCOUVER'] }), window: W, firstRows: [...rows, rows[0]] });
  assert.deepEqual(l.map((x) => x.kind), ['contractors', 'newer', 'contractors', 'newer']);
  assert.match(dec(l[0].url), /m8qx-ubtq.*contractorlicensenumber in \('L0', 'L1'.*statuscode = 'A' AND \(\(contractorlicensetypecode = 'PC'\).*upper\(city\) in \('VANCOUVER'\)/);
  assert.match(dec(l[1].url), /ciwg-agsx.*expirationdate > '2026-11-03T23:59:59'/);
  assert.ok(l.every((x) => x.url.length < 8000));
  assert.deepEqual(planLookups({ query: q(), window: W, firstRows: [] }).map((x) => x.kind), ['none']);
  assert.deepEqual(planLookups({ query: q({ report: 'license' }), window: W, firstRows: rows }).map((x) => x.kind), ['none']);
});

test('the report keeps active matches without newer coverage, soonest first', () => {
  const firstRows = [policy('AAA', '2026-11-01'), policy('BBB', '2026-10-25'), policy('CCC', '2026-10-22'), policy('DDD', '2026-10-28')];
  const lookups = [
    // CCC is not in the trade or city asked for, so the lookup didn't return it.
    { kind: 'contractors', rows: [contractor('AAA'), contractor('BBB'), contractor('DDD')] },
    { kind: 'newer', rows: [policy('DDD', '2027-10-28', { insurancepolicyno: 'NEW' })] },
  ];
  const { rows, renewedCount } = buildRows({ query: q(), window: W, firstRows, lookups });
  assert.equal(renewedCount, 1);
  assert.deepEqual(rows.map((r) => [r.license, r.ends]), [['BBB', '2026-10-25'], ['AAA', '2026-11-01']]);
  assert.equal(rows[0].phone, '(503) 957-3452');
  assert.equal(rows[0].insurer, 'Ohio Security Ins Co');
  assert.equal(rows[0].agency, 'Collup Insurance');
  assert.equal(rows[0].specialties, 'PLUMBING CONTRACTOR: JOURNEY LEVEL');
  assert.equal(rows[0].verify, 'https://secure.lni.wa.gov/verify/Detail.aspx?UBI=603320569&LIC=BBB&SAW=');
});

test('a cancellation ends coverage, and a cancelled newer policy is not a renewal', () => {
  const cancelled = policy('AAA', '2027-06-01', { canceldate: '2026-10-28T00:00:00.000' });
  assert.equal(coverageEnd(cancelled), '2026-10-28');
  const { rows } = buildRows({
    query: q(), window: W, firstRows: [cancelled],
    lookups: [{ kind: 'contractors', rows: [contractor('AAA')] }, { kind: 'newer', rows: [cancelled] }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ends, '2026-10-28');
  assert.equal(rows[0].cancelled, true);
});

test('duplicate policy rows collapse to the latest update', () => {
  const a = policy('AAA', '2026-10-30', { lastupdatedate: '2026-01-01T00:00:00.000' });
  const b = policy('AAA', '2026-10-31', { lastupdatedate: '2026-05-01T00:00:00.000' });
  assert.deepEqual(dedupePolicies([a, b, policy('AAA', '2026-10-30', { insurancepolicyno: 'WC-1' })]).map((p) => p.expirationdate.slice(0, 10)), ['2026-10-31', '2026-10-30']);
});

test('several policies ending in the window report the one that lasts longest', () => {
  const firstRows = [policy('AAA', '2026-10-22', { insurancepolicyno: 'GL' }), policy('AAA', '2026-11-02', { insurancepolicyno: 'UMB' })];
  const { rows } = buildRows({ query: q(), window: W, firstRows, lookups: [{ kind: 'contractors', rows: [contractor('AAA')] }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].policy, 'UMB');
});

test('registration reports list active registrations by expiry', () => {
  const { rows } = buildRows({ query: q({ report: 'license' }), window: W, firstRows: [contractor('AAA', { licenseexpirationdate: '2026-10-30T00:00:00.000' }), contractor('ZZZ', { statuscode: 'E' })] });
  assert.deepEqual(rows.map((r) => [r.license, r.ends]), [['AAA', '2026-10-30']]);
});
