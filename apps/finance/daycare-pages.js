import { buildDaycareReportView, buildLiveDaycareReportView } from './daycare-report-service.js';
import { escapeHtml, formatCents, formatSignedCents, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';

export function renderDaycareRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.classification)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.entry_type)}</td><td>${formatCents(row.amount_cents)}</td></tr>`).join('');
}

// Live categories carry the contract's own camelCase shape (see daycare-report-service.js's
// buildLiveDaycareReportView) -- one row per category with both actualCents and budgetCents already
// combined, unlike the synthetic fixture's separate actual/budget rows per category.
export function renderLiveDaycareRows(categories) {
  return categories.map((c) => `<tr><td>${escapeHtml(c.classification)}</td><td>${escapeHtml(c.category)}</td><td>${formatCents(c.actualCents)}</td><td>${formatCents(c.budgetCents)}</td></tr>`).join('');
}

// `daycareReport` here is resolveDaycareReport()'s result -- { source: 'live', fiscalYear,
// categories, allocation, totals } or { source: 'synthetic-fallback', fallbackReason, rows,
// allocation } -- never the raw synthetic row array daycare-pages.js used to receive directly.
export function renderDaycarePage(pageId, { daycareReport }) {
  const isLive = daycareReport.source === 'live';
  const report = isLive
    ? buildLiveDaycareReportView(daycareReport.categories, daycareReport.fiscalYear, daycareReport.totals)
    : buildDaycareReportView(daycareReport.rows, daycareReport.allocation);
  const allocation = daycareReport.allocation;
  const variance = report.totals.netActualCents - report.totals.netBudgetCents;
  const badge = isLive ? 'Live from Connect' : 'Synthetic staging';
  const rows = isLive ? renderLiveDaycareRows(report.categories) : renderDaycareRows(report.categories);
  const fallbackNote = isLive ? '' : `<p><small>The committed synthetic fixture (the live endpoint is not configured or did not answer${daycareReport.fallbackReason ? `: ${escapeHtml(daycareReport.fallbackReason)}` : ''}).</small></p>`;

  if (pageId === 'actuals') {
    return `<section class="report" aria-label="Daycare Report actuals detail">
      ${renderSectionHeading({ eyebrow: 'Daycare Report', heading: `Actuals detail · ${escapeHtml(report.period)}`, badge })}
      ${isLive
        ? renderTable({ head: ['Classification', 'Category', 'Actual', 'Budget'], rows })
        : renderTable({ head: ['Classification', 'Category', 'Type', 'Amount'], rows })}
      ${fallbackNote}
    </section>`;
  }
  if (pageId === 'budget-comparison') {
    return `<section class="report" aria-label="Daycare Report budget comparison">
      ${renderSectionHeading({ eyebrow: 'Daycare Report', heading: `Budget comparison · ${escapeHtml(report.period)}`, badge: variance >= 0 ? 'Favorable' : 'Unfavorable' })}
      ${renderKpiCards([
        { label: 'Tuition income', value: formatCents(report.totals.incomeActualCents), hint: `Budget ${formatCents(report.totals.incomeBudgetCents)}` },
        { label: 'Operating expenses', value: formatCents(report.totals.expenseActualCents), hint: `Budget ${formatCents(report.totals.expenseBudgetCents)}` },
        { label: 'Operating result', value: formatSignedCents(report.totals.netActualCents), hint: `Budget ${formatSignedCents(report.totals.netBudgetCents)} · variance ${formatSignedCents(variance)}` },
      ])}
      ${fallbackNote}
    </section>`;
  }
  if (pageId === 'shared-costs') {
    const utilityPct = isLive ? allocation.utilityPct : allocation.utility_pct;
    const insurancePct = isLive ? allocation.insurancePct : allocation.insurance_pct;
    const utilitySourceCents = isLive ? allocation.churchUtilityActualCents : allocation.utility_source_cents;
    const insuranceSourceCents = isLive ? allocation.churchInsuranceActualCents : allocation.insurance_source_cents;
    const utilityAllocatedCents = isLive ? allocation.mdoUtilityCents : allocation.utility_allocated_cents;
    const insuranceAllocatedCents = isLive ? allocation.mdoInsuranceCents : allocation.insurance_allocated_cents;
    return `<section class="report" aria-label="Daycare Report shared costs">
      ${renderSectionHeading({ eyebrow: 'Daycare Report', heading: 'Utilities and insurance allocation', badge: `${(utilityPct * 100).toFixed(0)}% utilities · ${(insurancePct * 100).toFixed(0)}% insurance` })}
      ${renderKpiCards([
        { label: 'Church utilities actual', value: formatCents(utilitySourceCents), hint: `Daycare share ${formatCents(utilityAllocatedCents)}` },
        { label: 'Church insurance actual', value: formatCents(insuranceSourceCents), hint: `Daycare share ${formatCents(insuranceAllocatedCents)}` },
      ])}
      ${fallbackNote}
    </section>`;
  }
  // 'overview' (default)
  return `<section class="report" aria-label="Daycare Report overview">
    ${renderSectionHeading({ eyebrow: 'Daycare Report', heading: `Operating report for ${escapeHtml(report.period)}`, badge })}
    ${renderKpiCards([
      { label: 'Tuition income', value: formatCents(report.totals.incomeActualCents), hint: `Budget ${formatCents(report.totals.incomeBudgetCents)}` },
      { label: 'Operating expenses', value: formatCents(report.totals.expenseActualCents), hint: `Budget ${formatCents(report.totals.expenseBudgetCents)}` },
      { label: 'Operating result', value: formatSignedCents(report.totals.netActualCents), hint: `Budget ${formatSignedCents(report.totals.netBudgetCents)} · variance ${formatSignedCents(variance)}` },
    ])}
    <p>See Actuals detail, Budget comparison, and Shared costs for the full breakdown behind these totals.</p>
    ${fallbackNote}
  </section>`;
}
