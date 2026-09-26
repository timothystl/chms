import { buildDataStatusView } from './data-status-service.js';
import { buildAccountsReportView } from './accounts-report-service.js';
import { escapeHtml, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';
import { findTransactionExceptions, summarizeExpenseAccounts, summarizeVendorSpend } from './quickbooks-transactions-service.js';

function flattenAccountHierarchy(nodes) {
  return nodes.flatMap((node) => [node, ...flattenAccountHierarchy(node.children)]);
}

function renderMappingRows(nodes) {
  return flattenAccountHierarchy(nodes)
    .filter((node) => node.account)
    .map((node) => `<tr><td>${escapeHtml(node.path)}</td><td>${escapeHtml(node.account.boardCategoryLabel)}</td><td>${node.account.purposeTagLabel ? escapeHtml(node.account.purposeTagLabel) : '—'}</td></tr>`)
    .join('');
}

const QB_STATUS_MESSAGES = {
  connected: 'QuickBooks connected. Run a sync to load the latest figures.',
  disconnected: 'QuickBooks disconnected and its access revoked.',
  budget_saved: 'Budget choice saved. The next sync uses it.',
};

function renderQuickbooksStatusLine(params) {
  const qb = params && params.get('qb');
  if (!qb) return '';
  if (qb === 'error') return `<p class="status status-error">${escapeHtml(params.get('message') || 'QuickBooks request failed.')}</p>`;
  if (qb === 'synced') {
    const warnings = Number(params.get('warnings')) || 0;
    return `<p class="status">Synced ${escapeHtml(params.get('rows') || '0')} Church Report rows from QuickBooks${warnings ? ` with ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}.</p>`;
  }
  return QB_STATUS_MESSAGES[qb] ? `<p class="status">${QB_STATUS_MESSAGES[qb]}</p>` : '';
}

// Finance's own QuickBooks connection (quickbooks-oauth-routes.js), shown once FINANCE_QB_ENABLED
// is on. Admins get the controls; everyone who can see the section gets the status.
export function renderQuickbooksConnection(own, { canManage, budgets, params } = {}) {
  const thisYear = new Date().getFullYear();
  const yearBoxes = Array.from({ length: 6 }, (_, i) => thisYear - i).map((y) => `<label><input type="checkbox" name="fiscal_year" value="${y}"> ${y}</label>`).join(' ');
  const budgetList = budgets
    ? (budgets.ok
      ? `<form method="POST" action="/api/v1/qb/budget-select"><div class="field"><label for="qb-budget">Budget used for Budget vs Actual</label><select id="qb-budget" name="budget_id"><option value="">Choose automatically (legacy rule)</option>${budgets.budgets.map((b) => `<option value="${escapeHtml(b.id)}"${b.id === budgets.selectedBudgetId ? ' selected' : ''}>${escapeHtml(`${b.name} (${b.startDate}–${b.endDate})${b.active ? '' : ' · inactive'}`)}</option>`).join('')}</select></div><button type="submit">Save budget choice</button></form>`
      : `<p class="status status-error">Budgets could not be loaded: ${escapeHtml(budgets.error || 'unknown error')}</p>`)
    : '';
  const controls = !canManage ? '' : own.connected
    ? `<form method="POST" action="/api/v1/qb/sync" style="display:inline"><button type="submit">Sync now</button></form>
      <form method="POST" action="/api/v1/qb/disconnect" style="display:inline"><button type="submit" onclick="return confirm('Disconnect QuickBooks and revoke Finance’s access?')">Disconnect</button></form>
      <form method="POST" action="/api/v1/qb/sync-years"><fieldset><legend>Sync actuals for specific years</legend>${yearBoxes}</fieldset><button type="submit">Sync selected years</button></form>
      ${budgets ? budgetList : '<p><a href="/?section=quickbooks&amp;page=sync-status&amp;budgets=1">Choose which QuickBooks budget to use</a></p>'}`
    : '<p><a class="button" href="/api/v1/qb/connect">Connect QuickBooks</a></p>';
  return `<section aria-label="QuickBooks connection">
    ${renderSectionHeading({ eyebrow: 'QuickBooks', heading: 'Connection', badge: own.connected ? 'Connected to Finance' : 'Not connected' })}
    ${renderQuickbooksStatusLine(params)}
    ${own.connected
      ? renderKpiCards([
        { label: 'Company', value: escapeHtml(own.companyName || 'QuickBooks company'), hint: own.environment === 'sandbox' ? 'Sandbox' : 'Production' },
        { label: 'Connected', value: escapeHtml((own.connectedAt || '').slice(0, 10) || '—') },
        { label: 'Last sync', value: escapeHtml((own.lastSyncedAt || '').slice(0, 16).replace('T', ' ') || 'Never'), hint: own.reconnectBy ? `Reconnect before ${escapeHtml(own.reconnectBy.slice(0, 10))}` : undefined },
      ])
      : '<p>Finance is not connected to QuickBooks. An admin connects it once; Finance then keeps its own access current.</p>'}
    ${controls}
  </section>`;
}

function money(cents) {
  return cents == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function transactionLink(row) {
  return row.viewUrl
    ? `<a href="${escapeHtml(row.viewUrl)}" target="_blank" rel="noopener">View in QuickBooks</a>`
    : '—';
}

function renderDateFilter(pageId, result) {
  return `<form method="GET" action="/" class="filter-form">
    <input type="hidden" name="section" value="quickbooks"><input type="hidden" name="page" value="${escapeHtml(pageId)}">
    <div class="field"><label for="qb-start">From</label><input id="qb-start" type="date" name="start_date" value="${escapeHtml(result?.startDate || '')}" required></div>
    <div class="field"><label for="qb-end">Through</label><input id="qb-end" type="date" name="end_date" value="${escapeHtml(result?.endDate || '')}" required></div>
    <button type="submit">Load</button>
  </form>`;
}

function renderTransactionPage(pageId, result) {
  const headings = {
    transactions: ['Transactions', 'QuickBooks transaction detail'],
    'expense-drilldown': ['Expense drill-down', 'Spending by account'],
    'vendor-spend': ['Vendor spend', 'Spending by vendor'],
    exceptions: ['Exceptions', 'Incomplete transaction details'],
  };
  const [heading, description] = headings[pageId];
  const filter = renderDateFilter(pageId, result);
  if (!result?.ok) return `<section class="report" aria-label="${escapeHtml(heading)}">
    ${renderSectionHeading({ eyebrow: 'QuickBooks', heading, badge: 'Live read' })}
    <p>${escapeHtml(description)}. Finance reads this directly from QuickBooks and does not change transactions.</p>
    ${filter}<p class="status status-error">${escapeHtml(result?.error || 'Transactions are unavailable.')}</p></section>`;
  const rows = result.transactions || [];
  let table;
  if (pageId === 'expense-drilldown') {
    table = renderTable({ head: ['Account', 'Transactions', 'Total activity'], rows: summarizeExpenseAccounts(rows).map((row) => `<tr><td>${escapeHtml(row.account)}</td><td>${row.transactionCount}</td><td>${money(row.amountCents)}</td></tr>`).join('') });
  } else if (pageId === 'vendor-spend') {
    table = renderTable({ head: ['Vendor', 'Transactions', 'Spend'], rows: summarizeVendorSpend(rows).map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.transactionCount}</td><td>${money(row.amountCents)}</td></tr>`).join('') });
  } else {
    const displayed = pageId === 'exceptions' ? findTransactionExceptions(rows) : rows;
    const includeReason = pageId === 'exceptions';
    table = renderTable({
      head: ['Date', 'Type', 'Number', 'Name', 'Account', 'Amount', ...(includeReason ? ['Reason'] : []), ''],
      rows: displayed.map((row) => `<tr><td>${escapeHtml(row.date || '—')}</td><td>${escapeHtml(row.type || '—')}</td><td>${escapeHtml(row.docNum || '—')}</td><td>${escapeHtml(row.name || '—')}</td><td>${escapeHtml(row.account || '—')}</td><td>${row.amountCents == null ? escapeHtml(row.amount || '—') : money(row.amountCents)}</td>${includeReason ? `<td>${escapeHtml(row.reasons.join('; '))}</td>` : ''}<td>${transactionLink(row)}</td></tr>`).join(''),
    });
  }
  return `<section class="report" aria-label="${escapeHtml(heading)}">
    ${renderSectionHeading({ eyebrow: 'QuickBooks', heading, badge: 'Live from QuickBooks' })}
    <p>${escapeHtml(description)} for ${escapeHtml(result.startDate)} through ${escapeHtml(result.endDate)}. This is read-only; use the QuickBooks link to edit a source transaction.</p>
    ${filter}${renderKpiCards([{ label: 'Transactions loaded', value: String(rows.length) }, { label: 'Loaded at', value: escapeHtml(result.syncedAt.slice(0, 16).replace('T', ' ')), hint: 'UTC' }])}${table}</section>`;
}

function renderImportHistory(result) {
  if (!result?.ok) return `<section class="report" aria-label="Import history">
    ${renderSectionHeading({ eyebrow: 'QuickBooks', heading: 'Import history', badge: 'Unavailable' })}
    <p class="status status-error">${escapeHtml(result?.error || 'Import history is unavailable.')}</p></section>`;
  const rows = result.rows || [];
  return `<section class="report" aria-label="Import history">
    ${renderSectionHeading({ eyebrow: 'Accounts & data', heading: 'Import history', badge: 'Live' })}
    <p>Completed Finance imports, newest first. The first entry for an older importer may be the latest pre-history status retained when tracking began.</p>
    ${renderKpiCards([{ label: 'Events shown', value: String(rows.length) }])}
    ${renderTable({ head: ['Completed', 'Importer', 'Coverage / note'], rows: rows.map((row) => `<tr><td>${escapeHtml(String(row.importedAt || '').replace('T', ' ').replace('Z', ' UTC'))}</td><td>${escapeHtml(row.importerLabel)}</td><td>${escapeHtml(row.note || '—')}</td></tr>`).join('') })}
  </section>`;
}

export function renderQuickbooksPage(pageId, { dataStatus, accountsReport, quickbooksOwn = null, quickbooksBudgets = null, quickbooksTransactions = null, importHistory = null, canManageQuickbooks = false, searchParams = null }) {
  if (['transactions', 'expense-drilldown', 'vendor-spend', 'exceptions'].includes(pageId)) {
    return renderTransactionPage(pageId, quickbooksTransactions);
  }
  if (pageId === 'import-history') return renderImportHistory(importHistory);
  if (pageId === 'account-mapping') {
    const isLive = accountsReport.source === 'live';
    const report = buildAccountsReportView(accountsReport.rows);
    return `<section class="report" aria-label="QuickBooks account mapping">
      ${renderSectionHeading({ eyebrow: 'QuickBooks', heading: 'Account mapping', badge: isLive ? 'Live from Connect' : 'Finance category mapping (synthetic)' })}
      <p>This is Finance’s own ledger-path-to-board-category mapping, not a live link to QuickBooks account IDs -- the <code>account_qbo_id</code> column Finance’s schema reserves for that is not populated by any import today.</p>
      ${renderTable({ head: ['Ledger path', 'Board category', 'Purpose'], rows: renderMappingRows(report.hierarchy) })}
    </section>`;
  }
  // 'sync-status' (default) -- same underlying contract/status as Data & Imports. Finance's own
  // connection card (once enabled) must not depend on that status feed, so a status that cannot be
  // built only drops its own panel.
  const connection = quickbooksOwn && !quickbooksOwn.syntheticUnavailable
    ? renderQuickbooksConnection(quickbooksOwn, { canManage: canManageQuickbooks, budgets: quickbooksBudgets, params: searchParams })
    : '';
  let statusSection;
  try {
    const isLive = dataStatus.source === 'live';
    const status = buildDataStatusView(dataStatus.row, new Date(), {
      productionConnected: dataStatus.productionConnected,
      writerConnected: dataStatus.writerConnected,
    });
    statusSection = `<section class="report" aria-label="${isLive ? 'QuickBooks sync status' : 'Synthetic QuickBooks sync status'}">
    ${renderSectionHeading({ eyebrow: 'QuickBooks', heading: 'Sync status', badge: isLive ? 'Live from Connect' : 'Synthetic staging' })}
    ${renderKpiCards([
      { label: 'Production connection', value: status.productionConnected ? 'Connected' : 'Disconnected' },
      { label: 'QuickBooks writer', value: status.writerConnected ? 'Connected' : 'Disconnected', hint: isLive ? "Connect's real finance_qb_connection state" : 'No competing staging writer' },
      { label: isLive ? 'Most recent import' : 'Last fixture import', value: escapeHtml(status.lastImportedAt), hint: `${status.freshness} · ${status.ageDays} days old` },
    ])}
    <p>See Data &amp; Imports for the full freshness detail behind this status.</p>
  </section>`;
  } catch (error) {
    if (!connection) throw error;
    statusSection = '';
  }
  return statusSection + connection;
}
