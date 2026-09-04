const { checkPlacement, getCount } = require('./_lib/flashback');

// POST { puzzleId, placed, newWord, position } -> { correct, correctIndex, count }
// Stateless, one guess per word: says whether the guessed slot is right,
// and always includes the true correct index (so the client can
// auto-place a wrong guess into its real spot) plus the word's usage
// count (revealed once it's placed, right or wrong). No auth needed --
// doesn't touch the DB.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const body = req.body || {};
  const puzzleId = typeof body.puzzleId === 'string' ? body.puzzleId : null;
  const placed = Array.isArray(body.placed) ? body.placed.filter((w) => typeof w === 'string') : null;
  const newWord = typeof body.newWord === 'string' ? body.newWord : null;
  const position = Number.isInteger(body.position) ? body.position : null;

  if (!puzzleId || !placed || !newWord || position === null) {
    res.status(400).json({ error: 'Missing puzzleId, placed, newWord, or position.' });
    return;
  }

  const result = checkPlacement(puzzleId, placed, newWord, position);
  if (!result.valid) {
    res.status(400).json({ error: 'Invalid placement request.' });
    return;
  }
  res.status(200).json({
    correct: result.correct,
    correctIndex: result.correctIndex,
    count: getCount(newWord),
  });
};
