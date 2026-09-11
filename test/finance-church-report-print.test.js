import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS, CHMS_APP_FINANCE_JS } from '../src/html-chms.js';
import { HTML_HEAD } from '../src/frontend/html-head.js';

// Church Report print sheet — third section for the Full Report picker (see
// test/finance-full-report.test.js), following the same dedicated-print-sheet idiom as Budget and
// Financial Health. finChurchRptBuildPrintSheetHtml() reuses most of finRenderChurchThisYear()'s
// own render helpers unchanged (they're already pure report content), with trimmed finChurchRpt*
// variants only for the two pieces that have an interactive-only affordance on screen
// (finRenderExpensePace's click-to-drill-down rows, finGivingFundGroupRows' click-to-expand fund
// groups) and a forced second physical page for the multi-year comparison.

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
function el() {
  return {
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, scrollTop: 0, children: [],
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    appendChild() {}, addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getAttribute() { return null; }, setAttribute() {}, focus() {}, setSelectionRange() {},
  };
}
function loadBundle(store) {
  const document = {
    getElementById(id) { return store[id] || null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement: el, addEventListener() {}, body: el(), documentElement: el(), activeElement: null,
  };
  const ctx = {
    document, console, setTimeout, clearTimeout, Math, JSON, Date, parseFloat, parseInt, isFinite,
    Number, String, Object, Array, encodeURIComponent, decodeURIComponent,
    localStorage: { getItem() { return null; }, setItem() {} },
    fetch: () => Promise.resolve({ status: 200, ok: true, json: async () => ({ ok: true }) }),
    navigator: {}, location: { href: '', hash: '' },
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, requestAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
    confirm: () => true, alert() {}, print() {},
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_CORE_JS, ctx, { filename: 'app-core.js' });
  vm.runInContext(CHMS_APP_EXT_JS, ctx, { filename: 'app-ext.js' });
  vm.runInContext(CHMS_APP_FINANCE_JS, ctx, { filename: 'app-finance.js' });
  return ctx;
}

function churchYearFixture() {
  return {
    year: 2026,
    entries: [
      // Explicit 'Income'/'Expenses' root rows, matching real QuickBooks-derived data —
      // finBuildTreeFromFlatRows nests a leaf under the nearest ANCESTOR PATH that has its own
      // row; without one for 'Income' itself, two same-classification leaves become two separate
      // top-level roots instead of nesting under one, which is not how production data looks.
      { category_path: 'Income', account_name: 'Income', classification: 'Income', depth: 0, own_actual_cents: 0, own_budget_cents: null },
      { category_path: 'Income:40085 Sunday Offering', account_name: '40085 Sunday Offering', classification: 'Income', depth: 1, own_actual_cents: 27393172, own_budget_cents: 42500000 },
      { category_path: 'Income:47020 MDO Tuition', account_name: '47020 MDO Tuition', classification: 'Income', depth: 1, own_actual_cents: 5000000, own_budget_cents: 5000000 },
      { category_path: 'Expenses', account_name: 'Expenses', classification: 'Expenses', depth: 0, own_actual_cents: 0, own_budget_cents: null },
      { category_path: 'Expenses:51010 Pastoral Salaries', account_name: '51010 Pastoral Salaries', classification: 'Expenses', depth: 1, own_actual_cents: 20140000, own_budget_cents: 20140000 },
      { category_path: 'Expenses:52010 Utilities', account_name: '52010 Utilities', classification: 'Expenses', depth: 1, own_actual_cents: 6840000, own_budget_cents: 8600000 },
    ],
    classificationTotals: {
      Income: { actualCents: 32393172, budgetCents: 47500000 },
      Expenses: { actualCents: 26980000, budgetCents: 28740000 },
    },
    netIncome: { actualCents: 5413172, budgetCents: 18760000 },
    hasBudgetData: true,
    givingCents: 27000000,
    givingByFund: [
      { fundName: 'General Fund', cents: 25000000 },
      { fundName: 'Comfort Dog Fund', cents: 1000000 },
      { fundName: 'Tuition Aid Fund', cents: 1000000 },
    ],
    yoy: {
      available: true, throughMonth: 8,
      income: { currentYtdCents: 27393172, priorYtdCents: 25000000, priorFullYearCents: 40000000, projectedFullYearCents: 42000000 },
      expenses: { currentYtdCents: 26980000, priorYtdCents: 26000000, priorFullYearCents: 41000000, projectedFullYearCents: 40500000 },
      net: { currentYtdCents: 413172, priorYtdCents: -1000000, priorFullYearCents: -1000000, projectedFullYearCents: 1500000 },
    },
    supplies: { monthly: [], currentYtdCents: 0, priorYtdCents: 0 },
  };
}
function churchMultiYearFixture() {
  return {
    years: [2024, 2025, 2026],
    byYear: {
      2024: { classificationTotals: { Income: { actualCents: 36500000, budgetCents: 36000000 }, Expenses: { actualCents: 35000000, budgetCents: 35500000 } }, netIncome: { actualCents: 1500000, budgetCents: 500000 }, hasBudgetData: true },
      2025: { classificationTotals: { Income: { actualCents: 39000000, budgetCents: 38000000 }, Expenses: { actualCents: 37500000, budgetCents: 37000000 } }, netIncome: { actualCents: 1500000, budgetCents: 1000000 }, hasBudgetData: true },
      2026: { classificationTotals: { Income: { actualCents: 27393172, budgetCents: 42500000 }, Expenses: { actualCents: 26980000, budgetCents: 28740000 } }, netIncome: { actualCents: 413172, budgetCents: 13760000 }, hasBudgetData: true },
    },
  };
}
function churchSetup() {
  const churchRoot = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
  const printsheetRoot = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
  const fin = loadBundle({ 'fin-church-year-view': churchRoot, 'fin-church-printsheet-root': printsheetRoot });
  fin._finChurchThisYearData = churchYearFixture();
  fin._userRole = 'admin';
  return { fin, churchRoot, printsheetRoot };
}

describe('Church Report print sheet — content', () => {
  it('shows a placeholder, not a crash, when there is no church data yet', () => {
    const { fin } = churchSetup();
    fin._finChurchThisYearData = null;
    const html = fin.finChurchRptBuildPrintSheetHtml();
    expect(html).toContain('fin-church-rpt');
    expect(html).toMatch(/No church report data/i);
  });

  it('includes the three KPI tiles, revenue sources, and expense pace, with every expense category always expanded (no click-to-drill affordance)', () => {
    const { fin } = churchSetup();
    const html = fin.finChurchRptBuildPrintSheetHtml();
    expect(html).toContain('Total revenue');
    expect(html).toContain('Total expenses');
    expect(html).toContain('Net income');
    expect(html).toContain('Revenue sources');
    expect(html).toContain('Where expenses sit against budget');
    expect(html).toContain('51010 Pastoral Salaries');
    expect(html).toContain('52010 Utilities');
    // The live page's click-to-drill-down row has role="button"/onclick/onkeydown — none of that
    // belongs in a static printed page.
    expect(html).not.toContain('finOverviewToggleDrill');
    expect(html).not.toContain('role="button"');
  });

  it('includes the full account detail table and the giving-by-fund table, with fund groups always expanded (no click-to-expand affordance)', () => {
    const { fin } = churchSetup();
    const html = fin.finChurchRptBuildPrintSheetHtml();
    expect(html).toContain('Full account detail');
    expect(html).toContain('40085 Sunday Offering');
    expect(html).toContain('Giving by fund');
    expect(html).toContain('Comfort Dog Fund');
    expect(html).toContain('Tuition Aid Fund');
    // The live page's fund-code group header is display:none-toggled via onclick; a print sheet
    // has no way to click anything, so every fund must already be visible in the markup.
    expect(html).not.toContain('finToggleGivingFundGroup');
    expect(html).not.toContain('style="display:none;"');
  });

  it('includes the year-over-year comparison when available', () => {
    const { fin } = churchSetup();
    const html = fin.finChurchRptBuildPrintSheetHtml();
    expect(html).toContain('This year vs. last year');
    expect(html).toContain('Revenue');
    expect(html).toContain('Net Income');
  });

  it('drops the collapsed-by-default "Show detail" button entirely — every section just prints already open', () => {
    const { fin } = churchSetup();
    const html = fin.finChurchRptBuildPrintSheetHtml();
    expect(html).not.toContain('finChurchToggleDetail');
    expect(html).not.toContain('Show detail');
  });
});

describe('Church Report print sheet — multi-year page', () => {
  it('is omitted entirely when no multi-year data is loaded', () => {
    const { fin } = churchSetup();
    fin._finChurchMultiYearData = null;
    const html = fin.finChurchRptBuildPrintSheetHtml();
    expect(html).not.toContain('Multi-Year Comparison');
    expect(html).not.toContain('fin-plan-rpt-newpage');
  });

  it('is appended as a forced new page when multi-year data is loaded, with the from/to range picker dropped', () => {
    const { fin } = churchSetup();
    fin._finChurchMultiYearData = churchMultiYearFixture();
    const html = fin.finChurchRptBuildPrintSheetHtml();
    expect(html).toContain('Multi-Year Comparison');
    expect(html).toContain('fin-plan-rpt-newpage');
    expect(html).not.toContain('fin-church-my-from');
    expect(html).not.toContain('fin-church-my-to');
    expect(html).not.toContain('Load Range');
    // Multi-year figures for all three years appear.
    expect(html).toContain('2024');
    expect(html).toContain('2025');
    expect(html).toContain('2026');
  });

  it('feeds the year page\'s own five-year net income chart too, once multi-year data is available', () => {
    const { fin } = churchSetup();
    fin._finChurchMultiYearData = churchMultiYearFixture();
    const html = fin.finChurchRptBuildPrintSheetHtml();
    expect(html).toContain('Five-year net income');
  });
});

describe('Church Report print sheet — finChurchRptPrint', () => {
  it('builds the sheet into #fin-church-printsheet-root, marks body.printing-church, and cleans up after printing', async () => {
    const { fin, printsheetRoot } = churchSetup();
    const bodyClasses = [];
    fin.document.body.classList.add = (c) => bodyClasses.push(c);
    fin.document.body.classList.remove = (c) => { const i = bodyClasses.indexOf(c); if (i > -1) bodyClasses.splice(i, 1); };
    let printed = false;
    fin.print = () => { printed = true; };
    fin.finChurchRptPrint();
    expect(printsheetRoot.innerHTML).toContain('fin-church-rpt');
    expect(printsheetRoot.innerHTML).toContain('Pastoral Salaries');
    expect(bodyClasses).toEqual(['printing-church']);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(printed).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(bodyClasses).toEqual([]);
    expect(printsheetRoot.innerHTML).toBe('');
  }, 2000);

  it('is a no-op when the print-sheet mount is missing from the DOM', () => {
    const fin = loadBundle({});
    fin._finChurchThisYearData = churchYearFixture();
    expect(() => fin.finChurchRptPrint()).not.toThrow();
  });
});

// Same class of bug this app has hit before on the Budget/Financial Health print sheets: a rule
// that hides the whole panel (or misses a sibling) before the print sheet ever gets to show.
// Church Report needs only ONE level of nesting (not two, like Budget/Health/Full Report) because
// #fin-church-printsheet-root is a plain STATIC sibling of #fin-church-header/-year-view/
// -multiyear-view, not a grandchild injected by a single render function — see the comment on it
// in html-tabs.js and on body.printing-church in html-head.js.
describe('body.printing-church CSS contract', () => {
  it('hides every other tab, and every other child of #fin-panel-church, while forcing the print-sheet root visible', () => {
    expect(HTML_HEAD).toMatch(/body\.printing-church \.tab-panel:not\(#tab-finance\)\{display:none!important;\}/);
    expect(HTML_HEAD).toMatch(/body\.printing-church #tab-finance\{display:block!important;\}/);
    expect(HTML_HEAD).toMatch(/body\.printing-church #tab-finance > div > div > div:not\(#fin-panel-church\)\{display:none!important;\}/);
    expect(HTML_HEAD).toMatch(/body\.printing-church #fin-panel-church > \*:not\(#fin-church-printsheet-root\)\{display:none!important;\}/);
    expect(HTML_HEAD).toMatch(/body\.printing-church #fin-church-printsheet-root\{display:block!important;\}/);
  });

  it('#fin-church-printsheet-root is hidden on screen by default', () => {
    expect(HTML_HEAD).toMatch(/\.fin-church-printsheet-root\{display:none;\}/);
  });

  it('reuses the same single-column/break-inside-avoid print rules Financial Health already established for .fin-card/.fin-grid-*, extended to .fin-church-rpt rather than duplicated', () => {
    const gridRule = HTML_HEAD.match(/\.fin-health-rpt \.fin-grid-3[^{]*\{grid-template-columns:1fr!important;\}/);
    expect(gridRule).toBeTruthy();
    expect(gridRule[0]).toContain('.fin-church-rpt .fin-grid-3');
    expect(gridRule[0]).toContain('.fin-church-rpt .fin-grid-2');
    const cardRule = HTML_HEAD.match(/\.fin-health-rpt \.fin-card[^{]*\{break-inside:avoid;margin-bottom:14px;\}/);
    expect(cardRule).toBeTruthy();
    expect(cardRule[0]).toContain('.fin-church-rpt .fin-card');
  });
});
