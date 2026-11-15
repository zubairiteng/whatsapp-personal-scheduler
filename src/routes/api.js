const express = require('express');
const router = express.Router();
const messageModel = require('../models/message');
const whatsappManager = require('../whatsapp');
const timezone = require('../utils/timezone');
const logger = require('../utils/logger');
const { getDb } = require('../db');

/**
 * GET /api/status
 * Returns WhatsApp connection status, server timestamps, and message counts.
 */
router.get('/status', (req, res) => {
  const wsStatus = whatsappManager.getStatus();
  const nowUtc = timezone.nowUtcIso();
  const karachiTime = timezone.utcToKarachiParts(nowUtc);

  // Quick stats query
  const db = getDb();
  let stats = {
    pending: 0,
    processing: 0,
    sent: 0,
    uncertain: 0,
    missed: 0,
    failed: 0,
    cancelled: 0,
    total: 0
  };

  try {
    const rows = db.prepare('SELECT status, COUNT(*) as count FROM messages GROUP BY status').all();
    for (const r of rows) {
      if (stats[r.status] !== undefined) {
        stats[r.status] = r.count;
      }
      stats.total += r.count;
    }
  } catch (err) {
    logger.error('Failed to query message stats:', { error: err.message });
  }

  res.json({
    success: true,
    whatsapp: wsStatus,
    serverTime: {
      utc: nowUtc,
      karachiFormatted: karachiTime.formatted,
      karachiIso: karachiTime.isoPkt
    },
    stats
  });
});

/**
 * GET /api/qr
 * Returns QR code image data URL (only accessible after login).
 */
router.get('/qr', (req, res) => {
  const qrDataUrl = whatsappManager.getQrCodeDataUrl();
  const status = whatsappManager.getStatus();

  res.json({
    success: true,
    status: status.status,
    hasQr: !!qrDataUrl,
    qrDataUrl: qrDataUrl || null,
    qrTimestamp: status.qrTimestamp
  });
});

/**
 * POST /api/whatsapp/reconnect
 * Destroys existing client and triggers new initialization / QR scan.
 */
router.post('/whatsapp/reconnect', async (req, res) => {
  logger.info('User requested WhatsApp client reconnection.');
  try {
    await whatsappManager.destroy();
    whatsappManager.initialize();
    res.json({ success: true, message: 'WhatsApp reconnect initiated.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/messages
 * Retrieves scheduled messages with optional status filter.
 */
router.get('/messages', (req, res) => {
  try {
    const status = req.query.status || 'all';
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;

    const messages = messageModel.listMessages({ status, limit, offset });
    res.json({ success: true, count: messages.length, messages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/messages
 * Schedules a new message.
 */
router.post('/messages', (req, res) => {
  try {
    const { recipient, message, date, time } = req.body || {};
    const created = messageModel.createMessage({ recipient, message, date, time });
    res.status(201).json({ success: true, message: created });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/messages/:id
 * Retrieves a single message.
 */
router.get('/messages/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const msg = messageModel.getMessageById(id);
    if (!msg) {
      return res.status(404).json({ success: false, error: `Message #${id} not found.` });
    }
    res.json({ success: true, message: msg });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/messages/:id
 * Updates a pending scheduled message.
 */
router.put('/messages/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { recipient, message, date, time } = req.body || {};
    const updated = messageModel.updateMessage(id, { recipient, message, date, time });
    res.json({ success: true, message: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/messages/:id/cancel
 * Cancels a pending scheduled message.
 */
router.post('/messages/:id/cancel', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const cancelled = messageModel.cancelMessage(id);
    res.json({ success: true, message: cancelled });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/messages/:id
 * Deletes a message from database.
 */
router.delete('/messages/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    messageModel.deleteMessage(id);
    res.json({ success: true, message: `Message #${id} deleted successfully.` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/messages/:id/reschedule
 * Re-schedules an uncertain, missed, or failed message as a new pending job.
 */
router.post('/messages/:id/reschedule', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = messageModel.getMessageById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: `Message #${id} not found.` });
    }

    const { date, time } = req.body || {};
    if (!date || !time) {
      return res.status(400).json({ success: false, error: 'New date and time are required for rescheduling.' });
    }

    const created = messageModel.createMessage({
      recipient: existing.recipient,
      message: existing.message,
      date,
      time
    });

    res.status(201).json({ success: true, message: created });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
