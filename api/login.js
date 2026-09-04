const { getPool, ensureSchema } = require('./_lib/db');
const { normalizeUsername } = require('./_lib/validate');

// POST { username } -> creates the user if new (no password) and returns
// which puzzle numbers they've already solved, so the game can resume.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const username = normalizeUsername(req.body && req.body.username);
  if (!username) {
    res.status(400).json({
      error: 'Enter a username using letters, numbers, spaces, - or _ (max 24 chars).',
    });
    return;
  }

  try {
    await ensureSchema();
    const pool = getPool();
    await pool.query(
      'INSERT INTO users (username) VALUES ($1) ON CONFLICT (username) DO NOTHING',
      [username]
    );
    const { rows } = await pool.query(
      `SELECT p.word_num, p.answer
       FROM progress p
       JOIN users u ON u.id = p.user_id
       WHERE u.username = $1
       ORDER BY p.word_num`,
      [username]
    );
    res.status(200).json({
      username,
      solved: rows.map((r) => ({ num: r.word_num, answer: r.answer })),
    });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'Server error, please try again.' });
  }
};
