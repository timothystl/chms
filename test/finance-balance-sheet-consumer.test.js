import { describe, it, expect } from 'vitest';
import { validateFinanceBalanceSheetV1, acceptFinanceBalanceSheetV1 } from '../contracts/validators/finance-balance-sheet-consumer.js';

function validAccount(overrides = {}) {
  return {
    classification: 'Assets', categoryPath: 'Assets:11000 Cash', accountName: '11000 Cash',
    depth: 0, hasChildren: false, ownBalanceCents: 30000000,
    ...overrides,
  };
}

function validEquityReclass(overrides = {}) {
  return {
    donorRestrictedCents: 0, unrestrictedCents: 20000000, totalEquityCents: 20000000,
    breakdown: {
      perpetual: { label: 'Perpetual endowments', cents: 0 },
      purpose_time: { label: 'Purpose/time restricted', cents: 0 },
      designated: { label: 'Designated ministry/purpose funds', cents: 0 },
    },
    unclassified: [],
    ...overrides,
  };
}

function validPayload(overrides = {}) {
  return {
    contract: 'connect.finance-balance-sheet.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    fiscalYear: 2026,
    asOfDate: '2026-12-31',
    generatedAt: '2026-09-14T12:00:00Z',
    accounts: [
      validAccount(),
      validAccount({ classification: 'Liabilities', categoryPath: 'Liabilities:20000 Accounts Payable', accountName: '20000 Accounts Payable', ownBalanceCents: 10000000 }),
      validAccount({ classification: 'Equity', categoryPath: 'Equity:31000 Unrestricted Net Assets', accountName: '31000 Unrestricted Net Assets', ownBalanceCents: 20000000 }),
    ],
    totals: {
      assetsCents: 30000000, liabilitiesCents: 10000000, equityCents: 20000000,
      currentAssetsCents: 0, fixedAssetsCents: 0, otherAssetsCents: 30000000,
      liabilitiesPlusEquityCents: 30000000, balancedCents: 0,
    },
    equityReclass: validEquityReclass(),
    reconciliation: {
      accountCount: 3, assetsCount: 1, liabilitiesCount: 1, equityCount: 1, unclassifiedEquityCount: 0, totalsMatch: true,
    },
    ...overrides,
  };
}

describe('validateFinanceBalanceSheetV1', () => {
  it('accepts a well-formed real-shaped payload', () => {
    const result = validateFinanceBalanceSheetV1(validPayload());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('accepts an empty-accounts payload for a fiscal year with nothing imported yet', () => {
    const payload = validPayload({
      asOfDate: '',
      accounts: [],
      totals: { assetsCents: 0, liabilitiesCents: 0, equityCents: 0, currentAssetsCents: 0, fixedAssetsCents: 0, otherAssetsCents: 0, liabilitiesPlusEquityCents: 0, balancedCents: 0 },
      equityReclass: validEquityReclass({ unrestrictedCents: 0, totalEquityCents: 0 }),
      reconciliation: { accountCount: 0, assetsCount: 0, liabilitiesCount: 0, equityCount: 0, unclassifiedEquityCount: 0, totalsMatch: true },
    });
    expect(validateFinanceBalanceSheetV1(payload).ok).toBe(true);
  });

  it('rejects a non-integer ownBalanceCents -- this contract has no nullable dollar field at all', () => {
    const payload = validPayload();
    payload.accounts[0].ownBalanceCents = null;
    expect(validateFinanceBalanceSheetV1(payload).ok).toBe(false);
  });

  it('rejects an unrecognized classification', () => {
    const payload = validPayload();
    payload.accounts[0].classification = 'Income';
    const result = validateFinanceBalanceSheetV1(payload);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('classification'))).toBe(true);
  });

  it('rejects a duplicate categoryPath', () => {
    const payload = validPayload();
    payload.accounts.push(validAccount());
    const result = validateFinanceBalanceSheetV1(payload);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  it('rejects when totals.assetsCents does not match the summed Assets accounts', () => {
    const payload = validPayload();
    payload.totals.assetsCents = 1;
    expect(validateFinanceBalanceSheetV1(payload).ok).toBe(false);
  });

  it('does NOT exclude a hasChildren account when cross-checking totals -- production sums flatly (confirmed 2026-09-14: real has_children rows can carry a nonzero balance)', () => {
    const payload = validPayload({
      accounts: [
        validAccount({ categoryPath: 'Assets:Current Assets:11000 Cash', hasChildren: true, ownBalanceCents: 500000 }),
        validAccount({ categoryPath: 'Assets:Current Assets:11000 Cash:11030 Cash on hand', accountName: '11030 Cash on hand', depth: 1, ownBalanceCents: 2500 }),
      ],
      totals: { assetsCents: 502500, liabilitiesCents: 0, equityCents: 0, currentAssetsCents: 502500, fixedAssetsCents: 0, otherAssetsCents: 0, liabilitiesPlusEquityCents: 0, balancedCents: 502500 },
      equityReclass: validEquityReclass({ unrestrictedCents: 0, totalEquityCents: 0 }),
      reconciliation: { accountCount: 2, assetsCount: 2, liabilitiesCount: 0, equityCount: 0, unclassifiedEquityCount: 0, totalsMatch: true },
    });
    expect(validateFinanceBalanceSheetV1(payload).ok).toBe(true);
  });

  it('groups current/fixed/other Assets by the top-level category path segment', () => {
    const payload = validPayload({
      accounts: [
        validAccount({ categoryPath: 'Assets:Current Assets:11000 Cash', ownBalanceCents: 500000 }),
        validAccount({ categoryPath: 'Assets:Fixed Assets:15000 Building', accountName: '15000 Building', ownBalanceCents: 900000 }),
      ],
      totals: { assetsCents: 1400000, liabilitiesCents: 0, equityCents: 0, currentAssetsCents: 500000, fixedAssetsCents: 900000, otherAssetsCents: 0, liabilitiesPlusEquityCents: 0, balancedCents: 1400000 },
      equityReclass: validEquityReclass({ unrestrictedCents: 0, totalEquityCents: 0 }),
      reconciliation: { accountCount: 2, assetsCount: 2, liabilitiesCount: 0, equityCount: 0, unclassifiedEquityCount: 0, totalsMatch: true },
    });
    expect(validateFinanceBalanceSheetV1(payload).ok).toBe(true);
    const wrong = { ...payload, totals: { ...payload.totals, currentAssetsCents: 0, otherAssetsCents: 500000 } };
    expect(validateFinanceBalanceSheetV1(wrong).ok).toBe(false);
  });

  it('rejects when equityReclass.totalEquityCents does not equal totals.equityCents', () => {
    const payload = validPayload();
    payload.equityReclass.totalEquityCents = 1;
    expect(validateFinanceBalanceSheetV1(payload).ok).toBe(false);
  });

  it('rejects when donorRestrictedCents + unrestrictedCents does not equal totalEquityCents', () => {
    const payload = validPayload();
    payload.equityReclass.unrestrictedCents = 999;
    expect(validateFinanceBalanceSheetV1(payload).ok).toBe(false);
  });

  it('rejects when donorRestrictedCents does not equal the sum of every breakdown bucket', () => {
    const payload = validPayload();
    payload.equityReclass.breakdown.designated.cents = 100;
    payload.equityReclass.donorRestrictedCents = 0; // no longer matches 0 + 0 + 100
    // Keep the residual identity intact so only the breakdown-sum check can fail.
    payload.equityReclass.unrestrictedCents = payload.equityReclass.totalEquityCents;
    expect(validateFinanceBalanceSheetV1(payload).ok).toBe(false);
  });

  it('rejects a wrong breakdown label', () => {
    const payload = validPayload();
    payload.equityReclass.breakdown.perpetual.label = 'Wrong label';
    expect(validateFinanceBalanceSheetV1(payload).ok).toBe(false);
  });

  it('rejects a breakdown missing purpose_time (closed key set)', () => {
    const payload = validPayload();
    delete payload.equityReclass.breakdown.purpose_time;
    expect(validateFinanceBalanceSheetV1(payload).ok).toBe(false);
  });

  it('accepts a real unclassified account and requires reconciliation.unclassifiedEquityCount to match', () => {
    const payload = validPayload({
      accounts: [...validPayload().accounts, validAccount({ classification: 'Equity', categoryPath: 'Equity:34000 Some New Equity Line', accountName: '34000 Some New Equity Line', ownBalanceCents: 1000 })],
      totals: { assetsCents: 30000000, liabilitiesCents: 10000000, equityCents: 20001000, currentAssetsCents: 0, fixedAssetsCents: 0, otherAssetsCents: 30000000, liabilitiesPlusEquityCents: 30001000, balancedCents: -1000 },
      equityReclass: validEquityReclass({ unrestrictedCents: 20001000, totalEquityCents: 20001000, unclassified: [{ accountName: '34000 Some New Equity Line', categoryPath: 'Equity:34000 Some New Equity Line', ownBalanceCents: 1000 }] }),
      reconciliation: { accountCount: 4, assetsCount: 1, liabilitiesCount: 1, equityCount: 2, unclassifiedEquityCount: 1, totalsMatch: true },
    });
    expect(validateFinanceBalanceSheetV1(payload).ok).toBe(true);

    const mismatched = { ...payload, reconciliation: { ...payload.reconciliation, unclassifiedEquityCount: 0 } };
    expect(validateFinanceBalanceSheetV1(mismatched).ok).toBe(false);
  });

  it('rejects reconciliation counts that do not match the accounts array', () => {
    const payload = validPayload();
    payload.reconciliation.assetsCount = 99;
    expect(validateFinanceBalanceSheetV1(payload).ok).toBe(false);
  });

  it('rejects a non-string asOfDate', () => {
    const payload = validPayload();
    payload.asOfDate = null;
    expect(validateFinanceBalanceSheetV1(payload).ok).toBe(false);
  });

  it('rejects an extra top-level field (closed shape)', () => {
    const payload = validPayload({ extra: 'nope' });
    expect(validateFinanceBalanceSheetV1(payload).ok).toBe(false);
  });

  it('rejects an extra account field (closed shape)', () => {
    const payload = validPayload();
    payload.accounts[0].extra = 'nope';
    expect(validateFinanceBalanceSheetV1(payload).ok).toBe(false);
  });

  it('rejects an extra equityReclass field (closed shape)', () => {
    const payload = validPayload();
    payload.equityReclass.extra = 'nope';
    expect(validateFinanceBalanceSheetV1(payload).ok).toBe(false);
  });
});

describe('acceptFinanceBalanceSheetV1', () => {
  it('returns a detached copy of a valid payload', () => {
    const payload = validPayload();
    const accepted = acceptFinanceBalanceSheetV1(payload);
    expect(accepted).toEqual(payload);
    expect(accepted).not.toBe(payload);
    expect(accepted.accounts).not.toBe(payload.accounts);
    expect(accepted.totals).not.toBe(payload.totals);
    expect(accepted.equityReclass).not.toBe(payload.equityReclass);
    expect(accepted.equityReclass.breakdown).not.toBe(payload.equityReclass.breakdown);
    expect(accepted.equityReclass.unclassified).not.toBe(payload.equityReclass.unclassified);
  });

  it('throws on an invalid payload rather than returning something malformed', () => {
    const payload = validPayload();
    delete payload.fiscalYear;
    expect(() => acceptFinanceBalanceSheetV1(payload)).toThrow(/Rejected connect\.finance-balance-sheet\.v1/);
  });
});
