-- Synthetic staging fixture for Facilities (migration 0010). Staging-only; never applied to
-- production. Every contractor is a synthetic name.
INSERT INTO finance_facility_assets (name, category, location, installed_month, expected_life_years, replacement_cost_cents, model, serial, warranty, vendor, notes) VALUES
  ('Synthetic RTU #1 · 10-ton rooftop unit', 'HVAC', 'Education wing roof', '2009-06', 20, 2800000, 'Synthetic 48FC-10', 'SYN-0001', 'Expired 2014', 'Synthetic Mechanical Co.', ''),
  ('Synthetic RTU #2 · 7.5-ton rooftop unit', 'HVAC', 'Office wing roof', '2016-05', 20, 2400000, 'Synthetic YSC090', 'SYN-0002', 'Parts to May 2026 (ended)', 'Synthetic Mechanical Co.', ''),
  ('Synthetic Boiler #1', 'Boilers', 'Sanctuary mechanical room', '1998-10', 30, 6400000, 'Synthetic 88-5', 'SYN-0003', 'Expired', 'Synthetic Plumbing & Heating', ''),
  ('Synthetic passenger elevator', 'Elevator', 'Education wing, 2 stops', '2001-03', 25, 14500000, 'Synthetic hydraulic', 'SYN-0004', 'Service contract', 'Synthetic Elevator Co.', ''),
  ('Synthetic sanctuary roof · shingle', 'Roofs', 'Sanctuary', '2003-07', 25, 21000000, 'Synthetic 18,400 sq ft', '', 'Expired 2013', 'Synthetic Roofing', ''),
  ('Synthetic walk-in cooler', 'Kitchen', 'Fellowship hall kitchen', '2011-04', 15, 1650000, 'Synthetic 8×10', 'SYN-0006', 'Expired', 'Synthetic Refrigeration', ''),
  ('Synthetic fire alarm panel', 'Fire & security', 'Main entry closet', '2013-08', 15, 2600000, 'Synthetic NFS2', 'SYN-0007', 'Expired', 'Synthetic Fire Protection', ''),
  ('Synthetic playground structure', 'Playground', 'Daycare yard', '2017-07', 15, 4800000, 'Synthetic 5–12', 'SYN-0008', 'Parts to 2032', 'Synthetic Playworks', '');

INSERT INTO finance_facility_pm_tasks (name, covers, asset_id, interval_months, last_done_on, assignee) VALUES
  ('HVAC filters, all RTUs', 'RTU #1–#2', 1, 3, '2026-07-15', 'Synthetic Mechanical Co.'),
  ('Boiler fall start-up & cleaning', 'Boiler #1', 3, 12, '2025-10-02', 'Synthetic Plumbing & Heating'),
  ('Elevator maintenance visit', 'Under service contract', 4, 1, '2026-08-28', 'Synthetic Elevator Co.'),
  ('Roof inspection, spring & fall', 'Sanctuary', 5, 6, '2026-02-08', 'Synthetic Roofing'),
  ('Fire alarm annual test', 'Panel + devices', 7, 12, '2025-11-06', 'Synthetic Fire Protection'),
  ('Playground safety check', 'Daycare yard', 8, 1, '2026-08-19', 'Synthetic custodian');

INSERT INTO finance_facility_service_log (asset_id, pm_task_id, service_date, service_type, description, vendor, cost_cents) VALUES
  (4, NULL, '2026-09-16', 'Inspection', 'Elevator state inspection · passed', 'Synthetic inspector', 0),
  (8, 6, '2026-08-19', 'Preventive', 'Playground safety check · loose bolt tightened', 'Synthetic custodian', 0),
  (1, 1, '2026-07-15', 'Preventive', 'Q3 filter change, all RTUs', 'Synthetic Mechanical Co.', 64000),
  (5, NULL, '2026-06-02', 'Repair', 'Shingles replaced after hail; flashing resealed', 'Synthetic Roofing', 287000),
  (2, NULL, '2026-05-21', 'Repair', 'Compressor contactor and capacitor replaced', 'Synthetic Mechanical Co.', 396000),
  (3, NULL, '2026-01-22', 'Repair', 'Circulator pump replaced; old pump seized', 'Synthetic Plumbing & Heating', 184000);

INSERT INTO finance_facility_projects (name, scope, status, target_month, cost_cents, vendor, warranty, useful_life_years, funding, notes) VALUES
  ('Synthetic sanctuary roof replacement', 'Tear-off and replace shingle roof', 'Planned', '2027-06', 21000000, 'Synthetic Roofing (bid 1 of 3)', '10-yr workmanship', 30, 'Building fund campaign', ''),
  ('Synthetic elevator modernization', 'Controller, pump unit, door operator', 'Planned', '2028-07', 14500000, 'Synthetic Elevator Co. (budgetary)', '2 yrs parts & labor', 25, 'Capital reserve', ''),
  ('Synthetic RTU #1 replacement', 'Replace 2009 rooftop unit', 'Planned', '2029-05', 2800000, 'To be bid', '5-yr compressor', 20, 'Capital reserve', ''),
  ('Synthetic lighting & sound', 'LED house lighting, new mixer', 'In progress', '2026-11', 6200000, 'Synthetic AV', '3 yrs equipment', 15, 'Memorials', ''),
  ('Synthetic parking lot resurface', 'Mill, overlay and restripe', 'Completed', '2021-07', 9200000, 'Synthetic Paving', '2 yrs (ended)', 15, 'Building fund', '');
