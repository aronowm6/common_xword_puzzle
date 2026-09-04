const { getPool, ensureSchema } = require('./_lib/db');
const { listPuzzles, getPuzzle, checkPlacement, getCount, MAX_SCORE } = require('./_lib/flashback');

// Single dispatcher for all Ordering Game endpoints, keyed by `action`
// (query param on GET, body field on POST). Consolidated from 6 separate
// files into 1 to stay under Vercel Hobby's 12-serverless-function-per-
// deployment limit -- splitting them out originally was cleaner to read,
// but not worth spending 6 of only 12 available functions on one feature.
//
//   GET  ?action=list                                -> puzzle picker metadata
//   GET  ?action=puzzle&id=X                          -> a puzzle's reveal order
//   GET  ?action=leaderboard                           -> per-puzzle score boards
//   POST { action: 'check', puzzleId, placed, ... }     -> score a placement guess
//   POST { action: 'complete', token, puzzleId, score }   -> save a finished attempt
//   POST { action: 'progress', token }                     -> caller's own best scores
module.exports = async (req, res) => {
  const action = req.method === 'GET' ? req.query.action : (req.body && req.body.action);

  if (req.method === 'GET' && action === 'list') return handleList(req, res);
  if (req.method === 'GET' && action === 'puzzle') return handlePuzzle(req, res);
  if (req.method === 'GET' && action === 'leaderboard') return handleLeaderboard(req, res);
  if (req.method === 'POST' && action === 'check') return handleCheck(req, res);
  if (req.method === 'POST' && action === 'complete') return handleComplete(req, res);
  if (req.method === 'POST' && action === 'progress') return handleProgress(req, res);

  res.status(400).json({ error: 'Unknown or missing action.' });
};

// GET -> puzzle picker metadata: id, optional theme, word count. Never the
// words themselves or their order.
async function handleList(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json({ puzzles: listPuzzles() });
}

// GET ?id=flashback-001 -> the puzzle's words in the fixed order they're
// listed in the puzzle file -- always the same reveal sequence every
// play, not randomized. Never the correct (popularity) order or any
// counts -- those are only ever exposed indirectly via the check action.
async function handlePuzzle(req, res) {
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
}

// POST { puzzleId, placed, newWord, position } -> { correct, correctIndex, count, points }
// Stateless, one guess per word: says whether the guessed slot is right,
// always includes the true correct index (so the client can auto-place a
// wrong guess into its real spot), the word's usage count (revealed once
// it's placed, right or wrong), and the pairwise-comparison points earned
// for this placement. No auth needed -- doesn't touch the DB.
async function handleCheck(req, res) {
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
    points: result.points,
  });
}

// POST { token, puzzleId, score } -> records a completed attempt.
// Every attempt is logged (not just best-of); the leaderboard aggregates
// down to each player's best (highest) score per puzzle.
async function handleComplete(req, res) {
  const body = req.body || {};
  const token = typeof body.token === 'string' ? body.token : null;
  const puzzleId = typeof body.puzzleId === 'string' ? body.puzzleId : null;
  const score = Number.isInteger(body.score) ? body.score : null;

  if (!token) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }
  if (!puzzleId || !getPuzzle(puzzleId)) {
    res.status(400).json({ error: 'Unknown puzzle.' });
    return;
  }
  if (score === null || score < 0 || score > MAX_SCORE) {
    res.status(400).json({ error: 'Invalid score.' });
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

    await pool.query(
      'INSERT INTO flashback_attempts (user_id, puzzle_id, score) VALUES ($1, $2, $3)',
      [userId, puzzleId, score]
    );

    const bestRes = await pool.query(
      'SELECT MAX(score)::int AS best FROM flashback_attempts WHERE user_id = $1 AND puzzle_id = $2',
      [userId, puzzleId]
    );

    res.status(200).json({ ok: true, score, best: bestRes.rows[0].best });
  } catch (err) {
    console.error('flashback complete error', err);
    res.status(500).json({ error: 'Server error, please try again.' });
  }
}

// GET -> one entry list per puzzle: { puzzles: [{ puzzleId, entries: [{
// username, score }] }] }, best (highest-score) attempt per player per
// puzzle, sorted best-first. Always includes all known puzzles, even ones
// nobody's attempted yet (empty entries array).
async function handleLeaderboard(req, res) {
  try {
    await ensureSchema();
    const pool = getPool();

    const { rows } = await pool.query(`
      WITH best AS (
        SELECT user_id, puzzle_id, MAX(score) AS score
        FROM flashback_attempts
        GROUP BY user_id, puzzle_id
      )
      SELECT b.puzzle_id, u.username, b.score
      FROM best b
      JOIN users u ON u.id = b.user_id
      ORDER BY b.puzzle_id ASC, b.score DESC, u.username ASC
    `);

    const entriesByPuzzle = new Map();
    for (const row of rows) {
      if (!entriesByPuzzle.has(row.puzzle_id)) entriesByPuzzle.set(row.puzzle_id, []);
      entriesByPuzzle.get(row.puzzle_id).push({ username: row.username, score: row.score });
    }

    const puzzles = listPuzzles().map(({ id }) => ({
      puzzleId: id,
      entries: entriesByPuzzle.get(id) || [],
    }));

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ puzzles });
  } catch (err) {
    console.error('flashback leaderboard error', err);
    res.status(500).json({ error: 'Server error, please try again.' });
  }
}

// POST { token } -> the signed-in player's own best (highest) score per
// puzzle they've completed, as a map: { puzzleId: score }. Puzzles not
// yet attempted are simply absent from the map.
async function handleProgress(req, res) {
  const token = typeof (req.body && req.body.token) === 'string' ? req.body.token : null;
  if (!token) {
    res.status(401).json({ error: 'Not signed in.' });
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

    const { rows } = await pool.query(
      'SELECT puzzle_id, MAX(score)::int AS score FROM flashback_attempts WHERE user_id = $1 GROUP BY puzzle_id',
      [userId]
    );

    const progress = {};
    for (const row of rows) progress[row.puzzle_id] = row.score;

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ progress });
  } catch (err) {
    console.error('flashback progress error', err);
    res.status(500).json({ error: 'Server error, please try again.' });
  }
}
