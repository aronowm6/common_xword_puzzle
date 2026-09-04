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
//
// Also scores the guess: placing a word among N already-placed words
// implicitly makes N pairwise comparisons at once ("more/less common than
// each of these"). If the guess is off by `k` slots from the true
// position, exactly `k` of those comparisons are wrong -- the rest are
// still right, since your judgment about everything outside that range
// didn't actually change. So points = N - |guess - true position|,
// bounded between 0 and N. Summed across all placements in a puzzle, this
// totals exactly C(wordCount, 2) -- full pairwise-comparison scoring,
// computed for free from the normal one-guess-per-word flow.
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
  const points = placed.length - Math.abs(position - correctIndex);
  return { valid: true, correct: correctIndex === position, correctIndex, points };
}

// Max possible score for a puzzle of N words: every pair compared once,
// C(N, 2) = N*(N-1)/2. The first word is never guessed, so this is the
// same as summing 1+2+...+(N-1).
function maxScore(wordCount) {
  return (wordCount * (wordCount - 1)) / 2;
}

const MAX_SCORE = puzzles.length ? maxScore(puzzles[0].words.length) : 28;

module.exports = { listPuzzles, getPuzzle, getTrueOrder, checkPlacement, getCount, maxScore, MAX_SCORE };
