import { describe, it, expect } from 'vitest';
import { validateFinancePropertyReservesV1, acceptFinancePropertyReservesV1 } from '../contracts/validators/finance-property-reserves-consumer.js';

function buildValid() {
  return {
    contract: 'connect.finance-property-reserves.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    propertyKey: 'ivanhoe',
    generatedAt: '2026-09-15T12:00:00Z',
    reserves: [
      { reserveKey: 'property_tax', reportMonth: '2026-05', taxYear: 2026, targetEstimateCents: 1140000, reserveBeforeCents: 380000, contributionCents: 95000, reserveAfterCents: 475000, fundedPct: (475000 / 1140000) * 100, note: '' },
    ],
    reserveDisbursements: [
      { reserveKey: 'property_tax', periodKey: '2025', amountCents: 1134964, paidViaReportMonth: '2025-11', note: 'Reserve applied against actual bill.' },
    ],
    distributions: [
      { period: '2026-04', amountCents: 500000 },
    ],
  };
}

describe('validateFinancePropertyReservesV1', () => {
  it('accepts a well-formed contract', () => {
    const result = validateFinancePropertyReservesV1(buildValid());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('accepts empty reserves/reserveDisbursements/distributions arrays', () => {
    const v = buildValid();
    v.reserves = [];
    v.reserveDisbursements = [];
    v.distributions = [];
    expect(validateFinancePropertyReservesV1(v).ok).toBe(true);
  });

  it('rejects an unknown root field (closed shape)', () => {
    const v = buildValid();
    v.extra = 'nope';
    expect(validateFinancePropertyReservesV1(v).ok).toBe(false);
  });

  it('tolerates 1 cent of reserve reconciliation rounding drift, confirmed against production\'s own real rows', () => {
    const v = buildValid();
    v.reserves[0].reserveAfterCents -= 1; // before + contribution - 1
    v.reserves[0].fundedPct = (v.reserves[0].reserveAfterCents / v.reserves[0].targetEstimateCents) * 100;
    expect(validateFinancePropertyReservesV1(v).ok).toBe(true);
  });

  it('rejects more than 1 cent of reserve reconciliation drift', () => {
    const v = buildValid();
    v.reserves[0].reserveAfterCents -= 2;
    expect(validateFinancePropertyReservesV1(v).ok).toBe(false);
  });

  it('rejects a fundedPct that does not match reserveAfterCents / targetEstimateCents * 100', () => {
    const v = buildValid();
    v.reserves[0].fundedPct = 999;
    expect(validateFinancePropertyReservesV1(v).ok).toBe(false);
  });

  it('accepts a null taxYear (a non-property_tax reserve bucket per migrations/0023\'s own comment)', () => {
    const v = buildValid();
    v.reserves[0].taxYear = null;
    expect(validateFinancePropertyReservesV1(v).ok).toBe(true);
  });

  it('accepts a null disbursement amountCents (a bill not yet paid)', () => {
    const v = buildValid();
    v.reserveDisbursements[0].amountCents = null;
    expect(validateFinancePropertyReservesV1(v).ok).toBe(true);
  });

  it('rejects a duplicate reserveKey/reportMonth pair', () => {
    const v = buildValid();
    v.reserves.push({ ...v.reserves[0] });
    expect(validateFinancePropertyReservesV1(v).ok).toBe(false);
  });

  it('rejects a reserveKey that is not lower_snake_case', () => {
    const v = buildValid();
    v.reserves[0].reserveKey = 'Property Tax';
    expect(validateFinancePropertyReservesV1(v).ok).toBe(false);
  });
});

describe('acceptFinancePropertyReservesV1', () => {
  it('throws on an invalid payload', () => {
    expect(() => acceptFinancePropertyReservesV1({ contract: 'connect.finance-property-reserves.v1' })).toThrow();
  });

  it('returns a detached deep copy of a valid payload', () => {
    const v = buildValid();
    const accepted = acceptFinancePropertyReservesV1(v);
    expect(accepted).toEqual(v);
    accepted.reserves[0].reserveAfterCents = 0;
    expect(v.reserves[0].reserveAfterCents).not.toBe(0);
  });
});
