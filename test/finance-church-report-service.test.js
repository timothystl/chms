import { describe, expect, it } from 'vitest';
import {
  buildChurchReportView, readSyntheticChurchReport, readSyntheticChurchTrends,
  resolveChurchReport, resolveChurchTrend, buildLiveChurchReportView,
} from '../apps/finance/church-report-service.js';

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

describe('resolveChurchReport (live connect.finance-church-report.v1 with synthetic fallback)', () => {
  it('falls back to the synthetic fixture when the live contract is not configured', async () => {
    const result = await resolveChurchReport({}, dbWith(rows));
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('not_configured');
    expect(result.rows).toEqual(rows);
  });

  it('requests the current fiscal year and returns the live payload as-is (camelCase, not remapped)', async () => {
    let requestedUrl;
    const liveAccounts = [{
      classification: 'Income', categoryPath: 'Income:40000 Contributions', accountName: '40000 Contributions',
      depth: 0, hasChildren: false, actualCents: 1300000, budgetCents: null, source: 'import',
    }];
    const env = {
      CONNECT_SERVICE: {
        async fetch(req) {
          requestedUrl = new URL(req.url);
          return new Response(JSON.stringify({
            contract: 'connect.finance-church-report.v1', dataClassification: 'aggregate',
            sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
            fiscalYear: new Date().getUTCFullYear(), generatedAt: '2026-09-14T12:00:00Z',
            accounts: liveAccounts,
            totals: { incomeActualCents: 1300000, incomeBudgetCents: 0, expenseActualCents: 0, expenseBudgetCents: 0, netIncomeActualCents: 1300000, netIncomeBudgetCents: 0, hasBudgetData: false },
            reconciliation: { accountCount: 1, incomeCount: 1, expenseCount: 0, otherIncomeCount: 0, otherExpenseCount: 0, costOfGoodsSoldCount: 0, accountsWithBudgetCount: 0, totalsMatch: true },
          }), { status: 200 });
        },
      },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolveChurchReport(env, dbWith(rows));
    expect(result.source).toBe('live');
    expect(result.fiscalYear).toBe(new Date().getUTCFullYear());
    expect(requestedUrl.searchParams.get('fiscal_year')).toBe(String(new Date().getUTCFullYear()));
    expect(result.accounts).toEqual(liveAccounts);
  });

  it('falls back to the synthetic fixture, labeled with the failure reason, on a live contract-validation failure', async () => {
    const env = {
      CONNECT_SERVICE: { async fetch() { return new Response(JSON.stringify({ contract: 'connect.finance-church-report.v1' }), { status: 200 }); } },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolveChurchReport(env, dbWith(rows));
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('contract_validation_failed');
    expect(result.rows).toEqual(rows);
  });
});

describe('resolveChurchTrend (live connect.finance-church-report-trend.v1 with synthetic fallback)', () => {
  it('falls back to the synthetic fixture when the live contract is not configured', async () => {
    const result = await resolveChurchTrend({}, dbWith([
      { fiscal_year: 2025, income_cents: 11000000, expense_cents: 7800000 },
      { fiscal_year: 2026, income_cents: 12000000, expense_cents: 8000000 },
    ]));
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('not_configured');
    expect(result.rows).toEqual([
      { fiscal_year: 2025, income_cents: 11000000, expense_cents: 7800000, net_cents: 3200000 },
      { fiscal_year: 2026, income_cents: 12000000, expense_cents: 8000000, net_cents: 4000000 },
    ]);
  });

  it('sends no query parameters and returns the live payload\'s years as-is (camelCase, not remapped)', async () => {
    let requestedUrl;
    const liveYears = [{
      fiscalYear: 2026, incomeActualCents: 1300000, expenseActualCents: 900000,
      otherIncomeActualCents: 0, otherExpenseActualCents: 0, costOfGoodsSoldActualCents: 0,
      netIncomeActualCents: 400000, accountCount: 12,
    }];
    const env = {
      CONNECT_SERVICE: {
        async fetch(req) {
          requestedUrl = new URL(req.url);
          return new Response(JSON.stringify({
            contract: 'connect.finance-church-report-trend.v1', dataClassification: 'aggregate',
            sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
            generatedAt: '2026-09-15T12:00:00Z',
            years: liveYears,
            reconciliation: { yearCount: 1, totalsMatch: true },
          }), { status: 200 });
        },
      },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolveChurchTrend(env, dbWith(rows));
    expect(result.source).toBe('live');
    expect(result.years).toEqual(liveYears);
    expect(requestedUrl.pathname).toBe('/api/contracts/finance-church-report-trend-v1');
    expect(requestedUrl.search).toBe('');
  });

  it('falls back to the synthetic fixture, labeled with the failure reason, on a live contract-validation failure', async () => {
    const env = {
      CONNECT_SERVICE: { async fetch() { return new Response(JSON.stringify({ contract: 'connect.finance-church-report-trend.v1' }), { status: 200 }); } },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolveChurchTrend(env, dbWith([
      { fiscal_year: 2025, income_cents: 11000000, expense_cents: 7800000 },
      { fiscal_year: 2026, income_cents: 12000000, expense_cents: 8000000 },
    ]));
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('contract_validation_failed');
  });
});

describe('buildLiveChurchReportView', () => {
  it('requires a fiscal year', () => {
    expect(() => buildLiveChurchReportView([], undefined, {})).toThrow('Live Church Report requires a fiscal year');
  });

  it('groups accounts by classification and carries totals through untouched', () => {
    const accounts = [
      { classification: 'Income', categoryPath: 'Income:A', accountName: 'A', depth: 0, hasChildren: false, actualCents: 1300000, budgetCents: 1250000, source: 'import' },
      { classification: 'Expenses', categoryPath: 'Expenses:B', accountName: 'B', depth: 0, hasChildren: false, actualCents: 4200, budgetCents: null, source: 'import' },
    ];
    const totals = { incomeActualCents: 1300000, incomeBudgetCents: 1250000, expenseActualCents: 4200, expenseBudgetCents: 0, netIncomeActualCents: 1295800, netIncomeBudgetCents: 1250000, hasBudgetData: true };
    const view = buildLiveChurchReportView(accounts, 2026, totals);
    expect(view.fiscalYear).toBe(2026);
    expect(view.income).toEqual([accounts[0]]);
    expect(view.expenses).toEqual([accounts[1]]);
    expect(view.totals).toEqual({ incomeActualCents: 1300000, expenseActualCents: 4200, actualNetCents: 1295800, budgetNetCents: 1250000 });
    expect(view.hasBudgetData).toBe(true);
  });

  it('handles an empty-accounts fiscal year without dividing by zero or fabricating totals', () => {
    const totals = { incomeActualCents: 0, incomeBudgetCents: 0, expenseActualCents: 0, expenseBudgetCents: 0, netIncomeActualCents: 0, netIncomeBudgetCents: 0, hasBudgetData: false };
    const view = buildLiveChurchReportView([], 2030, totals);
    expect(view.income).toEqual([]);
    expect(view.expenses).toEqual([]);
    expect(view.totals).toEqual({ incomeActualCents: 0, expenseActualCents: 0, actualNetCents: 0, budgetNetCents: 0 });
  });
});
