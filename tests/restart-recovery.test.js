const test = require('node:test');
const assert = require('node:assert/strict');
const { initDb, closeDb } = require('../src/db');
const messageModel = require('../src/models/message');

test('Restart Recovery: cleans up stranded processing jobs after unexpected server crash', () => {
  const db = initDb(':memory:');

  try {
    const nowEpoch = Date.now();
    const nowUtc = new Date(nowEpoch).toISOString();

    // Stranded Job 1: Scheduled 2 minutes ago, was being processed when server was killed
    const twoMinAgoUtc = new Date(nowEpoch - 2 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO messages (recipient, recipient_jid, message, scheduled_at_utc, status, created_at_utc, updated_at_utc)
      VALUES ('923005555555', '923005555555@c.us', 'Crash in progress job', ?, 'processing', ?, ?)
    `).run(twoMinAgoUtc, nowUtc, nowUtc);

    // Stranded Job 2: Scheduled 40 minutes ago, server was down for a long time
    const fortyMinAgoUtc = new Date(nowEpoch - 40 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO messages (recipient, recipient_jid, message, scheduled_at_utc, status, created_at_utc, updated_at_utc)
      VALUES ('923006666666', '923006666666@c.us', 'Long downtime crash job', ?, 'processing', ?, ?)
    `).run(fortyMinAgoUtc, nowUtc, nowUtc);

    // Run recovery
    const recoveredCount = messageModel.recoverStaleJobs(nowUtc, 15, db);
    assert.equal(recoveredCount, 2);

    // Verify Job 1 is marked 'uncertain' (preventing duplicate sends without human review)
    const job1 = db.prepare('SELECT * FROM messages WHERE recipient = ?').get('923005555555');
    assert.equal(job1.status, 'uncertain');
    assert.match(job1.error_message, /Server restarted while send was in progress/);

    // Verify Job 2 is marked 'missed' (exceeded 15m overdue window)
    const job2 = db.prepare('SELECT * FROM messages WHERE recipient = ?').get('923006666666');
    assert.equal(job2.status, 'missed');
    assert.match(job2.error_message, /overdue by \d+ minutes/);
  } finally {
    closeDb();
  }
});
