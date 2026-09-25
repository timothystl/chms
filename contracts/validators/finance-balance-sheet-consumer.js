// ── Fail-closed parser for connect.finance-balance-sheet.v1 ─────────────────────────────────
// Same shape/discipline as the other contract consumers in this directory: closed key sets (an
// unknown field anywhere fails closed), no I/O, and a pure validate/accept pair so producer
// (src/api-contracts.js) and consumer can never silently drift apart.
//
// Balance Sheet is a structurally different report from Church Report -- point-in-time
// Assets/Liabilities/Equity account balances (finance_church_balances), not an actual-vs-budget
// income statement (finance_church_entries). Real money crosses this contract, so it is
// 'aggregate', like Giving/Budget/Church Report, not 'structural' like Chart of Accounts.
//
// Unlike Church Report, there is no source-precedence tier to validate: a 2026-09-14 check of
// production found exactly one source value ('import') across every fiscal year on file, and
// ownBalanceCents is NOT nullable -- confirmed never null in any real row (the schema itself is
// NOT NULL DEFAULT 0). So this consumer has no nullable dollar field at all, unlike Budget's
// growthPct/baseAmountCents or Church Report's budgetCents.
//
// classification is exactly {Assets, Liabilities, Equity} -- confirmed 2026-09-14 against
// production: no other classification value exists in finance_church_balances (unlike Church
// Report, which genuinely has Other Income/Other Expenses/Cost of Goods Sold rows beyond
// Income/Expenses).
//
// accounts carries the SAME Designated-Funds-as-Equity reclassification production's own
// `finance/church/balances` GET route applies before returning rows to the frontend (see
// src/api-finance.js's applyDesignatedFundsAsEquity) -- the "25000 Funds" branch is classified
// 'Equity' here, not 'Liabilities', matching what production's own Full account detail tree
// already shows, not the raw as-imported classification.
//
// equityReclass mirrors production's own Donor-Restricted/Without-Donor-Restriction breakdown
// (computeEquityReclassification), computed from the SAME already-reclassified rows as `accounts`
// and `totals` -- see this contract's producer for a detailed note on why that specific ordering
// contradicts a comment in src/api-finance.js, and why this consumer still validates that
// production's own actual arithmetic (not the comment's stated intent) holds internally
// consistent: totalEquityCents must equal totals.equityCents (both are computeBalanceSummary's
// equityCents on the same displayRows), and donorRestrictedCents + unrestrictedCents must equal
// totalEquityCents (computeEquityReclassification's own residual identity, which holds regardless
// of which rows it was given).
//
// Cross-checks classification totals against the raw accounts array, but deliberately does NOT
// exclude hasChildren rows when re-summing -- a 2026-09-14 production check found 8 real
// has_children=1 rows (2019-2025) with a genuinely nonzero ownBalanceCents (most commonly "11027
// Lindell Checking xx9105", a real two-level parent with its own distinct balance, not a
// duplicated subtotal). computeBalanceSummary() already sums every row flatly by design; a
// consumer that filtered has_children out first would compute a different, wrong total.
const CONTRACT = 'connect.finance-balance-sheet.v1';
const ROOT_KEYS = [
  'contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'currency',
  'fiscalYear', 'asOfDate', 'generatedAt', 'accounts', 'totals', 'equityReclass', 'reconciliation',
];
const ACCOUNT_KEYS = ['classification', 'categoryPath', 'accountName', 'depth', 'hasChildren', 'ownBalanceCents'];
const TOTALS_KEYS = [
  'assetsCents', 'liabilitiesCents', 'equityCents', 'currentAssetsCents', 'fixedAssetsCents',
  'otherAssetsCents', 'liabilitiesPlusEquityCents', 'balancedCents',
];
const EQUITY_RECLASS_KEYS = ['donorRestrictedCents', 'unrestrictedCents', 'totalEquityCents', 'breakdown', 'unclassified'];
const BREAKDOWN_KEYS = ['perpetual', 'purpose_time', 'designated'];
const BREAKDOWN_ENTRY_KEYS = ['label', 'cents'];
const BREAKDOWN_LABELS = {
  perpetual: 'Perpetual endowments',
  purpose_time: 'Purpose/time restricted',
  designated: 'Designated ministry/purpose funds',
};
const UNCLASSIFIED_KEYS = ['accountName', 'categoryPath', 'ownBalanceCents'];
const RECONCILIATION_KEYS = ['accountCount', 'assetsCount', 'liabilitiesCount', 'equityCount', 'unclassifiedEquityCount', 'totalsMatch'];
const CLASSIFICATIONS = new Set(['Assets', 'Liabilities', 'Equity']);
// Segment-matching convention mirrored from src/api-finance.js's assetGroupOf() -- the second
// colon-joined segment of categoryPath (the group directly under "Assets") decides current vs.
// fixed vs. other, purely by name, not by account code.
const ASSET_GROUP_CURRENT_RE = /current/i;
const ASSET_GROUP_FIXED_RE = /fixed/i;

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

function assetGroupOf(categoryPath) {
  const seg = String(categoryPath || '').split(':')[1] || '';
  if (ASSET_GROUP_CURRENT_RE.test(seg)) return 'current';
  if (ASSET_GROUP_FIXED_RE.test(seg)) return 'fixed';
  return 'other';
}

function validateAccount(row, errors, index) {
  const label = `accounts[${index}]`;
  if (!hasExactKeys(row, ACCOUNT_KEYS)) {
    errors.push(`${label} must contain exactly the balance sheet account fields`);
    return;
  }
  if (!CLASSIFICATIONS.has(row.classification)) errors.push(`${label}.classification must be Assets, Liabilities, or Equity`);
  if (!isNonEmptyString(row.categoryPath)) errors.push(`${label}.categoryPath must be a non-empty string`);
  if (!isNonEmptyString(row.accountName)) errors.push(`${label}.accountName must be a non-empty string`);
  if (!Number.isInteger(row.depth) || row.depth < 0) errors.push(`${label}.depth must be a nonnegative integer`);
  if (typeof row.hasChildren !== 'boolean') errors.push(`${label}.hasChildren must be a boolean`);
  if (!Number.isInteger(row.ownBalanceCents)) errors.push(`${label}.ownBalanceCents must be integer cents`);
}

function validateUnclassified(row, errors, index) {
  const label = `equityReclass.unclassified[${index}]`;
  if (!hasExactKeys(row, UNCLASSIFIED_KEYS)) {
    errors.push(`${label} must contain exactly the unclassified account fields`);
    return;
  }
  if (!isNonEmptyString(row.accountName)) errors.push(`${label}.accountName must be a non-empty string`);
  if (!isNonEmptyString(row.categoryPath)) errors.push(`${label}.categoryPath must be a non-empty string`);
  if (!Number.isInteger(row.ownBalanceCents)) errors.push(`${label}.ownBalanceCents must be integer cents`);
}

export function validateFinanceBalanceSheetV1(value) {
  const errors = [];
  if (!hasExactKeys(value, ROOT_KEYS)) {
    return { ok: false, errors: ['root must contain exactly the connect.finance-balance-sheet.v1 fields'] };
  }
  if (value.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
  if (value.dataClassification !== 'aggregate') errors.push('dataClassification must be aggregate');
  if (value.sourceProduct !== 'connect') errors.push('sourceProduct must be connect');
  if (value.consumerProduct !== 'finance') errors.push('consumerProduct must be finance');
  if (value.currency !== 'USD') errors.push('currency must be USD');
  if (!Number.isInteger(value.fiscalYear) || value.fiscalYear < 2000 || value.fiscalYear > 2100) {
    errors.push('fiscalYear must be a 4-digit integer year');
  }
  if (typeof value.asOfDate !== 'string') errors.push('asOfDate must be a string (may be empty for a fiscal year with nothing imported yet)');
  if (!isDateTime(value.generatedAt)) errors.push('generatedAt must be an RFC 3339 UTC timestamp');

  let accountsValid = false;
  if (!Array.isArray(value.accounts)) {
    errors.push('accounts must be an array');
  } else {
    const seen = new Set();
    accountsValid = true;
    value.accounts.forEach((row, index) => {
      const before = errors.length;
      validateAccount(row, errors, index);
      if (errors.length !== before) accountsValid = false;
      if (isRecord(row) && typeof row.categoryPath === 'string') {
        if (seen.has(row.categoryPath)) { errors.push(`accounts[${index}] is a duplicate categoryPath`); accountsValid = false; }
        seen.add(row.categoryPath);
      }
    });
  }

  if (!hasExactKeys(value.totals, TOTALS_KEYS)) {
    errors.push('totals must contain exactly the balance sheet totals fields');
  } else {
    for (const key of TOTALS_KEYS) {
      if (!Number.isInteger(value.totals[key])) errors.push(`totals.${key} must be integer cents`);
    }
  }

  let equityReclassValid = false;
  if (!hasExactKeys(value.equityReclass, EQUITY_RECLASS_KEYS)) {
    errors.push('equityReclass must contain exactly the equity reclassification fields');
  } else {
    equityReclassValid = true;
    for (const key of ['donorRestrictedCents', 'unrestrictedCents', 'totalEquityCents']) {
      if (!Number.isInteger(value.equityReclass[key])) { errors.push(`equityReclass.${key} must be integer cents`); equityReclassValid = false; }
    }
    if (!hasExactKeys(value.equityReclass.breakdown, BREAKDOWN_KEYS)) {
      errors.push('equityReclass.breakdown must contain exactly perpetual, purpose_time, and designated');
      equityReclassValid = false;
    } else {
      for (const key of BREAKDOWN_KEYS) {
        const entry = value.equityReclass.breakdown[key];
        if (!hasExactKeys(entry, BREAKDOWN_ENTRY_KEYS)) {
          errors.push(`equityReclass.breakdown.${key} must contain exactly label and cents`);
          equityReclassValid = false;
        } else {
          if (entry.label !== BREAKDOWN_LABELS[key]) { errors.push(`equityReclass.breakdown.${key}.label must be "${BREAKDOWN_LABELS[key]}"`); equityReclassValid = false; }
          if (!Number.isInteger(entry.cents)) { errors.push(`equityReclass.breakdown.${key}.cents must be integer cents`); equityReclassValid = false; }
        }
      }
    }
    if (!Array.isArray(value.equityReclass.unclassified)) {
      errors.push('equityReclass.unclassified must be an array');
      equityReclassValid = false;
    } else {
      value.equityReclass.unclassified.forEach((row, index) => {
        const before = errors.length;
        validateUnclassified(row, errors, index);
        if (errors.length !== before) equityReclassValid = false;
      });
    }
    if (equityReclassValid && value.equityReclass.donorRestrictedCents + value.equityReclass.unrestrictedCents !== value.equityReclass.totalEquityCents) {
      errors.push('equityReclass.donorRestrictedCents + unrestrictedCents must equal totalEquityCents');
      equityReclassValid = false;
    }
    if (equityReclassValid) {
      const breakdownSum = BREAKDOWN_KEYS.reduce((total, key) => total + value.equityReclass.breakdown[key].cents, 0);
      if (breakdownSum !== value.equityReclass.donorRestrictedCents) {
        errors.push('equityReclass.donorRestrictedCents must equal the sum of every breakdown bucket');
      }
    }
    if (equityReclassValid && hasExactKeys(value.totals, TOTALS_KEYS) && Number.isInteger(value.totals.equityCents)
        && value.equityReclass.totalEquityCents !== value.totals.equityCents) {
      // Production computes both from the SAME already-reclassified rows -- see this file's
      // header comment on why equityReclass reads the transformed rows too.
      errors.push('equityReclass.totalEquityCents must equal totals.equityCents');
    }
  }

  if (!hasExactKeys(value.reconciliation, RECONCILIATION_KEYS)) {
    errors.push('reconciliation must contain exactly the balance sheet reconciliation fields');
  } else {
    for (const key of ['accountCount', 'assetsCount', 'liabilitiesCount', 'equityCount', 'unclassifiedEquityCount']) {
      if (!Number.isInteger(value.reconciliation[key]) || value.reconciliation[key] < 0) {
        errors.push(`reconciliation.${key} must be a nonnegative integer`);
      }
    }
    if (value.reconciliation.totalsMatch !== true) errors.push('reconciliation.totalsMatch must be true');
    if (accountsValid) {
      const countBy = (cls) => value.accounts.filter((a) => a.classification === cls).length;
      if (value.reconciliation.accountCount !== value.accounts.length) errors.push('reconciliation.accountCount must equal accounts.length');
      if (value.reconciliation.assetsCount !== countBy('Assets')) errors.push('reconciliation.assetsCount does not match accounts');
      if (value.reconciliation.liabilitiesCount !== countBy('Liabilities')) errors.push('reconciliation.liabilitiesCount does not match accounts');
      if (value.reconciliation.equityCount !== countBy('Equity')) errors.push('reconciliation.equityCount does not match accounts');
    }
    if (equityReclassValid && Array.isArray(value.equityReclass.unclassified)
        && value.reconciliation.unclassifiedEquityCount !== value.equityReclass.unclassified.length) {
      errors.push('reconciliation.unclassifiedEquityCount does not match equityReclass.unclassified');
    }
  }

  // Cross-checks against the accounts array itself -- the same "never trust the arithmetic
  // without re-deriving it" discipline the other contract consumers apply. Deliberately sums
  // EVERY row of a classification, hasChildren included -- see this file's header comment on the
  // real has_children-with-a-nonzero-balance rows production actually has.
  if (accountsValid && hasExactKeys(value.totals, TOTALS_KEYS) && value.totals.assetsCents !== undefined
      && value.accounts.every((a) => Number.isInteger(a.ownBalanceCents) && CLASSIFICATIONS.has(a.classification))) {
    const sumBy = (cls) => value.accounts.filter((a) => a.classification === cls).reduce((t, a) => t + a.ownBalanceCents, 0);
    const assetsCents = sumBy('Assets'), liabilitiesCents = sumBy('Liabilities'), equityCents = sumBy('Equity');
    let currentAssetsCents = 0, fixedAssetsCents = 0;
    for (const account of value.accounts) {
      if (account.classification !== 'Assets') continue;
      const group = assetGroupOf(account.categoryPath);
      if (group === 'current') currentAssetsCents += account.ownBalanceCents;
      else if (group === 'fixed') fixedAssetsCents += account.ownBalanceCents;
    }
    const otherAssetsCents = assetsCents - currentAssetsCents - fixedAssetsCents;

    if (Number.isInteger(value.totals.assetsCents) && value.totals.assetsCents !== assetsCents) {
      errors.push('totals.assetsCents must equal the sum of every Assets account');
    }
    if (Number.isInteger(value.totals.liabilitiesCents) && value.totals.liabilitiesCents !== liabilitiesCents) {
      errors.push('totals.liabilitiesCents must equal the sum of every Liabilities account');
    }
    if (Number.isInteger(value.totals.equityCents) && value.totals.equityCents !== equityCents) {
      errors.push('totals.equityCents must equal the sum of every Equity account');
    }
    if (Number.isInteger(value.totals.currentAssetsCents) && value.totals.currentAssetsCents !== currentAssetsCents) {
      errors.push('totals.currentAssetsCents must equal the sum of Assets accounts grouped "current"');
    }
    if (Number.isInteger(value.totals.fixedAssetsCents) && value.totals.fixedAssetsCents !== fixedAssetsCents) {
      errors.push('totals.fixedAssetsCents must equal the sum of Assets accounts grouped "fixed"');
    }
    if (Number.isInteger(value.totals.otherAssetsCents) && value.totals.otherAssetsCents !== otherAssetsCents) {
      errors.push('totals.otherAssetsCents must equal assetsCents minus currentAssetsCents minus fixedAssetsCents');
    }
    if (Number.isInteger(value.totals.liabilitiesPlusEquityCents) && value.totals.liabilitiesPlusEquityCents !== liabilitiesCents + equityCents) {
      errors.push('totals.liabilitiesPlusEquityCents must equal liabilitiesCents + equityCents');
    }
    if (Number.isInteger(value.totals.balancedCents) && value.totals.balancedCents !== assetsCents - (liabilitiesCents + equityCents)) {
      errors.push('totals.balancedCents must equal assetsCents - (liabilitiesCents + equityCents)');
    }
  }

  return { ok: errors.length === 0, errors };
}

export function acceptFinanceBalanceSheetV1(value) {
  const validation = validateFinanceBalanceSheetV1(value);
  if (!validation.ok) throw new TypeError(`Rejected ${CONTRACT}: ${validation.errors.join('; ')}`);
  return {
    contract: value.contract,
    dataClassification: value.dataClassification,
    sourceProduct: value.sourceProduct,
    consumerProduct: value.consumerProduct,
    currency: value.currency,
    fiscalYear: value.fiscalYear,
    asOfDate: value.asOfDate,
    generatedAt: value.generatedAt,
    accounts: value.accounts.map((row) => ({ ...row })),
    totals: { ...value.totals },
    equityReclass: {
      ...value.equityReclass,
      breakdown: Object.fromEntries(Object.entries(value.equityReclass.breakdown).map(([key, entry]) => [key, { ...entry }])),
      unclassified: value.equityReclass.unclassified.map((row) => ({ ...row })),
    },
    reconciliation: { ...value.reconciliation },
  };
}
