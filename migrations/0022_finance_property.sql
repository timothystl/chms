-- Commercial property (3277 Ivanhoe) financials for the Finance tab's "Commercial Property"
-- section. Keyed by property_key (default 'ivanhoe') so a second property could be added later
-- without a schema change. Static valuation/loan/equity figures live in chms_config as a JSON
-- blob under key 'finance_property_<property_key>_meta' — see src/api-finance.js.
CREATE TABLE IF NOT EXISTS finance_property_monthly (
  property_key                     TEXT    NOT NULL DEFAULT 'ivanhoe',
  period                           TEXT    NOT NULL,
  occupancy_pct                    REAL,
  total_revenue_cents              INTEGER,
  total_expenses_cents             INTEGER,
  net_income_cents                 INTEGER,
  net_operating_income_cents       INTEGER,
  available_for_distribution_cents INTEGER,
  reserve_balance_cents            INTEGER,
  source_report                    TEXT    NOT NULL DEFAULT '',
  updated_at                       TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (property_key, period)
);

CREATE TABLE IF NOT EXISTS finance_property_distributions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  property_key  TEXT    NOT NULL DEFAULT 'ivanhoe',
  period        TEXT    NOT NULL,
  amount_cents  INTEGER NOT NULL DEFAULT 0,
  UNIQUE(property_key, period)
);
CREATE INDEX IF NOT EXISTS idx_finance_property_dist_key ON finance_property_distributions(property_key);
