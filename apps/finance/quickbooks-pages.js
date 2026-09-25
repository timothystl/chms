import { buildDataStatusView } from './data-status-service.js';
import { buildAccountsReportView } from './accounts-report-service.js';
import { escapeHtml, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';

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

export function renderQuickbooksPage(pageId, { dataStatus, accountsReport, quickbooksOwn = null, quickbooksBudgets = null, canManageQuickbooks = false, searchParams = null }) {
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
