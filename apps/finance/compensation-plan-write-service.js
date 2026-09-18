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
// What is STILL NOT covered here (a real, deliberate gap, not an oversight):
//   - This table's own admin/compensation write path (applyCompensationWorkerPlanWrite) is
//     UNCHANGED by the two additions below: a council save through it still writes directly into
//     the ONE shared finance_compensation_worker_plan table (restricted to comp_method/
//     adjustment_pct on rows they may see) exactly as before -- two council users editing the same
//     fiscal year through THAT function can still see and overwrite each other's choice on the
//     shared row. That function is already shipped and already tested
//     (test/finance-compensation-plan-write-service.test.js's "council isolation" suite), so this
//     pass deliberately did not retrofit it -- see the prior version of this comment, which invited
//     exactly this: "a new keyed-by-username table ... not a retrofit of this one."
//
// ── September 18, 2026: two of the three named gaps above are now closed, ADDITIVELY ───────────
// (migration 0009_finance_compensation_plan_options.sql):
//   - `override_cents` on finance_compensation_worker_plan is legacy's hand-typed compOverrides --
//     an admin/compensation-only per-worker dollar override, validated and persisted by
//     applyCompensationWorkerPlanWrite's existing full-seed-fact branch (never council-editable,
//     matching legacy's COUNCIL_EDITABLE_FIELDS exactly -- council's UPDATE statement still only
//     ever SETs comp_method/adjustment_pct).
//   - `finance_compensation_plan_options` is legacy's GLOBAL compCustomPct/compScalePct/
//     compBaselineRosterOnly raise-plan calculation assumptions, admin/compensation only, ONE
//     shared row per fiscal year -- same "no separate compensation-role fork" simplification this
//     file already applies to the worker-plan table itself.
//   - `finance_compensation_council_draft` is legacy's private per-council-member overlay fork
//     (finance_salary_planner_council_<username>), added as a genuinely NEW, separate, additive
//     table/capability -- applyCompensationCouncilDraftWrite/readCompensationCouncilDraft/
//     mergeCouncilDraftIntoRoster below -- exactly the follow-up the prior version of this comment
//     invited, NOT a change to applyCompensationWorkerPlanWrite's own council branch (see above).
//     It lets one council member save their own roster-wide raise-plan settings and per-worker
//     raise method/percentage as a private draft that never lands on the shared plan and can never
//     collide with another council member's draft -- keyed by councilDraftKey(updatedBy), the same
//     sanitize-and-lowercase shape as legacy's councilPlannerKey(username), using the same
//     display-only/unverified identity string (see shell.js's approverEmailFromJwt precedent,
//     already used for this exact write path's `updatedBy` audit column) as the per-user key.
//     Whole-draft REPLACE semantics on every save (not a field-by-field merge with the PREVIOUS
//     draft) -- a field omitted from a save is simply not overridden this time, matching legacy's
//     own real behavior exactly (see api-finance.js's PUT handler: `const overlay = {}; for (const
//     f of COUNCIL_EDITABLE_FIELDS) if (b[f] !== undefined) overlay[f] = b[f];` builds a fresh
//     object from THIS request only, then replaces the whole stored blob -- it does not read the
//     previous overlay first). A read-side HTTP route to fetch a council member's own draft back is
//     not yet wired (same precedent as readCompensationWorkerPlan's own "not currently wired to its
//     own HTTP route" disclosure above) -- mergeCouncilDraftIntoRoster exists and is tested for the
//     day a route wants it.
// See apps/finance/README.md's changelog entry for this same list in prose form.
import { COMPENSATION_LIVE_ALLOWED_ROLES, filterCompensationWorkersForViewer } from './compensation-report-service.js';

export const COMPENSATION_PLAN_WRITE_FLAG_KEY = 'compensation_plan_write_enabled';
export const COMPENSATION_PLAN_COMP_METHODS = Object.freeze(['cola', 'custom', 'scale', 'worksheet']);

// Per-worker analogue of legacy's COUNCIL_EDITABLE_FIELDS (api-finance.js) -- the raise METHOD a
// council viewer may steer, never a seed fact (name/role/salary/benefits/notes) and never whether
// a worker is hidden from council in the first place.
export const COUNCIL_EDITABLE_WORKER_FIELDS = Object.freeze(['compMethod', 'adjustmentPct']);

const WORKER_KEY_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
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
    // Legacy's compOverrides -- a hand-typed dollar figure that overrides whatever comp_method
    // would otherwise compute for this worker. null means "no override," matching legacy's own
    // semantics (see migrations/0009_finance_compensation_plan_options.sql's header comment).
    overrideCents: row.override_cents == null ? null : row.override_cents,
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
  // Legacy's compOverrides (a hand-typed dollar figure) -- admin/compensation only, same as every
  // other field validated here; council never reaches this validator (see validateCouncilPatch).
  if (row.overrideCents !== undefined && row.overrideCents !== null && !Number.isInteger(row.overrideCents)) {
    return 'overrideCents must be an integer number of cents, or null to clear it';
  }
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
         (fiscal_year, worker_key, name, role_label, salary_cents, benefits_cents, comp_method, adjustment_pct, override_cents, hide_from_council, notes, updated_at, updated_by, updated_by_role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)
       ON CONFLICT(fiscal_year, worker_key) DO UPDATE SET
         name = excluded.name, role_label = excluded.role_label, salary_cents = excluded.salary_cents,
         benefits_cents = excluded.benefits_cents, comp_method = excluded.comp_method,
         adjustment_pct = excluded.adjustment_pct, override_cents = excluded.override_cents,
         hide_from_council = excluded.hide_from_council,
         notes = excluded.notes, updated_at = datetime('now'), updated_by = excluded.updated_by,
         updated_by_role = excluded.updated_by_role`
    ).bind(
      fiscalYear, row.workerKey, row.name, row.roleLabel || '', row.salaryCents, row.benefitsCents,
      row.compMethod, row.adjustmentPct, row.overrideCents === undefined ? null : row.overrideCents,
      row.hideFromCouncil ? 1 : 0, row.notes || '',
      updatedBy || '', role,
    ));
  }

  await db.batch(ops);
  return { ok: true, saved: ops.length };
}

// ── Global raise-plan calculation options (legacy's compCustomPct/compScalePct/
// compBaselineRosterOnly) — admin/compensation only, ONE shared row per fiscal year. Council never
// reaches this function; see applyCompensationCouncilDraftWrite below for council's own private
// equivalent of these same three fields.
function validateGlobalPlanOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return 'options must be an object';
  if (options.compCustomPct !== undefined && options.compCustomPct !== null && (typeof options.compCustomPct !== 'number' || !Number.isFinite(options.compCustomPct))) {
    return 'compCustomPct must be a finite number or null';
  }
  if (options.compScalePct !== undefined && options.compScalePct !== null && (typeof options.compScalePct !== 'number' || !Number.isFinite(options.compScalePct))) {
    return 'compScalePct must be a finite number or null';
  }
  if (options.compBaselineRosterOnly !== undefined && typeof options.compBaselineRosterOnly !== 'boolean') {
    return 'compBaselineRosterOnly must be a boolean';
  }
  return null;
}

function mapPlanOptionsRow(row) {
  if (!row) return null;
  return {
    fiscalYear: row.fiscal_year,
    compCustomPct: row.comp_custom_pct,
    compScalePct: row.comp_scale_pct,
    compBaselineRosterOnly: !!row.comp_baseline_roster_only,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    updatedByRole: row.updated_by_role,
  };
}

// Whole-row replace on every save (legacy's own SALARY_PLANNER_KEY blob is likewise replaced
// wholesale, not merged field-by-field, on every PUT) -- a field left out of `options` is stored as
// null/false, not "keep the previous value." Council is deliberately refused here (403, not a
// silent no-op) and pointed at its own private draft mechanism instead, matching legacy's real
// fork: council never touches the shared SALARY_PLANNER_KEY blob these fields live in.
export async function applyCompensationPlanOptionsWrite(db, { fiscalYear, role, updatedBy, options }) {
  if (!COMPENSATION_LIVE_ALLOWED_ROLES.includes(role)) {
    return err('Access denied: editing the Compensation Planner requires admin, council, or compensation access', 403);
  }
  if (role === 'council') {
    return err('Council may not edit the shared raise-plan options -- save a personal draft instead', 403);
  }
  if (!Number.isInteger(fiscalYear)) return err('fiscalYear must be an integer');
  const validationError = validateGlobalPlanOptions(options);
  if (validationError) return err(validationError);
  await db.prepare(
    `INSERT INTO finance_compensation_plan_options
       (fiscal_year, comp_custom_pct, comp_scale_pct, comp_baseline_roster_only, updated_at, updated_by, updated_by_role)
     VALUES (?, ?, ?, ?, datetime('now'), ?, ?)
     ON CONFLICT(fiscal_year) DO UPDATE SET
       comp_custom_pct = excluded.comp_custom_pct, comp_scale_pct = excluded.comp_scale_pct,
       comp_baseline_roster_only = excluded.comp_baseline_roster_only, updated_at = datetime('now'),
       updated_by = excluded.updated_by, updated_by_role = excluded.updated_by_role`
  ).bind(
    fiscalYear, options.compCustomPct ?? null, options.compScalePct ?? null,
    options.compBaselineRosterOnly ? 1 : 0, updatedBy || '', role,
  ).run();
  return { ok: true };
}

export async function readCompensationPlanOptions(db, fiscalYear) {
  if (!Number.isInteger(fiscalYear)) throw new Error('fiscalYear must be an integer');
  const row = await db.prepare('SELECT * FROM finance_compensation_plan_options WHERE fiscal_year=?').bind(fiscalYear).first();
  return mapPlanOptionsRow(row);
}

// ── Private per-council-member draft (legacy's finance_salary_planner_council_<username> overlay)
// — genuinely new, additive capability; see this module's header comment for why it does not
// change applyCompensationWorkerPlanWrite's own (already shipped, already tested) council branch.
export function councilDraftKey(identity) {
  return String(identity || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function validateWorkerOverridesMap(map) {
  if (map === undefined) return null;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return 'workerOverrides must be an object keyed by workerKey';
  for (const [workerKey, patch] of Object.entries(map)) {
    if (!WORKER_KEY_PATTERN.test(workerKey)) return `invalid workerKey in workerOverrides: ${workerKey}`;
    const patchError = validateCouncilPatch({ workerKey, ...patch });
    if (patchError) return `workerOverrides.${workerKey}: ${patchError}`;
  }
  return null;
}

// Same admin/council/compensation gate as every other write in this file, but only `council`
// actually has a private draft in legacy -- admin/compensation write the real plan directly via
// applyCompensationPlanOptionsWrite/applyCompensationWorkerPlanWrite above, so this function refuses
// them the same deliberate way applyCompensationPlanOptionsWrite refuses council.
export async function applyCompensationCouncilDraftWrite(db, { fiscalYear, role, updatedBy, options, workerOverrides }) {
  if (!COMPENSATION_LIVE_ALLOWED_ROLES.includes(role)) {
    return err('Access denied: editing the Compensation Planner requires admin, council, or compensation access', 403);
  }
  if (role !== 'council') {
    return err('Only council has a private raise-plan draft -- admin/compensation edit the shared plan directly', 403);
  }
  if (!updatedBy) return err('Access denied: this account has no identity to save a draft under', 403);
  if (!Number.isInteger(fiscalYear)) return err('fiscalYear must be an integer');
  const opts = options || {};
  const optionsError = validateGlobalPlanOptions(opts);
  if (optionsError) return err(optionsError);
  const overridesError = validateWorkerOverridesMap(workerOverrides);
  if (overridesError) return err(overridesError);

  const key = councilDraftKey(updatedBy);
  if (!key) return err('Access denied: this account has no identity to save a draft under', 403);
  await db.prepare(
    `INSERT INTO finance_compensation_council_draft
       (fiscal_year, council_key, comp_custom_pct, comp_scale_pct, comp_baseline_roster_only, worker_overrides, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT(fiscal_year, council_key) DO UPDATE SET
       comp_custom_pct = excluded.comp_custom_pct, comp_scale_pct = excluded.comp_scale_pct,
       comp_baseline_roster_only = excluded.comp_baseline_roster_only,
       worker_overrides = excluded.worker_overrides, updated_at = datetime('now'), updated_by = excluded.updated_by`
  ).bind(
    fiscalYear, key, opts.compCustomPct ?? null, opts.compScalePct ?? null,
    opts.compBaselineRosterOnly === undefined ? null : (opts.compBaselineRosterOnly ? 1 : 0),
    JSON.stringify(workerOverrides || {}), updatedBy,
  ).run();
  return { ok: true };
}

function mapCouncilDraftRow(row) {
  if (!row) return null;
  let workerOverrides = {};
  try { workerOverrides = JSON.parse(row.worker_overrides) || {}; } catch { workerOverrides = {}; }
  return {
    fiscalYear: row.fiscal_year,
    compCustomPct: row.comp_custom_pct,
    compScalePct: row.comp_scale_pct,
    compBaselineRosterOnly: row.comp_baseline_roster_only == null ? null : !!row.comp_baseline_roster_only,
    workerOverrides,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

// Not currently wired to its own HTTP route -- same disclosed status as readCompensationWorkerPlan
// above. `identity` is the same unverified display-only string applyCompensationCouncilDraftWrite
// was called with (or an already-derived councilDraftKey -- this hashes idempotently either way).
export async function readCompensationCouncilDraft(db, fiscalYear, identity) {
  if (!Number.isInteger(fiscalYear)) throw new Error('fiscalYear must be an integer');
  const key = councilDraftKey(identity);
  if (!key) return null;
  const row = await db.prepare(
    'SELECT * FROM finance_compensation_council_draft WHERE fiscal_year=? AND council_key=?'
  ).bind(fiscalYear, key).first();
  return mapCouncilDraftRow(row);
}

// Pure merge: overlays a council member's own saved draft (global options + per-worker
// compMethod/adjustmentPct) onto an already-filtered roster (e.g. from readCompensationWorkerPlan)
// -- mirrors legacy's GET-side merge exactly (only the fields the draft actually carries are
// applied; a worker not mentioned in the draft, or a draft field left unset, keeps the base
// value). Never touches hideFromCouncil, seed facts, or any worker not already present in `rows` --
// a draft can only steer what the viewer could already see, never add a phantom worker.
export function mergeCouncilDraftIntoRoster(rows, draft) {
  if (!draft) return { rows, planOptions: null };
  const overrides = draft.workerOverrides || {};
  const mergedRows = rows.map((w) => {
    const patch = overrides[w.workerKey];
    if (!patch) return w;
    return {
      ...w,
      compMethod: patch.compMethod !== undefined ? patch.compMethod : w.compMethod,
      adjustmentPct: patch.adjustmentPct !== undefined ? patch.adjustmentPct : w.adjustmentPct,
    };
  });
  const planOptions = {
    compCustomPct: draft.compCustomPct,
    compScalePct: draft.compScalePct,
    compBaselineRosterOnly: draft.compBaselineRosterOnly,
  };
  return { rows: mergedRows, planOptions };
}
