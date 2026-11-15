const path = require('path');
const fs = require('fs');
const config = require('./config');
const logger = require('./utils/logger');

let dbInstance = null;

/**
 * Creates or retrieves the SQLite database connection.
 * Seamlessly leverages Node's built-in node:sqlite (Node 22.5+) or better-sqlite3.
 * Configures Write-Ahead Logging (WAL) for concurrency and crash-durability.
 */
function initDb(customPath = null) {
  if (dbInstance && !customPath) {
    return dbInstance;
  }

  const dbPath = customPath || config.dbPath;

  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  let db = null;

  // Try native node:sqlite first (Zero external npm dependency & no C++ compilation)
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(dbPath);
    logger.info(`SQLite initialized using built-in node:sqlite at ${dbPath === ':memory:' ? 'in-memory' : dbPath}`);
  } catch (err) {
    // Fallback to better-sqlite3 if node:sqlite is unavailable
    try {
      const Database = require('better-sqlite3');
      db = new Database(dbPath);
      logger.info(`SQLite initialized using better-sqlite3 at ${dbPath}`);
    } catch (fallbackErr) {
      logger.error('Failed to initialize SQLite. Ensure Node >= 22.5 or better-sqlite3 is installed.', {
        nativeErr: err.message,
        fallbackErr: fallbackErr.message
      });
      throw new Error(`SQLite initialization failed: ${err.message}`);
    }
  }

  // Configure SQLite PRAGMAs for concurrency and durability
  if (dbPath !== ':memory:') {
    try {
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA synchronous = NORMAL;');
      db.exec('PRAGMA busy_timeout = 5000;');
    } catch (pragmaErr) {
      logger.warn(`Could not set WAL pragma: ${pragmaErr.message}`);
    }
  }

  db.exec('PRAGMA foreign_keys = ON;');

  // Schema creation
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient TEXT NOT NULL,
      recipient_jid TEXT NOT NULL,
      message TEXT NOT NULL,
      scheduled_at_utc TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'sent', 'failed', 'cancelled', 'uncertain', 'missed')),
      whatsapp_message_id TEXT,
      error_message TEXT,
      sent_at_utc TEXT,
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_due ON messages (status, scheduled_at_utc);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages (created_at_utc);
  `);

  if (!customPath) {
    dbInstance = db;
  }

  return db;
}

function getDb() {
  if (!dbInstance) {
    return initDb();
  }
  return dbInstance;
}

function closeDb() {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch (e) {
      // ignore
    }
    dbInstance = null;
  }
}

module.exports = {
  initDb,
  getDb,
  closeDb
};
