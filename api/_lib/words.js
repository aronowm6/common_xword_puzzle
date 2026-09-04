// The 500 most common NYT crossword entries (Modern Era), sourced from
// https://www.xwordinfo.com/Popular, ranked 1 (most common) to 500.
const words = require('../../data/words.json');

const byNum = new Map(words.map((w) => [w.num, w]));
const byAnswer = new Map(words.map((w) => [w.answer, w]));

// Never expose `answer` to the client — only rank number + letter count.
function publicWords() {
  return words.map(({ num, length }) => ({ num, length }));
}

function getWord(num) {
  return byNum.get(Number(num));
}

// Freeform matching: does this typed guess exactly equal any of the 500
// answers, regardless of rank?
function findByAnswer(answer) {
  return byAnswer.get(answer);
}

module.exports = { words, publicWords, getWord, findByAnswer };
