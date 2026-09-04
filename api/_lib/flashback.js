// The Ordering Game: place 8 crossword answers in order from
// most-to-least common (borrowed from NYT's "Flashback," swapping
// chronology for popularity). One guess per word -- a wrong guess
// auto-corrects into the true position and reveals that word's count.

const puzzles = require('../../data/flashback_puzzles.json');
const pool = require('../../data/flashback_pool.json');

const countByWord = new Map(pool.map((p) => [p.word, p.count]));
const puzzleById = new Map(puzzles.map((p) => [p.id, p]));

function listPuzzles() {
  return puzzles.map(({ id, theme, words }) => ({ id, theme: theme || null, wordCount: words.length }));
}

function getPuzzle(id) {
  return puzzleById.get(id);
}

function getCount(word) {
  return countByWord.get(word) || 0;
}

// True order for a puzzle, most common first. Server-internal only.
function getTrueOrder(id) {
  const puzzle = getPuzzle(id);
  if (!puzzle) return null;
  return [...puzzle.words].sort((a, b) => (countByWord.get(b) || 0) - (countByWord.get(a) || 0));
}

// Given the words already correctly placed (in their placed order) plus a
// new word being inserted at `position`, is that the correct slot? Works
// for any subset because relative order within a sorted list is preserved
// by any subset of it.
function checkPlacement(puzzleId, placed, newWord, position) {
  const puzzle = getPuzzle(puzzleId);
  if (!puzzle) return { valid: false };

  const wordSet = new Set(puzzle.words);
  if (!wordSet.has(newWord)) return { valid: false };
  if (!placed.every((w) => wordSet.has(w) && w !== newWord)) return { valid: false };

  const subset = [...placed, newWord].sort(
    (a, b) => (countByWord.get(b) || 0) - (countByWord.get(a) || 0)
  );
  const correctIndex = subset.indexOf(newWord);
  return { valid: true, correct: correctIndex === position, correctIndex };
}

// One guess per word; the first word never needs a guess. So a puzzle of
// N words has at most N-1 mistakes.
const MAX_MISTAKES = puzzles.length ? puzzles[0].words.length - 1 : 7;

module.exports = { listPuzzles, getPuzzle, getTrueOrder, checkPlacement, getCount, MAX_MISTAKES };
