// ── Fail-closed parser for connect.finance-balance-sheet-trend.v1 ───────────────────────────
// Same shape/discipline as finance-balance-sheet-consumer.js and every other consumer in this
// directory: closed key sets (an unknown field anywhere fails closed), no I/O, and a pure
// validate/accept pair so producer (src/api-contracts.js) and consumer can never silently drift
// apart.
//
// This is the multi-year sibling of connect.finance-balance-sheet.v1 -- one row per fiscal year
// on file (finance_church_balances), not one point-in-time snapshot for a single named year. It
// backs the 'balance' section's 'multi-year' page, which today reads the untouched synthetic
// fixture (apps/finance/balance-sheet-service.js's readSyntheticBalanceTrends) and only needs
// Fiscal year / As of / Assets / Liabilities / Net assets -- so unlike the single-year contract,
// this one carries no per-account detail and no Donor-Restricted/Unrestricted equityReclass
// breakdown; it is intentionally the bounded trend shape, not a repeated single-year contract.
//
// A direct 2026-09-14 production check (same day and same table as the single-year contract's own
// investigation) found exactly one distinct as_of_date per fiscal year across all eight fiscal
// years on file (2019-2026, 1,056 rows total) -- so, like the single-year contract, there is no
// MAX-style pick needed today. That same check also found as_of_date is NOT a consistently
// formatted date: FY2019-2025 store the literal placeholder string "FY2019".."FY2025", and only
// FY2026 stores a real formatted date ("December 31, 2026"). asOfDate is therefore validated only
// as a string here (may be empty for a fiscal year with nothing imported), never parsed or
// compared as a date -- sorting this contract's `years` array is done by fiscalYear (a real
// integer), never by asOfDate.
//
// netAssetsCents is the SAME figure the single-year contract's own 'position' page already shows
// as "Net assets" -- computeBalanceSummary's equityCents on the Designated-Funds-as-Equity
// reclassified rows (applyDesignatedFundsAsEquity), NOT a separately recomputed
// assetsCents-minus-liabilitiesCents. This matters because those two are only guaranteed equal
// when a year's books balance exactly (balancedCents === 0); every production year checked
// 2026-09-14 does balance to the penny, but the field is still named and defined as "net assets =
// total equity after reclassification" rather than "assets minus liabilities" so it can never
// silently diverge from what the single-year Balance Sheet page already calls "Net assets" for the
// same fiscal year. This also matches production's OWN existing multi-year Balance Sheet route
// (src/api-finance.js's `finance/church/balances/multi-year` GET handler, reused by the legacy
// Finance UI's "Net Worth Growth by Year" table in src/frontend/js-finance.js) -- both compute
// `computeBalanceSummary(applyDesignatedFundsAsEquity(yearRows)).equityCents` per year and its own
// caption literally reads "Change in total equity (assets minus liabilities)", treating the two as
// the same figure. See this contract's producer (src/api-contracts.js) for the full note.
const CONTRACT = 'connect.finance-balance-sheet-trend.v1';
const ROOT_KEYS = [
  'contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'currency',
  'generatedAt', 'years', 'reconciliation',
];
const YEAR_KEYS = [
  'fiscalYear', 'asOfDate', 'assetsCents', 'liabilitiesCents', 'equityCents', 'netAssetsCents', 'balancedCents',
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

function validateYear(row, errors, index) {
  const label = `years[${index}]`;
  if (!hasExactKeys(row, YEAR_KEYS)) {
    errors.push(`${label} must contain exactly the balance sheet trend year fields`);
    return;
  }
  if (!Number.isInteger(row.fiscalYear) || row.fiscalYear < 2000 || row.fiscalYear > 2100) {
    errors.push(`${label}.fiscalYear must be a 4-digit integer year`);
  }
  if (typeof row.asOfDate !== 'string') errors.push(`${label}.asOfDate must be a string (may be empty for a fiscal year with nothing imported yet)`);
  for (const key of ['assetsCents', 'liabilitiesCents', 'equityCents', 'netAssetsCents', 'balancedCents']) {
    if (!Number.isInteger(row[key])) errors.push(`${label}.${key} must be integer cents`);
  }
  if (Number.isInteger(row.equityCents) && Number.isInteger(row.netAssetsCents) && row.equityCents !== row.netAssetsCents) {
    // See this file's header comment: netAssetsCents is defined as equityCents (post
    // Designated-Funds-as-Equity reclassification), never a separately recomputed
    // assets-minus-liabilities figure -- the two fields must always agree by construction.
    errors.push(`${label}.netAssetsCents must equal ${label}.equityCents`);
  }
  if (Number.isInteger(row.assetsCents) && Number.isInteger(row.liabilitiesCents) && Number.isInteger(row.equityCents) && Number.isInteger(row.balancedCents)
    && row.balancedCents !== row.assetsCents - (row.liabilitiesCents + row.equityCents)) {
    errors.push(`${label}.balancedCents must equal assetsCents - (liabilitiesCents + equityCents)`);
  }
}

export function validateFinanceBalanceSheetTrendV1(value) {
  const errors = [];
  if (!hasExactKeys(value, ROOT_KEYS)) {
    return { ok: false, errors: ['root must contain exactly the connect.finance-balance-sheet-trend.v1 fields'] };
  }
  if (value.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
  if (value.dataClassification !== 'aggregate') errors.push('dataClassification must be aggregate');
  if (value.sourceProduct !== 'connect') errors.push('sourceProduct must be connect');
  if (value.consumerProduct !== 'finance') errors.push('consumerProduct must be finance');
  if (value.currency !== 'USD') errors.push('currency must be USD');
  if (!isDateTime(value.generatedAt)) errors.push('generatedAt must be an RFC 3339 UTC timestamp');

  let yearsValid = false;
  if (!Array.isArray(value.years)) {
    errors.push('years must be an array');
  } else {
    const seen = new Set();
    yearsValid = true;
    let prevFiscalYear = -Infinity;
    value.years.forEach((row, index) => {
      const before = errors.length;
      validateYear(row, errors, index);
      if (errors.length !== before) yearsValid = false;
      if (isRecord(row) && Number.isInteger(row.fiscalYear)) {
        if (seen.has(row.fiscalYear)) { errors.push(`years[${index}] is a duplicate fiscalYear`); yearsValid = false; }
        seen.add(row.fiscalYear);
        // Ascending order, matching the target 'multi-year' page's table (oldest first) and the
        // synthetic fixture's own ORDER BY fiscal_year.
        if (row.fiscalYear < prevFiscalYear) { errors.push('years must be ordered by ascending fiscalYear'); yearsValid = false; }
        prevFiscalYear = row.fiscalYear;
      }
    });
  }

  if (!hasExactKeys(value.reconciliation, RECONCILIATION_KEYS)) {
    errors.push('reconciliation must contain exactly the balance sheet trend reconciliation fields');
  } else {
    if (!Number.isInteger(value.reconciliation.yearCount) || value.reconciliation.yearCount < 0) {
      errors.push('reconciliation.yearCount must be a nonnegative integer');
    }
    if (typeof value.reconciliation.totalsMatch !== 'boolean') {
      errors.push('reconciliation.totalsMatch must be a boolean');
    }
    if (yearsValid) {
      if (value.reconciliation.yearCount !== value.years.length) {
        errors.push('reconciliation.yearCount must equal years.length');
      }
      const everyYearBalances = value.years.every((y) => y.balancedCents === 0);
      if (value.reconciliation.totalsMatch !== everyYearBalances) {
        errors.push('reconciliation.totalsMatch must reflect whether every year balances (balancedCents === 0)');
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function acceptFinanceBalanceSheetTrendV1(value) {
  const validation = validateFinanceBalanceSheetTrendV1(value);
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
