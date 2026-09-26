import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleFinanceApi } from '../src/api-finance.js';
import { buildFinanceBalanceSheetTrendV1, respondWithFinanceBalanceSheetTrendV1 } from '../src/api-contracts.js';
import { validateFinanceBalanceSheetTrendV1, acceptFinanceBalanceSheetTrendV1 } from '../contracts/validators/finance-balance-sheet-trend-consumer.js';
import {
  buildBalanceTree, filterZeroBalanceTree, flattenBalanceTree, buildAssetComposition, parseBalanceSelection,
} from '../apps/finance/balance-sheet-service.js';
import { renderBalancePage, buildBalanceTrendCsv, renderBalanceCheck } from '../apps/finance/balance-pages.js';
import worker from '../apps/finance/shell.js';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const trendSchema = JSON.parse(readFileSync(new URL('../contracts/finance-balance-sheet-trend-v1.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validateTrendSchema = ajv.compile(trendSchema);

// Finance's Balance Sheet section must show what Connect's legacy "Balance Sheet & Financial
// Position" tab shows, computed the same way. The strongest check is to run the legacy
// `finance/church/balances/multi-year` route and the Finance trend contract against the SAME
// database and compare every figure. All accounts and amounts below are synthetic.

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0018_finance_church_entries.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0019_finance_church_balances.sql', import.meta.url), 'utf8'));
  sqlite.exec("CREATE TABLE finance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    async run() { sqlite.prepare(sql).run(...args); return { success: true }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  return { prepare: (sql) => statement(sql), async batch(list) { return Promise.all(list.map((s) => s.all())); }, _raw: sqlite };
}

function balance(db, year, classification, path, depth, cents, hasChildren = 0) {
  const name = path.split(':').at(-1);
  db._raw.prepare(`INSERT INTO finance_church_balances
    (fiscal_year, as_of_date, classification, category_path, account_name, depth, has_children, own_balance_cents, source, synced_at)
    VALUES (?,?,?,?,?,?,?,?,'import','2026-01-01')`).run(year, `FY${year}`, classification, path, name, depth, hasChildren, cents);
}

function entry(db, year, classification, cents) {
  db._raw.prepare(`INSERT INTO finance_church_entries
    (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source, synced_at)
    VALUES (?,0,?,?,?,0,0,?,NULL,'import','2026-01-01')`).run(year, classification, `${classification}:Synthetic`, 'Synthetic', cents);
}

// One synthetic chart of accounts: a checking account that is also a parent (with a $0 "cash on
// hand" line under it), a zero-balance leaf, fixed assets, a designated fund filed under
// Liabilities (reclassified to net assets), and an unclassified equity line.
function seedYear(db, year, { checking, savings, building = 30000000, payable, memorial, unrestricted, newFund = 0, pettyCash = null }) {
  balance(db, year, 'Assets', 'Assets', 0, 0, 1);
  balance(db, year, 'Assets', 'Assets:Current Assets', 1, 0, 1);
  balance(db, year, 'Assets', 'Assets:Current Assets:11027 Operating Checking', 2, checking, 1);
  balance(db, year, 'Assets', 'Assets:Current Assets:11027 Operating Checking:11030 Cash on hand', 3, 0);
  balance(db, year, 'Assets', 'Assets:Current Assets:11040 Reserve Savings', 2, savings);
  balance(db, year, 'Assets', 'Assets:Current Assets:11050 Closed Grant Account', 2, 0);
  if (pettyCash !== null) balance(db, year, 'Assets', 'Assets:Current Assets:11070 Petty Cash', 2, pettyCash);
  balance(db, year, 'Assets', 'Assets:Fixed Assets', 1, 0, 1);
  balance(db, year, 'Assets', 'Assets:Fixed Assets:15000 Building', 2, building);
  balance(db, year, 'Liabilities', 'Liabilities', 0, 0, 1);
  balance(db, year, 'Liabilities', 'Liabilities:20000 Accounts Payable', 1, payable);
  balance(db, year, 'Liabilities', 'Liabilities:25000 Funds', 1, 0, 1);
  balance(db, year, 'Liabilities', 'Liabilities:25000 Funds:25004 Memorial Fund', 2, memorial);
  balance(db, year, 'Equity', 'Equity', 0, 0, 1);
  balance(db, year, 'Equity', 'Equity:31000 Unrestricted Net Assets', 1, unrestricted);
  if (newFund) balance(db, year, 'Equity', 'Equity:39000 New Fund', 1, newFund);
}

function seededDb() {
  const db = makeDb();
  seedYear(db, 2024, { checking: 4000000, savings: 2000000, payable: 1500000, memorial: 400000, unrestricted: 34100000 });
  seedYear(db, 2025, { checking: 5000000, savings: 2000000, payable: 1000000, memorial: 500000, unrestricted: 35000000, newFund: 500000 });
  seedYear(db, 2026, { checking: 6000000, savings: 2500000, payable: 800000, memorial: 700000, unrestricted: 36510000, newFund: 500000, pettyCash: 10000 });
  // 2025: change in net assets 1,500,000 = net income -> ties out. 2026: net income 2,000,000
  // against a 1,710,000 change -> a 290,000 difference to explain.
  entry(db, 2025, 'Income', 5000000); entry(db, 2025, 'Expenses', 3500000);
  entry(db, 2026, 'Income', 5000000); entry(db, 2026, 'Expenses', 3000000);
  db._raw.prepare("INSERT INTO finance_settings (key, value) VALUES ('finance_cash_policy', ?)").run(JSON.stringify({ cash_account_code: '11027' }));
  return db;
}

async function legacyMultiYear(db, years) {
  const url = new URL(`https://x/admin/api/finance/church/balances/multi-year${years ? `?years=${years.join(',')}` : ''}`);
  const res = await handleFinanceApi({}, {}, url, 'GET', 'finance/church/balances/multi-year', db, true, true);
  return res.json();
}

function expectSameAsLegacy(trend, legacy) {
  expect(trend.years.map((y) => y.fiscalYear)).toEqual(legacy.years);
  for (const y of trend.years) {
    const s = legacy.byYear[y.fiscalYear];
    expect({
      assets: y.assetsCents, current: y.currentAssetsCents, fixed: y.fixedAssetsCents, other: y.otherAssetsCents,
      liabilities: y.liabilitiesCents, equity: y.equityCents, balanced: y.balancedCents,
    }).toEqual({
      assets: s.assetsCents, current: s.currentAssetsCents, fixed: s.fixedAssetsCents, other: s.otherAssetsCents,
      liabilities: s.liabilitiesCents, equity: s.equityCents, balanced: s.balancedCents,
    });
    const er = legacy.equityReclassByYear[y.fiscalYear];
    expect(y.equityReclass).toEqual(er ? {
      donorRestrictedCents: er.donorRestrictedCents, unrestrictedCents: er.unrestrictedCents,
      totalEquityCents: er.totalEquityCents, unclassifiedCount: er.unclassified.length,
    } : null);
    expect(y.cash).toEqual(legacy.cashByYear[y.fiscalYear]);
    expect(y.netIncomeCents).toEqual(legacy.netIncomeByYear[y.fiscalYear]);
  }
  expect(trend.cashAccountCode).toBe(legacy.cashAccountCode);
  expect(trend.pnlTieOut).toEqual({
    rows: legacy.reconciliation.rows.map((r) => ({
      year: r.year, priorYear: r.prior_year, equityCents: r.equity_cents, priorEquityCents: r.prior_equity_cents,
      changeCents: r.change_cents, netIncomeCents: r.net_income_cents, differenceCents: r.difference_cents, status: r.status,
    })),
    checked: legacy.reconciliation.checked, matched: legacy.reconciliation.matched, unexplained: legacy.reconciliation.unexplained,
  });
}

describe('Balance Sheet trend contract matches Connect’s legacy multi-year route', () => {
  it('every year on file (no window): same figures, cash, net income, and tie-out', async () => {
    const db = seededDb();
    const trend = await buildFinanceBalanceSheetTrendV1(db, { now: new Date('2026-09-26T12:00:00Z') });
    expect(validateFinanceBalanceSheetTrendV1(trend).errors).toEqual([]);
    expectSameAsLegacy(trend, await legacyMultiYear(db));
    const y2025 = trend.years.find((y) => y.fiscalYear === 2025);
    expect(y2025).toMatchObject({ assetsCents: 37000000, currentAssetsCents: 7000000, fixedAssetsCents: 30000000, liabilitiesCents: 1000000, equityCents: 36000000 });
    // The checking account is a parent with its own money -- it still counts as operating cash.
    expect(y2025.cash).toEqual({
      operatingCents: 5000000, operatingAccounts: ['11027 Operating Checking'],
      allCashCents: 7000000, allCashAccounts: ['11027 Operating Checking', '11030 Cash on hand', '11040 Reserve Savings'],
    });
    expect(trend.pnlTieOut.rows.map((r) => r.status)).toEqual(['no_prior_balance', 'ok', 'off']);
  });

  it('an explicit window reads the year before as opening net assets and keeps gap years', async () => {
    const db = seededDb();
    const trend = await buildFinanceBalanceSheetTrendV1(db, { fromYear: 2025, toYear: 2027 });
    expect(validateFinanceBalanceSheetTrendV1(trend).errors).toEqual([]);
    expectSameAsLegacy(trend, await legacyMultiYear(db, [2025, 2026, 2027]));
    expect(trend.years.map((y) => y.fiscalYear)).toEqual([2025, 2026, 2027]);
    expect(trend.years[2]).toMatchObject({ hasBalanceSheet: false, assetsCents: 0, equityReclass: null, cash: null });
    // 2025 is checkable because 2024 was read as its opening balance, though 2024 is not listed.
    expect(trend.pnlTieOut.rows[0]).toMatchObject({ year: 2025, priorEquityCents: 34500000, status: 'ok' });
  });

  it('rejects a malformed or oversized window with a 400', async () => {
    const db = seededDb();
    for (const query of ['from_year=2026&to_year=2025', 'from_year=2000&to_year=2030', 'from_year=2025', 'from_year=abcd&to_year=2026']) {
      const res = await respondWithFinanceBalanceSheetTrendV1(db, new URL(`https://x/api/contracts/finance-balance-sheet-trend-v1?${query}`));
      expect(res.status, query).toBe(400);
    }
    const ok = await respondWithFinanceBalanceSheetTrendV1(db, new URL('https://x/api/contracts/finance-balance-sheet-trend-v1?from_year=2025&to_year=2026'));
    expect(ok.status).toBe(200);
    expect((await ok.json()).years.map((y) => y.fiscalYear)).toEqual([2025, 2026]);
  });
});

describe('trend consumer: the parity extension is all-or-nothing', () => {
  async function extended() {
    return JSON.parse(JSON.stringify(await buildFinanceBalanceSheetTrendV1(seededDb(), { now: new Date('2026-09-26T12:00:00Z') })));
  }

  it('still accepts an older producer’s base-only payload', async () => {
    const payload = await extended();
    delete payload.cashAccountCode; delete payload.pnlTieOut;
    for (const y of payload.years) {
      for (const key of ['currentAssetsCents', 'fixedAssetsCents', 'otherAssetsCents', 'hasBalanceSheet', 'equityReclass', 'cash', 'netIncomeCents']) delete y[key];
    }
    expect(validateFinanceBalanceSheetTrendV1(payload).errors).toEqual([]);
    expect(acceptFinanceBalanceSheetTrendV1(payload).pnlTieOut).toBeUndefined();
  });

  it('rejects a partial extension, a broken asset split, and a tampered tie-out', async () => {
    const partial = await extended();
    delete partial.years[0].cash;
    expect(validateFinanceBalanceSheetTrendV1(partial).ok).toBe(false);

    const split = await extended();
    split.years[1].currentAssetsCents += 1;
    expect(validateFinanceBalanceSheetTrendV1(split).ok).toBe(false);

    const status = await extended();
    status.pnlTieOut.rows[2].status = 'ok';
    expect(validateFinanceBalanceSheetTrendV1(status).ok).toBe(false);

    const count = await extended();
    count.pnlTieOut.matched = 2;
    expect(validateFinanceBalanceSheetTrendV1(count).ok).toBe(false);

    const unknown = await extended();
    unknown.years[0].cash.extra = 1;
    expect(validateFinanceBalanceSheetTrendV1(unknown).ok).toBe(false);
  });

  it('the published JSON schema accepts both the extended and the base-only shape', async () => {
    const payload = await extended();
    expect(validateTrendSchema(payload), JSON.stringify(validateTrendSchema.errors)).toBe(true);
    const windowed = JSON.parse(JSON.stringify(await buildFinanceBalanceSheetTrendV1(seededDb(), { fromYear: 2025, toYear: 2027, now: new Date('2026-09-26T12:00:00Z') })));
    expect(validateTrendSchema(windowed), JSON.stringify(validateTrendSchema.errors)).toBe(true);
  });

  it('accept() returns detached copies', async () => {
    const payload = await extended();
    const accepted = acceptFinanceBalanceSheetTrendV1(payload);
    expect(accepted.years[1].cash).toEqual(payload.years[1].cash);
    expect(accepted.years[1].cash.allCashAccounts).not.toBe(payload.years[1].cash.allCashAccounts);
    expect(accepted.pnlTieOut.rows).not.toBe(payload.pnlTieOut.rows);
  });
});

const ACCOUNTS = [
  { classification: 'Assets', categoryPath: 'Assets', accountName: 'Assets', depth: 0, hasChildren: true, ownBalanceCents: 0 },
  { classification: 'Assets', categoryPath: 'Assets:Current Assets', accountName: 'Current Assets', depth: 1, hasChildren: true, ownBalanceCents: 0 },
  { classification: 'Assets', categoryPath: 'Assets:Current Assets:11027 Operating Checking', accountName: '11027 Operating Checking', depth: 2, hasChildren: true, ownBalanceCents: 600000 },
  { classification: 'Assets', categoryPath: 'Assets:Current Assets:11027 Operating Checking:11030 Cash on hand', accountName: '11030 Cash on hand', depth: 3, hasChildren: false, ownBalanceCents: 0 },
  { classification: 'Assets', categoryPath: 'Assets:Current Assets:11050 Closed Grant Account', accountName: '11050 Closed Grant Account', depth: 2, hasChildren: false, ownBalanceCents: 0 },
  { classification: 'Assets', categoryPath: 'Assets:Fixed Assets', accountName: 'Fixed Assets', depth: 1, hasChildren: true, ownBalanceCents: 0 },
  { classification: 'Assets', categoryPath: 'Assets:Fixed Assets:15000 Building', accountName: '15000 Building', depth: 2, hasChildren: false, ownBalanceCents: 1800000 },
  { classification: 'Equity', categoryPath: 'Equity', accountName: 'Equity', depth: 0, hasChildren: true, ownBalanceCents: 0 },
  { classification: 'Equity', categoryPath: 'Equity:31000 Unrestricted Net Assets', accountName: '31000 Unrestricted Net Assets', depth: 1, hasChildren: false, ownBalanceCents: 2400000 },
];

describe('account tree (Connect’s finBuildBalanceTreeFromFlatRows and zero-line filter)', () => {
  it('rolls totals up the tree and splits asset composition by group', () => {
    const tree = buildBalanceTree(ACCOUNTS);
    expect(tree.map((n) => [n.label, n.totalBalanceCents])).toEqual([['Assets', 2400000], ['Equity', 2400000]]);
    expect(buildAssetComposition(tree)).toEqual([
      { label: 'Fixed Assets', cents: 1800000, sharePct: 75 },
      { label: 'Current Assets', cents: 600000, sharePct: 25 },
    ]);
  });

  it('hides zero lines but never a parent that holds its own money', () => {
    const shown = flattenBalanceTree(filterZeroBalanceTree(buildBalanceTree(ACCOUNTS))).map((n) => n.label);
    expect(shown).toContain('11027 Operating Checking');
    expect(shown).not.toContain('11030 Cash on hand');
    expect(shown).not.toContain('11050 Closed Grant Account');
    const all = flattenBalanceTree(filterZeroBalanceTree(buildBalanceTree(ACCOUNTS), { hideZero: false })).map((n) => n.label);
    expect(all).toContain('11050 Closed Grant Account');
  });
});

describe('parseBalanceSelection', () => {
  it('reads the year, the range, and the zero toggle, falling back with a note on bad input', () => {
    const now = new Date('2026-09-26T12:00:00Z');
    expect(parseBalanceSelection(new URLSearchParams(''), now)).toMatchObject({ fiscalYear: 2026, fromYear: null, toYear: null, hideZero: true, yearError: null, rangeError: null });
    expect(parseBalanceSelection(new URLSearchParams('fiscal_year=2024&from_year=2019&to_year=2026&zero=show'), now)).toMatchObject({ fiscalYear: 2024, fromYear: 2019, toYear: 2026, hideZero: false });
    expect(parseBalanceSelection(new URLSearchParams('fiscal_year=24'), now)).toMatchObject({ fiscalYear: 2026, yearError: 'Enter a valid year.' });
    expect(parseBalanceSelection(new URLSearchParams('from_year=2026&to_year=2020'), now).rangeError).toBe('Enter a valid From/To year range.');
    expect(parseBalanceSelection(new URLSearchParams('from_year=2000&to_year=2030'), now).rangeError).toMatch(/20 years or fewer/);
  });
});

describe('Balance Sheet pages render Connect’s sections', () => {
  const equityReclass = {
    donorRestrictedCents: 500000, unrestrictedCents: 1900000, totalEquityCents: 2400000,
    breakdown: {
      perpetual: { label: 'Perpetual endowments', cents: 0 },
      purpose_time: { label: 'Purpose/time restricted', cents: 0 },
      designated: { label: 'Designated ministry/purpose funds', cents: 500000 },
    },
    unclassified: [{ accountName: '39000 New Fund', categoryPath: 'Equity:39000 New Fund', ownBalanceCents: 12300 }],
  };
  const liveSheet = (accounts = ACCOUNTS, balancedCents = 0) => ({
    source: 'live', fiscalYear: 2026, asOfDate: 'December 31, 2026', accounts,
    totals: { assetsCents: 2400000, liabilitiesCents: 0, equityCents: 2400000, balancedCents }, equityReclass,
  });
  const prior = { ok: true, fiscalYear: 2025, accounts: ACCOUNTS.filter((a) => a.accountName !== '15000 Building') };

  it('Position: year picker, balance check, designated note, restricted buckets, unclassified names, composition, and year over year', () => {
    const html = renderBalancePage('position', { balanceSheet: liveSheet(), balanceTrends: { source: 'live', rows: [] }, balancePriorYear: prior, selection: parseBalanceSelection(new URLSearchParams('fiscal_year=2026')) });
    expect(html).toContain('name="fiscal_year"');
    expect(html).toContain('✓ Balances (Assets = Liabilities + Net assets)');
    expect(html).toContain('shown here as net assets, not as a liability');
    expect(html).toContain('Designated ministry/purpose funds');
    expect(html).not.toContain('Perpetual endowments'); // empty buckets are left out, like Connect
    expect(html).toContain('39000 New Fund');
    expect(html).toContain('$123');
    expect(html).toContain('Asset composition');
    expect(html).toContain('75.0%');
    expect(html).toContain('2026 vs. 2025');
    expect(html).toContain('new this year'); // the building has no 2025 line
    expect(html).not.toContain('Full account detail'); // only the print sheet adds it
  });

  it('Position print adds the filtered account detail; an unbalanced sheet reports the difference', () => {
    const html = renderBalancePage('position', { balanceSheet: liveSheet(ACCOUNTS, 4321), balanceTrends: { source: 'live', rows: [] }, balancePriorYear: prior, printMode: true });
    const detail = html.slice(html.indexOf('Full account detail'));
    expect(detail).toContain('11027 Operating Checking');
    expect(detail).not.toContain('11050 Closed Grant Account');
    expect(html).toContain('⚠ Off by $43.21');
    expect(renderBalanceCheck(-150)).toContain('Off by $1.50');
  });

  it('Position says so when the chosen year has no balance sheet, and when last year is missing', () => {
    const empty = renderBalancePage('position', { balanceSheet: { ...liveSheet([]), asOfDate: '' }, balanceTrends: { source: 'live', rows: [] } });
    expect(empty).toContain('No balance sheet imported yet for 2026');
    const noPrior = renderBalancePage('position', { balanceSheet: liveSheet(), balanceTrends: { source: 'live', rows: [] }, balancePriorYear: { ok: true, fiscalYear: 2025, accounts: [] } });
    expect(noPrior).toContain('No 2025 balance sheet on file yet');
  });

  it('Account detail: indented tree, zero lines hidden by default with a toggle to show them', () => {
    const hidden = renderBalancePage('account-detail', { balanceSheet: liveSheet(), balanceTrends: { source: 'live', rows: [] }, selection: parseBalanceSelection(new URLSearchParams('')) });
    expect(hidden).toContain('padding-left:46px'); // depth 2
    expect(hidden).toContain('11027 Operating Checking');
    expect(hidden).not.toContain('11050 Closed Grant Account');
    expect(hidden).toContain('2 zero-balance lines hidden');
    expect(hidden).toContain('zero=show');
    const shown = renderBalancePage('account-detail', { balanceSheet: liveSheet(), balanceTrends: { source: 'live', rows: [] }, selection: parseBalanceSelection(new URLSearchParams('zero=show')) });
    expect(shown).toContain('11050 Closed Grant Account');
    expect(shown).toContain('Hide zero-balance lines');
  });

  it('Multi-year: stacked trend, cash, growth tables, tie-out, and net assets by year from the live contract', async () => {
    const trend = acceptFinanceBalanceSheetTrendV1(await buildFinanceBalanceSheetTrendV1(seededDb(), { now: new Date('2026-09-26T12:00:00Z') }));
    const balanceTrends = {
      source: 'live',
      rows: trend.years.map((y) => ({ fiscal_year: y.fiscalYear, as_of_date: y.asOfDate, assets_cents: y.assetsCents, liabilities_cents: y.liabilitiesCents, equity_cents: y.equityCents, net_assets_cents: y.netAssetsCents })),
      detail: { years: trend.years, pnlTieOut: trend.pnlTieOut, cashAccountCode: trend.cashAccountCode },
    };
    const html = renderBalancePage('multi-year', { balanceTrends, selection: parseBalanceSelection(new URLSearchParams('')) });
    expect(html).toContain('name="from_year"');
    expect(html).toContain('format=csv');
    expect(html).toContain('class="bs-seg s-current"');
    expect(html).toContain('Current assets 2025: $70,000.00 (total assets $370,000.00)');
    expect(html).toContain('Cash &amp; bank accounts over time');
    expect(html).toContain('2026: 11027 Operating Checking, 11030 Cash on hand, 11040 Reserve Savings, 11070 Petty Cash');
    expect(html).toContain('Operating checking is account 11027');
    expect(html).toContain('Net worth growth by year');
    expect(html).toContain('2025 → 2026');
    expect(html).toContain('Asset growth by year');
    expect(html).toContain('1 of 2 years tie out exactly.');
    expect(html).toContain('✓ Matches');
    expect(html).toContain('Difference of $2,900.00');
    expect(html).toContain('No 2023 balance sheet — import it to check this year');
    expect(html).toContain('Net assets by year');
    expect(html).toContain('⚠ 1 unclassified');
    expect(html).not.toContain('<script');
  });

  it('Multi-year without the extension (older producer or synthetic) keeps the plain table', () => {
    const html = renderBalancePage('multi-year', { balanceTrends: { source: 'synthetic-fallback', fallbackReason: 'not_configured', rows: [{ fiscal_year: 2026, as_of_date: '2026-12-31', assets_cents: 100, liabilities_cents: 0, equity_cents: 100, net_assets_cents: 100 }] } });
    expect(html).toContain('Position by year');
    expect(html).not.toContain('Net worth growth by year');
  });

  it('CSV export matches Connect’s columns, in dollars, blank where a figure is absent', async () => {
    const trend = acceptFinanceBalanceSheetTrendV1(await buildFinanceBalanceSheetTrendV1(seededDb(), { now: new Date('2026-09-26T12:00:00Z') }));
    const csv = buildBalanceTrendCsv({ source: 'live', rows: [], detail: { years: trend.years, pnlTieOut: trend.pnlTieOut, cashAccountCode: '' } });
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('"Year","Assets","Current Assets","Fixed Assets","Other Assets","Liabilities","Equity","Operating Checking","All Cash & Bank Accounts"');
    expect(lines[2]).toBe('2025,370000,70000,300000,0,10000,360000,50000,70000');
    const synthetic = buildBalanceTrendCsv({ source: 'synthetic-fallback', rows: [{ fiscal_year: 2026, assets_cents: 12345, liabilities_cents: 0, equity_cents: 12345 }] });
    expect(synthetic.trim().split('\n')[1]).toBe('2026,123.45,,,,0,123.45,,');
  });
});

describe('Finance shell serves the parity pages from its own database', () => {
  function shellEnv(db) {
    return {
      ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha', FINANCE_LOCAL_CONTRACT_READS: '1', FINANCE_DB: db, FINANCE_CONTRACT_API_KEY: 'test-secret',
      CONNECT_SERVICE: {
        async fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role: 'admin', identity: 'office@example.com' }), { status: 200 });
          return new Response('{}', { status: 503 });
        },
      },
    };
  }

  it('renders the chosen year and last year’s comparison, the ranged trend, and the CSV download', async () => {
    const env = shellEnv(seededDb());
    const get = (path) => worker.fetch(new Request(`https://finance.test${path}`, { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), env);
    const position = await (await get('/?section=balance&page=position&fiscal_year=2025')).text();
    expect(position).toContain('Financial position as of FY2025');
    expect(position).toContain('Live from Connect');
    expect(position).toContain('2025 vs. 2024');
    expect(position).toContain('$370,000');

    const trend = await (await get('/?section=balance&page=multi-year&from_year=2025&to_year=2026')).text();
    expect(trend).toContain('Net worth growth by year');
    expect(trend).toContain('value="2025"');
    expect(trend).not.toContain('<td>2024</td>');

    const csvRes = await get('/?section=balance&page=multi-year&format=csv&from_year=2025&to_year=2026');
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(csvRes.headers.get('content-disposition')).toContain('balance-sheet-multi-year.csv');
    const csv = await csvRes.text();
    expect(csv.trim().split('\n').map((line) => line.split(',')[0])).toEqual(['"Year"', '2025', '2026']);

    const print = await (await get('/?section=balance&page=position&fiscal_year=2026&print=1')).text();
    expect(print).toContain('Full account detail');
    expect(print).toContain('.bs-chart');
  });
});
