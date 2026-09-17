import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  BUDGET_PLAN_WRITES_ENABLED_KEY,
  isBudgetPlanWritesEnabled,
  saveBudgetPlanRows,
  validateBudgetPlanRows,
} from '../apps/finance/budget-plan-write-service.js';

// Real Finance-owned schema (FINANCE_DB), not the shared Connect D1 -- see
// apps/finance/migrations/0001_finance_foundation.sql, which already defines both
// finance_budget_plan and finance_settings exactly as production's Finance D1 does.
function makeFinanceDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../apps/finance/migrations/0001_finance_foundation.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async run() { sqlite.prepare(sql).run(); },
        async first() { return sqlite.prepare(sql).get(); },
        async all() { return { results: sqlite.prepare(sql).all() }; },
      };
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
    _raw: sqlite,
  };
}

describe('validateBudgetPlanRows', () => {
  it('rejects an empty or non-array payload', () => {
    expect(validateBudgetPlanRows(undefined)).toEqual({ ok: false, error: 'No rows to save' });
    expect(validateBudgetPlanRows([])).toEqual({ ok: false, error: 'No rows to save' });
    expect(validateBudgetPlanRows('not-an-array')).toEqual({ ok: false, error: 'No rows to save' });
  });

  it('requires a category and fiscal_year on every row', () => {
    expect(validateBudgetPlanRows([{ fiscal_year: 2027, planned_amount: '100' }]).ok).toBe(false);
    expect(validateBudgetPlanRows([{ category: 'Utilities', planned_amount: '100' }]).ok).toBe(false);
    expect(validateBudgetPlanRows([{ category: '   ', fiscal_year: 2027, planned_amount: '100' }]).ok).toBe(false);
  });

  it('rejects a fiscal_year outside the sane 2000-2100 range (fiscal-year scoping)', () => {
    expect(validateBudgetPlanRows([{ category: 'Utilities', fiscal_year: 1999, planned_amount: '100' }]).ok).toBe(false);
    expect(validateBudgetPlanRows([{ category: 'Utilities', fiscal_year: 2101, planned_amount: '100' }]).ok).toBe(false);
    expect(validateBudgetPlanRows([{ category: 'Utilities', fiscal_year: 20270, planned_amount: '100' }]).ok).toBe(false); // pasted-typo shape
    expect(validateBudgetPlanRows([{ category: 'Utilities', fiscal_year: 2027, planned_amount: '100' }]).ok).toBe(true);
  });

  it('rejects a classification other than Income or Expenses', () => {
    const res = validateBudgetPlanRows([{ category: 'Utilities', fiscal_year: 2027, classification: 'Bogus', planned_amount: '100' }]);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Invalid classification/);
  });

  it('defaults classification to Expenses when omitted', () => {
    const res = validateBudgetPlanRows([{ category: 'Utilities', fiscal_year: 2027, planned_amount: '100' }]);
    expect(res.ok).toBe(true);
    expect(res.rows[0].classification).toBe('Expenses');
  });

  it('rejects a non-numeric planned_amount', () => {
    const res = validateBudgetPlanRows([{ category: 'Utilities', fiscal_year: 2027, planned_amount: 'not-a-number' }]);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Invalid amount/);
  });

  it('rounds a fractional amount to the nearest whole dollar before converting to cents', () => {
    const res = validateBudgetPlanRows([{ category: 'Utilities', fiscal_year: 2027, planned_amount: '1999.60' }]);
    expect(res.ok).toBe(true);
    expect(res.rows[0].amountCents).toBe(200000); // rounds to $2000, not $1999.60
  });

  it('rejects the whole batch if one row is malformed, validating none of the rest as a partial success', () => {
    const res = validateBudgetPlanRows([
      { category: 'Utilities', fiscal_year: 2027, planned_amount: '20600' },
      { category: '', fiscal_year: 2027, planned_amount: '100' },
    ]);
    expect(res.ok).toBe(false);
  });

  it('accepts multiple valid rows spanning different fiscal years', () => {
    const res = validateBudgetPlanRows([
      { category: 'Utilities', fiscal_year: 2027, planned_amount: '20600' },
      { category: 'Utilities', fiscal_year: 2028, planned_amount: '21200' },
    ]);
    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(2);
  });
});

describe('saveBudgetPlanRows', () => {
  it('upserts a validated row into finance_budget_plan as basis=manual', async () => {
    const db = makeFinanceDb();
    const { rows } = validateBudgetPlanRows([{ category: 'Expenses:Utilities', classification: 'Expenses', fiscal_year: 2027, planned_amount: '20600', notes: 'hand-typed' }]);
    const saved = await saveBudgetPlanRows(db, rows);
    expect(saved).toBe(1);
    const row = db._raw.prepare('SELECT * FROM finance_budget_plan').get();
    expect(row.category).toBe('Expenses:Utilities');
    expect(row.planned_amount_cents).toBe(2060000);
    expect(row.basis).toBe('manual');
    expect(row.notes).toBe('hand-typed');
  });

  it('re-saving the same category/fiscal_year replaces the row rather than duplicating it, and clears any prior growth basis', async () => {
    const db = makeFinanceDb();
    db._raw.prepare(
      `INSERT INTO finance_budget_plan (category,classification,fiscal_year,planned_amount_cents,basis,growth_pct,base_amount_cents,notes)
       VALUES ('Expenses:Utilities','Expenses',2027,1900000,'grown',0.05,1800000,'')`
    ).run();
    const { rows } = validateBudgetPlanRows([{ category: 'Expenses:Utilities', fiscal_year: 2027, planned_amount: '20600' }]);
    await saveBudgetPlanRows(db, rows);
    const all = db._raw.prepare('SELECT * FROM finance_budget_plan').all();
    expect(all).toHaveLength(1);
    expect(all[0].planned_amount_cents).toBe(2060000);
    expect(all[0].basis).toBe('manual');
    expect(all[0].growth_pct).toBeNull();
    expect(all[0].base_amount_cents).toBeNull();
  });

  it('never writes a row for a different fiscal_year than the one validated', async () => {
    const db = makeFinanceDb();
    const { rows } = validateBudgetPlanRows([{ category: 'Expenses:Utilities', fiscal_year: 2027, planned_amount: '100' }]);
    await saveBudgetPlanRows(db, rows);
    const other = db._raw.prepare('SELECT * FROM finance_budget_plan WHERE fiscal_year=2028').all();
    expect(other).toHaveLength(0);
  });

  it('does nothing and returns 0 for an empty rows array', async () => {
    const db = makeFinanceDb();
    expect(await saveBudgetPlanRows(db, [])).toBe(0);
    expect(db._raw.prepare('SELECT * FROM finance_budget_plan').all()).toHaveLength(0);
  });
});

describe('isBudgetPlanWritesEnabled — off-by-default gate', () => {
  it('is disabled when the finance_settings row does not exist at all (fresh database)', async () => {
    const db = makeFinanceDb();
    expect(await isBudgetPlanWritesEnabled(db)).toBe(false);
  });

  it('is disabled for any value other than exactly "1"', async () => {
    const db = makeFinanceDb();
    for (const value of ['true', 'yes', '0', '', ' 1', '1 ']) {
      db._raw.prepare('INSERT OR REPLACE INTO finance_settings (key,value) VALUES (?,?)').run(BUDGET_PLAN_WRITES_ENABLED_KEY, value);
      expect(await isBudgetPlanWritesEnabled(db)).toBe(false);
    }
  });

  it('is enabled only when the flag is exactly "1"', async () => {
    const db = makeFinanceDb();
    db._raw.prepare('INSERT INTO finance_settings (key,value) VALUES (?,?)').run(BUDGET_PLAN_WRITES_ENABLED_KEY, '1');
    expect(await isBudgetPlanWritesEnabled(db)).toBe(true);
  });

  it('fails closed (disabled) if reading finance_settings throws, never silently enabling the write path', async () => {
    const throwingDb = { prepare() { throw new Error('boom'); } };
    expect(await isBudgetPlanWritesEnabled(throwingDb)).toBe(false);
  });
});
