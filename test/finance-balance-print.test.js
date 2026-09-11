import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS, CHMS_APP_FINANCE_JS } from '../src/html-chms.js';
import { HTML_HEAD } from '../src/frontend/html-head.js';

// Balance Sheet print sheet — fourth section for the Full Report picker (see
// test/finance-full-report.test.js), following the same dedicated-print-sheet idiom as Budget,
// Financial Health, and Church Report. Unlike Church Report, almost every helper
// finBalanceBuildPrintSheetHtml() reuses (finRenderBalanceTreeRows, the chart/growth-table
// builders) is already pure — the only screen-only pieces on the live tab are the Year/Trend
// range picker and the "Hide zero-balance lines"/"Hide individual lines…" detail toolbar, both
// plain interactive controls with no print equivalent, so the print sheet simply never calls
// finRenderBalanceRangePicker or finRenderBalanceManagePanel. Same two-level printing-<feature>
// CSS nesting as Budget/Health/Full Report (finRenderBalanceSheetTab rebuilds #fin-balance-root's
// whole innerHTML on every render, same as those), not Church Report's one-level exception.

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

function balanceFixture() {
  return {
    year: 2026,
    asOfDate: '2026-08-31',
    rows: [
      { category_path: 'Assets', account_name: 'Assets', classification: 'Assets', depth: 0, own_balance_cents: 0 },
      { category_path: 'Assets:11027 Lindell Checking', account_name: '11027 Lindell Checking', classification: 'Assets', depth: 1, own_balance_cents: 8212649 },
      { category_path: 'Assets:15000 Building at Cost', account_name: '15000 Building at Cost', classification: 'Assets', depth: 1, own_balance_cents: 30000000 },
      { category_path: 'Liabilities', account_name: 'Liabilities', classification: 'Liabilities', depth: 0, own_balance_cents: 0 },
      { category_path: 'Liabilities:21000 Accounts Payable', account_name: '21000 Accounts Payable', classification: 'Liabilities', depth: 1, own_balance_cents: 1181205 },
      { category_path: 'Equity', account_name: 'Equity', classification: 'Equity', depth: 0, own_balance_cents: 0 },
      { category_path: 'Equity:31000 Retained Earnings', account_name: '31000 Retained Earnings', classification: 'Equity', depth: 1, own_balance_cents: 37031444 },
    ],
    summary: { assetsCents: 38212649, liabilitiesCents: 1181205, equityCents: 37031444, balancedCents: 0 },
    equityReclass: null,
  };
}
function balanceMultiYearFixture() {
  return {
    years: [2024, 2025, 2026],
    byYear: {
      2024: { assetsCents: 36000000, currentAssetsCents: 6000000, fixedAssetsCents: 30000000, otherAssetsCents: 0, liabilitiesCents: 1500000, equityCents: 34500000 },
      2025: { assetsCents: 37000000, currentAssetsCents: 7000000, fixedAssetsCents: 30000000, otherAssetsCents: 0, liabilitiesCents: 1300000, equityCents: 35700000 },
      2026: { assetsCents: 38212649, currentAssetsCents: 8212649, fixedAssetsCents: 30000000, otherAssetsCents: 0, liabilitiesCents: 1181205, equityCents: 37031444 },
    },
    cashByYear: {
      2024: { operatingCents: 6000000, allCashCents: 6000000, allCashAccounts: ['11027 Lindell Checking'] },
      2025: { operatingCents: 7000000, allCashCents: 7000000, allCashAccounts: ['11027 Lindell Checking'] },
      2026: { operatingCents: 8212649, allCashCents: 8212649, allCashAccounts: ['11027 Lindell Checking'] },
    },
    reconciliation: {
      checked: 2, matched: 2,
      rows: [
        { year: 2025, prior_equity_cents: 34500000, equity_cents: 35700000, change_cents: 1200000, net_income_cents: 1200000, status: 'ok' },
        { year: 2026, prior_equity_cents: 35700000, equity_cents: 37031444, change_cents: 1331444, net_income_cents: 1331444, status: 'ok' },
      ],
    },
  };
}
function balanceSetup() {
  const balanceRoot = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
  const printsheetRoot = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
  const fin = loadBundle({ 'fin-balance-root': balanceRoot, 'fin-balance-printsheet-root': printsheetRoot });
  fin._finBalanceData = balanceFixture();
  fin._finBalanceHiddenPaths = {};
  fin._finBalanceHideZero = false;
  fin._userRole = 'admin';
  return { fin, balanceRoot, printsheetRoot };
}

describe('Balance Sheet print sheet — content', () => {
  it('shows a placeholder, not a crash, when there is no balance sheet imported yet', () => {
    const { fin } = balanceSetup();
    fin._finBalanceData = null;
    const html = fin.finBalanceBuildPrintSheetHtml();
    expect(html).toContain('fin-balance-rpt');
    expect(html).toMatch(/No balance sheet imported/i);
  });

  it('includes the Assets/Liabilities/Equity KPIs and the balance check line', () => {
    const { fin } = balanceSetup();
    const html = fin.finBalanceBuildPrintSheetHtml();
    expect(html).toContain('Assets');
    expect(html).toContain('Liabilities');
    expect(html).toContain('Equity');
    expect(html).toContain('Balances (Assets = Liabilities + Equity)');
  });

  it('includes the full account detail table with every account always shown, and no toolbar or management-panel affordances', () => {
    const { fin } = balanceSetup();
    const html = fin.finBalanceBuildPrintSheetHtml();
    expect(html).toContain('Full Account Detail');
    expect(html).toContain('11027 Lindell Checking');
    expect(html).toContain('15000 Building at Cost');
    expect(html).toContain('21000 Accounts Payable');
    expect(html).toContain('31000 Retained Earnings');
    // The live tab's screen-only toolbar/management panel have no print equivalent.
    expect(html).not.toContain('Hide zero-balance lines');
    expect(html).not.toContain('finBalanceToggleManaging');
    expect(html).not.toContain('finBalanceToggleHidden');
    expect(html).not.toContain('Unhide all');
  });

  it('drops the Year/Trend range picker entirely — no print equivalent for a year-input control', () => {
    const { fin } = balanceSetup();
    const html = fin.finBalanceBuildPrintSheetHtml();
    expect(html).not.toContain('fin-bal-year');
    expect(html).not.toContain('fin-bal-from');
    expect(html).not.toContain('Show Year');
    expect(html).not.toContain('Load Range');
  });

  it('respects the reader\'s current hide-zero and manually-hidden-line choices, same as the live tab', () => {
    const { fin } = balanceSetup();
    fin._finBalanceData.rows.push({ category_path: 'Assets:19999 Zero Account', account_name: '19999 Zero Account', classification: 'Assets', depth: 1, own_balance_cents: 0 });
    fin._finBalanceHideZero = true;
    fin._finBalanceHiddenPaths = { 'Liabilities:21000 Accounts Payable': true };
    const html = fin.finBalanceBuildPrintSheetHtml();
    expect(html).not.toContain('19999 Zero Account');
    expect(html).not.toContain('21000 Accounts Payable');
    expect(html).toContain('11027 Lindell Checking');
  });

  it('renders the equity reclassification card when present', () => {
    const { fin } = balanceSetup();
    fin._finBalanceData.equityReclass = {
      donorRestrictedCents: 5000000, unrestrictedCents: 32031444, totalEquityCents: 37031444,
      breakdown: { perpetual: null, purpose_time: null, designated: { label: 'Designated Funds', cents: 5000000 } },
      unclassified: [],
    };
    const html = fin.finBalanceBuildPrintSheetHtml();
    expect(html).toContain('Net Assets');
    expect(html).toContain('Donor-Restricted');
  });
});

describe('Balance Sheet print sheet — multi-year trend', () => {
  it('is omitted when no multi-year data is loaded', () => {
    const { fin } = balanceSetup();
    fin._finBalanceMultiYearData = null;
    const html = fin.finBalanceBuildPrintSheetHtml();
    expect(html).not.toContain('Multi-Year Trend');
  });

  it('includes the multi-year trend chart, cash trend chart, and the reconciliation table when loaded', () => {
    const { fin } = balanceSetup();
    fin._finBalanceMultiYearData = balanceMultiYearFixture();
    const html = fin.finBalanceBuildPrintSheetHtml();
    expect(html).toContain('Multi-Year Trend');
    expect(html).toContain('Cash &amp; Bank Accounts Over Time');
    expect(html).toContain('Balance Sheet vs. Income Statement');
    expect(html).toContain('2024');
    expect(html).toContain('2025');
    expect(html).toContain('2026');
  });
});

describe('Balance Sheet print sheet — finBalancePrint', () => {
  it('builds the sheet into #fin-balance-printsheet-root, marks body.printing-balance, and cleans up after printing', async () => {
    const { fin, printsheetRoot } = balanceSetup();
    const bodyClasses = [];
    fin.document.body.classList.add = (c) => bodyClasses.push(c);
    fin.document.body.classList.remove = (c) => { const i = bodyClasses.indexOf(c); if (i > -1) bodyClasses.splice(i, 1); };
    let printed = false;
    fin.print = () => { printed = true; };
    fin.finBalancePrint();
    expect(printsheetRoot.innerHTML).toContain('fin-balance-rpt');
    expect(printsheetRoot.innerHTML).toContain('11027 Lindell Checking');
    expect(bodyClasses).toEqual(['printing-balance']);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(printed).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(bodyClasses).toEqual([]);
    expect(printsheetRoot.innerHTML).toBe('');
  }, 2000);

  it('is a no-op when the print-sheet mount is missing from the DOM', () => {
    const fin = loadBundle({});
    fin._finBalanceData = balanceFixture();
    expect(() => fin.finBalancePrint()).not.toThrow();
  });
});

// Same class of bug this app has hit before on the Budget/Financial Health print sheets: a rule
// that hides the whole panel (or misses a sibling) before the print sheet ever gets to show.
// Balance Sheet needs the SAME two levels of nesting as Budget/Health/Full Report (not Church
// Report's one-level exception) because finRenderBalanceSheetTab() rebuilds #fin-balance-root's
// whole innerHTML on every render/toggle — see the comment on body.printing-balance in
// html-head.js.
describe('body.printing-balance CSS contract', () => {
  it('names both nesting levels explicitly: #fin-panel-balance > #fin-balance-root > #fin-balance-printsheet-root', () => {
    expect(HTML_HEAD).toMatch(/body\.printing-balance \.tab-panel:not\(#tab-finance\)\{display:none!important;\}/);
    expect(HTML_HEAD).toMatch(/body\.printing-balance #tab-finance\{display:block!important;\}/);
    expect(HTML_HEAD).toMatch(/body\.printing-balance #tab-finance > div > div > div:not\(#fin-panel-balance\)\{display:none!important;\}/);
    expect(HTML_HEAD).toMatch(/body\.printing-balance #fin-panel-balance > \*:not\(#fin-balance-root\)\{display:none!important;\}/);
    expect(HTML_HEAD).toMatch(/body\.printing-balance #fin-balance-root > \*:not\(#fin-balance-printsheet-root\)\{display:none!important;\}/);
    expect(HTML_HEAD).toMatch(/body\.printing-balance #fin-balance-printsheet-root\{display:block!important;\}/);
    // The regression shape: skipping the intermediate #fin-balance-root level entirely.
    expect(HTML_HEAD).not.toMatch(/#fin-panel-balance\s*>\s*\*:not\(#fin-balance-printsheet-root\)/);
  });

  it('#fin-balance-printsheet-root is hidden on screen by default', () => {
    expect(HTML_HEAD).toMatch(/\.fin-balance-printsheet-root\{display:none;\}/);
  });

  it('reuses the same single-column/break-inside-avoid print rules Financial Health and Church Report already established for .fin-card/.fin-grid-*, extended to .fin-balance-rpt rather than duplicated', () => {
    const gridRule = HTML_HEAD.match(/\.fin-health-rpt \.fin-grid-3[^{]*\{grid-template-columns:1fr!important;\}/);
    expect(gridRule).toBeTruthy();
    expect(gridRule[0]).toContain('.fin-balance-rpt .fin-grid-3');
    expect(gridRule[0]).toContain('.fin-balance-rpt .fin-grid-2');
    const cardRule = HTML_HEAD.match(/\.fin-health-rpt \.fin-card[^{]*\{break-inside:avoid;margin-bottom:14px;\}/);
    expect(cardRule).toBeTruthy();
    expect(cardRule[0]).toContain('.fin-balance-rpt .fin-card');
  });
});
