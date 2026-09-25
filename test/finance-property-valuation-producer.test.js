import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildFinancePropertyValuationV1 } from '../src/api-contracts.js';
import { validateFinancePropertyValuationV1 } from '../contracts/validators/finance-property-valuation-consumer.js';

// finance_settings is migrations/0050, not part of migrations/0001_baseline.sql -- same reason
// Balance Sheet's producer test adds finance_church_balances as EXTRA_SCHEMA. Column-for-column
// identical to migrations/0050_finance_settings.sql's real CREATE TABLE.
const EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS finance_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_baseline.sql', import.meta.url), 'utf8'));
  sqlite.exec(EXTRA_SCHEMA);
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { sqlite.prepare(sql).run(...args); },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async run(...args) { sqlite.prepare(sql).run(...args); },
        async first(...args) { return sqlite.prepare(sql).get(...args); },
        async all(...args) { return { results: sqlite.prepare(sql).all(...args) }; },
      };
    },
    _raw: sqlite,
  };
}

// Column-for-column matches the real production shape confirmed live 2026-09-14 (12,462-byte
// value, valuation.as_of_date '2026-08-12', 4 rent_roll rows, cap_rate 0.08) -- see
// src/db.js's FINANCE_PROPERTY_IVANHOE_META for the same real figures this fixture mirrors.
function seedMeta(db, valuation) {
  db._raw.prepare(`INSERT INTO finance_settings (key, value) VALUES (?, ?)`).run(
    'finance_property_ivanhoe_meta',
    JSON.stringify({ valuation }),
  );
}

const REAL_SHAPED_VALUATION = {
  as_of_date: '2026-08-12',
  rent_roll: [
    { tenant: 'Apartment 1', sqft: 1500, annual_rent_cents: 1938000 },
    { tenant: 'Apartment 2', sqft: 1450, annual_rent_cents: 1499300 },
    { tenant: 'RJBJ - Crossfit', sqft: 3066, annual_rent_cents: 2759400 },
    { tenant: 'Magnatone', sqft: 7519, annual_rent_cents: 4082817 },
  ],
  utility_reimbursement_cents: 1626068,
  vacancy_rate_pct: 0,
  operating_costs: {
    utilities_cents: 1961363,
    trash_cents: 310668,
    maintenance_repairs_cents: 828700,
    landscaping_snow_cents: 400000,
    legal_cents: 0,
    taxes_cents: 1200000,
    insurance_cents: 1000000,
  },
  management_fee_pct: 0.06,
  cap_rate: 0.08,
};

describe('buildFinancePropertyValuationV1', () => {
  it('reflects a real-shaped worksheet and produces a valid, reconciled contract', async () => {
    const db = makeTestDb();
    seedMeta(db, REAL_SHAPED_VALUATION);
    const result = await buildFinancePropertyValuationV1(db, { propertyKey: 'ivanhoe', now: new Date('2026-09-14T12:00:00Z') });
    const validation = validateFinancePropertyValuationV1(result);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);

    expect(result.contract).toBe('connect.finance-property-valuation.v1');
    expect(result.propertyKey).toBe('ivanhoe');
    expect(result.asOfDate).toBe('2026-08-12');
    expect(result.assumptions).toEqual({
      propertyKey: 'ivanhoe', utilityReimbursementCents: 1626068, vacancyRatePct: 0, managementFeePct: 0.06, capRate: 0.08,
    });
    expect(result.rentRoll).toHaveLength(4);
    expect(result.rentRoll[0]).toEqual({ unitKey: 'apartment-1', tenantLabel: 'Apartment 1', squareFeet: 1500, annualRentCents: 1938000 });
    expect(result.rentRoll[2]).toMatchObject({ unitKey: 'rjbj-crossfit', tenantLabel: 'RJBJ - Crossfit' });
    expect(result.operatingCosts).toHaveLength(7);
    expect(result.operatingCosts.find((c) => c.costKey === 'maintenance_repairs')).toEqual({ costKey: 'maintenance_repairs', costLabel: 'Maintenance/Repairs', annualCostCents: 828700 });

    // Hand-computed reconciliation of the exact real figures above.
    const totalAnnualRentCents = 1938000 + 1499300 + 2759400 + 4082817;
    const grossRentalIncomeCents = totalAnnualRentCents + 1626068;
    const effectiveRentalIncomeCents = grossRentalIncomeCents; // 0% vacancy
    const itemizedOperatingCostsCents = 1961363 + 310668 + 828700 + 400000 + 0 + 1200000 + 1000000;
    const managementFeeCents = Math.round(effectiveRentalIncomeCents * 0.06);
    const totalOperatingCostsCents = itemizedOperatingCostsCents + managementFeeCents;
    const noiCents = effectiveRentalIncomeCents - totalOperatingCostsCents;
    const capitalizedValueCents = Math.round(noiCents / 0.08);
    expect(result.totals).toEqual({
      totalAnnualRentCents, grossRentalIncomeCents, vacancyCents: 0, effectiveRentalIncomeCents,
      itemizedOperatingCostsCents, managementFeeCents, totalOperatingCostsCents, noiCents,
      capitalizedValueCents, reconciled: true,
    });
  });

  it('de-duplicates unitKey when two tenants share the same slug', async () => {
    const db = makeTestDb();
    seedMeta(db, { ...REAL_SHAPED_VALUATION, rent_roll: [
      { tenant: 'Unit A', sqft: 100, annual_rent_cents: 1000 },
      { tenant: 'Unit A', sqft: 200, annual_rent_cents: 2000 },
    ] });
    const result = await buildFinancePropertyValuationV1(db, { propertyKey: 'ivanhoe', now: new Date('2026-09-14T12:00:00Z') });
    expect(validateFinancePropertyValuationV1(result).ok).toBe(true);
    expect(result.rentRoll.map((r) => r.unitKey)).toEqual(['unit-a', 'unit-a-2']);
  });

  it('fails contract validation (fail closed) for a property with no configured worksheet at all', async () => {
    const db = makeTestDb();
    const result = await buildFinancePropertyValuationV1(db, { propertyKey: 'nonexistent', now: new Date('2026-09-14T12:00:00Z') });
    const validation = validateFinancePropertyValuationV1(result);
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes('rentRoll'))).toBe(true);
  });

  it('fails contract validation for a worksheet missing a cap rate', async () => {
    const db = makeTestDb();
    seedMeta(db, { ...REAL_SHAPED_VALUATION, cap_rate: 0 });
    const result = await buildFinancePropertyValuationV1(db, { propertyKey: 'ivanhoe', now: new Date('2026-09-14T12:00:00Z') });
    const validation = validateFinancePropertyValuationV1(result);
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((e) => e.includes('capRate'))).toBe(true);
  });

  it('does not leak a different property\'s worksheet into this property\'s contract', async () => {
    const db = makeTestDb();
    seedMeta(db, REAL_SHAPED_VALUATION);
    db._raw.prepare(`INSERT INTO finance_settings (key, value) VALUES (?, ?)`).run(
      'finance_property_other_meta',
      JSON.stringify({ valuation: { ...REAL_SHAPED_VALUATION, rent_roll: [{ tenant: 'Someone Else', sqft: 1, annual_rent_cents: 999999999 }] } }),
    );
    const result = await buildFinancePropertyValuationV1(db, { propertyKey: 'ivanhoe', now: new Date('2026-09-14T12:00:00Z') });
    expect(result.rentRoll).toHaveLength(4);
    expect(result.rentRoll.some((r) => r.tenantLabel === 'Someone Else')).toBe(false);
  });
});
