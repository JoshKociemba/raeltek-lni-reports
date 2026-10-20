// Query Washington L&I's official contractor open data (data.wa.gov, Socrata) and check the results.
// The verify site (secure.lni.wa.gov/verify) shows the same records one contractor at a time; we link to it
// for spot checks instead of scraping it. Column names and quirks are in docs/datasets.md.

const BASE = 'https://data.wa.gov/resource';
const DATASETS = {
  general: 'm8qx-ubtq', // L&I Contractor License Data - General: one row per license, every status
  insurance: 'ciwg-agsx', // L&I Contractor License Data - Insurance: current policies only, several per license
};

// Run `npm run check:fields` after L&I changes a dataset.
const FIELDS = {
  general: {
    license: 'contractorlicensenumber',
    name: 'businessname',
    ubi: 'ubi',
    type: 'contractorlicensetypecode',
    typeDesc: 'contractorlicensetypecodedesc',
    status: 'statuscode',
    expires: 'licenseexpirationdate',
    phone: 'phonenumber',
    address: 'address1',
    city: 'city',
    state: 'state',
    zip: 'zip',
    specialty: 'specialtycode1',
    specialtyDesc: 'specialtycode1desc',
  },
  insurance: {
    license: 'contractorlicensenumber',
    type: 'contractorlicensetypecode',
    status: 'licensestatus',
    company: 'insurancecompany',
    agency: 'insuranceagencyname',
    policy: 'insurancepolicyno',
    amount: 'insuranceamt',
    starts: 'effectivedate',
    expires: 'expirationdate',
    cancelled: 'canceldate',
    updated: 'lastupdatedate',
  },
};

const ACTIVE = 'A';
const ROW_LIMIT = 50000;
const CHUNK = 150;

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;
const day = (iso) => String(iso || '').slice(0, 10);
const list = (xs) => xs.map(quote).join(', ');

function url(dataset, params, appToken) {
  const q = Object.entries({ ...params, ...(appToken ? { $$app_token: appToken } : {}) })
    .map(([k, v]) => `${encodeURIComponent(k).replace(/%24/g, '$')}=${encodeURIComponent(v)}`)
    .join('&');
  return `${BASE}/${DATASETS[dataset]}.json?${q}`;
}

/** today is "YYYY-MM-DD" in Pacific time. The window is today through today + days, inclusive. */
function windowFor(today, days) {
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + days);
  return { from: today, to: end.toISOString().slice(0, 10) };
}

const between = (field, w) => `${field} between ${quote(`${w.from}T00:00:00`)} and ${quote(`${w.to}T23:59:59`)}`;

/** SoQL for the trade filters on the General dataset, e.g. PC, or CC with specialty AD. Empty means every trade. */
function tradeWhere(filters) {
  const g = FIELDS.general;
  if (!filters.length) return '';
  return `(${filters.map((f) => {
    const parts = [`${g.type} = ${quote(f.type)}`];
    if (f.codes) parts.push(`${g.specialty} in (${list(f.codes)})`);
    if (f.like) parts.push(`upper(${g.specialtyDesc}) like ${quote(`%${f.like}%`)}`);
    return `(${parts.join(' AND ')})`;
  }).join(' OR ')})`;
}

/** Filters every lookup on the General dataset shares: active, trade, city. */
function generalWhere(query) {
  const g = FIELDS.general;
  return [
    `${g.status} = ${quote(ACTIVE)}`,
    tradeWhere(query.filters),
    query.cities.length ? `upper(${g.city}) in (${list(query.cities)})` : '',
  ].filter(Boolean).join(' AND ');
}

const harmless = (appToken) => url('insurance', { $where: `${FIELDS.insurance.license} = 'NONE'`, $limit: 1 }, appToken);

/**
 * The first query for a request. Insurance reports start from the policies ending (or cancelled) in the window,
 * which is a few thousand rows statewide; registration reports start from the General dataset.
 */
function planQuery({ query, today, appToken }) {
  const g = FIELDS.general;
  const i = FIELDS.insurance;
  const w = windowFor(today, query.days);
  const notes = [];
  if (query.counties.length) notes.push(`L&I's data has no county column, so the county filter (${query.counties.join(', ')}) was not applied. Ask by city instead.`);
  if (query.report === 'insurance' && query.filters.some((f) => f.type === 'EC' || f.type === 'LC')) {
    notes.push('L&I has insurance on file for very few electrical contractors and no elevator contractors, so they rarely appear in insurance reports.');
  }
  let first;
  if (query.report === 'insurance') {
    const types = [...new Set(query.filters.map((f) => f.type))];
    const where = [`(${between(i.expires, w)} OR ${between(i.cancelled, w)})`, `${i.status} = ${quote(ACTIVE)}`];
    if (types.length) where.push(`${i.type} in (${list(types)})`);
    first = url('insurance', { $where: where.join(' AND '), $limit: ROW_LIMIT, $order: i.license }, appToken);
  } else {
    first = url('general', { $where: `${between(g.expires, w)} AND ${generalWhere(query)}`, $limit: ROW_LIMIT, $order: g.license }, appToken);
  }
  return { window: w, notes, urls: { first } };
}

/** Socrata returns a JSON array, or { error, message } on a bad query. */
function parseRows(body, label) {
  let data = body;
  if (typeof body === 'string') {
    try { data = JSON.parse(body); } catch { throw new Error(`${label}: data.wa.gov did not return JSON (${body.slice(0, 200)})`); }
  }
  if (data && !Array.isArray(data) && (data.error || data.message)) {
    throw new Error(`${label}: ${data.message || data.error.message || data.error}`);
  }
  if (!Array.isArray(data)) throw new Error(`${label}: unexpected response from data.wa.gov`);
  return data;
}

const licenseOf = (row, f) => String(row[f.license] || '').trim();

/**
 * For insurance reports, the follow-up queries, in chunks of license numbers: which of the contractors are
 * active and in the requested trade and city ("contractors"), and which already have a policy running past the
 * window ("newer"). Always returns at least one item so the workflow carries on when nothing matched.
 */
function planLookups({ query, window, firstRows, appToken }) {
  const i = FIELDS.insurance;
  const g = FIELDS.general;
  if (query.report !== 'insurance') return [{ kind: 'none', url: harmless(appToken) }];
  const lics = [...new Set(firstRows.map((r) => licenseOf(r, i)).filter(Boolean))];
  const out = [];
  for (let k = 0; k < lics.length; k += CHUNK) {
    const chunk = list(lics.slice(k, k + CHUNK));
    out.push({ kind: 'contractors', url: url('general', { $where: `${g.license} in (${chunk}) AND ${generalWhere(query)}`, $limit: ROW_LIMIT }, appToken) });
    out.push({ kind: 'newer', url: url('insurance', { $where: `${i.license} in (${chunk}) AND ${i.expires} > ${quote(`${window.to}T23:59:59`)}`, $limit: ROW_LIMIT }, appToken) });
  }
  return out.length ? out : [{ kind: 'none', url: harmless(appToken) }];
}

/** The earlier of expiry and cancellation. */
function coverageEnd(row) {
  const i = FIELDS.insurance;
  const exp = day(row[i.expires]);
  const can = day(row[i.cancelled]);
  return can && (!exp || can < exp) ? can : exp;
}

/** L&I sometimes lists the same policy twice; keep the most recently updated copy. */
function dedupePolicies(rows) {
  const i = FIELDS.insurance;
  const best = new Map();
  for (const r of rows) {
    const key = `${licenseOf(r, i)}|${String(r[i.policy] || '').trim().toUpperCase()}`;
    const prev = best.get(key);
    if (!prev || day(r[i.updated]) > day(prev[i.updated])) best.set(key, r);
  }
  return [...best.values()];
}

function verifyUrl(contractor) {
  const g = FIELDS.general;
  const ubi = String(contractor[g.ubi] || '').replace(/\D/g, '');
  const lic = String(contractor[g.license] || '').trim();
  return `https://secure.lni.wa.gov/verify/Detail.aspx?UBI=${encodeURIComponent(ubi)}&LIC=${encodeURIComponent(lic)}&SAW=`;
}

const phone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(p || '').trim();
};

function contractorRow(r) {
  const g = FIELDS.general;
  return {
    license: licenseOf(r, g),
    name: String(r[g.name] || '').trim(),
    ubi: String(r[g.ubi] || '').trim(),
    phone: phone(r[g.phone]),
    address: [r[g.address], r[g.city], [r[g.state], r[g.zip]].filter(Boolean).join(' ')].map((x) => String(x || '').trim()).filter(Boolean).join(', '),
    city: String(r[g.city] || '').trim(),
    specialties: [r[g.typeDesc], r[g.specialtyDesc]].map((x) => String(x || '').trim()).filter(Boolean).join(': '),
    licenseExpires: day(r[g.expires]),
    verify: verifyUrl(r),
  };
}

/**
 * The checked report rows, soonest first. lookups is [{ kind, rows }] from planLookups.
 * Insurance: the contractor must be active and in the trade and city asked for, and is dropped when any policy
 * on file runs past the window (already renewed, or other coverage). Cancelled policies end at the cancel date.
 */
function buildRows({ query, window, firstRows, lookups = [] }) {
  const g = FIELDS.general;
  const i = FIELDS.insurance;
  if (query.report === 'license') {
    const rows = firstRows.filter((r) => r[g.status] === ACTIVE).map((r) => {
      const c = contractorRow(r);
      return { ...c, ends: c.licenseExpires };
    });
    rows.sort((a, b) => a.ends.localeCompare(b.ends) || a.name.localeCompare(b.name));
    return { rows, renewedCount: 0, truncated: firstRows.length >= ROW_LIMIT };
  }
  const of = (kind) => lookups.filter((l) => l.kind === kind).flatMap((l) => l.rows);
  const contractors = new Map(of('contractors').filter((r) => r[g.status] === ACTIVE).map((r) => [licenseOf(r, g), r]));
  const renewed = new Set(of('newer').filter((p) => !day(p[i.cancelled]) || day(p[i.cancelled]) > window.to).map((p) => licenseOf(p, i)));
  const policies = new Map();
  for (const p of dedupePolicies(firstRows)) {
    const lic = licenseOf(p, i);
    const end = coverageEnd(p);
    if (!contractors.has(lic) || !end || end < window.from || end > window.to) continue;
    if (!policies.has(lic)) policies.set(lic, []);
    policies.get(lic).push({ p, end });
  }
  const rows = [];
  let renewedCount = 0;
  for (const [lic, ps] of policies) {
    if (renewed.has(lic)) { renewedCount++; continue; }
    // The policy that lasts longest is when coverage on file actually runs out.
    const { p, end } = ps.sort((a, b) => b.end.localeCompare(a.end))[0];
    rows.push({
      ...contractorRow(contractors.get(lic)),
      ends: end,
      insurer: String(p[i.company] || '').trim(),
      agency: String(p[i.agency] || '').trim(),
      policy: String(p[i.policy] || '').trim(),
      amount: String(p[i.amount] || '').trim(),
      cancelled: !!day(p[i.cancelled]) && day(p[i.cancelled]) === end,
    });
  }
  rows.sort((a, b) => a.ends.localeCompare(b.ends) || a.name.localeCompare(b.name));
  return { rows, renewedCount, truncated: firstRows.length >= ROW_LIMIT };
}

module.exports = { BASE, DATASETS, FIELDS, ROW_LIMIT, windowFor, tradeWhere, planQuery, parseRows, planLookups, coverageEnd, dedupePolicies, buildRows, verifyUrl };
