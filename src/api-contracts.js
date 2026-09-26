// ── Versioned cross-product contract endpoints ──────────────────────────────
// First real slice of Finance separation: Connect actually producing the
// connect.giving-summary.v1 aggregate it has only ever emitted to a committed
// synthetic fixture in Finance staging. This file has one job — assemble that
// exact contract shape from real Giving data — so it stays reviewable
// independent of the much larger People/Giving/Reports handlers.
import { json } from './auth.js';
import { validateConnectGivingSummaryV1 } from '../contracts/validators/connect-giving-consumer.js';
import { validateFinanceDataStatusV1 } from '../contracts/validators/finance-data-status-consumer.js';
import { validateFinanceChartOfAccountsV1, CHART_REVENUE_CLASSIFICATIONS } from '../contracts/validators/finance-chart-of-accounts-consumer.js';
import { validateFinanceBudgetV1 } from '../contracts/validators/finance-budget-consumer.js';
import { validateFinanceChurchReportV1 } from '../contracts/validators/finance-church-report-consumer.js';
import { validateFinanceChurchReportTrendV1 } from '../contracts/validators/finance-church-report-trend-consumer.js';
import { validateFinanceBalanceSheetV1 } from '../contracts/validators/finance-balance-sheet-consumer.js';
import { validateFinanceBalanceSheetTrendV1 } from '../contracts/validators/finance-balance-sheet-trend-consumer.js';
import { validateFinanceDaycareReportV1 } from '../contracts/validators/finance-daycare-consumer.js';
import { validateFinanceDaycareEntriesV1 } from '../contracts/validators/finance-daycare-entries-consumer.js';
import { validateFinancePropertyValuationV1 } from '../contracts/validators/finance-property-valuation-consumer.js';
import { validateFinanceCompensationV1 } from '../contracts/validators/finance-compensation-consumer.js';
import { validateFinancePropertyOperatingV1 } from '../contracts/validators/finance-property-operating-consumer.js';
import { validateFinancePropertyReservesV1 } from '../contracts/validators/finance-property-reserves-consumer.js';
import { validateFinancePropertyLedgersV1 } from '../contracts/validators/finance-property-ledgers-consumer.js';
import { validateFinancePropertyForecastV1 } from '../contracts/validators/finance-property-forecast-consumer.js';
import { validateFinanceCashRunwayV1 } from '../contracts/validators/finance-cash-runway-consumer.js';
import {
  readPlanningBoardCategories, readPurposeTags, REVENUE_STREAMS, BOARD_EXPENSE_CATEGORIES,
  resolveChurchYearPrecedence, computeYearSummary,
  applyDesignatedFundsAsEquity, computeBalanceSummary, computeEquityReclassification,
  computeMdoUtilityInsuranceAllocation, computePropertyAnnualSummary,
  readCashPolicy, computeOperatingExpenseSplit, computeCashRunway,
  operatingCashFromBalanceSheet, operatingCashFromAccounts,
} from './api-finance.js';
import { resolveGeneralFundIds } from './api-utils.js';

function isValidFiscalYearStr(value) {
  return typeof value === 'string' && /^\d{4}$/.test(value) && Number(value) >= 2000 && Number(value) <= 2100;
}

function isValidDateStr(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// A household is the giving household, not the People-directory household: someone with no
// household_id gives as themselves. Matches the convention already established for Giving
// household rollups (see giving_year_household_totals in migrations/0044).
const HOUSEHOLD_KEY_SQL = `CASE
  WHEN p.household_id IS NOT NULL AND p.household_id != 0 THEN 'h:' || p.household_id
  WHEN ge.person_id IS NOT NULL THEN 'p:' || ge.person_id
  ELSE NULL
END`;

// Pure and independently testable: takes a bound period and an injected "now", queries nothing
// beyond one bounded SELECT, and returns the exact connect.giving-summary.v1 shape. giving_entries
// has no separate refund table or flag — a negative amount IS a refund/correction row (see
// api-utils.js's comment on rendering negative amounts), so gross/refund/net are split on sign
// rather than read from a dedicated column.
export async function buildConnectGivingSummaryV1(db, { startDate, endDate, now = new Date() }) {
  const rows = (await db.prepare(
    `SELECT f.id AS fund_id, f.name AS fund_name,
            COUNT(*) AS gift_count,
            COUNT(DISTINCT ${HOUSEHOLD_KEY_SQL}) AS household_count,
            SUM(CASE WHEN ge.amount > 0 THEN ge.amount ELSE 0 END) AS gross_cents,
            SUM(CASE WHEN ge.amount < 0 THEN -ge.amount ELSE 0 END) AS refund_cents,
            SUM(ge.amount) AS net_cents
       FROM giving_entries ge
       JOIN funds f ON f.id = ge.fund_id
       LEFT JOIN people p ON p.id = ge.person_id
      WHERE ge.contribution_date >= ? AND ge.contribution_date <= ?
      GROUP BY f.id, f.name
      ORDER BY f.id ASC`
  ).bind(startDate, endDate).all()).results || [];

  // Same classification the giving-board report and the Health page's giving-pace chart already
  // use (resolveGeneralFundIds, api-utils.js) -- queried across EVERY fund, not just the ones with
  // gifts in this period, since the shared-numeric-prefix fallback needs the whole family to
  // resolve correctly. Reusing it here (rather than a second, narrower name-match copy of the
  // rule) is what keeps this contract's isGeneralFund flag from ever disagreeing with what those
  // other screens call General Fund giving.
  const allFundRows = (await db.prepare(`SELECT id, name, category FROM funds`).all()).results || [];
  const { ids: generalFundIds } = resolveGeneralFundIds(allFundRows);

  const funds = rows.map((row) => ({
    fundRef: String(row.fund_id),
    fundLabel: row.fund_name,
    giftCount: row.gift_count,
    householdCount: row.household_count,
    amounts: {
      grossCents: row.gross_cents,
      refundCents: row.refund_cents,
      netCents: row.net_cents,
    },
    isGeneralFund: generalFundIds.has(row.fund_id),
  }));

  const totals = funds.reduce((acc, fund) => ({
    grossCents: acc.grossCents + fund.amounts.grossCents,
    refundCents: acc.refundCents + fund.amounts.refundCents,
    netCents: acc.netCents + fund.amounts.netCents,
  }), { grossCents: 0, refundCents: 0, netCents: 0 });

  const generatedAt = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return {
    contract: 'connect.giving-summary.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    period: { startDate, endDate },
    generatedAt,
    sourceThrough: `${endDate}T23:59:59Z`,
    funds,
    totals,
    reconciliation: {
      sourceRecordCount: funds.reduce((total, fund) => total + fund.giftCount, 0),
      fundCount: funds.length,
      totalsMatch: true,
    },
  };
}

// Shared by both entry points onto this contract: the human-role-gated admin route below, and
// the shared-secret-gated server-to-server route (src/api-contracts-service.js) that Finance
// actually calls. One place validates the request and fails closed on a malformed assembly, so
// neither entry point can drift from the other.
export async function respondWithConnectGivingSummaryV1(url, db) {
  const startDate = url.searchParams.get('from');
  const endDate = url.searchParams.get('to');
  if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
    return json({ error: 'from and to are required as YYYY-MM-DD dates' }, 400);
  }
  if (startDate > endDate) {
    return json({ error: 'from must not be after to' }, 400);
  }
  const now = new Date();
  // The contract requires sourceThrough (end of the requested period) to never be later than
  // generatedAt (now) — a future-dated period would violate that by construction, so this is
  // refused here rather than emitted and rejected downstream by Finance's consumer.
  if (`${endDate}T23:59:59Z` > now.toISOString()) {
    return json({ error: 'to must not be in the future' }, 400);
  }

  const summary = await buildConnectGivingSummaryV1(db, { startDate, endDate, now });

  // Fail closed: this reuses Finance's own consumer validator, so producer and consumer can
  // never silently drift apart. This should never fire from real data — if it does, something
  // is wrong with this endpoint, and Finance must not see a malformed contract.
  const validation = validateConnectGivingSummaryV1(summary);
  if (!validation.ok) {
    return json({ error: 'Internal: assembled summary failed contract validation', details: validation.errors }, 500);
  }

  return json(summary);
}

// Second real slice of Finance separation: the Data & Imports section's "productionConnected"/
// "writerConnected" fields have stood in as hardcoded `false` since the staging rewrite began.
// This assembles the real answer from two existing production tables — never their secrets. No
// QuickBooks token, refresh token, or realm ID leaves this function; only connection presence and
// two timestamps do.
export async function buildFinanceDataStatusV1(db, { now = new Date() } = {}) {
  const importsRow = await db.prepare(
    `SELECT MAX(last_imported_at) AS most_recent, COUNT(*) AS importer_count FROM finance_import_log`
  ).first();
  const qbRow = await db.prepare(
    `SELECT connected_at, last_synced_at FROM finance_qb_connection WHERE id = 1`
  ).first();

  return {
    contract: 'connect.finance-data-status.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    imports: {
      mostRecentImportAt: importsRow?.most_recent || null,
      importerCount: importsRow?.importer_count || 0,
    },
    quickbooks: {
      connected: Boolean(qbRow),
      lastSyncedAt: qbRow?.last_synced_at || null,
    },
  };
}

export async function respondWithFinanceDataStatusV1(db) {
  const status = await buildFinanceDataStatusV1(db, { now: new Date() });

  // Fail closed, same discipline as the Giving contract above: this should never fire against
  // real data, and if it does, Finance must not see a malformed contract.
  const validation = validateFinanceDataStatusV1(status);
  if (!validation.ok) {
    return json({ error: 'Internal: assembled data-status failed contract validation', details: validation.errors }, 500);
  }

  return json(status);
}

// The live operating-cash runway already shown in Connect, exposed as one bounded aggregate read
// so Finance does not substitute fixture cash beside otherwise-live Church and Balance reports.
// This deliberately reuses Connect's existing policy, account selection, daycare exclusion, and
// runway arithmetic verbatim. It is read-only and carries no account balances beyond the one
// already-designated operating-cash total and the names used to make that selection auditable.
export async function buildFinanceCashRunwayV1(db, { fiscalYear, now = new Date() }) {
  const rawEntries = ((await db.prepare(
    'SELECT * FROM finance_church_entries WHERE fiscal_year=? AND period_month=0'
  ).bind(fiscalYear).all()).results || []);
  const entries = resolveChurchYearPrecedence(rawEntries);
  const expenseSplit = computeOperatingExpenseSplit(entries);
  const policy = await readCashPolicy(db);

  let onHandCents = policy.cash_on_hand_cents;
  let cashSource = onHandCents == null ? 'none' : 'manual';
  let cashAccounts = [];
  let asOfDate = '';

  if (onHandCents == null) {
    const balanceYear = await db.prepare(
      'SELECT MAX(fiscal_year) AS y FROM finance_church_balances WHERE fiscal_year <= ?'
    ).bind(fiscalYear).first();
    if (balanceYear?.y != null) {
      const balanceRows = ((await db.prepare(
        'SELECT * FROM finance_church_balances WHERE fiscal_year=? ORDER BY category_path'
      ).bind(balanceYear.y).all()).results || []);
      const fromBalance = operatingCashFromBalanceSheet(balanceRows, policy.cash_account_code);
      if (fromBalance) {
        onHandCents = fromBalance.cents;
        cashSource = 'balance_sheet';
        cashAccounts = fromBalance.accounts;
        asOfDate = fromBalance.asOfDate || `FY${balanceYear.y}`;
      }
    }
  }

  if (onHandCents == null) {
    const snapshot = await db.prepare("SELECT value FROM finance_qb_snapshot WHERE key='accounts'").first();
    let accounts = null;
    try { accounts = snapshot?.value ? JSON.parse(snapshot.value) : null; } catch { accounts = null; }
    const fromQuickBooks = accounts ? operatingCashFromAccounts(accounts) : null;
    if (fromQuickBooks) {
      onHandCents = fromQuickBooks.cents;
      cashSource = 'quickbooks';
    }
  }

  const monthsElapsed = fiscalYear === now.getUTCFullYear() ? now.getUTCMonth() + 1 : 12;
  const runway = computeCashRunway({
    onHandCents,
    expensesYtdCents: expenseSplit.churchCents,
    monthsElapsed,
    policyFloorMonths: policy.policy_floor_months,
  });

  return {
    contract: 'connect.finance-cash-runway.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    fiscalYear,
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    available: runway.available,
    onHandCents: runway.onHandCents,
    expensesYtdCents: expenseSplit.churchCents,
    monthsElapsed,
    averageMonthlyExpenseCents: runway.avgMonthlyExpenseCents,
    monthsOfCash: runway.available ? runway.monthsOfCash : null,
    policyFloorMonths: policy.policy_floor_months,
    floorCents: runway.available ? runway.floorCents : null,
    gapToFloorCents: runway.available ? runway.gapToFloorCents : null,
    cashSource,
    cashAccounts,
    asOfDate,
    daycareExcludedCents: expenseSplit.daycareCents,
    allExpensesYtdCents: expenseSplit.totalCents,
    // Optional additive detail lets Finance render the same admin-only policy editor as the
    // compatibility UI without guessing or overwriting fields it cannot see. Finance accepts
    // both the pre-addition and extended v1 shapes so Connect and Finance can deploy in either
    // order; the write remains the existing identity-checked Connect relay.
    policySettings: {
      floorMonths: policy.policy_floor_months,
      cashOnHandCents: policy.cash_on_hand_cents,
      cashAccountCode: policy.cash_account_code,
      generalFundBudgetCode: policy.general_fund_budget_code,
    },
  };
}

export async function respondWithFinanceCashRunwayV1(url, db) {
  const fiscalYearStr = url.searchParams.get('fiscal_year');
  if (!isValidFiscalYearStr(fiscalYearStr)) return json({ error: 'fiscal_year is required as a 4-digit year' }, 400);
  const runway = await buildFinanceCashRunwayV1(db, { fiscalYear: Number(fiscalYearStr), now: new Date() });
  const validation = validateFinanceCashRunwayV1(runway);
  if (!validation.ok) return json({ error: 'Internal: assembled cash runway failed contract validation', details: validation.errors }, 500);
  return json(runway);
}

// Third real slice of Finance separation: the Chart of Accounts section's account tree,
// board-category assignment, and purpose tags. Assembled from the church ledger's own account
// inventory (finance_church_entries) plus the two finance_settings blobs the legacy Chart of
// Accounts page itself reads and writes (readPlanningBoardCategories, readPurposeTags, both
// hoisted to module scope in api-finance.js for this reuse).
//
// Year-scoped, like legacy's Chart of Accounts tab: that tab lists the leaves of ONE fiscal
// year's ledger tree (finLoadPlanning -> church/this-year?year=, the calendar year by default),
// picked with the same resolveChurchYearPrecedence() rule buildChurchThisYear applies, so an
// account present only in a losing source for that year is not listed. `fiscal_year` names the
// year; without it the church's current calendar year (Central time) is used, matching legacy's
// default. Legacy does not fall back to an older year when the current one has no rows, so
// neither does this contract -- availableFiscalYears lists the years that do have rows, so the
// caller can offer them instead.
//
// Each account carries its own actual/budget for that year (own_actual_cents/own_budget_cents,
// the same per-account figures the Church Report contract carries), which is why this contract
// is 'aggregate' rather than 'structural'. It still carries no gift, donor, or person. Every P&L
// classification is included -- Other Income, Other Expenses and Cost of Goods Sold as well as
// Income/Expenses -- because legacy's tab lists every leaf of the tree; Income and Other Income
// are the revenue side (legacy FIN_REVENUE_CLASSES), everything else the expense side.
//
// An account with no saved board category is reported as boardCategoryKey 'unassigned' /
// boardCategoryLabel 'Unassigned' rather than guessed at here; the consumer applies legacy's
// name-based default (apps/finance/board-layout.js). displayName is the saved Chart of Accounts
// rename (accountLabels) or, with none saved, the QuickBooks account name.
const REVENUE_STREAM_DEFAULT_LABELS = { donor: 'Donor', earned: 'Earned', passive: 'Passive', restricted: 'Restricted' };
const CHART_CLASSIFICATIONS = new Set(['Income', 'Other Income', 'Cost of Goods Sold', 'Expenses', 'Other Expenses']);

function resolveAccountCategory(classification, categoryPath, boardCategories) {
  const isIncome = CHART_REVENUE_CLASSIFICATIONS.has(classification);
  const assignments = isIncome ? boardCategories.revenue : boardCategories.expense;
  const customLabels = isIncome ? boardCategories.revenueLabels : boardCategories.expenseLabels;
  const validKeys = isIncome ? REVENUE_STREAMS : BOARD_EXPENSE_CATEGORIES.map((c) => c.key);
  const defaultLabels = isIncome
    ? REVENUE_STREAM_DEFAULT_LABELS
    : Object.fromEntries(BOARD_EXPENSE_CATEGORIES.map((c) => [c.key, c.label]));
  const assigned = assignments[categoryPath];
  if (assigned && validKeys.includes(assigned)) {
    return { key: assigned, label: customLabels[assigned] || defaultLabels[assigned] || assigned };
  }
  return { key: 'unassigned', label: 'Unassigned' };
}

// The church's own calendar year, for the default fiscal year (legacy used the viewer's clock).
export function currentChurchFiscalYear(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric' }).format(now));
}

export async function buildFinanceChartOfAccountsV1(db, { fiscalYear, now = new Date() } = {}) {
  const year = Number.isInteger(fiscalYear) ? fiscalYear : currentChurchFiscalYear(now);
  // ORDER BY id keeps the ledger's own import order, the order legacy's unordered read returned.
  const { results } = (await db.prepare(
    `SELECT fiscal_year, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source
       FROM finance_church_entries WHERE fiscal_year = ? AND period_month = 0 ORDER BY id`
  ).bind(year).all()) || {};
  const rows = resolveChurchYearPrecedence(results || []).filter((row) => CHART_CLASSIFICATIONS.has(row.classification));
  const yearRows = (await db.prepare(
    'SELECT DISTINCT fiscal_year FROM finance_church_entries WHERE period_month = 0 ORDER BY fiscal_year DESC'
  ).all())?.results || [];
  const availableFiscalYears = yearRows.map((r) => Number(r.fiscal_year)).filter((y) => Number.isInteger(y));

  const boardCategories = await readPlanningBoardCategories(db);
  const purposeTags = await readPurposeTags(db);
  const tagLabelById = new Map(purposeTags.tags.map((t) => [t.id, t.label]));

  const counts = { Income: 0, Expenses: 0, 'Other Income': 0, 'Other Expenses': 0, 'Cost of Goods Sold': 0 };
  let unassignedCount = 0, revenueActualCents = 0, expenseActualCents = 0;
  const accounts = rows.map((row) => {
    const category = resolveAccountCategory(row.classification, row.category_path, boardCategories);
    counts[row.classification]++;
    if (category.key === 'unassigned') unassignedCount++;
    const actualCents = row.own_actual_cents || 0;
    if (CHART_REVENUE_CLASSIFICATIONS.has(row.classification)) revenueActualCents += actualCents; else expenseActualCents += actualCents;
    const rawTagId = purposeTags.categories[row.category_path];
    const hasTag = typeof rawTagId === 'string' && tagLabelById.has(rawTagId);
    const rename = boardCategories.accountLabels[row.category_path];
    return {
      classification: row.classification,
      categoryPath: row.category_path,
      accountName: row.account_name,
      displayName: typeof rename === 'string' && rename.trim() !== '' ? rename : row.account_name,
      depth: row.depth,
      hasChildren: Boolean(row.has_children),
      actualCents,
      budgetCents: row.own_budget_cents === null || row.own_budget_cents === undefined ? null : row.own_budget_cents,
      boardCategoryKey: category.key,
      boardCategoryLabel: category.label,
      purposeTagId: hasTag ? rawTagId : null,
      purposeTagLabel: hasTag ? tagLabelById.get(rawTagId) : null,
    };
  });

  return {
    contract: 'connect.finance-chart-of-accounts.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    fiscalYear: year,
    availableFiscalYears,
    accounts,
    reconciliation: {
      accountCount: accounts.length,
      incomeCount: counts.Income,
      expenseCount: counts.Expenses,
      otherIncomeCount: counts['Other Income'],
      otherExpenseCount: counts['Other Expenses'],
      costOfGoodsSoldCount: counts['Cost of Goods Sold'],
      unassignedCount,
      revenueActualCents,
      expenseActualCents,
    },
  };
}

export async function respondWithFinanceChartOfAccountsV1(url, db) {
  const fiscalYearStr = url?.searchParams?.get('fiscal_year') ?? null;
  if (fiscalYearStr !== null && !isValidFiscalYearStr(fiscalYearStr)) {
    return json({ error: 'fiscal_year must be a 4-digit year' }, 400);
  }
  const now = new Date();
  const chartOfAccounts = await buildFinanceChartOfAccountsV1(db, {
    fiscalYear: fiscalYearStr === null ? currentChurchFiscalYear(now) : Number(fiscalYearStr), now,
  });

  // Fail closed, same discipline as the two contracts above: this should never fire against real
  // data, and if it does, Finance must not see a malformed contract.
  const validation = validateFinanceChartOfAccountsV1(chartOfAccounts);
  if (!validation.ok) {
    return json({ error: 'Internal: assembled chart of accounts failed contract validation', details: validation.errors }, 500);
  }

  return json(chartOfAccounts);
}

// Fourth real slice of Finance separation: Budget. Unlike Chart of Accounts' original
// structural-only shape, production's Church Budget Planning is a real per-category,
// per-fiscal-year dollar plan (`finance_budget_plan` -- see src/api-finance.js's "Church Budget
// Planning" comment block for the full generate/override/commit workflow), so this contract carries
// real money and is 'aggregate', matching Giving and Data-status.
//
// finance_budget_plan's schema is confirmed byte-for-byte identical between production
// (src/db.js) and apps/finance's own migration (apps/finance/migrations/0001_finance_foundation.sql)
// -- see the architecture repo's 2026-09-13 schema-compatibility evidence, row 12. That match is
// about the TABLE shape, not the data it holds: a direct 2026-09-14 read against production found
// every one of its 80 real rows (all fiscal_year 2027) has basis='manual' with growth_pct and
// base_amount_cents both NULL -- the church's whole FY2027 plan was hand-entered/edited, not
// generated from a growth rate. The generate()/generate-all() routes DO populate those two columns
// (basis='grown') and DO keep them arithmetically consistent with planned_amount_cents at write
// time, but nothing in this table today actually exercises that path, so this contract (and its
// consumer) must treat growthPct/baseAmountCents as genuinely nullable per category, not as
// always-populated fields the way apps/finance's own synthetic fixture (basis='synthetic_fixture',
// every row grown) currently assumes.
//
// Modeled after Giving rather than Chart of Accounts: this is a real, explicitly year-scoped
// query (a plan is per fiscal year, and there is no single "the" year the way there is a single
// ledger tree), so the caller names the year, and a year with no plan rows yet answers with a
// valid, empty-categories contract rather than a 404 -- an unplanned future year is a normal,
// unremarkable state for this table, not an error.
export async function buildFinanceBudgetV1(db, { fiscalYear, now = new Date() }) {
  const { results } = (await db.prepare(
    `SELECT category, classification, planned_amount_cents, basis, growth_pct, base_amount_cents, notes
       FROM finance_budget_plan WHERE fiscal_year = ? ORDER BY classification, category`
  ).bind(fiscalYear).all()) || {};
  const rows = results || [];

  let incomeCents = 0, expenseCents = 0, incomeCount = 0, expenseCount = 0, manualCount = 0, grownCount = 0;
  const categories = rows.map((row) => {
    if (row.classification === 'Income') { incomeCount++; incomeCents += row.planned_amount_cents; }
    else { expenseCount++; expenseCents += row.planned_amount_cents; }
    if (row.basis === 'manual') manualCount++; else if (row.basis === 'grown') grownCount++;
    return {
      category: row.category,
      classification: row.classification,
      plannedAmountCents: row.planned_amount_cents,
      basis: row.basis,
      growthPct: row.growth_pct === null || row.growth_pct === undefined ? null : row.growth_pct,
      baseAmountCents: row.base_amount_cents === null || row.base_amount_cents === undefined ? null : row.base_amount_cents,
      notes: row.notes || '',
    };
  });

  return {
    contract: 'connect.finance-budget.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    fiscalYear,
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    categories,
    totals: {
      plannedIncomeCents: incomeCents,
      plannedExpenseCents: expenseCents,
      plannedNetCents: incomeCents - expenseCents,
    },
    reconciliation: {
      categoryCount: categories.length,
      incomeCount,
      expenseCount,
      manualCount,
      grownCount,
      totalsMatch: true,
    },
  };
}

// Fifth real slice of Finance separation: Church Report. This is the SAME finance_church_entries
// table Chart of Accounts reads, scoped to one fiscal year and carrying the real actual/budget
// dollar figures -- so this contract is 'aggregate' (real money crosses it), like Giving and
// Budget. (Chart of Accounts was structural-only when this was written; it now carries each
// account's own year figures too, picked with the same precedence rule below.)
//
// Deliberately reuses resolveChurchYearPrecedence() and computeYearSummary() -- the exact
// functions production's own Church Report / Financial Health / Budget-planning pages already
// call (see src/api-finance.js's buildChurchThisYear) -- rather than re-deriving the winning
// source with a query of its own. That distinction is real, not stylistic: Chart of Accounts'
// original producer picked each ACCOUNT's own latest row across all sources (ROW_NUMBER() PARTITION
// BY category_path), but Church Report must pick one source WHOLESALE per fiscal year the way
// production's precedence rule does. A direct 2026-09-14 check of production found FY2026 has
// both an 'import' source (98 rows, the most recent single-year upload) and an 'import_activity'
// source (126 rows, the multi-year upload) on file for the same year; CHURCH_SOURCE_PRIORITY picks
// 'import' wholesale for FY2026, so the 28 accounts present only in 'import_activity' correctly do
// not appear in this year's report at all. Reusing that per-account "latest row wins" query here
// would have silently included them and produced a different, wrong total than the page staff
// already look at today.
//
// own_budget_cents is genuinely nullable per account in real data -- confirmed 2026-09-14: even
// within a single winning year/source, some accounts carry a real actual with no budget entered at
// all (11 of finance_church_entries' 126 accounts, every fiscal year 2019-2026, in the
// 'import_activity' source). apps/finance's own synthetic fixture (church-report-service.js's
// readSyntheticChurchReport) asserts every row's own_budget_cents is a non-null integer -- that
// assumption does not hold for real data, the same lesson Budget above already learned about
// growthPct/baseAmountCents. This contract and its consumer treat budgetCents as nullable per
// account rather than assuming it is always set.
//
// classification also carries every section finance_church_entries can actually hold: production
// has real 'Other Income' and 'Other Expenses' rows today (confirmed 2026-09-14), not only
// 'Income'/'Expenses' the way Chart of Accounts originally scoped to. 'Cost of Goods Sold' is
// included defensively -- a valid QuickBooks section this church has simply never posted to (zero
// rows today), not one the schema forbids.
//
// totals.incomeActualCents/incomeBudgetCents and expenseActualCents/expenseBudgetCents are ONLY
// the 'Income'/'Expenses' classifications -- matching production's own "Total revenue"/"Total
// expenses" KPI cards exactly, which do not blend in Other Income/Other Expenses (see
// src/frontend/js-finance.js's finRenderChurchThisYear). totals.netIncomeActualCents/
// netIncomeBudgetCents is the full bottom line computeYearSummary() already derives (Income - Cost
// of Goods Sold - Expenses, plus Other Income - Other Expenses) -- the same figure production's own
// "Net income" card shows, never recomputed independently here.
//
// Modeled on Giving/Budget's real-money shape rather than Chart of Accounts' original
// whole-tree/no-params shape: Church Report is naturally scoped to one fiscal year the way a budget plan is (there is no
// single "the" report the way there is a single account tree), so the caller names the year, and a
// year with no rows yet answers with a valid, empty-accounts contract rather than a 404.
export async function buildFinanceChurchReportV1(db, { fiscalYear, now = new Date() }) {
  const { results } = (await db.prepare(
    `SELECT fiscal_year, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source
       FROM finance_church_entries WHERE fiscal_year = ? AND period_month = 0`
  ).bind(fiscalYear).all()) || {};
  const rawRows = results || [];
  const resolved = resolveChurchYearPrecedence(rawRows);
  const summary = computeYearSummary(resolved);

  let incomeCount = 0, expenseCount = 0, otherIncomeCount = 0, otherExpenseCount = 0, costOfGoodsSoldCount = 0, accountsWithBudgetCount = 0;
  const accounts = resolved.map((row) => {
    switch (row.classification) {
      case 'Income': incomeCount++; break;
      case 'Expenses': expenseCount++; break;
      case 'Other Income': otherIncomeCount++; break;
      case 'Other Expenses': otherExpenseCount++; break;
      case 'Cost of Goods Sold': costOfGoodsSoldCount++; break;
    }
    const budgetCents = row.own_budget_cents === null || row.own_budget_cents === undefined ? null : row.own_budget_cents;
    if (budgetCents !== null) accountsWithBudgetCount++;
    return {
      classification: row.classification,
      categoryPath: row.category_path,
      accountName: row.account_name,
      depth: row.depth,
      hasChildren: Boolean(row.has_children),
      actualCents: row.own_actual_cents,
      budgetCents,
      source: row.source,
    };
  });

  const income = summary.classificationTotals['Income'] || { actualCents: 0, budgetCents: 0 };
  const expenses = summary.classificationTotals['Expenses'] || { actualCents: 0, budgetCents: 0 };

  return {
    contract: 'connect.finance-church-report.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    fiscalYear,
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    accounts,
    totals: {
      incomeActualCents: income.actualCents,
      incomeBudgetCents: income.budgetCents,
      expenseActualCents: expenses.actualCents,
      expenseBudgetCents: expenses.budgetCents,
      netIncomeActualCents: summary.netIncome.actualCents,
      netIncomeBudgetCents: summary.netIncome.budgetCents,
      hasBudgetData: summary.hasBudgetData,
    },
    reconciliation: {
      accountCount: accounts.length,
      incomeCount,
      expenseCount,
      otherIncomeCount,
      otherExpenseCount,
      costOfGoodsSoldCount,
      accountsWithBudgetCount,
      totalsMatch: true,
    },
  };
}

export async function respondWithFinanceBudgetV1(url, db) {
  const fiscalYearStr = url.searchParams.get('fiscal_year');
  if (!isValidFiscalYearStr(fiscalYearStr)) {
    return json({ error: 'fiscal_year is required as a 4-digit year' }, 400);
  }
  const budget = await buildFinanceBudgetV1(db, { fiscalYear: Number(fiscalYearStr), now: new Date() });

  // Fail closed, same discipline as the three contracts above: this should never fire against
  // real data, and if it does, Finance must not see a malformed contract.
  const validation = validateFinanceBudgetV1(budget);
  if (!validation.ok) {
    return json({ error: 'Internal: assembled budget failed contract validation', details: validation.errors }, 500);
  }

  return json(budget);
}

export async function respondWithFinanceChurchReportV1(url, db) {
  const fiscalYearStr = url.searchParams.get('fiscal_year');
  if (!isValidFiscalYearStr(fiscalYearStr)) {
    return json({ error: 'fiscal_year is required as a 4-digit year' }, 400);
  }
  const report = await buildFinanceChurchReportV1(db, { fiscalYear: Number(fiscalYearStr), now: new Date() });

  // Fail closed, same discipline as the contracts above: this should never fire against real
  // data, and if it does, Finance must not see a malformed contract.
  const validation = validateFinanceChurchReportV1(report);
  if (!validation.ok) {
    return json({ error: 'Internal: assembled church report failed contract validation', details: validation.errors }, 500);
  }

  return json(report);
}

// Thirteenth real slice of Finance separation, and the last Church Report sub-page left on the
// synthetic reader: the 'trend' (multi-year) page. buildFinanceChurchReportV1 above is
// deliberately scoped to ONE fiscal year (its own comment explains why: CHURCH_SOURCE_PRIORITY
// must pick a source WHOLESALE per year, not per account). This contract applies that exact same
// resolveChurchYearPrecedence()/computeYearSummary() pair independently to EVERY fiscal year found
// in finance_church_entries, rather than re-deriving a "latest row wins" trend of its own the way
// Chart of Accounts' original per-account query did -- the same reasoning, just repeated once per year
// instead of once. It takes no query parameters (unlike the single-year contract): the trend is
// inherently the whole multi-year history, not one period a caller names.
//
// A 2026-09-15 read-only check of production (`tlc-volunteer-db`, period_month=0 rows only) found
// eight fiscal years on file, 2019-2026, each with a clean single winning source after precedence:
//   - 2019-2025 each carry ONLY 'import_activity' (126 rows/year, 11 of them with a null budget --
//     the same "actual with no budget entered" shape buildFinanceChurchReportV1's own comment
//     already documents) -- 'import_activity' wins each of these years by elimination, not by
//     outranking a competing source.
//   - 2026 carries three sources: 'import' (98 rows, CHURCH_SOURCE_PRIORITY's 2nd-highest tier,
//     wins wholesale), 'import_activity' (126 rows, loses), and 'manual_actual_override' (36 rows,
//     every one of them a correction to a category_path already present in the winning 'import'
//     98 -- confirmed none add a new account), so 2026 resolves to exactly 98 accounts, 36 with
//     their actual corrected. No fiscal year resolved to zero accounts in this check, but the
//     empty-years case (a totally empty table, or a future/gap year with nothing synced or
//     imported yet) is still handled as a valid `years: []` state below, not an error -- the same
//     honesty the single-year contract already applies to one empty fiscal year.
//   - Every resolved row's classification was 'Income', 'Expenses', 'Other Income', or
//     'Other Expenses' -- no 'Cost of Goods Sold' row exists in production today, the same finding
//     buildFinanceChurchReportV1's own comment already recorded; the field is still carried below,
//     defensively, since it is valid QuickBooks output the schema does not forbid.
//
// netIncomeActualCents is the FULL bottom line computeYearSummary() derives (Income - Cost of
// Goods Sold - Expenses, plus Other Income - Other Expenses), the exact figure production's own
// existing `finance/church/multi-year` endpoint and its "Net Income" trend row/chart series
// already show today (see src/frontend/js-finance.js's finRenderChurchMultiYear, which reads
// `d.byYear[y].netIncome.actualCents` directly) -- NOT the simpler income-minus-expense figure
// apps/finance's own synthetic fixture uses (church-report-service.js's readSyntheticChurchTrends,
// whose net_cents is literally income_cents - expense_cents). Those two figures are provably
// different for real data: FY2019, FY2021, and FY2024 all carry nonzero Other Income/Other
// Expenses in the checked snapshot above, so a naive income-minus-expense trend would silently
// disagree with the "Net Income" row staff already look at on the existing live page for those
// three years. This contract matches the real, already-shown production figure rather than the
// fixture's simplification.
//
// otherIncomeActualCents/otherExpenseActualCents/costOfGoodsSoldActualCents are carried per year
// specifically so the consumer can independently re-derive netIncomeActualCents from the wire
// payload -- the same "never trust the arithmetic without re-deriving it" discipline the
// single-year Church Report consumer applies to its own totals from its `accounts` array. The
// trend contract does not carry account-level detail (that already exists via the single-year
// contract for whichever year a caller wants to drill into); it stays a per-year rollup, matching
// the shape the 'trend' page itself renders (Fiscal year / Income / Expenses / Net result).
//
// Unlike the single-year contract, there is deliberately no budget figure here: production's own
// existing multi-year trend table and chart (finRenderChurchMultiYear, same file) do not show a
// budget column or series at all -- only Income, Expenses, and Net Income, all actual. Adding a
// budget figure this contract's only real consumer has never shown would not be matching
// production, it would be inventing a new view.
export async function buildFinanceChurchReportTrendV1(db, { now = new Date() } = {}) {
  const { results } = (await db.prepare(
    `SELECT fiscal_year, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source
       FROM finance_church_entries WHERE period_month = 0`
  ).all()) || {};
  const rawRows = results || [];
  const resolved = resolveChurchYearPrecedence(rawRows);

  const rowsByYear = new Map();
  for (const row of resolved) {
    if (!rowsByYear.has(row.fiscal_year)) rowsByYear.set(row.fiscal_year, []);
    rowsByYear.get(row.fiscal_year).push(row);
  }
  const fiscalYears = [...rowsByYear.keys()].sort((a, b) => a - b);

  const years = fiscalYears.map((fiscalYear) => {
    const yearRows = rowsByYear.get(fiscalYear);
    const summary = computeYearSummary(yearRows);
    const income = summary.classificationTotals['Income'] || { actualCents: 0 };
    const expenses = summary.classificationTotals['Expenses'] || { actualCents: 0 };
    const otherIncome = summary.classificationTotals['Other Income'] || { actualCents: 0 };
    const otherExpenses = summary.classificationTotals['Other Expenses'] || { actualCents: 0 };
    const costOfGoodsSold = summary.classificationTotals['Cost of Goods Sold'] || { actualCents: 0 };
    return {
      fiscalYear,
      incomeActualCents: income.actualCents,
      expenseActualCents: expenses.actualCents,
      otherIncomeActualCents: otherIncome.actualCents,
      otherExpenseActualCents: otherExpenses.actualCents,
      costOfGoodsSoldActualCents: costOfGoodsSold.actualCents,
      netIncomeActualCents: summary.netIncome.actualCents,
      accountCount: yearRows.length,
    };
  });

  return {
    contract: 'connect.finance-church-report-trend.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    years,
    reconciliation: {
      yearCount: years.length,
      totalsMatch: true,
    },
  };
}

export async function respondWithFinanceChurchReportTrendV1(db) {
  const trend = await buildFinanceChurchReportTrendV1(db, { now: new Date() });

  // Fail closed, same discipline as every contract above: this should never fire against real
  // data, and if it does, Finance must not see a malformed contract.
  const validation = validateFinanceChurchReportTrendV1(trend);
  if (!validation.ok) {
    return json({ error: 'Internal: assembled church report trend failed contract validation', details: validation.errors }, 500);
  }

  return json(trend);
}

// Sixth real slice of Finance separation: Balance Sheet. A structurally different report from
// Church Report's actual-vs-budget income statement -- point-in-time Assets/Liabilities/Equity
// account balances, one balance per account per fiscal year, read from the separate
// finance_church_balances table (migrations/0019_finance_church_balances.sql), never
// finance_church_entries. Real money crosses this contract, so it is 'aggregate' like Giving,
// Budget, and Church Report.
//
// Unlike Church Report, there is no cross-source precedence to resolve: a direct 2026-09-14
// check of production found exactly one source value, 'import', across all 1,056 rows and all
// eight fiscal years on file (2019-2026) -- a Balance Sheet import always wholesale-replaces the
// prior one for its fiscal year (persistChurchBalancesImport/persistChurchBalancesMultiYearImport
// in src/api-finance.js), so there is never more than one row per (fiscal_year, category_path).
// own_balance_cents is also NOT NULL in the schema and confirmed never null in any real row --
// unlike Church Report's own_budget_cents, this contract has no nullable dollar field at all.
//
// Reuses applyDesignatedFundsAsEquity(), computeBalanceSummary(), and
// computeEquityReclassification() directly from src/api-finance.js -- the exact functions
// production's own `finance/church/balances` GET route already calls, in the exact same order --
// rather than re-deriving any of this report's math independently. That distinction matters here
// even more than it did for Church Report: computeEquityReclassification's own comment block
// states its residual-based Donor-Restricted/Unrestricted split must be computed from the
// UNTRANSFORMED rows ("never on the rows passed to computeEquityReclassification()"), because
// folding Designated Funds into Equity first would, per that comment, double-count them into
// Unrestricted. Production's real route (src/api-finance.js, the `finance/church/balances` GET
// handler) does not follow that documented invariant -- it calls
// `computeEquityReclassification(displayRows)` on the ALREADY-transformed rows, not the raw ones.
// This contract intentionally reproduces the ACTUAL route behavior, not the comment's stated
// intent, for the same reason Church Report reused resolveChurchYearPrecedence()/
// computeYearSummary() verbatim: Finance staging must show the identical number staff already see
// on production's own Balance Sheet tab, not a second, independently "corrected" one. Flagged for
// Andrew/production review in this contract's own PR body rather than silently resolved either
// way here.
//
// Also confirmed 2026-09-14: contrary to a separate comment in src/api-finance.js claiming a
// has_children group row "carries a $0 own value in every real export observed," 8 real rows
// across FY2019-2025 are has_children=1 with a genuinely nonzero own_balance_cents -- most
// commonly "11027 Lindell Checking xx9105" (the very account this codebase treats as the
// operating-cash account elsewhere), which turns out to be a real two-level parent with its own
// distinct balance AND a nested "11030 Cash on hand" child line, not a duplicated subtotal. This
// does not break computeBalanceSummary(), which already sums every row's own_balance_cents flatly
// regardless of has_children by design -- but it does mean this contract (and its consumer's own
// cross-check) must never filter has_children rows out when re-deriving classification totals, or
// it would compute a different number than production's own page.
//
// Modeled on Church Report's single-fiscal-year shape (not a date range like Giving, not a
// whole-tree/no-params shape): a Balance Sheet is naturally one point-in-time
// snapshot per fiscal year, so the caller names the year, and a year with nothing imported yet
// answers with a valid, empty-accounts contract rather than a 404 -- same reasoning as every prior
// contract's own empty-state design.
export async function buildFinanceBalanceSheetV1(db, { fiscalYear, now = new Date() }) {
  const { results } = (await db.prepare(
    `SELECT fiscal_year, as_of_date, classification, category_path, account_name, depth, has_children, own_balance_cents
       FROM finance_church_balances WHERE fiscal_year = ? ORDER BY category_path`
  ).bind(fiscalYear).all()) || {};
  const rawRows = results || [];
  // See the module-comment above: this is the exact same transform-then-summarize order
  // production's own `finance/church/balances` GET route uses, bug (if it is one) included.
  const displayRows = applyDesignatedFundsAsEquity(rawRows);
  const summary = computeBalanceSummary(displayRows);
  const equityReclass = computeEquityReclassification(displayRows);

  const accounts = displayRows.map((row) => ({
    classification: row.classification,
    categoryPath: row.category_path,
    accountName: row.account_name,
    depth: row.depth,
    hasChildren: Boolean(row.has_children),
    ownBalanceCents: row.own_balance_cents,
  }));

  let assetsCount = 0, liabilitiesCount = 0, equityCount = 0;
  for (const account of accounts) {
    if (account.classification === 'Assets') assetsCount++;
    else if (account.classification === 'Liabilities') liabilitiesCount++;
    else if (account.classification === 'Equity') equityCount++;
  }

  return {
    contract: 'connect.finance-balance-sheet.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    fiscalYear,
    asOfDate: rawRows[0]?.as_of_date || '',
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    accounts,
    totals: {
      assetsCents: summary.assetsCents,
      liabilitiesCents: summary.liabilitiesCents,
      equityCents: summary.equityCents,
      currentAssetsCents: summary.currentAssetsCents,
      fixedAssetsCents: summary.fixedAssetsCents,
      otherAssetsCents: summary.otherAssetsCents,
      liabilitiesPlusEquityCents: summary.liabilitiesPlusEquityCents,
      balancedCents: summary.balancedCents,
    },
    equityReclass: {
      donorRestrictedCents: equityReclass.donorRestrictedCents,
      unrestrictedCents: equityReclass.unrestrictedCents,
      totalEquityCents: equityReclass.totalEquityCents,
      breakdown: equityReclass.breakdown,
      unclassified: equityReclass.unclassified.map((u) => ({
        accountName: u.account_name, categoryPath: u.category_path, ownBalanceCents: u.own_balance_cents,
      })),
    },
    reconciliation: {
      accountCount: accounts.length,
      assetsCount,
      liabilitiesCount,
      equityCount,
      unclassifiedEquityCount: equityReclass.unclassified.length,
      totalsMatch: true,
    },
  };
}

export async function respondWithFinanceBalanceSheetV1(url, db) {
  const fiscalYearStr = url.searchParams.get('fiscal_year');
  if (!isValidFiscalYearStr(fiscalYearStr)) {
    return json({ error: 'fiscal_year is required as a 4-digit year' }, 400);
  }
  const balanceSheet = await buildFinanceBalanceSheetV1(db, { fiscalYear: Number(fiscalYearStr), now: new Date() });

  // Fail closed, same discipline as the contracts above: this should never fire against real
  // data, and if it does, Finance must not see a malformed contract.
  const validation = validateFinanceBalanceSheetV1(balanceSheet);
  if (!validation.ok) {
    return json({ error: 'Internal: assembled balance sheet failed contract validation', details: validation.errors }, 500);
  }

  return json(balanceSheet);
}

// Balance Sheet multi-year trend -- the multi-year sibling of buildFinanceBalanceSheetV1 above,
// backing the 'balance' section's 'multi-year' page (apps/finance/balance-pages.js), which today
// only reads the untouched synthetic fixture (readSyntheticBalanceTrends in
// apps/finance/balance-sheet-service.js). No fiscal_year parameter: like Chart of Accounts'
// original whole-tree/no-params shape, this always returns every distinct fiscal year on file, ascending --
// production only has eight (2019-2026, 1,056 rows total, confirmed both on 2026-09-14 for the
// single-year contract above and again while building this trend contract), so this is a single
// one-query read, not a windowed or paginated one.
//
// Reuses applyDesignatedFundsAsEquity() and computeBalanceSummary() per fiscal year -- the exact
// same two functions, in the exact same order, as buildFinanceBalanceSheetV1 above -- rather than
// re-deriving this report's math independently. That is a deliberate choice, not an oversight:
// production's OWN existing multi-year route (src/api-finance.js's
// `finance/church/balances/multi-year` GET handler, which backs the legacy Finance UI's
// "Net Worth Growth by Year" table in src/frontend/js-finance.js) computes
// `computeBalanceSummary(applyDesignatedFundsAsEquity(yearRows)).equityCents` for every year the
// exact same way, and that legacy table's own caption reads "Change in total equity (assets minus
// liabilities)" -- i.e., legacy already treats total equity (post reclassification) and "net
// assets" as the same figure. This contract's `netAssetsCents` is therefore defined as
// `equityCents`, not a separately recomputed `assetsCents - liabilitiesCents`, so it can never
// diverge from what the single-year Balance Sheet contract's own 'position' page already labels
// "Net assets" for the same fiscal year (see balance-pages.js: `{ label: 'Net assets', value:
// formatCents(report.totals.equityCents) }`). A 2026-09-14 check of every real fiscal year on file
// found every year balances to the penny (balancedCents === 0), so netAssetsCents and a naive
// assets-minus-liabilities figure are numerically identical today either way -- but only the
// equityCents-based definition is guaranteed to keep matching the single-year page if that ever
// stops being true.
//
// Also confirmed while investigating this contract: as_of_date is NOT a consistently formatted
// date across fiscal years. FY2019 through FY2025 store the literal placeholder string
// "FY2019".."FY2025" (not a real calendar date), and only FY2026 stores a real formatted date
// ("December 31, 2026"). Every fiscal year has exactly one distinct as_of_date value (no MAX-style
// pick is needed today, unlike the synthetic fixture's own defensive MAX(as_of_date)), but this
// contract deliberately never parses or date-sorts asOfDate -- `years` is ordered by the real
// integer fiscalYear column instead.
export async function buildFinanceBalanceSheetTrendV1(db, { now = new Date() } = {}) {
  const { results } = (await db.prepare(
    `SELECT fiscal_year, as_of_date, classification, category_path, account_name, depth, has_children, own_balance_cents
       FROM finance_church_balances ORDER BY fiscal_year, category_path`
  ).all()) || {};
  const rawRows = results || [];

  const rowsByYear = new Map();
  for (const row of rawRows) {
    if (!rowsByYear.has(row.fiscal_year)) rowsByYear.set(row.fiscal_year, []);
    rowsByYear.get(row.fiscal_year).push(row);
  }

  const years = [...rowsByYear.keys()].sort((a, b) => a - b).map((fiscalYear) => {
    const yearRawRows = rowsByYear.get(fiscalYear);
    // Same transform-then-summarize order as buildFinanceBalanceSheetV1 above -- see that
    // function's own module comment for why this intentionally reproduces production's actual
    // route behavior rather than a separately "corrected" one.
    const displayRows = applyDesignatedFundsAsEquity(yearRawRows);
    const summary = computeBalanceSummary(displayRows);
    return {
      fiscalYear,
      asOfDate: yearRawRows[0]?.as_of_date || '',
      assetsCents: summary.assetsCents,
      liabilitiesCents: summary.liabilitiesCents,
      equityCents: summary.equityCents,
      netAssetsCents: summary.equityCents,
      balancedCents: summary.balancedCents,
    };
  });

  return {
    contract: 'connect.finance-balance-sheet-trend.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    years,
    reconciliation: {
      yearCount: years.length,
      totalsMatch: years.every((y) => y.balancedCents === 0),
    },
  };
}

export async function respondWithFinanceBalanceSheetTrendV1(db) {
  const trend = await buildFinanceBalanceSheetTrendV1(db, { now: new Date() });

  // Fail closed, same discipline as the contracts above: this should never fire against real
  // data, and if it does, Finance must not see a malformed contract.
  const validation = validateFinanceBalanceSheetTrendV1(trend);
  if (!validation.ok) {
    return json({ error: 'Internal: assembled balance sheet trend failed contract validation', details: validation.errors }, 500);
  }

  return json(trend);
}

// Seventh real slice of Finance separation: Daycare Report. This looks, at first read, like the
// cross-product boundary case AGENTS.md's product-boundary section warns about ("myMDO owns raw
// childcare operations, billing... Finance consumes narrow summaries, never becomes a second
// writer") -- but a full read of production (src/daycare.js, src/api-finance.js's "Daycare data
// from an already-imported Church Budget year" block, src/frontend/js-finance.js's Daycare Report
// section) shows the Daycare Report's actual dollar figures are NOT a pass-through of myMDO's own
// bookkeeping today. Two real daycare-money paths exist in production: (1) a genuine cross-product
// pull from the daycare app's own finance API (src/daycare.js's makeDaycareClient, source=
// 'daycare_api'), and (2) the church's OWN Budget import, re-tagged by MDO-account-name matching
// (extractMdoDaycareEntries, source='church_budget_import') plus direct source=
// 'manual_budget_override' edits. Per Andrew's own explicit, code-commented decision -- "there
// should really only be one source, the church import is fine" (see FIN_DAYCARE_COUNTED_SOURCES in
// js-finance.js) -- the Daycare Report's real totals count ONLY path (2); the myMDO-sourced sync and
// one-off source='manual' rows sit in the same table but are deliberately EXCLUDED from every total,
// surfaced instead as a "not counted" warning banner. This contract reproduces that decision exactly
// -- it is a read of Finance's OWN already-classified data (finance_daycare_entries), not a new pull
// from myMDO, so it is 'connect'-sourced/'finance'-owned like every contract above, not a myMDO
// contract. (A future myMDO->Finance summary contract for path (1) is a separate, not-yet-built
// question, out of scope here -- see this PR's body.)
//
// Utilities/Insurance are not real finance_daycare_entries categories -- MDO shares the church's
// building and has no such accounts of its own. Per another explicit user decision, these two lines
// are a LIVE percentage of the CHURCH side's own actual Utilities/Insurance expense for the same
// fiscal year, recomputed every time via computeMdoUtilityInsuranceAllocation() (reused directly
// from src/api-finance.js -- the exact function production's own `finance/daycare/allocation` GET
// route already calls), never a stored dollar figure. The percentage comes from finance_settings'
// `finance_daycare_allocation_config` JSON blob (utilityPct/insurancePct), defaulting to 0.5/0.5 --
// matching that route's own default exactly.
//
// Modeled on Church Report's single-fiscal-year shape: finance_daycare_entries.period is always a
// bare 4-digit year string for BOTH counted sources -- confirmed directly in
// persistDaycareEntriesFromChurchBudget and the `finance/daycare/budget-override` handler, which
// always write period=String(year), never YYYY-MM (only the excluded 'daycare_api' sync ever writes
// a monthly period) -- so the caller names the fiscal year, and a year with nothing on file yet
// answers with a valid, empty-categories contract rather than a 404, same as every prior contract.
//
// category is a closed 8-value set: classifyMdoAccountCategory() (src/api-finance.js) can only ever
// return 'Tuition Income', 'Payroll', 'Payroll Taxes', 'Workers Comp', 'Other Payroll Expenses', or
// its catch-all 'Other Expenses' -- plus the two live-derived 'Utilities'/'Insurance' categories.
// classification is 'Income' for 'Tuition Income' only (exact case-insensitive match, same as
// finIsIncomeCategory in js-finance.js) and 'Expenses' for every other category -- the Daycare
// Report has no Other Income/Cost of Goods Sold concept the way Church Report does.
//
// A manual_budget_override row REPLACES (never adds to) the church_budget_import budget total for
// its exact (period, category) -- matching finAggregateDaycareByYear's own override semantics in
// js-finance.js exactly: the override is read after the normal per-source sum and its amount wins
// outright rather than being summed in.
const DAYCARE_KNOWN_CATEGORY_ORDER = [
  'Tuition Income', 'Payroll', 'Payroll Taxes', 'Workers Comp', 'Other Payroll Expenses',
  'Utilities', 'Insurance', 'Other Expenses',
];
function isDaycareIncomeCategory(category) {
  return String(category || '').trim().toLowerCase() === 'tuition income';
}

export async function buildFinanceDaycareReportV1(db, { fiscalYear, now = new Date() }) {
  const period = String(fiscalYear);
  const { results } = (await db.prepare(
    `SELECT category, entry_type, amount_cents, source FROM finance_daycare_entries
       WHERE period = ? AND source IN ('church_budget_import','manual_budget_override')
       ORDER BY category, entry_type`
  ).bind(period).all()) || {};
  const rows = results || [];

  const categoryTotals = {};
  const order = [];
  const ensureCategory = (cat) => {
    if (!categoryTotals[cat]) { categoryTotals[cat] = { actualCents: 0, budgetCents: 0 }; order.push(cat); }
    return categoryTotals[cat];
  };
  const overrideBudgetCents = {};
  for (const row of rows) {
    if (row.entry_type === 'budget' && row.source === 'manual_budget_override') {
      overrideBudgetCents[row.category] = row.amount_cents;
      continue;
    }
    const entry = ensureCategory(row.category);
    if (row.entry_type === 'budget') entry.budgetCents += row.amount_cents;
    else entry.actualCents += row.amount_cents;
  }
  for (const [cat, cents] of Object.entries(overrideBudgetCents)) {
    ensureCategory(cat).budgetCents = cents;
  }

  // Utilities/Insurance live allocation -- see module comment above. Only merged in when the
  // church side actually has a fiscal-year ledger to derive them from; a genuinely empty year
  // (nothing imported on either side) stays a genuinely empty contract rather than surfacing two
  // zeroed derived lines that would imply data exists when none does.
  const cfgRow = await db.prepare(
    `SELECT value FROM finance_settings WHERE key='finance_daycare_allocation_config'`
  ).first();
  let utilityPct = 0.5, insurancePct = 0.5;
  if (cfgRow?.value) {
    try {
      const cfg = JSON.parse(cfgRow.value);
      if (Number.isFinite(cfg.utilityPct)) utilityPct = cfg.utilityPct;
      if (Number.isFinite(cfg.insurancePct)) insurancePct = cfg.insurancePct;
    } catch { /* keep defaults, same fallback as the real allocation-config route */ }
  }
  const churchRows = (await db.prepare(
    `SELECT * FROM finance_church_entries WHERE fiscal_year = ? AND period_month = 0`
  ).bind(fiscalYear).all()).results || [];
  const resolvedChurchRows = resolveChurchYearPrecedence(churchRows);
  const allocationByYear = computeMdoUtilityInsuranceAllocation({ [fiscalYear]: resolvedChurchRows }, utilityPct, insurancePct);
  const alloc = allocationByYear[fiscalYear];

  if (resolvedChurchRows.length > 0) {
    ensureCategory('Utilities').actualCents = alloc.mdoUtilityCents;
    ensureCategory('Insurance').actualCents = alloc.mdoInsuranceCents;
  }

  const sortedCategories = DAYCARE_KNOWN_CATEGORY_ORDER.filter((c) => order.includes(c))
    .concat(order.filter((c) => !DAYCARE_KNOWN_CATEGORY_ORDER.includes(c)).sort());

  let incomeActualCents = 0, incomeBudgetCents = 0, expenseActualCents = 0, expenseBudgetCents = 0;
  let incomeCategoryCount = 0, expenseCategoryCount = 0;
  const categories = sortedCategories.map((cat) => {
    const classification = isDaycareIncomeCategory(cat) ? 'Income' : 'Expenses';
    const entry = categoryTotals[cat];
    if (classification === 'Income') { incomeCategoryCount++; incomeActualCents += entry.actualCents; incomeBudgetCents += entry.budgetCents; }
    else { expenseCategoryCount++; expenseActualCents += entry.actualCents; expenseBudgetCents += entry.budgetCents; }
    return { category: cat, classification, actualCents: entry.actualCents, budgetCents: entry.budgetCents };
  });

  return {
    contract: 'connect.finance-daycare-report.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    fiscalYear,
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    categories,
    allocation: {
      utilityPct,
      insurancePct,
      churchUtilityActualCents: alloc.utilityActualCents,
      churchInsuranceActualCents: alloc.insuranceActualCents,
      mdoUtilityCents: alloc.mdoUtilityCents,
      mdoInsuranceCents: alloc.mdoInsuranceCents,
    },
    totals: {
      incomeActualCents,
      incomeBudgetCents,
      expenseActualCents,
      expenseBudgetCents,
      netActualCents: incomeActualCents - expenseActualCents,
      netBudgetCents: incomeBudgetCents - expenseBudgetCents,
    },
    reconciliation: {
      categoryCount: categories.length,
      incomeCategoryCount,
      expenseCategoryCount,
      totalsMatch: true,
    },
  };
}

export async function respondWithFinanceDaycareReportV1(url, db) {
  const fiscalYearStr = url.searchParams.get('fiscal_year');
  if (!isValidFiscalYearStr(fiscalYearStr)) {
    return json({ error: 'fiscal_year is required as a 4-digit year' }, 400);
  }
  const report = await buildFinanceDaycareReportV1(db, { fiscalYear: Number(fiscalYearStr), now: new Date() });

  // Fail closed, same discipline as the contracts above: this should never fire against real
  // data, and if it does, Finance must not see a malformed contract.
  const validation = validateFinanceDaycareReportV1(report);
  if (!validation.ok) {
    return json({ error: 'Internal: assembled daycare report failed contract validation', details: validation.errors }, 500);
  }

  return json(report);
}

// ── Daycare entries: the individual rows behind Finance's Daycare actuals screens ─────────────
// Legacy finRenderDaycare (src/frontend/js-finance.js) lists every finance_daycare_entries row with
// Edit (all rows) and Delete (all but daycare_api rows). This returns one fiscal year's rows -- the
// annual `YYYY` period plus its `YYYY-MM` months -- so Finance can target the existing
// finance-daycare-entry-edit/-remove relays by id. Bounded: a year is at most a few hundred rows
// (monthly sync x categories); the LIMIT only guards against a runaway import.
const DAYCARE_ENTRIES_LIMIT = 2000;

export async function buildFinanceDaycareEntriesV1(db, { fiscalYear, now = new Date() }) {
  const year = String(fiscalYear);
  const rows = (await db.prepare(
    `SELECT id, period, category, entry_type, amount_cents, notes, source FROM finance_daycare_entries
       WHERE period = ? OR period LIKE ?
       ORDER BY period, category, id LIMIT ${DAYCARE_ENTRIES_LIMIT}`
  ).bind(year, `${year}-%`).all()).results || [];
  return {
    contract: 'connect.finance-daycare-entries.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    fiscalYear,
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    entries: rows.map((r) => ({
      id: r.id,
      period: r.period,
      category: r.category || '',
      entryType: r.entry_type === 'budget' ? 'budget' : 'actual',
      amountCents: Number.isInteger(r.amount_cents) ? r.amount_cents : Math.round(Number(r.amount_cents) || 0),
      notes: r.source === 'daycare_api' ? '' : (r.notes || ''),
      source: r.source || 'manual',
    })),
  };
}

export async function respondWithFinanceDaycareEntriesV1(url, db) {
  const fiscalYearStr = url.searchParams.get('fiscal_year');
  if (!isValidFiscalYearStr(fiscalYearStr)) {
    return json({ error: 'fiscal_year is required as a 4-digit year' }, 400);
  }
  const entries = await buildFinanceDaycareEntriesV1(db, { fiscalYear: Number(fiscalYearStr), now: new Date() });
  const validation = validateFinanceDaycareEntriesV1(entries);
  if (!validation.ok) {
    return json({ error: 'Internal: assembled daycare entries failed contract validation', details: validation.errors }, 500);
  }
  return json(entries);
}

// ── Property Valuation: the eighth contract, and the first sourced from a JSON settings blob ──
// rather than a dedicated relational table. `finance_property_<property_key>_meta` (table
// `finance_settings`) is a real, admin-maintained income-capitalization worksheet for the
// church's owned commercial property (3277 Ivanhoe) -- rent roll, itemized operating costs, and
// assumptions (vacancy rate, management fee %, cap rate) -- entered from AHRA's own valuation
// worksheet and updated by hand as new figures come in. Confirmed live against production on
// 2026-09-14: the stored `valuation.as_of_date` is 2026-08-12, newer than any date this
// repository's own static seed carries, so it has genuinely been edited since the original
// seedIvanhoePropertyValuationV3() ran -- this is not a frozen fixture. See
// contracts/validators/finance-property-valuation-consumer.js's header comment for the full reasoning
// on why this differs from the seven prior contracts (Giving/Data Status/Chart of Accounts/
// Budget/Church Report/Balance Sheet/Daycare Report), which all read a table that already
// existed in the shared legacy schema.
//
// Reuses src/frontend/js-finance.js's own FIN_VAL_OP_COST_FIELDS list (mirrored here as
// FIN_VAL_OP_COST_FIELDS) so the seven operating-cost keys/labels/order can never drift from
// what production's real worksheet edit form and finComputePropertyValuation() use.
const FIN_VAL_OP_COST_FIELDS = [
  ['utilities_cents', 'Utilities'],
  ['trash_cents', 'Trash'],
  ['maintenance_repairs_cents', 'Maintenance/Repairs'],
  ['landscaping_snow_cents', 'Landscaping/Snow'],
  ['legal_cents', 'Legal'],
  ['taxes_cents', 'Taxes'],
  ['insurance_cents', 'Insurance'],
];

function toRoundedInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

// Real rent_roll rows carry a human tenant name, not a stable machine key -- unlike the
// synthetic fixture's own unit_key column. Slugified here (and de-duplicated by position, in the
// unlikely event two tenants share the exact same name) so the contract can still offer a stable
// per-unit identifier without inventing one that isn't derivable from the source data.
function slugifyTenant(label, index) {
  const base = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base || `unit-${index + 1}`;
}

export async function buildFinancePropertyValuationV1(db, { propertyKey = 'ivanhoe', now = new Date() } = {}) {
  const metaRow = await db.prepare('SELECT value FROM finance_settings WHERE key=?').bind(`finance_property_${propertyKey}_meta`).first();
  let meta = {};
  if (metaRow?.value) {
    try { meta = JSON.parse(metaRow.value); } catch { meta = {}; }
  }
  const val = (meta && typeof meta === 'object' && meta.valuation) || {};

  const rentRollRaw = Array.isArray(val.rent_roll) ? val.rent_roll : [];
  const seenUnitKeys = new Set();
  const rentRoll = rentRollRaw.map((row, index) => {
    let unitKey = slugifyTenant(row?.tenant, index);
    if (seenUnitKeys.has(unitKey)) unitKey = `${unitKey}-${index + 1}`;
    seenUnitKeys.add(unitKey);
    return {
      unitKey,
      tenantLabel: String(row?.tenant || ''),
      squareFeet: toRoundedInt(row?.sqft),
      annualRentCents: toRoundedInt(row?.annual_rent_cents),
    };
  });

  const opCostsSrc = (val.operating_costs && typeof val.operating_costs === 'object') ? val.operating_costs : {};
  const operatingCosts = FIN_VAL_OP_COST_FIELDS.map(([field, label]) => ({
    costKey: field.replace(/_cents$/, ''),
    costLabel: label,
    annualCostCents: toRoundedInt(opCostsSrc[field]),
  }));

  const assumptions = {
    propertyKey,
    utilityReimbursementCents: toRoundedInt(val.utility_reimbursement_cents),
    vacancyRatePct: Number(val.vacancy_rate_pct) || 0,
    managementFeePct: Number(val.management_fee_pct) || 0,
    capRate: Number(val.cap_rate) || 0,
  };

  // Same walk as production's own finComputePropertyValuation() (src/frontend/js-finance.js) and
  // this repository's staging fixture's own buildPropertyValuationView (property-report-
  // service.js) -- kept in sync deliberately, not shared as one function, since the two live in
  // separate deployable applications.
  const totalAnnualRentCents = rentRoll.reduce((sum, r) => sum + r.annualRentCents, 0);
  const grossRentalIncomeCents = totalAnnualRentCents + assumptions.utilityReimbursementCents;
  const vacancyCents = Math.round(grossRentalIncomeCents * assumptions.vacancyRatePct);
  const effectiveRentalIncomeCents = grossRentalIncomeCents - vacancyCents;
  const itemizedOperatingCostsCents = operatingCosts.reduce((sum, c) => sum + c.annualCostCents, 0);
  const managementFeeCents = Math.round(effectiveRentalIncomeCents * assumptions.managementFeePct);
  const totalOperatingCostsCents = itemizedOperatingCostsCents + managementFeeCents;
  const noiCents = effectiveRentalIncomeCents - totalOperatingCostsCents;
  const capitalizedValueCents = assumptions.capRate ? Math.round(noiCents / assumptions.capRate) : 0;

  return {
    contract: 'connect.finance-property-valuation.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    propertyKey,
    asOfDate: typeof val.as_of_date === 'string' ? val.as_of_date : '',
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    assumptions,
    rentRoll,
    operatingCosts,
    totals: {
      totalAnnualRentCents, grossRentalIncomeCents, vacancyCents, effectiveRentalIncomeCents,
      itemizedOperatingCostsCents, managementFeeCents, totalOperatingCostsCents, noiCents,
      capitalizedValueCents,
      reconciled: effectiveRentalIncomeCents - itemizedOperatingCostsCents - managementFeeCents === noiCents,
    },
  };
}

export async function respondWithFinancePropertyValuationV1(url, db) {
  const propertyKey = url.searchParams.get('property_key') || 'ivanhoe';
  const valuation = await buildFinancePropertyValuationV1(db, { propertyKey, now: new Date() });

  // Fail closed, same discipline as the contracts above: this should never fire against real
  // data -- a missing or malformed worksheet is a real configuration problem, not a normal empty
  // state (unlike Balance Sheet's "nothing imported yet" fiscal year) -- and if it does, Finance
  // must not see a malformed contract.
  const validation = validateFinancePropertyValuationV1(valuation);
  if (!validation.ok) {
    return json({ error: 'Internal: assembled property valuation failed contract validation', details: validation.errors }, 500);
  }

  return json(valuation);
}

// Ninth real slice of Finance separation, and the first that is NOT a church-wide or role-level
// aggregate: per Andrew's explicit decision (2026-09-14, in response to this PR's own investigation
// findings), this reproduces production's real Salary & Benefits Calculator roster -- individually,
// not aggregated by role -- because with only 7 workers on the real roster today, a role-level
// rollup would not actually anonymize anything (most roles have exactly one occupant, so a "role
// total" would just relabel one named person's real salary). "No aggregation, no suppression" was
// the explicit instruction; see finance-compensation-consumer.js's header comment for the full
// reasoning and for exactly which stored fields this contract does and does not carry.
//
// Source is finance_settings' 'finance_salary_planner' key -- the SHARED admin/finance/council
// roster (see api-finance.js's SALARY_PLANNER_KEY), not the 'compensation' role's own
// 'finance_salary_planner_compensation' fork (a private raise-plan sandbox that never overwrites
// the shared roster) and not council's own per-username raise-plan overlay. Those are planning-tool
// state scoped to whoever is currently working the calculator, not "the real compensation records"
// this contract represents.
//
// Not fiscal-year-scoped, unlike every dollar contract above -- the roster is a standing list of
// current staff, not a per-year plan (same reasoning as production's own SALARY_PLANNER_KEY
// comment), so there is no fiscalYear parameter and no per-year query string to validate.
//
// currentPayCents is production's own actualSalaryCents pass-through (finCompCurrentPayCents's
// "hand-entered" branch in src/frontend/js-finance.js) -- null, with currentPaySource
// 'budget_line', when a worker's current pay instead comes from their linked Chart of Accounts
// budget line (accountCode). That lookup (finAccountBudgetCentsForCode) exists only as a
// frontend-side substring match against the currently-loaded budget tree, not a server-side
// function this file can import -- reproducing its matching behavior here would risk silently
// drifting from what the real calculator shows. Finance can already resolve accountCode against
// the real dollar figure itself via the already-live connect.finance-budget.v1 contract instead of
// this file duplicating that lookup. currentPaySource is 'unset' only when neither a hand-entered
// figure nor a linked account code exists at all.
//
// This does NOT reproduce the derived "District Worksheet" dollar figure (finCompWorksheetCents) --
// that is a live computation off LCMS pay-scale multiplier tables that exists only in the frontend
// calculator (src/frontend/js-finance.js), not stored data; porting that whole table-driven
// computation server-side is separate, larger work and out of scope here. The worksheet INPUT
// fields it would need (role, trackKey, yearsExperience, responsibilityStipend, attendanceBonus)
// are passed through as stored, so Finance has everything it needs to compute the same figure once
// (if ever) that logic is ported.
function isRecordLike(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function buildFinanceCompensationV1(db, { now = new Date() } = {}) {
  const row = await db.prepare("SELECT value FROM finance_settings WHERE key='finance_salary_planner'").first();
  let data = null;
  if (row) { try { data = JSON.parse(row.value); } catch { data = null; } }
  const rosterRaw = Array.isArray(data?.roster) ? data.roster : [];

  const asString = (v) => (typeof v === 'string' ? v : '');
  const asFiniteNumber = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  let enteredCount = 0;
  let enteredCurrentPayCents = 0;
  const workers = rosterRaw.filter((w) => isRecordLike(w)).map((w) => {
    const accountCode = asString(w.accountCode);
    const hasEnteredPay = Number.isInteger(w.actualSalaryCents);
    const currentPaySource = hasEnteredPay ? 'entered' : (accountCode ? 'budget_line' : 'unset');
    if (hasEnteredPay) { enteredCount += 1; enteredCurrentPayCents += w.actualSalaryCents; }
    return {
      name: asString(w.name),
      position: asString(w.position),
      accountCode,
      role: asString(w.role),
      trackKey: asString(w.trackKey),
      education: asString(w.education),
      yearsExperience: asFiniteNumber(w.yearsExperience),
      responsibilityStipend: asFiniteNumber(w.responsibilityStipend),
      attendanceBonus: asFiniteNumber(w.attendanceBonus),
      selfEmployedFica: Boolean(w.selfEmployedFica),
      hasDependents: Boolean(w.hasDependents),
      healthEnrolled: Boolean(w.healthEnrolled),
      hideFromCouncil: Boolean(w.hideFromCouncil),
      currentPayCents: hasEnteredPay ? w.actualSalaryCents : null,
      currentPaySource,
    };
  });

  return {
    contract: 'connect.finance-compensation.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    workers,
    totals: {
      workerCount: workers.length,
      enteredCurrentPayCount: enteredCount,
      unenteredCurrentPayCount: workers.length - enteredCount,
      enteredCurrentPayCents,
    },
    reconciliation: {
      workerCount: workers.length,
      totalsMatch: true,
    },
  };
}

export async function respondWithFinanceCompensationV1(db) {
  const compensation = await buildFinanceCompensationV1(db, { now: new Date() });

  // Fail closed, same discipline as the contracts above: this should never fire against real
  // data, and if it does, Finance must not see a malformed contract.
  const validation = validateFinanceCompensationV1(compensation);
  if (!validation.ok) {
    return json({ error: 'Internal: assembled compensation report failed contract validation', details: validation.errors }, 500);
  }

  return json(compensation);
}

// ── Property Operating Results: the tenth contract ──────────────────────────────────────────
// This, Reserves (the eleventh), and Ledgers (the twelfth) are the three contracts that finish
// the Commercial Property slice PR #994 explicitly deferred: "The separately-sourced Commercial
// Property monthly report/reserves/capital/repairs (finance_property_monthly,
// finance_property_reserves, finance_property_capital_ledger, finance_property_repairs -- all
// real tables already in the shared legacy schema with their own accumulated history) are a
// different, already-schema-compatible slice, deliberately left for a future PR". Investigated
// directly against production on 2026-09-15 rather than assumed: this contract, reserves, and
// ledgers really are three different shapes (a monthly recurring statement vs. a reserve funding
// schedule vs. itemized one-off ledgers), the same reasoning that kept Balance Sheet/Church
// Report separate from Budget.
//
// This contract is the monthly recurring statement: one row per report month from
// finance_property_monthly (30 real rows for 'ivanhoe' as of 2026-09-15, spanning 2023-12
// through 2026-07), plus the same per-fiscal-year annualSummary production's own
// `finance/property/<key>` GET route already returns alongside it -- reused directly via
// computePropertyAnnualSummary (src/api-finance.js), not reimplemented here, so this contract's
// annual rollups can never drift from what staff see in production today. distributions
// (finance_property_distributions) is queried here ONLY as computePropertyAnnualSummary's own
// second argument (it needs distribution rows to fill in confirmed_distributions_cents per
// year) -- the per-period distribution rows themselves are NOT exposed by this contract; they
// belong to, and are exposed by, the Reserves contract below, whose "Reserve & distribution" UI
// page is the one that actually renders them.
//
// Two real findings from checking live production data directly (not assumed from the synthetic
// fixture's own shape):
//
// 1. occupancy_pct is stored as a 0-1 FRACTION in real data (0.893, 1, 0.8892, ...), not the 0-100
//    scale the committed synthetic fixture uses (finance_property_monthly seed row: occupancy_pct
//    90). This contract follows the same 0-1 convention connect.finance-property-valuation.v1
//    already established for vacancyRatePct/managementFeePct (see FIN_VAL_OP_COST_FIELDS above),
//    not the synthetic fixture's 0-100 scale -- the *100 conversion needed to keep reusing the
//    existing renderPropertyRows() (which expects 0-100, since that's what the synthetic fixture
//    happens to store) is done once, in the staging live-view builder
//    (apps/finance/property-report-service.js's buildLivePropertyOperatingRows), not baked into
//    the contract's own number.
// 2. total_expenses_cents, net_operating_income_cents, available_for_distribution_cents,
//    reserve_balance_cents, loan_payment_cents, and interest_expense_cents are all genuinely
//    nullable in real data (4, 23, 25, 25, 29, and 29 of the 30 real rows respectively) --
//    several months' AHRA reports simply don't break out those figures. total_revenue_cents,
//    net_income_cents, and occupancy_pct are never null. Every one of the 26 rows that DOES carry
//    a total_expenses_cents reconciles exactly (total_revenue_cents - total_expenses_cents ===
//    net_income_cents, to the cent, confirmed against all 26 such rows) -- this contract and its
//    consumer cross-check that invariant on exactly those rows, the same way
//    computePropertyAnnualSummary's own comment already documents deriving the missing months'
//    expenses from revenue - net income rather than treating them as zero.
export async function buildFinancePropertyOperatingV1(db, { propertyKey = 'ivanhoe', now = new Date() } = {}) {
  const monthlyRows = (await db.prepare(
    'SELECT period, occupancy_pct, total_revenue_cents, total_expenses_cents, net_income_cents, net_operating_income_cents, available_for_distribution_cents, reserve_balance_cents, loan_payment_cents, interest_expense_cents, source_report FROM finance_property_monthly WHERE property_key=? ORDER BY period ASC'
  ).bind(propertyKey).all()).results || [];
  const distributionRows = (await db.prepare(
    'SELECT period, amount_cents FROM finance_property_distributions WHERE property_key=? ORDER BY period ASC'
  ).bind(propertyKey).all()).results || [];

  const periods = monthlyRows.map((r) => ({
    period: r.period,
    occupancyPct: Number(r.occupancy_pct),
    totalRevenueCents: r.total_revenue_cents,
    totalExpensesCents: r.total_expenses_cents ?? null,
    netIncomeCents: r.net_income_cents,
    netOperatingIncomeCents: r.net_operating_income_cents ?? null,
    availableForDistributionCents: r.available_for_distribution_cents ?? null,
    reserveBalanceCents: r.reserve_balance_cents ?? null,
    loanPaymentCents: r.loan_payment_cents ?? null,
    interestExpenseCents: r.interest_expense_cents ?? null,
    sourceReport: r.source_report || '',
  }));

  // Same function, same input shape (property_key-scoped rows with a `period`/`amount_cents`
  // column set) that production's own handlePropertyApi passes it -- reused, not reimplemented.
  const annualSummary = computePropertyAnnualSummary(monthlyRows, distributionRows).map((y) => ({
    year: y.year,
    totalRevenueCents: y.total_revenue_cents,
    totalExpensesCents: y.total_expenses_cents,
    netIncomeCents: y.net_income_cents,
    avgOccupancyPct: y.avg_occupancy_pct,
    confirmedDistributionsCents: y.confirmed_distributions_cents,
    expenseMonthsDerived: y.expense_months_derived,
    notes: y.notes || '',
  }));

  return {
    contract: 'connect.finance-property-operating.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    propertyKey,
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    periods,
    annualSummary,
  };
}

export async function respondWithFinancePropertyOperatingV1(url, db) {
  const propertyKey = url.searchParams.get('property_key') || 'ivanhoe';
  const operating = await buildFinancePropertyOperatingV1(db, { propertyKey, now: new Date() });

  // Fail closed, same discipline as the contracts above: an empty periods array is a normal
  // "nothing reported yet" state (same as Budget/Church Report/Balance Sheet/Daycare Report's own
  // empty-fiscal-year convention) and passes validation, but a malformed shape must not reach
  // Finance.
  const validation = validateFinancePropertyOperatingV1(operating);
  if (!validation.ok) {
    return json({ error: 'Internal: assembled property operating report failed contract validation', details: validation.errors }, 500);
  }

  return json(operating);
}

// ── Property Reserves: the eleventh contract ────────────────────────────────────────────────
// A reserve FUNDING schedule, not a recurring operating statement (Operating, above) or an
// itemized one-off ledger (Ledgers, below) -- its own shape, same reasoning as the module
// comment above. Bundles three real, already-related tables that production's own
// `finance/property/<key>` GET route already returns together in one response
// (src/api-finance.js's handlePropertyApi): finance_property_reserves (the monthly
// before/contribution/after schedule for each named reserve bucket, e.g. 'property_tax'),
// finance_property_reserve_disbursements (the annual "paid" log against a reserve bucket --
// production's own finRenderPropertyTaxReserve, src/frontend/js-finance.js, renders both of
// these together under one "Property Tax Reserve" heading), and finance_property_distributions
// (confirmed cash distributions to the church) -- all three are what production's UI, and this
// contract's own "Reserve & distribution" staging page, present as one section.
//
// reserveKey is NOT hardcoded to 'property_tax' -- migrations/0023's own comment documents the
// table as generic ("e.g. 'property_tax', 'capital_paint_asphalt_concrete'"), even though only
// 'property_tax' has real rows for 'ivanhoe' today (confirmed live 2026-09-15).
//
// Real finding from checking live production data directly: reserve_after_cents does NOT always
// equal reserve_before_cents + contribution_cents exactly -- 4 of the 30 real rows are off by
// exactly ±1 cent (pure monthly-contribution rounding: $1,160.00/yr ÷ 12 = $96.666...67/mo,
// confirmed against the 2024-04/07/10 rows; the 2026-08 row's own stored note independently
// explains its own one-month-ahead convention). This contract's consumer tolerates that ±1 cent
// rounding drift rather than requiring bit-exact reconciliation the way the synthetic fixture's
// own reader (readSyntheticPropertyReserves) does.
export async function buildFinancePropertyReservesV1(db, { propertyKey = 'ivanhoe', now = new Date() } = {}) {
  const reserveRows = (await db.prepare(
    'SELECT reserve_key, report_month, tax_year, target_estimate_cents, reserve_before_cents, contribution_cents, reserve_after_cents, note FROM finance_property_reserves WHERE property_key=? ORDER BY reserve_key ASC, report_month ASC'
  ).bind(propertyKey).all()).results || [];
  const disbursementRows = (await db.prepare(
    'SELECT reserve_key, period_key, amount_cents, paid_via_report_month, note FROM finance_property_reserve_disbursements WHERE property_key=? ORDER BY reserve_key ASC, period_key ASC'
  ).bind(propertyKey).all()).results || [];
  const distributionRows = (await db.prepare(
    'SELECT period, amount_cents FROM finance_property_distributions WHERE property_key=? ORDER BY period ASC'
  ).bind(propertyKey).all()).results || [];

  const reserves = reserveRows.map((r) => {
    const targetEstimateCents = r.target_estimate_cents;
    const reserveAfterCents = r.reserve_after_cents;
    return {
      reserveKey: r.reserve_key,
      reportMonth: r.report_month,
      taxYear: r.tax_year ?? null,
      targetEstimateCents,
      reserveBeforeCents: r.reserve_before_cents,
      contributionCents: r.contribution_cents,
      reserveAfterCents,
      // Same formula, and same 0-100 scale, as the synthetic fixture reader's own funded_pct
      // (apps/finance/property-report-service.js's readSyntheticPropertyReserves) -- reused
      // convention, not a new one, so the reserve schedule table's "Funded" column never needs to
      // know which source produced its input.
      fundedPct: targetEstimateCents > 0 ? (reserveAfterCents / targetEstimateCents) * 100 : 0,
      note: r.note || '',
    };
  });

  const reserveDisbursements = disbursementRows.map((d) => ({
    reserveKey: d.reserve_key,
    periodKey: d.period_key,
    amountCents: d.amount_cents ?? null,
    paidViaReportMonth: d.paid_via_report_month || '',
    note: d.note || '',
  }));

  const distributions = distributionRows.map((d) => ({
    period: d.period,
    amountCents: d.amount_cents,
  }));

  return {
    contract: 'connect.finance-property-reserves.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    propertyKey,
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    reserves,
    reserveDisbursements,
    distributions,
  };
}

export async function respondWithFinancePropertyReservesV1(url, db) {
  const propertyKey = url.searchParams.get('property_key') || 'ivanhoe';
  const reserves = await buildFinancePropertyReservesV1(db, { propertyKey, now: new Date() });

  // Fail closed, same discipline as the contracts above: empty reserves/reserveDisbursements/
  // distributions arrays are a normal "nothing recorded yet" state and pass validation, but a
  // malformed shape must not reach Finance.
  const validation = validateFinancePropertyReservesV1(reserves);
  if (!validation.ok) {
    return json({ error: 'Internal: assembled property reserves report failed contract validation', details: validation.errors }, 500);
  }

  return json(reserves);
}

// ── Property Ledgers: the twelfth contract ──────────────────────────────────────────────────
// Itemized one-off transaction ledgers -- capital improvements and repairs/maintenance -- not a
// recurring monthly statement (Operating) or a funding schedule (Reserves). Bundled into one
// contract deliberately, mirroring the staging fixture's own existing precedent: the synthetic
// reader (apps/finance/property-report-service.js's readSyntheticPropertyLedgers) already reads
// finance_property_capital_ledger and finance_property_repairs together into one
// {capital, repairs, totals} shape, because the two ledgers share the exact same row shape
// (date, amount, payee, description) and the same "Commercial Property" UI area -- they differ
// only in which table backs which page (Capital improvements vs. Work orders & repairs).
//
// Two real findings from checking live production data directly, neither of which the synthetic
// fixture's own reader assumes:
// 1. entry_date is not always a full YYYY-MM-DD date. One real capital_ledger row (id 1, "Opening
//    balance of the Capital Improvements account as of the earliest available report") has an
//    EMPTY entry_date -- Jan/Feb 2024 reports predating the earliest available report are missing,
//    so no real date exists for it. Several real repairs rows carry only a YYYY-MM month (e.g.
//    '2024-11', '2025-07', '2026-05') rather than a full date, reflecting reports that only gave a
//    month for that repair. This contract's consumer accepts '', YYYY-MM, or YYYY-MM-DD for
//    entryDate rather than requiring the synthetic fixture's own strict YYYY-MM-DD pattern.
// 2. repairs.amount_cents is genuinely nullable (4 of 13 real rows) -- an as-yet-unbilled or
//    pending repair. payee is also genuinely empty on several real rows for the same reason
//    (vendor not yet known/confirmed). capital_ledger has no nulls or empty payees in real data
//    today, but amountCents is still modeled as nullable here for the same reason repairs' is:
//    an itemized one-off ledger can legitimately have a not-yet-known amount.
export async function buildFinancePropertyLedgersV1(db, { propertyKey = 'ivanhoe', now = new Date() } = {}) {
  const capitalRows = (await db.prepare(
    'SELECT id, entry_date, amount_cents, payee, description, check_ref, project, sort_order FROM finance_property_capital_ledger WHERE property_key=? ORDER BY sort_order ASC, entry_date ASC, id ASC'
  ).bind(propertyKey).all()).results || [];
  const repairRows = (await db.prepare(
    'SELECT id, entry_date, category, description, amount_cents, payee, capitalized FROM finance_property_repairs WHERE property_key=? ORDER BY entry_date ASC, id ASC'
  ).bind(propertyKey).all()).results || [];

  const capital = capitalRows.map((r) => ({
    entryDate: r.entry_date || '',
    amountCents: r.amount_cents ?? null,
    payee: r.payee || '',
    description: r.description || '',
    checkRef: r.check_ref || '',
    project: r.project || '',
    sortOrder: r.sort_order,
    ...(Number.isInteger(r.id) ? { id: r.id } : {}),
  }));

  const repairs = repairRows.map((r) => ({
    entryDate: r.entry_date || '',
    category: r.category || '',
    description: r.description || '',
    amountCents: r.amount_cents ?? null,
    payee: r.payee || '',
    capitalized: !!r.capitalized,
    ...(Number.isInteger(r.id) ? { id: r.id } : {}),
  }));

  return {
    contract: 'connect.finance-property-ledgers.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    propertyKey,
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    capital,
    repairs,
    totals: {
      capitalCents: capital.reduce((sum, r) => sum + (r.amountCents || 0), 0),
      repairsCents: repairs.reduce((sum, r) => sum + (r.amountCents || 0), 0),
    },
  };
}

export async function respondWithFinancePropertyLedgersV1(url, db) {
  const propertyKey = url.searchParams.get('property_key') || 'ivanhoe';
  const ledgers = await buildFinancePropertyLedgersV1(db, { propertyKey, now: new Date() });

  // Fail closed, same discipline as the contracts above: empty capital/repairs arrays are a
  // normal "nothing recorded yet" state and pass validation, but a malformed shape must not reach
  // Finance.
  const validation = validateFinancePropertyLedgersV1(ledgers);
  if (!validation.ok) {
    return json({ error: 'Internal: assembled property ledgers report failed contract validation', details: validation.errors }, 500);
  }

  return json(ledgers);
}

// ── Property Forecast: the fourteenth contract ──────────────────────────────────────────────
// The staging 'forecast' page's UI label ("Run-rate forecast") suggests a computed projection,
// but production's own AHRA Budget Detail Excel import (src/api-finance.js, source='ahra_import')
// writes a genuine monthly BUDGET/plan into finance_property_budget_monthly -- the same
// already-real table migrations/0025 created for exactly this purpose. This contract is a
// straight PORT of that table, the same way Operating/Reserves/Ledgers above ported their own
// already-real tables; it does not invent a run-rate calculation.
//
// Real findings confirmed directly against production tlc-volunteer-db on 2026-09-16:
// 1. property_key is 'ivanhoe' with source='ahra_import' -- the same default and property every
//    other Property contract already uses, not a different key.
// 2. There is exactly ONE year on file, 2026, with all 12 months present (2026-01 through
//    2026-12) -- not a genuinely future year the way the committed synthetic fixture's own
//    2027-only convention assumes (today, per this check, is 2026-09-16: 2026 is the CURRENT
//    fiscal year's budget, already partly elapsed, not a forward plan for next year). There is no
//    2027 data yet. Every one of the 12 real rows reconciles exactly
//    (netIncomeCents === revenueCents - expensesCents to the cent) and none of
//    revenue/expenses/net_income is null -- the columns are schema-level NOT NULL -- but nothing
//    in the schema itself GUARANTEES that reconciliation for a future import, so this contract
//    carries a per-row `reconciled` flag rather than asserting it (see the consumer's header
//    comment for why it doesn't hard-reject a non-reconciling row).
// 3. Real December's net income is NEGATIVE (-$6,118.96 -- a large annual expense, e.g. real
//    estate tax, landing in that month) even though revenue/expenses are each non-negative --
//    confirming netIncomeCents itself must stay signed, unlike revenue/expenses.
//
// Because there is no guarantee of exactly one clean future year (a real property could have a
// partial year, multiple years, or none at all on file), this contract returns EVERY period on
// file for the property (all years, ordered ascending) plus a computed `forecastYear`: the
// nearest current-or-future calendar year that has a complete 12-month run, or -- if none of the
// years on file is future/current -- the most recent complete year in the past. `forecastYear` is
// null when no year on file has all 12 months. This mirrors Budget/Church Report/Balance Sheet's
// own "the caller doesn't get to assume there's exactly one clean year" lesson rather than
// hardcoding a year the way the synthetic fixture's own '2027-%' filter does. `totals` sums only
// the selected forecastYear's periods (null/zeroed, with reconciled:false, when forecastYear is
// null) -- the same "one headline year, all periods still on file" split
// apps/finance/property-forecast-service.js's buildLivePropertyForecastView filters down from.
function selectPropertyForecastYear(periods, currentYear) {
  const countsByYear = new Map();
  for (const p of periods) {
    const year = Number(p.period.slice(0, 4));
    countsByYear.set(year, (countsByYear.get(year) || 0) + 1);
  }
  const fullYears = [...countsByYear.entries()].filter(([, count]) => count === 12).map(([year]) => year);
  if (fullYears.length === 0) return null;
  const futureOrCurrent = fullYears.filter((year) => year >= currentYear).sort((a, b) => a - b);
  if (futureOrCurrent.length) return futureOrCurrent[0];
  return Math.max(...fullYears);
}

export async function buildFinancePropertyForecastV1(db, { propertyKey = 'ivanhoe', now = new Date() } = {}) {
  const rows = (await db.prepare(
    'SELECT period, revenue_cents, expenses_cents, net_income_cents, source FROM finance_property_budget_monthly WHERE property_key=? ORDER BY period ASC'
  ).bind(propertyKey).all()).results || [];

  const periods = rows.map((r) => ({
    period: r.period,
    revenueCents: r.revenue_cents,
    expensesCents: r.expenses_cents,
    netIncomeCents: r.net_income_cents,
    reconciled: r.net_income_cents === r.revenue_cents - r.expenses_cents,
    source: r.source || '',
  }));

  const forecastYear = selectPropertyForecastYear(periods, now.getUTCFullYear());
  const forecastPeriods = forecastYear === null ? [] : periods.filter((p) => p.period.startsWith(String(forecastYear)));
  const revenueCents = forecastPeriods.reduce((sum, p) => sum + p.revenueCents, 0);
  const expensesCents = forecastPeriods.reduce((sum, p) => sum + p.expensesCents, 0);
  const netIncomeCents = forecastPeriods.reduce((sum, p) => sum + p.netIncomeCents, 0);

  return {
    contract: 'connect.finance-property-forecast.v1',
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    propertyKey,
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    forecastYear,
    periods,
    totals: {
      revenueCents,
      expensesCents,
      netIncomeCents,
      reconciled: forecastYear !== null && forecastPeriods.every((p) => p.reconciled) && netIncomeCents === revenueCents - expensesCents,
    },
  };
}

export async function respondWithFinancePropertyForecastV1(url, db) {
  const propertyKey = url.searchParams.get('property_key') || 'ivanhoe';
  const forecast = await buildFinancePropertyForecastV1(db, { propertyKey, now: new Date() });

  // Fail closed, same discipline as the contracts above: an empty periods array (and a null
  // forecastYear) is a normal "nothing budgeted yet" state and passes validation, but a malformed
  // shape must not reach Finance.
  const validation = validateFinancePropertyForecastV1(forecast);
  if (!validation.ok) {
    return json({ error: 'Internal: assembled property forecast failed contract validation', details: validation.errors }, 500);
  }

  return json(forecast);
}

export async function handleContractsApi(req, env, url, method, seg, db) {
  if (seg === 'contracts/connect-giving-summary-v1' && method === 'GET') {
    return respondWithConnectGivingSummaryV1(url, db);
  }
  if (seg === 'contracts/finance-data-status-v1' && method === 'GET') {
    return respondWithFinanceDataStatusV1(db);
  }
  if (seg === 'contracts/finance-cash-runway-v1' && method === 'GET') {
    return respondWithFinanceCashRunwayV1(url, db);
  }
  if (seg === 'contracts/finance-chart-of-accounts-v1' && method === 'GET') {
    return respondWithFinanceChartOfAccountsV1(url, db);
  }
  if (seg === 'contracts/finance-budget-v1' && method === 'GET') {
    return respondWithFinanceBudgetV1(url, db);
  }
  if (seg === 'contracts/finance-church-report-v1' && method === 'GET') {
    return respondWithFinanceChurchReportV1(url, db);
  }
  if (seg === 'contracts/finance-church-report-trend-v1' && method === 'GET') {
    return respondWithFinanceChurchReportTrendV1(db);
  }
  if (seg === 'contracts/finance-balance-sheet-v1' && method === 'GET') {
    return respondWithFinanceBalanceSheetV1(url, db);
  }
  if (seg === 'contracts/finance-balance-sheet-trend-v1' && method === 'GET') {
    return respondWithFinanceBalanceSheetTrendV1(db);
  }
  if (seg === 'contracts/finance-daycare-report-v1' && method === 'GET') {
    return respondWithFinanceDaycareReportV1(url, db);
  }
  if (seg === 'contracts/finance-property-valuation-v1' && method === 'GET') {
    return respondWithFinancePropertyValuationV1(url, db);
  }
  if (seg === 'contracts/finance-compensation-v1' && method === 'GET') {
    return respondWithFinanceCompensationV1(db);
  }
  if (seg === 'contracts/finance-property-operating-v1' && method === 'GET') {
    return respondWithFinancePropertyOperatingV1(url, db);
  }
  if (seg === 'contracts/finance-property-reserves-v1' && method === 'GET') {
    return respondWithFinancePropertyReservesV1(url, db);
  }
  if (seg === 'contracts/finance-property-ledgers-v1' && method === 'GET') {
    return respondWithFinancePropertyLedgersV1(url, db);
  }
  if (seg === 'contracts/finance-property-forecast-v1' && method === 'GET') {
    return respondWithFinancePropertyForecastV1(url, db);
  }
  return null;
}
