-- Synthetic staging data only. Never use this file with a production database.
-- The exact base, growth, and planned amounts make the read-only outlook reproducible.
INSERT INTO finance_budget_plan
  (category, classification, fiscal_year, base_amount_cents, growth_pct, planned_amount_cents, basis, notes, updated_at)
VALUES
  ('Synthetic Contributions', 'Income', 2027, 12000000, 0.10, 13200000, 'synthetic_fixture', '10% synthetic growth assumption', '2026-01-01T00:00:00Z'),
  ('Synthetic Programs', 'Expenses', 2027, 8000000, 0.125, 9000000, 'synthetic_fixture', '12.5% synthetic growth assumption', '2026-01-01T00:00:00Z')
ON CONFLICT(category, fiscal_year) DO UPDATE SET
  classification=excluded.classification,
  base_amount_cents=excluded.base_amount_cents,
  growth_pct=excluded.growth_pct,
  planned_amount_cents=excluded.planned_amount_cents,
  basis=excluded.basis,
  notes=excluded.notes,
  updated_at=excluded.updated_at;
