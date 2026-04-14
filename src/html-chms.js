// ── ChMS HTML app, service worker, manifest, and backlog ──────────────────────
export const CHMS_MANIFEST_JSON = '{"name":"TLC Church Directory","short_name":"TLC Directory","description":"People directory and giving records for Timothy Lutheran Church","start_url":"/chms","display":"standalone","theme_color":"#0A3C5C","background_color":"#EDF5F8","scope":"/","icons":[{"src":"tlc-logo.png","sizes":"500x500","type":"image/png","purpose":"any maskable"}]}';

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
  if (url.pathname === '/chms.webmanifest' || url.pathname === '/tlc-logo.png') {
    event.respondWith(caches.match(event.request).then(function(c){ return c || fetch(event.request); }));
  }
});
`;

// ── ChMS ADMIN HTML ────────────────────────────────────────────────
export const CHMS_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>People &amp; Giving — Timothy Lutheran</title>
<link rel="manifest" href="/chms.webmanifest">
<meta name="theme-color" content="#0A3C5C">
<link href="https://fonts.googleapis.com/css2?family=Lora:wght@600;700&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{
  --steel-anchor:#0A3C5C;--deep-steel:#2A5470;--mid-steel:#3D627C;--sky-steel:#5C8FA8;
  --ice-blue:#C4DDE8;--blue-mist:#EDF5F8;--amber:#D4922A;--deep-amber:#C07D1E;
  --pale-gold:#F5E0B0;--sage:#6B8F71;--pale-sage:#CDE0CF;--warm-white:#FAF7F0;
  --linen:#F2EDE2;--white:#FFFFFF;--border:#E8E0D0;--charcoal:#3D3530;--warm-gray:#7A6E60;
  --font-head:'Lora',Georgia,serif;--font-body:'Source Sans 3',Arial,sans-serif;
  --danger:#B85C3A;
  --navy:#1E2D4A;--teal:#2E7EA6;--gold-accent:#C9973A;
  --bg:#F7F6F3;--muted:#6B7280;--faint:#9CA3AF;
}
*{box-sizing:border-box;margin:0;padding:0;}
html,body{height:100%;overflow:hidden;}
body{font-family:var(--font-body);background:var(--warm-white);color:var(--charcoal);}
a{color:var(--sky-steel);}
/* ── HEADER ── */
header{background:var(--white);border-bottom:3px solid var(--amber);padding:14px 24px;display:flex;align-items:center;gap:14px;box-shadow:0 2px 12px rgba(10,60,92,.07);position:sticky;top:0;z-index:100;}
.hdr-logo{font-size:1.6rem;color:var(--amber);flex-shrink:0;}
.hdr-text{flex:1;}
.hdr-church{font-size:.7rem;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.09em;}
.hdr-title{font-family:var(--font-head);font-size:1.05rem;color:var(--steel-anchor);font-weight:700;line-height:1.2;}
.hdr-sub{font-size:.78rem;color:var(--warm-gray);}
.hdr-actions{display:flex;gap:8px;flex-shrink:0;}
.btn-sm{padding:6px 14px;border-radius:8px;font-family:var(--font-body);font-size:.82rem;font-weight:600;cursor:pointer;border:1.5px solid var(--border);background:var(--linen);color:var(--charcoal);text-decoration:none;display:inline-flex;align-items:center;gap:4px;transition:background .15s;}
.btn-sm:hover{background:var(--blue-mist);}
/* ── OFFLINE BANNER ── */
#offline-banner{display:none;background:var(--pale-gold);border-bottom:1px solid var(--amber);padding:8px 24px;font-size:.82rem;color:var(--charcoal);text-align:center;}
/* ── TABS ── */
.tab-bar{background:var(--white);border-bottom:1px solid var(--border);padding:12px 24px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.tab-btn{padding:6px 18px;border-radius:20px;border:1.5px solid var(--steel-anchor);font-size:.82rem;font-weight:600;cursor:pointer;background:transparent;color:var(--steel-anchor);transition:all .15s;}
.tab-btn.active{background:var(--steel-anchor);color:var(--white);}
.tab-btn:hover:not(.active){background:var(--blue-mist);}
/* ── PANELS ── */
.tab-panel{display:none;padding:20px 24px;}
.tab-panel.active{display:flex;flex-direction:column;flex:1;overflow-y:auto;}
/* ── APP SHELL ── */
#offline-banner{position:relative;z-index:200;}
.app-shell{display:flex;height:100vh;}
/* ── SIDEBAR ── */
.sidebar{position:fixed;left:0;top:0;height:100vh;width:54px;background:var(--navy);display:flex;flex-direction:column;align-items:stretch;padding:12px 0;gap:4px;overflow:hidden;transition:width .2s ease;z-index:200;}.sidebar:hover{width:200px;}a.s-item{text-decoration:none;color:inherit;}
.s-logo{width:34px;height:34px;border-radius:8px;background:var(--gold-accent);display:flex;align-items:center;justify-content:center;margin-bottom:10px;flex-shrink:0;cursor:pointer;align-self:center;}
.s-logo svg{width:18px;height:18px;fill:white;}
.s-item{width:100%;height:38px;border-radius:9px;display:flex;align-items:center;justify-content:flex-start;padding:0 8px 0 14px;gap:10px;cursor:pointer;position:relative;flex-shrink:0;transition:background .12s;overflow:hidden;white-space:nowrap;}
.s-item:hover{background:rgba(255,255,255,.1);}
.s-item.active{background:var(--teal);}
.s-item svg{width:19px;height:19px;fill:none;stroke:rgba(255,255,255,.55);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0;}
.s-item.active svg{stroke:white;}
.s-divider{width:28px;height:1px;background:rgba(255,255,255,.15);margin:4px 0;flex-shrink:0;align-self:center;}
.s-bottom{margin-top:auto;display:flex;flex-direction:column;align-items:stretch;gap:4px;}
.s-tip{position:static;transform:none;background:transparent;border:none;padding:0;font-size:13px;color:rgba(255,255,255,.7);white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .12s;z-index:auto;}
.sidebar:hover .s-tip{opacity:1;}
/* ── ROLE-BASED VISIBILITY ── */
/* .require-finance = visible only for admin + finance */
/* .require-staff   = visible only for admin + staff   */
/* .require-edit    = visible for admin + finance + staff (not member) */
/* .require-admin   = admin only */
/* .no-member       = hidden for member role */
.role-staff  .require-finance{display:none!important;}
.role-member .require-finance{display:none!important;}
.role-finance .require-staff{display:none!important;}
.role-member .require-staff{display:none!important;}
.role-member .require-edit{display:none!important;}
.role-member .no-member{display:none!important;}
.role-finance .require-admin{display:none!important;}
.role-staff   .require-admin{display:none!important;}
.role-member  .require-admin{display:none!important;}
/* ── CONTENT AREA ── */
.content-area{flex:1;display:flex;flex-direction:column;overflow:hidden;margin-left:54px;}
/* ── TOPBAR ── */
.topbar{height:50px;border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 20px;gap:12px;flex-shrink:0;background:var(--white);}
.topbar-title{font-size:15px;font-weight:500;color:var(--charcoal);flex:1;}
.hamburger{display:none;background:none;border:none;cursor:pointer;padding:0;}
.hamburger svg{width:22px;height:22px;stroke:var(--charcoal);fill:none;stroke-width:2;}
.sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:90;}
@media(max-width:700px){
  .sidebar{left:-200px;width:200px;transition:left .2s;}
  .sidebar:hover{width:200px;}
  .sidebar.open{left:0;}
  .sidebar-overlay.open{display:block;}
  .hamburger{display:flex;}
  .content-area{margin-left:0;}
}
/* ── TOOLBAR ── */
.toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px;}
.search-wrap{position:relative;flex:1;min-width:180px;max-width:360px;}
.search-wrap input{width:100%;padding:8px 12px 8px 34px;border:1.5px solid var(--border);border-radius:8px;font-family:var(--font-body);font-size:.9rem;background:var(--white);}
.search-wrap input:focus{outline:none;border-color:var(--steel-anchor);}
.search-wrap::before{content:'⌕';position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--warm-gray);font-size:1rem;pointer-events:none;}
.filter-pills{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
.pill{padding:4px 14px;border-radius:20px;border:1.5px solid var(--steel-anchor);font-size:.78rem;font-weight:600;cursor:pointer;background:transparent;color:var(--steel-anchor);transition:all .15s;white-space:nowrap;}
.pill.active{background:var(--steel-anchor);color:var(--white);}
.pill:hover:not(.active){background:var(--blue-mist);}
.pill-tag{border-color:var(--sky-steel);color:var(--sky-steel);}
.pill-tag.active{background:var(--sky-steel);color:var(--white);}
.tag-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;}
/* ── BUTTONS ── */
.btn-primary{padding:8px 18px;background:var(--steel-anchor);color:var(--white);border:none;border-radius:8px;font-family:var(--font-body);font-size:.9rem;font-weight:700;cursor:pointer;transition:background .15s;}
.btn-primary:hover{background:var(--deep-steel);}
.btn-secondary{padding:8px 16px;background:var(--linen);color:var(--charcoal);border:1.5px solid var(--border);border-radius:8px;font-family:var(--font-body);font-size:.9rem;font-weight:600;cursor:pointer;transition:background .15s;}
.btn-secondary:hover{background:var(--blue-mist);}
.btn-danger{padding:7px 14px;background:none;color:var(--danger);border:1.5px solid var(--danger);border-radius:7px;font-family:var(--font-body);font-size:.85rem;font-weight:600;cursor:pointer;}
.btn-danger:hover{background:#fdf0ec;}
/* ── PERSON CARDS ── */
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;}
.p-card{background:var(--white);border:1px solid var(--border);border-radius:12px;box-shadow:0 2px 10px rgba(10,60,92,.05);cursor:pointer;overflow:hidden;transition:box-shadow .15s;}
.p-card:hover{box-shadow:0 4px 16px rgba(10,60,92,.1);}
.p-card.member{border-left:3px solid var(--amber);}
.p-card-top{padding:14px 16px 10px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--linen);}
.avatar{width:44px;height:44px;border-radius:50%;background:var(--ice-blue);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:var(--font-head);font-size:.95rem;font-weight:700;color:var(--steel-anchor);overflow:hidden;}
.avatar img{width:100%;height:100%;object-fit:cover;}
.p-name{font-family:var(--font-head);font-size:1rem;font-weight:700;color:var(--steel-anchor);}
.p-type{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:2px 7px;border-radius:10px;display:inline-block;margin-top:2px;}
.type-member{background:var(--pale-gold);color:var(--deep-amber);}
.type-visitor{background:var(--ice-blue);color:var(--mid-steel);}
.type-inactive{background:var(--linen);color:var(--warm-gray);}
.type-associate{background:var(--pale-sage);color:var(--sage);}
.type-friend{background:var(--linen);color:var(--warm-gray);}
.p-card-body{padding:10px 16px;}
.p-row{display:flex;align-items:center;gap:6px;font-size:.85rem;color:var(--charcoal);margin-bottom:5px;}
.p-icon{width:16px;text-align:center;color:var(--warm-gray);font-size:.8rem;flex-shrink:0;}
.p-tags{display:flex;flex-wrap:wrap;gap:4px;padding:0 16px 10px;}
.tag-chip{font-size:.7rem;font-weight:600;padding:2px 8px;border-radius:10px;border-width:1px;border-style:solid;}
/* ── HOUSEHOLDS ── */
.h-card{background:var(--white);border:1px solid var(--border);border-radius:12px;box-shadow:0 2px 10px rgba(10,60,92,.05);cursor:pointer;padding:16px 18px;transition:box-shadow .15s;}
.h-card:hover{box-shadow:0 4px 16px rgba(10,60,92,.1);}
.h-name{font-family:var(--font-head);font-size:1rem;font-weight:700;color:var(--steel-anchor);margin-bottom:4px;}
.h-addr{font-size:.85rem;color:var(--warm-gray);margin-bottom:8px;}
.h-members{display:flex;flex-wrap:wrap;gap:6px;}
.h-member-pill{font-size:.75rem;background:var(--blue-mist);border:1px solid var(--ice-blue);color:var(--steel-anchor);padding:2px 8px;border-radius:10px;}
/* ── GIVING ── */
.giving-layout{display:grid;grid-template-columns:300px 1fr;gap:0;flex:1;min-height:0;}
@media(max-width:900px){.giving-layout{grid-template-columns:1fr;}}
.batch-list-panel{background:var(--white);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;}
.batch-list-hdr{padding:12px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
.batch-list-hdr h3{font-family:var(--font-head);font-size:.92rem;color:var(--steel-anchor);}
.batch-search-wrap{padding:8px 10px;border-bottom:1px solid var(--border);flex-shrink:0;}
.batch-search-wrap input{width:100%;padding:6px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:.84rem;font-family:var(--font-body);background:var(--linen);box-sizing:border-box;color:var(--charcoal);}
.batch-search-wrap input:focus{outline:none;border-color:var(--steel-anchor);background:var(--white);}
.batch-filter-pills{padding:7px 10px;border-bottom:1px solid var(--border);display:flex;gap:5px;flex-shrink:0;}
#batch-list{flex:1;overflow-y:auto;}
.batch-row{padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .1s;}
.batch-row:hover{background:var(--linen);}
.batch-row.selected{background:var(--blue-mist);box-shadow:inset 3px 0 0 var(--teal);}
.batch-date{font-size:.75rem;color:var(--warm-gray);}
.batch-desc{font-weight:600;font-size:.87rem;color:var(--charcoal);margin:1px 0;}
.batch-meta{display:flex;gap:8px;align-items:center;margin-top:3px;font-size:.74rem;color:var(--warm-gray);}
.badge-open{background:#D1FAE5;color:#065F46;padding:2px 8px;border-radius:99px;font-size:.68rem;font-weight:700;}
.badge-closed{background:var(--linen);color:var(--warm-gray);padding:2px 8px;border-radius:99px;font-size:.68rem;font-weight:700;}
.batch-detail-panel{background:var(--white);display:flex;flex-direction:column;overflow-y:auto;}
.batch-detail-hdr{padding:14px 18px;border-bottom:1px solid var(--border);flex-shrink:0;}
.total-bar{padding:10px 18px;background:var(--linen);border-bottom:1px solid var(--border);display:flex;align-items:baseline;gap:10px;flex-shrink:0;}
.total-amount{font-family:var(--font-head);font-size:1.4rem;color:var(--steel-anchor);font-weight:700;}
.total-count{font-size:.82rem;color:var(--warm-gray);}
.entry-form{padding:14px 18px;border-bottom:1px solid var(--border);flex-shrink:0;}
.form-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px;}
.field{display:flex;flex-direction:column;gap:4px;}
.field label{font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--warm-gray);}
.field input,.field select,.field textarea{padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-family:var(--font-body);font-size:.9rem;color:var(--charcoal);background:var(--warm-white);}
.field input:focus,.field select:focus{outline:none;border-color:var(--steel-anchor);}
.field-person{flex:1;min-width:180px;}
.field-fund{flex:1;min-width:140px;}
.field-amount{width:110px;}
.field-check{width:100px;}
.method-row{display:flex;gap:14px;align-items:center;}
.method-row label{display:flex;align-items:center;gap:5px;font-size:.87rem;cursor:pointer;}
.entries-table{width:100%;border-collapse:collapse;font-size:.87rem;}
.entries-table th{padding:8px 12px;text-align:left;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--warm-gray);border-bottom:1px solid var(--border);background:var(--linen);}
.entries-table th.amt-col{text-align:right;}
.entries-table td{padding:9px 12px;border-bottom:1px solid var(--border);}
.entries-table td.amt-col{text-align:right;font-variant-numeric:tabular-nums;}
.entries-table tr:last-child td{border-bottom:none;}
.entries-table tr:hover td{background:var(--linen);}
.del-entry{background:none;border:none;color:var(--danger);cursor:pointer;font-size:1rem;padding:0 4px;opacity:.6;}
.del-entry:hover{opacity:1;}
/* ── CHURCH REGISTER ── */
.reg-shell{display:flex;flex-direction:column;flex:1;overflow:hidden;}
.reg-toolbar{display:flex;align-items:center;gap:10px;padding:12px 20px;border-bottom:1px solid var(--border);background:var(--white);flex-shrink:0;flex-wrap:wrap;}
.reg-search{flex:1;min-width:160px;max-width:280px;padding:6px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;outline:none;}
.reg-search:focus{border-color:var(--teal);}
.reg-year-select{padding:6px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:var(--white);outline:none;cursor:pointer;}
.reg-stat-txt{font-size:13px;color:var(--warm-gray);margin-left:auto;}
.reg-body{display:flex;flex:1;overflow:hidden;gap:0;}
.reg-form-panel{width:300px;flex-shrink:0;border-right:1px solid var(--border);background:var(--white);overflow-y:auto;padding:20px;}
.reg-form-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--warm-gray);margin-bottom:14px;}
.reg-list-panel{flex:1;overflow-y:auto;padding:20px;background:var(--bg);}
.reg-year-hdr{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--warm-gray);padding:16px 0 8px;border-bottom:2px solid var(--border);margin-bottom:0;}
.reg-year-hdr:first-child{padding-top:0;}
.reg-table{width:100%;border-collapse:collapse;font-size:.875rem;background:var(--white);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:20px;}
.reg-table th{padding:7px 12px;text-align:left;font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--warm-gray);background:var(--linen);border-bottom:1px solid var(--border);}
.reg-table td{padding:10px 12px;border-bottom:1px solid var(--border);vertical-align:top;}
.reg-table tr:last-child td{border-bottom:none;}
.reg-table tr:hover td{background:var(--linen);}
.reg-person-chip{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--teal);cursor:pointer;border:1px solid var(--teal);border-radius:99px;padding:1px 8px;}
.reg-person-chip:hover{background:var(--blue-mist);}
.reg-edit-btn{background:none;border:none;color:var(--sky-steel);cursor:pointer;font-size:.78rem;padding:2px 6px;border-radius:4px;opacity:.7;}
.reg-edit-btn:hover{opacity:1;background:var(--blue-mist);}
@media(max-width:700px){.reg-form-panel{display:none;}.reg-body{flex-direction:column;}.reg-add-toggle{display:inline-flex !important;}}
/* ── REPORTS ── */
.report-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin-bottom:20px;}
.report-tile{background:var(--white);border:1px solid var(--border);border-radius:12px;padding:20px;cursor:pointer;transition:box-shadow .15s;}
.report-tile:hover{box-shadow:0 4px 16px rgba(10,60,92,.1);}
.tile-icon{font-size:1.6rem;margin-bottom:8px;}
.tile-title{font-family:var(--font-head);font-size:.95rem;color:var(--steel-anchor);font-weight:700;margin-bottom:4px;}
.tile-desc{font-size:.8rem;color:var(--warm-gray);}
.report-output{background:var(--white);border:1px solid var(--border);border-radius:12px;padding:20px;display:none;}
.report-output.visible{display:block;}
.rpt-table{width:100%;border-collapse:collapse;font-size:.87rem;margin-top:12px;}
.rpt-table th{text-align:left;padding:6px 10px;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--warm-gray);border-bottom:2px solid var(--border);}
.rpt-table td{padding:7px 10px;border-bottom:1px solid var(--linen);}
.rpt-total{font-weight:700;border-top:2px solid var(--border) !important;}
/* ── ATTENDANCE ── */
.att-chart-card{background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px 18px 10px;margin-bottom:14px;}
.att-stats-row{display:flex;gap:22px;margin-bottom:14px;flex-wrap:wrap;align-items:flex-end;}
.att-stat-val{font-size:1.75rem;font-weight:700;font-family:var(--font-head);color:var(--steel-anchor);line-height:1;}
.att-stat-lbl{font-size:.7rem;text-transform:uppercase;letter-spacing:.07em;color:var(--warm-gray);margin-top:3px;}
.att-stat-primary .att-stat-val{font-size:2.6rem;}
.att-stat-divider{width:1px;height:36px;background:var(--border);flex-shrink:0;}
.att-list-card{background:var(--white);border:1px solid var(--border);border-radius:12px;overflow:hidden;}
.att-date-group{border-bottom:1px solid var(--border);}
.att-date-group:last-child{border-bottom:none;}
.att-date-hdr{display:flex;align-items:center;gap:6px;padding:10px 14px 4px;cursor:pointer;transition:background .15s;}
.att-date-hdr:hover{background:var(--linen);}
.att-date-group.future{background:var(--linen);opacity:.5;}
.att-date-group.future .att-date-hdr:hover{background:var(--linen);}
.att-combined{margin-left:auto;font-size:.78rem;font-weight:700;color:var(--steel-anchor);background:var(--ice-blue);padding:2px 8px;border-radius:100px;}
.att-svc-nums{display:flex;gap:20px;padding:2px 14px 8px;font-size:.88rem;}
.att-svc-lbl{font-size:.7rem;font-weight:700;color:var(--warm-gray);text-transform:uppercase;margin-right:4px;}
.att-svc-v{font-size:1rem;font-weight:700;color:var(--charcoal);}
.att-inline-form{padding:12px 14px 14px;background:var(--blue-mist);border-top:1px solid var(--ice-blue);}
.att-edit-hint{font-size:.72rem;color:var(--warm-gray);margin-left:6px;}
/* ── IMPORT ── */
.import-card{background:var(--white);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:14px;}
.import-card h3{font-family:var(--font-head);font-size:1rem;color:var(--steel-anchor);margin-bottom:6px;}
.import-card p{font-size:.85rem;color:var(--warm-gray);margin-bottom:12px;}
.import-status{font-size:.82rem;margin-top:10px;min-height:20px;}
.import-status.ok{color:var(--sage);}
.import-status.err{color:var(--danger);}
.import-status.warn{color:var(--amber,#b45309);}
.progress-bar{height:6px;background:var(--ice-blue);border-radius:3px;margin-top:8px;display:none;}
.progress-fill{height:100%;background:var(--steel-anchor);border-radius:3px;transition:width .3s;}
/* ── MODAL ── */
.modal-overlay{position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;padding:16px;}
.modal-overlay.open{display:flex;}
.modal{background:var(--white);border-radius:14px;padding:28px 26px;width:100%;max-width:560px;max-height:90vh;overflow-y:auto;box-shadow:0 6px 32px rgba(0,0,0,.15);}
.modal h2{font-family:var(--font-head);font-size:1.1rem;color:var(--steel-anchor);margin-bottom:18px;}
.modal-2col{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
@media(max-width:480px){.modal-2col{grid-template-columns:1fr;}}
.modal-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:20px;padding-top:16px;border-top:1px solid var(--border);}
.modal-section{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--warm-gray);margin:16px 0 8px;border-bottom:1px solid var(--linen);padding-bottom:4px;}
.tag-picker{display:flex;flex-wrap:wrap;gap:6px;padding:8px 0;}
/* ── AUTOCOMPLETE ── */
.ac-wrap{position:relative;}
.ac-dropdown{position:absolute;top:100%;left:0;right:0;background:var(--white);border:1.5px solid var(--steel-anchor);border-radius:8px;z-index:500;max-height:200px;overflow-y:auto;display:none;box-shadow:0 4px 16px rgba(0,0,0,.12);}
.ac-dropdown.open{display:block;}
.ac-item{padding:8px 12px;cursor:pointer;font-size:.88rem;}
.ac-item:hover,.ac-item.selected{background:var(--blue-mist);}
/* ── EMPTY STATE ── */
.empty{text-align:center;padding:48px 24px;color:var(--warm-gray);grid-column:1/-1;}
.empty-icon{font-size:2.2rem;margin-bottom:10px;}
/* ── STATUS ── */
.status-msg{font-size:.85rem;padding:8px 0;min-height:24px;}
.status-msg.ok{color:var(--sage);}
.status-msg.err{color:var(--danger);}
/* ── MOBILE CONTACT CARDS ── */
.contact-list{display:none;}
@media(max-width:767px){
  .tab-btn:not([data-tab="people"]):not([data-tab="attendance"]){display:none;}
  .card-grid{display:none;}
  .contact-list{display:flex;flex-direction:column;}
  .toolbar .filter-pills{display:none;}
  .c-card{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--white);}
  .c-avatar{width:42px;height:42px;border-radius:50%;background:var(--ice-blue);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:var(--font-head);font-size:.9rem;font-weight:700;color:var(--steel-anchor);overflow:hidden;}
  .c-avatar img{width:100%;height:100%;object-fit:cover;}
  .c-info{flex:1;min-width:0;}
  .c-name{font-weight:700;font-size:.95rem;color:var(--charcoal);}
  .c-type{font-size:.7rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px;}
  .c-link{display:flex;align-items:center;gap:5px;font-size:.88rem;color:var(--steel-anchor);text-decoration:none;min-height:34px;}
  .c-link svg{width:14px;height:14px;flex-shrink:0;}
  header .hdr-sub{display:none;}
}
/* ── MULTI-SELECT ── */
.p-card.selectable{cursor:pointer;position:relative;}
.p-card.selectable:hover{box-shadow:0 0 0 2px var(--steel-anchor);}
.p-card.selected{box-shadow:0 0 0 3px var(--steel-anchor);background:var(--blue-mist);}
.p-select-cb{position:absolute;top:8px;left:8px;width:18px;height:18px;border:2px solid var(--border);border-radius:4px;background:var(--white);display:flex;align-items:center;justify-content:center;z-index:2;}
.p-card.selected .p-select-cb{background:var(--steel-anchor);border-color:var(--steel-anchor);color:#fff;}
/* ── SETTINGS ── */
code{background:var(--linen);padding:1px 5px;border-radius:4px;font-size:.85em;font-family:monospace;}
/* ── PEOPLE DIRECTORY TABLE ── */
.dir-table{width:100%;border-collapse:collapse;font-size:13px;}
.dir-table th{text-align:left;padding:9px 14px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--warm-gray);border-bottom:1px solid var(--border);background:var(--linen);white-space:nowrap;position:sticky;top:0;z-index:1;}
.dir-table td{padding:11px 14px;border-bottom:1px solid var(--border);vertical-align:middle;}
.dir-table tbody tr:hover td{background:#f5f3ee;}
.dir-table tbody tr.dir-row-selected td{background:var(--blue-mist);}
.dir-name-cell{display:flex;align-items:center;gap:10px;}
.dir-avatar{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0;}
.dir-avatar-org{border-radius:7px!important;background:var(--linen);}
.dir-avatar-0{background:#B5D4F4;color:#0C447C;}
.dir-avatar-1{background:#9FE1CB;color:#085041;}
.dir-avatar-2{background:#FAC775;color:#633806;}
.dir-avatar-3{background:#F5C4B3;color:#712B13;}
.dir-avatar-4{background:#D8B4FE;color:#5B21B6;}
.dir-name-link{color:var(--sky-steel);font-weight:500;}
.dir-badge{font-size:10px;padding:3px 8px;border-radius:99px;white-space:nowrap;display:inline-block;font-weight:500;}
.dir-badge-member{background:#D8F3DC;color:#1B4332;}
.dir-badge-associate{background:var(--pale-sage);color:#2D5016;}
.dir-badge-friend{background:var(--linen);color:var(--charcoal);}
.dir-badge-visitor{background:#DBEAFE;color:#1E40AF;}
.dir-badge-inactive{background:#FEF3C7;color:#92600A;}
.dir-badge-organization{background:var(--linen);color:var(--warm-gray);}
.dir-contact a{color:var(--sky-steel);font-size:12px;}
.dir-phone{font-size:12px;color:var(--warm-gray);}
.dir-hh-link{font-size:13px;color:var(--sky-steel);}
.dir-tags{display:flex;gap:4px;flex-wrap:wrap;align-items:center;}
.dir-tag{font-size:10px;padding:2px 7px;border-radius:99px;white-space:nowrap;border:1px solid transparent;}
.dir-tag-more{font-size:10px;color:var(--warm-gray);}
#p-grid{flex:1;min-height:0;overflow-y:auto;display:block;}
#p-pager{position:sticky;bottom:0;background:var(--white);border-top:1px solid var(--border);padding:9px 16px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
/* ── DASHBOARD ── */
.dash-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px;}
@media(max-width:900px){.dash-stats{grid-template-columns:repeat(2,1fr);}}
@media(max-width:480px){.dash-stats{grid-template-columns:1fr 1fr;}}
.dash-stat{background:var(--white);border:1px solid var(--border);border-radius:12px;padding:18px 20px;display:flex;flex-direction:column;gap:4px;}
.dash-stat-val{font-size:30px;font-weight:800;color:var(--charcoal);line-height:1;}
.dash-stat-lbl{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--warm-gray);}
.dash-stat-sub{font-size:11px;color:var(--teal);}
.dash-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:24px;}
@media(max-width:700px){.dash-row{grid-template-columns:1fr;}}
.dash-card{background:var(--white);border:1px solid var(--border);border-radius:12px;overflow:hidden;}
.dash-card-hdr{padding:14px 18px;border-bottom:1px solid var(--border);font-size:13px;font-weight:700;color:var(--charcoal);display:flex;align-items:center;gap:8px;}
.dash-card-body{padding:0;}
.dash-row-item{display:flex;align-items:center;gap:12px;padding:10px 18px;border-bottom:1px solid var(--linen);cursor:pointer;transition:background .1s;}
.dash-row-item:last-child{border-bottom:none;}
.dash-row-item:hover{background:var(--linen);}
.dash-avatar{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:white;flex-shrink:0;}
.dash-item-name{font-size:13px;font-weight:600;color:var(--charcoal);}
.dash-item-sub{font-size:11px;color:var(--warm-gray);}
.dash-type-bar{display:flex;flex-direction:column;gap:8px;padding:16px 18px;}
.dash-bar-row{display:flex;align-items:center;gap:10px;font-size:12px;}
.dash-bar-lbl{width:130px;flex-shrink:0;color:var(--charcoal);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dash-bar-track{flex:1;height:8px;background:var(--linen);border-radius:99px;overflow:hidden;}
.dash-bar-fill{height:100%;border-radius:99px;background:var(--teal);}
.dash-bar-n{width:32px;text-align:right;color:var(--warm-gray);flex-shrink:0;}
.dash-bday{display:flex;align-items:center;gap:10px;padding:8px 18px;border-bottom:1px solid var(--linen);}
.dash-bday:last-child{border-bottom:none;}
.dash-quick{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px;}
.dash-quick-btn{display:flex;align-items:center;gap:8px;padding:12px 18px;background:var(--white);border:1px solid var(--border);border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;color:var(--charcoal);transition:border-color .15s,box-shadow .15s;}
.dash-quick-btn:hover{border-color:var(--teal);box-shadow:0 0 0 3px rgba(76,154,143,.1);}
.dash-quick-btn svg{width:18px;height:18px;flex-shrink:0;stroke:var(--teal);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}
.dash-section-hdr{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:var(--charcoal);margin:24px 0 8px;}
.dash-fu-item{display:flex;align-items:flex-start;gap:10px;padding:10px 16px;border-bottom:1px solid var(--linen);transition:opacity .3s;}
.dash-fu-item:last-child{border-bottom:none;}
.dash-fu-check{width:26px;height:26px;border-radius:50%;border:2px solid var(--border);background:var(--white);cursor:pointer;font-size:14px;color:var(--teal);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .1s,border-color .1s;}
.dash-fu-check:hover{background:var(--teal);border-color:var(--teal);color:white;}
/* ── TIMELINE ── */
.tl-row{display:flex;gap:12px;margin-bottom:16px;}
.tl-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;margin-top:4px;}
.tl-dot-edit{background:var(--sky-steel);}
.tl-dot-fu{background:var(--teal);}
.tl-body{flex:1;}
.tl-meta{font-size:.82rem;margin-bottom:2px;}
.tl-action{font-weight:600;color:var(--charcoal);}
.tl-field{color:var(--sky-steel);}
.tl-change{font-size:.8rem;color:var(--warm-gray);margin-bottom:2px;}
.tl-ts{font-size:.72rem;color:var(--faint);}
/* ── PROFILE VIEW ── */
.content-area.pv-mode > .topbar{display:none;}
.content-area.pv-mode > .tab-panel{display:none!important;}
.content-area.pv-mode > #profile-view{display:flex;}
#profile-view{display:none;flex-direction:column;flex:1;overflow:hidden;}
.pv-body{flex:1;overflow-y:auto;display:flex;flex-direction:column;}
.pv-hdr{display:flex;align-items:flex-start;gap:18px;padding:20px 24px 16px;border-bottom:1px solid var(--border);flex-shrink:0;}
.pv-photo{width:88px;height:88px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:600;flex-shrink:0;box-shadow:0 1px 4px rgba(0,0,0,.12);}
.pv-hdr-info{flex:1;}
.pv-fullname{font-size:26px;font-weight:700;color:var(--charcoal);line-height:1.2;font-family:var(--font-head,inherit);}
.pv-meta{display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;}
.pv-hh-link{font-size:13px;color:var(--sky-steel);cursor:pointer;}
.pv-hh-link:hover{text-decoration:underline;}
.pv-role-txt{font-size:13px;color:var(--warm-gray);}
.pv-tabs{display:flex;border-bottom:1px solid var(--border);padding:0 24px;flex-shrink:0;background:var(--white);}
.pv-tab{font-size:13px;padding:11px 18px;color:var(--warm-gray);cursor:pointer;border-bottom:2.5px solid transparent;margin-bottom:-1px;transition:all .12s;}
.pv-tab:hover{color:var(--charcoal);}
.pv-tab.active{color:var(--charcoal);border-bottom-color:var(--amber);font-weight:600;}
.pv-layout{display:flex;flex:1;overflow:hidden;}
.pv-main{flex:1;padding:24px;overflow-y:auto;background:var(--bg);}
.ptab-panel{display:none;}
.ptab-panel.active{display:block;}
/* Two-column info layout */
.pv-info-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;}
@media(max-width:700px){.pv-info-cols{grid-template-columns:1fr;}}
.pv-section{background:var(--white);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-bottom:16px;}
.pv-section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--warm-gray);margin-bottom:12px;}
.pv-row{display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);}
.pv-row:last-child{border-bottom:none;}
.pv-row-key{width:110px;flex-shrink:0;font-size:11px;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.04em;padding-top:1px;}
.pv-row-val{flex:1;font-size:13px;color:var(--charcoal);}
.pv-row-val a{color:var(--sky-steel);text-decoration:none;}
.pv-row-val a:hover{text-decoration:underline;}
.pv-row-val.empty{color:var(--faint);font-style:italic;}
/* Demographics card grid (Church360-style) */
.pv-field-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:4px;}
@media(max-width:600px){.pv-field-grid{grid-template-columns:repeat(2,1fr);}}
.pv-field-card{border:1px solid var(--border);border-radius:7px;padding:8px 11px;background:var(--bg);}
.pv-field-card-lbl{font-size:10px;color:var(--warm-gray);text-transform:lowercase;letter-spacing:.02em;margin-bottom:3px;}
.pv-field-card-val{font-size:13px;color:var(--charcoal);font-weight:500;}
.pv-field-card-val.empty{color:var(--faint);font-style:italic;font-weight:400;}
.pv-family-member{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);}
.pv-family-member:last-child{border-bottom:none;}
.pv-family-avatar{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:white;flex-shrink:0;}
.pv-family-name{font-size:13px;font-weight:600;color:var(--charcoal);}
.pv-family-meta{font-size:11px;color:var(--warm-gray);}
/* aside */
.pv-aside{width:200px;border-left:1px solid var(--border);padding:20px 16px;flex-shrink:0;background:var(--white);overflow-y:auto;}
.pv-aside-block{margin-bottom:20px;}
.pv-aside-block+.pv-aside-block{padding-top:20px;border-top:1px solid var(--border);}
.pv-aside-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--warm-gray);margin-bottom:6px;}
.pv-aside-big{font-size:28px;font-weight:700;color:var(--steel-anchor);line-height:1;}
.pv-aside-sub{font-size:11px;color:var(--warm-gray);margin-top:3px;}
.pv-aside-link{font-size:12px;color:var(--sky-steel);cursor:pointer;display:block;padding:3px 0;}
.pv-aside-link:hover{text-decoration:underline;}
.topbar-back{font-size:13px;color:var(--sky-steel);cursor:pointer;white-space:nowrap;flex-shrink:0;}
.topbar-back:hover{text-decoration:underline;}
/* ── PRINT ── */
@media print{
  .sidebar,.topbar,.toolbar,.modal-overlay,#offline-banner{display:none!important;}
  .tab-panel{display:block!important;padding:0;}
  .tab-panel:not(#tab-reports){display:none!important;}
  body{background:white;}
  .report-output{border:none;padding:0;}
  .report-tiles{display:none;}
  button{display:none!important;}
}
</style>
</head>
<body>
<div id="offline-banner">You are offline — showing cached contacts</div>
<div id="error-boundary" role="alert" aria-live="assertive" style="display:none;position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9999;background:#c0392b;color:#fff;padding:11px 20px;border-radius:9px;font-size:.85rem;max-width:520px;width:90vw;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,.3);"></div>
<div class="app-shell">
<nav class="sidebar" id="sidebar">
  <div class="s-logo" onclick="showTab('home')" title="Home"><svg viewBox="0 0 20 20"><path d="M10 1L2 7v12h6v-5h4v5h6V7L10 1z"/></svg></div>
  <div class="s-item active" data-tab="home" onclick="showTab('home')"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg><span class="s-tip">Home</span></div>
  <div class="s-divider"></div>
  <div class="s-item" data-tab="people" onclick="showTab('people')"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg><span class="s-tip">People</span></div>
  <div class="s-item" data-tab="households" onclick="showTab('households')"><svg viewBox="0 0 24 24"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/></svg><span class="s-tip">Households</span></div>
  <div class="s-divider"></div>
  <div class="s-item require-finance" data-tab="giving" onclick="showTab('giving')"><svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8L2 7h20l-6-4z"/></svg><span class="s-tip">Giving</span></div>
  <div class="s-item require-staff" data-tab="attendance" onclick="showTab('attendance')"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4"/></svg><span class="s-tip">Attendance</span></div>
  <div class="s-item no-member" data-tab="reports" onclick="showTab('reports')"><svg viewBox="0 0 24 24"><path d="M18 20V10M12 20V4M6 20v-6"/></svg><span class="s-tip">Reports</span></div>
  <div class="s-item require-staff" data-tab="register" onclick="showTab('register')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/><line x1="9" y1="7" x2="17" y2="7"/><line x1="9" y1="11" x2="14" y2="11"/></svg><span class="s-tip">Register</span></div>
  <div class="s-divider"></div>
  <a href="/admin" class="s-item" title="Volunteers"><svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg><span class="s-tip">Volunteers</span></a>
  <a href="/scheduler" class="s-item" title="Scheduler"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><circle cx="12" cy="16" r="2"/></svg><span class="s-tip">Scheduler</span></a>
  <div class="s-bottom">
    <div class="s-item require-admin" data-tab="settings" onclick="showTab('settings')"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg><span class="s-tip">Settings</span></div>
  </div>
</nav>
<div class="content-area">
<div class="topbar">
  <button class="hamburger" onclick="openSidebar()" aria-label="Menu"><svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
  <span class="topbar-title" id="topbar-title">People</span>
  <div style="display:flex;gap:8px;align-items:center;">
    <span style="font-size:.7rem;color:var(--warm-gray);" id="deploy-ver"></span>
    <span id="topbar-role" style="display:none;font-size:.72rem;padding:2px 8px;border-radius:99px;background:rgba(30,45,74,.12);color:var(--charcoal);font-weight:600;"></span>
    <a href="/admin" class="btn-sm require-admin">&#8592; Volunteers</a>
    <a href="/admin/logout" class="btn-sm">Sign Out</a>
  </div>
</div>

<!-- ═══ HOME / DASHBOARD TAB ═══ -->
<div id="tab-home" class="tab-panel active">
  <div id="dash-body" style="padding:24px;max-width:1100px;"></div>
</div>

<!-- ═══ PEOPLE TAB ═══ -->
<div id="tab-people" class="tab-panel">
  <div class="toolbar">
    <div class="search-wrap"><input type="search" id="p-search" placeholder="Search name, email, phone…" oninput="debouncePeople()"></div>
    <button class="btn-secondary" id="p-filter-btn" onclick="toggleFilterDrawer()" style="display:flex;align-items:center;gap:6px;white-space:nowrap;">
      <svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;flex-shrink:0;"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
      Filters
      <span id="p-filter-count" style="display:none;background:var(--teal);color:#fff;border-radius:99px;padding:1px 7px;font-size:.72rem;font-weight:700;"></span>
    </button>
    <button class="btn-secondary" id="p-select-btn" onclick="toggleSelectMode()" style="margin-left:auto;">&#9745; Select</button>
    <button class="btn-secondary" onclick="printDirectory()" title="Print directory">&#128438; Directory</button>
    <button class="btn-primary require-edit" onclick="openPersonEdit(null)">+ Add Person</button>
  </div>
  <!-- Active filter chips -->
  <div id="p-active-filters" style="display:none;padding:0 16px 10px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;"></div>
  <!-- Bulk action bar (visible when Select mode is active) -->
  <div id="p-bulk-bar" style="display:none;position:sticky;bottom:0;z-index:500;background:var(--steel-anchor);color:#fff;padding:10px 16px;display:none;align-items:center;gap:10px;flex-wrap:wrap;">
    <span id="p-bulk-count" style="font-size:.9rem;font-weight:700;">0 selected</span>
    <div style="flex:1;"></div>
    <select id="p-bulk-mt" style="padding:5px 8px;border-radius:6px;border:none;font-size:.85rem;background:#fff;color:var(--charcoal);">
      <option value="">Change Member Type…</option>
    </select>
    <button class="btn-sm" onclick="applyBulkMemberType()" style="background:#fff;color:var(--steel-anchor);">Apply</button>
    <button class="btn-sm" onclick="openBulkTagsPanel()" style="background:#fff;color:var(--steel-anchor);">&#9881; Tags</button>
    <button class="btn-sm" onclick="clearSelection()" style="background:rgba(255,255,255,.2);color:#fff;">Cancel</button>
  </div>
  <!-- Bulk tags mini-panel -->
  <div id="p-bulk-tags-panel" style="display:none;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin:4px 0 8px;">
    <div style="font-size:.78rem;font-weight:700;color:var(--warm-gray);text-transform:uppercase;margin-bottom:8px;">Bulk Tag Management</div>
    <div id="p-bulk-tags-list" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;"></div>
    <div style="font-size:.75rem;color:var(--warm-gray);margin-bottom:6px;">&#9679; = add to all &nbsp; &#9675; = remove from all &nbsp; (empty = no change)</div>
    <div style="display:flex;gap:8px;">
      <button class="btn-primary" style="font-size:.82rem;padding:5px 12px;" onclick="applyBulkTags()">Apply Tags</button>
      <button class="btn-secondary" style="font-size:.82rem;padding:5px 12px;" onclick="document.getElementById(&#39;p-bulk-tags-panel&#39;).style.display=&#39;none&#39;">Cancel</button>
    </div>
  </div>
  <div id="p-status" class="status-msg"></div>
  <!-- Desktop grid -->
  <div id="p-grid"></div>
  <!-- Mobile contact list -->
  <div class="contact-list" id="p-contact-list"></div>
  <!-- Pagination -->
  <div id="p-pager" style="display:flex;align-items:center;justify-content:center;padding:16px 0;gap:8px;"></div>
</div>

<!-- ═══ HOUSEHOLDS TAB ═══ -->
<div id="tab-households" class="tab-panel">
  <div class="toolbar">
    <div class="search-wrap"><input type="search" id="h-search" placeholder="Search households…" oninput="debounceHouseholds()"></div>
    <select id="h-sort" onchange="loadHouseholds(true)" style="padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:.88rem;background:var(--white);">
      <option value="name">Sort: A–Z</option>
      <option value="members_desc">Sort: Most Members</option>
      <option value="members_asc">Sort: Fewest Members</option>
    </select>
    <button class="btn-primary require-edit" onclick="openHouseholdEdit(null)" style="margin-left:auto;">+ New Household</button>
  </div>
  <div id="h-status" class="status-msg"></div>
  <div class="card-grid" id="h-grid"></div>
  <div id="h-pager" style="display:flex;align-items:center;justify-content:center;padding:16px 0;gap:8px;"></div>
</div>

<!-- ═══ GIVING TAB ═══ -->
<div id="tab-giving" class="tab-panel">
  <div class="giving-layout">
    <!-- Batch list -->
    <div class="batch-list-panel">
      <div class="batch-list-hdr">
        <h3>Batches</h3>
        <button class="btn-primary" style="padding:5px 12px;font-size:.8rem;" onclick="openNewBatch()">+ New</button>
      </div>
      <div class="batch-search-wrap">
        <input type="search" id="batch-search-input" placeholder="Search batches&#8230;" oninput="filterBatchSearch(this.value)">
      </div>
      <div class="batch-filter-pills">
        <button class="pill active" data-bs="all" onclick="setBatchFilter(this,'all')">All</button>
        <button class="pill" data-bs="open" onclick="setBatchFilter(this,'open')">Open</button>
        <button class="pill" data-bs="closed" onclick="setBatchFilter(this,'closed')">Closed</button>
      </div>
      <div id="batch-list"></div>
    </div>
    <!-- Batch detail -->
    <div class="batch-detail-panel" id="batch-detail">
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--warm-gray);gap:10px;padding:40px;">
        <svg viewBox="0 0 24 24" style="width:38px;height:38px;fill:none;stroke:currentColor;stroke-width:1.5;opacity:.35;"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8L2 7h20l-6-4z"/></svg>
        <div style="font-size:.9rem;">Select a batch to view entries</div>
      </div>
    </div>
  </div>
</div>

<!-- ═══ REPORTS TAB ═══ -->
<div id="tab-reports" class="tab-panel">
  <div class="report-tiles">
    <div class="report-tile" onclick="runMembership()">
      <div class="tile-icon">&#128100;</div>
      <div class="tile-title">Membership Summary</div>
      <div class="tile-desc">Counts by member type</div>
    </div>
    <div class="report-tile require-finance">
      <div class="tile-icon">&#128200;</div>
      <div class="tile-title">Giving by Fund</div>
      <div class="tile-desc">
        <div class="field" style="margin:8px 0 4px;"><label>From</label><input type="date" id="rpt-from" style="font-size:.82rem;padding:4px 8px;"></div>
        <div class="field" style="margin:4px 0;"><label>To</label><input type="date" id="rpt-to" style="font-size:.82rem;padding:4px 8px;"></div>
        <button class="btn-primary" style="margin-top:8px;font-size:.8rem;padding:5px 12px;" onclick="runGivingSummary()">Run Report</button>
      </div>
    </div>
    <div class="report-tile require-finance">
      <div class="tile-icon">&#128179;</div>
      <div class="tile-title">Giving by Method</div>
      <div class="tile-desc">
        <div class="field" style="margin:8px 0 4px;"><label>From</label><input type="date" id="rpt-method-from" style="font-size:.82rem;padding:4px 8px;"></div>
        <div class="field" style="margin:4px 0;"><label>To</label><input type="date" id="rpt-method-to" style="font-size:.82rem;padding:4px 8px;"></div>
        <button class="btn-primary" style="margin-top:8px;font-size:.8rem;padding:5px 12px;" onclick="runGivingByMethod()">Run Report</button>
      </div>
    </div>
    <div class="report-tile require-finance">
      <div class="tile-icon">&#128196;</div>
      <div class="tile-title">Giving Statement</div>
      <div class="tile-desc">
        <div style="display:flex;gap:6px;margin-bottom:6px;">
          <label style="display:flex;align-items:center;gap:4px;font-size:.82rem;cursor:pointer;"><input type="radio" name="rpt-stmt-mode" value="person" checked onchange="toggleStmtMode()"> Person</label>
          <label style="display:flex;align-items:center;gap:4px;font-size:.82rem;cursor:pointer;"><input type="radio" name="rpt-stmt-mode" value="household" onchange="toggleStmtMode()"> Household</label>
        </div>
        <div id="rpt-stmt-person-row" class="field" style="margin:4px 0;">
          <div class="ac-wrap"><input type="text" id="rpt-person-search" placeholder="Search person…" style="font-size:.82rem;padding:4px 8px;" oninput="acSearch(this,&#39;rpt-person-ac&#39;,&#39;rpt-person-id&#39;)"><div class="ac-dropdown" id="rpt-person-ac"></div></div>
          <input type="hidden" id="rpt-person-id">
        </div>
        <div id="rpt-stmt-hh-row" class="field" style="margin:4px 0;display:none;">
          <div class="ac-wrap"><input type="text" id="rpt-hh-search" placeholder="Search household…" style="font-size:.82rem;padding:4px 8px;" oninput="acSearchHH(this)"><div class="ac-dropdown" id="rpt-hh-ac"></div></div>
          <input type="hidden" id="rpt-hh-id">
        </div>
        <div class="field" style="margin:4px 0;"><label>Year</label><input type="number" id="rpt-year" value="" style="font-size:.82rem;padding:4px 8px;width:90px;"></div>
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
          <button class="btn-primary" style="font-size:.8rem;padding:5px 12px;" onclick="runGivingStatement()">View Statement</button>
          <button class="btn-secondary" style="font-size:.8rem;padding:5px 12px;" onclick="runGivingStatementLetter()">View Letter</button>
          <button class="btn-secondary" style="font-size:.8rem;padding:5px 12px;" onclick="downloadStatement()">CSV</button>
        </div>
      </div>
    </div>
  </div>
  <div class="report-tiles" style="margin-top:0;padding-top:0;">
    <div class="report-tile">
      <div class="tile-icon">&#128140;</div>
      <div class="tile-title">Batch Send Statements</div>
      <div class="tile-desc">
        <div style="font-size:.82rem;color:var(--warm-gray);margin-bottom:8px;">Send year-end giving letters via email to all givers for a year.</div>
        <div class="field" style="margin:4px 0;"><label>Year</label><input type="number" id="batch-stmt-year" value="" style="font-size:.82rem;padding:4px 8px;width:90px;"></div>
        <button class="btn-primary" style="font-size:.8rem;padding:5px 12px;margin-top:6px;" onclick="loadBatchStatementGivers()">Load Givers</button>
        <div id="batch-stmt-status" class="import-status" style="margin-top:6px;"></div>
        <div id="batch-stmt-list" style="margin-top:8px;max-height:200px;overflow-y:auto;"></div>
      </div>
    </div>
  </div>
  <div class="report-output" id="rpt-output"></div>
</div>

<!-- ═══ ATTENDANCE TAB ═══ -->
<div id="tab-attendance" class="tab-panel">
  <div style="padding:16px 20px 20px;">
    <!-- Chart card -->
    <div class="att-chart-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">
        <div class="att-stats-row" id="att-stats" style="flex:1;flex-wrap:wrap;"></div>
        <div style="display:flex;gap:4px;flex-shrink:0;padding-left:8px;">
          <button class="btn-sm" id="att-mode-line" onclick="setAttChartMode(&#39;line&#39;)" style="padding:3px 8px;font-size:.75rem;" title="Weekly timeline">Line</button>
          <button class="btn-sm" id="att-mode-yoy" onclick="setAttChartMode(&#39;yoy&#39;)" style="padding:3px 8px;font-size:.75rem;opacity:.55;" title="Year-over-year comparison">YoY</button>
          <button class="btn-sm" id="att-mode-bars" onclick="setAttChartMode(&#39;bars&#39;)" style="padding:3px 8px;font-size:.75rem;opacity:.55;" title="Monthly bars">Bars</button>
        </div>
      </div>
      <div id="att-chart-wrap" style="overflow-x:auto;overflow-y:hidden;"></div>
    </div>
    <!-- Controls row -->
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
      <button class="btn-primary" style="font-size:.85rem;" onclick="openNewSundayEntry()">+ Add Sunday</button>
      <button class="btn-secondary" style="font-size:.8rem;" onclick="seedYearSundays()">&#128197; Pre-fill Year Sundays</button>
      <div style="flex:1;"></div>
      <input type="date" id="att-from" style="font-size:.78rem;padding:3px 6px;border:1px solid var(--border);border-radius:6px;">
      <span style="font-size:.8rem;color:var(--warm-gray);">to</span>
      <input type="date" id="att-to" style="font-size:.78rem;padding:3px 6px;border:1px solid var(--border);border-radius:6px;">
      <button class="btn-sm" onclick="loadAttendance()" style="padding:4px 8px;font-size:.75rem;">Filter</button>
      <button class="btn-sm" id="att-order-btn" onclick="toggleAttOrder()" style="padding:4px 8px;font-size:.75rem;min-width:56px;" title="Toggle sort order">&#8595; Desc</button>
      <select id="att-group-by" onchange="renderAttendanceListFromLoaded()" style="font-size:.78rem;padding:3px 6px;border:1px solid var(--border);border-radius:6px;">
        <option value="none">No grouping</option>
        <option value="month">By Month</option>
      </select>
    </div>
    <!-- "Add Sunday" inline form slot -->
    <div id="att-add-form" style="display:none;background:var(--white);border:1px solid var(--border);border-radius:12px;padding:18px;margin-bottom:12px;"></div>
    <!-- Service list -->
    <div id="att-list"></div>
    <!-- ── Inline Attendance Reports ── -->
    <div style="margin-top:28px;border-top:2px solid var(--border);padding-top:20px;">
      <div style="font-family:var(--font-head);font-size:1.05rem;font-weight:700;color:var(--steel-anchor);margin-bottom:16px;">Attendance Reports</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;margin-bottom:16px;">
        <div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px;flex:1;min-width:220px;">
          <div style="font-weight:700;font-size:.88rem;color:var(--steel-anchor);margin-bottom:6px;">&#128101; Year-over-Year</div>
          <div style="font-size:.8rem;color:var(--warm-gray);margin-bottom:8px;">Select years to compare:</div>
          <div id="rpt-att-years" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;"></div>
          <button class="btn-primary" style="font-size:.8rem;padding:5px 12px;" onclick="runAttendanceSummary()">Run Report</button>
        </div>
        <div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px;flex:1;min-width:220px;">
          <div style="font-weight:700;font-size:.88rem;color:var(--steel-anchor);margin-bottom:6px;">&#128337; Attendance by Service</div>
          <div class="field" style="margin:6px 0 4px;"><label>From</label><input type="date" id="rpt-att-from" style="font-size:.82rem;padding:4px 8px;"></div>
          <div class="field" style="margin:4px 0;"><label>To</label><input type="date" id="rpt-att-to" style="font-size:.82rem;padding:4px 8px;"></div>
          <button class="btn-primary" style="margin-top:8px;font-size:.8rem;padding:5px 12px;" onclick="runAttendanceByTime()">Run Report</button>
        </div>
      </div>
      <div id="att-rpt-output" style="display:none;"></div>
    </div>
  </div>
</div>

<!-- (import content moved into Settings tab) -->
<div id="tab-import" style="display:none!important;">

<!-- ═══ SETTINGS TAB ═══ -->
<div id="tab-settings" class="tab-panel">
  <div style="padding:16px 20px 24px;max-width:900px;">
    <div id="st-status" class="status-msg" style="margin-bottom:8px;"></div>
    <!-- Church Info Card -->
    <div class="import-card" style="margin-bottom:14px;">
      <h3>&#9962; Church Information</h3>
      <p>Used in giving letters, email headers, and reports.</p>
      <div class="modal-2col" style="margin-bottom:10px;">
        <div class="field"><label>Church Name</label><input type="text" id="st-church-name" placeholder="Timothy Lutheran Church" style="width:100%;"></div>
        <div class="field"><label>EIN (Tax ID)</label><input type="text" id="st-ein" placeholder="XX-XXXXXXX" style="width:100%;"></div>
      </div>
      <div class="modal-2col" style="margin-bottom:12px;">
        <div class="field"><label>From Name (for emails)</label><input type="text" id="st-from-name" placeholder="Timothy Lutheran Church" style="width:100%;"></div>
        <div class="field"><label>From Email</label><input type="email" id="st-from-email" placeholder="giving@yourdomain.org" style="width:100%;"></div>
      </div>
      <button class="btn-primary" onclick="saveSettings()">Save Church Info</button>
    </div>
    <!-- Letter Template Card -->
    <div class="import-card" style="margin-bottom:14px;">
      <h3>&#128140; Year-End Giving Letter Template</h3>
      <p>Used when generating giving letters. Available placeholders: <code>{{name}}</code>, <code>{{year}}</code>, <code>{{total}}</code>, <code>{{ein}}</code>, <code>{{date}}</code>, <code>{{gift_table}}</code></p>
      <textarea id="st-letter-tpl" rows="10" style="width:100%;font-family:monospace;font-size:.82rem;padding:10px;border:1px solid var(--border);border-radius:8px;resize:vertical;"></textarea>
      <div style="margin-top:8px;">
        <button class="btn-primary" onclick="saveSettings()">Save Template</button>
        <button class="btn-secondary" onclick="resetLetterTemplate()" style="margin-left:8px;">Reset to Default</button>
      </div>
    </div>
    <!-- Tags Card -->
    <div class="import-card" style="margin-bottom:14px;">
      <h3>&#9881; Tags</h3>
      <p>Tags are used to categorize people. You can filter by tag in the People tab.</p>
      <div id="settings-tags-list" style="margin-bottom:10px;"></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input type="text" id="st-new-tag-name" placeholder="New tag name" style="padding:6px 10px;border:1px solid var(--border);border-radius:8px;font-size:.88rem;width:160px;">
        <input type="color" id="st-new-tag-color" value="#2E7EA6" style="width:40px;height:32px;border:1px solid var(--border);border-radius:6px;padding:2px;cursor:pointer;">
        <button class="btn-primary" style="font-size:.85rem;padding:6px 14px;" onclick="createTagSettings()">Add Tag</button>
      </div>
    </div>
    <!-- Member Types Card -->
    <div class="import-card" style="margin-bottom:14px;">
      <h3>&#9965; Member Types</h3>
      <p>Define the member types available for people records.</p>
      <div id="settings-member-types-list" style="margin-bottom:10px;"></div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="text" id="st-new-type-name" placeholder="New type name" style="padding:6px 10px;border:1px solid var(--border);border-radius:8px;font-size:.88rem;width:180px;">
        <button class="btn-primary" style="font-size:.85rem;padding:6px 14px;" onclick="addMemberTypeSettings()">Add Type</button>
      </div>
    </div>
    <!-- Breeze Status Mapping Card -->
    <div class="import-card">
      <h3>&#128279; Breeze Status &rarr; Member Type Mapping</h3>
      <p>After a Breeze import, each status name that came in from Breeze appears here. Map it to your local member type so future imports assign the right type automatically.</p>
      <div id="settings-mt-map-list" style="margin-bottom:10px;"></div>
      <div id="settings-mt-map-hint" style="font-size:.8rem;color:var(--warm-gray);"></div>
      <button class="btn-secondary" style="margin-top:10px;font-size:.82rem;" onclick="loadMemberTypeMap()">&#8635; Refresh</button>
    </div>
    <!-- ── DATA IMPORT ── -->
    <div style="border-top:2px solid var(--border);margin-top:20px;padding-top:20px;">
      <h2 style="font-size:1rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--navy);margin-bottom:14px;">Data Import</h2>
      <div class="import-card">
        <h3>&#9729; Sync from Breeze</h3>
        <p>Pull people records directly from the Breeze API. Existing records (matched by Breeze ID) are updated; new people are added.</p>
        <button class="btn-primary" onclick="runBreezeImport()">Sync People from Breeze</button>
        <div class="progress-bar" id="breeze-bar"><div class="progress-fill" id="breeze-fill" style="width:0%"></div></div>
        <div class="import-status" id="breeze-status"></div>
      </div>
      <div class="import-card">
        <h3>&#128181; Sync Giving from Breeze</h3>
        <p>Pull contribution records from the Breeze account log. Already-imported contributions are skipped (safe to re-sync). Groups by Breeze batch number. Fund names can be renamed in Giving &#8594; Funds after import.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;align-items:center;">
          <div class="field" style="margin:0;"><label>From</label><input type="date" id="giving-sync-from" style="font-size:.85rem;padding:4px 8px;"></div>
          <div class="field" style="margin:0;"><label>To</label><input type="date" id="giving-sync-to" style="font-size:.85rem;padding:4px 8px;"></div>
        </div>
        <button class="btn-primary" onclick="runBreezeGivingSync()">Sync Date Range</button>
        <div class="import-status" id="giving-sync-status"></div>
        <hr style="margin:14px 0;border:none;border-top:1px solid var(--warm-gray-light,#e0d9d0);">
        <p style="margin:0 0 8px;"><strong>Sync All History</strong> — loops through every year from start year to today, one year at a time.</p>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;">
          <div class="field" style="margin:0;"><label>Start Year</label><input type="number" id="giving-sync-start-year" value="2020" min="2000" max="2099" style="width:90px;font-size:.85rem;padding:4px 8px;"></div>
        </div>
        <button class="btn-primary" id="giving-all-btn" onclick="runBreezeGivingAll()">Sync All History</button>
        <div class="import-status" id="giving-all-status"></div>
      </div>
      <div class="import-card">
        <h3>&#128181; Import Giving from Breeze CSV Export</h3>
        <p>Export from Breeze: Contributions &rarr; Export to CSV. Drag &amp; drop the file below or click to browse. Already-imported contributions are skipped (safe to re-run).</p>
        <div id="giving-csv-drop"
          style="border:2px dashed var(--border);border-radius:8px;padding:28px 16px;text-align:center;cursor:pointer;margin-bottom:8px;transition:background .15s;"
          onclick="document.getElementById(&#39;giving-csv-file&#39;).click()"
          ondragover="event.preventDefault();this.style.background=&#39;#f0f4f8&#39;;"
          ondragleave="this.style.background=&#39;&#39;;"
          ondrop="event.preventDefault();this.style.background=&#39;&#39;;importGivingCSV(event.dataTransfer.files[0]);">
          <div style="font-size:2rem;margin-bottom:6px;">&#128228;</div>
          <div id="giving-csv-name" style="font-size:.88rem;color:var(--warm-gray);">Drop CSV here or click to browse</div>
        </div>
        <input type="file" id="giving-csv-file" accept=".csv,.txt" style="display:none;" onchange="importGivingCSV(this.files[0]);">
        <div class="import-status" id="giving-csv-status"></div>
      </div>
      <div class="import-card">
        <h3>&#128260; Map Breeze Funds to Real Fund Names</h3>
        <p>After the giving sync, imported funds show as "Breeze Fund XXXXXXX". Use this tool to reassign all their contributions to your real fund names, then remove the placeholders.</p>
        <button class="btn-secondary" onclick="loadFundMapping()" style="margin-bottom:10px;">Load Fund Mapping</button>
        <div id="fund-map-area" style="display:none;">
          <table style="width:100%;border-collapse:collapse;font-size:.85rem;margin-bottom:10px;" id="fund-map-table">
            <thead><tr style="text-align:left;border-bottom:1px solid #ccc;"><th style="padding:4px 8px;">Breeze Fund</th><th style="padding:4px 8px;">Gifts</th><th style="padding:4px 8px;">Total</th><th style="padding:4px 8px;">Map to &rarr;</th></tr></thead>
            <tbody id="fund-map-rows"></tbody>
          </table>
          <button class="btn-primary" onclick="applyFundMapping()">Apply Mapping</button>
        </div>
        <div class="import-status" id="fund-map-status"></div>
      </div>
      <div class="import-card">
        <h3>&#128197; Import Attendance (Simple CSV)</h3>
        <p>Paste or upload a 3-column file: <code>date, service_name, attendance</code>. Date must be YYYY-MM-DD. One row per service. Header row optional. Existing records for the same date+time are updated; new ones are inserted.</p>
        <textarea id="att-simple-text" rows="6" style="width:100%;font-family:monospace;font-size:.8rem;padding:6px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;" placeholder="2024-03-10&#9;Sunday 8am&#9;112&#10;2024-03-10&#9;Sunday 10:45am&#9;187"></textarea>
        <button class="btn-primary" onclick="importAttendanceSimple()">Import</button>
        <div class="import-status" id="att-simple-status"></div>
      </div>
      <div class="import-card">
        <h3>&#128465; Prune Empty Batches</h3>
        <p>Remove any giving batches that have no entries (can be left behind by failed or partial imports). Safe to run at any time.</p>
        <button class="btn-secondary" onclick="pruneEmptyBatches()">Delete Empty Batches</button>
        <div class="import-status" id="prune-batches-status"></div>
      </div>
      <div class="import-card">
        <h3>&#9997; Generate Register from People Records</h3>
        <p>Create church register entries from baptism and confirmation dates already stored on people records. People who already have a matching register entry are skipped (safe to re-run).</p>
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
          <div class="field" style="margin:0;"><label>Earliest date to include</label><input type="date" id="reg-gen-cutoff" value="1900-01-01" style="font-size:.85rem;padding:4px 8px;"></div>
          <label style="display:flex;align-items:center;gap:6px;font-size:.88rem;cursor:pointer;"><input type="checkbox" id="reg-gen-baptism" checked> Baptisms</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:.88rem;cursor:pointer;"><input type="checkbox" id="reg-gen-confirm" checked> Confirmations</label>
        </div>
        <button class="btn-primary" onclick="generateRegisterFromPeople()">Generate Register Entries</button>
        <div class="import-status" id="reg-gen-status"></div>
      </div>
      <div class="import-card" style="border-color:#e74c3c;">
        <h3 style="color:#e74c3c;">&#9888; Clear All Giving Data</h3>
        <p>Permanently deletes all giving entries and batches from the database. Use this to start fresh before re-importing correct data. <strong>This cannot be undone.</strong></p>
        <button style="background:#e74c3c;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-size:.88rem;font-weight:700;cursor:pointer;" onclick="clearAllGiving()">&#9888; Clear All Giving Data</button>
        <div class="import-status" id="clear-giving-status"></div>
      </div>
    </div>
  </div>
</div>
<!-- ═══ REGISTER TAB ═══ -->
<div id="tab-register" class="tab-panel">
  <div class="reg-shell">
    <!-- Sub-tab bar -->
    <div style="display:flex;align-items:center;border-bottom:1px solid var(--border);padding:0 20px;flex-shrink:0;background:var(--white);">
      <button class="pv-tab active" data-rtab="baptism" onclick="showRegisterTab('baptism')" style="font-size:13px;padding:12px 18px;">Baptisms</button>
      <button class="pv-tab" data-rtab="confirmation" onclick="showRegisterTab('confirmation')" style="font-size:13px;padding:12px 18px;">Confirmations</button>
      <div style="margin-left:auto;display:flex;gap:8px;align-items:center;">
        <button class="btn-secondary" style="display:none;font-size:.8rem;" id="reg-add-toggle" onclick="toggleRegForm()">+ Add</button>
        <button class="btn-secondary" style="font-size:.8rem;" onclick="openRegFromPeoplePrompt()" title="Generate register entries from people records">&#128100; From People</button>
        <button class="btn-secondary" style="font-size:.8rem;" onclick="openRegImport()">&#8679; Import File</button>
        <button class="btn-secondary" style="font-size:.8rem;" onclick="printRegister()">Print</button>
      </div>
    </div>
    <!-- Filter toolbar -->
    <div class="reg-toolbar">
      <input class="reg-search" type="search" id="reg-search" placeholder="Search by name&#8230;" oninput="filterRegister()">
      <select class="reg-year-select" id="reg-year-filter" onchange="filterRegister()">
        <option value="">All Years</option>
      </select>
      <span class="reg-stat-txt" id="reg-stat-txt"></span>
    </div>
    <!-- Body: form left + list right -->
    <div class="reg-body">
      <!-- Add / Edit form -->
      <div class="reg-form-panel" id="reg-form-panel">
        <div class="reg-form-title" id="reg-form-title">Add Baptism</div>
        <div class="field"><label>Date</label><input type="date" id="reg-date"></div>
        <div class="field"><label id="reg-name-lbl">Name Baptized</label><input type="text" id="reg-name" placeholder="Full name"></div>
        <div class="field"><label id="reg-name2-lbl">Parent / Sponsor</label><input type="text" id="reg-name2" placeholder="Optional"></div>
        <div class="field"><label>Officiant</label><input type="text" id="reg-officiant" placeholder="Pastor name"></div>
        <div class="field"><label>Notes</label><textarea id="reg-notes" placeholder="Optional notes" style="width:100%;height:64px;resize:vertical;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:inherit;"></textarea></div>
        <div style="display:flex;gap:8px;margin-top:4px;">
          <button class="btn-primary" style="font-size:.85rem;" id="reg-save-btn" onclick="saveRegisterEntry()">Add Entry</button>
          <button class="btn-secondary" style="font-size:.85rem;display:none;" id="reg-cancel-btn" onclick="cancelRegisterEdit()">Cancel</button>
        </div>
      </div>
      <!-- List -->
      <div class="reg-list-panel">
        <div id="reg-list"></div>
      </div>
    </div>
  </div>
</div>

<!-- ═══ PROFILE VIEW ═══ -->
<div id="profile-view">
  <div class="topbar">
    <button class="hamburger" onclick="openSidebar()" aria-label="Menu"><svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
    <span class="topbar-back" onclick="closeProfile()">&#8592; People</span>
    <span id="pv-topbar-name" style="font-size:15px;font-weight:500;color:var(--charcoal);margin-left:8px;"></span>
    <div style="display:flex;gap:8px;margin-left:auto;">
      <button class="btn-secondary" onclick="window.print()">Print</button>
      <button class="btn-secondary require-edit" onclick="openPersonEdit(_currentPvPerson)">Edit</button>
    </div>
  </div>
  <div class="pv-body">
    <div class="pv-hdr">
      <div class="pv-photo" id="pv-photo"></div>
      <div class="pv-hdr-info">
        <div class="pv-fullname" id="pv-fullname"></div>
        <div class="pv-meta">
          <span id="pv-badge"></span>
          <span id="pv-hh" class="pv-hh-link"></span>
          <span id="pv-role" class="pv-role-txt"></span>
        </div>
      </div>
    </div>
    <div class="pv-tabs">
      <div class="pv-tab active" data-ptab="info" onclick="showPvTab('info')">Information</div>
      <div class="pv-tab require-finance" data-ptab="giving" onclick="showPvTab('giving')">Giving</div>
      <div class="pv-tab" data-ptab="attendance" onclick="showPvTab('attendance')">Attendance</div>
      <div class="pv-tab" data-ptab="timeline" onclick="showPvTab('timeline')">Timeline</div>
    </div>
    <div class="pv-layout">
      <div class="pv-main">
        <div id="ptab-info" class="ptab-panel active"></div>
        <div id="ptab-giving" class="ptab-panel">
          <div style="padding:16px 0 0;" class="require-finance">
            <button class="btn-primary" onclick="togglePvQuickGift()" id="pv-gift-btn">+ Add Gift</button>
            <div id="pv-quick-gift" style="display:none;margin-top:12px;background:var(--linen);border-radius:10px;padding:16px;">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
                <div class="field"><label>Date</label><input type="date" id="pv-gift-date" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:.88rem;"></div>
                <div class="field"><label>Amount ($)</label><input type="number" id="pv-gift-amount" min="0.01" step="0.01" placeholder="0.00" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:.88rem;"></div>
                <div class="field"><label>Fund</label><select id="pv-gift-fund" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:.88rem;"></select></div>
                <div class="field"><label>Method</label><select id="pv-gift-method" onchange="togglePvCheckNum()" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:.88rem;">
                  <option value="cash">Cash</option><option value="check">Check</option><option value="online">Online</option><option value="stock">Stock</option><option value="other">Other</option>
                </select></div>
                <div class="field" id="pv-gift-check-row" style="display:none;"><label>Check #</label><input type="text" id="pv-gift-check" placeholder="e.g. 1042" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:.88rem;"></div>
                <div class="field" style="grid-column:1/-1;"><label>Notes</label><input type="text" id="pv-gift-notes" placeholder="Optional note…" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:.88rem;"></div>
              </div>
              <div style="display:flex;gap:8px;">
                <button class="btn-primary" onclick="submitPvQuickGift()">Save Gift</button>
                <button class="btn-secondary" onclick="togglePvQuickGift()">Cancel</button>
              </div>
              <div id="pv-gift-err" style="color:var(--danger);font-size:.82rem;margin-top:6px;display:none;"></div>
            </div>
          </div>
          <div id="pv-giving-content" style="color:var(--warm-gray);font-size:13px;padding:20px 0;">Loading giving history…</div>
        </div>
        <div id="ptab-attendance" class="ptab-panel">
          <div style="color:var(--warm-gray);font-size:13px;padding:20px 0;">Attendance records for this person will appear here.</div>
        </div>
        <div id="ptab-timeline" class="ptab-panel">
          <div style="color:var(--warm-gray);font-size:13px;padding:20px 0;font-style:italic;">Timeline coming soon — pastoral notes and visit log.</div>
        </div>
      </div>
      <div class="pv-aside" id="pv-aside"></div>
    </div>
  </div>
</div>
</div><!-- /content-area -->

<!-- ═══ PEOPLE FILTER DRAWER ═══ -->
<div id="people-filter-overlay" onclick="closeFilterDrawer()" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.25);z-index:1100;"></div>
<div id="people-filter-drawer" style="display:none;position:fixed;right:0;top:0;bottom:0;width:300px;max-width:90vw;background:var(--white);box-shadow:-4px 0 24px rgba(0,0,0,.18);z-index:1101;flex-direction:column;overflow:hidden;">
  <div style="display:flex;align-items:center;padding:16px 18px;border-bottom:1px solid var(--border);flex-shrink:0;">
    <span style="font-size:16px;font-weight:700;flex:1;">Filters</span>
    <button onclick="clearAllFilters()" style="font-size:.78rem;color:var(--teal);background:none;border:none;cursor:pointer;font-weight:600;padding:4px 8px;">Clear All</button>
    <button onclick="closeFilterDrawer()" style="background:none;border:none;cursor:pointer;font-size:22px;color:var(--warm-gray);line-height:1;margin-left:4px;">&#215;</button>
  </div>
  <div style="flex:1;overflow-y:auto;padding:16px 18px;">
    <div style="margin-bottom:20px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--warm-gray);margin-bottom:10px;">Member Type</div>
      <div id="fd-member-types"></div>
    </div>
    <div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--warm-gray);margin-bottom:10px;">Tags</div>
      <div id="fd-tags"></div>
    </div>
  </div>
  <div style="padding:14px 18px;border-top:1px solid var(--border);flex-shrink:0;">
    <div id="fd-result-count" style="font-size:.78rem;color:var(--warm-gray);margin-bottom:10px;text-align:center;"></div>
    <button class="btn-primary" style="width:100%;padding:10px;" onclick="closeFilterDrawer()">Done</button>
  </div>
</div>

</div><!-- /app-shell -->
<div class="sidebar-overlay" id="sidebar-overlay" onclick="closeSidebar()"></div>

<!-- ═══ MODALS ═══ -->
<!-- Register import modal -->
<div class="modal-overlay" id="reg-import-modal" style="display:none;" onclick="if(event.target===this)closeRegImport()">
  <div class="modal" style="max-width:820px;width:95vw;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
      <h2 style="margin:0;flex:1;">Import Register Records</h2>
      <button class="btn-secondary" style="font-size:.8rem;" onclick="closeRegImport()">&#215; Close</button>
    </div>
    <!-- Step 1: file pick -->
    <div id="reg-import-step1">
      <p style="font-size:.875rem;color:var(--warm-gray);margin:0 0 12px;">
        Upload a <strong>tab-separated (.tsv)</strong> or <strong>comma-separated (.csv)</strong> file exported from your spreadsheet.
        The importer auto-detects these column headers:
      </p>
      <div style="margin-bottom:10px;">
        <label style="font-size:.85rem;font-weight:600;display:block;margin-bottom:6px;">Register Type</label>
        <select id="reg-import-type" style="padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;" onchange="updateRegImportHeaders()">
          <option value="baptism">Baptisms</option>
          <option value="confirmation">Confirmations</option>
        </select>
      </div>
      <div id="reg-import-headers" style="background:var(--linen);border-radius:8px;padding:10px 14px;font-size:.78rem;color:var(--charcoal);margin-bottom:16px;line-height:1.8;"></div>
      <label style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;background:var(--teal);color:white;border-radius:8px;cursor:pointer;font-size:.875rem;font-weight:600;">
        &#8679; Choose File
        <input type="file" id="reg-import-file" accept=".csv,.tsv,.txt" style="display:none;" onchange="regImportFileChosen(this)">
      </label>
      <span id="reg-import-filename" style="margin-left:10px;font-size:.85rem;color:var(--warm-gray);"></span>
      <div style="margin-top:14px;padding:10px 14px;background:#fff8f0;border:1px solid #f0c080;border-radius:8px;">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:.85rem;">
          <input type="checkbox" id="reg-import-clear" style="width:15px;height:15px;flex-shrink:0;">
          <span><strong>Delete existing records of this type before importing</strong> — use this to re-import after fixing data issues</span>
        </label>
      </div>
    </div>
    <!-- Step 2: preview -->
    <div id="reg-import-step2" style="display:none;">
      <div id="reg-import-summary" style="font-size:.875rem;margin-bottom:14px;"></div>
      <div style="overflow-x:auto;max-height:280px;border:1px solid var(--border);border-radius:8px;margin-bottom:16px;">
        <table id="reg-import-preview" style="width:100%;border-collapse:collapse;font-size:.78rem;min-width:600px;">
          <thead id="reg-import-preview-head" style="position:sticky;top:0;background:var(--linen);"></thead>
          <tbody id="reg-import-preview-body"></tbody>
        </table>
      </div>
      <div id="reg-import-warn" style="font-size:.82rem;color:var(--danger);margin-bottom:12px;display:none;"></div>
      <div style="display:flex;gap:10px;align-items:center;">
        <button class="btn-primary" onclick="runRegImport()">Import <span id="reg-import-count"></span> Records</button>
        <button class="btn-secondary" onclick="resetRegImport()">&#8592; Choose Different File</button>
        <span id="reg-import-progress" style="font-size:.85rem;color:var(--warm-gray);display:none;"></span>
      </div>
    </div>
    <!-- Step 3: done -->
    <div id="reg-import-step3" style="display:none;text-align:center;padding:24px 0;">
      <div style="font-size:2.4rem;margin-bottom:10px;">&#10003;</div>
      <div style="font-size:1.1rem;font-weight:600;margin-bottom:6px;" id="reg-import-done-msg"></div>
      <div style="font-size:.875rem;color:var(--warm-gray);margin-bottom:20px;" id="reg-import-done-sub"></div>
      <button class="btn-primary" onclick="closeRegImport()">Done</button>
    </div>
  </div>
</div>
<!-- Person edit modal -->
<div class="modal-overlay" id="person-modal">
  <div class="modal">
    <h2 id="person-modal-title">Add Person</h2>
    <input type="hidden" id="pm-id">
    <div class="modal-section">Name</div>
    <div id="pm-name-2col" class="modal-2col">
      <div class="field"><label>First Name</label><input type="text" id="pm-first"></div>
      <div class="field"><label>Last Name</label><input type="text" id="pm-last"></div>
    </div>
    <div id="pm-name-1col" style="display:none;">
      <div class="field"><label>Name</label><input type="text" id="pm-org-name" style="width:100%;"></div>
    </div>
    <div class="modal-section">Contact</div>
    <div class="modal-2col">
      <div class="field"><label>Email</label><input type="email" id="pm-email"></div>
      <div class="field"><label>Phone</label><input type="tel" id="pm-phone"></div>
    </div>
    <div class="modal-section" id="pm-addr-section">Address <span id="pm-addr-hint" style="font-weight:400;text-transform:none;">(leave blank to use household address)</span></div>
    <div class="field" style="margin-bottom:8px;"><label>Street</label><input type="text" id="pm-addr1"></div>
    <div class="modal-2col">
      <div class="field"><label>City</label><input type="text" id="pm-city"></div>
      <div class="field"><label>State / ZIP</label><div style="display:flex;gap:6px;"><input type="text" id="pm-state" style="width:60px;" maxlength="2" placeholder="MO"><input type="text" id="pm-zip" placeholder="63000"></div></div>
    </div>
    <div class="modal-section">Church Info</div>
    <div class="modal-2col">
      <div class="field"><label>Member Type</label>
        <select id="pm-type" onchange="updatePersonNameMode()"><option value="member">Member</option><option value="associate">Associate</option><option value="friend">Friend</option><option value="visitor" selected>Visitor</option><option value="inactive">Inactive</option><option value="organization">Organization</option></select>
      </div>
      <div class="field" id="pm-role-field"><label>Family Role</label>
        <select id="pm-role"><option value="">—</option><option value="head">Head</option><option value="spouse">Spouse</option><option value="child">Child</option><option value="other">Other</option></select>
      </div>
    </div>
    <div class="field" id="pm-hh-field" style="margin-bottom:8px;"><label>Household</label>
      <div class="ac-wrap"><input type="text" id="pm-hh-search" placeholder="Search household…" oninput="acHouseholdSearch()"><div class="ac-dropdown" id="pm-hh-ac"></div></div>
      <input type="hidden" id="pm-hh-id">
    </div>
    <div id="pm-dates-section">
      <div class="modal-section">Demographics</div>
      <div class="modal-2col">
        <div class="field"><label>Gender</label>
          <select id="pm-gender" style="padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:.88rem;width:100%;">
            <option value="">— not set —</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div class="field"><label>Marital Status</label>
          <select id="pm-marital" style="padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:.88rem;width:100%;">
            <option value="">— not set —</option>
            <option value="Single">Single</option>
            <option value="Married">Married</option>
            <option value="Widowed">Widowed</option>
            <option value="Divorced">Divorced</option>
            <option value="Separated">Separated</option>
          </select>
        </div>
      </div>
      <div class="modal-section">Dates</div>
      <div class="modal-2col">
        <div class="field"><label>Date of Birth</label><input type="date" id="pm-dob"></div>
        <div class="field"><label>Baptism</label><input type="date" id="pm-baptism"></div>
        <div class="field"><label>Confirmation</label><input type="date" id="pm-confirm"></div>
        <div class="field"><label>Anniversary</label><input type="date" id="pm-anniv"></div>
        <div class="field"><label>Death Date</label><input type="date" id="pm-death"></div>
      </div>
      <div style="margin-bottom:10px;display:flex;gap:24px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.88rem;">
          <input type="checkbox" id="pm-deceased">
          Mark as deceased
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.88rem;" title="Uncheck to hide this person from printed/public directories">
          <input type="checkbox" id="pm-public" checked>
          Include in directory
        </label>
      </div>
    </div>
    <div class="modal-section">Tags</div>
    <div class="tag-picker" id="pm-tag-picker"></div>
    <div class="modal-section">Church Records</div>
    <div class="modal-2col">
      <div class="field"><label>Envelope #</label><input type="text" id="pm-envelope" placeholder="e.g. 42" maxlength="20"></div>
      <div class="field"><label>Last Seen</label><input type="date" id="pm-last-seen"></div>
    </div>
    <div class="modal-section">Demographics</div>
    <div class="modal-2col">
      <div class="field"><label>Gender</label>
        <select id="pm-gender" style="padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:.88rem;width:100%;">
          <option value="">— not set —</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
          <option value="Other">Other</option>
        </select>
      </div>
      <div class="field"><label>Marital Status</label>
        <select id="pm-marital" style="padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:.88rem;width:100%;">
          <option value="">— not set —</option>
          <option value="Single">Single</option>
          <option value="Married">Married</option>
          <option value="Widowed">Widowed</option>
          <option value="Divorced">Divorced</option>
          <option value="Separated">Separated</option>
        </select>
      </div>
    </div>
    <div class="modal-section">Notes</div>
    <div class="field"><textarea id="pm-notes" rows="2" style="resize:vertical;"></textarea></div>
    <div class="modal-actions">
      <button class="btn-danger" id="pm-del-btn" onclick="deletePerson()" style="margin-right:auto;display:none;">Delete</button>
      <button class="btn-secondary" onclick="closeModal('person-modal')">Cancel</button>
      <button class="btn-primary" onclick="savePerson()">Save</button>
    </div>
  </div>
</div>

<!-- Household detail modal -->
<div class="modal-overlay" id="hh-detail-modal" onclick="if(event.target===this)closeModal('hh-detail-modal')">
  <div class="modal" style="max-width:480px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <h2 style="margin:0;">Household</h2>
      <button class="btn-secondary" style="padding:4px 10px;font-size:.82rem;" onclick="closeModal('hh-detail-modal')">Close</button>
    </div>
    <div id="hh-detail-body"></div>
  </div>
</div>

<!-- Household edit modal -->
<div class="modal-overlay" id="hh-modal">
  <div class="modal">
    <h2 id="hh-modal-title">New Household</h2>
    <input type="hidden" id="hm-id">
    <div class="field" style="margin-bottom:10px;"><label>Family Name</label><input type="text" id="hm-name" placeholder="e.g. Smith Family"></div>
    <div class="field" style="margin-bottom:8px;"><label>Street Address</label><input type="text" id="hm-addr1"></div>
    <div class="field" style="margin-bottom:8px;"><label>Address Line 2</label><input type="text" id="hm-addr2"></div>
    <div class="modal-2col">
      <div class="field"><label>City</label><input type="text" id="hm-city"></div>
      <div class="field"><label>State / ZIP</label><div style="display:flex;gap:6px;"><input type="text" id="hm-state" style="width:60px;" maxlength="2" value="MO"><input type="text" id="hm-zip" placeholder="63000"></div></div>
    </div>
    <div class="field" style="margin-top:10px;"><label>Notes</label><textarea id="hm-notes" rows="2" style="resize:vertical;"></textarea></div>
    <div class="field" style="margin-top:10px;"><label>Family Photo URL</label><input type="url" id="hm-photo" placeholder="https://…"></div>
    <div id="hm-members" style="margin-top:14px;"></div>
    <div class="modal-actions">
      <button class="btn-danger" id="hm-del-btn" onclick="deleteHousehold()" style="margin-right:auto;display:none;">Delete</button>
      <button class="btn-secondary" onclick="closeModal('hh-modal')">Cancel</button>
      <button class="btn-primary" onclick="saveHousehold()">Save</button>
    </div>
  </div>
</div>

<!-- New batch modal -->
<div class="modal-overlay" id="batch-modal">
  <div class="modal" style="max-width:380px;">
    <h2>New Batch</h2>
    <div class="field" style="margin-bottom:10px;"><label>Date</label><input type="date" id="bm-date"></div>
    <div class="field"><label>Description</label><input type="text" id="bm-desc" placeholder="e.g. Sunday AM Offering"></div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal('batch-modal')">Cancel</button>
      <button class="btn-primary" onclick="createBatch()">Create</button>
    </div>
  </div>
</div>

<!-- Tags manager modal -->
<div class="modal-overlay" id="tags-modal">
  <div class="modal">
    <h2>Manage Tags</h2>
    <div id="tags-list" style="margin-bottom:14px;"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
      <div class="field"><label>Name</label><input type="text" id="new-tag-name" placeholder="e.g. Council"></div>
      <div class="field"><label>Color</label><input type="color" id="new-tag-color" value="#5C8FA8" style="width:44px;height:36px;padding:2px;border-radius:6px;cursor:pointer;"></div>
      <button class="btn-primary" onclick="createTag()">Add Tag</button>
    </div>
    <div class="modal-actions"><button class="btn-secondary" onclick="closeModal('tags-modal')">Close</button></div>
  </div>
</div>
<!-- Member Types manager modal -->
<!-- Follow-up modal -->
<div class="modal-overlay" id="followup-modal">
  <div class="modal" style="max-width:440px;">
    <h2>Add Follow-up Item</h2>
    <input type="hidden" id="fu-modal-pid">
    <div class="field"><label>Person (optional)</label>
      <input type="text" id="fu-modal-name" placeholder="Type a name to search…" style="width:100%;">
    </div>
    <div class="field"><label>Type</label>
      <select id="fu-modal-type" style="width:100%;">
        <option value="general">General Follow-up</option>
        <option value="pastoral_call">Pastoral Call</option>
        <option value="prayer">Prayer Follow-up</option>
        <option value="first_gift">First Gift</option>
        <option value="not_seen">Not Seen Recently</option>
        <option value="newsletter">Newsletter</option>
      </select>
    </div>
    <div class="field"><label>Notes</label>
      <textarea id="fu-modal-notes" placeholder="Optional notes…" style="width:100%;height:72px;resize:vertical;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:inherit;"></textarea>
    </div>
    <div class="modal-actions">
      <button class="btn-primary" onclick="saveFollowUpModal()">Save</button>
      <button class="btn-secondary" onclick="closeModal('followup-modal')">Cancel</button>
    </div>
  </div>
</div>
<div class="modal-overlay" id="member-types-modal">
  <div class="modal">
    <h2>Member Types</h2>
    <p style="font-size:.85rem;color:var(--warm-gray);margin-bottom:12px;">Add or remove the types available in the Member Type dropdown. Removing a type won't change existing people — they'll still have that type until edited.</p>
    <div id="member-types-list" style="margin-bottom:14px;"></div>
    <div style="display:flex;gap:8px;align-items:center;">
      <input type="text" id="new-type-name" placeholder="New type name…" style="flex:1;font-size:.88rem;">
      <button class="btn-primary" onclick="addMemberType()">Add</button>
    </div>
    <div class="modal-actions"><button class="btn-secondary" onclick="closeModal('member-types-modal')">Close</button></div>
  </div>
</div>
<script>
// ── DEPLOY VERSION ───────────────────────────────────────────────────
var DEPLOY_VERSION = '2026-04-08-v26';
window.onerror = function(msg, src, line, col, err) {
  var b = document.getElementById('js-error-banner');
  if (!b) { b = document.createElement('div'); b.id = 'js-error-banner';
    b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#c0392b;color:#fff;padding:10px 16px;font-size:.82rem;z-index:99999;font-family:monospace;';
    document.body.appendChild(b); }
  b.textContent = 'JS Error: ' + msg + ' (line ' + line + ')';
  return false;
};
// ── STATE ────────────────────────────────────────────────────────────
var allTags = [], allFunds = [], currentBatchId = null, peopleFilter = {q:'',mt:'',tagId:'',offset:0,limit:100};
var _peopleTotal = 0;
var _pDebounce, _hDebounce;
var _loadedServices = [];
var _hhOffset = 0, _hhTotal = 0;
var _currentPvPerson = null;
var _batchSearch = '';
var _attOrder = 'desc', _attGroupBy = 'none', _attChartMode = 'line';
var _selectMode = false, _selectedPeople = new Set();
var _churchConfig = {};
var DEFAULT_LETTER_TEMPLATE = 'Dear {{name}},\\n\\nThank you for your generous contributions to Timothy Lutheran Church during {{year}}. Your gifts make a difference in our ministry and community.\\n\\nBelow is a summary of your giving for {{year}}:\\n\\n{{gift_table}}\\n\\nTotal Contributions: {{total}}\\n\\n{{#if_ein}}Our EIN/Tax ID is {{ein}}. No goods or services were provided in exchange for these contributions. Please retain this letter for your tax records.{{/if_ein}}\\n\\nWith gratitude,\\n\\nTimothy Lutheran Church\\n\\nDate: {{date}}';
var _userRole = 'admin';

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
  var labels = {home:'Home',people:'People',households:'Households',giving:'Giving',reports:'Reports',attendance:'Attendance',register:'Register',settings:'Settings'};
  // Enforce role-based tab access
  var isFinancePlus = _userRole === 'admin' || _userRole === 'finance';
  var isStaffPlus   = _userRole === 'admin' || _userRole === 'staff';
  var isAdmin       = _userRole === 'admin';
  if (name === 'giving'     && !isFinancePlus) return;
  if (name === 'attendance' && !isStaffPlus)   return;
  if (name === 'register'   && !isStaffPlus)   return;
  if (name === 'import'     && !isAdmin)        return;
  if (name === 'settings'   && !isAdmin)        return;
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
  if (name === 'giving') loadBatches();
  if (name === 'reports') initReports();
  if (name === 'attendance') loadAttendance();
  if (name === 'register') loadRegister();
  if (name === 'settings') loadSettings();
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
    cb.innerHTML = '<input type="checkbox" value="' + yr + '"' + (i === 0 ? ' checked' : '') + '> ' + yr;
    yc.appendChild(cb);
  }
  // Register SW
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', {scope: '/'}).catch(function(){});
  }
  var dv = document.getElementById('deploy-ver');
  if (dv) dv.textContent = 'v' + DEPLOY_VERSION;
  var bsy = document.getElementById('batch-stmt-year');
  if (bsy) bsy.value = y;
  loadTags();
  loadFunds();
  loadMemberTypes();
  applyRoleUI();
});

// ── ROLE UI ──────────────────────────────────────────────────────────────
function applyRoleUI() {
  fetch('/admin/api/me').then(function(r){ return r.json(); }).then(function(d) {
    _userRole = d.role || 'admin';
    document.body.classList.remove('role-admin','role-finance','role-staff','role-member');
    document.body.classList.add('role-' + _userRole);
    var badge = document.getElementById('topbar-role');
    if (badge && _userRole !== 'admin') {
      badge.textContent = d.display_name || _userRole;
      badge.style.display = 'inline-block';
    }
    // Member users land on People tab (no dashboard access)
    if (_userRole === 'member') { showTab('people'); }
    else { showTab('home'); }
  }).catch(function() { showTab('home'); });
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
  // Tags
  var tEl = document.getElementById('fd-tags');
  if (tEl) {
    tEl.innerHTML = fdRadio('fd-tag', '', 'All Tags', !peopleFilter.tagId, 'setFdTag(\'\')')
      + allTags.map(function(t) {
        return '<label style="display:flex;align-items:center;gap:9px;padding:6px 4px;cursor:pointer;font-size:.9rem;border-radius:6px;">'
          + '<input type="radio" name="fd-tag" value="' + t.id + '" ' + (String(peopleFilter.tagId) === String(t.id) ? 'checked' : '') + ' onchange="setFdTag(\'' + t.id + '\')" style="flex-shrink:0;">'
          + '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + esc(t.color) + ';flex-shrink:0;"></span>'
          + esc(t.name) + '</label>';
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
function setFdTag(v) {
  peopleFilter.tagId = v;
  loadPeople(true);
  renderActiveFilterChips();
  updateFilterBadge();
  updateFdCount();
}
function clearAllFilters() {
  peopleFilter.mt = '';
  peopleFilter.tagId = '';
  loadPeople(true);
  renderFilterDrawer();
  renderActiveFilterChips();
  updateFilterBadge();
}
function updateFilterBadge() {
  var count = (peopleFilter.mt ? 1 : 0) + (peopleFilter.tagId ? 1 : 0);
  var badge = document.getElementById('p-filter-count');
  if (badge) { badge.textContent = count; badge.style.display = count > 0 ? 'inline-flex' : 'none'; }
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
  if (peopleFilter.tagId) {
    var tag = allTags.find(function(t){ return String(t.id) === String(peopleFilter.tagId); });
    if (tag) chips.push(filterChip(tag.name, tag.color, "setFdTag('')"));
  }
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

// ── MEMBER TYPES ──────────────────────────────────────────────────────
var _memberTypes = ['Member','Attender','Visitor','Vietnamese Congregation','Other'];
function loadMemberTypes() {
  api('/admin/api/config/member-types').then(function(d) {
    _memberTypes = d.types || _memberTypes;
    refreshMemberTypeSelect();
  });
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
function openMemberTypesManager() {
  openModal('member-types-modal');
  renderMemberTypesList();
}
function renderMemberTypesList() {
  document.getElementById('member-types-list').innerHTML = _memberTypes.map(function(t, i) {
    return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--linen);">'
      + '<span style="flex:1;font-size:.9rem;">' + esc(t) + '</span>'
      + '<button onclick="deleteMemberType(' + i + ')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:.85rem;">&#10005;</button>'
      + '</div>';
  }).join('');
}
function addMemberType() {
  var name = document.getElementById('new-type-name').value.trim();
  if (!name) return;
  if (_memberTypes.some(function(t){return t.toLowerCase()===name.toLowerCase();})) {
    alert('That type already exists.'); return;
  }
  _memberTypes = _memberTypes.concat([name]);
  document.getElementById('new-type-name').value = '';
  saveMemberTypes();
}
function deleteMemberType(idx) {
  if (_memberTypes.length <= 1) { alert('Must have at least one member type.'); return; }
  _memberTypes = _memberTypes.filter(function(_,i){return i!==idx;});
  saveMemberTypes();
}
function saveMemberTypes() {
  api('/admin/api/config/member-types', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({types:_memberTypes})}).then(function() {
    refreshMemberTypeSelect();
    renderMemberTypesList();
  });
}

// ── SETTINGS ──────────────────────────────────────────────────────────
function loadSettings() {
  api('/admin/api/config/church').then(function(d) {
    _churchConfig = d || {};
    var el = document.getElementById('st-church-name');
    if (el) el.value = d.church_name || 'Timothy Lutheran Church';
    el = document.getElementById('st-ein');
    if (el) el.value = d.church_ein || '';
    el = document.getElementById('st-from-name');
    if (el) el.value = d.church_from_name || '';
    el = document.getElementById('st-from-email');
    if (el) el.value = d.church_from_email || '';
    el = document.getElementById('st-letter-tpl');
    if (el) el.value = d.giving_letter_template || DEFAULT_LETTER_TEMPLATE;
  });
  api('/admin/api/tags').then(function(d) {
    allTags = d.tags || [];
    renderTagPills();
    renderSettingsTagsList();
  });
  renderSettingsMemberTypesList();
  loadMemberTypeMap();
}
function saveSettings() {
  var data = {
    church_name: (document.getElementById('st-church-name') || {}).value || '',
    church_ein: (document.getElementById('st-ein') || {}).value || '',
    church_from_name: (document.getElementById('st-from-name') || {}).value || '',
    church_from_email: (document.getElementById('st-from-email') || {}).value || '',
    giving_letter_template: (document.getElementById('st-letter-tpl') || {}).value || DEFAULT_LETTER_TEMPLATE
  };
  api('/admin/api/config/church', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)}).then(function(d) {
    if (d.ok) { _churchConfig = data; setStatus('st-status', 'Saved!', 'ok'); setTimeout(function(){setStatus('st-status','');}, 2500); }
    else setStatus('st-status', 'Error: ' + (d.error||'unknown'), 'err');
  });
}
function resetLetterTemplate() {
  var el = document.getElementById('st-letter-tpl');
  if (el) el.value = DEFAULT_LETTER_TEMPLATE;
}
function renderSettingsTagsList() {
  var c = document.getElementById('settings-tags-list');
  if (!c) return;
  if (!allTags.length) { c.innerHTML = '<p style="color:var(--warm-gray);font-size:.85rem;">No tags yet.</p>'; return; }
  c.innerHTML = allTags.map(function(t) {
    return '<div id="tag-row-' + t.id + '" style="border-bottom:1px solid var(--linen);">'
      + '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;">'
      + '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:' + esc(t.color) + ';flex-shrink:0;cursor:pointer;" onclick="toggleTagEdit(' + t.id + ')"></span>'
      + '<span style="flex:1;font-size:.9rem;">' + esc(t.name) + ' <span style="color:var(--warm-gray);font-size:.78rem;">(' + (t.person_count||0) + ' people)</span></span>'
      + '<button onclick="toggleTagEdit(' + t.id + ')" style="background:none;border:none;color:var(--sky-steel);cursor:pointer;font-size:.82rem;padding:2px 6px;">&#9998; Edit</button>'
      + '<button onclick="deleteTagSettings(' + t.id + ')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:.85rem;padding:2px 6px;">&#10005;</button>'
      + '</div>'
      + '<div id="tag-edit-' + t.id + '" style="display:none;padding:8px 0 12px;display:none;">'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
      + '<input type="color" id="tag-color-' + t.id + '" value="' + esc(t.color) + '" style="width:36px;height:32px;border:1px solid var(--border);border-radius:6px;padding:2px;cursor:pointer;">'
      + '<input type="text" id="tag-name-' + t.id + '" value="' + esc(t.name) + '" style="flex:1;min-width:120px;padding:6px 10px;border:1px solid var(--border);border-radius:8px;font-size:.88rem;">'
      + '<button class="btn-primary" style="font-size:.82rem;padding:6px 12px;" onclick="saveTagEdit(' + t.id + ')">Save</button>'
      + '<button class="btn-secondary" style="font-size:.82rem;padding:6px 12px;" onclick="toggleTagEdit(' + t.id + ')">Cancel</button>'
      + '</div>'
      + '</div>'
      + '</div>';
  }).join('');
}
function toggleTagEdit(id) {
  var el = document.getElementById('tag-edit-' + id);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? '' : 'none';
}
function saveTagEdit(id) {
  var name = (document.getElementById('tag-name-' + id) || {}).value || '';
  var color = (document.getElementById('tag-color-' + id) || {}).value || '#5C8FA8';
  name = name.trim();
  if (!name) { alert('Tag name is required.'); return; }
  api('/admin/api/tags/' + id, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ name: name, color: color })
  }).then(function(r) {
    if (r.ok) { loadSettings(); loadTags(); }
    else alert('Error: ' + (r.error||'unknown'));
  });
}
function createTagSettings() {
  var name = (document.getElementById('st-new-tag-name') || {}).value || '';
  var color = (document.getElementById('st-new-tag-color') || {}).value || '#2E7EA6';
  name = name.trim();
  if (!name) return;
  api('/admin/api/tags', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,color:color})}).then(function() {
    document.getElementById('st-new-tag-name').value = '';
    loadSettings();
    loadTags();
  });
}
function deleteTagSettings(id) {
  if (!confirm('Delete this tag? It will be removed from all people.')) return;
  api('/admin/api/tags/' + id, {method:'DELETE'}).then(function() { loadSettings(); loadTags(); });
}
function renderSettingsMemberTypesList() {
  var c = document.getElementById('settings-member-types-list');
  if (!c) return;
  c.innerHTML = _memberTypes.map(function(t, i) {
    return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--linen);">'
      + '<span style="flex:1;font-size:.9rem;">' + esc(t) + '</span>'
      + '<button onclick="deleteMemberTypeSettings(' + i + ')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:.85rem;">&#10005;</button>'
      + '</div>';
  }).join('');
}
function addMemberTypeSettings() {
  var name = ((document.getElementById('st-new-type-name') || {}).value || '').trim();
  if (!name) return;
  if (_memberTypes.some(function(t){return t.toLowerCase()===name.toLowerCase();})) {
    alert('That type already exists.'); return;
  }
  _memberTypes = _memberTypes.concat([name]);
  document.getElementById('st-new-type-name').value = '';
  saveMemberTypes();
  renderSettingsMemberTypesList();
}
function deleteMemberTypeSettings(idx) {
  if (_memberTypes.length <= 1) { alert('Must have at least one member type.'); return; }
  _memberTypes = _memberTypes.filter(function(_,i){return i!==idx;});
  saveMemberTypes();
  renderSettingsMemberTypesList();
}

// ── BREEZE STATUS → MEMBER TYPE MAPPING ──────────────────────────────
var _mtMapData = {};
function loadMemberTypeMap() {
  var c = document.getElementById('settings-mt-map-list');
  var h = document.getElementById('settings-mt-map-hint');
  if (!c) return;
  c.innerHTML = '<span style="color:var(--warm-gray);font-size:.85rem;">Loading\u2026</span>';
  api('/admin/api/config/member-type-map').then(function(d) {
    _mtMapData = d.map || {};
    var seen = d.seen || [];
    if (!seen.length) {
      c.innerHTML = '<p style="color:var(--warm-gray);font-size:.85rem;margin:0;">No Breeze statuses recorded yet. Run a Breeze import first, then return here to map them.</p>';
      if (h) h.textContent = '';
      return;
    }
    if (h) h.textContent = seen.length + ' distinct status value' + (seen.length !== 1 ? 's' : '') + ' seen from Breeze.';
    c.innerHTML = seen.map(function(status) {
      var mapped = _mtMapData[status] || '';
      var safeStatus = status.replace(/'/g, "\\'");
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--linen);">'
        + '<span style="flex:1;font-size:.9rem;">'+esc(status)+'</span>'
        + '<svg viewBox="0 0 16 16" style="width:14px;height:14px;flex-shrink:0;fill:var(--warm-gray);"><path d="M8 1l7 7-7 7M1 8h14" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>'
        + '<select onchange="saveMtMapEntry(\''+safeStatus+'\',this.value)" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:.85rem;min-width:160px;">'
        + '<option value="">— no mapping —</option>'
        + _memberTypes.map(function(t) { return '<option value="'+esc(t)+'"'+(mapped===t?' selected':'')+'>'+esc(t)+'</option>'; }).join('')
        + '</select>'
        + '</div>';
    }).join('');
  });
}
function saveMtMapEntry(status, localType) {
  _mtMapData[status] = localType;
  api('/admin/api/config/member-type-map', {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({map: _mtMapData})
  });
}

// ── PRINT DIRECTORY ──────────────────────────────────────────────────
function printDirectory() {
  window.open('/admin/api/directory', '_blank');
}

// ── DASHBOARD ─────────────────────────────────────────────────────────
var _dashData = null;
function loadDashboard() {
  var body = document.getElementById('dash-body');
  if (!body) return;
  body.innerHTML = '<div style="color:var(--warm-gray);font-size:13px;padding:20px 0;">Loading\u2026</div>';
  api('/admin/api/dashboard').then(function(d) {
    _dashData = d;
    renderDashboard(d);
  }).catch(function(e) {
    var body2 = document.getElementById('dash-body');
    if (body2) body2.innerHTML = '<div style="color:var(--danger);padding:20px;">Could not load dashboard: '+esc(e.message||'error')+'</div>';
  });
}
function renderDashboard(d) {
  var body = document.getElementById('dash-body');
  if (!body) return;
  var pvColors = ['#2E7EA6','#C9973A','#5A9E6F','#9B59B6','#E87040'];
  var maxType = d.typeCounts && d.typeCounts.length ? d.typeCounts[0].n : 1;
  var yr = new Date().getFullYear();
  var html = '';

  // ── Quick actions ──────────────────────────────────────────────
  html += '<div class="dash-quick">'
    + dashQBtn('<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>', 'Add Person', "openPersonEdit(null);showTab('people')")
    + dashQBtn('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8L2 7h20l-6-4z"/>', 'Record Giving', "showTab('giving')")
    + dashQBtn('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4"/>', 'Attendance', "showTab('attendance')")
    + dashQBtn('<path d="M18 20V10M12 20V4M6 20v-6"/>', 'Reports', "showTab('reports')")
    + '</div>';

  // ── Stat strip ─────────────────────────────────────────────────
  var lastSvc = d.recentAttendance && d.recentAttendance.length ? d.recentAttendance[0] : null;
  html += '<div class="dash-stats">'
    + dashStat(d.totalPeople, 'Total People', d.addedThisYear + ' added this year')
    + dashStat(d.totalHouseholds, 'Households', d.addedThisMonth + ' new this month')
    + dashStat('$'+fmt$(d.givingThisYear), yr+' Giving', yr-1+': $'+fmt$(d.givingLastYear))
    + dashStat(lastSvc ? lastSvc.attendance : '\u2014', 'Last Service', lastSvc ? esc(lastSvc.service_name)+' \u00b7 '+lastSvc.service_date : 'No attendance yet')
    + '</div>';

  // ── Follow-up queue ────────────────────────────────────────────
  var fuItems = d.followUpItems || [];
  var fuTypeLabels = { pastoral_call:'Pastoral Call', prayer:'Prayer Follow-up', first_gift:'First Gift', not_seen:'Not Seen', newsletter:'Newsletter', general:'General' };
  var fuTypeColors = { pastoral_call:'#2E7EA6', prayer:'#9B59B6', first_gift:'#C9973A', not_seen:'#E87040', newsletter:'#5A9E6F', general:'#666' };
  html += '<div class="dash-section-hdr">'
    + '<span>Follow-up Queue</span>'
    + '<span style="font-size:12px;color:var(--warm-gray);font-weight:400;">'+(fuItems.length ? fuItems.length+' open' : 'all clear')+'</span>'
    + '<button class="btn-secondary" style="font-size:.72rem;padding:3px 10px;margin-left:auto;" onclick="openAddFollowUp(null)">+ Add</button>'
    + '</div>';
  html += '<div class="dash-card" style="padding:0;"><div class="dash-card-body">';
  if (fuItems.length) {
    html += fuItems.map(function(item) {
      var name = item.first_name || item.last_name ? ((item.first_name||'')+' '+(item.last_name||'')).trim() : null;
      var typeLabel = fuTypeLabels[item.type] || item.type;
      var typeColor = fuTypeColors[item.type] || '#666';
      var age = item.created_at ? Math.floor((Date.now()-new Date(item.created_at))/86400000) : 0;
      var ageStr = age === 0 ? 'today' : age === 1 ? 'yesterday' : age+'d ago';
      return '<div class="dash-fu-item" id="fu-'+item.id+'">'
        + '<button class="dash-fu-check" onclick="completeFollowUp('+item.id+')" title="Mark complete">&#10003;</button>'
        + '<div style="flex:1;min-width:0;">'
        + '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">'
        + '<span style="font-size:11px;font-weight:700;padding:1px 7px;border-radius:99px;background:'+typeColor+'18;color:'+typeColor+';">'+esc(typeLabel)+'</span>'
        + (name ? '<span class="dash-item-name" style="cursor:pointer;" onclick="openPersonDetail('+item.person_id+')">'+esc(name)+'</span>' : '')
        + '</div>'
        + (item.notes ? '<div style="font-size:12px;color:var(--warm-gray);margin-top:2px;white-space:pre-wrap;">'+esc(item.notes)+'</div>' : '')
        + '</div>'
        + '<div style="font-size:11px;color:var(--faint);flex-shrink:0;">'+ageStr+'</div>'
        + '</div>';
    }).join('');
  } else {
    html += '<div style="padding:18px;color:var(--faint);font-size:13px;font-style:italic;">No open follow-up items. Enjoy the quiet!</div>';
  }
  html += '</div></div>';

  // ── First-time givers ──────────────────────────────────────────
  var firstGivers = d.firstGivers || [];
  if (firstGivers.length) {
    html += '<div class="dash-section-hdr"><span>First-Time Givers</span>'
      + '<span style="font-size:12px;color:var(--warm-gray);font-weight:400;">last 60 days</span></div>';
    html += '<div class="dash-card" style="padding:0;"><div class="dash-card-body">'
      + firstGivers.map(function(p) {
          var name = ((p.first_name||'')+' '+(p.last_name||'')).trim();
          var bg = pvColors[p.id % pvColors.length];
          var ini = ((p.first_name||'').charAt(0)+(p.last_name||'').charAt(0)).toUpperCase();
          return '<div class="dash-row-item" style="cursor:pointer;" onclick="openPersonDetail('+p.id+')">'
            + '<div class="dash-avatar" style="background:'+bg+';">'+ini+'</div>'
            + '<div style="flex:1;"><div class="dash-item-name">'+esc(name)+'</div>'
            + '<div class="dash-item-sub">First gift '+esc(p.first_gift_date||'')+'</div></div>'
            + '<button class="btn-secondary" style="font-size:.72rem;padding:3px 8px;" onclick="event.stopPropagation();addFollowUpForPerson('+p.id+',\''+esc(name)+'\',\'first_gift\')">Follow up</button>'
            + '</div>';
        }).join('')
      + '</div></div>';
  }

  // ── Not seen recently ──────────────────────────────────────────
  var notSeen = d.notSeenRecently || [];
  if (notSeen.length) {
    html += '<div class="dash-section-hdr"><span>Not Seen Recently</span>'
      + '<span style="font-size:12px;color:var(--warm-gray);font-weight:400;">>8 weeks since last visit</span></div>';
    html += '<div class="dash-card" style="padding:0;"><div class="dash-card-body">'
      + notSeen.map(function(p) {
          var name = ((p.first_name||'')+' '+(p.last_name||'')).trim();
          var bg = pvColors[p.id % pvColors.length];
          var ini = ((p.first_name||'').charAt(0)+(p.last_name||'').charAt(0)).toUpperCase();
          return '<div class="dash-row-item" style="cursor:pointer;" onclick="openPersonDetail('+p.id+')">'
            + '<div class="dash-avatar" style="background:'+bg+';">'+ini+'</div>'
            + '<div style="flex:1;"><div class="dash-item-name">'+esc(name)+'</div>'
            + '<div class="dash-item-sub">Last seen: '+esc(p.last_seen_date||'unknown')+'</div></div>'
            + '<button class="btn-secondary" style="font-size:.72rem;padding:3px 8px;" onclick="event.stopPropagation();addFollowUpForPerson('+p.id+',\''+esc(name)+'\',\'not_seen\')">Call</button>'
            + '</div>';
        }).join('')
      + '</div></div>';
  }

  // ── Bottom row: birthdays + membership ─────────────────────────
  html += '<div class="dash-row">';

  // Upcoming birthdays
  html += '<div class="dash-card"><div class="dash-card-hdr">'
    + '<svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:var(--teal);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>'
    + 'Upcoming Birthdays <span style="font-weight:400;color:var(--warm-gray);font-size:11px;margin-left:4px;">next 60 days</span></div>'
    + '<div class="dash-card-body">'
    + (d.birthdays && d.birthdays.length
        ? d.birthdays.map(function(p) {
            var name = ((p.first_name||'')+' '+(p.last_name||'')).trim();
            var ini = ((p.first_name||'').charAt(0)+(p.last_name||'').charAt(0)).toUpperCase();
            var bg = pvColors[p.id % pvColors.length];
            var parts = (p.dob||'').split('-');
            var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            var dateStr = parts.length >= 3 ? months[parseInt(parts[1])-1]+' '+parseInt(parts[2]) : p.dob;
            return '<div class="dash-bday" onclick="openPersonDetail('+p.id+')" style="cursor:pointer;">'
              + '<div class="dash-avatar" style="background:'+bg+';">'+ini+'</div>'
              + '<div style="flex:1;"><div class="dash-item-name">'+esc(name)+'</div></div>'
              + '<div style="font-size:12px;color:var(--warm-gray);">'+dateStr+'</div>'
              + '</div>';
          }).join('')
        : '<div style="padding:20px 18px;color:var(--faint);font-size:13px;font-style:italic;">No birthdays in the next 60 days.</div>')
    + '</div></div>';

  // Membership breakdown
  html += '<div class="dash-card"><div class="dash-card-hdr">'
    + '<svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:var(--teal);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>'
    + 'Membership by Type</div>'
    + '<div class="dash-type-bar">'
    + (d.typeCounts||[]).map(function(r) {
        var pct = Math.round((r.n / Math.max(maxType,1)) * 100);
        var lbl = r.member_type ? (r.member_type.charAt(0).toUpperCase()+r.member_type.slice(1)) : 'Unknown';
        return '<div class="dash-bar-row">'
          + '<div class="dash-bar-lbl" onclick="setFdMt(\''+r.member_type+'\');showTab(\'people\')" style="cursor:pointer;color:var(--sky-steel);" title="View '+lbl+' people">'+esc(lbl)+'</div>'
          + '<div class="dash-bar-track"><div class="dash-bar-fill" style="width:'+pct+'%;"></div></div>'
          + '<div class="dash-bar-n">'+r.n+'</div>'
          + '</div>';
      }).join('')
    + '</div></div>';

  html += '</div>'; // /dash-row
  body.innerHTML = html;
}
// ── Follow-up helpers ──────────────────────────────────────────────────
function completeFollowUp(id) {
  api('/admin/api/followup/'+id, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({completed:true}) })
    .then(function() {
      var el = document.getElementById('fu-'+id);
      if (el) { el.style.opacity='0.4'; el.style.textDecoration='line-through'; setTimeout(function(){el.remove();},600); }
    });
}
function addFollowUpForPerson(pid, name, type) {
  api('/admin/api/followup', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({person_id:pid, type:type, notes:''}) })
    .then(function() {
      showErrorBanner('\u2713 Follow-up added for '+esc(name)+'.'); // reuse banner in success mode
      loadDashboard();
    });
}
function openAddFollowUp(pid, name, type) {
  var modal = document.getElementById('followup-modal');
  if (!modal) return;
  document.getElementById('fu-modal-pid').value = pid || '';
  document.getElementById('fu-modal-name').value = name || '';
  document.getElementById('fu-modal-type').value = type || 'general';
  document.getElementById('fu-modal-notes').value = '';
  openModal('followup-modal');
}
function markSeenToday(personId) {
  var today = new Date().toISOString().slice(0,10);
  api('/admin/api/people/'+personId, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(Object.assign({}, _currentPvPerson, {last_seen_date: today}))
  }).then(function(r) {
    if (r && r.ok) {
      var el = document.getElementById('pv-last-seen');
      if (el) el.textContent = today;
      if (_currentPvPerson) _currentPvPerson.last_seen_date = today;
    }
  });
}
function saveFollowUpModal() {
  var pid = document.getElementById('fu-modal-pid').value;
  var nameSearch = document.getElementById('fu-modal-name').value.trim();
  var type = document.getElementById('fu-modal-type').value;
  var notes = document.getElementById('fu-modal-notes').value.trim();
  // If name was typed, search for person first
  if (nameSearch && !pid) {
    api('/admin/api/people?q='+encodeURIComponent(nameSearch)+'&limit=1').then(function(d) {
      var p = d.people && d.people[0];
      saveFollowUpItem(p ? p.id : null, type, notes);
    });
  } else {
    saveFollowUpItem(pid ? parseInt(pid) : null, type, notes);
  }
}
function saveFollowUpItem(pid, type, notes) {
  api('/admin/api/followup', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({person_id:pid||null,type:type,notes:notes}) })
    .then(function() { closeModal('followup-modal'); loadDashboard(); });
}
function dashStat(val, lbl, sub) {
  return '<div class="dash-stat">'
    + '<div class="dash-stat-val">'+esc(String(val))+'</div>'
    + '<div class="dash-stat-lbl">'+esc(lbl)+'</div>'
    + (sub ? '<div class="dash-stat-sub">'+esc(sub)+'</div>' : '')
    + '</div>';
}
function dashQBtn(svgPath, label, onclick) {
  return '<button class="dash-quick-btn" onclick="'+onclick+'">'
    + '<svg viewBox="0 0 24 24">'+svgPath+'</svg>'
    + esc(label)+'</button>';
}
function fmt$(cents) {
  if (!cents) return '0';
  return (cents/100).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0});
}

// ── FUNDS ──────────────────────────────────────────────────────────────
function loadFunds() {
  api('/admin/api/funds').then(function(d) { allFunds = d.funds || []; });
}

// ── PEOPLE ────────────────────────────────────────────────────────────
function setPeopleFilter(btn, mt) {
  // Legacy – still works if called from old code
  peopleFilter.mt = mt;
  loadPeople(true);
  renderActiveFilterChips();
  updateFilterBadge();
}
function debouncePeople() {
  clearTimeout(_pDebounce);
  _pDebounce = setTimeout(function() {
    peopleFilter.q = document.getElementById('p-search').value;
    loadPeople(true);
  }, 300);
}
function loadPeople(resetPage) {
  if (resetPage) peopleFilter.offset = 0;
  var params = new URLSearchParams();
  if (peopleFilter.q) params.set('q', peopleFilter.q);
  if (peopleFilter.mt) params.set('member_type', peopleFilter.mt);
  if (peopleFilter.tagId) params.set('tag_id', peopleFilter.tagId);
  params.set('limit', peopleFilter.limit);
  params.set('offset', peopleFilter.offset);
  setStatus('p-status', 'Loading…');
  api('/admin/api/people?' + params).then(function(d) {
    setStatus('p-status', '');
    if (d.offline) document.getElementById('offline-banner').style.display = 'block';
    _peopleTotal = d.total || 0;
    var people = d.people || [];
    renderPeopleDesktop(people);
    renderPeopleMobile(people);
    renderPeoplePager();
    updateFdCount();
  }).catch(function() { setStatus('p-status','Error loading people.','err'); });
}
function renderPeoplePager() {
  var el = document.getElementById('p-pager');
  if (!el) return;
  var total = _peopleTotal, limit = peopleFilter.limit, offset = peopleFilter.offset;
  var from = offset + 1, to = Math.min(offset + limit, total);
  var countHtml = '<span style="font-size:12px;color:var(--warm-gray);">Showing ' + from + '–' + to + ' of ' + total + ' people</span>';
  var prevDisabled = offset === 0 ? ' disabled' : '';
  var nextDisabled = to >= total ? ' disabled' : '';
  var navHtml = total <= limit ? '' :
    '<div style="display:flex;gap:6px;">'
    + '<button class="btn-secondary" style="padding:5px 12px;font-size:12px;"' + prevDisabled + ' onclick="peoplePage(-1)">&#8592; Prev</button>'
    + '<button class="btn-secondary" style="padding:5px 12px;font-size:12px;"' + nextDisabled + ' onclick="peoplePage(1)">Next &#8594;</button>'
    + '</div>';
  el.innerHTML = countHtml + navHtml;
}
function peoplePage(dir) {
  peopleFilter.offset = Math.max(0, peopleFilter.offset + dir * peopleFilter.limit);
  loadPeople();
}
function renderPeopleDesktop(people) {
  _loadedPeople = people;
  var c = document.getElementById('p-grid');
  if (!people.length) { c.innerHTML = '<div class="empty" style="padding:40px 24px;"><div class="empty-icon">&#128100;</div>No people found</div>'; return; }
  var isOrg, isSelected, displayName, avInner, avClass, clickHandler, tags, tagHtml, trCls;
  var rows = people.map(function(p) {
    isOrg = p.member_type === 'organization';
    isSelected = _selectedPeople.has(p.id);
    displayName = isOrg
      ? esc(p.first_name || p.last_name)
      : esc(p.last_name) + (p.last_name && p.first_name ? ', ' : '') + esc(p.first_name);
    avInner = isOrg
      ? '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:none;stroke:#888;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/></svg>'
      : (p.photo_url ? '<img src="' + esc(photoSrc(p.photo_url)) + '" alt="" style="width:34px;height:34px;border-radius:50%;object-fit:cover;" onerror="this.style.display=\'none\';this.parentNode.textContent=\'' + initials(p.first_name, p.last_name) + '\'">' : initials(p.first_name, p.last_name));
    avClass = 'dir-avatar ' + (isOrg ? 'dir-avatar-org' : 'dir-avatar-' + (p.id % 5));
    clickHandler = _selectMode
      ? 'onclick="togglePersonSelect(' + p.id + ', this)"'
      : 'onclick="openPersonDetail(' + p.id + ')"';
    tags = p.tags || [];
    tagHtml = tags.slice(0,3).map(function(t) {
      return '<span class="dir-tag" style="background:' + esc(t.color) + '22;color:' + esc(t.color) + ';border-color:' + esc(t.color) + '44;">' + esc(t.name) + '</span>';
    }).join('');
    if (tags.length > 3) tagHtml += '<span class="dir-tag-more">+' + (tags.length - 3) + '</span>';
    trCls = isSelected ? ' class="dir-row-selected"' : '';
    var badge = (p.member_type||'visitor').replace(/\s+/g,'-');
    return '<tr' + trCls + ' style="cursor:pointer;" ' + clickHandler + '>'
      + '<td style="width:36px;text-align:center;" onclick="event.stopPropagation()"><input type="checkbox"' + (isSelected ? ' checked' : '') + ' style="' + (_selectMode ? '' : 'display:none;') + '" onchange="togglePersonSelect(' + p.id + ',this.closest(&#39;tr&#39;))" onclick="event.stopPropagation()"></td>'
      + '<td><div class="dir-name-cell"><div class="' + avClass + '">' + avInner + '</div><span class="dir-name-link">' + displayName + '</span></div></td>'
      + '<td><span class="dir-badge dir-badge-' + badge + '">' + esc(p.member_type||'visitor') + '</span></td>'
      + '<td class="dir-contact">' + (p.email ? '<a href="mailto:' + esc(p.email) + '" onclick="event.stopPropagation()">' + esc(p.email) + '</a>' : '') + (p.phone ? '<div class="dir-phone">' + esc(p.phone) + '</div>' : '') + '</td>'
      + '<td>' + (p.household_name ? '<span class="dir-hh-link">' + esc(p.household_name) + '</span>' : '<span style="color:var(--faint);">—</span>') + '</td>'
      + '<td><div class="dir-tags">' + tagHtml + '</div></td>'
      + '</tr>';
  }).join('');
  var cbAll = '<input type="checkbox" id="p-check-all" style="' + (_selectMode ? '' : 'display:none;') + '" onchange="selectAllVisible(this.checked)">';
  c.innerHTML = '<table class="dir-table"><thead><tr>'
    + '<th>' + cbAll + '</th>'
    + '<th>Name</th><th>Status</th><th>Contact</th><th>Household</th><th>Tags</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table>';
}
// ── MULTI-SELECT ──────────────────────────────────────────────────────
function toggleSelectMode() {
  _selectMode = !_selectMode;
  _selectedPeople.clear();
  var btn = document.getElementById('p-select-btn');
  if (btn) btn.textContent = _selectMode ? '&#10005; Cancel Select' : '&#9745; Select';
  var bar = document.getElementById('p-bulk-bar');
  if (bar) bar.style.display = _selectMode ? 'flex' : 'none';
  if (_selectMode) {
    // Populate member type dropdown
    var sel = document.getElementById('p-bulk-mt');
    if (sel) {
      sel.innerHTML = '<option value="">Change Member Type…</option>'
        + _memberTypes.map(function(t) {
          var v = t.toLowerCase().replace(/\s+/g,'-');
          return '<option value="' + v + '">' + esc(t) + '</option>';
        }).join('');
    }
    // Populate tags
    renderBulkTagsPanel();
  }
  renderPeopleDesktop(_loadedPeople || []);
}
var _loadedPeople = [];
function clearSelection() {
  _selectMode = false;
  _selectedPeople.clear();
  var btn = document.getElementById('p-select-btn');
  if (btn) btn.textContent = '&#9745; Select';
  var bar = document.getElementById('p-bulk-bar');
  if (bar) bar.style.display = 'none';
  var panel = document.getElementById('p-bulk-tags-panel');
  if (panel) panel.style.display = 'none';
  renderPeopleDesktop(_loadedPeople || []);
}
function togglePersonSelect(id, el) {
  if (_selectedPeople.has(id)) {
    _selectedPeople.delete(id);
    el.classList.remove('selected', 'dir-row-selected');
  } else {
    _selectedPeople.add(id);
    el.classList.add('selected', 'dir-row-selected');
  }
  var cb = el.querySelector('input[type=checkbox]');
  if (cb) cb.checked = _selectedPeople.has(id);
  var countEl = document.getElementById('p-bulk-count');
  if (countEl) countEl.textContent = _selectedPeople.size + ' selected';
}
function selectAllVisible(checked) {
  (_loadedPeople || []).forEach(function(p) {
    if (checked) _selectedPeople.add(p.id); else _selectedPeople.delete(p.id);
  });
  var countEl = document.getElementById('p-bulk-count');
  if (countEl) countEl.textContent = _selectedPeople.size + ' selected';
  renderPeopleDesktop(_loadedPeople || []);
}
function applyBulkMemberType() {
  var mt = document.getElementById('p-bulk-mt').value;
  if (!mt) { alert('Please choose a member type.'); return; }
  if (!_selectedPeople.size) { alert('No people selected.'); return; }
  if (!confirm('Change member type to "' + mt + '" for ' + _selectedPeople.size + ' people?')) return;
  var ids = Array.from(_selectedPeople);
  api('/admin/api/people/bulk-member-type', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ids:ids, member_type:mt})}).then(function() {
    clearSelection(); loadPeople();
  });
}
function renderBulkTagsPanel() {
  var c = document.getElementById('p-bulk-tags-list');
  if (!c) return;
  c.innerHTML = allTags.map(function(t) {
    return '<span data-btid="' + t.id + '" data-btstate="0" onclick="cycleBulkTag(this)" style="cursor:pointer;padding:4px 10px;border:1px solid var(--border);border-radius:100px;font-size:.8rem;background:var(--linen);color:var(--warm-gray);user-select:none;">'
      + '<span class="tag-dot" style="background:' + esc(t.color) + '"></span>' + esc(t.name) + '</span>';
  }).join('');
}
function cycleBulkTag(el) {
  var state = parseInt(el.dataset.btstate || '0');
  state = (state + 1) % 3; // 0=no change, 1=add, 2=remove
  el.dataset.btstate = state;
  if (state === 0) { el.style.background='var(--linen)'; el.style.color='var(--warm-gray)'; el.style.borderColor='var(--border)'; el.title=''; }
  if (state === 1) { el.style.background='#d5f5e3'; el.style.color='#196f3d'; el.style.borderColor='#196f3d'; el.title='Will ADD to all selected'; }
  if (state === 2) { el.style.background='#fadbd8'; el.style.color='#922b21'; el.style.borderColor='#922b21'; el.title='Will REMOVE from all selected'; }
}
function openBulkTagsPanel() {
  if (!_selectedPeople.size) { alert('No people selected.'); return; }
  renderBulkTagsPanel();
  var panel = document.getElementById('p-bulk-tags-panel');
  if (panel) panel.style.display = '';
}
function applyBulkTags() {
  if (!_selectedPeople.size) { alert('No people selected.'); return; }
  var adds = [], removes = [];
  document.querySelectorAll('#p-bulk-tags-list [data-btid]').forEach(function(el) {
    var state = parseInt(el.dataset.btstate || '0');
    var tid = parseInt(el.dataset.btid);
    if (state === 1) adds.push(tid);
    if (state === 2) removes.push(tid);
  });
  if (!adds.length && !removes.length) {
    document.getElementById('p-bulk-tags-panel').style.display = 'none'; return;
  }
  var ids = Array.from(_selectedPeople);
  var done = 0;
  ids.forEach(function(personId) {
    // Fetch current tags, then add/remove
    api('/admin/api/people/' + personId).then(function(p) {
      var curTagIds = (p.tags || []).map(function(t){return t.id;});
      var newTagIds = curTagIds.filter(function(id){return removes.indexOf(id)<0;});
      adds.forEach(function(id){ if (newTagIds.indexOf(id)<0) newTagIds.push(id); });
      return api('/admin/api/people/' + personId, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({tag_ids:newTagIds})});
    }).then(function() {
      done++;
      if (done === ids.length) {
        document.getElementById('p-bulk-tags-panel').style.display = 'none';
        clearSelection(); loadPeople();
      }
    });
  });
}
function renderPeopleMobile(people) {
  var c = document.getElementById('p-contact-list');
  if (!people.length) { c.innerHTML = '<div class="empty"><div class="empty-icon">&#128100;</div>No people found</div>'; return; }
  c.innerHTML = people.map(function(p) {
    var addr = [p.address1, p.city, p.state].filter(Boolean).join(', ');
    if (!addr && p.household_address) addr = p.household_address;
    var mapUrl = addr ? 'https://maps.apple.com/?q=' + encodeURIComponent(addr) : '';
    return '<div class="c-card">'
      + '<div class="c-avatar">' + (p.photo_url ? '<img src="' + esc(photoSrc(p.photo_url)) + '" alt="" onerror="this.style.display=\'none\';this.parentNode.textContent=\'' + initials(p.first_name, p.last_name) + '\'">' : initials(p.first_name, p.last_name)) + '</div>'
      + '<div class="c-info"><div class="c-name">' + esc(p.first_name) + (p.last_name ? ' ' + esc(p.last_name) : '') + (p.deceased ? ' <span style="font-size:.72rem;color:#888;font-weight:400;">&#x271D; d. ' + (p.death_date||'') + '</span>' : '') + '</div>'
      + '<div class="c-type">' + esc(p.member_type||'visitor') + '</div>'
      + (p.phone ? '<a href="tel:' + esc(p.phone.replace(/\\D/g,'')) + '" class="c-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.37 1.18 2 2 0 012.34 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.72 6.72l1.28-.78a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>' + esc(p.phone) + '</a>' : '')
      + (addr && mapUrl ? '<a href="' + esc(mapUrl) + '" class="c-link" target="_blank"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>' + esc(addr) + '</a>' : '')
      + '</div></div>';
  }).join('');
}

// ── PERSON DETAIL ─────────────────────────────────────────────────────
function showProfile(p) {
  _currentPvPerson = p;
  var isOrg = p.member_type === 'organization';
  var displayName = isOrg ? (p.first_name||p.last_name||'Unnamed') : ((p.first_name||'')+' '+(p.last_name||'')).trim();
  var tn = document.getElementById('pv-topbar-name');
  if (tn) tn.textContent = displayName;
  var photoEl = document.getElementById('pv-photo');
  if (photoEl) {
    var pvColors = ['#2E7EA6','#C9973A','#5A9E6F','#9B59B6','#E87040'];
    if (p.photo_url) {
      var pvi = ((p.first_name||'').charAt(0)+(p.last_name||'').charAt(0)).toUpperCase();
      var pvbg = pvColors[p.id % pvColors.length];
      photoEl.style.background = pvbg;
      var img = document.createElement('img');
      img.src = photoSrc(p.photo_url);
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
      img.onerror = function() {
        photoEl.innerHTML = '<span style="color:white;font-size:24px;font-weight:600;line-height:1;">'+pvi+'</span>';
      };
      photoEl.innerHTML = '';
      photoEl.appendChild(img);
    } else if (isOrg) {
      photoEl.innerHTML = '<svg viewBox="0 0 24 24" style="width:32px;height:32px;fill:none;stroke:var(--warm-gray);stroke-width:1.5"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/></svg>';
      photoEl.style.background = 'var(--linen)';
    } else {
      var initials = ((p.first_name||'').charAt(0)+(p.last_name||'').charAt(0)).toUpperCase();
      var bg = pvColors[p.id % pvColors.length];
      photoEl.innerHTML = '<span style="color:white;font-size:24px;font-weight:600;line-height:1;">'+initials+'</span>';
      photoEl.style.background = bg;
    }
  }
  var fnEl = document.getElementById('pv-fullname');
  if (fnEl) fnEl.textContent = displayName;
  var bdEl = document.getElementById('pv-badge');
  if (bdEl) {
    var mt = p.member_type||'visitor';
    var badgeClass = mt === 'member' ? 'dir-badge-member' : mt === 'organization' ? 'dir-badge-organization' : 'dir-badge-visitor';
    bdEl.innerHTML = '<span class="dir-badge '+badgeClass+'">'+mt.charAt(0).toUpperCase()+mt.slice(1)+'</span>';
  }
  var hhEl = document.getElementById('pv-hh');
  if (hhEl) hhEl.textContent = p.household_name ? ' \u00b7 '+p.household_name : '';
  var roleEl = document.getElementById('pv-role');
  if (roleEl) roleEl.textContent = p.family_role ? ' \u00b7 '+p.family_role : '';
  // Info tab — two-column layout
  var infoEl = document.getElementById('ptab-info');
  if (infoEl) {
    var addrParts = [p.address1, p.city, ((p.state||'')+(p.zip ? ' '+p.zip : '')).trim()].filter(Boolean);
    var addrStr = addrParts.map(esc).join(', ');
    var addrVal = addrStr ? '<a href="https://maps.google.com/?q='+encodeURIComponent(addrParts.join(', '))+'" target="_blank" rel="noopener">'+addrStr+'</a>' : '';
    var emailVal = p.email ? '<a href="mailto:'+esc(p.email)+'">'+esc(p.email)+'</a>' : '';
    var phoneVal = p.phone ? '<a href="tel:'+esc(p.phone)+'">'+esc(p.phone)+'</a>' : '';
    function calcAge(ds) {
      if (!ds) return '';
      var d = new Date(ds), now = new Date();
      var age = now.getFullYear() - d.getFullYear();
      if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
      return age >= 0 ? ' (age '+age+')' : '';
    }
    var tagHtml = (p.tags||[]).map(function(t){
      return '<span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:99px;background:'+esc(t.color)+';color:white;font-size:11px;font-weight:600;margin:2px;">'+esc(t.name)+'</span>';
    }).join('');
    var dirBadge = p.public_directory === 0 ? '<span style="display:inline-block;font-size:10px;padding:2px 7px;border-radius:99px;background:#f4e8c1;color:#9a7a2b;font-weight:600;margin-left:8px;">Private</span>' : '';
    var leftCol = '<div>'
      + '<div class="pv-section">'
      + '<div class="pv-section-title">Contact'+dirBadge+'</div>'
      + pvRow('Address', addrVal)
      + pvRow('Phone', phoneVal)
      + pvRow('Email', emailVal)
      + (p.household_id ? '<div style="margin-top:8px;"><button class="btn-secondary" style="font-size:.78rem;padding:4px 10px;" onclick="applyAddressToHousehold('+p.id+','+p.household_id+')">Apply address to household</button></div>' : '')
      + '</div>'
      + '<div class="pv-section">'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><div class="pv-section-title" style="margin:0;">Family</div>'
      + (p.household_id ? '<button class="btn-secondary" style="font-size:.75rem;padding:3px 9px;margin-left:auto;" onclick="openAddToHouseholdModal('+p.household_id+')">+ Add Person</button>' : '')
      + '</div>'
      + (p.household_id
          ? '<div id="pv-family-members" style="color:var(--warm-gray);font-size:12px;">Loading\u2026</div>'
          : '<div style="color:var(--faint);font-size:12px;font-style:italic;">No household linked</div>')
      + '</div>'
      + '</div>';
    var rightCol = '<div>'
      + '<div class="pv-section">'
      + '<div class="pv-section-title">Demographics / Dates</div>'
      + '<div class="pv-field-grid">'
      + (p.gender        ? pvField('gender',         p.gender)        : '')
      + (p.marital_status? pvField('marital status', p.marital_status): '')
      + pvField('birthday', p.dob ? fmtDate(p.dob)+calcAge(p.dob) : '')
      + pvField('baptized', p.baptism_date ? fmtDate(p.baptism_date) : '')
      + pvField('confirmed', p.confirmation_date ? fmtDate(p.confirmation_date) : '')
      + pvField('anniversary', p.anniversary_date ? fmtDate(p.anniversary_date) : '')
      + pvField('deceased', p.deceased ? (p.death_date ? fmtDate(p.death_date) : 'Yes') : 'No')
      + '</div>'
      + '</div>'
      + '<div class="pv-section" id="pv-tags-section">'
      + '<div class="pv-section-title" style="display:flex;align-items:center;gap:8px;">Tags'
      + '<button class="require-edit" onclick="togglePvTagEditor()" style="background:none;border:none;cursor:pointer;padding:2px 4px;color:var(--warm-gray);font-size:.78rem;line-height:1;" title="Edit tags">&#9998;</button>'
      + '</div>'
      + '<div id="pv-tags-display" style="display:flex;flex-wrap:wrap;gap:6px;min-height:24px;">'+(tagHtml||'<span style="color:var(--warm-gray);font-size:.82rem;font-style:italic;">No tags</span>')+'</div>'
      + '<div id="pv-tags-editor" style="display:none;margin-top:10px;">'
      + '<div id="pv-tag-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;"></div>'
      + '<button class="btn-primary require-edit" style="font-size:.8rem;padding:5px 12px;" onclick="savePvTags()">Save Tags</button>'
      + '<button class="btn-secondary" style="font-size:.8rem;padding:5px 12px;margin-left:6px;" onclick="togglePvTagEditor()">Cancel</button>'
      + '</div>'
      + '</div>'
      + (p.notes ? '<div class="pv-section"><div class="pv-section-title">Notes</div><div style="font-size:13px;color:var(--charcoal);white-space:pre-wrap;line-height:1.5;">'+esc(p.notes)+'</div></div>' : '')
      + '</div>';
    infoEl.innerHTML = '<div class="pv-info-cols">'+leftCol+rightCol+'</div>';
    if (p.household_id) loadPvFamily(p.household_id, p.id);
  }
  // Aside
  var asideEl = document.getElementById('pv-aside');
  if (asideEl) {
    asideEl.innerHTML = '<div class="pv-aside-block">'
      + '<div class="pv-aside-lbl">Member ID</div>'
      + '<div style="font-size:13px;color:var(--charcoal);">#'+p.id+'</div>'
      + '</div>'
      + (p.envelope_number ? '<div class="pv-aside-block"><div class="pv-aside-lbl">Envelope #</div><div style="font-size:13px;color:var(--charcoal);">'+esc(p.envelope_number)+'</div></div>' : '')
      + (p.deceased ? '<div class="pv-aside-block" style="color:var(--danger);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Deceased</div>' : '')
      + '<div class="pv-aside-block">'
      + '<div class="pv-aside-lbl">Added</div>'
      + '<div style="font-size:13px;color:var(--charcoal);">'+(p.created_at ? p.created_at.slice(0,10) : '—')+'</div>'
      + '</div>'
      + '<div class="pv-aside-block">'
      + '<div class="pv-aside-lbl">Last Seen</div>'
      + '<div style="font-size:13px;color:var(--charcoal);" id="pv-last-seen">'+(p.last_seen_date || '—')+'</div>'
      + '</div>'
      + '<div class="pv-aside-block" style="display:flex;flex-direction:column;gap:6px;">'
      + '<button class="btn-secondary" style="font-size:.75rem;padding:4px 10px;width:100%;" onclick="markSeenToday('+p.id+')">&#10003; Mark Seen Today</button>'
      + '<button class="btn-secondary" style="font-size:.75rem;padding:4px 10px;width:100%;" onclick="openAddFollowUp('+p.id+',\''+esc((p.first_name||'')+' '+(p.last_name||''))+'\',\'pastoral_call\')">+ Follow Up</button>'
      + '</div>'
      + '<div class="pv-aside-block" id="pv-aside-giving">'
      + '<div class="pv-aside-lbl">Total Giving</div>'
      + '<div style="font-size:12px;color:var(--warm-gray);">—</div>'
      + '</div>';
    api('/admin/api/giving?person_id='+p.id+'&limit=500').then(function(d) {
      var entries = (d && d.entries) ? d.entries : (Array.isArray(d) ? d : []);
      var total = entries.reduce(function(s,e){return s+(e.amount||0);},0);
      var ag = document.getElementById('pv-aside-giving');
      if (ag) ag.innerHTML = '<div class="pv-aside-lbl">Total Giving</div>'
        + '<div class="pv-aside-big">$'+(total/100).toFixed(2)+'</div>'
        + '<div class="pv-aside-sub">'+entries.length+' gift'+(entries.length!==1?'s':'')+'</div>';
    });
  }
  var ca = document.querySelector('.content-area');
  if (ca) ca.classList.add('pv-mode');
  showPvTab('info');
}
function pvRow(key, val) {
  var empty = !val;
  return '<div class="pv-row"><div class="pv-row-key">'+key+'</div><div class="pv-row-val'+(empty?' empty':'')+'">'+(val||'—')+'</div></div>';
}
function pvField(label, val) {
  var empty = !val;
  return '<div class="pv-field-card"><div class="pv-field-card-lbl">'+label+'</div><div class="pv-field-card-val'+(empty?' empty':'')+'">'+( val||'—')+'</div></div>';
}
function loadPvFamily(hhId, selfId) {
  var el = document.getElementById('pv-family-members');
  if (!el) return;
  api('/admin/api/households/'+hhId).then(function(d) {
    var members = (d && d.members) ? d.members : [];
    if (!members.length) { el.innerHTML = '<div style="color:var(--faint);font-size:12px;font-style:italic;">No members found</div>'; return; }
    var clrs = ['#2E7EA6','#C9973A','#5A9E6F','#9B59B6','#E87040'];
    el.innerHTML = members.map(function(m) {
      var mName = ((m.first_name||'')+' '+(m.last_name||'')).trim();
      var ini = ((m.first_name||'').charAt(0)+(m.last_name||'').charAt(0)).toUpperCase();
      var mbg = clrs[m.id % clrs.length];
      var meta = m.family_role ? m.family_role.charAt(0).toUpperCase()+m.family_role.slice(1) : '';
      var isSelf = m.id === selfId;
      return '<div class="pv-family-member">'
        + '<div class="pv-family-avatar" style="background:'+mbg+';">'+ini+'</div>'
        + '<div style="flex:1;">'
        + (isSelf
            ? '<div class="pv-family-name" style="opacity:.6;">'+esc(mName)+'</div>'
            : '<div class="pv-family-name" onclick="openPersonDetail('+m.id+')" style="cursor:pointer;color:var(--sky-steel);">'+esc(mName)+'</div>')
        + (meta ? '<div class="pv-family-meta">'+esc(meta)+'</div>' : '')
        + '</div>'
        + '</div>';
    }).join('')
    + '<div style="margin-top:8px;"><button class="btn-secondary" style="font-size:.75rem;padding:3px 9px;" onclick="editHouseholdById('+hhId+')">&#9998; Edit Household Details</button></div>';
  }).catch(function(){
    el.innerHTML = '<div style="color:var(--faint);font-size:12px;">Could not load family</div>';
  });
}
function closeProfile() {
  _currentPvPerson = null;
  var ca = document.querySelector('.content-area');
  if (ca) ca.classList.remove('pv-mode');
}
function togglePvTagEditor() {
  var editor = document.getElementById('pv-tags-editor');
  if (!editor) return;
  var open = editor.style.display !== 'none';
  if (open) { editor.style.display = 'none'; return; }
  // Populate chip picker with current person's tags pre-selected
  var sel = (_currentPvPerson && _currentPvPerson.tags) ? _currentPvPerson.tags.map(function(t){return t.id;}) : [];
  var chips = document.getElementById('pv-tag-chips');
  if (chips) {
    chips.innerHTML = allTags.map(function(t) {
      var on = sel.indexOf(t.id) >= 0;
      return '<span class="tag-chip" data-tid="'+t.id+'"'+(on?' data-picked="1"':'')+' onclick="togglePvTagChip(this)"'
        +' style="cursor:pointer;padding:4px 10px;'
        +(on?'background:'+t.color+'30;border-color:'+t.color+';color:'+t.color+';':'background:var(--linen);border-color:var(--border);color:var(--warm-gray);')
        +'">'+esc(t.name)+'</span>';
    }).join('');
  }
  editor.style.display = '';
}
function togglePvTagChip(el) {
  var t = allTags.find(function(x){return x.id == el.dataset.tid;});
  if (!t) return;
  if (el.dataset.picked === '1') {
    el.dataset.picked = '';
    el.style.background = 'var(--linen)'; el.style.borderColor = 'var(--border)'; el.style.color = 'var(--warm-gray)';
  } else {
    el.dataset.picked = '1';
    el.style.background = t.color+'30'; el.style.borderColor = t.color; el.style.color = t.color;
  }
}
function savePvTags() {
  if (!_currentPvPerson) return;
  var ids = [];
  document.querySelectorAll('#pv-tag-chips .tag-chip').forEach(function(el) {
    if (el.dataset.picked === '1') ids.push(parseInt(el.dataset.tid));
  });
  api('/admin/api/people/'+_currentPvPerson.id, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(Object.assign({}, _currentPvPerson, {
      tag_ids: ids,
      household_id: _currentPvPerson.household_id || null
    }))
  }).then(function(r) {
    if (r.error) { alert('Error: '+r.error); return; }
    // Update local tags and re-render display
    _currentPvPerson.tags = allTags.filter(function(t){ return ids.indexOf(t.id) >= 0; });
    var display = document.getElementById('pv-tags-display');
    if (display) {
      var tagHtml = _currentPvPerson.tags.map(function(t){
        return '<span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:99px;background:'+esc(t.color)+';color:white;font-size:11px;font-weight:600;margin:2px;">'+esc(t.name)+'</span>';
      }).join('');
      display.innerHTML = tagHtml || '<span style="color:var(--warm-gray);font-size:.82rem;font-style:italic;">No tags</span>';
    }
    document.getElementById('pv-tags-editor').style.display = 'none';
  });
}
function applyAddressToHousehold(personId, householdId) {
  var p = _currentPvPerson;
  if (!p) return;
  if (!confirm('Apply this person\'s address to all members of the household?')) return;
  api('/admin/api/households/'+householdId+'/sync-address', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ address1: p.address1||'', city: p.city||'', state: p.state||'MO', zip: p.zip||'' })
  }).then(function(r) {
    if (r.ok) alert('Address applied to all household members.');
    else alert('Error: '+(r.error||'unknown'));
  });
}
// Add-to-household: search for existing person and link them
function openAddToHouseholdModal(householdId) {
  var name = prompt('Enter the name of a person to add to this household:');
  if (!name) return;
  api('/admin/api/people?q='+encodeURIComponent(name)+'&limit=10').then(function(d) {
    var people = d.people || [];
    if (!people.length) { alert('No people found matching "'+name+'".'); return; }
    var list = people.map(function(p,i){return (i+1)+'. '+p.first_name+' '+p.last_name+(p.household_name?' ('+p.household_name+')':'');}).join('\n');
    var idx = parseInt(prompt('Select a person:\n'+list+'\n\nEnter number:')) - 1;
    if (isNaN(idx) || idx < 0 || idx >= people.length) return;
    var chosen = people[idx];
    api('/admin/api/people/'+chosen.id, {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(Object.assign({}, chosen, { household_id: householdId, tag_ids: (chosen.tags||[]).map(function(t){return t.id;}) }))
    }).then(function(r) {
      if (r.ok) {
        alert(chosen.first_name+' '+chosen.last_name+' added to household.');
        if (_currentPvPerson && _currentPvPerson.household_id === householdId) {
          loadPvFamily(householdId, _currentPvPerson.id);
        }
      } else alert('Error: '+(r.error||'unknown'));
    });
  });
}
function showPvTab(name) {
  document.querySelectorAll('.pv-tab').forEach(function(b){
    b.classList.toggle('active', b.dataset.ptab === name);
  });
  document.querySelectorAll('.ptab-panel').forEach(function(p){
    p.classList.toggle('active', p.id === 'ptab-'+name);
  });
  if (name === 'giving' && _currentPvPerson) loadPvGiving(_currentPvPerson.id);
  if (name === 'attendance' && _currentPvPerson) loadPvAttendance(_currentPvPerson.id);
  if (name === 'timeline' && _currentPvPerson) loadPvTimeline(_currentPvPerson.id);
}
function loadPvGiving(personId) {
  var el = document.getElementById('ptab-giving');
  if (!el) return;
  el.innerHTML = '<div style="padding:20px;color:var(--warm-gray);">Loading...</div>';
  api('/admin/api/giving?person_id='+personId+'&limit=200').then(function(d) {
    var entries = (d && d.entries) ? d.entries : (Array.isArray(d) ? d : []);
    if (!entries.length) { el.innerHTML = '<div style="padding:20px;color:var(--warm-gray);">No giving records found.</div>'; return; }
    var total = entries.reduce(function(s,e){return s+(e.amount||0);},0);
    var byYear = {};
    entries.forEach(function(e){
      var yr = (e.contribution_date||'').slice(0,4)||'—';
      byYear[yr] = (byYear[yr]||0)+(e.amount||0);
    });
    var yearRows = Object.keys(byYear).sort().reverse().map(function(yr){
      return '<tr><td style="padding:6px 12px;">'+yr+'</td><td style="padding:6px 12px;text-align:right;">$'+(byYear[yr]/100).toFixed(2)+'</td></tr>';
    }).join('');
    var recentRows = entries.slice(0,20).map(function(e){
      return '<tr><td style="padding:6px 12px;">'+(e.contribution_date||'—')+'</td>'
        +'<td style="padding:6px 12px;">'+(e.fund_name||'General')+'</td>'
        +'<td style="padding:6px 12px;text-align:right;">$'+((e.amount||0)/100).toFixed(2)+'</td></tr>';
    }).join('');
    el.innerHTML = '<div style="padding:20px;">'
      +'<div style="display:flex;gap:16px;margin-bottom:20px;">'
      +'<div class="pv-card" style="flex:1;"><div class="pv-aside-big">$'+(total/100).toFixed(2)+'</div><div class="pv-card-lbl">Total Given</div></div>'
      +'<div class="pv-card" style="flex:1;"><div class="pv-aside-big">'+entries.length+'</div><div class="pv-card-lbl">Gifts</div></div>'
      +'</div>'
      +'<div class="pv-card-lbl" style="margin-bottom:8px;">By Year</div>'
      +'<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">'
      +'<tbody>'+yearRows+'</tbody></table>'
      +'<div class="pv-card-lbl" style="margin-bottom:8px;">Recent Gifts</div>'
      +'<table style="width:100%;border-collapse:collapse;font-size:13px;">'
      +'<thead><tr style="background:var(--linen);"><th style="padding:6px 12px;text-align:left;font-weight:500;">Date</th><th style="padding:6px 12px;text-align:left;font-weight:500;">Fund</th><th style="padding:6px 12px;text-align:right;font-weight:500;">Amount</th></tr></thead>'
      +'<tbody>'+recentRows+'</tbody></table>'
      +'</div>';
  }).catch(function(){ el.innerHTML = '<div style="padding:20px;color:var(--danger);">Could not load giving.</div>'; });
}
function togglePvQuickGift() {
  var box = document.getElementById('pv-quick-gift');
  var btn = document.getElementById('pv-gift-btn');
  if (!box) return;
  var open = box.style.display !== 'none';
  box.style.display = open ? 'none' : 'block';
  if (btn) btn.textContent = open ? '+ Add Gift' : '— Cancel';
  if (!open) {
    // Pre-fill today's date and populate funds
    var di = document.getElementById('pv-gift-date');
    if (di && !di.value) di.value = new Date().toISOString().slice(0,10);
    var fs = document.getElementById('pv-gift-fund');
    if (fs && !fs.options.length) {
      allFunds.forEach(function(f){ fs.appendChild(new Option(f.name, f.id)); });
    }
    document.getElementById('pv-gift-err').style.display = 'none';
  }
}
function togglePvCheckNum() {
  var m = document.getElementById('pv-gift-method');
  var r = document.getElementById('pv-gift-check-row');
  if (r) r.style.display = (m && m.value === 'check') ? '' : 'none';
}
function submitPvQuickGift() {
  if (!_currentPvPerson) return;
  var fund_id = document.getElementById('pv-gift-fund').value;
  var amount  = document.getElementById('pv-gift-amount').value;
  var date    = document.getElementById('pv-gift-date').value;
  var method  = document.getElementById('pv-gift-method').value;
  var check   = document.getElementById('pv-gift-check').value;
  var notes   = document.getElementById('pv-gift-notes').value;
  var errEl   = document.getElementById('pv-gift-err');
  if (!fund_id || !amount || !date) { errEl.textContent = 'Fund, amount, and date are required.'; errEl.style.display='block'; return; }
  api('/admin/api/giving/quick-entry', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ person_id: _currentPvPerson.id, fund_id, amount, date, method, check_number: check, notes })
  }).then(function(r) {
    if (r.error) { errEl.textContent = r.error; errEl.style.display='block'; return; }
    // Reset form
    document.getElementById('pv-gift-amount').value = '';
    document.getElementById('pv-gift-notes').value = '';
    document.getElementById('pv-gift-check').value = '';
    errEl.style.display='none';
    togglePvQuickGift();
    loadPvGiving(_currentPvPerson.id);
  }).catch(function(){ errEl.textContent = 'Error saving gift.'; errEl.style.display='block'; });
}
function loadPvAttendance(personId) {
  var el = document.getElementById('ptab-attendance');
  if (!el) return;
  el.innerHTML = '<div style="padding:20px;color:var(--warm-gray);">Attendance data coming soon.</div>';
}
function loadPvTimeline(personId) {
  var el = document.getElementById('ptab-timeline');
  if (!el) return;
  el.innerHTML = '<div style="padding:20px;color:var(--warm-gray);">Loading…</div>';
  Promise.all([
    api('/admin/api/audit?entity_type=person&entity_id='+personId+'&limit=60'),
    api('/admin/api/followup?person_id='+personId)
  ]).then(function(results) {
    var auditEntries = (results[0] && results[0].entries) ? results[0].entries : [];
    var fuItems = (results[1] && results[1].items) ? results[1].items : [];
    // Merge and sort by date descending
    var events = [];
    auditEntries.forEach(function(a) {
      events.push({ ts: a.ts, type: 'audit', data: a });
    });
    fuItems.forEach(function(f) {
      events.push({ ts: f.completed_at || f.created_at, type: 'followup', data: f });
    });
    events.sort(function(a,b){ return (b.ts||'').localeCompare(a.ts||''); });
    if (!events.length) {
      el.innerHTML = '<div style="padding:20px;color:var(--warm-gray);font-style:italic;">No timeline entries yet.</div>';
      return;
    }
    var typeLabels = {pastoral_call:'Pastoral Call',prayer:'Prayer Follow-up',first_gift:'First Gift',not_seen:'Not Seen',newsletter:'Newsletter',general:'Follow-up'};
    var rows = events.map(function(ev) {
      var d = ev.data;
      var ts = (ev.ts||'').slice(0,16).replace('T',' ');
      if (ev.type === 'audit') {
        var old = d.old_value ? esc(d.old_value) : '<em style="color:var(--warm-gray)">—</em>';
        var nw  = d.new_value ? esc(d.new_value) : '<em style="color:var(--warm-gray)">—</em>';
        return '<div class="tl-row">'
          + '<div class="tl-dot tl-dot-edit"></div>'
          + '<div class="tl-body">'
          + '<div class="tl-meta"><span class="tl-action">Edited</span> <span class="tl-field">'+esc(d.field||'')+'</span></div>'
          + '<div class="tl-change">'+old+' &rarr; '+nw+'</div>'
          + '<div class="tl-ts">'+ts+'</div>'
          + '</div></div>';
      } else {
        var fLabel = typeLabels[d.type] || 'Follow-up';
        var status = d.completed ? '<span style="color:var(--teal);font-size:.78rem;">&#10003; done '+(d.completed_at||'').slice(0,10)+'</span>' : '<span style="color:var(--sand-tan);font-size:.78rem;">open</span>';
        return '<div class="tl-row">'
          + '<div class="tl-dot tl-dot-fu"></div>'
          + '<div class="tl-body">'
          + '<div class="tl-meta"><span class="tl-action">'+esc(fLabel)+'</span> '+status+'</div>'
          + (d.notes ? '<div class="tl-change">'+esc(d.notes)+'</div>' : '')
          + '<div class="tl-ts">'+ts+'</div>'
          + '</div></div>';
      }
    }).join('');
    el.innerHTML = '<div style="padding:20px 16px;">'+rows+'</div>';
  }).catch(function() {
    el.innerHTML = '<div style="padding:20px;color:var(--danger);">Could not load timeline.</div>';
  });
}
function openPersonEdit(p) {
  var isNew = !p || !p.id;
  document.getElementById('person-modal-title').textContent = isNew ? 'Add Person' : p.first_name + ' ' + p.last_name;
  document.getElementById('pm-id').value = isNew ? '' : p.id;
  document.getElementById('pm-first').value = isNew ? '' : (p.first_name||'');
  document.getElementById('pm-last').value = isNew ? '' : (p.last_name||'');
  document.getElementById('pm-email').value = isNew ? '' : (p.email||'');
  document.getElementById('pm-phone').value = isNew ? '' : (p.phone||'');
  document.getElementById('pm-addr1').value = isNew ? '' : (p.address1||'');
  document.getElementById('pm-city').value = isNew ? '' : (p.city||'');
  document.getElementById('pm-state').value = isNew ? 'MO' : (p.state||'MO');
  document.getElementById('pm-zip').value = isNew ? '' : (p.zip||'');
  document.getElementById('pm-type').value = isNew ? 'visitor' : (p.member_type||'visitor');
  updatePersonNameMode();
  if (!isNew && p.member_type === 'organization') document.getElementById('pm-org-name').value = p.first_name||'';
  document.getElementById('pm-role').value = isNew ? '' : (p.family_role||'');
  document.getElementById('pm-gender').value = isNew ? '' : (p.gender||'');
  document.getElementById('pm-marital').value = isNew ? '' : (p.marital_status||'');
  document.getElementById('pm-dob').value = isNew ? '' : (p.dob||'');
  document.getElementById('pm-baptism').value = isNew ? '' : (p.baptism_date||'');
  document.getElementById('pm-confirm').value = isNew ? '' : (p.confirmation_date||'');
  document.getElementById('pm-anniv').value = isNew ? '' : (p.anniversary_date||'');
  document.getElementById('pm-death').value = isNew ? '' : (p.death_date||'');
  document.getElementById('pm-deceased').checked = !isNew && !!p.deceased;
  var pubEl = document.getElementById('pm-public');
  if (pubEl) pubEl.checked = isNew ? true : (p.public_directory !== 0);
  document.getElementById('pm-envelope').value = isNew ? '' : (p.envelope_number||'');
  document.getElementById('pm-last-seen').value = isNew ? '' : (p.last_seen_date||'');
  document.getElementById('pm-notes').value = isNew ? '' : (p.notes||'');
  var genderEl = document.getElementById('pm-gender'); if (genderEl) genderEl.value = isNew ? '' : (p.gender||'');
  var maritalEl = document.getElementById('pm-marital'); if (maritalEl) maritalEl.value = isNew ? '' : (p.marital_status||'');
  document.getElementById('pm-hh-search').value = isNew ? '' : (p.household_name||'');
  document.getElementById('pm-hh-id').value = isNew ? '' : (p.household_id||'');
  // Tag picker
  var sel = (p && p.tags) ? p.tags.map(function(t){return t.id;}) : [];
  document.getElementById('pm-tag-picker').innerHTML = allTags.map(function(t) {
    var on = sel.indexOf(t.id) >= 0;
    return '<span class="tag-chip" data-tid="' + t.id + '" onclick="toggleTagPick(this)" style="cursor:pointer;padding:4px 10px;'
      + (on ? 'background:' + t.color + '30;border-color:' + t.color + ';color:' + t.color + ';' : 'background:var(--linen);border-color:var(--border);color:var(--warm-gray);') + '">'
      + '<span class="tag-dot" style="background:' + esc(t.color) + '"></span>' + esc(t.name) + '</span>';
  }).join('');
  document.getElementById('pm-del-btn').style.display = isNew ? 'none' : 'inline-flex';
  openModal('person-modal');
}
function toggleTagPick(el) {
  var t = allTags.find(function(x){return x.id == el.dataset.tid;});
  if (!t) return;
  var on = el.style.background.indexOf('#') !== -1 || el.style.background.indexOf('rgb') !== -1;
  // Check by data attribute
  if (el.dataset.picked === '1') {
    el.dataset.picked = '';
    el.style.background = 'var(--linen)'; el.style.borderColor = 'var(--border)'; el.style.color = 'var(--warm-gray)';
  } else {
    el.dataset.picked = '1';
    el.style.background = t.color + '30'; el.style.borderColor = t.color; el.style.color = t.color;
  }
}
function getSelectedTagIds() {
  var ids = [];
  document.querySelectorAll('#pm-tag-picker .tag-chip').forEach(function(el) {
    // A chip is "selected" if it has a color border (not the default warm-gray)
    if (el.style.borderColor !== 'var(--border)' && el.style.borderColor !== 'rgb(232, 224, 208)' && el.style.borderColor) {
      ids.push(parseInt(el.dataset.tid));
    }
  });
  return ids;
}
function updatePersonNameMode() {
  var isOrg = document.getElementById('pm-type').value === 'organization';
  document.getElementById('pm-name-2col').style.display = isOrg ? 'none' : '';
  document.getElementById('pm-name-1col').style.display = isOrg ? '' : 'none';
  document.getElementById('pm-role-field').style.display = isOrg ? 'none' : '';
  document.getElementById('pm-hh-field').style.display = isOrg ? 'none' : '';
  document.getElementById('pm-dates-section').style.display = isOrg ? 'none' : '';
  document.getElementById('pm-addr-hint').style.display = isOrg ? 'none' : '';
}
function savePerson() {
  var id = document.getElementById('pm-id').value;
  var isOrg = document.getElementById('pm-type').value === 'organization';
  var first_name = isOrg ? document.getElementById('pm-org-name').value.trim()
                         : document.getElementById('pm-first').value.trim();
  var last_name  = isOrg ? '' : document.getElementById('pm-last').value.trim();
  var data = {
    first_name: first_name,
    last_name: last_name,
    email: document.getElementById('pm-email').value.trim(),
    phone: document.getElementById('pm-phone').value.trim(),
    address1: document.getElementById('pm-addr1').value.trim(),
    city: document.getElementById('pm-city').value.trim(),
    state: document.getElementById('pm-state').value.trim(),
    zip: document.getElementById('pm-zip').value.trim(),
    member_type: document.getElementById('pm-type').value,
    family_role: document.getElementById('pm-role').value,
    gender: document.getElementById('pm-gender').value,
    marital_status: document.getElementById('pm-marital').value,
    household_id: document.getElementById('pm-hh-id').value || null,
    dob: document.getElementById('pm-dob').value,
    baptism_date: document.getElementById('pm-baptism').value,
    confirmation_date: document.getElementById('pm-confirm').value,
    anniversary_date: document.getElementById('pm-anniv').value,
    death_date: document.getElementById('pm-death').value,
    deceased: document.getElementById('pm-deceased').checked ? 1 : 0,
    public_directory: (document.getElementById('pm-public') || {checked:true}).checked ? 1 : 0,
    envelope_number: document.getElementById('pm-envelope').value.trim(),
    last_seen_date: document.getElementById('pm-last-seen').value,
    notes: document.getElementById('pm-notes').value,
    gender: (document.getElementById('pm-gender') || {value:''}).value,
    marital_status: (document.getElementById('pm-marital') || {value:''}).value,
    tag_ids: getSelectedTagIds()
  };
  if (!data.first_name || (!isOrg && !data.last_name)) { alert(isOrg ? 'Name is required.' : 'First and last name are required.'); return; }
  var url = id ? '/admin/api/people/' + id : '/admin/api/people';
  var meth = id ? 'PUT' : 'POST';
  api(url, {method:meth, headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)}).then(function(r) {
    if (r.ok) {
      closeModal('person-modal');
      var pvId = _currentPvPerson ? (_currentPvPerson.id || r.id) : null;
      if (pvId) {
        api('/admin/api/people/' + pvId).then(function(p) { showProfile(p); });
      }
      loadPeople();
    } else alert('Error saving: ' + (r.error||'unknown'));
  });
}
function deletePerson() {
  var id = document.getElementById('pm-id').value;
  if (!id) return;
  if (!confirm('Mark this person as inactive?')) return;
  api('/admin/api/people/' + id, {method:'DELETE'}).then(function() { closeModal('person-modal'); loadPeople(); });
}

// ── CHURCH REGISTER ───────────────────────────────────────────────────
var _regType = 'baptism';
var _regEntries = [];   // cached full list for current type
var _regEditId = null;  // null = add mode, number = edit mode
var _regLabels = {
  baptism:      { title: 'Baptisms',      nameLbl: 'Name Baptized',  name2Lbl: 'Parent / Sponsor', col2: 'Parent/Sponsor' },
  confirmation: { title: 'Confirmations', nameLbl: 'Name Confirmed', name2Lbl: 'Sponsors / Witnesses', col2: 'Sponsors/Witnesses' }
};
function showRegisterTab(type) {
  _regType = type;
  _regEditId = null;
  document.querySelectorAll('[data-rtab]').forEach(function(b) {
    b.classList.toggle('active', b.dataset.rtab === type);
  });
  var lbl = _regLabels[type];
  var ft = document.getElementById('reg-form-title'); if (ft) ft.textContent = 'Add ' + lbl.title.slice(0,-1);
  var nl = document.getElementById('reg-name-lbl');   if (nl) nl.textContent = lbl.nameLbl;
  var n2 = document.getElementById('reg-name2-lbl');  if (n2) n2.textContent = lbl.name2Lbl;
  var sb = document.getElementById('reg-save-btn');   if (sb) sb.textContent = 'Add Entry';
  var cb = document.getElementById('reg-cancel-btn'); if (cb) cb.style.display = 'none';
  clearRegForm();
  loadRegister();
}
function clearRegForm() {
  ['reg-date','reg-name','reg-name2','reg-officiant','reg-notes'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
}
function toggleRegForm() {
  var p = document.getElementById('reg-form-panel');
  if (!p) return;
  p.style.display = p.style.display === 'none' ? '' : 'none';
}
function loadRegister() {
  var el = document.getElementById('reg-list');
  if (!el) return;
  el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--warm-gray);font-size:.85rem;">Loading\u2026</div>';
  api('/admin/api/register?type=' + _regType).then(function(d) {
    _regEntries = d.entries || [];
    populateRegYearFilter(_regEntries);
    filterRegister();
  }).catch(function() {
    el.innerHTML = '<div style="padding:20px;color:var(--danger);">Could not load register.</div>';
  });
}
function populateRegYearFilter(entries) {
  var sel = document.getElementById('reg-year-filter');
  if (!sel) return;
  var years = {};
  entries.forEach(function(e) { var y = (e.event_date||'').slice(0,4); if (y) years[y] = 1; });
  var ys = Object.keys(years).sort().reverse();
  var cur = sel.value;
  sel.innerHTML = '<option value="">All Years</option>'
    + ys.map(function(y){ return '<option value="'+y+'"'+(y===cur?' selected':'')+'>'+y+'</option>'; }).join('');
}
function filterRegister() {
  var search = (document.getElementById('reg-search') ? document.getElementById('reg-search').value : '').toLowerCase().trim();
  var year   = document.getElementById('reg-year-filter') ? document.getElementById('reg-year-filter').value : '';
  var filtered = _regEntries.filter(function(e) {
    if (year && (e.event_date||'').slice(0,4) !== year) return false;
    if (search) {
      var hay = (e.name+' '+(e.name2||'')+' '+(e.officiant||'')).toLowerCase();
      var tokens = search.split(/\s+/).filter(Boolean);
      if (!tokens.every(function(t){ return hay.indexOf(t) >= 0; })) return false;
    }
    return true;
  });
  var stat = document.getElementById('reg-stat-txt');
  if (stat) {
    var total = _regEntries.length;
    stat.textContent = filtered.length === total
      ? total + ' ' + _regLabels[_regType].title.toLowerCase()
      : filtered.length + ' of ' + total + ' shown';
  }
  renderRegisterList(filtered);
}
function renderRegisterList(entries) {
  var el = document.getElementById('reg-list');
  if (!el) return;
  var lbl = _regLabels[_regType];
  if (!entries.length) {
    el.innerHTML = '<div style="padding:40px 20px;text-align:center;color:var(--warm-gray);">'
      + '<div style="font-size:2rem;margin-bottom:10px;">\uD83D\uDCDA</div>'
      + '<div style="font-size:.9rem;font-weight:600;margin-bottom:4px;">No ' + lbl.title.toLowerCase() + ' found</div>'
      + '<div style="font-size:.82rem;">' + (_regEntries.length ? 'Try adjusting the search or year filter.' : 'Use the form to record the first entry.') + '</div></div>';
    return;
  }
  var byYear = {}; var yearOrder = [];
  entries.forEach(function(e) {
    var yr = (e.event_date||'').slice(0,4) || '\u2014';
    if (!byYear[yr]) { byYear[yr] = []; yearOrder.push(yr); }
    byYear[yr].push(e);
  });
  // Detect if this batch has extended fields (historical import)
  var hasExtended = entries.some(function(e){ return e.father||e.mother||e.sponsors||e.dob||e.baptism_place; });
  var html = '';
  yearOrder.forEach(function(yr) {
    var grp = byYear[yr];
    var rows = grp.map(function(e) {
      // Date cell
      var dateDisp = e.event_date ? e.event_date : '\u2014';
      var placeDisp = (e.baptism_place && hasExtended) ? '<br><span style="font-size:.75rem;color:var(--warm-gray);">'+esc(e.baptism_place)+'</span>' : '';
      // Name cell
      var namePart = '<strong>'+esc(e.name||'\u2014')+'</strong>';
      if (e.dob) namePart += '<br><span style="font-size:.75rem;color:var(--warm-gray);">b. '+esc(e.dob)+'</span>';
      if (e.notes) namePart += '<br><span style="font-size:.75rem;color:var(--warm-gray);font-style:italic;">'+esc(e.notes)+'</span>';
      // Family cell (extended or simple)
      var familyPart;
      if (hasExtended) {
        var parts = [];
        if (e.father) parts.push('<span style="font-size:.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.03em;">Father</span> '+esc(e.father));
        if (e.mother) parts.push('<span style="font-size:.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.03em;">Mother</span> '+esc(e.mother));
        if (e.sponsors) parts.push('<span style="font-size:.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.03em;">Sponsors</span> '+esc(e.sponsors));
        if (!parts.length && e.name2) parts.push(esc(e.name2));
        familyPart = parts.length ? parts.join('<br>') : '<span style="color:var(--faint);">\u2014</span>';
      } else {
        familyPart = e.name2 ? esc(e.name2) : '<span style="color:var(--faint);">\u2014</span>';
      }
      // Officiant + record_type badge
      var rtBadge = (e.record_type && hasExtended) ? '<span style="display:inline-block;font-size:.68rem;padding:1px 6px;border-radius:4px;background:var(--linen);color:var(--warm-gray);margin-bottom:3px;">'+esc(e.record_type)+'</span><br>' : '';
      var officPart = e.officiant ? esc(e.officiant) : '<span style="color:var(--faint);">\u2014</span>';
      var pdfPart = e.pdf_page ? '<br><span style="font-size:.72rem;color:var(--faint);">p.'+esc(e.pdf_page)+'</span>' : '';
      return '<tr>'
        + '<td style="white-space:nowrap;color:var(--warm-gray);width:96px;">'+dateDisp+placeDisp+'</td>'
        + '<td>'+namePart+'</td>'
        + '<td style="font-size:.85rem;">'+familyPart+'</td>'
        + '<td style="font-size:.85rem;">'+rtBadge+officPart+pdfPart+'</td>'
        + '<td style="white-space:nowrap;text-align:right;">'
        + '<button class="reg-edit-btn" onclick="openRegisterEdit('+e.id+')" title="Edit">Edit</button>'
        + '<button class="del-entry" onclick="deleteRegisterEntry('+e.id+')" title="Delete">&#215;</button>'
        + '</td>'
        + '</tr>';
    }).join('');
    var famHeader = hasExtended ? 'Family' : esc(lbl.col2);
    html += '<div class="reg-year-hdr">'+yr+' <span style="font-weight:400;color:var(--faint);">('+grp.length+')</span></div>'
      + '<table class="reg-table" style="margin-top:8px;">'
      + '<thead><tr><th>Date</th><th>'+esc(lbl.nameLbl)+'</th><th>'+famHeader+'</th><th>Officiant</th><th></th></tr></thead>'
      + '<tbody>'+rows+'</tbody></table>';
  });
  el.innerHTML = html;
}
function saveRegisterEntry() {
  var date      = document.getElementById('reg-date').value;
  var name      = document.getElementById('reg-name').value.trim();
  var name2     = document.getElementById('reg-name2').value.trim();
  var officiant = document.getElementById('reg-officiant').value.trim();
  var notes     = document.getElementById('reg-notes').value.trim();
  if (!name) { alert('Name is required.'); return; }
  var isEdit = !!_regEditId;
  var url    = isEdit ? '/admin/api/register/' + _regEditId : '/admin/api/register';
  var method = isEdit ? 'PUT' : 'POST';
  var body   = {event_date: date, name: name, name2: name2, officiant: officiant, notes: notes};
  if (!isEdit) body.type = _regType;
  api(url, {method: method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)}).then(function(r) {
    if (r.ok) {
      _regEditId = null;
      clearRegForm();
      var ft = document.getElementById('reg-form-title'); if (ft) ft.textContent = 'Add ' + _regLabels[_regType].title.slice(0,-1);
      var sb = document.getElementById('reg-save-btn');   if (sb) sb.textContent = 'Add Entry';
      var cb = document.getElementById('reg-cancel-btn'); if (cb) cb.style.display = 'none';
      loadRegister();
    } else alert('Error: ' + (r.error||'unknown'));
  });
}
function openRegisterEdit(id) {
  var entry = _regEntries.find(function(e){ return e.id === id; });
  if (!entry) return;
  _regEditId = id;
  document.getElementById('reg-date').value      = entry.event_date || '';
  document.getElementById('reg-name').value      = entry.name || '';
  document.getElementById('reg-name2').value     = entry.name2 || '';
  document.getElementById('reg-officiant').value = entry.officiant || '';
  document.getElementById('reg-notes').value     = entry.notes || '';
  var ft = document.getElementById('reg-form-title'); if (ft) ft.textContent = 'Edit Entry';
  var sb = document.getElementById('reg-save-btn');   if (sb) sb.textContent = 'Save Changes';
  var cb = document.getElementById('reg-cancel-btn'); if (cb) cb.style.display = '';
  // Ensure form is visible (mobile)
  var fp = document.getElementById('reg-form-panel'); if (fp) fp.style.display = '';
  document.getElementById('reg-name').focus();
}
function cancelRegisterEdit() {
  _regEditId = null;
  clearRegForm();
  var ft = document.getElementById('reg-form-title'); if (ft) ft.textContent = 'Add ' + _regLabels[_regType].title.slice(0,-1);
  var sb = document.getElementById('reg-save-btn');   if (sb) sb.textContent = 'Add Entry';
  var cb = document.getElementById('reg-cancel-btn'); if (cb) cb.style.display = 'none';
}
function deleteRegisterEntry(id) {
  if (!confirm('Delete this register entry? This cannot be undone.')) return;
  api('/admin/api/register/' + id, {method:'DELETE'}).then(function(r) {
    if (r.ok) loadRegister();
    else alert(r.error || 'Cannot delete.');
  });
}
function printRegister() {
  var lbl = _regLabels[_regType];
  var search = (document.getElementById('reg-search') ? document.getElementById('reg-search').value : '').toLowerCase().trim();
  var year   = document.getElementById('reg-year-filter') ? document.getElementById('reg-year-filter').value : '';
  var entries = _regEntries.filter(function(e) {
    if (year && (e.event_date||'').slice(0,4) !== year) return false;
    if (search) {
      var hay = (e.name+' '+(e.name2||'')+' '+(e.officiant||'')).toLowerCase();
      var tokens = search.split(/\s+/).filter(Boolean);
      if (!tokens.every(function(t){ return hay.indexOf(t) >= 0; })) return false;
    }
    return true;
  });
  var hasExtended = entries.some(function(e){ return e.father||e.mother||e.sponsors||e.dob||e.baptism_place; });
  var byYear = {}; var yearOrder = [];
  entries.forEach(function(e) {
    var yr = (e.event_date||'').slice(0,4)||'\u2014';
    if (!byYear[yr]) { byYear[yr] = []; yearOrder.push(yr); }
    byYear[yr].push(e);
  });
  var colSpan = hasExtended ? '9' : '5';
  var thead = hasExtended
    ? '<tr><th>#</th><th>Baptism Date</th><th>Name</th><th>DOB</th><th>Father</th><th>Mother</th><th>Sponsors / Remarks</th><th>Officiant</th><th>Place</th></tr>'
    : '<tr><th>#</th><th>Date</th><th>'+lbl.nameLbl+'</th><th>'+lbl.col2+'</th><th>Officiant</th></tr>';
  var tableRows = '';
  yearOrder.forEach(function(yr) {
    tableRows += '<tr class="yr-hdr"><td colspan="'+colSpan+'">'+yr+'</td></tr>';
    byYear[yr].forEach(function(e, i) {
      if (hasExtended) {
        tableRows += '<tr>'
          +'<td style="color:#999;">'+(i+1)+'</td>'
          +'<td>'+(e.event_date||'\u2014')+'</td>'
          +'<td><strong>'+(e.name||'\u2014')+'</strong>'+(e.record_type?'<br><small>'+e.record_type+'</small>':'')+'</td>'
          +'<td>'+(e.dob||'\u2014')+(e.place_of_birth?'<br><small>'+e.place_of_birth+'</small>':'')+'</td>'
          +'<td>'+(e.father||'\u2014')+'</td>'
          +'<td>'+(e.mother||'\u2014')+'</td>'
          +'<td>'+(e.sponsors||e.name2||'\u2014')+(e.notes?'<br><em>'+e.notes+'</em>':'')+'</td>'
          +'<td>'+(e.officiant||'\u2014')+'</td>'
          +'<td>'+(e.baptism_place||'\u2014')+(e.pdf_page?'<br><small>p.'+e.pdf_page+'</small>':'')+'</td>'
          +'</tr>';
      } else {
        tableRows += '<tr>'
          +'<td style="color:#999;">'+(i+1)+'</td>'
          +'<td>'+(e.event_date||'\u2014')+'</td>'
          +'<td><strong>'+(e.name||'\u2014')+'</strong></td>'
          +'<td>'+(e.name2||'\u2014')+'</td>'
          +'<td>'+(e.officiant||'\u2014')+(e.notes?'<br><em style="font-size:.8em;color:#666">'+e.notes+'</em>':'')+'</td>'
          +'</tr>';
      }
    });
  });
  var churchName = '';
  var cn = document.getElementById('settings-church-name'); if (cn) churchName = cn.value||'';
  var printWin = window.open('', '_blank', 'width=1100,height=900');
  printWin.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>'+lbl.title+' Register</title>'
    +'<style>body{font-family:Georgia,serif;font-size:10pt;margin:0;padding:24px 32px;}h1{font-size:16pt;margin:0 0 2px;}h2{font-size:10pt;font-weight:normal;color:#666;margin:0 0 20px;}'
    +'table{width:100%;border-collapse:collapse;font-size:8.5pt;}th{border-bottom:2px solid #222;padding:5px 6px;text-align:left;background:#f9f9f9;}td{padding:5px 6px;border-bottom:1px solid #e0e0e0;vertical-align:top;}'
    +'.yr-hdr td{background:#eeeeee;font-weight:bold;font-size:9pt;letter-spacing:.05em;padding:7px 6px 4px;border-bottom:1px solid #bbb;}'
    +'small{font-size:7.5pt;color:#777;}em{color:#555;}'
    +'@media print{body{padding:0;}.no-print{display:none;}@page{size:landscape;}}</style></head><body>'
    +'<div class="no-print" style="margin-bottom:16px;"><button onclick="window.print()">&#128424; Print</button></div>'
    +'<h1>'+(churchName ? churchName+' \u2014 ' : '')+lbl.title+' Register</h1>'
    +'<h2>'+(year||'All Years')+' \u00b7 '+entries.length+' '+(entries.length===1?'entry':'entries')+'</h2>'
    +'<table><thead>'+thead+'</thead><tbody>'+tableRows+'</tbody></table>'
    +'</body></html>');
  printWin.document.close();
}

// ── REGISTER IMPORT ──────────────────────────────────────────────────
var _regImportRows = [];   // parsed rows ready to import
var _regImportHeaders = {
  baptism: [
    'Entry No.', 'Record Type', 'First Names', 'Surname',
    'Date of Birth', 'Place of Birth', 'Baptism Date', 'Baptism Place',
    'Father', 'Mother', 'Sponsors / Remarks', 'Officiant', 'Notes', 'PDF Page'
  ],
  confirmation: [
    'Entry No.', 'Full Name', 'Confirmation Date', 'Type', 'Remarks / Notes'
  ]
};
function updateRegImportHeaders() {
  var sel = document.getElementById('reg-import-type');
  var box = document.getElementById('reg-import-headers');
  if (!sel || !box) return;
  var cols = _regImportHeaders[sel.value] || _regImportHeaders.baptism;
  box.innerHTML = cols.map(function(c) { return '<strong>'+esc(c)+'</strong>'; }).join(' &nbsp;&#183;&nbsp; ');
}
function openRegImport() {
  var sel = document.getElementById('reg-import-type');
  if (sel) sel.value = _regType;
  updateRegImportHeaders();
  showRegImportStep(1);
  document.getElementById('reg-import-modal').style.display = 'flex';
}
function closeRegImport() {
  document.getElementById('reg-import-modal').style.display = 'none';
  resetRegImport();
}
function resetRegImport() {
  _regImportRows = [];
  var fi = document.getElementById('reg-import-file'); if (fi) fi.value = '';
  var fn = document.getElementById('reg-import-filename'); if (fn) fn.textContent = '';
  showRegImportStep(1);
}
function showRegImportStep(n) {
  [1,2,3].forEach(function(i){
    var el = document.getElementById('reg-import-step'+i);
    if (el) el.style.display = (i===n) ? '' : 'none';
  });
}
function regImportFileChosen(input) {
  var file = input.files[0];
  if (!file) return;
  var fn = document.getElementById('reg-import-filename');
  if (fn) fn.textContent = file.name;
  var reader = new FileReader();
  reader.onload = function(ev) {
    try {
      var parsed = parseRegImportFile(ev.target.result, file.name);
      if (parsed.error) { alert(parsed.error); return; }
      _regImportRows = parsed.rows;
      showRegImportPreview(parsed);
    } catch(err) { alert('Parse error: ' + err.message); }
  };
  reader.readAsText(file, 'UTF-8');
}
function parseRegImportFile(text, filename) {
  // Detect delimiter: if splitting first line by tab gives 5+ fields, use tab
  var lines = text.replace(/\\r\\n/g,'\\n').replace(/\\r/g,'\\n').split('\\n').filter(function(l){ return l.trim(); });
  if (lines.length < 2) return { error: 'File has fewer than 2 lines — need a header row and at least one data row.' };
  var delim = lines[0].split('\\t').length >= 5 ? '\\t' : ',';
  function parseLine(line) {
    if (delim === '\\t') return line.split('\\t').map(function(c){ return c.trim(); });
    // CSV: handle quoted fields
    var cols = [], cur = '', inQ = false;
    for (var ci = 0; ci < line.length; ci++) {
      var ch = line[ci];
      if (ch === '"' && !inQ) { inQ = true; }
      else if (ch === '"' && inQ && line[ci+1] === '"') { cur += '"'; ci++; }
      else if (ch === '"' && inQ) { inQ = false; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cols.push(cur.trim());
    return cols;
  }
  var headers = parseLine(lines[0]).map(function(h){ return h.toLowerCase().replace(/[^a-z0-9]/g,' ').trim().replace(/\\s+/g,' '); });
  function col(names) {
    var norm = function(s) { return s.toLowerCase().replace(/[^a-z0-9]/g,' ').trim().replace(/\\s+/g,' '); };
    for (var ni = 0; ni < names.length; ni++) {
      var idx = headers.indexOf(norm(names[ni]));
      if (idx >= 0) return idx;
    }
    return -1;
  }
  var colMap = {
    entry_no:       col(['entry no', 'entry no.', '#', 'no', 'no.']),
    record_type:    col(['record type','type']),
    first_names:    col(['first names','first name','firstname','given names','given name','first name s','christian name','christian names','forename','forenames','baptismal name','baptized name','name of child','child']),
    surname:        col(['surname','last name','lastname','family name']),
    dob:            col(['date of birth','dob','birth date','birthdate']),
    place_of_birth: col(['place of birth','birthplace','birth place']),
    event_date:     col(['baptism date','confirmation date','wedding date','event date','date']),
    baptism_place:  col(['baptism place','place','location','church','baptism location']),
    father:         col(['father']),
    mother:         col(['mother']),
    sponsors:       col(['sponsors   remarks','sponsors / remarks','sponsors/remarks','sponsors remarks','sponsors witnesses','sponsors / witnesses','sponsors','godparents','witnesses','remarks']),
    officiant:      col(['officiant','pastor','minister','priest','celebrant']),
    notes:          col(['notes','note','comments','remarks notes','remarks / notes','remarks/notes','remarks']),
    pdf_page:       col(['pdf page','page','pdf'])
  };
  var missing = [];
  if (colMap.first_names < 0 && colMap.surname < 0 && headers.indexOf('name') < 0 && headers.indexOf('full name') < 0) missing.push('Name column (First Names + Surname, or Name)');
  if (colMap.first_names < 0 && colMap.surname >= 0) missing.push('First Names column (found Surname but no First Names/Given Name — names will be surnames only)');
  if (colMap.event_date < 0) missing.push('Date column (Baptism Date or Date)');
  var regType = document.getElementById('reg-import-type') ? document.getElementById('reg-import-type').value : 'baptism';
  var rows = [];
  var skipped = 0;
  for (var li = 1; li < lines.length; li++) {
    var cols = parseLine(lines[li]);
    if (cols.every(function(c){ return !c; })) { skipped++; continue; }
    var g = function(idx) { return (idx >= 0 && idx < cols.length) ? cols[idx] : ''; };
    var firstName = g(colMap.first_names), surname = g(colMap.surname);
    var nameCol = headers.indexOf('name');
    if (nameCol < 0) nameCol = headers.indexOf('full name');
    var fullName = (firstName || surname)
      ? (firstName + (firstName && surname ? ' ' : '') + surname).trim()
      : g(nameCol);
    var rawDate = g(colMap.event_date);
    rows.push({
      type:           regType,
      name:           fullName,
      name2:          g(colMap.sponsors),
      officiant:      g(colMap.officiant),
      notes:          g(colMap.notes),
      record_type:    g(colMap.record_type),
      dob:            normalizeRegDate(g(colMap.dob)),
      place_of_birth: g(colMap.place_of_birth),
      event_date:     normalizeRegDate(rawDate),
      baptism_place:  g(colMap.baptism_place),
      father:         g(colMap.father),
      mother:         g(colMap.mother),
      sponsors:       g(colMap.sponsors),
      pdf_page:       g(colMap.pdf_page)
    });
  }
  return { rows: rows, headers: headers, colMap: colMap, skipped: skipped, missing: missing, delim: delim };
}
function normalizeRegDate(s) {
  if (!s) return '';
  s = s.trim();
  // Already ISO YYYY-MM-DD
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(s)) return s;
  // Already ISO YYYY-MM → use 01 as day
  if (/^\\d{4}-\\d{2}$/.test(s)) return s+'-01';
  var MONTHS = {
    january:'01',jan:'01',february:'02',feb:'02',march:'03',mar:'03',
    april:'04',apr:'04',may:'05',june:'06',jun:'06',july:'07',jul:'07',
    august:'08',aug:'08',september:'09',sept:'09',sep:'09',
    october:'10',oct:'10',november:'11',nov:'11',december:'12',dec:'12'
  };
  var m;
  // MM/DD/YYYY or M-D-YYYY (slash or dash separator, year last)
  m = s.match(/^(\\d{1,2})[\\/-](\\d{1,2})[\\/-](\\d{4})$/);
  if (m) return m[3]+'-'+pad2(m[1])+'-'+pad2(m[2]);
  // MM/DD/YY or M-D-YY (2-digit year → 19xx for historical records)
  m = s.match(/^(\\d{1,2})[\\/-](\\d{1,2})[\\/-](\\d{2})$/);
  if (m) return '19'+m[3]+'-'+pad2(m[1])+'-'+pad2(m[2]);
  // Month D(st/nd/rd/th)?, YYYY  e.g. "July 1, 1928" or "July 1st, 1928"
  m = s.match(/^([A-Za-z]+)\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return m[3]+'-'+MONTHS[m[1].toLowerCase()]+'-'+pad2(m[2]);
  // D(st/nd/rd/th)? Month YYYY  e.g. "1 July 1928" or "1st July 1928"
  m = s.match(/^(\\d{1,2})(?:st|nd|rd|th)?\\s+([A-Za-z]+)\\.?\\s+(\\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return m[3]+'-'+MONTHS[m[2].toLowerCase()]+'-'+pad2(m[1]);
  // Month YYYY  e.g. "July 1928" (no day — store as 1st of month)
  m = s.match(/^([A-Za-z]+)\\.?\\s+(\\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return m[2]+'-'+MONTHS[m[1].toLowerCase()]+'-01';
  // YYYY only — store as Jan 1 of that year
  m = s.match(/^(\\d{4})$/);
  if (m) return m[1]+'-01-01';
  return s;
}
function pad2(n) { return String(n).padStart(2,'0'); }
function showRegImportPreview(parsed) {
  var rows = parsed.rows;
  var cnt = document.getElementById('reg-import-count'); if (cnt) cnt.textContent = rows.length;
  var sum = document.getElementById('reg-import-summary');
  if (sum) sum.innerHTML = (rows.length === 0
    ? '<span style="color:var(--danger);font-weight:600;">No data rows detected. Check that the file has a header row and data rows, and that the delimiter is tab or comma.</span>'
    : '<strong>'+rows.length+'</strong> rows detected'
      + (parsed.skipped ? ' (<em>'+parsed.skipped+' blank rows skipped</em>)' : '')
      + ' — showing first 5 as preview. '
      + (parsed.missing.length ? '<span style="color:var(--danger);">Warning: could not find columns: <strong>'+parsed.missing.join(', ')+'</strong></span>' : ''));
  // Build preview table
  var previewCols = ['name','event_date','dob','father','mother','sponsors','officiant','baptism_place'];
  var thead = document.getElementById('reg-import-preview-head');
  var tbody = document.getElementById('reg-import-preview-body');
  if (thead) thead.innerHTML = '<tr>'+previewCols.map(function(c){ return '<th style="padding:5px 8px;text-align:left;font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;">'+c.replace(/_/g,' ')+'</th>'; }).join('')+'</tr>';
  if (tbody) tbody.innerHTML = rows.slice(0,5).map(function(r) {
    return '<tr>'+previewCols.map(function(c){
      return '<td style="padding:5px 8px;border-bottom:1px solid var(--border);max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+(r[c]?esc(r[c]):'<span style="color:var(--faint);">\u2014</span>')+'</td>';
    }).join('')+'</tr>';
  }).join('');
  var warn = document.getElementById('reg-import-warn');
  if (warn) { warn.style.display = parsed.missing.length ? '' : 'none'; warn.textContent = parsed.missing.length ? 'Some columns were not found — those fields will be left blank.' : ''; }
  showRegImportStep(2);
}
function runRegImport() {
  if (!_regImportRows.length) {
    var sum = document.getElementById('reg-import-summary');
    if (sum) sum.innerHTML = '<span style="color:var(--danger);font-weight:600;">No rows to import — please select a file with data rows first.</span>';
    return;
  }
  var prog = document.getElementById('reg-import-progress');
  var btn  = document.querySelector('#reg-import-step2 .btn-primary');
  if (prog) { prog.style.display = ''; prog.textContent = 'Importing\u2026'; }
  if (btn) btn.disabled = true;
  var regType = document.getElementById('reg-import-type') ? document.getElementById('reg-import-type').value : 'baptism';
  var clearFirst = document.getElementById('reg-import-clear') && document.getElementById('reg-import-clear').checked;
  function doImport() {
  // Send in chunks of 50
  var allRows = _regImportRows.slice();
  var CHUNK = 50;
  var chunks = [];
  for (var i = 0; i < allRows.length; i += CHUNK) chunks.push(allRows.slice(i, i+CHUNK));
  var totalImported = 0, totalErrors = 0, lastApiErr = '';
  function sendChunk(idx) {
    if (idx >= chunks.length) {
      if (prog) prog.style.display = 'none';
      if (btn) btn.disabled = false;
      var doneMsg = document.getElementById('reg-import-done-msg');
      var doneSub = document.getElementById('reg-import-done-sub');
      if (doneMsg) doneMsg.textContent = totalImported + ' records imported successfully';
      if (doneSub) {
        var sub = totalErrors ? totalErrors+' rows had errors and were skipped.' : 'All records were saved to the register.';
        if (lastApiErr) sub += ' Last API error: ' + lastApiErr;
        doneSub.textContent = sub;
      }
      showRegImportStep(3);
      if (totalImported > 0) loadRegister();
      return;
    }
    if (prog) prog.textContent = 'Importing '+Math.min((idx+1)*CHUNK, allRows.length)+' of '+allRows.length+'\u2026';
    api('/admin/api/register/batch', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(chunks[idx])
    }).then(function(r) {
      if (r.error) { lastApiErr = r.error; totalErrors += chunks[idx].length; }
      else { totalImported += (r.imported||0); totalErrors += (r.errors||0); }
      sendChunk(idx+1);
    }).catch(function(err) {
      lastApiErr = err ? (err.message||String(err)) : 'network error';
      totalErrors += chunks[idx].length;
      sendChunk(idx+1);
    });
  }
  sendChunk(0);
  } // end doImport
  if (clearFirst) {
    if (prog) prog.textContent = 'Clearing existing records\u2026';
    api('/admin/api/register/clear', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({type: regType})
    }).then(function() { doImport(); }).catch(function() { doImport(); });
  } else {
    doImport();
  }
}

// ── HOUSEHOLDS ────────────────────────────────────────────────────────
function debounceHouseholds() {
  clearTimeout(_hDebounce);
  _hDebounce = setTimeout(function() { loadHouseholds(true); }, 300);
}
function loadHouseholds(resetPage) {
  if (resetPage) _hhOffset = 0;
  var q = document.getElementById('h-search').value;
  var sort = (document.getElementById('h-sort') || {value:'name'}).value;
  setStatus('h-status', 'Loading…');
  api('/admin/api/households?q=' + encodeURIComponent(q) + '&sort=' + sort + '&limit=50&offset=' + _hhOffset).then(function(d) {
    setStatus('h-status', '');
    _hhTotal = d.total || 0;
    renderHouseholds(d.households || []);
    renderHouseholdPager();
  });
}
function renderHouseholdPager() {
  var el = document.getElementById('h-pager');
  if (!el) return;
  var limit = 50, offset = _hhOffset, total = _hhTotal;
  if (total <= limit) { el.innerHTML = '<span style="color:var(--warm-gray);font-size:.82rem;">' + total + ' household' + (total !== 1 ? 's' : '') + '</span>'; return; }
  var from = offset + 1, to = Math.min(offset + limit, total);
  el.innerHTML = '<button class="btn-secondary" style="padding:4px 10px;font-size:.8rem;" onclick="hhPage(-1)" ' + (offset===0?'disabled':'') + '>&#8592; Prev</button>'
    + '<span style="font-size:.82rem;color:var(--warm-gray);margin:0 10px;">' + from + '–' + to + ' of ' + total + '</span>'
    + '<button class="btn-secondary" style="padding:4px 10px;font-size:.8rem;" onclick="hhPage(1)" ' + (to>=total?'disabled':'') + '>Next &#8594;</button>';
}
function hhPage(dir) {
  _hhOffset = Math.max(0, _hhOffset + dir * 50);
  loadHouseholds();
}
function renderHouseholds(rows) {
  var c = document.getElementById('h-grid');
  if (!rows.length) { c.innerHTML = '<div class="empty"><div class="empty-icon">&#127968;</div>No households found</div>'; return; }
  c.innerHTML = rows.map(function(h) {
    var addr = [h.address1, h.city, h.state].filter(Boolean).join(', ');
    var photo = h.photo_url ? '<img src="'+esc(photoSrc(h.photo_url))+'" alt="" style="width:100%;height:80px;object-fit:cover;border-radius:6px 6px 0 0;display:block;" onerror="this.style.display=\'none\'">' : '';
    return '<div class="h-card" onclick="openHouseholdDetail(' + h.id + ')" style="padding:0;overflow:hidden;">'
      + photo
      + '<div style="padding:10px 12px;">'
      + '<div class="h-name">' + esc(h.name) + '</div>'
      + (addr ? '<div class="h-addr">' + esc(addr) + '</div>' : '')
      + '<div style="font-size:.78rem;color:var(--warm-gray);">' + (h.member_count||0) + ' member' + (h.member_count !== 1 ? 's' : '') + '</div>'
      + '</div></div>';
  }).join('');
}
function openHouseholdDetail(id) {
  api('/admin/api/households/' + id).then(function(h) {
    var members = h.members || [];
    var addr = [h.address1, h.city, h.state && h.zip ? h.state + ' ' + h.zip : (h.state || h.zip || '')].filter(Boolean).join(', ');
    var roleOrder = {head:0, spouse:1, child:2, other:3};
    members.sort(function(a,b){ return (roleOrder[a.family_role]??4)-(roleOrder[b.family_role]??4) || (a.last_name||'').localeCompare(b.last_name||''); });
    var memberRows = members.length ? members.map(function(m) {
      var role = m.family_role ? '<span style="font-size:.72rem;color:var(--warm-gray);margin-left:6px;text-transform:capitalize;">'+esc(m.family_role)+'</span>' : '';
      var contact = [m.phone, m.email].filter(Boolean).map(esc).join(' · ');
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);">'
        +'<div><span style="font-weight:500;cursor:pointer;color:var(--steel-anchor);" onclick="closeModal(\'hh-detail-modal\');openPersonDetail('+m.id+')">'+esc((m.first_name||'')+' '+(m.last_name||''))+'</span>'+role
        +(contact ? '<div style="font-size:.78rem;color:var(--warm-gray);margin-top:2px;">'+contact+'</div>' : '')
        +'</div></div>';
    }).join('') : '<div style="color:var(--warm-gray);font-size:.88rem;padding:10px 0;">No members</div>';
    var el = document.getElementById('hh-detail-body');
    if (!el) return;
    var photoHtml = '';
    if (h.photo_url) {
      photoHtml = '<img src="'+esc(photoSrc(h.photo_url))+'" alt="'+esc(h.name)+'" style="width:100%;max-height:180px;object-fit:cover;border-radius:8px;margin-bottom:12px;" onerror="this.style.display=\'none\'">';
    }
    el.innerHTML = photoHtml
      +'<div style="margin-bottom:12px;">'
      +'<div style="font-size:1.1rem;font-weight:600;margin-bottom:4px;">'+esc(h.name)+'</div>'
      +(addr ? '<div style="font-size:.85rem;color:var(--warm-gray);">'+esc(addr)+'</div>' : '')
      +(h.notes ? '<div style="font-size:.82rem;color:var(--charcoal);margin-top:8px;padding:8px;background:var(--linen);border-radius:6px;">'+esc(h.notes)+'</div>' : '')
      +'</div>'
      +'<div style="font-size:.78rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--warm-gray);margin-bottom:4px;">Members ('+members.length+')</div>'
      +memberRows
      +'<div style="display:flex;gap:8px;margin-top:16px;">'
      +'<button class="btn-secondary require-edit" onclick="closeModal(\'hh-detail-modal\');editHouseholdById('+h.id+')">Edit Household</button>'
      +'</div>';
    openModal('hh-detail-modal');
  });
}
function editHouseholdById(id) {
  api('/admin/api/households/' + id).then(function(h) { openHouseholdEdit(h); });
}
function openHouseholdEdit(h) {
  var isNew = !h || !h.id;
  document.getElementById('hh-modal-title').textContent = isNew ? 'New Household' : h.name;
  document.getElementById('hm-id').value = isNew ? '' : h.id;
  document.getElementById('hm-name').value = isNew ? '' : (h.name||'');
  document.getElementById('hm-addr1').value = isNew ? '' : (h.address1||'');
  document.getElementById('hm-addr2').value = isNew ? '' : (h.address2||'');
  document.getElementById('hm-city').value = isNew ? '' : (h.city||'');
  document.getElementById('hm-state').value = isNew ? 'MO' : (h.state||'MO');
  document.getElementById('hm-zip').value = isNew ? '' : (h.zip||'');
  document.getElementById('hm-notes').value = isNew ? '' : (h.notes||'');
  document.getElementById('hm-photo').value = isNew ? '' : (h.photo_url||'');
  document.getElementById('hm-del-btn').style.display = isNew ? 'none' : 'inline-flex';
  var mc = document.getElementById('hm-members');
  if (h && h.members && h.members.length) {
    mc.innerHTML = '<div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--warm-gray);margin-bottom:6px;">Members</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px;">'
      + h.members.map(function(m) {
        return '<span class="h-member-pill" style="cursor:pointer;" onclick="closeModal(&#39;hh-modal&#39;);openPersonDetail(' + m.id + ')">'
          + esc(m.first_name) + ' ' + esc(m.last_name) + ' (' + esc(m.family_role||'—') + ')</span>';
      }).join('') + '</div>';
  } else { mc.innerHTML = ''; }
  openModal('hh-modal');
}
function saveHousehold() {
  var id = document.getElementById('hm-id').value;
  var data = {
    name: document.getElementById('hm-name').value.trim(),
    address1: document.getElementById('hm-addr1').value.trim(),
    address2: document.getElementById('hm-addr2').value.trim(),
    city: document.getElementById('hm-city').value.trim(),
    state: document.getElementById('hm-state').value.trim(),
    zip: document.getElementById('hm-zip').value.trim(),
    notes: document.getElementById('hm-notes').value,
    photo_url: document.getElementById('hm-photo').value.trim()
  };
  if (!data.name) { alert('Family name is required.'); return; }
  var url = id ? '/admin/api/households/' + id : '/admin/api/households';
  var meth = id ? 'PUT' : 'POST';
  api(url, {method:meth, headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)}).then(function(r) {
    if (r.ok) { closeModal('hh-modal'); loadHouseholds(); }
    else alert('Error: ' + (r.error||'unknown'));
  });
}
function deleteHousehold() {
  var id = document.getElementById('hm-id').value;
  if (!confirm('Delete this household?')) return;
  api('/admin/api/households/' + id, {method:'DELETE'}).then(function(r) {
    if (r.ok) { closeModal('hh-modal'); loadHouseholds(); }
    else alert(r.error || 'Cannot delete.');
  });
}

// ── HOUSEHOLD AUTOCOMPLETE (in person modal) ──────────────────────────
function acHouseholdSearch() {
  var q = document.getElementById('pm-hh-search').value;
  var ac = document.getElementById('pm-hh-ac');
  if (q.length < 1) { ac.classList.remove('open'); return; }
  api('/admin/api/households?q=' + encodeURIComponent(q)).then(function(d) {
    var rows = d.households || [];
    ac.innerHTML = rows.slice(0,8).map(function(h) {
      return '<div class="ac-item" onclick="selectHousehold(' + h.id + ',&#39;' + esc(h.name) + '&#39;)">' + esc(h.name) + '</div>';
    }).join('') + '<div class="ac-item" style="color:var(--sage);" onclick="createHouseholdFromPerson()">+ Create new household…</div>';
    ac.classList.toggle('open', rows.length > 0 || true);
  });
}
function selectHousehold(id, name) {
  document.getElementById('pm-hh-id').value = id;
  document.getElementById('pm-hh-search').value = name;
  document.getElementById('pm-hh-ac').classList.remove('open');
}
function createHouseholdFromPerson() {
  var last = document.getElementById('pm-last').value.trim();
  var name = last ? last + ' Family' : '';
  document.getElementById('pm-hh-search').value = name;
  document.getElementById('pm-hh-ac').classList.remove('open');
  // Will be created on save if needed — for now just note it
  alert('Enter this household name then save the person. You can create the household record separately in the Households tab.');
}

// ── PERSON AUTOCOMPLETE (for reports/giving) ──────────────────────────
function acSearch(input, dropId, hidId) {
  var q = input.value;
  var ac = document.getElementById(dropId);
  if (q.length < 2) { ac.classList.remove('open'); return; }
  api('/admin/api/people?q=' + encodeURIComponent(q)).then(function(d) {
    var rows = (d.people||[]).slice(0,10);
    ac.innerHTML = rows.map(function(p) {
      var n = esc(p.last_name) + ', ' + esc(p.first_name);
      return '<div class="ac-item" onclick="selectPerson(this,&#39;' + hidId + '&#39;,&#39;' + dropId + '&#39;,' + p.id + ',&#39;' + n.replace(/'/g,'&#39;') + '&#39;)">' + n + '</div>';
    }).join('');
    ac.classList.toggle('open', rows.length > 0);
  });
}
function selectPerson(el, hidId, dropId, id, name) {
  document.getElementById(hidId).value = id;
  el.closest('.ac-wrap').querySelector('input[type=text]').value = name;
  document.getElementById(dropId).classList.remove('open');
}
</script>
<script>
// ── GIVING ────────────────────────────────────────────────────────────
var _batchFilter = 'all';
function setBatchFilter(btn, val) {
  document.querySelectorAll('[data-bs]').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  _batchFilter = val;
  loadBatches();
}
function loadBatches() {
  api('/admin/api/giving/batches?status=' + _batchFilter).then(function(d) {
    renderBatchList(d.batches || []);
  });
}
function filterBatchSearch(val) {
  _batchSearch = (val||'').toLowerCase().trim();
  loadBatches();
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
  api('/admin/api/giving/batches/' + id).then(function(b) { renderBatchDetail(b); });
}
function renderBatchDetail(b) {
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
  api('/admin/api/giving/batches/' + id).then(function(b) {
    api('/admin/api/giving/batches/' + id, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({closed:1,batch_date:b.batch_date,description:b.description})}).then(function() {
      openBatch(id); loadBatches();
    });
  });
}
function reopenBatch(id) {
  if (!confirm('Reopen this batch?')) return;
  api('/admin/api/giving/batches/' + id).then(function(b) {
    api('/admin/api/giving/batches/' + id, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({closed:0,batch_date:b.batch_date,description:b.description})}).then(function() {
      openBatch(id); loadBatches();
    });
  });
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

// ── REPORTS ────────────────────────────────────────────────────────────
function initReports() {
  // Nothing to auto-load
}
function showRptOutput(html) {
  var o = document.getElementById('rpt-output');
  o.innerHTML = html;
  o.classList.add('visible');
  o.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function showAttRptOutput(html) {
  var o = document.getElementById('att-rpt-output');
  if (!o) return;
  o.innerHTML = html;
  o.style.display = 'block';
  o.scrollIntoView({behavior:'smooth', block:'nearest'});
}
function runMembership() {
  api('/admin/api/reports/membership').then(function(d) {
    var rows = (d.counts||[]).map(function(r) {
      return '<tr><td>' + esc(r.member_type||'—') + '</td><td style="text-align:right;">' + r.n + '</td></tr>';
    }).join('');
    var tagRows = (d.tag_counts||[]).map(function(r) {
      return '<tr><td>' + esc(r.name) + '</td><td style="text-align:right;">' + r.n + '</td></tr>';
    }).join('');
    showRptOutput(
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
      + '<h3 style="font-family:var(--font-head);color:var(--steel-anchor);">Membership Summary</h3>'
      + '<button class="btn-secondary" style="font-size:.8rem;padding:4px 10px;" onclick="window.print()">Print</button></div>'
      + '<table class="rpt-table"><thead><tr><th>Member Type</th><th style="text-align:right;">Count</th></tr></thead><tbody>'
      + rows
      + '<tr class="rpt-total"><td>Total</td><td style="text-align:right;">' + (d.total||0) + '</td></tr>'
      + '</tbody></table>'
      + (tagRows ? '<h4 style="margin:20px 0 8px;font-family:var(--font-head);color:var(--steel-anchor);font-size:.95rem;">By Tag</h4>'
        + '<table class="rpt-table"><thead><tr><th>Tag</th><th style="text-align:right;">People</th></tr></thead><tbody>' + tagRows + '</tbody></table>' : '')
    );
  });
}
function runGivingByMethod() {
  var from = document.getElementById('rpt-method-from').value;
  var to   = document.getElementById('rpt-method-to').value;
  if (!from || !to) { alert('Please select a date range.'); return; }
  api('/admin/api/reports/giving-by-method?from=' + from + '&to=' + to).then(function(d) {
    var labels = { cash:'Cash', check:'Check', card:'Card / Online', ach:'ACH / Bank', other:'Other' };
    var rows = (d.rows||[]).map(function(r) {
      return '<tr><td>' + esc(labels[r.method] || r.method || 'Unknown') + '</td><td style="text-align:right;">' + (r.contributions||0) + '</td><td style="text-align:right;">' + fmtMoney(r.total_cents||0) + '</td></tr>';
    }).join('');
    showRptOutput(
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
      + '<h3 style="font-family:var(--font-head);color:var(--steel-anchor);">Giving by Method: ' + esc(fmtDate(from)) + ' \u2013 ' + esc(fmtDate(to)) + '</h3>'
      + '<button class="btn-secondary" style="font-size:.8rem;padding:4px 10px;" onclick="window.print()">Print</button></div>'
      + '<table class="rpt-table"><thead><tr><th>Method</th><th style="text-align:right;">Gifts</th><th style="text-align:right;">Total</th></tr></thead><tbody>'
      + rows
      + '<tr class="rpt-total"><td>Total</td><td></td><td style="text-align:right;">' + fmtMoney(d.grand_total_cents||0) + '</td></tr>'
      + '</tbody></table>'
    );
  });
}
function runGivingSummary() {
  var from = document.getElementById('rpt-from').value;
  var to = document.getElementById('rpt-to').value;
  if (!from || !to) { alert('Please select a date range.'); return; }
  api('/admin/api/reports/giving-summary?from=' + from + '&to=' + to).then(function(d) {
    var rows = (d.rows||[]).map(function(r) {
      return '<tr><td>' + esc(r.fund_name) + '</td><td style="text-align:right;">' + (r.contributions||0) + '</td><td style="text-align:right;">' + fmtMoney(r.total_cents||0) + '</td></tr>';
    }).join('');
    showRptOutput(
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
      + '<h3 style="font-family:var(--font-head);color:var(--steel-anchor);">Giving by Fund: ' + esc(fmtDate(from)) + ' – ' + esc(fmtDate(to)) + '</h3>'
      + '<button class="btn-secondary" style="font-size:.8rem;padding:4px 10px;" onclick="window.print()">Print</button></div>'
      + '<table class="rpt-table"><thead><tr><th>Fund</th><th style="text-align:right;">Gifts</th><th style="text-align:right;">Total</th></tr></thead><tbody>'
      + rows
      + '<tr class="rpt-total"><td>Total</td><td></td><td style="text-align:right;">' + fmtMoney(d.grand_total_cents||0) + '</td></tr>'
      + '</tbody></table>'
    );
  });
}
var _stmtData = null;
function toggleStmtMode() {
  var mode = document.querySelector('input[name="rpt-stmt-mode"]:checked').value;
  document.getElementById('rpt-stmt-person-row').style.display = mode === 'person' ? '' : 'none';
  document.getElementById('rpt-stmt-hh-row').style.display = mode === 'household' ? '' : 'none';
}
function acSearchHH(inp) {
  var q = inp.value.trim();
  var drop = document.getElementById('rpt-hh-ac');
  if (!q) { drop.classList.remove('open'); return; }
  api('/admin/api/households?q=' + encodeURIComponent(q) + '&limit=10').then(function(d) {
    var items = (d.households || []);
    if (!items.length) { drop.classList.remove('open'); return; }
    drop.innerHTML = items.map(function(h) {
      return '<div class="ac-item" onclick="selectHHAc(' + h.id + ',&#39;' + esc(h.name) + '&#39;)">' + esc(h.name) + '</div>';
    }).join('');
    drop.classList.add('open');
  });
}
function selectHHAc(id, name) {
  document.getElementById('rpt-hh-id').value = id;
  document.getElementById('rpt-hh-search').value = name;
  document.getElementById('rpt-hh-ac').classList.remove('open');
}
function runGivingStatement() {
  var mode = (document.querySelector('input[name="rpt-stmt-mode"]:checked') || {}).value || 'person';
  var yr = document.getElementById('rpt-year').value;
  if (!yr) { alert('Please enter a year.'); return; }
  if (mode === 'household') {
    var hhid = document.getElementById('rpt-hh-id').value;
    if (!hhid) { alert('Please select a household.'); return; }
    api('/admin/api/reports/giving-statement-household?household_id=' + hhid + '&year=' + yr).then(function(d) {
      if (d.error) { alert(d.error); return; }
      _stmtData = d; _stmtData._mode = 'household';
      var hh = d.household || {};
      var rows = (d.entries||[]).map(function(e) {
        return '<tr><td>' + esc(fmtDate(e.gift_date)) + '</td><td>' + esc(e.first_name + ' ' + e.last_name) + '</td><td>' + esc(e.fund_name) + '</td><td style="text-align:right;">' + fmtMoney(e.amount) + '</td></tr>';
      }).join('');
      showRptOutput(
        '<div style="max-width:620px;margin:0 auto;">'
        + '<div style="text-align:center;margin-bottom:16px;"><div style="font-family:var(--font-head);font-size:1.2rem;color:var(--steel-anchor);">' + esc(_churchConfig.church_name || 'Timothy Lutheran Church') + '</div>'
        + '<div style="font-size:.9rem;color:var(--warm-gray);">Household Giving Statement — ' + esc(String(yr)) + '</div></div>'
        + '<div style="margin-bottom:14px;font-size:.9rem;"><div><strong>Household:</strong> ' + esc(hh.name) + '</div></div>'
        + '<table class="rpt-table"><thead><tr><th>Date</th><th>Person</th><th>Fund</th><th style="text-align:right;">Amount</th></tr></thead><tbody>'
        + rows
        + '<tr class="rpt-total"><td colspan="3">Total ' + esc(String(yr)) + '</td><td style="text-align:right;">' + fmtMoney(d.total_cents||0) + '</td></tr>'
        + '</tbody></table>'
        + '<div style="font-size:.78rem;color:var(--warm-gray);margin-top:16px;font-style:italic;">No goods or services were provided in exchange for these contributions. Please retain for your tax records.</div>'
        + '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">'
        + '<button class="btn-secondary" style="font-size:.8rem;" onclick="window.print()">Print</button>'
        + '<button class="btn-secondary" style="font-size:.8rem;" onclick="runGivingStatementLetter()">View Letter</button>'
        + '</div></div>'
      );
    });
    return;
  }
  var pid = document.getElementById('rpt-person-id').value;
  if (!pid) { alert('Please select a person.'); return; }
  api('/admin/api/reports/giving-statement?person_id=' + pid + '&year=' + yr).then(function(d) {
    if (d.error) { alert(d.error); return; }
    _stmtData = d; _stmtData._mode = 'person';
    var p = d.person || {};
    var addr = [p.address1, p.city, p.state, p.zip].filter(Boolean).join(', ');
    var rows = (d.entries||[]).map(function(e) {
      return '<tr><td>' + esc(fmtDate(e.gift_date)) + '</td><td>' + esc(e.fund_name) + '</td><td style="text-align:right;">' + fmtMoney(e.amount) + '</td><td>' + esc(e.method) + '</td></tr>';
    }).join('');
    showRptOutput(
      '<div style="max-width:600px;margin:0 auto;">'
      + '<div style="text-align:center;margin-bottom:20px;">'
      + '<div style="font-family:var(--font-head);font-size:1.2rem;color:var(--steel-anchor);">' + esc(_churchConfig.church_name || 'Timothy Lutheran Church') + '</div>'
      + '<div style="font-size:.9rem;color:var(--warm-gray);">Charitable Contribution Statement — ' + esc(String(yr)) + '</div>'
      + '</div>'
      + '<div style="margin-bottom:16px;font-size:.9rem;">'
      + '<div><strong>Prepared for:</strong> ' + esc(p.first_name) + ' ' + esc(p.last_name) + '</div>'
      + (addr ? '<div><strong>Address:</strong> ' + esc(addr) + '</div>' : '')
      + '</div>'
      + '<table class="rpt-table"><thead><tr><th>Date</th><th>Fund</th><th style="text-align:right;">Amount</th><th>Method</th></tr></thead><tbody>'
      + rows
      + '<tr class="rpt-total"><td colspan="2">Total ' + esc(String(yr)) + '</td><td style="text-align:right;">' + fmtMoney(d.total_cents||0) + '</td><td></td></tr>'
      + '</tbody></table>'
      + '<div style="font-size:.78rem;color:var(--warm-gray);margin-top:16px;font-style:italic;">No goods or services were provided in exchange for these contributions. Please retain for your tax records.</div>'
      + '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">'
      + '<button class="btn-secondary" style="font-size:.8rem;" onclick="window.print()">Print</button>'
      + '<button class="btn-secondary" style="font-size:.8rem;" onclick="runGivingStatementLetter()">View Letter</button>'
      + '<button class="btn-secondary" style="font-size:.8rem;" onclick="emailGivingLetter()">&#9993; Email Letter</button>'
      + '<button class="btn-secondary" style="font-size:.8rem;" onclick="downloadStatement()">Download CSV</button>'
      + '</div>'
      + '</div>'
    );
  });
}
function buildGiftTable(entries, mode) {
  if (!entries || !entries.length) return 'No contributions recorded for this period.';
  var header = mode === 'household'
    ? '<tr><th>Date</th><th>Person</th><th>Fund</th><th>Amount</th></tr>'
    : '<tr><th>Date</th><th>Fund</th><th>Amount</th><th>Method</th></tr>';
  var rows = entries.map(function(e) {
    if (mode === 'household')
      return '<tr><td>' + esc(fmtDate(e.gift_date)) + '</td><td>' + esc(e.first_name + ' ' + e.last_name) + '</td><td>' + esc(e.fund_name) + '</td><td>' + fmtMoney(e.amount) + '</td></tr>';
    return '<tr><td>' + esc(fmtDate(e.gift_date)) + '</td><td>' + esc(e.fund_name) + '</td><td>' + fmtMoney(e.amount) + '</td><td>' + esc(e.method) + '</td></tr>';
  }).join('');
  return '<table style="width:100%;border-collapse:collapse;font-size:.9rem;"><thead style="background:#f5f5f5;">' + header + '</thead><tbody>' + rows + '</tbody></table>';
}
function renderLetterHTML(d) {
  var cfg = _churchConfig;
  var tpl = cfg.giving_letter_template || DEFAULT_LETTER_TEMPLATE;
  var name, total, year;
  if (d._mode === 'household') {
    name = (d.household || {}).name || 'Friend';
    total = fmtMoney(d.total_cents || 0);
    year = String(d.year || '');
  } else {
    var p = d.person || {};
    name = (p.first_name + ' ' + p.last_name).trim() || 'Friend';
    total = fmtMoney(d.total_cents || 0);
    year = String(d.year || '');
  }
  var giftTable = buildGiftTable(d.entries || [], d._mode);
  var ein = cfg.church_ein || '';
  var einLine = ein ? 'Our EIN/Tax ID is ' + ein + '. No goods or services were provided in exchange for these contributions. Please retain this letter for your tax records.' : 'No goods or services were provided in exchange for these contributions. Please retain this letter for your tax records.';
  var today = new Date().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'});
  var letter = tpl
    .replace(/\{\{name\}\}/g, name)
    .replace(/\{\{year\}\}/g, year)
    .replace(/\{\{total\}\}/g, total)
    .replace(/\{\{ein\}\}/g, ein)
    .replace(/\{\{date\}\}/g, today)
    .replace(/\{\{gift_table\}\}/g, giftTable)
    .replace(/\{\{#if_ein\}\}[\s\S]*?\{\{\/if_ein\}\}/g, ein ? einLine : '');
  return letter.replace(/\\n/g, '<br>');
}
function runGivingStatementLetter() {
  if (!_stmtData) { alert('Run a giving statement first.'); return; }
  if (!_churchConfig.church_name) {
    // Load config if not yet loaded
    api('/admin/api/config/church').then(function(cfg) {
      _churchConfig = cfg || {};
      showGivingLetter();
    });
  } else {
    showGivingLetter();
  }
}
function showGivingLetter() {
  var d = _stmtData;
  var letterHtml = renderLetterHTML(d);
  var name, email, yr;
  yr = String(d.year || document.getElementById('rpt-year').value || '');
  if (d._mode === 'household') {
    name = (d.household || {}).name || '';
    email = '';
  } else {
    var p = d.person || {};
    name = (p.first_name + ' ' + p.last_name).trim();
    email = p.email || '';
  }
  var churchName = _churchConfig.church_name || 'Timothy Lutheran Church';
  showRptOutput(
    '<div style="max-width:640px;margin:0 auto;">'
    + '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">'
    + '<button class="btn-secondary" style="font-size:.8rem;" onclick="runGivingStatement()">&#8592; Back to Statement</button>'
    + '<button class="btn-secondary" style="font-size:.8rem;" onclick="window.print()">Print Letter</button>'
    + (email ? '<button class="btn-primary" style="font-size:.8rem;" onclick="emailGivingLetter()">&#9993; Email to ' + esc(email) + '</button>' : '')
    + '<div id="letter-email-status" class="import-status" style="align-self:center;"></div>'
    + '</div>'
    + '<div id="letter-body" style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:28px 32px;font-size:.92rem;line-height:1.65;">'
    + '<div style="font-family:var(--font-head);font-size:1.1rem;color:var(--steel-anchor);margin-bottom:4px;">' + esc(churchName) + '</div>'
    + '<hr style="margin:12px 0;">'
    + letterHtml
    + '</div></div>'
  );
}
function emailGivingLetter() {
  if (!_stmtData) return;
  var p = _stmtData.person || {};
  var email = p.email || '';
  if (!email) { alert('No email address on file for this person.'); return; }
  var status = document.getElementById('letter-email-status');
  if (status) { status.textContent = 'Sending…'; status.className = 'import-status'; }
  var yr = String(_stmtData.year || '');
  var churchName = _churchConfig.church_name || 'Timothy Lutheran Church';
  var letterHtml = renderLetterHTML(_stmtData);
  var fullHtml = '<div style="font-family:Georgia,serif;font-size:14px;line-height:1.65;max-width:560px;">'
    + '<div style="font-size:16px;font-weight:bold;margin-bottom:6px;">' + esc(churchName) + '</div>'
    + '<hr style="margin:10px 0;">'
    + letterHtml + '</div>';
  api('/admin/api/giving/send-statement', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      to_email: email,
      to_name: (p.first_name + ' ' + p.last_name).trim(),
      subject: yr + ' Charitable Contribution Statement — ' + churchName,
      html_body: fullHtml
    })
  }).then(function(d) {
    if (status) {
      if (d.ok) { status.textContent = 'Sent to ' + email; status.className = 'import-status ok'; }
      else { status.textContent = 'Error: ' + (d.error || 'unknown'); status.className = 'import-status err'; }
    }
  }).catch(function(e) {
    if (status) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; }
  });
}
function downloadStatement() {
  var mode = (document.querySelector('input[name="rpt-stmt-mode"]:checked') || {}).value || 'person';
  var yr = document.getElementById('rpt-year').value;
  if (!yr) { alert('Enter a year first.'); return; }
  if (mode === 'household') {
    alert('CSV download is only available for person statements. Use Print or View Letter for household statements.');
    return;
  }
  var pid = document.getElementById('rpt-person-id').value;
  if (!pid || !yr) { alert('Select a person and year first.'); return; }
  window.location = '/admin/api/reports/giving-statement?person_id=' + pid + '&year=' + yr + '&format=csv';
}
// ── BATCH SEND ─────────────────────────────────────────────────────────
function loadBatchStatementGivers() {
  var yr = document.getElementById('batch-stmt-year').value;
  var status = document.getElementById('batch-stmt-status');
  var listEl = document.getElementById('batch-stmt-list');
  if (!yr) { status.textContent = 'Enter a year.'; status.className = 'import-status err'; return; }
  status.textContent = 'Loading givers for ' + yr + '…'; status.className = 'import-status';
  listEl.innerHTML = '';
  // Fetch people who gave in this year (via giving summary approach - get all people with giving)
  api('/admin/api/reports/giving-statement?year=' + yr + '&list_givers=1').then(function(d) {
    var givers = d.givers || [];
    if (!givers.length) {
      status.textContent = 'No givers with email found for ' + yr + '.';
      status.className = 'import-status err';
      return;
    }
    status.textContent = givers.length + ' givers found with email. Check who to include, then Send.';
    status.className = 'import-status ok';
    listEl.innerHTML = '<div style="margin-bottom:8px;display:flex;gap:8px;">'
      + '<button class="btn-sm" onclick="selectAllBatchGivers(true)">Select All</button>'
      + '<button class="btn-sm" onclick="selectAllBatchGivers(false)">Deselect All</button>'
      + '<button class="btn-primary" style="font-size:.8rem;padding:4px 12px;" onclick="sendBatchStatements(' + yr + ')">Send Selected</button>'
      + '</div>'
      + '<div id="batch-givers-list">'
      + givers.map(function(g) {
        return '<label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:.85rem;cursor:pointer;">'
          + '<input type="checkbox" data-pid="' + g.id + '" checked>'
          + '<span>' + esc(g.first_name + ' ' + g.last_name) + '</span>'
          + '<span style="color:var(--warm-gray);font-size:.78rem;">' + esc(g.email) + '</span>'
          + '<span style="margin-left:auto;font-size:.78rem;">' + fmtMoney(g.total_cents) + '</span>'
          + '</label>';
      }).join('')
      + '</div>';
  }).catch(function(e) {
    status.textContent = 'Error: ' + e.message; status.className = 'import-status err';
  });
}
function selectAllBatchGivers(checked) {
  document.querySelectorAll('#batch-givers-list input[type=checkbox]').forEach(function(cb) { cb.checked = checked; });
}
function sendBatchStatements(yr) {
  var status = document.getElementById('batch-stmt-status');
  var checks = document.querySelectorAll('#batch-givers-list input[type=checkbox]:checked');
  if (!checks.length) { status.textContent = 'No givers selected.'; status.className = 'import-status err'; return; }
  // Ensure church config is loaded
  if (!_churchConfig.church_name) {
    api('/admin/api/config/church').then(function(cfg) {
      _churchConfig = cfg || {};
      doSendBatch(yr, checks, status);
    });
  } else {
    doSendBatch(yr, checks, status);
  }
}
function doSendBatch(yr, checks, status) {
  var ids = Array.from(checks).map(function(cb){return cb.dataset.pid;});
  var total = ids.length, done = 0, failed = 0;
  status.textContent = 'Sending 0/' + total + '…'; status.className = 'import-status';
  function sendNext() {
    if (!ids.length) {
      status.textContent = 'Done. ' + done + ' sent, ' + failed + ' failed.';
      status.className = failed ? 'import-status' : 'import-status ok';
      return;
    }
    var pid = ids.shift();
    api('/admin/api/reports/giving-statement?person_id=' + pid + '&year=' + yr).then(function(d) {
      if (d.error || !d.person) { failed++; sendNext(); return; }
      d._mode = 'person';
      var p = d.person || {};
      if (!p.email) { failed++; sendNext(); return; }
      var churchName = _churchConfig.church_name || 'Timothy Lutheran Church';
      var letterHtml = renderLetterHTML(d);
      var fullHtml = '<div style="font-family:Georgia,serif;font-size:14px;line-height:1.65;max-width:560px;">'
        + '<div style="font-size:16px;font-weight:bold;margin-bottom:6px;">' + esc(churchName) + '</div><hr style="margin:10px 0;">'
        + letterHtml + '</div>';
      return api('/admin/api/giving/send-statement', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          to_email: p.email,
          to_name: (p.first_name + ' ' + p.last_name).trim(),
          subject: yr + ' Charitable Contribution Statement — ' + churchName,
          html_body: fullHtml
        })
      });
    }).then(function(r) {
      if (r && r.ok) done++; else failed++;
      status.textContent = 'Sending ' + (done+failed) + '/' + total + '…';
      sendNext();
    }).catch(function() { failed++; sendNext(); });
  }
  sendNext();
}
// ── GENERATE REGISTER FROM PEOPLE ─────────────────────────────────────
// Called from the Register tab toolbar — uses the current register type
function openRegFromPeoplePrompt() {
  var type = _regType; // 'baptism' or 'confirmation'
  var label = type === 'baptism' ? 'Baptisms' : 'Confirmations';
  var cutoff = prompt(
    'Generate ' + label + ' register entries from people records.\n\n'
    + 'Enter earliest date to include (YYYY-MM-DD), or leave blank for all dates:',
    ''
  );
  if (cutoff === null) return; // cancelled
  cutoff = cutoff.trim() || '1900-01-01';
  var btn = document.querySelector('[onclick="openRegFromPeoplePrompt()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  api('/admin/api/import/register-from-people', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ cutoff: cutoff, types: [type] })
  }).then(function(d) {
    if (btn) { btn.disabled = false; btn.innerHTML = '&#128100; From People'; }
    if (d.error) { alert('Error: ' + d.error); return; }
    alert('Done. ' + d.imported + ' ' + label.toLowerCase() + ' entries created' + (d.skipped ? ', ' + d.skipped + ' already existed' : '') + '.');
    loadRegister();
  }).catch(function(e) {
    if (btn) { btn.disabled = false; btn.innerHTML = '&#128100; From People'; }
    alert('Error: ' + e.message);
  });
}
function generateRegisterFromPeople() {
  var status = document.getElementById('reg-gen-status');
  var cutoff = document.getElementById('reg-gen-cutoff').value || '1900-01-01';
  var inclBaptism = document.getElementById('reg-gen-baptism').checked;
  var inclConfirm = document.getElementById('reg-gen-confirm').checked;
  if (!inclBaptism && !inclConfirm) { status.textContent = 'Select at least one type.'; status.className = 'import-status err'; return; }
  status.textContent = 'Generating\u2026'; status.className = 'import-status';
  var types = [];
  if (inclBaptism) types.push('baptism');
  if (inclConfirm) types.push('confirmation');
  api('/admin/api/import/register-from-people', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({cutoff: cutoff, types: types})
  }).then(function(d) {
    if (d.error) { status.textContent = 'Error: ' + d.error; status.className = 'import-status err'; return; }
    status.textContent = 'Done. ' + d.imported + ' entries created, ' + d.skipped + ' already existed.';
    status.className = 'import-status ok';
  }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
}
// ── CLEAR GIVING ──────────────────────────────────────────────────────
function pruneEmptyBatches() {
  var status = document.getElementById('prune-batches-status');
  status.textContent = 'Pruning…'; status.className = 'import-status';
  api('/admin/api/giving/prune-empty-batches', {method:'POST'}).then(function(d) {
    if (d.ok) {
      status.textContent = 'Done — ' + d.deleted + ' empty batch(es) deleted.';
      status.className = 'import-status ok';
      loadBatches();
    } else {
      status.textContent = 'Error: ' + (d.error||'unknown');
      status.className = 'import-status err';
    }
  }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
}
function clearAllGiving() {
  if (!confirm('This will PERMANENTLY DELETE all giving entries and batches. This cannot be undone.\\n\\nAre you absolutely sure?')) return;
  if (!confirm('Last chance — click OK to permanently delete ALL giving data.')) return;
  var status = document.getElementById('clear-giving-status');
  status.textContent = 'Deleting…'; status.className = 'import-status';
  api('/admin/api/giving/all', {method:'DELETE'}).then(function(d) {
    if (d.ok) {
      status.textContent = 'All giving data cleared. You can now re-import.';
      status.className = 'import-status ok';
      loadBatches();
    } else {
      status.textContent = 'Error: ' + (d.error||'unknown');
      status.className = 'import-status err';
    }
  }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
}

// ── IMPORT ──────────────────────────────────────────────────────────────
function loadFundMapping() {
  var status = document.getElementById('fund-map-status');
  status.textContent = 'Loading…'; status.className = 'import-status';
  api('/admin/api/import/breeze-fund-list').then(function(d) {
    var breezeFunds = d.breeze_funds || [];
    var realFunds   = d.real_funds   || [];
    if (!breezeFunds.length) {
      status.textContent = 'No unmapped Breeze funds found — all done!';
      status.className = 'import-status ok';
      return;
    }
    // Options for merge-into-existing
    var mergeOpts = realFunds.map(function(f) {
      return '<option value="merge:' + f.id + '">Merge into: ' + esc(f.name) + '</option>';
    }).join('');
    var rows = breezeFunds.map(function(f) {
      var amt = '$' + (f.total_cents / 100).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
      return '<tr style="border-bottom:1px solid #eee;">'
        + '<td style="padding:6px 8px;font-size:.82rem;">' + esc(f.name) + '<br><span style="color:#888;">' + f.gifts + ' gifts &bull; ' + amt + '</span></td>'
        + '<td style="padding:6px 8px;">'
        +   '<select data-from="' + f.id + '" style="font-size:.82rem;padding:2px 4px;width:100%;margin-bottom:4px;">'
        +     '<option value="">— skip —</option>'
        +     '<option value="rename">Rename to real name below</option>'
        +     mergeOpts
        +   '</select>'
        +   '<input type="text" data-rename="' + f.id + '" placeholder="New fund name (if renaming)" style="font-size:.82rem;padding:2px 6px;width:100%;display:none;">'
        + '</td></tr>';
    }).join('');
    document.getElementById('fund-map-rows').innerHTML = rows;
    // Show/hide rename input when "Rename" selected
    document.querySelectorAll('#fund-map-rows select').forEach(function(sel) {
      sel.addEventListener('change', function() {
        var inp = document.querySelector('input[data-rename="' + sel.dataset.from + '"]');
        if (inp) inp.style.display = sel.value === 'rename' ? 'block' : 'none';
      });
    });
    document.getElementById('fund-map-area').style.display = 'block';
    status.textContent = breezeFunds.length + ' Breeze fund(s) need mapping. For each: rename it OR merge into an existing fund.';
    status.className = 'import-status';
  }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
}

function applyFundMapping() {
  var status = document.getElementById('fund-map-status');
  var selects = document.querySelectorAll('#fund-map-rows select');
  var mappings = [];
  selects.forEach(function(sel) {
    var fromId = parseInt(sel.dataset.from);
    var val = sel.value;
    if (!val || val === '') return;
    if (val === 'rename') {
      var inp = document.querySelector('input[data-rename="' + sel.dataset.from + '"]');
      var newName = inp ? inp.value.trim() : '';
      if (newName) mappings.push({ from_id: fromId, rename: newName });
    } else if (val.startsWith('merge:')) {
      mappings.push({ from_id: fromId, to_id: parseInt(val.slice(6)) });
    }
  });
  if (!mappings.length) { status.textContent = 'No mappings selected.'; status.className = 'import-status err'; return; }
  status.textContent = 'Applying…'; status.className = 'import-status';
  api('/admin/api/import/map-funds', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({mappings:mappings})}).then(function(d) {
    if (d.error) { status.textContent = 'Error: ' + d.error; status.className = 'import-status err'; return; }
    status.textContent = 'Done! ' + (d.entries_moved||0) + ' contributions re-linked, ' + (d.renamed||0) + ' funds renamed. Reload to continue.';
    status.className = 'import-status ok';
    document.getElementById('fund-map-area').style.display = 'none';
  }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
}

function runBreezeGivingSync() {
  var from = document.getElementById('giving-sync-from').value;
  var to = document.getElementById('giving-sync-to').value;
  var status = document.getElementById('giving-sync-status');
  if (!from || !to) { status.textContent = 'Please select a date range.'; status.className = 'import-status err'; return; }
  status.textContent = 'Syncing ' + from + ' to ' + to + '…'; status.className = 'import-status';
  fetch('/admin/api/import/breeze-giving', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({start: from, end: to})
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.error) { status.textContent = 'Error: ' + d.error; status.className = 'import-status err'; return; }
    var msg = 'Done. ' + (d.imported||0) + ' contributions imported, ' + (d.skipped||0) + ' already existed.';
    if (d.errors && d.errors.length) msg += ' ' + d.errors.length + ' error(s).';
    status.textContent = msg; status.className = 'import-status ok';
  }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
}

function runBreezeGivingAll() {
  var startYear = parseInt(document.getElementById('giving-sync-start-year').value) || 2020;
  var currentYear = new Date().getFullYear();
  var status = document.getElementById('giving-all-status');
  var btn = document.getElementById('giving-all-btn');
  btn.disabled = true;
  var totalImported = 0, totalSkipped = 0;
  var years = [];
  for (var y = startYear; y <= currentYear; y++) years.push(y);
  var idx = 0;
  function doYear() {
    if (idx >= years.length) {
      btn.disabled = false;
      status.textContent = 'All done! ' + totalImported + ' contributions imported, ' + totalSkipped + ' already existed.';
      status.className = 'import-status ok';
      return;
    }
    var yr = years[idx++];
    status.textContent = 'Syncing ' + yr + '… (' + idx + '/' + years.length + ' years)';
    status.className = 'import-status';
    fetch('/admin/api/import/breeze-giving', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({start: yr + '-01-01', end: yr + '-12-31'})
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (d.error) {
        btn.disabled = false;
        status.textContent = 'Error on ' + yr + ': ' + d.error;
        status.className = 'import-status err';
        return;
      }
      totalImported += d.imported || 0;
      totalSkipped  += d.skipped  || 0;
      status.textContent = yr + ': ' + (d.imported||0) + ' imported — running total: ' + totalImported + ' imported, ' + totalSkipped + ' skipped';
      doYear();
    }).catch(function(e) {
      btn.disabled = false;
      status.textContent = 'Error on ' + yr + ': ' + e.message;
      status.className = 'import-status err';
    });
  }
  doYear();
}

function runBreezeImport() {
  var bar = document.getElementById('breeze-bar');
  var fill = document.getElementById('breeze-fill');
  var status = document.getElementById('breeze-status');
  bar.style.display = 'block'; fill.style.width = '0%';
  status.textContent = 'Starting import…'; status.className = 'import-status';
  var totalImported = 0, totalUpdated = 0;
  var lastStatusField = null, allStatusesSeen = new Set();
  function doPage(offset) {
    api('/admin/api/import/breeze', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({offset:offset, limit:100})}).then(function(d) {
      if (d.error) { status.textContent = 'Error: ' + d.error; status.className = 'import-status err'; bar.style.display = 'none'; return; }
      totalImported += d.imported || 0;
      totalUpdated += d.updated || 0;
      if (d.status_field) lastStatusField = d.status_field;
      if (d.statuses_seen) d.statuses_seen.forEach(function(s) { allStatusesSeen.add(s); });
      if (d._diag && !window._breezeImportDiag) {
        window._breezeImportDiag = d._diag;
        // Show diagnostic inline so no DevTools needed
        var diagEl = document.getElementById('breeze-diag');
        if (diagEl && d._diag) {
          var diag = d._diag;
          var lines = ['Status field ID being looked up: ' + (diag.status_field_id || '(none)')];
          if (diag.sample_top_level_keys && diag.sample_top_level_keys.length) {
            lines.push('Top-level person properties (not details/family):');
            diag.sample_top_level_keys.forEach(function(e) { lines.push('  ' + e.key + ' → ' + e.val); });
          }
          if (diag.sample_detail_entries) {
            lines.push('details entries:');
            diag.sample_detail_entries.forEach(function(e) { lines.push('  ' + e.key + ' → ' + e.val); });
          }
          diagEl.innerHTML = lines.map(function(l) { return esc(l); }).join('<br>');
          diagEl.style.display = 'block';
        }
      }
      fill.style.width = d.done ? '100%' : Math.min(95, (d.next_offset / Math.max(d.next_offset + 100, 200)) * 100) + '%';
      status.textContent = 'Imported ' + totalImported + ', updated ' + totalUpdated + '…';
      if (d.done) {
        var msg = 'Done. ' + totalImported + ' new, ' + totalUpdated + ' updated.';
        if (!lastStatusField) {
          msg += ' ⚠ No Breeze status field detected — check Settings › Breeze Status Mapping.';
        } else if (allStatusesSeen.size === 0) {
          msg += ' ⚠ Status field "' + lastStatusField.name + '" found but no values seen.';
        } else {
          msg += ' Status field: "' + lastStatusField.name + '". Statuses seen: ' + [...allStatusesSeen].join(', ') + '.';
        }
        status.textContent = msg;
        status.className = (lastStatusField && allStatusesSeen.size > 0) ? 'import-status ok' : 'import-status warn';
        fill.style.width = '100%';
        loadPeople();
        return;
      }
      doPage(d.next_offset);
    }).catch(function(e) { status.textContent = 'Network error: ' + e.message; status.className = 'import-status err'; });
  }
  doPage(0);
}
function importGivingCSV(file) {
  if (!file) file = document.getElementById('giving-csv-file').files[0];
  var status = document.getElementById('giving-csv-status');
  var label  = document.getElementById('giving-csv-name');
  if (!file) { status.textContent = 'Please select a file.'; status.className = 'import-status err'; return; }
  if (label) label.textContent = file.name;
  status.textContent = 'Reading\u2026'; status.className = 'import-status';
  var reader = new FileReader();
  reader.onload = function(e) {
    var lines = e.target.result.split(/\\r?\\n/);
    var header = lines[0];
    var dataLines = lines.slice(1).filter(function(l) { return l.trim(); });
    var total = dataLines.length;
    var chunkSize = 500;
    var chunks = [];
    for (var i = 0; i < dataLines.length; i += chunkSize)
      chunks.push(dataLines.slice(i, i + chunkSize));
    var totImported = 0, totSkipped = 0, totBatches = 0, totFunds = 0, totBlank = 0, totDup = 0, totZero = 0;
    function sendChunk(idx) {
      if (idx >= chunks.length) {
        var msg = 'Done \u2014 ' + totImported + ' imported, ' + totSkipped + ' skipped (of ' + total + ' rows).';
        if (totBatches) msg += ' ' + totBatches + ' new batches.';
        if (totFunds)   msg += ' ' + totFunds + ' new funds.';
        if (totSkipped) {
          var why = [];
          if (totDup)   why.push(totDup   + ' already imported');
          if (totZero)  why.push(totZero  + ' zero-amount');
          if (totBlank) why.push(totBlank + ' blank ID');
          if (why.length) msg += ' Skipped: ' + why.join(', ') + '.';
        }
        status.textContent = msg; status.className = 'import-status ok';
        return;
      }
      var pct = Math.round(idx / chunks.length * 100);
      status.textContent = 'Uploading\u2026 ' + pct + '% (' + (idx * chunkSize) + ' of ' + total + ' rows)';
      fetch('/admin/api/import/giving-csv', {
        method: 'POST',
        headers: {'Content-Type': 'text/csv'},
        body: header + '\\n' + chunks[idx].join('\\n')
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.error) { status.textContent = 'Error on chunk ' + idx + ': ' + d.error; status.className = 'import-status err'; return; }
        totImported += d.imported   || 0;
        totSkipped  += d.skipped    || 0;
        totBatches  += d.batchesMade|| 0;
        totFunds    += d.fundsMade  || 0;
        totBlank    += d.skipBlank  || 0;
        totDup      += d.skipDup    || 0;
        totZero     += d.skipZero   || 0;
        sendChunk(idx + 1);
      }).catch(function(err) { status.textContent = 'Error: ' + err.message; status.className = 'import-status err'; });
    }
    sendChunk(0);
  };
  reader.readAsText(file);
}
function importPeopleCSV() {
  var file = document.getElementById('csv-people-file').files[0];
  var status = document.getElementById('csv-people-status');
  if (!file) { status.textContent = 'Please choose a CSV file.'; status.className = 'import-status err'; return; }
  status.textContent = 'Uploading…'; status.className = 'import-status';
  var reader = new FileReader();
  reader.onload = function(e) {
    fetch('/admin/api/import/people-csv', {method:'POST', headers:{'Content-Type':'text/csv'}, body:e.target.result}).then(function(r) {
      return r.json();
    }).then(function(d) {
      if (d.error) { status.textContent = 'Error: ' + d.error; status.className = 'import-status err'; return; }
      status.textContent = 'Done. ' + (d.imported||0) + ' imported, ' + (d.updated||0) + ' updated.';
      status.className = 'import-status ok';
      loadPeople();
    }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
  };
  reader.readAsText(file);
}

function syncBreezeAttendanceCounts() {
  var status = document.getElementById('att-sync-status');
  status.textContent = 'Syncing from Breeze…'; status.className = 'import-status';
  api('/admin/api/import/breeze-attendance-sync', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({only_empty:true})}).then(function(d) {
    if (d.error) { status.textContent = 'Error: ' + d.error; status.className = 'import-status err'; return; }
    if (d.message) { status.textContent = d.message; status.className = 'import-status err'; return; }
    var msg = 'Done. ' + d.synced + ' services updated' + (d.failed ? ', ' + d.failed + ' failed' : '') + ' (of ' + d.total + ' total).';
    if (d.errors && d.errors.length) {
      msg += ' First errors: ' + d.errors.slice(0,3).map(function(e){return e.date+' '+e.time+': '+e.error;}).join('; ');
    }
    status.textContent = msg;
    status.className = d.failed ? 'import-status' : 'import-status ok';
  }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
}

function importAttendanceSimple() {
  var text = document.getElementById('att-simple-text').value.trim();
  var status = document.getElementById('att-simple-status');
  if (!text) { status.textContent = 'Paste attendance data first.'; status.className = 'import-status err'; return; }
  status.textContent = 'Importing…'; status.className = 'import-status';
  api('/admin/api/import/attendance-simple', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: text
  }).then(function(d) {
    if (d.error) { status.textContent = 'Error: ' + d.error; status.className = 'import-status err'; return; }
    var msg = 'Done — ' + d.imported + ' inserted, ' + d.updated + ' updated, ' + d.skipped + ' skipped.';
    if (d.combinedUsed) msg += ' (' + d.combinedUsed + ' combined-only Sundays stored as combined total)';
    status.textContent = msg;
    status.className = 'import-status ok';
  }).catch(function(e) { status.textContent = 'Error: ' + e; status.className = 'import-status err'; });
}
function importAttendanceTSV() {
  var file = document.getElementById('att-tsv-file').files[0];
  var status = document.getElementById('att-tsv-status');
  if (!file) { status.textContent = 'Please choose a TSV file.'; status.className = 'import-status err'; return; }
  status.textContent = 'Uploading…'; status.className = 'import-status';
  var reader = new FileReader();
  reader.onload = function(e) {
    fetch('/admin/api/import/attendance-tsv', {method:'POST', headers:{'Content-Type':'text/plain'}, body:e.target.result}).then(function(r) {
      return r.json();
    }).then(function(d) {
      if (d.error) { status.textContent = 'Error: ' + d.error; status.className = 'import-status err'; return; }
      var msg = 'Done. ' + d.imported + ' services imported, ' + d.skipped + ' skipped (duplicates/Vietnamese), ' + d.skippedFuture + ' future dates skipped. (' + d.total + ' data rows in file)';
      if (d.sample) msg += ' | First row date parsed: "' + (d.sample.col3||'?') + '" → ' + (d.sample.parsed ? d.sample.parsed.date : 'FAILED');
      status.textContent = msg;
      status.className = d.imported > 0 ? 'import-status ok' : 'import-status err';
    }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
  };
  reader.readAsText(file);
}

// ── ATTENDANCE ────────────────────────────────────────────────────────
var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function loadAttendance() {
  var from = document.getElementById('att-from').value;
  var to = document.getElementById('att-to').value;
  var q = '/admin/api/attendance?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) + '&order=' + _attOrder;
  api(q).then(function(d) {
    _loadedServices = d.services || [];
    _attTotalInDb = d.total_in_db || 0;
    renderAttendanceChart(_loadedServices);
    renderAttendanceList(_loadedServices, _attTotalInDb);
  });
}
function renderAttendanceListFromLoaded() {
  _attGroupBy = (document.getElementById('att-group-by') || {}).value || 'none';
  renderAttendanceList(_loadedServices, _attTotalInDb || 0);
}
var _attTotalInDb = 0;
function toggleAttOrder() {
  _attOrder = _attOrder === 'desc' ? 'asc' : 'desc';
  var btn = document.getElementById('att-order-btn');
  if (btn) btn.textContent = _attOrder === 'asc' ? '&#8593; Asc' : '&#8595; Desc';
  loadAttendance();
}
function setAttChartMode(m) {
  _attChartMode = m;
  ['line','yoy','bars'].forEach(function(k){
    var b = document.getElementById('att-mode-'+k);
    if (b) b.style.opacity = m === k ? '1' : '.55';
  });
  renderAttendanceChart(_loadedServices);
}

function renderAttendanceChart(services) {
  var today = new Date().toISOString().slice(0,10);
  var byDate = {};
  services.forEach(function(s) {
    if (s.service_type === 'sunday' && s.service_date <= today) {
      byDate[s.service_date] = (byDate[s.service_date]||0) + (s.attendance||0);
    }
  });
  var allDates = Object.keys(byDate).sort();
  var dataPts = allDates.filter(function(d){return byDate[d]>0;});

  var statsEl = document.getElementById('att-stats');
  if (!dataPts.length) {
    if (statsEl) statsEl.innerHTML = '<span style="color:var(--warm-gray);font-size:.85rem;">No past attendance data in this range. Try widening the date filter to include earlier years, or run Sync Counts from Breeze.</span>';
    var cw = document.getElementById('att-chart-wrap');
    if (cw) cw.innerHTML = '';
    return;
  }
  var vals = dataPts.map(function(d){return byDate[d];});
  var avg = Math.round(vals.reduce(function(a,b){return a+b;},0)/vals.length);
  var latest = byDate[dataPts[dataPts.length-1]];
  var latestDate = dataPts[dataPts.length-1].split('-');
  var latestLbl = MONTH_NAMES[parseInt(latestDate[1])-1]+' '+parseInt(latestDate[2]);
  var peakVal = Math.max.apply(null, vals);
  var peakIdx = vals.indexOf(peakVal);
  var peakParts = dataPts[peakIdx].split('-');
  var peakLbl = MONTH_NAMES[parseInt(peakParts[1])-1]+' '+parseInt(peakParts[2])+', '+peakParts[0];
  var curYear = today.slice(0,4);
  var priorYear = String(parseInt(curYear)-1);
  var todayMD = today.slice(5);
  var annualTotal = dataPts.reduce(function(s,d){return d.slice(0,4)===curYear?s+byDate[d]:s;},0);
  var ytdCur = annualTotal;
  var ytdPrior = dataPts.reduce(function(s,d){return d.slice(0,4)===priorYear&&d.slice(5)<=todayMD?s+byDate[d]:s;},0);
  var ytdHtml = '';
  if (ytdCur>0 && ytdPrior>0) {
    var pct = Math.round((ytdCur-ytdPrior)/ytdPrior*100);
    var pctColor = pct>=0 ? '#3a7d44' : '#b03a2e';
    ytdHtml = '<div><div class="att-stat-val" style="color:'+pctColor+';">'+(pct>=0?'+':'')+pct+'%</div><div class="att-stat-lbl">YTD vs '+priorYear+'</div></div>';
  }
  if (statsEl) statsEl.innerHTML =
    '<div class="att-stat-primary"><div class="att-stat-val">'+latest+'</div><div class="att-stat-lbl">Latest \u00b7 '+latestLbl+'</div></div>'
    +'<div class="att-stat-divider"></div>'
    +'<div><div class="att-stat-val">'+avg+'</div><div class="att-stat-lbl">Weekly Avg</div></div>'
    +'<div><div class="att-stat-val">'+peakVal+'</div><div class="att-stat-lbl">Peak \u00b7 '+peakLbl+'</div></div>'
    +(annualTotal?'<div><div class="att-stat-val">'+annualTotal+'</div><div class="att-stat-lbl">'+curYear+' Total</div></div>':'')
    +ytdHtml
    +'<div><div class="att-stat-val">'+dataPts.length+'</div><div class="att-stat-lbl">Sundays</div></div>';

  var n=dataPts.length;
  var H=210,pL=32,pR=12,pT=10,pB=30;
  var cw=document.getElementById('att-chart-wrap');

  if (_attChartMode === 'yoy') {
    // Build YoY data from loaded services
    var byYM={}, yrsAll=[];
    services.forEach(function(s){
      if(s.service_type!=='sunday'||!s.attendance||s.service_date>today) return;
      var yr2=s.service_date.slice(0,4), mo2=s.service_date.slice(5,7);
      if(!byYM[yr2]){byYM[yr2]={};yrsAll.push(yr2);}
      if(!byYM[yr2][mo2]){byYM[yr2][mo2]={sum:0,cnt:{}};}
      byYM[yr2][mo2].sum+=s.attendance;
      byYM[yr2][mo2].cnt[s.service_date]=1;
    });
    yrsAll=yrsAll.filter(function(v,i,a){return a.indexOf(v)===i;}).sort();
    var dYoY={years:yrsAll, monthly:{}};
    yrsAll.forEach(function(yr2){
      dYoY.monthly[yr2]=[];
      Object.keys(byYM[yr2]).sort().forEach(function(mo2){
        var b=byYM[yr2][mo2], nSun=Object.keys(b.cnt).length;
        dYoY.monthly[yr2].push({month:mo2, total:Math.round(b.sum/nSun)});
      });
    });
    if(statsEl) statsEl.innerHTML='<span style="font-size:.82rem;color:var(--warm-gray);">Year-over-Year — avg Sunday attendance per month. Use date filter to choose years.</span>';
    if(cw) cw.innerHTML=renderYoYChart(dYoY);
    return;
  }

  if (_attChartMode === 'bars') {
    var byMonth={}, bMonths=[];
    dataPts.forEach(function(d){
      var mk=d.slice(0,7);
      if(!byMonth[mk]){byMonth[mk]=0;bMonths.push(mk);}
      byMonth[mk]+=byDate[d];
    });
    var bVals=bMonths.map(function(m){return byMonth[m];});
    var maxV2=Math.max.apply(null,bVals)*1.1||1;
    var nb=bMonths.length;
    var W=Math.max(800, nb*28); // scalable: 28px min per bar
    var cH2=H-pT-pB;
    var slotW=(W-pL-pR)/nb;
    var barW=Math.max(4,Math.min(32,slotW*0.7));
    var px2=function(i){return pL+(i+0.5)*slotW;};
    var py2=function(v){return pT+cH2-(v/maxV2)*cH2;};
    var baseY=pT+cH2;
    var grid2='',ylbls2='',xlbls2='',bars2='';
    [0,Math.round(maxV2*0.5/1.1),Math.round(maxV2/1.1)].forEach(function(v){
      var yy=py2(v);
      grid2+='<line x1="'+pL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-pR)+'" y2="'+yy.toFixed(1)+'" stroke="#f0ece8" stroke-width="1"/>';
      ylbls2+='<text x="'+(pL-3)+'" y="'+(yy+3).toFixed(1)+'" text-anchor="end" fill="#9A8A78" font-size="9">'+Math.round(v)+'</text>';
    });
    var stepB=Math.max(1,Math.ceil(nb/10));
    for(var bi=0;bi<nb;bi+=stepB){
      var mp=bMonths[bi].split('-');
      xlbls2+='<text x="'+px2(bi).toFixed(1)+'" y="'+(H-5)+'" text-anchor="middle" fill="#9A8A78" font-size="9">'+MONTH_NAMES[parseInt(mp[1])-1]+' '+mp[0].slice(2)+'</text>';
    }
    bars2=bMonths.map(function(m,bi2){
      var bx=px2(bi2),bv=byMonth[m],by=py2(bv),bh=baseY-by;
      return '<rect x="'+(bx-barW/2).toFixed(1)+'" y="'+by.toFixed(1)+'" width="'+barW.toFixed(1)+'" height="'+bh.toFixed(1)+'" fill="#2E7EA6" rx="2" opacity="0.85"><title>'+m+': '+bv+'</title></rect>';
    }).join('');
    if(cw) cw.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" style="min-width:'+W+'px;width:100%;height:'+H+'px;">'+grid2+bars2+xlbls2+ylbls2+'</svg>';
    return;
  }

  var W=Math.max(800, n*10); // scalable: at least 10px per Sunday
  var cW=W-pL-pR, cH=H-pT-pB;
  var maxV=Math.max.apply(null,vals)*1.1||1;
  var px=function(i){return pL+(i/(n>1?n-1:1))*cW;};
  var py=function(v){return pT+cH-(v/maxV)*cH;};
  var pts=dataPts.map(function(d,i){return [px(i),py(byDate[d])];});
  var line=pts.map(function(p,i){return(i?'L ':'M ')+p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' ');
  var area=line+' L '+px(n-1).toFixed(1)+','+(pT+cH)+' L '+pL+','+(pT+cH)+' Z';
  var step=Math.max(1,Math.ceil(n/10));
  var xlbls='',ylbls='',grid='';
  [0,Math.round(maxV*0.5/1.1),Math.round(maxV/1.1)].forEach(function(v){
    var yy=py(v);
    grid+='<line x1="'+pL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-pR)+'" y2="'+yy.toFixed(1)+'" stroke="#f0ece8" stroke-width="1"/>';
    ylbls+='<text x="'+(pL-3)+'" y="'+(yy+3).toFixed(1)+'" text-anchor="end" fill="#9A8A78" font-size="9">'+v+'</text>';
  });
  for(var i=0;i<n;i+=step){
    var p=dataPts[i].split('-');
    xlbls+='<text x="'+px(i).toFixed(1)+'" y="'+(H-5)+'" text-anchor="middle" fill="#9A8A78" font-size="9">'+MONTH_NAMES[parseInt(p[1])-1]+' '+parseInt(p[2])+'</text>';
  }
  var avgPts=[];
  for(var ai=3;ai<n;ai++){
    avgPts.push([px(ai),py((vals[ai]+vals[ai-1]+vals[ai-2]+vals[ai-3])/4)]);
  }
  var avgLine=avgPts.length>1?'<path d="'+avgPts.map(function(p2,j){return(j?'L ':'M ')+p2[0].toFixed(1)+','+p2[1].toFixed(1);}).join(' ')+'" fill="none" stroke="#C9973A" stroke-width="2" stroke-dasharray="4 3" stroke-linejoin="round"/>':'';
  var markers='';
  var yearsInRange={};
  dataPts.forEach(function(d){yearsInRange[d.slice(0,4)]=1;});
  Object.keys(yearsInRange).forEach(function(yr){
    var ey=parseInt(yr),ea=ey%19,eb=Math.floor(ey/100),ec=ey%100;
    var edd=Math.floor(eb/4),ee=eb%4,ef=Math.floor((eb+8)/25);
    var eg=Math.floor((eb-ef+1)/3),eh=(19*ea+eb-edd-eg+15)%30;
    var eii=Math.floor(ec/4),ek=ec%4,el=(32+2*ee+2*eii-eh-ek)%7;
    var emm=Math.floor((ea+11*eh+22*el)/451);
    var emo=Math.floor((eh+el-7*emm+114)/31),edy=(eh+el-7*emm+114)%31+1;
    var eDate=yr+'-'+(emo<10?'0'+emo:''+emo)+'-'+(edy<10?'0'+edy:''+edy);
    var ei=dataPts.indexOf(eDate);
    if(ei>=0){
      var ex=px(ei);
      markers+='<line x1="'+ex.toFixed(1)+'" y1="'+pT+'" x2="'+ex.toFixed(1)+'" y2="'+(pT+cH)+'" stroke="#5A9E6F" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>';
      markers+='<text x="'+ex.toFixed(1)+'" y="'+(pT+9)+'" text-anchor="middle" fill="#5A9E6F" font-size="8">Easter</text>';
    }
    [yr+'-12-24',yr+'-12-25'].forEach(function(xd,xi){
      var xii=dataPts.indexOf(xd);
      if(xii>=0){
        var xx=px(xii);
        markers+='<line x1="'+xx.toFixed(1)+'" y1="'+pT+'" x2="'+xx.toFixed(1)+'" y2="'+(pT+cH)+'" stroke="#9B59B6" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>';
        markers+='<text x="'+xx.toFixed(1)+'" y="'+(pT+9)+'" text-anchor="middle" fill="#9B59B6" font-size="8">'+(xi===0?'Xmas Eve':'Christmas')+'</text>';
      }
    });
  });
  var dots=pts.map(function(p,i){
    var d=dataPts[i].split('-');
    var tip=MONTH_NAMES[parseInt(d[1])-1]+' '+parseInt(d[2])+' '+d[0]+': '+byDate[dataPts[i]];
    return '<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="3" fill="#2E7EA6" style="cursor:default;"><title>'+tip+'</title></circle>';
  }).join('');
  var avgLegend='<div style="display:flex;gap:16px;margin-top:4px;flex-wrap:wrap;">'
    +'<span style="display:flex;align-items:center;gap:4px;font-size:.75rem;color:var(--warm-gray);"><span style="display:inline-block;width:20px;height:2px;background:#2E7EA6;"></span>Weekly</span>'
    +(avgLine?'<span style="display:flex;align-items:center;gap:4px;font-size:.75rem;color:var(--warm-gray);"><span style="display:inline-block;width:20px;height:2px;background:#C9973A;border-top:2px dashed #C9973A;"></span>4-wk avg</span>':'')
    +'</div>';
  if(cw) cw.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" style="min-width:'+W+'px;width:100%;height:'+H+'px;">'+grid
    +'<path d="'+area+'" fill="rgba(46,126,166,0.12)"/>'
    +'<path d="'+line+'" fill="none" stroke="#2E7EA6" stroke-width="2" stroke-linejoin="round"/>'
    +avgLine+markers+dots+xlbls+ylbls+'</svg>'+avgLegend;
}

function renderYoYChart(d) {
  var palette=['#2E7EA6','#C9973A','#5A9E6F','#9B59B6','#E74C3C'];
  var mShort=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var W=800,H=200,pL=36,pR=12,pT=12,pB=36,cW=W-pL-pR,cH=H-pT-pB;
  var allV=[];
  d.years.forEach(function(yr){
    for(var mo=1;mo<=12;mo++){
      var ms=mo<10?'0'+mo:''+mo;
      var row=(d.monthly[yr]||[]).find(function(r){return r.month===ms;});
      if(row&&row.total) allV.push(row.total);
    }
  });
  if(!allV.length) return '';
  var maxV=Math.max.apply(null,allV)*1.1;
  var pxY=function(i){return pL+i*(cW/11);};
  var pyY=function(v){return pT+cH-(v/maxV)*cH;};
  var grid='',ylbls='',xlbls='',lines='';
  [0,Math.round(maxV*0.5/1.1),Math.round(maxV/1.1)].forEach(function(v){
    var yy=pyY(v);
    grid+='<line x1="'+pL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-pR)+'" y2="'+yy.toFixed(1)+'" stroke="#f0ece8" stroke-width="1"/>';
    ylbls+='<text x="'+(pL-3)+'" y="'+(yy+3).toFixed(1)+'" text-anchor="end" fill="#9A8A78" font-size="9">'+Math.round(v)+'</text>';
  });
  for(var xi=0;xi<12;xi++){
    xlbls+='<text x="'+pxY(xi).toFixed(1)+'" y="'+(H-5)+'" text-anchor="middle" fill="#9A8A78" font-size="9">'+mShort[xi]+'</text>';
  }
  var legend='<div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:6px;justify-content:center;">';
  d.years.forEach(function(yr,yi){
    var color=palette[yi%palette.length];
    var pts=[];
    for(var mo2=1;mo2<=12;mo2++){
      var ms2=mo2<10?'0'+mo2:''+mo2;
      var row2=(d.monthly[yr]||[]).find(function(r){return r.month===ms2;});
      if(row2&&row2.total) pts.push({x:pxY(mo2-1),y:pyY(row2.total),v:row2.total,mi:mo2-1});
    }
    if(!pts.length) return;
    var pathD=pts.map(function(p,j){return(j?'L ':'M ')+p.x.toFixed(1)+','+p.y.toFixed(1);}).join(' ');
    lines+='<path d="'+pathD+'" fill="none" stroke="'+color+'" stroke-width="2" stroke-linejoin="round"/>';
    pts.forEach(function(p){
      lines+='<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="3" fill="'+color+'"><title>'+mShort[p.mi]+' '+yr+': '+p.v+'</title></circle>';
    });
    legend+='<span style="display:flex;align-items:center;gap:5px;font-size:.8rem;"><span style="display:inline-block;width:14px;height:14px;background:'+color+';border-radius:3px;flex-shrink:0;"></span>'+yr+'</span>';
  });
  legend+='</div>';
  var svg='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:'+H+'px;">'+grid+lines+xlbls+ylbls+'</svg>';
  return '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px 16px 8px;margin-bottom:16px;"><div style="font-weight:700;color:var(--steel-anchor);font-size:.9rem;margin-bottom:8px;">Year-over-Year Trend</div>'+svg+legend+'</div>';
}

function renderByServiceChart(d) {
  var sundays=d.sundays||[];
  if(sundays.length>52) sundays=sundays.slice(sundays.length-52);
  var n=sundays.length;
  if(!n) return '';
  var W=800,H=180,pL=36,pR=12,pT=12,pB=32,cW=W-pL-pR,cH=H-pT-pB;
  var allV=[];
  sundays.forEach(function(s){if(s.att_8)allV.push(s.att_8);if(s.att_1045)allV.push(s.att_1045);});
  if(!allV.length) return '';
  var maxV=Math.max.apply(null,allV)*1.1;
  var pxS=function(i){return pL+(i/(n>1?n-1:1))*cW;};
  var pyS=function(v){return pT+cH-(v/maxV)*cH;};
  var grid='',ylbls='',xlbls='',line8='',line1045='';
  [0,Math.round(maxV*0.5/1.1),Math.round(maxV/1.1)].forEach(function(v){
    var yy=pyS(v);
    grid+='<line x1="'+pL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-pR)+'" y2="'+yy.toFixed(1)+'" stroke="#f0ece8" stroke-width="1"/>';
    ylbls+='<text x="'+(pL-3)+'" y="'+(yy+3).toFixed(1)+'" text-anchor="end" fill="#9A8A78" font-size="9">'+Math.round(v)+'</text>';
  });
  var stepS=Math.max(1,Math.ceil(n/8));
  for(var si=0;si<n;si+=stepS){
    var sp=sundays[si].service_date.split('-');
    xlbls+='<text x="'+pxS(si).toFixed(1)+'" y="'+(H-5)+'" text-anchor="middle" fill="#9A8A78" font-size="9">'+MONTH_NAMES[parseInt(sp[1])-1]+' '+parseInt(sp[2])+'</text>';
  }
  var pts8=[],pts1045=[];
  sundays.forEach(function(s,i){
    if(s.att_8) pts8.push([pxS(i),pyS(s.att_8),s.att_8,s.service_date]);
    if(s.att_1045) pts1045.push([pxS(i),pyS(s.att_1045),s.att_1045,s.service_date]);
  });
  if(pts8.length){
    line8='<path d="'+pts8.map(function(p,j){return(j?'L ':'M ')+p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' ')+'" fill="none" stroke="#C9973A" stroke-width="2" stroke-linejoin="round"/>';
    pts8.forEach(function(p){line8+='<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="2.5" fill="#C9973A"><title>'+p[3]+' 8am: '+p[2]+'</title></circle>';});
  }
  if(pts1045.length){
    line1045='<path d="'+pts1045.map(function(p,j){return(j?'L ':'M ')+p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' ')+'" fill="none" stroke="#2E7EA6" stroke-width="2" stroke-linejoin="round"/>';
    pts1045.forEach(function(p){line1045+='<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="2.5" fill="#2E7EA6"><title>'+p[3]+' 10:45am: '+p[2]+'</title></circle>';});
  }
  var legend='<div style="display:flex;gap:16px;margin-top:6px;justify-content:center;">'
    +'<span style="display:flex;align-items:center;gap:5px;font-size:.8rem;"><span style="display:inline-block;width:24px;height:3px;background:#C9973A;"></span>8am</span>'
    +'<span style="display:flex;align-items:center;gap:5px;font-size:.8rem;"><span style="display:inline-block;width:24px;height:3px;background:#2E7EA6;"></span>10:45am</span>'
    +'</div>';
  var svg='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:'+H+'px;">'+grid+line8+line1045+xlbls+ylbls+'</svg>';
  return '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px 16px 8px;margin-bottom:16px;"><div style="font-weight:700;color:var(--steel-anchor);font-size:.9rem;margin-bottom:8px;">8am vs 10:45am Trend</div>'+svg+legend+'</div>';
}

function renderAttendanceList(services, totalInDb) {
  var el = document.getElementById('att-list');
  if (!services.length) {
    var dbNote = totalInDb > 0
      ? '<div style="font-size:.8rem;color:var(--warm-gray);margin-top:6px;">&#9432; ' + totalInDb + ' service record(s) exist in the database — try widening the date filter to find them.</div>'
      : '<div style="font-size:.8rem;color:var(--warm-gray);margin-top:6px;">&#9432; No records in the database yet. Run the attendance import from the Import tab first.</div>';
    el.innerHTML = '<div style="padding:32px 24px;text-align:center;background:var(--white);border:1px solid var(--border);border-radius:12px;">'
      + '<div style="font-size:1rem;font-weight:600;color:var(--steel-anchor);margin-bottom:8px;">No services recorded for this period.</div>'
      + '<div style="font-size:.85rem;color:var(--warm-gray);margin-bottom:4px;">Click <strong>+ Add Sunday</strong> to enter attendance manually, or <strong>Pre-fill Year Sundays</strong> to pre-populate the calendar.</div>'
      + dbNote
      + '</div>';
    return;
  }
  var groupBy = (document.getElementById('att-group-by') || {}).value || _attGroupBy || 'none';
  // Group by date
  var byDate = {};
  var dates = [];
  services.forEach(function(s) {
    if (!byDate[s.service_date]) { byDate[s.service_date] = []; dates.push(s.service_date); }
    byDate[s.service_date].push(s);
  });
  var today2 = new Date().toISOString().slice(0,10);
  var html = '';
  var lastMonth = '';
  var MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  dates.forEach(function(date) {
    // Month group header
    if (groupBy === 'month') {
      var parts2 = date.split('-');
      var monthKey = parts2[0] + '-' + parts2[1];
      if (monthKey !== lastMonth) {
        lastMonth = monthKey;
        html += '<div style="padding:8px 14px 4px;font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--warm-gray);background:var(--linen);border-bottom:1px solid var(--border);">'
          + MONTH_FULL[parseInt(parts2[1])-1] + ' ' + parts2[0] + '</div>';
      }
    }
    var rows = byDate[date];
    var combined = rows.reduce(function(sum, r) { return sum + (r.attendance || 0); }, 0);
    var parts = date.split('-');
    var displayDate = (parts[1]|0) + '/' + (parts[2]|0) + '/' + parts[0];
    var s8 = rows.find(function(r){return r.service_time==='08:00';}) || {};
    var s1045 = rows.find(function(r){return r.service_time==='10:45';}) || {};
    var isSunday = rows.some(function(r){return r.service_type==='sunday';});
    var sundayName = (s8.service_name || s1045.service_name || (rows[0]&&rows[0].service_name) || '');
    var dk = date.replace(/-/g,'_');
    var isFuture = date > today2;
    html += '<div class="att-date-group' + (isFuture ? ' future' : '') + '">';
    html += '<div class="att-date-hdr" onclick="toggleAttEdit(&#39;'+dk+'&#39;)">'
      + '<span style="font-weight:700;color:var(--steel-anchor);min-width:88px;">'+displayDate+'</span>'
      + (sundayName ? '<span style="font-size:.75rem;color:var(--warm-gray);">'+esc(sundayName)+'</span>' : '')
      + '<span style="flex:1;"></span>'
      + (combined ? '<span class="att-combined">&#931; '+combined+'</span>' : '')
      + '<span class="att-edit-hint">&#9998;</span>'
      + '</div>';
    // Read-only summary
    if (isSunday) {
      html += '<div class="att-svc-nums">'
        + '<span><span class="att-svc-lbl">8am</span><span class="att-svc-v">'+(s8.attendance||0)+'</span></span>'
        + '<span><span class="att-svc-lbl">10:45am</span><span class="att-svc-v">'+(s1045.attendance||0)+'</span></span>'
        + '</div>';
    } else {
      html += '<div class="att-svc-nums">' + rows.map(function(s){
        return '<span><span class="att-svc-lbl">'+esc(s.service_name||s.service_time)+'</span><span class="att-svc-v">'+(s.attendance||0)+'</span></span>';
      }).join('') + '</div>';
    }
    // Inline edit form (hidden)
    html += '<div id="att-edit-'+dk+'" class="att-inline-form" style="display:none;">';
    if (isSunday) {
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;">'
        + '<div><div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--steel-anchor);margin-bottom:3px;">8am Attendance</div>'
        + '<input type="number" id="ai8-'+dk+'" min="0" value="'+(s8.attendance||0)+'" style="width:100%;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:1rem;font-weight:700;"></div>'
        + '<div><div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--steel-anchor);margin-bottom:3px;">10:45am Attendance</div>'
        + '<input type="number" id="ai1045-'+dk+'" min="0" value="'+(s1045.attendance||0)+'" style="width:100%;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:1rem;font-weight:700;"></div>'
        + '</div>'
        + '<div style="margin-bottom:10px;"><input type="text" id="ainotes-'+dk+'" value="'+esc(s8.notes||s1045.notes||'')+'" placeholder="Notes…" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;font-size:.85rem;"></div>'
        + '<div style="display:flex;gap:8px;">'
        + '<button class="btn-primary" style="font-size:.82rem;padding:5px 14px;" onclick="saveInlineAttEdit(&#39;'+dk+'&#39;,'+((s8.id)||'null')+','+((s1045.id)||'null')+')">Save</button>'
        + '<button class="btn-secondary" style="font-size:.82rem;padding:5px 14px;" onclick="toggleAttEdit(&#39;'+dk+'&#39;)">Cancel</button>'
        + (s8.id||s1045.id ? '<button class="btn-danger" style="font-size:.82rem;padding:5px 12px;margin-left:auto;" onclick="deleteAttDate(&#39;'+dk+'&#39;,['+[s8.id,s1045.id].filter(Boolean).join(',')+'])">Delete</button>' : '')
        + '</div>';
    } else {
      html += rows.map(function(s){
        return '<div style="margin-bottom:8px;"><div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--steel-anchor);margin-bottom:3px;">'+esc(s.service_name||s.service_time)+' Attendance</div>'
          + '<input type="number" id="aisingle-'+s.id+'" min="0" value="'+(s.attendance||0)+'" style="width:120px;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:1rem;font-weight:700;"></div>';
      }).join('')
        + '<div style="display:flex;gap:8px;">'
        + '<button class="btn-primary" style="font-size:.82rem;padding:5px 14px;" onclick="saveInlineSingle(['+rows.map(function(s){return s.id;}).join(',')+'],&#39;'+dk+'&#39;)">Save</button>'
        + '<button class="btn-secondary" style="font-size:.82rem;padding:5px 14px;" onclick="toggleAttEdit(&#39;'+dk+'&#39;)">Cancel</button>'
        + '</div>';
    }
    html += '</div></div>'; // end form + group
  });
  el.innerHTML = '<div class="att-list-card">' + html + '</div>';
}

function toggleAttEdit(dk) {
  var form = document.getElementById('att-edit-'+dk);
  if (!form) return;
  var isOpen = form.style.display !== 'none';
  document.querySelectorAll('.att-inline-form').forEach(function(f){f.style.display='none';});
  if (!isOpen) {
    form.style.display = '';
    form.scrollIntoView({behavior:'smooth', block:'nearest'});
    var inp = form.querySelector('input[type=number]');
    if (inp) { inp.focus(); inp.select(); }
  }
}
function saveInlineAttEdit(dk, id8, id1045) {
  var att8 = parseInt(document.getElementById('ai8-'+dk).value)||0;
  var att1045 = parseInt(document.getElementById('ai1045-'+dk).value)||0;
  var notes = document.getElementById('ainotes-'+dk).value;
  var saves = [];
  if (id8) saves.push(api('/admin/api/attendance/'+id8,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({attendance:att8,notes:notes})}));
  if (id1045) saves.push(api('/admin/api/attendance/'+id1045,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({attendance:att1045,notes:notes})}));
  Promise.all(saves).then(function(){loadAttendance();});
}
function saveInlineSingle(ids, dk) {
  var saves = ids.map(function(id){
    var val = parseInt(document.getElementById('aisingle-'+id).value)||0;
    return api('/admin/api/attendance/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({attendance:val})});
  });
  Promise.all(saves).then(function(){loadAttendance();});
}
function deleteAttDate(dk, ids) {
  if (!confirm('Delete these service records?')) return;
  Promise.all(ids.map(function(id){return api('/admin/api/attendance/'+id,{method:'DELETE'});})).then(function(){loadAttendance();});
}

function seedYearSundays() {
  var year = new Date().getFullYear();
  var yn = prompt('Seed all Sundays for which year?', year);
  if (!yn) return;
  year = parseInt(yn);
  if (isNaN(year)) return;
  api('/admin/api/attendance/seed-year', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({year:year})}).then(function(d) {
    if (d.ok) { alert('Added '+(d.inserted/2)+' Sundays for '+d.year+' ('+(d.skipped/2)+' already existed).'); loadAttendance(); }
  });
}

function openNewSundayEntry() {
  var today = new Date().toISOString().slice(0,10);
  var el = document.getElementById('att-add-form');
  el.style.display = '';
  el.innerHTML = '<div style="font-family:var(--font-head);font-size:1rem;color:var(--steel-anchor);margin-bottom:14px;">Add Sunday Services</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">'
    + '<div><label style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--warm-gray);">Date</label><input type="date" id="sf-date" value="'+today+'" onchange="fetchSundayName(this.value)" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;"></div>'
    + '<div><label style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--warm-gray);">Sunday Name</label><input type="text" id="sf-name" placeholder="e.g. Second Sunday of Easter" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;"></div>'
    + '</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">'
    + '<div><label style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--steel-anchor);">8am Attendance</label><input type="number" id="sf-att-8" min="0" placeholder="0" style="width:100%;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:1rem;font-weight:700;"></div>'
    + '<div><label style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--steel-anchor);">10:45am Attendance</label><input type="number" id="sf-att-1045" min="0" placeholder="0" style="width:100%;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:1rem;font-weight:700;"></div>'
    + '</div>'
    + '<div style="margin-bottom:12px;"><label style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--warm-gray);">Notes</label><input type="text" id="sf-notes" placeholder="Optional" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;"></div>'
    + '<div style="display:flex;gap:8px;"><button class="btn-primary" onclick="saveBulkSunday()">Save</button><button class="btn-secondary" onclick="document.getElementById(&#39;att-add-form&#39;).style.display=&#39;none&#39;">Cancel</button></div>';
  fetchSundayName(today);
}


function fetchSundayName(date) {
  if (!date) return;
  api('/admin/api/attendance/sunday-name?date=' + encodeURIComponent(date)).then(function(d) {
    var el = document.getElementById('sf-name');
    if (el && d.name) el.value = d.name;
  });
}

function saveBulkSunday() {
  var date = document.getElementById('sf-date').value;
  var name = document.getElementById('sf-name').value;
  if (!date) { alert('Please enter a date.'); return; }
  api('/admin/api/attendance/bulk-sunday', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      service_date: date, service_name: name,
      att_8: document.getElementById('sf-att-8').value,
      att_1045: document.getElementById('sf-att-1045').value,
      notes: document.getElementById('sf-notes').value
    })
  }).then(function(d) {
    if (d.error) { alert('Error: ' + d.error); return; }
    document.getElementById('att-add-form').style.display = 'none';
    loadAttendance();
  });
}


function runAttendanceSummary() {
  var years = [];
  document.querySelectorAll('#rpt-att-years input[type=checkbox]:checked').forEach(function(cb) {
    years.push(cb.value);
  });
  if (!years.length) { alert('Select at least one year.'); return; }
  api('/admin/api/reports/attendance-summary?years=' + encodeURIComponent(years.join(','))).then(function(d) {
    var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    var html = renderYoYChart(d);
    html += '<div style="font-family:var(--font-head);font-size:1rem;color:var(--steel-anchor);margin-bottom:4px;">Attendance Year-over-Year (Sunday Combined)</div>';
    html += '<div style="font-size:.78rem;color:var(--warm-gray);margin-bottom:12px;">Monthly values show average Sunday attendance for that month.</div>';
    html += '<table class="rpt-table"><thead><tr><th>Month</th>';
    d.years.forEach(function(yr) { html += '<th style="text-align:right;">' + yr + '<br><span style="font-weight:400;font-size:.75rem;">avg/Sun</span></th>'; });
    html += '</tr></thead><tbody>';
    for (var m = 1; m <= 12; m++) {
      var mStr = String(m).padStart(2, '0');
      html += '<tr><td>' + months[m-1] + '</td>';
      d.years.forEach(function(yr) {
        var row = (d.monthly[yr] || []).find(function(r) { return r.month === mStr; });
        var cell = row ? row.total + '<span style="color:var(--warm-gray);font-size:.75rem;"> ('+row.sundays+')</span>' : '—';
        html += '<td style="text-align:right;">' + cell + '</td>';
      });
      html += '</tr>';
    }
    html += '<tr class="rpt-total"><td>Annual Total</td>';
    d.years.forEach(function(yr) {
      html += '<td style="text-align:right;">' + ((d.totals[yr] || {}).total || 0) + '</td>';
    });
    html += '</tr><tr><td style="color:var(--warm-gray);font-size:.82rem;">Sundays recorded</td>';
    d.years.forEach(function(yr) {
      html += '<td style="text-align:right;color:var(--warm-gray);font-size:.82rem;">' + ((d.totals[yr] || {}).sundays || 0) + '</td>';
    });
    html += '</tr></tbody></table>'
      + '<div style="margin-top:8px;"><button class="btn-secondary" style="font-size:.8rem;" onclick="window.print()">Print</button></div>';
    showAttRptOutput(html);
  });
}

function runAttendanceByTime() {
  var from = document.getElementById('rpt-att-from').value;
  var to = document.getElementById('rpt-att-to').value;
  api('/admin/api/reports/attendance-by-time?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to)).then(function(d) {
    var html = renderByServiceChart(d);
    html += '<div style="font-family:var(--font-head);font-size:1rem;color:var(--steel-anchor);margin-bottom:12px;">Attendance by Service Time</div>';
    html += '<table class="rpt-table" style="margin-bottom:16px;"><thead><tr><th>Service</th><th style="text-align:right;">Services</th><th style="text-align:right;">Total</th><th style="text-align:right;">Avg/Service</th></tr></thead><tbody>';
    (d.by_time || []).forEach(function(r) {
      var lbl = r.service_name || (r.service_time === '08:00' ? '8am Service' : r.service_time === '10:45' ? '10:45am Service' : esc(r.service_time));
      html += '<tr><td>' + esc(lbl) + '</td><td style="text-align:right;">' + r.services + '</td><td style="text-align:right;">' + r.total + '</td><td style="text-align:right;">' + r.avg_attendance + '</td></tr>';
    });
    html += '</tbody></table>';
    if (d.sundays && d.sundays.length) {
      html += '<div style="font-weight:700;color:var(--steel-anchor);font-size:.88rem;margin-bottom:8px;">Sunday Combined Totals</div>';
      html += '<table class="rpt-table"><thead><tr><th>Date</th><th style="text-align:right;">8am</th><th style="text-align:right;">10:45am</th><th style="text-align:right;">Combined</th></tr></thead><tbody>';
      d.sundays.forEach(function(r) {
        var parts = r.service_date.split('-');
        var dsp = (parts[1]|0) + '/' + (parts[2]|0) + '/' + parts[0];
        html += '<tr><td>' + dsp + '</td><td style="text-align:right;">' + (r.att_8 || '—') + '</td><td style="text-align:right;">' + (r.att_1045 || '—') + '</td><td style="text-align:right;font-weight:600;">' + r.combined + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '<div style="margin-top:8px;"><button class="btn-secondary" style="font-size:.8rem;" onclick="window.print()">Print</button></div>';
    showAttRptOutput(html);
  });
}
</script>
</body>
</html>

`;

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
  document.getElementById('last-saved').textContent = 'Loading\u2026';
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
      document.getElementById('last-saved').textContent = 'Save failed \u2014 check connection';
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
