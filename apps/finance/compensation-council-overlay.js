// ── Council raise-plan overlay: Finance's own writer ────────────────────────────────────────
// Andrew, 2026-09-25: council edits get their own writer in Finance. A council member's private
// what-if lives where it always has -- the finance_settings row
// `finance_salary_planner_council_<username>` -- which the September storage cutover already moved
// into Finance's own database (timothy-finance-db, bound here as FINANCE_DB). This module writes
// that same row directly, with the same rules as legacy applySalaryPlannerWrite's council branch
// (src/api-finance.js): only COUNCIL_EDITABLE_FIELDS are kept, the whole overlay is replaced, and
// the key is the council member's own Connect username, so one member never touches another's
// draft. Connect's council write paths are retired alongside this, leaving one writer.
//
// Reads still come from Connect's finance-compensation-plan-v1 contract, whose
// resolveSalaryPlannerState lays this same overlay over the shared roster, so existing drafts
// carry over without any migration.

export const COUNCIL_EDITABLE_FIELDS = ['compMethod', 'compPerWorkerMethod', 'compCustomPct', 'compScalePct', 'compBaselineRosterOnly'];
// Legacy FIN_COMP_METHODS (src/frontend/js-finance.js).
export const COUNCIL_COMP_METHODS = ['none', 'worksheet', 'scalepct', 'cola', 'custom'];
export const COUNCIL_COMP_METHOD_LABELS = {
  none: 'No raise', worksheet: 'District Scale', scalepct: '% of District Scale', cola: 'Social Security COLA', custom: 'Custom %',
};

// Identical to legacy councilPlannerKey (src/api-finance.js) -- the two must never disagree, or a
// member's Finance edits and their existing draft would land in different rows.
export function councilPlannerKey(username) {
  return 'finance_salary_planner_council_' + String(username || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function percentField(form, name) {
  const raw = String(form.get(name) ?? '').trim();
  if (raw === '') return { value: undefined };
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) return { error: `${name === 'comp_custom_pct' ? 'Custom raise' : 'Share of District Scale'} must be between 0 and 100` };
  return { value };
}

// Builds the overlay from the council editor form. `visibleWorkerCount` is the length of the roster
// council sees (hideFromCouncil rows already removed), which is what per-worker indexes refer to --
// the same index space legacy uses, so Connect's reindexing reads these back correctly.
export function buildCouncilOverlayFromForm(form, visibleWorkerCount) {
  const compMethod = String(form.get('comp_method') || '');
  if (!COUNCIL_COMP_METHODS.includes(compMethod)) return { error: 'Choose a raise method' };
  const custom = percentField(form, 'comp_custom_pct');
  if (custom.error) return { error: custom.error };
  const scale = percentField(form, 'comp_scale_pct');
  if (scale.error) return { error: scale.error };
  const perWorker = {};
  for (let i = 0; i < visibleWorkerCount; i += 1) {
    const method = String(form.get(`worker_method_${i}`) || '');
    if (method === '' || method === 'default') continue;
    if (!COUNCIL_COMP_METHODS.includes(method)) return { error: 'Unknown raise method for a staff member' };
    perWorker[i] = method;
  }
  const overlay = { compMethod, compPerWorkerMethod: perWorker, compBaselineRosterOnly: form.get('comp_baseline_roster_only') === '1' };
  if (custom.value !== undefined) overlay.compCustomPct = custom.value;
  if (scale.value !== undefined) overlay.compScalePct = scale.value;
  return { overlay };
}

export async function saveCouncilOverlay(db, username, overlay) {
  if (!db) return { ok: false, status: 503, error: 'Finance database is not available' };
  if (!username) return { ok: false, status: 403, error: 'Access denied: this account has no username to save under' };
  const kept = {};
  for (const field of COUNCIL_EDITABLE_FIELDS) if (overlay && overlay[field] !== undefined) kept[field] = overlay[field];
  await db.prepare(
    'INSERT INTO finance_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  ).bind(councilPlannerKey(username), JSON.stringify(kept)).run();
  return { ok: true };
}
