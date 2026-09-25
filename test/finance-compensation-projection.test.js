import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS, CHMS_APP_FINANCE_JS } from '../src/html-chms.js';
import {
  normalizeCompensationPlan, councilRosterView, buildChurchAccountTree, createCompensationModel,
  projectCompensation, weeksElapsedInYear, centralDateParts,
} from '../apps/finance/compensation-projection.js';

// Finance's raise projections must reproduce legacy's Salary Planner exactly. These run the real
// legacy bundle in a vm (the same harness as finance-comp-baseline.test.js), drive it with the same
// saved plan and base-year ledger, and require identical per-worker and total figures.
function legacyCtx() {
  const el = () => ({
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    appendChild() {}, addEventListener() {}, removeEventListener() {}, querySelector() { return null; },
    querySelectorAll() { return []; }, getAttribute() { return null; }, setAttribute() {}, focus() {},
  });
  const document = {
    getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    createElement: el, addEventListener() {}, body: el(), documentElement: el(), activeElement: null,
  };
  const ctx = {
    document, console, setTimeout, clearTimeout, Math, JSON, Date, parseFloat, parseInt, isFinite,
    Number, String, Object, Array, encodeURIComponent, decodeURIComponent,
    localStorage: { getItem() { return null; }, setItem() {} },
    fetch: () => Promise.reject(new Error('no network in tests')),
    navigator: {}, location: { href: '', hash: '' }, addEventListener() {}, removeEventListener() {},
    scrollTo() {}, requestAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_CORE_JS, ctx);
  vm.runInContext(CHMS_APP_EXT_JS, ctx);
  vm.runInContext(CHMS_APP_FINANCE_JS, ctx);
  return ctx;
}

// Synthetic people and figures only.
const ROSTER = [
  { name: 'Pastor A', position: 'Senior Pastor', role: 'pastor', yearsExperience: 18, selfEmployedFica: true, hasDependents: true, accountCode: '58001', healthTier: 'family' },
  { name: 'DCE B', position: 'Director of Christian Education', role: 'commissioned', trackKey: 'ma', yearsExperience: 9, selfEmployedFica: true, accountCode: '58002', healthMode: 'employee',
    concordia: { churchLcmsLow: '60,000', churchLcmsMid: '$68,000', churchLcmsHigh: '76000', churchMarketLow: '70,000', churchMarketMid: '80,000', churchMarketHigh: '90,000' } },
  { name: 'Hidden C', position: 'Business Manager', role: 'other', trackKey: 'business_manager_music', yearsExperience: 4, accountCode: '58003', hideFromCouncil: true, healthEnrolled: false },
  { name: 'Music D', position: 'Director of Music', role: 'other', trackKey: 'business_manager_music', yearsExperience: 20, accountCode: '58004', healthTier: 'selfSpouse', responsibilityStipend: 0.05,
    concordia: { churchLcmsLow: '50,000', churchLcmsMid: '55,000', churchLcmsHigh: '60,000' } },
  { name: 'Part-time E', position: 'Custodian', role: 'other', trackKey: 'custodian', yearsExperience: 3, ftePct: 40, cashOnly: true, actualSalaryCents: 1800000 },
  { name: 'MDO F', position: 'MDO Director', role: 'other', trackKey: 'childcare_director', yearsExperience: 6, externallyFunded: true, accountCode: '58009' },
  { name: 'Secretary G', position: 'Secretary', role: 'other', trackKey: 'secretary', yearsExperience: 11, accountCode: '58005', healthTier: 'optout', healthOptOutOverrideCents: 250000 },
  { name: 'Self H', position: 'Youth Worker', role: 'other', trackKey: 'unknown_track', yearsExperience: 2, accountCode: '58006', healthTier: 'self', employeeOnlyPremiumCents: 820000 },
];

const SAVED = {
  roster: ROSTER,
  healthPlanOption: 'option2',
  compMethod: 'cola',
  compPerWorkerMethod: { 1: 'worksheet', 3: 'scalepct', 6: 'custom', 7: 'none' },
  compOverrides: { 4: '19,250' },
  compCustomPct: 4.25,
  compScalePct: 92,
  compBaselineRosterOnly: true,
  compBasePlanOption: 'current',
  referenceByYear: {
    2025: { pensionPct: 0.107, healthOptOutCents: 180000 },
    2026: { ssaColaPct: 0.025, ficaPct: 0.0765, baseSalaryCents: 5050000, disabilityDepsPct: 0.012, districtSource: 'District guide 2026' },
  },
  healthPlanPremiumOverrides: { option2: { tiersMonthlyCents: { family: 220000 }, dentalCents: 150000 } },
};

// Base-year ledger rows in the connect.finance-church-report.v1 account shape.
const acct = (classification, categoryPath, accountName, depth, actualCents, budgetCents) =>
  ({ classification, categoryPath, accountName, depth, hasChildren: false, actualCents, budgetCents, source: 'import' });
const BASE_ACCOUNTS = [
  acct('Income', 'Income', 'Income', 0, 0, null),
  acct('Income', 'Income:40010 Offerings', '40010 Offerings', 1, 90000000, 95000000),
  acct('Income', 'Income:40085 Retirement Distribution', '40085 Retirement Distribution', 1, 100000, null),
  acct('Expenses', 'Expenses', 'Expenses', 0, 0, null),
  acct('Expenses', 'Expenses:58 Personnel', '58 Personnel', 1, 0, null),
  acct('Expenses', 'Expenses:58 Personnel:58001 Pastor Salary', '58001 Pastor Salary', 2, 7000000, 9800000),
  acct('Expenses', 'Expenses:58 Personnel:58002 DCE Salary', '58002 DCE Salary', 2, 4100000, null),
  acct('Expenses', 'Expenses:58 Personnel:58003 Business Salary', '58003 Business Salary', 2, 3000000, 4400000),
  acct('Expenses', 'Expenses:58 Personnel:58004 Music Salary', '58004 Music Salary', 2, 4000000, 5600000),
  acct('Expenses', 'Expenses:58 Personnel:58005 Office Wages', '58005 Office Wages', 2, 2500000, 3900000),
  acct('Expenses', 'Expenses:58 Personnel:58007 Nursery Wages', '58007 Nursery Wages', 2, 600000, null),
  acct('Expenses', 'Expenses:58 Personnel:58008 Vacant Salary', '58008 Vacant Salary', 2, 0, 0),
  acct('Expenses', 'Expenses:59 Benefits', '59 Benefits', 1, 0, null),
  acct('Expenses', 'Expenses:59 Benefits:59030 Concordia Pension', '59030 Concordia Pension', 2, 2100000, 2600000),
  acct('Expenses', 'Expenses:59 Benefits:59035 Health Insurance', '59035 Health Insurance', 2, 3300000, 5000000),
  acct('Expenses', 'Expenses:59 Benefits:59040 Payroll Taxes', '59040 Payroll Taxes', 2, 900000, null),
  acct('Expenses', 'Expenses:52040 Insurance', '52040 Insurance', 1, 1200000, 1500000),
];
const legacyRows = (accounts) => accounts.map((a) => ({
  category_path: a.categoryPath, account_name: a.accountName, classification: a.classification,
  depth: a.depth, own_actual_cents: a.actualCents, own_budget_cents: a.budgetCents,
}));

const TARGET = 2026;
const BASE = 2025;

function runLegacy(saved, { basis, councilView = false } = {}) {
  const ctx = legacyCtx();
  ctx._userRole = 'admin';
  ctx._finPlanBaseYear = BASE;
  ctx._finPlanTargetYear = TARGET;
  const s = JSON.parse(JSON.stringify(saved));
  ctx._finSalaryRoster = s.roster;
  ctx._finHealthPlanSelectedOption = s.healthPlanOption || 'renewal';
  ctx._finSalaryReferenceByYear = s.referenceByYear || {};
  ctx._finHealthPlanPremiumOverrides = s.healthPlanPremiumOverrides || {};
  ctx._finCompMethod = s.compMethod || 'cola';
  ctx._finCompPerWorkerMethod = s.compPerWorkerMethod || {};
  ctx._finCompOverrides = s.compOverrides || {};
  ctx._finCompCustomPct = s.compCustomPct != null ? s.compCustomPct : 3.5;
  ctx._finCompScalePct = s.compScalePct != null ? s.compScalePct : 95;
  ctx._finCompBaselineRosterOnly = !!s.compBaselineRosterOnly;
  ctx._finCompBaseYearBasis = basis;
  ctx._finCompBasePlanOption = s.compBasePlanOption || 'current';
  ctx.finCompMigrateSavedShape(s);
  ctx._finPlanBaseTree = ctx.finReorganizeChurchTree(ctx.finBuildTreeFromFlatRows(legacyRows(BASE_ACCOUNTS)));
  const run = () => {
    const computed = ctx.finCompComputeAll();
    return {
      computed, totals: ctx.finCompTotals(computed), gap: ctx.finCompFullScaleGap(computed),
      breakdown: ctx.finCompBenefitBreakdown(computed), enrolled: ctx.finCompEnrolledCount(),
      perHousehold: ['option1', 'option2', 'option3'].map((k) => ctx.finCompPerHouseholdDiffCents('renewal', k)),
      plan: ctx.finComputeHealthPlanTotalCents(ctx._finHealthPlanSelectedOption, null, ctx.finCompEnrollmentCounts()),
    };
  };
  return JSON.parse(JSON.stringify(councilView ? ctx.finCompWithCouncilRoster(run) : run()));
}

function runPort(saved, { basis, councilView = false } = {}) {
  const { model, computed, totals } = projectCompensation({
    saved: { ...saved, compBaseYearBasis: basis }, targetYear: TARGET, baseYear: BASE, baseAccounts: BASE_ACCOUNTS, councilView,
  });
  const t = JSON.parse(JSON.stringify(totals));
  delete t.baseline.available;
  if (t.baseline.basis === 'ledger') delete t.baseline.basis;
  const bd = model.benefitBreakdown(computed);
  return {
    computed: JSON.parse(JSON.stringify(computed)), totals: t, gap: model.fullScaleGap(computed),
    breakdown: { cents: bd.rows.map((r) => [r.cents, r.people]), totalCents: bd.totalCents, secaSelfCents: bd.secaSelfCents, countedCount: bd.countedCount },
    enrolled: model.enrolledCount(),
    perHousehold: ['option1', 'option2', 'option3'].map((k) => model.perHouseholdDiffCents('renewal', k)),
    plan: JSON.parse(JSON.stringify(model.healthPlanTotal(model.plan.healthPlanOption))),
  };
}

function expectParity(legacy, port) {
  expect(port.computed).toEqual(legacy.computed);
  expect(port.totals).toEqual(legacy.totals);
  expect(port.gap).toEqual(legacy.gap);
  expect(port.breakdown).toEqual({
    cents: legacy.breakdown.rows.map((r) => [r.cents, r.people]), totalCents: legacy.breakdown.totalCents,
    secaSelfCents: legacy.breakdown.secaSelfCents, countedCount: legacy.breakdown.countedCount,
  });
  expect(port.enrolled).toBe(legacy.enrolled);
  expect(port.perHousehold).toEqual(legacy.perHousehold);
  expect(port.plan).toEqual(legacy.plan);
}

describe('raise projections match legacy exactly', () => {
  it('on the roster basis', () => {
    const legacy = runLegacy(SAVED, { basis: 'roster' });
    const port = runPort(SAVED, { basis: 'roster' });
    expectParity(legacy, port);
    expect(port.totals.baseline.basis).toBe('roster');
    expect(port.computed[1].salaryCents).toBeGreaterThan(0);
  });

  it('on the ledger basis, including roster-only accounts and budget-vs-actual choice', () => {
    const legacy = runLegacy(SAVED, { basis: 'ledger' });
    const port = runPort(SAVED, { basis: 'ledger' });
    expectParity(legacy, port);
    expect(port.totals.baseline.unmatchedRows.map((r) => r.label)).toEqual(['58007 Nursery Wages']);
    expect(port.totals.baseline.rosterOnly).toBe(true);
  });

  it('for every plan-wide method', () => {
    for (const compMethod of ['none', 'worksheet', 'scalepct', 'cola', 'custom']) {
      const saved = { ...SAVED, compMethod, compPerWorkerMethod: {}, compOverrides: {} };
      expectParity(runLegacy(saved, { basis: 'roster' }), runPort(saved, { basis: 'roster' }));
    }
  });

  it('migrates the pre-redesign save shape the way legacy does', () => {
    const saved = { roster: ROSTER.slice(0, 2), pensionPct: 0.125, disabilityPct: 0.02, colaSource: 'custom', colaPct: 0.031 };
    expectParity(runLegacy(saved, { basis: 'roster' }), runPort(saved, { basis: 'roster' }));
    const plan = normalizeCompensationPlan(saved, TARGET);
    expect(plan.method).toBe('custom');
    expect(plan.customPct).toBeCloseTo(3.1, 10);
    expect(plan.referenceByYear[TARGET]).toEqual({ pensionPct: 0.125, disabilityDepsPct: 0.02, disabilityNoDepsPct: 0.02 });
  });

  it('resolves current pay from the base-year account budget, else its actual, else a typed figure', () => {
    const { model } = projectCompensation({ saved: SAVED, targetYear: TARGET, baseYear: BASE, baseAccounts: BASE_ACCOUNTS });
    expect(model.currentPayCents(ROSTER[0])).toBe(9800000);
    expect(model.currentPayCents(ROSTER[1])).toBe(4100000);
    expect(model.currentPayCents(ROSTER[4])).toBe(1800000);
    const noLedger = projectCompensation({ saved: SAVED, targetYear: TARGET, baseYear: BASE, baseAccounts: null }).model;
    expect(noLedger.currentPayCents(ROSTER[0])).toBe(0);
  });
});

describe('council view', () => {
  it('matches legacy for the workers legacy maps correctly, and keeps settings with their worker', () => {
    // Legacy's council print filters hidden workers without reindexing per-worker settings. With
    // only settings BEFORE the hidden worker, the two agree.
    const early = { ...SAVED, compPerWorkerMethod: { 1: 'worksheet' }, compOverrides: {} };
    expectParity(runLegacy(early, { basis: 'roster', councilView: true }), runPort(early, { basis: 'roster', councilView: true }));

    // With settings after the hidden worker, Finance keeps each with its own person.
    const plan = councilRosterView(normalizeCompensationPlan(SAVED, TARGET));
    expect(plan.roster.map((w) => w.name)).not.toContain('Hidden C');
    expect(plan.perWorkerMethod).toEqual({ 1: 'worksheet', 2: 'scalepct', 5: 'custom', 6: 'none' });
    expect(plan.overrides).toEqual({ 3: '19,250' });
    expect(plan.roster[3].name).toBe('Part-time E');
  });
});

describe('ledger tree and calendar', () => {
  it('drops empty leaves and orders classifications the way legacy does', () => {
    const tree = buildChurchAccountTree(BASE_ACCOUNTS);
    expect(tree.map((n) => n.classification)).toEqual(['Income', 'Expenses']);
    const personnel = tree[1].children.find((n) => n.label === '58 Personnel');
    expect(personnel.children.map((n) => n.label)).not.toContain('58008 Vacant Salary');
  });

  it('counts weeks on the Central-time calendar date', () => {
    expect(centralDateParts(new Date('2026-01-01T03:00:00Z'))).toEqual({ year: 2025, month: 12, day: 31 });
    expect(weeksElapsedInYear({ year: 2026, month: 1, day: 7 })).toBe(1);
    expect(weeksElapsedInYear({ year: 2026, month: 12, day: 31 })).toBe(52);
  });

  it('annualizes an in-progress base year from the Central date', () => {
    const now = new Date('2025-07-02T15:00:00Z');
    const { totals } = projectCompensation({ saved: { ...SAVED, compBaseYearBasis: 'ledger', compBaselineRosterOnly: false }, targetYear: TARGET, baseYear: BASE, baseAccounts: BASE_ACCOUNTS, now });
    const nursery = totals.baseline.rows.find((r) => r.label === '58007 Nursery Wages');
    const weeks = weeksElapsedInYear({ year: 2025, month: 7, day: 2 });
    expect(nursery.basis).toBe('annualized');
    expect(nursery.cents).toBe(Math.round(600000 * (52 / weeks)));
  });
});

describe('model helpers', () => {
  it('reports verdicts against the LCMS range and the median across workers with a report', () => {
    const { model, computed } = projectCompensation({ saved: SAVED, targetYear: TARGET, baseYear: BASE, baseAccounts: BASE_ACCOUNTS });
    const v = model.verdict(ROSTER[1], computed[1].salaryCents);
    expect(['below-all', 'below-lcms', 'at-mid', 'above-mid', 'below-mid']).toContain(v.kind);
    expect(v.midCents).toBe(6800000);
    expect(model.medianTotal(computed).count).toBe(2);
    expect(model.verdict(ROSTER[0], computed[0].salaryCents).kind).toBe('none');
  });

  it('creates a model from a normalized plan without a ledger', () => {
    const model = createCompensationModel({ plan: normalizeCompensationPlan({ roster: [] }, TARGET), targetYear: TARGET });
    const computed = model.computeAll();
    expect(model.totals(computed).totalCents).toBe(0);
  });
});
