const { getPool, ensureSchema } = require('./_lib/db');
const { normalizeUsername } = require('./_lib/validate');
const { hashPassword, generateToken, normalizePassword, SESSION_TTL_MS } = require('./_lib/auth');

// POST { username, password } -> creates a NEW account only. Rejects if
// the username is already taken (409, points at logging in instead).
// Race-safe: two simultaneous signups for the same name can both pass the
// pre-check, so the actual INSERT's UNIQUE constraint is the real guard --
// a constraint violation is caught and reported the same way.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body || {};
  const username = normalizeUsername(body.username);
  const password = normalizePassword(body.password);

  if (!username) {
    res.status(400).json({
      error: 'Choose a username using letters, numbers, spaces, - or _ (max 24 chars).',
    });
    return;
  }
  if (!password) {
    res.status(400).json({ error: 'Password must be 4-72 characters.' });
    return;
  }

  try {
    await ensureSchema();
    const pool = getPool();

    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'That username is already taken. Try logging in instead.' });
      return;
    }

    const hash = await hashPassword(password);
    let userId;
    try {
      const inserted = await pool.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
        [username, hash]
      );
      userId = inserted.rows[0].id;
    } catch (err) {
      if (err.code === '23505') {
        res.status(409).json({ error: 'That username is already taken. Try logging in instead.' });
        return;
      }
      throw err;
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await pool.query('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [
      token,
      userId,
      expiresAt,
    ]);

    res.status(200).json({ username, token, solved: [] });
  } catch (err) {
    console.error('signup error', err);
    res.status(500).json({ error: 'Server error, please try again.' });
  }
};
