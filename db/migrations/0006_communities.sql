-- =============================================================================
-- 0006: communities, memberships and money
-- =============================================================================

-- Members who find a community through search, not an invite.
ALTER TYPE membership_source ADD VALUE IF NOT EXISTS 'search';

-- Ledger signs follow double entry: debits positive, credits negative. What we owe an owner is a
-- credit on owner_payable, so owners see it with the sign flipped.
CREATE OR REPLACE VIEW owner_balances AS
SELECT community_id, -sum(amount_kobo) AS balance_kobo
  FROM ledger_entries
 WHERE account = 'owner_payable'
 GROUP BY community_id;

ALTER TABLE payments
  ADD COLUMN checkout_url text,
  ADD COLUMN expires_at   timestamptz;

-- Jobs pasted by community owners are checked by the owner before they go live.
ALTER TABLE jobs ADD COLUMN owner_confirmed_at timestamptz;

-- Reminders sent before a trial or period ends, so each goes once.
ALTER TABLE memberships ADD COLUMN reminded_for timestamptz;
CREATE INDEX payments_pending_idx ON payments (created_at) WHERE status = 'pending';
CREATE INDEX access_codes_redeemed_by_idx ON access_codes (redeemed_by) WHERE redeemed_by IS NOT NULL;
