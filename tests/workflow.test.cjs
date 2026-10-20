const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { workflow, json, OUT } = require('../scripts/build-workflow.cjs');

test('the committed workflow matches src/ (run npm run build:workflow)', () => {
  assert.equal(fs.readFileSync(OUT, 'utf8'), json);
});

test('mail only ever goes back to the requester, in their thread', () => {
  const gmail = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.gmail');
  assert.deepEqual(gmail.map((g) => g.name).sort(), ['Draft clarification', 'Draft report reply', 'Send clarification', 'Send report reply']);
  for (const g of gmail.filter((x) => x.parameters.resource === 'draft')) assert.equal(g.parameters.operation, undefined, 'draft defaults to create');
  for (const g of gmail.filter((x) => x.parameters.resource !== 'draft')) {
    assert.equal(g.parameters.operation, 'reply');
    assert.equal(g.parameters.messageId, '={{ $json.messageId }}');
    assert.equal(g.parameters.options.replyToSenderOnly, true);
    assert.equal(g.parameters.options.sendTo, undefined);
  }
  const others = workflow.nodes.filter((n) => /(emailSend|microsoftOutlook|sendGrid|mailgun|smtp)/i.test(n.type));
  assert.deepEqual(others, []);
  assert.ok(!/"operation":\s*"send"/.test(json));
});

test('sending is switched by AUTO_SEND', () => {
  for (const [gate, send, keep] of [['Send report now?', 'Send report reply', 'Draft report reply'], ['Send clarification now?', 'Send clarification', 'Draft clarification']]) {
    const out = workflow.connections[gate].main;
    assert.deepEqual([out[0][0].node, out[1][0].node], [send, keep]);
    assert.match(JSON.stringify(workflow.nodes.find((n) => n.name === gate).parameters), /AUTO_SEND/);
  }
});

test('no credentials or tokens are committed, and only Josh is allowed by default', () => {
  assert.ok(workflow.nodes.every((n) => !n.credentials));
  const settings = workflow.nodes.find((n) => n.name === 'Settings').parameters.assignments.assignments;
  const value = (name) => settings.find((a) => a.name === name).value;
  assert.equal(value('ALLOWED_SENDERS'), 'josh@raeltek.com');
  assert.equal(value('SOCRATA_APP_TOKEN'), '');
  assert.equal(value('REQUIRE_DMARC_PASS'), true);
  assert.equal(value('AUTO_SEND'), true, 'Josh asked for replies to be sent (2026-10-20)');
});

test('every connection points at a real node and every Code node compiles', () => {
  const names = new Set(workflow.nodes.map((n) => n.name));
  assert.equal(names.size, workflow.nodes.length);
  for (const [from, { main }] of Object.entries(workflow.connections)) {
    assert.ok(names.has(from), from);
    for (const out of main) for (const c of out) assert.ok(names.has(c.node), c.node);
  }
  for (const n of workflow.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
    assert.doesNotThrow(() => new Function('$', '$input', '$now', '$json', n.parameters.jsCode), n.name);
    assert.ok(!/require\(/.test(n.parameters.jsCode), n.name);
    assert.ok(!/^module\.exports/m.test(n.parameters.jsCode), n.name);
  }
});

test('every $(node) reference names a real node', () => {
  const names = new Set(workflow.nodes.map((n) => n.name));
  for (const ref of json.matchAll(/\$\('([^']+)'\)/g)) assert.ok(names.has(ref[1]), ref[1]);
});
