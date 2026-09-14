import { describe, expect, it } from 'vitest';
import { buildLiveBudgetReportView, readSyntheticBudgetReport, resolveBudgetReport } from '../apps/finance/budget-report-service.js';

const syntheticRows = [
  { category: 'Synthetic Contributions', classification: 'Income', fiscal_year: 2027, base_amount_cents: 12000000, growth_pct: 0.1, planned_amount_cents: 13200000, basis: 'synthetic_fixture', notes: '10% synthetic growth assumption' },
  { category: 'Synthetic Programs', classification: 'Expenses', fiscal_year: 2027, base_amount_cents: 8000000, growth_pct: 0.125, planned_amount_cents: 9000000, basis: 'synthetic_fixture', notes: '12.5% synthetic growth assumption' },
];

function fixtureDb() {
  return {
    prepare(sql) { return { sql }; },
    async batch() { return [{ results: syntheticRows }]; },
  };
}

describe('resolveBudgetReport (live connect.finance-budget.v1 with synthetic fallback)', () => {
  it('falls back to the synthetic fixture when the live contract is not configured', async () => {
    const result = await resolveBudgetReport({}, fixtureDb());
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('not_configured');
    expect(result.rows).toEqual(syntheticRows);
  });

  it('requests next fiscal year and returns the live payload as-is (camelCase, not remapped)', async () => {
    let requestedUrl;
    const env = {
      CONNECT_SERVICE: {
        async fetch(req) {
          requestedUrl = new URL(req.url);
          return new Response(JSON.stringify({
            contract: 'connect.finance-budget.v1', dataClassification: 'aggregate',
            sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
            fiscalYear: 2027, generatedAt: '2026-09-14T12:00:00Z',
            categories: [{
              category: 'Income:Offerings:General Fund', classification: 'Income', plannedAmountCents: 130000000,
              basis: 'manual', growthPct: null, baseAmountCents: null, notes: '',
            }],
            totals: { plannedIncomeCents: 130000000, plannedExpenseCents: 0, plannedNetCents: 130000000 },
            reconciliation: { categoryCount: 1, incomeCount: 1, expenseCount: 0, manualCount: 1, grownCount: 0, totalsMatch: true },
          }), { status: 200 });
        },
      },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolveBudgetReport(env, fixtureDb());
    expect(result.source).toBe('live');
    expect(result.fiscalYear).toBe(2027);
    expect(requestedUrl.searchParams.get('fiscal_year')).toBe(String(new Date().getUTCFullYear() + 1));
    expect(result.categories).toEqual([{
      category: 'Income:Offerings:General Fund', classification: 'Income', plannedAmountCents: 130000000,
      basis: 'manual', growthPct: null, baseAmountCents: null, notes: '',
    }]);
  });

  it('falls back to the synthetic fixture, labeled with the failure reason, on a live contract-validation failure', async () => {
    const env = {
      CONNECT_SERVICE: { async fetch() { return new Response(JSON.stringify({ contract: 'connect.finance-budget.v1' }), { status: 200 }); } },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolveBudgetReport(env, fixtureDb());
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('contract_validation_failed');
    expect(result.rows).toEqual(syntheticRows);
  });
});

describe('buildLiveBudgetReportView', () => {
  it('requires a fiscal year', () => {
    expect(() => buildLiveBudgetReportView([], undefined)).toThrow('Live Budget report requires a fiscal year');
  });

  it('renders an empty plan without dividing by zero or fabricating totals', () => {
    const view = buildLiveBudgetReportView([], 2030);
    expect(view).toMatchObject({
      fiscalYear: 2030, rows: [],
      totals: { plannedIncomeCents: 0, plannedExpenseCents: 0, plannedNetCents: 0 },
      counts: { categoryCount: 0, grownCount: 0, manualCount: 0 },
    });
  });

  it('marks a manual category as having no basis, with a null change -- never a fabricated 0%/$0 comparison', () => {
    const view = buildLiveBudgetReportView([{
      category: 'Expenses:Staff:Pastoral Salary', classification: 'Expenses', plannedAmountCents: 8500000,
      basis: 'manual', growthPct: null, baseAmountCents: null, notes: '',
    }], 2027);
    expect(view.rows[0]).toMatchObject({ hasBasis: false, changeCents: null });
    expect(view.totals).toEqual({ plannedIncomeCents: 0, plannedExpenseCents: 8500000, plannedNetCents: -8500000 });
    expect(view.counts).toEqual({ categoryCount: 1, grownCount: 0, manualCount: 1 });
  });

  it('computes a real change for a grown category', () => {
    const view = buildLiveBudgetReportView([{
      category: 'Expenses:Program:Youth Ministry', classification: 'Expenses', plannedAmountCents: 1100000,
      basis: 'grown', growthPct: 0.1, baseAmountCents: 1000000, notes: '',
    }], 2027);
    expect(view.rows[0]).toMatchObject({ hasBasis: true, changeCents: 100000 });
    expect(view.counts).toEqual({ categoryCount: 1, grownCount: 1, manualCount: 0 });
  });

  it('handles a mix of manual and grown categories in the same plan without conflating them', () => {
    const view = buildLiveBudgetReportView([
      { category: 'Income:Offerings:General Fund', classification: 'Income', plannedAmountCents: 130000000, basis: 'manual', growthPct: null, baseAmountCents: null, notes: '' },
      { category: 'Expenses:Program:Youth Ministry', classification: 'Expenses', plannedAmountCents: 1100000, basis: 'grown', growthPct: 0.1, baseAmountCents: 1000000, notes: '' },
    ], 2027);
    expect(view.totals).toEqual({ plannedIncomeCents: 130000000, plannedExpenseCents: 1100000, plannedNetCents: 128900000 });
    expect(view.counts).toEqual({ categoryCount: 2, grownCount: 1, manualCount: 1 });
  });
});

describe('readSyntheticBudgetReport (unchanged synthetic fixture reader)', () => {
  it('still only reads synthetic_fixture rows', async () => {
    const result = await readSyntheticBudgetReport(fixtureDb());
    expect(result).toEqual(syntheticRows);
  });
});
