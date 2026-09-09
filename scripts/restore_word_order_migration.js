#!/usr/bin/env node
// One-time DB reconciliation, 2026-09-09.
//
// Context: commit 7077fa3 rebuilt data/words.json from a fresh crawl. It
// kept essentially the same 501 words but re-sorted tied entries, so ~240
// of the 501 `num` slots changed which word they point at. Player progress
// is stored as (user_id, word_num, answer), so after that deploy players
// saw duplicates (re-entering a word inserted it at its new slot) and, in
// some slots, lost credit (a newly found word collided with an old find
// sitting at that slot under the old ordering).
//
// data/words.json has since been reverted to the original ordering. This
// script realigns the `progress` table to it, keyed by WORD not slot:
//
//   For each user, for each DISTINCT answer they have a progress row for:
//     - keep exactly one row
//     - at the word_num that answer holds in the restored data/words.json
//     - with the earliest solved_at among the collapsed rows
//   Every other row for that user is removed.
//
// The set of distinct words each user has found is provably unchanged --
// only duplicates and wrong slot numbers are corrected. Nobody found ALIEN
// or NEW (the only two words that differ in membership between the two
// lists), verified against the live DB before writing this.
//
// Safety:
//   - refuses to run unless the progress_backup_20260909 table exists
//   - dry run by default; pass --apply to write
//   - single transaction; asserts per-user distinct-word set is preserved
//
// Usage:
//   node scripts/restore_word_order_migration.js            # dry run
//   node scripts/restore_word_order_migration.js --apply     # execute

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
const words = require('../data/words.json');

const APPLY = process.argv.includes('--apply');
const BACKUP_TABLE = 'progress_backup_20260909';

const numByAnswer = new Map(words.map((w) => [w.answer, w.num]));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Missing DATABASE_URL (set it, or add .env.local / .env).');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });

  try {
    const bk = await pool.query(
      `SELECT to_regclass($1) AS t`, [BACKUP_TABLE]
    );
    if (!bk.rows[0].t) {
      throw new Error(`Backup table ${BACKUP_TABLE} not found. Run scripts/backup_progress.js first.`);
    }
    const bkCount = await pool.query(`SELECT count(*)::int AS n FROM ${BACKUP_TABLE}`);
    const liveCount = await pool.query(`SELECT count(*)::int AS n FROM progress`);
    console.log(`${BACKUP_TABLE}: ${bkCount.rows[0].n} rows | live progress: ${liveCount.rows[0].n} rows`);
    if (bkCount.rows[0].n !== liveCount.rows[0].n) {
      throw new Error('Backup and live row counts differ -- investigate before migrating.');
    }

    const { rows } = await pool.query(
      `SELECT p.user_id, u.username, p.word_num, p.answer, p.solved_at
         FROM progress p JOIN users u ON u.id = p.user_id`
    );

    // Group -> per user, earliest solved_at per distinct answer.
    const users = new Map(); // user_id -> { username, answers: Map<answer, earliestSolvedAt> }
    for (const r of rows) {
      if (!users.has(r.user_id)) users.set(r.user_id, { username: r.username, answers: new Map() });
      const a = users.get(r.user_id).answers;
      const prev = a.get(r.answer);
      if (prev === undefined || r.solved_at < prev) a.set(r.answer, r.solved_at);
    }

    // Validate every answer maps to a slot in the restored list.
    const unmapped = new Set();
    for (const { answers } of users.values()) {
      for (const a of answers.keys()) if (!numByAnswer.has(a)) unmapped.add(a);
    }
    if (unmapped.size) {
      throw new Error(`These stored answers have no slot in the restored data/words.json: ${[...unmapped].join(', ')}`);
    }

    // Build the desired end state and report the delta.
    let totalBefore = 0, totalAfter = 0, usersChanged = 0;
    const plan = [];
    for (const [userId, { username, answers }] of users) {
      const beforeRows = rows.filter((r) => r.user_id === userId);
      const before = beforeRows.length;
      const after = answers.size;
      totalBefore += before;
      totalAfter += after;
      const dupCollapsed = before - after;
      const beforeAtWrongSlot = beforeRows.filter((r) => numByAnswer.get(r.answer) !== r.word_num).length;
      if (dupCollapsed !== 0 || beforeAtWrongSlot !== 0) usersChanged++;
      plan.push({ userId, username, before, after, dupCollapsed, beforeAtWrongSlot, answers });
      console.log(
        `  ${String(username).padEnd(16)} ${String(before).padStart(3)} -> ${String(after).padStart(3)} rows` +
        `  (collapse ${String(dupCollapsed).padStart(2)} dup, re-slot ${String(beforeAtWrongSlot).padStart(3)})`
      );
    }
    console.log(`\nTotals: ${totalBefore} -> ${totalAfter} rows across ${users.size} users; ${usersChanged} users change.`);

    if (!APPLY) {
      console.log('\nDRY RUN. Re-run with --apply to execute.');
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const { userId, username, answers } of plan) {
        const distinctBefore = new Set(answers.keys());
        await client.query('DELETE FROM progress WHERE user_id = $1', [userId]);
        for (const [answer, solvedAt] of answers) {
          await client.query(
            `INSERT INTO progress (user_id, word_num, answer, solved_at) VALUES ($1, $2, $3, $4)`,
            [userId, numByAnswer.get(answer), answer, solvedAt]
          );
        }
        // Assert the distinct-word set is exactly preserved for this user.
        const check = await client.query('SELECT answer FROM progress WHERE user_id = $1', [userId]);
        const distinctAfter = new Set(check.rows.map((r) => r.answer));
        if (check.rows.length !== distinctAfter.size) {
          throw new Error(`${username}: duplicate answers after rebuild -- rolling back.`);
        }
        if (distinctAfter.size !== distinctBefore.size ||
            [...distinctBefore].some((a) => !distinctAfter.has(a))) {
          throw new Error(`${username}: distinct-word set changed -- rolling back.`);
        }
        // Assert every row now sits at its correct restored slot.
        const wrong = await client.query(
          'SELECT word_num, answer FROM progress WHERE user_id = $1', [userId]
        );
        for (const r of wrong.rows) {
          if (numByAnswer.get(r.answer) !== r.word_num) {
            throw new Error(`${username}: ${r.answer} still at wrong slot ${r.word_num} -- rolling back.`);
          }
        }
      }
      const finalCount = await client.query('SELECT count(*)::int AS n FROM progress');
      if (finalCount.rows[0].n !== totalAfter) {
        throw new Error(`Final row count ${finalCount.rows[0].n} != expected ${totalAfter} -- rolling back.`);
      }
      await client.query('COMMIT');
      console.log(`\nAPPLIED. progress now has ${finalCount.rows[0].n} rows. Backup retained in ${BACKUP_TABLE}.`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
