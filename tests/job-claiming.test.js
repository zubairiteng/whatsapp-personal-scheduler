const test = require('node:test');
const assert = require('node:assert/strict');
const { initDb, closeDb } = require('../src/db');
const messageModel = require('../src/models/message');

test('Transactional Job Claiming: claims due jobs atomically in FIFO order', () => {
  const db = initDb(':memory:');

  try {
    const nowEpoch = Date.now();
    const nowUtc = new Date(nowEpoch).toISOString();

    // 1. Create a job due 5 minutes ago (eligible)
    const fiveMinAgoUtc = new Date(nowEpoch - 5 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO messages (recipient, recipient_jid, message, scheduled_at_utc, status, created_at_utc, updated_at_utc)
      VALUES ('923001111111', '923001111111@c.us', 'Job 1 (5m ago)', ?, 'pending', ?, ?)
    `).run(fiveMinAgoUtc, nowUtc, nowUtc);

    // 2. Create a job due 2 minutes ago (eligible, but scheduled after Job 1)
    const twoMinAgoUtc = new Date(nowEpoch - 2 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO messages (recipient, recipient_jid, message, scheduled_at_utc, status, created_at_utc, updated_at_utc)
      VALUES ('923002222222', '923002222222@c.us', 'Job 2 (2m ago)', ?, 'pending', ?, ?)
    `).run(twoMinAgoUtc, nowUtc, nowUtc);

    // 3. Create a future job due 10 minutes from now (NOT eligible)
    const tenMinFutureUtc = new Date(nowEpoch + 10 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO messages (recipient, recipient_jid, message, scheduled_at_utc, status, created_at_utc, updated_at_utc)
      VALUES ('923003333333', '923003333333@c.us', 'Job 3 (future)', ?, 'pending', ?, ?)
    `).run(tenMinFutureUtc, nowUtc, nowUtc);

    // First claim: Should return Job 1
    const claim1 = messageModel.claimNextDueJob(nowUtc, 15, db);
    assert.ok(claim1, 'Job 1 should be claimed');
    assert.equal(claim1.action, 'process');
    assert.equal(claim1.message.recipient, '923001111111');
    assert.equal(claim1.message.status, 'processing');

    // Second claim: Should return Job 2
    const claim2 = messageModel.claimNextDueJob(nowUtc, 15, db);
    assert.ok(claim2, 'Job 2 should be claimed');
    assert.equal(claim2.action, 'process');
    assert.equal(claim2.message.recipient, '923002222222');
    assert.equal(claim2.message.status, 'processing');

    // Third claim: Future job is not due -> should return null
    const claim3 = messageModel.claimNextDueJob(nowUtc, 15, db);
    assert.equal(claim3, null, 'Future job should not be claimed yet');

    // Verify database state directly
    const remainingPending = db.prepare("SELECT * FROM messages WHERE status = 'pending'").all();
    assert.equal(remainingPending.length, 1);
    assert.equal(remainingPending[0].recipient, '923003333333');
  } finally {
    closeDb();
  }
});
