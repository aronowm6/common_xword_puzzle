#!/usr/bin/env node
// One-time DB setup: creates/updates the schema against whatever Postgres
// DATABASE_URL points at (e.g. your Neon connection string). Reuses the
// same ensureSchema() the live API calls lazily, so this file can't drift
// out of sync with what's actually deployed.
//
// Usage:
//   DATABASE_URL="postgres://..." node scripts/seed.js
// or create a .env file (see .env.example) and this will load it.

try {
  require('dotenv').config();
} catch (_) {
  // dotenv is optional; ignore if not installed.
}

const { ensureSchema, getPool } = require('../api/_lib/db');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Missing DATABASE_URL. Set it in your env or in a .env file.');
    process.exit(1);
  }

  console.log('Connecting to database...');
  await ensureSchema();
  console.log('Schema ready: users, progress, sessions, flashback_attempts');

  const words = require('../data/words.json');
  console.log(`Word list loaded: ${words.length} entries (not stored in DB, served from data/words.json).`);

  await getPool().end();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
