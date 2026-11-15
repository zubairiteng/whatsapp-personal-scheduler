/**
 * Secure logging utility that masks phone numbers and prevents exposing
 * private message content, session secrets, or QR raw payload in public logs.
 */

function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return 'unknown';
  const clean = phone.replace(/\D/g, '');
  if (clean.length < 7) return '***';
  return clean.slice(0, 5) + '****' + clean.slice(-3);
}

function sanitizeForLog(data) {
  if (typeof data !== 'object' || data === null) return data;
  const clone = { ...data };
  if (clone.message) {
    clone.message = `[REDACTED_TEXT: ${clone.message.length} chars]`;
  }
  if (clone.recipient) {
    clone.recipient = maskPhone(clone.recipient);
  }
  if (clone.recipient_jid) {
    clone.recipient_jid = maskPhone(clone.recipient_jid.split('@')[0]) + '@c.us';
  }
  if (clone.qr) {
    clone.qr = '[QR_CODE_ACTIVE]';
  }
  if (clone.password) {
    clone.password = '[REDACTED]';
  }
  if (clone.sessionSecret) {
    clone.sessionSecret = '[REDACTED]';
  }
  return clone;
}

function log(level, message, meta = null) {
  const timestamp = new Date().toISOString();
  if (meta) {
    const safeMeta = sanitizeForLog(meta);
    console.log(`[${timestamp}] [${level}] ${message}`, JSON.stringify(safeMeta));
  } else {
    console.log(`[${timestamp}] [${level}] ${message}`);
  }
}

const logger = {
  info: (msg, meta) => log('INFO', msg, meta),
  warn: (msg, meta) => log('WARN', msg, meta),
  error: (msg, meta) => log('ERROR', msg, meta),
  debug: (msg, meta) => {
    if (process.env.DEBUG) log('DEBUG', msg, meta);
  },
  maskPhone,
  sanitizeForLog
};

module.exports = logger;
