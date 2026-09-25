import { describe, it, expect } from 'vitest';
import { validateFinanceBalanceSheetTrendV1, acceptFinanceBalanceSheetTrendV1 } from '../contracts/validators/finance-balance-sheet-trend-consumer.js';

function validYear(overrides = {}) {
  return {
    fiscalYear: 2026, asOfDate: '2026-12-31',
    assetsCents: 30000000, liabilitiesCents: 10000000, equityCents: 20000000,
    netAssetsCents: 20000000, balancedCents: 0,
    ...overrides,
  };
}

function validPayload(overrides = {}) {
  return {
    contract: 'connect.finance-balance-sheet-trend.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    generatedAt: '2026-09-16T12:00:00Z',
    years: [
      validYear({ fiscalYear: 2025, asOfDate: 'FY2025', assetsCents: 27000000, liabilitiesCents: 11000000, equityCents: 16000000, netAssetsCents: 16000000 }),
      validYear(),
    ],
    reconciliation: { yearCount: 2, totalsMatch: true },
    ...overrides,
  };
}

describe('validateFinanceBalanceSheetTrendV1', () => {
  it('accepts a well-formed real-shaped payload', () => {
    const result = validateFinanceBalanceSheetTrendV1(validPayload());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('accepts an empty-years payload when nothing has been imported at all', () => {
    const payload = validPayload({ years: [], reconciliation: { yearCount: 0, totalsMatch: true } });
    expect(validateFinanceBalanceSheetTrendV1(payload).ok).toBe(true);
  });

  it('rejects a non-integer dollar field', () => {
    const payload = validPayload();
    payload.years[0].assetsCents = null;
    expect(validateFinanceBalanceSheetTrendV1(payload).ok).toBe(false);
  });

  it('rejects a fiscalYear outside the 4-digit range', () => {
    const payload = validPayload();
    payload.years[0].fiscalYear = 27;
    expect(validateFinanceBalanceSheetTrendV1(payload).ok).toBe(false);
  });

  it('rejects a non-string asOfDate', () => {
    const payload = validPayload();
    payload.years[0].asOfDate = null;
    expect(validateFinanceBalanceSheetTrendV1(payload).ok).toBe(false);
  });

  it('rejects a duplicate fiscalYear', () => {
    const payload = validPayload();
    payload.years.push(validYear());
    const result = validateFinanceBalanceSheetTrendV1(payload);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  it('rejects years out of ascending fiscalYear order', () => {
    const payload = validPayload();
    payload.years = [payload.years[1], payload.years[0]]; // 2026 then 2025 -- descending
    const result = validateFinanceBalanceSheetTrendV1(payload);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('ascending'))).toBe(true);
  });

  it('rejects netAssetsCents that does not equal equityCents -- the contract\'s own defined identity', () => {
    const payload = validPayload();
    payload.years[1].netAssetsCents = 1;
    const result = validateFinanceBalanceSheetTrendV1(payload);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('netAssetsCents must equal'))).toBe(true);
  });

  it('rejects balancedCents that does not equal assetsCents - (liabilitiesCents + equityCents)', () => {
    const payload = validPayload();
    payload.years[1].balancedCents = 999;
    expect(validateFinanceBalanceSheetTrendV1(payload).ok).toBe(false);
  });

  it('accepts a genuinely unbalanced year (balancedCents != 0) and requires totalsMatch to say so honestly', () => {
    const payload = validPayload({
      years: [validYear({ assetsCents: 100000, liabilitiesCents: 0, equityCents: 0, netAssetsCents: 0, balancedCents: 100000 })],
      reconciliation: { yearCount: 1, totalsMatch: false },
    });
    expect(validateFinanceBalanceSheetTrendV1(payload).ok).toBe(true);

    const mismatched = { ...payload, reconciliation: { ...payload.reconciliation, totalsMatch: true } };
    expect(validateFinanceBalanceSheetTrendV1(mismatched).ok).toBe(false);
  });

  it('rejects reconciliation.yearCount that does not match years.length', () => {
    const payload = validPayload();
    payload.reconciliation.yearCount = 99;
    expect(validateFinanceBalanceSheetTrendV1(payload).ok).toBe(false);
  });

  it('rejects a non-RFC3339 generatedAt', () => {
    const payload = validPayload();
    payload.generatedAt = 'not-a-date';
    expect(validateFinanceBalanceSheetTrendV1(payload).ok).toBe(false);
  });

  it('rejects an extra top-level field (closed shape)', () => {
    const payload = validPayload({ extra: 'nope' });
    expect(validateFinanceBalanceSheetTrendV1(payload).ok).toBe(false);
  });

  it('rejects an extra year field (closed shape)', () => {
    const payload = validPayload();
    payload.years[0].extra = 'nope';
    expect(validateFinanceBalanceSheetTrendV1(payload).ok).toBe(false);
  });

  it('rejects an extra reconciliation field (closed shape)', () => {
    const payload = validPayload();
    payload.reconciliation.extra = 'nope';
    expect(validateFinanceBalanceSheetTrendV1(payload).ok).toBe(false);
  });

  it('rejects the wrong contract string', () => {
    const payload = validPayload({ contract: 'connect.finance-balance-sheet.v1' });
    expect(validateFinanceBalanceSheetTrendV1(payload).ok).toBe(false);
  });
});

describe('acceptFinanceBalanceSheetTrendV1', () => {
  it('returns a detached copy of a valid payload', () => {
    const payload = validPayload();
    const accepted = acceptFinanceBalanceSheetTrendV1(payload);
    expect(accepted).toEqual(payload);
    expect(accepted).not.toBe(payload);
    expect(accepted.years).not.toBe(payload.years);
    expect(accepted.years[0]).not.toBe(payload.years[0]);
    expect(accepted.reconciliation).not.toBe(payload.reconciliation);
  });

  it('throws on an invalid payload rather than returning something malformed', () => {
    const payload = validPayload();
    delete payload.generatedAt;
    expect(() => acceptFinanceBalanceSheetTrendV1(payload)).toThrow(/Rejected connect\.finance-balance-sheet-trend\.v1/);
  });
});
