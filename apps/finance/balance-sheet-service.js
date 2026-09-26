import { runBudgetedReadBatch } from './query-budget.js';
import { fetchLiveFinanceBalanceSheet, defaultLiveBalanceSheetFiscalYear } from './finance-balance-sheet-client.js';
import { fetchLiveFinanceBalanceSheetTrend } from './finance-balance-sheet-trend-client.js';

const CLASSIFICATIONS = new Set(['Assets', 'Liabilities', 'Equity']);

export async function readSyntheticBalanceSheet(db) {
  const sql = "SELECT fiscal_year, as_of_date, classification, account_name, own_balance_cents FROM finance_church_balances WHERE source='synthetic_fixture' AND fiscal_year=(SELECT MAX(fiscal_year) FROM finance_church_balances WHERE source='synthetic_fixture') ORDER BY classification, account_name";
  const { results } = await runBudgetedReadBatch(db, 'balanceSheet', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length === 0 || rows.some((row) =>
    !Number.isInteger(row.fiscal_year)
    || typeof row.as_of_date !== 'string'
    || !CLASSIFICATIONS.has(row.classification)
    || typeof row.account_name !== 'string'
    || !Number.isInteger(row.own_balance_cents)
  )) throw new Error('Synthetic Balance Sheet rows invalid');
  return rows.map((row) => ({ ...row }));
}

export async function readSyntheticBalanceTrends(db) {
  const sql = "SELECT fiscal_year, MAX(as_of_date) AS as_of_date, SUM(CASE WHEN classification='Assets' THEN own_balance_cents ELSE 0 END) AS assets_cents, SUM(CASE WHEN classification='Liabilities' THEN own_balance_cents ELSE 0 END) AS liabilities_cents, SUM(CASE WHEN classification='Equity' THEN own_balance_cents ELSE 0 END) AS equity_cents FROM finance_church_balances WHERE source='synthetic_fixture' GROUP BY fiscal_year ORDER BY fiscal_year";
  const { results } = await runBudgetedReadBatch(db, 'balanceTrends', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length < 2 || rows.some((row) =>
    !Number.isInteger(row.fiscal_year)
    || typeof row.as_of_date !== 'string'
    || !Number.isInteger(row.assets_cents)
    || !Number.isInteger(row.liabilities_cents)
    || !Number.isInteger(row.equity_cents)
    || row.assets_cents - row.liabilities_cents - row.equity_cents !== 0
  )) throw new Error('Synthetic Balance Sheet trend rows invalid');
  return rows.map((row) => ({ ...row, net_assets_cents: row.assets_cents - row.liabilities_cents }));
}

// Tries the real connect.finance-balance-sheet.v1 endpoint for the current fiscal year; falls
// back to the existing synthetic fixture whenever the live call isn't configured yet or fails for
// any reason -- same never-throws, always-labeled pattern as church-report-service.js's
// resolveChurchReport. `db` here is Finance's own FINANCE_DB, used only for the synthetic
// fallback path. Only the 'balance' section's 'position'/'account-detail' pages use this; the
// 'multi-year' page has its own live resolver, resolveBalanceSheetTrend, right below.
//
// `fiscalYear` is the page's chosen year (parseBalanceSelection below); it defaults to the current
// year, which is what Financial Health and the Board packet always ask for. The synthetic fixture
// has only one year, so a fallback always shows that year whatever was requested.
export async function resolveBalanceSheet(env, db, { fiscalYear = defaultLiveBalanceSheetFiscalYear() } = {}) {
  const result = await fetchLiveFinanceBalanceSheet(env, fiscalYear);
  if (result.ok) {
    return {
      source: 'live',
      fiscalYear: result.balanceSheet.fiscalYear,
      asOfDate: result.balanceSheet.asOfDate,
      accounts: result.balanceSheet.accounts,
      totals: result.balanceSheet.totals,
      equityReclass: result.balanceSheet.equityReclass,
    };
  }
  const rows = await readSyntheticBalanceSheet(db);
  return { source: 'synthetic-fallback', fallbackReason: result.reason, rows };
}

// The year before the chosen one, for Position's "this year vs. last year" comparison -- the same
// second single-year read Connect's legacy tab makes (`finance/church/balances?year=` for
// year - 1). Live-only and never throws: with no live prior year the comparison says so instead
// of comparing against the synthetic fixture.
export async function resolveBalanceSheetPriorYear(env, fiscalYear) {
  const result = await fetchLiveFinanceBalanceSheet(env, fiscalYear - 1);
  if (!result.ok) return { ok: false, fiscalYear: fiscalYear - 1, reason: result.reason };
  return { ok: true, fiscalYear: result.balanceSheet.fiscalYear, accounts: result.balanceSheet.accounts };
}

// Reads the Balance Sheet pages' GET controls: `fiscal_year` (the snapshot year; defaults to the
// current year like Connect's own tab), `from_year`/`to_year` (the multi-year window, both or
// neither, at most 20 years like Connect's range picker), and `zero=show` (account detail hides
// zero-balance lines by default, like Connect). An unusable value falls back to the default and
// is reported, never silently reinterpreted.
export const BALANCE_RANGE_MAX_YEARS = 20;
export function parseBalanceSelection(searchParams, now = new Date()) {
  const params = searchParams || new URLSearchParams();
  const yearOf = (value) => (typeof value === 'string' && /^\d{4}$/.test(value) && Number(value) >= 2000 && Number(value) <= 2100 ? Number(value) : null);
  const defaultYear = defaultLiveBalanceSheetFiscalYear(now);
  const rawYear = params.get('fiscal_year');
  const fiscalYear = yearOf(rawYear) ?? defaultYear;
  const rawFrom = params.get('from_year');
  const rawTo = params.get('to_year');
  let fromYear = null, toYear = null, rangeError = null;
  if ((rawFrom !== null && rawFrom !== '') || (rawTo !== null && rawTo !== '')) {
    const from = yearOf(rawFrom), to = yearOf(rawTo);
    if (from === null || to === null || from > to) rangeError = 'Enter a valid From/To year range.';
    else if (to - from + 1 > BALANCE_RANGE_MAX_YEARS) rangeError = `Please request ${BALANCE_RANGE_MAX_YEARS} years or fewer at a time.`;
    else { fromYear = from; toYear = to; }
  }
  return {
    fiscalYear,
    yearError: rawYear !== null && rawYear !== '' && yearOf(rawYear) === null ? 'Enter a valid year.' : null,
    fromYear,
    toYear,
    rangeError,
    hideZero: params.get('zero') !== 'show',
  };
}

// Tries the real connect.finance-balance-sheet-trend.v1 endpoint (every fiscal year on file, no
// year parameter); falls back to the existing synthetic trend fixture whenever the live call isn't
// configured yet or fails for any reason -- same never-throws, always-labeled pattern as
// resolveBalanceSheet above and church-report-service.js's resolveChurchReport. `db` here is
// Finance's own FINANCE_DB, used only for the synthetic fallback path.
//
// The live payload's `years` (camelCase fiscalYear/asOfDate/assetsCents/liabilitiesCents/
// equityCents/netAssetsCents) is remapped to the SAME snake_case row shape
// readSyntheticBalanceTrends already returns (fiscal_year/as_of_date/assets_cents/
// liabilities_cents/equity_cents/net_assets_cents) so renderBalanceTrendRows in balance-pages.js
// needs exactly one rendering path regardless of source -- only the badge/fallback note above the
// table differs, the same as the 'position'/'account-detail' pages already do. net_assets_cents
// here is the contract's own netAssetsCents (total equity after the Designated-Funds-as-Equity
// reclassification), NOT a locally recomputed assets-minus-liabilities figure -- see
// finance-balance-sheet-trend-consumer.js's header comment for why.
//
// When the producer carries the parity extension (current/fixed/other assets, cash, the
// Donor-Restricted split, net income, and the balance sheet vs. income statement tie-out), the
// result also exposes it as `detail` -- the contract's own camelCase years plus pnlTieOut and
// cashAccountCode -- for the charts and tables Connect's legacy tab shows. `detail` is null for an
// older producer or the synthetic fixture, and those sections are then simply left out.
export async function resolveBalanceSheetTrend(env, db, { fromYear = null, toYear = null } = {}) {
  const result = await fetchLiveFinanceBalanceSheetTrend(env, { fromYear, toYear });
  if (result.ok) {
    return {
      source: 'live',
      rows: result.trend.years.map((y) => ({
        fiscal_year: y.fiscalYear,
        as_of_date: y.asOfDate,
        assets_cents: y.assetsCents,
        liabilities_cents: y.liabilitiesCents,
        equity_cents: y.equityCents,
        net_assets_cents: y.netAssetsCents,
      })),
      detail: result.trend.pnlTieOut ? {
        years: result.trend.years,
        pnlTieOut: result.trend.pnlTieOut,
        cashAccountCode: result.trend.cashAccountCode,
      } : null,
    };
  }
  const rows = await readSyntheticBalanceTrends(db);
  return { source: 'synthetic-fallback', fallbackReason: result.reason, rows };
}

// Live view builder -- a genuinely different shape from the synthetic fixture's own flat
// classification/account_name/own_balance_cents rows (readSyntheticBalanceSheet): real accounts
// also carry categoryPath/depth/hasChildren, and real data adds a Donor-Restricted/Without-Donor-
// Restriction breakdown (equityReclass) the synthetic fixture has no equivalent of at all. See
// finance-balance-sheet-consumer.js's header comment for why totals.equityCents and
// equityReclass.totalEquityCents are guaranteed equal (both come from the same already-
// reclassified rows production's own route computes them from).
export function buildLiveBalanceSheetView(accounts, fiscalYear, asOfDate, totals, equityReclass) {
  if (!Number.isInteger(fiscalYear)) throw new Error('Live Balance Sheet requires a fiscal year');
  const assets = accounts.filter((a) => a.classification === 'Assets');
  const liabilities = accounts.filter((a) => a.classification === 'Liabilities');
  const equity = accounts.filter((a) => a.classification === 'Equity');
  return {
    fiscalYear,
    asOfDate,
    assets,
    liabilities,
    equity,
    totals: {
      assetsCents: totals.assetsCents,
      liabilitiesCents: totals.liabilitiesCents,
      equityCents: totals.equityCents,
      equationDifferenceCents: totals.balancedCents,
    },
    equityReclass,
  };
}

export function buildBalanceSheetView(rows) {
  const byClassification = (classification) => rows.filter((row) => row.classification === classification);
  const sum = (items) => items.reduce((total, row) => total + row.own_balance_cents, 0);
  const assets = byClassification('Assets');
  const liabilities = byClassification('Liabilities');
  const equity = byClassification('Equity');
  const assetsCents = sum(assets);
  const liabilitiesCents = sum(liabilities);
  const equityCents = sum(equity);
  return {
    fiscalYear: rows[0].fiscal_year,
    asOfDate: rows[0].as_of_date,
    assets,
    liabilities,
    equity,
    totals: {
      assetsCents,
      liabilitiesCents,
      equityCents,
      equationDifferenceCents: assetsCents - liabilitiesCents - equityCents,
    },
  };
}

// ── Account tree (Full account detail, Asset composition, this year vs. last year) ─────────────
// A direct port of Connect's finBuildBalanceTreeFromFlatRows (src/frontend/js-finance.js): each
// account hangs under its nearest existing ancestor path, and a node's total is its own balance
// plus every descendant's -- own balances are never subtotals (see the contract's header comment),
// so the root totals still sum to the contract's classification totals.
export function buildBalanceTree(accounts) {
  const nodeByPath = new Map();
  const roots = [];
  for (const account of accounts || []) {
    nodeByPath.set(account.categoryPath, {
      path: account.categoryPath, label: account.accountName, classification: account.classification,
      depth: account.depth, ownBalanceCents: account.ownBalanceCents || 0, totalBalanceCents: 0, children: [],
    });
  }
  for (const account of accounts || []) {
    const node = nodeByPath.get(account.categoryPath);
    const segments = account.categoryPath.split(':');
    let parent = null;
    for (let i = segments.length - 1; i > 0; i--) {
      const candidate = nodeByPath.get(segments.slice(0, i).join(':'));
      if (candidate) { parent = candidate; break; }
    }
    (parent ? parent.children : roots).push(node);
  }
  const computeTotals = (node) => {
    node.totalBalanceCents = node.children.reduce((total, child) => total + computeTotals(child), node.ownBalanceCents);
    return node.totalBalanceCents;
  };
  roots.forEach(computeTotals);
  return roots;
}

// Connect's "Hide zero-balance lines" (on by default): drops each leaf whose total is exactly $0,
// then any group left with nothing under it, and recomputes totals on the pruned copy. One
// deliberate difference from Connect's finBalanceFilterHiddenWalk: a group whose OWN balance is
// nonzero is kept even when all of its children were hidden, so real money (a checking account
// with a $0 "cash on hand" sub-line, for instance) never disappears from the detail table.
export function filterZeroBalanceTree(nodes, { hideZero = true } = {}) {
  const walk = (list) => {
    const out = [];
    for (const node of list || []) {
      if (!node.children.length) {
        if (hideZero && node.totalBalanceCents === 0) continue;
        out.push({ ...node, children: [] });
        continue;
      }
      const kids = walk(node.children);
      if (!kids.length && node.ownBalanceCents === 0) continue;
      out.push({ ...node, children: kids });
    }
    return out;
  };
  const recompute = (node) => {
    node.totalBalanceCents = node.children.reduce((total, child) => total + recompute(child), node.ownBalanceCents);
    return node.totalBalanceCents;
  };
  const pruned = walk(nodes);
  pruned.forEach(recompute);
  return pruned;
}

export function flattenBalanceTree(nodes, out = []) {
  for (const node of nodes || []) {
    out.push(node);
    flattenBalanceTree(node.children, out);
  }
  return out;
}

// Path -> rolled-up total, so a group compares like-for-like against its own prior-year rollup
// (Connect's finBalanceTotalsByPath).
export function balanceTotalsByPath(accounts) {
  return new Map(flattenBalanceTree(buildBalanceTree(accounts)).map((node) => [node.path, node.totalBalanceCents]));
}

// Connect's Asset Composition pie (finPieItemsFromTree(tree, 'Assets', 'totalBalanceCents')): the
// depth-0 Assets node's direct groups with a positive total, largest first, each with its share of
// the shown total.
export function buildAssetComposition(tree) {
  const root = tree.find((node) => node.classification === 'Assets' && node.depth === 0);
  if (!root) return [];
  const groups = (root.children.length ? root.children : [root])
    .filter((node) => node.totalBalanceCents > 0)
    .sort((a, b) => b.totalBalanceCents - a.totalBalanceCents);
  const shownCents = groups.reduce((total, node) => total + node.totalBalanceCents, 0);
  return groups.map((node) => ({ label: node.label, cents: node.totalBalanceCents, sharePct: shownCents ? node.totalBalanceCents / shownCents * 100 : 0 }));
}
