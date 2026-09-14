// ── Fail-closed parser for connect.finance-daycare-report.v1 ────────────────────────────────
// Same shape/discipline as the other contract consumers in this directory: closed key sets (an
// unknown field anywhere fails closed), no I/O, and a pure validate/accept pair so producer
// (src/api-contracts.js) and consumer can never silently drift apart.
//
// This is NOT a myMDO cross-product read -- see src/api-contracts.js's module comment above
// buildFinanceDaycareReportV1 for the full reasoning. It reads finance_daycare_entries rows Finance
// already owns and counts, restricted to the two sources Andrew's own explicit decision counts as
// the Daycare Report's real totals (source='church_budget_import' and 'manual_budget_override') --
// the separate myMDO-sourced sync (source='daycare_api') and one-off source='manual' rows are
// deliberately excluded, exactly as production excludes them.
//
// category is a closed 8-value set -- classifyMdoAccountCategory() (src/api-finance.js) can only
// ever produce 6 of them, and the remaining 2 ('Utilities'/'Insurance') are the live-derived
// church-side allocation lines, never a stored finance_daycare_entries row. classification must
// correspond exactly: 'Income' for 'Tuition Income' only, 'Expenses' for every other category --
// unlike Church Report, there is no Other Income/Cost of Goods Sold concept here.
//
// allocation.mdoUtilityCents/mdoInsuranceCents must be the rounded percentage of
// churchUtilityActualCents/churchInsuranceActualCents -- cross-checked below, matching
// computeMdoUtilityInsuranceAllocation()'s own Math.round() exactly. When a 'Utilities' or
// 'Insurance' category is present, its actualCents must equal the corresponding allocation figure
// -- the two sections of this contract must never disagree with each other.
const CONTRACT = 'connect.finance-daycare-report.v1';
const ROOT_KEYS = [
  'contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'currency',
  'fiscalYear', 'generatedAt', 'categories', 'allocation', 'totals', 'reconciliation',
];
const CATEGORY_KEYS = ['category', 'classification', 'actualCents', 'budgetCents'];
const ALLOCATION_KEYS = [
  'utilityPct', 'insurancePct', 'churchUtilityActualCents', 'churchInsuranceActualCents',
  'mdoUtilityCents', 'mdoInsuranceCents',
];
const TOTALS_KEYS = [
  'incomeActualCents', 'incomeBudgetCents', 'expenseActualCents', 'expenseBudgetCents',
  'netActualCents', 'netBudgetCents',
];
const RECONCILIATION_KEYS = ['categoryCount', 'incomeCategoryCount', 'expenseCategoryCount', 'totalsMatch'];
// Every category classifyMdoAccountCategory() (src/api-finance.js) can produce, plus the two
// live-derived allocation categories. A closed set -- an unrecognized category fails closed rather
// than being passed through as an unknown line item.
const CATEGORIES = new Set([
  'Tuition Income', 'Payroll', 'Payroll Taxes', 'Workers Comp', 'Other Payroll Expenses',
  'Utilities', 'Insurance', 'Other Expenses',
]);
const INCOME_CATEGORIES = new Set(['Tuition Income']);

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

function isFraction(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateCategory(row, errors, index) {
  const label = `categories[${index}]`;
  if (!hasExactKeys(row, CATEGORY_KEYS)) {
    errors.push(`${label} must contain exactly the daycare report category fields`);
    return;
  }
  if (!CATEGORIES.has(row.category)) errors.push(`${label}.category must be a recognized Daycare Report category`);
  if (row.classification !== 'Income' && row.classification !== 'Expenses') {
    errors.push(`${label}.classification must be Income or Expenses`);
  } else if (CATEGORIES.has(row.category)) {
    const expected = INCOME_CATEGORIES.has(row.category) ? 'Income' : 'Expenses';
    if (row.classification !== expected) errors.push(`${label}.classification must be ${expected} for category '${row.category}'`);
  }
  if (!Number.isInteger(row.actualCents)) errors.push(`${label}.actualCents must be integer cents`);
  if (!Number.isInteger(row.budgetCents)) errors.push(`${label}.budgetCents must be integer cents`);
}

export function validateFinanceDaycareReportV1(value) {
  const errors = [];
  if (!hasExactKeys(value, ROOT_KEYS)) {
    return { ok: false, errors: ['root must contain exactly the connect.finance-daycare-report.v1 fields'] };
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

  if (!Array.isArray(value.categories)) {
    errors.push('categories must be an array');
  } else {
    const seen = new Set();
    value.categories.forEach((row, index) => {
      validateCategory(row, errors, index);
      if (isRecord(row) && typeof row.category === 'string') {
        if (seen.has(row.category)) errors.push(`categories[${index}] is a duplicate category`);
        seen.add(row.category);
      }
    });
  }

  if (!hasExactKeys(value.allocation, ALLOCATION_KEYS)) {
    errors.push('allocation must contain exactly the daycare allocation fields');
  } else {
    if (!isFraction(value.allocation.utilityPct)) errors.push('allocation.utilityPct must be a fraction between 0 and 1');
    if (!isFraction(value.allocation.insurancePct)) errors.push('allocation.insurancePct must be a fraction between 0 and 1');
    for (const key of ['churchUtilityActualCents', 'churchInsuranceActualCents', 'mdoUtilityCents', 'mdoInsuranceCents']) {
      if (!Number.isInteger(value.allocation[key]) || value.allocation[key] < 0) {
        errors.push(`allocation.${key} must be a nonnegative integer`);
      }
    }
    if (Number.isInteger(value.allocation.churchUtilityActualCents) && isFraction(value.allocation.utilityPct)
        && Number.isInteger(value.allocation.mdoUtilityCents)) {
      const expected = Math.round(value.allocation.churchUtilityActualCents * value.allocation.utilityPct);
      if (value.allocation.mdoUtilityCents !== expected) errors.push('allocation.mdoUtilityCents must equal churchUtilityActualCents * utilityPct, rounded');
    }
    if (Number.isInteger(value.allocation.churchInsuranceActualCents) && isFraction(value.allocation.insurancePct)
        && Number.isInteger(value.allocation.mdoInsuranceCents)) {
      const expected = Math.round(value.allocation.churchInsuranceActualCents * value.allocation.insurancePct);
      if (value.allocation.mdoInsuranceCents !== expected) errors.push('allocation.mdoInsuranceCents must equal churchInsuranceActualCents * insurancePct, rounded');
    }
  }

  // Cross-check the two sections of this contract never disagree with each other.
  if (Array.isArray(value.categories) && isRecord(value.allocation)) {
    const utilities = value.categories.find((c) => isRecord(c) && c.category === 'Utilities');
    if (utilities && Number.isInteger(value.allocation.mdoUtilityCents) && utilities.actualCents !== value.allocation.mdoUtilityCents) {
      errors.push("categories 'Utilities'.actualCents must equal allocation.mdoUtilityCents");
    }
    const insurance = value.categories.find((c) => isRecord(c) && c.category === 'Insurance');
    if (insurance && Number.isInteger(value.allocation.mdoInsuranceCents) && insurance.actualCents !== value.allocation.mdoInsuranceCents) {
      errors.push("categories 'Insurance'.actualCents must equal allocation.mdoInsuranceCents");
    }
  }

  if (!hasExactKeys(value.totals, TOTALS_KEYS)) {
    errors.push('totals must contain exactly the daycare report totals fields');
  } else {
    for (const key of TOTALS_KEYS) {
      if (!Number.isInteger(value.totals[key])) errors.push(`totals.${key} must be integer cents`);
    }
  }

  if (!hasExactKeys(value.reconciliation, RECONCILIATION_KEYS)) {
    errors.push('reconciliation must contain exactly the daycare report reconciliation fields');
  } else {
    for (const key of ['categoryCount', 'incomeCategoryCount', 'expenseCategoryCount']) {
      if (!Number.isInteger(value.reconciliation[key]) || value.reconciliation[key] < 0) {
        errors.push(`reconciliation.${key} must be a nonnegative integer`);
      }
    }
    if (value.reconciliation.totalsMatch !== true) errors.push('reconciliation.totalsMatch must be true');
    if (Array.isArray(value.categories)) {
      const countBy = (cls) => value.categories.filter((c) => isRecord(c) && c.classification === cls).length;
      if (value.reconciliation.categoryCount !== value.categories.length) errors.push('reconciliation.categoryCount must equal categories.length');
      if (value.reconciliation.incomeCategoryCount !== countBy('Income')) errors.push('reconciliation.incomeCategoryCount does not match categories');
      if (value.reconciliation.expenseCategoryCount !== countBy('Expenses')) errors.push('reconciliation.expenseCategoryCount does not match categories');
    }
  }

  // Cross-checks against the categories array itself -- never trust the arithmetic without
  // re-deriving it, same discipline as every other contract's consumer.
  if (Array.isArray(value.categories) && hasExactKeys(value.totals, TOTALS_KEYS)
      && value.categories.every((c) => isRecord(c) && Number.isInteger(c.actualCents) && Number.isInteger(c.budgetCents)
        && (c.classification === 'Income' || c.classification === 'Expenses'))) {
    const sum = (cls, key) => value.categories.filter((c) => c.classification === cls).reduce((t, c) => t + c[key], 0);
    const incomeActual = sum('Income', 'actualCents'), expenseActual = sum('Expenses', 'actualCents');
    const incomeBudget = sum('Income', 'budgetCents'), expenseBudget = sum('Expenses', 'budgetCents');
    if (value.totals.incomeActualCents !== incomeActual) errors.push('totals.incomeActualCents must equal the sum of Income actual amounts');
    if (value.totals.expenseActualCents !== expenseActual) errors.push('totals.expenseActualCents must equal the sum of Expenses actual amounts');
    if (value.totals.incomeBudgetCents !== incomeBudget) errors.push('totals.incomeBudgetCents must equal the sum of Income budget amounts');
    if (value.totals.expenseBudgetCents !== expenseBudget) errors.push('totals.expenseBudgetCents must equal the sum of Expenses budget amounts');
    if (Number.isInteger(value.totals.incomeActualCents) && Number.isInteger(value.totals.expenseActualCents)
        && value.totals.netActualCents !== value.totals.incomeActualCents - value.totals.expenseActualCents) {
      errors.push('totals.netActualCents must equal incomeActualCents - expenseActualCents');
    }
    if (Number.isInteger(value.totals.incomeBudgetCents) && Number.isInteger(value.totals.expenseBudgetCents)
        && value.totals.netBudgetCents !== value.totals.incomeBudgetCents - value.totals.expenseBudgetCents) {
      errors.push('totals.netBudgetCents must equal incomeBudgetCents - expenseBudgetCents');
    }
  }

  return { ok: errors.length === 0, errors };
}

export function acceptFinanceDaycareReportV1(value) {
  const validation = validateFinanceDaycareReportV1(value);
  if (!validation.ok) throw new TypeError(`Rejected ${CONTRACT}: ${validation.errors.join('; ')}`);
  return {
    contract: value.contract,
    dataClassification: value.dataClassification,
    sourceProduct: value.sourceProduct,
    consumerProduct: value.consumerProduct,
    currency: value.currency,
    fiscalYear: value.fiscalYear,
    generatedAt: value.generatedAt,
    categories: value.categories.map((row) => ({ ...row })),
    allocation: { ...value.allocation },
    totals: { ...value.totals },
    reconciliation: { ...value.reconciliation },
  };
}
