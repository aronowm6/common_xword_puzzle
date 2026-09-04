const { getPool, ensureSchema } = require('./_lib/db');
const { findByAnswer } = require('./_lib/words');
const { normalizeUsername, normalizeGuess } = require('./_lib/validate');

// POST { username, guess } -> freeform matching. The guess is checked
// against all 500 answers (not tied to a specific entry number); if it
// exactly matches one, that entry is marked solved for this user.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body || {};
  const username = normalizeUsername(body.username);
  const guess = normalizeGuess(body.guess);

  if (!username) {
    res.status(400).json({ error: 'Missing username.' });
    return;
  }
  if (!guess) {
    res.status(200).json({ correct: false });
    return;
  }

  const word = findByAnswer(guess);
  if (!word) {
    res.status(200).json({ correct: false });
    return;
  }

  try {
    await ensureSchema();
    const pool = getPool();
    await pool.query(
      'INSERT INTO users (username) VALUES ($1) ON CONFLICT (username) DO NOTHING',
      [username]
    );
    const userRes = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    const userId = userRes.rows[0].id;
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
