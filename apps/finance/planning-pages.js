import { buildBudgetReportView } from './budget-report-service.js';
import { escapeHtml, formatCents, formatSignedCents, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';

export function renderBudgetRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.classification)}</td><td>${escapeHtml(row.category)}</td><td>${formatCents(row.base_amount_cents)}</td><td>${(row.growth_pct * 100).toFixed(1)}%</td><td>${formatCents(row.planned_amount_cents)}</td><td>${formatSignedCents(row.changeCents)}</td><td>${escapeHtml(row.notes)}</td></tr>`).join('');
}

export function renderPlanningPage(pageId, { budgetReport }) {
  if (pageId === 'compensation-link') {
    return `<section class="report" aria-label="Planning compensation link">
      ${renderSectionHeading({ eyebrow: 'Planning', heading: 'Compensation planning', badge: 'See Compensation' })}
      <p>Compensation planning (salary plan, benefits &amp; taxes, benchmarks, and the council snapshot) lives in its own <a href="/?section=compensation">Compensation</a> workspace, since it has its own <code>compensation</code> permission separate from Budget.</p>
    </section>`;
  }
  // 'builder' (default)
  const report = buildBudgetReportView(budgetReport);
  return `<section class="report" aria-label="Synthetic Budget Report">
    ${renderSectionHeading({ eyebrow: 'Budget builder', heading: `Plan for fiscal year ${report.fiscalYear}`, badge: 'Synthetic staging' })}
    ${renderKpiCards([
      { label: 'Base result', value: formatSignedCents(report.totals.baseNetCents), hint: `Income ${formatCents(report.totals.baseIncomeCents)} · expenses ${formatCents(report.totals.baseExpenseCents)}` },
      { label: 'Planned result', value: formatSignedCents(report.totals.plannedNetCents), hint: `Income ${formatCents(report.totals.plannedIncomeCents)} · expenses ${formatCents(report.totals.plannedExpenseCents)}` },
      { label: 'Outlook change', value: formatSignedCents(report.totals.netChangeCents), hint: `${report.totals.reconciled ? 'Planned totals reconcile' : 'Review required'} · read-only preview` },
    ])}
    ${renderTable({ head: ['Classification', 'Category', 'Base amount', 'Growth', 'Planned amount', 'Change', 'Notes'], rows: renderBudgetRows(report.rows) })}
  </section>`;
}
