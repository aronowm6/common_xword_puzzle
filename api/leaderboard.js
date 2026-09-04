const { getPool, ensureSchema } = require('./_lib/db');

// GET -> every user who has ever logged in, their solved count, and which
// entry numbers they've gotten so far (most-solved first). Deliberately
// never includes the answer text -- that would let anyone read other
// players' solved words off the public leaderboard instead of solving them.
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    await ensureSchema();
    const pool = getPool();
    const { rows } = await pool.query(`
      SELECT
        u.username,
        COUNT(p.word_num)::int AS count,
        COALESCE(
          json_agg(p.word_num ORDER BY p.word_num) FILTER (WHERE p.word_num IS NOT NULL),
          '[]'
        ) AS nums
      FROM users u
      LEFT JOIN progress p ON p.user_id = u.id
      GROUP BY u.username
      ORDER BY count DESC, u.username ASC
    `);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ leaderboard: rows });
  } catch (err) {
    console.error('leaderboard error', err);
    res.status(500).json({ error: 'Server error, please try again.' });
  }
};
