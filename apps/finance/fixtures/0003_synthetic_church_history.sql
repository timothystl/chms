-- Synthetic prior-year trend data only. Never use this file with a production database.
INSERT OR IGNORE INTO finance_church_entries
  (fiscal_year,period_month,classification,category_path,account_name,own_actual_cents,own_budget_cents,source,synced_at)
VALUES
  (2025,0,'Income','Income:Synthetic Contributions','Synthetic Contributions',11000000,10800000,'synthetic_fixture','2025-12-31T00:00:00Z'),
  (2025,0,'Expenses','Expenses:Synthetic Programs','Synthetic Programs',7800000,8000000,'synthetic_fixture','2025-12-31T00:00:00Z');
