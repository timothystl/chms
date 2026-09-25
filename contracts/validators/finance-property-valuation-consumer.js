// ── Fail-closed parser for connect.finance-property-valuation.v1 ───────────────────────────────
// Same shape/discipline as the other contract consumers in this directory: closed key sets (an
// unknown field anywhere fails closed), no I/O, and a pure validate/accept pair so producer
// (src/api-contracts.js) and consumer can never silently drift apart.
//
// Unlike Church Report/Balance Sheet (a time series or point-in-time snapshot per fiscal year),
// this is a single admin-maintained income-capitalization worksheet for one property: a rent
// roll, itemized operating costs, and a handful of assumptions (vacancy rate, management fee
// percentage, cap rate) that AHRA (the property manager) and Andrew update by hand as new
// numbers come in -- confirmed live against production on 2026-09-14: the stored worksheet's
// own `as_of_date` is 2026-08-12, newer than any date baked into this repository's own seed
// data, so it really is being kept current, not a frozen fixture.
//
// The source is `finance_settings` (key `finance_property_<property_key>_meta`, a JSON blob --
// see src/api-finance.js), NOT a dedicated relational table. This is the exact "Finance-owned
// JSON settings mixed into shared chms_config" situation AGENTS.md's Settled Operational Facts
// section already names. The producer reshapes that blob's `.valuation` object (rent_roll as
// {tenant, sqft, annual_rent_cents}; operating_costs as a fixed-key object) into the same
// unit_key/tenant_label/square_feet/annual_rent_cents and cost_key/cost_label/annual_cost_cents
// rows the staging fixture (apps/finance/migrations/0004_finance_property_valuation.sql) already
// uses, so this consumer -- and buildPropertyValuationView, which both the live and synthetic
// paths share -- never has to know which source produced its input.
//
// The seven operating-cost keys are closed and fixed (utilities, trash, maintenance_repairs,
// landscaping_snow, legal, taxes, insurance) -- exactly src/frontend/js-finance.js's own
// FIN_VAL_OP_COST_FIELDS, which is what production's real worksheet edit form and
// finComputePropertyValuation() both use. A worksheet missing one of these, or carrying an
// eighth, is a real configuration problem this contract should surface, not silently reshape.
const CONTRACT = 'connect.finance-property-valuation.v1';
const ROOT_KEYS = [
  'contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'currency',
  'propertyKey', 'asOfDate', 'generatedAt', 'assumptions', 'rentRoll', 'operatingCosts', 'totals',
];
const ASSUMPTIONS_KEYS = ['propertyKey', 'utilityReimbursementCents', 'vacancyRatePct', 'managementFeePct', 'capRate'];
const RENT_ROLL_KEYS = ['unitKey', 'tenantLabel', 'squareFeet', 'annualRentCents'];
const OPERATING_COST_KEYS = ['costKey', 'costLabel', 'annualCostCents'];
const TOTALS_KEYS = [
  'totalAnnualRentCents', 'grossRentalIncomeCents', 'vacancyCents', 'effectiveRentalIncomeCents',
  'itemizedOperatingCostsCents', 'managementFeeCents', 'totalOperatingCostsCents', 'noiCents',
  'capitalizedValueCents', 'reconciled',
];
// Mirrors src/frontend/js-finance.js's FIN_VAL_OP_COST_FIELDS exactly (field name minus its
// "_cents" suffix -> human label). Closed set: production's real worksheet has exactly these
// seven cost lines, no more, no fewer.
const KNOWN_COST_KEYS = {
  utilities: 'Utilities',
  trash: 'Trash',
  maintenance_repairs: 'Maintenance/Repairs',
  landscaping_snow: 'Landscaping/Snow',
  legal: 'Legal',
  taxes: 'Taxes',
  insurance: 'Insurance',
};

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

function isDateTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isUnitRatePct(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateRentRollRow(row, errors, index) {
  const label = `rentRoll[${index}]`;
  if (!hasExactKeys(row, RENT_ROLL_KEYS)) {
    errors.push(`${label} must contain exactly the rent roll fields`);
    return;
  }
  if (!isNonEmptyString(row.unitKey)) errors.push(`${label}.unitKey must be a non-empty string`);
  if (!isNonEmptyString(row.tenantLabel)) errors.push(`${label}.tenantLabel must be a non-empty string`);
  if (!Number.isInteger(row.squareFeet) || row.squareFeet < 0) errors.push(`${label}.squareFeet must be a nonnegative integer`);
  if (!Number.isInteger(row.annualRentCents) || row.annualRentCents < 0) errors.push(`${label}.annualRentCents must be nonnegative integer cents`);
}

function validateOperatingCostRow(row, errors, index) {
  const label = `operatingCosts[${index}]`;
  if (!hasExactKeys(row, OPERATING_COST_KEYS)) {
    errors.push(`${label} must contain exactly the operating cost fields`);
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(KNOWN_COST_KEYS, row.costKey)) {
    errors.push(`${label}.costKey must be one of the seven known operating-cost keys`);
  } else if (row.costLabel !== KNOWN_COST_KEYS[row.costKey]) {
    errors.push(`${label}.costLabel must be "${KNOWN_COST_KEYS[row.costKey]}" for costKey "${row.costKey}"`);
  }
  if (!Number.isInteger(row.annualCostCents) || row.annualCostCents < 0) errors.push(`${label}.annualCostCents must be nonnegative integer cents`);
}

export function validateFinancePropertyValuationV1(value) {
  const errors = [];
  if (!hasExactKeys(value, ROOT_KEYS)) {
    return { ok: false, errors: ['root must contain exactly the connect.finance-property-valuation.v1 fields'] };
  }
  if (value.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
  if (value.dataClassification !== 'aggregate') errors.push('dataClassification must be aggregate');
  if (value.sourceProduct !== 'connect') errors.push('sourceProduct must be connect');
  if (value.consumerProduct !== 'finance') errors.push('consumerProduct must be finance');
  if (value.currency !== 'USD') errors.push('currency must be USD');
  if (!isNonEmptyString(value.propertyKey)) errors.push('propertyKey must be a non-empty string');
  if (typeof value.asOfDate !== 'string') errors.push('asOfDate must be a string');
  if (!isDateTime(value.generatedAt)) errors.push('generatedAt must be an RFC 3339 UTC timestamp');

  let assumptionsValid = false;
  if (!hasExactKeys(value.assumptions, ASSUMPTIONS_KEYS)) {
    errors.push('assumptions must contain exactly the valuation assumption fields');
  } else {
    assumptionsValid = true;
    if (value.assumptions.propertyKey !== value.propertyKey) { errors.push('assumptions.propertyKey must equal the root propertyKey'); assumptionsValid = false; }
    if (!Number.isInteger(value.assumptions.utilityReimbursementCents) || value.assumptions.utilityReimbursementCents < 0) {
      errors.push('assumptions.utilityReimbursementCents must be nonnegative integer cents'); assumptionsValid = false;
    }
    if (!isUnitRatePct(value.assumptions.vacancyRatePct)) { errors.push('assumptions.vacancyRatePct must be a number between 0 and 1'); assumptionsValid = false; }
    if (!isUnitRatePct(value.assumptions.managementFeePct)) { errors.push('assumptions.managementFeePct must be a number between 0 and 1'); assumptionsValid = false; }
    if (!(typeof value.assumptions.capRate === 'number' && Number.isFinite(value.assumptions.capRate) && value.assumptions.capRate > 0 && value.assumptions.capRate <= 1)) {
      errors.push('assumptions.capRate must be a number greater than 0 and at most 1'); assumptionsValid = false;
    }
  }

  let rentRollValid = false;
  if (!Array.isArray(value.rentRoll) || value.rentRoll.length === 0) {
    errors.push('rentRoll must be a non-empty array');
  } else {
    rentRollValid = true;
    const seen = new Set();
    value.rentRoll.forEach((row, index) => {
      const before = errors.length;
      validateRentRollRow(row, errors, index);
      if (errors.length !== before) rentRollValid = false;
      if (isRecord(row) && typeof row.unitKey === 'string') {
        if (seen.has(row.unitKey)) { errors.push(`rentRoll[${index}] is a duplicate unitKey`); rentRollValid = false; }
        seen.add(row.unitKey);
      }
    });
  }

  let operatingCostsValid = false;
  if (!Array.isArray(value.operatingCosts) || value.operatingCosts.length !== Object.keys(KNOWN_COST_KEYS).length) {
    errors.push(`operatingCosts must be an array with exactly the ${Object.keys(KNOWN_COST_KEYS).length} known cost lines`);
  } else {
    operatingCostsValid = true;
    const seen = new Set();
    value.operatingCosts.forEach((row, index) => {
      const before = errors.length;
      validateOperatingCostRow(row, errors, index);
      if (errors.length !== before) operatingCostsValid = false;
      if (isRecord(row) && typeof row.costKey === 'string') {
        if (seen.has(row.costKey)) { errors.push(`operatingCosts[${index}] is a duplicate costKey`); operatingCostsValid = false; }
        seen.add(row.costKey);
      }
    });
    if (operatingCostsValid && seen.size !== Object.keys(KNOWN_COST_KEYS).length) {
      errors.push('operatingCosts must cover every known cost key exactly once');
      operatingCostsValid = false;
    }
  }

  let totalsValid = false;
  if (!hasExactKeys(value.totals, TOTALS_KEYS)) {
    errors.push('totals must contain exactly the valuation totals fields');
  } else {
    totalsValid = true;
    for (const key of TOTALS_KEYS.filter((k) => k !== 'reconciled')) {
      if (!Number.isInteger(value.totals[key])) { errors.push(`totals.${key} must be integer cents`); totalsValid = false; }
    }
    if (value.totals.reconciled !== true) { errors.push('totals.reconciled must be true'); totalsValid = false; }
  }

  // Cross-check: re-derive every total from rentRoll/operatingCosts/assumptions using the exact
  // same walk as production's own finComputePropertyValuation() (src/frontend/js-finance.js) --
  // Gross Rental Income = rent roll + utility reimbursement, less vacancy = Effective Rental
  // Income; Total Operating Costs = itemized costs + a management fee computed as a % of
  // Effective Rental Income; NOI = Effective Rental Income − Total Operating Costs; Capitalized
  // Value = NOI ÷ Cap Rate.
  if (assumptionsValid && rentRollValid && operatingCostsValid && totalsValid) {
    const totalAnnualRentCents = value.rentRoll.reduce((sum, r) => sum + r.annualRentCents, 0);
    const grossRentalIncomeCents = totalAnnualRentCents + value.assumptions.utilityReimbursementCents;
    const vacancyCents = Math.round(grossRentalIncomeCents * value.assumptions.vacancyRatePct);
    const effectiveRentalIncomeCents = grossRentalIncomeCents - vacancyCents;
    const itemizedOperatingCostsCents = value.operatingCosts.reduce((sum, c) => sum + c.annualCostCents, 0);
    const managementFeeCents = Math.round(effectiveRentalIncomeCents * value.assumptions.managementFeePct);
    const totalOperatingCostsCents = itemizedOperatingCostsCents + managementFeeCents;
    const noiCents = effectiveRentalIncomeCents - totalOperatingCostsCents;
    const capitalizedValueCents = Math.round(noiCents / value.assumptions.capRate);

    const expected = {
      totalAnnualRentCents, grossRentalIncomeCents, vacancyCents, effectiveRentalIncomeCents,
      itemizedOperatingCostsCents, managementFeeCents, totalOperatingCostsCents, noiCents, capitalizedValueCents,
    };
    for (const [key, want] of Object.entries(expected)) {
      if (value.totals[key] !== want) errors.push(`totals.${key} must equal the value re-derived from rentRoll/operatingCosts/assumptions`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function acceptFinancePropertyValuationV1(value) {
  const validation = validateFinancePropertyValuationV1(value);
  if (!validation.ok) throw new TypeError(`Rejected ${CONTRACT}: ${validation.errors.join('; ')}`);
  return {
    contract: value.contract,
    dataClassification: value.dataClassification,
    sourceProduct: value.sourceProduct,
    consumerProduct: value.consumerProduct,
    currency: value.currency,
    propertyKey: value.propertyKey,
    asOfDate: value.asOfDate,
    generatedAt: value.generatedAt,
    assumptions: { ...value.assumptions },
    rentRoll: value.rentRoll.map((row) => ({ ...row })),
    operatingCosts: value.operatingCosts.map((row) => ({ ...row })),
    totals: { ...value.totals },
  };
}
