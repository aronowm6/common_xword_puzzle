const { getPool, ensureSchema } = require('./_lib/db');
const { getWord } = require('./_lib/words');
const { normalizeUsername, normalizeGuess } = require('./_lib/validate');

// POST { username, num, guess } -> checks the guess server-side against the
// answer for entry `num`. Correct + first-time guesses are persisted.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body || {};
  const username = normalizeUsername(body.username);
  const num = Number(body.num);
  const guess = normalizeGuess(body.guess);

  if (!username) {
    res.status(400).json({ error: 'Missing username.' });
    return;
  }
  const word = getWord(num);
  if (!word) {
    res.status(400).json({ error: 'Unknown entry.' });
    return;
  }
  if (!guess) {
    res.status(400).json({ error: 'Missing guess.' });
    return;
  }

  const correct = guess === word.answer;
  if (!correct) {
    res.status(200).json({ correct: false, num });
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
      [userId, num, word.answer]
    );
    const alreadySolved = insertRes.rowCount === 0;
    res.status(200).json({ correct: true, num, answer: word.answer, alreadySolved });
  } catch (err) {
    console.error('guess error', err);
    res.status(500).json({ error: 'Server error, please try again.' });
  }
};
