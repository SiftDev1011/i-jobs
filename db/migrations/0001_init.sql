-- =============================================================================
-- i-jobs engine: initial schema
-- PostgreSQL 16+ with pgvector. One database serves i-jobs, Remote Hustle,
-- School1 and future sites. Records that belong to a site carry site_id.
--
-- Conventions
--   * Money is stored in the smallest unit (kobo for NGN, cents for USD) as bigint.
--   * Times are timestamptz and stored in UTC.
--   * Embeddings are Voyage voyage-4 vectors (1024 dimensions).
--   * Files (CVs, raw emails, ID documents) live in Cloudflare R2. Tables keep
--     only the R2 object key, never the file itself.
--   * Secrets (partner keys, employer ATS keys) are stored hashed or encrypted.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -----------------------------------------------------------------------------
-- Request context helpers
-- The API sets these per request:
--   SET LOCAL app.site_id = '<site uuid>';   -- which site the request came from
--   SET LOCAL app.role    = 'engine';        -- only for background workers
-- -----------------------------------------------------------------------------
CREATE FUNCTION app_site_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.site_id', true), '')::uuid
$$;

CREATE FUNCTION app_is_engine() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.role', true), '') = 'engine'
$$;

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------
CREATE TYPE user_status        AS ENUM ('active', 'suspended', 'deleted');
CREATE TYPE age_band           AS ENUM ('unknown', 'under_13', 'teen', 'adult');
CREATE TYPE staff_role         AS ENUM ('admin', 'moderator', 'support', 'dpo', 'finance');
CREATE TYPE consent_purpose    AS ENUM (
  'terms', 'privacy', 'matching', 'autopilot', 'reply_reading',
  'cross_site_linking', 'cross_site_marketing', 'training_data', 'guardian'
);
CREATE TYPE auth_code_purpose  AS ENUM ('login', 'verify_email', 'verify_phone', 'anonymous_apply');
CREATE TYPE guardian_status    AS ENUM ('pending', 'approved', 'declined', 'expired');

CREATE TYPE community_status   AS ENUM ('pending_review', 'active', 'suspended', 'banned');
CREATE TYPE billing_period     AS ENUM ('monthly', 'quarterly', 'yearly');
CREATE TYPE membership_status  AS ENUM (
  'pending_approval', 'pending_payment', 'trialing', 'active',
  'past_due', 'expired', 'cancelled'
);
CREATE TYPE membership_source  AS ENUM (
  'invite_link', 'invite_code', 'bulk_invite', 'job_finds_page', 'access_code', 'switched'
);
CREATE TYPE onboarding_step    AS ENUM ('joined', 'paid', 'cv_uploaded', 'rules_set', 'complete');
CREATE TYPE invite_channel     AS ENUM ('email', 'phone');
CREATE TYPE invite_status      AS ENUM ('pending', 'sent', 'opened', 'joined', 'revoked');
CREATE TYPE access_code_status AS ENUM ('unused', 'redeemed', 'void');
CREATE TYPE review_decision    AS ENUM ('pending', 'approved', 'rejected', 'needs_more_info');

CREATE TYPE payment_purpose    AS ENUM ('membership', 'code_batch');
CREATE TYPE payment_status     AS ENUM ('pending', 'succeeded', 'failed', 'refunded', 'reversed');
CREATE TYPE ledger_account     AS ENUM ('cash', 'platform_revenue', 'owner_payable', 'provider_fees', 'refunds');
CREATE TYPE payout_status      AS ENUM ('held', 'ready', 'processing', 'paid', 'frozen', 'failed');
CREATE TYPE fraud_kind         AS ENUM (
  'shared_card', 'shared_device', 'shared_network', 'chargeback_spike',
  'inactive_paid_members', 'trial_abuse', 'other'
);
CREATE TYPE flag_status        AS ENUM ('open', 'confirmed', 'dismissed');

CREATE TYPE source_kind        AS ENUM (
  'ats_feed', 'remote_board', 'aggregator', 'ngo', 'paid_provider',
  'social', 'community_paste', 'employer_post', 'platform_post'
);
CREATE TYPE source_display     AS ENUM ('full', 'job_finds_only', 'disabled');
CREATE TYPE terms_status       AS ENUM ('ok', 'needs_review', 'pending_reply', 'restricted', 'blocked');
CREATE TYPE raw_status         AS ENUM ('new', 'filtered_out', 'extracted', 'merged', 'rejected', 'error');
CREATE TYPE location_scope     AS ENUM ('worldwide', 'unspecified', 'restricted');
CREATE TYPE employment_type    AS ENUM (
  'full_time', 'part_time', 'contract', 'freelance', 'internship', 'graduate', 'temporary'
);
CREATE TYPE pay_period         AS ENUM ('hour', 'day', 'week', 'month', 'year', 'project');
CREATE TYPE apply_method       AS ENUM ('on_platform', 'email', 'ats_api', 'external_link');
CREATE TYPE trust_level        AS ENUM ('verified_employer', 'careers_page', 'unverified');
CREATE TYPE job_status         AS ENUM ('pending_review', 'live', 'expired', 'removed', 'scam');
CREATE TYPE verification_status AS ENUM ('unverified', 'pending', 'verified', 'revoked');
CREATE TYPE moderation_subject AS ENUM ('job', 'community', 'owner', 'employer', 'user');
CREATE TYPE moderation_status  AS ENUM ('open', 'in_review', 'approved', 'rejected', 'escalated');

CREATE TYPE match_status       AS ENUM ('new', 'seen', 'saved', 'dismissed', 'in_queue', 'applied');
CREATE TYPE application_mode   AS ENUM ('autopilot', 'apply_queue', 'manual');
CREATE TYPE application_channel AS ENUM ('on_platform', 'email_relay', 'ats_api', 'external');
CREATE TYPE application_status AS ENUM (
  'scheduled', 'sending', 'sent', 'failed', 'cancelled',
  'replied', 'interview', 'rejected', 'offer', 'hired', 'no_response'
);
CREATE TYPE checkin_answer     AS ENUM ('heard_back', 'interview', 'no_reply_yet', 'rejected', 'hired', 'did_not_apply');
CREATE TYPE send_scope         AS ENUM ('domain', 'employer', 'user', 'job');
CREATE TYPE domain_purpose     AS ENUM ('relay', 'account');
CREATE TYPE email_direction    AS ENUM ('outbound', 'inbound');
CREATE TYPE reply_class        AS ENUM ('interview', 'rejection', 'info_request', 'auto_reply', 'other');

CREATE TYPE ai_task            AS ENUM (
  'job_extract', 'scam_check', 'cv_parse', 'app_paragraph',
  'reply_sort', 'apply_pack', 'support_answer'
);
CREATE TYPE ai_call_status     AS ENUM ('ok', 'rate_limited', 'budget_exhausted', 'error');

CREATE TYPE notify_channel     AS ENUM ('in_app', 'email', 'push');
CREATE TYPE ticket_status      AS ENUM ('open', 'bot_answered', 'waiting_human', 'resolved');
CREATE TYPE ticket_author      AS ENUM ('user', 'bot', 'staff');
CREATE TYPE data_request_type  AS ENUM ('export', 'delete', 'correct', 'human_review');
CREATE TYPE data_request_status AS ENUM ('received', 'in_progress', 'done', 'refused');
CREATE TYPE delivery_status    AS ENUM ('pending', 'delivered', 'failed');

-- =============================================================================
-- 1. Sites, people and access
-- =============================================================================

-- Each product that uses the engine: i-jobs, Remote Hustle, School1, later more.
CREATE TABLE sites (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL UNIQUE,
  name              text NOT NULL,
  api_key_hash      text NOT NULL UNIQUE,          -- only a hash of the partner key
  free_apply_limit  smallint NOT NULL DEFAULT 3 CHECK (free_apply_limit >= 0),
  allows_minors     boolean NOT NULL DEFAULT false, -- School1 may have 13-17 year olds
  requires_community boolean NOT NULL DEFAULT false, -- i-jobs: access only through a community
  settings          jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- One row per real person, shared across sites once they agree to link accounts.
CREATE TABLE users (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                    citext UNIQUE,
  email_verified_at        timestamptz,
  phone                    text UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),  -- E.164
  phone_verified_at        timestamptz,
  full_name                text,
  date_of_birth            date,
  age_band                 age_band NOT NULL DEFAULT 'unknown',
  status                   user_status NOT NULL DEFAULT 'active',
  referred_by_community_id uuid,        -- the community that brought them; credit follows the person
  referred_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz,
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE staff_members (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role       staff_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- How a site's own user maps to the shared person.
CREATE TABLE site_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_user_id  text NOT NULL,                  -- the site's own user id
  linked_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, external_user_id),
  UNIQUE (site_id, user_id)
);

-- One-time codes for login, verification and the anonymous apply limit.
CREATE TABLE auth_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid REFERENCES sites(id),
  target      citext NOT NULL,                      -- email or phone
  purpose     auth_code_purpose NOT NULL,
  code_hash   text NOT NULL,
  attempts    smallint NOT NULL DEFAULT 0 CHECK (attempts <= 5),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_codes_target_idx ON auth_codes (target, purpose, created_at DESC);

-- Consent is append-only. The latest row per purpose is the current answer.
CREATE TABLE consents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id         uuid REFERENCES sites(id),
  purpose         consent_purpose NOT NULL,
  granted         boolean NOT NULL,
  policy_version  text NOT NULL,
  ip_hash         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_lookup_idx ON consents (user_id, purpose, created_at DESC);

-- Parent approval for 13-17 year olds.
CREATE TABLE guardian_consents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guardian_name   text NOT NULL,
  guardian_email  citext NOT NULL,
  token_hash      text NOT NULL,
  status          guardian_status NOT NULL DEFAULT 'pending',
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Visitors who apply before signing up, counted by a verified email or phone.
CREATE TABLE apply_meter (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            uuid NOT NULL REFERENCES sites(id),
  identity_hash      text NOT NULL,                 -- hash of the verified email or phone
  applies_used       smallint NOT NULL DEFAULT 0 CHECK (applies_used >= 0),
  device_hash        text,
  ip_hash            text,
  converted_user_id  uuid REFERENCES users(id),
  first_at           timestamptz NOT NULL DEFAULT now(),
  last_at            timestamptz NOT NULL DEFAULT now(),
  delete_after       timestamptz NOT NULL DEFAULT now() + interval '90 days',
  UNIQUE (site_id, identity_hash)
);
CREATE INDEX apply_meter_device_idx ON apply_meter (site_id, device_hash, first_at);

-- =============================================================================
-- 2. Community owners, communities and members
-- =============================================================================

-- One owner identity per real person, checked against ID and bank account so a
-- banned owner can't come back under a new name.
CREATE TABLE owner_profiles (
  user_id               uuid PRIMARY KEY REFERENCES users(id),
  legal_name            text NOT NULL,
  id_type               text NOT NULL,              -- NIN, passport, driver's licence
  id_number_hash        text NOT NULL UNIQUE,
  id_document_key       text,                       -- R2 key
  bank_code             text,
  bank_account_hash     text UNIQUE,
  bank_account_last4    char(4),
  identity_verified_at  timestamptz,
  payout_eligible       boolean NOT NULL DEFAULT false,
  banned_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE communities (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id        uuid NOT NULL REFERENCES owner_profiles(user_id),
  name                 text NOT NULL,
  slug                 citext NOT NULL UNIQUE,      -- ijobs.com/join/<slug>
  invite_code          citext NOT NULL UNIQUE,      -- short shareable code
  description          text,
  proof_links          jsonb NOT NULL DEFAULT '[]', -- WhatsApp/Telegram group links given as proof
  status               community_status NOT NULL DEFAULT 'pending_review',
  verified_at          timestamptz,
  verified_by          uuid REFERENCES users(id),
  -- Owner-set price. The 500000 kobo floor is the N5,000 minimum. Only the
  -- owner onboarding page shows this rule; public pages never show prices.
  price_kobo           bigint NOT NULL CHECK (price_kobo >= 500000),
  billing_period       billing_period NOT NULL DEFAULT 'monthly',
  platform_share_bps   integer NOT NULL CHECK (platform_share_bps BETWEEN 0 AND 10000), -- i-jobs share
  trial_enabled        boolean NOT NULL DEFAULT false,  -- free trial week, owner's choice
  approval_required    boolean NOT NULL DEFAULT false,  -- owner approves each member first
  demo_tours_used      smallint NOT NULL DEFAULT 0 CHECK (demo_tours_used BETWEEN 0 AND 2),
  strike_count         smallint NOT NULL DEFAULT 0 CHECK (strike_count >= 0),
  banned_at            timestamptz,
  ban_reason           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX communities_name_trgm_idx ON communities USING gin (name gin_trgm_ops);
CREATE INDEX communities_owner_idx ON communities (owner_user_id);

ALTER TABLE users
  ADD CONSTRAINT users_referred_by_fk FOREIGN KEY (referred_by_community_id) REFERENCES communities(id);

CREATE TABLE community_verifications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id          uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  claimed_member_count  integer CHECK (claimed_member_count >= 0),
  group_started_on      date,
  evidence              jsonb NOT NULL DEFAULT '[]',  -- screenshots (R2 keys), links
  decision              review_decision NOT NULL DEFAULT 'pending',
  reviewer_id           uuid REFERENCES users(id),
  reviewer_note         text,
  submitted_at          timestamptz NOT NULL DEFAULT now(),
  decided_at            timestamptz
);

CREATE TABLE community_strikes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  reason        text NOT NULL,
  issued_by     uuid REFERENCES users(id),
  appeal_text   text,
  appeal_decision review_decision,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Bulk invites to phone numbers or emails, plus their progress.
CREATE TABLE community_invites (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id    uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  channel         invite_channel NOT NULL,
  target          citext NOT NULL,
  status          invite_status NOT NULL DEFAULT 'pending',
  sent_at         timestamptz,
  opened_at       timestamptz,
  joined_user_id  uuid REFERENCES users(id),
  last_nudged_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, target)
);

CREATE TABLE memberships (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  community_id          uuid NOT NULL REFERENCES communities(id),
  status                membership_status NOT NULL,
  source                membership_source NOT NULL,
  onboarding_step       onboarding_step NOT NULL DEFAULT 'joined',
  invite_id             uuid REFERENCES community_invites(id),
  approved_at           timestamptz,
  approved_by           uuid REFERENCES users(id),
  trial_started_at      timestamptz,
  trial_ends_at         timestamptz,
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  cancelled_at          timestamptz,
  last_nudged_at        timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, community_id),
  CHECK (trial_ends_at IS NULL OR trial_ends_at > trial_started_at),
  CHECK (status <> 'trialing' OR trial_ends_at IS NOT NULL)
);
CREATE INDEX memberships_community_idx ON memberships (community_id, status);
CREATE INDEX memberships_period_end_idx ON memberships (current_period_end) WHERE status IN ('active', 'past_due');
CREATE INDEX memberships_trial_end_idx ON memberships (trial_ends_at) WHERE status = 'trialing';

-- One free trial per person, across every community, checked by phone and card.
CREATE TABLE trial_claims (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  membership_id     uuid NOT NULL REFERENCES memberships(id),
  phone_hash        text NOT NULL UNIQUE,
  card_fingerprint  text UNIQUE,
  claimed_at        timestamptz NOT NULL DEFAULT now()
);

-- Prepaid batches of single-use codes that owners sell on Selar.
-- i-jobs' share is paid upfront per code. Codes never expire and are non-refundable.
CREATE TABLE code_batches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id      uuid NOT NULL REFERENCES communities(id),
  quantity          integer NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  unit_share_kobo   bigint NOT NULL CHECK (unit_share_kobo > 0),
  total_kobo        bigint GENERATED ALWAYS AS (quantity * unit_share_kobo) STORED,
  grants_period     billing_period NOT NULL DEFAULT 'monthly',  -- OPEN: how long a code's access lasts
  payment_id        uuid,                                       -- set once paid (FK below)
  terms_accepted_at timestamptz NOT NULL,                       -- "never expire, non-refundable"
  created_by        uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE access_codes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           citext NOT NULL UNIQUE,
  batch_id       uuid NOT NULL REFERENCES code_batches(id),
  community_id   uuid NOT NULL REFERENCES communities(id),
  status         access_code_status NOT NULL DEFAULT 'unused',
  redeemed_by    uuid REFERENCES users(id),
  redeemed_at    timestamptz,
  membership_id  uuid REFERENCES memberships(id),
  voided_at      timestamptz,
  void_reason    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'redeemed') = (redeemed_by IS NOT NULL AND redeemed_at IS NOT NULL)),
  CHECK ((status = 'void') = (voided_at IS NOT NULL))
);
CREATE INDEX access_codes_batch_idx ON access_codes (batch_id, status);

-- =============================================================================
-- 3. Payments (Paga) and our own ledger
-- =============================================================================

CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  community_id    uuid REFERENCES communities(id),
  membership_id   uuid REFERENCES memberships(id),
  code_batch_id   uuid REFERENCES code_batches(id),
  purpose         payment_purpose NOT NULL,
  amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
  currency        char(3) NOT NULL DEFAULT 'NGN',
  provider        text NOT NULL DEFAULT 'paga',
  provider_ref    text UNIQUE,                 -- Paga reference, makes webhooks idempotent
  status          payment_status NOT NULL DEFAULT 'pending',
  card_fingerprint text,
  paid_at         timestamptz,
  failure_reason  text,
  raw             jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (purpose <> 'membership' OR membership_id IS NOT NULL),
  CHECK (purpose <> 'code_batch' OR code_batch_id IS NOT NULL)
);
CREATE INDEX payments_community_idx ON payments (community_id, paid_at);

ALTER TABLE code_batches
  ADD CONSTRAINT code_batches_payment_fk FOREIGN KEY (payment_id) REFERENCES payments(id);

CREATE TABLE payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id    uuid NOT NULL REFERENCES communities(id),
  amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
  status          payout_status NOT NULL DEFAULT 'held',
  hold_until      timestamptz NOT NULL,         -- covers refunds and chargebacks
  provider_ref    text UNIQUE,
  frozen_reason   text,
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payouts_due_idx ON payouts (status, hold_until);

-- Double-entry: every money event is one txn_id whose entries add up to zero.
CREATE TABLE ledger_entries (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  txn_id        uuid NOT NULL,
  account       ledger_account NOT NULL,
  community_id  uuid REFERENCES communities(id),   -- set for owner_payable
  payment_id    uuid REFERENCES payments(id),
  payout_id     uuid REFERENCES payouts(id),
  amount_kobo   bigint NOT NULL CHECK (amount_kobo <> 0),
  memo          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (account <> 'owner_payable' OR community_id IS NOT NULL)
);
CREATE INDEX ledger_txn_idx ON ledger_entries (txn_id);
CREATE INDEX ledger_owner_idx ON ledger_entries (community_id, account);

-- OPEN: refund policy for regular memberships is not decided yet.
CREATE TABLE refunds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id   uuid NOT NULL REFERENCES payments(id),
  amount_kobo  bigint NOT NULL CHECK (amount_kobo > 0),
  reason       text NOT NULL,
  status       payment_status NOT NULL DEFAULT 'pending',
  provider_ref text UNIQUE,
  requested_by uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fraud_signals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          fraud_kind NOT NULL,
  community_id  uuid REFERENCES communities(id),
  user_id       uuid REFERENCES users(id),
  details       jsonb NOT NULL DEFAULT '{}',
  status        flag_status NOT NULL DEFAULT 'open',
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);

-- =============================================================================
-- 4. Job sources and their rules
-- =============================================================================

-- One row per source. The rules are read by matching, autopilot and display,
-- so following each source's terms never depends on memory.
CREATE TABLE sources (
  key                     text PRIMARY KEY,         -- 'greenhouse', 'himalayas'
  name                    text NOT NULL,
  kind                    source_kind NOT NULL,
  homepage_url            text,
  terms_url               text,
  terms_status            terms_status NOT NULL DEFAULT 'needs_review',
  display                 source_display NOT NULL DEFAULT 'disabled',
  enabled                 boolean NOT NULL DEFAULT false,
  requires_credit         boolean NOT NULL DEFAULT true,
  credit_text             text,                     -- 'via Himalayas', 'Jobs by Adzuna'
  requires_link_back      boolean NOT NULL DEFAULT true,
  apply_via_source_link   boolean NOT NULL DEFAULT false, -- Apply must use the source's link
  allow_paywall           boolean NOT NULL DEFAULT false, -- may feed paid matching
  allow_partner_sites     boolean NOT NULL DEFAULT true,  -- all current sites are ours
  allow_autopilot         boolean NOT NULL DEFAULT false,
  allow_signup_gate       boolean NOT NULL DEFAULT false, -- may count toward the free-apply limit
  needs_ai_extraction     boolean NOT NULL DEFAULT true,  -- false for structured feeds
  fetch_interval_minutes  integer NOT NULL DEFAULT 360 CHECK (fetch_interval_minutes >= 5),
  max_fetches_per_day     integer CHECK (max_fetches_per_day > 0),
  publish_delay_hours     integer NOT NULL DEFAULT 0 CHECK (publish_delay_hours >= 0),
  excluded_origins        text[] NOT NULL DEFAULT '{}',  -- e.g. TheirStack: linkedin, indeed
  default_expiry_days     smallint NOT NULL DEFAULT 30 CHECK (default_expiry_days BETWEEN 1 AND 60),
  notes                   text,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Company boards on applicant systems (Greenhouse board token, Lever site name).
CREATE TABLE source_boards (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key            text NOT NULL REFERENCES sources(key),
  board_token           text NOT NULL,
  company_name          text,
  employer_id           uuid,                       -- FK added after employers
  enabled               boolean NOT NULL DEFAULT true,
  discovered_from       text NOT NULL DEFAULT 'seed', -- seed, shared_link, aggregator
  last_fetched_at       timestamptz,
  last_status           text,
  consecutive_failures  smallint NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_key, board_token)
);

-- Source health monitor.
CREATE TABLE source_runs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_key   text NOT NULL REFERENCES sources(key),
  board_id     uuid REFERENCES source_boards(id),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  ok           boolean,
  fetched      integer NOT NULL DEFAULT 0,
  created      integer NOT NULL DEFAULT 0,
  updated      integer NOT NULL DEFAULT 0,
  closed       integer NOT NULL DEFAULT 0,
  error        text
);
CREATE INDEX source_runs_recent_idx ON source_runs (source_key, started_at DESC);

-- =============================================================================
-- 5. Employers
-- =============================================================================

CREATE TABLE employers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  domain               citext UNIQUE,
  website_url          text,
  country              char(2),
  registry_number      text,                         -- e.g. CAC RC number
  registry_source      text,
  verification         verification_status NOT NULL DEFAULT 'unverified',
  verified_at          timestamptz,
  verified_via         text,                         -- domain_email + website + registry
  report_count         integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE source_boards
  ADD CONSTRAINT source_boards_employer_fk FOREIGN KEY (employer_id) REFERENCES employers(id);

CREATE TABLE employer_members (
  user_id                  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employer_id              uuid NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  role                     text NOT NULL DEFAULT 'recruiter',
  domain_email_verified_at timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, employer_id)
);

-- Keys employers give us so autopilot can submit into their Greenhouse or Lever.
CREATE TABLE employer_integrations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id        uuid NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  provider           text NOT NULL,                 -- greenhouse, lever, ashby
  board_token        text NOT NULL,
  api_key_ciphertext bytea NOT NULL,                -- encrypted in the app, never plain
  key_last4          char(4),
  connected_by       uuid REFERENCES users(id),
  connected_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz,
  UNIQUE (provider, board_token)
);

-- =============================================================================
-- 6. Jobs
-- =============================================================================

-- Everything we pull in, exactly as received.
CREATE TABLE raw_postings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key         text NOT NULL REFERENCES sources(key),
  board_id           uuid REFERENCES source_boards(id),
  external_id        text NOT NULL,
  url                text,
  payload            jsonb NOT NULL,
  content_hash       text NOT NULL,
  posted_by_user_id  uuid REFERENCES users(id),     -- community paste
  community_id       uuid REFERENCES communities(id),
  status             raw_status NOT NULL DEFAULT 'new',
  job_id             uuid,                          -- FK added after jobs
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  gone_at            timestamptz,                   -- vanished from the source = closed
  UNIQUE (source_key, external_id)
);
CREATE INDEX raw_postings_status_idx ON raw_postings (status, first_seen_at);
CREATE INDEX raw_postings_hash_idx ON raw_postings (content_hash);

-- One clean job, merged from every copy we found.
CREATE TABLE jobs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id          uuid REFERENCES employers(id),
  company_name         text NOT NULL,
  title                text NOT NULL,
  description          text NOT NULL,
  summary              text,
  location_scope       location_scope NOT NULL DEFAULT 'unspecified',
  allowed_countries    char(2)[] NOT NULL DEFAULT '{}',
  allowed_regions      text[] NOT NULL DEFAULT '{}',   -- 'africa', 'emea'
  tz_min_offset_hours  smallint CHECK (tz_min_offset_hours BETWEEN -12 AND 14),
  tz_max_offset_hours  smallint CHECK (tz_max_offset_hours BETWEEN -12 AND 14),
  is_remote            boolean NOT NULL DEFAULT true,
  employment_type      employment_type,
  seniority            text,
  salary_min_minor     bigint CHECK (salary_min_minor >= 0),
  salary_max_minor     bigint CHECK (salary_max_minor >= 0),
  salary_currency      char(3),
  salary_period        pay_period,
  skills               text[] NOT NULL DEFAULT '{}',
  apply_method         apply_method NOT NULL,
  apply_email          citext,
  apply_url            text,
  primary_source_key   text NOT NULL REFERENCES sources(key),
  trust                trust_level NOT NULL DEFAULT 'unverified',
  status               job_status NOT NULL DEFAULT 'pending_review',
  suitable_for_minors  boolean NOT NULL DEFAULT false,
  community_id         uuid REFERENCES communities(id),
  posted_by_user_id    uuid REFERENCES users(id),
  original_posted_at   timestamptz,                -- from the employer, when known
  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  deadline_at          timestamptz,
  expires_at           timestamptz NOT NULL,
  renewed_count        smallint NOT NULL DEFAULT 0,
  autopilot_cap        smallint NOT NULL DEFAULT 25 CHECK (autopilot_cap >= 0),
  autopilot_sent       smallint NOT NULL DEFAULT 0,
  report_count         integer NOT NULL DEFAULT 0,
  embedding            vector(1024),
  search               tsvector GENERATED ALWAYS AS (
                         setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                         setweight(to_tsvector('english', coalesce(company_name, '')), 'B') ||
                         setweight(to_tsvector('english', coalesce(description, '')), 'C')
                       ) STORED,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jobs_max_60_days CHECK (expires_at <= first_seen_at + interval '60 days'),
  CONSTRAINT jobs_email_needs_address CHECK (apply_method <> 'email' OR apply_email IS NOT NULL),
  CONSTRAINT jobs_link_needs_url CHECK (apply_method <> 'external_link' OR apply_url IS NOT NULL),
  CONSTRAINT jobs_salary_range CHECK (salary_min_minor IS NULL OR salary_max_minor IS NULL OR salary_min_minor <= salary_max_minor),
  CONSTRAINT jobs_restricted_needs_places CHECK (location_scope <> 'restricted' OR cardinality(allowed_countries) + cardinality(allowed_regions) > 0),
  CONSTRAINT jobs_autopilot_cap CHECK (autopilot_sent <= autopilot_cap)
);
CREATE INDEX jobs_live_idx ON jobs (first_seen_at DESC) WHERE status = 'live';
CREATE INDEX jobs_expiry_idx ON jobs (expires_at) WHERE status = 'live';
CREATE INDEX jobs_employer_idx ON jobs (employer_id);
CREATE INDEX jobs_search_idx ON jobs USING gin (search);
CREATE INDEX jobs_skills_idx ON jobs USING gin (skills);
CREATE INDEX jobs_embedding_idx ON jobs USING hnsw (embedding vector_cosine_ops);

ALTER TABLE raw_postings
  ADD CONSTRAINT raw_postings_job_fk FOREIGN KEY (job_id) REFERENCES jobs(id);

-- Every source a job was found on, for credit, link-back and apply links.
CREATE TABLE job_sources (
  job_id          uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  raw_posting_id  uuid NOT NULL UNIQUE REFERENCES raw_postings(id),
  source_key      text NOT NULL REFERENCES sources(key),
  source_url      text,
  apply_url       text,
  is_primary      boolean NOT NULL DEFAULT false,
  added_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, raw_posting_id)
);
CREATE UNIQUE INDEX job_sources_one_primary ON job_sources (job_id) WHERE is_primary;

CREATE TABLE job_link_checks (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id       uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  checked_at   timestamptz NOT NULL DEFAULT now(),
  http_status  smallint,
  alive        boolean NOT NULL,
  note         text
);
CREATE INDEX job_link_checks_job_idx ON job_link_checks (job_id, checked_at DESC);

CREATE TABLE job_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  reporter_id  uuid NOT NULL REFERENCES users(id),
  reason       text NOT NULL,
  details      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, reporter_id)
);

-- Confirmed scams, so the same text is caught in every community at once.
CREATE TABLE scam_signatures (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text_hash      text NOT NULL UNIQUE,
  embedding      vector(1024),
  example_job_id uuid REFERENCES jobs(id),
  confirmed_by   uuid REFERENCES users(id),
  confirmed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scam_signatures_embedding_idx ON scam_signatures USING hnsw (embedding vector_cosine_ops);

-- Human review queue. reason_internal is never shown to the poster.
CREATE TABLE moderation_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type     moderation_subject NOT NULL,
  subject_id       uuid NOT NULL,
  reason_internal  text NOT NULL,
  risk_score       numeric(4,3) CHECK (risk_score BETWEEN 0 AND 1),
  status           moderation_status NOT NULL DEFAULT 'open',
  assigned_to      uuid REFERENCES users(id),
  decided_by       uuid REFERENCES users(id),
  decision_note    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz
);
CREATE INDEX moderation_open_idx ON moderation_items (status, created_at) WHERE status IN ('open', 'in_review', 'escalated');

-- =============================================================================
-- 7. Profiles, rules, trainings and matches
-- =============================================================================

CREATE TABLE profiles (
  user_id             uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  headline            text,
  summary             text,
  years_experience    numeric(4,1) CHECK (years_experience >= 0),
  country             char(2),
  city                text,
  timezone            text,                        -- IANA, e.g. Africa/Lagos
  utc_offset_hours    smallint CHECK (utc_offset_hours BETWEEN -12 AND 14),
  work_authorization  jsonb NOT NULL DEFAULT '{}', -- which countries they can work for
  skills              text[] NOT NULL DEFAULT '{}',
  experience          jsonb NOT NULL DEFAULT '[]',
  education           jsonb NOT NULL DEFAULT '[]',
  languages           text[] NOT NULL DEFAULT '{}',
  links               jsonb NOT NULL DEFAULT '[]',
  cv_file_key         text,                        -- R2, encrypted at rest
  cv_parsed_at        timestamptz,
  confirmed_at        timestamptz,                 -- last time they confirmed it's accurate
  strength            smallint NOT NULL DEFAULT 0 CHECK (strength BETWEEN 0 AND 100),
  embedding           vector(1024),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profiles_embedding_idx ON profiles USING hnsw (embedding vector_cosine_ops);
CREATE INDEX profiles_skills_idx ON profiles USING gin (skills);

CREATE TABLE autopilot_rules (
  user_id               uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled               boolean NOT NULL DEFAULT false,
  consent_id            uuid REFERENCES consents(id),  -- the "send in my name" consent
  min_match             smallint NOT NULL DEFAULT 80 CHECK (min_match BETWEEN 0 AND 100),
  min_pay_monthly_minor bigint CHECK (min_pay_monthly_minor >= 0),
  pay_currency          char(3) NOT NULL DEFAULT 'USD',
  regions               text[] NOT NULL DEFAULT '{worldwide}',
  include_unspecified   boolean NOT NULL DEFAULT false,
  employment_types      employment_type[] NOT NULL DEFAULT '{}',
  daily_cap             smallint NOT NULL DEFAULT 5 CHECK (daily_cap BETWEEN 1 AND 20),
  paused_until          timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT enabled OR consent_id IS NOT NULL)
);

-- Courses on Remote Hustle and School1 that close skill gaps.
CREATE TABLE trainings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id              uuid NOT NULL REFERENCES sites(id),
  title                text NOT NULL,
  url                  text NOT NULL,
  skills               text[] NOT NULL DEFAULT '{}',
  duration_minutes     integer,
  is_free              boolean NOT NULL DEFAULT true,
  suitable_for_minors  boolean NOT NULL DEFAULT false,
  embedding            vector(1024),
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trainings_embedding_idx ON trainings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE matches (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id       uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  score        smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  reasons      jsonb NOT NULL DEFAULT '[]',   -- built from overlapping skills, no AI call
  gaps         jsonb NOT NULL DEFAULT '[]',   -- [{skill, training_id}]
  status       match_status NOT NULL DEFAULT 'new',
  computed_at  timestamptz NOT NULL DEFAULT now(),
  seen_at      timestamptz,
  PRIMARY KEY (user_id, job_id)
);
CREATE INDEX matches_feed_idx ON matches (user_id, score DESC) WHERE status IN ('new', 'seen', 'saved');
CREATE INDEX matches_job_idx ON matches (job_id, score DESC);

-- Apply queue packs, made only when someone opens the job.
CREATE TABLE apply_packs (
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id           uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  tailored_cv_key  text,
  answers          jsonb NOT NULL DEFAULT '[]',
  model_key        text,
  generated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, job_id)
);

-- =============================================================================
-- 8. Applications, sending limits and the email relay
-- =============================================================================

CREATE TABLE sending_domains (
  domain             citext PRIMARY KEY,
  purpose            domain_purpose NOT NULL,
  daily_limit        integer NOT NULL CHECK (daily_limit >= 0),  -- raised as the domain warms up
  warmup_stage       smallint NOT NULL DEFAULT 1,
  paused             boolean NOT NULL DEFAULT false,
  bounce_rate_7d     numeric(5,4),
  complaint_rate_7d  numeric(5,4),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE relay_addresses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  local_part  citext NOT NULL,
  domain      citext NOT NULL REFERENCES sending_domains(domain),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (local_part, domain)
);

CREATE TABLE applications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id              uuid NOT NULL REFERENCES jobs(id),
  site_id             uuid NOT NULL REFERENCES sites(id),
  mode                application_mode NOT NULL,
  channel             application_channel NOT NULL,
  status              application_status NOT NULL DEFAULT 'scheduled',
  match_score         smallint CHECK (match_score BETWEEN 0 AND 100),
  scheduled_for       timestamptz NOT NULL DEFAULT now(),
  cancel_until        timestamptz,                 -- user can cancel until this moment
  sent_at             timestamptz,
  cancelled_at        timestamptz,
  failed_reason       text,
  relay_address_id    uuid REFERENCES relay_addresses(id),
  content             jsonb NOT NULL DEFAULT '{}', -- exact copy of what was sent
  claims_checked      boolean,                     -- every skill mentioned exists in the profile
  last_reply_class    reply_class,
  last_reply_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT applications_once_per_job UNIQUE (user_id, job_id),
  CONSTRAINT applications_autopilot_channels CHECK (mode <> 'autopilot' OR channel IN ('on_platform', 'email_relay', 'ats_api')),
  CONSTRAINT applications_autopilot_cancel_window CHECK (mode <> 'autopilot' OR cancel_until IS NOT NULL),
  CONSTRAINT applications_relay_needs_address CHECK (channel <> 'email_relay' OR relay_address_id IS NOT NULL)
);
CREATE INDEX applications_due_idx ON applications (scheduled_for) WHERE status = 'scheduled';
CREATE INDEX applications_user_idx ON applications (user_id, created_at DESC);
CREATE INDEX applications_job_idx ON applications (job_id);

CREATE TABLE application_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id  uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status     application_status,
  to_status       application_status NOT NULL,
  note            text,
  at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX application_events_app_idx ON application_events (application_id, at);

-- "Did you hear back?" check-ins: our outcome data.
CREATE TABLE outcome_checkins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  ask_on          date NOT NULL,
  asked_at        timestamptz,
  answer          checkin_answer,
  answered_at     timestamptz,
  UNIQUE (application_id, ask_on)
);

-- Daily counters for the four sending limits (job, employer, user, domain).
CREATE TABLE send_counters (
  scope      send_scope NOT NULL,
  scope_key  text NOT NULL,
  day        date NOT NULL,
  count      integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (scope, scope_key, day)
);

CREATE TABLE email_messages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction            email_direction NOT NULL,
  user_id              uuid REFERENCES users(id) ON DELETE SET NULL,
  application_id       uuid REFERENCES applications(id) ON DELETE SET NULL,
  relay_address_id     uuid REFERENCES relay_addresses(id),
  from_addr            citext NOT NULL,
  to_addr              citext NOT NULL,
  subject              text,
  raw_key              text,                       -- full message in R2
  provider_message_id  text UNIQUE,                -- SES message id / Message-ID header
  in_reply_to          text,
  classification       reply_class,
  classified_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_messages_app_idx ON email_messages (application_id, created_at);

CREATE TABLE email_suppressions (
  address     citext PRIMARY KEY,
  reason      text NOT NULL,                       -- bounce, complaint
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 9. AI: Groq free-tier models and the daily token budget
-- Per-minute limits (requests and tokens a minute) are enforced by the BullMQ
-- rate limiter in Redis. Daily budgets are enforced here so they survive restarts.
-- =============================================================================

CREATE TABLE ai_models (
  key                text PRIMARY KEY,             -- 'groq:openai/gpt-oss-120b'
  provider           text NOT NULL,
  model_name         text NOT NULL,
  plan               text NOT NULL DEFAULT 'free',
  rpm                integer NOT NULL CHECK (rpm > 0),
  rpd                integer NOT NULL CHECK (rpd > 0),
  tpm                integer NOT NULL CHECK (tpm > 0),
  tpd                integer NOT NULL CHECK (tpd > 0),
  safety_margin_pct  smallint NOT NULL DEFAULT 10 CHECK (safety_margin_pct BETWEEN 0 AND 50),
  is_preview         boolean NOT NULL DEFAULT false,
  enabled            boolean NOT NULL DEFAULT true,
  fallback_key       text REFERENCES ai_models(key),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (fallback_key IS DISTINCT FROM key)
);

-- How each day's tokens are shared between tasks.
CREATE TABLE ai_task_budgets (
  task                 ai_task PRIMARY KEY,
  model_key            text NOT NULL REFERENCES ai_models(key),
  daily_tokens         integer NOT NULL CHECK (daily_tokens > 0),
  est_tokens_per_call  integer NOT NULL CHECK (est_tokens_per_call > 0),
  priority             smallint NOT NULL,          -- lower number runs first when tight
  user_waiting         boolean NOT NULL,           -- someone is looking at a spinner
  notes                text,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_usage_daily (
  day                 date NOT NULL,
  model_key           text NOT NULL REFERENCES ai_models(key),
  task                ai_task NOT NULL,
  requests            integer NOT NULL DEFAULT 0,
  reserved_tokens     integer NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0),
  used_input_tokens   integer NOT NULL DEFAULT 0,
  used_output_tokens  integer NOT NULL DEFAULT 0,
  rate_limited        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, model_key, task)
);

CREATE TABLE ai_calls (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day              date NOT NULL,
  task             ai_task NOT NULL,
  model_key        text NOT NULL REFERENCES ai_models(key),
  subject_type     text,
  subject_id       uuid,
  reserved_tokens  integer NOT NULL,
  input_tokens     integer,
  output_tokens    integer,
  latency_ms       integer,
  status           ai_call_status NOT NULL,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_calls_day_idx ON ai_calls (day, task);

-- Reserve tokens before a call. Returns the model to use, or NULL when today's
-- budget is spent (the job then waits for tomorrow's reset).
CREATE FUNCTION ai_reserve(
  p_task   ai_task,
  p_tokens integer DEFAULT NULL,
  p_day    date DEFAULT (now() AT TIME ZONE 'UTC')::date
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  b          ai_task_budgets%ROWTYPE;
  m          ai_models%ROWTYPE;
  v_tokens   integer;
  v_model    text;
  v_task_use bigint;
  v_mod_use  bigint;
  v_mod_reqs bigint;
  v_hops     integer := 0;
BEGIN
  SELECT * INTO b FROM ai_task_budgets WHERE task = p_task;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No budget is set for AI task %', p_task;
  END IF;
  v_tokens := coalesce(p_tokens, b.est_tokens_per_call);
  IF v_tokens <= 0 THEN
    RAISE EXCEPTION 'Token estimate must be positive';
  END IF;

  -- The task's own share of the day.
  SELECT coalesce(sum(reserved_tokens + used_input_tokens + used_output_tokens), 0)
    INTO v_task_use
    FROM ai_usage_daily WHERE day = p_day AND task = p_task;
  IF v_task_use + v_tokens > b.daily_tokens THEN
    RETURN NULL;
  END IF;

  -- The model's daily limit, falling back to another model if this one is full.
  v_model := b.model_key;
  WHILE v_model IS NOT NULL AND v_hops < 3 LOOP
    SELECT * INTO m FROM ai_models WHERE key = v_model FOR UPDATE;
    EXIT WHEN NOT FOUND;
    IF m.enabled THEN
      SELECT coalesce(sum(reserved_tokens + used_input_tokens + used_output_tokens), 0),
             coalesce(sum(requests), 0)
        INTO v_mod_use, v_mod_reqs
        FROM ai_usage_daily WHERE day = p_day AND model_key = v_model;
      IF v_mod_use + v_tokens <= floor(m.tpd * (100 - m.safety_margin_pct) / 100.0)
         AND v_mod_reqs + 1 <= floor(m.rpd * (100 - m.safety_margin_pct) / 100.0) THEN
        INSERT INTO ai_usage_daily (day, model_key, task, requests, reserved_tokens)
        VALUES (p_day, v_model, p_task, 1, v_tokens)
        ON CONFLICT (day, model_key, task) DO UPDATE
          SET requests        = ai_usage_daily.requests + 1,
              reserved_tokens = ai_usage_daily.reserved_tokens + EXCLUDED.reserved_tokens;
        RETURN v_model;
      END IF;
    END IF;
    v_model := m.fallback_key;
    v_hops := v_hops + 1;
  END LOOP;
  RETURN NULL;
END $$;

-- After the call: swap the reservation for the real token counts.
-- Pass 0 and 0 for a failed call to give the tokens back.
CREATE FUNCTION ai_settle(
  p_day       date,
  p_model     text,
  p_task      ai_task,
  p_reserved  integer,
  p_input     integer,
  p_output    integer,
  p_rate_limited boolean DEFAULT false
) RETURNS void LANGUAGE sql AS $$
  UPDATE ai_usage_daily
     SET reserved_tokens    = greatest(reserved_tokens - p_reserved, 0),
         used_input_tokens  = used_input_tokens + greatest(p_input, 0),
         used_output_tokens = used_output_tokens + greatest(p_output, 0),
         rate_limited       = rate_limited + CASE WHEN p_rate_limited THEN 1 ELSE 0 END
   WHERE day = p_day AND model_key = p_model AND task = p_task;
$$;

-- Training data captured from day one, only with consent and anonymised.
CREATE TABLE training_examples (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task              ai_task NOT NULL,
  ai_call_id        uuid REFERENCES ai_calls(id) ON DELETE SET NULL,
  input_key         text NOT NULL,                -- anonymised input in R2
  model_output      jsonb,
  corrected_output  jsonb,                        -- moderator decision, user correction, draft edit
  label             text,
  corrected_by      text,                         -- user, moderator, outcome
  consent_ok        boolean NOT NULL CHECK (consent_ok),
  anonymised        boolean NOT NULL CHECK (anonymised),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 10. Notifications, support, partner webhooks, compliance
-- =============================================================================

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id     uuid NOT NULL REFERENCES sites(id),
  type        text NOT NULL,                 -- interview_invite, daily_summary, trial_ending
  title       text NOT NULL,
  body        text,
  data        jsonb NOT NULL DEFAULT '{}',
  channel     notify_channel NOT NULL DEFAULT 'in_app',
  sent_at     timestamptz,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE faq_articles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid REFERENCES sites(id),     -- NULL = every site
  question    text NOT NULL,
  answer      text NOT NULL,
  embedding   vector(1024),
  published   boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX faq_embedding_idx ON faq_articles USING hnsw (embedding vector_cosine_ops);

CREATE TABLE support_tickets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  site_id       uuid NOT NULL REFERENCES sites(id),
  subject       text NOT NULL,
  category      text,                        -- payment, scam_report, data_request, other
  status        ticket_status NOT NULL DEFAULT 'open',
  assigned_to   uuid REFERENCES users(id),
  escalated_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);

CREATE TABLE support_messages (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id  uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author     ticket_author NOT NULL,
  body       text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhook_endpoints (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      uuid NOT NULL REFERENCES sites(id),
  url          text NOT NULL,
  secret_hash  text NOT NULL,
  events       text[] NOT NULL,              -- application.status_changed, match.created
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  endpoint_id      uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event            text NOT NULL,
  payload          jsonb NOT NULL,
  status           delivery_status NOT NULL DEFAULT 'pending',
  attempts         smallint NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  delivered_at     timestamptz
);
CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';

CREATE TABLE audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_kind    text NOT NULL,               -- user, staff, system, partner
  site_id       uuid REFERENCES sites(id),
  action        text NOT NULL,
  subject_type  text,
  subject_id    uuid,
  ip_hash       text,
  meta          jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_subject_idx ON audit_log (subject_type, subject_id, at DESC);

-- Requests to see, correct or delete data, or to have a human review a decision.
CREATE TABLE data_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  type          data_request_type NOT NULL,
  status        data_request_status NOT NULL DEFAULT 'received',
  details       text,
  due_at        timestamptz NOT NULL DEFAULT now() + interval '30 days', -- confirm with your DPO
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 11. Rules enforced by the database
-- =============================================================================

-- A member stays credited to the community that brought them. The only time the
-- credit can move is when that community has been banned and the member switches.
CREATE FUNCTION keep_referral_credit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.referred_by_community_id IS NOT NULL
     AND NEW.referred_by_community_id IS DISTINCT FROM OLD.referred_by_community_id
     AND (SELECT status FROM communities WHERE id = OLD.referred_by_community_id) <> 'banned' THEN
    RAISE EXCEPTION 'A member stays credited to the community that brought them';
  END IF;
  IF NEW.referred_by_community_id IS DISTINCT FROM OLD.referred_by_community_id THEN
    NEW.referred_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_keep_referral BEFORE UPDATE OF referred_by_community_id ON users
  FOR EACH ROW EXECUTE FUNCTION keep_referral_credit();

-- When a community is banned: its unused codes stop working and its payouts freeze.
-- Members keep access until their period ends (handled by the expiry worker).
CREATE FUNCTION on_community_banned() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'banned' AND OLD.status IS DISTINCT FROM 'banned' THEN
    UPDATE access_codes
       SET status = 'void', voided_at = now(), void_reason = 'community banned'
     WHERE community_id = NEW.id AND status = 'unused';
    UPDATE payouts
       SET status = 'frozen', frozen_reason = 'community banned'
     WHERE community_id = NEW.id AND status IN ('held', 'ready');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER communities_on_banned AFTER UPDATE OF status ON communities
  FOR EACH ROW EXECUTE FUNCTION on_community_banned();

-- Every application status change is logged.
CREATE FUNCTION log_application_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO application_events (application_id, from_status, to_status) VALUES (NEW.id, NULL, NEW.status);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO application_events (application_id, from_status, to_status) VALUES (NEW.id, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER applications_log_status AFTER INSERT OR UPDATE OF status ON applications
  FOR EACH ROW EXECUTE FUNCTION log_application_status();

-- Count one send against a limit. Returns false when the limit is already reached.
CREATE FUNCTION try_count_send(
  p_scope send_scope,
  p_key   text,
  p_limit integer,
  p_day   date DEFAULT (now() AT TIME ZONE 'UTC')::date
) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO send_counters (scope, scope_key, day, count)
  VALUES (p_scope, p_key, p_day, 0)
  ON CONFLICT DO NOTHING;
  UPDATE send_counters
     SET count = count + 1
   WHERE scope = p_scope AND scope_key = p_key AND day = p_day AND count < p_limit;
  RETURN FOUND;
END $$;

-- updated_at on every table that has the column.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
                   t || '_set_updated_at', t);
  END LOOP;
END $$;

-- Site isolation: a partner request only sees its own site's rows.
-- The API connects as a non-owner role; table owners bypass these policies.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['site_accounts', 'applications', 'notifications',
                           'webhook_endpoints', 'apply_meter', 'support_tickets']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY site_isolation ON %I
                      USING (app_is_engine() OR site_id = app_site_id())
                      WITH CHECK (app_is_engine() OR site_id = app_site_id())', t);
  END LOOP;
END $$;

-- =============================================================================
-- 12. Views
-- =============================================================================

CREATE VIEW current_consents AS
SELECT DISTINCT ON (user_id, purpose)
       user_id, purpose, granted, policy_version, created_at
  FROM consents
 ORDER BY user_id, purpose, created_at DESC;

-- Owner dashboard funnel: totals only.
CREATE VIEW community_funnel AS
SELECT c.id AS community_id,
       (SELECT count(*) FROM community_invites i WHERE i.community_id = c.id)              AS invited,
       count(m.id)                                                                           AS joined,
       count(m.id) FILTER (WHERE m.status = 'pending_approval')                              AS awaiting_approval,
       count(m.id) FILTER (WHERE m.status = 'pending_payment')                               AS not_paid_yet,
       count(m.id) FILTER (WHERE m.status = 'trialing')                                      AS on_trial,
       count(m.id) FILTER (WHERE m.status = 'active')                                        AS paid,
       count(m.id) FILTER (WHERE m.status IN ('active', 'trialing') AND m.onboarding_step IN ('joined', 'paid')) AS stuck_no_cv,
       count(m.id) FILTER (WHERE m.status IN ('active', 'trialing') AND m.onboarding_step = 'cv_uploaded')       AS stuck_no_rules,
       count(m.id) FILTER (WHERE m.onboarding_step = 'complete')                             AS fully_set_up
  FROM communities c
  LEFT JOIN memberships m ON m.community_id = c.id
 GROUP BY c.id;

-- What an owner may see about individual members: first name and progress only.
-- No email, phone, CV or applications.
CREATE VIEW owner_member_list AS
SELECT m.id AS membership_id,
       m.community_id,
       nullif(split_part(coalesce(u.full_name, ''), ' ', 1), '') AS first_name,
       m.status,
       m.onboarding_step,
       m.created_at AS joined_at,
       m.trial_ends_at,
       m.current_period_end,
       m.last_nudged_at
  FROM memberships m
  JOIN users u ON u.id = m.user_id;

-- Money each community has earned but not yet been paid.
CREATE VIEW owner_balances AS
SELECT community_id, sum(amount_kobo) AS balance_kobo
  FROM ledger_entries
 WHERE account = 'owner_payable'
 GROUP BY community_id;

CREATE VIEW ledger_unbalanced AS
SELECT txn_id, sum(amount_kobo) AS off_by_kobo
  FROM ledger_entries
 GROUP BY txn_id
HAVING sum(amount_kobo) <> 0;

-- Today's AI budget by task.
CREATE VIEW ai_budget_today AS
WITH d AS (SELECT (now() AT TIME ZONE 'UTC')::date AS day)
SELECT b.task,
       b.model_key,
       b.daily_tokens,
       coalesce(sum(u.reserved_tokens + u.used_input_tokens + u.used_output_tokens), 0)                   AS spent_tokens,
       b.daily_tokens - coalesce(sum(u.reserved_tokens + u.used_input_tokens + u.used_output_tokens), 0)  AS remaining_tokens,
       coalesce(sum(u.requests), 0)                                                                         AS requests,
       (b.daily_tokens - coalesce(sum(u.reserved_tokens + u.used_input_tokens + u.used_output_tokens), 0))
         / b.est_tokens_per_call                                                                            AS calls_left_estimate
  FROM ai_task_budgets b
 CROSS JOIN d
  LEFT JOIN ai_usage_daily u ON u.task = b.task AND u.day = d.day
 GROUP BY b.task, b.model_key, b.daily_tokens, b.est_tokens_per_call;

-- Checks the plan: task budgets on a model must fit inside its daily limit.
CREATE VIEW ai_budget_plan_check AS
SELECT m.key AS model_key,
       floor(m.tpd * (100 - m.safety_margin_pct) / 100.0)::integer                                AS usable_tokens_per_day,
       coalesce(sum(b.daily_tokens), 0)::integer                                                  AS allocated,
       floor(m.tpd * (100 - m.safety_margin_pct) / 100.0)::integer - coalesce(sum(b.daily_tokens), 0)::integer AS headroom
  FROM ai_models m
  LEFT JOIN ai_task_budgets b ON b.model_key = m.key
 GROUP BY m.key, m.tpd, m.safety_margin_pct;

-- Public "Newest job finds": live jobs from sources allowed on the free page.
CREATE VIEW job_finds_public AS
SELECT j.id, j.title, j.company_name, j.location_scope, j.employment_type,
       j.salary_min_minor, j.salary_max_minor, j.salary_currency, j.salary_period,
       j.trust, j.first_seen_at, j.expires_at,
       s.key AS source_key, s.credit_text, js.source_url, coalesce(js.apply_url, j.apply_url) AS apply_url
  FROM jobs j
  JOIN job_sources js ON js.job_id = j.id AND js.is_primary
  JOIN sources s ON s.key = js.source_key
 WHERE j.status = 'live'
   AND s.enabled
   AND s.display IN ('full', 'job_finds_only')
   AND j.first_seen_at <= now() - make_interval(hours => s.publish_delay_hours);

-- Jobs that may go into paid matching and autopilot, with the source's rules applied.
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
