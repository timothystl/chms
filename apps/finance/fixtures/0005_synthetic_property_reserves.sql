-- Synthetic property reserve schedule only. Never use this file with a production database.
INSERT OR IGNORE INTO finance_property_reserves
  (property_key,reserve_key,report_month,tax_year,target_estimate_cents,reserve_before_cents,contribution_cents,reserve_after_cents,note)
VALUES
  ('synthetic-property','property_tax','2026-02',2026,6000000,2500000,500000,3000000,'Synthetic monthly contribution'),
  ('synthetic-property','property_tax','2026-03',2026,6000000,3000000,500000,3500000,'Synthetic monthly contribution');
