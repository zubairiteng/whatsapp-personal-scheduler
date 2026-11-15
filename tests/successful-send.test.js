const test = require('node:test');
const assert = require('node:assert/strict');
const { initDb, closeDb } = require('../src/db');
const { SchedulerEngine } = require('../src/scheduler');

test('Successful Send Execution: sends when ready, updates status to sent, and stores WhatsApp message ID', async () => {
  const db = initDb(':memory:');

  try {
    let sentPayload = null;

    // Mock WhatsApp client simulating successful transmission
    const mockWhatsApp = {
      isReady: () => true,
      sendMessage: async (jid, text) => {
        sentPayload = { jid, text };
        return {
          success: true,
          messageId: 'true_923009999999@c.us_3EB01A2B3C4D5E'
        };
      }
    };

    const scheduler = new SchedulerEngine({
      intervalSeconds: 1,
      overdueWindowMinutes: 15,
      whatsapp: mockWhatsApp,
      db
    });

    const nowEpoch = Date.now();
    const nowUtc = new Date(nowEpoch).toISOString();
    const oneMinAgoUtc = new Date(nowEpoch - 60 * 1000).toISOString();

    // Insert pending due message
    db.prepare(`
      INSERT INTO messages (recipient, recipient_jid, message, scheduled_at_utc, status, created_at_utc, updated_at_utc)
      VALUES ('923009999999', '923009999999@c.us', 'Hello from automated scheduler!', ?, 'pending', ?, ?)
    `).run(oneMinAgoUtc, nowUtc, nowUtc);

    // Execute scheduler tick
    scheduler.isRunning = true;
    await scheduler.tick();

    // Verify WhatsApp was invoked with correct JID and text
    assert.ok(sentPayload);
    assert.equal(sentPayload.jid, '923009999999@c.us');
    assert.equal(sentPayload.text, 'Hello from automated scheduler!');

    // Verify database record
    const record = db.prepare('SELECT * FROM messages WHERE recipient = ?').get('923009999999');
    assert.equal(record.status, 'sent');
    assert.equal(record.whatsapp_message_id, 'true_923009999999@c.us_3EB01A2B3C4D5E');
    assert.ok(record.sent_at_utc);
    assert.equal(record.error_message, null);
  } finally {
    closeDb();
  }
});
