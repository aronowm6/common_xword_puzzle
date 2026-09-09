#!/usr/bin/env node
// One-time safety backup of the `progress` table, taken 2026-09-09 before
// the word-order restoration migration (see
// scripts/restore_word_order_migration.js). Keep the outputs -- they are
// the record of exactly what every player had found, independent of the
// (broken) word_num -> word mapping at the time.
//
// Does three things:
//   1. CREATE TABLE progress_backup_20260909 AS SELECT * FROM progress   (in-DB rollback source)
//   2. scripts/backups/progress_20260909.json     -- every row, verbatim
//   3. scripts/backups/found_words_20260909.txt   -- username -> sorted answers, human-readable
//
// Usage: node scripts/backup_progress.js
// Reads DATABASE_URL from the environment, or from .env.local / .env.

const fs = require('fs');
const path = require('path');

function loadEnv() {
  if (process.env.DATABASE_URL) return;
  for (const name of ['.env.local', '.env']) {
    const p = path.join(__dirname, '..', name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}
loadEnv();

const { Pool } = require('pg');

const BACKUP_TABLE = 'progress_backup_20260909';
const OUT_DIR = path.join(__dirname, 'backups');
const JSON_OUT = path.join(OUT_DIR, 'progress_20260909.json');
const TXT_OUT = path.join(OUT_DIR, 'found_words_20260909.txt');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Missing DATABASE_URL (set it, or add .env.local / .env).');
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });

  try {
    const live = await pool.query(
      `SELECT p.user_id, u.username, p.word_num, p.answer, p.solved_at
         FROM progress p JOIN users u ON u.id = p.user_id
        ORDER BY u.username, p.word_num`
    );
    const liveCount = live.rows.length;
    console.log(`Live progress rows: ${liveCount}`);

    // 1. In-DB backup table (drop + recreate so the script is re-runnable).
    await pool.query(`DROP TABLE IF EXISTS ${BACKUP_TABLE}`);
    await pool.query(`CREATE TABLE ${BACKUP_TABLE} AS SELECT * FROM progress`);
    const bk = await pool.query(`SELECT count(*)::int AS n FROM ${BACKUP_TABLE}`);
    console.log(`Backup table ${BACKUP_TABLE}: ${bk.rows[0].n} rows`);
    if (bk.rows[0].n !== liveCount) {
      throw new Error(`Backup table row count ${bk.rows[0].n} != live ${liveCount} -- aborting.`);
    }

    // 2. Verbatim JSON dump.
    fs.writeFileSync(JSON_OUT, JSON.stringify(live.rows, null, 2) + '\n');
    const readBack = JSON.parse(fs.readFileSync(JSON_OUT, 'utf8'));
    if (readBack.length !== liveCount) {
      throw new Error(`JSON dump row count ${readBack.length} != live ${liveCount} -- aborting.`);
    }
    console.log(`Wrote ${JSON_OUT} (${readBack.length} rows)`);

    // 3. Human-readable per-user word lists.
    const byUser = new Map();
    for (const r of live.rows) {
      if (!byUser.has(r.username)) byUser.set(r.username, new Set());
      byUser.get(r.username).add(r.answer);
    }
    const lines = [];
    lines.push(`# Found words as of 2026-09-09 (pre word-order restoration)`);
    lines.push(`# ${liveCount} total progress rows; distinct words per user below.`);
    lines.push('');
    for (const uname of [...byUser.keys()].sort()) {
      const words = [...byUser.get(uname)].sort();
      lines.push(`## ${uname} (${words.length} distinct words)`);
      lines.push(words.join(' '));
      lines.push('');
    }
    fs.writeFileSync(TXT_OUT, lines.join('\n'));
    console.log(`Wrote ${TXT_OUT}`);

    console.log('\nBackup complete. Safe to proceed with the migration.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Backup failed:', err);
  process.exit(1);
});
