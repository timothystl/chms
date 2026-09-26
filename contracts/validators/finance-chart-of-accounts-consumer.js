// ── Fail-closed parser for connect.finance-chart-of-accounts.v1 ────────────────────────────────
// Same shape/discipline as finance-data-status-consumer.js and connect-giving-consumer.js: closed
// key sets (an unknown field anywhere fails closed), no I/O, and a pure validate/accept pair so
// producer (src/api-contracts.js) and consumer can never silently drift apart.
//
// This contract carries one fiscal year's ledger accounts (names, QuickBooks-derived category
// paths, and each account's own actual/budget cents for that year) plus Finance's own
// board-category/purpose-tag presentation of them -- never a gift, donor, or person. Because it
// carries per-account dollar figures, dataClassification is 'aggregate', and the reconciliation
// block sums the revenue-side and expense-side actuals as well as counting rows.
//
// The earlier, year-less structural shape (every Income/Expenses path across all years, no dollar
// figure, dataClassification 'structural') is still accepted, as a whole, so a Finance release that
// reaches an older Connect deployment keeps showing the account list. accept() marks it with
// fiscalYear null and each account's actualCents/budgetCents/displayName filled as unknown.
const CONTRACT = 'connect.finance-chart-of-accounts.v1';
const LEGACY_ROOT_KEYS = ['contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'generatedAt', 'accounts', 'reconciliation'];
const ROOT_KEYS = [...LEGACY_ROOT_KEYS, 'fiscalYear', 'availableFiscalYears'];
const LEGACY_ACCOUNT_KEYS = [
  'classification', 'categoryPath', 'accountName', 'depth', 'hasChildren',
  'boardCategoryKey', 'boardCategoryLabel', 'purposeTagId', 'purposeTagLabel',
];
const ACCOUNT_KEYS = [...LEGACY_ACCOUNT_KEYS, 'displayName', 'actualCents', 'budgetCents'];
const LEGACY_RECONCILIATION_KEYS = ['accountCount', 'incomeCount', 'expenseCount', 'unassignedCount'];
const RECONCILIATION_COUNT_KEYS = [
  ...LEGACY_RECONCILIATION_KEYS, 'otherIncomeCount', 'otherExpenseCount', 'costOfGoodsSoldCount',
];
const RECONCILIATION_KEYS = [...RECONCILIATION_COUNT_KEYS, 'revenueActualCents', 'expenseActualCents'];
const LEGACY_CLASSIFICATIONS = new Set(['Income', 'Expenses']);
const CLASSIFICATIONS = new Set(['Income', 'Other Income', 'Cost of Goods Sold', 'Expenses', 'Other Expenses']);
// Legacy FIN_REVENUE_CLASSES: everything else is the expense side.
export const CHART_REVENUE_CLASSIFICATIONS = new Set(['Income', 'Other Income']);
const KEY_RE = /^[a-z][a-z0-9_]*$/;

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

function isFiscalYear(value) {
  return Number.isInteger(value) && value >= 2000 && value <= 2100;
}

function validateAccount(account, errors, index, legacy) {
  const label = `accounts[${index}]`;
  if (!hasExactKeys(account, legacy ? LEGACY_ACCOUNT_KEYS : ACCOUNT_KEYS)) {
    errors.push(`${label} must contain exactly the account fields`);
    return;
  }
  if (legacy) {
    if (!LEGACY_CLASSIFICATIONS.has(account.classification)) errors.push(`${label}.classification must be Income or Expenses`);
    if (!isNonEmptyString(account.categoryPath) || !account.categoryPath.startsWith(`${account.classification}:`)) {
      errors.push(`${label}.categoryPath must be non-empty and start with its own classification`);
    }
  } else {
    // A live QuickBooks sync names its top-level sections "Revenue"/"Expenditures" in the path
    // while the classification is normalized, so the path is not required to start with it.
    if (!CLASSIFICATIONS.has(account.classification)) errors.push(`${label}.classification must be a P&L classification`);
    if (!isNonEmptyString(account.categoryPath)) errors.push(`${label}.categoryPath must be a non-empty string`);
    if (!isNonEmptyString(account.displayName)) errors.push(`${label}.displayName must be a non-empty string`);
    if (!Number.isInteger(account.actualCents)) errors.push(`${label}.actualCents must be an integer`);
    if (account.budgetCents !== null && !Number.isInteger(account.budgetCents)) errors.push(`${label}.budgetCents must be null or an integer`);
  }
  if (!isNonEmptyString(account.accountName)) errors.push(`${label}.accountName must be a non-empty string`);
  if (!Number.isInteger(account.depth) || account.depth < 0) errors.push(`${label}.depth must be a nonnegative integer`);
  if (typeof account.hasChildren !== 'boolean') errors.push(`${label}.hasChildren must be a boolean`);
  if (typeof account.boardCategoryKey !== 'string' || !KEY_RE.test(account.boardCategoryKey)) {
    errors.push(`${label}.boardCategoryKey must be a lowercase snake_case key`);
  }
  if (!isNonEmptyString(account.boardCategoryLabel)) errors.push(`${label}.boardCategoryLabel must be a non-empty string`);
  const tagIdOk = account.purposeTagId === null || (typeof account.purposeTagId === 'string' && KEY_RE.test(account.purposeTagId));
  if (!tagIdOk) errors.push(`${label}.purposeTagId must be null or a lowercase snake_case id`);
  const tagLabelOk = account.purposeTagLabel === null || isNonEmptyString(account.purposeTagLabel);
  if (!tagLabelOk) errors.push(`${label}.purposeTagLabel must be null or a non-empty string`);
  if ((account.purposeTagId === null) !== (account.purposeTagLabel === null)) {
    errors.push(`${label}.purposeTagId and purposeTagLabel must be null together or set together`);
  }
}

function validateReconciliation(value, errors, legacy) {
  const keys = legacy ? LEGACY_RECONCILIATION_KEYS : RECONCILIATION_KEYS;
  if (!hasExactKeys(value.reconciliation, keys)) {
    errors.push(`reconciliation must contain exactly ${keys.join(', ')}`);
    return;
  }
  const r = value.reconciliation;
  for (const key of legacy ? LEGACY_RECONCILIATION_KEYS : RECONCILIATION_COUNT_KEYS) {
    if (!Number.isInteger(r[key]) || r[key] < 0) errors.push(`reconciliation.${key} must be a nonnegative integer`);
  }
  if (!legacy) {
    for (const key of ['revenueActualCents', 'expenseActualCents']) {
      if (!Number.isInteger(r[key])) errors.push(`reconciliation.${key} must be an integer`);
    }
  }
  if (!Array.isArray(value.accounts)) return;
  const accounts = value.accounts.filter(isRecord);
  const count = (classification) => accounts.filter((a) => a.classification === classification).length;
  if (r.accountCount !== value.accounts.length) errors.push('reconciliation.accountCount must equal accounts.length');
  if (r.incomeCount !== count('Income')) errors.push('reconciliation.incomeCount does not match accounts');
  if (r.expenseCount !== count('Expenses')) errors.push('reconciliation.expenseCount does not match accounts');
  if (r.unassignedCount !== accounts.filter((a) => a.boardCategoryKey === 'unassigned').length) {
    errors.push('reconciliation.unassignedCount does not match accounts');
  }
  if (legacy) return;
  if (r.otherIncomeCount !== count('Other Income')) errors.push('reconciliation.otherIncomeCount does not match accounts');
  if (r.otherExpenseCount !== count('Other Expenses')) errors.push('reconciliation.otherExpenseCount does not match accounts');
  if (r.costOfGoodsSoldCount !== count('Cost of Goods Sold')) errors.push('reconciliation.costOfGoodsSoldCount does not match accounts');
  const sum = (revenue) => accounts
    .filter((a) => CHART_REVENUE_CLASSIFICATIONS.has(a.classification) === revenue && Number.isInteger(a.actualCents))
    .reduce((total, a) => total + a.actualCents, 0);
  if (r.revenueActualCents !== sum(true)) errors.push('reconciliation.revenueActualCents does not match accounts');
  if (r.expenseActualCents !== sum(false)) errors.push('reconciliation.expenseActualCents does not match accounts');
}

export function validateFinanceChartOfAccountsV1(value) {
  const errors = [];
  const legacy = hasExactKeys(value, LEGACY_ROOT_KEYS);
  if (!legacy && !hasExactKeys(value, ROOT_KEYS)) {
    return { ok: false, errors: ['root must contain exactly the connect.finance-chart-of-accounts.v1 fields'] };
  }
  if (value.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
  if (legacy && value.dataClassification !== 'structural') errors.push('dataClassification must be structural for the year-less shape');
  if (!legacy && value.dataClassification !== 'aggregate') errors.push('dataClassification must be aggregate');
  if (value.sourceProduct !== 'connect') errors.push('sourceProduct must be connect');
  if (value.consumerProduct !== 'finance') errors.push('consumerProduct must be finance');
  if (!isDateTime(value.generatedAt)) errors.push('generatedAt must be an RFC 3339 UTC timestamp');
  if (!legacy) {
    if (!isFiscalYear(value.fiscalYear)) errors.push('fiscalYear must be a four-digit year');
    if (!Array.isArray(value.availableFiscalYears) || !value.availableFiscalYears.every(isFiscalYear)
      || new Set(value.availableFiscalYears).size !== value.availableFiscalYears.length) {
      errors.push('availableFiscalYears must be a list of distinct four-digit years');
    }
  }

  if (!Array.isArray(value.accounts)) {
    errors.push('accounts must be an array');
  } else {
    const seenPaths = new Set();
    value.accounts.forEach((account, index) => {
      validateAccount(account, errors, index, legacy);
      if (isRecord(account) && typeof account.categoryPath === 'string') {
        if (seenPaths.has(account.categoryPath)) errors.push(`accounts[${index}].categoryPath is a duplicate: ${account.categoryPath}`);
        seenPaths.add(account.categoryPath);
      }
    });
  }

  validateReconciliation(value, errors, legacy);

  return { ok: errors.length === 0, errors };
}

// Returns detached data in the current shape. A year-less payload comes back with fiscalYear null,
// no available years, and each account's displayName as its QuickBooks name and actualCents and
// budgetCents null (unknown, not zero).
export function acceptFinanceChartOfAccountsV1(value) {
  const validation = validateFinanceChartOfAccountsV1(value);
  if (!validation.ok) throw new TypeError(`Rejected ${CONTRACT}: ${validation.errors.join('; ')}`);
  const legacy = !('fiscalYear' in value);
  return {
    contract: value.contract,
    dataClassification: value.dataClassification,
    sourceProduct: value.sourceProduct,
    consumerProduct: value.consumerProduct,
    generatedAt: value.generatedAt,
    fiscalYear: legacy ? null : value.fiscalYear,
    availableFiscalYears: legacy ? [] : [...value.availableFiscalYears],
    accounts: value.accounts.map((account) => (legacy
      ? { ...account, displayName: account.accountName, actualCents: null, budgetCents: null }
      : { ...account })),
    reconciliation: { ...value.reconciliation },
  };
}
