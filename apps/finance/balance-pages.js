import {
  buildBalanceSheetView, buildLiveBalanceSheetView, buildBalanceTree, filterZeroBalanceTree, flattenBalanceTree,
  balanceTotalsByPath, buildAssetComposition,
} from './balance-sheet-service.js';
import { escapeHtml, formatCents, formatSignedCents, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';
import { csvText } from './payroll-report-render.js';

// Admin-only Balance Sheet / Statement of Financial Position .xlsx import -- relayed live to
// Connect's real finance_church_balances table (see finance-church-balances-xlsx-import-v1 in
// src/api-contracts-service.js), never stored in Finance's own database. Same shape as
// church-pages.js's renderChurchBudgetXlsxImportForm: a real `<input type="file">` upload
// (multipart/form-data), followed by a no-write preview and separate selective-commit relay.
// Both the fiscal year AND the as-of date are read from the workbook
// itself, so there is no form field for either.
function renderBalanceXlsxImportForm(entryStatus, entryMessage) {
  return `<section aria-label="Import Balance Sheet from Excel">
    ${renderSectionHeading({ eyebrow: 'Balance Sheet', heading: 'Import Statement of Financial Position (.xlsx)', badge: 'Relayed live to Connect' })}
    ${entryStatus === 'ok' ? '<p class="status">Imported into Connect.</p>' : ''}
    ${entryStatus === 'error' ? `<p class="status status-error">Not imported: ${escapeHtml(entryMessage || 'unknown error')}</p>` : ''}
    <form method="POST" action="/api/v1/connect-church-balances-xlsx-preview" enctype="multipart/form-data">
      <div class="field"><label for="bbx-file">QuickBooks "Statement of Financial Position" export (.xlsx, max 15 MB)</label><input id="bbx-file" type="file" name="file" accept=".xlsx" required></div>
      <button type="submit">Review file</button>
    </form>
    <p><small>First parses the workbook without changing data. After reviewing and selecting rows, the confirmed rows write directly into Connect's own <code>finance_church_balances</code> table, tagged <code>source='import'</code> -- the same table and source the legacy in-Connect Excel import writes, superseding prior imported rows for that fiscal year. Only Connect's own admin role may import; Connect independently re-verifies identity and role for both steps.</small></p>
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
    <form method="POST" action="/api/v1/connect-church-balances-multi-year-xlsx-preview" enctype="multipart/form-data">
      <div class="field"><label for="bbmy-file">QuickBooks "Statement of Financial Position" multi-year export (.xlsx, max 15 MB)</label><input id="bbmy-file" type="file" name="file" accept=".xlsx" required></div>
      <button type="submit">Review file</button>
    </form>
    <p><small>Parses without changing data, then lets you select the fiscal-year balance rows to commit through Connect's existing permission-checked importer.</small></p>
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

// ── Shared pieces for the parity sections ───────────────────────────────────────────────────────
// Everything below renders figures Connect's legacy Balance Sheet & Financial Position tab
// (finRenderBalanceSheetTab, src/frontend/js-finance.js) shows, from the same contract figures.
// Finance's page policy allows no script, so the tab's buttons become GET forms and links, and its
// charts become plain CSS columns; tooltips are `title` attributes and every chart has a table
// with the same figures beneath it.

const exactMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
function formatExactCents(cents) {
  return exactMoney.format(Math.abs(Number(cents || 0)) / 100);
}

function balanceHref(page, params = {}) {
  const query = new URLSearchParams({ section: 'balance', page });
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') query.set(key, String(value));
  }
  return `/?${query.toString()}`;
}

function panelHeading(title, note = '') {
  return `<h3 class="bs-h">${escapeHtml(title)}</h3>${note ? `<p class="bs-note">${note}</p>` : ''}`;
}

function toneClass(delta) {
  return delta > 0 ? 'bs-up' : delta < 0 ? 'bs-down' : 'bs-flat';
}

function signedChange(delta) {
  if (delta > 0) return `+${formatCents(delta)}`;
  if (delta < 0) return `−${formatCents(-delta)}`;
  return formatCents(0);
}

// Same arithmetic as Connect's finGrowthCellsHtml: change against the prior figure, percentage of
// the prior figure's absolute value, and a dash when the prior figure is zero.
function growthCells(cur, prior) {
  const delta = cur - prior;
  const pct = prior !== 0 ? delta / Math.abs(prior) * 100 : null;
  const tone = toneClass(delta);
  return `<td class="num">${formatCents(cur)}</td><td class="num ${tone}">${signedChange(delta)}</td>`
    + `<td class="num ${tone}">${pct === null ? '—' : `${delta >= 0 ? '+' : ''}${pct.toFixed(1)}%`}</td>`;
}

function renderPlainTable(head, rows, className = '') {
  return `<div class="table-wrap"><table class="bs-table${className ? ` ${className}` : ''}"><thead><tr>${head.map((cell) => {
    const [label, numeric] = Array.isArray(cell) ? cell : [cell, false];
    return `<th${numeric ? ' class="num"' : ''}>${escapeHtml(label)}</th>`;
  }).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// The Assets = Liabilities + Net assets check Connect prints under its totals.
export function renderBalanceCheck(balancedCents) {
  return Math.abs(balancedCents) < 1
    ? '<p class="bs-check is-ok">✓ Balances (Assets = Liabilities + Net assets)</p>'
    : `<p class="bs-check is-off">⚠ Off by ${formatExactCents(balancedCents)} — check the import for a missing or misclassified account.</p>`;
}

const DESIGNATED_FUNDS_NOTE = '<p class="bs-note">Designated &amp; restricted funds (Memorial, Food Pantry, missions, and similar) are shown here as net assets, not as a liability &mdash; the standard nonprofit presentation. They are gifts already given for a specific purpose, not a debt owed to an outside party. QuickBooks&rsquo; own chart of accounts still files them under Liabilities.</p>';

function renderYearControls(page, selection, fiscalYear, { extraHidden = '' } = {}) {
  return `<form method="GET" action="/" class="bs-controls no-print" aria-label="Choose the balance sheet year">
      <input type="hidden" name="section" value="balance"><input type="hidden" name="page" value="${escapeHtml(page)}">${extraHidden}
      <label>Balance sheet for <input type="number" name="fiscal_year" min="2000" max="2100" value="${fiscalYear}"></label>
      <button type="submit">Show year</button>
      <a href="${escapeHtml(balanceHref(page, { fiscal_year: fiscalYear - 1, zero: selection?.hideZero === false ? 'show' : '' }))}">← ${fiscalYear - 1}</a>
      <a href="${escapeHtml(balanceHref(page, { fiscal_year: fiscalYear + 1, zero: selection?.hideZero === false ? 'show' : '' }))}">${fiscalYear + 1} →</a>
    </form>${selection?.yearError ? `<p class="status status-error">${escapeHtml(selection.yearError)} Showing ${fiscalYear}.</p>` : ''}`;
}

// ── Position ───────────────────────────────────────────────────────────────────────────────────
function renderEquityReclassPanel(equityReclass) {
  const bucketRows = ['perpetual', 'purpose_time', 'designated']
    .map((key) => equityReclass.breakdown[key])
    .filter((bucket) => bucket && bucket.cents)
    .map((bucket) => `<tr><td>${escapeHtml(bucket.label)}</td><td class="num">${formatCents(bucket.cents)}</td></tr>`)
    .join('');
  const unclassified = equityReclass.unclassified.length
    ? `<div class="bs-warn">
        <p><b>⚠ ${equityReclass.unclassified.length} account(s) need a Donor-Restricted classification decision.</b> New or renamed accounts near the existing restricted-fund groups are not counted in either bucket until they are reviewed and added to the classification table.</p>
        ${renderPlainTable(['Account', ['Balance', true]], equityReclass.unclassified.map((u) => `<tr><td>${escapeHtml(u.accountName)}</td><td class="num">${formatCents(u.ownBalanceCents)}</td></tr>`).join(''))}
      </div>`
    : '';
  return `<div class="bs-panel" aria-label="Donor-restricted net assets">
      ${panelHeading('Net assets — donor-restricted vs. without donor restrictions', 'Replaces QuickBooks’ four-way equity split; computed bottom-up from real fund and endowment balances, not the drifted legacy equity lines.')}
      ${renderKpiCards([
        { label: 'Donor-restricted', value: formatCents(equityReclass.donorRestrictedCents) },
        { label: 'Without donor restrictions', value: formatCents(equityReclass.unrestrictedCents) },
      ])}
      ${bucketRows ? renderPlainTable(['Restricted bucket', ['Amount', true]], bucketRows) : ''}
      ${unclassified}
    </div>`;
}

function renderAssetComposition(tree) {
  const items = buildAssetComposition(tree);
  if (!items.length) return '';
  return `<div class="bs-panel" aria-label="Asset composition">
      ${panelHeading('Asset composition', 'Each asset group’s share of total assets.')}
      <ul class="bs-meters">${items.map((item) => `<li><span>${escapeHtml(item.label)}</span><span class="bs-meter" aria-hidden="true"><i style="width:${item.sharePct.toFixed(1)}%"></i></span><span class="num">${formatCents(item.cents)} · ${item.sharePct.toFixed(1)}%</span></li>`).join('')}</ul>
    </div>`;
}

// Connect's finRenderBalanceYoyCard: every account on this year's sheet (its structure is the
// reading), compared with the same path's prior-year rolled-up total; a path with no prior entry
// reads "new this year" rather than a misleading $0.
function renderYearOverYear(accounts, fiscalYear, prior) {
  const priorYear = fiscalYear - 1;
  const heading = panelHeading(`${fiscalYear} vs. ${priorYear}`);
  if (!prior || !prior.ok || !prior.accounts.length) {
    const why = prior && !prior.ok && prior.reason !== 'not_configured'
      ? `The ${priorYear} balance sheet could not be read just now (${escapeHtml(prior.reason)}).`
      : `No ${priorYear} balance sheet on file yet &mdash; import one to see a year-over-year comparison here.`;
    return `<div class="bs-panel" aria-label="Year over year">${heading}<p class="bs-note">${why}</p></div>`;
  }
  const priorByPath = balanceTotalsByPath(prior.accounts);
  const rows = flattenBalanceTree(buildBalanceTree(accounts)).map((node) => {
    const group = node.children.length > 0;
    const indent = `style="padding-left:${14 + node.depth * 16}px"`;
    const cls = group ? ' class="bs-group-row"' : '';
    if (!priorByPath.has(node.path)) {
      return `<tr${cls}><td ${indent}>${escapeHtml(node.label)}</td><td class="num">${formatCents(node.totalBalanceCents)}</td><td class="num">—</td><td class="num bs-flat">new this year</td><td class="num">—</td></tr>`;
    }
    const priorCents = priorByPath.get(node.path);
    const delta = node.totalBalanceCents - priorCents;
    const pct = priorCents !== 0 ? delta / Math.abs(priorCents) * 100 : null;
    const tone = toneClass(delta);
    return `<tr${cls}><td ${indent}>${escapeHtml(node.label)}</td><td class="num">${formatCents(node.totalBalanceCents)}</td><td class="num">${formatCents(priorCents)}</td>`
      + `<td class="num ${tone}">${signedChange(delta)}</td><td class="num ${tone}">${pct === null ? '—' : `${delta >= 0 ? '+' : ''}${pct.toFixed(1)}%`}</td></tr>`;
  }).join('');
  return `<div class="bs-panel" aria-label="Year over year">${heading}
      <p class="bs-note">Every account on the ${fiscalYear} balance sheet, compared line by line with the same account’s ${priorYear} total.</p>
      ${renderPlainTable(['Account', [String(fiscalYear), true], [String(priorYear), true], ['Change', true], ['%', true]], rows, 'bs-tree')}
    </div>`;
}

// ── Account detail ─────────────────────────────────────────────────────────────────────────────
// Connect's "Full account detail": the indented tree with rolled-up subtotals, zero-balance lines
// hidden by default. Returns the table plus how many zero lines were left out.
export function renderBalanceDetailTree(accounts, { hideZero = true } = {}) {
  const full = buildBalanceTree(accounts);
  const shown = filterZeroBalanceTree(full, { hideZero });
  const shownCount = flattenBalanceTree(shown).length;
  const hiddenCount = flattenBalanceTree(full).length - shownCount;
  const rows = flattenBalanceTree(shown).map((node) => `<tr${node.children.length ? ' class="bs-group-row"' : ''}><td style="padding-left:${14 + node.depth * 16}px">${escapeHtml(node.label)}</td><td class="num">${formatCents(node.totalBalanceCents)}</td></tr>`).join('');
  return { html: renderPlainTable(['Account', ['Balance', true]], rows, 'bs-tree'), hiddenCount };
}

function renderZeroToggle(selection, fiscalYear, hiddenCount) {
  const showing = selection?.hideZero === false;
  return `<p class="bs-note no-print">${showing
    ? `Showing zero-balance lines. <a href="${escapeHtml(balanceHref('account-detail', { fiscal_year: fiscalYear }))}">Hide zero-balance lines</a>`
    : `${hiddenCount ? `${hiddenCount} zero-balance line${hiddenCount === 1 ? '' : 's'} hidden. ` : 'Zero-balance lines are hidden. '}<a href="${escapeHtml(balanceHref('account-detail', { fiscal_year: fiscalYear, zero: 'show' }))}">Show zero-balance lines</a>`}</p>`;
}

// ── Multi-year charts and tables ───────────────────────────────────────────────────────────────
const TREND_SERIES = {
  current: { label: 'Current assets', cls: 's-current' },
  fixed: { label: 'Fixed assets', cls: 's-fixed' },
  other: { label: 'Other assets', cls: 's-other' },
  liabilities: { label: 'Liabilities', cls: 's-liabilities' },
  equity: { label: 'Net assets', cls: 's-equity' },
  operating: { label: 'Operating checking', cls: 's-operating' },
  allCash: { label: 'All cash & bank accounts', cls: 's-allcash' },
};

function compactDollars(cents) {
  return `$${Math.round(cents / 100 / 1000).toLocaleString('en-US')}k`;
}

// A grouped column chart in CSS: one group per year, one column per entry in `columns`, each
// column a stack of segments drawn bottom-up. Heights share one scale (the tallest column);
// negative figures draw as empty, the same caveat as Connect's own bar charts.
function renderColumnChart({ label, years, columns, legendKeys }) {
  const positive = (cents) => Math.max(0, cents || 0);
  const columnTotal = (year, column) => column.segments.reduce((total, seg) => total + positive(seg.cents(year)), 0);
  const max = Math.max(1, ...years.flatMap((year) => columns.map((column) => columnTotal(year, column))));
  const groups = years.map((year) => {
    const cols = columns.map((column) => {
      const total = columnTotal(year, column);
      const segs = column.segments.map((seg) => {
        const cents = seg.cents(year);
        const share = total ? positive(cents) / total * 100 : 0;
        return `<span class="bs-seg ${TREND_SERIES[seg.key].cls}" style="height:${share.toFixed(2)}%" title="${escapeHtml(seg.title(year, cents))}"></span>`;
      }).join('');
      return `<div class="bs-col" style="height:${Math.max(total ? 1 : 0, total / max * 100).toFixed(2)}%">${segs}</div>`;
    }).join('');
    return `<div class="bs-year"><div class="bs-cols">${cols}</div><span>${year.fiscalYear}</span></div>`;
  }).join('');
  const legend = legendKeys.map((key) => `<span class="key ${TREND_SERIES[key].cls}"></span>${escapeHtml(TREND_SERIES[key].label)}`).join(' ');
  return `<div class="bs-chart" role="img" aria-label="${escapeHtml(label)}">${groups}</div><p class="bs-legend">${legend}</p>`;
}

// Connect's finRenderBalanceMultiYearChart: the Assets column stacked into current/fixed/other
// (other only offered when some year has any), beside plain Liabilities and Net assets columns.
function renderTrendChart(years) {
  if (!years.some((y) => y.assetsCents || y.liabilitiesCents || y.equityCents)) return '';
  const anyOther = years.some((y) => (y.otherAssetsCents || 0) !== 0);
  const assetTitle = (key) => (y, cents) => `${TREND_SERIES[key].label} ${y.fiscalYear}: ${formatExactCents(cents)}${cents < 0 ? ' (negative)' : ''} (total assets ${formatExactCents(y.assetsCents)})`;
  const plainTitle = (key) => (y, cents) => `${TREND_SERIES[key].label} ${y.fiscalYear}: ${cents < 0 ? '−' : ''}${formatExactCents(cents)}`;
  const assetSegments = [
    { key: 'current', cents: (y) => y.currentAssetsCents, title: assetTitle('current') },
    { key: 'fixed', cents: (y) => y.fixedAssetsCents, title: assetTitle('fixed') },
    ...(anyOther ? [{ key: 'other', cents: (y) => y.otherAssetsCents, title: assetTitle('other') }] : []),
  ];
  const chart = renderColumnChart({
    label: 'Assets, liabilities, and net assets by year',
    years,
    columns: [
      { segments: assetSegments },
      { segments: [{ key: 'liabilities', cents: (y) => y.liabilitiesCents, title: plainTitle('liabilities') }] },
      { segments: [{ key: 'equity', cents: (y) => y.equityCents, title: plainTitle('equity') }] },
    ],
    legendKeys: ['current', 'fixed', ...(anyOther ? ['other'] : []), 'liabilities', 'equity'],
  });
  const rows = years.map((y) => `<tr><td>${y.fiscalYear}</td><td class="num">${formatCents(y.currentAssetsCents)}</td><td class="num">${formatCents(y.fixedAssetsCents)}</td>${anyOther ? `<td class="num">${formatCents(y.otherAssetsCents)}</td>` : ''}<td class="num">${formatCents(y.assetsCents)}</td><td class="num">${formatCents(y.liabilitiesCents)}</td><td class="num">${formatCents(y.equityCents)}</td></tr>`).join('');
  return `<div class="bs-panel" aria-label="Multi-year trend">
      ${panelHeading('Multi-year trend', 'The Assets column is stacked into its balance-sheet groups. Fixed assets are property at book value and do not move with the market, so current assets are where growth or drawdown actually shows.')}
      ${chart}
      ${renderPlainTable(['Year', ['Current assets', true], ['Fixed assets', true], ...(anyOther ? [['Other assets', true]] : []), ['Total assets', true], ['Liabilities', true], ['Net assets', true]], rows)}
    </div>`;
}

// Connect's finRenderCashTrendChart: the pinned operating account (the same
// operatingCashFromBalanceSheet figure the cash-runway card reads) and every cash/bank account.
function renderCashTrend(years, cashAccountCode) {
  if (!years.some((y) => y.cash && (y.cash.operatingCents || y.cash.allCashCents))) return '';
  const hasOperating = years.some((y) => y.cash && y.cash.operatingCents !== null);
  const title = (key) => (y, cents) => `${TREND_SERIES[key].label} ${y.fiscalYear}: ${cents < 0 ? '−' : ''}${formatExactCents(cents)}`;
  const chart = renderColumnChart({
    label: 'Cash and bank accounts by year',
    years,
    columns: [
      ...(hasOperating ? [{ segments: [{ key: 'operating', cents: (y) => y.cash?.operatingCents || 0, title: title('operating') }] }] : []),
      { segments: [{ key: 'allCash', cents: (y) => y.cash?.allCashCents || 0, title: title('allCash') }] },
    ],
    legendKeys: [...(hasOperating ? ['operating'] : []), 'allCash'],
  });
  const cell = (cents) => `<td class="num">${cents === null || cents === undefined ? '—' : formatCents(cents)}</td>`;
  const rows = years.map((y) => `<tr><td>${y.fiscalYear}</td>${hasOperating ? cell(y.cash ? y.cash.operatingCents : null) : ''}${cell(y.cash ? y.cash.allCashCents : null)}</tr>`).join('');
  const latest = years.at(-1);
  const accountNote = latest?.cash?.allCashAccounts?.length
    ? `<p class="bs-note">${latest.fiscalYear}: ${latest.cash.allCashAccounts.map(escapeHtml).join(', ')}</p>` : '';
  const operatingNote = hasOperating
    ? `<p class="bs-note">Operating checking is ${cashAccountCode ? `account ${escapeHtml(cashAccountCode)}` : 'every account named “checking”'}, the same figure the cash-runway card uses.</p>` : '';
  return `<div class="bs-panel" aria-label="Cash and bank accounts over time">
      ${panelHeading('Cash & bank accounts over time')}
      ${chart}
      ${renderPlainTable(['Year', ...(hasOperating ? [['Operating checking', true]] : []), ['All cash & bank accounts', true]], rows)}
      ${accountNote}${operatingNote}
    </div>`;
}

function renderNetWorthGrowth(years) {
  if (years.length < 2) return '';
  const rows = years.slice(1).map((y, i) => `<tr><td>${years[i].fiscalYear} → ${y.fiscalYear}</td>${growthCells(y.equityCents, years[i].equityCents)}</tr>`).join('');
  return `<div class="bs-panel" aria-label="Net worth growth by year">
      ${panelHeading('Net worth growth by year', 'Change in total net assets (assets minus liabilities) year over year &mdash; the plainest single measure of whether the church grew or lost ground.')}
      ${renderPlainTable(['Period', ['Net assets', true], ['Change', true], ['%', true]], rows)}
    </div>`;
}

function renderAssetGrowth(years) {
  if (years.length < 2) return '';
  const rows = years.slice(1).map((y, i) => `<tr><td>${years[i].fiscalYear} → ${y.fiscalYear}</td>${growthCells(y.assetsCents, years[i].assetsCents)}${growthCells(y.currentAssetsCents, years[i].currentAssetsCents)}</tr>`).join('');
  return `<div class="bs-panel" aria-label="Asset growth by year">
      ${panelHeading('Asset growth by year', 'What the church actually holds, year over year. Total assets include property at book value, which does not move with the market &mdash; current assets are cash, receivables, and investments, and are where growth or drawdown really shows.')}
      ${renderPlainTable(['Period', ['Total assets', true], ['Change', true], ['%', true], ['Current assets', true], ['Change', true], ['%', true]], rows)}
    </div>`;
}

// Connect's finRenderBalanceReconciliation, worded as a difference to explain, never a failure.
function tieOutStatus(row) {
  if (row.status === 'ok') return '<span class="bs-up">✓ Matches</span>';
  if (row.status === 'off') return `<span class="bs-warn-text">Difference of ${formatExactCents(row.differenceCents)}</span>`;
  if (row.status === 'no_prior_balance') return `<span class="bs-flat">No ${row.priorYear} balance sheet — import it to check this year</span>`;
  return `<span class="bs-flat">No income statement on file for ${row.year}</span>`;
}

function renderTieOut(pnlTieOut) {
  if (!pnlTieOut.rows.length) return '';
  const money = (cents) => (cents === null ? '—' : `${cents < 0 ? '−' : ''}${formatCents(Math.abs(cents))}`);
  const summary = pnlTieOut.checked
    ? `${pnlTieOut.matched} of ${pnlTieOut.checked} year${pnlTieOut.checked === 1 ? '' : 's'} tie out exactly.`
    : 'No year can be checked yet — a year needs both its own balance sheet and the one before it.';
  const rows = pnlTieOut.rows.map((r) => `<tr><td>${r.year}</td><td class="num">${money(r.priorEquityCents)}</td><td class="num">${money(r.equityCents)}</td><td class="num">${money(r.changeCents)}</td><td class="num">${money(r.netIncomeCents)}</td><td>${tieOutStatus(r)}</td></tr>`).join('');
  return `<div class="bs-panel" aria-label="Balance sheet vs. income statement">
      ${panelHeading('Balance sheet vs. income statement', `The year’s change in total net assets should equal that year’s net income. ${escapeHtml(summary)} A difference is not automatically an error &mdash; a cash-basis balance sheet next to an accrual income statement, or an adjustment booked straight to net assets, will show up here legitimately.`)}
      ${renderPlainTable(['Year', ['Opening net assets', true], ['Closing net assets', true], ['Change', true], ['Net income (P&L)', true], 'Check'], rows)}
    </div>`;
}

function renderNetAssetsByYear(years) {
  const withSplit = years.filter((y) => y.equityReclass);
  if (!withSplit.length) return '';
  const rows = withSplit.map((y) => `<tr><td>${y.fiscalYear}</td><td class="num">${formatCents(y.equityReclass.donorRestrictedCents)}</td><td class="num">${formatCents(y.equityReclass.unrestrictedCents)}</td><td class="num">${formatCents(y.equityReclass.totalEquityCents)}</td><td>${y.equityReclass.unclassifiedCount ? `<span class="bs-warn-text">⚠ ${y.equityReclass.unclassifiedCount} unclassified</span>` : ''}</td></tr>`).join('');
  return `<div class="bs-panel" aria-label="Net assets by year">
      ${panelHeading('Net assets by year')}
      ${renderPlainTable(['Year', ['Donor-restricted', true], ['Without restrictions', true], ['Total net assets', true], ''], rows)}
    </div>`;
}

function renderRangeControls(selection, years) {
  const from = selection?.fromYear ?? years[0]?.fiscalYear ?? '';
  const to = selection?.toYear ?? years.at(-1)?.fiscalYear ?? '';
  const csvHref = balanceHref('multi-year', { format: 'csv', from_year: selection?.fromYear, to_year: selection?.toYear });
  return `<form method="GET" action="/" class="bs-controls no-print" aria-label="Choose the trend years">
      <input type="hidden" name="section" value="balance"><input type="hidden" name="page" value="multi-year">
      <label>Trend from <input type="number" name="from_year" min="2000" max="2100" value="${escapeHtml(from)}"></label>
      <label>to <input type="number" name="to_year" min="2000" max="2100" value="${escapeHtml(to)}"></label>
      <button type="submit">Load range</button>
      ${selection?.fromYear ? `<a href="${escapeHtml(balanceHref('multi-year'))}">Every year on file</a>` : ''}
      <a href="${escapeHtml(csvHref)}">Export CSV</a>
    </form>${selection?.rangeError ? `<p class="status status-error">${escapeHtml(selection.rangeError)} Showing every year on file.</p>` : ''}`;
}

// ── CSV export ─────────────────────────────────────────────────────────────────────────────────
// Connect's finExportBalanceCsv, server-built: the multi-year series with the cash columns, in
// dollars. Figures the source does not carry (the synthetic fixture has no asset groups or cash)
// are left blank rather than written as zero.
export function buildBalanceTrendCsv(balanceTrends) {
  const header = ['Year', 'Assets', 'Current Assets', 'Fixed Assets', 'Other Assets', 'Liabilities', 'Equity', 'Operating Checking', 'All Cash & Bank Accounts'];
  const dollars = (cents) => (cents === null || cents === undefined ? '' : String(cents / 100));
  const years = balanceTrends.detail
    ? balanceTrends.detail.years
    : balanceTrends.rows.map((row) => ({
      fiscalYear: row.fiscal_year, assetsCents: row.assets_cents, liabilitiesCents: row.liabilities_cents, equityCents: row.equity_cents,
    }));
  const lines = [header.map(csvText).join(',')];
  for (const y of years) {
    lines.push([
      String(y.fiscalYear), dollars(y.assetsCents), dollars(y.currentAssetsCents), dollars(y.fixedAssetsCents), dollars(y.otherAssetsCents),
      dollars(y.liabilitiesCents), dollars(y.equityCents), dollars(y.cash?.operatingCents), dollars(y.cash?.allCashCents),
    ].join(','));
  }
  return `${lines.join('\n')}\n`;
}

// ── Styles (screen and print) ──────────────────────────────────────────────────────────────────
// Series colors are Connect's own (finRenderBalanceMultiYearChart / finRenderCashTrendChart).
export const BALANCE_STYLES = `
    .bs-controls { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin:14px 0 4px; }
    .bs-controls input[type=number] { width:6.5rem; }
    .bs-controls button { margin-top:0; }
    .bs-h { margin:22px 0 4px; font-size:17px; }
    .bs-note { margin:4px 0 8px; font-size:13px; }
    .bs-panel { margin-top:18px; }
    .bs-check { margin:12px 0 4px; font-size:14px; font-weight:600; }
    .bs-check.is-ok, .bs-up { color:#2F7D5B; }
    .bs-check.is-off, .bs-down { color:#B4412F; }
    .bs-flat { color:#5B6475; }
    .bs-warn-text { color:#8A611C; }
    .bs-warn { margin-top:12px; padding:10px 14px; border:1px solid #EAD9B5; border-radius:8px; background:#FBF6EA; }
    .bs-warn p { margin:0 0 6px; color:#8A611C; font-size:13px; }
    .bs-table td.num, .bs-table th.num { text-align:right; white-space:nowrap; }
    .bs-table th:nth-child(n+3):not(.num), .bs-table td:nth-child(n+3):not(.num) { text-align:left; }
    .bs-tree tr.bs-group-row td { font-weight:600; }
    .bs-meters { list-style:none; margin:10px 0 0; padding:0; }
    .bs-meters li { display:grid; grid-template-columns:minmax(0,1.3fr) minmax(60px,1fr) auto; gap:12px; align-items:center; padding:8px 0; border-bottom:1px solid #EEF0F4; font-size:14px; }
    .bs-meter { height:8px; border-radius:4px; background:#EEF0F4; overflow:hidden; }
    .bs-meter i { display:block; height:100%; background:#2E7EA6; border-radius:4px; }
    .bs-chart { display:flex; align-items:flex-end; gap:10px; height:220px; margin-top:16px; padding:0 4px; border-bottom:1px solid #D5DAE3; }
    .bs-year { flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; height:100%; }
    .bs-year > span { font-size:12px; color:#4B5563; margin-top:6px; }
    .bs-cols { flex:1; width:100%; display:flex; align-items:flex-end; justify-content:center; gap:3px; }
    .bs-col { width:min(22px,30%); display:flex; flex-direction:column-reverse; border-radius:3px 3px 0 0; overflow:hidden; }
    .bs-seg { display:block; width:100%; flex:none; }
    .bs-chart + .bs-legend { margin-top:28px; }
    .bs-legend { font-size:12px; color:#6B7280; display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
    .bs-legend .key { display:inline-block; width:10px; height:10px; border-radius:2px; margin-left:8px; }
    .bs-legend .key:first-child { margin-left:0; }
    .s-current { background:#2E7EA6; } .s-fixed { background:#8FBBD1; } .s-other { background:#C5DAE5; }
    .s-liabilities { background:#C9973A; } .s-equity { background:#5A9E6F; }
    .s-operating { background:#5A9E6F; } .s-allcash { background:#2E7EA6; }
    .bs-chart, .bs-legend, .bs-meter { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
`;

// `balanceSheet` here is resolveBalanceSheet()'s result -- { source: 'live', fiscalYear,
// asOfDate, accounts, totals, equityReclass } or { source: 'synthetic-fallback', fallbackReason,
// rows } -- never the raw synthetic row array balance-pages.js used to receive directly.
// `balanceTrends` is resolveBalanceSheetTrend()'s result, { source, rows, detail } /
// { source, fallbackReason, rows }: `rows` is always the normalized snake_case trend table, and
// `detail` (live producers with the parity extension only) carries the per-year figures behind
// the charts and tables. `balancePriorYear` is resolveBalanceSheetPriorYear()'s result for the
// Position page's year-over-year table, `selection` is parseBalanceSelection()'s GET controls,
// and `printMode` adds the filtered account detail to the Position print, matching Connect's
// print sheet.
export function renderBalancePage(pageId, {
  balanceSheet, balanceTrends, balancePriorYear = null, selection = null, printMode = false,
  canManageBalanceImport, balanceXlsxImportStatus, balanceXlsxImportMessage,
  canImportBalanceMultiYear, balanceMultiYearXlsxImportStatus, balanceMultiYearXlsxImportMessage,
}) {
  if (pageId === 'multi-year') {
    const isLiveTrend = balanceTrends.source === 'live';
    const trendBadge = isLiveTrend ? 'Live from Connect' : 'Synthetic staging';
    const trendFallbackNote = isLiveTrend ? '' : `<p><small>The committed synthetic fixture (the live endpoint is not configured or did not answer${balanceTrends.fallbackReason ? `: ${escapeHtml(balanceTrends.fallbackReason)}` : ''}).</small></p>`;
    const detail = isLiveTrend ? balanceTrends.detail : null;
    const detailYears = detail ? detail.years : [];
    const controlYears = detail ? detailYears : balanceTrends.rows.map((row) => ({ fiscalYear: row.fiscal_year }));
    const sections = detail
      ? [
        renderTrendChart(detailYears),
        renderCashTrend(detailYears, detail.cashAccountCode),
        renderNetWorthGrowth(detailYears),
        renderAssetGrowth(detailYears),
        renderTieOut(detail.pnlTieOut),
        renderNetAssetsByYear(detailYears),
      ].join('')
      : '';
    return `<section class="report" aria-label="Balance Sheet multi-year position">
      ${renderSectionHeading({ eyebrow: 'Balance Sheet', heading: 'Multi-year financial position', badge: trendBadge })}
      ${renderRangeControls(isLiveTrend ? selection : null, controlYears)}
      ${sections}
      ${panelHeading('Position by year')}
      ${renderTable({ head: ['Fiscal year', 'As of', 'Assets', 'Liabilities', 'Net assets'], rows: renderBalanceTrendRows(balanceTrends.rows) })}
      ${trendFallbackNote}
    </section>${canImportBalanceMultiYear ? renderBalanceMultiYearXlsxImportForm(balanceMultiYearXlsxImportStatus, balanceMultiYearXlsxImportMessage) : ''}`;
  }

  const isLive = balanceSheet.source === 'live';
  const report = isLive
    ? buildLiveBalanceSheetView(balanceSheet.accounts, balanceSheet.fiscalYear, balanceSheet.asOfDate, balanceSheet.totals, balanceSheet.equityReclass)
    : buildBalanceSheetView(balanceSheet.rows);
  const badge = isLive ? 'Live from Connect' : 'Synthetic staging';
  const fallbackNote = isLive ? '' : `<p><small>The committed synthetic fixture (the live endpoint is not configured or did not answer${balanceSheet.fallbackReason ? `: ${escapeHtml(balanceSheet.fallbackReason)}` : ''}).</small></p>`;
  const fiscalYear = report.fiscalYear;
  // The year picker only means something against live data; the synthetic fixture has one year.
  const hideZero = selection?.hideZero !== false;
  const emptyYear = isLive && balanceSheet.accounts.length === 0;
  const asOfLabel = report.asOfDate || `FY${fiscalYear}`;
  const emptyNote = `<p class="status status-pending">No balance sheet imported yet for ${fiscalYear}. Import one (Balance Sheet, or Financial Position for a file covering several years), or pick another year above.</p>`;

  if (pageId === 'account-detail') {
    if (!isLive) {
      const rows = renderBalanceRows([...report.assets, ...report.liabilities, ...report.equity]);
      return `<section class="report" aria-label="Balance Sheet account detail">
      ${renderSectionHeading({ eyebrow: 'Balance Sheet', heading: `Account detail as of ${escapeHtml(report.asOfDate)}`, badge })}
      ${renderTable({ head: ['Classification', 'Account', 'Balance'], rows })}
      ${fallbackNote}
    </section>`;
    }
    const zeroHidden = hideZero ? '' : '<input type="hidden" name="zero" value="show">';
    const detail = emptyYear ? null : renderBalanceDetailTree(balanceSheet.accounts, { hideZero });
    return `<section class="report" aria-label="Balance Sheet account detail">
      ${renderSectionHeading({ eyebrow: 'Balance Sheet', heading: `Account detail as of ${escapeHtml(asOfLabel)}`, badge })}
      ${renderYearControls('account-detail', selection, fiscalYear, { extraHidden: zeroHidden })}
      ${emptyYear ? emptyNote : `${renderBalanceCheck(report.totals.equationDifferenceCents)}
      ${renderZeroToggle(selection, fiscalYear, detail.hiddenCount)}
      ${detail.html}`}
    </section>`;
  }

  // 'position' (default)
  const positionBody = emptyYear ? emptyNote : `${renderKpiCards([
      { label: 'Assets', value: formatCents(report.totals.assetsCents) },
      { label: 'Liabilities', value: formatCents(report.totals.liabilitiesCents) },
      { label: 'Net assets', value: formatCents(report.totals.equityCents), hint: `Equation difference ${formatSignedCents(report.totals.equationDifferenceCents)}` },
    ])}
    ${renderBalanceCheck(report.totals.equationDifferenceCents)}
    ${isLive ? DESIGNATED_FUNDS_NOTE : ''}
    ${isLive ? renderEquityReclassPanel(report.equityReclass) : ''}
    ${isLive ? renderAssetComposition(buildBalanceTree(balanceSheet.accounts)) : ''}
    ${isLive ? renderYearOverYear(balanceSheet.accounts, fiscalYear, balancePriorYear) : ''}
    ${isLive && printMode ? `${panelHeading('Full account detail', hideZero ? 'Zero-balance lines are hidden.' : '')}${renderBalanceDetailTree(balanceSheet.accounts, { hideZero }).html}` : ''}
    <p class="no-print">See <a href="${escapeHtml(balanceHref('account-detail', isLive ? { fiscal_year: fiscalYear } : {}))}">Account detail</a> and <a href="${escapeHtml(balanceHref('multi-year'))}">Multi-year position</a> for the full breakdown behind these totals.</p>`;
  return `<section class="report" aria-label="Balance Sheet position">
    ${renderSectionHeading({ eyebrow: 'Balance Sheet', heading: `Financial position as of ${escapeHtml(isLive ? asOfLabel : report.asOfDate)}`, badge })}
    ${isLive ? renderYearControls('position', selection, fiscalYear) : ''}
    ${positionBody}
    ${fallbackNote}
  </section>${canManageBalanceImport ? renderBalanceXlsxImportForm(balanceXlsxImportStatus, balanceXlsxImportMessage) : ''}`;
}
