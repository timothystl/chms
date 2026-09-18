import { buildBalanceSheetView, buildLiveBalanceSheetView } from './balance-sheet-service.js';
import { escapeHtml, formatCents, formatSignedCents, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';

// Admin-only Balance Sheet / Statement of Financial Position .xlsx import -- relayed live to
// Connect's real finance_church_balances table (see finance-church-balances-xlsx-import-v1 in
// src/api-contracts-service.js), never stored in Finance's own database. Same shape as
// church-pages.js's renderChurchBudgetXlsxImportForm: a real `<input type="file">` upload
// (multipart/form-data), a single parse-and-persist relay request (legacy's separate preview/
// checkbox-review step is deliberately not ported -- see importChurchBalancesXlsx's header comment
// in src/api-finance.js), and both the fiscal year AND the as-of date read from the workbook
// itself, so there is no form field for either.
function renderBalanceXlsxImportForm(entryStatus, entryMessage) {
  return `<section aria-label="Import Balance Sheet from Excel">
    ${renderSectionHeading({ eyebrow: 'Balance Sheet', heading: 'Import Statement of Financial Position (.xlsx)', badge: 'Relayed live to Connect' })}
    ${entryStatus === 'ok' ? '<p class="status">Imported into Connect.</p>' : ''}
    ${entryStatus === 'error' ? `<p class="status status-error">Not imported: ${escapeHtml(entryMessage || 'unknown error')}</p>` : ''}
    <form method="POST" action="/api/v1/connect-church-balances-xlsx-import-write" enctype="multipart/form-data">
      <div class="field"><label for="bbx-file">QuickBooks "Statement of Financial Position" export (.xlsx, max 15 MB)</label><input id="bbx-file" type="file" name="file" accept=".xlsx" required></div>
      <button type="submit">Import file</button>
    </form>
    <p><small>Parses the uploaded workbook and writes every account row directly into Connect's own <code>finance_church_balances</code> table, tagged <code>source='import'</code> -- the same table and source the legacy in-Connect Excel import writes, replacing any prior import for that same fiscal year. Only Connect's own admin role may import; Connect independently re-verifies your identity and role for every request.</small></p>
  </section>`;
}

// "Statement of Financial Position" multi-year .xlsx import -- relayed live to Connect's real
// finance_church_balances table (source='import', same as the single-snapshot import above),
// never stored in Finance's own database. Shown only on Multi-year position, the page whose
// underlying data (every fiscal year on file) this import directly feeds -- see
// importChurchBalancesMultiYearXlsx's header comment in src/api-finance.js. Unlike
// renderBalanceXlsxImportForm above, this form is NOT admin-only: the legacy finance/church/
// balances/multi-year-import(-preview) route carries no isAdmin check of its own, only the same
// blanket "finance edit" ACCESS_GATE every finance/church/* route not explicitly listed in
// financeSegItems falls through to (verified directly against src/api-chms.js's source) --
// Connect's own contract handler re-derives that real permission-matrix check independently of
// what this form shows or hides (UI hiding is never authorization).
function renderBalanceMultiYearXlsxImportForm(entryStatus, entryMessage) {
  return `<section aria-label="Import multi-year Statement of Financial Position from Excel">
    ${renderSectionHeading({ eyebrow: 'Balance Sheet', heading: 'Import Statement of Financial Position, multi-year (.xlsx)', badge: 'Relayed live to Connect' })}
    ${entryStatus === 'ok' ? '<p class="status">Imported into Connect.</p>' : ''}
    ${entryStatus === 'error' ? `<p class="status status-error">Not imported: ${escapeHtml(entryMessage || 'unknown error')}</p>` : ''}
    <form method="POST" action="/api/v1/connect-church-balances-multi-year-xlsx-import-write" enctype="multipart/form-data">
      <div class="field"><label for="bbmy-file">QuickBooks "Statement of Financial Position" multi-year export (.xlsx, max 15 MB)</label><input id="bbmy-file" type="file" name="file" accept=".xlsx" required></div>
      <button type="submit">Import file</button>
    </form>
    <p><small>Parses the uploaded workbook (one column per fiscal year) and writes every account row directly into Connect's own <code>finance_church_balances</code> table, tagged <code>source='import'</code>, replacing any prior import for each fiscal year present in the file. Connect independently re-verifies your identity and real finance edit permission for every request.</small></p>
  </section>`;
}

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
// `balanceTrends` is now resolveBalanceSheetTrend()'s result, the SAME { source, rows } /
// { source, fallbackReason, rows } shape -- not the raw synthetic trend row array balance-pages.js
// used to receive directly either. Both the live and synthetic-fallback `rows` are already
// normalized to the same snake_case shape (see balance-sheet-service.js's resolveBalanceSheetTrend),
// so renderBalanceTrendRows itself needs no live/synthetic branch -- only the badge/fallback note
// below it does, same pattern as 'position'/'account-detail' just below.
export function renderBalancePage(pageId, {
  balanceSheet, balanceTrends, canManageBalanceImport, balanceXlsxImportStatus, balanceXlsxImportMessage,
  canImportBalanceMultiYear, balanceMultiYearXlsxImportStatus, balanceMultiYearXlsxImportMessage,
}) {
  if (pageId === 'multi-year') {
    const isLiveTrend = balanceTrends.source === 'live';
    const trendBadge = isLiveTrend ? 'Live from Connect' : 'Synthetic staging';
    const trendFallbackNote = isLiveTrend ? '' : `<p><small>The committed synthetic fixture (the live endpoint is not configured or did not answer${balanceTrends.fallbackReason ? `: ${escapeHtml(balanceTrends.fallbackReason)}` : ''}).</small></p>`;
    return `<section class="report" aria-label="Balance Sheet multi-year position">
      ${renderSectionHeading({ eyebrow: 'Balance Sheet', heading: 'Multi-year financial position', badge: trendBadge })}
      ${renderTable({ head: ['Fiscal year', 'As of', 'Assets', 'Liabilities', 'Net assets'], rows: renderBalanceTrendRows(balanceTrends.rows) })}
      ${trendFallbackNote}
    </section>${canImportBalanceMultiYear ? renderBalanceMultiYearXlsxImportForm(balanceMultiYearXlsxImportStatus, balanceMultiYearXlsxImportMessage) : ''}`;
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
  </section>${canManageBalanceImport ? renderBalanceXlsxImportForm(balanceXlsxImportStatus, balanceXlsxImportMessage) : ''}`;
}
