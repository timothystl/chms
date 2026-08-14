import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS } from '../src/html-chms.js';

// Reported from the Compensation strip: "No raise applied to all 7 workers" printed alongside
// +$111,624 (+34.0%) against FY2026. No raise cannot cost a third more, and the reporter's own
// guess was right — the two sides of that subtraction were not the same question.
//
// Two independent errors, both inflating the delta:
//
//   (1) SCOPE. The FY{target} total is salary + pension + disability + health + employer FICA.
//       The FY{base} figure matched only /salar|payroll|compensation|wages/ and
//       /health|medical|dental|vision|disability/ — no pension, no payroll taxes. Those two cost
//       categories were counted on the plan side and never looked for on the base side.
//   (2) PERIOD. totalActualCents for a base year still in progress is year-to-date, and the plan
//       is a whole year. In August that compares roughly eight months against twelve.
//
// These run the real built bundle in a vm, the way the sibling compensation tests do — the
// functions read a dozen module-level globals and a real load is the only honest way to drive them.
function makeCtx() {
  const store = {};
  const el = () => ({
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, scrollTop: 0, children: [],
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    appendChild() {}, addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getAttribute() { return null; }, setAttribute() {}, focus() {}, setSelectionRange() {},
  });
  const document = {
    getElementById(id) { return store[id] || null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement: el, addEventListener() {}, body: el(), documentElement: el(), activeElement: null,
  };
  const ctx = {
    document, console, setTimeout, clearTimeout, Math, JSON, Date, parseFloat, parseInt, isFinite,
    Number, String, Object, Array, encodeURIComponent, decodeURIComponent,
    localStorage: { getItem() { return null; }, setItem() {} },
    fetch: () => Promise.reject(new Error('no network in tests')),
    navigator: {}, location: { href: '', hash: '' },
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, requestAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_CORE_JS, ctx, { filename: 'app-core.js' });
  vm.runInContext(CHMS_APP_EXT_JS, ctx, { filename: 'app-ext.js' });
  return ctx;
}

const leaf = (label, actual, budget) => ({
  label, path: 'Expenses:' + label, children: [], classification: 'Expenses', depth: 1,
  hasBudgetInfo: budget != null, totalActualCents: actual, totalBudgetCents: budget || 0,
});
const tree = (leaves) => [{
  label: 'Expenses', path: 'Expenses', classification: 'Expenses', depth: 0, hasBudgetInfo: true,
  totalActualCents: 0, totalBudgetCents: 0, children: leaves,
}];

// A complete past year, so nothing is annualized unless a test asks for it.
function seed(ctx, leaves, opts) {
  opts = opts || {};
  ctx._userRole = 'admin';
  ctx._finPlanBaseYear = opts.baseYear || 2024;
  ctx._finPlanTargetYear = (opts.baseYear || 2024) + 1;
  ctx._finPlanBaseTree = tree(leaves);
  ctx._finCompMethod = 'none';
  ctx._finCompPerWorkerMethod = {};
  ctx._finCompOverrides = {};
  ctx._finSalaryRoster = opts.roster || [];
  return ctx;
}

describe('the FY base-year figure covers the same cost categories as the plan', () => {
  it('counts pension and payroll taxes, which the plan total charges for', () => {
    const ctx = makeCtx();
    seed(ctx, [
      leaf('58001 Pastor Salary', 10000000, 10000000),
      leaf('59030 Concordia Pension', 1170000, 1170000),
      leaf('59040 Payroll Taxes (FICA)', 765000, 765000),
      leaf('59035 Health Insurance', 2900000, 2900000),
    ]);
    const labels = ctx.finCompBaselineDetail().rows.map(r => r.label);
    expect(labels).toContain('59030 Concordia Pension');
    expect(labels).toContain('59040 Payroll Taxes (FICA)');
    expect(ctx.finCompBaselineCents()).toBe(10000000 + 1170000 + 765000 + 2900000);
  });

  it('still refuses "52040 Insurance" — property cover, not staff cost', () => {
    const ctx = makeCtx();
    seed(ctx, [leaf('58001 Pastor Salary', 10000000, 10000000), leaf('52040 Insurance', 4000000, 4000000)]);
    expect(ctx.finCompBaselineDetail().rows.map(r => r.label)).toEqual(['58001 Pastor Salary']);
  });

  it('refuses a benevolence account that merely names Concordia', () => {
    // /concordia/ would have swept "Concordia Children's Services" — money forwarded to a third
    // party — into the church's own staff cost.
    const ctx = makeCtx();
    seed(ctx, [leaf('58001 Pastor Salary', 10000000, 10000000), leaf("25010 Concordia Children's Services", 600000, 600000)]);
    expect(ctx.finCompBaselineDetail().rows.map(r => r.label)).toEqual(['58001 Pastor Salary']);
  });

  it('never counts an income account, however it is named', () => {
    const ctx = makeCtx();
    const income = { label: '40085 Retirement Distribution', path: 'Income:40085', children: [], classification: 'Income', depth: 1, hasBudgetInfo: false, totalActualCents: 5000000, totalBudgetCents: 0 };
    ctx._userRole = 'admin';
    ctx._finPlanBaseYear = 2024; ctx._finPlanTargetYear = 2025;
    ctx._finPlanBaseTree = [
      { label: 'Revenue', path: 'Income', classification: 'Income', depth: 0, hasBudgetInfo: false, totalActualCents: 5000000, totalBudgetCents: 0, children: [income] },
      ...tree([leaf('58001 Pastor Salary', 10000000, 10000000)]),
    ];
    expect(ctx.finCompBaselineCents()).toBe(10000000);
  });
});

describe('both sides of the comparison are a full year', () => {
  it('prefers an account\'s own full-year budget over its year-to-date actual', () => {
    const ctx = makeCtx();
    seed(ctx, [leaf('58001 Pastor Salary', 6000000, 10000000)]);
    const d = ctx.finCompBaselineDetail();
    expect(d.cents).toBe(10000000);
    expect(d.rows[0].basis).toBe('budget');
  });

  it('annualizes an actual with no budget when the base year is still running', () => {
    const ctx = makeCtx();
    const now = new Date();
    seed(ctx, [leaf('58001 Pastor Salary', 5000000, null)], { baseYear: now.getFullYear() });
    const d = ctx.finCompBaselineDetail();
    expect(d.prorated, 'the current year is by definition incomplete').toBe(true);
    expect(d.cents).toBe(Math.round(5000000 * (52 / d.weeks)));
    expect(d.cents).toBeGreaterThan(5000000);
    expect(d.rows[0].basis).toBe('annualized');
  });

  it('leaves a completed past year exactly as reported', () => {
    const ctx = makeCtx();
    seed(ctx, [leaf('58001 Pastor Salary', 5000000, null)], { baseYear: 2024 });
    const d = ctx.finCompBaselineDetail();
    expect(d.prorated).toBe(false);
    expect(d.cents).toBe(5000000);
    expect(d.rows[0].basis).toBe('actual');
  });
});

describe('the reported symptom: no raise must not read as a large increase', () => {
  // One worker, paid from one account, with the church's real cost categories all present in the
  // base year. Under "No raise" the plan should land within a rounding step of the base year.
  function oneWorkerCtx() {
    const ctx = makeCtx();
    const salary = 10000000;
    // The base year's benefit accounts are derived from the SAME rate lookups the plan side uses,
    // so this test measures the scope/period fix and never the rate tables.
    seed(ctx, [], { baseYear: 2026 });
    const pension = Math.round(salary * ctx.finCompPensionRate(2027).rate);
    const disability = Math.round(salary * ctx.finCompDisabilityRate(2027, true).rate);
    const fica = Math.round(salary * ctx.finCompFicaRate());
    ctx._finPlanBaseTree = tree([
      leaf('58001 Pastor Salary', salary, salary),
      leaf('59030 Pension', pension, pension),
      leaf('59016 Disability & Accident', disability, disability),
      leaf('59040 Payroll Taxes FICA', fica, fica),
    ]);
    ctx._finSalaryRoster = [{
      name: 'Test Worker', position: 'Parish Administrator', role: 'other', trackKey: 'secretary',
      education: 'associates', yearsExperience: 12, accountCode: '58001',
      actualSalaryCents: salary, hasDependents: true, healthMode: 'optout', concordia: {},
    }];
    return ctx;
  }

  it('lands within a percent of the base year rather than a third above it', () => {
    const ctx = oneWorkerCtx();
    const totals = ctx.finCompTotals(ctx.finCompComputeAll());
    const pct = totals.deltaCents / totals.baselineCents * 100;
    expect(Math.abs(pct), 'no raise, same benefits — the two sides should nearly cancel').toBeLessThan(1);
  });

  it('would have read as a large jump when pension and FICA were missing from the base year', () => {
    // Reproduces the reported arithmetic directly: drop the two categories the old match could not
    // see and the same unchanged plan reads as a double-digit increase.
    const ctx = oneWorkerCtx();
    const totals = ctx.finCompTotals(ctx.finCompComputeAll());
    const salaryAndHealthOnly = ctx.finCompBaselineDetail().rows
      .filter(r => /salar|health/i.test(r.label)).reduce((s, r) => s + r.cents, 0);
    const oldPct = (totals.totalCents - salaryAndHealthOnly) / salaryAndHealthOnly * 100;
    expect(oldPct).toBeGreaterThan(15);
  });
});

describe('the comparison prints its own working', () => {
  function noteCtx() {
    const ctx = makeCtx();
    seed(ctx, [
      leaf('58001 Pastor Salary', 10000000, 10000000),
      leaf('59030 Pension', 1170000, 1170000),
    ], { roster: [{ name: 'Test Worker', position: 'Other Church Worker', accountCode: '58001', actualSalaryCents: 10000000 }] });
    return ctx;
  }

  it('names every account it counted, and on what basis', () => {
    const ctx = noteCtx();
    const html = ctx.finCompRenderBaselineNote(ctx.finCompTotals(ctx.finCompComputeAll()));
    expect(html).toContain('58001 Pastor Salary');
    expect(html).toContain('59030 Pension');
    expect(html).toContain('budget');
  });

  it('says what the plan side holds, so the two are comparable on their face', () => {
    const ctx = noteCtx();
    const html = ctx.finCompRenderBaselineNote(ctx.finCompTotals(ctx.finCompComputeAll()));
    expect(html).toMatch(/pension, disability, health, employer FICA/);
  });

  it('says plainly when the ledger has no compensation accounts at all', () => {
    const ctx = makeCtx();
    seed(ctx, [leaf('52040 Insurance', 4000000, 4000000)]);
    const html = ctx.finCompRenderBaselineNote(ctx.finCompTotals(ctx.finCompComputeAll()));
    expect(html).toContain('no compensation accounts were found');
  });
});

describe('"% of scale" growth method', () => {
  function scaleCtx() {
    const ctx = makeCtx();
    seed(ctx, [leaf('58001 Pastor Salary', 10000000, 10000000)], {
      baseYear: 2026,
      roster: [{ name: 'Test Worker', position: 'Parish Administrator', role: 'other', trackKey: 'secretary',
                 education: 'associates', yearsExperience: 12, accountCode: '58001',
                 actualSalaryCents: 10000000, healthMode: 'optout', concordia: {} }],
    });
    return ctx;
  }

  it('is offered alongside the other methods', () => {
    const ctx = makeCtx();
    expect(ctx.FIN_COMP_METHODS).toContain('scalepct');
  });

  it('is exactly that share of the district scale figure', () => {
    const ctx = scaleCtx();
    const w = ctx._finSalaryRoster[0];
    const scale = ctx.finCompWorksheetCents(w);
    expect(scale, 'the fixture worker must have a district figure').toBeGreaterThan(0);
    ctx._finCompScalePct = 90;
    expect(ctx.finCompMethodSalaryCents(w, 'scalepct')).toBe(ctx.finRoundSalaryCents(Math.round(scale * 0.9)));
    ctx._finCompScalePct = 100;
    expect(ctx.finCompMethodSalaryCents(w, 'scalepct')).toBe(ctx.finCompMethodSalaryCents(w, 'worksheet'));
  });

  it('is a share of SCALE, not of current pay — that is what Custom already does', () => {
    const ctx = scaleCtx();
    const w = ctx._finSalaryRoster[0];
    ctx._finCompScalePct = 90;
    expect(ctx.finCompMethodSalaryCents(w, 'scalepct')).not.toBe(ctx.finRoundSalaryCents(Math.round(10000000 * 0.9)));
  });

  it('shows nothing rather than $0 for a worker with no district figure', () => {
    // A share of a scale that does not exist is unanswerable, not zero — and a zero here would
    // quietly propose cutting someone's pay to nothing.
    const ctx = scaleCtx();
    ctx._finCompScalePct = 90;
    expect(ctx.finCompMethodSalaryCents({ name: 'No role' }, 'scalepct')).toBe(null);
  });

  it('carries the percentage in its own label', () => {
    const ctx = makeCtx();
    ctx._finCompScalePct = 92;
    expect(ctx.finCompMethodLabel('scalepct')).toBe('92% of Scale');
    expect(ctx.finCompMethodLongLabel('scalepct')).toContain('92% of the District');
  });

  it('selecting the percentage box switches everyone onto the method', () => {
    const ctx = scaleCtx();
    ctx.finCompScalePctChange('88');
    expect(ctx._finCompScalePct).toBe(88);
    expect(ctx._finCompMethod).toBe('scalepct');
  });

  it('is saved with the rest of the planner, so it survives a reload', () => {
    const ctx = scaleCtx();
    ctx._finCompScalePct = 88;
    expect(ctx.finSalaryBuildSaveBody().compScalePct).toBe(88);
  });

  it('renders as its own column without breaking the add-a-worker row span', () => {
    const ctx = scaleCtx();
    const computed = ctx.finCompComputeAll();
    const html = ctx.finCompRenderPlan(computed, ctx.finCompTotals(computed));
    expect(html).toContain('% of Scale');
    const headCount = (html.match(/<th class="fin-comp-th/g) || []).length;
    const span = Number(html.match(/colspan="(\d+)"/)[1]);
    expect(span, 'the add row must span the whole table').toBe(headCount);
  });
});
