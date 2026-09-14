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

export function renderPlanningPage(pageId, { budgetReport }) {
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
  </section>`;
}
