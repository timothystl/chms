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
import { readPlanningBoardCategories, readPurposeTags, REVENUE_STREAMS, BOARD_EXPENSE_CATEGORIES } from './api-finance.js';

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
  return null;
}
