const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');
let QRCode = null;
try {
  QRCode = require('qrcode');
} catch (e) {
  // Optional in minimal mock test runs
}

class WhatsAppManager {
  constructor() {
    this.client = null;
    this.status = 'DISCONNECTED'; // DISCONNECTED, INITIALIZING, QR_READY, AUTHENTICATING, READY, AUTH_FAILURE
    this.qrCodeRaw = null;
    this.qrCodeDataUrl = null;
    this.qrTimestamp = null;
    this.clientInfo = null;
    this.isInitializing = false;
    this.activeSenderLock = false;
  }

  /**
   * Initializes the WhatsApp Web client instance.
   */
  async initialize() {
    if (this.client || this.isInitializing) {
      logger.info('WhatsApp client is already active or initializing.');
      return;
    }

    this.isInitializing = true;
    this.status = 'INITIALIZING';
    this.qrCodeRaw = null;
    this.qrCodeDataUrl = null;
    logger.info('Initializing WhatsApp Web client...');

    try {
      const { Client, LocalAuth } = require('whatsapp-web.js');

      let authStrategyInstance;

      if (config.authStrategy === 'remote') {
        logger.info('Using RemoteAuth strategy.');
        try {
          const { RemoteAuth } = require('whatsapp-web.js');
          const { MongoStore } = require('wwebjs-mongo');
          const mongoose = require('mongoose');

          if (!config.remoteAuthMongoUri) {
            throw new Error('AUTH_STRATEGY=remote specified, but REMOTE_AUTH_MONGO_URI is not set.');
          }

          await mongoose.connect(config.remoteAuthMongoUri);
          const store = new MongoStore({ mongoose });
          authStrategyInstance = new RemoteAuth({
            store,
            backupSyncIntervalMs: 60000
          });
        } catch (remoteErr) {
          logger.error('Failed to configure RemoteAuth:', { error: remoteErr.message });
          throw remoteErr;
        }
      } else {
        // Default LocalAuth with persistent storage inside DATA_DIR
        const authDataPath = path.join(config.dataDir, 'wwebjs_auth');
        authStrategyInstance = new LocalAuth({
          dataPath: authDataPath
        });
        logger.info(`Using LocalAuth stored at ${authDataPath}`);
      }

      const puppeteerOptions = {
        headless: config.puppeteerHeadless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      };

      if (config.puppeteerExecutablePath) {
        puppeteerOptions.executablePath = config.puppeteerExecutablePath;
        logger.info(`Using custom Chromium executable: ${config.puppeteerExecutablePath}`);
      }

      this.client = new Client({
        authStrategy: authStrategyInstance,
        puppeteer: puppeteerOptions
      });

      this._setupEventListeners();
      await this.client.initialize();
    } catch (err) {
      this.status = 'DISCONNECTED';
      this.isInitializing = false;
      logger.error('Failed to launch WhatsApp Web client:', { error: err.message });
    }
  }

  _setupEventListeners() {
    this.client.on('qr', async (qr) => {
      this.status = 'QR_READY';
      this.qrCodeRaw = qr;
      this.qrTimestamp = new Date().toISOString();
      if (QRCode) {
        try {
          this.qrCodeDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
        } catch (e) {
          this.qrCodeDataUrl = null;
        }
      }
      logger.info('New WhatsApp QR code received. Waiting for user scan in dashboard.');
    });

    this.client.on('authenticated', () => {
      this.status = 'AUTHENTICATING';
      this.qrCodeRaw = null;
      this.qrCodeDataUrl = null;
      logger.info('WhatsApp account authenticated successfully.');
    });

    this.client.on('ready', () => {
      this.status = 'READY';
      this.isInitializing = false;
      this.qrCodeRaw = null;
      this.qrCodeDataUrl = null;

      try {
        const info = this.client.info;
        this.clientInfo = {
          pushname: info?.pushname || 'User',
          wid: info?.wid?.user ? logger.maskPhone(info.wid.user) : 'Connected',
          platform: info?.platform || 'web'
        };
      } catch (e) {
        this.clientInfo = { pushname: 'Connected User' };
      }

      logger.info('WhatsApp client is READY and listening.');
    });

    this.client.on('auth_failure', (msg) => {
      this.status = 'AUTH_FAILURE';
      this.isInitializing = false;
      this.qrCodeRaw = null;
      this.qrCodeDataUrl = null;
      logger.error('WhatsApp authentication failure:', { message: msg });
    });

    this.client.on('disconnected', (reason) => {
      this.status = 'DISCONNECTED';
      this.isInitializing = false;
      this.clientInfo = null;
      this.qrCodeRaw = null;
      this.qrCodeDataUrl = null;
      logger.warn('WhatsApp disconnected:', { reason });
    });
  }

  /**
   * Returns current operational status.
   */
  getStatus() {
    return {
      status: this.status,
      isReady: this.isReady(),
      hasQr: !!this.qrCodeDataUrl,
      qrTimestamp: this.qrTimestamp,
      clientInfo: this.clientInfo
    };
  }

  /**
   * Returns QR code data URL (only accessible after dashboard authentication).
   */
  getQrCodeDataUrl() {
    return this.qrCodeDataUrl;
  }

  /**
   * Checks if WhatsApp client is ready to transmit messages.
   */
  isReady() {
    return this.status === 'READY' && this.client !== null;
  }

  /**
   * Sends a message with delivery timeout and uncertain-state detection.
   * Prevents duplicate sending on uncertain network conditions.
   *
   * @param {string} recipientJid - e.g. '923001234567@c.us'
   * @param {string} text - Message content
   * @param {number} timeoutMs - Timeout limit (default 25s)
   * @returns {Promise<{ success: boolean, messageId?: string, uncertain?: boolean, error?: string }>}
   */
  async sendMessage(recipientJid, text, timeoutMs = 25000) {
    if (!this.isReady()) {
      return {
        success: false,
        uncertain: false,
        error: 'WhatsApp client is not ready. Message delivery postponed.'
      };
    }

    try {
      const sendPromise = this.client.sendMessage(recipientJid, text);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('SEND_TIMEOUT')), timeoutMs);
      });

      const response = await Promise.race([sendPromise, timeoutPromise]);

      const messageId = response?.id?._serialized || response?.id?.id || 'SENT_ACK';
      return {
        success: true,
        messageId
      };
    } catch (err) {
      if (err.message === 'SEND_TIMEOUT') {
        // Requirement 10: Do not promise exactly-once delivery.
        // If send result is uncertain, flag it instead of retrying.
        return {
          success: false,
          uncertain: true,
          error: `Send confirmation timed out after ${timeoutMs / 1000}s. Message may have been delivered. Flagged for manual review.`
        };
      }

      // Check for transient disconnect during send
      if (
        err.message.includes('Session closed') ||
        err.message.includes('Execution context was destroyed') ||
        err.message.includes('Protocol error')
      ) {
        return {
          success: false,
          uncertain: true,
          error: `Browser connection interrupted during send: ${err.message}. Flagged for manual review.`
        };
      }

      return {
        success: false,
        uncertain: false,
        error: err.message || 'WhatsApp message transmission failed.'
      };
    }
  }

  /**
   * Disconnects and destroys the WhatsApp client cleanly.
   */
  async destroy() {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch (err) {
        logger.warn('Error during WhatsApp client destroy:', { error: err.message });
      }
      this.client = null;
    }
    this.status = 'DISCONNECTED';
    this.isInitializing = false;
    this.clientInfo = null;
    this.qrCodeRaw = null;
    this.qrCodeDataUrl = null;
  }
}

// Singleton instance to enforce single sender per account
const whatsappManager = new WhatsAppManager();

module.exports = whatsappManager;
