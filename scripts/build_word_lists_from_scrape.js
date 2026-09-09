// Rebuilds data/words.json (top 501) and data/flashback_pool.json (the
// rest, down to count >= 2) from the verified ground-truth crawl in
// data/scrape_workdir/word_frequency_final.json -- see
// scripts/scrape_word_frequency.js for how that was produced.
//
// Note on counts vs. the site's own Popular page: this counts, per word,
// the number of distinct puzzle-days it appeared in (a puzzle that reuses
// the same word twice in one grid -- which does happen, especially with
// short fill -- counts once for that day). That's a deliberate choice, not
// a bug: it matches what actually matters for this game (you only need to
// find EMAIL once in a given puzzle's answer set, however many times it's
// in the grid), and it's why the very top of the list (ERA, ONE, ERE...)
// comes out 1-3 lower than before -- those are exactly the short, common
// words most likely to occasionally repeat within a single grid.
//
// Usage: node scripts/build_word_lists_from_scrape.js
// Writes data/words.json and data/flashback_pool.json directly. Doesn't
// touch anything else -- review the diff before committing/deploying.

const fs = require('fs');
const path = require('path');

const SCRAPE_PATH = path.join(__dirname, '..', 'data', 'scrape_workdir', 'word_frequency_final.json');
const WORDS_OUT = path.join(__dirname, '..', 'data', 'words.json');
const POOL_OUT = path.join(__dirname, '..', 'data', 'flashback_pool.json');
const PUZZLES_PATH = path.join(__dirname, '..', 'data', 'flashback_puzzles.json');

const MAIN_GAME_SIZE = 501;
// User-chosen floor: words used at least 20 times across 33 years still
// read as "a real, known crossword word" for the out-of-range guess
// message, without ballooning into every word ever repeated even once
// (count >= 2 alone would be 67,518 words -- most of it obscure one-off
// recurrences that wouldn't feel meaningful to surface to a player).
const EXTENDED_MIN_COUNT = 20;

function main() {
  const scraped = JSON.parse(fs.readFileSync(SCRAPE_PATH, 'utf8'));
  // Already sorted descending by the scraper, but don't rely on that.
  const sorted = [...scraped].sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));

  const top501 = sorted.slice(0, MAIN_GAME_SIZE).map((w, i) => ({
    num: i + 1,
    answer: w.word,
    length: w.word.length,
    count: w.count,
  }));

  const top501Words = new Set(top501.map((w) => w.answer));
  const beyond501 = sorted.slice(MAIN_GAME_SIZE);
  const beyond501ByWord = new Map(beyond501.map((w) => [w.word, w.count]));

  // The pool doubles as the Ordering Game's sort-order source for its
  // existing curated puzzles, which reference specific words regardless of
  // how common they are. Those must stay in the pool even if they fall
  // under the chosen threshold, or that puzzle breaks at runtime -- so the
  // pool is (count >= threshold) UNION (anything an existing puzzle needs).
  let puzzleWords = [];
  if (fs.existsSync(PUZZLES_PATH)) {
    const puzzles = JSON.parse(fs.readFileSync(PUZZLES_PATH, 'utf8'));
    puzzleWords = [...new Set(puzzles.flatMap((p) => p.words))];
  }
  const forcedInclusions = puzzleWords.filter(
    (w) => !top501Words.has(w) && beyond501ByWord.has(w) && beyond501ByWord.get(w) < EXTENDED_MIN_COUNT
  );
  if (forcedInclusions.length) {
    console.log(
      `Keeping ${forcedInclusions.length} word(s) below the count >= ${EXTENDED_MIN_COUNT} threshold because an existing Ordering Game puzzle depends on them: ${forcedInclusions.map((w) => `${w} (${beyond501ByWord.get(w)})`).join(', ')}`
    );
  }
  const missingEntirely = puzzleWords.filter((w) => !top501Words.has(w) && !beyond501ByWord.has(w));
  if (missingEntirely.length) {
    console.log(
      `WARNING: these Ordering Game puzzle words never appeared in the Modern Era crawl at all -- puzzles using them will break: ${missingEntirely.join(', ')}`
    );
  }

  const rest = beyond501
    .filter((w) => w.count >= EXTENDED_MIN_COUNT || forcedInclusions.includes(w.word))
    .map((w) => ({ word: w.word, count: w.count }));

  fs.writeFileSync(WORDS_OUT, JSON.stringify(top501, null, 2) + '\n');
  fs.writeFileSync(POOL_OUT, JSON.stringify(rest, null, 2) + '\n');

  console.log(`Wrote ${WORDS_OUT}: ${top501.length} words (rank 1-${top501.length}).`);
  console.log(`Wrote ${POOL_OUT}: ${rest.length} words (count >= ${EXTENDED_MIN_COUNT}, plus ${forcedInclusions.length} forced inclusion(s)).`);
  console.log(`Cutoff: rank ${top501.length} = ${top501[top501.length - 1].answer} (${top501[top501.length - 1].count}); next = ${beyond501[0].word} (${beyond501[0].count}).`);
}

main();
