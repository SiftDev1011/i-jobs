# Plugging a site into i-jobs

How Remote Hustle, School1 or any later site uses the engine. Every call sends the site's key in
`X-Site-Key`. Calls about one of the site's users also send `X-Site-User: <your user id>`.

## 1. Link the user

Call this when one of your users opens the job features:

```http
POST /v1/partner/users
X-Site-Key: sk_live_...

{ "external_user_id": "u_123", "email": "ada@example.com", "email_verified": true,
  "full_name": "Ada Okafor", "date_of_birth": "1998-04-02", "completed_trainings": ["course-17"] }
```

| Situation | Response |
|---|---|
| Already linked | `{ user_id, linked: true }`. `completed_trainings` is updated. |
| New to i-jobs | A person is created and linked: `{ user_id, linked: true }` |
| The email already has an i-jobs account | `{ user_id: null, linked: false, consent_url }`. They also get an email. |
| `email_verified` is false | 422 `email_not_verified`. Verify the email on your side first. |

When someone already has an account, they must agree before anything is shared. You learn
nothing about them until then. The `consent_url` opens `PUBLIC_APP_URL/link/<token>`. The web app
(stage 7) shows that page, which calls these while the person is signed in to i-jobs:

- `GET /v1/partner/links/{token}`: who is asking.
- `POST /v1/partner/links/{token}/accept`
- `POST /v1/partner/links/{token}/decline`

Links last 7 days. After the person accepts, call `POST /partner/users` again: it returns `linked: true`.

`completed_trainings` holds course ids from your `PUT /partner/trainings` catalogue. Skill gaps
never suggest a course the person has already finished on your site.

## 2. Act for the user

Send `X-Site-Key` and `X-Site-User` together. You get the same endpoints the i-jobs app uses: profile,
CV, matches, autopilot, apply queue, applications and notifications. Row-level security limits you
to rows made through your site. Notifications from other sites stay hidden from you.

## 3. Webhooks

```http
POST /v1/partner/webhooks
{ "url": "https://hooks.yoursite.com/ijobs", "events": ["application.status_changed", "match.created", "work.ready", "membership.updated"] }
```

- The response contains `secret` (`whsec_...`) **once**. Store it. We keep it encrypted with `SECRETS_KEY`.
- The URL must be https on a public address. We check the address again before every send, so a
  name later pointed at a private address is refused.
- A site can have up to 5 endpoints. `DELETE /v1/partner/webhooks/{id}` removes one and anything still
  waiting to be sent to it.

| Event | When | Which sites get it |
|---|---|---|
| `application.status_changed` | Any application status change (sent, replied, interview, …) | Every site the person is linked to |
| `match.created` | A new match scores 80 or more | Every site the person is linked to |
| `work.ready` | A CV parse, apply pack or similar job finishes or fails | Only the site that asked for it |
| `membership.updated` | Trial, renewal, expiry, cancellation | Every site the person is linked to |

Each event looks like this:

```json
{ "id": "…uuid…", "type": "match.created", "created_at": "2026-11-20T10:00:00Z",
  "site_user": "u_123", "data": { "job_id": "…", "score": 91 } }
```

`id` stays the same if an event is sent again, so use it to ignore repeats. Check the signature
before you trust the body:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody: string, header: string, secret: string) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // reject replays older than 5 minutes
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return v1.length === expected.length && timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}
// header: X-Ijobs-Signature: t=1763632800,v1=5f2c…
```

Reply with any 2xx within 10 seconds. Anything else (including redirects) counts as a failure. A
failed event is retried after 30 s, 1 m, 2 m, and so on, never more than 2 h apart, for 24 hours. After
that it is marked failed. The worker reads changes and sends once a minute.
