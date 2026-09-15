import { describe, it, expect } from 'vitest';
import { resolvePropertyReserves } from '../apps/finance/property-report-service.js';

const VALID_LIVE_PAYLOAD = {
  contract: 'connect.finance-property-reserves.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  propertyKey: 'ivanhoe', generatedAt: '2026-09-15T12:00:00Z',
  reserves: [
    { reserveKey: 'property_tax', reportMonth: '2026-05', taxYear: 2026, targetEstimateCents: 1140000, reserveBeforeCents: 380000, contributionCents: 95000, reserveAfterCents: 475000, fundedPct: (475000 / 1140000) * 100, note: '' },
  ],
  reserveDisbursements: [
    { reserveKey: 'property_tax', periodKey: '2026', amountCents: null, paidViaReportMonth: '', note: 'Not yet paid.' },
  ],
  distributions: [
    { period: '2026-04', amountCents: 500000 },
  ],
};

describe('resolvePropertyReserves (live connect.finance-property-reserves.v1 with synthetic fallback)', () => {
  it('reports a synthetic-fallback source (with no rows of its own) when the live contract is not configured', async () => {
    const result = await resolvePropertyReserves({});
    expect(result).toEqual({ source: 'synthetic-fallback', fallbackReason: 'not_configured' });
  });

  it('maps a live payload into the same snake_case shape renderPropertyReserveRows/buildPropertyDistributionsView expect', async () => {
    const env = {
      CONNECT_SERVICE: { async fetch() { return new Response(JSON.stringify(VALID_LIVE_PAYLOAD), { status: 200 }); } },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolvePropertyReserves(env);
    expect(result.source).toBe('live');
    expect(result.rows).toEqual([
      { reserve_key: 'property_tax', report_month: '2026-05', tax_year: 2026, target_estimate_cents: 1140000, reserve_before_cents: 380000, contribution_cents: 95000, reserve_after_cents: 475000, funded_pct: (475000 / 1140000) * 100, note: '' },
    ]);
    expect(result.distributions).toEqual([{ period: '2026-04', amount_cents: 500000 }]);
  });

  it('falls back, labeled with the failure reason, on a live contract-validation failure', async () => {
    const env = {
      CONNECT_SERVICE: { async fetch() { return new Response(JSON.stringify({ contract: 'connect.finance-property-reserves.v1' }), { status: 200 }); } },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolvePropertyReserves(env);
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('contract_validation_failed');
  });
});
