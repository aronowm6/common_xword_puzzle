// Crawls every daily NYT crossword puzzle (Modern Era: 11/21/1993, Will
// Shortz's first puzzle as editor, through 9/4/2026, matching the snapshot
// date of the site's own "Popular" ranking we've been using) from
// xwordinfo.com, and builds a real word -> occurrence-count frequency table
// from the actual answer list of every puzzle -- not an approximation.
//
// Why this exists: the previous extended word-pool data (data/flashback_pool.json)
// was found to have real, common words (e.g. TOGA) missing entirely, and
// there's no record in this repo of how it was generated -- no scraper
// script, and the live xwordinfo.com/Popular page truncates at 501 rows
// for every era filter, so that data could not have come from it directly.
// This script replaces guesswork with a ground-truth crawl.
//
// Requires a logged-in xwordinfo.com session cookie (paste the raw Cookie
// header value into the file at COOKIE_PATH below -- see the project
// conversation for how it was obtained). Never commit that cookie file.
//
// Usage: node scripts/scrape_word_frequency.js
// Resumable: safe to re-run after an interruption -- picks up the day
// after the last successfully-checkpointed date.

const fs = require('fs');
const path = require('path');

const COOKIE_PATH =
  process.env.XWORDINFO_COOKIE_PATH ||
  '/private/tmp/claude-501/-Users-milesaronow/6037bf3b-26c9-46d5-ac0a-db368207aa30/scratchpad/xwordinfo_cookie.txt';

const OUT_DIR = path.join(__dirname, '..', 'data', 'scrape_workdir');
const CHECKPOINT_PATH = path.join(OUT_DIR, 'checkpoint.json');
const LOG_PATH = path.join(OUT_DIR, 'scrape.log');
const FINAL_PATH = path.join(OUT_DIR, 'word_frequency_final.json');

// Modern Era, per live verification against xwordinfo: dates before
// 11/21/1993 redirect from /Crossword to a separate /PS (Pre-Shortz) URL,
// and 11/21/1993 is the first date whose page reports "Editor: Will Shortz".
// Overridable via env vars for a quick smoke-test run on a small range.
const START_DATE = new Date(`${process.env.SCRAPE_START_DATE || '1993-11-21'}T00:00:00Z`);
// Matches the snapshot date already printed in the site footer/header
// ("Data as of 9/4/2026"), per the user's request to exclude 9/5-today.
const END_DATE = new Date(`${process.env.SCRAPE_END_DATE || '2026-09-04'}T00:00:00Z`);

const DELAY_MS = 700; // polite pacing -- ~1.4 req/s sustained
const MAX_RETRIES = 4;
const CHECKPOINT_EVERY = 50; // calendar days iterated, success or failure

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function fmtDate(d) {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + '\n');
}

async function fetchPuzzle(dateStr, cookie) {
  const url = `https://www.xwordinfo.com/Crossword?date=${dateStr}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Cookie: cookie,
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.text();
}

// Answers live inside #CPHContent_ClueBox as <a href="/Finder?w=WORD">WORD</a>
// links, one per clue. The page also has unrelated Finder links elsewhere
// (sidebar/trending), so we scope extraction strictly to that section --
// verified against a sample puzzle where scraping the whole page pulled in
// 115 links for only 76 real answers, while scoping to the clue box matched
// the page's own declared wordCount exactly.
function extractAnswers(html) {
  const startMarker = html.indexOf('CPHContent_ClueBox');
  const endMarker = html.indexOf('CPHContent_AnsSumPan');
  if (startMarker === -1 || endMarker === -1 || endMarker < startMarker) {
    return null; // no puzzle content found on this page
  }
  const section = html.slice(startMarker, endMarker);
  const words = new Set();
  const re = /Finder\?w=([A-Z0-9]+)"/g;
  let m;
  while ((m = re.exec(section))) {
    words.add(m[1]);
  }
  const wcMatch = html.match(/"wordCount":\s*(\d+)/);
  const declaredCount = wcMatch ? Number(wcMatch[1]) : null;
  return { words, declaredCount };
}

function isLoginWall(html) {
  return /purchase a subscription to view/i.test(html);
}

// The cookie file may be either (a) a bare "name=value; name2=value2" Cookie
// header string, or (b) a DevTools "copy request headers" dump, which lists
// each header name and value on alternating lines (":authority" / value /
// "method" / value / ... / "cookie" / <the actual cookie string>). Handle
// both so however it was captured, we end up with just the real value.
function parseCookieFile(raw) {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const cookieLineIdx = lines.findIndex((l) => l.toLowerCase() === 'cookie');
  if (cookieLineIdx !== -1 && lines[cookieLineIdx + 1]) {
    return lines[cookieLineIdx + 1];
  }
  // Fallback: assume the whole trimmed content is already the cookie string.
  return raw.trim();
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cookie = parseCookieFile(fs.readFileSync(COOKIE_PATH, 'utf8'));
  if (!cookie || cookie.length < 10 || /^:authority/i.test(cookie)) {
    throw new Error(`Could not parse a usable cookie value from ${COOKIE_PATH}`);
  }

  let state = {
    counts: {},
    lastDate: null,
    puzzlesProcessed: 0,
    puzzlesSkipped: 0,
    wordCountMismatches: [],
    errors: [],
  };
  if (fs.existsSync(CHECKPOINT_PATH)) {
    state = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'));
    log(
      `Resuming from checkpoint: lastDate=${state.lastDate}, puzzlesProcessed=${state.puzzlesProcessed}, uniqueWords=${Object.keys(state.counts).length}`
    );
  } else {
    log(`Starting fresh crawl: ${fmtDate(START_DATE)} -> ${fmtDate(END_DATE)}`);
  }

  let cur = state.lastDate ? new Date(new Date(state.lastDate).getTime() + 86400000) : new Date(START_DATE);
  let iterCount = 0;

  while (cur <= END_DATE) {
    const dateStr = fmtDate(cur);
    let attempt = 0;
    let done = false;

    while (attempt < MAX_RETRIES && !done) {
      attempt++;
      try {
        const html = await fetchPuzzle(dateStr, cookie);

        if (isLoginWall(html)) {
          log(`AUTH FAILURE at ${dateStr} -- cookie appears expired/invalid. Stopping so it can be refreshed.`);
          fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(state, null, 2));
          process.exit(1);
        }

        const extracted = extractAnswers(html);
        if (!extracted) {
          log(`WARN: no clue box found for ${dateStr} -- skipping (marked processed, not retried).`);
          state.puzzlesSkipped++;
        } else {
          const { words, declaredCount } = extracted;
          if (declaredCount !== null && declaredCount !== words.size) {
            const note = `${dateStr}: page declared wordCount=${declaredCount}, parsed ${words.size}`;
            log(`WARN: ${note}`);
            state.wordCountMismatches.push(note);
          }
          for (const w of words) {
            state.counts[w] = (state.counts[w] || 0) + 1;
          }
          state.puzzlesProcessed++;
        }
        state.lastDate = isoDate(cur);
        done = true;
      } catch (err) {
        log(`ERROR on ${dateStr} attempt ${attempt}/${MAX_RETRIES}: ${err.message}`);
        if (attempt < MAX_RETRIES) {
          await sleep(2000 * attempt);
        } else {
          state.errors.push({ date: dateStr, error: err.message });
          state.lastDate = isoDate(cur); // give up on this date, don't get stuck forever
          done = true;
        }
      }
    }

    iterCount++;
    if (iterCount % CHECKPOINT_EVERY === 0) {
      fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(state, null, 2));
      log(
        `Checkpoint: ${state.puzzlesProcessed} processed, ${state.puzzlesSkipped} skipped, ${state.errors.length} errors, up to ${state.lastDate}`
      );
    }

    cur = new Date(cur.getTime() + 86400000);
    await sleep(DELAY_MS);
  }

  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(state, null, 2));
  log(
    `DONE. Puzzles processed: ${state.puzzlesProcessed}, skipped: ${state.puzzlesSkipped}, errors: ${state.errors.length}, unique words: ${Object.keys(state.counts).length}`
  );
  if (state.errors.length) {
    log(`Dates with unresolved errors (may need manual re-check): ${state.errors.map((e) => e.date).join(', ')}`);
  }

  const sorted = Object.entries(state.counts)
    .sort((a, b) => b[1] - a[1])
    .map(([word, count]) => ({ word, count }));
  fs.writeFileSync(FINAL_PATH, JSON.stringify(sorted, null, 2));
  log(`Wrote ${FINAL_PATH} (${sorted.length} unique words).`);
}

main().catch((err) => {
  log(`FATAL: ${err.stack}`);
  process.exit(1);
});
