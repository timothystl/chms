export const JS_GIVING = String.raw`<script>
// ── GIVING ────────────────────────────────────────────────────────────
// ── Giving sub-nav: Offerings · Reports · Communications · Settings ────
// Eight tabs collapsed to four (giving consolidation). The three counting/posting/banking
// tabs are one job, so they became panes inside Offerings; Board Report and Analysis are both
// "explain giving with numbers", so they became modes of one Reports view.
var _givView = 'offerings';
var _GIV_VIEWS = ['offerings','reports','comms','settings'];
// Old view names stay live: a bookmark, a "Go to Letters" button elsewhere in the app, or a
// deep link from another tab must land somewhere real, not on a blank panel.
var _GIV_VIEW_ALIASES = {
  batches: 'offerings', transactions: 'offerings', deposits: 'offerings',
  board: 'reports', analysis: 'reports',
  letters: 'comms', receipts: 'comms', nudges: 'comms',
};
var _GIV_ALIAS_PANE = {
  batches: 'batches', transactions: 'transactions', deposits: 'deposits',
  letters: 'letters', receipts: 'receipts', nudges: 'nudges',
};
function givSetView(view) {
  // Resolve an old name to its new home, and remember which pane inside it the caller meant.
  var pane = _GIV_ALIAS_PANE[view] || '';
  var mode = (view === 'analysis') ? 'analysis' : '';
  if (_GIV_VIEW_ALIASES[view]) view = _GIV_VIEW_ALIASES[view];
  if (_GIV_VIEWS.indexOf(view) < 0) view = 'offerings';
  // Reports and Communications are .require-finance: applyPermissionUI() hides them by setting
  // an inline display:none, which the loop below would otherwise cheerfully undo. The server
  // gates the data either way — this just stops an alias or a stale deep link from parking an
  // office-level user on an empty panel. Offerings has no such requirement, so it's the fallback.
  if (givViewNeedsFinance(view) && !givCanSeeFinance()) view = 'offerings';
  _givView = view;
  _GIV_VIEWS.forEach(function(v) {
    var btn = document.getElementById('giv-view-' + v + '-btn');
    if (btn) btn.classList.toggle('active', v === view);
    var panel = document.getElementById('giv-view-' + v);
    if (panel) panel.style.display = (v === view) ? '' : 'none';
  });
  if (view === 'offerings') {
    givOffSetPane(pane || _givOffPane);
    givLoadWorkQueue();
  }
  if (view === 'reports') {
    if (mode) boardSetMode(mode);
    loadBoardReport();
    givPopulateFundSelect('rpt-plateau-fund');
    givPopulateFundSelect('rpt-bands-fund');
    var curYr = new Date().getFullYear();
    var platYr = document.getElementById('rpt-plateau-year');
    if (platYr && !platYr.value) platYr.value = curYr;
    var bandsYr = document.getElementById('rpt-bands-year');
    if (bandsYr && !bandsYr.value) bandsYr.value = curYr;
    givAnalysisInit();
    finInitGivingReports();
  }
  if (view === 'comms') givCommsSetPane(pane || _givCommsPane);
  if (view === 'settings') { loadGivingSettings(); givLoadFundCategories(); }
}

// ── Offerings panes ────────────────────────────────────────────────────
// "Batches & deposits" is the workflow; the other two are the older flat tables, kept because
// they answer questions the master/detail can't (every gift in a date range; a deposit built
// from individual gifts rather than whole batches).
var _givOffPane = 'batches';
// The display value each pane is restored to. '' lets the CSS class decide (.giv-off-layout is
// already display:grid); .giv-txn-view only sets flex-* properties, so it needs the flex itself.
var _GIV_OFF_PANES = { batches: '', transactions: 'flex', deposits: '' };
// permView lives in js-core.js, which is concatenated ahead of this module; the typeof guard
// covers a non-browser harness that loads this file on its own.
function givCanSeeFinance() {
  return (typeof permView !== 'function') || permView('giving');
}
function givViewNeedsFinance(view) { return view === 'reports' || view === 'comms'; }

function givOffSetPane(pane) {
  if (!(pane in _GIV_OFF_PANES)) pane = 'batches';
  if (pane === 'deposits' && !givCanSeeFinance()) pane = 'batches';
  _givOffPane = pane;
  Object.keys(_GIV_OFF_PANES).forEach(function(p) {
    var el = document.getElementById('giv-pane-' + p);
    if (el) el.style.display = (p === pane) ? (_GIV_OFF_PANES[p] || '') : 'none';
  });
  document.querySelectorAll('[data-gop]').forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-gop') === pane);
  });
  if (pane === 'batches') loadBatches();
  if (pane === 'transactions') { givTxnPopulateFundOptions(); loadGivingTransactions(); }
  if (pane === 'deposits') loadDeposits();
}

var _givCommsPane = 'letters';
var _GIV_COMMS_PANES = ['letters', 'receipts', 'nudges'];
function givCommsSetPane(pane) {
  if (_GIV_COMMS_PANES.indexOf(pane) < 0) pane = 'letters';
  _givCommsPane = pane;
  _GIV_COMMS_PANES.forEach(function(p) {
    var el = document.getElementById('giv-pane-' + p);
    if (el) el.style.display = (p === pane) ? '' : 'none';
  });
  document.querySelectorAll('[data-gcomm]').forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-gcomm') === pane);
  });
  if (pane === 'letters') givLettersInit();
  else if (pane === 'receipts') givReceiptsInit();
  else givNudgesInit();
}

// ── Offerings work queue ───────────────────────────────────────────────
// Four live counts, re-read every time anything in the workflow changes, so the queue can
// never claim work that's already done.
function givQueueCard(accent, label, value, sub) {
  return '<div class="giv-queue-card" style="border-left-color:' + accent + ';">'
    + '<div class="giv-queue-label">' + esc(label) + '</div>'
    + '<div class="giv-queue-value">' + value + '</div>'
    + '<div class="giv-queue-sub">' + sub + '</div></div>';
}
function givLoadWorkQueue() {
  var el = document.getElementById('giv-queue');
  if (!el) return;
  api('/admin/api/giving/offerings-summary').then(function(d) {
    if (!d || d.error) { el.innerHTML = ''; return; }
    var ob = d.open_batches || {}, aw = d.awaiting_deposit || {}, un = d.unreconciled_deposits || {}, fe = d.fees_ytd || {};
    el.innerHTML =
      givQueueCard('#C9973A', 'Open batches', (ob.count || 0),
        fmtMoney(ob.cents || 0) + ' counted, not posted')
      + givQueueCard('#2E7EA6', 'Awaiting deposit', (aw.count || 0) + ' batch' + ((aw.count === 1) ? '' : 'es'),
        fmtMoney(aw.cents || 0) + ' not yet at the bank &middot; last ' + (aw.days || 90) + ' days')
      + givQueueCard('#B85C3A', 'Unreconciled deposits', (un.count || 0),
        un.count ? (un.earliest_date ? fmtDate(un.earliest_date) + ' &middot; bank amount not entered' : 'Bank amount not entered')
                 : 'Every deposit matched to the bank')
      + givQueueCard('#6B8F71', 'Processing fees YTD', fmtMoney(fe.cents || 0),
        'Given &minus; deposited, all deposits');
  }).catch(function() { el.innerHTML = ''; });
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

// What a deposit holds, in its own terms: whole batches (the Offerings workflow) or individual
// gifts (the older per-gift flow). Saying "0 gifts" about a deposit built from two batches is
// what made the two screens look like they disagreed.
function depHoldsLabel(d) {
  var batches = d.batch_count || 0;
  if (batches > 0) return batches + ' batch' + ((batches === 1) ? '' : 'es');
  var gifts = d.gift_count || 0;
  return gifts + ' gift' + ((gifts === 1) ? '' : 's');
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
    // given_cents is the server's lines-else-gifts figure. Reading gross_cents (the per-gift
    // assignment total) instead reported $0 given for every deposit built from the Offerings
    // batch panel, and a fee of minus the entire bank amount.
    var gross = (d.given_cents != null) ? d.given_cents : (d.gross_cents || 0);
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
      + depSourceLabel(d.source) + ' &middot; ' + depHoldsLabel(d) + ' &middot; ' + fmtMoney(gross) + '</div>'
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
  var gross = (d.given_cents != null) ? d.given_cents : ((d.totals && d.totals.gross_cents) || 0);
  var recordedFees = (d.totals && d.totals.fee_cents) || 0;
  var lines = d.lines || [];
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

  if (lines.length) {
    html += '<h4 style="margin:0 0 8px;">Batches in this deposit</h4>';
    html += '<div style="overflow-x:auto;"><table class="entries-table"><thead><tr><th>Date</th><th>Batch</th><th class="amt-col">From this batch</th></tr></thead><tbody>'
      + lines.map(function(l) {
          return '<tr onclick="goToBatch(' + l.batch_id + ')" style="cursor:pointer;"><td>' + fmtDate(l.batch_date) + '</td><td>' + esc(l.description || '') + '</td>'
            + '<td class="amt-col">' + fmtMoney(l.amount_cents) + '</td></tr>';
        }).join('')
      + '</tbody></table></div>';
    html += '<div style="font-size:.78rem;color:var(--warm-gray);margin:6px 0 14px;">Edit these amounts from the batch itself &mdash; Offerings &rarr; the batch &rarr; Bank deposits.</div>';
  }
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
  var gross = (d.given_cents != null) ? d.given_cents : ((d.totals && d.totals.gross_cents) || 0);
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
  tbody.innerHTML = '<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--warm-gray);">Loading&#8230;</td></tr>';
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
      tbody.innerHTML = '<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--warm-gray);">No transactions match these filters.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function(r) {
      return '<tr onclick="goToBatch(' + r.batch_id + ')" style="cursor:pointer;">'
        + '<td>' + esc(r.person_name) + '</td>'
        + '<td>' + esc(r.fund_name) + '</td>'
        + '<td>' + esc(r.method) + (r.check_number ? ' #'+esc(r.check_number) : '') + '</td>'
        + '<td>' + fmtDate(r.txn_date) + '</td>'
        + '<td>' + (r.deposit_label ? esc(r.deposit_label) : '<span style="color:var(--warm-gray);">not deposited</span>') + '</td>'
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
  // "Needs work" is a client-side view of the derived status, not a server status column —
  // the server has no notion of a batch being "done", only of what it is and isn't linked to.
  var status = (_batchFilter === 'needswork') ? 'all' : _batchFilter;
  api('/admin/api/giving/batches?status=' + status).then(function(d) {
    _lastBatches = d.batches || [];
    renderBatchList(_lastBatches);
    if (pendingId) openBatch(pendingId);
  });
}
// Status badge markup from the server-derived {key,tone,label,remaining_cents}. Split carries
// its remaining amount in the label so the list says how much is still outstanding, not just
// that something is.
function givStatusBadge(st) {
  if (!st) return '';
  var label = st.label + (st.key === 'split' ? ' &middot; ' + fmtMoney(st.remaining_cents || 0) + ' left' : '');
  return '<span class="giv-badge giv-badge-' + (st.tone || 'warn') + '">' + label + '</span>';
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
  if (!c) return;
  var filtered = _batchSearch
    ? batches.filter(function(b) {
        return (b.description||'').toLowerCase().indexOf(_batchSearch) >= 0
            || (b.batch_date||'').indexOf(_batchSearch) >= 0;
      })
    : batches;
  if (_batchFilter === 'needswork') {
    filtered = filtered.filter(function(b) {
      return !b.closed || !b.deposit_status || b.deposit_status.key !== 'deposited';
    });
  }
  if (!filtered.length) {
    c.innerHTML = '<div style="padding:30px 16px;text-align:center;color:var(--warm-gray);font-size:.84rem;">'
      + (_batchSearch ? 'No batches match &#8220;' + esc(_batchSearch) + '&#8221;'
         : (_batchFilter === 'needswork' ? 'Nothing needs work &mdash; every batch is posted and deposited.' : 'No batches yet')) + '</div>';
    return;
  }
  c.innerHTML = filtered.map(function(b) {
    var cls = 'giv-off-row' + (b.id === currentBatchId ? ' selected' : '');
    var posted = b.closed ? 'posted' : 'open';
    return '<div class="' + cls + '" data-batch-row="' + b.id + '" onclick="openBatch(' + b.id + ')">'
      + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;">'
      + '<span style="font-size:.88rem;font-weight:700;color:var(--color-navy);">' + esc(b.description || fmtDate(b.batch_date)) + '</span>'
      + '<span style="font-size:.88rem;font-weight:700;font-variant-numeric:tabular-nums;">' + fmtMoney(b.total_cents||0) + '</span></div>'
      + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-top:3px;">'
      + '<span style="font-size:.72rem;color:var(--warm-gray);">' + fmtDate(b.batch_date) + ' &middot; ' + (b.entry_count||0) + ' gift' + ((b.entry_count === 1) ? '' : 's') + ' &middot; ' + posted + '</span>'
      + givStatusBadge(b.deposit_status) + '</div></div>';
  }).join('');
}
function openBatch(id) {
  currentBatchId = id;
  // Highlight selected row
  document.querySelectorAll('.giv-off-row').forEach(function(r) {
    r.classList.toggle('selected', r.getAttribute('data-batch-row') === String(id));
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

  // Fund split line — what the count sheet actually breaks into, so the total bar answers
  // "how much" and "to what" together.
  var byFund = {}, fundOrder = [];
  (b.entries||[]).forEach(function(e) {
    var n = e.fund_name || 'Unassigned';
    if (!(n in byFund)) { byFund[n] = 0; fundOrder.push(n); }
    byFund[n] += (e.amount || 0);
  });
  var splitLine = fundOrder.length
    ? '<div style="font-size:.78rem;color:var(--warm-gray);flex-basis:100%;">'
      + fundOrder.map(function(n) { return esc(n) + ' ' + fmtMoney(byFund[n]); }).join(' &middot; ') + '</div>'
    : '';

  c.innerHTML = '<div class="batch-detail-hdr">'
    + '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
    + '<div><div style="font-family:var(--font-head);font-size:1.05rem;font-weight:700;color:var(--steel-anchor);">' + esc(b.description) + '</div>'
    + '<div style="font-size:.78rem;color:var(--warm-gray);">' + fmtDate(b.batch_date) + ' &middot; ' + (b.entries||[]).length + ' gift' + (((b.entries||[]).length === 1) ? '' : 's') + '</div></div>'
    + '<span class="' + (b.closed ? 'badge-closed' : 'badge-open') + '">' + (b.closed ? 'Closed' : 'Open') + '</span>'
    + givStatusBadge(b.deposit_status)
    + actionBtns + '</div></div>'
    + '<div class="total-bar" style="flex-wrap:wrap;"><span style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--warm-gray);">Batch total</span>'
    + '<span style="font-size:1.15rem;font-weight:800;color:var(--color-navy);font-variant-numeric:tabular-nums;">' + fmtMoney(total) + '</span>'
    + splitLine + '</div>'
    + entryForm
    + '<div style="overflow-x:auto;"><table class="entries-table"><thead><tr><th>Person</th><th>Fund</th><th class="amt-col">Amount</th><th>Method</th><th></th></tr></thead><tbody id="entry-tbody">' + entryRows + '</tbody></table></div>'
    + '<div id="giv-dep-panel-mount"></div>';

  // Wire up check# toggle
  c.querySelectorAll('input[name="e-method"]').forEach(function(r) {
    r.addEventListener('change', function() {
      document.getElementById('e-check-wrap').style.display = this.value === 'check' ? 'flex' : 'none';
    });
  });
  renderBatchDepositPanel(b);
}

// ── Bank deposits panel (batch ↔ deposit linking) ──────────────────────
// A batch can be split across several deposits, and a deposit can hold several batches. The
// links live here, inside the batch, so the count sheet and the bank slip never drift apart —
// and the reverse direction ("what else is on this slip?") is visible without leaving the batch.
function renderBatchDepositPanel(b) {
  var mount = document.getElementById('giv-dep-panel-mount');
  if (!mount) return;
  var total = b.total_cents != null ? b.total_cents : (b.entries||[]).reduce(function(s,e){return s+(e.amount||0);},0);
  var links = b.deposits || [];
  var st = b.deposit_status || {};
  var linked = st.linked_cents || 0;
  var remaining = Math.max(0, total - linked);

  // Coverage bar: one segment per linked deposit, the uncovered remainder left as bare track.
  var segColors = ['#2E7EA6', '#6B8F71', '#C9973A'];
  var segs = links.map(function(l, i) {
    var w = total > 0 ? Math.max(0, Math.min(100, (l.amount_cents / total) * 100)) : 0;
    return '<div class="giv-cover-seg" style="width:' + w.toFixed(2) + '%;background:' + segColors[i % segColors.length] + ';"></div>';
  }).join('');
  var caption = links.length
    ? fmtMoney(total) + ' counted &middot; ' + links.map(function(l) {
        return fmtMoney(l.amount_cents) + ' in ' + esc(givDepRef(l));
      }).join(' &middot; ') + (remaining > 50 ? ' &middot; ' + fmtMoney(remaining) + ' not yet deposited' : '')
    : fmtMoney(total) + ' counted &middot; not in a deposit yet';

  var cards = links.map(function(l) { return givDepLinkCard(b.id, l); }).join('');

  var shortfall = (remaining > 50)
    ? '<div class="giv-dep-shortfall"><span>' + fmtMoney(remaining) + ' of this batch isn&rsquo;t in any deposit yet'
      + (links.length ? ' &mdash; a second bank run, or still in the safe.' : '.') + '</span>'
      + '<button class="btn-primary" style="padding:5px 12px;font-size:.8rem;margin-left:auto;" onclick="givDepNewForBatch(' + b.id + ')">Assign the rest to a new deposit</button></div>'
    : '';

  mount.innerHTML = '<div class="giv-dep-panel">'
    + '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px;">'
    + '<span class="giv-dep-panel-label">Bank deposits</span>' + givStatusBadge(st)
    + '<span style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
    + '<select class="fin-domain-select" id="giv-dep-add-select" onchange="givDepAddExisting(' + b.id + ', this)"><option value="">Add this batch to an existing deposit&hellip;</option></select>'
    + '<button class="btn-primary" style="padding:6px 12px;font-size:.8rem;" onclick="givDepNewForBatch(' + b.id + ')">+ New deposit</button>'
    + '</span></div>'
    + '<div class="giv-cover-track">' + segs + '</div>'
    + '<div class="giv-cover-caption">' + caption + '</div>'
    + '<div style="margin-top:12px;">' + cards + '</div>'
    + shortfall
    + '<div style="font-size:11.5px;color:var(--warm-gray);margin-top:10px;">A batch can be split across several deposits, and a deposit can hold several batches &mdash; the links live here, so the count sheet and the bank slip never drift apart.</div>'
    + '</div>';
  givDepLoadOptions(b.id);
}

// Human reference for a deposit — it has no ref column of its own, so it reads as its date.
function givDepRef(l) {
  return l.external_ref ? l.external_ref : ('Deposit ' + (l.deposit_date ? fmtDate(l.deposit_date) : '#' + l.deposit_id));
}

function givDepLinkCard(batchId, l) {
  var bank = (l.bank_cents === null || l.bank_cents === undefined) ? null : l.bank_cents;
  var given = l.deposit_given_cents || 0;
  var fees = (bank === null) ? null : (given - bank);
  var badge = (bank === null)
    ? '<span class="giv-badge giv-badge-bad">Bank amount missing</span>'
    : '<span class="giv-badge giv-badge-ok">Reconciled</span>';
  var others = (l.other_batches || []).length
    ? 'Also in this deposit: ' + l.other_batches.map(function(o) {
        return esc(fmtDate(o.batch_date) + ' · ' + (o.description || 'Batch')) + ' ' + fmtMoney(o.amount_cents);
      }).join(', ')
    : 'This deposit holds only this batch.';
  return '<div class="giv-dep-card">'
    + '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
    + '<span style="font-size:.9rem;font-weight:700;color:var(--color-navy);">' + esc(givDepRef(l)) + '</span>'
    + '<span style="font-size:.78rem;color:var(--warm-gray);">deposited ' + (l.deposit_date ? fmtDate(l.deposit_date) : '&mdash;') + '</span>'
    + badge
    + '<button class="giv-dep-remove" style="margin-left:auto;" onclick="givDepRemoveLine(' + batchId + ',' + l.deposit_id + ')">Remove this batch</button>'
    + '</div>'
    + '<div class="giv-dep-linkrow">'
    + '<div class="giv-dep-field"><label class="giv-dep-field-label">From this batch</label>'
    + '<input type="text" inputmode="decimal" style="width:100px;" id="giv-dep-line-' + l.deposit_id + '" value="' + (l.amount_cents / 100).toFixed(2) + '" onchange="givDepSaveLine(' + batchId + ',' + l.deposit_id + ')"></div>'
    + '<div class="giv-dep-field"><label class="giv-dep-field-label">Deposit total given</label>'
    + '<div style="font-size:.9rem;font-weight:700;font-variant-numeric:tabular-nums;padding:5px 0;">' + fmtMoney(given) + '</div></div>'
    + '<div class="giv-dep-field"><label class="giv-dep-field-label">Bank received</label>'
    + '<input type="text" inputmode="decimal" style="width:110px;" id="giv-dep-bank-' + l.deposit_id + '" placeholder="0.00" value="' + (bank === null ? '' : (bank / 100).toFixed(2)) + '" onchange="givDepSaveBank(' + batchId + ',' + l.deposit_id + ')"></div>'
    + '<div class="giv-dep-field"><label class="giv-dep-field-label">Fees</label>'
    + '<div style="font-size:.9rem;font-weight:700;font-variant-numeric:tabular-nums;padding:5px 0;color:' + (fees === null ? 'var(--warm-gray)' : '#B85C3A') + ';">' + (fees === null ? '&mdash;' : fmtMoney(fees)) + '</div></div>'
    + '</div>'
    + '<div style="font-size:11.5px;color:var(--warm-gray);margin-top:8px;">' + others + '</div>'
    + '</div>';
}

// Amounts are typed as plain numbers ("7100", "$7,100.00") — parse leniently rather than
// rejecting anything that isn't already canonical.
function givParseMoneyCents(raw) {
  var v = String(raw == null ? '' : raw).replace(/[$,\s]/g, '');
  if (v === '') return null;
  var n = parseFloat(v);
  if (isNaN(n)) return null;
  return Math.round(n * 100);
}

function givDepLoadOptions(batchId) {
  var sel = document.getElementById('giv-dep-add-select');
  if (!sel) return;
  api('/admin/api/giving/deposit-options?batch_id=' + batchId).then(function(d) {
    var deps = (d && d.deposits) || [];
    if (!document.getElementById('giv-dep-add-select')) return; // panel re-rendered under us
    var s = document.getElementById('giv-dep-add-select');
    s.innerHTML = '<option value="">Add this batch to an existing deposit&hellip;</option>'
      + deps.map(function(x) {
          var label = (x.external_ref || ('Deposit ' + (x.deposit_date ? fmtDate(x.deposit_date) : '#' + x.id)))
            + ' · ' + fmtMoney(x.given_cents || 0) + ' from ' + (x.batch_count || 0) + ' batch' + ((x.batch_count === 1) ? '' : 'es');
          return '<option value="' + x.id + '">' + esc(label) + '</option>';
        }).join('');
  }).catch(function() {});
}

// Choosing a deposit links this batch to it with the REMAINING undeposited amount prefilled —
// the amount someone would otherwise have to compute by hand from the coverage caption.
function givDepAddExisting(batchId, sel) {
  var depId = parseInt(sel.value);
  sel.value = '';
  if (!Number.isInteger(depId)) return;
  var remaining = givBatchRemainingCents();
  api('/admin/api/giving/deposit-lines', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deposit_id: depId, batch_id: batchId, amount_cents: remaining }) })
    .then(function(r) { if (r && r.error) { alert(r.error); return; } givOffRefresh(batchId); })
    .catch(function() { alert('Could not add this batch to that deposit.'); });
}

function givBatchRemainingCents() {
  var b = _currentBatch || {};
  var total = b.total_cents != null ? b.total_cents : (b.entries||[]).reduce(function(s,e){return s+(e.amount||0);},0);
  var linked = (b.deposit_status && b.deposit_status.linked_cents) || 0;
  return Math.max(0, total - linked);
}

function givDepNewForBatch(batchId) {
  var today = new Date().toISOString().slice(0, 10);
  api('/admin/api/giving/deposits', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deposit_date: today, batch_id: batchId, amount_cents: givBatchRemainingCents() }) })
    .then(function(r) { if (r && r.error) { alert(r.error); return; } givOffRefresh(batchId); })
    .catch(function() { alert('Could not create the deposit.'); });
}

function givDepSaveLine(batchId, depositId) {
  var inp = document.getElementById('giv-dep-line-' + depositId);
  var cents = givParseMoneyCents(inp && inp.value);
  if (cents === null || cents < 0) { alert('Enter a dollar amount.'); return; }
  api('/admin/api/giving/deposit-lines', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deposit_id: depositId, batch_id: batchId, amount_cents: cents }) })
    .then(function(r) { if (r && r.error) { alert(r.error); return; } givOffRefresh(batchId); })
    .catch(function() { alert('Could not save that amount.'); });
}

function givDepSaveBank(batchId, depositId) {
  var inp = document.getElementById('giv-dep-bank-' + depositId);
  var cents = (inp && inp.value.trim() === '') ? null : givParseMoneyCents(inp && inp.value);
  if (inp && inp.value.trim() !== '' && cents === null) { alert('Enter a dollar amount.'); return; }
  api('/admin/api/giving/deposits/' + depositId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bank_cents: cents }) })
    .then(function(r) { if (r && r.error) { alert(r.error); return; } givOffRefresh(batchId); })
    .catch(function() { alert('Could not save the bank amount.'); });
}

function givDepRemoveLine(batchId, depositId) {
  if (!confirm('Remove this batch from that deposit? The gifts themselves are untouched.')) return;
  api('/admin/api/giving/deposit-lines?deposit_id=' + depositId + '&batch_id=' + batchId, { method: 'DELETE' })
    .then(function(r) { if (r && r.error) { alert(r.error); return; } givOffRefresh(batchId); })
    .catch(function() { alert('Could not remove the link.'); });
}

// Every deposit-link edit moves three things at once — the batch badge, the coverage bar, and
// the work-queue counts — so they all refresh together rather than drifting until a reload.
function givOffRefresh(batchId) {
  if (batchId) openBatch(batchId);
  loadBatches();
  givLoadWorkQueue();
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
      givOffRefresh(batchId);
      document.getElementById('e-person-search').focus();
    } else alert('Error: ' + (r.error||'unknown'));
  });
}
function deleteEntry(id) {
  if (!confirm('Remove this entry?')) return;
  api('/admin/api/giving/entries/' + id, {method:'DELETE'}).then(function(r) {
    if (r.ok) { givOffRefresh(currentBatchId); }
    else alert(r.error || 'Cannot delete.');
  });
}
function closeBatch(id) {
  if (!confirm('Close this batch? Entries cannot be added or removed after closing.')) return;
  var b = _currentBatch || {};
  api('/admin/api/giving/batches/' + id, {method:'PUT', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({closed:1, batch_date:b.batch_date||'', description:b.description||''})})
    .then(function(r) {
      if (r && r.ok) { givOffRefresh(id); }
      else alert('Error closing batch: ' + (r && r.error || 'Unknown error'));
    }).catch(function(e) { alert('Error closing batch: ' + e.message); });
}
function reopenBatch(id) {
  if (!confirm('Reopen this batch?')) return;
  var b = _currentBatch || {};
  api('/admin/api/giving/batches/' + id, {method:'PUT', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({closed:0, batch_date:b.batch_date||'', description:b.description||''})})
    .then(function(r) {
      if (r && r.ok) { givOffRefresh(id); }
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
    if (r.ok) { closeModal('batch-modal'); givOffRefresh(r.id); }
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

// The fund lens — which slice of giving the whole report is about. General Fund is the default
// on a fresh load because that is nearly always the council's question; the choice then sticks
// for the session, so switching to Narrative or changing the period doesn't silently reset it.
var _boardLens = 'general';
var _BOARD_LENS_FALLBACK = { key: 'all', label: 'All giving', hh_label: 'Giving households', fund_count: 0, given_ytd_cents: 0 };

function boardLensBlock(d) {
  var cats = (d && d.categories) || {};
  return cats[_boardLens] || cats.all || _BOARD_LENS_FALLBACK;
}

function boardBuildLensSelect(d) {
  var sel = document.getElementById('board-lens');
  if (!sel) return;
  var opts = ((d && d.fund_categories) || []).concat([{ key: 'all', label: 'All giving' }]);
  sel.innerHTML = opts.map(function(o) {
    return '<option value="' + o.key + '">' + esc(o.label) + '</option>';
  }).join('');
  sel.value = _boardLens;
  // A lens whose category isn't in this response falls back to All giving rather than leaving
  // the select showing one thing while the report shows another.
  if (sel.value !== _boardLens) { _boardLens = 'all'; sel.value = 'all'; }
}

function boardSetLens(lens) {
  _boardLens = lens || 'general';
  var sel = document.getElementById('board-lens');
  if (sel && sel.value !== _boardLens) sel.value = _boardLens;
  boardRender();
}

function boardSetMode(mode) {
  _boardMode = mode;
  ['dashboard','narrative','analysis'].forEach(function(m) {
    var b = document.getElementById('board-mode-' + m + '-btn');
    if (b) b.classList.toggle('active', m === mode);
  });
  // Analysis swaps the body wholesale — the tile grid instead of the board page — while the
  // lens and period stay put, so switching back lands on the report you left.
  var analysis = document.getElementById('giv-analysis-body');
  var body = document.getElementById('board-body');
  var strip = document.getElementById('board-else-strip');
  var note = document.getElementById('board-print-note');
  if (analysis) analysis.style.display = (mode === 'analysis') ? '' : 'none';
  if (body) body.style.display = (mode === 'analysis') ? 'none' : '';
  if (strip) strip.style.display = (mode === 'analysis') ? 'none' : '';
  if (note) note.style.display = (mode === 'analysis') ? 'none' : '';
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
    boardBuildLensSelect(d);
    boardRender();
  }).catch(function() { if (body) body.innerHTML = '<div class="board-empty">Could not load the board report.</div>'; });
}

// The "Everything else" strip: the categories that AREN'T the lens, each a click from becoming
// it. Replaces the old folded-in "+ $X other giving" sub-line, which could only name one lump.
function boardElseStripHtml(d) {
  var cats = d.categories || {};
  var chips = ((d.fund_categories || []).concat([{ key: 'all', label: 'All giving' }]))
    .filter(function(c) { return c.key !== _boardLens && cats[c.key]; })
    .map(function(c) {
      return '<button class="board-else-chip" data-lens="' + c.key + '" onclick="boardSetLens(this.dataset.lens)">' + esc(c.label)
        + ' <strong style="font-variant-numeric:tabular-nums;">' + boardMoney(cats[c.key].given_ytd_cents) + '</strong></button>';
    }).join('');
  if (!chips) return '';
  return '<div class="board-else-strip"><span class="board-else-label">Everything else</span>' + chips
    + '<span class="board-else-hint">Click a category to make it the lens.</span></div>';
}

function boardRender() {
  var body = document.getElementById('board-body');
  if (!body || !_boardData) return;
  var d = _boardData, lens = boardLensBlock(d);
  var sub = document.getElementById('board-subtitle');
  if (sub) sub.textContent = d.through_label + ' · ' + lens.label + ' only · no individual donors named';
  var note = document.getElementById('board-print-note');
  if (note) note.innerHTML = 'Packet prints the ' + esc(lens.label) + ' pages, plus a one-page summary of the other categories.';
  var strip = document.getElementById('board-else-strip');
  if (strip) strip.innerHTML = boardElseStripHtml(d);
  if (_boardMode === 'analysis') return;
  if ((lens.given_ytd_cents || 0) === 0) {
    body.innerHTML = '<div class="board-empty">' + ((lens.fund_count === 0)
      ? 'No funds are mapped to ' + esc(lens.label) + ' yet. Give each fund a category under <strong>Settings &rarr; Fund categories</strong>.'
      : 'No ' + esc(lens.label) + ' giving recorded for ' + esc(d.period_label) + ' yet.') + '</div>';
    return;
  }
  body.innerHTML = _boardMode === 'narrative' ? boardNarrativeHtml(d) : boardDashboardHtml(d);
}

function boardKpiCard(color, label, value, valueColor, sub) {
  return '<div class="board-kpi-card" style="border-top-color:' + color + ';">'
    + '<div class="board-kpi-label">' + esc(label) + '</div>'
    + '<div class="board-kpi-value"' + (valueColor ? ' style="color:' + valueColor + ';"' : '') + '>' + value + '</div>'
    + '<div class="board-kpi-sub">' + sub + '</div></div>';
}

function boardDashboardHtml(d) {
  // Every figure on this page is scoped to the selected lens — one fund category, or all giving.
  // Nothing here mixes scopes: an all-funds projection sitting beside a General-Fund YTD figure
  // is exactly the inconsistency the lens exists to prevent.
  var g = boardLensBlock(d);
  // KPI 1 — <Category> YTD
  var deltaSub = g.given_ytd_prior_cents > 0
    ? ((g.given_ytd_delta_pct >= 0 ? '+' : '−') + Math.abs(g.given_ytd_delta_pct) + '% vs. same point in ' + d.prior_year
       + ' (' + boardMoney(g.given_ytd_prior_cents) + ')')
    : 'No prior-year data for this point';
  var c1 = boardKpiCard('#2E7EA6', g.label + ' YTD', boardMoney(g.given_ytd_cents), '', deltaSub);
  // KPI 2 — Vs budget YTD, for the funds in this category. For the General Fund the plan comes
  // from Finance → Church Report's own account; every other category uses its funds' own budgets.
  var c2;
  if (g.budget_variance_cents == null) {
    c2 = boardKpiCard('#B85C3A', 'Vs. budget YTD', '—', '#8A8377',
      g.key === 'general' ? 'No Church Report budget uploaded for this account yet'
                          : 'No budget set for the funds in this category');
  } else {
    var vneg = g.budget_variance_cents < 0;
    var vsub = Math.abs(g.budget_variance_pct) + '% ' + (vneg ? 'behind' : 'ahead of') + ' the ' + boardMoney(g.budget_ytd_cents) + ' plan';
    c2 = boardKpiCard('#B85C3A', 'Vs. budget YTD', boardMoney(g.budget_variance_cents), vneg ? '#B85C3A' : '#6B8F71', vsub);
  }
  // KPI 3 — Year-end projection, same basis as card 1
  var methodNote = g.projection_method === 'seasonal' ? 'Projected on last year’s seasonal pattern'
    : g.projection_method === 'linear-weekly' ? 'Projected from the pace per Sunday so far this year'
    : g.projection_method === 'linear' ? 'Projected straight-line from the pace so far'
    : 'Full year recorded';
  var projSub = g.projection_vs_budget_cents == null ? methodNote
    : boardMoney(Math.abs(g.projection_vs_budget_cents)) + (g.projection_vs_budget_cents < 0 ? ' under' : ' over') + ' a ' + boardMoney(g.annual_budget_cents) + ' budget';
  var c3 = boardKpiCard('#C9973A', 'Year-end projection', boardMoney(g.projection_cents), '', projSub);
  // KPI 4 — households, labelled for what the category actually counts (paying households for
  // earned income, income sources for passive — "giving households" would misdescribe both).
  var hhDelta = g.households - g.households_prior;
  var hhSub = (g.households_prior > 0 ? (Math.abs(hhDelta) + (hhDelta === 0 ? ' same as ' : hhDelta < 0 ? ' fewer than ' : ' more than ') + d.prior_year + ' · ') : '')
    + boardMoney(g.avg_per_household_cents) + ' average';
  var c4 = boardKpiCard('#6B8F71', g.hh_label || 'Giving households', g.households.toLocaleString('en-US'), '', hhSub);
  var kpis = '<div class="board-kpi-grid">' + c1 + c2 + c3 + c4 + '</div>';

  // Body grid: chart card + navy panel
  var scopeWord = (g.key === 'all') ? 'all funds' : g.label + ' only';
  var legend = '<div class="board-legend">'
    + '<span><span class="board-swatch" style="background:#C4DDE8;"></span>' + d.prior_year + '</span>'
    + '<span><span class="board-swatch" style="background:#2E7EA6;"></span>' + d.year + '</span>'
    + (g.has_budget ? '<span><span class="board-swatch" style="background:#F5E0B0;border:1px solid #C9973A;"></span>Budget</span>' : '')
    + '</div>';
  var chartNote = g.has_budget
    ? 'Thousands of dollars, ' + scopeWord + '. The budget bar is the council-approved plan spread across the year by last year’s pattern.'
    : 'Thousands of dollars, ' + scopeWord + '. Budget bars appear once the fund budget is set.';
  var chartCard = '<div class="board-card">'
    + '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:4px;">'
    + '<div class="board-card-label">' + esc(g.label) + ' — month by month vs. prior year</div>' + legend + '</div>'
    + '<div style="font-size:11.5px;color:var(--warm-gray);margin-bottom:10px;">' + chartNote + '</div>'
    + boardMonthChart(d, g) + '</div>';

  var navy = boardNavyHtml(d, g);
  var bodyGrid = '<div class="board-body-grid">' + chartCard + navy + '</div>';

  var fundTable = boardFundTableHtml(d, g);

  return kpis + bodyGrid + fundTable;
}

function boardNavyHtml(d, g) {
  g = g || boardLensBlock(d);
  // Passive income doesn't come from households at all — it comes from accounts — so the
  // concentration sentence has to name what the category actually holds, not "households".
  var unit = (g.key === 'passive') ? 'accounts' : (g.key === 'earned' ? 'payers' : 'households');
  var mixColors = { check:'#C4DDE8', ach:'#6B8F71', cash:'#C9973A', other:'#8A8377' };
  var rows = (g.method_mix || []).map(function(m) {
    return '<div class="board-mix-row">'
      + '<div class="board-mix-head"><span>' + esc(m.label) + '</span><span style="font-variant-numeric:tabular-nums;">' + boardMoney(m.cents) + ' · ' + m.pct + '%</span></div>'
      + '<div class="board-mix-track"><div class="board-mix-fill" style="width:' + m.pct + '%;background:' + mixColors[m.key] + ';"></div></div></div>';
  }).join('');
  var con = g.concentration || d.concentration;
  var segColors = ['#C9973A', '#C4DDE8', '#6B8F71', 'rgba(255,255,255,.28)'];
  var segBar = '<div style="display:flex;height:10px;border-radius:5px;overflow:hidden;margin-top:12px;">'
    + con.segments.map(function(s, i) { return '<div style="width:' + Math.max(0, s.pct) + '%;background:' + segColors[i] + ';"></div>'; }).join('') + '</div>';
  var segLabels = '<div style="display:flex;justify-content:space-between;font-size:10.5px;color:rgba(255,255,255,.6);margin-top:5px;">'
    + con.segments.map(function(s) { return '<span>' + esc(s.label) + '</span>'; }).join('') + '</div>';
  var conText = 'The ten largest ' + unit + ' account for <strong style="color:#fff;">' + con.top10_pct + '%</strong> of '
    + ((g.key === 'all') ? 'everything received this year' : esc(g.label).toLowerCase() + ' this year') + '.'
    + (con.half_households > 0 ? ' Half of it comes from ' + con.half_households + ' ' + unit + '.' : '');
  return '<div class="board-navy">'
    + '<div class="board-navy-label">Where the money comes from</div>'
    + '<div>' + rows + '</div>'
    + '<div style="border-top:1px solid rgba(255,255,255,.16);margin-top:16px;padding-top:14px;">'
    + '<div class="board-navy-label" style="margin-bottom:8px;">Concentration</div>'
    + '<div style="font-size:13px;line-height:1.55;color:rgba(255,255,255,.86);">' + conText + '</div>'
    + segBar + segLabels + '</div></div>';
}

function boardToggleFundGroup(gi) {
  var rows = document.querySelectorAll('tr.board-grp-row[data-grp="' + gi + '"]');
  var chevron = document.getElementById('board-grp-chevron-' + gi);
  if (!rows.length) return;
  var expanded = rows[0].style.display !== 'none';
  rows.forEach(function(r) { r.style.display = expanded ? 'none' : ''; });
  if (chevron) chevron.innerHTML = expanded ? '&#9656;' : '&#9662;';
}
function boardFundTableHtml(d, g) {
  g = g || boardLensBlock(d);
  function moneyCell(cents, color) {
    return '<td class="num"' + (color ? ' style="color:' + color + ';"' : '') + '>' + boardMoney(cents) + '</td>';
  }
  function dashCell() { return '<td class="num" style="color:#8A8377;">—</td>'; }
  function varCell(v) {
    if (v == null) return dashCell();
    var color = v < 0 ? '#B85C3A' : (v > 0 ? '#6B8F71' : '#8A8377');
    return '<td class="num" style="color:' + color + ';">' + (v > 0 ? '+' : '') + boardMoney(v) + '</td>';
  }
  function fundRowCells(f) {
    return moneyCell(f.actual_cents)
      + (f.budget_ytd_cents == null ? dashCell() : moneyCell(f.budget_ytd_cents, '#8A8377'))
      + varCell(f.variance_cents)
      + moneyCell(f.prior_cents, '#8A8377');
  }
  // Group by leading numeric fund code (e.g. "40085" from "40085 General Fund"), same convention
  // the Giving by Fund report already uses (rptToggleFundGroup) — otherwise every seasonal
  // sub-fund under General Fund's own code shows up as its own scattered small row instead of
  // folding into the one line a board actually cares about.
  // "All giving" lists the four categories as rows — a board doesn't want 30 individual funds
  // when the question is how the categories compare; each category lens then lists its own funds.
  if (g.key === 'all') {
    var catBody = (d.fund_categories || []).map(function(c) {
      var cb = (d.categories || {})[c.key];
      if (!cb) return '';
      return '<tr style="cursor:pointer;" data-lens="' + c.key + '" onclick="boardSetLens(this.dataset.lens)"><td>' + esc(c.label)
        + ' <span style="color:var(--warm-gray);font-weight:400;">(' + cb.fund_count + ' fund' + (cb.fund_count === 1 ? '' : 's') + ')</span></td>'
        + fundRowCells({ actual_cents: cb.given_ytd_cents, budget_ytd_cents: cb.budget_ytd_cents,
                         variance_cents: cb.budget_variance_cents, prior_cents: cb.given_ytd_prior_cents }) + '</tr>';
    }).join('');
    return '<div class="board-card board-fund-table">'
      + '<div class="board-card-label" style="margin-bottom:10px;">By category</div>'
      + '<table class="rpt-table"><thead><tr>'
      + '<th>Category</th><th class="num">YTD actual</th><th class="num">YTD budget</th><th class="num">Variance</th><th class="num">Prior year</th>'
      + '</tr></thead><tbody>' + catBody + boardFundTotalRow(g) + '</tbody></table></div>';
  }
  var groups = {}, order = [];
  (g.funds || []).forEach(function(f) {
    var m = (f.name || '').match(/^(\d+)\s/);
    var key = m ? m[1] : ('_' + f.name);
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(f);
  });
  var body = '', gi = 0;
  order.forEach(function(key) {
    var grp = groups[key];
    if (grp.length > 1) {
      var idx = gi++;
      var grpActual = grp.reduce(function(s, f) { return s + f.actual_cents; }, 0);
      var grpPrior = grp.reduce(function(s, f) { return s + f.prior_cents; }, 0);
      var hasBudget = grp.some(function(f) { return f.budget_ytd_cents != null; });
      var grpBudget = hasBudget ? grp.reduce(function(s, f) { return s + (f.budget_ytd_cents || 0); }, 0) : null;
      var grpVar = grpBudget != null ? grpActual - grpBudget : null;
      var repFund = grp.slice().sort(function(a, b) { return b.actual_cents - a.actual_cents; })[0];
      body += '<tr class="rpt-group-hdr" style="cursor:pointer;" onclick="boardToggleFundGroup(' + idx + ')"><td><span id="board-grp-chevron-' + idx + '">&#9656;</span> ' + esc(repFund.name) + ' <span style="font-weight:400;text-transform:none;">(' + grp.length + ' funds — click to expand)</span></td>'
        + fundRowCells({ actual_cents: grpActual, budget_ytd_cents: grpBudget, variance_cents: grpVar, prior_cents: grpPrior }) + '</tr>';
      grp.forEach(function(f) {
        body += '<tr class="board-grp-row" data-grp="' + idx + '" style="display:none;"><td style="padding-left:22px;">' + esc(f.name) + '</td>' + fundRowCells(f) + '</tr>';
      });
    } else {
      body += '<tr><td>' + esc(grp[0].name) + '</td>' + fundRowCells(grp[0]) + '</tr>';
    }
  });
  return '<div class="board-card board-fund-table">'
    + '<div class="board-card-label" style="margin-bottom:10px;">Funds inside ' + esc(g.label) + '</div>'
    + '<table class="rpt-table"><thead><tr>'
    + '<th>Fund</th><th class="num">YTD actual</th><th class="num">YTD budget</th><th class="num">Variance</th><th class="num">Prior year</th>'
    + '</tr></thead><tbody>' + body + boardFundTotalRow(g) + '</tbody></table></div>';
}

// One total row shared by both shapes of the table, so the by-category and by-fund views can
// never print different totals for the same lens.
function boardFundTotalRow(g) {
  var v = g.budget_variance_cents;
  return '<tr class="rpt-total"><td style="color:var(--color-navy);">Total</td>'
    + '<td class="num" style="color:var(--color-navy);">' + boardMoney(g.given_ytd_cents) + '</td>'
    + (g.budget_ytd_cents == null ? '<td class="num" style="color:#8A8377;">—</td>' : '<td class="num" style="color:var(--color-navy);">' + boardMoney(g.budget_ytd_cents) + '</td>')
    + (v == null ? '<td class="num" style="color:#8A8377;">—</td>' : '<td class="num" style="color:' + (v < 0 ? '#B85C3A' : '#6B8F71') + ';">' + (v > 0 ? '+' : '') + boardMoney(v) + '</td>')
    + '<td class="num" style="color:var(--color-navy);">' + boardMoney(g.given_ytd_prior_cents) + '</td></tr>';
}

// A "nice" axis step (1/2/5 x a power of ten) giving 2-4 gridlines for whatever this category's
// biggest month is. The board's original fixed 50k-step/100k-minimum axis was written for the
// General Fund; against passive income — a couple of thousand dollars for the WHOLE year — every
// bar rounded to zero height and the chart read as a flat line.
function boardNiceStepK(maxK) {
  if (!(maxK > 0)) return 1;
  var target = maxK / 3;                                  // aim for ~3 steps to the top
  var mag = Math.pow(10, Math.floor(Math.log(target) / Math.LN10));
  var norm = target / mag;
  var mult = norm > 5 ? 10 : norm > 2 ? 5 : norm > 1 ? 2 : 1;
  return mult * mag;
}

// Grouped bar chart: prior year (all 12 months) / current year (through the last closed month) /
// budget (all 12, only when budgets exist). Auto-scales the y-axis to the data.
function boardMonthChart(d, g) {
  g = g || boardLensBlock(d);
  var cur = (g.monthly && g.monthly.current) || d.monthly.current;
  var prior = (g.monthly && g.monthly.prior) || d.monthly.prior;
  var tm = d.through_month;
  var hasBudget = !!g.has_budget, annualBudget = g.annual_budget_cents || 0;
  // Budget monthly, spread by prior-year shape (or evenly), only if a budget exists
  var priorTotal = prior.reduce(function(s, v) { return s + v; }, 0);
  var budgetMonthly = new Array(12).fill(0);
  if (hasBudget) {
    for (var i = 0; i < 12; i++) {
      budgetMonthly[i] = priorTotal > 0 ? annualBudget * (prior[i] / priorTotal) : annualBudget / 12;
    }
  }
  // Axis max, in thousands. The step adapts to the size of the category: passive income peaks
  // near $2k, and a fixed 50k-step/100k-minimum axis would render it as a flat line at zero.
  var maxCents = 0;
  for (var j = 0; j < 12; j++) {
    if (j < tm) maxCents = Math.max(maxCents, cur[j]);
    maxCents = Math.max(maxCents, prior[j], budgetMonthly[j]);
  }
  var maxK = maxCents / 100000;
  var stepK = boardNiceStepK(maxK);
  var axisMaxK = Math.max(stepK * 2, Math.ceil(maxK / stepK) * stepK);
  var baseline = 120, top = 26, span = baseline - top; // 94px
  function yOf(cents) { var k = cents / 100000; return baseline - (k / axisMaxK) * span; }
  function hOf(cents) { return (cents / 100000 / axisMaxK) * span; }
  var svg = '<svg viewBox="0 0 700 150" style="width:100%;height:150px;">';
  // gridlines + axis labels at 0, half, full
  var gl = [0, axisMaxK / 2, axisMaxK];
  gl.forEach(function(val) {
    var yy = baseline - (val / axisMaxK) * span;
    svg += '<line x1="26" y1="' + yy.toFixed(1) + '" x2="700" y2="' + yy.toFixed(1) + '" stroke="' + (val === 0 ? '#E8E0D0' : '#F1EFE9') + '" stroke-width="1"></line>';
    // Enough decimals that consecutive gridlines are distinguishable — derived from the HALF
    // step, since the middle gridline sits at axisMax/2 and would otherwise round (a 15k axis
    // stepping by 5 puts a line at 7.5 and printed it as "8").
    var half = stepK / 2;
    var dp = half >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log(half) / Math.LN10));
    if (half >= 1 && Math.abs(val - Math.round(val)) > 0.001) dp = 1;
    var lbl = val.toFixed(dp);
    svg += '<text x="22" y="' + (yy + 3).toFixed(1) + '" text-anchor="end" fill="#A69A88" font-size="9">' + lbl + '</text>';
  });
  var x0 = 30, pitch = (700 - x0 - 6) / 12, barW = 13, gap = 2;
  for (var mo = 0; mo < 12; mo++) {
    var bars = [];
    // prior (ice-blue) always
    bars.push({ v: prior[mo], fill: '#C4DDE8', stroke: '' });
    // current (teal) only through last closed month
    if (mo < tm) bars.push({ v: cur[mo], fill: '#2E7EA6', stroke: '' });
    // budget (gold outline) if present
    if (hasBudget) bars.push({ v: budgetMonthly[mo], fill: '#F5E0B0', stroke: '#C9973A' });
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
  // Written about the selected lens, same as the dashboard — a narrative that silently talked
  // about all funds while the header said "General Fund only" would be the worst kind of wrong.
  var k = boardLensBlock(d), con = k.concentration || d.concentration;
  var churchName = (typeof _churchConfig !== 'undefined' && _churchConfig && _churchConfig.church_name) || 'Timothy Lutheran Church';
  var mmName = BOARD_MONTHS[d.through_month - 1];
  // last day of month
  var monthEnds = [31,28,31,30,31,30,31,31,30,31,30,31];
  var isLeap = (d.year % 4 === 0 && d.year % 100 !== 0) || d.year % 400 === 0;
  var lastDay = (d.through_month === 2 && isLeap) ? 29 : monthEnds[d.through_month - 1];
  var asOf = mmName + ' ' + lastDay + ', ' + d.year;

  // Lede
  var deltaPrior = k.given_ytd_cents - k.given_ytd_prior_cents;
  var scopeNote = (k.key === 'all') ? 'across every fund' : 'to ' + k.label.toLowerCase();
  var ledeParts = 'the congregation has given <strong>' + boardMoney(k.given_ytd_cents) + '</strong> ' + scopeNote;
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
  var mix = {}; (k.method_mix || d.method_mix).forEach(function(m) { mix[m.key] = m; });
  var mixPct = function(key) { return (mix[key] && mix[key].pct) || 0; };
  var arriveBody = 'Checks are ' + mixPct('check') + '% of giving. Automatic giving — ACH and online — is ' + mixPct('ach') + '%. '
    + 'Loose-plate cash is ' + mixPct('cash') + '%; it is also the only giving the church cannot acknowledge or attribute.';

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
  var fundRows = (k.funds || d.funds).map(function(f) {
    return '<tr><td style="padding:7px 8px;border-bottom:1px solid var(--linen);">' + esc(f.name) + '</td>'
      + nvNum(f.actual_cents) + (f.budget_ytd_cents == null ? nvDash() : nvNum(f.budget_ytd_cents)) + nvVar(f.variance_cents) + nvNum(f.prior_cents, '#8A8377') + '</tr>';
  }).join('');
  var totVar = k.budget_variance_cents;
  var totRow = '<tr><td style="padding:8px;font-weight:700;">Total</td>'
    + '<td style="padding:8px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;">' + boardMoney(k.given_ytd_cents) + '</td>'
    + (k.budget_ytd_cents != null ? '<td style="padding:8px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;">' + boardMoney(k.budget_ytd_cents) + '</td>' : '<td style="padding:8px;text-align:right;color:#8A8377;">—</td>')
    + (totVar == null ? '<td style="padding:8px;text-align:right;color:#8A8377;">—</td>' : '<td style="padding:8px;text-align:right;font-weight:700;color:' + (totVar < 0 ? '#B85C3A' : '#6B8F71') + ';font-variant-numeric:tabular-nums;">' + (totVar > 0 ? '+' : '') + boardMoney(totVar) + '</td>')
    + '<td style="padding:8px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;">' + boardMoney(k.given_ytd_prior_cents) + '</td></tr>';
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
    + boardNarrativeElseSection(d)
    + '</div>'
    + fundTable
    + footnote
    + '</div>';
}

// The closing paragraph of the narrative: what the OTHER categories did, so a packet written
// about one lens still tells the council what the rest of the money was doing.
function boardNarrativeElseSection(d) {
  var cats = d.categories || {};
  var others = (d.fund_categories || []).filter(function(c) { return c.key !== _boardLens && cats[c.key]; });
  if (!others.length) return '';
  var parts = others.map(function(c) { return cats[c.key].label.toLowerCase() + ' ' + boardMoney(cats[c.key].given_ytd_cents); });
  var body = 'Beyond the figures above, the year to date also brought ' + parts.join(', ') + '. '
    + 'Those totals are reported here for completeness; each has its own page in the full packet.';
  return '<div><div class="board-nv-eyebrow">Everything else</div><div class="board-nv-body">' + body + '</div></div>';
}

// Print honors the lens: the selected category's own pages, then one summary page listing the
// other categories fund by fund. Built into the DOM only for the duration of the print job —
// leaving it on screen would be a second, contradictory copy of the report.
function boardPrintSummaryHtml(d) {
  var cats = d.categories || {};
  var others = (d.fund_categories || []).filter(function(c) { return c.key !== _boardLens && cats[c.key]; });
  if (!others.length) return '';
  var blocks = others.map(function(c) {
    var cb = cats[c.key];
    var rows = (cb.funds || []).map(function(f) {
      return '<tr><td style="padding:5px 8px;border-bottom:1px solid var(--linen);">' + esc(f.name) + '</td>'
        + '<td class="num" style="padding:5px 8px;border-bottom:1px solid var(--linen);text-align:right;font-variant-numeric:tabular-nums;">' + boardMoney(f.actual_cents) + '</td>'
        + '<td class="num" style="padding:5px 8px;border-bottom:1px solid var(--linen);text-align:right;font-variant-numeric:tabular-nums;color:#8A8377;">' + boardMoney(f.prior_cents) + '</td></tr>';
    }).join('') || '<tr><td colspan="3" style="padding:5px 8px;color:#8A8377;">No funds in this category.</td></tr>';
    return '<div style="margin-bottom:18px;"><div class="board-card-label" style="margin-bottom:6px;">' + esc(cb.label)
      + ' &mdash; ' + boardMoney(cb.given_ytd_cents) + ' YTD</div>'
      + '<table class="rpt-table"><thead><tr><th>Fund</th><th class="num">YTD</th><th class="num">Prior year</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table></div>';
  }).join('');
  return '<div id="board-print-summary" class="board-card" style="margin-top:14px;page-break-before:always;">'
    + '<div class="board-card-label" style="margin-bottom:10px;">Everything else &mdash; the other categories</div>' + blocks + '</div>';
}

function printBoardPage() {
  if (!_boardData) return;
  // "Print board page" prints the board page. If Analysis is the mode on screen, board-body
  // holds no rendered report (boardRender skips it in that mode) and the print CSS can't
  // resurrect an inline display:none — so switch back to the dashboard first, visibly, rather
  // than printing a blank sheet.
  if (_boardMode === 'analysis') boardSetMode('dashboard');
  var body = document.getElementById('board-body');
  var summary = null;
  if (body && _boardMode !== 'analysis') {
    var html = boardPrintSummaryHtml(_boardData);
    if (html) { summary = document.createElement('div'); summary.innerHTML = html; body.appendChild(summary); }
  }
  document.body.classList.add('printing-board');
  var cleanup = function() {
    document.body.classList.remove('printing-board');
    if (summary && summary.parentNode) summary.parentNode.removeChild(summary);
    summary = null;
    window.removeEventListener('afterprint', cleanup);
  };
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

// ── GIVING NUDGES WORKSPACE ────────────────────────────────────────────
// The Plateaus & Nudges analysis (Reports -> Analysis) works out who to write to and what to
// ask; this is where that becomes actual mail. Recipients come from giving/nudges/status, which
// runs the SAME giver query the report runs, so the list here is never a different set of people
// than the one that was reviewed.
//
// Every figure a recipient sees is in THEIR OWN rhythm — a monthly giver reads "$185 a month",
// not the weekly-equivalent the analysis normalises to internally. Sends and prints are recorded
// in the same giving_letter_sends ledger the Letters pane uses (letter_type 'nudge'), so a run
// is resumable and nobody is asked twice.
var _givNudgesState = { year: 0, scope: 'household', fundId: '', option: 'standard', channel: 'email', lowFreq: 3, recipients: [], counts: null, selected: {} };
var _GIV_NUDGE_OPTIONS = [
  { key: 'modest',   label: 'Modest' },
  { key: 'standard', label: 'Standard' },
  { key: 'generous', label: 'Generous' }
];
function givNudgesInit() {
  if (!_givNudgesState.year) _givNudgesState.year = new Date().getFullYear();
  givNudgesRenderShell();
  givNudgesPopulateFunds();
  givNudgesLoadStatus();
}
// givPopulateFundSelect early-returns once a select has options, and the shell re-render builds a
// fresh empty one — so the chosen fund has to be re-applied after each repopulate or it silently
// resets to All Funds while the query keeps using the old value.
function givNudgesPopulateFunds() {
  givPopulateFundSelect('giv-nudge-fund');
  var sel = document.getElementById('giv-nudge-fund');
  if (sel) sel.value = _givNudgesState.fundId || '';
}
function givNudgesRenderShell() {
  var root = document.getElementById('giv-nudges-root');
  if (!root) return;
  var st = _givNudgesState;
  var optPills = _GIV_NUDGE_OPTIONS.map(function(o) {
    return '<button class="pill' + (o.key === st.option ? ' active' : '') + '" onclick="givNudgesSetOption(' + volJsAttr(o.key) + ')">' + esc(o.label) + '</button>';
  }).join('');
  root.innerHTML = '<div class="import-card" style="margin:0 0 14px;">'
    + '<h3 style="margin-top:0;">&#128233; Giving nudges</h3>'
    + '<p style="font-size:.85rem;color:var(--warm-gray);margin:0 0 10px;">Invites each giver to a specific next step, in the rhythm they already give in &mdash; a monthly giver is asked to move from one monthly amount to the next, not from a weekly figure they never see. Who appears here, and what each is asked, comes straight from <span style="color:var(--color-teal);font-weight:700;cursor:pointer;" onclick="givSetView(&quot;analysis&quot;)">Plateaus &amp; Nudges</span> under Reports. <strong>Every letter states back what that person currently gives &mdash; preview one before you send.</strong></p>'
    + '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:10px;">'
    + '<div class="field" style="margin:0;"><label>Year</label><input type="number" id="giv-nudge-year" value="' + st.year + '" onchange="givNudgesSetYear(this.value)" style="font-size:.85rem;padding:4px 8px;width:90px;"></div>'
    + '<div class="field" style="margin:0;"><label>Fund</label><select id="giv-nudge-fund" onchange="givNudgesSetFund(this.value)" style="font-size:.85rem;padding:4px 8px;"><option value="">All Funds</option></select></div>'
    + '<div class="field" style="margin:0;"><label>Group by</label><select onchange="givNudgesSetScope(this.value)" style="font-size:.85rem;padding:4px 8px;">'
    + '<option value="household"' + (st.scope === 'household' ? ' selected' : '') + '>Household</option>'
    + '<option value="person"' + (st.scope === 'person' ? ' selected' : '') + '>Person</option></select></div>'
    + '<div class="field" style="margin:0;"><label>Ask</label><div class="batch-filter-pills" style="border-bottom:none;padding:0;">' + optPills + '</div></div>'
    + '<div class="field" style="margin:0;"><label>Channel</label><select onchange="givNudgesSetChannel(this.value)" style="font-size:.85rem;padding:4px 8px;">'
    + '<option value="email"' + (st.channel === 'email' ? ' selected' : '') + '>Email</option>'
    + '<option value="print"' + (st.channel === 'print' ? ' selected' : '') + '>Print</option></select></div>'
    + '</div>'
    + '<div id="giv-nudge-status" class="import-status"></div>'
    + '</div>'
    + '<div id="giv-nudge-body"><div class="board-empty">Loading&hellip;</div></div>';
}
function givNudgesSetYear(v) { _givNudgesState.year = parseInt(v, 10) || new Date().getFullYear(); givNudgesLoadStatus(); }
function givNudgesSetFund(v) { _givNudgesState.fundId = v || ''; givNudgesLoadStatus(); }
function givNudgesSetScope(v) { _givNudgesState.scope = (v === 'person') ? 'person' : 'household'; givNudgesLoadStatus(); }
function givNudgesSetOption(v) { _givNudgesState.option = v; givNudgesRenderShell(); givNudgesPopulateFunds(); givNudgesLoadStatus(); }
function givNudgesSetChannel(v) { _givNudgesState.channel = (v === 'print') ? 'print' : 'email'; givNudgesLoadStatus(); }
function givNudgesLoadStatus() {
  var st = _givNudgesState;
  var body = document.getElementById('giv-nudge-body');
  if (!body) return;
  body.innerHTML = '<div class="board-empty">Loading recipients&hellip;</div>';
  var qs = 'year=' + st.year + '&scope=' + st.scope + '&option=' + st.option + '&channel=' + st.channel
    + '&low_frequency_max=' + st.lowFreq + (st.fundId ? '&fund_id=' + encodeURIComponent(st.fundId) : '');
  api('/admin/api/giving/nudges/status?' + qs).then(function(d) {
    if (!d || d.error) { body.innerHTML = '<div class="board-empty">Could not load recipients.</div>'; return; }
    st.recipients = d.recipients || [];
    st.counts = d.counts || { total: 0, sent: 0, unsent: 0, no_email: 0 };
    st.upsideAnnualCents = d.upside_annual_cents || 0;
    st.partial = !!d.partial;
    // Default selection: everyone not already written to, and (for email) reachable.
    st.selected = {};
    st.recipients.forEach(function(r, i) {
      if (!r.sent && (st.channel === 'print' || r.has_email)) st.selected[i] = true;
    });
    givNudgesRenderRecipients();
  }).catch(function(e) {
    body.innerHTML = '<div class="board-empty">Could not load recipients: ' + esc(e.message) + '</div>';
  });
}
function givNudgesSelected() {
  var st = _givNudgesState;
  return st.recipients.filter(function(r, i) { return st.selected[i]; });
}
function givNudgesToggle(i, checked) { _givNudgesState.selected[i] = !!checked; givNudgesRenderTotals(); }
function givNudgesSelectAll(only) {
  var st = _givNudgesState;
  st.selected = {};
  st.recipients.forEach(function(r, i) {
    if (only === 'none') return;
    if (only === 'unsent' && r.sent) return;
    if (st.channel === 'email' && !r.has_email) return;
    st.selected[i] = true;
  });
  givNudgesRenderRecipients();
}
function givNudgesRenderTotals() {
  var el = document.getElementById('giv-nudge-totals');
  if (!el) return;
  var sel = givNudgesSelected();
  var upside = sel.reduce(function(s, r) { return s + ((r.option && r.option.cadence_annual_delta_cents) || 0); }, 0);
  el.innerHTML = '<b>' + sel.length + '</b> selected &middot; if every one of them says yes, that is <b>' + fmtWholeDollars(upside) + '/yr</b> more.';
}
function givNudgesRenderRecipients() {
  var st = _givNudgesState;
  var body = document.getElementById('giv-nudge-body');
  if (!body) return;
  if (!st.recipients.length) {
    body.innerHTML = '<div class="board-empty">No givers with a suggested next step for ' + st.year + '.</div>';
    return;
  }
  var c = st.counts;
  var rows = st.recipients.map(function(r, i) {
    var o = r.option || {};
    var unreachable = (st.channel === 'email' && !r.has_email);
    return '<tr' + (r.sent ? ' style="opacity:.55;"' : '') + '>'
      + '<td style="padding:6px;"><input type="checkbox" id="giv-nudge-cb-' + i + '"' + (st.selected[i] ? ' checked' : '') + (unreachable ? ' disabled' : '') + ' onchange="givNudgesToggle(' + i + ',this.checked)"></td>'
      + '<td style="padding:6px;"><div style="font-weight:600;">' + esc(r.name || '(unnamed)') + '</div>'
      + '<div style="font-size:.74rem;color:var(--warm-gray);">' + (r.has_email ? esc(r.email) : '<span style="color:var(--deep-amber);">no email on file</span>')
      + ' &middot; ' + r.gifts + ' gift' + (r.gifts === 1 ? '' : 's') + '</div></td>'
      + '<td style="padding:6px;"><span class="fin-chip fin-chip-info">' + esc(r.cadence_label || '') + '</span>'
      + (r.low_frequency && r.all_manual_methods ? ' <span class="fin-chip fin-chip-warn" title="Gives occasionally and never by an automatic method — a good recurring-giving conversation">not automated</span>' : '') + '</td>'
      + '<td style="padding:6px;text-align:right;font-variant-numeric:tabular-nums;">' + fmtWholeDollars(r.cadence_amount_cents) + ' <span style="color:var(--warm-gray);font-size:.74rem;">' + esc(r.cadence_adverb || '') + '</span></td>'
      + '<td style="padding:6px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;">' + fmtWholeDollars(o.cadence_target_cents) + '</td>'
      + '<td style="padding:6px;text-align:right;font-variant-numeric:tabular-nums;color:var(--sage-text);">' + fmtWholeDollars(o.cadence_annual_delta_cents) + '/yr</td>'
      + '<td style="padding:6px;text-align:right;white-space:nowrap;">'
      + '<button class="btn-secondary" style="font-size:.72rem;padding:2px 8px;" onclick="givNudgesPreview(' + i + ')">Preview</button> '
      + '<button class="btn-secondary" style="font-size:.72rem;padding:2px 8px;" onclick="givNudgesToggleMark(' + i + ')">' + (r.sent ? 'Unmark' : 'Mark sent') + '</button>'
      + '</td></tr>';
  }).join('');
  body.innerHTML = '<div class="import-card" style="margin:0;">'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">'
    + givLettersStatChip(c.total, 'in range') + givLettersStatChip(c.sent, 'already sent') + givLettersStatChip(c.unsent, 'not yet')
    + (c.no_email ? givLettersStatChip(c.no_email, 'no email') : '')
    + '<span style="flex:1;"></span>'
    + '<button class="btn-secondary" style="font-size:.76rem;padding:3px 10px;" onclick="givNudgesSelectAll(&quot;unsent&quot;)">Select not-yet-sent</button> '
    + '<button class="btn-secondary" style="font-size:.76rem;padding:3px 10px;" onclick="givNudgesSelectAll(&quot;all&quot;)">Select all</button> '
    + '<button class="btn-secondary" style="font-size:.76rem;padding:3px 10px;" onclick="givNudgesSelectAll(&quot;none&quot;)">Clear</button>'
    + '</div>'
    + (st.partial ? '<div class="import-status warn" style="margin-bottom:8px;">' + st.year + ' is still in progress, so each figure is a pace so far this year, not a finished total.</div>' : '')
    + '<div id="giv-nudge-totals" style="font-size:.85rem;color:var(--warm-gray);margin-bottom:8px;"></div>'
    + '<div style="overflow-x:auto;"><table class="rpt-table" style="min-width:820px;">'
    + '<thead><tr><th style="width:28px;"></th><th>Giver</th><th>Gives</th><th style="text-align:right;">Now</th><th style="text-align:right;">Invited to</th><th style="text-align:right;">If yes</th><th></th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">'
    + (st.channel === 'email'
        ? '<button class="btn-primary" onclick="givNudgesSend()">Email selected</button>'
        : '<button class="btn-primary" onclick="givNudgesPrint()">Print selected</button>')
    + '</div></div>';
  givNudgesRenderTotals();
}
// The letter itself. Built from the recipient's own cadence figures rather than a stored
// template, because the whole point is the specific ask — and kept deliberately short: a page
// that states what they give, names one concrete next step, and says what it would do.
function givNudgesLetterHtml(r, churchName) {
  var o = r.option || {};
  var adverb = r.cadence_adverb || 'a week';
  var greeting = (r.kind === 'household') ? 'Dear ' + esc(r.name) : 'Dear ' + esc((r.recipient_name || r.name).split(' ')[0]);
  var givingUrl = (_churchConfig && _churchConfig.online_giving_url) || '';
  var body = '<p>' + greeting + ',</p>'
    + '<p>Thank you for your faithful giving to ' + esc(churchName) + '. Your generosity is part of everything this congregation is able to do &mdash; worship, teaching, care for our neighbours, and the daily work of the church.</p>'
    + '<p>Over the past year your giving has averaged about <b>' + fmtWholeDollars(r.cadence_amount_cents) + ' ' + esc(adverb) + '</b>.'
    + ' As we look ahead, would you prayerfully consider moving to <b>' + fmtWholeDollars(o.cadence_target_cents) + ' ' + esc(adverb) + '</b>?</p>'
    + '<p>That is a change of ' + fmtWholeDollars(o.cadence_delta_cents) + ' ' + esc(adverb) + ' &mdash; about <b>' + fmtWholeDollars(o.cadence_annual_delta_cents) + '</b> over a year.'
    + (o.impact_text ? ' ' + esc(o.impact_text) : '') + '</p>'
    + (givingUrl ? '<p>If it would help to make your giving automatic, you can set that up at <a href="' + esc(givingUrl) + '">' + esc(givingUrl) + '</a>.</p>' : '')
    + '<p>Please hear this as an invitation and never an expectation. Whatever you decide, we are grateful for you.</p>'
    + '<p>In Christ,<br>' + esc(churchName) + '</p>';
  return '<div style="font-family:Georgia,serif;font-size:14px;line-height:1.65;max-width:560px;">'
    + letterheadImgHtml(true, churchName, 'font-size:16px;font-weight:bold;', 6) + '<hr style="margin:10px 0;">'
    + body + '</div>';
}
function givNudgesChurchName() {
  return (_churchConfig && _churchConfig.church_name) || 'Timothy Lutheran Church';
}
function givNudgesWithConfig(next) {
  if (_churchConfig && _churchConfig.church_name) { next(); return; }
  api('/admin/api/config/church').then(function(cfg) { _churchConfig = cfg || {}; next(); }).catch(function() { next(); });
}
function givNudgesPreview(i) {
  var r = _givNudgesState.recipients[i];
  if (!r) return;
  givNudgesWithConfig(function() {
    var who = document.getElementById('giv-nudge-preview-who');
    var bodyEl = document.getElementById('giv-nudge-preview-body');
    if (who) who.textContent = r.name || '(unnamed)';
    if (bodyEl) bodyEl.innerHTML = givNudgesLetterHtml(r, givNudgesChurchName());
    openModal('giv-nudge-preview-modal');
  });
}
function givNudgesSend() {
  var st = _givNudgesState;
  var statusEl = document.getElementById('giv-nudge-status');
  var recips = givNudgesSelected().filter(function(r) { return r.has_email; });
  if (!recips.length) { statusEl.textContent = 'No emailable recipients selected.'; statusEl.className = 'import-status err'; return; }
  if (!confirm('Email ' + recips.length + ' giving nudge' + (recips.length === 1 ? '' : 's') + '?\n\nEach letter names what that person currently gives. Preview one first if you have not.')) return;
  givNudgesWithConfig(function() {
    var churchName = givNudgesChurchName();
    var total = recips.length, done = 0, failed = 0, stopped = false, i = 0;
    statusEl.className = 'import-status';
    function finish() {
      var msg = 'Done. ' + done + ' emailed';
      if (failed) msg += ', ' + failed + ' failed';
      if (stopped) msg = "Brevo's sending limit was hit after " + done + ' emailed. Come back later and click Email selected again — already-sent recipients are skipped.';
      statusEl.textContent = msg;
      statusEl.className = (failed || stopped) ? 'import-status' : 'import-status ok';
      givNudgesLoadStatus();
    }
    function next() {
      if (i >= recips.length || stopped) { finish(); return; }
      var r = recips[i++];
      statusEl.textContent = 'Emailing ' + (done + failed + 1) + '/' + total + '…';
      api('/admin/api/giving/send-statement', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_email: r.email, to_name: r.recipient_name || r.name,
          subject: 'A word of thanks — and an invitation — from ' + churchName,
          html_body: givNudgesLetterHtml(r, churchName),
          person_id: (r.kind === 'household') ? (r.recipient_person_id || 0) : r.id,
          household_id: (r.kind === 'household') ? r.id : null,
          year: st.year, letter_type: 'nudge', recipient_key: r.recipient_key
        })
      }).then(function(res) {
        if (res && res.ok) { done++; next(); return; }
        if (res && res.rate_limited) { stopped = true; finish(); return; }
        failed++; next();
      }).catch(function() { failed++; next(); });
    }
    next();
  });
}
function givNudgesPrint() {
  var st = _givNudgesState;
  var statusEl = document.getElementById('giv-nudge-status');
  var recips = givNudgesSelected();
  if (!recips.length) { statusEl.textContent = 'No recipients selected.'; statusEl.className = 'import-status err'; return; }
  givNudgesWithConfig(function() {
    var churchName = givNudgesChurchName();
    var pages = recips.map(function(r, idx) {
      return '<div style="' + (idx ? 'page-break-before:always;' : '') + '">' + givNudgesLetterHtml(r, churchName) + '</div>';
    }).join('');
    var w = window.open('', '_blank');
    if (!w) { statusEl.textContent = 'Could not open the print window — allow pop-ups for this site.'; statusEl.className = 'import-status err'; return; }
    w.document.write('<html><head><title>Giving nudges — ' + st.year + '</title></head><body>' + pages + '</body></html>');
    w.document.close();
    w.focus();
    w.print();
    // Printing is a send: record every letter that just went to paper, so the next run skips
    // them exactly as it would after an email.
    var pending = recips.length;
    statusEl.textContent = 'Recording ' + pending + ' printed…';
    statusEl.className = 'import-status';
    recips.forEach(function(r) {
      api('/admin/api/giving/letters/mark', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_key: r.recipient_key, year: st.year, letter_type: 'nudge', channel: 'print',
          person_id: (r.kind === 'household') ? (r.recipient_person_id || 0) : r.id,
          household_id: (r.kind === 'household') ? r.id : null
        })
      }).catch(function() {}).then(function() {
        if (--pending <= 0) { statusEl.textContent = 'Printed and recorded.'; statusEl.className = 'import-status ok'; givNudgesLoadStatus(); }
      });
    });
  });
}
function givNudgesToggleMark(i) {
  var st = _givNudgesState;
  var r = st.recipients[i];
  if (!r) return;
  api('/admin/api/giving/letters/mark', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient_key: r.recipient_key, year: st.year, letter_type: 'nudge', channel: st.channel,
      unmark: !!r.sent,
      person_id: (r.kind === 'household') ? (r.recipient_person_id || 0) : r.id,
      household_id: (r.kind === 'household') ? r.id : null
    })
  }).then(function() { givNudgesLoadStatus(); }).catch(function() {});
}

// ── Settings → Fund categories ─────────────────────────────────────────
// The mapping the Reports fund lens depends on. Every fund gets exactly one category and an
// annual budget; saved together on an explicit click, matching this app's no-silent-autosave
// convention everywhere else in Settings.
var _givFundCats = [];
function givLoadFundCategories() {
  var root = document.getElementById('giv-fundcat-root');
  if (!root) return;
  api('/admin/api/funds').then(function(d) {
    _givFundCats = (d && d.funds) || [];
    givRenderFundCategories();
  }).catch(function() {
    root.innerHTML = '<div style="font-size:.85rem;color:var(--danger);">Could not load funds.</div>';
  });
}
var _GIV_FUND_CAT_OPTS = [
  { key: 'general',    label: 'General Fund' },
  { key: 'earned',     label: 'Earned income' },
  { key: 'passive',    label: 'Passive income' },
  { key: 'restricted', label: 'Restricted & designated' },
];
function givRenderFundCategories() {
  var root = document.getElementById('giv-fundcat-root');
  if (!root) return;
  if (!_givFundCats.length) {
    root.innerHTML = '<div style="font-size:.85rem;color:var(--warm-gray);">No funds yet.</div>';
    return;
  }
  var rows = _givFundCats.map(function(f, i) {
    var opts = _GIV_FUND_CAT_OPTS.map(function(o) {
      return '<option value="' + o.key + '"' + ((f.category || 'restricted') === o.key ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }).join('');
    var budget = ((f.budget_annual_cents || 0) / 100).toFixed(2);
    return '<tr' + (f.active ? '' : ' style="opacity:.55;"') + '>'
      + '<td>' + esc(f.name) + (f.active ? '' : ' <span style="font-size:.72rem;color:var(--warm-gray);">(inactive)</span>') + '</td>'
      + '<td><select id="giv-fc-cat-' + f.id + '" style="font-size:.82rem;padding:4px 8px;">' + opts + '</select></td>'
      + '<td style="text-align:right;">$ <input type="text" inputmode="decimal" id="giv-fc-budget-' + f.id + '" value="' + budget + '" style="width:90px;text-align:right;font-variant-numeric:tabular-nums;font-size:.82rem;padding:4px 6px;"></td>'
      + '</tr>';
  }).join('');
  root.innerHTML = '<table class="rpt-table"><thead><tr><th>Fund</th><th>Category</th><th style="text-align:right;">Annual budget</th></tr></thead><tbody>' + rows + '</tbody></table>';
}
function givSaveFundCategories() {
  var status = document.getElementById('giv-fundcat-status');
  var payload = _givFundCats.map(function(f) {
    var cat = document.getElementById('giv-fc-cat-' + f.id);
    var bud = document.getElementById('giv-fc-budget-' + f.id);
    var cents = givParseMoneyCents(bud && bud.value);
    return { id: f.id, category: cat ? cat.value : (f.category || 'restricted'), budget_annual_cents: cents === null ? 0 : cents };
  });
  if (status) { status.className = 'import-status'; status.textContent = 'Saving…'; }
  api('/admin/api/funds/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ funds: payload }) })
    .then(function(r) {
      if (r && r.error) { if (status) { status.className = 'import-status error'; status.textContent = r.error; } return; }
      if (status) { status.className = 'import-status success'; status.textContent = 'Saved ' + (r.count || 0) + ' funds.'; }
      // The board's lens data is now stale — reload it next time Reports is opened.
      _boardData = null;
      givLoadFundCategories();
    })
    .catch(function() { if (status) { status.className = 'import-status error'; status.textContent = 'Could not save.'; } });
}

`;
