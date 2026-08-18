import { describe, it, expect, beforeEach } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS } from '../src/html-chms.js';

// Regression cover for the Compensation Planner redesign (2026-08 design handoff): five views
// behind one sub-nav, every annual figure entered on "This year's rates", and one deliberate maths
// change — COLA and Custom now grow the worker's CURRENT PAY instead of running the district
// formula, which is why the old tab collapsed three growth columns into one number whenever the
// target year had a published base salary.
//
// Most of what follows is the handoff's own §10 acceptance checks, and §5.12's worked example is
// reproduced to the cent. Runs the real built bundle in a vm rather than extracting single
// functions: these read a dozen module-level globals, so a real load is the only honest way to
// exercise them.

function makeCtx() {
  const store = {};
  const el = () => ({
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, scrollTop: 0, children: [],
    classList: { add() {}, remove() {}, contains() { return false; } },
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
  ctx.__store = store;
  ctx.__el = el;
  return ctx;
}

// The handoff's §5.12 shape: FY2026 base / FY2027 target. Dinger's inputs and reference figures are
// verbatim from the worked example so the numbers below can be checked against the document.
const DINGER_BUDGET_CENTS = 10360000; // $103,600 full-year BUDGET on 58001
function seedState(ctx) {
  ctx._userRole = 'admin';
  ctx._finPlanBaseYear = 2026;
  ctx._finPlanTargetYear = 2027;
  const leaf = (label, actual, budget) => ({
    label, path: 'Expenses > Payroll > ' + label, children: [], classification: 'Expenses',
    hasBudgetInfo: true, totalActualCents: actual, totalBudgetCents: budget,
  });
  ctx._finPlanBaseTree = [{
    label: 'Expenses', path: 'Expenses', classification: 'Expenses', hasBudgetInfo: true,
    totalActualCents: 0, totalBudgetCents: 0,
    children: [
      leaf('58001 Pastor Salary', 10000000, DINGER_BUDGET_CENTS),
      leaf('58010 Church Worker Salaries', 7000000, 7451600),
      leaf('58020 Office Salaries', 5200000, 5420000),
      leaf('59035 Health Insurance', 5000000, 5200000),
    ],
  }];
  ctx._finSalaryRoster = [
    { name: 'Rev. Dinger', position: 'Senior Pastor', role: 'pastor', trackKey: '', education: 'masters',
      yearsExperience: 20, responsibilityStipend: 0, responsibilityStipendKey: 'none', attendanceBonus: 0.075,
      selfEmployedFica: true, hasDependents: true, healthMode: 'family', accountCode: '58001',
      concordia: { position: 'Pastor-Senior Administrative', asOfDate: '07/21/2026',
        churchLcmsLow: '88,068', churchLcmsMid: '103,609', churchLcmsHigh: '119,150',
        churchMarketLow: '111,952', churchMarketMid: '131,708', churchMarketHigh: '151,464' } },
    { name: 'Knapp', position: 'Director of Parish Music', role: 'other', trackKey: 'business_manager_music',
      education: 'bachelors', yearsExperience: 20, responsibilityStipend: 0, responsibilityStipendKey: 'none',
      attendanceBonus: 0, selfEmployedFica: false, hasDependents: true, healthMode: 'family',
      accountCode: '58010',
      concordia: { churchLcmsLow: '67,596', churchLcmsMid: '73,474', churchLcmsHigh: '79,352' } },
    { name: 'Office Secretary', position: 'Parish Administrator', role: 'other', trackKey: 'secretary',
      education: 'associates', yearsExperience: 12, responsibilityStipend: 0, responsibilityStipendKey: 'none',
      attendanceBonus: 0, selfEmployedFica: false, hasDependents: false, healthMode: 'optout',
      accountCode: '58020', concordia: {} },
  ];
  // Every reference figure the worked example names, entered for the planning year.
  ctx._finSalaryReferenceByYear = {
    2027: { pensionPct: 0.117, disabilityDepsPct: 0.0175, disabilityNoDepsPct: 0.012,
            ficaPct: 0.0765, ssaColaPct: 0.028, healthOptOutCents: 600000, baseSalaryCents: 5152900 },
  };
  ctx._finCompMethod = 'cola';
  ctx._finCompPerWorkerMethod = {};
  ctx._finCompOverrides = {};
  ctx._finCompCustomPct = 3.5;
  ctx._finCompView = 'plan';
  ctx._finHealthPlanSelectedOption = 'renewal';
  ctx._finHealthPlanPremiumOverrides = {};
}

// Renders a view and hands back its HTML, the way the real tab does.
function render(ctx, view) {
  ctx.__store['fin-comp-root'] = ctx.__el();
  ctx._finCompView = view;
  ctx.finRenderCompensation();
  return ctx.__store['fin-comp-root'].innerHTML;
}

let ctx;
beforeEach(() => { ctx = makeCtx(); seedState(ctx); });

describe('§5.12 — the worked example, to the cent', () => {
  it('produces exactly the four documented method figures for Rev. Dinger', () => {
    const w = ctx._finSalaryRoster[0];
    expect(ctx.finCompMethodSalaryCents(w, 'none')).toBe(10360000);      // $103,600
    expect(ctx.finCompMethodSalaryCents(w, 'worksheet')).toBe(10738000); // $107,380
    expect(ctx.finCompMethodSalaryCents(w, 'cola')).toBe(10647000);      // $106,470
    expect(ctx.finCompMethodSalaryCents(w, 'custom')).toBe(10725000);    // $107,250
  });

  it('builds the multiplier as scale + attendance band', () => {
    // PASTOR[20] = 2.01, attendance band 150-350 midpoint = 0.075.
    expect(ctx.finCompMultiplier(ctx._finSalaryRoster[0])).toBe(2.085);
  });

  it('costs the church exactly $147,661 for Dinger under COLA', () => {
    const c = ctx.finCompComputeAll()[0];
    expect(c.salaryCents).toBe(10647000);
    expect(c.benefits.pensionCents).toBe(1245699);    // $12,457
    expect(c.benefits.healthCents).toBe(2913048);     // $29,130.48 — medical + own dental + vision
    expect(c.benefits.disabilityCents).toBe(186323);  // $1,863
    expect(c.benefits.ficaCents).toBe(0);             // minister
    expect(c.churchCostCents).toBe(14992070);         // $149,921
  });

  it('reads him as 99% of district scale and 103% of the LCMS median', () => {
    const c = ctx.finCompComputeAll()[0];
    const w = ctx._finSalaryRoster[0];
    expect(ctx.finCompVsScale(c.salaryCents, c.worksheetCents).text).toContain('99% of scale');
    expect(ctx.finCompVsMedian(c.salaryCents, ctx.finCompLcmsRange(w).midCents).text).toContain('103% of median');
  });
});

describe('§5.4 — COLA grows current pay, not the district base', () => {
  it('separates COLA from District Scale even though FY2027 has a published base', () => {
    // This is the whole point of the change. Before it, every growth method ran the district
    // formula, so for a published year all three columns showed the identical number and a COLA
    // could not be expressed at all.
    const w = ctx._finSalaryRoster[0];
    expect(ctx.finCompMethodSalaryCents(w, 'cola')).not.toBe(ctx.finCompMethodSalaryCents(w, 'worksheet'));
    expect(ctx.finCompMethodSalaryCents(w, 'custom')).not.toBe(ctx.finCompMethodSalaryCents(w, 'worksheet'));
    expect(ctx.finCompMethodSalaryCents(w, 'cola')).not.toBe(ctx.finCompMethodSalaryCents(w, 'custom'));
  });

  it('moves COLA when the entered Social Security rate moves', () => {
    const w = ctx._finSalaryRoster[0];
    const at28 = ctx.finCompMethodSalaryCents(w, 'cola');
    ctx._finSalaryReferenceByYear[2027].ssaColaPct = 0.037;
    const at37 = ctx.finCompMethodSalaryCents(w, 'cola');
    expect(at37).toBeGreaterThan(at28);
    // District Scale is a benchmark and must not follow a growth rate at all for a published year.
    expect(ctx.finCompMethodSalaryCents(w, 'worksheet')).toBe(10738000);
  });

  it('keeps District Scale on the TARGET year whichever method is active', () => {
    const underCola = ctx._finSalaryRoster.map(w => ctx.finCompWorksheetCents(w));
    ctx._finCompMethod = 'none';
    expect(ctx._finSalaryRoster.map(w => ctx.finCompWorksheetCents(w))).toEqual(underCola);
  });
});

describe('§10.2 — paycheck rounding', () => {
  it('makes every proposal a whole multiple of a clean $5 paycheck', () => {
    for (const w of ctx._finSalaryRoster) {
      for (const k of ['worksheet', 'cola', 'custom']) {
        expect(ctx.finCompMethodSalaryCents(w, k) % (500 * 26)).toBe(0);
      }
    }
  });

  it('never rounds the "no raise" figure — that is a real budgeted number', () => {
    // Rounding it once reported $74,516 of real budget as $74,490.
    expect(ctx.finCompMethodSalaryCents(ctx._finSalaryRoster[1], 'none')).toBe(7451600);
    expect(7451600 % (500 * 26)).not.toBe(0);
  });
});

describe('§10.3 — a rate change moves everything in one render', () => {
  it('carries a new pension rate into the per-worker figure, the strip and the Council summary', () => {
    const before = ctx.finCompComputeAll()[0].benefits.pensionCents;
    const stripBefore = render(ctx, 'plan');
    const councilBefore = render(ctx, 'council');
    ctx.finCompRefChange(2027, 'pensionPct', '14');
    const after = ctx.finCompComputeAll()[0].benefits.pensionCents;
    expect(after).toBeGreaterThan(before);
    expect(after).toBe(Math.round(10647000 * 0.14));
    const stripAfter = render(ctx, 'plan');
    const councilAfter = render(ctx, 'council');
    expect(stripAfter).not.toBe(stripBefore);
    expect(councilAfter).not.toBe(councilBefore);
    expect(stripAfter).toContain('pension 14.00%');
  });
});

describe('§10.4 — the plan choice only moves enrolled figures', () => {
  it('repricing to Option 1 leaves the opt-out worker untouched', () => {
    const before = ctx.finCompComputeAll();
    // Family tier: $2,051.00/mo x 12, plus this worker's own dental and vision.
    expect(before[0].benefits.healthCents).toBe(2913048);
    expect(before[2].benefits.healthCents).toBe(600000);  // opt-out cash
    ctx.finCompPickPlan('option1');
    const after = ctx.finCompComputeAll();
    expect(after[0].benefits.healthCents).toBe(238815 * 12 + 304680 + 147168);
    expect(after[1].benefits.healthCents).toBe(238815 * 12 + 304680 + 147168);
    expect(after[2].benefits.healthCents).toBe(600000);   // unchanged
  });

  it('does not divide by zero when nobody is enrolled', () => {
    ctx._finSalaryRoster.forEach((w, i) => ctx.finCompSetHealthTier(i, 'optout'));
    expect(ctx.finCompEnrolledCount()).toBe(0);
    ctx.finCompComputeAll().forEach(c => expect(Number.isFinite(c.benefits.healthCents)).toBe(true));
  });
});

describe('§10.5 — a missing reference figure is never silently substituted', () => {
  it('carries forward and names the year it came from, for a year with no published figure', () => {
    // The handoff's own check uses FY2027, but this codebase ships the real published FY2027
    // base salary in LCMS_MO_BASE_SALARY_BY_YEAR, so clearing the entered value there falls back
    // to a genuine FY2027 district figure, not a carry-forward. FY2028 is the first year with
    // nothing published, which is the state the warning actually exists for.
    ctx._finPlanTargetYear = 2028;
    ctx._finCompRefYear = 2028;
    const html = render(ctx, 'rates');
    expect(html).toContain('No figure entered for FY2028 yet');
    expect(html).toContain('carrying $51,529.00 forward from FY2027');
    // $51,529 x 2.085 = $107,437.97, paycheck-rounded to $107,380.
    expect(ctx.finCompWorksheetCents(ctx._finSalaryRoster[0])).toBe(10738000);
  });

  it('says plainly when a year is covered by the published table rather than an entered figure', () => {
    delete ctx._finSalaryReferenceByYear[2027].baseSalaryCents;
    const html = render(ctx, 'rates');
    expect(html).toContain('using the published district figure already on file, $51,529.00');
    expect(html).not.toContain('carrying');
    // ...and the figure is a real FY2027 one, so District Scale is unchanged.
    expect(ctx.finCompWorksheetCents(ctx._finSalaryRoster[0])).toBe(10738000);
  });

  it('lets an entered figure override the published one', () => {
    ctx.finCompRefChange(2027, 'baseSalaryCents', '53000');
    expect(ctx.finCompBaseSalary(2027).dollars).toBe(53000);
    expect(ctx.finCompWorksheetCents(ctx._finSalaryRoster[0])).toBe(11050000); // 53,000 x 2.085 = 110,505, paycheck-rounded to 110,500
  });
});

describe('§5.8 / §10.6 — a half-typed range counts for nothing', () => {
  it('ignores a row with only a Lower figure in both the chart and the verdict', () => {
    const w = ctx._finSalaryRoster[0];
    const before = ctx.finCompUsableRanges(w).length;
    const verdictBefore = ctx.finCompVerdict(w, 10647000).text;
    const fairnessBefore = render(ctx, 'fairness');
    ctx.finCompRangeChange(0, 'districtMarketLow', '99,843'); // no Higher figure typed yet
    expect(ctx.finCompUsableRanges(w).length).toBe(before);
    expect(ctx.finCompVerdict(w, 10647000).text).toBe(verdictBefore);
    expect(render(ctx, 'fairness')).toBe(fairnessBefore);
  });

  it('starts counting the row once its Higher figure arrives', () => {
    ctx.finCompRangeChange(0, 'districtMarketLow', '99,843');
    ctx.finCompRangeChange(0, 'districtMarketHigh', '135,081');
    expect(ctx.finCompUsableRanges(ctx._finSalaryRoster[0]).length).toBe(3);
  });

  it('measures the verdict against the LCMS row specifically, not the first range', () => {
    // Church Market is listed first in the range keys and is much higher; if the verdict read it
    // instead of the LCMS row, Dinger's $106,470 would fall below its $111,952 lower bound and
    // read as "Below the LCMS range" rather than sitting on the midpoint.
    expect(ctx.finCompLcmsRange(ctx._finSalaryRoster[0]).label).toMatch(/LCMS/);
    // $106,470 is +$2,861 on a $103,609 midpoint — 2.76%, inside the 3% band that reads as "at".
    expect(ctx.finCompVerdict(ctx._finSalaryRoster[0], 10647000).text).toBe('At the LCMS midpoint');
    expect(ctx.finCompVerdict(ctx._finSalaryRoster[0], 12000000).text).toContain('above the LCMS midpoint');
    expect(ctx.finCompVerdict(ctx._finSalaryRoster[0], 9000000).text).toContain('vs the LCMS midpoint');
    expect(ctx.finCompVerdict(ctx._finSalaryRoster[0], 5000000).text).toBe('Below every published range');
  });
});

describe('§10.7 — the LCMS-median total counts only workers with a report', () => {
  it('says how many, so a missing report cannot read as being under median', () => {
    const med = ctx.finCompMedianTotal(ctx.finCompComputeAll());
    expect(med.count).toBe(2); // the Office Secretary has no report on file
    expect(med.text).toContain('2 with reports');
    expect(med.medCents).toBe(10360900 + 7347400);
  });
});

describe('§10.8 — a minister pays their own SECA and it is in no total', () => {
  it('shows $0 employer FICA plus a separate display figure', () => {
    const c = ctx.finCompComputeAll()[0];
    expect(c.benefits.ficaCents).toBe(0);
    expect(c.benefits.secaSelfCents).toBe(814496); // $8,145 at 7.65% of $106,470
    expect(c.churchCostCents).toBe(c.salaryCents + c.benefits.pensionCents + c.benefits.healthCents + c.benefits.disabilityCents);
    const totals = ctx.finCompTotals(ctx.finCompComputeAll());
    expect(totals.totalCents).toBe(ctx.finCompComputeAll().reduce((s, x) => s + x.churchCostCents, 0));
  });

  it('does charge employer FICA for a non-minister', () => {
    expect(ctx.finCompComputeAll()[1].benefits.ficaCents).toBeGreaterThan(0);
  });
});

describe('§10.10 — a non-admin sees every figure and can change nothing', () => {
  it('disables every input and select, and hides the write actions', () => {
    ctx._userRole = 'finance';
    for (const view of ['plan', 'health', 'rates']) {
      const html = render(ctx, view);
      const inputs = html.split('<input').slice(1).map(c => c.slice(0, c.indexOf('>')));
      expect(inputs.length).toBeGreaterThan(0);
      expect(inputs.filter(t => !/disabled/.test(t))).toEqual([]);
      const selects = html.split('<select').slice(1).map(c => c.slice(0, c.indexOf('>')))
        // The rates year selector is navigation, not an edit — it changes which year's figures
        // are on screen and writes nothing, so it stays usable for a read-only viewer.
        .filter(t => !/fin-comp-yearsel/.test(t));
      expect(selects.filter(t => !/disabled/.test(t))).toEqual([]);
    }
    const plan = render(ctx, 'plan');
    expect(plan).not.toContain('finCompAddWorker()');
    expect(plan).not.toContain('finCompSendToBudget()');
    // ...but the figures themselves are all still there.
    expect(plan).toContain('$106,470');
  });
});

describe('the five views', () => {
  it('renders each one, with its own sub-nav pill active', () => {
    for (const [view, marker] of [
      ['plan', 'Applied to everyone'],
      ['fairness', 'Is it fair?'],
      ['health', 'Group health plan'],
      ['rates', 'Everything that changes once a year lives here.'],
      ['council', 'Council summary'],
    ]) {
      const html = render(ctx, view);
      expect(html).toContain(marker);
      expect(html).toContain('Compensation Planner &mdash; FY2027');
    }
  });

  it('keeps the totals strip on every view', () => {
    const total = ctx.finCompMoney(ctx.finCompTotals(ctx.finCompComputeAll()).totalCents);
    for (const view of ['plan', 'fairness', 'health', 'rates', 'council']) {
      expect(render(ctx, view)).toContain(total);
    }
  });

  it('resolves an alias-free empty roster without throwing', () => {
    ctx._finSalaryRoster = [];
    expect(render(ctx, 'plan')).toContain('No staff on the roster yet');
  });
});

describe('§7.1 — method and override interactions', () => {
  it('applying a method to everyone clears per-worker methods and hand-set figures', () => {
    ctx.finCompPickMethod(1, 'worksheet');
    ctx.finCompOverrides = ctx._finCompOverrides;
    ctx._finCompOverrides[0] = '99000';
    ctx.finCompApplyMethodToAll('none');
    expect(ctx._finCompPerWorkerMethod).toEqual({});
    expect(ctx._finCompOverrides).toEqual({});
    expect(ctx._finCompMethod).toBe('none');
  });

  it('a per-worker method beats the roster-wide one, for that worker only', () => {
    ctx.finCompPickMethod(1, 'worksheet');
    const computed = ctx.finCompComputeAll();
    expect(computed[1].salaryCents).toBe(ctx.finCompWorksheetCents(ctx._finSalaryRoster[1]));
    expect(computed[0].salaryCents).toBe(ctx.finCompMethodSalaryCents(ctx._finSalaryRoster[0], 'cola'));
  });

  it('a hand-typed figure beats any method, and clears back to it', () => {
    ctx.finCompSalaryOverride(0, '99000');
    expect(ctx.finCompComputeAll()[0].salaryCents).toBe(9900000);
    expect(ctx.finCompOverrideCount()).toBe(1);
    ctx.finCompClearOverride(0);
    expect(ctx.finCompComputeAll()[0].salaryCents).toBe(10647000);
  });

  it('"Set to LCMS midpoint" writes a paycheck-rounded override', () => {
    ctx.finCompMatchMidpoint(0);
    const set = ctx.finCompComputeAll()[0].salaryCents;
    expect(set).toBe(ctx.finRoundSalaryCents(10360900));
    expect(set % (500 * 26)).toBe(0);
  });

  it('re-indexes per-worker methods and overrides when a worker is removed', () => {
    // Both maps are keyed by roster INDEX, so a naive splice would silently move worker 2's
    // settings onto worker 1.
    ctx.finCompPickMethod(2, 'worksheet');
    ctx.finCompSalaryOverride(2, '55000');
    ctx.finCompRemoveWorker(0);
    expect(ctx._finCompPerWorkerMethod[1]).toBe('worksheet');
    expect(ctx._finCompOverrides[1]).toBe('55000');
    expect(ctx._finCompPerWorkerMethod[2]).toBeUndefined();
  });

  it('changing role resets the track and clears a non-pastor attendance bonus', () => {
    ctx.finCompRoleChange(0, 'other');
    expect(ctx._finSalaryRoster[0].trackKey).toBe('secretary');
    expect(ctx._finSalaryRoster[0].attendanceBonus).toBe(0);
    expect(ctx._finSalaryRoster[0].selfEmployedFica).toBe(false);
  });

  it('a responsibility stipend starts at the published midpoint and stays adjustable', () => {
    ctx.finCompStipendChange(1, 'music_director'); // published +5% to +15%
    expect(ctx._finSalaryRoster[1].responsibilityStipend).toBeCloseTo(0.10, 10);
    ctx.finCompStipendPctChange(1, '12');
    expect(ctx._finSalaryRoster[1].responsibilityStipend).toBeCloseTo(0.12, 10);
  });
});

describe('the worker health tier', () => {
  it('derives a mode from the pre-redesign healthEnrolled/hasDependents pair', () => {
    const legacyFamily = { healthEnrolled: true, hasDependents: true };
    const legacyEmployee = { healthEnrolled: true, hasDependents: false };
    const legacyOptOut = { healthEnrolled: false, hasDependents: true };
    expect(ctx.finCompHealthMode(legacyFamily)).toBe('family');
    expect(ctx.finCompHealthMode(legacyEmployee)).toBe('employee');
    expect(ctx.finCompHealthMode(legacyOptOut)).toBe('optout');
  });

  it('keeps the legacy flag in sync when the mode is set explicitly', () => {
    ctx.finCompSetHealthMode(0, 'optout');
    expect(ctx._finSalaryRoster[0].healthMode).toBe('optout');
    expect(ctx._finSalaryRoster[0].healthEnrolled).toBe(false);
  });
});

describe('the saved shape migrates forward', () => {
  it('turns the old roster-wide pension/disability overrides into per-year reference figures', () => {
    // Left as globals they would keep applying with no UI left to clear them.
    ctx._finSalaryReferenceByYear = {};
    ctx.finCompMigrateSavedShape({ pensionPct: 0.125, disabilityPct: 0.02, colaSource: 'ssa' });
    expect(ctx._finSalaryReferenceByYear[2027].pensionPct).toBe(0.125);
    expect(ctx._finSalaryReferenceByYear[2027].disabilityDepsPct).toBe(0.02);
    expect(ctx._finSalaryReferenceByYear[2027].disabilityNoDepsPct).toBe(0.02);
    expect(ctx._finCompMethod).toBe('cola');
  });

  it('maps the old growth-source keys onto the new methods', () => {
    ctx.finCompMigrateSavedShape({ colaSource: 'none' });
    expect(ctx._finCompMethod).toBe('none');
    ctx.finCompMigrateSavedShape({ colaSource: 'custom', colaPct: 0.042 });
    expect(ctx._finCompMethod).toBe('custom');
    expect(ctx._finCompCustomPct).toBeCloseTo(4.2, 10);
  });

  it('never overwrites a figure already entered for the year', () => {
    ctx.finCompMigrateSavedShape({ pensionPct: 0.125 });
    expect(ctx._finSalaryReferenceByYear[2027].pensionPct).toBe(0.117);
  });
});

describe('§5.11 / §8 — the Council report', () => {
  it('costs bringing every below-scale worker up to the district figure', () => {
    const computed = ctx.finCompComputeAll();
    const gap = ctx.finCompFullScaleGap(computed);
    const expectedSalaryGap = computed.reduce((s, c) => s + Math.max(0, (c.worksheetCents || 0) - c.salaryCents), 0);
    expect(gap.salaryGapCents).toBe(expectedSalaryGap);
    // Health premiums do not move with salary, so the benefits gap is pension + disability + FICA
    // only — never a share of the health line.
    expect(gap.benefitsGapCents).toBeLessThan(Math.round(gap.salaryGapCents * 0.25));
    expect(gap.totalCents).toBe(gap.salaryGapCents + gap.benefitsGapCents);
  });

  it('renders all four parts with the real figures embedded in the motion', () => {
    const computed = ctx.finCompComputeAll();
    const totals = ctx.finCompTotals(computed);
    const html = ctx.finCompCouncilReportHtml(computed, totals);
    expect(html).toContain('Fiscal Year 2027 Compensation Plan');
    expect(html).toContain('Recommended motion');
    expect(html).toContain('Salary plan by worker');
    expect(html).toContain('Group health plan');
    expect(html).toContain('Reference figures used');
    expect(html).toContain(ctx.finCompMoney(totals.totalCents));
    // One page per worker, so the per-worker section has to break.
    expect(html.match(/fin-comp-rpt-worker/g)).toHaveLength(3);
  });

  it('labels the cost-to-full-scale figure as an alternative, not a second plan', () => {
    const computed = ctx.finCompComputeAll();
    const html = ctx.finCompCouncilReportHtml(computed, ctx.finCompTotals(computed));
    expect(html).toContain('That is an alternative, not the plan');
  });
});

// A worker whose wages sit INSIDE a budget line shared with other staff — the daycare director
// inside the daycare payroll account. Linking them to that account reads several people's wages as
// one person's pay; leaving them unlinked reads nothing. Either way "no raise" and every % growth
// would be computed off a wrong number, silently.
describe('current pay entered by hand', () => {
  let ctx;
  beforeEach(() => { ctx = makeCtx(); seedState(ctx); });

  it('reads the whole shared line until a figure is entered', () => {
    // 58010 is budgeted $74,516 across several people; Knapp is one of them.
    expect(ctx.finCompCurrentPayCents(ctx._finSalaryRoster[1])).toBe(7451600);
    ctx.finCompCurrentPayChange(1, '38000');
    expect(ctx.finCompCurrentPayCents(ctx._finSalaryRoster[1])).toBe(3800000);
  });

  it('is what "no raise" and every % growth are then computed from', () => {
    ctx.finCompCurrentPayChange(1, '38000');
    expect(ctx.finCompMethodSalaryCents(ctx._finSalaryRoster[1], 'none')).toBe(3800000);
    // COLA grows the entered figure, not the shared line.
    const cola = ctx.finCompMethodSalaryCents(ctx._finSalaryRoster[1], 'cola');
    expect(cola).toBeGreaterThan(3800000);
    expect(cola).toBeLessThan(4100000);
  });

  it('leaves everyone else on their own budget line', () => {
    ctx.finCompCurrentPayChange(1, '38000');
    expect(ctx.finCompCurrentPayCents(ctx._finSalaryRoster[0])).toBe(DINGER_BUDGET_CENTS);
  });

  it('clears back to the budget line, rather than sticking at zero', () => {
    ctx.finCompCurrentPayChange(1, '38000');
    ctx.finCompClearCurrentPay(1);
    expect(ctx._finSalaryRoster[1].actualSalaryCents).toBeUndefined();
    expect(ctx.finCompCurrentPayCents(ctx._finSalaryRoster[1])).toBe(7451600);
    // An emptied box is the same as never having typed one — not $0.
    ctx.finCompCurrentPayChange(1, '38000');
    ctx.finCompCurrentPayChange(1, '');
    expect(ctx.finCompCurrentPayCents(ctx._finSalaryRoster[1])).toBe(7451600);
  });

  it('works for a worker with no budget line at all', () => {
    ctx._finSalaryRoster[1].accountCode = '';
    expect(ctx.finCompCurrentPayCents(ctx._finSalaryRoster[1])).toBe(0);
    ctx.finCompCurrentPayChange(1, '38000');
    expect(ctx.finCompCurrentPayCents(ctx._finSalaryRoster[1])).toBe(3800000);
  });

  it('is saved with the roster, so it survives a reload', () => {
    ctx.finCompCurrentPayChange(1, '38000');
    expect(ctx.finSalaryBuildSaveBody().roster[1].actualSalaryCents).toBe(3800000);
  });

  it('offers the box in the drawer and says which figure is in play', () => {
    ctx.__store['fin-comp-root'] = ctx.__el();
    ctx._finCompView = 'plan';
    ctx._finCompSelected = 1;
    ctx.finRenderCompensation();
    let html = ctx.__store['fin-comp-root'].innerHTML;
    expect(html).toContain('fin-comp-curpay-1');
    expect(html).toContain('other staff are paid from that same line');
    ctx.finCompCurrentPayChange(1, '38000');
    ctx.finRenderCompensation();
    html = ctx.__store['fin-comp-root'].innerHTML;
    expect(html).toContain('entered by hand');
    expect(html).toContain('finCompClearCurrentPay(1)');
  });
});

// Requested: a section under the Council summary table breaking out what the single "Benefits &
// taxes" number is made of. The invariant that matters is reconciliation — a breakdown that does
// not add up to the total printed directly above it is worse than no breakdown at all.
describe('Council summary — benefits & taxes breakdown', () => {
  it('reconciles exactly to the Benefits & taxes total', () => {
    const computed = ctx.finCompComputeAll();
    const totals = ctx.finCompTotals(computed);
    const bd = ctx.finCompBenefitBreakdown(computed);
    expect(bd.totalCents).toBe(totals.benefitsCents);
    expect(bd.rows.reduce((t, r) => t + r.cents, 0)).toBe(totals.benefitsCents);
  });

  it('covers every component finCompBenefits sums, so nothing can go unlisted', () => {
    const computed = ctx.finCompComputeAll();
    const bd = ctx.finCompBenefitBreakdown(computed);
    expect(bd.rows.map(r => r.key)).toEqual(['pension', 'health', 'disability', 'fica']);
    ['pensionCents', 'healthCents', 'disabilityCents', 'ficaCents'].forEach((f, i) => {
      expect(bd.rows[i].cents).toBe(computed.reduce((t, c) => t + c.benefits[f], 0));
    });
  });

  it('counts how many workers each cost actually covers', () => {
    const computed = ctx.finCompComputeAll();
    const bd = ctx.finCompBenefitBreakdown(computed);
    const fica = bd.rows.filter(r => r.key === 'fica')[0];
    // The seeded roster has two ministers (SECA) and one regular employee.
    expect(fica.people).toBe(computed.filter(c => c.benefits.ficaCents > 0).length);
    expect(fica.people).toBeLessThan(ctx._finSalaryRoster.length);
  });

  it('carries the ministers self-paid SECA separately, in no total', () => {
    const computed = ctx.finCompComputeAll();
    const bd = ctx.finCompBenefitBreakdown(computed);
    expect(bd.secaSelfCents).toBeGreaterThan(0);
    expect(bd.totalCents).not.toBe(bd.totalCents + bd.secaSelfCents);
    // It must not be hiding inside the employer FICA line.
    expect(bd.rows.filter(r => r.key === 'fica')[0].cents)
      .toBe(computed.reduce((t, c) => t + c.benefits.ficaCents, 0));
  });

  it('renders under the table on the Council summary, and the printed report agrees', () => {
    const html = render(ctx, 'council');
    const computed = ctx.finCompComputeAll();
    const totals = ctx.finCompTotals(computed);
    const bd = ctx.finCompBenefitBreakdown(computed);
    expect(html).toContain('of benefits &amp; taxes');
    expect(html.indexOf('Vs. LCMS median')).toBeLessThan(html.indexOf('of benefits &amp; taxes'));
    bd.rows.forEach(r => expect(html).toContain(ctx.finCompMoney(r.cents)));
    const report = ctx.finCompCouncilReportHtml(computed, totals);
    expect(report).toContain('of benefits &amp; taxes');
    bd.rows.forEach(r => expect(report).toContain(ctx.finCompMoney(r.cents)));
  });
});

// "Paid from another budget" — a worker (MDO/daycare payroll) who stays on the roster so their
// compensation is planned somewhere, but is carried by a different section and so belongs in no
// church figure. Reported as employer FICA being ~$3,132 too high; the flag exists because
// excluding such a worker from the FICA line alone would leave their salary in the headline total,
// looking fixed while still being wrong.
describe('workers paid from another budget', () => {
  function flag(name) {
    const w = ctx._finSalaryRoster.filter(x => x.name === name)[0];
    w.externallyFunded = true;
    return w;
  }

  it('drops their whole church cost from the total', () => {
    // The Office Secretary is opted out of the group plan, so nothing about the shared group
    // premium moves when they leave — the total falls by exactly what they cost.
    const before = ctx.finCompTotals(ctx.finCompComputeAll());
    const idx = ctx._finSalaryRoster.findIndex(w => w.name === 'Office Secretary');
    const theirs = ctx.finCompComputeAll()[idx];
    flag('Office Secretary');
    const after = ctx.finCompTotals(ctx.finCompComputeAll());
    expect(after.salaryCents).toBe(before.salaryCents - theirs.salaryCents);
    expect(after.benefitsCents).toBe(before.benefitsCents - theirs.benefits.totalCents);
    expect(after.totalCents).toBe(before.totalCents - theirs.churchCostCents);
  });

  it('takes an ENROLLED worker\'s health cost away cleanly, leaving nobody else\'s changed', () => {
    // Dental and vision are per covered worker, so excluding someone removes their own health cost
    // and moves nobody else's. (This replaced a re-sharing test written when those two were modelled
    // as one group bill divided across whoever was enrolled.)
    const before = ctx.finCompTotals(ctx.finCompComputeAll());
    const beforeRows = ctx.finCompComputeAll();
    const idx = ctx._finSalaryRoster.findIndex(w => w.name === 'Knapp');
    const theirs = beforeRows[idx];
    flag('Knapp');
    const after = ctx.finCompTotals(ctx.finCompComputeAll());
    const afterRows = ctx.finCompComputeAll();
    expect(after.healthCents).toBe(before.healthCents - theirs.benefits.healthCents);
    expect(after.totalCents).toBe(before.totalCents - theirs.churchCostCents);
    // The pastor's own health figure is untouched by his colleague leaving the plan.
    expect(afterRows[0].benefits.healthCents).toBe(beforeRows[0].benefits.healthCents);
  });

  it('removes them from every benefit line and from the counted denominator', () => {
    const idx = ctx._finSalaryRoster.findIndex(w => w.name === 'Knapp');
    const theirs = ctx.finCompComputeAll()[idx];
    const before = ctx.finCompBenefitBreakdown(ctx.finCompComputeAll());
    flag('Knapp');
    const after = ctx.finCompBenefitBreakdown(ctx.finCompComputeAll());
    expect(after.countedCount).toBe(before.countedCount - 1);
    const pick = (bd, k) => bd.rows.filter(r => r.key === k)[0].cents;
    expect(pick(after, 'fica')).toBe(pick(before, 'fica') - theirs.benefits.ficaCents);
    expect(pick(after, 'pension')).toBe(pick(before, 'pension') - theirs.benefits.pensionCents);
    expect(pick(after, 'disability')).toBe(pick(before, 'disability') - theirs.benefits.disabilityCents);
    // Health is deliberately not asserted here — see the group dental/vision test above.
  });

  it('still reconciles to the Benefits & taxes tile after excluding someone', () => {
    flag('Knapp');
    const computed = ctx.finCompComputeAll();
    expect(ctx.finCompBenefitBreakdown(computed).totalCents).toBe(ctx.finCompTotals(computed).benefitsCents);
  });

  it('takes them off the group health plan contract count', () => {
    const before = ctx.finCompEnrolledCount();
    flag('Knapp'); // family tier in the seed, so a real contract
    expect(ctx.finCompEnrolledCount()).toBe(before - 1);
  });

  it('leaves them out of the district-scale and LCMS-median comparisons', () => {
    const beforeMed = ctx.finCompMedianTotal(ctx.finCompComputeAll());
    const beforeWorksheet = ctx.finCompTotals(ctx.finCompComputeAll()).worksheetCents;
    flag('Knapp'); // has a Concordia range on file in the seed
    const afterMed = ctx.finCompMedianTotal(ctx.finCompComputeAll());
    expect(afterMed.count).toBe(beforeMed.count - 1);
    expect(ctx.finCompTotals(ctx.finCompComputeAll()).worksheetCents).toBeLessThan(beforeWorksheet);
  });

  it('deliberately does NOT change the FY base-year comparison figure', () => {
    // That number is read off the church's real payroll accounts, not off this roster. Silently
    // adjusting it here would invent a figure no account supports.
    const before = ctx.finCompTotals(ctx.finCompComputeAll()).baselineCents;
    flag('Knapp');
    expect(ctx.finCompTotals(ctx.finCompComputeAll()).baselineCents).toBe(before);
  });

  it('keeps the worker visible and named, on screen and in the printed report', () => {
    flag('Knapp');
    const html = render(ctx, 'council');
    expect(html).toContain('Knapp');
    expect(html).toContain('paid from another budget');
    expect(html).toContain('Not counted above');
    const computed = ctx.finCompComputeAll();
    const report = ctx.finCompCouncilReportHtml(computed, ctx.finCompTotals(computed));
    expect(report).toContain('Knapp');
    expect(report).toContain('Not counted in any figure above');
  });

  it('is off by default, so nothing changes for an existing roster', () => {
    expect(ctx._finSalaryRoster.some(w => ctx.finCompIsExternallyFunded(w))).toBe(false);
    expect(ctx.finCompCountedCount()).toBe(ctx._finSalaryRoster.length);
  });
});

// Reported: under "No raise" the plan came out 6.1% BELOW the base year. A single net figure cannot
// say whether the salaries disagree or the benefits do, and those have different causes — so the
// base-year note now splits it, and two display bugs visible on the same screen are fixed.
describe('diagnosing a base-year gap', () => {
  function addLeaf(label, actualCents, budgetCents) {
    ctx._finPlanBaseTree[0].children.push({
      label, path: 'Expenses > ' + label, children: [], classification: 'Expenses',
      hasBudgetInfo: budgetCents != null, totalActualCents: actualCents, totalBudgetCents: budgetCents || 0,
    });
  }

  it('splits the base year into a salary side and a benefits side', () => {
    addLeaf('59030 Concordia Retirement Plan', 1800000, 2800000);
    addLeaf('59040 Payroll Taxes', 500000, 800000);
    const b = ctx.finCompBaselineDetail();
    // Pension and employer taxes are pooled costs, never wages.
    expect(b.benefitCents).toBeGreaterThan(0);
    expect(b.salaryCents).toBeGreaterThan(0);
    expect(b.salaryCents + b.benefitCents).toBe(b.cents);
    const pooled = b.countedRows.filter(r => r.kind === 'benefit').map(r => r.label);
    expect(pooled).toContain('59030 Concordia Retirement Plan');
    expect(pooled).toContain('59040 Payroll Taxes');
  });

  it('says which side the gap is on, under the Set pay table', () => {
    addLeaf('59030 Concordia Retirement Plan', 1800000, 9000000); // deliberately far above the plan
    const html = render(ctx, 'plan');
    expect(html).toContain('Where the difference is');
    expect(html).toContain('Most of the gap is on the <b>benefits</b> side');
  });

  it('only says "annualized" when an account actually was', () => {
    // Every seeded account carries its own full-year budget, so nothing is annualized even though
    // the base year is in progress — the label used to appear regardless.
    const b = ctx.finCompBaselineDetail();
    expect(b.countedRows.every(r => r.basis === 'budget')).toBe(true);
    expect(b.anyAnnualized).toBe(false);
    // The label itself is the fix — it used to appear whenever the base year was in progress,
    // regardless of whether any account had actually been annualized.
    expect(render(ctx, 'plan')).not.toContain('(annualized)');
    // An account with actuals and no budget is the case that genuinely is annualized.
    addLeaf('58060 Nursery Wages', 1000000, null);
    const after = ctx.finCompBaselineDetail();
    if (after.prorated) {
      expect(after.anyAnnualized).toBe(true);
      expect(render(ctx, 'plan')).toContain('(annualized)');
    }
  });

  it('renders the worker subtitle as text, not as escaped markup', () => {
    ctx._finCompSelected = 0;
    ctx._finCompDrawerOpen = true;
    const html = render(ctx, 'plan');
    expect(html).toContain('Senior Pastor');
    expect(html).not.toContain('&amp;middot;');
  });
});
