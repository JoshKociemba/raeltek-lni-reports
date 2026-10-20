// Turn a free-text request ("plumbing companies whose insurance expires in the next 14 days") into a query.
// The local model only fills in a small JSON form; everything it says is checked and clamped here.

// Trades people ask for, and the text to look for in L&I's specialty descriptions (upper case, matched as
// substrings, so "PLUMB" finds "PLUMBING"). An unknown trade falls back to its own name.
const TRADES = {
  plumbing: ['PLUMB'],
  electrical: ['ELECTRIC'],
  hvac: ['HVAC', 'HEATING', 'AIR COND', 'VENTILAT', 'REFRIGERAT'],
  roofing: ['ROOF'],
  painting: ['PAINT'],
  landscaping: ['LANDSCAP'],
  concrete: ['CONCRETE'],
  excavation: ['EXCAVAT'],
  fencing: ['FENC'],
  flooring: ['FLOOR', 'CARPET', 'TILE'],
  drywall: ['DRYWALL'],
  masonry: ['MASON'],
  siding: ['SIDING'],
  gutters: ['GUTTER'],
  windows: ['WINDOW', 'GLAZ'],
  insulation: ['INSULAT'],
  carpentry: ['CARPENT', 'FRAMING'],
  cabinets: ['CABINET'],
  demolition: ['DEMOLI'],
  septic: ['SEPTIC'],
  'well drilling': ['WELL'],
  'general contractor': ['GENERAL'],
};

const ALIASES = {
  plumber: 'plumbing', plumbers: 'plumbing', electrician: 'electrical', electricians: 'electrical',
  heating: 'hvac', 'air conditioning': 'hvac', 'heating and cooling': 'hvac', roofer: 'roofing', roofers: 'roofing',
  painter: 'painting', painters: 'painting', landscaper: 'landscaping', landscapers: 'landscaping',
  fence: 'fencing', floors: 'flooring', carpet: 'flooring', tile: 'flooring', mason: 'masonry', gutter: 'gutters',
  window: 'windows', carpenter: 'carpentry', framing: 'carpentry', cabinet: 'cabinets', demo: 'demolition',
  general: 'general contractor', 'general contractors': 'general contractor', gc: 'general contractor',
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

function tradeTerms(trade) {
  const t = String(trade || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/ (contractors?|companies|company|businesses|services?)$/, '');
  if (!t) return null;
  const key = TRADES[t] ? t : ALIASES[t] || (TRADES[t.replace(/s$/, '')] ? t.replace(/s$/, '') : null);
  if (key) return { trade: key, terms: TRADES[key] };
  // Unknown trade: search for its first word's stem, e.g. "asphalt paving" looks for "ASPHALT".
  const stem = t.split(' ')[0].toUpperCase().replace(/(ING|ERS|ER|S)$/, '');
  return stem.length >= 4 ? { trade: t, terms: [stem] } : null;
}

const place = (s) => String(s || '').replace(/,?\s*(wa|washington)\.?$/i, '').replace(/\s+county$/i, '').trim().toUpperCase();

/**
 * Check the model's answer. Returns { clear: true, query } or { clear: false, question } for a clarifying reply.
 * Days are clamped to 1..maxDays.
 */
function parseUnderstanding({ ollama, defaultDays = 14, maxDays = 90 }) {
  let a;
  try {
    if (ollama && ollama.error) throw new Error(ollama.error.message || ollama.error);
    a = JSON.parse(ollama.message.content);
  } catch (err) {
    return { clear: false, error: `Could not read the request: ${err.message}`, question: '' };
  }
  if (!a.understood || !REPORTS[a.report]) {
    return { clear: false, question: String(a.clarifying_question || '').trim().slice(0, 500) };
  }
  const days = Math.min(Math.max(Math.round(Number(a.days) || defaultDays), 1), maxDays);
  const trades = (Array.isArray(a.trades) ? a.trades : []).map(tradeTerms).filter(Boolean);
  const list = (v) => [...new Set((Array.isArray(v) ? v : []).map(place).filter(Boolean))].slice(0, 10);
  return {
    clear: true,
    query: {
      report: a.report,
      days,
      trades: trades.map((t) => t.trade),
      terms: [...new Set(trades.flatMap((t) => t.terms))],
      cities: list(a.cities),
      counties: list(a.counties),
      daysCapped: Number(a.days) > maxDays,
    },
  };
}

/** One line for the report and email, e.g. "Plumbing contractors whose liability insurance expires in the next 14 days". */
function describeQuery(q) {
  const who = q.trades.length ? `${q.trades.map((t) => t[0].toUpperCase() + t.slice(1)).join(', ')} contractors` : 'Contractors';
  const where = [...q.cities.map((c) => titleCase(c)), ...q.counties.map((c) => `${titleCase(c)} County`)];
  const what = q.report === 'insurance' ? 'liability insurance expires' : 'contractor registration expires';
  return `${who}${where.length ? ` in ${where.join(', ')}` : ''} whose ${what} in the next ${q.days} day${q.days === 1 ? '' : 's'}`;
}

const titleCase = (s) => String(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

module.exports = { TRADES, REPORTS, UNDERSTAND_SCHEMA, understandPrompt, understandRequest, tradeTerms, parseUnderstanding, describeQuery, titleCase };
