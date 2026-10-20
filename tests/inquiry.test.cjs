const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkInquiry, parseAllowList, isAllowed, requestText, senderOf } = require('../src/inquiry.cjs');

const auth = (domain) => ({ 'authentication-results': `Authentication-Results: mx.google.com; dkim=pass header.i=@${domain}; spf=pass; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=${domain}` });
const email = (over = {}) => ({
  subject: '[L&I Inquiry] plumbers',
  from: { value: [{ address: 'Pat@Example.com', name: 'Pat Smith' }] },
  headers: auth('example.com'),
  text: 'Can you find plumbing companies whose insurance is going to expire in the next 14 days?\n\nThanks\n--\nPat',
  threadId: 't1', id: 'm1',
  ...over,
});

test('allow list takes addresses and whole domains', () => {
  const list = parseAllowList('pat@example.com\n@partner.org  # whole firm\n\n# off@x.com');
  assert.deepEqual(list, ['pat@example.com', '@partner.org']);
  assert.ok(isAllowed('PAT@example.com', list));
  assert.ok(isAllowed('anyone@partner.org', list));
  assert.ok(!isAllowed('anyone@notpartner.org', list));
  assert.ok(!isAllowed('pat@example.com.evil.com', list));
});

test('a whitelisted, authenticated inquiry is accepted with its request text', () => {
  const r = checkInquiry({ email: email(), allowList: 'pat@example.com' });
  assert.equal(r.ok, true);
  assert.equal(r.sender.address, 'pat@example.com');
  assert.equal(r.sender.name, 'Pat Smith');
  assert.match(r.request, /plumbing companies/);
  assert.ok(!/Pat$/.test(r.request), 'signature dropped');
});

test('emails without the tag, from strangers, or failing DMARC are ignored', () => {
  assert.equal(checkInquiry({ email: email({ subject: 'plumbers' }), allowList: 'pat@example.com' }).ok, false);
  assert.equal(checkInquiry({ email: email(), allowList: 'someone@else.com' }).ok, false);
  const forged = checkInquiry({ email: email({ headers: auth('evil.com') }), allowList: 'pat@example.com' });
  assert.equal(forged.ok, false);
  assert.match(forged.reason, /DMARC/);
  assert.equal(checkInquiry({ email: email({ headers: auth('evil.com') }), allowList: 'pat@example.com', requireDmarc: false }).ok, true);
});

test('quoted replies are dropped from the request', () => {
  assert.equal(requestText('Roofers in Camas please\n\nOn Mon, Oct 19, 2026 Josh wrote:\n> old'), 'Roofers in Camas please');
  assert.equal(requestText('> quoted\nnew line'), 'new line');
});

test('sender parsing handles plain From strings', () => {
  assert.deepEqual(senderOf('"Pat Smith" <pat@example.com>'), { address: 'pat@example.com', name: 'Pat Smith' });
  assert.deepEqual(senderOf('pat@example.com'), { address: 'pat@example.com', name: '' });
});
