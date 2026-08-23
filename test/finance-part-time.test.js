import { describe, it, expect, beforeEach } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS, CHMS_APP_FINANCE_JS } from '../src/html-chms.js';

// Cover for part-time staff on the Compensation Planner: an FTE marker, and a "cash salary only"
// flag for someone below Concordia's hours floor.
//
// Two things here are judgment calls worth pinning down, because getting either wrong is quietly
// expensive:
//   1. Cash-only removes pension, disability and health — but NOT employer FICA, which is owed on
//      any W-2 wage however few the hours. Dropping it would understate the real church cost.
//   2. FTE scales the district BENCHMARK, never the salary. Otherwise a 20%-time worker reads as
//      catastrophically below scale on the Council report, which is noise rather than information.

function makeCtx() {
  const store = {};
  const el = () => ({
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, scrollTop: 0, children: [],
    options: { length: 1 },
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
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_CORE_JS, ctx, { filename: 'app-core.js' });
  vm.runInContext(CHMS_APP_EXT_JS, ctx, { filename: 'app-ext.js' });
  vm.runInContext(CHMS_APP_FINANCE_JS, ctx, { filename: 'app-finance.js' });
  ctx.__store = store; ctx.__el = el;
  return ctx;
}

const FULL = {
  name: 'Full Timer', position: 'Director', role: 'other', trackKey: 'secretary', education: 'none',
  yearsExperience: 10, responsibilityStipend: 0, responsibilityStipendKey: 'none', attendanceBonus: 0,
  selfEmployedFica: false, hasDependents: false, healthMode: 'employee', employeeOnlyPremiumCents: 1000000,
  accountCode: '58020', concordia: {},
};
const PART = Object.assign({}, FULL, {
  name: 'Nursery Helper', position: 'Nursery attendant', accountCode: '58030',
  ftePct: 20, cashOnly: true,
});

let ctx;
beforeEach(() => {
  ctx = makeCtx();
  ctx._userRole = 'admin';
  ctx._finPlanBaseYear = 2026;
  ctx._finPlanTargetYear = 2027;
  const leaf = (label, budget) => ({
    label, path: 'Expenses > Payroll > ' + label, children: [], classification: 'Expenses',
    hasBudgetInfo: true, totalActualCents: budget, totalBudgetCents: budget,
  });
  ctx._finPlanBaseTree = [{
    label: 'Expenses', path: 'Expenses', classification: 'Expenses', hasBudgetInfo: true,
    totalActualCents: 0, totalBudgetCents: 0,
    children: [leaf('58020 Office Salaries', 5000000), leaf('58030 Custodial Salaries', 800000)],
  }];
  ctx._finSalaryRoster = [JSON.parse(JSON.stringify(FULL)), JSON.parse(JSON.stringify(PART))];
  ctx._finSalaryReferenceByYear = { 2027: { pensionPct: 0.117, disabilityNoDepsPct: 0.012, ficaPct: 0.0765, ssaColaPct: 0.028, healthOptOutCents: 600000 } };
  ctx._finCompMethod = 'none';
  ctx._finCompPerWorkerMethod = {}; ctx._finCompOverrides = {};
  ctx._finHealthPlanSelectedOption = 'renewal'; ctx._finHealthPlanPremiumOverrides = {};
});

describe('the FTE marker', () => {
  it('defaults a worker with no marker to full time', () => {
    expect(ctx.finCompFtePct(FULL)).toBe(100);
    expect(ctx.finCompIsPartTime(FULL)).toBe(false);
    expect(ctx.finCompFtePct(PART)).toBe(20);
    expect(ctx.finCompIsPartTime(PART)).toBe(true);
  });

  it('pro-rates the district benchmark, and leaves the salary alone', () => {
    const full = ctx.finCompWorksheetCents(FULL);
    const part = ctx.finCompWorksheetCents(PART);
    // Same role, same years — the only difference is the time worked.
    expect(part).toBe(ctx.finRoundSalaryCents(Math.round(full * 0.2)));
    // The salary itself is whatever is really budgeted on their account, untouched by FTE.
    expect(ctx.finCompComputeAll()[1].salaryCents).toBe(800000);
  });

  it('turns a meaningless "% of scale" into a fair one', () => {
    const c = ctx.finCompComputeAll()[1];
    // $8,000 against the full-time scale for this role reads as 15% — alarming, and meaningless,
    // because nobody is proposing to pay a 20%-time worker a full-time wage. Against their own
    // pro-rated scale the same salary reads as 75%, which is a real and answerable question.
    expect(ctx.finCompVsScale(c.salaryCents, ctx.finCompWorksheetCents(FULL)).text).toContain('15% of scale');
    expect(ctx.finCompVsScale(c.salaryCents, c.worksheetCents).text).toContain('75% of scale');
  });

  it('reads a fairly-paid part-timer as at scale, not as underpaid', () => {
    // The point of pro-rating is that a part-timer CAN come out fine. Paid their pro-rated scale,
    // this worker reads green — which the full-time comparison could never produce.
    ctx._finCompOverrides = { 1: String(Math.round(ctx.finCompWorksheetCents(PART) / 100)) };
    const c = ctx.finCompComputeAll()[1];
    const vs = ctx.finCompVsScale(c.salaryCents, c.worksheetCents);
    expect(vs.text).toBe('at scale');
    expect(vs.color).toBe('var(--sage-text)');
  });

  it('clamps a nonsensical entry rather than scaling by it', () => {
    for (const [entered, want] of [['0', 100], ['', 100], ['-5', 100], ['250', 100], ['60', 60]]) {
      ctx.finCompFteChange(1, entered);
      expect(ctx.finCompFtePct(ctx._finSalaryRoster[1])).toBe(want);
    }
  });
});

describe('cash salary only', () => {
  it('removes pension, disability and health', () => {
    const b = ctx.finCompComputeAll()[1].benefits;
    expect(b.pensionCents).toBe(0);
    expect(b.disabilityCents).toBe(0);
    expect(b.healthCents).toBe(0);
    expect(b.cashOnly).toBe(true);
  });

  it('keeps employer FICA, which is owed on any wage however few the hours', () => {
    const b = ctx.finCompComputeAll()[1].benefits;
    expect(b.ficaCents).toBe(Math.round(800000 * 0.0765));
    expect(ctx.finCompComputeAll()[1].churchCostCents).toBe(800000 + b.ficaCents);
  });

  it('still drops FICA for a minister, which is a tax question not an hours one', () => {
    ctx._finSalaryRoster[1].selfEmployedFica = true;
    expect(ctx.finCompComputeAll()[1].benefits.ficaCents).toBe(0);
  });

  it('leaves a full-time colleague completely unaffected', () => {
    const b = ctx.finCompComputeAll()[0].benefits;
    expect(b.pensionCents).toBeGreaterThan(0);
    expect(b.disabilityCents).toBeGreaterThan(0);
    expect(b.healthCents).toBe(1000000);
  });

  it('does not count them toward the group health total', () => {
    const totals = ctx.finCompTotals(ctx.finCompComputeAll());
    expect(totals.healthCents).toBe(1000000); // the full-timer's employee-only premium, alone
  });

  it('adds no pension or disability when costing them up to full scale', () => {
    // Raising a cash-only worker's salary pulls up FICA and nothing else.
    ctx._finCompOverrides = {};
    const computed = ctx.finCompComputeAll();
    const gap = ctx.finCompFullScaleGap(computed);
    const partGap = Math.max(0, (computed[1].worksheetCents || 0) - computed[1].salaryCents);
    const fullGap = Math.max(0, (computed[0].worksheetCents || 0) - computed[0].salaryCents);
    // The benefits that follow the part-timer's gap are FICA only.
    const expected = Math.round(fullGap * (0.117 + 0.012 + 0.0765)) + Math.round(partGap * 0.0765);
    expect(gap.benefitsGapCents).toBe(expected);
  });
});

describe('how a part-timer reads on screen', () => {
  function render(view) {
    ctx.__store['fin-comp-root'] = ctx.__el();
    ctx._finCompView = view;
    ctx.finRenderCompensation();
    return ctx.__store['fin-comp-root'].innerHTML;
  }

  it('is flagged in the pay table rather than looking like an underpaid full-timer', () => {
    const html = render('plan');
    expect(html).toContain('20% time');
    expect(html).toContain('cash only');
  });

  it('is off the health plan entirely, not enrolled at $0', () => {
    const html = render('health');
    expect(html).toContain('Not eligible');
    expect(html).toContain('below the hours floor');
  });

  it('is not held against a full-time market median on the Council summary', () => {
    // Concordia's ranges are full-time figures; comparing a 20% wage to one prints an alarming
    // number that means nothing.
    expect(render('council')).toContain('part-time &mdash; not comparable');
  });

  it('says plainly in the Council report why they draw no benefits', () => {
    const computed = ctx.finCompComputeAll();
    const html = ctx.finCompCouncilReportHtml(computed, ctx.finCompTotals(computed));
    expect(html).toContain('below the hours floor');
    expect(html).toContain('Employer FICA still applies');
    expect(html).toContain('20% time');
  });

  it('offers the controls in the drawer, and warns when FTE and eligibility disagree', () => {
    ctx._finCompSelected = 1;
    expect(render('plan')).toContain('finCompCashOnlyToggle(1');
    expect(render('plan')).toContain('fin-comp-fte-1');
    // A part-timer left benefits-eligible gets a nudge rather than a silent assumption.
    ctx._finSalaryRoster[1].cashOnly = false;
    expect(render('plan')).toContain('still shown as benefits-eligible');
  });
});
