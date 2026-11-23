-- =============================================================================
-- i-jobs engine: reference data
-- Safe to re-run: every insert updates the existing row.
-- Replace every 'REPLACE-ME' value before production.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Sites
-- -----------------------------------------------------------------------------
INSERT INTO sites (slug, name, api_key_hash, free_apply_limit, allows_minors, requires_community) VALUES
  ('ijobs',         'i-jobs by 99',  'REPLACE-ME-ijobs-key-hash',         3, false, true),
  ('remote-hustle', 'Remote Hustle', 'REPLACE-ME-remote-hustle-key-hash', 3, false, false),
  ('school1',       'School1',       'REPLACE-ME-school1-key-hash',       3, true,  false)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, free_apply_limit = EXCLUDED.free_apply_limit,
  allows_minors = EXCLUDED.allows_minors, requires_community = EXCLUDED.requires_community;

-- -----------------------------------------------------------------------------
-- Sending domains (placeholders until the real domain is chosen)
-- Relay starts small and is raised as the domain warms up.
-- -----------------------------------------------------------------------------
INSERT INTO sending_domains (domain, purpose, daily_limit, warmup_stage) VALUES
  ('apply.ijobs.example', 'relay',   50, 1),
  ('mail.ijobs.example',  'account', 500, 1)
ON CONFLICT (domain) DO UPDATE SET purpose = EXCLUDED.purpose;

-- -----------------------------------------------------------------------------
-- Job sources and their rules
-- 24 outside sources at launch plus 3 of our own.
-- -----------------------------------------------------------------------------
INSERT INTO sources (
  key, name, kind, homepage_url, terms_url, terms_status, display, enabled,
  requires_credit, credit_text, requires_link_back, apply_via_source_link,
  allow_paywall, allow_partner_sites, allow_autopilot, allow_signup_gate,
  needs_ai_extraction, fetch_interval_minutes, max_fetches_per_day,
  publish_delay_hours, excluded_origins, default_expiry_days, notes
) VALUES
-- Applicant-system feeds: structured, read-only, no AI needed to read them.
  ('greenhouse', 'Greenhouse', 'ats_feed', 'https://www.greenhouse.com', 'https://developers.greenhouse.io/job-board.html',
   'ok', 'full', true, false, NULL, true, false, true, true, true, true, false, 180, NULL, 0, '{}', 30,
   'Public Job Board API. Auto-apply only with the employer''s own key (employer_integrations).'),
  ('lever', 'Lever', 'ats_feed', 'https://www.lever.co', 'https://github.com/lever/postings-api',
   'ok', 'full', true, false, NULL, true, false, true, true, true, true, false, 180, NULL, 0, '{}', 30,
   'Public postings API. Auto-apply only with the employer''s own key.'),
  ('ashby', 'Ashby', 'ats_feed', 'https://www.ashbyhq.com', 'https://developers.ashbyhq.com/docs/public-job-posting-api',
   'ok', 'full', true, false, NULL, true, false, true, true, true, true, false, 180, NULL, 0, '{}', 30, NULL),
  ('workable', 'Workable', 'ats_feed', 'https://www.workable.com', NULL,
   'needs_review', 'full', true, false, NULL, true, false, true, true, true, true, false, 240, NULL, 0, '{}', 30,
   'Many empty or sample accounts. Verify each company before adding its board.'),
  ('recruitee', 'Recruitee', 'ats_feed', 'https://recruitee.com', NULL,
   'needs_review', 'full', true, false, NULL, true, false, true, true, true, true, false, 240, NULL, 0, '{}', 30,
   'Verify each company before adding its board.'),
  ('personio', 'Personio', 'ats_feed', 'https://www.personio.com', NULL,
   'needs_review', 'full', true, false, NULL, true, false, true, true, true, true, false, 240, NULL, 0, '{}', 30,
   'XML feed. Verify each company before adding its board.'),
  ('teamtailor', 'Teamtailor', 'ats_feed', 'https://www.teamtailor.com', NULL,
   'needs_review', 'full', true, false, NULL, true, false, true, true, true, true, false, 240, NULL, 0, '{}', 30,
   'RSS feed. Verify each company before adding its board.'),
  ('bamboohr', 'BambooHR', 'ats_feed', 'https://www.bamboohr.com', NULL,
   'needs_review', 'full', true, false, NULL, true, false, true, true, true, true, false, 240, NULL, 0, '{}', 30, NULL),
  ('gupy', 'Gupy', 'ats_feed', 'https://www.gupy.io', NULL,
   'needs_review', 'full', true, false, NULL, true, false, true, true, true, true, false, 360, NULL, 0, '{}', 30,
   'Brazil. Public career boards by company subdomain.'),

-- Remote job boards.
  ('jobicy', 'Jobicy', 'remote_board', 'https://jobicy.com', 'https://jobicy.com/jobs-rss-feed',
   'ok', 'full', true, true, 'via Jobicy', true, true, true, true, false, false, false, 360, 4, 0, '{}', 30,
   'Commercial use allowed with clear credit. Apply button must point to the original job URL.'),
  ('remoteok', 'Remote OK', 'remote_board', 'https://remoteok.com', 'https://remoteok.com/api',
   'needs_review', 'full', true, true, 'via Remote OK', true, true, true, true, false, false, false, 360, 4, 0, '{}', 30,
   'Terms are returned in every API response. Credit and link back.'),
  ('workingnomads', 'Working Nomads', 'remote_board', 'https://www.workingnomads.com', 'https://www.workingnomads.com/api/exposed_jobs',
   'needs_review', 'full', true, true, 'via Working Nomads', true, true, true, true, false, false, false, 360, 4, 0, '{}', 30, NULL),
  ('remotive', 'Remotive', 'remote_board', 'https://remotive.com', 'https://github.com/remotive-com/remote-jobs-api',
   'pending_reply', 'job_finds_only', true, true, 'via Remotive', true, true, false, true, false, false, false, 360, 4, 24, '{}', 30,
   'Bans using its jobs to collect sign-ups. Free job finds page only until written permission.'),
  ('himalayas', 'Himalayas', 'remote_board', 'https://himalayas.app', 'https://himalayas.app/api',
   'pending_reply', 'job_finds_only', true, true, 'via Himalayas', true, true, false, true, false, false, false, 360, NULL, 0, '{}', 30,
   'Apply must use the API''s applicationLink. Job finds page only until written permission.'),
  ('weworkremotely', 'We Work Remotely', 'remote_board', 'https://weworkremotely.com', 'https://weworkremotely.com/remote-jobs.rss',
   'pending_reply', 'disabled', false, true, 'via We Work Remotely', true, true, false, true, false, false, false, 360, 4, 0, '{}', 30,
   'Off until they reply to the permission email.'),

-- Aggregators: jobs always open through the aggregator's own link.
  ('careerjet', 'Careerjet', 'aggregator', 'https://www.careerjet.com', 'https://www.careerjet.im/partners/api',
   'needs_review', 'full', true, true, 'via Careerjet', true, true, false, true, false, false, false, 360, NULL, 0, '{}', 30,
   'Publisher API. Confirm whether paid matching may include these jobs.'),
  ('jooble', 'Jooble', 'aggregator', 'https://jooble.org', 'https://jooble.org/api/about',
   'needs_review', 'full', true, true, 'via Jooble', true, true, false, true, false, false, false, 360, NULL, 0, '{}', 30,
   'Confirm whether paid matching may include these jobs.'),
  ('talent', 'Talent.com', 'aggregator', 'https://www.talent.com', 'https://www.talent.com/publishers',
   'pending_reply', 'disabled', false, true, 'via Talent.com', true, true, false, true, false, false, false, 360, NULL, 0, '{}', 30,
   'Publisher programme needs approval. Paid per click; clicks must go to Talent.com.'),
  ('adzuna', 'Adzuna', 'aggregator', 'https://www.adzuna.com', 'https://developer.adzuna.com/docs/terms_of_service',
   'restricted', 'full', true, true, 'Jobs by Adzuna', true, true, false, true, false, false, false, 360, NULL, 0, '{}', 30,
   'Trial only; commercial licence needed after. Logo at least 116x23px. Never contact advertisers directly.'),

-- NGO, Latin America, paid provider.
  ('reliefweb', 'ReliefWeb', 'ngo', 'https://reliefweb.int', 'https://apidoc.reliefweb.int',
   'needs_review', 'full', true, true, 'via ReliefWeb', true, true, true, true, false, false, false, 720, NULL, 0, '{}', 30,
   'Every request needs our pre-approved appname. Limits on reusing content.'),
  ('getonboard', 'Get on Board', 'remote_board', 'https://www.getonbrd.com', 'https://www.getonbrd.com/pages/get-on-board-terms-and-conditions-agreement',
   'pending_reply', 'disabled', false, true, 'via Get on Board', true, true, false, true, false, false, false, 720, NULL, 0, '{}', 30,
   'Off until they reply. Remote jobs open outside Latin America only.'),
  ('theirstack', 'TheirStack', 'paid_provider', 'https://theirstack.com', 'https://theirstack.com/en/docs/legal/terms-and-conditions',
   'ok', 'full', true, false, NULL, true, false, true, true, true, true, false, 1440, NULL, 0, '{linkedin,indeed}', 30,
   'Free tier at launch. Drop every job that came from LinkedIn or Indeed. No reselling the data.'),

-- Social.
  ('hackernews', 'Hacker News: Who is hiring?', 'social', 'https://news.ycombinator.com', NULL,
   'needs_review', 'full', true, true, 'via Hacker News', true, false, true, true, true, true, true, 720, NULL, 0, '{}', 30,
   'Monthly thread. Auto-apply only when the apply email matches the company''s real domain.'),
  ('bluesky', 'Bluesky', 'social', 'https://bsky.app', 'https://docs.bsky.app/docs/support/developer-guidelines',
   'needs_review', 'full', true, true, 'via Bluesky', true, true, true, true, false, true, true, 120, NULL, 0, '{}', 21,
   'Take the job down when the post is deleted. Unverified by default.'),

-- Our own.
  ('community_paste', 'Community post', 'community_paste', NULL, NULL,
   'ok', 'full', true, false, NULL, false, false, true, true, true, true, true, 5, NULL, 0, '{}', 21,
   'Pasted by verified owners. Unverified until matched to the employer.'),
  ('employer_post', 'Employer post', 'employer_post', NULL, NULL,
   'ok', 'full', true, false, NULL, false, false, true, true, true, true, false, 5, NULL, 0, '{}', 30, NULL),
  ('remote_hustle', 'Remote Hustle', 'platform_post', NULL, NULL,
   'ok', 'full', true, false, NULL, false, false, true, true, true, true, false, 5, NULL, 0, '{}', 30,
   'Remote Hustle''s own jobs, internships and trainings.')
-- Rules (display, enabled, terms, permissions, intervals, notes) are only set the first time:
-- after that they belong to admins (PATCH /admin/sources/{key}) and deploys never reset them.
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name, kind = EXCLUDED.kind, homepage_url = EXCLUDED.homepage_url,
  terms_url = EXCLUDED.terms_url, needs_ai_extraction = EXCLUDED.needs_ai_extraction;

-- -----------------------------------------------------------------------------
-- AI: Groq free tier only
-- Limits as listed on console.groq.com/docs/rate-limits. Check your own limits
-- page after setup and update these numbers if they differ.
-- -----------------------------------------------------------------------------
INSERT INTO ai_models (key, provider, model_name, plan, rpm, rpd, tpm, tpd, safety_margin_pct, is_preview, enabled, fallback_key) VALUES
  ('groq:openai/gpt-oss-20b',  'groq', 'openai/gpt-oss-20b',  'free', 30, 1000, 8000, 200000, 10, false, true, NULL),
  ('groq:openai/gpt-oss-120b', 'groq', 'openai/gpt-oss-120b', 'free', 30, 1000, 8000, 200000, 10, false, true, NULL),
  ('groq:qwen/qwen3.8-27b',    'groq', 'qwen/qwen3.8-27b',    'free', 30, 1000, 8000, 200000, 10, true,  true, 'groq:openai/gpt-oss-20b')
ON CONFLICT (key) DO UPDATE SET
  rpm = EXCLUDED.rpm, rpd = EXCLUDED.rpd, tpm = EXCLUDED.tpm, tpd = EXCLUDED.tpd,
  safety_margin_pct = EXCLUDED.safety_margin_pct, is_preview = EXCLUDED.is_preview,
  enabled = EXCLUDED.enabled, fallback_key = EXCLUDED.fallback_key;

-- Each model keeps 10% spare: 180,000 usable tokens a day.
INSERT INTO ai_task_budgets (task, model_key, daily_tokens, est_tokens_per_call, priority, user_waiting, notes) VALUES
  -- gpt-oss-20b: 180,000
  ('cv_parse',       'groq:openai/gpt-oss-20b',  50000, 3000, 1, true,  '~16 new profiles a day'),
  ('scam_check',     'groq:openai/gpt-oss-20b',  30000,  800, 2, false, 'Messy-text jobs only; ~37 a day'),
  ('job_extract',    'groq:openai/gpt-oss-20b', 100000, 1500, 4, false, 'Messy-text jobs only; structured feeds use code. ~66 a day'),
  -- gpt-oss-120b: 180,000
  ('app_paragraph',  'groq:openai/gpt-oss-120b', 180000, 1400, 2, false, 'One tailored paragraph per application; ~128 a day'),
  -- qwen3.8-27b (preview, falls back to gpt-oss-20b): 180,000
  ('reply_sort',     'groq:qwen/qwen3.8-27b',     60000,  600, 1, false, '~100 replies a day'),
  ('apply_pack',     'groq:qwen/qwen3.8-27b',    100000, 2000, 1, true,  'Made only when someone opens a job; ~50 a day'),
  ('support_answer', 'groq:qwen/qwen3.8-27b',     20000, 1500, 3, true,  'Only when the FAQ has no answer; ~13 a day')
ON CONFLICT (task) DO UPDATE SET
  model_key = EXCLUDED.model_key, daily_tokens = EXCLUDED.daily_tokens,
  est_tokens_per_call = EXCLUDED.est_tokens_per_call, priority = EXCLUDED.priority,
  user_waiting = EXCLUDED.user_waiting, notes = EXCLUDED.notes;
