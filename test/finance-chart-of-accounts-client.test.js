import { describe, it, expect } from 'vitest';
import { fetchLiveFinanceChartOfAccounts } from '../apps/finance/finance-chart-of-accounts-client.js';

const VALID = {
  contract: 'connect.finance-chart-of-accounts.v1',
  dataClassification: 'structural',
  sourceProduct: 'connect',
  consumerProduct: 'finance',
  generatedAt: '2026-06-15T12:00:00Z',
  accounts: [{
    classification: 'Income', categoryPath: 'Income:Offerings:General Fund', accountName: 'General Fund',
    depth: 1, hasChildren: false, boardCategoryKey: 'donor', boardCategoryLabel: 'Donor',
    purposeTagId: null, purposeTagLabel: null,
  }],
  reconciliation: { accountCount: 1, incomeCount: 1, expenseCount: 0, unassignedCount: 0 },
};

function envWith(fetchImpl) {
  return { CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

describe('fetchLiveFinanceChartOfAccounts', () => {
  it('is not_configured when the service binding is missing', async () => {
    const result = await fetchLiveFinanceChartOfAccounts({ FINANCE_CONTRACT_API_KEY: 'x' });
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('is not_configured when the shared secret is missing', async () => {
    const result = await fetchLiveFinanceChartOfAccounts({ CONNECT_SERVICE: { fetch: async () => new Response('{}') } });
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('sends the shared secret header and accepts a valid response', async () => {
    let capturedRequest;
    const env = envWith(async (req) => {
      capturedRequest = req;
      return new Response(JSON.stringify(VALID), { status: 200 });
    });
    const result = await fetchLiveFinanceChartOfAccounts(env);
    expect(result.ok).toBe(true);
    expect(result.chartOfAccounts.contract).toBe('connect.finance-chart-of-accounts.v1');
    expect(result.chartOfAccounts.accounts).toHaveLength(1);
    expect(capturedRequest.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(capturedRequest.url);
    expect(url.pathname).toBe('/api/contracts/finance-chart-of-accounts-v1');
  });

  it('fails closed, not throws, on a network error', async () => {
    const env = envWith(async () => { throw new Error('boom'); });
    const result = await fetchLiveFinanceChartOfAccounts(env);
    expect(result).toEqual({ ok: false, reason: 'network_error', detail: 'boom' });
  });

  it('fails closed on a non-200 response', async () => {
    const env = envWith(async () => new Response('nope', { status: 503 }));
    const result = await fetchLiveFinanceChartOfAccounts(env);
    expect(result).toEqual({ ok: false, reason: 'http_error', status: 503 });
  });

  it('fails closed on malformed JSON', async () => {
    const env = envWith(async () => new Response('not json', { status: 200 }));
    const result = await fetchLiveFinanceChartOfAccounts(env);
    expect(result).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('fails closed on a well-formed but contract-invalid payload -- never trusts the wire blindly', async () => {
    const env = envWith(async () => new Response(JSON.stringify({ contract: 'connect.finance-chart-of-accounts.v1' }), { status: 200 }));
    const result = await fetchLiveFinanceChartOfAccounts(env);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('contract_validation_failed');
  });
});
