// ── Accounts & Data -> Data & Imports ────────────────────────────────────────────────────────
// Everything Connect's legacy Data & Imports tab offers (finRenderDataImports in
// src/frontend/js-finance.js), on one page and organized the same way: connections, file imports
// with their staleness, the MDO-from-Church-Budget preview, hand-entered adjustments, destructive
// controls, classification and policy, and the raw QuickBooks output. Where Finance already has
// the workflow on another page, this page links to it rather than repeating the form, so each
// write keeps exactly one implementation. Finance's CSP allows no script: every control here is a
// plain link, a GET form, a POST form, or a <details> disclosure.
import { buildDataStatusView } from './data-status-service.js';
import { buildAccountBalances, flattenQuickbooksReport } from './quickbooks-snapshot-service.js';
import { escapeHtml, formatCents, renderSectionHeading, renderTable } from './render-helpers.js';

// Where each Connect importer (FINANCE_IMPORTERS, src/api-finance.js) lives in Finance.
export const IMPORTER_LOCATIONS = Object.freeze({
  church_budget: { label: 'Budget (single year)', href: '/?section=church&page=budget-actual', page: 'Church Report › Budget vs actual' },
  church_monthly_pnl: { label: 'Monthly P&L', href: '/?section=church&page=trend', page: 'Church Report › Multi-year trend' },
  church_activity_multi: { label: 'Statement of Activity (multi-year)', href: '/?section=church&page=trend', page: 'Church Report › Multi-year trend' },
  church_budget_multi: { label: 'Budget by Year (multi-year)', href: '/?section=church&page=trend', page: 'Church Report › Multi-year trend' },
  church_balance: { label: 'Balance Sheet', href: '/?section=balance&page=account-detail', page: 'Balance Sheet › Account detail' },
  church_balance_multi: { label: 'Financial Position (multi-year)', href: '/?section=balance&page=multi-year', page: 'Balance Sheet › Multi-year position' },
  property_monthly_csv: { label: 'AHRA monthly financials (CSV)', href: '/?section=property&page=operating-results', page: 'Commercial Property › Operating results' },
  property_budget_xlsx: { label: 'AHRA budget detail (xlsx)', href: '/?section=property&page=forecast', page: 'Commercial Property › Run-rate forecast' },
  daycare_church_budget: { label: 'MDO accounts from church budget', href: '#daycare-church-budget', page: 'This page, below' },
  daycare_bulk: { label: 'Daycare bulk paste (past years)', href: '/?section=daycare&page=actuals', page: 'Daycare Report › Actuals detail' },
});

const ADJUSTMENTS = [
  { label: 'Daycare entry (one period), edit or delete an entry', href: '/?section=daycare&page=actuals', page: 'Daycare Report › Actuals detail' },
  { label: 'Bulk-enter past daycare years', href: '/?section=daycare&page=actuals', page: 'Daycare Report › Actuals detail' },
  { label: 'Daycare Budget override for one category', href: '/?section=daycare&page=budget-comparison', page: 'Daycare Report › Budget comparison', admin: true },
  { label: 'Utilities/insurance cost share for the daycare', href: '/?section=daycare&page=shared-costs', page: 'Daycare Report › Shared costs', admin: true },
  { label: 'Property month, or paste the AHRA monthly CSV', href: '/?section=property&page=operating-results', page: 'Commercial Property › Operating results', admin: true },
  { label: 'Property distribution', href: '/?section=property&page=distributions', page: 'Commercial Property › Distributions', admin: true },
  { label: 'Reserve schedule, disbursements, base minimum', href: '/?section=property&page=reserve-distribution', page: 'Commercial Property › Reserve & distribution', admin: true },
  { label: 'Repairs and maintenance', href: '/?section=property&page=work-orders', page: 'Commercial Property › Work orders & repairs', admin: true },
  { label: 'Capital improvements', href: '/?section=property&page=capital', page: 'Commercial Property › Capital improvements', admin: true },
  { label: 'Rents, operating costs and the valuation worksheet', href: '/?section=property&page=valuation', page: 'Commercial Property › Valuation', admin: true },
  { label: 'Correct a Church Report actual', href: '/?section=church&page=income-expense', page: 'Church Report › Income & expense detail', admin: true },
];

const DESTRUCTIVE = [
  { label: 'Delete a hand-entered daycare entry', href: '/?section=daycare&page=actuals', page: 'Daycare Report › Actuals detail' },
  { label: 'Remove a property month', href: '/?section=property&page=operating-results', page: 'Commercial Property › Operating results', admin: true },
  { label: 'Remove a distribution', href: '/?section=property&page=distributions', page: 'Commercial Property › Distributions', admin: true },
  { label: 'Remove a reserve month or disbursement', href: '/?section=property&page=reserve-distribution', page: 'Commercial Property › Reserve & distribution', admin: true },
  { label: 'Remove a repair entry', href: '/?section=property&page=work-orders', page: 'Commercial Property › Work orders & repairs', admin: true },
  { label: 'Remove a capital ledger entry', href: '/?section=property&page=capital', page: 'Commercial Property › Capital improvements', admin: true },
  { label: 'Remove a Budget plan line', href: '/?section=planning&page=builder', page: 'Budget › Budget builder', admin: true },
  { label: 'Disconnect QuickBooks (revokes access and clears the report cache)', href: '/?section=quickbooks&page=sync-status', page: 'QuickBooks › Sync status', admin: true },
];

function link(href, text) {
  return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
}

function formatTimestamp(value) {
  if (!value) return 'never';
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value) ? `${value.replace(' ', 'T')}Z` : value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chicago' }).format(date);
}

function renderStatusSection(dataStatus) {
  // The status summary is one panel among several here: if it cannot be read, say so in its own
  // place instead of taking down the connections and importers below it.
  let status;
  try {
    status = buildDataStatusView(dataStatus.row, new Date(), {
      productionConnected: dataStatus.productionConnected,
      writerConnected: dataStatus.writerConnected,
    });
  } catch {
    return `<section class="report" aria-label="Data and Imports Status">
      ${renderSectionHeading({ eyebrow: 'Data & Imports', heading: 'Source and isolation status', badge: 'Data unavailable' })}
      <p class="status status-error">The data-status summary could not be read for this request. The connections and importers below are unaffected.</p>
    </section>`;
  }
  const isLive = dataStatus.source === 'live';
  return `<section class="report" aria-label="${isLive ? 'Data and Imports Status' : 'Synthetic Data and Imports Status'}">
      <div class="section-heading"><div><div class="eyebrow">Data &amp; Imports</div><h2>Source and isolation status</h2></div><span class="badge">${isLive ? 'Live from Connect' : 'Synthetic staging'}</span></div>
      <div class="grid"><div class="card"><small>${isLive ? 'Import activity' : 'Fixture source'}</small><strong>${escapeHtml(status.source)}</strong><span>${escapeHtml(status.note)}</span></div><div class="card"><small>Production connection</small><strong>${status.productionConnected ? 'Connected' : 'Disconnected'}</strong></div><div class="card"><small>QuickBooks writer</small><strong>${status.writerConnected ? 'Connected' : 'Disconnected'}</strong><span>${isLive ? 'The live finance_qb_connection state' : 'No competing staging writer'}</span></div></div>
      <div class="section-heading trend-heading"><div><div class="eyebrow">Source freshness</div><h2>${status.freshness === 'stale' ? `Review before relying on this ${isLive ? 'data' : 'fixture'}` : `${isLive ? 'Data' : 'Fixture'} is within the review window`}</h2></div><span class="badge">${status.freshness}</span></div>
      <div class="grid"><div class="card"><small>${isLive ? 'Most recent import' : 'Last fixture import'}</small><strong>${escapeHtml(status.lastImportedAt)}</strong></div><div class="card"><small>Age at request</small><strong>${status.ageDays} days</strong><span>Policy window ${status.freshnessWindowDays} days</span></div></div>
      <p><small>${isLive ? "Fetched live from Connect's real, aggregate-only finance-data-status contract endpoint." : `The committed synthetic fixture (the live endpoint is not configured or did not answer${dataStatus.fallbackReason ? `: ${escapeHtml(dataStatus.fallbackReason)}` : ''}).`}</small></p>
    </section>`;
}

function renderConnections({ quickbooksOwn, quickbooksEnabled, dataStatus, packetYear }) {
  const own = quickbooksOwn && quickbooksOwn.connected !== undefined ? quickbooksOwn : null;
  const qbConnected = own ? own.connected : !!dataStatus?.writerConnected;
  const qbDetail = own && own.connected
    ? `${escapeHtml(own.companyName || 'Company')} · last synced ${escapeHtml(formatTimestamp(own.lastSyncedAt))}`
    : (quickbooksEnabled ? 'Connect QuickBooks from the QuickBooks page.' : "Finance's own QuickBooks connection is not enabled in this environment.");
  return `<section class="report" aria-label="Connections">
    ${renderSectionHeading({ eyebrow: 'Data & Imports', heading: 'Connections', badge: 'Sources and export' })}
    <div class="grid">
      <div class="card"><small>QuickBooks</small><strong>${qbConnected ? 'Connected' : 'Not connected'}</strong><span>${qbDetail}</span>
        <span>${link('/?section=quickbooks&page=sync-status', 'Connect, sync, sync years')} · ${link('/?section=quickbooks&page=transactions', 'Transactions')} · ${link('/?section=quickbooks&page=import-history', 'Import history')}</span></div>
      <div class="card"><small>Daycare app</small><strong>Synced through Connect</strong><span>Money syncs per period from the daycare app's finance API; room figures sync separately. Hand-entered rows are never replaced by a sync.</span>
        <span>${link('/?section=daycare&page=overview', 'Sync money or room data')}</span></div>
      <div class="card"><small>Board packet</small><strong>JSON export</strong><span>The year's income statement, balance sheet, five-year trends and the full daycare ledger in one file, for an analyst to summarize.</span>
        <form method="GET" action="/api/v1/board-packet-export" class="inline-form"><label for="bp-year">Year</label> <input id="bp-year" type="number" name="year" min="2000" max="2100" step="1" value="${escapeHtml(String(packetYear))}" required> <button type="submit">Download packet (JSON)</button></form>
        <span>${link('/?section=packet', 'Printable board packet')}</span></div>
    </div>
  </section>`;
}

function renderImporterRow(importer) {
  const where = IMPORTER_LOCATIONS[importer.key];
  let when;
  if (importer.lastImportedAt && importer.derived) {
    when = `~${escapeHtml(formatTimestamp(importer.lastImportedAt))} <small>(from the data${importer.note ? `, ${escapeHtml(importer.note)}` : ''})</small>`;
  } else if (importer.lastImportedAt) {
    when = escapeHtml(formatTimestamp(importer.lastImportedAt));
  } else {
    when = '<strong class="status-error">never</strong>';
  }
  return `<tr><td>${escapeHtml(importer.label)}</td><td>${when}</td><td>${where ? link(where.href, where.page) : '—'}</td></tr>`;
}

function renderImports(importStatus, canManage) {
  const heading = renderSectionHeading({ eyebrow: 'Data & Imports', heading: 'File imports', badge: 'Last import per feed' });
  if (!importStatus?.ok) {
    return `<section class="report" aria-label="File imports">${heading}
      <p class="status status-pending">Import dates could not be read right now${importStatus?.reason ? ` (${escapeHtml(importStatus.reason)})` : ''}. The importers themselves still work from the pages linked below.</p>
      ${renderTable({ head: ['Import', 'Where'], rows: Object.values(IMPORTER_LOCATIONS).map((where) => `<tr><td>${escapeHtml(where.label)}</td><td>${link(where.href, where.page)}</td></tr>`).join('') })}
    </section>`;
  }
  const group = (name) => importStatus.importers.filter((importer) => importer.group === name).map(renderImporterRow).join('')
    || '<tr><td colspan="3">No importers in this group.</td></tr>';
  return `<section class="report" aria-label="File imports">${heading}
    <p><small>Grouped by what they feed, with the last import date, so a stale feed is visible without opening its report. A date marked <em>from the data</em> predates the import log and was read off the imported rows themselves.${canManage ? '' : ' Only admins can run imports.'} Each importer previews what it found before anything is saved.</small></p>
    <h3>Feeds Church Report</h3>
    ${renderTable({ head: ['Import', 'Last import', 'Where it runs'], rows: group('church') })}
    <h3>Feeds Ivanhoe &amp; Daycare</h3>
    ${renderTable({ head: ['Import', 'Last import', 'Where it runs'], rows: group('other') })}
    <p><small>The daycare utilities/insurance cost share is set on ${link('/?section=daycare&page=shared-costs', 'Daycare Report › Shared costs')}.</small></p>
  </section>`;
}

// The Church-Budget -> Daycare import with its preview step (legacy finDaycareChurchBudgetPreview):
// a GET form asks for connect.finance-daycare-church-budget-preview.v1 (no write), and only then
// does an admin see the POST that commits exactly that year through the existing
// finance-daycare-church-budget-import-write-v1 relay. The commit re-extracts the same rows on
// Connect's side, replacing that year's church_budget_import rows; hand-entered and daycare-app
// rows are untouched. Shared by Data & Imports and Daycare Report › Actuals detail.
export function renderDaycareChurchBudgetPreview({ year, preview, canManage, importStatus, importMessage, returnSection = 'data' }) {
  const action = returnSection === 'daycare' ? { section: 'daycare', page: 'actuals' } : { section: 'data' };
  const hidden = Object.entries(action).map(([name, value]) => `<input type="hidden" name="${name}" value="${value}">`).join('');
  let body = '';
  if (year && preview) {
    if (!preview.ok) {
      body = `<p class="status status-error">The preview could not be read right now (${escapeHtml(preview.reason || 'unknown')}). Nothing was imported.</p>`;
    } else if (!preview.preview.available) {
      body = `<p class="status status-error">${escapeHtml(preview.preview.message)}</p>`;
    } else if (!preview.preview.found) {
      body = `<p class="status status-pending">${escapeHtml(preview.preview.message || `No MDO-tagged accounts found for ${year}.`)}</p>`;
    } else {
      const p = preview.preview;
      const rows = p.byCategory.map((row) => `<tr><td>${escapeHtml(row.category)}</td><td>${formatCents(row.actualCents)}</td><td>${formatCents(row.budgetCents)}</td></tr>`).join('');
      body = `<p>Found ${p.found} daycare ${p.found === 1 ? 'entry' : 'entries'} for FY${p.fiscalYear}. Importing replaces that year's Church-Budget-derived rows; hand-entered and daycare-app rows are untouched.</p>
      ${renderTable({ head: ['Daycare category', 'Actual', 'Budget'], rows })}
      <details><summary>Accounts behind these totals (${p.found})</summary>${renderTable({ head: ['Category', 'Type', 'Amount', 'Source account'], rows: p.entries.map((e) => `<tr><td>${escapeHtml(e.category)}</td><td>${e.entryType === 'budget' ? 'Budget' : 'Actual'}</td><td>${formatCents(e.amountCents)}</td><td>${escapeHtml(e.notes)}</td></tr>`).join('') })}</details>
      ${canManage ? `<form method="POST" action="/api/v1/connect-daycare-church-budget-import-write"><input type="hidden" name="year" value="${p.fiscalYear}"><input type="hidden" name="return_to" value="${returnSection}"><button type="submit">Import these ${p.found} ${p.found === 1 ? 'entry' : 'entries'}</button></form>` : '<p><small>Only admins can import.</small></p>'}`;
    }
  }
  return `<section class="report" id="daycare-church-budget" aria-label="MDO accounts from an imported church budget">
    ${renderSectionHeading({ eyebrow: 'Feeds Daycare', heading: 'MDO accounts from an imported church budget', badge: 'Preview before import' })}
    ${importStatus === 'ok' ? '<p class="status status-ok">Imported from the Church Budget in Connect.</p>' : ''}
    ${importStatus === 'error' ? `<p class="status status-error">Not imported: ${escapeHtml(importMessage || 'unknown error')}</p>` : ''}
    <p><small>Pulls the Mother's Day Out line items (any account with "MDO" or "Mother's Day Out" in its name) out of a Church Report budget already imported for that year, and sorts them into the Daycare Report's categories.</small></p>
    <form method="GET" action="/" class="inline-form">${hidden}<label for="dc-cb-year-${returnSection}">Church budget year</label> <input id="dc-cb-year-${returnSection}" type="number" name="dc_cb_year" min="2000" max="2100" step="1" value="${year ? escapeHtml(String(year)) : ''}" required> <button type="submit">Preview</button></form>
    ${body}
  </section>`;
}

function renderLinkList(ariaLabel, eyebrow, heading, badge, items, canManage, note) {
  const rows = items.map((item) => `<tr><td>${escapeHtml(item.label)}</td><td>${link(item.href, item.page)}</td><td>${item.admin ? 'Admin' : 'Finance edit'}</td></tr>`).join('');
  return `<section class="report" aria-label="${ariaLabel}">
    ${renderSectionHeading({ eyebrow, heading, badge })}
    <p><small>${note}${canManage ? '' : ' Controls marked Admin appear only for admins.'}</small></p>
    ${renderTable({ head: ['What', 'Where', 'Who'], rows })}
  </section>`;
}

function formatReportCell(value) {
  if (!value || /%\s*$/.test(value) || !/^-?\d+(\.\d+)?$/.test(value.trim())) return value;
  return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderRawQuickbooks(snapshot, quickbooksEnabled) {
  const heading = renderSectionHeading({ eyebrow: 'Data & Imports', heading: 'Raw QuickBooks output', badge: 'Diagnostic' });
  if (!quickbooksEnabled) {
    return `<section class="report" aria-label="Raw QuickBooks output">${heading}<p class="status status-pending">Finance's own QuickBooks connection is not enabled in this environment, so there is no report cache to show.</p></section>`;
  }
  if (!snapshot || snapshot.ok === false) {
    return `<section class="report" aria-label="Raw QuickBooks output">${heading}<p class="status status-pending">The cached QuickBooks reports could not be read right now. Nothing was changed.</p></section>`;
  }
  let budget;
  if (!snapshot.budgetVsActual || !snapshot.budgetVsActual.Rows) {
    budget = '<p>No budget data yet. Connect QuickBooks and sync from the QuickBooks page; a Budget must exist in QuickBooks under Settings › Budgeting.</p>';
  } else {
    const report = flattenQuickbooksReport(snapshot.budgetVsActual);
    const rows = report.rows.map((row) => `<tr${row.total ? ' class="total-row"' : ''}>${row.cells.map((cell, index) => (index === 0
      ? `<td style="padding-left:${0.5 + row.depth}rem">${row.total ? `<strong>${escapeHtml(cell)}</strong>` : escapeHtml(cell)}</td>`
      : `<td>${row.total ? `<strong>${escapeHtml(formatReportCell(cell))}</strong>` : escapeHtml(formatReportCell(cell))}</td>`)).join('')}</tr>`).join('');
    budget = `${report.synthesized ? '<p><small>Reconstructed from the QuickBooks Budget entity and Profit and Loss report, because the native Budget vs. Actual report is unreliable. Year-to-date totals, not a monthly breakdown.</small></p>' : ''}
      <p><small>Synced ${escapeHtml(formatTimestamp(snapshot.budgetSyncedAt))}</small></p>
      ${renderTable({ head: report.columns, rows })}`;
  }
  const balances = buildAccountBalances(snapshot);
  const accounts = balances.accounts.length
    ? `<p><small>QuickBooks synced ${escapeHtml(formatTimestamp(snapshot.accountsSyncedAt))}${balances.hasDaycare ? ` · Daycare app synced ${escapeHtml(formatTimestamp(snapshot.daycareAccountsSyncedAt))}` : ''}</small></p>
      ${renderTable({ head: ['Account', 'Type', 'Source', 'Balance'], rows: `${balances.accounts.map((a) => `<tr><td>${escapeHtml(a.name)}</td><td>${escapeHtml(a.type)}</td><td>${escapeHtml(a.source)}</td><td>${formatExactCents(a.balanceCents)}</td></tr>`).join('')}<tr class="total-row"><td colspan="3"><strong>Total</strong></td><td><strong>${formatExactCents(balances.totalCents)}</strong></td></tr>` })}`
    : '<p>No account balance data yet. Sync QuickBooks (or the daycare app) first.</p>';
  return `<section class="report" aria-label="Raw QuickBooks output">${heading}
    <p><small>What QuickBooks actually returned at the last sync, for checking a figure that looks wrong. The Church Report is the reading version of the same data. Read from Finance's own report cache; opening this page never calls QuickBooks.</small></p>
    <details><summary>Budget vs. Actual</summary>${budget}</details>
    <details><summary>Account balances</summary>${accounts}</details>
  </section>`;
}

function formatExactCents(cents) {
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(cents) / 100);
  return cents < 0 ? `−${amount}` : amount;
}

export function renderDataPage({
  dataStatus, importStatus, quickbooksOwn, quickbooksEnabled, quickbooksSnapshot,
  daycarePreviewYear, daycarePreview, daycareImportStatus, daycareImportMessage,
  canManage, packetYear, classificationHtml,
}) {
  return `${renderStatusSection(dataStatus)}
    ${renderConnections({ quickbooksOwn, quickbooksEnabled, dataStatus, packetYear })}
    ${renderImports(importStatus, canManage)}
    ${renderDaycareChurchBudgetPreview({ year: daycarePreviewYear, preview: daycarePreview, canManage, importStatus: daycareImportStatus, importMessage: daycareImportMessage })}
    ${renderLinkList('Hand-entered adjustments', 'Data & Imports', 'Hand-entered adjustments', 'Daycare, property, corrections', ADJUSTMENTS, canManage, 'Figures typed in by hand. Each form lives beside the report it changes.')}
    ${renderLinkList('Destructive controls', 'Data & Imports', 'Remove or disconnect', 'Cannot be undone', DESTRUCTIVE, canManage, 'Each removal deletes the record from the shared accounting database and cannot be undone. Each control sits beside the record it removes.')}
    ${classificationHtml}
    <section class="report" aria-label="Cash reserve policy">
      ${renderSectionHeading({ eyebrow: 'Classification & policy', heading: 'Cash reserve policy', badge: 'Financial Health' })}
      <p>The reserve floor, operating-cash account and General Fund budget code behind the cash runway are edited on ${link('/?section=charts&page=cash-reserve', 'Charts › Cash & reserve')}${canManage ? '' : ' (admins only)'}. Board categories and purpose tags are edited on ${link('/?section=accounts&page=chart', 'Chart of Accounts')}.</p>
    </section>
    ${renderRawQuickbooks(quickbooksSnapshot, quickbooksEnabled)}`;
}
