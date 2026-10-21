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

/**
 * The first query for a request. Insurance reports start from the policies ending or cancelled in the window
 * (a few thousand rows statewide), filtered by license type when the trade is a whole license type. A trade
 * defined by specialty codes starts from its active contractors instead, since insurance has no specialty
 * column and starting there would pull every construction policy.
 * Registration reports always start from the General dataset.
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
  if (query.cities.length) notes.push('Cities are the mailing address L&I has on file, which may differ from where a contractor works.');
  // Insurance has a license type column but no specialty, so type-only trades (plumbing, electrical) can start there too.
  const typeOnly = query.filters.every((f) => !f.codes && !f.like);
  const start = query.report === 'insurance' && typeOnly ? 'insurance' : 'contractors';
  const types = [...new Set(query.filters.map((f) => f.type))];
  const insWhere = [`(${between(i.expires, w)} OR ${between(i.cancelled, w)})`, `${i.status} = ${quote(ACTIVE)}`,
    types.length ? `${i.type} in (${list(types)})` : ''].filter(Boolean).join(' AND ');
  const first = start === 'insurance'
    ? url('insurance', { $where: insWhere, $limit: ROW_LIMIT, $order: i.license }, appToken)
    : url('general', { $where: [query.report === 'license' ? between(g.expires, w) : '', generalWhere(query)].filter(Boolean).join(' AND '), $limit: ROW_LIMIT, $order: g.license }, appToken);
  return { window: w, notes, start, urls: { first } };
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
 * For insurance reports, the follow-up queries in chunks of license numbers: every policy on file for them
 * ("policies", so we can tell who has coverage past the window) and, when we started from insurance, which of
 * them are active contractors in the city asked for ("contractors"). Registration reports need none.
 */
function planLookups({ query, start, firstRows, appToken }) {
  const i = FIELDS.insurance;
  const g = FIELDS.general;
  if (query.report !== 'insurance') return [];
  const lics = [...new Set(firstRows.map((r) => licenseOf(r, start === 'insurance' ? i : g)).filter(Boolean))];
  const out = [];
  for (let k = 0; k < lics.length; k += CHUNK) {
    const chunk = list(lics.slice(k, k + CHUNK));
    if (start === 'insurance') out.push({ kind: 'contractors', url: url('general', { $where: `${g.license} in (${chunk}) AND ${generalWhere(query)}`, $limit: ROW_LIMIT }, appToken) });
    out.push({ kind: 'policies', url: url('insurance', { $where: `${i.license} in (${chunk})`, $limit: ROW_LIMIT }, appToken) });
  }
  return out;
}

/** The earlier of expiry and cancellation. */
function coverageEnd(row) {
  const i = FIELDS.insurance;
  const exp = day(row[i.expires]);
  const can = day(row[i.cancelled]);
  return can && (!exp || can < exp) ? can : exp;
}

/**
 * L&I sometimes lists the same policy twice; keep the most recently updated copy. A policy number with a
 * different term (a renewal under the same number) is a separate policy, so the dates are part of the key.
 */
function dedupePolicies(rows) {
  const i = FIELDS.insurance;
  const best = new Map();
  for (const r of rows) {
    const key = [licenseOf(r, i), String(r[i.policy] || '').trim().toUpperCase(), day(r[i.starts]), day(r[i.expires]), day(r[i.cancelled])].join('|');
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
 * Insurance: the contractor must be active and in the trade and city asked for. L&I keeps an old policy on file
 * until it expires, so a renewal can overlap it; only the newest policy (latest effective date) counts, and its
 * end is the coverage end (a cancellation ends a policy early). The contractor is listed when that falls in the
 * window. Someone with an older policy ending in the window but a newer one running past it has renewed, and is
 * counted, not listed.
 */
function buildRows({ query, window, start, firstRows, lookups = [] }) {
  const g = FIELDS.general;
  const i = FIELDS.insurance;
  const sort = (rows) => rows.sort((a, b) => a.ends.localeCompare(b.ends) || a.name.localeCompare(b.name));
  const truncated = firstRows.length >= ROW_LIMIT;
  if (query.report === 'license') {
    const rows = firstRows.filter((r) => r[g.status] === ACTIVE).map((r) => {
      const c = contractorRow(r);
      return { ...c, ends: c.licenseExpires };
    });
    return { rows: sort(rows), renewedCount: 0, endedCount: 0, truncated };
  }
  const of = (kind) => lookups.filter((l) => l.kind === kind).flatMap((l) => l.rows);
  const contractors = new Map((start === 'insurance' ? of('contractors') : firstRows)
    .filter((r) => r[g.status] === ACTIVE).map((r) => [licenseOf(r, g), r]));
  const policies = new Map();
  for (const p of dedupePolicies(of('policies'))) {
    const lic = licenseOf(p, i);
    if (!contractors.has(lic) || p[i.status] !== ACTIVE) continue;
    if (!policies.has(lic)) policies.set(lic, []);
    policies.get(lic).push({ p, end: coverageEnd(p) });
  }
  const rows = [];
  let renewedCount = 0;
  let endedCount = 0;
  for (const [lic, ps] of policies) {
    // Would the first query have found this contractor? (A policy expiring or cancelled in the window.)
    const inside = (d) => d >= window.from && d <= window.to;
    const touched = ps.some((x) => inside(day(x.p[i.expires])) || inside(day(x.p[i.cancelled])));
    const latest = ps.filter((x) => x.end).sort((a, b) => day(b.p[i.starts]).localeCompare(day(a.p[i.starts]))
      || b.end.localeCompare(a.end) || day(b.p[i.updated]).localeCompare(day(a.p[i.updated])))[0];
    if (!latest) continue;
    if (latest.end > window.to) { if (touched) renewedCount++; continue; }
    if (latest.end < window.from) { if (touched) endedCount++; continue; }
    const p = latest.p;
    rows.push({
      ...contractorRow(contractors.get(lic)),
      ends: latest.end,
      insurer: String(p[i.company] || '').trim(),
      agency: String(p[i.agency] || '').trim(),
      policy: String(p[i.policy] || '').trim(),
      amount: String(p[i.amount] || '').trim(),
      cancelled: !!day(p[i.cancelled]) && day(p[i.cancelled]) === latest.end,
    });
  }
  return { rows: sort(rows), renewedCount, endedCount, truncated };
}

module.exports = { BASE, DATASETS, FIELDS, ROW_LIMIT, windowFor, tradeWhere, planQuery, parseRows, planLookups, coverageEnd, dedupePolicies, buildRows, verifyUrl };
