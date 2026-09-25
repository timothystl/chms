// ── Fail-closed parser for connect.finance-property-operating.v1 ───────────────────────────────
// Same shape/discipline as the other contract consumers in this directory: closed key sets (an
// unknown field anywhere fails closed), no I/O, and a pure validate/accept pair so producer
// (src/api-contracts.js) and consumer can never silently drift apart.
//
// This is the monthly recurring operating statement for one commercial property
// (finance_property_monthly), plus the same per-fiscal-year annualSummary production's own
// `finance/property/<key>` GET route already returns alongside it (computePropertyAnnualSummary,
// src/api-finance.js) -- a genuinely different shape from Reserves (a funding schedule) and
// Ledgers (itemized one-off transactions), the same reasoning connect.finance-property-*.v1's
// three-way split follows.
//
// Real findings from checking live production data directly on 2026-09-15 (see
// src/api-contracts.js's buildFinancePropertyOperatingV1 header comment for the full detail):
// occupancy_pct is a 0-1 fraction in real data (not the synthetic fixture's 0-100 scale), and
// total_expenses_cents/net_operating_income_cents/available_for_distribution_cents/
// reserve_balance_cents/loan_payment_cents/interest_expense_cents are all genuinely nullable.
// total_revenue_cents, net_income_cents, and occupancy_pct are never null. Every period that DOES
// carry a totalExpensesCents reconciles exactly against totalRevenueCents - netIncomeCents; this
// consumer cross-checks that on exactly those periods.
const CONTRACT = 'connect.finance-property-operating.v1';
const ROOT_KEYS = [
  'contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'currency',
  'propertyKey', 'generatedAt', 'periods', 'annualSummary',
];
const PERIOD_KEYS = [
  'period', 'occupancyPct', 'totalRevenueCents', 'totalExpensesCents', 'netIncomeCents',
  'netOperatingIncomeCents', 'availableForDistributionCents', 'reserveBalanceCents',
  'loanPaymentCents', 'interestExpenseCents', 'sourceReport',
];
const ANNUAL_SUMMARY_KEYS = [
  'year', 'totalRevenueCents', 'totalExpensesCents', 'netIncomeCents', 'avgOccupancyPct',
  'confirmedDistributionsCents', 'expenseMonthsDerived', 'notes',
];

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

function isNullableInt(value) {
  return value === null || Number.isInteger(value);
}

function validatePeriodRow(row, errors, index) {
  const label = `periods[${index}]`;
  if (!hasExactKeys(row, PERIOD_KEYS)) {
    errors.push(`${label} must contain exactly the period fields`);
    return;
  }
  if (!isPeriodStr(row.period)) errors.push(`${label}.period must be YYYY-MM`);
  if (!(typeof row.occupancyPct === 'number' && Number.isFinite(row.occupancyPct) && row.occupancyPct >= 0)) {
    errors.push(`${label}.occupancyPct must be a nonnegative number (a 0-1 fraction)`);
  }
  if (!Number.isInteger(row.totalRevenueCents)) errors.push(`${label}.totalRevenueCents must be integer cents`);
  if (!isNullableInt(row.totalExpensesCents)) errors.push(`${label}.totalExpensesCents must be integer cents or null`);
  if (!Number.isInteger(row.netIncomeCents)) errors.push(`${label}.netIncomeCents must be integer cents`);
  if (!isNullableInt(row.netOperatingIncomeCents)) errors.push(`${label}.netOperatingIncomeCents must be integer cents or null`);
  if (!isNullableInt(row.availableForDistributionCents)) errors.push(`${label}.availableForDistributionCents must be integer cents or null`);
  if (!isNullableInt(row.reserveBalanceCents)) errors.push(`${label}.reserveBalanceCents must be integer cents or null`);
  if (!isNullableInt(row.loanPaymentCents)) errors.push(`${label}.loanPaymentCents must be integer cents or null`);
  if (!isNullableInt(row.interestExpenseCents)) errors.push(`${label}.interestExpenseCents must be integer cents or null`);
  if (typeof row.sourceReport !== 'string') errors.push(`${label}.sourceReport must be a string`);
  // Real invariant, confirmed against every one of production's 26 non-null-expense rows on
  // 2026-09-15 (see the producer's header comment): only checkable when totalExpensesCents is
  // present.
  if (Number.isInteger(row.totalExpensesCents) && Number.isInteger(row.totalRevenueCents) && Number.isInteger(row.netIncomeCents)
    && row.totalRevenueCents - row.totalExpensesCents !== row.netIncomeCents) {
    errors.push(`${label} must reconcile: totalRevenueCents - totalExpensesCents === netIncomeCents when totalExpensesCents is present`);
  }
}

function validateAnnualSummaryRow(row, errors, index) {
  const label = `annualSummary[${index}]`;
  if (!hasExactKeys(row, ANNUAL_SUMMARY_KEYS)) {
    errors.push(`${label} must contain exactly the annual summary fields`);
    return;
  }
  if (!Number.isInteger(row.year)) errors.push(`${label}.year must be an integer`);
  if (!Number.isInteger(row.totalRevenueCents)) errors.push(`${label}.totalRevenueCents must be integer cents`);
  if (!Number.isInteger(row.totalExpensesCents)) errors.push(`${label}.totalExpensesCents must be integer cents`);
  if (!Number.isInteger(row.netIncomeCents)) errors.push(`${label}.netIncomeCents must be integer cents`);
  if (!(row.avgOccupancyPct === null || (typeof row.avgOccupancyPct === 'number' && Number.isFinite(row.avgOccupancyPct) && row.avgOccupancyPct >= 0))) {
    errors.push(`${label}.avgOccupancyPct must be a nonnegative number or null`);
  }
  if (!Number.isInteger(row.confirmedDistributionsCents)) errors.push(`${label}.confirmedDistributionsCents must be integer cents`);
  if (!Number.isInteger(row.expenseMonthsDerived) || row.expenseMonthsDerived < 0) errors.push(`${label}.expenseMonthsDerived must be a nonnegative integer`);
  if (typeof row.notes !== 'string') errors.push(`${label}.notes must be a string`);
}

export function validateFinancePropertyOperatingV1(value) {
  const errors = [];
  if (!hasExactKeys(value, ROOT_KEYS)) {
    return { ok: false, errors: ['root must contain exactly the connect.finance-property-operating.v1 fields'] };
  }
  if (value.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
  if (value.dataClassification !== 'aggregate') errors.push('dataClassification must be aggregate');
  if (value.sourceProduct !== 'connect') errors.push('sourceProduct must be connect');
  if (value.consumerProduct !== 'finance') errors.push('consumerProduct must be finance');
  if (value.currency !== 'USD') errors.push('currency must be USD');
  if (!isNonEmptyString(value.propertyKey)) errors.push('propertyKey must be a non-empty string');
  if (!isDateTime(value.generatedAt)) errors.push('generatedAt must be an RFC 3339 UTC timestamp');

  // Empty is a normal, valid "nothing reported yet" state -- same convention as Budget/Church
  // Report/Balance Sheet/Daycare Report's own empty-fiscal-year contracts.
  if (!Array.isArray(value.periods)) {
    errors.push('periods must be an array');
  } else {
    const seen = new Set();
    value.periods.forEach((row, index) => {
      validatePeriodRow(row, errors, index);
      if (isRecord(row) && typeof row.period === 'string') {
        if (seen.has(row.period)) errors.push(`periods[${index}] is a duplicate period`);
        seen.add(row.period);
      }
    });
  }

  if (!Array.isArray(value.annualSummary)) {
    errors.push('annualSummary must be an array');
  } else {
    const seen = new Set();
    value.annualSummary.forEach((row, index) => {
      validateAnnualSummaryRow(row, errors, index);
      if (isRecord(row) && typeof row.year === 'number') {
        if (seen.has(row.year)) errors.push(`annualSummary[${index}] is a duplicate year`);
        seen.add(row.year);
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

export function acceptFinancePropertyOperatingV1(value) {
  const validation = validateFinancePropertyOperatingV1(value);
  if (!validation.ok) throw new TypeError(`Rejected ${CONTRACT}: ${validation.errors.join('; ')}`);
  return {
    contract: value.contract,
    dataClassification: value.dataClassification,
    sourceProduct: value.sourceProduct,
    consumerProduct: value.consumerProduct,
    currency: value.currency,
    propertyKey: value.propertyKey,
    generatedAt: value.generatedAt,
    periods: value.periods.map((row) => ({ ...row })),
    annualSummary: value.annualSummary.map((row) => ({ ...row })),
  };
}
