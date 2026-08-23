// ── ChMS HTML app, service worker, manifest, and backlog ──────────────────────
import { getSchedulerInlineParts } from './scheduler-inline.js';
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

export const CHMS_MANIFEST_JSON = '{"name":"Connect","short_name":"Connect","description":"Church management for Timothy Lutheran Church","start_url":"/","display":"standalone","theme_color":"#1E2D4A","background_color":"#F8F4EE","scope":"/","icons":[{"src":"/icons/icon-192.png","sizes":"192x192","type":"image/png","purpose":"any"},{"src":"/icons/icon-512.png","sizes":"512x512","type":"image/png","purpose":"any"},{"src":"/icons/icon-512-maskable.png","sizes":"512x512","type":"image/png","purpose":"maskable"}]}';

// ── SERVICE WORKER ──────────────────────────────────────────────────
export const SW_JS = `
// Cache name is versioned by DEPLOY_VERSION, so every deploy starts a fresh cache and the
// activate handler below evicts the previous one. That's what keeps a stale app bundle from
// outliving its deploy — the ?v= query string already makes each version its own cache key,
// so without the eviction old versions would accumulate forever.
const VERSION      = '${DEPLOY_VERSION}';
const STATIC_CACHE = 'chms-static-' + VERSION;
const API_CACHE    = 'chms-api-' + VERSION;
// SEC19/P22-D. API_CACHE used to be a fixed 'chms-api-v1' and was deliberately EXCLUDED from
// the activate eviction below, so the directory it holds — names, emails, phones, addresses —
// outlived every deploy and was never rotated by anything. Versioning it means the activate
// handler treats it exactly like STATIC_CACHE: one deploy's copy of the directory does not
// survive into the next. Logout purges it outright (see purgeChmsCaches).

// The app shell. Served no-store over the wire (it is auth-gated, and that header keeps it out
// of any shared proxy cache), but the markup itself is completely static — it interpolates
// nothing per-user, and role visibility is applied client-side from /admin/api/me. Caching it
// in the SW is therefore origin-scoped, device-local, and carries no user data; it is what lets
// an installed PWA launch at all without a network. Every byte of actual data still comes from
// /admin/api/*, which returns 401 when the session is gone.
//
// Both paths are listed because the app is served at the ROOT on connect.timothystl.org and at
// /chms everywhere else. Checking only '/chms' — as this worker did before — meant the offline
// fallback was dead code on the one hostname anyone actually uses (a leftover from the CONN6
// rename, tracked as MOB4).
function isAppShell(url) {
  return url.pathname === '/' || url.pathname === '/chms';
}

// Long-cached, immutable, versioned by ?v= — the ideal cache-first targets, and ~1.3MB of the
// app's total weight. Deliberately NOT precached in install: they are fetched by the very page
// load that registers this worker, so precaching would double the download on a first visit.
// They get cached on first fetch instead, which costs nothing extra and is just as durable.
function isVersionedAsset(url) {
  return url.pathname === '/admin/app-member.js'
      || url.pathname === '/admin/app-staff.js'
      || url.pathname === '/admin/app-ext.js'
      || url.pathname === '/admin/app.css';
}

// SEC19/P22-D. Two synthetic cache keys, neither of them a real URL the network ever sees.
//
// The shell is cached PER ROLE. Its old comment claimed the markup "interpolates nothing
// per-user" — true when it was written, and false since CR9 made chmsHtmlForRole() emit one
// script tag for a member and three for everyone else. Cached under the bare key '/', an
// offline relaunch could hand one role the other role's script set. The worker cannot know the
// role from the response, so the PAGE tells it (applyRoleUI posts a 'chms-role' message) and
// the worker keeps that answer here, in the same version-scoped cache as the shell itself.
//
// Both live in STATIC_CACHE on purpose: it is evicted on every deploy, and so are the ?v=
// bundles the cached shell references — a shell that outlived its bundles could not boot
// offline anyway, so the marker's lifetime should match the shell's exactly.
const SHELL_ROLE_KEY = '/__chms/shell-role';
function shellCacheKey(role) { return '/__chms/shell/' + role; }

// Sanitized hard, because this value is concatenated into a cache key and arrives by
// postMessage — any page on this origin can send one.
function sanitizeRole(v) {
  return (typeof v === 'string' ? v : '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 20) || 'unknown';
}

function currentShellRole() {
  return caches.match(SHELL_ROLE_KEY)
    .then(function(r){ return r ? r.text() : ''; })
    .then(sanitizeRole)
    .catch(function(){ return 'unknown'; });
}

// Everything this app has cached, gone. Called on sign-out and whenever the API answers 401,
// which together cover both ways a session actually ends on a shared office machine. Scoped to
// our own 'chms-' prefix rather than caches.keys() wholesale — nothing else on this origin
// uses Cache Storage today, but deleting another app's cache is not ours to do.
function purgeChmsCaches() {
  return caches.keys().then(function(keys) {
    return Promise.all(keys.filter(function(k){ return k.indexOf('chms-') === 0; })
                           .map(function(k){ return caches.delete(k); }));
  }).catch(function(){});
}

self.addEventListener('message', function(event) {
  var data = event.data || {};
  if (data.type === 'chms-role') {
    var role = sanitizeRole(data.role);
    event.waitUntil(caches.open(STATIC_CACHE).then(function(c) {
      return c.put(SHELL_ROLE_KEY, new Response(role));
    }).catch(function(){}));
  } else if (data.type === 'chms-logout') {
    event.waitUntil(purgeChmsCaches());
  }
});

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      return cache.addAll(['/chms.webmanifest']).catch(function(){});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      // Both names now carry VERSION, so this drops the previous deploy's shell, bundles AND
      // its cached directory data. Before P22-D the API cache was unversioned and survived here.
      return Promise.all(keys.filter(function(k){
        return k !== STATIC_CACHE && k !== API_CACHE;
      }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  // Sign-out. Handled here rather than in the page because the Sign Out control is a plain
  // <a href="/admin/logout">, and because this also catches someone typing the URL. The
  // navigation itself is left completely untouched — no respondWith — so the worker cannot
  // break signing out even if the purge throws; waitUntil just keeps the worker alive long
  // enough to finish deleting.
  if (url.pathname === '/admin/logout') {
    event.waitUntil(purgeChmsCaches());
    return;
  }

  // App shell — network-first so a fresh deploy is picked up immediately, falling back to the
  // cached copy when offline. The previous version had this fallback but nothing ever populated
  // the cache, so caches.match() always missed and the fallback could never fire.
  if (isAppShell(url)) {
    event.respondWith(
      fetch(event.request).then(function(resp) {
        if (resp && resp.ok) {
          var copy = resp.clone();
          currentShellRole().then(function(role) {
            return caches.open(STATIC_CACHE).then(function(c){ c.put(shellCacheKey(role), copy); });
          }).catch(function(){});
        }
        return resp;
      }).catch(function() {
        return currentShellRole().then(function(role) {
          return caches.match(shellCacheKey(role));
        }).then(function(cached) {
          return cached || new Response(
            '<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><body style="font-family:system-ui;padding:2rem;text-align:center;color:#1E2D4A;background:#F8F4EE"><h1 style="font-weight:500">Offline</h1><p>Connect needs a network connection to load the first time.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
          );
        });
      })
    );
    return;
  }

  // Immutable versioned assets — cache-first. This is the change that makes a relaunch feel
  // instant instead of re-fetching ~1.3MB, and it is what the church's slow network most needs.
  if (isVersionedAsset(url)) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(resp) {
          if (resp && resp.ok) {
            var copy = resp.clone();
            caches.open(STATIC_CACHE).then(function(c){ c.put(event.request, copy); });
          }
          return resp;
        });
      })
    );
    return;
  }

  if (url.pathname === '/admin/api/people') {
    event.respondWith(
      fetch(event.request.clone()).then(function(resp) {
        if (resp.ok) {
          caches.open(API_CACHE).then(function(cache){ cache.put(event.request, resp.clone()); });
          return resp;
        }
        // A session that ends by expiring rather than by clicking Sign Out is the shared-office
        // case SEC19 is actually about: nobody logs out, the next person signs in. 401 is the
        // first moment the worker can know it happened.
        if (resp.status === 401) purgeChmsCaches();
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
// ── Member split ────────────────────────────────────────────────────────────────────────────
// The old app-core.js bundled six modules, three of which a member account can never reach.
// Role gating in this app is VISIBILITY, not payload: applyRoleUI() puts a `role-member` class
// on <body> and CSS hides the tabs, but the bytes were identical for every role — so a member,
// who is typically on a phone and can only ever open the directory, downloaded ~1.8MB including
// Finance, Giving, Tuition Aid and the Scheduler-adjacent code.
//
// app-core.js is therefore cut in two along the role line:
//   app-member.js  core + people + households  — everything a member session can reach
//   app-staff.js   settings + dashboard + register — the rest of the old app-core
// A member is served app-member.js alone; every other role is served member + staff + ext, in
// that order, which is the same total payload as before, just as three files instead of two.
//
// ORDER: people/households now parse before settings/dashboard/register, where they used to
// come after. That is safe because none of the six modules calls another module's function at
// parse time — the only top-level statements in any of them are listener registrations
// (js-core's window/modal handlers, js-settings' delegated change listener) and js-core's boot
// work is inside a 'load' handler, which fires after every script has run. Verified by
// test/member-bundle.test.js, which also asserts the two halves still add up to app-core.
const APP_MEMBER_JS_RAW = JS_CORE + JS_PEOPLE + JS_HOUSEHOLDS;
const APP_STAFF_JS_RAW = JS_SETTINGS + JS_DASHBOARD + JS_REGISTER;
const APP_EXT_JS_RAW = JS_GIVING + JS_REPORTS + JS_EXPORT_IMPORT + JS_ATTENDANCE + JS_TUITION_AID + JS_FINANCE + JS_VOLUNTEERS;
const stripScriptTags = (s) => s.replace(/^<script>\n/, '').replace(/<\/script>\n$/, '');
export const CHMS_APP_MEMBER_JS = stripScriptTags(APP_MEMBER_JS_RAW);
export const CHMS_APP_STAFF_JS = stripScriptTags(APP_STAFF_JS_RAW);
export const CHMS_APP_EXT_JS = stripScriptTags(APP_EXT_JS_RAW);
// Retained as the concatenation of the two halves. Nothing serves this — the worker serves the
// halves — but the test suite evaluates core+ext in a vm to exercise the real shipped code, and
// that harness wants one blob in load order.
export const CHMS_APP_CORE_JS = CHMS_APP_MEMBER_JS + '\n' + CHMS_APP_STAFF_JS;

// ── App CSS, split out of the page for the same reason as the app JS above ─────────────────
// HTML_HEAD's single <style> block is ~101KB of entirely static app CSS with nothing per-user
// in it, yet it rode along inside the no-store shell on every page load. Served as its own
// immutable route and referenced with the same ?v=DEPLOY_VERSION cache-buster instead.
// A <link> in <head> is still render-blocking, so there's no flash of unstyled content — the
// only cost is one extra same-origin round trip on a cold cache, paid back on every reload.
const _headStyleStart = HTML_HEAD.indexOf('<style>');
const _headStyleEnd = HTML_HEAD.indexOf('</style>');
if (_headStyleStart === -1 || _headStyleEnd === -1) {
  // Fail loudly at module load rather than silently shipping a page with no styles.
  throw new Error('html-chms.js: could not locate the <style> block in HTML_HEAD');
}
export const CHMS_APP_CSS = HTML_HEAD.slice(_headStyleStart + '<style>'.length, _headStyleEnd);
const HTML_HEAD_LINKED = (HTML_HEAD.slice(0, _headStyleStart)
  + `<link rel="stylesheet" href="/admin/app.css?v=${DEPLOY_VERSION}">`
  + HTML_HEAD.slice(_headStyleEnd + '</style>'.length))
  // Same cache-busting reason as app.css: /icons/* is served `max-age=31536000`-adjacent
  // (86400) and the filenames never change, so a browser holding the old mark would keep it
  // for a day after the artwork changes. Done here rather than in html-head.js because that
  // file is a static String.raw with no interpolation.
  .replace(/(\/icons\/[a-z0-9-]+\.png)"/g, `$1?v=${DEPLOY_VERSION}"`);

// ── Scheduler embed, lazy-loaded instead of inlined ────────────────────────────────────────
// This bundle is ~321KB — over half of what the shell used to weigh — and the Scheduler tab is
// admin-only (see the role guard in showTab), so every non-admin was downloading a tab they can
// never open, on every page load. Now the shell ships an empty placeholder and js-core.js
// fetches these two routes the first time someone actually opens the tab.
const _schedParts = getSchedulerInlineParts();
export const CHMS_SCHEDULER_HTML = _schedParts.markup;
export const CHMS_SCHEDULER_JS = _schedParts.js;

// ── ChMS ADMIN HTML ────────────────────────────────────────────────
// The markup is identical for every role — role visibility is applied client-side from
// /admin/api/me (see applyRoleUI), and the shell is served no-store, so there is nothing
// per-user in it. The ONLY thing that varies is which script tags are emitted, which is why
// this is a function of role rather than a constant: the cached JS assets themselves must stay
// role-neutral (they are `immutable` and shared across users), so the role decision has to live
// in the uncached shell.
const CHMS_SHELL = HTML_HEAD_LINKED
  + HTML_TABS_1
  + '<div id="tab-scheduler" class="tab-panel"></div>\n'
  + HTML_TABS_2;
// P25-F: `defer` is safe here — none of these bundles' top-level statements need to run before
// the DOM finishes parsing (they're listener registrations; js-core's actual boot work waits for
// the `load` event, which fires after every deferred script has already executed), and the tags
// already sit at the very end of the document. It lets the browser keep parsing/painting while
// the bundle downloads instead of blocking on it, and keeps execution order (member, staff, ext)
// exactly as today — deferred scripts run in source order, same as plain ones would have.
const scriptTag = (name) => `<script src="/admin/${name}.js?v=${DEPLOY_VERSION}" defer></script>\n`;
export function chmsHtmlForRole(role) {
  // A member gets the directory bundle only. If an admin has granted them the Reports tab,
  // js-core lazy-loads the other two on first open (ensureFullAppLoaded).
  //
  // Fail SAFE, not small: any role this doesn't recognize — including a null/undefined role
  // from a future caller — gets the full set. Under-serving scripts to a staff account would
  // break their app; over-serving them to a member only costs bytes.
  //
  // P25-F: the document itself never closed </body></html> — harmless (browsers recover), but
  // not to spec, and it's what the served bytes should actually say.
  const scripts = role === 'member'
    ? scriptTag('app-member')
    : scriptTag('app-member') + scriptTag('app-staff') + scriptTag('app-ext');
  return CHMS_SHELL + scripts + '</body>\n</html>\n';
}
// Full-access shell. Kept as an export because the test suite and the div-balance scans read it
// directly; the worker calls chmsHtmlForRole() instead.
export const CHMS_HTML = chmsHtmlForRole('admin');

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
function bEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function cardHTML(item) {
  var note = item.note ? \`<div class="card-note">\${bEsc(item.note)}</div>\` : '';
  var id = parseInt(item.id, 10) || 0;
  return \`<div class="card" draggable="true"
    ondragstart="dragId=\${id};this.classList.add('dragging')"
    ondragend="this.classList.remove('dragging');dragId=null">
    <div class="card-title">\${bEsc(item.text)}</div>
    \${note}
    <div class="card-footer">
      <span class="tag tag-\${bEsc(item.type)}">\${bEsc(item.type)}</span>
      <button class="del-btn" onclick="event.stopPropagation();delItem(\${id})">&times;</button>
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
        // Built via DOM calls rather than an innerHTML string with escaped inner quotes:
        // this file is a plain (non-String.raw) template literal, so a \' in the source
        // collapses to a bare ' in the served script and kills the whole <script> block
        // (the recurring SC3-BUG1 class — this block was in fact dead until this fix).
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
</script>
</body>
</html>
`;
