-- Synthetic role-level compensation only. Never use this file with a production database.
INSERT INTO finance_compensation_plan
  (fiscal_year, role_label, salary_cents, benefits_cents, adjustment_pct, basis, notes, updated_at)
VALUES
  (2027, 'Synthetic Ministry Role', 6000000, 1200000, 3, 'synthetic_fixture', 'Synthetic fixture only', '2026-01-01T00:00:00Z'),
  (2027, 'Synthetic Operations Role', 4500000, 900000, 3, 'synthetic_fixture', 'Synthetic fixture only', '2026-01-01T00:00:00Z');
