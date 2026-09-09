-- Synthetic staging data only. Never use this file with a production database.
INSERT INTO finance_property_valuation_assumptions
  (property_key, utility_reimbursement_cents, vacancy_rate_pct, management_fee_pct, cap_rate, source, updated_at)
VALUES
  ('synthetic-property', 600000, 0.05, 0.06, 0.08, 'synthetic_fixture', '2026-01-01T00:00:00Z');
INSERT INTO finance_property_rent_roll
  (property_key, unit_key, tenant_label, square_feet, annual_rent_cents, source, updated_at)
VALUES
  ('synthetic-property', 'unit-a', 'Synthetic Unit A', 1200, 2400000, 'synthetic_fixture', '2026-01-01T00:00:00Z'),
  ('synthetic-property', 'unit-b', 'Synthetic Unit B', 1800, 3600000, 'synthetic_fixture', '2026-01-01T00:00:00Z');
INSERT INTO finance_property_operating_costs
  (property_key, cost_key, cost_label, annual_cost_cents, source, updated_at)
VALUES
  ('synthetic-property', 'utilities', 'Utilities', 1200000, 'synthetic_fixture', '2026-01-01T00:00:00Z'),
  ('synthetic-property', 'maintenance_repairs', 'Maintenance and repairs', 600000, 'synthetic_fixture', '2026-01-01T00:00:00Z'),
  ('synthetic-property', 'taxes', 'Property taxes', 800000, 'synthetic_fixture', '2026-01-01T00:00:00Z'),
  ('synthetic-property', 'insurance', 'Insurance', 400000, 'synthetic_fixture', '2026-01-01T00:00:00Z');
