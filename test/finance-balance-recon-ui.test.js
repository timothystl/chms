import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS, CHMS_APP_FINANCE_JS } from '../src/html-chms.js';

// Drives the REAL render functions out of the REAL built bundle (not the source module), for the
// two Church Report changes that are pure presentation: the always-empty Cost of Goods Sold row,
// and the balance-sheet year/range pickers + tie-out table.
function makeCtx() {
  const store = {};
  const el = (id) => ({
    id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false,
    files: [], classList: { add() {}, remove() {}, contains() { return false; } },
    appendChild() {}, addEventListener() {}, querySelector() { return null; },
    querySelectorAll() { return []; }, setAttribute() {}, focus() {},
  });
  const ctx = {
    document: {
      getElementById(id) { return store[id] || (store[id] = el(id)); },
      querySelector() { return null; }, querySelectorAll() { return []; },
      createElement: () => el('x'), addEventListener() {}, body: el('body'), activeElement: null,
    },
    console, setTimeout, clearTimeout, Math, JSON, Date, parseFloat, parseInt, isFinite,
    Number, String, Object, Array, Promise, encodeURIComponent, decodeURIComponent,
    localStorage: { getItem() { return null; }, setItem() {} },
    FormData: class { append() {} },
    navigator: {}, location: { href: '', hash: '' },
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, requestAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_CORE_JS, ctx, { filename: 'app-core.js' });
  vm.runInContext(CHMS_APP_EXT_JS, ctx, { filename: 'app-ext.js' });
  vm.runInContext(CHMS_APP_FINANCE_JS, ctx, { filename: 'app-finance.js' });
  return { ctx, store };
}

function multiYearPayload(cogsByYear) {
  const years = [2024, 2025];
  const byYear = {};
  years.forEach((y) => {
    byYear[y] = {
      classificationTotals: {
        Income: { actualCents: 70000000, budgetCents: 0 },
        Expenses: { actualCents: 80000000, budgetCents: 0 },
        'Cost of Goods Sold': { actualCents: (cogsByYear || {})[y] || 0, budgetCents: 0 },
      },
      netIncome: { actualCents: -10000000, budgetCents: 0 },
    };
  });
  return { years, byYear };
}

describe('Church Report multi-year — Cost of Goods Sold row', () => {
  it('is hidden when this church has never posted to it', () => {
    const { ctx, store } = makeCtx();
    ctx.finRenderChurchMultiYear(multiYearPayload(null));
    const html = store['fin-church-multiyear-view'].innerHTML;
    expect(html).not.toContain('Cost of Goods Sold');
    // The rows that are real are untouched.
    expect(html).toContain('Total Revenue');
    expect(html).toContain('Total Expenses');
    expect(html).toContain('Net Income');
  });

  it('comes back the moment a real figure exists, so no dollar is ever hidden', () => {
    const { ctx, store } = makeCtx();
    ctx.finRenderChurchMultiYear(multiYearPayload({ 2025: 123400 }));
    const html = store['fin-church-multiyear-view'].innerHTML;
    expect(html).toContain('Cost of Goods Sold');
    expect(html).toContain('1,234.00');
  });

  it('drops the empty row from the CSV export too, not just the screen', () => {
    const { ctx } = makeCtx();
    const captured = [];
    ctx.finDownloadCsv = (name, rows) => captured.push({ name, rows });
    ctx._finChurchMode = 'multiyear';
    ctx._finChurchMultiYearData = multiYearPayload(null);
    ctx.finExportChurchCsv();
    const labels = captured[0].rows.map(r => r[0]);
    expect(labels).not.toContain('Cost of Goods Sold');
    expect(labels).toContain('Total Revenue');
    expect(labels).toContain('Net Income');
  });
});

const balancesForYear = (year) => ({
  year,
  asOfDate: `12/31/${year}`,
  rows: [{ fiscal_year: year, classification: 'Assets', category_path: 'Assets', account_name: 'Assets', depth: 0, has_children: 0, own_balance_cents: 500000 }],
  summary: { classificationTotals: { Assets: 500000, Equity: 500000 }, assetsCents: 500000, liabilitiesCents: 0, equityCents: 500000, liabilitiesPlusEquityCents: 500000, balancedCents: 0 },
  equityReclass: null,
});
const multiYearBalances = {
  years: [2024, 2025],
  byYear: {
    2024: { classificationTotals: { Equity: 400000 }, assetsCents: 400000, liabilitiesCents: 0, equityCents: 400000, liabilitiesPlusEquityCents: 400000, balancedCents: 0 },
    2025: { classificationTotals: { Equity: 500000 }, assetsCents: 500000, liabilitiesCents: 0, equityCents: 500000, liabilitiesPlusEquityCents: 500000, balancedCents: 0 },
  },
  equityReclassByYear: {},
  netIncomeByYear: { 2024: null, 2025: 100000 },
  reconciliation: {
    rows: [{ year: 2025, prior_year: 2024, equity_cents: 500000, prior_equity_cents: 400000, change_cents: 100000, net_income_cents: 100000, difference_cents: 0, status: 'ok' }],
    checked: 1, matched: 1, unexplained: 0,
  },
};

describe('Balance sheet view — year picker and the P&L tie-out', () => {
  it('renders the tie-out alongside a loaded balance sheet', () => {
    const { ctx, store } = makeCtx();
    ctx.finRenderBalanceSheetTab(balancesForYear(2025), multiYearBalances);
    const html = store['fin-balance-root'].innerHTML;
    expect(html).toContain('Balance Sheet vs. Income Statement');
    expect(html).toContain('Matches');
    expect(html).toContain('1 of 1 year');
  });

  it('keeps the year picker on screen when the chosen year has nothing imported', () => {
    // Without this, a year with no balance sheet is a dead end — no way back to a year that has
    // one, which is the normal state while several years of history are still being uploaded.
    const { ctx, store } = makeCtx();
    ctx.finRenderBalanceSheetTab({ year: 2019, rows: [], summary: null, asOfDate: '', equityReclass: null }, multiYearBalances);
    const html = store['fin-balance-root'].innerHTML;
    expect(html).toContain('fin-bal-year');
    expect(html).toContain('finBalanceLoadRange()');
    expect(html).toContain('No balance sheet imported yet for 2019');
    // The trend and the tie-out still render, so it is obvious which years DO have data.
    expect(html).toContain('Balance Sheet vs. Income Statement');
  });

  it('names the missing year when a tie-out cannot be run', () => {
    const { ctx, store } = makeCtx();
    const my = JSON.parse(JSON.stringify(multiYearBalances));
    my.reconciliation = {
      rows: [{ year: 2025, prior_year: 2024, equity_cents: 500000, prior_equity_cents: null, change_cents: null, net_income_cents: 100000, difference_cents: null, status: 'no_prior_balance' }],
      checked: 0, matched: 0, unexplained: 0,
    };
    ctx.finRenderBalanceSheetTab(balancesForYear(2025), my);
    const html = store['fin-balance-root'].innerHTML;
    expect(html).toContain('No 2024 balance sheet');
    expect(html).toContain('No year can be checked yet');
  });

  it('shows an unexplained difference as an amount, not a pass', () => {
    const { ctx, store } = makeCtx();
    const my = JSON.parse(JSON.stringify(multiYearBalances));
    my.reconciliation = {
      rows: [{ year: 2025, prior_year: 2024, equity_cents: 500000, prior_equity_cents: 400000, change_cents: 100000, net_income_cents: 40000, difference_cents: 60000, status: 'off' }],
      checked: 1, matched: 0, unexplained: 1,
    };
    ctx.finRenderBalanceSheetTab(balancesForYear(2025), my);
    const html = store['fin-balance-root'].innerHTML;
    expect(html).toContain('Difference of $600.00');
    expect(html).toContain('0 of 1 year');
  });

  it('requests the picked year and the picked range from the server', () => {
    const { ctx } = makeCtx();
    const urls = [];
    ctx.api = (u) => { urls.push(u); return new Promise(() => {}); };
    ctx.document.getElementById('fin-bal-year').value = '2019';
    ctx.finBalanceLoadYear();
    expect(urls[0]).toContain('balances?year=2019');
    urls.length = 0;
    ctx.document.getElementById('fin-bal-from').value = '2018';
    ctx.document.getElementById('fin-bal-to').value = '2020';
    ctx.finBalanceLoadRange();
    expect(urls.join(' ')).toContain('years=2018,2019,2020');
    // The snapshot year the user picked is kept, not silently reset to the current year.
    expect(urls[0]).toContain('balances?year=2019');
  });

  it('requests the year before the snapshot year too, for the This Year vs Last Year comparison', () => {
    const { ctx } = makeCtx();
    const urls = [];
    ctx.api = (u) => { urls.push(u); return new Promise(() => {}); };
    ctx.finLoadBalanceSheetTab(2025);
    expect(urls.some(u => u.includes('balances?year=2024'))).toBe(true);
    expect(urls.some(u => u.includes('balances?year=2025'))).toBe(true);
  });
});

// Balance Sheet & Financial Position moved out of Church Report's own mode toggle into its own
// top-level Finance tab, 2026-09-04 — a real user request ("give me a tab for Balance Sheet &
// Financial Position"), plus three new capabilities the request specifically asked for: a CSV
// export, a bank-accounts-over-time trend, and a This Year vs Last Year comparison (the latter
// also answers a separate, related ask: "i need a report that can compare last years to this
// year").
describe('Balance Sheet — its own top-level tab', () => {
  it('is its own FIN_TOPNAV_ITEMS entry, not a Church Report mode', () => {
    const { ctx } = makeCtx();
    const item = ctx.FIN_TOPNAV_ITEMS.find(i => i.id === 'balance');
    expect(item).toBeTruthy();
    expect(item.label).toBe('Balance Sheet');
  });

  it('Church Report\'s own mode pills no longer offer "Balance sheet"', () => {
    const { ctx, store } = makeCtx();
    ctx._finChurchThisYearData = null;
    ctx.finRenderChurchHeader();
    const html = store['fin-church-header'].innerHTML;
    expect(html).toContain('This year');
    expect(html).toContain('Multi-year');
    expect(html).not.toContain('Balance sheet');
  });

  it('finShowSection toggles #fin-panel-balance like every other section', () => {
    const { ctx, store } = makeCtx();
    ctx.finShowSection('balance');
    expect(store['fin-panel-balance'].style.display).toBe('');
    expect(store['fin-panel-church'].style.display).toBe('none');
    expect(store['fin-panel-health'].style.display).toBe('none');
  });

  it('renders its own page header with an Export CSV button, not Church Report\'s', () => {
    const { ctx, store } = makeCtx();
    ctx.finRenderBalanceSheetTab(balancesForYear(2025), multiYearBalances);
    const html = store['fin-balance-root'].innerHTML;
    expect(html).toContain('Balance Sheet &amp; Financial Position');
    expect(html).toContain('finExportBalanceCsv()');
  });
});

describe('Cash & Bank Accounts Over Time', () => {
  const multiYearWithCash = {
    ...multiYearBalances,
    cashByYear: {
      2024: { operatingCents: 200000, operatingAccounts: ['11027 Checking'], allCashCents: 250000, allCashAccounts: ['11027 Checking', 'Savings'] },
      2025: { operatingCents: 300000, operatingAccounts: ['11027 Checking'], allCashCents: 350000, allCashAccounts: ['11027 Checking', 'Savings'] },
    },
  };

  it('renders both series when an operating account is pinned', () => {
    const { ctx } = makeCtx();
    const html = ctx.finRenderCashTrendChart(multiYearWithCash);
    expect(html).toContain('Cash &amp; Bank Accounts Over Time');
    expect(html).toContain('Operating Checking');
    expect(html).toContain('All Cash & Bank Accounts');
    expect(html).toContain('11027 Checking, Savings');
  });

  it('degrades to just the broad series when no operating account is pinned/matched', () => {
    const { ctx } = makeCtx();
    const my = {
      years: [2025],
      cashByYear: { 2025: { operatingCents: null, operatingAccounts: [], allCashCents: 100000, allCashAccounts: ['Some Checking'] } },
    };
    const html = ctx.finRenderCashTrendChart(my);
    expect(html).toContain('All Cash & Bank Accounts');
    expect(html).not.toContain('Operating Checking');
  });

  it('renders nothing when there is no cash data at all', () => {
    const { ctx } = makeCtx();
    expect(ctx.finRenderCashTrendChart(multiYearBalances)).toBe(''); // no cashByYear field
    expect(ctx.finRenderCashTrendChart({ years: [2025], cashByYear: { 2025: { operatingCents: null, allCashCents: null } } })).toBe('');
  });
});

describe('Net Worth Growth by Year', () => {
  it('shows a signed $ and % change per consecutive year pair', () => {
    const { ctx } = makeCtx();
    const html = ctx.finRenderNetWorthGrowthTable(multiYearBalances); // 2024 400000 -> 2025 500000
    expect(html).toContain('Net Worth Growth by Year');
    expect(html).toContain('+$1,000.00');
    expect(html).toContain('+25.0%');
  });

  it('colors a loss year distinctly and states it as a negative change', () => {
    const { ctx } = makeCtx();
    const my = { years: [2024, 2025], byYear: { 2024: { equityCents: 500000 }, 2025: { equityCents: 400000 } } };
    const html = ctx.finRenderNetWorthGrowthTable(my);
    expect(html).toContain('var(--danger)');
    expect(html).toContain('$1,000.00');
    expect(html).toContain('-20.0%');
  });

  it('renders nothing with fewer than two years of data', () => {
    const { ctx } = makeCtx();
    expect(ctx.finRenderNetWorthGrowthTable({ years: [2025], byYear: { 2025: { equityCents: 100 } } })).toBe('');
  });
});

describe('This Year vs. Last Year — account comparison', () => {
  const currentRows = [
    { fiscal_year: 2025, classification: 'Assets', category_path: 'Assets', account_name: 'Assets', depth: 0, has_children: 1, own_balance_cents: 0 },
    { fiscal_year: 2025, classification: 'Assets', category_path: 'Assets:Checking', account_name: 'Checking', depth: 1, has_children: 0, own_balance_cents: 600000 },
    { fiscal_year: 2025, classification: 'Assets', category_path: 'Assets:NewFund', account_name: 'New Reserve Fund', depth: 1, has_children: 0, own_balance_cents: 5000 },
  ];
  const priorRows = [
    { fiscal_year: 2024, classification: 'Assets', category_path: 'Assets', account_name: 'Assets', depth: 0, has_children: 1, own_balance_cents: 0 },
    { fiscal_year: 2024, classification: 'Assets', category_path: 'Assets:Checking', account_name: 'Checking', depth: 1, has_children: 0, own_balance_cents: 500000 },
  ];

  it('compares every current-year account against its own prior-year total', () => {
    const { ctx } = makeCtx();
    const html = ctx.finRenderBalanceYoyCard(currentRows, { rows: priorRows }, 2025);
    expect(html).toContain('2025 vs. 2024');
    expect(html).toContain('$6,000.00'); // Checking total (600000 cents)
    expect(html).toContain('$5,000.00'); // Checking prior (500000 cents)
    expect(html).toContain('+$1,000.00');
    expect(html).toContain('+20.0%');
  });

  it('marks an account with no prior-year entry as new, not a misleading $0.00 prior figure', () => {
    const { ctx } = makeCtx();
    const html = ctx.finRenderBalanceYoyCard(currentRows, { rows: priorRows }, 2025);
    expect(html).toContain('New Reserve Fund');
    expect(html).toContain('new this year');
  });

  it('says so, rather than showing an empty table, when the prior year has no balance sheet on file', () => {
    const { ctx } = makeCtx();
    const html = ctx.finRenderBalanceYoyCard(currentRows, null, 2025);
    expect(html).toContain('No 2024 balance sheet on file yet');
  });

  it('renders nothing when the current year itself has no rows', () => {
    const { ctx } = makeCtx();
    expect(ctx.finRenderBalanceYoyCard([], { rows: priorRows }, 2025)).toBe('');
  });
});

describe('finExportBalanceCsv', () => {
  it('exports year/assets/liabilities/equity/cash from the loaded multi-year data', () => {
    const { ctx } = makeCtx();
    const captured = [];
    ctx.finDownloadCsv = (name, rows) => captured.push({ name, rows });
    ctx._finBalanceMultiYearData = {
      ...multiYearBalances,
      cashByYear: { 2024: { operatingCents: 200000, allCashCents: 250000 }, 2025: { operatingCents: 300000, allCashCents: 350000 } },
    };
    ctx.finExportBalanceCsv();
    expect(captured[0].name).toBe('balance-sheet-multi-year.csv');
    const row2025 = captured[0].rows.find(r => r[0] === 2025);
    // Assets, then its three groups (this fixture has no group split, so all three read 0 —
    // the split's own coverage is in the asset-trend describe below), then liabilities/equity/cash.
    expect(row2025).toEqual([2025, 5000, 0, 0, 0, 0, 5000, 3000, 3500]);
  });

  it('toasts rather than exporting nothing when no balance data is loaded', () => {
    const { ctx } = makeCtx();
    let toasted = '';
    ctx.finToast = (msg) => { toasted = msg; };
    const captured = [];
    ctx.finDownloadCsv = (name, rows) => captured.push({ name, rows });
    ctx._finBalanceMultiYearData = null;
    ctx.finExportBalanceCsv();
    expect(captured.length).toBe(0);
    expect(toasted).toContain('No balance sheet data');
  });
});

// ── Post-import cache invalidation for the pinned trend range ───────────────────────────────
// The trend range now defaults, server-side, to every year that has a balance sheet. But a range
// the reader pinned by hand (Trend from/to → Load Range) is remembered in _finBalanceYears for the
// rest of the session and sent as ?years=, which overrides that default — so after an import the
// year just uploaded would stay off the chart until a full page reload. Same staleness class as
// FIN59-BUG2's import-status cache.
//
// This asserts the WIRING out of the real built bundle, not the running behavior: it proves each
// confirm handler still contains the reset, not that a real import round-trip clears it.
describe('balance sheet imports clear a hand-pinned trend range', () => {
  function bodyOf(fnName) {
    const src = CHMS_APP_FINANCE_JS;
    const start = src.indexOf('function ' + fnName + '(');
    expect(start, fnName + ' not found in the built bundle').toBeGreaterThan(-1);
    const next = src.indexOf('\nfunction ', start + 1);
    return src.slice(start, next === -1 ? src.length : next);
  }

  it('the single-year Balance Sheet import resets _finBalanceYears', () => {
    const body = bodyOf('finChurchConfirmBalanceImport');
    expect(body).toContain('_finBalanceYears = null');
    expect(body).toContain('finLoadBalanceSheetTab()');
  });

  it('the multi-year Financial Position import resets _finBalanceYears', () => {
    const body = bodyOf('finChurchConfirmBalanceMultiImport');
    expect(body).toContain('_finBalanceYears = null');
    expect(body).toContain('finLoadBalanceSheetTab()');
  });

  it('loading a range by hand still pins it, so the reset is a real invalidation', () => {
    // If Load Range stopped writing _finBalanceYears there would be nothing to invalidate and the
    // two assertions above would pass while guarding nothing.
    expect(bodyOf('finBalanceLoadRange')).toContain('finLoadBalanceSheetTab(null, years)');
  });
});

// ── Stacked Assets column + the assets growth table ────────────────────────────────────────
// The Multi-Year Trend used to draw one flat Assets bar. Total assets are mostly the building at
// book value, which does not move, so the current-asset drawdown that is the actual story was
// invisible. Both the chart and the table below it are driven from the same multi-year payload,
// so they cannot disagree.
describe('Balance Sheet asset trend', () => {
  const multiYear = {
    years: [2019, 2020],
    byYear: {
      2019: { assetsCents: 153301079, liabilitiesCents: 10000000, equityCents: 143301079,
        currentAssetsCents: 94269566, fixedAssetsCents: 59031513, otherAssetsCents: 0 },
      2020: { assetsCents: 132018914, liabilitiesCents: 9000000, equityCents: 123018914,
        currentAssetsCents: 72103587, fixedAssetsCents: 59031513, otherAssetsCents: 883814 },
    },
    cashByYear: {},
  };

  it('draws Current/Fixed/Other as one stacked Assets column beside Liabilities and Equity', () => {
    const { ctx } = makeCtx();
    const html = ctx.finRenderBalanceMultiYearChart(multiYear);
    const rects = [...html.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)]
      .map((m) => ({ x: +m[1], y: +m[2], h: +m[4] }));
    // 2 years x (3 asset segments + liabilities + equity) = 10 bars, in 3 columns per year.
    expect(rects.length).toBe(10);
    const xs = [...new Set(rects.map((r) => r.x))];
    expect(xs.length).toBe(6); // 3 columns x 2 years, not 5 columns
    // The three asset segments of one year share an x and stack contiguously.
    const first = rects.filter((r) => r.x === rects[0].x).sort((a, b) => b.y - a.y);
    expect(first.length).toBe(3);
    expect(Math.abs(first[0].y - (first[1].y + first[1].h))).toBeLessThan(0.15);
    expect(Math.abs(first[1].y - (first[2].y + first[2].h))).toBeLessThan(0.15);
  });

  it('names the total in an asset segment tooltip, so a segment is never mistaken for all assets', () => {
    const { ctx } = makeCtx();
    const html = ctx.finRenderBalanceMultiYearChart(multiYear);
    expect(html).toContain('total assets');
    expect(html).toContain('Current assets');
    expect(html).toContain('Fixed assets');
  });

  it('omits the Other segment entirely when no year has one', () => {
    const { ctx } = makeCtx();
    const noOther = { years: [2019], byYear: { 2019: Object.assign({}, multiYear.byYear[2019]) }, cashByYear: {} };
    const html = ctx.finRenderBalanceMultiYearChart(noOther);
    expect(html).not.toContain('Other assets');
    expect(html).toContain('Fixed assets');
  });

  it('the growth table reports total AND current assets separately, each signed', () => {
    const { ctx } = makeCtx();
    const html = ctx.finRenderAssetGrowthTable(multiYear);
    expect(html).toContain('Asset Growth by Year');
    expect(html).toContain('Total assets');
    expect(html).toContain('Current assets');
    // Total assets fell 13.9%; current assets fell far harder at 23.5% — the whole reason both
    // columns are shown rather than the total alone.
    expect(html).toContain('-13.9%');
    expect(html).toContain('-23.5%');
    expect(html).toContain('var(--danger)');
  });

  it('renders nothing with fewer than two years to compare', () => {
    const { ctx } = makeCtx();
    expect(ctx.finRenderAssetGrowthTable({ years: [2020], byYear: multiYear.byYear })).toBe('');
    expect(ctx.finRenderAssetGrowthTable(null)).toBe('');
  });

  it('shows dashes rather than a fabricated -100% when a year carries no asset-group split', () => {
    const { ctx } = makeCtx();
    const legacy = { years: [2019, 2020], byYear: {
      2019: { assetsCents: 100, equityCents: 1 },
      2020: { assetsCents: 200, equityCents: 2 },
    } };
    const html = ctx.finRenderAssetGrowthTable(legacy);
    expect(html).toContain('&mdash;');
    expect(html).not.toContain('-100.0%');
  });

  it('both growth tables are on the Balance Sheet render path', () => {
    const src = CHMS_APP_FINANCE_JS;
    const start = src.indexOf('function finRenderBalanceSheetTab(');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\nfunction ', start + 1));
    expect(body).toContain('finRenderNetWorthGrowthTable(multiYear)');
    expect(body).toContain('finRenderAssetGrowthTable(multiYear)');
    // Present on the empty state too, since a year with no snapshot still has a trend to read.
    expect((body.match(/finRenderAssetGrowthTable\(multiYear\)/g) || []).length).toBe(2);
  });

  it('the CSV export carries the same split the chart draws', () => {
    const { ctx } = makeCtx();
    const captured = [];
    ctx.finDownloadCsv = (name, rows) => captured.push({ name, rows });
    ctx._finBalanceMultiYearData = multiYear;
    ctx.finExportBalanceCsv();
    expect(captured.length).toBe(1);
    expect(captured[0].rows[0]).toContain('Current Assets');
    expect(captured[0].rows[0]).toContain('Fixed Assets');
    const row2020 = captured[0].rows.find((r) => r[0] === 2020);
    expect(row2020).toContain(721035.87);
    expect(row2020).toContain(590315.13);
  });
});

// The shared grouped-bar renderer gained stacking for the chart above. Every other caller of it
// (Attendance, Church Report, Daycare) passes no stack key at all and must be untouched.
describe('renderGroupedBarChart stacking is opt-in', () => {
  it('a series with no stack key still gets its own column', () => {
    const { ctx } = makeCtx();
    const vals = { 'g|a': 10, 'g|b': 5 };
    const html = ctx.renderGroupedBarChart({
      groups: [{ key: 'g', label: 'G' }],
      series: [{ key: 'a', label: 'A', color: '#111' }, { key: 'b', label: 'B', color: '#222' }],
      value: (g, s) => vals[g + '|' + s],
    });
    const xs = [...html.matchAll(/<rect x="([\d.]+)"/g)].map((m) => m[1]);
    expect(xs.length).toBe(2);
    expect(xs[0]).not.toBe(xs[1]);
  });

  it('a column is scaled by its stacked total, so a stack is never clipped by the axis', () => {
    const { ctx } = makeCtx();
    const opts = (stack) => ({
      groups: [{ key: 'g', label: 'G' }],
      series: [{ key: 'a', label: 'A', color: '#111', stack }, { key: 'b', label: 'B', color: '#222', stack }],
      value: (g, s) => (s === 'a' ? 60 : 40),
    });
    const stacked = ctx.renderGroupedBarChart(opts('assets'));
    const rects = [...stacked.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/g)]
      .map((m) => ({ x: m[1], y: +m[2], h: +m[3] }));
    expect(new Set(rects.map((r) => r.x)).size).toBe(1); // one column, not two
    // The top of the stack must stay inside the plot area (y is measured from the top edge), i.e.
    // the axis was scaled against the stacked total of 100, not the tallest single segment of 60.
    expect(Math.min(...rects.map((r) => r.y))).toBeGreaterThan(0);
    expect(rects.reduce((a, r) => a + r.h, 0)).toBeLessThan(180);
    // Unstacked, the same two values are two separate columns — the pre-existing behavior.
    const flat = ctx.renderGroupedBarChart(opts(undefined));
    const flatXs = [...new Set([...flat.matchAll(/<rect x="([\d.]+)"/g)].map((m) => m[1]))];
    expect(flatXs.length).toBe(2);
  });
});
