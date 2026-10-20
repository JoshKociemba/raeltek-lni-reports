const { test } = require('node:test');
const assert = require('node:assert/strict');
const { REPLY_MARKER, checkInquiry, parseAllowList, isAllowed, requestText, senderOf } = require('../src/inquiry.cjs');

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

test("Josh's own sent mail counts as authenticated, but our own replies are skipped", () => {
  const own = email({ from: { value: [{ address: 'josh@raeltek.com', name: 'Josh' }] }, headers: {}, labelIds: ['SENT', 'INBOX'] });
  assert.equal(checkInquiry({ email: own, allowList: 'josh@raeltek.com', mailbox: 'josh@raeltek.com' }).ok, true);
  assert.equal(checkInquiry({ email: { ...own, labelIds: ['INBOX'] }, allowList: 'josh@raeltek.com', mailbox: 'josh@raeltek.com' }).ok, false, 'a forged From without SENT');
  const reply = { ...own, subject: 'Re: [L&I Inquiry] plumbers', text: `Hi Josh,\n\nHere's the report.\n\nJosh\nRaeltek\n\n${REPLY_MARKER}` };
  const r = checkInquiry({ email: reply, allowList: 'josh@raeltek.com', mailbox: 'josh@raeltek.com' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /own report replies/);
  // The workflow's own sent report: n8n's reply keeps the original subject and sends HTML only.
  const { buildReply } = require('../src/report.cjs');
  const sent = buildReply({ inquiry: { sender: { address: 'josh@raeltek.com', name: 'Josh' }, subject: '[L&I Inquiry] plumbers' }, title: 'Plumbing', count: 3, ollama: null, signature: 'Thanks,' });
  const echo = { ...own, subject: '[L&I Inquiry] plumbers', text: undefined, html: sent.body_html };
  assert.match(checkInquiry({ email: echo, allowList: 'josh@raeltek.com', mailbox: 'josh@raeltek.com' }).reason, /own report replies/);
  const followUp = { ...own, subject: 'Re: [L&I Inquiry] plumbers', text: `Can you do roofers too?\n\nOn Mon, Oct 20, 2026 Josh wrote:\n> ${REPLY_MARKER}` };
  assert.equal(checkInquiry({ email: followUp, allowList: 'josh@raeltek.com', mailbox: 'josh@raeltek.com' }).ok, true);
});
