-- Tuition Aid Planner: per-year data. Two tables:
--   tuition_year_rates    — the actual/overridden tuition rate for a given school year
--                            (falls back to the base_cents/growth_pct projection formula
--                            in tuition_config when no row exists for that year).
--   tuition_student_years — a per-student "pin" for a specific school year (outside aid,
--                            family share %, exact award overrides). When present, it wins
--                            over the rolling projection derived from the student's live
--                            tuition_students row. Rows are kept even after the parent
--                            student row goes inactive, so past-year history survives a
--                            family graduating or leaving.
CREATE TABLE IF NOT EXISTS tuition_year_rates (
  school_year TEXT PRIMARY KEY,
  tuition_cents INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tuition_student_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES tuition_students(id),
  school_year TEXT NOT NULL,
  grade TEXT NOT NULL DEFAULT '',
  outside_aid_cents INTEGER,
  fam_pct INTEGER,
  timothy_award_cents INTEGER,
  family_owed_cents INTEGER,
  lhs_award_cents INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id, school_year)
);
CREATE INDEX IF NOT EXISTS idx_tsy_school_year ON tuition_student_years(school_year);
