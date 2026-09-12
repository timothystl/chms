import { buildAccountsReportView } from './accounts-report-service.js';
import { escapeHtml, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';

function flattenAccountHierarchy(nodes) {
  return nodes.flatMap((node) => [node, ...flattenAccountHierarchy(node.children)]);
}

export function renderAccountHierarchy(nodes) {
  return flattenAccountHierarchy(nodes).map((node) => {
    const presentation = node.account;
    return `<tr><td style="padding-left:${(0.85 + node.depth * 1.1).toFixed(2)}rem">${node.depth === 0 ? '<strong>' : ''}${escapeHtml(node.label)}${node.depth === 0 ? '</strong>' : ''}</td><td>${escapeHtml(node.path)}</td><td>${presentation ? escapeHtml(presentation.name) : '—'}</td><td>${presentation ? escapeHtml(presentation.boardCategoryLabel) : '—'}</td><td>${presentation?.purposeTagLabel ? escapeHtml(presentation.purposeTagLabel) : '—'}</td></tr>`;
  }).join('');
}

export function renderAccountsPage(pageId, { accountsReport }) {
  const report = buildAccountsReportView(accountsReport);
  return `<section class="report" aria-label="Synthetic Chart of Accounts">
    ${renderSectionHeading({ eyebrow: 'Chart of Accounts', heading: 'Account presentation', badge: 'Synthetic staging' })}
    ${renderKpiCards([
      { label: 'Total accounts', value: String(report.counts.total), hint: `${report.counts.income} income · ${report.counts.expenses} expense` },
      { label: 'Board categories', value: String(report.counts.boardCategories), hint: 'Presentation only; ledger paths unchanged' },
      { label: 'Purpose tags', value: String(report.counts.purposeTags), hint: 'Independent reporting lens · read-only' },
    ])}
    ${renderSectionHeading({ eyebrow: 'Ledger hierarchy', heading: 'Account tree', badge: 'Paths preserved', trend: true })}
    ${renderTable({ head: ['Hierarchy', 'Ledger path', 'Account', 'Board category', 'Purpose'], rows: renderAccountHierarchy(report.hierarchy) })}
  </section>`;
}
