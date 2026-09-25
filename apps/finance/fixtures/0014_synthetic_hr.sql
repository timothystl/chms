-- Synthetic staging fixture for HR & Staff (migration 0011). Staging-only; never applied to
-- production. Every name and email is synthetic.
INSERT INTO finance_hr_people (full_name, person_group, position, reports_to_id, start_month, employment_type, email, roster_credential, requires_background, requires_safe_gatherings, requires_mandated_reporter, requires_cpr, health_coverage, pension, disability, retirement_403b) VALUES
  ('Rev. Synthetic Pastor', 'Church staff', 'Senior Pastor', NULL, '2015-08', 'Full-time · called', 'pastor@example.org', 'LCMS roster · Active', 1, 1, 1, 0, 'family', 1, 1, 0),
  ('Synthetic Educator', 'Church staff', 'Director of Christian Education', 1, '2017-06', 'Full-time · commissioned', 'dce@example.org', 'LCMS roster · Active', 1, 1, 1, 1, 'self_spouse', 1, 1, 0),
  ('Synthetic Musician', 'Church staff', 'Director of Music', 1, '2014-09', 'Full-time', 'music@example.org', '', 1, 1, 1, 0, 'opted_out', 1, 0, 0),
  ('Synthetic Administrator', 'Church staff', 'Business Administrator', 1, '2019-03', 'Full-time', 'office@example.org', '', 1, 1, 1, 0, 'self', 1, 1, 1),
  ('Synthetic Custodian', 'Church staff', 'Custodian', 4, '2021-05', 'Full-time · hourly', 'custodian@example.org', '', 1, 1, 1, 1, 'waived', 1, 0, 0),
  ('Synthetic Assistant', 'Church staff', 'Office Assistant', 4, '2023-01', 'Part-time · hourly', 'assistant@example.org', '', 1, 1, 1, 0, 'not_eligible', 0, 0, 0),
  ('Synthetic Superintendent', 'Key volunteer', 'Sunday School Superintendent', 2, '2012-09', 'Volunteer · children', '', '', 1, 1, 0, 0, 'not_eligible', 0, 0, 0),
  ('Synthetic Nursery Volunteer', 'Key volunteer', 'Nursery Volunteer', 1, '2026-08', 'Volunteer · children', '', '', 1, 1, 0, 0, 'not_eligible', 0, 0, 0),
  ('Synthetic Counter', 'Key volunteer', 'Counting Team Lead', 4, '2010-01', 'Volunteer · finance', '', '', 1, 0, 0, 0, 'not_eligible', 0, 0, 0);

INSERT INTO finance_hr_credentials (person_id, kind, completed_on, expires_on) VALUES
  (1, 'background_check', '2024-02-01', '2027-02-01'), (1, 'safe_gatherings', '2024-02-10', '2027-02-10'), (1, 'mandated_reporter', '2025-09-01', '2027-09-01'),
  (2, 'background_check', '2023-10-15', '2026-10-15'), (2, 'safe_gatherings', '2023-10-20', '2026-10-20'), (2, 'mandated_reporter', '2024-10-01', '2026-10-01'), (2, 'cpr_first_aid', '2025-06-01', '2027-06-01'),
  (3, 'background_check', '2023-05-01', '2026-05-01'), (3, 'safe_gatherings', '2023-05-01', '2026-05-01'), (3, 'mandated_reporter', '2025-05-01', '2027-05-01'),
  (4, 'background_check', '2025-03-01', '2028-03-01'), (4, 'safe_gatherings', '2025-03-01', '2028-03-01'), (4, 'mandated_reporter', '2025-03-01', '2027-03-01'),
  (5, 'background_check', '2021-04-01', '2024-04-01'), (5, 'safe_gatherings', '2024-05-01', '2027-05-01'), (5, 'mandated_reporter', '2025-05-01', '2027-05-01'), (5, 'cpr_first_aid', '2024-05-01', '2026-05-01'),
  (6, 'background_check', '2023-01-15', '2026-01-15'), (6, 'mandated_reporter', '2025-02-01', '2027-02-01'),
  (7, 'background_check', '2023-08-01', '2026-08-01'), (7, 'safe_gatherings', '2023-08-01', '2026-08-01'),
  (9, 'background_check', '2024-03-01', '2027-03-01');

INSERT INTO finance_hr_reviews (person_id, review_year, status, note) VALUES
  (1, 2026, 'Scheduled', 'Oct 28 · council personnel'), (2, 2026, 'Not started', ''), (3, 2026, 'Complete', ''), (4, 2026, 'Self-review in', '');

INSERT INTO finance_hr_goals (person_id, review_year, goal, progress_pct) VALUES
  (1, 2026, 'Launch fall small-group initiative', 75), (1, 2026, 'Sabbatical plan drafted for 2027', 20),
  (3, 2026, 'Recruit two new choir sections', 65), (4, 2026, 'Close books by the 10th each month', 68);

INSERT INTO finance_hr_positions (title, reports_to, flsa, hours, description_updated_month) VALUES
  ('Senior Pastor', 'Church Council', 'Exempt · called', 'Full-time', '2023-01'),
  ('Director of Christian Education', 'Senior Pastor', 'Exempt', 'Full-time', '2021-03'),
  ('Director of Music', 'Senior Pastor', 'Exempt', 'Full-time', '2018-08'),
  ('Business Administrator', 'Senior Pastor', 'Exempt', 'Full-time', '2025-02'),
  ('Custodian', 'Business Administrator', 'Non-exempt', 'Full-time', '2021-04'),
  ('Office Assistant', 'Business Administrator', 'Non-exempt', 'Part-time · 24 hrs', NULL);

INSERT INTO finance_hr_policies (title, version_label, applies_to) VALUES
  ('Employee handbook', 'Version 3 · Jan 2026', 'staff'),
  ('Child protection policy (Safe Gatherings)', 'Revised Aug 2025', 'staff_and_volunteers'),
  ('Harassment prevention', 'Revised Jan 2024', 'staff');

INSERT INTO finance_hr_policy_signatures (policy_id, person_id, version_label, signed_on) VALUES
  (1, 1, 'Version 3 · Jan 2026', '2026-01-20'), (1, 2, 'Version 3 · Jan 2026', '2026-01-21'), (1, 4, 'Version 3 · Jan 2026', '2026-01-22'),
  (1, 5, 'Version 2 · Jan 2024', '2024-02-01'),
  (2, 1, 'Revised Aug 2025', '2025-09-01'), (2, 2, 'Revised Aug 2025', '2025-09-01'), (2, 7, 'Revised Aug 2025', '2025-09-05'),
  (3, 1, 'Revised Jan 2024', '2024-02-01'), (3, 2, 'Revised Jan 2024', '2024-02-01'), (3, 3, 'Revised Jan 2024', '2024-02-01'),
  (3, 4, 'Revised Jan 2024', '2024-02-01'), (3, 5, 'Revised Jan 2024', '2024-02-01'), (3, 6, 'Revised Jan 2024', '2024-02-01');

INSERT INTO finance_hr_benefit_changes (person_id, change_date, change, status) VALUES
  (2, '2026-08-18', 'Marriage · health Self → Self & spouse', 'Processed'),
  (4, '2026-07-01', '403(b) contribution raised to $75 per paycheck', 'Processed'),
  (5, '2026-06-03', 'Waived health coverage · spouse''s plan', 'Waiver on file');
