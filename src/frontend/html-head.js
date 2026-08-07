export const HTML_HEAD = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Connect</title>
<link rel="manifest" href="/chms.webmanifest">
<meta name="theme-color" content="#1E2D4A">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Connect">
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
/* ══ RESPONSIVE BREAKPOINTS — three tiers, and only three ═══════════════════════════════════
   phone   @media(max-width:767px)    tablet  @media(max-width:900px)    wide  @media(max-width:1100px)

   Before MOB3 this stylesheet used ELEVEN different max-widths (480/520/600/700/720/767/800/
   820/900/1000/1100), each added for one feature, so layouts changed at inconsistent widths as
   a device rotated and there was no shared definition of "phone" for new work to target.
   Consolidated 2026-08-04 by rewriting each value to its nearest tier — verified first that no
   two blocks landing on the same tier declare the same selector, so nothing silently overrides
   anything else.

   Blocks were rewritten IN PLACE, deliberately not merged into three combined blocks. A media
   query carries no extra specificity, so between same-specificity rules only source order
   decides — relocating a block past a base rule silently changes which one wins. That is
   exactly how v1.121.3's pagination fix shipped doing nothing. Keeping every block where it sat
   preserves the cascade exactly while still giving three consistent switch points.

   Adding responsive CSS? Use one of the three above. Do not invent a fourth. */
:root{
  /* ── Connect brand tokens ── */
  --color-navy:#1E2D4A;--color-teal:#2E7EA6;--color-gold:#C9973A;
  --color-cream:#F8F4EE;--color-light-teal:#EAF4FA;
  /* Legacy tokens (aliased to brand palette so older rules pick up the new look without renames) */
  --steel-anchor:#1E2D4A;--deep-steel:#2A3F60;--mid-steel:#3D627C;--sky-steel:#5C8FA8;
  --ice-blue:#C4DDE8;--blue-mist:#EAF4FA;--amber:#C9973A;--deep-amber:#A87B23;
  --pale-gold:#F5E0B0;--sage:#6B8F71;--pale-sage:#CDE0CF;--warm-white:#FAF9F6;
  --linen:#F1EFE9;--white:#FFFFFF;--border:#E8E0D0;--charcoal:#1A1A2A;--warm-gray:#8A8377;
  --font-display:'Cormorant Garamond',Georgia,serif;
  --font-head:'DM Sans','Source Sans 3',Arial,sans-serif;
  --font-body:'DM Sans','Source Sans 3',Arial,sans-serif;
  --danger:#B85C3A;
  --navy:#1E2D4A;--teal:#2E7EA6;--gold-accent:#C9973A;
  --bg:#FAF9F6;--muted:#6B7280;--faint:#9CA3AF;
  /* ── Warm redesign tokens (People list / Person Profile / Household View) ── */
  --warm-ink-label:#5C4B2E;--warm-meta:#8A7A5C;
  --warm-border:#E5D9BE;--warm-divider:#EEE2C8;--warm-row-divider:#F1E7D2;
  --warm-surface-card:#FFFDF9;--warm-surface-page:#FBF8F1;
  --warm-surface-header:#FBF3E1;--warm-surface-card-page:#F4EFE2;
  --status-member:#6B8F71;--status-visitor:#4D6BA0;--status-associate:#2E7EA6;
  --status-friend:#8A7A5C;--status-inactive:#C9973A;--status-organization:#5C4B2E;
  /* ── Volunteer/Events design-handoff palette. --ev-navy/--ev-teal/--ev-ink
     turned out to be exact hex matches for --color-navy/--color-teal/--charcoal
     (confirmed during the RDS5 redesign pass) and now alias them — same
     dedup already done for --ev-danger. --ev-muted/--ev-cream/--ev-moss have
     no matching token (--ev-moss is a second, deliberately distinct green
     from --sage) and stay as their own literal values. ── */
  --ev-navy:var(--color-navy);--ev-teal:var(--color-teal);--ev-muted:#8A8898;--ev-ink:var(--charcoal);
  --ev-border:rgba(30,45,74,.12);--ev-border2:rgba(30,45,74,.18);
  --ev-cream:#F7F3EC;--ev-moss:#4A5E3A;--ev-danger:var(--danger);
}
*{box-sizing:border-box;margin:0;padding:0;}
/* ── Giving-letter rendered content (Settings preview + the "View Letter" screen) ──
   The universal *{margin:0;padding:0} reset above only applies to this app's own page —
   TinyMCE's editing surface is a separate iframe with normal browser defaults, so a
   paragraph break already shows a visible gap while typing. Without these rules the
   rendered output (which lives on this page, not in that iframe) collapses every <p>/<ul>
   flush together, so a single paragraph break shows no gap at all here. */
#letter-preview-body p,#letter-body p{margin:0 0 1em;}
#letter-preview-body p:last-child,#letter-body p:last-child{margin-bottom:0;}
#letter-preview-body ul,#letter-body ul,#letter-preview-body ol,#letter-body ol{margin:0 0 1em;padding-left:24px;}
#letter-preview-body ul ul,#letter-body ul ul,#letter-preview-body ol ol,#letter-body ol ol{margin:0;padding-left:24px;}
#letter-preview-body li,#letter-body li{margin:0 0 4px;}
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
/* .require-finance/.require-staff/.require-register, plus the Reports sidebar item's
   office exclusion, are admin-configurable per role (Settings -> Giving -> ... no, wait
   actually admin-configurable via applyPermissionUI() in js-core.js, driven by /admin/api/me's
   permissions field (see api-utils.js) -- NOT hardcoded CSS below. Member always gets false
   for all three regardless of config (member is a structurally different, non-configurable
   view), which is why role-member still has its own static rules here as a belt-and-suspenders
   fallback in case JS hasn't run yet. */
/* .require-edit     = visible for admin + finance + staff + office (not member) -- fixed, not configurable */
/* .require-admin    = admin only -- fixed, not configurable */
/* .no-member        = hidden for member role */
.role-member .require-finance{display:none!important;}
.role-member .require-tuitionaid{display:none!important;}
.role-member .require-financeov{display:none!important;}
.role-member .require-attendance{display:none!important;}
.role-finance .require-staff{display:none!important;}
.role-member .require-staff{display:none!important;}
.role-member  .require-register{display:none!important;}
.role-member .require-edit{display:none!important;}
.role-member .no-member{display:none!important;}
/* Per-feature EDIT affordances (create/edit buttons inside a feature tab) — hidden by
   default; applyPermissionUI() in js-core.js adds a body.perm-edit-<item> class for the
   current role when that item's level is 'edit', which reveals them. Buttons are
   inline-block, so that's what we restore. The server enforces edit regardless. */
.require-edit-giving,.require-edit-tuitionaid,.require-edit-finance,.require-edit-attendance,.require-edit-followups,.require-edit-register{display:none!important;}
body.perm-edit-giving .require-edit-giving,
body.perm-edit-tuitionaid .require-edit-tuitionaid,
body.perm-edit-finance .require-edit-finance,
body.perm-edit-attendance .require-edit-attendance,
body.perm-edit-followups .require-edit-followups,
body.perm-edit-register .require-edit-register{display:inline-block!important;}
.role-finance .require-admin{display:none!important;}
.role-staff   .require-admin{display:none!important;}
.role-office  .require-admin{display:none!important;}
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
/* ── Connect three-pill section identifiers ── */
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
@media(max-width:767px){
  .btn-primary,.btn-secondary,.btn-danger{padding-top:11px;padding-bottom:11px;min-height:44px;}
}
/* ── PERSON CARDS ── */
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;}
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
.h-card{background:var(--white);border-radius:18px;box-shadow:0 1px 3px rgba(20,20,40,.05),0 10px 24px rgba(20,20,40,.05);cursor:pointer;padding:16px 18px;transition:box-shadow .15s;}
.h-card:hover{box-shadow:0 1px 3px rgba(20,20,40,.08),0 14px 28px rgba(20,20,40,.12);}
.h-name{font-family:var(--font-head);font-size:1rem;font-weight:700;color:var(--steel-anchor);margin-bottom:4px;}
.h-addr{font-size:.85rem;color:var(--warm-gray);margin-bottom:8px;}
.h-members{display:flex;flex-wrap:wrap;gap:6px;}
.h-member-pill{font-size:.75rem;background:var(--blue-mist);border:1px solid var(--ice-blue);color:var(--steel-anchor);padding:2px 8px;border-radius:10px;}
/* ── GIVING ── */
/* .giving-layout / .batch-list-panel / .batch-detail-panel / .batch-row and its child text
   classes are gone with the Batches tab they styled — the Offerings master/detail uses
   .giv-off-layout / .giv-off-list / .giv-off-row / .giv-off-detail (further down this file),
   which stack at 767px rather than 900px. */
.batch-list-hdr{padding:12px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
.batch-list-hdr h3{font-family:var(--font-head);font-size:.92rem;color:var(--steel-anchor);}
.batch-filter-pills{padding:7px 10px;border-bottom:1px solid var(--border);display:flex;gap:5px;flex-shrink:0;}
.badge-open{background:#D1FAE5;color:#065F46;padding:2px 8px;border-radius:99px;font-size:.68rem;font-weight:700;}
.badge-closed{background:var(--linen);color:var(--warm-gray);padding:2px 8px;border-radius:99px;font-size:.68rem;font-weight:700;}
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
/* ── Giving: Transactions view (RDS4 toggle alongside Batches) ── */
.giv-txn-view{flex-direction:column;flex:1;min-height:0;}
.giv-txn-filters{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px;flex-shrink:0;}
.giv-txn-table-wrap{flex:1;min-height:0;overflow:auto;background:var(--white);border-radius:20px;box-shadow:0 1px 3px rgba(20,20,40,.05),0 10px 24px rgba(20,20,40,.05);}
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
.reg-del-btn{background:none;border:none;color:var(--danger);cursor:pointer;font-size:.78rem;padding:2px 6px;border-radius:4px;opacity:.7;margin-left:2px;}
.reg-del-btn:hover{opacity:1;background:var(--linen);}
@media(max-width:767px){.reg-form-panel{display:none;}.reg-body{flex-direction:column;}.reg-add-toggle{display:inline-flex !important;}}
/* ── REPORTS ── */
.report-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin-bottom:20px;}
.report-tile{background:var(--white);border-radius:16px;box-shadow:0 1px 3px rgba(20,20,40,.05);padding:20px;cursor:pointer;transition:box-shadow .15s;}
.report-tile:hover{box-shadow:0 1px 3px rgba(20,20,40,.08),0 10px 20px rgba(20,20,40,.1);}
.tile-icon{font-size:1.6rem;margin-bottom:8px;}
.tile-title{font-family:var(--font-head);font-size:.95rem;color:var(--steel-anchor);font-weight:700;margin-bottom:4px;}
.tile-desc{font-size:.8rem;color:var(--warm-gray);}
.report-output{background:var(--white);border-radius:20px;box-shadow:0 1px 3px rgba(20,20,40,.05),0 10px 24px rgba(20,20,40,.05);padding:24px;display:none;}
.report-output.visible{display:block;}
.rpt-table{width:100%;border-collapse:collapse;font-size:.87rem;margin-top:12px;}
.rpt-table th{text-align:left;padding:6px 10px;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--warm-gray);border-bottom:2px solid var(--border);}
.rpt-table td{padding:7px 10px;border-bottom:1px solid var(--linen);}
.rpt-total{font-weight:700;border-top:2px solid var(--border) !important;}
.rpt-group-hdr td{background:var(--linen);font-weight:700;font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--warm-gray);padding:5px 10px;border-bottom:none !important;}
.rpt-group-sub td{font-style:italic;font-weight:600;background:#faf7f4;border-bottom:1px solid var(--border) !important;}
/* ── Board Report (giving redesign 1A/1B) ─────────────────────────────── */
.board-header{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap;margin-bottom:16px;}
.board-title{font-size:22px;font-weight:800;color:var(--color-navy);}
.board-subtitle{font-size:13px;color:var(--warm-meta);margin-top:2px;}
.board-toolbar{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.board-mode-toggle{display:inline-flex;border:1px solid var(--warm-border);border-radius:8px;overflow:hidden;}
.board-mode-toggle button{background:var(--white);border:none;padding:7px 12px;font-size:.82rem;font-weight:600;color:var(--warm-meta);cursor:pointer;font-family:var(--font-body);}
.board-mode-toggle button.active{background:var(--color-navy);color:var(--white);}
.board-kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px;}
.board-kpi-card{background:var(--white);border-radius:18px;box-shadow:0 1px 3px rgba(20,20,40,.05),0 10px 24px rgba(20,20,40,.05);padding:16px 18px;border-top:4px solid var(--color-teal);}
.board-kpi-label{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);}
.board-kpi-value{font-size:27px;font-weight:800;color:var(--charcoal);margin:4px 0 6px;font-variant-numeric:tabular-nums;line-height:1;}
.board-kpi-sub{font-size:11.5px;color:var(--warm-gray);}
.board-body-grid{display:grid;grid-template-columns:1.55fr 1fr;gap:14px;}
.board-card{background:var(--white);border-radius:18px;box-shadow:0 1px 3px rgba(20,20,40,.05),0 10px 24px rgba(20,20,40,.05);padding:18px 20px;}
.board-card-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--warm-ink-label);}
.board-legend{margin-left:auto;display:flex;gap:12px;font-size:11px;color:var(--warm-gray);align-items:center;}
.board-legend span{display:flex;align-items:center;gap:5px;}
.board-swatch{width:9px;height:9px;border-radius:2px;display:inline-block;}
.board-navy{background:var(--color-navy);border-radius:18px;padding:18px 20px;color:var(--white);}
.board-navy-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-gold);margin-bottom:12px;}
.board-mix-row{margin-bottom:11px;}
.board-mix-head{display:flex;justify-content:space-between;font-size:12.5px;font-weight:600;margin-bottom:4px;}
.board-mix-track{height:7px;border-radius:4px;background:rgba(255,255,255,.14);overflow:hidden;}
.board-mix-fill{height:100%;}
.board-fund-table{margin-top:14px;}
.board-fund-table .rpt-table td.num,.board-fund-table .rpt-table th.num{text-align:right;font-variant-numeric:tabular-nums;}
.board-empty{background:var(--white);border-radius:18px;box-shadow:0 1px 3px rgba(20,20,40,.05),0 10px 24px rgba(20,20,40,.05);padding:40px;text-align:center;color:var(--warm-gray);font-size:.92rem;}
/* Narrative page (1B) */
.board-narrative{width:816px;max-width:100%;margin:0 auto;background:var(--white);min-height:1056px;box-shadow:0 10px 30px rgba(20,20,40,.12);padding:64px 72px;display:flex;flex-direction:column;box-sizing:border-box;}
.board-nv-eyebrow{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:var(--color-gold);margin-bottom:5px;}
.board-nv-body{font-size:14px;line-height:1.65;color:#33323C;}
@media(max-width:900px){.board-kpi-grid{grid-template-columns:repeat(2,1fr);}.board-body-grid{grid-template-columns:1fr;}}
@media(max-width:767px){.board-kpi-grid{grid-template-columns:1fr;}}
/* ── Fund lens + "Everything else" strip (giving consolidation) ───────── */
/* Gold-bordered so the lens reads as the primary control on the board toolbar, not just one
   more select next to the period picker. */
.board-lens-select{font-family:var(--font-body);font-size:.85rem;font-weight:700;padding:6px 10px;border-radius:8px;border:1px solid var(--color-gold);background:#FFFBF2;color:var(--color-navy);cursor:pointer;}
.board-else-strip{display:flex;align-items:center;gap:10px;background:var(--warm-surface-card);border:1px solid var(--warm-border);border-radius:12px;padding:9px 14px;margin-bottom:14px;flex-wrap:wrap;}
.board-else-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--warm-meta);}
.board-else-chip{padding:5px 12px;border-radius:99px;border:1px solid var(--warm-border);background:var(--white);font-family:var(--font-body);font-size:11.5px;color:var(--charcoal);cursor:pointer;white-space:nowrap;}
.board-else-chip:hover{background:var(--blue-mist);}
.board-else-hint{margin-left:auto;font-size:11px;color:var(--warm-gray);}
.board-print-note{font-size:11.5px;color:var(--warm-meta);margin:-6px 0 12px;}
/* ── Offerings (batches + deposits, one workflow) ─────────────────────── */
.giv-queue-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px;}
.giv-queue-card{background:var(--white);border-radius:14px;box-shadow:0 1px 3px rgba(20,20,40,.05);padding:13px 16px;border-left:4px solid var(--color-teal);}
.giv-queue-label{font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);}
.giv-queue-value{font-size:22px;font-weight:800;margin:3px 0 2px;color:var(--charcoal);font-variant-numeric:tabular-nums;}
.giv-queue-sub{font-size:11px;color:var(--warm-gray);}
.giv-off-header{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap;margin-bottom:14px;}
.giv-off-search{width:230px;max-width:100%;padding:7px 11px;border:1.5px solid var(--border);border-radius:8px;background:var(--warm-surface-card);font-family:var(--font-body);font-size:.85rem;}
/* Derived batch status badge. Never stored — see batchDepositStatus() in api-utils.js. */
.giv-badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:.68rem;font-weight:700;white-space:nowrap;}
.giv-badge-ok{background:#E6F2E8;color:#3D6B48;}
.giv-badge-warn{background:#FBF0D8;color:#8A6316;}
.giv-badge-bad{background:#FAE7E0;color:#8F3A1E;}
.giv-dep-panel{margin:16px 18px 20px;border:1px solid var(--warm-border);border-radius:14px;background:var(--warm-surface-page);padding:14px 16px;}
.giv-dep-panel-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--warm-ink-label);}
.giv-cover-track{height:9px;border-radius:5px;background:#EFE6D6;overflow:hidden;display:flex;margin:10px 0 6px;}
.giv-cover-seg{height:100%;}
.giv-cover-caption{font-size:11.5px;color:var(--warm-gray);}
.giv-dep-card{background:var(--white);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:8px;}
.giv-dep-field-label{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--warm-gray);display:block;margin-bottom:3px;}
.giv-dep-field input{padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-family:var(--font-body);font-size:.85rem;font-variant-numeric:tabular-nums;}
.giv-dep-linkrow{display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;margin-top:10px;}
.giv-dep-shortfall{background:#FBF0D8;border:1px solid #EBD9A8;border-radius:12px;padding:10px 14px;font-size:12.5px;color:#6B4E12;display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.giv-dep-remove{background:none;border:none;color:#8F3A1E;font-size:.76rem;font-weight:600;cursor:pointer;font-family:var(--font-body);padding:0;}
.giv-off-layout{display:grid;grid-template-columns:320px 1fr;gap:0;border-radius:20px;overflow:hidden;box-shadow:0 1px 3px rgba(20,20,40,.05),0 10px 24px rgba(20,20,40,.05);min-height:520px;background:var(--white);}
.giv-off-list{background:var(--white);border-right:1px solid var(--border);overflow-y:auto;max-height:720px;}
.giv-off-row{padding:11px 14px;border-bottom:1px solid var(--border);cursor:pointer;border-left:3px solid transparent;}
.giv-off-row:hover{background:var(--linen);}
.giv-off-row.selected{background:#EAF4FA;border-left-color:var(--color-teal);}
.giv-off-detail{background:var(--white);display:flex;flex-direction:column;min-width:0;}
@media(max-width:900px){.giv-queue-grid{grid-template-columns:repeat(2,1fr);}}
@media(max-width:767px){.giv-queue-grid{grid-template-columns:1fr;}.giv-off-layout{grid-template-columns:1fr;}.giv-off-list{max-height:320px;border-right:none;border-bottom:1px solid var(--border);}}
.rpt-overview{display:flex;flex-wrap:wrap;gap:18px;margin-bottom:14px;}
.rpt-stat{background:var(--linen);border-radius:12px;padding:10px 16px;min-width:140px;flex:1 1 140px;max-width:220px;}
.rpt-stat-num{font-size:1.35rem;font-weight:700;font-family:var(--font-head);color:var(--steel-anchor);line-height:1.1;}
.rpt-stat-lbl{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--warm-gray);margin-top:3px;}
/* ── ATTENDANCE (1a redesign, "This Week · Trends · Festivals · History · Reports") ──
   Scoped tokens under .att-root — most map 1:1 onto the app's existing brand tokens
   (see README Design Tokens: navy/teal/gold/border/white already match exactly), a few
   are new values introduced by this design with no existing equivalent (page/inset
   surfaces, hairlines, the semantic pos/neg + attention-pill colors, the 4-step year/heat
   ramps). Kept local to .att-root rather than promoted to :root since nothing else in the
   app uses them yet — see CLAUDE.md Attendance/Reports queued item for detail. */
.att-root{
  --att-page:#FAF7F2;--att-inset:#F5F1E8;--att-hairline:#EFE6D6;--att-table-hairline:#F6F2EA;--att-track:#F2EDE3;
  --att-text-2:#8B7355;--att-text-3:#A0937F;--att-text-lbl:#4A4437;
  --att-gold-text:#B8862B;
  --att-yr-1:#DCE9F0;--att-yr-2:#9FC4D8;--att-yr-3:var(--color-teal);--att-yr-4:var(--color-navy);
  --att-heat-1:#E3E9EE;--att-heat-2:#A9C8D9;--att-heat-3:#4C87A9;--att-heat-4:var(--color-navy);--att-heat-empty:var(--att-table-hairline);
  --att-pos:#4F7D4F;--att-neg:#B03A2E;--att-pill-text:#8A6A17;--att-pill-bg:#F7E7BF;
  background:var(--att-page);
}
.att-tabbar{display:flex;gap:26px;padding:0 24px;background:var(--att-page);border-bottom:1px solid var(--att-hairline);flex-wrap:wrap;}
.att-tab{padding:14px 2px 12px;font-size:15px;font-weight:600;color:var(--att-text-2);background:none;border:none;cursor:pointer;font-family:var(--font-body);}
.att-tab.active{font-weight:700;color:var(--color-navy);box-shadow:inset 0 -2px 0 var(--color-navy);}
.att-panel{display:none;padding:20px 24px 28px;flex-direction:column;gap:16px;}
.att-panel.active{display:flex;}
.att-card{background:var(--white);border-radius:18px;box-shadow:0 1px 3px rgba(20,20,40,.05),0 10px 24px rgba(20,20,40,.05);padding:20px;}
.att-card-title{font-size:1.2rem;font-weight:700;color:var(--color-navy);font-family:var(--font-head);}
.att-card-subtitle{font-size:.84rem;color:var(--att-text-2);margin-top:2px;}
.att-row2{display:grid;grid-template-columns:404px 1fr;gap:16px;align-items:start;}
.att-row2b{display:grid;grid-template-columns:1fr 424px;gap:16px;align-items:start;}
@media(max-width:1100px){.att-row2,.att-row2b{grid-template-columns:1fr;}}
/* -- Entry card -- */
.att-entry-card{display:flex;flex-direction:column;gap:14px;}
.att-eyebrow{font-size:.72rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--att-text-2);}
.att-pill-due{font-size:.7rem;font-weight:700;text-transform:uppercase;color:var(--att-pill-text);background:var(--att-pill-bg);padding:3px 10px;border-radius:100px;white-space:nowrap;}
.att-entry-date{font-size:1.9rem;font-weight:700;color:var(--color-navy);letter-spacing:-.01em;font-family:var(--font-head);}
.att-entry-sub{font-size:.88rem;color:var(--att-text-2);margin-top:2px;}
.att-input-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.att-input-label{font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--color-navy);margin-bottom:4px;display:block;}
.att-input{height:60px;padding:0 14px;border:1.5px solid var(--border);border-radius:12px;background:var(--att-page);font-size:1.65rem;font-weight:700;color:var(--color-navy);font-variant-numeric:tabular-nums;width:100%;font-family:var(--font-body);}
.att-input:focus{border-color:var(--color-navy);background:var(--white);outline:none;}
.att-combined-strip{padding:12px 15px;background:var(--att-inset);border-radius:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}
.att-combined-label{font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--att-text-2);}
.att-combined-val{font-size:1.5rem;font-weight:700;color:var(--color-navy);font-variant-numeric:tabular-nums;}
.att-delta{font-size:.8rem;font-weight:600;}
.att-delta.pos{color:var(--att-pos);}
.att-delta.neg{color:var(--att-neg);}
.att-btn-row{display:flex;gap:10px;flex-wrap:wrap;}
.att-btn-primary{padding:12px 22px;background:var(--color-navy);color:var(--white);border-radius:10px;font-size:.94rem;font-weight:700;border:none;cursor:pointer;font-family:var(--font-body);}
.att-btn-primary:hover{background:var(--deep-steel);}
.att-btn-secondary{padding:12px 22px;background:var(--white);border:1.5px solid var(--att-hairline);border-radius:10px;color:var(--color-navy);font-size:.9rem;font-weight:700;cursor:pointer;font-family:var(--font-body);}
.att-btn-secondary:hover{background:var(--att-inset);}
.att-still{border-top:1px solid var(--att-hairline);padding-top:13px;}
.att-still-hdr{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px;}
.att-still-title{font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--att-text-2);}
.att-still-badge{font-size:.78rem;font-weight:700;color:var(--att-pill-text);background:var(--att-pill-bg);padding:3px 10px;border-radius:100px;white-space:nowrap;}
.att-still-row{display:flex;align-items:center;gap:10px;border-top:1px solid var(--att-table-hairline);padding:10px 0;}
.att-still-date{font-size:.86rem;font-weight:700;color:var(--color-navy);min-width:60px;}
.att-still-desc{font-size:.78rem;color:var(--att-text-2);flex:1;}
.att-still-enter{font-size:.78rem;font-weight:700;color:var(--color-navy);background:var(--att-inset);padding:6px 13px;border-radius:100px;border:none;cursor:pointer;font-family:var(--font-body);white-space:nowrap;}
.att-still-enter:hover{background:var(--att-hairline);}
.att-still-empty{font-size:.82rem;color:var(--att-text-3);padding:10px 0;}
/* -- Pulse card -- */
.att-pulse-card{display:flex;flex-direction:column;gap:18px;padding:20px 22px 16px;}
.att-pulse-stats{display:flex;gap:28px;flex-wrap:wrap;align-items:center;}
.att-pulse-primary{display:flex;flex-direction:column;}
.att-pulse-primary-row{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;}
.att-pulse-value{font-size:3rem;font-weight:700;color:var(--color-navy);letter-spacing:-.02em;font-family:var(--font-head);line-height:1;}
.att-pulse-caption{font-size:.7rem;text-transform:uppercase;letter-spacing:.09em;color:var(--att-text-2);margin-top:4px;}
.att-pulse-divider{width:1px;height:46px;background:var(--att-hairline);flex-shrink:0;}
.att-pulse-stat-val{font-size:1.6rem;font-weight:700;color:var(--color-navy);font-family:var(--font-head);line-height:1;}
.att-bars26{display:flex;align-items:flex-end;gap:6px;height:150px;border-bottom:1px solid var(--att-hairline);overflow-x:auto;}
.att-bar26-col{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;flex:1;min-width:8px;height:100%;}
.att-bar26-val{font-size:.66rem;font-weight:600;color:var(--att-text-3);margin-bottom:2px;white-space:nowrap;}
.att-bar26-bar{width:100%;border-radius:4px 4px 0 0;min-height:2px;}
.att-bar26-bar.gold{background:var(--color-gold);}
.att-bar26-bar.teal{background:var(--color-teal);}
.att-bar-stack{width:100%;display:flex;flex-direction:column;border-radius:4px 4px 0 0;overflow:hidden;min-height:2px;}
.att-bar-seg{width:100%;}
.att-bar-seg-1045{background:var(--color-teal);}
.att-bar-seg-8{background:var(--color-gold);}
.att-bars-foot{display:flex;justify-content:space-between;font-size:.72rem;color:var(--att-text-3);}
/* -- Heat grid -- */
.att-heat-row{display:flex;align-items:center;gap:8px;margin-bottom:3px;}
.att-heat-year{width:38px;font-size:.8rem;font-weight:700;color:var(--att-text-2);flex-shrink:0;}
.att-heat-cells{display:flex;gap:3px;flex:1;min-width:0;overflow-x:auto;}
.att-heat-cell{height:22px;border-radius:3px;flex:1;min-width:6px;}
.att-heat-cell.heat-empty,.att-heat-legend-cell.heat-empty{background:var(--att-heat-empty);}
.att-heat-cell.heat-1,.att-heat-legend-cell.heat-1{background:var(--att-heat-1);}
.att-heat-cell.heat-2,.att-heat-legend-cell.heat-2{background:var(--att-heat-2);}
.att-heat-cell.heat-3,.att-heat-legend-cell.heat-3{background:var(--att-heat-3);}
.att-heat-cell.heat-4,.att-heat-legend-cell.heat-4{background:var(--att-heat-4);}
.att-heat-avg{font-size:.82rem;font-weight:700;color:var(--color-navy);width:44px;text-align:right;flex-shrink:0;}
.att-heat-foot{display:flex;justify-content:space-between;align-items:center;margin-top:6px;padding-left:46px;padding-right:44px;font-size:.72rem;color:var(--att-text-2);flex-wrap:wrap;gap:8px;}
.att-heat-legend{display:flex;align-items:center;gap:4px;color:var(--att-text-3);}
.att-heat-legend-cell{width:12px;height:12px;border-radius:2px;display:inline-block;}
/* -- Recent Sundays -- */
.att-recent-row{display:grid;grid-template-columns:88px 1fr 52px 52px 66px;gap:8px;padding:10px 0;border-top:1px solid var(--att-table-hairline);align-items:center;}
.att-recent-row:first-child{border-top:none;}
.att-recent-date{font-size:.86rem;font-weight:700;color:var(--color-navy);}
.att-recent-name{font-size:.78rem;color:var(--att-text-2);}
.att-recent-8{font-size:.86rem;font-weight:700;color:var(--att-gold-text);text-align:right;}
.att-recent-1045{font-size:.86rem;font-weight:700;color:var(--color-teal);text-align:right;}
.att-recent-total{font-size:.86rem;font-weight:700;color:var(--color-navy);text-align:center;background:var(--att-inset);border-radius:100px;padding:2px 0;}
.att-card-hdr{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px;flex-wrap:wrap;}
.att-link{font-size:.8rem;font-weight:700;color:var(--color-teal);text-decoration:none;cursor:pointer;background:none;border:none;font-family:var(--font-body);}
.att-link:hover{text-decoration:underline;}
/* -- Trends: monthly rhythm -- */
.att-month-wrap{display:flex;align-items:flex-end;gap:8px;height:200px;overflow-x:auto;}
.att-month-col{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;flex:1;min-width:32px;height:100%;}
.att-month-val{font-size:.88rem;font-weight:700;color:var(--color-navy);margin-bottom:4px;}
.att-month-bar{width:100%;max-width:64px;border-radius:6px 6px 0 0;min-height:2px;}
.att-month-bar.hi{background:var(--color-navy);}
.att-month-bar.lo{background:#9FC4D8;}
.att-month-foot{display:flex;gap:8px;border-top:1px solid var(--att-hairline);margin-top:4px;padding-top:6px;}
.att-month-foot-col{flex:1;min-width:32px;text-align:center;}
.att-month-label{font-size:.78rem;font-weight:700;color:var(--att-text-lbl);}
.att-month-season{font-size:.68rem;color:var(--att-text-3);}
/* -- Trends: service mix -- */
.att-mix-row{margin-bottom:12px;}
.att-mix-hdr{display:flex;justify-content:space-between;gap:8px;font-size:.82rem;margin-bottom:5px;flex-wrap:wrap;}
.att-mix-label{font-weight:700;color:var(--att-text-lbl);}
.att-mix-track{height:16px;border-radius:5px;background:var(--att-track);overflow:hidden;display:flex;}
.att-mix-fill-8{background:var(--color-gold);height:100%;}
.att-mix-fill-1045{background:var(--color-teal);height:100%;}
/* -- Trends: YoY table -- */
.att-yoy-hdr,.att-yoy-row{display:grid;grid-template-columns:48px 1fr 1fr 1fr 62px;gap:0 10px;align-items:center;}
.att-yoy-hdr{font-size:.68rem;font-weight:700;text-transform:uppercase;color:var(--att-text-2);border-bottom:1px solid var(--att-hairline);padding-bottom:6px;}
.att-yoy-row{padding:6px 0;border-bottom:1px solid var(--att-table-hairline);}
.att-yoy-cell{display:flex;align-items:center;gap:6px;}
.att-yoy-bar{height:9px;border-radius:2px;min-width:2px;}
.att-yoy-num{font-size:.82rem;color:var(--att-text-lbl);}
.att-yoy-delta{font-size:.8rem;font-weight:700;text-align:right;}
/* -- Festivals -- */
.att-fest-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;}
@media(max-width:900px){.att-fest-grid{grid-template-columns:repeat(2,1fr);}}
.att-fest-hdr{display:flex;justify-content:space-between;align-items:baseline;gap:6px;margin-bottom:10px;flex-wrap:wrap;}
.att-fest-name{font-size:.92rem;font-weight:700;color:var(--color-navy);}
.att-fest-delta{font-size:.78rem;font-weight:700;}
.att-fest-bars{display:flex;align-items:flex-end;gap:8px;height:132px;border-bottom:1px solid var(--att-hairline);}
.att-fest-bar-col{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;flex:1;height:100%;}
.att-fest-val{font-size:.78rem;font-weight:700;color:var(--color-navy);margin-bottom:3px;}
.att-fest-bar{width:100%;border-radius:5px 5px 0 0;min-height:2px;}
.att-fest-bar.latest{background:var(--color-navy);}
.att-fest-bar.prior{background:#9FC4D8;}
.att-fest-foot{display:flex;gap:8px;margin-top:6px;}
.att-fest-yr{flex:1;text-align:center;font-size:.7rem;color:var(--att-text-3);}
/* -- History -- */
.att-hist-hdr,.att-hist-row{display:grid;grid-template-columns:104px 1fr 60px 60px 74px 84px;gap:10px;align-items:center;}
.att-hist-hdr{font-size:.68rem;font-weight:700;text-transform:uppercase;color:var(--att-text-2);border-bottom:1px solid var(--att-hairline);padding-bottom:6px;}
.att-hist-row{padding:10px 0;border-bottom:1px solid var(--att-table-hairline);cursor:pointer;}
.att-hist-row:hover{background:var(--att-page);}
.att-hist-date{font-size:.85rem;font-weight:700;color:var(--color-navy);}
.att-hist-name{font-size:.8rem;color:var(--att-text-2);}
.att-hist-8{font-size:.85rem;font-weight:700;color:var(--att-gold-text);text-align:right;}
.att-hist-1045{font-size:.85rem;font-weight:700;color:var(--color-teal);text-align:right;}
.att-hist-total{font-size:.85rem;font-weight:700;color:var(--color-navy);text-align:center;background:var(--att-inset);border-radius:100px;padding:2px 0;}
.att-hist-delta{font-size:.82rem;font-weight:700;text-align:right;}
/* -- Reports grid -- */
.att-report-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
@media(max-width:900px){.att-report-grid{grid-template-columns:1fr;}}
.att-report-title{font-size:1.05rem;font-weight:700;color:var(--color-navy);font-family:var(--font-head);}
.att-report-desc{font-size:.84rem;color:var(--att-text-2);margin:4px 0 12px;}
.att-report-actions{display:flex;gap:8px;flex-wrap:wrap;}
.att-report-inputs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;}
.att-report-inputs .field{margin:0;}
/* Legacy list/edit classes still used by the History tab's inline correction form */
.att-inline-form{padding:12px 14px 14px;background:var(--blue-mist);border-top:1px solid var(--ice-blue);border-radius:0 0 12px 12px;}
.att-edit-hint{font-size:.72rem;color:var(--warm-gray);margin-left:6px;}
@media(max-width:767px){
  .att-hist-hdr,.att-hist-row{grid-template-columns:84px 1fr 44px 44px 58px;}
  .att-hist-1045{display:none;}
  .att-yoy-hdr,.att-yoy-row{grid-template-columns:40px 1fr 1fr 50px;}
  .att-recent-row{grid-template-columns:70px 1fr 46px 46px;}
  .att-recent-1045{display:none;}
}
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
@media(max-width:767px){.modal{padding:18px 16px;max-height:95vh;border-radius:10px;}}
.modal h2{font-family:var(--font-head);font-size:1.1rem;color:var(--steel-anchor);margin-bottom:18px;}
.modal-2col{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
@media(max-width:767px){.modal-2col{grid-template-columns:1fr;}}
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
  #p-grid,#p-card-grid,#tab-people .view-toggle{display:none!important;}
  .contact-list{display:flex;flex-direction:column;background:var(--warm-surface-card);order:1;flex:0 0 auto;}
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
  /* Pagination reachability on mobile.
     #p-pager lives inside .ppl-list-col > .ppl-master-detail, but the mobile list
     (.contact-list) is a SIBLING of .ppl-master-detail, not a child. So on a phone the
     master-detail subtree holds nothing visible except the pager — #p-grid and #p-card-grid
     are display:none above — while still claiming flex:1. With a full page of contact cards
     already overflowing the tab panel there is no free space left to grow into, so
     .ppl-master-detail collapsed to zero height and .ppl-list-col's overflow:hidden clipped
     the pager away entirely. The list itself was fine; the Prev/Next buttons simply did not
     exist on screen, so a phone user could never get past the first 25 people.
     Fix: let the master-detail size to its content, stop the column clipping, and order the
     pager after the list so it reads as pagination rather than a header. */
     All three selectors below are class-only and carry no inline styles, which matters:
     #p-pager itself has an inline justify-content/padding, so a rule targeting it here would
     be silently defeated (inline beats a media query — the VUX15 bug, and the reason CR4
     tracks the 3,752 inline styles as a blocker for any systematic mobile work). */
     The two rules this needs — .ppl-master-detail and .ppl-list-col — are NOT here: their base
     declarations live further down this stylesheet, and a media query adds no specificity, so
     an override placed here would be beaten by the later base rule and silently do nothing.
     They sit immediately after those base rules instead. See "MOBILE PEOPLE PAGINATION" below. */
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
/* ── Finance/Giving/Tuition-Aid shared sub-nav — one flat horizontal bar (not a rail),
   shown at the top of all three tab-panels, so the collapsed single sidebar entry still
   reaches all seven sections. Deliberately NOT the Volunteers-tab .vol-subnav vertical rail —
   this needs to sit above Giving's own flex/grid master-detail layout without joining its
   height chain, and a flat bar was the user's own stated preference for this nav anyway. ── */
.fin-subnav{display:flex;align-items:center;gap:2px;margin-bottom:16px;flex-shrink:0;flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;border-bottom:1px solid var(--warm-border);}
.fin-subnav-btn{background:none;border:none;padding:9px 14px;font-size:.83rem;font-weight:700;color:var(--warm-meta);cursor:pointer;font-family:var(--font-body);white-space:nowrap;border-bottom:2px solid transparent;margin-bottom:-1px;}
.fin-subnav-btn.active{color:var(--color-navy);border-bottom-color:var(--color-navy);}
.fin-subnav-btn:hover:not(.active){color:var(--color-navy);}
.fin-subnav-divider{width:1px;height:18px;background:var(--warm-border);margin:0 6px;flex-shrink:0;}

/* ── Finance Workspace redesign (2026-07 handoff) — KPI cards, on-budget pace panel, chips,
   navy summary cards. Reuses existing brand tokens wherever they're an exact match for the
   handoff's own hex values (confirmed token-by-token against the handoff's Design Tokens
   table) — only the handful with no existing equivalent are added here. ── */
:root{
  --sage-text:#4A6E52;--positive-on-navy:#8FD3A6;--negative-on-navy:#E8A088;
  --chip-positive-bg:#EDF3EE;--chip-warn-bg:#FBF0DA;--chip-negative-bg:#F6E3DC;
}
.fin-kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:22px;}
@media(max-width:900px){.fin-kpi-grid{grid-template-columns:1fr 1fr;}}
@media(max-width:767px){.fin-kpi-grid{grid-template-columns:1fr;}}
.fin-kpi-card{background:var(--white);border-radius:18px;box-shadow:0 1px 3px rgba(20,20,40,.05),0 10px 24px rgba(20,20,40,.05);padding:18px 20px;border-top:4px solid var(--color-teal);}
.fin-kpi-lbl{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);}
.fin-kpi-val{font-family:var(--font-body);font-size:27px;font-weight:800;color:var(--charcoal);margin:4px 0 8px;font-variant-numeric:tabular-nums;line-height:1;}
.fin-kpi-sub{font-size:11.5px;color:var(--warm-gray);margin-top:6px;}
.fin-chip{display:inline-block;padding:3px 10px;border-radius:99px;font-size:.74rem;font-weight:700;white-space:nowrap;}
.fin-chip-positive{background:var(--chip-positive-bg);color:var(--sage-text);}
.fin-chip-info{background:var(--color-light-teal);color:var(--color-teal);}
.fin-chip-warn{background:var(--chip-warn-bg);color:var(--deep-amber);}
.fin-chip-negative{background:var(--chip-negative-bg);color:var(--danger);}
/* Neither good news nor bad — restricted income is simply spoken for. Navy on blue-mist rather
   than teal, which at this chip's 0.74rem bold would land near 3.8:1 against the same background. */
.fin-chip-neutral{background:var(--blue-mist);color:var(--color-navy);}
.fin-card{background:var(--white);border-radius:20px;box-shadow:0 1px 3px rgba(20,20,40,.05),0 10px 24px rgba(20,20,40,.05);padding:22px 24px;}
.fin-card-title{font-family:var(--font-display);font-size:20px;font-weight:700;color:var(--color-navy);margin:0 0 4px;}
.fin-card-sub{font-size:.82rem;color:var(--warm-gray);margin:0 0 14px;}
.fin-dropzone{border:2px dashed var(--border);border-radius:10px;padding:14px;text-align:center;transition:border-color .15s,background .15s;}
.fin-dropzone-active{border-color:var(--color-teal);background:var(--color-light-teal);}
.fin-dropzone-hint{font-size:.74rem;color:var(--warm-gray);margin-top:6px;}
.fin-navy-card{background:var(--color-navy);border-radius:20px;box-shadow:0 10px 24px rgba(30,45,74,.2);padding:22px 24px;color:var(--white);}
.fin-navy-card .fin-card-title{color:var(--white);}
.fin-navy-label{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:rgba(255,255,255,.65);}
.fin-navy-val{font-size:28px;font-weight:800;font-variant-numeric:tabular-nums;}
.fin-navy-val.positive{color:var(--positive-on-navy);}
.fin-navy-val.negative{color:var(--negative-on-navy);}
.fin-pace-row{border-top:1px solid var(--warm-row-divider);padding:12px 0;cursor:pointer;}
.fin-pace-row:first-child{border-top:none;}
.fin-pace-row-hdr{display:flex;align-items:center;justify-content:space-between;gap:10px;}
.fin-pace-caret{display:inline-block;width:14px;transition:transform .15s;color:var(--warm-meta);}
.fin-pace-row.open .fin-pace-caret{transform:rotate(90deg);}
.fin-pace-label{font-weight:700;font-size:.88rem;color:var(--charcoal);}
.fin-pace-figs{font-size:.85rem;color:var(--warm-ink-label);font-variant-numeric:tabular-nums;white-space:nowrap;}
.fin-pace-status{display:inline-block;min-width:80px;text-align:center;}
.fin-pace-bar-track{position:relative;height:11px;border-radius:6px;background:var(--linen);margin-top:8px;overflow:visible;}
.fin-pace-bar-fill{height:100%;border-radius:6px;background:var(--color-teal);}
.fin-pace-bar-fill.warn{background:var(--color-gold);}
.fin-pace-bar-fill.over{background:var(--danger);}
.fin-pace-marker{position:absolute;top:-2px;bottom:-2px;width:2px;background:var(--color-navy);}
.fin-pace-inset{background:var(--warm-surface-page);border-radius:10px;padding:10px 14px;margin-top:10px;}
.fin-pace-inset-row{display:flex;justify-content:space-between;font-size:.82rem;padding:4px 0;color:var(--warm-ink-label);}
.fin-variance-bar-track{display:inline-block;width:54px;height:6px;border-radius:4px;background:var(--linen);vertical-align:middle;margin-right:8px;}
.fin-variance-bar-fill{height:100%;border-radius:4px;}
.fin-editable-input{background:var(--color-light-teal);border:1px solid var(--ice-blue);border-radius:8px;padding:4px 8px;font-family:var(--font-body);font-size:.85rem;font-variant-numeric:tabular-nums;width:100%;box-sizing:border-box;}
.fin-domain-select{font-family:var(--font-body);font-size:.85rem;font-weight:600;padding:6px 10px;border-radius:8px;border:1px solid var(--warm-border);background:var(--white);color:var(--color-navy);}
.fin-sync-pill{display:inline-flex;align-items:center;gap:6px;font-size:.76rem;font-weight:600;color:var(--sage-text);background:var(--chip-positive-bg);padding:4px 10px;border-radius:99px;}
.fin-sync-pill::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--sage-text);}
.fin-balance-row{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;}
@media(max-width:767px){.fin-balance-row{grid-template-columns:1fr;}}
.fin-balance-card{background:var(--white);border-radius:16px;box-shadow:0 1px 3px rgba(20,20,40,.05),0 10px 24px rgba(20,20,40,.05);padding:16px 18px;display:flex;align-items:center;gap:12px;}
.fin-balance-icon{width:42px;height:42px;border-radius:10px;background:var(--color-light-teal);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;}
.fin-balance-lbl{font-size:11.5px;color:var(--warm-gray);font-weight:600;}
.fin-balance-val{font-size:20px;font-weight:800;color:var(--charcoal);font-variant-numeric:tabular-nums;}
.fin-trend-chart{display:flex;align-items:flex-end;gap:6px;height:150px;padding-top:10px;}
.fin-trend-month{flex:1;display:flex;align-items:flex-end;justify-content:center;gap:2px;height:100%;}
.fin-trend-bar{width:40%;border-radius:3px 3px 0 0;background:var(--color-teal);}
.fin-trend-bar.expense{background:var(--color-gold);}
.fin-trend-bar.projected{opacity:.42;}
.fin-trend-labels{display:flex;gap:6px;margin-top:6px;}
.fin-trend-labels span{flex:1;text-align:center;font-size:10px;color:var(--warm-meta);}
.fin-yearend-bar-row{margin-bottom:16px;}
.fin-yearend-bar-lbl{display:flex;justify-content:space-between;font-size:.8rem;font-weight:700;color:var(--warm-ink-label);margin-bottom:4px;}
.fin-yearend-bar-track{position:relative;height:20px;border-radius:6px;background:var(--linen);overflow:visible;}
.fin-yearend-bar-actual{height:100%;border-radius:6px 0 0 6px;background:var(--color-teal);}
.fin-yearend-bar-projected{height:100%;background:var(--color-teal);opacity:.4;}
.fin-yearend-bar-row.expense .fin-yearend-bar-actual,.fin-yearend-bar-row.expense .fin-yearend-bar-projected{background:var(--color-gold);}
.fin-yearend-marker{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--color-navy);}
/* ── Finance Workspace v3 (2026-08 "Finance overview framing" handoff): Financial Health,
   the restructured report pages, and the new Data & Imports tab. Every colour below is an
   existing brand token — the handoff's Design Tokens table was reconciled against :root above
   and added no new colours. Responsive rules use only the three agreed tiers (see RESPONSIVE
   BREAKPOINTS); every multi-column grid here collapses to 1fr at 767px, and the 3-up grids go
   to two columns at 900px. ── */
.fin-health-page{display:flex;flex-direction:column;gap:22px;}
.fin-page-hdr{display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-bottom:20px;}
.fin-page-title{font-family:var(--font-display);font-size:28px;font-weight:700;color:var(--color-navy);margin:0;line-height:1.1;}
.fin-page-sub{font-size:13px;color:var(--warm-gray);}
.fin-page-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.fin-page-footnote{font-size:12px;color:var(--warm-gray);border-top:1px solid var(--warm-border);padding-top:14px;}
.fin-section-title{font-family:var(--font-display);font-size:20px;font-weight:700;color:var(--color-navy);margin-bottom:2px;}
.fin-section-sub{font-size:12.5px;color:var(--warm-gray);margin-bottom:12px;}
.fin-eyebrow{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);}
.fin-card-hdr-split{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:10px;}
.fin-note-box{background:var(--warm-surface-page);border-radius:10px;padding:9px 12px;font-size:12px;color:var(--warm-ink-label);line-height:1.5;}
.fin-th{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);}
.fin-disclosure{font-size:12.5px;font-weight:700;color:var(--color-navy);cursor:pointer;}
.fin-link-btn{background:none;border:none;padding:0;font:inherit;color:var(--color-teal);font-weight:700;cursor:pointer;text-decoration:underline;}
.fin-inline-field{font-size:.72rem;color:var(--warm-gray);display:flex;flex-direction:column;gap:2px;}
.fin-inline-field input{width:90px;}
.btn-white{padding:8px 15px;border-radius:8px;border:none;background:var(--white);color:var(--color-navy);font-family:var(--font-body);font-size:12.5px;font-weight:700;cursor:pointer;}
/* Grids. Named for what they lay out rather than their ratio, so a change of ratio does not
   need every call site rewritten. */
.fin-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.fin-grid-2-wide{display:grid;grid-template-columns:1.3fr 1fr;gap:16px;align-items:start;margin-bottom:22px;}
.fin-grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:22px;}
.fin-grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}
.fin-grid-start{align-items:start;}
.fin-grid-hero{display:grid;grid-template-columns:1.15fr 1fr;gap:16px;align-items:stretch;margin-bottom:20px;}
.fin-grid-charts{display:grid;grid-template-columns:1.35fr 1fr;gap:16px;align-items:start;margin-bottom:20px;}
.fin-grid-pace{display:grid;grid-template-columns:1.35fr 1fr;gap:16px;align-items:stretch;}
.fin-grid-mix{display:grid;grid-template-columns:1.4fr 1fr;gap:16px;}
/* Scope/mode pills. A separate class from .fin-comp-pills on purpose: the Compensation tab is
   out of scope for this redesign and must not gain a shared dependency on these rules. */
.fin-scope-pills{display:flex;gap:4px;background:var(--linen);border-radius:99px;padding:4px;}
.fin-scope-pill{padding:6px 14px;border:none;border-radius:99px;background:none;font-family:var(--font-body);font-size:12px;font-weight:700;color:var(--warm-meta);cursor:pointer;white-space:nowrap;}
.fin-scope-pill.active{background:var(--color-navy);color:var(--white);}
/* Revenue mix bar */
.fin-stream-bar{display:flex;height:56px;border-radius:12px;overflow:hidden;}
.fin-stream-seg{display:flex;flex-direction:column;justify-content:center;padding:0 16px;color:var(--white);min-width:0;overflow:hidden;}
.fin-stream-seg-lbl{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;opacity:.85;}
.fin-stream-seg-val{font-size:17px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap;}
.fin-stream-card{display:flex;flex-direction:column;gap:13px;border-top:4px solid var(--color-teal);}
/* Four revenue streams need their own grid: fin-grid-3 is three fixed columns and fin-grid-4 is
   the compact KPI-tile grid (10px gap, no bottom margin), neither of which fits a column of
   content cards. Collapses on the existing 1100/767 tiers only — see the breakpoint contract at
   the top of this file. */
.fin-stream-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:22px;align-items:start;}
.fin-stream-val{font-size:30px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1;margin-top:4px;}
.fin-stream-sub{font-size:12px;color:var(--warm-gray);margin-top:3px;}
.fin-flow{overflow-x:auto;}
.fin-entity-card{display:flex;flex-direction:column;gap:10px;border-top:4px solid var(--sage);border-radius:18px;padding:18px 20px;}
.fin-entity-val{font-size:27px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1;}
/* Appeal ladder */
.fin-appeal-grid{display:grid;grid-template-columns:1.3fr 1fr;gap:22px;align-items:start;margin-top:12px;}
.fin-ladder-row{display:grid;grid-template-columns:120px 1fr 96px;gap:12px;align-items:center;padding:9px 0;border-top:1px solid var(--warm-row-divider);}
.fin-ladder-head{border-top:none;padding:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);}
.fin-ladder-total{border-top:2px solid var(--color-navy);padding:11px 0 0;}
.fin-bands-panel{background:var(--warm-surface-page);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:12px;}
.fin-lever-card{border-radius:18px;padding:18px 20px;}
.fin-decision{border:1px solid var(--warm-border);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:8px;}
/* Navy strips (property hero, daycare ratio, planning summary) */
.fin-navy-sublabel{font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:rgba(255,255,255,.6);}
.fin-prop-hero{display:flex;flex-direction:column;justify-content:space-between;gap:16px;padding:24px;}
.fin-hero-val{font-size:44px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1;margin:6px 0 8px;color:var(--positive-on-navy);}
.fin-hero-split{display:grid;grid-template-columns:1fr 1fr;gap:16px;border-top:1px solid rgba(255,255,255,.22);padding-top:14px;}
.fin-hero-sub-val{font-size:21px;font-weight:800;font-variant-numeric:tabular-nums;}
.fin-mini-tile{background:var(--warm-surface-page);border-radius:10px;padding:9px 11px;}
.fin-mini-tile.positive{background:var(--chip-positive-bg);}
.fin-mini-tile-val{font-size:18px;font-weight:800;font-variant-numeric:tabular-nums;}
.fin-ratio-strip{display:grid;grid-template-columns:1.25fr 1px 1fr 1fr 1fr;gap:22px;align-items:center;margin-bottom:20px;}
.fin-ratio-divider{width:1px;height:70px;background:rgba(255,255,255,.22);}
.fin-plan-strip{display:grid;grid-template-columns:1fr 1fr 1fr 1.2fr;gap:22px;align-items:center;margin-bottom:20px;padding:16px 22px;border-radius:16px;}
.fin-plan-strip-last{border-left:1px solid rgba(255,255,255,.25);padding-left:22px;}
/* Collapsed ledger / detail strips */
.fin-ledger-strip{padding:15px 20px;}
.fin-ledger-strip-hdr{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}
.fin-ledger-strip-title{font-size:13.5px;font-weight:700;color:var(--color-navy);}
.fin-ledger-strip-sub{font-size:12px;color:var(--warm-gray);}
/* Daycare rooms */
.fin-room-row-hdr{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12.5px;font-weight:700;color:var(--warm-ink-label);}
.fin-room-grid{display:grid;grid-template-columns:1.15fr 1fr 1fr 1fr .85fr;gap:0;font-size:12.5px;}
.fin-room-num{padding:9px 0;border-top:1px solid var(--warm-row-divider);text-align:right;font-variant-numeric:tabular-nums;}
.fin-room-total{padding:11px 0;border-top:2px solid var(--color-navy);font-weight:800;color:var(--color-navy);}
/* Data & Imports */
.fin-data-card-hdr{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;}
.fin-data-card-name{font-size:15px;font-weight:700;color:var(--color-navy);}
.fin-data-card-body{font-size:12.5px;color:var(--warm-ink-label);line-height:1.5;margin:0 0 10px;}
.fin-import-panel{border:1px solid var(--warm-border);border-radius:14px;padding:14px 16px;}
.fin-import-panel-foot{border-top:1px solid var(--warm-row-divider);margin-top:10px;padding-top:10px;}
.fin-import-row{display:flex;justify-content:space-between;gap:10px;width:100%;background:none;border:none;padding:7px 4px;font-family:var(--font-body);font-size:12.5px;text-align:left;cursor:pointer;border-radius:6px;min-height:36px;align-items:center;}
.fin-import-row:hover:not(:disabled){background:var(--warm-surface-page);}
.fin-import-row:disabled{cursor:default;}
.fin-import-row-name{color:var(--warm-ink-label);font-weight:600;}
@media(max-width:1100px){
  .fin-grid-hero,.fin-grid-charts,.fin-grid-pace,.fin-grid-mix,.fin-grid-2-wide,.fin-appeal-grid{grid-template-columns:1fr;}
  .fin-ratio-strip{grid-template-columns:1fr 1fr;}
  .fin-ratio-divider{display:none;}
  .fin-plan-strip{grid-template-columns:1fr 1fr;}
  .fin-plan-strip-last{border-left:none;padding-left:0;}
  .fin-stream-grid{grid-template-columns:1fr 1fr;}
}
@media(max-width:900px){
  .fin-grid-3{grid-template-columns:1fr 1fr;}
  .fin-grid-4{grid-template-columns:1fr 1fr;}
  .fin-room-grid{font-size:11.5px;}
}
@media(max-width:767px){
  .fin-grid-2,.fin-grid-2-wide,.fin-grid-3,.fin-grid-4,.fin-stream-grid,.fin-grid-hero,.fin-grid-charts,.fin-grid-pace,.fin-grid-mix,.fin-appeal-grid,.fin-ratio-strip,.fin-plan-strip,.fin-hero-split{grid-template-columns:1fr;}
  .fin-page-title{font-size:23px;}
  .fin-hero-val{font-size:34px;}
  .fin-stream-bar{height:auto;flex-direction:column;border-radius:10px;}
  .fin-stream-seg{width:100% !important;padding:8px 14px;flex-direction:row;justify-content:space-between;align-items:baseline;}
  .fin-ladder-row{grid-template-columns:80px 1fr 84px;gap:8px;}
  .fin-room-grid{grid-template-columns:1.2fr 1fr 1fr .9fr;font-size:11px;}
  .fin-room-grid > :nth-child(5n){display:none;}
}
/* ── Compensation Planner (2026-08 handoff): a persistent header + navy totals strip + five
   views behind one pill sub-nav. Every colour below is an existing brand token — the handoff's
   own Design Tokens table was reconciled against :root above and matched exactly. ── */
.fin-comp-shell{display:flex;flex-direction:column;gap:14px;margin-bottom:14px;}
.fin-comp-titlebar{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap;}
.fin-comp-title{font-family:var(--font-display);font-size:29px;font-weight:700;color:var(--color-navy);line-height:1.05;}
.fin-comp-subtitle{font-size:.8rem;color:var(--warm-gray);}
.fin-comp-actions{display:flex;gap:8px;flex-wrap:wrap;}
.fin-comp-strip{background:var(--color-navy);border-radius:16px;padding:15px 22px;color:var(--white);display:grid;grid-template-columns:1fr 1fr 1fr 1.3fr;gap:22px;align-items:center;box-shadow:0 10px 24px rgba(30,45,74,.2);}
@media(max-width:900px){.fin-comp-strip{grid-template-columns:1fr 1fr;}}
@media(max-width:767px){.fin-comp-strip{grid-template-columns:1fr;}}
.fin-comp-strip-lbl{font-size:10.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:rgba(255,255,255,.6);}
.fin-comp-strip-val{font-size:23px;font-weight:800;font-variant-numeric:tabular-nums;}
.fin-comp-strip-val.gold{color:var(--pale-gold);}
.fin-comp-strip-delta{border-left:1px solid rgba(255,255,255,.25);padding-left:22px;}
@media(max-width:900px){.fin-comp-strip-delta{border-left:none;padding-left:0;}}
.fin-comp-pills{display:flex;align-items:center;gap:6px;background:var(--linen);border-radius:99px;padding:4px;flex-wrap:wrap;align-self:flex-start;}
.fin-comp-pill{padding:7px 16px;border-radius:99px;font-size:.82rem;font-weight:700;cursor:pointer;color:var(--warm-meta);white-space:nowrap;}
.fin-comp-pill.active{background:var(--color-navy);color:var(--white);}
.fin-comp-toast{background:var(--color-navy);color:var(--white);padding:9px 16px;border-radius:8px;font-size:.84rem;display:flex;align-items:center;justify-content:space-between;gap:12px;}
.fin-comp-plan-grid{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:16px;align-items:start;}
.fin-comp-plan-grid.closed{grid-template-columns:minmax(0,1fr);}
@media(max-width:1100px){.fin-comp-plan-grid{grid-template-columns:minmax(0,1fr);}}
.fin-comp-chiprow{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;}
.fin-comp-chiprow-lbl{font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--warm-meta);}
.fin-comp-chip{padding:5px 12px;border-radius:99px;font-size:.78rem;font-weight:700;cursor:pointer;background:var(--linen);color:var(--warm-meta);white-space:nowrap;}
.fin-comp-chip.active{background:var(--color-navy);color:var(--white);}
.fin-comp-link{font-size:.76rem;font-weight:700;color:var(--color-teal);cursor:pointer;}
.fin-comp-table{width:100%;border-collapse:collapse;font-size:.82rem;}
.fin-comp-th{text-align:left;padding:8px 6px;font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;color:var(--warm-meta);border-bottom:1.5px solid var(--border);font-weight:700;}
.fin-comp-th.num{text-align:right;}
.fin-comp-th.active{background:var(--blue-mist);color:var(--color-navy);cursor:pointer;}
.fin-comp-td{padding:11px 6px;vertical-align:top;}
.fin-comp-td.num{text-align:right;font-variant-numeric:tabular-nums;}
.fin-comp-td.active{font-weight:700;color:var(--charcoal);background:var(--blue-mist);}
.fin-comp-td.edited{font-weight:700;color:var(--deep-amber);background:var(--warm-surface-header);}
.fin-comp-row{border-bottom:1px solid var(--warm-row-divider);}
.fin-comp-row.selected{background:var(--warm-surface-page);}
.fin-comp-total-row{border-top:2px solid var(--color-navy);font-weight:700;}
.fin-comp-add{display:inline-flex;align-items:center;gap:7px;font-size:.8rem;font-weight:700;color:var(--color-teal);cursor:pointer;}
.fin-comp-add-plus{width:18px;height:18px;border-radius:50%;border:1.5px solid var(--color-teal);display:inline-flex;align-items:center;justify-content:center;font-size:13px;line-height:1;}
.fin-comp-cardfoot{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:12px;}
.fin-comp-cardhd{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:14px;}
.fin-comp-drawer{padding:18px 20px;display:flex;flex-direction:column;gap:12px;}
.fin-comp-drawer-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;}
.fin-comp-drawer-name{font-family:var(--font-display);font-size:23px;font-weight:700;color:var(--color-navy);line-height:1.1;}
.fin-comp-drawer-h{font-size:.8rem;font-weight:700;color:var(--color-navy);margin-top:4px;}
.fin-comp-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
.fin-comp-tile{background:var(--color-cream);border-radius:11px;padding:10px 12px;display:flex;flex-direction:column;gap:2px;}
.fin-comp-tile.teal{background:var(--blue-mist);}
.fin-comp-tile-lbl{font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--warm-meta);}
.fin-comp-tile-lbl.teal{color:var(--color-teal);}
.fin-comp-tile.teal .fin-comp-tile-lbl{color:var(--color-teal);}
.fin-comp-tile-val{font-size:17px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--charcoal);}
.fin-comp-fieldgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;}
.fin-comp-field{display:flex;flex-direction:column;gap:3px;font-size:.72rem;color:var(--warm-gray);min-width:0;}
.fin-comp-field input,.fin-comp-field select{width:100%;min-width:0;padding:5px 7px;border:1.5px solid var(--border);border-radius:7px;font-size:.8rem;font-family:var(--font-body);background:var(--white);}
.fin-comp-note{font-size:.72rem;color:var(--warm-gray);}
.fin-comp-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;border-radius:9px;padding:8px 12px;font-size:.8rem;color:var(--warm-ink-label);flex-wrap:wrap;}
.fin-comp-bar b{font-variant-numeric:tabular-nums;color:var(--charcoal);}
.fin-comp-bar.cream{background:var(--color-cream);}
.fin-comp-bar.page{background:var(--warm-surface-page);}
.fin-comp-bar.mist{background:var(--blue-mist);margin-top:12px;}
.fin-comp-paylist{display:flex;flex-direction:column;gap:6px;}
.fin-comp-payrow{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:.8rem;color:var(--warm-gray);}
.fin-comp-payrow b{font-variant-numeric:tabular-nums;color:var(--charcoal);}
.fin-comp-payrow.total{font-size:.88rem;border-top:1px solid var(--border);padding-top:6px;}
.fin-comp-payrow.total span{font-weight:700;color:var(--color-navy);}
.fin-comp-inline-check{font-size:.72rem;color:var(--warm-gray);display:inline-flex;align-items:center;gap:4px;margin-left:6px;}
.fin-comp-seca{display:flex;justify-content:space-between;gap:8px;font-size:.8rem;background:var(--warm-surface-header);border-radius:8px;padding:8px 10px;color:var(--warm-ink-label);}
.fin-comp-seca b{font-variant-numeric:tabular-nums;}
.fin-comp-legend{display:flex;gap:20px;font-size:.72rem;color:var(--warm-gray);flex-wrap:wrap;margin-bottom:8px;}
.fin-comp-swatch{display:inline-block;vertical-align:middle;}
.fin-comp-swatch.fill{width:16px;height:9px;background:var(--color-teal);opacity:.22;border-radius:5px;}
.fin-comp-swatch.mid{width:3px;height:12px;background:var(--color-teal);}
.fin-comp-swatch.salary{width:3px;height:12px;background:var(--color-gold);}
.fin-comp-fairblock{border-top:1px solid var(--warm-row-divider);padding-top:14px;margin-top:14px;display:flex;flex-direction:column;gap:10px;}
.fin-comp-fairhd{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;}
.fin-comp-verdict{padding:5px 12px;border-radius:99px;font-size:.76rem;font-weight:700;white-space:nowrap;}
.fin-comp-ranges{display:flex;flex-direction:column;gap:12px;}
.fin-comp-rangerow{display:grid;grid-template-columns:160px minmax(0,1fr) 210px;gap:14px;align-items:center;}
@media(max-width:767px){.fin-comp-rangerow{grid-template-columns:minmax(0,1fr);gap:4px;}}
.fin-comp-rangelbl{font-size:.78rem;font-weight:600;color:var(--warm-ink-label);}
.fin-comp-rangenum{font-size:.74rem;color:var(--warm-gray);font-variant-numeric:tabular-nums;}
.fin-comp-track{height:14px;border-radius:7px;background:var(--linen);position:relative;}
.fin-comp-fill{position:absolute;top:0;bottom:0;border-radius:7px;background:var(--color-teal);opacity:.22;}
.fin-comp-tick{position:absolute;width:3px;}
.fin-comp-tick.mid{top:-4px;bottom:-4px;background:var(--color-teal);}
.fin-comp-tick.salary{top:-7px;bottom:-7px;background:var(--color-gold);}
.fin-comp-noreport{font-size:.78rem;color:var(--warm-gray);background:var(--color-cream);border-radius:10px;padding:10px 14px;}
.fin-comp-plangrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px;}
@media(max-width:900px){.fin-comp-plangrid{grid-template-columns:1fr 1fr;}}
@media(max-width:767px){.fin-comp-plangrid{grid-template-columns:1fr;}}
.fin-comp-plancard{border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:6px;cursor:pointer;background:var(--white);border:1.5px solid var(--border);}
.fin-comp-plancard.active{background:var(--blue-mist);border:2px solid var(--color-navy);}
.fin-comp-radio{width:15px;height:15px;border-radius:50%;flex-shrink:0;background:var(--white);border:1.5px solid #C4B99E;}
.fin-comp-radio.active{border:5px solid var(--color-navy);}
.fin-comp-details{margin-top:12px;}
.fin-comp-details summary{cursor:pointer;font-size:.78rem;font-weight:700;color:var(--color-teal);}
.fin-comp-ratesbanner{background:var(--warm-surface-header);border-radius:14px;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;}
.fin-comp-yearsel{padding:6px 10px;border:1.5px solid var(--color-gold);border-radius:8px;font-size:.86rem;font-weight:700;background:var(--white);color:var(--color-navy);font-family:var(--font-body);}
.fin-comp-ratesgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start;}
@media(max-width:900px){.fin-comp-ratesgrid{grid-template-columns:1fr;}}
.fin-comp-rategrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}
@media(max-width:767px){.fin-comp-rategrid{grid-template-columns:1fr;}}
.fin-comp-reflabel{display:flex;flex-direction:column;gap:4px;font-size:.72rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);min-width:0;}
.fin-comp-reflabel input,.fin-comp-reflabel select{padding:7px 9px;border:1.5px solid var(--border);border-radius:8px;font-size:.92rem;font-variant-numeric:tabular-nums;letter-spacing:0;text-transform:none;color:var(--charcoal);font-family:var(--font-body);}
.fin-comp-reflabel-hd{font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--warm-meta);}
.fin-comp-warn{font-size:.78rem;color:var(--deep-amber);background:var(--warm-surface-header);border-radius:9px;padding:9px 12px;margin-top:10px;}
.fin-comp-histchip{padding:5px 10px;border-radius:8px;font-size:.76rem;font-variant-numeric:tabular-nums;background:var(--color-cream);color:var(--warm-meta);}
.fin-comp-histchip.active{background:var(--blue-mist);color:var(--color-navy);font-weight:700;}
.fin-comp-quote-active{background:var(--blue-mist);}
.fin-comp-lcms-row{background:var(--blue-mist);}
.fin-comp-counciltiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px;}
@media(max-width:900px){.fin-comp-counciltiles{grid-template-columns:1fr 1fr;}}
@media(max-width:767px){.fin-comp-counciltiles{grid-template-columns:1fr;}}
.fin-comp-ctile{background:var(--color-cream);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:3px;}
.fin-comp-ctile.mist{background:var(--blue-mist);}
.fin-comp-ctile.navy{background:var(--color-navy);}
.fin-comp-ctile.navy .fin-comp-tile-lbl{color:rgba(255,255,255,.6);}
.fin-comp-ctile-val{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--charcoal);}
.fin-comp-ctile.mist .fin-comp-ctile-val{color:var(--color-navy);}
.fin-comp-ctile-val.gold{color:var(--pale-gold);}
/* The Council report. Hidden on screen — it exists only to be printed, and printing the workspace
   with the chrome hidden would not give the flowing, per-worker-page document the handoff calls
   for. finCompPrintCouncil() renders into it, adds body.printing-comp, and calls window.print(). */
.fin-comp-print-root{display:none;}
.fin-comp-rpt{font-size:9.5pt;color:var(--charcoal);}
.fin-comp-rpt-hd{display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding-bottom:6px;border-bottom:1px solid var(--border);font-size:9pt;color:var(--warm-meta);font-weight:700;letter-spacing:.04em;margin-bottom:16px;}
.fin-comp-rpt-kicker{font-size:9.5pt;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-gold);}
.fin-comp-rpt-h1{font-family:var(--font-display);font-size:30pt;font-weight:700;color:var(--color-navy);line-height:1.05;margin:2px 0;}
.fin-comp-rpt-h2{font-family:var(--font-display);font-size:16pt;font-weight:700;color:var(--color-navy);margin:16px 0 6px;}
.fin-comp-rpt-sub{font-size:10.5pt;color:var(--warm-ink-label);margin-bottom:14px;}
.fin-comp-rpt-p{font-size:10.5pt;line-height:1.55;margin:0 0 10px;}
.fin-comp-rpt-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;}
.fin-comp-rpt-tile{background:var(--color-cream);border-radius:8px;padding:11px 13px;}
.fin-comp-rpt-tile.mist{background:var(--blue-mist);}
.fin-comp-rpt-tile.navy{background:var(--color-navy);color:var(--white);}
.fin-comp-rpt-tile-lbl{font-size:8pt;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--warm-meta);}
.fin-comp-rpt-tile.navy .fin-comp-rpt-tile-lbl{color:rgba(255,255,255,.65);}
.fin-comp-rpt-tile-val{font-size:17pt;font-weight:800;font-variant-numeric:tabular-nums;}
.fin-comp-rpt-tile.navy .fin-comp-rpt-tile-val{color:var(--pale-gold);}
.fin-comp-rpt-motion{background:var(--warm-surface-header);border-radius:8px;padding:13px 16px;margin-bottom:16px;font-size:10.5pt;line-height:1.5;}
.fin-comp-rpt-motion-h{font-size:11pt;font-weight:700;color:var(--warm-ink-label);margin-bottom:4px;}
.fin-comp-rpt-table{width:100%;border-collapse:collapse;font-size:9.5pt;margin-bottom:10px;}
.fin-comp-rpt-table th{text-align:left;padding:6px 5px;font-size:8pt;text-transform:uppercase;letter-spacing:.06em;color:var(--warm-meta);border-bottom:1.5px solid var(--color-navy);}
.fin-comp-rpt-table td{padding:7px 5px;border-bottom:1px solid var(--warm-row-divider);vertical-align:top;}
.fin-comp-rpt-table .n{text-align:right;font-variant-numeric:tabular-nums;}
.fin-comp-rpt-table th.n{text-align:right;}
.fin-comp-rpt-table .b{font-weight:700;}
.fin-comp-rpt-table .mut{color:var(--warm-gray);}
.fin-comp-rpt-table tr.tot td{border-top:2px solid var(--color-navy);border-bottom:none;font-weight:700;}
.fin-comp-rpt-table tr.lcms{background:var(--blue-mist);}
.fin-comp-rpt-ft{border-top:1px solid var(--border);padding-top:6px;font-size:8.5pt;color:var(--warm-meta);margin-top:14px;}
.ppl-card-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;background:var(--warm-surface-card-page);padding:16px;border-radius:12px;}
@media(max-width:1100px){.ppl-card-grid{grid-template-columns:1fr;}}
.ppl-card{background:var(--warm-surface-card);border-radius:12px;border-left:4px solid var(--status-member);box-shadow:0 2px 10px rgba(120,90,30,.08);padding:14px 16px;cursor:pointer;position:relative;transition:box-shadow .15s;}
.ppl-card:hover{box-shadow:0 4px 16px rgba(120,90,30,.14);}
.ppl-card.selected{box-shadow:0 0 0 3px var(--color-navy);}
.ppl-card-top{display:flex;align-items:center;gap:11px;margin-bottom:10px;}
.ppl-card-name{font-weight:700;font-size:14px;color:var(--color-navy);line-height:1.2;}
.ppl-card-phone{font-size:12.5px;color:var(--color-teal);margin-bottom:2px;}
.ppl-card-email{font-size:12.5px;color:var(--warm-meta);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ppl-card-cb{position:absolute;top:8px;right:8px;width:18px;height:18px;border:2px solid var(--warm-border);border-radius:4px;background:var(--white);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--white);}
.ppl-card.selected .ppl-card-cb{background:var(--color-navy);border-color:var(--color-navy);}
/* ── PEOPLE — master-detail quick-view panel (RDS2) ──
   List (table/card view, unchanged) on the left; a right-side preview panel
   shows the selected person without navigating away. "Full Profile" inside
   the panel still opens the existing full Person Profile page. ── */
.ppl-master-detail{display:flex;flex:1;min-height:0;}
.ppl-list-col{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden;}
/* ── MOBILE PEOPLE PAGINATION ──
   Must come AFTER the two base rules directly above. #p-pager sits inside
   .ppl-list-col > .ppl-master-detail, but the mobile list (.contact-list) is a SIBLING of
   .ppl-master-detail. Under 767px the grids inside are display:none, so that subtree holds
   nothing visible but the pager while still claiming flex:1 — and with a full page of contact
   cards already overflowing the panel there is no free space to grow into, so it collapses to
   zero height and overflow:hidden clips the pager away. Phone users could not reach page 2.
   Placement is load-bearing: a media query carries no extra specificity, so putting these in
   the 767px block further up (next to the .contact-list rules) let the base rules above win
   and the override did nothing at all. */
@media(max-width:767px){
  .ppl-master-detail{flex:0 0 auto;order:2;}
  .ppl-list-col{overflow:visible;}
}
.ppl-quickview{width:340px;flex-shrink:0;background:var(--white);border-left:1px solid var(--linen);padding:28px 26px;overflow-y:auto;display:flex;flex-direction:column;}
.ppl-qv-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--warm-gray);gap:10px;padding:40px 20px;text-align:center;font-size:.9rem;margin:auto 0;}
.ppl-qv-avatar{width:64px;height:64px;border-radius:20px;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;margin-bottom:14px;flex-shrink:0;overflow:hidden;}
.ppl-qv-avatar img{width:100%;height:100%;object-fit:cover;}
.ppl-qv-name{font-size:19px;font-weight:800;color:var(--color-navy);}
.ppl-qv-meta{font-size:12.5px;color:var(--warm-gray);margin:4px 0 18px;}
.ppl-qv-meta a{color:var(--color-teal);font-weight:600;cursor:pointer;text-decoration:none;}
.ppl-qv-meta a:hover{text-decoration:underline;}
.ppl-qv-actions{display:flex;gap:8px;margin-bottom:20px;}
.ppl-qv-actions>*{flex:1;text-align:center;padding:9px 0;border-radius:10px;font-size:12.5px;font-weight:700;cursor:pointer;text-decoration:none;}
.ppl-qv-section{margin-bottom:20px;}
.ppl-qv-section-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--warm-gray);margin-bottom:8px;}
.ppl-qv-row{font-size:13.5px;color:var(--color-navy);margin-bottom:6px;}
.ppl-qv-row a{color:inherit;text-decoration:none;}
.ppl-qv-row a:hover{text-decoration:underline;}
.ppl-qv-hh-chips{display:flex;flex-wrap:wrap;gap:8px;}
.ppl-qv-chip{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;cursor:pointer;flex-shrink:0;}
.ppl-qv-hh-names{display:flex;flex-direction:column;gap:4px;}
.ppl-qv-hh-name{font-size:13.5px;color:var(--color-teal);font-weight:600;cursor:pointer;}
.ppl-qv-hh-name:hover{text-decoration:underline;}
.ppl-qv-hh-name.is-self{color:var(--color-navy);font-weight:700;cursor:default;}
.ppl-qv-hh-name.is-self:hover{text-decoration:none;}
.ppl-qv-map{border-radius:10px;overflow:hidden;line-height:0;border:1px solid var(--warm-divider);min-height:20px;}
.dir-table tbody tr.dir-row-qv td{background:var(--blue-mist)!important;box-shadow:inset 3px 0 0 var(--color-teal);}
.ppl-card.qv-active{box-shadow:0 0 0 2px var(--color-teal);}
@media(max-width:1100px){.ppl-quickview{width:280px;padding:22px 18px;}}
@media(max-width:767px){.ppl-quickview{display:none!important;}}
/* ── DASHBOARD ──
   Card spec follows the design-handoff mockup exactly: soft dual box-shadow,
   20px radius, no 1px border (replaces the old bordered/flat-shadow cards). ── */
.dash-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin-bottom:28px;}
@media(max-width:900px){.dash-stats{grid-template-columns:repeat(2,1fr);}}
@media(max-width:767px){.dash-stats{grid-template-columns:1fr 1fr;}}
.dash-stat{background:var(--white);border-radius:20px;box-shadow:0 1px 3px rgba(20,20,40,.05),0 10px 24px rgba(20,20,40,.05);padding:22px 24px;display:flex;flex-direction:column;gap:4px;}
.dash-stat-val{font-size:30px;font-weight:800;color:var(--charcoal);line-height:1;letter-spacing:-.02em;}
.dash-stat-lbl{font-size:12px;font-weight:500;color:var(--warm-gray);margin-top:1px;}
.dash-stat-sub{font-size:11px;color:var(--teal);}
.dash-stat-quad-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;}
.dash-stat-quad-grid .dash-stat-val{font-size:22px;}
.dash-row{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;}
@media(max-width:767px){.dash-row{grid-template-columns:1fr;}}
.dash-card{background:var(--white);border-radius:20px;box-shadow:0 1px 3px rgba(20,20,40,.05),0 10px 24px rgba(20,20,40,.05);overflow:hidden;}
.dash-card-hdr{padding:20px 24px 12px;font-size:15px;font-weight:700;color:var(--charcoal);display:flex;align-items:center;gap:8px;}
.dash-card-body{padding:0 0 6px;}
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
.pv-photo-edit-btn{position:absolute;bottom:-2px;right:-2px;width:28px;height:28px;border-radius:50%;border:2px solid var(--white);background:var(--color-navy);cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.28);}
.pv-photo-edit-btn:hover{background:var(--color-teal);}
.pv-photo-edit-btn svg{width:14px;height:14px;pointer-events:none;}
.pv-photo-menu{position:absolute;top:96px;left:0;z-index:30;background:var(--white);border:1px solid var(--warm-divider);border-radius:11px;box-shadow:0 10px 34px rgba(0,0,0,.18);padding:5px;min-width:214px;}
.pv-photo-menu button{display:block;width:100%;text-align:left;background:none;border:none;padding:9px 12px;font-size:13.5px;color:var(--color-navy);cursor:pointer;border-radius:7px;font-family:var(--font-body);}
.pv-photo-menu button:hover{background:var(--warm-surface-header);}
.pv-photo-menu button.danger{color:var(--danger);}
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
@media(max-width:767px){
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
.pv-section{background:var(--warm-surface-card);border-radius:18px;box-shadow:0 1px 3px rgba(20,20,40,.05),0 10px 24px rgba(20,20,40,.05);padding:20px 22px;margin-bottom:16px;}
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
/* ── PROFILE REDESIGN (single-screen, sticky jump-nav, inline per-field edit) — brand tokens ── */
.pv2-crumb{font-size:13px;font-weight:600;color:var(--warm-meta);margin-bottom:16px;}
.pv2-crumb b{color:var(--color-navy);font-weight:600;}
.pv2-hdr-sub{font-size:14px;color:var(--warm-meta);margin-top:3px;}
.pv2-hdr-sub b{color:var(--color-navy);}
.pv2-badges{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;align-items:center;}
.pv2-badge{font-weight:700;font-size:12.5px;padding:5px 11px;border-radius:20px;}
.pv2-badge.status{background:var(--blue-mist);color:var(--color-navy);}
.pv2-badge.marital{background:var(--pale-gold);color:var(--deep-amber);}
.pv2-badge.tag{background:var(--linen);color:var(--warm-gray);font-weight:600;}
.pv2-hdr-btn{display:inline-flex;align-items:center;gap:7px;font-weight:700;font-size:13.5px;padding:8px 13px;border-radius:9px;cursor:pointer;text-decoration:none;border:1px solid var(--warm-border);background:var(--warm-surface-header);color:var(--color-navy);}
.pv2-hdr-btn:hover{background:var(--warm-surface-card-page);}
.pv2-hdr-btn.solid{background:var(--color-teal);border-color:var(--color-teal);color:var(--white);}
.pv2-hdr-btn.solid:hover{opacity:.92;}
.pv2-hdr-btn.on{background:var(--blue-mist);border-color:var(--sky-steel);color:var(--color-navy);}
.pv2-hdr-btn.dashed{background:var(--white);border:1px dashed var(--border);color:var(--warm-gray);}
.pv2-body{display:flex;gap:14px;margin-top:20px;align-items:flex-start;}
.pv2-nav{position:sticky;top:6px;flex:none;width:186px;display:flex;flex-direction:column;gap:2px;}
.pv2-nav-lbl{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--warm-meta);padding:4px 12px 8px;}
.pv2-nav-btn{text-align:left;background:none;color:var(--warm-gray);font-weight:600;font-size:13.5px;padding:9px 12px;border:none;border-radius:9px;cursor:pointer;font-family:var(--font-body);}
.pv2-nav-btn:hover{background:var(--warm-surface-header);}
.pv2-nav-btn.active{background:var(--blue-mist);color:var(--color-navy);font-weight:700;}
.pv2-nav-select{display:none;width:100%;margin-bottom:14px;font-size:15px;padding:11px 12px;border-radius:10px;border:1px solid var(--warm-border);background:var(--white);color:var(--color-navy);font-family:var(--font-body);}
.pv2-grid{flex:1;min-width:0;display:grid;grid-template-columns:1fr 380px;gap:20px;align-items:start;}
.pv2-col{display:flex;flex-direction:column;gap:20px;min-width:0;}
.pv2-card{background:var(--warm-surface-card);border:1px solid var(--warm-divider);border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(20,40,60,.04);scroll-margin-top:14px;}
.pv2-card-hd{display:flex;align-items:center;gap:8px;padding:15px 20px;border-bottom:1px solid var(--warm-divider);}
.pv2-card-hd h3{margin:0;font-size:14px;font-weight:800;letter-spacing:.3px;text-transform:uppercase;color:var(--warm-ink-label);}
.pv2-card-hd .sp{flex:1;}
.pv2-card-hd-tag{font-size:12.5px;font-weight:600;color:var(--color-teal);}
.pv2-card-bd{padding:6px 20px 12px;}
.pv2-card-bd.pad{padding:16px 20px 18px;}
.pv2-frow{display:flex;gap:14px;padding:11px 0;border-bottom:1px solid var(--warm-row-divider);align-items:flex-start;}
.pv2-frow:last-child{border-bottom:none;}
.pv2-flabel{width:118px;flex:none;color:var(--warm-meta);font-size:13px;font-weight:600;padding-top:8px;}
.pv2-fval{flex:1;min-width:0;}
.pv2-ro{display:flex;align-items:center;gap:8px;font-size:15px;padding:8px 0;color:var(--color-navy);}
.pv2-ro.editable{cursor:text;}
.pv2-ro.empty{color:var(--faint);}
.pv2-ro a{color:var(--color-teal);}
.pv2-pencil{opacity:0;transition:opacity .12s;color:var(--color-teal);font-size:13px;font-weight:600;}
.pv2-ro:hover .pv2-pencil{opacity:1;}
.pv2-sub{font-size:12.5px;color:var(--faint);margin-top:2px;}
.pv2-inp{width:100%;max-width:320px;font-size:15px;color:var(--color-navy);background:var(--white);border:1px solid var(--color-teal);border-radius:9px;padding:9px 11px;box-shadow:0 0 0 3px rgba(46,126,166,.15);outline:none;font-family:var(--font-body);}
.pv2-inp.sel{cursor:pointer;-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A8377' stroke-width='2.5'><path d='M6 9l6 6 6-6'/></svg>");background-repeat:no-repeat;background-position:right 10px center;padding-right:30px;}
.pv2-mem{display:flex;align-items:center;gap:13px;padding:9px 8px;border-radius:10px;}
.pv2-mem:hover{background:var(--warm-surface-header);}
.pv2-mem-av{width:40px;height:40px;flex:none;border-radius:11px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;}
.pv2-mem-name{font-weight:700;font-size:14.5px;color:var(--color-navy);}
.pv2-mem-name.link{cursor:pointer;color:var(--color-teal);}
.pv2-mem-role{font-size:12.5px;color:var(--warm-meta);}
.pv2-adddash{width:100%;margin-top:6px;background:none;border:1.5px dashed var(--warm-border);color:var(--color-teal);font-weight:700;font-size:13.5px;padding:11px;border-radius:11px;cursor:pointer;font-family:var(--font-body);}
.pv2-adddash:hover{background:var(--warm-surface-header);}
.pv2-chip{display:inline-flex;align-items:center;gap:7px;background:var(--blue-mist);color:var(--color-navy);font-weight:600;font-size:13px;padding:6px 8px 6px 12px;border-radius:20px;}
.pv2-chip-x{background:var(--ice-blue);border:none;color:var(--mid-steel);width:18px;height:18px;border-radius:50%;cursor:pointer;font-size:11px;line-height:1;display:flex;align-items:center;justify-content:center;}
.pv2-chip-add{background:none;border:1px dashed var(--warm-border);color:var(--warm-gray);font-weight:600;font-size:12.5px;padding:5px 11px;border-radius:16px;cursor:pointer;font-family:var(--font-body);}
.pv2-tile{flex:1;background:var(--warm-surface-page);border:1px solid var(--warm-divider);border-radius:12px;padding:12px 14px;}
.pv2-tile-lbl{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;color:var(--warm-meta);}
.pv2-tile-val{font-size:22px;font-weight:800;margin-top:3px;}
.pv2-gift{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--warm-row-divider);}
.pv2-gift:last-child{border-bottom:none;}
.pv2-note{padding:11px 13px;background:var(--color-cream);border:1px solid var(--warm-divider);border-radius:11px;}
.pv2-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--color-navy);color:var(--white);font-weight:600;font-size:14px;padding:11px 20px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);display:none;align-items:center;gap:9px;z-index:60;animation:pv2fadeup .18s ease;}
.pv2-toast.show{display:flex;}
.pv2-toast .ck{color:var(--sage);}
@keyframes pv2fadeup{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}
@media(max-width:900px){
  .pv2-body{flex-direction:column;}
  .pv2-grid{grid-template-columns:1fr;}
  /* Narrow: the side "Jump to" rail is replaced by a compact dropdown menu. */
  .pv2-nav{display:none;}
  .pv2-nav-select{display:block;}
  .pv2-inp{max-width:100%;}
}
/* ── HOUSEHOLD VIEW (full page, mirrors Person Profile) ── */
.content-area.hv-mode > .topbar{display:none;}
.content-area.hv-mode > .tab-panel{display:none!important;}
.content-area.hv-mode > #household-view{display:flex;}
/* ── ORGANIZATION VIEW (full page, mirrors Household View) ── */
.content-area.ov-mode > .topbar{display:none;}
.content-area.ov-mode > .tab-panel{display:none!important;}
.content-area.ov-mode > #organization-view{display:flex;}
#organization-view{display:none;flex-direction:column;flex:1;overflow:hidden;background:var(--warm-surface-card);}
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
@media(max-width:767px){
  .hv-hdr{flex-direction:column;align-items:center;text-align:center;padding:18px;}
  .hv-icon-tile{width:60px;height:60px;font-size:22px;}
  .hv-name{font-size:20px;}
  .hv-addr{font-size:13px;}
  .hv-summary{display:none!important;}
}
/* ── ROLE-BASED VISIBILITY ── */
/* .require-finance/.require-staff/.require-register, plus the Reports sidebar item's
   office exclusion, are admin-configurable per role (Settings -> Giving -> ... no, wait
   actually admin-configurable via applyPermissionUI() in js-core.js, driven by /admin/api/me's
   permissions field (see api-utils.js) -- NOT hardcoded CSS below. Member always gets false
   for all three regardless of config (member is a structurally different, non-configurable
   view), which is why role-member still has its own static rules here as a belt-and-suspenders
   fallback in case JS hasn't run yet. */
/* .require-edit     = visible for admin + finance + staff + office (not member) -- fixed, not configurable */
/* .require-admin    = admin only -- fixed, not configurable */
/* .no-member        = hidden for member role */
.role-member .require-finance{display:none!important;}
.role-member .require-tuitionaid{display:none!important;}
.role-member .require-financeov{display:none!important;}
.role-member .require-attendance{display:none!important;}
.role-finance .require-staff{display:none!important;}
.role-member .require-staff{display:none!important;}
.role-member  .require-register{display:none!important;}
.role-member .require-edit{display:none!important;}
.role-member .no-member{display:none!important;}
/* Per-feature EDIT affordances (create/edit buttons inside a feature tab) — hidden by
   default; applyPermissionUI() in js-core.js adds a body.perm-edit-<item> class for the
   current role when that item's level is 'edit', which reveals them. Buttons are
   inline-block, so that's what we restore. The server enforces edit regardless. */
.require-edit-giving,.require-edit-tuitionaid,.require-edit-finance,.require-edit-attendance,.require-edit-followups,.require-edit-register{display:none!important;}
body.perm-edit-giving .require-edit-giving,
body.perm-edit-tuitionaid .require-edit-tuitionaid,
body.perm-edit-finance .require-edit-finance,
body.perm-edit-attendance .require-edit-attendance,
body.perm-edit-followups .require-edit-followups,
body.perm-edit-register .require-edit-register{display:inline-block!important;}
.role-finance .require-admin{display:none!important;}
.role-staff   .require-admin{display:none!important;}
.role-office  .require-admin{display:none!important;}
.role-member  .require-admin{display:none!important;}
/* ── PRINT ── */
@media print{
  .sidebar,.topbar,.toolbar,.modal-overlay,#offline-banner{display:none!important;}
  /* Only the currently-active tab prints — a plain window.print() (Finance's Church Report,
     Commercial Property, etc. all just call window.print() with no scoping class) used to force
     EVERY tab in a hardcoded whitelist (#tab-reports/#tab-finance/#tab-scheduler/#tab-giving/
     #tab-attendance) visible at once, so printing from Finance also printed whatever was left
     rendered inside the Attendance tab. Scope to .active instead so exactly one tab prints. */
  .tab-panel{display:none!important;}
  .tab-panel.active{display:block!important;padding:0;}
  #tab-giving{display:none!important;}
  body{background:white;}
  /* Attendance tab: only the active att-panel prints (tab bar + inactive panels hidden). The
     Council Packet report additionally sets body.printing-att-packet to print just that card. */
  #tab-attendance .att-tabbar{display:none!important;}
  body.printing-att-packet .tab-panel:not(#tab-attendance){display:none!important;}
  body.printing-att-packet #tab-attendance .att-panel:not(#att-panel-reports){display:none!important;}
  body.printing-att-packet .att-report-grid{display:none!important;}
  /* Board Report (giving redesign): printBoardPage() sets body.printing-board so only the
     board panel prints, the shared subnav header + toolbar hide, and the grids stay full-width. */
  body.printing-board .tab-panel:not(#tab-giving){display:none!important;}
  body.printing-board #tab-giving{display:block!important;}
  body.printing-board #tab-giving > div:not(#giv-view-reports){display:none!important;}
  body.printing-board #giv-view-reports{display:block!important;}
  /* Analysis mode's tile grid never belongs in a printed council packet, even if it was the
     mode on screen when Print was clicked. */
  body.printing-board #giv-analysis-body{display:none!important;}
  body.printing-board .board-else-strip{display:none!important;}
  body.printing-board .board-toolbar{display:none!important;}
  body.printing-board .board-kpi-grid{grid-template-columns:repeat(4,1fr)!important;}
  body.printing-board .board-body-grid{grid-template-columns:1.55fr 1fr!important;}
  body.printing-board .board-narrative{box-shadow:none;padding:0;width:100%;min-height:0;}
  .report-output{border:none;padding:0;}
  .report-tiles{display:none;}
  button{display:none!important;}
  /* Finance tab: only the active report section (Church/Daycare, toggled via finShowSection)
     should print — the flat sub-nav bar and any inactive panel (already display:none inline
     for Church/Daycare/Giving Reports) hide. Overview has no print button so it never prints. */
  .fin-subnav{display:none!important;}
  #fin-panel-overview{display:none!important;}
  /* Compensation: "Print for Council" renders a purpose-built flowing document into
     #fin-comp-print-root and sets body.printing-comp. That document is the ONLY thing that
     prints — the workspace with its chrome hidden is a different layout entirely (a drafted
     motion, a page per worker, full range tables), so it is hidden rather than reformatted. */
  body.printing-comp .tab-panel:not(#tab-finance){display:none!important;}
  body.printing-comp #tab-finance{display:block!important;}
  body.printing-comp #tab-finance > div > div > div:not(#fin-panel-compensation){display:none!important;}
  body.printing-comp #fin-comp-root > *:not(.fin-comp-print-root){display:none!important;}
  body.printing-comp #fin-comp-header-static{display:none!important;}
  body.printing-comp .fin-comp-print-root{display:block!important;}
  .fin-comp-rpt-worker{break-before:page;break-inside:avoid;}
  .fin-comp-rpt-page{break-before:page;}
  .fin-comp-rpt .kt{break-inside:avoid;orphans:3;widows:3;}
  .fin-comp-rpt-table thead{display:table-header-group;}
  @page{margin:0.7in;}
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
@media(max-width:767px){
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
@media(max-width:767px){.ev-field-row{grid-template-columns:1fr;}}
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
@media(max-width:767px){.ev-master-detail{flex-direction:column;}.ev-list-col{width:100%;border-right:none;border-bottom:1px solid var(--ev-border);}}
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
@media(max-width:900px){.tap-grid2,.tap-grid2b{grid-template-columns:1fr;}}
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

#p-count-mobile{display:none;}
/* ══ PHONE-FIRST PASS — Dashboard & People ══════════════════════════════════════════════
   Everything before this was defect repair: stop iOS zooming, stop tables widening the page,
   make the pager reachable. This is the first pass aimed at what a phone user actually needs on
   the two screens they open most — and, for the member tier, essentially the only two.

   The structural work was already in place and is deliberately NOT redone here: the person
   profile stacks and swaps its side rail for a dropdown at 900px, the People list becomes
   contact cards at 767px, and tapping one opens the full profile (a better mobile answer than
   the quickview panel, which stays hidden). What was missing is ergonomics. */
@media(max-width:767px){
  /* SEARCH STAYS PUT. .tab-panel.active is the scroll container and .toolbar is a normal flex
     item inside it, so search and Filters scrolled away the moment you moved down the list —
     on a directory whose whole purpose is looking someone up. Sticky keeps them in reach.
     Scoped to #tab-people rather than .toolbar generally: the same bar is used by several tabs
     and this pass is only chartered for two screens. The negative margins + matching padding
     bleed the sticky background over .tab-panel's own 20px/24px padding, so cards scrolling
     underneath disappear behind it cleanly instead of showing through at the edges. */
  #tab-people .toolbar{
    position:sticky;top:0;z-index:6;background:var(--bg);
    margin:-20px -24px 8px;padding:20px 24px 10px;
    border-bottom:1px solid var(--border);
  }
  /* The phone-only result count, fed by renderPeoplePager(). Desktop hides it: there the pager
     is on screen already and this would just be a duplicate. */
  #p-count-mobile{
    display:block;font-size:.78rem;font-weight:700;color:var(--warm-gray);
    text-transform:uppercase;letter-spacing:.04em;padding:2px 0 8px;
  }

  /* DASHBOARD DENSITY. The 20px grid gaps and 20-24px card padding are tuned for a 1440px
     desktop; on a 390px screen they spend a third of the width on whitespace and push the
     second stat row below the fold. Tightening them is the difference between seeing two rows
     of numbers on open and seeing one. Stat tiles stay 2-up — 1-up would be legible but would
     turn four numbers into four screens of scrolling. */
  .dash-stats{gap:10px;margin-bottom:16px;}
  .dash-row{gap:12px;margin-bottom:14px;}
  .dash-stat{padding:14px 14px;border-radius:16px;}
  .dash-stat-val{font-size:26px;}
  .dash-card-hdr{padding:14px 16px 8px;font-size:14px;}
  .dash-card{border-radius:16px;}
  /* Nested 2x2 inside a single tile is ~85px per cell at this width — unreadable. One column. */
  .dash-stat-quad-grid{grid-template-columns:1fr;gap:8px;}
}

/* ══ MOB2 — wide tables scroll instead of widening the page ════════════════════════════
   55 of this app's 99 tables had no horizontal scroll container (js-reports.js 20 bare of 23,
   js-finance.js 16 of 40, js-attendance.js 5 of 5). A bare wide table does not scroll — it
   widens the PAGE, so the whole layout shifts and the user can pan the entire UI sideways off
   screen with no way back. That is the worst-feeling class of mobile breakage.

   Done as one descendant rule rather than 55 markup edits, for a specific reason: 65 of the 99
   tables carry no CSS class at all — they are built with inline styles in JS string concat — so
   a class-targeted rule would reach barely a third of them, and hand-editing 55 call sites is
   both expensive and exactly the kind of change that regresses silently.

   Scoped to phones only. The defect exists only where the viewport is narrower than the table,
   so desktop keeps normal table layout untouched and the blast radius is limited to the place
   the bug actually lives. Tables already wrapped in an overflow-x container are unaffected in
   practice — the table scrolls itself and the wrapper simply never needs to.

   .content-area covers the tab panels, the profile view and the household/organization views;
   .modal covers dialog tables, which sit outside .content-area because they are position:fixed.

   .dir-table is excluded: its <th> uses position:sticky for a frozen header, which display:block
   defeats. It is the desktop People table and is already display:none on phones (see the
   #p-grid rule above), so excluding it costs nothing and avoids a pointless interaction.

   No white-space:nowrap here on purpose. Letting cells wrap means a table that CAN fit does
   fit, and only genuinely wide ones scroll — gentler than forcing every table into a scroller. */
@media(max-width:767px){
  .content-area table:not(.dir-table),
  .modal table:not(.dir-table){display:block;overflow-x:auto;max-width:100%;}
}

/* ══ MOB1 — stop iOS zooming the viewport on every field focus ══════════════════════════
   iOS Safari zooms the whole page whenever a focused form field's text is under 16px, on the
   assumption it would otherwise be unreadable while typing. It does NOT zoom back out, so the
   user pinches out, taps the next field, and it happens again. Every input in this app was
   under the line (.9rem / .85rem / .82rem / 15px / 13px / .78rem / .72rem), so this affected
   every form on every tab — and the very first field a member ever touches is the login
   username box.

   Three things about this rule are deliberate:

   1. !important. 56 inputs in html-tabs.js carry an INLINE font-size, and an inline style beats
      a media query — a plain rule would silently skip all of them. That is the same
      presence-vs-effect failure as VUX15 and as the mobile-pagination fix that shipped doing
      nothing (v1.121.3). Stripping those 56 inline styles is the cleaner answer but belongs
      with the CR4 inline-style cleanup, not here. The mobile block above already uses
      !important for the same reason.
   2. Placed at the very END of the stylesheet, after every base rule. A media query carries no
      extra specificity, so source order decides between same-specificity rules — the lesson
      from v1.121.4.
   3. 16px exactly, not a bump to everything. .att-input is deliberately 1.65rem (~26px) for
      thumb-friendly attendance entry; a blanket 16px would SHRINK it, so it is restored below.
      Non-text controls are excluded — they never trigger zoom and sizing them can disturb
      layout.

   Scoped to 767px to match this app's existing definition of "phone". iPad portrait (768px)
   has the same iOS behavior but gets the desktop layout, where the smaller type is correct;
   revisit with MOB3's breakpoint consolidation if tablet typing becomes a real complaint. */
@media(max-width:767px){
  input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]),
  select,
  textarea{font-size:16px!important;}
  /* Keep the intentionally-oversized attendance entry fields oversized. */
  .att-input{font-size:1.65rem!important;}
  /* The one input pinned narrow enough to clip its own text at 16px. */
  .tap-slider-row input[type=number]{width:78px;}
}
</style>
</head>
<body>
<div id="offline-banner">You are offline — showing cached contacts</div>
<div id="error-boundary" role="alert" aria-live="assertive" style="display:none;position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9999;background:#c0392b;color:var(--white);padding:11px 20px;border-radius:9px;font-size:.85rem;max-width:520px;width:90vw;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,.3);"></div>
<div class="app-shell">
<nav class="sidebar" id="sidebar">
  <div class="s-logo" onclick="showTab('home')" title="Home"><svg viewBox="0 0 60 60" aria-label="Connect"><circle cx="22" cy="25" r="11" fill="#4D6BA0"/><circle cx="38" cy="25" r="11" fill="#2E7EA6"/><circle cx="30" cy="38" r="11" fill="#C9973A"/><circle cx="30" cy="30" r="1.6" fill="#F8F4EE"/></svg></div>
  <div class="s-item active no-member" data-tab="home" onclick="showTab('home')"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg><span class="s-tip">Home</span></div>
  <div class="s-section-hdr">People</div>
  <div class="s-item" data-tab="people" onclick="showTab('people')"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg><span class="s-tip">People</span></div>
  <div class="s-item no-member" data-tab="households" onclick="showTab('households')"><svg viewBox="0 0 24 24"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/></svg><span class="s-tip">Households</span></div>
  <div class="s-item no-member" data-tab="organizations" onclick="showTab('organizations')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="1"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/><line x1="12" y1="12" x2="12" y2="17"/><line x1="9" y1="14.5" x2="15" y2="14.5"/></svg><span class="s-tip">Organizations</span></div>
  <div class="s-section-hdr require-finance" id="s-hdr-finance">Finance</div>
  <div class="s-item require-finance" data-tab="giving" onclick="showTab('giving')"><svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8L2 7h20l-6-4z"/></svg><span class="s-tip">Giving</span></div>
  <div class="s-item require-tuitionaid" data-tab="tuitionaid" onclick="showTab('tuitionaid')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 2 3 3 6 3s6-1 6-3v-5"/></svg><span class="s-tip">Tuition Aid</span></div>
  <div class="s-item require-financeov" data-tab="finance" onclick="showTab('finance')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M15 9.5c0-1.4-1.34-2.5-3-2.5s-3 1-3 2.25S10.34 11.5 12 11.5s3 1.1 3 2.25S13.66 16 12 16s-3-1.1-3-2.5"/></svg><span class="s-tip">Financial Reports</span></div>
  <div class="s-section-hdr no-member">Ministry</div>
  <div class="s-item require-attendance" data-tab="attendance" onclick="showTab('attendance')"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4"/></svg><span class="s-tip">Attendance</span></div>
  <div class="s-item no-member require-reports" data-tab="reports" onclick="showTab('reports')"><svg viewBox="0 0 24 24"><path d="M18 20V10M12 20V4M6 20v-6"/></svg><span class="s-tip">Reports</span></div>
  <div class="s-item require-register" data-tab="register" onclick="showTab('register')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/><line x1="9" y1="7" x2="17" y2="7"/><line x1="9" y1="11" x2="14" y2="11"/></svg><span class="s-tip">Register</span></div>
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
