import { describe, it, expect } from 'vitest';
import { validateFinanceChurchReportTrendV1, acceptFinanceChurchReportTrendV1 } from '../apps/finance/finance-church-report-trend-consumer.js';

function validYear(overrides = {}) {
  return {
    fiscalYear: 2026, incomeActualCents: 1300000, expenseActualCents: 900000,
    otherIncomeActualCents: 0, otherExpenseActualCents: 0, costOfGoodsSoldActualCents: 0,
    netIncomeActualCents: 400000, accountCount: 12,
    ...overrides,
  };
}

function validPayload(overrides = {}) {
  return {
    contract: 'connect.finance-church-report-trend.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    generatedAt: '2026-09-15T12:00:00Z',
    years: [validYear({ fiscalYear: 2025, incomeActualCents: 1000000, expenseActualCents: 800000, netIncomeActualCents: 200000 }), validYear()],
    reconciliation: { yearCount: 2, totalsMatch: true },
    ...overrides,
  };
}

describe('validateFinanceChurchReportTrendV1', () => {
  it('accepts a valid multi-year payload, including an empty-years payload', () => {
    expect(validateFinanceChurchReportTrendV1(validPayload())).toEqual({ ok: true, errors: [] });
    expect(validateFinanceChurchReportTrendV1(validPayload({ years: [], reconciliation: { yearCount: 0, totalsMatch: true } }))).toEqual({ ok: true, errors: [] });
  });

  it('rejects a wrong or missing root field', () => {
    expect(validateFinanceChurchReportTrendV1(validPayload({ contract: 'connect.finance-church-report.v1' })).ok).toBe(false);
    expect(validateFinanceChurchReportTrendV1(validPayload({ dataClassification: 'individual' })).ok).toBe(false);
    expect(validateFinanceChurchReportTrendV1(validPayload({ currency: 'EUR' })).ok).toBe(false);
    expect(validateFinanceChurchReportTrendV1(validPayload({ generatedAt: 'not-a-date' })).ok).toBe(false);
  });

  it('rejects an unknown root key (fail closed, no fiscal_year -- this contract takes no parameters)', () => {
    expect(validateFinanceChurchReportTrendV1(validPayload({ fiscalYear: 2026 })).ok).toBe(false);
    expect(validateFinanceChurchReportTrendV1(validPayload({ extra: 'nope' })).ok).toBe(false);
  });

  it('rejects a year row with an unknown or missing key', () => {
    const missingAccountCount = validYear();
    delete missingAccountCount.accountCount;
    expect(validateFinanceChurchReportTrendV1(validPayload({ years: [missingAccountCount] })).ok).toBe(false);
    expect(validateFinanceChurchReportTrendV1(validPayload({ years: [{ ...validYear(), extra: 'nope' }] })).ok).toBe(false);
  });

  it('rejects a non-integer cents field or a negative accountCount', () => {
    expect(validateFinanceChurchReportTrendV1(validPayload({ years: [validYear({ incomeActualCents: 1.5 })] })).ok).toBe(false);
    expect(validateFinanceChurchReportTrendV1(validPayload({ years: [validYear({ accountCount: -1 })] })).ok).toBe(false);
  });

  it('rejects a fiscalYear outside the valid 4-digit range', () => {
    expect(validateFinanceChurchReportTrendV1(validPayload({ years: [validYear({ fiscalYear: 99999 })] })).ok).toBe(false);
  });

  it('rejects a duplicate fiscalYear', () => {
    expect(validateFinanceChurchReportTrendV1(validPayload({ years: [validYear({ fiscalYear: 2026 }), validYear({ fiscalYear: 2026 })] })).ok).toBe(false);
  });

  it('rejects years out of ascending fiscal-year order', () => {
    const result = validateFinanceChurchReportTrendV1(validPayload({
      years: [validYear({ fiscalYear: 2026 }), validYear({ fiscalYear: 2025 })],
    }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('years must be ordered by ascending fiscalYear');
  });

  it('rejects netIncomeActualCents that does not reconcile with the other classification totals -- the exact cross-check that would have caught a naive income-minus-expense figure', () => {
    // incomeActualCents - expenseActualCents = 400000, but a real Other Expense means the true net
    // should be 350000. A naive figure sent on the wire must be rejected, not silently accepted.
    const result = validateFinanceChurchReportTrendV1(validPayload({
      years: [validYear({ otherExpenseActualCents: 50000, netIncomeActualCents: 400000 })],
    }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('netIncomeActualCents'))).toBe(true);
  });

  it('accepts a correctly reconciled netIncomeActualCents that folds in Cost of Goods Sold and Other Income/Expenses', () => {
    const result = validateFinanceChurchReportTrendV1(validPayload({
      years: [validYear({
        incomeActualCents: 100000, expenseActualCents: 40000, costOfGoodsSoldActualCents: 10000,
        otherIncomeActualCents: 5000, otherExpenseActualCents: 2000, netIncomeActualCents: 53000,
      })],
      reconciliation: { yearCount: 1, totalsMatch: true },
    }));
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a reconciliation.yearCount mismatch or a false totalsMatch', () => {
    expect(validateFinanceChurchReportTrendV1(validPayload({ reconciliation: { yearCount: 3, totalsMatch: true } })).ok).toBe(false);
    expect(validateFinanceChurchReportTrendV1(validPayload({ reconciliation: { yearCount: 2, totalsMatch: false } })).ok).toBe(false);
  });
});

describe('acceptFinanceChurchReportTrendV1', () => {
  it('throws on an invalid payload rather than returning a partially-trusted object', () => {
    expect(() => acceptFinanceChurchReportTrendV1({ contract: 'connect.finance-church-report-trend.v1' })).toThrow(/Rejected connect\.finance-church-report-trend\.v1/);
  });

  it('returns a detached deep copy of a valid payload', () => {
    const payload = validPayload();
    const accepted = acceptFinanceChurchReportTrendV1(payload);
    expect(accepted).toEqual(payload);
    expect(accepted).not.toBe(payload);
    expect(accepted.years).not.toBe(payload.years);
    expect(accepted.years[0]).not.toBe(payload.years[0]);
    expect(accepted.reconciliation).not.toBe(payload.reconciliation);
  });
});
