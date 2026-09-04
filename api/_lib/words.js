// The 500 most common NYT crossword entries (Modern Era), sourced from
// https://www.xwordinfo.com/Popular, ranked 1 (most common) to 500.
const words = require('../../data/words.json');

const byNum = new Map(words.map((w) => [w.num, w]));

// Never expose `answer` to the client — only rank number + letter count.
function publicWords() {
  return words.map(({ num, length }) => ({ num, length }));
}

function getWord(num) {
  return byNum.get(Number(num));
}

module.exports = { words, publicWords, getWord };
