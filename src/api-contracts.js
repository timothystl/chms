// ── Versioned cross-product contract endpoints ──────────────────────────────
// First real slice of Finance separation: Connect actually producing the
// connect.giving-summary.v1 aggregate it has only ever emitted to a committed
// synthetic fixture in Finance staging. This file has one job — assemble that
// exact contract shape from real Giving data — so it stays reviewable
// independent of the much larger People/Giving/Reports handlers.
import { json } from './auth.js';
import { validateConnectGivingSummaryV1 } from '../apps/finance/connect-giving-consumer.js';
import { validateFinanceDataStatusV1 } from '../apps/finance/finance-data-status-consumer.js';
import { validateFinanceChartOfAccountsV1 } from '../apps/finance/finance-chart-of-accounts-consumer.js';
import { validateFinanceBudgetV1 } from '../apps/finance/finance-budget-consumer.js';
import { validateFinanceChurchReportV1 } from '../apps/finance/finance-church-report-consumer.js';
import { validateFinanceBalanceSheetV1 } from '../apps/finance/finance-balance-sheet-consumer.js';
import { validateFinanceDaycareReportV1 } from '../apps/finance/finance-daycare-consumer.js';
import { validateFinancePropertyValuationV1 } from '../apps/finance/finance-property-valuation-consumer.js';
import {
  readPlanningBoardCategories, readPurposeTags, REVENUE_STREAMS, BOARD_EXPENSE_CATEGORIES,
  resolveChurchYearPrecedence, computeYearSummary,
  applyDesignatedFundsAsEquity, computeBalanceSummary, computeEquityReclassification,
  computeMdoUtilityInsuranceAllocation,
} from './api-finance.js';

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

// Third real slice of Finance separation: the Chart of Accounts section's account tree,
// board-category assignment, and purpose tags have stood in on synthetic fixture data since the
// staging rewrite began (see apps/finance/README.md's alpha.28/alpha.35 notes). This assembles the
// real thing from three existing production sources — the church ledger's own account inventory
// (finance_church_entries) plus the two finance_settings blobs the Chart of Accounts page itself
// already reads and writes (readPlanningBoardCategories, readPurposeTags, both hoisted to module
// scope in api-finance.js for this reuse). No dollar figure crosses this contract at all — only
// account names, QuickBooks-derived category paths, and Finance's own categorization of them —
// which is why dataClassification is 'structural' rather than 'aggregate' (contrast the Giving and
// Data-status contracts above, which do aggregate money).
//
// An account with no board-category assignment yet (Chart of Accounts has historically been
// filled in gradually, one account at a time — see api-finance.js's own comment on that page) is
// reported as boardCategoryKey 'unassigned' / boardCategoryLabel 'Unassigned' rather than omitted
// or guessed at; reconciliation.unassignedCount makes that count visible to any caller rather than
// silently folding it into a category it was never actually given.
const REVENUE_STREAM_DEFAULT_LABELS = { donor: 'Donor', earned: 'Earned', passive: 'Passive', restricted: 'Restricted' };

function resolveAccountCategory(classification, categoryPath, boardCategories) {
  const isIncome = classification === 'Income';
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

// Pure apart from the two bounded reads: one SELECT over finance_church_entries (each leaf's most
// recently synced/imported classification, path, name, depth -- ROW_NUMBER() over category_path
// picks the latest row so a renamed or re-imported account never shows a stale account_name) plus
// the two existing finance_settings reads Chart of Accounts already performs. Scoped to Income and
// Expenses only, matching both the existing Chart of Accounts page and apps/finance's synthetic
// fixture -- balance-sheet accounts (Assets/Liabilities/Equity) carry no board-category concept in
// production today and are out of scope for this contract.
export async function buildFinanceChartOfAccountsV1(db, { now = new Date() } = {}) {
  const { results } = (await db.prepare(
    `SELECT classification, category_path, account_name, depth, has_children FROM (
       SELECT classification, category_path, account_name, depth, has_children,
              ROW_NUMBER() OVER (
                PARTITION BY category_path
                ORDER BY synced_at DESC, fiscal_year DESC, period_month DESC, id DESC
              ) AS rn
         FROM finance_church_entries
        WHERE classification IN ('Income','Expenses')
     )
     WHERE rn = 1
     ORDER BY classification, category_path`
  ).all()) || {};
  const rows = results || [];

  const boardCategories = await readPlanningBoardCategories(db);
  const purposeTags = await readPurposeTags(db);
  const tagLabelById = new Map(purposeTags.tags.map((t) => [t.id, t.label]));

  let incomeCount = 0, expenseCount = 0, unassignedCount = 0;
  const accounts = rows.map((row) => {
    const category = resolveAccountCategory(row.classification, row.category_path, boardCategories);
    if (row.classification === 'Income') incomeCount++; else expenseCount++;
    if (category.key === 'unassigned') unassignedCount++;
    const rawTagId = purposeTags.categories[row.category_path];
    const hasTag = typeof rawTagId === 'string' && tagLabelById.has(rawTagId);
    return {
      classification: row.classification,
      categoryPath: row.category_path,
      accountName: row.account_name,
      depth: row.depth,
      hasChildren: Boolean(row.has_children),
      boardCategoryKey: category.key,
      boardCategoryLabel: category.label,
      purposeTagId: hasTag ? rawTagId : null,
      purposeTagLabel: hasTag ? tagLabelById.get(rawTagId) : null,
    };
  });

  return {
    contract: 'connect.finance-chart-of-accounts.v1',
    dataClassification: 'structural',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    accounts,
    reconciliation: {
      accountCount: accounts.length,
      incomeCount,
      expenseCount,
      unassignedCount,
    },
  };
}

export async function respondWithFinanceChartOfAccountsV1(db) {
  const chartOfAccounts = await buildFinanceChartOfAccountsV1(db, { now: new Date() });

  // Fail closed, same discipline as the two contracts above: this should never fire against real
  // data, and if it does, Finance must not see a malformed contract.
  const validation = validateFinanceChartOfAccountsV1(chartOfAccounts);
  if (!validation.ok) {
    return json({ error: 'Internal: assembled chart of accounts failed contract validation', details: validation.errors }, 500);
  }

  return json(chartOfAccounts);
}

// Fourth real slice of Finance separation: Budget. Unlike Chart of Accounts (structural-only,
// no dollar figure), production's Church Budget Planning is a real per-category, per-fiscal-year
// dollar plan (`finance_budget_plan` -- see src/api-finance.js's "Church Budget Planning" comment
// block for the full generate/override/commit workflow), so this contract carries real money and
// is 'aggregate', matching Giving and Data-status rather than Chart of Accounts.
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
// table Chart of Accounts already reads, scoped to one fiscal year and carrying the real
// actual/budget dollar figures Chart of Accounts deliberately excludes -- so this contract is
// 'aggregate' (real money crosses it), like Giving and Budget, rather than 'structural' like Chart
// of Accounts.
//
// Deliberately reuses resolveChurchYearPrecedence() and computeYearSummary() -- the exact
// functions production's own Church Report / Financial Health / Budget-planning pages already
// call (see src/api-finance.js's buildChurchThisYear) -- rather than re-deriving the winning
// source with a query of its own. That distinction is real, not stylistic: Chart of Accounts'
// producer picks each ACCOUNT's own latest row across all sources (ROW_NUMBER() PARTITION BY
// category_path), but Church Report must pick one source WHOLESALE per fiscal year the way
// production's precedence rule does. A direct 2026-09-14 check of production found FY2026 has
// both an 'import' source (98 rows, the most recent single-year upload) and an 'import_activity'
// source (126 rows, the multi-year upload) on file for the same year; CHURCH_SOURCE_PRIORITY picks
// 'import' wholesale for FY2026, so the 28 accounts present only in 'import_activity' correctly do
// not appear in this year's report at all. Reusing Chart of Accounts' per-account "latest row
// wins" query here would have silently included them and produced a different, wrong total than
// the page staff already look at today.
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
// 'Income'/'Expenses' the way Chart of Accounts deliberately scopes to. 'Cost of Goods Sold' is
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
// Modeled on Giving/Budget's real-money shape rather than Chart of Accounts' whole-tree/no-params
// shape: Church Report is naturally scoped to one fiscal year the way a budget plan is (there is no
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

// Sixth real slice of Finance separation: Balance Sheet. A structurally different report from
// Church Report's actual-vs-budget income statement -- point-in-time Assets/Liabilities/Equity
// account balances, one balance per account per fiscal year, read from the separate
// finance_church_balances table (migrations/0019_finance_church_balances.sql), never
// finance_church_entries. Real money crosses this contract, so it is 'aggregate' like Giving,
// Budget, and Church Report, not 'structural' like Chart of Accounts.
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
// Modeled on Church Report's single-fiscal-year shape (not a date range like Giving, not the
// whole-tree/no-params shape of Chart of Accounts): a Balance Sheet is naturally one point-in-time
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

// ── Property Valuation: the eighth contract, and the first sourced from a JSON settings blob ──
// rather than a dedicated relational table. `finance_property_<property_key>_meta` (table
// `finance_settings`) is a real, admin-maintained income-capitalization worksheet for the
// church's owned commercial property (3277 Ivanhoe) -- rent roll, itemized operating costs, and
// assumptions (vacancy rate, management fee %, cap rate) -- entered from AHRA's own valuation
// worksheet and updated by hand as new figures come in. Confirmed live against production on
// 2026-09-14: the stored `valuation.as_of_date` is 2026-08-12, newer than any date this
// repository's own static seed carries, so it has genuinely been edited since the original
// seedIvanhoePropertyValuationV3() ran -- this is not a frozen fixture. See
// apps/finance/finance-property-valuation-consumer.js's header comment for the full reasoning
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

export async function handleContractsApi(req, env, url, method, seg, db) {
  if (seg === 'contracts/connect-giving-summary-v1' && method === 'GET') {
    return respondWithConnectGivingSummaryV1(url, db);
  }
  if (seg === 'contracts/finance-data-status-v1' && method === 'GET') {
    return respondWithFinanceDataStatusV1(db);
  }
  if (seg === 'contracts/finance-chart-of-accounts-v1' && method === 'GET') {
    return respondWithFinanceChartOfAccountsV1(db);
  }
  if (seg === 'contracts/finance-budget-v1' && method === 'GET') {
    return respondWithFinanceBudgetV1(url, db);
  }
  if (seg === 'contracts/finance-church-report-v1' && method === 'GET') {
    return respondWithFinanceChurchReportV1(url, db);
  }
  if (seg === 'contracts/finance-balance-sheet-v1' && method === 'GET') {
    return respondWithFinanceBalanceSheetV1(url, db);
  }
  if (seg === 'contracts/finance-daycare-report-v1' && method === 'GET') {
    return respondWithFinanceDaycareReportV1(url, db);
  }
  if (seg === 'contracts/finance-property-valuation-v1' && method === 'GET') {
    return respondWithFinancePropertyValuationV1(url, db);
  }
  return null;
}
