// ── Fail-closed parser for connect.finance-daycare-entries.v1 ──────────────────────────────────
// Same discipline as the other validators in this directory: closed key sets, no I/O, and a pure
// validate/accept pair shared by Connect's producer and Finance's client.
//
// The individual finance_daycare_entries rows for one fiscal year (the annual `YYYY` period plus
// every `YYYY-MM` month), so Finance's Daycare actuals page can list, edit and remove them the way
// legacy's finRenderDaycare does. Unlike connect.finance-daycare-report.v1 (a category summary),
// categories here are whatever the row carries: manual entries are free text.
const CONTRACT = 'connect.finance-daycare-entries.v1';
const ROOT_KEYS = [
  'contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'currency',
  'fiscalYear', 'generatedAt', 'entries',
];
const ENTRY_KEYS = ['id', 'period', 'category', 'entryType', 'amountCents', 'notes', 'source'];
const ENTRY_TYPES = new Set(['actual', 'budget']);

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

function validateEntry(row, errors, index, fiscalYear) {
  const label = `entries[${index}]`;
  if (!hasExactKeys(row, ENTRY_KEYS)) {
    errors.push(`${label} must contain exactly the daycare entry fields`);
    return;
  }
  if (!Number.isInteger(row.id) || row.id < 1) errors.push(`${label}.id must be a positive integer`);
  if (typeof row.period !== 'string' || !/^\d{4}(-(0[1-9]|1[0-2]))?$/.test(row.period)
    || row.period.slice(0, 4) !== String(fiscalYear)) {
    errors.push(`${label}.period must be the fiscal year (YYYY) or one of its months (YYYY-MM)`);
  }
  if (typeof row.category !== 'string') errors.push(`${label}.category must be a string`);
  if (!ENTRY_TYPES.has(row.entryType)) errors.push(`${label}.entryType must be actual or budget`);
  if (!Number.isInteger(row.amountCents)) errors.push(`${label}.amountCents must be integer cents`);
  if (typeof row.notes !== 'string') errors.push(`${label}.notes must be a string`);
  if (typeof row.source !== 'string' || row.source === '') errors.push(`${label}.source must be a non-empty string`);
}

export function validateFinanceDaycareEntriesV1(value) {
  const errors = [];
  if (!hasExactKeys(value, ROOT_KEYS)) {
    return { ok: false, errors: [`root must contain exactly the ${CONTRACT} fields`] };
  }
  if (value.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
  if (value.dataClassification !== 'aggregate') errors.push('dataClassification must be aggregate');
  if (value.sourceProduct !== 'connect') errors.push('sourceProduct must be connect');
  if (value.consumerProduct !== 'finance') errors.push('consumerProduct must be finance');
  if (value.currency !== 'USD') errors.push('currency must be USD');
  if (!Number.isInteger(value.fiscalYear) || value.fiscalYear < 1900 || value.fiscalYear > 9999) {
    errors.push('fiscalYear must be a 4-digit integer year');
  }
  if (!isDateTime(value.generatedAt)) errors.push('generatedAt must be an RFC 3339 UTC timestamp');
  if (!Array.isArray(value.entries)) {
    errors.push('entries must be an array');
  } else {
    const seen = new Set();
    value.entries.forEach((row, index) => {
      validateEntry(row, errors, index, value.fiscalYear);
      if (isRecord(row) && Number.isInteger(row.id)) {
        if (seen.has(row.id)) errors.push(`entries[${index}] repeats id ${row.id}`);
        seen.add(row.id);
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

export function acceptFinanceDaycareEntriesV1(value) {
  const result = validateFinanceDaycareEntriesV1(value);
  if (!result.ok) throw new Error(`Invalid ${CONTRACT}: ${result.errors.join('; ')}`);
  return { ...value, entries: value.entries.map((row) => ({ ...row })) };
}
