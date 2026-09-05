import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { computeBalanceVsPnlReconciliation, computeBalanceSummary, computeYearCashSummary, handleFinanceApi } from '../src/api-finance.js';

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
