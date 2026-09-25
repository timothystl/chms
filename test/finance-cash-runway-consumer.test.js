import { describe, expect, it } from 'vitest';
import { acceptFinanceCashRunwayV1, validateFinanceCashRunwayV1 } from '../contracts/validators/finance-cash-runway-consumer.js';

function valid() {
  return {
    contract: 'connect.finance-cash-runway.v1', dataClassification: 'aggregate', sourceProduct: 'connect',
    consumerProduct: 'finance', currency: 'USD', fiscalYear: 2026, generatedAt: '2026-09-25T12:00:00Z',
    available: true, onHandCents: 2400000, expensesYtdCents: 900000, monthsElapsed: 9,
    averageMonthlyExpenseCents: 100000, monthsOfCash: 24, policyFloorMonths: 3,
    floorCents: 300000, gapToFloorCents: 0, cashSource: 'balance_sheet',
    cashAccounts: ['11027 Lindell Checking'], asOfDate: '2026-09-01', daycareExcludedCents: 300000,
    allExpensesYtdCents: 1200000,
  };
}

describe('finance cash runway contract consumer', () => {
  it('accepts a reconciled aggregate payload and returns a detached copy', () => {
    const input = valid();
    expect(validateFinanceCashRunwayV1(input)).toEqual({ ok: true, errors: [] });
    const accepted = acceptFinanceCashRunwayV1(input);
    accepted.cashAccounts[0] = 'changed';
    expect(input.cashAccounts[0]).toBe('11027 Lindell Checking');
  });

  it('accepts an honest unavailable state', () => {
    const input = { ...valid(), available: false, onHandCents: null, monthsOfCash: null, floorCents: null, gapToFloorCents: null, cashSource: 'none', cashAccounts: [], asOfDate: '' };
    expect(validateFinanceCashRunwayV1(input).ok).toBe(true);
  });

  it('fails closed on extra fields, unreconciled expense splits, or missing available values', () => {
    expect(validateFinanceCashRunwayV1({ ...valid(), extra: true }).ok).toBe(false);
    expect(validateFinanceCashRunwayV1({ ...valid(), allExpensesYtdCents: 1 }).ok).toBe(false);
    expect(validateFinanceCashRunwayV1({ ...valid(), monthsOfCash: null }).ok).toBe(false);
  });
});
