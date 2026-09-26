// Validators for the three Data & Imports read contracts Finance's Data page uses to match
// Connect's legacy Data & Imports tab:
//   connect.finance-import-status.v1                 -- each importer's last run / staleness
//   connect.finance-daycare-church-budget-preview.v1 -- MDO accounts a Church Budget would import
//   connect.finance-board-packet.v1                  -- the board packet JSON export
// All three are aggregate accounting data (no person, gift or payroll records). Closed-shape and
// fail-closed like every other validator in this directory.

const IMPORT_STATUS = 'connect.finance-import-status.v1';
const DAYCARE_PREVIEW = 'connect.finance-daycare-church-budget-preview.v1';
const BOARD_PACKET = 'connect.finance-board-packet.v1';

const IDENTITY_KEYS = ['contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'generatedAt'];
const IMPORT_STATUS_KEYS = [...IDENTITY_KEYS, 'importers'];
const IMPORTER_KEYS = ['key', 'label', 'group', 'lastImportedAt', 'note', 'derived'];
const PREVIEW_KEYS = [...IDENTITY_KEYS, 'currency', 'fiscalYear', 'available', 'message', 'found', 'byCategory', 'entries'];
const PREVIEW_CATEGORY_KEYS = ['category', 'actualCents', 'budgetCents'];
const PREVIEW_ENTRY_KEYS = ['period', 'category', 'entryType', 'amountCents', 'notes'];
const PACKET_KEYS = [...IDENTITY_KEYS, 'currency', 'fiscalYear', 'packet'];
const PACKET_BODY_KEYS = ['generated_at', 'year', 'church', 'daycare'];
const PACKET_CHURCH_KEYS = ['income_statement_this_year', 'income_statement_5yr_trend', 'balance_sheet_this_year', 'balance_sheet_5yr_trend'];

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

function isYear(value) {
  return Number.isInteger(value) && value >= 2000 && value <= 2100;
}

function text(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function checkIdentity(value, contract, errors) {
  if (value.contract !== contract) errors.push(`contract must be ${contract}`);
  if (value.dataClassification !== 'aggregate') errors.push('dataClassification must be aggregate');
  if (value.sourceProduct !== 'connect') errors.push('sourceProduct must be connect');
  if (value.consumerProduct !== 'finance') errors.push('consumerProduct must be finance');
  if (!isDateTime(value.generatedAt)) errors.push('generatedAt must be an RFC 3339 UTC timestamp');
}

function accept(validate, contract, value) {
  const result = validate(value);
  if (!result.ok) throw new Error(`Invalid ${contract}: ${result.errors.join('; ')}`);
  return structuredClone(value);
}

export function validateFinanceImportStatusV1(value) {
  if (!hasExactKeys(value, IMPORT_STATUS_KEYS)) return { ok: false, errors: [`root must contain exactly the ${IMPORT_STATUS} fields`] };
  const errors = [];
  checkIdentity(value, IMPORT_STATUS, errors);
  if (!Array.isArray(value.importers)) {
    errors.push('importers must be an array');
  } else {
    value.importers.forEach((importer, index) => {
      // lastImportedAt is '' for an importer that has never run; a derived date comes from the
      // imported rows' own timestamp column, which may be SQLite's "YYYY-MM-DD HH:MM:SS" form.
      if (!hasExactKeys(importer, IMPORTER_KEYS) || !text(importer.key) || !text(importer.label)
        || !['church', 'other'].includes(importer.group) || typeof importer.lastImportedAt !== 'string'
        || typeof importer.note !== 'string' || typeof importer.derived !== 'boolean') {
        errors.push(`importers[${index}] invalid`);
      }
    });
    if (new Set(value.importers.map((importer) => importer?.key)).size !== value.importers.length) errors.push('importer keys must be unique');
  }
  return { ok: errors.length === 0, errors };
}

export function acceptFinanceImportStatusV1(value) {
  return accept(validateFinanceImportStatusV1, IMPORT_STATUS, value);
}

export function validateFinanceDaycareChurchBudgetPreviewV1(value) {
  if (!hasExactKeys(value, PREVIEW_KEYS)) return { ok: false, errors: [`root must contain exactly the ${DAYCARE_PREVIEW} fields`] };
  const errors = [];
  checkIdentity(value, DAYCARE_PREVIEW, errors);
  if (value.currency !== 'USD') errors.push('currency must be USD');
  if (!isYear(value.fiscalYear)) errors.push('fiscalYear invalid');
  if (typeof value.available !== 'boolean') errors.push('available must be a boolean');
  if (typeof value.message !== 'string') errors.push('message must be a string');
  if (!Array.isArray(value.byCategory) || !value.byCategory.every((row) => hasExactKeys(row, PREVIEW_CATEGORY_KEYS)
    && text(row.category) && Number.isInteger(row.actualCents) && Number.isInteger(row.budgetCents))) {
    errors.push('byCategory invalid');
  }
  if (!Array.isArray(value.entries) || !value.entries.every((row) => hasExactKeys(row, PREVIEW_ENTRY_KEYS)
    && /^\d{4}(-\d{2})?$/.test(row.period) && text(row.category) && ['actual', 'budget'].includes(row.entryType)
    && Number.isInteger(row.amountCents) && typeof row.notes === 'string')) {
    errors.push('entries invalid');
  }
  if (!Number.isInteger(value.found) || (Array.isArray(value.entries) && value.found !== value.entries.length)) errors.push('found must equal the number of entries');
  if (value.available === false && Array.isArray(value.entries) && value.entries.length) errors.push('an unavailable preview carries no entries');
  return { ok: errors.length === 0, errors };
}

export function acceptFinanceDaycareChurchBudgetPreviewV1(value) {
  return accept(validateFinanceDaycareChurchBudgetPreviewV1, DAYCARE_PREVIEW, value);
}

// The packet body is Connect's legacy Board Packet export verbatim (src/api-finance.js
// buildBoardPacket), so its outer shape is checked and its figures are passed through untouched.
export function validateFinanceBoardPacketV1(value) {
  if (!hasExactKeys(value, PACKET_KEYS)) return { ok: false, errors: [`root must contain exactly the ${BOARD_PACKET} fields`] };
  const errors = [];
  checkIdentity(value, BOARD_PACKET, errors);
  if (value.currency !== 'USD') errors.push('currency must be USD');
  if (!isYear(value.fiscalYear)) errors.push('fiscalYear invalid');
  const packet = value.packet;
  if (!hasExactKeys(packet, PACKET_BODY_KEYS)) {
    errors.push('packet must contain exactly generated_at, year, church and daycare');
  } else {
    if (!isDateTime(packet.generated_at)) errors.push('packet.generated_at invalid');
    if (packet.year !== value.fiscalYear) errors.push('packet.year must equal fiscalYear');
    if (!hasExactKeys(packet.church, PACKET_CHURCH_KEYS) || !PACKET_CHURCH_KEYS.every((key) => isRecord(packet.church[key]))) errors.push('packet.church invalid');
    if (!hasExactKeys(packet.daycare, ['entries']) || !Array.isArray(packet.daycare.entries)) errors.push('packet.daycare invalid');
  }
  return { ok: errors.length === 0, errors };
}

export function acceptFinanceBoardPacketV1(value) {
  return accept(validateFinanceBoardPacketV1, BOARD_PACKET, value);
}
