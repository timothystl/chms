// ── Fail-closed parser for connect.finance-church-report-trend.v1 ──────────────────────────────
// Same shape/discipline as finance-church-report-consumer.js and every other contract consumer in
// this directory: closed key sets (an unknown field anywhere fails closed), no I/O, and a pure
// validate/accept pair so producer (src/api-contracts.js) and consumer can never silently drift
// apart.
//
// This is the last Church Report sub-page still on the synthetic reader (see
// src/api-contracts.js's buildFinanceChurchReportTrendV1 for the full production-data
// investigation). It applies the SAME resolveChurchYearPrecedence()/computeYearSummary() pair the
// single-year connect.finance-church-report.v1 contract uses, independently to every fiscal year
// found in finance_church_entries, rather than a fresh "latest row wins" query of its own -- see
// that contract's own comment for why a per-account query would be wrong here (CHURCH_SOURCE_
// PRIORITY must win a source WHOLESALE per year).
//
// Deliberately actual-only, unlike the single-year contract: production's own existing multi-year
// trend chart/table (src/frontend/js-finance.js's finRenderChurchMultiYear) shows Income, Expenses,
// and Net Income -- never a budget column or series -- so there is no budgetCents field here to
// match. Adding one would not be matching production, it would be inventing a new view.
//
// otherIncomeActualCents/otherExpenseActualCents/costOfGoodsSoldActualCents are carried per year so
// this consumer can independently re-derive netIncomeActualCents rather than trust it blindly --
// the same "never trust the arithmetic without re-deriving it" discipline the single-year Church
// Report consumer applies to its own totals from its `accounts` array. A 2026-09-15 check of
// production found netIncomeActualCents genuinely differs from a naive incomeActualCents minus
// expenseActualCents in three of the eight fiscal years on file (2019, 2021, 2024 all carry
// nonzero Other Income/Other Expenses) -- exactly the case this cross-check exists to catch.
const CONTRACT = 'connect.finance-church-report-trend.v1';
const ROOT_KEYS = [
  'contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'currency',
  'generatedAt', 'years', 'reconciliation',
];
const YEAR_KEYS = [
  'fiscalYear', 'incomeActualCents', 'expenseActualCents', 'otherIncomeActualCents',
  'otherExpenseActualCents', 'costOfGoodsSoldActualCents', 'netIncomeActualCents', 'accountCount',
];
const RECONCILIATION_KEYS = ['yearCount', 'totalsMatch'];

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

function isFiscalYear(value) {
  return Number.isInteger(value) && value >= 2000 && value <= 2100;
}

function validateYear(row, errors, index) {
  const label = `years[${index}]`;
  if (!hasExactKeys(row, YEAR_KEYS)) {
    errors.push(`${label} must contain exactly the church report trend year fields`);
    return;
  }
  if (!isFiscalYear(row.fiscalYear)) errors.push(`${label}.fiscalYear must be a 4-digit integer year`);
  for (const key of ['incomeActualCents', 'expenseActualCents', 'otherIncomeActualCents', 'otherExpenseActualCents', 'costOfGoodsSoldActualCents', 'netIncomeActualCents']) {
    if (!Number.isInteger(row[key])) errors.push(`${label}.${key} must be integer cents`);
  }
  if (!Number.isInteger(row.accountCount) || row.accountCount < 0) errors.push(`${label}.accountCount must be a nonnegative integer`);
  if (Number.isInteger(row.incomeActualCents) && Number.isInteger(row.expenseActualCents)
      && Number.isInteger(row.otherIncomeActualCents) && Number.isInteger(row.otherExpenseActualCents)
      && Number.isInteger(row.costOfGoodsSoldActualCents) && Number.isInteger(row.netIncomeActualCents)) {
    const expectedNet = (row.incomeActualCents - row.costOfGoodsSoldActualCents - row.expenseActualCents)
      + (row.otherIncomeActualCents - row.otherExpenseActualCents);
    if (row.netIncomeActualCents !== expectedNet) {
      errors.push(`${label}.netIncomeActualCents must equal the reconciled Income - COGS - Expenses +/- Other Income/Expenses actual result`);
    }
  }
}

export function validateFinanceChurchReportTrendV1(value) {
  const errors = [];
  if (!hasExactKeys(value, ROOT_KEYS)) {
    return { ok: false, errors: ['root must contain exactly the connect.finance-church-report-trend.v1 fields'] };
  }
  if (value.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
  if (value.dataClassification !== 'aggregate') errors.push('dataClassification must be aggregate');
  if (value.sourceProduct !== 'connect') errors.push('sourceProduct must be connect');
  if (value.consumerProduct !== 'finance') errors.push('consumerProduct must be finance');
  if (value.currency !== 'USD') errors.push('currency must be USD');
  if (!isDateTime(value.generatedAt)) errors.push('generatedAt must be an RFC 3339 UTC timestamp');

  if (!Array.isArray(value.years)) {
    errors.push('years must be an array');
  } else {
    const seen = new Set();
    value.years.forEach((row, index) => {
      validateYear(row, errors, index);
      if (isRecord(row) && isFiscalYear(row.fiscalYear)) {
        if (seen.has(row.fiscalYear)) errors.push(`years[${index}] is a duplicate fiscalYear`);
        seen.add(row.fiscalYear);
      }
    });
    // Ascending fiscal-year order, matching the synthetic reader this replaces
    // (readSyntheticChurchTrends' own `ORDER BY fiscal_year`) and the page's own table order.
    for (let i = 1; i < value.years.length; i++) {
      const prev = value.years[i - 1], cur = value.years[i];
      if (isRecord(prev) && isRecord(cur) && isFiscalYear(prev.fiscalYear) && isFiscalYear(cur.fiscalYear) && cur.fiscalYear <= prev.fiscalYear) {
        errors.push('years must be ordered by ascending fiscalYear');
        break;
      }
    }
  }

  if (!hasExactKeys(value.reconciliation, RECONCILIATION_KEYS)) {
    errors.push('reconciliation must contain exactly the church report trend reconciliation fields');
  } else {
    if (!Number.isInteger(value.reconciliation.yearCount) || value.reconciliation.yearCount < 0) {
      errors.push('reconciliation.yearCount must be a nonnegative integer');
    }
    if (Array.isArray(value.years) && value.reconciliation.yearCount !== value.years.length) {
      errors.push('reconciliation.yearCount must equal years.length');
    }
    if (value.reconciliation.totalsMatch !== true) errors.push('reconciliation.totalsMatch must be true');
  }

  return { ok: errors.length === 0, errors };
}

export function acceptFinanceChurchReportTrendV1(value) {
  const validation = validateFinanceChurchReportTrendV1(value);
  if (!validation.ok) throw new TypeError(`Rejected ${CONTRACT}: ${validation.errors.join('; ')}`);
  return {
    contract: value.contract,
    dataClassification: value.dataClassification,
    sourceProduct: value.sourceProduct,
    consumerProduct: value.consumerProduct,
    currency: value.currency,
    generatedAt: value.generatedAt,
    years: value.years.map((row) => ({ ...row })),
    reconciliation: { ...value.reconciliation },
  };
}
