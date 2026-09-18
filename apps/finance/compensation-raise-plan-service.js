// ── Compensation Planner: GLOBAL raise-plan-options row -- Finance's OWN D1, additive write ────
//
// Ports legacy's shared `finance_salary_planner` blob's plan-wide raise assumptions
// (`compCustomPct`/`compScalePct`/`compBaselineRosterOnly` -- `src/api-finance.js`'s
// `finSalaryBuildSaveBody`/`applySalaryPlannerWrite`) into their own per-fiscal-year row. This is
// ADDITIVE to migration 0007's per-worker `finance_compensation_worker_plan`
// (compensation-plan-write-service.js) -- it never reads, writes, or otherwise touches that
// table's own per-worker `comp_method`/`adjustment_pct` columns or its admin/council/compensation
// write path. See apps/finance/README.md's changelog entry for the full parity-gap rationale this
// closes (and compensation-council-draft-service.js for the other half: council's own private
// draft, which is where council's view of these same three settings can be privately overridden).
//
// What this does NOT port (a real, deliberate scope limit, not an oversight):
//   - Legacy's top-level `compMethod` plan-wide default raise method. This app's
//     `finance_compensation_worker_plan` already carries a `comp_method` for every worker row
//     individually (compensation-plan-write-service.js), so a second, plan-wide default of the
//     same name would either duplicate or contradict a value this app already keeps per worker.
//   - Legacy's hand-typed `compOverrides` dollar-figure map. There is no seed-vs-computed-then-
//     overridden distinction in this app's schema to hang an override on: `salary_cents`/
//     `benefits_cents` on `finance_compensation_worker_plan` already ARE the seed figures, not a
//     value some formula computes that this would then override (see that file's own header
//     comment making the identical point about its own scope).
// Porting either here would mean inventing a new concept these tables don't otherwise have, not a
// straight port -- exactly the same standard compensation-plan-write-service.js already applies to
// its own scope limits.
//
// OFF BY DEFAULT: reuses `isCompensationPlanWriteEnabled` from compensation-plan-write-service.js
// -- ONE flag gates every Compensation Planner write in this app (the per-worker rows there, the
// global options here, and the council draft in compensation-council-draft-service.js), rather
// than fragmenting into a second flag for what is a single rollout decision Andrew makes once.
import { isCompensationPlanWriteEnabled } from './compensation-plan-write-service.js';

// A subset of COMPENSATION_LIVE_ALLOWED_ROLES (admin/council/compensation) -- council is
// deliberately excluded from writing this SHARED table directly, matching legacy's own split
// between the shared `finance_salary_planner` key (admin/finance, plus a `compensation`-role fork)
// and council's separate, private overlay fork (see compensation-council-draft-service.js). This
// is a narrowing of the existing role set, never a new role -- no name here exists outside
// COMPENSATION_LIVE_ALLOWED_ROLES.
export const RAISE_PLAN_WRITE_ROLES = Object.freeze(['admin', 'compensation']);

function err(message, status = 400) {
  return { error: message, status };
}

function mapRow(row) {
  if (!row) return null;
  return {
    fiscalYear: row.fiscal_year,
    customPct: row.custom_pct,
    scalePct: row.scale_pct,
    baselineRosterOnly: !!row.baseline_roster_only,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    updatedByRole: row.updated_by_role,
  };
}

// Read-back for this table -- no viewer filtering to apply (unlike readCompensationWorkerPlan,
// this table carries no per-worker identity or hideFromCouncil concept at all), so any caller that
// already reached this function may read the plan-wide figures for a fiscal year. Returns null for
// a fiscal year with no saved row yet, never a fabricated zero-filled default.
export async function readRaisePlanOptions(db, fiscalYear) {
  if (!Number.isInteger(fiscalYear)) throw new Error('fiscalYear must be an integer');
  const row = await db.prepare('SELECT * FROM finance_compensation_raise_plan_options WHERE fiscal_year=?').bind(fiscalYear).first();
  return mapRow(row);
}

// Full-replace save, matching legacy's own whole-blob resend shape (finSalaryBuildSaveBody sends
// every field on every save, not an incremental PATCH) -- all three fields are required on every
// call rather than being independently optional, so a caller can never half-save this row.
export async function saveRaisePlanOptions(db, { fiscalYear, role, updatedBy, customPct, scalePct, baselineRosterOnly }) {
  if (!RAISE_PLAN_WRITE_ROLES.includes(role)) {
    return err('Access denied: editing global raise-plan options requires admin or compensation access', 403);
  }
  if (!Number.isInteger(fiscalYear)) return err('fiscalYear must be an integer');
  if (typeof customPct !== 'number' || !Number.isFinite(customPct)) return err('customPct must be a finite number');
  if (typeof scalePct !== 'number' || !Number.isFinite(scalePct)) return err('scalePct must be a finite number');
  if (typeof baselineRosterOnly !== 'boolean') return err('baselineRosterOnly must be a boolean');

  await db.prepare(
    `INSERT INTO finance_compensation_raise_plan_options
       (fiscal_year, custom_pct, scale_pct, baseline_roster_only, updated_at, updated_by, updated_by_role)
     VALUES (?, ?, ?, ?, datetime('now'), ?, ?)
     ON CONFLICT(fiscal_year) DO UPDATE SET
       custom_pct=excluded.custom_pct, scale_pct=excluded.scale_pct,
       baseline_roster_only=excluded.baseline_roster_only, updated_at=datetime('now'),
       updated_by=excluded.updated_by, updated_by_role=excluded.updated_by_role`
  ).bind(fiscalYear, customPct, scalePct, baselineRosterOnly ? 1 : 0, updatedBy || '', role).run();

  return { ok: true, fiscalYear };
}

export { isCompensationPlanWriteEnabled };
