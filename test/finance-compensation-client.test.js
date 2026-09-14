import { describe, it, expect } from 'vitest';
import { fetchLiveFinanceCompensation } from '../apps/finance/finance-compensation-client.js';

// Every name/dollar figure below is entirely fabricated for this test -- never a real production
// value.
const VALID = {
  contract: 'connect.finance-compensation.v1',
  dataClassification: 'aggregate',
  sourceProduct: 'connect',
  consumerProduct: 'finance',
  currency: 'USD',
  generatedAt: '2026-09-14T12:00:00Z',
  workers: [{
    name: 'Test Worker A', position: 'Fictional Director', accountCode: '', role: 'other',
    trackKey: '', education: 'bachelors', yearsExperience: 3, responsibilityStipend: 0,
    attendanceBonus: 0, selfEmployedFica: false, hasDependents: false, healthEnrolled: true,
    hideFromCouncil: false, currentPayCents: 5000000, currentPaySource: 'entered',
  }],
  totals: { workerCount: 1, enteredCurrentPayCount: 1, unenteredCurrentPayCount: 0, enteredCurrentPayCents: 5000000 },
  reconciliation: { workerCount: 1, totalsMatch: true },
};

function envWith(fetchImpl) {
  return { CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

describe('fetchLiveFinanceCompensation', () => {
  it('is not_configured when the service binding is missing', async () => {
    const result = await fetchLiveFinanceCompensation({ FINANCE_CONTRACT_API_KEY: 'x' });
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('is not_configured when the shared secret is missing', async () => {
    const result = await fetchLiveFinanceCompensation({ CONNECT_SERVICE: { fetch: async () => new Response('{}') } });
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('sends the shared secret header, requests no query parameters, and accepts a valid response', async () => {
    let capturedRequest;
    const env = envWith(async (req) => {
      capturedRequest = req;
      return new Response(JSON.stringify(VALID), { status: 200 });
    });
    const result = await fetchLiveFinanceCompensation(env);
    expect(result.ok).toBe(true);
    expect(result.compensation.contract).toBe('connect.finance-compensation.v1');
    expect(result.compensation.workers).toHaveLength(1);
    expect(capturedRequest.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(capturedRequest.url);
    expect(url.pathname).toBe('/api/contracts/finance-compensation-v1');
    expect(url.search).toBe('');
  });

  it('fails closed, not throws, on a network error', async () => {
    const env = envWith(async () => { throw new Error('boom'); });
    const result = await fetchLiveFinanceCompensation(env);
    expect(result).toEqual({ ok: false, reason: 'network_error', detail: 'boom' });
  });

  it('fails closed on a non-200 response', async () => {
    const env = envWith(async () => new Response('nope', { status: 503 }));
    const result = await fetchLiveFinanceCompensation(env);
    expect(result).toEqual({ ok: false, reason: 'http_error', status: 503 });
  });

  it('fails closed on malformed JSON', async () => {
    const env = envWith(async () => new Response('not json', { status: 200 }));
    const result = await fetchLiveFinanceCompensation(env);
    expect(result).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('fails closed on a well-formed but contract-invalid payload -- never trusts the wire blindly', async () => {
    const env = envWith(async () => new Response(JSON.stringify({ contract: 'connect.finance-compensation.v1' }), { status: 200 }));
    const result = await fetchLiveFinanceCompensation(env);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('contract_validation_failed');
  });
});
