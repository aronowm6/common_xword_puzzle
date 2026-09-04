# Common Xword

A Sporcle-style quiz: type in as many of the **501 most common NYT crossword
entries (Modern Era)** as you can. Entries are numbered 1&ndash;501 by
popularity; each one only shows a letter-count clue (blank tiles) and its
popularity count &mdash; no text clue. Word list scraped from
[xwordinfo.com/Popular](https://www.xwordinfo.com/Popular).

Matching is freeform: there's one entry bar, and typing any word that
exactly matches one of the 501 answers marks it solved immediately &mdash;
no need to select an entry first, and no need to press Enter.

Create a username + password to play (baseline security only &mdash; bcrypt
hashing, session tokens, lockout after repeated failed attempts &mdash; but
it's just a game, so use a throwaway password). Progress is saved to
Postgres and shows up on the public leaderboard alongside everyone else's.

## Stack

- **Frontend:** plain HTML/CSS/JS, black-and-white crossword theme (`public/`)
- **Backend:** Node.js serverless functions (`api/`), one file per endpoint
- **DB:** Postgres, hosted on [Neon](https://neon.tech) via the Vercel Marketplace

## Project layout

```
api/
  _lib/db.js          Postgres pool + idempotent schema bootstrap
  _lib/words.js        loads data/words.json, hides answers from clients
  _lib/validate.js      username/guess sanitizing
  _lib/auth.js            bcrypt hashing, session tokens, lockout constants
  login.js                 POST { username, password } -> register/login, returns a session token
  session.js                POST { token } -> silently resumes a session (no re-prompt)
  logout.js                   POST { token } -> invalidates the session server-side
  words.js                     GET -> [{ num, length, count }] for all 501 entries (no answers)
  guess.js                      POST { token, guess } -> freeform match against all 501 answers
  leaderboard.js                 GET -> every player, their count, and the words they've solved
data/
  words.json            the 501 entries: { num, answer, length, count }
public/
  index.html/app.js/style.css     the game
  leaderboard.html/leaderboard.js  the leaderboard
scripts/
  seed.js               one-time DB schema setup (reuses api/_lib/db.js's ensureSchema)
```

## Local setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL
npm run seed            # creates users/progress/sessions tables
npm run dev              # runs `vercel dev` (needs `vercel login` once)
```

The schema is also created lazily on first API request in production, so
`npm run seed` is a convenience, not a hard requirement.

## Environment variables

- `DATABASE_URL` &mdash; Postgres connection string. In production this is
  injected automatically by the Neon Vercel integration; locally, pull it
  with `vercel env pull .env.local`.

## Deploying

This repo is connected to Vercel via the GitHub integration: pushing to
`main` triggers an automatic production deploy. To do it manually instead:

```bash
vercel deploy --prod
```

Neon Postgres is provisioned through the Vercel Marketplace
(`vercel integration add neon`), which auto-creates the database and wires
`DATABASE_URL` into the project's environment variables for all
environments (production/preview/development) &mdash; no manual copying of
connection strings.

## Data

`data/words.json` holds the 501 entries as scraped from XWord Info's
"Popular" page (Modern Era view), each with its popularity rank, answer,
letter length, and popularity count (times used as an NYT crossword
answer). Ties in popularity are broken by the site's own ordering.
Answers are never sent to the browser &mdash; only `{ num, length, count }`
is exposed via `/api/words`; correctness is checked server-side in
`/api/guess`, authenticated by session token rather than a bare username.
