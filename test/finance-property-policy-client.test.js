import { describe, expect, it } from 'vitest';
import { fetchFinancePropertyPolicy } from '../apps/finance/finance-property-policy-client.js';

const VALID = {
  contract: 'connect.finance-property-policy.v1', dataClassification: 'aggregate', sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  propertyKey: 'ivanhoe', generatedAt: '2026-09-26T00:00:00Z', reservePolicy: { baseMinimumCents: 450000 },
  capitalPolicy: { method: 'flat', annualAllowanceCents: 1200000, perSquareFootCents: null },
};

describe('Finance property policy client', () => {
  it('uses the narrow keyed contract and validates its response', async () => {
    let request;
    const result = await fetchFinancePropertyPolicy({ FINANCE_CONTRACT_API_KEY: 'secret', CONNECT_SERVICE: { async fetch(req) { request = req; return new Response(JSON.stringify(VALID)); } } });
    expect(result).toEqual({ ok: true, policy: VALID });
    expect(request.headers.get('X-Contract-Key')).toBe('secret');
    expect(new URL(request.url).searchParams.get('property_key')).toBe('ivanhoe');
  });

  it('fails closed for missing configuration, transport failure, and malformed data', async () => {
    expect(await fetchFinancePropertyPolicy({})).toEqual({ ok: false, reason: 'not_configured' });
    expect((await fetchFinancePropertyPolicy({ FINANCE_CONTRACT_API_KEY: 'x', CONNECT_SERVICE: { async fetch() { throw new Error('boom'); } } })).reason).toBe('network_error');
    expect((await fetchFinancePropertyPolicy({ FINANCE_CONTRACT_API_KEY: 'x', CONNECT_SERVICE: { async fetch() { return new Response('{}'); } } })).reason).toBe('contract_validation_failed');
  });
});
