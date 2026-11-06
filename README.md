# Let Them Eat Tokens

The court gazette of artificial intelligence: AI CEOs ranked by the pitchforks their own public statements raised. Every quote is real, word for word, with its sources; every score is the court's opinion, with its reasons.

The site is rendered on the server: a TypeScript app on Express turns the statements into HTML, and small scripts in `public/` add the ticker, the race chart's hover, the dialogs and the forms. The statements live in one SQLite file through Prisma. Every statement gets a share link with its own preview, and the owner has a CMS at `/admin`. A daily scout finds new statements, proves their quotes and scores them, and leaves them in the CMS for the owner to approve.

## Run it

Node 24 or later.

```bash
npm run bootstrap   # installs, generates the Prisma client, creates .env.local and the database
```

Fill in `JWT_SECRET` and `SUPER_USER` in `.env.local`, then:

```bash
npm run seed:dev    # a fresh dev database with sample CMS data
npm run dev         # the server with reload, on http://localhost:3000
```

`npm run seed:dev` runs only with `NODE_ENV=development`. It deletes the dev database and its photo store and builds them again: everything `npm run seed:min` adds, then sample history, disputes, suggestions, scout proposals and runs, so the CMS has something in every screen. Three of the seed's statements are held back as the scout's proposals. It also adds a second admin, `dev@example.com` with the password `development`.

| Setting | Default | What it does |
|---|---|---|
| `NODE_ENV` | required | `development`, `production` or `test`; production adds HSTS and upgrades insecure requests, so serve it over HTTPS |
| `DATABASE_URL` | required | the SQLite file, e.g. `file:./var/ltet.db`; keep it on a persistent disk and out of the repository. Its folder also holds the contenders' photos and the scout's work files |
| `JWT_SECRET` | required | at least 32 random characters, to sign the CMS's login |
| `SUPER_USER` | none | `email,firstname,lastname,password`, the owner's CMS login; read only by the seeds, to create the admin |
| `PORT` | `3000` | the port the server listens on |
| `PUBLIC_URL` | each request's own address | the site's public address, e.g. `https://example.com`, used in link previews |
| `JWT_EXPIRE_MS` | 30 days | how long a CMS login lasts |
| `BCRYPT_ROUNDS` | `12` | the cost of the password hash, 4 to 12 |
| `LOG_LEVEL` | `info` in production | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` |
| `TRUST_PROXY` | `loopback` | Express's "trust proxy": loopback trusts a reverse proxy on the same machine, a number trusts that many hops, `0` trusts none |

The settings are read from `.env`, `.env.default`, `.env.local` and `.env.prod` in the working directory, and the process's own environment overrides them. `.env.example` lists them all.

Behind a reverse proxy on the same machine (nginx, Caddy), the server reads `X-Forwarded-Proto` and `Host`, so `PUBLIC_URL` is optional; set it when the proxy is elsewhere.

## Deploy

On the server, with Node 24, from the repository, first put the settings in `.env.prod`. Every step below reads them, `npm run db:generate` included:

```bash
cp .env.example .env.prod
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # a JWT_SECRET
```

Then edit `.env.prod` so it holds at least:

```dotenv
NODE_ENV=production
DATABASE_URL=file:./var/ltet.db
JWT_SECRET=<the 64 characters printed above>
SUPER_USER=you@example.com,Firstname,Lastname,<a long password>
PORT=3000
```

The other settings in the table above are optional. Then:

```bash
npm ci
npm run db:generate   # the Prisma client, which the build compiles in
npm run build         # TypeScript to dist/
mkdir -p var          # the folder of DATABASE_URL, which SQLite does not create
npm run db:deploy     # applies the migrations, a new database included
npm run seed:min      # once, before the first start
npm start             # node dist/index.js
```

The service's own environment can hold the settings instead of `.env.prod`, but the shell that runs these steps needs them too. `npm run seed:min` fills the new database: the admin from `SUPER_USER`, and the contenders, the rubric and the statements from the seed files, with the photos copied into the photo store. It refuses a database that already holds anything, so run it once, before the first start, and leave it out after an update. After an update, run the other steps again and restart the server. `/healthz` answers 200 while the database answers and 503 when it doesn't, for the proxy or a monitor.

### Backups

Back up the database and the photo store once a day from cron. This needs the `sqlite3` command line tool on the server (`apt install sqlite3` on Debian or Ubuntu). Its `.backup` makes a consistent copy while the server keeps writing, which copying the file would not.

```cron
0 4 * * * cd /path/to/let-them-eat-tokens && { mkdir -p var/backup && d=$(date +\%a) && sqlite3 var/ltet.db ".backup var/backup/ltet-$d.db" && rm -rf var/backup/photos-$d && cp -r var/photos var/backup/photos-$d; } >> var/backup.log 2>&1
```

Each copy is named after its weekday (`ltet-Mon.db`, `photos-Mon/`), so there are seven, and each run overwrites last week's. A crontab turns a bare `%` into a newline, hence `\%a`. Change `var/ltet.db` and `var/photos` if `DATABASE_URL` points elsewhere.

To restore, from the repository:

1. Stop the server.
2. Put the copies back, and delete the old write-ahead files so SQLite doesn't apply them to the restored database:
   ```bash
   cp var/backup/ltet-Mon.db var/ltet.db
   rm -f var/ltet.db-wal var/ltet.db-shm
   rm -rf var/photos && cp -r var/backup/photos-Mon var/photos
   ```
3. Start the server.

## What the server serves

All time has no prefix; a season goes in front, as in `/25-26/results` or `/25-26/club/altman`. An old `/all-time/...` address moves for good to the same path without the prefix.

| Path | Serves |
|---|---|
| `/` | the league table, with the site's preview tags |
| `/results` | every result, filtered with `?ceo=`, `?count=` and `?sort=` (`newest`, `oldest`, `pitchforks`) |
| `/race` | the race chart |
| `/honours` | the honours |
| `/club/<id>` | a contender's club page |
| `/match/<id>` | a statement's match report; on a list it opens in a dialog |
| `/rules` | the rules, with the photo credits |
| `/s/<id>` | a share page with the statement's own preview (headline, pitchforks, image) that forwards to `/match/<id>` |
| `/og.png` | the site's preview image, with the all-time table |
| `/og/<id>.png` | a statement's preview image |
| `/api/dispute`, `/api/suggest` | visitors' feedback: a score dispute, a statement worth adding; each lands in the CMS inbox |
| `/admin/` | the owner's CMS |
| `/healthz` | the health check |
| everything else | the files in `public/` |

An unknown page gets a 404 in the site's style. Preview images are drawn on first request with [satori](https://github.com/vercel/satori) and [resvg](https://github.com/yisibl/resvg-js), and kept in memory until a statement, a contender or the rubric changes.

## The data

| File | Holds |
|---|---|
| `prisma/seed/ceos.json` | the seed: the contenders a new database starts with, each with its photo's credit (author, licence, source) |
| `prisma/seed/photos/<id>.jpg` | the seed photos, which `npm run seed:min` copies into the photo store: free-licensed (public domain, CC BY, CC BY-SA) from Wikimedia Commons, cropped; the Rules page credits each |
| `prisma/seed/rubric.json` | the seed: the scoring counts, their weights, the honours and titles |
| `prisma/seed/statements.json` | the seed: the statements a new database starts with |
| `var/ltet.db` | the database (`DATABASE_URL`): the statements as they are now, their history, the contenders, the rubric, the CMS inbox, the scout's runs, the admin |
| `var/photos/<id>.jpg` | the photo store beside the database, served at `/assets/ceos/<id>.jpg` and drawn into the previews |

`npm run seed:min` fills a new database from the seed files; from then on the database is the record, and the CMS is how it changes.

A statement's pitchforks are the sum of its scores (0 to 5 on each count) times each count's weight. `src/lib/score.ts` does the arithmetic, so a correction is an edit to the data and nothing else.

## The CMS

Log in at `/admin/` with the email and password from `SUPER_USER`, the email in any letter case. It has six screens:

- **Inbox**: what waits for you. A proposed statement shows its record, what the checks found (on how many sites the quote was found word for word, whether the headline is on its page), and its scores, which you can change before **Approve and publish** puts it live. Every other field is editable as JSON below the scores. A visitor's suggestion shows the link, what they remembered and, after the scout's next run, what the scout found. A score dispute shows the count, the current score and the visitor's reason; change the score on the statement, then close the dispute. **Reject** takes a reason; the scout reads the reasons and does not propose a rejected statement again.
- **Statements**: every statement, searchable; edit one, hide it from the site or show it again. Every change keeps the version before it, with a note, and any version can be loaded back into the editor.
- **Contenders**: every contender with their photo and how many statements they have. Add one (it goes last in the table; its id is set then and never changes, since statements point at it), edit the name, company and photo credits, upload a photo (JPEG, at most 2 MB; it replaces the old one) or remove it, in which case the crest shows. A contender with statements, hidden ones included, can't be deleted. A replaced photo can take up to an hour to show in a visitor's browser, which keeps the old one cached; the previews redraw at once.
- **Rubric**: the unit's name and, per count, its name, question, what scores 0, 1, 3 and 5, weight (a whole number from 1 to 10), award name and award text. A weight change rescores every statement at once. Counts can't be added or removed.
- **Scout runs**: **Run the scout** starts a run now, with an optional since date and a dry run that sends nothing to the inbox, and the next scheduled time beside it. Every run, 30 a page, with who started it (the schedule, an admin's email, or by hand). A running run's page shows its log as it is written, refreshes every 5 seconds and has a **Stop** button. A finished one shows its counts, links to the proposals it made, and its full log, including what was dropped and why.
- **Settings**: change the password, which signs out every other session, and set the time of the scout's daily run (UTC, 06:00 until changed).

A login lasts 30 days (`JWT_EXPIRE_MS`). Logging out signs out every session. Five wrong passwords from one address lock it out for 15 minutes.

## The scout

The server starts the scout once a day, at the time set in the CMS's Settings, on the owner's Claude subscription through Claude Code in headless mode:

1. **Find**: Claude, with web search and web fetch only, looks for statements since the last good run (overlapping it by three days) that meet the bar in "Adding a statement" below, and researches visitors' suggestions.
2. **Fetch**: the scout's own code loads every page a lead names.
3. **Write and score**: Claude, with no tools at all, writes each lead up from that page text, copies the quote character for character, and scores it against the rubric and a spread of the record's own scores.
4. **Verify**: code alone checks the shape, looks for duplicates, and fetches the pages again to find every fragment of the quote word for word, the same check as `npm run check:sources`. A quote found on no page is never proposed.
5. **Propose**: what passed goes to the inbox, marked "verified" when the quote is on two or more sites.

Claude never gets a shell or a file tool: it reads the web and answers in JSON, and the scout's code does every write. The prompts are in `prompts/`. The scout runs from `dist/`, so build first.

The schedule runs only when `NODE_ENV` is `production`, so a dev server never spends the subscription. A time missed while the server was down is skipped, not caught up. The server starts each run, scheduled or from the CMS, as its own process, so restarting the server doesn't end a run; the run's output also goes to `scout.log` beside the database. One run goes at a time: the CMS refuses to start another, the schedule skips its time, and `npm run scout` by hand refuses too. A run still marked running after three hours is taken to have died, and the server marks a run failed as soon as its process is gone, before it starts the next one. **Stop** ends the run's process by its pid, after checking that the pid is still this app's scout, waits up to five seconds for it to end, and marks the run stopped if the scout could not.

Set it up on the server once:

```bash
curl -fsSL https://claude.ai/install.sh | bash   # Claude Code (or: npm install -g @anthropic-ai/claude-code)
claude setup-token                               # log in with the subscription's account; prints a long-lived token
export CLAUDE_CODE_OAUTH_TOKEN=<the token>
node dist/scout.js --dry-run                     # a trial: prints what it would propose, writes nothing
```

Then give the server's own environment the token, `CLAUDE_CODE_OAUTH_TOKEN=<the token>` (and `CLAUDE_BIN` when `claude` is not on its `PATH`), since the scout it starts inherits it. The server leaves `SUPER_USER` and `JWT_SECRET` out of the scout's environment.

To change the token later, paste it under Claude token in the CMS's Settings. It is stored in the database encrypted with a key derived from `JWT_SECRET`, is never shown again, and goes to every scout the server starts from then on, ahead of the environment's. Remove falls back to the environment's token. If `JWT_SECRET` changes, the saved token can't be read any more: Settings says so, and the scout uses the environment's token until it is pasted again. `npm run scout` by hand uses its own shell's environment.

The scout removes `ANTHROPIC_API_KEY` from Claude Code's environment, since in headless mode Claude Code bills that key whenever it is set: runs always use the subscription.

A run takes a few minutes and uses about a dollar's worth of the subscription's usage (Claude Code's list-price estimate, in each run's log). `--since YYYY-MM-DD` looks back to a given date, the same as the CMS's since field; `SCOUT_MODEL` picks the model (default `opus`); `CLAUDE_BIN` points at the `claude` binary when it is not on the server's `PATH`. A dry run from the CMS is saved as a run marked "Dry run", with what it would propose in its log; `--dry-run` by hand only prints. Dry runs never count as the last good run. A run that finds nothing is a good run: a quiet week is a valid result.

## Check it

```bash
npm run check           # the data's shape: dates, sources, scores, reasons
npm run check:sources   # also fetches every page: each quote must appear, word for word, on its quoteSource page
```

A page behind a paywall or a bot wall cannot be fetched; such a statement records a `manualCheck` with the date and a note on how it was confirmed. Run the full check before publishing a change to the data.

## Develop

| Script | Does |
|---|---|
| `npm run dev` | the server with reload, through tsx |
| `npm run build`, `npm start` | compiles to `dist/` and runs it |
| `npm run test:unit` | the unit tests, per layer in `tests/unit` |
| `npm run test:e2e` | the e2e tests in `tests/e2e`, against a test server on a fresh database from `.env.test`; the layout checks need Chromium once, from `npx playwright install chromium` |
| `npm run format` | Prettier over the repository |
| `npm run db:migrate` | a new migration after a change to `prisma/schema.prisma` |
| `npm run db:studio` | Prisma Studio on the database |
| `npm run clean` | removes what can be rebuilt; `npm run bootstrap` sets it up again |

The code lives in `src/`: `lib` for the rules and the arithmetic, `repositories` for the queries, `services`, `routers` and `middleware`, and `ui` for the views, which are functions returning HTML. CI runs the build, both test suites and a security job (npm audit, gitleaks, semgrep) on every pull request, and a Claude review comments on each. The build and test scripts go through `tools/heavy.mjs`, which waits for a free slot where mingo is installed and runs at once where it isn't.

## Adding a statement

Statements come in through the CMS: the scout's proposals, visitors' suggestions, or an edit of your own. To enter the record a statement must be the contender's own words, said in public or leaked and reported (`"leaked": true`), about technology, work or the people who use it, with documented negative reception, and at least two sources from different outlets. One statement per occasion. `quote` is copied from the page in `quoteSource`; the headline is the outlet's, verbatim.
