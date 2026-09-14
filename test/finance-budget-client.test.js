import { describe, it, expect } from 'vitest';
import { fetchLiveFinanceBudget, defaultLiveBudgetFiscalYear } from '../apps/finance/finance-budget-client.js';

const VALID = {
  contract: 'connect.finance-budget.v1',
  dataClassification: 'aggregate',
  sourceProduct: 'connect',
  consumerProduct: 'finance',
  currency: 'USD',
  fiscalYear: 2027,
  generatedAt: '2026-09-14T12:00:00Z',
  categories: [{
    category: 'Income:Offerings:General Fund', classification: 'Income', plannedAmountCents: 130000000,
    basis: 'manual', growthPct: null, baseAmountCents: null, notes: '',
  }],
  totals: { plannedIncomeCents: 130000000, plannedExpenseCents: 0, plannedNetCents: 130000000 },
  reconciliation: { categoryCount: 1, incomeCount: 1, expenseCount: 0, manualCount: 1, grownCount: 0, totalsMatch: true },
};

function envWith(fetchImpl) {
  return { CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

describe('defaultLiveBudgetFiscalYear', () => {
  it('is next calendar year', () => {
    expect(defaultLiveBudgetFiscalYear(new Date('2026-09-14T12:00:00Z'))).toBe(2027);
    expect(defaultLiveBudgetFiscalYear(new Date('2027-01-01T00:00:00Z'))).toBe(2028);
  });
});

describe('fetchLiveFinanceBudget', () => {
  it('is not_configured when the service binding is missing', async () => {
    const result = await fetchLiveFinanceBudget({ FINANCE_CONTRACT_API_KEY: 'x' }, 2027);
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('is not_configured when the shared secret is missing', async () => {
    const result = await fetchLiveFinanceBudget({ CONNECT_SERVICE: { fetch: async () => new Response('{}') } }, 2027);
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('sends the shared secret header and requested fiscal year, and accepts a valid response', async () => {
    let capturedRequest;
    const env = envWith(async (req) => {
      capturedRequest = req;
      return new Response(JSON.stringify(VALID), { status: 200 });
    });
    const result = await fetchLiveFinanceBudget(env, 2027);
    expect(result.ok).toBe(true);
    expect(result.budget.contract).toBe('connect.finance-budget.v1');
    expect(result.budget.categories).toHaveLength(1);
    expect(capturedRequest.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(capturedRequest.url);
    expect(url.pathname).toBe('/api/contracts/finance-budget-v1');
    expect(url.searchParams.get('fiscal_year')).toBe('2027');
  });

  it('fails closed, not throws, on a network error', async () => {
    const env = envWith(async () => { throw new Error('boom'); });
    const result = await fetchLiveFinanceBudget(env, 2027);
    expect(result).toEqual({ ok: false, reason: 'network_error', detail: 'boom' });
  });

  it('fails closed on a non-200 response', async () => {
    const env = envWith(async () => new Response('nope', { status: 503 }));
    const result = await fetchLiveFinanceBudget(env, 2027);
    expect(result).toEqual({ ok: false, reason: 'http_error', status: 503 });
  });

  it('fails closed on malformed JSON', async () => {
    const env = envWith(async () => new Response('not json', { status: 200 }));
    const result = await fetchLiveFinanceBudget(env, 2027);
    expect(result).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('fails closed on a well-formed but contract-invalid payload -- never trusts the wire blindly', async () => {
    const env = envWith(async () => new Response(JSON.stringify({ contract: 'connect.finance-budget.v1' }), { status: 200 }));
    const result = await fetchLiveFinanceBudget(env, 2027);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('contract_validation_failed');
  });
});
