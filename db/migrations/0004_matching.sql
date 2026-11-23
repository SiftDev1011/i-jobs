-- =============================================================================
-- 0004: profiles, embeddings and matching
-- =============================================================================

-- Partner sites send their own course ids; one row per site and course.
ALTER TABLE trainings ADD COLUMN external_id text;
UPDATE trainings SET external_id = id::text WHERE external_id IS NULL;
ALTER TABLE trainings ALTER COLUMN external_id SET NOT NULL;
ALTER TABLE trainings ADD CONSTRAINT trainings_site_external_unique UNIQUE (site_id, external_id);
CREATE INDEX trainings_skills_idx ON trainings USING gin (skills) WHERE active;

-- Embeddings are only redone when the text behind them changes.
ALTER TABLE jobs
  ADD COLUMN embedded_at   timestamptz,
  ADD COLUMN matched_at    timestamptz;   -- last time this job was matched against profiles
CREATE INDEX jobs_to_embed_idx ON jobs (first_seen_at) WHERE status = 'live' AND embedding IS NULL;
CREATE INDEX jobs_to_match_idx ON jobs (first_seen_at) WHERE status = 'live' AND matched_at IS NULL;

ALTER TABLE profiles
  ADD COLUMN embedded_text_hash text,
  ADD COLUMN matched_at         timestamptz;

-- Matches stay small: a member's best 150 jobs at most, refreshed as jobs and the profile change.
ALTER TABLE matches ADD COLUMN pathways jsonb NOT NULL DEFAULT '[]';
CREATE INDEX matches_user_status_idx ON matches (user_id, status, score DESC);

-- Views written as j.* freeze the column list when created. Rebuild matchable_jobs so it
-- includes the columns added since (category, dedupe_key, embedded_at, matched_at...).
DROP VIEW matchable_jobs;
CREATE VIEW matchable_jobs AS
SELECT j.*,
       (s.allow_autopilot
          AND j.trust IN ('verified_employer', 'careers_page')
          AND j.apply_method IN ('on_platform', 'email', 'ats_api')
          AND NOT s.apply_via_source_link
          AND j.autopilot_sent < j.autopilot_cap
          AND j.first_seen_at > now() - interval '14 days') AS autopilot_ok
  FROM jobs j
  JOIN sources s ON s.key = j.primary_source_key
 WHERE j.status = 'live'
   AND s.enabled
   AND s.display = 'full'
   AND s.allow_paywall;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ijobs_app') THEN
    GRANT SELECT ON matchable_jobs TO ijobs_app;
  END IF;
END $$;
