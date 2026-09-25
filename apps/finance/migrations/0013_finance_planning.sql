-- Planning scenarios (v3 design). The budget plan itself stays in Connect's finance_budget_plan;
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
