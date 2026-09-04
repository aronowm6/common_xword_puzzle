const { getPool, ensureSchema } = require('./_lib/db');
const { listPuzzles } = require('./_lib/flashback');

// GET -> one entry list per puzzle: { puzzles: [{ puzzleId, entries: [{
// username, score }] }] }, best (highest-score) attempt per player per
// puzzle, sorted best-first. Always includes all known puzzles, even ones
// nobody's attempted yet (empty entries array).
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
        SELECT user_id, puzzle_id, MAX(score) AS score
        FROM flashback_attempts
        GROUP BY user_id, puzzle_id
      )
      SELECT b.puzzle_id, u.username, b.score
      FROM best b
      JOIN users u ON u.id = b.user_id
      ORDER BY b.puzzle_id ASC, b.score DESC, u.username ASC
    `);

    const entriesByPuzzle = new Map();
    for (const row of rows) {
      if (!entriesByPuzzle.has(row.puzzle_id)) entriesByPuzzle.set(row.puzzle_id, []);
      entriesByPuzzle.get(row.puzzle_id).push({ username: row.username, score: row.score });
    }

    const puzzles = listPuzzles().map(({ id }) => ({
      puzzleId: id,
      entries: entriesByPuzzle.get(id) || [],
    }));

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ puzzles });
  } catch (err) {
    console.error('flashback-leaderboard error', err);
    res.status(500).json({ error: 'Server error, please try again.' });
  }
};
