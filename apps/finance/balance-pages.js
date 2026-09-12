import { buildBalanceSheetView } from './balance-sheet-service.js';
import { escapeHtml, formatCents, formatSignedCents, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';

export function renderBalanceRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.classification)}</td><td>${escapeHtml(row.account_name)}</td><td>${formatCents(row.own_balance_cents)}</td></tr>`).join('');
}

export function renderBalanceTrendRows(rows) {
  return rows.map((row) => `<tr><td>${row.fiscal_year}</td><td>${escapeHtml(row.as_of_date)}</td><td>${formatCents(row.assets_cents)}</td><td>${formatCents(row.liabilities_cents)}</td><td>${formatCents(row.net_assets_cents)}</td></tr>`).join('');
}

export function renderBalancePage(pageId, { balanceSheet, balanceTrends }) {
  const report = buildBalanceSheetView(balanceSheet);

  if (pageId === 'account-detail') {
    return `<section class="report" aria-label="Synthetic Balance Sheet account detail">
      ${renderSectionHeading({ eyebrow: 'Balance Sheet', heading: `Account detail as of ${escapeHtml(report.asOfDate)}`, badge: 'Synthetic staging' })}
      ${renderTable({ head: ['Classification', 'Account', 'Balance'], rows: renderBalanceRows([...report.assets, ...report.liabilities, ...report.equity]) })}
    </section>`;
  }
  if (pageId === 'multi-year') {
    return `<section class="report" aria-label="Synthetic Balance Sheet multi-year position">
      ${renderSectionHeading({ eyebrow: 'Balance Sheet', heading: 'Multi-year financial position', badge: 'Synthetic staging' })}
      ${renderTable({ head: ['Fiscal year', 'As of', 'Assets', 'Liabilities', 'Net assets'], rows: renderBalanceTrendRows(balanceTrends) })}
    </section>`;
  }
  // 'position' (default)
  return `<section class="report" aria-label="Synthetic Balance Sheet position">
    ${renderSectionHeading({ eyebrow: 'Balance Sheet', heading: `Financial position as of ${escapeHtml(report.asOfDate)}`, badge: 'Synthetic staging' })}
    ${renderKpiCards([
      { label: 'Assets', value: formatCents(report.totals.assetsCents) },
      { label: 'Liabilities', value: formatCents(report.totals.liabilitiesCents) },
      { label: 'Net assets', value: formatCents(report.totals.equityCents), hint: `Equation difference ${formatSignedCents(report.totals.equationDifferenceCents)}` },
    ])}
    <p>See Account detail and Multi-year position for the full breakdown behind these totals.</p>
  </section>`;
}
