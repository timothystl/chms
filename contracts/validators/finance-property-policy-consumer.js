const CONTRACT = 'connect.finance-property-policy.v1';
const ROOT_KEYS = ['contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'currency', 'propertyKey', 'generatedAt', 'reservePolicy', 'capitalPolicy'];
const RESERVE_KEYS = ['baseMinimumCents'];
const CAPITAL_KEYS = ['method', 'annualAllowanceCents', 'perSquareFootCents'];
const CAPITAL_METHODS = new Set(['ledger', 'flat', 'per_sqft', 'flat_plus_sqft']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isNullableNonnegativeInteger(value) {
  return value === null || (Number.isInteger(value) && value >= 0);
}

export function validateFinancePropertyPolicyV1(value) {
  const errors = [];
  if (!hasExactKeys(value, ROOT_KEYS)) return { ok: false, errors: ['root must contain exactly the property policy fields'] };
  if (value.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
  if (value.dataClassification !== 'aggregate') errors.push('dataClassification must be aggregate');
  if (value.sourceProduct !== 'connect') errors.push('sourceProduct must be connect');
  if (value.consumerProduct !== 'finance') errors.push('consumerProduct must be finance');
  if (value.currency !== 'USD') errors.push('currency must be USD');
  if (typeof value.propertyKey !== 'string' || !/^[a-z0-9_-]+$/.test(value.propertyKey)) errors.push('propertyKey must be a safe non-empty key');
  if (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))) errors.push('generatedAt must be a timestamp');
  if (!hasExactKeys(value.reservePolicy, RESERVE_KEYS)) errors.push('reservePolicy must contain exactly baseMinimumCents');
  else if (!Number.isInteger(value.reservePolicy.baseMinimumCents) || value.reservePolicy.baseMinimumCents < 0) errors.push('reservePolicy.baseMinimumCents must be nonnegative integer cents');
  if (!hasExactKeys(value.capitalPolicy, CAPITAL_KEYS)) errors.push('capitalPolicy must contain exactly the capital policy fields');
  else {
    if (!CAPITAL_METHODS.has(value.capitalPolicy.method)) errors.push('capitalPolicy.method is not recognized');
    if (!isNullableNonnegativeInteger(value.capitalPolicy.annualAllowanceCents)) errors.push('capitalPolicy.annualAllowanceCents must be null or nonnegative integer cents');
    if (!isNullableNonnegativeInteger(value.capitalPolicy.perSquareFootCents)) errors.push('capitalPolicy.perSquareFootCents must be null or nonnegative integer cents');
  }
  return { ok: errors.length === 0, errors };
}

export function acceptFinancePropertyPolicyV1(value) {
  const validation = validateFinancePropertyPolicyV1(value);
  if (!validation.ok) throw new Error(validation.errors.join('; '));
  return structuredClone(value);
}
