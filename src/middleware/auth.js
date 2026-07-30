'use strict';

const crypto = require('crypto');
const config = require('../../config/env');

const activeAdminTokens = new Set();
const MAX_ADMIN_SESSIONS = 10;

function createAdminToken() {
  const token = crypto.randomBytes(24).toString('hex');
  activeAdminTokens.add(token);
  if (activeAdminTokens.size > MAX_ADMIN_SESSIONS) {
    const oldestToken = activeAdminTokens.values().next().value;
    activeAdminTokens.delete(oldestToken);
  }
  return token;
}

function isValidAdminToken(token) {
  if (!token || typeof token !== 'string') return false;
  return activeAdminTokens.has(token);
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.adminToken;
  if (!isValidAdminToken(token)) {
    return res.status(401).json({ error: 'Unauthorized: Admin authentication token required' });
  }
  next();
}

module.exports = {
  createAdminToken,
  isValidAdminToken,
  requireAdmin
};
