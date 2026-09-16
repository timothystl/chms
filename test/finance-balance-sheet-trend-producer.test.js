import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildFinanceBalanceSheetTrendV1 } from '../src/api-contracts.js';
import { validateFinanceBalanceSheetTrendV1 } from '../apps/finance/finance-balance-sheet-trend-consumer.js';

// finance_church_balances is not part of migrations/0001_baseline.sql -- same reason the
// single-year producer test adds it as EXTRA_SCHEMA. Column-for-column identical to
// migrations/0019_finance_church_balances.sql's real CREATE TABLE.
const EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS finance_church_balances (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  fiscal_year       INTEGER NOT NULL,
  as_of_date        TEXT    NOT NULL DEFAULT '',
  classification    TEXT    NOT NULL,
  category_path     TEXT    NOT NULL,
  account_name      TEXT    NOT NULL,
  depth             INTEGER NOT NULL DEFAULT 0,
  has_children      INTEGER NOT NULL DEFAULT 0,
  own_balance_cents INTEGER NOT NULL DEFAULT 0,
  source            TEXT    NOT NULL DEFAULT 'import',
  synced_at         TEXT    NOT NULL DEFAULT '',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(fiscal_year, category_path, source)
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

function insertBalance(db, {
  fiscalYear, asOfDate = '2026-12-31', classification, categoryPath, accountName,
  depth = 0, hasChildren = 0, ownBalanceCents = 0, source = 'import',
}) {
  db._raw.prepare(
    `INSERT INTO finance_church_balances
       (fiscal_year, as_of_date, classification, category_path, account_name, depth, has_children, own_balance_cents, source)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(fiscalYear, asOfDate, classification, categoryPath, accountName, depth, hasChildren ? 1 : 0, ownBalanceCents, source);
}

describe('buildFinanceBalanceSheetTrendV1', () => {
  it('returns a valid, empty-years contract when nothing has been imported at all', async () => {
    const db = makeTestDb();
    const result = await buildFinanceBalanceSheetTrendV1(db, { now: new Date('2026-09-16T12:00:00Z') });
    const validation = validateFinanceBalanceSheetTrendV1(result);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(result.contract).toBe('connect.finance-balance-sheet-trend.v1');
    expect(result.years).toEqual([]);
    expect(result.reconciliation).toEqual({ yearCount: 0, totalsMatch: true });
  });

  it('takes no fiscal_year parameter -- returns every distinct fiscal year on file, ascending', async () => {
    const db = makeTestDb();
    insertBalance(db, { fiscalYear: 2026, asOfDate: '2026-12-31', classification: 'Assets', categoryPath: 'Assets:11000 Cash', accountName: '11000 Cash', ownBalanceCents: 30000000 });
    insertBalance(db, { fiscalYear: 2026, asOfDate: '2026-12-31', classification: 'Liabilities', categoryPath: 'Liabilities:20000 Accounts Payable', accountName: '20000 Accounts Payable', ownBalanceCents: 10000000 });
    insertBalance(db, { fiscalYear: 2026, asOfDate: '2026-12-31', classification: 'Equity', categoryPath: 'Equity:31000 Unrestricted Net Assets', accountName: '31000 Unrestricted Net Assets', ownBalanceCents: 20000000 });
    insertBalance(db, { fiscalYear: 2025, asOfDate: 'FY2025', classification: 'Assets', categoryPath: 'Assets:11000 Cash', accountName: '11000 Cash', ownBalanceCents: 27000000 });
    insertBalance(db, { fiscalYear: 2025, asOfDate: 'FY2025', classification: 'Liabilities', categoryPath: 'Liabilities:20000 Accounts Payable', accountName: '20000 Accounts Payable', ownBalanceCents: 11000000 });
    insertBalance(db, { fiscalYear: 2025, asOfDate: 'FY2025', classification: 'Equity', categoryPath: 'Equity:31000 Unrestricted Net Assets', accountName: '31000 Unrestricted Net Assets', ownBalanceCents: 16000000 });

    const result = await buildFinanceBalanceSheetTrendV1(db, { now: new Date('2026-09-16T12:00:00Z') });
    expect(validateFinanceBalanceSheetTrendV1(result).ok).toBe(true);
    expect(result.years.map((y) => y.fiscalYear)).toEqual([2025, 2026]); // ascending, not insertion order
    expect(result.years[0]).toMatchObject({ fiscalYear: 2025, asOfDate: 'FY2025', assetsCents: 27000000, liabilitiesCents: 11000000, equityCents: 16000000, netAssetsCents: 16000000, balancedCents: 0 });
    expect(result.years[1]).toMatchObject({ fiscalYear: 2026, asOfDate: '2026-12-31', assetsCents: 30000000, liabilitiesCents: 10000000, equityCents: 20000000, netAssetsCents: 20000000, balancedCents: 0 });
    expect(result.reconciliation).toEqual({ yearCount: 2, totalsMatch: true });
  });

  it('reclassifies the "25000 Funds" branch into Equity per year, matching the single-year contract\'s own applyDesignatedFundsAsEquity order', async () => {
    const db = makeTestDb();
    insertBalance(db, { fiscalYear: 2026, classification: 'Assets', categoryPath: 'Assets:11000 Cash', accountName: '11000 Cash', ownBalanceCents: 100000 });
    insertBalance(db, { fiscalYear: 2026, classification: 'Liabilities', categoryPath: 'Liabilities:25000 Funds', accountName: '25000 Funds', hasChildren: 1, ownBalanceCents: 0 });
    insertBalance(db, { fiscalYear: 2026, classification: 'Liabilities', categoryPath: 'Liabilities:25000 Funds:25004 Building Fund', accountName: '25004 Building Fund', ownBalanceCents: 68500 });
    insertBalance(db, { fiscalYear: 2026, classification: 'Equity', categoryPath: 'Equity:31000 Unrestricted Net Assets', accountName: '31000 Unrestricted Net Assets', ownBalanceCents: 31500 });

    const result = await buildFinanceBalanceSheetTrendV1(db, { now: new Date('2026-09-16T12:00:00Z') });
    expect(validateFinanceBalanceSheetTrendV1(result).ok).toBe(true);
    expect(result.years).toHaveLength(1);
    // Liabilities no longer includes the Funds branch; equity now includes it -- same
    // reclassification buildFinanceBalanceSheetV1 applies for a single year.
    expect(result.years[0].liabilitiesCents).toBe(0);
    expect(result.years[0].equityCents).toBe(31500 + 68500);
    expect(result.years[0].netAssetsCents).toBe(31500 + 68500);
  });

  it('sums a has_children group row\'s own balance flatly alongside its children, per year', async () => {
    const db = makeTestDb();
    insertBalance(db, { fiscalYear: 2026, classification: 'Assets', categoryPath: 'Assets:Bank Accounts:11027 Lindell Checking', accountName: '11027 Lindell Checking', depth: 3, hasChildren: 1, ownBalanceCents: 500000 });
    insertBalance(db, { fiscalYear: 2026, classification: 'Assets', categoryPath: 'Assets:Bank Accounts:11027 Lindell Checking:11030 Cash on hand', accountName: '11030 Cash on hand', depth: 4, hasChildren: 0, ownBalanceCents: 2500 });

    const result = await buildFinanceBalanceSheetTrendV1(db, { now: new Date('2026-09-16T12:00:00Z') });
    expect(validateFinanceBalanceSheetTrendV1(result).ok).toBe(true);
    expect(result.years[0].assetsCents).toBe(502500);
  });

  it('reports an unbalanced year honestly via balancedCents and reconciliation.totalsMatch', async () => {
    const db = makeTestDb();
    insertBalance(db, { fiscalYear: 2026, classification: 'Assets', categoryPath: 'Assets:11000 Cash', accountName: '11000 Cash', ownBalanceCents: 100000 });
    // No offsetting Liabilities/Equity rows -- deliberately unbalanced.
    const result = await buildFinanceBalanceSheetTrendV1(db, { now: new Date('2026-09-16T12:00:00Z') });
    expect(validateFinanceBalanceSheetTrendV1(result).ok).toBe(true);
    expect(result.years[0].balancedCents).toBe(100000);
    expect(result.reconciliation.totalsMatch).toBe(false);
  });
});
