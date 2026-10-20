const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { workflow, json, OUT } = require('../scripts/build-workflow.cjs');

test('the committed workflow matches src/ (run npm run build:workflow)', () => {
  assert.equal(fs.readFileSync(OUT, 'utf8'), json);
});

test('the workflow can only create drafts', () => {
  const gmail = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.gmail');
  assert.equal(gmail.length, 2);
  for (const g of gmail) {
    assert.equal(g.parameters.resource, 'draft');
    assert.equal(g.parameters.operation, undefined, 'draft defaults to create');
  }
  const senders = workflow.nodes.filter((n) => /(gmail|emailSend|microsoftOutlook|sendGrid|mailgun|smtp)/i.test(n.type)
    && n.type !== 'n8n-nodes-base.gmailTrigger' && n.parameters.resource !== 'draft');
  assert.deepEqual(senders, []);
  assert.ok(!/"operation":\s*"(send|reply)"/.test(json));
});

test('no credentials, tokens or sender list are committed', () => {
  assert.ok(workflow.nodes.every((n) => !n.credentials));
  const settings = workflow.nodes.find((n) => n.name === 'Settings').parameters.assignments.assignments;
  const value = (name) => settings.find((a) => a.name === name).value;
  assert.equal(value('ALLOWED_SENDERS'), '');
  assert.equal(value('SOCRATA_APP_TOKEN'), '');
  assert.equal(value('REQUIRE_DMARC_PASS'), true);
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
