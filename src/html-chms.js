// ── ChMS HTML app, service worker, manifest, and backlog ──────────────────────
import { getSchedulerInline } from './scheduler-inline.js';
import { HTML_HEAD } from './frontend/html-head.js';
import { HTML_TABS_1, HTML_TABS_2 } from './frontend/html-tabs.js';
import { JS_CORE, DEPLOY_VERSION } from './frontend/js-core.js';
import { JS_SETTINGS } from './frontend/js-settings.js';
import { JS_DASHBOARD } from './frontend/js-dashboard.js';
import { JS_PEOPLE } from './frontend/js-people.js';
import { JS_REGISTER } from './frontend/js-register.js';
import { JS_HOUSEHOLDS } from './frontend/js-households.js';
import { JS_GIVING } from './frontend/js-giving.js';
import { JS_REPORTS } from './frontend/js-reports.js';
import { JS_EXPORT_IMPORT } from './frontend/js-export-import.js';
import { JS_ATTENDANCE } from './frontend/js-attendance.js';
import { JS_TUITION_AID } from './frontend/js-tuition-aid.js';
import { JS_FINANCE } from './frontend/js-finance.js';
import { JS_VOLUNTEERS } from './frontend/js-volunteers.js';

export const CHMS_MANIFEST_JSON = '{"name":"TLC Gather","short_name":"Gather","description":"Church management for Timothy Lutheran Church","start_url":"/","display":"standalone","theme_color":"#1E2D4A","background_color":"#F8F4EE","scope":"/","icons":[{"src":"/icons/icon-192.png","sizes":"192x192","type":"image/png","purpose":"any"},{"src":"/icons/icon-512.png","sizes":"512x512","type":"image/png","purpose":"any"},{"src":"/icons/icon-512-maskable.png","sizes":"512x512","type":"image/png","purpose":"maskable"}]}';

// ── SERVICE WORKER ──────────────────────────────────────────────────
export const SW_JS = `
const STATIC_CACHE = 'chms-static-v1';
const API_CACHE    = 'chms-api-v1';
const STATIC_ASSETS = ['/chms.webmanifest'];
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      return cache.addAll(STATIC_ASSETS).catch(function(){});
    })
  );
  self.skipWaiting();
});
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k){return k!==STATIC_CACHE&&k!==API_CACHE;}).map(function(k){return caches.delete(k);}));
    }).then(function(){ return self.clients.claim(); })
  );
});
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/chms') {
    event.respondWith(fetch(event.request).catch(function(){ return caches.match('/chms'); }));
    return;
  }
  if (url.pathname === '/admin/api/people' && event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request.clone()).then(function(resp) {
        if (resp.ok) {
          caches.open(API_CACHE).then(function(cache){ cache.put(event.request, resp.clone()); });
          return resp;
        }
        return resp;
      }).catch(function() {
        return caches.match(event.request).then(function(cached) {
          if (cached) {
            var h = new Headers(cached.headers);
            h.set('X-From-Cache','true');
            return new Response(cached.body,{status:cached.status,headers:h});
          }
          return new Response(JSON.stringify({error:'Offline',offline:true}),{status:503,headers:{'Content-Type':'application/json'}});
        });
      })
    );
    return;
  }
  if (url.pathname === '/chms.webmanifest' || url.pathname.startsWith('/icons/')) {
    event.respondWith(caches.match(event.request).then(function(c){ return c || fetch(event.request); }));
  }
});
`;

// ── App JS, split out of the page into two long-cached external files ───────────────────────
// Previously these two chunks were inlined straight into CHMS_HTML, which is served with
// Cache-Control: no-store — meaning every single page load re-downloaded and re-parsed ~968KB
// of JS from scratch, even for the same staff member reloading the same page repeatedly in one
// session. Serving them as their own routes (see tlc-volunteer-worker.js) with a long, immutable
// Cache-Control lets the browser cache them across visits; the ?v= query param (DEPLOY_VERSION)
// busts that cache automatically on every version bump, with no separate step to remember.
// Split point is arbitrary (wherever the historical inline <script> tags happened to fall, see
// each module's own `<script>`/`</script>` wrapper) — not a functional boundary, kept exactly
// where it was to minimize risk; both files execute in the same global scope in the same order
// as before, so no function/variable visibility changes for either half.
const APP_CORE_JS_RAW = JS_CORE + JS_SETTINGS + JS_DASHBOARD + JS_PEOPLE + JS_REGISTER + JS_HOUSEHOLDS;
const APP_EXT_JS_RAW = JS_GIVING + JS_REPORTS + JS_EXPORT_IMPORT + JS_ATTENDANCE + JS_TUITION_AID + JS_FINANCE + JS_VOLUNTEERS;
export const CHMS_APP_CORE_JS = APP_CORE_JS_RAW.replace(/^<script>\n/, '').replace(/<\/script>\n$/, '');
export const CHMS_APP_EXT_JS = APP_EXT_JS_RAW.replace(/^<script>\n/, '').replace(/<\/script>\n$/, '');

// ── ChMS ADMIN HTML ────────────────────────────────────────────────
export const CHMS_HTML = HTML_HEAD
  + HTML_TABS_1
  + '<div id="tab-scheduler" class="tab-panel">\n' + getSchedulerInline() + '\n</div>\n'
  + HTML_TABS_2
  + `<script src="/admin/app-core.js?v=${DEPLOY_VERSION}"></script>\n`
  + `<script src="/admin/app-ext.js?v=${DEPLOY_VERSION}"></script>\n`;

// ── Dev Board (Kanban) ──────────────────────────────────────────────
export const BACKLOG_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CHMS Dev Board</title>
<style>
  :root {
    --navy:#1E2D4A;--teal:#2E7EA6;--gold:#C9973A;
    --bg:#F0EEE9;--surface:#FFFFFF;--border:#E2DED6;
    --text:#1E2D4A;--muted:#6B7280;--faint:#9CA3AF;
    --warn-bg:#FFF3CD;--warn:#92600A;
  }
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Georgia',serif;background:var(--bg);color:var(--text);min-height:100vh;display:flex;flex-direction:column;}
  header{padding:14px 20px;background:var(--navy);color:white;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;}
  header h1{font-size:17px;font-weight:normal;letter-spacing:-.02em;}
  header p{font-size:11px;opacity:.55;font-family:'Courier New',monospace;margin-top:2px;}
  .back-link{font-size:11px;color:rgba(255,255,255,.55);text-decoration:none;font-family:'Courier New',monospace;}
  .back-link:hover{color:white;}
  .add-bar{padding:10px 16px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;gap:8px;flex-shrink:0;}
  .add-bar input{flex:1;border:1px solid var(--border);border-radius:6px;padding:7px 11px;font-size:13px;font-family:'Georgia',serif;color:var(--text);}
  .add-bar input:focus{outline:2px solid var(--teal);border-color:transparent;}
  .add-bar select{border:1px solid var(--border);border-radius:6px;padding:7px 9px;font-size:12px;font-family:'Georgia',serif;background:white;width:130px;color:var(--text);}
  .add-bar button{background:var(--teal);color:white;border:none;border-radius:6px;padding:7px 16px;font-size:13px;cursor:pointer;white-space:nowrap;}
  .add-bar button:hover{background:var(--navy);}
  .board{display:flex;gap:12px;flex:1;overflow-x:auto;padding:14px 16px;align-items:flex-start;}
  .col{background:var(--surface);border:1px solid var(--border);border-radius:10px;min-width:230px;width:230px;display:flex;flex-direction:column;max-height:calc(100vh - 115px);}
  .col.drag-over{border-color:var(--teal);background:#f0f8ff;}
  .col-header{padding:11px 13px 9px;border-bottom:1px solid var(--border);flex-shrink:0;}
  .col-title{font-size:11px;font-weight:bold;font-family:'Courier New',monospace;text-transform:uppercase;letter-spacing:.07em;display:flex;justify-content:space-between;align-items:center;}
  .col-count{font-size:11px;background:var(--bg);border-radius:99px;padding:1px 7px;font-weight:normal;color:var(--muted);}
  .col-body{padding:9px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:7px;min-height:60px;}
  .card{background:white;border:1px solid var(--border);border-radius:8px;padding:10px 11px;cursor:grab;transition:box-shadow .12s,opacity .12s;user-select:none;}
  .card:hover{box-shadow:0 2px 8px rgba(0,0,0,.1);}
  .card.dragging{opacity:.35;cursor:grabbing;}
  .card-title{font-size:13px;line-height:1.45;color:var(--text);margin-bottom:6px;}
  .col-done .card-title{color:var(--faint);text-decoration:line-through;}
  .card-note{font-size:11px;color:var(--muted);font-family:'Courier New',monospace;margin-bottom:6px;line-height:1.35;}
  .card-footer{display:flex;justify-content:space-between;align-items:center;}
  .tag{font-size:10px;padding:2px 8px;border-radius:99px;font-family:'Courier New',monospace;display:inline-block;}
  .tag-bug        {background:#FEE2E2;color:#991B1B;}
  .tag-feature    {background:#DBEAFE;color:#1E40AF;}
  .tag-improvement{background:#D1FAE5;color:#065F46;}
  .tag-integration{background:#EDE9FE;color:#5B21B6;}
  .tag-performance{background:#FEF3C7;color:#92600A;}
  .tag-reporting  {background:#CCFBF1;color:#0F766E;}
  .tag-question   {background:#F3F4F6;color:#374151;}
  .tag-security   {background:#FEE2E2;color:#7F1D1D;}
  .tag-waiting    {background:#FFF3CD;color:#92600A;}
  .del-btn{background:none;border:none;color:var(--faint);cursor:pointer;font-size:15px;padding:0 2px;line-height:1;opacity:0;transition:opacity .12s;}
  .card:hover .del-btn{opacity:1;}
  .del-btn:hover{color:#DC2626;}
  .empty-col{font-size:11px;color:var(--faint);font-family:'Courier New',monospace;text-align:center;padding:18px 0;}
  footer{padding:5px 16px;font-size:10px;color:var(--faint);font-family:'Courier New',monospace;flex-shrink:0;text-align:right;}
</style>
</head>
<body>
<header>
  <div><h1>CHMS Dev Board</h1><p>admin.timothystl.org</p></div>
  <a class="back-link" href="/chms">&larr; back to app</a>
</header>
<div class="add-bar">
  <input type="text" id="new-item" placeholder="Add a task, feature, or question&hellip;" />
  <select id="new-type">
    <option value="feature">Feature</option>
    <option value="improvement">Improvement</option>
    <option value="reporting">Reporting</option>
    <option value="bug">Bug</option>
    <option value="performance">Performance</option>
    <option value="security">Security</option>
    <option value="integration">Integration</option>
    <option value="question">Question</option>
    <option value="waiting">Waiting</option>
  </select>
  <button onclick="addItem()">+ Add to Backlog</button>
</div>
<div class="board" id="board">
  <div class="col" id="col-backlog" data-col="backlog">
    <div class="col-header"><div class="col-title" style="color:var(--navy);">Backlog <span class="col-count" id="count-backlog">0</span></div></div>
    <div class="col-body" id="body-backlog"></div>
  </div>
  <div class="col" id="col-sprint" data-col="sprint">
    <div class="col-header"><div class="col-title" style="color:var(--teal);">This Sprint <span class="col-count" id="count-sprint">0</span></div></div>
    <div class="col-body" id="body-sprint"></div>
  </div>
  <div class="col" id="col-blocked" data-col="blocked">
    <div class="col-header"><div class="col-title" style="color:var(--warn);">Blocked <span class="col-count" id="count-blocked">0</span></div></div>
    <div class="col-body" id="body-blocked"></div>
  </div>
  <div class="col col-done" id="col-done" data-col="done">
    <div class="col-header"><div class="col-title" style="color:var(--faint);">Done <span class="col-count" id="count-done">0</span></div></div>
    <div class="col-body" id="body-done"></div>
  </div>
</div>
<footer id="last-saved"></footer>
<script>
const defaults = [
  { id:1,  text:"Edit and manage current tags", type:"improvement", col:"backlog", note:"" },
  { id:2,  text:"Fix how organization names are displayed", type:"bug", col:"backlog", note:"" },
  { id:3,  text:"Improve overall load times", type:"performance", col:"backlog", note:"" },
  { id:4,  text:"Security audit of data handling and access", type:"security", col:"backlog", note:"" },
  { id:5,  text:"Divide app into separate pages for faster loading", type:"performance", col:"backlog", note:"Code splitting" },
  { id:6,  text:"Rename subdomain (admin.timothystl.org)", type:"improvement", col:"backlog", note:"" },
  { id:7,  text:"Define integration path with volunteer app", type:"integration", col:"backlog", note:"scheduler.timothystl.org in maintenance mode" },
  { id:8,  text:"UI overhaul — closer to Breeze / Planning Center patterns", type:"improvement", col:"backlog", note:"" },
  { id:9,  text:"Search within giving / batches", type:"feature", col:"backlog", note:"" },
  { id:10, text:"Giving reports: YOY, YTD, by fund — with graphs", type:"reporting", col:"backlog", note:"" },
  { id:11, text:"Wait for Tithe.ly / Breeze merger before integration work", type:"waiting", col:"blocked", note:"Hold all integration decisions until merger outcome is clear" },
  { id:12, text:"Mobile usage review", type:"improvement", col:"backlog", note:"" },
  { id:13, text:"Clarify what 'Seed Sunday for the year' does", type:"question", col:"blocked", note:"Needs documentation or removal" },
  { id:14, text:"YOY giving graph — true year-over-year comparison toggle", type:"reporting", col:"backlog", note:"" },
  { id:15, text:"Year-end average weekly attendance figure", type:"reporting", col:"backlog", note:"" },
  { id:16, text:"Overlay giving data on attendance trends", type:"reporting", col:"backlog", note:"Dual-axis or combined chart" },
  { id:17, text:"Automated giving report / budget projection trend", type:"reporting", col:"backlog", note:"" },
];
let items = [], nextId = 18, dragId = null;
function load() {
  document.getElementById('last-saved').textContent = 'Loading…';
  fetch('/admin/api/board').then(function(r){return r.json();}).then(function(d){
    try {
      if (d.data) { var p = JSON.parse(d.data); items = p.items; nextId = p.nextId; }
      else { items = JSON.parse(JSON.stringify(defaults)); nextId = 18; }
    } catch(e) { items = JSON.parse(JSON.stringify(defaults)); nextId = 18; }
    render();
    document.getElementById('last-saved').textContent = '';
  }).catch(function(){
    items = JSON.parse(JSON.stringify(defaults)); nextId = 18;
    render();
  });
}
var _saveTimer = null;
function save() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(function() {
    fetch('/admin/api/board', {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ items: items, nextId: nextId })
    }).then(function(r){return r.json();}).then(function(){
      var n = new Date();
      document.getElementById('last-saved').textContent =
        'Saved ' + n.toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit'});
    }).catch(function(){
      document.getElementById('last-saved').textContent = 'Save failed — check connection';
    });
  }, 600);
}
function addItem() {
  const inp = document.getElementById('new-item');
  const text = inp.value.trim();
  if (!text) return;
  items.unshift({ id: nextId++, text, type: document.getElementById('new-type').value, col: 'backlog', note: '' });
  inp.value = '';
  save(); render();
}
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('new-item').addEventListener('keydown', function(e) { if (e.key === 'Enter') addItem(); });
  ['backlog','sprint','blocked','done'].forEach(function(col) {
    var body = document.getElementById('body-' + col);
    body.addEventListener('dragover', function(e) { e.preventDefault(); body.closest('.col').classList.add('drag-over'); });
    body.addEventListener('dragleave', function(e) { if (!body.contains(e.relatedTarget)) body.closest('.col').classList.remove('drag-over'); });
    body.addEventListener('drop', function(e) {
      e.preventDefault();
      body.closest('.col').classList.remove('drag-over');
      if (dragId == null) return;
      var item = items.find(function(i) { return i.id === dragId; });
      if (item) { item.col = col; save(); render(); }
      dragId = null;
    });
  });
});
function delItem(id) {
  if (!confirm('Remove this item?')) return;
  items = items.filter(function(i) { return i.id !== id; });
  save(); render();
}
function cardHTML(item) {
  var note = item.note ? \`<div class="card-note">\${item.note}</div>\` : '';
  return \`<div class="card" draggable="true"
    ondragstart="dragId=\${item.id};this.classList.add('dragging')"
    ondragend="this.classList.remove('dragging');dragId=null">
    <div class="card-title">\${item.text}</div>
    \${note}
    <div class="card-footer">
      <span class="tag tag-\${item.type}">\${item.type}</span>
      <button class="del-btn" onclick="event.stopPropagation();delItem(\${item.id})">&times;</button>
    </div>
  </div>\`;
}
function render() {
  ['backlog','sprint','blocked','done'].forEach(function(col) {
    var colItems = items.filter(function(i) { return i.col === col; });
    document.getElementById('body-' + col).innerHTML =
      colItems.length ? colItems.map(cardHTML).join('') : '<div class="empty-col">Drop cards here</div>';
    document.getElementById('count-' + col).textContent = colItems.length;
  });
}
load();
// ── Auto-logout after 2 hours of inactivity ───────────────────────────
(function(){
  var MS=2*60*60*1000,WARN=2*60*1000,t,w,b;
  function reset(){
    clearTimeout(t);clearTimeout(w);
    if(b)b.style.display='none';
    w=setTimeout(function(){
      if(!b){b=document.createElement('div');b.id='inact-warn';
        b.style.cssText='position:fixed;top:0;left:0;right:0;background:#c0392b;color:#fff;text-align:center;padding:10px 16px;z-index:99999;font-size:.9rem;font-family:sans-serif;';
        b.innerHTML='Signing out in 2 minutes due to inactivity. <button onclick="document.getElementById(\'inact-warn\').style.display=\'none\';reset()" style="margin-left:10px;background:#fff;color:#c0392b;border:none;padding:3px 10px;border-radius:4px;cursor:pointer;font-weight:600;">Stay Signed In</button>';
        document.body.appendChild(b);}
      else b.style.display='block';
    },MS-WARN);
    t=setTimeout(function(){location.href='/admin/logout';},MS);
  }
  ['click','keydown','mousemove','touchstart'].forEach(function(e){document.addEventListener(e,reset,{passive:true});});
  window.reset=reset;reset();
})();
</script>
</body>
</html>
`;
