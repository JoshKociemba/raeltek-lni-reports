// Decide whether an incoming email is an L&I inquiry from someone on the allowed list, and pull out the request.

const SUBJECT_TAG = '[L&I Inquiry]';

/** One entry per line: a full address (jane@example.com) or a whole domain (@example.com). # starts a comment. */
function parseAllowList(text) {
  return String(text || '')
    .split(/\r?\n|,/)
    .map((l) => l.replace(/#.*/, '').trim().toLowerCase())
    .filter(Boolean);
}

function isAllowed(address, allowList) {
  const a = String(address || '').trim().toLowerCase();
  if (!a.includes('@')) return false;
  const domain = a.slice(a.lastIndexOf('@'));
  return allowList.some((e) => e === a || (e.startsWith('@') && e === domain));
}

/** The n8n Gmail trigger (simple off) gives from as { value: [{ address, name }] }; tests may pass a plain string. */
function senderOf(from) {
  if (from && Array.isArray(from.value) && from.value[0]) {
    return { address: String(from.value[0].address || '').toLowerCase(), name: String(from.value[0].name || '') };
  }
  const s = String((from && from.text) || from || '');
  const m = s.match(/<([^>]+)>/) || s.match(/([^\s<>"]+@[^\s<>"]+)/);
  const address = m ? m[1].toLowerCase() : '';
  const name = s.replace(/<[^>]*>/, '').replace(/"/g, '').trim();
  return { address, name: name.includes('@') ? '' : name };
}

/**
 * The From header is easy to fake, so the allowed list only counts when Google's own check passed: DMARC pass
 * for the sender's domain. Gmail writes this in the top Authentication-Results header.
 */
function dmarcPassed(headers, address) {
  const domain = String(address || '').split('@')[1];
  if (!domain) return false;
  const text = typeof headers === 'string' ? headers : JSON.stringify(headers || {});
  const esc = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`dmarc=pass[^;"]*header\\.from=${esc}`, 'i').test(text);
}

/** Keep the new text of the email: drop quoted replies, "On ... wrote:" blocks and the signature. */
function requestText(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue;
    if (/^On .+wrote:\s*$/.test(line) || /^-{2,}\s*Original Message/i.test(line) || /^From:\s/.test(line) || /^--\s*$/.test(line)) break;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 2000);
}

/**
 * Check one email from the Gmail trigger. Returns { ok: false, reason } to ignore it, or the details the
 * rest of the workflow needs. Ignored emails get no reply, so a stranger learns nothing.
 */
function checkInquiry({ email, allowList, requireDmarc = true }) {
  const subject = String(email.subject || '');
  const sender = senderOf(email.from);
  const base = { subject, sender, threadId: email.threadId || '', messageId: email.id || '' };
  if (!subject.toLowerCase().includes(SUBJECT_TAG.toLowerCase())) return { ...base, ok: false, reason: `Subject lacks ${SUBJECT_TAG}` };
  const list = parseAllowList(allowList);
  if (!isAllowed(sender.address, list)) return { ...base, ok: false, reason: `${sender.address || 'unknown sender'} is not on ALLOWED_SENDERS` };
  if (requireDmarc && !dmarcPassed(email.headers, sender.address)) {
    return { ...base, ok: false, reason: `DMARC did not pass for ${sender.address}; the From address may be forged` };
  }
  const request = requestText(email.text || String(email.html || '').replace(/<[^>]+>/g, ' '));
  if (!request) return { ...base, ok: false, reason: 'Empty request' };
  return { ...base, ok: true, request };
}

module.exports = { SUBJECT_TAG, parseAllowList, isAllowed, senderOf, dmarcPassed, requestText, checkInquiry };
