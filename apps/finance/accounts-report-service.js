import { runBudgetedReadBatch } from './query-budget.js';
import { fetchLiveFinanceChartOfAccounts } from './finance-chart-of-accounts-client.js';
import { CHART_REVENUE_CLASSIFICATIONS } from '../../contracts/validators/finance-chart-of-accounts-consumer.js';
import {
  BOARD_EXPENSE_ORDER, BOARD_REVENUE_ORDER, accountDisplayName, boardCategoryFor, boardLabelFor, normalizeBoardLayout,
} from './board-layout.js';
import { buildChurchAccountTree } from './compensation-projection.js';

const SYNTHETIC_CLASSIFICATIONS = new Set(['Income', 'Expenses']);
// Legacy FIN_CHURCH_CLASS_ORDER: revenue classes first, then the expense classes.
const CLASSIFICATION_ORDER = ['Income', 'Other Income', 'Cost of Goods Sold', 'Expenses', 'Other Expenses'];

export function isRevenueClassification(classification) {
  return CHART_REVENUE_CLASSIFICATIONS.has(classification);
}

export async function readSyntheticAccountsReport(db) {
  const sql = "SELECT DISTINCT e.classification, e.category_path, e.account_name, p.board_category_key, p.board_category_label, p.purpose_tag_id, p.purpose_tag_label FROM finance_church_entries e LEFT JOIN finance_account_presentation p ON p.category_path=e.category_path AND p.source='synthetic_fixture' WHERE e.source='synthetic_fixture' ORDER BY e.classification, e.category_path";
  const { results } = await runBudgetedReadBatch(db, 'accountsReport', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length === 0 || rows.some((row) =>
    !SYNTHETIC_CLASSIFICATIONS.has(row.classification)
    || typeof row.category_path !== 'string'
    || !row.category_path.startsWith(`${row.classification}:`)
    || typeof row.account_name !== 'string'
    || typeof row.board_category_key !== 'string'
    || !/^[a-z][a-z0-9_]*$/.test(row.board_category_key)
    || typeof row.board_category_label !== 'string'
    || row.board_category_label.trim() === ''
    || (row.purpose_tag_id !== null && (typeof row.purpose_tag_id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(row.purpose_tag_id)))
    || (row.purpose_tag_label !== null && (typeof row.purpose_tag_label !== 'string' || row.purpose_tag_label.trim() === ''))
    || ((row.purpose_tag_id === null) !== (row.purpose_tag_label === null))
  )) throw new Error('Synthetic Chart of Accounts rows invalid');
  return rows.map((row) => ({ ...row }));
}

function createHierarchyNode(label, path, depth) {
  return { label, path, depth, account: null, children: [], childIndex: new Map() };
}

// One root per classification present (Income and Expenses always), in legacy's order. A path
// normally starts with its own classification; a live QuickBooks sync names its sections
// "Revenue"/"Expenditures" instead, so a path that does not is placed whole under its
// classification rather than rejected.
export function buildAccountHierarchy(rows) {
  const present = new Set(rows.map((row) => row?.classification));
  const roots = new Map(CLASSIFICATION_ORDER.filter((c) => c === 'Income' || c === 'Expenses' || present.has(c))
    .map((classification) => [classification, createHierarchyNode(classification, classification, 0)]));
  for (const row of rows) {
    if (!CLASSIFICATION_ORDER.includes(row?.classification) || typeof row?.category_path !== 'string') {
      throw new Error('Synthetic account hierarchy path invalid');
    }
    const segments = row.category_path.split(':');
    if (segments.some((segment) => segment.trim() === '')) throw new Error('Synthetic account hierarchy path invalid');
    const offset = segments[0] === row.classification ? 1 : 0;
    let node = roots.get(row.classification);
    for (let index = offset; index < segments.length; index += 1) {
      const label = segments[index];
      if (!node.childIndex.has(label)) {
        const path = segments.slice(0, index + 1).join(':');
        const child = createHierarchyNode(label, path, index + 1 - offset);
        node.childIndex.set(label, child);
        node.children.push(child);
      }
      node = node.childIndex.get(label);
    }
    if (node.account !== null) throw new Error('Synthetic account hierarchy duplicate leaf');
    node.account = {
      name: row.account_name,
      boardCategoryLabel: row.board_category_label,
      purposeTagLabel: row.purpose_tag_label,
    };
  }
  const stripIndex = (node) => ({
    label: node.label,
    path: node.path,
    depth: node.depth,
    account: node.account,
    children: node.children.map(stripIndex),
  });
  return [...roots.values()].map(stripIndex);
}

// Maps one connect.finance-chart-of-accounts.v1 account (camelCase, as the consumer returns it)
// onto the exact row shape readSyntheticAccountsReport produces (snake_case, matching
// finance_church_entries/finance_account_presentation column names) -- so buildAccountHierarchy
// and buildAccountsReportView above work unchanged on either source, and the two never need a
// second parallel set of view builders. The year's figures and display name ride along; a
// synthetic row simply has none.
function liveAccountToRow(account) {
  return {
    classification: account.classification,
    category_path: account.categoryPath,
    account_name: account.accountName,
    display_name: account.displayName,
    actual_cents: account.actualCents,
    budget_cents: account.budgetCents,
    board_category_key: account.boardCategoryKey,
    board_category_label: account.boardCategoryLabel,
    purpose_tag_id: account.purposeTagId,
    purpose_tag_label: account.purposeTagLabel,
  };
}

// Tries the real connect.finance-chart-of-accounts.v1 endpoint for `fiscalYear`; falls back to the
// existing synthetic fixture whenever the live call isn't configured yet or fails for any reason
// -- same never-throws, always-labeled pattern as data-status-service.js's resolveDataStatus and
// shell.js's resolveGivingSummary. `db` here is Finance's own FINANCE_DB, used only for the
// synthetic fallback path. fiscalYear is null for the synthetic fixture and for an older Connect
// that answers with the year-less shape.
export async function resolveAccountsReport(env, db, { fiscalYear = null } = {}) {
  const result = await fetchLiveFinanceChartOfAccounts(env, fiscalYear);
  if (result.ok) {
    return {
      rows: result.chartOfAccounts.accounts.map(liveAccountToRow),
      source: 'live',
      fiscalYear: result.chartOfAccounts.fiscalYear,
      availableFiscalYears: result.chartOfAccounts.availableFiscalYears,
    };
  }
  const rows = await readSyntheticAccountsReport(db);
  return { rows, source: 'synthetic-fallback', fallbackReason: result.reason, fiscalYear: null, availableFiscalYears: [] };
}

export function buildAccountsReportView(rows) {
  const unique = (field) => new Set(rows.map((row) => row[field]).filter(Boolean)).size;
  return {
    rows,
    hierarchy: buildAccountHierarchy(rows),
    counts: {
      total: rows.length,
      income: rows.filter((row) => isRevenueClassification(row.classification)).length,
      expenses: rows.filter((row) => !isRevenueClassification(row.classification)).length,
      boardCategories: unique('board_category_key'),
      purposeTags: unique('purpose_tag_id'),
    },
  };
}

// ── Legacy Chart of Accounts tab, server-side ──────────────────────────────────────────────
// finRenderChartOfAccounts (src/frontend/js-finance.js) lists the leaves of one year's ledger
// tree: finBuildTreeFromFlatRows, then finReorganizeChurchTree's pruning of any line with no
// actual and no budget under each classification root (a group whose every child was pruned goes
// too), then finFlattenLeaves. buildChurchAccountTree (compensation-projection.js) is that same
// port, so its leaves are legacy's leaves. Revenue regrouping in finReorganizeChurchTree only moves
// groups around and never changes which nodes are leaves, so it is not needed here. Rows without
// figures (the synthetic fixture, or an older year-less Connect) cannot be pruned; their leaves
// are simply the paths no other path sits under.
export function chartLeafRows(rows) {
  const hasFigures = rows.length > 0 && rows.every((row) => Number.isInteger(row.actual_cents));
  if (!hasFigures) {
    const paths = rows.map((r) => r.category_path);
    return rows.filter((r) => !paths.some((p) => p !== r.category_path && p.startsWith(`${r.category_path}:`)));
  }
  const byPath = new Map(rows.map((row) => [row.category_path, row]));
  const tree = buildChurchAccountTree(rows.map((row) => ({
    categoryPath: row.category_path, accountName: row.account_name, classification: row.classification,
    depth: row.depth ?? 0, actualCents: row.actual_cents, budgetCents: row.budget_cents ?? null,
  })));
  const leaves = [];
  (function walk(nodes) {
    for (const node of nodes) {
      if (node.children.length) walk(node.children);
      else leaves.push(byPath.get(node.path));
    }
  })(tree);
  return leaves;
}

// The board layout to group by. The saved layout (connect.finance-board-layout.v1) when it could
// be read; otherwise the same assignments, renames and tags as the chart rows themselves carry,
// under the default headings, so an account with no saved category still lands in its name-based
// default category rather than "Unassigned".
export function layoutFromChartRows(rows) {
  const layout = normalizeBoardLayout(null);
  const tags = new Map();
  for (const row of rows) {
    const isRevenue = isRevenueClassification(row.classification);
    const order = isRevenue ? BOARD_REVENUE_ORDER : BOARD_EXPENSE_ORDER;
    if (order.includes(row.board_category_key)) (isRevenue ? layout.revenue : layout.expense)[row.category_path] = row.board_category_key;
    if (row.display_name && row.display_name !== row.account_name) layout.accountLabels[row.category_path] = row.display_name;
    if (row.purpose_tag_id && row.purpose_tag_label) {
      layout.tagCategories[row.category_path] = row.purpose_tag_id;
      if (!tags.has(row.purpose_tag_id)) tags.set(row.purpose_tag_id, row.purpose_tag_label);
    }
  }
  layout.tags = [...tags.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  return layout;
}

// Legacy compares display labels with < / >, not localeCompare; kept so the order matches.
const byLabel = (a, b) => (a.label < b.label ? -1 : (a.label > b.label ? 1 : 0));

// The main Chart of Accounts view: every chart leaf under its board category, in legacy's card
// order (revenue: donor, earned, passive, restricted; then the nine expense categories), every
// category shown even when empty, accounts sorted by display name within a category, each with its
// year actual/budget and a subtotal per category and per side. A leaf's category is its saved one,
// or legacy's default matched against the QuickBooks name (never a display rename).
export function buildChartOfAccountsView(rows, layout) {
  const leaves = chartLeafRows(rows).map((row) => {
    const isRevenue = isRevenueClassification(row.classification);
    const { key, assigned } = boardCategoryFor(layout, row.category_path, row.account_name, isRevenue);
    const tagId = layout.tagCategories[row.category_path] || '';
    const tag = layout.tags.find((t) => t.id === tagId) || null;
    return {
      path: row.category_path,
      qbName: row.account_name,
      label: accountDisplayName(layout, row.category_path, row.account_name),
      classification: row.classification,
      isRevenue,
      categoryKey: key,
      assigned,
      actualCents: Number.isInteger(row.actual_cents) ? row.actual_cents : null,
      budgetCents: Number.isInteger(row.budget_cents) ? row.budget_cents : null,
      purposeTagId: tag ? tag.id : null,
      purposeTagLabel: tag ? tag.label : null,
    };
  });
  const hasFigures = leaves.length > 0 && leaves.every((leaf) => leaf.actualCents !== null);
  const sum = (items, field) => items.reduce((total, item) => total + (item[field] || 0), 0);
  const side = (isRevenue) => {
    const members = leaves.filter((leaf) => leaf.isRevenue === isRevenue);
    const groups = (isRevenue ? BOARD_REVENUE_ORDER : BOARD_EXPENSE_ORDER).map((key) => {
      const items = members.filter((leaf) => leaf.categoryKey === key).sort(byLabel);
      return {
        key, isRevenue, label: boardLabelFor(layout, key, isRevenue), items,
        actualCents: sum(items, 'actualCents'), budgetCents: sum(items, 'budgetCents'),
        hasBudget: items.some((item) => item.budgetCents !== null),
      };
    });
    return {
      groups, count: members.length,
      actualCents: sum(members, 'actualCents'), budgetCents: sum(members, 'budgetCents'),
      hasBudget: members.some((item) => item.budgetCents !== null),
    };
  };
  // A posting made directly to an account group (a QuickBooks parent) belongs to no leaf, so legacy's
  // tab never lists it; it is reported here so the totals can be reconciled to the Church Report.
  const groupPostedCents = (isRevenue) => (hasFigures
    ? rows.filter((row) => isRevenueClassification(row.classification) === isRevenue).reduce((total, row) => total + (row.actual_cents || 0), 0)
      - sum(leaves.filter((leaf) => leaf.isRevenue === isRevenue), 'actualCents')
    : 0);
  return {
    leaves, hasFigures, revenue: side(true), expense: side(false),
    unlistedRevenueCents: groupPostedCents(true), unlistedExpenseCents: groupPostedCents(false),
  };
}

// Legacy finPurposeTagTotals: one row per saved tag, in the saved order. A tag's total is every
// counted (not externally funded) Compensation worker wearing it -- their full church cost,
// salary plus benefits, from the raise projection for the year after the chart's year, as legacy's
// Compensation tab computes it -- plus every tagged chart leaf's own actual. A leaf whose leading
// account number matches a tagged worker's account code is skipped, so tagging both a worker and
// the line their salary posts to never counts it twice. The number is read from the QuickBooks
// name; legacy read it from the display name, so renaming "60010 Pastor Salary" lost the match
// and counted the salary twice (the same correction compensation-projection.js makes). `payroll` is { roster, computed, isExternallyFunded } from projectCompensation, or null
// when the viewer's role cannot read the Compensation plan -- the payroll side is then omitted
// (payrollAvailable false), not shown as $0.
export function buildPurposeTotals(view, layout, payroll = null) {
  const totals = new Map(layout.tags.map((t) => [t.id, {
    id: t.id, label: t.label, payrollCents: 0, accountCents: 0, workers: [], accounts: [],
  }]));
  const payrollCodes = new Set();
  if (payroll) {
    payroll.roster.forEach((w, i) => {
      if (payroll.isExternallyFunded(w)) return;
      const code = String(w.accountCode || '').trim();
      const entry = totals.get(w.purposeTag || '');
      if (!entry) return;
      entry.payrollCents += (payroll.computed[i] ? payroll.computed[i].churchCostCents : 0) || 0;
      entry.workers.push(w.name || '(unnamed)');
      if (code) payrollCodes.add(code);
    });
  }
  for (const leaf of view.leaves) {
    const entry = totals.get(layout.tagCategories[leaf.path] || '');
    if (!entry) continue;
    const match = String(leaf.qbName || '').match(/^\s*(\d{3,8})/);
    if (match && payrollCodes.has(match[1])) continue;
    entry.accountCents += leaf.actualCents || 0;
    entry.accounts.push(leaf.label);
  }
  return {
    payrollAvailable: Boolean(payroll),
    rows: [...totals.values()].map((entry) => ({ ...entry, totalCents: entry.payrollCents + entry.accountCents })),
  };
}
