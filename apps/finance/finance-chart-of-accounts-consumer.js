// ── Fail-closed parser for connect.finance-chart-of-accounts.v1 ────────────────────────────────
// Same shape/discipline as finance-data-status-consumer.js and connect-giving-consumer.js: closed
// key sets (an unknown field anywhere fails closed), no I/O, and a pure validate/accept pair so
// producer (src/api-contracts.js) and consumer can never silently drift apart.
//
// This contract carries ledger STRUCTURE and Finance's own board-category/purpose-tag
// PRESENTATION of it — account names and QuickBooks-derived category paths, never a dollar
// figure, gift, donor, or person. dataClassification is 'structural' (not 'aggregate', unlike the
// Giving and Data-status contracts) precisely because there is no monetary aggregation here to
// reconcile — see the reconciliation block below, which counts rows rather than summing cents.
const CONTRACT = 'connect.finance-chart-of-accounts.v1';
const ROOT_KEYS = ['contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'generatedAt', 'accounts', 'reconciliation'];
const ACCOUNT_KEYS = [
  'classification', 'categoryPath', 'accountName', 'depth', 'hasChildren',
  'boardCategoryKey', 'boardCategoryLabel', 'purposeTagId', 'purposeTagLabel',
];
const RECONCILIATION_KEYS = ['accountCount', 'incomeCount', 'expenseCount', 'unassignedCount'];
const CLASSIFICATIONS = new Set(['Income', 'Expenses']);
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

function validateAccount(account, errors, index) {
  const label = `accounts[${index}]`;
  if (!hasExactKeys(account, ACCOUNT_KEYS)) {
    errors.push(`${label} must contain exactly the account fields`);
    return;
  }
  if (!CLASSIFICATIONS.has(account.classification)) errors.push(`${label}.classification must be Income or Expenses`);
  if (!isNonEmptyString(account.categoryPath) || !account.categoryPath.startsWith(`${account.classification}:`)) {
    errors.push(`${label}.categoryPath must be non-empty and start with its own classification`);
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

export function validateFinanceChartOfAccountsV1(value) {
  const errors = [];
  if (!hasExactKeys(value, ROOT_KEYS)) {
    return { ok: false, errors: ['root must contain exactly the connect.finance-chart-of-accounts.v1 fields'] };
  }
  if (value.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
  if (value.dataClassification !== 'structural') errors.push('dataClassification must be structural');
  if (value.sourceProduct !== 'connect') errors.push('sourceProduct must be connect');
  if (value.consumerProduct !== 'finance') errors.push('consumerProduct must be finance');
  if (!isDateTime(value.generatedAt)) errors.push('generatedAt must be an RFC 3339 UTC timestamp');

  if (!Array.isArray(value.accounts)) {
    errors.push('accounts must be an array');
  } else {
    const seenPaths = new Set();
    value.accounts.forEach((account, index) => {
      validateAccount(account, errors, index);
      if (isRecord(account) && typeof account.categoryPath === 'string') {
        if (seenPaths.has(account.categoryPath)) errors.push(`accounts[${index}].categoryPath is a duplicate: ${account.categoryPath}`);
        seenPaths.add(account.categoryPath);
      }
    });
  }

  if (!hasExactKeys(value.reconciliation, RECONCILIATION_KEYS)) {
    errors.push('reconciliation must contain exactly accountCount, incomeCount, expenseCount, and unassignedCount');
  } else {
    for (const key of RECONCILIATION_KEYS) {
      if (!Number.isInteger(value.reconciliation[key]) || value.reconciliation[key] < 0) {
        errors.push(`reconciliation.${key} must be a nonnegative integer`);
      }
    }
    if (Array.isArray(value.accounts)) {
      if (value.reconciliation.accountCount !== value.accounts.length) {
        errors.push('reconciliation.accountCount must equal accounts.length');
      }
      const incomeCount = value.accounts.filter((a) => isRecord(a) && a.classification === 'Income').length;
      const expenseCount = value.accounts.filter((a) => isRecord(a) && a.classification === 'Expenses').length;
      const unassignedCount = value.accounts.filter((a) => isRecord(a) && a.boardCategoryKey === 'unassigned').length;
      if (value.reconciliation.incomeCount !== incomeCount) errors.push('reconciliation.incomeCount does not match accounts');
      if (value.reconciliation.expenseCount !== expenseCount) errors.push('reconciliation.expenseCount does not match accounts');
      if (value.reconciliation.unassignedCount !== unassignedCount) errors.push('reconciliation.unassignedCount does not match accounts');
    }
  }

  return { ok: errors.length === 0, errors };
}

export function acceptFinanceChartOfAccountsV1(value) {
  const validation = validateFinanceChartOfAccountsV1(value);
  if (!validation.ok) throw new TypeError(`Rejected ${CONTRACT}: ${validation.errors.join('; ')}`);
  return {
    contract: value.contract,
    dataClassification: value.dataClassification,
    sourceProduct: value.sourceProduct,
    consumerProduct: value.consumerProduct,
    generatedAt: value.generatedAt,
    accounts: value.accounts.map((account) => ({ ...account })),
    reconciliation: { ...value.reconciliation },
  };
}
