const { listPuzzles } = require('./_lib/flashback');

// GET -> puzzle picker metadata: id, optional theme, word count. Never the
// words themselves or their order.
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json({ puzzles: listPuzzles() });
};
