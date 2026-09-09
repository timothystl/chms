-- Synthetic Daycare budget and allocation inputs only. Never use with a production database.
INSERT OR IGNORE INTO finance_settings (key,value,updated_at) VALUES
  ('daycare_utility_pct','0.5','2026-01-01T00:00:00Z'),
  ('daycare_insurance_pct','0.5','2026-01-01T00:00:00Z');

INSERT OR IGNORE INTO finance_church_entries
  (fiscal_year,period_month,classification,category_path,account_name,own_actual_cents,own_budget_cents,source,synced_at)
VALUES
  (2026,0,'Expenses','Expenses:Synthetic Utilities','Synthetic Utilities',1200000,1300000,'synthetic_fixture','2026-01-01T00:00:00Z'),
  (2026,0,'Expenses','Expenses:Synthetic Insurance','Synthetic Insurance',500000,550000,'synthetic_fixture','2026-01-01T00:00:00Z');

INSERT INTO finance_daycare_entries (period,category,entry_type,amount_cents,notes,source,created_at)
SELECT '2026-01','Synthetic Tuition','budget',4200000,'Synthetic fixture budget','synthetic_fixture','2026-01-01T00:00:00Z'
WHERE NOT EXISTS (SELECT 1 FROM finance_daycare_entries WHERE period='2026-01' AND category='Synthetic Tuition' AND entry_type='budget' AND source='synthetic_fixture');

INSERT INTO finance_daycare_entries (period,category,entry_type,amount_cents,notes,source,created_at)
SELECT '2026-01','Synthetic Labor','budget',2600000,'Synthetic fixture budget','synthetic_fixture','2026-01-01T00:00:00Z'
WHERE NOT EXISTS (SELECT 1 FROM finance_daycare_entries WHERE period='2026-01' AND category='Synthetic Labor' AND entry_type='budget' AND source='synthetic_fixture');
