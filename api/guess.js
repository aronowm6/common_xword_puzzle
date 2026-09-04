const { getPool, ensureSchema } = require('./_lib/db');
const { findByAnswer } = require('./_lib/words');
const { normalizeGuess } = require('./_lib/validate');

// POST { token, guess } -> freeform matching, authenticated by session
// token (not a bare username) so guesses can't be forged for someone else.
// The guess is checked against all 501 answers (not tied to a specific
// entry number); if it exactly matches one, that entry is marked solved.
//
// `token` is optional: guest play (no account) still gets guesses checked
// and answers revealed, it just never touches the DB, so nothing persists.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body || {};
  const token = typeof body.token === 'string' ? body.token : null;
  const guess = normalizeGuess(body.guess);

  if (!guess) {
    res.status(200).json({ correct: false });
    return;
  }

  const word = findByAnswer(guess);
  if (!word) {
    res.status(200).json({ correct: false });
    return;
  }

  if (!token) {
    // Guest: checked, but nothing saved.
    res.status(200).json({ correct: true, num: word.num, answer: word.answer, alreadySolved: false, guest: true });
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

    const insertRes = await pool.query(
      `INSERT INTO progress (user_id, word_num, answer)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, word_num) DO NOTHING
       RETURNING word_num`,
      [userId, word.num, word.answer]
    );
    const alreadySolved = insertRes.rowCount === 0;
    res.status(200).json({ correct: true, num: word.num, answer: word.answer, alreadySolved });
  } catch (err) {
    console.error('guess error', err);
    res.status(500).json({ error: 'Server error, please try again.' });
  }
};
