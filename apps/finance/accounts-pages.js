import {
  buildAccountsReportView, buildChartOfAccountsView, buildPurposeTotals, chartLeafRows, isRevenueClassification, layoutFromChartRows,
} from './accounts-report-service.js';
import { escapeHtml, formatSignedCents, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';
import {
  BOARD_EXPENSE_ORDER, BOARD_REVENUE_ORDER, DONOR_WRAPPER_DEFAULT_LABEL, BOARD_EXPENSE_DEFAULT_LABELS,
  BOARD_REVENUE_DEFAULT_LABELS, boardCategoryFor, boardLabelFor, buildBoardSections, defaultBoardCategory,
} from './board-layout.js';

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

// Fallback for the tag-list form when connect.finance-board-layout.v1 (which carries the full
// saved tag list) cannot be read: every distinct purpose tag on the account rows already fetched.
// A tag no account currently wears is missing from this fallback list.
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
function renderPurposeTagsForms(currentTags, entryStatus, entryMessage, { listOnly = false } = {}) {
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
    ${listOnly ? '<p><small>Assign tags to accounts in the Budget layout above.</small></p>' : `<form method="POST" action="/api/v1/connect-purpose-tags-write">
      <div class="grid form-grid">
        <div class="field"><label for="pt-path">Ledger path</label><input id="pt-path" type="text" name="category_path" placeholder="e.g. Expenses:60000 Programs" required></div>
        <div class="field"><label for="pt-tag">Purpose tag</label><select id="pt-tag" name="purpose_tag_id">
          <option value="">— (clear assignment)</option>
          ${options}
        </select></div>
      </div>
      <button type="submit">Save assignment</button>
    </form>`}
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

// Legacy Chart of Accounts (finRenderChartOfAccounts in src/frontend/js-finance.js): the budget's
// board layout, edited in one place. Headings rename the Budget builder's categories and the Donor
// Income wrapper; each account can be moved to another category (one at a time or by selecting
// several), renamed for display, and tagged with a purpose. Only changed rows are sent, so an
// account still on its name-based default is not pinned to it by saving another row. The accounts
// are the same year's chart leaves the main table above lists.
function renderLayoutEditor(rows, layout, entryStatus, entryMessage) {
  const e = escapeHtml;
  const leaves = chartLeafRows(rows);
  const sections = buildBoardSections(leaves, layout, (r) => ({ path: r.category_path, name: r.account_name, isRevenue: isRevenueClassification(r.classification) }));
  const tagOptions = (selected) => `<option value="">—</option>${layout.tags.map((t) => `<option value="${e(t.id)}"${t.id === selected ? ' selected' : ''}>${e(t.label)}</option>`).join('')}`;
  const catOptions = (isRevenue, row) => {
    const { key, assigned } = boardCategoryFor(layout, row.category_path, row.account_name, isRevenue);
    const order = isRevenue ? BOARD_REVENUE_ORDER : BOARD_EXPENSE_ORDER;
    const fallback = defaultBoardCategory(row.account_name, isRevenue);
    return `<option value=""${assigned ? '' : ' selected'}>Automatic (${e(boardLabelFor(layout, fallback, isRevenue))})</option>${order.map((k) => `<option value="${k}"${assigned && k === key ? ' selected' : ''}>${e(boardLabelFor(layout, k, isRevenue))}</option>`).join('')}`;
  };
  let index = 0;
  const accountRow = (row, isRevenue) => {
    const i = index++;
    const { key, assigned } = boardCategoryFor(layout, row.category_path, row.account_name, isRevenue);
    const customName = layout.accountLabels[row.category_path] || '';
    const tag = layout.tagCategories[row.category_path] || '';
    return `<tr>
      <td><input type="checkbox" name="select_${i}" value="1" aria-label="Select ${e(row.account_name)}"></td>
      <td><input type="hidden" name="path_${i}" value="${e(row.category_path)}"><input type="hidden" name="side_${i}" value="${isRevenue ? 'revenue' : 'expense'}">
        <input type="hidden" name="orig_cat_${i}" value="${assigned ? key : ''}"><input type="hidden" name="orig_name_${i}" value="${e(customName)}"><input type="hidden" name="orig_tag_${i}" value="${e(tag)}">
        <input type="text" name="name_${i}" value="${e(customName)}" placeholder="${e(row.account_name)}" aria-label="Display name for ${e(row.account_name)}" style="width:100%"><br><small>${e(row.category_path)}</small></td>
      <td><select name="cat_${i}" aria-label="Board category for ${e(row.account_name)}">${catOptions(isRevenue, row)}</select></td>
      <td><select name="tag_${i}" aria-label="Purpose tag for ${e(row.account_name)}">${tagOptions(tag)}</select></td>
    </tr>`;
  };
  const group = (g, cls) => `<tr class="${cls}"><td colspan="4"><b>${e(g.label)}</b> <small>${g.items.length} account${g.items.length === 1 ? '' : 's'}</small></td></tr>${g.items.map((r) => accountRow(r, g.isRevenue)).join('')}`;
  const side = (label, list) => `<tr class="coa-side"><td colspan="4">${label}</td></tr>${list.map((s) => (s.kind === 'wrapper'
    ? `<tr class="coa-wrapper"><td colspan="4"><b>${e(s.label)}</b></td></tr>${s.groups.map((g) => group(g, 'coa-sub')).join('')}`
    : group(s, 'coa-cat'))).join('')}`;
  const bulkOptions = `<option value="">— keep each row’s choice</option><optgroup label="Revenue accounts">${BOARD_REVENUE_ORDER.map((k) => `<option value="revenue:${k}">${e(boardLabelFor(layout, k, true))}</option>`).join('')}<option value="revenue:">Automatic</option></optgroup><optgroup label="Expense accounts">${BOARD_EXPENSE_ORDER.map((k) => `<option value="expense:${k}">${e(boardLabelFor(layout, k, false))}</option>`).join('')}<option value="expense:">Automatic</option></optgroup>`;
  const headingField = (name, value, placeholder, label) => `<div class="field"><label>${e(label)}<input type="text" name="${name}" value="${e(value || '')}" placeholder="${e(placeholder)}"></label></div>`;
  return `<section id="layout" aria-label="Budget layout">
    ${renderSectionHeading({ eyebrow: 'Chart of Accounts', heading: 'Budget layout', badge: 'Relayed live to Connect' })}
    ${entryStatus === 'ok' ? '<p class="status">Saved in Connect.</p>' : ''}
    ${entryStatus === 'error' ? `<p class="status status-error">Not saved: ${e(entryMessage || 'unknown error')}</p>` : ''}
    <p>This is how the Budget builder groups its lines. Rename a heading, move accounts between categories, rename an account for display, or give it a purpose tag. QuickBooks account numbers, names and groups are untouched.</p>
    <details class="panel panel-spaced"><summary>Category headings</summary>
      <form method="POST" action="/api/v1/connect-board-categories-write">
        <input type="hidden" name="form_kind" value="headings">
        <div class="grid form-grid">
          ${headingField('donor_wrapper_label', layout.donorWrapperLabel, DONOR_WRAPPER_DEFAULT_LABEL, 'Donor income wrapper')}
          ${BOARD_REVENUE_ORDER.map((k) => headingField(`label_revenue_${k}`, layout.revenueLabels[k], BOARD_REVENUE_DEFAULT_LABELS[k], `Revenue: ${BOARD_REVENUE_DEFAULT_LABELS[k]}`)).join('')}
          ${BOARD_EXPENSE_ORDER.map((k) => headingField(`label_expense_${k}`, layout.expenseLabels[k], BOARD_EXPENSE_DEFAULT_LABELS[k], `Expense: ${BOARD_EXPENSE_DEFAULT_LABELS[k]}`)).join('')}
        </div>
        <p><small>A blank heading goes back to its default name.</small></p>
        <button type="submit">Save headings</button>
      </form>
    </details>
    <form method="POST" action="/api/v1/connect-board-categories-write">
      <input type="hidden" name="form_kind" value="accounts">
      <div class="table-wrap"><table class="coa-layout"><thead><tr><th></th><th>Account (display name)</th><th>Board category</th><th>Purpose</th></tr></thead>
        <tbody>${side('Revenue', sections.revenue)}${side('Expenses', sections.expense)}</tbody></table></div>
      <div class="grid form-grid">
        <div class="field"><label for="coa-bulk">Move the selected accounts to</label><select id="coa-bulk" name="bulk_category">${bulkOptions}</select></div>
      </div>
      <p><small>Selected revenue accounts only move to a revenue category, and expense accounts to an expense category. “Automatic” places an account by its QuickBooks name.</small></p>
      <button type="submit">Save layout changes</button>
    </form>
  </section>`;
}

// Which fiscal year the chart shows: a plain GET form (the page runs no script), listing every
// year with ledger rows plus the one being shown.
function renderFiscalYearForm(fiscalYear, availableFiscalYears) {
  const years = [...new Set([fiscalYear, ...availableFiscalYears])].sort((a, b) => b - a);
  return `<form method="GET" action="/" class="inline-form" aria-label="Fiscal year">
    <input type="hidden" name="section" value="accounts"><input type="hidden" name="page" value="chart">
    <label for="coa-fiscal-year">Fiscal year</label>
    <select id="coa-fiscal-year" name="fiscal_year">${years.map((y) => `<option value="${y}"${y === fiscalYear ? ' selected' : ''}>FY${y}</option>`).join('')}</select>
    <button type="submit">Show</button>
  </form>`;
}

const money = (cents) => (cents === null || cents === undefined ? '—' : formatSignedCents(cents));

// The main table: legacy's two cards (Revenue, then Expenses), every board category in legacy's
// order with its accounts under it by display name, plus each account's and each category's year
// actual and budget. A category with no accounts still shows, as it does in legacy.
function renderChartTable(view, fiscalYear) {
  const e = escapeHtml;
  const fy = fiscalYear ? `FY${fiscalYear} ` : '';
  const figures = view.hasFigures;
  const amount = (cents, hasBudget = true) => `<td class="num">${figures && hasBudget ? money(cents) : '—'}</td>`;
  const leafRow = (leaf) => `<tr><td style="padding-left:1.95rem">${e(leaf.label)}<br><small>${leaf.label !== leaf.qbName ? `QuickBooks: ${e(leaf.qbName)} · ` : ''}${e(leaf.path)}${leaf.assigned ? '' : ' · automatic category'}</small></td>${amount(leaf.actualCents)}<td class="num">${leaf.budgetCents === null ? '—' : money(leaf.budgetCents)}</td><td>${leaf.purposeTagLabel ? e(leaf.purposeTagLabel) : '—'}</td></tr>`;
  const groupRows = (g) => `<tr><td style="padding-left:.85rem"><strong>${e(g.label)}</strong> <small>${g.items.length} account${g.items.length === 1 ? '' : 's'}</small></td>${amount(g.actualCents)}${amount(g.budgetCents, g.hasBudget)}<td></td></tr>${g.items.length
    ? g.items.map(leafRow).join('')
    : '<tr><td colspan="4" style="padding-left:1.95rem"><small>No accounts read under this category yet.</small></td></tr>'}`;
  const side = (title, totalLabel, s) => `<tr><td colspan="4"><strong>${title}</strong> <small>${s.count} account${s.count === 1 ? '' : 's'} · ${s.groups.length} categories</small></td></tr>${s.groups.map(groupRows).join('')}<tr><td><strong>${totalLabel}</strong></td>${amount(s.actualCents)}${amount(s.budgetCents, s.hasBudget)}<td></td></tr>`;
  return renderTable({
    head: ['Account', `${fy}Actual`, `${fy}Budget`, 'Purpose'],
    rows: side('Revenue', 'Total revenue', view.revenue) + side('Expenses', 'Total expenses', view.expense),
  }).replace(/<th>([^<]*(?:Actual|Budget))<\/th>/g, '<th class="num">$1</th>');
}

// Legacy finRenderPurposeReport: one row per saved purpose tag, with what is tagged under it. The
// payroll column is shown only when the viewer's role can read the Compensation plan.
function renderPurposeReport(purpose, fiscalYear, { payrollNote }) {
  const e = escapeHtml;
  const head = purpose.payrollAvailable
    ? ['Purpose', `Payroll (FY${fiscalYear + 1} plan)`, `Accounts (FY${fiscalYear} actual)`, 'Total', 'Tagged']
    : ['Purpose', `Accounts (FY${fiscalYear} actual)`, 'Tagged'];
  const rows = purpose.rows.map((r) => {
    const detail = [];
    if (r.workers.length) detail.push(`${r.workers.length} ${r.workers.length === 1 ? 'worker' : 'workers'}: ${r.workers.map(e).join(', ')}`);
    if (r.accounts.length) detail.push(`${r.accounts.length} ${r.accounts.length === 1 ? 'account' : 'accounts'}: ${r.accounts.map(e).join(', ')}`);
    const cells = purpose.payrollAvailable
      ? `<td class="num">${money(r.payrollCents)}</td><td class="num">${money(r.accountCents)}</td><td class="num"><strong>${money(r.totalCents)}</strong></td>`
      : `<td class="num">${money(r.accountCents)}</td>`;
    return `<tr><td><strong>${e(r.label)}</strong></td>${cells}<td><small>${detail.length ? detail.join(' · ') : 'Nothing tagged yet.'}</small></td></tr>`;
  }).join('');
  return `<section aria-label="Resources by Purpose">
    ${renderSectionHeading({ eyebrow: 'Chart of Accounts', heading: 'Resources by Purpose', badge: `FY${fiscalYear}` })}
    <p>Compensation workers and accounts tagged with a purpose, rolled up by purpose — a second view of the same dollars, alongside the board categories. An untagged worker or account does not appear here. A tagged account whose number matches a tagged worker's account is counted once, under the worker.</p>
    ${renderTable({ head, rows }).replace(/<th>((?:Payroll|Accounts|Total)[^<]*)<\/th>/g, '<th class="num">$1</th>')}
    ${payrollNote ? `<p><small>${e(payrollNote)}</small></p>` : ''}
  </section>`;
}

// Legacy's Resources by Purpose counts each tagged worker's full church cost from the Compensation
// plan (its raise projection for the year after the chart's year). `compensationProjection` is
// that projection when the viewer's role can read the plan and it could be built; otherwise the
// payroll column is left out and the note says why.
function purposePayroll(compensationProjection, canReadCompensation) {
  if (!canReadCompensation) {
    return { payroll: null, payrollNote: 'Payroll cost from the Compensation plan is shown only to roles that can open Compensation; the totals above are tagged accounts only.' };
  }
  if (!compensationProjection || !compensationProjection.ok) {
    return { payroll: null, payrollNote: 'The Compensation plan could not be read, so payroll cost is left out; the totals above are tagged accounts only.' };
  }
  const { model, computed } = compensationProjection;
  return { payroll: { roster: model.roster, computed, isExternallyFunded: model.isExternallyFunded }, payrollNote: '' };
}

export function renderAccountsPage(pageId, {
  accountsReport, canManageBoardCategories, boardCategoryEntryStatus, boardCategoryEntryMessage,
  canManagePurposeTags, purposeTagsEntryStatus, purposeTagsEntryMessage, boardLayout = null,
  compensationProjection = null, canReadCompensation = false,
}) {
  const isLive = accountsReport.source === 'live';
  const fiscalYear = isLive ? accountsReport.fiscalYear ?? null : null;
  const availableFiscalYears = accountsReport.availableFiscalYears || [];
  // The saved board layout when it could be read; otherwise the assignments, renames and tags the
  // chart rows themselves carry. Either way an account with no saved category shows the category
  // it is actually placed in (legacy's name-based default), marked automatic.
  const layout = boardLayout && isLive ? boardLayout : layoutFromChartRows(accountsReport.rows);
  const rows = accountsReport.rows.map((row) => {
    const isRevenue = isRevenueClassification(row.classification);
    const { key, assigned } = boardCategoryFor(layout, row.category_path, row.account_name, isRevenue);
    const label = boardLabelFor(layout, key, isRevenue);
    return { ...row, board_category_key: key, board_category_label: assigned ? label : `${label} (automatic)` };
  });
  const report = buildAccountsReportView(rows);
  const view = buildChartOfAccountsView(rows, layout);
  const usedCategories = [...view.revenue.groups, ...view.expense.groups].filter((g) => g.items.length).length;
  const { payroll, payrollNote } = purposePayroll(compensationProjection, canReadCompensation);
  const purpose = buildPurposeTotals(view, layout, payroll);
  const latestYear = availableFiscalYears.length ? Math.max(...availableFiscalYears) : null;
  const emptyYear = fiscalYear !== null && view.leaves.length === 0;
  return `<section class="report" aria-label="${isLive ? 'Chart of Accounts' : 'Synthetic Chart of Accounts'}">
    ${renderSectionHeading({ eyebrow: 'Chart of Accounts', heading: 'Account presentation', badge: isLive ? (fiscalYear ? `FY${fiscalYear} · live` : 'Live from Connect') : 'Synthetic staging' })}
    ${fiscalYear !== null ? renderFiscalYearForm(fiscalYear, availableFiscalYears) : ''}
    ${emptyYear ? `<p class="status status-pending">No ledger rows are on file for FY${fiscalYear} yet.${latestYear !== null && latestYear !== fiscalYear ? ` <a href="/?section=accounts&amp;page=chart&amp;fiscal_year=${latestYear}">Show FY${latestYear}</a>, the most recent year on file.` : ''}</p>` : ''}
    ${renderKpiCards([
      { label: 'Total accounts', value: String(view.leaves.length), hint: `${view.revenue.count} revenue · ${view.expense.count} expense` },
      ...(view.hasFigures ? [
        { label: `FY${fiscalYear} revenue`, value: escapeHtml(money(view.revenue.actualCents)), hint: 'Actual, accounts listed below' },
        { label: `FY${fiscalYear} expenses`, value: escapeHtml(money(view.expense.actualCents)), hint: 'Actual, accounts listed below' },
      ] : []),
      { label: 'Board categories', value: String(usedCategories), hint: 'Presentation only; ledger paths unchanged' },
      { label: 'Purpose tags', value: String(layout.tags.length), hint: 'Independent reporting lens over the same accounts' },
    ])}
    ${renderSectionHeading({ eyebrow: 'Chart of Accounts', heading: 'Accounts by board category', badge: 'Display names; QuickBooks unchanged' })}
    ${renderChartTable(view, fiscalYear)}
    ${view.unlistedRevenueCents || view.unlistedExpenseCents ? `<p><small>Posted directly to account groups rather than to an account, so not listed above (the Church Report includes it): ${escapeHtml(money(view.unlistedRevenueCents))} revenue, ${escapeHtml(money(view.unlistedExpenseCents))} expenses.</small></p>` : ''}
    <p><small>Income and Other Income accounts are revenue; Expenses, Other Expenses and Cost of Goods Sold accounts are expenses. As on Connect's Chart of Accounts, a line with no actual and no budget this year is left out, and an account with no saved category is placed by its QuickBooks name. Actuals are each account's own postings, not including sub-accounts.</small></p>
  </section>${layout.tags.length && fiscalYear !== null ? renderPurposeReport(purpose, fiscalYear, { payrollNote }) : ''}
  <section class="report" aria-label="Ledger hierarchy">
    ${renderSectionHeading({ eyebrow: 'Ledger hierarchy', heading: 'Account tree', badge: 'Paths preserved', trend: true })}
    ${renderTable({ head: ['Hierarchy', 'Ledger path', 'Account', 'Board category', 'Purpose'], rows: renderAccountHierarchy(report.hierarchy) })}
    <p><small>${isLive
      ? `Fetched live from Connect's finance-chart-of-accounts contract${fiscalYear ? ` for FY${fiscalYear}` : ''}: account names, ledger paths and each account's year totals. No gift, donor, or person crosses this contract.`
      : `The committed synthetic fixture (the live endpoint is not configured or did not answer${accountsReport.fallbackReason ? `: ${escapeHtml(accountsReport.fallbackReason)}` : ''}).`}</small></p>
  </section>${canManageBoardCategories && boardLayout && isLive
    ? renderLayoutEditor(report.rows, boardLayout, boardCategoryEntryStatus, boardCategoryEntryMessage)
    : (canManageBoardCategories ? renderBoardCategoryForm(boardCategoryEntryStatus, boardCategoryEntryMessage) : '')}${canManagePurposeTags
    ? renderPurposeTagsForms(boardLayout ? boardLayout.tags.map((t) => ({ id: t.id, label: t.label })) : deriveCurrentPurposeTags(report.rows), purposeTagsEntryStatus, purposeTagsEntryMessage, { listOnly: Boolean(boardLayout && isLive && canManageBoardCategories) })
    : ''}`;
}
