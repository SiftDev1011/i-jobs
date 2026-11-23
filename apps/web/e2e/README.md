# Browser tests

Playwright tests that click through the real web app against a real engine, Postgres and Redis.
They run on every push in CI (the `web` job in `.github/workflows/ci.yml`).

| File | What it covers |
|---|---|
| `public.spec.ts` | Landing search, job search and job page, finding a community, invite codes, help, the explainer and content pages, no prices outside join pages, 404s, signed-out redirects |
| `member.spec.ts` | One new member start to finish: invite code → sign up → join → free week (texted code) → CV upload → profile → autopilot → matches → report a job → cancel an application → notifications → help and a ticket → data export → kept out of owner and staff pages → log out |
| `owner.spec.ts` | The demo owner: dashboard, demo tour link, first names only, reminders, invites, check and publish a pasted job, buy Selar codes through (fake) Paga, the payment page, the CSV download, earnings, settings |
| `employer-staff.spec.ts` | A new owner applies (and a too-low price is refused); a company verifies and posts (free email refused); a staff admin approves the community, the registration and the job, takes a job down and answers a ticket; a moderator only sees their tabs |
| `phone.spec.ts` | On a Pixel 7 screen: no page scrolls sideways (public, owner and staff pages), the hero search fits, bottom tabs and the More sheet work |

Every test also fails if the page throws an error or any request returns a 5xx.

## Running them

You need Postgres 16 with pgvector and Redis, set up as in `apps/engine/README.md` (a database, the
`ijobs_app` role). Then, from the repo root:

```bash
npm run build -w @ijobs/engine
npm run build -w @ijobs/web
npx -w @ijobs/web playwright install chromium     # once

export DATABASE_ADMIN_URL=postgres://postgres@127.0.0.1:54329/ijobs
export DATABASE_URL=postgres://ijobs_app:dev@127.0.0.1:54329/ijobs
export REDIS_URL=redis://127.0.0.1:6379/0
npm run e2e -w @ijobs/web
```

The suite:

1. Applies migrations and seeds, then loads `db/seeds/dev/demo.sql` (demo owner, communities, jobs,
   a staff admin). **Use a development database**: the tests add members, communities and jobs.
2. Clears sign-in rate limits in Redis.
3. Starts the engine on :3000 with console email and SMS, fake Paga, local file storage and no
   ingestion, writing its log to `e2e/.out/engine.log`, and the web app on :3001. Ports 3000 and
   3001 must be free.
4. Reads sign-in and phone codes from that log, and completes Paga payments by sending a correctly
   signed callback (with the test hash key) to the engine.

To use servers you already started, set `E2E_START_SERVERS=0` and `E2E_ENGINE_LOG` to your engine's
log file. The engine must use `MAIL_DRIVER=console`, `SMS_DRIVER=console`, `PAGA_DRIVER=fake` and the
same `PAGA_HASH_KEY` as the tests (default `e2e-paga-hash-key`). `E2E_ENGINE_URL` and `E2E_WEB_URL`
change the addresses.

When something fails, the screenshot, a trace and the error are in `e2e/.out/results`. Open a trace
with `npx playwright show-trace <file>`. In CI they are uploaded as the `e2e-report` artifact.

## What they can't cover

- **Reading a CV and pasted jobs** need a Groq key; the tests insert the profile the worker would
  have made, and check that a paste is queued.
- **The website check for employers** runs on the worker, which isn't started.
- **Real Paga, R2, email and SMS** are replaced by the fake and console drivers.
