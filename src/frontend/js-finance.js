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

// ── Sub-nav: Overview / Church Report / Daycare Report ────────────────
function finShowSection(section, btn) {
  ['overview', 'church', 'daycare'].forEach(function(s) {
    var panel = document.getElementById('fin-panel-' + s);
    if (panel) panel.style.display = (s === section) ? '' : 'none';
  });
  document.querySelectorAll('#fin-subnav .vol-subtab-btn').forEach(function(b) {
    b.classList.toggle('active', b === btn);
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

// ── Church Report (board-level, year by year) ──────────────────────────
// QuickBooks' own Profit & Loss report (summarize_column_by=Year, synced in
// finance/qb/sync) rendered with the same generic Columns/Rows tree-walker as
// Budget vs Actual, plus a few reference-only lines pulled from the daycare
// aggregation above (income total, wages, total expenses) so the board sees
// the MDO daycare's contribution alongside the church's own QuickBooks figures
// without those numbers being merged into QuickBooks' own totals.
function finRenderChurchReport() {
  var el = document.getElementById('fin-church-report');
  if (!el) return;
  var report = _finOverview.profitAndLoss;
  var agg = finAggregateDaycareByYear(_finDaycare);
  if (!report || !report.Rows) {
    el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">No church report data yet. Connect QuickBooks in the Overview tab and click "Sync Now".</p>';
    return;
  }
  var cols = (report.Columns && report.Columns.Column) || [];
  var theadCells = cols.map(function(c, i) {
    return '<th style="text-align:' + (i === 0 ? 'left' : 'right') + ';padding:6px 8px;">' + esc(c.ColTitle || '') + '</th>';
  }).join('');
  var rowsHtml = finRenderReportRows((report.Rows && report.Rows.Row) || [], 0);
  var html =
    '<div style="font-size:.72rem;color:var(--warm-gray);margin-bottom:8px;">Synced ' + esc(_finOverview.profitAndLossSyncedAt ? finFmtTs(_finOverview.profitAndLossSyncedAt) : 'never') + '</div>'
    + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr>' + theadCells + '</tr></thead>'
    + '<tbody>' + rowsHtml + '</tbody></table></div>';

  if (agg.years.length) {
    // Match each QBO column to a calendar year by pulling the 4-digit year out of its
    // title (e.g. "Jan - Dec 2025"); columns with no year in the title (e.g. a "Total"
    // column) get a blank daycare cell rather than a guess.
    var colYears = cols.map(function(c) { var m = /(\d{4})/.exec(c.ColTitle || ''); return m ? m[1] : null; });
    function tieRow(label, getter) {
      var cells = cols.map(function(c, i) {
        if (i === 0) return '';
        var y = colYears[i];
        var v = y ? getter(y) : null;
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
// Flattens QBO's Columns/Rows report tree into CSV rows, indenting nested labels with
// leading dashes so the hierarchy survives in plain text.
function finReportTreeToCsvRows(rows, depth) {
  var out = [];
  (rows || []).forEach(function(row) {
    if (row.type === 'Section') {
      var headerCells = (row.Header && row.Header.ColData) || [];
      if (headerCells.length) out.push(finReportRowToCsvCells(headerCells, depth));
      if (row.Rows && row.Rows.Row) out = out.concat(finReportTreeToCsvRows(row.Rows.Row, depth + 1));
      var summaryCells = (row.Summary && row.Summary.ColData) || [];
      if (summaryCells.length) out.push(finReportRowToCsvCells(summaryCells, depth));
    } else {
      var cells = row.ColData || [];
      if (cells.length) out.push(finReportRowToCsvCells(cells, depth));
    }
  });
  return out;
}
function finReportRowToCsvCells(cells, depth) {
  return cells.map(function(c, i) {
    return i === 0 ? (new Array(depth + 1).join('- ') + (c.value || '')) : (c.value || '');
  });
}
function finExportChurchCsv() {
  var report = _finOverview.profitAndLoss;
  if (!report || !report.Rows) { finToast('No church report data to export.'); return; }
  var cols = (report.Columns && report.Columns.Column) || [];
  var header = cols.map(function(c) { return c.ColTitle || ''; });
  var rows = [header].concat(finReportTreeToCsvRows((report.Rows && report.Rows.Row) || [], 0));
  var agg = finAggregateDaycareByYear(_finDaycare);
  if (agg.years.length) {
    var colYears = cols.map(function(c) { var m = /(\d{4})/.exec(c.ColTitle || ''); return m ? m[1] : null; });
    function tieRowCsv(label, getter) {
      return [label].concat(cols.slice(1).map(function(c, i) {
        var y = colYears[i + 1];
        var v = y ? getter(y) : null;
        return v == null ? '' : v.toFixed(2);
      }));
    }
    rows.push([]);
    rows.push(['Daycare (MDO) — for reference, not part of QuickBooks totals above']);
    rows.push(tieRowCsv('Daycare Tuition Income', function(y) { return agg.byYear[y] ? agg.byYear[y].incomeActual : null; }));
    rows.push(tieRowCsv('Daycare Payroll (Wages)', function(y) { var b = agg.byYear[y]; return (b && b.categories['Payroll']) ? b.categories['Payroll'].actual : null; }));
    rows.push(tieRowCsv('Daycare Total Expenses', function(y) { return agg.byYear[y] ? agg.byYear[y].expenseActual : null; }));
  }
  finDownloadCsv('church-report.csv', rows);
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
