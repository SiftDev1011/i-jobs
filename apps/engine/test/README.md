# Engine tests

Integration tests: they start the real Nest app and talk to it over HTTP, against a real PostgreSQL
(with pgvector) and Redis. Nothing is mocked except email and SMS, which go to in-memory outboxes the
tests read codes from.

```bash
npm test                       # from apps/engine
npx jest test/auth.spec.ts     # one file
npx jest -t "teens need"       # one test by name
```

## What they need

| Setting | Default |
|---|---|
| `TEST_PG_ADMIN_URL` | `postgres://postgres@127.0.0.1:54329/postgres` (a superuser) |
| `TEST_REDIS_URL` | `redis://127.0.0.1:63799/15` (database 15 is wiped each run) |
| `TEST_APP_PASSWORD` | `app-dev-password` |

Each run (`global-setup.ts`) drops and recreates the `ijobs_test` database, creates the `ijobs_app`
role if missing, applies every migration and seed, and sets known site keys for Remote Hustle and
School1 (`env.ts`). The app connects as `ijobs_app`, exactly as in production, so row-level security
is really tested.

## What's covered (202 tests)

- **Sign-in:** email and phone codes; wrong code; lock after five tries; codes work once; rate limits
  with `Retry-After`; field-by-field validation; refresh rotation; reuse of an old refresh token ends
  the session; sign-out; forged tokens; unknown routes and bad JSON as problem+json.
- **Account:** profile updates; under-13 lock; phone on one account only; teen → parent email →
  approval → unlocked on School1 but not on i-jobs; withdrawing autopilot consent turns autopilot off;
  data requests and duplicates.
- **Partner sites:** bad key, missing user, unlinked user, linked user, and one site's key cannot
  reach another site's users.
- **Row-level security:** each site sees only its rows; no site context sees nothing; the worker sees all.
- **Idempotency-Key:** required, replayed on retry without running twice, refused for a different body,
  separate per caller.
- **Housekeeping:** the hourly clean-up runs.
- **Ingest helpers:** location tagging (countries, regions, time zones, US states, Georgia), employment
  type, seniority, pay from numbers and text, categories, duplicate keys, HTML to text, dates, scam rules.
- **Connectors:** all 24 sources against sample responses in `fixtures/sources.ts`, plus HTTP retries.
- **Pipeline:** board → raw → live job; merging copies and promoting the better source; closing jobs
  that vanish; blocking scams into moderation; excluded origins; on-site filter; AI extraction with a
  fake Groq; waiting when the budget is spent; expiry; dead links; scheduling and broken boards.
- **Jobs API:** search filters and paging, badges and credit, closed and hidden jobs, job finds with
  publish delays, reports hiding a job, admin sources (with audit), AI budget and scam takedowns.
- **Profiles and matching:** real PDF, Word and scanned CVs (`fixtures/cv/`); upload links, consent,
  AI reading with a fake Groq, budget waits, unreadable CVs; profile edits, time zones, strength and
  confirmation; eligibility (country, region, on-site, hours, source rules); reasons and gaps linked
  to partner courses; seen/saved/dismissed surviving recomputes; embeddings with a fake Voyage and
  matching new jobs to members; autopilot rule checks (membership, consent, confirmed profile).
- **Applying:** the claim check, letters, MIME (header injection), reply sorting, raw email text, SNS
  signatures with a real key; planning (cap, queue reasons), cancelling, sending with the CV and
  limits (all-or-none, job cap), consent withdrawal, signed inbound replies matched and passed on,
  signed SES bounces, AI and profile-only packs, marking applied, totals, check-ins, visitor codes
  (throwaway emails, device limit) and free applies (Remotive never counts).
- **Email-only (`SMS_DRIVER=none`):** `/v1/features` says so; phone sign-in refused; free weeks never
  turn on and old ones stop; invites by email only.
- **Communities and money:** pricing rules, owner applications (price floor, one identity per person,
  slugs), approval, search without prices, join page with price, joining and credit, trials (phone
  code, once per person), Paga checkout and signed callbacks (twice is safe), the ledger split and
  balance, owners seeing first names only, nudges, approval and decline, bulk invites, Selar code
  batches (prepaid, CSV, single use), pasted jobs held until the owner confirms, payouts (hold,
  release, paid, balanced ledger), bans (codes voided, access to period end, switch offer), fraud checks.
- **Storage (local driver):** signed upload links tied to one key, type and size; files on disk; no path escapes.
- **Platform:** private-address blocking and DNS re-checks, webhook signatures, event ids and backoff,
  sealed secrets; notifications (partner sees its own only, read marks, paging, emailed once); help
  search by words, FAQ answers without AI, money/scam questions handed to a person, the assistant with
  a fake Groq and its hand-over when unsure; tickets and staff answers; moderation (approve, scam with
  applicant warnings and cancelled sends, strikes and suspension at three); partner linking (verified
  email only, new person created, existing person asked first, wrong account refused); webhooks
  (https only, secret shown once and sealed, events signed and sent once, retries for 24 hours,
  rebinding to a private address refused, delete); employers (free email and domain mismatch refused,
  email code, website check, review until verified, live once verified, applicant cap closes the job,
  ATS keys tested, sealed and wiped); data requests (export file and link, corrections to a person,
  deletion after 48 hours with payments kept and sessions ended, owners handed to a person).

## Helpers (`helpers.ts`)

- `startApp()` → `{ app, http, mail, sms, admin, close }`; `admin` is a superuser pool for setting up rows.
- `signIn(ctx)` → a fresh user with `userId`, `access`, `refresh` and an `auth` header object.
- `flushRateLimits(ctx)` clears limiter keys between tests.
