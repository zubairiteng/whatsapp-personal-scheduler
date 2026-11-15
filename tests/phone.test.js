const test = require('node:test');
const assert = require('node:assert/strict');
const phoneUtil = require('../src/utils/phone');

test('Phone normalization: international numbers with varied formatting', () => {
  // Standard Pakistan international
  assert.equal(phoneUtil.normalizePhoneNumber('923001234567'), '923001234567');

  // With leading '+'
  assert.equal(phoneUtil.normalizePhoneNumber('+923001234567'), '923001234567');

  // With spaces, dashes, parentheses
  assert.equal(phoneUtil.normalizePhoneNumber('+92 (300) 123-4567'), '923001234567');

  // Local Pakistan format '03001234567' -> '923001234567'
  assert.equal(phoneUtil.normalizePhoneNumber('03001234567'), '923001234567');

  // Other countries: US (+1), UK (+44), UAE (+971)
  assert.equal(phoneUtil.normalizePhoneNumber('+1 (415) 555-2671'), '14155552671');
  assert.equal(phoneUtil.normalizePhoneNumber('+44 7911 123456'), '447911123456');
  assert.equal(phoneUtil.normalizePhoneNumber('+971 50 123 4567'), '971501234567');
});

test('WhatsApp JID generation', () => {
  assert.equal(phoneUtil.toWhatsAppJid('923001234567'), '923001234567@c.us');
  assert.equal(phoneUtil.toWhatsAppJid('+92 300 1234567'), '923001234567@c.us');
  assert.equal(phoneUtil.toWhatsAppJid('03001234567'), '923001234567@c.us');
});

test('Phone validation error handling', () => {
  // Too short
  const shortRes = phoneUtil.validatePhoneNumber('12345');
  assert.equal(shortRes.valid, false);
  assert.match(shortRes.error, /Invalid international phone number length/);

  // Too long (>15 digits)
  const longRes = phoneUtil.validatePhoneNumber('1234567890123456789');
  assert.equal(longRes.valid, false);

  // Empty or non-string
  const emptyRes = phoneUtil.validatePhoneNumber('');
  assert.equal(emptyRes.valid, false);

  // Valid number check
  const validRes = phoneUtil.validatePhoneNumber('923001234567');
  assert.equal(validRes.valid, true);
  assert.equal(validRes.normalized, '923001234567');
  assert.equal(validRes.jid, '923001234567@c.us');
});
