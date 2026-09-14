import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildFinanceDaycareReportV1 } from '../src/api-contracts.js';
import { validateFinanceDaycareReportV1 } from '../apps/finance/finance-daycare-consumer.js';

// finance_daycare_entries, finance_church_entries, and finance_settings are not part of
// migrations/0001_baseline.sql -- same reason Church Report's producer test adds
// finance_church_entries as EXTRA_SCHEMA. Column-for-column identical to src/db.js's real
// CREATE TABLE for each.
const EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS finance_daycare_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  period       TEXT    NOT NULL DEFAULT '',
  category     TEXT    NOT NULL DEFAULT '',
  entry_type   TEXT    NOT NULL DEFAULT 'actual',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  notes        TEXT    NOT NULL DEFAULT '',
  source       TEXT    NOT NULL DEFAULT 'manual',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
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

function insertDaycareEntry(db, { period, category, entryType = 'actual', amountCents = 0, source = 'church_budget_import' }) {
  db._raw.prepare(
    `INSERT INTO finance_daycare_entries (period, category, entry_type, amount_cents, source) VALUES (?,?,?,?,?)`
  ).run(period, category, entryType, amountCents, source);
}

function insertChurchEntry(db, {
  fiscalYear, classification, categoryPath, accountName, actualCents = 0, budgetCents = null, source = 'import',
}) {
  db._raw.prepare(
    `INSERT INTO finance_church_entries (fiscal_year, period_month, classification, category_path, account_name, own_actual_cents, own_budget_cents, source)
     VALUES (?,0,?,?,?,?,?,?)`
  ).run(fiscalYear, classification, categoryPath, accountName, actualCents, budgetCents, source);
}

describe('buildFinanceDaycareReportV1', () => {
  it('returns a valid, empty-categories contract for a fiscal year with nothing imported on either side', async () => {
    const db = makeTestDb();
    const result = await buildFinanceDaycareReportV1(db, { fiscalYear: 2030, now: new Date('2026-09-14T12:00:00Z') });
    const validation = validateFinanceDaycareReportV1(result);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(result.contract).toBe('connect.finance-daycare-report.v1');
    expect(result.fiscalYear).toBe(2030);
    expect(result.categories).toEqual([]);
    expect(result.totals).toEqual({
      incomeActualCents: 0, incomeBudgetCents: 0, expenseActualCents: 0, expenseBudgetCents: 0,
      netActualCents: 0, netBudgetCents: 0,
    });
    expect(result.allocation).toEqual({
      utilityPct: 0.5, insurancePct: 0.5, churchUtilityActualCents: 0, churchInsuranceActualCents: 0,
      mdoUtilityCents: 0, mdoInsuranceCents: 0,
    });
    expect(result.reconciliation).toEqual({ categoryCount: 0, incomeCategoryCount: 0, expenseCategoryCount: 0, totalsMatch: true });
  });

  it('reflects real church_budget_import rows for the requested fiscal year only, classifying Tuition Income as Income', async () => {
    const db = makeTestDb();
    insertDaycareEntry(db, { period: '2026', category: 'Tuition Income', entryType: 'actual', amountCents: 40000000 });
    insertDaycareEntry(db, { period: '2026', category: 'Tuition Income', entryType: 'budget', amountCents: 39000000 });
    insertDaycareEntry(db, { period: '2026', category: 'Payroll', entryType: 'actual', amountCents: 25000000 });
    insertDaycareEntry(db, { period: '2026', category: 'Payroll', entryType: 'budget', amountCents: 24000000 });
    insertDaycareEntry(db, { period: '2025', category: 'Tuition Income', entryType: 'actual', amountCents: 999999999 });

    const result = await buildFinanceDaycareReportV1(db, { fiscalYear: 2026, now: new Date('2026-09-14T12:00:00Z') });
    expect(validateFinanceDaycareReportV1(result).ok).toBe(true);
    expect(result.categories).toEqual([
      { category: 'Tuition Income', classification: 'Income', actualCents: 40000000, budgetCents: 39000000 },
      { category: 'Payroll', classification: 'Expenses', actualCents: 25000000, budgetCents: 24000000 },
    ]);
    expect(result.totals).toMatchObject({
      incomeActualCents: 40000000, incomeBudgetCents: 39000000,
      expenseActualCents: 25000000, expenseBudgetCents: 24000000,
      netActualCents: 15000000, netBudgetCents: 15000000,
    });
  });

  it('excludes source=daycare_api and source=manual rows from every total -- only church_budget_import and manual_budget_override count, per the documented decision', async () => {
    const db = makeTestDb();
    insertDaycareEntry(db, { period: '2026', category: 'Tuition Income', entryType: 'actual', amountCents: 40000000, source: 'church_budget_import' });
    insertDaycareEntry(db, { period: '2026', category: 'Tuition Income', entryType: 'actual', amountCents: 999999999, source: 'daycare_api' });
    insertDaycareEntry(db, { period: '2026', category: 'Other Expenses', entryType: 'actual', amountCents: 12345, source: 'manual' });

    const result = await buildFinanceDaycareReportV1(db, { fiscalYear: 2026, now: new Date('2026-09-14T12:00:00Z') });
    expect(validateFinanceDaycareReportV1(result).ok).toBe(true);
    expect(result.categories).toEqual([{ category: 'Tuition Income', classification: 'Income', actualCents: 40000000, budgetCents: 0 }]);
    expect(result.totals.incomeActualCents).toBe(40000000);
  });

  it('a manual_budget_override REPLACES (never adds to) the church_budget_import budget for that category', async () => {
    const db = makeTestDb();
    insertDaycareEntry(db, { period: '2026', category: 'Payroll', entryType: 'actual', amountCents: 25000000, source: 'church_budget_import' });
    insertDaycareEntry(db, { period: '2026', category: 'Payroll', entryType: 'budget', amountCents: 24000000, source: 'church_budget_import' });
    insertDaycareEntry(db, { period: '2026', category: 'Payroll', entryType: 'budget', amountCents: 26000000, source: 'manual_budget_override' });

    const result = await buildFinanceDaycareReportV1(db, { fiscalYear: 2026, now: new Date('2026-09-14T12:00:00Z') });
    expect(validateFinanceDaycareReportV1(result).ok).toBe(true);
    expect(result.categories).toEqual([{ category: 'Payroll', classification: 'Expenses', actualCents: 25000000, budgetCents: 26000000 }]);
  });

  it('adds a live Utilities/Insurance allocation derived from the church side, only once church-side data exists for the year', async () => {
    const db = makeTestDb();
    insertDaycareEntry(db, { period: '2026', category: 'Tuition Income', entryType: 'actual', amountCents: 40000000 });
    insertChurchEntry(db, { fiscalYear: 2026, classification: 'Expenses', categoryPath: 'Expenses:34 Utilities', accountName: '34 Utilities', actualCents: 1200000 });
    insertChurchEntry(db, { fiscalYear: 2026, classification: 'Expenses', categoryPath: 'Expenses:35 Insurance', accountName: '35 Insurance', actualCents: 500000 });
    db._raw.prepare(
      `INSERT INTO finance_settings (key, value) VALUES ('finance_daycare_allocation_config', ?)`
    ).run(JSON.stringify({ utilityPct: 0.5, insurancePct: 0.5 }));

    const result = await buildFinanceDaycareReportV1(db, { fiscalYear: 2026, now: new Date('2026-09-14T12:00:00Z') });
    expect(validateFinanceDaycareReportV1(result).ok).toBe(true);
    const utilities = result.categories.find((c) => c.category === 'Utilities');
    const insurance = result.categories.find((c) => c.category === 'Insurance');
    expect(utilities).toEqual({ category: 'Utilities', classification: 'Expenses', actualCents: 600000, budgetCents: 0 });
    expect(insurance).toEqual({ category: 'Insurance', classification: 'Expenses', actualCents: 250000, budgetCents: 0 });
    expect(result.allocation).toEqual({
      utilityPct: 0.5, insurancePct: 0.5, churchUtilityActualCents: 1200000, churchInsuranceActualCents: 500000,
      mdoUtilityCents: 600000, mdoInsuranceCents: 250000,
    });
    expect(result.totals.expenseActualCents).toBe(600000 + 250000);
    expect(result.totals.netActualCents).toBe(40000000 - 850000);
  });

  it('does not surface a zeroed Utilities/Insurance line for a year with no daycare data AND no church data', async () => {
    const db = makeTestDb();
    const result = await buildFinanceDaycareReportV1(db, { fiscalYear: 2031, now: new Date('2026-09-14T12:00:00Z') });
    expect(validateFinanceDaycareReportV1(result).ok).toBe(true);
    expect(result.categories).toEqual([]);
  });

  it('falls back to the 50/50 default when finance_daycare_allocation_config is missing, matching the real allocation-config route default', async () => {
    const db = makeTestDb();
    insertDaycareEntry(db, { period: '2026', category: 'Tuition Income', entryType: 'actual', amountCents: 1000000 });
    insertChurchEntry(db, { fiscalYear: 2026, classification: 'Expenses', categoryPath: 'Expenses:34 Utilities', accountName: '34 Utilities', actualCents: 100000 });
    const result = await buildFinanceDaycareReportV1(db, { fiscalYear: 2026, now: new Date('2026-09-14T12:00:00Z') });
    expect(result.allocation.utilityPct).toBe(0.5);
    expect(result.allocation.mdoUtilityCents).toBe(50000);
  });

  it('classifies every category classifyMdoAccountCategory can produce, with the correct closed-set classification', async () => {
    const db = makeTestDb();
    const cases = [
      ['Tuition Income', 'Income'], ['Payroll', 'Expenses'], ['Payroll Taxes', 'Expenses'],
      ['Workers Comp', 'Expenses'], ['Other Payroll Expenses', 'Expenses'], ['Other Expenses', 'Expenses'],
    ];
    for (const [category] of cases) {
      insertDaycareEntry(db, { period: '2026', category, entryType: 'actual', amountCents: 1000 });
    }
    const result = await buildFinanceDaycareReportV1(db, { fiscalYear: 2026, now: new Date('2026-09-14T12:00:00Z') });
    expect(validateFinanceDaycareReportV1(result).ok).toBe(true);
    for (const [category, classification] of cases) {
      const row = result.categories.find((c) => c.category === category);
      expect(row.classification, category).toBe(classification);
    }
    // FIN_KNOWN_CATEGORY_ORDER order, matching js-finance.js's own display order.
    expect(result.categories.map((c) => c.category)).toEqual([
      'Tuition Income', 'Payroll', 'Payroll Taxes', 'Workers Comp', 'Other Payroll Expenses', 'Other Expenses',
    ]);
  });
});
