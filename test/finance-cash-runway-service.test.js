import { describe, expect, it } from 'vitest';
import { buildCashRunwayView, readSyntheticCashRunway } from '../apps/finance/cash-runway-service.js';

const cash = { fiscal_year: 2026, as_of_date: '2026-12-31', account_name: 'Synthetic Cash', operating_cash_cents: 30000000 };
const expenses = { fiscal_year: 2026, annual_expense_cents: 8000000 };

function dbWith(cashRows = [cash], expenseRows = [expenses]) {
  return {
    statements: [],
    prepare(sql) { this.statements.push(sql); return { sql }; },
    async batch() { return [{ results: cashRows }, { results: expenseRows }]; },
  };
}

describe('Finance synthetic cash runway service', () => {
  it('uses two bounded SELECTs and returns detached validated inputs', async () => {
    const db = dbWith();
    await expect(readSyntheticCashRunway(db)).resolves.toEqual({ ...cash, annual_expense_cents: 8000000 });
    expect(db.statements).toHaveLength(2);
    expect(db.statements.every((sql) => /^SELECT\b/i.test(sql))).toBe(true);
    expect(db.statements[0]).toContain("source='synthetic_fixture'");
    expect(db.statements[1]).toContain("classification='Expenses'");
  });

  it('calculates average monthly expense and cash coverage without rounding away evidence', () => {
    expect(buildCashRunwayView({ ...cash, annual_expense_cents: 8000000 })).toEqual({
      fiscalYear: 2026,
      asOfDate: '2026-12-31',
      accountName: 'Synthetic Cash',
      operatingCashCents: 30000000,
      annualExpenseCents: 8000000,
      monthlyExpenseCents: 8000000 / 12,
      runwayMonths: 45,
    });
  });

  it('fails closed on missing, mismatched, negative-cash, or nonpositive-expense inputs', async () => {
    await expect(readSyntheticCashRunway(dbWith([], [expenses]))).rejects.toThrow('Synthetic cash runway inputs invalid');
    await expect(readSyntheticCashRunway(dbWith([cash], [{ ...expenses, fiscal_year: 2025 }]))).rejects.toThrow('Synthetic cash runway inputs invalid');
    await expect(readSyntheticCashRunway(dbWith([{ ...cash, operating_cash_cents: -1 }], [expenses]))).rejects.toThrow('Synthetic cash runway inputs invalid');
    await expect(readSyntheticCashRunway(dbWith([cash], [{ ...expenses, annual_expense_cents: 0 }]))).rejects.toThrow('Synthetic cash runway inputs invalid');
  });
});
