import { buildChurchReportView } from './church-report-service.js';
import { escapeHtml, formatCents, formatSignedCents, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';

export function renderChurchRows(rows) {
  return rows.map((row) => {
    const variance = row.classification === 'Income'
      ? row.own_actual_cents - row.own_budget_cents
      : row.own_budget_cents - row.own_actual_cents;
    return `<tr><td>${escapeHtml(row.classification)}</td><td>${escapeHtml(row.account_name)}</td><td>${formatCents(row.own_actual_cents)}</td><td>${formatCents(row.own_budget_cents)}</td><td>${formatSignedCents(variance)}</td></tr>`;
  }).join('');
}

export function renderChurchTrendRows(rows) {
  return rows.map((row) => `<tr><td>${row.fiscal_year}</td><td>${formatCents(row.income_cents)}</td><td>${formatCents(row.expense_cents)}</td><td>${formatSignedCents(row.net_cents)}</td></tr>`).join('');
}

export function renderChurchPage(pageId, { churchReport, churchTrends }) {
  const report = buildChurchReportView(churchReport);
  const variance = report.totals.actualNetCents - report.totals.budgetNetCents;

  if (pageId === 'income-expense') {
    return `<section class="report" aria-label="Synthetic Church Report income and expense detail">
      ${renderSectionHeading({ eyebrow: 'Church Report', heading: `Income &amp; expense detail · FY${report.fiscalYear}`, badge: 'Synthetic staging' })}
      ${renderTable({ head: ['Classification', 'Account', 'Actual', 'Budget', 'Favorable variance'], rows: renderChurchRows([...report.income, ...report.expenses]) })}
    </section>`;
  }
  if (pageId === 'trend') {
    return `<section class="report" aria-label="Synthetic Church Report multi-year trend">
      ${renderSectionHeading({ eyebrow: 'Church Report', heading: 'Multi-year operating trend', badge: 'Synthetic staging' })}
      ${renderTable({ head: ['Fiscal year', 'Income', 'Expenses', 'Net result'], rows: renderChurchTrendRows(churchTrends) })}
    </section>`;
  }
  if (pageId === 'budget-actual') {
    return `<section class="report" aria-label="Synthetic Church Report budget vs actual">
      ${renderSectionHeading({ eyebrow: 'Church Report', heading: `Budget vs actual · FY${report.fiscalYear}`, badge: variance >= 0 ? 'Favorable' : 'Unfavorable' })}
      ${renderKpiCards([
        { label: 'Actual net result', value: formatSignedCents(report.totals.actualNetCents) },
        { label: 'Budgeted net result', value: formatSignedCents(report.totals.budgetNetCents) },
        { label: 'Variance', value: formatSignedCents(variance), hint: variance >= 0 ? 'Ahead of budget' : 'Behind budget' },
      ])}
      ${renderTable({ head: ['Classification', 'Account', 'Actual', 'Budget', 'Favorable variance'], rows: renderChurchRows([...report.income, ...report.expenses]) })}
    </section>`;
  }
  // 'overview' (default)
  return `<section class="report" aria-label="Synthetic Church Report overview">
    ${renderSectionHeading({ eyebrow: 'Church Report', heading: `Fiscal year ${report.fiscalYear}`, badge: 'Synthetic staging' })}
    ${renderKpiCards([
      { label: 'Income', value: formatCents(report.totals.incomeActualCents) },
      { label: 'Expenses', value: formatCents(report.totals.expenseActualCents) },
      { label: 'Net result', value: formatSignedCents(report.totals.actualNetCents), hint: `Budget ${formatSignedCents(report.totals.budgetNetCents)} · variance ${formatSignedCents(variance)}` },
    ])}
    <p>See Income &amp; expense detail, Multi-year trend, and Budget vs actual for the full breakdown behind these totals.</p>
  </section>`;
}
