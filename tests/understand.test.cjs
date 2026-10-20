const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseUnderstanding, tradeFilters, describeQuery, understandRequest } = require('../src/understand.cjs');

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
  assert.deepEqual(u.query, { report: 'insurance', days: 14, trades: ['plumbing'], filters: [{ type: 'PC' }], cities: ['VANCOUVER'], counties: ['CLARK'], daysCapped: false });
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
