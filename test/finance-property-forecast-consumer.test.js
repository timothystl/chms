import { describe, it, expect } from 'vitest';
import { validateFinancePropertyForecastV1, acceptFinancePropertyForecastV1 } from '../contracts/validators/finance-property-forecast-consumer.js';

function buildValid() {
  return {
    contract: 'connect.finance-property-forecast.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    propertyKey: 'ivanhoe',
    generatedAt: '2026-09-16T12:00:00Z',
    forecastYear: 2026,
    periods: [
      { period: '2026-01', revenueCents: 979775, expensesCents: 462704, netIncomeCents: 517071, reconciled: true, source: 'ahra_import' },
      { period: '2026-12', revenueCents: 979775, expensesCents: 1591671, netIncomeCents: -611896, reconciled: true, source: 'ahra_import' },
    ],
    totals: { revenueCents: 1959550, expensesCents: 2054375, netIncomeCents: -94825, reconciled: true },
  };
}

describe('validateFinancePropertyForecastV1', () => {
  it('accepts a well-formed contract', () => {
    const result = validateFinancePropertyForecastV1(buildValid());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('accepts an empty periods contract with a null forecastYear (a normal "nothing budgeted yet" state)', () => {
    const v = buildValid();
    v.periods = [];
    v.forecastYear = null;
    v.totals = { revenueCents: 0, expensesCents: 0, netIncomeCents: 0, reconciled: false };
    expect(validateFinancePropertyForecastV1(v).ok).toBe(true);
  });

  it('rejects an unknown root field (closed shape)', () => {
    const v = buildValid();
    v.extra = 'nope';
    expect(validateFinancePropertyForecastV1(v).ok).toBe(false);
  });

  it('rejects an unknown period field (closed shape)', () => {
    const v = buildValid();
    v.periods[0].extra = 'nope';
    expect(validateFinancePropertyForecastV1(v).ok).toBe(false);
  });

  it('rejects a duplicate period', () => {
    const v = buildValid();
    v.periods.push({ ...v.periods[0] });
    expect(validateFinancePropertyForecastV1(v).ok).toBe(false);
  });

  it('rejects forecastYear typed as anything but an integer or null', () => {
    const v = buildValid();
    v.forecastYear = '2026';
    expect(validateFinancePropertyForecastV1(v).ok).toBe(false);
  });

  it('rejects a forecastYear that does not correspond to any year present in periods', () => {
    const v = buildValid();
    v.forecastYear = 2099;
    expect(validateFinancePropertyForecastV1(v).ok).toBe(false);
  });

  it('rejects negative revenueCents/expensesCents', () => {
    const v = buildValid();
    v.periods[0].revenueCents = -1;
    expect(validateFinancePropertyForecastV1(v).ok).toBe(false);
  });

  it('accepts a genuinely negative netIncomeCents (real December finding: a large annual expense in one month)', () => {
    const v = buildValid();
    expect(v.periods[1].netIncomeCents).toBeLessThan(0);
    expect(validateFinancePropertyForecastV1(v).ok).toBe(true);
  });

  it('rejects a reconciled flag that does not match its own row\'s arithmetic', () => {
    const v = buildValid();
    v.periods[0].reconciled = false; // this row DOES reconcile -- the flag must say so
    expect(validateFinancePropertyForecastV1(v).ok).toBe(false);
  });

  it('accepts an honestly-flagged non-reconciling row (reconciled:false) rather than requiring exact reconciliation', () => {
    const v = buildValid();
    v.periods[0].netIncomeCents = 1; // now genuinely does not reconcile
    v.periods[0].reconciled = false; // ...and is flagged as such
    expect(validateFinancePropertyForecastV1(v).ok).toBe(true);
  });

  it('rejects an unknown totals field (closed shape)', () => {
    const v = buildValid();
    v.totals.extra = 'nope';
    expect(validateFinancePropertyForecastV1(v).ok).toBe(false);
  });
});

describe('acceptFinancePropertyForecastV1', () => {
  it('throws on an invalid payload', () => {
    expect(() => acceptFinancePropertyForecastV1({ contract: 'connect.finance-property-forecast.v1' })).toThrow();
  });

  it('returns a detached deep copy of a valid payload', () => {
    const v = buildValid();
    const accepted = acceptFinancePropertyForecastV1(v);
    expect(accepted).toEqual(v);
    accepted.periods[0].netIncomeCents = 0;
    accepted.totals.revenueCents = 0;
    expect(v.periods[0].netIncomeCents).not.toBe(0);
    expect(v.totals.revenueCents).not.toBe(0);
  });
});
