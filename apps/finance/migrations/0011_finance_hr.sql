-- HR & Staff (v3 design), admin-only. Holds church staff and key volunteers only; daycare staff
-- records stay in myMDO, which owns childcare staffing. Background checks and trainings are
-- stored as completion/expiration dates and status only -- never reports, results detail, SSNs,
-- or uploaded documents. Months are 'YYYY-MM'; days are 'YYYY-MM-DD'.

CREATE TABLE IF NOT EXISTS finance_hr_people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
  person_group TEXT NOT NULL CHECK (person_group IN ('Church staff', 'Key volunteer')),
  position TEXT NOT NULL DEFAULT '',
  reports_to_id INTEGER REFERENCES finance_hr_people(id),
  start_month TEXT CHECK (start_month IS NULL OR start_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  employment_type TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  roster_credential TEXT NOT NULL DEFAULT '',
  requires_background INTEGER NOT NULL DEFAULT 1 CHECK (requires_background IN (0, 1)),
  requires_safe_gatherings INTEGER NOT NULL DEFAULT 1 CHECK (requires_safe_gatherings IN (0, 1)),
  requires_mandated_reporter INTEGER NOT NULL DEFAULT 0 CHECK (requires_mandated_reporter IN (0, 1)),
  requires_cpr INTEGER NOT NULL DEFAULT 0 CHECK (requires_cpr IN (0, 1)),
  health_coverage TEXT NOT NULL DEFAULT 'not_enrolled' CHECK (health_coverage IN ('family', 'self_spouse', 'self_child', 'self', 'waived', 'opted_out', 'not_enrolled', 'not_eligible')),
  pension INTEGER NOT NULL DEFAULT 0 CHECK (pension IN (0, 1)),
  disability INTEGER NOT NULL DEFAULT 0 CHECK (disability IN (0, 1)),
  retirement_403b INTEGER NOT NULL DEFAULT 0 CHECK (retirement_403b IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT ''
);

-- Latest completion per person and credential. expires_on is completion plus the renewal period
-- unless an explicit expiration was entered.
CREATE TABLE IF NOT EXISTS finance_hr_credentials (
  person_id INTEGER NOT NULL REFERENCES finance_hr_people(id),
  kind TEXT NOT NULL CHECK (kind IN ('background_check', 'safe_gatherings', 'mandated_reporter', 'cpr_first_aid')),
  completed_on TEXT NOT NULL CHECK (completed_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  expires_on TEXT NOT NULL CHECK (expires_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (person_id, kind)
);

CREATE TABLE IF NOT EXISTS finance_hr_reviews (
  person_id INTEGER NOT NULL REFERENCES finance_hr_people(id),
  review_year INTEGER NOT NULL CHECK (review_year BETWEEN 2000 AND 2200),
  status TEXT NOT NULL CHECK (status IN ('Not started', 'Self-review in', 'Scheduled', 'Complete')),
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (person_id, review_year)
);

CREATE TABLE IF NOT EXISTS finance_hr_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES finance_hr_people(id),
  review_year INTEGER NOT NULL CHECK (review_year BETWEEN 2000 AND 2200),
  goal TEXT NOT NULL CHECK (length(trim(goal)) > 0),
  progress_pct INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS finance_hr_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  reports_to TEXT NOT NULL DEFAULT '',
  flsa TEXT NOT NULL CHECK (flsa IN ('Exempt · called', 'Exempt', 'Non-exempt')),
  hours TEXT NOT NULL DEFAULT '',
  description_updated_month TEXT CHECK (description_updated_month IS NULL OR description_updated_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS finance_hr_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  version_label TEXT NOT NULL CHECK (length(trim(version_label)) > 0),
  applies_to TEXT NOT NULL CHECK (applies_to IN ('staff', 'staff_and_volunteers', 'volunteers')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT ''
);

-- A signature counts only for the version it was recorded against.
CREATE TABLE IF NOT EXISTS finance_hr_policy_signatures (
  policy_id INTEGER NOT NULL REFERENCES finance_hr_policies(id),
  person_id INTEGER NOT NULL REFERENCES finance_hr_people(id),
  version_label TEXT NOT NULL,
  signed_on TEXT NOT NULL CHECK (signed_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  recorded_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (policy_id, person_id, version_label)
);

CREATE TABLE IF NOT EXISTS finance_hr_benefit_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES finance_hr_people(id),
  change_date TEXT NOT NULL CHECK (change_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  change TEXT NOT NULL CHECK (length(trim(change)) > 0),
  status TEXT NOT NULL CHECK (status IN ('Requested', 'Waiting for open enrollment', 'Processed', 'Waiver on file')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL DEFAULT ''
);
