// v3 design shell: header, grouped sidebar, page title, and the shared stylesheet every page
// inherits. Pure string rendering -- the page CSP allows no script, so every control here is a
// plain link or form, and every visual (bars, meters) is CSS.
import { FINANCE_PARITY_SECTIONS, groupFinanceSections } from './parity-manifest.js';
import { roleCanAccessSection } from './connect-role-client.js';
import { escapeHtml } from './render-helpers.js';

const ROLE_LABELS = Object.freeze({
  admin: 'Admin', finance: 'Finance', staff: 'Staff', council: 'Council', compensation: 'Compensation',
});

export function roleLabel(role) {
  return ROLE_LABELS[role] || (role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Unverified');
}

// Two-letter initials from a verified identity (an email address); never guesses a name.
export function identityInitials(identity) {
  if (!identity) return '';
  const local = String(identity).split('@')[0].replace(/[^a-z0-9._-]/gi, '');
  const parts = local.split(/[._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return letters.toUpperCase();
}

function pageHref(section, page, { councilPreview } = {}) {
  const base = section.pages.length <= 1 ? `/?section=${section.id}` : `/?section=${section.id}&amp;page=${page.id}`;
  return councilPreview ? `${base}&amp;council=1` : base;
}

// One sidebar entry per design group ("Accounts & Data" folds two sections together). The active
// group opens to list its pages; a single-page group is a plain link. When the role is verified,
// sections that role cannot open are left out rather than shown and then refused.
export function renderSectionNav(activeSection, activePage, { roleResult, councilPreview } = {}) {
  const visible = roleResult && roleResult.ok
    ? FINANCE_PARITY_SECTIONS.filter((s) => roleCanAccessSection(roleResult.role, s, roleResult.permissions))
    : FINANCE_PARITY_SECTIONS;
  return groupFinanceSections(visible).map(({ group, sections }) => {
    const pages = sections.flatMap((section) => section.pages.map((page) => ({ section, page })));
    const isActiveGroup = sections.some((s) => s.id === activeSection.id);
    const first = pages[0];
    if (pages.length <= 1) {
      return `<div class="nav-group"><a class="nav-item${isActiveGroup ? ' is-active' : ''}" href="${pageHref(first.section, first.page, { councilPreview })}"${isActiveGroup ? ' aria-current="page"' : ''}>${escapeHtml(group)}</a></div>`;
    }
    const links = isActiveGroup
      ? `<div class="nav-pages">${pages.map(({ section, page }) => {
        const current = section.id === activeSection.id && page.id === activePage.id;
        const label = section.pages.length <= 1 ? section.label : page.label;
        return `<a href="${pageHref(section, page, { councilPreview })}"${current ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a>`;
      }).join('')}</div>`
      : '';
    return `<div class="nav-group${isActiveGroup ? ' is-open' : ''}"><a class="nav-item${isActiveGroup ? ' is-active' : ''}" href="${pageHref(first.section, first.page, { councilPreview })}">${escapeHtml(group)}<span class="nav-count">${pages.length}</span></a>${links}</div>`;
  }).join('');
}

// "Viewing as": the verified role, or a council preview that hides editing controls. The design's
// prototype let anyone flip roles; here only the preview is switchable, and it never changes what
// the server authorizes.
export function renderViewingAs(section, page, { roleResult, councilPreview }) {
  const role = roleResult && roleResult.ok ? roleResult.role : null;
  const own = roleLabel(role);
  const base = pageHref(section, page);
  const ownOption = councilPreview
    ? `<a href="${base}" title="Return to your own verified view">${escapeHtml(own)}</a>`
    : `<span class="is-on" aria-current="true">${escapeHtml(own)}</span>`;
  const councilOption = role === 'council' ? '' : councilPreview
    ? '<span class="is-on" aria-current="true">Council</span>'
    : `<a href="${base}&amp;council=1" title="Preview council view: hides editing controls without changing permissions">Council</a>`;
  return `<div class="viewing-as"><span class="viewing-label">Viewing as</span><div class="segmented">${ownOption}${councilOption}</div></div>`;
}

export const SHELL_STYLES = `
    @font-face { font-family:"Outfit"; src:url(/assets/fonts/outfit.woff2) format("woff2"); font-weight:100 900; font-display:swap; }
    @font-face { font-family:"Figtree"; src:url(/assets/fonts/figtree.woff2) format("woff2"); font-weight:300 900; font-display:swap; }
    :root { color-scheme: light; font-family:"Figtree", system-ui, -apple-system, "Segoe UI", sans-serif;
      --ink:#16213A; --navy:#1B2A4A; --gold:#C9973A; --gold-ink:#8A611C; --teal:#2E7EA6; --muted:#5B6475; --faint:#8A93A5;
      --green:#2F7D5B; --red:#B4412F; --line:#E3E6EC; --line-soft:#EEF0F4; --page:#F4F5F7; --card:#FFFFFF; --hover:#EEF1F6; --cream:#F3E6CB;
      /* legacy aliases still read by payroll/print styles */
      --charcoal:var(--ink); --warm-gray:var(--muted); --warm-meta:var(--gold-ink); --warm-label:var(--muted);
      --border:var(--line); --divider:var(--line-soft); --header:#F7F8FA; --sage:var(--green); }
    * { box-sizing:border-box; }
    body { min-height:100vh; margin:0; background:var(--page); color:var(--ink); -webkit-font-smoothing:antialiased; font-variant-numeric:tabular-nums; }
    a { color:var(--navy); text-decoration:underline; text-decoration-color:var(--gold); text-underline-offset:3px; }
    a:hover { color:var(--gold-ink); }
    h1, h2, h3, .display { font-family:"Outfit", "Figtree", system-ui, sans-serif; font-weight:500; color:var(--navy); letter-spacing:-.01em; }
    .app-header { position:sticky; top:0; z-index:5; background:#fff; border-bottom:1px solid var(--line); }
    .app-header-row { display:flex; align-items:center; gap:16px; height:64px; padding:0 clamp(16px,3vw,28px); }
    .sidebar-brand { display:flex; align-items:center; gap:12px; flex-shrink:0; text-decoration:none; }
    .sidebar-brand img { width:40px; height:40px; }
    .brand-text { display:flex; flex-direction:column; line-height:1.1; }
    .brand-name { font-family:"Outfit", sans-serif; font-weight:600; font-size:19px; color:var(--navy); }
    .brand-sub { font-size:11px; letter-spacing:.12em; color:var(--gold-ink); text-transform:uppercase; }
    .env-pill { padding:4px 10px; border-radius:999px; background:var(--cream); color:var(--gold-ink); font-size:12px; font-weight:600; }
    .header-right { margin-left:auto; display:flex; align-items:center; gap:12px; flex-shrink:0; }
    .viewing-as { display:flex; align-items:center; gap:10px; }
    .viewing-label { font-size:12px; color:var(--muted); }
    .segmented { display:flex; gap:2px; padding:3px; border-radius:8px; background:var(--page); }
    .segmented a, .segmented span { padding:6px 11px; border-radius:6px; color:var(--ink); font-size:13px; text-decoration:none; }
    .segmented a:hover { background:#fff; color:var(--navy); }
    .segmented .is-on { background:var(--navy); color:#fff; }
    .avatar { width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:var(--cream); color:var(--gold-ink); font-size:13px; font-weight:600; }
    .app-shell { display:flex; flex-wrap:wrap; align-items:stretch; min-height:calc(100vh - 65px); }
    .app-sidebar { flex:1 1 220px; max-width:260px; background:#fff; border-right:1px solid var(--line); padding:14px 10px 40px; }
    nav { display:flex; flex-direction:column; gap:1px; }
    .nav-group { display:flex; flex-direction:column; }
    .nav-item { display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border-radius:6px; color:var(--ink); font-size:14px; font-weight:600; text-decoration:none; }
    .nav-item:hover { background:var(--page); color:var(--navy); }
    .nav-item.is-active { color:var(--navy); }
    .nav-group:not(.is-open) > .nav-item.is-active { background:var(--hover); }
    .nav-count { font-size:11px; color:var(--faint); font-weight:500; }
    .nav-pages { display:flex; flex-direction:column; gap:1px; padding:2px 0 8px; }
    .nav-pages a { padding:6px 10px 6px 22px; border-radius:6px; color:var(--muted); font-size:13.5px; text-decoration:none; }
    .nav-pages a:hover { color:var(--navy); }
    .nav-pages a[aria-current="page"] { background:var(--hover); color:var(--navy); font-weight:600; }
    .sidebar-foot { margin:18px 10px 0; padding-top:12px; border-top:1px solid var(--line); color:var(--faint); font-size:11.5px; line-height:1.5; }
    main { flex:999 1 620px; min-width:0; max-width:1320px; padding:24px clamp(16px,3vw,36px) 64px; }
    .page-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; flex-wrap:wrap; }
    .page-head .eyebrow { font-size:12px; }
    .page-head .print-link { font-size:13px; font-weight:600; color:var(--green, #1f6b45); text-decoration:none; border:1px solid currentColor; border-radius:6px; padding:4px 10px; }
    .page-title { margin:4px 0 0; font-size:32px; line-height:1.15; }
    .eyebrow { color:var(--gold-ink); font-size:11.5px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; }
    p { color:var(--muted); line-height:1.55; }
    h2 { font-size:20px; margin:.2rem 0 0; }
    h3 { font-size:17px; }
    .notice { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:16px; padding:10px 14px; border:1px solid var(--line); border-left:3px solid var(--gold); border-radius:8px; background:#fff; color:var(--muted); font-size:13px; }
    .notice b { color:var(--ink); font-weight:600; }
    .notice a { margin-left:auto; }
    .status { margin-top:1rem; padding:10px 14px; border:1px solid #CFE3D8; border-radius:8px; background:#EFF7F2; color:var(--green); font-size:13.5px; font-weight:600; }
    .status-error { border-color:#EBCFC9; background:#FBEFEC; color:var(--red); }
    .status-pending { border-color:var(--line); background:#fff; color:var(--muted); }
    form { margin-top:1.25rem; }
    .form-grid { margin-top:0; }
    .field { display:flex; flex-direction:column; gap:5px; margin-top:14px; }
    .field:first-child { margin-top:0; }
    label { color:var(--muted); font-size:12.5px; font-weight:600; }
    input, select, textarea { padding:9px 11px; border:1px solid #D5DAE3; border-radius:8px; background:#fff; color:var(--ink); font-size:14px; font-family:inherit; }
    input:focus, select:focus, textarea:focus { outline:2px solid rgba(46,126,166,.25); border-color:var(--teal); }
    button { margin-top:1.2rem; padding:9px 16px; border:none; border-radius:8px; background:var(--navy); color:#fff; font:inherit; font-size:14px; font-weight:600; cursor:pointer; }
    button:hover { background:#14203A; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:14px; margin-top:18px; }
    .card { display:flex; flex-direction:column; gap:6px; padding:18px 20px; border:1px solid var(--line); border-radius:10px; background:var(--card); }
    .card small { display:block; color:var(--muted); font-size:13px; }
    .card strong { font-family:"Outfit", sans-serif; font-size:28px; font-weight:500; color:var(--navy); line-height:1.1; font-variant-numeric:tabular-nums; }
    .card span, .decision span { display:block; color:var(--muted); font-size:13px; line-height:1.45; }
    .section-heading { display:flex; justify-content:space-between; gap:1rem; align-items:end; margin-top:28px; }
    .section-heading h2 { margin:.2rem 0 0; font-size:20px; }
    .badge { padding:4px 10px; border-radius:999px; background:#EAF3F8; color:var(--teal); font-size:12px; font-weight:600; white-space:nowrap; }
    .decision-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(13rem,1fr)); gap:14px; margin-top:14px; }
    .decision { padding:16px 18px; border:1px solid var(--line); border-radius:10px; background:#fff; }
    .decision small, .decision b { display:block; }
    .decision small { color:var(--gold-ink); font-size:11.5px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; }
    .decision b { color:var(--navy); margin-top:4px; font-weight:600; }
    .table-wrap { overflow-x:auto; margin-top:14px; border:1px solid var(--line); border-radius:10px; background:#fff; }
    table { width:100%; border-collapse:collapse; font-size:13.5px; }
    th, td { padding:10px 14px; border-bottom:1px solid var(--line-soft); text-align:left; }
    tr:last-child td { border-bottom:0; }
    th:nth-child(n+3), td:nth-child(n+3) { text-align:right; font-variant-numeric:tabular-nums; }
    th { color:var(--muted); background:#F7F8FA; font-size:12px; font-weight:600; }
    .report { margin-top:6px; }
    .source-tag { display:flex; justify-content:flex-end; margin-top:-6px; }
    .dashboard-intro { margin-bottom:.25rem; }
    .dashboard-title { margin:.25rem 0 0; font-size:26px; line-height:1.15; }
    .attention-list { margin:12px 0 0; padding:0; list-style:none; display:flex; flex-direction:column; gap:8px; }
    .attention-list li { padding:12px 16px; border:1px solid var(--line); border-left:3px solid var(--gold); border-radius:8px; background:#fff; color:var(--ink); font-size:14px; }
    body.council-preview form[method="POST"] { display:none; }
    .parity, .unavailable { margin-top:18px; padding:20px 22px; border:1px solid var(--line); border-radius:10px; background:#fff; }
    .parity h2 { margin:0 0 .5rem; }
    .parity ul { columns:2; color:var(--muted); line-height:1.8; }
    .page-foot { margin-top:40px; padding-top:14px; border-top:1px solid var(--line); color:var(--faint); font-size:12.5px; }
    .page-foot p { margin:0 0 6px; color:var(--faint); font-size:12.5px; }
    @media(max-width:767px){ .app-header-row{height:auto;flex-wrap:wrap;padding:10px 16px} .header-right{margin-left:0;width:100%;justify-content:space-between} .app-sidebar{max-width:none;flex-basis:100%;padding:8px 10px;border-right:0;border-bottom:1px solid var(--line)} nav{flex-direction:row;flex-wrap:wrap;gap:4px} .nav-group{display:contents} .nav-count{display:none} .nav-item{padding:6px 10px;border:1px solid var(--line);font-size:13px} .nav-pages{flex-basis:100%;flex-direction:row;flex-wrap:wrap;padding:4px 0} .nav-pages a{padding:6px 10px} .sidebar-foot{display:none} main{padding:18px 16px 48px} .section-heading{align-items:start;flex-direction:column} .grid{grid-template-columns:1fr} .parity ul{columns:1} .page-title{font-size:26px} }
    /* ── Payroll ── */
    .pay-toolbar { display:flex; align-items:center; gap:1rem; flex-wrap:wrap; margin-top:1rem; }
    .pay-toolbar select { min-width:14rem; }
    .pay-tab { padding:7px 12px; border:1px solid var(--line); border-radius:8px; background:#fff; color:var(--muted); font-size:13px; font-weight:600; text-decoration:none; }
    .pay-tab.is-on { border-color:var(--navy); background:var(--navy); color:#fff; }
    .pay-note { display:block; color:var(--muted); font-size:12.5px; margin-top:.2rem; }
    .pay-pill { display:inline-block; padding:3px 9px; border-radius:999px; font-size:12px; font-weight:600; white-space:nowrap; }
    .pay-pill-good { background:#E6F2EC; color:var(--green); }
    .pay-pill-warn { background:#FBF1DC; color:var(--gold-ink); }
    .pay-pill-plain { background:var(--page); color:var(--muted); }
    .pay-in { width:5.5rem; padding:6px 8px; text-align:right; font-size:14px; }
    .pay-in[readonly] { background:#F7F8FA; }
    .pay-group { margin:1.4rem 0 .6rem; color:var(--gold-ink); font-size:11.5px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; }
    .pay-card { border:1px solid var(--line); border-radius:10px; overflow:hidden; background:#fff; margin-top:14px; }
    .pay-card-bar { padding:10px 16px; background:#F7F8FA; color:var(--muted); font-size:12.5px; font-weight:600; caption-side:top; text-align:left; }
    .pay-li { display:flex; justify-content:space-between; gap:1rem; padding:9px 16px; border-bottom:1px solid var(--line-soft); font-size:14px; }
    .pay-li:last-child { border-bottom:0; }
    .pay-li.muted { color:var(--muted); }
    .pay-li.neg { color:var(--red); }
    .pay-li.total { background:#F7F8FA; font-weight:600; }
    .pay-combined { display:flex; align-items:center; gap:1rem; flex-wrap:wrap; margin-top:1rem; padding:16px 20px; border:1px solid var(--line); border-left:3px solid var(--gold); border-radius:10px; background:#fff; }
    .pay-combined b { margin-left:auto; font-family:"Outfit", sans-serif; font-size:26px; font-weight:500; color:var(--navy); }
    .pay-warn { margin-top:1rem; padding:12px 16px; border:1px solid #EBCFC9; border-radius:8px; background:#FBEFEC; color:var(--red); font-size:14px; }
    .pay-foot { display:flex; align-items:center; gap:1rem; flex-wrap:wrap; margin-top:1rem; padding-top:1rem; border-top:1px solid var(--line); }
    .pay-approve { background:var(--gold); color:#1B1608; }
    .pay-approve.is-done { background:#fff; color:var(--navy); border:1px solid var(--line); }
    #pay-print { display:none; }
    .pt-header h2 { margin:0; font-size:1.05rem; color:var(--navy); }
    .pt-period { color:var(--muted); font-size:.75rem; }
    .pt-section { margin:.85rem 0; }
    .pt-section-label { font-size:.68rem; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); border-bottom:1.5px solid var(--line); padding-bottom:.15rem; margin-bottom:.25rem; }
    .pt-table { width:100%; border-collapse:collapse; font-size:.78rem; }
    .pt-table th { text-align:left; padding:.2rem .5rem; background:#F7F8FA; font-size:.65rem; text-transform:uppercase; }
    .pt-table td { padding:.2rem .5rem; }
    .pt-table .pt-num { text-align:right; font-variant-numeric:tabular-nums; }
    .pt-table .pt-sub td { font-weight:700; background:#F7F8FA; }
    .pt-total { display:flex; justify-content:space-between; margin-top:.6rem; padding:.55rem .75rem; border-radius:.5rem; background:var(--navy); color:#fff; font-weight:700; }
    .pt-warn { margin:0 0 .75rem; padding:.55rem .75rem; border:1px solid #EBCFC9; border-radius:.5rem; background:#FBEFEC; color:var(--red); font-size:.78rem; }
    @media print {
      .app-header, .app-sidebar, nav, .pay-toolbar, form, .status, .notice, .page-foot, .page-head { display:none !important; }
      .app-shell { display:block; }
      body { background:#fff; }
      #pay-print { display:block !important; }
    }
`;

// Pages written before v3 open with their own eyebrow + <h2> (renderSectionHeading). When that
// first heading only repeats the new page title, drop the repeat and keep its badge (the data
// source label) as a right-aligned tag, so the page reads as one title with one source label.
export function collapseDuplicateHeading(body, pageTitle) {
  const match = /<div class="section-heading(?: trend-heading)?"><div><div class="eyebrow">[^<]*<\/div><h2>([^<]*)<\/h2><\/div>(<span class="badge">.*?<\/span>)?<\/div>/.exec(body);
  if (!match) return body;
  const before = body.slice(0, match.index);
  if (/<h[12]\b/.test(before)) return body; // not the page's opening heading
  const norm = (text) => text.replace(/&amp;/g, '&').trim().toLowerCase();
  if (norm(match[1]) !== norm(escapeHtml(pageTitle))) return body;
  const badge = match[2] ? `<div class="source-tag">${match[2]}</div>` : '';
  return before + badge + body.slice(match.index + match[0].length);
}
