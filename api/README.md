# i-jobs engine: API

```
api/
  openapi.yaml     the API spec (OpenAPI 3.1): 109 endpoints, 3 outgoing webhooks
  reference.html   the same spec as a browsable page; open it in any browser
  redocly.yaml     lint settings
```

## Check and rebuild

```bash
npx @redocly/cli@2.74.0 lint api/openapi.yaml --config api/redocly.yaml
npx @redocly/cli@2.74.0 build-docs api/openapi.yaml --config api/redocly.yaml -o api/reference.html
```

The spec can also generate typed clients for the Next.js sites and request validation for NestJS, for example with `openapi-typescript`.

## Who calls it

| Caller | Credentials | Typical use |
|---|---|---|
| The i-jobs app and owner dashboard | `Authorization: Bearer <access token>` from email or SMS sign-in | Everything a member or owner does |
| Remote Hustle, School1, future sites | `X-Site-Key: <site key>` from their server, plus `X-Site-User: <their user id>` to act for one of their users | Jobs, matches and applications inside their own product |
| Staff | Access token of a staff user | `/admin` |
| Paga, Amazon SES, the email worker | Each one's own signature | `/hooks/*` |

## Endpoints by group

| Group | Endpoints | What's in it |
|---|---|---|
| Auth | 4 | Send a code, sign in, refresh, sign out |
| Account | 7 | Profile basics, consents, parent approval for 13–17s, data requests |
| Joining | 7 | Join page, join with invite or Selar code, find a community, request to join, trial week, pay through Paga |
| Profile | 7 | CV upload and parsing, profile, confirming it's accurate, autopilot rules |
| Jobs | 4 | Search, one job, report a job, public job finds page |
| Matches | 2 | Match feed with reasons and skill gaps, save or dismiss |
| Apply queue | 3 | Queue, apply pack on demand, "I applied" |
| Applications | 5 | List with totals, daily summary, the exact copy sent, cancel, check-ins |
| Visitors | 2 | Free applies before sign-up, counted by verified email |
| Notifications | 2 | List, mark read |
| Help | 5 | FAQ search, assistant, tickets |
| Owners | 19 | Apply as owner, pricing rules, settings, funnel, members, approve, nudge, bulk invites, demo tours, pasting jobs, earnings, appeals |
| Selar codes | 3 | Buy a batch, list batches, download codes as CSV |
| Employers | 5 | Domain-email verification, direct job posts, connect Greenhouse, Lever or Ashby |
| Partner | 5 | Link a partner user, send a course catalogue, webhooks |
| Incoming webhooks | 3 | Paga, SES bounces and complaints, relay replies |
| Admin | 10 | Moderation, community verification and bans, takedowns, source rules, AI budget, payouts |

## Rules built into the API

- **The daily AI budget never causes an error.** CV parsing, apply packs, pasted jobs and assistant answers return `202` with `status: scheduled` and `scheduled_for` when today's budget is spent. The app shows "Scheduled for tomorrow", and a `work.ready` webhook or notification follows.
- **Prices stay off public pages.** `GET /communities` has no prices. The member's own price appears only on the join page at the payment step, and the ₦5,000 floor and i-jobs' share only appear at `GET /owner/pricing-rules`.
- **Owners never see member details.** `/owner/communities/{id}/members` returns first names and progress only. Nudges are sent by i-jobs, and invite targets come back masked.
- **Source rules are respected.** Every job carries its credit and source link. When a source requires its own apply link, `apply.url` must be used unchanged. Remotive and Himalayas jobs never count toward the visitor apply limit.
- **No double charges or double applications.** Payments, code batches and applications need an `Idempotency-Key`, and the database also refuses a second application to the same job.
- **Errors are machine-readable.** Every error is `application/problem+json` with a stable `code`, such as `trial_already_used`, `code_used`, `cancel_window_closed`, `signup_required` or `demo_tours_used_up`.

## Still open

- `platform_share_percent` and `code_unit_share` are in the owner pricing rules but have no values until the money decisions are made.
- `CodeBatch.grants_period`: how long a Selar code's access lasts.
- Notification types are examples; the final list comes with the notifications decision.
