const { getPuzzle } = require('./_lib/flashback');

// GET ?id=flashback-001 -> the puzzle's words in the fixed order they're
// listed in the puzzle file -- always the same reveal sequence every
// play, not randomized. Never the correct (popularity) order or any
// counts -- those are only ever exposed indirectly via
// /api/flashback-check pass/fail responses.
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const id = typeof req.query.id === 'string' ? req.query.id : null;
  const puzzle = id && getPuzzle(id);
  if (!puzzle) {
    res.status(404).json({ error: 'Unknown puzzle.' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    id: puzzle.id,
    theme: puzzle.theme || null,
    revealOrder: puzzle.words,
  });
};
