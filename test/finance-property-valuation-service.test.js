import { describe, expect, it } from 'vitest';
import { resolvePropertyValuation, buildPropertyValuationView } from '../apps/finance/property-report-service.js';

function dbWith(assumptionRows, rentRollRows, opCostRows) {
  const calls = [];
  return {
    calls,
    prepare(sql) { return { sql }; },
    async batch(statements) {
      calls.push(statements.map((s) => s.sql));
      return [{ results: assumptionRows }, { results: rentRollRows }, { results: opCostRows }];
    },
  };
}

const SYNTHETIC_ASSUMPTIONS = [{ property_key: 'synthetic-property', utility_reimbursement_cents: 1000, vacancy_rate_pct: 0.05, management_fee_pct: 0.06, cap_rate: 0.08 }];
const SYNTHETIC_RENT_ROLL = [{ unit_key: 'unit-1', tenant_label: 'Synthetic Tenant', square_feet: 1000, annual_rent_cents: 120000 }];
const SYNTHETIC_OP_COSTS = [{ cost_key: 'utilities', cost_label: 'Utilities', annual_cost_cents: 5000 }];

const VALID_LIVE_PAYLOAD = {
  contract: 'connect.finance-property-valuation.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  propertyKey: 'ivanhoe', asOfDate: '2026-08-12', generatedAt: '2026-09-14T12:00:00Z',
  assumptions: { propertyKey: 'ivanhoe', utilityReimbursementCents: 0, vacancyRatePct: 0, managementFeePct: 0, capRate: 0.08 },
  rentRoll: [{ unitKey: 'apartment-1', tenantLabel: 'Apartment 1', squareFeet: 1500, annualRentCents: 1938000 }],
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
    totalAnnualRentCents: 1938000, grossRentalIncomeCents: 1938000, vacancyCents: 0, effectiveRentalIncomeCents: 1938000,
    itemizedOperatingCostsCents: 0, managementFeeCents: 0, totalOperatingCostsCents: 0, noiCents: 1938000,
    capitalizedValueCents: Math.round(1938000 / 0.08), reconciled: true,
  },
};

describe('resolvePropertyValuation (live connect.finance-property-valuation.v1 with synthetic fallback)', () => {
  it('falls back to the synthetic fixture when the live contract is not configured', async () => {
    const db = dbWith(SYNTHETIC_ASSUMPTIONS, SYNTHETIC_RENT_ROLL, SYNTHETIC_OP_COSTS);
    const result = await resolvePropertyValuation({}, db);
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('not_configured');
    expect(result.assumptions).toEqual(SYNTHETIC_ASSUMPTIONS[0]);
    expect(result.rentRoll).toEqual(SYNTHETIC_RENT_ROLL);
    expect(result.operatingCosts).toEqual(SYNTHETIC_OP_COSTS);
  });

  it('maps a live payload into the same snake_case shape the synthetic path returns', async () => {
    const env = {
      CONNECT_SERVICE: { async fetch() { return new Response(JSON.stringify(VALID_LIVE_PAYLOAD), { status: 200 }); } },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const db = dbWith(SYNTHETIC_ASSUMPTIONS, SYNTHETIC_RENT_ROLL, SYNTHETIC_OP_COSTS);
    const result = await resolvePropertyValuation(env, db);
    expect(result.source).toBe('live');
    expect(result.propertyKey).toBe('ivanhoe');
    expect(result.asOfDate).toBe('2026-08-12');
    expect(result.assumptions).toEqual({ property_key: 'ivanhoe', utility_reimbursement_cents: 0, vacancy_rate_pct: 0, management_fee_pct: 0, cap_rate: 0.08 });
    expect(result.rentRoll).toEqual([{ unit_key: 'apartment-1', tenant_label: 'Apartment 1', square_feet: 1500, annual_rent_cents: 1938000 }]);
    expect(result.operatingCosts).toHaveLength(7);
    expect(result.operatingCosts[0]).toEqual({ cost_key: 'utilities', cost_label: 'Utilities', annual_cost_cents: 0 });

    // The mapped shape must still drive buildPropertyValuationView identically to the synthetic
    // path -- same pure function, either source.
    const view = buildPropertyValuationView(result);
    expect(view.totals.capitalizedValueCents).toBe(Math.round(1938000 / 0.08));
  });

  it('falls back to the synthetic fixture, labeled with the failure reason, on a live contract-validation failure', async () => {
    const env = {
      CONNECT_SERVICE: { async fetch() { return new Response(JSON.stringify({ contract: 'connect.finance-property-valuation.v1' }), { status: 200 }); } },
      FINANCE_CONTRACT_API_KEY: 'test-secret',
    };
    const db = dbWith(SYNTHETIC_ASSUMPTIONS, SYNTHETIC_RENT_ROLL, SYNTHETIC_OP_COSTS);
    const result = await resolvePropertyValuation(env, db);
    expect(result.source).toBe('synthetic-fallback');
    expect(result.fallbackReason).toBe('contract_validation_failed');
  });
});
