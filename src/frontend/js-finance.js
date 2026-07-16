export const JS_FINANCE = String.raw`// ── FINANCE OVERVIEW ─────────────────────────────────────────────────
// Unifies QuickBooks Online (Budget vs Actual + account balances, live OAuth sync) and
// daycare financials (manual entries — no known daycare-app API/export yet) in one tab.
var _finStatus = {};
var _finDaycare = [];

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
    loadingEl.style.display = 'none';
    rootEl.style.display = '';
    finRenderConnection();
    finRenderBudget(overview);
    finRenderAccounts(overview);
    finRenderDaycare();
  }).catch(function(err) {
    if (err && err.message === 'Unauthorized') return;
    loadingEl.textContent = 'Could not load finance data.';
  });
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
  el.innerHTML =
    '<div style="font-size:.72rem;color:var(--warm-gray);margin-bottom:8px;">Synced ' + esc(overview.budgetSyncedAt ? finFmtTs(overview.budgetSyncedAt) : 'never') + '</div>'
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
  var el = document.getElementById('fin-daycare-body');
  if (!_finDaycare.length) {
    el.innerHTML = '<tr><td colspan="6" style="padding:10px;color:var(--warm-gray);font-size:.82rem;">No entries yet. Add one below, or sync the daycare app above.</td></tr>';
    return;
  }
  el.innerHTML = _finDaycare.map(function(e) {
    return '<tr>'
      + '<td style="padding:5px 8px;">' + esc(e.period) + '</td>'
      + '<td style="padding:5px 8px;">' + esc(e.category) + '</td>'
      + '<td style="padding:5px 8px;">' + (e.entry_type === 'budget' ? 'Budget' : 'Actual') + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">$' + finFmtMoney(e.amount_cents / 100) + '</td>'
      + '<td style="padding:5px 8px;color:var(--warm-gray);font-size:.78rem;">' + (e.source === 'daycare_api' ? 'Daycare App' : esc(e.notes || '')) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + (e.source === 'daycare_api' ? '' : '<button class="btn-secondary" style="font-size:.72rem;padding:3px 8px;" onclick="finDeleteDaycare(' + e.id + ')">Delete</button>') + '</td>'
      + '</tr>';
  }).join('');
}
function finAddDaycare() {
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
  api('/admin/api/finance/daycare', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ period: period, category: category, entry_type: type, amount_cents: Math.round(amount * 100), notes: notes })
  }).then(function(d) {
    if (d && d.error) { errEl.textContent = d.error; return; }
    document.getElementById('fin-dc-period').value = '';
    document.getElementById('fin-dc-category').value = '';
    document.getElementById('fin-dc-amount').value = '';
    document.getElementById('fin-dc-notes').value = '';
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
`;
