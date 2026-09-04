# Common Xword

A Sporcle-style quiz: type in as many of the **500 most common NYT crossword
entries (Modern Era)** as you can. Entries are numbered 1&ndash;500 by
popularity, and each one only gives you a length clue (blank tiles) &mdash;
no text clue. Word list scraped from
[xwordinfo.com/Popular](https://www.xwordinfo.com/Popular).

Enter any username (no password) to start; your solved words are saved to
the database and show up on the public leaderboard alongside everyone
else's progress.

## Stack

- **Frontend:** plain HTML/CSS/JS, black-and-white crossword theme (`public/`)
- **Backend:** Node.js serverless functions (`api/`), Vercel-style handlers
- **DB:** Postgres (built for Supabase's free tier, but any Postgres works)

## Project layout

```
api/
  _lib/db.js         Postgres pool + idempotent schema bootstrap
  _lib/words.js       loads data/words.json, hides answers from clients
  _lib/validate.js    username/guess sanitizing
  login.js            POST { username } -> creates user, returns their solved list
  words.js             GET -> [{ num, length }] for all 500 entries (no answers)
  guess.js              POST { username, num, guess } -> checks + persists a correct guess
  leaderboard.js         GET -> every player, their count, and the words they've solved
data/
  words.json           the 500 entries: { num, answer, length }
public/
  index.html/app.js/style.css     the game
  leaderboard.html/leaderboard.js  the leaderboard
scripts/
  seed.js              one-time DB schema setup
```

## Local setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL
npm run seed            # creates users/progress tables
npm run dev              # runs `vercel dev` (needs `npx vercel login` once)
```

The schema is also created lazily on first API request in production, so
`npm run seed` is a convenience, not a hard requirement.

## Environment variables

- `DATABASE_URL` &mdash; Postgres connection string (e.g. your Supabase
  project's connection string, "Session pooler" or direct connection both
  work).

## Deploying

1. Create a free Postgres DB (e.g. a new Supabase project) and copy its
   connection string into `DATABASE_URL`.
2. Push this repo to GitHub.
3. Import the repo into Vercel, add the `DATABASE_URL` environment
   variable in the Vercel project settings, and deploy.

## Data

`data/words.json` holds the 500 entries as scraped from XWord Info's
"Popular" page (Modern Era view), each with its popularity rank, answer,
and letter length. Ties in popularity are broken by the site's own
ordering. Answers are never sent to the browser &mdash; only `{ num, length }`
is exposed via `/api/words`; correctness is checked server-side in
`/api/guess`.
