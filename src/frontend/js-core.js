export const JS_CORE = String.raw`<script>
// ── DEPLOY VERSION ───────────────────────────────────────────────────
var DEPLOY_VERSION = '2026-04-27-v139';
window.onerror = function(msg, src, line, col, err) {
  // Benign browser quirk when a ResizeObserver callback triggers layout — no real failure.
  if (msg && String(msg).indexOf('ResizeObserver loop') !== -1) return true;
  var b = document.getElementById('js-error-banner');
  if (!b) { b = document.createElement('div'); b.id = 'js-error-banner';
    b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#c0392b;color:#fff;padding:10px 16px;font-size:.82rem;z-index:99999;font-family:monospace;';
    document.body.appendChild(b); }
  b.textContent = 'JS Error: ' + msg + ' (line ' + line + ')';
  return false;
};
// ── STATE ────────────────────────────────────────────────────────────
var allTags = [], allFunds = [], currentBatchId = null, _currentBatch = null, peopleFilter = {q:'',mt:'member',tagIds:[],missingFields:[],offset:0,limit:25,sort:'last_name',dir:'asc'};
var _peopleTotal = 0;
var _pDebounce, _hDebounce;
var _loadedServices = [];
var _hhOffset = 0, _hhTotal = 0;
var _currentPvPerson = null;
var _pvGivingPersonId = null;
var _pvGivingEntries = [];
var _editGiftId = null;
var _editGiftFilterYear = '';
var _userRole = 'admin';
var _batchSearch = '';
var _attOrder = 'desc', _attGroupBy = 'none', _attChartMode = 'line', _attTableVisible = true, _attChartH = 210;
var _yoyRptH = 200, _byServiceRptH = 180, _givingTrendH = 220;
var _lastYoYRptData = null, _lastByServiceRptData = null, _lastGivingTrendData = null;
var _attSvcMode = 'range';
var _cropImg = null, _cropCallback = null, _cropRect = {x:0,y:0,w:0,h:0}, _cropScale = 1, _cropDrag = null;
var _dashPrefs = null;
var _archiveView = false;
var _selectMode = false, _selectedPeople = new Set();
var _editingHouseholdId = null;
var _churchConfig = {};
var DEFAULT_LETTER_TEMPLATE = 'Dear {{name}},\\n\\nThank you for your generous contributions to Timothy Lutheran Church during {{year}}. Your gifts make a difference in our ministry and community.\\n\\nBelow is a summary of your giving for {{year}}:\\n\\n{{gift_table}}\\n\\nTotal Contributions: {{total}}\\n\\n{{#if_ein}}Our EIN/Tax ID is {{ein}}. No goods or services were provided in exchange for these contributions. Please retain this letter for your tax records.{{/if_ein}}\\n\\nWith gratitude,\\n\\nTimothy Lutheran Church\\n\\nDate: {{date}}';

// ── HELPERS ──────────────────────────────────────────────────────────
function api(path, opts) {
  return fetch(path, opts || {}).then(function(r) {
    if (r.status === 401) { location.href = '/chms'; return Promise.reject(new Error('Unauthorized')); }
    return r.json().then(function(data) {
      if (data && data.error && !opts) {
        // Surface API errors as rejected promises so callers can .catch() them
        // Exception: mutation calls (POST/PUT/DELETE) that return {error} are handled by their own code
      }
      return data;
    });
  }).catch(function(err) {
    if (err.message === 'Unauthorized') return Promise.reject(err);
    console.error('[API error]', path, err);
    return Promise.reject(err);
  });
}
function openPersonDetail(id) {
  api('/admin/api/people/' + id).then(function(p) {
    if (p && p.error) { showErrorBanner('Could not load person: ' + esc(p.error)); return; }
    showProfile(p);
  }).catch(function(err) {
    if (err && err.message !== 'Unauthorized') showErrorBanner('Could not load person record.');
  });
}
function fmtMoney(cents) {
  return '$' + (cents / 100).toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
}
function fmtDate(iso) {
  if (!iso) return '';
  var p = iso.split('-'); if (p.length < 3) return iso;
  return parseInt(p[1]) + '/' + parseInt(p[2]) + '/' + p[0];
}
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function setStatus(id, msg, type) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = 'status-msg' + (type ? ' ' + type : '');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
function openModal(id) {
  document.getElementById(id).classList.add('open');
}
// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(function(el) {
  el.addEventListener('click', function(e) { if (e.target === el) el.classList.remove('open'); });
});
function typeClass(t) {
  return 'p-type type-' + (t||'visitor');
}
function initials(first, last) {
  return ((first||'').charAt(0) + (last||'').charAt(0)).toUpperCase();
}
function photoSrc(url) {
  if (!url) return null;
  // Proxy Breeze CDN URLs through the worker so the API key header is added
  if (url.indexOf('.breezechms.com') >= 0 || url.indexOf('breezechms.com/') >= 0) {
    return '/admin/photo-proxy?url=' + encodeURIComponent(url);
  }
  return url;
}

// ── TAB SWITCHING ─────────────────────────────────────────────────────
function showTab(name) {
  // Enforce role-based tab access
  var isFinancePlus = _userRole === 'admin' || _userRole === 'finance';
  var isStaffPlus   = _userRole === 'admin' || _userRole === 'staff';
  var canEdit       = _userRole === 'admin' || _userRole === 'finance' || _userRole === 'staff';
  if (name === 'giving'     && !isFinancePlus) return;
  if (name === 'attendance' && !isStaffPlus)   return;
  if (name === 'register'   && !isStaffPlus)   return;
  if (name === 'reports'    && !canEdit)        return;
  if (name === 'import'     && _userRole !== 'admin') return;
  if (name === 'settings'   && _userRole !== 'admin') return;
  if (name === 'volunteers' && _userRole !== 'admin') return;
  if (name === 'scheduler'  && _userRole !== 'admin') return;
  var labels = {home:'Home',people:'People',households:'Households',organizations:'Organizations',giving:'Giving',reports:'Reports',attendance:'Attendance',register:'Register',import:'Import',settings:'Settings',volunteers:'Volunteers',scheduler:'Scheduler'};
  // Exit person-profile view if active
  var ca = document.querySelector('.content-area');
  if (ca) ca.classList.remove('pv-mode');
  document.querySelectorAll('.s-item[data-tab]').forEach(function(b) {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.tab-panel').forEach(function(p) {
    p.classList.toggle('active', p.id === 'tab-' + name);
  });
  var t = document.getElementById('topbar-title');
  if (t) t.textContent = labels[name] || name;
  closeSidebar();
  if (name === 'home') loadDashboard();
  if (name === 'people') loadPeople();
  if (name === 'households') loadHouseholds();
  if (name === 'organizations') loadOrganizations();
  if (name === 'giving') loadBatches();
  if (name === 'reports') initReports();
  if (name === 'attendance') loadAttendance();
  if (name === 'register') loadRegister();
  if (name === 'settings') loadSettings();
  if (name === 'volunteers') { volLoadSignups(); volLoadEvents(); }
  if (name === 'scheduler') {
    if (window.schedInitScheduler && !window._schedInited) {
      window.schedInitScheduler();
    }
  }
}
function openSidebar() {
  var s = document.getElementById('sidebar'); if (s) s.classList.add('open');
  var o = document.getElementById('sidebar-overlay'); if (o) o.classList.add('open');
}
function closeSidebar() {
  var s = document.getElementById('sidebar'); if (s) s.classList.remove('open');
  var o = document.getElementById('sidebar-overlay'); if (o) o.classList.remove('open');
}

// ── INIT ──────────────────────────────────────────────────────────────
// ── GLOBAL ERROR BOUNDARY ────────────────────────────────────────────
function showErrorBanner(msg) {
  var el = document.getElementById('error-boundary');
  if (!el) return;
  el.innerHTML = '<strong>Something went wrong.</strong> ' + (msg||'Unknown error')
    + ' &nbsp;<a href="" onclick="location.reload();return false;" style="color:#ffd;text-decoration:underline;">Reload</a>'
    + ' &nbsp;<span onclick="this.parentElement.style.display=\'none\'" style="cursor:pointer;opacity:.7;font-size:1.1em;margin-left:4px;">&#215;</span>';
  el.style.display = 'block';
  setTimeout(function(){ if(el) el.style.display='none'; }, 15000);
}
window.addEventListener('error', function(e) {
  // Suppress benign ResizeObserver warning fired when a resize callback causes layout.
  if (e.message && e.message.indexOf('ResizeObserver loop') !== -1) { e.stopImmediatePropagation(); return; }
  var loc = (e.filename||'').replace(/.*\//, '') + (e.lineno ? ':'+e.lineno : '');
  console.error('[JS error]', e.message, loc, e.error);
  showErrorBanner(esc(e.message || 'Script error') + (loc ? ' (' + loc + ')' : ''));
});
window.addEventListener('unhandledrejection', function(e) {
  var msg = (e.reason && e.reason.message) ? e.reason.message : String(e.reason||'Promise rejected');
  console.error('[Unhandled rejection]', e.reason);
  // Suppress noisy offline/network errors from the service worker
  if (/fetch|network|failed to fetch/i.test(msg)) return;
  showErrorBanner(esc(msg));
});

window.addEventListener('load', function() {
  // Set default report year and dates
  var now = new Date();
  var y = now.getFullYear();
  document.getElementById('rpt-year').value = y;
  document.getElementById('rpt-from').value = y + '-01-01';
  document.getElementById('rpt-to').value = y + '-12-31';
  var ry = document.getElementById('rpt-insights-year'); if (ry) ry.value = y;
  var mf = document.getElementById('rpt-method-from');   if (mf && !mf.value) mf.value = y + '-01-01';
  var mt = document.getElementById('rpt-method-to');     if (mt && !mt.value) mt.value = y + '-12-31';
  var gvf = document.getElementById('rpt-gva-from');     if (gvf && !gvf.value) gvf.value = y + '-01-01';
  var gvt = document.getElementById('rpt-gva-to');       if (gvt && !gvt.value) gvt.value = y + '-12-31';
  // Attendance date range defaults
  document.getElementById('att-from').value = (y - 5) + '-01-01';
  document.getElementById('att-to').value = y + '-12-31';
  // Giving sync defaults
  document.getElementById('giving-sync-from').value = y + '-01-01';
  document.getElementById('giving-sync-to').value = now.toISOString().slice(0, 10);
  document.getElementById('rpt-att-from').value = y + '-01-01';
  document.getElementById('rpt-att-to').value = y + '-12-31';
  // Year-over-year checkboxes (last 5 years)
  var yc = document.getElementById('rpt-att-years');
  for (var i = 0; i < 5; i++) {
    var yr = y - i;
    var cb = document.createElement('label');
    cb.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:.82rem;cursor:pointer;';
    cb.innerHTML = '<input type="checkbox" name="stmt-year" value="' + yr + '"' + (i === 0 ? ' checked' : '') + '> ' + yr;
    yc.appendChild(cb);
  }
  // Attendance by Service multi-year checkboxes (last 5 years, 2 most recent pre-checked)
  var svcYc = document.getElementById('rpt-att-svc-years');
  for (var si = 0; si < 5; si++) {
    var syr = y - si;
    var scb = document.createElement('label');
    scb.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:.82rem;cursor:pointer;';
    scb.innerHTML = '<input type="checkbox" value="' + syr + '"' + (si < 2 ? ' checked' : '') + '> ' + syr;
    svcYc.appendChild(scb);
  }
  // Register SW
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', {scope: '/'}).catch(function(){});
  }
  var dv = document.getElementById('deploy-ver');
  if (dv) dv.textContent = 'v' + DEPLOY_VERSION;
  var bsy = document.getElementById('batch-stmt-year');
  if (bsy) bsy.value = y;
  // Fetch role first so UI restrictions apply before content loads
  api('/admin/api/me').then(function(d) {
    applyRoleUI(d && d.role ? d.role : 'admin', d && d.display_name);
  }).catch(function() {
    applyRoleUI('admin');
  }).finally(function() {
    loadTags();
    loadFunds();
    loadMemberTypes();
    // Members go straight to the people directory; everyone else gets the dashboard
    showTab(_userRole === 'member' ? 'people' : 'home');
  });
});
// ── ROLE UI ──────────────────────────────────────────────────────────────
function applyRoleUI(role, displayName) {
  _userRole = role || 'admin';
  if (_userRole === 'unknown') { location.href = '/chms'; return; }
  document.body.classList.remove('role-admin','role-finance','role-staff','role-member');
  document.body.classList.add('role-' + _userRole);
  var badge = document.getElementById('topbar-role');
  if (badge) {
    if (_userRole !== 'admin') {
      badge.textContent = displayName || _userRole;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }
}

// ── TAGS ──────────────────────────────────────────────────────────────
function loadTags() {
  api('/admin/api/tags').then(function(d) {
    allTags = d.tags || [];
    renderTagPills();
  });
}
function renderTagPills() {
  // No-op — pills replaced by filter drawer; drawer is rendered on open
}
function setPeopleTag(btn, tid) {
  // Legacy
  peopleFilter.tagId = tid;
  loadPeople(true);
  renderActiveFilterChips();
  updateFilterBadge();
}

// ── FILTER DRAWER ────────────────────────────────────────────────────
var _filterDrawerOpen = false;
function toggleFilterDrawer() {
  if (_filterDrawerOpen) closeFilterDrawer(); else openFilterDrawer();
}
function openFilterDrawer() {
  _filterDrawerOpen = true;
  renderFilterDrawer();
  document.getElementById('people-filter-drawer').style.display = 'flex';
  document.getElementById('people-filter-overlay').style.display = 'block';
}
function closeFilterDrawer() {
  _filterDrawerOpen = false;
  document.getElementById('people-filter-drawer').style.display = 'none';
  document.getElementById('people-filter-overlay').style.display = 'none';
}
function renderFilterDrawer() {
  // Member types
  var mtEl = document.getElementById('fd-member-types');
  if (mtEl) {
    mtEl.innerHTML = fdRadio('fd-mt', '', 'All', !peopleFilter.mt, 'setFdMt(\'\')')
      + _memberTypes.map(function(t) {
        var v = t.toLowerCase().replace(/\s+/g, '-');
        return fdRadio('fd-mt', v, t, peopleFilter.mt === v, 'setFdMt(\'' + v + '\')');
      }).join('');
  }
  // Tags — checkboxes so multiple tags can be AND-filtered simultaneously
  var tEl = document.getElementById('fd-tags');
  if (tEl) {
    tEl.innerHTML = allTags.map(function(t) {
      var checked = peopleFilter.tagIds.indexOf(String(t.id)) !== -1;
      return '<label style="display:flex;align-items:center;gap:9px;padding:6px 4px;cursor:pointer;font-size:.9rem;border-radius:6px;">'
        + '<input type="checkbox" name="filter-tag" value="' + t.id + '" ' + (checked ? 'checked' : '') + ' onchange="toggleFdTag(\'' + t.id + '\',this.checked)" style="flex-shrink:0;">'
        + '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + esc(t.color) + ';flex-shrink:0;"></span>'
        + esc(t.name) + '</label>';
    }).join('');
  }
  // Missing field checkboxes organized by category
  var mfEl = document.getElementById('fd-missing');
  if (mfEl) {
    var mfCategories = [
      { label: 'Main', fields: [{ v: 'dob', label: 'Birthday' }, { v: 'gender', label: 'Gender' }] },
      { label: 'Family', fields: [{ v: 'photo', label: 'Photo' }] },
      { label: 'Other', fields: [{ v: 'anniversary', label: 'Anniversary Date' }, { v: 'baptism', label: 'Baptism Date' }, { v: 'confirmation', label: 'Confirmation Date' }] },
      { label: 'Contact', fields: [{ v: 'email', label: 'Email' }, { v: 'phone', label: 'Phone' }, { v: 'address', label: 'Address' }] }
    ];
    mfEl.innerHTML = mfCategories.map(function(cat) {
      return '<div style="margin-bottom:10px;">'
        + '<div style="font-size:.72rem;font-weight:700;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">' + esc(cat.label) + '</div>'
        + cat.fields.map(function(f) {
          var checked = peopleFilter.missingFields.indexOf(f.v) !== -1;
          return '<label style="display:flex;align-items:center;gap:9px;padding:5px 4px;cursor:pointer;font-size:.9rem;border-radius:6px;">'
            + '<input type="checkbox" value="' + f.v + '" ' + (checked ? 'checked' : '') + ' onchange="toggleFdMissing(\'' + f.v + '\',this.checked)" style="flex-shrink:0;">'
            + esc(f.label) + '</label>';
        }).join('')
        + '</div>';
    }).join('');
  }
}
function fdRadio(name, val, label, checked, onchange) {
  return '<label style="display:flex;align-items:center;gap:9px;padding:6px 4px;cursor:pointer;font-size:.9rem;border-radius:6px;">'
    + '<input type="radio" name="' + name + '" value="' + val + '" ' + (checked ? 'checked' : '') + ' onchange="' + onchange + '" style="flex-shrink:0;">'
    + esc(label) + '</label>';
}
function setFdMt(v) {
  peopleFilter.mt = v;
  loadPeople(true);
  renderActiveFilterChips();
  updateFilterBadge();
  updateFdCount();
}
function toggleFdTag(id, on) {
  var sid = String(id);
  var idx = peopleFilter.tagIds.indexOf(sid);
  if (on && idx === -1) peopleFilter.tagIds.push(sid);
  else if (!on && idx !== -1) peopleFilter.tagIds.splice(idx, 1);
  loadPeople(true);
  renderActiveFilterChips();
  updateFilterBadge();
  updateFdCount();
}
function toggleFdMissing(v, on) {
  var idx = peopleFilter.missingFields.indexOf(v);
  if (on && idx === -1) peopleFilter.missingFields.push(v);
  else if (!on && idx !== -1) peopleFilter.missingFields.splice(idx, 1);
  loadPeople(true);
  renderActiveFilterChips();
  updateFilterBadge();
  updateFdCount();
}
function clearAllFilters() {
  peopleFilter.mt = '';
  peopleFilter.tagIds = [];
  peopleFilter.missingFields = [];
  loadPeople(true);
  renderFilterDrawer();
  renderActiveFilterChips();
  updateFilterBadge();
}
function updateFilterBadge() {
  var count = (peopleFilter.mt ? 1 : 0) + peopleFilter.tagIds.length + peopleFilter.missingFields.length;
  var badge = document.getElementById('p-filter-count');
  if (badge) { badge.textContent = count; badge.style.display = count > 0 ? 'inline-flex' : 'none'; }
  var mb = document.getElementById('p-members-btn');
  if (mb) { mb.style.background = peopleFilter.mt === 'member' ? 'var(--teal)' : ''; mb.style.color = peopleFilter.mt === 'member' ? '#fff' : ''; }
}
function toggleMemberFilter() {
  setFdMt(peopleFilter.mt === 'member' ? '' : 'member');
}
function updateFdCount() {
  var el = document.getElementById('fd-result-count');
  if (el) el.textContent = _peopleTotal ? _peopleTotal + ' people match' : '';
}
function renderActiveFilterChips() {
  var c = document.getElementById('p-active-filters');
  if (!c) return;
  var chips = [];
  if (peopleFilter.mt) {
    var label = _memberTypes.find(function(t){ return t.toLowerCase().replace(/\s+/g,'-') === peopleFilter.mt; }) || peopleFilter.mt;
    chips.push(filterChip(label, 'var(--steel-anchor)', "setFdMt('')"));
  }
  peopleFilter.tagIds.forEach(function(tid) {
    var tag = allTags.find(function(t){ return String(t.id) === tid; });
    if (tag) chips.push(filterChip(tag.name, tag.color, "toggleFdTag('" + tid + "',false)"));
  });
  var _mfLabels = { dob:'No Birthday', gender:'No Gender', photo:'No Photo', anniversary:'No Anniversary', baptism:'No Baptism Date', confirmation:'No Confirmation Date', email:'No Email', phone:'No Phone', address:'No Address' };
  peopleFilter.missingFields.forEach(function(v) {
    chips.push(filterChip(_mfLabels[v] || ('No ' + v), 'var(--warm-gray)', "toggleFdMissing('" + v + "',false)"));
  });
  c.innerHTML = chips.length
    ? chips.join('') + (chips.length > 1 ? '<button onclick="clearAllFilters()" style="font-size:.75rem;color:var(--teal);background:none;border:none;cursor:pointer;padding:2px 6px;font-weight:600;">Clear all</button>' : '')
    : '';
  c.style.display = chips.length ? 'flex' : 'none';
}
function filterChip(label, color, onclick) {
  return '<span style="display:inline-flex;align-items:center;gap:5px;background:' + color + ';color:#fff;border-radius:99px;padding:3px 11px;font-size:.78rem;font-weight:600;">'
    + esc(label)
    + '<span onclick="' + onclick + '" style="cursor:pointer;opacity:.75;font-size:13px;margin-left:2px;line-height:1;">&#215;</span>'
    + '</span>';
}
function openTagsManager() {
  openModal('tags-modal');
  api('/admin/api/tags').then(function(d) {
    allTags = d.tags || [];
    renderTagPills();
    renderTagsList();
  });
}
function renderTagsList() {
  var c = document.getElementById('tags-list');
  if (!allTags.length) { c.innerHTML = '<p style="color:var(--warm-gray);font-size:.85rem;">No tags yet.</p>'; return; }
  c.innerHTML = allTags.map(function(t) {
    return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--linen);">'
      + '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:' + esc(t.color) + ';flex-shrink:0;"></span>'
      + '<span style="flex:1;font-size:.9rem;">' + esc(t.name) + ' <span style="color:var(--warm-gray);font-size:.78rem;">(' + (t.person_count||0) + ')</span></span>'
      + '<button onclick="deleteTag(' + t.id + ')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:.85rem;">&#10005;</button>'
      + '</div>';
  }).join('');
}
function createTag() {
  var name = document.getElementById('new-tag-name').value.trim();
  var color = document.getElementById('new-tag-color').value;
  if (!name) return;
  api('/admin/api/tags', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,color:color})}).then(function() {
    document.getElementById('new-tag-name').value = '';
    openTagsManager();
  });
}
function deleteTag(id) {
  if (!confirm('Delete this tag? It will be removed from all people.')) return;
  api('/admin/api/tags/' + id, {method:'DELETE'}).then(function() { openTagsManager(); });
}

`;
