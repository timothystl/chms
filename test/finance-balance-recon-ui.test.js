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
    ctx.finRenderChurchBalances(balancesForYear(2025), multiYearBalances);
    const html = store['fin-church-balances-view'].innerHTML;
    expect(html).toContain('Balance Sheet vs. Income Statement');
    expect(html).toContain('Matches');
    expect(html).toContain('1 of 1 year');
  });

  it('keeps the year picker on screen when the chosen year has nothing imported', () => {
    // Without this, a year with no balance sheet is a dead end — no way back to a year that has
    // one, which is the normal state while several years of history are still being uploaded.
    const { ctx, store } = makeCtx();
    ctx.finRenderChurchBalances({ year: 2019, rows: [], summary: null, asOfDate: '', equityReclass: null }, multiYearBalances);
    const html = store['fin-church-balances-view'].innerHTML;
    expect(html).toContain('fin-church-bal-year');
    expect(html).toContain('finChurchBalanceLoadRange()');
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
    ctx.finRenderChurchBalances(balancesForYear(2025), my);
    const html = store['fin-church-balances-view'].innerHTML;
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
    ctx.finRenderChurchBalances(balancesForYear(2025), my);
    const html = store['fin-church-balances-view'].innerHTML;
    expect(html).toContain('Difference of $600.00');
    expect(html).toContain('0 of 1 year');
  });

  it('requests the picked year and the picked range from the server', () => {
    const { ctx } = makeCtx();
    const urls = [];
    ctx.api = (u) => { urls.push(u); return new Promise(() => {}); };
    ctx.document.getElementById('fin-church-bal-year').value = '2019';
    ctx.finChurchBalanceLoadYear();
    expect(urls[0]).toContain('balances?year=2019');
    urls.length = 0;
    ctx.document.getElementById('fin-church-bal-from').value = '2018';
    ctx.document.getElementById('fin-church-bal-to').value = '2020';
    ctx.finChurchBalanceLoadRange();
    expect(urls.join(' ')).toContain('years=2018,2019,2020');
    // The snapshot year the user picked is kept, not silently reset to the current year.
    expect(urls[0]).toContain('balances?year=2019');
  });
});
