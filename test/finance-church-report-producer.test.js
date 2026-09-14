import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildFinanceChurchReportV1 } from '../src/api-contracts.js';
import { validateFinanceChurchReportV1 } from '../apps/finance/finance-church-report-consumer.js';

// finance_church_entries is not part of migrations/0001_baseline.sql -- same reason Chart of
// Accounts' producer test adds it as EXTRA_SCHEMA. Column-for-column identical to src/db.js's real
// CREATE TABLE.
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

describe('buildFinanceChurchReportV1', () => {
  it('returns a valid, empty-accounts contract for a fiscal year with nothing synced or imported yet', async () => {
    const db = makeTestDb();
    const result = await buildFinanceChurchReportV1(db, { fiscalYear: 2030, now: new Date('2026-09-14T12:00:00Z') });
    const validation = validateFinanceChurchReportV1(result);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(result.fiscalYear).toBe(2030);
    expect(result.accounts).toEqual([]);
    expect(result.totals).toEqual({
      incomeActualCents: 0, incomeBudgetCents: 0, expenseActualCents: 0, expenseBudgetCents: 0,
      netIncomeActualCents: 0, netIncomeBudgetCents: 0, hasBudgetData: false,
    });
    expect(result.reconciliation).toEqual({
      accountCount: 0, incomeCount: 0, expenseCount: 0, otherIncomeCount: 0, otherExpenseCount: 0,
      costOfGoodsSoldCount: 0, accountsWithBudgetCount: 0, totalsMatch: true,
    });
  });

  it('reflects real accounts with a nullable budget -- the actual shape of production data (checked 2026-09-14)', async () => {
    const db = makeTestDb();
    insertEntry(db, { fiscalYear: 2026, classification: 'Income', categoryPath: 'Income:40000 Contributions', accountName: '40000 Contributions', actualCents: 1300000, budgetCents: 1250000, source: 'import' });
    // A real, common case: an account with an actual and NO budget on file at all.
    insertEntry(db, { fiscalYear: 2026, classification: 'Expenses', categoryPath: 'Expenses:51006 Bank Fees', accountName: '51006 Bank Fees', actualCents: 4200, budgetCents: null, source: 'import' });
    insertEntry(db, { fiscalYear: 2026, classification: 'Expenses', categoryPath: 'Expenses:50110 Christmas Market', accountName: '50110 Christmas Market', actualCents: 90000, budgetCents: 85000, source: 'import' });

    const result = await buildFinanceChurchReportV1(db, { fiscalYear: 2026, now: new Date('2026-09-14T12:00:00Z') });
    const validation = validateFinanceChurchReportV1(result);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);

    expect(result.contract).toBe('connect.finance-church-report.v1');
    expect(result.dataClassification).toBe('aggregate');
    expect(result.accounts).toHaveLength(3);
    const fees = result.accounts.find((a) => a.categoryPath === 'Expenses:51006 Bank Fees');
    expect(fees).toMatchObject({ classification: 'Expenses', accountName: '51006 Bank Fees', actualCents: 4200, budgetCents: null, source: 'import' });

    expect(result.totals).toEqual({
      incomeActualCents: 1300000, incomeBudgetCents: 1250000,
      expenseActualCents: 94200, expenseBudgetCents: 85000, // only the fee's null is excluded, not treated as zero
      netIncomeActualCents: 1300000 - 94200, netIncomeBudgetCents: 1250000 - 85000,
      hasBudgetData: true,
    });
    expect(result.reconciliation).toEqual({
      accountCount: 3, incomeCount: 1, expenseCount: 2, otherIncomeCount: 0, otherExpenseCount: 0,
      costOfGoodsSoldCount: 0, accountsWithBudgetCount: 2, totalsMatch: true,
    });
  });

  it('picks one source WHOLESALE per fiscal year (CHURCH_SOURCE_PRIORITY), not each account\'s own latest row -- unlike Chart of Accounts', async () => {
    // Reproduces the real production shape found 2026-09-14: FY2026 has both 'import' (wins,
    // higher priority) and 'import_activity' (loses) on file, and 'import_activity' covers an
    // account 'import' does not.
    const db = makeTestDb();
    insertEntry(db, { fiscalYear: 2026, classification: 'Income', categoryPath: 'Income:40000 Contributions', accountName: '40000 Contributions', actualCents: 1300000, budgetCents: 1250000, source: 'import' });
    insertEntry(db, { fiscalYear: 2026, classification: 'Income', categoryPath: 'Income:40000 Contributions', accountName: '40000 Contributions', actualCents: 999999999, budgetCents: 999999999, source: 'import_activity' });
    insertEntry(db, { fiscalYear: 2026, classification: 'Expenses', categoryPath: 'Expenses:99999 Only In Activity', accountName: '99999 Only In Activity', actualCents: 555555, budgetCents: 555555, source: 'import_activity' });

    const result = await buildFinanceChurchReportV1(db, { fiscalYear: 2026, now: new Date('2026-09-14T12:00:00Z') });
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]).toMatchObject({ actualCents: 1300000, source: 'import' });
    expect(result.totals.incomeActualCents).toBe(1300000);
  });

  it('applies a manual_actual_override per-category on top of the winning source without dropping the rest of that source\'s rows', async () => {
    const db = makeTestDb();
    insertEntry(db, { fiscalYear: 2026, classification: 'Income', categoryPath: 'Income:40000 Contributions', accountName: '40000 Contributions', actualCents: 1300000, budgetCents: 1250000, source: 'import' });
    insertEntry(db, { fiscalYear: 2026, classification: 'Expenses', categoryPath: 'Expenses:51006 Bank Fees', accountName: '51006 Bank Fees', actualCents: 4200, budgetCents: 5000, source: 'import' });
    insertEntry(db, { fiscalYear: 2026, classification: 'Expenses', categoryPath: 'Expenses:51006 Bank Fees', accountName: '51006 Bank Fees', actualCents: 4500, budgetCents: null, source: 'manual_actual_override' });

    const result = await buildFinanceChurchReportV1(db, { fiscalYear: 2026, now: new Date('2026-09-14T12:00:00Z') });
    expect(result.accounts).toHaveLength(2);
    const fees = result.accounts.find((a) => a.categoryPath === 'Expenses:51006 Bank Fees');
    // Corrected actual, source relabeled, but budgetCents kept from the winning source's own row.
    expect(fees).toMatchObject({ actualCents: 4500, budgetCents: 5000, source: 'manual_actual_override' });
  });

  it('handles Other Income / Other Expenses / Cost of Goods Sold correctly in the bottom line without blending them into the headline Income/Expense totals', async () => {
    const db = makeTestDb();
    insertEntry(db, { fiscalYear: 2026, classification: 'Income', categoryPath: 'Income:A', accountName: 'A', actualCents: 100000, budgetCents: 100000, source: 'import' });
    insertEntry(db, { fiscalYear: 2026, classification: 'Cost of Goods Sold', categoryPath: 'Cost of Goods Sold:B', accountName: 'B', actualCents: 10000, budgetCents: 10000, source: 'import' });
    insertEntry(db, { fiscalYear: 2026, classification: 'Expenses', categoryPath: 'Expenses:C', accountName: 'C', actualCents: 40000, budgetCents: 40000, source: 'import' });
    insertEntry(db, { fiscalYear: 2026, classification: 'Other Income', categoryPath: 'Other Income:D', accountName: 'D', actualCents: 5000, budgetCents: null, source: 'import' });
    insertEntry(db, { fiscalYear: 2026, classification: 'Other Expenses', categoryPath: 'Other Expenses:E', accountName: 'E', actualCents: 2000, budgetCents: null, source: 'import' });

    const result = await buildFinanceChurchReportV1(db, { fiscalYear: 2026, now: new Date('2026-09-14T12:00:00Z') });
    // Headline totals stay Income/Expenses-only, matching production's own KPI cards.
    expect(result.totals.incomeActualCents).toBe(100000);
    expect(result.totals.expenseActualCents).toBe(40000);
    // Net income folds in COGS + Other Income/Expenses: (100000-10000) - 40000 + (5000-2000) = 53000
    expect(result.totals.netIncomeActualCents).toBe(53000);
    expect(result.reconciliation).toMatchObject({ otherIncomeCount: 1, otherExpenseCount: 1, costOfGoodsSoldCount: 1 });
    expect(validateFinanceChurchReportV1(result).ok).toBe(true);
  });

  it('does not leak a different fiscal year into this year\'s accounts or totals', async () => {
    const db = makeTestDb();
    insertEntry(db, { fiscalYear: 2026, classification: 'Income', categoryPath: 'Income:A', accountName: 'A', actualCents: 500000, budgetCents: 500000, source: 'import' });
    insertEntry(db, { fiscalYear: 2025, classification: 'Income', categoryPath: 'Income:A', accountName: 'A', actualCents: 999999999, budgetCents: 999999999, source: 'import' });
    const result = await buildFinanceChurchReportV1(db, { fiscalYear: 2026, now: new Date('2026-09-14T12:00:00Z') });
    expect(result.accounts).toHaveLength(1);
    expect(result.totals.incomeActualCents).toBe(500000);
  });

  it('excludes monthly-granularity rows (period_month != 0) -- this contract is the annual report only', async () => {
    const db = makeTestDb();
    insertEntry(db, { fiscalYear: 2026, periodMonth: 0, classification: 'Income', categoryPath: 'Income:A', accountName: 'A', actualCents: 500000, budgetCents: 500000, source: 'import' });
    insertEntry(db, { fiscalYear: 2026, periodMonth: 3, classification: 'Income', categoryPath: 'Income:A', accountName: 'A', actualCents: 999999999, budgetCents: null, source: 'monthly_import' });
    const result = await buildFinanceChurchReportV1(db, { fiscalYear: 2026, now: new Date('2026-09-14T12:00:00Z') });
    expect(result.accounts).toHaveLength(1);
    expect(result.totals.incomeActualCents).toBe(500000);
  });
});
