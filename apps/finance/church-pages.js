import { buildChurchReportView, buildLiveChurchReportView } from './church-report-service.js';
import { escapeHtml, formatCents, formatSignedCents, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';

export function renderChurchRows(rows) {
  return rows.map((row) => {
    const variance = row.classification === 'Income'
      ? row.own_actual_cents - row.own_budget_cents
      : row.own_budget_cents - row.own_actual_cents;
    return `<tr><td>${escapeHtml(row.classification)}</td><td>${escapeHtml(row.account_name)}</td><td>${formatCents(row.own_actual_cents)}</td><td>${formatCents(row.own_budget_cents)}</td><td>${formatSignedCents(variance)}</td></tr>`;
  }).join('');
}

// Live rows carry the contract's own camelCase shape (see church-report-service.js's
// buildLiveChurchReportView) and a genuinely nullable budgetCents -- real accounts commonly have an
// actual with no budget entered at all (confirmed 2026-09-14), unlike the synthetic fixture, which
// always has both. A null budget renders '--' rather than a fabricated $0 comparison.
export function renderLiveChurchRows(rows) {
  return rows.map((row) => {
    const hasBudget = row.budgetCents !== null;
    const variance = !hasBudget ? null : (row.classification === 'Income'
      ? row.actualCents - row.budgetCents
      : row.budgetCents - row.actualCents);
    return `<tr><td>${escapeHtml(row.classification)}</td><td>${escapeHtml(row.accountName)}</td><td>${formatCents(row.actualCents)}</td><td>${hasBudget ? formatCents(row.budgetCents) : '—'}</td><td>${variance === null ? '—' : formatSignedCents(variance)}</td></tr>`;
  }).join('');
}

export function renderChurchTrendRows(rows) {
  return rows.map((row) => `<tr><td>${row.fiscal_year}</td><td>${formatCents(row.income_cents)}</td><td>${formatCents(row.expense_cents)}</td><td>${formatSignedCents(row.net_cents)}</td></tr>`).join('');
}

// `churchReport` here is resolveChurchReport()'s result -- { source: 'live', fiscalYear, accounts,
// totals } or { source: 'synthetic-fallback', fallbackReason, rows } -- never the raw synthetic row
// array church-pages.js used to receive directly. 'trend' (multi-year) has no live equivalent yet
// and always reads churchTrends, the untouched synthetic reader -- out of scope for this contract,
// same as Health/Charts/Packet's own still-synthetic churchReport usage in shell.js.
export function renderChurchPage(pageId, { churchReport, churchTrends }) {
  if (pageId === 'trend') {
    return `<section class="report" aria-label="Synthetic Church Report multi-year trend">
      ${renderSectionHeading({ eyebrow: 'Church Report', heading: 'Multi-year operating trend', badge: 'Synthetic staging' })}
      ${renderTable({ head: ['Fiscal year', 'Income', 'Expenses', 'Net result'], rows: renderChurchTrendRows(churchTrends) })}
    </section>`;
  }

  const isLive = churchReport.source === 'live';
  const report = isLive
    ? buildLiveChurchReportView(churchReport.accounts, churchReport.fiscalYear, churchReport.totals)
    : buildChurchReportView(churchReport.rows);
  const variance = report.totals.actualNetCents - report.totals.budgetNetCents;
  const badge = isLive ? 'Live from Connect' : 'Synthetic staging';
  const rows = isLive ? renderLiveChurchRows([...report.income, ...report.expenses]) : renderChurchRows([...report.income, ...report.expenses]);
  const fallbackNote = isLive ? '' : `<p><small>The committed synthetic fixture (the live endpoint is not configured or did not answer${churchReport.fallbackReason ? `: ${escapeHtml(churchReport.fallbackReason)}` : ''}).</small></p>`;

  if (pageId === 'income-expense') {
    return `<section class="report" aria-label="Church Report income and expense detail">
      ${renderSectionHeading({ eyebrow: 'Church Report', heading: `Income &amp; expense detail · FY${report.fiscalYear}`, badge })}
      ${renderTable({ head: ['Classification', 'Account', 'Actual', 'Budget', 'Favorable variance'], rows })}
      ${fallbackNote}
    </section>`;
  }
  if (pageId === 'budget-actual') {
    return `<section class="report" aria-label="Church Report budget vs actual">
      ${renderSectionHeading({ eyebrow: 'Church Report', heading: `Budget vs actual · FY${report.fiscalYear}`, badge: variance >= 0 ? 'Favorable' : 'Unfavorable' })}
      ${renderKpiCards([
        { label: 'Actual net result', value: formatSignedCents(report.totals.actualNetCents) },
        { label: 'Budgeted net result', value: formatSignedCents(report.totals.budgetNetCents) },
        { label: 'Variance', value: formatSignedCents(variance), hint: variance >= 0 ? 'Ahead of budget' : 'Behind budget' },
      ])}
      ${renderTable({ head: ['Classification', 'Account', 'Actual', 'Budget', 'Favorable variance'], rows })}
      ${fallbackNote}
    </section>`;
  }
  // 'overview' (default)
  return `<section class="report" aria-label="Church Report overview">
    ${renderSectionHeading({ eyebrow: 'Church Report', heading: `Fiscal year ${report.fiscalYear}`, badge })}
    ${renderKpiCards([
      { label: 'Income', value: formatCents(report.totals.incomeActualCents) },
      { label: 'Expenses', value: formatCents(report.totals.expenseActualCents) },
      { label: 'Net result', value: formatSignedCents(report.totals.actualNetCents), hint: `Budget ${formatSignedCents(report.totals.budgetNetCents)} · variance ${formatSignedCents(variance)}` },
    ])}
    <p>See Income &amp; expense detail, Multi-year trend, and Budget vs actual for the full breakdown behind these totals.</p>
    ${fallbackNote}
  </section>`;
}
