// ── Fail-closed parser for connect.finance-church-report.v1 ─────────────────────────────────
// Same shape/discipline as the other contract consumers in this directory: closed key sets (an
// unknown field anywhere fails closed), no I/O, and a pure validate/accept pair so producer
// (src/api-contracts.js) and consumer can never silently drift apart.
//
// This is the same finance_church_entries table Chart of Accounts' contract already reads, scoped
// to one fiscal year and carrying the real actual/budget dollar figures Chart of Accounts
// deliberately excludes -- so this contract is 'aggregate' (real money crosses it), like Giving,
// not 'structural' like Chart of Accounts.
//
// budgetCents is genuinely nullable per account in real data -- a 2026-09-14 check of production
// found accounts with a real actual and no budget entered at all, even within a single winning
// year/source (11 of 126 accounts, every year, in the multi-year 'import_activity' source). This
// must validate cleanly the same way Budget's growthPct/baseAmountCents nullability does; a
// consumer that required every account to carry a budget would reject real, common production data.
//
// classification covers every section finance_church_entries can actually hold (confirmed
// 2026-09-14: production has real 'Other Income' and 'Other Expenses' rows today, not just
// 'Income'/'Expenses') -- 'Cost of Goods Sold' is included too since it is a valid QuickBooks
// section this church has simply never posted to, not one the schema forbids.
//
// totals.incomeActualCents/incomeBudgetCents and expenseActualCents/expenseBudgetCents are ONLY
// the 'Income'/'Expenses' classifications, matching production's own "Total revenue"/"Total
// expenses" cards exactly (they do not blend in Other Income/Other Expenses). totals.netIncome*
// is the full bottom line (income - COGS - expenses, adjusted for other income/expenses) --
// matching production's own net-income figure, which does fold those other classifications in.
const CONTRACT = 'connect.finance-church-report.v1';
const ROOT_KEYS = [
  'contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'currency',
  'fiscalYear', 'generatedAt', 'accounts', 'totals', 'reconciliation',
];
const ACCOUNT_KEYS = ['classification', 'categoryPath', 'accountName', 'depth', 'hasChildren', 'actualCents', 'budgetCents', 'source'];
const TOTALS_KEYS = [
  'incomeActualCents', 'incomeBudgetCents', 'expenseActualCents', 'expenseBudgetCents',
  'netIncomeActualCents', 'netIncomeBudgetCents', 'hasBudgetData',
];
const RECONCILIATION_KEYS = [
  'accountCount', 'incomeCount', 'expenseCount', 'otherIncomeCount', 'otherExpenseCount',
  'costOfGoodsSoldCount', 'accountsWithBudgetCount', 'totalsMatch',
];
const CLASSIFICATIONS = new Set(['Income', 'Expenses', 'Other Income', 'Other Expenses', 'Cost of Goods Sold']);
// Every source resolveChurchYearPrecedence() (src/api-finance.js) can hand back for an annual
// (period_month=0) row: the four CHURCH_SOURCE_PRIORITY tiers plus the per-account override tier.
const SOURCES = new Set(['qbo_sync', 'import', 'import_activity', 'plan_committed', 'manual_actual_override']);

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

function isNullableInteger(value) {
  return value === null || Number.isInteger(value);
}

function validateAccount(row, errors, index) {
  const label = `accounts[${index}]`;
  if (!hasExactKeys(row, ACCOUNT_KEYS)) {
    errors.push(`${label} must contain exactly the church report account fields`);
    return;
  }
  if (!CLASSIFICATIONS.has(row.classification)) errors.push(`${label}.classification must be a valid P&L classification`);
  if (!isNonEmptyString(row.categoryPath)) errors.push(`${label}.categoryPath must be a non-empty string`);
  if (!isNonEmptyString(row.accountName)) errors.push(`${label}.accountName must be a non-empty string`);
  if (!Number.isInteger(row.depth) || row.depth < 0) errors.push(`${label}.depth must be a nonnegative integer`);
  if (typeof row.hasChildren !== 'boolean') errors.push(`${label}.hasChildren must be a boolean`);
  if (!Number.isInteger(row.actualCents)) errors.push(`${label}.actualCents must be integer cents`);
  if (!isNullableInteger(row.budgetCents)) errors.push(`${label}.budgetCents must be null or integer cents`);
  if (!SOURCES.has(row.source)) errors.push(`${label}.source must be a recognized finance_church_entries source`);
}

export function validateFinanceChurchReportV1(value) {
  const errors = [];
  if (!hasExactKeys(value, ROOT_KEYS)) {
    return { ok: false, errors: ['root must contain exactly the connect.finance-church-report.v1 fields'] };
  }
  if (value.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
  if (value.dataClassification !== 'aggregate') errors.push('dataClassification must be aggregate');
  if (value.sourceProduct !== 'connect') errors.push('sourceProduct must be connect');
  if (value.consumerProduct !== 'finance') errors.push('consumerProduct must be finance');
  if (value.currency !== 'USD') errors.push('currency must be USD');
  if (!Number.isInteger(value.fiscalYear) || value.fiscalYear < 2000 || value.fiscalYear > 2100) {
    errors.push('fiscalYear must be a 4-digit integer year');
  }
  if (!isDateTime(value.generatedAt)) errors.push('generatedAt must be an RFC 3339 UTC timestamp');

  if (!Array.isArray(value.accounts)) {
    errors.push('accounts must be an array');
  } else {
    const seen = new Set();
    value.accounts.forEach((row, index) => {
      validateAccount(row, errors, index);
      if (isRecord(row) && typeof row.categoryPath === 'string') {
        if (seen.has(row.categoryPath)) errors.push(`accounts[${index}] is a duplicate categoryPath`);
        seen.add(row.categoryPath);
      }
    });
  }

  if (!hasExactKeys(value.totals, TOTALS_KEYS)) {
    errors.push('totals must contain exactly the church report totals fields');
  } else {
    for (const key of ['incomeActualCents', 'incomeBudgetCents', 'expenseActualCents', 'expenseBudgetCents', 'netIncomeActualCents', 'netIncomeBudgetCents']) {
      if (!Number.isInteger(value.totals[key])) errors.push(`totals.${key} must be integer cents`);
    }
    if (typeof value.totals.hasBudgetData !== 'boolean') errors.push('totals.hasBudgetData must be a boolean');
  }

  if (!hasExactKeys(value.reconciliation, RECONCILIATION_KEYS)) {
    errors.push('reconciliation must contain exactly the church report reconciliation fields');
  } else {
    for (const key of ['accountCount', 'incomeCount', 'expenseCount', 'otherIncomeCount', 'otherExpenseCount', 'costOfGoodsSoldCount', 'accountsWithBudgetCount']) {
      if (!Number.isInteger(value.reconciliation[key]) || value.reconciliation[key] < 0) {
        errors.push(`reconciliation.${key} must be a nonnegative integer`);
      }
    }
    if (value.reconciliation.totalsMatch !== true) errors.push('reconciliation.totalsMatch must be true');
    if (Array.isArray(value.accounts)) {
      const countBy = (cls) => value.accounts.filter((a) => isRecord(a) && a.classification === cls).length;
      const withBudget = value.accounts.filter((a) => isRecord(a) && a.budgetCents !== null).length;
      if (value.reconciliation.accountCount !== value.accounts.length) errors.push('reconciliation.accountCount must equal accounts.length');
      if (value.reconciliation.incomeCount !== countBy('Income')) errors.push('reconciliation.incomeCount does not match accounts');
      if (value.reconciliation.expenseCount !== countBy('Expenses')) errors.push('reconciliation.expenseCount does not match accounts');
      if (value.reconciliation.otherIncomeCount !== countBy('Other Income')) errors.push('reconciliation.otherIncomeCount does not match accounts');
      if (value.reconciliation.otherExpenseCount !== countBy('Other Expenses')) errors.push('reconciliation.otherExpenseCount does not match accounts');
      if (value.reconciliation.costOfGoodsSoldCount !== countBy('Cost of Goods Sold')) errors.push('reconciliation.costOfGoodsSoldCount does not match accounts');
      if (value.reconciliation.accountsWithBudgetCount !== withBudget) errors.push('reconciliation.accountsWithBudgetCount does not match accounts');
    }
  }

  // Cross-checks against the accounts array itself -- the same "never trust the arithmetic without
  // re-deriving it" discipline the Budget and Giving consumers apply.
  if (Array.isArray(value.accounts) && hasExactKeys(value.totals, TOTALS_KEYS)
      && value.accounts.every((a) => isRecord(a) && Number.isInteger(a.actualCents) && isNullableInteger(a.budgetCents) && CLASSIFICATIONS.has(a.classification))) {
    const sumActual = (cls) => value.accounts.filter((a) => a.classification === cls).reduce((t, a) => t + a.actualCents, 0);
    const sumBudget = (cls) => value.accounts.filter((a) => a.classification === cls && a.budgetCents !== null).reduce((t, a) => t + a.budgetCents, 0);
    const incomeActual = sumActual('Income'), expenseActual = sumActual('Expenses');
    const incomeBudget = sumBudget('Income'), expenseBudget = sumBudget('Expenses');
    const cogsActual = sumActual('Cost of Goods Sold'), cogsBudget = sumBudget('Cost of Goods Sold');
    const otherIncomeActual = sumActual('Other Income'), otherIncomeBudget = sumBudget('Other Income');
    const otherExpenseActual = sumActual('Other Expenses'), otherExpenseBudget = sumBudget('Other Expenses');
    const grossProfitActual = incomeActual - cogsActual, grossProfitBudget = incomeBudget - cogsBudget;
    const netOperatingActual = grossProfitActual - expenseActual, netOperatingBudget = grossProfitBudget - expenseBudget;
    const netOtherActual = otherIncomeActual - otherExpenseActual, netOtherBudget = otherIncomeBudget - otherExpenseBudget;
    const netIncomeActual = netOperatingActual + netOtherActual, netIncomeBudget = netOperatingBudget + netOtherBudget;

    if (Number.isInteger(value.totals.incomeActualCents) && value.totals.incomeActualCents !== incomeActual) {
      errors.push('totals.incomeActualCents must equal the sum of Income actual amounts');
    }
    if (Number.isInteger(value.totals.expenseActualCents) && value.totals.expenseActualCents !== expenseActual) {
      errors.push('totals.expenseActualCents must equal the sum of Expenses actual amounts');
    }
    if (Number.isInteger(value.totals.incomeBudgetCents) && value.totals.incomeBudgetCents !== incomeBudget) {
      errors.push('totals.incomeBudgetCents must equal the sum of Income budget amounts actually set');
    }
    if (Number.isInteger(value.totals.expenseBudgetCents) && value.totals.expenseBudgetCents !== expenseBudget) {
      errors.push('totals.expenseBudgetCents must equal the sum of Expenses budget amounts actually set');
    }
    if (Number.isInteger(value.totals.netIncomeActualCents) && value.totals.netIncomeActualCents !== netIncomeActual) {
      errors.push('totals.netIncomeActualCents must equal the reconciled Income - COGS - Expenses +/- Other Income/Expenses actual result');
    }
    if (Number.isInteger(value.totals.netIncomeBudgetCents) && value.totals.netIncomeBudgetCents !== netIncomeBudget) {
      errors.push('totals.netIncomeBudgetCents must equal the reconciled Income - COGS - Expenses +/- Other Income/Expenses budget result');
    }
  }

  return { ok: errors.length === 0, errors };
}

export function acceptFinanceChurchReportV1(value) {
  const validation = validateFinanceChurchReportV1(value);
  if (!validation.ok) throw new TypeError(`Rejected ${CONTRACT}: ${validation.errors.join('; ')}`);
  return {
    contract: value.contract,
    dataClassification: value.dataClassification,
    sourceProduct: value.sourceProduct,
    consumerProduct: value.consumerProduct,
    currency: value.currency,
    fiscalYear: value.fiscalYear,
    generatedAt: value.generatedAt,
    accounts: value.accounts.map((row) => ({ ...row })),
    totals: { ...value.totals },
    reconciliation: { ...value.reconciliation },
  };
}
