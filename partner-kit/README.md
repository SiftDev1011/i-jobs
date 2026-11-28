# Putting i-jobs into Remote Hustle and School1

Partner sites show i-jobs inside their own product: their users get jobs, CV matching, an apply queue and
application tracking without leaving the site. The site's **server** talks to the i-jobs API with a site key;
people never see i-jobs sign-in screens (except to agree to link an existing i-jobs account).

```
partner-kit/
  ijobs.ts            the client: copy this one file into the site (server code only)
  examples/nextjs/    copy-paste pages and routes for a Next.js site
```

Both sites are already set up in the engine (`remote-hustle` and `school1`). School1 is the one that
allows 13–17 year olds, with a parent's approval.

---

## Part 1: setup (once per site, about 10 minutes)

### 1. Make each site's key

On the server:

```bash
cd /opt/ijobs/infra
docker compose run --rm -e DATABASE_URL="postgres://postgres:$(grep ^POSTGRES_PASSWORD .env | cut -d= -f2)@postgres:5432/ijobs" \
  api node dist/scripts/site-key.js remote-hustle
```

It prints `sk_remotehustle_…` **once**. Keep it in a password manager and give it only to that site's
developers. Run it again with `school1` for School1. Running it again for a site replaces its key, and the old one
stops working at once, which is also how you change a key that leaked.

### 2. Put the key in the site's hosting settings

For a site on Vercel: Project → Settings → Environment Variables:

| Name | Value |
|---|---|
| `IJOBS_SITE_KEY` | the key from step 1 |
| `IJOBS_API_URL` | `https://ijobs-api.remotehustle.name.ng` (optional; this is the default) |

Never name it `NEXT_PUBLIC_…` and never use it in browser code: anyone holding the key can act for every user of
that site.

### 3. Let the site upload CVs

The browser sends CVs straight to i-jobs' file storage, so each site's address must be allowed there.
Cloudflare → R2 → **ijobs-files** → Settings → CORS Policy → Edit, and list every site in `AllowedOrigins`:

```json
[
  {
    "AllowedOrigins": ["https://i-jobs.remotehustle.name.ng", "https://remotehustle.plug99.com.ng", "https://YOUR-SCHOOL1-ADDRESS"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Remote Hustle is already in the list; add School1's address (with `https://`, no `/` at the end).

### 4. Register each site's webhook (when the site has its webhook route live)

i-jobs tells the site when something happens: a new strong match, an application update, a CV that's been read.
From any terminal, with that site's key:

```bash
curl -s -X POST https://ijobs-api.remotehustle.name.ng/v1/partner/webhooks \
  -H "X-Site-Key: sk_…" -H "Content-Type: application/json" \
  -d '{"url":"https://remotehustle.plug99.com.ng/api/ijobs/webhook","events":["match.created","application.status_changed","work.ready","membership.updated"]}'
```

The answer contains `"secret":"whsec_…"` **once**. Put it in the site's settings as `IJOBS_WEBHOOK_SECRET`.

---

## Part 2: the code (for the site's developers)

### Copy the client

Copy `ijobs.ts` into the site's server code, for example `lib/ijobs-client.ts`. It has no dependencies and works
in Next.js route handlers and server components, Express, or any Node 18+ server.

```ts
import { createIjobs } from './ijobs-client';
export const ijobs = createIjobs({ siteKey: process.env.IJOBS_SITE_KEY! });
```

### The flow for one user

1. **Link them** whenever they open the job pages (it's cheap, and it keeps their finished courses up to date):

   ```ts
   const r = await ijobs.linkUser({
     external_user_id: user.id,          // your own user id
     email: user.email,
     email_verified: true,               // only once you've verified it; false is refused
     full_name: user.name,
     date_of_birth: user.dob,            // School1: needed for 13–17s
     completed_trainings: ['course-17'], // your course ids (optional)
   });
   ```

   - `linked: true`: carry on.
   - `linked: false` with `consent_url`: they already have an i-jobs account. Show a "Connect i-jobs" button to
     that link. They agree on i-jobs (they also get an email), then `linkUser` returns `linked: true`. Until then
     you get nothing about them.

2. **Act for them** with `ijobs.forUser(user.id)`:

   | Call | What it does |
   |---|---|
   | `account()` | Who they are; `features_locked` is true for under-13s and for 13–17s waiting for a parent |
   | `requestParentApproval({ guardian_name, guardian_email })` | School1: emails the parent a link to approve |
   | `cvUploadLink(file)` then the browser PUTs the file, then `parseCv(upload_id)` | Upload and read a CV (PDF or .docx, up to 5 MB) |
   | `profile()` / `updateProfile(changes)` | Their profile; 404 means no CV yet |
   | `matches()` / `setMatch(jobId, 'saved' \| 'dismissed')` | Jobs that fit them, with reasons and skill gaps |
   | `queue()`, `applyPack(jobId)`, `markApplied(jobId)` | The apply queue, a tailored cover note and answers, "I applied" |
   | `applications()`, `applicationsSummary()` | What they've applied to and how it's going |
   | `notifications()`, `markNotificationsRead()` | Their i-jobs notifications for your site |

3. **Public jobs** need no user: `ijobs.jobs({ q, limit })`, `ijobs.job(id)`, `ijobs.similarJobs(id)`.

4. **Your courses** (optional): `ijobs.putTrainings([{ id, title, url, skills, is_free }])`. Skill gaps then suggest
   your courses, and never ones the person has already finished.

5. **Webhooks**: in the route that receives them, check the signature with `verifyWebhook(rawBody,
   header, process.env.IJOBS_WEBHOOK_SECRET)` before trusting anything, skip event ids you've already handled,
   and answer within 10 seconds.

Every failed call throws an `IjobsError` with `status`, `code` (stable, for your code to check) and `title` (a
sentence you can show people). Two answers aren't failures, and you should show them as they are: `202` with
`status: "scheduled"` means today's AI budget is used up and the work happens tomorrow; a `work.ready` webhook
follows.

### Next.js examples

`examples/nextjs/` has a working set to copy and adjust:

| File | What it is |
|---|---|
| `lib/ijobs.ts` | The client, plus `linkedUser()` that links the signed-in user |
| `app/jobs/page.tsx` | "Jobs for you": public jobs when signed out; connect, parent approval, CV upload or matches when signed in |
| `app/api/ijobs/cv/route.ts` + `components/cv-upload.tsx` | CV upload: the server gets the link, the browser uploads, the server asks i-jobs to read it |
| `app/api/ijobs/webhook/route.ts` | Receives and checks webhooks |

They import your own sign-in as `getSignedInUser()` from `@/lib/auth`; point that at however your site knows who
is signed in.

### Rules to keep

- **Show the credit.** When a job has `source.credit` (e.g. "via Himalayas"), show it, linked to `source.url`.
- **Use `apply.url` unchanged** when a job has one: some job sites require their own apply link.
- **No prices on public pages**, as on i-jobs itself.
- **Only verified emails** go to `linkUser`.

### Check it works

1. Sign in on the site as a new user, open the jobs page: you should see the CV upload.
2. Upload a CV: within a few minutes the page shows matches. Reading CVs needs the Groq key on the engine;
   until the Voyage key is added, matching runs on skills and titles alone.
3. Sign in as someone who already has an i-jobs account: you should see "Connect i-jobs", and the link should
   open i-jobs' consent page.
4. School1 only: a 15-year-old test user should be asked for a parent's email, and the parent should get the email.

The full API is in `api/reference.html` (open it in a browser). The engine's side is described in
`apps/engine/src/partner/README.md`.
