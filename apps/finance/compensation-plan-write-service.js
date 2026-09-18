// ── Compensation Planner EDIT/SAVE write path -- Finance's OWN D1, not a relay ──────────────
//
// Every other writer in this app (see route-manifest.js's WRITE_METHODS routes) relays the write
// to Connect or Website and stores nothing in Finance's own database -- Finance's read side is
// synthetic-or-live-passthrough by design. This is the first deliberate exception: compensation
// planning is target-architecture Finance-owned data (see chms/AGENTS.md's product boundary --
// "Finance owns ... compensation planning"), not a copy of someone else's authoritative record, so
// Finance keeping its own draft here is the intended end state, not a stopgap headed for deletion.
//
// OFF BY DEFAULT: isCompensationPlanWriteEnabled() is checked first, before any role check, by the
// route in shell.js (route id 'compensation-plan-save-v1'). A real request against a real
// deployment gets a clear "not yet enabled" response until Andrew explicitly flips the flag in
// that environment's finance_settings (or sets the COMPENSATION_PLAN_WRITE_ENABLED env var) --
// this module and its route exist, and are fully tested, without being reachable in production.
//
// ── Parity with the legacy Salary Planner (src/api-finance.js SALARY_PLANNER_KEY roster) ────
// Legacy stores one shared JSON blob: an ORDERED roster array of workers (each with its own
// hideFromCouncil flag and seed facts), a per-worker compPerWorkerMethod map keyed by roster
// INDEX, a compOverrides map (hand-typed dollar overrides) also keyed by index, GLOBAL
// compCustomPct/compScalePct planning assumptions, and -- for council only -- a private per-user
// overlay fork (finance_salary_planner_council_<username>) that never touches the shared roster.
//
// This write path intentionally does NOT reproduce that whole shape. What IS covered:
//   - A real per-worker row (fiscal_year, worker_key), replacing legacy's fragile index-keyed
//     addressing (see api-finance.js's GET handler re-indexing compPerWorkerMethod/compOverrides
//     whenever a hidden worker changes the array -- this table's stable key needs no such dance).
//   - Per-worker hideFromCouncil, enforced identically to the read side via
//     filterCompensationWorkersForViewer (imported, not re-implemented) plus a hard write-side
//     check below: a council editor gets the SAME generic "you may not edit this worker" denial
//     whether the worker_key does not exist or exists but is hidden, so a council session can never
//     distinguish "no such worker" from "a worker you're not allowed to see."
//   - A per-worker raise/adjustment method (comp_method) and adjustment_pct, editable by council
//     for a VISIBLE row only -- the per-worker analogue of legacy's COUNCIL_EDITABLE_FIELDS
//     (compPerWorkerMethod there; COUNCIL_EDITABLE_WORKER_FIELDS here). Every other column on a
//     council-touched row (name, role_label, salary_cents, benefits_cents, hide_from_council,
//     notes) is left exactly as it is -- council's UPDATE statement only ever SETs comp_method and
//     adjustment_pct, so there is no code path where a council save can alter a seed fact.
//
// What is NOT covered (a real, deliberate gap, not an oversight):
//   - Legacy's GLOBAL compCustomPct/compScalePct/compBaselineRosterOnly planning assumptions (one
//     shared "how should the whole roster's raise be computed" toggle) have no equivalent here.
//     Only the PER-WORKER comp_method/adjustment_pct exist in this table.
//   - Legacy's hand-typed compOverrides (a dollar figure that overrides whatever comp_method would
//     otherwise compute) has no equivalent column here. salary_cents/benefits_cents on this table
//     are themselves the seed figures, not a derived-then-overridden result.
//   - Legacy's private per-council-member overlay fork does not exist here. A council save in this
//     path writes directly into the ONE shared finance_compensation_worker_plan table (restricted
//     to comp_method/adjustment_pct on rows they may see) rather than into an isolated per-user
//     draft two different council members could disagree in. This is a real behavior change, not
//     merely a storage detail: two council users editing the same fiscal year now see and can
//     overwrite each other's comp_method/adjustment_pct choice on a shared row. This mirrors how
//     Finance's read side already treats council (a filtered view of ONE shared roster, with no
//     per-user overlay concept in apps/finance at all -- see compensation-report-service.js), so it
//     keeps this write path consistent with what already exists rather than introducing a
//     second, divergent council-state model. If a private per-council-member draft is later judged
//     necessary here too, it needs its own follow-up (a new keyed-by-username table, matching
//     legacy's councilPlannerKey pattern), not a retrofit of this one.
// See apps/finance/README.md's changelog entry for this same list in prose form.
import { COMPENSATION_LIVE_ALLOWED_ROLES, filterCompensationWorkersForViewer } from './compensation-report-service.js';

export const COMPENSATION_PLAN_WRITE_FLAG_KEY = 'compensation_plan_write_enabled';
export const COMPENSATION_PLAN_COMP_METHODS = Object.freeze(['cola', 'custom', 'scale', 'worksheet']);

// Per-worker analogue of legacy's COUNCIL_EDITABLE_FIELDS (api-finance.js) -- the raise METHOD a
// council viewer may steer, never a seed fact (name/role/salary/benefits/notes) and never whether
// a worker is hidden from council in the first place.
export const COUNCIL_EDITABLE_WORKER_FIELDS = Object.freeze(['compMethod', 'adjustmentPct']);

// Exported so compensation-council-draft-service.js's private per-worker override map (keyed by
// this SAME worker_key, never a roster index) can validate against the identical pattern rather
// than risking drift from a re-declared copy.
export const WORKER_KEY_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_ROWS_PER_SAVE = 200;

// Checked FIRST by the route, before any role check -- an environment with the flag off answers
// "not yet enabled" to every caller alike, verified role or not, so turning this module on can
// never be confused with a role-gating decision. env is optional and only ever grants access
// (COMPENSATION_PLAN_WRITE_ENABLED === '1'); the finance_settings row is authoritative otherwise
// and defaults closed (missing row, or any value other than the literal string '1', is disabled).
export async function isCompensationPlanWriteEnabled(env, db) {
  if (env && env.COMPENSATION_PLAN_WRITE_ENABLED === '1') return true;
  const row = await db.prepare('SELECT value FROM finance_settings WHERE key=?').bind(COMPENSATION_PLAN_WRITE_FLAG_KEY).first();
  return !!row && row.value === '1';
}

function mapWorkerPlanRow(row) {
  return {
    fiscalYear: row.fiscal_year,
    workerKey: row.worker_key,
    name: row.name,
    roleLabel: row.role_label,
    salaryCents: row.salary_cents,
    benefitsCents: row.benefits_cents,
    compMethod: row.comp_method,
    adjustmentPct: row.adjustment_pct,
    hideFromCouncil: !!row.hide_from_council,
    notes: row.notes,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    updatedByRole: row.updated_by_role,
  };
}

// Read-back for this table, filtered through the SAME viewer gate as the live roster read side
// (filterCompensationWorkersForViewer, imported -- never re-implemented). Not currently wired to
// its own HTTP route (this pass is scoped to the write path); exported for direct use by callers
// and tests, and as the natural next step once a read route is wanted.
export async function readCompensationWorkerPlan(db, fiscalYear, viewerRole) {
  if (!Number.isInteger(fiscalYear)) throw new Error('fiscalYear must be an integer');
  const { results } = await db.prepare(
    'SELECT * FROM finance_compensation_worker_plan WHERE fiscal_year=? ORDER BY name'
  ).bind(fiscalYear).all();
  const rows = (results || []).map(mapWorkerPlanRow);
  return filterCompensationWorkersForViewer(rows, viewerRole);
}

function validateFullWorkerRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return 'row must be an object';
  if (typeof row.workerKey !== 'string' || !WORKER_KEY_PATTERN.test(row.workerKey)) return 'workerKey must be a short alphanumeric/underscore/hyphen identifier (max 64 chars)';
  if (typeof row.name !== 'string' || !row.name.trim()) return 'name is required';
  if (row.roleLabel !== undefined && typeof row.roleLabel !== 'string') return 'roleLabel must be a string';
  if (!Number.isInteger(row.salaryCents) || row.salaryCents < 0) return 'salaryCents must be a non-negative integer';
  if (!Number.isInteger(row.benefitsCents) || row.benefitsCents < 0) return 'benefitsCents must be a non-negative integer';
  if (!COMPENSATION_PLAN_COMP_METHODS.includes(row.compMethod)) return `compMethod must be one of ${COMPENSATION_PLAN_COMP_METHODS.join(', ')}`;
  if (typeof row.adjustmentPct !== 'number' || !Number.isFinite(row.adjustmentPct)) return 'adjustmentPct must be a finite number';
  if (row.hideFromCouncil !== undefined && typeof row.hideFromCouncil !== 'boolean') return 'hideFromCouncil must be a boolean';
  if (row.notes !== undefined && typeof row.notes !== 'string') return 'notes must be a string';
  return null;
}

function validateCouncilPatch(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return 'row must be an object';
  if (typeof row.workerKey !== 'string' || !WORKER_KEY_PATTERN.test(row.workerKey)) return 'workerKey must be a short alphanumeric/underscore/hyphen identifier (max 64 chars)';
  if (row.compMethod !== undefined && !COMPENSATION_PLAN_COMP_METHODS.includes(row.compMethod)) return `compMethod must be one of ${COMPENSATION_PLAN_COMP_METHODS.join(', ')}`;
  if (row.adjustmentPct !== undefined && (typeof row.adjustmentPct !== 'number' || !Number.isFinite(row.adjustmentPct))) return 'adjustmentPct must be a finite number';
  return null;
}

function err(message, status = 400) {
  return { error: message, status };
}

// The single write entry point -- role gating reuses COMPENSATION_LIVE_ALLOWED_ROLES from
// compensation-report-service.js (the exact same admin/council/compensation set the live READ
// side already restricts to), never a locally re-declared list, so the two can never drift apart.
//
// `rows` for admin/compensation is a full seed-fact upsert (create-or-update, matching legacy's
// whole-roster-replace semantics for that write); for council it is a narrow patch of
// COUNCIL_EDITABLE_WORKER_FIELDS on rows that already exist and are not hideFromCouncil. Nothing is
// written to the database until every row in the request has validated -- one bad or disallowed
// row fails the entire save rather than partially applying it.
export async function applyCompensationWorkerPlanWrite(db, { fiscalYear, role, updatedBy, rows }) {
  if (!COMPENSATION_LIVE_ALLOWED_ROLES.includes(role)) {
    return err('Access denied: editing the Compensation Planner requires admin, council, or compensation access', 403);
  }
  if (!Number.isInteger(fiscalYear)) return err('fiscalYear must be an integer');
  if (!Array.isArray(rows) || rows.length === 0) return err('rows must be a non-empty array');
  if (rows.length > MAX_ROWS_PER_SAVE) return err(`too many rows in one save (max ${MAX_ROWS_PER_SAVE})`);

  const seenKeys = new Set();
  for (const row of rows) {
    if (row && typeof row.workerKey === 'string') {
      if (seenKeys.has(row.workerKey)) return err(`duplicate workerKey in request: ${row.workerKey}`);
      seenKeys.add(row.workerKey);
    }
  }

  const { results: existingRows } = await db.prepare(
    'SELECT worker_key, hide_from_council FROM finance_compensation_worker_plan WHERE fiscal_year=?'
  ).bind(fiscalYear).all();
  const existingByKey = new Map((existingRows || []).map((r) => [r.worker_key, r]));

  const ops = [];
  for (const row of rows) {
    if (role === 'council') {
      const existing = existingByKey.get(row && row.workerKey);
      // Deliberately the SAME generic denial whether the worker_key does not exist at all or
      // exists but is flagged hidden -- matching filterCompensationWorkersForViewer's own
      // drop-entirely (never merely disabled) behavior on the read side, so a council session can
      // never tell "no such worker" apart from "a worker you're not allowed to see."
      if (!existing || existing.hide_from_council) {
        return err('Access denied: you may not edit this worker row', 403);
      }
      const validationError = validateCouncilPatch(row);
      if (validationError) return err(validationError);
      ops.push(db.prepare(
        `UPDATE finance_compensation_worker_plan
         SET comp_method = COALESCE(?, comp_method), adjustment_pct = COALESCE(?, adjustment_pct),
             updated_at = datetime('now'), updated_by = ?, updated_by_role = ?
         WHERE fiscal_year = ? AND worker_key = ?`
      ).bind(
        row.compMethod !== undefined ? row.compMethod : null,
        row.adjustmentPct !== undefined ? row.adjustmentPct : null,
        updatedBy || '', role, fiscalYear, row.workerKey,
      ));
      continue;
    }

    // admin / compensation: full seed-fact create-or-update.
    const validationError = validateFullWorkerRow(row);
    if (validationError) return err(validationError);
    ops.push(db.prepare(
      `INSERT INTO finance_compensation_worker_plan
         (fiscal_year, worker_key, name, role_label, salary_cents, benefits_cents, comp_method, adjustment_pct, hide_from_council, notes, updated_at, updated_by, updated_by_role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)
       ON CONFLICT(fiscal_year, worker_key) DO UPDATE SET
         name = excluded.name, role_label = excluded.role_label, salary_cents = excluded.salary_cents,
         benefits_cents = excluded.benefits_cents, comp_method = excluded.comp_method,
         adjustment_pct = excluded.adjustment_pct, hide_from_council = excluded.hide_from_council,
         notes = excluded.notes, updated_at = datetime('now'), updated_by = excluded.updated_by,
         updated_by_role = excluded.updated_by_role`
    ).bind(
      fiscalYear, row.workerKey, row.name, row.roleLabel || '', row.salaryCents, row.benefitsCents,
      row.compMethod, row.adjustmentPct, row.hideFromCouncil ? 1 : 0, row.notes || '',
      updatedBy || '', role,
    ));
  }

  await db.batch(ops);
  return { ok: true, saved: ops.length };
}
