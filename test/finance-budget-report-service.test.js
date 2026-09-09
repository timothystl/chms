import { describe, expect, it } from 'vitest';
import { buildBudgetReportView, readSyntheticBudgetReport } from '../apps/finance/budget-report-service.js';

const rows = [
  { category: 'Synthetic Contributions', classification: 'Income', fiscal_year: 2027, base_amount_cents: 12000000, growth_pct: 0.10, planned_amount_cents: 13200000, basis: 'synthetic_fixture', notes: '10% synthetic growth assumption' },
  { category: 'Synthetic Programs', classification: 'Expenses', fiscal_year: 2027, base_amount_cents: 8000000, growth_pct: 0.125, planned_amount_cents: 9000000, basis: 'synthetic_fixture', notes: '12.5% synthetic growth assumption' },
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

  it('calculates and reconciles the base and planned outlook', () => {
    expect(buildBudgetReportView(rows)).toMatchObject({
      fiscalYear: 2027,
      rows: [
        { category: 'Synthetic Contributions', changeCents: 1200000 },
        { category: 'Synthetic Programs', changeCents: 1000000 },
      ],
      totals: {
        baseIncomeCents: 12000000,
        baseExpenseCents: 8000000,
        baseNetCents: 4000000,
        plannedIncomeCents: 13200000,
        plannedExpenseCents: 9000000,
        plannedNetCents: 4200000,
        netChangeCents: 200000,
        reconciled: true,
      },
    });
  });

  it('fails closed on malformed rows and mixed years', async () => {
    const db = {
      prepare(sql) { return { sql }; },
      async batch() { return [{ results: [{ ...rows[0], classification: 'Equity' }] }]; },
    };
    await expect(readSyntheticBudgetReport(db)).rejects.toThrow('Synthetic Budget rows invalid');
    const mismatchedCalculation = {
      prepare(sql) { return { sql }; },
      async batch() { return [{ results: [{ ...rows[0], planned_amount_cents: 13199999 }] }]; },
    };
    await expect(readSyntheticBudgetReport(mismatchedCalculation)).rejects.toThrow('Synthetic Budget rows invalid');
    expect(() => buildBudgetReportView([rows[0], { ...rows[1], fiscal_year: 2028 }])).toThrow('Synthetic Budget fiscal year mismatch');
    expect(() => buildBudgetReportView([])).toThrow('Synthetic Budget rows required');
  });
});
