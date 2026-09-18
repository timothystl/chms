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

// Single-entry write -- relayed live to Connect's real finance_daycare_entries table (see
// finance-daycare-entry-v1 in src/api-contracts-service.js), never stored in Finance's own
// database. The legacy in-Connect route has no role check beyond edit permission on any of
// finance/budget/compensation (not admin-only, unlike Budget's generate/commit/remove), so this
// is shown to any verified viewer who can reach the Daycare section at all -- UI hiding is never
// authorization, the real gate is the relay contract's own permission check on Connect's side.
function renderDaycareEntryForm(period, entryStatus, entryMessage) {
  return `<section aria-label="Record a Daycare Report entry">
    ${renderSectionHeading({ eyebrow: 'Daycare Report', heading: 'Record an entry', badge: 'Relayed live to Connect' })}
    ${entryStatus === 'ok' ? '<p class="status">Saved in Connect.</p>' : ''}
    ${entryStatus === 'error' ? `<p class="status status-error">Not saved: ${escapeHtml(entryMessage || 'unknown error')}</p>` : ''}
    <form method="POST" action="/api/v1/connect-daycare-entry">
      <div class="grid form-grid">
        <div class="field"><label for="dc-period">Period (YYYY or YYYY-MM)</label><input id="dc-period" type="text" name="period" pattern="\\d{4}(-\\d{2})?" placeholder="${escapeHtml(String(period))}" value="${escapeHtml(String(period))}" required></div>
        <div class="field"><label for="dc-category">Category</label><input id="dc-category" type="text" name="category" required></div>
        <div class="field"><label for="dc-type">Type</label><select id="dc-type" name="entry_type"><option value="actual" selected>Actual</option><option value="budget">Budget</option></select></div>
        <div class="field"><label for="dc-amount">Amount ($, whole dollars)</label><input id="dc-amount" type="number" name="amount" step="1" min="0" required></div>
      </div>
      <div class="field"><label for="dc-notes">Notes</label><input id="dc-notes" type="text" name="notes" placeholder="optional"></div>
      <button type="submit">Record entry</button>
    </form>
    <p><small>This writes directly into Connect's own <code>finance_daycare_entries</code> table -- the same table the legacy in-Connect Daycare Report edits. Finance never stores a copy. Connect independently re-verifies your identity and edit permission for every request.</small></p>
  </section>`;
}

// `daycareReport` here is resolveDaycareReport()'s result -- { source: 'live', fiscalYear,
// categories, allocation, totals } or { source: 'synthetic-fallback', fallbackReason, rows,
// allocation } -- never the raw synthetic row array daycare-pages.js used to receive directly.
export function renderDaycarePage(pageId, { daycareReport, canRecordDaycareEntry, daycareEntryStatus, daycareEntryMessage }) {
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
    </section>${canRecordDaycareEntry ? renderDaycareEntryForm(report.period, daycareEntryStatus, daycareEntryMessage) : ''}`;
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
