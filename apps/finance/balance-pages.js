import { buildBalanceSheetView, buildLiveBalanceSheetView } from './balance-sheet-service.js';
import { escapeHtml, formatCents, formatSignedCents, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';

export function renderBalanceRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.classification)}</td><td>${escapeHtml(row.account_name)}</td><td>${formatCents(row.own_balance_cents)}</td></tr>`).join('');
}

// Live rows carry the contract's own camelCase shape (see balance-sheet-service.js's
// buildLiveBalanceSheetView) -- ownBalanceCents is never null (confirmed 2026-09-14: unlike
// Church Report's budgetCents, this contract has no nullable dollar field at all), so unlike
// renderLiveChurchRows there is no '--' case to handle here.
export function renderLiveBalanceRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.classification)}</td><td>${escapeHtml(row.accountName)}</td><td>${formatCents(row.ownBalanceCents)}</td></tr>`).join('');
}

export function renderBalanceTrendRows(rows) {
  return rows.map((row) => `<tr><td>${row.fiscal_year}</td><td>${escapeHtml(row.as_of_date)}</td><td>${formatCents(row.assets_cents)}</td><td>${formatCents(row.liabilities_cents)}</td><td>${formatCents(row.net_assets_cents)}</td></tr>`).join('');
}

// `balanceSheet` here is resolveBalanceSheet()'s result -- { source: 'live', fiscalYear,
// asOfDate, accounts, totals, equityReclass } or { source: 'synthetic-fallback', fallbackReason,
// rows } -- never the raw synthetic row array balance-pages.js used to receive directly.
// 'multi-year' has no live equivalent yet and always reads balanceTrends, the untouched synthetic
// reader -- out of scope for this contract, same as Church Report's own still-synthetic trend page.
export function renderBalancePage(pageId, { balanceSheet, balanceTrends }) {
  if (pageId === 'multi-year') {
    return `<section class="report" aria-label="Synthetic Balance Sheet multi-year position">
      ${renderSectionHeading({ eyebrow: 'Balance Sheet', heading: 'Multi-year financial position', badge: 'Synthetic staging' })}
      ${renderTable({ head: ['Fiscal year', 'As of', 'Assets', 'Liabilities', 'Net assets'], rows: renderBalanceTrendRows(balanceTrends) })}
    </section>`;
  }

  const isLive = balanceSheet.source === 'live';
  const report = isLive
    ? buildLiveBalanceSheetView(balanceSheet.accounts, balanceSheet.fiscalYear, balanceSheet.asOfDate, balanceSheet.totals, balanceSheet.equityReclass)
    : buildBalanceSheetView(balanceSheet.rows);
  const badge = isLive ? 'Live from Connect' : 'Synthetic staging';
  const rows = isLive
    ? renderLiveBalanceRows([...report.assets, ...report.liabilities, ...report.equity])
    : renderBalanceRows([...report.assets, ...report.liabilities, ...report.equity]);
  const fallbackNote = isLive ? '' : `<p><small>The committed synthetic fixture (the live endpoint is not configured or did not answer${balanceSheet.fallbackReason ? `: ${escapeHtml(balanceSheet.fallbackReason)}` : ''}).</small></p>`;

  if (pageId === 'account-detail') {
    return `<section class="report" aria-label="Balance Sheet account detail">
      ${renderSectionHeading({ eyebrow: 'Balance Sheet', heading: `Account detail as of ${escapeHtml(report.asOfDate)}`, badge })}
      ${renderTable({ head: ['Classification', 'Account', 'Balance'], rows })}
      ${fallbackNote}
    </section>`;
  }
  // 'position' (default)
  // Donor-Restricted / Without Donor Restrictions is a real Balance Sheet feature production's
  // own "This Year" tab already shows (finRenderEquityReclassCard in src/frontend/js-finance.js)
  // -- the synthetic fixture has no equivalent at all, so this only renders on the live path.
  const equityReclassCards = isLive ? renderKpiCards([
    { label: 'Donor-restricted', value: formatCents(report.equityReclass.donorRestrictedCents) },
    { label: 'Without donor restrictions', value: formatCents(report.equityReclass.unrestrictedCents) },
  ]) : '';
  const unclassifiedNote = isLive && report.equityReclass.unclassified.length
    ? `<p><small>⚠ ${report.equityReclass.unclassified.length} account(s) need a Donor-Restricted classification decision.</small></p>`
    : '';
  return `<section class="report" aria-label="Balance Sheet position">
    ${renderSectionHeading({ eyebrow: 'Balance Sheet', heading: `Financial position as of ${escapeHtml(report.asOfDate)}`, badge })}
    ${renderKpiCards([
      { label: 'Assets', value: formatCents(report.totals.assetsCents) },
      { label: 'Liabilities', value: formatCents(report.totals.liabilitiesCents) },
      { label: 'Net assets', value: formatCents(report.totals.equityCents), hint: `Equation difference ${formatSignedCents(report.totals.equationDifferenceCents)}` },
    ])}
    ${equityReclassCards}
    ${unclassifiedNote}
    <p>See Account detail and Multi-year position for the full breakdown behind these totals.</p>
    ${fallbackNote}
  </section>`;
}
