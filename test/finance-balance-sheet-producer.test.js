import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildFinanceBalanceSheetV1 } from '../src/api-contracts.js';
import { validateFinanceBalanceSheetV1 } from '../contracts/validators/finance-balance-sheet-consumer.js';

// finance_church_balances is not part of migrations/0001_baseline.sql -- same reason Church
// Report's producer test adds finance_church_entries as EXTRA_SCHEMA. Column-for-column identical
// to migrations/0019_finance_church_balances.sql's real CREATE TABLE.
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

describe('buildFinanceBalanceSheetV1', () => {
  it('returns a valid, empty-accounts contract for a fiscal year with nothing imported yet', async () => {
    const db = makeTestDb();
    const result = await buildFinanceBalanceSheetV1(db, { fiscalYear: 2030, now: new Date('2026-09-14T12:00:00Z') });
    const validation = validateFinanceBalanceSheetV1(result);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(result.fiscalYear).toBe(2030);
    expect(result.asOfDate).toBe('');
    expect(result.accounts).toEqual([]);
    expect(result.totals).toEqual({
      assetsCents: 0, liabilitiesCents: 0, equityCents: 0, currentAssetsCents: 0,
      fixedAssetsCents: 0, otherAssetsCents: 0, liabilitiesPlusEquityCents: 0, balancedCents: 0,
    });
    expect(result.equityReclass).toEqual({
      donorRestrictedCents: 0, unrestrictedCents: 0, totalEquityCents: 0,
      breakdown: {
        perpetual: { label: 'Perpetual endowments', cents: 0 },
        purpose_time: { label: 'Purpose/time restricted', cents: 0 },
        designated: { label: 'Designated ministry/purpose funds', cents: 0 },
      },
      unclassified: [],
    });
    expect(result.reconciliation).toEqual({
      accountCount: 0, assetsCount: 0, liabilitiesCount: 0, equityCount: 0, unclassifiedEquityCount: 0, totalsMatch: true,
    });
  });

  it('reflects a simple balanced real-shaped year (checked 2026-09-14: single source, never-null balances)', async () => {
    const db = makeTestDb();
    insertBalance(db, { fiscalYear: 2026, classification: 'Assets', categoryPath: 'Assets:11000 Cash', accountName: '11000 Cash', ownBalanceCents: 30000000 });
    insertBalance(db, { fiscalYear: 2026, classification: 'Liabilities', categoryPath: 'Liabilities:20000 Accounts Payable', accountName: '20000 Accounts Payable', ownBalanceCents: 10000000 });
    insertBalance(db, { fiscalYear: 2026, classification: 'Equity', categoryPath: 'Equity:31000 Unrestricted Net Assets', accountName: '31000 Unrestricted Net Assets', ownBalanceCents: 20000000 });

    const result = await buildFinanceBalanceSheetV1(db, { fiscalYear: 2026, now: new Date('2026-09-14T12:00:00Z') });
    const validation = validateFinanceBalanceSheetV1(result);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);

    expect(result.contract).toBe('connect.finance-balance-sheet.v1');
    expect(result.dataClassification).toBe('aggregate');
    expect(result.asOfDate).toBe('2026-12-31');
    expect(result.accounts).toHaveLength(3);
    expect(result.totals).toMatchObject({
      assetsCents: 30000000, liabilitiesCents: 10000000, equityCents: 20000000,
      liabilitiesPlusEquityCents: 30000000, balancedCents: 0,
    });
    expect(result.reconciliation).toMatchObject({ accountCount: 3, assetsCount: 1, liabilitiesCount: 1, equityCount: 1 });
  });

  it('reclassifies the "25000 Funds" branch into Equity for both accounts and totals, matching production\'s applyDesignatedFundsAsEquity', async () => {
    const db = makeTestDb();
    insertBalance(db, { fiscalYear: 2026, classification: 'Assets', categoryPath: 'Assets:11000 Cash', accountName: '11000 Cash', ownBalanceCents: 100000 });
    insertBalance(db, { fiscalYear: 2026, classification: 'Liabilities', categoryPath: 'Liabilities:25000 Funds', accountName: '25000 Funds', hasChildren: 1, ownBalanceCents: 0 });
    insertBalance(db, { fiscalYear: 2026, classification: 'Liabilities', categoryPath: 'Liabilities:25000 Funds:25004 Building Fund', accountName: '25004 Building Fund', ownBalanceCents: 68500 });
    insertBalance(db, { fiscalYear: 2026, classification: 'Equity', categoryPath: 'Equity:31000 Unrestricted Net Assets', accountName: '31000 Unrestricted Net Assets', ownBalanceCents: 31500 });

    const result = await buildFinanceBalanceSheetV1(db, { fiscalYear: 2026, now: new Date('2026-09-14T12:00:00Z') });
    expect(validateFinanceBalanceSheetV1(result).ok).toBe(true);

    // "25000 Funds" and its child now read classification 'Equity' with a path rooted at 'Equity:'.
    const fundsAccount = result.accounts.find((a) => a.accountName === '25004 Building Fund');
    expect(fundsAccount).toMatchObject({ classification: 'Equity', categoryPath: 'Equity:25000 Funds:25004 Building Fund', ownBalanceCents: 68500 });
    // Liabilities no longer includes the Funds branch at all.
    expect(result.totals.liabilitiesCents).toBe(0);
    // Equity now includes both the real Equity row and the reclassified Funds branch.
    expect(result.totals.equityCents).toBe(31500 + 68500);
    expect(result.reconciliation).toMatchObject({ liabilitiesCount: 0, equityCount: 3 });
  });

  it('computes the Donor-Restricted / Unrestricted breakdown from the reclassified rows, reproducing production\'s ACTUAL route order (not the stated invariant in a comment elsewhere)', async () => {
    // Minimal reproduction of the real 2026 shape (finance-equity-reclass.test.js's own fixture):
    // a perpetual endowment account, a Designated Fund, and plain book equity.
    const db = makeTestDb();
    insertBalance(db, { fiscalYear: 2026, classification: 'Assets', categoryPath: 'Assets:12010 95-8633 Thriv.- Iris Guen.', accountName: '12010 95-8633 Thriv.- Iris Guen.', ownBalanceCents: 100000 });
    insertBalance(db, { fiscalYear: 2026, classification: 'Liabilities', categoryPath: 'Liabilities:25000 Funds:25004 Building Fund', accountName: '25004 Building Fund', ownBalanceCents: 50000 });
    insertBalance(db, { fiscalYear: 2026, classification: 'Equity', categoryPath: 'Equity:31000 Unrestricted Net Assets', accountName: '31000 Unrestricted Net Assets', ownBalanceCents: 200000 });

    const result = await buildFinanceBalanceSheetV1(db, { fiscalYear: 2026, now: new Date('2026-09-14T12:00:00Z') });
    expect(validateFinanceBalanceSheetV1(result).ok).toBe(true);

    // Perpetual bucket picks up the 12010 code regardless of classification (it stays 'Assets').
    expect(result.equityReclass.breakdown.perpetual.cents).toBe(100000);
    expect(result.equityReclass.breakdown.designated.cents).toBe(50000);
    expect(result.equityReclass.donorRestrictedCents).toBe(150000);
    // totalEquityCents is computed from the RECLASSIFIED rows (200000 book equity + 50000 Funds
    // moved into Equity), matching totals.equityCents exactly -- production's real route order.
    expect(result.equityReclass.totalEquityCents).toBe(250000);
    expect(result.totals.equityCents).toBe(250000);
    expect(result.equityReclass.unrestrictedCents).toBe(250000 - 150000);
    expect(result.equityReclass.donorRestrictedCents + result.equityReclass.unrestrictedCents).toBe(result.equityReclass.totalEquityCents);
  });

  it('flags a genuinely unclassified equity-neighborhood account rather than silently including or excluding it', async () => {
    const db = makeTestDb();
    insertBalance(db, { fiscalYear: 2026, classification: 'Equity', categoryPath: 'Equity:34000 Some New Equity Line', accountName: '34000 Some New Equity Line', ownBalanceCents: 1000 });
    const result = await buildFinanceBalanceSheetV1(db, { fiscalYear: 2026, now: new Date('2026-09-14T12:00:00Z') });
    expect(validateFinanceBalanceSheetV1(result).ok).toBe(true);
    expect(result.equityReclass.unclassified).toEqual([
      { accountName: '34000 Some New Equity Line', categoryPath: 'Equity:34000 Some New Equity Line', ownBalanceCents: 1000 },
    ]);
    expect(result.reconciliation.unclassifiedEquityCount).toBe(1);
  });

  it('sums a has_children group row\'s own balance flatly alongside its children -- confirmed 2026-09-14: real production has 8 such rows, contrary to an unverified "always $0" assumption elsewhere in this codebase', async () => {
    const db = makeTestDb();
    // "11027 Lindell Checking" carries its own real balance AND has a real nested child
    // ("11030 Cash on hand") -- exactly the shape a 2026-09-14 production check found.
    insertBalance(db, { fiscalYear: 2026, classification: 'Assets', categoryPath: 'Assets:Bank Accounts:11027 Lindell Checking', accountName: '11027 Lindell Checking', depth: 3, hasChildren: 1, ownBalanceCents: 500000 });
    insertBalance(db, { fiscalYear: 2026, classification: 'Assets', categoryPath: 'Assets:Bank Accounts:11027 Lindell Checking:11030 Cash on hand', accountName: '11030 Cash on hand', depth: 4, hasChildren: 0, ownBalanceCents: 2500 });

    const result = await buildFinanceBalanceSheetV1(db, { fiscalYear: 2026, now: new Date('2026-09-14T12:00:00Z') });
    expect(validateFinanceBalanceSheetV1(result).ok).toBe(true);
    // Both rows' own balances are summed -- production does not exclude has_children rows.
    expect(result.totals.assetsCents).toBe(502500);
    const parent = result.accounts.find((a) => a.accountName === '11027 Lindell Checking');
    expect(parent).toMatchObject({ hasChildren: true, ownBalanceCents: 500000 });
  });

  it('splits currentAssetsCents/fixedAssetsCents/otherAssetsCents by the top-level Assets group name, deriving "other" by subtraction', async () => {
    const db = makeTestDb();
    insertBalance(db, { fiscalYear: 2026, classification: 'Assets', categoryPath: 'Assets:Current Assets:11000 Cash', accountName: '11000 Cash', ownBalanceCents: 500000 });
    insertBalance(db, { fiscalYear: 2026, classification: 'Assets', categoryPath: 'Assets:Fixed Assets:15000 Building', accountName: '15000 Building', ownBalanceCents: 900000 });
    insertBalance(db, { fiscalYear: 2026, classification: 'Assets', categoryPath: 'Assets:Other Assets:12200 Employee Loan', accountName: '12200 Employee Loan', ownBalanceCents: 3000 });

    const result = await buildFinanceBalanceSheetV1(db, { fiscalYear: 2026, now: new Date('2026-09-14T12:00:00Z') });
    expect(validateFinanceBalanceSheetV1(result).ok).toBe(true);
    expect(result.totals).toMatchObject({
      assetsCents: 1403000, currentAssetsCents: 500000, fixedAssetsCents: 900000, otherAssetsCents: 3000,
    });
  });

  it('does not leak a different fiscal year into this year\'s accounts or totals', async () => {
    const db = makeTestDb();
    insertBalance(db, { fiscalYear: 2026, classification: 'Assets', categoryPath: 'Assets:A', accountName: 'A', ownBalanceCents: 500000 });
    insertBalance(db, { fiscalYear: 2025, classification: 'Assets', categoryPath: 'Assets:A', accountName: 'A', ownBalanceCents: 999999999 });
    const result = await buildFinanceBalanceSheetV1(db, { fiscalYear: 2026, now: new Date('2026-09-14T12:00:00Z') });
    expect(result.accounts).toHaveLength(1);
    expect(result.totals.assetsCents).toBe(500000);
  });
});
