const { getDb } = require('../db');
const timezone = require('../utils/timezone');
const phoneUtil = require('../utils/phone');
const logger = require('../utils/logger');

/**
 * Normalizes message record with Karachi and UTC display details.
 */
function enrichMessage(row) {
  if (!row) return null;
  const enriched = { ...row };
  try {
    const karachi = timezone.utcToKarachiParts(row.scheduled_at_utc);
    enriched.scheduled_karachi_date = karachi.date;
    enriched.scheduled_karachi_time = karachi.time;
    enriched.scheduled_display = karachi.formatted;
  } catch (e) {
    enriched.scheduled_display = row.scheduled_at_utc;
  }

  if (row.sent_at_utc) {
    try {
      enriched.sent_display = timezone.formatKarachiDisplay(row.sent_at_utc);
    } catch (e) {
      enriched.sent_display = row.sent_at_utc;
    }
  }

  return enriched;
}

/**
 * Creates a new scheduled message.
 */
function createMessage({ recipient, message, date, time }, dbInstance = null) {
  const db = dbInstance || getDb();

  if (!recipient || !message || !date || !time) {
    throw new Error('All fields are required: recipient, message, date, time.');
  }

  const trimmedMsg = message.trim();
  if (trimmedMsg.length === 0) {
    throw new Error('Message cannot be empty.');
  }
  if (trimmedMsg.length > 4096) {
    throw new Error('Message exceeds 4096 characters limit.');
  }

  const phoneValidation = phoneUtil.validatePhoneNumber(recipient);
  if (!phoneValidation.valid) {
    throw new Error(`Invalid phone number: ${phoneValidation.error}`);
  }

  const scheduledAtUtc = timezone.karachiToUtc(date, time);
  const nowUtc = timezone.nowUtcIso();

  const stmt = db.prepare(`
    INSERT INTO messages (
      recipient,
      recipient_jid,
      message,
      scheduled_at_utc,
      status,
      created_at_utc,
      updated_at_utc
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `);

  const result = stmt.run(
    phoneValidation.normalized,
    phoneValidation.jid,
    trimmedMsg,
    scheduledAtUtc,
    nowUtc,
    nowUtc
  );

  const newId = Number(result.lastInsertRowid);
  logger.info(`Scheduled new message #${newId}`, {
    id: newId,
    recipient: phoneValidation.normalized,
    scheduled_at_utc: scheduledAtUtc
  });

  return getMessageById(newId, db);
}

/**
 * Retrieves message by primary key ID.
 */
function getMessageById(id, dbInstance = null) {
  const db = dbInstance || getDb();
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  return enrichMessage(row);
}

/**
 * Lists messages with optional status filter.
 */
function listMessages({ status = null, limit = 100, offset = 0 } = {}, dbInstance = null) {
  const db = dbInstance || getDb();
  let query = 'SELECT * FROM messages';
  const params = [];

  if (status && status !== 'all') {
    query += ' WHERE status = ?';
    params.push(status);
  }

  query += ' ORDER BY scheduled_at_utc DESC, id DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params);
  return rows.map(enrichMessage);
}

/**
 * Updates an existing pending message.
 */
function updateMessage(id, { recipient, message, date, time }, dbInstance = null) {
  const db = dbInstance || getDb();
  const existing = getMessageById(id, db);

  if (!existing) {
    throw new Error(`Message #${id} not found.`);
  }

  if (existing.status !== 'pending') {
    throw new Error(`Cannot edit message in '${existing.status}' status. Only 'pending' messages can be edited.`);
  }

  const trimmedMsg = (message || existing.message).trim();
  const targetRecipient = recipient || existing.recipient;
  const phoneValidation = phoneUtil.validatePhoneNumber(targetRecipient);
  if (!phoneValidation.valid) {
    throw new Error(`Invalid phone number: ${phoneValidation.error}`);
  }

  let scheduledAtUtc = existing.scheduled_at_utc;
  if (date || time) {
    const karachiParts = timezone.utcToKarachiParts(existing.scheduled_at_utc);
    const targetDate = date || karachiParts.date;
    const targetTime = time || karachiParts.time;
    scheduledAtUtc = timezone.karachiToUtc(targetDate, targetTime);
  }

  const nowUtc = timezone.nowUtcIso();

  const stmt = db.prepare(`
    UPDATE messages
    SET recipient = ?,
        recipient_jid = ?,
        message = ?,
        scheduled_at_utc = ?,
        updated_at_utc = ?
    WHERE id = ? AND status = 'pending'
  `);

  const res = stmt.run(
    phoneValidation.normalized,
    phoneValidation.jid,
    trimmedMsg,
    scheduledAtUtc,
    nowUtc,
    id
  );

  if (res.changes === 0) {
    throw new Error(`Failed to update message #${id}. It may no longer be pending.`);
  }

  return getMessageById(id, db);
}

/**
 * Cancels a pending message.
 */
function cancelMessage(id, dbInstance = null) {
  const db = dbInstance || getDb();
  const nowUtc = timezone.nowUtcIso();

  const stmt = db.prepare(`
    UPDATE messages
    SET status = 'cancelled',
        updated_at_utc = ?
    WHERE id = ? AND status = 'pending'
  `);

  const res = stmt.run(nowUtc, id);
  if (res.changes === 0) {
    const existing = getMessageById(id, db);
    if (!existing) throw new Error(`Message #${id} not found.`);
    throw new Error(`Message #${id} cannot be cancelled because its status is '${existing.status}'.`);
  }

  logger.info(`Message #${id} cancelled by user.`);
  return getMessageById(id, db);
}

/**
 * Deletes a message record.
 */
function deleteMessage(id, dbInstance = null) {
  const db = dbInstance || getDb();
  const existing = getMessageById(id, db);
  if (!existing) {
    throw new Error(`Message #${id} not found.`);
  }

  db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  logger.info(`Message #${id} deleted.`);
  return true;
}

/**
 * Atomically claims the earliest due pending job using an immediate SQLite transaction.
 *
 * Implements:
 * - Transactional job claiming (prevents duplicate execution)
 * - Downtime SLA check (Requirement 11: messages <= 15 mins late sent; > 15 mins marked missed)
 *
 * @param {string} nowUtc - Current UTC ISO string
 * @param {number} overdueMinutes - Maximum allowable delay after downtime (default 15)
 * @param {object} dbInstance
 * @returns {object|null} Claimed job details or null if no jobs are due
 */
function claimNextDueJob(nowUtc = timezone.nowUtcIso(), overdueMinutes = 15, dbInstance = null) {
  const db = dbInstance || getDb();

  try {
    db.exec('BEGIN IMMEDIATE;');

    // Find the oldest pending message scheduled on or before nowUtc
    const candidate = db.prepare(`
      SELECT * FROM messages
      WHERE status = 'pending' AND scheduled_at_utc <= ?
      ORDER BY scheduled_at_utc ASC, id ASC
      LIMIT 1
    `).get(nowUtc);

    if (!candidate) {
      db.exec('COMMIT;');
      return null;
    }

    const scheduledEpoch = new Date(candidate.scheduled_at_utc).getTime();
    const currentEpoch = new Date(nowUtc).getTime();
    const delayMinutes = (currentEpoch - scheduledEpoch) / (60 * 1000);

    // Overdue beyond the allowable downtime window (> 15 minutes late)
    if (delayMinutes > overdueMinutes) {
      const errorMsg = `Server downtime/overdue exceeded SLA window (${Math.round(delayMinutes)} minutes late). Flagged as missed for manual review.`;
      db.prepare(`
        UPDATE messages
        SET status = 'missed',
            error_message = ?,
            updated_at_utc = ?
        WHERE id = ? AND status = 'pending'
      `).run(errorMsg, nowUtc, candidate.id);

      db.exec('COMMIT;');
      logger.warn(`Message #${candidate.id} marked as missed (>15m overdue)`, {
        id: candidate.id,
        scheduled_at_utc: candidate.scheduled_at_utc,
        delayMinutes: Math.round(delayMinutes)
      });

      return {
        action: 'missed',
        message: getMessageById(candidate.id, db)
      };
    }

    // Within allowable window: claim job by transitioning to 'processing'
    const updateStmt = db.prepare(`
      UPDATE messages
      SET status = 'processing',
          updated_at_utc = ?
      WHERE id = ? AND status = 'pending'
    `);

    const result = updateStmt.run(nowUtc, candidate.id);
    if (result.changes === 0) {
      // Race condition handled: another worker already claimed it
      db.exec('COMMIT;');
      return null;
    }

    db.exec('COMMIT;');
    logger.info(`Message #${candidate.id} claimed for processing`, {
      id: candidate.id,
      recipient: candidate.recipient
    });

    return {
      action: 'process',
      message: getMessageById(candidate.id, db)
    };
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch (e) {
      // ignore rollback errors if already rolled back
    }
    logger.error('Error in transactional job claiming:', { error: err.message });
    throw err;
  }
}

/**
 * Transitions job to 'sent' status with WhatsApp message ID.
 */
function markJobSent(id, whatsappMessageId, dbInstance = null) {
  const db = dbInstance || getDb();
  const nowUtc = timezone.nowUtcIso();

  db.prepare(`
    UPDATE messages
    SET status = 'sent',
        whatsapp_message_id = ?,
        sent_at_utc = ?,
        error_message = NULL,
        updated_at_utc = ?
    WHERE id = ?
  `).run(whatsappMessageId || null, nowUtc, nowUtc, id);

  logger.info(`Message #${id} successfully sent`, {
    id,
    whatsapp_message_id: whatsappMessageId
  });

  return getMessageById(id, db);
}

/**
 * Transitions job to 'failed' status with definitive error explanation.
 */
function markJobFailed(id, errorMessage, dbInstance = null) {
  const db = dbInstance || getDb();
  const nowUtc = timezone.nowUtcIso();

  db.prepare(`
    UPDATE messages
    SET status = 'failed',
        error_message = ?,
        updated_at_utc = ?
    WHERE id = ?
  `).run(errorMessage || 'Unknown send failure', nowUtc, id);

  logger.error(`Message #${id} marked as failed`, { id, error: errorMessage });
  return getMessageById(id, db);
}

/**
 * Transitions job to 'uncertain' status.
 * Used when network timeout occurs or confirmation is missing.
 * Prevents automatic retry / duplicate sends (Requirement 10).
 */
function markJobUncertain(id, reason, dbInstance = null) {
  const db = dbInstance || getDb();
  const nowUtc = timezone.nowUtcIso();

  db.prepare(`
    UPDATE messages
    SET status = 'uncertain',
        error_message = ?,
        updated_at_utc = ?
    WHERE id = ?
  `).run(reason || 'Send result unconfirmed. Manual review required.', nowUtc, id);

  logger.warn(`Message #${id} marked as UNCERTAIN (manual review required)`, { id, reason });
  return getMessageById(id, db);
}

/**
 * Recovers stranded 'processing' jobs left behind by unexpected crashes or restarts.
 */
function recoverStaleJobs(nowUtc = timezone.nowUtcIso(), overdueMinutes = 15, dbInstance = null) {
  const db = dbInstance || getDb();
  const staleJobs = db.prepare("SELECT * FROM messages WHERE status = 'processing'").all();

  if (staleJobs.length === 0) return 0;

  logger.warn(`Found ${staleJobs.length} stranded 'processing' job(s) from previous server crash.`);

  let recoveredCount = 0;
  for (const job of staleJobs) {
    const scheduledEpoch = new Date(job.scheduled_at_utc).getTime();
    const currentEpoch = new Date(nowUtc).getTime();
    const delayMinutes = (currentEpoch - scheduledEpoch) / (60 * 1000);

    if (delayMinutes > overdueMinutes) {
      markJobFailed(
        job.id,
        `Server crash recovery: Message overdue by ${Math.round(delayMinutes)} minutes (>15m window). Marked as missed.`,
        db
      );
      db.prepare("UPDATE messages SET status = 'missed' WHERE id = ?").run(job.id);
    } else {
      // Within 15m window, but since it was already in 'processing' when killed,
      // WhatsApp might have actually received it! Do not blindly resend. Mark uncertain.
      markJobUncertain(
        job.id,
        'Server restarted while send was in progress. Marked uncertain to prevent duplicate send.',
        db
      );
    }
    recoveredCount++;
  }

  return recoveredCount;
}

module.exports = {
  createMessage,
  getMessageById,
  listMessages,
  updateMessage,
  cancelMessage,
  deleteMessage,
  claimNextDueJob,
  markJobSent,
  markJobFailed,
  markJobUncertain,
  recoverStaleJobs
};
