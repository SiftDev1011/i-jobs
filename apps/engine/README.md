# Engine (API + worker)

One codebase, two processes:

- **API** (`dist/main.js`): everything under `/v1`, described in `api/openapi.yaml`.
- **Worker** (`dist/worker.js`): BullMQ queues: job fetching from 24 sources, processing into jobs
  (with the Groq budget), expiry, link checks and housekeeping. Later milestones add matching,
  sending and webhooks. See `src/ingest/README.md`.

Both read the same environment variables, checked at start-up by `src/config/config.ts`.
A missing or bad value stops the process with a readable list.

## Run it on a laptop

You need Node 22, `pdftotext` (`apt install poppler-utils` or `brew install poppler`), and PostgreSQL 16
with pgvector plus Redis. Docker is the quickest way to get the
databases:

```bash
docker run -d --name ijobs-pg -p 54329:5432 -e POSTGRES_HOST_AUTH_METHOD=trust pgvector/pgvector:0.8.1-pg16
docker run -d --name ijobs-redis -p 63799:6379 redis:7.4-alpine

npm ci                                  # from the repository root
cd apps/engine
npm run build

# Database: create it, add the app role, apply migrations + reference data.
psql postgres://postgres@127.0.0.1:54329/postgres -c "CREATE DATABASE ijobs"
psql postgres://postgres@127.0.0.1:54329/postgres -c "CREATE ROLE ijobs_app LOGIN PASSWORD 'dev' NOBYPASSRLS"
DATABASE_URL=postgres://postgres@127.0.0.1:54329/ijobs npm run migrate -- --seed

# A site key for Remote Hustle (printed once; only the hash is stored).
DATABASE_URL=postgres://postgres@127.0.0.1:54329/ijobs node dist/scripts/site-key.js remote-hustle

# Start
export DATABASE_URL=postgres://ijobs_app:dev@127.0.0.1:54329/ijobs
export REDIS_URL=redis://127.0.0.1:63799/0
export JWT_SECRET=$(openssl rand -base64 48) AUTH_PEPPER=$(openssl rand -base64 48)
export LOG_PRETTY=true
npm start                # API on :3000
npm run start:worker     # in another terminal
```

With `MAIL_DRIVER=console` and `SMS_DRIVER=console` (the defaults outside production), sign-in codes
are written to the log instead of being sent. `STORAGE_DRIVER=memory` (the default outside production)
keeps uploaded CVs in memory; set `STORAGE_DRIVER=r2` and the `R2_*` keys to use a real bucket.

**Texts are optional.** `SMS_DRIVER=none` runs i-jobs email-only: phone sign-in is refused
(`phone_sign_in_off`), owners can invite by email only, and there are no free weeks (`trials_off`;
communities can't switch them on, and any that had them stop offering them). `GET /v1/features`
tells apps what's on, so they hide the rest. Set `SMS_DRIVER=termii` with a Termii key to turn all
three back on.

Try it:

```bash
curl -s localhost:3000/v1/health
curl -s -XPOST localhost:3000/v1/auth/codes -H 'content-type: application/json' -d '{"target":"you@example.com"}'
# read the code from the API log, then:
curl -s -XPOST localhost:3000/v1/auth/sessions -H 'content-type: application/json' -d '{"target":"you@example.com","code":"123456"}'
```

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | Compile to `dist/` |
| `npm start` / `npm run start:worker` | Run the API / the worker |
| `npm run migrate [-- --seed]` | Apply new files in `db/migrations`, then (with `--seed`) re-run `db/seeds` (safe to repeat) |
| `npm test` | Integration tests against real Postgres + Redis (see `test/README.md`) |
| `npm run typecheck` | Type-check source and tests |
| `npm run source:try -- <source> [board]` | Fetch one source live and print what we'd make of it. Writes nothing. |
| `npm run db:types` | Regenerate `src/db/schema.ts` from a migrated database (`DATABASE_URL`) after any migration change |

## How the code is laid out

```
src/
  config/        environment variables, checked once
  common/        problem+json errors, zod helpers, crypto, cursors, Idempotency-Key
  db/            Kysely + pg; forSite() and asEngine() set the row-level security context
  redis/         client + fixed-window rate limiter
  auth/          codes, sessions, JWT, the global guard (user token, site key, staff)
  account/       /me, consents, guardian approval, data requests
  ingest/        connectors for 24 sources, location tags, normalising, scam rules, pipeline, upkeep
  ai/            Groq client with the daily token budget; prompts and answer shapes
  jobs/          /jobs, /job-finds, reports; /admin/sources, /admin/ai-budget, takedowns
  storage/       R2 (or memory) files with signed upload links
  profile/       CV upload and reading, profiles, matches and autopilot rules endpoints, partner courses
  matching/      Voyage embeddings, eligibility and scoring, incremental and nightly matching
  sites/         site lookup by key or slug (cached 60 s)
  messaging/     SES email, Termii SMS (optional: SMS_DRIVER=none), or console outboxes
  health/        /v1/health
  maintenance/   hourly clean-up job
  queues/        queue names and defaults
  main.ts        API entry      worker.ts   worker entry      migrate.ts   migrator
```

## Rules every new endpoint follows

- **Who is calling.** The global guard runs on every route. Mark a route `@Public()` for no sign-in,
  or `@Auth('site' | 'staff' | 'user')` to narrow it. In handlers use `@CurrentActor()` and `userIdOf(actor)`.
- **Which rows they can see.** Anything that touches a site-scoped table (`site_accounts`, `applications`,
  `notifications`, `webhook_endpoints`, `apply_meter`, `support_tickets`) goes through
  `db.forSite(siteId, trx => …)`. Workers use `db.asEngine(trx => …)`. The app role cannot bypass
  row-level security, so forgetting this returns no rows rather than another site's rows.
- **Errors.** Throw `Problem.badRequest(code, title)` and friends. Codes are stable strings clients can
  switch on; titles are plain sentences people can read.
- **Input.** Validate bodies with `new ZodPipe(schema)`. Field errors come back as `errors: [{field, message}]`.
- **Retries.** Add `@Idempotent()` to any POST that creates money movements, applications or sends. Clients
  send `Idempotency-Key`; a retry gets the first answer back instead of running twice.
- **Lists.** Use `encodeCursor`/`page()` for cursor pagination, never offsets.
- **AI calls.** Always go through `AiService.run()`: it reserves tokens with `ai_reserve()`, keeps Groq's
  per-minute limits, settles real usage and checks the answer against a zod schema. It throws
  `AiBudgetExhausted` (wait for tomorrow), `AiRateLimited` (try again shortly) or `AiBadOutput` (don't retry).
  Endpoints that need AI answer `202` with `status: "scheduled"` when the budget is spent.

## Deploying

The image is built by CI (`.github/workflows/ci.yml`) for ARM and x86 and pushed to GHCR.
`infra/README.md` covers the server.
