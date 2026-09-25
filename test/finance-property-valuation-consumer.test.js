import { describe, it, expect } from 'vitest';
import { validateFinancePropertyValuationV1, acceptFinancePropertyValuationV1 } from '../contracts/validators/finance-property-valuation-consumer.js';

const VALID = {
  contract: 'connect.finance-property-valuation.v1',
  dataClassification: 'aggregate',
  sourceProduct: 'connect',
  consumerProduct: 'finance',
  currency: 'USD',
  propertyKey: 'ivanhoe',
  asOfDate: '2026-08-12',
  generatedAt: '2026-09-14T12:00:00Z',
  assumptions: {
    propertyKey: 'ivanhoe', utilityReimbursementCents: 100000, vacancyRatePct: 0.05, managementFeePct: 0.06, capRate: 0.08,
  },
  rentRoll: [
    { unitKey: 'apartment-1', tenantLabel: 'Apartment 1', squareFeet: 1500, annualRentCents: 1938000 },
    { unitKey: 'apartment-2', tenantLabel: 'Apartment 2', squareFeet: 1450, annualRentCents: 1499300 },
  ],
  operatingCosts: [
    { costKey: 'utilities', costLabel: 'Utilities', annualCostCents: 100000 },
    { costKey: 'trash', costLabel: 'Trash', annualCostCents: 20000 },
    { costKey: 'maintenance_repairs', costLabel: 'Maintenance/Repairs', annualCostCents: 30000 },
    { costKey: 'landscaping_snow', costLabel: 'Landscaping/Snow', annualCostCents: 10000 },
    { costKey: 'legal', costLabel: 'Legal', annualCostCents: 0 },
    { costKey: 'taxes', costLabel: 'Taxes', annualCostCents: 50000 },
    { costKey: 'insurance', costLabel: 'Insurance', annualCostCents: 40000 },
  ],
  totals: null, // filled in by buildValid() below
};

function buildValid() {
  const v = structuredClone(VALID);
  const totalAnnualRentCents = v.rentRoll.reduce((s, r) => s + r.annualRentCents, 0);
  const grossRentalIncomeCents = totalAnnualRentCents + v.assumptions.utilityReimbursementCents;
  const vacancyCents = Math.round(grossRentalIncomeCents * v.assumptions.vacancyRatePct);
  const effectiveRentalIncomeCents = grossRentalIncomeCents - vacancyCents;
  const itemizedOperatingCostsCents = v.operatingCosts.reduce((s, c) => s + c.annualCostCents, 0);
  const managementFeeCents = Math.round(effectiveRentalIncomeCents * v.assumptions.managementFeePct);
  const totalOperatingCostsCents = itemizedOperatingCostsCents + managementFeeCents;
  const noiCents = effectiveRentalIncomeCents - totalOperatingCostsCents;
  const capitalizedValueCents = Math.round(noiCents / v.assumptions.capRate);
  v.totals = {
    totalAnnualRentCents, grossRentalIncomeCents, vacancyCents, effectiveRentalIncomeCents,
    itemizedOperatingCostsCents, managementFeeCents, totalOperatingCostsCents, noiCents,
    capitalizedValueCents, reconciled: true,
  };
  return v;
}

describe('validateFinancePropertyValuationV1', () => {
  it('accepts a well-formed, reconciled contract', () => {
    const result = validateFinancePropertyValuationV1(buildValid());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown root field (closed shape)', () => {
    const v = buildValid();
    v.extra = 'nope';
    expect(validateFinancePropertyValuationV1(v).ok).toBe(false);
  });

  it('rejects a capRate of 0 or above 1', () => {
    for (const capRate of [0, 1.5, -0.1]) {
      const v = buildValid();
      v.assumptions.capRate = capRate;
      expect(validateFinancePropertyValuationV1(v).ok, String(capRate)).toBe(false);
    }
  });

  it('rejects an empty rent roll', () => {
    const v = buildValid();
    v.rentRoll = [];
    expect(validateFinancePropertyValuationV1(v).ok).toBe(false);
  });

  it('rejects a duplicate unitKey', () => {
    const v = buildValid();
    v.rentRoll.push({ ...v.rentRoll[0] });
    expect(validateFinancePropertyValuationV1(v).ok).toBe(false);
  });

  it('rejects operatingCosts missing a known cost key', () => {
    const v = buildValid();
    v.operatingCosts = v.operatingCosts.slice(0, 6);
    expect(validateFinancePropertyValuationV1(v).ok).toBe(false);
  });

  it('rejects an operatingCosts row with an unknown costKey', () => {
    const v = buildValid();
    v.operatingCosts[0] = { costKey: 'made_up', costLabel: 'Made Up', annualCostCents: 100 };
    expect(validateFinancePropertyValuationV1(v).ok).toBe(false);
  });

  it('rejects a costLabel that does not match its fixed costKey label', () => {
    const v = buildValid();
    v.operatingCosts[0].costLabel = 'Wrong Label';
    expect(validateFinancePropertyValuationV1(v).ok).toBe(false);
  });

  it('rejects totals that do not reconcile against rentRoll/operatingCosts/assumptions', () => {
    const v = buildValid();
    v.totals.noiCents += 1;
    expect(validateFinancePropertyValuationV1(v).ok).toBe(false);
  });

  it('rejects assumptions.propertyKey not matching the root propertyKey', () => {
    const v = buildValid();
    v.assumptions.propertyKey = 'other';
    expect(validateFinancePropertyValuationV1(v).ok).toBe(false);
  });
});

describe('acceptFinancePropertyValuationV1', () => {
  it('throws on an invalid payload', () => {
    expect(() => acceptFinancePropertyValuationV1({ contract: 'connect.finance-property-valuation.v1' })).toThrow();
  });

  it('returns a detached deep copy of a valid payload', () => {
    const v = buildValid();
    const accepted = acceptFinancePropertyValuationV1(v);
    expect(accepted).toEqual(v);
    accepted.rentRoll[0].annualRentCents = 0;
    expect(v.rentRoll[0].annualRentCents).not.toBe(0);
  });
});
