import { describe, it, expect } from 'vitest';
import { resolvePropertyReport } from '../apps/finance/property-report-service.js';

const SYNTHETIC_ROWS = [{ property_key: 'synthetic-property', period: '2026-01', occupancy_pct: 90, total_revenue_cents: 2000000, total_expenses_cents: 1200000, net_income_cents: 800000, net_operating_income_cents: 900000, available_for_distribution_cents: 500000, reserve_balance_cents: 2500000 }];

const VALID_LIVE_PAYLOAD = {
  contract: 'connect.finance-property-operating.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  propertyKey: 'ivanhoe', generatedAt: '2026-09-15T12:00:00Z',
  periods: [
    { period: '2026-06', occupancyPct: 1, totalRevenueCents: 976527, totalExpensesCents: 446248, netIncomeCents: 530279, netOperatingIncomeCents: null, availableForDistributionCents: null, reserveBalanceCents: null, loanPaymentCents: null, interestExpenseCents: null, sourceReport: '' },
    { period: '2026-05', occupancyPct: 0.8892, totalRevenueCents: 927063, totalExpensesCents: null, netIncomeCents: 448614, netOperatingIncomeCents: null, availableForDistributionCents: null, reserveBalanceCents: null, loanPaymentCents: null, interestExpenseCents: null, sourceReport: '' },
  ],
  annualSummary: [],
};

describe('resolvePropertyReport (live connect.finance-property-operating.v1 with synthetic fallback)', () => {
  it('falls back to the caller\'s already-fetched synthetic rows when the live contract is not configured', async () => {
    const result = await resolvePropertyReport({}, SYNTHETIC_ROWS);
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('not_configured');
    expect(result.rows).toBe(SYNTHETIC_ROWS);
  });

  it('maps a live payload into the same snake_case shape renderPropertyRows expects, converting occupancy to a 0-100 scale', async () => {
    const env = {
      CONNECT_SERVICE: { async fetch() { return new Response(JSON.stringify(VALID_LIVE_PAYLOAD), { status: 200 }); } },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolvePropertyReport(env, SYNTHETIC_ROWS);
    expect(result.source).toBe('live');
    expect(result.rows).toHaveLength(2);
    // Real finding: production stores occupancy_pct as a 0-1 fraction; the live view builder
    // converts it to the 0-100 scale renderPropertyRows()/the synthetic fixture already use.
    expect(result.rows[0]).toEqual({
      property_key: 'ivanhoe', period: '2026-06', occupancy_pct: 100, total_revenue_cents: 976527,
      total_expenses_cents: 446248, net_income_cents: 530279, net_operating_income_cents: null,
      available_for_distribution_cents: null, reserve_balance_cents: null,
    });
    expect(result.rows[1].occupancy_pct).toBeCloseTo(88.92, 5);
    expect(result.rows[1].total_expenses_cents).toBeNull();
  });

  it('falls back, labeled with the failure reason, on a live contract-validation failure', async () => {
    const env = {
      CONNECT_SERVICE: { async fetch() { return new Response(JSON.stringify({ contract: 'connect.finance-property-operating.v1' }), { status: 200 }); } },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const result = await resolvePropertyReport(env, SYNTHETIC_ROWS);
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('contract_validation_failed');
    expect(result.rows).toBe(SYNTHETIC_ROWS);
  });
});
