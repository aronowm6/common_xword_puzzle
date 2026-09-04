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
      CREATE TABLE IF NOT EXISTS progress (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        word_num INTEGER NOT NULL,
        answer TEXT NOT NULL,
        solved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, word_num)
      );
    `).catch((err) => {
      schemaReady = undefined; // allow retry on next request
      throw err;
    });
  }
  return schemaReady;
}

module.exports = { getPool, ensureSchema };
