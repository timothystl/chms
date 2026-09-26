import { escapeHtml, formatCents, renderSectionHeading, renderTable } from './render-helpers.js';

function statusLine(status, message, success) {
  if (status === 'ok') return `<p class="status status-ok">${escapeHtml(success)}</p>`;
  if (status === 'error') return `<p class="status status-error">Not saved: ${escapeHtml(message || 'the request did not complete.')}</p>`;
  return '';
}

function select(name, label, selected, options) {
  return `<select name="${name}" aria-label="Classification for ${escapeHtml(label)}">${options.map((option) => `<option value="${escapeHtml(option.key)}"${option.key === selected ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>`;
}

export function renderClassificationEditors(result, { canManage = false, revenueStatus = null, revenueMessage = null, expenseStatus = null, expenseMessage = null } = {}) {
  if (!result?.ok) return `<section class="report" aria-label="Classification settings unavailable">${renderSectionHeading({ eyebrow: 'Data & Imports', heading: 'Classification & policy', badge: 'Unavailable' })}<p class="status status-pending">The live classification settings could not be read. Existing reports are unaffected.</p></section>`;
  const data = result.classification;
  const revenueRows = data.revenueStreams.groups.map((group) => `<tr><td>${escapeHtml(group.label)}${group.mapped ? '' : ' <small>(guessed)</small>'}</td><td>${formatCents(group.actualCents)}</td><td>${canManage ? `<input type="hidden" name="label" value="${escapeHtml(group.label)}">${select('stream', group.label, group.stream, data.revenueStreams.options)}` : escapeHtml(data.revenueStreams.options.find((option) => option.key === group.stream)?.label || group.stream)}</td></tr>`).join('');
  const expenseRows = data.expenseCategories.groups.map((group) => `<tr><td>${escapeHtml(group.label)}${group.mapped ? '' : ' <small>(guessed)</small>'}</td><td>${formatCents(group.actualCents)}</td><td>${canManage ? `<input type="hidden" name="label" value="${escapeHtml(group.label)}">${select('key', group.label, group.key, data.expenseCategories.options)}` : escapeHtml(data.expenseCategories.options.find((option) => option.key === group.key)?.label || group.key)}</td></tr>`).join('');
  const table = (head, rows) => renderTable({ head, rows: rows || '<tr><td colspan="3">No matching account groups are on file for this year.</td></tr>' });
  return `<section class="report" aria-label="Revenue stream classification">
    ${renderSectionHeading({ eyebrow: 'Classification & policy', heading: `Revenue streams · FY${data.fiscalYear}`, badge: `${data.revenueStreams.groups.filter((group) => !group.mapped).length} guessed` })}
    ${statusLine(revenueStatus, revenueMessage, 'Revenue-stream classification saved in Connect.')}
    <p><small>Guessed groups use name-based defaults until an administrator confirms them.</small></p>
    ${canManage ? `<form method="POST" action="/api/v1/connect-revenue-streams-write">${table(['Account group', 'Actual', 'Revenue stream'], revenueRows)}${revenueRows ? '<button type="submit">Save classification</button>' : ''}</form>` : table(['Account group', 'Actual', 'Revenue stream'], revenueRows)}
  </section>
  <section class="report" aria-label="Expense category mapping">
    ${renderSectionHeading({ eyebrow: 'Classification & policy', heading: `Expense categories · FY${data.fiscalYear}`, badge: `${data.expenseCategories.groups.filter((group) => !group.mapped).length} guessed` })}
    ${statusLine(expenseStatus, expenseMessage, 'Expense-category mapping saved in Connect.')}
    <p><small>These are the board-facing categories used by the money-flow view.</small></p>
    ${canManage ? `<form method="POST" action="/api/v1/connect-flow-expense-map-write">${table(['Account group', 'Actual', 'Expense category'], expenseRows)}${expenseRows ? '<button type="submit">Save mapping</button>' : ''}</form>` : table(['Account group', 'Actual', 'Expense category'], expenseRows)}
  </section>`;
}
