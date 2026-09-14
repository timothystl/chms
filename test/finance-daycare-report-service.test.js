import { describe, expect, it } from 'vitest';
import {
  buildDaycareReportView, readSyntheticDaycareReport, readSyntheticDaycareAllocation,
  resolveDaycareReport, buildLiveDaycareReportView,
} from '../apps/finance/daycare-report-service.js';

const rows = [
  { period: '2026-01', category: 'Synthetic Tuition', entry_type: 'actual', amount_cents: 4000000 },
  { period: '2026-01', category: 'Synthetic Labor', entry_type: 'actual', amount_cents: 2500000 },
];

describe('Finance synthetic Daycare Report service', () => {
  it('runs one fixture-only SELECT and returns detached rows', async () => {
    const statements = [];
    const db = {
      prepare(sql) { statements.push(sql); return { sql }; },
      async batch() { return [{ results: rows }]; },
    };
    const result = await readSyntheticDaycareReport(db);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^SELECT\b/i);
    expect(statements[0]).toContain("source='synthetic_fixture'");
    expect(result).toEqual(rows);
    expect(result).not.toBe(rows);
  });

  it('classifies tuition, totals expenses, and calculates the operating result', () => {
    expect(buildDaycareReportView(rows)).toMatchObject({
      period: '2026-01',
      totals: {
        incomeActualCents: 4000000,
        expenseActualCents: 2500000,
        netActualCents: 1500000,
        netBudgetCents: 0,
      },
    });
  });

  it('fails closed on malformed rows and mixed periods', async () => {
    const db = {
      prepare(sql) { return { sql }; },
      async batch() { return [{ results: [{ ...rows[0], amount_cents: 2.5 }] }]; },
    };
    await expect(readSyntheticDaycareReport(db)).rejects.toThrow('Synthetic Daycare Report rows invalid');
    expect(() => buildDaycareReportView([rows[0], { ...rows[1], period: '2026-02' }])).toThrow('Synthetic Daycare Report period mismatch');
  });

  it('computes shared-cost allocations from bounded synthetic church inputs', async () => {
    const db = { prepare(sql) { return { sql }; }, async batch(statements) {
      expect(statements).toHaveLength(2);
      return [
        { results: [{ key: 'daycare_insurance_pct', value: '0.5' }, { key: 'daycare_utility_pct', value: '0.5' }] },
        { results: [{ account_name: 'Synthetic Insurance', own_actual_cents: 500000 }, { account_name: 'Synthetic Utilities', own_actual_cents: 1200000 }] },
      ];
    } };
    const allocation = await readSyntheticDaycareAllocation(db);
    expect(allocation).toEqual({ utility_pct: 0.5, insurance_pct: 0.5, utility_source_cents: 1200000, insurance_source_cents: 500000, utility_allocated_cents: 600000, insurance_allocated_cents: 250000 });
    expect(buildDaycareReportView(rows, allocation).totals).toMatchObject({ expenseActualCents: 3350000, netActualCents: 650000 });
  });

  it('fails closed on incomplete allocation inputs', async () => {
    const db = { prepare(sql) { return { sql }; }, async batch() { return [{ results: [] }, { results: [] }]; } };
    await expect(readSyntheticDaycareAllocation(db)).rejects.toThrow('Synthetic Daycare allocation inputs invalid');
  });
});

// A single fake DB that answers BOTH readSyntheticDaycareReport's one-statement batch and
// readSyntheticDaycareAllocation's two-statement batch, keyed by statement count -- resolveDaycareReport's
// synthetic-fallback path calls both.
function fallbackDb() {
  return {
    prepare(sql) { return { sql }; },
    async batch(statements) {
      if (statements.length === 1) return [{ results: rows }];
      return [
        { results: [{ key: 'daycare_insurance_pct', value: '0.5' }, { key: 'daycare_utility_pct', value: '0.5' }] },
        { results: [{ account_name: 'Synthetic Insurance', own_actual_cents: 500000 }, { account_name: 'Synthetic Utilities', own_actual_cents: 1200000 }] },
      ];
    },
  };
}

describe('resolveDaycareReport (live connect.finance-daycare-report.v1 with synthetic fallback)', () => {
  it('falls back to the synthetic fixture (rows + allocation) when the live contract is not configured', async () => {
    const result = await resolveDaycareReport({}, fallbackDb());
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('not_configured');
    expect(result.rows).toEqual(rows);
    expect(result.allocation).toEqual({
      utility_pct: 0.5, insurance_pct: 0.5, utility_source_cents: 1200000, insurance_source_cents: 500000,
      utility_allocated_cents: 600000, insurance_allocated_cents: 250000,
    });
  });

  it('requests the current fiscal year and returns the live payload as-is (camelCase, not remapped)', async () => {
    let requestedUrl;
    const liveCategories = [
      { category: 'Tuition Income', classification: 'Income', actualCents: 40000000, budgetCents: 39000000 },
      { category: 'Utilities', classification: 'Expenses', actualCents: 600000, budgetCents: 0 },
    ];
    const env = {
      CONNECT_SERVICE: {
        async fetch(req) {
          requestedUrl = new URL(req.url);
          return new Response(JSON.stringify({
            contract: 'connect.finance-daycare-report.v1', dataClassification: 'aggregate',
            sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
            fiscalYear: new Date().getUTCFullYear(), generatedAt: '2026-09-14T12:00:00Z',
            categories: liveCategories,
            allocation: { utilityPct: 0.5, insurancePct: 0.5, churchUtilityActualCents: 1200000, churchInsuranceActualCents: 500000, mdoUtilityCents: 600000, mdoInsuranceCents: 250000 },
            totals: { incomeActualCents: 40000000, incomeBudgetCents: 39000000, expenseActualCents: 600000, expenseBudgetCents: 0, netActualCents: 39400000, netBudgetCents: 39000000 },
            reconciliation: { categoryCount: 2, incomeCategoryCount: 1, expenseCategoryCount: 1, totalsMatch: true },
          }), { status: 200 });
        },
      },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolveDaycareReport(env, fallbackDb());
    expect(result.source).toBe('live');
    expect(result.fiscalYear).toBe(new Date().getUTCFullYear());
    expect(requestedUrl.searchParams.get('fiscal_year')).toBe(String(new Date().getUTCFullYear()));
    expect(result.categories).toEqual(liveCategories);
    expect(result.allocation).toEqual({ utilityPct: 0.5, insurancePct: 0.5, churchUtilityActualCents: 1200000, churchInsuranceActualCents: 500000, mdoUtilityCents: 600000, mdoInsuranceCents: 250000 });
  });

  it('falls back to the synthetic fixture, labeled with the failure reason, on a live contract-validation failure', async () => {
    const env = {
      CONNECT_SERVICE: { async fetch() { return new Response(JSON.stringify({ contract: 'connect.finance-daycare-report.v1' }), { status: 200 }); } },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolveDaycareReport(env, fallbackDb());
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('contract_validation_failed');
    expect(result.rows).toEqual(rows);
  });
});

describe('buildLiveDaycareReportView', () => {
  it('requires a fiscal year', () => {
    expect(() => buildLiveDaycareReportView([], undefined, {})).toThrow('Live Daycare Report requires a fiscal year');
  });

  it('carries categories and totals through untouched, deriving the period string', () => {
    const categories = [
      { category: 'Tuition Income', classification: 'Income', actualCents: 40000000, budgetCents: 39000000 },
      { category: 'Payroll', classification: 'Expenses', actualCents: 25000000, budgetCents: 24000000 },
    ];
    const totals = { incomeActualCents: 40000000, incomeBudgetCents: 39000000, expenseActualCents: 25000000, expenseBudgetCents: 24000000, netActualCents: 15000000, netBudgetCents: 15000000 };
    const view = buildLiveDaycareReportView(categories, 2026, totals);
    expect(view.period).toBe('2026');
    expect(view.categories).toEqual(categories);
    expect(view.totals).toEqual(totals);
  });
});
