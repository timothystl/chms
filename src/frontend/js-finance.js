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
  }).catch(function(err) {
    if (err && err.message === 'Unauthorized') return;
    loadingEl.textContent = 'Could not load finance data.';
  });
}

// ── Sub-nav: Overview / Church Report / Daycare Report / Giving Reports ───────────────
// Button active-state is handled by the shared renderFinanceSubnav() (js-core.js) re-render,
// driven by showTab()'s _finActiveNavId — this only toggles panel visibility.
function finShowSection(section) {
  ['overview', 'church', 'daycare', 'givingreports'].forEach(function(s) {
    var panel = document.getElementById('fin-panel-' + s);
    if (panel) panel.style.display = (s === section) ? '' : 'none';
  });
  if (section === 'givingreports') finInitGivingReports();
}
// Lazy-init for the giving-report tiles relocated here from the Reports tab (nav consolidation)
// — mirrors initReportTrendYears()'s own idempotent guard, safe to call every time this section
// is shown. initReportTrendYears() is defined in js-reports.js (loaded earlier in the module
// concatenation order) and already no-ops harmlessly if its target element isn't found.
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

function finSetChurchReportMode(mode) {
  _finChurchMode = mode;
  var yearEl = document.getElementById('fin-church-year-view');
  var multiEl = document.getElementById('fin-church-multiyear-view');
  if (yearEl) yearEl.style.display = mode === 'year' ? '' : 'none';
  if (multiEl) multiEl.style.display = mode === 'multiyear' ? '' : 'none';
  var yearBtn = document.getElementById('fin-church-mode-year');
  var multiBtn = document.getElementById('fin-church-mode-multiyear');
  if (yearBtn) yearBtn.classList.toggle('active', mode === 'year');
  if (multiBtn) multiBtn.classList.toggle('active', mode === 'multiyear');
  if (mode === 'year' && !_finChurchThisYearData) finLoadChurchThisYear();
  if (mode === 'multiyear' && !_finChurchMultiYearData) finLoadChurchMultiYear();
}

// Called from loadFinance() on every tab load AND after every "Sync Now" — always invalidates
// the cached church-report data first so a fresh sync's results actually show up, rather than
// the stale data finSetChurchReportMode's cache-guard would otherwise keep serving (that guard
// exists only to avoid a redundant re-fetch when the user merely clicks the This Year/Multi-Year
// toggle back and forth, which calls finSetChurchReportMode directly, not through here).
function finRenderChurchReport() {
  _finChurchThisYearData = null;
  _finChurchMultiYearData = null;
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
    groups: [{ key: 'income', label: 'Income' }, { key: 'expenses', label: 'Expenses' }, { key: 'net', label: 'Net Income' }],
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
      var gLbl = g === 'income' ? 'Income' : g === 'expenses' ? 'Expenses' : 'Net Income';
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
    + finRenderYoyRow('Income', yoy.income)
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
    + finChurchSummaryCard('Total Income', income, d.hasBudgetData)
    + finChurchSummaryCard('Total Expenses', expenses, d.hasBudgetData)
    + finChurchSummaryCard('Net Income', d.netIncome, d.hasBudgetData)
    + '</div>'
    + '<div style="font-size:.82rem;color:var(--warm-gray);background:var(--linen);border-radius:8px;padding:10px 14px;margin-bottom:18px;">'
    + '<b>Giving (ChMS records):</b> $' + finFmtMoney(d.givingCents / 100)
    + ' <span style="font-size:.75rem;">— shown for reference only. QuickBooks’ Income figure above reflects what has cleared the bank and been fully recorded, so timing differences from ChMS’s own recorded giving are expected, not a discrepancy to chase.</span>'
    + (d.givingByFund && d.givingByFund.length ? '<table style="width:100%;border-collapse:collapse;font-size:.78rem;margin-top:8px;">'
        + d.givingByFund.map(function(f) {
            return '<tr><td style="padding:2px 8px 2px 0;">' + esc(f.fundName) + '</td><td style="padding:2px 0;text-align:right;">$' + finFmtMoney(f.cents / 100) + '</td></tr>';
          }).join('')
        + '</table>' : '')
    + '</div>'
    + finRenderYoyBlock(d.yoy);

  var tree = finBuildTreeFromFlatRows(d.entries);
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
  var rowsDef = [{ label: 'Total Income', key: 'Income' }, { label: 'Cost of Goods Sold', key: 'Cost of Goods Sold' }, { label: 'Total Expenses', key: 'Expenses' }];
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
      { key: 'income', label: 'Income', color: '#2E7EA6' },
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
function finExportChurchCsv() {
  var rows = [];
  if (_finChurchMode === 'year' && _finChurchThisYearData) {
    var d = _finChurchThisYearData;
    rows.push(['Account', 'Actual', 'Budget']);
    finBuildTreeFromFlatRows(d.entries).forEach(function pushNode(node) {
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
    [['Total Income', 'Income'], ['Cost of Goods Sold', 'Cost of Goods Sold'], ['Total Expenses', 'Expenses']].forEach(function(rd) {
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
`;
