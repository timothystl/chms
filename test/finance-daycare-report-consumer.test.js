import { describe, it, expect } from 'vitest';
import { validateFinanceDaycareReportV1, acceptFinanceDaycareReportV1 } from '../apps/finance/finance-daycare-consumer.js';

function validCategory(overrides = {}) {
  return { category: 'Tuition Income', classification: 'Income', actualCents: 40000000, budgetCents: 39000000, ...overrides };
}

function validAllocation(overrides = {}) {
  return {
    utilityPct: 0.5, insurancePct: 0.5, churchUtilityActualCents: 1200000, churchInsuranceActualCents: 500000,
    mdoUtilityCents: 600000, mdoInsuranceCents: 250000, ...overrides,
  };
}

function validPayload(overrides = {}) {
  return {
    contract: 'connect.finance-daycare-report.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    fiscalYear: 2026,
    generatedAt: '2026-09-14T12:00:00Z',
    categories: [
      validCategory(),
      validCategory({ category: 'Payroll', classification: 'Expenses', actualCents: 25000000, budgetCents: 24000000 }),
      validCategory({ category: 'Utilities', classification: 'Expenses', actualCents: 600000, budgetCents: 0 }),
      validCategory({ category: 'Insurance', classification: 'Expenses', actualCents: 250000, budgetCents: 0 }),
    ],
    allocation: validAllocation(),
    totals: {
      incomeActualCents: 40000000, incomeBudgetCents: 39000000,
      expenseActualCents: 25850000, expenseBudgetCents: 24000000,
      netActualCents: 14150000, netBudgetCents: 15000000,
    },
    reconciliation: { categoryCount: 4, incomeCategoryCount: 1, expenseCategoryCount: 3, totalsMatch: true },
    ...overrides,
  };
}

describe('validateFinanceDaycareReportV1', () => {
  it('accepts a well-formed real-shaped payload', () => {
    const result = validateFinanceDaycareReportV1(validPayload());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('accepts an empty-categories payload for a fiscal year nothing has been imported for', () => {
    const payload = validPayload({
      categories: [],
      totals: { incomeActualCents: 0, incomeBudgetCents: 0, expenseActualCents: 0, expenseBudgetCents: 0, netActualCents: 0, netBudgetCents: 0 },
      allocation: validAllocation({ churchUtilityActualCents: 0, churchInsuranceActualCents: 0, mdoUtilityCents: 0, mdoInsuranceCents: 0 }),
      reconciliation: { categoryCount: 0, incomeCategoryCount: 0, expenseCategoryCount: 0, totalsMatch: true },
    });
    expect(validateFinanceDaycareReportV1(payload).ok).toBe(true);
  });

  it('rejects an unrecognized category (closed set)', () => {
    const payload = validPayload();
    payload.categories[0].category = 'Mystery Fees';
    expect(validateFinanceDaycareReportV1(payload).ok).toBe(false);
  });

  it("rejects Tuition Income classified as Expenses, and any other category classified as Income", () => {
    const wrongIncome = validPayload();
    wrongIncome.categories[0].classification = 'Expenses';
    expect(validateFinanceDaycareReportV1(wrongIncome).ok).toBe(false);

    const wrongExpense = validPayload();
    wrongExpense.categories[1].classification = 'Income';
    expect(validateFinanceDaycareReportV1(wrongExpense).ok).toBe(false);
  });

  it('rejects a duplicate category', () => {
    const payload = validPayload();
    payload.categories.push(validCategory());
    const result = validateFinanceDaycareReportV1(payload);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  it('rejects a non-integer actualCents or budgetCents', () => {
    const payload = validPayload();
    payload.categories[0].actualCents = 12.5;
    expect(validateFinanceDaycareReportV1(payload).ok).toBe(false);
  });

  it('rejects an out-of-range utilityPct/insurancePct', () => {
    const payload = validPayload();
    payload.allocation.utilityPct = 1.5;
    expect(validateFinanceDaycareReportV1(payload).ok).toBe(false);
    payload.allocation.utilityPct = -0.1;
    expect(validateFinanceDaycareReportV1(payload).ok).toBe(false);
  });

  it('rejects mdoUtilityCents that is not the rounded percentage of churchUtilityActualCents', () => {
    const payload = validPayload();
    payload.allocation.mdoUtilityCents = 1;
    expect(validateFinanceDaycareReportV1(payload).ok).toBe(false);
  });

  it('rejects when a Utilities category actualCents disagrees with allocation.mdoUtilityCents', () => {
    const payload = validPayload();
    payload.categories.find((c) => c.category === 'Utilities').actualCents = 1;
    expect(validateFinanceDaycareReportV1(payload).ok).toBe(false);
  });

  it('rejects when totals.incomeActualCents does not match the summed Income categories', () => {
    const payload = validPayload();
    payload.totals.incomeActualCents = 1;
    expect(validateFinanceDaycareReportV1(payload).ok).toBe(false);
  });

  it('rejects when netActualCents is not incomeActualCents minus expenseActualCents', () => {
    const payload = validPayload();
    payload.totals.netActualCents = 999;
    expect(validateFinanceDaycareReportV1(payload).ok).toBe(false);
  });

  it('rejects reconciliation counts that do not match the categories array', () => {
    const payload = validPayload();
    payload.reconciliation.incomeCategoryCount = 99;
    expect(validateFinanceDaycareReportV1(payload).ok).toBe(false);
  });

  it('rejects an extra top-level field (closed shape)', () => {
    const payload = validPayload({ extra: 'nope' });
    expect(validateFinanceDaycareReportV1(payload).ok).toBe(false);
  });

  it('rejects an extra category field (closed shape)', () => {
    const payload = validPayload();
    payload.categories[0].extra = 'nope';
    expect(validateFinanceDaycareReportV1(payload).ok).toBe(false);
  });

  it('rejects an extra allocation field (closed shape)', () => {
    const payload = validPayload();
    payload.allocation.extra = 'nope';
    expect(validateFinanceDaycareReportV1(payload).ok).toBe(false);
  });
});

describe('acceptFinanceDaycareReportV1', () => {
  it('returns a detached copy of a valid payload', () => {
    const payload = validPayload();
    const accepted = acceptFinanceDaycareReportV1(payload);
    expect(accepted).toEqual(payload);
    expect(accepted).not.toBe(payload);
    expect(accepted.categories).not.toBe(payload.categories);
    expect(accepted.allocation).not.toBe(payload.allocation);
    expect(accepted.totals).not.toBe(payload.totals);
  });

  it('throws on an invalid payload rather than returning something malformed', () => {
    const payload = validPayload();
    delete payload.fiscalYear;
    expect(() => acceptFinanceDaycareReportV1(payload)).toThrow(/Rejected connect\.finance-daycare-report\.v1/);
  });
});
