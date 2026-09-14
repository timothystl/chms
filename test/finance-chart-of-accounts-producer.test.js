import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildFinanceChartOfAccountsV1 } from '../src/api-contracts.js';
import { validateFinanceChartOfAccountsV1 } from '../apps/finance/finance-chart-of-accounts-consumer.js';

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
  depth = 0, hasChildren = 0, source = 'qbo_sync', syncedAt = '',
}) {
  db._raw.prepare(
    `INSERT INTO finance_church_entries
       (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, source, synced_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(fiscalYear, periodMonth, classification, categoryPath, accountName, depth, hasChildren, source, syncedAt);
}

function setSetting(db, key, value) {
  db._raw.prepare(`INSERT INTO finance_settings (key, value) VALUES (?, ?)`).run(key, JSON.stringify(value));
}

describe('buildFinanceChartOfAccountsV1', () => {
  it('returns an empty, valid contract when nothing has ever imported', async () => {
    const db = makeTestDb();
    const result = await buildFinanceChartOfAccountsV1(db, { now: new Date('2026-06-15T12:00:00Z') });
    const validation = validateFinanceChartOfAccountsV1(result);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(result.accounts).toEqual([]);
    expect(result.reconciliation).toEqual({ accountCount: 0, incomeCount: 0, expenseCount: 0, unassignedCount: 0 });
  });

  it('produces a chart that Finance\'s own real consumer validator accepts, with board categories and purpose tags applied', async () => {
    const db = makeTestDb();
    insertEntry(db, { fiscalYear: 2026, classification: 'Income', categoryPath: 'Income:Offerings:General Fund', accountName: 'General Fund', depth: 1, syncedAt: '2026-06-01T00:00:00Z' });
    insertEntry(db, { fiscalYear: 2026, classification: 'Expenses', categoryPath: 'Expenses:Staff:Pastoral Salary', accountName: 'Pastoral Salary', depth: 1, syncedAt: '2026-06-01T00:00:00Z' });
    // An account with no board-category assignment at all.
    insertEntry(db, { fiscalYear: 2026, classification: 'Expenses', categoryPath: 'Expenses:Office:Supplies', accountName: 'Office Supplies', depth: 1, syncedAt: '2026-06-01T00:00:00Z' });
    // Not Income/Expenses -- must be excluded, same scope as apps/finance's own synthetic fixture.
    insertEntry(db, { fiscalYear: 2026, classification: 'Assets', categoryPath: 'Assets:Checking', accountName: 'Checking', syncedAt: '2026-06-01T00:00:00Z' });

    setSetting(db, 'finance_planning_board_categories', {
      revenue: { 'Income:Offerings:General Fund': 'donor' },
      expense: { 'Expenses:Staff:Pastoral Salary': 'salaries' },
      revenueLabels: {}, expenseLabels: { salaries: 'Salaries & Benefits' }, donorWrapperLabel: '', accountLabels: {},
    });
    setSetting(db, 'finance_planning_purpose_tags', {
      tags: [{ id: 'ministry', label: 'Ministry' }],
      categories: { 'Expenses:Staff:Pastoral Salary': 'ministry' },
    });

    const result = await buildFinanceChartOfAccountsV1(db, { now: new Date('2026-06-15T12:00:00Z') });
    const validation = validateFinanceChartOfAccountsV1(result);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);

    expect(result.contract).toBe('connect.finance-chart-of-accounts.v1');
    expect(result.dataClassification).toBe('structural');
    expect(result.accounts).toHaveLength(3); // Assets excluded

    const general = result.accounts.find((a) => a.categoryPath === 'Income:Offerings:General Fund');
    expect(general).toMatchObject({ boardCategoryKey: 'donor', boardCategoryLabel: 'Donor', purposeTagId: null, purposeTagLabel: null });

    const salary = result.accounts.find((a) => a.categoryPath === 'Expenses:Staff:Pastoral Salary');
    // Custom label from finance_planning_board_categories.expenseLabels wins over the default.
    expect(salary).toMatchObject({ boardCategoryKey: 'salaries', boardCategoryLabel: 'Salaries & Benefits', purposeTagId: 'ministry', purposeTagLabel: 'Ministry' });

    const supplies = result.accounts.find((a) => a.categoryPath === 'Expenses:Office:Supplies');
    expect(supplies).toMatchObject({ boardCategoryKey: 'unassigned', boardCategoryLabel: 'Unassigned', purposeTagId: null, purposeTagLabel: null });

    expect(result.reconciliation).toEqual({ accountCount: 3, incomeCount: 1, expenseCount: 2, unassignedCount: 1 });
  });

  it('falls back to the default board-category label when no custom label is saved', async () => {
    const db = makeTestDb();
    insertEntry(db, { fiscalYear: 2026, classification: 'Expenses', categoryPath: 'Expenses:Programs:Vacation Bible School', accountName: 'VBS', syncedAt: '2026-06-01T00:00:00Z' });
    setSetting(db, 'finance_planning_board_categories', {
      revenue: {}, expense: { 'Expenses:Programs:Vacation Bible School': 'programs' },
      revenueLabels: {}, expenseLabels: {}, donorWrapperLabel: '', accountLabels: {},
    });
    const result = await buildFinanceChartOfAccountsV1(db, { now: new Date('2026-06-15T12:00:00Z') });
    expect(result.accounts[0]).toMatchObject({ boardCategoryKey: 'programs', boardCategoryLabel: 'Programs' });
  });

  it('drops a stale purpose-tag assignment whose tag was deleted, rather than surfacing a ghost id', async () => {
    const db = makeTestDb();
    insertEntry(db, { fiscalYear: 2026, classification: 'Income', categoryPath: 'Income:Offerings:General Fund', accountName: 'General Fund', syncedAt: '2026-06-01T00:00:00Z' });
    setSetting(db, 'finance_planning_purpose_tags', {
      tags: [], // the tag that used to exist was deleted
      categories: { 'Income:Offerings:General Fund': 'deleted_tag' },
    });
    const result = await buildFinanceChartOfAccountsV1(db, { now: new Date('2026-06-15T12:00:00Z') });
    expect(result.accounts[0]).toMatchObject({ purposeTagId: null, purposeTagLabel: null });
  });

  it('picks each account\'s most recently synced row when the ledger has been re-imported', async () => {
    const db = makeTestDb();
    insertEntry(db, { fiscalYear: 2025, classification: 'Income', categoryPath: 'Income:Offerings:General Fund', accountName: 'Old Name', source: 'import', syncedAt: '2025-01-01T00:00:00Z' });
    insertEntry(db, { fiscalYear: 2026, classification: 'Income', categoryPath: 'Income:Offerings:General Fund', accountName: 'General Fund', source: 'qbo_sync', syncedAt: '2026-06-01T00:00:00Z' });
    const result = await buildFinanceChartOfAccountsV1(db, { now: new Date('2026-06-15T12:00:00Z') });
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].accountName).toBe('General Fund');
  });
});
