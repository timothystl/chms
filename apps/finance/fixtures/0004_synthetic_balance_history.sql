-- Synthetic prior-year position data only. Never use this file with a production database.
INSERT OR IGNORE INTO finance_church_balances
  (fiscal_year,as_of_date,classification,category_path,account_name,own_balance_cents,source,synced_at)
VALUES
  (2025,'2025-12-31','Assets','Assets:Synthetic Cash','Synthetic Cash',27000000,'synthetic_fixture','2025-12-31T00:00:00Z'),
  (2025,'2025-12-31','Liabilities','Liabilities:Synthetic Note','Synthetic Note',11000000,'synthetic_fixture','2025-12-31T00:00:00Z'),
  (2025,'2025-12-31','Equity','Equity:Synthetic Net Assets','Synthetic Net Assets',16000000,'synthetic_fixture','2025-12-31T00:00:00Z');
