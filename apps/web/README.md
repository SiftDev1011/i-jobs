# i-jobs web app

The i-jobs site: the landing page, job search, joining a community, and (next) the member,
owner, employer and staff pages. Next.js 15 (App Router), React 19, TypeScript, CSS modules.

## How it talks to the engine

The browser never calls the engine and never sees a token or site key.

- **Pages and server actions** call the engine with `engine()` from `src/lib/engine.ts`. It's typed
  from `api/openapi.yaml`, so a renamed field breaks the build rather than the page. After changing
  the spec, run `npm run api:types`.
- **Sessions** are two httpOnly cookies: `ij_at` (access token, 15 minutes) and `ij_rt` (refresh
  token, 30 days).
- **Middleware** swaps the refresh token for new tokens shortly before the access token runs out.
  The engine gives the same new tokens to parallel requests for 20 seconds, so several tabs
  loading at once don't sign the person out.
- **Texts are optional:** pages ask the engine's `GET /v1/features` (kept for a minute) and hide
  phone sign-in, phone invites and free weeks when the engine runs with `SMS_DRIVER=none`.
- **Signed out:** visiting any `/app` page without a session goes to `/sign-in?next=<that page>`,
  and back there after signing in.
- **Lost sessions:** if the engine says a session ended (`must()` sees `session_ended`,
  `token_invalid` and similar), the person is sent to `/sign-in`.
- **Rate limits:** the person's IP is passed on as `X-Forwarded-For`, so the engine's rate limits
  count per person, not per server. The engine must run with `TRUST_PROXY=true`, which is the
  default.

## Pages

**Public**

| Path | What it does |
|---|---|
| `/` | The landing page. The job wall shows real job finds (`GET /job-finds`). In development it falls back to sample cards; production never does. |
| `/jobs`, `/jobs/[id]` | Job search with filters, and the job page with a source credit and a safety note |
| `/communities` | Find a verified community. Each result opens its join page. |
| `/help` | Search the help articles |
| `/sign-in` | Email or phone, then a 6-digit code. Records agreement to the terms and privacy notice. |
| `/join/[code]` | The join page for an invite code or link slug, then `POST /join` |
| `/link/[token]` | A partner site asks to link accounts; the member agrees or says no |
| `/owners/apply` | What running a community means, then the owner application (signed in). Sends identity, payout bank, group links and price; lands on the new community's dashboard. |
| `/employers` | What hiring on i-jobs means and the three checks; starts at `/app/employer` |
| `/about`, `/privacy`, `/terms` | Rendered from `content/*.md`. **Replace `privacy.md` and `terms.md` with your own lawyer-reviewed text**; a `> DRAFT:` line shows a yellow notice until you remove it. Keep the `{#owners}` and `{#employers}` anchors. |
| `/demo/[token]` | An owner's demo tour link: a read-only member view with sample data, for a day |
| `/payments/[id]` | Where Paga sends the payer back. Waits for the webhook, then says what's next (membership or Selar codes). |
| `/owner` | Redirects to `/app/owner` (emails link here) |

**Members (`/app`, signed in).** A sidebar on desktop; on phones, a top bar and bottom tabs.

| Path | What it does |
|---|---|
| `/app` | Set-up checklist (join → pay or free week → CV → check profile → autopilot), totals, new matches, latest applications, memberships. Also the parent approval form for 13–17s. |
| `/app/membership/[id]` | Pay through Paga, or (when texts are on) start the free week with a code texted to the member's phone |
| `/app/profile/cv` | Asks for CV-reading consent, uploads the CV straight to storage with the signed link, then waits for the profile |
| `/app/profile` | Profile strength and tips; edit everything (experience and education lists too); "It's accurate" |
| `/app/autopilot` | On/off (asks for the "send in my name" consent), lowest match, regions, kinds of work, lowest pay, daily cap, pause |
| `/app/matches` | New, saved and seen matches, with reasons and skill gaps (linked to free courses); save or hide |
| `/app/queue` | Matches autopilot can't send, with the reason and any warning |
| `/app/jobs/[id]` | The job, the apply pack (drafted answers to copy, the employer's page, "I've applied"), and reporting a job |
| `/app/applications`, `/[id]` | Totals and filters; the exact email sent, the history, cancel before it's sent, "Did you hear back?" |
| `/app/notifications` | Notices, linked to what they're about; mark all read |
| `/app/help`, `/help/tickets/[id]` | Ask (FAQ first, then the assistant, then a person); conversations with the team |
| `/app/settings` | Name, the member's i-jobs address, each consent as a switch, data requests (copy, correct, review, delete) |

**Community owners (`/app/owner`).** Shown in the sidebar when `me.is_owner`. One community opens
straight away; several get a list.

| Path | What it does |
|---|---|
| `/app/owner/[id]` | Review status notices, join link, invite code and job finds link to copy, the member funnel (each step links to those members), interviews landed, demo tour links (2 per community), strikes with a one-time appeal |
| `…/members` | First names only, membership, progress, dates; let in or decline (if approval is on); remind people who are stuck |
| `…/invites` | Paste up to 500 emails or numbers (local numbers become +234); what was sent and who joined |
| `…/jobs` | Paste a job from the chat; check and publish what the AI made of it; renew; the page refreshes itself while a post is being read |
| `…/earnings` | Balance, on hold, next payout date, payout history |
| `…/codes` | Buy Selar codes (pays through Paga) and download each paid batch as a CSV (`/app/owner/batches/[id]/csv`) |
| `…/settings` | Description, price and period, free week (when texts are on), approval |

**Employers (`/app/employer`).** Shown when `me.is_employer`; anyone can start from `/employers`.

| Path | What it does |
|---|---|
| `/app/employer` | Company and work email, then the 6-digit code; lists your companies (one company opens straight away) |
| `/app/employer/verify` | Add another company |
| `/app/employer/[id]` | The three checks, posted jobs with applicant counts, Greenhouse/Lever/Ashby connections |
| `/app/employer/[id]/post` | Post a job: who can apply, pay, skills, apply by email through i-jobs or on your own careers page, closing date, applicant cap |

**Staff (`/app/admin`).** Shown when `me.is_staff`; everyone else gets a 404. Tabs follow the
role (`app/admin/_parts/roles.ts`); the engine enforces the same rules.

| Path | Roles | What it does |
|---|---|---|
| `/app/admin` | admin, moderator | The review queue, with what each item is about. Jobs: approve, remove, remove as scam (optionally with a strike), escalate. New communities: approve, ask for more, reject (emails the owner); ban (admin). Strike appeals: uphold or keep. Employers: registration checks out or not. Also: take down any live job. |
| `/app/admin/support`, `/[id]` | all staff | Tickets oldest first; reply (the member is notified and emailed) and resolve |
| `/app/admin/data-requests` | admin, dpo | Open requests; stop a deletion in its 48 hours; close corrections and reviews |
| `/app/admin/payouts` | admin, finance | Release once the hold has passed, then mark paid with the bank transfer reference |
| `/app/admin/sources` | admin (moderators read) | Each job source's health and rules |
| `/app/admin/ai-budget` | admin | Today's AI tokens per task and what's waiting |

Times are shown in Lagos time. Pages that need an active membership show a short explanation
instead of an error when the member isn't in yet (`_ui/gate.tsx`).

## Run it locally

```bash
# 1. The engine on :3000 with the dev database (see the root README), plus demo data:
psql "$DATABASE_ADMIN_URL" -f db/seeds/dev/demo.sql    # demo owner, 2 communities (LTH-2048, GJA-1100), 20 jobs, a staff admin
# 2. The web app on :3001
cp apps/web/.env.example apps/web/.env.local
npm run dev -w @ijobs/web
```

Demo accounts: `owner@demo.ijobs.example` (runs both communities) and `staff@demo.ijobs.example`
(admin). Any other email signs up as a new member.

Sign-in codes appear in the engine's log when `MAIL_DRIVER=console`. Texted codes (free week)
appear there too when `SMS_DRIVER=console`. With `PAGA_DRIVER=fake`, paying goes to a fake
checkout address.

To try CV uploads locally, run the engine with `STORAGE_DRIVER=local` (and optionally
`STORAGE_DIR`). Files then go to a folder that the API and the worker share, through signed
`/v1/dev/files` links that work like R2's. Reading a CV needs `GROQ_API_KEY` on the worker.

## Deploying (Vercel)

- Set the project root to `apps/web`.
- Set `ENGINE_URL` (the engine's public URL behind Cloudflare Tunnel) and `PUBLIC_APP_URL`.
- Add the site's address to the engine's `CORS_ORIGINS`. The browser doesn't call the engine
  today, but partner sites may.
- Image optimisation is off (`images.unoptimized`), so the server never runs sharp.

## Tests

`npm test -w @ijobs/web` runs the unit tests (formatting, session helpers, the content-page
renderer). `npm run e2e -w @ijobs/web` runs 45 browser tests against a real engine, Postgres and
Redis: every kind of user, start to finish, plus phone widths. See `e2e/README.md`.
