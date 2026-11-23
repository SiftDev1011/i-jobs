# Applying

```
match:user / every 15 min   planner   → good matches become autopilot applications (inside rules and the daily cap)
                                        or wait in the member's apply queue with a reason
every minute                sender    → due applications: re-check, take the four limits, write, send, book a check-in
email worker → /hooks/inbound-email   → store the reply, match it to the application → ai:reply_sort
ai:reply_sort                         → rules first, AI if unclear → status, notification, pass the reply on
SNS → /hooks/ses                      → permanent bounces and complaints suppress the address
09:00 Lagos daily                     → "Did you hear back?" check-ins; no word after 30 days → no_response
```

## What autopilot will send

Only all of these: the member has autopilot on, current consent, a confirmed profile (90 days), a
CV, their full name, is an adult with access (active membership on i-jobs, or a partner site), and
fewer than five bounces this month. The job is from a source that allows autopilot, from a verified
or careers-page employer, applies by email, is under its 25-application cap, is under 14 days old,
scores at least the member's `min_match`, and fits their regions, job types and minimum pay.

Everything else scoring 60+ goes to the apply queue, with the reason shown
(`unverified_employer`, `apply_on_source_site`, `outside_rules`, `autopilot_off`, `job_cap_reached`).

Applications wait 2 hours (`AUTOPILOT_CANCEL_HOURS`) before sending, so the member can cancel, and
are spaced 7 minutes apart.

## The four sending limits

Taken together in one transaction, all or none:

| Limit | Where | Default |
|---|---|---|
| Per job | `jobs.autopilot_cap` | 25 members per job, ever |
| Per member | `autopilot_rules.daily_cap` | 5 a day |
| Per employer (email domain) | `EMPLOYER_DAILY_LIMIT` | 5 a day from all members |
| Per sending domain | `sending_domains.daily_limit` | 50 a day while warming up |

A daily limit moves the send to 08:00 Lagos the next day. The job cap moves it back to the queue.
A sending error gives the limits back and retries twice, 30 minutes apart.

## The letter

A fixed template from the profile, plus one AI paragraph (`app_paragraph`, about 128 a day). The
paragraph is dropped, and the template sent alone, if it mentions a job skill the member doesn't
have, claims more years than they have, uses a number not in their profile, or has placeholder text.
No budget left means the template alone, not a delay. The CV goes as an attachment. The footer says
it was sent with i-jobs and that replies reach the member.

## Replies

The relay domain's mail goes to the Cloudflare email worker (`infra/email-worker`), which stores
the raw message in R2 and posts a signed summary here. The engine matches it by thread, then by the
employer's domain, sorts it (interview, rejection, info request, auto-reply, other), moves the
application forward (never back), marks the check-in answered, and emails the reply to the member
with Reply-To set to the employer, so they answer directly.

## Visitors (partner sites)

`POST /visitor/codes` → email code (throwaway domains refused; 3 new emails per device and 10 per
network a day). `POST /visitor/applies` → the apply link, counting one of the site's free applies
(`sites.free_apply_limit`, default 3). Remotive and Himalayas jobs never count and never ask for sign-up.

## Not yet

- Tailored CV files: the pack links the member's own CV for now.
- Employer platform posts and ATS hand-offs (`on_platform`, `ats_api`): with employer features.
- `application.status_changed` webhooks to partner sites: with the partner API in stage 6.
- Pausing a sending domain automatically on high bounce rates: suppressions are recorded; the rate
  check comes with the admin tools.
