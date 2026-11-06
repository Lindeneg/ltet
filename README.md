# Let Them Eat Tokens

The court gazette of artificial intelligence. The most powerful men in tech play in a football league, and they score by saying things in public that send the public reaching for its pitchforks.

Live at [let-them-eat-tokens.com](https://let-them-eat-tokens.com).

## The rules

- Every quote is real, word for word, and backed by at least two outlets.
- A statement scores on how it landed with the public, not on whether it was true.
- Only what they said about technology, work or the people who use it, from 30 November 2022 on.
- Leaked remarks count, and say so.
- The referee is biased, and admits it: every score comes with its reasons.

The code is MIT licensed. The photos are free-licensed from Wikimedia Commons and keep their own licences, and the Rules page credits each one.

## Spotted a foul?

Every match report has a "Call for VAR" button for a score you think is wrong, and every page's footer takes the statements we missed. Both end up in the referee's room.

## Run it

Node 24.

```bash
npm run bootstrap   # then put a JWT_SECRET and a SUPER_USER in .env.local, as it asks
npm run seed:dev    # a league to look at
npm run dev         # http://localhost:3000
```

`npm run test:unit` and `npm run test:e2e` run the tests. The e2e layout checks need Chromium once, from `npx playwright install chromium`.

It's TypeScript on Express, rendered on the server, with SQLite through Prisma. A scout looks for new statements once a day and leaves them for the referee to approve. Nothing goes live on its say-so.

[Buy the referee a token](https://ko-fi.com/letthemeattokens).

Unlike our title, every quote here was actually said.
