export const JS_GIVING = String.raw`<script>
// ── GIVING ────────────────────────────────────────────────────────────
// ── Batches / Transactions view toggle (RDS4) ──────────────────────────
var _givView = 'batches';
var _GIV_VIEWS = ['batches','transactions','deposits','board','letters','receipts','reports','settings'];
var _GIV_VIEW_DISPLAY = { batches:'grid', transactions:'flex' }; // others default to ''
function givSetView(view) {
  _givView = view;
  _GIV_VIEWS.forEach(function(v) {
    var btn = document.getElementById('giv-view-' + v + '-btn');
    if (btn) btn.classList.toggle('active', v === view);
    var panel = document.getElementById('giv-view-' + v);
    if (panel) panel.style.display = (v === view) ? (_GIV_VIEW_DISPLAY[v] || '') : 'none';
  });
  if (view === 'transactions') {
    givTxnPopulateFundOptions();
    loadGivingTransactions();
  }
  if (view === 'board') {
    loadBoardReport();
    givPopulateFundSelect('rpt-plateau-fund');
    givPopulateFundSelect('rpt-bands-fund');
    var curYr = new Date().getFullYear();
    var platYr = document.getElementById('rpt-plateau-year');
    if (platYr && !platYr.value) platYr.value = curYr;
    var bandsYr = document.getElementById('rpt-bands-year');
    if (bandsYr && !bandsYr.value) bandsYr.value = curYr;
  }
  if (view === 'deposits') loadDeposits();
  if (view === 'letters') givLettersInit();
  if (view === 'receipts') givReceiptsInit();
  if (view === 'reports') { givAnalysisInit(); finInitGivingReports(); }
  if (view === 'settings') loadGivingSettings();
}

// ── Deposit reconciliation (GIV-DEP) ───────────────────────────────────
// A deposit groups the gifts that make one bank deposit; entering the amount the
// bank actually received makes "Given − Deposited = fees" fall out on its own — the
// donor-covered-fee gifts add equally to both sides and cancel, so the gap is exactly
// the fees the church absorbed. Fees per gift (fee_cents) come later from the processor.
var _depFilter = 'all';
var _depCurrentId = null;
var _depDetail = null;

function depSourceLabel(s) {
  return ({ check:'Check', cash:'Cash', online:'Online', mixed:'Mixed' })[s] || 'Unspecified';
}

function loadDeposits() {
  var list = document.getElementById('giv-deposits-list');
  if (!list) return;
  list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--warm-gray);font-size:.85rem;">Loading&#8230;</div>';
  api('/admin/api/giving/deposits?status=' + encodeURIComponent(_depFilter)).then(function(d) {
    depRenderList((d && d.deposits) || []);
  }).catch(function() {
    list.innerHTML = '<div style="padding:16px;color:var(--danger);font-size:.85rem;">Could not load deposits.</div>';
  });
}

function depSetFilter(btn, f) {
  _depFilter = f;
  var pills = btn.parentNode.querySelectorAll('.pill');
  for (var i = 0; i < pills.length; i++) pills[i].classList.remove('active');
  btn.classList.add('active');
  loadDeposits();
}

function depRenderList(deps) {
  var list = document.getElementById('giv-deposits-list');
  if (!list) return;
  if (!deps.length) {
    list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--warm-gray);font-size:.85rem;">No deposits yet.</div>';
    return;
  }
  list.innerHTML = deps.map(function(d) {
    var gross = d.gross_cents || 0;
    var recon = d.status === 'reconciled';
    var bank = (d.bank_cents === null || d.bank_cents === undefined) ? null : d.bank_cents;
    var feeGap = (bank === null) ? null : (gross - bank);
    var sel = (d.id === _depCurrentId);
    var badge = recon
      ? '<span style="background:var(--sage,#4A5E3A);color:var(--white,#fff);font-size:.66rem;padding:2px 7px;border-radius:10px;">Reconciled</span>'
      : '<span style="background:var(--amber,#C9973A);color:var(--white,#fff);font-size:.66rem;padding:2px 7px;border-radius:10px;">Open</span>';
    return '<div onclick="depOpen(' + d.id + ')" style="cursor:pointer;padding:10px 12px;border-radius:8px;margin-bottom:7px;border:1px solid var(--linen,#EDE9E0);'
      + (sel ? 'background:var(--linen,#EDE9E0);' : 'background:var(--warm-white,#FBF8F3);') + '">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">'
      + '<strong style="font-size:.9rem;">' + (d.deposit_date ? fmtDate(d.deposit_date) : 'No date') + '</strong>' + badge + '</div>'
      + '<div style="font-size:.76rem;color:var(--warm-gray);margin-top:3px;">'
      + depSourceLabel(d.source) + ' &middot; ' + (d.gift_count || 0) + ' gift' + ((d.gift_count === 1) ? '' : 's') + ' &middot; ' + fmtMoney(gross) + '</div>'
      + (feeGap !== null ? '<div style="font-size:.76rem;margin-top:2px;color:' + (feeGap < 0 ? 'var(--danger)' : 'var(--warm-gray)') + ';">Fees ' + fmtMoney(feeGap) + '</div>' : '')
      + '</div>';
  }).join('');
}

function depNew() {
  _depCurrentId = null; _depDetail = null;
  loadDeposits();
  var el = document.getElementById('giv-deposit-detail');
  if (!el) return;
  var today = new Date().toISOString().slice(0, 10);
  el.innerHTML =
    '<h3 style="margin:0 0 14px;">New Deposit</h3>'
    + '<div class="field" style="margin-bottom:10px;"><label>Deposit date</label><input type="date" id="dep-new-date" value="' + today + '"></div>'
    + '<div class="field" style="margin-bottom:10px;"><label>Source</label><select id="dep-new-source"><option value="">Unspecified</option><option value="check">Check</option><option value="cash">Cash</option><option value="online">Online (Tithe.ly)</option><option value="mixed">Mixed</option></select></div>'
    + '<div class="field" style="margin-bottom:10px;"><label>Reference / payout id (optional)</label><input type="text" id="dep-new-ref" placeholder="e.g. Tithe.ly payout #"></div>'
    + '<div class="field" style="margin-bottom:14px;"><label>Notes (optional)</label><input type="text" id="dep-new-notes"></div>'
    + '<button class="btn-primary" onclick="depCreate()">Create Deposit</button> '
    + '<button class="btn-secondary" onclick="depClearDetail()">Cancel</button>';
}

function depCreate() {
  var src = document.getElementById('dep-new-source').value;
  var body = {
    deposit_date: document.getElementById('dep-new-date').value,
    source: src,
    external_ref: document.getElementById('dep-new-ref').value,
    notes: document.getElementById('dep-new-notes').value
  };
  if (src === 'online') body.processor = 'tithely';
  api('/admin/api/giving/deposits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function(r) { if (r && r.error) { alert(r.error); return; } loadDeposits(); depOpen(r.id); })
    .catch(function() { alert('Could not create the deposit.'); });
}

function depClearDetail() {
  _depCurrentId = null; _depDetail = null;
  var el = document.getElementById('giv-deposit-detail');
  if (el) el.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:180px;color:var(--warm-gray);gap:10px;text-align:center;"><div style="font-size:.9rem;">Select a deposit, or click <strong>+ New</strong>.</div></div>';
  loadDeposits();
}

function depOpen(id) {
  _depCurrentId = id;
  api('/admin/api/giving/deposits/' + id).then(function(d) {
    if (d && d.error) { alert(d.error); return; }
    _depDetail = d;
    depRenderDetail();
    loadDeposits();
  }).catch(function() { alert('Could not load the deposit.'); });
}

function depRenderDetail() {
  var d = _depDetail; if (!d) return;
  var el = document.getElementById('giv-deposit-detail'); if (!el) return;
  var recon = d.status === 'reconciled';
  var gross = (d.totals && d.totals.gross_cents) || 0;
  var recordedFees = (d.totals && d.totals.fee_cents) || 0;
  var bankCents = (d.bank_cents === null || d.bank_cents === undefined) ? null : d.bank_cents;
  var bankVal = (bankCents === null) ? '' : (bankCents / 100).toFixed(2);
  var feeGap = (bankCents === null) ? null : (gross - bankCents);
  var gifts = d.gifts || [];

  var giftRows = gifts.length ? gifts.map(function(g) {
    return '<tr><td>' + fmtDate(g.gift_date) + '</td><td>' + esc(g.person_name) + '</td><td>' + esc(g.fund_name) + '</td><td>' + esc(g.method) + '</td>'
      + '<td class="amt-col">' + fmtMoney(g.amount) + '</td>'
      + (recon ? '' : '<td><button class="btn-secondary" style="padding:2px 8px;font-size:.72rem;" onclick="depRemoveGift(' + g.id + ')">Remove</button></td>')
      + '</tr>';
  }).join('') : '<tr><td colspan="' + (recon ? 5 : 6) + '" style="padding:14px;text-align:center;color:var(--warm-gray);">No gifts assigned yet.</td></tr>';

  var html = '';
  html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:14px;">';
  html += '<div><h3 style="margin:0;">' + (d.deposit_date ? fmtDate(d.deposit_date) : 'New deposit') + '</h3>';
  html += '<div style="font-size:.8rem;color:var(--warm-gray);margin-top:2px;">' + depSourceLabel(d.source) + (d.external_ref ? ' &middot; ' + esc(d.external_ref) : '') + '</div>';
  if (d.notes) html += '<div style="font-size:.8rem;color:var(--warm-gray);margin-top:2px;">' + esc(d.notes) + '</div>';
  html += '</div><div>' + (recon
    ? '<span style="background:var(--sage,#4A5E3A);color:var(--white,#fff);font-size:.7rem;padding:3px 9px;border-radius:11px;">Reconciled</span>'
    : '<span style="background:var(--amber,#C9973A);color:var(--white,#fff);font-size:.7rem;padding:3px 9px;border-radius:11px;">Open</span>') + '</div></div>';

  html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;">';
  html += '<div class="dash-stat" style="padding:12px;"><div style="font-size:.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.03em;">Given</div><div style="font-size:1.25rem;font-weight:700;">' + fmtMoney(gross) + '</div></div>';
  if (recon) {
    html += '<div class="dash-stat" style="padding:12px;"><div style="font-size:.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.03em;">Deposited</div><div style="font-size:1.25rem;font-weight:700;">' + (bankCents === null ? '&mdash;' : fmtMoney(bankCents)) + '</div></div>';
  } else {
    html += '<div class="dash-stat" style="padding:12px;"><div style="font-size:.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.03em;">Bank deposit</div>'
      + '<div style="display:flex;align-items:center;gap:3px;margin-top:3px;"><span style="font-size:1.05rem;">$</span><input type="number" step="0.01" id="dep-bank-input" value="' + bankVal + '" oninput="depRecalcFees()" style="width:100%;font-size:1.05rem;padding:4px 6px;"></div></div>';
  }
  html += '<div class="dash-stat" style="padding:12px;"><div style="font-size:.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.03em;">Fees (Given &minus; Deposited)</div><div id="dep-fee-figure" style="font-size:1.25rem;font-weight:700;">' + (feeGap === null ? '&mdash;' : fmtMoney(feeGap)) + '</div></div>';
  html += '</div>';

  if (recordedFees) html += '<div style="font-size:.78rem;color:var(--warm-gray);margin:-4px 0 14px;">Processor-reported fees on these gifts: ' + fmtMoney(recordedFees) + ' (cross-check for the figure above once the payment system supplies fees).</div>';

  html += '<div style="margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap;">';
  if (recon) {
    html += '<button class="btn-secondary" onclick="depReopen()">Reopen</button>';
  } else {
    html += '<button class="btn-primary" onclick="depReconcile()">Reconcile to Bank</button>';
    html += '<button class="btn-secondary" onclick="depSaveBank()">Save Bank Amount</button>';
    html += '<button class="btn-danger" onclick="depDelete()" style="margin-left:auto;">Delete</button>';
  }
  html += '</div>';

  html += '<h4 style="margin:0 0 8px;">Gifts in this deposit</h4>';
  html += '<div style="overflow-x:auto;"><table class="entries-table"><thead><tr><th>Date</th><th>Donor</th><th>Fund</th><th>Method</th><th class="amt-col">Amount</th>' + (recon ? '' : '<th></th>') + '</tr></thead><tbody>' + giftRows + '</tbody></table></div>';

  if (!recon) {
    html += '<div style="margin-top:14px;"><button class="btn-secondary" onclick="depToggleAddGifts()">+ Add gifts</button><div id="dep-add-box" style="display:none;margin-top:10px;"></div></div>';
  }

  el.innerHTML = html;
  depRecalcFees();
}

function depRecalcFees() {
  var d = _depDetail; if (!d) return;
  var gross = (d.totals && d.totals.gross_cents) || 0;
  var inp = document.getElementById('dep-bank-input');
  var span = document.getElementById('dep-fee-figure');
  if (!span || !inp) return;
  if (inp.value === '') { span.textContent = '—'; span.style.color = 'var(--warm-gray)'; return; }
  var bankCents = Math.round(parseFloat(inp.value) * 100);
  if (isNaN(bankCents)) { span.textContent = '—'; span.style.color = 'var(--warm-gray)'; return; }
  var fee = gross - bankCents;
  span.textContent = fmtMoney(fee);
  span.style.color = (fee < 0) ? 'var(--danger)' : 'var(--charcoal,#1A1A2A)';
}

function depToggleAddGifts() {
  var box = document.getElementById('dep-add-box');
  if (!box) return;
  if (box.style.display === 'none') { box.style.display = 'block'; depLoadUnassigned(); }
  else { box.style.display = 'none'; }
}

function depLoadUnassigned() {
  var box = document.getElementById('dep-add-box');
  if (!box) return;
  box.innerHTML = '<div style="padding:10px;color:var(--warm-gray);font-size:.82rem;">Loading gifts&#8230;</div>';
  api('/admin/api/giving/unassigned-gifts').then(function(d) {
    var gifts = (d && d.gifts) || [];
    if (!gifts.length) { box.innerHTML = '<div style="padding:10px;color:var(--warm-gray);font-size:.82rem;">No unassigned gifts &mdash; every recorded gift is already in a deposit.</div>'; return; }
    var rows = gifts.map(function(g) {
      return '<tr><td><input type="checkbox" class="dep-add-cb" value="' + g.id + '"></td><td>' + fmtDate(g.gift_date) + '</td><td>' + esc(g.person_name) + '</td><td>' + esc(g.fund_name) + '</td><td>' + esc(g.method) + '</td><td class="amt-col">' + fmtMoney(g.amount) + '</td></tr>';
    }).join('');
    box.innerHTML = '<div style="margin:2px 0 8px;"><label style="font-size:.8rem;"><input type="checkbox" onclick="depToggleAllUnassigned(this)"> Select all</label> <button class="btn-primary" style="padding:4px 10px;font-size:.78rem;margin-left:8px;" onclick="depAddSelected()">Add selected</button></div>'
      + '<div style="max-height:280px;overflow:auto;"><table class="entries-table"><thead><tr><th></th><th>Date</th><th>Donor</th><th>Fund</th><th>Method</th><th class="amt-col">Amount</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }).catch(function() { box.innerHTML = '<div style="padding:10px;color:var(--danger);font-size:.82rem;">Could not load gifts.</div>'; });
}

function depToggleAllUnassigned(cb) {
  var cbs = document.querySelectorAll('.dep-add-cb');
  for (var i = 0; i < cbs.length; i++) cbs[i].checked = cb.checked;
}

function depAddSelected() {
  var cbs = document.querySelectorAll('.dep-add-cb');
  var ids = [];
  for (var i = 0; i < cbs.length; i++) if (cbs[i].checked) ids.push(parseInt(cbs[i].value));
  if (!ids.length) { alert('Select at least one gift to add.'); return; }
  api('/admin/api/giving/deposits/' + _depCurrentId + '/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry_ids: ids }) })
    .then(function(r) { if (r && r.error) { alert(r.error); return; } depOpen(_depCurrentId); })
    .catch(function() { alert('Could not add the gifts.'); });
}

function depRemoveGift(entryId) {
  api('/admin/api/giving/deposits/' + _depCurrentId + '/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry_ids: [entryId], unassign: true }) })
    .then(function(r) { if (r && r.error) { alert(r.error); return; } depOpen(_depCurrentId); })
    .catch(function() { alert('Could not remove the gift.'); });
}

function depSaveBank() {
  var inp = document.getElementById('dep-bank-input');
  var bankCents = null;
  if (inp && inp.value !== '') {
    bankCents = Math.round(parseFloat(inp.value) * 100);
    if (isNaN(bankCents)) { alert('Enter a valid dollar amount.'); return; }
  }
  api('/admin/api/giving/deposits/' + _depCurrentId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bank_cents: bankCents }) })
    .then(function(r) { if (r && r.error) { alert(r.error); return; } depOpen(_depCurrentId); })
    .catch(function() { alert('Could not save.'); });
}

function depReconcile() {
  var inp = document.getElementById('dep-bank-input');
  if (!inp || inp.value === '') { alert('Enter the bank deposit amount first.'); return; }
  var bankCents = Math.round(parseFloat(inp.value) * 100);
  if (isNaN(bankCents)) { alert('Enter a valid dollar amount.'); return; }
  api('/admin/api/giving/deposits/' + _depCurrentId + '/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bank_cents: bankCents }) })
    .then(function(r) { if (r && r.error) { alert(r.error); return; } depOpen(_depCurrentId); })
    .catch(function() { alert('Could not reconcile.'); });
}

function depReopen() {
  api('/admin/api/giving/deposits/' + _depCurrentId + '/reopen', { method: 'POST' })
    .then(function(r) { if (r && r.error) { alert(r.error); return; } depOpen(_depCurrentId); })
    .catch(function() { alert('Could not reopen.'); });
}

function depDelete() {
  if (!confirm('Delete this deposit? Its gifts are released back to unassigned — no gift is deleted.')) return;
  api('/admin/api/giving/deposits/' + _depCurrentId, { method: 'DELETE' })
    .then(function(r) { if (r && r.error) { alert(r.error); return; } depClearDetail(); })
    .catch(function() { alert('Could not delete.'); });
}

function givTxnPopulateFundOptions() {
  var sel = document.getElementById('giv-txn-fund');
  if (!sel || sel.options.length > 1) return; // already populated
  allFunds.forEach(function(f) { sel.appendChild(new Option(f.name, f.id)); });
}
function givPopulateFundSelect(id) {
  var sel = document.getElementById(id);
  if (!sel || sel.options.length > 1) return; // already populated
  allFunds.forEach(function(f) { sel.appendChild(new Option(f.name, f.id)); });
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

// ── Board Report (giving redesign 1A dashboard / 1B narrative) ──────────
var _boardMode = 'dashboard';
var _boardData = null;
var _boardPeriodsBuilt = false;
var BOARD_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
var BOARD_MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Whole-dollar money (no cents) with a leading sign for negatives; used throughout the board.
function boardMoney(cents) {
  var neg = cents < 0;
  var d = Math.round(Math.abs(cents || 0) / 100);
  return (neg ? '−$' : '$') + d.toLocaleString('en-US');
}
function boardMoneyK(cents) {
  return '$' + Math.round(Math.abs(cents || 0) / 100000).toLocaleString('en-US') + 'k';
}

// Build the period dropdown once: last 12 months + last four quarters + last two annuals.
function boardBuildPeriods() {
  if (_boardPeriodsBuilt) return;
  var sel = document.getElementById('board-period');
  if (!sel) return;
  var now = new Date();
  var y = now.getUTCFullYear(), mo = now.getUTCMonth() + 1;
  var opts = [];
  // Months, most recent first, back 12
  for (var i = 0; i < 12; i++) {
    var mm = mo - i, yy = y;
    while (mm <= 0) { mm += 12; yy -= 1; }
    opts.push({ v: yy + '-' + String(mm).padStart(2, '0'), label: BOARD_MONTHS[mm - 1] + ' ' + yy });
  }
  // Current + prior full quarter
  var curQ = Math.ceil(mo / 3);
  for (var q = 0; q < 3; q++) {
    var qq = curQ - q, qy = y;
    while (qq <= 0) { qq += 4; qy -= 1; }
    opts.push({ v: qy + '-Q' + qq, label: 'Q' + qq + ' ' + qy });
  }
  opts.push({ v: String(y - 1), label: 'Annual ' + (y - 1) });
  opts.push({ v: String(y - 2), label: 'Annual ' + (y - 2) });
  sel.innerHTML = opts.map(function(o) { return '<option value="' + o.v + '">' + o.label + '</option>'; }).join('');
  sel.value = y + '-' + String(mo).padStart(2, '0');
  _boardPeriodsBuilt = true;
}

function boardSetMode(mode) {
  _boardMode = mode;
  var db = document.getElementById('board-mode-dashboard-btn');
  var nb = document.getElementById('board-mode-narrative-btn');
  if (db) db.classList.toggle('active', mode === 'dashboard');
  if (nb) nb.classList.toggle('active', mode === 'narrative');
  if (_boardData) boardRender();
}

function loadBoardReport() {
  boardBuildPeriods();
  var sel = document.getElementById('board-period');
  var period = sel ? sel.value : '';
  var body = document.getElementById('board-body');
  if (body) body.innerHTML = '<div class="board-empty">Loading&hellip;</div>';
  api('/admin/api/reports/giving-board?period=' + encodeURIComponent(period)).then(function(d) {
    if (!d || d.error) { if (body) body.innerHTML = '<div class="board-empty">Could not load the board report.</div>'; return; }
    _boardData = d;
    var sub = document.getElementById('board-subtitle');
    if (sub) sub.textContent = d.through_label + ' · General & designated funds · no individual donors named';
    boardRender();
  }).catch(function() { if (body) body.innerHTML = '<div class="board-empty">Could not load the board report.</div>'; });
}

function boardRender() {
  var body = document.getElementById('board-body');
  if (!body || !_boardData) return;
  if ((_boardData.totals.actual_cents || 0) === 0) {
    body.innerHTML = '<div class="board-empty">No giving recorded for ' + esc(_boardData.period_label) + ' yet.</div>';
    return;
  }
  body.innerHTML = _boardMode === 'narrative' ? boardNarrativeHtml(_boardData) : boardDashboardHtml(_boardData);
}

function boardKpiCard(color, label, value, valueColor, sub) {
  return '<div class="board-kpi-card" style="border-top-color:' + color + ';">'
    + '<div class="board-kpi-label">' + esc(label) + '</div>'
    + '<div class="board-kpi-value"' + (valueColor ? ' style="color:' + valueColor + ';"' : '') + '>' + value + '</div>'
    + '<div class="board-kpi-sub">' + sub + '</div></div>';
}

// General Fund is what the board cares about most — split it out from every other
// (designated/restricted) fund rather than showing one lump "all funds" total. Matched by
// name, same "40085 General Fund" naming convention used throughout Giving/Settings.
function boardGeneralFundSplit(d) {
  var funds = d.funds || [];
  var isGeneral = function(f) { return /general\s*fund/i.test(f.name || ''); };
  var gen = funds.filter(isGeneral), other = funds.filter(function(f) { return !isGeneral(f); });
  var sum = function(arr, key) { return arr.reduce(function(s, f) { return s + (f[key] || 0); }, 0); };
  return {
    general_cents: sum(gen, 'actual_cents'), general_prior_cents: sum(gen, 'prior_cents'),
    other_cents: sum(other, 'actual_cents'), other_prior_cents: sum(other, 'prior_cents'),
    other_count: other.filter(function(f) { return f.actual_cents > 0; }).length,
  };
}
function boardDashboardHtml(d) {
  var k = d.kpis;
  // KPI 1 — General Fund YTD (primary), with all other giving folded in as a sub-line
  var gf = boardGeneralFundSplit(d);
  var gfDelta = gf.general_cents - gf.general_prior_cents;
  var deltaSub = gf.general_prior_cents <= 0 ? 'No prior-year data for this point'
    : (gfDelta >= 0 ? '+' : '−') + Math.abs(Math.round(gfDelta / gf.general_prior_cents * 100)) + '% vs. same point in ' + d.prior_year;
  var otherSub = gf.other_cents > 0
    ? '<div style="margin-top:3px;opacity:.8;">+ ' + boardMoney(gf.other_cents) + ' other giving (' + gf.other_count + ' fund' + (gf.other_count === 1 ? '' : 's') + ') &middot; ' + boardMoney(gf.general_cents + gf.other_cents) + ' total</div>'
    : '';
  var c1 = boardKpiCard('#2E7EA6', 'General Fund YTD', boardMoney(gf.general_cents), '', deltaSub + otherSub);
  // KPI 2 — Vs budget YTD
  var c2;
  if (k.budget_variance_cents == null) {
    c2 = boardKpiCard('#B85C3A', 'Vs. budget YTD', '—', '#8A8377', 'No fund budgets set yet');
  } else {
    var vneg = k.budget_variance_cents < 0;
    var vsub = Math.abs(k.budget_variance_pct) + '% ' + (vneg ? 'behind' : 'ahead of') + ' the ' + boardMoney(k.budget_ytd_cents) + ' plan';
    c2 = boardKpiCard('#B85C3A', 'Vs. budget YTD', boardMoney(k.budget_variance_cents), vneg ? '#B85C3A' : '#6B8F71', vsub);
  }
  // KPI 3 — Year-end projection
  var methodNote = k.projection_method === 'seasonal' ? 'Projected on last year’s seasonal pattern'
    : k.projection_method === 'linear' ? 'Projected straight-line from the pace so far'
    : 'Full year recorded';
  var projSub = k.projection_vs_budget_cents == null ? methodNote
    : boardMoney(Math.abs(k.projection_vs_budget_cents)) + (k.projection_vs_budget_cents < 0 ? ' under' : ' over') + ' a ' + boardMoney(k.annual_budget_cents) + ' budget';
  var c3 = boardKpiCard('#C9973A', 'Year-end projection', boardMoney(k.projection_cents), '', projSub);
  // KPI 4 — Giving households
  var hhDelta = k.households - k.households_prior;
  var hhSub = (k.households_prior > 0 ? (Math.abs(hhDelta) + (hhDelta === 0 ? ' same as ' : hhDelta < 0 ? ' fewer than ' : ' more than ') + d.prior_year + ' · ') : '')
    + boardMoney(k.avg_per_household_cents) + ' average';
  var c4 = boardKpiCard('#6B8F71', 'Giving households', k.households.toLocaleString('en-US'), '', hhSub);
  var kpis = '<div class="board-kpi-grid">' + c1 + c2 + c3 + c4 + '</div>';

  // Body grid: chart card + navy panel
  var legend = '<div class="board-legend">'
    + '<span><span class="board-swatch" style="background:#C4DDE8;"></span>' + d.prior_year + '</span>'
    + '<span><span class="board-swatch" style="background:#2E7EA6;"></span>' + d.year + '</span>'
    + (d.has_budget ? '<span><span class="board-swatch" style="background:#F5E0B0;border:1px solid #C9973A;"></span>Budget</span>' : '')
    + '</div>';
  var chartNote = d.has_budget
    ? 'Thousands of dollars, all funds. The budget bar is the council-approved plan spread across the year by last year’s pattern.'
    : 'Thousands of dollars, all funds. Set fund budgets in Settings to show the budget bars.';
  var chartCard = '<div class="board-card">'
    + '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:4px;">'
    + '<div class="board-card-label">Month by month vs. prior year</div>' + legend + '</div>'
    + '<div style="font-size:11.5px;color:var(--warm-gray);margin-bottom:10px;">' + chartNote + '</div>'
    + boardMonthChart(d) + '</div>';

  var navy = boardNavyHtml(d);
  var bodyGrid = '<div class="board-body-grid">' + chartCard + navy + '</div>';

  // Fund table
  var fundTable = boardFundTableHtml(d);

  return kpis + bodyGrid + fundTable;
}

function boardNavyHtml(d) {
  var mixColors = { check:'#C4DDE8', ach:'#6B8F71', cash:'#C9973A', other:'#8A8377' };
  var rows = d.method_mix.map(function(m) {
    return '<div class="board-mix-row">'
      + '<div class="board-mix-head"><span>' + esc(m.label) + '</span><span style="font-variant-numeric:tabular-nums;">' + boardMoney(m.cents) + ' · ' + m.pct + '%</span></div>'
      + '<div class="board-mix-track"><div class="board-mix-fill" style="width:' + m.pct + '%;background:' + mixColors[m.key] + ';"></div></div></div>';
  }).join('');
  var con = d.concentration;
  var segColors = ['#C9973A', '#C4DDE8', '#6B8F71', 'rgba(255,255,255,.28)'];
  var segBar = '<div style="display:flex;height:10px;border-radius:5px;overflow:hidden;margin-top:12px;">'
    + con.segments.map(function(s, i) { return '<div style="width:' + Math.max(0, s.pct) + '%;background:' + segColors[i] + ';"></div>'; }).join('') + '</div>';
  var segLabels = '<div style="display:flex;justify-content:space-between;font-size:10.5px;color:rgba(255,255,255,.6);margin-top:5px;">'
    + con.segments.map(function(s) { return '<span>' + esc(s.label) + '</span>'; }).join('') + '</div>';
  var conText = 'The ten largest giving households account for <strong style="color:#fff;">' + con.top10_pct + '%</strong> of everything received this year.'
    + (con.half_households > 0 ? ' Half of all giving comes from ' + con.half_households + ' households.' : '');
  return '<div class="board-navy">'
    + '<div class="board-navy-label">Where the money comes from</div>'
    + '<div>' + rows + '</div>'
    + '<div style="border-top:1px solid rgba(255,255,255,.16);margin-top:16px;padding-top:14px;">'
    + '<div class="board-navy-label" style="margin-bottom:8px;">Concentration</div>'
    + '<div style="font-size:13px;line-height:1.55;color:rgba(255,255,255,.86);">' + conText + '</div>'
    + segBar + segLabels + '</div></div>';
}

function boardFundTableHtml(d) {
  var t = d.totals;
  function moneyCell(cents, color) {
    return '<td class="num"' + (color ? ' style="color:' + color + ';"' : '') + '>' + boardMoney(cents) + '</td>';
  }
  function dashCell() { return '<td class="num" style="color:#8A8377;">—</td>'; }
  function varCell(v) {
    if (v == null) return dashCell();
    var color = v < 0 ? '#B85C3A' : (v > 0 ? '#6B8F71' : '#8A8377');
    return '<td class="num" style="color:' + color + ';">' + (v > 0 ? '+' : '') + boardMoney(v) + '</td>';
  }
  var body = d.funds.map(function(f) {
    return '<tr><td>' + esc(f.name) + '</td>'
      + moneyCell(f.actual_cents)
      + (f.budget_ytd_cents == null ? dashCell() : moneyCell(f.budget_ytd_cents, '#8A8377'))
      + varCell(f.variance_cents)
      + moneyCell(f.prior_cents, '#8A8377') + '</tr>';
  }).join('');
  var totalVar = d.has_budget ? (t.actual_cents - t.budget_ytd_cents) : null;
  var totalRow = '<tr class="rpt-total"><td style="color:var(--color-navy);">Total</td>'
    + '<td class="num" style="color:var(--color-navy);">' + boardMoney(t.actual_cents) + '</td>'
    + (d.has_budget ? '<td class="num" style="color:var(--color-navy);">' + boardMoney(t.budget_ytd_cents) + '</td>' : dashCell())
    + (totalVar == null ? dashCell() : '<td class="num" style="color:' + (totalVar < 0 ? '#B85C3A' : '#6B8F71') + ';">' + (totalVar > 0 ? '+' : '') + boardMoney(totalVar) + '</td>')
    + '<td class="num" style="color:var(--color-navy);">' + boardMoney(t.prior_cents) + '</td></tr>';
  return '<div class="board-card board-fund-table">'
    + '<div class="board-card-label" style="margin-bottom:10px;">By fund</div>'
    + '<table class="rpt-table"><thead><tr>'
    + '<th>Fund</th><th class="num">YTD actual</th><th class="num">YTD budget</th><th class="num">Variance</th><th class="num">Prior year</th>'
    + '</tr></thead><tbody>' + body + totalRow + '</tbody></table></div>';
}

// Grouped bar chart: prior year (all 12 months) / current year (through the last closed month) /
// budget (all 12, only when budgets exist). Auto-scales the y-axis to the data.
function boardMonthChart(d) {
  var cur = d.monthly.current, prior = d.monthly.prior, tm = d.through_month;
  // Budget monthly, spread by prior-year shape (or evenly), only if budgets exist
  var priorTotal = prior.reduce(function(s, v) { return s + v; }, 0);
  var budgetMonthly = new Array(12).fill(0);
  if (d.has_budget) {
    for (var i = 0; i < 12; i++) {
      budgetMonthly[i] = priorTotal > 0 ? d.totals.annual_budget_cents * (prior[i] / priorTotal) : d.totals.annual_budget_cents / 12;
    }
  }
  // Axis max (in thousands), nice-rounded to 50k, min 100k
  var maxCents = 0;
  for (var j = 0; j < 12; j++) {
    if (j < tm) maxCents = Math.max(maxCents, cur[j]);
    maxCents = Math.max(maxCents, prior[j], budgetMonthly[j]);
  }
  var maxK = maxCents / 100000;
  var axisMaxK = Math.max(100, Math.ceil(maxK / 50) * 50);
  var baseline = 120, top = 26, span = baseline - top; // 94px
  function yOf(cents) { var k = cents / 100000; return baseline - (k / axisMaxK) * span; }
  function hOf(cents) { return (cents / 100000 / axisMaxK) * span; }
  var svg = '<svg viewBox="0 0 700 150" style="width:100%;height:150px;">';
  // gridlines + axis labels at 0, half, full
  var gl = [0, axisMaxK / 2, axisMaxK];
  gl.forEach(function(val) {
    var yy = baseline - (val / axisMaxK) * span;
    svg += '<line x1="26" y1="' + yy.toFixed(1) + '" x2="700" y2="' + yy.toFixed(1) + '" stroke="' + (val === 0 ? '#E8E0D0' : '#F1EFE9') + '" stroke-width="1"></line>';
    svg += '<text x="22" y="' + (yy + 3).toFixed(1) + '" text-anchor="end" fill="#A69A88" font-size="9">' + Math.round(val) + '</text>';
  });
  var x0 = 30, pitch = (700 - x0 - 6) / 12, barW = 13, gap = 2;
  for (var mo = 0; mo < 12; mo++) {
    var bars = [];
    // prior (ice-blue) always
    bars.push({ v: prior[mo], fill: '#C4DDE8', stroke: '' });
    // current (teal) only through last closed month
    if (mo < tm) bars.push({ v: cur[mo], fill: '#2E7EA6', stroke: '' });
    // budget (gold outline) if present
    if (d.has_budget) bars.push({ v: budgetMonthly[mo], fill: '#F5E0B0', stroke: '#C9973A' });
    var groupW = bars.length * barW + (bars.length - 1) * gap;
    var gs = x0 + mo * pitch + (pitch - groupW) / 2;
    bars.forEach(function(b, bi) {
      var bx = gs + bi * (barW + gap);
      var bh = Math.max(0, hOf(b.v));
      svg += '<rect x="' + bx.toFixed(1) + '" y="' + (baseline - bh).toFixed(1) + '" width="' + barW + '" height="' + bh.toFixed(1) + '" fill="' + b.fill + '"'
        + (b.stroke ? ' stroke="' + b.stroke + '" stroke-width=".8"' : '') + ' rx="2"></rect>';
    });
    var lx = x0 + mo * pitch + pitch / 2;
    svg += '<text x="' + lx.toFixed(1) + '" y="136" text-anchor="middle" fill="' + (mo < tm ? '#8A8377' : '#A69A88') + '" font-size="10">' + BOARD_MONTHS_SHORT[mo] + '</text>';
  }
  svg += '</svg>';
  return svg;
}

// Narrative page (1B): same data written as prose for the packet.
function boardNarrativeHtml(d) {
  var k = d.kpis, t = d.totals, con = d.concentration;
  var churchName = (typeof _churchConfig !== 'undefined' && _churchConfig && _churchConfig.church_name) || 'Timothy Lutheran Church';
  var mmName = BOARD_MONTHS[d.through_month - 1];
  // last day of month
  var monthEnds = [31,28,31,30,31,30,31,31,30,31,30,31];
  var isLeap = (d.year % 4 === 0 && d.year % 100 !== 0) || d.year % 400 === 0;
  var lastDay = (d.through_month === 2 && isLeap) ? 29 : monthEnds[d.through_month - 1];
  var asOf = mmName + ' ' + lastDay + ', ' + d.year;

  // Lede
  var deltaPrior = k.given_ytd_cents - k.given_ytd_prior_cents;
  var ledeParts = 'the congregation has given <strong>' + boardMoney(k.given_ytd_cents) + '</strong>';
  if (k.given_ytd_prior_cents > 0) ledeParts += ' — about ' + boardMoney(Math.abs(deltaPrior)) + (deltaPrior >= 0 ? ' more' : ' less') + ' than at this point last year';
  if (k.budget_variance_cents != null) ledeParts += ', and about ' + boardMoney(Math.abs(k.budget_variance_cents)) + (k.budget_variance_cents < 0 ? ' less than' : ' more than') + ' the budget assumed';
  ledeParts += '.';
  var lede = '<div style="font-family:var(--font-display);font-size:19px;line-height:1.5;color:var(--charcoal);margin-top:26px;">Through ' + asOf + ', ' + ledeParts + '</div>';

  // Section: Are we on pace?
  var paceBody;
  if (k.projection_vs_budget_cents != null) {
    paceBody = 'On the current pattern the year finishes near <strong>' + boardMoney(k.projection_cents) + '</strong> against a budget of ' + boardMoney(k.annual_budget_cents)
      + '. That is a gap of roughly <strong>' + boardMoney(Math.abs(k.projection_vs_budget_cents)) + '</strong>'
      + (k.annual_budget_cents > 0 ? ', or about ' + Math.abs(Math.round((k.projection_vs_budget_cents / k.annual_budget_cents) * 100)) + ' percent' : '') + '. '
      + (k.projection_method === 'seasonal' ? 'The projection assumes the rest of the year follows last year’s seasonal pattern.' : 'The projection extends the pace of giving so far across the remaining months.');
  } else {
    paceBody = 'On the current pattern the year finishes near <strong>' + boardMoney(k.projection_cents) + '</strong>. '
      + (k.projection_method === 'seasonal' ? 'The projection assumes the rest of the year follows last year’s seasonal pattern.' : 'The projection extends the pace of giving so far across the remaining months.')
      + ' Set fund budgets in Settings to compare this against plan.';
  }

  // Section: Who is giving
  var hhDelta = k.households - k.households_prior;
  var whoBody = k.households + ' households have given so far'
    + (k.households_prior > 0 ? ', ' + Math.abs(hhDelta) + (hhDelta === 0 ? ' the same as' : hhDelta < 0 ? ' fewer than' : ' more than') + ' last year' : '')
    + ', at an average of ' + boardMoney(k.avg_per_household_cents) + ' each. The ten largest giving households account for <strong>' + con.top10_pct + '%</strong> of all money received'
    + (con.half_households > 0 ? ', and half of all giving comes from ' + con.half_households + ' households' : '')
    + '. That concentration is the single largest financial risk the council carries: the loss or relocation of a few families would matter more than any line item in the budget.';

  // Section: How gifts arrive
  var mix = {}; d.method_mix.forEach(function(m) { mix[m.key] = m; });
  var arriveBody = 'Checks are ' + (mix.check.pct) + '% of giving. Automatic giving — ACH and online — is ' + mix.ach.pct + '%. '
    + 'Loose-plate cash is ' + mix.cash.pct + '%; it is also the only giving the church cannot acknowledge or attribute.';

  var section = function(eyebrow, body) {
    return '<div><div class="board-nv-eyebrow">' + esc(eyebrow) + '</div><div class="board-nv-body">' + body + '</div></div>';
  };

  // Compact fund table
  function nvNum(cents, color) { return '<td style="padding:7px 8px;border-bottom:1px solid var(--linen);text-align:right;font-variant-numeric:tabular-nums;' + (color ? 'color:' + color + ';' : '') + '">' + boardMoney(cents) + '</td>'; }
  function nvDash() { return '<td style="padding:7px 8px;border-bottom:1px solid var(--linen);text-align:right;color:#8A8377;">—</td>'; }
  function nvVar(v) {
    if (v == null) return nvDash();
    return '<td style="padding:7px 8px;border-bottom:1px solid var(--linen);text-align:right;font-variant-numeric:tabular-nums;color:' + (v < 0 ? '#B85C3A' : (v > 0 ? '#6B8F71' : '#8A8377')) + ';">' + (v > 0 ? '+' : '') + boardMoney(v) + '</td>';
  }
  var th = 'padding:7px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--warm-meta);border-bottom:1.5px solid var(--color-navy);';
  var fundRows = d.funds.map(function(f) {
    return '<tr><td style="padding:7px 8px;border-bottom:1px solid var(--linen);">' + esc(f.name) + '</td>'
      + nvNum(f.actual_cents) + (f.budget_ytd_cents == null ? nvDash() : nvNum(f.budget_ytd_cents)) + nvVar(f.variance_cents) + nvNum(f.prior_cents, '#8A8377') + '</tr>';
  }).join('');
  var totVar = d.has_budget ? (t.actual_cents - t.budget_ytd_cents) : null;
  var totRow = '<tr><td style="padding:8px;font-weight:700;">Total</td>'
    + '<td style="padding:8px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;">' + boardMoney(t.actual_cents) + '</td>'
    + (d.has_budget ? '<td style="padding:8px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;">' + boardMoney(t.budget_ytd_cents) + '</td>' : '<td style="padding:8px;text-align:right;color:#8A8377;">—</td>')
    + (totVar == null ? '<td style="padding:8px;text-align:right;color:#8A8377;">—</td>' : '<td style="padding:8px;text-align:right;font-weight:700;color:' + (totVar < 0 ? '#B85C3A' : '#6B8F71') + ';font-variant-numeric:tabular-nums;">' + (totVar > 0 ? '+' : '') + boardMoney(totVar) + '</td>')
    + '<td style="padding:8px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;">' + boardMoney(t.prior_cents) + '</td></tr>';
  var fundTable = '<table style="width:100%;border-collapse:collapse;font-size:12.5px;margin-top:26px;"><thead><tr>'
    + '<th style="text-align:left;' + th + '">Fund</th><th style="text-align:right;' + th + '">YTD</th><th style="text-align:right;' + th + '">Budget</th><th style="text-align:right;' + th + '">Variance</th><th style="text-align:right;' + th + '">' + d.prior_year + '</th>'
    + '</tr></thead><tbody>' + fundRows + totRow + '</tbody></table>';

  var footnote = '<div style="margin-top:auto;padding-top:28px;font-size:10.5px;color:#A69A88;line-height:1.6;border-top:1px solid var(--linen);">'
    + 'Figures are drawn from recorded contributions as of ' + asOf + ' and exclude tuition, daycare fees, and grant income. No individual donor is identified in this report; household-level detail is available to the finance committee on request.</div>';

  return '<div class="board-narrative">'
    + '<div style="display:flex;align-items:flex-end;justify-content:space-between;border-bottom:2px solid var(--color-navy);padding-bottom:10px;">'
    + '<div><div style="font-family:var(--font-display);font-size:27px;font-weight:700;color:var(--color-navy);line-height:1.1;">Giving Report to the Church Council</div>'
    + '<div style="font-size:12.5px;color:var(--warm-meta);margin-top:4px;letter-spacing:.02em;">' + esc(churchName) + '</div></div>'
    + '<div style="text-align:right;font-size:11px;color:var(--warm-meta);line-height:1.5;">Prepared ' + asOf + '<br>Aggregate figures only</div></div>'
    + lede
    + '<div style="margin-top:24px;display:flex;flex-direction:column;gap:18px;">'
    + section('Are we on pace?', paceBody)
    + section('Who is giving', whoBody)
    + section('How gifts arrive', arriveBody)
    + '</div>'
    + fundTable
    + footnote
    + '</div>';
}

function printBoardPage() {
  if (!_boardData) return;
  document.body.classList.add('printing-board');
  var cleanup = function() { document.body.classList.remove('printing-board'); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  setTimeout(function() { window.print(); setTimeout(cleanup, 1000); }, 60);
}

function boardEmailPacket() {
  alert('Emailing the board packet is coming in a later phase of the giving redesign. For now, use "Print board page" and attach the PDF, or print the Narrative view to PDF for a written packet.');
}

// ── LETTERS & STATEMENTS WORKSPACE (GIV-R2) ─────────────────────────────
// One workspace replacing the old four Batch-Send report tiles. Pick a letter type, a year,
// and a channel (email or print); the recipient list is resolved server-side (no "Load
// Givers" step) with real per-recipient sent/pending status, so a batch can be resumed after
// an interruption. Reuses the existing renderLetterHTML/letterheadImgHtml helpers for the
// actual letter body and the existing giving/send-statement endpoint for email delivery.
var _givLettersState = { type: 'year_end', year: 0, channel: 'email', scope: '', recipients: [], counts: null };
var _GIV_LETTER_TYPES = [
  { key: 'year_end',  label: 'Year-End Statement',  desc: 'Annual charitable-contribution statement for tax purposes.' },
  { key: 'midyear',   label: 'Mid-Year Update',     desc: 'A mid-year thank-you with giving to date and a recurring-giving nudge.' },
  { key: 'quarterly', label: 'Quarterly Statement', desc: 'A quarterly giving statement for review.' },
  { key: 'thank_you', label: 'Thank-You Letter',    desc: 'A warm thank-you to those who gave this year.' },
  { key: 'appeal',    label: 'Giving Appeal',       desc: 'Sent to every member household, whether or not they have given yet.' },
  { key: 'memorial',  label: 'Memorial Letter',     desc: 'Composed one at a time from the Reports tab statement tool.' }
];
function givLettersTemplateType(t) { return (t === 'midyear' || t === 'appeal' || t === 'thank_you') ? 'midyear' : 'year_end'; }
function givLettersSubject(t, yr, churchName) {
  if (t === 'midyear' || t === 'appeal') return yr + ' Mid-Year Giving Update — ' + churchName;
  if (t === 'thank_you') return 'Thank You for Your Generosity — ' + churchName;
  if (t === 'quarterly') return yr + ' Giving Statement — ' + churchName;
  return yr + ' Charitable Contribution Statement — ' + churchName;
}
function givLettersInit() {
  if (!_givLettersState.year) _givLettersState.year = new Date().getFullYear();
  givLettersRenderShell();
  givLettersLoadStatus();
}
function givLettersRenderShell() {
  var root = document.getElementById('giv-letters-root');
  if (!root) return;
  var st = _givLettersState;
  var pills = _GIV_LETTER_TYPES.map(function(t) {
    var active = t.key === st.type;
    return '<button class="fin-subnav-btn' + (active ? ' active' : '') + '" style="font-size:.8rem;" '
      + 'onclick="givLettersSetType(&#39;' + t.key + '&#39;)">' + esc(t.label) + '</button>';
  }).join('');
  var curType = _GIV_LETTER_TYPES.filter(function(t){return t.key===st.type;})[0] || _GIV_LETTER_TYPES[0];
  root.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px;">'
    +   '<div>'
    +     '<div class="board-title">Letters &amp; Statements</div>'
    +     '<div class="board-subtitle">Send or print giving letters &middot; per-recipient status &middot; resumable</div>'
    +   '</div>'
    +   '<button class="btn-secondary" style="padding:7px 14px;font-size:.85rem;" onclick="givSetView(&#39;settings&#39;)">Edit letter templates</button>'
    + '</div>'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">' + pills + '</div>'
    + '<div style="font-size:.82rem;color:var(--warm-gray);margin-bottom:12px;">' + esc(curType.desc) + '</div>'
    + '<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:end;margin-bottom:14px;">'
    +   '<div class="field" style="margin:0;"><label>Year</label>'
    +     '<input type="number" id="giv-letters-year" value="' + st.year + '" min="2000" max="2099" style="width:100px;font-size:.85rem;padding:5px 8px;" onchange="givLettersRefresh()"></div>'
    +   '<div class="field" style="margin:0;"><label>Recipients</label>'
    +     '<select id="giv-letters-scope" style="font-size:.85rem;padding:5px 8px;" onchange="givLettersRefresh()">'
    +       '<option value="givers">People who gave</option>'
    +       '<option value="member_households">Member households</option>'
    +       '<option value="both">Both (deduped by household)</option>'
    +     '</select></div>'
    +   '<div class="field" style="margin:0;"><label>Channel</label>'
    +     '<div class="board-mode-toggle">'
    +       '<button id="giv-letters-ch-email" class="' + (st.channel==='email'?'active':'') + '" onclick="givLettersSetChannel(&#39;email&#39;)">Email</button>'
    +       '<button id="giv-letters-ch-print" class="' + (st.channel==='print'?'active':'') + '" onclick="givLettersSetChannel(&#39;print&#39;)">Print</button>'
    +     '</div></div>'
    + '</div>'
    + '<div id="giv-letters-status" class="import-status" style="margin-bottom:8px;"></div>'
    + '<div id="giv-letters-body"></div>';
  var scopeSel = document.getElementById('giv-letters-scope');
  if (scopeSel && st.scope) scopeSel.value = st.scope;
}
function givLettersSetType(t) {
  _givLettersState.type = t;
  _givLettersState.scope = ''; // reset to the type's server default
  givLettersRenderShell();
  givLettersLoadStatus();
}
function givLettersSetChannel(c) {
  _givLettersState.channel = c;
  document.getElementById('giv-letters-ch-email').classList.toggle('active', c === 'email');
  document.getElementById('giv-letters-ch-print').classList.toggle('active', c === 'print');
  givLettersLoadStatus();
}
function givLettersRefresh() {
  var yrEl = document.getElementById('giv-letters-year');
  var scEl = document.getElementById('giv-letters-scope');
  if (yrEl) _givLettersState.year = parseInt(yrEl.value, 10) || new Date().getFullYear();
  if (scEl) _givLettersState.scope = scEl.value;
  givLettersLoadStatus();
}
function givLettersLoadStatus() {
  var st = _givLettersState;
  var statusEl = document.getElementById('giv-letters-status');
  var body = document.getElementById('giv-letters-body');
  if (!body) return;
  body.innerHTML = '<div class="board-empty">Loading recipients&hellip;</div>';
  if (statusEl) { statusEl.textContent = ''; statusEl.className = 'import-status'; }
  var qs = 'year=' + st.year + '&letter_type=' + st.type + '&channel=' + st.channel + (st.scope ? '&scope=' + st.scope : '');
  api('/admin/api/giving/letters/status?' + qs).then(function(d) {
    st.recipients = d.recipients || [];
    st.counts = d.counts || { total: 0, sent: 0, unsent: 0, no_email: 0 };
    st.scope = d.scope;
    var scEl = document.getElementById('giv-letters-scope');
    if (scEl && d.scope && scEl.value !== d.scope) scEl.value = d.scope;
    givLettersRenderRecipients();
  }).catch(function(e) {
    body.innerHTML = '<div class="board-empty">Could not load recipients: ' + esc(e.message) + '</div>';
  });
}
function givLettersRenderRecipients() {
  var st = _givLettersState;
  var body = document.getElementById('giv-letters-body');
  if (!body) return;
  if (st.type === 'memorial') {
    body.innerHTML = '<div class="import-card" style="margin:0;"><p style="margin:0;font-size:.88rem;color:var(--warm-gray);">'
      + 'Memorial letters are written one at a time. Use the <strong>Giving Statement</strong> tool under the Reports tab to pull a person&rsquo;s giving, then send or print an individual letter.</p></div>';
    return;
  }
  var recips = st.recipients;
  if (!recips.length) {
    body.innerHTML = '<div class="board-empty">No recipients for ' + st.year + '.</div>';
    return;
  }
  var c = st.counts;
  var chLabel = st.channel === 'print' ? 'printed' : 'sent';
  var actionBtn = st.channel === 'print'
    ? '<button class="btn-primary" style="font-size:.82rem;padding:6px 14px;" onclick="givLettersPrint()">Print Selected</button>'
    : '<button class="btn-primary" style="font-size:.82rem;padding:6px 14px;" onclick="givLettersSend()">Email Selected</button>';
  var head =
    '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;">'
    + givLettersStatChip(c.total, 'recipients')
    + givLettersStatChip(c.sent, 'already ' + chLabel)
    + givLettersStatChip(c.unsent, 'pending')
    + (st.channel === 'email' ? givLettersStatChip(c.no_email, 'no email') : '')
    + '</div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">'
    +   '<button class="btn-sm" onclick="givLettersSelectAll(true)">Select pending</button>'
    +   '<button class="btn-sm" onclick="givLettersSelectAll(false)">Deselect all</button>'
    +   actionBtn
    + '</div>';
  var th = 'padding:6px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--warm-meta);border-bottom:1.5px solid var(--color-navy);text-align:left;';
  var rows = recips.map(function(r, i) {
    var canPick = (st.channel === 'print') ? true : r.has_email;
    var sub = r.kind === 'household'
      ? (r.recipient_name ? esc(r.recipient_name) + ' &middot; ' : '') + (r.email ? esc(r.email) : '<span style="color:var(--danger);">no email</span>')
      : (r.email ? esc(r.email) : '<span style="color:var(--danger);">no email</span>');
    var statusPill = r.sent
      ? '<span style="font-size:.72rem;color:var(--sage);font-weight:600;">&#10003; ' + chLabel + '</span>'
      : '<span style="font-size:.72rem;color:var(--warm-gray);">pending</span>';
    return '<tr style="border-bottom:1px solid var(--border);">'
      + '<td style="padding:6px 8px;text-align:center;">'
      +   (canPick ? '<input type="checkbox" data-i="' + i + '"' + (r.sent ? '' : ' checked') + '>' : '<span title="No email on file" style="color:var(--warm-gray);">&mdash;</span>')
      + '</td>'
      + '<td style="padding:6px 8px;font-size:.85rem;">' + esc(r.name)
      +   ' <span style="font-size:.68rem;color:var(--warm-meta);text-transform:uppercase;">' + (r.kind === 'household' ? 'HH' : '') + '</span>'
      +   '<div style="font-size:.75rem;color:var(--warm-gray);">' + sub + '</div>'
      + '</td>'
      + '<td style="padding:6px 8px;font-size:.85rem;text-align:right;white-space:nowrap;">' + fmtMoney(r.total_cents || 0) + '</td>'
      + '<td style="padding:6px 8px;text-align:right;white-space:nowrap;">' + statusPill
      +   ' <button class="btn-sm" style="font-size:.68rem;padding:1px 6px;" onclick="givLettersToggleMark(' + i + ')">' + (r.sent ? 'undo' : 'mark') + '</button>'
      + '</td>'
      + '</tr>';
  }).join('');
  body.innerHTML = head
    + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">'
    + '<thead><tr>'
    +   '<th style="' + th + 'text-align:center;width:36px;"></th>'
    +   '<th style="' + th + '">Recipient</th>'
    +   '<th style="' + th + 'text-align:right;">' + st.year + ' Total</th>'
    +   '<th style="' + th + 'text-align:right;">Status</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}
function givLettersStatChip(n, label) {
  return '<div style="background:var(--warm-white,#fff);border:1px solid var(--border);border-radius:8px;padding:8px 14px;min-width:80px;">'
    + '<div style="font-size:1.25rem;font-weight:700;color:var(--color-navy);">' + (n || 0) + '</div>'
    + '<div style="font-size:.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.04em;">' + esc(label) + '</div></div>';
}
function givLettersSelectAll(pendingOnly) {
  var st = _givLettersState;
  document.querySelectorAll('#giv-letters-body tbody input[type=checkbox]').forEach(function(cb) {
    var r = st.recipients[parseInt(cb.dataset.i, 10)];
    cb.checked = pendingOnly ? !(r && r.sent) : false;
  });
}
function givLettersSelectedRecipients() {
  var st = _givLettersState, out = [];
  document.querySelectorAll('#giv-letters-body tbody input[type=checkbox]:checked').forEach(function(cb) {
    var r = st.recipients[parseInt(cb.dataset.i, 10)];
    if (r) out.push(r);
  });
  return out;
}
// Fetch the statement data + render the letter HTML for one recipient (person or household).
function givLettersBuildLetter(r, cb) {
  var st = _givLettersState;
  var churchName = (_churchConfig && _churchConfig.church_name) || 'Timothy Lutheran Church';
  var url = (r.kind === 'household')
    ? '/admin/api/reports/giving-statement-household?household_id=' + r.id + '&year=' + st.year
    : '/admin/api/reports/giving-statement?person_id=' + r.id + '&year=' + st.year;
  api(url).then(function(d) {
    if (!d || d.error) { cb(null); return; }
    d._mode = (r.kind === 'household') ? 'household' : 'person';
    var letterHtml = renderLetterHTML(d, givLettersTemplateType(st.type));
    var fullHtml = '<div style="font-family:Georgia,serif;font-size:14px;line-height:1.65;max-width:560px;">'
      + letterheadImgHtml(true, churchName, 'font-size:16px;font-weight:bold;', 6) + '<hr style="margin:10px 0;">'
      + letterHtml + '</div>';
    cb({ html: fullHtml, churchName: churchName });
  }).catch(function() { cb(null); });
}
function givLettersSend() {
  var st = _givLettersState;
  var statusEl = document.getElementById('giv-letters-status');
  var recips = givLettersSelectedRecipients().filter(function(r){ return r.has_email; });
  if (!recips.length) { statusEl.textContent = 'No emailable recipients selected.'; statusEl.className = 'import-status err'; return; }
  var loadCfg = (_churchConfig && _churchConfig.church_name)
    ? function(next){ next(); }
    : function(next){ api('/admin/api/config/church').then(function(cfg){ _churchConfig = cfg || {}; next(); }); };
  loadCfg(function() {
    var total = recips.length, done = 0, failed = 0, stopped = false, i = 0;
    statusEl.className = 'import-status';
    function finish() {
      var msg = 'Done. ' + done + ' emailed';
      if (failed) msg += ', ' + failed + ' failed';
      if (stopped) msg = "Brevo's sending limit was hit after " + done + ' emailed. Come back later and click Email Selected again — already-sent recipients are skipped.';
      statusEl.textContent = msg;
      statusEl.className = (failed || stopped) ? 'import-status' : 'import-status ok';
      givLettersLoadStatus();
    }
    function next() {
      if (i >= recips.length || stopped) { finish(); return; }
      var r = recips[i++];
      statusEl.textContent = 'Emailing ' + (done + failed + 1) + '/' + total + '…';
      givLettersBuildLetter(r, function(built) {
        if (!built) { failed++; next(); return; }
        api('/admin/api/giving/send-statement', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to_email: r.email, to_name: r.recipient_name || r.name,
            subject: givLettersSubject(st.type, st.year, built.churchName),
            html_body: built.html,
            person_id: (r.kind === 'household') ? (r.recipient_person_id || 0) : r.id,
            household_id: (r.kind === 'household') ? r.id : null,
            year: st.year, letter_type: st.type, recipient_key: r.recipient_key
          })
        }).then(function(res) {
          if (res && res.ok) { done++; next(); return; }
          if (res && res.rate_limited) { stopped = true; finish(); return; }
          failed++; next();
        }).catch(function(){ failed++; next(); });
      });
    }
    next();
  });
}
function givLettersPrint() {
  var st = _givLettersState;
  var statusEl = document.getElementById('giv-letters-status');
  var recips = givLettersSelectedRecipients();
  if (!recips.length) { statusEl.textContent = 'No recipients selected.'; statusEl.className = 'import-status err'; return; }
  var loadCfg = (_churchConfig && _churchConfig.church_name)
    ? function(next){ next(); }
    : function(next){ api('/admin/api/config/church').then(function(cfg){ _churchConfig = cfg || {}; next(); }); };
  loadCfg(function() {
    statusEl.textContent = 'Building ' + recips.length + ' letters for print…'; statusEl.className = 'import-status';
    var built = [], i = 0;
    function next() {
      if (i >= recips.length) { finalizePrint(); return; }
      var r = recips[i++];
      givLettersBuildLetter(r, function(b) {
        if (b) built.push({ r: r, html: b.html });
        statusEl.textContent = 'Building ' + built.length + '/' + recips.length + ' letters…';
        next();
      });
    }
    function finalizePrint() {
      if (!built.length) { statusEl.textContent = 'Nothing to print.'; statusEl.className = 'import-status err'; return; }
      var pages = built.map(function(b) {
        return '<div style="page-break-after:always;padding:24px;">' + b.html + '</div>';
      }).join('');
      var w = window.open('', '_blank');
      if (!w) { statusEl.textContent = 'Popup blocked — allow popups to print.'; statusEl.className = 'import-status err'; return; }
      w.document.write('<html><head><title>Giving Letters ' + st.year + '</title></head><body>' + pages
        + '<scr' + 'ipt>window.onload=function(){window.print();};</scr' + 'ipt></body></html>');
      w.document.close();
      // Record each printed letter so the workspace status reflects it.
      var marks = built.map(function(b) {
        return api('/admin/api/giving/letters/mark', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient_key: b.r.recipient_key, year: st.year, letter_type: st.type, channel: 'print',
            person_id: (b.r.kind === 'household') ? (b.r.recipient_person_id || 0) : b.r.id,
            household_id: (b.r.kind === 'household') ? b.r.id : null
          })
        }).catch(function(){});
      });
      Promise.all(marks).then(function() {
        statusEl.textContent = built.length + ' letters sent to print and marked as printed.';
        statusEl.className = 'import-status ok';
        givLettersLoadStatus();
      });
    }
    next();
  });
}
// ── THANK-YOU RECEIPTS (GIV-R4 / A): manual thank-you + recurring-giving nudge ──
// Donations >= threshold ($250 default) or a donor's first-ever gift. Manual send/print,
// per-donation status tracked so nothing double-sends while testing. Reuses the Phase 2
// send-statement + letters/mark endpoints; letter body built client-side from the row.
var _givReceiptsState = { from: '', to: '', threshold: 250, firstGift: true, receipts: [], counts: null };
function givReceiptsInit() {
  var st = _givReceiptsState;
  if (!st.from || !st.to) {
    var now = new Date();
    st.to = now.toISOString().slice(0, 10);
    st.from = now.toISOString().slice(0, 7) + '-01';
  }
  givReceiptsRenderShell();
  givReceiptsLoad();
}
function givReceiptsRenderShell() {
  var root = document.getElementById('giv-receipts-root');
  if (!root) return;
  var st = _givReceiptsState;
  root.innerHTML =
    '<div style="margin-bottom:14px;">'
    +   '<div class="board-title">Thank-You Receipts</div>'
    +   '<div class="board-subtitle">Gifts worth a personal thank-you &middot; manual send &middot; nudge toward recurring giving</div>'
    + '</div>'
    + '<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:end;margin-bottom:14px;">'
    +   '<div class="field" style="margin:0;"><label>From</label><input type="date" id="giv-rcpt-from" value="' + st.from + '" style="font-size:.85rem;padding:5px 8px;" onchange="givReceiptsRefresh()"></div>'
    +   '<div class="field" style="margin:0;"><label>To</label><input type="date" id="giv-rcpt-to" value="' + st.to + '" style="font-size:.85rem;padding:5px 8px;" onchange="givReceiptsRefresh()"></div>'
    +   '<div class="field" style="margin:0;"><label>Threshold ($)</label><input type="number" id="giv-rcpt-threshold" value="' + st.threshold + '" min="0" step="25" style="width:90px;font-size:.85rem;padding:5px 8px;" onchange="givReceiptsRefresh()"></div>'
    +   '<label style="display:flex;align-items:center;gap:6px;font-size:.85rem;cursor:pointer;"><input type="checkbox" id="giv-rcpt-first"' + (st.firstGift ? ' checked' : '') + ' onchange="givReceiptsRefresh()"> Include first-time gifts</label>'
    + '</div>'
    + '<div id="giv-rcpt-status" class="import-status" style="margin-bottom:8px;"></div>'
    + '<div id="giv-rcpt-body"><div class="board-empty">Loading&hellip;</div></div>';
}
function givReceiptsRefresh() {
  var st = _givReceiptsState;
  var f = document.getElementById('giv-rcpt-from'), t = document.getElementById('giv-rcpt-to');
  var th = document.getElementById('giv-rcpt-threshold'), fg = document.getElementById('giv-rcpt-first');
  if (f) st.from = f.value; if (t) st.to = t.value;
  if (th) st.threshold = Math.max(0, parseInt(th.value, 10) || 0);
  if (fg) st.firstGift = fg.checked;
  givReceiptsLoad();
}
function givReceiptsLoad() {
  var st = _givReceiptsState;
  var body = document.getElementById('giv-rcpt-body');
  if (!body) return;
  body.innerHTML = '<div class="board-empty">Loading gifts&hellip;</div>';
  var qs = 'from=' + st.from + '&to=' + st.to + '&threshold_cents=' + (st.threshold * 100) + '&first_gift=' + (st.firstGift ? '1' : '0');
  api('/admin/api/giving/receipts/queue?' + qs).then(function(d) {
    st.receipts = d.receipts || [];
    st.counts = d.counts || { total: 0, sent: 0, unsent: 0, no_email: 0 };
    givReceiptsRenderTable();
  }).catch(function(e) {
    body.innerHTML = '<div class="board-empty">Could not load: ' + esc(e.message) + '</div>';
  });
}
function givReceiptsRenderTable() {
  var st = _givReceiptsState, body = document.getElementById('giv-rcpt-body');
  if (!body) return;
  var recips = st.receipts;
  if (!recips.length) {
    body.innerHTML = '<div class="board-empty">No gifts qualify for ' + esc(st.from) + ' &ndash; ' + esc(st.to) + '. Try a wider date range or a lower threshold.</div>';
    return;
  }
  var c = st.counts;
  var head = '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;">'
    + givLettersStatChip(c.total, 'to thank')
    + givLettersStatChip(c.sent, 'already thanked')
    + givLettersStatChip(c.unsent, 'pending')
    + givLettersStatChip(c.no_email, 'no email')
    + '</div>';
  var th = 'padding:6px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--warm-meta);border-bottom:1.5px solid var(--color-navy);text-align:left;';
  var rows = recips.map(function(r, i) {
    var reasonPills = r.reasons.map(function(rs) {
      var label = rs === 'first_gift' ? 'First gift' : ('Over $' + st.threshold);
      var bg = rs === 'first_gift' ? 'var(--color-gold)' : 'var(--color-teal)';
      return '<span style="display:inline-block;background:' + bg + ';color:var(--white,#fff);font-size:.68rem;padding:1px 6px;border-radius:8px;margin-right:4px;">' + label + '</span>';
    }).join('');
    var statusPill = r.sent
      ? '<span style="font-size:.72rem;color:var(--sage);font-weight:600;">&#10003; thanked</span>'
      : '<span style="font-size:.72rem;color:var(--warm-gray);">pending</span>';
    var actions = '<button class="btn-sm" style="font-size:.68rem;padding:1px 6px;" onclick="givReceiptPreview(' + i + ')">Preview</button> '
      + (r.has_email ? '<button class="btn-sm" style="font-size:.68rem;padding:1px 6px;" onclick="givReceiptSend(' + i + ')">Email</button> ' : '')
      + '<button class="btn-sm" style="font-size:.68rem;padding:1px 6px;" onclick="givReceiptPrint(' + i + ')">Print</button> '
      + '<button class="btn-sm" style="font-size:.68rem;padding:1px 6px;" onclick="givReceiptToggleMark(' + i + ')">' + (r.sent ? 'undo' : 'mark') + '</button>';
    return '<tr style="border-bottom:1px solid var(--border);">'
      + '<td style="padding:6px 8px;font-size:.85rem;">' + esc(r.name)
      +   '<div style="font-size:.74rem;color:var(--warm-gray);">' + (r.email ? esc(r.email) : '<span style="color:var(--danger);">no email</span>') + '</div>'
      +   '<div style="margin-top:2px;">' + reasonPills + '</div></td>'
      + '<td style="padding:6px 8px;font-size:.85rem;text-align:right;white-space:nowrap;">' + fmtMoney(r.amount_cents)
      +   '<div style="font-size:.72rem;color:var(--warm-gray);">' + fmtDate(r.gift_date) + '</div></td>'
      + '<td style="padding:6px 8px;font-size:.8rem;color:var(--warm-gray);">' + esc(r.funds || '') + '</td>'
      + '<td style="padding:6px 8px;font-size:.85rem;text-align:right;white-space:nowrap;">' + fmtMoney(r.suggested_monthly_cents) + '/mo</td>'
      + '<td style="padding:6px 8px;white-space:nowrap;">' + statusPill + '<div style="margin-top:3px;">' + actions + '</div></td>'
      + '</tr>';
  }).join('');
  body.innerHTML = head
    + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">'
    + '<thead><tr>'
    +   '<th style="' + th + '">Donor</th>'
    +   '<th style="' + th + 'text-align:right;">Gift</th>'
    +   '<th style="' + th + '">Fund</th>'
    +   '<th style="' + th + 'text-align:right;">Suggest</th>'
    +   '<th style="' + th + '">Status &amp; actions</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}
// Editable default copy lives here for now; the "impact" sentence is deliberately generic
// until the church supplies its own wording (GIV-R4 follow-up).
function givReceiptLetterHtml(r) {
  var church = (_churchConfig && _churchConfig.church_name) || 'Timothy Lutheran Church';
  var givingUrl = (_churchConfig && _churchConfig.giving_url) || '';
  var isFirst = r.reasons.indexOf('first_gift') >= 0;
  var body = '<p>Dear ' + esc(r.name) + ',</p>'
    + '<p>Thank you for your generous gift of <strong>' + fmtMoney(r.amount_cents) + '</strong> on '
    + fmtDate(r.gift_date) + (r.funds ? ' to ' + esc(r.funds) : '') + '. '
    + 'Your generosity directly supports the ministry and mission of ' + esc(church) + '.</p>'
    + (isFirst ? '<p>We are especially grateful for your first gift &mdash; welcome, and thank you for partnering with us.</p>' : '')
    + '<p>Would you consider making an ongoing impact? A recurring gift of about <strong>' + fmtMoney(r.suggested_monthly_cents) + ' a month</strong> '
    + 'would help sustain our ministries throughout the year and let you give without having to remember each week.'
    + (givingUrl ? ' You can set up automatic monthly giving in about a minute at <a href="' + esc(givingUrl) + '">' + esc(givingUrl) + '</a>.' : '')
    + '</p>'
    + '<p>With gratitude,</p><p>' + esc(church) + '</p>';
  return '<div style="font-family:Georgia,serif;font-size:14px;line-height:1.65;max-width:560px;">'
    + letterheadImgHtml(true, church, 'font-size:16px;font-weight:bold;', 6) + '<hr style="margin:10px 0;">'
    + body + '</div>';
}
function givReceiptSubject(r) {
  var church = (_churchConfig && _churchConfig.church_name) || 'Timothy Lutheran Church';
  return 'Thank you for your gift — ' + church;
}
function givReceiptWithCfg(next) {
  if (_churchConfig && _churchConfig.church_name) { next(); return; }
  api('/admin/api/config/church').then(function(cfg) { _churchConfig = cfg || {}; next(); });
}
function givReceiptPreview(i) {
  var r = _givReceiptsState.receipts[i];
  if (!r) return;
  givReceiptWithCfg(function() {
    var w = window.open('', '_blank');
    if (!w) { alert('Allow popups to preview the letter.'); return; }
    w.document.write('<html><head><title>Thank-You Preview</title></head><body style="margin:24px;">' + givReceiptLetterHtml(r) + '</body></html>');
    w.document.close();
  });
}
function givReceiptSend(i) {
  var r = _givReceiptsState.receipts[i];
  if (!r || !r.has_email) return;
  var statusEl = document.getElementById('giv-rcpt-status');
  givReceiptWithCfg(function() {
    statusEl.textContent = 'Emailing ' + r.name + '…'; statusEl.className = 'import-status';
    api('/admin/api/giving/send-statement', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to_email: r.email, to_name: r.name, subject: givReceiptSubject(r),
        html_body: givReceiptLetterHtml(r),
        person_id: r.person_id, household_id: r.household_id,
        year: parseInt((r.gift_date || '').slice(0, 4), 10) || new Date().getFullYear(),
        letter_type: 'thank_you', recipient_key: r.recipient_key
      })
    }).then(function(res) {
      if (res && res.ok) { statusEl.textContent = 'Thank-you emailed to ' + r.name + '.'; statusEl.className = 'import-status ok'; givReceiptsLoad(); }
      else if (res && res.rate_limited) { statusEl.textContent = "Brevo's sending limit was hit — try again later."; statusEl.className = 'import-status err'; }
      else { statusEl.textContent = 'Send failed: ' + (res && res.error || 'unknown'); statusEl.className = 'import-status err'; }
    }).catch(function(e) { statusEl.textContent = 'Send failed: ' + e.message; statusEl.className = 'import-status err'; });
  });
}
function givReceiptPrint(i) {
  var r = _givReceiptsState.receipts[i];
  if (!r) return;
  givReceiptWithCfg(function() {
    var w = window.open('', '_blank');
    if (!w) { alert('Allow popups to print.'); return; }
    w.document.write('<html><head><title>Thank-You Letter</title></head><body style="margin:24px;">'
      + givReceiptLetterHtml(r)
      + '<scr' + 'ipt>window.onload=function(){window.print();};</scr' + 'ipt></body></html>');
    w.document.close();
    api('/admin/api/giving/letters/mark', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient_key: r.recipient_key, letter_type: 'thank_you', channel: 'print',
        year: parseInt((r.gift_date || '').slice(0, 4), 10) || new Date().getFullYear(),
        person_id: r.person_id, household_id: r.household_id
      })
    }).then(function() { givReceiptsLoad(); }).catch(function() {});
  });
}
function givReceiptToggleMark(i) {
  var r = _givReceiptsState.receipts[i];
  if (!r) return;
  var yr = parseInt((r.gift_date || '').slice(0, 4), 10) || new Date().getFullYear();
  function mark(channel) {
    return api('/admin/api/giving/letters/mark', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient_key: r.recipient_key, letter_type: 'thank_you', channel: channel, year: yr,
        unmark: !!r.sent, person_id: r.person_id, household_id: r.household_id
      })
    });
  }
  // Marking records one channel (email); un-marking clears both, since the queue counts a
  // gift thanked on any channel.
  var ops = r.sent ? [mark('email'), mark('print')] : [mark('email')];
  Promise.all(ops).then(function() { givReceiptsLoad(); }).catch(function() {});
}

// ── GIVING ANALYSIS (GIV-R3): distribution + multi-year inflation-adjusted trend ──
function givAnalysisInit() {
  var yrEl = document.getElementById('giv-analysis-year');
  if (yrEl && !yrEl.value) yrEl.value = new Date().getFullYear();
  givAnalysisLoad();
}
function givAnalysisLoad() {
  var yr = parseInt((document.getElementById('giv-analysis-year') || {}).value, 10) || new Date().getFullYear();
  var distEl = document.getElementById('giv-analysis-dist');
  var trendEl = document.getElementById('giv-analysis-trend');
  if (distEl) distEl.innerHTML = '<div class="board-empty">Loading distribution&hellip;</div>';
  if (trendEl) trendEl.innerHTML = '<div class="board-empty">Loading trend&hellip;</div>';
  api('/admin/api/reports/giving-distribution?year=' + yr + '&scope=household')
    .then(function(d) { givRenderDistribution(d); })
    .catch(function(e) { if (distEl) distEl.innerHTML = '<div class="board-empty">Could not load distribution: ' + esc(e.message) + '</div>'; });
  api('/admin/api/reports/giving-multiyear?end=' + yr + '&years=5')
    .then(function(d) { givRenderMultiyear(d); })
    .catch(function(e) { if (trendEl) trendEl.innerHTML = '<div class="board-empty">Could not load trend: ' + esc(e.message) + '</div>'; });
}
function givAnalysisChip(label, val, sub) {
  return '<div style="background:var(--white,#fff);border:1px solid var(--border);border-radius:8px;padding:10px 16px;min-width:110px;">'
    + '<div style="font-size:1.3rem;font-weight:700;color:var(--color-navy);">' + val + '</div>'
    + '<div style="font-size:.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.04em;">' + esc(label) + '</div>'
    + (sub ? '<div style="font-size:.72rem;color:var(--warm-meta);margin-top:2px;">' + esc(sub) + '</div>' : '')
    + '</div>';
}
function givRenderDistribution(d) {
  var el = document.getElementById('giv-analysis-dist');
  if (!el) return;
  if (!d || !d.givers) {
    el.innerHTML = '<h3 style="margin-top:0;">&#128202; Giving Distribution</h3><div class="board-empty">No giving recorded for ' + (d && d.year ? d.year : '') + '.</div>';
    return;
  }
  var chips = givAnalysisChip('Giving households', d.givers.toLocaleString())
    + givAnalysisChip('Total', fmtMoney(d.total_cents))
    + givAnalysisChip('Mean gift/yr', fmtMoney(d.mean_cents))
    + givAnalysisChip('Median gift/yr', fmtMoney(d.median_cents), 'the typical household')
    + givAnalysisChip('Top 10% share', d.top10_share_pct + '%', d.top10_givers + ' households');
  var th = 'padding:6px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--warm-meta);border-bottom:1.5px solid var(--color-navy);';
  var maxTotal = 0;
  (d.tiers || []).forEach(function(t) { if (t.total_cents > maxTotal) maxTotal = t.total_cents; });
  var rows = (d.tiers || []).filter(function(t){ return t.givers > 0; }).map(function(t) {
    var barW = maxTotal ? Math.round((t.total_cents / maxTotal) * 100) : 0;
    return '<tr style="border-bottom:1px solid var(--border);">'
      + '<td style="padding:6px 8px;font-size:.85rem;white-space:nowrap;">' + esc(t.label) + '</td>'
      + '<td style="padding:6px 8px;font-size:.85rem;text-align:right;">' + t.givers + '</td>'
      + '<td style="padding:6px 8px;font-size:.8rem;text-align:right;color:var(--warm-gray);">' + t.givers_pct + '%</td>'
      + '<td style="padding:6px 8px;font-size:.85rem;text-align:right;white-space:nowrap;">' + fmtMoney(t.total_cents) + '</td>'
      + '<td style="padding:6px 8px;width:38%;">'
      +   '<div style="background:var(--linen,#eee);border-radius:3px;height:14px;position:relative;">'
      +     '<div style="background:var(--color-teal);height:14px;border-radius:3px;width:' + barW + '%;"></div></div>'
      +   '<div style="font-size:.72rem;color:var(--warm-gray);margin-top:1px;">' + t.total_pct + '% of total</div>'
      + '</td></tr>';
  }).join('');
  el.innerHTML = '<h3 style="margin-top:0;">&#128202; Giving Distribution &middot; ' + d.year + '</h3>'
    + '<p style="font-size:.82rem;color:var(--warm-gray);margin:0 0 12px;">Households grouped by their full-year giving. The <strong>median</strong> is the honest &ldquo;typical&rdquo; gift &mdash; a few large gifts pull the mean up.</p>'
    + '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">' + chips + '</div>'
    + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">'
    + '<thead><tr>'
    +   '<th style="' + th + 'text-align:left;">Annual giving</th>'
    +   '<th style="' + th + 'text-align:right;">Households</th>'
    +   '<th style="' + th + 'text-align:right;">%</th>'
    +   '<th style="' + th + 'text-align:right;">Total</th>'
    +   '<th style="' + th + 'text-align:left;">Share of total</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}
function givRenderMultiyear(d) {
  var el = document.getElementById('giv-analysis-trend');
  if (!el) return;
  var years = (d && d.years) || [];
  if (!years.length) { el.innerHTML = '<h3 style="margin-top:0;">&#128200; Five-Year Trend</h3><div class="board-empty">No data.</div>'; return; }
  var base = d.base_year;
  var anyEst = years.some(function(y){ return y.cpi_estimated; });
  var chart = renderGroupedBarChart({
    groups: years.map(function(y){ return { key: String(y.year), label: String(y.year) }; }),
    series: [
      { key: 'nominal',  label: 'Actual dollars',            color: 'var(--color-navy)' },
      { key: 'adjusted', label: base + ' dollars (inflation-adjusted)', color: 'var(--color-gold)' }
    ],
    value: function(gk, sk) {
      var row = years.filter(function(y){ return String(y.year) === gk; })[0];
      if (!row) return null;
      return (sk === 'nominal' ? row.total_cents : row.adjusted_cents) / 100;
    },
    tooltip: function(gk, sk, v) {
      var s = sk === 'nominal' ? 'Actual' : ('In ' + base + ' dollars');
      return s + ' ' + gk + ': $' + Math.round(v).toLocaleString();
    },
    barLabel: function(v) { return '$' + Math.round(v / 1000) + 'k'; },
    chartH: 200
  });
  var th = 'padding:6px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--warm-meta);border-bottom:1.5px solid var(--color-navy);';
  var rows = years.map(function(y) {
    return '<tr style="border-bottom:1px solid var(--border);">'
      + '<td style="padding:6px 8px;font-size:.85rem;">' + y.year + (y.cpi_estimated ? ' <span style="color:var(--warm-meta);font-size:.7rem;">est.</span>' : '') + '</td>'
      + '<td style="padding:6px 8px;font-size:.85rem;text-align:right;">' + y.givers + '</td>'
      + '<td style="padding:6px 8px;font-size:.85rem;text-align:right;white-space:nowrap;">' + fmtMoney(y.total_cents) + '</td>'
      + '<td style="padding:6px 8px;font-size:.85rem;text-align:right;white-space:nowrap;">' + fmtMoney(y.avg_giver_cents) + '</td>'
      + '<td style="padding:6px 8px;font-size:.85rem;text-align:right;white-space:nowrap;color:var(--warm-gray);">' + fmtMoney(y.adjusted_cents) + '</td>'
      + '</tr>';
  }).join('');
  el.innerHTML = '<h3 style="margin-top:0;">&#128200; Five-Year Trend' + (base ? ' &middot; through ' + base : '') + '</h3>'
    + '<p style="font-size:.82rem;color:var(--warm-gray);margin:0 0 10px;">Actual giving vs. the same totals restated in ' + base + ' dollars (CPI-U). If the gold bars are flat while the navy bars rise, giving is only keeping pace with inflation.</p>'
    + (chart || '')
    + '<div style="overflow-x:auto;margin-top:10px;"><table style="width:100%;border-collapse:collapse;">'
    + '<thead><tr>'
    +   '<th style="' + th + 'text-align:left;">Year</th>'
    +   '<th style="' + th + 'text-align:right;">Givers</th>'
    +   '<th style="' + th + 'text-align:right;">Total</th>'
    +   '<th style="' + th + 'text-align:right;">Avg / giver</th>'
    +   '<th style="' + th + 'text-align:right;">In ' + base + ' $</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
    + (anyEst ? '<div style="font-size:.72rem;color:var(--warm-meta);margin-top:6px;">&ldquo;est.&rdquo; years use an estimated CPI until the BLS annual average is published.</div>' : '');
}
function givLettersToggleMark(i) {
  var st = _givLettersState;
  var r = st.recipients[i];
  if (!r) return;
  api('/admin/api/giving/letters/mark', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient_key: r.recipient_key, year: st.year, letter_type: st.type, channel: st.channel,
      unmark: !!r.sent,
      person_id: (r.kind === 'household') ? (r.recipient_person_id || 0) : r.id,
      household_id: (r.kind === 'household') ? r.id : null
    })
  }).then(function() { givLettersLoadStatus(); }).catch(function(){});
}

`;
