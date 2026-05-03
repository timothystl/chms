// ── Scheduler HTML template ────────────────────────────────────────────────────
// Full page HTML for the worship scheduler app at /scheduler
export const SCHEDULER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<base href="/scheduler/">
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Timothy Lutheran Church – Worship Schedule Builder</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,700;1,400&family=Source+Sans+3:wght@300;400;600;700;800&display=swap" rel="stylesheet">
<style>
:root {
  --steel-anchor: #0A3C5C;
  --deep-steel:   #2A5470;
  --mid-steel:    #3D627C;
  --sky-steel:    #5C8FA8;
  --ice-blue:     #C4DDE8;
  --blue-mist:    #EDF5F8;
  --amber:        #D4922A;
  --deep-amber:   #C07D1E;
  --honey:        #E8B86D;
  --pale-gold:    #F5E0B0;
  --sage:         #6B8F71;
  --soft-sage:    #9AB89E;
  --pale-sage:    #CDE0CF;
  --warm-white:   #FAF7F0;
  --linen:        #F2EDE2;
  --white:        #FFFFFF;
  --border:       #E8E0D0;
  --charcoal:     #3D3530;
  --warm-gray:    #7A6E60;
  --font-head: 'Lora', Georgia, serif;
  --font-body: 'Source Sans 3', Arial, sans-serif;
  /* Semantic text colors for status backgrounds */
  --on-pale-gold:  #5a3a00;
  --on-pale-sage:  #1a3d1f;
  --on-error-bg:   #7a1f1f;
  --error-bg:      #FAEAEA;
  --error-border:  #D4726A;
  --danger-btn:    #B85C3A;
  --danger-hover:  #A04A2A;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font-body); background: var(--warm-white); color: var(--charcoal); }

header { background: var(--white); color: var(--steel-anchor); padding: 14px 24px; display: flex; align-items: center; gap: 16px; border-bottom: 3px solid var(--amber); box-shadow: 0 2px 12px rgba(10,60,92,0.07); }
header .header-logo { width: 52px; height: 52px; border-radius: 50%; object-fit: cover; flex-shrink: 0; border: 2px solid var(--ice-blue); }
header .header-logo-placeholder { width: 52px; height: 52px; border-radius: 50%; background: var(--blue-mist); border: 2px solid var(--ice-blue); flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; }
header .header-text h1 { font-size: 1.05rem; font-weight: 700; line-height: 1.2; color: var(--steel-anchor); font-family: var(--font-head); }
header .header-text .church-name { font-size: 0.75rem; color: var(--amber); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 2px; font-weight: 700; }
header .header-text p { font-size: 0.82rem; color: var(--warm-gray); margin-top: 2px; }

.tabs { display: flex; background: var(--steel-anchor); flex-wrap: wrap; border-bottom: 3px solid var(--amber); }
.tab-btn { padding: 12px 24px; background: none; border: none; color: rgba(255,255,255,0.7); font-size: 0.88rem; font-weight: 700; font-family: var(--font-body); cursor: pointer; border-bottom: 3px solid transparent; margin-bottom: -3px; transition: all 0.15s; white-space: nowrap; }
.tab-btn.active { color: white; border-bottom-color: var(--amber); background: rgba(255,255,255,0.1); }
.tab-btn:hover:not(.active) { color: white; background: rgba(255,255,255,0.1); }

.tab-content { display: none; padding: 24px; max-width: 1100px; margin: 0 auto; }
.tab-content.active { display: block; }

.card { background: var(--white); border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 2px 12px rgba(10,60,92,0.07); padding: 20px; margin-bottom: 20px; transition: box-shadow 0.2s; }
.card:hover { box-shadow: 0 6px 32px rgba(10,60,92,0.13); }
.card h2 { font-size: 1.05rem; color: var(--steel-anchor); font-family: var(--font-head); margin-bottom: 14px; border-bottom: 2px solid var(--border); padding-bottom: 8px; }
.card h3 { font-size: 0.95rem; color: var(--steel-anchor); font-family: var(--font-head); margin: 16px 0 10px; }

label { display: block; font-size: 0.82rem; font-weight: 700; color: var(--warm-gray); margin-bottom: 4px; margin-top: 10px; font-family: var(--font-body); letter-spacing: 0.04em; }
input[type="text"], input[type="date"], input[type="password"] { width: 100%; padding: 10px 14px; border: 1px solid var(--border); border-radius: 8px; font-size: 0.9rem; font-family: var(--font-body); color: var(--charcoal); background: var(--white); outline: none; }
input[type="text"]:focus, input[type="date"]:focus, input[type="password"]:focus { border-color: var(--amber); box-shadow: 0 0 0 3px rgba(212,146,42,0.15); }
select.form-select { width: 100%; padding: 10px 14px; border: 1px solid var(--border); border-radius: 8px; font-size: 0.9rem; font-family: var(--font-body); color: var(--charcoal); background: var(--white); outline: none; }

.checkbox-group { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.checkbox-group label { display: flex; align-items: center; gap: 5px; font-weight: 600; font-size: 0.85rem; letter-spacing: 0; text-transform: none; cursor: pointer; background: var(--linen); border: 1px solid var(--border); border-radius: 8px; padding: 4px 9px; margin: 0; transition: all 0.1s; user-select: none; color: var(--charcoal); }
.checkbox-group label:hover { background: var(--blue-mist); }
.checkbox-group label.checked { background: var(--steel-anchor); color: white; border-color: var(--steel-anchor); }

.radio-group { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
.radio-group label { display: flex; align-items: center; gap: 5px; font-weight: 600; font-size: 0.85rem; letter-spacing: 0; text-transform: none; cursor: pointer; background: var(--linen); border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px; margin: 0; transition: all 0.1s; user-select: none; color: var(--charcoal); }
.radio-group label:hover { background: var(--blue-mist); }

.btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 20px; border-radius: 6px; border: none; font-size: 0.88rem; font-weight: 700; font-family: var(--font-body); cursor: pointer; transition: all 0.15s; }
.btn-primary { background: var(--steel-anchor); color: white; }
.btn-primary:hover { background: var(--deep-steel); }
.btn-success { background: var(--sage); color: white; }
.btn-success:hover { background: var(--soft-sage); }
.btn-danger { background: var(--danger-btn); color: white; }
.btn-danger:hover { background: var(--danger-hover); }
.btn-warning { background: var(--amber); color: var(--steel-anchor); }
.btn-warning:hover { background: var(--deep-amber); color: white; }
.btn-outline { background: transparent; border: 1.5px solid var(--steel-anchor); color: var(--steel-anchor); }
.btn-outline:hover { background: var(--blue-mist); }
.btn-sm { padding: 5px 12px; font-size: 0.82rem; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* People table */
.people-table { width:100%; border-collapse:collapse; font-size:.85rem; }
.people-table thead tr { background: var(--steel-anchor); }
.people-table thead th { background: var(--steel-anchor); color: white; border:none; text-align:left; }
.people-table th { padding:9px 12px; text-align:left; font-weight:700; color: white; font-size:.8rem; font-family: var(--font-body); letter-spacing: 0.06em; text-transform: uppercase; white-space:nowrap; border-bottom:2px solid var(--deep-steel); cursor:pointer; user-select:none; }
.people-table th:hover { background: var(--deep-steel); }
.sort-arrow { display:inline-block; margin-left:4px; opacity:.45; font-size:.72rem; }
.sort-arrow.on { opacity:1; }
.people-table td { padding:9px 12px; border-bottom:1px solid var(--border); vertical-align:middle; }
.people-table tbody tr:last-child td { border-bottom:none; }
.people-table tbody tr:hover { background: var(--blue-mist); }
.pt-name { font-weight:700; color: var(--steel-anchor); font-family: var(--font-head); }
.pt-email { font-size:.74rem; color: var(--warm-gray); margin-top:1px; }
.pt-roles { display:flex; flex-wrap:wrap; gap:4px; }
.pt-svc { display:inline-block; font-size:.75rem; font-weight:700; color:var(--on-pale-gold); background: var(--pale-gold); padding:2px 8px; border-radius:999px; white-space:nowrap; border: 1px solid var(--honey); }
.pt-actions { white-space:nowrap; text-align:right; }
/* Schedule cell override / primary indicators */
.override-cell { box-shadow: inset 3px 0 0 var(--amber); }
.primary-cell  { box-shadow: inset 3px 0 0 var(--sage); }
.cell-badge { font-size:.62rem; vertical-align:super; margin-left:2px; line-height:0; }
.cell-badge-override { color: var(--deep-amber); }
.cell-badge-primary  { color: var(--sage); }

/* ── Side Panels ─────────────────────────────── */
.panel-overlay {
  position:fixed; inset:0; background:rgba(0,0,0,0.45);
  z-index:300; opacity:0; pointer-events:none; transition:opacity .25s;
}
.panel-overlay.open { opacity:1; pointer-events:auto; }
.side-panel {
  position:fixed; top:0; right:0; width:min(520px,100vw); height:100vh;
  background: var(--white); z-index:301;
  display:flex; flex-direction:column;
  transform:translateX(100%); transition:transform .28s cubic-bezier(.4,0,.2,1);
}
.side-panel.open { transform:translateX(0); box-shadow:-4px 0 40px rgba(10,60,92,0.18); }
.panel-hdr {
  display:flex; align-items:center; justify-content:space-between;
  padding:14px 20px; background: var(--steel-anchor); color:white; flex-shrink:0;
}
.panel-hdr h2 { margin:0; font-size:1.05rem; color:white; font-weight:700; font-family: var(--font-head); }
.panel-close {
  background:none; border:none; color:rgba(255,255,255,0.8);
  font-size:1.6rem; cursor:pointer; padding:0 4px; line-height:1;
}
.panel-close:hover { color:white; }
.panel-body { flex:1; overflow-y:auto; padding:20px; }
.header-gear {
  margin-left:auto; align-self:center;
  background:rgba(255,255,255,0.12); border:1px solid rgba(255,255,255,0.3);
  color:rgba(255,255,255,0.85); border-radius:6px; padding:7px 14px; cursor:pointer;
  font-size:.85rem; font-family: var(--font-body); line-height:1; transition:background .15s; white-space:nowrap;
  margin-right:8px;
}
.header-gear:hover { background:rgba(255,255,255,0.28); }

.tag { border-radius: 999px; padding: 2px 10px; font-size: 0.78rem; font-family: var(--font-body); font-weight: 700; }
.tag-sunday { background: var(--blue-mist); color: var(--steel-anchor); border: 1px solid var(--ice-blue); }
.tag-service { background: var(--pale-gold); color: var(--on-pale-gold); border: 1px solid var(--honey); }
.tag-role { background: var(--pale-sage); color: var(--on-pale-sage); border: 1px solid var(--soft-sage); }
.tag-breeze { background: var(--ice-blue); color: var(--steel-anchor); border: 1px solid var(--sky-steel); }
.blackout-chip { display:inline-flex; align-items:center; gap:4px; background:var(--error-bg); color:var(--on-error-bg); border:1px solid var(--error-border); border-radius:999px; padding:2px 8px; font-size:0.78rem; font-family: var(--font-body); }
.blackout-chip button { background:none; border:none; cursor:pointer; color:var(--on-error-bg); font-size:0.9rem; line-height:1; padding:0 0 0 2px; }
#blackout-chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; min-height:24px; }

/* Schedule */
.schedule-controls { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end; margin-bottom: 16px; }
.schedule-controls .field { display: flex; flex-direction: column; gap: 4px; }
.schedule-controls .field label { font-size: 0.82rem; font-weight: 700; color: var(--warm-gray); margin: 0; }
.schedule-controls .field input { width: 160px; }

.table-wrapper { overflow-x: auto; margin-top: 14px; background: var(--white); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
table { border-collapse: collapse; font-size: 0.82rem; width: 100%; }
thead th { background: var(--steel-anchor); color: white; padding: 10px 10px; text-align: center; white-space: nowrap; border: 1px solid var(--deep-steel); font-family: var(--font-body); font-weight: 700; font-size: 0.75rem; letter-spacing: 0.06em; text-transform: uppercase; }
thead th.date-col { background: var(--deep-steel); position: sticky; left: 0; z-index: 3; }
thead th.shared-col { background: var(--sage); }
thead th.svc-header { background: var(--mid-steel); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; }
tbody tr { background: transparent; }
tbody tr:hover td { filter: brightness(0.97); }
td { padding: 6px 8px; border: 1px solid var(--border); text-align: center; vertical-align: middle; min-width: 90px; font-family: var(--font-body); }
td.date-cell { font-weight: 700; color: var(--steel-anchor); background: var(--blue-mist); text-align: left; white-space: nowrap; min-width: 120px; position: sticky; left: 0; z-index: 1; font-family: var(--font-head); }
td .ordinal { font-size: 0.75rem; color: var(--warm-gray); display: block; font-family: var(--font-body); font-weight: 400; }
td.empty-cell { background: var(--error-bg); }
td.filled-cell { background: var(--pale-sage); }
/* Service label column */
td.svc-label { font-size: 0.74rem; font-weight: 700; white-space: nowrap; min-width: 44px; padding: 4px 6px; font-family: var(--font-body); }
td.svc-8am   { background: var(--ice-blue) !important; color: var(--steel-anchor); border-right: 2px solid var(--sky-steel); }
td.svc-1045  { background: var(--pale-gold) !important; color: var(--on-pale-gold); border-right: 2px solid var(--honey); }
tr.row-1045 td { border-bottom: 2px solid var(--border); }
td.shared-cell { background: var(--pale-sage) !important; }
thead th.svc-col { background: var(--steel-anchor); min-width: 36px; }
thead th.per-header { background: var(--mid-steel); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
.cell-select { width: 100%; font-size: 0.8rem; border: 1px solid var(--border); border-radius: 7px; background: transparent; cursor: pointer; padding: 2px 4px; font-family: var(--font-body); }

.legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 0.8rem; font-family: var(--font-body); }
.legend-item { display: flex; align-items: center; gap: 5px; }
.legend-dot { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }

.summary-bar { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
.summary-item { background: var(--blue-mist); border: 1px solid var(--ice-blue); border-radius: 8px; padding: 5px 12px; font-size: 0.82rem; font-family: var(--font-body); }
.summary-item strong { color: var(--steel-anchor); }

.empty-state { text-align: center; padding: 40px 20px; color: var(--warm-gray); }
.empty-state .icon { font-size: 2.5rem; margin-bottom: 10px; }

.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 10px; }
@media (max-width: 600px) { .form-row { grid-template-columns: 1fr; } }

.alert { padding: 12px 16px; border-radius: 0 8px 8px 0; margin-bottom: 16px; font-size: 0.88rem; font-family: var(--font-body); }
.alert-warning { background: var(--pale-gold); border-left: 3px solid var(--amber); color: var(--on-pale-gold); }
.alert-success { background: var(--pale-sage); border-left: 3px solid var(--sage); color: var(--on-pale-sage); }
.alert-danger  { background: var(--error-bg); border-left: 3px solid var(--error-border); color: var(--on-error-bg); }
.alert-info    { background: var(--blue-mist); border-left: 3px solid var(--mid-steel); color: var(--steel-anchor); }

/* Breeze sync */
.sync-step { border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 16px; }
.sync-step-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.step-badge { background: var(--steel-anchor); color: white; border-radius: 50%; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; font-weight: 700; flex-shrink: 0; font-family: var(--font-body); }
.step-title { font-weight: 700; font-size: 1rem; color: var(--steel-anchor); font-family: var(--font-head); }

.people-map-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.people-map-table th { background: var(--blue-mist); padding: 7px 10px; text-align: left; border: 1px solid var(--border); font-weight: 700; color: var(--steel-anchor); font-family: var(--font-body); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; }
.people-map-table td { padding: 6px 10px; border: 1px solid var(--border); vertical-align: middle; font-family: var(--font-body); }
.people-map-table tr:nth-child(even) { background: var(--linen); }

.event-map-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.event-map-table th { background: var(--blue-mist); padding: 7px 10px; text-align: left; border: 1px solid var(--border); font-weight: 700; color: var(--steel-anchor); font-family: var(--font-body); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; }
.event-map-table td { padding: 6px 10px; border: 1px solid var(--border); vertical-align: middle; font-family: var(--font-body); }
.event-map-table tr:nth-child(even) { background: var(--linen); }
.event-map-table select { width: 100%; font-size: 0.82rem; padding: 4px; border: 1px solid var(--border); border-radius: 4px; font-family: var(--font-body); }

.log-box { background: #1a1a2e; color: #e0e0e0; border-radius: 12px; padding: 14px; font-family: monospace; font-size: 0.82rem; max-height: 300px; overflow-y: auto; margin-top: 12px; }
.log-ok  { color: #4ade80; }
.log-err { color: #f87171; }
.log-info { color: #93c5fd; }

.status-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px; }
.dot-ok  { background: var(--sage); }
.dot-err { background: var(--danger-btn); }
.dot-pending { background: var(--warm-gray); }

/* ── Pending sign-up review cards ─────────────────────────────── */
.signup-card { border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; background: var(--white); }
.signup-card-name { font-weight: 700; font-size: 1rem; color: var(--steel-anchor); font-family: var(--font-head); }
.signup-card-email { font-size: .82rem; color: var(--warm-gray); margin-top: 1px; }
.signup-card-meta { margin-top: 8px; font-size: .83rem; color: var(--charcoal); display: flex; flex-direction: column; gap: 4px; }
.signup-card-meta .sc-label { font-weight: 700; color: var(--warm-gray); font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; }
.signup-card-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.signup-card-date { font-size: .75rem; color: var(--warm-gray); margin-top: 4px; }

/* ── Event admin accordion cards ─────────────────────── */
.ev-admin-card { border: 1px solid var(--border); border-radius: 10px; margin-bottom: 10px; background: var(--white); overflow: hidden; }
.ev-admin-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; cursor: pointer; user-select: none; background: var(--blue-mist); }
.ev-admin-header:hover { background: var(--ice-blue); }
.ev-admin-toggle { font-size: .9rem; color: var(--steel-anchor); transition: transform .2s; display: inline-block; }
.ev-admin-header.open .ev-admin-toggle { transform: rotate(90deg); }
.ev-admin-title { font-weight: 700; font-size: .95rem; color: var(--steel-anchor); font-family: var(--font-head); flex: 1; }
.ev-admin-date { font-size: .78rem; color: var(--warm-gray); }
.ev-admin-count { font-size: .78rem; background: var(--pale-sage); color: var(--on-pale-sage); border: 1px solid var(--soft-sage); border-radius: 999px; padding: 1px 9px; font-weight: 700; }
.ev-admin-body { display: none; padding: 12px 16px; border-top: 1px solid var(--border); }
.ev-admin-body.open { display: block; }
.ev-role-row { margin-bottom: 10px; }
.ev-role-label { font-size: .82rem; font-weight: 700; color: var(--charcoal); margin-bottom: 4px; }
.ev-role-signups { display: flex; flex-direction: column; gap: 3px; padding-left: 8px; }
.ev-role-empty { font-size: .78rem; color: var(--warm-gray); font-style: italic; }
.ev-signup-row { display: flex; align-items: center; gap: 8px; font-size: .82rem; }
.ev-signup-name { font-weight: 600; color: var(--steel-anchor); }
.ev-signup-email { color: var(--warm-gray); }
.ev-admin-add-role { margin-top: 8px; border-top: 1px dashed var(--border); padding-top: 8px; }

/* ── Print styles ──────────────────────────────────────── */
@page { size: landscape; margin: 0.5in; }
@media print {
  header, .tabs, .schedule-controls, .legend, .summary-bar,
  #schedule-alert, #tab-people, #tab-settings, #tab-breeze,
  .btn, #assignment-summary { display: none !important; }
  body { background: white; }
  .tab-content { display: block !important; padding: 0; }
  #tab-schedule { display: block !important; }
  .card { box-shadow: none; padding: 8px 0; }
  table { font-size: 0.75rem; border-collapse: collapse !important; }
  td, th { padding: 4px 6px; border: 1px solid #999 !important; }
  .cell-select { display: none !important; }
  .conf-pill { display: none !important; }
  .cell-badge { display: none !important; }
  .print-name { display: inline !important; font-size: 0.78rem; }
  .label-input { border: none !important; font-size: 0.7rem; color: #000 !important; padding: 0; }
  /* Force all cells to white/black — no color printing */
  td, td.empty-cell, td.filled-cell, td.shared-cell, td.svc-8am, td.svc-1045 {
    background: #fff !important; color: #000 !important; box-shadow: none !important;
  }
  .sunday-summary td { background: #f0f0f0 !important; color: #000 !important; }
  #tab-stats { display: none !important; }
  /* Hide fixed-position side panels and overlay (they ignore translateX in print) */
  .side-panel, .panel-overlay { display: none !important; }
  .btn-edit-readings { display: none !important; }
  /* Release overflow and fix sticky columns */
  .table-wrapper { overflow: visible !important; }
  thead th { background: #e0e0e0 !important; color: #000 !important; border: 1px solid #999 !important; }
  thead th.date-col, thead th.svc-col { position: static !important; }
  td.date-cell { position: static !important; background: #f0f0f0 !important; color: #000 !important; }
}

/* ── Confirmation tracking ─────────────────── */
.conf-pill { font-size:0.68rem; font-weight:700; padding:2px 7px; border-radius:10px; cursor:pointer; border:none; margin-top:3px; display:block; width:100%; text-align:center; user-select:none; text-transform:uppercase; letter-spacing:0.04em; transition:opacity 0.1s; }
.conf-pill:hover { opacity:0.8; }
.conf-pending   { background: var(--pale-gold); color:var(--on-pale-gold); border-color: var(--honey); }
.conf-confirmed { background: var(--pale-sage); color:var(--on-pale-sage); border-color: var(--soft-sage); }
.conf-declined      { background:var(--error-bg); color:var(--on-error-bg); border-color:var(--error-border); }
.conf-needs_changes { background: var(--pale-gold); color:var(--on-pale-gold); border-color: var(--honey); }

/* ── Sunday label ──────────────────────────── */
.label-input { font-size:0.7rem; color: var(--amber); background:transparent; border:none; border-bottom:1px dashed var(--honey); outline:none; width:100%; margin-top:3px; padding:1px 2px; font-weight:600; font-family: var(--font-body); caret-color: var(--steel-anchor); }
.label-input::placeholder { color:#bbb; font-weight:normal; }
.lect-name-cell { display:block; font-size:.72rem; color: var(--mid-steel); font-weight:500; margin-top:2px; }
.series-cell { display:inline-block; font-size:.68rem; font-weight:700; background: var(--ice-blue); color: var(--steel-anchor); border-radius:6px; padding:0 4px; margin-top:2px; font-family: var(--font-body); }

/* ── History list ──────────────────────────── */
.history-list { display:flex; flex-direction:column; gap:8px; }
.history-item { border:1px solid var(--border); border-radius:12px; padding:10px 14px; display:flex; align-items:center; justify-content:space-between; background: var(--white); }
.history-item .hi-label { font-weight:700; color: var(--steel-anchor); font-size:0.9rem; font-family: var(--font-head); }
.history-item .hi-meta  { font-size:0.78rem; color: var(--warm-gray); }
.history-item .hi-btns  { display:flex; gap:6px; }

/* ── Stats tab ─────────────────────────────── */
.stats-filter { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
.stats-filter label { font-size:.82rem; color: var(--warm-gray); font-weight:700; font-family: var(--font-body); }
.stats-filter input[type=date] { font-size:.82rem; padding:5px 8px; border:1px solid var(--border); border-radius:8px; color: var(--charcoal); font-family: var(--font-body); }
.stats-table { width:100%; border-collapse:collapse; font-size:.84rem; }
.stats-table thead tr { background: var(--steel-anchor); }
.stats-table th { padding:10px 12px; text-align:left; font-size:.72rem; color:white; font-family: var(--font-body);
                  text-transform:uppercase; letter-spacing:.06em; border-bottom:2px solid var(--deep-steel); white-space:nowrap; }
.stats-table th.center { text-align:center; }
.stats-table td { padding:9px 12px; border-bottom:1px solid var(--border); vertical-align:top; font-family: var(--font-body); }
.stats-table tbody tr:hover { background: var(--blue-mist); }
.sv-name { font-weight:700; color: var(--steel-anchor); white-space:nowrap; font-family: var(--font-head); }
.sv-roles { font-size:.78rem; color: var(--warm-gray); }
.sv-count { text-align:center; font-weight:700; color: var(--steel-anchor); }
.sv-last { font-size:.82rem; color: var(--warm-gray); white-space:nowrap; }
@media(max-width:600px){ .stats-table th:nth-child(2), .stats-table td:nth-child(2) { display:none; } }

/* ── Mobile card rows (hidden on desktop, revealed on mobile) ─────────────── */
.sunday-mobile { display: none !important; }
.sched-mc { background: var(--white); }
.sched-mc-svc { padding: 10px 14px; border-bottom: 2px solid var(--linen); }
.sched-mc-svc:last-child { border-bottom: none; }
.sched-mc-shared { background: var(--pale-sage); }
.sched-mc-svctime { font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--warm-gray); margin-bottom: 6px; }
.sched-mc-row { display: flex; align-items: center; padding: 5px 0; border-bottom: 1px solid var(--linen); gap: 10px; }
.sched-mc-row:last-child { border-bottom: none; }
.sched-mc-lbl { width: 110px; flex-shrink: 0; font-size: .72rem; font-weight: 600; color: var(--warm-gray); text-transform: uppercase; letter-spacing: .03em; }
.sched-mc-val { flex: 1; font-size: .9rem; color: var(--charcoal); font-weight: 500; }
.sched-mc-empty .sched-mc-val { color: var(--danger-btn,#b85c3a); font-style: italic; font-weight: 400; }

@media(max-width:600px){
  /* Hide horizontal table detail rows; show vertical cards instead */
  .sunday-detail:not(.sunday-mobile) { display: none !important; }
  .sunday-mobile.visible { display: table-row !important; }
  /* Hide redundant nav links when embedded in ChMS */
  .header-gear { display: none; }
  /* Tab buttons — tighter padding */
  .tab-btn { padding: 8px 14px; font-size: .8rem; }
  /* Tab content — less horizontal padding */
  .tab-content { padding: 12px; }
  /* Month nav */
  .month-nav-bar { gap: 6px; }
  .month-nav-label { min-width: 100px; }
  .btn-sm { padding: 5px 10px; font-size: .78rem; }
  /* Schedule controls — stack vertically */
  .schedule-controls { flex-direction: column; align-items: stretch; gap: 10px; }
  .schedule-controls .field { flex-direction: row; align-items: center; gap: 8px; }
  .schedule-controls .field label { min-width: 80px; flex-shrink: 0; }
  .schedule-controls .field input { flex: 1; width: auto; }
  /* Legend */
  .legend { gap: 8px; font-size: .75rem; }
  /* Table scroll hint */
  .table-wrapper { -webkit-overflow-scrolling: touch; box-shadow: inset -16px 0 12px -8px rgba(0,0,0,.1); }
}

/* ── Sunday summary row (collapsible) ─────────────────────────────────────── */
.sunday-summary td { padding:0; cursor:pointer; background: var(--linen); border-bottom:2px solid var(--border); border-top:1px solid var(--border); }
.sunday-summary:hover td { background: var(--blue-mist); }
.ss-inner { display:flex; align-items:center; gap:12px; padding:9px 14px; flex-wrap:wrap; }
.ss-toggle { font-size:.75rem; color: var(--warm-gray); width:14px; display:inline-block; transition:transform .2s; flex-shrink:0; }
.sunday-summary.expanded .ss-toggle { transform:rotate(90deg); }
.ss-date { font-weight:700; color: var(--steel-anchor); font-size:.9rem; white-space:nowrap; font-family: var(--font-head); width:118px; flex-shrink:0; }
/* Fixed-width label column: Sunday name / ordinal / custom label */
.ss-label-area { width:220px; flex-shrink:0; display:flex; align-items:center; gap:6px; overflow:hidden; padding-right:10px; }
.ss-label { font-size:.8rem; color: var(--amber); font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-family: var(--font-body); }
.ss-ordinal { font-size:.78rem; color: var(--warm-gray); white-space:nowrap; font-family: var(--font-body); }
.ss-lect-name { font-size:.78rem; color: var(--mid-steel); font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-family: var(--font-body); }
.ss-series-badge { display:inline-block; font-size:.7rem; font-weight:700; background: var(--ice-blue); color: var(--steel-anchor); border-radius:7px; padding:0 5px; flex-shrink:0; font-family: var(--font-body); }
/* Fixed-width stats column: "N filled / M open" */
.ss-stats-area { width:175px; flex-shrink:0; display:flex; align-items:center; gap:8px; }
.ss-fill { font-size:.8rem; font-weight:700; font-family: var(--font-body); color: var(--charcoal); }
.ss-open { font-size:.8rem; font-weight:700; color: var(--danger-btn); font-family: var(--font-body); }
.ss-complete { font-size:.8rem; font-weight:700; color: var(--sage); font-family: var(--font-body); }
/* Confirmation badges fill remaining space before buttons */
.ss-conf-area { flex:1; display:flex; align-items:center; gap:5px; }
.sconf-badge { display:inline-flex; align-items:center; font-size:.72rem; font-weight:700;
  padding:2px 7px; border-radius:999px; white-space:nowrap; font-family: var(--font-body); border:1px solid transparent; }
.sconf-confirmed { background: var(--pale-sage); color:var(--on-pale-sage); border-color: var(--soft-sage); }
.sconf-pending   { background: var(--pale-gold); color:var(--on-pale-gold); border-color: var(--honey); }
.sconf-declined  { background:var(--error-bg); color:var(--on-error-bg); border-color:var(--error-border); }
/* When expanded, hide all summary info — detail rows below show everything */
.sunday-summary.expanded .ss-date,
.sunday-summary.expanded .ss-label-area,
.sunday-summary.expanded .ss-stats-area,
.sunday-summary.expanded .ss-conf-area { display:none; }
.sunday-detail   { display:none; }
.sunday-detail.visible { display:table-row; }
.btn-bulletin-slide { display:inline-flex; align-items:center; gap:4px; }
.btn-bulletin-slide:hover { background: var(--blue-mist) !important; border-color: var(--steel-anchor) !important; }

/* ── Month navigation ──────────────────────────────────── */
.month-nav-bar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:4px 0; }
.month-nav-label { font-size:1.05rem; font-weight:700; color: var(--steel-anchor); min-width:150px; text-align:center; font-family: var(--font-head); }

/* ── Save button states ─────────────────────────────────── */
#btn-save-schedule.saved { background: var(--pale-sage); border-color: var(--soft-sage); color: var(--sage); }
#btn-save-schedule.dirty { background: var(--pale-gold); border-color: var(--honey); color:var(--on-pale-gold); font-weight:700; animation:pulse-save .8s ease-in-out; }
@keyframes pulse-save { 0%,100%{box-shadow:none} 50%{box-shadow:0 0 0 3px rgba(212,146,42,0.35)} }

/* ── Special service rows ───────────────────────────────── */
.special-summary td { background: var(--linen); }
.special-summary:hover td { background: var(--pale-gold); }
.ss-special-name { font-size:.82rem; font-weight:700; color: var(--amber); font-family: var(--font-head); }
.special-badge { font-size:.7rem; font-weight:700; background: var(--pale-gold); color:var(--on-pale-gold); border-radius:999px; padding:1px 8px; border:1px solid var(--honey); font-family: var(--font-body); }
.svc-special { background: var(--pale-gold); color:var(--on-pale-gold); font-size:.8rem; font-weight:600; }
.na-cell { background: var(--linen); }
.btn-edit-special, .btn-delete-special { background:none; border:none; cursor:pointer; font-size:.85rem; padding:0 4px; opacity:.55; transition:opacity .15s; margin-left:2px; }
.btn-edit-special:hover  { opacity:1; color: var(--steel-anchor); }
.btn-delete-special:hover{ opacity:1; color: var(--danger-btn); }
.special-expanded { padding:14px 16px; display:flex; flex-wrap:wrap; gap:12px; }
.special-svc-block { background: var(--white); border:1px solid var(--border); border-radius:8px; padding:10px 14px; min-width:190px; }
.special-svc-time { font-weight:700; color: var(--steel-anchor); font-size:.85rem; font-family: var(--font-head); margin-bottom:8px; border-bottom:1px solid var(--border); padding-bottom:6px; }
.special-svc-role-row { display:flex; align-items:center; gap:6px; margin-bottom:5px; font-size:.82rem; font-family: var(--font-body); }
.special-svc-role-label { color: var(--warm-gray); width:110px; flex-shrink:0; text-align:right; }

/* ── Role Sunday override section ───────────────────────── */
.role-override-toggle { font-size:.78rem; color: var(--mid-steel); cursor:pointer; margin-top:8px; display:inline-block; text-decoration:underline; font-family: var(--font-body); }
#role-override-section { display:none; background: var(--blue-mist); border:1px solid var(--ice-blue); border-radius:8px; padding:10px 12px; margin-top:8px; }
.role-override-table { width:100%; font-size:.78rem; border-collapse:collapse; font-family: var(--font-body); }
.role-override-table th { text-align:center; padding:2px 5px; color: var(--warm-gray); font-weight:700; }
.role-override-table th:first-child { text-align:left; }
.role-override-table td { text-align:center; padding:3px 4px; }
.role-override-table td:first-child { font-weight:700; color: var(--steel-anchor); text-align:left; padding-right:8px; white-space:nowrap; }
.role-override-table input[type=checkbox] { width:14px; height:14px; cursor:pointer; }

/* ── Embedded mode (inside ChMS SPA iframe) ─────────────── */
body.embedded header, body.embedded .tabs { display:none!important; }
body.embedded { overflow-y:auto; }
body.embedded #login-screen { display:none!important; }
body.embedded #app-content { display:block!important; }
</style>
</head>
<body>

<!-- ══════════════════ LOGIN SCREEN ══════════════════ -->
<div id="login-screen" style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:var(--blue-mist);">
  <p style="color:var(--steel-anchor);font-family:var(--font-body);">Checking authentication…</p>
</div>

<!-- ══════════════════ APP CONTENT ══════════════════ -->
<div id="app-content" style="display:none;">

<header>
  <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAfQAAAH0CAYAAADL1t+KAAAAAXNSR0IArs4c6QAAAARzQklUCAgICHwIZIgAAAAJcEhZcwAADsQAAA7EAZUrDhsAAAR+aVRYdFhNTDpjb20uYWRvYmUueG1wAAAAAAA8P3hwYWNrZXQgYmVnaW49J++7vycgaWQ9J1c1TTBNcENlaGlIenJlU3pOVGN6a2M5ZCc/Pgo8eDp4bXBtZXRhIHhtbG5zOng9J2Fkb2JlOm5zOm1ldGEvJz4KPHJkZjpSREYgeG1sbnM6cmRmPSdodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjJz4KCiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0nJwogIHhtbG5zOkF0dHJpYj0naHR0cDovL25zLmF0dHJpYnV0aW9uLmNvbS9hZHMvMS4wLyc+CiAgPEF0dHJpYjpBZHM+CiAgIDxyZGY6U2VxPgogICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSdSZXNvdXJjZSc+CiAgICAgPEF0dHJpYjpDcmVhdGVkPjIwMjItMTItMjE8L0F0dHJpYjpDcmVhdGVkPgogICAgIDxBdHRyaWI6RXh0SWQ+NjNlZmI3YzgtNjUwNC00OTAwLWI1MTctZDY0YzNjMWM0ZDZiPC9BdHRyaWI6RXh0SWQ+CiAgICAgPEF0dHJpYjpGYklkPjUyNTI2NTkxNDE3OTU4MDwvQXR0cmliOkZiSWQ+CiAgICAgPEF0dHJpYjpUb3VjaFR5cGU+MjwvQXR0cmliOlRvdWNoVHlwZT4KICAgIDwvcmRmOmxpPgogICA8L3JkZjpTZXE+CiAgPC9BdHRyaWI6QWRzPgogPC9yZGY6RGVzY3JpcHRpb24+CgogPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9JycKICB4bWxuczpkYz0naHR0cDovL3B1cmwub3JnL2RjL2VsZW1lbnRzLzEuMS8nPgogIDxkYzp0aXRsZT4KICAgPHJkZjpBbHQ+CiAgICA8cmRmOmxpIHhtbDpsYW5nPSd4LWRlZmF1bHQnPkNvcHkgb2YgVGltb3RoeSBMb2dvIC0gMTwvcmRmOmxpPgogICA8L3JkZjpBbHQ+CiAgPC9kYzp0aXRsZT4KIDwvcmRmOkRlc2NyaXB0aW9uPgoKIDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PScnCiAgeG1sbnM6cGRmPSdodHRwOi8vbnMuYWRvYmUuY29tL3BkZi8xLjMvJz4KICA8cGRmOkF1dGhvcj5DYWl0bGluIE1heSBEaW5nZXI8L3BkZjpBdXRob3I+CiA8L3JkZjpEZXNjcmlwdGlvbj4KCiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0nJwogIHhtbG5zOnhtcD0naHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wLyc+CiAgPHhtcDpDcmVhdG9yVG9vbD5DYW52YTwveG1wOkNyZWF0b3JUb29sPgogPC9yZGY6RGVzY3JpcHRpb24+CjwvcmRmOlJERj4KPC94OnhtcG1ldGE+Cjw/eHBhY2tldCBlbmQ9J3InPz6bDGgoAAAgAElEQVR4nOyde3xU1dX3f799ZibJDBchELygAgaC1BtSRTJBI6Ct1lr72HghQatW36rV3mur1aK2ta2PT7XPY7W2VSsJWFPvVquCUklAUOodRVDwzl0RZnKbs9f7x5lryG2SCQmwvh8Rzj5777POzJmz9l577bUARVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEURVEUpZ/CvhZAUZT2qHCAWrertfNKzzzIR/+1AIpE7K3RxXMf7qh+ftnMMY7wWgD7CfApiM0i2GzAzRC7SYyzWVzZbA02NzW6m7E89mk28iiKsnNRha4o/Y0JFYHQ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" alt="Timothy Lutheran Church" class="header-logo" id="header-logo-wrap">
  <div class="header-text">
    <div class="church-name">Timothy Lutheran Church</div>
    <h1>Worship Schedule Builder</h1>
    <p>Manage volunteers &amp; generate Sunday service schedules</p>
  </div>
</header>

<div class="tabs">
  <button class="tab-btn active" id="tab-btn-schedule">Schedule</button>
  <button class="tab-btn" id="tab-btn-people">People &amp; Availability <span id="signups-badge" style="display:none;background:var(--amber);color:var(--steel-anchor);border-radius:999px;padding:1px 7px;font-size:0.75rem;font-weight:700;margin-left:4px;"></span></button>
  <button class="tab-btn" id="tab-btn-stats">&#128202; Stats</button>
  <a href="/chms" class="header-gear" style="text-decoration:none;">Church Mgmt</a>
  <a href="/admin" class="header-gear" style="text-decoration:none;">Volunteers</a>
  <button class="header-gear" id="btn-open-settings" title="Settings">&#9881; Settings</button>
  <button class="header-gear" id="btn-header-signout" title="Sign Out" style="margin-left:0;">&#x2192; Sign Out</button>
</div>

<!-- ══ PEOPLE TAB ══════════════════════════════════════════════════════════ -->
<div id="tab-people" class="tab-content">
  <div class="card">
    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
      <h2 style="margin:0;">Volunteers (<span id="people-count">0</span>)</h2>
      <button class="btn btn-warning btn-sm" id="review-signups-btn" style="display:none;" onclick="openPanel('signups-panel');renderSignupsPanel();">&#128203; Scheduler Sign-Ups (<span id="review-signups-count">0</span>)</button>
      <button class="btn btn-success btn-sm" id="review-general-btn" style="display:none;" onclick="openPanel('general-panel');renderGeneralPanel();">&#128101; General Volunteers (<span id="review-general-count">0</span>)</button>
      <a href="/" target="_blank" class="btn btn-outline btn-sm" style="text-decoration:none;">&#128203; Volunteer Sign-Up Page</a>
      <button class="btn btn-primary btn-sm" id="btn-open-person-panel" style="margin-left:auto;">+ Add Person</button>
      <input type="search" id="people-search" placeholder="Filter by name, role, or service…"
             style="max-width:240px;font-size:.85rem;" oninput="peopleSearchQuery=this.value;renderPeopleList();">
    </div>
    <div id="people-list" style="overflow-x:auto;"></div>
  </div>
</div>

<!-- ══ SCHEDULE TAB ════════════════════════════════════════════════════════ -->
<div id="tab-schedule" class="tab-content active">
  <div class="card">
    <div class="month-nav-bar">
      <button class="btn btn-outline btn-sm" id="btn-prev-month">&#8592;</button>
      <span class="month-nav-label" id="current-month-label">Loading…</span>
      <button class="btn btn-outline btn-sm" id="btn-next-month">&#8594;</button>
      <button class="btn btn-primary btn-sm" id="btn-generate">Generate Month</button>
      <button class="btn btn-outline btn-sm" id="btn-autofill" title="Auto-fill empty slots using volunteer history">&#9889; Auto-Fill</button>
      <button class="btn btn-outline btn-sm" id="btn-add-special">+ Special Service</button>
    </div>
    <div id="schedule-alert"></div>
  </div>

  <div class="card" id="schedule-output" style="display:none;">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
      <h2 style="margin:0; border:none; padding:0;">Schedule</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-success btn-sm" id="btn-export-csv">Export CSV</button>
        <button class="btn btn-outline btn-sm" id="btn-print">Print</button>
        <button class="btn btn-outline btn-sm" id="btn-send-emails" style="background:var(--blue-mist);border-color:var(--sky-steel);color:var(--mid-steel);">&#9993; Email Assignments</button>
        <button class="btn btn-outline btn-sm" id="btn-sync-confirmations" style="background:var(--pale-sage);border-color:var(--sage);color:var(--on-pale-sage);">&#8635; Sync Confirmations</button>
        <button class="btn btn-outline btn-sm" id="btn-notify-volunteers" style="background:var(--pale-gold);border-color:var(--amber);color:var(--on-pale-gold);">&#128276; Request Volunteers</button>
        <span id="email-send-status" style="font-size:0.82rem;color:var(--warm-gray);"></span>
        <button class="btn btn-outline btn-sm saved" id="btn-save-schedule">Saved &#10003;</button>
        <button class="btn btn-outline btn-sm" id="btn-expand-all">&#9660; Expand All</button>
        <button class="btn btn-danger btn-sm" id="btn-clear-schedule">Clear Schedule</button>
      </div>
    </div>
    <div class="legend">
      <div class="legend-item"><div class="legend-dot" style="background:var(--mid-steel);"></div> Per-service (8am / 10:45am)</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--sage);"></div> Shared (both services)</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--error-bg);border:1px solid var(--error-border);"></div> Unfilled</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--pale-sage);border:1px solid var(--soft-sage);"></div> Filled</div>
    </div>
    <div class="table-wrapper">
      <table id="schedule-table">
        <thead id="schedule-thead"></thead>
        <tbody id="schedule-tbody"></tbody>
      </table>
    </div>
  </div>
</div>

<div id="tab-settings" class="tab-content"></div>

<div id="tab-breeze" class="tab-content"></div>


<!-- ══ PANEL OVERLAY ═══════════════════════════════════════════════════════ -->
<div id="panel-overlay" class="panel-overlay"></div>

<!-- ══ PERSON ADD/EDIT PANEL ═══════════════════════════════════════════════ -->
<div id="person-panel" class="side-panel">
  <div class="panel-hdr">
    <h2 id="person-panel-title">Add Person</h2>
    <button class="panel-close" id="btn-close-person-panel">&times;</button>
  </div>
  <div class="panel-body">
    <div id="breeze-import-section" style="background:var(--blue-mist);border:1px solid var(--ice-blue);border-radius:8px;padding:12px 14px;margin-bottom:16px;">
      <label style="font-weight:600;margin-bottom:6px;display:block;">&#128269; Search Breeze to Import</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <input type="text" id="breeze-import-query" placeholder="Type a name…" style="max-width:220px;">
        <button class="btn btn-outline btn-sm" id="btn-breeze-import-search">Search</button>
      </div>
      <div id="breeze-import-results" style="margin-top:8px;font-size:0.82rem;"></div>
    </div>

    <input type="hidden" id="edit-id">
    <input type="hidden" id="breeze-import-id">
    <label for="person-name">Name</label>
    <input type="text" id="person-name" placeholder="Full name">

    <label for="person-email" style="margin-top:12px;">Email Address <span style="font-weight:normal;color:var(--warm-gray);">(for reminder emails)</span></label>
    <input type="email" id="person-email" placeholder="volunteer@example.com" style="max-width:320px;">

    <div class="form-row">
      <div>
        <label>Preferred Sundays of Month</label>
        <div class="checkbox-group" id="pref-sundays">
          <label><input type="checkbox" value="1"> 1st</label>
          <label><input type="checkbox" value="2"> 2nd</label>
          <label><input type="checkbox" value="3"> 3rd</label>
          <label><input type="checkbox" value="4"> 4th</label>
          <label><input type="checkbox" value="5"> 5th</label>
        </div>
        <small style="color:var(--warm-gray);font-size:0.78rem;display:block;margin-top:4px;">Leave all unchecked = any Sunday</small>
      </div>
      <div>
        <label>Service Preference</label>
        <div class="radio-group" id="pref-service">
          <label><input type="radio" name="svc" value="both" checked> Both Services</label>
          <label><input type="radio" name="svc" value="8am"> 8:00 AM only</label>
          <label><input type="radio" name="svc" value="10:45am"> 10:45 AM only</label>
        </div>
      </div>
    </div>

    <label style="margin-top:14px;">Roles This Person Can Fill</label>
    <div class="checkbox-group" id="pref-roles">
      <label><input type="checkbox" value="Elder"> Elder</label>
      <label><input type="checkbox" value="Acolyte"> Acolyte</label>
      <label><input type="checkbox" value="PowerPoint"> PowerPoint</label>
      <label><input type="checkbox" value="Lector"> Lector</label>
      <label><input type="checkbox" value="Liturgist"> Liturgist</label>
      <label><input type="checkbox" value="Preacher"> Preacher</label>
      <label><input type="checkbox" value="Childrens Message"> Children's Message</label>
    </div>

    <span class="role-override-toggle" id="toggle-role-overrides">&#9658; Customize Sundays per role (optional)</span>
    <div id="role-override-section">
      <small style="color:#666;display:block;margin-bottom:8px;">Set role-specific Sundays for people who serve different roles on different weeks. Leave a role's row empty to use the global Preferred Sundays setting above.</small>
      <table class="role-override-table">
        <thead><tr>
          <th>Role</th><th>1st</th><th>2nd</th><th>3rd</th><th>4th</th><th>5th</th>
        </tr></thead>
        <tbody id="role-override-body"></tbody>
      </table>
    </div>

    <div style="margin-top:14px;padding:10px 14px;background:var(--pale-sage);border:1px solid var(--soft-sage);border-radius:8px;">
      <label style="font-weight:600;display:block;margin-bottom:6px;">Primary / Always-First For <span style="font-weight:normal;color:#666;">(optional)</span></label>
      <div class="checkbox-group" id="primary-roles">
        <label><input type="checkbox" value="Elder"> Elder</label>
        <label><input type="checkbox" value="Acolyte"> Acolyte</label>
        <label><input type="checkbox" value="PowerPoint"> PowerPoint</label>
        <label><input type="checkbox" value="Lector"> Lector</label>
        <label><input type="checkbox" value="Liturgist"> Liturgist</label>
        <label><input type="checkbox" value="Preacher"> Preacher</label>
        <label><input type="checkbox" value="Childrens Message"> Children's Message</label>
      </div>
      <small style="color:#666;font-size:0.78rem;display:block;margin-top:6px;">This person is always assigned these roles first, bypassing Sunday rotation. If they have a blackout date, the slot is left empty for manual assignment. Set Preferred Sundays to "Any Sunday" for primary roles.</small>
    </div>

    <label style="margin-top:16px;">Unavailable / Blackout Sundays</label>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px;">
      <input type="date" id="blackout-date-input" style="max-width:200px;">
      <button class="btn btn-outline btn-sm" id="btn-add-blackout">+ Add Sunday</button>
    </div>
    <div id="blackout-date-error" style="font-size:0.8rem;color:#c0392b;margin-top:4px;display:none;">Please pick a Sunday.</div>
    <div id="blackout-chips"></div>

    <div style="margin-top:16px;padding:10px 14px;background:var(--pale-gold);border:1px solid var(--honey);border-radius:8px;">
      <label style="font-weight:600;display:block;margin-bottom:6px;">&#9992; Extended Absence <span style="font-weight:normal;color:var(--warm-gray);">(optional)</span></label>
      <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-top:6px;">
        <div>
          <label style="font-size:.8rem;color:var(--warm-gray);margin-bottom:3px;display:block;">Away from</label>
          <input type="date" id="absence-start" style="max-width:160px;">
        </div>
        <div>
          <label style="font-size:.8rem;color:var(--warm-gray);margin-bottom:3px;display:block;">Return date</label>
          <input type="date" id="absence-until" style="max-width:160px;">
        </div>
        <button type="button" class="btn btn-outline btn-sm" id="btn-clear-absence">Clear</button>
      </div>
      <small style="color:var(--warm-gray);font-size:0.78rem;display:block;margin-top:6px;">Person will be skipped during scheduling for this date range and shown as "Away" in the people list.</small>
    </div>

    <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;border-top:1px solid var(--border);padding-top:16px;">
      <button class="btn btn-primary" id="btn-save-person">Save Person</button>
      <button class="btn btn-outline" id="btn-clear-form">Clear</button>
      <button type="button" class="btn btn-danger btn-sm" id="btn-delete-person-form" style="display:none;margin-left:auto;">&#128465; Delete</button>
    </div>
  </div>
</div>

<!-- ══ SETTINGS PANEL ══════════════════════════════════════════════════════ -->
<div id="settings-panel" class="side-panel">
  <div class="panel-hdr">
    <h2>Settings</h2>
    <button class="panel-close" id="btn-close-settings-panel">&times;</button>
  </div>
  <div class="panel-body">
    <details id="integrations-details" style="border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:20px;">
      <summary style="cursor:pointer;font-weight:700;color:var(--steel-anchor);font-size:.95rem;font-family:var(--font-head);display:flex;align-items:center;gap:8px;list-style:none;-webkit-appearance:none;">
        &#9881; Integrations
        <span style="font-weight:400;font-size:.82rem;color:var(--warm-gray);">(Breeze CHMS, Reminder Emails)</span>
      </summary>

      <!-- Hidden inputs — populated from server config; read by save handler -->
      <input type="hidden" id="breeze-subdomain">
      <input type="hidden" id="breeze-apikey">
      <input type="hidden" id="breeze-worker-url">
      <input type="hidden" id="breeze-worker-secret">
      <input type="hidden" id="email-resend-key">
      <input type="hidden" id="email-from">

      <div style="margin-top:16px;">
        <!-- Server-managed read-only display -->
        <div style="background:var(--linen,#faf5ed);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:20px;">
          <div style="font-size:0.78rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--warm-gray);margin-bottom:10px;">
            Server-managed — auto-applied from Cloudflare Worker
          </div>
          <div style="display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;font-size:0.85rem;align-items:center;">
            <span style="color:var(--warm-gray);">Breeze subdomain</span>
            <span id="sdisp-subdomain" style="font-family:monospace;color:var(--steel-anchor);"></span>
            <span style="color:var(--warm-gray);">Breeze API key</span>
            <span style="color:#2e7d32;font-weight:600;">&#128274; configured on server</span>
            <span style="color:var(--warm-gray);">Worker URL</span>
            <span id="sdisp-workerurl" style="font-family:monospace;font-size:0.82rem;color:var(--steel-anchor);"></span>
            <span style="color:var(--warm-gray);">Worker secret</span>
            <span style="color:#2e7d32;font-weight:600;">&#128274; configured on server</span>
            <span style="color:var(--warm-gray);">Resend API key</span>
            <span style="color:#2e7d32;font-weight:600;">&#128274; configured on server</span>
            <span style="color:var(--warm-gray);">From address</span>
            <span id="sdisp-emailfrom" style="font-family:monospace;color:var(--steel-anchor);"></span>
          </div>
        </div>

        <!-- User-configurable fields -->
        <h3 style="margin:0 0 12px;font-size:.95rem;color:var(--steel-anchor);font-family:var(--font-head);">Your Settings</h3>

        <label for="breeze-tag-ids">Breeze Tag IDs <span style="font-weight:normal;color:var(--warm-gray);">(optional)</span></label>
        <input type="text" id="breeze-tag-ids" placeholder="e.g. 4884325, 5123456" style="max-width:280px;">
        <small style="color:var(--warm-gray);font-size:0.78rem;display:block;margin-top:4px;">
          Comma-separated tag IDs to include in people search. Leave blank to search all.
          Find tag IDs in the Breeze URL: <code>people/filter#/tag_contains=y_XXXXXXX</code>
        </small>

        <label for="email-reply-to" style="margin-top:16px;">Reply-To Address</label>
        <input type="email" id="email-reply-to" placeholder="dinger@timothystl.org" style="max-width:320px;">
        <small style="color:var(--warm-gray);font-size:0.78rem;display:block;margin-top:4px;">Where volunteer email replies are sent.</small>

        <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;border-top:1px solid var(--border);padding-top:16px;">
          <button class="btn btn-primary" id="btn-save-settings">Save Settings</button>
          <button class="btn btn-outline" id="btn-test-breeze">Test Connection</button>
          <span id="settings-status" style="font-size:0.88rem;"></span>
        </div>
        <div id="settings-alert" style="margin-top:12px;"></div>
      </div>
    </details>

    <hr style="margin:0 0 20px;border:none;border-top:1px solid var(--border);">

    <div>
      <label style="font-weight:600;">Cloud Sync</label>
      <p id="fb-user-display" style="font-size:.85rem;color:var(--sage);margin:4px 0 10px;"></p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-outline btn-sm" id="btn-fb-push">&#8679; Push Local → Cloud</button>
        <button class="btn btn-outline btn-sm" id="btn-fb-pull">&#8681; Pull Cloud → Local</button>
        <button class="btn btn-outline btn-sm" id="btn-fb-signout">Sign Out</button>
      </div>
      <div id="sync-status" style="font-size:.8rem;margin-top:8px;color:#666;min-height:18px;"></div>
    </div>

    <hr style="margin:24px 0 20px;border:none;border-top:1px solid var(--border);">

    <div>
      <label style="font-weight:600;">Data Export / Import</label>
      <p style="font-size:0.82rem;color:var(--warm-gray);margin:4px 0 12px;">
        To migrate from another browser: <strong>Export</strong> on the old browser, then <strong>Import</strong> here, then Push to Cloud.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button class="btn btn-outline btn-sm" id="btn-export-data">&#8681; Export All Data</button>
        <label class="btn btn-outline btn-sm" style="cursor:pointer;margin:0;">
          &#8679; Import from File
          <input type="file" id="import-data-file" accept=".json" style="display:none;">
        </label>
      </div>
    </div>
  </div>
</div>

<!-- ══ STATS TAB ════════════════════════════════════════════════════════════ -->
<div id="tab-stats" class="tab-content">
  <div class="card">
    <h2>&#128202; Volunteer Statistics</h2>
    <div class="stats-filter">
      <label>Date range:</label>
      <input type="date" id="stats-from">
      <span style="color:var(--warm-gray);font-size:.82rem;">to</span>
      <input type="date" id="stats-to">
      <button class="btn btn-outline btn-sm" onclick="renderStatsTab()">Apply</button>
      <button class="btn btn-outline btn-sm" onclick="document.getElementById('stats-from').value='';document.getElementById('stats-to').value='';renderStatsTab();">All time</button>
    </div>
    <div id="stats-content">
      <p style="color:var(--warm-gray);font-size:0.85rem;">Generate or load a schedule to see statistics.</p>
    </div>
  </div>
</div>

<!-- ══ SPECIAL SERVICE PANEL ══════════════════════════════════════════════ -->
<div id="special-panel" class="side-panel">
  <div class="panel-hdr">
    <h2 id="special-panel-title">Add Special Service</h2>
    <button class="panel-close" id="btn-close-special-panel">&times;</button>
  </div>
  <div class="panel-body">
    <div class="field">
      <label>Date</label>
      <input type="date" id="special-date" style="width:100%;max-width:200px;">
    </div>
    <div class="field" style="margin-top:10px;">
      <label>Service Name</label>
      <input type="text" id="special-name" placeholder="e.g., Christmas Eve, Ash Wednesday" style="width:100%;">
    </div>
    <div style="margin-top:16px;">
      <label style="font-weight:600;">Service Times</label>
      <div id="special-services-list" style="margin-top:8px;"></div>
      <button class="btn btn-outline btn-sm" id="btn-add-svc-time" style="margin-top:8px;">+ Add Service Time</button>
    </div>
    <button class="btn btn-primary" id="btn-save-special" style="margin-top:20px;width:100%;">Add to Schedule</button>
    <div id="special-alert" style="margin-top:8px;"></div>
  </div>
</div>

<!-- ══ SIGN-UP REVIEW PANEL ════════════════════════════════════════════════ -->
<div id="signups-panel" class="side-panel">
  <div class="panel-hdr">
    <h2>Pending Sign-Ups</h2>
    <button class="panel-close" id="btn-close-signups-panel">&times;</button>
  </div>
  <div class="panel-body">
    <p style="font-size:.85rem;color:var(--warm-gray);margin-bottom:16px;">
      Review volunteer interest submitted via the sign-up page. Click <strong>Add as Volunteer</strong> to import them into the People list, or <strong>Dismiss</strong> to remove the entry.
    </p>
    <div id="signup-review-alert"></div>
    <div id="signups-list"></div>
  </div>
</div>

<div id="general-panel" class="side-panel">
  <div class="panel-hdr">
    <h2>General Volunteers</h2>
    <button class="panel-close" id="btn-close-general-panel">&times;</button>
  </div>
  <div class="panel-body">
    <p style="font-size:.85rem;color:var(--warm-gray);margin-bottom:16px;">
      Volunteer interest from other ministries and worship roles not in the scheduler (Choir, Altar Guild, etc.). <strong>Dismiss</strong> after following up.
    </p>
    <div id="general-review-alert"></div>
    <div id="general-list"></div>
  </div>
</div>

<div id="events-panel" class="side-panel">
  <div class="panel-hdr">
    <h2>Event Volunteers</h2>
    <button class="panel-close" id="btn-close-events-panel">&times;</button>
  </div>
  <div class="panel-body">
    <p style="font-size:.85rem;color:var(--warm-gray);margin-bottom:16px;">
      Volunteer interest for community events (Easter Egg Hunt, VBS, Christmas Market, etc.). <strong>Dismiss</strong> after forwarding to the event coordinator.
    </p>
    <div id="events-review-alert"></div>
    <div id="events-list"></div>
  </div>
</div>

<!-- ══ NOTIFY VOLUNTEERS PANEL ═════════════════════════════════════════════ -->
<div id="notify-panel" class="side-panel">
  <div class="panel-hdr">
    <h2>&#128276; Request Volunteers</h2>
    <button class="panel-close" id="btn-close-notify-panel">&times;</button>
  </div>
  <div class="panel-body">
    <p style="font-size:.85rem;color:var(--warm-gray);margin-bottom:4px;">
      Ask eligible volunteers to fill an open slot. Only people qualified for that role on that Sunday are emailed — no mass blasts.
    </p>
    <p style="font-size:.82rem;color:var(--warm-gray);margin-bottom:16px;">
      Requires a Resend API key configured in Settings.
    </p>
    <div id="notify-alert" style="margin-bottom:12px;"></div>
    <div id="notify-week-filter-wrap" style="display:none;margin-bottom:12px;font-size:.86rem;">
      <label for="notify-week-filter" style="display:inline-block;margin-right:8px;font-weight:600;color:var(--steel-anchor);">Week:</label>
      <select id="notify-week-filter" style="padding:5px 10px;border:1px solid var(--border);border-radius:6px;background:white;font-family:var(--font-body);font-size:.86rem;color:var(--steel-anchor);"></select>
    </div>
    <div id="notify-sent-banner" style="display:none;"></div>
    <div id="notify-slots-list"></div>
    <div id="notify-actions" style="display:none;margin-top:16px;padding-top:14px;border-top:1px solid var(--border);">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
        <button class="btn btn-outline btn-sm" id="btn-notify-select-all">Select All</button>
        <button class="btn btn-outline btn-sm" id="btn-notify-deselect-all">Deselect All</button>
      </div>
      <button class="btn btn-primary" id="btn-notify-send">Send Requests</button>
      <div id="notify-send-status" style="font-size:0.85rem;color:var(--warm-gray);margin-top:10px;min-height:18px;"></div>
    </div>
  </div>
</div>

<!-- ══ REMINDER EMAILS PANEL ════════════════════════════════════════════════ -->
<div id="reminder-panel" class="side-panel">
  <div class="panel-hdr">
    <h2>&#9993; Email Assignments</h2>
    <button class="panel-close" id="btn-close-reminder-panel">&times;</button>
  </div>
  <div class="panel-body">
    <p style="font-size:.85rem;color:var(--warm-gray);margin-bottom:16px;">
      Email each assigned volunteer their role(s) for the selected Sunday. Includes an iCal attachment and RSVP links.
    </p>
    <div id="reminder-week-filter-wrap" style="display:none;margin-bottom:12px;font-size:.86rem;">
      <label for="reminder-week-filter" style="display:inline-block;margin-right:8px;font-weight:600;color:var(--steel-anchor);">Week:</label>
      <select id="reminder-week-filter" style="padding:5px 10px;border:1px solid var(--border);border-radius:6px;background:white;font-family:var(--font-body);font-size:.86rem;color:var(--steel-anchor);"></select>
    </div>
    <div id="reminder-sent-banner" style="display:none;"></div>
    <div id="reminder-person-list"></div>
    <div id="reminder-actions" style="display:none;margin-top:16px;padding-top:14px;border-top:1px solid var(--border);">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
        <button class="btn btn-outline btn-sm" id="btn-reminder-select-all">Select All</button>
        <button class="btn btn-outline btn-sm" id="btn-reminder-deselect-all">Deselect All</button>
      </div>
      <button class="btn btn-primary" id="btn-reminder-send">Email Selected</button>
      <div id="reminder-send-status" style="font-size:0.85rem;color:var(--warm-gray);margin-top:10px;min-height:18px;"></div>
    </div>
  </div>
</div>

<!-- ══ READINGS PANEL ════════════════════════════════════════════════════════ -->
<div id="readings-panel" class="side-panel">
  <div class="panel-hdr">
    <h2 id="readings-panel-title">Edit Readings</h2>
    <button class="panel-close" id="btn-close-readings-panel">&times;</button>
  </div>
  <div class="panel-body">
    <p id="readings-panel-subtitle" style="font-size:.85rem;color:var(--warm-gray);margin:0 0 16px;"></p>
    <div class="field">
      <label>Old Testament</label>
      <input type="text" id="readings-ot" placeholder="e.g. Isaiah 40:1-11" style="width:100%;">
    </div>
    <div class="field" style="margin-top:12px;">
      <label>Epistle</label>
      <input type="text" id="readings-epistle" placeholder="e.g. Romans 8:14-17" style="width:100%;">
    </div>
    <div class="field" style="margin-top:12px;">
      <label>Gospel</label>
      <input type="text" id="readings-gospel" placeholder="e.g. John 3:1-17" style="width:100%;">
    </div>
    <div class="field" style="margin-top:12px;">
      <label>Psalm</label>
      <input type="text" id="readings-psalm" placeholder="e.g. Psalm 29" style="width:100%;">
    </div>
    <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap;">
      <button class="btn btn-primary" id="btn-save-readings">Save Readings</button>
      <button class="btn btn-outline" id="btn-reset-readings">Reset to Lectionary</button>
    </div>
    <div id="readings-alert" style="margin-top:8px;"></div>
  </div>
</div>

</div><!-- /#app-content -->


<script>
// ── Embedded mode detection ──
// Primary: server injects <body class="embedded"> when serving /scheduler?embedded=1
// Fallbacks: iframe context detection + URL query param.
var _embedded = false;
try { _embedded = document.body.classList.contains('embedded'); } catch (e) {}
if (!_embedded) {
  try { _embedded = (window.self !== window.top); } catch (e) { _embedded = true; }
}
if (!_embedded) {
  try { _embedded = new URLSearchParams(location.search).has('embedded'); } catch (e) {}
}
if (_embedded) document.body.classList.add('embedded');

// ══════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════
function makeId() {
  return 'id_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now();
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function ordSuffix(n) {
  if (n === 1) return 'st'; if (n === 2) return 'nd'; if (n === 3) return 'rd'; return 'th';
}
function fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function showAlert(elId, msg, type) {
  var el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = msg ? '<div class="alert alert-' + type + '">' + msg + '</div>' : '';
}

// ══════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════
var PER_ROLES    = ['Elder', 'Acolyte', 'PowerPoint', 'Lector', 'Liturgist'];
var SHARED_ROLES = ['Preacher', 'Childrens Message'];
var SHARED_LABELS = { 'Childrens Message': "Children's Message" };
var COMMUNITY_EVENTS = [
  { id: 'egg-hunt', name: 'Easter Egg Hunt', date: 'Apr 4',
    roles: ['Easter Egg Hunt \\u2013 Egg Filling', 'Easter Egg Hunt \\u2013 Setup & Cleanup',
            'Easter Egg Hunt \\u2013 Registration', 'Easter Egg Hunt \\u2013 Activity Stations'] },
  { id: 'vbs', name: 'VBS', date: 'Jun TBD',
    roles: ['VBS \\u2013 Group Leader', 'VBS \\u2013 Station Helper',
            'VBS \\u2013 Crafts Coordinator', 'VBS \\u2013 Snacks'] },
  { id: 'christmas-market', name: 'Christmas Market', date: 'Dec 5',
    roles: ['Christmas Market \\u2013 Setup & Teardown', 'Christmas Market \\u2013 Baked Goods & Food',
            'Christmas Market \\u2013 Kids\\u2019 Activities', 'Christmas Market \\u2013 Welcome Table'] }
];
function roleLabel(r) { return SHARED_LABELS[r] || r; }
var ROLE_ABBREVS = { 'Elder':'ELD', 'Acolyte':'ACO', 'PowerPoint':'PPT', 'Lector':'LCT', 'Liturgist':'LTG', 'Preacher':'PRCHR', 'Childrens Message':'CM' };
function roleAbbrev(r) { return ROLE_ABBREVS[r] || roleLabel(r); }
var ALL_TABS = ['people','schedule','stats'];

// ══════════════════════════════════════════════════════════════════
// STORAGE
// ══════════════════════════════════════════════════════════════════
function getPeople()  { try { return JSON.parse(localStorage.getItem('ws_people')  || '[]'); } catch(e) { return []; } }
function savePeople(a){ localStorage.setItem('ws_people', JSON.stringify(a)); }

function getBreezeSettings() { try { return JSON.parse(localStorage.getItem('ws_breeze_settings') || '{}'); } catch(e) { return {}; } }
function saveBreezeSettings(o){ localStorage.setItem('ws_breeze_settings', JSON.stringify(o)); }
function getScheduleOverrides() { try { return JSON.parse(localStorage.getItem('ws_schedule_overrides')||'{}'); } catch(e){ return {}; } }
function saveScheduleOverrides(o){ localStorage.setItem('ws_schedule_overrides', JSON.stringify(o)); }

function getEventMap() { try { return JSON.parse(localStorage.getItem('ws_breeze_event_map') || '{}'); } catch(e) { return {}; } }
function getHistory()        { try { return JSON.parse(localStorage.getItem('ws_history')      || '[]'); } catch(e) { return []; } }
function saveHistory(h)      { localStorage.setItem('ws_history', JSON.stringify(h)); }
function getLastServed()     { try { return JSON.parse(localStorage.getItem('ws_last_served')  || '{}'); } catch(e) { return {}; } }
function saveLastServed(o)   { localStorage.setItem('ws_last_served', JSON.stringify(o)); }
function getSundayLabels()   { try { return JSON.parse(localStorage.getItem('ws_sun_labels')   || '{}'); } catch(e) { return {}; } }
function saveSundayLabels(o) { localStorage.setItem('ws_sun_labels', JSON.stringify(o)); }
function getConfirmations()  { try { return JSON.parse(localStorage.getItem('ws_confirmations')|| '{}'); } catch(e) { return {}; } }
function saveConfirmations(o){ localStorage.setItem('ws_confirmations', JSON.stringify(o)); }
function getRsvpTokens()     { try { return JSON.parse(localStorage.getItem('ws_rsvp_tokens')  || '{}'); } catch(e) { return {}; } }
function saveRsvpTokens(o)   { localStorage.setItem('ws_rsvp_tokens',   JSON.stringify(o)); }
function getEmailSentLog()   { try { return JSON.parse(localStorage.getItem('ws_email_sent_log') || '{}'); } catch(e) { return {}; } }
function saveEmailSentLog(o) { localStorage.setItem('ws_email_sent_log', JSON.stringify(o)); }

function saveEventMap(o){ localStorage.setItem('ws_breeze_event_map', JSON.stringify(o)); }

// Schedule persistence
function saveSchedule() { saveCurrentMonth(); }
function loadSchedule() { return loadMonthSchedule(currentMonthKey); }

// ══════════════════════════════════════════════════════════════════
// ── LECTIONARY CALENDAR ────────────────────────────────────────────
// Populated by fetch('lcms_calendar.json') on load; keyed by ISO date
var lectCalendar = {};
function fmtSundayName(name) { return (name||'').replace(/\\s*\\(prop\\d+\\)/i,'').trim(); }
function getLectEntry(date) {
  if (!date || !Object.keys(lectCalendar).length) return null;
  return lectCalendar[date.toISOString().slice(0, 10)] || null;
}
function getReadingsOverrides() { try { return JSON.parse(localStorage.getItem('ws_readings') || '{}'); } catch(e) { return {}; } }
function saveReadingsOverrides(o) { localStorage.setItem('ws_readings', JSON.stringify(o)); }
function getReadingsForDate(dateISO) {
  var ov = getReadingsOverrides()[dateISO];
  if (ov) return ov;
  var e = lectCalendar[dateISO];
  return e ? { ot: e.ot||'', epistle: e.epistle||'', gospel: e.gospel||'', psalm: e.psalm||'' } : null;
}
// Strip LCMS parenthetical verse numbers (e.g. "Romans 13:( 8-10 ) 11-14" → "Romans 13:11-14")
function cleanReading(r) { return (r||'').replace(/\\s*\\(.*?\\)\\s*/g,' ').replace(/\\s+/g,' ').trim(); }
function bibleLink(ref) {
  var clean = cleanReading(ref);
  if (!clean) return '';
  return 'https://www.biblegateway.com/passage/?search=' + encodeURIComponent(clean) + '&version=ESV';
}
// ──────────────────────────────────────────────────────────────────

// SCHEDULE STATE
// ══════════════════════════════════════════════════════════════════
var currentSchedule = [];
var currentBlackouts = [];
var peopleSortBy  = 'name';
var peopleSortDir = 'asc';
var peopleSearchQuery = '';
var isDirty = false;
var _pendingSignups = [];
var _generalVolunteers = [];
var _eventVolunteers = [];

// currentMonthKey: 'YYYY-MM' of the month currently viewed/edited
var currentMonthKey = (function(){
  var d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
})();

function getMonthSchedules() {
  try { return JSON.parse(localStorage.getItem('ws_schedule_v2')||'{}'); } catch(e){ return {}; }
}
function saveMonthSchedules(data) { localStorage.setItem('ws_schedule_v2', JSON.stringify(data)); }

function getSundaysForMonth(key) {
  var parts = key.split('-'), year=parseInt(parts[0]), month=parseInt(parts[1])-1;
  var sundays=[], ordinal=1;
  var d = new Date(year, month, 1);
  while (d.getDay() !== 0) d.setDate(d.getDate()+1);
  while (d.getMonth() === month) {
    sundays.push({date: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0), ordinal: ordinal});
    ordinal++; d.setDate(d.getDate()+7);
  }
  return sundays;
}

function monthKeyLabel(key) {
  var parts = key.split('-');
  var d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, 1);
  return d.toLocaleDateString('en-US', {month:'long', year:'numeric'});
}

function migrateOldSchedule() {
  if (localStorage.getItem('ws_schedule_v2')) return;
  try {
    var raw = localStorage.getItem('ws_schedule');
    if (!raw) return;
    var data = JSON.parse(raw);
    if (!data.rows || !data.rows.length) return;
    var months = {};
    data.rows.forEach(function(row) {
      var iso = (row.dateISO||'').slice(0,10);
      var key = iso.slice(0,7);
      if (!months[key]) months[key] = {rows:[]};
      months[key].rows.push({type:'sunday', dateISO:iso, ordinal:row.ordinal, label:row.label||'', assignments:row.assignments});
    });
    saveMonthSchedules(months);
  } catch(e) {}
}

function loadMonthSchedule(key) {
  var months = getMonthSchedules();
  var data = months[key];
  if (!data || !data.rows || !data.rows.length) { currentSchedule = []; return false; }
  currentSchedule = data.rows.map(function(row) {
    if (row.type === 'special') {
      return {type:'special', date:new Date(row.dateISO+'T12:00:00'), name:row.name, services:row.services};
    }
    return {type:'sunday', date:new Date(row.dateISO+'T12:00:00'), ordinal:row.ordinal, label:row.label||'', assignments:row.assignments};
  });
  currentSchedule.sort(function(a,b){ return a.date-b.date; });
  return true;
}

function saveCurrentMonth() {
  if (!currentMonthKey) return;
  var months = getMonthSchedules();
  months[currentMonthKey] = {
    rows: currentSchedule.map(function(row) {
      if (row.type === 'special') {
        return {type:'special', dateISO:row.date.toISOString().slice(0,10), name:row.name, services:row.services};
      }
      return {type:'sunday', dateISO:row.date.toISOString().slice(0,10), ordinal:row.ordinal, label:row.label||'', assignments:row.assignments};
    })
  };
  saveMonthSchedules(months);
  updateLastServedFromRows(months[currentMonthKey].rows.filter(function(r){ return r.type !== 'special'; }));
  setDirty(false);
  queueD1Push();
}

function setDirty(dirty) {
  isDirty = !!dirty;
  var btn = document.getElementById('btn-save-schedule');
  if (!btn) return;
  if (isDirty) {
    btn.className = btn.className.replace(' saved','').replace(' dirty','') + ' dirty';
    btn.innerHTML = 'Save Changes &#9650;';
  } else {
    btn.className = btn.className.replace(' saved','').replace(' dirty','') + ' saved';
    btn.innerHTML = 'Saved &#10003;';
  }
}

function switchMonth(key) {
  if (isDirty) {
    if (!confirm('You have unsaved changes. Discard them and switch months?')) return;
    setDirty(false);
  }
  currentMonthKey = key;
  document.getElementById('current-month-label').textContent = monthKeyLabel(key);
  var found = loadMonthSchedule(key);
  if (found) {
    renderTable(getPeople(), null);
    document.getElementById('schedule-output').style.display = 'block';
  } else {
    currentSchedule = [];
    document.getElementById('schedule-output').style.display = 'none';
  }
  showAlert('schedule-alert','','');
}

// ══════════════════════════════════════════════════════════════════
// TABS
// ══════════════════════════════════════════════════════════════════
var currentTabName = 'schedule';
function showTab(name) {
  // Warn if leaving schedule tab with unsaved changes
  if (currentTabName === 'schedule' && name !== 'schedule' && isDirty) {
    if (!confirm('You have unsaved schedule changes. Discard them?')) return;
    setDirty(false);
  }
  currentTabName = name;
  ALL_TABS.forEach(function(t) {
    document.getElementById('tab-' + t).classList.toggle('active', t === name);
    document.getElementById('tab-btn-' + t).classList.toggle('active', t === name);
  });
  if (name === 'people') renderPeopleList();
  if (name === 'stats')  renderStatsTab();
  if (name === 'schedule' && !currentSchedule.length) {
    if (loadMonthSchedule(currentMonthKey)) {
      renderTable(getPeople(), null);
      document.getElementById('schedule-output').style.display = 'block';
    }
  }
}
ALL_TABS.forEach(function(t) {
  document.getElementById('tab-btn-' + t).addEventListener('click', function() { showTab(t); });
});

// ══════════════════════════════════════════════════════════════════
// SIDE PANELS
// ══════════════════════════════════════════════════════════════════
function openPanel(panelId) {
  document.getElementById('panel-overlay').classList.add('open');
  document.getElementById(panelId).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeAllPanels() {
  document.getElementById('panel-overlay').classList.remove('open');
  document.querySelectorAll('.side-panel').forEach(function(p){ p.classList.remove('open'); });
  document.body.style.overflow = '';
}

// ── Readings panel ────────────────────────────────────────────────────────────
var _readingsDateISO = '';

function openReadingsPanel(dateISO) {
  _readingsDateISO = dateISO;
  var d = new Date(dateISO + 'T12:00:00');
  var lectEntry = getLectEntry(d);
  var subtitle  = lectEntry ? fmtSundayName(lectEntry.sundayName) + ' \\u2014 Series ' + lectEntry.series : fmtDate(d);
  document.getElementById('readings-panel-title').textContent = 'Readings for ' + fmtDate(d);
  document.getElementById('readings-panel-subtitle').textContent = subtitle;
  var r = getReadingsForDate(dateISO) || {};
  document.getElementById('readings-ot').value      = r.ot      || '';
  document.getElementById('readings-epistle').value = r.epistle || '';
  document.getElementById('readings-gospel').value  = r.gospel  || '';
  document.getElementById('readings-psalm').value   = r.psalm   || '';
  showAlert('readings-alert', '', '');
  openPanel('readings-panel');
}

document.getElementById('btn-save-readings').addEventListener('click', function() {
  var overrides = getReadingsOverrides();
  overrides[_readingsDateISO] = {
    ot:      document.getElementById('readings-ot').value.trim(),
    epistle: document.getElementById('readings-epistle').value.trim(),
    gospel:  document.getElementById('readings-gospel').value.trim(),
    psalm:   document.getElementById('readings-psalm').value.trim(),
  };
  saveReadingsOverrides(overrides);
  showAlert('readings-alert', 'Readings saved.', 'success');
  setTimeout(closeAllPanels, 800);
});

document.getElementById('btn-reset-readings').addEventListener('click', function() {
  var e = lectCalendar[_readingsDateISO];
  if (!e) { showAlert('readings-alert', 'No lectionary entry found for this date.', 'warning'); return; }
  document.getElementById('readings-ot').value      = e.ot      || '';
  document.getElementById('readings-epistle').value = e.epistle || '';
  document.getElementById('readings-gospel').value  = e.gospel  || '';
  document.getElementById('readings-psalm').value   = e.psalm   || '';
  showAlert('readings-alert', 'Reset to lectionary. Click Save to keep.', 'info');
});

document.getElementById('btn-close-readings-panel').addEventListener('click', closeAllPanels);

function openPersonPanel(title) {
  document.getElementById('person-panel-title').textContent = title || 'Add Person';
  openPanel('person-panel');
  setTimeout(function(){ var el=document.getElementById('person-name'); if(el) el.focus(); }, 280);
}
document.getElementById('panel-overlay').addEventListener('click', closeAllPanels);
document.getElementById('btn-close-person-panel').addEventListener('click', closeAllPanels);
document.getElementById('btn-close-settings-panel').addEventListener('click', closeAllPanels);
document.getElementById('btn-open-person-panel').addEventListener('click', function() {
  clearForm();
  openPersonPanel('Add Person');
});
document.getElementById('btn-open-settings').addEventListener('click', function() {
  loadSettingsForm();
  openPanel('settings-panel');
});

// ══════════════════════════════════════════════════════════════════
// CHECKBOX LABEL HIGHLIGHTING
// ══════════════════════════════════════════════════════════════════
function syncLabels(groupId) {
  var g = document.getElementById(groupId);
  if (!g) return;
  g.querySelectorAll('label').forEach(function(lbl) {
    var cb = lbl.querySelector('input[type="checkbox"]');
    if (cb) lbl.classList.toggle('checked', cb.checked);
  });
}
document.getElementById('pref-sundays').addEventListener('change',  function() { syncLabels('pref-sundays'); });
document.getElementById('pref-roles').addEventListener('change',    function() { syncLabels('pref-roles'); });
document.getElementById('primary-roles').addEventListener('change', function() { syncLabels('primary-roles'); });

// ── Role override table ────────────────────────────────────────────
function buildRoleOverrideTable(roles, existingOverrides) {
  var tbody = document.getElementById('role-override-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  roles.forEach(function(role) {
    var overrides = existingOverrides[role] || [];
    var cells = [1,2,3,4,5].map(function(n){
      return '<td style="text-align:center;padding:2px 4px;">'
        +'<input type="checkbox" value="'+n+'"'+(overrides.indexOf(n)>-1?' checked':'')
        +' title="'+n+ordSuffix(n)+' Sunday"></td>';
    }).join('');
    var tr = document.createElement('tr');
    tr.setAttribute('data-role', role);
    tr.innerHTML = '<td style="padding:3px 6px;font-size:.78rem;">'+esc(roleLabel(role))+'</td>'+cells;
    tbody.appendChild(tr);
  });
}

document.getElementById('toggle-role-overrides').addEventListener('click', function() {
  var sec = document.getElementById('role-override-section');
  var isOpen = sec.style.display !== 'none';
  sec.style.display = isOpen ? 'none' : 'block';
  this.innerHTML = (isOpen ? '&#9658;' : '&#9660;') + ' Customize Sundays per role (optional)';
  if (!isOpen) {
    var roles = [];
    document.getElementById('pref-roles').querySelectorAll('input:checked').forEach(function(cb){ roles.push(cb.value); });
    var existingOverrides = {};
    document.getElementById('role-override-body').querySelectorAll('tr[data-role]').forEach(function(tr){
      var roleKey = tr.getAttribute('data-role');
      var checked = [];
      tr.querySelectorAll('input:checked').forEach(function(cb){ checked.push(parseInt(cb.value,10)); });
      if (checked.length) existingOverrides[roleKey] = checked;
    });
    buildRoleOverrideTable(roles, existingOverrides);
  }
});

// When roles change, rebuild override table if section is visible
document.getElementById('pref-roles').addEventListener('change', function() {
  var sec = document.getElementById('role-override-section');
  if (sec.style.display === 'none') return;
  var roles = [];
  this.querySelectorAll('input:checked').forEach(function(cb){ roles.push(cb.value); });
  var existingOverrides = {};
  document.getElementById('role-override-body').querySelectorAll('tr[data-role]').forEach(function(tr){
    var roleKey = tr.getAttribute('data-role');
    var checked = [];
    tr.querySelectorAll('input:checked').forEach(function(cb){ checked.push(parseInt(cb.value,10)); });
    if (checked.length) existingOverrides[roleKey] = checked;
  });
  buildRoleOverrideTable(roles, existingOverrides);
});

// ══════════════════════════════════════════════════════════════════
// BLACKOUT DATES
// ══════════════════════════════════════════════════════════════════
function renderBlackoutChips() {
  var container = document.getElementById('blackout-chips');
  if (!container) return;
  if (!currentBlackouts.length) {
    container.innerHTML = '<span style="color:#7A6E60;font-size:0.8rem;">None added</span>';
    return;
  }
  container.innerHTML = currentBlackouts.map(function(d, i) {
    return '<span class="blackout-chip">' + esc(d)
      + '<button type="button" data-idx="' + i + '" aria-label="Remove">&times;</button>'
      + '</span>';
  }).join('');
}

document.getElementById('blackout-chips').addEventListener('click', function(e) {
  var btn = e.target.closest('button[data-idx]');
  if (!btn) return;
  currentBlackouts.splice(parseInt(btn.getAttribute('data-idx'), 10), 1);
  renderBlackoutChips();
});

document.getElementById('btn-add-blackout').addEventListener('click', function() {
  var val = document.getElementById('blackout-date-input').value;
  var errEl = document.getElementById('blackout-date-error');
  errEl.style.display = 'none';
  if (!val) return;
  // Validate it's a Sunday (day 0). Parse as local date by splitting.
  var parts = val.split('-');
  var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  if (d.getDay() !== 0) { errEl.style.display = 'block'; return; }
  if (currentBlackouts.indexOf(val) === -1) { currentBlackouts.push(val); currentBlackouts.sort(); }
  document.getElementById('blackout-date-input').value = '';
  renderBlackoutChips();
});

// ══════════════════════════════════════════════════════════════════
// PERSON FORM
// ══════════════════════════════════════════════════════════════════
function clearForm() {
  document.getElementById('edit-id').value = '';
  document.getElementById('breeze-import-id').value = '';
  document.getElementById('person-name').value = '';
  document.getElementById('person-email').value = '';
  document.getElementById('pref-sundays').querySelectorAll('input').forEach(function(cb){ cb.checked = false; });
  document.getElementById('pref-service').querySelector('input[value="both"]').checked = true;
  document.getElementById('pref-roles').querySelectorAll('input').forEach(function(cb){ cb.checked = false; });
  document.getElementById('primary-roles').querySelectorAll('input').forEach(function(cb){ cb.checked = false; });
  syncLabels('pref-sundays');
  syncLabels('pref-roles');
  syncLabels('primary-roles');
  document.getElementById('breeze-import-query').value = '';
  document.getElementById('breeze-import-results').innerHTML = '';
  currentBlackouts = [];
  renderBlackoutChips();
  document.getElementById('absence-start').value = '';
  document.getElementById('absence-until').value = '';
  document.getElementById('btn-delete-person-form').style.display = 'none';
  document.getElementById('role-override-section').style.display = 'none';
  document.getElementById('toggle-role-overrides').innerHTML = '&#9658; Customize Sundays per role (optional)';
  document.getElementById('role-override-body').innerHTML = '';
}

function savePerson() {
  var name = document.getElementById('person-name').value.trim();
  if (!name) { alert('Please enter a name.'); return; }
  var email = document.getElementById('person-email').value.trim();

  var preferredSundays = [];
  document.getElementById('pref-sundays').querySelectorAll('input:checked').forEach(function(cb){
    preferredSundays.push(parseInt(cb.value, 10));
  });
  var svcEl = document.getElementById('pref-service').querySelector('input[name="svc"]:checked');
  var servicePreference = svcEl ? svcEl.value : 'both';
  var roles = [];
  document.getElementById('pref-roles').querySelectorAll('input:checked').forEach(function(cb){
    roles.push(cb.value);
  });
  if (roles.length === 0) { alert('Please select at least one role.'); return; }

  var primaryFor = [];
  document.getElementById('primary-roles').querySelectorAll('input:checked').forEach(function(cb){
    primaryFor.push(cb.value);
  });

  var roleSundayOverrides = {};
  document.getElementById('role-override-body').querySelectorAll('tr[data-role]').forEach(function(tr){
    var roleKey = tr.getAttribute('data-role');
    var checked = [];
    tr.querySelectorAll('input[type="checkbox"]:checked').forEach(function(cb){ checked.push(parseInt(cb.value,10)); });
    if (checked.length) roleSundayOverrides[roleKey] = checked;
  });

  var importedBreezeId = document.getElementById('breeze-import-id').value || null;
  var absenceStart = document.getElementById('absence-start').value || '';
  var absenceUntil = document.getElementById('absence-until').value || '';
  var people = getPeople();
  var editId = document.getElementById('edit-id').value;
  if (editId) {
    for (var i = 0; i < people.length; i++) {
      if (people[i].id === editId) {
        people[i] = { id: editId, name: name, email: email, preferredSundays: preferredSundays, servicePreference: servicePreference, roles: roles, primaryFor: primaryFor, roleSundayOverrides: roleSundayOverrides, breezePersonId: importedBreezeId || people[i].breezePersonId || null, blackoutDates: currentBlackouts.slice(), absenceStart: absenceStart, absenceUntil: absenceUntil };
        break;
      }
    }
  } else {
    people.push({ id: makeId(), name: name, email: email, preferredSundays: preferredSundays, servicePreference: servicePreference, roles: roles, primaryFor: primaryFor, roleSundayOverrides: roleSundayOverrides, breezePersonId: importedBreezeId, blackoutDates: currentBlackouts.slice(), absenceStart: absenceStart, absenceUntil: absenceUntil });
  }
  savePeople(people);
  clearForm();
  closeAllPanels();
  renderPeopleList();
  queueD1Push();
}

document.getElementById('btn-save-person').addEventListener('click', savePerson);
document.getElementById('btn-clear-form').addEventListener('click', clearForm);
document.getElementById('btn-clear-absence').addEventListener('click', function() {
  document.getElementById('absence-start').value = '';
  document.getElementById('absence-until').value = '';
});
document.getElementById('btn-delete-person-form').addEventListener('click', function() {
  var id = document.getElementById('edit-id').value;
  if (!id) return;
  if (!confirm('Remove this person from the scheduler? They will also be cleared from the current schedule.')) return;
  closeAllPanels();
  deletePerson(id);
});

// ══════════════════════════════════════════════════════════════════
// PEOPLE LIST
// ══════════════════════════════════════════════════════════════════
function setPeopleSort(field) {
  if (peopleSortBy === field) {
    peopleSortDir = (peopleSortDir === 'asc') ? 'desc' : 'asc';
  } else {
    peopleSortBy  = field;
    peopleSortDir = 'asc';
  }
  renderPeopleList();
}

function renderPeopleList() {
  var allPeople = getPeople().slice();
  var container = document.getElementById('people-list');

  // Filter
  var q = (peopleSearchQuery || '').trim().toLowerCase();
  var svcLabels = { '8am':'8am 8:00', 'both':'both', '10:45am':'10:45 10:45am' };
  var people = q ? allPeople.filter(function(p) {
    var haystack = [
      p.name,
      p.email || '',
      p.roles.map(roleLabel).join(' '),
      svcLabels[p.servicePreference] || p.servicePreference
    ].join(' ').toLowerCase();
    return q.split(/\\s+/).every(function(word) { return haystack.indexOf(word) !== -1; });
  }) : allPeople;

  // Sort
  var svcOrder = { '8am': 0, 'both': 1, '10:45am': 2 };
  var dir = (peopleSortDir === 'desc') ? -1 : 1;
  people.sort(function(a, b) {
    var cmp = 0;
    if (peopleSortBy === 'name') {
      cmp = a.name.localeCompare(b.name);
    } else if (peopleSortBy === 'role') {
      var ar = (a.roles[0] || '').toLowerCase();
      var br = (b.roles[0] || '').toLowerCase();
      cmp = ar.localeCompare(br) || a.name.localeCompare(b.name);
    } else { // service
      var as = svcOrder[a.servicePreference] !== undefined ? svcOrder[a.servicePreference] : 99;
      var bs = svcOrder[b.servicePreference] !== undefined ? svcOrder[b.servicePreference] : 99;
      cmp = (as - bs) || a.name.localeCompare(b.name);
    }
    return cmp * dir;
  });

  document.getElementById('people-count').textContent = allPeople.length;

  if (allPeople.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="icon">&#128101;</div><p>No people added yet. Use the form above to add volunteers.</p></div>';
    return;
  }
  if (people.length === 0) {
    container.innerHTML = '<div style="padding:16px;color:#7A6E60;font-size:.88rem;">No matches for &ldquo;'+esc(peopleSearchQuery)+'&rdquo;</div>';
    return;
  }

  function arrow(field) {
    var active = (peopleSortBy === field);
    var ch = active ? (peopleSortDir === 'asc' ? '&#9650;' : '&#9660;') : '&#9651;';
    return '<span class="sort-arrow'+(active?' on':'')+'">'+ch+'</span>';
  }
  var svcMap = { 'both':'Both','8am':'8:00 AM','10:45am':'10:45 AM' };
  var html = '<table class="people-table">'
    +'<thead><tr>'
    +'<th onclick="setPeopleSort(\\'name\\')">Name'+arrow('name')+'</th>'
    +'<th onclick="setPeopleSort(\\'role\\')">Roles'+arrow('role')+'</th>'
    +'<th onclick="setPeopleSort(\\'service\\')">Service'+arrow('service')+'</th>'
    +'<th></th>'
    +'</tr></thead><tbody>';

  var todayISO = new Date().toISOString().slice(0, 10);
  people.forEach(function(p) {
    var roleTags = p.roles.length
      ? p.roles.map(function(r){ return '<span class="tag tag-role">'+esc(roleLabel(r))+'</span>'; }).join(' ')
      : '<span style="color:#7A6E60;font-size:.78rem;">—</span>';
    var breeze   = p.breezePersonId ? ' <span title="Breeze linked" style="font-size:.7rem;color:#004085;">&#9729;</span>' : '';
    var primary  = (p.primaryFor && p.primaryFor.length) ? ' <span title="Primary: '+esc((p.primaryFor||[]).map(roleLabel).join(', '))+'" style="font-size:.72rem;color:#6B8F71;">&#9733;</span>' : '';
    var absenceBadge = '';
    if (p.absenceUntil) {
      var start = p.absenceStart || p.absenceUntil;
      if (todayISO <= p.absenceUntil) {
        var label = todayISO >= start ? 'Away until ' + p.absenceUntil : 'Away ' + start + '–' + p.absenceUntil;
        absenceBadge = ' <span style="font-size:.7rem;padding:1px 7px;border-radius:99px;background:var(--pale-gold);color:var(--on-pale-gold);border:1px solid var(--honey);white-space:nowrap;">&#9992; ' + esc(label) + '</span>';
      }
    }
    html += '<tr>'
      +'<td><div class="pt-name">'+esc(p.name)+primary+breeze+'</div>'
      +(absenceBadge ? '<div style="margin-top:2px;">'+absenceBadge+'</div>' : '')
      +(p.email ? '<div class="pt-email">'+esc(p.email)+'</div>' : '')
      +'</td>'
      +'<td><div class="pt-roles">'+roleTags+'</div></td>'
      +'<td><span class="pt-svc">'+esc(svcMap[p.servicePreference]||p.servicePreference)+'</span></td>'
      +'<td class="pt-actions">'
      +'<button class="btn btn-outline btn-sm" data-action="edit" data-id="'+p.id+'" style="margin-right:4px;">Edit</button>'
      +'<button class="btn btn-danger btn-sm" data-action="delete" data-id="'+p.id+'">Remove</button>'
      +'</td>'
      +'</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

document.getElementById('people-list').addEventListener('click', function(e) {
  var btn = e.target.closest('button[data-action]');
  if (!btn) return;
  var id = btn.getAttribute('data-id');
  if (btn.getAttribute('data-action') === 'edit')   editPerson(id);
  if (btn.getAttribute('data-action') === 'delete') deletePerson(id);
});

function editPerson(id) {
  var people = getPeople(), person = null;
  for (var i = 0; i < people.length; i++) { if (people[i].id === id) { person = people[i]; break; } }
  if (!person) return;
  document.getElementById('edit-id').value = person.id;
  document.getElementById('person-name').value = person.name;
  document.getElementById('person-email').value = person.email || '';
  document.getElementById('pref-sundays').querySelectorAll('input').forEach(function(cb){
    cb.checked = (person.preferredSundays || []).indexOf(parseInt(cb.value,10)) > -1;
  });
  var r = document.getElementById('pref-service').querySelector('input[value="'+person.servicePreference+'"]');
  if (r) r.checked = true;
  document.getElementById('pref-roles').querySelectorAll('input').forEach(function(cb){
    cb.checked = (person.roles || []).indexOf(cb.value) > -1;
  });
  document.getElementById('primary-roles').querySelectorAll('input').forEach(function(cb){
    cb.checked = (person.primaryFor || []).indexOf(cb.value) > -1;
  });
  syncLabels('pref-sundays'); syncLabels('pref-roles'); syncLabels('primary-roles');
  currentBlackouts = (person.blackoutDates || []).slice();
  renderBlackoutChips();
  document.getElementById('absence-start').value = person.absenceStart || '';
  document.getElementById('absence-until').value = person.absenceUntil || '';
  document.getElementById('btn-delete-person-form').style.display = '';
  // Load role override table if the person has any overrides
  var hasOverrides = person.roleSundayOverrides && Object.keys(person.roleSundayOverrides).length > 0;
  if (hasOverrides) {
    document.getElementById('role-override-section').style.display = 'block';
    document.getElementById('toggle-role-overrides').innerHTML = '&#9660; Customize Sundays per role (optional)';
    buildRoleOverrideTable(person.roles, person.roleSundayOverrides || {});
  } else {
    document.getElementById('role-override-section').style.display = 'none';
    document.getElementById('toggle-role-overrides').innerHTML = '&#9658; Customize Sundays per role (optional)';
    document.getElementById('role-override-body').innerHTML = '';
  }
  openPersonPanel('Edit Person');
}

function deletePerson(id) {
  if (!confirm('Remove this person? They will also be removed from the current schedule.')) return;
  savePeople(getPeople().filter(function(p){ return p.id !== id; }));
  // Remove from current schedule assignments
  var scheduleChanged = false;
  currentSchedule.forEach(function(row) {
    PER_ROLES.forEach(function(role) {
      ['8am','10:45am'].forEach(function(svc) {
        if (row.assignments[role][svc] === id) {
          row.assignments[role][svc] = null;
          scheduleChanged = true;
        }
      });
    });
    SHARED_ROLES.forEach(function(role) {
      if (row.assignments[role].shared === id) {
        row.assignments[role].shared = null;
        scheduleChanged = true;
      }
    });
  });
  if (scheduleChanged && currentSchedule.length) {
    var remaining = getPeople();
    var counts = {};
    remaining.forEach(function(p){ counts[p.id] = 0; });
    renderTable(remaining, counts);
    saveSchedule();
  }
  renderPeopleList();
}

// ══════════════════════════════════════════════════════════════════
// SCHEDULING
// ══════════════════════════════════════════════════════════════════
function getSundays(start, end) {
  var sundays = [], d = new Date(start+'T12:00:00');
  while (d.getDay() !== 0) d.setDate(d.getDate()+1);
  var endD = new Date(end+'T12:00:00');
  while (d <= endD) { sundays.push(new Date(d)); d.setDate(d.getDate()+7); }
  return sundays;
}
function getOrdinal(date) { return Math.ceil(date.getDate()/7); }
function isOnAbsence(person, dateISO) {
  if (!person.absenceUntil || !dateISO) return false;
  var start = person.absenceStart || person.absenceUntil;
  return dateISO >= start && dateISO <= person.absenceUntil;
}
function eligible(person, ordinal, svc, dateISO, role) {
  // Use role-specific Sunday override if set, else global preferredSundays
  var sundays = (role && person.roleSundayOverrides && person.roleSundayOverrides[role] && person.roleSundayOverrides[role].length > 0)
    ? person.roleSundayOverrides[role]
    : (person.preferredSundays || []);
  if (sundays.length > 0 && sundays.indexOf(ordinal) === -1) return false;
  if (svc !== 'shared' && person.servicePreference !== 'both' && person.servicePreference !== svc) return false;
  if (dateISO && person.blackoutDates && person.blackoutDates.indexOf(dateISO) !== -1) return false;
  if (isOnAbsence(person, dateISO)) return false;
  return true;
}
function pickBest(pool, counts) {
  if (!pool.length) return null;
  pool.sort(function(a,b){ return (counts[a.id]||0)-(counts[b.id]||0); });
  return pool[0];
}

function generateSchedule() {
  showAlert('schedule-alert','','');
  var people = getPeople();
  if (!people.length) { showAlert('schedule-alert','No people added yet. Go to People &amp; Availability first.','warning'); return; }
  var sundayDates = getSundaysForMonth(currentMonthKey);
  if (!sundayDates.length) { showAlert('schedule-alert','No Sundays found for this month.','warning'); return; }

  // Keep any existing special services for this month
  var existingSpecials = currentSchedule.filter(function(r){ return r.type === 'special'; });

  // Check for existing manual overrides
  var existingOverrides = getScheduleOverrides();
  var overrideCount = Object.keys(existingOverrides).filter(function(k){ return k.slice(0,7)===currentMonthKey; }).length;
  var preserveOverrides = false;
  if (overrideCount > 0) {
    preserveOverrides = confirm(
      'You have ' + overrideCount + ' manual slot assignment(s) in ' + monthKeyLabel(currentMonthKey) + '.\\n\\n' +
      'OK \\u2192 Preserve your manual assignments\\n' +
      'Cancel \\u2192 Discard and regenerate fresh'
    );
    if (!preserveOverrides) {
      var allOverrides = getScheduleOverrides();
      Object.keys(allOverrides).forEach(function(k){ if(k.slice(0,7)===currentMonthKey) delete allOverrides[k]; });
      saveScheduleOverrides(allOverrides);
    }
  }

  if (currentSchedule.filter(function(r){return r.type==='sunday';}).length) archiveCurrentSchedule();

  var primaryMap = {};
  people.forEach(function(p) {
    (p.primaryFor || []).forEach(function(role) { if (!primaryMap[role]) primaryMap[role] = p; });
  });

  var pMap = {};
  people.forEach(function(p){ pMap[p.id] = p; });
  var counts = {};
  people.forEach(function(p){ counts[p.id] = 0; });

  var sundayRows = sundayDates.map(function(s) {
    var ordinal = s.ordinal, assignments = {};
    var dateISO = s.date.toISOString().slice(0,10);

    SHARED_ROLES.forEach(function(role) {
      var primary = primaryMap[role];
      var picked;
      if (primary) {
        picked = ((primary.blackoutDates||[]).indexOf(dateISO)!==-1 || isOnAbsence(primary,dateISO)) ? null : primary;
      } else {
        var pool = people.filter(function(p){ return p.roles.indexOf(role)>-1 && eligible(p,ordinal,'shared',dateISO,role); });
        picked = pickBest(pool, counts);
      }
      assignments[role] = {shared: picked ? picked.id : null};
      if (picked) counts[picked.id]++;
    });

    PER_ROLES.forEach(function(role) {
      assignments[role] = {};
      var usedIds = {};
      var primary = primaryMap[role];
      ['8am','10:45am'].forEach(function(svc) {
        var picked;
        if (primary) {
          var blacked = (primary.blackoutDates||[]).indexOf(dateISO)!==-1 || isOnAbsence(primary,dateISO);
          var svcOk = primary.servicePreference==='both'||primary.servicePreference===svc;
          picked = (!blacked&&svcOk) ? primary : null;
        } else {
          var pool = people.filter(function(p){
            return p.roles.indexOf(role)>-1 && eligible(p,ordinal,svc,dateISO,role) && !usedIds[p.id];
          });
          picked = pickBest(pool, counts);
        }
        assignments[role][svc] = picked ? picked.id : null;
        if (picked) { counts[picked.id]++; usedIds[picked.id]=true; }
      });
    });

    return {type:'sunday', date:s.date, ordinal:ordinal, label:'', assignments:assignments};
  });

  if (preserveOverrides) {
    var overrides = getScheduleOverrides();
    sundayRows.forEach(function(row) {
      var dateISO = row.date.toISOString().slice(0,10);
      Object.keys(overrides).forEach(function(key) {
        var parts = key.split('|');
        if (parts[0]!==dateISO) return;
        var role=parts[1], svc=parts[2];
        if (!row.assignments[role]) return;
        if (svc==='shared') row.assignments[role].shared=overrides[key]||null;
        else                row.assignments[role][svc]=overrides[key]||null;
      });
    });
  }

  // Merge with existing specials and sort by date
  currentSchedule = sundayRows.concat(existingSpecials);
  currentSchedule.sort(function(a,b){ return a.date-b.date; });

  renderTable(people, null);
  document.getElementById('schedule-output').style.display = 'block';
  saveCurrentMonth();
  setDirty(false);
}

document.getElementById('btn-generate').addEventListener('click', generateSchedule);

document.getElementById('btn-autofill').addEventListener('click', autoFillSchedule);

document.getElementById('btn-prev-month').addEventListener('click', function() {
  var parts = currentMonthKey.split('-');
  var d = new Date(parseInt(parts[0]), parseInt(parts[1])-2, 1); // month is 0-indexed, subtract 1 more for prev
  switchMonth(d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'));
});

document.getElementById('btn-next-month').addEventListener('click', function() {
  var parts = currentMonthKey.split('-');
  var d = new Date(parseInt(parts[0]), parseInt(parts[1]), 1); // month 0-indexed, add 0 extra = next month
  switchMonth(d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'));
});

document.getElementById('btn-save-schedule').addEventListener('click', function() {
  saveCurrentMonth();
  showAlert('schedule-alert', 'Schedule saved.', 'success');
});

document.getElementById('btn-add-special').addEventListener('click', function() {
  document.getElementById('special-date').value = '';
  document.getElementById('special-name').value = '';
  document.getElementById('special-services-list').innerHTML = '';
  addSpecialSvcTimeRow();
  // Reset any lingering edit mode
  var saveBtn = document.getElementById('btn-save-special');
  saveBtn.removeAttribute('data-edit-idx');
  saveBtn.textContent = 'Add to Schedule';
  document.getElementById('special-panel-title').textContent = 'Add Special Service';
  openPanel('special-panel');
});

document.getElementById('btn-close-special-panel').addEventListener('click', function() {
  var saveBtn = document.getElementById('btn-save-special');
  saveBtn.removeAttribute('data-edit-idx');
  saveBtn.textContent = 'Add to Schedule';
  document.getElementById('special-panel-title').textContent = 'Add Special Service';
  closeAllPanels();
});

window.addEventListener('beforeunload', function(e) {
  if (isDirty) { e.preventDefault(); e.returnValue = ''; }
});

document.getElementById('btn-expand-all').addEventListener('click', function() {
  var allExpanded = document.querySelectorAll('.sunday-summary:not(.expanded)').length === 0;
  document.querySelectorAll('.sunday-summary').forEach(function(row) {
    var idx = row.getAttribute('data-idx');
    if (allExpanded) {
      row.classList.remove('expanded');
      document.querySelectorAll('.sunday-detail[data-idx="'+idx+'"]').forEach(function(tr){ tr.classList.remove('visible'); });
    } else {
      row.classList.add('expanded');
      document.querySelectorAll('.sunday-detail[data-idx="'+idx+'"]').forEach(function(tr){ tr.classList.add('visible'); });
    }
  });
  this.textContent = allExpanded ? '\\u25bc Expand All' : '\\u25b2 Collapse All';
  updateScheduleHeaders();
});

document.getElementById('btn-clear-schedule').addEventListener('click', function() {
  if (!confirm('Clear the schedule for ' + monthKeyLabel(currentMonthKey) + '? This cannot be undone.')) return;
  currentSchedule = [];
  var months = getMonthSchedules();
  delete months[currentMonthKey];
  saveMonthSchedules(months);
  saveScheduleOverrides({});
  setDirty(false);
  document.getElementById('schedule-output').style.display = 'none';
});

// ══════════════════════════════════════════════════════════════════
// TABLE RENDERING
// ══════════════════════════════════════════════════════════════════
function sundayStats(rowIdx, pMap, confs) {
  var row = currentSchedule[rowIdx];
  var dateISO = row.date.toISOString().slice(0,10);
  var filled=0, open=0, cfmd=0, pend=0, decl=0;
  PER_ROLES.forEach(function(role){
    ['8am','10:45am'].forEach(function(svc){
      var pid=row.assignments[role][svc];
      if(pid&&pMap[pid]){ filled++;
        var s=confs[dateISO+'|'+role+'|'+svc]||'pending';
        if(s==='confirmed') cfmd++; else if(s==='declined') decl++; else pend++;
      } else { open++; }
    });
  });
  SHARED_ROLES.forEach(function(role){
    var pid=row.assignments[role].shared;
    if(pid&&pMap[pid]){ filled++;
      var s=confs[dateISO+'|'+role+'|shared']||'pending';
      if(s==='confirmed') cfmd++; else if(s==='declined') decl++; else pend++;
    } else { open++; }
  });
  return {filled:filled,open:open,cfmd:cfmd,pend:pend,decl:decl};
}

function buildSummaryInner(rowIdx, pMap, confs) {
  var row = currentSchedule[rowIdx];
  var dateISO = row.date.toISOString().slice(0,10);
  var existingLabel = getSundayLabels()[dateISO] || row.label || '';
  var st = sundayStats(rowIdx, pMap, confs);
  var fillColor = st.open===0 ? '#6B8F71' : (st.open<=2 ? '#D4922A' : '#B85C3A');
  var openPart = st.open>0
    ? '<span class="ss-open">'+st.open+' open</span>'
    : '<span class="ss-complete">&#10003; Complete</span>';
  var confBadges = '';
  if(st.cfmd>0) confBadges+='<span class="sconf-badge sconf-confirmed">'+st.cfmd+' &#10003;</span>';
  if(st.decl>0) confBadges+='<span class="sconf-badge sconf-declined">'+st.decl+' &#10007;</span>';
  if(st.pend>0&&st.filled>0) confBadges+='<span class="sconf-badge sconf-pending">'+st.pend+' ?</span>';
  var lectEntry = getLectEntry(row.date);
  var labelPart = '';
  if (existingLabel) {
    labelPart += '<span class="ss-label">'+esc(existingLabel)+'</span>';
  }
  if (lectEntry) {
    labelPart += '<span class="ss-lect-name">'+esc(lectEntry.sundayName)+'</span>'
      +'<span class="ss-series-badge">'+esc(lectEntry.series)+'</span>';
  }
  if (!existingLabel && !lectEntry) {
    labelPart = '<span class="ss-ordinal">'+esc(row.ordinal+ordSuffix(row.ordinal)+' Sunday')+'</span>';
  }
  return '<span class="ss-toggle">&#9658;</span>'
    +'<span class="ss-date">'+esc(fmtDate(row.date))+'</span>'
    +'<span class="ss-label-area">'+labelPart+'</span>'
    +'<span class="ss-stats-area"><span class="ss-fill" style="color:'+fillColor+'">'+st.filled+' filled</span>'+openPart+'</span>'
    +'<span class="ss-conf-area">'+confBadges+'</span>'
    +'<button class="btn-edit-readings" data-date="'+esc(dateISO)+'" title="View or edit readings" style="margin-left:auto;background:none;border:1px solid var(--ice-blue);border-radius:6px;padding:2px 8px;cursor:pointer;font-size:.72rem;color:var(--steel-anchor);white-space:nowrap;font-family:var(--font-body);">&#128214; Readings</button>'
    +'<button class="btn-bulletin-slide" data-idx="'+rowIdx+'" title="Open 16:9 bulletin slide for this Sunday" style="background:none;border:1px solid var(--border);border-radius:6px;padding:2px 8px;cursor:pointer;font-size:.72rem;color:var(--steel-anchor);white-space:nowrap;font-family:var(--font-body);">&#128250; Slide</button>';
}

var scheduleExpandedHeader = '';

function updateScheduleHeaders() {
  var thead = document.getElementById('schedule-thead');
  if (!thead) return;
  var anyExpanded = document.querySelectorAll('.sunday-summary.expanded').length > 0;
  if (anyExpanded) {
    thead.innerHTML = scheduleExpandedHeader;
  } else {
    var totalCols = 2 + PER_ROLES.length + SHARED_ROLES.length;
    thead.innerHTML = '<tr>'
      +'<th class="date-col">Date</th>'
      +'<th>Sunday</th>'
      +'<th>Filled / Open</th>'
      +'<th>Confirmations</th>'
      +'</tr>';
  }
}

function renderTable(people, counts) {
  var totalCols = 2 + PER_ROLES.length + SHARED_ROLES.length;
  var h1 = '<tr>'
    +'<th class="date-col" rowspan="2">Date</th>'
    +'<th class="svc-col" rowspan="2">Svc</th>'
    +'<th class="per-header" colspan="'+PER_ROLES.length+'">Per-Service Roles</th>'
    +'<th class="svc-header shared-col" colspan="'+SHARED_ROLES.length+'">Both Services</th>'
    +'</tr>';
  var h2 = '<tr>';
  PER_ROLES.forEach(function(r){ h2+='<th>'+esc(r)+'</th>'; });
  SHARED_ROLES.forEach(function(r){ h2+='<th class="shared-col">'+esc(roleLabel(r))+'</th>'; });
  h2 += '</tr>';
  scheduleExpandedHeader = h1+h2;
  document.getElementById('schedule-thead').innerHTML = scheduleExpandedHeader;

  var pMap = {};
  people.forEach(function(p){ pMap[p.id]=p; });
  var confs = getConfirmations();

  var bodyHtml = '';
  var allPeople = getPeople();
  currentSchedule.forEach(function(row, rowIdx) {
    var dateISO = row.date.toISOString().slice(0,10);

    if (row.type === 'special') {
      // Special service summary row
      var filled=0, total=0;
      (row.services||[]).forEach(function(svc){
        (svc.roles||[]).forEach(function(role){ total++; if((svc.assignments||{})[role]) filled++; });
      });
      var fillColor = total===0?'#7A6E60':(filled===total?'#6B8F71':(filled>0?'#D4922A':'#B85C3A'));
      var openCount = total - filled;
      var openPart = openCount > 0
        ? '<span class="ss-open">'+openCount+' open</span>'
        : '<span class="ss-complete">&#10003; Complete</span>';
      bodyHtml += '<tr class="sunday-summary special-summary" data-idx="'+rowIdx+'">'
        +'<td colspan="'+totalCols+'"><div class="ss-inner">'
        +'<span class="ss-toggle">&#9658;</span>'
        +'<span class="ss-date">'+esc(fmtDate(row.date))+'</span>'
        +'<span class="ss-label-area"><span class="ss-special-name">'+esc(row.name||'Special Service')+'</span>'
          +'<span class="special-badge">Special</span></span>'
        +'<span class="ss-stats-area"><span class="ss-fill" style="color:'+fillColor+'">'+filled+' filled</span>'+openPart+'</span>'
        +'<span class="ss-conf-area"></span>'
        +'<button class="btn-edit-special"   data-idx="'+rowIdx+'" title="Edit" style="background:none;border:1px solid var(--ice-blue);border-radius:6px;padding:2px 8px;cursor:pointer;font-size:.72rem;color:var(--steel-anchor);font-family:var(--font-body);">&#9998; Edit</button>'
        +'<button class="btn-delete-special" data-idx="'+rowIdx+'" title="Delete" style="background:none;border:1px solid var(--error-border);border-radius:6px;padding:2px 8px;cursor:pointer;font-size:.72rem;color:var(--danger-btn);font-family:var(--font-body);">&#128465;</button>'
        +'</div></td></tr>';

      // One detail row per service time, cells aligned to table columns
      var numSvcs = (row.services||[]).length;
      (row.services||[]).forEach(function(svc, svcIdx) {
        var svcRow = '<tr class="sunday-detail row-special" data-idx="'+rowIdx+'">';
        // Date cell only on first service-time row; spans all service-time rows
        if (svcIdx === 0) {
          svcRow += '<td class="date-cell" rowspan="'+numSvcs+'">'+esc(fmtDate(row.date))+'</td>';
        }
        // Svc column — time label, aligned under the "Svc" header
        svcRow += '<td class="svc-label svc-special">'+esc(svc.time||'Service')+'</td>';
        // Per-service role columns
        PER_ROLES.forEach(function(role) {
          if ((svc.roles||[]).indexOf(role) > -1) {
            var pid = (svc.assignments||{})[role] || '';
            var opts = '<option value="">-- unassigned --</option>';
            allPeople.filter(function(p){
              return p.roles.indexOf(role)>-1 && (p.blackoutDates||[]).indexOf(dateISO)===-1 && !isOnAbsence(p,dateISO);
            }).forEach(function(p){
              opts += '<option value="'+esc(p.id)+'"'+(pid===p.id?' selected':'')+'>'+esc(p.name)+'</option>';
            });
            svcRow += '<td><select class="cell-select" data-row="'+rowIdx+'" data-svc-idx="'+svcIdx+'" data-role="'+esc(role)+'" data-special="1">'+opts+'</select></td>';
          } else {
            svcRow += '<td class="na-cell"></td>';
          }
        });
        // Shared role columns
        SHARED_ROLES.forEach(function(role) {
          if ((svc.roles||[]).indexOf(role) > -1) {
            var pid = (svc.assignments||{})[role] || '';
            var opts = '<option value="">-- unassigned --</option>';
            allPeople.filter(function(p){
              return p.roles.indexOf(role)>-1 && (p.blackoutDates||[]).indexOf(dateISO)===-1 && !isOnAbsence(p,dateISO);
            }).forEach(function(p){
              opts += '<option value="'+esc(p.id)+'"'+(pid===p.id?' selected':'')+'>'+esc(p.name)+'</option>';
            });
            svcRow += '<td class="shared-col"><select class="cell-select" data-row="'+rowIdx+'" data-svc-idx="'+svcIdx+'" data-role="'+esc(role)+'" data-special="1">'+opts+'</select></td>';
          } else {
            svcRow += '<td class="shared-col na-cell"></td>';
          }
        });
        svcRow += '</tr>';
        bodyHtml += svcRow;
      });
      return;
    }

    var existingLabel = getSundayLabels()[dateISO] || row.label || '';

    // Summary row (collapsed by default)
    bodyHtml += '<tr class="sunday-summary" data-idx="'+rowIdx+'">'
      +'<td colspan="'+totalCols+'"><div class="ss-inner">'+buildSummaryInner(rowIdx, pMap, confs)+'</div></td>'
      +'</tr>';

    // Detail row 1: 8am
    var r1 = '<tr class="sunday-detail row-8am" data-idx="'+rowIdx+'">';
    var lectEntryDetail = getLectEntry(row.date);
    var ordinalOrLect = lectEntryDetail
      ? '<span class="lect-name-cell">'+esc(lectEntryDetail.sundayName)+'</span>'
        +'<span class="series-cell">Series '+esc(lectEntryDetail.series)+'</span>'
      : '<span class="ordinal">'+esc(row.ordinal+ordSuffix(row.ordinal)+' Sunday')+'</span>';
    r1 += '<td class="date-cell" rowspan="2">'+esc(fmtDate(row.date))
      +ordinalOrLect
      +'<input class="label-input" placeholder="Add label…" value="'+esc(existingLabel)+'" data-date="'+esc(dateISO)+'" title="Add a special label (e.g. Christmas Eve)">'
      +'</td>';
    r1 += '<td class="svc-label svc-8am">8am</td>';
    PER_ROLES.forEach(function(role){ r1 += buildCell(row.assignments[role]['8am'], pMap, rowIdx, role, '8am'); });
    SHARED_ROLES.forEach(function(role){ r1 += buildCell(row.assignments[role].shared, pMap, rowIdx, role, 'shared', 2); });
    r1 += '</tr>';

    // Detail row 2: 10:45am
    var r2 = '<tr class="sunday-detail row-1045" data-idx="'+rowIdx+'">';
    r2 += '<td class="svc-label svc-1045">10:45</td>';
    PER_ROLES.forEach(function(role){ r2 += buildCell(row.assignments[role]['10:45am'], pMap, rowIdx, role, '10:45am'); });
    r2 += '</tr>';

    bodyHtml += r1 + r2;

    // Mobile card row — vertical layout for narrow screens, toggled alongside desktop rows
    var mCard = '<tr class="sunday-detail sunday-mobile" data-idx="'+rowIdx+'">'
      +'<td colspan="'+totalCols+'" style="padding:0;border-top:none;">'
      +'<div class="sched-mc">';
    mCard += '<div class="sched-mc-svc"><div class="sched-mc-svctime">8:00am</div>';
    PER_ROLES.forEach(function(role){
      var pid8 = row.assignments[role]['8am'];
      var p8 = pid8 && pMap[pid8];
      mCard += '<div class="sched-mc-row'+(p8?' sched-mc-filled':' sched-mc-empty')+'">'
        +'<span class="sched-mc-lbl">'+esc(role)+'</span>'
        +'<span class="sched-mc-val">'+(p8?esc(p8.name):'Unfilled')+'</span></div>';
    });
    mCard += '</div>';
    if (SHARED_ROLES.length) {
      mCard += '<div class="sched-mc-svc sched-mc-shared"><div class="sched-mc-svctime">Both Services</div>';
      SHARED_ROLES.forEach(function(role){
        var pidS = row.assignments[role].shared;
        var pS = pidS && pMap[pidS];
        mCard += '<div class="sched-mc-row'+(pS?' sched-mc-filled':' sched-mc-empty')+'">'
          +'<span class="sched-mc-lbl">'+esc(role)+'</span>'
          +'<span class="sched-mc-val">'+(pS?esc(pS.name):'Unfilled')+'</span></div>';
      });
      mCard += '</div>';
    }
    mCard += '<div class="sched-mc-svc"><div class="sched-mc-svctime">10:45am</div>';
    PER_ROLES.forEach(function(role){
      var pid45 = row.assignments[role]['10:45am'];
      var p45 = pid45 && pMap[pid45];
      mCard += '<div class="sched-mc-row'+(p45?' sched-mc-filled':' sched-mc-empty')+'">'
        +'<span class="sched-mc-lbl">'+esc(role)+'</span>'
        +'<span class="sched-mc-val">'+(p45?esc(p45.name):'Unfilled')+'</span></div>';
    });
    mCard += '</div></div></td></tr>';
    bodyHtml += mCard;
  });
  document.getElementById('schedule-tbody').innerHTML = bodyHtml;


}

function updateSundaySummary(rowIdx) {
  var summaryRow = document.querySelector('.sunday-summary[data-idx="'+rowIdx+'"]');
  if (!summaryRow) return;
  var pMap = {};
  getPeople().forEach(function(p){ pMap[p.id]=p; });
  var isExpanded = summaryRow.classList.contains('expanded');
  summaryRow.querySelector('.ss-inner').innerHTML = buildSummaryInner(rowIdx, pMap, getConfirmations());
  if (isExpanded) summaryRow.classList.add('expanded');
}

function buildCell(pid, pMap, rowIdx, role, svc, rowspan) {
  var people = getPeople();
  var row = currentSchedule[rowIdx];
  var ordinal = row.ordinal;
  var dateISO = row.date.toISOString().slice(0, 10);

  // Determine if this cell is a manual override or a primary assignment
  var overrideKey = dateISO + '|' + role + '|' + svc;
  var overrides = getScheduleOverrides();
  var isOverride = overrideKey in overrides;

  // Find primary person for this role (if any)
  var primaryPerson = null;
  people.forEach(function(p){ if ((p.primaryFor||[]).indexOf(role) > -1 && !primaryPerson) primaryPerson = p; });
  var isPrimary = !isOverride && pid && primaryPerson && pid === primaryPerson.id;

  // Build dropdown pool — always include primary person if not blacked out
  var pool = people.filter(function(p){
    if (primaryPerson && p.id === primaryPerson.id) {
      // Include primary person if not blacked out (ignore preferredSundays for primary)
      var blacked = (p.blackoutDates || []).indexOf(dateISO) !== -1 || isOnAbsence(p, dateISO);
      var svcOk = svc === 'shared' || p.servicePreference === 'both' || p.servicePreference === svc;
      return p.roles.indexOf(role) > -1 && !blacked && svcOk;
    }
    // Manual dropdown shows all role+service matches regardless of preferred Sunday
    var blacked = (p.blackoutDates || []).indexOf(dateISO) !== -1 || isOnAbsence(p, dateISO);
    var svcOk = svc === 'shared' || p.servicePreference === 'both' || p.servicePreference === svc;
    return p.roles.indexOf(role) > -1 && !blacked && svcOk;
  });
  var opts = '<option value="">-- unassigned --</option>';
  pool.forEach(function(p){
    opts += '<option value="'+esc(p.id)+'"'+(pid===p.id?' selected':'')+'>'+esc(p.name)+'</option>';
  });
  // If current person isn't in pool at all, still show them with a warning
  if (pid && pMap[pid] && !pool.some(function(p){ return p.id===pid; })) {
    opts += '<option value="'+esc(pid)+'" selected>&#9888; '+esc(pMap[pid].name)+'</option>';
  }

  var rsAttr = rowspan > 1 ? ' rowspan="'+rowspan+'"' : '';
  var tdClass = (pid && pMap[pid] ? 'filled-cell' : 'empty-cell')
    + (rowspan > 1 ? ' shared-cell' : '')
    + (isOverride ? ' override-cell' : '')
    + (isPrimary  ? ' primary-cell'  : '');

  var confKey = dateISO + '|' + role + '|' + svc;
  var confStatus = pid ? (getConfirmations()[confKey] || 'pending') : '';
  var confLabels = { pending: '? Pending', confirmed: '\\u2713 Confirmed', declined: '\\u00d7 Declined', needs_changes: '\\u26a0 Needs Change' };
  var confPill = pid ? '<button class="conf-pill conf-'+confStatus+'" data-conf-key="'+esc(confKey)+'">'+(confLabels[confStatus]||confLabels.pending)+'</button>' : '';

  var badge = isOverride ? '<span class="cell-badge cell-badge-override" title="Manually assigned">&#9998;</span>'
            : isPrimary  ? '<span class="cell-badge cell-badge-primary"  title="Primary assignment">&#9733;</span>'
            : '';

  var sentEntry = getEmailSentLog()['reminder_' + dateISO] || null;
  var emailedPids = sentEntry ? (sentEntry.pids || []) : [];
  // Fallback: if an entry exists but predates pid tracking, treat all assigned people as emailed
  var weekWasEmailed = !!(sentEntry && sentEntry.sentAt && (!sentEntry.pids || emailedPids.indexOf(pid) !== -1));
  var emailBadge = (pid && weekWasEmailed)
    ? '<span title="Assignment email sent" style="display:block;font-size:.68rem;color:var(--warm-gray);text-align:center;margin-top:2px;letter-spacing:0.02em;">&#9993; emailed</span>'
    : '';

  return '<td class="'+tdClass+'"'+rsAttr+'>'
    +'<select class="cell-select" data-row="'+rowIdx+'" data-role="'+esc(role)+'" data-svc="'+esc(svc)+'">'+opts+'</select>'
    +badge+confPill+emailBadge+'</td>';
}

document.getElementById('schedule-table').addEventListener('change', function(e) {
  var sel = e.target;
  if (!sel.classList.contains('cell-select')) return;
  var rowIdx = parseInt(sel.getAttribute('data-row'),10);
  var role = sel.getAttribute('data-role');
  var pid  = sel.value || null;
  var row = currentSchedule[rowIdx];

  // Special service row
  if (sel.getAttribute('data-special') === '1') {
    var svcIdx = parseInt(sel.getAttribute('data-svc-idx'),10);
    if (row && row.services && row.services[svcIdx]) {
      if (!row.services[svcIdx].assignments) row.services[svcIdx].assignments = {};
      row.services[svcIdx].assignments[role] = pid;
    }
    setDirty(true);
    // Refresh special summary row
    var summaryRow = document.querySelector('.sunday-summary[data-idx="'+rowIdx+'"]');
    if (summaryRow) {
      var filled=0, total=0;
      (row.services||[]).forEach(function(s){
        (s.roles||[]).forEach(function(r){ total++; if((s.assignments||{})[r]) filled++; });
      });
      var fillColor = total===0?'#7A6E60':(filled===total?'#6B8F71':(filled>0?'#D4922A':'#B85C3A'));
      var fillEl = summaryRow.querySelector('.ss-fill');
      if (fillEl) { fillEl.textContent = filled+'/'+total+' filled'; fillEl.style.color = fillColor; }
    }
    return;
  }

  var svc  = sel.getAttribute('data-svc');
  if (svc==='shared') row.assignments[role].shared = pid;
  else                row.assignments[role][svc]   = pid;

  // Save as manual override
  var dateISO = row.date.toISOString().slice(0,10);
  var overrideKey = dateISO + '|' + role + '|' + svc;
  var overrides = getScheduleOverrides();
  overrides[overrideKey] = pid || '';   // '' = explicitly cleared
  saveScheduleOverrides(overrides);

  // Update td classes to reflect override state
  var td = sel.parentElement;
  var isShared = td.classList.contains('shared-cell');
  td.className = (pid ? 'filled-cell' : 'empty-cell')
    + (isShared ? ' shared-cell' : '')
    + ' override-cell';
  // Replace any existing badge with override badge
  var existingBadge = td.querySelector('.cell-badge');
  if (existingBadge) existingBadge.remove();
  if (pid) {
    var badge = document.createElement('span');
    badge.className = 'cell-badge cell-badge-override';
    badge.title = 'Manually assigned';
    badge.innerHTML = '&#9998;';
    var confPill = td.querySelector('.conf-pill');
    td.insertBefore(badge, confPill || null);
  }

  setDirty(true);
  // Refresh summary row for this Sunday
  updateSundaySummary(rowIdx);
});

// Sunday summary row: click to expand/collapse detail rows
document.getElementById('schedule-table').addEventListener('click', function(e) {
  // Delete special service
  if (e.target.closest('.btn-delete-special')) {
    var delBtn = e.target.closest('.btn-delete-special');
    var delIdx = parseInt(delBtn.getAttribute('data-idx'), 10);
    var delName = currentSchedule[delIdx] && (currentSchedule[delIdx].name || 'this special service');
    if (confirm('Delete "'+delName+'"?')) {
      currentSchedule.splice(delIdx, 1);
      saveCurrentMonth();
      setDirty(false);
      renderTable(getPeople(), null);
    }
    return;
  }
  // Bulletin slide
  if (e.target.closest('.btn-bulletin-slide')) {
    var bsBtn = e.target.closest('.btn-bulletin-slide');
    openBulletinSlide(parseInt(bsBtn.getAttribute('data-idx'), 10));
    return;
  }
  // Edit readings for a Sunday
  if (e.target.closest('.btn-edit-readings')) {
    var rdBtn = e.target.closest('.btn-edit-readings');
    openReadingsPanel(rdBtn.getAttribute('data-date'));
    return;
  }
  // Edit special service — open panel pre-filled
  if (e.target.closest('.btn-edit-special')) {
    var editBtn = e.target.closest('.btn-edit-special');
    var editIdx = parseInt(editBtn.getAttribute('data-idx'), 10);
    var editRow = currentSchedule[editIdx];
    document.getElementById('special-date').value = editRow.date.toISOString().slice(0,10);
    document.getElementById('special-name').value = editRow.name || '';
    var editList = document.getElementById('special-services-list');
    editList.innerHTML = '';
    (editRow.services||[]).forEach(function(svc) {
      addSpecialSvcTimeRow(svc.time, svc.roles);
    });
    document.getElementById('special-panel-title').textContent = 'Edit Special Service';
    var saveBtn = document.getElementById('btn-save-special');
    saveBtn.textContent = 'Update Service';
    saveBtn.setAttribute('data-edit-idx', editIdx);
    openPanel('special-panel');
    return;
  }
  var summaryRow = e.target.closest('.sunday-summary');
  if (!summaryRow) return;
  var idx = summaryRow.getAttribute('data-idx');
  summaryRow.classList.toggle('expanded');
  var isExpanded = summaryRow.classList.contains('expanded');
  document.querySelectorAll('.sunday-detail[data-idx="'+idx+'"]').forEach(function(tr) {
    tr.classList.toggle('visible', isExpanded);
  });
  updateScheduleHeaders();
});

// ══════════════════════════════════════════════════════════════════
// EXPORT CSV
// ══════════════════════════════════════════════════════════════════
// Confirmation pill click: cycle pending → confirmed → declined
document.getElementById('schedule-table').addEventListener('click', function(e) {
  var pill = e.target.closest('.conf-pill');
  if (!pill) return;
  var key = pill.getAttribute('data-conf-key');
  if (!key) return;
  var confs = getConfirmations();
  var cycle = { pending: 'confirmed', confirmed: 'declined', declined: 'pending' };
  var current = confs[key] || 'pending';
  confs[key] = cycle[current];
  saveConfirmations(confs);
  var labels = { pending: '? Pending', confirmed: '\\u2713 Confirmed', declined: '\\u00d7 Declined', needs_changes: '\\u26a0 Needs Change' };
  pill.textContent = labels[confs[key]] || '? Pending';
  pill.className = 'conf-pill conf-' + confs[key];
  // Refresh the sunday summary row
  var detailRow = pill.closest('.sunday-detail');
  if (detailRow) updateSundaySummary(parseInt(detailRow.getAttribute('data-idx'), 10));
});

// Sunday label input: save on change
document.getElementById('schedule-table').addEventListener('change', function(e) {
  if (!e.target.classList.contains('label-input')) return;
  var date = e.target.getAttribute('data-date');
  if (!date) return;
  var labels = getSundayLabels();
  labels[date] = e.target.value.trim();
  saveSundayLabels(labels);
  // Also update the in-memory row label
  currentSchedule.forEach(function(row) {
    if (row.date.toISOString().slice(0,10) === date) row.label = e.target.value.trim();
  });
});
document.getElementById('schedule-table').addEventListener('input', function(e) {
  if (!e.target.classList.contains('label-input')) return;
  var date = e.target.getAttribute('data-date');
  if (!date) return;
  var labels = getSundayLabels();
  labels[date] = e.target.value;
  saveSundayLabels(labels);
  currentSchedule.forEach(function(row) {
    if (row.date.toISOString().slice(0,10) === date) row.label = e.target.value;
  });
});

document.getElementById('btn-export-csv').addEventListener('click', function() {
  var pMap = {};
  getPeople().forEach(function(p){ pMap[p.id]=p; });
  var headers = ['Date','Sunday'];
  PER_ROLES.forEach(function(r){ headers.push('8am - '+r); });
  PER_ROLES.forEach(function(r){ headers.push('10:45am - '+r); });
  SHARED_ROLES.forEach(function(r){ headers.push('Both - '+roleLabel(r)); });
  var lines = [headers.map(function(h){ return '"'+h.replace(/"/g,'""')+'"'; }).join(',')];
  currentSchedule.forEach(function(row) {
    if (row.type === 'special') {
      var emptyCells = headers.slice(2).map(function() { return '""'; }).join(',');
      lines.push('"'+fmtDate(row.date)+'","'+String(row.name||'Special Service').replace(/"/g,'""')+'",'+emptyCells);
      return;
    }
    if (row.type !== 'sunday') return;
    var cells = [fmtDate(row.date), row.ordinal+ordSuffix(row.ordinal)+' Sunday'];
    PER_ROLES.forEach(function(role){ var pid=row.assignments[role]['8am'];    cells.push(pid&&pMap[pid]?pMap[pid].name:''); });
    PER_ROLES.forEach(function(role){ var pid=row.assignments[role]['10:45am'];cells.push(pid&&pMap[pid]?pMap[pid].name:''); });
    SHARED_ROLES.forEach(function(role){ var pid=row.assignments[role].shared; cells.push(pid&&pMap[pid]?pMap[pid].name:''); });
    lines.push(cells.map(function(c){ return '"'+String(c).replace(/"/g,'""')+'"'; }).join(','));
  });
  var blob = new Blob([lines.join('\\n')],{type:'text/csv'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a'); a.href=url; a.download='worship-schedule.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
});

document.getElementById('btn-print').addEventListener('click', function(){ window.print(); });

// Swap dropdowns for plain text before printing, restore after
window.addEventListener('beforeprint', function() {
  document.querySelectorAll('.cell-select').forEach(function(sel) {
    var name = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
    if (name === '-- unassigned --') name = '';
    var span = document.createElement('span');
    span.className = 'print-name';
    span.style.display = 'none'; // @media print overrides to inline
    span.textContent = name;
    span.setAttribute('data-print-placeholder', 'true');
    sel.parentNode.insertBefore(span, sel.nextSibling);
  });
});
window.addEventListener('afterprint', function() {
  document.querySelectorAll('[data-print-placeholder]').forEach(function(el) {
    el.parentNode.removeChild(el);
  });
});

// ══════════════════════════════════════════════════════════════════
// BULLETIN SLIDE (16×9)
// ══════════════════════════════════════════════════════════════════
function openBulletinSlide(rowIdx) {
  var row = currentSchedule[rowIdx];
  if (!row || row.type !== 'sunday') return;
  var pMap = {};
  getPeople().forEach(function(p){ pMap[p.id] = p; });

  function getName(pid) { return (pid && pMap[pid]) ? pMap[pid].name : ''; }

  // Build role cards for one service column
  function buildServiceCards(svcKey) {
    return PER_ROLES.map(function(role) {
      var pid = (row.assignments[role] || {})[svcKey] || '';
      var name = getName(pid);
      return '<div class="role-card">'
        + '<div class="role-badge">' + esc(role) + '</div>'
        + (name
            ? '<div class="role-name">' + esc(name) + '</div>'
            : '<div class="role-empty">—</div>')
        + '</div>';
    }).join('');
  }

  var dateStr = row.date.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<title>Serving Slide \\u2014 ' + esc(dateStr) + '</title>'
    + '<link href="https://fonts.googleapis.com/css2?family=Lora:wght@700&family=Source+Sans+3:wght@400;700&display=swap" rel="stylesheet">'
    + '<style>'
    + '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}'
    + 'html,body{width:1920px;height:1080px;overflow:hidden;background:#FAF7F0;'
    +   'font-family:"Source Sans 3",Arial,sans-serif;}'
    + '.slide{width:1920px;height:1080px;display:flex;flex-direction:column;}'

    // Header bar — steel-anchor bg, amber bottom accent (matches app header)
    + '.slide-header{background:#0A3C5C;border-bottom:6px solid #D4922A;'
    +   'padding:38px 80px 32px;display:flex;flex-direction:column;}'
    + '.slide-title{font-family:"Lora",Georgia,serif;font-size:4rem;font-weight:700;'
    +   'color:#fff;letter-spacing:.02em;line-height:1.1;}'
    + '.slide-date{font-size:1.75rem;font-weight:700;color:#D4922A;'
    +   'text-transform:uppercase;letter-spacing:.07em;margin-top:8px;}'

    // Services area — warm-white background
    + '.services{display:flex;gap:40px;flex:1;padding:36px 80px;background:#FAF7F0;}'
    + '.svc-col{flex:1;display:flex;flex-direction:column;gap:10px;}'

    // Service column headers — ice-blue for 8am, pale-gold for 10:45 (matches schedule table)
    + '.svc-header-8am{background:#C4DDE8;color:#0A3C5C;border-bottom:3px solid #5C8FA8;'
    +   'font-size:1.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;'
    +   'padding:14px 22px;border-radius:10px 10px 0 0;}'
    + '.svc-header-1045{background:#F5E0B0;color:#5a3a00;border-bottom:3px solid #E8B86D;'
    +   'font-size:1.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;'
    +   'padding:14px 22px;border-radius:10px 10px 0 0;}'

    // Role cards — white with subtle border + shadow (matches app cards)
    + '.role-card{flex:1;background:#fff;border:1px solid #E8E0D0;border-top:none;'
    +   'box-shadow:0 2px 10px rgba(10,60,92,.07);position:relative;'
    +   'display:flex;flex-direction:column;justify-content:flex-end;padding:14px 22px 18px;}'
    + '.role-card:last-child{border-radius:0 0 10px 10px;}'

    // Role badge — steel-anchor (matches thead th)
    + '.role-badge{position:absolute;top:0;left:0;background:#0A3C5C;color:#fff;'
    +   'font-size:.95rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;'
    +   'padding:6px 16px;border-radius:0 0 8px 0;}'

    // Person name — Lora serif, charcoal
    + '.role-name{font-family:"Lora",Georgia,serif;font-size:2.4rem;font-weight:700;'
    +   'color:#3D3530;line-height:1.1;margin-top:34px;}'
    + '.role-empty{font-size:1.3rem;color:#7A6E60;font-style:italic;margin-top:34px;}'

    // Footer bar — steel-anchor with amber top accent
    + '.slide-footer{background:#0A3C5C;border-top:4px solid #D4922A;'
    +   'padding:20px 80px;display:flex;justify-content:space-between;align-items:center;}'
    + '.footer-cta{font-size:1.6rem;font-weight:700;color:#D4922A;'
    +   'text-transform:uppercase;letter-spacing:.06em;}'
    + '.print-note{font-size:.8rem;color:rgba(255,255,255,.4);}'

    + '</style></head><body>'
    + '<div class="slide">'
    + '<div class="slide-header">'
    +   '<div class="slide-title">Serving the Lord Today</div>'
    +   '<div class="slide-date">' + esc(dateStr) + '</div>'
    + '</div>'
    + '<div class="services">'
    + '<div class="svc-col"><div class="svc-header-8am">8:00 AM Service</div>'
    + buildServiceCards('8am')
    + '</div>'
    + '<div class="svc-col"><div class="svc-header-1045">10:45 AM Service</div>'
    + buildServiceCards('10:45am')
    + '</div>'
    + '</div>'
    + '<div class="slide-footer">'
    +   '<div class="footer-cta">Talk with our Pastors to Volunteer</div>'
    +   '<div class="print-note">Screenshot to use in your announcement slide deck \\u00b7 1920 \\u00d7 1080</div>'
    + '</div>'
    + '</div>'
    + '</body></html>';

  var win = window.open('', '_blank', 'width=1280,height=720');
  if (!win) { alert('Pop-up blocked — please allow pop-ups for this page.'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// ══════════════════════════════════════════════════════════════════
// REMINDER EMAILS
// ══════════════════════════════════════════════════════════════════
function buildHtmlEmail(person, assignments, replyTo, rsvpToken, workerUrl) {
  var th = 'padding:8px 12px;text-align:left;border-bottom:2px solid #E8E0D0;font-size:0.78rem;color:#0A3C5C;text-transform:uppercase;letter-spacing:0.05em;';

  // Schedule table — always 3 columns, no confirm column (fits any screen width)
  var rows = assignments.map(function(a) {
    var svcLabel = a.svc === 'both services' ? 'Both Services' : a.svc;
    return '<tr>'
      + '<td style="padding:8px 12px;border-bottom:1px solid #E8E0D0;white-space:nowrap;">' + esc(a.date) + '</td>'
      + '<td style="padding:8px 12px;border-bottom:1px solid #E8E0D0;">' + esc(svcLabel) + '</td>'
      + '<td style="padding:8px 12px;border-bottom:1px solid #E8E0D0;font-weight:600;">' + esc(roleLabel(a.role)) + '</td>'
      + '</tr>';
  }).join('');

  var replyLink = replyTo
    ? '<a href="mailto:' + esc(replyTo) + '" style="color:#3D627C;">' + esc(replyTo) + '</a>'
    : '';

  // Readings section — Lectors get OT+Epistle, Liturgists get Gospel+Psalm
  var readingsItems = [];
  assignments.forEach(function(a) {
    var role = (a.role || '').toLowerCase();
    var isLector = role === 'lector';
    var isLiturgist = role === 'liturgist';
    if (!isLector && !isLiturgist) return;
    var rd = a.dateISO ? getReadingsForDate(a.dateISO) : null;
    if (!rd) return;
    var rdLines = [];
    if (isLector) {
      if (rd.ot)      rdLines.push({ label: 'OT',      ref: rd.ot });
      if (rd.epistle) rdLines.push({ label: 'Epistle',  ref: rd.epistle });
    } else {
      if (rd.gospel)  rdLines.push({ label: 'Gospel',  ref: rd.gospel });
      if (rd.psalm)   rdLines.push({ label: 'Psalm',   ref: rd.psalm });
    }
    if (!rdLines.length) return;
    var svcLabel = a.svc === 'both services' ? 'Both Services' : a.svc;
    readingsItems.push({ header: a.date + ' \\u2014 ' + svcLabel + ' (' + roleLabel(a.role) + ')', lines: rdLines });
  });
  var readingsSection = '';
  if (readingsItems.length) {
    var itemsHtml = readingsItems.map(function(item) {
      var lineHtml = item.lines.map(function(l) {
        var link = bibleLink(l.ref);
        var refDisplay = link
          ? '<a href="' + esc(link) + '" style="color:#3D627C;">' + esc(l.ref) + '</a>'
          : esc(l.ref);
        return '<div style="margin-top:4px;"><span style="color:#7A6E60;font-size:.85rem;font-weight:600;">' + esc(l.label) + ':</span> ' + refDisplay + '</div>';
      }).join('');
      return '<div style="margin-bottom:14px;">'
        + '<div style="font-size:.75rem;font-weight:700;color:#7A6E60;text-transform:uppercase;letter-spacing:.04em;">' + esc(item.header) + '</div>'
        + lineHtml
        + '</div>';
    }).join('');
    readingsSection = '<div style="background:#FAF7F0;border:1px solid #E8E0D0;border-radius:6px;padding:16px;margin-bottom:20px;">'
      + '<div style="font-weight:700;color:#0A3C5C;margin-bottom:12px;font-size:.9rem;">&#128214; Your Readings</div>'
      + itemsHtml
      + '</div>';
  }

  // RSVP section — separate block below the schedule table, mobile-safe 2-col layout
  var rsvpSection = '';
  if (rsvpToken && workerUrl) {
    var confirmAllUrl = workerUrl + '/rsvp?token=' + encodeURIComponent(rsvpToken) + '&status=confirmed';
    var changesAllUrl = workerUrl + '/rsvp?token=' + encodeURIComponent(rsvpToken) + '&status=needs_changes';
    var portalUrl     = workerUrl + '/rsvp/portal?token=' + encodeURIComponent(rsvpToken);

    // Per-assignment rows in a 2-column table: "Date — Role (svc)" | [✓ Yes] [⚠ Change] [✗ Decline]
    // Two columns is easy on any phone; no 4-col overflow
    var confirmRows = assignments.map(function(a, idx) {
      var svcLabel = a.svc === 'both services' ? 'Both Svcs' : a.svc;
      var cfUrl = workerUrl + '/rsvp?token=' + encodeURIComponent(rsvpToken) + '&idx=' + idx + '&status=confirmed';
      var ncUrl = workerUrl + '/rsvp?token=' + encodeURIComponent(rsvpToken) + '&idx=' + idx + '&status=needs_changes';
      var dcUrl = workerUrl + '/rsvp?token=' + encodeURIComponent(rsvpToken) + '&idx=' + idx + '&status=declined';
      return '<tr>'
        + '<td style="padding:10px 12px;border-bottom:1px solid #eef;font-size:0.86rem;vertical-align:middle;">'
        + '<strong>' + esc(a.date) + '</strong>'
        + '<span style="color:#666;"> &mdash; ' + esc(roleLabel(a.role)) + '</span>'
        + '<br><span style="font-size:0.78rem;color:#7A6E60;">' + esc(svcLabel) + '</span>'
        + '</td>'
        + '<td style="padding:10px 12px;border-bottom:1px solid #eef;vertical-align:middle;text-align:right;width:1%;white-space:nowrap;">'
        + '<a href="' + esc(cfUrl) + '" style="display:inline-block;background:#6B8F71;color:white;text-decoration:none;padding:7px 14px;border-radius:5px;font-size:0.8rem;font-weight:700;margin-right:5px;">\\u2713 Yes</a>'
        + '<a href="' + esc(ncUrl) + '" style="display:inline-block;background:#D4922A;color:white;text-decoration:none;padding:7px 14px;border-radius:5px;font-size:0.8rem;font-weight:700;margin-right:5px;">\\u26a0 Change</a>'
        + '<a href="' + esc(dcUrl) + '" style="display:inline-block;background:#A93226;color:white;text-decoration:none;padding:7px 14px;border-radius:5px;font-size:0.8rem;font-weight:700;">\\u2717 Decline</a>'
        + '</td>'
        + '</tr>';
    }).join('');

    var declineAllUrl = workerUrl + '/rsvp?token=' + encodeURIComponent(rsvpToken) + '&status=declined';

    rsvpSection = ''
      + '<div style="background:#f6f9ff;border:1px solid #c8d8f0;border-radius:8px;margin-bottom:20px;overflow:hidden;">'
      + '<div style="background:#0A3C5C;padding:10px 14px;">'
      + '<p style="margin:0;font-size:0.82rem;color:white;font-weight:600;">Can you serve on these Sundays? Please confirm each one:</p>'
      + '</div>'
      + '<table style="width:100%;border-collapse:collapse;">'
      + confirmRows
      + '</table>'
      + '<div style="padding:12px 14px;background:#eef2fb;border-top:1px solid #c8d8f0;">'
      + '<p style="margin:0 0 8px;font-size:0.78rem;color:#7A6E60;">Or respond to all at once:</p>'
      + '<a href="' + esc(confirmAllUrl) + '" style="display:inline-block;background:#6B8F71;color:white;text-decoration:none;padding:8px 16px;border-radius:5px;font-weight:700;font-size:0.82rem;margin:0 6px 4px 0;">\\u2713 Confirm All</a>'
      + '<a href="' + esc(changesAllUrl) + '" style="display:inline-block;background:#D4922A;color:white;text-decoration:none;padding:8px 16px;border-radius:5px;font-weight:700;font-size:0.82rem;margin:0 6px 4px 0;">\\u26a0 Change All</a>'
      + '<a href="' + esc(declineAllUrl) + '" style="display:inline-block;background:#A93226;color:white;text-decoration:none;padding:8px 16px;border-radius:5px;font-weight:700;font-size:0.82rem;margin:0 6px 4px 0;">\\u2717 Decline All</a>'
      + '<a href="' + esc(portalUrl) + '" style="display:inline-block;background:white;color:#0A3C5C;text-decoration:none;padding:8px 16px;border-radius:5px;font-weight:600;font-size:0.82rem;border:1px solid #C4DDE8;margin:0 0 4px 0;">\\uD83D\\uDCC5 My Full Schedule</a>'
      + '</div>'
      + '</div>';
  }

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head>'
    + '<body style="margin:0;padding:0;background:#EDF5F8;font-family:Arial,Helvetica,sans-serif;color:#3D3530;">'
    + '<div style="max-width:580px;margin:24px auto;">'
    + '<div style="background:#0A3C5C;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">'
    + '<div style="font-size:1.2rem;font-weight:700;">Timothy Lutheran Church</div>'
    + '<div style="font-size:0.85rem;opacity:0.8;margin-top:3px;">Worship Service Volunteer Schedule</div>'
    + '</div>'
    + '<div style="background:white;padding:24px;border:1px solid #E8E0D0;border-top:none;border-radius:0 0 8px 8px;">'
    + '<p style="margin:0 0 14px;">Hello ' + esc(person.name) + ',</p>'
    + '<p style="margin:0 0 12px;color:#444;">Here are your upcoming worship service assignments:</p>'
    + '<table style="width:100%;border-collapse:collapse;margin:0 0 20px;font-size:0.88rem;">'
    + '<thead><tr style="background:#EDF5F8;">'
    + '<th style="' + th + '">Date</th>'
    + '<th style="' + th + '">Service</th>'
    + '<th style="' + th + '">Role</th>'
    + '</tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '</table>'
    + readingsSection
    + rsvpSection
    + (rsvpToken ? '' :
        '<div style="background:#F5E0B0;border-left:4px solid #D4922A;padding:14px 16px;border-radius:0 6px 6px 0;margin-bottom:20px;">'
      + '<strong style="color:#7a4800;">Unable to serve on one of these dates?</strong>'
      + '<p style="margin:6px 0 0;font-size:0.88rem;color:#5a3a00;">Simply <strong>reply to this email</strong> and we will work to find a substitute.</p>'
      + '</div>')
    + '<p style="font-size:0.9rem;margin:0 0 6px;">Thank you for your faithful service to our congregation!</p>'
    + '<p style="font-size:0.78rem;color:#7A6E60;margin:4px 0 0;">A calendar attachment (.ics) is included \\u2014 add it to your calendar to be reminded on each Sunday you serve.</p>'
    + '<p style="font-size:0.8rem;color:#7A6E60;margin:20px 0 0;padding-top:14px;border-top:1px solid #E8E0D0;">'
    + 'Timothy Lutheran Church'
    + (replyLink ? ' &mdash; Questions? Contact us at ' + replyLink : '')
    + '</p>'
    + '</div></div>'
    + '</body></html>';
}

function buildPersonIcal(person, assignments) {
  // Build a .ics file with one VEVENT per assignment
  var pad = function(n) { return String(n).padStart(2, '0'); };
  var now = new Date();
  var stamp = now.getUTCFullYear() + pad(now.getUTCMonth()+1) + pad(now.getUTCDate())
            + 'T' + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';
  var lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Timothy Lutheran Church//Worship Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  assignments.forEach(function(a, i) {
    var dISO = a.dateISO || '';   // "YYYY-MM-DD"
    if (!dISO) return;
    var dtStr = dISO.replace(/-/g, '');
    var startH, startM, endH, endM;
    if (a.svc === '10:45am') { startH = 10; startM = 45; endH = 12; endM =  0; }
    else if (a.svc === '8am'){ startH =  8; startM =  0; endH =  9; endM = 15; }
    else                     { startH =  8; startM =  0; endH = 12; endM =  0; } // both
    var dtStart = dtStr + 'T' + pad(startH) + pad(startM) + '00';
    var dtEnd   = dtStr + 'T' + pad(endH)   + pad(endM)   + '00';
    var svcLabel = a.svc === 'both services' ? 'Both Services' : a.svc;
    var uid = 'tlc-worship-' + dISO + '-' + a.role.replace(/\\s+/g,'-') + '-' + i + '@tlc';
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + uid);
    lines.push('DTSTAMP:' + stamp);
    lines.push('DTSTART;TZID=America/Chicago:' + dtStart);
    lines.push('DTEND;TZID=America/Chicago:' + dtEnd);
    lines.push('SUMMARY:Worship - ' + roleLabel(a.role) + ' (' + svcLabel + ')');
    lines.push('DESCRIPTION:You are scheduled to serve as ' + roleLabel(a.role)
               + ' (' + svcLabel + ') at Timothy Lutheran Church on ' + a.date + '.');
    lines.push('LOCATION:Timothy Lutheran Church');
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\\r\\n');
}

function sendReminderEmails() {
  var s = getBreezeSettings();
  if (!_embedded && (!s.resendKey || !s.emailFrom)) {
    alert('Please configure your Resend API key and From address in the Settings tab first.');
    return;
  }
  if (!currentSchedule.length) {
    alert('Generate a schedule first.');
    return;
  }

  var people = getPeople();
  var pMap = {};
  people.forEach(function(p){ pMap[p.id] = p; });

  // Build person → assignments map from entire schedule (include dateISO for iCal + RSVP)
  var personAssignments = {};  // { personId: [{ date, dateISO, svc, role }, ...] }
  currentSchedule.forEach(function(row) {
    if (row.type !== 'sunday') return;
    var dateStr = fmtDate(row.date);
    var dateISO = row.date.toISOString().slice(0, 10);
    PER_ROLES.forEach(function(role) {
      ['8am','10:45am'].forEach(function(svc) {
        var pid = row.assignments[role][svc];
        if (!pid) return;
        if (!personAssignments[pid]) personAssignments[pid] = [];
        personAssignments[pid].push({ date: dateStr, dateISO: dateISO, svc: svc, role: role });
      });
    });
    SHARED_ROLES.forEach(function(role) {
      var pid = row.assignments[role].shared;
      if (!pid) return;
      if (!personAssignments[pid]) personAssignments[pid] = [];
      personAssignments[pid].push({ date: dateStr, dateISO: dateISO, svc: 'both services', role: role });
    });
  });

  var statusEl = document.getElementById('email-send-status');
  var pids = Object.keys(personAssignments);
  if (!pids.length) { statusEl.textContent = 'No assignments to send.'; return; }

  var total = 0, sent = 0, skipped = 0, errors = 0;
  pids.forEach(function(pid) {
    if (pMap[pid] && pMap[pid].email) total++;
    else skipped++;
  });
  if (!total) {
    statusEl.textContent = 'No people with email addresses — add emails in the People tab.';
    return;
  }
  statusEl.textContent = 'Sending 0 of ' + total + '…';

  // Generate / persist RSVP tokens (one per person, stable across re-sends)
  var rsvpTokens = getRsvpTokens();
  pids.forEach(function(pid) {
    if (pMap[pid] && pMap[pid].email && !rsvpTokens[pid]) {
      rsvpTokens[pid] = Math.random().toString(36).slice(2)
                      + Math.random().toString(36).slice(2)
                      + Date.now().toString(36);
    }
  });
  saveRsvpTokens(rsvpTokens);

  var chain = Promise.resolve();
  pids.forEach(function(pid) {
    var person = pMap[pid];
    if (!person || !person.email) return;
    var assignments = personAssignments[pid];
    var token = rsvpTokens[pid] || '';

    // Build plain-text email body
    var lines = [
      'Hello ' + person.name + ',',
      '',
      'Here are your upcoming worship service assignments at Timothy Lutheran Church:',
      ''
    ];
    assignments.forEach(function(a) {
      var svcLabel = a.svc === 'both services' ? 'Both Services' : a.svc;
      lines.push('  \\u2022 ' + a.date + ' \\u2014 ' + svcLabel + ': ' + roleLabel(a.role));
    });
    // Add readings for Lectors and Liturgists
    var hasReadings = false;
    assignments.forEach(function(a) {
      var role = (a.role || '').toLowerCase();
      var isLector = role === 'lector';
      var isLiturgist = role === 'liturgist';
      if (!isLector && !isLiturgist) return;
      var rd = a.dateISO ? getReadingsForDate(a.dateISO) : null;
      if (!rd) return;
      if (!hasReadings) { lines.push('', 'Your Readings:'); hasReadings = true; }
      var svcLabel = a.svc === 'both services' ? 'Both Services' : a.svc;
      lines.push('', '  ' + a.date + ' \\u2014 ' + svcLabel + ' (' + roleLabel(a.role) + ')');
      if (isLector) {
        if (rd.ot)      lines.push('    OT: ' + rd.ot);
        if (rd.epistle) lines.push('    Epistle: ' + rd.epistle);
      } else {
        if (rd.gospel) lines.push('    Gospel: ' + rd.gospel);
        if (rd.psalm)  lines.push('    Psalm: ' + rd.psalm);
      }
    });
    var _rsvpBase = s.workerUrl || (typeof window !== 'undefined' ? window.location.origin : '');
    if (token && _rsvpBase) {
      lines.push(
        '',
        'Please confirm your availability by clicking one of the links below:',
        '  \\u2713 Yes, I\\'ll be there: ' + _rsvpBase + '/rsvp?token=' + encodeURIComponent(token) + '&status=confirmed',
        '  \\u26a0 I need a change:  ' + _rsvpBase + '/rsvp?token=' + encodeURIComponent(token) + '&status=needs_changes'
      );
    }
    lines.push(
      '',
      'A calendar attachment (.ics) is included \\u2014 add it to your calendar to be reminded on each Sunday you serve.',
      '',
      'Thank you for serving!',
      '',
      'Timothy Lutheran Church'
    );

    // Build iCal attachment (base64)
    var icalContent = buildPersonIcal(person, assignments);
    var icalB64 = btoa(unescape(encodeURIComponent(icalContent)));

    // Store token in Worker KV before sending
    chain = chain.then(function() {
      var storePromise = (token && (s.workerUrl || _embedded))
        ? fetch(s.workerUrl + '/rsvp/store', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, s.workerSecret ? { 'X-Worker-Secret': s.workerSecret } : {}),
            body: JSON.stringify({
              token:       token,
              name:        person.name,
              personId:    person.id,
              assignments: assignments.map(function(a) {
                return { date: a.date, dateISO: a.dateISO, svc: a.svc, role: a.role };
              }),
            }),
          }).catch(function() { /* non-fatal if KV store fails */ })
        : Promise.resolve();

      return storePromise.then(function() {
        return fetch(s.workerUrl + '/email/send', {
          method: 'POST',
          headers: Object.assign({
            'X-Resend-Key':  s.resendKey || '',
            'X-Email-From':  s.emailFrom || '',
            'Content-Type':  'application/json',
          }, s.workerSecret ? { 'X-Worker-Secret': s.workerSecret } : {}),
          body: JSON.stringify({
            to:       person.email,
            subject:  'Your Upcoming Worship Service Assignments \\u2014 Timothy Lutheran',
            text:     lines.join('\\n'),
            html:     buildHtmlEmail(person, assignments, s.replyTo || '', token, _rsvpBase),
            reply_to: s.replyTo || '',
            attachments: [{
              filename: 'worship-schedule.ics',
              content:  icalB64,
            }],
          }),
        })
          .then(function(r) {
            var ok = r.ok, status = r.status;
            return r.json().then(function(body) { return { ok: ok, status: status, body: body }; });
          })
          .then(function(res) {
            if (res.ok) {
              sent++;
              statusEl.textContent = 'Sent ' + sent + ' of ' + total + '\\u2026';
            } else {
              errors++;
              var msg = (res.body && (res.body.message || res.body.error || res.body.name))
                ? (res.body.message || res.body.error || res.body.name)
                : JSON.stringify(res.body);
              statusEl.textContent = '\\u00d7 ' + esc(person.name) + ' (error ' + res.status + '): ' + esc(msg);
            }
          })
          .catch(function(e) {
            errors++;
            statusEl.textContent = '\\u00d7 Network error sending to ' + esc(person.name) + ': ' + esc(String(e));
          });
      });
    });
  });

  chain.then(function() {
    if (errors > 0) {
      statusEl.textContent += ' (' + sent + ' sent, ' + errors + ' failed)';
    } else {
      statusEl.textContent = '\\u2713 Done \\u2014 ' + sent + ' email' + (sent !== 1 ? 's' : '') + ' sent'
        + (skipped ? ', ' + skipped + ' skipped (no email address)' : '') + '.';
    }
  });
}

document.getElementById('btn-send-emails').addEventListener('click', openReminderPanel);

// ══════════════════════════════════════════════════════════════════
// SENT-EMAIL BANNER HELPERS
// ══════════════════════════════════════════════════════════════════

function _fmtSentTime(isoStr) {
  var d = new Date(isoStr);
  var now = new Date();
  var diffMs = now - d;
  var diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 2)  return 'just now';
  if (diffMins < 60) return diffMins + ' minutes ago';
  var diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return diffHours + ' hour' + (diffHours !== 1 ? 's' : '') + ' ago';
  var diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 14) return diffDays + ' days ago';
  return d.toLocaleDateString();
}

function renderReminderSentBanner(weekISO) {
  var bannerEl = document.getElementById('reminder-sent-banner');
  if (!bannerEl) return;
  var log = getEmailSentLog();
  var entry = log['reminder_' + weekISO];
  if (!entry) { bannerEl.style.display = 'none'; bannerEl.innerHTML = ''; return; }
  bannerEl.style.display = '';
  bannerEl.innerHTML = '<div style="background:var(--pale-gold);border:1px solid var(--amber);border-radius:6px;padding:8px 12px;font-size:0.82rem;color:var(--on-pale-gold);margin-bottom:10px;">'
    + '&#9888; Assignment emails last sent <strong>' + _fmtSentTime(entry.sentAt) + '</strong>'
    + ' (' + entry.count + ' email' + (entry.count !== 1 ? 's' : '') + ').'
    + ' Sending again will re-email all selected volunteers.'
    + '</div>';
}

function renderNotifySentBanner(weekISO) {
  var bannerEl = document.getElementById('notify-sent-banner');
  if (!bannerEl) return;
  var log = getEmailSentLog();
  var logKey = (!weekISO || weekISO === 'all') ? 'notify_all' : 'notify_' + weekISO;
  var entry = log[logKey];
  if (!entry) { bannerEl.style.display = 'none'; bannerEl.innerHTML = ''; return; }
  bannerEl.style.display = '';
  bannerEl.innerHTML = '<div style="background:var(--pale-gold);border:1px solid var(--amber);border-radius:6px;padding:8px 12px;font-size:0.82rem;color:var(--on-pale-gold);margin-bottom:10px;">'
    + '&#9888; Volunteer requests last sent <strong>' + _fmtSentTime(entry.sentAt) + '</strong>'
    + ' (' + entry.count + ' email' + (entry.count !== 1 ? 's' : '') + ').'
    + ' Sending again will re-email all selected volunteers.'
    + '</div>';
}

// ══════════════════════════════════════════════════════════════════
// REMINDER EMAILS PANEL — week-filtered schedule reminders
// ══════════════════════════════════════════════════════════════════
var _reminderAssignmentsCache = {};

function openReminderPanel() {
  if (!currentSchedule.length) {
    alert('Generate a schedule first.');
    return;
  }
  var people = getPeople();
  var pMap = {};
  people.forEach(function(p){ pMap[p.id] = p; });

  // Build full person→assignments map across all Sundays
  var allPA = {};
  currentSchedule.forEach(function(row) {
    if (row.type !== 'sunday') return;
    var dateStr = fmtDate(row.date);
    var dateISO = row.date.toISOString().slice(0, 10);
    PER_ROLES.forEach(function(role) {
      ['8am','10:45am'].forEach(function(svc) {
        var pid = row.assignments[role] && row.assignments[role][svc];
        if (!pid) return;
        if (!allPA[pid]) allPA[pid] = [];
        allPA[pid].push({ date: dateStr, dateISO: dateISO, svc: svc, role: role });
      });
    });
    SHARED_ROLES.forEach(function(role) {
      var pid = row.assignments[role] && row.assignments[role].shared;
      if (!pid) return;
      if (!allPA[pid]) allPA[pid] = [];
      allPA[pid].push({ date: dateStr, dateISO: dateISO, svc: 'both services', role: role });
    });
  });

  // Unique Sundays that have at least one assignment
  var seenDates = {};
  var sundayOptions = [];
  Object.keys(allPA).forEach(function(pid) {
    allPA[pid].forEach(function(a) {
      if (!seenDates[a.dateISO]) {
        seenDates[a.dateISO] = true;
        sundayOptions.push({ iso: a.dateISO, label: a.date });
      }
    });
  });
  sundayOptions.sort(function(a,b){ return a.iso < b.iso ? -1 : 1; });

  if (!sundayOptions.length) {
    alert('No assignments found in the schedule.');
    return;
  }

  _reminderAssignmentsCache = allPA;

  var filterWrap = document.getElementById('reminder-week-filter-wrap');
  var filterSel  = document.getElementById('reminder-week-filter');
  var optsHtml   = '';
  sundayOptions.forEach(function(o) {
    var count = Object.keys(allPA).filter(function(pid) {
      return allPA[pid].some(function(a){ return a.dateISO === o.iso; });
    }).length;
    optsHtml += '<option value="' + esc(o.iso) + '">' + esc(o.label)
      + ' (' + count + ' volunteer' + (count !== 1 ? 's' : '') + ')</option>';
  });
  filterSel.innerHTML = optsHtml;
  filterWrap.style.display = '';

  var todayIso = new Date().toISOString().slice(0, 10);
  var nextUp = sundayOptions.find(function(o){ return o.iso >= todayIso; });
  filterSel.value = nextUp ? nextUp.iso : sundayOptions[0].iso;

  document.getElementById('reminder-send-status').textContent = '';
  renderReminderSentBanner(filterSel.value);
  renderReminderList(filterSel.value);
  openPanel('reminder-panel');
}

function renderReminderList(weekFilter) {
  var people = getPeople();
  var pMap = {};
  people.forEach(function(p){ pMap[p.id] = p; });

  var assignedPids = Object.keys(_reminderAssignmentsCache).filter(function(pid) {
    return _reminderAssignmentsCache[pid].some(function(a){ return a.dateISO === weekFilter; });
  });

  var listEl    = document.getElementById('reminder-person-list');
  var actionsEl = document.getElementById('reminder-actions');

  if (!assignedPids.length) {
    listEl.innerHTML = '<p style="color:var(--warm-gray);font-size:.88rem;margin-top:6px;">No volunteers assigned for this week.</p>';
    actionsEl.style.display = 'none';
    return;
  }

  var html = '<table style="width:100%;border-collapse:collapse;font-size:0.84rem;">'
    + '<thead><tr style="background:var(--blue-mist);">'
    + '<th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--steel-anchor);width:28px;"></th>'
    + '<th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--steel-anchor);">Volunteer</th>'
    + '<th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--steel-anchor);">Role(s) this Sunday</th>'
    + '</tr></thead><tbody>';

  assignedPids.forEach(function(pid, rowIdx) {
    var person = pMap[pid];
    if (!person) return;
    var weekA  = _reminderAssignmentsCache[pid].filter(function(a){ return a.dateISO === weekFilter; });
    var hasEmail = !!(person.email);
    var rowBg    = rowIdx % 2 === 0 ? '' : 'background:#fafaf8;';
    var roleText = weekA.map(function(a) {
      return roleLabel(a.role) + ' (' + (a.svc === 'both services' ? 'Both' : a.svc) + ')';
    }).join(', ');
    html += '<tr style="' + rowBg + 'border-bottom:1px solid var(--border);">'
      + '<td style="padding:7px 8px;vertical-align:middle;">'
      + (hasEmail
          ? '<input type="checkbox" class="reminder-person-cb" data-pid="' + esc(pid) + '" data-week="' + esc(weekFilter) + '" checked style="margin:0;">'
          : '<input type="checkbox" disabled style="margin:0;opacity:0.35;" title="No email address">')
      + '</td>'
      + '<td style="padding:7px 8px;vertical-align:top;">'
      + esc(person.name)
      + (!hasEmail ? ' <span style="font-size:0.72rem;color:var(--warm-gray);">(no email)</span>' : '')
      + '</td>'
      + '<td style="padding:7px 8px;vertical-align:top;font-size:0.8rem;color:var(--warm-gray);">' + esc(roleText) + '</td>'
      + '</tr>';
  });
  html += '</tbody></table>';

  listEl.innerHTML = html;
  actionsEl.style.display = '';
}

function _sendWeekReminders() {
  var s = getBreezeSettings();
  if (!_embedded && (!s.resendKey || !s.emailFrom)) {
    alert('Please configure your Resend API key and From address in the Settings tab first.');
    return;
  }
  var people = getPeople();
  var pMap = {};
  people.forEach(function(p){ pMap[p.id] = p; });

  var statusEl = document.getElementById('reminder-send-status');
  var sendBtn  = document.getElementById('btn-reminder-send');

  var currentWeekISO = document.getElementById('reminder-week-filter').value;
  var tasks = [];
  document.querySelectorAll('.reminder-person-cb:checked').forEach(function(cb) {
    var pid  = cb.getAttribute('data-pid');
    var week = cb.getAttribute('data-week');
    var person = pMap[pid];
    if (!person || !person.email) return;
    var weekA = (_reminderAssignmentsCache[pid] || []).filter(function(a){ return a.dateISO === week; });
    if (!weekA.length) return;
    tasks.push({ person: person, assignments: weekA });
  });

  if (!tasks.length) {
    statusEl.textContent = 'No people selected.';
    return;
  }

  var total = tasks.length, sent = 0, errors = 0;
  statusEl.textContent = 'Sending 0 of ' + total + '\\u2026';
  sendBtn.disabled = true;

  var rsvpTokens = getRsvpTokens();
  tasks.forEach(function(t) {
    if (!rsvpTokens[t.person.id]) {
      rsvpTokens[t.person.id] = Math.random().toString(36).slice(2)
                               + Math.random().toString(36).slice(2)
                               + Date.now().toString(36);
    }
  });
  saveRsvpTokens(rsvpTokens);

  var chain = Promise.resolve();
  tasks.forEach(function(task) {
    var person      = task.person;
    var assignments = task.assignments;
    var token       = rsvpTokens[person.id] || '';
    var _rsvpBase   = s.workerUrl || (typeof window !== 'undefined' ? window.location.origin : '');

    var lines = [
      'Hello ' + person.name + ',',
      '',
      'This is a reminder of your worship service assignment this Sunday at Timothy Lutheran Church:',
      ''
    ];
    assignments.forEach(function(a) {
      var svcLabel = a.svc === 'both services' ? 'Both Services' : a.svc;
      lines.push('  \\u2022 ' + a.date + ' \\u2014 ' + svcLabel + ': ' + roleLabel(a.role));
    });
    // Readings for Lectors / Liturgists
    var hasReadings = false;
    assignments.forEach(function(a) {
      var role = (a.role || '').toLowerCase();
      if (role !== 'lector' && role !== 'liturgist') return;
      var rd = a.dateISO ? getReadingsForDate(a.dateISO) : null;
      if (!rd) return;
      if (!hasReadings) { lines.push('', 'Your Readings:'); hasReadings = true; }
      var svcLabel = a.svc === 'both services' ? 'Both Services' : a.svc;
      lines.push('', '  ' + a.date + ' \\u2014 ' + svcLabel + ' (' + roleLabel(a.role) + ')');
      if (role === 'lector') {
        if (rd.ot)      lines.push('    OT: ' + rd.ot);
        if (rd.epistle) lines.push('    Epistle: ' + rd.epistle);
      } else {
        if (rd.gospel) lines.push('    Gospel: ' + rd.gospel);
        if (rd.psalm)  lines.push('    Psalm: ' + rd.psalm);
      }
    });
    if (token && _rsvpBase) {
      lines.push(
        '',
        'Please confirm your availability:',
        '  \\u2713 Yes, I\\'ll be there: ' + _rsvpBase + '/rsvp?token=' + encodeURIComponent(token) + '&status=confirmed',
        '  \\u26a0 I need a change:  ' + _rsvpBase + '/rsvp?token=' + encodeURIComponent(token) + '&status=needs_changes'
      );
    }
    lines.push('', 'Thank you for serving!', '', 'Timothy Lutheran Church');

    var icalContent = buildPersonIcal(person, assignments);
    var icalB64     = btoa(unescape(encodeURIComponent(icalContent)));

    chain = chain.then(function() {
      var storePromise = (token && (s.workerUrl || _embedded))
        ? fetch(s.workerUrl + '/rsvp/store', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, s.workerSecret ? { 'X-Worker-Secret': s.workerSecret } : {}),
            body: JSON.stringify({
              token: token, name: person.name, personId: person.id,
              assignments: assignments.map(function(a){
                return { date: a.date, dateISO: a.dateISO, svc: a.svc, role: a.role };
              }),
            }),
          }).catch(function(){})
        : Promise.resolve();

      return storePromise.then(function() {
        return fetch(s.workerUrl + '/email/send', {
          method: 'POST',
          headers: Object.assign({
            'X-Resend-Key': s.resendKey || '',
            'X-Email-From': s.emailFrom || '',
            'Content-Type': 'application/json',
          }, s.workerSecret ? { 'X-Worker-Secret': s.workerSecret } : {}),
          body: JSON.stringify({
            to:          person.email,
            subject:     'Worship Service Reminder \\u2014 ' + assignments[0].date + ' \\u2014 Timothy Lutheran',
            text:        lines.join('\\n'),
            html:        buildHtmlEmail(person, assignments, s.replyTo || '', token, _rsvpBase),
            reply_to:    s.replyTo || '',
            attachments: [{ filename: 'worship-schedule.ics', content: icalB64 }],
          }),
        })
          .then(function(r) {
            var ok = r.ok, status = r.status;
            return r.json().then(function(body){ return { ok: ok, status: status, body: body }; });
          })
          .then(function(res) {
            if (res.ok) {
              sent++;
              statusEl.textContent = 'Sent ' + sent + ' of ' + total + '\\u2026';
            } else {
              errors++;
              var msg = res.body && (res.body.message || res.body.error || res.body.name)
                ? (res.body.message || res.body.error || res.body.name)
                : JSON.stringify(res.body);
              statusEl.textContent = '\\u00d7 ' + esc(person.name) + ' (error ' + res.status + '): ' + esc(msg);
            }
          })
          .catch(function(e) {
            errors++;
            statusEl.textContent = '\\u00d7 Network error: ' + esc(String(e));
          });
      });
    });
  });

  chain.then(function() {
    sendBtn.disabled = false;
    if (!errors) {
      statusEl.textContent = '\\u2713 Done \\u2014 ' + sent + ' email' + (sent !== 1 ? 's' : '') + ' sent.';
      if (sent > 0 && currentWeekISO) {
        var log = getEmailSentLog();
        var existing = log['reminder_' + currentWeekISO] || {};
        var existingPids = existing.pids || [];
        var newPids = tasks.map(function(t){ return t.person.id; });
        var mergedPids = existingPids.slice();
        newPids.forEach(function(id){ if (mergedPids.indexOf(id) === -1) mergedPids.push(id); });
        log['reminder_' + currentWeekISO] = { sentAt: new Date().toISOString(), count: mergedPids.length, pids: mergedPids };
        saveEmailSentLog(log);
        renderReminderSentBanner(currentWeekISO);
        renderTable(getPeople(), null);
      }
    } else {
      statusEl.textContent += ' (' + sent + ' sent, ' + errors + ' failed)';
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// SYNC CONFIRMATIONS — pull RSVP statuses from Worker KV
// ══════════════════════════════════════════════════════════════════
function syncConfirmations(silent) {
  var s = getBreezeSettings();
  if (!_embedded && !s.workerUrl) {
    if (!silent) alert('Configure your Worker URL in the Settings tab first.');
    return;
  }
  var rsvpTokens = getRsvpTokens();                   // { pid: token }
  var tokenList  = Object.keys(rsvpTokens).map(function(pid) { return rsvpTokens[pid]; }).filter(Boolean);
  var statusEl   = document.getElementById('email-send-status');
  if (!tokenList.length) {
    if (!silent) statusEl.textContent = 'No RSVP tokens found \\u2014 send reminder emails first.';
    return;
  }
  if (!silent) statusEl.textContent = 'Syncing confirmations\\u2026';

  fetch(s.workerUrl + '/rsvp/sync', {
    method:  'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, s.workerSecret ? { 'X-Worker-Secret': s.workerSecret } : {}),
    body:    JSON.stringify({ tokens: tokenList }),
  })
    .then(function(r) { return r.json(); })
    .then(function(results) {
      // results: { token: { status, name, updatedAt } }
      // Build reverse map: token → pid
      var tokenToPid = {};
      Object.keys(rsvpTokens).forEach(function(pid) { tokenToPid[rsvpTokens[pid]] = pid; });

      var confs   = getConfirmations();
      var updated = 0;

      Object.keys(results).forEach(function(token) {
        var pid    = tokenToPid[token];
        if (!pid) return;
        var result = results[token];

        // ── Per-assignment sync (preferred) ───────────────────────
        // The Worker now returns assignments[] each with their own status.
        // Map each assignment's dateISO+svc+role → confKey and update.
        if (result.assignments && result.assignments.length) {
          result.assignments.forEach(function(a) {
            if (!a.dateISO) return;
            var localStatus = a.status === 'confirmed'     ? 'confirmed'
                            : a.status === 'needs_changes' ? 'needs_changes'
                            : 'pending';
            if (localStatus === 'pending') return; // leave pending pills alone
            // confKey uses 'shared' for both-services slots, not 'both services'
            var svcKey = a.svc === 'both services' ? 'shared' : a.svc;
            var key    = a.dateISO + '|' + a.role + '|' + svcKey;
            if (confs[key] !== localStatus) { confs[key] = localStatus; updated++; }
          });

        } else {
          // ── Fallback: use overall status for all slots (older tokens) ──
          var workerStatus = result.status;
          var localStatus  = workerStatus === 'confirmed'     ? 'confirmed'
                           : workerStatus === 'needs_changes' ? 'needs_changes'
                           : 'pending';
          if (localStatus === 'pending') return;
          currentSchedule.forEach(function(row) {
            var dateISO = row.date.toISOString().slice(0, 10);
            PER_ROLES.forEach(function(role) {
              ['8am','10:45am'].forEach(function(svc) {
                if (row.assignments[role][svc] === pid) {
                  var key = dateISO + '|' + role + '|' + svc;
                  if (confs[key] !== localStatus) { confs[key] = localStatus; updated++; }
                }
              });
            });
            SHARED_ROLES.forEach(function(role) {
              if (row.assignments[role].shared === pid) {
                var key = dateISO + '|' + role + '|shared';
                if (confs[key] !== localStatus) { confs[key] = localStatus; updated++; }
              }
            });
          });
        }
      });

      saveConfirmations(confs);

      // Re-render confirmation pills without rebuilding the whole table
      if (currentSchedule.length) {
        var people = getPeople();
        var counts = {};
        people.forEach(function(p) { counts[p.id] = 0; });
        renderTable(people, counts);
      }

      if (!silent) statusEl.textContent = '\\u2713 Synced \\u2014 '
        + updated + ' assignment' + (updated !== 1 ? 's' : '') + ' updated.';
    })
    .catch(function(e) {
      if (!silent) statusEl.textContent = '\\u00d7 Sync failed: ' + esc(String(e));
    });
}

document.getElementById('btn-sync-confirmations').addEventListener('click', syncConfirmations);

// ══════════════════════════════════════════════════════════════════
// RE-STORE TOKENS — push existing tokens to Worker KV without
// re-sending any emails (use when KV was set up after first send)
// ══════════════════════════════════════════════════════════════════
function restoreRsvpTokens() {
  var s = getBreezeSettings();
  if (!_embedded && !s.workerUrl) { alert('Configure your Worker URL in Settings first.'); return; }
  var rsvpTokens = getRsvpTokens();
  var people = getPeople();
  var pMap = {};
  people.forEach(function(p) { pMap[p.id] = p; });

  // Rebuild personAssignments from currentSchedule
  var personAssignments = {};
  currentSchedule.forEach(function(row) {
    if (row.type !== 'sunday') return;
    var dateStr = fmtDate(row.date);
    var dateISO = row.date.toISOString().slice(0, 10);
    PER_ROLES.forEach(function(role) {
      ['8am','10:45am'].forEach(function(svc) {
        var pid = row.assignments[role][svc];
        if (!pid) return;
        if (!personAssignments[pid]) personAssignments[pid] = [];
        personAssignments[pid].push({ date: dateStr, dateISO: dateISO, svc: svc, role: role });
      });
    });
    SHARED_ROLES.forEach(function(role) {
      var pid = row.assignments[role].shared;
      if (!pid) return;
      if (!personAssignments[pid]) personAssignments[pid] = [];
      personAssignments[pid].push({ date: dateStr, dateISO: dateISO, svc: 'both services', role: role });
    });
  });

  var pids = Object.keys(rsvpTokens);
  if (!pids.length) {
    document.getElementById('email-send-status').textContent = 'No tokens found \\u2014 send reminder emails first.';
    return;
  }

  var statusEl = document.getElementById('email-send-status');
  statusEl.textContent = 'Re-storing tokens\\u2026';
  var done = 0, errors = 0;

  var chain = Promise.resolve();
  pids.forEach(function(pid) {
    var person = pMap[pid];
    var token  = rsvpTokens[pid];
    if (!person || !token) return;
    chain = chain.then(function() {
      return fetch(s.workerUrl + '/rsvp/store', {
        method:  'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, s.workerSecret ? { 'X-Worker-Secret': s.workerSecret } : {}),
        body: JSON.stringify({
          token:       token,
          name:        person.name,
          personId:    person.id,
          assignments: (personAssignments[pid] || []).map(function(a) {
            return { date: a.date, dateISO: a.dateISO, svc: a.svc, role: a.role };
          }),
        }),
      })
        .then(function(r) { if (r.ok) done++; else errors++; })
        .catch(function()  { errors++; });
    });
  });

  chain.then(function() {
    statusEl.textContent = errors
      ? '\\u00d7 Re-stored ' + done + ', failed ' + errors + '. Check Worker KV binding in Cloudflare.'
      : '\\u2713 Re-stored ' + done + ' token' + (done !== 1 ? 's' : '') + ' \\u2014 existing email links will now work.';
  });
}

// ══════════════════════════════════════════════════════════════════
// NOTIFY ELIGIBLE VOLUNTEERS — targeted emails for unfilled slots
// ══════════════════════════════════════════════════════════════════
function getOpenSlots() {
  var people = getPeople();
  var confs = getConfirmations();
  var slots = [];
  currentSchedule.forEach(function(row) {
    if (row.type !== 'sunday') return;
    var dateStr = fmtDate(row.date);
    var dateISO = row.date.toISOString().slice(0, 10);
    var ordinal = row.ordinal;
    PER_ROLES.forEach(function(role) {
      if (!row.assignments[role]) return;
      ['8am', '10:45am'].forEach(function(svc) {
        var pid = row.assignments[role][svc];
        var declined = pid && confs[dateISO+'|'+role+'|'+svc] === 'declined';
        if (pid && !declined) return; // filled and not declined
        var pool = people.filter(function(p) {
          return p.roles && p.roles.indexOf(role) !== -1 && eligible(p, ordinal, svc, dateISO, role);
        });
        slots.push({ date: dateStr, dateISO: dateISO, ordinal: ordinal, svc: svc, role: role, pool: pool, declined: declined });
      });
    });
    SHARED_ROLES.forEach(function(role) {
      if (!row.assignments[role]) return;
      var pid = row.assignments[role].shared;
      var declined = pid && confs[dateISO+'|'+role+'|shared'] === 'declined';
      if (pid && !declined) return; // filled and not declined
      var pool = people.filter(function(p) {
        return p.roles && p.roles.indexOf(role) !== -1 && eligible(p, ordinal, 'shared', dateISO, role);
      });
      slots.push({ date: dateStr, dateISO: dateISO, ordinal: ordinal, svc: 'both services', role: role, pool: pool, declined: declined });
    });
  });
  return slots;
}

function openNotifyPanel() {
  if (!currentSchedule.length) {
    alert('Generate a schedule first.');
    return;
  }
  var slots = getOpenSlots();
  var listEl = document.getElementById('notify-slots-list');
  var actionsEl = document.getElementById('notify-actions');
  var alertEl = document.getElementById('notify-alert');
  var filterWrap = document.getElementById('notify-week-filter-wrap');
  var filterSel  = document.getElementById('notify-week-filter');
  alertEl.innerHTML = '';
  document.getElementById('notify-send-status').textContent = '';

  if (!slots.length) {
    listEl.innerHTML = '<p style="color:var(--sage);font-size:.88rem;">&#10003; All slots are filled for this month!</p>';
    actionsEl.style.display = 'none';
    filterWrap.style.display = 'none';
    openPanel('notify-panel');
    return;
  }

  // Build the week-picker dropdown from unique Sundays present in the open-slots list.
  // (Special services are excluded from getOpenSlots, so we only deal with Sundays here.)
  var seenDates = {};
  var sundayOptions = [];
  slots.forEach(function(s){
    if (seenDates[s.dateISO]) return;
    seenDates[s.dateISO] = true;
    sundayOptions.push({ iso: s.dateISO, label: s.date });
  });
  sundayOptions.sort(function(a,b){ return a.iso < b.iso ? -1 : 1; });
  var optsHtml = '<option value="all">All weeks (' + slots.length + ' open)</option>';
  sundayOptions.forEach(function(o){
    var count = slots.filter(function(s){ return s.dateISO === o.iso; }).length;
    optsHtml += '<option value="' + esc(o.iso) + '">' + esc(o.label) + ' (' + count + ' open)</option>';
  });
  filterSel.innerHTML = optsHtml;
  filterWrap.style.display = '';

  // Default selection: the next upcoming Sunday with open slots (≥ today),
  // or fall back to "all" if none.
  var todayIso = new Date().toISOString().slice(0, 10);
  var nextUp = sundayOptions.find(function(o){ return o.iso >= todayIso; });
  filterSel.value = nextUp ? nextUp.iso : 'all';

  // Cache slots so the change handler doesn't re-scan currentSchedule
  _notifySlotsCache = slots;
  renderNotifySentBanner(filterSel.value);
  renderNotifySlots(filterSel.value);
  openPanel('notify-panel');
}

var _notifySlotsCache = [];

function renderNotifySlots(weekFilter) {
  // Build displaySlots as { slot, idx } pairs so data-slot-idx always refers to
  // the cache, not the filtered view — sendVolunteerNotifications relies on
  // those cache indices.
  var displaySlots = _notifySlotsCache.map(function(s, i){ return { slot: s, idx: i }; });
  if (weekFilter && weekFilter !== 'all') {
    displaySlots = displaySlots.filter(function(d){ return d.slot.dateISO === weekFilter; });
  }
  var listEl = document.getElementById('notify-slots-list');
  var actionsEl = document.getElementById('notify-actions');

  if (!displaySlots.length) {
    listEl.innerHTML = '<p style="color:var(--sage);font-size:.88rem;margin-top:6px;">&#10003; No open slots for this week.</p>';
    actionsEl.style.display = 'none';
    return;
  }

  var html = '<table style="width:100%;border-collapse:collapse;font-size:0.84rem;">'
    + '<thead><tr style="background:var(--blue-mist);">'
    + '<th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--steel-anchor);width:28px;"></th>'
    + '<th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--steel-anchor);">Date</th>'
    + '<th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--steel-anchor);">Svc</th>'
    + '<th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--steel-anchor);">Role</th>'
    + '<th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--steel-anchor);">Eligible</th>'
    + '</tr></thead><tbody>';

  displaySlots.forEach(function(d, rowIdx) {
    var slot = d.slot;
    var cacheIdx = d.idx;
    var withEmail = slot.pool.filter(function(p) { return p.email; });
    var withoutEmail = slot.pool.filter(function(p) { return !p.email; });
    var eligibleHtml = '';
    if (!slot.pool.length) {
      eligibleHtml = '<span style="color:var(--warm-gray);font-style:italic;">None available</span>';
    } else {
      eligibleHtml = withEmail.map(function(p) {
        return '<span style="color:var(--steel-anchor);">' + esc(p.name) + '</span>';
      }).join(', ');
      if (withoutEmail.length) {
        if (withEmail.length) eligibleHtml += ', ';
        eligibleHtml += withoutEmail.map(function(p) {
          return '<span style="color:var(--warm-gray);" title="No email address">' + esc(p.name) + ' <span style="font-size:0.72rem;">(no email)</span></span>';
        }).join(', ');
      }
    }
    var canNotify = withEmail.length > 0;
    var rowBg = rowIdx % 2 === 0 ? '' : 'background:#fafaf8;';
    html += '<tr style="' + rowBg + 'border-bottom:1px solid var(--border);">'
      + '<td style="padding:7px 8px;vertical-align:top;">'
      + (canNotify
          ? '<input type="checkbox" class="notify-slot-cb" data-slot-idx="' + cacheIdx + '" checked style="margin:0;">'
          : '<input type="checkbox" disabled style="margin:0;opacity:0.35;" title="No eligible volunteers with email">')
      + '</td>'
      + '<td style="padding:7px 8px;vertical-align:top;white-space:nowrap;">' + esc(slot.date) + '</td>'
      + '<td style="padding:7px 8px;vertical-align:top;white-space:nowrap;">' + esc(slot.svc) + '</td>'
      + '<td style="padding:7px 8px;vertical-align:top;font-weight:600;">' + esc(roleLabel(slot.role))
      + (slot.declined ? ' <span style="font-size:0.72rem;font-weight:400;color:var(--on-error-bg);background:var(--error-bg);border:1px solid var(--error-border);border-radius:4px;padding:1px 5px;">\u2717 Declined</span>' : '')
      + '</td>'
      + '<td style="padding:7px 8px;vertical-align:top;font-size:0.8rem;">' + eligibleHtml + '</td>'
      + '</tr>';
  });
  html += '</tbody></table>';

  listEl.innerHTML = html;
  actionsEl.style.display = '';
}

function buildVolunteerRequestHtml(person, slot, replyTo) {
  var svcLabel = slot.svc === 'both services' ? 'Both Services' : slot.svc;
  var replyLink = replyTo
    ? '<a href="mailto:' + esc(replyTo) + '" style="color:#3D627C;">' + esc(replyTo) + '</a>'
    : '';
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head>'
    + '<body style="margin:0;padding:0;background:#EDF5F8;font-family:Arial,Helvetica,sans-serif;color:#3D3530;">'
    + '<div style="max-width:560px;margin:24px auto;">'
    + '<div style="background:#0A3C5C;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">'
    + '<div style="font-size:1.2rem;font-weight:700;">Timothy Lutheran Church</div>'
    + '<div style="font-size:0.85rem;opacity:0.8;margin-top:3px;">Worship Volunteer Request</div>'
    + '</div>'
    + '<div style="background:white;padding:24px;border:1px solid #E8E0D0;border-top:none;border-radius:0 0 8px 8px;">'
    + '<p style="margin:0 0 14px;">Hello ' + esc(person.name) + ',</p>'
    + '<p style="margin:0 0 16px;color:#444;">We still need a volunteer for the following worship service role and would love your help:</p>'
    + '<div style="background:#EDF5F8;border-left:4px solid #D4922A;border-radius:0 6px 6px 0;padding:14px 18px;margin-bottom:20px;">'
    + '<div style="font-size:1rem;font-weight:700;color:#0A3C5C;">' + esc(roleLabel(slot.role)) + '</div>'
    + '<div style="font-size:0.9rem;color:#3D3530;margin-top:4px;">' + esc(slot.date) + ' &mdash; ' + esc(svcLabel) + '</div>'
    + '</div>'
    + '<p style="margin:0 0 10px;font-size:0.9rem;">If you\\'re available and willing to serve, please reply to this email to let us know.</p>'
    + '<p style="margin:0 0 20px;font-size:0.9rem;">If this date doesn\\'t work, no worries \\u2014 we appreciate everything you do for our congregation!</p>'
    + '<p style="font-size:0.9rem;margin:0 0 6px;">Thank you for your faithful service!</p>'
    + '<p style="font-size:0.78rem;color:#7A6E60;margin:20px 0 0;padding-top:14px;border-top:1px solid #E8E0D0;">'
    + 'Timothy Lutheran Church'
    + (replyLink ? ' &mdash; Reply to: ' + replyLink : '')
    + '</p>'
    + '</div></div></body></html>';
}

function sendVolunteerNotifications() {
  var s = getBreezeSettings();
  if (!_embedded && (!s.resendKey || !s.emailFrom)) {
    alert('Please configure your Resend API key and From address in the Settings tab first.');
    return;
  }
  var notifyWeekISO = document.getElementById('notify-week-filter').value;
  // Use the cache that the panel was rendered from. data-slot-idx values
  // index into _notifySlotsCache, not a fresh getOpenSlots() result — those
  // could differ if the schedule changed since the panel opened.
  var slots = _notifySlotsCache.length ? _notifySlotsCache : getOpenSlots();
  var checkedIdxs = [];
  document.querySelectorAll('.notify-slot-cb:checked').forEach(function(cb) {
    checkedIdxs.push(parseInt(cb.getAttribute('data-slot-idx'), 10));
  });
  if (!checkedIdxs.length) {
    document.getElementById('notify-send-status').textContent = 'No slots selected.';
    return;
  }

  // Build list of (person, slot) pairs — deduplicate: one email per person per slot
  var tasks = [];
  var seen = {};
  checkedIdxs.forEach(function(idx) {
    var slot = slots[idx];
    slot.pool.filter(function(p) { return p.email; }).forEach(function(p) {
      var key = p.id + '|' + slot.dateISO + '|' + slot.svc + '|' + slot.role;
      if (!seen[key]) { seen[key] = true; tasks.push({ person: p, slot: slot }); }
    });
  });

  var statusEl = document.getElementById('notify-send-status');
  if (!tasks.length) {
    statusEl.textContent = 'No eligible volunteers with email addresses for the selected slots.';
    return;
  }

  var total = tasks.length, sent = 0, errors = 0;
  statusEl.textContent = 'Sending 0 of ' + total + '\\u2026';
  document.getElementById('btn-notify-send').disabled = true;

  var chain = Promise.resolve();
  tasks.forEach(function(task) {
    chain = chain.then(function() {
      var p = task.person, slot = task.slot;
      var svcLabel = slot.svc === 'both services' ? 'Both Services' : slot.svc;
      var subject = 'Volunteer needed: ' + roleLabel(slot.role) + ' on ' + slot.date + ' \\u2014 Timothy Lutheran';
      var textBody = [
        'Hello ' + p.name + ',',
        '',
        'We still need a volunteer for:',
        '  ' + roleLabel(slot.role) + ' \\u2014 ' + slot.date + ' (' + svcLabel + ')',
        '',
        'If you\\'re available, please reply to this email to let us know.',
        'If this date doesn\\'t work, no worries \\u2014 thank you for all you do!',
        '',
        'Timothy Lutheran Church',
      ].join('\\n');

      return fetch(s.workerUrl + '/email/send', {
        method: 'POST',
        headers: Object.assign({
          'X-Resend-Key':  s.resendKey || '',
          'X-Email-From':  s.emailFrom || '',
          'Content-Type':  'application/json',
        }, s.workerSecret ? { 'X-Worker-Secret': s.workerSecret } : {}),
        body: JSON.stringify({
          to:       p.email,
          subject:  subject,
          text:     textBody,
          html:     buildVolunteerRequestHtml(p, slot, s.replyTo || ''),
          reply_to: s.replyTo || '',
        }),
      })
        .then(function(r) {
          var ok = r.ok, status = r.status;
          return r.json().then(function(body) { return { ok: ok, status: status, body: body }; });
        })
        .then(function(res) {
          if (res.ok) {
            sent++;
            statusEl.textContent = 'Sent ' + sent + ' of ' + total + '\\u2026';
          } else {
            errors++;
            var msg = (res.body && (res.body.message || res.body.error || res.body.name))
              ? (res.body.message || res.body.error || res.body.name)
              : JSON.stringify(res.body);
            statusEl.textContent = '\\u00d7 ' + esc(p.name) + ' (error ' + res.status + '): ' + esc(msg);
          }
        })
        .catch(function(e) {
          errors++;
          statusEl.textContent = '\\u00d7 Network error sending to ' + esc(p.name) + ': ' + esc(String(e));
        });
    });
  });

  chain.then(function() {
    document.getElementById('btn-notify-send').disabled = false;
    if (errors > 0) {
      statusEl.textContent += ' (' + sent + ' sent, ' + errors + ' failed)';
    } else {
      statusEl.textContent = '\\u2713 Done \\u2014 ' + sent + ' notification' + (sent !== 1 ? 's' : '') + ' sent.';
      if (sent > 0 && notifyWeekISO) {
        var log = getEmailSentLog();
        var logKey = notifyWeekISO === 'all' ? 'notify_all' : 'notify_' + notifyWeekISO;
        log[logKey] = { sentAt: new Date().toISOString(), count: sent };
        saveEmailSentLog(log);
        renderNotifySentBanner(notifyWeekISO);
      }
    }
  });
}

document.getElementById('btn-close-reminder-panel').addEventListener('click', closeAllPanels);
document.getElementById('reminder-week-filter').addEventListener('change', function() {
  document.getElementById('reminder-send-status').textContent = '';
  renderReminderSentBanner(this.value);
  renderReminderList(this.value);
});
document.getElementById('btn-reminder-select-all').addEventListener('click', function() {
  document.querySelectorAll('.reminder-person-cb:not(:disabled)').forEach(function(cb){ cb.checked = true; });
});
document.getElementById('btn-reminder-deselect-all').addEventListener('click', function() {
  document.querySelectorAll('.reminder-person-cb:not(:disabled)').forEach(function(cb){ cb.checked = false; });
});
document.getElementById('btn-reminder-send').addEventListener('click', _sendWeekReminders);

document.getElementById('btn-notify-volunteers').addEventListener('click', openNotifyPanel);
document.getElementById('btn-close-notify-panel').addEventListener('click', closeAllPanels);
document.getElementById('btn-notify-select-all').addEventListener('click', function() {
  document.querySelectorAll('.notify-slot-cb:not(:disabled)').forEach(function(cb) { cb.checked = true; });
});
document.getElementById('btn-notify-deselect-all').addEventListener('click', function() {
  document.querySelectorAll('.notify-slot-cb:not(:disabled)').forEach(function(cb) { cb.checked = false; });
});
document.getElementById('btn-notify-send').addEventListener('click', sendVolunteerNotifications);
document.getElementById('notify-week-filter').addEventListener('change', function() {
  renderNotifySentBanner(this.value);
  renderNotifySlots(this.value);
});

// ══════════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════════
function loadSettingsForm() {
  var s = getBreezeSettings();
  if (s.subdomain)  document.getElementById('breeze-subdomain').value  = s.subdomain;
  if (s.apiKey)     document.getElementById('breeze-apikey').value     = s.apiKey;
  if (s.workerUrl)  document.getElementById('breeze-worker-url').value = s.workerUrl;
  var tagIds = (s.tagIds || []).join(', ');
  if (tagIds) document.getElementById('breeze-tag-ids').value = tagIds;
  if (s.resendKey)     document.getElementById('email-resend-key').value     = s.resendKey;
  if (s.emailFrom)     document.getElementById('email-from').value            = s.emailFrom;
  if (s.replyTo)       document.getElementById('email-reply-to').value        = s.replyTo;
  if (s.workerSecret)  document.getElementById('breeze-worker-secret').value  = s.workerSecret;
}

document.getElementById('btn-save-settings').addEventListener('click', function() {
  var subdomain     = document.getElementById('breeze-subdomain').value.trim().replace(/\\//g,'');
  var apiKey        = document.getElementById('breeze-apikey').value.trim();
  var workerUrl     = document.getElementById('breeze-worker-url').value.trim().replace(/\\/$/, '');
  var workerSecret  = document.getElementById('breeze-worker-secret').value.trim();
  var tagIds    = document.getElementById('breeze-tag-ids').value
                    .split(',').map(function(t){ return t.trim().replace(/\\D/g,''); }).filter(Boolean);
  var resendKey = document.getElementById('email-resend-key').value.trim();
  var emailFrom = document.getElementById('email-from').value.trim();
  var replyTo   = document.getElementById('email-reply-to').value.trim();
  if (!subdomain) { showAlert('settings-alert','Please enter your Breeze subdomain.','warning'); return; }
  saveBreezeSettings({ subdomain:subdomain, apiKey:apiKey, workerUrl:workerUrl, workerSecret:workerSecret, tagIds:tagIds, resendKey:resendKey, emailFrom:emailFrom, replyTo:replyTo });
  queueD1Push();
  showAlert('settings-alert','Settings saved!','success');
  document.getElementById('settings-status').textContent = '';
});

document.getElementById('btn-test-breeze').addEventListener('click', function() {
  var s = getBreezeSettings();
  if (!s.subdomain) { showAlert('settings-alert','Save your settings first.','warning'); return; }
  var statusEl = document.getElementById('settings-status');
  var testUrl = (s.workerUrl||'') + '/api/people?limit=1&details=0';
  statusEl.textContent = 'Testing… (→ '+testUrl+')';
  breezeGet('/api/people', { limit:1, details:0 })
    .then(function(data) {
      statusEl.innerHTML = '<span class="status-dot dot-ok"></span> Connected to Breeze!';
      showAlert('settings-alert','','');
    })
    .catch(function(err) {
      statusEl.innerHTML = '<span class="status-dot dot-err"></span> Connection failed: '+esc(String(err));
    });
});

// ══════════════════════════════════════════════════════════════════
// BREEZE API HELPER
// ══════════════════════════════════════════════════════════════════
function breezeGet(path, params) {
  var s = getBreezeSettings();
  if (!s.subdomain||!s.apiKey) return Promise.reject('No Breeze credentials configured.');

  var base = (s.workerUrl || window.location.origin).replace(/\\/$/, '');
  params = params || {};
  var qs = Object.keys(params).map(function(k){ return encodeURIComponent(k)+'='+encodeURIComponent(params[k]); }).join('&');
  var url = base + path + (qs ? '?'+qs : '');
  return fetch(url, {
    method: 'GET',
    headers: Object.assign({
      'X-Breeze-Subdomain': s.subdomain,
      'X-Breeze-Api-Key':   s.apiKey,
    }, s.workerSecret ? { 'X-Worker-Secret': s.workerSecret } : {}),
  })
    .then(function(r) {
      if (!r.ok) throw 'HTTP '+r.status+' ('+url+')';
      return r.json();
    });
}

// POST helper — used for /ajax/ endpoints that Breeze requires POST for
function breezePost(path, fields) {
  var s = getBreezeSettings();
  if (!s.subdomain||!s.apiKey) return Promise.reject('No Breeze credentials configured.');

  // Build form-encoded body (same format as a browser form submit)
  var body = Object.keys(fields).map(function(k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(fields[k]);
  }).join('&');

  var base = (s.workerUrl || window.location.origin).replace(/\\/$/, '');
  var url = base + path;
  return fetch(url, {
    method: 'POST',
    headers: Object.assign({
      'X-Breeze-Subdomain': s.subdomain,
      'X-Breeze-Api-Key':   s.apiKey,
      'Content-Type':       'application/x-www-form-urlencoded',
    }, s.workerSecret ? { 'X-Worker-Secret': s.workerSecret } : {}),
    body: body,
  })
    .then(function(r) {
      if (!r.ok) throw 'HTTP '+r.status;
      return r.json();
    });
}

// Fetches a Breeze page as raw HTML through the proxy (used to scrape real UI role IDs)
function breezeGetHtml(path) {
  var s = getBreezeSettings();
  if (!s.subdomain||!s.apiKey) return Promise.reject('No Breeze credentials configured.');
  if (!s.workerUrl) return Promise.reject('No Cloudflare Worker URL configured.');
  var url = s.workerUrl + path;
  return fetch(url, {
    method: 'GET',
    headers: Object.assign({
      'X-Breeze-Subdomain': s.subdomain,
      'X-Breeze-Api-Key':   s.apiKey,
    }, s.workerSecret ? { 'X-Worker-Secret': s.workerSecret } : {}),
  }).then(function(r) {
    if (!r.ok) throw 'HTTP '+r.status;
    return r.text();
  });
}

// ══════════════════════════════════════════════════════════════════
// BREEZE SYNC TAB
// ══════════════════════════════════════════════════════════════════
function initBreezeTab() {
  var s = getBreezeSettings();
  document.getElementById('breeze-no-settings').style.display = (!s.subdomain||!s.apiKey) ? 'block' : 'none';
  document.getElementById('breeze-no-schedule').style.display = (!currentSchedule.length) ? 'block' : 'none';
  renderEventMapTable();
}

// ── Breeze import helpers (People tab) ──────────────────────────────────────
function tagsToRoles(tags) {
  var matched = [];
  var all = PER_ROLES.concat(SHARED_ROLES);
  (tags || []).forEach(function(tag) {
    var t = (tag.name || '').toLowerCase();
    all.forEach(function(role) {
      var r = role.toLowerCase();
      if (t.indexOf(r) !== -1 || r.indexOf(t) !== -1) {
        if (matched.indexOf(role) === -1) matched.push(role);
      }
    });
  });
  return matched;
}

// Recursively scan any object/array for the first email-like string.
// Prioritizes keys whose names contain 'email', then scans everything.
function deepFindEmail(obj) {
  var found = '';
  function isEmail(s) { return typeof s === 'string' && s.indexOf('@') !== -1 && s.indexOf('.') !== -1 && s.length > 5; }
  function scanPriority(o) {
    if (found) return;
    if (isEmail(o)) { found = o; return; }
    if (!o || typeof o !== 'object') return;
    var keys = Array.isArray(o) ? Object.keys(o) : Object.keys(o);
    // First pass: keys mentioning email
    keys.forEach(function(k) {
      if (found) return;
      if (String(k).toLowerCase().indexOf('email') !== -1 || String(k).toLowerCase().indexOf('mail') !== -1) {
        var v = o[k];
        if (isEmail(v)) { found = v; return; }
        if (v && typeof v === 'object') {
          // Check .address or .value sub-keys first
          if (isEmail(v.address)) { found = v.address; return; }
          if (isEmail(v.value))   { found = v.value;   return; }
          scanPriority(v);
        }
      }
    });
    // Second pass: everything else
    if (!found) keys.forEach(function(k) { if (!found) scanPriority(o[k]); });
  }
  scanPriority(obj);
  return found;
}

function importBreezePersonToForm(breezeId) {
  var resultsEl = document.getElementById('breeze-import-results');
  resultsEl.innerHTML = '<span style="color:#888;">Loading\\u2026</span>';
  breezeGet('/api/people/' + breezeId, { details: 1 })
    .then(function(p) {
      // Name
      document.getElementById('person-name').value = ((p.first_name||'')+' '+(p.last_name||'')).trim();

      // Email — deep recursive scan of entire response; handles all known Breeze API structures
      var email = deepFindEmail(p);
      document.getElementById('person-email').value = email;

      // Roles from tags
      var roles = tagsToRoles(p.tags || []);
      document.getElementById('pref-roles').querySelectorAll('input[type=checkbox]').forEach(function(cb) {
        cb.checked = roles.indexOf(cb.value) !== -1;
      });
      syncLabels('pref-roles');

      // Store Breeze ID so savePerson() links it automatically
      document.getElementById('breeze-import-id').value = breezeId;

      var roleNote = roles.length ? ' Roles pre-checked: ' + roles.join(', ') + '.' : ' No matching role tags \\u2014 check roles manually.';
      var emailNote = email ? '' : ' <strong>No email found in Breeze \\u2014 enter manually.</strong>';
      resultsEl.innerHTML = '<span style="color:#6B8F71;">\\u2713 Filled in from Breeze.' + esc(roleNote) + '</span>' + emailNote + ' <span style="color:#7A6E60;">Set Sunday preferences &amp; service preference, then Save.</span>';
    })
    .catch(function(e) {
      resultsEl.innerHTML = '<span style="color:#B85C3A;">Error: ' + esc(String(e)) + '</span>';
    });
}

document.getElementById('btn-breeze-import-search').addEventListener('click', function() {
  var query = document.getElementById('breeze-import-query').value.trim();
  if (!query) { alert('Enter a name to search.'); return; }
  var resultsEl = document.getElementById('breeze-import-results');
  resultsEl.innerHTML = '<span style="color:#888;">Searching\\u2026</span>';

  var s = getBreezeSettings();

  // Build fetch promises for each configured tag ID
  var fetches = [];
  (s.tagIds || []).forEach(function(id) {
    if (id) fetches.push(breezeGet('/api/people', { details: 0, limit: 500, filter_json: JSON.stringify({ tag_contains: 'y_' + id }) }));
  });
  if (!fetches.length) {
    // No tag filter — search all
    fetches.push(breezeGet('/api/people', { details: 0, limit: 500 }));
  }

  Promise.all(fetches)
    .then(function(results) {
      // Merge and deduplicate by person id
      var seen = {};
      var merged = [];
      results.forEach(function(data) {
        (data || []).forEach(function(bp) {
          if (!seen[bp.id]) { seen[bp.id] = true; merged.push(bp); }
        });
      });
      var parts = query.toLowerCase().split(/\\s+/).filter(Boolean);
      var filtered = merged.filter(function(bp) {
        var first = (bp.first_name||'').toLowerCase();
        var last  = (bp.last_name||'').toLowerCase();
        return parts.every(function(p) { return first.indexOf(p) !== -1 || last.indexOf(p) !== -1; });
      });
      if (!filtered.length) {
        resultsEl.innerHTML = '<span style="color:#888;">No results found.</span>';
        return;
      }
      filtered.sort(function(a,b){ return ((a.last_name||'')+(a.first_name||'')).localeCompare((b.last_name||'')+(b.first_name||'')); });
      var html = '<select id="breeze-import-select" style="max-width:240px;margin-right:6px;font-size:0.82rem;">'
        + '<option value="">-- Select person --</option>';
      filtered.forEach(function(bp) {
        html += '<option value="'+esc(bp.id)+'">'+esc(((bp.first_name||'')+' '+(bp.last_name||'')).trim())+'</option>';
      });
      html += '</select><button class="btn btn-primary btn-sm" id="btn-breeze-import-fill">Import</button>';
      resultsEl.innerHTML = html;
      document.getElementById('btn-breeze-import-fill').addEventListener('click', function() {
        var sel = document.getElementById('breeze-import-select');
        if (!sel || !sel.value) { alert('Select a person first.'); return; }
        importBreezePersonToForm(sel.value);
      });
    })
    .catch(function(e) {
      resultsEl.innerHTML = '<span style="color:#B85C3A;">Error: ' + esc(String(e)) + '</span>';
    });
});

// ── Event mapping ─────────────────────────────────────────
var fetchedBreezeEvents = [];

(document.getElementById('btn-fetch-events') || {addEventListener: function(){}}).addEventListener('click', function() {
  if (!currentSchedule.length) { alert('Generate a schedule first.'); return; }
  var startStr = currentMonthKey ? currentMonthKey + '-01' : '';
  var endStr   = currentMonthKey ? (function(){ var p=currentMonthKey.split('-'); return new Date(parseInt(p[0]),parseInt(p[1]),0).toISOString().slice(0,10); })() : '';
  if (!startStr||!endStr) { alert('No active month selected.'); return; }
  var statusEl = document.getElementById('fetch-events-status');
  statusEl.textContent = 'Fetching…';

  breezeGet('/api/events', { start:startStr, end:endStr })
    .then(function(data) {
      if (!data) data = [];
      var filter = document.getElementById('event-filter').value.trim().toLowerCase();
      fetchedBreezeEvents = Array.isArray(data) ? data : (data.events||[]);
      if (filter) {
        fetchedBreezeEvents = fetchedBreezeEvents.filter(function(ev){
          return (ev.name||'').toLowerCase().indexOf(filter) > -1;
        });
      }
      statusEl.textContent = fetchedBreezeEvents.length + ' events found.';
      renderEventMapTable();
    })
    .catch(function(err) {
      statusEl.textContent = 'Error: '+err;
    });
});

function renderEventMapTable() {
  var container = document.getElementById('event-map-container');
  if (!currentSchedule.length) {
    container.innerHTML = '<p style="font-size:0.85rem;color:#888;">Generate a schedule first.</p>';
    return;
  }
  var eventMap = getEventMap();

  // Build event option list
  var eventOpts = '<option value="">-- not mapped --</option>';
  fetchedBreezeEvents.forEach(function(ev) {
    var label = (ev.name||'Unknown') + ' — ' + (ev.start_datetime ? ev.start_datetime.slice(0,10) : '?');
    eventOpts += '<option value="'+esc(ev.id||ev.event_id)+'">'+esc(label)+'</option>';
  });

  var html = '<table class="event-map-table">'
    +'<thead><tr><th>Sunday Date</th><th>8:00 AM Instance</th><th>10:45 AM Instance</th></tr></thead><tbody>';

  currentSchedule.forEach(function(row) {
    var iso = row.date.toISOString().slice(0,10);
    var map8   = (eventMap[iso]&&eventMap[iso]['8am'])   || '';
    var map10  = (eventMap[iso]&&eventMap[iso]['10:45am'])|| '';

    function makeSelect(svc, currentVal) {
      var sel = '<select data-date="'+esc(iso)+'" data-svc="'+esc(svc)+'" class="event-map-select">';
      sel += '<option value="">-- not mapped --</option>';
      fetchedBreezeEvents.forEach(function(ev) {
        var evId = String(ev.id||ev.event_id||'');
        var label = (ev.name||'Unknown')+' — '+(ev.start_datetime?ev.start_datetime.slice(0,10):'?');
        sel += '<option value="'+esc(evId)+'"'+(evId===currentVal?' selected':'')+'>'+esc(label)+'</option>';
      });
      if (currentVal && !fetchedBreezeEvents.some(function(ev){ return String(ev.id||ev.event_id)===currentVal; })) {
        sel += '<option value="'+esc(currentVal)+'" selected>ID: '+esc(currentVal)+'</option>';
      }
      sel += '</select>';
      return sel;
    }

    html += '<tr>'
      +'<td>'+esc(fmtDate(row.date))+' <span style="color:#888;font-size:0.78rem;">'+(row.ordinal+ordSuffix(row.ordinal)+' Sunday')+'</span></td>'
      +'<td>'+makeSelect('8am',   map8)+'</td>'
      +'<td>'+makeSelect('10:45am',map10)+'</td>'
      +'</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

// Save event map on dropdown change
(document.getElementById('event-map-container') || {addEventListener: function(){}}).addEventListener('change', function(e) {
  if (!e.target.classList.contains('event-map-select')) return;
  var iso = e.target.getAttribute('data-date');
  var svc = e.target.getAttribute('data-svc');
  var val = e.target.value;
  var eventMap = getEventMap();
  if (!eventMap[iso]) eventMap[iso] = {};
  eventMap[iso][svc] = val;
  saveEventMap(eventMap);
});

// ── Step 3: Push to Breeze ────────────────────────────────────────
(document.getElementById('btn-sync-breeze') || {addEventListener: function(){}}).addEventListener('click', syncToBreeze);

function logLine(msg, cls) {
  var box = document.getElementById('sync-log');
  box.style.display = 'block';
  box.innerHTML += '<div class="'+(cls||'')+'">'+msg+'</div>';
  box.scrollTop = box.scrollHeight;
}

function syncToBreeze() {
  var people = getPeople();
  var pMap = {};
  people.forEach(function(p){ pMap[p.id]=p; });
  var eventMap = getEventMap();

  var logBox = document.getElementById('sync-log');
  logBox.innerHTML = '';
  logBox.style.display = 'block';
  document.getElementById('sync-overall-status').textContent = 'Running…';

  var totalOk = 0, totalErr = 0, totalSkip = 0;

  // Build list of tasks: { dateISO, svc, instanceId, personIds }
  var tasks = [];
  currentSchedule.forEach(function(row) {
    var iso = row.date.toISOString().slice(0,10);

    ['8am','10:45am'].forEach(function(svc) {
      var instanceId = eventMap[iso] && eventMap[iso][svc];
      if (!instanceId) { totalSkip++; return; }

      // Collect assigned people with their role names
      var assignedPairs = [];
      PER_ROLES.forEach(function(role) {
        var pid = row.assignments[role][svc];
        if (pid && pMap[pid] && pMap[pid].breezePersonId)
          assignedPairs.push({ breezePersonId: pMap[pid].breezePersonId, role: role });
      });
      // Shared roles go to both services
      SHARED_ROLES.forEach(function(role) {
        var pid = row.assignments[role].shared;
        if (pid && pMap[pid] && pMap[pid].breezePersonId)
          assignedPairs.push({ breezePersonId: pMap[pid].breezePersonId, role: role });
      });
      // Group all roles per person (one person can hold multiple roles)
      var grouped = {};
      assignedPairs.forEach(function(a) {
        if (!grouped[a.breezePersonId]) grouped[a.breezePersonId] = [];
        grouped[a.breezePersonId].push(a.role);
      });
      var groupedAssignments = Object.keys(grouped).map(function(bpid) {
        return { breezePersonId: bpid, roles: grouped[bpid] };
      });

      tasks.push({ iso:iso, svc:svc, instanceId:instanceId, assignments:groupedAssignments });
    });
  });

  if (!tasks.length) {
    logLine('No event instances mapped. Map events in Step 2 first.', 'log-err');
    document.getElementById('sync-overall-status').textContent = '';
    return;
  }

  // ── Phase A: Fetch role name→ID maps from Breeze API for each unique instance ──
  // Uses GET /api/volunteers/list_roles which returns API role IDs (works with API key auth).
  // We fetch roles for one representative instance per service, then reuse that map.
  var serviceMaps = {};  // { '8am': { 'elder': '120417', ... }, '10:45am': { ... } }
  var instancePerSvc = {};  // first instanceId seen for each service
  tasks.forEach(function(t) {
    if (!instancePerSvc[t.svc]) instancePerSvc[t.svc] = t.instanceId;
  });

  var servicePrep = Promise.resolve();
  Object.keys(instancePerSvc).forEach(function(svc) {
    servicePrep = servicePrep.then(function() {
      var iid = instancePerSvc[svc];
      return breezeGet('/api/volunteers/list_roles', { instance_id: iid })
        .then(function(roles) {
          var map = {};
          if (Array.isArray(roles)) {
            roles.forEach(function(r) {
              // Normalize: lowercase, strip apostrophes, trim
              var key = (r.name || '').toLowerCase().replace(/['']/g, '').trim();
              if (key) map[key] = String(r.id);
            });
          }
          serviceMaps[svc] = map;
          var count = Object.keys(map).length;
          if (count === 0) {
            logLine('&#9888; No roles found in Breeze for <strong>'+esc(svc)+'</strong> (instance '+esc(iid)+')', 'log-err');
          } else {
            logLine('Roles for <strong>'+esc(svc)+'</strong> ('+count+'): '+esc(JSON.stringify(map)), 'log-info');
          }
        })
        .catch(function(e) {
          serviceMaps[svc] = {};
          logLine('&#9888; Could not fetch roles for <strong>'+esc(svc)+'</strong>: '+esc(String(e)), 'log-err');
        });
    });
  });

  // ── Phase B: Execute tasks sequentially ──
  // For each task: remove existing volunteers, then add each person and update their roles.
  // Flow per person: POST /api/volunteers/add → GET /api/volunteers/update?role_ids_json=[...]
  // Both endpoints use API key auth (no session cookie needed).
  servicePrep.then(function() {
    var chain = Promise.resolve();
    tasks.forEach(function(task) {
      chain = chain.then(function() {
        logLine('<br><span class="log-info">&#9658; '+esc(task.iso)+' '+esc(task.svc)+'</span>');
        logLine('  &#8614; instance_id: <code>'+esc(task.instanceId)+'</code>', 'log-info');
        var roleMap = serviceMaps[task.svc] || {};

        // 1. Get existing volunteers
        return breezeGet('/api/volunteers/list', { instance_id: task.instanceId })
          .then(function(existing) {
            logLine('  volunteers/list raw: '+esc(JSON.stringify(existing).slice(0,300)), 'log-info');
            var existingList = Array.isArray(existing) ? existing : [];
            // 2. Remove each existing volunteer
            var removeChain = Promise.resolve();
            existingList.forEach(function(vol) {
              var vpid = vol.person_id;
              removeChain = removeChain.then(function() {
                return breezeGet('/api/volunteers/remove', { instance_id: task.instanceId, person_id: vpid })
                  .then(function(res) {
                    if (res === true) { logLine('  &minus; Removed volunteer ID '+esc(vpid)); totalOk++; }
                    else { logLine('  ? Remove returned: '+esc(JSON.stringify(res)), 'log-info'); totalErr++; }
                  })
                  .catch(function(e) { logLine('  &times; Failed to remove '+esc(vpid)+': '+esc(String(e)), 'log-err'); totalErr++; });
              });
            });
            return removeChain;
          })
          .then(function() {
            // 3. Add each person and assign their roles via the public API.
            // Step A per person: GET /api/volunteers/add?instance_id=...&person_id=...
            // Step B per person: GET /api/volunteers/update?instance_id=...&person_id=...&role_ids_json=[id1,id2,...]
            if (!task.assignments.length) {
              logLine('  (no assigned people with Breeze IDs for this slot)', 'log-info');
              return;
            }

            var assignChain = Promise.resolve();
            task.assignments.forEach(function(a) {
              var bpid = a.breezePersonId;

              // Resolve role names to API role IDs
              var roleIds = [];
              var warned = {};
              a.roles.forEach(function(role) {
                var key = role.toLowerCase().replace(/['']/g, '').trim();
                var rid = roleMap[key];
                if (!rid) {
                  if (!warned[role]) {
                    logLine('  Warning: no role ID for "'+esc(role)+'" — skipped for person '+esc(bpid), 'log-info');
                    warned[role] = true;
                  }
                } else {
                  roleIds.push(rid);
                }
              });

              assignChain = assignChain.then(function() {
                // Step A: add person to event
                logLine('  &#8614; adding person_id: <code>'+esc(bpid)+'</code>', 'log-info');
                return breezeGet('/api/volunteers/add', { instance_id: task.instanceId, person_id: bpid })
                  .then(function(addRes) {
                    logLine('  add raw response: '+esc(JSON.stringify(addRes)), 'log-info');
                    // Step B: update their roles (even if roleIds is empty — clears roles)
                    if (!roleIds.length) {
                      logLine('  + Added person '+esc(bpid)+' (no roles matched)', 'log-ok');
                      totalOk++;
                      return;
                    }
                    return breezeGet('/api/volunteers/update', {
                      instance_id:   task.instanceId,
                      person_id:     bpid,
                      role_ids_json: JSON.stringify(roleIds.map(Number))
                    })
                      .then(function(updRes) {
                        var roleNames = roleIds.map(function(rid) {
                          var name = rid;
                          Object.keys(roleMap).forEach(function(n) { if (roleMap[n] === rid) name = n; });
                          return name;
                        });
                        logLine('  + Added person '+esc(bpid)+' → roles: '+esc(roleNames.join(', '))+' — result: '+esc(JSON.stringify(updRes)), 'log-ok');
                        totalOk++;
                      })
                      .catch(function(e) {
                        logLine('  &times; Failed to update roles for '+esc(bpid)+': '+esc(String(e)), 'log-err');
                        totalErr++;
                      });
                  })
                  .catch(function(e) {
                    logLine('  &times; Failed to add person '+esc(bpid)+': '+esc(String(e)), 'log-err');
                    totalErr++;
                  });
              });
            });
            return assignChain;
          })
          .catch(function(err) {
            logLine('  Error: '+esc(String(err)), 'log-err');
            totalErr++;
          });
      });
    });

    chain.then(function() {
      logLine('<br><strong>Done. '+totalOk+' OK, '+totalErr+' errors, '+totalSkip+' skipped (no instance mapped).</strong>', totalErr>0?'log-err':'log-ok');
      document.getElementById('sync-overall-status').textContent = totalErr>0 ? totalErr+' errors — see log' : 'Complete!';
    });
  });
}

// ══════════════════════════════════════════════════════════════════
// FIREBASE CLOUD SYNC
// ══════════════════════════════════════════════════════════════════

function updateSyncStatus(msg, isError) {
  var el = document.getElementById('sync-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? '#B85C3A' : (msg ? '#6B8F71' : '#7A6E60');
}

function updateLoginStatus(msg, isError) {
  var el = document.getElementById('login-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? '#B85C3A' : '#6B8F71';
}

function buildDataSnapshot() {
  return {
    ws_people:             getPeople(),
    ws_schedule_v2:        getMonthSchedules(),
    ws_history:            getHistory(),
    ws_last_served:        getLastServed(),
    ws_schedule_overrides: getScheduleOverrides(),
    ws_confirmations:      getConfirmations(),
    ws_rsvp_tokens:        getRsvpTokens(),
    ws_sun_labels:         getSundayLabels(),
    ws_breeze_settings:    getBreezeSettings()
  };
}

async function d1Push() {
  updateSyncStatus('Saving\\u2026');
  try {
    var resp = await fetch('/admin/api/scheduler/data', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(buildDataSnapshot())
    });
    if (!resp.ok) { updateSyncStatus('Save error: ' + resp.status, true); return; }
    updateSyncStatus('Saved \\u2713 ' + new Date().toLocaleTimeString());
  } catch(e) { updateSyncStatus('Save error: ' + e.message, true); }
}

async function d1Pull() {
  updateSyncStatus('Loading\\u2026');
  try {
    var resp = await fetch('/admin/api/scheduler/data', {credentials: 'include'});
    if (!resp.ok) { updateSyncStatus('Load error: ' + resp.status, true); return; }
    var data = await resp.json();
    var keys = ['ws_people','ws_schedule_v2','ws_history','ws_last_served',
                'ws_schedule_overrides','ws_confirmations','ws_rsvp_tokens','ws_sun_labels',
                'ws_breeze_settings'];
    keys.forEach(function(k) {
      if (data[k] !== undefined) localStorage.setItem(k, JSON.stringify(data[k]));
    });
    updateSyncStatus('Loaded \\u2713 ' + new Date().toLocaleTimeString());
    loadSettingsForm();
    renderPeopleList();
    if (loadSchedule()) {
      renderTable(getPeople(), null);
      document.getElementById('schedule-output').style.display = 'block';
    }
  } catch(e) { updateSyncStatus('Load error: ' + e.message, true); }
}

var _d1SyncTimer = null;
function queueD1Push() {
  clearTimeout(_d1SyncTimer);
  _d1SyncTimer = setTimeout(d1Push, 1500);
}

function fbSignOut() {
  if (_d1SyncTimer) {
    clearTimeout(_d1SyncTimer);
    _d1SyncTimer = null;
  }
  d1Push().finally(function() { window.location.href = '/admin/logout'; });
}


async function checkAuth() {
  // Embedded mode: the /scheduler route gate already verified auth before
  // serving this HTML, and the parent ChMS handles session timeouts. Skip
  // the redundant probe (which can hang or 401 unexpectedly inside iframes
  // depending on cookie/SameSite behavior) and render the app immediately.
  if (_embedded) {
    var ls = document.getElementById('login-screen');
    var ac = document.getElementById('app-content');
    if (ls) ls.style.display = 'none';
    if (ac) ac.style.display = 'block';
    d1Pull();
    fetchPendingSignups();
    fetchGeneralVolunteers();
    fetchEventVolunteers();
    return;
  }
  try {
    var resp = await fetch('/admin/api/scheduler/data', {credentials: 'include'});
    if (resp.status === 401) { window.location.href = '/admin'; return; }
    var loginScreen = document.getElementById('login-screen');
    var appContent  = document.getElementById('app-content');
    if (loginScreen) loginScreen.style.display = 'none';
    if (appContent)  appContent.style.display  = 'block';
    d1Pull();
    fetchPendingSignups();
    fetchGeneralVolunteers();
    fetchEventVolunteers();
  } catch(e) { window.location.href = '/admin'; }
}
checkAuth();

// ══════════════════════════════════════════════════════════════════
// DATA EXPORT / IMPORT
// ══════════════════════════════════════════════════════════════════
function exportAllData() {
  var keys = ['ws_people','ws_schedule_v2','ws_history','ws_last_served',
              'ws_schedule_overrides','ws_confirmations','ws_rsvp_tokens','ws_sun_labels',
              'ws_breeze_settings'];
  var snapshot = {};
  keys.forEach(function(k) {
    try { snapshot[k] = JSON.parse(localStorage.getItem(k)); } catch(e) { snapshot[k] = null; }
  });
  var blob = new Blob([JSON.stringify(snapshot, null, 2)], {type: 'application/json'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ws_backup_' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importAllData(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var snapshot = JSON.parse(e.target.result);
      var keys = ['ws_people','ws_schedule_v2','ws_history','ws_last_served',
                  'ws_schedule_overrides','ws_confirmations','ws_rsvp_tokens','ws_sun_labels',
                  'ws_breeze_settings'];
      var count = 0;
      keys.forEach(function(k) {
        if (snapshot[k] !== null && snapshot[k] !== undefined) {
          localStorage.setItem(k, JSON.stringify(snapshot[k]));
          count++;
        }
      });
      loadSettingsForm();
      renderPeopleList();
      if (loadSchedule()) {
        renderTable(getPeople(), null);
        document.getElementById('schedule-output').style.display = 'block';
      }
      showAlert('settings-alert', 'Imported ' + count + ' data sets successfully. Push to Cloud to sync.', 'success');
      queueD1Push();
    } catch(err) {
      showAlert('settings-alert', 'Import failed: ' + err.message, 'warning');
    }
  };
  reader.readAsText(file);
}

// ══════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════
// Set the month label first so the user never sees "Loading…" stuck
// even if a later init step throws.
try {
  var _monthLabelEl = document.getElementById('current-month-label');
  if (_monthLabelEl) _monthLabelEl.textContent = monthKeyLabel(currentMonthKey);
} catch (e) { console.error('init month label:', e); }

function _safeInit(name, fn) {
  try { fn(); } catch (e) { console.error('init ' + name + ':', e); }
}
_safeInit('migrateOldSchedule', migrateOldSchedule);
_safeInit('pendingSignups',     function(){ _pendingSignups   = getPendingSignups();   updateSignupsBadge(); });
_safeInit('generalVolunteers',  function(){ _generalVolunteers = getGeneralVolunteers(); updateGeneralBadge(); });
_safeInit('eventVolunteers',    function(){ _eventVolunteers   = getEventVolunteers();   updateEventBadge(); });
_safeInit('renderPeopleList',   renderPeopleList);

// Restore saved schedule if any
_safeInit('loadSchedule', function() {
  if (loadSchedule()) {
    renderTable(getPeople(), null);
    document.getElementById('schedule-output').style.display = 'block';
  }
});


// ══════════════════════════════════════════════════════════════════
// SCHEDULE HISTORY & LAST-SERVED
// ══════════════════════════════════════════════════════════════════
function archiveCurrentSchedule() {
  if (!currentSchedule.length) return;
  var history = getHistory();
  var startDate = currentMonthKey ? currentMonthKey + '-01' : '';
  var endDate = currentMonthKey ? (function(){ var p=currentMonthKey.split('-'); return new Date(parseInt(p[0]),parseInt(p[1]),0).toISOString().slice(0,10); })() : '';
  var rows = currentSchedule.filter(function(row){ return row.type !== 'special'; }).map(function(row) {
    return { dateISO: row.date.toISOString(), ordinal: row.ordinal, assignments: row.assignments, label: row.label || '' };
  });
  history.unshift({ id: makeId(), savedAt: new Date().toISOString(), startDate: startDate, endDate: endDate, rows: rows });
  if (history.length > 24) history = history.slice(0, 24);
  saveHistory(history);
  updateLastServedFromRows(rows);
  queueD1Push();
}

function updateLastServedFromRows(rows) {
  var ls = getLastServed();
  rows.forEach(function(row) {
    var dateISO = typeof row.dateISO === 'string' ? row.dateISO.slice(0,10) : new Date(row.dateISO).toISOString().slice(0,10);
    PER_ROLES.forEach(function(role) {
      ['8am','10:45am'].forEach(function(svc) {
        var pid = row.assignments[role] && row.assignments[role][svc];
        if (!pid) return;
        if (!ls[pid]) ls[pid] = {};
        if (!ls[pid][role] || dateISO > ls[pid][role]) ls[pid][role] = dateISO;
      });
    });
    SHARED_ROLES.forEach(function(role) {
      var pid = row.assignments[role] && row.assignments[role].shared;
      if (!pid) return;
      if (!ls[pid]) ls[pid] = {};
      if (!ls[pid][role] || dateISO > ls[pid][role]) ls[pid][role] = dateISO;
    });
  });
  saveLastServed(ls);
}

// ══════════════════════════════════════════════════════════════════
// AUTO-FILL SCHEDULE
// ══════════════════════════════════════════════════════════════════
function pickBestWithHistory(pool, counts, lastServed, role) {
  if (!pool.length) return null;
  pool.sort(function(a, b) {
    var aLast = (lastServed[a.id] && lastServed[a.id][role]) || '0000-00-00';
    var bLast = (lastServed[b.id] && lastServed[b.id][role]) || '0000-00-00';
    if (aLast < bLast) return -1;
    if (aLast > bLast) return 1;
    return (counts[a.id]||0) - (counts[b.id]||0);
  });
  return pool[0];
}

function autoFillSchedule() {
  if (!currentSchedule.length) { showAlert('schedule-alert','Generate a schedule first, then use Auto-Fill to populate empty slots.','warning'); return; }
  var people = getPeople();
  if (!people.length) { showAlert('schedule-alert','No people added yet.','warning'); return; }
  var lastServed = getLastServed();
  var counts = {};
  people.forEach(function(p){ counts[p.id] = 0; });
  // Seed counts from existing assignments
  currentSchedule.forEach(function(row) {
    SHARED_ROLES.forEach(function(role) {
      var pid = row.assignments[role].shared;
      if (pid) counts[pid] = (counts[pid]||0) + 1;
    });
    PER_ROLES.forEach(function(role) {
      ['8am','10:45am'].forEach(function(svc) {
        var pid = row.assignments[role][svc];
        if (pid) counts[pid] = (counts[pid]||0) + 1;
      });
    });
  });
  var filled = 0;
  currentSchedule.forEach(function(row) {
    var ordinal = row.ordinal;
    var dateISO = row.date.toISOString().slice(0,10);
    SHARED_ROLES.forEach(function(role) {
      if (row.assignments[role].shared) return;
      var pool = people.filter(function(p){ return p.roles.indexOf(role)>-1 && eligible(p,ordinal,'shared',dateISO); });
      var picked = pickBestWithHistory(pool, counts, lastServed, role);
      if (picked) { row.assignments[role].shared = picked.id; counts[picked.id]++; filled++; }
    });
    PER_ROLES.forEach(function(role) {
      var usedIds = {};
      ['8am','10:45am'].forEach(function(svc) {
        if (row.assignments[role][svc]) { usedIds[row.assignments[role][svc]] = true; return; }
        var pool = people.filter(function(p){ return p.roles.indexOf(role)>-1 && eligible(p,ordinal,svc,dateISO) && !usedIds[p.id]; });
        var picked = pickBestWithHistory(pool, counts, lastServed, role);
        if (picked) { row.assignments[role][svc] = picked.id; counts[picked.id]++; usedIds[picked.id]=true; filled++; }
      });
    });
  });
  renderTable(getPeople(), counts);
  saveSchedule();
  showAlert('schedule-alert', filled + ' slot' + (filled!==1?'s':'') + ' auto-filled using volunteer history.' + (filled===0?' (All slots already filled or no eligible volunteers found)':''), filled>0?'success':'warning');
}

// ══════════════════════════════════════════════════════════════════
// ICAL EXPORT
// ══════════════════════════════════════════════════════════════════
function exportIcal() {
  if (!currentSchedule.length) { alert('Generate a schedule first.'); return; }
  var pMap = {};
  getPeople().forEach(function(p){ pMap[p.id]=p; });
  var lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Timothy Lutheran Church//Worship Scheduler//EN','CALSCALE:GREGORIAN'];
  var serviceUTC = { '8am': '140000Z', '10:45am': '154500Z', 'shared': '140000Z' };
  var serviceDur = { '8am': '010000', '10:45am': '010000', 'shared': '020000' };
  function isoToYMD(d) {
    var iso = d.toISOString().slice(0,10).replace(/-/g,'');
    return iso;
  }
  function stamp() { return new Date().toISOString().replace(/[-:]/g,'').slice(0,15)+'Z'; }
  var sunLabels = getSundayLabels();
  currentSchedule.forEach(function(row) {
    var ymd = isoToYMD(row.date);
    var dateISO = row.date.toISOString().slice(0,10);
    var lectEntryPrint = getLectEntry(row.date);
    var dayLabel = sunLabels[dateISO] || row.label || (lectEntryPrint ? lectEntryPrint.sundayName : '');
    var collect = [];
    PER_ROLES.forEach(function(role) {
      ['8am','10:45am'].forEach(function(svc) {
        var pid = row.assignments[role][svc];
        if (pid && pMap[pid]) collect.push({ pid:pid, role:role, svc:svc });
      });
    });
    SHARED_ROLES.forEach(function(role) {
      var pid = row.assignments[role].shared;
      if (pid && pMap[pid]) collect.push({ pid:pid, role:role, svc:'shared' });
    });
    collect.forEach(function(item) {
      var p = pMap[item.pid];
      var svcLabel = item.svc==='8am' ? '8:00 AM' : (item.svc==='10:45am' ? '10:45 AM' : 'Both Services');
      var summary = 'Worship: ' + roleLabel(item.role) + ' (' + svcLabel + ')' + (dayLabel ? ' — '+dayLabel : '');
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + item.pid + '-' + item.role.replace(/\\s/g,'-') + '-' + item.svc + '-' + ymd + '@tlc-scheduler');
      lines.push('DTSTAMP:' + stamp());
      lines.push('DTSTART:' + ymd + 'T' + serviceUTC[item.svc]);
      lines.push('DURATION:PT' + serviceDur[item.svc]);
      lines.push('SUMMARY:' + summary);
      lines.push('DESCRIPTION:Volunteer: ' + p.name + '\\nRole: ' + roleLabel(item.role) + '\\nService: ' + svcLabel);
      lines.push('LOCATION:Timothy Lutheran Church');
      if (p.email) lines.push('ATTENDEE;CN="' + p.name + '":mailto:' + p.email);
      lines.push('END:VEVENT');
    });
  });
  lines.push('END:VCALENDAR');
  var blob = new Blob([lines.join('\\r\\n')], {type:'text/calendar'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a'); a.href=url; a.download='worship-schedule.ics';
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════════════════════════════
// STATS / DASHBOARD
// ══════════════════════════════════════════════════════════════════
function renderStatsTab() {
  var people = getPeople();
  if (!people.length) {
    document.getElementById('stats-content').innerHTML = '<p style="color:#aaa;font-size:0.85rem;">No people added yet.</p>';
    return;
  }

  // Collect all rows from history + current schedule
  var allRows = [];
  getHistory().forEach(function(h) { allRows = allRows.concat(h.rows); });
  currentSchedule.forEach(function(row) {
    if (row.type !== 'sunday') return;
    allRows.push({ dateISO: row.date.toISOString(), ordinal: row.ordinal, assignments: row.assignments });
  });
  if (!allRows.length) {
    document.getElementById('stats-content').innerHTML = '<p style="color:#aaa;font-size:0.85rem;">Generate or load a schedule to see statistics.</p>';
    return;
  }

  var confs    = getConfirmations();
  var fromDate = (document.getElementById('stats-from') || {}).value || '';
  var toDate   = (document.getElementById('stats-to')   || {}).value || '';

  // Build counts — confirmed assignments only
  var totals     = {}; // { pid: count }
  var byRole     = {}; // { pid: { role: count } }
  var lastServed = {}; // { pid: latestISO }
  people.forEach(function(p) { totals[p.id] = 0; byRole[p.id] = {}; lastServed[p.id] = null; });

  allRows.forEach(function(row) {
    var dateISO = (typeof row.dateISO === 'string' ? row.dateISO : new Date(row.dateISO).toISOString()).slice(0, 10);
    if (fromDate && dateISO < fromDate) return;
    if (toDate   && dateISO > toDate)   return;

    PER_ROLES.forEach(function(role) {
      ['8am', '10:45am'].forEach(function(svc) {
        var pid = row.assignments[role] && row.assignments[role][svc];
        if (!pid || !totals.hasOwnProperty(pid)) return;
        if (confs[dateISO + '|' + role + '|' + svc] !== 'confirmed') return;
        totals[pid]++;
        byRole[pid][role] = (byRole[pid][role] || 0) + 1;
        if (!lastServed[pid] || dateISO > lastServed[pid]) lastServed[pid] = dateISO;
      });
    });
    SHARED_ROLES.forEach(function(role) {
      var pid = row.assignments[role] && row.assignments[role].shared;
      if (!pid || !totals.hasOwnProperty(pid)) return;
      if (confs[dateISO + '|' + role + '|shared'] !== 'confirmed') return;
      totals[pid]++;
      byRole[pid][role] = (byRole[pid][role] || 0) + 1;
      if (!lastServed[pid] || dateISO > lastServed[pid]) lastServed[pid] = dateISO;
    });
  });

  // Sort: most recently served first, then by count
  var sorted = people.slice().sort(function(a, b) {
    var la = lastServed[a.id] || '';
    var lb = lastServed[b.id] || '';
    if (lb !== la) return lb > la ? 1 : -1;
    return (totals[b.id] || 0) - (totals[a.id] || 0);
  });

  var html = '<table class="stats-table">'
    + '<thead><tr>'
    + '<th>Volunteer</th>'
    + '<th>Roles Served</th>'
    + '<th class="center">Times Served</th>'
    + '<th>Last Served</th>'
    + '</tr></thead><tbody>';

  sorted.forEach(function(p) {
    var count = totals[p.id] || 0;
    var roleParts = Object.keys(byRole[p.id]).sort().map(function(r) {
      var n = byRole[p.id][r];
      return roleLabel(r) + (n > 1 ? ' \\xd7' + n : '');
    });
    var lastStr = lastServed[p.id]
      ? new Date(lastServed[p.id] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '<span style="color:#bbb">&mdash;</span>';
    html += '<tr>'
      + '<td class="sv-name">' + esc(p.name) + '</td>'
      + '<td class="sv-roles">' + (roleParts.length ? esc(roleParts.join(' \\u2022 ')) : '<span style="color:#bbb">&mdash;</span>') + '</td>'
      + '<td class="sv-count">' + (count > 0 ? count : '<span style="color:#bbb">0</span>') + '</td>'
      + '<td class="sv-last">' + lastStr + '</td>'
      + '</tr>';
  });

  html += '</tbody></table>';

  var filterNote = (fromDate || toDate)
    ? ' &middot; filtered ' + (fromDate ? fromDate : '') + (fromDate && toDate ? ' &ndash; ' : '') + (toDate ? toDate : '')
    : ' &middot; all time';
  html += '<p style="font-size:0.75rem;color:#bbb;margin-top:10px;">Confirmed assignments only'
    + filterNote + ' &middot; current + ' + getHistory().length + ' archived schedule(s).</p>';

  document.getElementById('stats-content').innerHTML = html;
}

// ══════════════════════════════════════════════════════════════════
// SPECIAL SERVICE PANEL
// ══════════════════════════════════════════════════════════════════
function addSpecialSvcTimeRow(timeVal, preSelectedRoles) {
  var list = document.getElementById('special-services-list');
  var idx = list.querySelectorAll('.special-svc-row').length;
  // Build role checkboxes (all known roles)
  var allRoles = PER_ROLES.concat(SHARED_ROLES);
  var roleCheckboxes = allRoles.map(function(r) {
    return '<label style="display:inline-flex;align-items:center;gap:3px;font-size:.78rem;margin-right:6px;">'
      +'<input type="checkbox" data-role="'+esc(r)+'"> '+esc(roleLabel(r))+'</label>';
  }).join('');
  var row = document.createElement('div');
  row.className = 'special-svc-row';
  row.style.cssText = 'background:#FAF7F0;border:1px solid #E8E0D0;border-radius:8px;padding:8px 10px;margin-bottom:8px;';
  row.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">'
    +'<label style="font-size:.78rem;font-weight:600;">Time:</label>'
    +'<input type="text" class="svc-time-input" placeholder="e.g. 5:00pm" style="width:110px;font-size:.82rem;">'
    +'<button type="button" class="btn-remove-svc" style="margin-left:auto;background:none;border:none;color:#c00;cursor:pointer;font-size:1rem;">&times;</button>'
    +'</div>'
    +'<div style="font-size:.78rem;font-weight:600;margin-bottom:4px;">Roles needed:</div>'
    +'<div class="svc-role-checks" style="display:flex;flex-wrap:wrap;gap:2px;">'+roleCheckboxes+'</div>';
  row.querySelector('.btn-remove-svc').addEventListener('click', function(){ list.removeChild(row); });
  list.appendChild(row);
  // Pre-fill if editing an existing service time
  if (timeVal) row.querySelector('.svc-time-input').value = timeVal;
  if (preSelectedRoles) {
    row.querySelectorAll('.svc-role-checks input[type="checkbox"]').forEach(function(cb) {
      if (preSelectedRoles.indexOf(cb.getAttribute('data-role')) > -1) cb.checked = true;
    });
  }
}

document.getElementById('btn-add-svc-time').addEventListener('click', addSpecialSvcTimeRow);

document.getElementById('btn-save-special').addEventListener('click', function() {
  var date = document.getElementById('special-date').value;
  var name = document.getElementById('special-name').value.trim();
  if (!date) { showAlert('special-alert','Please select a date.','warning'); return; }
  if (!name) { showAlert('special-alert','Please enter a service name.','warning'); return; }

  var services = [];
  document.getElementById('special-services-list').querySelectorAll('.special-svc-row').forEach(function(row) {
    var time = row.querySelector('.svc-time-input').value.trim() || 'Service';
    var roles = [];
    row.querySelectorAll('.svc-role-checks input[type="checkbox"]:checked').forEach(function(cb){
      roles.push(cb.getAttribute('data-role'));
    });
    if (roles.length) services.push({ time: time, roles: roles, assignments: {} });
  });
  if (!services.length) { showAlert('special-alert','Add at least one service time with roles.','warning'); return; }

  var saveBtn = this;
  var editIdx = saveBtn.getAttribute('data-edit-idx');
  var specialRow = { type:'special', date:new Date(date+'T12:00:00'), name:name, services:services };
  var successMsg;

  if (editIdx !== null && editIdx !== '') {
    // Editing — preserve existing assignments for matching svc-time/role pairs
    var oldSvcs = (currentSchedule[parseInt(editIdx,10)] || {}).services || [];
    specialRow.services.forEach(function(svc, i) {
      var oldSvc = oldSvcs[i];
      if (oldSvc && oldSvc.assignments) {
        svc.assignments = {};
        svc.roles.forEach(function(r) {
          if (oldSvc.assignments[r]) svc.assignments[r] = oldSvc.assignments[r];
        });
      }
    });
    currentSchedule[parseInt(editIdx,10)] = specialRow;
    saveBtn.removeAttribute('data-edit-idx');
    saveBtn.textContent = 'Add to Schedule';
    document.getElementById('special-panel-title').textContent = 'Add Special Service';
    successMsg = 'Special service "'+name+'" updated.';
  } else {
    currentSchedule.push(specialRow);
    successMsg = 'Special service "'+name+'" added.';
  }

  currentSchedule.sort(function(a,b){ return a.date - b.date; });
  saveCurrentMonth();
  setDirty(false);
  renderTable(getPeople(), null);
  document.getElementById('schedule-output').style.display = 'block';
  closeAllPanels();
  showAlert('schedule-alert', successMsg, 'success');
});

// ══════════════════════════════════════════════════════════════════
// CLOUD SYNC & DATA EXPORT/IMPORT BUTTON HANDLERS
// ══════════════════════════════════════════════════════════════════

document.getElementById('btn-fb-push').addEventListener('click', d1Push);
document.getElementById('btn-fb-pull').addEventListener('click', d1Pull);
document.getElementById('btn-fb-signout').addEventListener('click', fbSignOut);
document.getElementById('btn-header-signout').addEventListener('click', fbSignOut);
document.getElementById('btn-export-data').addEventListener('click', exportAllData);
document.getElementById('import-data-file').addEventListener('change', function(e) {
  if (e.target.files && e.target.files[0]) {
    importAllData(e.target.files[0]);
    e.target.value = ''; // reset so same file can be re-imported
  }
});

// Load LCMS lectionary calendar for Sunday name + series display
fetch('lcms_calendar.json')
  .then(function(r) { return r.json(); })
  .then(function(data) {
    lectCalendar = data.calendar || {};
    // Re-render if a schedule is already showing
    var out = document.getElementById('schedule-output');
    if (out && out.style.display !== 'none') renderTable(getPeople(), null);
  })
  .catch(function() { /* graceful degradation: lectCalendar stays {} */ });


// ══════════════════════════════════════════════════════════════════
// VOLUNTEER SIGN-UP REVIEW
// Three queues: scheduler (Lector/PPT/Acolyte), general, events
// ══════════════════════════════════════════════════════════════════

function getPendingSignups() {
  try { return JSON.parse(localStorage.getItem('ws_pending_signups') || '[]'); } catch(e) { return []; }
}
function savePendingSignups(arr) {
  localStorage.setItem('ws_pending_signups', JSON.stringify(arr));
}
function getGeneralVolunteers() {
  try { return JSON.parse(localStorage.getItem('ws_general_volunteers') || '[]'); } catch(e) { return []; }
}
function saveGeneralVolunteers(arr) {
  localStorage.setItem('ws_general_volunteers', JSON.stringify(arr));
}
function getEventVolunteers() {
  try { return JSON.parse(localStorage.getItem('ws_event_volunteers') || '[]'); } catch(e) { return []; }
}
function saveEventVolunteers(arr) {
  localStorage.setItem('ws_event_volunteers', JSON.stringify(arr));
}
function getEventRoles() {
  try { return JSON.parse(localStorage.getItem('ws_event_roles') || '{}'); } catch(e) { return {}; }
}
function saveEventRoles(obj) {
  localStorage.setItem('ws_event_roles', JSON.stringify(obj));
}

function _workerHeaders() {
  var s = getBreezeSettings();
  return Object.assign({ 'Content-Type': 'application/json' },
    s.workerSecret ? { 'X-Worker-Secret': s.workerSecret } : {});
}

// ── Scheduler sign-ups (Lector / PowerPoint / Acolyte) ────────────

async function fetchPendingSignups() {
  var s = getBreezeSettings();
  // Primary: fetch from worker KV endpoint
  if (s.workerUrl) {
    try {
      var r = await fetch(s.workerUrl + '/volunteer/pending', { headers: _workerHeaders() });
      var data = await r.json();
      var result = (data.volunteers || []).map(function(v) {
        return {
          id: v.id, name: v.name, email: v.email, phone: v.phone || '',
          roles: v.roles || [],
          preferredSundays: (v.sundays || []).map(Number),
          servicePreference: v.service || 'both',
          notes: v.notes || '', submittedAt: v.submittedAt
        };
      });
      result.sort(function(a, b) { return (b.submittedAt || '').localeCompare(a.submittedAt || ''); });
      _pendingSignups = result;
      savePendingSignups(result);
      updateSignupsBadge();
      return;
    } catch(e) { /* fall through to Firebase */ }
  }
  _pendingSignups = getPendingSignups();
  updateSignupsBadge();
}

function updateSignupsBadge() {
  var n = _pendingSignups.length;
  var badge = document.getElementById('signups-badge');
  var btn   = document.getElementById('review-signups-btn');
  var count = document.getElementById('review-signups-count');
  if (badge) { badge.textContent = n > 0 ? n : ''; badge.style.display = n > 0 ? '' : 'none'; }
  if (btn)   btn.style.display   = n > 0 ? '' : 'none';
  if (count) count.textContent   = n;
}

function renderSignupsPanel() {
  var list = document.getElementById('signups-list');
  if (!list) return;
  if (!_pendingSignups.length) {
    list.innerHTML = '<div class="empty-state"><div class="icon">&#128203;</div><p>No pending scheduler sign-ups</p></div>';
    return;
  }
  var svcLabels = { 'both': 'Both Services', '8am': '8:00 AM only', '10:45am': '10:45 AM only' };
  var html = '';
  _pendingSignups.forEach(function(s, idx) {
    var roles = (s.roles || []).map(function(r) {
      return '<span class="tag tag-role">' + esc(SHARED_LABELS[r] || r) + '</span>';
    }).join(' ');
    var sundays = (s.preferredSundays && s.preferredSundays.length)
      ? s.preferredSundays.map(function(n) { return n + ordSuffix(n); }).join(', ')
      : 'Flexible';
    var svc = svcLabels[s.servicePreference] || s.servicePreference || 'Both Services';
    var submitted = s.submittedAt ? new Date(s.submittedAt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '';
    html += '<div class="signup-card">'
      + '<div class="signup-card-name">' + esc(s.name || '') + '</div>'
      + '<div class="signup-card-email">' + esc(s.email || '') + '</div>'
      + (submitted ? '<div class="signup-card-date">Submitted ' + esc(submitted) + '</div>' : '')
      + '<div class="signup-card-meta">'
      +   '<div><span class="sc-label">Roles: </span>' + (roles || '—') + '</div>'
      +   '<div><span class="sc-label">Service: </span>' + esc(svc) + '</div>'
      +   '<div><span class="sc-label">Preferred Sundays: </span>' + esc(sundays) + '</div>'
      + '</div>'
      + '<div class="signup-card-actions">'
      +   '<button class="btn btn-success btn-sm" onclick="approveSignup(' + idx + ')">&#10003; Add as Volunteer</button>'
      +   '<button class="btn btn-outline btn-sm" onclick="dismissSignup(' + idx + ')">Dismiss</button>'
      + '</div>'
      + '</div>';
  });
  list.innerHTML = html;
}

function approveSignup(idx) {
  var s = _pendingSignups[idx];
  if (!s) return;
  var people = getPeople();
  // Check for duplicate email
  var dup = s.email && people.some(function(p) { return p.email && p.email.toLowerCase() === s.email.toLowerCase(); });
  if (dup && !confirm('"' + s.name + '" (' + s.email + ') is already in your People list. Add them again?')) return;
  var person = {
    id: makeId(),
    name: s.name || '',
    email: s.email || '',
    preferredSundays: s.preferredSundays || [],
    servicePreference: s.servicePreference || 'both',
    roles: s.roles || [],
    primaryFor: [],
    roleSundayOverrides: {},
    breezePersonId: null,
    blackoutDates: []
  };
  people.push(person);
  savePeople(people);
  queueD1Push();
  _removeSignup(idx);
  renderPeopleList();
  showAlert('signup-review-alert', esc(person.name) + ' has been added to your volunteer list.', 'success');
}

function dismissSignup(idx) {
  _removeSignup(idx);
  showAlert('signup-review-alert', 'Sign-up dismissed.', 'info');
}

function _removeSignup(idx) {
  var s = _pendingSignups[idx];
  if (s) {
    var settings = getBreezeSettings();
    if (s.id && settings.workerUrl) {
      fetch(settings.workerUrl + '/volunteer/claim', {
        method: 'POST', headers: _workerHeaders(), body: JSON.stringify({ id: s.id })
      }).catch(function() {});
    }
  }
  _pendingSignups.splice(idx, 1);
  savePendingSignups(_pendingSignups);
  updateSignupsBadge();
  renderSignupsPanel();
}

// ── General volunteer list (non-scheduler worship + other ministries) ─

async function fetchGeneralVolunteers() {
  var s = getBreezeSettings();
  if (!s.workerUrl) { _generalVolunteers = getGeneralVolunteers(); updateGeneralBadge(); return; }
  try {
    var r = await fetch(s.workerUrl + '/volunteer/general-pending', { headers: _workerHeaders() });
    var data = await r.json();
    var result = (data.volunteers || []).sort(function(a, b) {
      return (b.submittedAt || '').localeCompare(a.submittedAt || '');
    });
    _generalVolunteers = result;
    saveGeneralVolunteers(result);
    updateGeneralBadge();
  } catch(e) {
    _generalVolunteers = getGeneralVolunteers();
    updateGeneralBadge();
  }
}

function updateGeneralBadge() {
  var n = _generalVolunteers.length;
  var btn   = document.getElementById('review-general-btn');
  var count = document.getElementById('review-general-count');
  if (btn)   btn.style.display = n > 0 ? '' : 'none';
  if (count) count.textContent = n;
}

function renderGeneralPanel() {
  var list = document.getElementById('general-list');
  if (!list) return;
  if (!_generalVolunteers.length) {
    list.innerHTML = '<div class="empty-state"><div class="icon">&#128101;</div><p>No pending general volunteer sign-ups</p></div>';
    return;
  }
  var ministryLabels = { worship: 'Worship', education: 'Christian Education',
    acceptance: 'Acceptance Ministry', outreach: 'Outreach', general: 'General Interest', events: 'Community Events' };
  var html = '';
  _generalVolunteers.forEach(function(v, idx) {
    var roles = (v.roles || []).map(function(r) {
      return '<span class="tag tag-role">' + esc(r) + '</span>';
    }).join(' ');
    var ministry = ministryLabels[v.ministry] || (v.ministry || 'Unknown');
    var submitted = v.submittedAt ? new Date(v.submittedAt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '';
    html += '<div class="signup-card">'
      + '<div class="signup-card-name">' + esc(v.name || '') + '</div>'
      + '<div class="signup-card-email">' + esc(v.email || '') + '</div>'
      + (submitted ? '<div class="signup-card-date">Submitted ' + esc(submitted) + '</div>' : '')
      + '<div class="signup-card-meta">'
      +   '<div><span class="sc-label">Ministry: </span>' + esc(ministry) + '</div>'
      +   (roles ? '<div><span class="sc-label">Roles/Interest: </span>' + roles + '</div>' : '')
      +   (v.phone ? '<div><span class="sc-label">Phone: </span>' + esc(v.phone) + '</div>' : '')
      +   (v.notes ? '<div><span class="sc-label">Notes: </span>' + esc(v.notes) + '</div>' : '')
      + '</div>'
      + '<div class="signup-card-actions">'
      +   '<button class="btn btn-outline btn-sm" onclick="dismissGeneralVolunteer(' + idx + ')">Dismiss</button>'
      + '</div>'
      + '</div>';
  });
  list.innerHTML = html;
}

function dismissGeneralVolunteer(idx) {
  _removeGeneralVolunteer(idx);
  showAlert('general-review-alert', 'Entry dismissed.', 'info');
}

function _removeGeneralVolunteer(idx) {
  var v = _generalVolunteers[idx];
  if (v && v.id) {
    var settings = getBreezeSettings();
    if (settings.workerUrl) {
      fetch(settings.workerUrl + '/volunteer/general-claim', {
        method: 'POST', headers: _workerHeaders(), body: JSON.stringify({ id: v.id })
      }).catch(function() {});
    }
  }
  _generalVolunteers.splice(idx, 1);
  saveGeneralVolunteers(_generalVolunteers);
  updateGeneralBadge();
  renderGeneralPanel();
}

// ── Event volunteer list ──────────────────────────────────────────

async function fetchEventVolunteers() {
  var s = getBreezeSettings();
  if (!s.workerUrl) { _eventVolunteers = getEventVolunteers(); updateEventBadge(); return; }
  try {
    var r = await fetch(s.workerUrl + '/volunteer/event-pending', { headers: _workerHeaders() });
    var data = await r.json();
    var result = (data.volunteers || []).sort(function(a, b) {
      return (b.submittedAt || '').localeCompare(a.submittedAt || '');
    });
    _eventVolunteers = result;
    saveEventVolunteers(result);
    updateEventBadge();
  } catch(e) {
    _eventVolunteers = getEventVolunteers();
    updateEventBadge();
  }
}

function updateEventBadge() {
  var n = _eventVolunteers.length;
  var count = document.getElementById('review-events-count');
  if (count) count.textContent = n;
}

function renderEventsPanel() {
  var list = document.getElementById('events-list');
  if (!list) return;

  // Build a map: role name → array of volunteer records
  var roleToVols = {};
  _eventVolunteers.forEach(function(v, idx) {
    (v.roles || []).forEach(function(r) {
      if (!roleToVols[r]) roleToVols[r] = [];
      roleToVols[r].push({ vol: v, idx: idx });
    });
  });

  // Extra roles added by admin (stored in localStorage)
  var storedRoles = getEventRoles();

  var html = '';
  COMMUNITY_EVENTS.forEach(function(evt) {
    // Merge base roles with any admin-added roles for this event
    var extraRoles = storedRoles[evt.id] || [];
    var allRoles = evt.roles.concat(extraRoles.filter(function(r) { return evt.roles.indexOf(r) === -1; }));

    // Count total sign-ups for this event
    var totalSignups = 0;
    allRoles.forEach(function(r) { totalSignups += (roleToVols[r] || []).length; });

    html += '<div class="ev-admin-card" id="evcard-' + evt.id + '">';
    html += '<div class="ev-admin-header" onclick="toggleEvAdminCard(\\'' + evt.id + '\\')">'
      + '<span class="ev-admin-toggle">&#9658;</span>'
      + '<span class="ev-admin-title">' + esc(evt.name) + '</span>'
      + '<span class="ev-admin-date">' + esc(evt.date) + '</span>'
      + '<span class="ev-admin-count">' + totalSignups + ' signed up</span>'
      + '</div>';

    html += '<div class="ev-admin-body" id="evbody-' + evt.id + '">';

    allRoles.forEach(function(role) {
      var vols = roleToVols[role] || [];
      html += '<div class="ev-role-row">'
        + '<div class="ev-role-label">' + esc(role) + '</div>'
        + '<div class="ev-role-signups">';
      if (vols.length === 0) {
        html += '<span class="ev-role-empty">No sign-ups yet</span>';
      } else {
        vols.forEach(function(entry) {
          var v = entry.vol;
          var submitted = v.submittedAt ? new Date(v.submittedAt).toLocaleDateString('en-US', { month:'short', day:'numeric' }) : '';
          html += '<div class="ev-signup-row">'
            + '<span class="ev-signup-name">' + esc(v.name || '') + '</span>'
            + '<span class="ev-signup-email">' + esc(v.email || '') + '</span>'
            + (v.phone ? '<span class="ev-signup-email">' + esc(v.phone) + '</span>' : '')
            + (submitted ? '<span class="ev-signup-email">' + esc(submitted) + '</span>' : '')
            + '<button class="btn btn-outline btn-sm" onclick="dismissEventVolunteer(' + entry.idx + ')" style="padding:1px 8px;font-size:.72rem;">Dismiss</button>'
            + '</div>';
        });
      }
      html += '</div></div>';
    });

    html += '<div class="ev-admin-add-role">'
      + '<button class="btn btn-outline btn-sm" onclick="addEventRole(\\'' + evt.id + '\\')" style="font-size:.78rem;">&#65291; Add Role</button>'
      + '</div>';

    html += '</div></div>'; // close body + card
  });

  list.innerHTML = html;
}

function toggleEvAdminCard(eventId) {
  var header = document.querySelector('#evcard-' + eventId + ' .ev-admin-header');
  var body   = document.getElementById('evbody-' + eventId);
  if (!header || !body) return;
  var isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  header.classList.toggle('open', !isOpen);
}

function addEventRole(eventId) {
  var roleName = prompt('Enter new role name:');
  if (!roleName || !roleName.trim()) return;
  var stored = getEventRoles();
  if (!stored[eventId]) stored[eventId] = [];
  if (stored[eventId].indexOf(roleName.trim()) === -1) {
    stored[eventId].push(roleName.trim());
    saveEventRoles(stored);
  }
  renderEventsPanel();
  // Re-open the card so the user sees the new role
  var body = document.getElementById('evbody-' + eventId);
  var header = document.querySelector('#evcard-' + eventId + ' .ev-admin-header');
  if (body) body.classList.add('open');
  if (header) header.classList.add('open');
}

function dismissEventVolunteer(idx) {
  _removeEventVolunteer(idx);
  showAlert('events-review-alert', 'Entry dismissed.', 'info');
}

function _removeEventVolunteer(idx) {
  var v = _eventVolunteers[idx];
  if (v && v.id) {
    var settings = getBreezeSettings();
    if (settings.workerUrl) {
      fetch(settings.workerUrl + '/volunteer/event-claim', {
        method: 'POST', headers: _workerHeaders(), body: JSON.stringify({ id: v.id })
      }).catch(function() {});
    }
  }
  _eventVolunteers.splice(idx, 1);
  saveEventVolunteers(_eventVolunteers);
  updateEventBadge();
  renderEventsPanel();
}

document.getElementById('btn-close-signups-panel').addEventListener('click', closeAllPanels);
document.getElementById('btn-close-general-panel').addEventListener('click', closeAllPanels);
document.getElementById('btn-close-events-panel').addEventListener('click', closeAllPanels);

// ── Auto-logout after 2 hours of inactivity (skip when embedded — parent handles it) ──
(function(){
  if (_embedded) return;
  var MS=2*60*60*1000,WARN=2*60*1000,t,w,b;
  function reset(){
    clearTimeout(t);clearTimeout(w);
    if(b)b.style.display='none';
    w=setTimeout(function(){
      if(!b){
        b=document.createElement('div');
        b.id='inact-warn';
        b.style.cssText='position:fixed;top:0;left:0;right:0;background:#c0392b;color:#fff;text-align:center;padding:10px 16px;z-index:99999;font-size:.9rem;font-family:sans-serif;';
        b.appendChild(document.createTextNode('Signing out in 2 minutes due to inactivity. '));
        var btn=document.createElement('button');
        btn.textContent='Stay Signed In';
        btn.style.cssText='margin-left:10px;background:#fff;color:#c0392b;border:none;padding:3px 10px;border-radius:4px;cursor:pointer;font-weight:600;';
        btn.addEventListener('click',function(){b.style.display='none';reset();});
        b.appendChild(btn);
        document.body.appendChild(b);
      } else b.style.display='block';
    },MS-WARN);
    t=setTimeout(function(){location.href='/admin/logout';},MS);
  }
  ['click','keydown','mousemove','touchstart'].forEach(function(e){document.addEventListener(e,reset,{passive:true});});
  window.reset=reset;reset();
})();

</script>

</body>
</html>
`
