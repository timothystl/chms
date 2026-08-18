// Single source of truth for the app version — used both for the on-page display below (via
// interpolation into the served script) and as the cache-busting query param on the external
// app-member.js/app-staff.js/app-ext.js routes (see html-chms.js/tlc-volunteer-worker.js) so a
// version bump
// automatically invalidates the long-lived browser cache on those files, with nowhere else that
// needs updating in step.
export const DEPLOY_VERSION = '1.190.0';

export const JS_CORE = String.raw`<script>
// ── DEPLOY VERSION ───────────────────────────────────────────────────
var DEPLOY_VERSION = '${DEPLOY_VERSION}';
// ── MEMBER TYPES ──────────────────────────────────────────────────────
// Moved here from js-settings.js: this is boot state every role reads (the People filter chip
// label and the person-edit type <select>), and loadMemberTypes() runs unconditionally in the
// window 'load' handler below. Leaving it in the settings module meant the member-only bundle
// (core+people+households, no settings) would throw a ReferenceError before rendering anything.
var _memberTypes = ['Member','Attender','Visitor','Vietnamese Congregation','Other'];
function loadMemberTypes() {
  // The .catch is not optional: this runs unconditionally on every page load for every role,
  // and it was the ONLY one of the three boot calls without one (loadTags/loadFunds both had
  // it). Any rejection therefore escaped to the global handler and painted a bare
  // "Access denied" banner over a working page. The defaults in _memberTypes are fine to keep.
  api('/admin/api/config/member-types').then(function(d) {
    _memberTypes = d.types || _memberTypes;
    refreshMemberTypeSelect();
  }).catch(function(){});
}
function refreshMemberTypeSelect() {
  var sel = document.getElementById('pm-type');
  if (!sel) return;
  var cur = sel.value;
  sel.innerHTML = _memberTypes.map(function(t) {
    var v = t.toLowerCase().replace(/\s+/g,'-');
    return '<option value="' + v + '"' + (v===cur?' selected':'') + '>' + esc(t) + '</option>';
  }).join('');
  updatePersonNameMode();
}
window.onerror = function(msg, src, line, col, err) {
  // Benign browser quirks — suppress these and don't show the error banner.
  if (msg && String(msg).indexOf('ResizeObserver loop') !== -1) return true;
  // Mobile browsers (Samsung Internet, Brave) try to redefine navigator.userAgent for
  // anti-fingerprinting and throw this when the property is already non-configurable.
  if (msg && String(msg).indexOf('redefine property') !== -1) return true;
  var b = document.getElementById('js-error-banner');
  if (!b) { b = document.createElement('div'); b.id = 'js-error-banner';
    b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#c0392b;color:var(--white);padding:10px 16px;font-size:.82rem;z-index:99999;font-family:monospace;';
    document.body.appendChild(b); }
  b.textContent = 'JS Error: ' + msg + ' (line ' + line + ')';
  return false;
};
// ── STATE ────────────────────────────────────────────────────────────
var allTags = [], allFunds = [], currentBatchId = null, _currentBatch = null, peopleFilter = {q:'',mt:'member',tagIds:[],missingFields:[],gender:'',ageRange:'',householdSize:'',sacrament:'',offset:0,limit:25,sort:'last_name',dir:'asc'};
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
// Admin-configurable per-role flags (Settings -> Role Permissions), resolved server-side
// and delivered via /admin/api/me — see api-utils.js. Defaults permissive until that
// response lands (applyRoleUI always runs before the first showTab(), so this default is
// only a brief bootstrap fallback, never the real access-control decision).
var _userPermissions = { finance: true, staff: true, register: true, reports: true };
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
// Real HTML (not the old plain-textarea "\n"-marker format renderLetterHTML() still
// tolerates for pre-TinyMCE saved templates) — these are what TinyMCE actually displays
// and edits, so they need to look right in the rich editor from the first load, not just
// after the final \n->  substitution pass.
var DEFAULT_LETTER_TEMPLATE = '<p>Dear {{name}},</p><p>Thank you for your generous contributions to Timothy Lutheran Church during {{year}}. Your gifts make a difference in our ministry and community.</p><p>Below is a summary of your giving for {{year}}:</p>{{gift_table}}<p>Total Contributions: {{total}}</p><p>{{#if_ein}}Our EIN/Tax ID is {{ein}}. No goods or services were provided in exchange for these contributions. Please retain this letter for your tax records.{{/if_ein}}</p><p>With gratitude,</p><p>Timothy Lutheran Church</p><p>Date: {{date}}</p>';
var DEFAULT_MIDYEAR_LETTER_TEMPLATE = '<p>Dear {{name}},</p><p>As we reach the midpoint of {{year}}, we want to pause and say thank you. Your generosity to Timothy Lutheran Church sustains our ministry, our staff, and our mission in this community &mdash; and we do not take that for granted.</p><p>Below is a summary of your recorded giving for {{year}} so far:</p>{{gift_table}}<p>Total Giving to Date: {{total}}</p><p>Please take a moment to look this over. If anything looks off &mdash; a missing gift, an incorrect amount, or a gift recorded under the wrong name &mdash; please let the church office know so we can correct our records.</p><p>If you have been giving by check or cash and would like a simpler way to stay consistent, consider setting up recurring giving:</p><ul><li>{{#if_giving_url}}Online recurring giving: <a href="{{giving_url}}">{{giving_url}}</a>{{/if_giving_url}}</li><li>Automatic bank draft or bill pay through your bank</li><li>Contact the church office and we would be glad to help you set it up</li></ul><p>Thank you again for your generosity and your partnership in ministry.</p><p>With gratitude,</p><p>Timothy Lutheran Church</p><p>Date: {{date}}</p>';

// ── HELPERS ──────────────────────────────────────────────────────────
function api(path, opts) {
  return fetch(path, opts || {}).then(function(r) {
    if (r.status === 401) { location.href = '/chms'; return Promise.reject(new Error('Unauthorized')); }
    return r.json().then(function(data) {
      if (!r.ok && data && data.error && !opts) {
        return Promise.reject(new Error(data.error));
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
  // Year-only sentinel: "YYYY-00-00" displays as just the year, never an invented day
  if (p[1] === '00' && p[2].slice(0,2) === '00') return p[0];
  // Year-unknown sentinel: "0001-MM-DD" displays as month/day only
  if (p[0] === '0001') {
    var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var mIdx = parseInt(p[1]) - 1;
    var label = (monthNames[mIdx] || p[1]) + ' ' + parseInt(p[2]);
    return label;
  }
  return parseInt(p[1]) + '/' + parseInt(p[2]) + '/' + p[0];
}
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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
// ── SHARED AVATAR / STATUS-COLOR SYSTEM (People list, Person Profile, Household View) ──
var AVATAR_TINTS = [
  {bg:'var(--pale-gold)',fg:'#8A5A12'}, // gold
  {bg:'var(--blue-mist)',fg:'var(--color-teal)'}, // teal
  {bg:'#F0D7C4',fg:'#8A4A1E'}, // clay
  {bg:'#E6EEE6',fg:'#4E6E53'}, // sage
  {bg:'#DDE8F5',fg:'#2E4E8A'}, // periwinkle
  {bg:'#EFE0EF',fg:'#7A4A8A'}  // mauve
];
function avatarTint(id) {
  return AVATAR_TINTS[Math.abs(id||0) % AVATAR_TINTS.length];
}
// Matches the --status-* tokens in html-head.js :root exactly — same semantic
// member-type color mapping, kept here since callers need a JS-computed value.
var TYPE_COLORS = { member:'var(--status-member)', visitor:'var(--status-visitor)', associate:'var(--status-associate)', friend:'var(--status-friend)', inactive:'var(--status-inactive)', organization:'var(--status-organization)' };
function typeColor(mt) {
  return TYPE_COLORS[(mt||'visitor').toLowerCase()] || 'var(--warm-meta)';
}
// Color-coded dot + label — replaces the filled pill badge for member type everywhere.
// ── SHARED FUND-CODE GROUPING (Giving by Fund report, board fund table, Church Report) ──
// Funds are named "<code> <label>", and this church deliberately keeps several names under one
// code: "40085 General Fund", "40085 Lent" and "40085 Retirement Distribution" are all the
// General Fund as far as the ledger — and the board — is concerned. Every per-fund view combines
// on that leading code, so the rule lives here once instead of being hand-inlined per view where
// the copies can drift.
function fundCodeOf(name) {
  var m = String(name || '').match(/^(\d+)\s/);
  return m ? m[1] : null;
}
// rows → [{ code, label, rows, total }] in the input's own order (callers sort before calling).
// A fund whose name carries no numeric code gets its own single-row group rather than being
// lumped in with every other uncoded fund, so nothing is ever silently merged or dropped. The
// label is the highest-total member's real name, so a combined line reads "40085 General Fund"
// rather than a bare code.
function groupRowsByFundCode(rows, nameOf, totalOf) {
  var byKey = {}, order = [];
  (rows || []).forEach(function(r, i) {
    var code = fundCodeOf(nameOf(r));
    var key = code ? 'c' + code : 'u' + i;
    if (!byKey[key]) { byKey[key] = { code: code, label: '', rows: [], total: 0 }; order.push(key); }
    byKey[key].rows.push(r);
    byKey[key].total += (totalOf(r) || 0);
  });
  return order.map(function(key) {
    var g = byKey[key];
    var rep = g.rows.slice().sort(function(a, b) { return (totalOf(b) || 0) - (totalOf(a) || 0); })[0];
    g.label = nameOf(rep);
    return g;
  });
}
function mapUrl(addr) {
  return addr ? 'https://maps.apple.com/?q=' + encodeURIComponent(addr) : '';
}
// A real "open this address" action, styled as an action rather than the red "Map unavailable"
// error. Used where the embedded static map isn't available — for members (who can't reach the
// static-map endpoint, and shouldn't cost a paid API call), and as the fallback when the map
// image fails to load. Takes an ALREADY encodeURIComponent-encoded address, matching what the
// map call sites pass around.
function openInMapsHtml(encAddr) {
  return '<a href="https://maps.google.com/?q=' + encAddr + '" target="_blank" rel="noopener"'
    + ' style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:99px;'
    + 'background:var(--color-teal);color:var(--white);font-size:.85rem;font-weight:700;'
    + 'text-decoration:none;min-height:36px;box-sizing:border-box;">Open in Maps</a>';
}
// The static-map image failed. An img onerror cannot read the response body, so the old
// handling could only ever say "Map unavailable" with no reason — which is why this stayed
// unexplained for so long. Re-request the same URL as JSON to surface the server's actual
// reason: 501 means no GOOGLE_MAPS_API_KEY is configured, and a 502 carries Google's own text
// (commonly that the key is restricted to Address Validation and Maps Static API is not
// enabled on the project - see SECRETS.md). Only runs in the failure path.
function showMapError(el, encAddr) {
  el.innerHTML = '<div style="padding:8px;">' + openInMapsHtml(encAddr)
    + '<div id="map-err-why" style="margin-top:8px;font-size:12px;color:var(--warm-gray);">Map image could not be loaded.</div></div>';
  fetch('/admin/api/utils/static-map?address=' + encAddr)
    .then(function(r) { return r.json().then(function(d) { return { s: r.status, d: d }; }); })
    .then(function(res) {
      var why = document.getElementById('map-err-why');
      if (!why) return;
      var msg = res.s === 501
        ? 'Maps are not configured — set the GOOGLE_MAPS_API_KEY secret (see SECRETS.md).'
        : (res.d && res.d.google) ? 'Google says: ' + res.d.google
        : (res.d && res.d.error) ? res.d.error
        : 'Map image could not be loaded.';
      why.textContent = msg;
    })
    .catch(function() { /* leave the generic message */ });
}
function typeDotHtml(mt, size) {
  size = size || 8;
  var label = mt || 'Visitor';
  label = label.charAt(0).toUpperCase() + label.slice(1);
  var c = typeColor(mt);
  return '<span class="type-dot" style="width:'+size+'px;height:'+size+'px;background:'+c+';"></span><span class="type-label" style="color:'+c+';">'+esc(label)+'</span>';
}

// ── Financial Reports sub-nav (Overview / Church Report / Daycare Report) ──────────────
// Giving/Tuition Aid/Financial Reports are each their own top-level sidebar item (not
// collapsed) — this sub-nav bar only covers the 3 sections *within* the Financial Reports tab.
// (Giving Reports lives inside the Giving tab itself — see givSetView() in js-giving.js.)
var FIN_TOPNAV_ITEMS = [
  { id: 'health', label: 'Financial Health', finSection: 'health' },
  { id: 'church', label: 'Church Report', finSection: 'church' },
  { id: 'daycare', label: 'Daycare Report', finSection: 'daycare' },
  { id: 'property', label: 'Commercial Property', finSection: 'property' },
  { id: 'planning', label: 'Planning', finSection: 'planning' },
  { id: 'compensation', label: 'Compensation', finSection: 'compensation' },
  { divider: true },
  // Everything that used to be interleaved with the reports — connections, file imports,
  // hand-entered adjustments, the danger zone — lives behind this divider, off the reading pages.
  { id: 'data', label: 'Data & Imports', finSection: 'data' },
];
var _finActiveNavId = 'health';
function renderFinanceSubnav() {
  return FIN_TOPNAV_ITEMS.map(function(item) {
    if (item.divider) return '<span class="fin-subnav-divider"></span>';
    return '<button class="fin-subnav-btn' + (item.id === _finActiveNavId ? ' active' : '') + '" onclick="finNavGo(\'' + item.id + '\')">' + item.label + '</button>';
  }).join('');
}
function finRenderSubnavMounts() {
  var el = document.getElementById('fin-subnav-mount-finance');
  if (el) el.innerHTML = renderFinanceSubnav();
}
function finNavGo(id) {
  var item = FIN_TOPNAV_ITEMS.filter(function(i) { return i.id === id; })[0];
  if (!item) return;
  showTab('finance', item.finSection);
}

// ── TAB SWITCHING ─────────────────────────────────────────────────────
var _tabFromPopState = false;
// finSection is only used when name === 'finance' (which of Financial Health/Church Report/
// Daycare Report/... to show) — omit it to keep whatever finance section was last active (e.g.
// browser back/forward, or a bare '#finance' hash on reload), defaulting to 'health' the first
// time. See FIN_TOPNAV_ITEMS/finNavGo above.
function showTab(name, finSection) {
  // Member tier: the filtered directory, plus Reports only where an admin granted it. The
  // server's member allowlist covers people/tags/config-member-types/reports and nothing else,
  // so Home (dashboard), Households and Organizations have no member-readable data behind them
  // — landing on one renders an empty tab and fires a 403 banner, which is what a member hit on
  // 2026-08-03. Redirect to People rather than returning early, so a stale '#home' in the URL
  // (or a bookmark from an admin session) can't leave the app on a blank screen.
  if (_userRole === 'member' && !(name === 'people' || (name === 'reports' && _userPermissions.reports))) {
    name = 'people';
  }
  // Enforce role-based tab access — admin-configurable per role, see _userPermissions above.
  // This is a UX convenience (avoid landing on a blank/403'd tab); the real enforcement is
  // server-side in handleChmsApi's ACL block, which reads the same permissions.
  if (name === 'giving'     && !_userPermissions.finance)  return;
  if (name === 'tuitionaid' && !_userPermissions.finance)  return;
  if (name === 'finance'    && !_userPermissions.finance)  return;
  if (name === 'attendance' && !_userPermissions.staff)    return;
  if (name === 'register'   && !_userPermissions.register) return;
  if (name === 'reports'    && !_userPermissions.reports)  return;
  if (name === 'import'     && _userRole !== 'admin') return;
  if (name === 'settings'   && _userRole !== 'admin') return;
  if (name === 'volunteers' && _userRole !== 'admin') return;
  if (name === 'scheduler'  && _userRole !== 'admin') return;
  var labels = {home:'Home',people:'People',households:'Households',organizations:'Organizations',giving:'Giving',tuitionaid:'Tuition Aid Planner',finance:'Financial Reports',reports:'Reports',attendance:'Attendance',register:'Register',import:'Import',settings:'Settings',volunteers:'Volunteers',scheduler:'Scheduler'};
  // Push browser history so back button works (skip when responding to popstate)
  if (!_tabFromPopState) {
    history.pushState({ tab: name }, '', '#' + name);
  }
  // Exit person-profile / household / organization views if active
  var ca = document.querySelector('.content-area');
  if (ca) ca.classList.remove('pv-mode', 'hv-mode', 'ov-mode');
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
  // Re-entering Giving lands on whichever sub-view was last open (Offerings on a fresh load),
  // and givSetView is what actually loads that view's data — calling loadBatches() alone would
  // refresh a panel that may not even be the one on screen.
  if (name === 'giving') givSetView(_givView);
  if (name === 'tuitionaid') loadTuitionAid();
  if (name === 'finance') {
    // 'overview' was retired when the Overview panel became Financial Health — a bookmark or a
    // browser-history entry from before that change would otherwise land on a section id no
    // panel answers to, leaving the tab blank.
    if (finSection === 'overview') finSection = 'health';
    if (finSection) _finActiveNavId = finSection;
    loadFinance();
    finRenderSubnavMounts();
    if (typeof finShowSection === 'function') finShowSection(_finActiveNavId);
  }
  // ensureFullAppLoaded is a no-op for every role but member — see its definition. A member
  // granted Reports has the tab markup already (the shell ships all tabs) but not the code.
  if (name === 'reports') ensureFullAppLoaded(function() { initReports(); });
  if (name === 'attendance') loadAttendance();
  if (name === 'register') loadRegister();
  if (name === 'settings') loadSettings();
  if (name === 'volunteers') { volLoadSignups(); volLoadMinistryRoles(); volLoadEvents(); volLoadTemplates(); }
  if (name === 'scheduler') {
    ensureSchedulerLoaded(function() {
      // Set month label directly — bypasses all silent try/catch in schedInitScheduler.
      // Scheduler's own currentMonthKey is always today's month at init time; match that.
      var _sml = document.getElementById('sched-current-month-label');
      if (_sml) _sml.textContent = new Date().toLocaleDateString('en-US', {month:'long', year:'numeric'});
      if (window.schedInitScheduler && !window._schedInited) {
        window.schedInitScheduler();
      }
    });
  }
}
// ── Lazy-load the rest of the app (member sessions only) ────────────────────
// A member session is served ONE script — /admin/app-member.js (core + people + households).
// Every other role gets that plus app-staff.js and app-ext.js, so for them the code below never
// runs: the guard is a typeof check on initReports, which for them is already defined.
//
// The one member surface that lives outside the member bundle is the Reports tab, which an
// admin can grant to the member role (DEFAULT_ROLE_PERMISSIONS has it at 'none', so this is the
// exception, not the common path). Rather than fold ~180KB of reports+attendance code into
// every member's first load for a permission most of them will never have, fetch it on the
// first open.
//
// Both files are loaded, in the same order the non-member shell emits them, because that is the
// only combination that has ever been exercised: js-reports calls into js-attendance
// (_buildAttYoYHtml, _chartResizeHandle, MONTH_NAMES) and reaches for js-settings/js-dashboard
// helpers in places, so loading ext alone would swap one ReferenceError for another. Loading
// both lands the member on exactly the bundle set every other role already runs.
var _fullAppLoadState = 0; // 0 = not loaded, 1 = in flight, 2 = ready
var _fullAppWaiting = [];
function loadAppScript(src) {
  return new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = function() { reject(new Error('Failed to load ' + src)); };
    document.body.appendChild(s);
  });
}
function ensureFullAppLoaded(cb) {
  if (_fullAppLoadState === 2 || typeof initReports === 'function') { cb(); return; }
  _fullAppWaiting.push(cb);
  if (_fullAppLoadState === 1) return; // a load is already running; cb rides along
  _fullAppLoadState = 1;
  loadAppScript('/admin/app-staff.js?v=' + DEPLOY_VERSION)
    .then(function() { return loadAppScript('/admin/app-ext.js?v=' + DEPLOY_VERSION); })
    .then(function() {
      _fullAppLoadState = 2;
      var queued = _fullAppWaiting; _fullAppWaiting = [];
      queued.forEach(function(fn) { try { fn(); } catch (e) { console.error(e); } });
    })
    .catch(function(e) {
      console.error('App bundle load failed:', e);
      _fullAppLoadState = 0;
      _fullAppWaiting = [];
      showErrorBanner('Could not load that section. Check your connection and try again.');
    });
}
// ── Lazy-load the Scheduler embed ───────────────────────────────────────────
// The Scheduler's markup/CSS/JS is ~321KB and used to be inlined into the page
// shell, which is served no-store — so every page load re-downloaded it, for
// every user, even though the tab is admin-only and most sessions never open
// it. It now lives at two immutable ?v=DEPLOY_VERSION routes and is fetched the
// first time this tab is opened; after that it's a browser cache hit.
//
// Order matters: the markup has to be in the DOM before the script runs, and a
// <script> inside an innerHTML assignment never executes — hence the explicit
// two-step (inject markup, then append a real <script> element).
var _schedLoadState = 0; // 0 = not loaded, 1 = in flight, 2 = ready
var _schedWaiting = [];
function ensureSchedulerLoaded(cb) {
  if (_schedLoadState === 2) { cb(); return; }
  _schedWaiting.push(cb);
  if (_schedLoadState === 1) return; // a load is already running; cb rides along
  _schedLoadState = 1;
  var host = document.getElementById('tab-scheduler');
  if (!host) { _schedLoadState = 0; _schedWaiting = []; return; }
  host.innerHTML = '<div style="padding:48px 24px;text-align:center;color:var(--warm-gray);">Loading Scheduler&hellip;</div>';
  fetch('/admin/scheduler-embed.html?v=' + DEPLOY_VERSION, { credentials: 'same-origin' })
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function(markup) {
      host.innerHTML = markup;
      return new Promise(function(resolve, reject) {
        var s = document.createElement('script');
        s.src = '/admin/scheduler-embed.js?v=' + DEPLOY_VERSION;
        s.onload = resolve;
        s.onerror = function() { reject(new Error('Scheduler script failed to load')); };
        document.body.appendChild(s);
      });
    })
    .then(function() {
      _schedLoadState = 2;
      var queued = _schedWaiting; _schedWaiting = [];
      queued.forEach(function(fn) { try { fn(); } catch (e) { console.error(e); } });
    })
    .catch(function(e) {
      console.error('Scheduler load failed:', e);
      _schedLoadState = 0;
      _schedWaiting = [];
      host.innerHTML = '<div style="padding:48px 24px;text-align:center;color:var(--warm-gray);">'
        + 'Could not load the Scheduler. Check your connection and try the tab again.</div>';
    });
}
// Navigate to a person's profile from any tab (fetches person, switches to People tab)
function goToProfile(id) {
  showTab('people');
  openPersonDetail(id);
}

// Browser back/forward support — restore tab from history state
window.addEventListener('popstate', function(e) {
  var tab = (e.state && e.state.tab) || location.hash.replace('#', '') || 'home';
  _tabFromPopState = true;
  showTab(tab);
  _tabFromPopState = false;
});
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
  // Attendance date range defaults (the 1a redesign's This-Week/Trends/Festivals/History/
  // Reports tabs load a fixed wide window themselves — see loadAttendance() in
  // js-attendance.js — these two filter inputs no longer exist in the redesigned tab, but
  // are guarded rather than removed here in case a future view reintroduces them)
  var attFromEl = document.getElementById('att-from'); if (attFromEl) attFromEl.value = (y - 5) + '-01-01';
  var attToEl = document.getElementById('att-to');     if (attToEl) attToEl.value = y + '-12-31';
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
  var dvs = document.getElementById('deploy-ver-side');
  if (dvs) dvs.textContent = 'v' + DEPLOY_VERSION;
  var bsy = document.getElementById('batch-stmt-year');
  if (bsy) bsy.value = y;
  // Fetch role first so UI restrictions apply before content loads
  // Fail CLOSED. This used to default to applyRoleUI('admin') both when /me returned no role
  // and when the call rejected outright — so a single flaky request on a phone rendered the
  // FULL admin UI for whoever was signed in. The data was never exposed (ACCESS_GATE 403s
  // server-side regardless), but every tab was visible and clickable, and clicking one
  // produced a bare "Access denied" with no explanation — which is exactly what a member
  // account hit on 2026-08-03. Defaulting to the most restrictive role instead means a
  // failed /me under-shows rather than over-shows, and the banner tells the user to reload.
  api('/admin/api/me').then(function(d) {
    if (!d || !d.role || d.role === 'unknown') {
      applyRoleUI('member');
      showRoleLoadError();
      return;
    }
    applyRoleUI(d.role, d.display_name, d.permissions);
  }).catch(function() {
    applyRoleUI('member');
    showRoleLoadError();
  }).finally(function() {
    loadTags();
    // Funds are giving data — the member allowlist doesn't include them, so for a member this
    // is a guaranteed 403. It fails silently, but it's still a wasted round trip on exactly the
    // connection (a phone, on the church's network) where the member tier actually lives.
    if (_userRole !== 'member') loadFunds();
    loadMemberTypes();
    initPeopleViewMode();
    // Restore tab from URL hash (back/forward or bookmarked link), otherwise default
    var hashTab = location.hash.replace('#', '');
    var defaultTab = _userRole === 'member' ? 'people' : 'home';
    // Replace initial state so back button from first tab exits the app cleanly
    history.replaceState({ tab: hashTab || defaultTab }, '', location.href);
    showTab(hashTab || defaultTab);
  });
});
// ── ROLE UI ──────────────────────────────────────────────────────────────
// Shown when /admin/api/me couldn't be resolved. The UI has fallen back to the most
// restrictive role, so tabs are missing rather than wrongly present — say so plainly instead
// of letting the user think their account was changed.
function showRoleLoadError() {
  showErrorBanner('Could not confirm your account permissions, so access has been limited. Reload to try again.');
}

function applyRoleUI(role, displayName, permissions) {
  _userRole = role || 'member';
  // Reload rather than navigating to a hardcoded '/chms' (the pre-CONN6 path — the app is
  // served at '/' on connect.timothystl.org). A reload lands on the login page from any host.
  if (_userRole === 'unknown') { location.reload(); return; }
  // Admin always full access (matches the backend's fixed admin bypass). Every other role
  // with a missing permissions payload now falls back to NOTHING rather than to everything:
  // the old permissive default was the second half of the same fail-open bug as the /me
  // handler above, granting a non-admin the full permission set whenever the payload was
  // absent. Server-side ACCESS_GATE was always the real enforcement; this just stops the UI
  // from advertising controls the caller will only get a 403 from.
  _userPermissions = _userRole === 'admin'
    ? { finance: true, staff: true, register: true, reports: true }
    : (permissions || { finance: false, staff: false, register: false, reports: false });
  document.body.classList.remove('role-admin','role-finance','role-staff','role-council','role-member');
  document.body.classList.add('role-' + _userRole);
  applyPermissionUI(_userPermissions);
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
// Resolved per-item level map for the current role, e.g. {giving:'edit', reports:'view', …}.
// Delivered by /admin/api/me (see api-utils.js permissionsForRole). Kept here so any code
// can ask permView()/permEdit() about the logged-in user.
var _perm = {};
function permView(item) { return _userRole === 'admin' || (!!_perm[item] && _perm[item] !== 'none'); }
function permEdit(item) { return _userRole === 'admin' || _perm[item] === 'edit'; }
// Giving at the 'anon' level: totals yes, donors never. permView('giving') is deliberately
// true for it (the Giving nav and the aggregate reports are the whole point), so anything
// that names a giver has to ask this instead. Mirrors isAnonSafeGivingSeg on the server —
// the server is the enforcement; this is what stops the UI offering a guaranteed 403.
function permGivingAnon() { return _userRole !== 'admin' && _perm.giving === 'anon'; }
// May this user see an individual person's giving?
function permGivingNamed() { return permView('giving') && !permGivingAnon(); }
// Drives feature-tab visibility (by VIEW level) and per-feature edit affordances (by EDIT
// level) from the resolved permissions — these are the admin-configurable areas
// (Settings -> Users -> Role Permissions). .require-admin/.no-member/.require-edit stay
// governed by the static role-based CSS in html-head.js (People/Households editing and
// admin-only surfaces are not part of the configurable matrix).
function applyPermissionUI(perms) {
  _perm = perms || {};
  // Tab / section visibility by VIEW level. require-finance == the Giving/Financial-Reports
  // area (giving item); tuitionaid/financeov/attendance/register/reports are their own items.
  var viewMap = {
    'require-finance': 'giving', 'require-tuitionaid': 'tuitionaid', 'require-financeov': 'finance',
    'require-attendance': 'attendance', 'require-register': 'register', 'require-reports': 'reports',
  };
  Object.keys(viewMap).forEach(function(cls) {
    var allowed = permView(viewMap[cls]);
    document.querySelectorAll('.' + cls).forEach(function(el) {
      el.style.display = allowed ? '' : 'none';
    });
  });
  // Surfaces that name an individual giver — batches, transactions, deposits, letters,
  // statements, per-donor reports, the profile Giving tab. Hidden for an anon-giving role,
  // whose requests to them the server refuses anyway. Set inline (not via a body class) so
  // it composes with the .require-finance pass above, which writes the same property.
  if (permGivingAnon()) {
    document.querySelectorAll('.require-giving-named').forEach(function(el) {
      el.style.display = 'none';
    });
  }
  document.body.classList.toggle('perm-giving-anon', permGivingAnon());
  // The Finance section header shows if ANY of its three items is visible.
  var finHdr = document.getElementById('s-hdr-finance');
  if (finHdr) finHdr.style.display = (permView('giving') || permView('tuitionaid') || permView('finance')) ? '' : 'none';
  // Per-feature edit affordances via body classes (see html-head.js CSS). Robust for
  // controls rendered after this runs, unlike a one-time el.style pass.
  ['giving', 'tuitionaid', 'finance', 'attendance', 'followups', 'register'].forEach(function(it) {
    document.body.classList.toggle('perm-edit-' + it, permEdit(it));
  });
}

// ── TAGS ──────────────────────────────────────────────────────────────
function loadTags() {
  api('/admin/api/tags').then(function(d) {
    allTags = d.tags || [];
    renderTagPills();
  }).catch(function(){});
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
var FD_SORT_FIELDS = [
  { v: 'last_name', label: 'Last Name' },
  { v: 'first_name', label: 'First Name' },
  { v: 'member_type', label: 'Member Type' },
  { v: 'household', label: 'Household' },
  { v: 'created_at', label: 'Recently Added' },
  { v: 'dob', label: 'Date of Birth', missing: 'dob' },
  { v: 'baptism', label: 'Baptism Date', missing: 'baptism' },
  { v: 'confirmation', label: 'Confirmation Date', missing: 'confirmation' },
  { v: 'anniversary', label: 'Anniversary Date', missing: 'anniversary' }
];
function renderFilterDrawer() {
  // Sort by
  var sortEl = document.getElementById('fd-sort');
  if (sortEl) {
    sortEl.innerHTML = FD_SORT_FIELDS.map(function(f) {
      var active = peopleFilter.sort === f.v;
      var row = '<label onclick="setFdSort(\'' + f.v + '\')" style="display:flex;align-items:center;gap:9px;padding:6px 4px;cursor:pointer;font-size:.9rem;border-radius:6px;' + (active ? 'background:var(--linen);' : '') + '">'
        + '<input type="radio" name="fd-sort" ' + (active ? 'checked' : '') + ' style="flex-shrink:0;pointer-events:none;" tabindex="-1">'
        + '<span style="flex:1;">' + esc(f.label) + '</span>'
        + (active ? '<span style="font-size:11px;color:var(--teal);">' + (peopleFilter.dir === 'asc' ? '&#9650;' : '&#9660;') + '</span>' : '');
      if (f.missing) {
        var checked = peopleFilter.missingFields.indexOf(f.missing) !== -1;
        row += '<span onclick="event.stopPropagation();toggleFdMissing(\'' + f.missing + '\',' + (!checked) + ')" style="display:flex;align-items:center;gap:4px;font-size:.72rem;color:' + (checked ? 'var(--teal)' : 'var(--warm-gray)') + ';cursor:pointer;margin-left:8px;white-space:nowrap;" title="Only show people missing this field">'
          + '<input type="checkbox" ' + (checked ? 'checked' : '') + ' style="pointer-events:none;width:13px;height:13px;">Not set</span>';
      }
      return row + '</label>';
    }).join('');
  }
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
  // Gender filter
  var gEl = document.getElementById('fd-gender');
  if (gEl) {
    var genders = [{v:'', label:'Any'}, {v:'Male', label:'Male'}, {v:'Female', label:'Female'}, {v:'Unknown', label:'Not set'}];
    gEl.innerHTML = genders.map(function(g) {
      return fdRadio('fd-gender', g.v, g.label, peopleFilter.gender === g.v, 'setFdGender(\'' + g.v + '\')');
    }).join('');
  }
  // Age range filter
  var arEl = document.getElementById('fd-age-range');
  if (arEl) {
    var ranges = [{v:'', label:'Any'}, {v:'under_18', label:'Under 18'}, {v:'18_29', label:'18–29'}, {v:'30_44', label:'30–44'}, {v:'45_64', label:'45–64'}, {v:'65_plus', label:'65+'}];
    arEl.innerHTML = ranges.map(function(r) {
      return fdRadio('fd-age-range', r.v, r.label, peopleFilter.ageRange === r.v, 'setFdAgeRange(\'' + r.v + '\')');
    }).join('');
  }
  // Missing field checkboxes organized by category
  var mfEl = document.getElementById('fd-missing');
  if (mfEl) {
    var mfCategories = [
      { label: 'Main', fields: [{ v: 'gender', label: 'Gender' }] },
      { label: 'Family', fields: [{ v: 'photo', label: 'Photo' }] },
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
  renderFilterDrawer();
  renderActiveFilterChips();
  updateFilterBadge();
  updateFdCount();
}
function setFdSort(v) {
  sortPeople(v);
  renderFilterDrawer();
}
function setFdGender(v) {
  peopleFilter.gender = v;
  loadPeople(true);
  renderActiveFilterChips();
  updateFilterBadge();
  updateFdCount();
}
function setFdAgeRange(v) {
  peopleFilter.ageRange = v;
  loadPeople(true);
  renderActiveFilterChips();
  updateFilterBadge();
  updateFdCount();
}
function clearAllFilters() {
  peopleFilter.mt = '';
  peopleFilter.tagIds = [];
  peopleFilter.missingFields = [];
  peopleFilter.gender = '';
  peopleFilter.ageRange = '';
  loadPeople(true);
  renderFilterDrawer();
  renderActiveFilterChips();
  updateFilterBadge();
}
function updateFilterBadge() {
  var count = (peopleFilter.mt ? 1 : 0) + peopleFilter.tagIds.length + peopleFilter.missingFields.length + (peopleFilter.gender ? 1 : 0) + (peopleFilter.ageRange ? 1 : 0);
  var badge = document.getElementById('p-filter-count');
  if (badge) { badge.textContent = count; badge.style.display = count > 0 ? 'inline-flex' : 'none'; }
  var mb = document.getElementById('p-members-btn');
  if (mb) { mb.style.background = peopleFilter.mt === 'member' ? 'var(--teal)' : ''; mb.style.color = peopleFilter.mt === 'member' ? 'var(--white)' : ''; }
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
  if (peopleFilter.gender) chips.push(filterChip('Gender: ' + peopleFilter.gender, 'var(--color-teal)', "setFdGender('')"));
  var _arLabels = { under_18:'Age: Under 18', '18_29':'Age: 18–29', '30_44':'Age: 30–44', '45_64':'Age: 45–64', '65_plus':'Age: 65+' };
  if (peopleFilter.ageRange) chips.push(filterChip(_arLabels[peopleFilter.ageRange] || peopleFilter.ageRange, 'var(--color-gold)', "setFdAgeRange('')"));
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
  return '<span style="display:inline-flex;align-items:center;gap:5px;background:' + color + ';color:var(--white);border-radius:99px;padding:3px 11px;font-size:.78rem;font-weight:600;">'
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
