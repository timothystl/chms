-- Synthetic role-level benefit components only. Never use with a production database.
INSERT INTO finance_compensation_benefit_components
  (fiscal_year, role_label, component_key, component_label, amount_cents, source_kind, updated_at)
VALUES
  (2027,'Synthetic Ministry Role','pension','Pension',400000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  (2027,'Synthetic Ministry Role','health','Group health plan',600000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  (2027,'Synthetic Ministry Role','disability','Disability',100000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  (2027,'Synthetic Ministry Role','employer_taxes','Employer taxes',100000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  (2027,'Synthetic Operations Role','pension','Pension',300000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  (2027,'Synthetic Operations Role','health','Group health plan',400000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  (2027,'Synthetic Operations Role','disability','Disability',50000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  (2027,'Synthetic Operations Role','employer_taxes','Employer taxes',150000,'synthetic_fixture','2026-01-01T00:00:00Z');
