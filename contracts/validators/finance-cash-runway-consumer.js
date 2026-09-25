// Read-only aggregate liquidity contract. It carries the same operating-cash selection, church-
// only expense split, and policy floor Connect already uses on its legacy Financial Health page.
const CONTRACT = 'connect.finance-cash-runway.v1';
const ROOT_KEYS = [
  'contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'currency', 'fiscalYear',
  'generatedAt', 'available', 'onHandCents', 'expensesYtdCents', 'monthsElapsed',
  'averageMonthlyExpenseCents', 'monthsOfCash', 'policyFloorMonths', 'floorCents',
  'gapToFloorCents', 'cashSource', 'cashAccounts', 'asOfDate', 'daycareExcludedCents',
  'allExpensesYtdCents',
];
const CASH_SOURCES = new Set(['manual', 'balance_sheet', 'quickbooks', 'none']);

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

function isNullableInteger(value) {
  return value === null || Number.isInteger(value);
}

function isNullableNumber(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

export function validateFinanceCashRunwayV1(value) {
  const errors = [];
  if (!hasExactKeys(value, ROOT_KEYS)) return { ok: false, errors: ['root must contain exactly the cash-runway fields'] };
  if (value.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
  if (value.dataClassification !== 'aggregate') errors.push('dataClassification must be aggregate');
  if (value.sourceProduct !== 'connect') errors.push('sourceProduct must be connect');
  if (value.consumerProduct !== 'finance') errors.push('consumerProduct must be finance');
  if (value.currency !== 'USD') errors.push('currency must be USD');
  if (!Number.isInteger(value.fiscalYear) || value.fiscalYear < 2000 || value.fiscalYear > 2100) errors.push('fiscalYear must be a 4-digit integer year');
  if (!isDateTime(value.generatedAt)) errors.push('generatedAt must be an RFC 3339 UTC timestamp');
  if (typeof value.available !== 'boolean') errors.push('available must be boolean');
  if (!isNullableInteger(value.onHandCents)) errors.push('onHandCents must be integer cents or null');
  for (const key of ['expensesYtdCents', 'averageMonthlyExpenseCents', 'daycareExcludedCents', 'allExpensesYtdCents']) {
    if (!Number.isInteger(value[key]) || value[key] < 0) errors.push(`${key} must be nonnegative integer cents`);
  }
  if (!Number.isInteger(value.monthsElapsed) || value.monthsElapsed < 1 || value.monthsElapsed > 12) errors.push('monthsElapsed must be an integer from 1 to 12');
  if (!isNullableNumber(value.monthsOfCash) || (value.monthsOfCash !== null && value.monthsOfCash < 0)) errors.push('monthsOfCash must be a nonnegative number or null');
  if (!(typeof value.policyFloorMonths === 'number' && Number.isFinite(value.policyFloorMonths) && value.policyFloorMonths >= 0)) errors.push('policyFloorMonths must be a nonnegative number');
  for (const key of ['floorCents', 'gapToFloorCents']) {
    if (!isNullableInteger(value[key]) || (value[key] !== null && value[key] < 0)) errors.push(`${key} must be nonnegative integer cents or null`);
  }
  if (!CASH_SOURCES.has(value.cashSource)) errors.push('cashSource must be manual, balance_sheet, quickbooks, or none');
  if (!Array.isArray(value.cashAccounts) || value.cashAccounts.some((name) => typeof name !== 'string' || name.trim() === '')) errors.push('cashAccounts must be an array of non-empty strings');
  if (typeof value.asOfDate !== 'string') errors.push('asOfDate must be a string');
  if (Number.isInteger(value.expensesYtdCents) && Number.isInteger(value.daycareExcludedCents)
      && Number.isInteger(value.allExpensesYtdCents)
      && value.expensesYtdCents + value.daycareExcludedCents !== value.allExpensesYtdCents) {
    errors.push('church expenses plus daycare excluded must equal all expenses');
  }
  if (value.available) {
    if (!Number.isInteger(value.onHandCents) || value.onHandCents < 0) errors.push('available runway requires nonnegative onHandCents');
    if (!(typeof value.monthsOfCash === 'number' && Number.isFinite(value.monthsOfCash))) errors.push('available runway requires monthsOfCash');
    if (!Number.isInteger(value.floorCents) || !Number.isInteger(value.gapToFloorCents)) errors.push('available runway requires floorCents and gapToFloorCents');
    if (value.averageMonthlyExpenseCents <= 0) errors.push('available runway requires positive averageMonthlyExpenseCents');
  } else if (value.monthsOfCash !== null || value.floorCents !== null || value.gapToFloorCents !== null) {
    errors.push('unavailable runway must use null derived amounts');
  }
  return { ok: errors.length === 0, errors };
}

export function acceptFinanceCashRunwayV1(value) {
  const validation = validateFinanceCashRunwayV1(value);
  if (!validation.ok) throw new Error(`Invalid ${CONTRACT}: ${validation.errors.join('; ')}`);
  return structuredClone(value);
}
