import { buildBudgetReportView, buildLiveBudgetReportView } from './budget-report-service.js';
import { escapeHtml, formatCents, formatSignedCents, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';

export function renderBudgetRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.classification)}</td><td>${escapeHtml(row.category)}</td><td>${formatCents(row.base_amount_cents)}</td><td>${(row.growth_pct * 100).toFixed(1)}%</td><td>${formatCents(row.planned_amount_cents)}</td><td>${formatSignedCents(row.changeCents)}</td><td>${escapeHtml(row.notes)}</td></tr>`).join('');
}

// Live rows carry the contract's own camelCase shape (see budget-report-service.js's
// buildLiveBudgetReportView) rather than the synthetic reader's snake_case row shape -- the two
// are not equivalent for Budget the way they are for Chart of Accounts, since real categories can
// be basis 'manual' with no base/growth at all. A category without a growth basis renders '--' in
// those cells rather than a fabricated 0%/$0 comparison.
export function renderLiveBudgetRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.classification)}</td><td>${escapeHtml(row.category)}</td><td>${row.hasBasis ? formatCents(row.baseAmountCents) : '—'}</td><td>${row.hasBasis ? `${(row.growthPct * 100).toFixed(1)}%` : '—'}</td><td>${formatCents(row.plannedAmountCents)}</td><td>${row.changeCents === null ? '—' : formatSignedCents(row.changeCents)}</td><td>${escapeHtml(row.basis === 'grown' ? 'Grown from base' : 'Manual entry')}</td><td>${escapeHtml(row.notes)}</td></tr>`).join('');
}

// Manual edit/save for one category+fiscal-year row -- relayed live to Connect's real
// finance_budget_plan table (see finance-budget-write-v1 in src/api-contracts-service.js), never
// stored in Finance's own database. Deliberately scoped to one row per submit, matching Gift
// Entry's own single-entry form (gift-entry-pages.js) rather than an inline-editable whole table;
// re-submitting the same category and fiscal year upserts that row, same as the legacy in-Connect
// Budget Planner. Shown regardless of whether the table above rendered live or synthetic-fallback
// data -- the write itself always goes live, independent of what this particular page load's read
// happened to return.
function renderBudgetEditForm(fiscalYear, budgetEntryStatus, budgetEntryMessage) {
  return `<section aria-label="Edit a Budget Plan category">
    ${renderSectionHeading({ eyebrow: 'Budget builder', heading: 'Edit a category', badge: 'Relayed live to Connect' })}
    ${budgetEntryStatus === 'ok' ? '<p class="status">Saved in Connect.</p>' : ''}
    ${budgetEntryStatus === 'error' ? `<p class="status status-error">Not saved: ${escapeHtml(budgetEntryMessage || 'unknown error')}</p>` : ''}
    <form method="POST" action="/api/v1/connect-budget-plan-write">
      <div class="grid form-grid">
        <div class="field"><label for="bp-category">Category</label><input id="bp-category" type="text" name="category" placeholder="e.g. Expenses:Utilities" required></div>
        <div class="field"><label for="bp-classification">Classification</label><select id="bp-classification" name="classification"><option value="Expenses" selected>Expenses</option><option value="Income">Income</option></select></div>
        <div class="field"><label for="bp-year">Fiscal year</label><input id="bp-year" type="number" name="fiscal_year" min="2000" max="2100" value="${escapeHtml(String(fiscalYear))}" required></div>
        <div class="field"><label for="bp-amount">Planned amount ($, whole dollars)</label><input id="bp-amount" type="number" name="planned_amount" step="1" min="0" placeholder="0" required></div>
      </div>
      <div class="field"><label for="bp-notes">Notes</label><input id="bp-notes" type="text" name="notes" placeholder="optional"></div>
      <button type="submit">Save category</button>
    </form>
    <p>This writes directly into Connect's own <code>finance_budget_plan</code> table — the same table the legacy in-Connect Budget Planner edits, using its exact same validation and upsert behavior (re-saving the same category and fiscal year replaces that row rather than adding a second one). Finance never stores a copy. Only Connect's own admin and council roles may save; Connect independently re-verifies your identity and role for every request.</p>
  </section>`;
}

export function renderPlanningPage(pageId, { budgetReport, canEditBudget, budgetEntryStatus, budgetEntryMessage }) {
  if (pageId === 'compensation-link') {
    return `<section class="report" aria-label="Planning compensation link">
      ${renderSectionHeading({ eyebrow: 'Planning', heading: 'Compensation planning', badge: 'See Compensation' })}
      <p>Compensation planning (salary plan, benefits &amp; taxes, benchmarks, and the council snapshot) lives in its own <a href="/?section=compensation">Compensation</a> workspace, since it has its own <code>compensation</code> permission separate from Budget.</p>
    </section>`;
  }
  // 'builder' (default)
  const isLive = budgetReport.source === 'live';
  if (isLive) {
    const view = buildLiveBudgetReportView(budgetReport.categories, budgetReport.fiscalYear);
    return `<section class="report" aria-label="Budget Plan">
      ${renderSectionHeading({ eyebrow: 'Budget builder', heading: `Plan for fiscal year ${view.fiscalYear}`, badge: 'Live from Connect' })}
      ${renderKpiCards([
        { label: 'Planned result', value: formatSignedCents(view.totals.plannedNetCents), hint: `Income ${formatCents(view.totals.plannedIncomeCents)} · expenses ${formatCents(view.totals.plannedExpenseCents)}` },
        { label: 'Categories planned', value: String(view.counts.categoryCount), hint: `${view.counts.grownCount} grown from a base · ${view.counts.manualCount} manually entered` },
      ])}
      ${renderTable({ head: ['Classification', 'Category', 'Base amount', 'Growth', 'Planned amount', 'Change', 'Basis', 'Notes'], rows: renderLiveBudgetRows(view.rows) })}
      <p><small>Fetched live from Connect's real, structural finance_budget_plan table via the finance-budget contract. ${view.counts.categoryCount === 0 ? `No plan exists yet for fiscal year ${view.fiscalYear}.` : `Base amount and growth only show for categories generated from a growth rate ('grown') -- most of today's real plan was entered directly ('manual') and has no base to compare against.`}</small></p>
      ${canEditBudget ? renderBudgetEditForm(view.fiscalYear, budgetEntryStatus, budgetEntryMessage) : ''}
    </section>`;
  }
  const report = buildBudgetReportView(budgetReport.rows);
  return `<section class="report" aria-label="Synthetic Budget Report">
    ${renderSectionHeading({ eyebrow: 'Budget builder', heading: `Plan for fiscal year ${report.fiscalYear}`, badge: 'Synthetic staging' })}
    ${renderKpiCards([
      { label: 'Base result', value: formatSignedCents(report.totals.baseNetCents), hint: `Income ${formatCents(report.totals.baseIncomeCents)} · expenses ${formatCents(report.totals.baseExpenseCents)}` },
      { label: 'Planned result', value: formatSignedCents(report.totals.plannedNetCents), hint: `Income ${formatCents(report.totals.plannedIncomeCents)} · expenses ${formatCents(report.totals.plannedExpenseCents)}` },
      { label: 'Outlook change', value: formatSignedCents(report.totals.netChangeCents), hint: `${report.totals.reconciled ? 'Planned totals reconcile' : 'Review required'} · read-only preview` },
    ])}
    ${renderTable({ head: ['Classification', 'Category', 'Base amount', 'Growth', 'Planned amount', 'Change', 'Notes'], rows: renderBudgetRows(report.rows) })}
    <p><small>The committed synthetic fixture (the live endpoint is not configured or did not answer${budgetReport.fallbackReason ? `: ${escapeHtml(budgetReport.fallbackReason)}` : ''}).</small></p>
    ${canEditBudget ? renderBudgetEditForm(report.fiscalYear, budgetEntryStatus, budgetEntryMessage) : ''}
  </section>`;
}
