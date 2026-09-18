-- Compensation Planner: GLOBAL raise-plan-options row + per-council-member PRIVATE draft overlay.
--
-- Additive to migration 0007's finance_compensation_worker_plan (compensation-plan-write-service.js)
-- -- neither table below is read by, written by, or a replacement for that table's existing
-- admin/council/compensation per-worker write path. See compensation-raise-plan-service.js and
-- compensation-council-draft-service.js for the write paths, and apps/finance/README.md's
-- changelog entry for the full parity-gap rationale against legacy's SALARY_PLANNER_KEY-based
-- code in src/api-finance.js.

-- GLOBAL, one row per fiscal year -- the plan-wide raise assumptions legacy's shared
-- finance_salary_planner blob carries alongside its roster (compCustomPct/compScalePct/
-- compBaselineRosterOnly -- src/api-finance.js's finSalaryBuildSaveBody/applySalaryPlannerWrite).
-- Admin/compensation write only (see RAISE_PLAN_WRITE_ROLES in compensation-raise-plan-service.js)
-- -- council never writes this table directly, matching legacy's own split between the shared key
-- (admin/finance/compensation) and the per-user overlay fork (council) in the second table below.
CREATE TABLE finance_compensation_raise_plan_options (
  fiscal_year INTEGER PRIMARY KEY,
  custom_pct REAL NOT NULL DEFAULT 0,
  scale_pct REAL NOT NULL DEFAULT 0,
  baseline_roster_only INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_by_role TEXT NOT NULL DEFAULT ''
);

-- Per-council-member PRIVATE draft overlay -- port of legacy's
-- finance_salary_planner_council_<username> fork (src/api-finance.js's councilPlannerKey/
-- COUNCIL_EDITABLE_FIELDS). Never read by, or merged into, the shared
-- finance_compensation_worker_plan table or the global options table above -- this is scratch
-- space for exactly one council viewer's own working assumptions, returned only when that SAME
-- viewer reads it back (see compensation-council-draft-service.js's buildCouncilDraftView).
--
-- council_identity's source and trust level (an unverified JWT email claim, not a verified
-- username -- Finance's role contract does not carry one yet) is documented in
-- compensation-council-draft-service.js's header comment; this is an accepted, narrowly-scoped
-- limitation of what identity source this app has available today, not a new authentication
-- mechanism.
--
-- worker_overrides is a JSON object keyed by the STABLE worker_key already used by
-- finance_compensation_worker_plan (migration 0007) -- e.g. {"pastor_a":{"compMethod":"custom",
-- "adjustmentPct":3.5}} -- never by roster array index, unlike legacy's compPerWorkerMethod/
-- compOverrides maps, which is why removing or reordering a worker never requires the
-- oldToNewIndex reindexing legacy's resolveSalaryPlannerState performs on every read.
CREATE TABLE finance_compensation_council_draft (
  fiscal_year INTEGER NOT NULL,
  council_identity TEXT NOT NULL,
  custom_pct REAL,
  scale_pct REAL,
  baseline_roster_only INTEGER,
  worker_overrides TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (fiscal_year, council_identity)
);
CREATE INDEX idx_finance_compensation_council_draft_year ON finance_compensation_council_draft(fiscal_year);
