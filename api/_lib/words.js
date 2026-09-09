// The 501 most common NYT crossword entries (Modern Era), sourced from
// https://www.xwordinfo.com/Popular, ranked 1 (most common) to 501.
const words = require('../../data/words.json');

// The Ordering Game's word pool: everything ranked just past 501,
// continuing the same popularity ordering. Reused here to tell a player
// "that's a real common answer, just not in the top 501" instead of
// staying silent on an unmatched guess.
const extendedPool = require('../../data/flashback_pool.json');

const byNum = new Map(words.map((w) => [w.num, w]));
const byAnswer = new Map(words.map((w) => [w.answer, w]));

const extendedRankByAnswer = new Map(
  extendedPool.map((w, i) => [w.word, { rank: words.length + 1 + i, count: w.count }])
);

// Never expose `answer` to the client — rank number, letter count, and
// popularity count (how many NYT puzzles used it) are all fair to show.
function publicWords() {
  return words.map(({ num, length, count }) => ({ num, length, count }));
}

function getWord(num) {
  return byNum.get(Number(num));
}

// Freeform matching: does this typed guess exactly equal any of the 501
// answers, regardless of rank?
function findByAnswer(answer) {
  return byAnswer.get(answer);
}

// Not one of the top-501 answers, but still a known common crossword
// word -- returns its rank (e.g. 736) and count so the player can be told
// "that's a real word, just not in the top 501" instead of just silence.
function findExtendedRank(answer) {
  return extendedRankByAnswer.get(answer) || null;
}

module.exports = { words, publicWords, getWord, findByAnswer, findExtendedRank };
