import { describe, expect, it } from 'vitest';
import { buildBudgetReportView, readSyntheticBudgetReport } from '../apps/finance/budget-report-service.js';

const rows = [
  { category: 'Synthetic Giving', classification: 'Income', fiscal_year: 2027, planned_amount_cents: 12000000, basis: 'synthetic_fixture', notes: 'Synthetic fixture' },
  { category: 'Synthetic Programs', classification: 'Expenses', fiscal_year: 2027, planned_amount_cents: 9000000, basis: 'synthetic_fixture', notes: 'Synthetic fixture' },
];

describe('Finance synthetic Budget service', () => {
  it('runs one fixture-only SELECT and returns detached rows', async () => {
    const statements = [];
    const db = {
      prepare(sql) { statements.push(sql); return { sql }; },
      async batch() { return [{ results: rows }]; },
    };
    const result = await readSyntheticBudgetReport(db);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^SELECT\b/i);
    expect(statements[0]).toContain("basis='synthetic_fixture'");
    expect(result).toEqual(rows);
    expect(result).not.toBe(rows);
  });

  it('totals planned income, expenses, and result', () => {
    expect(buildBudgetReportView(rows)).toMatchObject({
      fiscalYear: 2027,
      totals: { incomeCents: 12000000, expenseCents: 9000000, netCents: 3000000 },
    });
  });

  it('fails closed on malformed rows and mixed years', async () => {
    const db = {
      prepare(sql) { return { sql }; },
      async batch() { return [{ results: [{ ...rows[0], classification: 'Equity' }] }]; },
    };
    await expect(readSyntheticBudgetReport(db)).rejects.toThrow('Synthetic Budget rows invalid');
    expect(() => buildBudgetReportView([rows[0], { ...rows[1], fiscal_year: 2028 }])).toThrow('Synthetic Budget fiscal year mismatch');
  });
});
