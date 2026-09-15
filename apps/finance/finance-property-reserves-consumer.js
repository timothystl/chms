// ── Fail-closed parser for connect.finance-property-reserves.v1 ────────────────────────────────
// Same shape/discipline as the other contract consumers in this directory: closed key sets (an
// unknown field anywhere fails closed), no I/O, and a pure validate/accept pair so producer
// (src/api-contracts.js) and consumer can never silently drift apart.
//
// A reserve FUNDING schedule, not a recurring operating statement (Operating) or an itemized
// one-off ledger (Ledgers) -- its own shape. Bundles three real tables production's own
// `finance/property/<key>` GET route already returns together (finance_property_reserves,
// finance_property_reserve_disbursements, finance_property_distributions) -- production's own
// finRenderPropertyTaxReserve (src/frontend/js-finance.js) renders the reserve schedule and its
// disbursements together under one "Property Tax Reserve" heading, and this contract's
// "Reserve & distribution" staging page does the same.
//
// reserveKey is a generic identifier, not hardcoded to 'property_tax' -- migrations/0023's own
// comment documents the table as generic ("e.g. 'property_tax', 'capital_paint_asphalt_concrete'"),
// even though only 'property_tax' has real rows for 'ivanhoe' today (confirmed live 2026-09-15).
//
// Real finding from checking live production data directly: reserve_after_cents does NOT always
// equal reserve_before_cents + contribution_cents exactly -- 4 of 30 real rows are off by exactly
// ±1 cent, pure monthly-contribution rounding (see src/api-contracts.js's producer header comment
// for the full detail). This consumer tolerates ±1 cent of rounding drift rather than requiring
// bit-exact reconciliation.
const CONTRACT = 'connect.finance-property-reserves.v1';
const ROOT_KEYS = [
  'contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'currency',
  'propertyKey', 'generatedAt', 'reserves', 'reserveDisbursements', 'distributions',
];
const RESERVE_KEYS = [
  'reserveKey', 'reportMonth', 'taxYear', 'targetEstimateCents', 'reserveBeforeCents',
  'contributionCents', 'reserveAfterCents', 'fundedPct', 'note',
];
const DISBURSEMENT_KEYS = ['reserveKey', 'periodKey', 'amountCents', 'paidViaReportMonth', 'note'];
const DISTRIBUTION_KEYS = ['period', 'amountCents'];
const RECONCILE_TOLERANCE_CENTS = 1;

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

function isReserveKeyStr(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9_]*$/.test(value);
}

function isPeriodStr(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value);
}

function isNullableInt(value) {
  return value === null || Number.isInteger(value);
}

function validateReserveRow(row, errors, index) {
  const label = `reserves[${index}]`;
  if (!hasExactKeys(row, RESERVE_KEYS)) {
    errors.push(`${label} must contain exactly the reserve schedule fields`);
    return;
  }
  if (!isReserveKeyStr(row.reserveKey)) errors.push(`${label}.reserveKey must be a lower_snake_case string`);
  if (!isPeriodStr(row.reportMonth)) errors.push(`${label}.reportMonth must be YYYY-MM`);
  if (!(row.taxYear === null || Number.isInteger(row.taxYear))) errors.push(`${label}.taxYear must be an integer or null`);
  if (!Number.isInteger(row.targetEstimateCents)) errors.push(`${label}.targetEstimateCents must be integer cents`);
  if (!Number.isInteger(row.reserveBeforeCents)) errors.push(`${label}.reserveBeforeCents must be integer cents`);
  if (!Number.isInteger(row.contributionCents)) errors.push(`${label}.contributionCents must be integer cents`);
  if (!Number.isInteger(row.reserveAfterCents)) errors.push(`${label}.reserveAfterCents must be integer cents`);
  if (typeof row.note !== 'string') errors.push(`${label}.note must be a string`);
  if (!(typeof row.fundedPct === 'number' && Number.isFinite(row.fundedPct))) {
    errors.push(`${label}.fundedPct must be a number`);
  } else if (Number.isInteger(row.targetEstimateCents) && Number.isInteger(row.reserveAfterCents)) {
    const expected = row.targetEstimateCents > 0 ? (row.reserveAfterCents / row.targetEstimateCents) * 100 : 0;
    if (row.fundedPct !== expected) errors.push(`${label}.fundedPct must equal reserveAfterCents / targetEstimateCents * 100 (or 0 when targetEstimateCents is 0)`);
  }
  // Real invariant, with the ±1 cent rounding tolerance confirmed against production's own real
  // rows on 2026-09-15 (see the producer's header comment).
  if (Number.isInteger(row.reserveBeforeCents) && Number.isInteger(row.contributionCents) && Number.isInteger(row.reserveAfterCents)
    && Math.abs(row.reserveAfterCents - (row.reserveBeforeCents + row.contributionCents)) > RECONCILE_TOLERANCE_CENTS) {
    errors.push(`${label} must reconcile within ${RECONCILE_TOLERANCE_CENTS} cent: reserveAfterCents ≈ reserveBeforeCents + contributionCents`);
  }
}

function validateDisbursementRow(row, errors, index) {
  const label = `reserveDisbursements[${index}]`;
  if (!hasExactKeys(row, DISBURSEMENT_KEYS)) {
    errors.push(`${label} must contain exactly the disbursement fields`);
    return;
  }
  if (!isReserveKeyStr(row.reserveKey)) errors.push(`${label}.reserveKey must be a lower_snake_case string`);
  if (!isNonEmptyString(row.periodKey)) errors.push(`${label}.periodKey must be a non-empty string`);
  if (!isNullableInt(row.amountCents)) errors.push(`${label}.amountCents must be integer cents or null`);
  if (typeof row.paidViaReportMonth !== 'string') errors.push(`${label}.paidViaReportMonth must be a string`);
  if (typeof row.note !== 'string') errors.push(`${label}.note must be a string`);
}

function validateDistributionRow(row, errors, index) {
  const label = `distributions[${index}]`;
  if (!hasExactKeys(row, DISTRIBUTION_KEYS)) {
    errors.push(`${label} must contain exactly the distribution fields`);
    return;
  }
  if (!isPeriodStr(row.period)) errors.push(`${label}.period must be YYYY-MM`);
  if (!Number.isInteger(row.amountCents)) errors.push(`${label}.amountCents must be integer cents`);
}

export function validateFinancePropertyReservesV1(value) {
  const errors = [];
  if (!hasExactKeys(value, ROOT_KEYS)) {
    return { ok: false, errors: ['root must contain exactly the connect.finance-property-reserves.v1 fields'] };
  }
  if (value.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
  if (value.dataClassification !== 'aggregate') errors.push('dataClassification must be aggregate');
  if (value.sourceProduct !== 'connect') errors.push('sourceProduct must be connect');
  if (value.consumerProduct !== 'finance') errors.push('consumerProduct must be finance');
  if (value.currency !== 'USD') errors.push('currency must be USD');
  if (!isNonEmptyString(value.propertyKey)) errors.push('propertyKey must be a non-empty string');
  if (!isDateTime(value.generatedAt)) errors.push('generatedAt must be an RFC 3339 UTC timestamp');

  // Empty arrays are a normal, valid "nothing recorded yet" state.
  if (!Array.isArray(value.reserves)) {
    errors.push('reserves must be an array');
  } else {
    const seen = new Set();
    value.reserves.forEach((row, index) => {
      validateReserveRow(row, errors, index);
      if (isRecord(row) && typeof row.reserveKey === 'string' && typeof row.reportMonth === 'string') {
        const key = `${row.reserveKey}::${row.reportMonth}`;
        if (seen.has(key)) errors.push(`reserves[${index}] is a duplicate reserveKey/reportMonth pair`);
        seen.add(key);
      }
    });
  }

  if (!Array.isArray(value.reserveDisbursements)) {
    errors.push('reserveDisbursements must be an array');
  } else {
    const seen = new Set();
    value.reserveDisbursements.forEach((row, index) => {
      validateDisbursementRow(row, errors, index);
      if (isRecord(row) && typeof row.reserveKey === 'string' && typeof row.periodKey === 'string') {
        const key = `${row.reserveKey}::${row.periodKey}`;
        if (seen.has(key)) errors.push(`reserveDisbursements[${index}] is a duplicate reserveKey/periodKey pair`);
        seen.add(key);
      }
    });
  }

  if (!Array.isArray(value.distributions)) {
    errors.push('distributions must be an array');
  } else {
    const seen = new Set();
    value.distributions.forEach((row, index) => {
      validateDistributionRow(row, errors, index);
      if (isRecord(row) && typeof row.period === 'string') {
        if (seen.has(row.period)) errors.push(`distributions[${index}] is a duplicate period`);
        seen.add(row.period);
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

export function acceptFinancePropertyReservesV1(value) {
  const validation = validateFinancePropertyReservesV1(value);
  if (!validation.ok) throw new TypeError(`Rejected ${CONTRACT}: ${validation.errors.join('; ')}`);
  return {
    contract: value.contract,
    dataClassification: value.dataClassification,
    sourceProduct: value.sourceProduct,
    consumerProduct: value.consumerProduct,
    currency: value.currency,
    propertyKey: value.propertyKey,
    generatedAt: value.generatedAt,
    reserves: value.reserves.map((row) => ({ ...row })),
    reserveDisbursements: value.reserveDisbursements.map((row) => ({ ...row })),
    distributions: value.distributions.map((row) => ({ ...row })),
  };
}
