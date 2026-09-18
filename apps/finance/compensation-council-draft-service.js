// ── Compensation Planner: per-council-member PRIVATE draft overlay -- Finance's OWN D1 ─────────
//
// Ports legacy's private per-council-member overlay fork
// (`finance_salary_planner_council_<username>` -- `src/api-finance.js`'s `councilPlannerKey`/
// `COUNCIL_EDITABLE_FIELDS`/`applySalaryPlannerWrite`/`resolveSalaryPlannerState`) as its own
// table. This is ADDITIVE, not a replacement: council may still edit a VISIBLE worker's
// `comp_method`/`adjustment_pct` directly on the shared `finance_compensation_worker_plan` table
// through the existing `compensation-plan-save-v1` route (compensation-plan-write-service.js) --
// that write path, and its "two council users can see and overwrite each other's edit on that
// shared row" behavior, are UNCHANGED by this file. What this file adds is a second, separate
// option: a private scratch space, visible only to the one council viewer who saved it, that never
// touches the shared table at all. Nothing here reads from, writes to, or is merged back onto
// `finance_compensation_worker_plan` or `finance_compensation_raise_plan_options`.
//
// ── Identity: what "per-council-member" is keyed by ─────────────────────────────────────────────
// Legacy keys its overlay by a USERNAME that Connect's own already-verified admin session
// provides directly. Finance's own role contract (`connect-role-client.js`'s `fetchVerifiedRole`)
// does not carry a verified username today -- see chms/apps/finance/README.md's "Access and data
// safety" note on this exact gap, and `budget-plan-write-service.js`'s own header comment making
// the identical point about why IT also could not port council's overlay fork. The best identity
// source this app has today is the SAME unverified JWT email claim `payroll-section.js`'s
// `approverEmailFromJwt` already reads and uses -- there, only for an audit-trail display label;
// here, additionally as the key that partitions one council viewer's private draft from another's.
//
// This is a real, bounded trust difference from that precedent, stated plainly rather than
// glossed over: `approverEmailFromJwt`'s existing use is safe because Website's own
// `resolvePayrollContractCaller()` independently re-verifies the SAME token's signature before any
// RPC runs, so a tampered token can never reach a real write with a false claimed identity. This
// draft table has no such downstream re-verification -- the ROLE check (`fetchVerifiedRole`,
// which DOES verify the token's signature via Connect) is real and is what gates access to this
// endpoint at all, but the EMAIL used only to choose which draft ROW to read or write is read
// unverified from the same request's JWT. The bounded consequence: a request that already carries
// a genuinely Access-signed token with a verified 'council' role could, if the email claim inside
// that same token were somehow different from the identity Access actually authenticated (not
// possible without breaking the JWT's own signature, which this app does not itself check), read
// or write a differently-named council member's private draft rather than its own -- never any
// row on the SHARED worker-plan table, never a privilege above council's own compensation-editing
// access, and never anyone's private draft while presenting an UNVERIFIED role. This is accepted
// as a narrowly-scoped limitation of what this app's role contract offers today, not a new
// authentication mechanism -- closing it for real means giving `connect.staff-role-v1` a verified
// username, a follow-up outside this change's scope (see the README changelog entry).
//
// ── Per-worker override keying: worker_key, not roster index ────────────────────────────────────
// Legacy's overlay carries `compPerWorkerMethod`/`compOverrides` keyed by ROSTER ARRAY INDEX,
// which `resolveSalaryPlannerState` must then re-index (`oldToNewIndex`) every time a hidden
// worker changes which indices are visible. This app already has a STABLE `worker_key` for every
// row in `finance_compensation_worker_plan` (migration 0007) specifically so that dance is
// unnecessary -- this draft's own `worker_overrides` JSON object is keyed by that SAME worker_key,
// so removing or reordering a worker in the shared roster never invalidates a draft's per-worker
// entries the way legacy's index-keyed maps could.
//
// OFF BY DEFAULT: reuses `isCompensationPlanWriteEnabled` -- see compensation-raise-plan-service.js's
// header comment for why this app deliberately keeps ONE Compensation Planner write flag rather
// than one per table.
import { isCompensationPlanWriteEnabled, readCompensationWorkerPlan, COMPENSATION_PLAN_COMP_METHODS, WORKER_KEY_PATTERN } from './compensation-plan-write-service.js';
import { readRaisePlanOptions } from './compensation-raise-plan-service.js';

function err(message, status = 400) {
  return { error: message, status };
}

// Same lower-case/sanitize shape as legacy's `councilPlannerKey` (src/api-finance.js) -- collapses
// case and strips anything that isn't a-z/0-9/underscore/hyphen, so the same person's differently-
// cased email claim across two requests still resolves to the same draft row.
export function councilDraftKey(identity) {
  return String(identity || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function safeParseWorkerOverrides(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function readCouncilDraftRow(db, fiscalYear, draftKey) {
  return db.prepare(
    'SELECT * FROM finance_compensation_council_draft WHERE fiscal_year=? AND council_identity=?'
  ).bind(fiscalYear, draftKey).first();
}

// Full-replace save, matching legacy's own whole-blob resend shape (see
// compensation-raise-plan-service.js's identical note) -- every call replaces the draft's entire
// stored state; `customPct`/`scalePct`/`baselineRosterOnly` may each be `null` (meaning "no private
// override for this setting, fall back to the global row"), but omitting the key entirely is
// treated the same as `null` rather than "leave the previous value alone".
export async function saveCouncilDraft(db, { fiscalYear, role, councilIdentity, customPct, scalePct, baselineRosterOnly, workerOverrides }) {
  if (role !== 'council') {
    return err('Access denied: only a council viewer may save a private compensation draft', 403);
  }
  const draftKey = councilDraftKey(councilIdentity);
  if (!draftKey) return err('Access denied: no council identity available to key this draft', 403);
  if (!Number.isInteger(fiscalYear)) return err('fiscalYear must be an integer');

  for (const [label, value] of [['customPct', customPct], ['scalePct', scalePct]]) {
    if (value !== undefined && value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
      return err(`${label} must be a finite number or null`);
    }
  }
  if (baselineRosterOnly !== undefined && baselineRosterOnly !== null && typeof baselineRosterOnly !== 'boolean') {
    return err('baselineRosterOnly must be a boolean or null');
  }

  const overridesOut = {};
  if (workerOverrides !== undefined && workerOverrides !== null) {
    if (typeof workerOverrides !== 'object' || Array.isArray(workerOverrides)) {
      return err('workerOverrides must be an object keyed by workerKey');
    }
    for (const [workerKey, patch] of Object.entries(workerOverrides)) {
      if (!WORKER_KEY_PATTERN.test(workerKey)) return err(`invalid workerKey in workerOverrides: ${workerKey}`);
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return err(`workerOverrides.${workerKey} must be an object`);
      const entry = {};
      if (patch.compMethod !== undefined) {
        if (!COMPENSATION_PLAN_COMP_METHODS.includes(patch.compMethod)) {
          return err(`workerOverrides.${workerKey}.compMethod must be one of ${COMPENSATION_PLAN_COMP_METHODS.join(', ')}`);
        }
        entry.compMethod = patch.compMethod;
      }
      if (patch.adjustmentPct !== undefined) {
        if (typeof patch.adjustmentPct !== 'number' || !Number.isFinite(patch.adjustmentPct)) {
          return err(`workerOverrides.${workerKey}.adjustmentPct must be a finite number`);
        }
        entry.adjustmentPct = patch.adjustmentPct;
      }
      if (Object.keys(entry).length) overridesOut[workerKey] = entry;
    }
  }

  await db.prepare(
    `INSERT INTO finance_compensation_council_draft
       (fiscal_year, council_identity, custom_pct, scale_pct, baseline_roster_only, worker_overrides, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(fiscal_year, council_identity) DO UPDATE SET
       custom_pct=excluded.custom_pct, scale_pct=excluded.scale_pct,
       baseline_roster_only=excluded.baseline_roster_only, worker_overrides=excluded.worker_overrides,
       updated_at=datetime('now')`
  ).bind(
    fiscalYear, draftKey,
    customPct === undefined ? null : customPct,
    scalePct === undefined ? null : scalePct,
    baselineRosterOnly === undefined || baselineRosterOnly === null ? null : (baselineRosterOnly ? 1 : 0),
    JSON.stringify(overridesOut),
  ).run();

  return { ok: true, fiscalYear };
}

// Merge-back-onto-roster read: the visible roster (already filtered through
// filterCompensationWorkersForViewer via readCompensationWorkerPlan's own 'council' viewerRole,
// exactly like the shared read side) with this ONE council viewer's own private per-worker
// overrides laid on top, and the plan-wide custom/scale/baseline settings resolved as
// draft-value-if-present-else-global-row.
//
// A draft entry for a worker_key that is no longer visible (removed, or since flagged
// hideFromCouncil) is silently NEVER applied -- the merge only ever walks the already-filtered
// roster and looks up each VISIBLE worker's own override, so a stale draft entry for a worker this
// viewer can no longer see can never leak that worker, or any fact about them, back into view.
export async function buildCouncilDraftView(db, fiscalYear, councilIdentity) {
  if (!Number.isInteger(fiscalYear)) throw new Error('fiscalYear must be an integer');
  const draftKey = councilDraftKey(councilIdentity);
  const [roster, draftRow, globalOptions] = await Promise.all([
    readCompensationWorkerPlan(db, fiscalYear, 'council'),
    draftKey ? readCouncilDraftRow(db, fiscalYear, draftKey) : null,
    readRaisePlanOptions(db, fiscalYear),
  ]);

  const overrides = draftRow ? safeParseWorkerOverrides(draftRow.worker_overrides) : {};
  const mergedRoster = roster.map((worker) => {
    const override = overrides[worker.workerKey];
    if (!override) return worker;
    return {
      ...worker,
      compMethod: override.compMethod !== undefined ? override.compMethod : worker.compMethod,
      adjustmentPct: override.adjustmentPct !== undefined ? override.adjustmentPct : worker.adjustmentPct,
    };
  });

  return {
    fiscalYear,
    roster: mergedRoster,
    raisePlanOptions: {
      customPct: draftRow && draftRow.custom_pct != null ? draftRow.custom_pct : (globalOptions ? globalOptions.customPct : null),
      scalePct: draftRow && draftRow.scale_pct != null ? draftRow.scale_pct : (globalOptions ? globalOptions.scalePct : null),
      baselineRosterOnly: draftRow && draftRow.baseline_roster_only != null
        ? !!draftRow.baseline_roster_only
        : (globalOptions ? globalOptions.baselineRosterOnly : null),
    },
    hasDraft: !!draftRow,
    draftUpdatedAt: draftRow ? draftRow.updated_at : null,
  };
}

export { isCompensationPlanWriteEnabled };
