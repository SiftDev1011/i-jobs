-- =============================================================================
-- 0003: job ingest pipeline
-- Per-source settings, retry bookkeeping for raw postings, duplicate detection
-- and categories on jobs.
-- =============================================================================

-- Per-source settings that aren't rules: search terms, countries, pages.
-- Seeds fill it only while it is empty, so admin edits survive deploys.
ALTER TABLE sources ADD COLUMN config jsonb NOT NULL DEFAULT '{}';

-- Processing a raw posting can wait (AI budget spent) or fail and retry.
ALTER TABLE raw_postings
  ADD COLUMN attempts       smallint NOT NULL DEFAULT 0,
  ADD COLUMN process_after  timestamptz,
  ADD COLUMN last_error     text,
  ADD COLUMN filter_reason  text;
CREATE INDEX raw_postings_ready_idx ON raw_postings (first_seen_at)
  WHERE status = 'new';
CREATE INDEX raw_postings_board_seen_idx ON raw_postings (source_key, board_id, last_seen_at)
  WHERE gone_at IS NULL;

-- Same job seen on several sources: company + title + place, normalised.
ALTER TABLE jobs
  ADD COLUMN dedupe_key text,
  ADD COLUMN category   text,
  ADD COLUMN closed_reason text;
CREATE INDEX jobs_dedupe_idx ON jobs (dedupe_key) WHERE status IN ('live', 'pending_review');
CREATE INDEX jobs_category_idx ON jobs (category, first_seen_at DESC) WHERE status = 'live';
CREATE INDEX jobs_apply_url_idx ON jobs (apply_url) WHERE status IN ('live', 'pending_review') AND apply_url IS NOT NULL;

ALTER TABLE jobs ADD CONSTRAINT jobs_category_known CHECK (category IS NULL OR category IN (
  'engineering', 'data', 'design', 'product', 'marketing', 'sales', 'customer-support',
  'writing', 'operations', 'finance', 'hr', 'education', 'health', 'legal', 'ngo',
  'internships', 'other'
));

-- Link checks: how many failed in a row before we close the job.
ALTER TABLE jobs ADD COLUMN link_failures smallint NOT NULL DEFAULT 0;
CREATE INDEX jobs_link_check_idx ON jobs (updated_at) WHERE status = 'live' AND apply_url IS NOT NULL;

-- Source health in one place, for /admin/sources.
CREATE VIEW source_health AS
SELECT s.key,
       r.started_at  AS last_run_at,
       r.ok          AS last_run_ok,
       (SELECT count(*) FROM jobs j WHERE j.primary_source_key = s.key AND j.status = 'live')::integer AS jobs_live,
       (SELECT count(*)::integer FROM source_runs x
         WHERE x.source_key = s.key AND x.finished_at IS NOT NULL AND NOT x.ok
           AND x.started_at > coalesce((SELECT max(y.started_at) FROM source_runs y
                                         WHERE y.source_key = s.key AND y.ok), '-infinity')) AS failures_in_a_row,
       coalesce((
         SELECT count(*) FROM source_runs x
          WHERE x.source_key = s.key AND x.started_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
       ), 0)::integer AS runs_today
  FROM sources s
  LEFT JOIN LATERAL (
    SELECT started_at, ok FROM source_runs x
     WHERE x.source_key = s.key AND x.finished_at IS NOT NULL
     ORDER BY started_at DESC LIMIT 1
  ) r ON true;

-- Postings waiting for tomorrow's AI budget, by task (for /admin/ai-budget).
CREATE VIEW ai_waiting AS
SELECT 'job_extract'::ai_task AS task, count(*)::integer AS waiting
  FROM raw_postings WHERE status = 'new' AND process_after > now() AND last_error = 'ai_budget';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ijobs_app') THEN
    GRANT SELECT ON source_health, ai_waiting TO ijobs_app;
  END IF;
END $$;
