const path = require('path');
const fs = require('fs');

// Attempt loading .env if dotenv is present, otherwise fallback to process.env
try {
  require('dotenv').config();
} catch (err) {
  // dotenv optional in bare environments
}

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  dashboardPassword: process.env.DASHBOARD_PASSWORD || 'admin123',
  sessionSecret: process.env.SESSION_SECRET || 'change-me-in-production-session-secret-key-456',
  dataDir: DATA_DIR,
  dbPath: path.join(DATA_DIR, 'scheduler.db'),
  authStrategy: (process.env.AUTH_STRATEGY || 'local').toLowerCase(),
  remoteAuthMongoUri: process.env.REMOTE_AUTH_MONGO_URI || '',
  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
  puppeteerHeadless: process.env.PUPPETEER_HEADLESS !== 'false',
  timezone: process.env.TIMEZONE || 'Asia/Karachi',
  checkIntervalSeconds: parseInt(process.env.CHECK_INTERVAL_SECONDS, 10) || 15,
  overdueWindowMinutes: parseInt(process.env.OVERDUE_WINDOW_MINUTES, 10) || 15
};

module.exports = config;
