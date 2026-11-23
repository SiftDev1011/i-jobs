-- =============================================================================
-- 0007: notifications, support, partner webhooks, employers, data requests
-- =============================================================================

-- FAQ: word search when embeddings aren't available, and one copy of each shared question.
ALTER TABLE faq_articles ADD COLUMN search tsvector GENERATED ALWAYS AS (to_tsvector('english', question || ' ' || answer)) STORED;
CREATE INDEX faq_search_idx ON faq_articles USING gin (search);
CREATE UNIQUE INDEX faq_shared_question_idx ON faq_articles (question) WHERE site_id IS NULL;

-- Webhook deliveries are signed with the endpoint's secret, so it must be kept (encrypted), not only hashed.
ALTER TABLE webhook_endpoints ADD COLUMN secret_ciphertext bytea;
ALTER TABLE webhook_deliveries ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN last_error text, ADD COLUMN event_id uuid NOT NULL DEFAULT gen_random_uuid();

-- Notifications that also go out by email.
CREATE INDEX notifications_unsent_idx ON notifications (created_at) WHERE sent_at IS NULL;

-- Employer verification: which checks have passed.
ALTER TABLE employers ADD COLUMN checks jsonb NOT NULL DEFAULT '{"work_email": false, "website": false, "registry": false}';

-- Employers can cap applications to a posting.
ALTER TABLE jobs ADD COLUMN max_applicants integer CHECK (max_applicants IS NULL OR max_applicants > 0);

-- Data requests run after a short wait, so a mistaken delete can still be stopped by support.
ALTER TABLE data_requests ADD COLUMN process_after timestamptz NOT NULL DEFAULT now(), ADD COLUMN result_key text;

CREATE INDEX support_tickets_user_idx ON support_tickets (user_id, created_at DESC);
CREATE INDEX support_tickets_status_idx ON support_tickets (status, created_at) WHERE status <> 'resolved';

-- One delivery per event per endpoint, so the outbox can safely re-run after a crash.
CREATE UNIQUE INDEX webhook_deliveries_event_idx ON webhook_deliveries (endpoint_id, event_id);

-- Courses the member finished on the partner site (sent with POST /partner/users); skill gaps skip these.
ALTER TABLE site_accounts ADD COLUMN completed_trainings text[] NOT NULL DEFAULT '{}';
