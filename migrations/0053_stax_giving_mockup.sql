-- MOCKUP scope (see docs/STAX_GIVING_MOCKUP.md): a parallel, optional Stax-based giving path
-- alongside the existing Tithe.ly integration. Gifts still land in the EXISTING giving_entries
-- ledger -- giving_entries already carried person_id (nullable), fund_id, source, processor,
-- external_txn_id, fee_cents, and reconcile_status from the earlier deposit-reconciliation work
-- (see migration 0031), which turned out to be exactly the shape a second processor needs. Only
-- what genuinely didn't exist yet is added here: a GL code per fund, a Stax customer <-> person
-- map (for recurring gifts and returning donors), recurring schedules themselves, and a small
-- staging table holding the raw payer details of a gift that couldn't be auto-matched to a
-- person, so a staff screen has something to search/link against.
ALTER TABLE funds ADD COLUMN gl_code TEXT NOT NULL DEFAULT '';

-- Idempotency for processor webhooks in general (Stax mockup today, any future processor the
-- same way): a webhook redelivery of the same event must never create a second ledger row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_giving_external_txn
  ON giving_entries(processor, external_txn_id) WHERE external_txn_id != '';

-- One Stax customer id per person (and vice versa) -- needed to recognize a returning donor's
-- card/ACH on file and to attach a new recurring schedule to the right person going forward.
CREATE TABLE IF NOT EXISTS giving_stax_customers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id        INTEGER NOT NULL REFERENCES people(id),
  stax_customer_id TEXT    NOT NULL,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stax_customers_person ON giving_stax_customers(person_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stax_customers_stax_id ON giving_stax_customers(stax_customer_id);

-- Recurring gift plans created through the Stax mockup form. There is no existing concept of a
-- payment SCHEDULE in this schema -- pledges (migration 0038) record an annual dollar commitment,
-- not a standing charge instruction -- so this is a genuinely new table, not a reuse of pledges.
-- person_id is nullable for the same reason giving_entries.person_id is: a recurring giver may
-- start a schedule before staff link them to a person record.
CREATE TABLE IF NOT EXISTS giving_stax_recurring_schedules (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id        INTEGER REFERENCES people(id),
  fund_id          INTEGER NOT NULL REFERENCES funds(id),
  amount_cents     INTEGER NOT NULL,
  interval         TEXT    NOT NULL DEFAULT 'monthly',
  stax_customer_id TEXT    NOT NULL DEFAULT '',
  stax_schedule_id TEXT    NOT NULL DEFAULT '',
  status           TEXT    NOT NULL DEFAULT 'active',
  payer_name       TEXT    NOT NULL DEFAULT '',
  payer_email      TEXT    NOT NULL DEFAULT '',
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stax_recurring_person ON giving_stax_recurring_schedules(person_id);
CREATE INDEX IF NOT EXISTS idx_stax_recurring_status ON giving_stax_recurring_schedules(status);

-- A Stax gift the webhook could not match to an existing active person by email or phone lands
-- in giving_entries with person_id NULL (same "landed but unattributed" shape the rest of the
-- app already tolerates), and its raw payer details are staged here for the review screen. One
-- row per unmatched giving_entries row.
CREATE TABLE IF NOT EXISTS giving_stax_unmatched (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  giving_entry_id  INTEGER NOT NULL REFERENCES giving_entries(id),
  payer_name       TEXT    NOT NULL DEFAULT '',
  payer_email      TEXT    NOT NULL DEFAULT '',
  payer_phone      TEXT    NOT NULL DEFAULT '',
  card_brand       TEXT    NOT NULL DEFAULT '',
  card_last4       TEXT    NOT NULL DEFAULT '',
  stax_customer_id TEXT    NOT NULL DEFAULT '',
  status           TEXT    NOT NULL DEFAULT 'open',
  linked_person_id INTEGER,
  linked_by        TEXT    NOT NULL DEFAULT '',
  linked_at        TEXT    NOT NULL DEFAULT '',
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stax_unmatched_entry ON giving_stax_unmatched(giving_entry_id);
CREATE INDEX IF NOT EXISTS idx_stax_unmatched_status ON giving_stax_unmatched(status);
