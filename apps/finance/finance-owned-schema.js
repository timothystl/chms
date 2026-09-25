// Finance-owned tables the Worker creates for itself, through its own FINANCE_DB binding, the
// first time a feature needs them (Andrew chose this on 2026-09-25: the release token cannot run
// D1 migrations). Each block is the exact text of its migration file -- every statement is
// CREATE ... IF NOT EXISTS, so it never alters or removes existing tables or rows, and running it
// again (or later applying the migration with wrangler) changes nothing.
// test/finance-owned-schema.test.js keeps each block identical to its migration file.

export const FACILITIES_SCHEMA_SQL = `-- Facilities (v3 design): the church campus asset register, its service history, recurring
-- preventive-maintenance tasks, and capital projects. Finance owns these tables outright; no
-- Connect or Website table holds this information, so there is no competing writer or copy.
-- Money is stored in whole cents. Months are 'YYYY-MM'; days are 'YYYY-MM-DD'.

CREATE TABLE IF NOT EXISTS finance_facility_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  category TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  installed_month TEXT NOT NULL CHECK (installed_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  expected_life_years INTEGER NOT NULL CHECK (expected_life_years BETWEEN 1 AND 150),
  replacement_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (replacement_cost_cents >= 0),
  model TEXT NOT NULL DEFAULT '',
  serial TEXT NOT NULL DEFAULT '',
  warranty TEXT NOT NULL DEFAULT '',
  vendor TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS finance_facility_pm_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  covers TEXT NOT NULL DEFAULT '',
  asset_id INTEGER REFERENCES finance_facility_assets(id),
  interval_months INTEGER NOT NULL CHECK (interval_months BETWEEN 1 AND 120),
  last_done_on TEXT CHECK (last_done_on IS NULL OR last_done_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  assignee TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS finance_facility_service_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER REFERENCES finance_facility_assets(id),
  pm_task_id INTEGER REFERENCES finance_facility_pm_tasks(id),
  service_date TEXT NOT NULL CHECK (service_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  service_type TEXT NOT NULL CHECK (service_type IN ('Repair', 'Inspection', 'Preventive', 'Replacement')),
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  vendor TEXT NOT NULL DEFAULT '',
  cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS finance_facility_service_log_date ON finance_facility_service_log (service_date DESC, id DESC);

CREATE TABLE IF NOT EXISTS finance_facility_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  scope TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('Planned', 'In progress', 'Completed')),
  target_month TEXT NOT NULL CHECK (target_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  cost_cents INTEGER NOT NULL CHECK (cost_cents >= 0),
  vendor TEXT NOT NULL DEFAULT '',
  warranty TEXT NOT NULL DEFAULT '',
  useful_life_years INTEGER CHECK (useful_life_years IS NULL OR useful_life_years BETWEEN 1 AND 150),
  funding TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT ''
);
`;

export const HR_SCHEMA_SQL = `-- HR & Staff (v3 design), admin-only. Holds church staff and key volunteers only; daycare staff
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
`;

export const PLANNING_SCHEMA_SQL = `-- Planning scenarios (v3 design). The budget plan itself stays in Connect's finance_budget_plan;
-- these tables only hold the what-if adjustments Finance applies on top of it and which version
-- is the basis the council sees. Percentages are changes against the saved plan, per group of
-- lines (giving, earned and passive income; staff and other expenses).

CREATE TABLE IF NOT EXISTS finance_planning_scenarios (
  fiscal_year INTEGER NOT NULL CHECK (fiscal_year BETWEEN 2000 AND 2100),
  slot TEXT NOT NULL CHECK (slot IN ('conservative', 'hopeful')),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  note TEXT NOT NULL DEFAULT '',
  giving_pct REAL NOT NULL DEFAULT 0 CHECK (giving_pct BETWEEN -50 AND 50),
  earned_pct REAL NOT NULL DEFAULT 0 CHECK (earned_pct BETWEEN -50 AND 50),
  passive_pct REAL NOT NULL DEFAULT 0 CHECK (passive_pct BETWEEN -50 AND 50),
  staff_pct REAL NOT NULL DEFAULT 0 CHECK (staff_pct BETWEEN -50 AND 50),
  other_pct REAL NOT NULL DEFAULT 0 CHECK (other_pct BETWEEN -50 AND 50),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (fiscal_year, slot)
);

CREATE TABLE IF NOT EXISTS finance_planning_basis (
  fiscal_year INTEGER PRIMARY KEY CHECK (fiscal_year BETWEEN 2000 AND 2100),
  slot TEXT NOT NULL CHECK (slot IN ('conservative', 'plan', 'hopeful')),
  chosen_at TEXT NOT NULL DEFAULT (datetime('now')),
  chosen_by TEXT NOT NULL DEFAULT ''
);
`;

export const FACILITY_FILES_SCHEMA_SQL = `-- Facilities photos and documents: equipment photos, nameplate labels, scanned service orders and
-- invoices attached to an asset, recurring maintenance task, service entry, or capital project.
-- The bytes live in Finance's own R2 bucket (binding FACILITY_FILES); this table is the index and
-- the only way a file is found or served. content_type is decided from the file's own bytes on
-- upload, never from what the browser claimed.

CREATE TABLE IF NOT EXISTS finance_facility_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_type TEXT NOT NULL CHECK (record_type IN ('asset', 'pm_task', 'service', 'project')),
  record_id INTEGER NOT NULL CHECK (record_id > 0),
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  caption TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS finance_facility_files_record ON finance_facility_files (record_type, record_id, id);
`;

export const FINANCE_OWNED_SCHEMAS = Object.freeze({
  facilities: Object.freeze({ migration: '0010_finance_facilities.sql', sql: FACILITIES_SCHEMA_SQL }),
  hr: Object.freeze({ migration: '0011_finance_hr.sql', sql: HR_SCHEMA_SQL }),
  facilityFiles: Object.freeze({ migration: '0012_finance_facility_files.sql', sql: FACILITY_FILES_SCHEMA_SQL }),
  planning: Object.freeze({ migration: '0013_finance_planning.sql', sql: PLANNING_SCHEMA_SQL }),
});

// Splits a migration file into single statements: comment lines dropped, split on ';'.
export function schemaStatements(sql) {
  return sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
    .split(';').map((statement) => statement.trim()).filter(Boolean);
}

// Only additive, idempotent DDL is ever run from here.
export function isAdditiveStatement(statement) {
  return /^CREATE\s+(TABLE|INDEX|UNIQUE\s+INDEX)\s+IF\s+NOT\s+EXISTS\b/i.test(statement);
}

const ensured = new Set();

// Cached per isolate. A failure is not remembered, so the next request tries again, and the
// caller's own read or write then reports it honestly.
export async function ensureFinanceOwnedSchema(db, key) {
  if (ensured.has(key)) return true;
  const schema = FINANCE_OWNED_SCHEMAS[key];
  if (!schema || !db) return false;
  const statements = schemaStatements(schema.sql);
  if (!statements.every(isAdditiveStatement)) return false;
  try {
    await db.batch(statements.map((statement) => db.prepare(statement)));
    ensured.add(key);
    return true;
  } catch {
    return false;
  }
}

export function resetEnsuredSchemasForTests() {
  ensured.clear();
}
