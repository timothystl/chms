import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildFinanceChartOfAccountsV1 } from '../src/api-contracts.js';
import { validateFinanceChartOfAccountsV1 } from '../contracts/validators/finance-chart-of-accounts-consumer.js';

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
CREATE TABLE IF NOT EXISTS finance_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  depth = 0, hasChildren = 0, source = 'qbo_sync', syncedAt = '', actualCents = 0, budgetCents = null,
}) {
  db._raw.prepare(
    `INSERT INTO finance_church_entries
       (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, source, synced_at, own_actual_cents, own_budget_cents)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(fiscalYear, periodMonth, classification, categoryPath, accountName, depth, hasChildren, source, syncedAt, actualCents, budgetCents);
}

function setSetting(db, key, value) {
  db._raw.prepare(`INSERT INTO finance_settings (key, value) VALUES (?, ?)`).run(key, JSON.stringify(value));
}

const NOW = new Date('2026-06-15T12:00:00Z');

describe('buildFinanceChartOfAccountsV1', () => {
  it('returns an empty, valid contract when nothing has ever imported', async () => {
    const db = makeTestDb();
    const result = await buildFinanceChartOfAccountsV1(db, { fiscalYear: 2026, now: NOW });
    const validation = validateFinanceChartOfAccountsV1(result);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(result.fiscalYear).toBe(2026);
    expect(result.availableFiscalYears).toEqual([]);
    expect(result.accounts).toEqual([]);
    expect(result.reconciliation).toEqual({
      accountCount: 0, incomeCount: 0, expenseCount: 0, otherIncomeCount: 0, otherExpenseCount: 0,
      costOfGoodsSoldCount: 0, unassignedCount: 0, revenueActualCents: 0, expenseActualCents: 0,
    });
  });

  it('defaults to the church\'s current calendar year (Central time), with no fallback to an older year', async () => {
    const db = makeTestDb();
    insertEntry(db, { fiscalYear: 2025, classification: 'Income', categoryPath: 'Income:Offerings', accountName: 'Offerings', actualCents: 100 });
    // 2027-01-01 03:00 UTC is still December 31, 2026 in St. Louis.
    const result = await buildFinanceChartOfAccountsV1(db, { now: new Date('2027-01-01T03:00:00Z') });
    expect(result.fiscalYear).toBe(2026);
    expect(result.accounts).toEqual([]);
    expect(result.availableFiscalYears).toEqual([2025]);
  });

  it('produces one year of every P&L classification with figures, board categories, renames and purpose tags', async () => {
    const db = makeTestDb();
    insertEntry(db, { fiscalYear: 2026, classification: 'Income', categoryPath: 'Income:Offerings:General Fund', accountName: 'General Fund', depth: 1, actualCents: 500000, budgetCents: 600000 });
    insertEntry(db, { fiscalYear: 2026, classification: 'Other Income', categoryPath: 'Other Income:Interest', accountName: 'Interest', actualCents: 1200 });
    insertEntry(db, { fiscalYear: 2026, classification: 'Expenses', categoryPath: 'Expenses:Staff:Pastoral Salary', accountName: 'Pastoral Salary', depth: 1, actualCents: 300000, budgetCents: 310000 });
    insertEntry(db, { fiscalYear: 2026, classification: 'Expenses', categoryPath: 'Expenses:Office:Supplies', accountName: 'Office Supplies', depth: 1, actualCents: 4500 });
    insertEntry(db, { fiscalYear: 2026, classification: 'Other Expenses', categoryPath: 'Other Expenses:Bank Fees', accountName: 'Bank Fees', actualCents: 300 });
    insertEntry(db, { fiscalYear: 2026, classification: 'Cost of Goods Sold', categoryPath: 'Cost of Goods Sold:Resale', accountName: 'Resale', actualCents: 700 });
    // Not a P&L classification -- excluded.
    insertEntry(db, { fiscalYear: 2026, classification: 'Assets', categoryPath: 'Assets:Checking', accountName: 'Checking' });
    // Another year -- excluded from the accounts, listed in availableFiscalYears.
    insertEntry(db, { fiscalYear: 2025, classification: 'Income', categoryPath: 'Income:Offerings:General Fund', accountName: 'General Fund', actualCents: 999 });

    setSetting(db, 'finance_planning_board_categories', {
      revenue: { 'Income:Offerings:General Fund': 'donor', 'Other Income:Interest': 'passive' },
      expense: { 'Expenses:Staff:Pastoral Salary': 'salaries' },
      revenueLabels: {}, expenseLabels: { salaries: 'Salaries & Benefits' }, donorWrapperLabel: '',
      accountLabels: { 'Expenses:Office:Supplies': 'Office supplies and postage' },
    });
    setSetting(db, 'finance_planning_purpose_tags', {
      tags: [{ id: 'ministry', label: 'Ministry' }],
      categories: { 'Expenses:Staff:Pastoral Salary': 'ministry' },
    });

    const result = await buildFinanceChartOfAccountsV1(db, { fiscalYear: 2026, now: NOW });
    const validation = validateFinanceChartOfAccountsV1(result);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);

    expect(result.contract).toBe('connect.finance-chart-of-accounts.v1');
    expect(result.dataClassification).toBe('aggregate');
    expect(result.fiscalYear).toBe(2026);
    expect(result.availableFiscalYears).toEqual([2026, 2025]);
    expect(result.accounts.map((a) => a.categoryPath)).toEqual([
      'Income:Offerings:General Fund', 'Other Income:Interest', 'Expenses:Staff:Pastoral Salary',
      'Expenses:Office:Supplies', 'Other Expenses:Bank Fees', 'Cost of Goods Sold:Resale',
    ]);

    const general = result.accounts.find((a) => a.categoryPath === 'Income:Offerings:General Fund');
    expect(general).toMatchObject({ boardCategoryKey: 'donor', boardCategoryLabel: 'Donor', actualCents: 500000, budgetCents: 600000, displayName: 'General Fund' });
    // Other Income is on the revenue side, so a revenue assignment applies to it.
    expect(result.accounts.find((a) => a.categoryPath === 'Other Income:Interest')).toMatchObject({ boardCategoryKey: 'passive', budgetCents: null });

    const salary = result.accounts.find((a) => a.categoryPath === 'Expenses:Staff:Pastoral Salary');
    // Custom label from finance_planning_board_categories.expenseLabels wins over the default.
    expect(salary).toMatchObject({ boardCategoryKey: 'salaries', boardCategoryLabel: 'Salaries & Benefits', purposeTagId: 'ministry', purposeTagLabel: 'Ministry' });

    const supplies = result.accounts.find((a) => a.categoryPath === 'Expenses:Office:Supplies');
    expect(supplies).toMatchObject({ boardCategoryKey: 'unassigned', boardCategoryLabel: 'Unassigned', displayName: 'Office supplies and postage', accountName: 'Office Supplies' });

    expect(result.reconciliation).toEqual({
      accountCount: 6, incomeCount: 1, expenseCount: 2, otherIncomeCount: 1, otherExpenseCount: 1,
      costOfGoodsSoldCount: 1, unassignedCount: 3, revenueActualCents: 501200, expenseActualCents: 305500,
    });
  });

  it('falls back to the default board-category label when no custom label is saved', async () => {
    const db = makeTestDb();
    insertEntry(db, { fiscalYear: 2026, classification: 'Expenses', categoryPath: 'Expenses:Programs:Vacation Bible School', accountName: 'VBS' });
    setSetting(db, 'finance_planning_board_categories', {
      revenue: {}, expense: { 'Expenses:Programs:Vacation Bible School': 'programs' },
      revenueLabels: {}, expenseLabels: {}, donorWrapperLabel: '', accountLabels: {},
    });
    const result = await buildFinanceChartOfAccountsV1(db, { fiscalYear: 2026, now: NOW });
    expect(result.accounts[0]).toMatchObject({ boardCategoryKey: 'programs', boardCategoryLabel: 'Programs' });
  });

  it('drops a stale purpose-tag assignment whose tag was deleted, rather than surfacing a ghost id', async () => {
    const db = makeTestDb();
    insertEntry(db, { fiscalYear: 2026, classification: 'Income', categoryPath: 'Income:Offerings:General Fund', accountName: 'General Fund' });
    setSetting(db, 'finance_planning_purpose_tags', {
      tags: [], // the tag that used to exist was deleted
      categories: { 'Income:Offerings:General Fund': 'deleted_tag' },
    });
    const result = await buildFinanceChartOfAccountsV1(db, { fiscalYear: 2026, now: NOW });
    expect(result.accounts[0]).toMatchObject({ purposeTagId: null, purposeTagLabel: null });
  });

  it('picks the year\'s winning source wholesale, the same precedence rule as Connect\'s own tab', async () => {
    const db = makeTestDb();
    // 'import' outranks 'import_activity' for the same year; the activity-only account is not listed.
    insertEntry(db, { fiscalYear: 2026, classification: 'Income', categoryPath: 'Income:Offerings', accountName: 'Offerings', source: 'import', actualCents: 100 });
    insertEntry(db, { fiscalYear: 2026, classification: 'Income', categoryPath: 'Income:Offerings', accountName: 'Offerings (activity)', source: 'import_activity', actualCents: 90 });
    insertEntry(db, { fiscalYear: 2026, classification: 'Income', categoryPath: 'Income:Activity Only', accountName: 'Activity Only', source: 'import_activity', actualCents: 5 });
    const result = await buildFinanceChartOfAccountsV1(db, { fiscalYear: 2026, now: NOW });
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]).toMatchObject({ accountName: 'Offerings', actualCents: 100 });
  });
});
