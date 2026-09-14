import { describe, it, expect } from 'vitest';
import { fetchLiveFinanceBalanceSheet, defaultLiveBalanceSheetFiscalYear } from '../apps/finance/finance-balance-sheet-client.js';

const VALID = {
  contract: 'connect.finance-balance-sheet.v1',
  dataClassification: 'aggregate',
  sourceProduct: 'connect',
  consumerProduct: 'finance',
  currency: 'USD',
  fiscalYear: 2026,
  asOfDate: '2026-12-31',
  generatedAt: '2026-09-14T12:00:00Z',
  accounts: [{
    classification: 'Assets', categoryPath: 'Assets:11000 Cash', accountName: '11000 Cash',
    depth: 0, hasChildren: false, ownBalanceCents: 30000000,
  }],
  totals: {
    assetsCents: 30000000, liabilitiesCents: 0, equityCents: 0,
    currentAssetsCents: 0, fixedAssetsCents: 0, otherAssetsCents: 30000000,
    liabilitiesPlusEquityCents: 0, balancedCents: 30000000,
  },
  equityReclass: {
    donorRestrictedCents: 0, unrestrictedCents: 0, totalEquityCents: 0,
    breakdown: {
      perpetual: { label: 'Perpetual endowments', cents: 0 },
      purpose_time: { label: 'Purpose/time restricted', cents: 0 },
      designated: { label: 'Designated ministry/purpose funds', cents: 0 },
    },
    unclassified: [],
  },
  reconciliation: { accountCount: 1, assetsCount: 1, liabilitiesCount: 0, equityCount: 0, unclassifiedEquityCount: 0, totalsMatch: true },
};

function envWith(fetchImpl) {
  return { CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

describe('defaultLiveBalanceSheetFiscalYear', () => {
  it('is the current calendar year -- matching production\'s own "Position" default', () => {
    expect(defaultLiveBalanceSheetFiscalYear(new Date('2026-09-14T12:00:00Z'))).toBe(2026);
    expect(defaultLiveBalanceSheetFiscalYear(new Date('2027-01-01T00:00:00Z'))).toBe(2027);
  });
});

describe('fetchLiveFinanceBalanceSheet', () => {
  it('is not_configured when the service binding is missing', async () => {
    const result = await fetchLiveFinanceBalanceSheet({ FINANCE_CONTRACT_API_KEY: 'x' }, 2026);
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('is not_configured when the shared secret is missing', async () => {
    const result = await fetchLiveFinanceBalanceSheet({ CONNECT_SERVICE: { fetch: async () => new Response('{}') } }, 2026);
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('sends the shared secret header and requested fiscal year, and accepts a valid response', async () => {
    let capturedRequest;
    const env = envWith(async (req) => {
      capturedRequest = req;
      return new Response(JSON.stringify(VALID), { status: 200 });
    });
    const result = await fetchLiveFinanceBalanceSheet(env, 2026);
    expect(result.ok).toBe(true);
    expect(result.balanceSheet.contract).toBe('connect.finance-balance-sheet.v1');
    expect(result.balanceSheet.accounts).toHaveLength(1);
    expect(capturedRequest.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(capturedRequest.url);
    expect(url.pathname).toBe('/api/contracts/finance-balance-sheet-v1');
    expect(url.searchParams.get('fiscal_year')).toBe('2026');
  });

  it('fails closed, not throws, on a network error', async () => {
    const env = envWith(async () => { throw new Error('boom'); });
    const result = await fetchLiveFinanceBalanceSheet(env, 2026);
    expect(result).toEqual({ ok: false, reason: 'network_error', detail: 'boom' });
  });

  it('fails closed on a non-200 response', async () => {
    const env = envWith(async () => new Response('nope', { status: 503 }));
    const result = await fetchLiveFinanceBalanceSheet(env, 2026);
    expect(result).toEqual({ ok: false, reason: 'http_error', status: 503 });
  });

  it('fails closed on malformed JSON', async () => {
    const env = envWith(async () => new Response('not json', { status: 200 }));
    const result = await fetchLiveFinanceBalanceSheet(env, 2026);
    expect(result).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('fails closed on a well-formed but contract-invalid payload -- never trusts the wire blindly', async () => {
    const env = envWith(async () => new Response(JSON.stringify({ contract: 'connect.finance-balance-sheet.v1' }), { status: 200 }));
    const result = await fetchLiveFinanceBalanceSheet(env, 2026);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('contract_validation_failed');
  });
});
