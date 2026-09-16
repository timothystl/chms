import { describe, it, expect } from 'vitest';
import { fetchLiveFinanceBalanceSheetTrend } from '../apps/finance/finance-balance-sheet-trend-client.js';

const VALID = {
  contract: 'connect.finance-balance-sheet-trend.v1',
  dataClassification: 'aggregate',
  sourceProduct: 'connect',
  consumerProduct: 'finance',
  currency: 'USD',
  generatedAt: '2026-09-16T12:00:00Z',
  years: [{
    fiscalYear: 2026, asOfDate: '2026-12-31',
    assetsCents: 30000000, liabilitiesCents: 10000000, equityCents: 20000000,
    netAssetsCents: 20000000, balancedCents: 0,
  }],
  reconciliation: { yearCount: 1, totalsMatch: true },
};

function envWith(fetchImpl) {
  return { CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

describe('fetchLiveFinanceBalanceSheetTrend', () => {
  it('is not_configured when the service binding is missing', async () => {
    const result = await fetchLiveFinanceBalanceSheetTrend({ FINANCE_CONTRACT_API_KEY: 'x' });
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('is not_configured when the shared secret is missing', async () => {
    const result = await fetchLiveFinanceBalanceSheetTrend({ CONNECT_SERVICE: { fetch: async () => new Response('{}') } });
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('sends the shared secret header with no fiscal_year parameter, and accepts a valid response', async () => {
    let capturedRequest;
    const env = envWith(async (req) => {
      capturedRequest = req;
      return new Response(JSON.stringify(VALID), { status: 200 });
    });
    const result = await fetchLiveFinanceBalanceSheetTrend(env);
    expect(result.ok).toBe(true);
    expect(result.trend.contract).toBe('connect.finance-balance-sheet-trend.v1');
    expect(result.trend.years).toHaveLength(1);
    expect(capturedRequest.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(capturedRequest.url);
    expect(url.pathname).toBe('/api/contracts/finance-balance-sheet-trend-v1');
    expect(url.searchParams.has('fiscal_year')).toBe(false);
  });

  it('fails closed, not throws, on a network error', async () => {
    const env = envWith(async () => { throw new Error('boom'); });
    const result = await fetchLiveFinanceBalanceSheetTrend(env);
    expect(result).toEqual({ ok: false, reason: 'network_error', detail: 'boom' });
  });

  it('fails closed on a non-200 response', async () => {
    const env = envWith(async () => new Response('nope', { status: 503 }));
    const result = await fetchLiveFinanceBalanceSheetTrend(env);
    expect(result).toEqual({ ok: false, reason: 'http_error', status: 503 });
  });

  it('fails closed on malformed JSON', async () => {
    const env = envWith(async () => new Response('not json', { status: 200 }));
    const result = await fetchLiveFinanceBalanceSheetTrend(env);
    expect(result).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('fails closed on a well-formed but contract-invalid payload -- never trusts the wire blindly', async () => {
    const env = envWith(async () => new Response(JSON.stringify({ contract: 'connect.finance-balance-sheet-trend.v1' }), { status: 200 }));
    const result = await fetchLiveFinanceBalanceSheetTrend(env);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('contract_validation_failed');
  });
});
