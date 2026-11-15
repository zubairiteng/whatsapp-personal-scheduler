const test = require('node:test');
const assert = require('node:assert/strict');
const { initDb, closeDb } = require('../src/db');
const messageModel = require('../src/models/message');

test('Downtime SLA Recovery: messages <= 15m late are claimed; messages > 15m late are marked missed', () => {
  const db = initDb(':memory:');

  try {
    const nowEpoch = Date.now();
    const nowUtc = new Date(nowEpoch).toISOString();

    // Job A: Due 10 minutes ago (within 15m SLA window)
    const tenMinAgoUtc = new Date(nowEpoch - 10 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO messages (recipient, recipient_jid, message, scheduled_at_utc, status, created_at_utc, updated_at_utc)
      VALUES ('923001010101', '923001010101@c.us', 'Job A (10m late)', ?, 'pending', ?, ?)
    `).run(tenMinAgoUtc, nowUtc, nowUtc);

    // Job B: Due 30 minutes ago (>15m SLA window, missed during downtime)
    const thirtyMinAgoUtc = new Date(nowEpoch - 30 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO messages (recipient, recipient_jid, message, scheduled_at_utc, status, created_at_utc, updated_at_utc)
      VALUES ('923002020202', '923002020202@c.us', 'Job B (30m late)', ?, 'pending', ?, ?)
    `).run(thirtyMinAgoUtc, nowUtc, nowUtc);

    // Because Job B was scheduled earlier (30m ago) than Job A (10m ago), FIFO evaluates Job B first
    const claim1 = messageModel.claimNextDueJob(nowUtc, 15, db);
    assert.ok(claim1, 'Job B should be processed by claimNextDueJob');
    assert.equal(claim1.action, 'missed', 'Job B should be flagged as missed because it is >15m overdue');
    assert.equal(claim1.message.recipient, '923002020202');
    assert.equal(claim1.message.status, 'missed');
    assert.match(claim1.message.error_message, /exceeded SLA window/);

    // Now claim next due job: Job A (10m late) is within 15m window -> should be claimed for processing
    const claim2 = messageModel.claimNextDueJob(nowUtc, 15, db);
    assert.ok(claim2, 'Job A should be claimed');
    assert.equal(claim2.action, 'process', 'Job A is within 15m SLA window');
    assert.equal(claim2.message.recipient, '923001010101');
    assert.equal(claim2.message.status, 'processing');
  } finally {
    closeDb();
  }
});
