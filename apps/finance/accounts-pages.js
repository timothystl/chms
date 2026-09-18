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

// Every distinct purpose tag this page currently knows about, derived straight from the account
// rows already fetched for the table above (each row carries its own account's purpose_tag_id/
// purpose_tag_label) -- there is no separate read endpoint for the raw tag list itself, so this is
// the only source apps/finance has for prefilling the tag-list form below. A tag with no account
// currently wearing it (freshly added, or every account it was on got reassigned) won't show up
// here until it is put on at least one account -- a real limitation of deriving the list this way,
// not a bug in the derivation itself.
function deriveCurrentPurposeTags(rows) {
  const seen = new Map();
  for (const row of rows) {
    if (row.purpose_tag_id && row.purpose_tag_label && !seen.has(row.purpose_tag_id)) {
      seen.set(row.purpose_tag_id, row.purpose_tag_label);
    }
  }
  return [...seen.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
}

// Admin-only purpose-tag management -- relayed live to Connect's real
// finance_planning_purpose_tags store (see finance-purpose-tags-write-v1 in
// src/api-contracts-service.js), never stored in Finance's own database. Two separate forms
// posting to the same relay route: the first is a FULL REPLACE of the tag list itself (one
// "id,label" pair per line -- leave the id blank to mint a new one; a line taken out of the
// textarea is a tag taken out of the store, matching Connect's own purpose-tags PUT route
// exactly), prefilled with every tag this page currently knows about so renaming/adding/removing
// is a plain text edit rather than risking an accidental loss of an untouched tag. The second
// assigns one already-defined tag to one ledger leaf (category_path), which Connect MERGES into
// whatever is already saved -- the same reasoning as the board-category form above.
function renderPurposeTagsForms(currentTags, entryStatus, entryMessage) {
  const tagLines = currentTags.map((t) => `${t.id},${t.label}`).join('\n');
  const options = currentTags.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.label)}</option>`).join('');
  return `<section aria-label="Manage purpose tags">
    ${renderSectionHeading({ eyebrow: 'Chart of Accounts', heading: 'Manage purpose tags', badge: 'Relayed live to Connect' })}
    ${entryStatus === 'ok' ? '<p class="status">Saved in Connect.</p>' : ''}
    ${entryStatus === 'error' ? `<p class="status status-error">Not saved: ${escapeHtml(entryMessage || 'unknown error')}</p>` : ''}
    <form method="POST" action="/api/v1/connect-purpose-tags-write">
      <div class="field"><label for="pt-tags">One tag per line: id,label (leave the id blank to add a new tag; take out a line to remove that tag)</label><textarea id="pt-tags" name="tags" rows="6">${escapeHtml(tagLines)}</textarea></div>
      <button type="submit">Save tag list</button>
    </form>
    <form method="POST" action="/api/v1/connect-purpose-tags-write">
      <div class="grid form-grid">
        <div class="field"><label for="pt-path">Ledger path</label><input id="pt-path" type="text" name="category_path" placeholder="e.g. Expenses:60000 Programs" required></div>
        <div class="field"><label for="pt-tag">Purpose tag</label><select id="pt-tag" name="purpose_tag_id">
          <option value="">— (clear assignment)</option>
          ${options}
        </select></div>
      </div>
      <button type="submit">Save assignment</button>
    </form>
    <p><small>Purpose tags are a second, independent axis over the same accounts the board-category assignment above already classifies -- one line can carry a board category ("Salaries") and a free-form purpose ("Youth") at once. Saving the tag list above sends the whole list as it stands -- every tag you want kept needs its own line, not just the one you're changing. Only Connect's own admin role may save; Connect independently re-verifies your identity and role for every request.</small></p>
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

export function renderAccountsPage(pageId, {
  accountsReport, canManageBoardCategories, boardCategoryEntryStatus, boardCategoryEntryMessage,
  canManagePurposeTags, purposeTagsEntryStatus, purposeTagsEntryMessage,
}) {
  const isLive = accountsReport.source === 'live';
  const report = buildAccountsReportView(accountsReport.rows);
  return `<section class="report" aria-label="${isLive ? 'Chart of Accounts' : 'Synthetic Chart of Accounts'}">
    ${renderSectionHeading({ eyebrow: 'Chart of Accounts', heading: 'Account presentation', badge: isLive ? 'Live from Connect' : 'Synthetic staging' })}
    ${renderKpiCards([
      { label: 'Total accounts', value: String(report.counts.total), hint: `${report.counts.income} income · ${report.counts.expenses} expense` },
      { label: 'Board categories', value: String(report.counts.boardCategories), hint: 'Presentation only; ledger paths unchanged' },
      { label: 'Purpose tags', value: String(report.counts.purposeTags), hint: 'Independent reporting lens over the same accounts' },
    ])}
    ${renderSectionHeading({ eyebrow: 'Ledger hierarchy', heading: 'Account tree', badge: 'Paths preserved', trend: true })}
    ${renderTable({ head: ['Hierarchy', 'Ledger path', 'Account', 'Board category', 'Purpose'], rows: renderAccountHierarchy(report.hierarchy) })}
    <p><small>${isLive
      ? "Fetched live from Connect's real, structural-only finance-chart-of-accounts contract endpoint. No dollar figure, gift, donor, or person crosses this contract."
      : `The committed synthetic fixture (the live endpoint is not configured or did not answer${accountsReport.fallbackReason ? `: ${escapeHtml(accountsReport.fallbackReason)}` : ''}).`}</small></p>
  </section>${canManageBoardCategories ? renderBoardCategoryForm(boardCategoryEntryStatus, boardCategoryEntryMessage) : ''}${canManagePurposeTags ? renderPurposeTagsForms(deriveCurrentPurposeTags(report.rows), purposeTagsEntryStatus, purposeTagsEntryMessage) : ''}`;
}
