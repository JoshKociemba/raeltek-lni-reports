// Turn a free-text request ("plumbing companies whose insurance expires in the next 14 days") into a query.
// The local model only fills in a small JSON form; everything it says is checked and clamped here.

// Trades people ask for, as L&I license filters: a license type (CC construction, PC plumbing, EC electrical,
// LC elevator) and, optionally, specialty codes. Codes repeat across types (01 is GENERAL for CC but JOURNEY
// LEVEL for PC), so a code always goes with its type. Codes are from docs/datasets.md.
const TRADES = {
  // CC specialty AD (PLUMBING) is a legacy code with no active registrations, so plumbing is the PC license only.
  plumbing: [{ type: 'PC' }],
  electrical: [{ type: 'EC' }],
  elevator: [{ type: 'LC' }],
  hvac: [{ type: 'CC', codes: ['SM'] }, { type: 'EC', codes: ['6A', '6B'] }],
  roofing: [{ type: 'CC', codes: ['CD'] }],
  painting: [{ type: 'CC', codes: ['CB'] }],
  landscaping: [{ type: 'CC', codes: ['BW'] }],
  concrete: [{ type: 'CC', codes: ['BI'] }],
  excavation: [{ type: 'CC', codes: ['SI'] }],
  fencing: [{ type: 'CC', codes: ['BN'] }],
  flooring: [{ type: 'CC', codes: ['SK', 'RE'] }],
  drywall: [{ type: 'CC', codes: ['BK'] }],
  masonry: [{ type: 'CC', codes: ['BZ'] }],
  siding: [{ type: 'CC', codes: ['SW'] }],
  gutters: [{ type: 'CC', codes: ['CV'] }],
  windows: [{ type: 'CC', codes: ['BP', 'RH'] }],
  insulation: [{ type: 'CC', codes: ['SO'] }],
  carpentry: [{ type: 'CC', codes: ['SL', 'SB'] }],
  cabinets: [{ type: 'CC', codes: ['SB'] }],
  demolition: [{ type: 'CC', codes: ['SF'] }],
  'side sewer': [{ type: 'CC', codes: ['SU'] }],
  'well drilling': [{ type: 'CC', codes: ['WD'] }],
  'tree service': [{ type: 'CC', codes: ['RF'] }],
  'pressure washing': [{ type: 'CC', codes: ['PW'] }],
  handyman: [{ type: 'CC', codes: ['HM'] }],
  paving: [{ type: 'CC', codes: ['SS'] }],
  'garage doors': [{ type: 'CC', codes: ['OG'] }],
  pools: [{ type: 'CC', codes: ['RB'] }],
  'pest control': [{ type: 'CC', codes: ['SZ'] }],
  welding: [{ type: 'CC', codes: ['RI'] }],
  'fire protection': [{ type: 'CC', codes: ['BO'] }],
  irrigation: [{ type: 'CC', codes: ['BV'] }],
  'drain cleaning': [{ type: 'CC', codes: ['RK'] }],
  asbestos: [{ type: 'CC', codes: ['XX'] }],
  signs: [{ type: 'CC', codes: ['SX'] }, { type: 'EC', codes: ['04'] }],
  'general contractor': [{ type: 'CC', codes: ['01'] }],
};

const ALIASES = {
  plumber: 'plumbing', plumbers: 'plumbing', electrician: 'electrical', electricians: 'electrical',
  heating: 'hvac', 'air conditioning': 'hvac', 'heating and cooling': 'hvac', roofer: 'roofing', roofers: 'roofing',
  painter: 'painting', painters: 'painting', landscaper: 'landscaping', landscapers: 'landscaping',
  fence: 'fencing', floors: 'flooring', carpet: 'flooring', tile: 'flooring', mason: 'masonry', gutter: 'gutters',
  window: 'windows', carpenter: 'carpentry', framing: 'carpentry', cabinet: 'cabinets', demo: 'demolition',
  general: 'general contractor', 'general contractors': 'general contractor', gc: 'general contractor',
  'heating and air': 'hvac', 'tree removal': 'tree service', tree: 'tree service', arborist: 'tree service',
  'septic': 'side sewer', sewer: 'side sewer', pool: 'pools', 'pest': 'pest control', glass: 'windows', glazing: 'windows',
  'garage door': 'garage doors', 'pressure washer': 'pressure washing', 'power washing': 'pressure washing',
  sprinkler: 'irrigation', drywaller: 'drywall', 'concrete contractor': 'concrete', excavator: 'excavation',
};

const REPORTS = {
  insurance: 'liability insurance expiring',
  license: 'contractor registration expiring',
};

const UNDERSTAND_SCHEMA = {
  type: 'object',
  properties: {
    understood: { type: 'boolean' },
    report: { type: 'string', enum: Object.keys(REPORTS) },
    trades: { type: 'array', items: { type: 'string' } },
    days: { type: 'integer' },
    cities: { type: 'array', items: { type: 'string' } },
    counties: { type: 'array', items: { type: 'string' } },
    clarifying_question: { type: 'string' },
  },
  required: ['understood', 'report', 'trades', 'days', 'cities', 'counties', 'clarifying_question'],
};

function understandPrompt(request, defaultDays) {
  return `You read requests for reports about Washington State contractors, using Washington L&I contractor data.
Fill in the JSON form for the request below. Use only what the request says.

- report: "insurance" if they ask about insurance expiring or lapsing; "license" if they ask about a contractor
  license or registration expiring. Bonds are not available; for a bond request set understood to false.
- trades: the trades they name, in plain words (e.g. "plumbing", "roofing"). Empty if they want every trade.
- days: how many days ahead to look. "next two weeks" is 14, "this month" is 30. If they give none, use ${defaultDays}.
- cities and counties: only places they name, without "WA" or "County". Empty if none.
- All data is Washington State, so never ask which state, and never ask to confirm what the request already says.
- understood: false only if you cannot tell what report they want. Then write one short clarifying_question
  to send back to them; otherwise clarifying_question is "".

Request:
"""
${String(request).slice(0, 2000)}
"""`;
}

function understandRequest({ request, model, defaultDays = 14 }) {
  return {
    model: model || 'qwen3:4b',
    messages: [{ role: 'user', content: understandPrompt(request, defaultDays) }],
    format: UNDERSTAND_SCHEMA,
    think: false,
    stream: false,
    options: { temperature: 0 },
  };
}

function tradeFilters(trade) {
  const t = String(trade || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/ (contractors?|companies|company|businesses|services?)$/, '');
  if (!t) return null;
  const key = TRADES[t] ? t : ALIASES[t] || (TRADES[t.replace(/s$/, '')] ? t.replace(/s$/, '') : null);
  if (key) return { trade: key, filters: TRADES[key] };
  // Unknown trade: look for its first word's stem in construction specialty names, e.g. "stucco" finds nothing,
  // "sandblasting" finds "Sandblasting".
  const stem = t.split(' ')[0].toUpperCase().replace(/(ING|ERS|ER|S)$/, '');
  return stem.length >= 4 ? { trade: t, filters: [{ type: 'CC', like: stem }] } : null;
}

const place = (s) => String(s || '').replace(/,?\s*(wa|washington)\.?$/i, '').replace(/\s+county$/i, '').trim().toUpperCase();

/**
 * Check the model's answer. Returns { clear: true, query } or { clear: false, question } for a clarifying reply.
 * Days are clamped to 1..maxDays.
 */
const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, sixty: 60, ninety: 90 };

/**
 * Plain-wording rules that run before the model, so a clear request ("plumbers with insurance expiring in 14
 * days") never depends on its judgment. Returns what the wording settles; the model fills in the rest.
 */
function ruleParse(request) {
  const t = ` ${String(request || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ')} `;
  const out = { report: null, days: null, trades: [], limit: null };
  if (/ bond/.test(t)) out.report = 'bond';
  else if (/ (insur|coverage|liabilit|policy|policies )/.test(t)) out.report = 'insurance';
  else if (/ (licen[cs]|registration|registered|registrations )/.test(t)) out.report = 'license';
  const m = t.match(/ (\d+|[a-z]+) (day|days|week|weeks|month|months) /);
  const n = m && (/^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]]);
  if (/ week or (two|2) | couple (of )?weeks /.test(t)) out.days = 14;
  else if (n) out.days = n * (m[2].startsWith('week') ? 7 : m[2].startsWith('month') ? 30 : 1);
  else if (/ (this|next|the coming) month /.test(t)) out.days = 30;
  else if (/ (this|next) week /.test(t)) out.days = 7;
  // Longest names first, so "general contractor" wins over "general".
  const names = [...Object.keys(TRADES), ...Object.keys(ALIASES)].sort((x, y) => y.length - x.length);
  let rest = t;
  for (const name of names) {
    if (rest.includes(` ${name} `) || rest.includes(` ${name}s `)) {
      const f = tradeFilters(name);
      if (f && !out.trades.includes(f.trade)) out.trades.push(f.trade);
      rest = rest.split(` ${name} `).join(' ').split(` ${name}s `).join(' ');
    }
  }
  // "5 painters", "a list of 10 roofing companies", "top 3": a count right before who they want caps the list.
  // Words between the count and the noun are adjectives ("5 local painting companies"), never units or links.
  const filler = '(?:days?|weeks?|months?|years?|for|in|with|of|whose|that|who|and|or|to|from|by|at|on) ';
  const nouns = [...names, 'contractor', 'compan', 'business', 'result', 'name', 'firm', 'licensee']
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const c = t.match(new RegExp(` (?:top |first )?(\\d+|${Object.keys(NUMBER_WORDS).filter((w) => !['a', 'an'].includes(w)).join('|')}) (?:(?!${filler})[a-z]+ ){0,2}?(?:${nouns})`))
    || t.match(/ (?:top|first) (\d+|[a-z]+) (?!days? |weeks? |months? )/);
  const count = c && (/^\d+$/.test(c[1]) ? Number(c[1]) : NUMBER_WORDS[c[1]]);
  if (count > 0) out.limit = count;
  return out;
}

/**
 * Combine the wording rules with the model's answer. Returns { clear: true, query } or { clear: false, question }
 * for a clarifying reply. When the rules settle the report type, the model can't turn it into a question, and a
 * model that's down or returns nonsense only costs the cities.
 */
function parseUnderstanding({ ollama, request = '', defaultDays = 14, maxDays = 90, maxRows = 300 }) {
  const rules = ruleParse(request);
  if (rules.report === 'bond') {
    return { clear: false, question: "Bond reports aren't available yet. Would an insurance or contractor registration report help instead?" };
  }
  let a = null;
  let modelError = '';
  try {
    if (ollama && ollama.error) throw new Error(ollama.error.message || ollama.error);
    a = JSON.parse(ollama.message.content);
  } catch (err) {
    modelError = err.message;
  }
  if (!rules.report) {
    if (!a) return { clear: false, error: `Could not read the request: ${modelError}`, question: '' };
    if (!a.understood || !REPORTS[a.report]) return { clear: false, question: String(a.clarifying_question || '').trim().slice(0, 500) };
  }
  a = a || {};
  const report = rules.report || a.report;
  const askedDays = rules.days || Number(a.days) || defaultDays;
  const days = Math.min(Math.max(Math.round(askedDays), 1), maxDays);
  const tradeNames = rules.trades.length ? rules.trades : (Array.isArray(a.trades) ? a.trades : []);
  const trades = tradeNames.map(tradeFilters).filter(Boolean);
  const list = (v) => [...new Set((Array.isArray(v) ? v : []).map(place).filter(Boolean))].slice(0, 10);
  return {
    clear: true,
    query: {
      report,
      days,
      trades: trades.map((t) => t.trade),
      filters: trades.flatMap((t) => t.filters),
      cities: list(a.cities),
      counties: list(a.counties),
      daysCapped: askedDays > maxDays,
      limit: rules.limit ? Math.min(rules.limit, maxRows) : null,
    },
  };
}

/** One line for the report and email, e.g. "Plumbing contractors whose liability insurance expires in the next 14 days". */
function describeQuery(q) {
  const who = q.trades.length ? `${q.trades.map((t) => t[0].toUpperCase() + t.slice(1)).join(', ')} contractors` : 'Contractors';
  const where = [...q.cities.map((c) => titleCase(c)), ...q.counties.map((c) => `${titleCase(c)} County`)];
  const what = q.report === 'insurance' ? 'insurance on file with L&I expires' : 'contractor registration expires';
  const lead = q.limit ? `The ${q.limit} ${who.charAt(0).toLowerCase()}${who.slice(1)}` : who;
  return `${lead}${where.length ? ` in ${where.join(', ')}` : ''} whose ${what}${q.limit ? ' soonest' : ''} in the next ${q.days} day${q.days === 1 ? '' : 's'}`;
}

const titleCase = (s) => String(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

module.exports = { TRADES, REPORTS, UNDERSTAND_SCHEMA, understandPrompt, understandRequest, tradeFilters, ruleParse, parseUnderstanding, describeQuery, titleCase };
