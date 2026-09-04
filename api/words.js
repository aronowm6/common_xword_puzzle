const { publicWords } = require('./_lib/words');

// GET -> the full 500-entry list as { num, length } only. Answers never
// leave the server.
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const list = publicWords();
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json({ words: list, total: list.length });
};
