-- Compensation Planner per-worker WRITE path (Finance-owned staging data).
--
-- This is deliberately a NEW, separate table from finance_compensation_plan (0002 -- the flat
-- role-level rollup the synthetic Compensation Report reads). That table has no per-worker
-- identity at all (fiscal_year, role_label is its whole key), so it structurally cannot carry a
-- per-worker hideFromCouncil flag, a per-worker raise method, or any other worker-level fact --
-- there is nothing to hide-from-council when there is no worker row to hide. Enforcing "a council
-- editor must never even see, let alone edit, a hidden worker's row" (see
-- compensation-plan-write-service.js and test/finance-compensation-plan-write-service.test.js)
-- requires an actual per-worker row, so this migration adds one instead of overloading the
-- existing flat table.
--
-- This table is NOT synced from, and never written back to, Connect's real
-- connect.finance-compensation.v1 roster (finance-compensation-consumer.js) or the legacy
-- SALARY_PLANNER_KEY roster in Connect's own D1 (src/api-finance.js). It is Finance's own,
-- independent planning draft -- see compensation-plan-write-service.js's header comment and
-- apps/finance/README.md's changelog entry for exactly what per-worker capability this table
-- does and does not yet carry relative to that legacy roster shape.
--
-- worker_key is a Finance-local identifier chosen by whoever creates the row (short, URL/SQL-safe
-- token) -- there is no shared, stable per-person key between this table and Connect's contract
-- today, so it is NOT a foreign reference to any person record in Connect or myMDO.
CREATE TABLE finance_compensation_worker_plan (
  fiscal_year INTEGER NOT NULL,
  worker_key TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role_label TEXT NOT NULL DEFAULT '',
  salary_cents INTEGER NOT NULL DEFAULT 0,
  benefits_cents INTEGER NOT NULL DEFAULT 0,
  comp_method TEXT NOT NULL DEFAULT 'cola',
  adjustment_pct REAL NOT NULL DEFAULT 0,
  hide_from_council INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_by_role TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (fiscal_year, worker_key)
);
CREATE INDEX idx_finance_compensation_worker_plan_year ON finance_compensation_worker_plan(fiscal_year);
