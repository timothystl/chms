import { describe, it, expect } from 'vitest';
import { fetchLiveFinancePropertyValuation, DEFAULT_LIVE_PROPERTY_KEY } from '../apps/finance/finance-property-valuation-client.js';

const VALID = {
  contract: 'connect.finance-property-valuation.v1',
  dataClassification: 'aggregate',
  sourceProduct: 'connect',
  consumerProduct: 'finance',
  currency: 'USD',
  propertyKey: 'ivanhoe',
  asOfDate: '2026-08-12',
  generatedAt: '2026-09-14T12:00:00Z',
  assumptions: { propertyKey: 'ivanhoe', utilityReimbursementCents: 0, vacancyRatePct: 0, managementFeePct: 0, capRate: 0.08 },
  rentRoll: [{ unitKey: 'a', tenantLabel: 'A', squareFeet: 100, annualRentCents: 120000 }],
  operatingCosts: [
    { costKey: 'utilities', costLabel: 'Utilities', annualCostCents: 0 },
    { costKey: 'trash', costLabel: 'Trash', annualCostCents: 0 },
    { costKey: 'maintenance_repairs', costLabel: 'Maintenance/Repairs', annualCostCents: 0 },
    { costKey: 'landscaping_snow', costLabel: 'Landscaping/Snow', annualCostCents: 0 },
    { costKey: 'legal', costLabel: 'Legal', annualCostCents: 0 },
    { costKey: 'taxes', costLabel: 'Taxes', annualCostCents: 0 },
    { costKey: 'insurance', costLabel: 'Insurance', annualCostCents: 0 },
  ],
  totals: {
    totalAnnualRentCents: 120000, grossRentalIncomeCents: 120000, vacancyCents: 0, effectiveRentalIncomeCents: 120000,
    itemizedOperatingCostsCents: 0, managementFeeCents: 0, totalOperatingCostsCents: 0, noiCents: 120000,
    capitalizedValueCents: Math.round(120000 / 0.08), reconciled: true,
  },
};

function envWith(fetchImpl) {
  return { CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

describe('DEFAULT_LIVE_PROPERTY_KEY', () => {
  it('is ivanhoe -- the only property tracked today', () => {
    expect(DEFAULT_LIVE_PROPERTY_KEY).toBe('ivanhoe');
  });
});

describe('fetchLiveFinancePropertyValuation', () => {
  it('is not_configured when the service binding is missing', async () => {
    const result = await fetchLiveFinancePropertyValuation({ FINANCE_CONTRACT_API_KEY: 'x' });
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('is not_configured when the shared secret is missing', async () => {
    const result = await fetchLiveFinancePropertyValuation({ CONNECT_SERVICE: { fetch: async () => new Response('{}') } });
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('sends the shared secret header and default property key, and accepts a valid response', async () => {
    let capturedRequest;
    const env = envWith(async (req) => {
      capturedRequest = req;
      return new Response(JSON.stringify(VALID), { status: 200 });
    });
    const result = await fetchLiveFinancePropertyValuation(env);
    expect(result.ok).toBe(true);
    expect(result.valuation.contract).toBe('connect.finance-property-valuation.v1');
    expect(result.valuation.rentRoll).toHaveLength(1);
    expect(capturedRequest.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(capturedRequest.url);
    expect(url.pathname).toBe('/api/contracts/finance-property-valuation-v1');
    expect(url.searchParams.get('property_key')).toBe('ivanhoe');
  });

  it('requests an explicitly passed property key', async () => {
    let capturedRequest;
    const env = envWith(async (req) => { capturedRequest = req; return new Response(JSON.stringify(VALID), { status: 200 }); });
    await fetchLiveFinancePropertyValuation(env, 'other-property');
    expect(new URL(capturedRequest.url).searchParams.get('property_key')).toBe('other-property');
  });

  it('fails closed, not throws, on a network error', async () => {
    const env = envWith(async () => { throw new Error('boom'); });
    const result = await fetchLiveFinancePropertyValuation(env);
    expect(result).toEqual({ ok: false, reason: 'network_error', detail: 'boom' });
  });

  it('fails closed on a non-200 response', async () => {
    const env = envWith(async () => new Response('nope', { status: 503 }));
    const result = await fetchLiveFinancePropertyValuation(env);
    expect(result).toEqual({ ok: false, reason: 'http_error', status: 503 });
  });

  it('fails closed on malformed JSON', async () => {
    const env = envWith(async () => new Response('not json', { status: 200 }));
    const result = await fetchLiveFinancePropertyValuation(env);
    expect(result).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('fails closed on a well-formed but contract-invalid payload -- never trusts the wire blindly', async () => {
    const env = envWith(async () => new Response(JSON.stringify({ contract: 'connect.finance-property-valuation.v1' }), { status: 200 }));
    const result = await fetchLiveFinancePropertyValuation(env);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('contract_validation_failed');
  });
});
