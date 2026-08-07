import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS } from '../src/html-chms.js';

// Regression cover for the Monthly P&L import UI after it went multi-year (v1.150.0).
//
// Why this file exists: when the preview response changed shape from { fiscalYear, months } to
// { years, monthsByYear }, the render and commit functions were updated but the status line in
// finChurchMonthlyImportFileSelected was not — it still read d.months.length, which threw
// "Cannot read properties of undefined (reading 'length')" on every upload. That slipped through
// because the verification harness called the two updated functions DIRECTLY and never went
// through the handler that actually receives the response. So these tests drive the real handler
// out of the real built bundle, with fetch stubbed, rather than calling the pieces it composes.

function makeCtx(previewResponse, { ok = true, status = 200 } = {}) {
  const store = {};
  const el = (id) => ({
    id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false,
    files: [], classList: { add() {}, remove() {}, contains() { return false; } },
    appendChild() {}, addEventListener() {}, querySelector() { return null; },
    querySelectorAll() { return []; }, setAttribute() {}, focus() {},
  });
  for (const id of ['fin-church-monthly-import-file', 'fin-church-monthly-import-status',
    'fin-church-monthly-import-preview', 'fin-church-monthly-import-confirm-btn']) store[id] = el(id);

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
    fetch: () => Promise.resolve({ ok, status, json: () => Promise.resolve(previewResponse) }),
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_CORE_JS, ctx, { filename: 'app-core.js' });
  vm.runInContext(CHMS_APP_EXT_JS, ctx, { filename: 'app-ext.js' });
  ctx.__store = store;
  return ctx;
}

function row(year, month, path, cents) {
  return {
    fiscal_year: year, period_month: month, classification: 'Income', category_path: path,
    account_name: path.split(':').pop(), depth: path.split(':').length - 1, has_children: 0,
    own_actual_cents: cents, own_budget_cents: null,
  };
}

// The real multi-year shape the preview route now returns.
const MULTI_YEAR_RESPONSE = {
  sheetName: 'Sheet1',
  years: [2025, 2026],
  monthsByYear: { 2025: [1, 2], 2026: [1] },
  rows: [
    row(2025, 1, 'Income:40085 Sunday Offering', 100000),
    row(2025, 2, 'Income:40085 Sunday Offering', 200000),
    row(2026, 1, 'Income:40085 Sunday Offering', 300000),
  ],
  skipped: ['Cash Basis Thursday, August 06, 2026'],
};

const SINGLE_YEAR_RESPONSE = {
  sheetName: 'Sheet1',
  years: [2026],
  monthsByYear: { 2026: [1, 2] },
  rows: [row(2026, 1, 'Income:40085 Sunday Offering', 100000), row(2026, 2, 'Income:40085 Sunday Offering', 200000)],
  skipped: [],
};

const flush = () => new Promise(r => setTimeout(r, 0));

describe('finChurchMonthlyImportFileSelected (the handler that receives the preview response)', () => {
  it('renders a status line for a multi-year file without throwing', async () => {
    const ctx = makeCtx(MULTI_YEAR_RESPONSE);
    ctx.finChurchMonthlyImportFileSelected({ files: [{ name: 'pnl.xlsx' }] });
    await flush();
    const status = ctx.__store['fin-church-monthly-import-status'].textContent;
    // The bug produced "Error: Cannot read properties of undefined (reading 'length')" here.
    expect(status).not.toMatch(/Cannot read properties/);
    expect(status).not.toMatch(/^Error:/);
    expect(status).toContain('2 years (2025 to 2026)');
    expect(status).toContain('3 month(s)');
    expect(status).toContain('3 account/month row(s)');
    expect(status).toContain('1 line(s) not recognized');
  });

  it('renders a status line for a single-year file without throwing', async () => {
    const ctx = makeCtx(SINGLE_YEAR_RESPONSE);
    ctx.finChurchMonthlyImportFileSelected({ files: [{ name: 'pnl.xlsx' }] });
    await flush();
    const status = ctx.__store['fin-church-monthly-import-status'].textContent;
    expect(status).not.toMatch(/^Error:/);
    expect(status).toContain('1 year (2026)');
    expect(status).toContain('2 month(s)');
    // No skipped lines, so that clause must be absent rather than reading "0 line(s)".
    expect(status).not.toContain('line(s) not recognized');
  });

  it('fills the preview and reveals the Import button', async () => {
    const ctx = makeCtx(MULTI_YEAR_RESPONSE);
    ctx.finChurchMonthlyImportFileSelected({ files: [{ name: 'pnl.xlsx' }] });
    await flush();
    expect(ctx.__store['fin-church-monthly-import-preview'].innerHTML).toContain('40085 Sunday Offering');
    expect(ctx.__store['fin-church-monthly-import-confirm-btn'].style.display).toBe('');
  });

  it('surfaces a server error message instead of a stack-shaped one', async () => {
    const ctx = makeCtx({ error: 'Could not find a month-by-month header row.' }, { ok: false, status: 400 });
    ctx.finChurchMonthlyImportFileSelected({ files: [{ name: 'bad.xlsx' }] });
    await flush();
    const status = ctx.__store['fin-church-monthly-import-status'].textContent;
    expect(status).toBe('Error: Could not find a month-by-month header row.');
    expect(ctx.__store['fin-church-monthly-import-confirm-btn'].style.display).not.toBe('');
  });
});

// ── Data & Imports staleness card ────────────────────────────────────────────────────────────
// The card is the whole point of the Data & Imports tab: it shows which feeds have gone stale.
// _finImportStatus used to be fetched once per page load behind an `if (!_finImportStatus)` guard
// and never invalidated by any of the ten importers, so a successful import wrote its log row and
// the card went on rendering the cached "never" until a full page reload. Reported live after a
// real Monthly P&L upload.

function makeStatusCtx(responses) {
  const store = {};
  const el = (id) => ({
    id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false,
    files: [], classList: { add() {}, remove() {}, contains() { return false; } },
    appendChild() {}, addEventListener() {}, querySelector() { return null; },
    querySelectorAll() { return []; }, setAttribute() {}, focus() {},
  });
  store['fin-imports-card'] = el('fin-imports-card');
  const calls = [];
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
    fetch: () => Promise.reject(new Error('no network in tests')),
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_CORE_JS, ctx, { filename: 'app-core.js' });
  vm.runInContext(CHMS_APP_EXT_JS, ctx, { filename: 'app-ext.js' });
  ctx.api = (u) => { calls.push(u); return Promise.resolve(responses.shift()); };
  ctx.__store = store; ctx.__calls = calls;
  return ctx;
}

const statusResp = (when) => ({
  importers: [{ key: 'church_monthly_pnl', label: 'Monthly P&L', group: 'church', lastImportedAt: when, note: '', derived: false }],
});

describe('Data & Imports staleness card', () => {
  it('refetches on every render instead of caching the first answer for the session', async () => {
    const ctx = makeStatusCtx([statusResp(''), statusResp('2026-08-07T03:00:00Z')]);
    await ctx.finRefreshImportStatus();
    expect(ctx._finImportStatus[0].lastImportedAt).toBe('');
    // Second render — e.g. returning to the tab after running an import.
    await ctx.finRefreshImportStatus();
    expect(ctx.__calls).toHaveLength(2);
    expect(ctx._finImportStatus[0].lastImportedAt).toBe('2026-08-07T03:00:00Z');
    expect(ctx.__store['fin-imports-card'].innerHTML).not.toMatch(/never/i);
  });

  it('a successful monthly import refreshes the card in place', async () => {
    const ctx = makeCtx(MULTI_YEAR_RESPONSE);
    ctx.document.getElementById('fin-imports-card');
    const seen = [];
    ctx.api = (u, o) => {
      seen.push(u);
      if (u.indexOf('import-status') !== -1) return Promise.resolve(statusResp('2026-08-07T03:00:00Z'));
      const b = JSON.parse(o.body);
      return Promise.resolve({ ok: true, imported: b.rows.length });
    };
    ctx.closeModal = () => {}; ctx.finToast = () => {};
    ctx.finRenderChurchReport = () => {}; ctx.finLoadHealth = () => {};
    ctx._finChurchMonthlyImportPreview = MULTI_YEAR_RESPONSE;
    ctx.finChurchConfirmMonthlyImport();
    await new Promise(r => setTimeout(r, 10));
    expect(seen.filter(u => u.indexOf('import-status') !== -1)).toHaveLength(1);
  });
});

// ── Every importer must refresh the staleness card ───────────────────────────────────────────
// v1.151.2 made finRenderDataImports() always refetch, and wired an in-place refresh into the
// import success handlers — but only the five that happened to call finRenderChurchReport(). The
// other five did not, so the Balance Sheet import (which calls finLoadChurchBalances instead)
// still left the date unchanged after a successful import. Reported live. These assert the wiring
// by function body, so a new importer that forgets it fails here rather than in production.

function bodyOf(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('function not found in bundle: ' + name);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name);
}

const BUNDLE = CHMS_APP_CORE_JS + '\n' + CHMS_APP_EXT_JS;

describe('import success handlers refresh the Data & Imports staleness card', () => {
  // One entry per importer whose route calls recordImport() and whose commit is driven by a
  // named handler. The five below are the ones that were missing the call.
  const HANDLERS = [
    'finChurchConfirmBalanceImport',        // church_balance — the reported failure
    'finDaycareChurchBudgetImport',         // daycare_church_budget
    'finDaycareBulkImport',                 // daycare_bulk
    'finPropertyImportMonthlyCsv',          // property_monthly_csv
    'finPropertyBudgetImportFileSelected',  // property_budget_xlsx
    // Already wired in v1.151.2, asserted so they cannot silently regress.
    'finChurchConfirmMonthlyImport',        // church_monthly_pnl
  ];
  it.each(HANDLERS)('%s calls finRefreshImportStatus()', (name) => {
    expect(bodyOf(BUNDLE, name)).toContain('finRefreshImportStatus()');
  });

  it('has one refresh call per importer that records one, plus the tab render', async () => {
    const { FINANCE_IMPORTERS } = await import('../src/api-finance.js');
    const calls = (BUNDLE.match(/finRefreshImportStatus\(\);/g) || []).length;
    // 10 importers + finRenderDataImports(). A new importer must add its own call.
    expect(calls).toBeGreaterThanOrEqual(FINANCE_IMPORTERS.length + 1);
  });
});
