-- Church Budget Planning: forward multi-year what-if planning for operating categories
-- (Property Expenses, Salaries & Benefits, Utilities, Insurance, or any freeform category),
-- kept separate from 3277 Ivanhoe's own (read-only, no-commit) forecast — see src/api-finance.js.
-- A plan row can be committed into finance_church_entries (source='plan_committed') as a
-- placeholder budget for a future year; resolveChurchYearPrecedence() ranks it lowest priority
-- so real synced/imported data for that year always wins once it exists.
CREATE TABLE IF NOT EXISTS finance_budget_plan (
  category             TEXT    NOT NULL,
  classification        TEXT    NOT NULL DEFAULT 'Expenses',
  fiscal_year           INTEGER NOT NULL,
  planned_amount_cents  INTEGER NOT NULL DEFAULT 0,
  basis                 TEXT    NOT NULL DEFAULT 'manual',
  growth_pct            REAL,
  base_amount_cents     INTEGER,
  notes                 TEXT    NOT NULL DEFAULT '',
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (category, fiscal_year)
);
CREATE INDEX IF NOT EXISTS idx_finance_budget_plan_year ON finance_budget_plan(fiscal_year);
