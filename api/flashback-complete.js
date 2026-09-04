const { getPool, ensureSchema } = require('./_lib/db');
const { getPuzzle, MAX_MISTAKES } = require('./_lib/flashback');

// POST { token, puzzleId, mistakes } -> records a completed attempt.
// Every attempt is logged (not just best-of); the leaderboard aggregates
// down to each player's best per puzzle.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body || {};
  const token = typeof body.token === 'string' ? body.token : null;
  const puzzleId = typeof body.puzzleId === 'string' ? body.puzzleId : null;
  const mistakes = Number.isInteger(body.mistakes) ? body.mistakes : null;

  if (!token) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }
  if (!puzzleId || !getPuzzle(puzzleId)) {
    res.status(400).json({ error: 'Unknown puzzle.' });
    return;
  }
  if (mistakes === null || mistakes < 0 || mistakes > MAX_MISTAKES) {
    res.status(400).json({ error: 'Invalid mistake count.' });
    return;
  }

  try {
    await ensureSchema();
    const pool = getPool();

    const sessRes = await pool.query(
      'SELECT user_id FROM sessions WHERE token = $1 AND expires_at > now()',
      [token]
    );
    if (sessRes.rows.length === 0) {
      res.status(401).json({ error: 'Session expired, please log in again.' });
      return;
    }
    const userId = sessRes.rows[0].user_id;

    await pool.query(
      'INSERT INTO flashback_attempts (user_id, puzzle_id, mistakes) VALUES ($1, $2, $3)',
      [userId, puzzleId, mistakes]
    );

    const bestRes = await pool.query(
      'SELECT MIN(mistakes)::int AS best FROM flashback_attempts WHERE user_id = $1 AND puzzle_id = $2',
      [userId, puzzleId]
    );

    res.status(200).json({ ok: true, mistakes, best: bestRes.rows[0].best });
  } catch (err) {
    console.error('flashback-complete error', err);
    res.status(500).json({ error: 'Server error, please try again.' });
  }
};
