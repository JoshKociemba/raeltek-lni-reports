// Query Washington L&I's official contractor open data (data.wa.gov, Socrata) and check the results.
// The verify site (secure.lni.wa.gov/verify) shows the same records one contractor at a time; we link to it
// for spot checks instead of scraping it.

const BASE = 'https://data.wa.gov/resource';
const DATASETS = {
  general: 'm8qx-ubtq', // L&I Contractor License Data - General
  insurance: 'ciwg-agsx', // L&I Contractor License Data - Insurance
};

// Column names. Run `npm run check:fields` (it needs to reach data.wa.gov) after L&I changes a dataset.
// An empty name switches that part off: an empty county means county filters are ignored, with a note.
const FIELDS = {
  general: {
    license: 'contractorlicensenumber',
    name: 'businessname',
    ubi: 'ubi',
    type: 'contractorlicensetypecodedesc',
    status: 'contractorlicensestatus',
    expires: 'licenseexpirationdate',
    phone: 'phonenumber',
    address: 'address1',
    city: 'city',
    state: 'state',
    zip: 'zip',
    county: '',
    specialties: ['specialtycode1desc', 'specialtycode2desc'],
  },
  insurance: {
    license: 'contractorlicensenumber',
    company: 'insurancecompanyname',
    policy: 'policynumber',
    amount: 'insuranceamount',
    starts: 'effectivedate',
    expires: 'expirationdate',
    cancelled: 'canceldate',
  },
};

const ACTIVE = /^(A|ACTIVE)$/i;
const ROW_LIMIT = 50000;
const RENEWAL_CHUNK = 150;

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;
const day = (iso) => String(iso || '').slice(0, 10);

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

/** The two Socrata queries for a request: matching contractors, and policies (or registrations) ending in the window. */
function planQuery({ query, today, appToken }) {
  const g = FIELDS.general;
  const i = FIELDS.insurance;
  const w = windowFor(today, query.days);
  const where = [];
  if (query.terms.length) {
    where.push(`(${g.specialties.flatMap((f) => query.terms.map((t) => `upper(${f}) like ${quote(`%${t}%`)}`)).join(' OR ')})`);
  }
  if (query.cities.length) where.push(`upper(${g.city}) in (${query.cities.map(quote).join(', ')})`);
  const notes = [];
  if (query.counties.length) {
    if (g.county) where.push(`upper(${g.county}) in (${query.counties.map(quote).join(', ')})`);
    else notes.push(`L&I's data has no county column, so the county filter (${query.counties.join(', ')}) was not applied; filter by city instead.`);
  }
  if (query.report === 'license') where.push(between(g.expires, w));
  const general = url('general', { $where: where.join(' AND ') || '1=1', $limit: ROW_LIMIT, $order: g.license }, appToken);
  const insurance = query.report === 'insurance'
    ? url('insurance', { $where: between(i.expires, w), $limit: ROW_LIMIT, $order: i.license }, appToken)
    : url('insurance', { $where: `${i.license} = 'NONE'`, $limit: 1 }, appToken);
  return { window: w, notes, urls: { general, insurance } };
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

const licenseOf = (row, f) => String(row[f.license] || '').trim().toUpperCase();
const coverageEnd = (row) => {
  const i = FIELDS.insurance;
  const exp = day(row[i.expires]);
  const can = day(row[i.cancelled]);
  return can && (!exp || can < exp) ? can : exp;
};

/**
 * Join the two result sets. Only active registrations are kept. Returns the candidates and, for insurance
 * reports, the URLs that look for a newer policy on file for any of them (one URL per chunk; always at least one).
 */
function matchCandidates({ query, window, generalRows, insuranceRows, appToken }) {
  const g = FIELDS.general;
  const i = FIELDS.insurance;
  const contractors = new Map();
  let inactive = 0;
  for (const r of generalRows) {
    const lic = licenseOf(r, g);
    if (!lic) continue;
    if (g.status && r[g.status] !== undefined && !ACTIVE.test(String(r[g.status]).trim())) { inactive++; continue; }
    contractors.set(lic, r);
  }
  const candidates = [];
  if (query.report === 'license') {
    for (const [lic, r] of contractors) candidates.push({ license: lic, contractor: r, policies: [] });
  } else {
    const byLicense = new Map();
    for (const p of insuranceRows) {
      const lic = licenseOf(p, i);
      if (!contractors.has(lic)) continue;
      if (!byLicense.has(lic)) byLicense.set(lic, []);
      byLicense.get(lic).push(p);
    }
    for (const [lic, policies] of byLicense) candidates.push({ license: lic, contractor: contractors.get(lic), policies });
  }
  const lics = query.report === 'insurance' ? candidates.map((c) => c.license) : [];
  const renewalUrls = [];
  for (let k = 0; k < lics.length; k += RENEWAL_CHUNK) {
    const chunk = lics.slice(k, k + RENEWAL_CHUNK);
    renewalUrls.push(url('insurance', {
      $where: `upper(${i.license}) in (${chunk.map(quote).join(', ')}) AND ${i.expires} > ${quote(`${window.to}T23:59:59`)}`,
      $limit: ROW_LIMIT,
    }, appToken));
  }
  if (!renewalUrls.length) renewalUrls.push(url('insurance', { $where: `${i.license} = 'NONE'`, $limit: 1 }, appToken));
  return {
    candidates,
    stats: {
      contractorsMatched: contractors.size,
      inactiveSkipped: inactive,
      generalTruncated: generalRows.length >= ROW_LIMIT,
      insuranceTruncated: insuranceRows.length >= ROW_LIMIT,
    },
    renewalUrls,
  };
}

function verifyUrl(contractor) {
  const g = FIELDS.general;
  const ubi = String(contractor[g.ubi] || '').replace(/\D/g, '');
  const lic = String(contractor[g.license] || '').trim();
  return `https://secure.lni.wa.gov/verify/Detail.aspx?UBI=${encodeURIComponent(ubi)}&LIC=${encodeURIComponent(lic)}&SAW=`;
}

/**
 * The checked report rows. For insurance, a contractor is dropped when a policy on file runs past the window
 * (they have already renewed or carry other coverage), and the coverage end is the earlier of expiry and
 * cancellation. Sorted soonest first.
 */
function buildRows({ query, window, candidates, renewalRows = [] }) {
  const g = FIELDS.general;
  const i = FIELDS.insurance;
  const renewed = new Set(renewalRows.filter((p) => !day(p[i.cancelled]) || day(p[i.cancelled]) > window.to).map((p) => licenseOf(p, i)));
  const rows = [];
  let renewedCount = 0;
  for (const c of candidates) {
    const r = c.contractor;
    const base = {
      license: c.license,
      name: String(r[g.name] || '').trim(),
      ubi: String(r[g.ubi] || '').trim(),
      phone: String(r[g.phone] || '').trim(),
      address: [r[g.address], r[g.city], [r[g.state], r[g.zip]].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      city: String(r[g.city] || '').trim(),
      specialties: [...new Set(g.specialties.map((f) => String(r[f] || '').trim()).filter(Boolean))].join('; '),
      licenseExpires: day(r[g.expires]),
      verify: verifyUrl(r),
    };
    if (query.report === 'license') {
      rows.push({ ...base, ends: base.licenseExpires });
      continue;
    }
    if (renewed.has(c.license)) { renewedCount++; continue; }
    const ending = c.policies
      .map((p) => ({ p, end: coverageEnd(p) }))
      .filter((x) => x.end && x.end >= window.from && x.end <= window.to)
      .sort((a, b) => b.end.localeCompare(a.end))[0];
    if (!ending) continue;
    const p = ending.p;
    rows.push({
      ...base,
      ends: ending.end,
      insurer: String(p[i.company] || '').trim(),
      policy: String(p[i.policy] || '').trim(),
      amount: String(p[i.amount] || '').trim(),
      cancelled: day(p[i.cancelled]) && day(p[i.cancelled]) === ending.end,
    });
  }
  rows.sort((a, b) => a.ends.localeCompare(b.ends) || a.name.localeCompare(b.name));
  return { rows, renewedCount };
}

module.exports = { BASE, DATASETS, FIELDS, ROW_LIMIT, windowFor, planQuery, parseRows, matchCandidates, buildRows, verifyUrl, coverageEnd };
