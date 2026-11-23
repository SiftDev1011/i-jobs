-- Per-source search settings and a few starter company boards.
-- Safe to re-run: config is only filled while empty, boards only added if missing.
-- Admins change these afterwards; deploys never overwrite them.

UPDATE sources AS s SET config = v.config::jsonb
FROM (VALUES
  -- Remote boards: whole feed, a few pages.
  ('himalayas',      '{"pages": 5, "page_size": 20}'),
  ('remotive',       '{"limit": 300}'),
  ('getonboard',     '{"categories": ["programming", "design-ux", "customer-support", "sales", "marketing", "data-science-analytics"], "per_page": 50}'),
  -- Aggregators: what to search for. Adzuna has no Nigeria site, so remote roles in big markets.
  ('adzuna',         '{"countries": ["gb", "us", "za", "in"], "what": "remote", "results_per_page": 50, "pages": 2, "max_days_old": 3}'),
  ('careerjet',      '{"locales": ["en_NG", "en_ZA", "en_KE", "en_GH"], "keywords": "", "pages": 2, "page_size": 99}'),
  ('jooble',         '{"searches": [{"keywords": "remote", "location": ""}, {"keywords": "", "location": "Nigeria"}], "per_page": 50, "pages": 2}'),
  ('reliefweb',      '{"countries_iso3": ["NGA", "GHA", "KEN", "ZAF", "ETH", "UGA", "RWA", "SEN", "CMR", "TZA"], "limit": 100}'),
  -- TheirStack free tier: about 200 jobs a month, so a small daily slice.
  ('theirstack',     '{"limit": 6, "posted_at_max_age_days": 2, "remote": true}'),
  -- Social: hashtags and the monthly HN thread.
  ('bluesky',        '{"queries": ["#hiring remote", "#remotejobs", "#nigeriajobs", "#techjobs remote"], "limit": 50}'),
  ('hackernews',     '{"max_comments": 400}')
) AS v(key, config)
WHERE s.key = v.key AND s.config = '{}'::jsonb;

-- Starter boards on applicant systems. Wrong or closed boards switch themselves off
-- after five failed fetches (source_boards.consecutive_failures).
INSERT INTO source_boards (source_key, board_token, company_name, discovered_from) VALUES
  ('greenhouse', 'gitlab',   'GitLab',   'seed'),
  ('greenhouse', 'duolingo', 'Duolingo', 'seed'),
  ('lever',      'palantir', 'Palantir', 'seed'),
  ('ashby',      'ramp',     'Ramp',     'seed'),
  ('ashby',      'linear',   'Linear',   'seed')
ON CONFLICT (source_key, board_token) DO NOTHING;
