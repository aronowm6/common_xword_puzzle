const { Pool } = require('pg');

let pool;
let schemaReady;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}

// Idempotent schema bootstrap. Runs once per warm serverless instance so the
// app works even if scripts/seed.js was never run against the DB by hand.
async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = getPool().query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      -- Added after the initial launch (passwords were bolted on later):
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

      CREATE TABLE IF NOT EXISTS progress (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        word_num INTEGER NOT NULL,
        answer TEXT NOT NULL,
        solved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, word_num)
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

      -- Flashback: one row per completed attempt (not just best-of), so we
      -- keep full history but the leaderboard only surfaces each player's
      -- best (lowest-mistake) attempt per puzzle via MIN().
      CREATE TABLE IF NOT EXISTS flashback_attempts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        puzzle_id TEXT NOT NULL,
        mistakes INTEGER NOT NULL,
        completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS flashback_attempts_user_puzzle_idx ON flashback_attempts(user_id, puzzle_id);
    `).catch((err) => {
      schemaReady = undefined; // allow retry on next request
      throw err;
    });
  }
  return schemaReady;
}

module.exports = { getPool, ensureSchema };
