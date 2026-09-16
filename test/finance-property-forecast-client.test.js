import { describe, it, expect } from 'vitest';
import { fetchLiveFinancePropertyForecast } from '../apps/finance/finance-property-forecast-client.js';

const VALID = {
  contract: 'connect.finance-property-forecast.v1',
  dataClassification: 'aggregate',
  sourceProduct: 'connect',
  consumerProduct: 'finance',
  currency: 'USD',
  propertyKey: 'ivanhoe',
  generatedAt: '2026-09-16T12:00:00Z',
  forecastYear: 2026,
  periods: [
    { period: '2026-01', revenueCents: 100, expensesCents: 40, netIncomeCents: 60, reconciled: true, source: 'ahra_import' },
  ],
  totals: { revenueCents: 100, expensesCents: 40, netIncomeCents: 60, reconciled: true },
};

function envWith(fetchImpl) {
  return { CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

describe('fetchLiveFinancePropertyForecast', () => {
  it('is not_configured when the service binding is missing', async () => {
    const result = await fetchLiveFinancePropertyForecast({ FINANCE_CONTRACT_API_KEY: 'x' });
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('is not_configured when the shared secret is missing', async () => {
    const result = await fetchLiveFinancePropertyForecast({ CONNECT_SERVICE: { fetch: async () => new Response('{}') } });
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('sends the shared secret header and default property key, and accepts a valid response', async () => {
    let capturedRequest;
    const env = envWith(async (req) => { capturedRequest = req; return new Response(JSON.stringify(VALID), { status: 200 }); });
    const result = await fetchLiveFinancePropertyForecast(env);
    expect(result.ok).toBe(true);
    expect(result.forecast.periods).toHaveLength(1);
    expect(capturedRequest.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(capturedRequest.url);
    expect(url.pathname).toBe('/api/contracts/finance-property-forecast-v1');
    expect(url.searchParams.get('property_key')).toBe('ivanhoe');
  });

  it('requests an explicitly passed property key', async () => {
    let capturedRequest;
    const env = envWith(async (req) => { capturedRequest = req; return new Response(JSON.stringify(VALID), { status: 200 }); });
    await fetchLiveFinancePropertyForecast(env, 'other-property');
    expect(new URL(capturedRequest.url).searchParams.get('property_key')).toBe('other-property');
  });

  it('fails closed, not throws, on a network error', async () => {
    const env = envWith(async () => { throw new Error('boom'); });
    const result = await fetchLiveFinancePropertyForecast(env);
    expect(result).toEqual({ ok: false, reason: 'network_error', detail: 'boom' });
  });

  it('fails closed on a non-200 response', async () => {
    const env = envWith(async () => new Response('nope', { status: 503 }));
    const result = await fetchLiveFinancePropertyForecast(env);
    expect(result).toEqual({ ok: false, reason: 'http_error', status: 503 });
  });

  it('fails closed on malformed JSON', async () => {
    const env = envWith(async () => new Response('not json', { status: 200 }));
    const result = await fetchLiveFinancePropertyForecast(env);
    expect(result).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('fails closed on a well-formed but contract-invalid payload -- never trusts the wire blindly', async () => {
    const env = envWith(async () => new Response(JSON.stringify({ contract: 'connect.finance-property-forecast.v1' }), { status: 200 }));
    const result = await fetchLiveFinancePropertyForecast(env);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('contract_validation_failed');
  });
});
