export const JS_GIVING = String.raw`<script>
// ── GIVING ────────────────────────────────────────────────────────────
// ── Batches / Transactions view toggle (RDS4) ──────────────────────────
var _givView = 'batches';
function givSetView(view) {
  _givView = view;
  document.getElementById('giv-view-batches-btn').classList.toggle('active', view === 'batches');
  document.getElementById('giv-view-txns-btn').classList.toggle('active', view === 'transactions');
  document.getElementById('giv-view-reports-btn').classList.toggle('active', view === 'reports');
  document.getElementById('giv-view-batches').style.display = view === 'batches' ? 'grid' : 'none';
  document.getElementById('giv-view-transactions').style.display = view === 'transactions' ? 'flex' : 'none';
  document.getElementById('giv-view-reports').style.display = view === 'reports' ? '' : 'none';
  if (view === 'transactions') {
    givTxnPopulateFundOptions();
    loadGivingTransactions();
  }
  if (view === 'reports') finInitGivingReports();
}
function givTxnPopulateFundOptions() {
  var sel = document.getElementById('giv-txn-fund');
  if (!sel || sel.options.length > 1) return; // already populated
  allFunds.forEach(function(f) { sel.appendChild(new Option(f.name, f.id)); });
}
function loadGivingStats() {
  var el = document.getElementById('giv-stats');
  if (!el) return;
  api('/admin/api/giving/stats').then(function(d) {
    if (d.error) return;
    el.innerHTML = dashStat('$'+fmt$(d.weekTotal||0), 'This Week')
      + dashStat('$'+fmt$(d.monthTotal||0), 'This Month')
      + dashStat('$'+fmt$(d.ytdTotal||0), 'Year to Date')
      + dashStat(String(d.givers||0), 'Givers YTD');
  });
}
function loadGivingTransactions() {
  var tbody = document.getElementById('giv-txn-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--warm-gray);">Loading&#8230;</td></tr>';
  var fundId = document.getElementById('giv-txn-fund').value;
  var from = document.getElementById('giv-txn-from').value;
  var to = document.getElementById('giv-txn-to').value;
  var qs = [];
  if (fundId) qs.push('fund_id=' + encodeURIComponent(fundId));
  if (from) qs.push('from=' + encodeURIComponent(from));
  if (to) qs.push('to=' + encodeURIComponent(to));
  api('/admin/api/giving/transactions' + (qs.length ? '?' + qs.join('&') : '')).then(function(d) {
    var rows = d.transactions || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--warm-gray);">No transactions match these filters.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function(r) {
      return '<tr onclick="goToBatch(' + r.batch_id + ')" style="cursor:pointer;">'
        + '<td>' + esc(r.person_name) + '</td>'
        + '<td>' + esc(r.fund_name) + '</td>'
        + '<td>' + esc(r.method) + (r.check_number ? ' #'+esc(r.check_number) : '') + '</td>'
        + '<td>' + fmtDate(r.txn_date) + '</td>'
        + '<td class="amt-col">' + fmtMoney(r.amount) + '</td>'
        + '</tr>';
    }).join('');
  });
}
function givTxnClearFilters() {
  document.getElementById('giv-txn-fund').value = '';
  document.getElementById('giv-txn-from').value = '';
  document.getElementById('giv-txn-to').value = '';
  loadGivingTransactions();
}
var _batchFilter = 'all';
function setBatchFilter(btn, val) {
  document.querySelectorAll('[data-bs]').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  _batchFilter = val;
  loadBatches();
}
var _pendingOpenBatchId = null;
var _lastBatches = null;
function goToBatch(batchId) {
  _pendingOpenBatchId = batchId;
  showTab('giving');
  givSetView('batches');
}
function loadBatches() {
  var pendingId = _pendingOpenBatchId;
  _pendingOpenBatchId = null;
  api('/admin/api/giving/batches?status=' + _batchFilter).then(function(d) {
    _lastBatches = d.batches || [];
    renderBatchList(_lastBatches);
    if (pendingId) openBatch(pendingId);
  });
}
function filterBatchSearch(val) {
  _batchSearch = (val||'').toLowerCase().trim();
  if (_lastBatches) {
    renderBatchList(_lastBatches);
  } else {
    loadBatches();
  }
}
function renderBatchList(batches) {
  var c = document.getElementById('batch-list');
  var filtered = _batchSearch
    ? batches.filter(function(b) {
        return (b.description||'').toLowerCase().indexOf(_batchSearch) >= 0
            || (b.batch_date||'').indexOf(_batchSearch) >= 0;
      })
    : batches;
  if (!filtered.length) {
    c.innerHTML = '<div style="padding:30px 16px;text-align:center;color:var(--warm-gray);font-size:.84rem;">'
      + (_batchSearch ? 'No batches match &#8220;' + esc(_batchSearch) + '&#8221;' : 'No batches yet') + '</div>';
    return;
  }
  c.innerHTML = filtered.map(function(b) {
    var cls = 'batch-row' + (b.id === currentBatchId ? ' selected' : '');
    var badge = b.closed ? '<span class="badge-closed">Closed</span>' : '<span class="badge-open">Open</span>';
    return '<div class="' + cls + '" onclick="openBatch(' + b.id + ')">'
      + '<div class="batch-date">' + fmtDate(b.batch_date) + '</div>'
      + '<div class="batch-desc">' + esc(b.description) + '</div>'
      + '<div class="batch-meta">'
      + '<span>' + (b.entry_count||0) + ' entries \u00b7 ' + fmtMoney(b.total_cents||0) + '</span>'
      + badge + '</div></div>';
  }).join('');
}
function openBatch(id) {
  currentBatchId = id;
  // Highlight selected row
  document.querySelectorAll('.batch-row').forEach(function(r) { r.classList.remove('selected'); });
  document.querySelectorAll('.batch-row').forEach(function(r) {
    if (r.getAttribute('onclick') && r.getAttribute('onclick').indexOf('(' + id + ')') >= 0) r.classList.add('selected');
  });
  api('/admin/api/giving/batches/' + id).then(function(b) { renderBatchDetail(b); }).catch(function() {
    var el = document.getElementById('batch-detail');
    if (el) el.innerHTML = '<div style="padding:24px;color:var(--danger);">Error loading batch.</div>';
  });
}
function renderBatchDetail(b) {
  _currentBatch = b;
  var c = document.getElementById('batch-detail');
  var isOpen = !b.closed;
  var total = (b.entries||[]).reduce(function(s,e){return s+(e.amount||0);},0);
  var fundOpts = allFunds.map(function(f) {
    return '<option value="' + f.id + '">' + esc(f.name) + '</option>';
  }).join('');

  var entryRows = (b.entries||[]).length
    ? (b.entries||[]).map(function(e) {
        return '<tr><td>' + esc(e.person_name||'(anonymous)') + '</td>'
          + '<td>' + esc(e.fund_name) + '</td>'
          + '<td class="amt-col">' + fmtMoney(e.amount) + '</td>'
          + '<td>' + esc(e.method) + (e.check_number ? ' #'+esc(e.check_number) : '') + '</td>'
          + '<td style="width:32px;padding:0 8px;">' + (isOpen ? '<button class="del-entry" onclick="deleteEntry(' + e.id + ')" title="Remove">&#215;</button>' : '') + '</td>'
          + '</tr>';
      }).join('')
    : '<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--warm-gray);">No entries in this batch yet.</td></tr>';

  var entryForm = isOpen ? (
    '<div class="entry-form">'
    + '<div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--warm-gray);margin-bottom:8px;">Add Entry</div>'
    + '<div class="form-row">'
    + '<div class="field field-person"><label>Person</label>'
    + '<div class="ac-wrap"><input type="text" id="e-person-search" placeholder="Search or leave blank for anonymous…" oninput="acSearch(this,&#39;e-person-ac&#39;,&#39;e-person-id&#39;)" style="width:100%;"><div class="ac-dropdown" id="e-person-ac"></div></div>'
    + '<input type="hidden" id="e-person-id"></div>'
    + '<div class="field field-fund"><label>Fund</label><select id="e-fund"><option value="">—Select—</option>' + fundOpts + '</select></div>'
    + '<div class="field field-amount"><label>Amount ($)</label><input type="number" id="e-amount" step="0.01" min="0" placeholder="0.00"></div>'
    + '</div>'
    + '<div class="form-row" style="align-items:center;">'
    + '<div class="field"><label>Method</label><div class="method-row">'
    + '<label><input type="radio" name="e-method" value="cash" checked> Cash</label>'
    + '<label><input type="radio" name="e-method" value="check"> Check</label>'
    + '<label><input type="radio" name="e-method" value="other"> Other</label>'
    + '</div></div>'
    + '<div class="field field-check" id="e-check-wrap" style="display:none;"><label>Check #</label><input type="text" id="e-check-num"></div>'
    + '<button class="btn-primary" onclick="addEntry(' + b.id + ')" style="margin-left:auto;align-self:flex-end;">+ Add Entry</button>'
    + '</div>'
    + '</div>'
  ) : '';

  var actionBtns = isOpen
    ? '<button class="btn-danger" onclick="closeBatch(' + b.id + ')" style="margin-left:auto;">Close Batch</button>'
    : '<button class="btn-secondary" onclick="reopenBatch(' + b.id + ')" style="margin-left:auto;font-size:.82rem;">Reopen Batch</button>';

  c.innerHTML = '<div class="batch-detail-hdr">'
    + '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
    + '<div><div style="font-family:var(--font-head);font-size:1rem;color:var(--steel-anchor);">' + esc(b.description) + '</div>'
    + '<div style="font-size:.8rem;color:var(--warm-gray);">' + fmtDate(b.batch_date) + '</div></div>'
    + '<span class="' + (b.closed ? 'badge-closed' : 'badge-open') + '">' + (b.closed ? 'Closed' : 'Open') + '</span>'
    + actionBtns + '</div></div>'
    + '<div class="total-bar"><span class="total-amount">' + fmtMoney(total) + '</span><span class="total-count">' + (b.entries||[]).length + ' entries</span></div>'
    + entryForm
    + '<div style="overflow-x:auto;"><table class="entries-table"><thead><tr><th>Person</th><th>Fund</th><th class="amt-col">Amount</th><th>Method</th><th></th></tr></thead><tbody id="entry-tbody">' + entryRows + '</tbody></table></div>';

  // Wire up check# toggle
  c.querySelectorAll('input[name="e-method"]').forEach(function(r) {
    r.addEventListener('change', function() {
      document.getElementById('e-check-wrap').style.display = this.value === 'check' ? 'flex' : 'none';
    });
  });
}
function addEntry(batchId) {
  var personId = document.getElementById('e-person-id').value || null;
  var fundId = document.getElementById('e-fund').value;
  var amt = parseFloat(document.getElementById('e-amount').value);
  var method = document.querySelector('input[name="e-method"]:checked').value;
  var checkNum = document.getElementById('e-check-num') ? document.getElementById('e-check-num').value : '';
  if (!fundId) { alert('Please select a fund.'); return; }
  if (!amt || amt <= 0) { alert('Please enter an amount.'); return; }
  api('/admin/api/giving/batches/' + batchId + '/entries', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({person_id:personId, fund_id:parseInt(fundId), amount:amt, method:method, check_number:checkNum})
  }).then(function(r) {
    if (r.ok) {
      // Reset form fields
      document.getElementById('e-person-search').value = '';
      document.getElementById('e-person-id').value = '';
      document.getElementById('e-amount').value = '';
      document.querySelector('input[name="e-method"][value="cash"]').checked = true;
      document.getElementById('e-check-wrap').style.display = 'none';
      if (document.getElementById('e-check-num')) document.getElementById('e-check-num').value = '';
      openBatch(batchId);
      loadBatches();
      document.getElementById('e-person-search').focus();
    } else alert('Error: ' + (r.error||'unknown'));
  });
}
function deleteEntry(id) {
  if (!confirm('Remove this entry?')) return;
  api('/admin/api/giving/entries/' + id, {method:'DELETE'}).then(function(r) {
    if (r.ok) { openBatch(currentBatchId); loadBatches(); }
    else alert(r.error || 'Cannot delete.');
  });
}
function closeBatch(id) {
  if (!confirm('Close this batch? Entries cannot be added or removed after closing.')) return;
  var b = _currentBatch || {};
  api('/admin/api/giving/batches/' + id, {method:'PUT', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({closed:1, batch_date:b.batch_date||'', description:b.description||''})})
    .then(function(r) {
      if (r && r.ok) { openBatch(id); loadBatches(); }
      else alert('Error closing batch: ' + (r && r.error || 'Unknown error'));
    }).catch(function(e) { alert('Error closing batch: ' + e.message); });
}
function reopenBatch(id) {
  if (!confirm('Reopen this batch?')) return;
  var b = _currentBatch || {};
  api('/admin/api/giving/batches/' + id, {method:'PUT', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({closed:0, batch_date:b.batch_date||'', description:b.description||''})})
    .then(function(r) {
      if (r && r.ok) { openBatch(id); loadBatches(); }
      else alert('Error reopening batch: ' + (r && r.error || 'Unknown error'));
    }).catch(function(e) { alert('Error reopening batch: ' + e.message); });
}
function openNewBatch() {
  var today = new Date().toISOString().slice(0,10);
  document.getElementById('bm-date').value = today;
  document.getElementById('bm-desc').value = 'Sunday AM Offering';
  openModal('batch-modal');
}
function createBatch() {
  var date = document.getElementById('bm-date').value;
  var desc = document.getElementById('bm-desc').value.trim();
  if (!date || !desc) { alert('Date and description are required.'); return; }
  api('/admin/api/giving/batches', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({batch_date:date, description:desc})}).then(function(r) {
    if (r.ok) { closeModal('batch-modal'); loadBatches(); openBatch(r.id); }
    else alert('Error: ' + (r.error||'unknown'));
  });
}

`;
