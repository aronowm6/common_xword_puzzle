const { getPool, ensureSchema } = require('./_lib/db');

// GET -> every player who has completed at least one Flashback puzzle,
// their best (lowest-mistake) score per puzzle, and a summary. Puzzle
// content itself (words/order) is never included here.
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    await ensureSchema();
    const pool = getPool();

    const { rows } = await pool.query(`
      WITH best AS (
        SELECT user_id, puzzle_id, MIN(mistakes) AS mistakes
        FROM flashback_attempts
        GROUP BY user_id, puzzle_id
      )
      SELECT
        u.username,
        COUNT(b.puzzle_id)::int AS puzzles_played,
        COALESCE(SUM(b.mistakes), 0)::int AS total_mistakes,
        COALESCE(SUM(CASE WHEN b.mistakes = 0 THEN 1 ELSE 0 END), 0)::int AS perfect_solves,
        COALESCE(
          json_agg(
            json_build_object('puzzleId', b.puzzle_id, 'mistakes', b.mistakes)
            ORDER BY b.puzzle_id
          ) FILTER (WHERE b.puzzle_id IS NOT NULL),
          '[]'
        ) AS puzzles
      FROM users u
      JOIN best b ON b.user_id = u.id
      GROUP BY u.username
      ORDER BY puzzles_played DESC, total_mistakes ASC, u.username ASC
    `);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ leaderboard: rows });
  } catch (err) {
    console.error('flashback-leaderboard error', err);
    res.status(500).json({ error: 'Server error, please try again.' });
  }
};
