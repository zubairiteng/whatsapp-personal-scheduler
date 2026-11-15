const config = require('./config');
const logger = require('./utils/logger');
const timezone = require('./utils/timezone');
const messageModel = require('./models/message');
const whatsappManager = require('./whatsapp');

class SchedulerEngine {
  constructor(options = {}) {
    this.intervalSeconds = options.intervalSeconds || config.checkIntervalSeconds;
    this.overdueWindowMinutes = options.overdueWindowMinutes || config.overdueWindowMinutes;
    this.whatsapp = options.whatsapp || whatsappManager;
    this.db = options.db || null;
    this.timer = null;
    this.isRunning = false;
    this.isTickProcessing = false;
  }

  /**
   * Starts the background scheduler loop.
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    logger.info(`Starting Scheduler Engine (interval: ${this.intervalSeconds}s, overdue SLA: ${this.overdueWindowMinutes}m)...`);

    // Run crash recovery on startup to catch stranded 'processing' jobs
    try {
      const recovered = messageModel.recoverStaleJobs(timezone.nowUtcIso(), this.overdueWindowMinutes, this.db);
      if (recovered > 0) {
        logger.info(`Startup recovery completed: ${recovered} stale job(s) handled.`);
      }
    } catch (err) {
      logger.error('Error during startup job recovery:', { error: err.message });
    }

    // Schedule periodic tick
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        logger.error('Unhandled exception during scheduler tick:', { error: err.message });
      });
    }, this.intervalSeconds * 1000);

    // Run first tick immediately
    setImmediate(() => {
      this.tick().catch((err) => {
        logger.error('Initial scheduler tick error:', { error: err.message });
      });
    });
  }

  /**
   * Single scheduler execution tick.
   * Guarantees only one active sender loop runs at a time.
   */
  async tick() {
    if (!this.isRunning || this.isTickProcessing) {
      return;
    }

    this.isTickProcessing = true;

    try {
      // Send messages ONLY when WhatsApp is connected and ready
      if (!this.whatsapp.isReady()) {
        logger.debug('Scheduler tick skipped: WhatsApp client is not in READY state.');
        return;
      }

      // Process due jobs one by one with transactional claiming
      let hasMore = true;
      while (hasMore && this.isRunning) {
        const nowUtc = timezone.nowUtcIso();
        const claimed = messageModel.claimNextDueJob(nowUtc, this.overdueWindowMinutes, this.db);

        if (!claimed) {
          // No due jobs waiting
          hasMore = false;
          break;
        }

        const { action, message } = claimed;

        // If the job was older than 15 minutes, it has already been marked as 'missed'
        if (action === 'missed') {
          logger.warn(`Job #${message.id} marked as missed (>15m overdue after downtime).`, {
            id: message.id,
            scheduled_at_utc: message.scheduled_at_utc
          });
          // Continue to check if there are other queued jobs
          continue;
        }

        if (action === 'process') {
          await this._executeSend(message);
          // Small pause between messages to protect account health
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    } finally {
      this.isTickProcessing = false;
    }
  }

  /**
   * Dispatches message send via WhatsApp and records status.
   */
  async _executeSend(message) {
    logger.info(`Dispatching scheduled message #${message.id} to recipient...`, {
      id: message.id,
      recipient: message.recipient
    });

    try {
      const sendResult = await this.whatsapp.sendMessage(message.recipient_jid, message.message);

      if (sendResult.success) {
        messageModel.markJobSent(message.id, sendResult.messageId, this.db);
        logger.info(`Message #${message.id} successfully delivered!`, {
          id: message.id,
          whatsapp_message_id: sendResult.messageId
        });
      } else if (sendResult.uncertain) {
        // Requirement 10: Do NOT promise exactly-once delivery.
        // If send result is uncertain, flag it for manual review instead of resending.
        messageModel.markJobUncertain(message.id, sendResult.error, this.db);
        logger.warn(`Message #${message.id} flagged as UNCERTAIN: ${sendResult.error}`);
      } else {
        // Definitive failure
        messageModel.markJobFailed(message.id, sendResult.error, this.db);
        logger.error(`Message #${message.id} failed definitively: ${sendResult.error}`);
      }
    } catch (unexpectedErr) {
      // Fatal execution exception during send -> flag as uncertain to avoid blind resend
      messageModel.markJobUncertain(
        message.id,
        `Unexpected error during dispatch: ${unexpectedErr.message}. Flagged for review.`,
        this.db
      );
      logger.error(`Exception dispatching message #${message.id}:`, { error: unexpectedErr.message });
    }
  }

  /**
   * Stops the scheduler.
   */
  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('Scheduler Engine stopped.');
  }
}

const schedulerInstance = new SchedulerEngine();

module.exports = {
  SchedulerEngine,
  scheduler: schedulerInstance
};
