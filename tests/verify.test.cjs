const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyBody, verifyCount, verifyPolicies, applyVerification } = require('../src/verify.cjs');

const W = { from: '2026-10-21', to: '2026-11-04' };
const ins = (FirmName, EffectiveDate, ExpirationDate, CancelDate = '') => ({ License: 'X', FirmName, AccountId: 'P', EffectiveDate, ExpirationDate, CancelDate, Amount: '1000000' });
const answer = (insurances) => JSON.stringify({ d: { ReturnValue: { Contractor: { Insurances: insurances } } } });
const row = (license, ends) => ({ license, ubi: '604-529-031', ends, name: license });

test('the request matches what the Verify page posts', () => {
  assert.deepEqual(verifyBody(row('CASTLIL814P2')), { ubi: '604529031', license: 'CASTLIL814P2', irlVilationId: '', isSecured: '' });
});

test('Verify policies are read with their coverage end; a bad answer throws', () => {
  assert.deepEqual(verifyPolicies(answer([ins('Atlantic Casualty', '10/22/2025', '10/22/2026'), ins('B', '1/5/2026', '1/5/2027', '3/1/2026')])), [
    { insurer: 'Atlantic Casualty', starts: '2025-10-22', ends: '2026-10-22' },
    { insurer: 'B', starts: '2026-01-05', ends: '2026-03-01' },
  ]);
  assert.equal(verifyPolicies(JSON.stringify({ d: JSON.stringify({ ReturnValue: { Contractor: { Insurances: [] } } }) })).length, 0, 'd as a JSON string');
  assert.throws(() => verifyPolicies('{"d":{"ReturnValue":null}}'), /no contractor/);
  assert.throws(() => verifyPolicies('<html>'));
});

test('a contractor with a policy past the window on Verify is dropped; failures stay, marked', () => {
  // Castle Industries: the open data only has the expiring policy; Verify also shows the one starting tomorrow.
  const castle = answer([ins('Atlantic Casualty', '10/22/2025', '10/22/2026'), ins('Other Ins Co', '10/22/2026', '10/22/2027')]);
  const lapsing = answer([ins('Atlantic Casualty', '10/30/2025', '10/30/2026'), ins('Old', '1/1/2020', '1/1/2021')]);
  const v = applyVerification({ rows: [row('CASTLE', '2026-10-22'), row('LAPSE', '2026-10-30'), row('ERR', '2026-11-01'), row('LATER', '2026-11-02')],
    checks: [{ body: castle }, { body: lapsing }, { error: 'timeout' }], window: W });
  assert.deepEqual(v.rows.map((r) => [r.license, r.verified]), [['LAPSE', 'ok'], ['ERR', 'failed'], ['LATER', 'unchecked']]);
  assert.deepEqual([v.renewedOnVerify, v.verifyFailed], [1, 1]);
  // A cancellation inside the window ends that policy, so it doesn't count as running past it.
  const cancelled = answer([ins('A', '10/1/2026', '10/1/2027', '10/25/2026')]);
  assert.equal(applyVerification({ rows: [row('C', '2026-10-25')], checks: [{ body: cancelled }], window: W }).rows.length, 1);
});

test('only the rows the report will list are checked, with slack for a requested count', () => {
  const rows = Array.from({ length: 50 }, (_, k) => row(`L${k}`, '2026-10-30'));
  assert.equal(verifyCount(rows, { report: 'insurance' }), 50);
  assert.equal(verifyCount(rows, { report: 'insurance' }, 20), 20);
  assert.equal(verifyCount(rows, { report: 'insurance', limit: 10 }), 30);
  assert.equal(verifyCount(rows.slice(0, 4), { report: 'insurance', limit: 10 }), 4);
  assert.equal(verifyCount(rows, { report: 'license' }), 0);
});
