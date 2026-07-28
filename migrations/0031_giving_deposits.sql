-- Native giving system, Phase 1: deposit-centered reconciliation (GIV-DEP).
-- A gift isn't "complete" until its bank deposit is reconciled. A deposit groups the gifts
-- that make up one bank deposit (check-scanner run, cash deposit, or an online payout), and
-- reconciling it against the bank stamps its gifts complete.
--
-- Processor-agnostic by design: online gifts store a generic processor + external_txn_id +
-- fee, so Tithe.ly is just the first adapter and a future cheaper processor slots in with no
-- schema change. net-to-bank is always derived as amount - fee_cents.
CREATE TABLE IF NOT EXISTS giving_deposits (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  deposit_date  TEXT    NOT NULL DEFAULT '',   -- the bank deposit date (YYYY-MM-DD)
  source        TEXT    NOT NULL DEFAULT '',   -- check | cash | online | mixed
  processor     TEXT    NOT NULL DEFAULT '',   -- online only: tithely | <future> | ''
  external_ref  TEXT    NOT NULL DEFAULT '',   -- processor payout id / bank reference
  bank_cents    INTEGER,                       -- actual amount seen in the bank (null until reconciled)
  status        TEXT    NOT NULL DEFAULT 'open',-- open | reconciled
  reconciled_at TEXT,
  reconciled_by TEXT    NOT NULL DEFAULT '',
  notes         TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deposits_status ON giving_deposits(status, deposit_date);

-- Per-gift reconciliation + fee + source fields on the existing giving records.
ALTER TABLE giving_entries ADD COLUMN deposit_id       INTEGER;
ALTER TABLE giving_entries ADD COLUMN fee_cents        INTEGER NOT NULL DEFAULT 0;   -- processor fee; net = amount - fee_cents
ALTER TABLE giving_entries ADD COLUMN source           TEXT    NOT NULL DEFAULT '';  -- cash | check | online | breeze | manual
ALTER TABLE giving_entries ADD COLUMN processor        TEXT    NOT NULL DEFAULT '';  -- online only: tithely | <future>
ALTER TABLE giving_entries ADD COLUMN external_txn_id  TEXT    NOT NULL DEFAULT '';  -- processor transaction id (dedup + reconcile)
ALTER TABLE giving_entries ADD COLUMN reconcile_status TEXT    NOT NULL DEFAULT 'recorded'; -- recorded | deposited | reconciled
CREATE INDEX IF NOT EXISTS idx_entries_deposit ON giving_entries(deposit_id);
