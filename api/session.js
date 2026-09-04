const { getPool, ensureSchema } = require('./_lib/db');

// POST { token } -> silently resumes a session (used on page load / after
// navigating back from the leaderboard) without re-asking for a password.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = typeof (req.body && req.body.token) === 'string' ? req.body.token : null;
  if (!token) {
    res.status(400).json({ error: 'Missing token.' });
    return;
  }

  try {
    await ensureSchema();
    const pool = getPool();
    const sessRes = await pool.query(
      `SELECT s.user_id, u.username
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = $1 AND s.expires_at > now()`,
      [token]
    );
    if (sessRes.rows.length === 0) {
      res.status(401).json({ error: 'Session expired.' });
      return;
    }

    const { user_id: userId, username } = sessRes.rows[0];
    const { rows } = await pool.query(
      'SELECT word_num, answer FROM progress WHERE user_id = $1 ORDER BY word_num',
      [userId]
    );

    res.status(200).json({
      username,
      solved: rows.map((r) => ({ num: r.word_num, answer: r.answer })),
    });
  } catch (err) {
    console.error('session error', err);
    res.status(500).json({ error: 'Server error, please try again.' });
  }
};
