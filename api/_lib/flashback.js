// Flashback: place 8 crossword answers in order from most-to-least common
// (borrowed from NYT's "Flashback," swapping chronology for popularity).
// Pool + puzzle word lists are static data; counts are never sent to the
// client directly, only pass/fail per placement attempt.

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

const MAX_MISTAKES = puzzles.length ? (puzzles[0].words.length - 1) * (puzzles[0].words.length) / 2 : 28;

module.exports = { listPuzzles, getPuzzle, getTrueOrder, checkPlacement, MAX_MISTAKES };
