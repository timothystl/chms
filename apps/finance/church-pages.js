import { buildChurchReportView, buildLiveChurchReportView } from './church-report-service.js';
import { escapeHtml, formatCents, formatSignedCents, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';

// Admin-only correction of one account's real, posted actual figure -- relayed live to Connect's
// finance_church_entries table (see finance-church-actual-override-v1 in
// src/api-contracts-service.js), never stored in Finance's own database. Shown only on Income &
// expense detail, the one page with the per-account rows a correction targets; Overview/Multi-year
// trend/Budget vs actual stay read-only summaries of the same underlying data. Leaving Amount blank
// clears a prior correction back to whatever the last real sync/import posted for that account,
// matching the legacy route's own delete-on-blank behavior.
function renderChurchActualOverrideForm(fiscalYear, entryStatus, entryMessage) {
  return `<section aria-label="Correct a Church Report actual figure">
    ${renderSectionHeading({ eyebrow: 'Church Report', heading: 'Correct an actual figure', badge: 'Relayed live to Connect' })}
    ${entryStatus === 'ok' ? '<p class="status">Saved in Connect.</p>' : ''}
    ${entryStatus === 'error' ? `<p class="status status-error">Not saved: ${escapeHtml(entryMessage || 'unknown error')}</p>` : ''}
    <form method="POST" action="/api/v1/connect-church-actual-override">
      <div class="grid form-grid">
        <div class="field"><label for="cao-year">Fiscal year</label><input id="cao-year" type="number" name="year" min="2000" max="2100" value="${escapeHtml(String(fiscalYear))}" required></div>
        <div class="field"><label for="cao-category">Account (category path)</label><input id="cao-category" type="text" name="category" placeholder="e.g. Expenses:Utilities" required></div>
        <div class="field"><label for="cao-classification">Classification</label><select id="cao-classification" name="classification"><option value="Expenses" selected>Expenses</option><option value="Income">Income</option><option value="Cost of Goods Sold">Cost of Goods Sold</option><option value="Other Income">Other Income</option><option value="Other Expenses">Other Expenses</option></select></div>
        <div class="field"><label for="cao-name">Account name</label><input id="cao-name" type="text" name="account_name" placeholder="optional -- defaults from the category path"></div>
        <div class="field"><label for="cao-amount">Corrected actual ($, blank clears a prior correction)</label><input id="cao-amount" type="number" name="amount" step="0.01"></div>
      </div>
      <button type="submit">Save correction</button>
    </form>
    <p><small>This writes directly into Connect's own <code>finance_church_entries</code> table as a manual correction that takes precedence over whatever the last QuickBooks sync or CSV import posted for this exact account -- every reader (Church Report, Financial Health, Planning) picks it up, and a later re-sync/re-import does not erase it. Only Connect's own admin role may save; Connect independently re-verifies your identity and role for every request.</small></p>
  </section>`;
}

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

// Live trend rows carry the connect.finance-church-report-trend.v1 contract's own camelCase shape
// (see church-report-service.js's resolveChurchTrend) -- fiscalYear/incomeActualCents/
// expenseActualCents/netIncomeActualCents, the same full bottom-line netIncomeActualCents
// definition the single-year contract's own totals use (folds in Cost of Goods Sold and Other
// Income/Expenses), NOT a naive income-minus-expense figure. This matches production's own
// existing multi-year trend chart/table (src/frontend/js-finance.js's finRenderChurchMultiYear),
// which never shows a budget column here either -- actual-only, same as this render.
export function renderLiveChurchTrendRows(years) {
  return years.map((row) => `<tr><td>${row.fiscalYear}</td><td>${formatCents(row.incomeActualCents)}</td><td>${formatCents(row.expenseActualCents)}</td><td>${formatSignedCents(row.netIncomeActualCents)}</td></tr>`).join('');
}

// `churchReport` here is resolveChurchReport()'s result -- { source: 'live', fiscalYear, accounts,
// totals } or { source: 'synthetic-fallback', fallbackReason, rows } -- never the raw synthetic row
// array church-pages.js used to receive directly. `churchTrendLive` is resolveChurchTrend()'s
// result in the same two shapes -- { source: 'live', years } or { source: 'synthetic-fallback',
// fallbackReason, rows } -- for the 'trend' (multi-year) page specifically. Health/Charts/Packet's
// own still-synthetic churchReport/churchTrends usage in shell.js is untouched, out of scope for
// this contract.
export function renderChurchPage(pageId, { churchReport, churchTrendLive, canManageChurchReport, churchOverrideStatus, churchOverrideMessage }) {
  if (pageId === 'trend') {
    const isTrendLive = churchTrendLive.source === 'live';
    const badge = isTrendLive ? 'Live from Connect' : 'Synthetic staging';
    const rows = isTrendLive ? renderLiveChurchTrendRows(churchTrendLive.years) : renderChurchTrendRows(churchTrendLive.rows);
    const fallbackNote = isTrendLive ? '' : `<p><small>The committed synthetic fixture (the live endpoint is not configured or did not answer${churchTrendLive.fallbackReason ? `: ${escapeHtml(churchTrendLive.fallbackReason)}` : ''}).</small></p>`;
    return `<section class="report" aria-label="Church Report multi-year trend">
      ${renderSectionHeading({ eyebrow: 'Church Report', heading: 'Multi-year operating trend', badge })}
      ${renderTable({ head: ['Fiscal year', 'Income', 'Expenses', 'Net result'], rows })}
      ${fallbackNote}
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
    </section>${canManageChurchReport ? renderChurchActualOverrideForm(report.fiscalYear, churchOverrideStatus, churchOverrideMessage) : ''}`;
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
