const { getPool, ensureSchema } = require('./_lib/db');

// POST { token } -> the signed-in player's own best (lowest-mistake)
// score per puzzle they've completed, as a map: { puzzleId: mistakes }.
// Puzzles not yet attempted are simply absent from the map.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = typeof (req.body && req.body.token) === 'string' ? req.body.token : null;
  if (!token) {
    res.status(401).json({ error: 'Not signed in.' });
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

    const { rows } = await pool.query(
      'SELECT puzzle_id, MIN(mistakes)::int AS mistakes FROM flashback_attempts WHERE user_id = $1 GROUP BY puzzle_id',
      [userId]
    );

    const progress = {};
    for (const row of rows) progress[row.puzzle_id] = row.mistakes;

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ progress });
  } catch (err) {
    console.error('flashback-progress error', err);
    res.status(500).json({ error: 'Server error, please try again.' });
  }
};
