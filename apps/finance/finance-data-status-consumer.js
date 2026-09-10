const CONTRACT = 'connect.finance-data-status.v1';
const ROOT_KEYS = ['contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'generatedAt', 'imports', 'quickbooks'];
const IMPORTS_KEYS = ['mostRecentImportAt', 'importerCount'];
const QUICKBOOKS_KEYS = ['connected', 'lastSyncedAt'];

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

function isDateTimeOrNull(value) {
  return value === null || isDateTime(value);
}

export function validateFinanceDataStatusV1(value) {
  const errors = [];
  if (!hasExactKeys(value, ROOT_KEYS)) {
    return { ok: false, errors: ['root must contain exactly the connect.finance-data-status.v1 fields'] };
  }

  if (value.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
  if (value.dataClassification !== 'aggregate') errors.push('dataClassification must be aggregate');
  if (value.sourceProduct !== 'connect') errors.push('sourceProduct must be connect');
  if (value.consumerProduct !== 'finance') errors.push('consumerProduct must be finance');
  if (!isDateTime(value.generatedAt)) errors.push('generatedAt must be an RFC 3339 UTC timestamp');

  if (!hasExactKeys(value.imports, IMPORTS_KEYS)) {
    errors.push('imports must contain only mostRecentImportAt and importerCount');
  } else {
    if (!isDateTimeOrNull(value.imports.mostRecentImportAt)) {
      errors.push('imports.mostRecentImportAt must be an RFC 3339 UTC timestamp or null');
    }
    if (!Number.isInteger(value.imports.importerCount) || value.imports.importerCount < 0) {
      errors.push('imports.importerCount must be a nonnegative integer');
    }
  }

  if (!hasExactKeys(value.quickbooks, QUICKBOOKS_KEYS)) {
    errors.push('quickbooks must contain only connected and lastSyncedAt');
  } else {
    if (typeof value.quickbooks.connected !== 'boolean') errors.push('quickbooks.connected must be a boolean');
    if (!isDateTimeOrNull(value.quickbooks.lastSyncedAt)) {
      errors.push('quickbooks.lastSyncedAt must be an RFC 3339 UTC timestamp or null');
    }
    if (value.quickbooks.connected === false && value.quickbooks.lastSyncedAt !== null) {
      errors.push('quickbooks.lastSyncedAt must be null when not connected');
    }
  }

  return { ok: errors.length === 0, errors };
}

export function acceptFinanceDataStatusV1(value) {
  const validation = validateFinanceDataStatusV1(value);
  if (!validation.ok) throw new TypeError(`Rejected ${CONTRACT}: ${validation.errors.join('; ')}`);
  return {
    contract: value.contract,
    dataClassification: value.dataClassification,
    sourceProduct: value.sourceProduct,
    consumerProduct: value.consumerProduct,
    generatedAt: value.generatedAt,
    imports: { ...value.imports },
    quickbooks: { ...value.quickbooks },
  };
}
