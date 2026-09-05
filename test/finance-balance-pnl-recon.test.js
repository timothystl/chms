import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { computeBalanceVsPnlReconciliation, computeBalanceSummary, computeYearCashSummary, assetGroupOf, handleFinanceApi } from '../src/api-finance.js';

// A year's summary as computeBalanceSummary() really produces it — including the detail that
// matters most here: a year with NO imported rows returns a fully zeroed summary with an EMPTY
// classificationTotals map, which is the only thing distinguishing "not uploaded" from a real
// $0 equity.
function summaryFor(equityCents) {
  return computeBalanceSummary([
    { classification: 'Assets', own_balance_cents: equityCents },
    { classification: 'Equity', own_balance_cents: equityCents },
  ]);
}
const NO_DATA = computeBalanceSummary([]);

describe('computeBalanceVsPnlReconciliation', () => {
  it('ties a year out when the change in equity equals net income', () => {
    const rec = computeBalanceVsPnlReconciliation(
      [2024, 2025],
      { 2024: summaryFor(100000), 2025: summaryFor(90000) },
      { 2024: null, 2025: -10000 },
    );
    const y2025 = rec.rows.find(r => r.year === 2025);
    expect(y2025.prior_equity_cents).toBe(100000);
    expect(y2025.change_cents).toBe(-10000);
    expect(y2025.net_income_cents).toBe(-10000);
    expect(y2025.difference_cents).toBe(0);
    expect(y2025.status).toBe('ok');
    expect(rec.checked).toBe(1);
    expect(rec.matched).toBe(1);
    expect(rec.unexplained).toBe(0);
  });

  it('reports a real gap as a difference to explain, with the signed amount', () => {
    const rec = computeBalanceVsPnlReconciliation(
      [2024, 2025],
      { 2024: summaryFor(100000), 2025: summaryFor(150000) },
      { 2024: null, 2025: 20000 },
    );
    const y2025 = rec.rows.find(r => r.year === 2025);
    expect(y2025.change_cents).toBe(50000);
    expect(y2025.difference_cents).toBe(30000);
    expect(y2025.status).toBe('off');
    expect(rec.matched).toBe(0);
    expect(rec.unexplained).toBe(1);
  });

  it('absorbs sub-dollar rounding but not a dollar and a cent', () => {
    const within = computeBalanceVsPnlReconciliation([2024, 2025],
      { 2024: summaryFor(0), 2025: summaryFor(10100) }, { 2025: 10000 });
    expect(within.rows.find(r => r.year === 2025).status).toBe('ok');
    const beyond = computeBalanceVsPnlReconciliation([2024, 2025],
      { 2024: summaryFor(0), 2025: summaryFor(10101) }, { 2025: 10000 });
    expect(beyond.rows.find(r => r.year === 2025).status).toBe('off');
  });

  it('does not treat a year with no balance sheet as $0 equity', () => {
    // 2024 has no import at all. If its zeroed summary were taken at face value, 2025 would
    // report a $150,000 "change" against its own equity and read as a huge unexplained gap —
    // the exact false alarm an admin part-way through uploading history would hit.
    const rec = computeBalanceVsPnlReconciliation(
      [2024, 2025],
      { 2024: NO_DATA, 2025: summaryFor(150000) },
      { 2024: 500, 2025: 20000 },
    );
    expect(rec.rows.map(r => r.year)).toEqual([2025]); // 2024 has nothing to report on
    const y2025 = rec.rows[0];
    expect(y2025.status).toBe('no_prior_balance');
    expect(y2025.change_cents).toBeNull();
    expect(y2025.difference_cents).toBeNull();
    expect(rec.checked).toBe(0);
  });

  it('says so when the balance sheet is there but the income statement is not', () => {
    const rec = computeBalanceVsPnlReconciliation(
      [2024, 2025],
      { 2024: summaryFor(100000), 2025: summaryFor(90000) },
      { 2024: null, 2025: null },
    );
    expect(rec.rows.find(r => r.year === 2025).status).toBe('no_pnl');
    expect(rec.checked).toBe(0);
  });

  it('only compares consecutive years — a gap in the uploaded history is not silently bridged', () => {
    const rec = computeBalanceVsPnlReconciliation(
      [2022, 2024],
      { 2022: summaryFor(100000), 2023: NO_DATA, 2024: summaryFor(90000) },
      { 2022: 1, 2024: -10000 },
    );
    // 2024's predecessor is 2023, which was never uploaded — comparing against 2022 would
    // silently attribute two years of movement to one year's net income.
    expect(rec.rows.find(r => r.year === 2024).status).toBe('no_prior_balance');
  });
});

// ── The real route, against real SQL ────────────────────────────────────────────────────────
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0018_finance_church_entries.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0019_finance_church_balances.sql', import.meta.url), 'utf8'));
  // The multi-year balances route now also reads the cash policy (Balance Sheet's new "Cash &
  // Bank Accounts Over Time" trend, 2026-09-04) via readCashPolicy(), which queries this table.
  sqlite.exec(`CREATE TABLE chms_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`);
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { sqlite.prepare(sql).run(...args); },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async all() { return { results: sqlite.prepare(sql).all() }; },
        async first() { return sqlite.prepare(sql).get(); },
      };
    },
    async batch(stmts) { for (const s of stmts) await s.run(); },
    _raw: sqlite,
  };
}
function insertBalance(db, year, classification, cents) {
  db._raw.prepare(`INSERT INTO finance_church_balances
    (fiscal_year, as_of_date, classification, category_path, account_name, depth, has_children, own_balance_cents, source, synced_at)
    VALUES (?,?,?,?,?,0,0,?,'import','2026-01-01')`)
    .run(year, `FY${year}`, classification, `${classification}:${year}`, classification, cents);
}
function insertEntry(db, year, classification, actualCents) {
  db._raw.prepare(`INSERT INTO finance_church_entries
    (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source, synced_at)
    VALUES (?,0,?,?,?,0,0,?,NULL,'import','2026-01-01')`)
    .run(year, classification, `${classification}:${year}`, classification, actualCents);
}
async function getMultiYear(db, years) {
  const url = new URL('https://x/admin/api/finance/church/balances/multi-year?years=' + years.join(','));
  const res = await handleFinanceApi({}, {}, url, 'GET', 'finance/church/balances/multi-year', db, true, true);
  return await res.json();
}

describe('GET finance/church/balances/multi-year — tie-out against the income statement', () => {
  it('ties out a past year using the year before the requested range as its opening equity', async () => {
    const db = makeTestDb();
    // 2021 exists only as the opening balance for 2022 — it is NOT in the requested range.
    insertBalance(db, 2021, 'Assets', 700000); insertBalance(db, 2021, 'Equity', 700000);
    insertBalance(db, 2022, 'Assets', 650000); insertBalance(db, 2022, 'Equity', 650000);
    insertEntry(db, 2022, 'Income', 100000);
    insertEntry(db, 2022, 'Expenses', 150000);

    const d = await getMultiYear(db, [2022, 2023]);
    expect(d.netIncomeByYear[2022]).toBe(-50000);
    const y2022 = d.reconciliation.rows.find(r => r.year === 2022);
    expect(y2022.prior_equity_cents).toBe(700000);
    expect(y2022.change_cents).toBe(-50000);
    expect(y2022.status).toBe('ok');
    // A year in the range with no balance sheet is simply absent, not reported as $0.
    expect(d.reconciliation.rows.some(r => r.year === 2023)).toBe(false);
  });

  it('surfaces a year whose equity movement does not match its net income', async () => {
    const db = makeTestDb();
    insertBalance(db, 2023, 'Equity', 500000);
    insertBalance(db, 2024, 'Equity', 560000);
    insertEntry(db, 2024, 'Income', 200000);
    insertEntry(db, 2024, 'Expenses', 190000); // net income 10,000 vs 60,000 of equity movement
    const d = await getMultiYear(db, [2023, 2024]);
    const y2024 = d.reconciliation.rows.find(r => r.year === 2024);
    expect(y2024.status).toBe('off');
    expect(y2024.difference_cents).toBe(50000);
    expect(d.reconciliation.unexplained).toBe(1);
  });

  it('returns an empty tie-out rather than failing when nothing has been imported yet', async () => {
    const d = await getMultiYear(makeTestDb(), [2025, 2026]);
    expect(d.reconciliation.rows).toEqual([]);
    expect(d.reconciliation.checked).toBe(0);
  });

  // "Cash & Bank Accounts Over Time" trend (Balance Sheet tab, 2026-09-04) — cashByYear/
  // cashAccountCode added alongside the existing tie-out, from the same rows already fetched.
  it('includes a per-year cash summary, reading the pinned operating cash account code', async () => {
    const db = makeTestDb();
    await db.prepare(
      `INSERT INTO chms_config (key,value) VALUES ('finance_cash_policy',?)`
    ).bind(JSON.stringify({ cash_account_code: '11027' })).run();
    insertBalance(db, 2025, 'Equity', 500000);
    db._raw.prepare(`INSERT INTO finance_church_balances
      (fiscal_year, as_of_date, classification, category_path, account_name, depth, has_children, own_balance_cents, source, synced_at)
      VALUES (2025,'FY2025','Assets','Assets:Checking','11027 Lindell Checking xx9105',1,0,300000,'import','2026-01-01')`).run();
    db._raw.prepare(`INSERT INTO finance_church_balances
      (fiscal_year, as_of_date, classification, category_path, account_name, depth, has_children, own_balance_cents, source, synced_at)
      VALUES (2025,'FY2025','Assets','Assets:Savings','Daycare Savings',1,0,50000,'import','2026-01-01')`).run();
    const d = await getMultiYear(db, [2025]);
    expect(d.cashAccountCode).toBe('11027');
    expect(d.cashByYear[2025].operatingCents).toBe(300000);
    expect(d.cashByYear[2025].allCashCents).toBe(350000); // checking + savings, the pinned account doesn't narrow the broader sweep
  });

  it('reports null cash figures for a year with no matching account, rather than a misleading $0', async () => {
    const db = makeTestDb();
    insertBalance(db, 2025, 'Assets', 100000);
    insertBalance(db, 2025, 'Equity', 100000);
    const d = await getMultiYear(db, [2025]);
    expect(d.cashByYear[2025].operatingCents).toBeNull();
    expect(d.cashByYear[2025].allCashCents).toBeNull();
  });
});

describe('computeYearCashSummary', () => {
  const rows = [
    { classification: 'Assets', has_children: 0, account_name: '11027 Lindell Checking xx9105', own_balance_cents: 300000 },
    { classification: 'Assets', has_children: 0, account_name: 'Daycare Savings Account', own_balance_cents: 50000 },
    { classification: 'Assets', has_children: 0, account_name: 'Petty Cash Drawer', own_balance_cents: 5000 },
    { classification: 'Assets', has_children: 1, account_name: 'Cash and Bank Accounts', own_balance_cents: 0 }, // rollup, must not double-count
    { classification: 'Assets', has_children: 0, account_name: 'Accounts Receivable', own_balance_cents: 900000 }, // not cash
    { classification: 'Liabilities', has_children: 0, account_name: 'Checking Loan Payable', own_balance_cents: 20000 }, // not Assets
  ];

  it('sums every non-rollup Assets account that reads as a bank account, ignoring the group row', () => {
    const s = computeYearCashSummary(rows, '');
    expect(s.allCashCents).toBe(355000); // checking + savings + petty cash, not the rollup or the liability
    expect(s.allCashAccounts).toEqual(['11027 Lindell Checking xx9105', 'Daycare Savings Account', 'Petty Cash Drawer']);
  });

  it('the pinned operating account narrows to exactly that one account', () => {
    const s = computeYearCashSummary(rows, '11027');
    expect(s.operatingCents).toBe(300000);
    expect(s.operatingAccounts).toEqual(['11027 Lindell Checking xx9105']);
  });

  it('falls back to a name match on "checking" with no code pinned', () => {
    const s = computeYearCashSummary(rows, '');
    expect(s.operatingCents).toBe(300000);
  });

  it('returns null, not $0, when nothing matches', () => {
    const s = computeYearCashSummary([{ classification: 'Assets', has_children: 0, account_name: 'Land', own_balance_cents: 100 }], '');
    expect(s.operatingCents).toBeNull();
    expect(s.allCashCents).toBeNull();
  });
});

// ── The default trend range: every year with a balance sheet, not a rolling window ──────────
// Before this, the default was [currentYear-4 … currentYear]. This church's income statement runs
// back to 2019, so an imported 2019 balance sheet was invisible on the trend chart until someone
// widened the From/To range by hand — and the in-window years with nothing uploaded drew as real
// $0 Assets/Liabilities/Equity bars, reading as "the church had nothing" rather than "nothing was
// uploaded here".
async function getMultiYearDefault(db) {
  const url = new URL('https://x/admin/api/finance/church/balances/multi-year');
  const res = await handleFinanceApi({}, {}, url, 'GET', 'finance/church/balances/multi-year', db, true, true);
  return await res.json();
}

describe('GET finance/church/balances/multi-year — default year range', () => {
  it('includes a year older than the rolling five-year window', async () => {
    const db = makeTestDb();
    // 2019 sits well outside [currentYear-4 … currentYear] and used to be unreachable by default.
    insertBalance(db, 2019, 'Assets', 500000); insertBalance(db, 2019, 'Equity', 500000);
    insertBalance(db, 2026, 'Assets', 818000); insertBalance(db, 2026, 'Equity', 741000);
    const d = await getMultiYearDefault(db);
    expect(d.years).toContain(2019);
    expect(d.years).toContain(2026);
    expect(d.byYear[2019].equityCents).toBe(500000);
  });

  it('omits a year with no balance sheet rather than drawing it as $0', async () => {
    const db = makeTestDb();
    insertBalance(db, 2024, 'Equity', 100000);
    insertBalance(db, 2026, 'Equity', 120000);
    const d = await getMultiYearDefault(db);
    expect(d.years).toEqual([2024, 2026]);
    // The gap year is absent entirely — not present carrying a zeroed summary a chart would draw
    // as a real $0 bar.
    expect(d.years).not.toContain(2025);
    expect(d.byYear[2025]).toBeUndefined();
  });

  it('returns the years in ascending order, so the chart reads left to right', async () => {
    const db = makeTestDb();
    insertBalance(db, 2026, 'Equity', 3);
    insertBalance(db, 2019, 'Equity', 1);
    insertBalance(db, 2022, 'Equity', 2);
    const d = await getMultiYearDefault(db);
    expect(d.years).toEqual([2019, 2022, 2026]);
  });

  it('reports the earliest year as having no prior balance sheet, not a phantom tie-out', async () => {
    const db = makeTestDb();
    // Deliberately outside the old rolling window, so this exercises the new default rather than
    // passing on years that happened to fall inside it anyway.
    insertBalance(db, 2019, 'Equity', 100000);
    insertBalance(db, 2020, 'Equity', 110000);
    insertEntry(db, 2020, 'Income', 210000);
    insertEntry(db, 2020, 'Expenses', 200000);
    const d = await getMultiYearDefault(db);
    expect(d.reconciliation.rows.find(r => r.year === 2019).status).toBe('no_prior_balance');
    expect(d.reconciliation.rows.find(r => r.year === 2020).status).toBe('ok');
  });

  it('falls back to the rolling window when nothing has been imported at all', async () => {
    // The range picker renders above the empty state, so From/To still need real numbers in it.
    const cur = new Date().getFullYear();
    const d = await getMultiYearDefault(makeTestDb());
    expect(d.years).toEqual([cur - 4, cur - 3, cur - 2, cur - 1, cur]);
  });

  it('still honors an explicit range verbatim, gaps included', async () => {
    const db = makeTestDb();
    insertBalance(db, 2024, 'Equity', 100000);
    insertBalance(db, 2026, 'Equity', 120000);
    // Asking for the span on purpose is how you go looking for which year is still missing.
    const d = await getMultiYear(db, [2024, 2025, 2026]);
    expect(d.years).toEqual([2024, 2025, 2026]);
  });
});

// ── Cash accounts: a bank account that happens to have a child is still a bank account ────────
// Reported live: the "Cash & Bank Accounts Over Time" trend read ~$0 for every year but 2019.
// Cause was not missing data — it was that both cash helpers skipped any row with has_children,
// and in this church's multi-year Financial Position export "11030 Cash on hand" ($0.00) is
// nested UNDER "11027 Lindell Checking xx9105", making the real operating account a parent.
// Every balance-sheet parser stores each account's OWN, non-cumulative balance (FIN6's rule) —
// which is why computeBalanceSummary() sums every row, parents included, and still reconciles
// Assets = Liabilities + Equity — so skipping parents deleted real money rather than avoiding a
// double count.
function cashRow(name, cents, hasChildren) {
  return {
    classification: 'Assets', account_name: name, own_balance_cents: cents,
    has_children: hasChildren ? 1 : 0, as_of_date: 'FY2026',
  };
}

describe('computeYearCashSummary — bank accounts carrying their own balance', () => {
  it('counts the pinned operating account even when a child is nested under it', () => {
    // The exact reported shape: a $0.00 "Cash on hand" child makes 11027 a parent.
    const rows = [
      cashRow('11027 Lindell Checking xx9105', 11669330, true),
      cashRow('11030 Cash on hand', 0, false),
    ];
    const d = computeYearCashSummary(rows, '11027');
    expect(d.operatingCents).toBe(11669330);
    expect(d.operatingAccounts).toContain('11027 Lindell Checking xx9105');
  });

  it('counts it in the broader all-cash figure too, without double-counting the child', () => {
    const rows = [
      cashRow('11027 Lindell Checking xx9105', 11669330, true),
      cashRow('11030 Cash on hand', 500, false),
      cashRow('11025 Petty Cash', 20000, false),
    ];
    const d = computeYearCashSummary(rows, '11027');
    // Each row contributes its OWN balance once: 116,693.30 + 5.00 + 200.00.
    expect(d.allCashCents).toBe(11669330 + 500 + 20000);
    expect(d.allCashAccounts).toHaveLength(3);
  });

  it('adds nothing for a pure grouping header, which carries $0.00 of its own', () => {
    const rows = [
      cashRow('11000 Cash and Equivalents- TLC', 0, true),
      cashRow('11002 Cash and Equiv - TLC', 0, true),
      cashRow('11011 Commerce - Checking 9513', 6890420, false),
    ];
    const d = computeYearCashSummary(rows, '');
    expect(d.operatingCents).toBe(6890420);
    expect(d.allCashCents).toBe(6890420);
  });

  it('still ignores an account that is not a bank account at all', () => {
    const rows = [
      cashRow('11011 Commerce - Checking 9513', 100000, false),
      cashRow('15015 3283 Ivanhoe (Comm. Building)', 50031513, true),
      { classification: 'Liabilities', account_name: '26002 LCEF Checking-like name', own_balance_cents: 999, has_children: 0 },
    ];
    const d = computeYearCashSummary(rows, '');
    expect(d.allCashCents).toBe(100000);
    expect(d.allCashAccounts).toEqual(['11011 Commerce - Checking 9513']);
  });
});

// ── Income statement multi-year: same default-range fix as the balance sheet ──────────────────
async function getIncomeMultiYearDefault(db) {
  const url = new URL('https://x/admin/api/finance/church/multi-year');
  const res = await handleFinanceApi({}, {}, url, 'GET', 'finance/church/multi-year', db, true, true);
  return await res.json();
}
function insertEntrySource(db, year, classification, actualCents, source) {
  db._raw.prepare(`INSERT INTO finance_church_entries
    (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source, synced_at)
    VALUES (?,0,?,?,?,0,0,?,NULL,?,'2026-01-01')`)
    .run(year, classification, `${classification}:${year}`, classification, actualCents, source);
}

describe('GET finance/church/multi-year — default year range', () => {
  it('includes years older than the rolling five-year window', async () => {
    const db = makeTestDb();
    insertEntrySource(db, 2019, 'Income', 100000, 'import_activity');
    insertEntrySource(db, 2026, 'Income', 120000, 'import_activity');
    const d = await getIncomeMultiYearDefault(db);
    expect(d.years).toContain(2019);
    expect(d.years).toContain(2026);
  });

  it('leaves a committed future plan out of the historical default', async () => {
    const db = makeTestDb();
    insertEntrySource(db, 2025, 'Income', 100000, 'import_activity');
    insertEntrySource(db, 2027, 'Income', 130000, 'plan_committed');
    const d = await getIncomeMultiYearDefault(db);
    expect(d.years).toEqual([2025]);
    expect(d.years).not.toContain(2027);
  });

  it('keeps a year whose only rows are a hand-typed actual correction', async () => {
    // manual_actual_override is a correction to a real actual, not a forecast.
    const db = makeTestDb();
    insertEntrySource(db, 2023, 'Income', 100000, 'manual_actual_override');
    const d = await getIncomeMultiYearDefault(db);
    expect(d.years).toEqual([2023]);
  });

  it('falls back to the rolling window when nothing has been imported', async () => {
    const cur = new Date().getFullYear();
    const d = await getIncomeMultiYearDefault(makeTestDb());
    expect(d.years).toEqual([cur - 4, cur - 3, cur - 2, cur - 1, cur]);
  });

  it('still honors an explicit range, committed plan years included', async () => {
    const db = makeTestDb();
    insertEntrySource(db, 2026, 'Income', 100000, 'import_activity');
    insertEntrySource(db, 2027, 'Income', 130000, 'plan_committed');
    const url = new URL('https://x/admin/api/finance/church/multi-year?years=2026,2027');
    const res = await handleFinanceApi({}, {}, url, 'GET', 'finance/church/multi-year', db, true, true);
    const d = await res.json();
    expect(d.years).toEqual([2026, 2027]);
  });
});

// ── Assets split into their balance-sheet groups ───────────────────────────────────────────
// Total assets alone hides what is moving: this church's fixed assets are the building at book
// value, unchanged since 2021, so an eight-year 31% drawdown of CURRENT assets averages away
// against a frozen $500,315. The whole point of the split is that the three segments must always
// add back to the Assets total, which is why "other" is derived by subtraction rather than
// matched by a third pattern.
function assetRow(path, cents, opts) {
  return Object.assign({ classification: 'Assets', category_path: path, own_balance_cents: cents }, opts || {});
}

describe('assetGroupOf', () => {
  it('reads the group heading directly under Assets, not the account name', () => {
    expect(assetGroupOf('Assets:Current Assets:Accounts Receivable:11001 Accounts Receivable')).toBe('current');
    expect(assetGroupOf('Assets:Fixed Assets:15000 Building')).toBe('fixed');
    expect(assetGroupOf('Assets:Other Assets:19000 Employee Retention Credit')).toBe('other');
  });

  it('a bank account nested under Current Assets is current, even though its own name says nothing about it', () => {
    // The account this church's operating-cash figure comes from. Matching on account name would
    // put it nowhere.
    expect(assetGroupOf('Assets:Current Assets:Bank Accounts:11027 Lindell Checking xx9105')).toBe('current');
  });

  it('anything unrecognized falls to other rather than being dropped', () => {
    expect(assetGroupOf('Assets')).toBe('other');
    expect(assetGroupOf('Assets:Something A Future Export Invents')).toBe('other');
    expect(assetGroupOf('')).toBe('other');
    expect(assetGroupOf(null)).toBe('other');
  });
});

describe('computeBalanceSummary — asset groups', () => {
  it('splits current and fixed and still reconciles to the Assets total', () => {
    const s = computeBalanceSummary([
      assetRow('Assets:Current Assets:11027 Checking', 646204),
      assetRow('Assets:Fixed Assets:15000 Building', 500315),
      { classification: 'Liabilities', category_path: 'Liabilities:20000 AP', own_balance_cents: 146519 },
      { classification: 'Equity', category_path: 'Equity:32000 Net Assets', own_balance_cents: 1000000 },
    ]);
    expect(s.assetsCents).toBe(1146519);
    expect(s.currentAssetsCents).toBe(646204);
    expect(s.fixedAssetsCents).toBe(500315);
    expect(s.otherAssetsCents).toBe(0);
    expect(s.currentAssetsCents + s.fixedAssetsCents + s.otherAssetsCents).toBe(s.assetsCents);
    expect(s.balancedCents).toBe(0);
  });

  it('a third group nobody anticipated still lands in the total, via other', () => {
    // This church really does have one (Assets:Other Assets — an Employee Retention Credit,
    // 2020-2022). Deriving "other" by subtraction is what guarantees a stacked bar can never come
    // up short of the total printed beside it, whatever a future export decides to call a group.
    const s = computeBalanceSummary([
      assetRow('Assets:Current Assets:11027 Checking', 100),
      assetRow('Assets:Fixed Assets:15000 Building', 200),
      assetRow('Assets:Deferred Outflows Of Resources:19500 Something New', 55),
    ]);
    expect(s.assetsCents).toBe(355);
    expect(s.otherAssetsCents).toBe(55);
    expect(s.currentAssetsCents + s.fixedAssetsCents + s.otherAssetsCents).toBe(s.assetsCents);
  });

  it('counts every Assets row, parents included, exactly as the Assets total does', () => {
    // FIN6's invariant: a stored row holds its OWN, non-cumulative amount, never a "Total for X"
    // subtotal. So a parent that carries money is summed alongside its children on both sides of
    // the split — skipping parents here would silently break the reconciliation above.
    const s = computeBalanceSummary([
      assetRow('Assets:Current Assets:Bank Accounts:11027 Lindell Checking', 500, { has_children: 1 }),
      assetRow('Assets:Current Assets:Bank Accounts:11027 Lindell Checking:11030 Cash on hand', 300),
    ]);
    expect(s.assetsCents).toBe(800);
    expect(s.currentAssetsCents).toBe(800);
  });

  it('a liability or equity row never leaks into an asset group', () => {
    const s = computeBalanceSummary([
      { classification: 'Liabilities', category_path: 'Liabilities:Current Liabilities:20000 AP', own_balance_cents: 700 },
      { classification: 'Equity', category_path: 'Equity:Fixed Something:32000', own_balance_cents: 900 },
    ]);
    expect(s.currentAssetsCents).toBe(0);
    expect(s.fixedAssetsCents).toBe(0);
    expect(s.otherAssetsCents).toBe(0);
  });
});
