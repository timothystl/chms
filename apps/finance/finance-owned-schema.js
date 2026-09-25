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

export const FINANCE_OWNED_SCHEMAS = Object.freeze({
  facilities: Object.freeze({ migration: '0010_finance_facilities.sql', sql: FACILITIES_SCHEMA_SQL }),
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
