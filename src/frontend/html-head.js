export const HTML_HEAD = String.raw`<!DOCTYPE html>
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
/* ── PANELS ── */
.tab-panel{display:none;padding:20px 24px;}
.tab-panel.active{display:flex;flex-direction:column;flex:1;overflow-y:auto;}
#tab-scheduler.active{padding:0;}
#tab-scheduler .sched-root{flex:1;min-height:0;overflow-y:auto;}
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
.rpt-group-hdr td{background:var(--linen);font-weight:700;font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--warm-gray);padding:5px 10px;border-bottom:none !important;}
.rpt-group-sub td{font-style:italic;font-weight:600;background:#faf7f4;border-bottom:1px solid var(--border) !important;}
.rpt-overview{display:flex;flex-wrap:wrap;gap:18px;margin-bottom:14px;}
.rpt-stat{background:var(--linen);border:1px solid var(--border);border-radius:8px;padding:10px 16px;min-width:140px;flex:1 1 140px;max-width:220px;}
.rpt-stat-num{font-size:1.35rem;font-weight:700;font-family:var(--font-head);color:var(--steel-anchor);line-height:1.1;}
.rpt-stat-lbl{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--warm-gray);margin-top:3px;}
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
.pv-photo-wrap{position:relative;flex-shrink:0;width:88px;height:88px;}
.pv-photo-wrap .pv-photo{width:100%;height:100%;}
.pv-photo-upload-overlay{position:absolute;inset:0;border-radius:50%;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .15s;cursor:pointer;}
.pv-photo-wrap:hover .pv-photo-upload-overlay{opacity:1;}
.pv-photo-upload-overlay svg{pointer-events:none;}
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
@media(max-width:700px){.pv-info-cols{grid-template-columns:1fr;}.pv-layout{flex-direction:column;}.pv-aside{width:100%;border-left:none;border-top:1px solid var(--border);}}
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
/* ── ROLE-BASED VISIBILITY ── */
/* .require-finance  = visible only for admin + finance */
/* .require-staff    = visible only for admin + staff   */
/* .require-edit     = visible for admin + finance + staff (not member) */
/* .require-admin    = admin only */
/* .no-member        = hidden for member role */
.role-staff  .require-finance{display:none!important;}
.role-member .require-finance{display:none!important;}
.role-finance .require-staff{display:none!important;}
.role-member .require-staff{display:none!important;}
.role-member .require-edit{display:none!important;}
.role-member .no-member{display:none!important;}
.role-finance .require-admin{display:none!important;}
.role-staff   .require-admin{display:none!important;}
.role-member  .require-admin{display:none!important;}
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
  <div class="s-item" data-tab="organizations" onclick="showTab('organizations')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="1"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/><line x1="12" y1="12" x2="12" y2="17"/><line x1="9" y1="14.5" x2="15" y2="14.5"/></svg><span class="s-tip">Organizations</span></div>
  <div class="s-divider"></div>
  <div class="s-item require-finance" data-tab="giving" onclick="showTab('giving')"><svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8L2 7h20l-6-4z"/></svg><span class="s-tip">Giving</span></div>
  <div class="s-item require-staff" data-tab="attendance" onclick="showTab('attendance')"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4"/></svg><span class="s-tip">Attendance</span></div>
  <div class="s-item no-member" data-tab="reports" onclick="showTab('reports')"><svg viewBox="0 0 24 24"><path d="M18 20V10M12 20V4M6 20v-6"/></svg><span class="s-tip">Reports</span></div>
  <div class="s-item require-staff" data-tab="register" onclick="showTab('register')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/><line x1="9" y1="7" x2="17" y2="7"/><line x1="9" y1="11" x2="14" y2="11"/></svg><span class="s-tip">Register</span></div>
  <div class="s-divider require-admin"></div>
  <div class="s-item require-admin" data-tab="volunteers" onclick="showTab('volunteers')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg><span class="s-tip">Volunteers</span></div>
  <div class="s-item require-admin" data-tab="scheduler" onclick="showTab('scheduler')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg><span class="s-tip">Scheduler</span></div>
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
    <a href="/admin/logout" class="btn-sm">Sign Out</a>
  </div>
</div>

`;
