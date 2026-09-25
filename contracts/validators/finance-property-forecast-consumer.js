// ── Fail-closed parser for connect.finance-property-forecast.v1 ────────────────────────────────
// Same shape/discipline as the other contract consumers in this directory: closed key sets (an
// unknown field anywhere fails closed), no I/O, and a pure validate/accept pair so producer
// (src/api-contracts.js) and consumer can never silently drift apart.
//
// This is a straight port of finance_property_budget_monthly -- a real monthly BUDGET/plan for
// the Commercial Property, populated by production's own already-shipped AHRA Budget Detail
// Excel import (source='ahra_import') -- not a computed run-rate projection, despite the staging
// page's "Run-rate forecast" label. See src/api-contracts.js's buildFinancePropertyForecastV1
// header comment for the full real-data findings.
//
// Real findings confirmed against production tlc-volunteer-db on 2026-09-16: only 'ivanhoe' has
// rows, exactly one year (2026, the CURRENT fiscal year, not a future one) has all 12 months on
// file, and every one of those 12 rows reconciles exactly with no nulls (the columns are
// schema-level NOT NULL). Nothing in the schema itself guarantees that reconciliation holds for a
// future import, though, so this consumer carries a `reconciled` flag per period (cross-checked
// against the row's own arithmetic) rather than hard-rejecting a non-reconciling row the way the
// synthetic fixture's own reader (readSyntheticPropertyForecast) throws on one. `forecastYear` is
// genuinely nullable -- a property with no complete 12-month year on file yet is a normal,
// unremarkable state, not an error.
const CONTRACT = 'connect.finance-property-forecast.v1';
const ROOT_KEYS = [
  'contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'currency',
  'propertyKey', 'generatedAt', 'forecastYear', 'periods', 'totals',
];
const PERIOD_KEYS = ['period', 'revenueCents', 'expensesCents', 'netIncomeCents', 'reconciled', 'source'];
const TOTALS_KEYS = ['revenueCents', 'expensesCents', 'netIncomeCents', 'reconciled'];

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

function isPeriodStr(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value);
}

function validatePeriodRow(row, errors, index) {
  const label = `periods[${index}]`;
  if (!hasExactKeys(row, PERIOD_KEYS)) {
    errors.push(`${label} must contain exactly the period fields`);
    return;
  }
  if (!isPeriodStr(row.period)) errors.push(`${label}.period must be YYYY-MM`);
  if (!Number.isInteger(row.revenueCents) || row.revenueCents < 0) errors.push(`${label}.revenueCents must be nonnegative integer cents`);
  if (!Number.isInteger(row.expensesCents) || row.expensesCents < 0) errors.push(`${label}.expensesCents must be nonnegative integer cents`);
  // netIncomeCents is NOT constrained to be nonnegative -- real production data has at least one
  // month (December, a large annual expense landing in one period) with a genuinely negative net
  // income even though revenue/expenses are each nonnegative.
  if (!Number.isInteger(row.netIncomeCents)) errors.push(`${label}.netIncomeCents must be integer cents`);
  if (typeof row.reconciled !== 'boolean') errors.push(`${label}.reconciled must be a boolean`);
  else if (Number.isInteger(row.revenueCents) && Number.isInteger(row.expensesCents) && Number.isInteger(row.netIncomeCents)
    && row.reconciled !== (row.netIncomeCents === row.revenueCents - row.expensesCents)) {
    errors.push(`${label}.reconciled must match netIncomeCents === revenueCents - expensesCents`);
  }
  if (typeof row.source !== 'string') errors.push(`${label}.source must be a string`);
}

function validateTotals(totals, errors) {
  if (!hasExactKeys(totals, TOTALS_KEYS)) {
    errors.push('totals must contain exactly the totals fields');
    return;
  }
  if (!Number.isInteger(totals.revenueCents)) errors.push('totals.revenueCents must be integer cents');
  if (!Number.isInteger(totals.expensesCents)) errors.push('totals.expensesCents must be integer cents');
  if (!Number.isInteger(totals.netIncomeCents)) errors.push('totals.netIncomeCents must be integer cents');
  if (typeof totals.reconciled !== 'boolean') errors.push('totals.reconciled must be a boolean');
}

export function validateFinancePropertyForecastV1(value) {
  const errors = [];
  if (!hasExactKeys(value, ROOT_KEYS)) {
    return { ok: false, errors: ['root must contain exactly the connect.finance-property-forecast.v1 fields'] };
  }
  if (value.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
  if (value.dataClassification !== 'aggregate') errors.push('dataClassification must be aggregate');
  if (value.sourceProduct !== 'connect') errors.push('sourceProduct must be connect');
  if (value.consumerProduct !== 'finance') errors.push('consumerProduct must be finance');
  if (value.currency !== 'USD') errors.push('currency must be USD');
  if (!isNonEmptyString(value.propertyKey)) errors.push('propertyKey must be a non-empty string');
  if (!isDateTime(value.generatedAt)) errors.push('generatedAt must be an RFC 3339 UTC timestamp');

  // A property with no complete 12-month year on file yet is a normal, unremarkable state.
  if (!(value.forecastYear === null || Number.isInteger(value.forecastYear))) {
    errors.push('forecastYear must be an integer or null');
  }

  // Empty is a normal, valid "nothing budgeted yet" state -- same convention as Budget/Church
  // Report/Balance Sheet/Daycare Report's own empty-fiscal-year contracts.
  const years = new Set();
  if (!Array.isArray(value.periods)) {
    errors.push('periods must be an array');
  } else {
    const seen = new Set();
    value.periods.forEach((row, index) => {
      validatePeriodRow(row, errors, index);
      if (isRecord(row) && typeof row.period === 'string') {
        if (seen.has(row.period)) errors.push(`periods[${index}] is a duplicate period`);
        seen.add(row.period);
        years.add(row.period.slice(0, 4));
      }
    });
  }

  // forecastYear, when present, must actually be one of the years periods carries -- a
  // cross-check that would catch a producer bug, not a live-data possibility.
  if (Number.isInteger(value.forecastYear) && !years.has(String(value.forecastYear))) {
    errors.push('forecastYear must correspond to a year present in periods');
  }

  if (!isRecord(value.totals)) {
    errors.push('totals must be an object');
  } else {
    validateTotals(value.totals, errors);
  }

  return { ok: errors.length === 0, errors };
}

export function acceptFinancePropertyForecastV1(value) {
  const validation = validateFinancePropertyForecastV1(value);
  if (!validation.ok) throw new TypeError(`Rejected ${CONTRACT}: ${validation.errors.join('; ')}`);
  return {
    contract: value.contract,
    dataClassification: value.dataClassification,
    sourceProduct: value.sourceProduct,
    consumerProduct: value.consumerProduct,
    currency: value.currency,
    propertyKey: value.propertyKey,
    generatedAt: value.generatedAt,
    forecastYear: value.forecastYear,
    periods: value.periods.map((row) => ({ ...row })),
    totals: { ...value.totals },
  };
}
