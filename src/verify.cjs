// Second check of the listed contractors on L&I's Verify site. The open data (ciwg-agsx) leaves out policies that
// haven't taken effect yet, so a renewal filed ahead of time looks like a lapse until its start day. Verify lists
// every policy, future ones included. Josh wants only businesses that will end up with no coverage (2026-10-21).
const VERIFY_URL = 'https://secure.lni.wa.gov/verify/Controller.aspx/GetBusinessDetails';
// With a requested count, check extra rows so the list can still fill up after renewals are dropped. In a live run
// (2026-10-21, general contractors, 30 days) 16 of 30 open-data rows had a policy past the window on Verify.
const VERIFY_SLACK = 4;

/** The JSON the Verify page itself posts for one contractor. */
const verifyBody = (row) => ({ ubi: String(row.ubi || '').replace(/\D/g, ''), license: String(row.license || '').trim(), irlVilationId: '', isSecured: '' });

/** How many rows, from the top, to check: the ones the report will list, plus slack when a count was asked for. */
function verifyCount(rows, query, maxRows = 300) {
  if (query.report !== 'insurance') return 0;
  const listed = Math.min(rows.length, maxRows, query.limit || Infinity);
  return query.limit ? Math.min(rows.length, maxRows, listed * VERIFY_SLACK) : listed;
}

const mdy = (s) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s || '').trim());
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
};

/** Every policy Verify lists, with its coverage end (the cancel date when it comes first). Throws on a bad answer. */
function verifyPolicies(body) {
  let data = typeof body === 'string' ? JSON.parse(body) : body;
  if (data && typeof data.d === 'string') data = { d: JSON.parse(data.d) };
  const c = data && data.d && data.d.ReturnValue && data.d.ReturnValue.Contractor;
  if (!c || !Array.isArray(c.Insurances)) throw new Error('Verify returned no contractor details');
  return c.Insurances.map((p) => {
    const exp = mdy(p.ExpirationDate);
    const can = mdy(p.CancelDate);
    return { insurer: String(p.FirmName || '').trim(), starts: mdy(p.EffectiveDate), ends: can && (!exp || can < exp) ? can : exp };
  });
}

/**
 * Drop each checked row whose Verify record shows a policy running past the window. checks[k] is the HTTP result for
 * rows[k] ({ body } or { error }). A row that couldn't be checked stays, marked 'failed'. Rows past the checked ones
 * are left off (about half the open-data rows turn out covered), and counted as notChecked.
 */
function applyVerification({ rows, checks, window }) {
  const out = [];
  let renewedOnVerify = 0;
  let failed = 0;
  rows.forEach((r, k) => {
    if (k >= checks.length) return;
    let policies;
    try {
      if (checks[k].error || !checks[k].body) throw new Error('no answer');
      policies = verifyPolicies(checks[k].body);
    } catch {
      failed++;
      out.push({ ...r, verified: 'failed' });
      return;
    }
    if (policies.some((p) => p.ends > window.to)) { renewedOnVerify++; return; }
    out.push({ ...r, verified: 'ok' });
  });
  return { rows: out, renewedOnVerify, verifyFailed: failed, notChecked: Math.max(0, rows.length - checks.length) };
}

module.exports = { VERIFY_URL, VERIFY_SLACK, verifyBody, verifyCount, verifyPolicies, applyVerification };
