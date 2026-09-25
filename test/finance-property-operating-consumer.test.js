import { describe, it, expect } from 'vitest';
import { validateFinancePropertyOperatingV1, acceptFinancePropertyOperatingV1 } from '../contracts/validators/finance-property-operating-consumer.js';

function buildValid() {
  return {
    contract: 'connect.finance-property-operating.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    propertyKey: 'ivanhoe',
    generatedAt: '2026-09-15T12:00:00Z',
    periods: [
      {
        period: '2026-06', occupancyPct: 1, totalRevenueCents: 976527, totalExpensesCents: 446248,
        netIncomeCents: 530279, netOperatingIncomeCents: null, availableForDistributionCents: null,
        reserveBalanceCents: null, loanPaymentCents: 378303, interestExpenseCents: 95205, sourceReport: 'AHRA June 2026',
      },
      {
        period: '2026-01', occupancyPct: 1, totalRevenueCents: 932721, totalExpensesCents: null,
        netIncomeCents: 509994, netOperatingIncomeCents: null, availableForDistributionCents: null,
        reserveBalanceCents: null, loanPaymentCents: null, interestExpenseCents: null, sourceReport: '',
      },
    ],
    annualSummary: [
      { year: 2026, totalRevenueCents: 1909248, totalExpensesCents: 869494, netIncomeCents: 1040273, avgOccupancyPct: 1, confirmedDistributionsCents: 0, expenseMonthsDerived: 1, notes: '' },
    ],
  };
}

describe('validateFinancePropertyOperatingV1', () => {
  it('accepts a well-formed contract with nullable fields', () => {
    const result = validateFinancePropertyOperatingV1(buildValid());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('accepts an empty periods/annualSummary contract (a normal "nothing reported yet" state)', () => {
    const v = buildValid();
    v.periods = [];
    v.annualSummary = [];
    expect(validateFinancePropertyOperatingV1(v).ok).toBe(true);
  });

  it('rejects an unknown root field (closed shape)', () => {
    const v = buildValid();
    v.extra = 'nope';
    expect(validateFinancePropertyOperatingV1(v).ok).toBe(false);
  });

  it('rejects a duplicate period', () => {
    const v = buildValid();
    v.periods.push({ ...v.periods[0] });
    expect(validateFinancePropertyOperatingV1(v).ok).toBe(false);
  });

  it('rejects totalExpensesCents/netOperatingIncomeCents typed as anything but an integer or null', () => {
    const v = buildValid();
    v.periods[0].totalExpensesCents = '446248';
    expect(validateFinancePropertyOperatingV1(v).ok).toBe(false);
  });

  it('rejects a period that fails to reconcile when totalExpensesCents is present', () => {
    const v = buildValid();
    v.periods[0].netIncomeCents += 1;
    expect(validateFinancePropertyOperatingV1(v).ok).toBe(false);
  });

  it('does not require reconciliation when totalExpensesCents is null', () => {
    const v = buildValid();
    // periods[1] already has totalExpensesCents: null and an unrelated netIncomeCents -- still valid.
    expect(validateFinancePropertyOperatingV1(v).ok).toBe(true);
  });

  it('rejects occupancyPct outside a nonnegative number', () => {
    const v = buildValid();
    v.periods[0].occupancyPct = -0.1;
    expect(validateFinancePropertyOperatingV1(v).ok).toBe(false);
  });
});

describe('acceptFinancePropertyOperatingV1', () => {
  it('throws on an invalid payload', () => {
    expect(() => acceptFinancePropertyOperatingV1({ contract: 'connect.finance-property-operating.v1' })).toThrow();
  });

  it('returns a detached deep copy of a valid payload', () => {
    const v = buildValid();
    const accepted = acceptFinancePropertyOperatingV1(v);
    expect(accepted).toEqual(v);
    accepted.periods[0].netIncomeCents = 0;
    expect(v.periods[0].netIncomeCents).not.toBe(0);
  });
});
