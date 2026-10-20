const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ruleParse, parseUnderstanding, tradeFilters, describeQuery, understandRequest } = require('../src/understand.cjs');

const reply = (o) => ({ message: { content: JSON.stringify({ understood: true, report: 'insurance', trades: [], days: 14, cities: [], counties: [], clarifying_question: '', ...o }) } });

test('the Ollama request asks for structured JSON with thinking off', () => {
  const r = understandRequest({ request: 'plumbers', defaultDays: 14 });
  assert.equal(r.think, false);
  assert.equal(r.stream, false);
  assert.ok(r.format.properties.report);
  assert.match(r.messages[0].content, /plumbers/);
});

test('trades map to specialty search terms', () => {
  assert.deepEqual(tradeFilters('plumbers'), { trade: 'plumbing', filters: [{ type: 'PC' }] });
  assert.equal(tradeFilters('Plumbing companies').trade, 'plumbing');
  assert.deepEqual(tradeFilters('roofing contractors'), { trade: 'roofing', filters: [{ type: 'CC', codes: ['CD'] }] });
  assert.equal(tradeFilters('HVAC').trade, 'hvac');
  assert.equal(tradeFilters('tree removal').trade, 'tree service');
  assert.deepEqual(tradeFilters('sandblasting'), { trade: 'sandblasting', filters: [{ type: 'CC', like: 'SANDBLAST' }] });
  assert.equal(tradeFilters(''), null);
});

test('the example request becomes a query', () => {
  const u = parseUnderstanding({ ollama: reply({ trades: ['plumbing'], cities: ['Vancouver, WA'], counties: ['Clark County'] }) });
  assert.equal(u.clear, true);
  assert.deepEqual(u.query, { report: 'insurance', days: 14, trades: ['plumbing'], filters: [{ type: 'PC' }], cities: ['VANCOUVER'], counties: ['CLARK'], daysCapped: false, limit: null });
  assert.equal(describeQuery(u.query), 'Plumbing contractors in Vancouver, Clark County whose insurance on file with L&I expires in the next 14 days');
});

test('days are clamped and bad answers ask for clarification', () => {
  assert.equal(parseUnderstanding({ ollama: reply({ days: 400 }), maxDays: 90 }).query.days, 90);
  assert.equal(parseUnderstanding({ ollama: reply({ days: 0 }) }).query.days, 14);
  const unclear = parseUnderstanding({ ollama: reply({ understood: false, clarifying_question: 'Which trade?' }) });
  assert.deepEqual(unclear, { clear: false, question: 'Which trade?' });
  assert.equal(parseUnderstanding({ ollama: reply({ report: 'bond' }) }).clear, false);
  assert.match(parseUnderstanding({ ollama: { error: 'connection refused' } }).error, /connection refused/);
});

test("Josh's first real request is understood even when the model asks a needless question", () => {
  const request = 'Can you send me a list of plumbers with insurance expiring in 14 days?\n\nThanks,\nJosh';
  const confused = reply({ understood: false, clarifying_question: 'Do you mean plumbers who are licensed in Washington State?' });
  const u = parseUnderstanding({ ollama: confused, request });
  assert.equal(u.clear, true);
  assert.deepEqual([u.query.report, u.query.days, u.query.trades], ['insurance', 14, ['plumbing']]);
  // Works with Ollama down, too.
  assert.equal(parseUnderstanding({ ollama: { error: 'connection refused' }, request }).clear, true);
});

test('wording rules read report type, window and trades', () => {
  assert.deepEqual(ruleParse('roofers and electricians whose license expires in the next two weeks'), { report: 'license', days: 14, trades: ['electrical', 'roofing'], limit: null });
  assert.deepEqual(ruleParse('general contractors with coverage lapsing this month'), { report: 'insurance', days: 30, trades: ['general contractor'], limit: null });
  assert.deepEqual(ruleParse('HVAC companies, insurance, 3 weeks'), { report: 'insurance', days: 21, trades: ['hvac'], limit: null });
  assert.equal(ruleParse('bonds expiring soon').report, 'bond');
  assert.deepEqual(ruleParse('hello there'), { report: null, days: null, trades: [], limit: null });
});

test('the model still supplies cities, and wording wins on days and trades', () => {
  const u = parseUnderstanding({ ollama: reply({ trades: ['roofing'], days: 30, cities: ['Vancouver'] }), request: 'plumbers in Vancouver, insurance in 14 days' });
  assert.deepEqual([u.query.trades, u.query.days, u.query.cities], [['plumbing'], 14, ['VANCOUVER']]);
});

test('a bond request gets a fixed clarifying reply', () => {
  const u = parseUnderstanding({ ollama: reply({}), request: 'plumbers whose bond expires in 14 days' });
  assert.equal(u.clear, false);
  assert.match(u.question, /Bond reports aren't available/);
});

test('a count in the request caps the list, and units or links never count', () => {
  const josh = ruleParse('Can you help me find a list of 5 painters whose insurance is going to expire in the next week or two?');
  assert.deepEqual(josh, { report: 'insurance', days: 14, trades: ['painting'], limit: 5 });
  assert.equal(ruleParse('top 10 roofing companies, insurance, 3 weeks').limit, 10);
  assert.equal(ruleParse('ten electricians whose license expires this month').limit, 10);
  assert.equal(ruleParse('5 local painting companies, insurance, 14 days').limit, 5);
  assert.equal(ruleParse('insurance in the next 14 days for contractors in Vancouver').limit, null);
  assert.equal(ruleParse('plumbers insurance expiring in the first 14 days').limit, null);
  assert.equal(ruleParse('Within 30 days, which plumbing contractors have insurance expiring').limit, null);
  const u = parseUnderstanding({ ollama: reply({}), request: 'list of 500 painters, insurance, 14 days', maxRows: 300 });
  assert.equal(u.query.limit, 300);
  assert.equal(describeQuery({ ...u.query, limit: 5 }), 'The 5 painting contractors whose insurance on file with L&I expires soonest in the next 14 days');
});
