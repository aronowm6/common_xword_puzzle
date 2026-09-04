const { getPool, ensureSchema } = require('./_lib/db');

// POST { token } -> invalidates the session server-side (proper logout,
// not just forgetting the token client-side).
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const token = typeof (req.body && req.body.token) === 'string' ? req.body.token : null;
  if (token) {
    try {
      await ensureSchema();
      await getPool().query('DELETE FROM sessions WHERE token = $1', [token]);
    } catch (err) {
      console.error('logout error', err);
    }
  }
  res.status(200).json({ ok: true });
};
