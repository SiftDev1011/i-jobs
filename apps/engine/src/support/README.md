# Help, moderation, employers and data requests

## Notifications (`src/notifications`)

Services write rows to `notifications`. Members read them with `GET /me/notifications` and mark them
read with `POST /me/notifications/read`. On i-jobs a member sees all their notifications. A partner
site sees only the ones made on that site (row-level security).

Every 2 minutes the worker emails the important types and marks every row as sent, so nothing is
emailed twice. The important types are: `profile.ready`, `cv.unreadable`, `membership.approved`,
`membership.ending`, `membership.switch_offer`, `checkin`, `pack.ready`, `job.scam_alert` and
`support.reply`. To email another type, add it to `EMAIL_TYPES`. Rows older than 2 days are never
emailed late.

## Help and support (`src/support`)

- `GET /help/search` searches the FAQ by meaning with Voyage when it's set up. Otherwise it uses
  Postgres word search plus trigram similarity. Neither uses AI. Help articles get their embedding
  the first time anyone searches.
- `POST /help/ask` works in this order:
  1. Questions about money, scams, data or complaints go straight to a person (a ticket).
  2. A good FAQ match (relevance 0.35 or more) is returned as the answer.
  3. Otherwise the `support_answer` AI task answers using only the matching articles. The model must
     say whether it's confident. If it isn't, or the AI budget is spent, the question becomes a ticket.
  Each member can ask 20 questions an hour.
- Tickets: members open them and reply. Staff answer with `POST /admin/support/tickets/{id}/messages`,
  which notifies the member (and emails them). The roles allowed are admin, support, moderator,
  finance and dpo.
- Edit the shared FAQ in `db/seeds/0003_faq.sql`. A row with a `site_id` is shown only on that site.

## Moderation (`src/admin`)

Things land in `moderation_items` from four places: scam screening, job reports, new employers (for
the registry check) and community strikes. Admins and moderators use `GET /admin/moderation` and
`POST /admin/moderation/{id}/decision`.

| Decision | Job | Employer |
|---|---|---|
| `approve` | Goes live. A pasted job still waits for its owner to confirm it. | The registry check passes. With the email and website checks also done, the employer is verified. |
| `reject` | Removed | No change (it stays pending) |
| `reject_as_scam` | Marked as a scam. The text goes on the scam list, unsent applications are cancelled, and everyone already sent is warned. | — |
| `escalate` | Stays in the queue as escalated | — |

`strike: true` also gives the posting community a strike. At three strikes the community is
suspended, and a ban decision is added to the queue. Every decision is written to `audit_log`.

Owners see their strikes with `GET /owner/communities/{id}/strikes` and can appeal each one once.
The appeal lands in the queue as a `community` item (`strike appeal <id>`): `approve` takes the
strike back and lifts a suspension it caused; `reject` keeps it. New community applications are
decided with `POST /admin/communities/{id}/verify` instead of a queue decision.

`GET /admin/moderation` also returns a staff-only `subject` for each item (title, facts, links and
the job or community text), so a reviewer never needs to look anything up.

## Employers (`src/employers`)

1. `POST /employers/verifications` refuses free email providers and emails that aren't on the
   website's domain (sub-domains count). It then sends a 6-digit code. Codes last 15 minutes and
   allow 5 tries.
2. `POST /employers/verifications/confirm` passes the **work email** check and makes the person a
   member of the employer. The first person to confirm becomes its owner. It also queues the
   **website** check, which needs https on the same domain and follows up to 3 redirects. It adds a
   **registry** check (CAC or the country's equivalent) to the moderation queue.
3. All three checks make the employer `verified`.

`POST /employers/{id}/jobs`:
- Jobs from a verified employer go live at once if scam screening finds nothing. Anything else goes
  to review.
- `max_applicants` limits autopilot. The worker closes a job when it reaches the limit (every 10
  minutes).
- `accept_on_platform` (the default) sends applications by email (through the relay) to the
  `apply_email` you give, or to the poster's work address, until the employer inbox ships with the
  web app.

`GET /employers/mine` lists the companies a person has confirmed a work email at (and `Me` has
`is_employer`). `GET /employers/{id}` returns the checks, connected ATS boards and posted jobs with
applicant counts; jobs flagged for review only ever say "in review".

ATS connections are made with `POST /employers/{id}/integrations`:
- Each key is tested first: Lever lists postings, Ashby calls `apiKey.info`, and for Greenhouse we
  check the board exists. A Greenhouse Job Board key can only submit applications, so it's proven on
  the first real application.
- Keys are encrypted with `SECRETS_KEY` and only the last 4 characters are shown.
- Disconnecting wipes the key.
- Sending through an ATS (`ats_api`) is still to come. `EmployersService.keyFor()` is the hook.

## Data requests (`src/privacy`)

The worker runs every 15 minutes.

| Type | What happens |
|---|---|
| `export` | A JSON file at `exports/<user>/<request>.json` in R2, emailed as a 7-day link. Also listed with a fresh link in `GET /me/data-requests`. |
| `delete` | Waits 48 hours, and emails the person to say so. Staff can stop it with `POST /admin/data-requests/{id}` `{status: "refused"}`. Then the account is anonymised (below). |
| `correct`, `human_review` | Becomes a support ticket. The DPO closes it with `POST /admin/data-requests/{id}`. |

Deleting an account:

- **Removed:** profile, CV and tailored CV files, matches, packs, notifications, sessions (signed-in
  devices stop at once), partner links, autopilot rules, work items, guardian requests, employer
  membership, stored emails and their raw files, and earlier export files.
- **Cleaned:** application rows are kept so employers' and owners' counts stay true, but what was
  written in them is removed. The relay address stops forwarding but is never reused. Active
  memberships are cancelled. The member's ticket messages are blanked. Name, email, phone and date of
  birth are cleared, and the status is set to `deleted`.
- **Kept:** payments and the ledger (the law and owner payouts need them), consent records, and trial
  claims (only hashes, to stop repeat free trials).

Community owners, staff and employer owners are never deleted automatically. Their requests go to a
person, because a handover is needed (communities, payouts, ID documents).
