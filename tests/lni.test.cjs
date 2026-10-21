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

test('trade filters pair a license type with its specialty codes', () => {
  assert.equal(tradeWhere(TRADES.plumbing), "((contractorlicensetypecode = 'PC'))");
  assert.equal(tradeWhere(TRADES.hvac), "((contractorlicensetypecode = 'CC' AND specialtycode1 in ('SM')) OR (contractorlicensetypecode = 'EC' AND specialtycode1 in ('6A', '6B')))");
  assert.equal(tradeWhere([]), '');
  assert.equal(tradeWhere([{ type: 'CC', like: 'SANDBLAST' }]), "((contractorlicensetypecode = 'CC' AND upper(specialtycode1desc) like '%SANDBLAST%'))");
});

test('a specialty trade starts from its active contractors', () => {
  const p = planQuery({ query: q({ trades: ['roofing'], filters: TRADES.roofing, cities: ["O'BRIEN"] }), today: '2026-10-20' });
  assert.equal(p.start, 'contractors');
  const u = dec(p.urls.first);
  assert.match(u, /m8qx-ubtq\.json\?\$where=statuscode = 'A' AND \(\(contractorlicensetypecode = 'CC' AND specialtycode1 in \('CD'\)\)\) AND upper\(city\) in \('O''BRIEN'\)/);
  assert.ok(!/licenseexpirationdate/.test(u));
  assert.equal(p.notes.length, 1, 'mailing-address note');
});

test('a whole-license-type trade starts from insurance filtered by type', () => {
  const p = planQuery({ query: q(), today: '2026-10-20' });
  assert.equal(p.start, 'insurance');
  assert.match(dec(p.urls.first), /ciwg-agsx.*licensestatus = 'A' AND contractorlicensetypecode in \('PC'\)/);
});

test('insurance reports for every trade start from policies ending or cancelled in the window', () => {
  const p = planQuery({ query: q({ trades: [], filters: [] }), today: '2026-10-20' });
  assert.equal(p.start, 'insurance');
  const u = dec(p.urls.first);
  assert.match(u, /ciwg-agsx\.json/);
  assert.match(u, /\(expirationdate between '2026-10-20T00:00:00' and '2026-11-03T23:59:59' OR canceldate between '2026-10-20T00:00:00' and '2026-11-03T23:59:59'\) AND licensestatus = 'A'/);
});

test('registration reports filter the General dataset by expiry', () => {
  const p = planQuery({ query: q({ report: 'license' }), today: '2026-10-20' });
  assert.match(dec(p.urls.first), /m8qx-ubtq.*licenseexpirationdate between .* AND statuscode = 'A'/);
  assert.deepEqual(planLookups({ query: q({ report: 'license' }), start: p.start, firstRows: [contractor('AAA')] }), []);
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

test('lookups fetch every policy on file, in chunks, plus contractors when starting from insurance', () => {
  const cs = Array.from({ length: 151 }, (_, k) => contractor(`L${k}`));
  const l = planLookups({ query: q(), start: 'contractors', firstRows: cs });
  assert.deepEqual(l.map((x) => x.kind), ['policies', 'policies']);
  assert.match(dec(l[0].url), /ciwg-agsx.*\$where=contractorlicensenumber in \('L0', 'L1'/);
  assert.ok(l.every((x) => x.url.length < 8000));
  const ps = cs.map((c) => policy(c.contractorlicensenumber, '2026-10-30'));
  const l2 = planLookups({ query: q({ trades: [], filters: [], cities: ['VANCOUVER'] }), start: 'insurance', firstRows: [...ps, ps[0]] });
  assert.deepEqual(l2.map((x) => x.kind), ['contractors', 'policies', 'contractors', 'policies']);
  assert.match(dec(l2[0].url), /m8qx-ubtq.*contractorlicensenumber in \('L0'.*statuscode = 'A' AND upper\(city\) in \('VANCOUVER'\)/);
  assert.deepEqual(planLookups({ query: q(), start: 'contractors', firstRows: [] }), []);
});

const run = (firstRows, policies, o = {}) => buildRows({ query: q(), window: W, start: 'contractors', firstRows, lookups: [{ kind: 'policies', rows: policies }], ...o });

test('the report lists contractors whose coverage on file ends in the window, soonest first', () => {
  const { rows, renewedCount } = run(
    [contractor('AAA'), contractor('BBB'), contractor('DDD'), contractor('EEE')],
    [policy('AAA', '2026-11-01'), policy('BBB', '2026-10-25'), policy('DDD', '2026-10-28'), policy('DDD', '2027-10-28', { insurancepolicyno: 'NEW' }), policy('EEE', '2027-05-01'), policy('ZZZ', '2026-10-22')],
  );
  assert.equal(renewedCount, 1, 'DDD has a newer policy; EEE never had one ending');
  assert.deepEqual(rows.map((r) => [r.license, r.ends]), [['BBB', '2026-10-25'], ['AAA', '2026-11-01']]);
  assert.equal(rows[0].phone, '(503) 957-3452');
  assert.equal(rows[0].insurer, 'Ohio Security Ins Co');
  assert.equal(rows[0].agency, 'Collup Insurance');
  assert.equal(rows[0].specialties, 'PLUMBING CONTRACTOR: JOURNEY LEVEL');
  assert.equal(rows[0].verify, 'https://secure.lni.wa.gov/verify/Detail.aspx?UBI=603320569&LIC=BBB&SAW=');
});

test('a cancellation ends coverage; one before the window is counted, not listed', () => {
  const soon = policy('AAA', '2027-06-01', { canceldate: '2026-10-28T00:00:00.000' });
  assert.equal(coverageEnd(soon), '2026-10-28');
  const r1 = run([contractor('AAA')], [soon]);
  assert.equal(r1.rows[0].ends, '2026-10-28');
  assert.equal(r1.rows[0].cancelled, true);
  const r2 = run([contractor('BBB')], [policy('BBB', '2026-10-30', { canceldate: '2026-04-06T00:00:00.000' })]);
  assert.deepEqual([r2.rows.length, r2.endedCount], [0, 1]);
  // Cancelled in April but with a newer policy: renewed, not cancelled.
  const r3 = run([contractor('CCC')], [policy('CCC', '2026-10-30', { canceldate: '2026-04-06T00:00:00.000' }), policy('CCC', '2027-04-06', { insurancepolicyno: 'NEW' })]);
  assert.deepEqual([r3.rows.length, r3.renewedCount, r3.endedCount], [0, 1, 0]);
});

test('exact duplicate policy rows collapse to the latest update; a renewed term under the same number stays', () => {
  const a = policy('AAA', '2026-10-30', { lastupdatedate: '2026-01-01T00:00:00.000', insuranceagencyname: 'Old' });
  const b = policy('AAA', '2026-10-30', { lastupdatedate: '2026-05-01T00:00:00.000', insuranceagencyname: 'New' });
  assert.deepEqual(dedupePolicies([a, b]).map((p) => p.insuranceagencyname), ['New']);
  const renewedTerm = policy('AAA', '2027-10-30', { lastupdatedate: '2026-01-01T00:00:00.000' });
  assert.equal(dedupePolicies([b, renewedTerm]).length, 2);
  const r = run([contractor('AAA')], [b, renewedTerm]);
  assert.deepEqual([r.rows.length, r.renewedCount], [0, 1]);
});

test('with several policies in the window and the same start, the one ending last is shown', () => {
  const { rows } = run([contractor('AAA')], [policy('AAA', '2026-10-22', { insurancepolicyno: 'GL' }), policy('AAA', '2026-11-02', { insurancepolicyno: 'UMB' })]);
  assert.deepEqual(rows.map((r) => r.policy), ['UMB']);
});

test('overlapping policies: only the newest policy and its expiration count', () => {
  // An older policy still on file runs past the window, but the newest one ends inside it.
  const old = policy('AAA', '2027-01-15', { insurancepolicyno: 'OLD', effectivedate: '2025-01-15T00:00:00.000' });
  const newest = policy('AAA', '2026-10-30', { insurancepolicyno: 'NEW', effectivedate: '2026-04-30T00:00:00.000' });
  const r1 = run([contractor('AAA')], [old, newest]);
  assert.deepEqual(r1.rows.map((r) => [r.policy, r.ends]), [['NEW', '2026-10-30']]);
  // The older policy ends in the window, but a newer one runs past it: renewed.
  const ending = policy('BBB', '2026-10-25', { insurancepolicyno: 'OLD', effectivedate: '2025-10-25T00:00:00.000' });
  const renewal = policy('BBB', '2027-10-01', { insurancepolicyno: 'NEW', effectivedate: '2026-10-01T00:00:00.000' });
  const r2 = run([contractor('BBB')], [ending, renewal]);
  assert.deepEqual([r2.rows.length, r2.renewedCount], [0, 1]);
});

test('starting from insurance, only active contractors in the city asked for are kept', () => {
  const ps = [policy('AAA', '2026-10-30'), policy('CCC', '2026-10-30')];
  const { rows } = buildRows({ query: q({ trades: [], filters: [] }), window: W, start: 'insurance', firstRows: ps, lookups: [
    { kind: 'contractors', rows: [contractor('AAA')] }, { kind: 'policies', rows: ps },
  ] });
  assert.deepEqual(rows.map((r) => r.license), ['AAA']);
});

test('registration reports list active registrations by expiry', () => {
  const { rows } = buildRows({ query: q({ report: 'license' }), window: W, start: 'contractors', firstRows: [contractor('AAA', { licenseexpirationdate: '2026-10-30T00:00:00.000' }), contractor('ZZZ', { statuscode: 'E' })] });
  assert.deepEqual(rows.map((r) => [r.license, r.ends]), [['AAA', '2026-10-30']]);
});
