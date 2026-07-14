export const HTML_HEAD = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>TLC Gather — Timothy Lutheran</title>
<link rel="manifest" href="/chms.webmanifest">
<meta name="theme-color" content="#1E2D4A">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Gather">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/icons/icon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500;1,600&family=DM+Sans:wght@300;400;500;600;700&family=Lora:ital,wght@0,400;0,600;1,400;1,600&display=swap" rel="stylesheet">
<style>
/* ── PAL1: Canonical Palette A token reference ──────────────────────────
   Single source of truth for color tokens across all three surfaces
   (admin app below, src/public/head.js, src/scheduler-html.js). Built by
   deriving shades/tints from the 4 core brand colors. Legacy/--ev-* names
   below are kept as aliases (zero visual change) so existing rules don't
   need renaming yet — new code should reach for the semantic name.
     Core:     --color-navy #1E2D4A · --color-teal #2E7EA6 · --color-gold
               #C9973A · --color-cream #F8F4EE
     Neutrals: --charcoal #1A1A2A (ink) · --warm-gray #7A6E60 (muted text)
               · --white #FFFFFF · --linen #F2EDE2 · --border #E8E0D0
     Navy:     --deep-steel #2A3F60 (mid) · --mid-steel #3D627C (soft)
               · --ice-blue #C4DDE8 (pale)
     Teal:     --sky-steel #5C8FA8 (soft) · --blue-mist #EAF4FA (pale)
     Gold:     --deep-amber #A87B23 (deep) · --pale-gold #F5E0B0 (pale)
     Status:   --sage #6B8F71 (success/positive — lighter green, used for
               badges/status text) · --ev-moss #4A5E3A (a second, darker
               green used for the Acceptance ministry identity + "open
               slots" indicators — legitimately distinct from --sage, not
               a duplicate to merge) · --danger #B85C3A (all error/delete
               affordances; --ev-danger now aliases this — was a genuine
               duplicate red, #c0392b, reconciled here)
   See CLAUDE.md "Pre-Redesign Palette Consolidation" for the full sweep
   plan (PAL2 admin usages, PAL3 public site, PAL4 scheduler, PAL5 inline
   hex cleanup). ── */
:root{
  /* ── TLC Gather brand tokens ── */
  --color-navy:#1E2D4A;--color-teal:#2E7EA6;--color-gold:#C9973A;
  --color-cream:#F8F4EE;--color-light-teal:#EAF4FA;
  /* Legacy tokens (aliased to brand palette so older rules pick up the new look without renames) */
  --steel-anchor:#1E2D4A;--deep-steel:#2A3F60;--mid-steel:#3D627C;--sky-steel:#5C8FA8;
  --ice-blue:#C4DDE8;--blue-mist:#EAF4FA;--amber:#C9973A;--deep-amber:#A87B23;
  --pale-gold:#F5E0B0;--sage:#6B8F71;--pale-sage:#CDE0CF;--warm-white:#F8F4EE;
  --linen:#F2EDE2;--white:#FFFFFF;--border:#E8E0D0;--charcoal:#1A1A2A;--warm-gray:#7A6E60;
  --font-display:'Cormorant Garamond',Georgia,serif;
  --font-head:'DM Sans','Source Sans 3',Arial,sans-serif;
  --font-body:'DM Sans','Source Sans 3',Arial,sans-serif;
  --danger:#B85C3A;
  --navy:#1E2D4A;--teal:#2E7EA6;--gold-accent:#C9973A;
  --bg:#F8F4EE;--muted:#6B7280;--faint:#9CA3AF;
  /* ── Warm redesign tokens (People list / Person Profile / Household View) ── */
  --warm-ink-label:#5C4B2E;--warm-meta:#8A7A5C;
  --warm-border:#E5D9BE;--warm-divider:#EEE2C8;--warm-row-divider:#F1E7D2;
  --warm-surface-card:#FFFDF9;--warm-surface-page:#FBF8F1;
  --warm-surface-header:#FBF3E1;--warm-surface-card-page:#F4EFE2;
  --status-member:#6B8F71;--status-visitor:#4D6BA0;--status-associate:#2E7EA6;
  --status-friend:#8A7A5C;--status-inactive:#C9973A;--status-organization:#5C4B2E;
  /* ── Volunteer/Events design-handoff palette (exact mockup values, kept
     separate from the tokens above so this feature area can match its
     mockups pixel-for-pixel without altering the rest of the app) ── */
  --ev-navy:#1E2D4A;--ev-teal:#2E7EA6;--ev-muted:#8A8898;--ev-ink:#1A1A2A;
  --ev-border:rgba(30,45,74,.12);--ev-border2:rgba(30,45,74,.18);
  --ev-cream:#F7F3EC;--ev-moss:#4A5E3A;--ev-danger:var(--danger);
}
*{box-sizing:border-box;margin:0;padding:0;}
html,body{height:100%;overflow:hidden;}
body{font-family:var(--font-body);background:var(--warm-white);color:var(--charcoal);}
a{color:var(--sky-steel);}
/* ── HEADER (legacy <header> element no longer rendered; rules removed PR 4/4) ── */
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
/* ── SIDEBAR ──
   Off-canvas drawer at all screen sizes — opened via the hamburger button in the
   topbar, closed by picking a tab or tapping the backdrop. Replaces the old
   always-present icon rail that hover-expanded to 200px (it ate a fixed slice of
   every screen's width and didn't match any of the design mockups, which all
   assume a full-width working area). ── */
.sidebar{position:fixed;left:-200px;top:0;height:100vh;width:200px;background:var(--navy);display:flex;flex-direction:column;align-items:stretch;padding:12px 0;gap:4px;overflow-y:auto;transition:left .2s ease;z-index:200;}
.sidebar.open{left:0;}
a.s-item{text-decoration:none;color:inherit;}
.s-logo{width:34px;height:34px;border-radius:8px;background:var(--color-navy);display:flex;align-items:center;justify-content:center;margin-bottom:10px;flex-shrink:0;cursor:pointer;align-self:center;overflow:hidden;}
.s-logo svg{width:32px;height:32px;display:block;}
.s-item{width:100%;height:38px;border-radius:9px;display:flex;align-items:center;justify-content:flex-start;padding:0 8px 0 14px;gap:10px;cursor:pointer;position:relative;flex-shrink:0;transition:background .12s;overflow:hidden;white-space:nowrap;}
.s-item:hover{background:rgba(255,255,255,.08);}
.s-item.active{background:rgba(46,126,166,.22);box-shadow:inset 3px 0 0 var(--color-teal);}
.s-item svg{width:19px;height:19px;fill:none;stroke:rgba(255,255,255,.55);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0;}
.s-item.active svg{stroke:var(--white);}
.s-divider{width:28px;height:1px;background:rgba(255,255,255,.15);margin:4px 0;flex-shrink:0;align-self:center;}
.s-section-hdr{font-family:var(--font-body);font-size:10px;font-weight:500;letter-spacing:.3em;text-transform:uppercase;color:var(--color-gold);padding:10px 14px 4px;white-space:nowrap;}
.s-bottom{margin-top:auto;display:flex;flex-direction:column;align-items:stretch;gap:4px;}
.s-tip{position:static;transform:none;background:transparent;border:none;padding:0;font-size:13px;color:rgba(255,255,255,.7);white-space:nowrap;pointer-events:none;z-index:auto;}
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
.content-area{flex:1;display:flex;flex-direction:column;overflow:hidden;margin-left:0;}
/* ── TOPBAR ── */
.topbar{height:50px;border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 20px;gap:12px;flex-shrink:0;background:var(--white);}
.topbar-title{font-size:15px;font-weight:500;color:var(--charcoal);flex:1;}
.hamburger{display:flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;padding:0;}
.hamburger svg{width:22px;height:22px;stroke:var(--charcoal);fill:none;stroke-width:2;}
.sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:90;}
.sidebar-overlay.open{display:block;}
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
/* ── TLC Gather three-pill section identifiers ── */
.pill-section{display:inline-flex;align-items:center;padding:3px 11px;border-radius:99px;font-family:var(--font-body);font-size:10px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:var(--white);white-space:nowrap;line-height:1.4;}
.pill-section.pill-people{background:var(--color-navy);}
.pill-section.pill-ministry{background:var(--color-teal);}
.pill-section.pill-giving{background:var(--color-gold);color:var(--color-navy);}
.pill-section[hidden]{display:none;}
/* ── BUTTONS ── */
.btn-primary{padding:8px 18px;background:var(--steel-anchor);color:var(--white);border:none;border-radius:8px;font-family:var(--font-body);font-size:.9rem;font-weight:700;cursor:pointer;transition:background .15s;}
.btn-primary:hover{background:var(--deep-steel);}
.btn-secondary{padding:8px 16px;background:var(--linen);color:var(--charcoal);border:1.5px solid var(--border);border-radius:8px;font-family:var(--font-body);font-size:.9rem;font-weight:600;cursor:pointer;transition:background .15s;}
.btn-secondary:hover{background:var(--blue-mist);}
.btn-danger{padding:7px 14px;background:none;color:var(--danger);border:1.5px solid var(--danger);border-radius:7px;font-family:var(--font-body);font-size:.85rem;font-weight:600;cursor:pointer;}
.btn-danger:hover{background:#fdf0ec;}
/* Larger touch targets on small screens (WCAG 2.5.5: 44px minimum). */
@media(max-width:600px){
  .btn-primary,.btn-secondary,.btn-danger{padding-top:11px;padding-bottom:11px;min-height:44px;}
}
/* ── PERSON CARDS ── */
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;}
.p-card{background:var(--white);border:1px solid var(--border);border-radius:12px;box-shadow:0 2px 10px rgba(30,45,74,.06);cursor:pointer;overflow:hidden;transition:box-shadow .15s;}
.p-card:hover{box-shadow:0 4px 16px rgba(30,45,74,.1);}
.p-card.member{border-left:3px solid var(--color-navy);}
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
.h-card{background:var(--white);border:1px solid var(--border);border-radius:12px;box-shadow:0 2px 10px rgba(30,45,74,.06);cursor:pointer;padding:16px 18px;transition:box-shadow .15s;}
.h-card:hover{box-shadow:0 4px 16px rgba(30,45,74,.1);}
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
.pm-date-clear{background:none;border:none;color:var(--teal,#2E7EA6);font-size:.72rem;font-weight:600;cursor:pointer;padding:0;text-decoration:underline;text-transform:none;letter-spacing:normal;white-space:nowrap;}
.pm-date-clear:hover{color:var(--danger,#B85C3A);}
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
.report-tile:hover{box-shadow:0 4px 16px rgba(30,45,74,.1);}
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
@media(max-width:480px){.modal{padding:18px 16px;max-height:95vh;border-radius:10px;}}
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
  #p-grid,#p-card-grid,.view-toggle{display:none!important;}
  .contact-list{display:flex;flex-direction:column;background:var(--warm-surface-card);}
  .toolbar .filter-pills{display:none;}
  .c-card{display:flex;align-items:center;gap:14px;padding:14px 16px;border-bottom:1px solid var(--warm-row-divider);background:var(--warm-surface-card);cursor:pointer;}
  .c-avatar{width:50px;height:50px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:var(--font-head);font-size:1rem;font-weight:800;overflow:hidden;}
  .c-avatar img{width:100%;height:100%;object-fit:cover;}
  .c-info{flex:1;min-width:0;}
  .c-name{font-weight:800;font-size:1.05rem;color:var(--color-navy);}
  .c-type{margin:4px 0 9px;}
  .c-actions{display:flex;gap:8px;flex-wrap:wrap;}
  .c-btn{display:inline-flex;align-items:center;gap:6px;font-size:.85rem;font-weight:700;padding:8px 14px;border-radius:99px;min-height:36px;text-decoration:none;white-space:nowrap;box-sizing:border-box;}
  .c-btn svg{width:14px;height:14px;flex-shrink:0;}
  .c-btn-call{background:var(--color-teal);color:var(--white);}
  .c-btn-outline{background:var(--warm-surface-header);border:1.5px solid var(--warm-border);color:var(--color-navy);}
}
/* ── MULTI-SELECT ── */
.p-card.selectable{cursor:pointer;position:relative;}
.p-card.selectable:hover{box-shadow:0 0 0 2px var(--steel-anchor);}
.p-card.selected{box-shadow:0 0 0 3px var(--steel-anchor);background:var(--blue-mist);}
.p-select-cb{position:absolute;top:8px;left:8px;width:18px;height:18px;border:2px solid var(--border);border-radius:4px;background:var(--white);display:flex;align-items:center;justify-content:center;z-index:2;}
.p-card.selected .p-select-cb{background:var(--steel-anchor);border-color:var(--steel-anchor);color:var(--white);}
/* ── SETTINGS ── */
code{background:var(--linen);padding:1px 5px;border-radius:4px;font-size:.85em;font-family:monospace;}
/* ── PEOPLE DIRECTORY TABLE ── */
.dir-table{width:100%;border-collapse:collapse;font-size:14px;background:var(--warm-surface-card);}
.dir-table th{text-align:left;padding:12px 16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--warm-ink-label);border-bottom:2px solid var(--warm-divider);background:var(--warm-surface-header);white-space:nowrap;position:sticky;top:0;z-index:1;}
.dir-table td{padding:14px 16px;border-bottom:1px solid var(--warm-row-divider);vertical-align:middle;font-size:14px;}
.dir-table tbody tr:nth-child(even) td{background:#FCF9F1;}
.dir-table tbody tr:hover td{background:#F5EFDD;}
.dir-table tbody tr.dir-row-selected td{background:var(--warm-surface-header);}
.dir-name-cell{display:flex;align-items:center;gap:11px;}
.dir-avatar{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;}
.dir-avatar-org{border-radius:8px!important;background:var(--linen);}
.dir-avatar-0{background:var(--pale-gold);color:#8A5A12;}
.dir-avatar-1{background:var(--blue-mist);color:var(--color-teal);}
.dir-avatar-2{background:#F0D7C4;color:#8A4A1E;}
.dir-avatar-3{background:#D9E8D3;color:#3F5E38;}
.dir-avatar-4{background:#F0C9B8;color:#7A3418;}
.dir-name-link{color:var(--color-navy);font-weight:700;font-size:14px;}
/* Color-coded dot + label (replaces filled pill for member type throughout People/Profile/Household) */
.type-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;flex-shrink:0;}
.type-label{font-size:13px;font-weight:600;vertical-align:middle;}
.dir-contact a{text-decoration:none;}
.dir-phone-main a{color:var(--color-teal);font-size:14px;font-weight:500;}
.dir-email-sub{margin-top:2px;}
.dir-email-sub a{color:var(--warm-meta);font-size:12px;}
#p-grid{flex:1;min-height:0;overflow-y:auto;display:block;}
#p-card-grid{flex:1;min-height:0;overflow-y:auto;display:none;padding:2px 2px 0;}
#p-pager{position:sticky;bottom:0;background:var(--white);border-top:1px solid var(--border);padding:9px 16px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
/* ── PEOPLE LIST — VIEW TOGGLE + CARD VIEW (2a/2b) ── */
.view-toggle{display:flex;border:1.5px solid var(--warm-border);border-radius:9px;overflow:hidden;flex-shrink:0;}
.view-toggle button{padding:8px 14px;background:var(--white);color:var(--warm-meta);font-size:.8rem;font-weight:700;border:none;cursor:pointer;font-family:var(--font-body);white-space:nowrap;}
.view-toggle button.active{background:var(--color-navy);color:var(--white);}
.ppl-card-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;background:var(--warm-surface-card-page);padding:16px;border-radius:12px;}
@media(max-width:1000px){.ppl-card-grid{grid-template-columns:1fr;}}
.ppl-card{background:var(--warm-surface-card);border-radius:12px;border-left:4px solid var(--status-member);box-shadow:0 2px 10px rgba(120,90,30,.08);padding:14px 16px;cursor:pointer;position:relative;transition:box-shadow .15s;}
.ppl-card:hover{box-shadow:0 4px 16px rgba(120,90,30,.14);}
.ppl-card.selected{box-shadow:0 0 0 3px var(--color-navy);}
.ppl-card-top{display:flex;align-items:center;gap:11px;margin-bottom:10px;}
.ppl-card-name{font-weight:700;font-size:14px;color:var(--color-navy);line-height:1.2;}
.ppl-card-phone{font-size:12.5px;color:var(--color-teal);margin-bottom:2px;}
.ppl-card-email{font-size:12.5px;color:var(--warm-meta);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ppl-card-cb{position:absolute;top:8px;right:8px;width:18px;height:18px;border:2px solid var(--warm-border);border-radius:4px;background:var(--white);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--white);}
.ppl-card.selected .ppl-card-cb{background:var(--color-navy);border-color:var(--color-navy);}
/* ── DASHBOARD ── */
.dash-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px;}
@media(max-width:900px){.dash-stats{grid-template-columns:repeat(2,1fr);}}
@media(max-width:480px){.dash-stats{grid-template-columns:1fr 1fr;}}
.dash-stat{background:var(--white);border:1px solid var(--border);border-radius:12px;padding:18px 20px;display:flex;flex-direction:column;gap:4px;}
.dash-stat-val{font-size:30px;font-weight:800;color:var(--charcoal);line-height:1;}
.dash-stat-lbl{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--warm-gray);}
.dash-stat-sub{font-size:11px;color:var(--teal);}
.dash-stat-quad-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;}
.dash-stat-quad-grid .dash-stat-val{font-size:22px;}
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
.dash-quick-btn:hover{border-color:var(--teal);box-shadow:0 0 0 3px rgba(46,126,166,.12);}
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
#profile-view{display:none;flex-direction:column;flex:1;overflow:hidden;background:var(--warm-surface-card);}
.pv-body{flex:1;overflow-y:auto;display:flex;flex-direction:column;}
.pv-hdr{display:flex;align-items:flex-start;gap:18px;padding:22px 24px 18px;border-bottom:1px solid var(--warm-divider);flex-shrink:0;background:var(--white);}
.pv-photo{width:88px;height:88px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:700;flex-shrink:0;box-shadow:0 2px 8px rgba(120,90,30,.15);}
.pv-photo-wrap{position:relative;flex-shrink:0;width:88px;height:88px;}
.pv-photo-wrap .pv-photo{width:100%;height:100%;}
.pv-photo-upload-overlay{position:absolute;inset:0;border-radius:50%;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .15s;cursor:pointer;}
.pv-photo-wrap:hover .pv-photo-upload-overlay{opacity:1;}
.pv-photo-upload-overlay svg{pointer-events:none;}
.pv-hdr-info{flex:1;}
.pv-fullname{font-family:var(--font-display);font-size:28px;font-weight:700;color:var(--color-navy);line-height:1.2;}
.pv-meta{display:flex;align-items:center;gap:10px;margin-top:6px;flex-wrap:wrap;}
.pv-meta-sep{color:var(--warm-border);}
.pv-hh-link{font-size:13px;color:var(--color-teal);font-weight:600;cursor:pointer;}
.pv-hh-link:hover{text-decoration:underline;}
.pv-role-txt{font-size:13px;color:var(--warm-meta);}
.pv-hdr-actions{display:flex;gap:8px;flex-shrink:0;}
.pv-mobile-only{display:none!important;}
.pv-tabs{display:flex;border-bottom:1px solid var(--warm-divider);padding:0 24px;flex-shrink:0;background:var(--white);}
.pv-tab{font-size:14px;padding:13px 18px;color:var(--warm-meta);cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-1px;transition:all .12s;}
.pv-tab:hover{color:var(--color-navy);}
.pv-tab.active{color:var(--color-navy);border-bottom-color:var(--color-gold);font-weight:700;}
.pv-layout{display:flex;flex:1;overflow:hidden;}
.pv-main{flex:1;padding:22px 24px;overflow-y:auto;background:var(--warm-surface-page);}
.ptab-panel{display:none;}
.ptab-panel.active{display:block;}
/* Two-column info layout */
.pv-info-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;}
@media(max-width:700px){
  .pv-info-cols{grid-template-columns:1fr;}
  .pv-layout{flex-direction:column;overflow:visible;flex:none;}
  .pv-main{flex:none;overflow:visible;}
  .pv-aside{width:100%;border-left:none;border-top:1px solid var(--warm-divider);flex:none;overflow:visible;}
  .pv-hdr{flex-direction:column;align-items:center;text-align:center;padding:20px 18px 16px;}
  .pv-meta{justify-content:center;}
  .pv-hdr-actions{width:100%;flex-wrap:wrap;}
  .pv-hdr-actions>*{flex:1;min-width:0;justify-content:center;min-height:44px;}
  .pv-desktop-only{display:none!important;}
  .pv-mobile-only{display:inline-flex!important;}
  /* Mobile shows Information only — Giving/Attendance/Timeline are desktop-only for this view */
  .pv-tabs{display:none;}
  .ptab-panel{display:none!important;}
  #ptab-info{display:block!important;}
}
.pv-section{background:var(--warm-surface-card);border:1px solid var(--warm-divider);border-radius:10px;padding:18px 20px;margin-bottom:16px;}
.pv-section-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--warm-ink-label);margin-bottom:12px;}
.pv-row{display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--warm-row-divider);}
.pv-row:last-child{border-bottom:none;}
.pv-row-key{width:100px;flex-shrink:0;font-size:12px;color:var(--warm-meta);padding-top:1px;}
.pv-row-val{flex:1;font-size:14px;color:var(--color-navy);}
.pv-row-val a{color:var(--color-teal);font-weight:500;text-decoration:none;}
.pv-row-val a:hover{text-decoration:underline;}
.pv-row-val.empty{color:var(--faint);font-style:italic;}
/* Demographics card grid (Church360-style) */
.pv-field-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:4px;}
.pv-field-card{border:1px solid var(--warm-divider);border-radius:8px;padding:9px 12px;background:var(--warm-surface-page);}
.pv-field-card-lbl{font-size:11px;color:var(--warm-meta);text-transform:lowercase;letter-spacing:.02em;margin-bottom:3px;}
.pv-field-card-val{font-size:14px;color:var(--color-navy);font-weight:600;}
.pv-field-card-val.empty{color:var(--faint);font-style:italic;font-weight:400;}
.pv-family-member{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--warm-row-divider);}
.pv-family-member:last-child{border-bottom:none;}
.pv-family-avatar{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;}
.pv-family-name{font-size:14px;font-weight:700;color:var(--color-navy);}
.pv-family-meta{font-size:11px;color:var(--warm-meta);}
/* aside */
.pv-aside{width:190px;border-left:1px solid var(--warm-divider);padding:20px 18px;flex-shrink:0;background:var(--white);overflow-y:auto;}
.pv-aside-block{margin-bottom:18px;}
.pv-aside-block+.pv-aside-block{padding-top:18px;border-top:1px solid var(--warm-divider);}
.pv-aside-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--warm-meta);margin-bottom:6px;}
.pv-aside-big{font-size:26px;font-weight:800;color:var(--color-navy);line-height:1;}
.pv-aside-sub{font-size:12px;color:var(--warm-meta);margin-top:3px;}
.pv-aside-link{font-size:12px;color:var(--color-teal);cursor:pointer;display:block;padding:3px 0;}
.pv-aside-link:hover{text-decoration:underline;}
.topbar-back{font-size:13px;color:var(--color-teal);font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;}
.topbar-back:hover{text-decoration:underline;}
/* ── Shared pill buttons (Call / outlined-cream) used across People / Profile / Household ── */
.btn-call{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 16px;background:var(--color-teal);color:var(--white);border:none;border-radius:9px;font-family:var(--font-body);font-size:13px;font-weight:700;cursor:pointer;text-decoration:none;}
.btn-call:hover{opacity:.92;}
.btn-outline-cream{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 16px;background:var(--warm-surface-header);border:1.5px solid var(--warm-border);color:var(--color-navy);border-radius:9px;font-family:var(--font-body);font-size:13px;font-weight:700;cursor:pointer;text-decoration:none;}
.btn-outline-cream:hover{background:var(--warm-surface-card-page);}
.pv-pill-btn{display:block;width:100%;text-align:center;padding:8px;border:1.5px solid var(--warm-border);background:var(--warm-surface-card);border-radius:8px;font-size:12px;font-weight:700;color:var(--color-navy);cursor:pointer;}
.pv-pill-btn:hover{background:var(--warm-surface-header);}
/* ── HOUSEHOLD VIEW (full page, mirrors Person Profile) ── */
.content-area.hv-mode > .topbar{display:none;}
.content-area.hv-mode > .tab-panel{display:none!important;}
.content-area.hv-mode > #household-view{display:flex;}
#household-view{display:none;flex-direction:column;flex:1;overflow:hidden;background:var(--warm-surface-card);}
.hv-body{flex:1;overflow-y:auto;}
.hv-hdr{display:flex;align-items:flex-start;gap:18px;padding:22px 24px;border-bottom:1px solid var(--warm-divider);background:var(--white);}
.hv-icon-tile{width:76px;height:76px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:26px;background:var(--warm-surface-header);border:1px solid var(--warm-divider);}
.hv-name{font-family:var(--font-display);font-size:26px;font-weight:700;color:var(--color-navy);}
.hv-addr{font-size:14px;color:var(--warm-meta);margin-top:6px;}
.hv-main{padding:22px 24px;}
.hv-section-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--warm-ink-label);margin-bottom:12px;}
.hv-member-row{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--warm-row-divider);cursor:pointer;}
.hv-member-row:last-child{border-bottom:none;}
.hv-member-avatar{width:40px;height:40px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;}
.hv-member-name{font-size:15px;font-weight:700;color:var(--color-navy);}
.hv-member-role{font-size:12px;color:var(--warm-meta);}
.hv-summary{margin-top:20px;padding:16px 18px;background:var(--warm-surface-header);border-radius:10px;display:flex;gap:28px;flex-wrap:wrap;}
.hv-summary-lbl{font-size:11px;font-weight:700;text-transform:uppercase;color:var(--warm-meta);margin-bottom:3px;}
.hv-summary-val{font-size:22px;font-weight:800;color:var(--color-navy);}
@media(max-width:700px){
  .hv-hdr{flex-direction:column;align-items:center;text-align:center;padding:18px;}
  .hv-icon-tile{width:60px;height:60px;font-size:22px;}
  .hv-name{font-size:20px;}
  .hv-addr{font-size:13px;}
  .hv-summary{display:none!important;}
}
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
/* ── Volunteers tab sub-navigation (Signups / Ministry Roles / Events) — a
   left-side navy menu column matching the design mockup's inner "TLC Admin"
   sidebar exactly, not a horizontal tab row. Sits inside the same shell card
   as the list+detail pane to its right (see vol-subnav markup in html-tabs.js). ── */
.vol-subnav{width:170px;flex-shrink:0;background:var(--color-navy);padding:16px 10px;display:flex;flex-direction:column;gap:2px;align-self:stretch;}
.vol-subtab-btn{text-align:left;background:none;border:none;color:rgba(255,255,255,.55);font-family:var(--font-body);font-size:12.5px;font-weight:600;padding:8px 10px;border-radius:6px;cursor:pointer;}
.vol-subtab-btn.active{color:var(--white);background:rgba(255,255,255,.12);}
.vol-subtab-btn:hover:not(.active){color:var(--white);background:rgba(255,255,255,.08);}
.vol-subnav-divider{height:1px;background:rgba(255,255,255,.15);margin:6px 4px;}
/* Below ~700px the fixed-width dark rail no longer fits next to the content
   pane (it was squeezing everything else into a sliver) — stack it above
   the content as a horizontal scrollable pill row instead. */
@media(max-width:700px){
  .vol-shell{flex-direction:column;}
  .vol-subnav{width:100%;flex-direction:row;flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;padding:10px 12px;gap:6px;}
  .vol-subtab-btn{white-space:nowrap;flex-shrink:0;}
  .vol-subnav-divider{width:1px;height:24px;margin:0 4px;flex-shrink:0;}
  .vol-content-pane{padding:16px !important;}
}
/* ── Events / Ministry Roles: master-detail — exact palette from the design
   handoff mockups (navy/teal/muted-gray-blue tokens defined in :root above),
   named .ev-* so it doesn't touch this app's existing warm navy/tan tokens
   used elsewhere. Flush (no own card chrome) — it now sits inside the shared
   shell card alongside .vol-subnav. ── */
.ev-master-detail{
  display:flex;align-items:stretch;
}
.ev-list-col{width:250px;flex-shrink:0;display:flex;flex-direction:column;border-right:1px solid var(--ev-border);}
.ev-list-col-wide{width:290px;}
.ev-list-header{padding:16px 16px 10px;}
.ev-list-header h4{font-family:'Lora',serif;font-weight:600;font-size:1rem;color:var(--ev-navy);margin:0 0 10px;}
.ev-list-header-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;}
.ev-list-header-row h4{margin:0;}
.ev-list-search input{background:var(--ev-cream);border:1px solid var(--ev-border);border-radius:8px;font-size:.82rem;color:var(--ev-muted);}
.ev-list-rows{flex:1;overflow-y:auto;min-height:80px;}
.ev-list-footer{padding:12px 16px;border-top:1px solid var(--ev-border);}
.ev-list-footer button{width:100%;background:var(--ev-navy);color:var(--white);border:none;border-radius:8px;padding:9px;font-size:.82rem;font-weight:600;cursor:pointer;}
.ev-new-btn{background:var(--ev-navy);color:var(--white);border:none;border-radius:7px;padding:6px 11px;font-size:.75rem;font-weight:600;cursor:pointer;flex-shrink:0;}
.ev-list-group-hdr{padding:12px 16px 4px;font-size:.68rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ev-muted);cursor:pointer;display:flex;align-items:center;gap:5px;user-select:none;}
.ev-list-group-hdr:first-child{padding-top:8px;}
.ev-list-group-hdr:hover{color:var(--ev-navy);}
.ev-list-group-chevron{display:inline-block;font-size:.6rem;transition:transform .15s;}
.ev-list-group-hdr.collapsed .ev-list-group-chevron{transform:rotate(-90deg);}
.ev-list-group-active-dot{width:6px;height:6px;border-radius:50%;background:var(--ev-teal);flex-shrink:0;}
.ev-list-row{padding:10px 16px;border-left:3px solid transparent;cursor:pointer;}
.ev-list-row:hover{background:rgba(30,45,74,.03);}
.ev-list-row.active{background:rgba(46,126,166,.08);border-left-color:var(--ev-teal);}
.ev-list-row .ev-list-name{font-weight:600;font-size:.82rem;color:var(--ev-navy);}
.ev-list-row.active .ev-list-name{font-weight:700;}
.ev-list-row .ev-list-meta{font-size:.7rem;color:var(--ev-muted);margin-top:2px;}
.ev-detail-col{flex:1;min-width:0;padding:22px 26px;overflow-y:auto;}
.ev-detail-topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;}
.ev-badge-open{background:rgba(74,94,58,.1);color:var(--ev-moss);font-size:.7rem;font-weight:600;padding:3px 9px;border-radius:100px;}
.ev-badge-visible{background:rgba(46,126,166,.1);color:var(--ev-teal);font-size:.69rem;font-weight:600;padding:3px 9px;border-radius:100px;}
.ev-badge-hidden{background:rgba(192,57,43,.08);color:var(--ev-danger);font-size:.7rem;font-weight:600;padding:3px 9px;border-radius:100px;}
.ev-field-row{display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:14px;}
@media(max-width:600px){.ev-field-row{grid-template-columns:1fr;}}
.ev-delete-link{color:var(--ev-danger);font-size:.78rem;font-weight:600;text-decoration:none;cursor:pointer;}
.ev-fields{display:flex;flex-direction:column;gap:14px;max-width:480px;}
.ev-fields label,.ev-field-row label{display:block;font-size:.66rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ev-muted);margin-bottom:5px;}
.ev-fields input[type=text],.ev-fields input[type=date],.ev-fields select,.ev-fields textarea,
.ev-field-row input[type=text],.ev-field-row input[type=date],.ev-field-row select,.ev-field-row textarea{
  background:var(--white);border:1.5px solid var(--ev-border2);border-radius:7px;padding:9px 12px;font-size:.85rem;color:var(--ev-ink);width:100%;font-family:inherit;
}
.ev-fields textarea{min-height:64px;resize:vertical;}
.ev-toggle-row{display:flex;align-items:center;gap:10px;background:var(--ev-cream);border-radius:8px;padding:10px 12px;}
.ev-fields label.ev-toggle-row,.ev-field-row label.ev-toggle-row{display:flex;align-items:center;text-transform:none;font-size:.78rem;font-weight:600;letter-spacing:normal;color:var(--ev-navy);margin-bottom:0;}
.ev-btn-primary{background:var(--ev-navy);color:var(--white);border:none;border-radius:8px;padding:10px 20px;font-size:.82rem;font-weight:600;cursor:pointer;}
.ev-btn-secondary{background:transparent;border:1.5px solid var(--ev-border2);color:var(--ev-navy);border-radius:8px;padding:10px 16px;font-size:.82rem;font-weight:600;cursor:pointer;}
.ev-day-header{display:flex;align-items:center;justify-content:space-between;margin:18px 0 8px;}
.ev-day-header:first-of-type{margin-top:4px;}
.ev-day-header h4{font-family:'Lora',serif;font-weight:600;font-size:.92rem;color:var(--ev-navy);margin:0;}
.ev-shift-row{display:grid;grid-template-columns:1.6fr 1fr 60px 50px;gap:10px;align-items:center;background:var(--ev-cream);border-radius:9px;padding:10px 12px;margin-bottom:6px;cursor:pointer;}
.ev-shift-row:hover{background:var(--ev-border);}
.ev-shift-row .ev-shift-name{font-size:.82rem;font-weight:600;color:var(--ev-navy);}
.ev-shift-row .ev-shift-time{font-size:.7rem;color:var(--ev-muted);}
.ev-fill-bar{height:6px;background:rgba(30,45,74,.1);border-radius:99px;overflow:hidden;}
.ev-fill-bar>div{height:100%;}
.ev-fill-count{font-size:.75rem;font-weight:700;text-align:center;}
.ev-edit-link{font-size:.75rem;font-weight:600;color:var(--ev-teal);text-align:center;}
@media(max-width:720px){.ev-master-detail{flex-direction:column;}.ev-list-col{width:100%;border-right:none;border-bottom:1px solid var(--ev-border);}}
/* ── Reusable pill toggle switch (Ministry Roles, Settings) ── */
.toggle-switch{display:inline-flex;align-items:center;gap:10px;cursor:pointer;}
.toggle-switch input{display:none;}
.toggle-track{width:34px;height:18px;border-radius:99px;background:var(--border);position:relative;flex-shrink:0;transition:background .15s;}
.toggle-track::after{content:'';width:14px;height:14px;border-radius:50%;background:var(--white);position:absolute;top:2px;left:2px;transition:left .15s;}
.toggle-switch input:checked+.toggle-track{background:var(--ev-moss);}
.toggle-switch input:checked+.toggle-track::after{left:18px;}
/* ── Status pills (Signups list, event roster) ── */
.status-pill{font-size:.7rem;font-weight:700;padding:2px 9px;border-radius:99px;white-space:nowrap;border:none;cursor:pointer;font-family:var(--font-body);}
.status-pill.status-new{background:rgba(201,151,58,.15);color:#a3781f;}
.status-pill.status-contacted{background:rgba(46,126,166,.12);color:var(--teal);}
.status-pill.status-confirmed{background:rgba(107,143,113,.15);color:#3d5c42;}
.status-pill.status-declined{background:rgba(184,92,58,.1);color:var(--danger);}
/* ── Tuition Aid Planner ── */
.tap-kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px;}
.tap-kpi{background:var(--white);border:1px solid var(--border);border-radius:12px;padding:14px 16px;}
.tap-kpi.accent{background:linear-gradient(135deg,var(--navy),var(--deep-steel));border:none;}
.tap-kpi .tap-lbl{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--warm-gray);font-weight:700;}
.tap-kpi.accent .tap-lbl{color:var(--ice-blue);}
.tap-kpi .tap-val{font-size:1.5rem;font-weight:700;color:var(--navy);margin-top:2px;}
.tap-kpi.accent .tap-val{color:var(--white);}
.tap-kpi .tap-note{font-size:.72rem;color:var(--warm-gray);margin-top:2px;}
.tap-kpi.accent .tap-note{color:var(--ice-blue);}
.tap-pathway{background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px 18px;margin-bottom:18px;}
.tap-path-track{display:flex;align-items:flex-start;gap:0;overflow-x:auto;padding:6px 0 4px;}
.tap-path-stage{flex:1 0 auto;min-width:100px;text-align:center;position:relative;padding:0 6px;}
.tap-path-stage .tap-dot{width:12px;height:12px;border-radius:50%;background:var(--navy);margin:0 auto 6px;border:3px solid var(--pale-gold);}
.tap-path-stage.hot .tap-dot{background:var(--gold-accent);border-color:var(--white);box-shadow:0 0 0 4px rgba(201,151,58,.25);}
.tap-path-line{position:relative;top:6px;height:2px;background:var(--border);margin:0 -50%;z-index:-1;}
.tap-path-stage:first-child .tap-path-line{display:none;}
.tap-path-count{font-size:1.1rem;font-weight:700;color:var(--navy);}
.tap-path-label{font-size:.7rem;text-transform:uppercase;letter-spacing:.03em;color:var(--warm-gray);font-weight:600;}
.tap-flags{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}
.tap-flag{font-size:.75rem;background:var(--pale-gold);color:#7A5C14;padding:5px 11px;border-radius:20px;border:1px solid #E9D9A8;}
.tap-flag b{color:var(--navy);}
.tap-grid2{display:grid;grid-template-columns:1.3fr 1fr;gap:16px;margin-bottom:16px;}
.tap-grid2b{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;}
@media(max-width:820px){.tap-grid2,.tap-grid2b{grid-template-columns:1fr;}}
.tap-gauge-track{width:100%;height:20px;background:var(--linen);border-radius:10px;overflow:hidden;}
.tap-gauge-fill{height:100%;background:linear-gradient(90deg,var(--navy),var(--sky-steel));width:0%;transition:width .2s ease,background .2s ease;}
.tap-gauge-fill.over{background:linear-gradient(90deg,var(--danger),#D9534F);}
.tap-gauge-label{display:flex;justify-content:space-between;margin-top:6px;font-size:.82rem;color:var(--warm-gray);}
.tap-gauge-label .tap-gauge-text{font-weight:700;color:var(--navy);}
.tap-gauge-label .tap-over-text{color:var(--danger)!important;}
.tap-slider-row{display:flex;align-items:center;gap:8px;}
.tap-slider-row input[type=range]{flex:1 1 auto;min-width:70px;accent-color:var(--navy);cursor:pointer;}
.tap-slider-row input[type=range].over{accent-color:var(--danger);}
.tap-slider-row input[type=number]{width:56px;flex:0 0 auto;font-size:.78rem;text-align:right;border:1px solid var(--border);border-radius:6px;padding:3px 5px;color:var(--navy);font-weight:600;font-family:var(--font-body);}
.tap-slider-caption{font-size:.68rem;color:var(--warm-gray);margin-top:2px;}
.tap-award-cell{font-variant-numeric:tabular-nums;font-weight:700;color:var(--navy);text-align:right;white-space:nowrap;}
.tap-pipeline-box{background:var(--pale-gold);border:1px solid #E9D9A8;border-radius:10px;padding:12px 14px;margin-bottom:14px;}
.tap-pipeline-box h4{margin:0 0 8px;font-size:.85rem;color:#7A5C14;}
.tap-pipeline-form{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;}
.tap-pipeline-form input{font-size:.82rem;padding:6px 10px;border-radius:8px;border:1px solid #E9D9A8;background:var(--white);font-family:var(--font-body);}
.tap-pipeline-chip{display:inline-flex;align-items:center;gap:6px;background:var(--white);border:1px solid #E9D9A8;border-radius:20px;padding:5px 10px;margin:0 8px 8px 0;font-size:.8rem;}
.tap-pipeline-remove{border:none;background:none;color:var(--danger);font-size:15px;font-weight:700;cursor:pointer;line-height:1;padding:0 2px;}
.tap-lhs-toggle{display:block;font-size:.68rem;font-weight:400;color:var(--warm-gray);margin-top:3px;text-align:right;cursor:pointer;white-space:nowrap;}
.tap-lhs-toggle input{vertical-align:middle;margin-right:3px;cursor:pointer;}
.tap-controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;font-size:.85rem;}
.tap-controls select{padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:var(--white);color:var(--charcoal);font-family:var(--font-body);}
</style>
</head>
<body>
<div id="offline-banner">You are offline — showing cached contacts</div>
<div id="error-boundary" role="alert" aria-live="assertive" style="display:none;position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9999;background:#c0392b;color:var(--white);padding:11px 20px;border-radius:9px;font-size:.85rem;max-width:520px;width:90vw;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,.3);"></div>
<div class="app-shell">
<nav class="sidebar" id="sidebar">
  <div class="s-logo" onclick="showTab('home')" title="Home"><svg viewBox="0 0 60 60" aria-label="TLC Gather"><circle cx="22" cy="25" r="11" fill="#4D6BA0"/><circle cx="38" cy="25" r="11" fill="#2E7EA6"/><circle cx="30" cy="38" r="11" fill="#C9973A"/><circle cx="30" cy="30" r="1.6" fill="#F8F4EE"/></svg></div>
  <div class="s-item active" data-tab="home" onclick="showTab('home')"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg><span class="s-tip">Home</span></div>
  <div class="s-section-hdr">People</div>
  <div class="s-item" data-tab="people" onclick="showTab('people')"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg><span class="s-tip">People</span></div>
  <div class="s-item" data-tab="households" onclick="showTab('households')"><svg viewBox="0 0 24 24"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/></svg><span class="s-tip">Households</span></div>
  <div class="s-item" data-tab="organizations" onclick="showTab('organizations')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="1"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/><line x1="12" y1="12" x2="12" y2="17"/><line x1="9" y1="14.5" x2="15" y2="14.5"/></svg><span class="s-tip">Organizations</span></div>
  <div class="s-section-hdr require-finance">Giving</div>
  <div class="s-item require-finance" data-tab="giving" onclick="showTab('giving')"><svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8L2 7h20l-6-4z"/></svg><span class="s-tip">Giving</span></div>
  <div class="s-item require-finance" data-tab="tuitionaid" onclick="showTab('tuitionaid')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 2 3 3 6 3s6-1 6-3v-5"/></svg><span class="s-tip">Tuition Aid</span></div>
  <div class="s-section-hdr no-member">Ministry</div>
  <div class="s-item require-staff" data-tab="attendance" onclick="showTab('attendance')"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4"/></svg><span class="s-tip">Attendance</span></div>
  <div class="s-item no-member" data-tab="reports" onclick="showTab('reports')"><svg viewBox="0 0 24 24"><path d="M18 20V10M12 20V4M6 20v-6"/></svg><span class="s-tip">Reports</span></div>
  <div class="s-item require-staff" data-tab="register" onclick="showTab('register')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/><line x1="9" y1="7" x2="17" y2="7"/><line x1="9" y1="11" x2="14" y2="11"/></svg><span class="s-tip">Register</span></div>
  <div class="s-section-hdr require-admin">Admin</div>
  <div class="s-item require-admin" data-tab="volunteers" onclick="showTab('volunteers')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg><span class="s-tip">Volunteers</span></div>
  <div class="s-item require-admin" data-tab="scheduler" onclick="showTab('scheduler')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg><span class="s-tip">Scheduler</span></div>
  <div class="s-bottom">
    <div class="s-item require-admin" data-tab="settings" onclick="showTab('settings')"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg><span class="s-tip">Settings</span></div>
  </div>
</nav>
<div class="content-area">
<div class="topbar">
  <button class="hamburger" onclick="openSidebar()" aria-label="Menu"><svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
  <span class="pill-section" id="topbar-pill" hidden></span>
  <span class="topbar-title" id="topbar-title">People</span>
  <div style="display:flex;gap:8px;align-items:center;">
    <span style="font-size:.7rem;color:var(--warm-gray);" id="deploy-ver"></span>
    <span id="topbar-role" style="display:none;font-size:.72rem;padding:2px 8px;border-radius:99px;background:rgba(30,45,74,.12);color:var(--charcoal);font-weight:600;"></span>
    <a href="/admin/logout" class="btn-sm">Sign Out</a>
  </div>
</div>

`;
