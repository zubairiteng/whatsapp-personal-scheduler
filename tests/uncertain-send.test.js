const test = require('node:test');
const assert = require('node:assert/strict');
const { initDb, closeDb } = require('../src/db');
const { SchedulerEngine } = require('../src/scheduler');

test('Uncertain Send Handling: flags for review and never resends automatically', async () => {
  const db = initDb(':memory:');

  try {
    let sendCallsCount = 0;

    // Mock WhatsApp client simulating network timeout / unconfirmed delivery
    const mockWhatsApp = {
      isReady: () => true,
      sendMessage: async (jid, text) => {
        sendCallsCount++;
        return {
          success: false,
          uncertain: true,
          error: 'Send confirmation timed out after 25s. Message may have been delivered. Flagged for manual review.'
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
    const twoMinAgoUtc = new Date(nowEpoch - 2 * 60 * 1000).toISOString();

    // Create a due pending job
    db.prepare(`
      INSERT INTO messages (recipient, recipient_jid, message, scheduled_at_utc, status, created_at_utc, updated_at_utc)
      VALUES ('923007777777', '923007777777@c.us', 'Uncertain timeout test message', ?, 'pending', ?, ?)
    `).run(twoMinAgoUtc, nowUtc, nowUtc);

    // Run first tick: should attempt send and mark uncertain
    scheduler.isRunning = true;
    await scheduler.tick();

    assert.equal(sendCallsCount, 1, 'WhatsApp sendMessage should be called once');

    // Check message state in DB
    const record = db.prepare('SELECT * FROM messages WHERE recipient = ?').get('923007777777');
    assert.equal(record.status, 'uncertain', "Status must transition to 'uncertain'");
    assert.match(record.error_message, /timed out/);

    // Run second tick: scheduler must NOT re-attempt or re-send
    await scheduler.tick();
    assert.equal(sendCallsCount, 1, 'WhatsApp sendMessage must NOT be called again for uncertain message');
  } finally {
    closeDb();
  }
});
