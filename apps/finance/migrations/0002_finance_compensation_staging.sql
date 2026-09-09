-- Isolated Finance staging compensation model. Contains synthetic role-level planning data only.
CREATE TABLE finance_compensation_plan (
  fiscal_year INTEGER NOT NULL,
  role_label TEXT NOT NULL,
  salary_cents INTEGER NOT NULL DEFAULT 0,
  benefits_cents INTEGER NOT NULL DEFAULT 0,
  adjustment_pct REAL NOT NULL DEFAULT 0,
  basis TEXT NOT NULL DEFAULT 'manual',
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (fiscal_year, role_label)
);
CREATE INDEX idx_finance_compensation_year ON finance_compensation_plan(fiscal_year);
