const { getPool, ensureSchema } = require('./_lib/db');

// GET -> every user who has ever logged in, their solved count, which entry
// numbers they've gotten so far (most-solved first), and a `history` for
// the progress-over-time chart. Deliberately never includes the answer
// text -- that would let anyone read other players' solved words off the
// public leaderboard instead of solving them.
//
// `history` is a cumulative step series, one point per hour in which the
// player's count actually changed: [{ t: <ISO hour>, n: <count as of
// then> }, ...]. `id` is included only so the client can assign a stable
// per-player chart color independent of the leaderboard's rank ordering
// (rank changes as people solve words; the color shouldn't).
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
        u.id,
        u.username,
        COUNT(p.word_num)::int AS count,
        COALESCE(
          json_agg(p.word_num ORDER BY p.word_num) FILTER (WHERE p.word_num IS NOT NULL),
          '[]'
        ) AS nums
      FROM users u
      LEFT JOIN progress p ON p.user_id = u.id
      GROUP BY u.id, u.username
      ORDER BY count DESC, u.username ASC
    `);

    const histRes = await pool.query(`
      SELECT u.username, p.solved_at
      FROM progress p JOIN users u ON u.id = p.user_id
      ORDER BY u.username, p.solved_at
    `);
    const historyByUser = new Map();
    for (const r of histRes.rows) {
      if (!historyByUser.has(r.username)) historyByUser.set(r.username, { count: 0, points: [] });
      const h = historyByUser.get(r.username);
      h.count += 1;
      const bucket = new Date(r.solved_at);
      bucket.setUTCMinutes(0, 0, 0, 0); // hour granularity
      const t = bucket.toISOString();
      const last = h.points[h.points.length - 1];
      if (last && last.t === t) {
        last.n = h.count; // same hour as the previous point -- update it, don't add a new one
      } else {
        h.points.push({ t, n: h.count });
      }
    }

    const leaderboard = rows.map((row) => ({
      ...row,
      history: (historyByUser.get(row.username) || { points: [] }).points,
    }));

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ leaderboard });
  } catch (err) {
    console.error('leaderboard error', err);
    res.status(500).json({ error: 'Server error, please try again.' });
  }
};
