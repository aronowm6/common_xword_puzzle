const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const BCRYPT_COST = 10;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 60 * 1000; // 1 minute

function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function normalizePassword(raw) {
  if (typeof raw !== 'string') return null;
  if (raw.length < 4 || raw.length > 72) return null;
  return raw;
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  normalizePassword,
  SESSION_TTL_MS,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MS,
};
