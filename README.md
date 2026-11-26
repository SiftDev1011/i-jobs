# i-jobs engine

The job engine behind i-jobs by 99, Remote Hustle and School1.

| Folder | What's in it | Status |
|---|---|---|
| `db/` | PostgreSQL + pgvector schema, starter data, tests | 64 tables, 11 views, 19 rule checks passing |
| `api/` | OpenAPI 3.1 spec and a browsable reference page | 109 endpoints + 3 webhooks, lint passing |
| `apps/engine/` | The API and background worker (NestJS) | Milestones 1–6 done: sign-in, accounts, partner sites, 24 job sources, AI budget, job search, CV reading, profiles, matching, autopilot, apply queue, replies, visitors, communities, Paga, Selar codes, ledger, payouts, notifications, help and support, moderation, partner linking and webhooks, employers, data requests, optional texts, demo payments, payments-off mode, company logos, similar jobs; 215 tests passing |
| `apps/web/` | The web app (Next.js): landing page, job search, member app, community owner dashboard, employer pages, staff tools | 52 pages; 10 unit tests and 45 browser tests passing |
| `infra/` | Docker Compose for one Oracle ARM server, setup, backups, tunnel, Cloudflare email worker | Ready to deploy |
| `.devcontainer/` | GitHub Codespaces setup: Node 22, Docker, psql, packages installed on first start | Ready |
| `.github/workflows/` | CI: typecheck, engine tests on real Postgres + Redis, web build and browser tests, ARM image to GHCR | Ready |

Stack: TypeScript (NestJS API and workers, Next.js web app in `apps/web`), PostgreSQL 16 + pgvector,
Redis + BullMQ, Cloudflare R2 / Tunnel / Email Routing, Amazon SES, Termii SMS (optional),
Groq free tier, Voyage embeddings, Paga. Beta runs on Oracle Always Free with Docker; sites on Vercel.

## Run a demo

```bash
bash scripts/demo.sh        # databases, engine, worker and web app in one go; Ctrl+C stops it
```

Works in a GitHub Codespace or on any computer with Docker. Emails (with sign-in codes) are printed
in the terminal, payments go through a demo checkout where no money moves, and real jobs are fetched
from job sites. `--help` lists the options (`--reset` starts over with fresh data).

## Where to start

1. `db/README.md`: how the data fits together.
2. `api/README.md` and `api/reference.html`: every endpoint.
3. `apps/engine/README.md`: run it on a laptop. `apps/engine/src/ingest/README.md`: how jobs come in. `apps/engine/src/matching/README.md`: profiles and matching. `apps/engine/src/applying/README.md`: autopilot and replies. `apps/engine/src/money/README.md`: communities and money. `apps/engine/src/partner/README.md`: plugging a site in (linking users, webhooks). `apps/engine/src/support/README.md`: help, moderation, employers and data requests.
4. `apps/web/README.md`: every page, running the web app, deploying it to Vercel. `apps/web/e2e/README.md`: the browser tests.
5. `infra/README.md`: put the engine on the server.

## Milestones

| # | Scope | State |
|---|---|---|
| 1 | Platform: config, errors, sign-in by code, sessions, accounts, consents, guardians, partner site keys, idempotency, health, worker, deploy | Done |
| 2 | Job sources (24 connectors), normalising, location tags, Groq client with daily budget, extraction, dedupe, scam screening, expiry, link checks, job search and job finds, admin sources and AI budget | Done |
| 3 | CV upload and parsing, profiles, Voyage embeddings, matching, trainings, autopilot rules | Done |
| 4 | Apply queue, apply packs, autopilot sending, relay email, reply sorting, visitor applies | Done |
| 5 | Communities, invites, trials, Selar code batches, Paga, ledger, payouts, fraud checks | Done |
| 6 | Admin, support, notifications, partner API and webhooks, data requests, employers | Done |
| 7 | Next.js web app: landing, jobs, sign-in and joining; the member app; community owners, employers and staff; public pages; browser tests | Done |
