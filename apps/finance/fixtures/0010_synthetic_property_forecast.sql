-- Synthetic 12-month property forecast only. Never use this file with a production database.
INSERT OR IGNORE INTO finance_property_budget_monthly
  (property_key, period, revenue_cents, expenses_cents, net_income_cents, source, updated_at)
VALUES
  ('synthetic-property','2027-01',2200000,1300000,900000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  ('synthetic-property','2027-02',2200000,1300000,900000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  ('synthetic-property','2027-03',2200000,1300000,900000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  ('synthetic-property','2027-04',2200000,1300000,900000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  ('synthetic-property','2027-05',2200000,1300000,900000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  ('synthetic-property','2027-06',2200000,1300000,900000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  ('synthetic-property','2027-07',2200000,1300000,900000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  ('synthetic-property','2027-08',2200000,1300000,900000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  ('synthetic-property','2027-09',2200000,1300000,900000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  ('synthetic-property','2027-10',2200000,1300000,900000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  ('synthetic-property','2027-11',2200000,1300000,900000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  ('synthetic-property','2027-12',2200000,1300000,900000,'synthetic_fixture','2026-01-01T00:00:00Z');
