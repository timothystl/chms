-- Commercial Property books (v3 design): tenant receivables and security deposits as the property
-- manager's monthly reports show them, and the monthly reconciliation of the property's own bank
-- account. Finance owns these tables; the property's income, reserves and loan stay in Connect.
-- Money is stored in whole cents. Months are 'YYYY-MM'.

CREATE TABLE IF NOT EXISTS finance_property_receivables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_key TEXT NOT NULL DEFAULT 'ivanhoe',
  report_month TEXT NOT NULL CHECK (report_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  tenant TEXT NOT NULL CHECK (length(trim(tenant)) > 0),
  unit TEXT NOT NULL DEFAULT '',
  current_cents INTEGER NOT NULL DEFAULT 0,
  days_31_60_cents INTEGER NOT NULL DEFAULT 0,
  days_61_90_cents INTEGER NOT NULL DEFAULT 0,
  over_90_cents INTEGER NOT NULL DEFAULT 0,
  deposit_held_cents INTEGER NOT NULL DEFAULT 0 CHECK (deposit_held_cents >= 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS finance_property_receivables_month ON finance_property_receivables (property_key, report_month, id);

CREATE TABLE IF NOT EXISTS finance_property_bank_recs (
  property_key TEXT NOT NULL DEFAULT 'ivanhoe',
  statement_month TEXT NOT NULL CHECK (statement_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  statement_balance_cents INTEGER NOT NULL,
  deposits_in_transit_cents INTEGER NOT NULL DEFAULT 0 CHECK (deposits_in_transit_cents >= 0),
  outstanding_checks_cents INTEGER NOT NULL DEFAULT 0 CHECK (outstanding_checks_cents >= 0),
  book_balance_cents INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (property_key, statement_month)
);
