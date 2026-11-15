/**
 * Phone number normalization and WhatsApp JID formatting.
 * Validates international numbers (e.g. 923001234567) and converts them to WhatsApp JIDs (923001234567@c.us).
 */

/**
 * Normalizes user input phone string into clean international digits.
 * Automatically handles:
 * - Leading '+'
 * - Dashes, spaces, parentheses
 * - Pakistan local numbers starting with '03...' -> converts to '923...'
 * @param {string} input
 * @returns {string} Digits only (e.g. '923001234567')
 */
function normalizePhoneNumber(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('Phone number must be a non-empty string.');
  }

  // Strip all non-digit characters
  let digits = input.trim().replace(/\D/g, '');

  // Local Pakistan format conversion: 03001234567 -> 923001234567
  if (digits.startsWith('03') && digits.length === 11) {
    digits = '92' + digits.slice(1);
  }

  // Basic E.164 length check: min 7 digits, max 15 digits
  if (digits.length < 7 || digits.length > 15) {
    throw new Error(
      `Invalid international phone number length (${digits.length} digits). Expected between 7 and 15 digits with country code (e.g. 923001234567).`
    );
  }

  return digits;
}

/**
 * Formats a phone number into WhatsApp JID (Chat ID).
 * E.g., '923001234567' -> '923001234567@c.us'
 * @param {string} input
 * @returns {string} JID
 */
function toWhatsAppJid(input) {
  const digits = normalizePhoneNumber(input);
  return `${digits}@c.us`;
}

/**
 * Validates whether a phone number string is valid.
 * @param {string} input
 * @returns {{ valid: boolean, error?: string, normalized?: string, jid?: string }}
 */
function validatePhoneNumber(input) {
  try {
    const normalized = normalizePhoneNumber(input);
    const jid = toWhatsAppJid(normalized);
    return { valid: true, normalized, jid };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

module.exports = {
  normalizePhoneNumber,
  toWhatsAppJid,
  validatePhoneNumber
};
