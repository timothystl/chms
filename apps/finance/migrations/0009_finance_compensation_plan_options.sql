-- Closes two of the three named parity gaps in compensation-plan-write-service.js's own
-- pre-existing header comment ("What is NOT covered"): legacy's GLOBAL compCustomPct/compScalePct/
-- compBaselineRosterOnly raise-plan calculation assumptions, legacy's per-worker hand-typed
-- compOverrides dollar figure, and -- via finance_compensation_council_draft below -- legacy's
-- private per-council-member overlay fork (finance_salary_planner_council_<username>,
-- src/api-finance.js's SALARY_PLANNER_KEY handlers). See compensation-plan-write-service.js's
-- updated header comment for exactly what is and isn't reproduced by each piece below.

-- override_cents: legacy's compOverrides -- a hand-typed dollar figure that overrides whatever
-- comp_method would otherwise compute for this one worker. NULL means "no override," matching
-- legacy's own semantics (the override map only ever holds an entry for a worker who actually has
-- one). Never council-editable, matching legacy's COUNCIL_EDITABLE_FIELDS (which never includes
-- compOverrides) exactly -- council's own write path here still only ever SETs comp_method and
-- adjustment_pct, so this column is unreachable from a council save.
ALTER TABLE finance_compensation_worker_plan ADD COLUMN override_cents INTEGER;

-- The ONE shared roster-wide raise-plan calculation setting for a fiscal year -- legacy's GLOBAL
-- compCustomPct/compScalePct/compBaselineRosterOnly, admin/compensation only (council's own copy of
-- these same three fields is private -- see finance_compensation_council_draft below -- exactly as
-- legacy forks it into finance_salary_planner_council_<username> rather than the shared blob). One
-- shared row per fiscal year, matching finance_compensation_worker_plan's own already-established
-- choice not to reproduce legacy's separate admin-vs-compensation-role fork (SALARY_PLANNER_KEY vs
-- SALARY_PLANNER_COMPENSATION_KEY) -- see compensation-plan-write-service.js's header comment.
CREATE TABLE finance_compensation_plan_options (
  fiscal_year INTEGER PRIMARY KEY,
  comp_custom_pct REAL,
  comp_scale_pct REAL,
  comp_baseline_roster_only INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_by_role TEXT NOT NULL DEFAULT ''
);

-- Legacy's private per-council-member Salary Planner overlay
-- (finance_salary_planner_council_<username>). Deliberately a NEW, separate, ADDITIVE table -- NOT
-- a change to finance_compensation_worker_plan or to applyCompensationWorkerPlanWrite's existing
-- (already shipped, already tested) council write path, which keeps writing directly to the shared
-- worker-plan table exactly as it did before this migration. This table instead backs a genuinely
-- separate, narrower capability: a private DRAFT a council member can save of their own proposed
-- roster-wide raise-plan settings and per-worker raise method/percentage, visible only to them and
-- never landing on the shared plan or the shared finance_compensation_worker_plan table -- see
-- compensation-plan-write-service.js's applyCompensationCouncilDraftWrite/mergeCouncilDraftIntoRoster.
-- council_key is derived from the caller's own (unverified, display-only -- see that file's header
-- comment on why that is safe here) identity the same way legacy's councilPlannerKey derives one
-- from a username. worker_overrides is a JSON object keyed by the STABLE worker_key this app
-- already uses everywhere else (never legacy's fragile roster-array INDEX, which needed its own
-- re-indexing dance whenever a hidden worker changed the array -- see src/api-finance.js's GET
-- handler for that exact fragility this port avoids by construction).
CREATE TABLE finance_compensation_council_draft (
  fiscal_year INTEGER NOT NULL,
  council_key TEXT NOT NULL,
  comp_custom_pct REAL,
  comp_scale_pct REAL,
  comp_baseline_roster_only INTEGER,
  worker_overrides TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (fiscal_year, council_key)
);
