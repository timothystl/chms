// ── Compensation Planner settings forms ──────────────────────────────────────────────────────
// The rest of legacy's Salary Planner editing surface (src/frontend/js-finance.js), for the
// admin/compensation roles that edit the shared plan: raise methods (plan-wide and per worker,
// with hand-set figures), each year's reference figures, the health plan quote, and each worker's
// Concordia Plans market ranges. Every function here takes the CURRENT full plan fetched from
// Connect and returns a new full plan with one form's changes applied; shell.js resubmits it through
// the same compensation-plan-write-v1 relay the roster editor uses, so nothing else in the plan is
// lost. Stored shapes match legacy exactly: percentages as fractions, money as cents, per-worker
// maps keyed by roster index, overrides as the typed dollar string.
import { COMP_METHOD_KEYS, FIN_COMP_PLAN_KEYS, FIN_CONCORDIA_RANGE_KEYS } from './compensation-projection.js';
import { FIN_HEALTH_TIERS } from './compensation-calc.js';

export const REFERENCE_PCT_FIELDS = ['pensionPct', 'ficaPct', 'disabilityDepsPct', 'disabilityNoDepsPct', 'ssaColaPct'];
export const REFERENCE_MONEY_FIELDS = ['baseSalaryCents', 'healthOptOutCents'];
export const REFERENCE_TEXT_FIELDS = ['districtSource', 'concordiaSource', 'quoteSource'];
export const QUOTE_MONEY_FIELDS = ['dentalCents', 'visionCents', 'deductibleIndividualCents', 'deductibleFamilyCents', 'oopMaxIndividualCents', 'oopMaxFamilyCents'];
export const HEALTH_TIER_CHOICES = ['self', 'selfSpouse', 'selfChild', 'family', 'optout'];

function isObject(value) { return value != null && typeof value === 'object' && !Array.isArray(value); }
function text(form, name) {
  const v = form.get(name);
  return v == null ? '' : String(v).trim();
}
// Legacy finSanitizeDecimalInput + parseFloat: '' or anything unparseable is "not entered".
function decimal(raw) {
  const cleaned = String(raw == null ? '' : raw).replace(/[^0-9.\-]/g, '');
  if (cleaned === '') return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}
const toCents = (dollars) => Math.round(dollars * 100);

export class PlanFormError extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

function rosterOf(plan) { return Array.isArray(plan.roster) ? plan.roster : []; }

// Raise methods (legacy step 1's method chips and per-worker cells). "Apply to everyone" is legacy
// finCompApplyMethodToAll: it clears every per-worker choice and hand-set figure.
export function applyRaiseMethodsForm(current, form) {
  const plan = { ...current };
  const method = text(form, 'comp_method');
  if (!COMP_METHOD_KEYS.includes(method)) throw new PlanFormError('invalid_method');
  plan.compMethod = method;
  const custom = decimal(form.get('comp_custom_pct'));
  if (custom != null) plan.compCustomPct = custom;
  const scale = decimal(form.get('comp_scale_pct'));
  if (scale != null) plan.compScalePct = scale;
  plan.compBaselineRosterOnly = form.get('comp_baseline_roster_only') === '1';
  const basis = text(form, 'comp_base_year_basis');
  if (basis === 'roster' || basis === 'ledger') plan.compBaseYearBasis = basis;

  if (form.get('apply_to_all') === '1') {
    plan.compPerWorkerMethod = {};
    plan.compOverrides = {};
    return plan;
  }
  const perWorker = isObject(current.compPerWorkerMethod) ? { ...current.compPerWorkerMethod } : {};
  const overrides = isObject(current.compOverrides) ? { ...current.compOverrides } : {};
  rosterOf(current).forEach((_, i) => {
    if (form.has(`worker_method_${i}`)) {
      const m = text(form, `worker_method_${i}`);
      if (m === 'default' || m === '') delete perWorker[i];
      else if (COMP_METHOD_KEYS.includes(m)) perWorker[i] = m;
      else throw new PlanFormError('invalid_method');
    }
    if (form.has(`worker_override_${i}`)) {
      const n = decimal(form.get(`worker_override_${i}`));
      if (n == null || n < 0) delete overrides[i];
      else overrides[i] = String(n);
    }
  });
  plan.compPerWorkerMethod = perWorker;
  plan.compOverrides = overrides;
  return plan;
}

export function referenceYearFromForm(form) {
  const year = Number(text(form, 'ref_year'));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new PlanFormError('invalid_year');
  return year;
}

// One year's reference figures (legacy finCompRefChange / finCompRefTextChange). A blank box
// removes that figure, so the year falls back to the latest earlier entered year, then the code
// constant -- exactly how legacy resolves it.
export function applyReferenceForm(current, form) {
  const year = referenceYearFromForm(form);
  const plan = { ...current };
  const byYear = isObject(current.referenceByYear) ? { ...current.referenceByYear } : {};
  const row = isObject(byYear[year]) ? { ...byYear[year] } : {};
  for (const field of REFERENCE_PCT_FIELDS) {
    if (!form.has(field)) continue;
    const n = decimal(form.get(field));
    if (n == null) delete row[field]; else row[field] = Math.round((n / 100) * 1e10) / 1e10;
  }
  for (const field of REFERENCE_MONEY_FIELDS) {
    if (!form.has(field)) continue;
    const n = decimal(form.get(field));
    if (n == null) delete row[field]; else row[field] = toCents(n);
  }
  for (const field of REFERENCE_TEXT_FIELDS) {
    if (!form.has(field)) continue;
    const v = text(form, field);
    if (v === '') delete row[field]; else row[field] = v;
  }
  if (Object.keys(row).length) byYear[year] = row; else delete byYear[year];
  plan.referenceByYear = byYear;
  return plan;
}

// The health plan quote (legacy finCompQuoteChange / finCompTierRateChange / finCompPickPlan /
// finCompFamilySizeChange). Monthly tier rates and annual group figures are typed in dollars; a
// blank box falls back to the quote shipped with the app. Changing a tier rate drops any old flat
// medicalCents override for that option, as legacy does, so the typed rates take effect.
export function applyHealthQuoteForm(current, form) {
  const plan = { ...current };
  const overrides = isObject(current.healthPlanPremiumOverrides) ? { ...current.healthPlanPremiumOverrides } : {};
  for (const key of FIN_COMP_PLAN_KEYS) {
    const row = isObject(overrides[key]) ? { ...overrides[key] } : {};
    const tiers = isObject(row.tiersMonthlyCents) ? { ...row.tiersMonthlyCents } : {};
    let tierChanged = false;
    for (const tier of FIN_HEALTH_TIERS) {
      const name = `tier_${key}_${tier.key}`;
      if (!form.has(name)) continue;
      const n = decimal(form.get(name));
      const next = n == null ? undefined : toCents(n);
      if (next !== tiers[tier.key]) tierChanged = true;
      if (next === undefined) delete tiers[tier.key]; else tiers[tier.key] = next;
    }
    if (Object.keys(tiers).length) row.tiersMonthlyCents = tiers; else delete row.tiersMonthlyCents;
    if (tierChanged) delete row.medicalCents;
    for (const field of QUOTE_MONEY_FIELDS) {
      const name = `quote_${key}_${field}`;
      if (!form.has(name)) continue;
      const n = decimal(form.get(name));
      if (n == null) delete row[field]; else row[field] = toCents(n);
    }
    if (Object.keys(row).length) overrides[key] = row; else delete overrides[key];
  }
  plan.healthPlanPremiumOverrides = overrides;
  const option = text(form, 'health_plan_option');
  if (option) {
    if (!FIN_COMP_PLAN_KEYS.includes(option)) throw new PlanFormError('invalid_plan_option');
    plan.healthPlanOption = option;
  }
  const family = decimal(form.get('health_family_size'));
  if (family != null) plan.healthFamilySize = Math.max(1, Math.floor(family));
  if (form.has('quoteSource')) {
    const year = referenceYearFromForm(form);
    const byYear = isObject(current.referenceByYear) ? { ...current.referenceByYear } : {};
    const row = isObject(byYear[year]) ? { ...byYear[year] } : {};
    const source = text(form, 'quoteSource');
    if (source) row.quoteSource = source; else delete row.quoteSource;
    if (Object.keys(row).length) byYear[year] = row; else delete byYear[year];
    plan.referenceByYear = byYear;
  }
  return plan;
}

// One worker's Concordia Plans Compensation Decision Support report (legacy finCompRangeChange).
// Stored as typed, since legacy keeps the figures exactly as copied off the PDF.
export function applyConcordiaRangesForm(current, form) {
  const index = Number(text(form, 'index'));
  const roster = [...rosterOf(current)];
  if (!Number.isInteger(index) || !isObject(roster[index])) throw new PlanFormError('invalid_index');
  const worker = { ...roster[index] };
  const concordia = isObject(worker.concordia) ? { ...worker.concordia } : {};
  const fields = ['position', 'asOfDate'];
  for (const r of FIN_CONCORDIA_RANGE_KEYS) fields.push(`${r.key}Low`, `${r.key}Mid`, `${r.key}High`);
  for (const field of fields) {
    if (!form.has(field)) continue;
    const v = text(form, field);
    if (v === '') delete concordia[field]; else concordia[field] = v;
  }
  worker.concordia = concordia;
  roster[index] = worker;
  return { ...current, roster };
}

// The per-worker fields legacy's drawer has beyond the roster basics: FTE, cash-only, externally
// funded, coverage tier and the two hand-set health figures. `w` is the worker being built by
// shell.js's workerFromForm (existing fields already spread in).
export function applyWorkerBenefitFields(w, form) {
  if (form.has('ftePct')) {
    const pct = decimal(form.get('ftePct'));
    w.ftePct = pct != null && pct > 0 ? Math.min(100, pct) : 100;
  }
  if (form.has('benefit_fields')) {
    w.cashOnly = form.get('cashOnly') === 'on';
    w.externallyFunded = form.get('externallyFunded') === 'on';
  }
  if (form.has('healthTier')) {
    const tier = text(form, 'healthTier');
    if (HEALTH_TIER_CHOICES.includes(tier)) {
      w.healthTier = tier;
      w.healthMode = tier === 'optout' ? 'optout' : tier === 'family' ? 'family' : 'employee';
      w.healthEnrolled = tier !== 'optout';
    } else if (w.healthTier != null) {
      // Back to automatic: drop the mode the explicit tier had set too, so enrollment and
      // dependents decide again. A worker who never had a tier keeps any older saved mode.
      delete w.healthTier;
      delete w.healthMode;
    }
  }
  for (const [name, field] of [['healthOptOutOverride', 'healthOptOutOverrideCents'], ['employeeOnlyPremium', 'employeeOnlyPremiumCents']]) {
    if (!form.has(name)) continue;
    const n = decimal(form.get(name));
    w[field] = n == null ? null : toCents(n);
  }
  return w;
}

// Where a settings save sends the viewer back to.
export function planFormReturnLocation(form, extra = {}) {
  const page = ['plan', 'rates', 'benchmarks', 'benefits', 'council'].includes(text(form, 'return_page')) ? text(form, 'return_page') : 'plan';
  const params = { section: 'compensation', page };
  const planYear = text(form, 'plan_year');
  if (/^\d{4}$/.test(planYear)) params.plan_year = planYear;
  const refYear = text(form, 'ref_year');
  if (page === 'rates' && /^\d{4}$/.test(refYear)) params.ref_year = refYear;
  return `/?${new URLSearchParams({ ...params, ...extra }).toString()}`;
}
