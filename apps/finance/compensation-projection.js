// ── Compensation raise projections ───────────────────────────────────────────────────────────
// Andrew, 2026-09-25: "port the council raise projections". This is the legacy Salary Planner's
// projection chain (src/frontend/js-finance.js: finCompComputeAll, finCompBenefits, the four
// raise methods, the base-year comparison, and the Council report helpers), moved to the server
// so Finance can show and print the same figures legacy's Council report did.
//
// The formulas are carried over line for line. What changed is only where state comes from: every
// legacy function read browser globals (_finSalaryRoster, _finComp*, _finPlanBaseTree, ...), so
// here they close over one explicit `model` built from Connect's saved plan
// (finance-compensation-plan-v1) and the base year's church ledger
// (connect.finance-church-report.v1). test/finance-compensation-projection.test.js runs the legacy
// bundle side by side and requires identical results.
//
// Deliberate differences from legacy, each a correction or a server-side necessity:
//   - councilRosterView() filters hideFromCouncil workers AND reindexes per-worker methods and
//     overrides (as Connect's resolveSalaryPlannerState does). Legacy's finCompWithCouncilRoster
//     filtered without reindexing, so an admin printing with a hidden worker moved later workers'
//     methods and overrides onto the wrong people.
//   - The base-year ledger tree is rebuilt from the contract's rows with legacy's own tree builder,
//     empty-leaf pruning and classification order. Revenue-side regrouping and on-screen account
//     renames are display-only in legacy and do not affect these figures, except that a renamed
//     account is matched here by its QuickBooks name.
//   - "Now" for annualizing an in-progress base year is Central time, where legacy used the
//     viewer's browser clock.
//   - FIN_CONCORDIA_SEED_BY_NAME is not applied (see compensation-calc.js's header); Concordia
//     ranges come only from what is saved on each roster row.
import {
  finLcmsBaseSalaryCents, finHealthOptOutCentsFor, finComputeLcmsSalary, finRoundSalaryCents,
  finConcordiaPensionRateFor, finConcordiaDisabilityRateFor, finHealthTierMonthlyCents,
  finHealthAncillaryPerContractCents, finComputeHealthPlanTotalCents, finCompPlanQuoteField,
  LCMS_EMPLOYER_FICA_RATE, SSA_COLA_REFERENCE_PCT, FIN_HEALTH_TIERS, HEALTH_PLAN_QUOTE_2027,
} from './compensation-calc.js';

export const COMP_METHOD_KEYS = ['none', 'worksheet', 'scalepct', 'cola', 'custom'];
export const FIN_COMP_PLAN_KEYS = ['renewal', 'option1', 'option2', 'option3'];
export const FIN_CONCORDIA_RANGE_KEYS = [
  { key: 'churchMarket', label: 'Church Market Range' },
  { key: 'churchLcms', label: 'Church LCMS Range' },
  { key: 'districtMarket', label: 'District Market Range' },
  { key: 'district', label: 'District Range' },
];
const FIN_REVENUE_CLASSES = { 'Income': true, 'Other Income': true };
const FIN_CHURCH_CLASS_ORDER = { 'Income': 0, 'Other Income': 1, 'Cost of Goods Sold': 2, 'Expenses': 3, 'Other Expenses': 4 };
// Legacy FIN_COMP_BASELINE_RE / FIN_COMP_POOLED_RE, verbatim (see their comments there).
const FIN_COMP_BASELINE_RE = /salar|payroll|compensation|wages|health|medical|dental|vision|disabilit|pension|retirement|\bfica\b|social security/i;
const FIN_COMP_POOLED_RE = /health|medical|dental|vision|disabilit|pension|retirement|\bfica\b|social security|tax/i;

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function isObject(value) { return value != null && typeof value === 'object' && !Array.isArray(value); }

// The saved plan as legacy's finLoadSalaryPlannerData + finCompMigrateSavedShape would leave it
// for `targetYear`: legacy defaults for anything unsaved, and the pre-redesign pension/disability/
// colaSource fields carried into the target year's reference figures.
export function normalizeCompensationPlan(saved, targetYear) {
  const s = isObject(saved) ? saved : {};
  const plan = {
    roster: Array.isArray(s.roster) ? clone(s.roster).filter(isObject) : [],
    healthPlanOption: s.healthPlanOption || 'renewal',
    referenceByYear: isObject(s.referenceByYear) ? clone(s.referenceByYear) : {},
    premiumOverrides: isObject(s.healthPlanPremiumOverrides) ? clone(s.healthPlanPremiumOverrides) : {},
    method: s.compMethod || 'cola',
    perWorkerMethod: isObject(s.compPerWorkerMethod) ? clone(s.compPerWorkerMethod) : {},
    overrides: isObject(s.compOverrides) ? clone(s.compOverrides) : {},
    customPct: s.compCustomPct != null ? s.compCustomPct : 3.5,
    scalePct: s.compScalePct != null ? s.compScalePct : 95,
    baselineRosterOnly: s.compBaselineRosterOnly != null ? !!s.compBaselineRosterOnly : false,
    baseYearBasis: s.compBaseYearBasis ? (s.compBaseYearBasis === 'ledger' ? 'ledger' : 'roster') : 'roster',
    basePlanOption: s.compBasePlanOption || 'current',
  };
  if (!plan.referenceByYear[targetYear]) plan.referenceByYear[targetYear] = {};
  const row = plan.referenceByYear[targetYear];
  if (s.pensionPct != null && row.pensionPct == null) row.pensionPct = s.pensionPct;
  if (s.disabilityPct != null && row.disabilityDepsPct == null) {
    row.disabilityDepsPct = s.disabilityPct;
    row.disabilityNoDepsPct = s.disabilityPct;
  }
  if (!s.compMethod && s.colaSource) {
    plan.method = s.colaSource === 'none' ? 'none' : s.colaSource === 'custom' ? 'custom' : 'cola';
    if (s.colaSource === 'custom' && s.colaPct != null && s.compCustomPct == null) plan.customPct = s.colaPct * 100;
  }
  return plan;
}

// What Council sees: hideFromCouncil workers removed, per-worker settings moved with their worker.
export function councilRosterView(plan) {
  const oldToNew = [];
  const roster = [];
  plan.roster.forEach((w, i) => {
    if (w && w.hideFromCouncil) return;
    oldToNew[i] = roster.length;
    roster.push(w);
  });
  const reindex = (obj) => {
    const out = {};
    for (const k of Object.keys(obj || {})) {
      const n = oldToNew[Number(k)];
      if (n !== undefined) out[n] = obj[k];
    }
    return out;
  };
  return { ...plan, roster, perWorkerMethod: reindex(plan.perWorkerMethod), overrides: reindex(plan.overrides) };
}

// Legacy finBuildTreeFromFlatRows, fed from connect.finance-church-report.v1 account rows, then the
// parts of finReorganizeChurchTree that can change a compensation figure: empty-leaf pruning under
// each classification root, recomputed totals, and classification order.
export function buildChurchAccountTree(accounts) {
  const rows = (accounts || []).map((a) => ({
    category_path: a.categoryPath, account_name: a.accountName, classification: a.classification,
    depth: a.depth, own_actual_cents: a.actualCents, own_budget_cents: a.budgetCents,
  }));
  const nodeByPath = {};
  const roots = [];
  rows.forEach((r) => {
    nodeByPath[r.category_path] = {
      path: r.category_path, label: r.account_name, classification: r.classification, depth: r.depth,
      ownActualCents: r.own_actual_cents || 0, ownBudgetCents: r.own_budget_cents,
      totalActualCents: 0, totalBudgetCents: 0, hasBudgetInfo: r.own_budget_cents != null, children: [],
    };
  });
  rows.forEach((r) => {
    const node = nodeByPath[r.category_path];
    const segments = r.category_path.split(':');
    let parent = null;
    for (let i = segments.length - 1; i > 0; i--) {
      const candidate = nodeByPath[segments.slice(0, i).join(':')];
      if (candidate) { parent = candidate; break; }
    }
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  const prune = (nodes) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      prune(n.children);
      if (n.children.length) continue;
      if (!n.totalActualCents && !n.totalBudgetCents) nodes.splice(i, 1);
    }
  };
  const recompute = (nodes) => {
    nodes.forEach((node) => {
      recompute(node.children);
      let totalActual = node.ownActualCents || 0;
      let totalBudget = node.ownBudgetCents || 0;
      let hasBudgetInfo = node.ownBudgetCents != null;
      node.children.forEach((c) => {
        totalActual += c.totalActualCents;
        totalBudget += c.totalBudgetCents;
        if (c.hasBudgetInfo) hasBudgetInfo = true;
      });
      node.totalActualCents = totalActual;
      node.totalBudgetCents = totalBudget;
      node.hasBudgetInfo = hasBudgetInfo;
    });
  };
  recompute(roots);
  roots.forEach((root) => prune(root.children));
  recompute(roots);
  roots.sort((a, b) => {
    const oa = FIN_CHURCH_CLASS_ORDER[a.classification]; const ob = FIN_CHURCH_CLASS_ORDER[b.classification];
    return (oa === undefined ? 9 : oa) - (ob === undefined ? 9 : ob);
  });
  return roots;
}

// Legacy finWeeksElapsedInYear, on the church's own calendar date.
export function weeksElapsedInYear(parts) {
  const calendarDay = Date.UTC(parts.year, parts.month - 1, parts.day);
  const yearStart = Date.UTC(parts.year, 0, 1);
  const daysElapsed = Math.floor((calendarDay - yearStart) / 86400000) + 1;
  return Math.min(52, Math.max(1, daysElapsed / 7));
}

export function centralDateParts(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(now).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  return { year: parts.year, month: parts.month, day: parts.day };
}

export function parseConcordiaMoneyCents(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

// The projection model. `plan` is normalizeCompensationPlan()'s result (optionally narrowed by
// councilRosterView); `baseTree` is buildChurchAccountTree() for the base year, or null when that
// ledger is unavailable (every worker's current pay then falls back exactly as legacy's did with
// no tree: a typed figure, else $0).
export function createCompensationModel({ plan, targetYear, baseYear = targetYear - 1, baseTree = null, now = new Date() }) {
  const roster = plan.roster;
  const ref = plan.referenceByYear || {};
  const premiumOverrides = plan.premiumOverrides || {};
  const selectedOption = plan.healthPlanOption;

  function enteredRef(field, year) {
    if (ref[year] && ref[year][field] != null) return { value: ref[year][field], sourceYear: Number(year), exact: true };
    const years = Object.keys(ref).map(Number).filter((y) => y <= year && ref[y] && ref[y][field] != null).sort((a, b) => a - b);
    if (!years.length) return null;
    const sy = years[years.length - 1];
    return { value: ref[sy][field], sourceYear: sy, exact: false };
  }
  const baseSalary = (year) => finLcmsBaseSalaryCents(year, 0, ref);
  function pensionRate(year) {
    const e = enteredRef('pensionPct', year);
    if (e) return { rate: e.value, sourceYear: e.sourceYear, exact: e.exact };
    return finConcordiaPensionRateFor(year);
  }
  function disabilityRate(year, hasDependents) {
    const e = enteredRef(hasDependents ? 'disabilityDepsPct' : 'disabilityNoDepsPct', year);
    if (e) return { rate: e.value, sourceYear: e.sourceYear, exact: e.exact };
    return finConcordiaDisabilityRateFor(year, hasDependents);
  }
  function ficaRate(year) {
    const e = enteredRef('ficaPct', year == null ? targetYear : year);
    return e ? e.value : LCMS_EMPLOYER_FICA_RATE;
  }
  function ssaRate(year) {
    const e = enteredRef('ssaColaPct', year == null ? targetYear : year);
    return e ? e.value : SSA_COLA_REFERENCE_PCT;
  }
  const optOutCents = (year) => finHealthOptOutCentsFor(year == null ? targetYear : year, ref);
  function sourceDoc(kind) {
    const e = enteredRef(kind, targetYear);
    if (e && e.value) return e.value;
    if (kind === 'districtSource') return 'LCMS Missouri District Compensation Guidelines';
    if (kind === 'concordiaSource') return 'Overview of your Concordia Plans Participation';
    return 'Concordia Plans quote #0560500326, effective ' + HEALTH_PLAN_QUOTE_2027.effectiveYear;
  }

  function healthMode(w) {
    if (w.healthMode === 'family' || w.healthMode === 'employee' || w.healthMode === 'optout') return w.healthMode;
    if (w.healthEnrolled === false) return 'optout';
    return w.hasDependents ? 'family' : 'employee';
  }
  function healthTier(w) {
    const t = w && w.healthTier;
    if (t === 'optout') return 'optout';
    for (const tier of FIN_HEALTH_TIERS) if (tier.key === t) return t;
    const mode = healthMode(w);
    return mode === 'family' ? 'family' : mode === 'optout' ? 'optout' : 'self';
  }
  const isExternallyFunded = (w) => !!(w && w.externallyFunded);
  const isCashOnly = (w) => !!(w && w.cashOnly);
  function countedEntries() {
    const out = [];
    roster.forEach((w, i) => { if (!isExternallyFunded(w)) out.push({ w, i }); });
    return out;
  }
  const externallyFundedWorkers = () => roster.filter(isExternallyFunded);
  function enrollmentCounts() {
    const counts = { self: 0, selfSpouse: 0, selfChild: 0, family: 0 };
    roster.forEach((w) => {
      if (isCashOnly(w) || isExternallyFunded(w)) return;
      const t = healthTier(w);
      if (counts[t] != null) counts[t] += 1;
    });
    return counts;
  }
  function enrolledCount() {
    const c = enrollmentCounts();
    return c.self + c.selfSpouse + c.selfChild + c.family;
  }
  function workerHealthCents(w, planOption, year) {
    if (isCashOnly(w)) return 0;
    const key = planOption || selectedOption;
    const tier = healthTier(w);
    if (tier === 'optout') {
      if (year != null && year !== targetYear) return optOutCents(year);
      return w.healthOptOutOverrideCents != null ? w.healthOptOutOverrideCents : optOutCents();
    }
    if (w.employeeOnlyPremiumCents != null) return w.employeeOnlyPremiumCents;
    const opt = HEALTH_PLAN_QUOTE_2027.options[key];
    if (!opt) return 0;
    const rate = finHealthTierMonthlyCents(key, tier, premiumOverrides) || 0;
    const perContract = finHealthAncillaryPerContractCents(key, premiumOverrides);
    return rate * 12 + perContract.dentalCents + perContract.visionCents;
  }
  function fte(w) {
    const pct = (w && w.ftePct != null) ? Number(w.ftePct) : 100;
    if (!Number.isFinite(pct) || pct <= 0) return 1;
    return Math.min(1, pct / 100);
  }
  const ftePct = (w) => Math.round(fte(w) * 100);

  function accountBudgetCentsForCode(code) {
    if (!code) return null;
    const all = [];
    (function flatten(nodes) { (nodes || []).forEach((n) => { all.push(n); flatten(n.children); }); })(baseTree);
    const node = all.filter((n) => n.path.indexOf(code) >= 0 || n.label.indexOf(code) >= 0)[0];
    if (!node) return null;
    return node.hasBudgetInfo ? node.totalBudgetCents : node.totalActualCents;
  }
  function currentPayCents(w) {
    if (w.actualSalaryCents != null) return w.actualSalaryCents;
    const acct = accountBudgetCentsForCode(w.accountCode);
    return acct != null ? acct : 0;
  }
  function worksheetCents(w) {
    const calc = finComputeLcmsSalary({
      year: targetYear, role: w.role, trackKey: w.trackKey, yearsExperience: w.yearsExperience,
      responsibilityStipend: w.responsibilityStipend, attendanceBonus: w.attendanceBonus,
      colaPct: 0, referenceByYear: ref,
    });
    if (!calc) return null;
    return finRoundSalaryCents(Math.round(calc.salaryCents * fte(w)));
  }
  function methodSalaryCents(w, key) {
    if (key === 'none') return currentPayCents(w);
    if (key === 'worksheet') return worksheetCents(w);
    if (key === 'scalepct') {
      const scale = worksheetCents(w);
      if (!scale) return null;
      return finRoundSalaryCents(Math.round(scale * (Number(plan.scalePct) || 0) / 100));
    }
    const rate = key === 'cola' ? ssaRate() : (Number(plan.customPct) || 0) / 100;
    return finRoundSalaryCents(Math.round(currentPayCents(w) * (1 + rate)));
  }
  function methodLabel(key) {
    if (key === 'none') return 'No raise';
    if (key === 'worksheet') return 'District Scale';
    if (key === 'scalepct') return (Number(plan.scalePct) || 0).toFixed(0) + '% of Scale';
    if (key === 'cola') return 'COLA ' + (ssaRate() * 100).toFixed(1) + '%';
    return 'Custom ' + (Number(plan.customPct) || 0).toFixed(1) + '%';
  }
  function methodLongLabel(key) {
    if (key === 'none') return 'no raise';
    if (key === 'worksheet') return 'the District Compensation Worksheet';
    if (key === 'scalepct') return (Number(plan.scalePct) || 0).toFixed(0) + '% of the District Compensation Worksheet';
    if (key === 'cola') return 'the Social Security COLA';
    return 'a custom ' + (Number(plan.customPct) || 0).toFixed(1) + '%';
  }
  const methodFor = (i) => plan.perWorkerMethod[i] || plan.method;
  function overrideCents(i) {
    const ov = plan.overrides[i];
    if (ov == null || ov === '') return null;
    const n = parseFloat(String(ov).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }
  function salaryCents(w, i) {
    const ov = overrideCents(i);
    if (ov != null) return ov;
    return methodSalaryCents(w, methodFor(i));
  }
  function benefits(w, salary, opts) {
    const year = (opts && opts.year != null) ? opts.year : targetYear;
    const planOption = (opts && opts.planOption) || selectedOption;
    const pRate = pensionRate(year).rate;
    const dRate = disabilityRate(year, !!w.hasDependents).rate;
    const fRate = ficaRate(year);
    const cashOnly = isCashOnly(w);
    const healthCents = workerHealthCents(w, planOption, year);
    const pensionCents = cashOnly ? 0 : Math.round(salary * pRate);
    const disabilityCents = cashOnly ? 0 : Math.round(salary * dRate);
    const ficaCents = w.selfEmployedFica ? 0 : Math.round(salary * fRate);
    return {
      pensionCents, disabilityCents, healthCents, ficaCents, secaSelfCents: Math.round(salary * fRate), cashOnly,
      totalCents: pensionCents + disabilityCents + healthCents + ficaCents,
    };
  }
  function computeAll() {
    return roster.map((w, i) => {
      const salary = salaryCents(w, i);
      const b = benefits(w, salary);
      return {
        salaryCents: salary, benefits: b, churchCostCents: salary + b.totalCents,
        worksheetCents: worksheetCents(w), currentCents: currentPayCents(w),
        overridden: overrideCents(i) != null, methodKey: methodFor(i),
      };
    });
  }

  function ledgerBaselineDetail() {
    const empty = { basis: 'ledger', cents: 0, rows: [], countedRows: [], unmatchedRows: [], unmatchedCents: 0, prorated: false, weeks: 52, salaryCents: 0, benefitCents: 0, available: false };
    if (!baseTree) return empty;
    const leaves = [];
    (function walk(nodes) {
      (nodes || []).forEach((n) => {
        if (!n.children.length && !FIN_REVENUE_CLASSES[n.classification]) leaves.push(n);
        walk(n.children);
      });
    })(baseTree);
    const today = centralDateParts(now);
    const weeks = (baseYear === today.year) ? weeksElapsedInYear(today) : 52;
    const prorated = weeks < 52;
    const rosterByCode = {};
    countedEntries().forEach((e) => {
      const code = String(e.w.accountCode || '').trim();
      if (!code) return;
      (rosterByCode[code] = rosterByCode[code] || []).push(e.w.name || '(unnamed)');
    });
    const rows = leaves.filter((n) => FIN_COMP_BASELINE_RE.test(n.label || '')).map((n) => {
      const label = n.label || '';
      const actual = n.totalActualCents || 0;
      const codeMatch = String(label).match(/^\s*(\d{3,8})/);
      const code = codeMatch ? codeMatch[1] : '';
      const row = { label, code, kind: FIN_COMP_POOLED_RE.test(label) ? 'benefit' : 'salary', rosterNames: rosterByCode[code] || [] };
      if (n.hasBudgetInfo && n.totalBudgetCents) { row.cents = n.totalBudgetCents; row.basis = 'budget'; }
      else if (actual && prorated) { row.cents = Math.round(actual * (52 / weeks)); row.basis = 'annualized'; }
      else { row.cents = actual; row.basis = 'actual'; }
      return row;
    }).filter((r) => r.cents);
    rows.sort((a, b) => b.cents - a.cents);
    const unmatched = rows.filter((r) => r.kind === 'salary' && !r.rosterNames.length);
    const canRosterOnly = unmatched.length > 0 && rows.some((r) => r.kind === 'salary' && r.rosterNames.length);
    const rosterOnly = canRosterOnly && !!plan.baselineRosterOnly;
    const counted = rosterOnly ? rows.filter((r) => !(r.kind === 'salary' && !r.rosterNames.length)) : rows;
    return {
      basis: 'ledger', available: true,
      cents: counted.reduce((s, r) => s + r.cents, 0),
      rows, countedRows: counted, unmatchedRows: unmatched,
      unmatchedCents: unmatched.reduce((s, r) => s + r.cents, 0),
      canRosterOnly, rosterOnly, prorated, weeks,
      anyAnnualized: counted.some((r) => r.basis === 'annualized'),
      salaryCents: counted.reduce((t, r) => t + (r.kind === 'salary' ? r.cents : 0), 0),
      benefitCents: counted.reduce((t, r) => t + (r.kind === 'benefit' ? r.cents : 0), 0),
    };
  }
  function rosterBaselineDetail() {
    const rows = countedEntries().map((e) => {
      const w = e.w;
      const salary = currentPayCents(w);
      const b = benefits(w, salary, { year: baseYear, planOption: plan.basePlanOption });
      return { name: w.name || '(unnamed)', salaryCents: salary, benefits: b, cents: salary + b.totalCents };
    });
    const salary = rows.reduce((t, r) => t + r.salaryCents, 0);
    const benefitCents = rows.reduce((t, r) => t + r.benefits.totalCents, 0);
    return {
      basis: 'roster', rows, salaryCents: salary, benefitCents, cents: salary + benefitCents,
      pensionCents: rows.reduce((t, r) => t + r.benefits.pensionCents, 0),
      healthCents: rows.reduce((t, r) => t + r.benefits.healthCents, 0),
      disabilityCents: rows.reduce((t, r) => t + r.benefits.disabilityCents, 0),
      ficaCents: rows.reduce((t, r) => t + r.benefits.ficaCents, 0),
      planOption: plan.basePlanOption,
    };
  }
  const activeBaseline = () => (plan.baseYearBasis === 'ledger' ? ledgerBaselineDetail() : rosterBaselineDetail());
  function totals(computed) {
    const counted = countedEntries().map((e) => computed[e.i]);
    const salary = counted.reduce((s, c) => s + c.salaryCents, 0);
    const benefitsTotal = counted.reduce((s, c) => s + c.benefits.totalCents, 0);
    const baseline = activeBaseline();
    const total = salary + benefitsTotal;
    return {
      salaryCents: salary, benefitsCents: benefitsTotal, totalCents: total,
      baseline, baselineCents: baseline.cents, deltaCents: total - baseline.cents,
      currentCents: counted.reduce((s, c) => s + c.currentCents, 0),
      worksheetCents: counted.reduce((s, c) => s + (c.worksheetCents || 0), 0),
      healthCents: counted.reduce((s, c) => s + c.benefits.healthCents, 0),
    };
  }

  function usableRanges(w) {
    const c = w.concordia || {};
    return FIN_CONCORDIA_RANGE_KEYS.map((r) => ({
      key: r.key, label: r.label,
      lowCents: parseConcordiaMoneyCents(c[r.key + 'Low']),
      midCents: parseConcordiaMoneyCents(c[r.key + 'Mid']),
      highCents: parseConcordiaMoneyCents(c[r.key + 'High']),
    })).filter((r) => r.lowCents > 0 && r.highCents > r.lowCents);
  }
  function lcmsRange(w) {
    const u = usableRanges(w);
    return u.filter((r) => /LCMS/i.test(r.label))[0] || u[0] || null;
  }
  // Legacy's text-and-colour helpers, returning a tone ('good' | 'warn' | 'bad' | 'none') in
  // place of CSS variables so the page decides how to show it.
  const ratioTone = (ratio) => (ratio >= 0.995 ? 'good' : ratio >= 0.95 ? 'warn' : 'bad');
  function vsScale(salary, worksheet) {
    if (!worksheet) return { diffCents: null, pct: null, atScale: false, tone: 'none' };
    const diff = salary - worksheet;
    return { diffCents: diff, pct: Math.round(salary / worksheet * 100), atScale: Math.abs(diff) < 50000, tone: ratioTone(salary / worksheet) };
  }
  function verdict(w, salary) {
    const usable = usableRanges(w);
    const lcms = lcmsRange(w);
    if (!lcms) return { kind: 'none', midCents: null, tone: 'none' };
    const midCents = lcms.midCents || lcms.lowCents;
    const belowAll = usable.every((r) => salary < r.lowCents);
    const vsMid = salary - midCents;
    if (belowAll) return { kind: 'below-all', midCents, vsMidCents: vsMid, tone: 'bad' };
    if (salary < lcms.lowCents) return { kind: 'below-lcms', midCents, vsMidCents: vsMid, tone: 'bad' };
    if (Math.abs(vsMid) / midCents < 0.03) return { kind: 'at-mid', midCents, vsMidCents: vsMid, tone: 'good' };
    if (vsMid > 0) return { kind: 'above-mid', midCents, vsMidCents: vsMid, tone: 'good' };
    return { kind: 'below-mid', midCents, vsMidCents: vsMid, tone: 'warn' };
  }
  function medianTotal(computed) {
    let med = 0, pay = 0, n = 0;
    countedEntries().forEach((e) => {
      const l = lcmsRange(e.w);
      if (l && l.midCents) { med += l.midCents; pay += computed[e.i].salaryCents; n++; }
    });
    if (!med) return { count: 0, medCents: 0, payCents: 0, pct: null, tone: 'none' };
    return { count: n, medCents: med, payCents: pay, diffCents: pay - med, pct: Math.round(pay / med * 100), tone: ratioTone(pay / med) };
  }
  function fullScaleGap(computed) {
    let salaryGapCents = 0, benefitsGapCents = 0;
    countedEntries().forEach((e) => {
      const w = e.w, c = computed[e.i];
      const gap = Math.max(0, (c.worksheetCents || 0) - c.salaryCents);
      if (!gap) return;
      const cashOnly = isCashOnly(w);
      const pRate = cashOnly ? 0 : pensionRate(targetYear).rate;
      const dRate = cashOnly ? 0 : disabilityRate(targetYear, !!w.hasDependents).rate;
      salaryGapCents += gap;
      benefitsGapCents += Math.round(gap * (pRate + dRate + (w.selfEmployedFica ? 0 : ficaRate())));
    });
    return { salaryGapCents, benefitsGapCents, totalCents: salaryGapCents + benefitsGapCents };
  }
  function benefitBreakdown(computed) {
    const entries = countedEntries();
    const sum = (pick) => entries.reduce((t, e) => t + pick(computed[e.i].benefits), 0);
    const count = (test) => entries.reduce((t, e) => t + (test(computed[e.i].benefits, e.w) ? 1 : 0), 0);
    const rows = [
      { key: 'pension', cents: sum((b) => b.pensionCents), people: count((b) => b.pensionCents > 0), rate: pensionRate(targetYear).rate },
      { key: 'health', cents: sum((b) => b.healthCents), people: count((b) => b.healthCents > 0) },
      { key: 'disability', cents: sum((b) => b.disabilityCents), people: count((b) => b.disabilityCents > 0),
        rate: disabilityRate(targetYear, false).rate, rateWithDependents: disabilityRate(targetYear, true).rate },
      { key: 'fica', cents: sum((b) => b.ficaCents), people: count((b) => b.ficaCents > 0), rate: ficaRate() },
    ];
    return {
      rows,
      totalCents: rows.reduce((t, r) => t + r.cents, 0),
      secaSelfCents: entries.reduce((t, e) => t + (e.w.selfEmployedFica ? computed[e.i].benefits.secaSelfCents : 0), 0),
      countedCount: entries.length,
    };
  }
  const planQuoteField = (key, field) => finCompPlanQuoteField(key, field, premiumOverrides);
  function perHouseholdDiffCents(fromKey, toKey, tierKey) {
    const tier = tierKey || 'family';
    const from = finHealthTierMonthlyCents(fromKey, tier, premiumOverrides);
    const to = finHealthTierMonthlyCents(toKey, tier, premiumOverrides);
    if (from == null || to == null) return 0;
    const dv = (k) => planQuoteField(k, 'dentalCents') + planQuoteField(k, 'visionCents');
    const enrolled = Math.max(1, enrolledCount());
    return (to - from) * 12 + Math.round((dv(toKey) - dv(fromKey)) / enrolled);
  }
  const healthPlanTotal = (key) => finComputeHealthPlanTotalCents(key, premiumOverrides, enrollmentCounts());
  const tierMonthlyCents = (key, tier) => finHealthTierMonthlyCents(key, tier, premiumOverrides);

  return {
    plan, roster, targetYear, baseYear, hasBaseLedger: !!baseTree,
    enteredRef, baseSalary, pensionRate, disabilityRate, ficaRate, ssaRate, optOutCents, sourceDoc,
    healthTier, isExternallyFunded, isCashOnly, countedEntries, externallyFundedWorkers,
    enrollmentCounts, enrolledCount, workerHealthCents, fte, ftePct,
    accountBudgetCentsForCode, currentPayCents, worksheetCents, methodSalaryCents, methodLabel, methodLongLabel,
    methodFor, overrideCents, salaryCents, benefits, computeAll, ledgerBaselineDetail, rosterBaselineDetail,
    activeBaseline, totals, usableRanges, lcmsRange, vsScale, verdict, medianTotal, fullScaleGap,
    benefitBreakdown, planQuoteField, perHouseholdDiffCents, healthPlanTotal, tierMonthlyCents,
  };
}

export function healthTierLabel(key) {
  if (key === 'optout') return 'Opts out (cash)';
  for (const tier of FIN_HEALTH_TIERS) if (tier.key === key) return tier.label;
  return key;
}

// One call for pages: the model, every worker's figures and the totals.
export function projectCompensation({ saved, targetYear, baseYear = targetYear - 1, baseAccounts = null, now = new Date(), councilView = false }) {
  let plan = normalizeCompensationPlan(saved, targetYear);
  if (councilView) plan = councilRosterView(plan);
  const baseTree = Array.isArray(baseAccounts) ? buildChurchAccountTree(baseAccounts) : null;
  const model = createCompensationModel({ plan, targetYear, baseYear, baseTree, now });
  const computed = model.computeAll();
  return { model, computed, totals: model.totals(computed) };
}
