-- Commercial property (3277 Ivanhoe) reserve schedules, capital improvements ledger, and
-- repairs/maintenance log — closes the gap flagged after the initial Commercial Property
-- section shipped ("doesn't have the places for reserves for property taxes, and capital
-- expenses"). Keyed by property_key (default 'ivanhoe') to match finance_property_monthly.
-- See src/api-finance.js for the read/write routes and src/db.js for the seed data.

-- Generic named reserve schedule — one row per report month per reserve bucket (e.g.
-- 'property_tax', 'capital_paint_asphalt_concrete'). tax_year is only meaningful for the
-- property_tax bucket; left NULL for others.
CREATE TABLE IF NOT EXISTS finance_property_reserves (
  property_key           TEXT    NOT NULL DEFAULT 'ivanhoe',
  reserve_key            TEXT    NOT NULL,
  report_month           TEXT    NOT NULL,
  tax_year               INTEGER,
  target_estimate_cents  INTEGER,
  reserve_before_cents   INTEGER,
  contribution_cents     INTEGER,
  reserve_after_cents    INTEGER,
  note                   TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (property_key, reserve_key, report_month)
);

-- Disbursements paid out of a reserve bucket (e.g. the annual property tax bill, once paid).
CREATE TABLE IF NOT EXISTS finance_property_reserve_disbursements (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  property_key           TEXT    NOT NULL DEFAULT 'ivanhoe',
  reserve_key            TEXT    NOT NULL,
  period_key             TEXT    NOT NULL,
  amount_cents           INTEGER,
  paid_via_report_month  TEXT    NOT NULL DEFAULT '',
  note                   TEXT    NOT NULL DEFAULT '',
  UNIQUE(property_key, reserve_key, period_key)
);

-- Capital improvements ledger (line items). project_* fields tag a row into one of the
-- hand-curated project rollups shown alongside the ledger (see the capital_improvements.
-- projects_summary block in the meta JSON, chms_config key finance_property_ivanhoe_meta) —
-- not every project has ledger rows (e.g. an expensed-not-capitalized project shows $0 here).
CREATE TABLE IF NOT EXISTS finance_property_capital_ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  property_key  TEXT    NOT NULL DEFAULT 'ivanhoe',
  entry_date    TEXT    NOT NULL DEFAULT '',
  amount_cents  INTEGER NOT NULL DEFAULT 0,
  payee         TEXT    NOT NULL DEFAULT '',
  description   TEXT    NOT NULL DEFAULT '',
  check_ref     TEXT    NOT NULL DEFAULT '',
  project       TEXT    NOT NULL DEFAULT '',
  sort_order    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_finance_property_capital_ledger_key ON finance_property_capital_ledger(property_key);

-- Repairs & maintenance log (non-capitalized, expensed items) — read-only historical reference
-- plus a place to log future items.
CREATE TABLE IF NOT EXISTS finance_property_repairs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  property_key  TEXT    NOT NULL DEFAULT 'ivanhoe',
  entry_date    TEXT    NOT NULL DEFAULT '',
  category      TEXT    NOT NULL DEFAULT '',
  description   TEXT    NOT NULL DEFAULT '',
  amount_cents  INTEGER,
  payee         TEXT    NOT NULL DEFAULT '',
  capitalized   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_finance_property_repairs_key ON finance_property_repairs(property_key);
