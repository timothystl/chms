// ── Fail-closed parser for connect.finance-property-ledgers.v1 ─────────────────────────────────
// Same shape/discipline as the other contract consumers in this directory: closed key sets (an
// unknown field anywhere fails closed), no I/O, and a pure validate/accept pair so producer
// (src/api-contracts.js) and consumer can never silently drift apart.
//
// Itemized one-off transaction ledgers -- capital improvements and repairs/maintenance -- not a
// recurring monthly statement (Operating) or a funding schedule (Reserves). Bundled into one
// contract deliberately, mirroring the staging fixture's own existing precedent
// (readSyntheticPropertyLedgers in apps/finance/property-report-service.js already reads both
// tables together into one {capital, repairs, totals} shape): the two ledgers share the exact
// same row shape (date, amount, payee, description) and the same "Commercial Property" UI area,
// differing only in which table backs which page (Capital improvements vs. Work orders & repairs).
//
// Two real findings from checking live production data directly on 2026-09-15 (see
// src/api-contracts.js's buildFinancePropertyLedgersV1 header comment for the full detail):
// entryDate is not always a full YYYY-MM-DD date -- one real capital ledger row has an EMPTY
// entryDate (an opening-balance entry predating the earliest available report), and several real
// repairs rows carry only a YYYY-MM month. This consumer accepts '', YYYY-MM, or YYYY-MM-DD,
// unlike the synthetic fixture's own strict YYYY-MM-DD-only reader. amountCents is genuinely
// nullable on both ledgers (confirmed on repairs; modeled nullable on capital for the same
// as-yet-unbilled reason even though no real capital row is null today).
const CONTRACT = 'connect.finance-property-ledgers.v1';
const ROOT_KEYS = [
  'contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'currency',
  'propertyKey', 'generatedAt', 'capital', 'repairs', 'totals',
];
const CAPITAL_KEYS = ['entryDate', 'amountCents', 'payee', 'description', 'checkRef', 'project', 'sortOrder'];
const REPAIR_KEYS = ['entryDate', 'category', 'description', 'amountCents', 'payee', 'capitalized'];
const TOTALS_KEYS = ['capitalCents', 'repairsCents'];
// Optional row key added September 2026 so Finance can offer per-row Remove actions (the legacy
// DELETE routes key on the table's primary key). Optional rather than required so a Connect
// producer and Finance consumer from either side of the rollout still interoperate.
const OPTIONAL_ROW_KEYS = ['id'];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

function hasRowKeys(value, expected) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return expected.every((key) => keys.includes(key))
    && keys.every((key) => expected.includes(key) || OPTIONAL_ROW_KEYS.includes(key));
}

function isOptionalRowId(row) {
  return !('id' in row) || (Number.isInteger(row.id) && row.id > 0);
}

function isDateTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// '' (unknown/predates available reports), YYYY-MM, or YYYY-MM-DD -- see the module header
// comment for the real production rows that need each of the three forms.
function isEntryDateLike(value) {
  return typeof value === 'string' && (value === '' || /^\d{4}-\d{2}(-\d{2})?$/.test(value));
}

function isNullableInt(value) {
  return value === null || Number.isInteger(value);
}

function validateCapitalRow(row, errors, index) {
  const label = `capital[${index}]`;
  if (!hasRowKeys(row, CAPITAL_KEYS)) {
    errors.push(`${label} must contain exactly the capital ledger fields`);
    return;
  }
  if (!isEntryDateLike(row.entryDate)) errors.push(`${label}.entryDate must be '', YYYY-MM, or YYYY-MM-DD`);
  if (!isNullableInt(row.amountCents)) errors.push(`${label}.amountCents must be integer cents or null`);
  if (typeof row.payee !== 'string') errors.push(`${label}.payee must be a string`);
  if (typeof row.description !== 'string') errors.push(`${label}.description must be a string`);
  if (typeof row.checkRef !== 'string') errors.push(`${label}.checkRef must be a string`);
  if (typeof row.project !== 'string') errors.push(`${label}.project must be a string`);
  if (!Number.isInteger(row.sortOrder)) errors.push(`${label}.sortOrder must be an integer`);
  if (!isOptionalRowId(row)) errors.push(`${label}.id must be a positive integer when present`);
}

function validateRepairRow(row, errors, index) {
  const label = `repairs[${index}]`;
  if (!hasRowKeys(row, REPAIR_KEYS)) {
    errors.push(`${label} must contain exactly the repair ledger fields`);
    return;
  }
  if (!isEntryDateLike(row.entryDate)) errors.push(`${label}.entryDate must be '', YYYY-MM, or YYYY-MM-DD`);
  if (typeof row.category !== 'string') errors.push(`${label}.category must be a string`);
  if (typeof row.description !== 'string') errors.push(`${label}.description must be a string`);
  if (!isNullableInt(row.amountCents)) errors.push(`${label}.amountCents must be integer cents or null`);
  if (typeof row.payee !== 'string') errors.push(`${label}.payee must be a string`);
  if (typeof row.capitalized !== 'boolean') errors.push(`${label}.capitalized must be a boolean`);
  if (!isOptionalRowId(row)) errors.push(`${label}.id must be a positive integer when present`);
}

export function validateFinancePropertyLedgersV1(value) {
  const errors = [];
  if (!hasExactKeys(value, ROOT_KEYS)) {
    return { ok: false, errors: ['root must contain exactly the connect.finance-property-ledgers.v1 fields'] };
  }
  if (value.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
  if (value.dataClassification !== 'aggregate') errors.push('dataClassification must be aggregate');
  if (value.sourceProduct !== 'connect') errors.push('sourceProduct must be connect');
  if (value.consumerProduct !== 'finance') errors.push('consumerProduct must be finance');
  if (value.currency !== 'USD') errors.push('currency must be USD');
  if (!isNonEmptyString(value.propertyKey)) errors.push('propertyKey must be a non-empty string');
  if (!isDateTime(value.generatedAt)) errors.push('generatedAt must be an RFC 3339 UTC timestamp');

  let capitalValid = false;
  // Empty is a normal, valid "nothing recorded yet" state.
  if (!Array.isArray(value.capital)) {
    errors.push('capital must be an array');
  } else {
    capitalValid = true;
    value.capital.forEach((row, index) => {
      const before = errors.length;
      validateCapitalRow(row, errors, index);
      if (errors.length !== before) capitalValid = false;
    });
  }

  let repairsValid = false;
  if (!Array.isArray(value.repairs)) {
    errors.push('repairs must be an array');
  } else {
    repairsValid = true;
    value.repairs.forEach((row, index) => {
      const before = errors.length;
      validateRepairRow(row, errors, index);
      if (errors.length !== before) repairsValid = false;
    });
  }

  if (!hasExactKeys(value.totals, TOTALS_KEYS)) {
    errors.push('totals must contain exactly capitalCents and repairsCents');
  } else {
    if (!Number.isInteger(value.totals.capitalCents)) errors.push('totals.capitalCents must be integer cents');
    if (!Number.isInteger(value.totals.repairsCents)) errors.push('totals.repairsCents must be integer cents');
    // Cross-check: re-derive both totals from the ledgers themselves rather than trusting them
    // as-is, treating a null amountCents as 0 -- same convention the render layer's formatCents
    // already uses (`Number(value || 0)`).
    if (capitalValid) {
      const expected = value.capital.reduce((sum, row) => sum + (row.amountCents || 0), 0);
      if (value.totals.capitalCents !== expected) errors.push('totals.capitalCents must equal the sum of capital[].amountCents (nulls counted as 0)');
    }
    if (repairsValid) {
      const expected = value.repairs.reduce((sum, row) => sum + (row.amountCents || 0), 0);
      if (value.totals.repairsCents !== expected) errors.push('totals.repairsCents must equal the sum of repairs[].amountCents (nulls counted as 0)');
    }
  }

  return { ok: errors.length === 0, errors };
}

export function acceptFinancePropertyLedgersV1(value) {
  const validation = validateFinancePropertyLedgersV1(value);
  if (!validation.ok) throw new TypeError(`Rejected ${CONTRACT}: ${validation.errors.join('; ')}`);
  return {
    contract: value.contract,
    dataClassification: value.dataClassification,
    sourceProduct: value.sourceProduct,
    consumerProduct: value.consumerProduct,
    currency: value.currency,
    propertyKey: value.propertyKey,
    generatedAt: value.generatedAt,
    capital: value.capital.map((row) => ({ ...row })),
    repairs: value.repairs.map((row) => ({ ...row })),
    totals: { ...value.totals },
  };
}
