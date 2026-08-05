import { describe, it, expect, beforeAll } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS } from '../src/html-chms.js';

// Regression cover for the Compensation tab rework (Salary Options / MO District Calculator /
// Concordia Plans Comparisons). Every assertion here inverts against the code that shipped before
// it — the markers checked below (`fin-salary-actual-`, the " Acct Actual" column header) existed
// then and are gone now; the new headings did not exist then and do exist now.
//
// The behavioural one that matters most: the district calculator used to render whatever the
// ACTIVE Salary Options scenario resolved to, so with "None (flat)" active it showed the base
// year's budget figure — reported as "that calculator ends up with 2026 numbers." It now always
// runs the district formula for the TARGET year, independent of the active scenario.
//
// Runs the real built bundle in a vm rather than extracting single functions: these are render
// functions reading a dozen module-level globals, so a real load is the only honest way to
// exercise them.

function makeCtx() {
  const el = () => ({
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, scrollTop: 0, children: [],
    classList: { add() {}, remove() {}, contains() { return false; } },
    appendChild() {}, addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getAttribute() { return null; }, setAttribute() {}, focus() {}, setSelectionRange() {},
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

// The church's real shape: FY2026 base / FY2027 target, three workers each tied to a real payroll
// account whose FULL-YEAR BUDGETED figure is what "None (flat)" is supposed to show.
const BUDGET_CENTS = { '58001': 9880000, '58002': 7451600, '58003': 7303400 };
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
      leaf('58001 Pastor Salary', 5684800, BUDGET_CENTS['58001']),
      leaf('58002 Music Salary', 4293654, BUDGET_CENTS['58002']),
      leaf('58003 DCE Salary', 4196400, BUDGET_CENTS['58003']),
    ],
  }];
  ctx._finSalaryRoster = [
    { name: 'Dinger', role: 'pastor', trackKey: '', yearsExperience: 20, responsibilityStipend: 0, attendanceBonus: 0, selfEmployedFica: true, hasDependents: true, accountCode: '58001', healthEnrolled: true },
    { name: 'Knapp', role: 'other', trackKey: 'business_manager_music', yearsExperience: 20, responsibilityStipend: 0, attendanceBonus: 0, selfEmployedFica: false, hasDependents: true, accountCode: '58002', healthEnrolled: true },
    { name: 'Thompson', role: 'commissioned', trackKey: 'bs20', yearsExperience: 22, responsibilityStipend: 0.15, attendanceBonus: 0, selfEmployedFica: true, hasDependents: false, accountCode: '58003', healthEnrolled: true },
  ];
  ctx._finSalaryColaSource = 'none';
  ctx._finSalaryColaPct = 0;
  ctx.finConcordiaSeedRoster();
}

let ctx, html, concordiaHtml;
beforeAll(() => {
  ctx = makeCtx();
  seedState(ctx);
  html = ctx.finRenderSalaryCalculator(true);
  concordiaHtml = ctx.finRenderConcordiaComparisons();
});

describe('Salary Options', () => {
  it('is labelled', () => {
    expect(html).toContain('>Salary Options<');
  });

  it('has no editable input in the "None (flat)" column — that figure is imported, not planned', () => {
    expect(html).not.toContain('fin-salary-actual-');
  });

  it('reports the linked account\'s full-year budget EXACTLY, to the cent', () => {
    // The per-paycheck $5 rounding (FIN43) was being applied to the imported figure too, so
    // $74,516 of real budget displayed as $74,490 and $73,034 as $73,060. Only a PROPOSAL should
    // be rounded to a clean paycheck; an imported figure is reported as it stands.
    const computed = ctx.finSalaryComputeAll(0, 0.117, null);
    expect(computed.map(c => c.calc.salaryCents)).toEqual([
      BUDGET_CENTS['58001'], BUDGET_CENTS['58002'], BUDGET_CENTS['58003'],
    ]);
    expect(html).toContain('74,516.00');
    expect(html).not.toContain('74,490.00');
  });

  it('still rounds a formula PROPOSAL to a whole multiple of a clean $5 paycheck', () => {
    ctx._finSalaryRoster.forEach(w => {
      const proposal = ctx.finDistrictProposalCents(w);
      expect(proposal % (500 * 26)).toBe(0);
    });
  });

  it('carries each Concordia range midpoint up as a reference column', () => {
    expect(html).toContain('Concordia midpoint');
    expect(html).toContain('103,609.00'); // Dinger, Church LCMS Range midpoint
    expect(html).toContain('73,474.00');  // Knapp, Church LCMS Range midpoint
    expect(html).toContain('69,367.00');  // Thompson, Church LCMS Range midpoint
  });

  it('only offers a Concordia column for a range some worker actually has data for', () => {
    // Only the pastor report carries a District section, so those two columns appear; a roster
    // with no Concordia data at all must produce none.
    const bare = makeCtx();
    seedState(bare);
    bare._finSalaryRoster.forEach(w => { w.concordia = {}; });
    expect(bare.finRenderSalaryCalculator(true)).not.toContain('Concordia midpoint');
  });
});

describe('MO District Calculator', () => {
  it('is labelled and drops the redundant base-year account column', () => {
    expect(html).toContain('MO District Calculator');
    expect(html).not.toContain(' Acct Actual</th>');
  });

  it('proposes the TARGET year, not the base year, even while "None (flat)" is active', () => {
    const computed = ctx.finSalaryComputeAll(0, 0.117, null);
    computed.forEach((c, i) => {
      expect(c.districtProposalCents).not.toBeNull();
      // The bug: this used to equal the base-year budget figure.
      expect(c.districtProposalCents).not.toBe(c.calc.salaryCents);
    });
    expect(html).toContain('FY2027 District Proposal');
  });

  it('is unaffected by which scenario is active — it is a benchmark, not a choice', () => {
    const underNone = ctx._finSalaryRoster.map(w => ctx.finDistrictProposalCents(w));
    ctx._finSalaryColaSource = 'lcms';
    ctx._finSalaryColaPct = ctx.finLcmsHistoricalAvgGrowthPct();
    const underLcms = ctx._finSalaryRoster.map(w => ctx.finDistrictProposalCents(w));
    ctx._finSalaryColaSource = 'none';
    ctx._finSalaryColaPct = 0;
    // FY2027 has an exact published district base salary, so no growth rate can move it.
    expect(underLcms).toEqual(underNone);
  });

  it('feeds its proposal into the Salary Options district columns', () => {
    const proposal = ctx.finDistrictProposalCents(ctx._finSalaryRoster[0]);
    expect(html).toContain('$' + ctx.finFmtMoney(proposal / 100));
  });

  it('keeps the per-worker benefit toggles reachable after moving them to Total Compensation', () => {
    expect(html).toContain('finSalaryFicaToggle');
    expect(html).toContain('finSalaryDependentsToggle');
    expect(html).toContain('finSalaryHealthEnrolledToggle');
  });
});

describe('Concordia Plans Comparisons', () => {
  it('renders a card with one chart per worker', () => {
    expect(concordiaHtml).toContain('Concordia Plans Comparisons');
    expect(concordiaHtml.match(/<svg /g)).toHaveLength(3);
  });

  it('plots only the ranges a worker actually has — 4 for the pastor, 2 each for the others', () => {
    // Concordia's parish-professional report has no District section at all.
    expect(concordiaHtml.match(/rx="8"/g)).toHaveLength(8);
  });

  it('transcribes the real 2026-07-21 reports', () => {
    expect(concordiaHtml).toContain('101,217'); // Dinger, District Range midpoint
    expect(concordiaHtml).toContain('131,708'); // Dinger, Church Market Range midpoint
    expect(concordiaHtml).toContain('88,467');  // Knapp, Church Market Range higher
    expect(concordiaHtml).toContain('78,252');  // Thompson, Church Market Range lower
  });

  it('marks each chart with what the church budgets today', () => {
    expect(concordiaHtml).toContain('98,800.00');
  });

  it('never overwrites figures an admin has already edited', () => {
    const edited = makeCtx();
    seedState(edited);
    edited._finSalaryRoster[0].concordia = { churchLcmsMid: '999,999' };
    edited.finConcordiaSeedRoster();
    expect(edited._finSalaryRoster[0].concordia.churchLcmsMid).toBe('999,999');
  });

  it('reads a figure however it was typed off the PDF', () => {
    expect(ctx.finConcordiaParseMoneyCents('$103,609')).toBe(10360900);
    expect(ctx.finConcordiaParseMoneyCents('103609.00')).toBe(10360900);
    expect(ctx.finConcordiaParseMoneyCents('')).toBeNull();
    expect(ctx.finConcordiaParseMoneyCents(null)).toBeNull();
  });
});
