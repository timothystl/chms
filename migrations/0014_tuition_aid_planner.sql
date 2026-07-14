-- Tuition Aid Planner: K-8/LHS roster (money stored in integer cents), budget config knobs,
-- and historical tuition-rate chart data. Seeded on next cold start by seedTuitionAid() in
-- src/db.js (guarded by a NOT-EXISTS check on tuition_config, so this migration only creates
-- empty tables — the actual 2026-27 roster/config/history rows come from the app boot path).
CREATE TABLE IF NOT EXISTS tuition_students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER REFERENCES people(id),
  household_id INTEGER REFERENCES households(id),
  family TEXT NOT NULL DEFAULT '',
  child TEXT NOT NULL DEFAULT '',
  is_pipeline INTEGER NOT NULL DEFAULT 0,
  base_grade TEXT NOT NULL DEFAULT '',
  birth_year INTEGER,
  outside_aid_cents INTEGER NOT NULL DEFAULT 0,
  fam_pct INTEGER NOT NULL DEFAULT 50,
  fam_pct_orig INTEGER NOT NULL DEFAULT 50,
  touched INTEGER NOT NULL DEFAULT 0,
  lhs_award_cents INTEGER NOT NULL DEFAULT 120000,
  lhs_award_orig_cents INTEGER NOT NULL DEFAULT 120000,
  attends_lhs INTEGER NOT NULL DEFAULT 1,
  timothy_award_exact_cents INTEGER,
  family_owed_exact_cents INTEGER,
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tuition_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tuition_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_year TEXT NOT NULL DEFAULT '',
  tuition_cents INTEGER NOT NULL DEFAULT 0,
  family_pct REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);
