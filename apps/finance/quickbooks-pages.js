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

export function renderQuickbooksPage(pageId, { dataStatus, accountsReport }) {
  if (pageId === 'account-mapping') {
    const report = buildAccountsReportView(accountsReport);
    return `<section class="report" aria-label="QuickBooks account mapping">
      ${renderSectionHeading({ eyebrow: 'QuickBooks', heading: 'Account mapping', badge: 'Finance category mapping' })}
      <p>This is Finance’s own ledger-path-to-board-category mapping, not a live link to QuickBooks account IDs -- the <code>account_qbo_id</code> column Finance’s schema reserves for that is not populated by any import today.</p>
      ${renderTable({ head: ['Ledger path', 'Board category', 'Purpose'], rows: renderMappingRows(report.hierarchy) })}
    </section>`;
  }
  // 'sync-status' (default) -- same underlying contract/status as Data & Imports.
  const isLive = dataStatus.source === 'live';
  const status = buildDataStatusView(dataStatus.row, new Date(), {
    productionConnected: dataStatus.productionConnected,
    writerConnected: dataStatus.writerConnected,
  });
  return `<section class="report" aria-label="${isLive ? 'QuickBooks sync status' : 'Synthetic QuickBooks sync status'}">
    ${renderSectionHeading({ eyebrow: 'QuickBooks', heading: 'Sync status', badge: isLive ? 'Live from Connect' : 'Synthetic staging' })}
    ${renderKpiCards([
      { label: 'Production connection', value: status.productionConnected ? 'Connected' : 'Disconnected' },
      { label: 'QuickBooks writer', value: status.writerConnected ? 'Connected' : 'Disconnected', hint: isLive ? "Connect's real finance_qb_connection state" : 'No competing staging writer' },
      { label: isLive ? 'Most recent import' : 'Last fixture import', value: escapeHtml(status.lastImportedAt), hint: `${status.freshness} · ${status.ageDays} days old` },
    ])}
    <p>See Data &amp; Imports for the full freshness detail behind this status.</p>
  </section>`;
}
