const express = require('express');
const router = express.Router();
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Authentication middleware.
 * Redirects web visitors to /login or returns 401 for JSON API calls.
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated === true) {
    return next();
  }

  if (req.xhr || req.path.startsWith('/api/') || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.status(401).json({ success: false, error: 'Authentication required.' });
  }

  return res.redirect('/login');
}

/**
 * POST /api/login
 * Validates the dashboard password.
 */
router.post('/login', (req, res) => {
  const { password } = req.body || {};

  if (!password) {
    return res.status(400).json({ success: false, error: 'Password is required.' });
  }

  if (password === config.dashboardPassword) {
    req.session.authenticated = true;
    logger.info('Dashboard user logged in successfully.');
    return res.json({ success: true, message: 'Authenticated successfully.' });
  }

  logger.warn('Failed dashboard login attempt.');
  return res.status(401).json({ success: false, error: 'Incorrect dashboard password.' });
});

/**
 * POST /api/logout
 * Terminates the authenticated session.
 */
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      logger.error('Error destroying session:', { error: err.message });
      return res.status(500).json({ success: false, error: 'Failed to logout.' });
    }
    res.clearCookie('connect.sid');
    return res.json({ success: true, message: 'Logged out successfully.' });
  });
});

/**
 * GET /api/session
 * Checks whether current user session is active.
 */
router.get('/session', (req, res) => {
  const isAuthenticated = !!(req.session && req.session.authenticated === true);
  return res.json({ authenticated: isAuthenticated });
});

module.exports = {
  router,
  requireAuth
};
