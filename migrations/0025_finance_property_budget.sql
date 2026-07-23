-- Monthly BUDGET figures for a commercial property (e.g. 3277 Ivanhoe), imported from the
-- property manager's own "Budget Detail" export (AHRA). Parallels finance_property_monthly
-- (which holds ACTUALS) but kept as its own table since the two come from different exports on
-- different schedules and a budget row shouldn't silently overwrite an actual row or vice versa.
CREATE TABLE IF NOT EXISTS finance_property_budget_monthly (
  property_key     TEXT    NOT NULL DEFAULT 'ivanhoe',
  period            TEXT    NOT NULL,
  revenue_cents     INTEGER NOT NULL DEFAULT 0,
  expenses_cents    INTEGER NOT NULL DEFAULT 0,
  net_income_cents  INTEGER NOT NULL DEFAULT 0,
  source            TEXT    NOT NULL DEFAULT 'ahra_import',
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (property_key, period)
);
