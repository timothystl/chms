import { buildAccountsReportView } from './accounts-report-service.js';
import { escapeHtml, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';

// Mirrors REVENUE_STREAM_DEFAULT_LABELS (src/api-contracts.js) and BOARD_EXPENSE_CATEGORIES
// (src/api-finance.js) -- apps/finance is a separate Worker with no import access to src/, so
// this small, stable, rarely-changed closed set is duplicated here rather than fetched, the same
// reasoning as compensation-calc.js's own mechanical port comment. Only used to render the picker
// -- the real, authoritative allowlist check happens on Connect's side (applyBoardCategoryMerge,
// src/api-finance.js), so a drift here would only ever show a stale label, never let an invalid
// key through.
const REVENUE_CATEGORY_OPTIONS = [
  { key: 'donor', label: 'Donor' }, { key: 'earned', label: 'Earned' },
  { key: 'passive', label: 'Passive' }, { key: 'restricted', label: 'Restricted' },
];
const EXPENSE_CATEGORY_OPTIONS = [
  { key: 'mdo', label: 'MDO' }, { key: 'salaries', label: 'Salaries' }, { key: 'benefits', label: 'Benefits' },
  { key: 'worship', label: 'Worship & Music' }, { key: 'property', label: 'Property & Operations' },
  { key: 'education', label: 'Lutheran Education' }, { key: 'youth_family', label: 'Youth & Family' },
  { key: 'district_synod', label: 'District & Synod Support' }, { key: 'programs', label: 'Programs' },
];

// Admin-only board-category assignment -- relayed live to Connect's real
// finance_planning_board_categories store (see finance-board-categories-write-v1 in
// src/api-contracts-service.js), never stored in Finance's own database. One account (category
// path) at a time, matching Budget/Church's own single-row edit forms; picking the blank option
// clears that one account back to its computed default.
function renderBoardCategoryForm(entryStatus, entryMessage) {
  const optgroup = (label, options) => `<optgroup label="${escapeHtml(label)}">${options.map((o) =>
    `<option value="${escapeHtml(o.key)}">${escapeHtml(o.label)}</option>`).join('')}</optgroup>`;
  return `<section aria-label="Assign a board category">
    ${renderSectionHeading({ eyebrow: 'Chart of Accounts', heading: 'Assign a board category', badge: 'Relayed live to Connect' })}
    ${entryStatus === 'ok' ? '<p class="status">Saved in Connect.</p>' : ''}
    ${entryStatus === 'error' ? `<p class="status status-error">Not saved: ${escapeHtml(entryMessage || 'unknown error')}</p>` : ''}
    <form method="POST" action="/api/v1/connect-board-categories-write">
      <div class="grid form-grid">
        <div class="field"><label for="bcat-path">Ledger path</label><input id="bcat-path" type="text" name="category_path" placeholder="e.g. Expenses:60000 Programs" required></div>
        <div class="field"><label for="bcat-category">Board category</label><select id="bcat-category" name="board_category">
          <option value="">— (clear assignment)</option>
          ${optgroup('Revenue', REVENUE_CATEGORY_OPTIONS)}
          ${optgroup('Expense', EXPENSE_CATEGORY_OPTIONS)}
        </select></div>
      </div>
      <button type="submit">Save assignment</button>
    </form>
    <p><small>This writes directly into Connect's own board-category presentation store -- the same one the legacy in-Connect Chart of Accounts edits. It only relabels how this account is grouped on the Board view; the real ledger path and every QuickBooks sync/import are unchanged. Only Connect's own admin role may save; Connect independently re-verifies your identity and role for every request.</small></p>
  </section>`;
}

function flattenAccountHierarchy(nodes) {
  return nodes.flatMap((node) => [node, ...flattenAccountHierarchy(node.children)]);
}

export function renderAccountHierarchy(nodes) {
  return flattenAccountHierarchy(nodes).map((node) => {
    const presentation = node.account;
    return `<tr><td style="padding-left:${(0.85 + node.depth * 1.1).toFixed(2)}rem">${node.depth === 0 ? '<strong>' : ''}${escapeHtml(node.label)}${node.depth === 0 ? '</strong>' : ''}</td><td>${escapeHtml(node.path)}</td><td>${presentation ? escapeHtml(presentation.name) : '—'}</td><td>${presentation ? escapeHtml(presentation.boardCategoryLabel) : '—'}</td><td>${presentation?.purposeTagLabel ? escapeHtml(presentation.purposeTagLabel) : '—'}</td></tr>`;
  }).join('');
}

export function renderAccountsPage(pageId, { accountsReport, canManageBoardCategories, boardCategoryEntryStatus, boardCategoryEntryMessage }) {
  const isLive = accountsReport.source === 'live';
  const report = buildAccountsReportView(accountsReport.rows);
  return `<section class="report" aria-label="${isLive ? 'Chart of Accounts' : 'Synthetic Chart of Accounts'}">
    ${renderSectionHeading({ eyebrow: 'Chart of Accounts', heading: 'Account presentation', badge: isLive ? 'Live from Connect' : 'Synthetic staging' })}
    ${renderKpiCards([
      { label: 'Total accounts', value: String(report.counts.total), hint: `${report.counts.income} income · ${report.counts.expenses} expense` },
      { label: 'Board categories', value: String(report.counts.boardCategories), hint: 'Presentation only; ledger paths unchanged' },
      { label: 'Purpose tags', value: String(report.counts.purposeTags), hint: 'Independent reporting lens · read-only' },
    ])}
    ${renderSectionHeading({ eyebrow: 'Ledger hierarchy', heading: 'Account tree', badge: 'Paths preserved', trend: true })}
    ${renderTable({ head: ['Hierarchy', 'Ledger path', 'Account', 'Board category', 'Purpose'], rows: renderAccountHierarchy(report.hierarchy) })}
    <p><small>${isLive
      ? "Fetched live from Connect's real, structural-only finance-chart-of-accounts contract endpoint. No dollar figure, gift, donor, or person crosses this contract."
      : `The committed synthetic fixture (the live endpoint is not configured or did not answer${accountsReport.fallbackReason ? `: ${escapeHtml(accountsReport.fallbackReason)}` : ''}).`}</small></p>
  </section>${canManageBoardCategories ? renderBoardCategoryForm(boardCategoryEntryStatus, boardCategoryEntryMessage) : ''}`;
}
