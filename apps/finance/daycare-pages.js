import { buildDaycareReportView, buildLiveDaycareReportView } from './daycare-report-service.js';
import { renderDaycareChurchBudgetPreview } from './data-pages.js';
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

// Bulk paste-in write -- relayed live to Connect's real finance_daycare_entries table (see
// finance-daycare-bulk-write-v1 in src/api-contracts-service.js), never stored in Finance's own
// database. A paste-in alternative to the one-row-at-a-time form above, for entering past years the
// daycare app's own API has no history for. Same looser gate as the single-entry form above -- shown
// to any verified viewer who can reach the Daycare section at all.
function renderDaycareBulkForm(bulkStatus, bulkMessage) {
  return `<section aria-label="Bulk-paste Daycare Report entries">
    ${renderSectionHeading({ eyebrow: 'Daycare Report', heading: 'Bulk-paste entries', badge: 'Relayed live to Connect' })}
    ${bulkStatus === 'ok' ? '<p class="status">Rows recorded in Connect.</p>' : ''}
    ${bulkStatus === 'error' ? `<p class="status status-error">Not recorded: ${escapeHtml(bulkMessage || 'unknown error')}</p>` : ''}
    <form method="POST" action="/api/v1/connect-daycare-bulk-write">
      <div class="field"><label for="dc-bulk-rows">One row per line: period,category,entry_type,amount,notes</label><textarea id="dc-bulk-rows" name="rows" rows="6" placeholder="2025,Tuition Income,actual,142000,\n2025,Utilities,budget,18000,imported estimate" required></textarea></div>
      <button type="submit">Import rows</button>
    </form>
    <p><small>Amount is whole dollars; entry_type defaults to "actual" if omitted. All-or-nothing: any invalid row rejects the whole paste.</small></p>
  </section>`;
}

// Utilities/Insurance cost-share config -- relayed live to Connect's real finance_settings key
// (see finance-daycare-allocation-config-write-v1 in src/api-contracts-service.js). Admin-only,
// matching the legacy in-Connect Daycare Report's own allocation-config PUT route.
function renderDaycareAllocationConfigForm(utilityPct, insurancePct, configStatus, configMessage) {
  return `<section aria-label="Edit the Utilities/Insurance cost-share config">
    ${renderSectionHeading({ eyebrow: 'Daycare Report', heading: 'Edit cost-share config', badge: 'Relayed live to Connect' })}
    ${configStatus === 'ok' ? '<p class="status">Saved in Connect.</p>' : ''}
    ${configStatus === 'error' ? `<p class="status status-error">Not saved: ${escapeHtml(configMessage || 'unknown error')}</p>` : ''}
    <form method="POST" action="/api/v1/connect-daycare-allocation-config-write">
      <div class="grid form-grid">
        <div class="field"><label for="dc-util-pct">Utilities share (0-1, e.g. 0.5 for 50%)</label><input id="dc-util-pct" type="number" name="utility_pct" step="0.01" min="0" max="1" value="${escapeHtml(String(utilityPct))}" required></div>
        <div class="field"><label for="dc-ins-pct">Insurance share (0-1, e.g. 0.5 for 50%)</label><input id="dc-ins-pct" type="number" name="insurance_pct" step="0.01" min="0" max="1" value="${escapeHtml(String(insurancePct))}" required></div>
      </div>
      <button type="submit">Save cost-share config</button>
    </form>
    <p><small>This writes directly into Connect's own <code>finance_settings</code> row -- the same config the legacy in-Connect Daycare Report edits.</small></p>
  </section>`;
}

// Per-(year,category) Budget-cell override -- relayed live to Connect's real finance_daycare_entries
// table (see finance-daycare-budget-override-write-v1 in src/api-contracts-service.js). Admin-only,
// matching the legacy in-Connect Daycare Report's own budget-override POST route. Leaving the
// amount blank clears any existing override for that cell.
function renderDaycareBudgetOverrideForm(period, overrideStatus, overrideMessage) {
  return `<section aria-label="Override a Daycare Report Budget figure">
    ${renderSectionHeading({ eyebrow: 'Daycare Report', heading: 'Override a Budget figure', badge: 'Relayed live to Connect' })}
    ${overrideStatus === 'ok' ? '<p class="status">Saved in Connect.</p>' : ''}
    ${overrideStatus === 'error' ? `<p class="status status-error">Not saved: ${escapeHtml(overrideMessage || 'unknown error')}</p>` : ''}
    <form method="POST" action="/api/v1/connect-daycare-budget-override-write">
      <div class="grid form-grid">
        <div class="field"><label for="dc-bo-year">Year</label><input id="dc-bo-year" type="number" name="year" step="1" placeholder="${escapeHtml(String(period))}" value="${escapeHtml(String(period))}" required></div>
        <div class="field"><label for="dc-bo-category">Category</label><input id="dc-bo-category" type="text" name="category" required></div>
        <div class="field"><label for="dc-bo-budget">Budget ($, whole dollars -- blank clears)</label><input id="dc-bo-budget" type="number" name="budget" step="1"></div>
      </div>
      <button type="submit">Save Budget override</button>
    </form>
    <p><small>Actual always comes from the imported Church Budget; this only ever touches the Budget side of one (year, category) cell, and takes precedence over any Budget figure the Church-Budget import also brought in for that cell.</small></p>
  </section>`;
}

// Two "Sync now" triggers -- relayed live to Connect, which itself pulls from the daycare app's
// own finance API (see finance-daycare-sync-v1/finance-daycare-rooms-sync-v1 in
// src/api-contracts-service.js). Neither takes any fields; a bare POST triggers the pull. Money
// sync uses the same looser gate as the entry/bulk forms above (the legacy finance/daycare/sync
// route carries no role check of its own beyond the blanket ACCESS_GATE); room sync is admin-only,
// matching finance/daycare/rooms/sync's own explicit isAdmin check exactly. If the daycare app
// itself isn't configured on Connect's side, the error message shown here is Connect's own "not
// configured" message, passed straight through rather than reworded into a relay-specific failure.
function renderDaycareSyncForms({
  canSyncDaycare, syncStatus, syncMessage,
  canSyncDaycareRooms, roomsSyncStatus, roomsSyncMessage,
}) {
  if (!canSyncDaycare && !canSyncDaycareRooms) return '';
  return `<section aria-label="Sync Daycare Report data from the daycare app">
    ${renderSectionHeading({ eyebrow: 'Daycare Report', heading: 'Sync from the daycare app', badge: 'Relayed live to Connect' })}
    ${canSyncDaycare ? `<form method="POST" action="/api/v1/connect-daycare-sync">
      ${syncStatus === 'ok' ? '<p class="status">Synced in Connect.</p>' : ''}
      ${syncStatus === 'error' ? `<p class="status status-error">Not synced: ${escapeHtml(syncMessage || 'unknown error')}</p>` : ''}
      <button type="submit">Sync money data now</button>
    </form>` : ''}
    ${canSyncDaycareRooms ? `<form method="POST" action="/api/v1/connect-daycare-rooms-sync">
      ${roomsSyncStatus === 'ok' ? '<p class="status">Room data synced in Connect.</p>' : ''}
      ${roomsSyncStatus === 'error' ? `<p class="status status-error">Not synced: ${escapeHtml(roomsSyncMessage || 'unknown error')}</p>` : ''}
      <button type="submit">Sync room data now</button>
    </form>` : ''}
    <p><small>Pulls the latest figures from the daycare app's own finance API and wholesale-replaces the daycare-app-sourced rows for the periods it returns. Hand-entered and Church-Budget-derived rows are never touched by this.</small></p>
  </section>`;
}

// `daycareReport` here is resolveDaycareReport()'s result -- { source: 'live', fiscalYear,
// categories, allocation, totals } or { source: 'synthetic-fallback', fallbackReason, rows,
// allocation } -- never the raw synthetic row array daycare-pages.js used to receive directly.
// Individual finance_daycare_entries rows for the live fiscal year (connect.finance-daycare-entries.v1),
// with legacy finRenderDaycare's actions: Edit on every row, Delete on every row except those the
// daycare app's own sync owns (a re-sync would recreate them). Both relay to the existing
// finance-daycare-entry-edit/-remove contracts, whose permission check on Connect is the real gate.
const DAYCARE_SOURCE_LABELS = {
  manual: 'Manual', daycare_api: 'Daycare app', church_budget_import: 'Church budget import',
  manual_budget_override: 'Budget override',
};

function renderDaycareEntryRows(entries, canManage) {
  return entries.map((e) => `<tr><td>${escapeHtml(e.period)}</td><td>${escapeHtml(e.category)}</td><td>${e.entryType === 'budget' ? 'Budget' : 'Actual'}</td><td>${formatCents(e.amountCents)}</td><td>${escapeHtml(DAYCARE_SOURCE_LABELS[e.source] || e.source)}</td><td>${escapeHtml(e.notes)}</td>${canManage ? `<td><a href="/?section=daycare&amp;page=actuals&amp;edit=${e.id}#daycare-edit">Edit</a>${e.source === 'daycare_api' ? '' : ` <form method="POST" action="/api/v1/connect-daycare-entry-remove" style="display:inline">
      <input type="hidden" name="id" value="${e.id}">
      <button type="submit" onclick="return confirm('Delete this daycare entry?')">Delete</button>
    </form>`}</td>` : ''}</tr>`).join('');
}

function renderDaycareEntryEditForm(entry) {
  return `<section id="daycare-edit" aria-label="Edit a Daycare Report entry">
    ${renderSectionHeading({ eyebrow: 'Daycare Report', heading: `Edit entry · ${escapeHtml(entry.period)} ${escapeHtml(entry.category)}`, badge: 'Relayed live to Connect' })}
    <form method="POST" action="/api/v1/connect-daycare-entry-edit">
      <input type="hidden" name="id" value="${entry.id}">
      <div class="grid form-grid">
        <div class="field"><label for="dce-period">Period (YYYY or YYYY-MM)</label><input id="dce-period" type="text" name="period" pattern="\\d{4}(-\\d{2})?" value="${escapeHtml(entry.period)}" required></div>
        <div class="field"><label for="dce-category">Category</label><input id="dce-category" type="text" name="category" value="${escapeHtml(entry.category)}" required></div>
        <div class="field"><label for="dce-type">Type</label><select id="dce-type" name="entry_type"><option value="actual"${entry.entryType === 'actual' ? ' selected' : ''}>Actual</option><option value="budget"${entry.entryType === 'budget' ? ' selected' : ''}>Budget</option></select></div>
        <div class="field"><label for="dce-amount">Amount ($)</label><input id="dce-amount" type="number" name="amount" step="0.01" value="${(entry.amountCents / 100).toFixed(2)}" required></div>
      </div>
      <div class="field"><label for="dce-notes">Notes</label><input id="dce-notes" type="text" name="notes" value="${escapeHtml(entry.notes)}"></div>
      <button type="submit">Save changes</button> <a href="/?section=daycare&amp;page=actuals">Cancel</a>
    </form>
    ${entry.source === 'daycare_api' ? '<p><small>This row came from the daycare app. A later sync may replace your edit, as it does in legacy Connect.</small></p>' : ''}
  </section>`;
}

function renderDaycareEntryList(daycareEntries, daycareEditId, canManage) {
  if (!daycareEntries) return '';
  if (!daycareEntries.ok) {
    return `<section aria-label="Daycare entries"><p><small>The individual entry list is unavailable right now (${escapeHtml(daycareEntries.reason || 'unknown')}). Totals above are unaffected.</small></p></section>`;
  }
  const editing = canManage && daycareEditId ? daycareEntries.entries.find((e) => e.id === daycareEditId) : null;
  return `<section class="report" aria-label="Daycare entries">
    ${renderSectionHeading({ eyebrow: 'Daycare Report', heading: 'Entries', badge: `${daycareEntries.entries.length} row${daycareEntries.entries.length === 1 ? '' : 's'}` })}
    ${daycareEntries.entries.length
      ? renderTable({ head: ['Period', 'Category', 'Type', 'Amount', 'Source', 'Notes', ...(canManage ? [''] : [])], rows: renderDaycareEntryRows(daycareEntries.entries, canManage) })
      : '<p>No entries recorded for this fiscal year.</p>'}
  </section>${editing ? renderDaycareEntryEditForm(editing) : ''}`;
}

export function renderDaycarePage(pageId, {
  daycareReport, daycareEntries = null, daycareEditId = null, canRecordDaycareEntry, canImportDaycareChurchBudget = false, daycareEntryStatus, daycareEntryMessage,
  canManageDaycareAllocation, daycareAllocationConfigEntryStatus, daycareAllocationConfigEntryMessage,
  canManageDaycareBudgetOverride, daycareBudgetOverrideEntryStatus, daycareBudgetOverrideEntryMessage,
  daycareBulkEntryStatus, daycareBulkEntryMessage,
  daycareChurchBudgetImportEntryStatus, daycareChurchBudgetImportEntryMessage,
  daycarePreviewYear = null, daycarePreview = null,
  canSyncDaycare, daycareSyncStatus, daycareSyncMessage,
  canSyncDaycareRooms, daycareRoomsSyncStatus, daycareRoomsSyncMessage,
}) {
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
    </section>${renderDaycareEntryList(daycareEntries, daycareEditId, canRecordDaycareEntry)}${canRecordDaycareEntry ? renderDaycareEntryForm(report.period, daycareEntryStatus, daycareEntryMessage) : ''}
    ${canRecordDaycareEntry ? renderDaycareBulkForm(daycareBulkEntryStatus, daycareBulkEntryMessage) : ''}
    ${canImportDaycareChurchBudget ? renderDaycareChurchBudgetPreview({
      year: daycarePreviewYear, preview: daycarePreview, canManage: true, returnSection: 'daycare',
      importStatus: daycareChurchBudgetImportEntryStatus, importMessage: daycareChurchBudgetImportEntryMessage,
    }) : ''}`;
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
    </section>${canManageDaycareBudgetOverride ? renderDaycareBudgetOverrideForm(report.period, daycareBudgetOverrideEntryStatus, daycareBudgetOverrideEntryMessage) : ''}`;
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
    </section>${canManageDaycareAllocation ? renderDaycareAllocationConfigForm(utilityPct, insurancePct, daycareAllocationConfigEntryStatus, daycareAllocationConfigEntryMessage) : ''}`;
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
  </section>${renderDaycareSyncForms({
    canSyncDaycare, syncStatus: daycareSyncStatus, syncMessage: daycareSyncMessage,
    canSyncDaycareRooms, roomsSyncStatus: daycareRoomsSyncStatus, roomsSyncMessage: daycareRoomsSyncMessage,
  })}`;
}
