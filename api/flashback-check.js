const { checkPlacement } = require('./_lib/flashback');

// POST { puzzleId, placed, newWord, position } -> { correct }
// Stateless: given the words already correctly placed (their order) plus
// where the player wants to insert newWord, says whether that slot is
// right. No auth needed -- this never touches the DB or reveals counts,
// just a pass/fail per attempt.
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
  res.status(200).json({ correct: result.correct });
};
