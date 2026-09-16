import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildFinanceChurchReportTrendV1 } from '../src/api-contracts.js';
import { validateFinanceChurchReportTrendV1 } from '../apps/finance/finance-church-report-trend-consumer.js';

// finance_church_entries is not part of migrations/0001_baseline.sql -- same EXTRA_SCHEMA as the
// single-year producer test (test/finance-church-report-producer.test.js), column-for-column
// identical to src/db.js's real CREATE TABLE.
const EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS finance_church_entries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  fiscal_year       INTEGER NOT NULL,
  period_month      INTEGER NOT NULL DEFAULT 0,
  classification    TEXT    NOT NULL,
  category_path     TEXT    NOT NULL,
  account_name      TEXT    NOT NULL,
  depth             INTEGER NOT NULL DEFAULT 0,
  has_children      INTEGER NOT NULL DEFAULT 0,
  own_actual_cents  INTEGER NOT NULL DEFAULT 0,
  own_budget_cents  INTEGER,
  account_qbo_id    TEXT    NOT NULL DEFAULT '',
  source            TEXT    NOT NULL DEFAULT 'qbo_sync',
  notes             TEXT    NOT NULL DEFAULT '',
  synced_at         TEXT    NOT NULL DEFAULT '',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(fiscal_year, period_month, category_path, source)
);
`;

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_baseline.sql', import.meta.url), 'utf8'));
  sqlite.exec(EXTRA_SCHEMA);
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
        async run(...args) { sqlite.prepare(sql).run(...args); },
        async first(...args) { return sqlite.prepare(sql).get(...args); },
        async all(...args) { return { results: sqlite.prepare(sql).all(...args) }; },
      };
    },
    _raw: sqlite,
  };
}

function insertEntry(db, {
  fiscalYear, periodMonth = 0, classification, categoryPath, accountName,
  depth = 0, hasChildren = 0, actualCents = 0, budgetCents = null, source = 'import', syncedAt = '',
}) {
  db._raw.prepare(
    `INSERT INTO finance_church_entries
       (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source, synced_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(fiscalYear, periodMonth, classification, categoryPath, accountName, depth, hasChildren ? 1 : 0, actualCents, budgetCents, source, syncedAt);
}

describe('buildFinanceChurchReportTrendV1', () => {
  it('returns a valid, empty-years contract when nothing has been synced or imported yet', async () => {
    const db = makeTestDb();
    const result = await buildFinanceChurchReportTrendV1(db, { now: new Date('2026-09-15T12:00:00Z') });
    const validation = validateFinanceChurchReportTrendV1(result);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(result.contract).toBe('connect.finance-church-report-trend.v1');
    expect(result.years).toEqual([]);
    expect(result.reconciliation).toEqual({ yearCount: 0, totalsMatch: true });
  });

  it('rolls up a single fiscal year with only one source on file (the real 2019-2025 shape)', async () => {
    const db = makeTestDb();
    insertEntry(db, { fiscalYear: 2025, classification: 'Income', categoryPath: 'Income:A', accountName: 'A', actualCents: 500000, budgetCents: 480000, source: 'import_activity' });
    insertEntry(db, { fiscalYear: 2025, classification: 'Expenses', categoryPath: 'Expenses:B', accountName: 'B', actualCents: 300000, budgetCents: null, source: 'import_activity' });

    const result = await buildFinanceChurchReportTrendV1(db, { now: new Date('2026-09-15T12:00:00Z') });
    expect(validateFinanceChurchReportTrendV1(result).ok).toBe(true);
    expect(result.years).toEqual([{
      fiscalYear: 2025, incomeActualCents: 500000, expenseActualCents: 300000,
      otherIncomeActualCents: 0, otherExpenseActualCents: 0, costOfGoodsSoldActualCents: 0,
      netIncomeActualCents: 200000, accountCount: 2,
    }]);
  });

  it('picks one source WHOLESALE per fiscal year (CHURCH_SOURCE_PRIORITY), independently for every year -- not each account\'s own latest row', async () => {
    // Reproduces the real production shape found 2026-09-15: FY2026 has both 'import' (wins,
    // higher priority) and 'import_activity' (loses) on file, and 'import_activity' covers an
    // account 'import' does not -- that account must not leak into the resolved year.
    const db = makeTestDb();
    insertEntry(db, { fiscalYear: 2026, classification: 'Income', categoryPath: 'Income:A', accountName: 'A', actualCents: 700000, budgetCents: 650000, source: 'import' });
    insertEntry(db, { fiscalYear: 2026, classification: 'Income', categoryPath: 'Income:A', accountName: 'A', actualCents: 999999999, budgetCents: 999999999, source: 'import_activity' });
    insertEntry(db, { fiscalYear: 2026, classification: 'Expenses', categoryPath: 'Expenses:OnlyInActivity', accountName: 'Only In Activity', actualCents: 555555, budgetCents: 555555, source: 'import_activity' });
    // A separate, independently-resolved year with a different winning source entirely.
    insertEntry(db, { fiscalYear: 2025, classification: 'Income', categoryPath: 'Income:A', accountName: 'A', actualCents: 600000, budgetCents: null, source: 'import_activity' });

    const result = await buildFinanceChurchReportTrendV1(db, { now: new Date('2026-09-15T12:00:00Z') });
    expect(result.years).toHaveLength(2);
    const y2026 = result.years.find((y) => y.fiscalYear === 2026);
    expect(y2026).toMatchObject({ incomeActualCents: 700000, expenseActualCents: 0, accountCount: 1 });
    const y2025 = result.years.find((y) => y.fiscalYear === 2025);
    expect(y2025).toMatchObject({ incomeActualCents: 600000, accountCount: 1 });
  });

  it('applies a manual_actual_override per-category on top of the winning source without adding a phantom account', async () => {
    const db = makeTestDb();
    insertEntry(db, { fiscalYear: 2026, classification: 'Expenses', categoryPath: 'Expenses:Fees', accountName: 'Fees', actualCents: 4200, budgetCents: 5000, source: 'import' });
    insertEntry(db, { fiscalYear: 2026, classification: 'Expenses', categoryPath: 'Expenses:Fees', accountName: 'Fees', actualCents: 4500, budgetCents: null, source: 'manual_actual_override' });

    const result = await buildFinanceChurchReportTrendV1(db, { now: new Date('2026-09-15T12:00:00Z') });
    expect(result.years).toEqual([{
      fiscalYear: 2026, incomeActualCents: 0, expenseActualCents: 4500,
      otherIncomeActualCents: 0, otherExpenseActualCents: 0, costOfGoodsSoldActualCents: 0,
      netIncomeActualCents: -4500, accountCount: 1,
    }]);
  });

  it('folds Cost of Goods Sold and Other Income/Expenses into netIncomeActualCents without blending them into incomeActualCents/expenseActualCents -- the real production shape where a naive income-minus-expense trend would disagree with the true bottom line', async () => {
    // Reproduces the real 2026-09-15 finding: FY2019, FY2021, and FY2024 each carry nonzero Other
    // Income/Expenses that a naive incomeActualCents-minus-expenseActualCents figure would miss.
    const db = makeTestDb();
    insertEntry(db, { fiscalYear: 2019, classification: 'Income', categoryPath: 'Income:A', accountName: 'A', actualCents: 100000, budgetCents: 100000, source: 'import_activity' });
    insertEntry(db, { fiscalYear: 2019, classification: 'Cost of Goods Sold', categoryPath: 'Cost of Goods Sold:B', accountName: 'B', actualCents: 10000, budgetCents: 10000, source: 'import_activity' });
    insertEntry(db, { fiscalYear: 2019, classification: 'Expenses', categoryPath: 'Expenses:C', accountName: 'C', actualCents: 40000, budgetCents: 40000, source: 'import_activity' });
    insertEntry(db, { fiscalYear: 2019, classification: 'Other Income', categoryPath: 'Other Income:D', accountName: 'D', actualCents: 500000, budgetCents: null, source: 'import_activity' });
    insertEntry(db, { fiscalYear: 2019, classification: 'Other Expenses', categoryPath: 'Other Expenses:E', accountName: 'E', actualCents: 2000, budgetCents: null, source: 'import_activity' });

    const result = await buildFinanceChurchReportTrendV1(db, { now: new Date('2026-09-15T12:00:00Z') });
    const y2019 = result.years.find((y) => y.fiscalYear === 2019);
    // Headline actuals stay Income/Expenses-only, matching the single-year contract's own
    // incomeActualCents/expenseActualCents convention.
    expect(y2019.incomeActualCents).toBe(100000);
    expect(y2019.expenseActualCents).toBe(40000);
    // Net folds in COGS + Other Income/Expenses: (100000-10000) - 40000 + (500000-2000) = 548000
    // -- a naive incomeActualCents - expenseActualCents (60000) would be wrong by nearly 5x here.
    expect(y2019.netIncomeActualCents).toBe(548000);
    expect(y2019.netIncomeActualCents).not.toBe(y2019.incomeActualCents - y2019.expenseActualCents);
    expect(validateFinanceChurchReportTrendV1(result).ok).toBe(true);
  });

  it('excludes monthly-granularity rows (period_month != 0) -- this contract is annual-only, same as the single-year contract', async () => {
    const db = makeTestDb();
    insertEntry(db, { fiscalYear: 2026, periodMonth: 0, classification: 'Income', categoryPath: 'Income:A', accountName: 'A', actualCents: 500000, budgetCents: 500000, source: 'import' });
    insertEntry(db, { fiscalYear: 2026, periodMonth: 3, classification: 'Income', categoryPath: 'Income:A', accountName: 'A', actualCents: 999999999, budgetCents: null, source: 'monthly_import' });
    const result = await buildFinanceChurchReportTrendV1(db, { now: new Date('2026-09-15T12:00:00Z') });
    expect(result.years).toHaveLength(1);
    expect(result.years[0].incomeActualCents).toBe(500000);
  });

  it('returns every fiscal year on file in ascending order', async () => {
    const db = makeTestDb();
    insertEntry(db, { fiscalYear: 2022, classification: 'Income', categoryPath: 'Income:A', accountName: 'A', actualCents: 1, source: 'import_activity' });
    insertEntry(db, { fiscalYear: 2019, classification: 'Income', categoryPath: 'Income:A', accountName: 'A', actualCents: 2, source: 'import_activity' });
    insertEntry(db, { fiscalYear: 2026, classification: 'Income', categoryPath: 'Income:A', accountName: 'A', actualCents: 3, source: 'import' });
    insertEntry(db, { fiscalYear: 2020, classification: 'Income', categoryPath: 'Income:A', accountName: 'A', actualCents: 4, source: 'import_activity' });
    const result = await buildFinanceChurchReportTrendV1(db, { now: new Date('2026-09-15T12:00:00Z') });
    expect(result.years.map((y) => y.fiscalYear)).toEqual([2019, 2020, 2022, 2026]);
    expect(result.reconciliation).toEqual({ yearCount: 4, totalsMatch: true });
    expect(validateFinanceChurchReportTrendV1(result).ok).toBe(true);
  });
});
