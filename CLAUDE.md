# The 501 Challenge

A Sporcle-style crossword quiz game, hosted free on Vercel + Neon Postgres at
https://the501challenge.vercel.app. Players guess the 501 most common NYT
crossword entries (Modern Era = Will Shortz's tenure as editor, which began
11/21/1993 — confirmed live against xwordinfo.com, not just assumed).

Two game modes:
- **Main game** (`public/index.html`/`app.js`): freeform, type-any-answer,
  checked live as you type against all 501 words regardless of order.
- **Ordering Game** (`public/ordering_game.html`/`flashback.js`, internally
  still called "flashback" in code/API routes): place 8 crossword entries in
  order from most-to-least common. Curated puzzles in `data/flashback_puzzles.json`.

Accounts (username + bcrypt password), guest play (checked server-side but
never persisted), and per-game leaderboards.

## Critical constraint: Vercel's 12-function limit

The Hobby (free) plan hard-caps a deployment at **12 serverless functions**.
This has already caused a real production outage once (deploy silently
failed). The Ordering Game's endpoints were consolidated from 6 separate
files into one `action`-dispatched file, `api/flashback.js`, specifically to
stay under this limit. **Before adding a new file under `api/`, count what's
already there** — prefer adding an `action` branch to an existing
action-dispatched file over creating a new one.

## Architecture

- `api/_lib/words.js` — word-list module: `publicWords()`, `getWord(num)`,
  `findByAnswer(answer)`, `findExtendedRank(answer)`. Never exposes raw
  answers to the client beyond what's needed.
- `api/_lib/db.js` — Postgres pool + `ensureSchema()` (idempotent, safe to
  call on every request; `scripts/seed.js` reuses it so schema can't drift).
- `api/_lib/auth.js`, `api/_lib/validate.js` — auth helpers, guess normalization.
- `api/guess.js` — main game's guess-checking endpoint. Session-token
  authenticated (not bare username) so guesses can't be forged for someone
  else. Guest requests (`token` omitted) are still checked, just never
  persisted.
- `api/flashback.js` — all Ordering Game endpoints, `action`-dispatched.
- `data/words.json` — top 501, `{num, answer, length, count}`.
- `data/flashback_pool.json` — everything else worth recognizing (see Data
  pipeline below), `{word, count}`, no overlap with the top 501 (so nothing
  spoils the main game).
- `public/*.js` — vanilla JS, no framework, no build step. `auth.js` +
  `auth-ui.js` hold shared login/session logic used by both game pages.

## Data pipeline: how the word lists are built

This has bitten us before — the original `data/flashback_pool.json` had no
scraper committed anywhere, so when a real gap turned up (TOGA, a genuinely
common answer, was missing entirely) there was no way to tell why. Don't let
this happen again: any future change to the word data should go through the
scripts below, not a one-off hand-edit.

- **`scripts/scrape_word_frequency.js`** — crawls every daily NYT crossword
  from xwordinfo.com (`/Crossword?date=M/D/YYYY`), 11/21/1993 through
  whatever end date is configured, building a real word → occurrence-count
  table from each puzzle's actual answer list. Requires a logged-in
  xwordinfo.com session cookie (the user has a paid subscription) — read
  from `XWORDINFO_COOKIE_PATH`, accepts either a bare `Cookie:` header value
  or a full DevTools "copy request headers" dump. Resumable via a checkpoint
  file; takes ~2.5–3.5 hours for the full historical range at its default
  polite rate limit. Counts represent **distinct puzzle-days a word
  appeared**, not raw clue-slot count — deliberate, since that's what
  actually matters for the game (a word reused twice in one grid still only
  needs to be found once). This is why our counts run 1-2 below the site's
  own published numbers for words that occasionally repeat within a single
  grid, and exactly match for words that never do — that's expected, not a bug.
- **`scripts/build_word_lists_from_scrape.js`** — reconciles the raw crawl
  output (cached at `data/scrape_workdir/word_frequency_final.json`, ~130k
  words down to count=1, gitignored) into the two real data files. Rebuilding
  with a different threshold is just editing `EXTENDED_MIN_COUNT` and
  re-running this script — no need to re-scrape. Current threshold: **count
  ≥ 20** (~9,900 words), chosen over the fully exhaustive count ≥ 2 option
  (67,518 words, mostly one-off obscure recurrences not worth surfacing).
  Always force-includes any word an existing `flashback_puzzles.json` puzzle
  depends on, even if it falls under the threshold, so old puzzles don't
  break.
- The data snapshot is dated "as of 9/4/2026" throughout the site (header,
  footer). If it's ever refreshed, update that date in `public/index.html`
  and `public/ordering_game.html` to match the new crawl's end date.
- At the top-501 boundary there will usually be a multi-way tie (currently
  8 words tied at count=180) — whichever subset lands in vs. out of exactly
  501 is arbitrary among the tied words. This is normal for any fixed-size
  "top N" cut, not a bug worth chasing.

## Established conventions

- **Guest mode**: server-side checks always happen; persistence is simply
  skipped when no session token is present. Don't special-case guest logic
  deeper than that.
- **Live-as-you-type checking uses a FIFO queue, not debounce.** Debouncing
  was found to silently drop fast-typed intermediate values (e.g. typing
  "RENO" fast could skip ever checking "REN"). Every distinct value gets
  queued and checked in order, awaited sequentially so out-of-order network
  responses can't reorder results.
- **Feedback message "kind" tracking** (`neutral`/`info`/`correct`/`error`
  in `app.js`): a "Got it" message persists until the next real event, but
  "already found" / "out of range" messages are informational-only and
  clear themselves once the player types past the guess they described —
  otherwise a stale message sits on screen describing text no longer in the box.
- **Never expose unsolved answers or counts to the client** beyond the
  public word list's `{num, length, count}` shape.

## Keeping this file current

When a session makes an architectural decision, discovers a non-obvious
constraint/gotcha, establishes a convention that isn't evident from the code
itself, or fixes a bug that cost real debugging time because context was
missing — add it here proactively, before ending the task, rather than
waiting to be asked. Don't turn this into a per-commit checklist item
(routine work doesn't belong here); apply it only at those trigger moments.
Prune stale entries too, not just append.

## Deploy workflow

1. Syntax-check changed files (`node --check`) before committing.
2. Commit, then `git push`.
3. **Explicitly verify** via `vercel ls` — confirm `Ready`, not `Error`, on
   the newest deployment. Never assume a push succeeded; the 12-function
   limit has caused a silent deploy failure before.
4. Run live `curl`/`vercel curl` checks against
   `https://the501challenge.vercel.app` for whatever changed.
5. If verification created test accounts/data, clean them up via direct DB
   deletion afterward.
