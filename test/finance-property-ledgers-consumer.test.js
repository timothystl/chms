import { describe, it, expect } from 'vitest';
import { validateFinancePropertyLedgersV1, acceptFinancePropertyLedgersV1 } from '../contracts/validators/finance-property-ledgers-consumer.js';

function buildValid() {
  return {
    contract: 'connect.finance-property-ledgers.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    propertyKey: 'ivanhoe',
    generatedAt: '2026-09-15T12:00:00Z',
    capital: [
      { entryDate: '', amountCents: 988700, payee: 'Unknown (predates available reports)', description: 'Opening balance', checkRef: '', project: '1st-floor apartment renovation', sortOrder: 0 },
      { entryDate: '2024-10-07', amountCents: 540000, payee: 'Vail Contracting LLC', description: 'Contracting work', checkRef: 'Check #5088', project: '1st-floor apartment renovation', sortOrder: 1 },
    ],
    repairs: [
      { entryDate: '2024-11', category: 'Roof', description: 'Roof leak', amountCents: null, payee: 'Innovative Roofing', capitalized: false },
      { entryDate: '2024-09-11', category: 'Appliance', description: 'Appliance replacement', amountCents: 77598, payee: 'Slyman Bros', capitalized: false },
    ],
    totals: { capitalCents: 1528700, repairsCents: 77598 },
  };
}

describe('validateFinancePropertyLedgersV1', () => {
  it('accepts a well-formed contract with an empty entry date and a null repair amount', () => {
    const result = validateFinancePropertyLedgersV1(buildValid());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('accepts empty capital/repairs arrays', () => {
    const v = buildValid();
    v.capital = [];
    v.repairs = [];
    v.totals = { capitalCents: 0, repairsCents: 0 };
    expect(validateFinancePropertyLedgersV1(v).ok).toBe(true);
  });

  it('accepts an optional positive integer row id on capital and repairs rows', () => {
    const value = buildValid();
    value.capital[0].id = 1;
    value.repairs[1].id = 14;
    expect(validateFinancePropertyLedgersV1(value)).toEqual({ ok: true, errors: [] });
  });

  it('rejects a row id that is not a positive integer', () => {
    const value = buildValid();
    value.capital[0].id = 0;
    value.repairs[0].id = '3';
    const result = validateFinancePropertyLedgersV1(value);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('capital[0].id must be a positive integer when present');
    expect(result.errors).toContain('repairs[0].id must be a positive integer when present');
  });

  it('still rejects an unknown row field other than id', () => {
    const value = buildValid();
    value.repairs[0].vendorId = 9;
    expect(validateFinancePropertyLedgersV1(value).ok).toBe(false);
  });

  it('rejects an unknown root field (closed shape)', () => {
    const v = buildValid();
    v.extra = 'nope';
    expect(validateFinancePropertyLedgersV1(v).ok).toBe(false);
  });

  it('accepts a month-only (YYYY-MM) entry date, confirmed against production\'s own real repairs rows', () => {
    const v = buildValid();
    expect(v.repairs[0].entryDate).toBe('2024-11');
    expect(validateFinancePropertyLedgersV1(v).ok).toBe(true);
  });

  it('rejects an entry date that is not \'\', YYYY-MM, or YYYY-MM-DD', () => {
    const v = buildValid();
    v.capital[0].entryDate = '10/07/2024';
    expect(validateFinancePropertyLedgersV1(v).ok).toBe(false);
  });

  it('rejects totals that do not equal the sum of the ledgers\' own amountCents (nulls counted as 0)', () => {
    const v = buildValid();
    v.totals.repairsCents = 999;
    expect(validateFinancePropertyLedgersV1(v).ok).toBe(false);
  });

  it('rejects a capitalized value that is not a boolean', () => {
    const v = buildValid();
    v.repairs[0].capitalized = 1;
    expect(validateFinancePropertyLedgersV1(v).ok).toBe(false);
  });
});

describe('acceptFinancePropertyLedgersV1', () => {
  it('throws on an invalid payload', () => {
    expect(() => acceptFinancePropertyLedgersV1({ contract: 'connect.finance-property-ledgers.v1' })).toThrow();
  });

  it('returns a detached deep copy of a valid payload', () => {
    const v = buildValid();
    const accepted = acceptFinancePropertyLedgersV1(v);
    expect(accepted).toEqual(v);
    accepted.capital[0].amountCents = 0;
    expect(v.capital[0].amountCents).not.toBe(0);
  });
});
