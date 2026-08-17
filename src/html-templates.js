// ── HTML templates: Login, Public signup page, Admin scheduler page ────────────
import { DEPLOY_VERSION } from './frontend/js-core.js';
import { PUBLIC_HEAD } from './public/head.js';
import { PUBLIC_LANDING } from './public/landing.js';
import { PAGE_FINDFIT } from './public/findfit.js';
import { PUBLIC_FOOTER } from './public/footer.js';
import { PUBLIC_SCRIPTS } from './public/scripts.js';
import { PAGE_WORSHIP } from './public/ministries/worship.js';
import { PAGE_EVENTS } from './public/ministries/events.js';
import { PAGE_EDUCATION } from './public/ministries/education.js';
import { PAGE_ACCEPTANCE } from './public/ministries/acceptance.js';
import { PAGE_OUTREACH } from './public/ministries/outreach.js';
import { PAGE_GENERAL } from './public/ministries/general.js';
import { PAGE_LASM } from './public/ministries/lasm.js';
import { PAGE_WOL } from './public/ministries/wol.js';
import { PAGE_CFNA } from './public/ministries/cfna.js';

export const LOGIN_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Sign In \u2014 Connect</title><link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png?v=${DEPLOY_VERSION}"><link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png?v=${DEPLOY_VERSION}"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,300&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet"><style>:root{--navy:#1E2D4A;--teal:#2E7EA6;--gold:#C9973A;--cream:#F8F4EE;--muted:#8A8898;}*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'DM Sans',sans-serif;font-weight:400;background:var(--cream);display:flex;align-items:center;justify-content:center;min-height:100vh;}.card{background:#fff;border-radius:16px;padding:2.5rem;max-width:380px;width:100%;box-shadow:0 4px 24px rgba(30,45,74,.12);}.wm{display:flex;flex-direction:column;align-items:center;text-align:center;margin-bottom:1.75rem;}.wm-lockup{width:100%;max-width:300px;height:auto;display:block;}.field{margin-bottom:1rem;}label{display:block;font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:.2em;color:var(--navy);margin-bottom:.4rem;}input{width:100%;padding:.7rem 1rem;border:1.5px solid rgba(30,45,74,.2);border-radius:8px;font-size:.95rem;font-family:inherit;outline:none;}input:focus{border-color:var(--teal);}.btn{width:100%;background:var(--navy);color:#fff;border:none;padding:.85rem;border-radius:8px;font-size:1rem;font-weight:500;cursor:pointer;margin-top:.5rem;transition:background .15s;font-family:inherit;}.btn:hover{background:var(--teal);}.btn:disabled{opacity:.6;cursor:wait;}.hint{font-size:.78rem;color:#aaa;margin-top:1.2rem;text-align:center;border-top:1px solid #eee;padding-top:.9rem;}</style></head><body><div class="card"><div class="wm"><img class="wm-lockup" src="/icons/connect-lockup.png?v=${DEPLOY_VERSION}" alt="Connect — Timothy Lutheran Church — From our Neighborhood to the Nations" width="900" height="335"></div><!--ERROR--><form method="POST" action="/admin/login" onsubmit="var b=this.querySelector('.btn');b.disabled=true;b.textContent='Signing in\u2026';"><div class="field"><label for="un">Username</label><input type="text" id="un" name="username" placeholder="Enter username" autocomplete="username" autofocus required></div><div class="field"><label for="pw">Password</label><input type="password" id="pw" name="password" placeholder="Enter password" autocomplete="current-password" required></div><button class="btn" type="submit">Sign In</button></form><div style="margin-top:.9rem;text-align:center;"><a href="#" id="fp-link" style="color:#2E7EA6;font-size:.82rem;text-decoration:none;">Forgot password?</a></div><div id="fp-panel" style="display:none;margin-top:.9rem;padding-top:.9rem;border-top:1px solid #eee;"><p style="font-size:.82rem;color:#3D3530;margin-bottom:.6rem;">Enter your username or email. If an account exists, we'll send a reset link.</p><form id="fp-form" onsubmit="event.preventDefault();var f=this,b=f.querySelector('.btn');b.disabled=true;b.textContent='Sending…';fetch('/admin/forgot-password',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'username='+encodeURIComponent(f.username.value)}).then(function(){document.getElementById('fp-panel').innerHTML='<div style=\\'padding:.7rem;background:#e8f6ed;color:#1d6b3a;border-radius:8px;font-size:.85rem;text-align:center;\\'>If an account exists, a reset email has been sent.</div>';});"><div class="field"><label for="fp-un">Username or email</label><input type="text" id="fp-un" name="username" required></div><button class="btn" type="submit">Send reset link</button></form></div><script>document.getElementById('fp-link').addEventListener('click',function(e){e.preventDefault();var p=document.getElementById('fp-panel');p.style.display=p.style.display==='none'?'block':'none';});</script></div></body></html>`;

// ── PUBLIC HTML ─────────────────────────────────────────────────────
// Assembled from per-section modules under ./public/. Order matters: header/CSS,
// landing card grid, then one detail page per ministry, footer, scripts.
export const PUBLIC_HTML =
  PUBLIC_HEAD +
  PUBLIC_LANDING +
  PAGE_FINDFIT +
  PAGE_WORSHIP +
  PAGE_EVENTS +
  PAGE_EDUCATION +
  PAGE_ACCEPTANCE +
  PAGE_OUTREACH +
  PAGE_GENERAL +
  PAGE_LASM +
  PAGE_WOL +
  PAGE_CFNA +
  PUBLIC_FOOTER +
  PUBLIC_SCRIPTS;

// ── ADMIN HTML ──────────────────────────────────────────────────────
export const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Volunteer Admin — Timothy Lutheran</title>
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,600;1,400&family=Source+Sans+3:wght@300;400;600&display=swap" rel="stylesheet">
<style>
:root{--navy:#1E2D4A;--teal:#2E7EA6;--gold:#C9973A;--cream:#F7F3EC;--border:rgba(30,45,74,.12);}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Source Sans 3',sans-serif;background:var(--cream);color:#1A1A2A;}
header{background:var(--navy);color:#fff;padding:.75rem 1.5rem;display:flex;align-items:center;justify-content:space-between;}
.header-title{font-family:'Lora',serif;font-size:1.1rem;}
.header-sub{font-size:.8rem;opacity:.7;margin-top:.1rem;}
.btn-logout{background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.2);padding:.4rem .9rem;border-radius:6px;font-size:.85rem;cursor:pointer;text-decoration:none;}
.btn-logout:hover{background:rgba(255,255,255,.2);}
.container{max-width:1100px;margin:0 auto;padding:1.5rem;}
.tabs{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:1px solid var(--border);}
.tab{padding:.5rem 1.1rem;border-radius:100px;font-size:.88rem;font-weight:600;cursor:pointer;background:rgba(30,45,74,.06);border:none;transition:all .2s;}
.tab.active{background:var(--navy);color:#fff;}
.section{margin-bottom:2.5rem;}
.section-title{font-family:'Lora',serif;font-size:1.2rem;color:var(--navy);margin-bottom:1rem;display:flex;align-items:center;gap:.75rem;}
.badge{background:var(--navy);color:#fff;border-radius:100px;padding:.15rem .6rem;font-size:.78rem;font-family:'Source Sans 3',sans-serif;}
.card{background:#fff;border-radius:12px;border:1px solid var(--border);padding:1.1rem 1.25rem;margin-bottom:.75rem;}
.card-header{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;}
.card-name{font-weight:600;font-size:1rem;color:var(--navy);}
.card-ministry{font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--teal);margin-top:.1rem;}
.card-meta{font-size:.85rem;color:#4A4860;margin-top:.5rem;line-height:1.6;}
.card-roles{margin-top:.5rem;display:flex;flex-wrap:wrap;gap:.3rem;}
.role-tag{display:inline-block;background:rgba(30,45,74,.07);border:1px solid var(--border);border-radius:6px;padding:.15rem .6rem;font-size:.8rem;}
.card-notes{margin-top:.5rem;font-size:.85rem;color:#6A6880;font-style:italic;}
.card-date{font-size:.78rem;color:#8A8898;white-space:nowrap;}
.btn-delete{background:none;border:1px solid rgba(192,57,43,.3);color:#c0392b;padding:.3rem .75rem;border-radius:6px;font-size:.8rem;cursor:pointer;transition:all .2s;}
.btn-delete:hover{background:#c0392b;color:#fff;}
.btn-primary{background:var(--navy);color:#fff;border:none;padding:.6rem 1.2rem;border-radius:8px;font-size:.9rem;font-weight:600;cursor:pointer;transition:background .2s;}
.btn-primary:hover{background:var(--teal);}
.btn-secondary{background:rgba(30,45,74,.08);color:var(--navy);border:1px solid var(--border);padding:.5rem 1rem;border-radius:8px;font-size:.85rem;font-weight:600;cursor:pointer;transition:all .2s;}
.btn-secondary:hover{background:rgba(30,45,74,.15);}
.btn-sm{padding:.35rem .75rem;font-size:.8rem;}
.export-bar{display:flex;align-items:center;gap:.75rem;margin-bottom:1.25rem;flex-wrap:wrap;}
.filter-label{font-size:.85rem;color:#4A4860;}
.ev-admin-card{background:#fff;border-radius:12px;border:1px solid var(--border);margin-bottom:1rem;overflow:hidden;}
.ev-admin-header{display:flex;align-items:center;gap:1rem;padding:1rem 1.25rem;cursor:pointer;background:none;width:100%;text-align:left;border:none;}
.ev-admin-header:hover{background:rgba(30,45,74,.03);}
.ev-admin-name{font-family:'Lora',serif;font-weight:600;color:var(--navy);font-size:1rem;flex:1;}
.ev-admin-date{font-size:.82rem;color:#8A8898;}
.ev-admin-status{font-size:.75rem;font-weight:600;padding:.2rem .65rem;border-radius:100px;}
.ev-admin-status.visible{background:rgba(46,126,166,.1);color:var(--teal);}
.ev-admin-status.hidden{background:rgba(192,57,43,.1);color:#c0392b;}
.ev-admin-body{padding:1.25rem;border-top:1px solid var(--border);}
.form-row{display:flex;gap:1rem;flex-wrap:wrap;}
.form-field{flex:1;min-width:180px;margin-bottom:.75rem;}
.form-label{display:block;font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--navy);margin-bottom:.35rem;}
.form-input,.form-textarea{width:100%;padding:.6rem .9rem;border:1.5px solid rgba(30,45,74,.2);border-radius:8px;font-size:.92rem;font-family:inherit;outline:none;transition:border-color .2s;}
.form-input:focus,.form-textarea:focus{border-color:var(--teal);}
.form-textarea{resize:vertical;min-height:70px;}
.roles-list{margin-top:.75rem;}
.role-admin-row{display:flex;align-items:center;gap:.75rem;padding:.5rem 0;border-bottom:1px solid var(--border);}
.role-admin-row:last-child{border-bottom:none;}
.role-admin-name{flex:1;font-size:.9rem;}
.add-role-form{display:flex;gap:.5rem;margin-top:.75rem;flex-wrap:wrap;}
.add-role-form input{flex:1;min-width:140px;}
.chevron{width:18px;height:18px;transition:transform .2s;}
.ev-admin-header[aria-expanded="true"] .chevron{transform:rotate(180deg);}
.empty-msg{text-align:center;padding:2rem;color:#8A8898;font-size:.95rem;}
.toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;gap:1rem;flex-wrap:wrap;}
@media(max-width:600px){.form-row{flex-direction:column;}.toolbar{flex-direction:column;align-items:stretch;}}
</style>
</head>
<body>
<header>
  <div>
    <div class="header-title">Timothy Lutheran — Volunteer Admin</div>
    <div class="header-sub">volunteer.timothystl.org</div>
  </div>
  <div style="display:flex;gap:.5rem;align-items:center;">
    <a href="/chms" class="btn-logout">Church Mgmt</a>
    <a href="/scheduler/" class="btn-logout">Scheduler</a>
    <a href="#" onclick="doLogout()" class="btn-logout">Sign out</a>
  </div>
</header>
<div class="container">
  <div class="tabs" id="ministry-tabs">
    <button class="tab active" onclick="setTab('all')">All</button>
    <button class="tab" onclick="setTab('worship')">Worship</button>
    <button class="tab" onclick="setTab('events')">Events</button>
    <button class="tab" onclick="setTab('education')">Education</button>
    <button class="tab" onclick="setTab('acceptance')">Acceptance</button>
    <button class="tab" onclick="setTab('outreach')">Outreach</button>
    <button class="tab" onclick="setTab('general')">General</button>
  </div>

  <!-- Signups section -->
  <div id="signups-section">
    <div class="toolbar">
      <h2 class="section-title" id="signups-title">All Volunteers <span class="badge" id="signups-count">…</span></h2>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
        <button class="btn-secondary" onclick="toggleDuplicates()" id="dup-btn">Show Duplicates</button>
        <button class="btn-secondary" onclick="printSignups()">Print List</button>
        <a id="export-link" href="/admin/api/export.csv" class="btn-secondary" download>Export CSV</a>
      </div>
    </div>
    <div id="duplicates-panel" style="display:none;background:#fff8f0;border:1px solid #e0b060;border-radius:10px;padding:1rem;margin-bottom:1rem;">
      <h3 style="font-size:.95rem;font-weight:600;color:#8a5000;margin-bottom:.75rem;">Emails with multiple signups</h3>
      <div id="duplicates-list"></div>
    </div>
    <div id="signups-list"><p class="empty-msg">Loading...</p></div>
  </div>

  <!-- Events management section -->
  <div id="events-section" style="margin-top:2.5rem;">
    <div class="toolbar">
      <h2 class="section-title">Community Events <span class="badge" id="events-count">…</span></h2>
      <button class="btn-primary" onclick="showAddEventForm()">+ Add Event</button>
    </div>
    <div id="add-event-form" style="display:none;background:#fff;border-radius:12px;border:1px solid var(--border);padding:1.25rem;margin-bottom:1rem;">
      <h3 style="font-family:'Lora',serif;font-size:1rem;color:var(--navy);margin-bottom:1rem;">New Event</h3>
      <div class="form-row">
        <div class="form-field">
          <label class="form-label">Event Name *</label>
          <input type="text" id="new-ev-name" class="form-input" placeholder="e.g. Easter Egg Hunt">
        </div>
        <div class="form-field">
          <label class="form-label">Date</label>
          <input type="date" id="new-ev-date" class="form-input">
        </div>
      </div>
      <div class="form-field">
        <label class="form-label">Description</label>
        <textarea id="new-ev-desc" class="form-textarea" placeholder="Brief description for volunteers..."></textarea>
      </div>
      <div style="display:flex;align-items:center;gap:.5rem;margin-top:.75rem;">
        <input type="checkbox" id="new-ev-time-slots" checked style="width:auto;margin:0;">
        <label for="new-ev-time-slots" style="font-size:.85rem;color:var(--navy);cursor:pointer;">Roles have scheduled time slots (date &amp; time)</label>
      </div>
      <div style="display:flex;gap:.5rem;margin-top:.75rem;">
        <button class="btn-primary" onclick="saveNewEvent()">Save Event</button>
        <button class="btn-secondary" onclick="document.getElementById('add-event-form').style.display='none'">Cancel</button>
      </div>
    </div>
    <div id="events-list"><p class="empty-msg">Loading events...</p></div>
  </div>
</div>

<script>
function toTimeInput(str) {
  if (!str) return '';
  str = str.trim();
  var m = str.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return str;
  var h = parseInt(m[1], 10), min = m[2], ampm = m[3].toUpperCase();
  if (ampm === 'AM') { if (h === 12) h = 0; }
  else { if (h !== 12) h += 12; }
  return (h < 10 ? '0' : '') + h + ':' + min;
}
function fromTimeInput(str) {
  if (!str) return '';
  var parts = str.split(':');
  if (parts.length < 2) return str;
  var h = parseInt(parts[0], 10), min = parts[1];
  var ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return h + ':' + min + ' ' + ampm;
}
var currentTab = 'all';

function setTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
  event.target.classList.add('active');
  var exportLink = document.getElementById('export-link');
  if (exportLink) exportLink.href = '/admin/api/export.csv' + (tab !== 'all' ? '?ministry=' + tab : '');
  loadSignups();
}

function doLogout() {
  document.cookie = 'vol_auth=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
  location.href = '/admin';
}
// ── Auto-logout after 2 hours of inactivity ───────────────────────────
(function(){
  var MS=2*60*60*1000,WARN=2*60*1000,t,w,b;
  function reset(){
    clearTimeout(t);clearTimeout(w);
    if(b)b.style.display='none';
    w=setTimeout(function(){
      if(!b){b=document.createElement('div');b.id='inact-warn';
        b.style.cssText='position:fixed;top:0;left:0;right:0;background:#c0392b;color:#fff;text-align:center;padding:10px 16px;z-index:99999;font-size:.9rem;font-family:sans-serif;';
        // See the matching note in html-chms.js: escaped inner quotes in a plain template
        // literal collapse and break the served <script>, so build the node directly.
        b.appendChild(document.createTextNode('Signing out in 2 minutes due to inactivity. '));
        var sb=document.createElement('button');
        sb.textContent='Stay Signed In';
        sb.style.cssText='margin-left:10px;background:#fff;color:#c0392b;border:none;padding:3px 10px;border-radius:4px;cursor:pointer;font-weight:600;';
        sb.addEventListener('click',function(){b.style.display='none';reset();});
        b.appendChild(sb);
        document.body.appendChild(b);}
      else b.style.display='block';
    },MS-WARN);
    t=setTimeout(function(){location.href='/admin/logout';},MS);
  }
  ['click','keydown','mousemove','touchstart'].forEach(function(e){document.addEventListener(e,reset,{passive:true});});
  window.reset=reset;reset();
})();

// ── Signups ──────────────────────────────────────────────────────────
function loadSignups() {
  var url = '/admin/api/signups' + (currentTab !== 'all' ? '?ministry=' + currentTab : '');
  document.getElementById('signups-list').innerHTML = '<p class="empty-msg">Loading...</p>';
  fetch(url)
    .then(function(r) {
      return r.json().then(function(data) { return { ok: r.ok, status: r.status, data: data }; });
    })
    .then(function(result) {
      if (!result.ok) {
        console.error('Signups API error', result.status, result.data);
        document.getElementById('signups-list').innerHTML = '<p class="empty-msg">Error loading sign-ups (server error ' + result.status + ').</p>';
        return;
      }
      var data = result.data;
      var items = data.signups || [];
      var labels = {all:'All',worship:'Worship',events:'Events',education:'Education',acceptance:'Acceptance',outreach:'Outreach',transportation:'Transportation',general:'General'};
      document.getElementById('signups-title').innerHTML = (labels[currentTab]||currentTab) + ' Volunteers <span class="badge" id="signups-count">' + items.length + '</span>';
      if (!items.length) {
        document.getElementById('signups-list').innerHTML = '<p class="empty-msg">No sign-ups yet.</p>';
        return;
      }
      document.getElementById('signups-list').innerHTML = items.map(function(s) {
        var roles = [];
        try { roles = JSON.parse(s.roles || '[]'); } catch {}
        var sundays = [];
        try { sundays = JSON.parse(s.sundays || '[]'); } catch {}
        var meta = [];
        if (s.email) meta.push('<strong>Email:</strong> <a href="mailto:' + escHtml(s.email) + '">' + escHtml(s.email) + '</a>');
        if (s.phone) meta.push('<strong>Phone:</strong> ' + escHtml(s.phone));
        if (s.service) meta.push('<strong>Service:</strong> ' + escHtml(s.service));
        if (sundays.length) meta.push('<strong>Sundays:</strong> ' + sundays.map(escHtml).join(', '));
        if (s.event_name) meta.push('<strong>Event:</strong> ' + escHtml(s.event_name));
        if (s.slot_details && s.slot_details.length) {
          var shiftList = s.slot_details.map(function(sl){
            return escHtml(sl.name) + (sl.start_time ? ' (' + escHtml(sl.start_time) + '–' + escHtml(sl.end_time) + ')' : '');
          }).join(', ');
          meta.push('<strong>Shifts:</strong> ' + shiftList);
        }
        if (s.shirt_wanted) meta.push('<strong>T-shirt:</strong> ' + (s.shirt_size || 'Yes'));
        var html = '<div class="card" id="signup-' + s.id + '">'
          + '<div class="card-header"><div><div class="card-name">' + escHtml(s.name) + '</div>'
          + '<div class="card-ministry">' + escHtml(s.ministry) + '</div></div>'
          + '<div style="display:flex;align-items:center;gap:.75rem;">'
          + '<span class="card-date">' + escHtml((s.created_at||'').slice(0,10)) + '</span>'
          + '<button class="btn-delete btn-sm" onclick="deleteSignup(' + s.id + ')">Remove</button></div></div>'
          + (meta.length ? '<div class="card-meta">' + meta.join(' &nbsp;&bull;&nbsp; ') + '</div>' : '')
          + (roles.length ? '<div class="card-roles">' + roles.map(function(r){return '<span class="role-tag">'+escHtml(r)+'</span>';}).join('') + '</div>' : '')
          + (s.notes ? '<div class="card-notes">"' + escHtml(s.notes) + '"</div>' : '')
          + '</div>';
        return html;
      }).join('');
    })
    .catch(function(err) {
      console.error('loadSignups error:', err);
      document.getElementById('signups-list').innerHTML = '<p class="empty-msg">Error loading sign-ups: ' + (err && err.message ? err.message : String(err)) + '</p>';
    });
}

function deleteSignup(id) {
  if (!confirm('Remove this volunteer sign-up?')) return;
  fetch('/admin/api/signups/' + id, { method: 'DELETE' })
    .then(function() { loadSignups(); });
}

function printSignups() {
  window.print();
}

function printEventRoster(evId) {
  fetch('/admin/api/events/' + evId + '/roster')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var ev = data.event || {};
      var roster = data.roster || [];
      var dateStr = ev.event_date ? new Date(ev.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' }) : '';
      // Group roles by date
      var byDate = {};
      var dateOrder = [];
      roster.forEach(function(role) {
        var d = role.role_date || ev.event_date || '';
        if (!byDate[d]) { byDate[d] = []; dateOrder.push(d); }
        byDate[d].push(role);
      });
      var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">'
        + '<title>' + escHtml(ev.name || 'Event Roster') + '</title>'
        + '<style>'
        + '@page{size:landscape;margin:.65in .75in;}'
        + '*{box-sizing:border-box;margin:0;padding:0;}'
        + 'body{font-family:Georgia,serif;color:#1a1a2a;font-size:10pt;}'
        + '.header{border-bottom:2.5pt solid #1E2D4A;padding-bottom:6pt;margin-bottom:14pt;display:flex;justify-content:space-between;align-items:flex-end;}'
        + '.header-title{font-size:16pt;font-weight:700;color:#1E2D4A;line-height:1.1;}'
        + '.header-date{font-size:9.5pt;color:#555;}'
        + '.day-section{margin-bottom:18pt;page-break-inside:avoid;}'
        + '.day-heading{font-size:10pt;font-weight:700;color:#1E2D4A;background:#e8eef5;padding:3pt 6pt;border-left:3pt solid #1E2D4A;margin-bottom:4pt;}'
        + 'table{width:100%;border-collapse:collapse;}'
        + 'thead tr{background:#1E2D4A;color:#fff;}'
        + 'thead th{text-align:left;font-size:8pt;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:4pt 6pt;border:1pt solid #1E2D4A;}'
        + 'tbody tr:nth-child(even){background:#f5f7fa;}'
        + 'tbody tr:nth-child(odd){background:#fff;}'
        + 'tbody td{font-size:9pt;padding:4pt 6pt;border:0.5pt solid #d0d8e4;vertical-align:top;}'
        + '.role-cell{font-weight:700;}'
        + '.time-cell{white-space:nowrap;color:#2E7EA6;}'
        + '.vol-cell{color:#222;}'
        + '.empty-cell{color:#B85C3A;font-style:italic;}'
        + '.fill-cell{font-size:8pt;color:#666;white-space:nowrap;}'
        + '.footer{margin-top:14pt;font-size:7.5pt;color:#aaa;border-top:0.5pt solid #ddd;padding-top:4pt;display:flex;justify-content:space-between;}'
        + '</style></head><body>'
        + '<div class="header">'
        + '<div class="header-title">' + escHtml(ev.name || 'Event Roster') + '</div>'
        + '<div class="header-date">' + escHtml(dateStr) + '</div>'
        + '</div>';
      if (!roster.length) {
        html += '<p style="color:#888;">No roles defined for this event.</p>';
      } else {
        dateOrder.forEach(function(d) {
          var roles = byDate[d];
          var dayLabel = d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' }) : 'General';
          html += '<div class="day-section"><div class="day-heading">' + escHtml(dayLabel) + '</div>'
            + '<table><thead><tr>'
            + '<th style="width:18%;">Role</th>'
            + '<th style="width:11%;">Time</th>'
            + '<th style="width:8%;">Filled</th>'
            + '<th>Volunteers</th>'
            + '</tr></thead><tbody>';
          roles.forEach(function(role) {
            var timeStr = '';
            if (role.start_time) timeStr = role.start_time + (role.end_time ? ' – ' + role.end_time : '');
            var filledCount = role.volunteers.length;
            var slotsLabel = role.slots > 0 ? filledCount + ' / ' + role.slots : filledCount + ' / ∞';
            var volNames = role.volunteers.length
              ? role.volunteers.map(function(v) { return escHtml(v.name); }).join(',&ensp;')
              : '<span class="empty-cell">— open —</span>';
            // Add open slot indicators if capacity not met
            if (role.slots > 0 && role.volunteers.length < role.slots) {
              var opens = role.slots - role.volunteers.length;
              for (var i = 0; i < opens; i++) {
                volNames += (role.volunteers.length || i > 0 ? ',&ensp;' : '') + '<span class="empty-cell">open</span>';
              }
            }
            html += '<tr>'
              + '<td class="role-cell">' + escHtml(role.name) + (role.description ? '<br><span style="font-weight:400;font-size:8pt;color:#666;">' + escHtml(role.description) + '</span>' : '') + '</td>'
              + '<td class="time-cell">' + escHtml(timeStr || '—') + '</td>'
              + '<td class="fill-cell">' + escHtml(slotsLabel) + '</td>'
              + '<td class="vol-cell">' + volNames + '</td>'
              + '</tr>';
          });
          html += '</tbody></table></div>';
        });
      }
      html += '<div class="footer"><span>Timothy Lutheran Church — Volunteer Roster</span><span>Printed ' + new Date().toLocaleString() + '</span></div>'
        + '</body></html>';
      var w = window.open('', '_blank');
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(function() { w.print(); }, 400);
    })
    .catch(function(e) { alert('Could not load roster: ' + e.message); });
}

var _dupVisible = false;
function toggleDuplicates() {
  _dupVisible = !_dupVisible;
  var panel = document.getElementById('duplicates-panel');
  var btn = document.getElementById('dup-btn');
  if (!_dupVisible) { panel.style.display = 'none'; btn.textContent = 'Show Duplicates'; return; }
  btn.textContent = 'Hide Duplicates';
  // Use the already-loaded signups from current view, or fetch all
  fetch('/admin/api/signups')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var items = data.signups || [];
      // Group by email
      var byEmail = {};
      items.forEach(function(s) {
        var key = (s.email || '').toLowerCase().trim();
        if (!key) return;
        if (!byEmail[key]) byEmail[key] = [];
        byEmail[key].push(s);
      });
      var dups = Object.entries(byEmail).filter(function(e) { return e[1].length > 1; });
      if (!dups.length) {
        document.getElementById('duplicates-list').innerHTML = '<p style="font-size:.9rem;color:#6a6a6a;">No duplicate emails found.</p>';
      } else {
        document.getElementById('duplicates-list').innerHTML = dups.map(function(entry) {
          var emailKey = entry[0], rows = entry[1];
          return '<div style="margin-bottom:.75rem;padding:.6rem .8rem;background:#fff;border-radius:8px;border:1px solid #e8d0a0;">'
            + '<div style="font-weight:600;font-size:.88rem;color:#8a5000;margin-bottom:.35rem;">' + escHtml(emailKey) + ' &mdash; ' + rows.length + ' signups</div>'
            + rows.map(function(s) {
                var roles = []; try { roles = JSON.parse(s.roles||'[]'); } catch {}
                return '<div style="font-size:.83rem;color:#444;padding:.2rem 0;">'
                  + escHtml(s.name) + ' &bull; ' + escHtml(s.ministry) + (roles.length ? ' &bull; ' + roles.map(escHtml).join(', ') : '')
                  + ' <span style="color:#aaa;">' + escHtml((s.created_at||'').slice(0,10)) + '</span>'
                  + ' <button class="btn-delete btn-sm" style="margin-left:.5rem;" onclick="deleteSignup(' + s.id + ')">Remove</button>'
                  + '</div>';
              }).join('')
            + '</div>';
        }).join('');
      }
      panel.style.display = '';
    })
    .catch(function() {
      document.getElementById('duplicates-list').innerHTML = '<p style="font-size:.9rem;color:red;">Error loading data.</p>';
      panel.style.display = '';
    });
}

// ── Events management ────────────────────────────────────────────────
function loadEvents(expandEvId) {
  fetch('/admin/api/events')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var events = data.events || [];
      document.getElementById('events-count').textContent = events.length;
      if (!events.length) {
        document.getElementById('events-list').innerHTML = '<p class="empty-msg">No events yet. Add one above.</p>';
        return;
      }
      // Preserve any time/date values the user has already entered before re-rendering
      var preserved = {};
      document.querySelectorAll('[id^="role-start-"],[id^="role-end-"],[id^="role-date-"]').forEach(function(el) {
        if (el.value) preserved[el.id] = el.value;
      });
      document.getElementById('events-list').innerHTML = events.map(function(ev) {
        var statusClass = ev.hidden ? 'hidden' : 'visible';
        var statusLabel = ev.hidden ? 'Hidden' : 'Visible';
        var useTs = (ev.use_time_slots === undefined || ev.use_time_slots === null) ? 1 : ev.use_time_slots;
        var tsHide = useTs ? '' : 'display:none;';
        return '<div class="ev-admin-card" id="ev-admin-' + ev.id + '" data-hidden="' + (ev.hidden?1:0) + '" data-sort-order="' + (ev.sort_order||0) + '" data-use-time-slots="' + useTs + '">'
          + '<button class="ev-admin-header" onclick="toggleEvAdmin(' + ev.id + ')" aria-expanded="false">'
          + '<span class="ev-admin-name">' + escHtml(ev.name) + '</span>'
          + '<span class="ev-admin-date">' + (ev.event_date ? escHtml(ev.event_date) : 'No date') + '</span>'
          + '<span class="ev-admin-status ' + statusClass + '">' + statusLabel + '</span>'
          + '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
          + '</button>'
          + '<div id="ev-admin-body-' + ev.id + '" style="display:none;">'
          + '<div class="ev-admin-body">'
          + '<div class="form-row">'
          + '<div class="form-field"><label class="form-label">Event Name</label>'
          + '<input type="text" id="ev-name-' + ev.id + '" class="form-input" value="' + escHtml(ev.name) + '"></div>'
          + '<div class="form-field"><label class="form-label">Date</label>'
          + '<input type="date" id="ev-date-' + ev.id + '" class="form-input" value="' + escHtml(ev.event_date||'') + '"></div>'
          + '</div>'
          + '<div class="form-field"><label class="form-label">Description</label>'
          + '<textarea id="ev-desc-' + ev.id + '" class="form-textarea">' + escHtml(ev.description||'') + '</textarea></div>'
          + '<input type="hidden" id="ev-hidden-' + ev.id + '" value="' + (ev.hidden?1:0) + '">'
          + '<input type="hidden" id="ev-sort-' + ev.id + '" value="' + (ev.sort_order||0) + '">'
          + '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem;">'
          + '<input type="checkbox" id="ev-time-slots-' + ev.id + '"' + (useTs ? ' checked' : '') + ' style="width:auto;margin:0;" onchange="toggleTimeSlotFields(' + ev.id + ',this.checked)">'
          + '<label for="ev-time-slots-' + ev.id + '" style="font-size:.85rem;color:var(--navy);cursor:pointer;">Roles have scheduled time slots (date &amp; time)</label>'
          + '</div>'
          + '<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem;">'
          + '<button class="btn-primary btn-sm" onclick="saveEvent(' + ev.id + ')">Save Changes</button>'
          + '<button class="btn-secondary btn-sm" onclick="printEventRoster(' + ev.id + ')">&#128438; Print Roster</button>'
          + '<button class="btn-secondary btn-sm" onclick="toggleEventVisibility(' + ev.id + ',' + (ev.hidden?0:1) + ')">'
          + (ev.hidden ? 'Make Visible' : 'Hide Event') + '</button>'
          + '<button class="btn-delete btn-sm" onclick="deleteEvent(' + ev.id + ')">Delete Event</button>'
          + '</div>'
          + '<h4 style="font-size:.88rem;font-weight:600;color:var(--navy);margin-bottom:.5rem;">Roles</h4>'
          + '<div class="roles-list" id="roles-list-' + ev.id + '">'
          + (ev.roles||[]).map(function(r) {
              return '<div class="role-admin-row" id="role-row-' + r.id + '" data-sort-order="' + (r.sort_order||0) + '"><span style="font-size:.75rem;font-weight:600;color:var(--teal);white-space:nowrap;min-width:40px;text-align:center;">' + (r.filled_count||0) + '/' + (r.slots||'∞') + '</span>'
                + '<input type="text" class="form-input" style="flex:1;" id="role-name-' + r.id + '" value="' + escHtml(r.name) + '">'
                + '<input type="text" class="form-input" style="flex:2;" id="role-desc-' + r.id + '" value="' + escHtml(r.description||'') + '" placeholder="Description...">'
                + '<input type="date" class="form-input role-time-field" style="flex:1;min-width:120px;' + tsHide + '" id="role-date-' + r.id + '" value="' + escHtml(r.role_date||'') + '" title="Date">'
                + '<input type="time" class="form-input role-time-field" style="flex:0 0 90px;' + tsHide + '" id="role-start-' + r.id + '" value="' + toTimeInput(r.start_time||'') + '" data-raw="' + escHtml(r.start_time||'') + '" title="Start time">'
                + '<input type="time" class="form-input role-time-field" style="flex:0 0 90px;' + tsHide + '" id="role-end-' + r.id + '" value="' + toTimeInput(r.end_time||'') + '" data-raw="' + escHtml(r.end_time||'') + '" title="End time">'
                + '<input type="number" class="form-input" style="flex:0 0 60px;" id="role-slots-' + r.id + '" value="' + (r.slots||0) + '" min="0" title="Slots">'
                + '<input type="hidden" id="role-sort-' + r.id + '" value="' + (r.sort_order||0) + '">'
                + '<button class="btn-secondary btn-sm" onclick="saveRole(' + ev.id + ',' + r.id + ')">Save</button>'
                + '<button class="btn-delete btn-sm" onclick="deleteRole(' + ev.id + ',' + r.id + ')">Del</button>'
                + '</div>';
            }).join('')
          + '</div>'
          + '<div class="add-role-form">'
          + '<input type="text" id="new-role-name-' + ev.id + '" class="form-input" placeholder="Role name...">'
          + '<input type="text" id="new-role-desc-' + ev.id + '" class="form-input" placeholder="Description...">'
          + '<input type="date" id="new-role-date-' + ev.id + '" class="form-input role-time-field" style="flex:1;min-width:120px;' + tsHide + '" title="Date">'
          + '<input type="time" id="new-role-start-' + ev.id + '" class="form-input role-time-field" style="flex:0 0 90px;' + tsHide + '" title="Start time">'
          + '<input type="time" id="new-role-end-' + ev.id + '" class="form-input role-time-field" style="flex:0 0 90px;' + tsHide + '" title="End time">'
          + '<input type="number" id="new-role-slots-' + ev.id + '" class="form-input" style="flex:0 0 60px;" value="0" min="0" title="Slots">'
          + '<button class="btn-primary btn-sm" onclick="addRole(' + ev.id + ')">+ Role</button>'
          + '</div>'
          + '</div></div>'
          + '</div>';
      }).join('');
      // Explicitly set time input values via JS — setting value= through innerHTML
      // is unreliable for <input type="time"> in some browsers.
      events.forEach(function(ev) {
        (ev.roles || []).forEach(function(r) {
          var startEl = document.getElementById('role-start-' + r.id);
          var endEl   = document.getElementById('role-end-'   + r.id);
          if (startEl) startEl.value = toTimeInput(r.start_time || '');
          if (endEl)   endEl.value   = toTimeInput(r.end_time   || '');
        });
      });
      // Then restore any in-progress edits the user had before the re-render
      Object.keys(preserved).forEach(function(id) {
        var el = document.getElementById(id);
        if (el && preserved[id]) el.value = preserved[id];
      });
      if (expandEvId) {
        var body = document.getElementById('ev-admin-body-' + expandEvId);
        var btn = document.querySelector('#ev-admin-' + expandEvId + ' .ev-admin-header');
        if (body) body.style.display = '';
        if (btn) btn.setAttribute('aria-expanded', 'true');
      }
    })
    .catch(function() {
      document.getElementById('events-list').innerHTML = '<p class="empty-msg">Error loading events.</p>';
    });
}

function toggleEvAdmin(evId) {
  var body = document.getElementById('ev-admin-body-' + evId);
  var btn = document.querySelector('#ev-admin-' + evId + ' .ev-admin-header');
  var isOpen = body.style.display !== 'none';
  // Close all
  document.querySelectorAll('[id^="ev-admin-body-"]').forEach(function(el) {
    el.style.display = 'none';
  });
  document.querySelectorAll('.ev-admin-header').forEach(function(b) { b.setAttribute('aria-expanded','false'); });
  if (!isOpen) {
    body.style.display = '';
    if (btn) btn.setAttribute('aria-expanded','true');
  }
}

function toggleTimeSlotFields(evId, show) {
  var card = document.getElementById('ev-admin-' + evId);
  if (!card) return;
  card.querySelectorAll('.role-time-field').forEach(function(el) {
    el.style.display = show ? '' : 'none';
  });
}

function saveEvent(evId) {
  var name = document.getElementById('ev-name-' + evId).value;
  var date = document.getElementById('ev-date-' + evId).value;
  var desc = document.getElementById('ev-desc-' + evId).value;
  var card = document.getElementById('ev-admin-' + evId);
  var hidden = card ? parseInt(card.dataset.hidden || '0', 10) : 0;
  var sortOrder = card ? parseInt(card.dataset.sortOrder || '0', 10) : 0;
  var tsEl = document.getElementById('ev-time-slots-' + evId);
  var useTimeSlots = tsEl ? (tsEl.checked ? 1 : 0) : 1;
  fetch('/admin/api/events/' + evId, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ name:name, event_date:date, description:desc, hidden:hidden, sort_order:sortOrder, use_time_slots:useTimeSlots })
  }).then(function(r) {
    if (!r.ok) { r.text().then(function(t) { alert('Save failed: ' + t); }); return; }
    loadEvents(evId);
  }).catch(function(e) { alert('Save error: ' + e); });
}

function toggleEventVisibility(evId, hidden) {
  var name = document.getElementById('ev-name-' + evId).value;
  var date = document.getElementById('ev-date-' + evId).value;
  var desc = document.getElementById('ev-desc-' + evId).value;
  var card = document.getElementById('ev-admin-' + evId);
  var sortOrder = card ? parseInt(card.dataset.sortOrder || '0', 10) : 0;
  var tsEl = document.getElementById('ev-time-slots-' + evId);
  var useTimeSlots = tsEl ? (tsEl.checked ? 1 : 0) : 1;
  fetch('/admin/api/events/' + evId, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ name:name, event_date:date, description:desc, hidden:hidden, sort_order:sortOrder, use_time_slots:useTimeSlots })
  }).then(function(r) {
    if (!r.ok) { r.text().then(function(t) { alert('Error: ' + t); }); return; }
    loadEvents();
  }).catch(function(e) { alert('Error: ' + e); });
}

function deleteEvent(evId) {
  if (!confirm('Delete this event and all its roles? This cannot be undone.')) return;
  fetch('/admin/api/events/' + evId, { method: 'DELETE' })
    .then(function() { loadEvents(); });
}

function showAddEventForm() {
  var f = document.getElementById('add-event-form');
  f.style.display = f.style.display === 'none' ? '' : 'none';
}

function saveNewEvent() {
  var name = document.getElementById('new-ev-name').value.trim();
  if (!name) { alert('Please enter an event name.'); return; }
  var date = document.getElementById('new-ev-date').value;
  var desc = document.getElementById('new-ev-desc').value;
  var useTimeSlots = document.getElementById('new-ev-time-slots').checked ? 1 : 0;
  fetch('/admin/api/events', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ name:name, event_date:date, description:desc, use_time_slots:useTimeSlots })
  }).then(function(r) { return r.json(); }).then(function(data) {
    document.getElementById('new-ev-name').value = '';
    document.getElementById('new-ev-date').value = '';
    document.getElementById('new-ev-desc').value = '';
    document.getElementById('new-ev-time-slots').checked = true;
    document.getElementById('add-event-form').style.display = 'none';
    loadEvents(data.id);
  });
}

function saveRole(evId, roleId) {
  var name  = document.getElementById('role-name-'  + roleId).value;
  var desc  = document.getElementById('role-desc-'  + roleId).value;
  var date  = (document.getElementById('role-date-'  + roleId)||{}).value||'';
  var startEl = document.getElementById('role-start-' + roleId);
  var endEl   = document.getElementById('role-end-'   + roleId);
  var start = startEl ? (startEl.value ? fromTimeInput(startEl.value) : (startEl.dataset.raw || '')) : '';
  var end   = endEl   ? (endEl.value   ? fromTimeInput(endEl.value)   : (endEl.dataset.raw   || '')) : '';
  var slots = parseInt((document.getElementById('role-slots-' + roleId)||{}).value||'0',10);
  var row = document.getElementById('role-row-' + roleId);
  var sortOrder = row ? parseInt(row.dataset.sortOrder || '0', 10) : 0;
  var saveBtn = document.querySelector('#role-row-' + roleId + ' .btn-secondary');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  fetch('/admin/api/events/' + evId + '/roles/' + roleId, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ name:name, description:desc, slots:slots, role_date:date, start_time:start, end_time:end, sort_order:sortOrder })
  }).then(function(resp) {
    if (!resp.ok) { alert('Error saving role. Please try again.'); if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; } return; }
    // Update data-raw on time inputs so subsequent saves use the correct raw format,
    // without re-fetching from D1 (which can return stale data immediately after write).
    if (startEl && startEl.value) startEl.dataset.raw = start;
    if (endEl   && endEl.value)   endEl.dataset.raw   = end;
    if (saveBtn) { saveBtn.textContent = 'Saved!'; saveBtn.style.background = 'var(--teal)'; saveBtn.style.color = '#fff'; setTimeout(function() { saveBtn.disabled = false; saveBtn.textContent = 'Save'; saveBtn.style.background = ''; saveBtn.style.color = ''; }, 1500); }
  }).catch(function() {
    alert('Network error saving role. Please try again.');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
  });
}

function deleteRole(evId, roleId) {
  if (!confirm('Delete this role?')) return;
  fetch('/admin/api/events/' + evId + '/roles/' + roleId, { method: 'DELETE' })
    .then(function() { loadEvents(evId); });
}

function addRole(evId) {
  var name  = (document.getElementById('new-role-name-'+evId)||{}).value||'';
  var desc  = (document.getElementById('new-role-desc-'+evId)||{}).value||'';
  var date  = (document.getElementById('new-role-date-'+evId)||{}).value||'';
  var start = fromTimeInput((document.getElementById('new-role-start-'+evId)||{}).value||'');
  var end   = fromTimeInput((document.getElementById('new-role-end-'+evId)||{}).value||'');
  var slots = parseInt((document.getElementById('new-role-slots-'+evId)||{}).value||'0',10);
  if (!name.trim()) { alert('Please enter a role name.'); return; }
  fetch('/admin/api/events/' + evId + '/roles', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ name:name, description:desc, slots:slots, role_date:date, start_time:start, end_time:end })
  }).then(function(r) {
    if (!r.ok) { r.text().then(function(t) { alert('Add role failed: ' + t); }); return; }
    ['new-role-name-','new-role-desc-','new-role-date-','new-role-start-','new-role-end-','new-role-slots-'].forEach(function(pfx){
      var el = document.getElementById(pfx+evId); if (el) el.value = '';
    });
    loadEvents(evId);
  }).catch(function(e) { alert('Error: ' + e); });
}

function escHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Init
loadSignups();
loadEvents();
</script>
</body>
</html>`;
