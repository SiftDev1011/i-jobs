# Job ingest

How jobs get from 24 outside sources into the `jobs` table.

```
every 5 min   ingest:tick    → which sources/boards are due? queue a fetch for each (never twice)
              ingest:fetch   → connector.fetch → raw_postings (new / changed / still there / gone)
every 2 min   process:batch  → raw posting → normalise → (AI for free text) → filters → scam check
                               → merge with an existing copy, or a new job
hourly        maintenance    → close jobs past their expiry; clean-up
hourly        links          → check apply links (not ATS feeds, not aggregators) — two misses close a job
```

## The steps for one posting (`pipeline.service.ts`)

1. **Normalise.** The source's connector turns its own fields into ours. Structured feeds need no AI.
2. **Source rules.** Excluded origins (TheirStack: LinkedIn, Indeed) are dropped.
3. **AI, only for free text** (Hacker News, Bluesky, later pasted jobs). A code filter runs first so
   non-job posts never spend tokens. If today's budget is spent, the posting waits until 00:05 UTC.
4. **Place.** `location.ts` tags remote / worldwide / unspecified / restricted, countries, regions
   (Nigeria counts as `africa` and `emea`) and time zones, from whatever the source says.
   On-site and hybrid jobs are kept only in `INGEST_ONSITE_COUNTRIES` (default `NG`).
5. **Filters.** Missing title or company, under 40 characters of description, posted over 60 days
   ago, or a deadline already passed.
6. **How to apply.** Sources whose terms require it get their own link (`apply_via_source_link`).
   Employer boards with an employer key connected use `ats_api`. A bare email uses `email`.
7. **Scam screening** (`scam.ts`). Rules on every job, plus the confirmed-scam fingerprint list.
   For unverified sources, the unclear middle band (0.35 to 0.7) gets an AI check if budget allows.
   0.7 or more → `scam` (never shown). The middle band → `pending_review`. Both go to the moderation queue.
8. **Duplicates.** Same company + title + place (normalised), or the same apply link → one job with
   several `job_sources`. The better source becomes primary: employer post > ATS > NGO > remote
   board > aggregator > social.
9. **Expiry.** The source's default (30 days) or the deadline, whichever is sooner, never over 60 days.

A posting that changes at the source is processed again. A posting missing from a complete listing
(ATS boards, Remotive) is marked gone; a job with no live source left closes.

## Sources

| Source | Kind | Fetch | Needs | Shape checked against |
|---|---|---|---|---|
| greenhouse, lever, ashby | ATS | per board | — | public docs |
| bamboohr, recruitee, teamtailor, workable, personio | ATS | per board | — | public docs/feeds; **try live first** |
| gupy | ATS (Brazil) | per board | — | **try live first** (portal API) |
| himalayas, jobicy, remoteok, remotive, workingnomads | remote board | whole feed | — | public docs |
| weworkremotely, getonboard | remote board | feed | — (off until they reply) | public docs |
| adzuna | aggregator | search | `ADZUNA_APP_ID/KEY` | public docs |
| careerjet | aggregator | search | `CAREERJET_API_KEY` or `CAREERJET_AFFID` | **try live first** |
| jooble | aggregator | search | `JOOBLE_API_KEY` | public docs |
| talent | aggregator | — | publisher approval | not built: format comes with approval |
| reliefweb | NGO | search | `RELIEFWEB_APPNAME` | public docs (v2) |
| theirstack | paid provider | search | `THEIRSTACK_API_KEY` | public docs |
| bluesky | social | search | optional app password | public docs |
| hackernews | social | monthly thread | — | public docs |

My workspace can't reach these sites, so every connector is tested against sample responses written
from each source's documentation (`test/fixtures/sources.ts`). Before switching a source on in
production, run it live once and look at the output:

```bash
node dist/scripts/source-try.js remotive
node dist/scripts/source-try.js greenhouse gitlab
node dist/scripts/source-try.js adzuna --config '{"countries":["gb"],"pages":1}' --raw
```

If a field comes out empty or wrong, `--raw` shows the source's real JSON; fix the connector's
`normalise` and add that sample to the fixtures.

## Settings per source

Rules (display, enabled, terms, intervals) are changed with `PATCH /v1/admin/sources/{key}` and are
never reset by deploys. Search settings live in `sources.config` (JSON), seeded once by
`db/seeds/0002_source_config.sql`: Adzuna countries, Careerjet locales, Jooble searches, ReliefWeb
countries, TheirStack slice size (its free tier is ~200 jobs a month), Bluesky hashtags.

Company boards are rows in `source_boards`. A board that fails five fetches in a row switches itself off.

## AI budget

Free Groq tier only. Each call reserves tokens first (`ai_reserve`), so the day's plan in
`ai_task_budgets` can't be overspent; Redis also keeps calls inside Groq's per-minute limits.
`job_extract` has ~66 calls a day and `scam_check` ~37. `GET /v1/admin/ai-budget` shows what's left
and how many postings are waiting for tomorrow.
