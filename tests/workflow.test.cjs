const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { workflow, json, OUT } = require('../scripts/build-workflow.cjs');

test('the committed workflow matches src/ (run npm run build:workflow)', () => {
  assert.equal(fs.readFileSync(OUT, 'utf8'), json);
});

test('the only email it sends is the report, as a reply to the inquiry sender', () => {
  const gmail = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.gmail');
  assert.deepEqual(gmail.map((g) => g.name).sort(), ['Draft clarification', 'Send report reply']);
  const send = gmail.find((g) => g.name === 'Send report reply');
  assert.equal(send.parameters.resource, 'message');
  assert.equal(send.parameters.operation, 'reply');
  assert.equal(send.parameters.messageId, '={{ $json.messageId }}');
  assert.equal(send.parameters.options.replyToSenderOnly, true);
  // 2.2 and later reply to a Reply-To header, which the sender controls; 2.1 replies to the checked From address.
  assert.equal(send.typeVersion, 2.1);
  assert.equal(workflow.connections['Reply email'].main[0][0].node, 'Send report reply');
  // Clarifying questions are still drafts.
  const clarify = gmail.find((g) => g.name === 'Draft clarification');
  assert.equal(clarify.parameters.resource, 'draft');
  assert.equal(clarify.parameters.operation, undefined, 'draft defaults to create');
  const others = workflow.nodes.filter((n) => /(emailSend|microsoftOutlook|sendGrid|mailgun|smtp)/i.test(n.type));
  assert.deepEqual(others, []);
  assert.ok(!/"operation":\s*"send"/.test(json));
  assert.equal((json.match(/"operation":\s*"reply"/g) || []).length, 1);
});

test('no credentials or tokens are committed, and only Josh is allowed by default', () => {
  assert.ok(workflow.nodes.every((n) => !n.credentials));
  const settings = workflow.nodes.find((n) => n.name === 'Settings').parameters.assignments.assignments;
  const value = (name) => settings.find((a) => a.name === name).value;
  assert.equal(value('ALLOWED_SENDERS'), 'josh@raeltek.com');
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
