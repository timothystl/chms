-- Isolated Finance staging benefit components. Contains role-level amounts only.
CREATE TABLE finance_compensation_benefit_components (
  fiscal_year INTEGER NOT NULL,
  role_label TEXT NOT NULL,
  component_key TEXT NOT NULL,
  component_label TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  source_kind TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (fiscal_year, role_label, component_key)
);
CREATE INDEX idx_finance_compensation_benefit_year
  ON finance_compensation_benefit_components(fiscal_year, source_kind);
