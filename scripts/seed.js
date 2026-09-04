#!/usr/bin/env node
// One-time DB setup: creates the users/progress tables against whatever
// Postgres DATABASE_URL points at (e.g. your Supabase connection string).
//
// Usage:
//   DATABASE_URL="postgres://..." node scripts/seed.js
// or create a .env file (see .env.example) and this will load it.

try {
  require('dotenv').config();
} catch (_) {
  // dotenv is optional; ignore if not installed.
}

const { Pool } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Missing DATABASE_URL. Set it in your env or in a .env file.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

  console.log('Connecting to database...');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS progress (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      word_num INTEGER NOT NULL,
      answer TEXT NOT NULL,
      solved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, word_num)
    );
  `);
  console.log('Schema ready: users, progress');

  const words = require('../data/words.json');
  console.log(`Word list loaded: ${words.length} entries (not stored in DB, served from data/words.json).`);

  await pool.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
