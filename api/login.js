const { getPool, ensureSchema } = require('./_lib/db');
const { normalizeUsername } = require('./_lib/validate');
const {
  hashPassword,
  verifyPassword,
  generateToken,
  normalizePassword,
  SESSION_TTL_MS,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MS,
} = require('./_lib/auth');

// POST { username, password }
// - New username -> creates the account with this password.
// - Existing username, no password set yet (pre-auth legacy account) ->
//   claims it by setting this as its password.
// - Existing username with a password -> must match, with basic lockout
//   after repeated failures.
// Always returns a session token (not the password) for the client to
// persist and use to resume/authenticate later.
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
      error: 'Enter a username using letters, numbers, spaces, - or _ (max 24 chars).',
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

    const userRes = await pool.query(
      'SELECT id, password_hash, failed_attempts, locked_until FROM users WHERE username = $1',
      [username]
    );

    let userId;
    let claimedLegacy = false;

    if (userRes.rows.length === 0) {
      const hash = await hashPassword(password);
      const inserted = await pool.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
        [username, hash]
      );
      userId = inserted.rows[0].id;
    } else {
      const user = userRes.rows[0];

      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        const waitSec = Math.max(1, Math.ceil((new Date(user.locked_until) - new Date()) / 1000));
        res.status(429).json({ error: `Too many attempts. Try again in ${waitSec}s.` });
        return;
      }

      if (!user.password_hash) {
        // Account existed before passwords did -- claim it now.
        const hash = await hashPassword(password);
        await pool.query(
          'UPDATE users SET password_hash = $1, failed_attempts = 0, locked_until = NULL WHERE id = $2',
          [hash, user.id]
        );
        userId = user.id;
        claimedLegacy = true;
      } else {
        const ok = await verifyPassword(password, user.password_hash);
        if (!ok) {
          const attempts = user.failed_attempts + 1;
          const lock = attempts >= MAX_FAILED_ATTEMPTS;
          await pool.query(
            'UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE id = $3',
            [lock ? 0 : attempts, lock ? new Date(Date.now() + LOCKOUT_MS) : null, user.id]
          );
          res.status(401).json({
            error: lock
              ? `Too many attempts. Try again in ${Math.round(LOCKOUT_MS / 1000)}s.`
              : 'Incorrect password.',
          });
          return;
        }
        if (user.failed_attempts > 0 || user.locked_until) {
          await pool.query(
            'UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1',
            [user.id]
          );
        }
        userId = user.id;
      }
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await pool.query('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [
      token,
      userId,
      expiresAt,
    ]);

    const { rows } = await pool.query(
      'SELECT word_num, answer FROM progress WHERE user_id = $1 ORDER BY word_num',
      [userId]
    );

    res.status(200).json({
      username,
      token,
      claimedLegacy,
      solved: rows.map((r) => ({ num: r.word_num, answer: r.answer })),
    });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'Server error, please try again.' });
  }
};
