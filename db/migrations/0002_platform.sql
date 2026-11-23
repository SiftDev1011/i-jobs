-- =============================================================================
-- i-jobs engine: platform tables for sign-in sessions and safe retries,
-- plus permissions for the app's database role.
-- =============================================================================

-- Sign-in sessions. Refresh tokens rotate on every use; the previous token is
-- kept so a stolen, already-used token can be spotted and the session ended.
CREATE TABLE sessions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id              uuid NOT NULL REFERENCES sites(id),
  refresh_hash         text NOT NULL UNIQUE,
  previous_refresh_hash text,
  user_agent           text,
  ip_hash              text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  last_used_at         timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  revoked_at           timestamptz,
  revoked_reason       text
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_previous_idx ON sessions (previous_refresh_hash) WHERE previous_refresh_hash IS NOT NULL;

-- Idempotency-Key records: a retried request gets the first answer back.
CREATE TABLE idempotency_keys (
  scope          text NOT NULL,            -- who sent it: user:<id> or site:<id>
  key            text NOT NULL,
  method         text NOT NULL,
  path           text NOT NULL,
  request_hash   text NOT NULL,
  status_code    smallint,                 -- NULL while the first request is still running
  response_body  jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (scope, key)
);
CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys (expires_at);

-- Background work (CV parsing, apply packs, pasted jobs, assistant answers)
-- that may be held back by the daily AI budget.
CREATE TYPE work_status AS ENUM ('queued', 'running', 'scheduled', 'done', 'failed');
CREATE TYPE work_kind   AS ENUM ('cv_parse', 'apply_pack', 'job_paste', 'support_answer');

CREATE TABLE work_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           work_kind NOT NULL,
  status         work_status NOT NULL DEFAULT 'queued',
  user_id        uuid REFERENCES users(id) ON DELETE CASCADE,
  site_id        uuid REFERENCES sites(id),
  subject_id     uuid,
  input          jsonb NOT NULL DEFAULT '{}',
  result         jsonb,
  scheduled_for  timestamptz,
  attempts       smallint NOT NULL DEFAULT 0,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX work_items_user_idx ON work_items (user_id, created_at DESC);
CREATE INDEX work_items_waiting_idx ON work_items (scheduled_for) WHERE status = 'scheduled';
CREATE TRIGGER work_items_set_updated_at BEFORE UPDATE ON work_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Permissions for the app role. The API and workers connect as ijobs_app,
-- which does not own the tables, so row-level security applies to it.
-- Create the role once per server (see infra/scripts/init-db.sh).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ijobs_app') THEN
    GRANT USAGE ON SCHEMA public TO ijobs_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ijobs_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ijobs_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ijobs_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ijobs_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ijobs_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ijobs_app;
  END IF;
END $$;
