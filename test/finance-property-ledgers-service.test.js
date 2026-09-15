import { describe, it, expect } from 'vitest';
import { resolvePropertyLedgers } from '../apps/finance/property-report-service.js';

const VALID_LIVE_PAYLOAD = {
  contract: 'connect.finance-property-ledgers.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  propertyKey: 'ivanhoe', generatedAt: '2026-09-15T12:00:00Z',
  capital: [
    { entryDate: '', amountCents: 988700, payee: 'Unknown', description: 'Opening balance', checkRef: '', project: '1st-floor apartment renovation', sortOrder: 0 },
  ],
  repairs: [
    { entryDate: '2024-11', category: 'Roof', description: 'Roof leak', amountCents: null, payee: 'Innovative Roofing', capitalized: false },
  ],
  totals: { capitalCents: 988700, repairsCents: 0 },
};

describe('resolvePropertyLedgers (live connect.finance-property-ledgers.v1 with synthetic fallback)', () => {
  it('reports a synthetic-fallback source (with no rows of its own) when the live contract is not configured', async () => {
    const result = await resolvePropertyLedgers({});
    expect(result).toEqual({ source: 'synthetic-fallback', fallbackReason: 'not_configured' });
  });

  it('maps a live payload into the same snake_case shape renderPropertyCapitalRows/renderPropertyRepairRows expect', async () => {
    const env = {
      CONNECT_SERVICE: { async fetch() { return new Response(JSON.stringify(VALID_LIVE_PAYLOAD), { status: 200 }); } },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolvePropertyLedgers(env);
    expect(result.source).toBe('live');
    expect(result.capital).toEqual([
      { entry_date: '', amount_cents: 988700, payee: 'Unknown', description: 'Opening balance', project: '1st-floor apartment renovation' },
    ]);
    expect(result.repairs).toEqual([
      { entry_date: '2024-11', category: 'Roof', description: 'Roof leak', amount_cents: null, payee: 'Innovative Roofing', capitalized: 0 },
    ]);
    expect(result.totals).toEqual({ capital_cents: 988700, repairs_cents: 0 });
  });

  it('falls back, labeled with the failure reason, on a live contract-validation failure', async () => {
    const env = {
      CONNECT_SERVICE: { async fetch() { return new Response(JSON.stringify({ contract: 'connect.finance-property-ledgers.v1' }), { status: 200 }); } },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolvePropertyLedgers(env);
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('contract_validation_failed');
  });
});
