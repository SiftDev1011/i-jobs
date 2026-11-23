# Profiles and matching

## CV → profile

```
POST /me/cv          → signed upload link (PDF or .docx, ≤ 5 MB, 15 minutes); the browser PUTs the file to R2
POST /me/cv/parse    → needs the "matching" consent; queues a cv_parse work item (202)
worker ai:cv_parse   → pdftotext / mammoth → Groq (cv_parse budget) → profile → "profile.ready" notification
```

- The file type is decided by its first bytes, not its name. Scans and photos (no text) fail with a
  clear message and a `cv.unreadable` notification.
- The AI is told to leave out name, email, phone and address. The CV text itself isn't stored.
- A new CV replaces the CV-based parts of the profile but keeps the member's own country, city and
  time zone, and asks them to confirm the profile again.
- If today's `cv_parse` budget (about 16 CVs) is spent, the answer says `scheduled` with the time,
  and the job runs after 00:05 UTC.

## Who is matched to what

Only jobs in `matchable_jobs`: live, from an enabled source shown in full **and allowed in paid
matching** (`allow_paywall`). Remotive, Himalayas and the aggregators stay on the free job finds page.

A member only sees jobs they could take:

- worldwide or unspecified-location remote jobs;
- restricted jobs that list their country, or a region their country is in (Nigeria → `africa`, `emea`),
  or a country in their work authorisation;
- on-site or hybrid jobs only in their own countries;
- no jobs whose required hours are more than 4 hours from their time zone;
- teens on School1: only jobs marked suitable for minors.

## The score (0-100, no AI call)

| Part | With embeddings | Without |
|---|---|---|
| Meaning: Voyage similarity between profile and job | 40 | — |
| Skills: share of the job's listed skills they have, or their skills the job mentions | 30 | 45 |
| Title: their headline and past titles against the job title | 15 | 30 |
| Seniority: years of experience against the level | 10 | 15 |
| Place: their country named > worldwide > unspecified | 5 | 10 |

Minus 5% per hour outside the job's time zone range. Matches under 35 are dropped; each member keeps
their best 150. Reasons are plain sentences ("Skills: Zendesk, Live chat", "Hours fit your time zone",
"Open to applicants in Nigeria"). Gaps are the job's listed skills they lack, each linked to a course
from Remote Hustle or School1 (`PUT /partner/trainings`) when one covers it.

## When matches are recomputed

- after a CV is read, the profile is edited (debounced to once per 30 s);
- every 10 minutes: new jobs are embedded, then matched against likely members (nearest profiles by
  meaning, plus anyone sharing a skill or title word);
- nightly at 02:30 UTC: every member not refreshed in the last 20 hours.

A member's own choices (seen, saved, dismissed) survive recomputes.

## Voyage limits

Without a payment method on the Voyage account the limits are 3 requests and 10K tokens a minute,
which embeds roughly 60 jobs a minute at best. Add a payment method (the free tokens still apply) and
raise `VOYAGE_RPM` / `VOYAGE_TPM`. Until a key is set, matching runs on skills and titles alone.
