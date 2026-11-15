const path = require('path');
const express = require('express');
const session = require('express-session');
const config = require('./config');
const logger = require('./utils/logger');
const { initDb, closeDb } = require('./db');
const { router: authRouter, requireAuth } = require('./routes/auth');
const apiRouter = require('./routes/api');
const whatsappManager = require('./whatsapp');
const { scheduler } = require('./scheduler');

const app = express();

// Trust proxy if behind reverse proxy (e.g. Docker / Nginx / Cloudflare)
app.set('trust proxy', 1);

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session management
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.nodeEnv === 'production' && process.env.COOKIE_SECURE === 'true',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    }
  })
);

// Serve static assets
const publicDir = path.join(__dirname, 'public');

// Serve login page route
app.get('/login', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.redirect('/');
  }
  res.sendFile(path.join(publicDir, 'login.html'));
});

// Auth endpoints
app.use('/api', authRouter);

// Protected dashboard page
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Protected API routes
app.use('/api', requireAuth, apiRouter);

// Serve public static assets (CSS, client JS, images)
app.use(express.static(publicDir));

// 404 handler
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'Endpoint not found' });
  }
  res.redirect('/');
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled Express error:', { error: err.message, stack: err.stack });
  res.status(500).json({ success: false, error: 'Internal server error' });
});

let serverInstance = null;

function startServer() {
  // 1. Initialize SQLite database
  initDb();

  // 2. Start background scheduler
  scheduler.start();

  // 3. Initialize WhatsApp Web client (unless in mock test environment)
  if (process.env.NODE_ENV !== 'test' && !process.env.DISABLE_WHATSAPP_ON_START) {
    whatsappManager.initialize().catch((err) => {
      logger.error('Failed to initialize WhatsApp on startup:', { error: err.message });
    });
  }

  // 4. Start HTTP listener
  serverInstance = app.listen(config.port, config.host, () => {
    logger.info(`================================================================`);
    logger.info(`Personal WhatsApp Scheduler running at http://${config.host}:${config.port}`);
    logger.info(`Timezone: ${config.timezone} (PKT, UTC+5)`);
    logger.info(`Storage Dir: ${config.dataDir}`);
    logger.info(`Auth Strategy: ${config.authStrategy}`);
    logger.info(`================================================================`);
  });

  return serverInstance;
}

// Graceful shutdown handling
function handleGracefulShutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  // Stop scheduler
  scheduler.stop();

  // Destroy WhatsApp client
  whatsappManager.destroy().finally(() => {
    // Close SQLite database
    closeDb();

    // Close HTTP server
    if (serverInstance) {
      serverInstance.close(() => {
        logger.info('HTTP server closed. Exiting process.');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });

  // Force exit after 10s timeout if hung
  setTimeout(() => {
    logger.error('Forceful shutdown timeout reached.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
