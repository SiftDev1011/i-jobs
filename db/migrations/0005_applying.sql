-- =============================================================================
-- 0005: applying — the apply queue, autopilot sending, replies and check-ins
-- =============================================================================

-- Why a match is in the member's apply queue rather than sent by autopilot.
ALTER TABLE matches ADD COLUMN queue_reason text CHECK (queue_reason IN
  ('unverified_employer', 'apply_on_source_site', 'outside_rules', 'autopilot_off', 'job_cap_reached'));

-- Sending bookkeeping: how often we tried, and the employer key used for the per-employer limit.
ALTER TABLE applications
  ADD COLUMN send_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN employer_key  text;

-- Members whose emails keep bouncing are paused from autopilot.
ALTER TABLE users ADD COLUMN bounces_30d smallint NOT NULL DEFAULT 0;

-- Check-ins that went unanswered for long enough close as "no response".
CREATE INDEX outcome_checkins_due_idx ON outcome_checkins (ask_on) WHERE asked_at IS NULL;
CREATE INDEX applications_sent_idx ON applications (sent_at) WHERE status = 'sent';
