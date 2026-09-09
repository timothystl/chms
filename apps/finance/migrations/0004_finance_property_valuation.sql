-- Finance-owned property valuation inputs. No production values are copied by this migration.
CREATE TABLE finance_property_valuation_assumptions (
  property_key TEXT PRIMARY KEY,
  utility_reimbursement_cents INTEGER NOT NULL DEFAULT 0 CHECK (utility_reimbursement_cents >= 0),
  vacancy_rate_pct REAL NOT NULL DEFAULT 0 CHECK (vacancy_rate_pct >= 0 AND vacancy_rate_pct <= 1),
  management_fee_pct REAL NOT NULL DEFAULT 0 CHECK (management_fee_pct >= 0 AND management_fee_pct <= 1),
  cap_rate REAL NOT NULL CHECK (cap_rate > 0 AND cap_rate <= 1),
  source TEXT NOT NULL DEFAULT 'manual',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE finance_property_rent_roll (
  property_key TEXT NOT NULL,
  unit_key TEXT NOT NULL,
  tenant_label TEXT NOT NULL,
  square_feet INTEGER NOT NULL CHECK (square_feet >= 0),
  annual_rent_cents INTEGER NOT NULL CHECK (annual_rent_cents >= 0),
  source TEXT NOT NULL DEFAULT 'manual',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (property_key, unit_key)
);
CREATE TABLE finance_property_operating_costs (
  property_key TEXT NOT NULL,
  cost_key TEXT NOT NULL,
  cost_label TEXT NOT NULL,
  annual_cost_cents INTEGER NOT NULL CHECK (annual_cost_cents >= 0),
  source TEXT NOT NULL DEFAULT 'manual',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (property_key, cost_key)
);
