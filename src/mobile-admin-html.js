// ── Mobile Admin (phone-optimized quick-access page) ───────────────────────
// Auto-served at the app's normal URL (connect.timothystl.org — no separate /admin or
// /mobile path) whenever the request's User-Agent looks like a phone; see
// wantsMobileShell() in tlc-volunteer-worker.js. Self-contained HTML+CSS+JS, same
// pattern as LOGIN_HTML / the standalone scheduler page — not a framework, plain DOM
// string templates + delegated click listeners (data-action attributes, not inline
// onclick with interpolated arguments — see SEC13/SEC14 in CLAUDE.md for why: esc()'d
// text inside an onclick's quotes is exactly the escaping trap that shipped stored XSS
// three times in this app already). Serves every non-volunteer role, member included —
// its dashboard/people/person-detail all degrade to that role's real access (see
// api-mobile.js): a member sees just the directory shortcut, no attendance or
// follow-ups cards, and the people/person-detail data is filtered exactly like the
// main People API filters a member session. The desktop-oriented admin SPA stays
// reachable from the sidebar's "Full App" link (?desktop=1, a 30-day cookie).
import { DEPLOY_VERSION } from './frontend/js-core.js';

export const MOBILE_ADMIN_HTML = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover">
<title>Connect — Mobile Admin</title>
<link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png?v=${DEPLOY_VERSION}">
<link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png?v=${DEPLOY_VERSION}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{
  --navy:#1E2D4A;--teal:#2E7EA6;--gold:#C9973A;
  --ice-blue:#C4DDE8;--blue-mist:#EAF4FA;
  --pale-sage:#CDE0CF;--sage-text:#3E6B45;
  --pale-gold:#F5E0B0;--gold-text:#8A6416;
  --linen:#F1EFE9;--warm-white:#FAF9F6;--white:#fff;
  --border:#E8E0D0;--charcoal:#1A1A2A;--warm-gray:#8A8377;--danger:#B85C3A;
}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;height:100%;background:var(--warm-white);}
body{font-family:'DM Sans','Source Sans 3',Arial,sans-serif;color:var(--charcoal);-webkit-tap-highlight-color:transparent;}
button{font-family:inherit;}
a{text-decoration:none;}
#app-shell{max-width:480px;margin:0 auto;min-height:100vh;background:var(--warm-white);display:flex;flex-direction:column;position:relative;overflow-x:hidden;}

/* Splash */
#splash{position:fixed;inset:0;background:var(--navy);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;z-index:500;transition:opacity .25s ease;}
#splash.hide{opacity:0;pointer-events:none;}
#splash img{width:96px;height:96px;object-fit:contain;filter:brightness(0) invert(1);opacity:.96;animation:mobPulse 1.4s ease-in-out infinite;}
@keyframes mobPulse{0%,100%{opacity:.35;transform:scale(.94)}50%{opacity:1;transform:scale(1)}}
.splash-track{width:120px;height:3px;background:rgba(255,255,255,.18);border-radius:2px;overflow:hidden;}
.splash-bar{width:40%;height:100%;background:var(--gold);border-radius:2px;animation:mobBar 1s ease-in-out infinite;}
@keyframes mobBar{0%{transform:translateX(-100%)}100%{transform:translateX(240%)}}

/* Topbar */
#topbar{height:54px;flex-shrink:0;background:var(--white);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;padding:0 14px;position:sticky;top:0;z-index:20;}
#topbar button{background:none;border:none;padding:6px;cursor:pointer;display:flex;}
#topbar-title{display:flex;align-items:center;gap:8px;flex:1;min-width:0;}
#topbar-title img{width:24px;height:24px;object-fit:contain;flex-shrink:0;}
#topbar-title span{font-weight:700;font-size:14px;color:var(--navy);letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

/* Sidebar */
#sb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:90;opacity:0;pointer-events:none;transition:opacity .2s;}
#sb-overlay.open{opacity:1;pointer-events:auto;}
#sidebar{position:fixed;left:-220px;top:0;bottom:0;width:210px;background:var(--navy);z-index:95;display:flex;flex-direction:column;transition:left .22s ease;overflow-y:auto;}
#sidebar.open{left:0;}
.sb-brand{display:flex;flex-direction:column;align-items:center;gap:8px;padding:18px 8px 16px;flex-shrink:0;}
.sb-brand img{width:38px;height:38px;object-fit:contain;filter:brightness(0) invert(1);}
.sb-brand div{font-weight:700;font-size:13px;letter-spacing:.06em;color:#fff;text-align:center;}
.sb-item{display:flex;align-items:center;gap:12px;background:transparent;border:none;border-left:3px solid transparent;padding:12px 16px;color:#fff;font-size:14px;font-weight:600;cursor:pointer;text-align:left;width:100%;}
.sb-item.active{background:rgba(46,126,166,.22);border-left-color:var(--teal);}
.sb-item span.ic{width:18px;text-align:center;opacity:.9;}

/* Content */
#content{flex:1;overflow-y:auto;background:var(--warm-white);-webkit-overflow-scrolling:touch;}
.mob-pad{padding:16px;display:flex;flex-direction:column;gap:14px;}
.mob-card{background:var(--white);border-radius:14px;box-shadow:0 1px 3px rgba(20,20,40,.06),0 8px 20px rgba(20,20,40,.05);overflow:hidden;}
.mob-card-head{padding:14px 16px 10px;display:flex;align-items:baseline;justify-content:space-between;}
.mob-card-head b{font-weight:700;font-size:15px;color:var(--navy);}
.mob-card-head .sub{font-size:12px;color:var(--warm-gray);}
.svc-row{border-top:1px solid var(--border);padding:12px 16px;display:flex;flex-direction:column;gap:10px;}
.svc-row-top{display:flex;align-items:center;justify-content:space-between;}
.svc-label{font-size:14px;font-weight:600;color:var(--charcoal);}
.svc-btn{background:var(--blue-mist);border:none;color:var(--navy);font-weight:700;font-size:12.5px;padding:7px 14px;border-radius:8px;cursor:pointer;}
.svc-entry{display:flex;align-items:center;gap:10px;}
.svc-entry input{flex:1;height:48px;border:1.5px solid var(--border);border-radius:10px;font-size:1.3rem;font-weight:700;color:var(--navy);padding:0 12px;font-family:inherit;min-width:0;}
.svc-entry button{height:48px;padding:0 18px;background:var(--navy);color:#fff;border:none;border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;}
.ppl-shortcut{display:flex;align-items:center;gap:10px;background:var(--white);border:1.5px solid var(--border);border-radius:12px;padding:13px 14px;cursor:pointer;text-align:left;width:100%;}
.ppl-shortcut span.lbl{color:var(--warm-gray);font-size:14px;flex:1;}
.ppl-shortcut span.cnt{font-size:12px;color:var(--teal);font-weight:700;}
.notif-badge{font-size:12px;font-weight:700;color:#fff;background:var(--gold);border-radius:20px;padding:2px 9px;}
.notif-row{width:100%;text-align:left;background:none;border:none;cursor:pointer;border-top:1px solid var(--border);padding:11px 16px;display:flex;gap:10px;align-items:flex-start;}
.notif-dot{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;margin-top:1px;}
.notif-body{flex:1;min-width:0;}
.notif-title{font-size:13.5px;font-weight:600;color:var(--charcoal);}
.notif-title.done{text-decoration:line-through;opacity:.45;}
.notif-sub{font-size:12.5px;color:var(--warm-gray);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.notif-time{font-size:11px;color:var(--warm-gray);white-space:nowrap;flex-shrink:0;}
.empty-note{padding:14px 16px;font-size:13px;color:var(--warm-gray);}

/* People */
.ppl-title{font-weight:800;font-size:20px;color:var(--navy);}
.search-wrap{position:relative;}
.search-wrap svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);}
.search-wrap input{width:100%;padding:11px 12px 11px 36px;border:1.5px solid var(--border);border-radius:10px;font-size:14px;font-family:inherit;box-sizing:border-box;}
.chip-row{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;}
.chip{flex-shrink:0;padding:7px 15px;border-radius:20px;border:1.5px solid var(--border);background:var(--white);color:#3D627C;font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap;}
.chip.active{border-color:var(--navy);background:var(--navy);color:#fff;}
.result-count{font-size:12px;color:var(--warm-gray);margin-top:2px;}
.ppl-row{display:flex;align-items:center;gap:12px;background:none;border:none;border-top:1px solid var(--border);padding:11px 2px;cursor:pointer;text-align:left;width:100%;}
.avatar{border-radius:50%;background:var(--ice-blue);color:var(--navy);display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;}
.avatar-42{width:42px;height:42px;font-size:14px;}
.avatar-64{width:64px;height:64px;font-size:22px;}
.avatar-30{width:30px;height:30px;font-size:11px;background:var(--blue-mist);}
.ppl-row-body{flex:1;min-width:0;}
.ppl-row-name{font-size:14.5px;font-weight:600;color:var(--charcoal);}
.ppl-row-sub{font-size:12.5px;color:var(--warm-gray);}
.status-pill{font-size:11px;font-weight:700;padding:3px 9px;border-radius:12px;flex-shrink:0;}
.load-more{padding:12px;text-align:center;color:var(--teal);font-weight:700;font-size:13px;background:none;border:none;cursor:pointer;width:100%;}

/* Person detail */
.back-link{background:none;border:none;color:var(--teal);font-weight:700;font-size:13px;cursor:pointer;padding:0;text-align:left;display:flex;align-items:center;gap:4px;}
.person-head{display:flex;align-items:center;gap:14px;}
.person-name{font-weight:800;font-size:20px;color:var(--navy);}
.contact-card a{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);}
.contact-card a:last-child{border-bottom:none;}
.contact-card svg{flex-shrink:0;}
.contact-card span.val{font-size:14px;color:var(--teal);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.contact-card .addr-val{font-size:14px;color:var(--teal);font-weight:600;line-height:1.4;white-space:normal;}
.contact-card .addr-hint{font-size:12px;color:var(--warm-gray);font-weight:500;}
.hh-title{padding:12px 16px 8px;font-weight:700;font-size:13px;color:var(--navy);}
.hh-row{display:flex;align-items:center;gap:10px;padding:9px 16px;border-top:1px solid var(--border);}
.hh-name{font-size:13.5px;color:var(--charcoal);font-weight:500;}
.hh-rel{font-size:12px;color:var(--warm-gray);}
.state-msg{padding:40px 16px;text-align:center;color:var(--warm-gray);font-size:14px;}

/* Attendance */
.att-hist-row{border-top:1px solid var(--border);padding:11px 16px;display:flex;align-items:center;gap:10px;}
.att-hist-body{flex:1;min-width:0;}
.att-hist-title{font-size:13.5px;font-weight:600;color:var(--charcoal);}
.att-hist-sub{font-size:12px;color:var(--warm-gray);}
.att-hist-count{font-size:15px;font-weight:700;color:var(--navy);}
.att-hist-row input{width:56px;height:36px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;font-weight:700;color:var(--navy);padding:0 8px;font-family:inherit;text-align:center;}
.att-hist-actions{display:flex;gap:6px;}
.att-icon-btn{background:none;border:none;color:var(--teal);font-weight:700;font-size:12px;cursor:pointer;padding:4px 6px;}
.att-icon-btn.danger{color:var(--danger);}
.att-add-btn{width:100%;padding:12px;border-radius:12px;border:1.5px dashed var(--border);background:none;color:var(--teal);font-weight:700;font-size:13.5px;cursor:pointer;}
.att-form{display:flex;flex-direction:column;gap:10px;padding:14px 16px;}
.att-form label{font-size:12px;font-weight:700;color:var(--warm-gray);display:block;margin-bottom:4px;}
.att-form input,.att-form select{width:100%;height:44px;border:1.5px solid var(--border);border-radius:10px;font-size:14px;padding:0 12px;font-family:inherit;box-sizing:border-box;}
.att-form-row{display:flex;gap:10px;}
.att-form-row>div{flex:1;}
.att-form-actions{display:flex;gap:10px;margin-top:2px;}
.att-form-actions button{flex:1;height:44px;border-radius:10px;font-weight:700;font-size:13.5px;cursor:pointer;border:none;}
.att-form-save{background:var(--navy);color:#fff;}
.att-form-cancel{background:var(--linen);color:var(--charcoal);}
</style>
</head>
<body>

<div id="app-shell">
  <div id="splash">
    <img src="/icons/connect-mark.png?v=${DEPLOY_VERSION}" alt="">
    <div class="splash-track"><div class="splash-bar"></div></div>
  </div>

  <div id="topbar" style="display:none;">
    <button id="btn-menu" aria-label="Menu">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M3 12h18M3 18h18" stroke="#1E2D4A" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
    <div id="topbar-title"><img src="/icons/connect-mark.png?v=${DEPLOY_VERSION}" alt=""><span id="topbar-title-text">Dashboard</span></div>
    <button id="btn-search" aria-label="Search people">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="#1E2D4A" stroke-width="2"/><path d="M21 21l-4-4" stroke="#1E2D4A" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
  </div>

  <div id="sb-overlay"></div>
  <div id="sidebar">
    <div class="sb-brand"><img src="/icons/connect-mark.png?v=${DEPLOY_VERSION}" alt=""><div>CONNECT</div></div>
    <button class="sb-item" data-nav="home"><span class="ic">&#9632;</span>Dashboard</button>
    <button class="sb-item" data-nav="people"><span class="ic">&#9633;</span>People</button>
    <button class="sb-item" data-nav="attendance"><span class="ic">&#10003;</span>Attendance</button>
    <button class="sb-item" data-fullapp="1"><span class="ic">&#8801;</span>Full App</button>
  </div>

  <div id="content"></div>
</div>

<script type="module">
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const state = {
  screen: 'home',
  sidebarOpen: false,
  query: '',
  filter: '',
  dash: null,
  svcExpanded: {},
  svcDraft: {},
  people: [],
  peopleTotal: 0,
  peopleOffset: 0,
  peopleLoading: false,
  personId: null,
  personDetail: null,
  attHistory: null,
  attCanEdit: false,
  attEditingId: null,
  attFormOpen: false,
};

async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
  if (r.status === 401) { window.location.href = '/'; throw new Error('unauthorized'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}

function initials(name) {
  return (name || '').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}
function statusColors(mt) {
  if (mt === 'Member') return { bg: 'var(--pale-sage)', color: 'var(--sage-text)' };
  if (mt === 'Visitor') return { bg: 'var(--pale-gold)', color: 'var(--gold-text)' };
  return { bg: 'var(--linen)', color: 'var(--warm-gray)' };
}

function setTopbarTitle(t) { document.getElementById('topbar-title-text').textContent = t; }

function go(screen) {
  state.screen = screen;
  state.sidebarOpen = false;
  render();
  document.getElementById('content').scrollTop = 0;
}

// ── Dashboard ────────────────────────────────────────────────────────────
async function loadDashboard() {
  document.getElementById('content').innerHTML = '<div class="state-msg">Loading…</div>';
  try {
    state.dash = await api('/admin/api/mobile/dashboard');
  } catch (e) {
    document.getElementById('content').innerHTML = '<div class="state-msg">Could not load the dashboard. ' + esc(e.message) + '</div>';
    return;
  }
  renderHome();
}

function renderHome() {
  setTopbarTitle('Dashboard');
  const d = state.dash;
  if (!d) { loadDashboard(); return; }
  // A member's role has no attendance/follow-ups access at all (a hard ceiling, not a
  // toggle — see MEMBER_ALLOWED_ITEMS in api-utils.js), so those cards are omitted
  // entirely rather than shown disabled or with a "no access" message — a member's
  // dashboard is just the directory shortcut.
  let attendanceCardHtml = '';
  if (d.can_view_attendance) {
    let svcHtml = '';
    for (const svc of d.services) {
      const expanded = !!state.svcExpanded[svc.time];
      const btnText = svc.count != null ? (svc.count + ' entered') : 'Enter Attendance';
      svcHtml += '<div class="svc-row">'
        + '<div class="svc-row-top"><div class="svc-label">' + esc(svc.label) + '</div>'
        + (d.can_edit_attendance
            ? '<button class="svc-btn" data-action="toggle-svc" data-time="' + esc(svc.time) + '">' + esc(btnText) + '</button>'
            : (svc.count != null ? '<div class="svc-label">' + esc(svc.count) + '</div>' : '')
          )
        + '</div>';
      if (expanded) {
        const draft = state.svcDraft[svc.time] != null ? state.svcDraft[svc.time] : (svc.count != null ? svc.count : '');
        svcHtml += '<div class="svc-entry">'
          + '<input type="number" inputmode="numeric" placeholder="0" value="' + esc(draft) + '" data-svc-input="' + esc(svc.time) + '">'
          + '<button data-action="save-svc" data-time="' + esc(svc.time) + '">Save</button>'
          + '</div>';
      }
      svcHtml += '</div>';
    }
    attendanceCardHtml = '<div class="mob-card">'
      + '<div class="mob-card-head"><b>Sunday Attendance</b><div class="sub">' + esc(d.sunday_label) + '</div></div>'
      + svcHtml
      + '<button class="att-add-btn" style="border:none;border-top:1px solid var(--border);border-radius:0;" data-action="goto-attendance">View full attendance &#8594;</button>'
      + '</div>';
  }

  let followupsCardHtml = '';
  if (d.can_view_followups) {
    let notifHtml = '';
    if (!d.followups.length) {
      notifHtml = '<div class="empty-note">Nothing open right now.</div>';
    } else {
      for (const n of d.followups) {
        const dotMap = {
          prayer: { bg: 'var(--blue-mist)', fg: 'var(--navy)', icon: '✦' },
          followup: { bg: 'var(--pale-gold)', fg: 'var(--gold-text)', icon: '✉' },
        };
        const dm = dotMap[n.kind] || dotMap.followup;
        notifHtml += '<button class="notif-row" data-action="toggle-notif" data-kind="' + esc(n.kind) + '" data-id="' + esc(n.id) + '">'
          + '<span class="notif-dot" style="background:' + dm.bg + ';color:' + dm.fg + ';">' + dm.icon + '</span>'
          + '<div class="notif-body"><div class="notif-title' + (n.done ? ' done' : '') + '">' + esc(n.title) + '</div>'
          + '<div class="notif-sub">' + esc(n.subtitle) + '</div></div>'
          + '<div class="notif-time">' + esc(n.time_ago) + '</div>'
          + '</button>';
      }
    }
    followupsCardHtml = '<div class="mob-card">'
      + '<div class="mob-card-head"><b>Follow Ups</b>' + (d.open_followup_count ? '<span class="notif-badge">' + esc(d.open_followup_count) + '</span>' : '') + '</div>'
      + notifHtml
      + '</div>';
  }

  document.getElementById('content').innerHTML = '<div class="mob-pad">'
    + attendanceCardHtml
    + '<button class="ppl-shortcut" data-action="goto-people">'
    + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="#8A8377" stroke-width="2"/><path d="M21 21l-4-4" stroke="#8A8377" stroke-width="2" stroke-linecap="round"/></svg>'
    + '<span class="lbl">Search people…</span><span class="cnt">' + esc(d.people_total.toLocaleString()) + ' people</span>'
    + '</button>'
    + followupsCardHtml
    + '</div>';
}

async function saveSvc(time) {
  const input = document.querySelector('[data-svc-input="' + CSS.escape(time) + '"]');
  const count = parseInt(input && input.value, 10) || 0;
  try {
    await api('/admin/api/mobile/attendance', { method: 'POST', body: JSON.stringify({ date: state.dash.sunday_date, time, count }) });
    const svc = state.dash.services.find(s => s.time === time);
    if (svc) svc.count = count;
    delete state.svcDraft[time];
    state.svcExpanded[time] = false;
    renderHome();
  } catch (e) {
    alert('Save failed: ' + e.message);
  }
}

async function toggleNotif(kind, id) {
  const item = state.dash.followups.find(f => f.kind === kind && String(f.id) === String(id));
  if (!item) return;
  const prevDone = item.done;
  item.done = !prevDone;
  renderHome();
  try {
    await api('/admin/api/mobile/followups/toggle', { method: 'POST', body: JSON.stringify({ kind, id }) });
  } catch (e) {
    item.done = prevDone;
    renderHome();
  }
}

// ── People ───────────────────────────────────────────────────────────────
const FILTER_DEFS = [
  { key: '', label: 'All' },
  { key: 'Member', label: 'Members' },
  { key: 'Visitor', label: 'Visitors' },
  { key: 'Inactive', label: 'Inactive' },
];

async function loadPeople(reset) {
  if (reset) { state.people = []; state.peopleOffset = 0; }
  state.peopleLoading = true;
  renderPeople();
  try {
    const params = new URLSearchParams({ q: state.query, member_type: state.filter, offset: String(state.peopleOffset), limit: '40' });
    const d = await api('/admin/api/mobile/people?' + params.toString());
    if (reset) state.people = d.people; else state.people = state.people.concat(d.people);
    state.peopleTotal = d.total;
    state.peopleOffset = state.peopleOffset + d.people.length;
  } catch (e) {
    // leave existing list in place; show nothing extra
  }
  state.peopleLoading = false;
  renderPeople();
}

function renderPeople() {
  setTopbarTitle('People');
  let chipsHtml = '';
  for (const f of FILTER_DEFS) {
    chipsHtml += '<button class="chip' + (state.filter === f.key ? ' active' : '') + '" data-action="set-filter" data-filter="' + esc(f.key) + '">' + esc(f.label) + '</button>';
  }
  let rowsHtml = '';
  for (const p of state.people) {
    const c = statusColors(p.member_type);
    const sub = p.household_size > 1 ? ('Household of ' + p.household_size) : (p.household_size === 1 ? 'Individual' : '');
    rowsHtml += '<button class="ppl-row" data-action="open-person" data-id="' + esc(p.id) + '">'
      + '<div class="avatar avatar-42">' + esc(initials(p.name)) + '</div>'
      + '<div class="ppl-row-body"><div class="ppl-row-name">' + esc(p.name) + '</div><div class="ppl-row-sub">' + esc(sub) + '</div></div>'
      + (p.member_type ? '<span class="status-pill" style="background:' + c.bg + ';color:' + c.color + ';">' + esc(p.member_type) + '</span>' : '')
      + '</button>';
  }
  const hasMore = state.people.length < state.peopleTotal;
  document.getElementById('content').innerHTML = '<div class="mob-pad" style="gap:10px;">'
    + '<div class="ppl-title">People</div>'
    + '<div class="search-wrap"><svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="#8A8377" stroke-width="2"/><path d="M21 21l-4-4" stroke="#8A8377" stroke-width="2" stroke-linecap="round"/></svg>'
    + '<input type="search" id="ppl-search" placeholder="Search by name…" value="' + esc(state.query) + '"></div>'
    + '<div class="chip-row">' + chipsHtml + '</div>'
    + '<div class="result-count">' + esc(state.people.length) + ' of ' + esc(state.peopleTotal) + ' people</div>'
    + '<div>' + (rowsHtml || (state.peopleLoading ? '' : '<div class="empty-note">No matches.</div>')) + '</div>'
    + (hasMore ? '<button class="load-more" data-action="load-more">' + (state.peopleLoading ? 'Loading…' : 'Load more') + '</button>' : '')
    + '</div>';
  const input = document.getElementById('ppl-search');
  if (input) input.focus({ preventScroll: true });
}

let searchDebounce;
function onSearchInput(v) {
  state.query = v;
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => loadPeople(true), 250);
}

// ── Person detail ───────────────────────────────────────────────────────
async function openPerson(id) {
  state.personId = id;
  state.screen = 'person';
  state.personDetail = null;
  render();
  try {
    state.personDetail = await api('/admin/api/mobile/people/' + encodeURIComponent(id));
  } catch (e) {
    document.getElementById('content').innerHTML = '<div class="state-msg">Could not load this person. ' + esc(e.message) + '</div>';
    return;
  }
  renderPerson();
}

function renderPerson() {
  const p = state.personDetail;
  if (!p) { document.getElementById('content').innerHTML = '<div class="state-msg">Loading…</div>'; return; }
  setTopbarTitle(p.name || 'Person');
  const c = statusColors(p.member_type);
  let hhHtml = '';
  if (p.household.length) {
    let rows = '';
    for (const h of p.household) {
      rows += '<div class="hh-row"><div class="avatar avatar-30">' + esc(initials(h.name)) + '</div>'
        + '<div class="hh-name">' + esc(h.name) + '</div><div class="hh-rel">' + esc(h.rel) + '</div></div>';
    }
    hhHtml = '<div class="mob-card"><div class="hh-title">Household</div>' + rows + '</div>';
  }
  document.getElementById('content').innerHTML = '<div class="mob-pad">'
    + '<button class="back-link" data-action="back-to-people"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="#2E7EA6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>People</button>'
    + '<div class="person-head"><div class="avatar avatar-64">' + esc(initials(p.name)) + '</div>'
    + '<div><div class="person-name">' + esc(p.name) + '</div>'
    + (p.member_type ? '<span class="status-pill" style="background:' + c.bg + ';color:' + c.color + ';">' + esc(p.member_type) + '</span>' : '')
    + '</div></div>'
    + '<div class="mob-card contact-card">'
    + (p.phone ? '<a href="tel:' + esc(p.phone_raw) + '"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.4 21 3 13.6 3 4.6c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1l-2.2 2.2z" stroke="#2E7EA6" stroke-width="1.6"/></svg><span class="val">' + esc(p.phone) + '</span></a>' : '')
    + (p.email ? '<a href="mailto:' + esc(p.email) + '"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="#2E7EA6" stroke-width="1.6"/><path d="M3 7l9 6 9-6" stroke="#2E7EA6" stroke-width="1.6"/></svg><span class="val">' + esc(p.email) + '</span></a>' : '')
    + (p.map_url ? '<a href="' + esc(p.map_url) + '" target="_blank" rel="noopener"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="margin-top:2px;"><path d="M12 21s7-6.1 7-11a7 7 0 10-14 0c0 4.9 7 11 7 11z" stroke="#2E7EA6" stroke-width="1.6"/><circle cx="12" cy="10" r="2.4" stroke="#2E7EA6" stroke-width="1.6"/></svg><span class="addr-val">' + esc(p.address) + '<br><span class="addr-hint">Tap for directions</span></span></a>' : '')
    + (!p.phone && !p.email && !p.map_url ? '<div class="empty-note">No contact info on file.</div>' : '')
    + '</div>'
    + hhHtml
    + '</div>';
}

// ── Attendance (history + add special/midweek) ─────────────────────────────
const ATT_TYPE_LABELS = { sunday: 'Sunday', special: 'Special', midweek: 'Midweek' };

async function loadAttendance() {
  setTopbarTitle('Attendance');
  document.getElementById('content').innerHTML = '<div class="state-msg">Loading…</div>';
  try {
    const d = await api('/admin/api/mobile/attendance/history?limit=25');
    state.attHistory = d.services;
    state.attCanEdit = !!d.can_edit;
  } catch (e) {
    document.getElementById('content').innerHTML = '<div class="state-msg">Could not load attendance. ' + esc(e.message) + '</div>';
    return;
  }
  renderAttendance();
}

function fmtAttDate(dateStr) {
  const t = new Date(dateStr + 'T12:00:00Z');
  if (isNaN(t.getTime())) return dateStr;
  return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function renderAttendance() {
  setTopbarTitle('Attendance');
  if (!state.attHistory) { loadAttendance(); return; }
  let rowsHtml = '';
  if (!state.attHistory.length) {
    rowsHtml = '<div class="empty-note">No services recorded yet.</div>';
  } else {
    for (const s of state.attHistory) {
      const label = ATT_TYPE_LABELS[s.service_type] || s.service_type;
      const sub = [fmtAttDate(s.service_date), s.service_time, s.service_name].filter(Boolean).join(' · ') + ' · ' + label;
      const editing = state.attEditingId === s.id;
      rowsHtml += '<div class="att-hist-row">'
        + '<div class="att-hist-body"><div class="att-hist-title">' + esc(sub) + '</div></div>'
        + (editing
            ? '<input type="number" inputmode="numeric" value="' + esc(s.attendance) + '" data-att-edit-input="' + esc(s.id) + '">'
              + '<div class="att-hist-actions"><button class="att-icon-btn" data-action="att-save" data-id="' + esc(s.id) + '">Save</button></div>'
            : (state.attCanEdit
                ? '<div class="att-hist-count">' + esc(s.attendance) + '</div>'
                  + '<div class="att-hist-actions"><button class="att-icon-btn" data-action="att-edit" data-id="' + esc(s.id) + '">Edit</button>'
                  + '<button class="att-icon-btn danger" data-action="att-delete" data-id="' + esc(s.id) + '">Del</button></div>'
                : '<div class="att-hist-count">' + esc(s.attendance) + '</div>'))
        + '</div>';
    }
  }
  let formHtml = '';
  if (state.attFormOpen) {
    formHtml = '<div class="mob-card att-form">'
      + '<div><label>Date</label><input type="date" id="att-form-date"></div>'
      + '<div class="att-form-row">'
      + '<div><label>Type</label><select id="att-form-type"><option value="special">Special</option><option value="midweek">Midweek</option><option value="sunday">Sunday</option></select></div>'
      + '<div><label>Time (optional)</label><input type="time" id="att-form-time"></div>'
      + '</div>'
      + '<div><label>Name</label><input type="text" id="att-form-name" placeholder="e.g. Christmas Eve"></div>'
      + '<div class="att-form-row">'
      + '<div><label>Attendance</label><input type="number" inputmode="numeric" id="att-form-count" placeholder="0"></div>'
      + '<div><label>Communion</label><input type="number" inputmode="numeric" id="att-form-communion" placeholder="0"></div>'
      + '</div>'
      + '<div class="att-form-actions"><button class="att-form-cancel" data-action="att-form-cancel">Cancel</button>'
      + '<button class="att-form-save" data-action="att-form-save">Save</button></div>'
      + '</div>';
  }
  document.getElementById('content').innerHTML = '<div class="mob-pad">'
    + (state.attCanEdit ? (state.attFormOpen ? formHtml : '<button class="att-add-btn" data-action="att-form-open">+ Add special or midweek service</button>') : '')
    + '<div class="mob-card"><div class="mob-card-head"><b>Recent Services</b></div>' + rowsHtml + '</div>'
    + '</div>';
}

async function attSaveEdit(id) {
  const input = document.querySelector('[data-att-edit-input="' + CSS.escape(String(id)) + '"]');
  const count = Math.max(0, parseInt(input && input.value, 10) || 0);
  try {
    await api('/admin/api/mobile/attendance/entry/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ count }) });
    const row = state.attHistory.find(s => s.id === id);
    if (row) row.attendance = count;
    state.attEditingId = null;
    renderAttendance();
  } catch (e) {
    alert('Save failed: ' + e.message);
  }
}

async function attDelete(id) {
  if (!confirm('Delete this attendance entry?')) return;
  try {
    await api('/admin/api/mobile/attendance/entry/' + encodeURIComponent(id), { method: 'DELETE' });
    state.attHistory = state.attHistory.filter(s => s.id !== id);
    renderAttendance();
  } catch (e) {
    alert('Delete failed: ' + e.message);
  }
}

async function attFormSave() {
  const date = document.getElementById('att-form-date').value;
  if (!date) { alert('Pick a date.'); return; }
  const body = {
    date,
    type: document.getElementById('att-form-type').value,
    time: document.getElementById('att-form-time').value,
    name: document.getElementById('att-form-name').value,
    count: document.getElementById('att-form-count').value,
    communion: document.getElementById('att-form-communion').value,
  };
  try {
    await api('/admin/api/mobile/attendance/entry', { method: 'POST', body: JSON.stringify(body) });
    state.attFormOpen = false;
    await loadAttendance();
  } catch (e) {
    alert('Save failed: ' + e.message);
  }
}

// ── Render dispatch ──────────────────────────────────────────────────────
function render() {
  document.getElementById('sidebar').classList.toggle('open', state.sidebarOpen);
  document.getElementById('sb-overlay').classList.toggle('open', state.sidebarOpen);
  document.querySelectorAll('.sb-item[data-nav]').forEach(el => {
    el.classList.toggle('active', el.dataset.nav === state.screen);
  });
  if (state.screen === 'home') renderHome();
  else if (state.screen === 'people') renderPeople();
  else if (state.screen === 'person') renderPerson();
  else if (state.screen === 'attendance') renderAttendance();
}

// ── Event delegation ─────────────────────────────────────────────────────
document.getElementById('btn-menu').addEventListener('click', () => { state.sidebarOpen = !state.sidebarOpen; render(); });
document.getElementById('btn-search').addEventListener('click', () => go('people'));
document.getElementById('sb-overlay').addEventListener('click', () => { state.sidebarOpen = false; render(); });
document.querySelectorAll('.sb-item[data-nav]').forEach(el => {
  el.addEventListener('click', () => go(el.dataset.nav));
});
document.querySelector('.sb-item[data-fullapp]').addEventListener('click', () => { window.location.href = '/?desktop=1'; });

document.getElementById('content').addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const action = t.dataset.action;
  if (action === 'toggle-svc') {
    const time = t.dataset.time;
    state.svcExpanded[time] = !state.svcExpanded[time];
    renderHome();
  } else if (action === 'save-svc') {
    saveSvc(t.dataset.time);
  } else if (action === 'goto-people') {
    go('people');
  } else if (action === 'goto-attendance') {
    go('attendance');
  } else if (action === 'toggle-notif') {
    toggleNotif(t.dataset.kind, t.dataset.id);
  } else if (action === 'set-filter') {
    state.filter = t.dataset.filter;
    loadPeople(true);
  } else if (action === 'open-person') {
    openPerson(parseInt(t.dataset.id, 10));
  } else if (action === 'load-more') {
    loadPeople(false);
  } else if (action === 'back-to-people') {
    go('people');
  } else if (action === 'att-edit') {
    state.attEditingId = parseInt(t.dataset.id, 10);
    renderAttendance();
  } else if (action === 'att-save') {
    attSaveEdit(parseInt(t.dataset.id, 10));
  } else if (action === 'att-delete') {
    attDelete(parseInt(t.dataset.id, 10));
  } else if (action === 'att-form-open') {
    state.attFormOpen = true;
    renderAttendance();
  } else if (action === 'att-form-cancel') {
    state.attFormOpen = false;
    renderAttendance();
  } else if (action === 'att-form-save') {
    attFormSave();
  }
});
document.getElementById('content').addEventListener('input', (e) => {
  if (e.target && e.target.id === 'ppl-search') onSearchInput(e.target.value);
});

// ── Boot ─────────────────────────────────────────────────────────────────
const bootStart = Date.now();
Promise.resolve()
  .then(() => loadDashboard())
  .catch(() => {})
  .finally(() => {
    const elapsed = Date.now() - bootStart;
    const wait = Math.max(0, 700 - elapsed);
    setTimeout(() => {
      document.getElementById('splash').classList.add('hide');
      document.getElementById('topbar').style.display = '';
      setTimeout(() => { const el = document.getElementById('splash'); if (el) el.remove(); }, 300);
    }, wait);
  });
</script>
</body>
</html>`;
