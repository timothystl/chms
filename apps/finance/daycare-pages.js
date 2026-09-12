import { buildDaycareReportView } from './daycare-report-service.js';
import { escapeHtml, formatCents, formatSignedCents, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';

export function renderDaycareRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.classification)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.entry_type)}</td><td>${formatCents(row.amount_cents)}</td></tr>`).join('');
}

export function renderDaycarePage(pageId, { daycareReport, daycareAllocation }) {
  const report = buildDaycareReportView(daycareReport, daycareAllocation);
  const variance = report.totals.netActualCents - report.totals.netBudgetCents;

  if (pageId === 'actuals') {
    return `<section class="report" aria-label="Synthetic Daycare Report actuals detail">
      ${renderSectionHeading({ eyebrow: 'Daycare Report', heading: `Actuals detail · ${escapeHtml(report.period)}`, badge: 'Synthetic staging' })}
      ${renderTable({ head: ['Classification', 'Category', 'Type', 'Amount'], rows: renderDaycareRows(report.categories) })}
    </section>`;
  }
  if (pageId === 'budget-comparison') {
    return `<section class="report" aria-label="Synthetic Daycare Report budget comparison">
      ${renderSectionHeading({ eyebrow: 'Daycare Report', heading: `Budget comparison · ${escapeHtml(report.period)}`, badge: variance >= 0 ? 'Favorable' : 'Unfavorable' })}
      ${renderKpiCards([
        { label: 'Tuition income', value: formatCents(report.totals.incomeActualCents), hint: `Budget ${formatCents(report.totals.incomeBudgetCents)}` },
        { label: 'Operating expenses', value: formatCents(report.totals.expenseActualCents), hint: `Budget ${formatCents(report.totals.expenseBudgetCents)}` },
        { label: 'Operating result', value: formatSignedCents(report.totals.netActualCents), hint: `Budget ${formatSignedCents(report.totals.netBudgetCents)} · variance ${formatSignedCents(variance)}` },
      ])}
    </section>`;
  }
  if (pageId === 'shared-costs') {
    return `<section class="report" aria-label="Synthetic Daycare Report shared costs">
      ${renderSectionHeading({ eyebrow: 'Daycare Report', heading: 'Utilities and insurance allocation', badge: `${(daycareAllocation.utility_pct * 100).toFixed(0)}% utilities · ${(daycareAllocation.insurance_pct * 100).toFixed(0)}% insurance` })}
      ${renderKpiCards([
        { label: 'Church utilities actual', value: formatCents(daycareAllocation.utility_source_cents), hint: `Daycare share ${formatCents(daycareAllocation.utility_allocated_cents)}` },
        { label: 'Church insurance actual', value: formatCents(daycareAllocation.insurance_source_cents), hint: `Daycare share ${formatCents(daycareAllocation.insurance_allocated_cents)}` },
      ])}
    </section>`;
  }
  // 'overview' (default)
  return `<section class="report" aria-label="Synthetic Daycare Report overview">
    ${renderSectionHeading({ eyebrow: 'Daycare Report', heading: `Operating report for ${escapeHtml(report.period)}`, badge: 'Synthetic staging' })}
    ${renderKpiCards([
      { label: 'Tuition income', value: formatCents(report.totals.incomeActualCents), hint: `Budget ${formatCents(report.totals.incomeBudgetCents)}` },
      { label: 'Operating expenses', value: formatCents(report.totals.expenseActualCents), hint: `Budget ${formatCents(report.totals.expenseBudgetCents)}` },
      { label: 'Operating result', value: formatSignedCents(report.totals.netActualCents), hint: `Budget ${formatSignedCents(report.totals.netBudgetCents)} · variance ${formatSignedCents(variance)}` },
    ])}
    <p>See Actuals detail, Budget comparison, and Shared costs for the full breakdown behind these totals.</p>
  </section>`;
}
