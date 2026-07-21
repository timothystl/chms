export const JS_FINANCE = String.raw`// ── FINANCE OVERVIEW ─────────────────────────────────────────────────
// Unifies QuickBooks Online (Budget vs Actual + account balances, live OAuth sync) and
// daycare financials (manual entries — no known daycare-app API/export yet) in one tab.
var _finStatus = {};
var _finDaycare = [];
var _finOverview = {};
var _finDaycareAgg = null; // last computed finAggregateDaycareByYear() result, cached for CSV export

function loadFinance() {
  finCheckOauthReturn();
  var loadingEl = document.getElementById('fin-loading');
  var rootEl = document.getElementById('fin-root');
  loadingEl.style.display = '';
  loadingEl.textContent = 'Loading…';
  rootEl.style.display = 'none';
  Promise.all([
    api('/admin/api/finance/status'),
    api('/admin/api/finance/overview'),
    api('/admin/api/finance/daycare'),
  ]).then(function(results) {
    _finStatus = results[0] || {};
    var overview = results[1] || {};
    _finDaycare = (results[2] && results[2].entries) || [];
    _finOverview = overview;
    loadingEl.style.display = 'none';
    rootEl.style.display = '';
    finRenderConnection();
    finRenderBudget(overview);
    finRenderAccounts(overview);
    finRenderDaycare();
    finRenderChurchReport();
    finRenderDaycareReport();
    finLoadProperty();
    finLoadPlanning();
  }).catch(function(err) {
    if (err && err.message === 'Unauthorized') return;
    loadingEl.textContent = 'Could not load finance data.';
  });
}

// ── Sub-nav: Overview / Church Report / Daycare Report ─────────────────────────────────
// Button active-state is handled by the shared renderFinanceSubnav() (js-core.js) re-render,
// driven by showTab()'s _finActiveNavId — this only toggles panel visibility.
function finShowSection(section) {
  ['overview', 'church', 'daycare', 'property', 'planning'].forEach(function(s) {
    var panel = document.getElementById('fin-panel-' + s);
    if (panel) panel.style.display = (s === section) ? '' : 'none';
  });
}
// Lazy-init for the Giving tab's Reports view (moved there from the Finance tab — see
// givSetView() in js-giving.js) — mirrors initReportTrendYears()'s own idempotent guard, safe
// to call every time this view is shown. initReportTrendYears() is defined in js-reports.js
// (loaded earlier in the module concatenation order) and already no-ops harmlessly if its
// target element isn't found.
function finInitGivingReports() {
  initReportTrendYears();
  var curY = new Date().getFullYear();
  var yoyEl = document.getElementById('rpt-yoy-year');
  if (yoyEl && !yoyEl.value) yoyEl.value = curY;
  var insightsEl = document.getElementById('rpt-insights-year');
  if (insightsEl && !insightsEl.value) insightsEl.value = curY;
}

// QuickBooks redirects back to '/?qb_connected=1#finance' (or qb_error=...) after the OAuth
// consent screen — read the plain query string (not the hash) so the SPA's hash-based tab
// router is never handed anything but a clean '#finance'.
function finCheckOauthReturn() {
  var params = new URLSearchParams(location.search);
  var connected = params.get('qb_connected');
  var error = params.get('qb_error');
  if (!connected && !error) return;
  history.replaceState(null, '', location.pathname + location.hash);
  if (connected) finToast('QuickBooks connected. Click "Sync Now" to pull your data.');
  else finToast('QuickBooks connection failed: ' + error);
}
function finToast(msg) {
  var el = document.getElementById('fin-toast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(function() { el.style.display = 'none'; }, 8000);
}

// ── QuickBooks connection card ───────────────────────────────────────
function finRenderConnection() {
  var el = document.getElementById('fin-connection');
  if (!_finStatus.configured) {
    el.innerHTML = '<p style="color:var(--warm-gray);font-size:.85rem;">QuickBooks is not configured yet. An admin needs to add <code>QB_CLIENT_ID</code> and <code>QB_CLIENT_SECRET</code> (see SECRETS.md) from an Intuit Developer app before connecting.</p>';
    return;
  }
  var isAdminUI = (_userRole === 'admin');
  if (!_finStatus.connected) {
    el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);margin:0 0 10px;">Not connected.</p>'
      + (isAdminUI
        ? '<a class="btn-primary" style="display:inline-block;text-decoration:none;" href="/admin/api/finance/qb/connect">Connect QuickBooks</a>'
        : '<p style="font-size:.78rem;color:var(--warm-gray);">Ask an admin to connect QuickBooks.</p>');
    return;
  }
  var lastSync = _finStatus.lastSyncedAt ? finFmtTs(_finStatus.lastSyncedAt) : 'never';
  el.innerHTML =
    '<p style="font-size:.9rem;margin:0 0 4px;"><b>' + esc(_finStatus.companyName || 'Connected') + '</b></p>'
    + '<p style="font-size:.78rem;color:var(--warm-gray);margin:0 0 10px;">Last synced: ' + esc(lastSync) + '</p>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
    + '<button class="btn-primary" onclick="finSync(this)">Sync Now</button>'
    + (isAdminUI ? '<button class="btn-secondary" onclick="finDisconnect()">Disconnect</button>' : '')
    + '</div>'
    + '<div id="fin-sync-msg" style="font-size:.78rem;margin-top:8px;"></div>';
}
function finFmtTs(iso) {
  try { return new Date(iso).toLocaleString('en-US', {dateStyle: 'medium', timeStyle: 'short'}); }
  catch (e) { return iso; }
}
function finSync(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  api('/admin/api/finance/qb/sync', { method: 'POST' }).then(function(d) {
    if (btn) { btn.disabled = false; btn.textContent = 'Sync Now'; }
    if (d && d.error) { finToast('Sync failed: ' + d.error); return; }
    if (d && d.warnings && d.warnings.length) finToast('Synced with warnings: ' + d.warnings.join(' '));
    else finToast('Synced successfully.');
    loadFinance();
  }).catch(function(err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Sync Now'; }
    finToast('Sync failed: ' + (err && err.message || 'Unknown error'));
  });
}
function finDisconnect() {
  if (!confirm('Disconnect QuickBooks? You can reconnect later, but cached report data will be cleared.')) return;
  api('/admin/api/finance/qb/disconnect', { method: 'POST' }).then(function() { loadFinance(); });
}

// ── Budget vs Actual — generic renderer for QuickBooks' Columns/Rows report shape ──
// QBO's own column set varies by report/params, so this walks whatever it returns rather
// than assuming fixed "budget"/"actual" columns. Section rows carry their label in
// Header.ColData, children in Rows.Row, and a subtotal in Summary.ColData; leaf (Data) rows
// carry their values directly in ColData.
function finRenderBudget(overview) {
  var el = document.getElementById('fin-budget');
  var report = overview.budgetVsActual;
  if (!report || !report.Rows) {
    el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">No budget data yet. Connect QuickBooks and click "Sync Now" — make sure a Budget is set up in QuickBooks under Settings &gt; Budgeting first.</p>';
    return;
  }
  var cols = (report.Columns && report.Columns.Column) || [];
  var theadCells = cols.map(function(c, i) {
    return '<th style="text-align:' + (i === 0 ? 'left' : 'right') + ';padding:6px 8px;">' + esc(c.ColTitle || '') + '</th>';
  }).join('');
  var rowsHtml = finRenderReportRows((report.Rows && report.Rows.Row) || [], 0);
  var fallbackNote = report._synthesized
    ? '<div style="font-size:.72rem;color:#8A5A12;background:var(--pale-gold);border-radius:6px;padding:6px 10px;margin-bottom:8px;">Reconstructed from the raw Budget entity + Profit and Loss report because QuickBooks\' standard Budget vs Actual report returned an error for this account. Shows year-to-date totals, not a monthly breakdown.</div>'
    : '';
  el.innerHTML =
    fallbackNote
    + '<div style="font-size:.72rem;color:var(--warm-gray);margin-bottom:8px;">Synced ' + esc(overview.budgetSyncedAt ? finFmtTs(overview.budgetSyncedAt) : 'never') + '</div>'
    + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr>' + theadCells + '</tr></thead>'
    + '<tbody>' + rowsHtml + '</tbody></table></div>';
}
function finRenderReportRows(rows, depth) {
  var html = '';
  rows.forEach(function(row) {
    if (row.type === 'Section') {
      var headerCells = (row.Header && row.Header.ColData) || [];
      if (headerCells.length) html += finRenderReportRow(headerCells, depth, false);
      if (row.Rows && row.Rows.Row) html += finRenderReportRows(row.Rows.Row, depth + 1);
      var summaryCells = (row.Summary && row.Summary.ColData) || [];
      if (summaryCells.length) html += finRenderReportRow(summaryCells, depth, true);
    } else {
      var cells = row.ColData || [];
      if (cells.length) html += finRenderReportRow(cells, depth, false);
    }
  });
  return html;
}
function finRenderReportRow(cells, depth, bold) {
  var tds = cells.map(function(c, i) {
    var align = i === 0 ? 'left' : 'right';
    var leftPad = 10 + depth * 16;
    return '<td style="text-align:' + align + ';padding:5px 8px 5px ' + (i === 0 ? leftPad : 8) + 'px;">' + esc(c.value || '') + '</td>';
  }).join('');
  return '<tr' + (bold ? ' style="font-weight:600;border-top:1px solid var(--navy);"' : '') + '>' + tds + '</tr>';
}

// ── Account balances — merges QuickBooks accounts with daycare-app accounts (if synced) ──
function finRenderAccounts(overview) {
  var el = document.getElementById('fin-accounts');
  var qboList = ((overview.accounts && overview.accounts.QueryResponse && overview.accounts.QueryResponse.Account) || [])
    .map(function(a) { return { name: a.Name || '', type: a.AccountSubType || a.AccountType || '', balance: Number(a.CurrentBalance) || 0, source: 'QuickBooks' }; });
  var dcList = (overview.daycareAccounts || [])
    .map(function(a) { return { name: a.name || '', type: 'Daycare', balance: (Number(a.balance_cents) || 0) / 100, source: 'Daycare App' }; });
  var all = qboList.concat(dcList);
  if (!all.length) {
    el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">No account balance data yet. Connect QuickBooks (or sync the daycare app below) and click "Sync Now".</p>';
    return;
  }
  all.sort(function(a, b) { return a.source.localeCompare(b.source) || a.name.localeCompare(b.name); });
  var rowsHtml = all.map(function(a) {
    return '<tr><td style="padding:5px 8px;">' + esc(a.name) + '</td>'
      + '<td style="padding:5px 8px;color:var(--warm-gray);font-size:.78rem;">' + esc(a.type) + '</td>'
      + '<td style="padding:5px 8px;color:var(--warm-gray);font-size:.78rem;">' + esc(a.source) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">$' + finFmtMoney(a.balance) + '</td></tr>';
  }).join('');
  var total = all.reduce(function(s, a) { return s + a.balance; }, 0);
  var syncNote = 'QuickBooks synced ' + esc(overview.accountsSyncedAt ? finFmtTs(overview.accountsSyncedAt) : 'never')
    + (dcList.length ? (' &middot; Daycare app synced ' + esc(overview.daycareAccountsSyncedAt ? finFmtTs(overview.daycareAccountsSyncedAt) : 'never')) : '');
  el.innerHTML =
    '<div style="font-size:.72rem;color:var(--warm-gray);margin-bottom:8px;">' + syncNote + '</div>'
    + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr><th style="text-align:left;padding:6px 8px;">Account</th><th style="text-align:left;padding:6px 8px;">Type</th><th style="text-align:left;padding:6px 8px;">Source</th><th style="text-align:right;padding:6px 8px;">Balance</th></tr></thead>'
    + '<tbody>' + rowsHtml + '</tbody>'
    + '<tfoot><tr style="font-weight:600;border-top:2px solid var(--navy);"><td style="padding:6px 8px;" colspan="3">Total</td><td style="padding:6px 8px;text-align:right;">$' + finFmtMoney(total) + '</td></tr></tfoot>'
    + '</table></div>';
}
function finFmtMoney(n) {
  n = Number(n) || 0;
  return n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

// ── Daycare ──────────────────────────────────────────────────────────
// Rows come from two sources: hand-entered ('manual', always editable) and pulled in from
// the daycare app's own finance API ('daycare_api', replaced wholesale on each sync — see
// SECRETS.md for the contract). Only manual rows show a Delete button.
function finRenderDaycareStatus() {
  var el = document.getElementById('fin-daycare-sync');
  if (!_finStatus.daycareConfigured) {
    el.innerHTML = '<p style="font-size:.78rem;color:var(--warm-gray);margin:0 0 10px;">The daycare app is not connected yet — add <code>DAYCARE_API_URL</code> and <code>DAYCARE_API_KEY</code> (see SECRETS.md) once its finance API is built. Manual entries below always work regardless.</p>';
    return;
  }
  var lastSync = _finStatus.daycareLastSyncedAt ? finFmtTs(_finStatus.daycareLastSyncedAt) : 'never';
  el.innerHTML = '<p style="font-size:.78rem;color:var(--warm-gray);margin:0 0 8px;">Daycare app last synced: ' + esc(lastSync) + '</p>'
    + '<button class="btn-secondary" onclick="finSyncDaycare(this)">Sync Daycare App</button>';
}
function finSyncDaycare(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  api('/admin/api/finance/daycare/sync', { method: 'POST' }).then(function(d) {
    if (btn) { btn.disabled = false; btn.textContent = 'Sync Daycare App'; }
    if (d && d.error) { finToast('Daycare sync failed: ' + d.error); return; }
    finToast('Daycare app synced (' + (d.imported || 0) + ' line items).');
    loadFinance();
  }).catch(function(err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Sync Daycare App'; }
    finToast('Daycare sync failed: ' + (err && err.message || 'Unknown error'));
  });
}
function finRenderDaycare() {
  finRenderDaycareStatus();
  var countEl = document.getElementById('fin-daycare-count');
  if (countEl) countEl.textContent = _finDaycare.length;
  var el = document.getElementById('fin-daycare-body');
  if (!_finDaycare.length) {
    el.innerHTML = '<tr><td colspan="6" style="padding:10px;color:var(--warm-gray);font-size:.82rem;">No entries yet. Add one below, or sync the daycare app above.</td></tr>';
    return;
  }
  el.innerHTML = _finDaycare.map(function(e) {
    var actions = '<button class="btn-secondary" style="font-size:.72rem;padding:3px 8px;margin-right:4px;" onclick="finEditDaycare(' + e.id + ')">Edit</button>'
      + (e.source === 'daycare_api' ? '' : '<button class="btn-secondary" style="font-size:.72rem;padding:3px 8px;" onclick="finDeleteDaycare(' + e.id + ')">Delete</button>');
    return '<tr>'
      + '<td style="padding:5px 8px;">' + esc(e.period) + '</td>'
      + '<td style="padding:5px 8px;">' + esc(e.category) + '</td>'
      + '<td style="padding:5px 8px;">' + (e.entry_type === 'budget' ? 'Budget' : 'Actual') + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">$' + finFmtMoney(e.amount_cents / 100) + '</td>'
      + '<td style="padding:5px 8px;color:var(--warm-gray);font-size:.78rem;">' + (e.source === 'daycare_api' ? 'Daycare App' : esc(e.notes || '')) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + actions + '</td>'
      + '</tr>';
  }).join('');
}
// Add/Edit share one form + one submit handler. Editing a daycare_api-sourced row is allowed
// (the backend PUT doesn't restrict by source) — Delete stays manual-only above since a
// deleted synced row would just reappear on the next sync of that period, but an edited one
// only gets overwritten if that same period is re-synced again, which in practice mostly
// happens for the current/recent period, not old closed-out years.
var _finEditingDaycareId = null;
function finEditDaycare(id) {
  var e = _finDaycare.filter(function(x) { return x.id === id; })[0];
  if (!e) return;
  _finEditingDaycareId = id;
  document.getElementById('fin-dc-period').value = e.period;
  document.getElementById('fin-dc-category').value = e.category;
  document.getElementById('fin-dc-type').value = e.entry_type === 'budget' ? 'budget' : 'actual';
  document.getElementById('fin-dc-amount').value = (e.amount_cents / 100).toFixed(2);
  document.getElementById('fin-dc-notes').value = e.source === 'daycare_api' ? '' : (e.notes || '');
  document.getElementById('fin-dc-error').textContent = '';
  document.getElementById('fin-dc-submit-btn').textContent = 'Update Entry';
  document.getElementById('fin-dc-cancel-btn').style.display = '';
  document.getElementById('fin-dc-period').scrollIntoView({behavior:'smooth', block:'center'});
}
function finCancelEditDaycare() {
  _finEditingDaycareId = null;
  document.getElementById('fin-dc-period').value = '';
  document.getElementById('fin-dc-category').value = '';
  document.getElementById('fin-dc-amount').value = '';
  document.getElementById('fin-dc-notes').value = '';
  document.getElementById('fin-dc-error').textContent = '';
  document.getElementById('fin-dc-submit-btn').textContent = '+ Add Entry';
  document.getElementById('fin-dc-cancel-btn').style.display = 'none';
}
function finSaveDaycare() {
  var period = document.getElementById('fin-dc-period').value.trim();
  var category = document.getElementById('fin-dc-category').value.trim();
  var type = document.getElementById('fin-dc-type').value;
  var amount = parseFloat(document.getElementById('fin-dc-amount').value);
  var notes = document.getElementById('fin-dc-notes').value.trim();
  var errEl = document.getElementById('fin-dc-error');
  errEl.textContent = '';
  if (!/^\d{4}(-\d{2})?$/.test(period)) { errEl.textContent = 'Period must be YYYY or YYYY-MM.'; return; }
  if (!category) { errEl.textContent = 'Category is required.'; return; }
  if (!isFinite(amount)) { errEl.textContent = 'Enter a valid amount.'; return; }
  var body = { period: period, category: category, entry_type: type, amount_cents: Math.round(amount * 100), notes: notes };
  var editingId = _finEditingDaycareId;
  var req = editingId
    ? api('/admin/api/finance/daycare/' + editingId, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) })
    : api('/admin/api/finance/daycare', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
  req.then(function(d) {
    if (d && d.error) { errEl.textContent = d.error; return; }
    finCancelEditDaycare();
    return api('/admin/api/finance/daycare').then(function(d2) { _finDaycare = d2.entries || []; finRenderDaycare(); });
  }).catch(function(err) { errEl.textContent = err && err.message || 'Could not save entry.'; });
}
function finDeleteDaycare(id) {
  if (!confirm('Delete this entry?')) return;
  api('/admin/api/finance/daycare/' + id, { method: 'DELETE' }).then(function() {
    _finDaycare = _finDaycare.filter(function(e) { return e.id !== id; });
    finRenderDaycare();
  });
}

// ── Import Daycare (MDO) data from an already-imported Church Budget year ──
function finDaycareChurchBudgetPreview() {
  var year = document.getElementById('fin-dc-cb-year').value.trim();
  var out = document.getElementById('fin-dc-cb-preview');
  if (!/^\d{4}$/.test(year)) { out.innerHTML = '<div style="color:var(--danger);font-size:.78rem;">Enter a 4-digit year.</div>'; return; }
  out.innerHTML = '<div style="font-size:.78rem;color:var(--warm-gray);">Loading…</div>';
  api('/admin/api/finance/daycare/church-budget-preview?year=' + encodeURIComponent(year)).then(function(d) {
    if (d && d.error) { out.innerHTML = '<div style="color:var(--danger);font-size:.78rem;">' + esc(d.error) + '</div>'; return; }
    var entries = (d && d.entries) || [];
    if (!entries.length) {
      out.innerHTML = '<div style="font-size:.78rem;color:var(--warm-gray);">No MDO-tagged accounts found in the ' + esc(year) + ' Church Budget import. Make sure that year has been imported under Church Report first.</div>';
      return;
    }
    var byCategory = (d && d.by_category) || {};
    var catRows = Object.keys(byCategory).sort().map(function(cat) {
      var c = byCategory[cat];
      return '<tr><td style="padding:4px 8px;">' + esc(cat) + '</td>'
        + '<td style="padding:4px 8px;text-align:right;">' + finFmtMoney((c.actual_cents || 0) / 100) + '</td>'
        + '<td style="padding:4px 8px;text-align:right;">' + finFmtMoney((c.budget_cents || 0) / 100) + '</td></tr>';
    }).join('');
    var lineRows = entries.map(function(e) {
      return '<tr><td style="padding:3px 8px;">' + esc(e.category) + '</td>'
        + '<td style="padding:3px 8px;">' + esc(e.entry_type) + '</td>'
        + '<td style="padding:3px 8px;text-align:right;">' + finFmtMoney((e.amount_cents || 0) / 100) + '</td>'
        + '<td style="padding:3px 8px;color:var(--warm-gray);">' + esc(e.notes || '') + '</td></tr>';
    }).join('');
    out.innerHTML = ''
      + '<table style="width:100%;border-collapse:collapse;font-size:.82rem;margin-bottom:8px;">'
      + '<thead><tr style="border-bottom:2px solid var(--navy);"><th style="text-align:left;padding:4px 8px;">Category</th><th style="text-align:right;padding:4px 8px;">Actual</th><th style="text-align:right;padding:4px 8px;">Budget</th></tr></thead>'
      + '<tbody>' + catRows + '</tbody></table>'
      + '<details style="margin-bottom:10px;"><summary style="font-size:.75rem;color:var(--warm-gray);cursor:pointer;">Show ' + entries.length + ' individual line items</summary>'
      + '<div style="overflow-x:auto;margin-top:6px;"><table style="width:100%;border-collapse:collapse;font-size:.78rem;">'
      + '<thead><tr style="border-bottom:1px solid var(--border);"><th style="text-align:left;padding:3px 8px;">Category</th><th style="text-align:left;padding:3px 8px;">Type</th><th style="text-align:right;padding:3px 8px;">Amount</th><th style="text-align:left;padding:3px 8px;">Notes</th></tr></thead>'
      + '<tbody>' + lineRows + '</tbody></table></div></details>'
      + '<button class="btn-primary" onclick="finDaycareChurchBudgetImport(\'' + esc(year) + '\')">Import These ' + entries.length + ' Line Items</button>'
      + ' <span style="font-size:.72rem;color:var(--warm-gray);">Re-importing the same year replaces its previously imported church-budget rows — it will not duplicate them.</span>';
  }).catch(function(err) {
    out.innerHTML = '<div style="color:var(--danger);font-size:.78rem;">' + esc(err && err.message || 'Could not load preview.') + '</div>';
  });
}
function finDaycareChurchBudgetImport(year) {
  api('/admin/api/finance/daycare/church-budget-import', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ year: year })
  }).then(function(d) {
    if (d && d.error) { finToast(d.error); return; }
    finToast('Imported ' + (d && d.imported || 0) + ' daycare line item(s) from the ' + year + ' Church Budget.');
    document.getElementById('fin-dc-cb-preview').innerHTML = '';
    return api('/admin/api/finance/daycare').then(function(d2) { _finDaycare = d2.entries || []; finRenderDaycare(); });
  }).catch(function(err) { finToast(err && err.message || 'Import failed.'); });
}

// ── Bulk-enter past years (paste-in, since the daycare app has no historical API — FIN3) ────
var _finDcBulkRows = null;
function finDaycareParseBulkText(text) {
  return text.split('\n').map(function(line) { return line.trim(); }).filter(Boolean).map(function(line) {
    var parts = line.split(',').map(function(p) { return p.trim(); });
    return { period: parts[0] || '', category: parts[1] || '', entry_type: (parts[2] || 'actual').toLowerCase(), amount: parts[3] || '', notes: parts[4] || '' };
  });
}
function finDaycareBulkPreview() {
  var text = document.getElementById('fin-dc-bulk-text').value;
  var errEl = document.getElementById('fin-dc-bulk-error');
  var out = document.getElementById('fin-dc-bulk-preview');
  errEl.textContent = '';
  var rows = finDaycareParseBulkText(text);
  if (!rows.length) { errEl.textContent = 'Paste at least one row.'; out.innerHTML = ''; return; }
  var bad = [];
  rows.forEach(function(r, i) {
    if (!/^\d{4}(-\d{2})?$/.test(r.period)) bad.push('Row ' + (i+1) + ': period must be YYYY or YYYY-MM');
    else if (!r.category) bad.push('Row ' + (i+1) + ': category is required');
    else if (!isFinite(parseFloat(r.amount))) bad.push('Row ' + (i+1) + ': invalid amount');
    else if (r.entry_type !== 'actual' && r.entry_type !== 'budget') bad.push('Row ' + (i+1) + ': type must be actual or budget');
  });
  if (bad.length) { errEl.innerHTML = bad.map(esc).join('<br>'); out.innerHTML = ''; return; }
  _finDcBulkRows = rows;
  var rowsHtml = rows.map(function(r) {
    return '<tr><td style="padding:3px 8px;">' + esc(r.period) + '</td><td style="padding:3px 8px;">' + esc(r.category) + '</td><td style="padding:3px 8px;">' + esc(r.entry_type) + '</td><td style="padding:3px 8px;text-align:right;">$' + finFmtMoney(parseFloat(r.amount)) + '</td><td style="padding:3px 8px;color:var(--warm-gray);">' + esc(r.notes) + '</td></tr>';
  }).join('');
  out.innerHTML = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.78rem;">'
    + '<thead><tr style="border-bottom:1px solid var(--border);"><th style="text-align:left;padding:3px 8px;">Period</th><th style="text-align:left;padding:3px 8px;">Category</th><th style="text-align:left;padding:3px 8px;">Type</th><th style="text-align:right;padding:3px 8px;">Amount</th><th style="text-align:left;padding:3px 8px;">Notes</th></tr></thead>'
    + '<tbody>' + rowsHtml + '</tbody></table></div>'
    + '<button class="btn-primary" style="margin-top:8px;" onclick="finDaycareBulkImport()">Import These ' + rows.length + ' Rows</button>';
}
function finDaycareBulkImport() {
  if (!_finDcBulkRows || !_finDcBulkRows.length) return;
  var body = { rows: _finDcBulkRows.map(function(r) {
    return { period: r.period, category: r.category, entry_type: r.entry_type, amount_cents: Math.round(parseFloat(r.amount) * 100), notes: r.notes };
  }) };
  api('/admin/api/finance/daycare/bulk', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }).then(function(d) {
    if (d && d.error) { finToast(d.error); return; }
    finToast('Imported ' + (d && d.imported || 0) + ' row(s).');
    document.getElementById('fin-dc-bulk-text').value = '';
    document.getElementById('fin-dc-bulk-preview').innerHTML = '';
    _finDcBulkRows = null;
    return api('/admin/api/finance/daycare').then(function(d2) { _finDaycare = d2.entries || []; finRenderDaycare(); });
  }).catch(function(err) { finToast(err && err.message || 'Import failed.'); });
}

// ── MDO utility cost-share note (from the 3277 Ivanhoe data export's church_building_shared_
// costs section — NOT about the rental property itself, so it's surfaced here instead of in
// Commercial Property; see CLAUDE.md queued items). Populated once property data loads. ──────
function finRenderDaycareMdoNote() {
  var el = document.getElementById('fin-daycare-mdo-note');
  if (!el) return;
  var shared = _finProperty && _finProperty.meta && _finProperty.meta.church_building_shared_costs;
  var mdo = shared && shared.mdo_utility_allocation;
  if (!mdo) { el.innerHTML = ''; return; }
  el.innerHTML = '<div style="background:var(--linen);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:.8rem;">'
    + '<b>MDO Utility Cost Share (estimate): ' + ((mdo.estimated_mdo_share_pct||0)*100).toFixed(0) + '%</b>'
    + '<p style="margin:6px 0 0;color:var(--warm-gray);">' + esc(mdo.basis_given_by_andrew || '') + ' ' + esc(mdo.estimate_note || '') + '</p>'
    + '</div>';
}

// ── Daycare Report (board-level, year by year) ─────────────────────────
// Groups the flat period×category×type rows (the same ones behind the Overview
// sync table) into calendar-year totals per category, plus Income/Expense/Net
// summary rows. Computed client-side from _finDaycare — no new endpoint needed,
// since the full row set is already fetched for the Overview tab.
var FIN_KNOWN_CATEGORY_ORDER = ['Tuition Income', 'Payroll', 'Payroll Taxes', 'Workers Comp', 'Other Payroll Expenses', 'Other Expenses'];
function finIsIncomeCategory(cat) {
  return String(cat || '').trim().toLowerCase() === 'tuition income';
}
function finAggregateDaycareByYear(entries) {
  var years = [];
  var categoriesSeen = [];
  var byYear = {};
  (entries || []).forEach(function(e) {
    var year = String(e.period || '').slice(0, 4);
    if (!/^\d{4}$/.test(year)) return;
    if (years.indexOf(year) === -1) years.push(year);
    if (!byYear[year]) byYear[year] = { categories: {}, incomeActual: 0, incomeBudget: 0, expenseActual: 0, expenseBudget: 0 };
    var cat = e.category || 'Uncategorized';
    if (categoriesSeen.indexOf(cat) === -1) categoriesSeen.push(cat);
    if (!byYear[year].categories[cat]) byYear[year].categories[cat] = { actual: 0, budget: 0 };
    var amt = (Number(e.amount_cents) || 0) / 100;
    var isIncome = finIsIncomeCategory(cat);
    var isBudget = e.entry_type === 'budget';
    byYear[year].categories[cat][isBudget ? 'budget' : 'actual'] += amt;
    if (isIncome) byYear[year][isBudget ? 'incomeBudget' : 'incomeActual'] += amt;
    else byYear[year][isBudget ? 'expenseBudget' : 'expenseActual'] += amt;
  });
  years.sort();
  years.forEach(function(y) {
    var b = byYear[y];
    b.netActual = b.incomeActual - b.expenseActual;
    b.netBudget = b.incomeBudget - b.expenseBudget;
  });
  var categories = FIN_KNOWN_CATEGORY_ORDER.filter(function(c) { return categoriesSeen.indexOf(c) !== -1; })
    .concat(categoriesSeen.filter(function(c) { return FIN_KNOWN_CATEGORY_ORDER.indexOf(c) === -1; }).sort());
  return { years: years, categories: categories, byYear: byYear };
}
function finRenderDaycareReport() {
  var el = document.getElementById('fin-daycare-report');
  if (!el) return;
  var agg = finAggregateDaycareByYear(_finDaycare);
  _finDaycareAgg = agg;
  if (!agg.years.length) {
    el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">No daycare data yet. Sync the daycare app or add entries in the Overview tab.</p>';
    return;
  }
  function moneyCell(v, muted) {
    return '<td style="text-align:right;padding:5px 8px;' + (muted ? 'color:var(--warm-gray);' : '') + '">$' + finFmtMoney(v) + '</td>';
  }
  var yearHead1 = '<th></th>' + agg.years.map(function(y) {
    return '<th colspan="2" style="text-align:center;padding:6px 8px;border-bottom:1px solid var(--border);">' + esc(y) + '</th>';
  }).join('');
  var yearHead2 = '<th style="text-align:left;padding:6px 8px;">Category</th>' + agg.years.map(function() {
    return '<th style="text-align:right;padding:4px 8px;font-size:.72rem;color:var(--warm-gray);font-weight:600;">Actual</th>'
      + '<th style="text-align:right;padding:4px 8px;font-size:.72rem;color:var(--warm-gray);font-weight:600;">Budget</th>';
  }).join('');
  var catRows = agg.categories.map(function(cat) {
    var cells = agg.years.map(function(y) {
      var c = agg.byYear[y].categories[cat] || { actual: 0, budget: 0 };
      return moneyCell(c.actual) + moneyCell(c.budget, true);
    }).join('');
    return '<tr><td style="padding:5px 8px;">' + esc(cat) + '</td>' + cells + '</tr>';
  }).join('');
  function summaryRow(label, actualKey, budgetKey, bold) {
    var cells = agg.years.map(function(y) {
      var b = agg.byYear[y];
      return moneyCell(b[actualKey]) + moneyCell(b[budgetKey], true);
    }).join('');
    return '<tr' + (bold ? ' style="font-weight:700;border-top:2px solid var(--navy);"' : ' style="font-weight:600;border-top:1px solid var(--border);"') + '>'
      + '<td style="padding:5px 8px;">' + label + '</td>' + cells + '</tr>';
  }
  el.innerHTML =
    '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead><tr>' + yearHead1 + '</tr><tr style="border-bottom:2px solid var(--navy);">' + yearHead2 + '</tr></thead>'
    + '<tbody>' + catRows
    + summaryRow('Total Income', 'incomeActual', 'incomeBudget', false)
    + summaryRow('Total Expenses', 'expenseActual', 'expenseBudget', false)
    + summaryRow('Net Income', 'netActual', 'netBudget', true)
    + '</tbody></table></div>';
}
function finExportDaycareCsv() {
  var agg = _finDaycareAgg;
  if (!agg || !agg.years.length) { finToast('No daycare data to export.'); return; }
  var header = ['Category'].concat(agg.years.reduce(function(a, y) { return a.concat([y + ' Actual', y + ' Budget']); }, []));
  var rows = [header];
  agg.categories.forEach(function(cat) {
    var row = [cat];
    agg.years.forEach(function(y) {
      var c = agg.byYear[y].categories[cat] || { actual: 0, budget: 0 };
      row.push(c.actual.toFixed(2), c.budget.toFixed(2));
    });
    rows.push(row);
  });
  function summaryRowCsv(label, actualKey, budgetKey) {
    var row = [label];
    agg.years.forEach(function(y) { row.push(agg.byYear[y][actualKey].toFixed(2), agg.byYear[y][budgetKey].toFixed(2)); });
    return row;
  }
  rows.push(summaryRowCsv('Total Income', 'incomeActual', 'incomeBudget'));
  rows.push(summaryRowCsv('Total Expenses', 'expenseActual', 'expenseBudget'));
  rows.push(summaryRowCsv('Net Income', 'netActual', 'netBudget'));
  finDownloadCsv('daycare-report-' + agg.years[0] + '-to-' + agg.years[agg.years.length - 1] + '.csv', rows);
}

// ── Church Report v2: rebuild a nested tree from the flat finance_church_entries rows ──
// This is the client-side mirror of mergeSection()'s in-memory bottom-up summing (src/
// api-finance.js) — needed because the persisted table deliberately never stores a "Total for
// X" subtotal row (see migrations/0018_finance_church_entries.sql), only each account's own
// non-cumulative amount. A node's own_budget_cents can be null (no budget known for that
// account/year) — hasBudgetInfo tracks whether ANY node in a subtree has real budget data, so
// the renderer can show "—" instead of a misleading $0.00 for a subtree with none at all.
function finBuildTreeFromFlatRows(rows) {
  var nodeByPath = {};
  var roots = [];
  (rows || []).forEach(function(r) {
    nodeByPath[r.category_path] = {
      path: r.category_path,
      label: r.account_name,
      classification: r.classification,
      depth: r.depth,
      ownActualCents: r.own_actual_cents || 0,
      ownBudgetCents: r.own_budget_cents,
      totalActualCents: 0,
      totalBudgetCents: 0,
      hasBudgetInfo: r.own_budget_cents != null,
      children: [],
    };
  });
  (rows || []).forEach(function(r) {
    var node = nodeByPath[r.category_path];
    // Walk up ALL ancestor path prefixes (not just the immediate parent) to find the nearest
    // one with a stored row — a pure grouping label with no own posting (e.g. "Job Materials")
    // never gets its own row (see flattenReportTree), so the immediate parent path is often a
    // gap; skipping straight to the immediate parent would wrongly treat this node as a root
    // and silently drop it out of every ancestor's rollup total.
    var segments = r.category_path.split(':');
    var parent = null;
    for (var i = segments.length - 1; i > 0; i--) {
      var candidate = nodeByPath[segments.slice(0, i).join(':')];
      if (candidate) { parent = candidate; break; }
    }
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  function computeTotals(node) {
    var totalActual = node.ownActualCents;
    var totalBudget = node.ownBudgetCents || 0;
    var hasBudgetInfo = node.hasBudgetInfo;
    node.children.forEach(function(c) {
      computeTotals(c);
      totalActual += c.totalActualCents;
      totalBudget += c.totalBudgetCents;
      if (c.hasBudgetInfo) hasBudgetInfo = true;
    });
    node.totalActualCents = totalActual;
    node.totalBudgetCents = totalBudget;
    node.hasBudgetInfo = hasBudgetInfo;
  }
  roots.forEach(computeTotals);
  return roots;
}
// ── Display-only chart-of-accounts reorganization ───────────────────────────────────────────
// Requested reshaping of how the real QuickBooks account tree is PRESENTED — no stored data or
// backend totals (stat cards still come from the server's own classificationTotals) are touched:
// (1) the "Income" classification root is relabeled "Revenue" and sorted before Expenses,
// (2) Facility Rental/Fundraisers/MDO are grouped under a new "Earned Income" heading,
// (3) Altar Guild is grouped under a new "Restricted Income" heading,
// (4) any account named "Sales" is hidden from this tree (note: the Church Report's own
//     Total Revenue stat card is computed server-side from ALL rows including Sales, so that
//     one figure and this detail tree can disagree by whatever Sales posted — say so if Sales
//     should be excluded from the real total too, not just hidden here).
// Applied to a cloned copy so the original tree (and any cached totals elsewhere) is untouched.
function finSetNodeDepth(node, depth) {
  node.depth = depth;
  (node.children || []).forEach(function(c) { finSetNodeDepth(c, depth + 1); });
}
function finRemoveNodesByLabel(nodes, labelRe) {
  for (var i = nodes.length - 1; i >= 0; i--) {
    if (labelRe.test(nodes[i].label)) { nodes.splice(i, 1); }
    else { finRemoveNodesByLabel(nodes[i].children, labelRe); }
  }
}
function finExtractNodesByLabel(nodes, labelRe) {
  var found = [];
  for (var i = nodes.length - 1; i >= 0; i--) {
    if (labelRe.test(nodes[i].label)) { found.unshift(nodes.splice(i, 1)[0]); }
    else { found = finExtractNodesByLabel(nodes[i].children, labelRe).concat(found); }
  }
  return found;
}
function finMakeGroupNode(label, classification, children) {
  return { path: '__group:' + label, label: label, classification: classification, depth: 0, ownActualCents: 0, ownBudgetCents: null, totalActualCents: 0, totalBudgetCents: 0, hasBudgetInfo: false, children: children };
}
// Recomputes every node's total (own + all descendants) bottom-up from each node's OWN figures
// — safe to call after moving nodes around, unlike patching totals incrementally, since a
// node's stored total is a point-in-time sum that doesn't auto-update when its children change.
function finRecomputeTreeTotals(nodes) {
  (nodes || []).forEach(function(node) {
    finRecomputeTreeTotals(node.children);
    var totalActual = node.ownActualCents || 0;
    var totalBudget = node.ownBudgetCents || 0;
    var hasBudgetInfo = node.ownBudgetCents != null;
    (node.children || []).forEach(function(c) {
      totalActual += c.totalActualCents;
      totalBudget += c.totalBudgetCents;
      if (c.hasBudgetInfo) hasBudgetInfo = true;
    });
    node.totalActualCents = totalActual;
    node.totalBudgetCents = totalBudget;
    node.hasBudgetInfo = hasBudgetInfo;
  });
}
var FIN_CHURCH_CLASS_ORDER = { 'Income': 0, 'Cost of Goods Sold': 1, 'Expenses': 2, 'Other Income': 3, 'Other Expenses': 4 };
function finReorganizeChurchTree(roots) {
  var cloned = JSON.parse(JSON.stringify(roots || []));
  finRemoveNodesByLabel(cloned, /^sales$/i);
  var earnedChildren = finExtractNodesByLabel(cloned, /^(facility rental|fundraisers|mdo)$/i);
  var restrictedChildren = finExtractNodesByLabel(cloned, /^altar guild$/i);
  var incomeRoot = cloned.filter(function(n) { return n.classification === 'Income'; })[0];
  if (incomeRoot) {
    if (earnedChildren.length) incomeRoot.children.push(finMakeGroupNode('Earned Income', 'Income', earnedChildren));
    if (restrictedChildren.length) incomeRoot.children.push(finMakeGroupNode('Restricted Income', 'Income', restrictedChildren));
    incomeRoot.label = 'Revenue';
  }
  finSetNodeDepth({ depth: -1, children: cloned }, -1);
  finRecomputeTreeTotals(cloned);
  cloned.sort(function(a, b) {
    var oa = FIN_CHURCH_CLASS_ORDER[a.classification]; var ob = FIN_CHURCH_CLASS_ORDER[b.classification];
    return (oa === undefined ? 9 : oa) - (ob === undefined ? 9 : ob);
  });
  return cloned;
}
// Renders finBuildTreeFromFlatRows()'s output as an indented HTML table body (Account | Actual
// | Budget | Remaining), including each node's own-plus-descendants total (matching what a
// QuickBooks "Total for X" row would show, recomputed rather than stored).
function finRenderDetailTreeRows(nodes, html) {
  html = html || [];
  (nodes || []).forEach(function(node) {
    var bold = node.children.length > 0;
    var budgetCell = node.hasBudgetInfo
      ? '<td style="text-align:right;padding:5px 8px;">$' + finFmtMoney(node.totalBudgetCents / 100) + '</td>'
        + '<td style="text-align:right;padding:5px 8px;' + (node.totalActualCents > node.totalBudgetCents ? 'color:var(--danger);' : 'color:var(--sage);') + '">$' + finFmtMoney((node.totalBudgetCents - node.totalActualCents) / 100) + '</td>'
      : '<td style="text-align:right;padding:5px 8px;color:var(--warm-gray);">—</td><td style="text-align:right;padding:5px 8px;color:var(--warm-gray);">—</td>';
    html.push('<tr' + (bold ? ' style="font-weight:600;"' : '') + '>'
      + '<td style="padding:5px 8px 5px ' + (10 + node.depth * 16) + 'px;">' + esc(node.label) + '</td>'
      + '<td style="text-align:right;padding:5px 8px;">$' + finFmtMoney(node.totalActualCents / 100) + '</td>'
      + budgetCell + '</tr>');
    finRenderDetailTreeRows(node.children, html);
  });
  return html;
}

// ── Church Report v2 (board-level): This Year / Multi-Year toggle ───────────
// Both views read from the persisted finance_church_entries table (finance/church/this-year,
// finance/church/multi-year) rather than the live QuickBooks blob cache — see
// migrations/0018_finance_church_entries.sql for why. Mirrors the This-Year/Multi-Year toggle
// pattern already used for Attendance by Service (setAttByServiceMode in js-attendance.js).
var _finChurchMode = 'year';
var _finChurchThisYearData = null;
var _finChurchMultiYearData = null;
var _finChurchBalancesData = null;
var _finChurchBalancesMultiYearData = null;

// Shared palette for the category pie charts below (Income sources / Expense categories /
// Asset composition) — cycles by category rank (largest first) rather than a fixed per-category
// mapping, since the actual category set varies church-to-church.
var CHURCH_PIE_PALETTE = ['#2E7EA6', '#C9973A', '#5A9E6F', '#9B59B6', '#8A7968', '#B85C3A', '#4A6FA5', '#D4A574'];
// Builds pie-chart {label,value,color} items from a classification's immediate depth-1
// subcategories (e.g. "40 Donor Income", "42 Passive Income" under Income) — falls back to the
// classification root itself if it has no subcategories (a flat chart of accounts with no
// grouping). Zero/negative totals are dropped (a pie slice can't represent them meaningfully);
// sorted largest-first so the legend and color assignment are stable and readable. Takes an
// already-built tree (from finBuildTreeFromFlatRows/finBuildBalanceTreeFromFlatRows) rather than
// raw rows, since both callers already build that tree for the full-detail table below.
function finPieItemsFromTree(tree, classification, totalField) {
  var root = tree.filter(function(n) { return n.classification === classification && n.depth === 0; })[0];
  if (!root) return [];
  var cats = root.children.length ? root.children : [root];
  return cats.filter(function(c) { return c[totalField] > 0; })
    .sort(function(a, b) { return b[totalField] - a[totalField]; })
    .map(function(c, i) { return { label: c.label, value: c[totalField], color: CHURCH_PIE_PALETTE[i % CHURCH_PIE_PALETTE.length] }; });
}

function finSetChurchReportMode(mode) {
  _finChurchMode = mode;
  var yearEl = document.getElementById('fin-church-year-view');
  var multiEl = document.getElementById('fin-church-multiyear-view');
  var balEl = document.getElementById('fin-church-balances-view');
  if (yearEl) yearEl.style.display = mode === 'year' ? '' : 'none';
  if (multiEl) multiEl.style.display = mode === 'multiyear' ? '' : 'none';
  if (balEl) balEl.style.display = mode === 'balances' ? '' : 'none';
  var yearBtn = document.getElementById('fin-church-mode-year');
  var multiBtn = document.getElementById('fin-church-mode-multiyear');
  var balBtn = document.getElementById('fin-church-mode-balances');
  if (yearBtn) yearBtn.classList.toggle('active', mode === 'year');
  if (multiBtn) multiBtn.classList.toggle('active', mode === 'multiyear');
  if (balBtn) balBtn.classList.toggle('active', mode === 'balances');
  if (mode === 'year' && !_finChurchThisYearData) finLoadChurchThisYear();
  if (mode === 'multiyear' && !_finChurchMultiYearData) finLoadChurchMultiYear();
  if (mode === 'balances' && !_finChurchBalancesData) finLoadChurchBalances();
}

// Called from loadFinance() on every tab load AND after every "Sync Now" — always invalidates
// the cached church-report data first so a fresh sync's results actually show up, rather than
// the stale data finSetChurchReportMode's cache-guard would otherwise keep serving (that guard
// exists only to avoid a redundant re-fetch when the user merely clicks the This Year/Multi-Year
// toggle back and forth, which calls finSetChurchReportMode directly, not through here).
function finRenderChurchReport() {
  _finChurchThisYearData = null;
  _finChurchMultiYearData = null;
  _finChurchBalancesData = null;
  _finChurchBalancesMultiYearData = null;
  finSetChurchReportMode(_finChurchMode);
}

function finLoadChurchThisYear(year) {
  year = year || new Date().getFullYear();
  var el = document.getElementById('fin-church-year-view');
  if (!el) return;
  el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">Loading…</p>';
  api('/admin/api/finance/church/this-year?year=' + year).then(function(d) {
    _finChurchThisYearData = d;
    finRenderChurchThisYear(d);
  }).catch(function(err) {
    if (err && err.message === 'Unauthorized') return;
    el.innerHTML = '<p style="font-size:.85rem;color:var(--danger);">Could not load this year’s church data.</p>';
  });
}

function finMoneyClass(cents) {
  return cents < 0 ? 'color:var(--danger);' : 'color:var(--sage);';
}
// One This Year summary card: actual figure, plus (only if any budget is known for the year)
// the annual budget, remaining amount, and a simple over/under progress bar.
function finChurchSummaryCard(label, totals, hasBudget) {
  var actual = totals.actualCents, budget = totals.budgetCents;
  var remaining = budget - actual;
  var pct = budget > 0 ? Math.round(actual * 100 / budget) : null;
  var html = '<div style="flex:1;min-width:170px;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:12px 14px;">'
    + '<div style="font-size:.7rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">' + label + '</div>'
    + '<div style="font-size:1.3rem;font-weight:700;color:var(--steel-anchor);">$' + finFmtMoney(actual / 100) + '</div>';
  if (hasBudget) {
    html += '<div style="font-size:.76rem;color:var(--warm-gray);margin-top:2px;">Budget: $' + finFmtMoney(budget / 100) + '</div>'
      + '<div style="font-size:.76rem;' + finMoneyClass(remaining) + '">' + (remaining < 0 ? 'Over by $' + finFmtMoney(-remaining / 100) : '$' + finFmtMoney(remaining / 100) + ' remaining') + '</div>';
    if (pct != null) {
      var barColor = pct > 100 ? 'var(--danger)' : pct > 85 ? 'var(--color-gold)' : 'var(--sage)';
      html += '<div style="height:6px;background:var(--linen);border-radius:3px;margin-top:6px;overflow:hidden;">'
        + '<div style="height:100%;width:' + Math.min(100, pct) + '%;background:' + barColor + ';"></div></div>';
    }
  } else {
    html += '<div style="font-size:.76rem;color:var(--warm-gray);margin-top:2px;">No budget data for this year</div>';
  }
  return html + '</div>';
}
// This-year-vs-last-year-to-date + a year-end projection. yoy.available is false when
// monthly-granularity data hasn't been synced yet (needs a QuickBooks sync after this feature
// shipped — see the sync handler) — shown as an honest "not yet available" note rather than a
// misleading number computed from annual-only data.
function finRenderYoyRow(label, s) {
  return '<tr><td style="padding:5px 8px;">' + label + '</td>'
    + '<td style="text-align:right;padding:5px 8px;">$' + finFmtMoney(s.currentYtdCents / 100) + '</td>'
    + '<td style="text-align:right;padding:5px 8px;color:var(--warm-gray);">$' + finFmtMoney(s.priorYtdCents / 100) + '</td>'
    + '<td style="text-align:right;padding:5px 8px;color:var(--warm-gray);">$' + finFmtMoney(s.priorFullYearCents / 100) + '</td>'
    + '<td style="text-align:right;padding:5px 8px;font-weight:600;">$' + finFmtMoney(s.projectedFullYearCents / 100) + '</td>'
    + '</tr>';
}
function finRenderYoyBlock(yoy) {
  if (!yoy || !yoy.available) {
    return '<div style="font-size:.8rem;color:var(--warm-gray);background:var(--linen);border-radius:8px;padding:10px 14px;margin-bottom:18px;">'
      + 'Year-over-year comparison and a year-end projection aren’t available yet — they need a monthly-granularity QuickBooks sync (current + prior year). Click "Sync Now" in the Overview tab to enable this.'
      + '</div>';
  }
  var monthLbl = MONTH_NAMES[yoy.throughMonth - 1];
  // Chart shows YTD-so-far vs. the projection; "Last Year (Full)" stays table-only since a bar
  // for it would visually compete with "Last Year YTD" for the same category without adding
  // insight the table doesn't already give. NOTE: like the Attendance chart this is built on,
  // renderGroupedBarChart doesn't support negative bars — a deficit (negative Net Income) will
  // render as a near-invisible sliver rather than a below-the-axis bar. Acceptable for now since
  // the table above always shows the real signed number regardless.
  var chart = renderGroupedBarChart({
    chartH: 200,
    groups: [{ key: 'income', label: 'Revenue' }, { key: 'expenses', label: 'Expenses' }, { key: 'net', label: 'Net Income' }],
    series: [
      { key: 'cur', label: 'This Year YTD', color: '#2E7EA6' },
      { key: 'prior', label: 'Last Year YTD', color: '#C9973A' },
      { key: 'proj', label: 'Projected Full Year', color: '#5A9E6F' },
    ],
    value: function(g, s) {
      var row = g === 'income' ? yoy.income : g === 'expenses' ? yoy.expenses : yoy.net;
      var cents = s === 'cur' ? row.currentYtdCents : s === 'prior' ? row.priorYtdCents : row.projectedFullYearCents;
      return cents / 100;
    },
    tooltip: function(g, s, v) {
      var gLbl = g === 'income' ? 'Revenue' : g === 'expenses' ? 'Expenses' : 'Net Income';
      var sLbl = s === 'cur' ? 'This Year YTD' : s === 'prior' ? 'Last Year YTD' : 'Projected Full Year';
      return sLbl + ' — ' + gLbl + ': $' + finFmtMoney(v);
    },
    barLabel: function(v) { return '$' + Math.round(v / 1000) + 'k'; },
  });
  return '<div style="margin-bottom:18px;">'
    + '<h4 style="margin:0 0 8px;font-family:var(--font-head);color:var(--steel-anchor);font-size:.9rem;">This year vs. last year (through ' + monthLbl + ')</h4>'
    + chart
    + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead><tr style="border-bottom:2px solid var(--navy);">'
    + '<th style="text-align:left;padding:6px 8px;"></th>'
    + '<th style="text-align:right;padding:6px 8px;">This Year YTD</th>'
    + '<th style="text-align:right;padding:6px 8px;">Last Year YTD</th>'
    + '<th style="text-align:right;padding:6px 8px;">Last Year (Full)</th>'
    + '<th style="text-align:right;padding:6px 8px;">Projected Full Year</th>'
    + '</tr></thead><tbody>'
    + finRenderYoyRow('Revenue', yoy.income)
    + finRenderYoyRow('Expenses', yoy.expenses)
    + finRenderYoyRow('Net Income', yoy.net)
    + '</tbody></table></div>'
    + '<p style="font-size:.72rem;color:var(--warm-gray);margin-top:6px;">'
    + 'Projection assumes this year follows a similar month-to-month pattern as last year — an estimate for planning, not a guarantee; a single large one-time gift or expense can shift it substantially.'
    + '</p></div>';
}
function finRenderChurchThisYear(d) {
  var el = document.getElementById('fin-church-year-view');
  if (!el) return;
  if (!d || !d.entries || !d.entries.length) {
    el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">No church report data yet for ' + d.year + '. Connect QuickBooks in the Overview tab and click "Sync Now".</p>';
    return;
  }
  var income = d.classificationTotals['Income'] || { actualCents: 0, budgetCents: 0 };
  var expenses = d.classificationTotals['Expenses'] || { actualCents: 0, budgetCents: 0 };
  var html = '<div style="font-size:.78rem;color:var(--warm-gray);margin-bottom:12px;">' + d.year + '</div>'
    + '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:18px;">'
    + finChurchSummaryCard('Total Revenue', income, d.hasBudgetData)
    + finChurchSummaryCard('Total Expenses', expenses, d.hasBudgetData)
    + finChurchSummaryCard('Net Income', d.netIncome, d.hasBudgetData)
    + '</div>'
    + '<div style="font-size:.82rem;color:var(--warm-gray);background:var(--linen);border-radius:8px;padding:10px 14px;margin-bottom:18px;">'
    + '<b>Giving (ChMS records):</b> $' + finFmtMoney(d.givingCents / 100)
    + ' <span style="font-size:.75rem;">— shown for reference only. QuickBooks’ Revenue figure above reflects what has cleared the bank and been fully recorded, so timing differences from ChMS’s own recorded giving are expected, not a discrepancy to chase.</span>'
    + (d.givingByFund && d.givingByFund.length ? '<table style="width:100%;border-collapse:collapse;font-size:.78rem;margin-top:8px;">'
        + d.givingByFund.map(function(f) {
            return '<tr><td style="padding:2px 8px 2px 0;">' + esc(f.fundName) + '</td><td style="padding:2px 0;text-align:right;">$' + finFmtMoney(f.cents / 100) + '</td></tr>';
          }).join('')
        + '</table>' : '')
    + '</div>'
    + finRenderYoyBlock(d.yoy);

  var tree = finReorganizeChurchTree(finBuildTreeFromFlatRows(d.entries));
  var incomePie = finPieItemsFromTree(tree, 'Income', 'totalActualCents');
  var expensePie = finPieItemsFromTree(tree, 'Expenses', 'totalActualCents');
  if (incomePie.length || expensePie.length) {
    html += '<div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:18px;">'
      + '<div style="flex:1;min-width:280px;"><h4 style="margin:0 0 8px;font-family:var(--font-head);color:var(--steel-anchor);font-size:.9rem;">Revenue Sources</h4>'
      + (incomePie.length ? renderPieChart(incomePie, 170) : '<p style="font-size:.82rem;color:var(--warm-gray);">No revenue data yet.</p>') + '</div>'
      + '<div style="flex:1;min-width:280px;"><h4 style="margin:0 0 8px;font-family:var(--font-head);color:var(--steel-anchor);font-size:.9rem;">Expense Categories</h4>'
      + (expensePie.length ? renderPieChart(expensePie, 170) : '<p style="font-size:.82rem;color:var(--warm-gray);">No expense data yet.</p>') + '</div>'
      + '</div>';
  }
  html += '<details><summary style="font-size:.82rem;color:var(--warm-gray);cursor:pointer;">Full account detail</summary>'
    + '<div style="overflow-x:auto;margin-top:10px;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead><tr style="border-bottom:2px solid var(--navy);"><th style="text-align:left;padding:6px 8px;">Account</th><th style="text-align:right;padding:6px 8px;">Actual</th><th style="text-align:right;padding:6px 8px;">Budget</th><th style="text-align:right;padding:6px 8px;">Remaining</th></tr></thead>'
    + '<tbody>' + finRenderDetailTreeRows(tree).join('') + '</tbody></table></div></details>';
  el.innerHTML = html;
}

function finLoadChurchMultiYear() {
  var el = document.getElementById('fin-church-multiyear-view');
  if (!el) return;
  el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">Loading…</p>';
  api('/admin/api/finance/church/multi-year').then(function(d) {
    _finChurchMultiYearData = d;
    finRenderChurchMultiYear(d);
  }).catch(function(err) {
    if (err && err.message === 'Unauthorized') return;
    el.innerHTML = '<p style="font-size:.85rem;color:var(--danger);">Could not load multi-year church data.</p>';
  });
}
function finRenderChurchMultiYear(d) {
  var el = document.getElementById('fin-church-multiyear-view');
  if (!el) return;
  var years = d.years || [];
  var anyData = years.some(function(y) { var s = d.byYear[y]; return s && Object.keys(s.classificationTotals).length; });
  if (!anyData) {
    el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">No multi-year church data yet. Connect QuickBooks in the Overview tab and click "Sync Now".</p>';
    return;
  }
  var rowsDef = [{ label: 'Total Revenue', key: 'Income' }, { label: 'Cost of Goods Sold', key: 'Cost of Goods Sold' }, { label: 'Total Expenses', key: 'Expenses' }];
  var theadCells = '<th style="text-align:left;padding:6px 8px;"></th>' + years.map(function(y) { return '<th style="text-align:right;padding:6px 8px;">' + y + '</th>'; }).join('');
  var bodyRows = rowsDef.map(function(rd) {
    var cells = years.map(function(y) {
      var c = (d.byYear[y].classificationTotals[rd.key]) || { actualCents: 0 };
      return '<td style="text-align:right;padding:5px 8px;">$' + finFmtMoney(c.actualCents / 100) + '</td>';
    }).join('');
    return '<tr><td style="padding:5px 8px;">' + rd.label + '</td>' + cells + '</tr>';
  }).join('');
  var netRow = '<tr style="font-weight:700;border-top:2px solid var(--navy);"><td style="padding:5px 8px;">Net Income</td>'
    + years.map(function(y) { return '<td style="text-align:right;padding:5px 8px;">$' + finFmtMoney(d.byYear[y].netIncome.actualCents / 100) + '</td>'; }).join('')
    + '</tr>';
  // Same negative-bar caveat as the This-Year-vs-Last-Year chart: a deficit year's Net Income
  // bar will render as a near-invisible sliver rather than dip below the axis. The table above
  // always shows the real signed number regardless.
  var chart = renderGroupedBarChart({
    chartH: 220,
    groups: years.map(function(y) { return { key: y, label: String(y) }; }),
    series: [
      { key: 'income', label: 'Revenue', color: '#2E7EA6' },
      { key: 'expenses', label: 'Expenses', color: '#C9973A' },
      { key: 'net', label: 'Net Income', color: '#5A9E6F' },
    ],
    value: function(y, s) {
      var yd = d.byYear[y];
      var cents = s === 'income' ? (yd.classificationTotals['Income'] || { actualCents: 0 }).actualCents
        : s === 'expenses' ? (yd.classificationTotals['Expenses'] || { actualCents: 0 }).actualCents
        : yd.netIncome.actualCents;
      return cents / 100;
    },
    tooltip: function(y, s, v) {
      var sLbl = s === 'income' ? 'Income' : s === 'expenses' ? 'Expenses' : 'Net Income';
      return y + ' ' + sLbl + ': $' + finFmtMoney(v);
    },
    barLabel: function(v) { return '$' + Math.round(v / 1000) + 'k'; },
  });
  var html = chart
    + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr>' + theadCells + '</tr></thead>'
    + '<tbody>' + bodyRows + netRow + '</tbody></table></div>';

  // Daycare tie-in lines — same "for reference, not part of QuickBooks totals" pattern already
  // shipped; year alignment is direct now (the years list here), no QBO column-title parsing needed.
  var agg = finAggregateDaycareByYear(_finDaycare);
  if (agg.years.length) {
    function tieRow(label, getter) {
      var cells = years.map(function(y) {
        var v = getter(String(y));
        return v == null ? '<td style="text-align:right;padding:5px 8px;color:var(--warm-gray);">—</td>' : '<td style="text-align:right;padding:5px 8px;">$' + finFmtMoney(v) + '</td>';
      }).join('');
      return '<tr><td style="padding:5px 8px;padding-left:26px;font-style:italic;color:var(--warm-gray);">' + label + '</td>' + cells + '</tr>';
    }
    html += '<h4 style="margin:20px 0 8px;font-family:var(--font-head);color:var(--steel-anchor);font-size:.9rem;">Daycare (MDO) — for reference, not part of QuickBooks totals above</h4>'
      + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
      + '<tbody>'
      + tieRow('Daycare Tuition Income', function(y) { return agg.byYear[y] ? agg.byYear[y].incomeActual : null; })
      + tieRow('Daycare Payroll (Wages)', function(y) { var b = agg.byYear[y]; return (b && b.categories['Payroll']) ? b.categories['Payroll'].actual : null; })
      + tieRow('Daycare Total Expenses', function(y) { return agg.byYear[y] ? agg.byYear[y].expenseActual : null; })
      + '</tbody></table></div>';
  }
  el.innerHTML = html;
}
// ── Balance Sheet view (point-in-time Assets/Liabilities/Equity) ────────────────────────────
// A structurally different report from This Year/Multi-Year (no actual-vs-budget split, no
// period — a single as-of-date snapshot), so it gets its own small tree-builder rather than
// forcing finBuildTreeFromFlatRows() (which is tightly coupled to own_actual_cents/
// own_budget_cents) to also handle own_balance_cents.
function finBuildBalanceTreeFromFlatRows(rows) {
  var nodeByPath = {};
  var roots = [];
  (rows || []).forEach(function(r) {
    nodeByPath[r.category_path] = {
      path: r.category_path, label: r.account_name, classification: r.classification, depth: r.depth,
      ownBalanceCents: r.own_balance_cents || 0, totalBalanceCents: 0, children: [],
    };
  });
  (rows || []).forEach(function(r) {
    var node = nodeByPath[r.category_path];
    var segments = r.category_path.split(':');
    var parent = null;
    for (var i = segments.length - 1; i > 0; i--) {
      var candidate = nodeByPath[segments.slice(0, i).join(':')];
      if (candidate) { parent = candidate; break; }
    }
    if (parent) parent.children.push(node); else roots.push(node);
  });
  function computeTotals(node) {
    var total = node.ownBalanceCents;
    node.children.forEach(function(c) { computeTotals(c); total += c.totalBalanceCents; });
    node.totalBalanceCents = total;
  }
  roots.forEach(computeTotals);
  return roots;
}
function finRenderBalanceTreeRows(nodes, html) {
  html = html || [];
  (nodes || []).forEach(function(node) {
    var bold = node.children.length > 0;
    html.push('<tr' + (bold ? ' style="font-weight:600;"' : '') + '>'
      + '<td style="padding:5px 8px 5px ' + (10 + node.depth * 16) + 'px;">' + esc(node.label) + '</td>'
      + '<td style="text-align:right;padding:5px 8px;">$' + finFmtMoney(node.totalBalanceCents / 100) + '</td>'
      + '</tr>');
    finRenderBalanceTreeRows(node.children, html);
  });
  return html;
}
function finLoadChurchBalances(year) {
  year = year || new Date().getFullYear();
  var el = document.getElementById('fin-church-balances-view');
  if (!el) return;
  el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">Loading…</p>';
  Promise.all([
    api('/admin/api/finance/church/balances?year=' + year),
    api('/admin/api/finance/church/balances/multi-year'),
  ]).then(function(results) {
    _finChurchBalancesData = results[0];
    _finChurchBalancesMultiYearData = results[1];
    finRenderChurchBalances(_finChurchBalancesData, _finChurchBalancesMultiYearData);
  }).catch(function(err) {
    if (err && err.message === 'Unauthorized') return;
    el.innerHTML = '<p style="font-size:.85rem;color:var(--danger);">Could not load balance sheet data.</p>';
  });
}
// Assets/Liabilities/Equity across every year with an imported balance sheet, so a board can see
// the trend rather than only a single point-in-time snapshot. Same negative-bar caveat as the
// Income Statement multi-year chart this is modeled on — not a concern in practice here, since a
// real balance sheet's classification totals are essentially never negative.
function finRenderBalanceMultiYearChart(multiYear) {
  if (!multiYear || !multiYear.years || !multiYear.years.length) return '';
  var years = multiYear.years;
  var anyData = years.some(function(y) { var s = multiYear.byYear[y]; return s && (s.assetsCents || s.liabilitiesCents || s.equityCents); });
  if (!anyData) return '';
  var chart = renderGroupedBarChart({
    chartH: 200,
    groups: years.map(function(y) { return { key: y, label: String(y) }; }),
    series: [
      { key: 'assets', label: 'Assets', color: '#2E7EA6' },
      { key: 'liabilities', label: 'Liabilities', color: '#C9973A' },
      { key: 'equity', label: 'Equity', color: '#5A9E6F' },
    ],
    value: function(y, s) {
      var yd = multiYear.byYear[y] || {};
      var cents = s === 'assets' ? (yd.assetsCents || 0) : s === 'liabilities' ? (yd.liabilitiesCents || 0) : (yd.equityCents || 0);
      return cents / 100;
    },
    tooltip: function(y, s, v) {
      var sLbl = s === 'assets' ? 'Assets' : s === 'liabilities' ? 'Liabilities' : 'Equity';
      return sLbl + ' ' + y + ': $' + finFmtMoney(v);
    },
    barLabel: function(v) { return '$' + Math.round(v / 1000) + 'k'; },
  });
  return '<div style="margin-bottom:18px;"><h4 style="margin:0 0 8px;font-family:var(--font-head);color:var(--steel-anchor);font-size:.9rem;">Multi-Year Trend</h4>' + chart + '</div>';
}
function finRenderChurchBalances(d, multiYear) {
  var el = document.getElementById('fin-church-balances-view');
  if (!el) return;
  if (!d || !d.rows || !d.rows.length) {
    el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">No balance sheet imported yet for ' + d.year + '. Click "Import Balance Sheet" above to upload one.</p>';
    return;
  }
  var s = d.summary;
  var offCents = s.balancedCents;
  var checkHtml = Math.abs(offCents) < 1
    ? '<span style="color:var(--sage);">✓ Balances (Assets = Liabilities + Equity)</span>'
    : '<span style="color:var(--danger);">⚠ Off by $' + finFmtMoney(Math.abs(offCents) / 100) + ' — check the import for a missing or misclassified account.</span>';
  var html = '<div style="font-size:.78rem;color:var(--warm-gray);margin-bottom:12px;">As of ' + esc(d.asOfDate || d.year) + '</div>'
    + '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:12px;">'
    + '<div style="flex:1;min-width:170px;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:12px 14px;">'
    + '<div style="font-size:.7rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Assets</div>'
    + '<div style="font-size:1.3rem;font-weight:700;color:var(--steel-anchor);">$' + finFmtMoney(s.assetsCents / 100) + '</div></div>'
    + '<div style="flex:1;min-width:170px;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:12px 14px;">'
    + '<div style="font-size:.7rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Liabilities</div>'
    + '<div style="font-size:1.3rem;font-weight:700;color:var(--steel-anchor);">$' + finFmtMoney(s.liabilitiesCents / 100) + '</div></div>'
    + '<div style="flex:1;min-width:170px;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:12px 14px;">'
    + '<div style="font-size:.7rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Equity</div>'
    + '<div style="font-size:1.3rem;font-weight:700;color:var(--steel-anchor);">$' + finFmtMoney(s.equityCents / 100) + '</div></div>'
    + '</div>'
    + '<div style="font-size:.82rem;margin-bottom:18px;">' + checkHtml + '</div>';
  var tree = finBuildBalanceTreeFromFlatRows(d.rows);
  var assetPie = finPieItemsFromTree(tree, 'Assets', 'totalBalanceCents');
  if (assetPie.length) {
    html += '<div style="margin-bottom:18px;"><h4 style="margin:0 0 8px;font-family:var(--font-head);color:var(--steel-anchor);font-size:.9rem;">Asset Composition</h4>' + renderPieChart(assetPie, 170) + '</div>';
  }
  html += finRenderBalanceMultiYearChart(multiYear);
  html += '<details open><summary style="font-size:.82rem;color:var(--warm-gray);cursor:pointer;">Full account detail</summary>'
    + '<div style="overflow-x:auto;margin-top:10px;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead><tr style="border-bottom:2px solid var(--navy);"><th style="text-align:left;padding:6px 8px;">Account</th><th style="text-align:right;padding:6px 8px;">Balance</th></tr></thead>'
    + '<tbody>' + finRenderBalanceTreeRows(tree).join('') + '</tbody></table></div></details>';
  el.innerHTML = html;
}

// ── Balance Sheet import: preview-then-commit (same pattern as the Budget import below) ─────
var _finChurchBalanceImportPreview = null;
var _finChurchBalanceImportChecked = null;

function finOpenChurchBalanceImport() {
  _finChurchBalanceImportPreview = null;
  _finChurchBalanceImportChecked = null;
  var fileEl = document.getElementById('fin-church-balance-import-file');
  if (fileEl) fileEl.value = '';
  var statusEl = document.getElementById('fin-church-balance-import-status');
  if (statusEl) statusEl.textContent = '';
  var previewEl = document.getElementById('fin-church-balance-import-preview');
  if (previewEl) previewEl.innerHTML = '';
  var confirmBtn = document.getElementById('fin-church-balance-import-confirm-btn');
  if (confirmBtn) confirmBtn.style.display = 'none';
  openModal('fin-church-balance-import-modal');
}

function finChurchBalanceImportFileSelected(inputEl) {
  var file = inputEl.files && inputEl.files[0];
  if (!file) return;
  var statusEl = document.getElementById('fin-church-balance-import-status');
  var previewEl = document.getElementById('fin-church-balance-import-preview');
  var confirmBtn = document.getElementById('fin-church-balance-import-confirm-btn');
  statusEl.textContent = 'Reading file…';
  previewEl.innerHTML = '';
  confirmBtn.style.display = 'none';
  _finChurchBalanceImportPreview = null;
  var fd = new FormData();
  fd.append('file', file);
  fetch('/admin/api/finance/church/balances/import-preview', { method: 'POST', body: fd, credentials: 'include' })
    .then(function(r) {
      return r.json().then(function(d) {
        if (r.status === 401) { location.href = '/chms'; throw new Error('Unauthorized'); }
        if (!r.ok) throw new Error(d.error || 'Could not read this file.');
        return d;
      });
    })
    .then(function(d) {
      _finChurchBalanceImportPreview = d;
      _finChurchBalanceImportChecked = d.rows.map(function() { return true; });
      var summary = computeBalanceSheetPreviewSummary(d.rows);
      statusEl.textContent = 'Parsed "' + d.sheetName + '" — as of ' + d.asOfDate + ' (fiscal year ' + d.fiscalYear + '), ' + d.rows.length + ' account row(s).'
        + (d.skipped.length ? ' ' + d.skipped.length + ' line(s) not recognized as accounts (shown below).' : '')
        + ' Assets $' + finFmtMoney(summary.assetsCents / 100) + ' vs. Liabilities + Equity $' + finFmtMoney(summary.liabilitiesPlusEquityCents / 100) + '.';
      previewEl.innerHTML = finChurchRenderBalanceImportPreview(d);
      confirmBtn.style.display = '';
    })
    .catch(function(err) {
      if (err.message !== 'Unauthorized') statusEl.textContent = 'Error: ' + err.message;
    });
}

// Small standalone summary (not computeBalanceSummary, which is a backend-only export) purely
// for the status line's Assets-vs-Liabilities+Equity sanity check before commit.
function computeBalanceSheetPreviewSummary(rows) {
  var byClass = {};
  rows.forEach(function(r) { byClass[r.classification] = (byClass[r.classification] || 0) + r.own_balance_cents; });
  var assets = byClass.Assets || 0, liabilities = byClass.Liabilities || 0, equity = byClass.Equity || 0;
  return { assetsCents: assets, liabilitiesPlusEquityCents: liabilities + equity };
}

function finChurchRenderBalanceImportPreview(d) {
  var rowsHtml = d.rows.map(function(r, i) {
    return '<tr>'
      + '<td style="padding:3px 6px;"><input type="checkbox" checked onchange="finChurchBalanceImportToggleRow(' + i + ',this.checked)"></td>'
      + '<td style="padding:3px 6px 3px ' + (8 + 14 * r.depth) + 'px;">' + esc(r.account_name) + '</td>'
      + '<td style="padding:3px 6px;color:var(--warm-gray);">' + esc(r.classification) + '</td>'
      + '<td style="padding:3px 6px;text-align:right;">$' + finFmtMoney(r.own_balance_cents / 100) + '</td>'
      + '</tr>';
  }).join('');
  var skippedHtml = d.skipped.length
    ? '<p style="font-size:.76rem;color:var(--warm-gray);margin-top:10px;">Ignored (not recognized as accounts): ' + d.skipped.map(esc).join('; ') + '</p>'
    : '';
  return '<div style="max-height:340px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">'
    + '<table style="width:100%;border-collapse:collapse;font-size:.78rem;">'
    + '<thead style="position:sticky;top:0;background:var(--white);"><tr style="border-bottom:1px solid var(--border);">'
    + '<th style="padding:4px 6px;"></th><th style="text-align:left;padding:4px 6px;">Account</th>'
    + '<th style="text-align:left;padding:4px 6px;">Classification</th><th style="text-align:right;padding:4px 6px;">Balance</th>'
    + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>'
    + skippedHtml;
}

function finChurchBalanceImportToggleRow(i, checked) {
  if (_finChurchBalanceImportChecked) _finChurchBalanceImportChecked[i] = checked;
}

function finChurchConfirmBalanceImport() {
  if (!_finChurchBalanceImportPreview) return;
  var rows = _finChurchBalanceImportPreview.rows.filter(function(r, i) { return _finChurchBalanceImportChecked[i]; });
  if (!rows.length) { alert('No rows selected.'); return; }
  var btn = document.getElementById('fin-church-balance-import-confirm-btn');
  btn.disabled = true;
  api('/admin/api/finance/church/balances/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fiscal_year: _finChurchBalanceImportPreview.fiscalYear, as_of_date: _finChurchBalanceImportPreview.asOfDate, rows: rows }),
  }).then(function(d) {
    btn.disabled = false;
    if (d && d.error) { finToast('Import failed: ' + d.error); return; }
    closeModal('fin-church-balance-import-modal');
    finToast('Imported ' + d.imported + ' account row(s) as of ' + _finChurchBalanceImportPreview.asOfDate + '.');
    _finChurchBalancesData = null;
    if (_finChurchMode === 'balances') finLoadChurchBalances();
  }).catch(function(err) {
    btn.disabled = false;
    if (err && err.message !== 'Unauthorized') finToast('Import failed: ' + (err.message || 'Unknown error'));
  });
}

// ── Budget import: preview-then-commit (mirrors Tuition Aid's TAP10 pattern) ────────────────
// Parsing happens server-side (POST /finance/church/import-preview) rather than in the browser
// like Tuition Aid's importer, since the XLSX ZIP/inflate reader was ported to api-finance.js —
// the file is uploaded once for preview, reviewed with per-row checkboxes, then only the
// checked rows are sent to the commit endpoint as plain JSON (no re-upload of the file itself).
var _finChurchImportPreview = null;
var _finChurchImportChecked = null;

function finOpenChurchImport() {
  _finChurchImportPreview = null;
  _finChurchImportChecked = null;
  var fileEl = document.getElementById('fin-church-import-file');
  if (fileEl) fileEl.value = '';
  var statusEl = document.getElementById('fin-church-import-status');
  if (statusEl) statusEl.textContent = '';
  var previewEl = document.getElementById('fin-church-import-preview');
  if (previewEl) previewEl.innerHTML = '';
  var confirmBtn = document.getElementById('fin-church-import-confirm-btn');
  if (confirmBtn) confirmBtn.style.display = 'none';
  openModal('fin-church-import-modal');
}

function finChurchImportFileSelected(inputEl) {
  var file = inputEl.files && inputEl.files[0];
  if (!file) return;
  var statusEl = document.getElementById('fin-church-import-status');
  var previewEl = document.getElementById('fin-church-import-preview');
  var confirmBtn = document.getElementById('fin-church-import-confirm-btn');
  statusEl.textContent = 'Reading file…';
  previewEl.innerHTML = '';
  confirmBtn.style.display = 'none';
  _finChurchImportPreview = null;
  var fd = new FormData();
  fd.append('file', file);
  fetch('/admin/api/finance/church/import-preview', { method: 'POST', body: fd, credentials: 'include' })
    .then(function(r) {
      return r.json().then(function(d) {
        if (r.status === 401) { location.href = '/chms'; throw new Error('Unauthorized'); }
        if (!r.ok) throw new Error(d.error || 'Could not read this file.');
        return d;
      });
    })
    .then(function(d) {
      _finChurchImportPreview = d;
      _finChurchImportChecked = d.rows.map(function() { return true; });
      statusEl.textContent = 'Parsed "' + d.sheetName + '" — fiscal year ' + d.fiscalYear + ', ' + d.rows.length + ' account row(s).'
        + (d.skipped.length ? ' ' + d.skipped.length + ' line(s) not recognized as accounts (shown below).' : '');
      previewEl.innerHTML = finChurchRenderImportPreview(d);
      confirmBtn.style.display = '';
    })
    .catch(function(err) {
      if (err.message !== 'Unauthorized') statusEl.textContent = 'Error: ' + err.message;
    });
}

function finChurchRenderImportPreview(d) {
  var rowsHtml = d.rows.map(function(r, i) {
    return '<tr>'
      + '<td style="padding:3px 6px;"><input type="checkbox" checked onchange="finChurchImportToggleRow(' + i + ',this.checked)"></td>'
      + '<td style="padding:3px 6px 3px ' + (8 + 14 * r.depth) + 'px;">' + esc(r.account_name) + '</td>'
      + '<td style="padding:3px 6px;color:var(--warm-gray);">' + esc(r.classification) + '</td>'
      + '<td style="padding:3px 6px;text-align:right;">$' + finFmtMoney(r.own_actual_cents / 100) + '</td>'
      + '<td style="padding:3px 6px;text-align:right;">$' + finFmtMoney(r.own_budget_cents / 100) + '</td>'
      + '</tr>';
  }).join('');
  var skippedHtml = d.skipped.length
    ? '<p style="font-size:.76rem;color:var(--warm-gray);margin-top:10px;">Ignored (not recognized as accounts): ' + d.skipped.map(esc).join('; ') + '</p>'
    : '';
  return '<div style="max-height:340px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">'
    + '<table style="width:100%;border-collapse:collapse;font-size:.78rem;">'
    + '<thead style="position:sticky;top:0;background:var(--white);"><tr style="border-bottom:1px solid var(--border);">'
    + '<th style="padding:4px 6px;"></th><th style="text-align:left;padding:4px 6px;">Account</th>'
    + '<th style="text-align:left;padding:4px 6px;">Classification</th><th style="text-align:right;padding:4px 6px;">Actual</th>'
    + '<th style="text-align:right;padding:4px 6px;">Budget</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>'
    + skippedHtml;
}

function finChurchImportToggleRow(i, checked) {
  if (_finChurchImportChecked) _finChurchImportChecked[i] = checked;
}

function finChurchConfirmImport() {
  if (!_finChurchImportPreview) return;
  var rows = _finChurchImportPreview.rows.filter(function(r, i) { return _finChurchImportChecked[i]; });
  if (!rows.length) { alert('No rows selected.'); return; }
  var btn = document.getElementById('fin-church-import-confirm-btn');
  btn.disabled = true;
  api('/admin/api/finance/church/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fiscal_year: _finChurchImportPreview.fiscalYear, rows: rows }),
  }).then(function(d) {
    btn.disabled = false;
    if (d && d.error) { finToast('Import failed: ' + d.error); return; }
    closeModal('fin-church-import-modal');
    finToast('Imported ' + d.imported + ' account row(s) for ' + d.fiscalYear + '.');
    finRenderChurchReport();
  }).catch(function(err) {
    btn.disabled = false;
    if (err && err.message !== 'Unauthorized') finToast('Import failed: ' + (err.message || 'Unknown error'));
  });
}

function finExportChurchCsv() {
  var rows = [];
  if (_finChurchMode === 'year' && _finChurchThisYearData) {
    var d = _finChurchThisYearData;
    rows.push(['Account', 'Actual', 'Budget']);
    finReorganizeChurchTree(finBuildTreeFromFlatRows(d.entries)).forEach(function pushNode(node) {
      rows.push([new Array(node.depth + 1).join('  ') + node.label, (node.totalActualCents / 100).toFixed(2), node.hasBudgetInfo ? (node.totalBudgetCents / 100).toFixed(2) : '']);
      node.children.forEach(pushNode);
    });
    rows.push([]);
    rows.push(['Giving (ChMS records, reference only)', (d.givingCents / 100).toFixed(2)]);
    (d.givingByFund || []).forEach(function(f) {
      rows.push(['  ' + f.fundName, (f.cents / 100).toFixed(2)]);
    });
  } else if (_finChurchMode === 'multiyear' && _finChurchMultiYearData) {
    var md = _finChurchMultiYearData;
    var years = md.years || [];
    rows.push(['Category'].concat(years));
    [['Total Revenue', 'Income'], ['Cost of Goods Sold', 'Cost of Goods Sold'], ['Total Expenses', 'Expenses']].forEach(function(rd) {
      rows.push([rd[0]].concat(years.map(function(y) { return ((md.byYear[y].classificationTotals[rd[1]] || { actualCents: 0 }).actualCents / 100).toFixed(2); })));
    });
    rows.push(['Net Income'].concat(years.map(function(y) { return (md.byYear[y].netIncome.actualCents / 100).toFixed(2); })));
  } else {
    finToast('No church report data to export.');
    return;
  }
  finDownloadCsv('church-report-' + _finChurchMode + '.csv', rows);
}

// ── Shared CSV download helper (Excel/Sheets formula-injection guarded) ─
function finCsvCell(v) {
  var s = String(v == null ? '' : v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function finDownloadCsv(filename, rows) {
  var csv = rows.map(function(r) { return r.map(finCsvCell).join(','); }).join('\n');
  var blob = new Blob([csv + '\n'], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ── Board Packet export ──────────────────────────────────────────────────────────────────────
// Downloads one clean JSON file bundling everything a board finance summary would need — meant
// to be handed to a separate Claude session (or any analyst) to write the actual narrative
// commentary. This app deliberately does no anomaly detection itself; it just packages already-
// computed, already-verified figures (the exact same server-side functions the on-screen views
// render from) plus 5 years of trend context, so a follow-up question rarely needs a re-export.
function finExportBoardPacket(year) {
  year = year || new Date().getFullYear();
  var btn = document.getElementById('fin-board-packet-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
  api('/admin/api/finance/board-packet?year=' + year).then(function(d) {
    if (btn) { btn.disabled = false; btn.textContent = 'Export Board Packet'; }
    if (d && d.error) { finToast('Export failed: ' + d.error); return; }
    var blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'board-packet-' + year + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }).catch(function(err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Export Board Packet'; }
    if (err && err.message !== 'Unauthorized') finToast('Export failed: ' + (err.message || 'Unknown error'));
  });
}

// ── Commercial Property (3277 Ivanhoe) ───────────────────────────────────────────────────────
// Only one property exists today ('ivanhoe'); propertyKey is hardcoded here to match the
// backend's single-property route (see handlePropertyApi in src/api-finance.js). Figures come
// straight from the 2026-07-20 AHRA data export — see CLAUDE.md's Finance Overview queued items.
var _finProperty = null;
var FIN_PROPERTY_KEY = 'ivanhoe';
function finLoadProperty() {
  var el = document.getElementById('fin-property-root');
  if (!el) return;
  el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">Loading…</p>';
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY).then(function(d) {
    _finProperty = d;
    finRenderProperty(d);
    finRenderDaycareMdoNote();
  }).catch(function(err) {
    if (err && err.message === 'Unauthorized') return;
    el.innerHTML = '<p style="font-size:.85rem;color:var(--danger);">Could not load property data.</p>';
  });
}
// ── Charts (Revenue vs Expenses, Occupancy, Property Tax Reserve trend) ─────────────────────
// renderGroupedBarChart (js-attendance.js) doesn't render negative bars visibly — Net Income
// is left out of the bar chart for that reason (it stays in the Monthly Financials table below,
// which always shows the real signed number) and only non-negative series go in these charts.
function finRenderPropertyCharts(d) {
  var monthly = (d.monthly || []).slice().sort(function(a,b){ return a.period < b.period ? -1 : 1; }).slice(-24);
  if (!monthly.length) return '';
  var revExpChart = renderGroupedBarChart({
    chartH: 200,
    title: 'Monthly Revenue vs. Expenses (last ' + monthly.length + ' months)',
    groups: monthly.map(function(m) { return { key: m.period, label: m.period.slice(2) }; }),
    series: [{ key: 'rev', label: 'Revenue', color: '#2E7EA6' }, { key: 'exp', label: 'Expenses', color: '#C9973A' }],
    value: function(g, s) {
      var m = monthly.filter(function(x) { return x.period === g; })[0];
      var cents = s === 'rev' ? m.total_revenue_cents : m.total_expenses_cents;
      return cents == null ? null : cents / 100;
    },
    tooltip: function(g, s, v) { return (s === 'rev' ? 'Revenue' : 'Expenses') + ' ' + g + ': $' + finFmtMoney(v); },
  });
  var occChart = renderGroupedBarChart({
    chartH: 160,
    title: 'Occupancy % (last ' + monthly.length + ' months)',
    groups: monthly.map(function(m) { return { key: m.period, label: m.period.slice(2) }; }),
    series: [{ key: 'occ', label: 'Occupancy', color: '#5A9E6F' }],
    value: function(g) {
      var m = monthly.filter(function(x) { return x.period === g; })[0];
      return m.occupancy_pct == null ? null : m.occupancy_pct * 100;
    },
    barLabel: function(v) { return Math.round(v) + '%'; },
    tooltip: function(g, s, v) { return g + ': ' + v.toFixed(1) + '%'; },
  });
  var taxRows = ((d.reserves && d.reserves.property_tax) || []).slice().sort(function(a,b){ return a.report_month < b.report_month ? -1 : 1; }).slice(-24);
  var reserveChart = taxRows.length ? renderGroupedBarChart({
    chartH: 160,
    title: 'Property Tax Reserve Balance (last ' + taxRows.length + ' months)',
    groups: taxRows.map(function(r) { return { key: r.report_month, label: r.report_month.slice(2) }; }),
    series: [{ key: 'bal', label: 'Reserve Balance', color: '#9B59B6' }],
    value: function(g) {
      var r = taxRows.filter(function(x) { return x.report_month === g; })[0];
      return r.reserve_after_cents == null ? null : r.reserve_after_cents / 100;
    },
    tooltip: function(g, s, v) { return g + ': $' + finFmtMoney(v); },
  }) : '';
  return revExpChart + occChart + reserveChart;
}

// ── Cash Flow & Mortgage Payoff Forecast ─────────────────────────────────────────────────────
// Amortizes the loan forward from its current balance/rate/payment to estimate a payoff date,
// then projects post-payoff annual cash flow using the trailing-12-month average net income.
// The "post-payoff" figure ASSUMES the mortgage payment is already being subtracted somewhere
// in AHRA's reported Net Income — that assumption is stated in the UI rather than hidden,
// since it wasn't independently confirmed against AHRA's own bookkeeping.
function finComputeMortgageAmortization(loan) {
  if (!loan || !loan.balance_cents || !loan.interest_rate_pct || !loan.monthly_payment_cents) return null;
  var balance = loan.balance_cents, monthlyRate = loan.interest_rate_pct / 12, payment = loan.monthly_payment_cents;
  var months = 0, totalInterestCents = 0;
  while (balance > 0 && months < 600) {
    var interest = balance * monthlyRate;
    var principal = payment - interest;
    if (principal <= 0) return null; // payment doesn't cover interest — can't project a payoff
    balance -= principal;
    totalInterestCents += interest;
    months++;
  }
  var payoffDate = new Date();
  payoffDate.setMonth(payoffDate.getMonth() + months);
  return { months: months, totalInterestCents: Math.round(totalInterestCents), payoffDate: payoffDate };
}
function finRenderPropertyForecast(d) {
  var loan = (d.meta && d.meta.loan) || {};
  var monthly = (d.monthly || []).slice().sort(function(a,b){ return a.period < b.period ? -1 : 1; }).slice(-12);
  var withNet = monthly.filter(function(m) { return m.net_income_cents != null || m.net_operating_income_cents != null; });
  var avgMonthlyCents = withNet.length
    ? withNet.reduce(function(sum, m) { return sum + (m.net_income_cents != null ? m.net_income_cents : m.net_operating_income_cents); }, 0) / withNet.length
    : 0;
  var avgAnnualCents = avgMonthlyCents * 12;
  var amort = finComputeMortgageAmortization(loan);
  var statsHtml = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin:10px 0;">'
    + '<div class="rpt-stat"><div class="rpt-stat-num">$' + finFmtMoney(avgAnnualCents/100) + '</div><div class="rpt-stat-lbl">Avg. Annual Net Income (trailing 12mo)</div></div>'
    + (amort
      ? '<div class="rpt-stat"><div class="rpt-stat-num">' + amort.payoffDate.toLocaleDateString('en-US', {month:'short', year:'numeric'}) + '</div><div class="rpt-stat-lbl">Projected Mortgage Payoff (~' + amort.months + ' mo)</div></div>'
        + '<div class="rpt-stat"><div class="rpt-stat-num">$' + finFmtMoney(amort.totalInterestCents/100) + '</div><div class="rpt-stat-lbl">Remaining Interest</div></div>'
        + '<div class="rpt-stat"><div class="rpt-stat-num">$' + finFmtMoney((avgAnnualCents + (loan.annual_debt_service_cents||0))/100) + '</div><div class="rpt-stat-lbl">Potential Annual Net Income After Payoff</div></div>'
      : '')
    + '</div>';
  var note = amort
    ? '<p style="font-size:.72rem;color:var(--warm-gray);margin:0 0 4px;"><i>"Potential Annual Net Income After Payoff" assumes the current annual debt service ($' + finFmtMoney((loan.annual_debt_service_cents||0)/100) + ') is already being paid out of the reported Net Income above — that hasn’t been independently confirmed against AHRA’s bookkeeping, so treat this as a planning estimate, not a guarantee.</i></p>'
    : '<p style="font-size:.72rem;color:var(--warm-gray);margin:0 0 4px;">Mortgage payoff can’t be projected — the loan balance, interest rate, or monthly payment isn’t set (or the payment doesn’t cover the interest).</p>';
  return '<h4 style="margin:18px 0 8px;font-size:.9rem;">Cash Flow &amp; Mortgage Payoff Forecast</h4>' + statsHtml + note;
}

// ── Editable Valuation Calculator (income-capitalization method — the same formula and
// itemization as AHRA's actual valuation worksheet, 3277_Ivanhoe_Valuation_2.xlsx: a per-tenant
// rent roll + itemized operating costs, reconciled exactly against that worksheet). Lets staff
// update rents, costs, vacancy, management fee %, and cap rate themselves going forward without
// needing AHRA's spreadsheet — saves via the existing meta PATCH route (no new backend route). ──
var FIN_VAL_OP_COST_FIELDS = [
  ['utilities_cents', 'Utilities'],
  ['trash_cents', 'Trash'],
  ['maintenance_repairs_cents', 'Maintenance/Repairs'],
  ['landscaping_snow_cents', 'Landscaping/Snow'],
  ['legal_cents', 'Legal'],
  ['taxes_cents', 'Taxes'],
  ['insurance_cents', 'Insurance'],
];
// Pure — no DOM — so it's directly unit-testable (see test/finance-property-forecast.test.js).
// Mirrors AHRA's worksheet exactly: Gross Rental Income = rent roll + utility reimbursement,
// less vacancy = Effective Rental Income; Total Operating Costs = itemized costs + a management
// fee computed as a % of Effective Rental Income; NOI = Effective Rental Income − Total
// Operating Costs; Capitalized Value = NOI ÷ Cap Rate.
function finComputePropertyValuation(inputs) {
  var rentRoll = inputs.rentRoll || [];
  var totalAnnualRentCents = rentRoll.reduce(function(sum, r) { return sum + (Number(r.annual_rent_cents) || 0); }, 0);
  var utilityReimbCents = Number(inputs.utility_reimbursement_cents) || 0;
  var grossRentalIncomeCents = totalAnnualRentCents + utilityReimbCents;
  var vacancyRatePct = Number(inputs.vacancy_rate_pct) || 0;
  var vacancyCents = Math.round(grossRentalIncomeCents * vacancyRatePct);
  var effectiveRentalIncomeCents = grossRentalIncomeCents - vacancyCents;
  var opCosts = inputs.operating_costs || {};
  var itemizedOpCostsCents = FIN_VAL_OP_COST_FIELDS.reduce(function(sum, f) { return sum + (Number(opCosts[f[0]]) || 0); }, 0);
  var managementFeePct = Number(inputs.management_fee_pct) || 0;
  var managementFeeCents = Math.round(effectiveRentalIncomeCents * managementFeePct);
  var totalOperatingCostsCents = itemizedOpCostsCents + managementFeeCents;
  var noiCents = effectiveRentalIncomeCents - totalOperatingCostsCents;
  var capRate = Number(inputs.cap_rate) || 0;
  var capitalizedValueCents = capRate ? Math.round(noiCents / capRate) : 0;
  return {
    totalAnnualRentCents: totalAnnualRentCents, grossRentalIncomeCents: grossRentalIncomeCents, vacancyCents: vacancyCents,
    effectiveRentalIncomeCents: effectiveRentalIncomeCents, itemizedOpCostsCents: itemizedOpCostsCents,
    managementFeeCents: managementFeeCents, totalOperatingCostsCents: totalOperatingCostsCents,
    noiCents: noiCents, capitalizedValueCents: capitalizedValueCents,
  };
}
var _finValRentRoll = [];
function finRenderValuationCalculator(d, isAdminUI) {
  var val = (d.meta && d.meta.valuation) || {};
  _finValRentRoll = (val.rent_roll || []).map(function(r) { return { tenant: r.tenant || '', sqft: r.sqft || 0, annual_rent_cents: r.annual_rent_cents || 0 }; });
  var opCosts = val.operating_costs || {};
  var dis = isAdminUI ? '' : 'disabled';

  var opCostInputs = FIN_VAL_OP_COST_FIELDS.map(function(f) {
    return '<label style="font-size:.75rem;color:var(--warm-gray);">' + f[1] + ' ($/yr)<br><input type="number" id="fin-val-oc-' + f[0] + '" step="0.01" value="' + ((opCosts[f[0]]||0)/100) + '" oninput="finValRecompute()" ' + dis + ' style="width:110px;"></label>';
  }).join('');

  var assumptionsHtml = '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin:10px 0;">'
    + '<label style="font-size:.75rem;color:var(--warm-gray);">Utility Reimbursement ($/yr)<br><input type="number" id="fin-val-utilreimb" step="0.01" value="' + ((val.utility_reimbursement_cents||0)/100) + '" oninput="finValRecompute()" ' + dis + ' style="width:140px;"></label>'
    + '<label style="font-size:.75rem;color:var(--warm-gray);">Vacancy Rate %<br><input type="number" id="fin-val-vacancy" step="0.1" value="' + ((val.vacancy_rate_pct||0)*100) + '" oninput="finValRecompute()" ' + dis + ' style="width:90px;"></label>'
    + '<label style="font-size:.75rem;color:var(--warm-gray);">Management Fee %<br><input type="number" id="fin-val-mgmtfee" step="0.1" value="' + ((val.management_fee_pct||0)*100) + '" oninput="finValRecompute()" ' + dis + ' style="width:100px;"></label>'
    + '<label style="font-size:.75rem;color:var(--warm-gray);">Cap Rate<br><input type="number" id="fin-val-caprate" step="0.001" value="' + (val.cap_rate||0) + '" oninput="finValRecompute()" ' + dis + ' style="width:90px;"></label>'
    + '</div>';

  var statsHtml = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin:10px 0;" id="fin-val-output">'
    + '<div class="rpt-stat"><div class="rpt-stat-num" id="fin-val-gross">$' + finFmtMoney((val.gross_rental_income_cents||0)/100) + '</div><div class="rpt-stat-lbl">Gross Rental Income</div></div>'
    + '<div class="rpt-stat"><div class="rpt-stat-num" id="fin-val-costs">$' + finFmtMoney((val.total_operating_costs_incl_mgmt_fee_cents||0)/100) + '</div><div class="rpt-stat-lbl">Total Operating Costs</div></div>'
    + '<div class="rpt-stat"><div class="rpt-stat-num" id="fin-val-noi">$' + finFmtMoney((val.net_operating_income_cents||0)/100) + '</div><div class="rpt-stat-lbl">Net Operating Income</div></div>'
    + '<div class="rpt-stat"><div class="rpt-stat-num" id="fin-val-cv">$' + finFmtMoney((val.capitalized_value_cents||0)/100) + '</div><div class="rpt-stat-lbl">Capitalized Value</div></div>'
    + '</div>';

  var actionsHtml = isAdminUI
    ? '<button class="btn-primary" style="font-size:.78rem;padding:5px 12px;" onclick="finValSave()">Save Valuation</button> <span id="fin-val-save-msg" style="font-size:.75rem;color:var(--warm-gray);margin-left:8px;"></span>'
    : '';
  var asOf = val.as_of_date ? '<p style="font-size:.72rem;color:var(--warm-gray);margin:0 0 8px;">As of ' + esc(val.as_of_date) + '.</p>' : '';

  return '<h4 style="margin:18px 0 8px;font-size:.9rem;">Valuation Calculator</h4>' + asOf
    + '<div style="font-weight:600;font-size:.82rem;margin:0 0 6px;">Rent Roll</div>'
    + finRenderRentRollTable(isAdminUI)
    + (isAdminUI ? '<button class="btn-secondary" style="font-size:.75rem;padding:3px 10px;margin-top:6px;" onclick="finValAddTenant()">+ Add Tenant</button>' : '')
    + '<div style="font-weight:600;font-size:.82rem;margin:14px 0 6px;">Operating Costs</div>'
    + '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">' + opCostInputs + '</div>'
    + assumptionsHtml + statsHtml + actionsHtml;
}
function finRenderRentRollTable(isAdminUI) {
  var rows = _finValRentRoll.map(function(r, i) {
    return '<tr>'
      + '<td style="padding:3px 6px;"><input type="text" id="fin-val-rr-' + i + '-tenant" value="' + esc(r.tenant) + '" oninput="finValRentRollFieldChange(' + i + ',\'tenant\',this.value)" ' + (isAdminUI ? '' : 'disabled') + ' style="width:160px;"></td>'
      + '<td style="padding:3px 6px;"><input type="number" id="fin-val-rr-' + i + '-sqft" value="' + r.sqft + '" oninput="finValRentRollFieldChange(' + i + ',\'sqft\',this.value)" ' + (isAdminUI ? '' : 'disabled') + ' style="width:90px;"></td>'
      + '<td style="padding:3px 6px;"><input type="number" id="fin-val-rr-' + i + '-rent" step="0.01" value="' + (r.annual_rent_cents/100) + '" oninput="finValRentRollFieldChange(' + i + ',\'annual_rent_cents\',this.value)" ' + (isAdminUI ? '' : 'disabled') + ' style="width:120px;"></td>'
      + (isAdminUI ? '<td style="padding:3px 6px;"><button class="btn-secondary" style="font-size:.7rem;padding:2px 6px;color:var(--danger);" onclick="finValRemoveTenant(' + i + ')">Remove</button></td>' : '')
      + '</tr>';
  }).join('');
  return '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;" id="fin-val-rentroll-table">'
    + '<thead style="border-bottom:1px solid var(--border);"><tr><th style="text-align:left;padding:4px 6px;">Tenant</th><th style="text-align:left;padding:4px 6px;">SF</th><th style="text-align:left;padding:4px 6px;">Annual Rent ($)</th>' + (isAdminUI ? '<th></th>' : '') + '</tr></thead>'
    + '<tbody id="fin-val-rentroll-body">' + (rows || '<tr><td colspan="4" style="padding:6px;color:var(--warm-gray);">No tenants recorded yet.</td></tr>') + '</tbody></table></div>';
}
function finValRentRollFieldChange(i, field, value) {
  if (!_finValRentRoll[i]) return;
  _finValRentRoll[i][field] = field === 'tenant' ? value : (field === 'annual_rent_cents' ? Math.round((parseFloat(value)||0) * 100) : (parseInt(value, 10) || 0));
  finValRecompute();
}
function finValAddTenant() {
  _finValRentRoll.push({ tenant: '', sqft: 0, annual_rent_cents: 0 });
  document.getElementById('fin-val-rentroll-body').outerHTML = finRenderRentRollTable(true).match(/<tbody[\s\S]*<\/tbody>/)[0];
  finValRecompute();
}
function finValRemoveTenant(i) {
  _finValRentRoll.splice(i, 1);
  document.getElementById('fin-val-rentroll-body').outerHTML = finRenderRentRollTable(true).match(/<tbody[\s\S]*<\/tbody>/)[0];
  finValRecompute();
}
function finValReadInputs() {
  var opCosts = {};
  FIN_VAL_OP_COST_FIELDS.forEach(function(f) {
    var el = document.getElementById('fin-val-oc-' + f[0]);
    opCosts[f[0]] = el ? Math.round((parseFloat(el.value)||0) * 100) : 0;
  });
  return {
    rentRoll: _finValRentRoll,
    utility_reimbursement_cents: Math.round((parseFloat(document.getElementById('fin-val-utilreimb').value)||0) * 100),
    vacancy_rate_pct: (parseFloat(document.getElementById('fin-val-vacancy').value)||0) / 100,
    operating_costs: opCosts,
    management_fee_pct: (parseFloat(document.getElementById('fin-val-mgmtfee').value)||0) / 100,
    cap_rate: parseFloat(document.getElementById('fin-val-caprate').value) || 0,
  };
}
function finValRecompute() {
  var out = finComputePropertyValuation(finValReadInputs());
  document.getElementById('fin-val-gross').textContent = '$' + finFmtMoney(out.grossRentalIncomeCents/100);
  document.getElementById('fin-val-costs').textContent = '$' + finFmtMoney(out.totalOperatingCostsCents/100);
  document.getElementById('fin-val-noi').textContent = '$' + finFmtMoney(out.noiCents/100);
  document.getElementById('fin-val-cv').textContent = '$' + finFmtMoney(out.capitalizedValueCents/100);
}
function finValSave() {
  var msgEl = document.getElementById('fin-val-save-msg');
  var inputs = finValReadInputs();
  if (!inputs.cap_rate || inputs.cap_rate <= 0) { msgEl.textContent = 'Enter a valid cap rate.'; return; }
  var out = finComputePropertyValuation(inputs);
  var body = { valuation: {
    rent_roll: _finValRentRoll,
    utility_reimbursement_cents: inputs.utility_reimbursement_cents,
    vacancy_rate_pct: inputs.vacancy_rate_pct,
    operating_costs: inputs.operating_costs,
    management_fee_pct: inputs.management_fee_pct,
    cap_rate: inputs.cap_rate,
    gross_rental_income_cents: out.grossRentalIncomeCents,
    total_operating_costs_incl_mgmt_fee_cents: out.totalOperatingCostsCents,
    net_operating_income_cents: out.noiCents,
    capitalized_value_cents: out.capitalizedValueCents,
    as_of_date: new Date().toISOString().slice(0, 10),
  } };
  msgEl.textContent = 'Saving…';
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/meta', { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }).then(function(d) {
    if (d && d.error) { msgEl.textContent = d.error; return; }
    msgEl.textContent = 'Saved.';
    finLoadProperty();
  }).catch(function(err) { msgEl.textContent = err && err.message || 'Save failed.'; });
}

function finRenderProperty(d) {
  var el = document.getElementById('fin-property-root');
  if (!el || !d) return;
  var meta = d.meta || {};
  var prop = meta.property || {};
  var val = meta.valuation || {};
  var loan = meta.loan || {};
  var eq = d.equity || {};
  var isAdminUI = (_userRole === 'admin');

  var statsHtml = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">'
    + '<div class="rpt-stat"><div class="rpt-stat-num">$' + finFmtMoney((val.capitalized_value_cents||0)/100) + '</div><div class="rpt-stat-lbl">Valuation</div></div>'
    + '<div class="rpt-stat"><div class="rpt-stat-num">$' + finFmtMoney((loan.balance_cents||0)/100) + '</div><div class="rpt-stat-lbl">Mortgage Balance</div></div>'
    + '<div class="rpt-stat"><div class="rpt-stat-num">$' + finFmtMoney((eq.equity_cents||0)/100) + '</div><div class="rpt-stat-lbl">Equity</div></div>'
    + '<div class="rpt-stat"><div class="rpt-stat-num">' + (eq.loan_to_value_pct != null ? (eq.loan_to_value_pct*100).toFixed(1) + '%' : '—') + '</div><div class="rpt-stat-lbl">Loan-to-Value</div></div>'
    + '</div>';

  var infoHtml = '<p style="font-size:.82rem;color:var(--warm-gray);margin:0 0 4px;"><b>' + esc(prop.name || '3277 Ivanhoe') + '</b> — ' + esc(prop.type || '') + '. Owned by ' + esc(prop.owner || 'Timothy Lutheran Church') + '. Managed by ' + esc(prop.property_manager || '') + '.</p>'
    + (val.as_of_date ? '<p style="font-size:.75rem;color:var(--warm-gray);margin:0 0 2px;">Valuation as of ' + esc(val.as_of_date) + ' (' + esc(val.method || '') + ').</p>' : '')
    + (loan.note ? '<p style="font-size:.75rem;color:var(--warm-gray);margin:0 0 2px;"><i>' + esc(loan.note) + '</i></p>' : '')
    + ((prop.known_data_gaps && prop.known_data_gaps.length) ? '<p style="font-size:.75rem;color:var(--warm-gray);margin:0 0 2px;">Known data gaps: ' + prop.known_data_gaps.map(esc).join(', ') + '.</p>' : '')
    + (prop.pre_ahra_history_note ? '<p style="font-size:.75rem;color:var(--warm-gray);margin:8px 0 0;">' + esc(prop.pre_ahra_history_note) + '</p>' : '');

  // Annual summary
  var years = (d.annualSummary || []).slice().sort(function(a,b){ return b.year - a.year; });
  var annualRows = years.map(function(y) {
    return '<tr><td style="padding:6px 8px;font-weight:600;">' + y.year + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">$' + finFmtMoney(y.total_revenue_cents/100) + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">$' + finFmtMoney(y.total_expenses_cents/100) + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">$' + finFmtMoney(y.net_income_cents/100) + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">' + (y.avg_occupancy_pct != null ? (y.avg_occupancy_pct*100).toFixed(1)+'%' : '—') + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">$' + finFmtMoney(y.confirmed_distributions_cents/100) + '</td>'
      + '<td style="padding:6px 8px;font-size:.78rem;color:var(--warm-gray);">' + esc(y.notes || '') + '</td></tr>';
  }).join('');
  var annualHtml = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr><th style="text-align:left;padding:6px 8px;">Year</th><th style="text-align:right;padding:6px 8px;">Revenue</th><th style="text-align:right;padding:6px 8px;">Expenses</th><th style="text-align:right;padding:6px 8px;">Net Income</th><th style="text-align:right;padding:6px 8px;">Avg Occ.</th><th style="text-align:right;padding:6px 8px;">Distributions to Church</th><th style="text-align:left;padding:6px 8px;">Notes</th></tr></thead>'
    + '<tbody>' + (annualRows || '<tr><td colspan="7" style="padding:10px;color:var(--warm-gray);">No data yet.</td></tr>') + '</tbody>'
    + '</table></div>';

  // Monthly financials
  var monthly = (d.monthly || []).slice().sort(function(a,b){ return a.period < b.period ? 1 : -1; });
  function cell(cents) { return cents == null ? '<span style="color:var(--warm-gray);">—</span>' : '$' + finFmtMoney(cents/100); }
  var monthRows = monthly.map(function(m) {
    return '<tr><td style="padding:5px 8px;font-weight:600;">' + esc(m.period) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + (m.occupancy_pct != null ? (m.occupancy_pct*100).toFixed(1)+'%' : '—') + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + cell(m.total_revenue_cents) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + cell(m.total_expenses_cents) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + cell(m.net_income_cents) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + cell(m.net_operating_income_cents) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + cell(m.reserve_balance_cents) + '</td>'
      + (isAdminUI ? '<td style="padding:5px 8px;white-space:nowrap;"><button class="btn-secondary" style="font-size:.72rem;padding:2px 6px;" onclick="finPropertyOpenMonthModal(\'' + esc(m.period) + '\')">Edit</button> <button class="btn-secondary" style="font-size:.72rem;padding:2px 6px;color:var(--danger);" onclick="finPropertyDeleteMonth(\'' + esc(m.period) + '\')">Delete</button></td>' : '') + '</tr>';
  }).join('');
  var monthlyHtml = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr><th style="text-align:left;padding:5px 8px;">Period</th><th style="text-align:right;padding:5px 8px;">Occ.</th><th style="text-align:right;padding:5px 8px;">Revenue</th><th style="text-align:right;padding:5px 8px;">Expenses</th><th style="text-align:right;padding:5px 8px;">Net Income</th><th style="text-align:right;padding:5px 8px;">NOI</th><th style="text-align:right;padding:5px 8px;">Reserve</th>' + (isAdminUI ? '<th></th>' : '') + '</tr></thead>'
    + '<tbody>' + (monthRows || '<tr><td colspan="8" style="padding:10px;color:var(--warm-gray);">No months recorded yet.</td></tr>') + '</tbody>'
    + '</table></div>';

  // Distributions to church
  var dists = (d.distributions || []).slice().sort(function(a,b){ return a.period < b.period ? 1 : -1; });
  var distRows = dists.map(function(dd) {
    return '<tr><td style="padding:5px 8px;">' + esc(dd.period) + '</td><td style="padding:5px 8px;text-align:right;">$' + finFmtMoney(dd.amount_cents/100) + '</td>'
      + (isAdminUI ? '<td style="padding:5px 8px;"><button class="btn-secondary" style="font-size:.72rem;padding:2px 6px;color:var(--danger);" onclick="finPropertyDeleteDistribution(\'' + esc(dd.period) + '\')">Delete</button></td>' : '') + '</tr>';
  }).join('');
  var distHtml = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr><th style="text-align:left;padding:6px 8px;">Period</th><th style="text-align:right;padding:6px 8px;">Amount</th>' + (isAdminUI ? '<th></th>' : '') + '</tr></thead>'
    + '<tbody>' + (distRows || '<tr><td colspan="3" style="padding:10px;color:var(--warm-gray);">No distributions recorded yet.</td></tr>') + '</tbody>'
    + '</table></div>'
    + (isAdminUI ? '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:10px;">'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Period<br><input type="text" id="fin-prop-dist-period" placeholder="2026-07" style="width:100px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Amount ($)<br><input type="number" id="fin-prop-dist-amount" step="0.01" style="width:110px;"></label>'
      + '<button class="btn-primary" style="font-size:.78rem;padding:5px 12px;" onclick="finPropertyAddDistribution()">+ Add</button>'
      + '</div>' : '');

  el.innerHTML = statsHtml
    + '<div style="margin-bottom:16px;">' + infoHtml + '</div>'
    + finRenderPropertyCharts(d)
    + finRenderPropertyForecast(d)
    + finRenderValuationCalculator(d, isAdminUI)
    + '<h4 style="margin:0 0 8px;font-size:.9rem;">Annual Summary</h4>' + annualHtml
    + '<h4 style="margin:18px 0 8px;display:flex;align-items:center;justify-content:space-between;font-size:.9rem;"><span>Monthly Financials</span>' + (isAdminUI ? '<button class="btn-primary" style="font-size:.78rem;padding:4px 10px;" onclick="finPropertyOpenMonthModal()">+ Add Month</button>' : '') + '</h4>' + monthlyHtml
    + '<h4 style="margin:18px 0 8px;font-size:.9rem;">Distributions to Church</h4>' + distHtml
    + finRenderPropertyTaxReserve(d, isAdminUI)
    + finRenderCapitalImprovements(d, isAdminUI)
    + finRenderRepairs(d, isAdminUI)
    + finRenderInsuranceAllocation(d);
}

// ── Property Tax Reserve ─────────────────────────────────────────────────────────────────────
// AHRA maintains a running monthly reserve toward the annual property tax bill — the schedule
// zeroes out each November when the actual bill is paid, then rebuilds at a revised monthly rate.
function finRenderPropertyTaxReserve(d, isAdminUI) {
  var rows = ((d.reserves && d.reserves.property_tax) || []).slice().sort(function(a,b){ return a.report_month < b.report_month ? 1 : -1; });
  var paid = ((d.reserveDisbursements && d.reserveDisbursements.property_tax) || []).slice().sort(function(a,b){ return b.period_key - a.period_key; });
  function c(cents) { return cents == null ? '<span style="color:var(--warm-gray);">—</span>' : '$' + finFmtMoney(cents/100); }
  var scheduleRows = rows.map(function(r) {
    return '<tr><td style="padding:5px 8px;font-weight:600;">' + esc(r.report_month) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + (r.tax_year || '—') + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + c(r.target_estimate_cents) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + c(r.reserve_before_cents) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + c(r.contribution_cents) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;font-weight:600;">' + c(r.reserve_after_cents) + '</td>'
      + '<td style="padding:5px 8px;font-size:.75rem;color:var(--warm-gray);">' + esc(r.note || '') + '</td>'
      + (isAdminUI ? '<td style="padding:5px 8px;"><button class="btn-secondary" style="font-size:.72rem;padding:2px 6px;color:var(--danger);" onclick="finPropertyDeleteReserveMonth(\'property_tax\',\'' + esc(r.report_month) + '\')">Delete</button></td>' : '') + '</tr>';
  }).join('');
  var scheduleHtml = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr><th style="text-align:left;padding:5px 8px;">Report Month</th><th style="text-align:right;padding:5px 8px;">Tax Year</th><th style="text-align:right;padding:5px 8px;">Est. Tax</th><th style="text-align:right;padding:5px 8px;">Before</th><th style="text-align:right;padding:5px 8px;">Contribution</th><th style="text-align:right;padding:5px 8px;">After</th><th style="text-align:left;padding:5px 8px;">Note</th>' + (isAdminUI ? '<th></th>' : '') + '</tr></thead>'
    + '<tbody>' + (scheduleRows || '<tr><td colspan="8" style="padding:10px;color:var(--warm-gray);">No reserve schedule recorded yet.</td></tr>') + '</tbody>'
    + '</table></div>';
  var paidRows = paid.map(function(p) {
    return '<tr><td style="padding:5px 8px;">' + esc(p.period_key) + '</td><td style="padding:5px 8px;text-align:right;">' + c(p.amount_cents) + '</td><td style="padding:5px 8px;">' + esc(p.paid_via_report_month || '') + '</td><td style="padding:5px 8px;font-size:.75rem;color:var(--warm-gray);">' + esc(p.note || '') + '</td>'
      + (isAdminUI ? '<td style="padding:5px 8px;"><button class="btn-secondary" style="font-size:.72rem;padding:2px 6px;color:var(--danger);" onclick="finPropertyDeleteReserveDisbursement(\'property_tax\',\'' + esc(p.period_key) + '\')">Delete</button></td>' : '') + '</tr>';
  }).join('');
  var paidHtml = '<div style="overflow-x:auto;margin-top:10px;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;">'
    + '<thead style="border-bottom:1px solid var(--border);"><tr><th style="text-align:left;padding:5px 8px;">Tax Year</th><th style="text-align:right;padding:5px 8px;">Amount Paid</th><th style="text-align:left;padding:5px 8px;">Paid Via Report</th><th style="text-align:left;padding:5px 8px;">Note</th>' + (isAdminUI ? '<th></th>' : '') + '</tr></thead>'
    + '<tbody>' + (paidRows || '<tr><td colspan="5" style="padding:8px;color:var(--warm-gray);">No tax bills recorded as paid yet.</td></tr>') + '</tbody>'
    + '</table></div>';
  var addFormHtml = isAdminUI
    ? '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:10px;">'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Report Month<br><input type="text" id="fin-ptr-month" placeholder="2026-06" style="width:100px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Tax Year<br><input type="number" id="fin-ptr-taxyear" placeholder="2026" style="width:90px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Estimated Tax ($)<br><input type="number" id="fin-ptr-estimate" step="0.01" style="width:110px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Contribution ($)<br><input type="number" id="fin-ptr-contribution" step="0.01" style="width:110px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Note<br><input type="text" id="fin-ptr-note" style="width:180px;"></label>'
      + '<button class="btn-primary" style="font-size:.78rem;padding:5px 12px;" onclick="finPropertyAddReserveMonth()">+ Add Month</button>'
      + '</div>'
      + '<p style="font-size:.72rem;color:var(--warm-gray);margin:6px 0 0;">"Before" carries forward automatically from the prior month’s "After" — leave Estimated Tax/Contribution at 0 the month the bill is paid to zero the reserve out.</p>'
    : '';
  var pacNote = (d.meta && d.meta.capital_improvements && d.meta.capital_improvements.separate_paint_asphalt_concrete_reserve_note) || '';
  return '<h4 style="margin:18px 0 8px;font-size:.9rem;">Property Tax Reserve</h4>'
    + scheduleHtml + paidHtml + addFormHtml
    + (pacNote ? '<p style="font-size:.75rem;color:var(--warm-gray);margin:12px 0 0;"><i>' + esc(pacNote) + '</i></p>' : '');
}
function finPropertyAddReserveMonth() {
  var month = document.getElementById('fin-ptr-month').value.trim();
  if (!/^\d{4}-\d{2}$/.test(month)) { finToast('Report month must be YYYY-MM.'); return; }
  var body = {
    report_month: month,
    tax_year: document.getElementById('fin-ptr-taxyear').value || '',
    target_estimate: document.getElementById('fin-ptr-estimate').value,
    contribution: document.getElementById('fin-ptr-contribution').value || '0',
    note: document.getElementById('fin-ptr-note').value.trim(),
  };
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/reserves/property_tax/monthly', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }).then(function(d) {
    if (d && d.error) { finToast(d.error); return; }
    finLoadProperty();
  });
}
function finPropertyDeleteReserveMonth(reserveKey, month) {
  if (!confirm('Delete the ' + month + ' reserve entry? This cannot be undone.')) return;
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/reserves/' + reserveKey + '/monthly/' + encodeURIComponent(month), { method: 'DELETE' }).then(function() { finLoadProperty(); });
}
function finPropertyDeleteReserveDisbursement(reserveKey, periodKey) {
  if (!confirm('Delete the recorded payment for ' + periodKey + '?')) return;
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/reserves/' + reserveKey + '/disbursements/' + encodeURIComponent(periodKey), { method: 'DELETE' }).then(function() { finLoadProperty(); });
}

// ── Capital Improvements ─────────────────────────────────────────────────────────────────────
function finRenderCapitalImprovements(d, isAdminUI) {
  var ledger = (d.capitalLedger || []).slice().sort(function(a,b){ return (a.entry_date||'') < (b.entry_date||'') ? -1 : 1; });
  var ledgerRows = ledger.map(function(r) {
    return '<tr><td style="padding:5px 8px;">' + esc(r.entry_date || '(unknown)') + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">$' + finFmtMoney(r.amount_cents/100) + '</td>'
      + '<td style="padding:5px 8px;">' + esc(r.payee || '') + '</td>'
      + '<td style="padding:5px 8px;font-size:.78rem;">' + esc(r.description || '') + '</td>'
      + '<td style="padding:5px 8px;font-size:.75rem;color:var(--warm-gray);">' + esc(r.check_ref || '') + '</td>'
      + '<td style="padding:5px 8px;font-size:.75rem;color:var(--warm-gray);">' + esc(r.project || '') + '</td>'
      + (isAdminUI ? '<td style="padding:5px 8px;"><button class="btn-secondary" style="font-size:.72rem;padding:2px 6px;color:var(--danger);" onclick="finPropertyDeleteCapitalLedger(' + r.id + ')">Delete</button></td>' : '') + '</tr>';
  }).join('');
  var totalCents = d.capitalLedgerTotalCents || 0;
  var ledgerHtml = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr><th style="text-align:left;padding:5px 8px;">Date</th><th style="text-align:right;padding:5px 8px;">Amount</th><th style="text-align:left;padding:5px 8px;">Payee</th><th style="text-align:left;padding:5px 8px;">Description</th><th style="text-align:left;padding:5px 8px;">Check/Ref</th><th style="text-align:left;padding:5px 8px;">Project</th>' + (isAdminUI ? '<th></th>' : '') + '</tr></thead>'
    + '<tbody>' + (ledgerRows || '<tr><td colspan="7" style="padding:10px;color:var(--warm-gray);">No capital improvements recorded yet.</td></tr>') + '</tbody>'
    + '<tfoot><tr style="font-weight:600;border-top:2px solid var(--navy);"><td style="padding:5px 8px;" colspan="1">Total</td><td style="padding:5px 8px;text-align:right;">$' + finFmtMoney(totalCents/100) + '</td><td colspan="' + (isAdminUI ? 5 : 4) + '"></td></tr></tfoot>'
    + '</table></div>';

  var projects = (d.meta && d.meta.capital_improvements && d.meta.capital_improvements.projects_summary) || [];
  var projRows = projects.map(function(p) {
    return '<tr><td style="padding:5px 8px;font-weight:600;">' + esc(p.project) + '</td>'
      + '<td style="padding:5px 8px;">' + esc(p.started || '') + '</td>'
      + '<td style="padding:5px 8px;">' + esc(p.completed || '') + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">$' + finFmtMoney((p.total_capitalized_cents||0)/100) + '</td>'
      + '<td style="padding:5px 8px;font-size:.75rem;color:var(--warm-gray);">' + esc(p.note || '') + '</td></tr>';
  }).join('');
  var projHtml = projects.length ? ('<div style="overflow-x:auto;margin-top:10px;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;">'
    + '<thead style="border-bottom:1px solid var(--border);"><tr><th style="text-align:left;padding:5px 8px;">Project</th><th style="text-align:left;padding:5px 8px;">Started</th><th style="text-align:left;padding:5px 8px;">Completed</th><th style="text-align:right;padding:5px 8px;">Capitalized</th><th style="text-align:left;padding:5px 8px;">Note</th></tr></thead>'
    + '<tbody>' + projRows + '</tbody></table></div>') : '';

  var addFormHtml = isAdminUI
    ? '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:10px;">'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Date<br><input type="text" id="fin-cap-date" placeholder="2026-06-15" style="width:110px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Amount ($)<br><input type="number" id="fin-cap-amount" step="0.01" style="width:100px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Payee<br><input type="text" id="fin-cap-payee" style="width:150px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Description<br><input type="text" id="fin-cap-description" style="width:200px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Check/Ref<br><input type="text" id="fin-cap-checkref" style="width:120px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Project<br><input type="text" id="fin-cap-project" style="width:180px;"></label>'
      + '<button class="btn-primary" style="font-size:.78rem;padding:5px 12px;" onclick="finPropertyAddCapitalLedger()">+ Add</button>'
      + '</div>'
    : '';

  return '<h4 style="margin:18px 0 8px;font-size:.9rem;">Capital Improvements</h4>' + ledgerHtml + projHtml + addFormHtml;
}
function finPropertyAddCapitalLedger() {
  var amount = document.getElementById('fin-cap-amount').value;
  if (amount === '') { finToast('Enter an amount.'); return; }
  var body = {
    entry_date: document.getElementById('fin-cap-date').value.trim(),
    amount: amount,
    payee: document.getElementById('fin-cap-payee').value.trim(),
    description: document.getElementById('fin-cap-description').value.trim(),
    check_ref: document.getElementById('fin-cap-checkref').value.trim(),
    project: document.getElementById('fin-cap-project').value.trim(),
  };
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/capital-ledger', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }).then(function(d) {
    if (d && d.error) { finToast(d.error); return; }
    finLoadProperty();
  });
}
function finPropertyDeleteCapitalLedger(id) {
  if (!confirm('Delete this capital improvement entry? This cannot be undone.')) return;
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/capital-ledger/' + id, { method: 'DELETE' }).then(function() { finLoadProperty(); });
}

// ── Repairs & Maintenance ────────────────────────────────────────────────────────────────────
function finRenderRepairs(d, isAdminUI) {
  var rows = (d.repairs || []).slice().sort(function(a,b){ return (a.entry_date||'') < (b.entry_date||'') ? -1 : 1; });
  var repairRows = rows.map(function(r) {
    return '<tr><td style="padding:5px 8px;">' + esc(r.entry_date || '') + '</td>'
      + '<td style="padding:5px 8px;">' + esc(r.category || '') + '</td>'
      + '<td style="padding:5px 8px;font-size:.78rem;">' + esc(r.description || '') + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + (r.amount_cents == null ? '<span style="color:var(--warm-gray);">—</span>' : '$' + finFmtMoney(r.amount_cents/100)) + '</td>'
      + '<td style="padding:5px 8px;font-size:.75rem;color:var(--warm-gray);">' + esc(r.payee || '') + '</td>'
      + (isAdminUI ? '<td style="padding:5px 8px;"><button class="btn-secondary" style="font-size:.72rem;padding:2px 6px;color:var(--danger);" onclick="finPropertyDeleteRepair(' + r.id + ')">Delete</button></td>' : '') + '</tr>';
  }).join('');
  var html = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr><th style="text-align:left;padding:5px 8px;">Date</th><th style="text-align:left;padding:5px 8px;">Category</th><th style="text-align:left;padding:5px 8px;">Description</th><th style="text-align:right;padding:5px 8px;">Amount</th><th style="text-align:left;padding:5px 8px;">Payee</th>' + (isAdminUI ? '<th></th>' : '') + '</tr></thead>'
    + '<tbody>' + (repairRows || '<tr><td colspan="6" style="padding:10px;color:var(--warm-gray);">No repairs recorded yet.</td></tr>') + '</tbody>'
    + '</table></div>';
  var addFormHtml = isAdminUI
    ? '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:10px;">'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Date<br><input type="text" id="fin-rep-date" placeholder="2026-06-15" style="width:110px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Category<br><input type="text" id="fin-rep-category" placeholder="HVAC" style="width:110px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Description<br><input type="text" id="fin-rep-description" style="width:200px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Amount ($)<br><input type="number" id="fin-rep-amount" step="0.01" style="width:100px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Payee<br><input type="text" id="fin-rep-payee" style="width:150px;"></label>'
      + '<button class="btn-primary" style="font-size:.78rem;padding:5px 12px;" onclick="finPropertyAddRepair()">+ Add</button>'
      + '</div>'
    : '';
  return '<h4 style="margin:18px 0 8px;font-size:.9rem;">Repairs &amp; Maintenance</h4>' + html + addFormHtml;
}
function finPropertyAddRepair() {
  var body = {
    entry_date: document.getElementById('fin-rep-date').value.trim(),
    category: document.getElementById('fin-rep-category').value.trim(),
    description: document.getElementById('fin-rep-description').value.trim(),
    amount: document.getElementById('fin-rep-amount').value,
    payee: document.getElementById('fin-rep-payee').value.trim(),
  };
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/repairs', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }).then(function(d) {
    if (d && d.error) { finToast(d.error); return; }
    finLoadProperty();
  });
}
function finPropertyDeleteRepair(id) {
  if (!confirm('Delete this repair entry? This cannot be undone.')) return;
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/repairs/' + id, { method: 'DELETE' }).then(function() { finLoadProperty(); });
}

// ── Insurance Allocation (read-only reference — GuideOne church-wide policy, allocated by
// building value share; see meta.insurance in the backend) ──────────────────────────────────
function finRenderInsuranceAllocation(d) {
  var ins = (d.meta && d.meta.insurance) || null;
  if (!ins) return '';
  var alloc = ins.ivanhoe_allocation || {};
  var html = '<p style="font-size:.78rem;color:var(--warm-gray);margin:0 0 8px;">' + esc(ins.policy_structure_note || '') + '</p>'
    + '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px;">'
    + '<div class="rpt-stat"><div class="rpt-stat-num">' + ((alloc.ivanhoe_share_of_total_insured_value_pct||0)*100).toFixed(1) + '%</div><div class="rpt-stat-lbl">Share of Insured Value</div></div>'
    + '<div class="rpt-stat"><div class="rpt-stat-num">$' + finFmtMoney((alloc.allocated_total_annual_cents||0)/100) + '</div><div class="rpt-stat-lbl">Allocated Annual Premium</div></div>'
    + '</div>'
    + (alloc.estimate_note ? '<p style="font-size:.75rem;color:var(--warm-gray);margin:0 0 8px;"><i>' + esc(alloc.estimate_note) + '</i></p>' : '');
  return '<h4 style="margin:18px 0 8px;font-size:.9rem;">Insurance Allocation (Estimate)</h4>' + html;
}
function finPropertyOpenMonthModal(period) {
  var m = period ? (_finProperty.monthly || []).filter(function(r){ return r.period === period; })[0] : null;
  document.getElementById('fpm-period').value = m ? m.period : '';
  document.getElementById('fpm-period').disabled = !!m;
  document.getElementById('fpm-occupancy').value = m && m.occupancy_pct != null ? (m.occupancy_pct*100) : '';
  document.getElementById('fpm-revenue').value = m && m.total_revenue_cents != null ? (m.total_revenue_cents/100) : '';
  document.getElementById('fpm-expenses').value = m && m.total_expenses_cents != null ? (m.total_expenses_cents/100) : '';
  document.getElementById('fpm-net-income').value = m && m.net_income_cents != null ? (m.net_income_cents/100) : '';
  document.getElementById('fpm-noi').value = m && m.net_operating_income_cents != null ? (m.net_operating_income_cents/100) : '';
  document.getElementById('fpm-afd').value = m && m.available_for_distribution_cents != null ? (m.available_for_distribution_cents/100) : '';
  document.getElementById('fpm-reserve').value = m && m.reserve_balance_cents != null ? (m.reserve_balance_cents/100) : '';
  document.getElementById('fpm-source').value = m ? (m.source_report || '') : '';
  document.getElementById('fpm-error').textContent = '';
  openModal('fin-property-month-modal');
}
function finPropertySaveMonth() {
  var period = document.getElementById('fpm-period').value.trim();
  var errEl = document.getElementById('fpm-error');
  if (!/^\d{4}-\d{2}$/.test(period)) { errEl.textContent = 'Period must be in YYYY-MM format.'; return; }
  function numOrEmpty(id) { var v = document.getElementById(id).value; return v === '' ? '' : v; }
  var body = {
    period: period,
    occupancy_pct: numOrEmpty('fpm-occupancy') === '' ? '' : Number(document.getElementById('fpm-occupancy').value) / 100,
    total_revenue: numOrEmpty('fpm-revenue'),
    total_expenses: numOrEmpty('fpm-expenses'),
    net_income: numOrEmpty('fpm-net-income'),
    net_operating_income: numOrEmpty('fpm-noi'),
    available_for_distribution: numOrEmpty('fpm-afd'),
    reserve_balance: numOrEmpty('fpm-reserve'),
    source_report: document.getElementById('fpm-source').value.trim(),
  };
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/monthly', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }).then(function(d) {
    if (d && d.error) { errEl.textContent = d.error; return; }
    closeModal('fin-property-month-modal');
    finLoadProperty();
  }).catch(function(err) { errEl.textContent = err && err.message ? err.message : 'Save failed.'; });
}
function finPropertyDeleteMonth(period) {
  if (!confirm('Delete the ' + period + ' entry? This cannot be undone.')) return;
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/monthly/' + encodeURIComponent(period), { method: 'DELETE' }).then(function() {
    finLoadProperty();
  });
}
function finPropertyAddDistribution() {
  var period = document.getElementById('fin-prop-dist-period').value.trim();
  var amount = document.getElementById('fin-prop-dist-amount').value;
  if (!/^\d{4}-\d{2}$/.test(period) || amount === '') { finToast('Enter a valid period (YYYY-MM) and amount.'); return; }
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/distributions', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ period: period, amount: amount }) }).then(function(d) {
    if (d && d.error) { finToast(d.error); return; }
    finLoadProperty();
  });
}
function finPropertyDeleteDistribution(period) {
  if (!confirm('Delete the distribution recorded for ' + period + '?')) return;
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/distributions/' + encodeURIComponent(period), { method: 'DELETE' }).then(function() {
    finLoadProperty();
  });
}

// ── Church Budget Planning ────────────────────────────────────────────────────────────────
// Mirrors the real chart of accounts (same tree Church Report shows — finBuildTreeFromFlatRows,
// reused as-is) instead of freeform category names: Current Year Budget | Current Year Actual |
// Projected {target year}. "Generate All" auto-fills the Projected column for every real account
// by compounding a flat growth rate off that account's current-year actual; any line can then be
// hand-corrected before Save. Salary & Benefits gets its own callout — the app doesn't yet know
// the formula/Concordia Plan Services comparison the user described; it's a placeholder until
// that's provided, not a guess. See src/api-finance.js for generate-all()/override-bulk()/
// commit() semantics and why plan_committed is the lowest-priority resolveChurchYearPrecedence
// source.
var _finPlanRows = [];
var _finPlanBaseYear = new Date().getFullYear();
var _finPlanTargetYear = _finPlanBaseYear + 1;
var _finPlanBaseTree = null;
var _finPlanBaseNet = { actualCents: 0, budgetCents: 0 };
var _finPlanEdits = {}; // category_path -> dollars string, for cells the user has typed into
// The Salary Calculator and Health Insurance cards fully rebuild #fin-plan-root's innerHTML on
// every keystroke (same pattern as the rest of this app), which destroys and recreates the
// focused input — losing both keyboard focus and (since nothing stays focused) the page's scroll
// position, so it visibly jumps to the top on every character typed. This wrapper captures focus
// (by element id — every input touched by it must have a stable one), cursor/selection position,
// and scroll position before re-rendering, then restores all three afterward.
function finRerenderPlanningPreserveFocus() {
  var active = document.activeElement;
  var activeId = active && active.id;
  var selStart = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
  var selEnd = active && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;
  var scrollY = window.scrollY;
  var contentArea = document.querySelector('.content-area');
  var contentScrollTop = contentArea ? contentArea.scrollTop : null;
  finRenderPlanning();
  if (activeId) {
    var restored = document.getElementById(activeId);
    if (restored) {
      restored.focus();
      if (selStart != null && restored.setSelectionRange) {
        try { restored.setSelectionRange(selStart, selEnd); } catch (e) { /* not a text-selectable input, ignore */ }
      }
    }
  }
  window.scrollTo(0, scrollY);
  if (contentArea && contentScrollTop != null) contentArea.scrollTop = contentScrollTop;
}
function finLoadPlanning() {
  var el = document.getElementById('fin-plan-root');
  if (!el) return;
  el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">Loading…</p>';
  Promise.all([
    api('/admin/api/finance/planning/church'),
    api('/admin/api/finance/church/this-year?year=' + _finPlanBaseYear),
  ]).then(function(results) {
    _finPlanRows = (results[0] && results[0].rows) || [];
    _finPlanBaseTree = finReorganizeChurchTree(finBuildTreeFromFlatRows((results[1] && results[1].entries) || []));
    _finPlanBaseNet = (results[1] && results[1].netIncome) || { actualCents: 0, budgetCents: 0 };
    _finPlanEdits = {};
    finRenderPlanning();
    finRenderPropertyMultiYearForecast();
  }).catch(function(err) {
    if (err && err.message === 'Unauthorized') return;
    el.innerHTML = '<p style="font-size:.85rem;color:var(--danger);">Could not load budget plan.</p>';
  });
}
function finPlanChangeBaseYear() {
  var y = parseInt(document.getElementById('fin-plan-base-year').value, 10);
  if (!isFinite(y)) return;
  _finPlanBaseYear = y;
  _finPlanTargetYear = y + 1;
  finLoadPlanning();
}
function finPlanFindRow(categoryPath) {
  return _finPlanRows.filter(function(r) { return r.category === categoryPath && r.fiscal_year === _finPlanTargetYear; })[0];
}
function finRenderPlanning() {
  var el = document.getElementById('fin-plan-root');
  if (!el) return;
  var isAdminUI = (_userRole === 'admin');

  var yearPickerHtml = '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px;">'
    + '<label style="font-size:.72rem;color:var(--warm-gray);">Base Year (actual/budget source)<br><input type="number" id="fin-plan-base-year" value="' + _finPlanBaseYear + '" onchange="finPlanChangeBaseYear()" style="width:100px;"></label>'
    + '<label style="font-size:.72rem;color:var(--warm-gray);">Projecting For<br><input type="number" id="fin-plan-target-year" value="' + _finPlanTargetYear + '" onchange="finPlanChangeTargetYear()" style="width:100px;"></label>'
    + '</div>';

  var rowsHtml = [];
  // Projected totals are summed only across LEAF accounts (no children) — mirrors how the real
  // FY base totals are already rolled up (own postings only, never double-counting a subtotal),
  // so a value typed directly onto a group/branch row (allowed, but unusual) doesn't inflate it.
  var projectedRevenueCents = 0, projectedExpenseCents = 0;
  function walk(nodes) {
    (nodes || []).forEach(function(node) {
      var planRow = finPlanFindRow(node.path);
      var editedVal = _finPlanEdits[node.path];
      var cellVal = editedVal !== undefined ? editedVal : (planRow ? (planRow.planned_amount_cents/100).toFixed(2) : '');
      var bold = node.children.length > 0;
      if (!bold && cellVal !== '' && isFinite(parseFloat(cellVal))) {
        var cents = Math.round(parseFloat(cellVal) * 100);
        if (node.classification === 'Income' || node.classification === 'Other Income') projectedRevenueCents += cents;
        else projectedExpenseCents += cents;
      }
      rowsHtml.push('<tr' + (bold ? ' style="font-weight:600;"' : '') + '>'
        + '<td style="padding:4px 8px 4px ' + (10 + node.depth * 16) + 'px;">' + esc(node.label) + '</td>'
        + '<td style="text-align:right;padding:4px 8px;">' + (node.hasBudgetInfo ? '$' + finFmtMoney(node.totalBudgetCents/100) : '<span style="color:var(--warm-gray);">—</span>') + '</td>'
        + '<td style="text-align:right;padding:4px 8px;">$' + finFmtMoney(node.totalActualCents/100) + '</td>'
        + '<td style="text-align:right;padding:4px 8px;">' + (isAdminUI
          ? '<input type="number" step="0.01" value="' + cellVal + '" style="width:100px;text-align:right;" oninput="finPlanEditCell(' + volJsAttr(node.path) + ',this.value)">'
          : (cellVal !== '' ? '$' + finFmtMoney(parseFloat(cellVal)) : '<span style="color:var(--warm-gray);">—</span>')) + '</td>'
        + '</tr>');
      walk(node.children);
    });
  }
  walk(_finPlanBaseTree);
  var projectedNetCents = projectedRevenueCents - projectedExpenseCents;
  function netCell(cents) {
    return '<td style="text-align:right;padding:5px 8px;color:' + (cents < 0 ? 'var(--danger)' : 'var(--sage)') + ';">' + (cents < 0 ? '−' : '') + '$' + finFmtMoney(Math.abs(cents)/100) + '</td>';
  }
  var netRow = '<tr style="font-weight:700;border-top:2px solid var(--navy);"><td style="padding:5px 8px;">Net (Revenue − Expenses)</td>'
    + (_finPlanBaseNet.budgetCents ? netCell(_finPlanBaseNet.budgetCents) : '<td style="padding:5px 8px;text-align:right;color:var(--warm-gray);">—</td>')
    + netCell(_finPlanBaseNet.actualCents)
    + netCell(projectedNetCents)
    + '</tr>';

  var tableHtml = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr><th style="text-align:left;padding:5px 8px;">Account</th><th style="text-align:right;padding:5px 8px;">FY' + _finPlanBaseYear + ' Budget</th><th style="text-align:right;padding:5px 8px;">FY' + _finPlanBaseYear + ' Actual</th><th style="text-align:right;padding:5px 8px;">FY' + _finPlanTargetYear + ' Projected</th></tr></thead>'
    + '<tbody>' + (rowsHtml.join('') || '<tr><td colspan="4" style="padding:10px;color:var(--warm-gray);">No Church Budget data found for ' + _finPlanBaseYear + ' — sync or import that year first (Church Report tab).</td></tr>')
    + (rowsHtml.length ? netRow : '') + '</tbody></table></div>';

  var actionsHtml = isAdminUI
    ? '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:12px;">'
      + '<label style="font-size:.72rem;color:var(--warm-gray);">Growth Assumption %<br><input type="number" id="fin-plan-growth" step="0.1" placeholder="3" style="width:100px;"></label>'
      + '<button class="btn-secondary" style="font-size:.78rem;padding:5px 12px;" onclick="finPlanGenerateAll()">Generate All (fills every blank line)</button>'
      + '<button class="btn-primary" style="font-size:.78rem;padding:5px 12px;" onclick="finPlanSaveAll()">Save Changes</button>'
      + '<button class="btn-secondary" style="font-size:.78rem;padding:5px 12px;" onclick="finPlanCommit()">Commit FY' + _finPlanTargetYear + ' to Real Budget</button>'
      + '</div>'
      + '<div id="fin-plan-msg" style="font-size:.75rem;color:var(--warm-gray);margin-top:6px;"></div>'
    : '';

  el.innerHTML = yearPickerHtml + tableHtml + actionsHtml + finRenderSalaryCalculator(isAdminUI) + finRenderHealthInsuranceCalculator(isAdminUI);
}
function finPlanChangeTargetYear() {
  var y = parseInt(document.getElementById('fin-plan-target-year').value, 10);
  if (!isFinite(y)) return;
  _finPlanTargetYear = y;
  _finPlanEdits = {};
  finRenderPlanning();
}
function finPlanEditCell(categoryPath, value) {
  _finPlanEdits[categoryPath] = value;
}
function finPlanGenerateAll() {
  var growthPct = parseFloat(document.getElementById('fin-plan-growth').value);
  var msgEl = document.getElementById('fin-plan-msg');
  if (!isFinite(growthPct)) { msgEl.textContent = 'Enter a growth % first.'; return; }
  msgEl.textContent = 'Generating…';
  var body = { base_year: _finPlanBaseYear, target_year: _finPlanTargetYear, growth_pct: growthPct / 100 };
  api('/admin/api/finance/planning/church/generate-all', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }).then(function(d) {
    if (d && d.error) { msgEl.textContent = d.error; return; }
    msgEl.textContent = 'Generated ' + d.generated + ' line(s).';
    finLoadPlanning();
  }).catch(function(err) { msgEl.textContent = err && err.message || 'Generate failed.'; });
}
function finPlanSaveAll() {
  var msgEl = document.getElementById('fin-plan-msg');
  var rows = [];
  function collect(nodes) {
    (nodes || []).forEach(function(node) {
      var v = _finPlanEdits[node.path];
      if (v !== undefined && v !== '' && isFinite(parseFloat(v))) {
        rows.push({ category: node.path, classification: node.classification, fiscal_year: _finPlanTargetYear, planned_amount: v });
      }
      collect(node.children);
    });
  }
  collect(_finPlanBaseTree);
  if (!rows.length) { msgEl.textContent = 'No changes to save.'; return; }
  msgEl.textContent = 'Saving…';
  api('/admin/api/finance/planning/church/override-bulk', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ rows: rows }) }).then(function(d) {
    if (d && d.error) { msgEl.textContent = d.error; return; }
    msgEl.textContent = 'Saved ' + d.saved + ' line(s).';
    finLoadPlanning();
  }).catch(function(err) { msgEl.textContent = err && err.message || 'Save failed.'; });
}
function finPlanCommit() {
  var msgEl = document.getElementById('fin-plan-msg');
  var year = _finPlanTargetYear;
  if (!confirm('Commit all planned lines for FY' + year + ' into the real Church Budget as a placeholder? This replaces any previously committed plan for that year, and will itself be overridden the moment a real sync or import exists for ' + year + '.')) return;
  msgEl.textContent = 'Committing…';
  api('/admin/api/finance/planning/church/commit', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ fiscal_year: year }) }).then(function(d) {
    if (d && d.error) { msgEl.textContent = d.error; return; }
    msgEl.textContent = 'Committed ' + d.committed + ' line(s) for FY' + year + '.';
  }).catch(function(err) { msgEl.textContent = err && err.message || 'Commit failed.'; });
}

// ── Salary & Benefits Calculator (LCMS Missouri District Compensation Guidelines FY2026-2027) ──
// Base salary × role/education/experience multiplier, per the district's own published tables —
// verbatim from the PDF the user provided, not approximated. Extend LCMS_MO_BASE_SALARY_BY_YEAR
// with next year's base figure when a new guideline document comes out (Base Salary History
// table, page 2 of the PDF). Benefits (health/retirement via Concordia Plan Services) have no
// published $ or % formula in this document — CPS quotes those directly per congregation via
// their own (login-gated) tool — so Benefits here is a plain user-entered figure, not computed.
var LCMS_MO_BASE_SALARY_BY_YEAR = { 2016: 39900, 2017: 40000, 2018: 40250, 2019: 40900, 2020: 41718, 2021: 42625, 2022: 43515, 2023: 45475, 2024: 47066, 2025: 48713, 2026: 50028, 2027: 51529 };
// Section 1.1 — Annual Compensation Scale for Pastors, years of experience 0-30; the district
// recommends +0.02/year of additional multiplier for service beyond 30 years (no hard cap).
var LCMS_PASTOR_MULTIPLIERS = [1.45,1.47,1.49,1.51,1.54,1.57,1.60,1.63,1.66,1.69,1.72,1.75,1.78,1.81,1.84,1.87,1.90,1.93,1.96,1.99,2.01,2.03,2.05,2.07,2.09,2.11,2.13,2.15,2.17,2.19,2.21];
// Section 1.2 — Annual Compensation Scale for Commissioned Workers (educators/DCE/DCO/Deaconess/
// etc). Each education track's multiplier caps at the printed table's last year (the district's
// own footnote: reaching the end of a column stops further years-of-service increases, to
// encourage further formal education) EXCEPT the three degree tracks at/above a Master's, which
// the district recommends growing +0.02/year beyond year 25 instead of capping.
var LCMS_COMMISSIONED_TRACKS = {
  bs:      { label: 'B.S., no further hours', multipliers: [1.00,1.02,1.04,1.06,1.08,1.10,1.12,1.14,1.16,1.18,1.20], capped: true },
  bs10:    { label: 'B.S. + 10 hrs (working toward MA)', multipliers: [1.03,1.05,1.07,1.09,1.12,1.15,1.18,1.20,1.22,1.24,1.26,1.28,1.30], capped: true },
  bs20:    { label: 'B.S. + 20 hrs (working toward MA)', multipliers: [1.06,1.08,1.10,1.12,1.15,1.18,1.21,1.24,1.27,1.30,1.33,1.35,1.37,1.39,1.41,1.43], capped: true },
  ma:      { label: 'M.A.', multipliers: [1.12,1.14,1.16,1.18,1.21,1.24,1.27,1.30,1.33,1.36,1.39,1.42,1.45,1.48,1.51,1.53,1.55,1.57,1.59,1.61,1.63,1.65,1.67,1.69,1.71,1.73], growBeyond: 0.02 },
  ma10phd: { label: 'M.A. + 10 hrs (working toward PhD)', multipliers: [1.16,1.18,1.20,1.22,1.25,1.28,1.31,1.34,1.37,1.40,1.43,1.46,1.49,1.52,1.55,1.58,1.61,1.64,1.66,1.68,1.70,1.72,1.74,1.76,1.78,1.80], growBeyond: 0.02 },
  ma20phd: { label: 'M.A. + 20 hrs (working toward PhD)', multipliers: [1.20,1.22,1.24,1.26,1.29,1.32,1.35,1.38,1.41,1.44,1.47,1.50,1.53,1.56,1.59,1.62,1.65,1.68,1.71,1.74,1.77,1.79,1.81,1.83,1.85,1.87], growBeyond: 0.02 },
};
// Section 1.3 — Annual Compensation Scale for Other Church Workers, years 0-20; the district
// recommends +0.02/year beyond year 20 for all four of these (no cap, unlike the B.S.-only
// commissioned tracks above).
var LCMS_OTHER_WORKER_TRACKS = {
  custodian:              { label: 'Custodian', multipliers: [0.65,0.67,0.69,0.72,0.75,0.78,0.81,0.84,0.87,0.90,0.93,0.96,0.99,1.02,1.05,1.08,1.11,1.14,1.17,1.19,1.21], growBeyond: 0.02 },
  secretary:              { label: 'Secretary', multipliers: [0.75,0.77,0.79,0.82,0.85,0.88,0.91,0.94,0.97,1.00,1.03,1.06,1.09,1.12,1.15,1.18,1.21,1.24,1.27,1.29,1.31], growBeyond: 0.02 },
  childcare_director:     { label: 'Child Care Director', multipliers: [1.05,1.07,1.09,1.12,1.15,1.18,1.21,1.24,1.27,1.30,1.33,1.36,1.39,1.42,1.45,1.48,1.51,1.54,1.57,1.59,1.61], growBeyond: 0.02 },
  business_manager_music: { label: 'Business Manager / Director of Music', multipliers: [1.10,1.12,1.14,1.17,1.20,1.23,1.26,1.29,1.32,1.35,1.38,1.41,1.44,1.47,1.50,1.53,1.56,1.59,1.62,1.65,1.68], growBeyond: 0.02 },
};
// Section 1.6 — additional multiplier for extra responsibility, added on top of the base
// education/experience multiplier (e.g. a teacher who is also Principal). Ranges as published;
// the calculator uses the midpoint as a starting default, hand-adjustable per worker.
var LCMS_RESPONSIBILITY_STIPENDS = [
  { key: 'none', label: 'None', range: [0, 0] },
  { key: 'exec_director', label: 'Executive Director', range: [0.25, 0.45] },
  { key: 'principal', label: 'Principal', range: [0.20, 0.40] },
  { key: 'early_childhood_director', label: 'Early Childhood Director', range: [0.10, 0.20] },
  { key: 'assistant_principal', label: 'Assistant Principal', range: [0.10, 0.20] },
  { key: 'dce', label: 'Director of Christian Education', range: [0.10, 0.20] },
  { key: 'music_director', label: 'Director of Music for Congregation', range: [0.05, 0.15] },
  { key: 'youth_director', label: 'Director of Youth', range: [0.05, 0.15] },
  { key: 'part_time_admin', label: 'Administrator for Part-Time Agencies', range: [0.05, 0.15] },
  { key: 'athletic_director', label: 'Athletic Director', range: [0.05, 0.15] },
  { key: 'tech_coordinator', label: 'Technology Coordinator', range: [0.05, 0.15] },
];
// Section 1.4 — additional multiplier for a sole/senior pastor, based on worship attendance.
var LCMS_ATTENDANCE_BONUS_BANDS = [
  { key: 'none', label: 'Not applicable / under 150', range: [0, 0] },
  { key: 'band1', label: '150–350 average attendance', range: [0.05, 0.10] },
  { key: 'band2', label: '351–750 average attendance', range: [0.10, 0.15] },
  { key: 'band3', label: '750+ average attendance', range: [0.15, 0.25] },
];
// colaPct is an optional growth-rate assumption (e.g. the published annual Social Security COLA)
// used ONLY when the requested year has no published district base salary yet — it compounds the
// most recent known year's base forward instead of just freezing it flat. Omit/0 preserves the
// original flat-fallback behavior exactly.
function finLcmsBaseSalaryCents(year, colaPct) {
  var years = Object.keys(LCMS_MO_BASE_SALARY_BY_YEAR).map(Number).sort(function(a,b){return a-b;});
  var found = LCMS_MO_BASE_SALARY_BY_YEAR[year];
  if (found != null) return { dollars: found, exact: true, sourceYear: year, colaApplied: false };
  // Fall back to the most recent known year at or before the requested one (or the earliest
  // known year, if the request predates the whole table) rather than fabricating a number.
  var candidates = years.filter(function(y) { return y <= year; });
  var sourceYear = candidates.length ? candidates[candidates.length - 1] : years[0];
  var sourceDollars = LCMS_MO_BASE_SALARY_BY_YEAR[sourceYear];
  var rate = Number(colaPct) || 0;
  var yearsPast = year - sourceYear;
  var colaApplied = rate !== 0 && yearsPast > 0;
  var dollars = colaApplied ? sourceDollars * Math.pow(1 + rate, yearsPast) : sourceDollars;
  return { dollars: dollars, exact: false, sourceYear: sourceYear, colaApplied: colaApplied };
}
// Looks up (or extrapolates) a multiplier from one of the tables above. growBeyond extends the
// scale past its last published year; capped freezes at the last published value instead
// (matches the district's own distinction between the B.S.-only commissioned tracks, which cap
// to encourage further education, and every other track, which the district recommends growing).
function finLcmsMultiplierFor(track, yearsExperience) {
  var years = Math.max(0, Math.floor(Number(yearsExperience) || 0));
  var multipliers = track.multipliers;
  if (years < multipliers.length) return multipliers[years];
  var last = multipliers[multipliers.length - 1];
  if (track.capped || !track.growBeyond) return last;
  return Math.round((last + track.growBeyond * (years - (multipliers.length - 1))) * 100) / 100;
}
// Pure — no DOM — computes one worker's salary per the LCMS MO District formula: base salary (by
// year) × (role/education/experience multiplier + any responsibility stipend + any attendance
// bonus, the latter only meaningful for a sole/senior pastor per Section 1.4).
function finComputeLcmsSalary(opts) {
  var base = finLcmsBaseSalaryCents(opts.year, opts.colaPct);
  var track;
  if (opts.role === 'pastor') track = { multipliers: LCMS_PASTOR_MULTIPLIERS, growBeyond: 0.02 };
  else if (opts.role === 'commissioned') track = LCMS_COMMISSIONED_TRACKS[opts.trackKey];
  else track = LCMS_OTHER_WORKER_TRACKS[opts.trackKey];
  if (!track) return null;
  var multiplier = finLcmsMultiplierFor(track, opts.yearsExperience) + (Number(opts.responsibilityStipend) || 0) + (Number(opts.attendanceBonus) || 0);
  var salaryCents = Math.round(base.dollars * 100 * multiplier);
  return { baseDollars: base.dollars, baseExact: base.exact, baseSourceYear: base.sourceYear, multiplier: multiplier, salaryCents: salaryCents };
}

// Pastors and Commissioned Ministers (e.g. DCEs) are classified by the IRS as self-employed for
// Social Security purposes ("Ministers of Religion") — the church does not pay the employer half
// of FICA for them, the worker pays the full SECA amount themselves. Other Church Workers are
// regular W-2 employees, so the church does pay the standard employer share. This default can be
// wrong for a specific real worker (e.g. a Director of Parish Music who is treated as a regular
// employee at a given congregation despite nominally qualifying for minister tax treatment
// elsewhere), so it's a per-worker override, not a hardcoded role rule.
function finDefaultSelfEmployedFica(role) {
  return role === 'pastor' || role === 'commissioned';
}
var LCMS_EMPLOYER_FICA_RATE = 0.0765; // combined employer OASDI (6.2%) + Medicare (1.45%)
// Employer-side FICA cost to the church — $0 for a self-employed (SECA) worker, since the church
// has no employer-FICA obligation for them at all; the worker pays their own full SECA share
// outside of what the church budgets here.
function finComputeEmployerFicaCents(salaryCents, selfEmployedFica) {
  if (selfEmployedFica) return 0;
  return Math.round((salaryCents || 0) * LCMS_EMPLOYER_FICA_RATE);
}

var _finSalaryRoster = [];
var _finSalaryColaPct = 0; // growth-rate assumption (e.g. the published annual Social Security COLA), used only when the target year has no published district base salary yet
function finSalaryComputeAll(colaPct) {
  return _finSalaryRoster.map(function(w) {
    var calc = finComputeLcmsSalary({ year: _finPlanTargetYear, role: w.role, trackKey: w.trackKey, yearsExperience: w.yearsExperience, responsibilityStipend: w.responsibilityStipend, attendanceBonus: w.attendanceBonus, colaPct: colaPct });
    var employerFicaCents = calc ? finComputeEmployerFicaCents(calc.salaryCents, w.selfEmployedFica) : 0;
    var hypotheticalFicaCents = calc ? finComputeEmployerFicaCents(calc.salaryCents, false) : 0;
    return { calc: calc, employerFicaCents: employerFicaCents, hypotheticalFicaCents: hypotheticalFicaCents };
  });
}
function finRenderSalaryCalculator(isAdminUI) {
  var computed = finSalaryComputeAll(_finSalaryColaPct);
  var rows = _finSalaryRoster.map(function(w, i) {
    var calc = computed[i].calc, ficaCents = computed[i].employerFicaCents, hypotheticalFicaCents = computed[i].hypotheticalFicaCents;
    var trackOptions = w.role === 'commissioned' ? LCMS_COMMISSIONED_TRACKS : w.role === 'other' ? LCMS_OTHER_WORKER_TRACKS : null;
    var trackSelect = trackOptions
      ? '<select onchange="finSalaryFieldChange(' + i + ',\'trackKey\',this.value)">' + Object.keys(trackOptions).map(function(k) { return '<option value="' + k + '"' + (k === w.trackKey ? ' selected' : '') + '>' + esc(trackOptions[k].label) + '</option>'; }).join('') + '</select>'
      : '<span style="color:var(--warm-gray);">—</span>';
    var stipendSelect = '<select onchange="finSalaryStipendChange(' + i + ',this.value)">' + LCMS_RESPONSIBILITY_STIPENDS.map(function(s) {
      var mid = (s.range[0] + s.range[1]) / 2;
      return '<option value="' + mid + '"' + (Math.abs(mid - w.responsibilityStipend) < 0.001 && s.key !== 'none' ? ' selected' : (s.key === 'none' && !w.responsibilityStipend ? ' selected' : '')) + '>' + esc(s.label) + (s.key !== 'none' ? ' (+' + (s.range[0]*100).toFixed(0) + '–' + (s.range[1]*100).toFixed(0) + '%)' : '') + '</option>';
    }).join('') + '</select>';
    var attendanceSelect = w.role === 'pastor'
      ? '<select onchange="finSalaryAttendanceChange(' + i + ',this.value)">' + LCMS_ATTENDANCE_BONUS_BANDS.map(function(b) {
          var mid = (b.range[0] + b.range[1]) / 2;
          return '<option value="' + mid + '"' + (Math.abs(mid - w.attendanceBonus) < 0.001 && b.key !== 'none' ? ' selected' : (b.key === 'none' && !w.attendanceBonus ? ' selected' : '')) + '>' + esc(b.label) + '</option>';
        }).join('') + '</select>'
      : '<span style="color:var(--warm-gray);">—</span>';
    var ficaCell = !calc ? '<span style="color:var(--warm-gray);">—</span>'
      : w.selfEmployedFica
        ? '<span style="color:var(--warm-gray);" title="Not a church cost — shown for reference only">$0 to church<br><span style="font-size:.68rem;">worker pays $' + finFmtMoney(hypotheticalFicaCents/100) + ' SECA themselves</span></span>'
        : '$' + finFmtMoney(ficaCents/100) + '<br><span style="font-size:.68rem;color:var(--sage);">compensation benefit</span>';
    return '<tr>'
      + '<td style="padding:3px 6px;"><input type="text" id="fin-salary-name-' + i + '" value="' + esc(w.name) + '" oninput="finSalaryFieldChange(' + i + ',\'name\',this.value)" style="width:120px;"></td>'
      + '<td style="padding:3px 6px;"><select onchange="finSalaryRoleChange(' + i + ',this.value)"><option value="pastor"' + (w.role==='pastor'?' selected':'') + '>Pastor</option><option value="commissioned"' + (w.role==='commissioned'?' selected':'') + '>Commissioned Worker</option><option value="other"' + (w.role==='other'?' selected':'') + '>Other Church Worker</option></select></td>'
      + '<td style="padding:3px 6px;"><input type="number" id="fin-salary-years-' + i + '" value="' + w.yearsExperience + '" oninput="finSalaryFieldChange(' + i + ',\'yearsExperience\',this.value)" style="width:60px;"></td>'
      + '<td style="padding:3px 6px;">' + trackSelect + '</td>'
      + '<td style="padding:3px 6px;">' + stipendSelect + '</td>'
      + '<td style="padding:3px 6px;">' + attendanceSelect + '</td>'
      + '<td style="padding:3px 6px;text-align:center;"><input type="checkbox" onchange="finSalaryFicaToggle(' + i + ',this.checked)"' + (w.selfEmployedFica ? ' checked' : '') + ' title="Self-employed for Social Security (SECA) — church pays no employer FICA for this worker"></td>'
      + '<td style="padding:3px 6px;text-align:right;">' + ficaCell + '</td>'
      + '<td style="padding:3px 6px;text-align:right;font-weight:600;">' + (calc ? '$' + finFmtMoney(calc.salaryCents/100) : '<span style="color:var(--warm-gray);">—</span>') + '</td>'
      + '<td style="padding:3px 6px;"><button class="btn-secondary" style="font-size:.7rem;padding:2px 6px;color:var(--danger);" onclick="finSalaryRemoveWorker(' + i + ')">Remove</button></td>'
      + '</tr>';
  }).join('');
  var totalSalaryCents = computed.reduce(function(sum, c) { return sum + (c.calc ? c.calc.salaryCents : 0); }, 0);
  var totalFicaCents = computed.reduce(function(sum, c) { return sum + c.employerFicaCents; }, 0);
  var totalWorkerPaidSecaCents = _finSalaryRoster.reduce(function(sum, w, i) { return sum + (w.selfEmployedFica ? computed[i].hypotheticalFicaCents : 0); }, 0);
  var baseInfo = finLcmsBaseSalaryCents(_finPlanTargetYear, _finSalaryColaPct);
  var expenseLeaves = [];
  (function walk(nodes) { (nodes || []).forEach(function(n) { if (!n.children.length && n.classification !== 'Income') expenseLeaves.push(n); walk(n.children); }); })(_finPlanBaseTree);
  var categoryOptions = expenseLeaves.map(function(n) {
    var guess = /salar|payroll|compensation|wages/i.test(n.label);
    return '<option value="' + esc(n.path) + '"' + (guess && !_finSalaryTargetCategory ? ' selected' : (n.path === _finSalaryTargetCategory ? ' selected' : '')) + '>' + esc(n.label) + '</option>';
  }).join('');
  // "Pull in last year" — the real FY base-year actual/budget totals across whichever accounts
  // look like salary/payroll accounts, shown as a reference figure (no per-worker breakdown
  // exists in the account data, so this can't prefill the roster itself — just inform it).
  var salaryAccounts = expenseLeaves.filter(function(n) { return /salar|payroll|compensation|wages/i.test(n.label); });
  var lastYearActualCents = salaryAccounts.reduce(function(sum, n) { return sum + (n.totalActualCents || 0); }, 0);
  var lastYearBudgetCents = salaryAccounts.reduce(function(sum, n) { return sum + (n.hasBudgetInfo ? (n.totalBudgetCents || 0) : 0); }, 0);
  var lastYearHtml = salaryAccounts.length
    ? '<div style="font-size:.75rem;color:var(--warm-gray);margin:0 0 8px;">FY' + _finPlanBaseYear + ' actual across matching accounts (' + salaryAccounts.map(function(n){return esc(n.label);}).join(', ') + '): <b style="color:var(--charcoal);">$' + finFmtMoney(lastYearActualCents/100) + '</b>' + (lastYearBudgetCents ? ' (budgeted $' + finFmtMoney(lastYearBudgetCents/100) + ')' : '') + ' — for comparison against this year\'s roster total below.</div>'
    : '';

  return '<div style="background:var(--linen);border-radius:8px;padding:12px 14px;margin-top:16px;">'
    + '<div style="font-weight:600;font-size:.85rem;margin-bottom:4px;">Salary &amp; Benefits Calculator <span style="font-weight:400;font-size:.72rem;color:var(--warm-gray);">(LCMS Missouri District Compensation Guidelines FY2026–2027)</span></div>'
    + lastYearHtml
    + '<p style="font-size:.75rem;color:var(--warm-gray);margin:0 0 8px;">Base salary for FY' + _finPlanTargetYear + ': $' + finFmtMoney(baseInfo.dollars) + (baseInfo.exact ? '' : (baseInfo.colaApplied ? ' <i>(no published base for ' + _finPlanTargetYear + ' yet — grown from ' + baseInfo.sourceYear + ' at the COLA % below)</i>' : ' <i>(no published base for ' + _finPlanTargetYear + " yet — using the district's most recent known year, " + baseInfo.sourceYear + ' flat; enter a COLA % below to grow it instead, or update LCMS_MO_BASE_SALARY_BY_YEAR once a new guideline document is out)</i>')) + '. Benefits (health/retirement via Concordia Plan Services) have no published formula in the district guidelines — CPS quotes those directly per congregation via their own tool — so Benefits below is a plain entered figure, not computed. Pastors and Commissioned Ministers are self-employed for Social Security by default (the church pays no employer FICA share for them — they pay their own SECA themselves, shown for reference); uncheck "Self-Employed (SECA)" for any worker actually treated as a regular employee at this church, where the church\'s ' + (LCMS_EMPLOYER_FICA_RATE*100).toFixed(2) + '% employer FICA payment shows as a compensation benefit that a self-employed worker doesn\'t get.</p>'
    + '<label style="font-size:.72rem;color:var(--warm-gray);display:block;margin-bottom:8px;">Social Security COLA % <span style="font-weight:400;">(used only for a year with no published base salary yet)</span><br><input type="number" id="fin-salary-cola" step="0.1" value="' + (_finSalaryColaPct ? (_finSalaryColaPct*100).toFixed(1) : '') + '" oninput="finSalaryColaChange(this.value)" style="width:90px;">%</label>'
    + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.78rem;">'
    + '<thead style="border-bottom:1px solid var(--border);"><tr><th style="text-align:left;padding:3px 6px;">Name</th><th style="text-align:left;padding:3px 6px;">Role</th><th style="text-align:left;padding:3px 6px;">Yrs Exp</th><th style="text-align:left;padding:3px 6px;">Education / Type</th><th style="text-align:left;padding:3px 6px;">Responsibility Stipend</th><th style="text-align:left;padding:3px 6px;">Attendance Bonus</th><th style="text-align:center;padding:3px 6px;">Self-Employed (SECA)</th><th style="text-align:right;padding:3px 6px;">Employer FICA</th><th style="text-align:right;padding:3px 6px;">Salary</th><th></th></tr></thead>'
    + '<tbody>' + (rows || '<tr><td colspan="10" style="padding:6px;color:var(--warm-gray);">No workers added yet.</td></tr>') + '</tbody>'
    + '<tfoot><tr style="font-weight:700;border-top:2px solid var(--navy);"><td colspan="6" style="padding:5px 6px;">Total</td><td></td><td style="text-align:right;padding:5px 6px;">$' + finFmtMoney(totalFicaCents/100) + '</td><td style="text-align:right;padding:5px 6px;">$' + finFmtMoney(totalSalaryCents/100) + '</td><td></td></tr></tfoot>'
    + '</table></div>'
    + (totalWorkerPaidSecaCents ? '<p style="font-size:.7rem;color:var(--warm-gray);margin:4px 0 0;">Total self-paid SECA across self-employed workers (not a church cost, shown for reference): $' + finFmtMoney(totalWorkerPaidSecaCents/100) + '</p>' : '')
    + (isAdminUI ? '<button class="btn-secondary" style="font-size:.75rem;padding:3px 10px;margin-top:8px;" onclick="finSalaryAddWorker()">+ Add Worker</button>' : '')
    + '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-top:10px;">'
    + '<label style="font-size:.72rem;color:var(--warm-gray);">Benefits Total ($/yr, entered)<br><input type="number" id="fin-salary-benefits" step="0.01" value="' + (_finSalaryBenefitsDollars || '') + '" oninput="finSalaryBenefitsChange(this.value)" style="width:120px;"></label>'
    + '<div class="rpt-stat"><div class="rpt-stat-num">$' + finFmtMoney((totalSalaryCents/100) + (totalFicaCents/100) + (_finSalaryBenefitsDollars || 0)) + '</div><div class="rpt-stat-lbl">Total Salary &amp; Benefits</div></div>'
    + '</div>'
    + (isAdminUI && expenseLeaves.length ? '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:10px;">'
      + '<label style="font-size:.72rem;color:var(--warm-gray);">Apply total to account<br><select id="fin-salary-target-category">' + categoryOptions + '</select></label>'
      + '<button class="btn-primary" style="font-size:.78rem;padding:5px 12px;" onclick="finSalaryApplyToPlan()">Use as FY' + _finPlanTargetYear + ' Projected</button>'
      + '</div>' : '')
    + '</div>';
}
function finSalaryAddWorker() {
  _finSalaryRoster.push({ name: '', role: 'pastor', trackKey: '', yearsExperience: 0, responsibilityStipend: 0, attendanceBonus: 0, selfEmployedFica: finDefaultSelfEmployedFica('pastor') });
  finRerenderPlanningPreserveFocus();
}
function finSalaryRemoveWorker(i) {
  _finSalaryRoster.splice(i, 1);
  finRerenderPlanningPreserveFocus();
}
function finSalaryFieldChange(i, field, value) {
  _finSalaryRoster[i][field] = field === 'yearsExperience' ? (parseFloat(value) || 0) : value;
  finRerenderPlanningPreserveFocus();
}
function finSalaryRoleChange(i, role) {
  _finSalaryRoster[i].role = role;
  _finSalaryRoster[i].trackKey = role === 'commissioned' ? 'ma' : role === 'other' ? 'secretary' : '';
  if (role !== 'pastor') _finSalaryRoster[i].attendanceBonus = 0;
  _finSalaryRoster[i].selfEmployedFica = finDefaultSelfEmployedFica(role);
  finRerenderPlanningPreserveFocus();
}
function finSalaryFicaToggle(i, checked) {
  _finSalaryRoster[i].selfEmployedFica = !!checked;
  finRerenderPlanningPreserveFocus();
}
function finSalaryStipendChange(i, value) {
  _finSalaryRoster[i].responsibilityStipend = parseFloat(value) || 0;
  finRerenderPlanningPreserveFocus();
}
function finSalaryAttendanceChange(i, value) {
  _finSalaryRoster[i].attendanceBonus = parseFloat(value) || 0;
  finRerenderPlanningPreserveFocus();
}
function finSalaryColaChange(value) {
  _finSalaryColaPct = (parseFloat(value) || 0) / 100;
  finRerenderPlanningPreserveFocus();
}
var _finSalaryBenefitsDollars = 0;
function finSalaryBenefitsChange(value) {
  _finSalaryBenefitsDollars = parseFloat(value) || 0;
  finRerenderPlanningPreserveFocus();
}
var _finSalaryTargetCategory = '';
function finSalaryApplyToPlan() {
  var sel = document.getElementById('fin-salary-target-category');
  if (!sel) return;
  _finSalaryTargetCategory = sel.value;
  var computed = finSalaryComputeAll(_finSalaryColaPct);
  var totalSalaryCents = computed.reduce(function(sum, c) { return sum + (c.calc ? c.calc.salaryCents : 0); }, 0);
  var totalFicaCents = computed.reduce(function(sum, c) { return sum + c.employerFicaCents; }, 0);
  var totalCents = totalSalaryCents + totalFicaCents + Math.round((_finSalaryBenefitsDollars || 0) * 100);
  _finPlanEdits[_finSalaryTargetCategory] = (totalCents / 100).toFixed(2);
  finToast('Applied $' + finFmtMoney(totalCents/100) + ' to the FY' + _finPlanTargetYear + ' Projected column — click Save Changes to keep it.');
  finRerenderPlanningPreserveFocus();
}

// ── Health Insurance Renewal Options (Concordia Plans quote #0560500326, effective 2027) ──────
// One congregation-wide group enrollment, not a per-worker figure like the salary roster above —
// Medical/Dental/Vision premiums for the church's actual Current plan, its Renewal (same plan
// design, new rates), and 3 alternate medical plan options Concordia offered alongside it. Dental
// and Vision are the same across Renewal/Option 1/2/3 (only Current has the old, lower Dental
// rate) — this is a real quirk of the source quote, not a data-entry simplification.
// deductibleFamilyCents/oopMaxFamilyCents/deductibleIndividualCents/oopMaxIndividualCents and
// embedded are all straight from the quote's plan-design table (page 1), used below to work out
// whether a richer plan's extra premium is actually worth it against real claims levels.
var HEALTH_PLAN_QUOTE_2027 = {
  effectiveYear: 2027,
  enrollmentContracts: 2, // 2 Family-tier employee contracts — every total below is for both combined
  coinsuranceRate: 0.20,  // "Coinsurance 20%" — the same for every option in this quote
  options: {
    current: { label: 'Current — Healthy Me HSA-C (BCBS)', medicalCents: 4529664, dentalCents: 289464, visionCents: 147168, embedded: true, deductibleFamilyCents: 700000, oopMaxFamilyCents: 1400000, deductibleIndividualCents: 350000, oopMaxIndividualCents: 700000 },
    renewal: { label: 'Renewal — Stay in Current Plan (Healthy Me HSA-C)', medicalCents: 4922400, dentalCents: 304680, visionCents: 147168, embedded: true, deductibleFamilyCents: 800000, oopMaxFamilyCents: 1600000, deductibleIndividualCents: 400000, oopMaxIndividualCents: 800000 },
    option1: { label: 'Option 1 — Healthy Me HSA-A (BCBS)', medicalCents: 5731560, dentalCents: 304680, visionCents: 147168, embedded: false, deductibleFamilyCents: 400000, oopMaxFamilyCents: 800000, deductibleIndividualCents: 200000, oopMaxIndividualCents: 400000 },
    option2: { label: 'Option 2 — Healthy Me HSA-B (BCBS)', medicalCents: 5252040, dentalCents: 304680, visionCents: 147168, embedded: false, deductibleFamilyCents: 600000, oopMaxFamilyCents: 850000, deductibleIndividualCents: 300000, oopMaxIndividualCents: 600000 },
    option3: { label: 'Option 3 — Healthy Me HSA-D (BCBS)', medicalCents: 4413264, dentalCents: 304680, visionCents: 147168, embedded: true, deductibleFamilyCents: 1100000, oopMaxFamilyCents: 1700000, deductibleIndividualCents: 550000, oopMaxIndividualCents: 850000 }
  }
};
// Pure — no DOM — returns the Medical/Dental/Vision breakdown + total annual employer cost in
// cents for one of the HEALTH_PLAN_QUOTE_2027 options, or null for an unrecognized key.
function finComputeHealthPlanTotalCents(optionKey) {
  var opt = HEALTH_PLAN_QUOTE_2027.options[optionKey];
  if (!opt) return null;
  var totalCents = opt.medicalCents + opt.dentalCents + opt.visionCents;
  return { label: opt.label, medicalCents: opt.medicalCents, dentalCents: opt.dentalCents, visionCents: opt.visionCents, totalCents: totalCents };
}
// Pure — no DOM — a plan's own out-of-pocket cost for a given total billed amount, under a plain
// deductible-then-coinsurance-up-to-an-OOP-max design (every option in this quote works this way).
function finComputePlanOOPCents(deductibleCents, oopMaxCents, coinsuranceRate, spendCents) {
  if (spendCents <= deductibleCents) return spendCents;
  var coinsuranceCapCents = oopMaxCents - deductibleCents;
  var oopFromCoinsurance = Math.min((spendCents - deductibleCents) * coinsuranceRate, coinsuranceCapCents);
  return deductibleCents + oopFromCoinsurance;
}
// Pure — no DOM — the extra (or reduced) out-of-pocket cost of being on toKey instead of fromKey
// for ONE family, assuming the whole family's medical costs (spendCents) are concentrated in a
// single member (not spread across 2+ people) — the case a non-embedded plan's aggregate
// deductible/OOP-max hits hardest, since one person alone has to clear the same (family-size)
// threshold that an embedded plan would have capped at a smaller individual number. Positive =
// toKey costs the family more at that spend level; this is the worst-case comparison, not the
// typical one — see finComputeHealthPlanFamilyBreakevenCents for the multi-member case.
function finComputeHealthPlanSingleClaimantDeltaCents(fromKey, toKey, spendCents) {
  var fromTerms = finHealthPlanEffectiveLoneClaimantTermsCents(fromKey), toTerms = finHealthPlanEffectiveLoneClaimantTermsCents(toKey);
  if (!fromTerms || !toTerms) return null;
  var rate = HEALTH_PLAN_QUOTE_2027.coinsuranceRate;
  return finComputePlanOOPCents(toTerms.deductibleCents, toTerms.oopMaxCents, rate, spendCents) - finComputePlanOOPCents(fromTerms.deductibleCents, fromTerms.oopMaxCents, rate, spendCents);
}
// Pure — no DOM — the deductible/OOP-max that actually applies to ONE family member who alone
// accounts for all of a family contract's costs: the plan's own individual figures if it's
// embedded (each person protected separately), or its family figures if not (no individual
// sub-limit — a lone claimant has to clear the same aggregate threshold as the whole family).
function finHealthPlanEffectiveLoneClaimantTermsCents(optionKey) {
  var opt = HEALTH_PLAN_QUOTE_2027.options[optionKey];
  if (!opt) return null;
  return opt.embedded
    ? { deductibleCents: opt.deductibleIndividualCents, oopMaxCents: opt.oopMaxIndividualCents }
    : { deductibleCents: opt.deductibleFamilyCents, oopMaxCents: opt.oopMaxFamilyCents };
}
// Pure — no DOM — the total family-wide annual medical spend (in cents, assumed spread across 2+
// family members so the FAMILY deductible/OOP-max apply, not a single person's) at which moving
// from fromKey to toKey starts saving more in reduced out-of-pocket costs than the extra premium
// costs (perHouseholdPremiumDiffCents, positive = toKey costs more per household per year). Returns
// null if the plan never breaks even even at a very high spend level (e.g. toKey's premium is
// higher with no compensating deductible/OOP-max improvement at all).
function finComputeHealthPlanFamilyBreakevenCents(fromKey, toKey, perHouseholdPremiumDiffCents) {
  var from = HEALTH_PLAN_QUOTE_2027.options[fromKey], to = HEALTH_PLAN_QUOTE_2027.options[toKey];
  if (!from || !to) return null;
  var rate = HEALTH_PLAN_QUOTE_2027.coinsuranceRate;
  function savings(spendCents) {
    return finComputePlanOOPCents(from.deductibleFamilyCents, from.oopMaxFamilyCents, rate, spendCents)
         - finComputePlanOOPCents(to.deductibleFamilyCents, to.oopMaxFamilyCents, rate, spendCents);
  }
  var maxSpendCents = Math.max(from.oopMaxFamilyCents, to.oopMaxFamilyCents) * 4;
  if (savings(maxSpendCents) < perHouseholdPremiumDiffCents) return null;
  var lo = 0, hi = maxSpendCents;
  for (var i = 0; i < 60; i++) {
    var mid = (lo + hi) / 2;
    if (savings(mid) >= perHouseholdPremiumDiffCents) hi = mid; else lo = mid;
  }
  return Math.round(hi);
}

var _finHealthPlanSelectedOption = 'renewal'; // Stay on Current/Renewal (Healthy Me HSA-C) — per the 2026-07-21 cost/benefit review, Option B's protection mostly targets high-utilization years neither current employee's household has historically approached (neither has hit the $8,000 individual OOP max under the current plan), so the guaranteed $3,296.40/yr premium increase isn't clearly worth it; revisit if a near-term high-cost event is anticipated
var _finHealthPlanTargetCategory = '';
function finRenderHealthInsuranceCalculator(isAdminUI) {
  var calc = finComputeHealthPlanTotalCents(_finHealthPlanSelectedOption);
  var optionSelect = '<select onchange="finHealthPlanOptionChange(this.value)">' + Object.keys(HEALTH_PLAN_QUOTE_2027.options).map(function(k) {
    return '<option value="' + k + '"' + (k === _finHealthPlanSelectedOption ? ' selected' : '') + '>' + esc(HEALTH_PLAN_QUOTE_2027.options[k].label) + '</option>';
  }).join('') + '</select>';

  var breakdownHtml = calc ? ('<table style="width:100%;border-collapse:collapse;font-size:.78rem;max-width:420px;">'
    + '<tr><td style="padding:3px 6px;">Medical Annual Premium</td><td style="text-align:right;padding:3px 6px;">$' + finFmtMoney(calc.medicalCents/100) + '</td></tr>'
    + '<tr><td style="padding:3px 6px;">Dental Annual Premium</td><td style="text-align:right;padding:3px 6px;">$' + finFmtMoney(calc.dentalCents/100) + '</td></tr>'
    + '<tr><td style="padding:3px 6px;">Vision Annual Premium</td><td style="text-align:right;padding:3px 6px;">$' + finFmtMoney(calc.visionCents/100) + '</td></tr>'
    + '<tr style="font-weight:700;border-top:2px solid var(--navy);"><td style="padding:5px 6px;">Total Annual Premium</td><td style="text-align:right;padding:5px 6px;">$' + finFmtMoney(calc.totalCents/100) + '</td></tr>'
    + '</table>') : '<p style="font-size:.8rem;color:var(--warm-gray);">Unknown option.</p>';

  // "Is it worth it?" — compared against Renewal (staying in the current plan design) since
  // that's the do-nothing baseline. Two symmetric cases: a costlier option (does the lower
  // deductible/OOP-max pay for the extra premium?) and a cheaper option (does the premium
  // savings outweigh the worse deductible/OOP-max if a claim actually happens?).
  var breakevenHtml = '';
  if (calc && _finHealthPlanSelectedOption !== 'renewal') {
    var baseline = finComputeHealthPlanTotalCents('renewal');
    var perHouseholdDiffCents = Math.round((calc.totalCents - baseline.totalCents) / HEALTH_PLAN_QUOTE_2027.enrollmentContracts);
    var singleClaimantWorstCaseCents = finComputeHealthPlanSingleClaimantDeltaCents('renewal', _finHealthPlanSelectedOption, 100000000);
    var renewalOpt = HEALTH_PLAN_QUOTE_2027.options.renewal, selOpt = HEALTH_PLAN_QUOTE_2027.options[_finHealthPlanSelectedOption];
    var rate = HEALTH_PLAN_QUOTE_2027.coinsuranceRate;
    var familyWorstCaseCents = finComputePlanOOPCents(selOpt.deductibleFamilyCents, selOpt.oopMaxFamilyCents, rate, 100000000)
                              - finComputePlanOOPCents(renewalOpt.deductibleFamilyCents, renewalOpt.oopMaxFamilyCents, rate, 100000000);
    var renewalLoneTerms = finHealthPlanEffectiveLoneClaimantTermsCents('renewal'), selLoneTerms = finHealthPlanEffectiveLoneClaimantTermsCents(_finHealthPlanSelectedOption);
    var renewalLoneWorstCents = renewalLoneTerms.oopMaxCents, selLoneWorstCents = selLoneTerms.oopMaxCents;
    var renewalFamilyWorstCents = renewalOpt.oopMaxFamilyCents, selFamilyWorstCents = selOpt.oopMaxFamilyCents;
    function actualSpendRow(label, renewalCents, selCents) {
      return '<tr><td style="padding:2px 6px;">' + label + '</td><td style="text-align:right;padding:2px 6px;">$' + finFmtMoney(renewalCents/100) + '</td><td style="text-align:right;padding:2px 6px;">$' + finFmtMoney(selCents/100) + '</td></tr>';
    }
    if (perHouseholdDiffCents > 0) {
      var breakevenCents = finComputeHealthPlanFamilyBreakevenCents('renewal', _finHealthPlanSelectedOption, perHouseholdDiffCents);
      var actualSpendTableRows = '';
      if (breakevenCents != null) {
        var oopAtBreakevenRenewal = finComputePlanOOPCents(renewalOpt.deductibleFamilyCents, renewalOpt.oopMaxFamilyCents, rate, breakevenCents);
        var oopAtBreakevenSelected = finComputePlanOOPCents(selOpt.deductibleFamilyCents, selOpt.oopMaxFamilyCents, rate, breakevenCents);
        actualSpendTableRows += actualSpendRow('At the breakeven ($' + finFmtMoney(breakevenCents/100) + ' total cost of care, spread across the family)', oopAtBreakevenRenewal, oopAtBreakevenSelected);
      }
      actualSpendTableRows += actualSpendRow('Worst case, costs spread across the family', renewalFamilyWorstCents, selFamilyWorstCents);
      actualSpendTableRows += actualSpendRow('Worst case, one family member alone', renewalLoneWorstCents, selLoneWorstCents);
      var actualSpendTable = '<table style="width:100%;border-collapse:collapse;font-size:.72rem;margin-top:8px;max-width:480px;">'
        + '<thead><tr><th style="text-align:left;padding:2px 6px;">What the family would actually pay</th><th style="text-align:right;padding:2px 6px;">Renewal</th><th style="text-align:right;padding:2px 6px;">' + esc(selOpt.label) + '</th></tr></thead>'
        + '<tbody>' + actualSpendTableRows + '</tbody></table>';
      breakevenHtml = '<div style="margin-top:10px;padding:8px 10px;background:var(--white);border-radius:6px;font-size:.75rem;color:var(--warm-gray);">'
        + '<b style="color:var(--charcoal);">Is it worth it?</b> This option costs $' + finFmtMoney(perHouseholdDiffCents/100) + '/yr more per household than staying on Renewal. '
        + (breakevenCents != null
          ? 'If a household\'s medical costs are spread across 2+ family members, the extra premium pays for itself once that household\'s <i>total cost of care for the year</i> (what providers bill in total — not what the family pays out of pocket, which stays capped well below this) reaches about <b>$' + finFmtMoney(breakevenCents/100) + '</b> — below that, the extra premium is a net cost; above it, the lower deductible/out-of-pocket max saves more than the premium costs.'
          : 'It never fully pays for itself in reduced out-of-pocket costs at any level of care, even spread across the whole family.')
        + (singleClaimantWorstCaseCents != null ? ' If one family member alone accounts for all the costs (not spread across the family), this option ' + (singleClaimantWorstCaseCents > 0 ? 'never breaks even — it costs up to $' + finFmtMoney(singleClaimantWorstCaseCents/100) + ' more even in a worst-case year' : (singleClaimantWorstCaseCents < 0 ? 'still comes out ahead by up to $' + finFmtMoney(Math.abs(singleClaimantWorstCaseCents)/100) + ' in a worst-case year' : 'comes out exactly even in a worst-case year')) + ', since a lone claimant is held to the same family-size threshold a non-embedded plan uses instead of a smaller individual cap.' : '')
        + actualSpendTable
        + '</div>';
    } else if (perHouseholdDiffCents < 0) {
      var cheaperSpendTable = '<table style="width:100%;border-collapse:collapse;font-size:.72rem;margin-top:8px;max-width:480px;">'
        + '<thead><tr><th style="text-align:left;padding:2px 6px;">What the family would actually pay</th><th style="text-align:right;padding:2px 6px;">Renewal</th><th style="text-align:right;padding:2px 6px;">' + esc(selOpt.label) + '</th></tr></thead>'
        + '<tbody>' + actualSpendRow('Worst case, costs spread across the family', renewalFamilyWorstCents, selFamilyWorstCents) + actualSpendRow('Worst case, one family member alone', renewalLoneWorstCents, selLoneWorstCents) + '</tbody></table>';
      breakevenHtml = '<div style="margin-top:10px;padding:8px 10px;background:var(--white);border-radius:6px;font-size:.75rem;color:var(--warm-gray);">'
        + '<b style="color:var(--charcoal);">Is it worth it?</b> This option saves $' + finFmtMoney(Math.abs(perHouseholdDiffCents)/100) + '/yr per household in premium compared to staying on Renewal — guaranteed, whether or not anyone has a claim. '
        + 'The tradeoff is a higher deductible/out-of-pocket max: in a worst-case year with costs spread across the family, this option could cost up to <b>$' + finFmtMoney(Math.abs(familyWorstCaseCents)/100) + (familyWorstCaseCents > 0 ? ' more' : ' less') + '</b> out-of-pocket than Renewal'
        + (Math.abs(familyWorstCaseCents) < Math.abs(perHouseholdDiffCents)
          ? ', which is smaller than the guaranteed premium savings — so even in the worst realistic year, this option comes out ahead overall.'
          : ', which is larger than the guaranteed premium savings — so a genuinely bad year could cost more overall than staying on Renewal.')
        + cheaperSpendTable
        + '</div>';
    }
  }

  var expenseLeaves = [];
  (function walk(nodes) { (nodes || []).forEach(function(n) { if (!n.children.length && n.classification !== 'Income') expenseLeaves.push(n); walk(n.children); }); })(_finPlanBaseTree);
  var categoryOptions = expenseLeaves.map(function(n) {
    var guess = /health|insurance|medical|benefit/i.test(n.label);
    return '<option value="' + esc(n.path) + '"' + (guess && !_finHealthPlanTargetCategory ? ' selected' : (n.path === _finHealthPlanTargetCategory ? ' selected' : '')) + '>' + esc(n.label) + '</option>';
  }).join('');

  return '<div style="background:var(--linen);border-radius:8px;padding:12px 14px;margin-top:16px;">'
    + '<div style="font-weight:600;font-size:.85rem;margin-bottom:4px;">Health Insurance Renewal Options <span style="font-weight:400;font-size:.72rem;color:var(--warm-gray);">(Concordia Plans quote #0560500326, effective ' + HEALTH_PLAN_QUOTE_2027.effectiveYear + ')</span></div>'
    + '<p style="font-size:.75rem;color:var(--warm-gray);margin:0 0 8px;">One group premium for the whole congregation, not a per-worker figure — Medical varies by plan option; Dental and Vision are the same across Renewal/Option 1/2/3 (only the old Current plan has a lower Dental rate).</p>'
    + '<label style="font-size:.72rem;color:var(--warm-gray);display:block;margin-bottom:8px;">Plan Option<br>' + optionSelect + '</label>'
    + breakdownHtml
    + breakevenHtml
    + (isAdminUI && expenseLeaves.length ? '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:10px;">'
      + '<label style="font-size:.72rem;color:var(--warm-gray);">Apply total to account<br><select id="fin-healthplan-target-category">' + categoryOptions + '</select></label>'
      + '<button class="btn-primary" style="font-size:.78rem;padding:5px 12px;" onclick="finHealthPlanApplyToPlan()">Use as FY' + _finPlanTargetYear + ' Projected</button>'
      + '</div>' : '')
    + '</div>';
}
function finHealthPlanOptionChange(value) {
  _finHealthPlanSelectedOption = value;
  finRerenderPlanningPreserveFocus();
}
function finHealthPlanApplyToPlan() {
  var sel = document.getElementById('fin-healthplan-target-category');
  if (!sel) return;
  _finHealthPlanTargetCategory = sel.value;
  var calc = finComputeHealthPlanTotalCents(_finHealthPlanSelectedOption);
  if (!calc) return;
  _finPlanEdits[_finHealthPlanTargetCategory] = (calc.totalCents / 100).toFixed(2);
  finToast('Applied $' + finFmtMoney(calc.totalCents/100) + ' to the FY' + _finPlanTargetYear + ' Projected column — click Save Changes to keep it.');
  finRerenderPlanningPreserveFocus();
}

// ── 3277 Ivanhoe Multi-Year Forecast (kept separate from Church Budget Planning — the property
// has no "budget" concept to commit into, just actuals reported by AHRA; this is read-only and
// entirely client-side, extending the single-year forecast already on the Commercial Property
// tab into an adjustable growth-rate projection over several years). ──────────────────────────
function finRenderPropertyMultiYearForecast() {
  var el = document.getElementById('fin-plan-property-root');
  if (!el) return;
  if (!_finProperty) { el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">Loading…</p>'; return; }
  var loan = (_finProperty.meta && _finProperty.meta.loan) || {};
  var monthly = (_finProperty.monthly || []).slice().sort(function(a,b){ return a.period < b.period ? -1 : 1; }).slice(-12);
  var withNet = monthly.filter(function(m) { return m.net_income_cents != null || m.net_operating_income_cents != null; });
  var avgAnnualCents = withNet.length
    ? (withNet.reduce(function(sum, m) { return sum + (m.net_income_cents != null ? m.net_income_cents : m.net_operating_income_cents); }, 0) / withNet.length) * 12
    : 0;
  var amort = finComputeMortgageAmortization(loan);
  var payoffYear = amort ? amort.payoffDate.getFullYear() : null;

  var inputsHtml = '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px;">'
    + '<label style="font-size:.75rem;color:var(--warm-gray);">Annual Growth Assumption %<br><input type="number" id="fin-pmf-growth" step="0.1" value="2" oninput="finRenderPropertyMultiYearTable()" style="width:100px;"></label>'
    + '<label style="font-size:.75rem;color:var(--warm-gray);">Years to Project<br><input type="number" id="fin-pmf-years" value="10" min="1" max="30" oninput="finRenderPropertyMultiYearTable()" style="width:90px;"></label>'
    + '</div>'
    + '<p style="font-size:.72rem;color:var(--warm-gray);margin:0 0 10px;">Starts from the trailing-12-month average annual net income ($' + finFmtMoney(avgAnnualCents/100) + ') and compounds the growth assumption above. ' + (payoffYear ? 'The mortgage is projected to pay off around ' + payoffYear + ' — years from then on add back the current annual debt service ($' + finFmtMoney((loan.annual_debt_service_cents||0)/100) + '), on the same assumption noted in the Commercial Property tab.' : 'No mortgage payoff projection is available, so debt service is not added back in any year.') + '</p>'
    + '<div id="fin-pmf-table"></div>';
  el.innerHTML = inputsHtml;
  window._finPmfAvgAnnualCents = avgAnnualCents;
  window._finPmfPayoffYear = payoffYear;
  window._finPmfAnnualDebtServiceCents = loan.annual_debt_service_cents || 0;
  finRenderPropertyMultiYearTable();
}
function finRenderPropertyMultiYearTable() {
  var tableEl = document.getElementById('fin-pmf-table');
  if (!tableEl) return;
  var growthPct = (parseFloat(document.getElementById('fin-pmf-growth').value) || 0) / 100;
  var numYears = parseInt(document.getElementById('fin-pmf-years').value, 10) || 10;
  var avgAnnualCents = window._finPmfAvgAnnualCents || 0;
  var payoffYear = window._finPmfPayoffYear;
  var debtServiceCents = window._finPmfAnnualDebtServiceCents || 0;
  var startYear = new Date().getFullYear() + 1;
  var rows = '';
  for (var i = 0; i < numYears; i++) {
    var year = startYear + i;
    var projectedCents = Math.round(avgAnnualCents * Math.pow(1 + growthPct, i + 1));
    var afterPayoff = payoffYear && year >= payoffYear;
    var totalCents = projectedCents + (afterPayoff ? debtServiceCents : 0);
    rows += '<tr' + (afterPayoff ? ' style="background:var(--linen);"' : '') + '><td style="padding:4px 8px;">' + year + (afterPayoff ? ' <span style="font-size:.68rem;color:var(--warm-gray);">(post-payoff)</span>' : '') + '</td><td style="padding:4px 8px;text-align:right;">$' + finFmtMoney(totalCents/100) + '</td></tr>';
  }
  tableEl.innerHTML = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr><th style="text-align:left;padding:4px 8px;">Year</th><th style="text-align:right;padding:4px 8px;">Projected Annual Net Income</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div>';
}
`;
