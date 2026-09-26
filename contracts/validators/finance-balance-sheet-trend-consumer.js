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

// Parity extension (2026-09-26) -- the fields Connect's legacy Balance Sheet & Financial Position
// tab reads from its own multi-year route: per-year current/fixed/other assets, the
// Donor-Restricted split, cash & bank accounts, net income, and the balance sheet vs. income
// statement tie-out. Added as one all-or-nothing group so this consumer still accepts a producer
// deployed before the extension (base keys only) while a partial or mixed payload still fails
// closed: either the root carries both extension keys and EVERY year carries every extension
// field, or none of them appear anywhere.
const ROOT_EXTENSION_KEYS = ['cashAccountCode', 'pnlTieOut'];
const YEAR_EXTENSION_KEYS = [
  'currentAssetsCents', 'fixedAssetsCents', 'otherAssetsCents', 'hasBalanceSheet', 'equityReclass', 'cash', 'netIncomeCents',
];
const YEAR_EQUITY_RECLASS_KEYS = ['donorRestrictedCents', 'unrestrictedCents', 'totalEquityCents', 'unclassifiedCount'];
const YEAR_CASH_KEYS = ['operatingCents', 'operatingAccounts', 'allCashCents', 'allCashAccounts'];
const TIE_OUT_KEYS = ['rows', 'checked', 'matched', 'unexplained'];
const TIE_OUT_ROW_KEYS = [
  'year', 'priorYear', 'equityCents', 'priorEquityCents', 'changeCents', 'netIncomeCents', 'differenceCents', 'status',
];
const TIE_OUT_STATUSES = new Set(['ok', 'off', 'no_prior_balance', 'no_pnl']);
// Mirrors src/api-finance.js's BALANCE_PNL_TOLERANCE_CENTS ($1) -- the producer's own tolerance.
const TIE_OUT_TOLERANCE_CENTS = 100;

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

function isIntOrNull(value) {
  return value === null || Number.isInteger(value);
}

function isNameList(value) {
  return Array.isArray(value) && value.every((name) => typeof name === 'string' && name.trim() !== '');
}

function validateYearExtension(row, errors, label) {
  for (const key of ['currentAssetsCents', 'fixedAssetsCents', 'otherAssetsCents']) {
    if (!Number.isInteger(row[key])) errors.push(`${label}.${key} must be integer cents`);
  }
  if ([row.assetsCents, row.currentAssetsCents, row.fixedAssetsCents, row.otherAssetsCents].every(Number.isInteger)
    && row.currentAssetsCents + row.fixedAssetsCents + row.otherAssetsCents !== row.assetsCents) {
    errors.push(`${label}.currentAssetsCents + fixedAssetsCents + otherAssetsCents must equal assetsCents`);
  }
  if (typeof row.hasBalanceSheet !== 'boolean') errors.push(`${label}.hasBalanceSheet must be a boolean`);
  if (!isIntOrNull(row.netIncomeCents)) errors.push(`${label}.netIncomeCents must be integer cents or null`);

  if (row.equityReclass !== null) {
    if (!hasExactKeys(row.equityReclass, YEAR_EQUITY_RECLASS_KEYS)) {
      errors.push(`${label}.equityReclass must be null or contain exactly the per-year equity reclassification fields`);
    } else {
      const er = row.equityReclass;
      for (const key of ['donorRestrictedCents', 'unrestrictedCents', 'totalEquityCents']) {
        if (!Number.isInteger(er[key])) errors.push(`${label}.equityReclass.${key} must be integer cents`);
      }
      if (!Number.isInteger(er.unclassifiedCount) || er.unclassifiedCount < 0) errors.push(`${label}.equityReclass.unclassifiedCount must be a nonnegative integer`);
      if ([er.donorRestrictedCents, er.unrestrictedCents, er.totalEquityCents].every(Number.isInteger)
        && er.donorRestrictedCents + er.unrestrictedCents !== er.totalEquityCents) {
        errors.push(`${label}.equityReclass.donorRestrictedCents + unrestrictedCents must equal totalEquityCents`);
      }
      if (Number.isInteger(er.totalEquityCents) && Number.isInteger(row.equityCents) && er.totalEquityCents !== row.equityCents) {
        // Same identity the single-year contract enforces: both come from the same reclassified rows.
        errors.push(`${label}.equityReclass.totalEquityCents must equal ${label}.equityCents`);
      }
    }
  }

  if (row.cash !== null) {
    if (!hasExactKeys(row.cash, YEAR_CASH_KEYS)) {
      errors.push(`${label}.cash must be null or contain exactly the per-year cash fields`);
    } else {
      for (const [cents, names] of [['operatingCents', 'operatingAccounts'], ['allCashCents', 'allCashAccounts']]) {
        if (!isIntOrNull(row.cash[cents])) errors.push(`${label}.cash.${cents} must be integer cents or null`);
        if (!isNameList(row.cash[names])) errors.push(`${label}.cash.${names} must be an array of account names`);
        else if (row.cash[cents] === null && row.cash[names].length) errors.push(`${label}.cash.${names} must be empty when ${cents} is null`);
        else if (row.cash[cents] !== null && !row.cash[names].length) errors.push(`${label}.cash.${names} must name the accounts behind ${cents}`);
      }
    }
  }

  if (row.hasBalanceSheet === false && (row.equityReclass !== null || row.cash !== null)) {
    errors.push(`${label} has no balance sheet, so equityReclass and cash must be null`);
  }
  if (row.hasBalanceSheet === true && (row.equityReclass === null || row.cash === null)) {
    errors.push(`${label} has a balance sheet, so equityReclass and cash must be present`);
  }
}

function validateTieOut(value, errors, years) {
  if (!hasExactKeys(value, TIE_OUT_KEYS)) {
    errors.push('pnlTieOut must contain exactly rows, checked, matched, and unexplained');
    return;
  }
  for (const key of ['checked', 'matched', 'unexplained']) {
    if (!Number.isInteger(value[key]) || value[key] < 0) errors.push(`pnlTieOut.${key} must be a nonnegative integer`);
  }
  if (!Array.isArray(value.rows)) {
    errors.push('pnlTieOut.rows must be an array');
    return;
  }
  const byYear = years ? new Map(years.map((y) => [y.fiscalYear, y])) : null;
  let rowsValid = true;
  let prior = -Infinity;
  value.rows.forEach((row, index) => {
    const label = `pnlTieOut.rows[${index}]`;
    if (!hasExactKeys(row, TIE_OUT_ROW_KEYS)) {
      errors.push(`${label} must contain exactly the tie-out row fields`);
      rowsValid = false;
      return;
    }
    const before = errors.length;
    if (!Number.isInteger(row.year) || row.year <= prior) errors.push(`${label}.year must be an integer, ascending and unique`);
    prior = Number.isInteger(row.year) ? row.year : prior;
    if (row.priorYear !== row.year - 1) errors.push(`${label}.priorYear must be year - 1`);
    if (!Number.isInteger(row.equityCents)) errors.push(`${label}.equityCents must be integer cents`);
    for (const key of ['priorEquityCents', 'changeCents', 'netIncomeCents', 'differenceCents']) {
      if (!isIntOrNull(row[key])) errors.push(`${label}.${key} must be integer cents or null`);
    }
    if (!TIE_OUT_STATUSES.has(row.status)) errors.push(`${label}.status must be ok, off, no_prior_balance, or no_pnl`);
    if (errors.length === before) {
      const priorKnown = row.priorEquityCents !== null;
      if (!priorKnown && (row.status !== 'no_prior_balance' || row.changeCents !== null || row.differenceCents !== null)) {
        errors.push(`${label} without an opening balance must read no_prior_balance with no change or difference`);
      }
      if (priorKnown && row.changeCents !== row.equityCents - row.priorEquityCents) {
        errors.push(`${label}.changeCents must equal equityCents - priorEquityCents`);
      }
      if (priorKnown && row.netIncomeCents === null && (row.status !== 'no_pnl' || row.differenceCents !== null)) {
        errors.push(`${label} without net income must read no_pnl with no difference`);
      }
      if (priorKnown && row.netIncomeCents !== null) {
        if (row.differenceCents !== row.changeCents - row.netIncomeCents) {
          errors.push(`${label}.differenceCents must equal changeCents - netIncomeCents`);
        } else if (row.status !== (Math.abs(row.differenceCents) <= TIE_OUT_TOLERANCE_CENTS ? 'ok' : 'off')) {
          errors.push(`${label}.status must be ok within the $1 tolerance and off beyond it`);
        }
      }
      if (byYear) {
        const year = byYear.get(row.year);
        if (!year || year.hasBalanceSheet !== true) errors.push(`${label}.year must be a year in the trend that has a balance sheet`);
        else {
          if (year.equityCents !== row.equityCents) errors.push(`${label}.equityCents must equal that year's equityCents`);
          if (year.netIncomeCents !== row.netIncomeCents) errors.push(`${label}.netIncomeCents must equal that year's netIncomeCents`);
        }
      }
    }
    if (errors.length !== before) rowsValid = false;
  });
  if (byYear && rowsValid) {
    const expectedRows = years.filter((y) => y.hasBalanceSheet === true).length;
    if (value.rows.length !== expectedRows) errors.push('pnlTieOut.rows must list every year that has a balance sheet');
  }
  if (rowsValid && [value.checked, value.matched, value.unexplained].every(Number.isInteger)) {
    const count = (statuses) => value.rows.filter((r) => statuses.includes(r.status)).length;
    if (value.checked !== count(['ok', 'off'])) errors.push('pnlTieOut.checked must count the ok and off rows');
    if (value.matched !== count(['ok'])) errors.push('pnlTieOut.matched must count the ok rows');
    if (value.unexplained !== count(['off'])) errors.push('pnlTieOut.unexplained must count the off rows');
  }
}

function validateYear(row, errors, index, extended) {
  const label = `years[${index}]`;
  if (!hasExactKeys(row, extended ? [...YEAR_KEYS, ...YEAR_EXTENSION_KEYS] : YEAR_KEYS)) {
    errors.push(`${label} must contain exactly the balance sheet trend year fields`);
    return;
  }
  if (extended) validateYearExtension(row, errors, label);
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
  const extended = isRecord(value) && ROOT_EXTENSION_KEYS.some((key) => key in value);
  if (!hasExactKeys(value, extended ? [...ROOT_KEYS, ...ROOT_EXTENSION_KEYS] : ROOT_KEYS)) {
    return { ok: false, errors: ['root must contain exactly the connect.finance-balance-sheet-trend.v1 fields'] };
  }
  if (extended && typeof value.cashAccountCode !== 'string') errors.push('cashAccountCode must be a string (empty when no operating account is pinned)');
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
      validateYear(row, errors, index, extended);
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

  if (extended) validateTieOut(value.pnlTieOut, errors, yearsValid ? value.years : null);

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
    years: value.years.map((row) => {
      const copy = { ...row };
      if ('equityReclass' in row) copy.equityReclass = row.equityReclass && { ...row.equityReclass };
      if ('cash' in row) {
        copy.cash = row.cash && {
          ...row.cash, operatingAccounts: [...row.cash.operatingAccounts], allCashAccounts: [...row.cash.allCashAccounts],
        };
      }
      return copy;
    }),
    ...('pnlTieOut' in value ? {
      cashAccountCode: value.cashAccountCode,
      pnlTieOut: { ...value.pnlTieOut, rows: value.pnlTieOut.rows.map((row) => ({ ...row })) },
    } : {}),
    reconciliation: { ...value.reconciliation },
  };
}
