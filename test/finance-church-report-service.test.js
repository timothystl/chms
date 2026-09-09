import { describe, expect, it } from 'vitest';
import { buildChurchReportView, readSyntheticChurchReport, readSyntheticChurchTrends } from '../apps/finance/church-report-service.js';

const rows = [
  { fiscal_year: 2026, classification: 'Income', account_name: 'Synthetic Contributions', own_actual_cents: 12000000, own_budget_cents: 12500000 },
  { fiscal_year: 2026, classification: 'Expenses', account_name: 'Synthetic Programs', own_actual_cents: 8000000, own_budget_cents: 8500000 },
];

function dbWith(results) {
  return {
    prepare(sql) { return { sql }; },
    async batch(statements) {
      expect(statements).toHaveLength(1);
      expect(statements[0].sql).toMatch(/^SELECT\b/);
      expect(statements[0].sql).toContain("source='synthetic_fixture'");
      return [{ results }];
    },
  };
}

describe('synthetic Church Report service', () => {
  it('reads detached synthetic rows and derives report totals', async () => {
    const read = await readSyntheticChurchReport(dbWith(rows));
    expect(read).not.toBe(rows);
    expect(buildChurchReportView(read)).toMatchObject({
      fiscalYear: 2026,
      totals: { incomeActualCents: 12000000, expenseActualCents: 8000000, actualNetCents: 4000000, budgetNetCents: 4000000 },
    });
  });

  it('fails closed on an unexpected classification or non-integer amount', async () => {
    await expect(readSyntheticChurchReport(dbWith([{ ...rows[0], classification: 'Other' }]))).rejects.toThrow('Synthetic Church Report rows invalid');
    await expect(readSyntheticChurchReport(dbWith([{ ...rows[0], own_actual_cents: 1.5 }]))).rejects.toThrow('Synthetic Church Report rows invalid');
  });

  it('derives a bounded multi-year operating trend', async () => {
    const trends = await readSyntheticChurchTrends(dbWith([
      { fiscal_year: 2025, income_cents: 11000000, expense_cents: 7800000 },
      { fiscal_year: 2026, income_cents: 12000000, expense_cents: 8000000 },
    ]));
    expect(trends).toEqual([
      { fiscal_year: 2025, income_cents: 11000000, expense_cents: 7800000, net_cents: 3200000 },
      { fiscal_year: 2026, income_cents: 12000000, expense_cents: 8000000, net_cents: 4000000 },
    ]);
  });

  it('fails closed when a trend is incomplete', async () => {
    await expect(readSyntheticChurchTrends(dbWith([
      { fiscal_year: 2026, income_cents: 12000000, expense_cents: 8000000 },
    ]))).rejects.toThrow('Synthetic Church trend rows invalid');
  });
});
