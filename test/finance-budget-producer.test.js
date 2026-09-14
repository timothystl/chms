import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildFinanceBudgetV1 } from '../src/api-contracts.js';
import { validateFinanceBudgetV1 } from '../apps/finance/finance-budget-consumer.js';

// finance_budget_plan is not part of migrations/0001_baseline.sql (it was added later, in
// migrations/0024_finance_budget_plan.sql) -- same reason Chart of Accounts' producer test adds
// finance_church_entries/finance_settings as EXTRA_SCHEMA. Column-for-column identical to
// src/db.js's real CREATE TABLE and to apps/finance/migrations/0001_finance_foundation.sql's copy
// of it (confirmed by direct comparison, not just the architecture repo's evidence doc).
const EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS finance_budget_plan (
  category             TEXT    NOT NULL,
  classification        TEXT    NOT NULL DEFAULT 'Expenses',
  fiscal_year           INTEGER NOT NULL,
  planned_amount_cents  INTEGER NOT NULL DEFAULT 0,
  basis                 TEXT    NOT NULL DEFAULT 'manual',
  growth_pct            REAL,
  base_amount_cents     INTEGER,
  notes                 TEXT    NOT NULL DEFAULT '',
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (category, fiscal_year)
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

function insertPlanRow(db, {
  category, classification = 'Expenses', fiscalYear, plannedAmountCents,
  basis = 'manual', growthPct = null, baseAmountCents = null, notes = '',
}) {
  db._raw.prepare(
    `INSERT INTO finance_budget_plan (category, classification, fiscal_year, planned_amount_cents, basis, growth_pct, base_amount_cents, notes)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(category, classification, fiscalYear, plannedAmountCents, basis, growthPct, baseAmountCents, notes);
}

describe('buildFinanceBudgetV1', () => {
  it('returns a valid, empty-categories contract for a fiscal year nothing has been planned for yet', async () => {
    const db = makeTestDb();
    const result = await buildFinanceBudgetV1(db, { fiscalYear: 2030, now: new Date('2026-09-14T12:00:00Z') });
    const validation = validateFinanceBudgetV1(result);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(result.fiscalYear).toBe(2030);
    expect(result.categories).toEqual([]);
    expect(result.totals).toEqual({ plannedIncomeCents: 0, plannedExpenseCents: 0, plannedNetCents: 0 });
    expect(result.reconciliation).toEqual({ categoryCount: 0, incomeCount: 0, expenseCount: 0, manualCount: 0, grownCount: 0, totalsMatch: true });
  });

  it('reflects real manual-entry rows -- the actual shape of production\'s current FY2027 plan', async () => {
    const db = makeTestDb();
    insertPlanRow(db, { category: 'Income:Offerings:General Fund', classification: 'Income', fiscalYear: 2027, plannedAmountCents: 130000000, basis: 'manual' });
    insertPlanRow(db, { category: 'Expenses:Staff:Pastoral Salary', classification: 'Expenses', fiscalYear: 2027, plannedAmountCents: 85000000, basis: 'manual', notes: 'Set by council' });
    // A different fiscal year must not leak into this year's plan.
    insertPlanRow(db, { category: 'Expenses:Staff:Pastoral Salary', classification: 'Expenses', fiscalYear: 2028, plannedAmountCents: 90000000, basis: 'manual' });

    const result = await buildFinanceBudgetV1(db, { fiscalYear: 2027, now: new Date('2026-09-14T12:00:00Z') });
    const validation = validateFinanceBudgetV1(result);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);

    expect(result.contract).toBe('connect.finance-budget.v1');
    expect(result.dataClassification).toBe('aggregate');
    expect(result.categories).toHaveLength(2);

    const salary = result.categories.find((c) => c.category === 'Expenses:Staff:Pastoral Salary');
    expect(salary).toMatchObject({ classification: 'Expenses', plannedAmountCents: 85000000, basis: 'manual', growthPct: null, baseAmountCents: null, notes: 'Set by council' });

    expect(result.totals).toEqual({ plannedIncomeCents: 130000000, plannedExpenseCents: 85000000, plannedNetCents: 45000000 });
    expect(result.reconciliation).toEqual({ categoryCount: 2, incomeCount: 1, expenseCount: 1, manualCount: 2, grownCount: 0, totalsMatch: true });
  });

  it('reflects a grown row with its base amount and growth rate intact', async () => {
    const db = makeTestDb();
    insertPlanRow(db, {
      category: 'Expenses:Program:Youth Ministry', classification: 'Expenses', fiscalYear: 2027,
      plannedAmountCents: 1100000, basis: 'grown', growthPct: 0.1, baseAmountCents: 1000000,
    });
    const result = await buildFinanceBudgetV1(db, { fiscalYear: 2027, now: new Date('2026-09-14T12:00:00Z') });
    expect(validateFinanceBudgetV1(result).ok).toBe(true);
    expect(result.categories[0]).toMatchObject({ basis: 'grown', growthPct: 0.1, baseAmountCents: 1000000, plannedAmountCents: 1100000 });
    expect(result.reconciliation.grownCount).toBe(1);
    expect(result.reconciliation.manualCount).toBe(0);
  });

  it('does not leak Income or a different fiscal year into totals', async () => {
    const db = makeTestDb();
    insertPlanRow(db, { category: 'Income:Offerings:General Fund', classification: 'Income', fiscalYear: 2027, plannedAmountCents: 500000 });
    insertPlanRow(db, { category: 'Income:Offerings:General Fund', classification: 'Income', fiscalYear: 2026, plannedAmountCents: 999999999 });
    const result = await buildFinanceBudgetV1(db, { fiscalYear: 2027, now: new Date('2026-09-14T12:00:00Z') });
    expect(result.categories).toHaveLength(1);
    expect(result.totals.plannedIncomeCents).toBe(500000);
  });
});
