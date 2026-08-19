export const JS_FINANCE = String.raw`// ── FINANCE OVERVIEW ─────────────────────────────────────────────────
// Unifies QuickBooks Online (Budget vs Actual + account balances, live OAuth sync) and
// daycare financials (manual entries — no known daycare-app API/export yet) in one tab.
var _finStatus = {};
var _finDaycare = [];
var _finOverview = {};
var _finDaycareAgg = null; // last computed finAggregateDaycareByYear() result, cached for CSV export

function loadFinance() {
  finCheckOauthReturn();
  var loadingEl = document.getElementById('fin-loading');
  var rootEl = document.getElementById('fin-root');
  loadingEl.style.display = '';
  loadingEl.textContent = 'Loading…';
  rootEl.style.display = 'none';
  Promise.all([
    api('/admin/api/finance/status'),
    api('/admin/api/finance/overview'),
    api('/admin/api/finance/daycare'),
  ]).then(function(results) {
    _finStatus = results[0] || {};
    var overview = results[1] || {};
    _finDaycare = (results[2] && results[2].entries) || [];
    _finOverview = overview;
    loadingEl.style.display = 'none';
    rootEl.style.display = '';
    // The Data & Imports tab owns the DOM that finRenderConnection/finRenderBudget/
    // finRenderAccounts/finRenderDaycare write into, so it has to be built before they run —
    // finRenderDataImports() mounts those containers and then calls them itself.
    finRenderDataImports();
    finRenderChurchReport();
    finRenderDaycareReport();
    finLoadDaycareRooms();
    finLoadProperty();
    finLoadPlanning();
    finLoadHealth();
  }).catch(function(err) {
    if (err && err.message === 'Unauthorized') return;
    loadingEl.textContent = 'Could not load finance data.';
  });
}

// ── Sub-nav: Financial Health / Church / Daycare / Property / Planning / Compensation / Data ──
// Button active-state is handled by the shared renderFinanceSubnav() (js-core.js) re-render,
// driven by showTab()'s _finActiveNavId — this only toggles panel visibility.
function finShowSection(section) {
  ['health', 'church', 'daycare', 'property', 'planning', 'compensation', 'data'].forEach(function(s) {
    var panel = document.getElementById('fin-panel-' + s);
    if (panel) panel.style.display = (s === section) ? '' : 'none';
  });
}

// ── Shared building blocks for the redesigned pages ─────────────────────────────────────────
// A labeled horizontal bar — the redesign's single most repeated element (revenue streams,
// revenue sources, room occupancy, plan-vs-actual). One helper rather than a dozen hand-built
// copies, so the track color, radius and label typography can never drift apart between pages.
function finBar(label, valueHtml, pct, color, opts) {
  opts = opts || {};
  var h = opts.height || 10;
  return '<div style="display:flex;justify-content:space-between;font-size:12.5px;' + (opts.labelWeight === false ? '' : '') + '">'
    + '<span style="color:var(--warm-ink-label);font-weight:600;">' + label + '</span>'
    + '<b style="font-variant-numeric:tabular-nums;">' + valueHtml + '</b></div>'
    + '<div style="height:' + h + 'px;border-radius:6px;background:var(--linen);' + (opts.trackStyle || '') + '">'
    + '<div style="width:' + Math.max(0, Math.min(100, pct)) + '%;height:100%;border-radius:6px;background:' + color + ';"></div></div>';
}
// Page header shared by every redesigned finance screen: display-font title, one line of context,
// and the screen's own actions on the right.
function finPageHeader(title, sub, actionsHtml) {
  return '<div class="fin-page-hdr">'
    + '<div><h2 class="fin-page-title">' + title + '</h2><div class="fin-page-sub">' + sub + '</div></div>'
    + '<div class="fin-page-actions">' + (actionsHtml || '') + '</div></div>';
}
// A pill group (Church Report's mode switch, the appeal card's scope switch). Deliberately its own
// class rather than a reuse of .fin-comp-pills — the Compensation tab is out of scope for this
// redesign and must not gain a shared dependency on it.
function finPills(items, activeKey, handler) {
  return '<div class="fin-scope-pills">' + items.map(function(i) {
    return '<button class="fin-scope-pill' + (i.key === activeKey ? ' active' : '') + '" onclick="' + handler + '(' + jsAttr(i.key) + ')">' + esc(i.label) + '</button>';
  }).join('') + '</div>';
}
// Rounded whole-dollar money for the display-scale figures (KPI values, chart labels), where the
// cents are noise. Table cells and ledgers keep finFmtMoney's two decimals.
function finMoney0(cents) {
  return '$' + Math.round((cents || 0) / 100).toLocaleString('en-US');
}
function finPctLabel(fraction) {
  return (fraction == null || !isFinite(fraction)) ? '—' : Math.round(fraction * 100) + '%';
}
// A card body that could not load. Scoped to one card by design (see the handoff's Loading
// section): one dead endpoint must never blank the whole page.
function finCardError(what) {
  return '<p style="font-size:.85rem;color:var(--warm-gray);">Could not load ' + what + '.</p>';
}

// ── Expense pace (shared by the Church Report and the Financial Health entity card) ─────────
// _finOverviewDrillOpen keeps the single-open drilldown behavior the Overview dashboard
// introduced; the dashboard itself is gone (its job is now the Financial Health page), but the
// click-to-see-line-items interaction moved intact onto the Church Report's expense panel.
var _finOverviewDrillOpen = null; // single-open drilldown category path

function finFmtSigned(cents) {
  var v = (cents || 0) / 100;
  var sign = v < 0 ? '-' : '+';
  return sign + '$' + finFmtMoney(Math.abs(v));
}
function finElapsedYearPct(year) {
  var now = new Date();
  if (year !== now.getFullYear()) return 1; // a past/future year — no "expected by now" concept
  var start = new Date(year, 0, 1), end = new Date(year + 1, 0, 1);
  return (now - start) / (end - start);
}
// Shared renderer for the "Are we on budget?" pace panel — used by both Church and Daycare
// domains. categories = [{ path, label, actualCents, budgetCents, children: [{label,actualCents,budgetCents}] }].
// Expense categories against budget, sorted by how far each is from where the calendar says it
// should be — not alphabetically, and not by size. The point of the panel is to surface the two
// or three lines that need a decision, so the biggest variance leads and the tail is cut.
// elapsedPct is the share of the fiscal year gone; the navy marker sits there and the fill is
// the share of budget spent, so a fill past the marker means spending faster than the calendar.
function finExpensePaceStatus(cat, elapsedPct) {
  var hasBudget = cat.budgetCents > 0;
  if (!hasBudget) return { key: 'none', label: 'No budget', color: 'var(--warm-gray)', diffCents: 0 };
  var diffCents = cat.actualCents - cat.budgetCents * elapsedPct;
  if (cat.actualCents > cat.budgetCents) return { key: 'over', label: 'Over budget', color: 'var(--danger)', diffCents: diffCents };
  if (diffCents > 150000) return { key: 'warn', label: finFmtSigned(diffCents) + ' over pace', color: 'var(--color-gold)', diffCents: diffCents };
  if (diffCents < -150000) return { key: 'under', label: finFmtSigned(diffCents) + ' under pace', color: 'var(--sage)', diffCents: diffCents };
  return { key: 'ok', label: 'On pace', color: 'var(--color-teal)', diffCents: diffCents };
}
function finRenderExpensePace(categories, elapsedPct, limit) {
  var ranked = (categories || []).map(function(cat) {
    return { cat: cat, status: finExpensePaceStatus(cat, elapsedPct) };
  }).sort(function(a, b) { return b.status.diffCents - a.status.diffCents; });
  var shown = limit ? ranked.slice(0, limit) : ranked;
  if (!shown.length) return '<p style="font-size:.85rem;color:var(--warm-gray);">No expense categories with budget data yet.</p>';
  var rows = shown.map(function(r) {
    var cat = r.cat, st = r.status;
    var hasBudget = cat.budgetCents > 0;
    var spentPct = hasBudget ? cat.actualCents / cat.budgetCents * 100 : 0;
    var open = _finOverviewDrillOpen === cat.path;
    var inset = '';
    if (open && cat.children && cat.children.length) {
      inset = '<div class="fin-pace-inset">' + cat.children.map(function(c) {
        return '<div class="fin-pace-inset-row"><span>' + esc(c.label) + '</span><span>$' + finFmtMoney(c.actualCents/100) + (c.budgetCents > 0 ? ' / $' + finFmtMoney(c.budgetCents/100) : '') + '</span></div>';
      }).join('') + '</div>';
    }
    return '<div class="fin-pace-row' + (open ? ' open' : '') + '" tabindex="0" role="button"'
      + ' onclick="finOverviewToggleDrill(' + jsAttr(cat.path) + ')"'
      + ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();finOverviewToggleDrill(' + jsAttr(cat.path) + ');}">'
      + '<div class="fin-pace-row-hdr">'
      + '<span><span class="fin-pace-caret">&#9656;</span><span class="fin-pace-label">' + esc(cat.label) + '</span></span>'
      + '<span style="font-size:12.5px;font-weight:700;color:' + st.color + ';white-space:nowrap;">' + st.label + '</span>'
      + '</div>'
      + (hasBudget
        ? '<div class="fin-pace-bar-track"><div class="fin-pace-bar-fill" style="width:' + Math.min(100, spentPct) + '%;background:' + st.color + ';"></div><div class="fin-pace-marker" style="left:' + (elapsedPct*100) + '%;"></div></div>'
        : '')
      + inset
      + '</div>';
  }).join('');
  return rows + (limit && ranked.length > limit
    ? '<p style="font-size:11.5px;color:var(--warm-gray);margin:10px 0 0;">Showing the ' + limit + ' largest variances of ' + ranked.length + ' categories — the full ledger is in "Full account detail" below.</p>'
    : '');
}
function finOverviewToggleDrill(path) {
  _finOverviewDrillOpen = (_finOverviewDrillOpen === path) ? null : path;
  if (_finChurchThisYearData) finRenderChurchThisYear(_finChurchThisYearData);
}

// AHRA's monthly report states this verbatim as "Distribution amount (cash minus reserves)" —
// its literal cash-on-hand-right-now calc (current cash balance, less outstanding bills, less
// the Total Property Reserve), already imported into available_for_distribution_cents on each
// monthly row (from the CSV's distribution_amount column) but never previously surfaced anywhere
// in the UI. Distinct from the "Available for Distribution" navy-bar card below, which is a
// deliberately different ANNUAL ESTIMATE (this year's net income less reserve contributions and
// capital spend) — that estimate is for planning ahead; this is AHRA's own literal monthly figure.
function finComputeLatestDistributionAmount(d) {
  var monthly = (d.monthly || []).slice().sort(function(a, b) { return a.period < b.period ? -1 : 1; });
  for (var i = monthly.length - 1; i >= 0; i--) {
    if (monthly[i].available_for_distribution_cents != null) return { period: monthly[i].period, cents: monthly[i].available_for_distribution_cents };
  }
  return null;
}
// Shared by the Overview tab's Property domain and the Property tab's own top-of-page KPI row
// (Phase 3 of the Finance Workspace redesign) — one source of truth for these 4 figures so the
// two views can never disagree.
function finComputePropertyKpis(d) {
  var monthly = (d.monthly || []).slice().sort(function(a,b){ return a.period < b.period ? -1 : 1; }).slice(-12);
  var occSum = 0, occCount = 0, netSum = 0;
  monthly.forEach(function(m) { if (m.occupancy_pct != null) { occSum += m.occupancy_pct; occCount++; } netSum += (m.net_income_cents || 0); });
  var years = (d.annualSummary || []).slice().sort(function(a,b){ return b.year - a.year; });
  var curYear = years[0];
  var reserves = finComputePropertyReservesOnHandCents(d) / 100;
  var latestDist = finComputeLatestDistributionAmount(d);
  // Two adjacent tiles cover deliberately different windows (trailing 12 months vs. one calendar
  // year), so each states its own window — otherwise "Monthly Net (avg) x 12" reads like it should
  // equal "Annual Net" and doesn't (the trailing window reaches back into the prior year).
  var thisYear = new Date().getFullYear();
  var netLbl = curYear ? 'Annual Net (' + curYear.year + (curYear.year === thisYear ? ' YTD' : '') + ')' : 'Annual Net';
  return [
    { lbl: 'Occupancy', val: occCount ? Math.round(occSum/occCount*100) + '%' : '—', chip: 'avg, trailing ' + monthly.length + ' mo', chipCls: 'fin-chip-positive', border: 'var(--sage)' },
    { lbl: 'Monthly Net (avg)', val: '$' + finFmtMoney((monthly.length ? netSum/monthly.length : 0)/100), chip: 'trailing ' + monthly.length + ' mo', chipCls: 'fin-chip-info', border: 'var(--color-teal)' },
    { lbl: netLbl, val: curYear ? '$' + finFmtMoney(curYear.net_income_cents/100) : '—', chip: 'to General Fund', chipCls: 'fin-chip-info', border: 'var(--color-navy)' },
    { lbl: 'Reserves On-Hand', val: '$' + finFmtMoney(reserves), chip: finPropertyReservesChip(d), chipCls: 'fin-chip-info', border: 'var(--color-gold)' },
    { lbl: 'Distribution Amount', val: latestDist ? '$' + finFmtMoney(latestDist.cents/100) : '—', chip: latestDist ? ('cash minus reserves, ' + latestDist.period) : 'no report data yet', chipCls: 'fin-chip-positive', border: 'var(--sage)' },
  ];
}
// AHRA's own monthly report already states a single "Total Property Reserve" figure (imported
// verbatim into finance_property_monthly.reserve_balance_cents via the CSV/xlsx importers, or
// typed into the "+ Add Month" modal's Reserve Balance field) — that figure is always the
// authoritative one, since it already bakes in AHRA's flat "Base Minimum Reserve" cash cushion
// (confirmed against the real July 2026 report: Total Property Reserve $10,358.33 = Property Tax
// Reserve after $5,858.33 + Base Minimum Reserve $4,500.00) alongside whatever named reserve
// buckets (tax, capital, insurance) this app separately tracks in finance_property_reserves. So
// "Reserves On-Hand" prefers the LATEST month's reserve_balance_cents whenever one has been
// entered — no separate monthly bookkeeping step needed to keep this KPI correct, just keep
// entering each new month's financials. It only falls back to reconstructing a total from the
// reserve-schedule ledger + the flat base-minimum figure (meta.reserves.base_minimum_cents,
// admin-editable) for a period where no monthly reserve_balance_cents has been recorded yet.
// Which of the two paths in finComputePropertyReservesOnHandCents actually produced the figure —
// so the KPI chip describes what the number really contains instead of always claiming
// "tax + capital + base minimum" (AHRA's own Total Property Reserve is tax + base minimum; it
// carries no capital-reserve bucket).
function finPropertyReservesChip(d) {
  var m = finPropertyLatestReserveMonth(d);
  return m ? 'AHRA total, ' + m.period : 'reserve ledger + base minimum';
}
function finPropertyLatestReserveMonth(d) {
  var monthly = (d.monthly || []).slice().sort(function(a, b) { return a.period < b.period ? -1 : 1; });
  var latest = monthly.length ? monthly[monthly.length - 1] : null;
  return (latest && latest.reserve_balance_cents != null) ? latest : null;
}
function finComputePropertyReservesOnHandCents(d) {
  var latest = finPropertyLatestReserveMonth(d);
  if (latest) return latest.reserve_balance_cents;
  var cents = 0;
  if (d.reserves) Object.keys(d.reserves).forEach(function(key) {
    var rows = d.reserves[key];
    if (rows && rows.length) cents += (rows[rows.length - 1].reserve_after_cents || 0);
  });
  cents += (d.meta && d.meta.reserves && d.meta.reserves.base_minimum_cents) || 0;
  return cents;
}
function finRenderKpiGrid(kpis) {
  return '<div class="fin-kpi-grid">' + kpis.map(function(k) {
    return '<div class="fin-kpi-card" style="border-top-color:' + k.border + ';"><div class="fin-kpi-lbl">' + k.lbl + '</div><div class="fin-kpi-val">' + k.val + '</div>'
      + (k.chip ? '<span class="fin-chip ' + (k.chipCls||'fin-chip-info') + '">' + k.chip + '</span>' : '') + '</div>';
  }).join('') + '</div>';
}

// ── Data & Imports ──────────────────────────────────────────────────────────────────────────
// One page for every connection, importer, hand-entered adjustment and destructive control that
// used to sit underneath the reports. It is the one finance page nobody opens during a meeting,
// which is the whole reason it exists — a report page should read, not offer twelve upload
// buttons. This renderer also MOUNTS the containers the pre-existing renderers write into
// (#fin-connection, #fin-budget, #fin-accounts, #fin-daycare-sync, #fin-daycare-body), so it must
// run before them; loadFinance() calls it first and it calls them itself at the end.
var _finImportStatus = null;
var _finAdjustKind = 'daycare';
// Mirrors REVENUE_STREAMS in api-finance.js (kept as a duplicate, not a shared import — this file
// has no module system; see finWeeksElapsedInYear for the same convention).
var REVENUE_STREAM_KEYS = ['donor', 'earned', 'passive', 'restricted'];
var REVENUE_STREAM_LABELS = {
  donor: 'Donor — we set the ask', earned: 'Earned — reported to us',
  passive: 'Passive — timing only', restricted: 'Restricted — spoken for',
};
var REVENUE_STREAM_SHORT = { donor: 'Donor', earned: 'Earned', passive: 'Passive', restricted: 'Restricted' };
var REVENUE_STREAM_COLORS = { donor: 'var(--color-teal)', earned: 'var(--color-gold)', passive: 'var(--sage)', restricted: 'var(--ice-blue)' };
// Mirrors DISPLAY_STREAMS / displayStreamOf in api-finance.js. Restricted income is a half of
// donor income, not a fourth stream: wherever the mix is drawn as a WHOLE — the bar, the flow, the
// five-year chart — it belongs inside donor. Drawn beside it, the board appears to have one more
// independent lever than it has, and donor income reads smaller than the giving behind it.
var FIN_DISPLAY_STREAM_KEYS = ['donor', 'earned', 'passive'];
// streams (4 classified) → streams (3 displayed), donor absorbing restricted. Returns a fresh
// object; callers still read the raw streams object when they need the two halves apart.
function finDisplayStreams(streams) {
  var out = {};
  FIN_DISPLAY_STREAM_KEYS.forEach(function(s) {
    var src = (streams || {})[s] || { cents: 0, groups: [] };
    out[s] = { cents: src.cents || 0, groups: (src.groups || []).slice() };
  });
  var r = (streams || {}).restricted;
  if (r && r.cents) {
    out.donor.cents += r.cents;
    out.donor.groups = out.donor.groups.concat(r.groups || []);
  }
  return out;
}
// Every income group's resolved stream, as last returned by any endpoint that computes it. The
// Church Report groups its own account tree from this same map (finReorganizeChurchTree), so the
// classification saved once on Data & Imports drives both pages instead of the Church Report
// keeping a second, hardcoded rule of its own.
var _finStreamMap = null;
function finRememberStreamMap(d) {
  var m = d && d.revenueStreams && d.revenueStreams.map;
  if (m && Object.keys(m).length) _finStreamMap = m;
  return d;
}
function finRenderDataImports() {
  var root = document.getElementById('fin-data-root');
  if (!root) return;
  var isAdminUI = (_userRole === 'admin');

  var statusCards = '<div class="fin-grid-3">'
    + '<div class="fin-card">'
      + '<div class="fin-data-card-hdr"><span class="fin-data-card-name">QuickBooks</span>'
      + (_finStatus.connected ? '<span class="fin-sync-pill">Connected</span>' : '<span class="fin-chip fin-chip-warn">Not connected</span>') + '</div>'
      + '<div id="fin-connection"></div>'
    + '</div>'
    + '<div class="fin-card">'
      + '<div class="fin-data-card-hdr"><span class="fin-data-card-name">Daycare app</span>'
      + (_finStatus.daycareConfigured ? '<span class="fin-sync-pill">Configured</span>' : '<span class="fin-chip fin-chip-warn">Not connected</span>') + '</div>'
      + '<p class="fin-data-card-body">Money syncs per period once the daycare app\'s finance API is live. The room-level figures the Daycare Report reads — capacity, average daily enrolled, billed revenue, labor cost, waitlist — still need adding to that API.</p>'
      + '<div id="fin-daycare-sync"></div>'
    + '</div>'
    + '<div class="fin-card">'
      + '<div class="fin-data-card-hdr"><span class="fin-data-card-name">Board packet</span><span class="fin-chip fin-chip-info">JSON</span></div>'
      + '<p class="fin-data-card-body">This year\'s income statement, balance sheet, five-year trends and the full daycare ledger in one file — hand it to an analyst and ask for the board\'s finance summary.</p>'
      + '<div><button class="btn-primary" id="fin-board-packet-btn" onclick="finExportBoardPacket()">Export packet</button></div>'
    + '</div>'
    + '</div>';

  root.innerHTML = finPageHeader('Data &amp; Imports', 'Connections, file imports, hand-entered adjustments, and the board packet export.', '')
    + statusCards
    + '<div id="fin-imports-card" class="fin-card">' + finRenderImportsCard() + '</div>'
    + '<div class="fin-grid-2-wide">'
      + '<div class="fin-card">' + finRenderAdjustmentsCard(isAdminUI) + '</div>'
      + (isAdminUI
        ? '<div class="fin-card require-admin" style="border:1px solid var(--danger);">'
          + '<div class="fin-card-title" style="color:var(--danger);font-size:19px;">Danger zone</div>'
          + '<p class="fin-data-card-body">Clears stored Church Report, Balance Sheet, Daycare and Planning data. <b>Commercial Property and all Giving data are never touched.</b></p>'
          + '<button class="btn-secondary" style="border-color:var(--danger);color:var(--danger);" onclick="finLoadClearDataPreview()">Clear budget &amp; report data…</button>'
          + '<div id="fin-clear-data-panel" style="margin-top:10px;"></div>'
          + '</div>'
        : '')
    + '</div>'
    + '<div id="fin-data-property-tools"></div>'
    + (isAdminUI ? '<div id="fin-data-classification" class="fin-card">' + finRenderClassificationCard() + '</div>' : '')
    // The raw QuickBooks report cards are kept, but behind disclosures: they are diagnostic
    // dumps of what the API returned, not something to read on a page anyone is reporting from.
    + '<div class="fin-card">'
      + '<div class="fin-card-title" style="font-size:18px;">Raw QuickBooks output</div>'
      + '<div class="fin-card-sub">What the API actually returned, for checking a figure that looks wrong. The Church Report is the reading version of the same data.</div>'
      + '<details><summary class="fin-disclosure">Budget vs. Actual</summary><div id="fin-budget" style="margin-top:10px;"></div></details>'
      + '<details style="margin-top:8px;"><summary class="fin-disclosure">Account balances</summary><div id="fin-accounts" style="margin-top:10px;"></div></details>'
    + '</div>';

  // Now that the containers exist, let the pre-existing renderers fill them.
  finRenderConnection();
  finRenderBudget(_finOverview);
  finRenderAccounts(_finOverview);
  finRenderDaycare();
  if (_finProperty) finRenderPropertyAdminTools(_finProperty);
  finRefreshImportStatus();
}
// Always refetches — deliberately NOT cached for the life of the page. This card's entire purpose
// is showing which feeds have gone stale, so a value fetched once at first render keeps reading
// "never" for the rest of the session even after an import has just written its log row. (Every
// importer would otherwise have to remember to invalidate this, which none of the ten did.)
// _finImportStatus is still kept so a revisit paints the previous answer immediately rather than
// flashing empty, then gets replaced by the fresh one.
function finRefreshImportStatus() {
  return api('/admin/api/finance/import-status').then(function(d) {
    _finImportStatus = d && d.importers ? d.importers : [];
    var card = document.getElementById('fin-imports-card');
    if (card) card.innerHTML = finRenderImportsCard();
  }).catch(function() { /* staleness is a nicety; the importers themselves still work */ });
}
// Each importer row names when it last ran. "never" in danger red is the point of the tab: a feed
// that has gone stale is visible here without opening the report it feeds.
var FIN_IMPORT_ACTIONS = {
  church_budget: 'finOpenChurchImport',
  church_monthly_pnl: 'finOpenChurchMonthlyImport',
  church_activity_multi: 'finOpenChurchActivityImport',
  church_budget_multi: 'finOpenChurchBudgetMultiYearImport',
  church_balance: 'finOpenChurchBalanceImport',
  church_balance_multi: 'finOpenChurchBalanceMultiYearImport',
  property_monthly_csv: 'finPropertyToggleMonthlyCsvPanel',
  property_budget_xlsx: 'finDataFocusPropertyBudgetImport',
  daycare_church_budget: 'finDataFocusDaycareChurchBudget',
  daycare_bulk: 'finDataFocusDaycareBulk',
};
function finRenderImportRow(imp) {
  var action = FIN_IMPORT_ACTIONS[imp.key];
  // A derived date is read off the imported rows' own timestamps rather than the import log, which
  // only began recording with this tab. It is marked so nobody reads it as a logged run — and it
  // carries its own caveat where two importers genuinely share one timestamp.
  var when;
  if (imp.lastImportedAt && imp.derived) {
    when = '<span style="color:var(--warm-gray);">~' + esc(finFmtTs(imp.lastImportedAt))
      + ' <span style="font-size:.72rem;color:var(--warm-meta);">from the data'
      + (imp.note ? ', ' + esc(imp.note) : '') + '</span></span>';
  } else if (imp.lastImportedAt) {
    when = '<span style="color:var(--warm-gray);">' + esc(finFmtTs(imp.lastImportedAt)) + '</span>';
  } else {
    when = '<span style="color:var(--danger);font-weight:700;">never</span>';
  }
  return '<button type="button" class="fin-import-row"' + (action ? ' onclick="' + action + '()"' : ' disabled') + '>'
    + '<span class="fin-import-row-name">' + esc(imp.label) + '</span>' + when + '</button>';
}
function finRenderImportsCard() {
  var importers = _finImportStatus || [];
  function panel(title, group, footHtml) {
    var rows = importers.filter(function(i) { return i.group === group; }).map(finRenderImportRow).join('');
    return '<div class="fin-import-panel"><div class="fin-eyebrow">' + title + '</div>'
      + (rows || '<div style="font-size:12.5px;color:var(--warm-gray);">Loading…</div>')
      + (footHtml ? '<div class="fin-import-panel-foot">' + footHtml + '</div>' : '')
      + '</div>';
  }
  return '<div class="fin-card-title" style="font-size:20px;">File imports</div>'
    + '<div class="fin-card-sub">Grouped by what they feed, with the last import date — so you can see what is stale without opening a report. '
    + 'A date marked <i>from the data</i> predates this log and was read off the imported rows themselves; the imported data is still there either way.</div>'
    + '<div class="fin-grid-2">'
      + panel('Feeds Church Report', 'church', '')
      + panel('Feeds Ivanhoe &amp; Daycare', 'other', finRenderDaycareAllocationConfig())
    + '</div>'
    + '<div class="fin-dropzone" style="margin-top:14px;" ondragover="finDropZoneOver(event)" ondragleave="finDropZoneLeave(event)" ondrop="finDataDropZoneDrop(event)">'
      + '<div style="font-size:13px;font-weight:700;color:var(--color-navy);">Choose an import above to open it</div>'
      + '<div class="fin-dropzone-hint">Each importer previews what it found before anything is saved. Drop a file here and the matching importer opens — which report it belongs to is a choice only you can make, so it asks rather than guessing.</div>'
    + '</div>'
    + '<div id="fin-dc-cb-panel" style="margin-top:14px;">'
      + '<div class="fin-eyebrow">MDO accounts from an imported church budget</div>'
      + '<p style="font-size:12.5px;color:var(--warm-ink-label);margin:4px 0 8px;">Pulls the Mother\'s Day Out line items (any account with "MDO" or "Mother\'s Day Out" in its name) out of a Church Report budget already imported for that year, and categorizes them into the Daycare Report\'s categories.</p>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Church Budget Year<br><input type="number" id="fin-dc-cb-year" placeholder="2025" style="width:100px;"></label>'
      + '<button class="btn-secondary" onclick="finDaycareChurchBudgetPreview()">Preview</button></div>'
      + '<div id="fin-dc-cb-preview" style="margin-top:10px;"></div>'
    + '</div>';
}
// A dropped file cannot be routed automatically — a Balance Sheet and a Statement of Financial
// Position are the same report exported two ways, and guessing wrong would silently write a
// year's figures into the wrong table. So the drop is acknowledged and the user picks.
function finDataDropZoneDrop(ev) {
  finDropZoneLeave(ev);
  ev.preventDefault();
  finToast('Choose which import this file is, using the list above — the app will not guess which report a file belongs to.');
}
function finDataFocusDaycareChurchBudget() {
  var el = document.getElementById('fin-dc-cb-year');
  if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); }
}
function finDataFocusDaycareBulk() {
  var el = document.getElementById('fin-dc-bulk-details');
  if (el) { el.open = true; el.scrollIntoView({ block: 'center' }); }
}
function finDataFocusPropertyBudgetImport() {
  var el = document.getElementById('fin-property-budget-import-label');
  if (el) el.scrollIntoView({ block: 'center' });
  else finToast('Property tools load with the Commercial Property data — try again in a moment.');
}
// One form for the three things that get typed in by hand, with a "What" selector swapping the
// field set — replacing three separate forms that sat on three different tabs. Each field set
// keeps the ids its existing save handler already reads, so no save path changed.
function finAdjustSetKind(kind) {
  _finAdjustKind = kind;
  var el = document.getElementById('fin-adjust-fields');
  if (el) el.innerHTML = finRenderAdjustFields();
}
function finRenderAdjustFields() {
  if (_finAdjustKind === 'distribution') {
    return '<label style="font-size:.75rem;color:var(--warm-gray);">Period<br><input type="text" id="fin-prop-dist-period" placeholder="2026-07" style="width:100px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Amount ($)<br><input type="number" id="fin-prop-dist-amount" step="0.01" style="width:110px;"></label>'
      + '<button class="btn-primary" onclick="finPropertyAddDistribution()">Record distribution</button>';
  }
  if (_finAdjustKind === 'property') {
    return '<div style="font-size:12.5px;color:var(--warm-ink-label);max-width:420px;">A property month has fifteen figures, so it keeps its own form rather than being squeezed into this row.</div>'
      + '<button class="btn-primary" onclick="finPropertyOpenMonthModal()">Open the month form</button>'
      + '<button class="btn-secondary" onclick="finPropertyToggleMonthlyCsvPanel()">Paste AHRA CSV instead</button>';
  }
  return '<label style="font-size:.75rem;color:var(--warm-gray);">Period<br><input type="text" id="fin-dc-period" placeholder="2026-07" style="width:100px;"></label>'
    + '<label style="font-size:.75rem;color:var(--warm-gray);">Category<br><input type="text" id="fin-dc-category" placeholder="Tuition Income" style="width:160px;"></label>'
    + '<label style="font-size:.75rem;color:var(--warm-gray);">Type<br><select id="fin-dc-type"><option value="actual">Actual</option><option value="budget">Budget</option></select></label>'
    + '<label style="font-size:.75rem;color:var(--warm-gray);">Amount ($)<br><input type="number" id="fin-dc-amount" step="0.01" style="width:110px;"></label>'
    + '<label style="font-size:.75rem;color:var(--warm-gray);">Notes<br><input type="text" id="fin-dc-notes" style="width:160px;"></label>'
    + '<button class="btn-primary" id="fin-dc-submit-btn" onclick="finSaveDaycare()">Add entry</button>'
    + '<button class="btn-secondary" id="fin-dc-cancel-btn" style="display:none;" onclick="finCancelEditDaycare()">Cancel</button>';
}
function finRenderAdjustmentsCard(isAdminUI) {
  return '<div class="fin-card-title" style="font-size:20px;">Hand-entered adjustments</div>'
    + '<div class="fin-card-sub">Daycare periods, property months, distributions — one form, one recent list.</div>'
    + '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">What<br>'
      + '<select class="fin-domain-select" onchange="finAdjustSetKind(this.value)">'
      + '<option value="daycare">Daycare entry</option><option value="property">Property month</option><option value="distribution">Distribution</option>'
      + '</select></label>'
      + '<span id="fin-adjust-fields" style="display:contents;">' + finRenderAdjustFields() + '</span>'
    + '</div>'
    + '<div style="font-size:.75rem;color:var(--danger);margin-top:6px;min-height:14px;" id="fin-dc-error"></div>'
    + '<details id="fin-dc-bulk-details" style="margin-top:14px;">'
      + '<summary class="fin-disclosure">Bulk-enter past daycare years</summary>'
      + '<p style="font-size:.78rem;color:var(--warm-gray);margin:8px 0;">One entry per line: <code>period, category, type, amount, notes</code> — period is <code>YYYY</code> or <code>YYYY-MM</code>, type is <code>actual</code> or <code>budget</code> (defaults to actual), notes optional.</p>'
      + '<textarea id="fin-dc-bulk-text" rows="4" style="width:100%;font-family:monospace;font-size:.8rem;padding:8px;border:1px solid var(--border);border-radius:6px;" placeholder="2023, Tuition Income, actual, 285000"></textarea>'
      + '<div style="display:flex;gap:8px;margin-top:8px;align-items:center;">'
      + '<button class="btn-secondary" onclick="finDaycareBulkPreview()">Preview</button>'
      + '<span id="fin-dc-bulk-error" style="font-size:.78rem;color:var(--danger);"></span></div>'
      + '<div id="fin-dc-bulk-preview" style="margin-top:8px;"></div>'
    + '</details>'
    + '<details style="margin-top:8px;">'
      + '<summary class="fin-disclosure">All daycare line items (<span id="fin-daycare-count">0</span> rows)</summary>'
      + '<div style="overflow-x:auto;margin-top:8px;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
      + '<thead><tr style="border-bottom:2px solid var(--navy);">'
      + '<th style="text-align:left;padding:6px 8px;">Period</th><th style="text-align:left;padding:6px 8px;">Category</th>'
      + '<th style="text-align:left;padding:6px 8px;">Type</th><th style="text-align:right;padding:6px 8px;">Amount</th>'
      + '<th style="text-align:left;padding:6px 8px;">Notes / Source</th><th></th></tr></thead>'
      + '<tbody id="fin-daycare-body"></tbody></table></div>'
    + '</details>';
}
// Revenue-stream classification + the cash policy behind the runway card. Both are judgments
// this code cannot make for a church — which account group counts as donor revenue, and how many
// months of reserve the congregation has decided to hold — so both are editable here rather than
// hardcoded, and the Health page names what it used.
var _finStreamEditor = null;
function finRenderClassificationCard() {
  return '<div class="fin-card-title" style="font-size:20px;">Classification &amp; policy</div>'
    + '<div class="fin-card-sub">What the Financial Health page assumes about your chart of accounts and your reserve policy.</div>'
    + '<div id="fin-stream-editor"><button class="btn-secondary" onclick="finLoadStreamEditor()">Review revenue-stream classification</button></div>'
    + '<div id="fin-expense-map" style="margin-top:14px;"><button class="btn-secondary" onclick="finLoadExpenseMapEditor()">Review expense-category mapping</button></div>'
    + '<div id="fin-cash-policy" style="margin-top:14px;"><button class="btn-secondary" onclick="finLoadCashPolicy()">Edit cash reserve policy</button></div>';
}
function finLoadStreamEditor() {
  var el = document.getElementById('fin-stream-editor');
  if (!el) return;
  el.innerHTML = '<div style="font-size:.8rem;color:var(--warm-gray);">Loading…</div>';
  api('/admin/api/finance/revenue-streams?year=' + new Date().getFullYear()).then(function(d) {
    _finStreamEditor = d;
    finRenderStreamEditor();
  }).catch(function() { el.innerHTML = finCardError('the revenue-stream classification'); });
}
function finRenderStreamEditor() {
  var el = document.getElementById('fin-stream-editor');
  if (!el || !_finStreamEditor) return;
  var d = _finStreamEditor;
  var groups = [];
  REVENUE_STREAM_KEYS.forEach(function(s) {
    (d.streams[s].groups || []).forEach(function(g) { groups.push({ label: g.label, cents: g.cents, stream: s }); });
  });
  groups.sort(function(a, b) { return b.cents - a.cents; });
  var unmappedByLabel = {};
  (d.unmapped || []).forEach(function(u) { unmappedByLabel[u.label] = true; });
  var rows = groups.map(function(g, i) {
    return '<tr><td style="padding:5px 8px;">' + esc(g.label)
      + (unmappedByLabel[g.label] ? ' <span class="fin-chip fin-chip-warn" style="font-size:.68rem;">guessed</span>' : '') + '</td>'
      + '<td style="padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums;">' + finMoney0(g.cents) + '</td>'
      + '<td style="padding:5px 8px;"><select class="fin-domain-select" id="fin-stream-sel-' + i + '" data-label="' + esc(g.label) + '">'
      + REVENUE_STREAM_KEYS.map(function(s) {
          return '<option value="' + s + '"' + (s === g.stream ? ' selected' : '') + '>' + esc(REVENUE_STREAM_LABELS[s]) + '</option>';
        }).join('')
      + '</select></td></tr>';
  }).join('');
  el.innerHTML = '<div class="fin-eyebrow">Revenue-stream classification (FY' + d.year + ')</div>'
    + '<p style="font-size:12.5px;color:var(--warm-ink-label);margin:4px 0 8px;">Which account groups the board can actually move. A group marked <b>guessed</b> was classified by name and has never been confirmed — the Financial Health page is only as honest as this table.</p>'
    + '<table style="width:100%;border-collapse:collapse;font-size:.82rem;"><tbody>' + (rows || '<tr><td style="padding:8px;color:var(--warm-gray);">No revenue accounts for this year yet.</td></tr>') + '</tbody></table>'
    + (rows ? '<button class="btn-primary" style="margin-top:10px;" onclick="finSaveStreamClassification(' + groups.length + ')">Save classification</button>' : '');
}
function finSaveStreamClassification(count) {
  var map = {};
  for (var i = 0; i < count; i++) {
    var sel = document.getElementById('fin-stream-sel-' + i);
    if (sel) map[sel.getAttribute('data-label')] = sel.value;
  }
  api('/admin/api/finance/revenue-streams', { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ map: map }) })
    .then(function(d) {
      if (d && d.error) { finToast(d.error); return; }
      finToast('Revenue-stream classification saved.');
      _finStreamEditor = null;
      // The saved map is what every downstream view groups by, so adopt it immediately and drop
      // the caches built from the previous one — otherwise the Church Report and Planning keep
      // showing the old grouping until a full reload.
      if (d && d.map) _finStreamMap = d.map;
      _finChurchThisYearData = null;
      _finChurchMultiYearData = null;
      _finPlanBaseTree = null;
      finLoadStreamEditor();
      finLoadHealth(true);
    }).catch(function(err) { finToast(err && err.message || 'Save failed.'); });
}
// The five board-facing expense categories are the board's vocabulary, not the chart of accounts,
// so which GL group lands in which is a judgment an admin makes here. Doubles as the
// unmapped-account validation report the flow-diagram handoff asks for: any group still resolved
// by name carries a "guessed" chip.
var _finExpenseMapData = null;
function finLoadExpenseMapEditor() {
  var el = document.getElementById('fin-expense-map');
  if (!el) return;
  el.innerHTML = '<div style="font-size:.8rem;color:var(--warm-gray);">Loading…</div>';
  api('/admin/api/finance/flow-expense-map?year=' + new Date().getFullYear()).then(function(d) {
    _finExpenseMapData = d;
    finRenderExpenseMapEditor();
  }).catch(function() { el.innerHTML = finCardError('the expense-category mapping'); });
}
function finRenderExpenseMapEditor() {
  var el = document.getElementById('fin-expense-map');
  if (!el || !_finExpenseMapData) return;
  var d = _finExpenseMapData;
  var rows = (d.groups || []).map(function(g, i) {
    return '<tr><td style="padding:5px 8px;">' + esc(g.label)
      + (g.mapped ? '' : ' <span class="fin-chip fin-chip-warn" style="font-size:.68rem;">guessed</span>') + '</td>'
      + '<td style="padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums;">' + finMoney0(g.cents) + '</td>'
      + '<td style="padding:5px 8px;"><select class="fin-domain-select" id="fin-expmap-sel-' + i + '" data-label="' + esc(g.label) + '">'
      + (d.categories || []).map(function(c) {
          return '<option value="' + c.key + '"' + (c.key === g.key ? ' selected' : '') + '>' + esc(c.label) + '</option>';
        }).join('')
      + '</select></td></tr>';
  }).join('');
  var guessed = (d.groups || []).filter(function(g) { return !g.mapped; }).length;
  el.innerHTML = '<div class="fin-eyebrow">Expense-category mapping (FY' + d.year + ')</div>'
    + '<p style="font-size:12.5px;color:var(--warm-ink-label);margin:4px 0 8px;">Which of the board&rsquo;s five categories each expense group belongs to, as drawn on the money-flow chart. '
    + (guessed ? '<b>' + guessed + '</b> group' + (guessed === 1 ? ' is' : 's are') + ' still classified by name and unconfirmed.' : 'Every group has been confirmed.') + '</p>'
    + '<table style="width:100%;border-collapse:collapse;font-size:.82rem;"><tbody>'
    + (rows || '<tr><td style="padding:8px;color:var(--warm-gray);">No expense accounts for this year yet.</td></tr>')
    + '</tbody></table>'
    + (rows ? '<button class="btn-primary" style="margin-top:10px;" onclick="finSaveExpenseMap(' + (d.groups || []).length + ')">Save mapping</button>' : '');
}
function finSaveExpenseMap(count) {
  var map = {};
  for (var i = 0; i < count; i++) {
    var sel = document.getElementById('fin-expmap-sel-' + i);
    if (sel) map[sel.getAttribute('data-label')] = sel.value;
  }
  api('/admin/api/finance/flow-expense-map', { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ map: map }) })
    .then(function(d) {
      if (d && d.error) { finToast(d.error); return; }
      finToast('Expense-category mapping saved.');
      _finExpenseMapData = null;
      finLoadExpenseMapEditor();
      finLoadHealth(true);
    }).catch(function(err) { finToast(err && err.message || 'Save failed.'); });
}
function finLoadCashPolicy() {
  var el = document.getElementById('fin-cash-policy');
  if (!el) return;
  el.innerHTML = '<div style="font-size:.8rem;color:var(--warm-gray);">Loading…</div>';
  api('/admin/api/finance/cash-policy').then(function(d) {
    el.innerHTML = '<div class="fin-eyebrow">Cash reserve policy</div>'
      + '<p style="font-size:12.5px;color:var(--warm-ink-label);margin:4px 0 8px;">The runway card measures months of operating cash against this floor. Cash on hand is read from the imported balance sheet — name the operating account by its code (this church\'s is <b>11027</b> Lindell Checking) so it can\'t pick up the wrong one. Leave the code blank and it matches any asset account named "checking"; type a figure in <i>Cash on hand</i> only to override the balance sheet entirely. The runway measures <b>church operating expenses only</b> — daycare wages and costs are left out, since they stop when the tuition does. <i>General Fund budget account code</i> is the ledger account family the offering budget is filed under (this church\'s is <b>40085</b>); leave it blank and the giving-pace chart uses the leading code of the funds categorized as the General Fund.</p>'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Policy floor (months)<br><input type="number" id="fin-cash-floor" step="0.5" value="' + (d.policy_floor_months != null ? d.policy_floor_months : 3) + '" style="width:100px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Operating cash account code<br><input type="text" id="fin-cash-acct" placeholder="11027" value="' + esc(d.cash_account_code || '') + '" style="width:120px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">General Fund budget account code<br><input type="text" id="fin-gf-budget-acct" placeholder="40085" value="' + esc(d.general_fund_budget_code || '') + '" style="width:150px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Cash on hand ($, overrides)<br><input type="number" id="fin-cash-onhand" step="0.01" value="' + (d.cash_on_hand_cents != null ? (d.cash_on_hand_cents / 100) : '') + '" style="width:140px;"></label>'
      + '<button class="btn-primary" onclick="finSaveCashPolicy()">Save policy</button></div>';
  }).catch(function() { el.innerHTML = finCardError('the cash policy'); });
}
function finSaveCashPolicy() {
  var months = Number(document.getElementById('fin-cash-floor').value);
  var onHandRaw = document.getElementById('fin-cash-onhand').value;
  var acctEl = document.getElementById('fin-cash-acct');
  var gfEl = document.getElementById('fin-gf-budget-acct');
  var body = {
    policy_floor_months: months,
    cash_on_hand_cents: onHandRaw === '' ? null : Math.round(Number(onHandRaw) * 100),
    cash_account_code: acctEl ? acctEl.value.trim() : '',
    general_fund_budget_code: gfEl ? gfEl.value.trim() : '',
  };
  api('/admin/api/finance/cash-policy', { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) })
    .then(function(d) {
      if (d && d.error) { finToast(d.error); return; }
      finToast('Cash policy saved.');
      finLoadHealth(true);
    }).catch(function(err) { finToast(err && err.message || 'Save failed.'); });
}

// ── Financial Health ────────────────────────────────────────────────────────────────────────
// One page a council member can read top to bottom in a meeting, ending in decisions. It answers
// "how are we doing, and what should we decide?" rather than "what do the ledgers say" — the
// ledgers are on the other tabs. The organizing idea is that the board's authority over the three
// entities is different, and the page says so everywhere: donor revenue is the only stream the
// board can move, MDO earned income is reported to it, and Ivanhoe is a timing decision.
var _finHealthData = null;          // church this-year payload for the CURRENT year
var _finAppealScope = 'gapReserves'; // 'gap' | 'gapReserves'
function finLoadHealth(force) {
  var root = document.getElementById('fin-health-root');
  if (!root) return;
  if (_finHealthData && !force) { finRenderHealth(); return; }
  if (_finHealthLoading) return;
  _finHealthLoading = true;
  api('/admin/api/finance/church/this-year?year=' + new Date().getFullYear()).then(function(d) {
    _finHealthLoading = false;
    _finHealthData = finRememberStreamMap(d);
    finRenderHealth();
  }).catch(function(err) {
    _finHealthLoading = false;
    if (err && err.message === 'Unauthorized') return;
    root.innerHTML = '<div class="fin-card">' + finCardError('the financial health data') + '</div>';
  });
}
var _finHealthLoading = false;
function finAppealSetScope(scope) {
  _finAppealScope = scope;
  finRenderHealth();
}

// 1.2 — the revenue mix bar. One bar, three streams, and a band underneath marking how much say
// the board actually has over each. A segment narrower than ~9% cannot hold its own amount
// legibly, so its figure moves to the legend line rather than being squeezed to unreadable.
function finRenderRevenueMix(streams, totalCents) {
  if (!totalCents) {
    return '<div class="fin-card"><div class="fin-card-title" style="font-size:20px;">The revenue mix</div>'
      + '<p style="font-size:.85rem;color:var(--warm-gray);">No revenue recorded for this year yet — sync or import the church ledger from the <b>Data &amp; Imports</b> tab.</p></div>';
  }
  var control = {
    donor: { note: 'We set the ask', border: 'var(--color-navy)', color: 'var(--color-navy)' },
    earned: { note: 'Reported to us', border: 'var(--warm-border)', color: 'var(--warm-meta)' },
    passive: { note: 'Timing only', border: 'var(--deep-amber)', color: 'var(--deep-amber)' },
  };
  // Three segments: restricted income is drawn INSIDE donor (finDisplayStreams), not beside it.
  var restrictedCents = ((streams || {}).restricted || { cents: 0 }).cents || 0;
  var shown = finDisplayStreams(streams);
  var segs = '', band = '', narrow = [];
  FIN_DISPLAY_STREAM_KEYS.forEach(function(s) {
    var cents = (shown[s] || { cents: 0 }).cents;
    var pct = cents / totalCents * 100;
    // A stream with no money contributes no segment at all — four streams means an empty one is
    // now normal (a church with no restricted accounts), and a zero-width segment would still
    // render its 3px control-band rule as a stray tick under the bar.
    if (!cents) return;
    var wide = pct >= 9;
    if (!wide && cents) narrow.push(REVENUE_STREAM_SHORT[s] + ' ' + finMoney0(cents));
    segs += '<div class="fin-stream-seg" style="width:' + pct.toFixed(1) + '%;background:' + REVENUE_STREAM_COLORS[s] + ';">'
      + '<span class="fin-stream-seg-lbl">' + REVENUE_STREAM_SHORT[s] + '</span>'
      + (wide ? '<span class="fin-stream-seg-val">' + finMoney0(cents) + ' &middot; ' + Math.round(pct) + '%</span>' : '')
      + '</div>';
    band += '<div style="width:' + pct.toFixed(1) + '%;border-top:3px solid ' + control[s].border + ';padding-top:6px;font-size:11.5px;font-weight:700;color:' + control[s].color + ';">' + control[s].note + '</div>';
  });
  return '<div class="fin-card">'
    + '<div class="fin-card-hdr-split">'
      + '<div><div class="fin-card-title" style="font-size:20px;">The revenue mix</div>'
      + '<div class="fin-card-sub" style="margin:0;">One bar, one segment per stream. The band under it marks how much say the board actually has.'
      + (restrictedCents ? ' Donor includes ' + finMoney0(restrictedCents) + ' of restricted gifts — donor-directed, but still funding the budget.' : '')
      + '</div></div>'
      + '<div style="text-align:right;"><div class="fin-eyebrow">Total revenue</div>'
      + '<div style="font-size:26px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1;">' + finMoney0(totalCents) + '</div></div>'
    + '</div>'
    + '<div class="fin-stream-bar">' + segs + '</div>'
    + '<div style="display:flex;gap:4px;">' + band + '</div>'
    + (narrow.length ? '<div style="font-size:11.5px;color:var(--warm-gray);margin-top:8px;">Too narrow to label above: ' + narrow.join(' &middot; ') + '.</div>' : '')
    + '</div>';
}

// 1.3 — one card per stream, each carrying the chip that names the board's authority over it.
function finRenderStreamCards(d) {
  var rs = d.revenueStreams || { streams: {}, totalCents: 0 };
  var total = rs.totalCents || 0;
  function pctOf(cents) { return total ? Math.round(cents / total * 100) : 0; }
  function subBars(groups, colors) {
    var max = groups.reduce(function(m, g) { return Math.max(m, g.cents); }, 1);
    return groups.slice(0, 3).map(function(g, i) {
      return finBar(esc(g.label), '$' + finFmtMoney(g.cents / 100), g.cents / max * 100, colors[Math.min(i, colors.length - 1)]);
    }).join('');
  }
  var donor = rs.streams.donor || { cents: 0, groups: [] };
  var earned = rs.streams.earned || { cents: 0, groups: [] };
  var passive = rs.streams.passive || { cents: 0, groups: [] };
  var restricted = rs.streams.restricted || { cents: 0, groups: [] };

  // Donor income is the ledger's unrestricted and restricted income streams TOGETHER, and both
  // halves come from that one source.
  //
  // ⚠ The two bars were previously the ChMS giving split (funds.category='restricted', every fund,
  // no filter), sitting under a ledger headline. Reported live 2026-08-12: $247,060.56 +
  // $80,308.17 printed beneath a $239,876 total, i.e. parts visibly larger than the whole, because
  // those bars summed to all recorded giving — including every 25xxx designated fund, which is a
  // balance-sheet liability and never income at all. The restricted half is now the ledger's own
  // restricted income (Comfort Dog, Tuition Aid — donor-directed but spent on this church's own
  // ministry), designated funds moved to their own card, and the card adds up by construction.
  var donorTotal = donor.cents + restricted.cents;
  var donorMax = Math.max(donor.cents, restricted.cents, 1);
  var donorCard = '<div class="fin-card fin-stream-card" style="border-top-color:var(--color-teal);">'
    + '<div><div class="fin-card-hdr-split"><span class="fin-eyebrow">Donor income</span><span class="fin-chip fin-chip-info">Full control</span></div>'
    + '<div class="fin-stream-val">' + finMoney0(donorTotal) + '</div>'
    + '<div class="fin-stream-sub">' + pctOf(donorTotal) + '% of revenue &middot; ' + (d.givingHouseholds || 0) + ' giving household' + (d.givingHouseholds === 1 ? '' : 's') + '</div></div>'
    + '<div style="display:flex;flex-direction:column;gap:9px;">'
    + (donorTotal
      ? finBar('Unrestricted', '$' + finFmtMoney(donor.cents / 100), donor.cents / donorMax * 100, 'var(--color-teal)')
        + finBar('Restricted', '$' + finFmtMoney(restricted.cents / 100), restricted.cents / donorMax * 100, 'var(--ice-blue)')
        + '<div style="font-size:11.5px;color:var(--warm-gray);">'
        + (restricted.cents
          ? 'Restricted gifts are donor-directed but spent on our own ministry, so they do fund the budget. '
          : '')
        + 'Designated funds are counted separately below — they never pay a budgeted expense.</div>'
      : '<div style="font-size:11.5px;color:var(--warm-gray);">No account group is classified as donor income yet. Set it on <b>Data &amp; Imports</b>.</div>')
    + '</div>'
    + '<div><button class="btn-primary" onclick="showTab(\'giving\')">Giving detail &rarr;</button></div></div>';

  var earnedCard = '<div class="fin-card fin-stream-card" style="border-top-color:var(--color-gold);">'
    + '<div><div class="fin-card-hdr-split"><span class="fin-eyebrow">Earned income</span><span class="fin-chip fin-chip-warn">Reported, not managed</span></div>'
    + '<div class="fin-stream-val">' + finMoney0(earned.cents) + '</div>'
    + '<div class="fin-stream-sub">' + pctOf(earned.cents) + '% of revenue'
    // Compared against the DISPLAYED streams: measured against the four raw ones, earned could
    // claim to be largest while the donor card above it printed a bigger number.
    + (earned.cents > 0 && FIN_DISPLAY_STREAM_KEYS.every(function(k) { return earned.cents >= (finDisplayStreams(rs.streams)[k] || { cents: 0 }).cents; }) ? ' &middot; our largest single stream' : '') + '</div></div>'
    + '<div style="display:flex;flex-direction:column;gap:9px;">'
    + (earned.groups.length ? subBars(earned.groups, ['var(--color-gold)', 'var(--pale-gold)', 'var(--pale-gold)'])
      : '<div style="font-size:11.5px;color:var(--warm-gray);">No account group is classified as earned income yet.</div>')
    + '</div>'
    + '<div><button class="btn-secondary" onclick="finNavGo(\'daycare\')">Daycare Report &rarr;</button></div></div>';

  var passiveCard = '<div class="fin-card fin-stream-card" style="border-top-color:var(--sage);">'
    + '<div><div class="fin-card-hdr-split"><span class="fin-eyebrow">Passive income</span><span class="fin-chip fin-chip-positive">Timing decision</span></div>'
    + '<div class="fin-stream-val">' + finMoney0(passive.cents) + '</div>'
    + '<div class="fin-stream-sub">' + pctOf(passive.cents) + '% of revenue &middot; endowment, investments, property</div></div>'
    + '<div style="display:flex;flex-direction:column;gap:9px;">'
    + (passive.groups.length ? subBars(passive.groups, ['var(--sage)', 'var(--pale-sage)', 'var(--pale-sage)'])
      : '<div style="font-size:11.5px;color:var(--warm-gray);">No account group is classified as passive income yet.</div>')
    + '</div>'
    + '<div><button class="btn-secondary" onclick="finNavGo(\'property\')">Commercial Property &rarr;</button></div></div>';

  // Three cards, not four: restricted income is a half of donor income (see donorCard above), so
  // giving it a peer card alongside earned and passive drew the same dollars twice — once inside
  // the donor total and once beside it.
  return '<div class="fin-stream-grid fin-grid-start">' + donorCard + earnedCard + passiveCard + '</div>';
}

// 1.3b — designated funds (25xxx). Deliberately NOT a revenue stream and drawn outside the stream
// grid, because every dollar here is money the church holds and forwards or spends outside the
// budget: it can never pay a budgeted expense, and adding it to revenue would overstate what the
// board has to work with. It is still shown in full — the council is accountable for it, and the
// pastor directs several of these funds — just never mixed into the operating figure.
//
// The reconciliation is the reason this card earns its place. Recorded giving and booked donor
// income measure different things and will never match on their own; subtracting designated
// giving is what makes them comparable, and a gap that opens up after that means a fund is
// miscategorized on one side or the other. That check did not exist before.
function finRenderDesignatedFunds(d) {
  var g = d.designatedFunds;
  if (!g || !g.funds || !g.funds.length) return '';
  var rs = d.revenueStreams || { streams: {} };
  var ledgerDonorCents = ((rs.streams.donor || {}).cents || 0) + ((rs.streams.restricted || {}).cents || 0);
  var diff = g.operatingGivenCents - ledgerDonorCents;
  var hasBal = g.balanceCents != null;

  var rows = g.funds.map(function(f) {
    return '<tr>'
      + '<td style="padding:5px 8px;">' + esc(f.label) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums;">'
      + (f.givenCents ? '$' + finFmtMoney(f.givenCents / 100) : '<span style="color:var(--warm-gray);">—</span>') + '</td>'
      + '<td style="padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums;">'
      + (f.balanceCents == null ? '<span style="color:var(--warm-gray);">—</span>' : '$' + finFmtMoney(f.balanceCents / 100)) + '</td>'
      + '</tr>';
  }).join('');

  return '<div class="fin-card">'
    + '<div class="fin-card-hdr-split">'
      + '<div><div class="fin-card-title" style="font-size:20px;">Designated funds</div>'
      + '<div class="fin-card-sub" style="margin:0;">Held, not operated on. None of this can pay a budgeted expense, so it is counted apart from revenue.</div></div>'
      + '<div style="text-align:right;"><div class="fin-eyebrow">Given this year</div>'
      + '<div style="font-size:26px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1;">' + finMoney0(g.designatedGivenCents) + '</div>'
      + (hasBal ? '<div style="font-size:11.5px;color:var(--warm-gray);margin-top:3px;">' + finMoney0(g.balanceCents) + ' on hand'
          + (g.asOfDate ? ' &middot; ' + esc(g.asOfDate) : '') + '</div>' : '')
    + '</div></div>'
    + '<details style="margin-top:10px;"><summary style="cursor:pointer;font-size:12.5px;font-weight:600;color:var(--color-teal);">'
      + 'Show the ' + g.funds.length + ' fund' + (g.funds.length === 1 ? '' : 's') + '</summary>'
      + '<div style="overflow-x:auto;margin-top:8px;"><table style="width:100%;border-collapse:collapse;font-size:12.5px;">'
      + '<thead><tr style="background:var(--linen);">'
      + '<th style="padding:5px 8px;text-align:left;">Fund</th>'
      + '<th style="padding:5px 8px;text-align:right;">Given this year</th>'
      + '<th style="padding:5px 8px;text-align:right;">Balance on hand</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table></div>'
      + '<div style="font-size:11.5px;color:var(--warm-gray);margin-top:8px;">'
      + '&ldquo;Given this year&rdquo; comes from our giving records; &ldquo;balance on hand&rdquo; from the imported balance sheet, where these funds sit as liabilities. '
      + (hasBal ? 'A fund can show one without the other — given to but not yet reported on the statement, or holding a balance nobody gave to this year.'
        : 'No balance sheet is on file, so nothing can be shown on hand yet.')
      + '</div></details>'
    + '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);font-size:12px;color:var(--warm-ink-label);">'
      + '<b>Does this tie out?</b> Recorded giving ' + finMoney0(d.givingCents || 0)
      + ' &minus; designated ' + finMoney0(g.designatedGivenCents)
      + ' = <b>' + finMoney0(g.operatingGivenCents) + '</b> that funds the budget, against '
      + finMoney0(ledgerDonorCents) + ' of donor income booked in the ledger — a difference of '
      + '<b>' + finMoney0(Math.abs(diff)) + '</b>. '
      + (Math.abs(diff) > Math.max(Math.round(ledgerDonorCents * 0.02), 500000)
        ? 'That is wider than timing alone usually explains; a fund is likely classified differently on one side.'
        : 'Small differences are normal — a gift recorded in one year and booked in the next.')
    + '</div></div>';
}

// ── 1.4 "How the money moves" ───────────────────────────────────────────────────────────────
// Two views behind one toggle: a four-column Sankey (Sources -> Streams -> All revenue -> Where
// it goes) and a two-donut Share view. The server sends amounts only; every coordinate below is
// derived here.
//
// The whole point of this block is that NOTHING OVERLAPS. The handoff authors the geometry
// against one specific year's figures, where the nodes happen to be tall enough that its fixed
// gaps are sufficient. Real data is not that obliging: a church with twenty small revenue lines,
// or one line dwarfing the rest, would stack labels straight through each other. So the layout
// computes each label's real vertical extent and pushes the next node down until the two cannot
// touch — the authored gaps are a FLOOR, never a ceiling. With the handoff's own reference
// figures the authored gaps are always the larger of the two, so the reference rendering is
// reproduced exactly; with anything else the constraint quietly takes over.
var FIN_FLOW_COLORS = {
  donor: '#2E7EA6', earned: '#C9973A', passive: '#6B8F71',
  total: '#1E2D4A',
  restricted: '#7FB4CC',
  sourceTint: {
    // Donor carries the restricted sources now (displayStreamOf), so its ramp absorbs the two
    // tints that used to belong to the restricted stream — they read as lighter donor blues,
    // which is exactly the relationship. Without them a third donor source would collide with the
    // second, since the ramp clamps at its last entry.
    donor: ['#2E7EA6', '#4E97BC', '#7FB4CC', '#A9CCDD'], earned: ['#C9973A', '#E0BE7C', '#EFD9A8'],
    passive: ['#6B8F71', '#A9C6AC'], restricted: ['#7FB4CC', '#A9CCDD'],
  },
  // Expenses deliberately use one navy ramp: five more hues would compete with the revenue side
  // and imply the categories are unrelated things rather than slices of one budget.
  expense: ['#1E2D4A', '#3E5379', '#6B7FA3', '#9FAEC7', '#C9D3E2'],
};
var FIN_FLOW_STREAM_NOTE = {
  donor: 'the only stream we set', earned: 'reported to us, not set by us',
  passive: 'timing decision only', restricted: 'given for a purpose we cannot change',
};
var FIN_FLOW_STREAM_LABEL = {
  donor: 'Donor revenue', earned: 'Earned income',
  passive: 'Passive income', restricted: 'Restricted income',
};
// Column geometry, verbatim from the handoff.
var FIN_FLOW_COLS = {
  sources: { barX: 6, barW: 10, labelX: 24, anchor: 'start', ribbonOut: 16, maxLabelW: 298 },
  streams: { barX: 330, barW: 10, labelX: 348, anchor: 'start', ribbonIn: 330, ribbonOut: 340, maxLabelW: 254 },
  // The last two caps are what keep the middle of the canvas clear: the total's label runs right
  // from 628 and the expense labels run LEFT from 1056, so their widths have to be bounded such
  // that the two can never meet. 628+200 = 828 against 1056-300 = 756 would still collide, so the
  // total is capped at 110 (its text is the fixed string "Total revenue" plus one amount anyway).
  total: { barX: 610, barW: 10, labelX: 628, anchor: 'start', ribbonIn: 610, ribbonOut: 620, maxLabelW: 110 },
  expenses: { barX: 1064, barW: 10, labelX: 1056, anchor: 'end', ribbonIn: 1064, maxLabelW: 300 },
};
var FIN_FLOW_W = 1080, FIN_FLOW_REF_H = 626;
// Label extents relative to a node's vertical center. These are what the collision pass reasons
// about, so they must stay in step with the text the renderer actually emits below.
var FIN_FLOW_LABEL_BOX = {
  two: { top: -13, bottom: 20 },      // name at cy-3, amount at cy+14
  twoNote: { top: -13, bottom: 36 },  // ...plus a note at cy+30
  one: { top: -9, bottom: 9 },        // single line at cy+4
};
// Advance width per character, as a fraction of the font size. Only used to truncate a label
// before it can run into the next column, so an over-estimate is the safe direction: DM Sans at
// these weights averages nearer 0.55em, and 0.62 leaves margin. Any renderer measurement must use
// finFlowCharW rather than a hand-picked constant — a cap that under-estimates the width is
// exactly how a label bleeds into the next column.
var FIN_FLOW_CHAR_W = 0.62;
function finFlowCharW(fontSize) { return fontSize * FIN_FLOW_CHAR_W; }
function finFlowTruncate(text, maxPx, pxPerChar) {
  var max = Math.max(4, Math.floor(maxPx / pxPerChar));
  text = String(text == null ? '' : text);
  return text.length <= max ? text : text.slice(0, max - 1).replace(/[\s,;:.-]+$/, '') + '…';
}
// px per $1,000. The handoff fixes 0.40 for its reference total and says to recompute only if the
// total moves more than ~15%, clamping so labels never collide. Followed literally — but the
// canvas is then grown to whatever the tallest column needs, because a clamp that keeps labels
// legible can still produce a column taller than a fixed 626-unit box, and a column running off
// the canvas is its own kind of collision.
function finFlowScale(totalRevenueCents) {
  var thousands = (totalRevenueCents || 0) / 100 / 1000;
  if (!thousands) return 0.4;
  var REF = 1165;
  if (Math.abs(thousands - REF) / REF <= 0.15) return 0.4;
  return Math.max(0.28, Math.min(0.55, 540 / thousands));
}
// Stacks one column. Each node carries {cents}; they come back with y/h/cy/labelMode set. gaps is the
// handoff's authored gap list (index i = gap AFTER node i); anything beyond it falls back to the
// handoff's own dynamic rule, max(10, 22 - height).
function finFlowStackColumn(nodes, startY, scale, gaps, uniformGap, twoLineMinH, hasNote) {
  var out = [], y = startY;
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    var h = Math.max(2, (n.cents / 100 / 1000) * scale);
    var mode = h >= twoLineMinH ? (hasNote && n.note ? 'twoNote' : 'two') : 'one';
    var box = FIN_FLOW_LABEL_BOX[mode];
    var node = { ref: n, h: h, y: y, cy: y + h / 2, labelMode: mode,
                 labelTop: y + h / 2 + box.top, labelBottom: y + h / 2 + box.bottom };
    // The first node must also clear the column header, which sits on the baseline at y=12.
    if (i === 0 && node.labelTop < 20) {
      var push = 20 - node.labelTop;
      node.y += push; node.cy += push; node.labelTop += push; node.labelBottom += push;
    }
    out.push(node);
    var authored = gaps && gaps[i] != null ? gaps[i] : (uniformGap != null ? uniformGap : Math.max(10, 22 - h));
    var byGap = node.y + node.h + authored;
    // ...and the constraint that makes overlap impossible: the NEXT node's label must start below
    // this one's, whatever the authored gap says.
    var next = nodes[i + 1];
    var byLabel = -Infinity;
    if (next) {
      var nh = Math.max(2, (next.cents / 100 / 1000) * scale);
      var nMode = nh >= twoLineMinH ? (hasNote && next.note ? 'twoNote' : 'two') : 'one';
      byLabel = node.labelBottom + 2 - FIN_FLOW_LABEL_BOX[nMode].top - nh / 2;
    }
    y = Math.max(byGap, byLabel);
  }
  return out;
}
// The full four-column layout. Pure — no DOM — so the collision guarantee is directly testable.
function finFlowLayout(diagram) {
  var scale = finFlowScale(diagram.totalRevenueCents);
  var sources = diagram.sources || [], expenses = diagram.expenses || [];
  var streamNodes = (diagram.streams || []).map(function(s) {
    return { id: s.id, label: FIN_FLOW_STREAM_LABEL[s.id] || s.id, cents: s.cents, note: FIN_FLOW_STREAM_NOTE[s.id] };
  });
  var laidSources = finFlowStackColumn(sources, 22, scale, [10, 18, 14, 18, 18, 16], null, 20, false);
  var laidStreams = finFlowStackColumn(streamNodes, 44, scale, null, 14, 20, true);
  var laidExpenses = finFlowStackColumn(expenses, 30, scale, null, 14, 40, true);
  var revenueH = Math.max(2, (diagram.totalRevenueCents / 100 / 1000) * scale);
  var totalNode = { ref: { label: 'Total revenue', cents: diagram.totalRevenueCents }, h: revenueH, y: 60,
                    cy: 60 + revenueH / 2, labelMode: 'two', labelTop: 60 + revenueH / 2 - 13, labelBottom: 60 + revenueH / 2 + 20 };

  // Canvas grows to whatever the tallest column plus the footer needs. The footer keeps the
  // handoff's own offsets from the bottom edge (626-598 = 28, 626-616 = 10).
  var deepest = [laidSources, laidStreams, laidExpenses, [totalNode]].reduce(function(m, col) {
    return col.reduce(function(mm, n) { return Math.max(mm, n.y + n.h, n.labelBottom); }, m);
  }, 0);
  // 28 clears the footer rule (which sits 28 above the bottom edge) plus 6 of breathing room, so
  // the deepest label can never touch it. Anything that fits the authored 626 keeps the authored
  // canvas, which is what reproduces the handoff's reference rendering exactly.
  var canvasH = Math.max(FIN_FLOW_REF_H, Math.ceil(deepest + 34));
  return {
    scale: scale, canvasH: canvasH,
    footerRuleY: canvasH - 28, footerTextY: canvasH - 10,
    sources: laidSources, streams: laidStreams, total: totalNode, expenses: laidExpenses,
  };
}
// A ribbon between a left span [a,b] and a right span [c,d], both control points on the midpoint.
function finFlowRibbon(x0, x1, a, b, c, dd, fill, opacity) {
  var xm = x0 + (x1 - x0) / 2;
  return '<path d="M' + x0 + ',' + a.toFixed(1) + ' C' + xm + ',' + a.toFixed(1) + ' ' + xm + ',' + c.toFixed(1) + ' ' + x1 + ',' + c.toFixed(1)
    + ' L' + x1 + ',' + dd.toFixed(1) + ' C' + xm + ',' + dd.toFixed(1) + ' ' + xm + ',' + b.toFixed(1) + ' ' + x0 + ',' + b.toFixed(1) + ' Z"'
    + ' fill="' + fill + '" opacity="' + opacity + '"></path>';
}


// Ribbons attach contiguously inside their target node, in source order, tracked with a running
// cursor per target — that is what makes them read as one fanning band rather than separate
// arrows. The outflow side is scaled by k so it exactly fills the revenue bar: expenses can
// exceed revenue, and letting the ribbons overrun the bar would read as a rendering fault. The
// real difference is stated in the footer instead, where it can be read as the number it is.
function finRenderSankey(diagram, layout) {
  var byId = {};
  layout.sources.forEach(function(n) { byId[n.ref.id] = n; });
  var streamById = {};
  layout.streams.forEach(function(n) { streamById[n.ref.id] = n; });

  // Source colors: each stream's own ramp, in the order its sources appear.
  var tintIdx = { donor: 0, earned: 0, passive: 0 };
  layout.sources.forEach(function(n) {
    var ramp = FIN_FLOW_COLORS.sourceTint[n.ref.stream] || [FIN_FLOW_COLORS.total];
    n.color = ramp[Math.min(tintIdx[n.ref.stream]++, ramp.length - 1)];
  });
  layout.expenses.forEach(function(n, i) { n.color = FIN_FLOW_COLORS.expense[Math.min(i, FIN_FLOW_COLORS.expense.length - 1)]; });
  layout.streams.forEach(function(n) { n.color = FIN_FLOW_COLORS[n.ref.id] || FIN_FLOW_COLORS.total; });

  var C = FIN_FLOW_COLS, ribbons = '';
  // source -> stream
  var streamCursor = {};
  layout.streams.forEach(function(n) { streamCursor[n.ref.id] = n.y; });
  layout.sources.forEach(function(n) {
    var target = streamById[n.ref.stream];
    if (!target) return;
    var c = streamCursor[n.ref.stream];
    var h = n.h * (target.h / Math.max(1e-6, layout.sources.filter(function(x) { return x.ref.stream === n.ref.stream; })
      .reduce(function(sum, x) { return sum + x.h; }, 0)));
    ribbons += finFlowRibbon(C.sources.ribbonOut, C.streams.ribbonIn, n.y, n.y + n.h, c, c + h, n.color, 0.42);
    streamCursor[n.ref.stream] = c + h;
  });
  // stream -> total
  var totalCursor = layout.total.y;
  var streamSum = layout.streams.reduce(function(sum, n) { return sum + n.h; }, 0) || 1;
  layout.streams.forEach(function(n) {
    var h = n.h * (layout.total.h / streamSum);
    ribbons += finFlowRibbon(C.streams.ribbonOut, C.total.ribbonIn, n.y, n.y + n.h, totalCursor, totalCursor + h, n.color, 0.50);
    totalCursor += h;
  });
  // total -> expense, left edges scaled by k so they exactly fill the revenue bar
  var expenseSum = layout.expenses.reduce(function(sum, n) { return sum + n.h; }, 0) || 1;
  var k = layout.total.h / expenseSum;
  var outCursor = layout.total.y;
  layout.expenses.forEach(function(n) {
    var lh = n.h * k;
    ribbons += finFlowRibbon(C.total.ribbonOut, C.expenses.ribbonIn, outCursor, outCursor + lh, n.y, n.y + n.h, n.color, 0.34);
    outCursor += lh;
  });

  function bar(n, col) {
    return '<rect x="' + col.barX + '" y="' + n.y.toFixed(1) + '" width="' + col.barW + '" height="' + n.h.toFixed(1) + '" rx="2" fill="' + n.color + '"></rect>';
  }
  // Label emission. Must stay in step with FIN_FLOW_LABEL_BOX — the collision pass reasons about
  // exactly these offsets.
  function label(n, col, amountColor) {
    var a = col.anchor === 'end' ? ' text-anchor="end"' : '';
    var x = col.labelX;
    var amount = finMoney0(n.ref.cents);
    if (n.labelMode === 'one') {
      // Name and amount share one line, so the name only gets what the amount leaves behind.
      var oneW = finFlowCharW(11);
      var oneText = finFlowTruncate(n.ref.label, col.maxLabelW - (amount.length + 1) * oneW, oneW);
      return '<text x="' + x + '" y="' + (n.cy + 4).toFixed(1) + '"' + a + ' font-size="11" font-weight="700" fill="#5C4B2E">'
        + esc(oneText) + ' <tspan font-weight="800" fill="#1A1A2A" font-variant-numeric="tabular-nums">' + amount + '</tspan></text>';
    }
    var out = '<text x="' + x + '" y="' + (n.cy - 3).toFixed(1) + '"' + a + ' font-size="12.5" font-weight="800" fill="#1A1A2A">'
      + esc(finFlowTruncate(n.ref.label, col.maxLabelW, finFlowCharW(12.5))) + '</text>'
      + '<text x="' + x + '" y="' + (n.cy + 14).toFixed(1) + '"' + a + ' font-size="14.5" font-weight="800" fill="' + amountColor + '" font-variant-numeric="tabular-nums">' + amount + '</text>';
    if (n.labelMode === 'twoNote' && n.ref.note) {
      out += '<text x="' + x + '" y="' + (n.cy + 30).toFixed(1) + '"' + a + ' font-size="10.5" fill="#8A8377">' + esc(finFlowTruncate(n.ref.note, col.maxLabelW, finFlowCharW(10.5))) + '</text>';
    }
    return out;
  }

  var nodes = layout.sources.map(function(n) { return bar(n, C.sources) + label(n, C.sources, n.color); }).join('')
    + layout.streams.map(function(n) { return bar(n, C.streams) + label(n, C.streams, n.color); }).join('')
    + '<rect x="' + C.total.barX + '" y="' + layout.total.y.toFixed(1) + '" width="' + C.total.barW + '" height="' + layout.total.h.toFixed(1) + '" rx="2" fill="' + FIN_FLOW_COLORS.total + '"></rect>'
    + '<text x="' + C.total.labelX + '" y="' + (layout.total.cy - 3).toFixed(1) + '" font-size="12.5" font-weight="800" fill="#1A1A2A">Total revenue</text>'
    + '<text x="' + C.total.labelX + '" y="' + (layout.total.cy + 14).toFixed(1) + '" font-size="14.5" font-weight="800" fill="' + FIN_FLOW_COLORS.total + '" font-variant-numeric="tabular-nums">' + finMoney0(diagram.totalRevenueCents) + '</text>'
    + layout.expenses.map(function(n) { return bar(n, C.expenses) + label(n, C.expenses, FIN_FLOW_COLORS.total); }).join('');

  var headers = '<g font-size="10" font-weight="700" fill="#A99A7E" letter-spacing="1">'
    + '<text x="' + C.sources.labelX + '" y="12">SOURCES</text>'
    + '<text x="' + C.streams.labelX + '" y="12">STREAMS</text>'
    + '<text x="' + C.total.labelX + '" y="12">ALL REVENUE</text>'
    + '<text x="' + C.expenses.labelX + '" y="12" text-anchor="end">WHERE IT GOES</text></g>';

  var net = diagram.netCents;
  var footer = net < 0
    ? finMoney0(diagram.totalExpenseCents) + ' goes out against ' + finMoney0(diagram.totalRevenueCents) + ' in — a ' + finMoney0(-net) + ' gap, before any one bad month.'
    : finMoney0(diagram.totalRevenueCents) + ' comes in against ' + finMoney0(diagram.totalExpenseCents) + ' out — ' + finMoney0(net) + ' to the good.';

  var biggestSource = layout.sources.slice().sort(function(a, b) { return b.ref.cents - a.ref.cents; })[0];
  var biggestExpense = layout.expenses.slice().sort(function(a, b) { return b.ref.cents - a.ref.cents; })[0];
  var aria = 'Money flow for the year. ' + finMoney0(diagram.totalRevenueCents) + ' of revenue'
    + (biggestSource ? ', the largest source being ' + biggestSource.ref.label + ' at ' + finMoney0(biggestSource.ref.cents) : '')
    + ', against ' + finMoney0(diagram.totalExpenseCents) + ' of expenses'
    + (biggestExpense ? ', the largest being ' + biggestExpense.ref.label + ' at ' + finMoney0(biggestExpense.ref.cents) : '')
    + '. ' + footer;

  return '<svg viewBox="0 0 ' + FIN_FLOW_W + ' ' + layout.canvasH + '" width="100%" height="' + Math.round(layout.canvasH * 0.927) + '" role="img" data-om-raster aria-label="' + esc(aria) + '">'
    + ribbons + nodes + headers
    + '<line x1="6" y1="' + layout.footerRuleY + '" x2="1074" y2="' + layout.footerRuleY + '" stroke="#EFE6D4"></line>'
    + '<text x="6" y="' + layout.footerTextY + '" font-size="11.5" font-weight="700" fill="' + (net < 0 ? 'var(--danger)' : 'var(--sage-text)') + '">' + esc(footer) + '</text>'
    + '</svg>';
}
// Share view — the same totals as a pair of donuts. Answers "what share is MDO?" at a glance, and
// is the view small screens get, where the Sankey's labels could not be laid out honestly.
function finRenderFlowDonut(title, slices, totalCents, caption) {
  var C = 414.69, r = 66, cum = 0;
  var total = totalCents || slices.reduce(function(s, x) { return s + x.cents; }, 0) || 1;
  var segs = slices.map(function(sl) {
    var len = sl.cents / total * C;
    var seg = '<circle cx="90" cy="90" r="' + r + '" fill="none" stroke="' + sl.color + '" stroke-width="30"'
      + ' stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" stroke-dashoffset="' + (-cum).toFixed(2) + '"'
      + ' transform="rotate(-90 90 90)"></circle>';
    cum += len;
    return seg;
  }).join('');
  var abbrev = '$' + (Math.abs(total) >= 100000000 ? (total / 100 / 1000000).toFixed(3) + 'M' : Math.round(total / 100).toLocaleString('en-US'));
  var rows = slices.map(function(sl) {
    return '<div class="fin-donut-row">'
      + '<span class="fin-donut-key"><span class="fin-donut-swatch" style="background:' + sl.color + ';"></span>' + esc(sl.label) + '</span>'
      + '<span class="fin-donut-vals"><b>' + finMoney0(sl.cents) + '</b><span class="fin-donut-pct">' + Math.round(sl.cents / total * 100) + '%</span></span>'
      + '</div>';
  }).join('');
  return '<div class="fin-donut-panel">'
    + '<div class="fin-eyebrow">' + title + '</div>'
    + '<div class="fin-donut-body">'
      + '<svg viewBox="0 0 180 180" width="164" height="164" role="img" aria-label="' + esc(title + ': ' + slices.map(function(sl) { return sl.label + ' ' + finMoney0(sl.cents); }).join(', ')) + '">'
      + segs
      + '<text x="90" y="86" text-anchor="middle" font-size="20" font-weight="800" fill="#1A1A2A">' + abbrev + '</text>'
      + '<text x="90" y="104" text-anchor="middle" font-size="10.5" font-weight="700" fill="#8A8377" letter-spacing=".5">' + esc(caption) + '</text>'
      + '</svg>'
      + '<div class="fin-donut-legend">' + rows + '</div>'
    + '</div></div>';
}
var _finFlowView = 'flow';
function finFlowSetView(view) {
  _finFlowView = (view === 'share') ? 'share' : 'flow';
  // Persisted per user: a board member who prefers the donuts shouldn't re-pick every visit.
  try { localStorage.setItem('finance.flowView', _finFlowView); } catch (e) { /* private mode — the choice just won't persist */ }
  var card = document.getElementById('fin-flow-card');
  if (card) {
    card.classList.toggle('view-flow', _finFlowView === 'flow');
    card.classList.toggle('view-share', _finFlowView === 'share');
  }
  ['flow', 'share'].forEach(function(v) {
    var btn = document.getElementById('fin-flow-btn-' + v);
    if (btn) { btn.classList.toggle('active', v === _finFlowView); btn.setAttribute('aria-pressed', String(v === _finFlowView)); }
  });
}
function finRenderFlow(d) {
  var diagram = d.flowDiagram;
  if (!diagram || !diagram.totalRevenueCents) return '';
  try { _finFlowView = localStorage.getItem('finance.flowView') === 'share' ? 'share' : 'flow'; } catch (e) { /* keep the default */ }
  var layout = finFlowLayout(diagram);

  var inSlices = (diagram.streams || []).map(function(s) {
    return { label: FIN_FLOW_STREAM_LABEL[s.id] || s.id, cents: s.cents, color: FIN_FLOW_COLORS[s.id] || FIN_FLOW_COLORS.total };
  });
  var outSlices = (diagram.expenses || []).map(function(e, i) {
    return { label: e.label, cents: e.cents, color: FIN_FLOW_COLORS.expense[Math.min(i, FIN_FLOW_COLORS.expense.length - 1)] };
  });

  // Visually hidden, so screen readers and Ctrl-F both reach the same figures the chart draws.
  var dataTable = '<table class="fin-sr-only"><caption>How the money moves — the figures behind the chart</caption>'
    + '<thead><tr><th>Item</th><th>Group</th><th>Amount</th></tr></thead><tbody>'
    + (diagram.sources || []).map(function(s) {
        return '<tr><td>' + esc(s.label) + '</td><td>' + esc(FIN_FLOW_STREAM_LABEL[s.stream] || s.stream) + '</td><td>' + finMoney0(s.cents) + '</td></tr>';
      }).join('')
    + (diagram.expenses || []).map(function(e) {
        return '<tr><td>' + esc(e.label) + '</td><td>Expenses</td><td>' + finMoney0(e.cents) + '</td></tr>';
      }).join('')
    + '</tbody></table>';


  return '<div class="fin-card fin-flow-card view-' + _finFlowView + '" id="fin-flow-card">'
    + '<div class="fin-card-hdr-split">'
      + '<div><div class="fin-card-title" style="font-size:20px;">How the money moves</div>'
      + '<div class="fin-card-sub" style="margin:0;">' + finMoney0(diagram.totalRevenueCents) + ' in &middot; ' + finMoney0(diagram.totalExpenseCents) + ' out &middot; net ' + finFmtSigned(diagram.netCents) + ' across all three entities.</div></div>'
      + '<div class="fin-flow-toggle" role="group" aria-label="Chart view">'
        + '<button type="button" id="fin-flow-btn-flow" class="fin-flow-toggle-btn' + (_finFlowView === 'flow' ? ' active' : '') + '" aria-pressed="' + (_finFlowView === 'flow') + '" onclick="finFlowSetView(\'flow\')">Flow</button>'
        + '<button type="button" id="fin-flow-btn-share" class="fin-flow-toggle-btn' + (_finFlowView === 'share' ? ' active' : '') + '" aria-pressed="' + (_finFlowView === 'share') + '" onclick="finFlowSetView(\'share\')">Share</button>'
      + '</div>'
    + '</div>'
    + '<div class="fin-flow-sankey">' + finRenderSankey(diagram, layout) + '</div>'
    + '<div class="fin-flow-share">'
      + finRenderFlowDonut('Money in', inSlices, diagram.totalRevenueCents, 'TOTAL REVENUE')
      + finRenderFlowDonut('Money out', outSlices, diagram.totalExpenseCents, 'TOTAL EXPENSES')
    + '</div>'
    + dataTable
    + '</div>';
}

// 1.5 — the three engines. Each card's label states what the board decides about that entity,
// because it is different for each one and that difference is the point of the page.
function finRenderEntityCards(d) {
  var income = d.classificationTotals['Income'] || { actualCents: 0, budgetCents: 0 };
  var expenses = d.classificationTotals['Expenses'] || { actualCents: 0, budgetCents: 0 };
  var net = d.netIncome || { actualCents: 0, budgetCents: 0 };
  var projected = (d.yoy && d.yoy.available) ? d.yoy.net.projectedFullYearCents : null;
  function planBar(label, actualCents, budgetCents, color) {
    // Plan-relative, not calendar-relative: no pace marker here, and the fill IS the stated
    // percentage, so a reader comparing the bar against the number never finds them disagreeing.
    var pct = budgetCents > 0 ? actualCents / budgetCents * 100 : 0;
    return '<div style="display:flex;justify-content:space-between;font-size:11.5px;font-weight:700;color:var(--warm-ink-label);">'
      + '<span>' + label + '</span><span>' + (budgetCents > 0 ? Math.round(pct) + '% of $' + finFmtMoney(budgetCents / 100) : 'no plan set') + '</span></div>'
      + '<div style="height:9px;border-radius:6px;background:var(--linen);"><div style="width:' + Math.min(100, pct) + '%;height:100%;border-radius:6px;background:' + color + ';"></div></div>';
  }
  var churchCard = '<div class="fin-card fin-entity-card" style="border-top-color:' + (net.actualCents < 0 ? 'var(--danger)' : 'var(--sage)') + ';">'
    + '<div class="fin-card-hdr-split"><span class="fin-eyebrow">Church operating</span>'
    + '<span class="fin-chip ' + (net.actualCents < 0 ? 'fin-chip-negative">Needs action' : 'fin-chip-positive">In surplus') + '</span></div>'
    + '<div><div class="fin-entity-val">' + finFmtSigned(net.actualCents) + '</div>'
    + '<div class="fin-stream-sub">Revenue ' + finMoney0(income.actualCents) + ' &middot; Expenses ' + finMoney0(expenses.actualCents) + '</div></div>'
    + '<div style="display:flex;flex-direction:column;gap:6px;">'
    + planBar('Revenue vs. plan', income.actualCents, income.budgetCents, 'var(--color-teal)')
    + planBar('Expenses vs. plan', expenses.actualCents, expenses.budgetCents, 'var(--color-gold)')
    + '</div>'
    + '<div class="fin-note-box">Board owns this budget.' + (projected != null ? ' Projected year-end <b>' + finFmtSigned(projected) + '</b>.' : ' A year-end projection needs monthly-granularity data for this year and last.') + '</div>'
    + '</div>';

  var agg = _finDaycareAgg;
  var yKey = String(new Date().getFullYear());
  var dc = agg && agg.byYear ? agg.byYear[yKey] : null;
  var alloc = _finDaycareAllocation && _finDaycareAllocation.allocation ? _finDaycareAllocation.allocation[yKey] : null;
  var allocCents = alloc ? ((alloc.mdoUtilityCents || 0) + (alloc.mdoInsuranceCents || 0)) : 0;
  var daycareCard = '<div class="fin-card fin-entity-card" style="border-top-color:' + (dc && dc.netActual >= 0 ? 'var(--sage)' : 'var(--danger)') + ';">'
    + '<div class="fin-card-hdr-split"><span class="fin-eyebrow">Daycare (MDO)</span>'
    + '<span class="fin-chip ' + (dc && dc.netActual >= 0 ? 'fin-chip-positive">Self-sufficient' : 'fin-chip-warn">Not covering itself') + '</span></div>'
    + (dc
      ? '<div><div class="fin-entity-val">' + finFmtSigned(Math.round(dc.netActual * 100)) + '</div>'
        + '<div class="fin-stream-sub">Tuition $' + finFmtMoney(dc.incomeActual) + ' &middot; Costs $' + finFmtMoney(dc.expenseActual) + '</div></div>'
        + (allocCents
          ? '<div style="display:flex;flex-direction:column;gap:6px;">'
            + '<div style="display:flex;justify-content:space-between;font-size:11.5px;font-weight:700;color:var(--warm-ink-label);">'
            + '<span>Covers its allocated share</span><span>' + finMoney0(allocCents) + ' of utilities &amp; insurance</span></div>'
            + '<div style="height:9px;border-radius:6px;background:var(--linen);"><div style="width:100%;height:100%;border-radius:6px;background:var(--sage);"></div></div></div>'
          : '')
      : '<div style="font-size:.85rem;color:var(--warm-gray);">No ' + yKey + ' daycare figures imported yet.</div>')
    + '<div class="fin-note-box">Report only — the board receives, does not manage.</div>'
    + '</div>';

  var p = _finProperty;
  var latestDist = p ? finComputeLatestDistributionAmount(p) : null;
  var reservesCents = p ? finComputePropertyReservesOnHandCents(p) : 0;
  var occ = p ? finComputePropertyKpis(p)[0].val : '—';
  var propertyCard = '<div class="fin-card fin-entity-card" style="border-top-color:var(--color-teal);">'
    + '<div class="fin-card-hdr-split"><span class="fin-eyebrow">3277 Ivanhoe</span><span class="fin-chip fin-chip-info">Funds itself</span></div>'
    + '<div><div class="fin-eyebrow">Distributable right now</div>'
    + '<div class="fin-entity-val">' + (latestDist ? '$' + finFmtMoney(latestDist.cents / 100) : '—') + '</div>'
    + '<div class="fin-stream-sub">' + (latestDist ? 'Cash minus reserves &middot; AHRA, ' + esc(latestDist.period) : 'No AHRA report recorded yet') + '</div></div>'
    + '<div style="display:flex;flex-direction:column;gap:6px;">'
    + '<div style="display:flex;justify-content:space-between;font-size:11.5px;font-weight:700;color:var(--warm-ink-label);">'
    + '<span>Reserves on-hand</span><span>' + finMoney0(reservesCents) + '</span></div>'
    + '<div style="height:9px;border-radius:6px;background:var(--linen);"><div style="width:100%;height:100%;border-radius:6px;background:var(--color-teal);"></div></div>'
    + '<div style="font-size:11.5px;color:var(--warm-gray);">Occupancy ' + esc(occ) + ', trailing 12 months.</div></div>'
    + '<div class="fin-note-box">One decision: <b>whether and when to take a distribution.</b></div>'
    + '</div>';

  return '<div><div class="fin-section-title">The three engines</div>'
    + '<div class="fin-section-sub">What the board decides for each one is different — the label on each card says so.</div>'
    + '<div class="fin-grid-3">' + churchCard + daycareCard + propertyCard + '</div></div>';
}

// The two end-of-line labels sat at a fixed offset from their own line, so when giving tracks
// close to budget — which is the normal, healthy case — "Actual" and "Budget" printed on top of
// each other and neither was readable. Pushed apart to a minimum gap when they collide, keeping
// whichever line is higher on top so each label still points at its own line.
var FIN_PACE_LABEL_MIN_GAP = 13;
function finPaceEndLabels(actualY, budgetY) {
  var aY = actualY + 4;
  if (budgetY == null) return '<text x="574" y="' + aY.toFixed(1) + '" fill="var(--color-teal)">Actual</text>';
  var bY = budgetY - 10;
  var gap = Math.abs(aY - bY);
  if (gap < FIN_PACE_LABEL_MIN_GAP) {
    var push = (FIN_PACE_LABEL_MIN_GAP - gap) / 2;
    // A tie (identical y) still has to resolve deterministically — actual goes below.
    if (actualY <= budgetY) { aY -= push; bY += push; }
    else { aY += push; bY -= push; }
  }
  return '<text x="574" y="' + aY.toFixed(1) + '" fill="var(--color-teal)">Actual</text>'
    + '<text x="574" y="' + bY.toFixed(1) + '" fill="var(--deep-amber)">Budget</text>';
}
// Why there is no pace line — naming the account code that was searched for, since the usual
// cause is a budget that IS uploaded, filed under a code this rule didn't look under. A reader who
// can see the same budget on the Planning tab needs to be told where the two disagree, not told
// the budget doesn't exist.
function finPaceNoBudgetNote(pace, scoped) {
  if (!scoped) return 'No donor-revenue budget is set for this year, so there is no pace line to compare against.';
  if (!pace.budgetCode) {
    return 'No pace line: the General Fund has no leading account code to look up a budget by. '
      + 'Set one under <b>Data &amp; Imports → Classification &amp; policy</b> (General Fund budget account code).';
  }
  return 'No pace line: no budget is on file this year for church ledger accounts starting <b>'
    + esc(pace.budgetCode) + '</b>'
    + (pace.budgetCodePinned ? ' (pinned under Classification &amp; policy).' : '.')
    + ' If the budget is uploaded under a different code, pin that code under <b>Data &amp; Imports → Classification &amp; policy</b>.';
}
// 1.6a — cumulative ChMS giving against a straight-line budget line.
function finRenderGivingPace(d) {
  var monthly = d.givingMonthly || [];
  var pace = d.givingPace || {};
  var scoped = pace.scope === 'general_fund';
  // The General Fund's own budget, from the church ledger accounts sharing its numeric code —
  // NOT the all-donor-revenue budget, which would be measuring one fund's giving against every
  // donor account's target and would read as a permanent shortfall.
  var budgetCents = pace.budgetCents != null ? pace.budgetCents : 0;
  var through = (d.year === new Date().getFullYear()) ? (new Date().getMonth() + 1) : 12;
  var cum = [], run = 0;
  for (var m = 0; m < through; m++) { run += (monthly[m] ? monthly[m].cents : 0); cum.push(run); }
  var title = scoped ? 'General Fund giving against budget pace' : 'Giving against budget pace';
  if (!cum.length) return '<div class="fin-card"><div class="fin-card-title" style="font-size:20px;">' + esc(title) + '</div>'
    + '<p style="font-size:.85rem;color:var(--warm-gray);">No giving recorded in ChMS for this year yet.</p></div>';
  var maxCents = Math.max.apply(null, cum.concat([budgetCents || 1]));
  var W = 640, x0 = 46, x1 = 557, yTop = 26, yBot = 176;
  function px(i) { return cum.length > 1 ? x0 + (x1 - x0) * (i / (cum.length - 1)) : x0; }
  function py(c) { return yBot - (c / maxCents) * (yBot - yTop); }
  var actualPts = cum.map(function(c, i) { return px(i).toFixed(1) + ',' + py(c).toFixed(1); }).join(' ');
  var budgetPts = cum.map(function(_, i) { return px(i).toFixed(1) + ',' + py(budgetCents * (i + 1) / 12).toFixed(1); }).join(' ');
  var gridlines = [44, 88, 132, 176].map(function(y) { return '<line x1="' + x0 + '" y1="' + y + '" x2="628" y2="' + y + '"></line>'; }).join('');
  var axisLabels = [0, 1, 2, 3].map(function(i) {
    var val = maxCents * (1 - i / 3.4);
    return '<text x="8" y="' + (48 + i * 44) + '">' + finMoney0(val) + '</text>';
  }).join('');
  var monthLabels = cum.map(function(_, i) {
    return '<text x="' + px(i).toFixed(1) + '" y="196">' + MONTH_NAMES[i].slice(0, 3) + '</text>';
  }).join('');
  var behindCents = budgetCents ? (budgetCents * through / 12) - cum[cum.length - 1] : 0;
  var what = scoped ? 'General Fund offerings' : 'All offerings';
  var sub = budgetCents
    ? what + ' to date vs. the straight-line budget line. ' + (behindCents > 0 ? 'Running ' + finMoney0(behindCents) + ' behind.' : 'Running ' + finMoney0(-behindCents) + ' ahead.')
    : what + ' to date. ' + finPaceNoBudgetNote(pace, scoped);
  // Naming what was left out matters more than the chart: a reader who knows the plate held more
  // than this line shows should be able to see why without leaving the page.
  // Which ledger accounts the budget line came from — the same reason the cash card names its
  // account: a pace line drawn off an account the reader did not expect is worse than none.
  if (budgetCents && (pace.budgetAccounts || []).length) {
    var accts = pace.budgetAccounts.slice(0, 3).map(esc).join(', ');
    sub += ' Budget from ' + accts + (pace.budgetAccounts.length > 3 ? ' and ' + (pace.budgetAccounts.length - 3) + ' more' : '') + '.';
  }
  if (scoped && pace.excludedCents) {
    sub += ' ' + finMoney0(pace.excludedCents) + ' given to designated and pass-through funds is not counted here.';
  } else if (!scoped) {
    sub += ' Every fund is counted — no fund is categorized as the General Fund yet (Settings → Fund categories).';
  }
  return '<div class="fin-card">'
    + '<div class="fin-card-title" style="font-size:20px;">' + esc(title) + '</div>'
    + '<div class="fin-card-sub">' + sub + '</div>'
    + '<svg viewBox="0 0 ' + W + ' 220" width="100%" height="200" role="img" aria-label="Cumulative giving versus budget pace, '
    + (behindCents > 0 ? 'running behind by ' + finMoney0(behindCents) : 'running at or ahead of pace') + '">'
    + '<g stroke="var(--warm-row-divider)" stroke-width="1">' + gridlines + '</g>'
    + '<g font-size="10" fill="var(--warm-meta)">' + axisLabels + '</g>'
    + '<polygon points="' + actualPts + ' ' + px(cum.length - 1).toFixed(1) + ',' + yBot + ' ' + x0 + ',' + yBot + '" fill="var(--color-light-teal)"></polygon>'
    + (budgetCents ? '<polyline points="' + budgetPts + '" fill="none" stroke="var(--color-gold)" stroke-width="2.5" stroke-dasharray="6 5"></polyline>' : '')
    + '<polyline points="' + actualPts + '" fill="none" stroke="var(--color-teal)" stroke-width="3"></polyline>'
    + '<circle cx="' + px(cum.length - 1).toFixed(1) + '" cy="' + py(cum[cum.length - 1]).toFixed(1) + '" r="4.5" fill="var(--color-teal)"></circle>'
    + '<g font-size="10.5" fill="var(--warm-meta)" text-anchor="middle">' + monthLabels + '</g>'
    + '<g font-size="11" font-weight="700">'
    + finPaceEndLabels(py(cum[cum.length - 1]), budgetCents ? py(budgetCents * through / 12) : null)
    + '</g></svg></div>';
}

// Names which account produced the cash figure, and as of when. A runway is only as good as the
// balance under it: "3.4 months" off an account the reader did not expect is worse than no number,
// so the account is stated rather than left to be assumed.
function finCashSourceNote(c) {
  if (c.source === 'balance_sheet') {
    var accts = (c.accounts || []).join(', ');
    return ' &middot; cash from ' + (accts ? esc(accts) : 'the balance sheet')
      + (c.asOfDate ? ' as of ' + esc(c.asOfDate) : '');
  }
  if (c.source === 'quickbooks') return ' &middot; cash from QuickBooks checking/savings';
  if (c.source === 'manual') return ' &middot; cash entered by hand';
  return '';
}
// Daycare wages and costs are outside the burn rate on purpose, and the card says so with the
// figure: a reader comparing this against total expenses on the Church Report should be able to
// see the difference accounted for rather than assume one of the two is wrong.
function finCashDaycareNote(c) {
  if (!c.daycareExcludedCents) return '';
  return ' &middot; ' + finMoney0(c.daycareExcludedCents) + ' of daycare expense left out (it stops when the tuition does)';
}
// 1.6b — months of operating cash against the congregation's own policy floor.
function finRenderCashRunway(d) {
  var c = d.cash || {};
  if (!c.available) {
    return '<div class="fin-card">'
      + '<div class="fin-card-title" style="font-size:20px;">Operating cash runway</div>'
      + '<p style="font-size:.85rem;color:var(--warm-gray);">Not yet available — this needs a cash-on-hand figure and at least some <b>church</b> expense actuals for the year (daycare expenses are excluded from the burn rate). Cash comes from the imported balance sheet\'s operating account (import one from <b>Data &amp; Imports</b>, and name the account code there under <b>Classification &amp; policy</b>), or from a QuickBooks sync, or typed by hand.</p></div>';
  }
  var months = c.monthsOfCash;
  var below = months < c.policyFloorMonths;
  var fillPct = Math.min(100, months / 12 * 100);
  var markerPct = Math.min(100, c.policyFloorMonths / 12 * 100);
  return '<div class="fin-card" style="display:flex;flex-direction:column;gap:14px;">'
    + '<div><div class="fin-card-title" style="font-size:20px;">Operating cash runway</div>'
    + '<div class="fin-card-sub" style="margin:0;">' + finMoney0(c.onHandCents) + ' on hand &middot; ' + finMoney0(c.avgMonthlyExpenseCents) + ' average month of <b>church operations</b>'
    + finCashSourceNote(c) + finCashDaycareNote(c) + '</div></div>'
    + '<div>'
    + '<div style="display:flex;align-items:baseline;gap:8px;"><span style="font-size:38px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1;color:' + (below ? 'var(--danger)' : 'var(--sage-text)') + ';">' + months.toFixed(1) + '</span>'
    + '<span style="font-size:14px;font-weight:700;color:var(--warm-ink-label);">months</span></div>'
    + '<div style="height:14px;border-radius:8px;background:var(--linen);position:relative;margin-top:10px;overflow:hidden;">'
    + '<div style="position:absolute;left:0;top:0;bottom:0;width:' + fillPct.toFixed(1) + '%;background:' + (below ? 'var(--danger)' : 'var(--sage)') + ';"></div>'
    + '<div style="position:absolute;left:' + markerPct.toFixed(1) + '%;top:0;bottom:0;width:2px;background:var(--color-navy);"></div></div>'
    + '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--warm-meta);margin-top:5px;">'
    + '<span>0</span><span style="font-weight:700;color:var(--color-navy);">' + c.policyFloorMonths + '-month policy floor</span><span>12</span></div>'
    + '</div>'
    + '<div class="fin-note-box">' + (c.gapToFloorCents > 0
      ? 'Reaching the ' + c.policyFloorMonths + '-month floor takes <b>' + finMoney0(c.gapToFloorCents) + '</b> more in reserves — the second half of any appeal target.'
      : 'Reserves are above the ' + c.policyFloorMonths + '-month floor, by ' + finMoney0(c.onHandCents - c.floorCents) + '.') + '</div>'
    + '</div>';
}

// 1.7a — five years of the mix, as stacked columns. The story is the mix, not the total.
function finRenderFiveYearMix() {
  var my = _finChurchMultiYearData;
  if (!my || !my.streamsByYear || !my.years || my.years.length < 2) return '';
  var years = my.years.slice(-5);
  // Merged to the display streams for the same reason the mix bar is: a restricted band stacked
  // beside donor makes donor income read smaller than the giving that produced it, and does it
  // across five years at once.
  var totals = years.map(function(y) {
    var s = my.streamsByYear[y];
    return { year: y, streams: s ? finDisplayStreams(s.streams) : null, total: s ? s.totalCents : 0 };
  });
  var maxTotal = Math.max.apply(null, totals.map(function(t) { return t.total; }).concat([1]));
  var W = 620, base = 164, topY = 30, plotH = base - topY, left = 74, barW = 64;
  var slot = (562 - left) / Math.max(1, years.length);
  var bars = totals.map(function(t, i) {
    if (!t.streams) return '';
    var x = left + slot * i + (slot - barW) / 2;
    var y = base, out = '';
    FIN_DISPLAY_STREAM_KEYS.forEach(function(s) {
      var cents = (t.streams[s] || { cents: 0 }).cents;
      var h = cents / maxTotal * plotH;
      if (h <= 0) return;
      y -= h;
      out += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW + '" height="' + h.toFixed(1) + '" rx="2" fill="' + REVENUE_STREAM_COLORS[s] + '"></rect>';
    });
    return out + '<text x="' + (x + barW / 2).toFixed(1) + '" y="180" font-size="10.5" fill="var(--warm-meta)" text-anchor="middle">' + t.year + '</text>';
  }).join('');
  var gl = [0, 1, 2, 3].map(function(i) {
    var y = base - plotH * i / 3;
    return '<line x1="52" y1="' + y.toFixed(1) + '" x2="612" y2="' + y.toFixed(1) + '"></line>';
  }).join('');
  var glLabels = [0, 1, 2, 3].map(function(i) {
    var y = base - plotH * i / 3;
    return '<text x="6" y="' + (y + 4).toFixed(1) + '">' + finMoney0(maxTotal * i / 3) + '</text>';
  }).join('');
  var first = totals[0], last = totals[totals.length - 1];
  function streamCents(t, key) { return (t && t.streams && t.streams[key]) ? t.streams[key].cents : 0; }
  var donorDelta = streamCents(last, 'donor') - streamCents(first, 'donor');
  var earnedDelta = streamCents(last, 'earned') - streamCents(first, 'earned');
  var story = (Math.abs(donorDelta) < Math.abs(earnedDelta))
    ? 'Donor revenue roughly flat while earned income moved ' + finFmtSigned(earnedDelta) + '. The mix, not the total, is the story.'
    : 'Donor revenue moved ' + finFmtSigned(donorDelta) + ' and earned income ' + finFmtSigned(earnedDelta) + ' across the window.';
  return '<div class="fin-card">'
    + '<div class="fin-card-title" style="font-size:20px;">Five years of the mix</div>'
    + '<div class="fin-card-sub">' + story + '</div>'
    + '<svg viewBox="0 0 ' + W + ' 210" width="100%" height="196" role="img" aria-label="Stacked revenue mix by year, '
    + years[0] + ' to ' + years[years.length - 1] + '. ' + story + '">'
    + '<g stroke="var(--warm-row-divider)" stroke-width="1">' + gl + '</g>'
    + '<g font-size="10" fill="var(--warm-meta)">' + glLabels + '</g>'
    + bars
    + '<g font-size="10.5" font-weight="700">'
    + '<text x="52" y="202" fill="var(--color-teal)">&#9632; Donor</text>'
    + '<text x="132" y="202" fill="var(--deep-amber)">&#9632; Earned</text>'
    + '<text x="216" y="202" fill="var(--sage-text)">&#9632; Passive</text>'
    + '</g></svg></div>';
}

// The two figures every "what should we do" block on this page is built from: the operating gap
// to close, and the distance to the reserve floor. Derived once so the fundraising callout, the
// appeal target, the lever cards and the decisions card can never state different numbers.
function finHealthTargets(d) {
  var net = d.netIncome || { actualCents: 0 };
  var projected = (d.yoy && d.yoy.available) ? d.yoy.net.projectedFullYearCents : net.actualCents;
  var gapCents = Math.max(0, -projected);
  var reserveGapCents = (d.cash && d.cash.available) ? (d.cash.gapToFloorCents || 0) : 0;
  return {
    gapCents: gapCents,
    reserveGapCents: reserveGapCents,
    projectedCents: projected,
    targetCents: _finAppealScope === 'gap' ? gapCents : gapCents + reserveGapCents,
  };
}

// 1.7b + 1.8 + 1.9 — what the picture points to, what an appeal would have to look like, and the
// decisions that follow. The ask ladder's total is recomputed from its own whole-household rows,
// and the header states that total — so the target and the ladder can never disagree.
var FIN_APPEAL_TIERS = [
  { askCents: 250000, weight: 0.28, color: 'var(--color-navy)' },
  { askCents: 100000, weight: 0.28, color: 'var(--color-teal)' },
  { askCents: 50000, weight: 0.28, color: 'var(--color-gold)' },
  { askCents: 20000, weight: 0.16, color: 'var(--sage)' },
];
function finComputeAppealLadder(targetCents) {
  if (!targetCents || targetCents <= 0) return { tiers: [], totalCents: 0, totalHouseholds: 0 };
  var tiers = FIN_APPEAL_TIERS.map(function(t) {
    var households = Math.max(1, Math.ceil((targetCents * t.weight) / t.askCents));
    return { askCents: t.askCents, color: t.color, households: households, raisesCents: households * t.askCents };
  });
  return {
    tiers: tiers,
    totalCents: tiers.reduce(function(s, t) { return s + t.raisesCents; }, 0),
    totalHouseholds: tiers.reduce(function(s, t) { return s + t.households; }, 0),
  };
}
function finRenderAppealCard(d) {
  var t = finHealthTargets(d);
  var ladder = finComputeAppealLadder(t.targetCents);
  var pills = finPills([
    { key: 'gapReserves', label: 'Gap + reserves' },
    { key: 'gap', label: 'Gap only' },
  ], _finAppealScope, 'finAppealSetScope');
  if (!t.targetCents) {
    return '<div class="fin-card">'
      + '<div class="fin-card-hdr-split"><div><div class="fin-card-title" style="font-size:20px;">What an appeal would have to look like</div>'
      + '<div class="fin-card-sub" style="margin:0;">Nothing to close right now — the year is projected to end in surplus and reserves are at or above the policy floor.</div></div>' + pills + '</div>'
      + '</div>';
  }
  var maxHh = ladder.tiers.reduce(function(m, x) { return Math.max(m, x.households); }, 1);
  var rows = ladder.tiers.map(function(tier) {
    return '<div class="fin-ladder-row">'
      + '<span style="font-size:14px;font-weight:700;">$' + finFmtMoney(tier.askCents / 100) + '</span>'
      + '<span style="display:flex;align-items:center;gap:9px;"><span style="height:11px;border-radius:6px;background:' + tier.color + ';width:' + (tier.households / maxHh * 88).toFixed(1) + '%;"></span>'
      + '<span style="font-size:12.5px;color:var(--warm-ink-label);font-weight:600;white-space:nowrap;">' + tier.households + ' household' + (tier.households === 1 ? '' : 's') + '</span></span>'
      + '<span style="text-align:right;font-size:13.5px;font-weight:700;font-variant-numeric:tabular-nums;">$' + finFmtMoney(tier.raisesCents / 100) + '</span>'
      + '</div>';
  }).join('');
  var hh = d.givingHouseholds || 0;
  var share = hh ? Math.round(ladder.totalHouseholds / hh * 100) : null;
  var bands = d.donorBands || [];
  var maxBand = bands.reduce(function(m, b) { return Math.max(m, b.households); }, 1);
  var bandColors = ['var(--color-navy)', 'var(--color-teal)', 'var(--color-gold)'];
  var bandHtml = bands.map(function(b, i) {
    return '<div style="display:flex;justify-content:space-between;font-size:12.5px;"><span style="color:var(--warm-ink-label);">' + esc(b.label) + '</span><b style="font-variant-numeric:tabular-nums;">' + b.households + ' hh</b></div>'
      + '<div style="height:8px;border-radius:5px;background:var(--warm-divider);"><div style="width:' + (b.households / maxBand * 100).toFixed(1) + '%;height:100%;border-radius:5px;background:' + bandColors[i % bandColors.length] + ';"></div></div>';
  }).join('');
  var topBand = bands[0];
  var sub = _finAppealScope === 'gap'
    ? 'Target <b style="color:var(--charcoal);">' + finMoney0(ladder.totalCents) + '</b> — the projected operating gap alone.'
    : 'Target <b style="color:var(--charcoal);">' + finMoney0(ladder.totalCents) + '</b> — close the ' + finMoney0(t.gapCents) + ' operating gap <i>and</i> rebuild reserves to the policy floor.';
  return '<div class="fin-card">'
    + '<div class="fin-card-hdr-split">'
      + '<div><div class="fin-card-title" style="font-size:20px;">What an appeal would have to look like</div>'
      + '<div class="fin-card-sub" style="margin:0;">' + sub + (hh ? ' ' + hh + ' giving households.' : '') + '</div></div>'
      + pills
    + '</div>'
    + '<div class="fin-appeal-grid">'
      + '<div style="display:flex;flex-direction:column;gap:10px;">'
        + '<div class="fin-ladder-row fin-ladder-head"><span>Ask level</span><span>Households needed</span><span style="text-align:right;">Raises</span></div>'
        + rows
        + '<div class="fin-ladder-row fin-ladder-total">'
        + '<span style="font-size:13px;font-weight:800;color:var(--color-navy);">' + ladder.totalHouseholds + ' households</span>'
        + '<span style="font-size:12.5px;color:var(--warm-gray);">' + (share != null ? share + '% of everyone who gave this year' : 'no giving records to compare against') + '</span>'
        + '<span style="text-align:right;font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--color-navy);">' + finMoney0(ladder.totalCents) + '</span>'
        + '</div>'
      + '</div>'
      + '<div class="fin-bands-panel">'
        + '<div class="fin-eyebrow">Read against real giving bands</div>'
        + (topBand ? '<div style="font-size:13px;color:var(--warm-ink-label);line-height:1.55;">' + topBand.households + ' households already give above $2,000 a year — the top tier asks ' + ladder.tiers[0].households + ' of them for one extra gift, not a new habit.</div>' : '')
        + '<div style="display:flex;flex-direction:column;gap:8px;">' + bandHtml + '</div>'
        + '<div><button class="btn-primary" onclick="finOpenGivingBands()">Open giving bands &rarr;</button></div>'
      + '</div>'
    + '</div></div>';
}
function finRenderLeverCards(d) {
  var t = finHealthTargets(d);
  var elapsedPct = finElapsedYearPct(d.year);
  var tree = finReorganizeChurchTree(finBuildTreeFromFlatRows(d.entries));
  var expenseRoot = tree.filter(function(n) { return n.classification === 'Expenses'; })[0];
  var overPace = ((expenseRoot && expenseRoot.children) || []).map(function(n) {
    return { label: n.label, diff: n.totalActualCents - n.totalBudgetCents * elapsedPct, hasBudget: n.totalBudgetCents > 0 };
  }).filter(function(x) { return x.hasBudget && x.diff > 150000; }).sort(function(a, b) { return b.diff - a.diff; });
  var cutCents = overPace.reduce(function(s, x) { return s + x.diff; }, 0);
  var p = _finProperty;
  var latestDist = p ? finComputeLatestDistributionAmount(p) : null;
  var distCents = latestDist ? latestDist.cents : 0;
  var residual = Math.max(0, t.targetCents - cutCents - distCents);
  function card(eyebrow, headline, body, amount, color) {
    return '<div class="fin-card fin-lever-card">'
      + '<div class="fin-eyebrow">' + eyebrow + '</div>'
      + '<div style="font-size:15.5px;font-weight:700;line-height:1.3;">' + headline + '</div>'
      + '<div style="font-size:12.5px;color:var(--warm-ink-label);margin-top:6px;line-height:1.55;">' + body + '</div>'
      + '<div style="margin-top:10px;font-size:20px;font-weight:800;font-variant-numeric:tabular-nums;color:' + color + ';">' + amount + '</div></div>';
  }
  return '<div class="fin-grid-3">'
    + card('Lever 1 &middot; Cut',
        overPace.length ? 'Trim the ' + (overPace.length === 1 ? 'one over-pace category' : overPace.length + ' over-pace categories') : 'Nothing is running over pace',
        overPace.length
          ? overPace.slice(0, 2).map(function(x) { return esc(x.label); }).join(' and ') + ' ' + (overPace.length > 1 ? 'are' : 'is') + ' ' + finMoney0(cutCents) + ' ahead of the calendar. Holding to budget recovers that much.'
          : 'Every expense category with a budget is at or under the calendar. There is nothing here to cut back toward plan.',
        cutCents ? '&minus;' + finMoney0(cutCents) : '$0', 'var(--deep-amber)')
    + card('Lever 2 &middot; Distribute', 'Take an Ivanhoe distribution',
        distCents ? finMoney0(distCents) + ' is distributable today without dipping into reserves or deferring capital work.' : 'No AHRA distribution figure has been recorded yet, so there is nothing to draw on with confidence.',
        distCents ? '&minus;' + finMoney0(distCents) : '—', 'var(--color-teal)')
    + card('Lever 3 &middot; Ask', residual > 0 ? 'An appeal for the rest' : 'An appeal is not needed to close the gap',
        residual > 0
          ? 'After the two levers above, ' + finMoney0(residual) + ' of the ' + finMoney0(t.targetCents) + ' target is left for an appeal to carry.'
          : 'The two levers above cover the whole target. An appeal&rsquo;s real job would be reserves and the space MDO needs, not the operating gap.',
        finMoney0(residual), 'var(--sage-text)')
    + '</div>';
}
function finRenderDecisions(d) {
  var t = finHealthTargets(d);
  var p = _finProperty;
  var latestDist = p ? finComputeLatestDistributionAmount(p) : null;
  var taken = p ? finComputeDistributedThisYear(p) : { cents: 0, year: d.year };
  var elapsedPct = finElapsedYearPct(d.year);
  var tree = finReorganizeChurchTree(finBuildTreeFromFlatRows(d.entries));
  var expenseRoot = tree.filter(function(n) { return n.classification === 'Expenses'; })[0];
  var overPace = ((expenseRoot && expenseRoot.children) || []).map(function(n) {
    return { label: n.label, diff: n.totalActualCents - n.totalBudgetCents * elapsedPct, hasBudget: n.totalBudgetCents > 0 };
  }).filter(function(x) { return x.hasBudget && x.diff > 150000; }).sort(function(a, b) { return b.diff - a.diff; });
  function sub(eyebrow, eyebrowColor, headline, body, btnLabel, btnCls, onclick) {
    return '<div class="fin-decision">'
      + '<div class="fin-eyebrow" style="color:' + eyebrowColor + ';">' + eyebrow + '</div>'
      + '<div style="font-size:15px;font-weight:700;color:var(--charcoal);line-height:1.3;">' + headline + '</div>'
      + '<div style="font-size:12.5px;color:var(--warm-ink-label);line-height:1.5;">' + body + '</div>'
      + '<div><button class="' + btnCls + '" onclick="' + onclick + '">' + btnLabel + '</button></div></div>';
  }
  return '<div class="fin-card">'
    + '<div class="fin-card-title" style="font-size:20px;">So what do we decide?</div>'
    + '<div class="fin-card-sub">Three decisions this picture puts in front of the council this month.</div>'
    + '<div class="fin-grid-3">'
    + sub('Fundraising', 'var(--color-teal)',
        t.targetCents ? 'Size an appeal at ' + finMoney0(t.gapCents) + ' — or ' + finMoney0(t.gapCents + t.reserveGapCents) + ' with reserves.' : 'No appeal is needed to balance the year.',
        t.targetCents ? 'Closes the projected operating gap and rebuilds reserves to the policy floor.' : 'The year is projected to end in surplus with reserves at or above the floor.',
        'Open giving &rarr;', 'btn-primary', 'showTab(\'giving\')')
    + sub('Mid-year adjustment', 'var(--deep-amber)',
        overPace.length ? (overPace.length === 1 ? 'One category is running ahead of the calendar.' : overPace.length + ' categories are running ahead of the calendar.') : 'Spending is tracking the calendar.',
        overPace.length
          ? overPace.slice(0, 3).map(function(x) { return esc(x.label) + ' <b>' + finFmtSigned(x.diff) + '</b> over pace'; }).join('<br>')
          : 'No expense category with a budget is materially ahead of where the calendar says it should be.',
        'Open Church Report &rarr;', 'btn-secondary', 'finNavGo(\'church\')')
    + sub('Ivanhoe distribution', 'var(--sage-text)',
        latestDist ? finMoney0(latestDist.cents) + ' is distributable without touching reserves.' : 'No current distribution figure on record.',
        latestDist
          ? 'We have taken ' + finMoney0(taken.cents) + ' so far in ' + taken.year + (t.gapCents && latestDist.cents - taken.cents >= t.gapCents ? ' — another ' + finMoney0(t.gapCents) + ' would cover the operating gap outright.' : '.')
          : 'Record the latest AHRA monthly report to see what is available.',
        'Open Commercial Property &rarr;', 'btn-secondary', 'finNavGo(\'property\')')
    + '</div></div>';
}
function finRenderFundraisingCallout(d) {
  var t = finHealthTargets(d);
  var rooms = _finDaycareRooms;
  var waiting = (rooms && rooms.occupancy) ? rooms.occupancy.waitingFamilies : null;
  function row(label, value, color) {
    return '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;border-top:1px solid rgba(255,255,255,.22);padding-top:10px;">'
      + '<span style="font-size:12.5px;color:rgba(255,255,255,.8);">' + label + '</span>'
      + '<b style="font-size:17px;font-variant-numeric:tabular-nums;color:' + color + ';">' + value + '</b></div>';
  }
  return '<div class="fin-navy-card" style="display:flex;flex-direction:column;gap:14px;">'
    + '<div><div class="fin-navy-label">What this points to</div>'
    + '<div style="font-family:var(--font-display);font-size:22px;font-weight:700;line-height:1.15;margin-top:2px;">Donor revenue has to grow, because it&rsquo;s the only stream we can grow.</div></div>'
    + '<div style="display:flex;flex-direction:column;gap:10px;">'
    + row('Close the operating gap', t.gapCents ? finMoney0(t.gapCents) : 'none', t.gapCents ? 'var(--negative-on-navy)' : 'var(--positive-on-navy)')
    + row('Reserves to the policy floor', t.reserveGapCents ? finMoney0(t.reserveGapCents) : 'at floor', t.reserveGapCents ? 'var(--pale-gold)' : 'var(--positive-on-navy)')
    + row('Room to serve waiting families', waiting ? waiting + ' waiting' : 'needs the daycare API', 'var(--positive-on-navy)')
    + '</div>'
    + '<div><button class="btn-white" onclick="showTab(\'giving\')">Build a fundraising plan &rarr;</button></div>'
    + '</div>';
}

function finRenderHealth() {
  var root = document.getElementById('fin-health-root');
  if (!root) return;
  var d = _finHealthData;
  if (!d) return;
  if (!d.entries || !d.entries.length) {
    root.innerHTML = '<div class="fin-card"><div class="fin-card-title" style="font-size:20px;">Financial Health</div>'
      + '<p style="font-size:.85rem;color:var(--warm-gray);">No church ledger data for ' + d.year + ' yet. Connect QuickBooks or run an import from the <b>Data &amp; Imports</b> tab, and this page fills in.</p></div>';
    return;
  }
  var rs = d.revenueStreams || { streams: {}, totalCents: 0 };
  var actions = '<button class="btn-secondary" onclick="finExportBoardPacket()">Export board packet</button>'
    + '<button class="btn-secondary" onclick="window.print()">Print</button>';
  var sub = 'FY' + d.year + ' run rate &middot; ' + finMoney0(rs.totalCents) + ' total revenue &middot; all three entities';
  var unmappedNote = (rs.unmapped && rs.unmapped.length && _userRole === 'admin')
    ? '<div class="fin-note-box" style="margin-bottom:0;">' + rs.unmapped.length + ' account group'
      + (rs.unmapped.length === 1 ? ' was' : 's were') + ' classified by name and never confirmed ('
      + rs.unmapped.slice(0, 3).map(function(u) { return esc(u.label); }).join(', ')
      + (rs.unmapped.length > 3 ? ', …' : '') + '). This page is only as honest as that mapping — '
      + '<button class="fin-link-btn" onclick="finNavGo(\'data\')">review it on Data &amp; Imports</button>.</div>'
    : '';

  root.innerHTML = '<div class="fin-health-page">'
    + finPageHeader('Where the money comes from', sub, actions)
    + unmappedNote
    + finRenderRevenueMix(rs.streams, rs.totalCents)
    + finRenderStreamCards(d)
    + finRenderDesignatedFunds(d)
    + finRenderFlow(d)
    + finRenderEntityCards(d)
    + '<div class="fin-grid-pace">' + finRenderGivingPace(d) + finRenderCashRunway(d) + '</div>'
    + '<div class="fin-grid-mix">' + finRenderFiveYearMix() + finRenderFundraisingCallout(d) + '</div>'
    + finRenderAppealCard(d)
    + finRenderLeverCards(d)
    + finRenderDecisions(d)
    + '<div class="fin-page-footnote">Imports, QuickBooks connection, daycare sync and manual entry live on a separate <b>Data &amp; Imports</b> tab — off this page entirely.</div>'
    + '</div>';

  // The five-year mix needs the multi-year payload; fetch it once and re-render when it arrives.
  if (!_finChurchMultiYearData) finLoadChurchMultiYear();
}

// The band report lives in the Giving tab's Analysis view ('analysis' is an alias givSetView
// resolves to the Reports view in analysis mode) — showTab's own second argument only means
// anything for the finance tab, so the view has to be set explicitly after the switch.
function finOpenGivingBands() {
  showTab('giving');
  if (typeof givSetView === 'function') givSetView('analysis');
}

// Lazy-init for the Giving tab's Reports view (moved there from the Finance tab — see
// givSetView() in js-giving.js) — mirrors initReportTrendYears()'s own idempotent guard, safe
// to call every time this view is shown. initReportTrendYears() is defined in js-reports.js
// (loaded earlier in the module concatenation order) and already no-ops harmlessly if its
// target element isn't found.
function finInitGivingReports() {
  initReportTrendYears();
  var curY = new Date().getFullYear();
  var yoyEl = document.getElementById('rpt-yoy-year');
  if (yoyEl && !yoyEl.value) yoyEl.value = curY;
  var insightsEl = document.getElementById('rpt-insights-year');
  if (insightsEl && !insightsEl.value) insightsEl.value = curY;
}

// QuickBooks redirects back to '/?qb_connected=1#finance' (or qb_error=...) after the OAuth
// consent screen — read the plain query string (not the hash) so the SPA's hash-based tab
// router is never handed anything but a clean '#finance'.
function finCheckOauthReturn() {
  var params = new URLSearchParams(location.search);
  var connected = params.get('qb_connected');
  var error = params.get('qb_error');
  if (!connected && !error) return;
  history.replaceState(null, '', location.pathname + location.hash);
  if (connected) finToast('QuickBooks connected. Click "Sync Now" to pull your data.');
  else finToast('QuickBooks connection failed: ' + error);
}
function finToast(msg) {
  var el = document.getElementById('fin-toast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(function() { el.style.display = 'none'; }, 8000);
}

// ── QuickBooks connection card ───────────────────────────────────────
function finRenderConnection() {
  var el = document.getElementById('fin-connection');
  if (!_finStatus.configured) {
    el.innerHTML = '<p style="color:var(--warm-gray);font-size:.85rem;">QuickBooks is not configured yet. An admin needs to add <code>QB_CLIENT_ID</code> and <code>QB_CLIENT_SECRET</code> (see SECRETS.md) from an Intuit Developer app before connecting.</p>';
    return;
  }
  var isAdminUI = (_userRole === 'admin');
  if (!_finStatus.connected) {
    el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);margin:0 0 10px;">Not connected.</p>'
      + (isAdminUI
        ? '<a class="btn-primary" style="display:inline-block;text-decoration:none;" href="/admin/api/finance/qb/connect">Connect QuickBooks</a>'
        : '<p style="font-size:.78rem;color:var(--warm-gray);">Ask an admin to connect QuickBooks.</p>');
    return;
  }
  var lastSync = _finStatus.lastSyncedAt ? finFmtTs(_finStatus.lastSyncedAt) : 'never';
  el.innerHTML =
    '<p style="font-size:.9rem;margin:0 0 4px;"><b>' + esc(_finStatus.companyName || 'Connected') + '</b></p>'
    + '<p style="font-size:.78rem;color:var(--warm-gray);margin:0 0 10px;">Last synced: ' + esc(lastSync) + '</p>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
    + '<button class="btn-primary" onclick="finSync(this)">Sync Now</button>'
    + '<button class="btn-secondary" onclick="finOpenSyncYears()">Sync Selected Years (Actuals Only)…</button>'
    + (isAdminUI ? '<button class="btn-secondary" onclick="finDisconnect()">Disconnect</button>' : '')
    + (isAdminUI ? '<button class="btn-secondary" onclick="finLoadBudgetPicker(this)">Choose Budget…</button>' : '')
    + '</div>'
    + '<div id="fin-budget-picker" style="margin-top:10px;"></div>'
    + '<div id="fin-sync-years-picker" style="margin-top:10px;display:none;"></div>'
    + '<div id="fin-sync-msg" style="font-size:.78rem;margin-top:8px;"></div>';
}
// A company can have more than one Budget object in QuickBooks (e.g. a leftover test budget
// alongside the real one) — the sync otherwise guesses (best year-match, else the first found).
// This lets an admin see every budget QuickBooks actually has and pin the right one explicitly.
function finLoadBudgetPicker(btn) {
  var el = document.getElementById('fin-budget-picker');
  el.innerHTML = '<p style="font-size:.8rem;color:var(--warm-gray);">Loading budgets…</p>';
  api('/admin/api/finance/qb/budgets').then(function(d) {
    if (!d || d.error) { el.innerHTML = '<p style="font-size:.8rem;color:var(--danger);">' + esc((d && d.error) || 'Could not load budgets.') + '</p>'; return; }
    if (!d.budgets || !d.budgets.length) { el.innerHTML = '<p style="font-size:.8rem;color:var(--warm-gray);">No Budget objects found in QuickBooks. Create one under Settings &gt; Budgeting.</p>'; return; }
    var opts = d.budgets.map(function(b) {
      var label = b.name + ' (' + (b.startDate || '?') + ' – ' + (b.endDate || '?') + ')' + (b.active ? '' : ' [inactive]');
      var sel = (String(d.selectedBudgetId || '') === String(b.id)) ? ' selected' : '';
      return '<option value="' + esc(b.id) + '"' + sel + '>' + esc(label) + '</option>';
    }).join('');
    el.innerHTML = '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
      + '<select id="fin-budget-select" style="max-width:340px;"><option value="">Auto (best year match)</option>' + opts + '</select>'
      + '<button class="btn-primary" onclick="finSaveBudgetChoice()">Save &amp; Re-sync</button>'
      + '</div>';
  });
}
function finSaveBudgetChoice() {
  var sel = document.getElementById('fin-budget-select');
  var id = sel ? sel.value : '';
  api('/admin/api/finance/qb/budgets', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ budget_id: id || null }) }).then(function(d) {
    if (d && d.error) { finToast('Could not save: ' + d.error); return; }
    finToast('Budget selection saved. Syncing…');
    finSync();
  });
}
function finFmtTs(iso) {
  try { return new Date(iso).toLocaleString('en-US', {dateStyle: 'medium', timeStyle: 'short'}); }
  catch (e) { return iso; }
}
function finSync(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  api('/admin/api/finance/qb/sync', { method: 'POST' }).then(function(d) {
    if (btn) { btn.disabled = false; btn.textContent = 'Sync Now'; }
    if (d && d.error) { finToast('Sync failed: ' + d.error); return; }
    if (d && d.warnings && d.warnings.length) finToast('Synced with warnings: ' + d.warnings.join(' '));
    else finToast('Synced successfully.');
    loadFinance();
  }).catch(function(err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Sync Now'; }
    finToast('Sync failed: ' + (err && err.message || 'Unknown error'));
  });
}
function finDisconnect() {
  if (!confirm('Disconnect QuickBooks? You can reconnect later, but cached report data will be cleared.')) return;
  api('/admin/api/finance/qb/disconnect', { method: 'POST' }).then(function() { loadFinance(); });
}

// Clears only finance_church_entries + finance_qb_snapshot (the church budget/actuals and their
// cached Budget vs Actual blob) — never Daycare Report, Balance Sheet, Budget Planning, Commercial
// Property, or giving data, per an explicit, narrowly-scoped user decision. Preview-then-confirm,
// same pattern as the giving reconcile tools: the confirm step echoes back the exact counts shown
// in preview, so a stale page can't silently wipe data that changed in between.
var _finClearDataCounts = null;
function finLoadClearDataPreview() {
  var el = document.getElementById('fin-clear-data-panel');
  el.innerHTML = '<p style="font-size:.8rem;color:var(--warm-gray);">Loading…</p>';
  api('/admin/api/finance/church/clear-all-preview').then(function(d) {
    if (!d || d.error) { el.innerHTML = '<p style="font-size:.8rem;color:var(--danger);">' + esc((d && d.error) || 'Could not load preview.') + '</p>'; return; }
    _finClearDataCounts = d.counts;
    var total = Object.keys(d.counts).reduce(function(s, k) { return s + d.counts[k]; }, 0);
    if (!total) { el.innerHTML = '<p style="font-size:.8rem;color:var(--warm-gray);">Nothing to clear — church budget/actuals data is already empty.</p>'; return; }
    el.innerHTML = '<p style="font-size:.82rem;margin:0 0 8px;">This will permanently delete <b>' + total + ' row(s)</b>: ' + d.counts.finance_church_entries + ' Church Report line item(s), ' + d.counts.finance_qb_snapshot + ' cached QuickBooks report snapshot(s). Daycare, Balance Sheet, Budget Planning, Commercial Property, and Giving data are not affected.</p>'
      + '<button class="btn-danger" onclick="finConfirmClearData()">Yes, permanently clear this data</button>';
  });
}
function finConfirmClearData() {
  if (!_finClearDataCounts) return;
  if (!confirm('This cannot be undone. Permanently delete the stored church budget and actuals data?')) return;
  api('/admin/api/finance/church/clear-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm_counts: _finClearDataCounts }) }).then(function(d) {
    if (d && d.error) { finToast('Could not clear: ' + d.error); finLoadClearDataPreview(); return; }
    _finClearDataCounts = null;
    document.getElementById('fin-clear-data-panel').innerHTML = '<p style="font-size:.8rem;color:var(--sage);">Cleared. Sync QuickBooks or import a report to repopulate.</p>';
    finToast('Church budget/actuals data cleared.');
    loadFinance();
  });
}

// ── Budget vs Actual — generic renderer for QuickBooks' Columns/Rows report shape ──
// QBO's own column set varies by report/params, so this walks whatever it returns rather
// than assuming fixed "budget"/"actual" columns. Section rows carry their label in
// Header.ColData, children in Rows.Row, and a subtotal in Summary.ColData; leaf (Data) rows
// carry their values directly in ColData.
function finRenderBudget(overview) {
  var el = document.getElementById('fin-budget');
  var report = overview.budgetVsActual;
  if (!report || !report.Rows) {
    el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">No budget data yet. Connect QuickBooks and click "Sync Now" — make sure a Budget is set up in QuickBooks under Settings &gt; Budgeting first.</p>';
    return;
  }
  var cols = (report.Columns && report.Columns.Column) || [];
  var theadCells = cols.map(function(c, i) {
    return '<th style="text-align:' + (i === 0 ? 'left' : 'right') + ';padding:6px 8px;">' + esc(c.ColTitle || '') + '</th>';
  }).join('');
  var rowsHtml = finRenderReportRows((report.Rows && report.Rows.Row) || [], 0);
  var fallbackNote = report._synthesized
    ? '<div style="font-size:.72rem;color:#8A5A12;background:var(--pale-gold);border-radius:6px;padding:6px 10px;margin-bottom:8px;">Reconstructed from the raw Budget entity + Profit and Loss report because QuickBooks\' standard Budget vs Actual report returned an error for this account. Shows year-to-date totals, not a monthly breakdown.</div>'
    : '';
  el.innerHTML =
    fallbackNote
    + '<div style="font-size:.72rem;color:var(--warm-gray);margin-bottom:8px;">Synced ' + esc(overview.budgetSyncedAt ? finFmtTs(overview.budgetSyncedAt) : 'never') + '</div>'
    + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr>' + theadCells + '</tr></thead>'
    + '<tbody>' + rowsHtml + '</tbody></table></div>';
}
function finRenderReportRows(rows, depth) {
  var html = '';
  rows.forEach(function(row) {
    if (row.type === 'Section') {
      var headerCells = (row.Header && row.Header.ColData) || [];
      if (headerCells.length) html += finRenderReportRow(headerCells, depth, false);
      if (row.Rows && row.Rows.Row) html += finRenderReportRows(row.Rows.Row, depth + 1);
      var summaryCells = (row.Summary && row.Summary.ColData) || [];
      if (summaryCells.length) html += finRenderReportRow(summaryCells, depth, true);
    } else {
      var cells = row.ColData || [];
      if (cells.length) html += finRenderReportRow(cells, depth, false);
    }
  });
  return html;
}
// Adds thousands separators to a report cell's raw QuickBooks value without disturbing
// anything that isn't a plain number — a trailing "%" (e.g. "882.44 %") is left as-is, and
// non-numeric text (account names) passes through unchanged.
function finFmtReportCellValue(raw) {
  var v = raw == null ? '' : String(raw);
  if (!v || /%\s*$/.test(v)) return v;
  if (!/^-?\d+(\.\d+)?$/.test(v.trim())) return v;
  return finFmtMoney(v);
}
function finRenderReportRow(cells, depth, bold) {
  var tds = cells.map(function(c, i) {
    var align = i === 0 ? 'left' : 'right';
    var leftPad = 10 + depth * 16;
    var text = i === 0 ? (c.value || '') : finFmtReportCellValue(c.value);
    return '<td style="text-align:' + align + ';padding:5px 8px 5px ' + (i === 0 ? leftPad : 8) + 'px;">' + esc(text) + '</td>';
  }).join('');
  return '<tr' + (bold ? ' style="font-weight:600;border-top:1px solid var(--navy);"' : '') + '>' + tds + '</tr>';
}

// ── Account balances — merges QuickBooks accounts with daycare-app accounts (if synced) ──
function finRenderAccounts(overview) {
  var el = document.getElementById('fin-accounts');
  var qboList = ((overview.accounts && overview.accounts.QueryResponse && overview.accounts.QueryResponse.Account) || [])
    .map(function(a) { return { name: a.Name || '', type: a.AccountSubType || a.AccountType || '', balance: Number(a.CurrentBalance) || 0, source: 'QuickBooks' }; });
  var dcList = (overview.daycareAccounts || [])
    .map(function(a) { return { name: a.name || '', type: 'Daycare', balance: (Number(a.balance_cents) || 0) / 100, source: 'Daycare App' }; });
  var all = qboList.concat(dcList);
  if (!all.length) {
    el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">No account balance data yet. Connect QuickBooks (or sync the daycare app below) and click "Sync Now".</p>';
    return;
  }
  all.sort(function(a, b) { return a.source.localeCompare(b.source) || a.name.localeCompare(b.name); });
  var rowsHtml = all.map(function(a) {
    return '<tr><td style="padding:5px 8px;">' + esc(a.name) + '</td>'
      + '<td style="padding:5px 8px;color:var(--warm-gray);font-size:.78rem;">' + esc(a.type) + '</td>'
      + '<td style="padding:5px 8px;color:var(--warm-gray);font-size:.78rem;">' + esc(a.source) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">$' + finFmtMoney(a.balance) + '</td></tr>';
  }).join('');
  var total = all.reduce(function(s, a) { return s + a.balance; }, 0);
  var syncNote = 'QuickBooks synced ' + esc(overview.accountsSyncedAt ? finFmtTs(overview.accountsSyncedAt) : 'never')
    + (dcList.length ? (' &middot; Daycare app synced ' + esc(overview.daycareAccountsSyncedAt ? finFmtTs(overview.daycareAccountsSyncedAt) : 'never')) : '');
  el.innerHTML =
    '<div style="font-size:.72rem;color:var(--warm-gray);margin-bottom:8px;">' + syncNote + '</div>'
    + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr><th style="text-align:left;padding:6px 8px;">Account</th><th style="text-align:left;padding:6px 8px;">Type</th><th style="text-align:left;padding:6px 8px;">Source</th><th style="text-align:right;padding:6px 8px;">Balance</th></tr></thead>'
    + '<tbody>' + rowsHtml + '</tbody>'
    + '<tfoot><tr style="font-weight:600;border-top:2px solid var(--navy);"><td style="padding:6px 8px;" colspan="3">Total</td><td style="padding:6px 8px;text-align:right;">$' + finFmtMoney(total) + '</td></tr></tfoot>'
    + '</table></div>';
}
function finFmtMoney(n) {
  n = Number(n) || 0;
  return n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

// ── Daycare ──────────────────────────────────────────────────────────
// Rows come from two sources: hand-entered ('manual', always editable) and pulled in from
// the daycare app's own finance API ('daycare_api', replaced wholesale on each sync — see
// SECRETS.md for the contract). Only manual rows show a Delete button.
function finRenderDaycareStatus() {
  var el = document.getElementById('fin-daycare-sync');
  if (!_finStatus.daycareConfigured) {
    el.innerHTML = '<p style="font-size:.78rem;color:var(--warm-gray);margin:0 0 10px;">The daycare app is not connected yet — add <code>DAYCARE_API_URL</code> and <code>DAYCARE_API_KEY</code> (see SECRETS.md) once its finance API is built. Manual entries below always work regardless.</p>';
    return;
  }
  var lastSync = _finStatus.daycareLastSyncedAt ? finFmtTs(_finStatus.daycareLastSyncedAt) : 'never';
  el.innerHTML = '<p style="font-size:.78rem;color:var(--warm-gray);margin:0 0 8px;">Daycare app last synced: ' + esc(lastSync) + '</p>'
    + '<button class="btn-secondary" onclick="finSyncDaycare(this)">Sync Daycare App</button>';
}
function finSyncDaycare(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  api('/admin/api/finance/daycare/sync', { method: 'POST' }).then(function(d) {
    if (btn) { btn.disabled = false; btn.textContent = 'Sync Daycare App'; }
    if (d && d.error) { finToast('Daycare sync failed: ' + d.error); return; }
    finToast('Daycare app synced (' + (d.imported || 0) + ' line items).');
    loadFinance();
  }).catch(function(err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Sync Daycare App'; }
    finToast('Daycare sync failed: ' + (err && err.message || 'Unknown error'));
  });
}
function finRenderDaycare() {
  finRenderDaycareStatus();
  var countEl = document.getElementById('fin-daycare-count');
  if (countEl) countEl.textContent = _finDaycare.length;
  var el = document.getElementById('fin-daycare-body');
  if (!_finDaycare.length) {
    el.innerHTML = '<tr><td colspan="6" style="padding:10px;color:var(--warm-gray);font-size:.82rem;">No entries yet. Add one below, or sync the daycare app above.</td></tr>';
    return;
  }
  el.innerHTML = _finDaycare.map(function(e) {
    var actions = '<button class="btn-secondary" style="font-size:.72rem;padding:3px 8px;margin-right:4px;" onclick="finEditDaycare(' + e.id + ')">Edit</button>'
      + (e.source === 'daycare_api' ? '' : '<button class="btn-secondary" style="font-size:.72rem;padding:3px 8px;" onclick="finDeleteDaycare(' + e.id + ')">Delete</button>');
    return '<tr>'
      + '<td style="padding:5px 8px;">' + esc(e.period) + '</td>'
      + '<td style="padding:5px 8px;">' + esc(e.category) + '</td>'
      + '<td style="padding:5px 8px;">' + (e.entry_type === 'budget' ? 'Budget' : 'Actual') + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">$' + finFmtMoney(e.amount_cents / 100) + '</td>'
      + '<td style="padding:5px 8px;color:var(--warm-gray);font-size:.78rem;">' + (e.source === 'daycare_api' ? 'Daycare App' : esc(e.notes || '')) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + actions + '</td>'
      + '</tr>';
  }).join('');
}
// Add/Edit share one form + one submit handler. Editing a daycare_api-sourced row is allowed
// (the backend PUT doesn't restrict by source) — Delete stays manual-only above since a
// deleted synced row would just reappear on the next sync of that period, but an edited one
// only gets overwritten if that same period is re-synced again, which in practice mostly
// happens for the current/recent period, not old closed-out years.
var _finEditingDaycareId = null;
function finEditDaycare(id) {
  var e = _finDaycare.filter(function(x) { return x.id === id; })[0];
  if (!e) return;
  _finEditingDaycareId = id;
  document.getElementById('fin-dc-period').value = e.period;
  document.getElementById('fin-dc-category').value = e.category;
  document.getElementById('fin-dc-type').value = e.entry_type === 'budget' ? 'budget' : 'actual';
  document.getElementById('fin-dc-amount').value = (e.amount_cents / 100).toFixed(2);
  document.getElementById('fin-dc-notes').value = e.source === 'daycare_api' ? '' : (e.notes || '');
  document.getElementById('fin-dc-error').textContent = '';
  document.getElementById('fin-dc-submit-btn').textContent = 'Update Entry';
  document.getElementById('fin-dc-cancel-btn').style.display = '';
  document.getElementById('fin-dc-period').scrollIntoView({behavior:'smooth', block:'center'});
}
function finCancelEditDaycare() {
  _finEditingDaycareId = null;
  document.getElementById('fin-dc-period').value = '';
  document.getElementById('fin-dc-category').value = '';
  document.getElementById('fin-dc-amount').value = '';
  document.getElementById('fin-dc-notes').value = '';
  document.getElementById('fin-dc-error').textContent = '';
  document.getElementById('fin-dc-submit-btn').textContent = '+ Add Entry';
  document.getElementById('fin-dc-cancel-btn').style.display = 'none';
}
function finSaveDaycare() {
  var period = document.getElementById('fin-dc-period').value.trim();
  var category = document.getElementById('fin-dc-category').value.trim();
  var type = document.getElementById('fin-dc-type').value;
  var amount = parseFloat(document.getElementById('fin-dc-amount').value);
  var notes = document.getElementById('fin-dc-notes').value.trim();
  var errEl = document.getElementById('fin-dc-error');
  errEl.textContent = '';
  if (!/^\d{4}(-\d{2})?$/.test(period)) { errEl.textContent = 'Period must be YYYY or YYYY-MM.'; return; }
  if (!category) { errEl.textContent = 'Category is required.'; return; }
  if (!isFinite(amount)) { errEl.textContent = 'Enter a valid amount.'; return; }
  var body = { period: period, category: category, entry_type: type, amount_cents: Math.round(amount * 100), notes: notes };
  var editingId = _finEditingDaycareId;
  var req = editingId
    ? api('/admin/api/finance/daycare/' + editingId, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) })
    : api('/admin/api/finance/daycare', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
  req.then(function(d) {
    if (d && d.error) { errEl.textContent = d.error; return; }
    finCancelEditDaycare();
    return api('/admin/api/finance/daycare').then(function(d2) { _finDaycare = d2.entries || []; finRenderDaycare(); });
  }).catch(function(err) { errEl.textContent = err && err.message || 'Could not save entry.'; });
}
function finDeleteDaycare(id) {
  if (!confirm('Delete this entry?')) return;
  api('/admin/api/finance/daycare/' + id, { method: 'DELETE' }).then(function() {
    _finDaycare = _finDaycare.filter(function(e) { return e.id !== id; });
    finRenderDaycare();
  });
}

// ── Import Daycare (MDO) data from an already-imported Church Budget year ──
function finDaycareChurchBudgetPreview() {
  var year = document.getElementById('fin-dc-cb-year').value.trim();
  var out = document.getElementById('fin-dc-cb-preview');
  if (!/^\d{4}$/.test(year)) { out.innerHTML = '<div style="color:var(--danger);font-size:.78rem;">Enter a 4-digit year.</div>'; return; }
  out.innerHTML = '<div style="font-size:.78rem;color:var(--warm-gray);">Loading…</div>';
  api('/admin/api/finance/daycare/church-budget-preview?year=' + encodeURIComponent(year)).then(function(d) {
    if (d && d.error) { out.innerHTML = '<div style="color:var(--danger);font-size:.78rem;">' + esc(d.error) + '</div>'; return; }
    var entries = (d && d.entries) || [];
    if (!entries.length) {
      out.innerHTML = '<div style="font-size:.78rem;color:var(--warm-gray);">No MDO-tagged accounts found in the ' + esc(year) + ' Church Budget import. Make sure that year has been imported under Church Report first.</div>';
      return;
    }
    var byCategory = (d && d.by_category) || {};
    var catRows = Object.keys(byCategory).sort().map(function(cat) {
      var c = byCategory[cat];
      return '<tr><td style="padding:4px 8px;">' + esc(cat) + '</td>'
        + '<td style="padding:4px 8px;text-align:right;">' + finFmtMoney((c.actual_cents || 0) / 100) + '</td>'
        + '<td style="padding:4px 8px;text-align:right;">' + finFmtMoney((c.budget_cents || 0) / 100) + '</td></tr>';
    }).join('');
    var lineRows = entries.map(function(e) {
      return '<tr><td style="padding:3px 8px;">' + esc(e.category) + '</td>'
        + '<td style="padding:3px 8px;">' + esc(e.entry_type) + '</td>'
        + '<td style="padding:3px 8px;text-align:right;">' + finFmtMoney((e.amount_cents || 0) / 100) + '</td>'
        + '<td style="padding:3px 8px;color:var(--warm-gray);">' + esc(e.notes || '') + '</td></tr>';
    }).join('');
    out.innerHTML = ''
      + '<table style="width:100%;border-collapse:collapse;font-size:.82rem;margin-bottom:8px;">'
      + '<thead><tr style="border-bottom:2px solid var(--navy);"><th style="text-align:left;padding:4px 8px;">Category</th><th style="text-align:right;padding:4px 8px;">Actual</th><th style="text-align:right;padding:4px 8px;">Budget</th></tr></thead>'
      + '<tbody>' + catRows + '</tbody></table>'
      + '<details style="margin-bottom:10px;"><summary style="font-size:.75rem;color:var(--warm-gray);cursor:pointer;">Show ' + entries.length + ' individual line items</summary>'
      + '<div style="overflow-x:auto;margin-top:6px;"><table style="width:100%;border-collapse:collapse;font-size:.78rem;">'
      + '<thead><tr style="border-bottom:1px solid var(--border);"><th style="text-align:left;padding:3px 8px;">Category</th><th style="text-align:left;padding:3px 8px;">Type</th><th style="text-align:right;padding:3px 8px;">Amount</th><th style="text-align:left;padding:3px 8px;">Notes</th></tr></thead>'
      + '<tbody>' + lineRows + '</tbody></table></div></details>'
      + '<button class="btn-primary" onclick="finDaycareChurchBudgetImport(\'' + esc(year) + '\')">Import These ' + entries.length + ' Line Items</button>'
      + ' <span style="font-size:.72rem;color:var(--warm-gray);">Re-importing the same year replaces its previously imported church-budget rows — it will not duplicate them.</span>';
  }).catch(function(err) {
    out.innerHTML = '<div style="color:var(--danger);font-size:.78rem;">' + esc(err && err.message || 'Could not load preview.') + '</div>';
  });
}
function finDaycareChurchBudgetImport(year) {
  api('/admin/api/finance/daycare/church-budget-import', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ year: year })
  }).then(function(d) {
    if (d && d.error) { finToast(d.error); return; }
    finToast('Imported ' + (d && d.imported || 0) + ' daycare line item(s) from the ' + year + ' Church Budget.');
    finRefreshImportStatus();
    document.getElementById('fin-dc-cb-preview').innerHTML = '';
    return api('/admin/api/finance/daycare').then(function(d2) {
      _finDaycare = d2.entries || [];
      finRenderDaycare();
      finRenderDaycareReport();
      finLoadHealth();
    });
  }).catch(function(err) { finToast(err && err.message || 'Import failed.'); });
}

// ── Bulk-enter past years (paste-in, since the daycare app has no historical API — FIN3) ────
var _finDcBulkRows = null;
function finDaycareParseBulkText(text) {
  return text.split('\n').map(function(line) { return line.trim(); }).filter(Boolean).map(function(line) {
    var parts = line.split(',').map(function(p) { return p.trim(); });
    return { period: parts[0] || '', category: parts[1] || '', entry_type: (parts[2] || 'actual').toLowerCase(), amount: parts[3] || '', notes: parts[4] || '' };
  });
}
function finDaycareBulkPreview() {
  var text = document.getElementById('fin-dc-bulk-text').value;
  var errEl = document.getElementById('fin-dc-bulk-error');
  var out = document.getElementById('fin-dc-bulk-preview');
  errEl.textContent = '';
  var rows = finDaycareParseBulkText(text);
  if (!rows.length) { errEl.textContent = 'Paste at least one row.'; out.innerHTML = ''; return; }
  var bad = [];
  rows.forEach(function(r, i) {
    if (!/^\d{4}(-\d{2})?$/.test(r.period)) bad.push('Row ' + (i+1) + ': period must be YYYY or YYYY-MM');
    else if (!r.category) bad.push('Row ' + (i+1) + ': category is required');
    else if (!isFinite(parseFloat(r.amount))) bad.push('Row ' + (i+1) + ': invalid amount');
    else if (r.entry_type !== 'actual' && r.entry_type !== 'budget') bad.push('Row ' + (i+1) + ': type must be actual or budget');
  });
  if (bad.length) { errEl.innerHTML = bad.map(esc).join('<br>'); out.innerHTML = ''; return; }
  _finDcBulkRows = rows;
  var rowsHtml = rows.map(function(r) {
    return '<tr><td style="padding:3px 8px;">' + esc(r.period) + '</td><td style="padding:3px 8px;">' + esc(r.category) + '</td><td style="padding:3px 8px;">' + esc(r.entry_type) + '</td><td style="padding:3px 8px;text-align:right;">$' + finFmtMoney(parseFloat(r.amount)) + '</td><td style="padding:3px 8px;color:var(--warm-gray);">' + esc(r.notes) + '</td></tr>';
  }).join('');
  out.innerHTML = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.78rem;">'
    + '<thead><tr style="border-bottom:1px solid var(--border);"><th style="text-align:left;padding:3px 8px;">Period</th><th style="text-align:left;padding:3px 8px;">Category</th><th style="text-align:left;padding:3px 8px;">Type</th><th style="text-align:right;padding:3px 8px;">Amount</th><th style="text-align:left;padding:3px 8px;">Notes</th></tr></thead>'
    + '<tbody>' + rowsHtml + '</tbody></table></div>'
    + '<button class="btn-primary" style="margin-top:8px;" onclick="finDaycareBulkImport()">Import These ' + rows.length + ' Rows</button>';
}
function finDaycareBulkImport() {
  if (!_finDcBulkRows || !_finDcBulkRows.length) return;
  var body = { rows: _finDcBulkRows.map(function(r) {
    return { period: r.period, category: r.category, entry_type: r.entry_type, amount_cents: Math.round(parseFloat(r.amount) * 100), notes: r.notes };
  }) };
  api('/admin/api/finance/daycare/bulk', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }).then(function(d) {
    if (d && d.error) { finToast(d.error); return; }
    finToast('Imported ' + (d && d.imported || 0) + ' row(s).');
    finRefreshImportStatus();
    document.getElementById('fin-dc-bulk-text').value = '';
    document.getElementById('fin-dc-bulk-preview').innerHTML = '';
    _finDcBulkRows = null;
    return api('/admin/api/finance/daycare').then(function(d2) { _finDaycare = d2.entries || []; finRenderDaycare(); });
  }).catch(function(err) { finToast(err && err.message || 'Import failed.'); });
}

// ── MDO utility cost-share note (from the 3277 Ivanhoe data export's church_building_shared_
// costs section — NOT about the rental property itself, so it's surfaced here instead of in
// Commercial Property; see CLAUDE.md queued items). Populated once property data loads. ──────
function finRenderDaycareMdoNote() {
  var el = document.getElementById('fin-daycare-mdo-note');
  if (!el) return;
  var shared = _finProperty && _finProperty.meta && _finProperty.meta.church_building_shared_costs;
  var mdo = shared && shared.mdo_utility_allocation;
  if (!mdo) { el.innerHTML = ''; return; }
  el.innerHTML = '<div style="background:var(--linen);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:.8rem;">'
    + '<b>MDO Utility Cost Share (estimate): ' + ((mdo.estimated_mdo_share_pct||0)*100).toFixed(0) + '%</b>'
    + '<p style="margin:6px 0 0;color:var(--warm-gray);">' + esc(mdo.basis_given_by_andrew || '') + ' ' + esc(mdo.estimate_note || '') + '</p>'
    + '</div>';
}

// ── Daycare Report (board-level, year by year) ─────────────────────────
// Groups the flat period×category×type rows (the same ones behind the Overview
// sync table) into calendar-year totals per category, plus Income/Expense/Net
// summary rows. Computed client-side from _finDaycare — no new endpoint needed,
// since the full row set is already fetched for the Overview tab.
var FIN_KNOWN_CATEGORY_ORDER = ['Tuition Income', 'Payroll', 'Payroll Taxes', 'Workers Comp', 'Other Payroll Expenses', 'Utilities', 'Insurance', 'Other Expenses'];
function finIsIncomeCategory(cat) {
  return String(cat || '').trim().toLowerCase() === 'tuition income';
}
// allocationByYear (optional) = the response from GET /admin/api/finance/daycare/allocation —
// { [year]: { mdoUtilityCents, mdoInsuranceCents, ... } }. MDO has no Utilities/Insurance
// accounts of its own (it shares the building with the church), so per the user's explicit
// choice these two lines are a live percentage of the CHURCH side's actual Utilities/Insurance
// expense — recalculated every render, never a stored figure — merged in as ordinary expense
// categories (Budget column stays $0 for these two: the allocation is actual-only, matching what
// was asked for). Omit allocationByYear (or pass a year with no matching key) and these two rows
// simply don't appear for that year, same as any other category with no data.
// Per the user's explicit decision — "there should really only be one source, the church import
// is fine" — the Report only ever sums entries from the church's own Budget import
// (source='church_budget_import'), plus whatever's been directly edited via a Budget-cell
// override (source='manual_budget_override', see below). The older daycare-app sync
// (source='daycare_api') and one-off single-entry-form rows (source='manual') are deliberately
// EXCLUDED from every total here — not deleted, just not counted — so two sources can never
// silently double-count the same figure. finDaycareOtherSourceTotals() (below) tells the caller
// how much of that excluded data still exists, so it can be surfaced rather than hidden.
var FIN_DAYCARE_COUNTED_SOURCES = { church_budget_import: true, manual_budget_override: true };
function finDaycareOtherSourceTotals(entries) {
  var byYear = {};
  (entries || []).forEach(function(e) {
    var year = String(e.period || '').slice(0, 4);
    if (!/^\d{4}$/.test(year) || FIN_DAYCARE_COUNTED_SOURCES[e.source]) return;
    byYear[year] = (byYear[year] || 0) + (Number(e.amount_cents) || 0);
  });
  return byYear;
}
function finAggregateDaycareByYear(entries, allocationByYear) {
  var years = [];
  var categoriesSeen = [];
  var byYear = {};
  // source='manual_budget_override' rows are held back from the normal sum below and applied
  // afterward as a REPLACEMENT (not an addition) for that exact (year, category)'s budget — see
  // the endpoint's comment in api-finance.js. Actual is never overridden this way: per the user's
  // explicit correction, Actual always comes from the church's own budget import.
  var overrides = {};
  (entries || []).forEach(function(e) {
    if (!FIN_DAYCARE_COUNTED_SOURCES[e.source]) return;
    var year = String(e.period || '').slice(0, 4);
    if (!/^\d{4}$/.test(year)) return;
    if (years.indexOf(year) === -1) years.push(year);
    if (!byYear[year]) byYear[year] = { categories: {}, incomeActual: 0, incomeBudget: 0, expenseActual: 0, expenseBudget: 0 };
    var cat = e.category || 'Uncategorized';
    if (categoriesSeen.indexOf(cat) === -1) categoriesSeen.push(cat);
    if (!byYear[year].categories[cat]) byYear[year].categories[cat] = { actual: 0, budget: 0 };
    var amt = (Number(e.amount_cents) || 0) / 100;
    var isIncome = finIsIncomeCategory(cat);
    var isBudget = e.entry_type === 'budget';
    if (isBudget && e.source === 'manual_budget_override') {
      if (!overrides[year]) overrides[year] = {};
      overrides[year][cat] = amt;
      return;
    }
    byYear[year].categories[cat][isBudget ? 'budget' : 'actual'] += amt;
    if (isIncome) byYear[year][isBudget ? 'incomeBudget' : 'incomeActual'] += amt;
    else byYear[year][isBudget ? 'expenseBudget' : 'expenseActual'] += amt;
  });
  Object.keys(overrides).forEach(function(year) {
    if (!byYear[year]) return;
    Object.keys(overrides[year]).forEach(function(cat) {
      if (!byYear[year].categories[cat]) byYear[year].categories[cat] = { actual: 0, budget: 0 };
      var prevBudget = byYear[year].categories[cat].budget;
      var nextBudget = overrides[year][cat];
      byYear[year].categories[cat].budget = nextBudget;
      var delta = nextBudget - prevBudget;
      if (finIsIncomeCategory(cat)) byYear[year].incomeBudget += delta;
      else byYear[year].expenseBudget += delta;
    });
  });
  years.sort();
  years.forEach(function(y) {
    var b = byYear[y];
    var alloc = allocationByYear && allocationByYear[y];
    if (alloc) {
      var utilDollars = (alloc.mdoUtilityCents || 0) / 100, insDollars = (alloc.mdoInsuranceCents || 0) / 100;
      if (categoriesSeen.indexOf('Utilities') === -1) categoriesSeen.push('Utilities');
      if (categoriesSeen.indexOf('Insurance') === -1) categoriesSeen.push('Insurance');
      b.categories['Utilities'] = { actual: utilDollars, budget: (b.categories['Utilities'] || {}).budget || 0 };
      b.categories['Insurance'] = { actual: insDollars, budget: (b.categories['Insurance'] || {}).budget || 0 };
      b.expenseActual += utilDollars + insDollars;
    }
    b.netActual = b.incomeActual - b.expenseActual;
    b.netBudget = b.incomeBudget - b.expenseBudget;
  });
  var categories = FIN_KNOWN_CATEGORY_ORDER.filter(function(c) { return categoriesSeen.indexOf(c) !== -1; })
    .concat(categoriesSeen.filter(function(c) { return FIN_KNOWN_CATEGORY_ORDER.indexOf(c) === -1; }).sort());
  return { years: years, categories: categories, byYear: byYear };
}
// ── MDO Utilities/Insurance cost-share (live % of church actual — see the user's explicit
// request: "put in a utility and insurance line that you calculate from my percentage from
// actual expenses from church side"). Fetched once per page visit for whatever years the
// Daycare Report currently shows, then cached — finRenderDaycareReport() re-renders once it
// resolves. Re-fetched (via finDaycareAllocationConfigSave) whenever the percentage is changed.
var _finDaycareAllocation = null; // { years, utilityPct, insurancePct, allocation: {year: {...}} }
var _finDaycareAllocationLoading = false;
function finLoadDaycareAllocation(years) {
  if (!years.length || _finDaycareAllocationLoading) return;
  _finDaycareAllocationLoading = true;
  api('/admin/api/finance/daycare/allocation?years=' + years.join(',')).then(function(d) {
    _finDaycareAllocation = d;
    _finDaycareAllocationLoading = false;
    finRenderDaycareReport();
    // The allocation percentages are edited on the Data & Imports tab now, so that card has to
    // pick up the new figures too — otherwise saving a percentage leaves the control showing the
    // old one until a full reload.
    var importsCard = document.getElementById('fin-imports-card');
    if (importsCard) importsCard.innerHTML = finRenderImportsCard();
    finLoadHealth();
  }).catch(function() { _finDaycareAllocationLoading = false; });
}
function finDaycareAllocationConfigSave() {
  var uEl = document.getElementById('fin-dc-alloc-util-pct');
  var iEl = document.getElementById('fin-dc-alloc-ins-pct');
  var msgEl = document.getElementById('fin-dc-alloc-msg');
  var utilityPct = parseFloat(uEl.value) / 100, insurancePct = parseFloat(iEl.value) / 100;
  if (!isFinite(utilityPct) || !isFinite(insurancePct)) { if (msgEl) msgEl.textContent = 'Enter valid percentages.'; return; }
  if (msgEl) msgEl.textContent = 'Saving…';
  api('/admin/api/finance/daycare/allocation-config', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ utilityPct: utilityPct, insurancePct: insurancePct }) }).then(function(d) {
    if (d && d.error) { if (msgEl) msgEl.textContent = d.error; return; }
    if (msgEl) msgEl.textContent = 'Saved.';
    _finDaycareAllocation = null; // force a fresh fetch at the new percentage
    var years = (_finDaycareAgg && _finDaycareAgg.years) || [];
    finLoadDaycareAllocation(years);
  }).catch(function(err) { if (msgEl) msgEl.textContent = err && err.message || 'Save failed.'; });
}
function finRenderDaycareAllocationConfig() {
  var pct = _finDaycareAllocation ? _finDaycareAllocation.utilityPct : 0.5;
  var ipct = _finDaycareAllocation ? _finDaycareAllocation.insurancePct : 0.5;
  var isAdminUI = (_userRole === 'admin');
  return '<div style="background:var(--warm-surface-page);border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:.78rem;color:var(--warm-ink-label);">'
    + '<b>MDO Utilities/Insurance cost-share:</b> Utilities and Insurance below are ' + (pct*100).toFixed(0) + '%/' + (ipct*100).toFixed(0) + '% of the church side\'s actual Utilities/Insurance expense for that year — recalculated live, not stored.'
    + (isAdminUI ? '<div style="margin-top:6px;display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">'
      + '<label>Utilities %<br><input type="number" id="fin-dc-alloc-util-pct" step="1" value="' + (pct*100).toFixed(0) + '" style="width:70px;"></label>'
      + '<label>Insurance %<br><input type="number" id="fin-dc-alloc-ins-pct" step="1" value="' + (ipct*100).toFixed(0) + '" style="width:70px;"></label>'
      + '<button class="btn-secondary" style="font-size:.75rem;padding:3px 10px;" onclick="finDaycareAllocationConfigSave()">Save %</button>'
      + '<span id="fin-dc-alloc-msg" style="font-size:.72rem;color:var(--warm-gray);"></span>'
      + '</div>' : '')
    + '</div>';
}
// ── Directly-editable Budget cells in the Daycare Report table itself ─────────────────────
// Per the user's correction: Actual always comes from the church's own Budget import ("Import
// from Church Budget (MDO accounts)" in Overview → Daycare Sync) — never hand-typed here. Only
// Budget is directly editable, cell by cell, right in the table (a past year's real budget
// often isn't sitting in an imported church file). Click a Budget cell to turn it into an input;
// Enter or blur saves via POST finance/daycare/budget-override, which replaces (not adds to)
// any prior override for that exact (year, category) — see that endpoint's comment.
function finDaycareBudgetCellEdit(year, cat, cellEl) {
  if (cellEl.querySelector('input')) return; // already editing
  var current = cellEl.getAttribute('data-raw') || '';
  cellEl.innerHTML = '<input type="number" step="0.01" class="fin-editable-input" value="' + esc(current) + '" style="width:90px;text-align:right;" onblur="finDaycareBudgetCellSave(' + year + ',' + jsAttr(cat) + ',this)" onkeydown="if(event.key===\'Enter\')this.blur();">';
  var input = cellEl.querySelector('input');
  input.focus();
  input.select();
}
function finDaycareBudgetCellSave(year, cat, inputEl) {
  var value = inputEl.value;
  var body = { year: year, category: cat, budget: value };
  api('/admin/api/finance/daycare/budget-override', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) }).then(function(d) {
    if (d && d.error) { finToast(d.error); return; }
    finToast('Saved ' + cat + ' FY' + year + ' budget.');
    return finLoadFinanceDaycareEntries();
  }).catch(function(err) { finToast(err && err.message || 'Save failed.'); });
}
// Re-fetches just the daycare entries list (used after a budget-cell edit) and re-renders every
// view that depends on it, without re-fetching the rest of the Finance tab's data.
function finLoadFinanceDaycareEntries() {
  return api('/admin/api/finance/daycare').then(function(d) {
    _finDaycare = (d && d.entries) || [];
    finRenderDaycareStatus();
    finRenderDaycareReport();
    finLoadHealth();
  });
}
// A visible warning (not a silent drop) when daycare-app-sync or one-off manual rows exist for a
// year but aren't counted in the table above — per the user's decision to count only the church
// Budget import (plus direct Budget-cell overrides) as the single source of truth.
function finRenderDaycareOtherSourceWarning() {
  var otherByYear = finDaycareOtherSourceTotals(_finDaycare);
  var years = Object.keys(otherByYear).filter(function(y) { return otherByYear[y] !== 0; }).sort();
  if (!years.length) return '';
  var parts = years.map(function(y) { return 'FY' + y + ' ($' + finFmtMoney(otherByYear[y]/100) + ')'; }).join(', ');
  return '<div style="background:var(--chip-warn-bg,#FBF0DA);border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:.78rem;color:var(--deep-amber);">'
    + '<b>Heads up:</b> there\'s daycare-app-sync or manually-entered data (not from the church Budget import) sitting unused for ' + parts + '. It\'s not included in any total above, per your decision to use only the church import as the source of truth — flagging so it\'s not silently invisible. See Overview → Daycare Sync → "Show all synced line items" to review or remove it.'
    + '</div>';
}
// ── Daycare Report ──────────────────────────────────────────────────────────────────────────
// The board receives MDO; it does not manage it. Two questions only: is it self-sufficient, and
// is it full. The honest answer to the second is per-room — utilization varies widely by room and
// the waitlist sits on the youngest ones while the oldest have open seats — so the ask is staff
// to open the rooms families want, not more building. That framing depends on room-level data the
// daycare app does not expose yet (see DAYCARE_API.md); until it does, this page degrades to the
// category-by-year table rather than asserting a blanket "we are full."
var _finDaycareRooms = null;
var _finDaycareRoomsAvailable = false;
function finLoadDaycareRooms() {
  api('/admin/api/finance/daycare/rooms').then(function(d) {
    _finDaycareRooms = d;
    _finDaycareRoomsAvailable = !!(d && d.available);
    finRenderDaycareReport();
    finLoadHealth();
  }).catch(function() {
    _finDaycareRoomsAvailable = false;
  });
}
function finRenderDaycareHeader() {
  var el = document.getElementById('fin-daycare-header');
  if (!el) return;
  var period = _finDaycareRooms && _finDaycareRooms.period ? _finDaycareRooms.period : '';
  var when = period
    ? MONTH_NAMES[parseInt(period.slice(5, 7), 10) - 1] + ' ' + period.slice(0, 4) + ' &middot; synced from the daycare app'
    : 'Year by year, from the church budget import';
  el.innerHTML = finPageHeader('Daycare (MDO)', when + ' &middot; the board receives this, it does not manage it',
    '<button class="btn-secondary" onclick="finExportDaycareCsv()">Export CSV</button>'
    + '<button class="btn-secondary" onclick="window.print()">Print</button>');
}
// The one ratio to watch: wages as a share of what was billed. A church board cannot manage MDO,
// but it can read one number and ask about it.
function finRenderDaycareRatioStrip(agg) {
  var yKey = String(new Date().getFullYear());
  var y = agg.byYear[yKey];
  var rooms = _finDaycareRoomsAvailable ? _finDaycareRooms.rooms : null;
  var billedCents, wagesCents, scopeLabel;
  if (rooms) {
    billedCents = rooms.reduce(function(s, r) { return s + (r.billed_cents || 0); }, 0);
    wagesCents = rooms.reduce(function(s, r) { return s + (r.labor_cost_cents || 0); }, 0);
    scopeLabel = 'this month';
  } else if (y) {
    billedCents = Math.round(y.incomeActual * 100);
    var payroll = ['Payroll', 'Payroll Taxes', 'Workers Comp', 'Other Payroll Expenses'].reduce(function(s, c) {
      return s + ((y.categories[c] || { actual: 0 }).actual * 100);
    }, 0);
    wagesCents = Math.round(payroll);
    scopeLabel = 'FY' + yKey + ' to date';
  } else {
    return '';
  }
  var ratio = billedCents ? wagesCents / billedCents : null;
  // Prior-year comparison, so the ratio reads as a trend rather than a bare percentage.
  var priorKey = String(Number(yKey) - 1);
  var prior = agg.byYear[priorKey];
  var priorRatio = null;
  if (prior && prior.incomeActual) {
    var priorPayroll = ['Payroll', 'Payroll Taxes', 'Workers Comp', 'Other Payroll Expenses'].reduce(function(s, c) {
      return s + ((prior.categories[c] || { actual: 0 }).actual);
    }, 0);
    priorRatio = priorPayroll / prior.incomeActual;
  }
  var marginCents = billedCents - wagesCents;
  var netCents = y ? Math.round(y.netActual * 100) : null;
  function cell(label, value, color, sub) {
    return '<div><div class="fin-navy-sublabel">' + label + '</div>'
      + '<div style="font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;' + (color ? 'color:' + color + ';' : '') + '">' + value + '</div>'
      + (sub ? '<div style="font-size:11.5px;color:rgba(255,255,255,.7);">' + sub + '</div>' : '') + '</div>';
  }
  return '<div class="fin-navy-card fin-ratio-strip">'
    + '<div><div class="fin-navy-label">The one ratio to watch</div>'
    + '<div style="font-size:36px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.05;color:var(--pale-gold);">' + finPctLabel(ratio) + '</div>'
    + '<div style="font-size:12.5px;color:rgba(255,255,255,.75);margin-top:2px;">of every tuition dollar goes to wages'
    + (priorRatio != null ? ' — ' + finPctLabel(priorRatio) + ' in ' + priorKey : '') + '</div></div>'
    + '<div class="fin-ratio-divider"></div>'
    + cell('Billed ' + scopeLabel, finMoney0(billedCents), '', '')
    + cell('Wages ' + scopeLabel, finMoney0(wagesCents), '', '')
    + cell('Margin after wages', finFmtSigned(marginCents), marginCents >= 0 ? 'var(--positive-on-navy)' : 'var(--negative-on-navy)',
        netCents != null ? 'FY net after allocated overhead ' + finFmtSigned(netCents) : '')
    + '</div>';
}
function finRenderDaycareRooms() {
  var d = _finDaycareRooms;
  if (!_finDaycareRoomsAvailable || !d || !d.rooms.length) return '';
  var occ = d.occupancy || {};
  var rooms = d.rooms.slice().sort(function(a, b) {
    var ap = (a.capacity_per_day ? a.avg_daily_enrolled / a.capacity_per_day : 0);
    var bp = (b.capacity_per_day ? b.avg_daily_enrolled / b.capacity_per_day : 0);
    return bp - ap;
  });
  var rows = rooms.map(function(r) {
    var pct = r.capacity_per_day ? r.avg_daily_enrolled / r.capacity_per_day : null;
    var color = pct == null ? 'var(--warm-gray)' : pct >= 0.85 ? 'var(--danger)' : pct >= 0.65 ? 'var(--color-gold)' : 'var(--sage)';
    var waitChip = r.waitlist_families
      ? '<span class="fin-chip ' + (r.waitlist_families >= 10 ? 'fin-chip-negative' : 'fin-chip-warn') + '" style="font-size:11px;">' + r.waitlist_families + ' waiting</span>'
      : '';
    return '<div class="fin-room-row">'
      + '<div class="fin-room-row-hdr">'
      + '<span>' + esc(r.room_name) + ' <span style="font-weight:400;color:var(--warm-gray);">cap ' + (r.capacity_per_day || 0) + '/day' + (r.seasonal ? ', seasonal' : '') + '</span></span>'
      + '<span style="display:flex;align-items:center;gap:8px;">' + waitChip + '<span>' + finPctLabel(pct) + '</span></span>'
      + '</div>'
      + '<div style="height:11px;border-radius:6px;background:var(--linen);margin-top:5px;"><div style="width:' + Math.min(100, (pct || 0) * 100).toFixed(1) + '%;height:100%;border-radius:6px;background:' + color + ';"></div></div>'
      + '</div>';
  }).join('');
  var seasonalNote = occ.seasonalRooms && occ.seasonalRooms.length
    ? ' (year-round rooms; ' + occ.seasonalRooms.map(esc).join(', ') + ' ' + (occ.seasonalRooms.length === 1 ? 'is' : 'are') + ' seasonal and counted separately)'
    : '';
  var occCard = '<div class="fin-card">'
    + '<div class="fin-card-title" style="font-size:20px;">Occupancy by room</div>'
    + '<div class="fin-card-sub">Average daily enrolled against licensed capacity. The badge is families waiting on that room.</div>'
    + '<div style="display:flex;flex-direction:column;gap:13px;">' + rows + '</div>'
    + '<div class="fin-note-box" style="margin-top:16px;"><b>' + occ.filledSeats + ' of ' + occ.totalSeats + ' daily seats filled — ' + finPctLabel(occ.overallPct) + ' overall</b>' + seasonalNote + '. '
    + (occ.waitingFamilies
      ? occ.waitingFamilies + ' famil' + (occ.waitingFamilies === 1 ? 'y is' : 'ies are') + ' waiting'
        + (occ.openSeatsUnderfilled ? ', while the under-filled rooms have ' + occ.openSeatsUnderfilled + ' open seats a day. Demand is real but age-specific.' : '.')
      : 'No families are on a waiting list.')
    + '</div></div>';

  var totalBilled = 0, totalWages = 0;
  var marginRows = rooms.slice().sort(function(a, b) {
    return ((b.billed_cents || 0) - (b.labor_cost_cents || 0)) - ((a.billed_cents || 0) - (a.labor_cost_cents || 0));
  }).map(function(r) {
    var billed = r.billed_cents || 0, wages = r.labor_cost_cents || 0;
    totalBilled += billed; totalWages += wages;
    var margin = billed - wages;
    var pct = billed ? margin / billed : null;
    var color = pct == null ? 'var(--warm-gray)' : pct < 0.20 ? 'var(--deep-amber)' : 'var(--sage-text)';
    return '<div style="padding:9px 0;border-top:1px solid var(--warm-row-divider);font-weight:700;">' + esc(r.room_name) + '</div>'
      + '<div class="fin-room-num">' + finMoney0(billed) + '</div>'
      + '<div class="fin-room-num">' + finMoney0(wages) + '</div>'
      + '<div class="fin-room-num" style="color:' + color + ';font-weight:700;">' + finFmtSigned(margin) + '</div>'
      + '<div class="fin-room-num" style="color:' + color + ';font-weight:700;">' + finPctLabel(pct) + '</div>';
  }).join('');
  var totalMargin = totalBilled - totalWages;
  var weakest = rooms.slice().sort(function(a, b) {
    var ap = (a.billed_cents ? (a.billed_cents - (a.labor_cost_cents || 0)) / a.billed_cents : 1);
    var bp = (b.billed_cents ? (b.billed_cents - (b.labor_cost_cents || 0)) / b.billed_cents : 1);
    return ap - bp;
  })[0];
  var weakestPct = weakest && weakest.billed_cents ? (weakest.billed_cents - (weakest.labor_cost_cents || 0)) / weakest.billed_cents : null;
  var marginCard = '<div class="fin-card">'
    + '<div class="fin-card-title" style="font-size:20px;">Billed vs. wages by room</div>'
    + '<div class="fin-card-sub">This month. Wages are the daycare app&rsquo;s labor cost for that room, salaried staff prorated.</div>'
    + '<div class="fin-room-grid">'
    + '<div class="fin-th">Room</div><div class="fin-th" style="text-align:right;">Billed</div><div class="fin-th" style="text-align:right;">Wages</div><div class="fin-th" style="text-align:right;">Margin</div><div class="fin-th" style="text-align:right;">%</div>'
    + marginRows
    + '<div class="fin-room-total">Total</div>'
    + '<div class="fin-room-num fin-room-total">' + finMoney0(totalBilled) + '</div>'
    + '<div class="fin-room-num fin-room-total">' + finMoney0(totalWages) + '</div>'
    + '<div class="fin-room-num fin-room-total">' + finFmtSigned(totalMargin) + '</div>'
    + '<div class="fin-room-num fin-room-total">' + finPctLabel(totalBilled ? totalMargin / totalBilled : null) + '</div>'
    + '</div>'
    + (weakest && weakestPct != null
      ? '<div class="fin-note-box" style="margin-top:14px;">' + finMoney0(totalMargin) + ' of room margin is what covers MDO&rsquo;s allocated utilities, insurance and admin. <b>' + esc(weakest.room_name) + ' at ' + finPctLabel(weakestPct) + ' is the room to ask about.</b></div>'
      : '')
    + '</div>';

  var closing = '<div class="fin-grid-2">'
    + '<div class="fin-navy-card">'
      + '<div class="fin-navy-label">What the board does with this</div>'
      + '<div style="font-family:var(--font-display);font-size:22px;font-weight:700;line-height:1.2;margin:2px 0 10px;">Nothing to manage — two things to ask.</div>'
      + '<div style="font-size:13px;color:rgba(255,255,255,.8);line-height:1.6;">'
      + '1 &middot; Can the full rooms grow if we fund staff, given ' + occ.waitingFamilies + ' waiting famil' + (occ.waitingFamilies === 1 ? 'y' : 'ies') + '?<br>'
      + '2 &middot; What is the plan for ' + (weakest ? esc(weakest.room_name) + ' at ' + finPctLabel(weakestPct) + ' margin' : 'the weakest room') + '?</div>'
    + '</div>'
    + '<div class="fin-card" style="border:1px solid var(--warm-border);box-shadow:none;">'
      + '<div class="fin-eyebrow">What this needs from the daycare app</div>'
      + '<div style="font-size:13px;color:var(--warm-ink-label);line-height:1.6;margin-top:6px;">One monthly endpoint, four fields per room: <b>capacity/day</b>, <b>average daily enrolled</b>, <b>billed revenue</b>, <b>labor cost</b> — plus a waitlist count per room. Everything on this page derives from those. No rosters, schedules or clock records cross the boundary.</div>'
    + '</div></div>';

  return '<div class="fin-grid-2 fin-grid-start">' + occCard + marginCard + '</div>' + closing;
}
function finRenderDaycareReport() {
  var el = document.getElementById('fin-daycare-report');
  if (!el) return;
  finRenderDaycareHeader();
  var allocationByYear = _finDaycareAllocation ? _finDaycareAllocation.allocation : null;
  var agg = finAggregateDaycareByYear(_finDaycare, allocationByYear);
  _finDaycareAgg = agg;
  var otherSourceWarning = finRenderDaycareOtherSourceWarning();
  if (!agg.years.length && !_finDaycareRoomsAvailable) {
    el.innerHTML = otherSourceWarning + '<div class="fin-card"><p style="font-size:.85rem;color:var(--warm-gray);margin:0;">No daycare data yet. Use "MDO accounts from an imported church budget" on the <b>Data &amp; Imports</b> tab.</p></div>';
    return;
  }
  if (!_finDaycareAllocation && !_finDaycareAllocationLoading && agg.years.length) finLoadDaycareAllocation(agg.years);
  var isAdminUI = (_userRole === 'admin');

  function moneyCell(v, muted) {
    return '<td style="text-align:right;padding:5px 8px;' + (muted ? 'color:var(--warm-gray);' : '') + '">$' + finFmtMoney(v) + '</td>';
  }
  // Budget stays directly editable for every category except the two live-derived ones
  // (Utilities/Insurance), which are always recomputed from the church side.
  function budgetCell(year, cat, v, editable) {
    if (!editable) return moneyCell(v, true);
    return '<td style="text-align:right;padding:5px 8px;color:var(--warm-gray);cursor:pointer;" data-raw="' + (v || '') + '" title="Click to edit" onclick="finDaycareBudgetCellEdit(' + year + ',' + jsAttr(cat) + ',this)">$' + finFmtMoney(v) + '</td>';
  }
  var yearHead1 = '<th></th>' + agg.years.map(function(y) {
    return '<th colspan="2" style="text-align:center;padding:6px 8px;border-bottom:1px solid var(--border);">' + esc(y) + '</th>';
  }).join('');
  var yearHead2 = '<th style="text-align:left;padding:6px 8px;">Category</th>' + agg.years.map(function() {
    return '<th style="text-align:right;padding:4px 8px;font-size:.72rem;color:var(--warm-gray);font-weight:600;">Actual</th>'
      + '<th style="text-align:right;padding:4px 8px;font-size:.72rem;color:var(--warm-gray);font-weight:600;">Budget</th>';
  }).join('');
  var catRows = agg.categories.map(function(cat) {
    var isDerived = cat === 'Utilities' || cat === 'Insurance';
    var cells = agg.years.map(function(y) {
      var c = agg.byYear[y].categories[cat] || { actual: 0, budget: 0 };
      return moneyCell(c.actual) + budgetCell(y, cat, c.budget, isAdminUI && !isDerived);
    }).join('');
    return '<tr><td style="padding:5px 8px;">' + esc(cat) + (isDerived ? ' <span style="font-size:.68rem;color:var(--warm-gray);" title="Live % of church actual">(derived)</span>' : '') + '</td>' + cells + '</tr>';
  }).join('');
  function summaryRow(label, actualKey, budgetKey, bold) {
    var cells = agg.years.map(function(y) {
      var b = agg.byYear[y];
      return moneyCell(b[actualKey]) + moneyCell(b[budgetKey], true);
    }).join('');
    return '<tr' + (bold ? ' style="font-weight:700;border-top:2px solid var(--navy);"' : ' style="font-weight:600;border-top:1px solid var(--border);"') + '>'
      + '<td style="padding:5px 8px;">' + label + '</td>' + cells + '</tr>';
  }
  var yearTable = agg.years.length
    ? '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
      + '<thead><tr>' + yearHead1 + '</tr><tr style="border-bottom:2px solid var(--navy);">' + yearHead2 + '</tr></thead>'
      + '<tbody>' + catRows
      + summaryRow('Total Income', 'incomeActual', 'incomeBudget', false)
      + summaryRow('Total Expenses', 'expenseActual', 'expenseBudget', false)
      + summaryRow('Net Income', 'netActual', 'netBudget', true)
      + '</tbody></table></div>'
    : '<p style="font-size:.85rem;color:var(--warm-gray);">No year-by-year figures imported yet.</p>';

  // Room-level cards when the daycare app can supply them; otherwise the category table leads and
  // says plainly what is missing, rather than the page erroring or quietly showing less.
  var roomsHtml = finRenderDaycareRooms();
  var degradedNote = _finDaycareRoomsAvailable ? '' :
    '<div class="fin-note-box" style="margin-bottom:16px;">Room-level occupancy and per-room margin are not shown: the daycare app does not yet publish the monthly per-room figures this needs (capacity, average daily enrolled, billed revenue, labor cost, waitlist). Until it does, the year-by-year figures below are what the board receives.</div>';

  el.innerHTML = otherSourceWarning
    + '<div id="fin-daycare-mdo-note"></div>'
    + finRenderDaycareRatioStrip(agg)
    + degradedNote
    + roomsHtml
    + (agg.years.length
      ? '<div class="fin-card"><div class="fin-card-title" style="font-size:20px;">Year by year</div>'
        + '<div class="fin-card-sub">From the church budget import — the single source of truth for these figures.</div>'
        + yearTable + '</div>'
      : '');
  finRenderDaycareMdoNote();
}

function finExportDaycareCsv() {
  var agg = _finDaycareAgg;
  if (!agg || !agg.years.length) { finToast('No daycare data to export.'); return; }
  var header = ['Category'].concat(agg.years.reduce(function(a, y) { return a.concat([y + ' Actual', y + ' Budget']); }, []));
  var rows = [header];
  agg.categories.forEach(function(cat) {
    var row = [cat];
    agg.years.forEach(function(y) {
      var c = agg.byYear[y].categories[cat] || { actual: 0, budget: 0 };
      row.push(c.actual.toFixed(2), c.budget.toFixed(2));
    });
    rows.push(row);
  });
  function summaryRowCsv(label, actualKey, budgetKey) {
    var row = [label];
    agg.years.forEach(function(y) { row.push(agg.byYear[y][actualKey].toFixed(2), agg.byYear[y][budgetKey].toFixed(2)); });
    return row;
  }
  rows.push(summaryRowCsv('Total Income', 'incomeActual', 'incomeBudget'));
  rows.push(summaryRowCsv('Total Expenses', 'expenseActual', 'expenseBudget'));
  rows.push(summaryRowCsv('Net Income', 'netActual', 'netBudget'));
  finDownloadCsv('daycare-report-' + agg.years[0] + '-to-' + agg.years[agg.years.length - 1] + '.csv', rows);
}

// ── Church Report v2: rebuild a nested tree from the flat finance_church_entries rows ──
// This is the client-side mirror of mergeSection()'s in-memory bottom-up summing (src/
// api-finance.js) — needed because the persisted table deliberately never stores a "Total for
// X" subtotal row (see migrations/0018_finance_church_entries.sql), only each account's own
// non-cumulative amount. A node's own_budget_cents can be null (no budget known for that
// account/year) — hasBudgetInfo tracks whether ANY node in a subtree has real budget data, so
// the renderer can show "—" instead of a misleading $0.00 for a subtree with none at all.
function finBuildTreeFromFlatRows(rows) {
  var nodeByPath = {};
  var roots = [];
  (rows || []).forEach(function(r) {
    nodeByPath[r.category_path] = {
      path: r.category_path,
      label: r.account_name,
      classification: r.classification,
      depth: r.depth,
      ownActualCents: r.own_actual_cents || 0,
      ownBudgetCents: r.own_budget_cents,
      totalActualCents: 0,
      totalBudgetCents: 0,
      hasBudgetInfo: r.own_budget_cents != null,
      children: [],
    };
  });
  (rows || []).forEach(function(r) {
    var node = nodeByPath[r.category_path];
    // Walk up ALL ancestor path prefixes (not just the immediate parent) to find the nearest
    // one with a stored row — a pure grouping label with no own posting (e.g. "Job Materials")
    // never gets its own row (see flattenReportTree), so the immediate parent path is often a
    // gap; skipping straight to the immediate parent would wrongly treat this node as a root
    // and silently drop it out of every ancestor's rollup total.
    var segments = r.category_path.split(':');
    var parent = null;
    for (var i = segments.length - 1; i > 0; i--) {
      var candidate = nodeByPath[segments.slice(0, i).join(':')];
      if (candidate) { parent = candidate; break; }
    }
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  function computeTotals(node) {
    var totalActual = node.ownActualCents;
    var totalBudget = node.ownBudgetCents || 0;
    var hasBudgetInfo = node.hasBudgetInfo;
    node.children.forEach(function(c) {
      computeTotals(c);
      totalActual += c.totalActualCents;
      totalBudget += c.totalBudgetCents;
      if (c.hasBudgetInfo) hasBudgetInfo = true;
    });
    node.totalActualCents = totalActual;
    node.totalBudgetCents = totalBudget;
    node.hasBudgetInfo = hasBudgetInfo;
  }
  roots.forEach(computeTotals);
  return roots;
}
// ── Display-only chart-of-accounts reorganization ───────────────────────────────────────────
// Requested reshaping of how the real QuickBooks account tree is PRESENTED — no stored data or
// backend totals (stat cards still come from the server's own classificationTotals) are touched:
// (1) the "Income" classification root is relabeled "Revenue" and sorted before Expenses,
// (2) Facility Rental/Fundraisers/MDO are grouped under a new "Earned Income" heading,
// (3) Altar Guild is grouped under a new "Restricted Income" heading.
// Every account is shown: nothing is hidden from this tree, so it can never disagree with the
// server-computed Total Revenue stat card. (FIN14 also hid any account named exactly "Sales",
// which the Church Report's own total still counted — a documented inconsistency. Confirmed
// 2026-08-07 that this church has no such account, so the rule was vestigial and is gone.)
// Applied to a cloned copy so the original tree (and any cached totals elsewhere) is untouched.
function finSetNodeDepth(node, depth) {
  node.depth = depth;
  (node.children || []).forEach(function(c) { finSetNodeDepth(c, depth + 1); });
}
function finExtractNodesByLabel(nodes, labelRe) {
  var found = [];
  for (var i = nodes.length - 1; i >= 0; i--) {
    if (labelRe.test(nodes[i].label)) { found.unshift(nodes.splice(i, 1)[0]); }
    else { found = finExtractNodesByLabel(nodes[i].children, labelRe).concat(found); }
  }
  return found;
}
function finMakeGroupNode(label, classification, children) {
  return { path: '__group:' + label, label: label, classification: classification, depth: 0, ownActualCents: 0, ownBudgetCents: null, totalActualCents: 0, totalBudgetCents: 0, hasBudgetInfo: false, children: children };
}
// Recomputes every node's total (own + all descendants) bottom-up from each node's OWN figures
// — safe to call after moving nodes around, unlike patching totals incrementally, since a
// node's stored total is a point-in-time sum that doesn't auto-update when its children change.
function finRecomputeTreeTotals(nodes) {
  (nodes || []).forEach(function(node) {
    finRecomputeTreeTotals(node.children);
    var totalActual = node.ownActualCents || 0;
    var totalBudget = node.ownBudgetCents || 0;
    var hasBudgetInfo = node.ownBudgetCents != null;
    (node.children || []).forEach(function(c) {
      totalActual += c.totalActualCents;
      totalBudget += c.totalBudgetCents;
      if (c.hasBudgetInfo) hasBudgetInfo = true;
    });
    node.totalActualCents = totalActual;
    node.totalBudgetCents = totalBudget;
    node.hasBudgetInfo = hasBudgetInfo;
  });
}
// Revenue-like classes (Income, Other Income) grouped first, then expense-like classes (Cost of
// Goods Sold, Expenses, Other Expenses) — needed so Planning can insert one Total Revenue
// subtotal after the revenue group and one Total Expenses subtotal after the expense group,
// rather than the two being interleaved.
var FIN_CHURCH_CLASS_ORDER = { 'Income': 0, 'Other Income': 1, 'Cost of Goods Sold': 2, 'Expenses': 3, 'Other Expenses': 4 };
var FIN_REVENUE_CLASSES = { 'Income': true, 'Other Income': true };
// Groups the revenue side of the account tree by the SAME saved classification the Financial
// Health page reads (chms_config.finance_revenue_streams, edited on Data & Imports), so one
// decision drives both pages. Falls back to the original hardcoded regex only when no map has
// been loaded yet, so a caller with no stream data renders exactly what it always did.
//
var FIN_STREAM_GROUP_LABELS = { earned: 'Earned Income', passive: 'Passive Income', restricted: 'Restricted Income' };
// QuickBooks invents "Unapplied Cash Bill Payment Expense" / "Unapplied Cash Payment Income" on a
// cash-basis report to hold a bill payment or customer payment that isn't applied to a bill or
// invoice. It is a bookkeeping artifact of the report, not an account anybody at the church chose,
// and it is nearly always $0 — so an empty one is dropped from every account tree.
//
// ⚠ Only when it is empty. A row carrying real money stays, with a note explaining what it is,
// because hiding a dollar that a total on the same screen still counts is exactly the defect FIN58
// existed to fix (and FIN60 set this same zero-only rule for Cost of Goods Sold).
var FIN_UNAPPLIED_CASH_RE = /\bunapplied cash\b/i;
var FIN_UNAPPLIED_CASH_HINT = 'QuickBooks adds this line on a cash-basis report for a bill or customer payment that is not applied to a bill or invoice. It is hidden here when it is $0.';
function finPruneEmptyUnappliedCash(nodes) {
  for (var i = (nodes || []).length - 1; i >= 0; i--) {
    var n = nodes[i];
    finPruneEmptyUnappliedCash(n.children);
    if (!FIN_UNAPPLIED_CASH_RE.test(n.label || '')) continue;
    if (!n.totalActualCents && !n.totalBudgetCents && !n.children.length) nodes.splice(i, 1);
    else n.hint = FIN_UNAPPLIED_CASH_HINT;
  }
}
function finReorganizeChurchTree(roots, streamMap) {
  var cloned = JSON.parse(JSON.stringify(roots || []));
  // typeof guard so the function stays runnable from an isolated extract in the test harness,
  // which evals it without the surrounding file's globals (same convention as FIN46).
  var map = streamMap || (typeof _finStreamMap !== 'undefined' ? _finStreamMap : null);
  var incomeRoot = cloned.filter(function(n) { return n.classification === 'Income'; })[0];
  if (map) {
    // Only donor-stream groups stay at the top level under Revenue; each other stream collects
    // into one named group. Extraction is by exact label so a node is matched against the same
    // key the classification editor saved.
    ['earned', 'passive', 'restricted'].forEach(function(stream) {
      var labels = Object.keys(map).filter(function(k) { return map[k] === stream; });
      if (!labels.length || !incomeRoot) return;
      var picked = [];
      for (var i = incomeRoot.children.length - 1; i >= 0; i--) {
        if (labels.indexOf(incomeRoot.children[i].label) !== -1) picked.unshift(incomeRoot.children.splice(i, 1)[0]);
      }
      if (picked.length) incomeRoot.children.push(finMakeGroupNode(FIN_STREAM_GROUP_LABELS[stream], 'Income', picked));
    });
  } else {
    var earnedChildren = finExtractNodesByLabel(cloned, /^(facility rental|fundraisers|mdo)$/i);
    var restrictedChildren = finExtractNodesByLabel(cloned, /^altar guild$/i);
    if (incomeRoot) {
      if (earnedChildren.length) incomeRoot.children.push(finMakeGroupNode('Earned Income', 'Income', earnedChildren));
      if (restrictedChildren.length) incomeRoot.children.push(finMakeGroupNode('Restricted Income', 'Income', restrictedChildren));
    }
  }
  if (incomeRoot) incomeRoot.label = 'Revenue';
  finPruneEmptyUnappliedCash(cloned);
  finSetNodeDepth({ depth: -1, children: cloned }, -1);
  finRecomputeTreeTotals(cloned);
  cloned.sort(function(a, b) {
    var oa = FIN_CHURCH_CLASS_ORDER[a.classification]; var ob = FIN_CHURCH_CLASS_ORDER[b.classification];
    return (oa === undefined ? 9 : oa) - (ob === undefined ? 9 : ob);
  });
  return cloned;
}
// Renders finBuildTreeFromFlatRows()'s output as an indented HTML table body (Account | Actual
// | Budget | Remaining), including each node's own-plus-descendants total (matching what a
// QuickBooks "Total for X" row would show, recomputed rather than stored).
// A small magnitude-vs-budget bar + signed figure, matching the Finance Workspace handoff's
// "Variance" column — green (favorable) when actual is on the good side of budget, terracotta
// (unfavorable) otherwise. Favorability is sign-aware per the handoff: for income/revenue rows
// (classification arg), actual >= budget is good; for expense rows, actual <= budget is good.
function finVarianceCell(actualCents, budgetCents, classification) {
  if (budgetCents == null) return '<td style="text-align:right;padding:5px 8px;color:var(--warm-gray);">—</td>';
  var varianceCents = classification === 'Income' || classification === 'Other Income'
    ? actualCents - budgetCents
    : budgetCents - actualCents;
  var favorable = varianceCents >= 0;
  var pct = budgetCents ? Math.min(100, Math.abs(varianceCents) / Math.abs(budgetCents) * 100) : 0;
  return '<td style="text-align:right;padding:5px 8px;white-space:nowrap;">'
    + '<span class="fin-variance-bar-track"><span class="fin-variance-bar-fill" style="width:' + pct + '%;background:' + (favorable ? 'var(--sage)' : 'var(--danger)') + ';"></span></span>'
    + '<span style="color:' + (favorable ? 'var(--sage-text)' : 'var(--danger)') + ';font-weight:600;">' + finFmtSigned(varianceCents) + '</span></td>';
}
// ⚠ QuickBooks reading order, and the app now follows it everywhere an account tree is drawn:
// a group's figures sit UNDERNEATH its accounts as a computed "Total X", never above them as a
// header carrying the sum. So a group renders as a bare label row (no figures — printing them
// there and again four lines down is the same number twice, and the top copy reads as though the
// accounts beneath it were a breakdown of something already counted), then its accounts, then its
// total. A leaf is just its own row.
//
// Shared by the Church Report's detail table and the Planning budget builder rather than written
// twice: two hand-inlined copies of one reading order is how they drift (SW17).
function finRenderTreeQbOrder(nodes, render, out) {
  out = out || [];
  (nodes || []).forEach(function(node) {
    if (!node.children.length) { out.push(render.leaf(node)); return; }
    out.push(render.groupHeader(node));
    finRenderTreeQbOrder(node.children, render, out);
    out.push(render.groupTotal(node));
  });
  return out;
}
// A node's own label cell, indented to its depth — so a "Total X" row sits at its group's own
// indent rather than its children's, and carries the group's note as a tooltip when it has one.
function finTreeLabelCell(node, label, opts) {
  opts = opts || {};
  var v = opts.padV || '5px';
  return '<td style="padding:' + v + ' 8px ' + v + ' ' + (10 + node.depth * 16) + 'px;'
    + (opts.color ? 'color:' + opts.color + ';' : '') + '"'
    + (node.hint ? ' title="' + esc(node.hint) + '"' : '') + '>' + esc(label) + '</td>';
}
function finRenderDetailTreeRows(nodes, html) {
  // Kept as the leaf/header pair the Church Report table feeds into finRenderTreeQbOrder.
  return finRenderTreeQbOrder(nodes, {
    leaf: finChurchDetailLeafRow,
    groupHeader: finChurchDetailGroupHeaderRow,
    groupTotal: function(node) { return finRenderChurchTotalRow(node, 'Total ' + node.label); },
  }, html || []);
}
function finChurchDetailLeafRow(node) {
  return '<tr>'
    + finTreeLabelCell(node, node.label, { color: 'var(--warm-ink-label)' })
    + '<td style="text-align:right;padding:5px 8px;">$' + finFmtMoney(node.totalActualCents / 100) + '</td>'
    + '<td style="text-align:right;padding:5px 8px;color:var(--warm-gray);">' + (node.hasBudgetInfo ? '$' + finFmtMoney(node.totalBudgetCents / 100) : '—') + '</td>'
    + finVarianceCell(node.totalActualCents, node.hasBudgetInfo ? node.totalBudgetCents : null, node.classification)
    + '</tr>';
}
// Group header: the name only. Its figures are on its Total row, beneath its accounts.
function finChurchDetailGroupHeaderRow(node) {
  return '<tr style="font-weight:700;">'
    + finTreeLabelCell(node, node.label, { color: 'var(--charcoal)' })
    + '<td></td><td></td><td></td></tr>';
}
// A bold "Total X" row for one top-level classification node (Revenue/Expenses/etc), styled to
// read as a subtotal beneath its own account lines rather than a header above them.
function finRenderChurchTotalRow(node, label) {
  // Shaded only at the top level: every group now carries a total, and shading all of them turns
  // the table into stripes with no hierarchy left to read.
  var shade = (node.depth || 0) === 0 ? 'background:var(--warm-surface-page);' : '';
  return '<tr style="font-weight:700;border-top:1px solid var(--warm-border);' + shade + '">'
    + finTreeLabelCell(node, label, { padV: '6px' })
    + '<td style="text-align:right;padding:6px 8px;">$' + finFmtMoney(node.totalActualCents / 100) + '</td>'
    + '<td style="text-align:right;padding:6px 8px;color:var(--warm-gray);">' + (node.hasBudgetInfo ? '$' + finFmtMoney(node.totalBudgetCents / 100) : '—') + '</td>'
    + finVarianceCell(node.totalActualCents, node.hasBudgetInfo ? node.totalBudgetCents : null, node.classification)
    + '</tr>';
}
// Full account-detail table body for the Church Report, in the QuickBooks order described on
// finRenderTreeQbOrder: every group's "Total X" sits beneath its own account lines, at every
// level, not only the top one. The grand-total Net Income figure — mirroring the same
// actual/budget/remaining shown in the summary card above, so the two can never disagree — is
// rendered separately as a full-width navy bar (finRenderNetIncomeBar), matching the Finance
// Workspace handoff's footer treatment, not as a table row.
function finRenderChurchDetailBody(tree, netIncome, hasBudgetData) {
  return finRenderDetailTreeRows(tree).join('');
}
// Full-width navy "Net Income" bar — the Finance Workspace handoff's footer treatment for the
// Church Report table (mockup section 2: "navy full-width Net Income bar, surplus green-on-navy").
function finRenderNetIncomeBar(netIncome, hasBudgetData) {
  if (!netIncome) return '';
  var remaining = (netIncome.budgetCents || 0) - (netIncome.actualCents || 0);
  return '<div class="fin-navy-card" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-top:2px;border-radius:0 0 20px 20px;">'
    + '<div class="fin-navy-label" style="text-transform:none;font-size:.95rem;font-weight:700;color:var(--white);">Net Income (Surplus/Deficit)</div>'
    + '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">'
    + '<div class="fin-navy-val ' + (netIncome.actualCents >= 0 ? 'positive' : 'negative') + '">' + finFmtSigned(netIncome.actualCents) + '</div>'
    + (hasBudgetData ? '<div style="font-size:.8rem;color:rgba(255,255,255,.75);">vs. $' + finFmtMoney(netIncome.budgetCents/100) + ' budget (' + (remaining >= 0 ? '$' + finFmtMoney(remaining/100) + ' remaining' : 'over by $' + finFmtMoney(-remaining/100)) + ')</div>' : '')
    + '</div></div>';
}
// The report's "as of" date: the most recent sync/import timestamp among this year's entries.
function finChurchAsOfDate(entries) {
  var latest = '';
  (entries || []).forEach(function(e) { if (e.synced_at && e.synced_at > latest) latest = e.synced_at; });
  if (!latest) return '';
  var dt = new Date(latest);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ── Church Report v2 (board-level): This Year / Multi-Year toggle ───────────
// Both views read from the persisted finance_church_entries table (finance/church/this-year,
// finance/church/multi-year) rather than the live QuickBooks blob cache — see
// migrations/0018_finance_church_entries.sql for why. Mirrors the This-Year/Multi-Year toggle
// pattern already used for Attendance by Service (setAttByServiceMode in js-attendance.js).
var _finChurchMode = 'year';
var _finChurchThisYearData = null;
var _finChurchMultiYearData = null;
var _finChurchBalancesData = null;
var _finChurchBalancesMultiYearData = null;

// Shared palette for the category pie charts below (Income sources / Expense categories /
// Asset composition) — cycles by category rank (largest first) rather than a fixed per-category
// mapping, since the actual category set varies church-to-church.
var CHURCH_PIE_PALETTE = ['#2E7EA6', '#C9973A', '#5A9E6F', '#9B59B6', '#8A7968', '#B85C3A', '#4A6FA5', '#D4A574'];
// Builds pie-chart {label,value,color} items from a classification's immediate depth-1
// subcategories (e.g. "40 Donor Income", "42 Passive Income" under Income) — falls back to the
// classification root itself if it has no subcategories (a flat chart of accounts with no
// grouping). Zero/negative totals are dropped (a pie slice can't represent them meaningfully);
// sorted largest-first so the legend and color assignment are stable and readable. Takes an
// already-built tree (from finBuildTreeFromFlatRows/finBuildBalanceTreeFromFlatRows) rather than
// raw rows, since both callers already build that tree for the full-detail table below.
function finPieItemsFromTree(tree, classification, totalField) {
  var root = tree.filter(function(n) { return n.classification === classification && n.depth === 0; })[0];
  if (!root) return [];
  var cats = root.children.length ? root.children : [root];
  return cats.filter(function(c) { return c[totalField] > 0; })
    .sort(function(a, b) { return b[totalField] - a[totalField]; })
    .map(function(c, i) { return { label: c.label, value: c[totalField], color: CHURCH_PIE_PALETTE[i % CHURCH_PIE_PALETTE.length] }; });
}

// The three modes are a pill group, not three buttons — one control that reads as one choice.
// The seven import buttons that used to sit in this toolbar are gone; the functions that back
// them are untouched and are now invoked from the Data & Imports tab.
function finRenderChurchHeader() {
  var el = document.getElementById('fin-church-header');
  if (!el) return;
  var d = _finChurchThisYearData;
  var year = d ? d.year : new Date().getFullYear();
  var asOf = d && d.entries ? finChurchAsOfDate(d.entries) : '';
  var sub = 'FY' + year + (asOf ? ' &middot; YTD actuals as of ' + esc(asOf) : '') + ' &middot; QuickBooks chart of accounts';
  var actions = finPills([
    { key: 'year', label: 'This year' },
    { key: 'multiyear', label: 'Multi-year' },
    { key: 'balances', label: 'Balance sheet' },
  ], _finChurchMode, 'finSetChurchReportMode')
    + '<button class="btn-secondary" onclick="finExportChurchCsv()">Export CSV</button>'
    + '<button class="btn-secondary" onclick="window.print()">Print</button>';
  el.innerHTML = finPageHeader('Church Report', sub, actions);
}
function finSetChurchReportMode(mode) {
  _finChurchMode = mode;
  var yearEl = document.getElementById('fin-church-year-view');
  var multiEl = document.getElementById('fin-church-multiyear-view');
  var balEl = document.getElementById('fin-church-balances-view');
  if (yearEl) yearEl.style.display = mode === 'year' ? '' : 'none';
  if (multiEl) multiEl.style.display = mode === 'multiyear' ? '' : 'none';
  if (balEl) balEl.style.display = mode === 'balances' ? '' : 'none';
  finRenderChurchHeader();
  if (mode === 'year' && !_finChurchThisYearData) finLoadChurchThisYear();
  if (mode === 'multiyear' && !_finChurchMultiYearData) finLoadChurchMultiYear();
  if (mode === 'balances' && !_finChurchBalancesData) finLoadChurchBalances();
}

// Called from loadFinance() on every tab load AND after every "Sync Now" — always invalidates
// the cached church-report data first so a fresh sync's results actually show up, rather than
// the stale data finSetChurchReportMode's cache-guard would otherwise keep serving (that guard
// exists only to avoid a redundant re-fetch when the user merely clicks the This Year/Multi-Year
// toggle back and forth, which calls finSetChurchReportMode directly, not through here).
function finRenderChurchReport() {
  _finChurchThisYearData = null;
  _finChurchMultiYearData = null;
  _finChurchBalancesData = null;
  _finChurchBalancesMultiYearData = null;
  finSetChurchReportMode(_finChurchMode);
}

function finLoadChurchThisYear(year) {
  year = year || new Date().getFullYear();
  var el = document.getElementById('fin-church-year-view');
  if (!el) return;
  el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">Loading…</p>';
  api('/admin/api/finance/church/this-year?year=' + year).then(function(d) {
    _finChurchThisYearData = finRememberStreamMap(d);
    finRenderChurchThisYear(d);
  }).catch(function(err) {
    if (err && err.message === 'Unauthorized') return;
    el.innerHTML = '<p style="font-size:.85rem;color:var(--danger);">Could not load this year’s church data.</p>';
  });
}

// One This Year summary card. The chip states the figure's own relationship to budget; for Net
// income that relationship is the VARIANCE, computed as actual net minus budgeted net, so the
// three cards reconcile against each other — revenue variance plus expense variance equals the
// net variance shown here, rather than three independently-derived percentages that nearly add up.
function finChurchSummaryCard(label, totals, hasBudget, borderColor, isNet) {
  var actual = totals.actualCents, budget = totals.budgetCents;
  var valueColor = isNet && actual < 0 ? 'color:var(--danger);' : '';
  var html = '<div class="fin-kpi-card" style="border-top-color:' + borderColor + ';">'
    + '<div class="fin-kpi-lbl">' + label + '</div>'
    + '<div class="fin-kpi-val" style="' + valueColor + '">' + (isNet ? finFmtSigned(actual) : '$' + finFmtMoney(actual / 100)) + '</div>';
  if (!hasBudget) return html + '<div class="fin-kpi-sub">No budget data for this year</div></div>';
  if (isNet) {
    var variance = actual - budget;
    html += '<span class="fin-chip ' + (variance >= 0 ? 'fin-chip-positive' : 'fin-chip-negative') + '">'
      + finFmtSigned(variance) + ' vs. budgeted net</span>';
  } else {
    var pct = budget > 0 ? Math.round(actual * 100 / budget) : null;
    var over = budget > 0 && actual > budget;
    html += '<span class="fin-chip ' + (over ? 'fin-chip-warn' : 'fin-chip-info') + '">'
      + (pct != null ? pct + '% of $' + finFmtMoney(budget / 100) + ' budget' : 'No budget') + '</span>';
  }
  return html + '</div>';
}
// Zero-baseline column chart for five-year net income. Deliberately NOT renderGroupedBarChart():
// that helper measures every bar from the bottom of its own plot area, so a deficit year renders
// as an invisible sliver instead of a bar below the line — which is precisely the year a board
// needs to see. Here the axis sits mid-plot and a negative year is drawn downward from it.
function finRenderNetIncomeByYearChart(multiYear) {
  if (!multiYear || !multiYear.years || multiYear.years.length < 2) return '';
  var years = multiYear.years.slice();
  var vals = years.map(function(y) {
    var s = multiYear.byYear[y];
    return { year: y, cents: (s && s.netIncome ? s.netIncome.actualCents : 0) };
  });
  var maxAbs = Math.max.apply(null, vals.map(function(v) { return Math.abs(v.cents); }).concat([1]));
  var W = 620, axisY = 95, halfH = 62, left = 60, right = 600;
  var slot = (right - left) / years.length;
  var barW = Math.min(70, slot * 0.62);
  var bars = vals.map(function(v, i) {
    var cx = left + slot * i + slot / 2;
    var h = Math.max(3, Math.abs(v.cents) / maxAbs * halfH);
    var positive = v.cents >= 0;
    var y = positive ? axisY - h : axisY;
    var color = positive ? 'var(--sage)' : 'var(--danger)';
    var labelY = positive ? y - 6 : y + h + 15;
    return '<rect x="' + (cx - barW / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" fill="' + color + '"></rect>'
      + '<text x="' + cx.toFixed(1) + '" y="' + labelY.toFixed(1) + '" font-size="11.5" font-weight="800" text-anchor="middle" fill="' + (positive ? 'var(--sage-text)' : 'var(--danger)') + '">' + finFmtSigned(v.cents).replace(/\.00$/, '') + '</text>'
      + '<text x="' + cx.toFixed(1) + '" y="176" font-size="11" text-anchor="middle" fill="var(--warm-meta)">' + v.year + '</text>';
  }).join('');
  var worst = vals.reduce(function(a, b) { return b.cents < a.cents ? b : a; }, vals[0]);
  var best = vals.reduce(function(a, b) { return b.cents > a.cents ? b : a; }, vals[0]);
  return '<div class="fin-card">'
    + '<div class="fin-card-title" style="font-size:20px;">Five-year net income</div>'
    + '<div class="fin-card-sub">Deficit years are drawn below the axis, at the same scale as a surplus.</div>'
    + '<svg viewBox="0 0 ' + W + ' 190" width="100%" height="180" role="img" aria-label="Net income by year, '
    + years[0] + ' to ' + years[years.length - 1] + '. Best year ' + best.year + ' at ' + finFmtSigned(best.cents)
    + ', worst year ' + worst.year + ' at ' + finFmtSigned(worst.cents) + '.">'
    + '<line x1="' + left + '" y1="' + axisY + '" x2="' + right + '" y2="' + axisY + '" stroke="var(--warm-border)" stroke-width="1.5"></line>'
    + '<text x="8" y="' + (axisY - halfH + 4) + '" font-size="10" fill="var(--warm-meta)">' + finMoney0(maxAbs) + '</text>'
    + '<text x="8" y="' + (axisY + 4) + '" font-size="10" fill="var(--warm-meta)">$0</text>'
    + '<text x="8" y="' + (axisY + halfH + 4) + '" font-size="10" fill="var(--warm-meta)">-' + finMoney0(maxAbs) + '</text>'
    + bars + '</svg></div>';
}
// Revenue by account group, as labeled bars rather than a pie: a pie makes two similar slices
// hard to rank and gives no room for the dollar figure, which is the number being read.
function finRenderRevenueSources(tree, d) {
  var items = finPieItemsFromTree(tree, 'Income', 'totalActualCents');
  var max = items.reduce(function(m, i) { return Math.max(m, i.value); }, 1);
  var bars = items.map(function(it, i) {
    var color = i === 0 ? 'var(--color-teal)' : i === 1 ? 'var(--sage)' : 'var(--color-gold)';
    return finBar(esc(it.label), '$' + finFmtMoney(it.value / 100), it.value / max * 100, color);
  }).join('');
  return '<div class="fin-card">'
    + '<div class="fin-card-title" style="font-size:20px;">Revenue sources</div>'
    + '<div class="fin-card-sub">What actually cleared the bank, by account group.</div>'
    + '<div style="display:flex;flex-direction:column;gap:9px;">'
    + (bars || '<p style="font-size:.85rem;color:var(--warm-gray);">No revenue recorded for this year yet.</p>')
    + '</div>'
    + '<div class="fin-note-box" style="margin-top:14px;"><b>Giving per ChMS records: $' + finFmtMoney(d.givingCents / 100) + '.</b> '
    + 'Reference only — QuickBooks reflects what has cleared and been recorded, so timing differences are expected, not a discrepancy to chase.</div>'
    + '</div>';
}

// This-year-vs-last-year-to-date + a year-end projection. yoy.available is false when
// monthly-granularity data hasn't been synced yet (needs a QuickBooks sync after this feature
// shipped — see the sync handler) — shown as an honest "not yet available" note rather than a
// misleading number computed from annual-only data.
function finRenderYoyRow(label, s) {
  return '<tr><td style="padding:5px 8px;">' + label + '</td>'
    + '<td style="text-align:right;padding:5px 8px;">$' + finFmtMoney(s.currentYtdCents / 100) + '</td>'
    + '<td style="text-align:right;padding:5px 8px;color:var(--warm-gray);">$' + finFmtMoney(s.priorYtdCents / 100) + '</td>'
    + '<td style="text-align:right;padding:5px 8px;color:var(--warm-gray);">$' + finFmtMoney(s.priorFullYearCents / 100) + '</td>'
    + '<td style="text-align:right;padding:5px 8px;font-weight:600;">$' + finFmtMoney(s.projectedFullYearCents / 100) + '</td>'
    + '</tr>';
}
function finRenderYoyBlock(yoy) {
  if (!yoy || !yoy.available) {
    return '<div style="font-size:.8rem;color:var(--warm-gray);background:var(--linen);border-radius:8px;padding:10px 14px;margin-bottom:18px;">'
      + 'Year-over-year comparison and a year-end projection aren’t available yet — they need a monthly-granularity QuickBooks sync (current + prior year). Click "Sync Now" in the Overview tab to enable this.'
      + '</div>';
  }
  var monthLbl = MONTH_NAMES[yoy.throughMonth - 1];
  // Chart shows YTD-so-far vs. the projection; "Last Year (Full)" stays table-only since a bar
  // for it would visually compete with "Last Year YTD" for the same category without adding
  // insight the table doesn't already give. NOTE: like the Attendance chart this is built on,
  // renderGroupedBarChart doesn't support negative bars — a deficit (negative Net Income) will
  // render as a near-invisible sliver rather than a below-the-axis bar. Acceptable for now since
  // the table above always shows the real signed number regardless.
  var chart = renderGroupedBarChart({
    chartH: 200,
    groups: [{ key: 'income', label: 'Revenue' }, { key: 'expenses', label: 'Expenses' }, { key: 'net', label: 'Net Income' }],
    series: [
      { key: 'cur', label: 'This Year YTD', color: '#2E7EA6' },
      { key: 'prior', label: 'Last Year YTD', color: '#C9973A' },
      { key: 'proj', label: 'Projected Full Year', color: '#5A9E6F' },
    ],
    value: function(g, s) {
      var row = g === 'income' ? yoy.income : g === 'expenses' ? yoy.expenses : yoy.net;
      var cents = s === 'cur' ? row.currentYtdCents : s === 'prior' ? row.priorYtdCents : row.projectedFullYearCents;
      return cents / 100;
    },
    tooltip: function(g, s, v) {
      var gLbl = g === 'income' ? 'Revenue' : g === 'expenses' ? 'Expenses' : 'Net Income';
      var sLbl = s === 'cur' ? 'This Year YTD' : s === 'prior' ? 'Last Year YTD' : 'Projected Full Year';
      return sLbl + ' — ' + gLbl + ': $' + finFmtMoney(v);
    },
    barLabel: function(v) { return '$' + Math.round(v / 1000) + 'k'; },
  });
  return '<div style="margin-bottom:18px;">'
    + '<h4 style="margin:0 0 8px;font-family:var(--font-head);color:var(--steel-anchor);font-size:.9rem;">This year vs. last year (through ' + monthLbl + ')</h4>'
    + chart
    + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead><tr style="border-bottom:2px solid var(--navy);">'
    + '<th style="text-align:left;padding:6px 8px;"></th>'
    + '<th style="text-align:right;padding:6px 8px;">This Year YTD</th>'
    + '<th style="text-align:right;padding:6px 8px;">Last Year YTD</th>'
    + '<th style="text-align:right;padding:6px 8px;">Last Year (Full)</th>'
    + '<th style="text-align:right;padding:6px 8px;">Projected Full Year</th>'
    + '</tr></thead><tbody>'
    + finRenderYoyRow('Revenue', yoy.income)
    + finRenderYoyRow('Expenses', yoy.expenses)
    + finRenderYoyRow('Net Income', yoy.net)
    + '</tbody></table></div>'
    + '<p style="font-size:.72rem;color:var(--warm-gray);margin-top:6px;">'
    + 'Projection assumes this year follows a similar month-to-month pattern as last year — an estimate for planning, not a guarantee; a single large one-time gift or expense can shift it substantially.'
    + '</p></div>';
}
// Supplies chart — a real MDO/church QuickBooks account ("...Supplies") pulled out of the
// generic Other Expenses catch-all and charted month-by-month, styled after the myMDO daycare
// dashboard's monthly bar charts (This Year vs Last Year grouped bars). d.supplies.available
// is implied by a non-empty monthly array — mirrors the yoy.available convention.
function finRenderSuppliesChart(d) {
  var supplies = d.supplies;
  if (!supplies || !supplies.monthly || !supplies.monthly.length) return '';
  var hasAny = supplies.monthly.some(function(m) { return m.currentCents || m.priorCents; });
  if (!hasAny) return '';
  var chart = renderGroupedBarChart({
    chartH: 180,
    groups: supplies.monthly.map(function(m) { return { key: m.month, label: MONTH_NAMES[m.month - 1].slice(0, 3) }; }),
    series: [
      { key: 'cur', label: 'This Year', color: '#2E7EA6' },
      { key: 'prior', label: 'Last Year', color: '#C9973A' },
    ],
    value: function(g, s) {
      var row = supplies.monthly[g - 1];
      return (s === 'cur' ? row.currentCents : row.priorCents) / 100;
    },
    tooltip: function(g, s, v) {
      return (s === 'cur' ? 'This Year' : 'Last Year') + ' — ' + MONTH_NAMES[g - 1] + ': $' + finFmtMoney(v);
    },
    barLabel: function(v) { return v >= 1000 ? '$' + Math.round(v / 1000) + 'k' : '$' + Math.round(v); },
  });
  if (!chart) return '';
  return '<div style="margin-bottom:18px;">'
    + '<h4 style="margin:0 0 8px;font-family:var(--font-head);color:var(--steel-anchor);font-size:.9rem;">Supplies by month</h4>'
    + chart
    + '<div style="font-size:.78rem;color:var(--warm-gray);margin-top:6px;">'
    + 'YTD: $' + finFmtMoney(supplies.currentYtdCents / 100) + ' this year vs. $' + finFmtMoney(supplies.priorYtdCents / 100) + ' last year'
    + ' <span style="font-size:.72rem;">— any QuickBooks account with "Supplies" in its name; still counted under Other Expenses in the totals above, shown here for visibility only.</span>'
    + '</div></div>';
}
// Collapsed-by-default detail strip: one line naming what is inside, and a button that expands it
// in place. The read is above; the ledger is for when someone asks.
var _finChurchExpand = {};
function finChurchToggleDetail(key) {
  _finChurchExpand[key] = !_finChurchExpand[key];
  if (_finChurchThisYearData) finRenderChurchThisYear(_finChurchThisYearData);
}
function finDetailStrip(key, title, sub, bodyHtml) {
  var open = !!_finChurchExpand[key];
  return '<div class="fin-card fin-ledger-strip">'
    + '<div class="fin-ledger-strip-hdr">'
    + '<div><div class="fin-ledger-strip-title">' + title + '</div><div class="fin-ledger-strip-sub">' + sub + '</div></div>'
    + '<button class="btn-secondary" style="white-space:nowrap;" onclick="finChurchToggleDetail(' + jsAttr(key) + ')">' + (open ? 'Hide &#9662;' : 'Show detail &#9656;') + '</button>'
    + '</div>'
    + (open ? '<div style="margin-top:14px;">' + bodyHtml + '</div>' : '')
    + '</div>';
}
// The giving reference, combined on the leading fund code (groupRowsByFundCode in js-core.js) —
// "40085 Lent" and "40085 Retirement Distribution" belong on the General Fund's own line, not as
// their own scattered rows. A code covering more than one fund expands in place to show them.
function finGivingFundGroupRows(rows) {
  var groups = groupRowsByFundCode(rows, function(f) { return f.fundName; }, function(f) { return f.cents; });
  var money = function(c) { return '<td style="padding:3px 0;text-align:right;font-variant-numeric:tabular-nums;">$' + finFmtMoney(c / 100) + '</td>'; };
  var gi = 0;
  return groups.map(function(g) {
    if (g.rows.length < 2) {
      return '<tr><td style="padding:3px 8px 3px 0;">' + esc(g.label) + '</td>' + money(g.total) + '</tr>';
    }
    var idx = gi++;
    var out = '<tr style="cursor:pointer;" onclick="finToggleGivingFundGroup(' + idx + ')">'
      + '<td style="padding:3px 8px 3px 0;"><span id="fin-giv-grp-chevron-' + idx + '">&#9656;</span> ' + esc(g.label)
      + ' <span style="color:var(--warm-gray);">(' + g.rows.length + ' funds)</span></td>' + money(g.total) + '</tr>';
    g.rows.forEach(function(f) {
      out += '<tr class="fin-giv-grp-row" data-grp="' + idx + '" style="display:none;">'
        + '<td style="padding:3px 8px 3px 18px;color:var(--warm-gray);">' + esc(f.fundName) + '</td>' + money(f.cents) + '</tr>';
    });
    return out;
  }).join('');
}
function finToggleGivingFundGroup(idx) {
  var rows = document.querySelectorAll('tr.fin-giv-grp-row[data-grp="' + idx + '"]');
  var chevron = document.getElementById('fin-giv-grp-chevron-' + idx);
  if (!rows.length) return;
  var expanded = rows[0].style.display !== 'none';
  rows.forEach(function(r) { r.style.display = expanded ? 'none' : ''; });
  if (chevron) chevron.innerHTML = expanded ? '&#9656;' : '&#9662;';
}
function finRenderChurchThisYear(d) {
  var el = document.getElementById('fin-church-year-view');
  if (!el) return;
  finRenderChurchHeader();
  if (!d || !d.entries || !d.entries.length) {
    el.innerHTML = '<div class="fin-card"><p style="font-size:.85rem;color:var(--warm-gray);margin:0;">No church report data yet for ' + (d ? d.year : '') + '. Connect QuickBooks or run an import from the <b>Data &amp; Imports</b> tab.</p></div>';
    return;
  }
  var income = d.classificationTotals['Income'] || { actualCents: 0, budgetCents: 0 };
  var expenses = d.classificationTotals['Expenses'] || { actualCents: 0, budgetCents: 0 };
  var asOfDate = finChurchAsOfDate(d.entries);
  var tree = finReorganizeChurchTree(finBuildTreeFromFlatRows(d.entries));

  var kpis = '<div class="fin-grid-3">'
    + finChurchSummaryCard('Total revenue', income, d.hasBudgetData, 'var(--color-teal)', false)
    + finChurchSummaryCard('Total expenses', expenses, d.hasBudgetData, 'var(--color-gold)', false)
    + finChurchSummaryCard('Net income', d.netIncome, d.hasBudgetData, d.netIncome.actualCents < 0 ? 'var(--danger)' : 'var(--sage)', true)
    + '</div>';

  var elapsedPct = finElapsedYearPct(d.year);
  var expenseRoot = tree.filter(function(n) { return n.classification === 'Expenses'; })[0];
  var categories = ((expenseRoot && expenseRoot.children) || []).map(function(n) {
    return {
      path: n.path, label: n.label, actualCents: n.totalActualCents, budgetCents: n.totalBudgetCents,
      children: (n.children || []).map(function(c) { return { label: c.label, actualCents: c.totalActualCents, budgetCents: c.totalBudgetCents }; }),
    };
  });
  var paceCard = '<div class="fin-card">'
    + '<div class="fin-card-title" style="font-size:20px;">Where expenses sit against budget</div>'
    + '<div class="fin-card-sub">Sorted by variance, not alphabetically. The line marks ' + Math.round(elapsedPct * 100) + '% — the calendar. Click a category for its line items.</div>'
    + finRenderExpensePace(categories, elapsedPct, 5)
    + '</div>';

  var fundTable = (d.givingByFund && d.givingByFund.length)
    ? '<table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
      + finGivingFundGroupRows(d.givingByFund) + '</table>'
    : '<p style="font-size:.85rem;color:var(--warm-gray);">No giving recorded in ChMS for this year.</p>';

  var detailBody = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead><tr style="background:var(--warm-surface-header);">'
    + '<th style="text-align:left;padding:8px;" class="fin-th">Account</th>'
    + '<th style="text-align:right;padding:8px;" class="fin-th">YTD Actual</th>'
    + '<th style="text-align:right;padding:8px;" class="fin-th">Budget</th>'
    + '<th style="text-align:right;padding:8px;" class="fin-th">Variance</th></tr></thead>'
    + '<tbody>' + finRenderChurchDetailBody(tree, d.netIncome, d.hasBudgetData) + '</tbody></table></div>'
    + finRenderNetIncomeBar(d.netIncome, d.hasBudgetData);

  el.innerHTML = kpis
    + '<div class="fin-grid-2">' + finRenderRevenueSources(tree, d) + paceCard + '</div>'
    + finRenderNetIncomeByYearChart(_finChurchMultiYearData)
    + finDetailStrip('accounts', 'Full account detail &mdash; ' + d.entries.length + ' accounts, YTD vs. budget vs. variance',
        'Collapsed by default. The read is above; the ledger is for when someone asks.', detailBody)
    + finDetailStrip('yoy', 'This year vs. last year', 'Year-to-date against the same point last year, and the year-end projection that follows from it.', finRenderYoyBlock(d.yoy))
    + finDetailStrip('giving', 'Giving by fund, per ChMS records', 'The reference figure above, broken out by fund.', fundTable)
    + (finRenderSuppliesChart(d) ? finDetailStrip('supplies', 'Supplies by month', 'One account pulled out of the Other Expenses catch-all, month by month.', finRenderSuppliesChart(d)) : '');

  // The five-year chart needs the multi-year payload; fetch it once and re-render when it lands.
  if (!_finChurchMultiYearData) finLoadChurchMultiYear();
}


// The server defaults to a rolling 5-year window (currentYear-4..currentYear) when no years
// param is given — an older import (e.g. 2018) saves fine but is otherwise never visible on any
// screen, since nothing ever asks for it. This picker lets an admin explicitly widen the range.
function finLoadChurchMultiYear(explicitYears) {
  var el = document.getElementById('fin-church-multiyear-view');
  if (!el) return;
  el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">Loading…</p>';
  var url = '/admin/api/finance/church/multi-year' + (explicitYears ? '?years=' + explicitYears.join(',') : '');
  api(url).then(function(d) {
    _finChurchMultiYearData = d;
    finRenderChurchMultiYear(d);
    // The This Year view's five-year net-income chart is built from this same payload — re-render
    // it so the chart appears once the data lands, rather than only after a tab switch.
    if (_finChurchThisYearData) finRenderChurchThisYear(_finChurchThisYearData);
  }).catch(function(err) {
    if (err && err.message === 'Unauthorized') return;
    el.innerHTML = '<p style="font-size:.85rem;color:var(--danger);">Could not load multi-year church data.</p>';
  });
}
function finChurchMultiYearLoadRange() {
  var fromEl = document.getElementById('fin-church-my-from');
  var toEl = document.getElementById('fin-church-my-to');
  var from = parseInt(fromEl && fromEl.value, 10);
  var to = parseInt(toEl && toEl.value, 10);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) { finToast('Enter a valid From/To year range.'); return; }
  if (to - from > 20) { finToast('Please request 20 years or fewer at a time.'); return; }
  var years = [];
  for (var y = from; y <= to; y++) years.push(y);
  finLoadChurchMultiYear(years);
}
// True when any year in the window carries a non-zero total for this P&L classification. Used to
// drop an always-empty section (Cost of Goods Sold, for a church with no sales) from the table and
// the CSV without ever hiding a real figure.
function finChurchMultiYearClassHasData(d, years, key) {
  return (years || []).some(function(y) {
    var c = d && d.byYear && d.byYear[y] && d.byYear[y].classificationTotals[key];
    return !!(c && c.actualCents);
  });
}
function finRenderChurchMultiYear(d) {
  var el = document.getElementById('fin-church-multiyear-view');
  if (!el) return;
  var years = d.years || [];
  var curYear = new Date().getFullYear();
  var rangeFrom = years.length ? years[0] : (curYear - 4);
  var rangeTo = years.length ? years[years.length - 1] : curYear;
  var rangePicker = '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;font-size:.8rem;">'
    + '<label>From <input type="number" id="fin-church-my-from" value="' + rangeFrom + '" style="width:80px;"></label>'
    + '<label>To <input type="number" id="fin-church-my-to" value="' + rangeTo + '" style="width:80px;"></label>'
    + '<button class="btn-secondary" style="padding:3px 10px;font-size:.78rem;" onclick="finChurchMultiYearLoadRange()">Load Range</button>'
    + '</div>';
  var anyData = years.some(function(y) { var s = d.byYear[y]; return s && Object.keys(s.classificationTotals).length; });
  if (!anyData) {
    el.innerHTML = rangePicker + '<p style="font-size:.85rem;color:var(--warm-gray);">No church data for this range. Connect QuickBooks in the Overview tab and click "Sync Now", or widen the year range above if you\'ve imported older data.</p>';
    return;
  }
  // Cost of Goods Sold is a QuickBooks section this church has never posted to — it read $0.00 in
  // every column, so the row was pure noise. It is hidden when empty rather than deleted: if a
  // COGS figure ever does exist, the row comes back and the columns still add up to Net Income.
  // (Same reasoning as FIN58's removal of the "Sales" hide rule — never hide a dollar that a
  // total on the same screen is still counting.)
  var rowsDef = [{ label: 'Total Revenue', key: 'Income' }, { label: 'Cost of Goods Sold', key: 'Cost of Goods Sold' }, { label: 'Total Expenses', key: 'Expenses' }]
    .filter(function(rd) {
      return rd.key !== 'Cost of Goods Sold' || finChurchMultiYearClassHasData(d, years, rd.key);
    });
  var theadCells = '<th style="text-align:left;padding:6px 8px;"></th>' + years.map(function(y) { return '<th style="text-align:right;padding:6px 8px;">' + y + '</th>'; }).join('');
  var bodyRows = rowsDef.map(function(rd) {
    var cells = years.map(function(y) {
      var c = (d.byYear[y].classificationTotals[rd.key]) || { actualCents: 0 };
      return '<td style="text-align:right;padding:5px 8px;">$' + finFmtMoney(c.actualCents / 100) + '</td>';
    }).join('');
    return '<tr><td style="padding:5px 8px;">' + rd.label + '</td>' + cells + '</tr>';
  }).join('');
  var netRow = '<tr style="font-weight:700;border-top:2px solid var(--navy);"><td style="padding:5px 8px;">Net Income</td>'
    + years.map(function(y) { return '<td style="text-align:right;padding:5px 8px;">$' + finFmtMoney(d.byYear[y].netIncome.actualCents / 100) + '</td>'; }).join('')
    + '</tr>';
  // Same negative-bar caveat as the This-Year-vs-Last-Year chart: a deficit year's Net Income
  // bar will render as a near-invisible sliver rather than dip below the axis. The table above
  // always shows the real signed number regardless.
  var chart = renderGroupedBarChart({
    chartH: 220,
    groups: years.map(function(y) { return { key: y, label: String(y) }; }),
    series: [
      { key: 'income', label: 'Revenue', color: '#2E7EA6' },
      { key: 'expenses', label: 'Expenses', color: '#C9973A' },
      { key: 'net', label: 'Net Income', color: '#5A9E6F' },
    ],
    value: function(y, s) {
      var yd = d.byYear[y];
      var cents = s === 'income' ? (yd.classificationTotals['Income'] || { actualCents: 0 }).actualCents
        : s === 'expenses' ? (yd.classificationTotals['Expenses'] || { actualCents: 0 }).actualCents
        : yd.netIncome.actualCents;
      return cents / 100;
    },
    tooltip: function(y, s, v) {
      var sLbl = s === 'income' ? 'Income' : s === 'expenses' ? 'Expenses' : 'Net Income';
      return y + ' ' + sLbl + ': $' + finFmtMoney(v);
    },
    barLabel: function(v) { return '$' + Math.round(v / 1000) + 'k'; },
  });
  var html = chart
    + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr>' + theadCells + '</tr></thead>'
    + '<tbody>' + bodyRows + netRow + '</tbody></table></div>';

  // Daycare tie-in lines — same "for reference, not part of QuickBooks totals" pattern already
  // shipped; year alignment is direct now (the years list here), no QBO column-title parsing needed.
  var agg = finAggregateDaycareByYear(_finDaycare);
  if (agg.years.length) {
    function tieRow(label, getter) {
      var cells = years.map(function(y) {
        var v = getter(String(y));
        return v == null ? '<td style="text-align:right;padding:5px 8px;color:var(--warm-gray);">—</td>' : '<td style="text-align:right;padding:5px 8px;">$' + finFmtMoney(v) + '</td>';
      }).join('');
      return '<tr><td style="padding:5px 8px;padding-left:26px;font-style:italic;color:var(--warm-gray);">' + label + '</td>' + cells + '</tr>';
    }
    html += '<h4 style="margin:20px 0 8px;font-family:var(--font-head);color:var(--steel-anchor);font-size:.9rem;">Daycare (MDO) — for reference, not part of QuickBooks totals above</h4>'
      + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
      + '<tbody>'
      + tieRow('Daycare Tuition Income', function(y) { return agg.byYear[y] ? agg.byYear[y].incomeActual : null; })
      + tieRow('Daycare Payroll (Wages)', function(y) { var b = agg.byYear[y]; return (b && b.categories['Payroll']) ? b.categories['Payroll'].actual : null; })
      + tieRow('Daycare Total Expenses', function(y) { return agg.byYear[y] ? agg.byYear[y].expenseActual : null; })
      + '</tbody></table></div>';
  }
  el.innerHTML = rangePicker + html;
}
// ── Balance Sheet view (point-in-time Assets/Liabilities/Equity) ────────────────────────────
// A structurally different report from This Year/Multi-Year (no actual-vs-budget split, no
// period — a single as-of-date snapshot), so it gets its own small tree-builder rather than
// forcing finBuildTreeFromFlatRows() (which is tightly coupled to own_actual_cents/
// own_budget_cents) to also handle own_balance_cents.
function finBuildBalanceTreeFromFlatRows(rows) {
  var nodeByPath = {};
  var roots = [];
  (rows || []).forEach(function(r) {
    nodeByPath[r.category_path] = {
      path: r.category_path, label: r.account_name, classification: r.classification, depth: r.depth,
      ownBalanceCents: r.own_balance_cents || 0, totalBalanceCents: 0, children: [],
    };
  });
  (rows || []).forEach(function(r) {
    var node = nodeByPath[r.category_path];
    var segments = r.category_path.split(':');
    var parent = null;
    for (var i = segments.length - 1; i > 0; i--) {
      var candidate = nodeByPath[segments.slice(0, i).join(':')];
      if (candidate) { parent = candidate; break; }
    }
    if (parent) parent.children.push(node); else roots.push(node);
  });
  function computeTotals(node) {
    var total = node.ownBalanceCents;
    node.children.forEach(function(c) { computeTotals(c); total += c.totalBalanceCents; });
    node.totalBalanceCents = total;
  }
  roots.forEach(computeTotals);
  return roots;
}
function finRenderBalanceTreeRows(nodes, html) {
  html = html || [];
  (nodes || []).forEach(function(node) {
    var bold = node.children.length > 0;
    html.push('<tr' + (bold ? ' style="font-weight:600;"' : '') + '>'
      + '<td style="padding:5px 8px 5px ' + (10 + node.depth * 16) + 'px;">' + esc(node.label) + '</td>'
      + '<td style="text-align:right;padding:5px 8px;">$' + finFmtMoney(node.totalBalanceCents / 100) + '</td>'
      + '</tr>');
    finRenderBalanceTreeRows(node.children, html);
  });
  return html;
}
// The snapshot year and the trend window are both explicit state, not fixed to "now": a church
// uploading several years of history needs to look at a past year's balance sheet, and the
// server's default trend window is only the rolling last five years — an older import (2019, say)
// saves fine but would otherwise never appear on any screen. Same reasoning, and same From/To
// control, as the Multi-Year income view's range picker.
var _finChurchBalanceYear = null;
var _finChurchBalanceYears = null;
function finLoadChurchBalances(year, explicitYears) {
  year = year || _finChurchBalanceYear || new Date().getFullYear();
  _finChurchBalanceYear = year;
  if (explicitYears) _finChurchBalanceYears = explicitYears;
  var el = document.getElementById('fin-church-balances-view');
  if (!el) return;
  el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">Loading…</p>';
  Promise.all([
    api('/admin/api/finance/church/balances?year=' + year),
    api('/admin/api/finance/church/balances/multi-year' + (_finChurchBalanceYears ? '?years=' + _finChurchBalanceYears.join(',') : '')),
  ]).then(function(results) {
    _finChurchBalancesData = results[0];
    _finChurchBalancesMultiYearData = results[1];
    finRenderChurchBalances(_finChurchBalancesData, _finChurchBalancesMultiYearData);
  }).catch(function(err) {
    if (err && err.message === 'Unauthorized') return;
    el.innerHTML = '<p style="font-size:.85rem;color:var(--danger);">Could not load balance sheet data.</p>';
  });
}
// Assets/Liabilities/Equity across every year with an imported balance sheet, so a board can see
// the trend rather than only a single point-in-time snapshot. Same negative-bar caveat as the
// Income Statement multi-year chart this is modeled on — not a concern in practice here, since a
// real balance sheet's classification totals are essentially never negative.
function finRenderBalanceMultiYearChart(multiYear) {
  if (!multiYear || !multiYear.years || !multiYear.years.length) return '';
  var years = multiYear.years;
  var anyData = years.some(function(y) { var s = multiYear.byYear[y]; return s && (s.assetsCents || s.liabilitiesCents || s.equityCents); });
  if (!anyData) return '';
  var chart = renderGroupedBarChart({
    chartH: 200,
    groups: years.map(function(y) { return { key: y, label: String(y) }; }),
    series: [
      { key: 'assets', label: 'Assets', color: '#2E7EA6' },
      { key: 'liabilities', label: 'Liabilities', color: '#C9973A' },
      { key: 'equity', label: 'Equity', color: '#5A9E6F' },
    ],
    value: function(y, s) {
      var yd = multiYear.byYear[y] || {};
      var cents = s === 'assets' ? (yd.assetsCents || 0) : s === 'liabilities' ? (yd.liabilitiesCents || 0) : (yd.equityCents || 0);
      return cents / 100;
    },
    tooltip: function(y, s, v) {
      var sLbl = s === 'assets' ? 'Assets' : s === 'liabilities' ? 'Liabilities' : 'Equity';
      return sLbl + ' ' + y + ': $' + finFmtMoney(v);
    },
    barLabel: function(v) { return '$' + Math.round(v / 1000) + 'k'; },
  });
  return '<div style="margin-bottom:18px;"><h4 style="margin:0 0 8px;font-family:var(--font-head);color:var(--steel-anchor);font-size:.9rem;">Multi-Year Trend</h4>' + chart + '</div>';
}
// ── Net Assets — Donor-Restricted vs. Without Donor Restrictions ────────────────────────────
// Per Timothy_Equity_Reclassification_Spec.md: replaces QuickBooks' four-way equity split with
// the real post-ASU-2016-14 two-bucket model, computed bottom-up from real account balances
// server-side (computeEquityReclassification, api-finance.js) — never from the legacy 31000/
// 31500/32000/33000 lines directly, since those have drifted from reality (32000 has been frozen
// at exactly $223,828.47 every year since 2019 despite the underlying endowments moving with the
// market). This card is what actually surfaces that calculation; "unclassified" accounts are
// listed for manual review rather than silently defaulted into either bucket.
// Per the spec: 2025's real export was run on Accrual basis while every other year on file is
// Cash — flag distinctly rather than silently treating an Accrual-basis import as comparable to
// Cash-basis periods elsewhere in Church Report.
function finBasisWarningHtml(basis) {
  if (basis !== 'Accrual') return '';
  return '<div style="padding:8px 12px;background:var(--chip-warn-bg);border-radius:8px;margin-bottom:12px;font-size:.78rem;color:var(--deep-amber);">'
    + '⚠ This file is <b>Accrual basis</b> — other years on file may be Cash basis. Figures here are not directly comparable to a Cash-basis period.</div>';
}
function finRenderEquityReclassCard(equityReclass) {
  if (!equityReclass) return '';
  var b = equityReclass.breakdown;
  var bucketRows = ['perpetual', 'purpose_time', 'designated'].map(function(k) {
    var it = b[k];
    if (!it || !it.cents) return '';
    return '<tr><td style="padding:4px 8px;color:var(--warm-gray);">' + esc(it.label) + '</td>'
      + '<td style="padding:4px 8px;text-align:right;">$' + finFmtMoney(it.cents / 100) + '</td></tr>';
  }).join('');
  var unclassifiedHtml = '';
  if (equityReclass.unclassified && equityReclass.unclassified.length) {
    var rows = equityReclass.unclassified.map(function(u) {
      return '<tr><td style="padding:3px 8px;">' + esc(u.account_name) + '</td>'
        + '<td style="padding:3px 8px;text-align:right;">$' + finFmtMoney(u.own_balance_cents / 100) + '</td></tr>';
    }).join('');
    unclassifiedHtml = '<div style="margin-top:10px;padding:10px 12px;background:var(--chip-warn-bg);border-radius:8px;">'
      + '<div style="font-size:.78rem;font-weight:600;color:var(--deep-amber);margin-bottom:4px;">⚠ ' + equityReclass.unclassified.length + ' account(s) need a Donor-Restricted classification decision</div>'
      + '<div style="font-size:.74rem;color:var(--warm-gray);margin-bottom:6px;">New or renamed accounts near the existing restricted-fund groups — not counted in either bucket below until reviewed and added to the classification table.</div>'
      + '<table style="width:100%;border-collapse:collapse;font-size:.76rem;"><tbody>' + rows + '</tbody></table></div>';
  }
  return '<div class="fin-card" style="margin-bottom:18px;">'
    + '<h4 style="margin:0 0 4px;font-family:var(--font-head);color:var(--steel-anchor);font-size:.9rem;">Net Assets — Donor-Restricted vs. Without Donor Restrictions</h4>'
    + '<p style="font-size:.74rem;color:var(--warm-gray);margin:0 0 10px;">Replaces QuickBooks’ four-way equity split; computed bottom-up from real fund/endowment balances, not the (drifted) legacy equity lines.</p>'
    + '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px;">'
    + '<div style="flex:1;min-width:200px;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:12px 14px;">'
    + '<div style="font-size:.7rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Donor-Restricted Net Assets</div>'
    + '<div style="font-size:1.3rem;font-weight:700;color:var(--color-teal);">$' + finFmtMoney(equityReclass.donorRestrictedCents / 100) + '</div></div>'
    + '<div style="flex:1;min-width:200px;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:12px 14px;">'
    + '<div style="font-size:.7rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Net Assets Without Donor Restrictions</div>'
    + '<div style="font-size:1.3rem;font-weight:700;color:var(--steel-anchor);">$' + finFmtMoney(equityReclass.unrestrictedCents / 100) + '</div></div>'
    + '</div>'
    + (bucketRows ? '<table style="width:100%;border-collapse:collapse;font-size:.78rem;margin-top:6px;"><tbody>' + bucketRows + '</tbody></table>' : '')
    + unclassifiedHtml
    + '</div>';
}
// Snapshot-year + trend-range controls. Rendered ABOVE the "nothing imported for this year" empty
// state as well as above real data — otherwise a year with no balance sheet is a dead end with no
// way back to a year that has one, which is the normal state while history is still being loaded.
function finRenderBalanceRangePicker(d, multiYear) {
  var curYear = new Date().getFullYear();
  var years = (multiYear && multiYear.years) || [];
  var rangeFrom = years.length ? years[0] : (curYear - 4);
  var rangeTo = years.length ? years[years.length - 1] : curYear;
  return '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:12px;font-size:.8rem;">'
    + '<label>Balance sheet for <input type="number" id="fin-church-bal-year" value="' + ((d && d.year) || curYear) + '" style="width:80px;"></label>'
    + '<button class="btn-secondary" style="padding:3px 10px;font-size:.78rem;" onclick="finChurchBalanceLoadYear()">Show Year</button>'
    + '<span style="color:var(--border);">|</span>'
    + '<label>Trend from <input type="number" id="fin-church-bal-from" value="' + rangeFrom + '" style="width:80px;"></label>'
    + '<label>to <input type="number" id="fin-church-bal-to" value="' + rangeTo + '" style="width:80px;"></label>'
    + '<button class="btn-secondary" style="padding:3px 10px;font-size:.78rem;" onclick="finChurchBalanceLoadRange()">Load Range</button>'
    + '</div>';
}
function finChurchBalanceLoadYear() {
  var el = document.getElementById('fin-church-bal-year');
  var year = parseInt(el && el.value, 10);
  if (!Number.isFinite(year)) { finToast('Enter a valid year.'); return; }
  finLoadChurchBalances(year);
}
function finChurchBalanceLoadRange() {
  var fromEl = document.getElementById('fin-church-bal-from');
  var toEl = document.getElementById('fin-church-bal-to');
  var from = parseInt(fromEl && fromEl.value, 10);
  var to = parseInt(toEl && toEl.value, 10);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) { finToast('Enter a valid From/To year range.'); return; }
  if (to - from > 20) { finToast('Please request 20 years or fewer at a time.'); return; }
  var years = [];
  for (var y = from; y <= to; y++) years.push(y);
  finLoadChurchBalances(null, years);
}
// ── Balance sheet ↔ P&L tie-out ─────────────────────────────────────────────────────────────
// Server-computed (computeBalanceVsPnlReconciliation, api-finance.js). Deliberately worded as a
// difference to explain rather than a failure — a cash-basis balance sheet next to an accrual
// P&L, or a prior-period adjustment booked to equity, produces a real difference that is not a
// bad import. The rows that CAN'T be checked are shown too, since "which year still needs
// uploading?" is the other question this table exists to answer.
function finBalanceReconStatusHtml(r) {
  if (r.status === 'ok') return '<span style="color:var(--sage);">✓ Matches</span>';
  if (r.status === 'off') return '<span style="color:var(--deep-amber);">Difference of $' + finFmtMoney(Math.abs(r.difference_cents) / 100) + '</span>';
  if (r.status === 'no_prior_balance') return '<span style="color:var(--warm-gray);">No ' + r.prior_year + ' balance sheet — upload it to check this year</span>';
  return '<span style="color:var(--warm-gray);">No income statement on file for ' + r.year + '</span>';
}
function finRenderBalanceReconciliation(multiYear) {
  var rec = multiYear && multiYear.reconciliation;
  if (!rec || !rec.rows || !rec.rows.length) return '';
  var money = function(c) { return c == null ? '—' : '$' + finFmtMoney(c / 100); };
  var body = rec.rows.map(function(r) {
    return '<tr><td style="padding:5px 8px;">' + r.year + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + money(r.prior_equity_cents) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + money(r.equity_cents) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + money(r.change_cents) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + money(r.net_income_cents) + '</td>'
      + '<td style="padding:5px 8px;">' + finBalanceReconStatusHtml(r) + '</td></tr>';
  }).join('');
  var th = function(label, right) {
    return '<th style="text-align:' + (right ? 'right' : 'left') + ';padding:8px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);">' + label + '</th>';
  };
  var summary = rec.checked
    ? rec.matched + ' of ' + rec.checked + ' year' + (rec.checked === 1 ? '' : 's') + ' tie out exactly.'
    : 'No year can be checked yet — a year needs both its own balance sheet and the one before it.';
  return '<div style="margin-bottom:18px;"><h4 style="margin:0 0 4px;font-family:var(--font-head);color:var(--steel-anchor);font-size:.9rem;">Balance Sheet vs. Income Statement</h4>'
    + '<p style="font-size:.74rem;color:var(--warm-gray);margin:0 0 8px;">The year\'s change in total equity should equal that year\'s net income. ' + esc(summary)
    + ' A difference is not automatically an error — a cash-basis balance sheet next to an accrual income statement, or an adjustment booked straight to equity, will show up here legitimately.</p>'
    + '<div class="fin-card" style="padding:0;overflow:hidden;overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;">'
    + '<thead><tr style="background:var(--warm-surface-header);">' + th('Year') + th('Opening Equity', true) + th('Closing Equity', true)
    + th('Change', true) + th('Net Income (P&amp;L)', true) + th('Check') + '</tr></thead>'
    + '<tbody>' + body + '</tbody></table></div></div>';
}
function finRenderChurchBalances(d, multiYear) {
  var el = document.getElementById('fin-church-balances-view');
  if (!el) return;
  var picker = finRenderBalanceRangePicker(d, multiYear);
  if (!d || !d.rows || !d.rows.length) {
    el.innerHTML = picker
      + '<p style="font-size:.85rem;color:var(--warm-gray);">No balance sheet imported yet for ' + ((d && d.year) || '') + '. Upload one from <b>Data &amp; Imports</b> (Balance Sheet, or Financial Position for a file covering several years), or pick another year above.</p>'
      + finRenderBalanceMultiYearChart(multiYear)
      + finRenderBalanceReconciliation(multiYear);
    return;
  }
  var s = d.summary;
  var offCents = s.balancedCents;
  var checkHtml = Math.abs(offCents) < 1
    ? '<span style="color:var(--sage);">✓ Balances (Assets = Liabilities + Equity)</span>'
    : '<span style="color:var(--danger);">⚠ Off by $' + finFmtMoney(Math.abs(offCents) / 100) + ' — check the import for a missing or misclassified account.</span>';
  var html = picker
    + '<div style="font-size:.78rem;color:var(--warm-gray);margin-bottom:12px;">As of ' + esc(d.asOfDate || d.year) + '</div>'
    + '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:12px;">'
    + '<div style="flex:1;min-width:170px;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:12px 14px;">'
    + '<div style="font-size:.7rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Assets</div>'
    + '<div style="font-size:1.3rem;font-weight:700;color:var(--steel-anchor);">$' + finFmtMoney(s.assetsCents / 100) + '</div></div>'
    + '<div style="flex:1;min-width:170px;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:12px 14px;">'
    + '<div style="font-size:.7rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Liabilities</div>'
    + '<div style="font-size:1.3rem;font-weight:700;color:var(--steel-anchor);">$' + finFmtMoney(s.liabilitiesCents / 100) + '</div></div>'
    + '<div style="flex:1;min-width:170px;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:12px 14px;">'
    + '<div style="font-size:.7rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Equity</div>'
    + '<div style="font-size:1.3rem;font-weight:700;color:var(--steel-anchor);">$' + finFmtMoney(s.equityCents / 100) + '</div></div>'
    + '</div>'
    + '<div style="font-size:.82rem;margin-bottom:18px;">' + checkHtml + '</div>';
  html += finRenderEquityReclassCard(d.equityReclass);
  var tree = finBuildBalanceTreeFromFlatRows(d.rows);
  var assetPie = finPieItemsFromTree(tree, 'Assets', 'totalBalanceCents');
  if (assetPie.length) {
    html += '<div style="margin-bottom:18px;"><h4 style="margin:0 0 8px;font-family:var(--font-head);color:var(--steel-anchor);font-size:.9rem;">Asset Composition</h4>' + renderPieChart(assetPie, 170) + '</div>';
  }
  html += finRenderBalanceMultiYearChart(multiYear);
  html += finRenderBalanceReconciliation(multiYear);
  html += finRenderEquityReclassMultiYearTable(multiYear);
  html += '<details open><summary style="font-size:.82rem;color:var(--warm-gray);cursor:pointer;">Full account detail</summary>'
    + '<div class="fin-card" style="padding:0;overflow:hidden;overflow-x:auto;margin-top:10px;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead><tr style="background:var(--warm-surface-header);"><th style="text-align:left;padding:8px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);">Account</th><th style="text-align:right;padding:8px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);">Balance</th></tr></thead>'
    + '<tbody>' + finRenderBalanceTreeRows(tree).join('') + '</tbody></table></div></details>';
  el.innerHTML = html;
}
// Year-by-year Donor-Restricted vs. Without Donor Restrictions, from the multi-year balances
// route's equityReclassByYear (one computeEquityReclassification() result per year with data).
function finRenderEquityReclassMultiYearTable(multiYear) {
  if (!multiYear || !multiYear.years || !multiYear.equityReclassByYear) return '';
  var rows = multiYear.years.filter(function(y) { return multiYear.equityReclassByYear[y]; }).map(function(y) {
    var er = multiYear.equityReclassByYear[y];
    return '<tr><td style="padding:4px 8px;">' + y + '</td>'
      + '<td style="padding:4px 8px;text-align:right;">$' + finFmtMoney(er.donorRestrictedCents / 100) + '</td>'
      + '<td style="padding:4px 8px;text-align:right;">$' + finFmtMoney(er.unrestrictedCents / 100) + '</td>'
      + '<td style="padding:4px 8px;text-align:right;">$' + finFmtMoney(er.totalEquityCents / 100) + '</td>'
      + (er.unclassified.length ? '<td style="padding:4px 8px;color:var(--deep-amber);font-size:.74rem;">⚠ ' + er.unclassified.length + ' unclassified</td>' : '<td></td>')
      + '</tr>';
  }).join('');
  if (!rows) return '';
  return '<div style="margin-bottom:18px;"><h4 style="margin:0 0 8px;font-family:var(--font-head);color:var(--steel-anchor);font-size:.9rem;">Net Assets by Year</h4>'
    + '<div class="fin-card" style="padding:0;overflow:hidden;overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;">'
    + '<thead><tr style="background:var(--warm-surface-header);"><th style="text-align:left;padding:8px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);">Year</th>'
    + '<th style="text-align:right;padding:8px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);">Donor-Restricted</th>'
    + '<th style="text-align:right;padding:8px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);">Without Restrictions</th>'
    + '<th style="text-align:right;padding:8px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);">Total Equity</th><th></th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div></div>';
}

// ── Balance Sheet import: preview-then-commit (same pattern as the Budget import below) ─────
var _finChurchBalanceImportPreview = null;
var _finChurchBalanceImportChecked = null;

function finOpenChurchBalanceImport() {
  _finChurchBalanceImportPreview = null;
  _finChurchBalanceImportChecked = null;
  var fileEl = document.getElementById('fin-church-balance-import-file');
  if (fileEl) fileEl.value = '';
  var statusEl = document.getElementById('fin-church-balance-import-status');
  if (statusEl) statusEl.textContent = '';
  var previewEl = document.getElementById('fin-church-balance-import-preview');
  if (previewEl) previewEl.innerHTML = '';
  var confirmBtn = document.getElementById('fin-church-balance-import-confirm-btn');
  if (confirmBtn) confirmBtn.style.display = 'none';
  openModal('fin-church-balance-import-modal');
}

function finChurchBalanceImportFileSelected(inputEl) {
  var file = inputEl.files && inputEl.files[0];
  if (!file) return;
  var statusEl = document.getElementById('fin-church-balance-import-status');
  var previewEl = document.getElementById('fin-church-balance-import-preview');
  var confirmBtn = document.getElementById('fin-church-balance-import-confirm-btn');
  statusEl.textContent = 'Reading file…';
  previewEl.innerHTML = '';
  confirmBtn.style.display = 'none';
  _finChurchBalanceImportPreview = null;
  var fd = new FormData();
  fd.append('file', file);
  fetch('/admin/api/finance/church/balances/import-preview', { method: 'POST', body: fd, credentials: 'include' })
    .then(function(r) {
      return r.json().then(function(d) {
        if (r.status === 401) { location.href = '/chms'; throw new Error('Unauthorized'); }
        if (!r.ok) throw new Error(d.error || 'Could not read this file.');
        return d;
      });
    })
    .then(function(d) {
      _finChurchBalanceImportPreview = d;
      _finChurchBalanceImportChecked = d.rows.map(function() { return true; });
      var summary = computeBalanceSheetPreviewSummary(d.rows);
      statusEl.textContent = 'Parsed "' + d.sheetName + '" — as of ' + d.asOfDate + ' (fiscal year ' + d.fiscalYear + '), ' + d.rows.length + ' account row(s).'
        + (d.skipped.length ? ' ' + d.skipped.length + ' line(s) not recognized as accounts (shown below).' : '')
        + ' Assets $' + finFmtMoney(summary.assetsCents / 100) + ' vs. Liabilities + Equity $' + finFmtMoney(summary.liabilitiesPlusEquityCents / 100) + '.';
      previewEl.innerHTML = finBasisWarningHtml(d.basis) + finRenderEquityReclassCard(d.equityReclass) + finChurchRenderBalanceImportPreview(d);
      confirmBtn.style.display = '';
    })
    .catch(function(err) {
      if (err.message !== 'Unauthorized') statusEl.textContent = 'Error: ' + err.message;
    });
}

// Small standalone summary (not computeBalanceSummary, which is a backend-only export) purely
// for the status line's Assets-vs-Liabilities+Equity sanity check before commit.
function computeBalanceSheetPreviewSummary(rows) {
  var byClass = {};
  rows.forEach(function(r) { byClass[r.classification] = (byClass[r.classification] || 0) + r.own_balance_cents; });
  var assets = byClass.Assets || 0, liabilities = byClass.Liabilities || 0, equity = byClass.Equity || 0;
  return { assetsCents: assets, liabilitiesPlusEquityCents: liabilities + equity };
}

function finChurchRenderBalanceImportPreview(d) {
  var rowsHtml = d.rows.map(function(r, i) {
    return '<tr>'
      + '<td style="padding:3px 6px;"><input type="checkbox" checked onchange="finChurchBalanceImportToggleRow(' + i + ',this.checked)"></td>'
      + '<td style="padding:3px 6px 3px ' + (8 + 14 * r.depth) + 'px;">' + esc(r.account_name) + '</td>'
      + '<td style="padding:3px 6px;color:var(--warm-gray);">' + esc(r.classification) + '</td>'
      + '<td style="padding:3px 6px;text-align:right;">$' + finFmtMoney(r.own_balance_cents / 100) + '</td>'
      + '</tr>';
  }).join('');
  var skippedHtml = d.skipped.length
    ? '<p style="font-size:.76rem;color:var(--warm-gray);margin-top:10px;">Ignored (not recognized as accounts): ' + d.skipped.map(esc).join('; ') + '</p>'
    : '';
  return '<div style="max-height:340px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">'
    + '<table style="width:100%;border-collapse:collapse;font-size:.78rem;">'
    + '<thead style="position:sticky;top:0;background:var(--white);"><tr style="border-bottom:1px solid var(--border);">'
    + '<th style="padding:4px 6px;"></th><th style="text-align:left;padding:4px 6px;">Account</th>'
    + '<th style="text-align:left;padding:4px 6px;">Classification</th><th style="text-align:right;padding:4px 6px;">Balance</th>'
    + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>'
    + skippedHtml;
}

function finChurchBalanceImportToggleRow(i, checked) {
  if (_finChurchBalanceImportChecked) _finChurchBalanceImportChecked[i] = checked;
}

function finChurchConfirmBalanceImport() {
  if (!_finChurchBalanceImportPreview) return;
  var rows = _finChurchBalanceImportPreview.rows.filter(function(r, i) { return _finChurchBalanceImportChecked[i]; });
  if (!rows.length) { alert('No rows selected.'); return; }
  var btn = document.getElementById('fin-church-balance-import-confirm-btn');
  btn.disabled = true;
  api('/admin/api/finance/church/balances/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fiscal_year: _finChurchBalanceImportPreview.fiscalYear, as_of_date: _finChurchBalanceImportPreview.asOfDate, rows: rows }),
  }).then(function(d) {
    btn.disabled = false;
    if (d && d.error) { finToast('Import failed: ' + d.error); return; }
    closeModal('fin-church-balance-import-modal');
    finToast('Imported ' + d.imported + ' account row(s) as of ' + _finChurchBalanceImportPreview.asOfDate + '.');
    _finChurchBalancesData = null;
    if (_finChurchMode === 'balances') finLoadChurchBalances();
    finRefreshImportStatus();
  }).catch(function(err) {
    btn.disabled = false;
    if (err && err.message !== 'Unauthorized') finToast('Import failed: ' + (err.message || 'Unknown error'));
  });
}

// ── Budget import: preview-then-commit (mirrors Tuition Aid's TAP10 pattern) ────────────────
// Parsing happens server-side (POST /finance/church/import-preview) rather than in the browser
// like Tuition Aid's importer, since the XLSX ZIP/inflate reader was ported to api-finance.js —
// the file is uploaded once for preview, reviewed with per-row checkboxes, then only the
// checked rows are sent to the commit endpoint as plain JSON (no re-upload of the file itself).
var _finChurchImportPreview = null;
var _finChurchMonthlyImportPreview = null;

// ── Drag-and-drop for every Church Report import modal's file input. Assigning a dropped
// DataTransfer's FileList straight onto the <input>'s .files is a standard, well-supported
// technique — then dispatching a real 'change' event reuses each input's existing onchange
// handler verbatim, so drag-and-drop and click-to-browse always run the exact same code path.
function finDropZoneOver(ev) {
  ev.preventDefault();
  if (ev.currentTarget && ev.currentTarget.classList) ev.currentTarget.classList.add('fin-dropzone-active');
}
function finDropZoneLeave(ev) {
  if (ev.currentTarget && ev.currentTarget.classList) ev.currentTarget.classList.remove('fin-dropzone-active');
}
function finDropZoneDrop(ev, inputId) {
  ev.preventDefault();
  if (ev.currentTarget && ev.currentTarget.classList) ev.currentTarget.classList.remove('fin-dropzone-active');
  var inputEl = document.getElementById(inputId);
  var files = ev.dataTransfer && ev.dataTransfer.files;
  if (!inputEl || !files || !files.length) return;
  inputEl.files = files;
  inputEl.dispatchEvent(new Event('change'));
}

function finOpenChurchImport() {
  _finChurchImportPreview = null;
  var fileEl = document.getElementById('fin-church-import-file');
  if (fileEl) fileEl.value = '';
  var statusEl = document.getElementById('fin-church-import-status');
  if (statusEl) statusEl.textContent = '';
  var previewEl = document.getElementById('fin-church-import-preview');
  if (previewEl) previewEl.innerHTML = '';
  var confirmBtn = document.getElementById('fin-church-import-confirm-btn');
  if (confirmBtn) confirmBtn.style.display = 'none';
  openModal('fin-church-import-modal');
}

// _finChurchImportPreview is an ARRAY, one entry per selected file: {fileName, fiscalYear, rows,
// skipped, checked, error}. A single-file selection is just a 1-element array — the render/
// confirm functions below never special-case "one file" vs. "many," so nothing changed for
// someone who still only ever picks one file at a time.
function finChurchImportFileSelected(inputEl) {
  var files = inputEl.files ? Array.prototype.slice.call(inputEl.files) : [];
  if (!files.length) return;
  var statusEl = document.getElementById('fin-church-import-status');
  var previewEl = document.getElementById('fin-church-import-preview');
  var confirmBtn = document.getElementById('fin-church-import-confirm-btn');
  previewEl.innerHTML = '';
  confirmBtn.style.display = 'none';
  _finChurchImportPreview = [];
  var results = [];
  // Sequential, not parallel — this is a bulk historical backfill, not a latency-sensitive
  // interaction, and sequential requests are simplest to reason about and gentlest on the Worker.
  function next(idx) {
    if (idx >= files.length) {
      _finChurchImportPreview = results;
      var okCount = results.filter(function(r) { return !r.error; }).length;
      statusEl.textContent = 'Parsed ' + okCount + ' of ' + files.length + ' file(s).' + (okCount < files.length ? ' See errors below.' : '');
      previewEl.innerHTML = finChurchRenderMultiImportPreview(results);
      if (okCount) confirmBtn.style.display = '';
      return;
    }
    var file = files[idx];
    statusEl.textContent = 'Reading file ' + (idx + 1) + ' of ' + files.length + ' (' + esc(file.name) + ')…';
    var fd = new FormData();
    fd.append('file', file);
    fetch('/admin/api/finance/church/import-preview', { method: 'POST', body: fd, credentials: 'include' })
      .then(function(r) {
        return r.json().then(function(d) {
          if (r.status === 401) { location.href = '/chms'; throw new Error('Unauthorized'); }
          if (!r.ok) throw new Error(d.error || 'Could not read this file.');
          return d;
        });
      })
      .then(function(d) {
        results.push({ fileName: file.name, fiscalYear: d.fiscalYear, sheetName: d.sheetName, rows: d.rows, skipped: d.skipped, checked: d.rows.map(function() { return true; }), error: null });
        next(idx + 1);
      })
      .catch(function(err) {
        if (err.message === 'Unauthorized') return;
        results.push({ fileName: file.name, fiscalYear: null, rows: [], skipped: [], checked: [], error: err.message });
        next(idx + 1);
      });
  }
  next(0);
}

function finChurchRenderMultiImportPreview(results) {
  return results.map(function(res, fi) {
    if (res.error) {
      return '<div style="border:1px solid var(--danger);border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:.8rem;">'
        + '<b>' + esc(res.fileName) + '</b> — <span style="color:var(--danger);">' + esc(res.error) + '</span></div>';
    }
    var rowsHtml = res.rows.map(function(r, i) {
      return '<tr>'
        + '<td style="padding:3px 6px;"><input type="checkbox" checked onchange="finChurchMultiImportToggleRow(' + fi + ',' + i + ',this.checked)"></td>'
        + '<td style="padding:3px 6px 3px ' + (8 + 14 * r.depth) + 'px;">' + esc(r.account_name) + '</td>'
        + '<td style="padding:3px 6px;color:var(--warm-gray);">' + esc(r.classification) + '</td>'
        + '<td style="padding:3px 6px;text-align:right;">$' + finFmtMoney(r.own_actual_cents / 100) + '</td>'
        + '<td style="padding:3px 6px;text-align:right;">$' + finFmtMoney(r.own_budget_cents / 100) + '</td>'
        + '</tr>';
    }).join('');
    var skippedHtml = res.skipped.length
      ? '<p style="font-size:.76rem;color:var(--warm-gray);margin-top:8px;">Ignored: ' + res.skipped.map(esc).join('; ') + '</p>'
      : '';
    return '<details style="margin-bottom:10px;border:1px solid var(--border);border-radius:8px;" open>'
      + '<summary style="cursor:pointer;padding:8px 10px;font-size:.82rem;font-weight:600;">' + esc(res.fileName) + ' — fiscal year ' + res.fiscalYear + ' (' + res.rows.length + ' row(s))</summary>'
      + '<div style="padding:0 10px 10px;">'
      + '<div style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;">'
      + '<table style="width:100%;border-collapse:collapse;font-size:.78rem;">'
      + '<thead style="position:sticky;top:0;background:var(--white);"><tr style="border-bottom:1px solid var(--border);">'
      + '<th style="padding:4px 6px;"></th><th style="text-align:left;padding:4px 6px;">Account</th>'
      + '<th style="text-align:left;padding:4px 6px;">Classification</th><th style="text-align:right;padding:4px 6px;">Actual</th>'
      + '<th style="text-align:right;padding:4px 6px;">Budget</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>'
      + skippedHtml + '</div></details>';
  }).join('');
}

function finChurchMultiImportToggleRow(fi, i, checked) {
  if (_finChurchImportPreview && _finChurchImportPreview[fi]) _finChurchImportPreview[fi].checked[i] = checked;
}

function finChurchConfirmImport() {
  if (!_finChurchImportPreview || !_finChurchImportPreview.length) return;
  var files = _finChurchImportPreview.filter(function(res) { return !res.error; });
  if (!files.length) { alert('No files parsed successfully.'); return; }
  var btn = document.getElementById('fin-church-import-confirm-btn');
  var statusEl = document.getElementById('fin-church-import-status');
  btn.disabled = true;
  var imported = [], failed = [];
  function next(idx) {
    if (idx >= files.length) {
      btn.disabled = false;
      var msg = 'Imported ' + imported.length + ' year(s): ' + imported.join(', ') + '.' + (failed.length ? ' Failed: ' + failed.join(', ') + '.' : '');
      finToast(msg);
      if (!failed.length) closeModal('fin-church-import-modal');
      finRenderChurchReport();
      finRefreshImportStatus();
      return;
    }
    var res = files[idx];
    var rows = res.rows.filter(function(r, i) { return res.checked[i]; });
    statusEl.textContent = 'Importing year ' + (idx + 1) + ' of ' + files.length + ' (fiscal year ' + res.fiscalYear + ')…';
    if (!rows.length) { next(idx + 1); return; }
    api('/admin/api/finance/church/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fiscal_year: res.fiscalYear, rows: rows }),
    }).then(function(d) {
      if (d && d.error) failed.push(res.fiscalYear + ' (' + d.error + ')');
      else imported.push(String(res.fiscalYear));
      next(idx + 1);
    }).catch(function(err) {
      if (err && err.message !== 'Unauthorized') failed.push(res.fiscalYear + ' (' + (err.message || 'error') + ')');
      next(idx + 1);
    });
  }
  next(0);
}

function finOpenChurchMonthlyImport() {
  _finChurchMonthlyImportPreview = null;
  var fileEl = document.getElementById('fin-church-monthly-import-file');
  if (fileEl) fileEl.value = '';
  var statusEl = document.getElementById('fin-church-monthly-import-status');
  if (statusEl) statusEl.textContent = '';
  var previewEl = document.getElementById('fin-church-monthly-import-preview');
  if (previewEl) previewEl.innerHTML = '';
  var confirmBtn = document.getElementById('fin-church-monthly-import-confirm-btn');
  if (confirmBtn) confirmBtn.style.display = 'none';
  openModal('fin-church-monthly-import-modal');
}

function finChurchMonthlyImportFileSelected(inputEl) {
  var file = inputEl.files && inputEl.files[0];
  if (!file) return;
  var statusEl = document.getElementById('fin-church-monthly-import-status');
  var previewEl = document.getElementById('fin-church-monthly-import-preview');
  var confirmBtn = document.getElementById('fin-church-monthly-import-confirm-btn');
  statusEl.textContent = 'Reading file…';
  previewEl.innerHTML = '';
  confirmBtn.style.display = 'none';
  _finChurchMonthlyImportPreview = null;
  var fd = new FormData();
  fd.append('file', file);
  fetch('/admin/api/finance/church/monthly-import-preview', { method: 'POST', body: fd, credentials: 'include' })
    .then(function(r) {
      return r.json().then(function(d) {
        if (r.status === 401) { location.href = '/chms'; throw new Error('Unauthorized'); }
        if (!r.ok) throw new Error(d.error || 'Could not read this file.');
        return d;
      });
    })
    .then(function(d) {
      _finChurchMonthlyImportPreview = d;
      // Reads the multi-year shape ({years, monthsByYear}); the single fiscalYear/months pair this
      // used to read no longer exists, since one file may span many years.
      var pYears = d.years || [];
      var pMonths = pYears.reduce(function(n, y) { return n + ((d.monthsByYear || {})[y] || []).length; }, 0);
      var pSpan = pYears.length
        ? ' (' + pYears[0] + (pYears.length > 1 ? ' to ' + pYears[pYears.length - 1] : '') + ')'
        : '';
      statusEl.textContent = 'Parsed "' + d.sheetName + '" — ' + pYears.length + ' year'
        + (pYears.length === 1 ? '' : 's') + pSpan + ', ' + pMonths + ' month(s), '
        + ((d.rows || []).length) + ' account/month row(s).'
        + ((d.skipped || []).length ? ' ' + d.skipped.length + ' line(s) not recognized as accounts (shown below).' : '');
      previewEl.innerHTML = finChurchRenderMonthlyImportPreview(d);
      confirmBtn.style.display = '';
    })
    .catch(function(err) {
      if (err.message !== 'Unauthorized') statusEl.textContent = 'Error: ' + err.message;
    });
}

var FIN_MONTH_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// One file can span many years, so the detail table switches shape: a single-year file still shows
// one column per month (the original view, and the most useful check for a 12-column file), while a
// multi-year file shows one column per YEAR holding that year's total, because 91 month columns is
// not a table anyone can verify by eye. The per-year summary above it is what confirms coverage.
function finChurchRenderMonthlyImportPreview(d) {
  var years = d.years || [];
  var multi = years.length > 1;
  var byPath = {}, order = [];
  d.rows.forEach(function(r) {
    if (!byPath[r.category_path]) { byPath[r.category_path] = { row: r, cells: {} }; order.push(r.category_path); }
    var key = multi ? r.fiscal_year : r.period_month;
    var cur = byPath[r.category_path].cells[key];
    // Summing (rather than assigning) is what turns 12 monthly figures into a year total; for the
    // single-year view each (path, month) appears once, so the sum is that one value.
    byPath[r.category_path].cells[key] = (cur == null ? 0 : cur) + (r.own_actual_cents || 0);
  });

  var firstYear = years[0], lastYear = years[years.length - 1];
  var firstMonths = d.monthsByYear[firstYear] || [], lastMonths = d.monthsByYear[lastYear] || [];
  var span = years.length
    ? FIN_MONTH_ABBR[firstMonths[0]] + ' ' + firstYear + ' to ' + FIN_MONTH_ABBR[lastMonths[lastMonths.length - 1]] + ' ' + lastYear
    : '';
  var summary = '<p style="font-size:.82rem;margin:0 0 10px;"><strong>' + years.length + ' year' + (multi ? 's' : '')
    + '</strong> &middot; ' + esc(span) + ' &middot; ' + order.length + ' accounts &middot; '
    + d.rows.length.toLocaleString() + ' rows</p>';

  var yearSummary = '';
  if (multi) {
    yearSummary = '<div style="max-height:150px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:10px;">'
      + '<table style="width:100%;border-collapse:collapse;font-size:.78rem;">'
      + '<thead style="position:sticky;top:0;background:var(--white);"><tr style="border-bottom:1px solid var(--border);">'
      + '<th style="text-align:left;padding:4px 6px;">Year</th><th style="text-align:left;padding:4px 6px;">Months in file</th>'
      + '<th style="text-align:right;padding:4px 6px;">Rows</th></tr></thead><tbody>'
      + years.map(function(y) {
          var ms = (d.monthsByYear[y] || []).slice().sort(function(a, b) { return a - b; });
          var label = ms.length === 12 ? 'all 12' : ms.map(function(m) { return FIN_MONTH_ABBR[m]; }).join(', ');
          return '<tr><td style="padding:3px 6px;">' + y + '</td>'
            + '<td style="padding:3px 6px;color:var(--warm-gray);">' + esc(label) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;">' + (order.length * ms.length).toLocaleString() + '</td></tr>';
        }).join('')
      + '</tbody></table></div>';
  }

  var cols = multi ? years : (d.monthsByYear[firstYear] || []).slice().sort(function(a, b) { return a - b; });
  var colHeaders = cols.map(function(c) {
    return '<th style="text-align:right;padding:4px 6px;">' + (multi ? c : FIN_MONTH_ABBR[c]) + '</th>';
  }).join('');
  var rowsHtml = order.map(function(path) {
    var entry = byPath[path];
    var cells = cols.map(function(c) {
      var v = entry.cells[c];
      return '<td style="padding:3px 6px;text-align:right;">' + (v == null ? '' : '$' + finFmtMoney(v / 100)) + '</td>';
    }).join('');
    return '<tr>'
      + '<td style="padding:3px 6px 3px ' + (8 + 14 * entry.row.depth) + 'px;">' + esc(entry.row.account_name) + '</td>'
      + '<td style="padding:3px 6px;color:var(--warm-gray);">' + esc(entry.row.classification) + '</td>'
      + cells + '</tr>';
  }).join('');
  var skippedHtml = d.skipped.length
    ? '<p style="font-size:.76rem;color:var(--warm-gray);margin-top:10px;">Ignored (not recognized as accounts): ' + d.skipped.map(esc).join('; ') + '</p>'
    : '';
  return summary + yearSummary
    + (multi ? '<p style="font-size:.76rem;color:var(--warm-gray);margin:0 0 6px;">Each column below is that year&#39;s total across its months. The monthly detail is imported in full.</p>' : '')
    + '<div style="max-height:340px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">'
    + '<table style="width:100%;border-collapse:collapse;font-size:.78rem;">'
    + '<thead style="position:sticky;top:0;background:var(--white);"><tr style="border-bottom:1px solid var(--border);">'
    + '<th style="text-align:left;padding:4px 6px;">Account</th><th style="text-align:left;padding:4px 6px;">Classification</th>'
    + colHeaders + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>'
    + skippedHtml;
}

// Commits ONE YEAR PER REQUEST, sequentially. A full multi-year file is ~17,000 rows; sending it
// as one request would be a multi-megabyte body and a single long write, with no progress and
// nothing salvaged if it timed out. Year-at-a-time keeps each request the size of the
// single-year import that was already proven, and each year that lands stays landed.
function finChurchConfirmMonthlyImport() {
  if (!_finChurchMonthlyImportPreview) return;
  var d = _finChurchMonthlyImportPreview;
  var btn = document.getElementById('fin-church-monthly-import-confirm-btn');
  var statusEl = document.getElementById('fin-church-monthly-import-status');
  var years = (d.years || []).slice().sort(function(a, b) { return a - b; });
  if (!years.length) { finToast('Nothing to import.'); return; }
  var rowsByYear = {};
  d.rows.forEach(function(r) {
    if (!rowsByYear[r.fiscal_year]) rowsByYear[r.fiscal_year] = [];
    rowsByYear[r.fiscal_year].push(r);
  });
  btn.disabled = true;
  var imported = 0, doneYears = [], idx = 0;

  function step() {
    if (idx >= years.length) return Promise.resolve();
    var y = years[idx];
    if (statusEl) statusEl.textContent = 'Importing ' + y + ' (' + (idx + 1) + ' of ' + years.length + ')...';
    return api('/admin/api/finance/church/monthly-import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: rowsByYear[y] }),
    }).then(function(res) {
      if (res && res.error) throw new Error(res.error);
      imported += (res && res.imported) || 0;
      doneYears.push(y);
      idx++;
      return step();
    });
  }

  step().then(function() {
    btn.disabled = false;
    if (statusEl) statusEl.textContent = '';
    closeModal('fin-church-monthly-import-modal');
    finToast('Imported ' + imported.toLocaleString() + ' monthly rows across ' + doneYears.length
      + ' year' + (doneYears.length === 1 ? '' : 's') + ' (' + doneYears[0]
      + (doneYears.length > 1 ? '-' + doneYears[doneYears.length - 1] : '') + ').');
    finRenderChurchReport();
    finRefreshImportStatus();
    finLoadHealth();
  }).catch(function(err) {
    btn.disabled = false;
    if (err && err.message === 'Unauthorized') return;
    // Years already committed are not rolled back, so say which ones landed rather than implying
    // the whole file failed.
    var partial = doneYears.length ? ' Imported ' + doneYears.join(', ') + ' before failing; re-run to finish.' : '';
    if (statusEl) statusEl.textContent = '';
    finToast('Import failed on ' + years[idx] + ': ' + ((err && err.message) || 'Unknown error') + '.' + partial);
  });
}

// ── Church Report: "Statement of Activity" multi-year import (one file, one column per year,
// Actual only) — same preview-then-commit-all shape as the Monthly P&L import above, just
// pivoted by year instead of by month, and using fiscal_year on each row instead of period_month.
var _finChurchActivityImportPreview = null;
function finOpenChurchActivityImport() {
  _finChurchActivityImportPreview = null;
  var fileEl = document.getElementById('fin-church-activity-import-file');
  if (fileEl) fileEl.value = '';
  var statusEl = document.getElementById('fin-church-activity-import-status');
  if (statusEl) statusEl.textContent = '';
  var previewEl = document.getElementById('fin-church-activity-import-preview');
  if (previewEl) previewEl.innerHTML = '';
  var confirmBtn = document.getElementById('fin-church-activity-import-confirm-btn');
  if (confirmBtn) confirmBtn.style.display = 'none';
  openModal('fin-church-activity-import-modal');
}
function finChurchActivityImportFileSelected(inputEl) {
  var file = inputEl.files && inputEl.files[0];
  if (!file) return;
  var statusEl = document.getElementById('fin-church-activity-import-status');
  var previewEl = document.getElementById('fin-church-activity-import-preview');
  var confirmBtn = document.getElementById('fin-church-activity-import-confirm-btn');
  statusEl.textContent = 'Reading file…';
  previewEl.innerHTML = '';
  confirmBtn.style.display = 'none';
  _finChurchActivityImportPreview = null;
  var fd = new FormData();
  fd.append('file', file);
  fetch('/admin/api/finance/church/activity-import-preview', { method: 'POST', body: fd, credentials: 'include' })
    .then(function(r) {
      return r.json().then(function(d) {
        if (r.status === 401) { location.href = '/chms'; throw new Error('Unauthorized'); }
        if (!r.ok) throw new Error(d.error || 'Could not read this file.');
        return d;
      });
    })
    .then(function(d) {
      _finChurchActivityImportPreview = d;
      statusEl.textContent = 'Parsed "' + d.sheetName + '" — ' + d.years.length + ' year(s) (' + d.years.join(', ') + '), ' + d.rows.length + ' account/year row(s).'
        + (d.skipped.length ? ' ' + d.skipped.length + ' line(s) not recognized as accounts (shown below).' : '');
      previewEl.innerHTML = finChurchRenderActivityImportPreview(d);
      confirmBtn.style.display = '';
    })
    .catch(function(err) {
      if (err.message !== 'Unauthorized') statusEl.textContent = 'Error: ' + err.message;
    });
}
function finChurchRenderActivityImportPreview(d) {
  var byPath = {};
  var order = [];
  d.rows.forEach(function(r) {
    if (!byPath[r.category_path]) { byPath[r.category_path] = { row: r, years: {} }; order.push(r.category_path); }
    byPath[r.category_path].years[r.fiscal_year] = r.own_actual_cents;
  });
  var yearHeaders = d.years.map(function(y) { return '<th style="text-align:right;padding:4px 6px;">' + y + '</th>'; }).join('');
  var rowsHtml = order.map(function(path) {
    var entry = byPath[path];
    var cells = d.years.map(function(y) {
      var v = entry.years[y];
      return '<td style="padding:3px 6px;text-align:right;">' + (v == null ? '' : '$' + finFmtMoney(v / 100)) + '</td>';
    }).join('');
    return '<tr>'
      + '<td style="padding:3px 6px 3px ' + (8 + 14 * entry.row.depth) + 'px;">' + esc(entry.row.account_name) + '</td>'
      + '<td style="padding:3px 6px;color:var(--warm-gray);">' + esc(entry.row.classification) + '</td>'
      + cells + '</tr>';
  }).join('');
  var skippedHtml = d.skipped.length
    ? '<p style="font-size:.76rem;color:var(--warm-gray);margin-top:10px;">Ignored (not recognized as accounts): ' + d.skipped.map(esc).join('; ') + '</p>'
    : '';
  return '<div style="max-height:340px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">'
    + '<table style="width:100%;border-collapse:collapse;font-size:.78rem;">'
    + '<thead style="position:sticky;top:0;background:var(--white);"><tr style="border-bottom:1px solid var(--border);">'
    + '<th style="text-align:left;padding:4px 6px;">Account</th><th style="text-align:left;padding:4px 6px;">Classification</th>'
    + yearHeaders + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>'
    + skippedHtml;
}
function finChurchConfirmActivityImport() {
  if (!_finChurchActivityImportPreview) return;
  var btn = document.getElementById('fin-church-activity-import-confirm-btn');
  btn.disabled = true;
  api('/admin/api/finance/church/activity-import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ years: _finChurchActivityImportPreview.years, rows: _finChurchActivityImportPreview.rows }),
  }).then(function(d) {
    btn.disabled = false;
    if (d && d.error) { finToast('Import failed: ' + d.error); return; }
    closeModal('fin-church-activity-import-modal');
    finToast('Imported ' + d.imported + ' row(s) across ' + d.years.length + ' year(s).');
    finRenderChurchReport();
    finRefreshImportStatus();
  }).catch(function(err) {
    btn.disabled = false;
    if (err && err.message !== 'Unauthorized') finToast('Import failed: ' + (err.message || 'Unknown error'));
  });
}

// ── Church Report: "Budget by Year" multi-year import (one file, one column per year, Budget
// only — the real QuickBooks export splits Actual and Budget into two separate multi-year
// files, unlike the single-year Budget vs. Actuals import above). Same shape as the Statement
// of Activity import above, just populating own_budget_cents instead of own_actual_cents; the
// two merge together in finance_church_entries (field-preserving upsert on the server) so
// uploading both for the same year fills in both figures rather than one clobbering the other.
var _finChurchBudgetMultiYearImportPreview = null;
function finOpenChurchBudgetMultiYearImport() {
  _finChurchBudgetMultiYearImportPreview = null;
  var fileEl = document.getElementById('fin-church-budget-multi-import-file');
  if (fileEl) fileEl.value = '';
  var statusEl = document.getElementById('fin-church-budget-multi-import-status');
  if (statusEl) statusEl.textContent = '';
  var previewEl = document.getElementById('fin-church-budget-multi-import-preview');
  if (previewEl) previewEl.innerHTML = '';
  var confirmBtn = document.getElementById('fin-church-budget-multi-import-confirm-btn');
  if (confirmBtn) confirmBtn.style.display = 'none';
  openModal('fin-church-budget-multi-import-modal');
}
function finChurchBudgetMultiYearImportFileSelected(inputEl) {
  var file = inputEl.files && inputEl.files[0];
  if (!file) return;
  var statusEl = document.getElementById('fin-church-budget-multi-import-status');
  var previewEl = document.getElementById('fin-church-budget-multi-import-preview');
  var confirmBtn = document.getElementById('fin-church-budget-multi-import-confirm-btn');
  statusEl.textContent = 'Reading file…';
  previewEl.innerHTML = '';
  confirmBtn.style.display = 'none';
  _finChurchBudgetMultiYearImportPreview = null;
  var fd = new FormData();
  fd.append('file', file);
  fetch('/admin/api/finance/church/budget-multi-year-import-preview', { method: 'POST', body: fd, credentials: 'include' })
    .then(function(r) {
      return r.json().then(function(d) {
        if (r.status === 401) { location.href = '/chms'; throw new Error('Unauthorized'); }
        if (!r.ok) throw new Error(d.error || 'Could not read this file.');
        return d;
      });
    })
    .then(function(d) {
      _finChurchBudgetMultiYearImportPreview = d;
      statusEl.textContent = 'Parsed "' + d.sheetName + '" — ' + d.years.length + ' year(s) (' + d.years.join(', ') + '), ' + d.rows.length + ' account/year row(s).'
        + (d.skipped.length ? ' ' + d.skipped.length + ' line(s) not recognized as accounts (shown below).' : '');
      previewEl.innerHTML = finChurchRenderBudgetMultiYearImportPreview(d);
      confirmBtn.style.display = '';
    })
    .catch(function(err) {
      if (err.message !== 'Unauthorized') statusEl.textContent = 'Error: ' + err.message;
    });
}
function finChurchRenderBudgetMultiYearImportPreview(d) {
  var byPath = {};
  var order = [];
  d.rows.forEach(function(r) {
    if (!byPath[r.category_path]) { byPath[r.category_path] = { row: r, years: {} }; order.push(r.category_path); }
    byPath[r.category_path].years[r.fiscal_year] = r.own_budget_cents;
  });
  var yearHeaders = d.years.map(function(y) { return '<th style="text-align:right;padding:4px 6px;">' + y + '</th>'; }).join('');
  var rowsHtml = order.map(function(path) {
    var entry = byPath[path];
    var cells = d.years.map(function(y) {
      var v = entry.years[y];
      return '<td style="padding:3px 6px;text-align:right;">' + (v == null ? '' : '$' + finFmtMoney(v / 100)) + '</td>';
    }).join('');
    return '<tr>'
      + '<td style="padding:3px 6px 3px ' + (8 + 14 * entry.row.depth) + 'px;">' + esc(entry.row.account_name) + '</td>'
      + '<td style="padding:3px 6px;color:var(--warm-gray);">' + esc(entry.row.classification) + '</td>'
      + cells + '</tr>';
  }).join('');
  var skippedHtml = d.skipped.length
    ? '<p style="font-size:.76rem;color:var(--warm-gray);margin-top:10px;">Ignored (not recognized as accounts): ' + d.skipped.map(esc).join('; ') + '</p>'
    : '';
  return '<div style="max-height:340px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">'
    + '<table style="width:100%;border-collapse:collapse;font-size:.78rem;">'
    + '<thead style="position:sticky;top:0;background:var(--white);"><tr style="border-bottom:1px solid var(--border);">'
    + '<th style="text-align:left;padding:4px 6px;">Account</th><th style="text-align:left;padding:4px 6px;">Classification</th>'
    + yearHeaders + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>'
    + skippedHtml;
}
function finChurchConfirmBudgetMultiYearImport() {
  if (!_finChurchBudgetMultiYearImportPreview) return;
  var btn = document.getElementById('fin-church-budget-multi-import-confirm-btn');
  btn.disabled = true;
  api('/admin/api/finance/church/budget-multi-year-import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ years: _finChurchBudgetMultiYearImportPreview.years, rows: _finChurchBudgetMultiYearImportPreview.rows }),
  }).then(function(d) {
    btn.disabled = false;
    if (d && d.error) { finToast('Import failed: ' + d.error); return; }
    closeModal('fin-church-budget-multi-import-modal');
    finToast('Imported ' + d.imported + ' row(s) across ' + d.years.length + ' year(s).');
    finRenderChurchReport();
    finRefreshImportStatus();
  }).catch(function(err) {
    btn.disabled = false;
    if (err && err.message !== 'Unauthorized') finToast('Import failed: ' + (err.message || 'Unknown error'));
  });
}

// ── Church Report: "Statement of Financial Position" multi-year import (Balance Sheet, one
// column per year) — same shape as the Statement of Activity import above, but for
// Assets/Liabilities/Equity balances instead of Income/Expenses.
var _finChurchBalanceMultiImportPreview = null;
function finOpenChurchBalanceMultiYearImport() {
  _finChurchBalanceMultiImportPreview = null;
  var fileEl = document.getElementById('fin-church-balance-multi-import-file');
  if (fileEl) fileEl.value = '';
  var statusEl = document.getElementById('fin-church-balance-multi-import-status');
  if (statusEl) statusEl.textContent = '';
  var previewEl = document.getElementById('fin-church-balance-multi-import-preview');
  if (previewEl) previewEl.innerHTML = '';
  var confirmBtn = document.getElementById('fin-church-balance-multi-import-confirm-btn');
  if (confirmBtn) confirmBtn.style.display = 'none';
  openModal('fin-church-balance-multi-import-modal');
}
function finChurchBalanceMultiImportFileSelected(inputEl) {
  var file = inputEl.files && inputEl.files[0];
  if (!file) return;
  var statusEl = document.getElementById('fin-church-balance-multi-import-status');
  var previewEl = document.getElementById('fin-church-balance-multi-import-preview');
  var confirmBtn = document.getElementById('fin-church-balance-multi-import-confirm-btn');
  statusEl.textContent = 'Reading file…';
  previewEl.innerHTML = '';
  confirmBtn.style.display = 'none';
  _finChurchBalanceMultiImportPreview = null;
  var fd = new FormData();
  fd.append('file', file);
  fetch('/admin/api/finance/church/balances/multi-year-import-preview', { method: 'POST', body: fd, credentials: 'include' })
    .then(function(r) {
      return r.json().then(function(d) {
        if (r.status === 401) { location.href = '/chms'; throw new Error('Unauthorized'); }
        if (!r.ok) throw new Error(d.error || 'Could not read this file.');
        return d;
      });
    })
    .then(function(d) {
      _finChurchBalanceMultiImportPreview = d;
      statusEl.textContent = 'Parsed "' + d.sheetName + '" — ' + d.years.length + ' year(s) (' + d.years.join(', ') + '), ' + d.rows.length + ' account/year row(s).'
        + (d.skipped.length ? ' ' + d.skipped.length + ' line(s) not recognized as accounts (shown below).' : '');
      previewEl.innerHTML = finBasisWarningHtml(d.basis) + finRenderEquityReclassMultiYearPreview(d) + finChurchRenderBalanceMultiImportPreview(d);
      confirmBtn.style.display = '';
    })
    .catch(function(err) {
      if (err.message !== 'Unauthorized') statusEl.textContent = 'Error: ' + err.message;
    });
}
// Compact per-year equity-reclassification summary shown during a multi-year Financial Position
// import preview — full detail is the single-year card (finRenderEquityReclassCard), shown once
// the data is actually committed and viewed via the normal Balance Sheet mode.
function finRenderEquityReclassMultiYearPreview(d) {
  if (!d.equityReclassByYear) return '';
  var totalUnclassified = 0;
  var rows = d.years.map(function(y) {
    var er = d.equityReclassByYear[y];
    if (!er) return '';
    totalUnclassified += er.unclassified.length;
    return '<tr><td style="padding:3px 8px;">' + y + '</td>'
      + '<td style="padding:3px 8px;text-align:right;">$' + finFmtMoney(er.donorRestrictedCents / 100) + '</td>'
      + '<td style="padding:3px 8px;text-align:right;">$' + finFmtMoney(er.unrestrictedCents / 100) + '</td>'
      + (er.unclassified.length ? '<td style="padding:3px 8px;color:var(--deep-amber);font-size:.72rem;">⚠ ' + er.unclassified.length + '</td>' : '<td></td>')
      + '</tr>';
  }).join('');
  return '<div class="fin-card" style="margin-bottom:12px;">'
    + '<h4 style="margin:0 0 6px;font-family:var(--font-head);color:var(--steel-anchor);font-size:.86rem;">Net Assets — Donor-Restricted vs. Without Donor Restrictions, by year</h4>'
    + '<table style="width:100%;border-collapse:collapse;font-size:.78rem;"><thead><tr style="color:var(--warm-gray);">'
    + '<th style="text-align:left;padding:3px 8px;">Year</th><th style="text-align:right;padding:3px 8px;">Donor-Restricted</th>'
    + '<th style="text-align:right;padding:3px 8px;">Without Restrictions</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
    + (totalUnclassified ? '<p style="font-size:.74rem;color:var(--deep-amber);margin:6px 0 0;">⚠ ' + totalUnclassified + ' account/year combination(s) need a classification decision — see the account detail below.</p>' : '')
    + '</div>';
}
function finChurchRenderBalanceMultiImportPreview(d) {
  var byPath = {};
  var order = [];
  d.rows.forEach(function(r) {
    if (!byPath[r.category_path]) { byPath[r.category_path] = { row: r, years: {} }; order.push(r.category_path); }
    byPath[r.category_path].years[r.fiscal_year] = r.own_balance_cents;
  });
  var yearHeaders = d.years.map(function(y) { return '<th style="text-align:right;padding:4px 6px;">' + y + '</th>'; }).join('');
  var rowsHtml = order.map(function(path) {
    var entry = byPath[path];
    var cells = d.years.map(function(y) {
      var v = entry.years[y];
      return '<td style="padding:3px 6px;text-align:right;">' + (v == null ? '' : '$' + finFmtMoney(v / 100)) + '</td>';
    }).join('');
    return '<tr>'
      + '<td style="padding:3px 6px 3px ' + (8 + 14 * entry.row.depth) + 'px;">' + esc(entry.row.account_name) + '</td>'
      + '<td style="padding:3px 6px;color:var(--warm-gray);">' + esc(entry.row.classification) + '</td>'
      + cells + '</tr>';
  }).join('');
  var skippedHtml = d.skipped.length
    ? '<p style="font-size:.76rem;color:var(--warm-gray);margin-top:10px;">Ignored (not recognized as accounts): ' + d.skipped.map(esc).join('; ') + '</p>'
    : '';
  return '<div style="max-height:340px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">'
    + '<table style="width:100%;border-collapse:collapse;font-size:.78rem;">'
    + '<thead style="position:sticky;top:0;background:var(--white);"><tr style="border-bottom:1px solid var(--border);">'
    + '<th style="text-align:left;padding:4px 6px;">Account</th><th style="text-align:left;padding:4px 6px;">Classification</th>'
    + yearHeaders + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>'
    + skippedHtml;
}
function finChurchConfirmBalanceMultiImport() {
  if (!_finChurchBalanceMultiImportPreview) return;
  var btn = document.getElementById('fin-church-balance-multi-import-confirm-btn');
  btn.disabled = true;
  api('/admin/api/finance/church/balances/multi-year-import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ years: _finChurchBalanceMultiImportPreview.years, rows: _finChurchBalanceMultiImportPreview.rows }),
  }).then(function(d) {
    btn.disabled = false;
    if (d && d.error) { finToast('Import failed: ' + d.error); return; }
    closeModal('fin-church-balance-multi-import-modal');
    finToast('Imported ' + d.imported + ' row(s) across ' + d.years.length + ' year(s).');
    finRenderChurchReport();
    finRefreshImportStatus();
  }).catch(function(err) {
    btn.disabled = false;
    if (err && err.message !== 'Unauthorized') finToast('Import failed: ' + (err.message || 'Unknown error'));
  });
}

// ── Sync Selected Fiscal Years: actuals-only QuickBooks sync for admin-picked years, decoupled
// from the always-on "Sync Now" (which also pulls Budget vs Actual + the rolling window). ──────
var _finSyncYearsChecked = {}; // { [year]: true }

function finOpenSyncYears() {
  var thisYear = new Date().getFullYear();
  var years = [];
  for (var y = thisYear; y >= thisYear - 15; y--) years.push(y);
  var el = document.getElementById('fin-sync-years-picker');
  if (!el) return;
  var checked = _finSyncYearsChecked;
  el.innerHTML = '<p style="font-size:.78rem;color:var(--warm-gray);margin:0 0 8px;">Pull QuickBooks actuals (Statement of Activity / Profit &amp; Loss) for just the years checked below — budget data is never touched by this. A year synced here overrides any uploaded actuals for that same year.</p>'
    + '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">'
    + years.map(function(y) {
      return '<label style="font-size:.78rem;border:1px solid var(--border);border-radius:6px;padding:3px 8px;cursor:pointer;">'
        + '<input type="checkbox" style="margin-right:4px;" ' + (checked[y] ? 'checked' : '') + ' onchange="finSyncYearsToggle(' + y + ',this.checked)">' + y + '</label>';
    }).join('')
    + '</div>'
    + '<button class="btn-primary" style="font-size:.78rem;padding:4px 10px;" onclick="finSyncYears(this)">Sync Selected Years</button>'
    + '<div id="fin-sync-years-msg" style="font-size:.78rem;margin-top:6px;"></div>';
  el.style.display = el.style.display === 'none' ? '' : 'none';
}

function finSyncYearsToggle(year, checked) {
  if (checked) _finSyncYearsChecked[year] = true;
  else delete _finSyncYearsChecked[year];
}

function finSyncYears(btn) {
  var years = Object.keys(_finSyncYearsChecked).map(Number);
  var msgEl = document.getElementById('fin-sync-years-msg');
  if (!years.length) { if (msgEl) msgEl.textContent = 'Check at least one year first.'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  if (msgEl) msgEl.textContent = 'Syncing ' + years.join(', ') + '…';
  api('/admin/api/finance/qb/sync-years', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fiscal_years: years }),
  }).then(function(d) {
    if (btn) { btn.disabled = false; btn.textContent = 'Sync Selected Years'; }
    if (d && d.error) { if (msgEl) msgEl.textContent = 'Error: ' + d.error; return; }
    if (msgEl) msgEl.textContent = (d.warnings && d.warnings.length) ? 'Synced with warnings: ' + d.warnings.join(' ') : 'Synced ' + d.years.join(', ') + '.';
    finRenderChurchReport();
    finLoadHealth();
  }).catch(function(err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Sync Selected Years'; }
    if (msgEl) msgEl.textContent = 'Error: ' + (err && err.message || 'Unknown error');
  });
}

function finExportChurchCsv() {
  var rows = [];
  if (_finChurchMode === 'year' && _finChurchThisYearData) {
    var d = _finChurchThisYearData;
    rows.push(['Account', 'Actual', 'Budget']);
    finReorganizeChurchTree(finBuildTreeFromFlatRows(d.entries)).forEach(function pushNode(node) {
      rows.push([new Array(node.depth + 1).join('  ') + node.label, (node.totalActualCents / 100).toFixed(2), node.hasBudgetInfo ? (node.totalBudgetCents / 100).toFixed(2) : '']);
      node.children.forEach(pushNode);
    });
    rows.push([]);
    rows.push(['Giving (ChMS records, reference only)', (d.givingCents / 100).toFixed(2)]);
    // Combined on the leading fund code, same as the on-screen table; a code covering more than
    // one fund keeps its members as indented lines beneath the combined figure.
    groupRowsByFundCode(d.givingByFund || [], function(f) { return f.fundName; }, function(f) { return f.cents; })
      .forEach(function(g) {
        rows.push(['  ' + g.label, (g.total / 100).toFixed(2)]);
        if (g.rows.length > 1) g.rows.forEach(function(f) { rows.push(['    ' + f.fundName, (f.cents / 100).toFixed(2)]); });
      });
  } else if (_finChurchMode === 'multiyear' && _finChurchMultiYearData) {
    var md = _finChurchMultiYearData;
    var years = md.years || [];
    rows.push(['Category'].concat(years));
    [['Total Revenue', 'Income'], ['Cost of Goods Sold', 'Cost of Goods Sold'], ['Total Expenses', 'Expenses']]
      .filter(function(rd) { return rd[1] !== 'Cost of Goods Sold' || finChurchMultiYearClassHasData(md, years, rd[1]); })
      .forEach(function(rd) {
      rows.push([rd[0]].concat(years.map(function(y) { return ((md.byYear[y].classificationTotals[rd[1]] || { actualCents: 0 }).actualCents / 100).toFixed(2); })));
    });
    rows.push(['Net Income'].concat(years.map(function(y) { return (md.byYear[y].netIncome.actualCents / 100).toFixed(2); })));
  } else {
    finToast('No church report data to export.');
    return;
  }
  finDownloadCsv('church-report-' + _finChurchMode + '.csv', rows);
}

// ── Shared CSV download helper (Excel/Sheets formula-injection guarded) ─
function finDownloadCsv(filename, rows) {
  var csv = rows.map(csvRow).join('\n');
  var blob = new Blob([csv + '\n'], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ── Board Packet export ──────────────────────────────────────────────────────────────────────
// Downloads one clean JSON file bundling everything a board finance summary would need — meant
// to be handed to a separate Claude session (or any analyst) to write the actual narrative
// commentary. This app deliberately does no anomaly detection itself; it just packages already-
// computed, already-verified figures (the exact same server-side functions the on-screen views
// render from) plus 5 years of trend context, so a follow-up question rarely needs a re-export.
function finExportBoardPacket(year) {
  year = year || new Date().getFullYear();
  var btn = document.getElementById('fin-board-packet-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
  api('/admin/api/finance/board-packet?year=' + year).then(function(d) {
    if (btn) { btn.disabled = false; btn.textContent = 'Export Board Packet'; }
    if (d && d.error) { finToast('Export failed: ' + d.error); return; }
    var blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'board-packet-' + year + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }).catch(function(err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Export Board Packet'; }
    if (err && err.message !== 'Unauthorized') finToast('Export failed: ' + (err.message || 'Unknown error'));
  });
}

// ── Commercial Property (3277 Ivanhoe) ───────────────────────────────────────────────────────
// Only one property exists today ('ivanhoe'); propertyKey is hardcoded here to match the
// backend's single-property route (see handlePropertyApi in src/api-finance.js). Figures come
// straight from the 2026-07-20 AHRA data export — see CLAUDE.md's Finance Overview queued items.
var _finProperty = null;
var FIN_PROPERTY_KEY = 'ivanhoe';
function finLoadProperty() {
  var el = document.getElementById('fin-property-root');
  if (!el) return;
  el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">Loading…</p>';
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY).then(function(d) {
    _finProperty = d;
    finRenderProperty(d);
    finRenderPropertyAdminTools(d);
    finRenderDaycareMdoNote();
    // finLoadProperty() and finLoadPlanning() race at finance-tab load, and Planning renders the
    // Ivanhoe forecast from _finProperty. If the property fetch lands second, the card was left
    // on "Loading property forecast…" until something else happened to re-render Planning.
    finRenderPropertyMultiYearForecast();
    finLoadHealth();
  }).catch(function(err) {
    if (err && err.message === 'Unauthorized') return;
    el.innerHTML = '<p style="font-size:.85rem;color:var(--danger);">Could not load property data.</p>';
  });
}
// ── Charts (Revenue vs Expenses, Occupancy, Property Tax Reserve trend) ─────────────────────
// renderGroupedBarChart (js-attendance.js) doesn't render negative bars visibly — Net Income
// is left out of the bar chart for that reason (it stays in the Monthly Financials table below,
// which always shows the real signed number) and only non-negative series go in these charts.
function finRenderPropertyCharts(d) {
  var monthly = (d.monthly || []).slice().sort(function(a,b){ return a.period < b.period ? -1 : 1; }).slice(-24);
  if (!monthly.length) return '';
  var revExpChart = renderGroupedBarChart({
    chartH: 200,
    title: 'Monthly Revenue vs. Expenses (last ' + monthly.length + ' months)',
    groups: monthly.map(function(m) { return { key: m.period, label: m.period.slice(2) }; }),
    series: [{ key: 'rev', label: 'Revenue', color: '#2E7EA6' }, { key: 'exp', label: 'Expenses', color: '#C9973A' }],
    value: function(g, s) {
      var m = monthly.filter(function(x) { return x.period === g; })[0];
      var cents = s === 'rev' ? m.total_revenue_cents : m.total_expenses_cents;
      return cents == null ? null : cents / 100;
    },
    tooltip: function(g, s, v) { return (s === 'rev' ? 'Revenue' : 'Expenses') + ' ' + g + ': $' + finFmtMoney(v); },
  });
  var occChart = renderGroupedBarChart({
    chartH: 160,
    title: 'Occupancy % (last ' + monthly.length + ' months)',
    groups: monthly.map(function(m) { return { key: m.period, label: m.period.slice(2) }; }),
    series: [{ key: 'occ', label: 'Occupancy', color: '#5A9E6F' }],
    value: function(g) {
      var m = monthly.filter(function(x) { return x.period === g; })[0];
      return m.occupancy_pct == null ? null : m.occupancy_pct * 100;
    },
    barLabel: function(v) { return Math.round(v) + '%'; },
    tooltip: function(g, s, v) { return g + ': ' + v.toFixed(1) + '%'; },
  });
  var taxRows = ((d.reserves && d.reserves.property_tax) || []).slice().sort(function(a,b){ return a.report_month < b.report_month ? -1 : 1; }).slice(-24);
  var reserveChart = taxRows.length ? renderGroupedBarChart({
    chartH: 160,
    title: 'Property Tax Reserve Balance (last ' + taxRows.length + ' months)',
    groups: taxRows.map(function(r) { return { key: r.report_month, label: r.report_month.slice(2) }; }),
    series: [{ key: 'bal', label: 'Reserve Balance', color: '#9B59B6' }],
    value: function(g) {
      var r = taxRows.filter(function(x) { return x.report_month === g; })[0];
      return r.reserve_after_cents == null ? null : r.reserve_after_cents / 100;
    },
    tooltip: function(g, s, v) { return g + ': $' + finFmtMoney(v); },
  }) : '';
  return revExpChart + occChart + reserveChart;
}

// ── The property cash model (FIN61) ──────────────────────────────────────────────────────────
// AHRA reports an ACCRUAL net income, and it is NOT the cash the property can remit. Two real
// outflows are missing from it, both by construction rather than by error:
//   * Mortgage PRINCIPAL. Interest is an expense and is already inside net income; principal is
//     a balance-sheet movement, so it never appears on the P&L at all — yet it is roughly
//     $35,000/yr of cash leaving the building.
//   * CAPITAL improvements. Capitalized by definition, so they never hit the P&L either, but
//     they are paid in cash out of the same account (~$34k over the ledger to date).
// Deliberately NOT deducted here, because each would double-count:
//   * Property tax — the bill already lands as an expense inside net income (Dec 2025 expenses
//     were $14,631). The monthly tax reserve is a TIMING mechanism, not an additional cost.
//   * The flat base-minimum reserve — a one-time floor, already funded, not a recurring drain.
//   * Church-paid allocated insurance — real, but the church budget already carries it as its
//     own expense line, so it is shown as a memo beside the forecast, never subtracted here.
// The projection grows OPERATING income (net income before interest) at the growth rate, since
// rents grow but a fixed mortgage payment does not, and takes interest and principal from a real
// per-year amortization schedule. Post-payoff both simply fall to zero, so no add-back fudge is
// needed — the old code added a flat annual figure back on top of a base it had never taken it
// out of, which double-counted the whole debt service in every post-payoff year.

// Per-year amortization. Anchored to the lender-CONFIRMED balance date rather than to today, so
// the schedule does not silently slide forward every time the page is re-rendered.
function finAmortizationSchedule(loan, opts) {
  opts = opts || {};
  if (!loan || !loan.balance_cents || !loan.interest_rate_pct || !loan.monthly_payment_cents) return null;
  var monthlyRate = loan.interest_rate_pct / 12;
  var payment = loan.monthly_payment_cents;
  var balance = loan.balance_cents;
  if (payment <= balance * monthlyRate) return null; // payment doesn't cover interest — no payoff
  var anchor = opts.asOfDate || loan.balance_as_of_date || null;
  var y, mo;
  if (anchor && /^[0-9]{4}-[0-9]{2}/.test(String(anchor))) {
    y = parseInt(String(anchor).slice(0, 4), 10);
    mo = parseInt(String(anchor).slice(5, 7), 10) - 1;
  } else {
    var now = opts.now ? new Date(opts.now) : new Date();
    y = now.getFullYear(); mo = now.getMonth();
  }
  var startYear = y, startMonth = mo;
  var byYear = {}, order = [];
  var months = 0, totalInterestCents = 0;
  while (balance > 0 && months < 600) {
    var interest = balance * monthlyRate;
    var principal = payment - interest;
    if (principal <= 0) return null;
    if (principal > balance) principal = balance; // final, partial payment
    balance -= principal;
    totalInterestCents += interest;
    if (!byYear[y]) { byYear[y] = { year: y, principalCents: 0, interestCents: 0, endingBalanceCents: 0, monthsCovered: 0 }; order.push(y); }
    byYear[y].principalCents += principal;
    byYear[y].interestCents += interest;
    byYear[y].endingBalanceCents = balance;
    byYear[y].monthsCovered++;
    months++;
    mo++; if (mo > 11) { mo = 0; y++; }
  }
  var years = order.map(function(yr) {
    var row = byYear[yr];
    row.principalCents = Math.round(row.principalCents);
    row.interestCents = Math.round(row.interestCents);
    row.endingBalanceCents = Math.round(row.endingBalanceCents);
    return row;
  });
  return {
    years: years,
    byYear: byYear,
    months: months,
    totalInterestCents: Math.round(totalInterestCents),
    annualDebtServiceCents: Math.round(payment * 12),
    payoffYear: years.length ? years[years.length - 1].year : null,
    payoffDate: new Date(startYear, startMonth + months, 1),
    anchoredTo: anchor || null,
  };
}
// Kept for callers that only want the headline payoff figures. One amortization loop, not two.
function finComputeMortgageAmortization(loan) {
  var sched = finAmortizationSchedule(loan);
  if (!sched) return null;
  return { months: sched.months, totalInterestCents: sched.totalInterestCents, payoffDate: sched.payoffDate };
}
// The trailing-12-month base every property projection starts from. Was hand-inlined in three
// places that had already drifted; one helper so they cannot disagree again.
function finComputePropertyTrailingNetIncome(d) {
  var monthly = ((d && d.monthly) || []).slice().sort(function(a, b) { return a.period < b.period ? -1 : 1; }).slice(-12);
  var withNet = monthly.filter(function(m) { return m.net_income_cents != null || m.net_operating_income_cents != null; });
  var avgMonthly = withNet.length
    ? withNet.reduce(function(sum, m) { return sum + (m.net_income_cents != null ? m.net_income_cents : m.net_operating_income_cents); }, 0) / withNet.length
    : 0;
  return {
    annualCents: Math.round(avgMonthly * 12),
    monthlyCents: Math.round(avgMonthly),
    months: withNet.length,
    fromPeriod: withNet.length ? withNet[0].period : null,
    toPeriod: withNet.length ? withNet[withNet.length - 1].period : null,
  };
}
// Interest already embedded in that trailing net income. Prefers the months' own reported
// interest_expense_cents, but only when EVERY month in the window carries one — a partial sum
// would understate it and silently inflate everything downstream. Otherwise falls back to the
// schedule's own first 12 months, which is at least internally consistent with the balance and
// rate being amortized.
function finComputePropertyBaseInterestCents(d, sched) {
  var monthly = ((d && d.monthly) || []).slice().sort(function(a, b) { return a.period < b.period ? -1 : 1; }).slice(-12);
  var withNet = monthly.filter(function(m) { return m.net_income_cents != null || m.net_operating_income_cents != null; });
  var reported = withNet.filter(function(m) { return m.interest_expense_cents != null; });
  if (withNet.length && reported.length === withNet.length) {
    return { cents: reported.reduce(function(s, m) { return s + m.interest_expense_cents; }, 0), source: 'reported' };
  }
  if (!sched || !sched.years.length) return { cents: 0, source: 'none' };
  // The FIRST TWELVE SCHEDULED MONTHS, not the first calendar year — the anchor year is normally
  // a partial one, and averaging a half year against a full one understates interest badly
  // enough to drag projected net income below the base it grew from.
  var need = 12, cents = 0;
  for (var i = 0; i < sched.years.length && need > 0; i++) {
    var row = sched.years[i];
    var take = Math.min(need, row.monthsCovered);
    cents += row.interestCents * (take / row.monthsCovered);
    need -= take;
  }
  return { cents: Math.round(cents), source: 'schedule' };
}
// Capital allowance: what the property has actually spent per year, averaged over the span the
// ledger covers. Derived from the data rather than hardcoded, so it stays honest as entries are
// added. Never annualizes UP from a sub-year window — three months of spending is not a year's
// worth, and treating it as one would overstate the deduction fourfold.
// The ledger's own entry_date is only loosely validated on write — the POST endpoint accepts
// YYYY, YYYY-MM and YYYY-MM-DD alike — so parse defensively. A bare YYYY used to make the month
// arithmetic NaN, which propagated all the way to a "$NaN" remittable figure.
function finPropertyLedgerMonthIndex(dateStr) {
  var s = String(dateStr || '');
  var y = parseInt(s.slice(0, 4), 10);
  if (!isFinite(y)) return null;
  var m = parseInt(s.slice(5, 7), 10);
  if (!isFinite(m) || m < 1 || m > 12) m = 1;
  return y * 12 + (m - 1);
}
function finComputePropertyCapitalLedgerAverage(d) {
  var entries = ((d && d.capitalLedger) || []).filter(function(c) {
    return c.amount_cents != null && finPropertyLedgerMonthIndex(c.entry_date) != null;
  });
  if (!entries.length) return { cents: 0, totalCents: 0, years: 0, fromDate: null, toDate: null, entries: 0 };
  var dates = entries.map(function(c) { return String(c.entry_date); }).sort();
  var first = dates[0], last = dates[dates.length - 1];
  var totalCents = entries.reduce(function(s, c) { return s + (c.amount_cents || 0); }, 0);
  var months = finPropertyLedgerMonthIndex(last) - finPropertyLedgerMonthIndex(first) + 1;
  // Never annualize UP from a sub-year window, and never return NaN.
  var years = Math.max((isFinite(months) ? months : 12) / 12, 1);
  var cents = Math.round(totalCents / years);
  return {
    cents: isFinite(cents) ? cents : 0, totalCents: totalCents, years: years,
    fromDate: first, toDate: last, entries: entries.length,
  };
}
// THE capital assumption. Every forward-looking consumer reads this one resolver — the pro forma,
// the remittable forecast, the Property forecast card, the Planning multi-year table — so the
// Property tab and Planning cannot quote different cash figures for the same year.
//
// Why the ledger average above is only a FALLBACK, not the answer: this property's ledger holds
// three FINISHED one-time projects (a 2024 apartment renovation, a 2025 HVAC replacement, a
// washer/dryer hookup). Averaged over their own 19-month span that is ~$15,200/yr, and charging it
// forever says the church will re-renovate and re-replace every single year. So the average stays
// available as reference, flagged as history, and the real assumption is entered:
//   flat     -> a figure somebody chose, in dollars per year
//   per_sqft -> a reserve rate times the building's leasable area (the commercial convention)
//   ledger   -> the historical average, with source saying so, so the UI can flag it
//
// opts.sqft lets the LIVE rent-roll square footage override the stored one while the roll is being
// edited; without it, typing a new SF figure would move the valuation and leave this line stale.
function finComputePropertyCapitalAllowanceCents(d, opts) {
  opts = opts || {};
  var ledger = finComputePropertyCapitalLedgerAverage(d);
  var cap = ((d && d.meta) || {}).capital || {};
  var sqft = opts.sqft != null
    ? (Number(opts.sqft) || 0)
    : finComputePropertyUnits(finPropertyValuationInputsFromMeta((d && d.meta) || {}).rentRoll).totalSqft;
  var perSqftCents = Number(cap.per_sqft_cents) || 0;
  var flatCents = Math.max(0, Math.round(Number(cap.annual_allowance_cents) || 0));
  if (!isFinite(flatCents)) flatCents = 0;
  var byAreaCents = Math.max(0, Math.round(perSqftCents * sqft));
  if (!isFinite(byAreaCents)) byAreaCents = 0;
  function out(over) {
    return Object.assign({}, ledger, { ledgerCents: ledger.cents, sqft: sqft, perSqftCents: perSqftCents,
      flatCents: flatCents, byAreaCents: byAreaCents, method: cap.method || 'ledger' }, over);
  }
  if (cap.method === 'flat' && cap.annual_allowance_cents != null) {
    return out({ cents: flatCents, source: 'flat' });
  }
  if (cap.method === 'per_sqft' && cap.per_sqft_cents != null) {
    // No square footage recorded would silently resolve to $0 — a real cost quietly deleted from
    // the cash walk. Fall back to the ledger and name which happened, never a confident zero.
    if (!sqft) return out({ source: 'per_sqft_no_sqft' });
    return out({ cents: byAreaCents, source: 'per_sqft' });
  }
  // A flat base plus a per-SF reserve: the flat part covers a known commitment, the rate scales
  // with the building. Unlike the pure per_sqft case this does NOT fall back when square footage
  // is missing — the flat part is still a real, entered figure, so the assumption stands and the
  // editor warns that the rate is contributing nothing.
  if (cap.method === 'flat_plus_sqft' && (cap.annual_allowance_cents != null || cap.per_sqft_cents != null)) {
    return out({ cents: flatCents + byAreaCents, source: 'flat_plus_sqft' });
  }
  return out({ source: 'ledger' });
}
// One sentence naming where the capital figure came from, so no card asserts a source it cannot
// see. Kept beside the resolver because the two must change together.
function finPropertyCapitalSourceNote(cap) {
  if (!cap) return '';
  if (cap.source === 'flat') return 'a set allowance of $' + finFmtMoney(cap.cents / 100) + '/yr';
  if (cap.source === 'per_sqft') return '$' + (cap.perSqftCents / 100).toFixed(2) + '/SF across ' + (cap.sqft || 0).toLocaleString('en-US') + ' SF of leasable area';
  if (cap.source === 'flat_plus_sqft') {
    return 'a flat $' + finFmtMoney(cap.flatCents / 100) + '/yr plus '
      + (cap.sqft ? '$' + (cap.perSqftCents / 100).toFixed(2) + '/SF across ' + cap.sqft.toLocaleString('en-US') + ' SF'
                  : 'a $/SF rate that has no square footage to apply to');
  }
  if (cap.source === 'per_sqft_no_sqft') return 'the ledger average — a $/SF rate is set, but no unit square footage is recorded to apply it to';
  if (!cap.entries) return 'nothing — no capital spending has been recorded or assumed';
  return 'this property\'s own past spend ($' + finFmtMoney(cap.totalCents / 100) + ' over ' + cap.years.toFixed(1)
    + ' years), which was one-time project work and is probably not a forward assumption';
}
// Which period the projection should grow FROM. This is the single biggest lever on the answer
// and it used to be an invisible, unadjustable trailing-12 average: for this property that window
// straddles a weak half-year (H2-2025, ~$9.2k over six months) and a strong one (H1-2026, ~$33.8k
// at full occupancy), and the choice swings the first projected year by tens of thousands. So the
// options are computed together, each carrying the caveat that belongs to it, and shown side by
// side rather than one being picked silently.
function finComputePropertyBaseOptions(d, opts) {
  opts = opts || {};
  var nowYear = opts.now ? new Date(opts.now).getFullYear() : new Date().getFullYear();
  var monthly = ((d && d.monthly) || []).slice().sort(function(a, b) { return a.period < b.period ? -1 : 1; })
    .filter(function(m) { return m.net_income_cents != null || m.net_operating_income_cents != null; });
  function ni(m) { return m.net_income_cents != null ? m.net_income_cents : m.net_operating_income_cents; }
  function sum(rows) { return rows.reduce(function(s, m) { return s + ni(m); }, 0); }
  var out = [];

  var t12 = finComputePropertyTrailingNetIncome(d);
  out.push({
    key: 'trailing12', label: 'Trailing 12 months', annualCents: t12.annualCents, months: t12.months,
    range: t12.fromPeriod && t12.toPeriod ? t12.fromPeriod + ' to ' + t12.toPeriod : '',
    caveat: 'Contains exactly one property-tax cycle, so nothing is double-counted or missed. But it averages across whatever the last twelve months happened to hold, good months and bad.',
  });

  var curRows = monthly.filter(function(m) { return String(m.period).slice(0, 4) === String(nowYear); });
  if (curRows.length && curRows.length < 12) {
    var curSum = sum(curRows);
    // Annualizing a part-year that has not yet reached the tax bill would omit it entirely — the
    // mirror image of the double-count the forecast is careful to avoid elsewhere. The tax lands
    // in Nov/Dec, so subtract this year's own estimate whenever those months are not in the window.
    var lastMonth = parseInt(String(curRows[curRows.length - 1].period).slice(5, 7), 10) || 0;
    var taxCents = 0;
    var taxRows = ((d && d.reserves) || {}).property_tax || [];
    for (var t = taxRows.length - 1; t >= 0; t--) {
      if (String(taxRows[t].report_month || '').slice(0, 4) === String(nowYear) && taxRows[t].target_estimate_cents) {
        taxCents = taxRows[t].target_estimate_cents; break;
      }
    }
    var taxApplied = (lastMonth < 11) ? taxCents : 0;
    out.push({
      key: 'currentYear', label: nowYear + ' annualized', annualCents: Math.round(curSum / curRows.length * 12) - taxApplied,
      months: curRows.length, range: curRows[0].period + ' to ' + curRows[curRows.length - 1].period,
      taxAdjustmentCents: taxApplied,
      caveat: 'How the property is running right now'
        + (taxApplied ? ', less this year&rsquo;s estimated property tax of ' + finMoney0(taxApplied) + ', which has not been billed yet and so is not in these months' : '')
        + '. Assumes the rest of the year looks like the part already reported, which lumpy repair months can easily break.',
    });
  }

  var lastFull = nowYear - 1;
  var lfRows = monthly.filter(function(m) { return String(m.period).slice(0, 4) === String(lastFull); });
  if (lfRows.length >= 12) {
    out.push({
      key: 'lastFullYear', label: lastFull + ' (last full year)', annualCents: sum(lfRows), months: lfRows.length,
      range: lastFull + '-01 to ' + lastFull + '-12',
      caveat: 'A complete year with one full tax cycle and no annualizing. It is also the furthest out of date.',
    });
  }
  return out;
}
// THE model. Every consumer reads its rows rather than re-deriving any component, so the
// Planning card, the Property tab and the Available-for-Distribution bar cannot drift apart.
// Each row carries the whole reconciliation, not just the total.
function finComputeRemittableForecast(d, opts) {
  opts = opts || {};
  var growth = opts.growthPct != null ? opts.growthPct : 0.02;
  var numYears = opts.years != null ? opts.years : 3;
  var loan = ((d && d.meta) || {}).loan || {};
  var base = finComputePropertyTrailingNetIncome(d);
  var sched = finAmortizationSchedule(loan, opts);
  var baseInterest = finComputePropertyBaseInterestCents(d, sched);
  // Reads the SAVED assumption via the shared resolver rather than defaulting on its own. An
  // earlier pass defaulted to zero here — right about the ledger average being a poor forecast
  // (every entry is a finished one-off: apartment renovation, HVAC, washer/dryer), but it left
  // this card at $0 while the Commercial Property tab fell back to the average, so the two quoted
  // different cash for the same year. Now there is one answer, whichever it is, and the resolver's
  // own source field makes an unset assumption visible instead of silent.
  var capital = finComputePropertyCapitalAllowanceCents(d);
  var capitalCents = opts.capitalAllowanceCents != null ? opts.capitalAllowanceCents : capital.cents;
  var baseAnnualCents = opts.baseAnnualCents != null ? opts.baseAnnualCents : base.annualCents;
  // Net income before interest. This is the part that grows with rents; the mortgage does not.
  var baseOperatingCents = baseAnnualCents + baseInterest.cents;
  var nowYear = opts.now ? new Date(opts.now).getFullYear() : new Date().getFullYear();
  var startYear = opts.startYear != null ? opts.startYear : nowYear + 1;
  var rows = [];
  for (var i = 0; i < numYears; i++) {
    var year = startYear + i;
    var operatingCents = Math.round(baseOperatingCents * Math.pow(1 + growth, (year - nowYear)));
    var sy = sched && sched.byYear[year];
    var interestCents = sy ? sy.interestCents : 0;
    var principalCents = sy ? sy.principalCents : 0;
    var netIncomeCents = operatingCents - interestCents;
    rows.push({
      year: year,
      operatingCents: operatingCents,
      interestCents: interestCents,
      principalCents: principalCents,
      netIncomeCents: netIncomeCents,
      capitalCents: capitalCents,
      remittableCents: netIncomeCents - principalCents - capitalCents,
      isPostPayoff: !!(sched && sched.payoffYear && year > sched.payoffYear),
    });
  }
  return {
    rows: rows,
    base: base,
    baseAnnualCents: baseAnnualCents,
    baseInterestCents: baseInterest.cents,
    baseInterestSource: baseInterest.source,
    baseOperatingCents: baseOperatingCents,
    capital: capital,
    capitalAllowanceCents: capitalCents,
    schedule: sched,
    payoffYear: sched ? sched.payoffYear : null,
  };
}
// The stored loan record contradicts itself, and the contradiction moves real money, so it is
// surfaced rather than silently resolved. Confirmed with the pastor: monthly_payment_cents
// ($4,283.03) is principal + interest, which means the field NAMED annual_debt_service_cents
// ($45,396.36 = $3,783.03 x 12) is actually the principal portion — mislabeled. Separately, the
// June 2026 report's interest of $952.05/mo implies a balance near $179k, not the confirmed
// $279,691.13. Nothing here trusts either figure: interest and principal come from amortizing
// the confirmed balance at the confirmed rate.
function finPropertyLoanDataWarnings(d) {
  var loan = ((d && d.meta) || {}).loan || {};
  var out = [];
  if (loan.monthly_payment_cents && loan.annual_debt_service_cents
      && Math.abs(loan.monthly_payment_cents * 12 - loan.annual_debt_service_cents) > 100) {
    out.push('The stored monthly payment ($' + finFmtMoney(loan.monthly_payment_cents / 100) + '/mo, i.e. $'
      + finFmtMoney(loan.monthly_payment_cents * 12 / 100) + '/yr) does not match the stored annual figure of $'
      + finFmtMoney(loan.annual_debt_service_cents / 100) + ', which appears to be the principal portion only. '
      + 'Figures here amortize the confirmed balance at the confirmed rate instead of trusting either — worth confirming with LCEF.');
  }
  var monthly = ((d && d.monthly) || []).slice().sort(function(a, b) { return a.period < b.period ? -1 : 1; });
  var lastInt = null;
  for (var i = monthly.length - 1; i >= 0; i--) { if (monthly[i].interest_expense_cents != null) { lastInt = monthly[i]; break; } }
  if (lastInt && loan.balance_cents && loan.interest_rate_pct) {
    var implied = lastInt.interest_expense_cents / (loan.interest_rate_pct / 12);
    if (Math.abs(implied - loan.balance_cents) > loan.balance_cents * 0.2) {
      out.push('The ' + lastInt.period + ' report\'s interest of $' + finFmtMoney(lastInt.interest_expense_cents / 100)
        + '/mo implies a loan balance near $' + finFmtMoney(implied / 100) + ', against the confirmed $'
        + finFmtMoney(loan.balance_cents / 100) + '. One of the two is stale.');
    }
  }
  return out;
}
function finRenderPropertyForecast(d) {
  var f = finComputeRemittableForecast(d, { years: 1 });
  var sched = f.schedule;
  var next = f.rows[0];
  // Post-payoff, interest and principal both simply stop, so what the property clears is its
  // operating income less the capital allowance. The old figure here added a flat annual debt
  // service back onto a net income it had never subtracted it from. Read through the same model
  // rather than hand-rolled, so it cannot drift from the Planning card's own figure.
  var postPayoffCents = f.payoffYear
    ? finComputeRemittableForecast(d, { years: 1, startYear: f.payoffYear + 1 }).rows[0].remittableCents
    : null;
  var statsHtml = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin:10px 0;">'
    + '<div class="rpt-stat"><div class="rpt-stat-num">$' + finFmtMoney(f.base.annualCents/100) + '</div><div class="rpt-stat-lbl">Avg. Annual Net Income (trailing ' + f.base.months + 'mo)</div></div>'
    + '<div class="rpt-stat"><div class="rpt-stat-num">' + finMoney0Signed(next.remittableCents) + '</div><div class="rpt-stat-lbl">Remittable Cash, ' + next.year + ' (after principal &amp; capital)</div></div>'
    + (sched
      ? '<div class="rpt-stat"><div class="rpt-stat-num">' + sched.payoffDate.toLocaleDateString('en-US', {month:'short', year:'numeric'}) + '</div><div class="rpt-stat-lbl">Projected Mortgage Payoff (~' + sched.months + ' mo from the confirmed balance)</div></div>'
        + '<div class="rpt-stat"><div class="rpt-stat-num">$' + finFmtMoney(sched.totalInterestCents/100) + '</div><div class="rpt-stat-lbl">Remaining Interest</div></div>'
        + '<div class="rpt-stat"><div class="rpt-stat-num">' + finMoney0Signed(postPayoffCents) + '</div><div class="rpt-stat-lbl">Remittable Cash After Payoff (' + (f.payoffYear + 1) + ')</div></div>'
      : '')
    + '</div>';
  var note = '<p style="font-size:.72rem;color:var(--warm-gray);margin:0 0 4px;"><i>Remittable cash is net income less mortgage <b>principal</b> (which is not an expense, so it is not in net income) and less a capital allowance of $'
    + finFmtMoney(f.capitalAllowanceCents/100) + '/yr, from ' + finPropertyCapitalSourceNote(f.capital) + '. Property tax is <b>not</b> deducted again — the bill is already an expense inside net income, and the monthly reserve is a timing mechanism. '
    + (sched ? 'After payoff the mortgage stops entirely, which is where the step up comes from.' : 'Mortgage payoff cannot be projected — the loan balance, interest rate, or monthly payment is not set (or the payment does not cover the interest).')
    + '</i></p>';
  return '<h4 style="margin:18px 0 8px;font-size:.9rem;">Cash Flow &amp; Mortgage Payoff Forecast</h4>' + statsHtml + note
    + finPropertyLoanWarningHtml(d);
}
// Signed money, so a negative remittable figure reads as -$4,432 rather than $-4,432.
function finMoney0Signed(cents) {
  if (cents == null) return '—';
  var n = Math.round(cents / 100);
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US');
}
function finPropertyLoanWarningHtml(d) {
  var warnings = finPropertyLoanDataWarnings(d);
  if (!warnings.length) return '';
  return '<div class="fin-note-box" style="margin-top:10px;"><b>Loan data needs confirming.</b> '
    + warnings.join(' ') + '</div>';
}

// ── Units, income & valuation ────────────────────────────────────────────────────────────────
// One worksheet, two answers. The rent roll and operating costs below are AHRA's own valuation
// worksheet (3277_Ivanhoe_Valuation_2.xlsx: per-tenant rents + itemized costs, reconciled to that
// file exactly), and they still produce the income-capitalization VALUE they always did. The same
// inputs now also drive an operating PRO FORMA — what the four units clear in cash after the
// mortgage and capital spending — which is the question a council actually asks.
//
// Deliberately ONE set of inputs. A second rent roll kept next to this one is the bug where two
// screens quote different rents for the same building and both look right.
var FIN_VAL_OP_COST_FIELDS = [
  ['utilities_cents', 'Utilities'],
  ['trash_cents', 'Trash'],
  ['maintenance_repairs_cents', 'Maintenance/Repairs'],
  ['landscaping_snow_cents', 'Landscaping/Snow'],
  ['legal_cents', 'Legal'],
  ['taxes_cents', 'Taxes'],
  ['insurance_cents', 'Insurance'],
];
// Pure — no DOM — so it's directly unit-testable (see test/finance-property-forecast.test.js).
// Mirrors AHRA's worksheet exactly: Gross Rental Income = rent roll + utility reimbursement,
// less vacancy = Effective Rental Income; Total Operating Costs = itemized costs + a management
// fee computed as a % of Effective Rental Income; NOI = Effective Rental Income − Total
// Operating Costs; Capitalized Value = NOI ÷ Cap Rate.
function finComputePropertyValuation(inputs) {
  var rentRoll = inputs.rentRoll || [];
  var totalAnnualRentCents = rentRoll.reduce(function(sum, r) { return sum + (Number(r.annual_rent_cents) || 0); }, 0);
  var utilityReimbCents = Number(inputs.utility_reimbursement_cents) || 0;
  var grossRentalIncomeCents = totalAnnualRentCents + utilityReimbCents;
  var vacancyRatePct = Number(inputs.vacancy_rate_pct) || 0;
  var vacancyCents = Math.round(grossRentalIncomeCents * vacancyRatePct);
  var effectiveRentalIncomeCents = grossRentalIncomeCents - vacancyCents;
  var opCosts = inputs.operating_costs || {};
  var itemizedOpCostsCents = FIN_VAL_OP_COST_FIELDS.reduce(function(sum, f) { return sum + (Number(opCosts[f[0]]) || 0); }, 0);
  var managementFeePct = Number(inputs.management_fee_pct) || 0;
  var managementFeeCents = Math.round(effectiveRentalIncomeCents * managementFeePct);
  var totalOperatingCostsCents = itemizedOpCostsCents + managementFeeCents;
  var noiCents = effectiveRentalIncomeCents - totalOperatingCostsCents;
  var capRate = Number(inputs.cap_rate) || 0;
  var capitalizedValueCents = capRate ? Math.round(noiCents / capRate) : 0;
  return {
    totalAnnualRentCents: totalAnnualRentCents, grossRentalIncomeCents: grossRentalIncomeCents, vacancyCents: vacancyCents,
    effectiveRentalIncomeCents: effectiveRentalIncomeCents, itemizedOpCostsCents: itemizedOpCostsCents,
    managementFeeCents: managementFeeCents, totalOperatingCostsCents: totalOperatingCostsCents,
    noiCents: noiCents, capitalizedValueCents: capitalizedValueCents,
  };
}
// Reads the stored worksheet into the shape finComputePropertyValuation wants. Kept separate so
// the pure functions never have to know the storage key names.
function finPropertyValuationInputsFromMeta(meta) {
  var val = ((meta || {}).valuation) || {};
  return {
    rentRoll: (val.rent_roll || []).map(function(r) {
      return { tenant: r.tenant || '', sqft: Number(r.sqft) || 0, annual_rent_cents: Number(r.annual_rent_cents) || 0 };
    }),
    utility_reimbursement_cents: Number(val.utility_reimbursement_cents) || 0,
    vacancy_rate_pct: Number(val.vacancy_rate_pct) || 0,
    operating_costs: val.operating_costs || {},
    management_fee_pct: Number(val.management_fee_pct) || 0,
    cap_rate: Number(val.cap_rate) || 0,
  };
}
// Pure. Per-unit detail off the rent roll: what each unit contributes, what it rents for per
// square foot, and whether it is earning anything at all. A unit carried at zero rent is counted
// as vacant rather than dropped, so the leased-percentage figure is honest about empty space —
// which the single blended "vacancy rate %" assumption on the worksheet cannot express.
function finComputePropertyUnits(rentRoll) {
  var units = (rentRoll || []).map(function(r) {
    var annual = Number(r.annual_rent_cents) || 0;
    var sqft = Number(r.sqft) || 0;
    return {
      tenant: r.tenant || '',
      sqft: sqft,
      annualRentCents: annual,
      monthlyRentCents: Math.round(annual / 12),
      rentPerSqftCents: sqft ? Math.round(annual / sqft) : null,
      vacant: annual <= 0,
    };
  });
  var totalAnnualCents = units.reduce(function(s, u) { return s + u.annualRentCents; }, 0);
  var totalSqft = units.reduce(function(s, u) { return s + u.sqft; }, 0);
  var leasedSqft = units.reduce(function(s, u) { return s + (u.vacant ? 0 : u.sqft); }, 0);
  units.forEach(function(u) { u.sharePct = totalAnnualCents ? u.annualRentCents / totalAnnualCents : 0; });
  return {
    units: units,
    count: units.length,
    vacantCount: units.filter(function(u) { return u.vacant; }).length,
    totalAnnualCents: totalAnnualCents,
    totalMonthlyCents: Math.round(totalAnnualCents / 12),
    totalSqft: totalSqft,
    leasedSqft: leasedSqft,
    leasedPct: totalSqft ? leasedSqft / totalSqft : null,
  };
}
// Pure. The operating pro forma: from the rent roll UP to cash in the church's hand.
//
// This is deliberately a SECOND, independent reading of the property. finComputeRemittable-
// Forecast works from AHRA's reported net income DOWN; this one works from the leases UP. They
// answer the same question by different routes, so the card prints both and names the gap —
// a rent roll that disagrees with the operating statements is itself the finding, not something
// to average away.
//
// Everything below NOI matches finComputeRemittableForecast's treatment exactly, and for the same
// reasons: mortgage INTEREST is an operating expense but sits below NOI by convention, mortgage
// PRINCIPAL is not an expense at all yet is real cash leaving, and capitalized spending never
// touches the P&L. Property tax is NOT deducted again — it is already one of the itemized
// operating costs above.
function finComputePropertyProForma(d, opts) {
  opts = opts || {};
  var meta = (d && d.meta) || {};
  var inputs = opts.inputs || finPropertyValuationInputsFromMeta(meta);
  var v = finComputePropertyValuation(inputs);
  var roll = finComputePropertyUnits(inputs.rentRoll);
  var sched = finAmortizationSchedule(meta.loan || {}, opts);
  var year = opts.year != null ? opts.year
    : (opts.now ? new Date(opts.now).getFullYear() : new Date().getFullYear());
  var sy = sched && sched.byYear[year];
  var interestCents = sy ? sy.interestCents : 0;
  var principalCents = sy ? sy.principalCents : 0;
  var debtServiceCents = interestCents + principalCents;
  // Pass the LIVE roll's square footage, so a $/SF capital assumption tracks an SF edit as it is
  // typed instead of quoting the last saved figure.
  var capital = finComputePropertyCapitalAllowanceCents(d, { sqft: roll.totalSqft });
  var capitalCents = opts.capitalAllowanceCents != null ? opts.capitalAllowanceCents : capital.cents;
  var netIncomeCents = v.noiCents - interestCents;
  var cashAfterDebtCents = v.noiCents - debtServiceCents;
  var cashToChurchCents = cashAfterDebtCents - capitalCents;
  // Debt-service coverage: below 1.00 the rents do not cover the mortgage. Null rather than
  // Infinity once the loan is paid off, so the card can say so in words instead of printing a
  // meaningless ratio.
  var dscr = debtServiceCents > 0 ? v.noiCents / debtServiceCents : null;
  var actual = finComputePropertyTrailingNetIncome(d);
  return {
    year: year,
    inputs: inputs,
    valuation: v,
    roll: roll,
    interestCents: interestCents,
    principalCents: principalCents,
    debtServiceCents: debtServiceCents,
    debtServiceKnown: !!sy,
    capitalCents: capitalCents,
    capital: capital,
    netIncomeCents: netIncomeCents,
    cashAfterDebtCents: cashAfterDebtCents,
    cashToChurchCents: cashToChurchCents,
    dscr: dscr,
    schedule: sched,
    actualNetIncome: actual,
    // Pro-forma net income against what the operating statements actually reported. Positive
    // means the leases promise more than the building has been delivering.
    varianceVsActualCents: actual.months ? (netIncomeCents - actual.annualCents) : null,
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────────
var _finValRentRoll = [];
function finRenderPropertyIncomeCard(d, isAdminUI) {
  var val = (d.meta && d.meta.valuation) || {};
  _finValRentRoll = (val.rent_roll || []).map(function(r) {
    return { tenant: r.tenant || '', sqft: r.sqft || 0, annual_rent_cents: r.annual_rent_cents || 0 };
  });
  var pf = finComputePropertyProForma(d);
  var roll = pf.roll;
  var sub = roll.count + ' unit' + (roll.count === 1 ? '' : 's') + ' &middot; '
    + (roll.leasedPct != null ? (roll.leasedPct * 100).toFixed(0) + '% of the square footage leased' : 'no square footage recorded')
    + ' &middot; ' + finMoney0(roll.totalAnnualCents) + ' of contract rent a year';
  // .fin-card carries no margin of its own — the grid wrappers around it normally supply the
  // rhythm, and this card sits between two of them rather than inside one.
  return '<div class="fin-card" style="margin-bottom:22px;">'
    + '<div class="fin-card-title" style="font-size:20px;">What the units earn</div>'
    + '<div class="fin-card-sub">' + sub + (val.as_of_date ? ' &middot; worksheet last saved ' + esc(val.as_of_date) : '') + '</div>'
    + finRenderRentRollTable(isAdminUI)
    + (isAdminUI ? '<button class="btn-secondary" style="font-size:.75rem;padding:3px 10px;margin-top:6px;" onclick="finValAddTenant()">+ Add unit</button>' : '')
    // The assumption editor is a SIBLING of the recompute target, never a child of it. Every
    // keystroke recomputes the walk above, which rewrites #fin-proforma-out wholesale — an input
    // living inside it would be destroyed and recreated mid-word, which is exactly the one-
    // character-at-a-time bug FIN52 root-caused and this reintroduced.
    + '<div id="fin-proforma-out" style="margin-top:16px;">' + finRenderProFormaBody(pf) + '</div>'
    + '<div id="fin-capital-assumption">' + finRenderCapitalAssumptionEditor(pf.capital, isAdminUI) + '</div>'
    + '<details style="margin-top:14px;"><summary class="fin-disclosure">Operating costs, assumptions &amp; valuation worksheet</summary>'
      + '<div style="margin-top:10px;">' + finRenderValuationWorksheet(d, isAdminUI) + '</div></details>'
    + '</div>';
}
// The cash walk. Every line is signed the way it moves money, and the two lines a reader is most
// likely to mistake for double-counting say so on their own row.
function finRenderProFormaBody(pf) {
  var v = pf.valuation;
  function line(label, cents, opt) {
    opt = opt || {};
    return '<div style="display:flex;justify-content:space-between;gap:12px;font-size:13px;'
      + (opt.rule ? 'border-top:1px solid var(--warm-border);padding-top:8px;' : '')
      + (opt.total ? 'border-top:2px solid var(--color-navy);padding-top:9px;font-size:14px;' : '') + '">'
      + '<span style="' + (opt.total ? 'font-weight:800;color:var(--color-navy);' : 'color:var(--warm-ink-label);font-weight:600;') + '">' + label
      + (opt.note ? '<span style="display:block;font-weight:400;font-size:11px;color:var(--warm-gray);line-height:1.4;">' + opt.note + '</span>' : '')
      + '</span>'
      + '<b style="font-variant-numeric:tabular-nums;white-space:nowrap;'
      + (opt.total ? 'color:' + (cents >= 0 ? 'var(--color-teal)' : 'var(--danger)') + ';' : '') + '">'
      + (opt.negative ? '&minus;' : '') + '$' + finFmtMoney(Math.abs(cents) / 100) + '</b></div>';
  }
  var dscrText = pf.dscr == null
    ? (pf.debtServiceKnown ? 'no debt service this year' : 'mortgage payoff cannot be projected from the stored loan record')
    : pf.dscr.toFixed(2) + 'x' + (pf.dscr < 1 ? ' — the rents do not cover the mortgage' : ' — the rents cover the mortgage');
  var varianceHtml = pf.varianceVsActualCents == null ? ''
    : '<div class="fin-note-box" style="margin-top:12px;"><b>Against the operating statements.</b> This walk starts from the leases. AHRA\'s own reports for the trailing '
      + pf.actualNetIncome.months + ' month' + (pf.actualNetIncome.months === 1 ? '' : 's') + ' average '
      + finMoney0(pf.actualNetIncome.annualCents) + ' of net income a year, against the ' + finMoney0(pf.netIncomeCents)
      + ' the rent roll implies — a gap of ' + finFmtSigned(pf.varianceVsActualCents) + '. '
      + (Math.abs(pf.varianceVsActualCents) > Math.max(50000, Math.abs(pf.netIncomeCents) * 0.15)
        ? 'That is wide enough to chase: either a rent or a cost figure below is out of date, or the building is not collecting what it is contracted to.'
        : 'Close enough that the two readings agree.')
      + '</div>';
  return '<div style="display:flex;flex-direction:column;gap:9px;">'
    + line('Contract rent, all units', v.totalAnnualRentCents)
    + line('Utility reimbursement', v.grossRentalIncomeCents - v.totalAnnualRentCents)
    + line('Vacancy &amp; collection loss', v.vacancyCents, { negative: true })
    + line('Effective gross income', v.effectiveRentalIncomeCents, { rule: true })
    + line('Operating costs', v.itemizedOpCostsCents, { negative: true, note: 'utilities, trash, maintenance, landscaping, legal, property tax, insurance' })
    + line('Management fee', v.managementFeeCents, { negative: true, note: (pf.inputs.management_fee_pct * 100).toFixed(1) + '% of effective gross income' })
    + line('Net operating income', v.noiCents, { rule: true })
    + line('Mortgage interest', pf.interestCents, { negative: true, note: 'scheduled for ' + pf.year })
    + line('Mortgage principal', pf.principalCents, { negative: true, note: 'not an expense, but cash out the door' })
    + line('Capital allowance', pf.capitalCents, { negative: true, note: 'from ' + finPropertyCapitalSourceNote(pf.capital) + '; capitalized spending never reaches the P&amp;L' })
    + line('Cash to the church, ' + pf.year, pf.cashToChurchCents, { total: true })
    + '</div>'
    + '<div style="font-size:11.5px;color:var(--warm-gray);margin-top:10px;line-height:1.45;">'
    + 'A forward projection for <b>' + pf.year + '</b>, built from the leases up — so it will not match the cards above, which report ' + (pf.year - 1) + ' as AHRA actually recorded it. '
    + 'Debt-service coverage ' + dscrText + '. '
    + 'Property tax is not deducted twice — it is already one of the operating costs above.</div>'
    + varianceHtml;
}
// The capital assumption, edited beside the line it drives rather than on a settings screen away
// from its consequence. Three ways to say the same thing; whichever is picked, the resolver is the
// only thing that decides, so Planning and this card cannot disagree.
function finRenderCapitalAssumptionEditor(cap, isAdminUI) {
  if (!cap) return '';
  var method = cap.method === 'flat' || cap.method === 'per_sqft' || cap.method === 'flat_plus_sqft'
    ? cap.method : 'ledger';
  var warn = '';
  if (cap.source === 'per_sqft_no_sqft') {
    warn = '<div class="fin-note-box" style="margin-top:8px;border-left:3px solid var(--danger);"><b>A $/SF rate is set, but no unit square footage is recorded</b> &mdash; so it cannot be applied, and the figure above has fallen back to the ledger average. Enter square footage in the unit table, or switch to a flat figure.</div>';
  } else if (cap.source === 'flat_plus_sqft' && cap.perSqftCents && !cap.sqft) {
    warn = '<div class="fin-note-box" style="margin-top:8px;border-left:3px solid var(--danger);"><b>The $/SF part of this assumption is contributing nothing</b> &mdash; no unit square footage is recorded to apply it to, so only the flat amount is counted. Enter square footage in the unit table.</div>';
  }
  // The historical average is always named, never silently used: it is what somebody would
  // otherwise assume is a forecast, and for this property it is three finished one-off projects.
  var history = cap.entries
    ? 'History: $' + finFmtMoney(cap.totalCents / 100) + ' across ' + cap.entries + ' capital entr'
      + (cap.entries === 1 ? 'y' : 'ies') + ' over ' + cap.years.toFixed(1) + ' years, i.e. $'
      + finFmtMoney(cap.ledgerCents / 100) + '/yr averaged. That was one-time project work &mdash; a renovation, an HVAC replacement &mdash; so it is a record of what was spent, not a forecast of what recurs.'
    : 'No capital entries are recorded for this property, so there is no spending history to base an allowance on.';
  if (!isAdminUI) {
    return '<div class="fin-note-box" style="margin-top:12px;"><b>Capital allowance: $' + finFmtMoney(cap.cents / 100)
      + '/yr</b>, from ' + finPropertyCapitalSourceNote(cap) + '. ' + history + '</div>' + warn;
  }
  function opt(val, label) {
    return '<option value="' + val + '"' + (method === val ? ' selected' : '') + '>' + label + '</option>';
  }
  var wantsFlat = method === 'flat' || method === 'flat_plus_sqft';
  var wantsRate = method === 'per_sqft' || method === 'flat_plus_sqft';
  return '<details style="margin-top:12px;"' + (_finCapAssumptionOpen ? ' open' : '') + '>'
    + '<summary class="fin-disclosure" onclick="_finCapAssumptionOpen = !_finCapAssumptionOpen;">Capital allowance assumption &mdash; <span id="fin-cap-headline">$'
    + finFmtMoney(cap.cents / 100) + '/yr</span></summary>'
    + '<div style="margin-top:10px;">'
    + '<p style="font-size:.75rem;color:var(--warm-gray);margin:0 0 8px;">' + history + '</p>'
    + '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">'
      // Only the BASIS picker redraws this editor — it has to, so the right inputs appear. The
      // number fields below never redraw it; they update the derived readouts in place, because
      // rebuilding an input while somebody is typing in it is what limits them to one character.
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Basis<br><select id="fin-cap-method" onchange="finCapBasisChanged()" style="width:210px;">'
        + opt('ledger', 'Ledger average (history)')
        + opt('flat', 'Flat $ per year')
        + opt('per_sqft', '$ per SF per year')
        + opt('flat_plus_sqft', 'Flat $ plus $ per SF')
      + '</select></label>'
      + (wantsFlat
        ? '<label style="font-size:.75rem;color:var(--warm-gray);">' + (method === 'flat_plus_sqft' ? 'Flat base ($/yr)' : 'Allowance ($/yr)')
          + '<br><input type="number" id="fin-cap-flat" step="100" value="' + (cap.flatCents ? cap.flatCents / 100 : '') + '" placeholder="0" oninput="finCapAssumptionChanged()" style="width:120px;"></label>'
        : '')
      + (wantsRate
        ? '<label style="font-size:.75rem;color:var(--warm-gray);">' + (method === 'flat_plus_sqft' ? 'Plus rate ($/SF/yr)' : 'Reserve rate ($/SF/yr)')
          + '<br><input type="number" id="fin-cap-persqft" step="0.05" value="' + (cap.perSqftCents ? cap.perSqftCents / 100 : '') + '" placeholder="0.20" oninput="finCapAssumptionChanged()" style="width:130px;"></label>'
        : '')
      + '<button class="btn-primary" style="font-size:.78rem;padding:5px 12px;" onclick="finCapAssumptionSave()">Save assumption</button>'
      + '<span id="fin-cap-save-msg" style="font-size:.75rem;color:var(--warm-gray);"></span>'
    + '</div>'
    + '<p style="font-size:.72rem;color:var(--warm-gray);margin:8px 0 0;" id="fin-cap-preview">' + finCapAssumptionPreviewText(cap) + '</p>'
    + (wantsRate ? '<p style="font-size:.72rem;color:var(--warm-gray);margin:4px 0 0;">A commercial reserve is commonly $0.15&ndash;$0.25/SF/yr.</p>' : '')
    + '</div></details>' + warn;
}
// The derived readout: how the chosen basis arrives at its figure. Its own function so the live
// update and the first render cannot word it differently.
function finCapAssumptionPreviewText(cap) {
  if (!cap) return '';
  var rate = '$' + (cap.perSqftCents / 100).toFixed(2) + '/SF &times; ' + (cap.sqft || 0).toLocaleString('en-US')
    + ' SF = $' + finFmtMoney((cap.perSqftCents * (cap.sqft || 0)) / 100) + '/yr';
  if (cap.method === 'flat_plus_sqft') {
    return 'Flat $' + finFmtMoney(cap.flatCents / 100) + '/yr + ' + (cap.sqft ? rate : '$0/yr (no square footage recorded)')
      + ' = <b>$' + finFmtMoney(cap.cents / 100) + '/yr</b>.';
  }
  if (cap.method === 'per_sqft') return cap.sqft ? rate + '.' : 'No square footage is recorded in the unit table yet, so this rate cannot be applied.';
  if (cap.method === 'flat') return 'A flat $' + finFmtMoney(cap.cents / 100) + '/yr, unrelated to the building\'s size or its past spend.';
  return 'Using the ledger average of $' + finFmtMoney(cap.ledgerCents / 100) + '/yr until an assumption is set.';
}
var _finCapAssumptionOpen = false;
// Reads the editor's inputs into module state. Deliberately does NOT re-render the editor.
function finCapReadAssumptionInputs() {
  if (!_finProperty) return null;
  var meta = _finProperty.meta || (_finProperty.meta = {});
  var cap = meta.capital || (meta.capital = {});
  var mEl = document.getElementById('fin-cap-method');
  if (mEl) cap.method = mEl.value;
  var flatEl = document.getElementById('fin-cap-flat');
  if (flatEl) cap.annual_allowance_cents = Math.round((parseFloat(flatEl.value) || 0) * 100);
  var psEl = document.getElementById('fin-cap-persqft');
  if (psEl) cap.per_sqft_cents = Math.round((parseFloat(psEl.value) || 0) * 100);
  // A basis with no figure entered yet must resolve as a deliberate 0, not as unset — otherwise
  // picking "flat" and typing nothing silently falls back to the ledger average.
  if ((cap.method === 'flat' || cap.method === 'flat_plus_sqft') && cap.annual_allowance_cents == null) cap.annual_allowance_cents = 0;
  if ((cap.method === 'per_sqft' || cap.method === 'flat_plus_sqft') && cap.per_sqft_cents == null) cap.per_sqft_cents = 0;
  return cap;
}
// Typing. Updates only DERIVED text and the walk above — never the inputs, never this container.
function finCapAssumptionChanged() {
  if (!finCapReadAssumptionInputs()) return;
  _finCapAssumptionOpen = true;
  finCapRefreshDerived();
  finValRecompute();
}
function finCapRefreshDerived() {
  if (!_finProperty) return;
  var cap = finComputePropertyCapitalAllowanceCents(_finProperty, { sqft: finCapLiveSqft() });
  var head = document.getElementById('fin-cap-headline');
  if (head) head.innerHTML = '$' + finFmtMoney(cap.cents / 100) + '/yr';
  var prev = document.getElementById('fin-cap-preview');
  if (prev) prev.innerHTML = finCapAssumptionPreviewText(cap);
}
// The rent roll is edited in this same card, so a $/SF assumption has to follow the LIVE square
// footage rather than the last saved figure.
function finCapLiveSqft() {
  return finComputePropertyUnits(_finValRentRoll).totalSqft;
}
// Changing the basis must redraw the editor, so the inputs that basis needs appear. A select is
// not a text field, so there is no caret to lose.
function finCapBasisChanged() {
  if (!finCapReadAssumptionInputs()) return;
  _finCapAssumptionOpen = true;
  var host = document.getElementById('fin-capital-assumption');
  if (host) {
    host.innerHTML = finRenderCapitalAssumptionEditor(
      finComputePropertyCapitalAllowanceCents(_finProperty, { sqft: finCapLiveSqft() }), _userRole === 'admin');
  }
  finValRecompute();
}
function finCapAssumptionSave() {
  var msgEl = document.getElementById('fin-cap-save-msg');
  if (!_finProperty) return;
  var cap = (_finProperty.meta || {}).capital || {};
  var body = { capital: { method: cap.method || 'ledger',
    annual_allowance_cents: cap.annual_allowance_cents != null ? cap.annual_allowance_cents : null,
    per_sqft_cents: cap.per_sqft_cents != null ? cap.per_sqft_cents : null } };
  if (msgEl) msgEl.textContent = 'Saving…';
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/meta', { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }).then(function(r) {
    if (r && r.error) { if (msgEl) msgEl.textContent = r.error; return; }
    if (msgEl) msgEl.textContent = 'Saved.';
    finLoadProperty();
  }).catch(function(err) { if (msgEl) msgEl.textContent = (err && err.message) || 'Save failed.'; });
}
function finRenderValuationWorksheet(d, isAdminUI) {
  var val = (d.meta && d.meta.valuation) || {};
  var opCosts = val.operating_costs || {};
  var dis = isAdminUI ? '' : 'disabled';
  var opCostInputs = FIN_VAL_OP_COST_FIELDS.map(function(f) {
    return '<label style="font-size:.75rem;color:var(--warm-gray);">' + f[1] + ' ($/yr)<br><input type="number" id="fin-val-oc-' + f[0] + '" step="0.01" value="' + ((opCosts[f[0]]||0)/100) + '" oninput="finValRecompute()" ' + dis + ' style="width:110px;"></label>';
  }).join('');
  var assumptionsHtml = '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin:10px 0;">'
    + '<label style="font-size:.75rem;color:var(--warm-gray);">Utility Reimbursement ($/yr)<br><input type="number" id="fin-val-utilreimb" step="0.01" value="' + ((val.utility_reimbursement_cents||0)/100) + '" oninput="finValRecompute()" ' + dis + ' style="width:140px;"></label>'
    + '<label style="font-size:.75rem;color:var(--warm-gray);">Vacancy Rate %<br><input type="number" id="fin-val-vacancy" step="0.1" value="' + ((val.vacancy_rate_pct||0)*100) + '" oninput="finValRecompute()" ' + dis + ' style="width:90px;"></label>'
    + '<label style="font-size:.75rem;color:var(--warm-gray);">Management Fee %<br><input type="number" id="fin-val-mgmtfee" step="0.1" value="' + ((val.management_fee_pct||0)*100) + '" oninput="finValRecompute()" ' + dis + ' style="width:100px;"></label>'
    + '<label style="font-size:.75rem;color:var(--warm-gray);">Cap Rate<br><input type="number" id="fin-val-caprate" step="0.001" value="' + (val.cap_rate||0) + '" oninput="finValRecompute()" ' + dis + ' style="width:90px;"></label>'
    + '</div>';
  var actionsHtml = isAdminUI
    ? '<button class="btn-primary" style="font-size:.78rem;padding:5px 12px;" onclick="finValSave()">Save worksheet</button> <span id="fin-val-save-msg" style="font-size:.75rem;color:var(--warm-gray);margin-left:8px;"></span>'
    : '';
  return '<p style="font-size:.75rem;color:var(--warm-gray);margin:0 0 8px;">AHRA\'s income-capitalization worksheet. These same costs and assumptions feed the cash walk above, so a change here moves both the value and the cash figure.</p>'
    + '<div style="font-weight:600;font-size:.82rem;margin:0 0 6px;">Operating Costs</div>'
    + '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">' + opCostInputs + '</div>'
    + assumptionsHtml
    + '<div id="fin-val-output">' + finRenderValuationOutputBody(finComputePropertyValuation(finPropertyValuationInputsFromMeta(d.meta || {}))) + '</div>'
    + actionsHtml;
}
function finRenderValuationOutputBody(out) {
  function row(label, cents, bold) {
    return '<tr' + (bold ? ' style="border-top:1px solid var(--warm-border);"' : '') + '>'
      + '<td style="padding:4px 8px;' + (bold ? 'font-weight:700;' : '') + '">' + label + '</td>'
      + '<td style="padding:4px 8px;text-align:right;font-variant-numeric:tabular-nums;' + (bold ? 'font-weight:700;' : '') + '">$' + finFmtMoney(cents / 100) + '</td></tr>';
  }
  return '<div style="overflow-x:auto;"><table style="width:100%;max-width:420px;border-collapse:collapse;font-size:.8rem;">'
    + row('Gross rental income', out.grossRentalIncomeCents)
    + row('Less vacancy', out.vacancyCents)
    + row('Effective rental income', out.effectiveRentalIncomeCents, true)
    + row('Itemized operating costs', out.itemizedOpCostsCents)
    + row('Management fee', out.managementFeeCents)
    + row('Total operating costs', out.totalOperatingCostsCents, true)
    + row('Net operating income', out.noiCents, true)
    + row('Capitalized value', out.capitalizedValueCents, true)
    + '</table></div>';
}
// Monthly and annual rent are two views of one stored figure, so each input writes the shared
// value and refreshes only the OTHER box — never the one being typed in, which is the controlled-
// input round-trip that FIN52 root-caused.
function finRenderRentRollTable(isAdminUI) {
  var roll = finComputePropertyUnits(_finValRentRoll);
  var rows = roll.units.map(function(u, i) {
    var dis = isAdminUI ? '' : 'disabled';
    return '<tr>'
      + '<td style="padding:3px 6px;"><input type="text" id="fin-val-rr-' + i + '-tenant" value="' + esc(u.tenant) + '" oninput="finValRentRollFieldChange(' + i + ',\'tenant\',this.value)" ' + dis + ' style="width:150px;"></td>'
      + '<td style="padding:3px 6px;"><input type="number" id="fin-val-rr-' + i + '-sqft" value="' + u.sqft + '" oninput="finValRentRollFieldChange(' + i + ',\'sqft\',this.value)" ' + dis + ' style="width:80px;"></td>'
      + '<td style="padding:3px 6px;"><input type="number" id="fin-val-rr-' + i + '-monthly" step="0.01" value="' + (u.monthlyRentCents/100) + '" oninput="finValRentRollFieldChange(' + i + ',\'monthly_rent_cents\',this.value)" ' + dis + ' style="width:105px;"></td>'
      + '<td style="padding:3px 6px;"><input type="number" id="fin-val-rr-' + i + '-rent" step="0.01" value="' + (u.annualRentCents/100) + '" oninput="finValRentRollFieldChange(' + i + ',\'annual_rent_cents\',this.value)" ' + dis + ' style="width:115px;"></td>'
      + '<td style="padding:3px 6px;text-align:right;font-variant-numeric:tabular-nums;color:var(--warm-gray);" id="fin-val-rr-' + i + '-psf">' + (u.rentPerSqftCents != null ? '$' + (u.rentPerSqftCents/100).toFixed(2) : '—') + '</td>'
      + '<td style="padding:3px 6px;text-align:right;font-variant-numeric:tabular-nums;color:var(--warm-gray);" id="fin-val-rr-' + i + '-share">' + (u.vacant ? '<span style="color:var(--danger);font-weight:600;">vacant</span>' : (u.sharePct * 100).toFixed(0) + '%') + '</td>'
      + (isAdminUI ? '<td style="padding:3px 6px;"><button class="btn-secondary" style="font-size:.7rem;padding:2px 6px;color:var(--danger);" onclick="finValRemoveTenant(' + i + ')">Remove</button></td>' : '')
      + '</tr>';
  }).join('');
  var cols = isAdminUI ? 7 : 6;
  var foot = roll.count
    ? '<tfoot><tr style="border-top:2px solid var(--color-navy);font-weight:700;">'
      + '<td style="padding:5px 6px;">Total</td>'
      + '<td style="padding:5px 6px;">' + roll.totalSqft.toLocaleString('en-US') + '</td>'
      + '<td style="padding:5px 6px;font-variant-numeric:tabular-nums;">$' + finFmtMoney(roll.totalMonthlyCents/100) + '</td>'
      + '<td style="padding:5px 6px;font-variant-numeric:tabular-nums;">$' + finFmtMoney(roll.totalAnnualCents/100) + '</td>'
      + '<td colspan="' + (cols - 4) + '"></td></tr></tfoot>'
    : '';
  return '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;" id="fin-val-rentroll-table">'
    + '<thead style="border-bottom:1px solid var(--border);"><tr>'
    + '<th style="text-align:left;padding:4px 6px;">Unit / tenant</th>'
    + '<th style="text-align:left;padding:4px 6px;">SF</th>'
    + '<th style="text-align:left;padding:4px 6px;">Rent ($/mo)</th>'
    + '<th style="text-align:left;padding:4px 6px;">Rent ($/yr)</th>'
    + '<th style="text-align:right;padding:4px 6px;">$/SF</th>'
    + '<th style="text-align:right;padding:4px 6px;">Share</th>'
    + (isAdminUI ? '<th></th>' : '') + '</tr></thead>'
    + '<tbody id="fin-val-rentroll-body">' + (rows || '<tr><td colspan="' + cols + '" style="padding:6px;color:var(--warm-gray);">No units recorded yet.</td></tr>') + '</tbody>'
    + foot + '</table></div>';
}
function finValRentRollFieldChange(i, field, value) {
  var row = _finValRentRoll[i];
  if (!row) return;
  if (field === 'tenant') row.tenant = value;
  else if (field === 'sqft') row.sqft = parseInt(value, 10) || 0;
  else if (field === 'monthly_rent_cents') row.annual_rent_cents = Math.round((parseFloat(value) || 0) * 1200);
  else row.annual_rent_cents = Math.round((parseFloat(value) || 0) * 100);
  // Refresh the paired rent box and the derived cells, never the box being typed in.
  var u = finComputePropertyUnits(_finValRentRoll);
  var me = u.units[i];
  if (field === 'monthly_rent_cents') { var a = document.getElementById('fin-val-rr-' + i + '-rent'); if (a) a.value = me.annualRentCents / 100; }
  if (field === 'annual_rent_cents') { var mEl = document.getElementById('fin-val-rr-' + i + '-monthly'); if (mEl) mEl.value = me.monthlyRentCents / 100; }
  u.units.forEach(function(un, j) {
    var psf = document.getElementById('fin-val-rr-' + j + '-psf');
    if (psf) psf.innerHTML = un.rentPerSqftCents != null ? '$' + (un.rentPerSqftCents / 100).toFixed(2) : '&mdash;';
    var sh = document.getElementById('fin-val-rr-' + j + '-share');
    if (sh) sh.innerHTML = un.vacant ? '<span style="color:var(--danger);font-weight:600;">vacant</span>' : (un.sharePct * 100).toFixed(0) + '%';
  });
  finValRecompute();
}
function finValReplaceRentRollTable() {
  var tbl = document.getElementById('fin-val-rentroll-table');
  if (!tbl) return;
  tbl.outerHTML = finRenderRentRollTable(true).replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '');
  finValRecompute();
}
function finValAddTenant() {
  _finValRentRoll.push({ tenant: '', sqft: 0, annual_rent_cents: 0 });
  finValReplaceRentRollTable();
}
function finValRemoveTenant(i) {
  _finValRentRoll.splice(i, 1);
  finValReplaceRentRollTable();
}
function finValReadInputs() {
  var opCosts = {};
  FIN_VAL_OP_COST_FIELDS.forEach(function(f) {
    var el = document.getElementById('fin-val-oc-' + f[0]);
    opCosts[f[0]] = el ? Math.round((parseFloat(el.value)||0) * 100) : 0;
  });
  function num(id) { var el = document.getElementById(id); return el ? (parseFloat(el.value) || 0) : 0; }
  return {
    rentRoll: _finValRentRoll,
    utility_reimbursement_cents: Math.round(num('fin-val-utilreimb') * 100),
    vacancy_rate_pct: num('fin-val-vacancy') / 100,
    operating_costs: opCosts,
    management_fee_pct: num('fin-val-mgmtfee') / 100,
    cap_rate: num('fin-val-caprate'),
  };
}
// Rewrites only OUTPUT containers, never an input, so typing is never interrupted.
function finValRecompute() {
  var inputs = finValReadInputs();
  var valOut = document.getElementById('fin-val-output');
  if (valOut) valOut.innerHTML = finRenderValuationOutputBody(finComputePropertyValuation(inputs));
  var pfOut = document.getElementById('fin-proforma-out');
  if (pfOut && _finProperty) pfOut.innerHTML = finRenderProFormaBody(finComputePropertyProForma(_finProperty, { inputs: inputs }));
}
function finValSave() {
  var msgEl = document.getElementById('fin-val-save-msg');
  var inputs = finValReadInputs();
  if (!inputs.cap_rate || inputs.cap_rate <= 0) { msgEl.textContent = 'Enter a valid cap rate.'; return; }
  var out = finComputePropertyValuation(inputs);
  var body = { valuation: {
    rent_roll: _finValRentRoll,
    utility_reimbursement_cents: inputs.utility_reimbursement_cents,
    vacancy_rate_pct: inputs.vacancy_rate_pct,
    operating_costs: inputs.operating_costs,
    management_fee_pct: inputs.management_fee_pct,
    cap_rate: inputs.cap_rate,
    gross_rental_income_cents: out.grossRentalIncomeCents,
    total_operating_costs_incl_mgmt_fee_cents: out.totalOperatingCostsCents,
    net_operating_income_cents: out.noiCents,
    capitalized_value_cents: out.capitalizedValueCents,
    as_of_date: new Date().toISOString().slice(0, 10),
  } };
  msgEl.textContent = 'Saving…';
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/meta', { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }).then(function(d) {
    if (d && d.error) { msgEl.textContent = d.error; return; }
    msgEl.textContent = 'Saved.';
    finLoadProperty();
  }).catch(function(err) { msgEl.textContent = err && err.message || 'Save failed.'; });
}
// Single-step: parses and commits the AHRA "Budget Detail" export in one request (unlike the
// Church Report imports' preview-then-commit — see the parsePropertyBudgetDetailGrid() comment
// in api-finance.js for why: this export's shape is fixed and the two rollup rows read are
// unambiguous, so a review step has little to catch). Reloads property data on success so the
// Revenue vs. Expenses chart picks up the new budget series immediately.
function finPropertyBudgetImportFileSelected(inputEl) {
  var file = inputEl.files && inputEl.files[0];
  if (!file) return;
  var statusEl = document.getElementById('fin-property-budget-import-status');
  if (statusEl) statusEl.textContent = 'Importing…';
  var fd = new FormData();
  fd.append('file', file);
  fetch('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/budget-import', { method: 'POST', body: fd, credentials: 'include' })
    .then(function(r) {
      return r.json().then(function(d) {
        if (r.status === 401) { location.href = '/chms'; throw new Error('Unauthorized'); }
        if (!r.ok) throw new Error(d.error || 'Could not import this file.');
        return d;
      });
    })
    .then(function(d) {
      if (statusEl) statusEl.textContent = 'Imported ' + d.imported + ' month(s): ' + d.months.map(function(m) { return m.period; }).join(', ') + '.';
      inputEl.value = '';
      finLoadProperty();
      finRefreshImportStatus();
    })
    .catch(function(err) {
      if (err.message !== 'Unauthorized' && statusEl) statusEl.textContent = 'Error: ' + err.message;
    });
}

function finPropertyToggleMonthlyCsvPanel() {
  var panel = document.getElementById('fin-property-monthly-csv-panel');
  if (panel) panel.style.display = (panel.style.display === 'none') ? 'block' : 'none';
}

// Bulk import of one or more months from the AHRA report's own "monthly financials" CSV row
// format — an alternative to typing each field into the "+ Add Month" modal by hand for every
// new report. Reuses the same period-YYYY-MM upsert as that modal, so re-pasting an already-
// imported month's row safely updates it in place rather than duplicating.
function finPropertyImportMonthlyCsv() {
  var textEl = document.getElementById('fin-property-monthly-csv-text');
  var statusEl = document.getElementById('fin-property-monthly-csv-status');
  var csv = textEl ? textEl.value.trim() : '';
  if (!csv) { if (statusEl) statusEl.textContent = 'Paste a CSV row first.'; return; }
  if (statusEl) statusEl.textContent = 'Importing…';
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/monthly-import-csv', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ csv: csv }) })
    .then(function(d) {
      if (d && d.error) { if (statusEl) statusEl.textContent = d.error; return; }
      if (statusEl) statusEl.textContent = 'Imported ' + d.imported + ' month(s): ' + d.periods.join(', ') + '.';
      finRefreshImportStatus();
      if (textEl) textEl.value = '';
      finLoadProperty();
    })
    .catch(function(err) { if (statusEl) statusEl.textContent = err && err.message || 'Import failed.'; });
}

// "Available for Distribution" — the Finance Workspace handoff's Property-tab navy footer bar:
// this year's net income, less what was set aside into reserves and committed to capital
// projects this year. A computed ESTIMATE for planning purposes — distinct from "Distributions
// to Church" below, which is the actual historical record of amounts already sent.
function finComputeAvailableForDistribution(d, opts) {
  opts = opts || {};
  var now = opts.now ? new Date(opts.now) : new Date();
  var year = now.getFullYear();
  var curYear = (d.annualSummary || []).filter(function(y) { return y.year === year; })[0];
  var annualNetCents = curYear ? curYear.net_income_cents : 0;
  var reserveContribCents = 0;
  if (d.reserves) Object.keys(d.reserves).forEach(function(key) {
    (d.reserves[key] || []).forEach(function(r) {
      if (String(r.report_month || '').slice(0, 4) === String(year)) reserveContribCents += (r.contribution_cents || 0);
    });
  });
  var capitalCents = 0;
  (d.capitalLedger || []).forEach(function(c) {
    if (String(c.entry_date || '').slice(0, 4) === String(year)) capitalCents += (c.amount_cents || 0);
  });
  // Mortgage PRINCIPAL, previously missing entirely. It is not an expense, so it is not inside
  // net income, but it is cash out the door — the single largest omission on this card.
  // Pro-rated to the months elapsed so it matches the YTD net income it is being taken from.
  var sched = finAmortizationSchedule(((d.meta || {}).loan) || {}, opts);
  var principalCents = 0;
  if (sched && !(sched.payoffYear && year > sched.payoffYear)) {
    var ref = sched.byYear[year] || sched.years[0];
    var rate = (ref && ref.monthsCovered) ? ref.principalCents / ref.monthsCovered : 0;
    var monthsElapsed = (year === now.getFullYear()) ? (now.getMonth() + 1) : 12;
    principalCents = Math.round(rate * monthsElapsed);
  }
  return {
    year: year, annualNetCents: annualNetCents, reserveContribCents: reserveContribCents,
    capitalCents: capitalCents, principalCents: principalCents,
    availableCents: annualNetCents - reserveContribCents - capitalCents - principalCents,
  };
}
// "Amount Dispersed" — this calendar year's actual confirmed distributions already sent to the
// church (from the Distributions to Church record below), distinct from the estimate above.
// Distributions paid AFTER the report a cash figure came from. AHRA's "available to distribute" is
// cash on hand at the report date, so anything paid on or before that month has already left the
// account and is inside the figure — subtracting it again double-counts. Anything paid since is
// genuinely not reflected yet and must come off.
function finComputeDistributionsAfter(d, period) {
  var rows = (d && d.distributions || []).filter(function(dd) {
    return period ? String(dd.period || '') > String(period) : true;
  });
  return {
    cents: rows.reduce(function(s, dd) { return s + (dd.amount_cents || 0); }, 0),
    periods: rows.map(function(dd) { return dd.period; }),
  };
}
function finComputeDistributedThisYear(d) {
  var year = new Date().getFullYear();
  var cents = (d.distributions || []).filter(function(dd) { return String(dd.period || '').slice(0, 4) === String(year); })
    .reduce(function(sum, dd) { return sum + (dd.amount_cents || 0); }, 0);
  return { year: year, cents: cents };
}

// Pure — no DOM — rolls the last lender-CONFIRMED mortgage balance forward using each
// subsequent month's real principal payment (loan_payment_cents − interest_expense_cents), so a
// fresh lender confirmation isn't needed every time a new month's report comes in. Only months
// whose period is strictly AFTER the confirmed as-of month are applied — anything at or before
// that date is already reflected in the confirmed figure (the exact reasoning behind why June
// 2026's own payment wasn't subtracted from the 2026-07-20 confirmation — see FIN30).
function finComputeMortgageRemainingCents(loan, monthly) {
  if (!loan || loan.balance_cents == null || !loan.balance_as_of_date) {
    return { cents: (loan && loan.balance_cents != null) ? loan.balance_cents : null, asOf: loan ? loan.balance_as_of_date : null, monthsApplied: [] };
  }
  var asOfMonth = String(loan.balance_as_of_date).slice(0, 7); // YYYY-MM
  var applicable = (monthly || [])
    .filter(function(m) { return m.period > asOfMonth && m.loan_payment_cents != null && m.interest_expense_cents != null; })
    .sort(function(a, b) { return a.period < b.period ? -1 : 1; });
  var cents = loan.balance_cents;
  applicable.forEach(function(m) { cents -= (m.loan_payment_cents - m.interest_expense_cents); });
  return { cents: cents, asOf: applicable.length ? applicable[applicable.length - 1].period : loan.balance_as_of_date, monthsApplied: applicable.map(function(m) { return m.period; }) };
}
// Two questions, in this order: does it fund itself, and what can we take. Everything else on
// this page is reference and is collapsed. The admin controls that used to be interleaved here
// (budget import, CSV paste, +Add Month, base-minimum and reserve editing, the valuation
// calculator) moved to Data & Imports — see finRenderPropertyAdminTools below.
var _finPropertyExpand = {};
function finPropertyToggleLedger(key) {
  _finPropertyExpand[key] = !_finPropertyExpand[key];
  if (_finProperty) finRenderProperty(_finProperty);
}
function finLedgerStrip(key, title, sub, bodyHtml) {
  var open = !!_finPropertyExpand[key];
  return '<div class="fin-card fin-ledger-strip">'
    + '<div class="fin-ledger-strip-hdr">'
    + '<div><div class="fin-ledger-strip-title">' + title + '</div><div class="fin-ledger-strip-sub">' + sub + '</div></div>'
    + '<button class="btn-secondary" style="white-space:nowrap;" onclick="finPropertyToggleLedger(' + jsAttr(key) + ')">' + (open ? 'Hide &#9662;' : 'Show &#9656;') + '</button>'
    + '</div>'
    + (open ? '<div style="margin-top:14px;">' + bodyHtml + '</div>' : '')
    + '</div>';
}
// The mini P&L, and it must ADD UP on its face: every printed line is subtracted from the one
// above it to reach the printed total. It used to take the total from net income independently
// while printing an expenses figure that covered only the months AHRA broke expenses out for —
// so the visible arithmetic missed $16,568.60 for 2026 and could not reach its own bottom line.
// (The expenses figure itself is fixed server-side in computePropertyAnnualSummary.)
// Mortgage principal is deducted here for the same reason it is deducted in the forecast: it is
// cash out of this property's account that never appears as an expense, so leaving it out
// overstated what reaches the church by ~$17,000 over the half-year.
function finRenderPropertyFundsItself(d) {
  var year = new Date().getFullYear();
  var cur = (d.annualSummary || []).filter(function(y) { return y.year === year; })[0];
  var a = finComputeAvailableForDistribution(d);
  var taken = finComputeDistributedThisYear(d);
  if (!cur) {
    return '<div class="fin-card"><div class="fin-card-title" style="font-size:20px;">Does it fund itself?</div>'
      + '<p style="font-size:.85rem;color:var(--warm-gray);">No ' + year + ' months recorded yet — add this year\'s AHRA reports from the Data &amp; Imports tab.</p></div>';
  }
  // Built by subtraction from the lines actually shown, so the card cannot disagree with itself.
  var netToChurch = cur.total_revenue_cents - cur.total_expenses_cents - a.principalCents - a.reserveContribCents;
  function line(label, cents, negative, note) {
    return '<div style="display:flex;justify-content:space-between;font-size:13px;gap:12px;">'
      + '<span style="color:var(--warm-ink-label);font-weight:600;">' + label
      + (note ? '<span style="display:block;font-weight:400;font-size:11px;color:var(--warm-gray);">' + note + '</span>' : '') + '</span>'
      + '<b style="font-variant-numeric:tabular-nums;white-space:nowrap;">' + (negative ? '&minus;' : '') + '$' + finFmtMoney(Math.abs(cents) / 100) + '</b></div>';
  }
  var derived = cur.expense_months_derived || 0;
  var kpis = finComputePropertyKpis(d);
  function tile(k) {
    return '<div class="fin-mini-tile"><div class="fin-eyebrow">' + k.lbl + '</div>'
      + '<div class="fin-mini-tile-val">' + k.val + '</div>'
      + '<div style="font-size:11px;color:var(--warm-gray);">' + esc(k.chip || '') + '</div></div>';
  }
  return '<div class="fin-card">'
    + '<div class="fin-card-title" style="font-size:20px;">Does it fund itself?</div>'
    + '<div class="fin-card-sub">' + year + ' to date, after the mortgage. ' + (netToChurch >= 0 ? 'Yes — with ' + finMoney0(netToChurch) + ' to spare.' : 'Not this year — it is ' + finMoney0(-netToChurch) + ' short after debt service and reserves.') + '</div>'
    + '<div style="display:flex;flex-direction:column;gap:9px;">'
    + line('Rental revenue', cur.total_revenue_cents, false)
    + line('Operating expenses', cur.total_expenses_cents, true,
        derived ? derived + ' month' + (derived === 1 ? '' : 's') + ' reconstructed as revenue &minus; net income, where the report gave no expenses line' : '')
    + line('Mortgage principal', a.principalCents, true, 'cash out, but never an expense &mdash; so it is not in net income')
    + line('To reserves', a.reserveContribCents, true)
    + '<div style="display:flex;justify-content:space-between;font-size:14px;border-top:2px solid var(--color-navy);padding-top:9px;">'
      + '<span style="font-weight:800;color:var(--color-navy);">Net to the church</span>'
      + '<b style="font-variant-numeric:tabular-nums;color:' + (netToChurch >= 0 ? 'var(--color-teal)' : 'var(--danger)') + ';">' + finFmtSigned(netToChurch) + '</b></div>'
    + '</div>'
    // What this figure is NOT. It is a year's earnings, not money sitting in a bank account, and
    // part of it has already been paid out — both of which a reader will otherwise assume.
    + '<div style="font-size:11.5px;color:var(--warm-gray);margin-top:10px;line-height:1.5;">'
      + 'This is what the property <b>earned</b> across ' + year + ' so far, not cash on hand &mdash; the figure in the navy card is a bank balance on one date, so the two will not match. '
      + (taken.cents ? 'Of this, ' + finMoney0(taken.cents) + ' has already been distributed to the church in ' + year + '. ' : '')
      + 'The reserve line above is ' + year + '&rsquo;s contributions only, not the total reserve balance.'
    + '</div>'
    + '<div class="fin-grid-2" style="margin-top:14px;gap:10px;">' + tile(kpis[0]) + tile(kpis[1]) + '</div>'
    + '</div>';
}
// AHRA's own "cash minus reserves" figure for the latest month, against what has already been
// taken this year. Deliberately the monthly cash figure, not the full-year accrual estimate the
// old "Available for Distribution" bar showed — a distribution is a cash decision.
function finRenderPropertyDistributionHero(d, isAdminUI) {
  var latest = finComputeLatestDistributionAmount(d);
  var taken = finComputeDistributedThisYear(d);
  var onHand = finComputePropertyReservesOnHandCents(d);
  // Only what was paid AFTER the report. A distribution made before it is already out of the bank
  // account AHRA counted, so deducting it here would charge the church for the same money twice.
  var since = latest ? finComputeDistributionsAfter(d, latest.period) : { cents: 0, periods: [] };
  var still = latest ? latest.cents - since.cents : null;
  var sinceNote = latest
    ? (since.cents
      ? ' Less ' + finMoney0(since.cents) + ' distributed since that report (' + since.periods.map(esc).join(', ') + ').'
      : ' Any distribution taken on or before that month is already out of this figure, so it is not deducted again.')
    : '';
  return '<div class="fin-navy-card fin-prop-hero">'
    + '<div>'
      + '<div class="fin-navy-label">Available to distribute today</div>'
      + '<div class="fin-hero-val">' + (latest ? '$' + finFmtMoney(latest.cents / 100) : '—') + '</div>'
      + '<div style="font-size:13px;color:rgba(255,255,255,.78);line-height:1.5;">'
      + (latest
        ? 'AHRA&rsquo;s own figure: <b>cash in the bank</b> at the ' + esc(latest.period) + ' report, less outstanding bills, less the ' + finMoney0(onHand) + ' total property reserve <i>balance</i>.' + sinceNote
        : 'No AHRA report with a distribution figure has been recorded yet.')
      + '</div>'
    + '</div>'
    + '<div class="fin-hero-split">'
      + '<div><div class="fin-navy-sublabel">Already taken in ' + taken.year + '</div><div class="fin-hero-sub-val">$' + finFmtMoney(taken.cents / 100) + '</div>'
        + '<div style="font-size:11px;color:rgba(255,255,255,.6);line-height:1.35;">a record of what has been paid, not a deduction from the figure at left</div></div>'
      + '<div><div class="fin-navy-sublabel">Still available</div><div class="fin-hero-sub-val" style="color:var(--pale-gold);">' + (still != null ? '$' + finFmtMoney(Math.max(0, still) / 100) : '—') + '</div></div>'
    + '</div>'
    // FIN44 wrote this reconciliation; FIN57 replaced the card it lived on and left the figures
    // to look like they contradict each other. It belongs wherever the cash figure is shown.
    + '<div style="font-size:11.5px;color:rgba(255,255,255,.62);line-height:1.5;border-top:1px solid rgba(255,255,255,.22);padding-top:10px;">'
      + 'This is a <b>cash balance on a date</b>. The &ldquo;Does it fund itself?&rdquo; card beside it is a <b>full-year flow</b> &mdash; what the property earned across the year after debt and reserves &mdash; so the two measure different things and will not match. '
      + 'The reserve figure above is the total <i>balance</i> AHRA holds, including the flat base-minimum cushion carried over from prior years; the reserve line on that card is only <i>this year&rsquo;s</i> contributions.'
    + '</div>'
    + (isAdminUI ? '<div><button class="btn-white" onclick="finNavGo(\'data\')">Record a distribution &rarr;</button></div>' : '')
    + '</div>';
}
function finRenderPropertyReservesCard(d) {
  var taxRows = ((d.reserves && d.reserves.property_tax) || []).slice().sort(function(a, b) { return a.report_month < b.report_month ? 1 : -1; });
  var taxCents = taxRows.length ? (taxRows[0].reserve_after_cents || 0) : 0;
  var baseCents = (d.meta && d.meta.reserves && d.meta.reserves.base_minimum_cents) || 0;
  var latestMonth = finPropertyLatestReserveMonth(d);
  var totalCents = finComputePropertyReservesOnHandCents(d);
  function line(label, cents, bold) {
    return '<div style="display:flex;justify-content:space-between;' + (bold ? 'border-top:1px solid var(--warm-border);padding-top:8px;' : '') + '">'
      + '<span style="' + (bold ? 'font-weight:800;color:var(--color-navy);' : 'color:var(--warm-ink-label);font-weight:600;') + '">' + label + '</span>'
      + '<b style="font-variant-numeric:tabular-nums;">$' + finFmtMoney(cents / 100) + '</b></div>';
  }
  return '<div class="fin-card">'
    + '<div class="fin-card-title" style="font-size:19px;">Reserves</div>'
    + '<div class="fin-card-sub">' + (latestMonth ? 'AHRA&rsquo;s total property reserve, ' + esc(latestMonth.period) + '.' : 'Reconstructed from the reserve ledger plus the base minimum — no AHRA total recorded yet.') + '</div>'
    + '<div style="display:flex;flex-direction:column;gap:8px;font-size:12.5px;">'
    + line('Property tax reserve', taxCents, false)
    + line('Base minimum reserve', baseCents, false)
    + line('Total', totalCents, true)
    + '</div>'
    + '<div style="font-size:11.5px;color:var(--warm-gray);margin-top:10px;line-height:1.45;">The tax reserve zeroes each November when the bill is paid, then rebuilds.</div>'
    + '<details style="margin-top:10px;"><summary class="fin-disclosure">Reserve schedule</summary><div style="margin-top:8px;">' + finRenderPropertyTaxReserve(d, false) + '</div></details>'
    + '</div>';
}
function finRenderPropertyValuationCard(d) {
  var meta = d.meta || {};
  var val = meta.valuation || {};
  var loan = meta.loan || {};
  var mortgage = finComputeMortgageRemainingCents(loan, d.monthly || []);
  var valueCents = val.capitalized_value_cents || 0;
  var equityCents = mortgage.cents != null ? (valueCents - mortgage.cents) : null;
  var ltvPct = (valueCents && mortgage.cents != null) ? (mortgage.cents / valueCents) : null;
  function tile(label, value, positive) {
    return '<div class="fin-mini-tile' + (positive ? ' positive' : '') + '">'
      + '<div class="fin-eyebrow"' + (positive ? ' style="color:var(--sage-text);"' : '') + '>' + label + '</div>'
      + '<div class="fin-mini-tile-val">' + value + '</div></div>';
  }
  return '<div class="fin-card">'
    + '<div class="fin-card-title" style="font-size:19px;">Valuation &amp; equity</div>'
    + '<div class="fin-card-sub">Mortgage rolled forward from the lender-confirmed balance using real principal payments'
    + (mortgage.monthsApplied.length ? ' (' + mortgage.monthsApplied.length + ' month' + (mortgage.monthsApplied.length === 1 ? '' : 's') + ' applied since ' + esc(loan.balance_as_of_date || '') + ')' : '') + '.</div>'
    + '<div class="fin-grid-2" style="gap:10px;">'
    + tile('Valuation', '$' + finFmtMoney(valueCents / 100), false)
    + tile('Mortgage left', mortgage.cents != null ? '$' + finFmtMoney(mortgage.cents / 100) : '—', false)
    + tile('Equity', equityCents != null ? '$' + finFmtMoney(equityCents / 100) : '—', true)
    + tile('Loan-to-value', ltvPct != null ? (ltvPct * 100).toFixed(1) + '%' : '—', false)
    + '</div></div>';
}
function finRenderProperty(d) {
  var el = document.getElementById('fin-property-root');
  if (!el || !d) return;
  var meta = d.meta || {};
  var prop = meta.property || {};
  var isAdminUI = (_userRole === 'admin');
  var monthly = (d.monthly || []).slice().sort(function(a, b) { return a.period < b.period ? 1 : -1; });
  var latestPeriod = monthly.length ? monthly[0].period : '';

  var subParts = [];
  if (prop.type) subParts.push(esc(prop.type));
  subParts.push('owned by ' + esc(prop.owner || 'Timothy Lutheran Church'));
  if (prop.property_manager) subParts.push('managed by ' + esc(prop.property_manager));
  if (latestPeriod) subParts.push('report through ' + esc(latestPeriod));

  // Ledger bodies. Row-level Edit/Delete stay inside the expanded tables, per the handoff — the
  // BULK admin tools are what moved to Data & Imports, not the ability to correct one row.
  function cell(cents) { return cents == null ? '<span style="color:var(--warm-gray);">—</span>' : '$' + finFmtMoney(cents / 100); }
  var monthRows = monthly.map(function(m) {
    return '<tr><td style="padding:5px 8px;font-weight:600;">' + esc(m.period) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + (m.occupancy_pct != null ? (m.occupancy_pct * 100).toFixed(1) + '%' : '—') + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + cell(m.total_revenue_cents) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + cell(m.total_expenses_cents) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + cell(m.net_income_cents) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + cell(m.net_operating_income_cents) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + cell(m.reserve_balance_cents) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + cell(m.available_for_distribution_cents) + '</td>'
      + (isAdminUI ? '<td style="padding:5px 8px;white-space:nowrap;"><button class="btn-secondary" style="font-size:.72rem;padding:2px 6px;" onclick="finPropertyOpenMonthModal(\'' + esc(m.period) + '\')">Edit</button> <button class="btn-secondary" style="font-size:.72rem;padding:2px 6px;color:var(--danger);" onclick="finPropertyDeleteMonth(\'' + esc(m.period) + '\')">Delete</button></td>' : '') + '</tr>';
  }).join('');
  var monthlyHtml = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr><th style="text-align:left;padding:5px 8px;">Period</th><th style="text-align:right;padding:5px 8px;">Occ.</th><th style="text-align:right;padding:5px 8px;">Revenue</th><th style="text-align:right;padding:5px 8px;">Expenses</th><th style="text-align:right;padding:5px 8px;">Net Income</th><th style="text-align:right;padding:5px 8px;">NOI</th><th style="text-align:right;padding:5px 8px;">Reserve</th><th style="text-align:right;padding:5px 8px;">Distribution</th>' + (isAdminUI ? '<th></th>' : '') + '</tr></thead>'
    + '<tbody>' + (monthRows || '<tr><td colspan="9" style="padding:10px;color:var(--warm-gray);">No months recorded yet.</td></tr>') + '</tbody></table></div>';

  var dists = (d.distributions || []).slice().sort(function(a, b) { return a.period < b.period ? 1 : -1; });
  var distRows = dists.map(function(dd) {
    return '<tr><td style="padding:5px 8px;">' + esc(dd.period) + '</td><td style="padding:5px 8px;text-align:right;">$' + finFmtMoney(dd.amount_cents / 100) + '</td>'
      + (isAdminUI ? '<td style="padding:5px 8px;"><button class="btn-secondary" style="font-size:.72rem;padding:2px 6px;color:var(--danger);" onclick="finPropertyDeleteDistribution(\'' + esc(dd.period) + '\')">Delete</button></td>' : '') + '</tr>';
  }).join('');
  var distHtml = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr><th style="text-align:left;padding:6px 8px;">Period</th><th style="text-align:right;padding:6px 8px;">Amount</th>' + (isAdminUI ? '<th></th>' : '') + '</tr></thead>'
    + '<tbody>' + (distRows || '<tr><td colspan="3" style="padding:10px;color:var(--warm-gray);">No distributions recorded yet.</td></tr>') + '</tbody></table></div>';

  var thisYear = String(new Date().getFullYear());
  var capitalThisYear = (d.capitalLedger || []).filter(function(c) { return String(c.entry_date || '').slice(0, 4) === thisYear; })
    .reduce(function(s, c) { return s + (c.amount_cents || 0); }, 0);
  var recentDists = dists.slice(0, 2).map(function(dd) { return esc(dd.period) + ' $' + finFmtMoney(dd.amount_cents / 100); }).join(' &middot; ');

  el.innerHTML = finPageHeader(esc(prop.name || '3277 Ivanhoe'), subParts.join(' &middot; '), '<button class="btn-secondary" onclick="window.print()">Print</button>')
    + '<div class="fin-grid-hero">'
      + finRenderPropertyDistributionHero(d, isAdminUI)
      + finRenderPropertyFundsItself(d)
    + '</div>'
    + '<div class="fin-grid-charts">'
      + '<div class="fin-card">' + finRenderPropertyCharts(d) + '</div>'
      + '<div style="display:flex;flex-direction:column;gap:16px;">'
        + finRenderPropertyValuationCard(d)
        + finRenderPropertyReservesCard(d)
      + '</div>'
    + '</div>'
    + finRenderPropertyIncomeCard(d, isAdminUI)
    + '<div class="fin-grid-3">'
      + finLedgerStrip('monthly', 'Monthly financials', monthly.length + ' month' + (monthly.length === 1 ? '' : 's') + ' on record', monthlyHtml)
      + finLedgerStrip('capital', 'Capital &amp; repairs ledger', capitalThisYear ? '$' + finFmtMoney(capitalThisYear / 100) + ' this year' : 'nothing capitalized this year',
          finRenderCapitalImprovements(d, isAdminUI) + finRenderRepairs(d, isAdminUI))
      + finLedgerStrip('dists', 'Distributions to church', recentDists || 'none recorded', distHtml)
    + '</div>'
    + finRenderInsuranceAllocation(d);
}
// The bulk admin tools, rendered onto the Data & Imports tab rather than this report — an upload
// control has no business on a page the council reads from.
function finRenderPropertyAdminTools(d) {
  var el = document.getElementById('fin-data-property-tools');
  if (!el) return;
  if (_userRole !== 'admin') { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="fin-card">'
    + '<div class="fin-card-title" style="font-size:20px;">3277 Ivanhoe &mdash; data entry</div>'
    + '<div class="fin-card-sub">Everything that writes to the property record. The report itself is on the Commercial Property tab.</div>'
    + '<div id="fin-property-budget-import-label" style="margin-bottom:14px;padding:10px 14px;background:var(--warm-surface-page);border-radius:10px;">'
      + '<label style="font-size:.78rem;color:var(--warm-gray);font-weight:600;">Import Budget (AHRA "Budget Detail" export) <input type="file" accept=".xlsx" onchange="finPropertyBudgetImportFileSelected(this)" style="display:block;margin-top:4px;"></label>'
      + '<div id="fin-property-budget-import-status" style="font-size:.76rem;color:var(--warm-gray);margin-top:6px;"></div>'
    + '</div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">'
      + '<button class="btn-primary" onclick="finPropertyOpenMonthModal()">+ Add Month</button>'
      + '<button class="btn-secondary" onclick="finPropertyToggleMonthlyCsvPanel()">Import monthly CSV</button>'
    + '</div>'
    + '<div id="fin-property-monthly-csv-panel" style="display:none;margin:8px 0 14px;padding:10px 14px;background:var(--warm-surface-page);border-radius:10px;">'
      + '<label style="font-size:.78rem;color:var(--warm-gray);font-weight:600;">Paste the AHRA report\'s "monthly financials" CSV row(s) below (same header row as '
      + '<code>period,occupancy_pct,total_revenue,operating_expenses,...</code>) to add or update those months in one step.</label>'
      + '<textarea id="fin-property-monthly-csv-text" rows="4" style="width:100%;font-family:monospace;font-size:.76rem;margin-top:6px;" placeholder="period,occupancy_pct,total_revenue,operating_expenses,net_operating_income,non_operating_expenses,net_income,..."></textarea>'
      + '<div style="margin-top:8px;"><button class="btn-primary" style="font-size:.78rem;padding:4px 10px;" onclick="finPropertyImportMonthlyCsv()">Import</button> '
      + '<span id="fin-property-monthly-csv-status" style="font-size:.76rem;color:var(--warm-gray);margin-left:8px;"></span></div>'
    + '</div>'
    + '<details><summary class="fin-disclosure">Reserves</summary><div style="margin-top:10px;">'
      + finRenderBaseMinimumReserve(d, true) + finRenderPropertyTaxReserve(d, true) + '</div></details>'
    // The rent roll and valuation worksheet live on the Commercial Property tab itself, not here.
    // They are not a bulk upload — they are the figures the council reads, edited in place beside
    // the cash walk they drive. Rendering a second copy here would also duplicate every fin-val-*
    // element id, and getElementById would silently read whichever copy came first in the DOM.
    + '<p style="font-size:.78rem;color:var(--warm-gray);margin:10px 0 0;">Unit rents, operating costs and the valuation worksheet are edited on the '
      + '<a href="#" onclick="finNavGo(\'property\');return false;">Commercial Property</a> tab, beside the cash walk they feed.</p>'
    + '</div>';
}


// ── Property Tax Reserve ─────────────────────────────────────────────────────────────────────
// AHRA maintains a running monthly reserve toward the annual property tax bill — the schedule
// zeroes out each November when the actual bill is paid, then rebuilds at a revised monthly rate.
// AHRA's flat cash cushion (see finComputePropertyReservesOnHandCents above) — shown and
// editable here since it's otherwise an invisible number baked into "Reserves On-Hand."
function finRenderBaseMinimumReserve(d, isAdminUI) {
  var cents = (d.meta && d.meta.reserves && d.meta.reserves.base_minimum_cents) || 0;
  return '<h4 style="margin:18px 0 8px;font-size:.9rem;">Base Minimum Reserve</h4>'
    + '<p style="font-size:.78rem;color:var(--warm-gray);margin:0 0 8px;">A flat operating-cash cushion AHRA holds back before computing a distribution — not an accumulating bucket like the Property Tax Reserve below. Included in "Reserves On-Hand" above so it reconciles with AHRA\'s own "Total Property Reserve" figure.</p>'
    + (isAdminUI
      ? '<div style="display:flex;gap:8px;align-items:flex-end;">'
        + '<label style="font-size:.75rem;color:var(--warm-gray);">Amount ($)<br><input type="number" id="fin-basemin-amount" step="0.01" value="' + (cents/100) + '" style="width:120px;"></label>'
        + '<button class="btn-primary" style="font-size:.78rem;padding:5px 12px;" onclick="finPropertySaveBaseMinimum()">Save</button>'
        + '</div>'
      : '<div class="fin-kpi-val" style="font-size:20px;">$' + finFmtMoney(cents/100) + '</div>');
}
function finPropertySaveBaseMinimum() {
  var val = document.getElementById('fin-basemin-amount').value;
  var cents = Math.round(Number(val) * 100);
  if (!Number.isFinite(cents) || cents < 0) { finToast('Invalid amount.'); return; }
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/meta', { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ reserves: { base_minimum_cents: cents } }) }).then(function(d) {
    if (d && d.error) { finToast(d.error); return; }
    finLoadProperty();
  }).catch(function(err) { finToast(err && err.message || 'Save failed.'); });
}
function finRenderPropertyTaxReserve(d, isAdminUI) {
  var rows = ((d.reserves && d.reserves.property_tax) || []).slice().sort(function(a,b){ return a.report_month < b.report_month ? 1 : -1; });
  var paid = ((d.reserveDisbursements && d.reserveDisbursements.property_tax) || []).slice().sort(function(a,b){ return b.period_key - a.period_key; });
  function c(cents) { return cents == null ? '<span style="color:var(--warm-gray);">—</span>' : '$' + finFmtMoney(cents/100); }
  var scheduleRows = rows.map(function(r) {
    return '<tr><td style="padding:5px 8px;font-weight:600;">' + esc(r.report_month) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + (r.tax_year || '—') + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + c(r.target_estimate_cents) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + c(r.reserve_before_cents) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + c(r.contribution_cents) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;font-weight:600;">' + c(r.reserve_after_cents) + '</td>'
      + '<td style="padding:5px 8px;font-size:.75rem;color:var(--warm-gray);">' + esc(r.note || '') + '</td>'
      + (isAdminUI ? '<td style="padding:5px 8px;"><button class="btn-secondary" style="font-size:.72rem;padding:2px 6px;color:var(--danger);" onclick="finPropertyDeleteReserveMonth(\'property_tax\',\'' + esc(r.report_month) + '\')">Delete</button></td>' : '') + '</tr>';
  }).join('');
  var scheduleHtml = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr><th style="text-align:left;padding:5px 8px;">Report Month</th><th style="text-align:right;padding:5px 8px;">Tax Year</th><th style="text-align:right;padding:5px 8px;">Est. Tax</th><th style="text-align:right;padding:5px 8px;">Before</th><th style="text-align:right;padding:5px 8px;">Contribution</th><th style="text-align:right;padding:5px 8px;">After</th><th style="text-align:left;padding:5px 8px;">Note</th>' + (isAdminUI ? '<th></th>' : '') + '</tr></thead>'
    + '<tbody>' + (scheduleRows || '<tr><td colspan="8" style="padding:10px;color:var(--warm-gray);">No reserve schedule recorded yet.</td></tr>') + '</tbody>'
    + '</table></div>';
  var paidRows = paid.map(function(p) {
    return '<tr><td style="padding:5px 8px;">' + esc(p.period_key) + '</td><td style="padding:5px 8px;text-align:right;">' + c(p.amount_cents) + '</td><td style="padding:5px 8px;">' + esc(p.paid_via_report_month || '') + '</td><td style="padding:5px 8px;font-size:.75rem;color:var(--warm-gray);">' + esc(p.note || '') + '</td>'
      + (isAdminUI ? '<td style="padding:5px 8px;"><button class="btn-secondary" style="font-size:.72rem;padding:2px 6px;color:var(--danger);" onclick="finPropertyDeleteReserveDisbursement(\'property_tax\',\'' + esc(p.period_key) + '\')">Delete</button></td>' : '') + '</tr>';
  }).join('');
  var paidHtml = '<div style="overflow-x:auto;margin-top:10px;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;">'
    + '<thead style="border-bottom:1px solid var(--border);"><tr><th style="text-align:left;padding:5px 8px;">Tax Year</th><th style="text-align:right;padding:5px 8px;">Amount Paid</th><th style="text-align:left;padding:5px 8px;">Paid Via Report</th><th style="text-align:left;padding:5px 8px;">Note</th>' + (isAdminUI ? '<th></th>' : '') + '</tr></thead>'
    + '<tbody>' + (paidRows || '<tr><td colspan="5" style="padding:8px;color:var(--warm-gray);">No tax bills recorded as paid yet.</td></tr>') + '</tbody>'
    + '</table></div>';
  var addFormHtml = isAdminUI
    ? '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:10px;">'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Report Month<br><input type="text" id="fin-ptr-month" placeholder="2026-06" style="width:100px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Tax Year<br><input type="number" id="fin-ptr-taxyear" placeholder="2026" style="width:90px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Estimated Tax ($)<br><input type="number" id="fin-ptr-estimate" step="0.01" style="width:110px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Contribution ($)<br><input type="number" id="fin-ptr-contribution" step="0.01" style="width:110px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Note<br><input type="text" id="fin-ptr-note" style="width:180px;"></label>'
      + '<button class="btn-primary" style="font-size:.78rem;padding:5px 12px;" onclick="finPropertyAddReserveMonth()">+ Add Month</button>'
      + '</div>'
      + '<p style="font-size:.72rem;color:var(--warm-gray);margin:6px 0 0;">"Before" carries forward automatically from the prior month’s "After" — leave Estimated Tax/Contribution at 0 the month the bill is paid to zero the reserve out.</p>'
    : '';
  var pacNote = (d.meta && d.meta.capital_improvements && d.meta.capital_improvements.separate_paint_asphalt_concrete_reserve_note) || '';
  var latest = rows[0];
  var progressHtml = (latest && latest.reserve_after_cents != null && latest.target_estimate_cents)
    ? '<div style="margin-bottom:10px;"><div style="display:flex;justify-content:space-between;font-size:.8rem;color:var(--warm-ink-label);margin-bottom:4px;"><span>On-hand vs. estimated tax (' + esc(latest.report_month) + ')</span><span>$' + finFmtMoney(latest.reserve_after_cents/100) + ' / $' + finFmtMoney(latest.target_estimate_cents/100) + '</span></div>'
      + '<div class="fin-pace-bar-track"><div class="fin-pace-bar-fill" style="width:' + Math.min(100, latest.reserve_after_cents/latest.target_estimate_cents*100) + '%;background:var(--color-gold);"></div></div></div>'
    : '';
  return '<h4 style="margin:18px 0 8px;font-size:.9rem;">Property Tax Reserve</h4>' + progressHtml
    + scheduleHtml + paidHtml + addFormHtml
    + (pacNote ? '<p style="font-size:.75rem;color:var(--warm-gray);margin:12px 0 0;"><i>' + esc(pacNote) + '</i></p>' : '');
}
function finPropertyAddReserveMonth() {
  var month = document.getElementById('fin-ptr-month').value.trim();
  if (!/^\d{4}-\d{2}$/.test(month)) { finToast('Report month must be YYYY-MM.'); return; }
  var body = {
    report_month: month,
    tax_year: document.getElementById('fin-ptr-taxyear').value || '',
    target_estimate: document.getElementById('fin-ptr-estimate').value,
    contribution: document.getElementById('fin-ptr-contribution').value || '0',
    note: document.getElementById('fin-ptr-note').value.trim(),
  };
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/reserves/property_tax/monthly', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }).then(function(d) {
    if (d && d.error) { finToast(d.error); return; }
    finLoadProperty();
  });
}
function finPropertyDeleteReserveMonth(reserveKey, month) {
  if (!confirm('Delete the ' + month + ' reserve entry? This cannot be undone.')) return;
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/reserves/' + reserveKey + '/monthly/' + encodeURIComponent(month), { method: 'DELETE' }).then(function() { finLoadProperty(); });
}
function finPropertyDeleteReserveDisbursement(reserveKey, periodKey) {
  if (!confirm('Delete the recorded payment for ' + periodKey + '?')) return;
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/reserves/' + reserveKey + '/disbursements/' + encodeURIComponent(periodKey), { method: 'DELETE' }).then(function() { finLoadProperty(); });
}

// ── Capital Improvements ─────────────────────────────────────────────────────────────────────
function finRenderCapitalImprovements(d, isAdminUI) {
  var ledger = (d.capitalLedger || []).slice().sort(function(a,b){ return (a.entry_date||'') < (b.entry_date||'') ? -1 : 1; });
  var ledgerRows = ledger.map(function(r) {
    return '<tr><td style="padding:5px 8px;">' + esc(r.entry_date || '(unknown)') + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">$' + finFmtMoney(r.amount_cents/100) + '</td>'
      + '<td style="padding:5px 8px;">' + esc(r.payee || '') + '</td>'
      + '<td style="padding:5px 8px;font-size:.78rem;">' + esc(r.description || '') + '</td>'
      + '<td style="padding:5px 8px;font-size:.75rem;color:var(--warm-gray);">' + esc(r.check_ref || '') + '</td>'
      + '<td style="padding:5px 8px;font-size:.75rem;color:var(--warm-gray);">' + esc(r.project || '') + '</td>'
      + (isAdminUI ? '<td style="padding:5px 8px;"><button class="btn-secondary" style="font-size:.72rem;padding:2px 6px;color:var(--danger);" onclick="finPropertyDeleteCapitalLedger(' + r.id + ')">Delete</button></td>' : '') + '</tr>';
  }).join('');
  var totalCents = d.capitalLedgerTotalCents || 0;
  var ledgerHtml = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr><th style="text-align:left;padding:5px 8px;">Date</th><th style="text-align:right;padding:5px 8px;">Amount</th><th style="text-align:left;padding:5px 8px;">Payee</th><th style="text-align:left;padding:5px 8px;">Description</th><th style="text-align:left;padding:5px 8px;">Check/Ref</th><th style="text-align:left;padding:5px 8px;">Project</th>' + (isAdminUI ? '<th></th>' : '') + '</tr></thead>'
    + '<tbody>' + (ledgerRows || '<tr><td colspan="7" style="padding:10px;color:var(--warm-gray);">No capital improvements recorded yet.</td></tr>') + '</tbody>'
    + '<tfoot><tr style="font-weight:600;border-top:2px solid var(--navy);"><td style="padding:5px 8px;" colspan="1">Total</td><td style="padding:5px 8px;text-align:right;">$' + finFmtMoney(totalCents/100) + '</td><td colspan="' + (isAdminUI ? 5 : 4) + '"></td></tr></tfoot>'
    + '</table></div>';

  var projects = (d.meta && d.meta.capital_improvements && d.meta.capital_improvements.projects_summary) || [];
  var projRows = projects.map(function(p) {
    return '<tr><td style="padding:5px 8px;font-weight:600;">' + esc(p.project) + '</td>'
      + '<td style="padding:5px 8px;">' + esc(p.started || '') + '</td>'
      + '<td style="padding:5px 8px;">' + esc(p.completed || '') + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">$' + finFmtMoney((p.total_capitalized_cents||0)/100) + '</td>'
      + '<td style="padding:5px 8px;font-size:.75rem;color:var(--warm-gray);">' + esc(p.note || '') + '</td></tr>';
  }).join('');
  var projHtml = projects.length ? ('<div style="overflow-x:auto;margin-top:10px;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;">'
    + '<thead style="border-bottom:1px solid var(--border);"><tr><th style="text-align:left;padding:5px 8px;">Project</th><th style="text-align:left;padding:5px 8px;">Started</th><th style="text-align:left;padding:5px 8px;">Completed</th><th style="text-align:right;padding:5px 8px;">Capitalized</th><th style="text-align:left;padding:5px 8px;">Note</th></tr></thead>'
    + '<tbody>' + projRows + '</tbody></table></div>') : '';

  var addFormHtml = isAdminUI
    ? '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:10px;">'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Date<br><input type="text" id="fin-cap-date" placeholder="2026-06-15" style="width:110px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Amount ($)<br><input type="number" id="fin-cap-amount" step="0.01" style="width:100px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Payee<br><input type="text" id="fin-cap-payee" style="width:150px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Description<br><input type="text" id="fin-cap-description" style="width:200px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Check/Ref<br><input type="text" id="fin-cap-checkref" style="width:120px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Project<br><input type="text" id="fin-cap-project" style="width:180px;"></label>'
      + '<button class="btn-primary" style="font-size:.78rem;padding:5px 12px;" onclick="finPropertyAddCapitalLedger()">+ Add</button>'
      + '</div>'
    : '';

  return '<h4 style="margin:18px 0 8px;font-size:.9rem;">Capital Improvements</h4>' + ledgerHtml + projHtml + addFormHtml;
}
function finPropertyAddCapitalLedger() {
  var amount = document.getElementById('fin-cap-amount').value;
  if (amount === '') { finToast('Enter an amount.'); return; }
  var body = {
    entry_date: document.getElementById('fin-cap-date').value.trim(),
    amount: amount,
    payee: document.getElementById('fin-cap-payee').value.trim(),
    description: document.getElementById('fin-cap-description').value.trim(),
    check_ref: document.getElementById('fin-cap-checkref').value.trim(),
    project: document.getElementById('fin-cap-project').value.trim(),
  };
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/capital-ledger', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }).then(function(d) {
    if (d && d.error) { finToast(d.error); return; }
    finLoadProperty();
  });
}
function finPropertyDeleteCapitalLedger(id) {
  if (!confirm('Delete this capital improvement entry? This cannot be undone.')) return;
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/capital-ledger/' + id, { method: 'DELETE' }).then(function() { finLoadProperty(); });
}

// ── Repairs & Maintenance ────────────────────────────────────────────────────────────────────
function finRenderRepairs(d, isAdminUI) {
  var rows = (d.repairs || []).slice().sort(function(a,b){ return (a.entry_date||'') < (b.entry_date||'') ? -1 : 1; });
  var repairRows = rows.map(function(r) {
    return '<tr><td style="padding:5px 8px;">' + esc(r.entry_date || '') + '</td>'
      + '<td style="padding:5px 8px;">' + esc(r.category || '') + '</td>'
      + '<td style="padding:5px 8px;font-size:.78rem;">' + esc(r.description || '') + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + (r.amount_cents == null ? '<span style="color:var(--warm-gray);">—</span>' : '$' + finFmtMoney(r.amount_cents/100)) + '</td>'
      + '<td style="padding:5px 8px;font-size:.75rem;color:var(--warm-gray);">' + esc(r.payee || '') + '</td>'
      + (isAdminUI ? '<td style="padding:5px 8px;"><button class="btn-secondary" style="font-size:.72rem;padding:2px 6px;color:var(--danger);" onclick="finPropertyDeleteRepair(' + r.id + ')">Delete</button></td>' : '') + '</tr>';
  }).join('');
  var html = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr><th style="text-align:left;padding:5px 8px;">Date</th><th style="text-align:left;padding:5px 8px;">Category</th><th style="text-align:left;padding:5px 8px;">Description</th><th style="text-align:right;padding:5px 8px;">Amount</th><th style="text-align:left;padding:5px 8px;">Payee</th>' + (isAdminUI ? '<th></th>' : '') + '</tr></thead>'
    + '<tbody>' + (repairRows || '<tr><td colspan="6" style="padding:10px;color:var(--warm-gray);">No repairs recorded yet.</td></tr>') + '</tbody>'
    + '</table></div>';
  var addFormHtml = isAdminUI
    ? '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:10px;">'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Date<br><input type="text" id="fin-rep-date" placeholder="2026-06-15" style="width:110px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Category<br><input type="text" id="fin-rep-category" placeholder="HVAC" style="width:110px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Description<br><input type="text" id="fin-rep-description" style="width:200px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Amount ($)<br><input type="number" id="fin-rep-amount" step="0.01" style="width:100px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Payee<br><input type="text" id="fin-rep-payee" style="width:150px;"></label>'
      + '<button class="btn-primary" style="font-size:.78rem;padding:5px 12px;" onclick="finPropertyAddRepair()">+ Add</button>'
      + '</div>'
    : '';
  return '<h4 style="margin:18px 0 8px;font-size:.9rem;">Repairs &amp; Maintenance</h4>' + html + addFormHtml;
}
function finPropertyAddRepair() {
  var body = {
    entry_date: document.getElementById('fin-rep-date').value.trim(),
    category: document.getElementById('fin-rep-category').value.trim(),
    description: document.getElementById('fin-rep-description').value.trim(),
    amount: document.getElementById('fin-rep-amount').value,
    payee: document.getElementById('fin-rep-payee').value.trim(),
  };
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/repairs', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }).then(function(d) {
    if (d && d.error) { finToast(d.error); return; }
    finLoadProperty();
  });
}
function finPropertyDeleteRepair(id) {
  if (!confirm('Delete this repair entry? This cannot be undone.')) return;
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/repairs/' + id, { method: 'DELETE' }).then(function() { finLoadProperty(); });
}

// ── Insurance Allocation (read-only reference — GuideOne church-wide policy, allocated by
// building value share; see meta.insurance in the backend) ──────────────────────────────────
function finRenderInsuranceAllocation(d) {
  var ins = (d.meta && d.meta.insurance) || null;
  if (!ins) return '';
  var alloc = ins.ivanhoe_allocation || {};
  var html = '<p style="font-size:.78rem;color:var(--warm-gray);margin:0 0 8px;">' + esc(ins.policy_structure_note || '') + '</p>'
    + '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px;">'
    + '<div class="rpt-stat"><div class="rpt-stat-num">' + ((alloc.ivanhoe_share_of_total_insured_value_pct||0)*100).toFixed(1) + '%</div><div class="rpt-stat-lbl">Share of Insured Value</div></div>'
    + '<div class="rpt-stat"><div class="rpt-stat-num">$' + finFmtMoney((alloc.allocated_total_annual_cents||0)/100) + '</div><div class="rpt-stat-lbl">Allocated Annual Premium</div></div>'
    + '</div>'
    + (alloc.estimate_note ? '<p style="font-size:.75rem;color:var(--warm-gray);margin:0 0 8px;"><i>' + esc(alloc.estimate_note) + '</i></p>' : '');
  return '<h4 style="margin:18px 0 8px;font-size:.9rem;">Insurance Allocation (Estimate)</h4>' + html;
}
function finPropertyOpenMonthModal(period) {
  var m = period ? (_finProperty.monthly || []).filter(function(r){ return r.period === period; })[0] : null;
  document.getElementById('fpm-period').value = m ? m.period : '';
  document.getElementById('fpm-period').disabled = !!m;
  document.getElementById('fpm-occupancy').value = m && m.occupancy_pct != null ? (m.occupancy_pct*100) : '';
  document.getElementById('fpm-revenue').value = m && m.total_revenue_cents != null ? (m.total_revenue_cents/100) : '';
  document.getElementById('fpm-expenses').value = m && m.total_expenses_cents != null ? (m.total_expenses_cents/100) : '';
  document.getElementById('fpm-net-income').value = m && m.net_income_cents != null ? (m.net_income_cents/100) : '';
  document.getElementById('fpm-noi').value = m && m.net_operating_income_cents != null ? (m.net_operating_income_cents/100) : '';
  document.getElementById('fpm-afd').value = m && m.available_for_distribution_cents != null ? (m.available_for_distribution_cents/100) : '';
  document.getElementById('fpm-reserve').value = m && m.reserve_balance_cents != null ? (m.reserve_balance_cents/100) : '';
  document.getElementById('fpm-loan-payment').value = m && m.loan_payment_cents != null ? (m.loan_payment_cents/100) : '';
  document.getElementById('fpm-interest-expense').value = m && m.interest_expense_cents != null ? (m.interest_expense_cents/100) : '';
  document.getElementById('fpm-source').value = m ? (m.source_report || '') : '';
  document.getElementById('fpm-error').textContent = '';
  openModal('fin-property-month-modal');
}
function finPropertySaveMonth() {
  var period = document.getElementById('fpm-period').value.trim();
  var errEl = document.getElementById('fpm-error');
  if (!/^\d{4}-\d{2}$/.test(period)) { errEl.textContent = 'Period must be in YYYY-MM format.'; return; }
  function numOrEmpty(id) { var v = document.getElementById(id).value; return v === '' ? '' : v; }
  var body = {
    period: period,
    occupancy_pct: numOrEmpty('fpm-occupancy') === '' ? '' : Number(document.getElementById('fpm-occupancy').value) / 100,
    total_revenue: numOrEmpty('fpm-revenue'),
    total_expenses: numOrEmpty('fpm-expenses'),
    net_income: numOrEmpty('fpm-net-income'),
    net_operating_income: numOrEmpty('fpm-noi'),
    available_for_distribution: numOrEmpty('fpm-afd'),
    reserve_balance: numOrEmpty('fpm-reserve'),
    loan_payment: numOrEmpty('fpm-loan-payment'),
    interest_expense: numOrEmpty('fpm-interest-expense'),
    source_report: document.getElementById('fpm-source').value.trim(),
  };
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/monthly', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }).then(function(d) {
    if (d && d.error) { errEl.textContent = d.error; return; }
    closeModal('fin-property-month-modal');
    finLoadProperty();
  }).catch(function(err) { errEl.textContent = err && err.message ? err.message : 'Save failed.'; });
}
function finPropertyDeleteMonth(period) {
  if (!confirm('Delete the ' + period + ' entry? This cannot be undone.')) return;
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/monthly/' + encodeURIComponent(period), { method: 'DELETE' }).then(function() {
    finLoadProperty();
  });
}
function finPropertyAddDistribution() {
  var period = document.getElementById('fin-prop-dist-period').value.trim();
  var amount = document.getElementById('fin-prop-dist-amount').value;
  if (!/^\d{4}-\d{2}$/.test(period) || amount === '') { finToast('Enter a valid period (YYYY-MM) and amount.'); return; }
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/distributions', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ period: period, amount: amount }) }).then(function(d) {
    if (d && d.error) { finToast(d.error); return; }
    finLoadProperty();
  });
}
function finPropertyDeleteDistribution(period) {
  if (!confirm('Delete the distribution recorded for ' + period + '?')) return;
  api('/admin/api/finance/property/' + FIN_PROPERTY_KEY + '/distributions/' + encodeURIComponent(period), { method: 'DELETE' }).then(function() {
    finLoadProperty();
  });
}

// ── Church Budget Planning ────────────────────────────────────────────────────────────────
// Mirrors the real chart of accounts (same tree Church Report shows — finBuildTreeFromFlatRows,
// reused as-is) instead of freeform category names: Current Year Budget | Current Year Actual |
// Projected {target year}. "Generate All" auto-fills the Projected column for every real account
// by compounding a flat growth rate off that account's current-year actual; any line can then be
// hand-corrected before Save. Salary & Benefits gets its own callout — the app doesn't yet know
// the formula/Concordia Plan Services comparison the user described; it's a placeholder until
// that's provided, not a guess. See src/api-finance.js for generate-all()/override-bulk()/
// commit() semantics and why plan_committed is the lowest-priority resolveChurchYearPrecedence
// source.
var _finPlanRows = [];
var _finPlanBaseYear = new Date().getFullYear();
var _finPlanTargetYear = _finPlanBaseYear + 1;
var _finPlanBaseTree = null;
var _finPlanBaseNet = { actualCents: 0, budgetCents: 0 };
var _finPlanEdits = {}; // category_path -> dollars string, for cells the user has typed into
var _finPlanBaseProjOverrides = {}; // { [baseYear]: { category_path: cents } } — saved server-side
var _finPlanBaseProjEdits = {}; // category_path -> dollars string, unsaved edits to FY{base} Projected
// The Salary Calculator and Health Insurance cards fully rebuild #fin-plan-root's innerHTML on
// every keystroke (same pattern as the rest of this app), which destroys and recreates the
// focused input — losing both keyboard focus and (since nothing stays focused) the page's scroll
// position, so it visibly jumps to the top on every character typed. This wrapper captures focus
// (by element id — every input touched by it must have a stable one), cursor/selection position,
// and scroll position before re-rendering, then restores all three afterward.
//
// It ALSO restores the focused input's raw text, which is what finally fixed the long-running
// "the boxes don't type correctly" reports (FIN42/FIN49/FIN50 each fixed a real but different
// symptom and left this cause in place). These boxes are fully controlled: the handler converts
// what you type to canonical cents, then this re-render writes cents/100 straight back into the
// box. That round-trip is lossy for anything mid-typed — the instant you type ".", the value is
// "1234." -> parseFloat -> 1234 -> the box is rewritten as "1234" and your decimal point is
// deleted, so the next two digits land as whole dollars and $1,234.56 silently becomes $123,456.
// State still updates on every keystroke (so the totals below recompute live), but the box the
// user is actively typing in is never rewritten out from under them. See finSalaryTypingFixture
// in test/finance-input-typing.test.js, which reproduces the exact reported failure.
function finRerenderPlanningPreserveFocus() {
  var active = document.activeElement;
  var activeId = active && active.id;
  var activeValue = active && typeof active.value === 'string' ? active.value : null;
  var selStart = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
  var selEnd = active && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;
  var scrollY = window.scrollY;
  var contentArea = document.querySelector('.content-area');
  var contentScrollTop = contentArea ? contentArea.scrollTop : null;
  finRenderCompensation();
  if (activeId) {
    var restored = document.getElementById(activeId);
    if (restored) {
      restored.focus();
      if (activeValue != null && restored.value !== activeValue) restored.value = activeValue;
      if (selStart != null && restored.setSelectionRange) {
        try { restored.setSelectionRange(selStart, selEnd); } catch (e) { /* not a text-selectable input, ignore */ }
      }
    }
  }
  window.scrollTo(0, scrollY);
  if (contentArea && contentScrollTop != null) contentArea.scrollTop = contentScrollTop;
  finSalaryScheduleAutoSave();
}
// Seeded once (only if nothing has ever been saved) — the church's 3 current salaried workers,
// each tied to their real payroll account code so the roster can pull in that account's own
// FY actual/budget as a reference. Knapp = DCE (Commissioned, MA track), Thompson = Director of
// Parish Music (Other Church Worker, treated as a regular employee per FIN15/FIN16).
var SALARY_STAFF_SEED = [
  { name: 'Dinger', position: 'Senior Pastor', role: 'pastor', trackKey: '', education: 'masters', yearsExperience: 0, responsibilityStipend: 0, responsibilityStipendKey: 'none', attendanceBonus: 0, selfEmployedFica: true, hasDependents: false, accountCode: '58001', healthEnrolled: true },
  { name: 'Knapp', position: 'Director of Christian Education', role: 'commissioned', trackKey: 'ma', education: 'masters', yearsExperience: 0, responsibilityStipend: 0, responsibilityStipendKey: 'none', attendanceBonus: 0, selfEmployedFica: true, hasDependents: false, accountCode: '58002', healthEnrolled: true },
  { name: 'Thompson', position: 'Director of Parish Music', role: 'other', trackKey: 'business_manager_music', education: 'bachelors', yearsExperience: 0, responsibilityStipend: 0, responsibilityStipendKey: 'none', attendanceBonus: 0, selfEmployedFica: false, hasDependents: false, accountCode: '58003', healthEnrolled: true }
];
var _finSalaryLoaded = false; // salary/health-plan settings load once per page visit, not per base-year change — they're not scoped to a fiscal year
// Per-fiscal-year figures that arrive on paper once a year but aren't a formula — the district
// base salary, the Concordia Plans rates, the Social Security COLA, the health opt-out cash
// figure, and the provenance text for each. Shape:
//   { [year]: { baseSalaryCents, healthOptOutCents, pensionPct, ficaPct, disabilityDepsPct,
//               disabilityNoDepsPct, ssaColaPct, districtSource, concordiaSource, quoteSource } }
// Percentages are stored as fractions (0.117), money as cents. Role/track multiplier tables
// (LCMS_PASTOR_MULTIPLIERS etc.) are NOT part of this — those are structural and don't change
// year to year, per the user's explicit confirmation, so they stay hardcoded. The code constants
// (LCMS_MO_BASE_SALARY_BY_YEAR, CONCORDIA_*_BY_YEAR, SSA_COLA_REFERENCE_PCT) remain the seed and
// fallback; an entered value for the year wins over them. See finCompEnteredRef.
var _finSalaryReferenceByYear = {};
var _finSalaryTargetCategory = ''; // budget account "Send to FY budget" writes into
function finLoadSalaryPlannerData() {
  return api('/admin/api/finance/planning/salary').then(function(d) {
    var saved = d && d.data;
    if (saved && Array.isArray(saved.roster) && saved.roster.length) {
      _finSalaryRoster = saved.roster;
      _finSalaryTargetCategory = saved.targetCategory || '';
      _finHealthPlanSelectedOption = saved.healthPlanOption || 'renewal';
      _finSalaryReferenceByYear = (saved.referenceByYear && typeof saved.referenceByYear === 'object') ? saved.referenceByYear : {};
      _finHealthPlanPremiumOverrides = (saved.healthPlanPremiumOverrides && typeof saved.healthPlanPremiumOverrides === 'object') ? saved.healthPlanPremiumOverrides : {};
      _finHealthFamilySize = saved.healthFamilySize > 0 ? Math.floor(saved.healthFamilySize) : 2;
      if (saved.compMethod) _finCompMethod = saved.compMethod;
      if (saved.compPerWorkerMethod && typeof saved.compPerWorkerMethod === 'object') _finCompPerWorkerMethod = saved.compPerWorkerMethod;
      if (saved.compOverrides && typeof saved.compOverrides === 'object') _finCompOverrides = saved.compOverrides;
      if (saved.compCustomPct != null) _finCompCustomPct = saved.compCustomPct;
      if (saved.compScalePct != null) _finCompScalePct = saved.compScalePct;
      if (saved.compBaselineRosterOnly != null) _finCompBaselineRosterOnly = !!saved.compBaselineRosterOnly;
      if (saved.compBaseYearBasis) _finCompBaseYearBasis = saved.compBaseYearBasis === 'ledger' ? 'ledger' : 'roster';
      if (saved.compBasePlanOption) _finCompBasePlanOption = saved.compBasePlanOption;
      finCompMigrateSavedShape(saved);
    } else if (!_finSalaryRoster.length) {
      _finSalaryRoster = JSON.parse(JSON.stringify(SALARY_STAFF_SEED));
    }
    finConcordiaSeedRoster();
  }).catch(function() {
    if (!_finSalaryRoster.length) _finSalaryRoster = JSON.parse(JSON.stringify(SALARY_STAFF_SEED));
    finConcordiaSeedRoster();
  });
}
// Forward-migration of the pre-redesign save shape. The old tab kept the pension/disability
// overrides as two roster-wide globals and the growth choice as a colaSource string; both are
// now per-year reference figures and a method key. Migrating on read (rather than leaving the old
// globals live) matters because an override with no UI left to clear it would silently keep
// applying — the invisible-stuck-state class of bug.
function finCompMigrateSavedShape(saved) {
  var y = _finPlanTargetYear;
  if (!_finSalaryReferenceByYear[y]) _finSalaryReferenceByYear[y] = {};
  var row = _finSalaryReferenceByYear[y];
  if (saved.pensionPct != null && row.pensionPct == null) row.pensionPct = saved.pensionPct;
  if (saved.disabilityPct != null && row.disabilityDepsPct == null) {
    // The old override applied ONE flat rate to every worker regardless of dependent status, so
    // both of the two new rates carry the same figure to preserve that exactly.
    row.disabilityDepsPct = saved.disabilityPct;
    row.disabilityNoDepsPct = saved.disabilityPct;
  }
  if (!saved.compMethod && saved.colaSource) {
    // 'lcms'/'ssa' both meant "grow by a published rate", which is now the COLA method; the old
    // district-formula behavior is the separate District Scale column.
    _finCompMethod = saved.colaSource === 'none' ? 'none' : saved.colaSource === 'custom' ? 'custom' : 'cola';
    if (saved.colaSource === 'custom' && saved.colaPct != null && saved.compCustomPct == null) _finCompCustomPct = saved.colaPct * 100;
  }
}
// Shared by the manual Save button and the debounced autosave below — this whole card's state is
// small enough to just resend wholesale on every save (no incremental diffing needed, unlike the
// Tuition Aid pin-based autosave).
function finSalaryBuildSaveBody() {
  return {
    roster: _finSalaryRoster, targetCategory: _finSalaryTargetCategory,
    healthPlanOption: _finHealthPlanSelectedOption,
    compMethod: _finCompMethod, compPerWorkerMethod: _finCompPerWorkerMethod,
    compOverrides: _finCompOverrides, compCustomPct: _finCompCustomPct, compScalePct: _finCompScalePct,
    compBaselineRosterOnly: _finCompBaselineRosterOnly,
    compBaseYearBasis: _finCompBaseYearBasis, compBasePlanOption: _finCompBasePlanOption,
    referenceByYear: _finSalaryReferenceByYear, healthPlanPremiumOverrides: _finHealthPlanPremiumOverrides,
    healthFamilySize: _finHealthFamilySize
  };
}
function finSalarySaveData() {
  clearTimeout(_finSalaryAutoSaveTimer);
  var msgEl = document.getElementById('fin-salary-save-msg');
  if (msgEl) msgEl.textContent = 'Saving…';
  api('/admin/api/finance/planning/salary', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(finSalaryBuildSaveBody()) }).then(function(d) {
    if (d && d.error) { if (msgEl) msgEl.textContent = d.error; return; }
    if (msgEl) msgEl.textContent = 'Saved.';
    finToast('Salary & Benefits and Health Insurance data saved.');
  }).catch(function(err) { if (msgEl) msgEl.textContent = err && err.message || 'Save failed.'; });
}
// Autosave — every checkbox/field change on this page used to sit in memory until the explicit
// "Save Salary & Benefits Data" button was clicked; reported as "changes are not saving," same
// class of report the Church Budget Planning tab got before it gained autosave. Every mutator on
// this page ultimately calls finRerenderPlanningPreserveFocus() (below), so scheduling the
// autosave there — once — covers every field/checkbox without having to touch each handler.
var _finSalaryAutoSaveTimer = null;
function finSalaryScheduleAutoSave() {
  clearTimeout(_finSalaryAutoSaveTimer);
  _finSalaryAutoSaveTimer = setTimeout(finSalaryAutoSaveNow, 800);
}
function finSalaryFlushAutoSave() {
  clearTimeout(_finSalaryAutoSaveTimer);
  finSalaryAutoSaveNow();
}
function finSalaryAutoSaveNow() {
  if (!_finSalaryLoaded) return; // never autosave over data that hasn't finished its initial load yet
  var msgEl = document.getElementById('fin-salary-save-msg');
  if (msgEl) msgEl.textContent = 'Saving…';
  api('/admin/api/finance/planning/salary', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(finSalaryBuildSaveBody()) }).then(function(d) {
    if (!msgEl) return;
    if (d && d.error) { msgEl.textContent = d.error; return; }
    msgEl.textContent = 'Saved automatically.';
  }).catch(function(err) { if (msgEl) msgEl.textContent = err && err.message || 'Autosave failed — click Save Salary & Benefits Data to retry.'; });
}
// Resolves the district base salary for "year": an explicit saved reference figure for that exact
// year wins outright; otherwise falls back through BOTH the saved reference years and the
// hardcoded historical table (merged, so old years never regress once this feature exists) to the
// most recent year at or before the requested one, optionally grown forward by colaPct.
function finLcmsBaseSalaryCents(year, colaPct, referenceByYear) {
  var ref = referenceByYear || {};
  if (ref[year] && ref[year].baseSalaryCents != null) {
    return { dollars: ref[year].baseSalaryCents / 100, exact: true, sourceYear: year, colaApplied: false };
  }
  var known = {};
  Object.keys(LCMS_MO_BASE_SALARY_BY_YEAR).forEach(function(y) { known[y] = LCMS_MO_BASE_SALARY_BY_YEAR[y]; });
  Object.keys(ref).forEach(function(y) { if (ref[y] && ref[y].baseSalaryCents != null) known[y] = ref[y].baseSalaryCents / 100; });
  var years = Object.keys(known).map(Number).sort(function(a, b) { return a - b; });
  var candidates = years.filter(function(y) { return y <= year; });
  var sourceYear = candidates.length ? candidates[candidates.length - 1] : years[0];
  var sourceDollars = known[sourceYear];
  var rate = Number(colaPct) || 0;
  var yearsPast = year - sourceYear;
  var colaApplied = rate !== 0 && yearsPast > 0;
  var dollars = colaApplied ? sourceDollars * Math.pow(1 + rate, yearsPast) : sourceDollars;
  return { dollars: dollars, exact: sourceYear === year, sourceYear: sourceYear, colaApplied: colaApplied };
}
// Resolves the health-insurance opt-out cash figure for "year" the same way — an editable
// per-year dollar figure (tied loosely to the premium, bumped modestly year to year by hand), not
// a computed fraction of the premium. Falls back to the nearest earlier saved year, then 0 (forces
// an explicit entry rather than guessing).
function finHealthOptOutCentsFor(year, referenceByYear) {
  var ref = referenceByYear || {};
  if (ref[year] && ref[year].healthOptOutCents != null) return ref[year].healthOptOutCents;
  var years = Object.keys(ref).map(Number).filter(function(y) { return ref[y] && ref[y].healthOptOutCents != null && y <= year; }).sort(function(a, b) { return a - b; });
  return years.length ? ref[years[years.length - 1]].healthOptOutCents : 0;
}
function finLoadPlanning() {
  var el = document.getElementById('fin-plan-root');
  if (!el) return;
  el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">Loading…</p>';
  Promise.all([
    api('/admin/api/finance/planning/church'),
    api('/admin/api/finance/church/this-year?year=' + _finPlanBaseYear),
    api('/admin/api/finance/planning/base-projection'),
  ]).then(function(results) {
    _finPlanRows = (results[0] && results[0].rows) || [];
    finRememberStreamMap(results[1]);
    _finPlanBaseTree = finReorganizeChurchTree(finBuildTreeFromFlatRows((results[1] && results[1].entries) || []));
    _finPlanBaseNet = (results[1] && results[1].netIncome) || { actualCents: 0, budgetCents: 0 };
    _finPlanBaseProjOverrides = (results[2] && results[2].overrides) || {};
    _finPlanEdits = {};
    _finPlanBaseProjEdits = {};
    if (!_finSalaryLoaded) {
      _finSalaryLoaded = true;
      return finLoadSalaryPlannerData().then(function() {
        finRenderPlanning();
        finRenderCompensation();
        finRenderPropertyMultiYearForecast();
      });
    }
    finRenderPlanning();
    finRenderCompensation();
    finRenderPropertyMultiYearForecast();
  }).catch(function(err) {
    if (err && err.message === 'Unauthorized') return;
    el.innerHTML = '<p style="font-size:.85rem;color:var(--danger);">Could not load budget plan.</p>';
  });
}
function finPlanChangeBaseYear() {
  var y = parseInt(document.getElementById('fin-plan-base-year').value, 10);
  if (!isFinite(y)) return;
  // Same reasoning as finPlanChangeTargetYear — flush before the fiscal year context changes out
  // from under the pending edits, and before finLoadPlanning() wipes the edit maps.
  finPlanFlushAutoSave();
  _finPlanBaseYear = y;
  _finPlanTargetYear = y + 1;
  finLoadPlanning();
}
function finPlanFindRow(categoryPath) {
  return _finPlanRows.filter(function(r) { return r.category === categoryPath && r.fiscal_year === _finPlanTargetYear; })[0];
}
// Elapsed weeks since Jan 1 of now's year, capped at 52 — mirrors weeksElapsedInYear() in
// api-finance.js (kept as a duplicate, not a shared import, since this file has no module system;
// see the generate-all endpoint's comment for why weeks beat calendar months here).
function finWeeksElapsedInYear(now) {
  var yearStart = new Date(now.getFullYear(), 0, 1);
  var daysElapsed = Math.floor((now - yearStart) / 86400000) + 1;
  return Math.min(52, Math.max(1, daysElapsed / 7));
}
// Stable DOM id for a category's editable cell, so a full re-render can find the input back and
// restore focus/cursor to it (see finRerenderPlanTablePreserveFocus). Category paths contain
// characters (spaces, "&", ":", "'") that aren't safe verbatim in an id, so anything non-
// alphanumeric is collapsed to "_" — a theoretical collision between two differently-punctuated
// paths of the same words is not a real risk in this app's real chart of accounts.
function finPlanCellId(prefix, path) {
  return prefix + '-' + String(path).replace(/[^a-zA-Z0-9]+/g, '_');
}
// Whole-dollar-only input: strips anything but digits (and a single leading "-") as the user
// types, so a decimal point can never actually land in a Plan/Projected cell — per the user's
// explicit "only whole dollars" request, not just rounded after the fact.
function finPlanSanitizeWholeDollarInput(inputEl) {
  var neg = inputEl.value.charAt(0) === '-';
  var cleaned = (neg ? '-' : '') + inputEl.value.replace(/[^0-9]/g, '');
  if (cleaned !== inputEl.value) inputEl.value = cleaned;
  return cleaned;
}
// Same "type=text, sanitize live" approach as finPlanSanitizeWholeDollarInput above, but keeping a
// single decimal point (dollar-and-cents fields, not whole-dollar-only). Used for the Compensation
// dollar overrides (Opt-Out payment, Employee-Only premium, actual-salary override, health premium
// lines) — switched from type="number" after repeated reports that those fields "type backward,"
// which persisted even after an unrelated focus-preservation id bug was fixed; a native
// type="number" input has real, long-documented cross-browser quirks around
// selectionStart/setSelectionRange and value normalization that a full-card rerender-on-every-
// keystroke (needed so dependent totals update live) can trigger, and none of that machinery
// exists for a plain text input — this sidesteps the whole class of browser quirk rather than
// chasing which specific one was still misbehaving.
function finSanitizeDecimalInput(inputEl) {
  var v = inputEl.value;
  var neg = v.charAt(0) === '-';
  var body = v.replace(/[^0-9.]/g, '');
  var firstDot = body.indexOf('.');
  if (firstDot !== -1) body = body.slice(0, firstDot + 1) + body.slice(firstDot + 1).replace(/\./g, '');
  var cleaned = (neg ? '-' : '') + body;
  if (cleaned !== v) inputEl.value = cleaned;
  return cleaned;
}
// finRenderPlanning() fully rebuilds #fin-plan-root's innerHTML on every edit (see below) so the
// group/subtotal/Δ%/Net figures actually recompute live as you type instead of going stale until
// the next full reload — but that rebuild would otherwise destroy the focused input and reset
// scroll on every keystroke, same problem finRerenderPlanningPreserveFocus solves for the
// Compensation tab. Requires every editable cell to carry a stable id (finPlanCellId above).
function finRerenderPlanTablePreserveFocus() {
  var active = document.activeElement;
  var activeId = active && active.id;
  var activeValue = active && typeof active.value === 'string' ? active.value : null;
  var selStart = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
  var selEnd = active && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;
  var scrollY = window.scrollY;
  var contentArea = document.querySelector('.content-area');
  var contentScrollTop = contentArea ? contentArea.scrollTop : null;
  finRenderPlanning();
  if (activeId) {
    var restored = document.getElementById(activeId);
    if (restored) {
      restored.focus();
      // Planning cells store the raw typed string (not cents), so they don't hit the lossy
      // round-trip the Compensation boxes did — this is belt-and-braces so a future change to
      // how a cell derives its value can't silently reintroduce it. Same reasoning documented
      // on finRerenderPlanningPreserveFocus above.
      if (activeValue != null && restored.value !== activeValue) restored.value = activeValue;
      if (selStart != null && restored.setSelectionRange) {
        try { restored.setSelectionRange(selStart, selEnd); } catch (e) { /* not a text-selectable input, ignore */ }
      }
    }
  }
  window.scrollTo(0, scrollY);
  if (contentArea && contentScrollTop != null) contentArea.scrollTop = contentScrollTop;
}
function finRenderPlanning() {
  var el = document.getElementById('fin-plan-root');
  if (!el) return;
  var isAdminUI = (_userRole === 'admin');


  var rowsHtml = [];
  // Projected cents for a GROUP row (has children) is always the live sum of its own descendant
  // leaves — never independently editable — so a category like "42 Passive Income" automatically
  // reflects whatever its leaf accounts add up to instead of needing its own typed-in figure.
  var projectedCentsByPath = {};
  (function computeProjected(nodes) {
    (nodes || []).forEach(function(node) {
      if (!node.children.length) {
        var editedVal = _finPlanEdits[node.path];
        var planRow = finPlanFindRow(node.path);
        var cellVal = editedVal !== undefined ? editedVal : (planRow ? String(Math.round(planRow.planned_amount_cents/100)) : '');
        projectedCentsByPath[node.path] = (cellVal !== '' && isFinite(parseFloat(cellVal))) ? Math.round(parseFloat(cellVal)) * 100 : 0;
      } else {
        computeProjected(node.children);
        projectedCentsByPath[node.path] = node.children.reduce(function(sum, c) { return sum + (projectedCentsByPath[c.path] || 0); }, 0);
      }
    });
  })(_finPlanBaseTree);

  // "FY{base} Projected" column — the base year's projected YEAR-END total, computed exactly the
  // way generate-all annualizes it (see api-finance.js): while the base year is still in progress,
  // each leaf account's actual-to-date is annualized by 52/weeksElapsed — weeks, not calendar
  // months, since a partial month is ambiguous (day 5 of month 8 could fairly be read as "1 month
  // elapsed" or "0") in a way a plain days-since-Jan-1 ÷ 7 is not, and it tracks this church's
  // actual weekly giving rhythm more closely. A complete past year (or a line with only a budget
  // and no actual) is used as-is. Group rows roll up as the sum of their leaves, so the
  // annualization factor stays uniform and the column always reconciles to its own subtotals.
  // Any leaf can be hand-corrected (e.g. a known year-end gift the math can't see) via
  // _finPlanBaseProjEdits (unsaved) / _finPlanBaseProjOverrides (saved, see finPlanSaveAll) —
  // an override always wins over the computed annualization for that one leaf.
  var _finPlanNow = new Date();
  var baseThroughWeek = (_finPlanBaseYear === _finPlanNow.getFullYear()) ? finWeeksElapsedInYear(_finPlanNow) : 52;
  var baseProrated = baseThroughWeek < 52;
  var savedBaseProjOverrides = _finPlanBaseProjOverrides[String(_finPlanBaseYear)] || {};
  var baseProjByPath = {};
  (function computeBaseProj(nodes) {
    (nodes || []).forEach(function(node) {
      if (!node.children.length) {
        var editedVal = _finPlanBaseProjEdits[node.path];
        if (editedVal !== undefined) {
          baseProjByPath[node.path] = (editedVal !== '' && isFinite(parseFloat(editedVal))) ? Math.round(parseFloat(editedVal)) * 100 : 0;
          return;
        }
        if (savedBaseProjOverrides[node.path] !== undefined) {
          baseProjByPath[node.path] = savedBaseProjOverrides[node.path];
          return;
        }
        var actual = node.totalActualCents || 0;
        var budget = node.totalBudgetCents || 0;
        baseProjByPath[node.path] = (actual && baseProrated) ? Math.round(actual * (52 / baseThroughWeek)) : (actual || budget || 0);
      } else {
        computeBaseProj(node.children);
        baseProjByPath[node.path] = node.children.reduce(function(sum, c) { return sum + (baseProjByPath[c.path] || 0); }, 0);
      }
    });
  })(_finPlanBaseTree);

  // Δ% — (Projected − FY Budget) / FY Budget, matching the Finance Workspace handoff's Planning
  // column: terracotta when spending is projected to grow more than 4%, green when it's projected
  // to shrink, muted otherwise. No budget to compare against (a brand-new line) renders as "—".
  function deltaCell(budgetCents, projectedCents) {
    if (!budgetCents) return '<td style="text-align:right;padding:4px 8px;color:var(--warm-gray);">—</td>';
    var pct = (projectedCents - budgetCents) / Math.abs(budgetCents) * 100;
    var color = pct > 4 ? 'var(--danger)' : pct < 0 ? 'var(--sage-text)' : 'var(--warm-ink-label)';
    return '<td style="text-align:right;padding:4px 8px;color:' + color + ';font-weight:600;">' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%</td>';
  }
  // Group rows: the name alone, with the figures on the "Total X" row beneath the accounts.
  function groupHeaderRow(node) {
    return '<tr style="font-weight:700;">' + finTreeLabelCell(node, node.label, { padV: '4px' })
      + '<td></td><td></td><td></td><td></td><td></td></tr>';
  }
  function groupTotalRow(node) {
    var projCents = projectedCentsByPath[node.path] || 0;
    var shade = (node.depth || 0) === 0 ? 'background:var(--warm-surface-page);' : '';
    return '<tr style="font-weight:700;border-top:1px solid var(--warm-border);' + shade + '">'
      + finTreeLabelCell(node, 'Total ' + node.label, { padV: '5px' })
      + '<td style="text-align:right;padding:5px 8px;">' + (node.hasBudgetInfo ? '$' + finFmtMoney(node.totalBudgetCents/100) : '<span style="color:var(--warm-gray);">—</span>') + '</td>'
      + '<td style="text-align:right;padding:5px 8px;">$' + finFmtMoney(node.totalActualCents/100) + '</td>'
      + '<td style="text-align:right;padding:5px 8px;color:var(--warm-ink-label);">$' + finFmtMoney((baseProjByPath[node.path] || 0)/100) + '</td>'
      + '<td style="text-align:right;padding:5px 8px;">' + (projCents ? '$' + finFmtMoney(projCents/100) : '<span style="color:var(--warm-gray);">—</span>') + '</td>'
      + deltaCell(node.totalBudgetCents, projCents)
      + '</tr>';
  }
  // An account line: the only row with editable figures. A group's Plan and Projected are always
  // the live sum of its own leaves (see projectedCentsByPath / baseProjByPath above), so there is
  // nothing on a group row to type into.
  function leafRow(node) {
    var planRow = finPlanFindRow(node.path);
    var editedVal = _finPlanEdits[node.path];
    var cellVal = editedVal !== undefined ? editedVal : (planRow ? String(Math.round(planRow.planned_amount_cents/100)) : '');
    var projCents = projectedCentsByPath[node.path] || 0;
    var projectedCell = '<td style="text-align:right;padding:4px 8px;">' + (isAdminUI
      ? '<input type="text" inputmode="numeric" id="' + finPlanCellId('fin-plan-cell', node.path) + '" value="' + cellVal + '" class="fin-editable-input" style="width:100px;text-align:right;" oninput="finPlanEditCell(' + jsAttr(node.path) + ', finPlanSanitizeWholeDollarInput(this))">'
      : (cellVal !== '' ? '$' + finFmtMoney(parseFloat(cellVal)) : '<span style="color:var(--warm-gray);">—</span>')) + '</td>';
    var baseEditedVal = _finPlanBaseProjEdits[node.path];
    var baseCellVal = baseEditedVal !== undefined ? baseEditedVal : String(Math.round((baseProjByPath[node.path] || 0)/100));
    var baseProjectedCell = '<td style="text-align:right;padding:4px 8px;">' + (isAdminUI
      ? '<input type="text" inputmode="numeric" id="' + finPlanCellId('fin-baseproj-cell', node.path) + '" value="' + baseCellVal + '" class="fin-editable-input" style="width:100px;text-align:right;color:var(--warm-ink-label);" oninput="finPlanEditBaseProjCell(' + jsAttr(node.path) + ', finPlanSanitizeWholeDollarInput(this))">'
      : '$' + finFmtMoney((baseProjByPath[node.path] || 0)/100)) + '</td>';
    return '<tr>'
      + finTreeLabelCell(node, node.label, { padV: '4px' })
      + '<td style="text-align:right;padding:4px 8px;">' + (node.hasBudgetInfo ? '$' + finFmtMoney(node.totalBudgetCents/100) : '<span style="color:var(--warm-gray);">—</span>') + '</td>'
      + '<td style="text-align:right;padding:4px 8px;">$' + finFmtMoney(node.totalActualCents/100) + '</td>'
      + baseProjectedCell
      + projectedCell
      + deltaCell(node.totalBudgetCents, projCents)
      + '</tr>';
  }
  function walk(nodes) {
    finRenderTreeQbOrder(nodes, { leaf: leafRow, groupHeader: groupHeaderRow, groupTotal: groupTotalRow }, rowsHtml);
  }
  function subtotalRow(label, budgetCents, hasAnyBudget, actualCents, baseProjectedCents, projectedCents) {
    return '<tr style="font-weight:700;background:var(--warm-surface-page);border-top:1px solid var(--warm-border);"><td style="padding:5px 8px;">' + label + '</td>'
      + (hasAnyBudget ? '<td style="text-align:right;padding:5px 8px;">$' + finFmtMoney(budgetCents/100) + '</td>' : '<td style="text-align:right;padding:5px 8px;color:var(--warm-gray);">—</td>')
      + '<td style="text-align:right;padding:5px 8px;">$' + finFmtMoney(actualCents/100) + '</td>'
      + '<td style="text-align:right;padding:5px 8px;">$' + finFmtMoney(baseProjectedCents/100) + '</td>'
      + '<td style="text-align:right;padding:5px 8px;">$' + finFmtMoney(projectedCents/100) + '</td>'
      + deltaCell(hasAnyBudget ? budgetCents : 0, projectedCents)
      + '</tr>';
  }
  var revenueRoots = _finPlanBaseTree.filter(function(n) { return FIN_REVENUE_CLASSES[n.classification]; });
  var expenseRoots = _finPlanBaseTree.filter(function(n) { return !FIN_REVENUE_CLASSES[n.classification]; });
  function sumRoots(roots, field) { return roots.reduce(function(sum, n) { return sum + (n[field] || 0); }, 0); }
  var revenueProjectedCents = revenueRoots.reduce(function(sum, n) { return sum + (projectedCentsByPath[n.path] || 0); }, 0);
  var expenseProjectedCents = expenseRoots.reduce(function(sum, n) { return sum + (projectedCentsByPath[n.path] || 0); }, 0);
  var baseRevenueProjCents = revenueRoots.reduce(function(sum, n) { return sum + (baseProjByPath[n.path] || 0); }, 0);
  var baseExpenseProjCents = expenseRoots.reduce(function(sum, n) { return sum + (baseProjByPath[n.path] || 0); }, 0);
  // A single root now prints its own "Total X" beneath its accounts, so the section subtotal
  // would be the same figure twice in consecutive rows. It is still needed when a section has
  // several roots (Income + Other Income), where no one root's total covers the section.
  function sectionSelfTotals(roots) { return roots.length === 1 && roots[0].children.length > 0; }
  walk(revenueRoots);
  if (revenueRoots.length && !sectionSelfTotals(revenueRoots)) rowsHtml.push(subtotalRow('Total Revenue', sumRoots(revenueRoots, 'totalBudgetCents'), revenueRoots.some(function(n){return n.hasBudgetInfo;}), sumRoots(revenueRoots, 'totalActualCents'), baseRevenueProjCents, revenueProjectedCents));
  walk(expenseRoots);
  if (expenseRoots.length && !sectionSelfTotals(expenseRoots)) rowsHtml.push(subtotalRow('Total Expenses', sumRoots(expenseRoots, 'totalBudgetCents'), expenseRoots.some(function(n){return n.hasBudgetInfo;}), sumRoots(expenseRoots, 'totalActualCents'), baseExpenseProjCents, expenseProjectedCents));
  var projectedRevenueCents = revenueProjectedCents, projectedExpenseCents = expenseProjectedCents;
  var projectedNetCents = projectedRevenueCents - projectedExpenseCents;
  function netCell(cents) {
    return '<td style="text-align:right;padding:5px 8px;color:' + (cents < 0 ? 'var(--danger)' : 'var(--sage)') + ';">' + (cents < 0 ? '−' : '') + '$' + finFmtMoney(Math.abs(cents)/100) + '</td>';
  }
  var netRow = '<tr style="font-weight:700;border-top:2px solid var(--navy);"><td style="padding:5px 8px;">Net (Revenue − Expenses)</td>'
    + (_finPlanBaseNet.budgetCents ? netCell(_finPlanBaseNet.budgetCents) : '<td style="padding:5px 8px;text-align:right;color:var(--warm-gray);">—</td>')
    + netCell(_finPlanBaseNet.actualCents)
    + netCell(baseRevenueProjCents - baseExpenseProjCents)
    + netCell(projectedNetCents)
    + '<td></td>'
    + '</tr>';

  var tableHtml = '<div style="overflow-x:auto;margin-top:6px;">'
    + '<table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead><tr style="background:var(--warm-surface-header);">'
    + '<th style="text-align:left;padding:8px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);">Category</th>'
    + '<th style="text-align:right;padding:8px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);">FY' + _finPlanBaseYear + ' Bud</th>'
    + '<th style="text-align:right;padding:8px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);">FY' + _finPlanBaseYear + ' Actual</th>'
    + '<th style="text-align:right;padding:8px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);"' + (baseProrated ? ' title="Projected year-end total — base-year actuals annualized from ' + baseThroughWeek.toFixed(1) + ' week(s) of data. Editable — type a whole-dollar figure to override any line."' : ' title="Editable — type a whole-dollar figure to override any line."') + '>FY' + _finPlanBaseYear + ' Projected</th>'
    + '<th style="text-align:right;padding:8px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);">FY' + _finPlanTargetYear + ' Plan</th>'
    + '<th style="text-align:right;padding:8px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);">&Delta;%</th>'
    + '</tr></thead>'
    + '<tbody>' + (rowsHtml.join('') || '<tr><td colspan="6" style="padding:10px;color:var(--warm-gray);">No Church Budget data found for ' + _finPlanBaseYear + ' — sync or import that year first (Church Report tab).</td></tr>')
    + (rowsHtml.length ? netRow : '') + '</tbody></table></div>';

  var actionsHtml = isAdminUI
    ? '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:12px;">'
      + '<label style="font-size:.72rem;color:var(--warm-gray);">Growth Assumption %<br><input type="number" id="fin-plan-growth" step="0.1" value="3" style="width:100px;"></label>'
      + '<button class="btn-secondary" onclick="finPlanGenerateAll()">Generate All (overwrites every Projected value below)</button>'
      + '<button class="btn-primary" onclick="finPlanSaveAll()">Save Changes</button>'
      + '</div>'
      + '<div id="fin-plan-msg" style="font-size:.75rem;color:var(--warm-gray);margin-top:6px;"></div>'
    : '';

  // Header: the two year inputs belong beside the title they qualify, not in a separate strip
  // above the table — every figure on the page is read as "FY{target}, built from FY{base}".
  var header = finPageHeader('Planning FY' + _finPlanTargetYear,
    'Base year ' + _finPlanBaseYear + (baseProrated ? ' (annualized from ' + baseThroughWeek.toFixed(0) + ' weeks of actuals)' : '') + ' &middot; independent of QuickBooks until you commit',
    '<label class="fin-inline-field">Base year<input type="number" id="fin-plan-base-year" value="' + _finPlanBaseYear + '" onchange="finPlanChangeBaseYear()"></label>'
    + '<label class="fin-inline-field">Projecting for<input type="number" id="fin-plan-target-year" value="' + _finPlanTargetYear + '" onchange="finPlanChangeTargetYear()"></label>'
    + (isAdminUI ? '<button class="btn-primary" onclick="finPlanCommit()">Commit FY' + _finPlanTargetYear + ' plan</button>' : ''));

  // The navy strip's last cell is the connective tissue between this page and Financial Health:
  // what revenue would have to be for the plan to balance, and how far that is from this year's.
  var changeCents = projectedExpenseCents - baseExpenseProjCents;
  var changePct = baseExpenseProjCents ? (changeCents / Math.abs(baseExpenseProjCents) * 100) : null;
  var revenueNeededCents = projectedExpenseCents;
  var revenueDeltaCents = revenueNeededCents - baseRevenueProjCents;
  function stripCell(label, value, color, sub) {
    return '<div><div class="fin-navy-sublabel">' + label + '</div>'
      + '<div style="font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;' + (color ? 'color:' + color + ';' : '') + '">' + value + '</div>'
      + (sub ? '<div style="font-size:11.5px;color:rgba(255,255,255,.7);">' + sub + '</div>' : '') + '</div>';
  }
  var summaryStrip = '<div class="fin-navy-card fin-plan-strip">'
    + stripCell('FY' + _finPlanBaseYear + ' projected expenses', finMoney0(baseExpenseProjCents), '', '')
    + stripCell('FY' + _finPlanTargetYear + ' planned', finMoney0(projectedExpenseCents), 'var(--pale-gold)', '')
    + stripCell('Change', finFmtSigned(changeCents) + (changePct != null ? ' &middot; ' + (changePct >= 0 ? '+' : '') + changePct.toFixed(1) + '%' : ''), '', '')
    + '<div class="fin-plan-strip-last">' + stripCell('Revenue needed to balance', finMoney0(revenueNeededCents), 'var(--positive-on-navy)',
        (revenueDeltaCents >= 0 ? '+' : '') + finMoney0(Math.abs(revenueDeltaCents)) + ' on this year&rsquo;s revenue') + '</div>'
    + '</div>';

  el.innerHTML = header
    + summaryStrip
    + '<div class="fin-card" style="padding:20px 24px;">'
      + '<div class="fin-card-title" style="font-size:20px;">Category by category</div>'
      + '<div class="fin-card-sub">Planned figures are editable; &Delta;% flags anything growing faster than 4%.</div>'
      + tableHtml + actionsHtml
    + '</div>'
    + finRenderPlanningOutlook(projectedRevenueCents, projectedExpenseCents);
  // The Ivanhoe forecast mounts inside the row finRenderPlanningOutlook just wrote.
  finRenderPropertyMultiYearForecast();
}
// Five-year outlook. Expenses compound at the rate implied by the plan itself, revenue is held
// flat — not a forecast so much as the question "if nothing changes on the revenue side, what
// does this plan cost us?" The filled band between the two lines is the compounding gap, which is
// the only thing this chart exists to show.
function finRenderPlanningOutlook(baseRevenueCents, baseExpenseCents) {
  var N = 5;
  var expGrowth = 1.03, revGrowth = 1.0;
  var years = [];
  var rev = baseRevenueCents, exp = baseExpenseCents;
  for (var i = 0; i < N; i++) {
    years.push({ year: _finPlanTargetYear + i, revenueCents: rev, expenseCents: exp });
    rev = Math.round(rev * revGrowth);
    exp = Math.round(exp * expGrowth);
  }
  var all = years.reduce(function(a, y) { return a.concat([y.revenueCents, y.expenseCents]); }, []);
  var maxV = Math.max.apply(null, all.concat([1]));
  var minV = Math.min.apply(null, all.concat([0]));
  var span = Math.max(1, maxV - minV);
  var x0 = 60, x1 = 458, yTop = 40, yBot = 140;
  function px(i) { return years.length > 1 ? x0 + (x1 - x0) * (i / (years.length - 1)) : x0; }
  function py(c) { return yBot - ((c - minV) / span) * (yBot - yTop); }
  var expPts = years.map(function(y, i) { return px(i).toFixed(1) + ',' + py(y.expenseCents).toFixed(1); }).join(' ');
  var revPts = years.map(function(y, i) { return px(i).toFixed(1) + ',' + py(y.revenueCents).toFixed(1); }).join(' ');
  var band = expPts + ' ' + years.map(function(y, i) { return px(years.length - 1 - i).toFixed(1) + ',' + py(years[years.length - 1 - i].revenueCents).toFixed(1); }).join(' ');
  var yearLabels = years.map(function(y, i) { return '<text x="' + px(i).toFixed(1) + '" y="158">' + y.year + '</text>'; }).join('');
  var gl = [0, 1, 2].map(function(i) {
    var y = yBot - (yBot - yTop) * i / 2;
    return '<line x1="40" y1="' + y.toFixed(1) + '" x2="470" y2="' + y.toFixed(1) + '"></line>';
  }).join('');
  var glLabels = [0, 1, 2].map(function(i) {
    var y = yBot - (yBot - yTop) * i / 2;
    return '<text x="2" y="' + (y + 4).toFixed(1) + '">' + finMoney0(minV + span * i / 2) + '</text>';
  }).join('');
  var lastGap = years[years.length - 1].expenseCents - years[years.length - 1].revenueCents;
  return '<div class="fin-grid-2">'
    + '<div class="fin-card">'
      + '<div class="fin-card-title" style="font-size:20px;">Five-year outlook</div>'
      + '<div class="fin-card-sub">At 3% expense growth and flat revenue, the gap ' + (lastGap > 0 ? 'compounds to ' + finMoney0(lastGap) + ' by FY' + years[years.length - 1].year + '.' : 'stays closed through FY' + years[years.length - 1].year + '.') + '</div>'
      + '<svg viewBox="0 0 480 180" width="100%" height="170" role="img" aria-label="Outlook: expenses rising from '
      + finMoney0(years[0].expenseCents) + ' to ' + finMoney0(years[years.length - 1].expenseCents) + ' while flat revenue leaves a '
      + (lastGap > 0 ? 'widening gap' : 'surplus') + '">'
      + '<g stroke="var(--warm-row-divider)" stroke-width="1">' + gl + '</g>'
      + '<g font-size="9.5" fill="var(--warm-meta)">' + glLabels + '</g>'
      + '<polygon points="' + band + '" fill="var(--chip-negative-bg)"></polygon>'
      + '<polyline points="' + expPts + '" fill="none" stroke="var(--danger)" stroke-width="3"></polyline>'
      + '<polyline points="' + revPts + '" fill="none" stroke="var(--color-teal)" stroke-width="3" stroke-dasharray="6 5"></polyline>'
      + '<g font-size="10" fill="var(--warm-meta)" text-anchor="middle">' + yearLabels + '</g>'
      + '<g font-size="10.5" font-weight="700"><text x="40" y="176" fill="var(--danger)">&mdash; Expenses</text>'
      + '<text x="130" y="176" fill="var(--color-teal)">&mdash; Revenue if flat</text></g>'
      + '</svg></div>'
    + '<div id="fin-plan-property-mount"></div>'
    + '</div>';
}

function finPlanChangeTargetYear() {
  var y = parseInt(document.getElementById('fin-plan-target-year').value, 10);
  if (!isFinite(y)) return;
  // Flush any not-yet-fired autosave for the year being left FIRST — collect() below keys rows
  // off _finPlanTargetYear, so this has to run before that's overwritten, and _finPlanEdits has
  // to still hold the edits when it runs, before the reset on the next line.
  finPlanFlushAutoSave();
  _finPlanTargetYear = y;
  _finPlanEdits = {};
  finRenderPlanning();
  finRenderCompensation();
}
function finPlanEditCell(categoryPath, value) {
  _finPlanEdits[categoryPath] = value;
  finRerenderPlanTablePreserveFocus();
  finPlanScheduleAutoSave();
}
function finPlanEditBaseProjCell(categoryPath, value) {
  _finPlanBaseProjEdits[categoryPath] = value;
  finRerenderPlanTablePreserveFocus();
  finPlanScheduleAutoSave();
}
// Autosave — edits used to sit in memory (_finPlanEdits/_finPlanBaseProjEdits) until an explicit
// "Save Changes" click; navigating away (switching years, tabs, etc.) before that click silently
// discarded them. Every cell edit now schedules a debounced background save shortly after typing
// stops, so a change is persisted within ~1s regardless of whether "Save Changes" is ever clicked.
// Deliberately does NOT call finLoadPlanning() afterward like the manual Save button does — a
// full reload mid-typing would blow away in-progress edits/focus; the local edit maps already
// reflect what was just saved, so there's nothing to refresh.
var _finPlanAutoSaveTimer = null;
function finPlanScheduleAutoSave() {
  clearTimeout(_finPlanAutoSaveTimer);
  _finPlanAutoSaveTimer = setTimeout(finPlanAutoSaveNow, 800);
}
function finPlanFlushAutoSave() {
  clearTimeout(_finPlanAutoSaveTimer);
  finPlanAutoSaveNow();
}
// Shared by the debounced autosave and the manual "Save Changes" button — walks the tree once,
// collecting every path with a pending edit into the two shapes each save endpoint expects.
function finPlanCollectPendingEdits() {
  var rows = [], baseProjRows = [];
  function collect(nodes) {
    (nodes || []).forEach(function(node) {
      var v = _finPlanEdits[node.path];
      if (v !== undefined && v !== '' && isFinite(parseFloat(v))) {
        rows.push({ category: node.path, classification: node.classification, fiscal_year: _finPlanTargetYear, planned_amount: v });
      }
      // Base-projection edits are pre-sanitized to digits-only (or '') by
      // finPlanSanitizeWholeDollarInput, so any recorded edit is already valid — including an
      // intentional '' (cleared field), which the backend treats as "remove the override."
      var bv = _finPlanBaseProjEdits[node.path];
      if (bv !== undefined) baseProjRows.push({ category: node.path, amount: bv });
      collect(node.children);
    });
  }
  collect(_finPlanBaseTree);
  return { rows: rows, baseProjRows: baseProjRows };
}
function finPlanAutoSaveNow() {
  var pending = finPlanCollectPendingEdits();
  if (!pending.rows.length && !pending.baseProjRows.length) return;
  var msgEl = document.getElementById('fin-plan-msg');
  if (msgEl) msgEl.textContent = 'Saving…';
  Promise.all([
    pending.rows.length ? api('/admin/api/finance/planning/church/override-bulk', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ rows: pending.rows }) }) : Promise.resolve({ saved: 0 }),
    pending.baseProjRows.length ? api('/admin/api/finance/planning/base-projection', { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ year: _finPlanBaseYear, rows: pending.baseProjRows }) }) : Promise.resolve({ saved: 0 }),
  ]).then(function(results) {
    var d = results[0], d2 = results[1];
    if (!msgEl) return;
    if (d && d.error) { msgEl.textContent = d.error; return; }
    if (d2 && d2.error) { msgEl.textContent = d2.error; return; }
    msgEl.textContent = 'Saved automatically.';
  }).catch(function(err) { if (msgEl) msgEl.textContent = err && err.message || 'Autosave failed — click Save Changes to retry.'; });
}
function finPlanGenerateAll() {
  // The Growth Assumption % field defaults to a real "3" value (not just a placeholder — a
  // placeholder-only field silently sent nothing when left untouched, aborting here with no
  // visible result). Also toast the outcome, not just the msgEl line below the buttons — that
  // line lives inside #fin-plan-root, which finLoadPlanning() below immediately blanks to
  // "Loading…" on success, so a plain textContent update there could flash and disappear before
  // being seen.
  var growthPct = parseFloat(document.getElementById('fin-plan-growth').value);
  var msgEl = document.getElementById('fin-plan-msg');
  if (!isFinite(growthPct)) { if (msgEl) msgEl.textContent = 'Enter a growth % first.'; finToast('Enter a growth % first.'); return; }
  if (msgEl) msgEl.textContent = 'Generating…';
  var body = { base_year: _finPlanBaseYear, target_year: _finPlanTargetYear, growth_pct: growthPct / 100 };
  api('/admin/api/finance/planning/church/generate-all', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }).then(function(d) {
    if (d && d.error) { if (msgEl) msgEl.textContent = d.error; finToast(d.error); return; }
    var summary = 'Generated ' + d.generated + ' line(s) for FY' + _finPlanTargetYear + '.' + (d.prorated ? ' Base year actuals were annualized from ' + d.throughWeek.toFixed(1) + ' week(s) of data before applying growth.' : '');
    finToast(summary);
    finLoadPlanning();
  }).catch(function(err) { var msg = err && err.message || 'Generate failed.'; if (msgEl) msgEl.textContent = msg; finToast(msg); });
}
function finPlanSaveAll() {
  clearTimeout(_finPlanAutoSaveTimer);
  var msgEl = document.getElementById('fin-plan-msg');
  var pending = finPlanCollectPendingEdits();
  if (!pending.rows.length && !pending.baseProjRows.length) { msgEl.textContent = 'No changes to save.'; return; }
  msgEl.textContent = 'Saving…';
  Promise.all([
    pending.rows.length ? api('/admin/api/finance/planning/church/override-bulk', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ rows: pending.rows }) }) : Promise.resolve({ saved: 0 }),
    pending.baseProjRows.length ? api('/admin/api/finance/planning/base-projection', { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ year: _finPlanBaseYear, rows: pending.baseProjRows }) }) : Promise.resolve({ saved: 0 }),
  ]).then(function(results) {
    var d = results[0], d2 = results[1];
    if (d && d.error) { msgEl.textContent = d.error; return; }
    if (d2 && d2.error) { msgEl.textContent = d2.error; return; }
    msgEl.textContent = 'Saved ' + (d.saved || 0) + ' plan line(s), ' + (d2.saved || 0) + ' projected line(s).';
    finLoadPlanning();
  }).catch(function(err) { msgEl.textContent = err && err.message || 'Save failed.'; });
}
function finPlanCommit() {
  // Commit reads whatever's already persisted server-side, not the in-memory edit maps — flush
  // any not-yet-fired autosave first so a commit right after typing includes the latest figures.
  finPlanFlushAutoSave();
  var msgEl = document.getElementById('fin-plan-msg');
  var year = _finPlanTargetYear;
  if (!confirm('Commit all planned lines for FY' + year + ' into the real Church Budget as a placeholder? This replaces any previously committed plan for that year, and will itself be overridden the moment a real sync or import exists for ' + year + '.')) return;
  msgEl.textContent = 'Committing…';
  api('/admin/api/finance/planning/church/commit', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ fiscal_year: year }) }).then(function(d) {
    if (d && d.error) { msgEl.textContent = d.error; return; }
    msgEl.textContent = 'Committed ' + d.committed + ' line(s) for FY' + year + '.';
  }).catch(function(err) { msgEl.textContent = err && err.message || 'Commit failed.'; });
}

// ── Salary & Benefits Calculator (LCMS Missouri District Compensation Guidelines FY2026-2027) ──
// Base salary × role/education/experience multiplier, per the district's own published tables —
// verbatim from the PDF the user provided, not approximated. Extend LCMS_MO_BASE_SALARY_BY_YEAR
// with next year's base figure when a new guideline document comes out (Base Salary History
// table, page 2 of the PDF). Benefits (health/retirement via Concordia Plan Services) have no
// published $ or % formula in this document — CPS quotes those directly per congregation via
// their own (login-gated) tool — so Benefits here is a plain user-entered figure, not computed.
var LCMS_MO_BASE_SALARY_BY_YEAR = { 2016: 39900, 2017: 40000, 2018: 40250, 2019: 40900, 2020: 41718, 2021: 42625, 2022: 43515, 2023: 45475, 2024: 47066, 2025: 48713, 2026: 50028, 2027: 51529 };
// Section 1.1 — Annual Compensation Scale for Pastors, years of experience 0-30; the district
// recommends +0.02/year of additional multiplier for service beyond 30 years (no hard cap).
var LCMS_PASTOR_MULTIPLIERS = [1.45,1.47,1.49,1.51,1.54,1.57,1.60,1.63,1.66,1.69,1.72,1.75,1.78,1.81,1.84,1.87,1.90,1.93,1.96,1.99,2.01,2.03,2.05,2.07,2.09,2.11,2.13,2.15,2.17,2.19,2.21];
// Section 1.2 — Annual Compensation Scale for Commissioned Workers (educators/DCE/DCO/Deaconess/
// etc). Each education track's multiplier caps at the printed table's last year (the district's
// own footnote: reaching the end of a column stops further years-of-service increases, to
// encourage further formal education) EXCEPT the three degree tracks at/above a Master's, which
// the district recommends growing +0.02/year beyond year 25 instead of capping.
var LCMS_COMMISSIONED_TRACKS = {
  bs:      { label: 'B.S., no further hours', multipliers: [1.00,1.02,1.04,1.06,1.08,1.10,1.12,1.14,1.16,1.18,1.20], capped: true },
  bs10:    { label: 'B.S. + 10 hrs (working toward MA)', multipliers: [1.03,1.05,1.07,1.09,1.12,1.15,1.18,1.20,1.22,1.24,1.26,1.28,1.30], capped: true },
  bs20:    { label: 'B.S. + 20 hrs (working toward MA)', multipliers: [1.06,1.08,1.10,1.12,1.15,1.18,1.21,1.24,1.27,1.30,1.33,1.35,1.37,1.39,1.41,1.43], capped: true },
  ma:      { label: 'M.A.', multipliers: [1.12,1.14,1.16,1.18,1.21,1.24,1.27,1.30,1.33,1.36,1.39,1.42,1.45,1.48,1.51,1.53,1.55,1.57,1.59,1.61,1.63,1.65,1.67,1.69,1.71,1.73], growBeyond: 0.02 },
  ma10phd: { label: 'M.A. + 10 hrs (working toward PhD)', multipliers: [1.16,1.18,1.20,1.22,1.25,1.28,1.31,1.34,1.37,1.40,1.43,1.46,1.49,1.52,1.55,1.58,1.61,1.64,1.66,1.68,1.70,1.72,1.74,1.76,1.78,1.80], growBeyond: 0.02 },
  ma20phd: { label: 'M.A. + 20 hrs (working toward PhD)', multipliers: [1.20,1.22,1.24,1.26,1.29,1.32,1.35,1.38,1.41,1.44,1.47,1.50,1.53,1.56,1.59,1.62,1.65,1.68,1.71,1.74,1.77,1.79,1.81,1.83,1.85,1.87], growBeyond: 0.02 },
};
// Section 1.3 — Annual Compensation Scale for Other Church Workers, years 0-20; the district
// recommends +0.02/year beyond year 20 for all four of these (no cap, unlike the B.S.-only
// commissioned tracks above).
var LCMS_OTHER_WORKER_TRACKS = {
  custodian:              { label: 'Custodian', multipliers: [0.65,0.67,0.69,0.72,0.75,0.78,0.81,0.84,0.87,0.90,0.93,0.96,0.99,1.02,1.05,1.08,1.11,1.14,1.17,1.19,1.21], growBeyond: 0.02 },
  secretary:              { label: 'Secretary', multipliers: [0.75,0.77,0.79,0.82,0.85,0.88,0.91,0.94,0.97,1.00,1.03,1.06,1.09,1.12,1.15,1.18,1.21,1.24,1.27,1.29,1.31], growBeyond: 0.02 },
  childcare_director:     { label: 'Child Care Director', multipliers: [1.05,1.07,1.09,1.12,1.15,1.18,1.21,1.24,1.27,1.30,1.33,1.36,1.39,1.42,1.45,1.48,1.51,1.54,1.57,1.59,1.61], growBeyond: 0.02 },
  business_manager_music: { label: 'Business Manager / Director of Music', multipliers: [1.10,1.12,1.14,1.17,1.20,1.23,1.26,1.29,1.32,1.35,1.38,1.41,1.44,1.47,1.50,1.53,1.56,1.59,1.62,1.65,1.68], growBeyond: 0.02 },
};
// Section 1.6 — additional multiplier for extra responsibility, added on top of the base
// education/experience multiplier (e.g. a teacher who is also Principal). Ranges as published;
// the calculator uses the midpoint as a starting default, hand-adjustable per worker.
var LCMS_RESPONSIBILITY_STIPENDS = [
  { key: 'none', label: 'None', range: [0, 0] },
  { key: 'exec_director', label: 'Executive Director', range: [0.25, 0.45] },
  { key: 'principal', label: 'Principal', range: [0.20, 0.40] },
  { key: 'early_childhood_director', label: 'Early Childhood Director', range: [0.10, 0.20] },
  { key: 'assistant_principal', label: 'Assistant Principal', range: [0.10, 0.20] },
  { key: 'dce', label: 'Director of Christian Education', range: [0.10, 0.20] },
  { key: 'music_director', label: 'Director of Music for Congregation', range: [0.05, 0.15] },
  { key: 'youth_director', label: 'Director of Youth', range: [0.05, 0.15] },
  { key: 'part_time_admin', label: 'Administrator for Part-Time Agencies', range: [0.05, 0.15] },
  { key: 'athletic_director', label: 'Athletic Director', range: [0.05, 0.15] },
  { key: 'tech_coordinator', label: 'Technology Coordinator', range: [0.05, 0.15] },
];
// Section 1.4 — additional multiplier for a sole/senior pastor, based on worship attendance.
var LCMS_ATTENDANCE_BONUS_BANDS = [
  { key: 'none', label: 'Not applicable / under 150', range: [0, 0] },
  { key: 'band1', label: '150–350 average attendance', range: [0.05, 0.10] },
  { key: 'band2', label: '351–750 average attendance', range: [0.10, 0.15] },
  { key: 'band3', label: '750+ average attendance', range: [0.15, 0.25] },
];
// Pure — no DOM — the compound annual growth rate implied by the district's own published base
// salary history (first published year to last), as one data-backed growth-rate option — derived
// from the table itself, so it never needs separate updating when the table grows.
function finLcmsHistoricalAvgGrowthPct() {
  var years = Object.keys(LCMS_MO_BASE_SALARY_BY_YEAR).map(Number).sort(function(a,b){return a-b;});
  var first = years[0], last = years[years.length - 1];
  if (last === first) return 0;
  return Math.pow(LCMS_MO_BASE_SALARY_BY_YEAR[last] / LCMS_MO_BASE_SALARY_BY_YEAR[first], 1 / (last - first)) - 1;
}
// The most recent OFFICIAL (not projected) Social Security COLA at the time this was written —
// 2.8%, effective for 2026. The SSA doesn't announce a given year's COLA until October of the
// prior year (based on Jul-Sep CPI data), so this needs a manual update once the 2027 figure is
// officially announced; various projections as of mid-2026 estimate it around 3.7-3.8%.
var SSA_COLA_REFERENCE_PCT = 0.028;
// Looks up (or extrapolates) a multiplier from one of the tables above. growBeyond extends the
// scale past its last published year; capped freezes at the last published value instead
// (matches the district's own distinction between the B.S.-only commissioned tracks, which cap
// to encourage further education, and every other track, which the district recommends growing).
function finLcmsMultiplierFor(track, yearsExperience) {
  var years = Math.max(0, Math.floor(Number(yearsExperience) || 0));
  var multipliers = track.multipliers;
  if (years < multipliers.length) return multipliers[years];
  var last = multipliers[multipliers.length - 1];
  if (track.capped || !track.growBeyond) return last;
  return Math.round((last + track.growBeyond * (years - (multipliers.length - 1))) * 100) / 100;
}
// Pure — no DOM — computes one worker's salary per the LCMS MO District formula: base salary (by
// year) × (role/education/experience multiplier + any responsibility stipend + any attendance
// bonus, the latter only meaningful for a sole/senior pastor per Section 1.4).
function finComputeLcmsSalary(opts) {
  var base = finLcmsBaseSalaryCents(opts.year, opts.colaPct, opts.referenceByYear);
  var track;
  if (opts.role === 'pastor') track = { multipliers: LCMS_PASTOR_MULTIPLIERS, growBeyond: 0.02 };
  else if (opts.role === 'commissioned') track = LCMS_COMMISSIONED_TRACKS[opts.trackKey];
  else track = LCMS_OTHER_WORKER_TRACKS[opts.trackKey];
  if (!track) return null;
  var multiplier = finLcmsMultiplierFor(track, opts.yearsExperience) + (Number(opts.responsibilityStipend) || 0) + (Number(opts.attendanceBonus) || 0);
  var salaryCents = Math.round(base.dollars * 100 * multiplier);
  return { baseDollars: base.dollars, baseExact: base.exact, baseSourceYear: base.sourceYear, multiplier: multiplier, salaryCents: salaryCents };
}

// Pastors and Commissioned Ministers (e.g. DCEs) are classified by the IRS as self-employed for
// Social Security purposes ("Ministers of Religion") — the church does not pay the employer half
// of FICA for them, the worker pays the full SECA amount themselves. Other Church Workers are
// regular W-2 employees, so the church does pay the standard employer share. This default can be
// wrong for a specific real worker (e.g. a Director of Parish Music who is treated as a regular
// employee at a given congregation despite nominally qualifying for minister tax treatment
// elsewhere), so it's a per-worker override, not a hardcoded role rule.
function finDefaultSelfEmployedFica(role) {
  return role === 'pastor' || role === 'commissioned';
}
var LCMS_EMPLOYER_FICA_RATE = 0.0765; // combined employer OASDI (6.2%) + Medicare (1.45%)
// Employer-side FICA cost to the church — $0 for a self-employed (SECA) worker, since the church
// has no employer-FICA obligation for them at all; the worker pays their own full SECA share
// outside of what the church budgets here.
function finComputeEmployerFicaCents(salaryCents, selfEmployedFica) {
  if (selfEmployedFica) return 0;
  return Math.round((salaryCents || 0) * LCMS_EMPLOYER_FICA_RATE);
}

// Real rates from the church's own "Overview of your Concordia Plans Participation" statement
// (as of July 2026) — both apply to every salaried worker uniformly (not conditioned on FICA
// self-employment status, unlike the FICA/SECA split above), and both change annually, so each
// is a small by-year table with the same flat-fallback pattern as LCMS_MO_BASE_SALARY_BY_YEAR.
var CONCORDIA_PENSION_RATE_BY_YEAR = { 2026: 0.1070, 2027: 0.1170 }; // Concordia Retirement Plan, Traditional Option
var CONCORDIA_DISABILITY_RATE_BY_YEAR = { // Concordia Disability and Survivor Plan — rate depends on the worker's dependent status
  2026: { withoutDependents: 0.0120, withDependents: 0.0175 },
  2027: { withoutDependents: 0.0120, withDependents: 0.0175 }
};
function finConcordiaPensionRateFor(year) {
  var years = Object.keys(CONCORDIA_PENSION_RATE_BY_YEAR).map(Number).sort(function(a,b){return a-b;});
  var found = CONCORDIA_PENSION_RATE_BY_YEAR[year];
  if (found != null) return { rate: found, exact: true, sourceYear: year };
  var candidates = years.filter(function(y) { return y <= year; });
  var sourceYear = candidates.length ? candidates[candidates.length - 1] : years[0];
  return { rate: CONCORDIA_PENSION_RATE_BY_YEAR[sourceYear], exact: false, sourceYear: sourceYear };
}
function finConcordiaDisabilityRateFor(year, hasDependents) {
  var years = Object.keys(CONCORDIA_DISABILITY_RATE_BY_YEAR).map(Number).sort(function(a,b){return a-b;});
  var key = hasDependents ? 'withDependents' : 'withoutDependents';
  var found = CONCORDIA_DISABILITY_RATE_BY_YEAR[year];
  if (found != null) return { rate: found[key], exact: true, sourceYear: year };
  var candidates = years.filter(function(y) { return y <= year; });
  var sourceYear = candidates.length ? candidates[candidates.length - 1] : years[0];
  return { rate: CONCORDIA_DISABILITY_RATE_BY_YEAR[sourceYear][key], exact: false, sourceYear: sourceYear };
}

var _finSalaryRoster = [];
// Pure — no DOM — a straight percentage-of-salary employer cost (shared math for both Pension and
// Disability & Survivor — same shape as employer FICA, just with rates set by Concordia yearly).
// Percent-as-fraction round-trips through the storage layer (typed "11.7" -> /100 -> 0.117 ->
// *100 for display) pick up float noise (0.117*100 = 11.700000000000001) — .toFixed(2) used to
// mask that, but reformatting the LIVE value on every keystroke (this whole card rerenders on
// oninput) fights the user's typing exactly like the District Reference Data bug documented
// above: the displayed value changes out from under them mid-type, reading as "typing backward."
// Rounding to a clean number instead (not a zero-padded string) fixes both — no float garbage,
// and the redisplayed value matches what was actually typed instead of being reformatted.
function finFmtPctInput(fraction) {
  return Math.round((Number(fraction) || 0) * 10000) / 100;
}
function finComputePensionCents(salaryCents, pensionPct) {
  return Math.round((salaryCents || 0) * (Number(pensionPct) || 0));
}
// Real paychecks: divide the exact LCMS-formula annual figure by the number of pay periods,
// round THAT per-period amount to the nearest $5, then multiply back by the period count — so the
// annual salary is always an exact whole multiple of a clean per-period paycheck (26 biweekly
// periods/yr), rather than a round annual figure that itself doesn't divide evenly. Deliberately
// NOT applied inside finComputeLcmsSalary itself — that function's exactness is what the PDF
// reconciliation tests depend on; this rounding only touches the "real compensation" computation
// path (roster table, Total Compensation, scenario comparison, bottom line).
var FIN_SALARY_PAY_PERIODS = 26;
function finRoundSalaryCents(cents) {
  var perPeriodCents = cents / FIN_SALARY_PAY_PERIODS;
  var perPeriodRounded = Math.round(perPeriodCents / 500) * 500;
  return perPeriodRounded * FIN_SALARY_PAY_PERIODS;
}
// Pure — no DOM — a worker's linked payroll account's (e.g. "58001") FY{baseYear} BUDGETED annual
// total — not the YTD Actual total, which is a partial-year figure (whatever's been paid out so
// far this fiscal year) and would badly understate a still-in-progress year's real annual salary.
// "What's currently in the budget" means the full-year Budget line, which is exactly what a salary
// planner needs as its starting point. Falls back to the account's Actual total only when the
// account has no budget entered at all (hasBudgetInfo false) — some better-than-nothing number is
// still preferable to silently falling all the way through to the generic LCMS formula. Same
// lookup the roster table's "FY{base} Acct Actual" reference column already uses, factored out
// here because it's now also the default basis for "None (flat)" below. Returns null if the worker
// has no account code, or the code doesn't match any account in this year's budget tree.
function finAccountBudgetCentsForCode(code) {
  if (!code) return null;
  var allAccountNodes = [];
  (function flatten(nodes) { (nodes || []).forEach(function(n) { allAccountNodes.push(n); flatten(n.children); }); })(_finPlanBaseTree);
  var node = allAccountNodes.filter(function(n) { return n.path.indexOf(code) >= 0 || n.label.indexOf(code) >= 0; })[0];
  if (!node) return null;
  return node.hasBudgetInfo ? node.totalBudgetCents : node.totalActualCents;
}
// Concordia Plans' "Compensation Decision Support Tool" — a report a congregation runs manually
// per worker (PDF, not an API — see the real Rev. Dinger example this was built from: Position
// Pastor-Senior Administrative, 20 yrs, Masters, run 2026-07-21) giving 4 ranges (Church Market /
// Church LCMS / District Market / District, each Low/Mid/High) to compare against the computed
// LCMS-guideline salary above. Purely a manual reference — no formula, since it's congregation-
// and role-specific data pulled from Concordia's own tool, not derivable from anything this app
// already has. Stored as w.concordia on the same roster row, persisted by the existing Save
// button (roster is saved wholesale) — no new endpoint needed.
var FIN_CONCORDIA_RANGE_KEYS = [
  { key: 'churchMarket', label: 'Church Market Range' },
  { key: 'churchLcms', label: 'Church LCMS Range' },
  { key: 'districtMarket', label: 'District Market Range' },
  { key: 'district', label: 'District Range' },
];
// The real reports the church ran on 2026-07-21, one per worker, transcribed verbatim from the
// PDFs (not approximated). Prefilled once per worker only when that worker has no Concordia data
// saved yet — matched on last name, since the roster is hand-typed and its order is not stable.
// A parish-professional report has no District Results section at all (only the pastor report
// does), which is why two of the four ranges are absent for the non-pastor workers rather than
// zero-filled. Re-running the tool in a later year means editing these figures in place, not a
// code change — every value below is an editable field.
var FIN_CONCORDIA_SEED_BY_NAME = {
  dinger: {
    position: 'Pastor-Senior Administrative', years: '20', education: 'Masters', asOfDate: '07/21/2026',
    churchMarketLow: '111,952', churchMarketMid: '131,708', churchMarketHigh: '151,464',
    churchLcmsLow: '88,068', churchLcmsMid: '103,609', churchLcmsHigh: '119,150',
    districtMarketLow: '99,843', districtMarketMid: '117,462', districtMarketHigh: '135,081',
    districtLow: '86,034', districtMid: '101,217', districtHigh: '116,400'
  },
  knapp: {
    position: 'Director of Parish Music', years: '20', education: '', asOfDate: '07/21/2026',
    churchMarketLow: '75,361', churchMarketMid: '81,914', churchMarketHigh: '88,467',
    churchLcmsLow: '67,596', churchLcmsMid: '73,474', churchLcmsHigh: '79,352'
  },
  thompson: {
    position: 'Director of Christian Education', years: '22', education: '', asOfDate: '07/21/2026',
    churchMarketLow: '78,252', churchMarketMid: '85,056', churchMarketHigh: '91,860',
    churchLcmsLow: '63,818', churchLcmsMid: '69,367', churchLcmsHigh: '74,916'
  }
};
// Called once after the roster loads (saved or seeded). Never overwrites anything already stored,
// so an admin's own edits — or a deliberately cleared field — always win over the prefill.
function finConcordiaSeedRoster() {
  _finSalaryRoster.forEach(function(w) {
    if (w.concordia && Object.keys(w.concordia).length) return;
    var key = String(w.name || '').trim().toLowerCase();
    var seed = FIN_CONCORDIA_SEED_BY_NAME[key];
    if (seed) w.concordia = JSON.parse(JSON.stringify(seed));
  });
}
// Tolerant of however the figure was typed ("$103,609", "103609.00", "103,609") — these are
// hand-copied off a PDF, so the stored value is free text by design.
function finConcordiaParseMoneyCents(raw) {
  if (raw == null) return null;
  var cleaned = String(raw).replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  var n = parseFloat(cleaned);
  return isFinite(n) ? Math.round(n * 100) : null;
}
function finConcordiaMidCentsFor(w, rangeKey) {
  return finConcordiaParseMoneyCents((w.concordia || {})[rangeKey + 'Mid']);
}

// ── Health Insurance Renewal Options (Concordia Plans quote #0560500326, effective 2027) ──────
// One congregation-wide group enrollment, not a per-worker figure like the salary roster above —
// Medical/Dental/Vision premiums for the church's actual Current plan, its Renewal (same plan
// design, new rates), and 3 alternate medical plan options Concordia offered alongside it. Dental
// and Vision are the same across Renewal/Option 1/2/3 (only Current has the old, lower Dental
// rate) — this is a real quirk of the source quote, not a data-entry simplification.
// deductibleFamilyCents/oopMaxFamilyCents/deductibleIndividualCents/oopMaxIndividualCents and
// embedded are all straight from the quote's plan-design table (page 1), used below to work out
// whether a richer plan's extra premium is actually worth it against real claims levels.
// The four coverage tiers Concordia's "Enrollment and Rates" block prices, in its own order. A
// worker sits on exactly one of them (or opts out), and the rate is MONTHLY — which is how the
// packet publishes it and therefore how it should be typed in.
var FIN_HEALTH_TIERS = [
  { key: 'self', label: 'Self' },
  { key: 'selfSpouse', label: 'Self & Spouse' },
  { key: 'selfChild', label: 'Self & Child' },
  { key: 'family', label: 'Family' }
];
// Concordia Plans quote #0560500326, effective 2027. tiersMonthlyCents is the packet's Enrollment
// and Rates block verbatim; dental and vision are NOT tier-priced there, so they stay annual group
// figures shared evenly across whoever is enrolled. Medical annual therefore falls out of
// enrollment x tier rate x 12 rather than being stored — for this church's real enrollment (2 Family)
// that reproduces the packet's own $49,224.00 exactly.
var HEALTH_PLAN_QUOTE_2027 = {
  effectiveYear: 2027,
  enrollmentContracts: 2, // kept for the pre-tier save shape; real counts now come from the roster
  enrollmentCounts: { self: 0, selfSpouse: 0, selfChild: 0, family: 2 },
  coinsuranceRate: 0.20,  // "Coinsurance 20%" — the same for every option in this quote
  options: {
    current: { label: 'Current — Healthy Me HSA-C (BCBS)', tiersMonthlyCents: { self: 70424, selfSpouse: 141552, selfChild: 117608, family: 188736 }, dentalCents: 144732, visionCents: 73584, embedded: true, deductibleFamilyCents: 700000, oopMaxFamilyCents: 1400000, deductibleIndividualCents: 350000, oopMaxIndividualCents: 700000 },
    renewal: { label: 'Renewal — Stay in Current Plan (Healthy Me HSA-C)', tiersMonthlyCents: { self: 76530, selfSpouse: 153825, selfChild: 127805, family: 205100 }, dentalCents: 152340, visionCents: 73584, embedded: true, deductibleFamilyCents: 800000, oopMaxFamilyCents: 1600000, deductibleIndividualCents: 400000, oopMaxIndividualCents: 800000 },
    option1: { label: 'Option 1 — Healthy Me HSA-A (BCBS)', tiersMonthlyCents: { self: 89110, selfSpouse: 179111, selfChild: 148814, family: 238815 }, dentalCents: 152340, visionCents: 73584, embedded: false, deductibleFamilyCents: 400000, oopMaxFamilyCents: 800000, deductibleIndividualCents: 200000, oopMaxIndividualCents: 400000 },
    option2: { label: 'Option 2 — Healthy Me HSA-B (BCBS)', tiersMonthlyCents: { self: 81655, selfSpouse: 164127, selfChild: 136364, family: 218835 }, dentalCents: 152340, visionCents: 73584, embedded: false, deductibleFamilyCents: 600000, oopMaxFamilyCents: 850000, deductibleIndividualCents: 300000, oopMaxIndividualCents: 600000 },
    option3: { label: 'Option 3 — Healthy Me HSA-D (BCBS)', tiersMonthlyCents: { self: 68614, selfSpouse: 137914, selfChild: 114585, family: 183886 }, dentalCents: 152340, visionCents: 73584, embedded: true, deductibleFamilyCents: 1100000, oopMaxFamilyCents: 1700000, deductibleIndividualCents: 550000, oopMaxIndividualCents: 850000 }
  }
};
// The monthly rate for one tier of one option, honoring an admin override typed on the rates page.
function finHealthTierMonthlyCents(optionKey, tierKey, premiumOverrides) {
  var opt = HEALTH_PLAN_QUOTE_2027.options[optionKey];
  if (!opt) return null;
  var ov = (premiumOverrides || (typeof _finHealthPlanPremiumOverrides !== 'undefined' ? _finHealthPlanPremiumOverrides : {}))[optionKey] || {};
  var t = ov.tiersMonthlyCents || {};
  return t[tierKey] != null ? t[tierKey] : (opt.tiersMonthlyCents || {})[tierKey];
}
// { [optionKey]: { medicalCents, dentalCents, visionCents } } — an admin can override any of the
// 3 premium lines for any plan option (the quote is a fixed 2027 snapshot; a future year's renewal
// quote will have different real numbers), unset fields fall back to the quote's own figure.
var _finHealthPlanPremiumOverrides = {};
// Pure — no DOM — returns the Medical/Dental/Vision breakdown + total annual employer cost in
// cents for one of the HEALTH_PLAN_QUOTE_2027 options (after applying any admin override on top
// of the quote's own figures), or null for an unrecognized key.
// Enrollment defaults to the quote's own counts so this stays a pure function of the quote — the
// live roster's counts are passed in by the UI. A legacy medicalCents override (the pre-tier save
// shape, one annual figure for the whole group) still wins if one is stored, so nothing an admin
// typed under the old card is silently discarded.
// Dental and vision are PER COVERED WORKER, confirmed by the church against real premiums:
// $120.61/mo dental and $61.32/mo vision each on the current plan, i.e. $1,447.32 and $735.84 a
// year per worker. The figures stored above are those per-worker annual amounts.
//
// ⚠ The renewal packet's own dental and vision lines are TWICE these, because they are quoted for
// the two contracts enrolled at the time. Transcribing a packet line straight in therefore doubles
// every covered worker's dental and vision. Check a packet figure against the per-worker monthly
// premium before entering it.
//
// This used to treat those figures as a single group bill divided across whoever was enrolled, so
// a covered worker's dental and vision fell every time a colleague joined, and adding a covered
// worker added nothing at all to the church's total. At the church's stated figures a family-tier
// worker costs $24,612.00 medical + $3,046.80 dental + $1,471.68 vision = $29,130.48.
function finHealthAncillaryPerContractCents(optionKey, premiumOverrides) {
  var opt = HEALTH_PLAN_QUOTE_2027.options[optionKey];
  if (!opt) return { dentalCents: 0, visionCents: 0 };
  var ov = (premiumOverrides || (typeof _finHealthPlanPremiumOverrides !== 'undefined' ? _finHealthPlanPremiumOverrides : {}))[optionKey] || {};
  return {
    dentalCents: ov.dentalCents != null ? ov.dentalCents : opt.dentalCents,
    visionCents: ov.visionCents != null ? ov.visionCents : opt.visionCents
  };
}
function finComputeHealthPlanTotalCents(optionKey, premiumOverrides, enrollment) {
  var opt = HEALTH_PLAN_QUOTE_2027.options[optionKey];
  if (!opt) return null;
  var ov = (premiumOverrides || (typeof _finHealthPlanPremiumOverrides !== 'undefined' ? _finHealthPlanPremiumOverrides : {}))[optionKey] || {};
  var counts = enrollment || HEALTH_PLAN_QUOTE_2027.enrollmentCounts;
  var tiers = {}, monthlyCents = 0, contracts = 0;
  FIN_HEALTH_TIERS.forEach(function(t) {
    var rate = finHealthTierMonthlyCents(optionKey, t.key, premiumOverrides) || 0;
    var n = Math.max(0, Math.floor(Number(counts[t.key]) || 0));
    tiers[t.key] = { monthlyCents: rate, count: n };
    monthlyCents += rate * n;
    contracts += n;
  });
  var medicalCents = ov.medicalCents != null ? ov.medicalCents : monthlyCents * 12;
  // Scaled to who is actually covered — see finHealthAncillaryPerContractCents.
  var perContract = finHealthAncillaryPerContractCents(optionKey, premiumOverrides);
  var dentalCents = perContract.dentalCents * contracts;
  var visionCents = perContract.visionCents * contracts;
  var totalCents = medicalCents + dentalCents + visionCents;
  var overridden = ov.medicalCents != null || ov.dentalCents != null || ov.visionCents != null
    || Object.keys(ov.tiersMonthlyCents || {}).length > 0;
  return {
    label: opt.label, medicalCents: medicalCents, dentalCents: dentalCents, visionCents: visionCents,
    totalCents: totalCents, overridden: overridden, tiers: tiers, contracts: contracts,
    monthlyCents: monthlyCents, monthlyTotalCents: Math.round(totalCents / 12)
  };
}
// Pure — no DOM — a plan's own out-of-pocket cost for a given total billed amount, under a plain
// deductible-then-coinsurance-up-to-an-OOP-max design (every option in this quote works this way).
function finComputePlanOOPCents(deductibleCents, oopMaxCents, coinsuranceRate, spendCents) {
  if (spendCents <= deductibleCents) return spendCents;
  var coinsuranceCapCents = oopMaxCents - deductibleCents;
  var oopFromCoinsurance = Math.min((spendCents - deductibleCents) * coinsuranceRate, coinsuranceCapCents);
  return deductibleCents + oopFromCoinsurance;
}
// Pure — no DOM — the extra (or reduced) out-of-pocket cost of being on toKey instead of fromKey
// for ONE family, assuming the whole family's medical costs (spendCents) are concentrated in a
// single member (not spread across 2+ people) — the case a non-embedded plan's aggregate
// deductible/OOP-max hits hardest, since one person alone has to clear the same (family-size)
// threshold that an embedded plan would have capped at a smaller individual number. Positive =
// toKey costs the family more at that spend level; this is the worst-case comparison, not the
// typical one — see finComputeHealthPlanFamilyBreakevenCents for the multi-member case.
function finComputeHealthPlanSingleClaimantDeltaCents(fromKey, toKey, spendCents) {
  var fromTerms = finHealthPlanEffectiveLoneClaimantTermsCents(fromKey), toTerms = finHealthPlanEffectiveLoneClaimantTermsCents(toKey);
  if (!fromTerms || !toTerms) return null;
  var rate = HEALTH_PLAN_QUOTE_2027.coinsuranceRate;
  return finComputePlanOOPCents(toTerms.deductibleCents, toTerms.oopMaxCents, rate, spendCents) - finComputePlanOOPCents(fromTerms.deductibleCents, fromTerms.oopMaxCents, rate, spendCents);
}
// Pure — no DOM — one plan option with its four deductible/out-of-pocket figures resolved through
// any admin override typed into the rates table. Every consumer below used to read
// HEALTH_PLAN_QUOTE_2027 directly, so a corrected deductible changed the displayed figure and
// nothing else: the breakeven analysis silently kept using the hardcoded quote. Anything that
// reasons about these numbers must go through here.
function finHealthPlanResolvedOption(optionKey) {
  var opt = HEALTH_PLAN_QUOTE_2027.options[optionKey];
  if (!opt) return null;
  // Carries every original field through (label, tier rates, dental/vision) — callers treat this
  // as the option itself, so returning only the four resolved numbers silently blanked things
  // like opt.label at the call sites.
  var out = {};
  Object.keys(opt).forEach(function(k) { out[k] = opt[k]; });
  ['deductibleIndividualCents', 'deductibleFamilyCents', 'oopMaxIndividualCents', 'oopMaxFamilyCents'].forEach(function(f) {
    out[f] = finCompPlanQuoteField(optionKey, f);
  });
  return out;
}
// Pure — no DOM — the deductible/OOP-max that actually applies to ONE family member who alone
// accounts for all of a family contract's costs: the plan's own individual figures if it's
// embedded (each person protected separately), or its family figures if not (no individual
// sub-limit — a lone claimant has to clear the same aggregate threshold as the whole family).
function finHealthPlanEffectiveLoneClaimantTermsCents(optionKey) {
  var opt = finHealthPlanResolvedOption(optionKey);
  if (!opt) return null;
  return opt.embedded
    ? { deductibleCents: opt.deductibleIndividualCents, oopMaxCents: opt.oopMaxIndividualCents }
    : { deductibleCents: opt.deductibleFamilyCents, oopMaxCents: opt.oopMaxFamilyCents };
}
// How many people a "family" contract is assumed to cover when modeling costs spread across the
// household. Only matters for an EMBEDDED plan, where each member has their own limit inside the
// family one; a non-embedded plan pools everything and the count makes no difference. Default 2 —
// every option in this quote sets the family deductible at exactly 2x the individual one.
var _finHealthFamilySize = 2;
// Pure — no DOM — what a whole family actually pays out of pocket for spendCents of billed care,
// split evenly across a given number of people.
//
// Non-embedded: one pooled family deductible, one family out-of-pocket max — the member count is
// irrelevant, and this reduces exactly to the old family-figures-only calculation.
//
// Embedded: each member's contribution TOWARD the family deductible is capped at the individual
// deductible, and once a member has met their own deductible they start paying coinsurance even
// though the family deductible may not be met yet. Modelling only the family deductible (what this
// used to do) therefore overstates what an embedded plan costs a family whose costs are spread
// around — it charged full deductible dollars past the point real members would already have
// flipped to coinsurance. Caps are applied both per member (individual OOP max) and to the
// household (family OOP max).
//
// With members = 1 this reduces to the lone-claimant case in both directions, which is why
// finHealthPlanEffectiveLoneClaimantTermsCents stays consistent with it.
function finComputeFamilyOOPCents(opt, rate, spendCents, members) {
  if (!opt) return null;
  var n = Math.max(1, Math.floor(Number(members) || 1));
  if (!opt.embedded) return finComputePlanOOPCents(opt.deductibleFamilyCents, opt.oopMaxFamilyCents, rate, spendCents);
  var perMemberSpend = spendCents / n;
  // Deductible dollars actually collected: each member contributes at most their individual
  // deductible, and the family deductible caps the pooled total.
  var perMemberDed = Math.min(perMemberSpend, opt.deductibleIndividualCents);
  var aggregateDed = Math.min(n * perMemberDed, opt.deductibleFamilyCents);
  var coinsurance = Math.max(0, spendCents - aggregateDed) * rate;
  var perMemberCap = n * opt.oopMaxIndividualCents;
  return Math.min(aggregateDed + coinsurance, perMemberCap, opt.oopMaxFamilyCents);
}
// Pure — no DOM — the total family-wide annual medical spend (in cents, assumed spread across 2+
// family members so the FAMILY deductible/OOP-max apply, not a single person's) at which moving
// from fromKey to toKey starts saving more in reduced out-of-pocket costs than the extra premium
// costs (perHouseholdPremiumDiffCents, positive = toKey costs more per household per year). Returns
// null if the plan never breaks even even at a very high spend level (e.g. toKey's premium is
// higher with no compensating deductible/OOP-max improvement at all).
function finComputeHealthPlanFamilyBreakevenCents(fromKey, toKey, perHouseholdPremiumDiffCents) {
  var from = finHealthPlanResolvedOption(fromKey), to = finHealthPlanResolvedOption(toKey);
  if (!from || !to) return null;
  var rate = HEALTH_PLAN_QUOTE_2027.coinsuranceRate;
  var members = (typeof _finHealthFamilySize !== 'undefined' ? _finHealthFamilySize : 2);
  function savings(spendCents) {
    return finComputeFamilyOOPCents(from, rate, spendCents, members)
         - finComputeFamilyOOPCents(to, rate, spendCents, members);
  }
  var maxSpendCents = Math.max(from.oopMaxFamilyCents, to.oopMaxFamilyCents) * 4;
  if (savings(maxSpendCents) < perHouseholdPremiumDiffCents) return null;
  var lo = 0, hi = maxSpendCents;
  for (var i = 0; i < 60; i++) {
    var mid = (lo + hi) / 2;
    if (savings(mid) >= perHouseholdPremiumDiffCents) hi = mid; else lo = mid;
  }
  return Math.round(hi);
}

var _finHealthPlanSelectedOption = 'renewal'; // Stay on Current/Renewal (Healthy Me HSA-C) — per the 2026-07-21 cost/benefit review, Option B's protection mostly targets high-utilization years neither current employee's household has historically approached (neither has hit the $8,000 individual OOP max under the current plan), so the guaranteed $3,296.40/yr premium increase isn't clearly worth it; revisit if a near-term high-cost event is anticipated
function finHealthPremiumChange(optionKey, field, value) {
  if (!_finHealthPlanPremiumOverrides[optionKey]) _finHealthPlanPremiumOverrides[optionKey] = {};
  var cents = value === '' ? null : Math.round(parseFloat(value) * 100);
  if (cents == null || !isFinite(cents)) delete _finHealthPlanPremiumOverrides[optionKey][field];
  else _finHealthPlanPremiumOverrides[optionKey][field] = cents;
  finRerenderPlanningPreserveFocus();
}

// ══ COMPENSATION PLANNER ═══════════════════════════════════════════════════════════════════
// Rebuilt 2026-08 from the "Compensation Planner redesign + Council report" design handoff.
// The old tab was one long scroll of four stacked cards, several hundred words of prose, and
// three growth-scenario columns that showed the identical number whenever the target year had a
// published district base salary. This is five views behind one sub-nav, with every figure that
// arrives on paper once a year entered in exactly one place ("This year's rates"):
//
//   1 · Set pay        what do we pay each worker next year?
//   2 · Check fairness is that fair, against the district scale and Concordia's published ranges?
//   3 · Health plan    which group plan, and who sits on which tier?
//   This year's rates  every annual figure, entered once
//   Council summary    the one-page version for a meeting (+ a printable Council report)
//
// The one deliberate MATH change from the old tab: COLA and Custom now grow the worker's CURRENT
// PAY, not the district base salary. Previously every growth method ran the district formula, so
// for a year with a published base they all collapsed to one number and a COLA was inexpressible.
// The district worksheet is now its own benchmark column ("District Scale"). Every pure function
// the district/Concordia math is built on (finComputeLcmsSalary, finLcmsMultiplierFor,
// finRoundSalaryCents, finComputeEmployerFicaCents, finComputePensionCents, the Concordia rate
// lookups, the health-plan breakeven family) is unchanged — those reconcile against the published
// PDFs in test/finance-salary-calculator.test.js.
var FIN_COMP_VIEWS = [
  { key: 'plan', label: '1 &middot; Set pay' },
  { key: 'fairness', label: '2 &middot; Check fairness' },
  { key: 'health', label: '3 &middot; Health plan' },
  { key: 'rates', label: 'This year&#39;s rates' },
  { key: 'council', label: 'Council summary' }
];
// 'scalepct' sits next to 'worksheet' because it is the same figure at a chosen fraction — the way
// a congregation that cannot reach full district scale in one year sets a deliberate step toward
// it ("we pay 90% of scale") instead of a percentage raise off whatever it happens to pay now.
var FIN_COMP_METHODS = ['none', 'worksheet', 'scalepct', 'cola', 'custom'];
var _finCompView = 'plan';
var _finCompMethod = 'cola';          // roster-wide method; a per-worker entry below overrides it
var _finCompPerWorkerMethod = {};     // roster index -> method key
var _finCompOverrides = {};           // roster index -> hand-typed dollars string (beats any method)
var _finCompCustomPct = 3.5;
var _finCompScalePct = 95;            // 'scalepct' method: this share of the district worksheet
var _finCompBaselineRosterOnly = false; // count only base-year salary accounts this roster is paid from
var _finCompSelected = 0;
var _finCompDrawerOpen = true;
var _finCompRefYear = null;           // which year the rates view is editing; null = the target year
var _finCompToast = '';
// Whole-dollar money, the way every figure in this planner is presented (finFmtMoney's two
// decimals are right for an accounting report and wrong for a salary you can say out loud).
function finCompMoney(cents) {
  return '$' + Math.round((Number(cents) || 0) / 100).toLocaleString('en-US');
}
// A monthly premium is quoted and typed to the cent, so it is shown that way — rounding it to
// whole dollars in a basis line invites someone to check it against the packet and find it wrong.
function finCompMoneyCents(cents) {
  var n = (Number(cents) || 0) / 100;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function finCompMoneySigned(cents) {
  var r = Math.round((Number(cents) || 0) / 100);
  return (r >= 0 ? '+' : '&minus;') + '$' + Math.abs(r).toLocaleString('en-US');
}
function finCompPctFmt(fraction, places) {
  return ((Number(fraction) || 0) * 100).toFixed(places == null ? 2 : places) + '%';
}
function finCompIsAdmin() { return _userRole === 'admin'; }
// Disables every input in a chunk of markup for a non-admin. Same pattern the old tab used: the
// figures stay visible to anyone who can reach the Compensation tab, only editing is gated (the
// save endpoint is admin-gated server-side either way).
function finCompReadOnly(html) {
  if (finCompIsAdmin()) return html;
  return html.replace(/<input /g, '<input disabled ').replace(/<select /g, '<select disabled ');
}

// ── Reference figures (§5.7): entered-for-the-year, else the most recent earlier entered year,
// else the code constant. Never silently substitutes — every resolution carries the year it came
// from so the UI can say "carrying $51,529 forward from FY2027".
function finCompEnteredRef(field, year) {
  var ref = _finSalaryReferenceByYear || {};
  if (ref[year] && ref[year][field] != null) return { value: ref[year][field], sourceYear: Number(year), exact: true };
  var years = Object.keys(ref).map(Number).filter(function(y) { return y <= year && ref[y] && ref[y][field] != null; }).sort(function(a, b) { return a - b; });
  if (!years.length) return null;
  var sy = years[years.length - 1];
  return { value: ref[sy][field], sourceYear: sy, exact: false };
}
function finCompBaseSalary(year) {
  return finLcmsBaseSalaryCents(year, 0, _finSalaryReferenceByYear); // {dollars, exact, sourceYear}
}
function finCompPensionRate(year) {
  var e = finCompEnteredRef('pensionPct', year);
  if (e) return { rate: e.value, sourceYear: e.sourceYear, exact: e.exact };
  return finConcordiaPensionRateFor(year);
}
function finCompDisabilityRate(year, hasDependents) {
  var e = finCompEnteredRef(hasDependents ? 'disabilityDepsPct' : 'disabilityNoDepsPct', year);
  if (e) return { rate: e.value, sourceYear: e.sourceYear, exact: e.exact };
  return finConcordiaDisabilityRateFor(year, hasDependents);
}
function finCompFicaRate(year) {
  var e = finCompEnteredRef('ficaPct', year == null ? _finPlanTargetYear : year);
  return e ? e.value : LCMS_EMPLOYER_FICA_RATE;
}
function finCompSsaRate(year) {
  var e = finCompEnteredRef('ssaColaPct', year == null ? _finPlanTargetYear : year);
  return e ? e.value : SSA_COLA_REFERENCE_PCT;
}
function finCompOptOutCents(year) {
  return finHealthOptOutCentsFor(year == null ? _finPlanTargetYear : year, _finSalaryReferenceByYear);
}
function finCompSourceDoc(kind) {
  var y = _finPlanTargetYear;
  var e = finCompEnteredRef(kind, y);
  if (e && e.value) return e.value;
  if (kind === 'districtSource') return 'LCMS Missouri District Compensation Guidelines';
  if (kind === 'concordiaSource') return 'Overview of your Concordia Plans Participation';
  return 'Concordia Plans quote #0560500326, effective ' + HEALTH_PLAN_QUOTE_2027.effectiveYear;
}

// ── Worker model. The roster rows predate this redesign, so a worker's health tier is derived
// from the old healthEnrolled/hasDependents pair the first time it is read and written back as an
// explicit healthMode from then on (§4.1). Both are kept in sync so nothing that still reads the
// old flags breaks.
function finCompHealthMode(w) {
  if (w.healthMode === 'family' || w.healthMode === 'employee' || w.healthMode === 'optout') return w.healthMode;
  if (w.healthEnrolled === false) return 'optout';
  return w.hasDependents ? 'family' : 'employee';
}
function finCompSetHealthMode(i, mode) {
  var w = _finSalaryRoster[i];
  w.healthMode = mode;
  w.healthEnrolled = (mode !== 'optout');
  finRerenderPlanningPreserveFocus();
}
// A worker's coverage tier — one of the four Concordia prices, or 'optout'. Rosters saved before
// the tier rework only carry the old two-way healthMode, where "employee" meant Self; that is what
// it maps to. Setting a tier keeps healthMode/healthEnrolled in step so nothing still reading the
// older flags breaks.
function finCompHealthTier(w) {
  var t = w && w.healthTier;
  if (t === 'optout') return 'optout';
  for (var i = 0; i < FIN_HEALTH_TIERS.length; i++) if (FIN_HEALTH_TIERS[i].key === t) return t;
  var mode = finCompHealthMode(w);
  return mode === 'family' ? 'family' : mode === 'optout' ? 'optout' : 'self';
}
function finCompHealthTierLabel(key) {
  if (key === 'optout') return 'Opts out (cash)';
  for (var i = 0; i < FIN_HEALTH_TIERS.length; i++) if (FIN_HEALTH_TIERS[i].key === key) return FIN_HEALTH_TIERS[i].label;
  return key;
}
function finCompSetHealthTier(i, tier) {
  var w = _finSalaryRoster[i];
  w.healthTier = tier;
  w.healthMode = tier === 'optout' ? 'optout' : tier === 'family' ? 'family' : 'employee';
  w.healthEnrolled = (tier !== 'optout');
  finRerenderPlanningPreserveFocus();
}
// Live enrollment, counted off the roster — the same thing as the count column on Concordia's own
// Enrollment and Rates block. A cash-only worker is below the hours floor and draws nothing, so
// they are not a contract.
// A worker whose pay is carried by a different budget entirely — the MDO/daycare payroll, say —
// but who is still worth having on the roster so their compensation is planned somewhere. They are
// excluded from EVERY church figure: salary, pension, health, disability, employer FICA, the FY
// total, the health-plan contract count, the district-scale and LCMS-median comparisons, and the
// Council report's totals. Excluding them from only one of those (employer FICA, say) would leave
// the headline number overstated while looking fixed, which is the failure this flag exists to
// prevent.
//
// Deliberately NOT applied to finCompBaselineCents: that reads real FY actuals off the church's
// own payroll accounts. If the worker really is paid from another budget their pay is not in those
// accounts, so nothing needs adjusting; if it turns out to be, the honest fix is the account, not
// a second exclusion rule here. The Council summary names who is excluded so the comparison can be
// read with that in mind.
function finCompIsExternallyFunded(w) {
  return !!(w && w.externallyFunded);
}
// The roster rows that count toward church figures, as [worker, index] pairs so callers can still
// reach the matching computed row.
function finCompCountedEntries() {
  var out = [];
  _finSalaryRoster.forEach(function(w, i) { if (!finCompIsExternallyFunded(w)) out.push({ w: w, i: i }); });
  return out;
}
function finCompCountedCount() { return finCompCountedEntries().length; }
function finCompExternallyFundedWorkers() {
  return _finSalaryRoster.filter(finCompIsExternallyFunded);
}
function finCompEnrollmentCounts(roster) {
  var counts = { self: 0, selfSpouse: 0, selfChild: 0, family: 0 };
  (roster || _finSalaryRoster).forEach(function(w) {
    if (finCompIsCashOnly(w) || finCompIsExternallyFunded(w)) return;
    var t = finCompHealthTier(w);
    if (counts[t] != null) counts[t] += 1;
  });
  return counts;
}
function finCompEnrolledCount(roster) {
  var c = finCompEnrollmentCounts(roster);
  return c.self + c.selfSpouse + c.selfChild + c.family;
}
// What the church pays for ONE enrolled worker: their own tier's monthly rate for twelve months,
// plus an even share of dental and vision — which the packet does not tier-price, so there is no
// per-worker figure to read for those. A hand-entered premium on the worker beats all of it.
// planOption/year default to the target year's selected plan, so every existing caller is
// unchanged; the base-year basis passes the plan that was actually in force then.
function finCompWorkerHealthCents(w, planOption, year) {
  if (finCompIsCashOnly(w)) return 0;
  var key = planOption || _finHealthPlanSelectedOption;
  var tier = finCompHealthTier(w);
  if (tier === 'optout') {
    // A per-worker override is a figure entered for the planning year, so the base year uses the
    // shared opt-out figure recorded for the base year on "This year's rates".
    if (year != null && year !== _finPlanTargetYear) return finCompOptOutCents(year);
    return w.healthOptOutOverrideCents != null ? w.healthOptOutOverrideCents : finCompOptOutCents();
  }
  if (w.employeeOnlyPremiumCents != null) return w.employeeOnlyPremiumCents;
  var opt = HEALTH_PLAN_QUOTE_2027.options[key];
  if (!opt) return 0;
  var rate = finHealthTierMonthlyCents(key, tier) || 0;
  // Their own dental and vision, not a share of a group bill — so this worker's health cost does
  // not move when a colleague joins or leaves the plan.
  var perContract = finHealthAncillaryPerContractCents(key);
  return rate * 12 + perContract.dentalCents + perContract.visionCents;
}
// Full-time equivalent, as a fraction. A 20%-time worker is 0.2. Used to scale the DISTRICT
// BENCHMARK, never the salary itself — the salary is whatever is really budgeted, but comparing
// an 8-hour-a-week wage against a full-time district scale would report every part-timer as
// catastrophically underpaid on the Council report, which is noise rather than information.
function finCompFte(w) {
  var pct = (w && w.ftePct != null) ? Number(w.ftePct) : 100;
  if (!isFinite(pct) || pct <= 0) return 1;
  return Math.min(1, pct / 100);
}
function finCompFtePct(w) {
  return Math.round(finCompFte(w) * 100);
}
function finCompIsPartTime(w) { return finCompFtePct(w) < 100; }
// "Cash salary only" — a very part-time worker who draws no Concordia benefits. Concordia's plans
// have an hours-eligibility floor, so this is a real category, not a preference.
//
// It switches OFF pension, disability and health. It deliberately does NOT switch off employer
// FICA: that is a legal obligation on every W-2 wage regardless of hours, so dropping it would
// understate what the church actually pays. A minister's FICA is already handled by the separate
// SECA toggle, which is a different question (tax status, not hours).
function finCompIsCashOnly(w) { return !!(w && w.cashOnly); }
// A worker's CURRENT pay (§5.4), in priority order: a legacy hand-typed override, then the linked
// account's FULL-YEAR BUDGETED total (not YTD Actual, which understates a year in progress), then
// nothing. This is what "No raise" reports and what COLA/Custom grow from.
function finCompCurrentPayCents(w) {
  if (w.actualSalaryCents != null) return w.actualSalaryCents;
  var acct = finAccountBudgetCentsForCode(w.accountCode);
  return acct != null ? acct : 0;
}
function finCompScaleMultiplier(w) {
  var track;
  if (w.role === 'pastor') track = { multipliers: LCMS_PASTOR_MULTIPLIERS, growBeyond: 0.02 };
  else if (w.role === 'commissioned') track = LCMS_COMMISSIONED_TRACKS[w.trackKey];
  else track = LCMS_OTHER_WORKER_TRACKS[w.trackKey];
  if (!track) return 0;
  return finLcmsMultiplierFor(track, w.yearsExperience);
}
function finCompMultiplier(w) {
  var total = finCompScaleMultiplier(w) + (Number(w.responsibilityStipend) || 0) + (Number(w.attendanceBonus) || 0);
  return Math.round(total * 1000) / 1000;
}
// "District Scale" — the District Compensation Worksheet figure for the TARGET year, always,
// regardless of which method is active. A benchmark, not a choice.
function finCompWorksheetCents(w) {
  var calc = finComputeLcmsSalary({
    year: _finPlanTargetYear, role: w.role, trackKey: w.trackKey, yearsExperience: w.yearsExperience,
    responsibilityStipend: w.responsibilityStipend, attendanceBonus: w.attendanceBonus,
    colaPct: 0, referenceByYear: _finSalaryReferenceByYear
  });
  if (!calc) return null;
  // Pro-rated to the worker's FTE, so "vs. district scale" answers "are we paying this person
  // fairly for the time they actually work" rather than comparing a part-timer to a full-time job.
  return finRoundSalaryCents(Math.round(calc.salaryCents * finCompFte(w)));
}
// The four methods (§5.4). Only a PROPOSED salary is paycheck-rounded — "No raise" is a real
// budgeted figure and is reported exactly (rounding it once reported $74,516 as $74,490).
function finCompMethodSalaryCents(w, key) {
  if (key === 'none') return finCompCurrentPayCents(w);
  if (key === 'worksheet') return finCompWorksheetCents(w);
  if (key === 'scalepct') {
    // Null, not zero, when this worker has no district figure — the same "—" the District Scale
    // column shows. A share of a scale that does not exist is not $0, it is unanswerable.
    var scale = finCompWorksheetCents(w);
    if (!scale) return null;
    return finRoundSalaryCents(Math.round(scale * (Number(_finCompScalePct) || 0) / 100));
  }
  var rate = key === 'cola' ? finCompSsaRate() : (Number(_finCompCustomPct) || 0) / 100;
  return finRoundSalaryCents(Math.round(finCompCurrentPayCents(w) * (1 + rate)));
}
function finCompMethodLabel(key) {
  if (key === 'none') return 'No raise';
  if (key === 'worksheet') return 'District Scale';
  if (key === 'scalepct') return (Number(_finCompScalePct) || 0).toFixed(0) + '% of Scale';
  if (key === 'cola') return 'COLA ' + (finCompSsaRate() * 100).toFixed(1) + '%';
  return 'Custom ' + (Number(_finCompCustomPct) || 0).toFixed(1) + '%';
}
function finCompMethodLongLabel(key) {
  if (key === 'none') return 'no raise';
  if (key === 'worksheet') return 'the District Compensation Worksheet';
  if (key === 'scalepct') return (Number(_finCompScalePct) || 0).toFixed(0) + '% of the District Compensation Worksheet';
  if (key === 'cola') return 'the Social Security COLA';
  return 'a custom ' + (Number(_finCompCustomPct) || 0).toFixed(1) + '%';
}
function finCompMethodFor(i) { return _finCompPerWorkerMethod[i] || _finCompMethod; }
function finCompOverrideCents(i) {
  var ov = _finCompOverrides[i];
  if (ov == null || ov === '') return null;
  var n = parseFloat(String(ov).replace(/[^0-9.]/g, ''));
  return isFinite(n) ? Math.round(n * 100) : null;
}
function finCompSalaryCents(w, i) {
  var ov = finCompOverrideCents(i);
  if (ov != null) return ov;
  return finCompMethodSalaryCents(w, finCompMethodFor(i));
}
function finCompOverrideCount() {
  return Object.keys(_finCompOverrides).filter(function(k) { return _finCompOverrides[k] !== '' && _finCompOverrides[k] != null; }).length;
}
// What the church pays for one worker (§5.5). Pension and disability apply to every salaried
// worker regardless of FICA status; a minister's employer FICA is $0 and the employer half they
// cover themselves is carried separately for display only — never added to a total.
// opts = { year, planOption } — omitted, this is the target year on the selected plan, which is
// every existing caller. The base-year basis passes the base year and the plan in force then, so
// the same model produces both sides of the comparison.
function finCompBenefits(w, salaryCents, opts) {
  var year = (opts && opts.year != null) ? opts.year : _finPlanTargetYear;
  var planOption = (opts && opts.planOption) || _finHealthPlanSelectedOption;
  var pensionRate = finCompPensionRate(year).rate;
  var disRate = finCompDisabilityRate(year, !!w.hasDependents).rate;
  var ficaRate = finCompFicaRate(year);
  var cashOnly = finCompIsCashOnly(w);
  var healthCents = finCompWorkerHealthCents(w, planOption, year);
  var pensionCents = cashOnly ? 0 : Math.round(salaryCents * pensionRate);
  var disabilityCents = cashOnly ? 0 : Math.round(salaryCents * disRate);
  // Employer FICA is owed on any W-2 wage however few the hours, so it survives cash-only. Only
  // the SECA toggle (a minister's tax status) removes it.
  var ficaCents = w.selfEmployedFica ? 0 : Math.round(salaryCents * ficaRate);
  return {
    pensionCents: pensionCents, disabilityCents: disabilityCents, healthCents: healthCents,
    ficaCents: ficaCents, secaSelfCents: Math.round(salaryCents * ficaRate), cashOnly: cashOnly,
    totalCents: pensionCents + disabilityCents + healthCents + ficaCents
  };
}
function finCompComputeAll() {
  return _finSalaryRoster.map(function(w, i) {
    var salaryCents = finCompSalaryCents(w, i);
    var b = finCompBenefits(w, salaryCents);
    return {
      salaryCents: salaryCents, benefits: b, churchCostCents: salaryCents + b.totalCents,
      worksheetCents: finCompWorksheetCents(w), currentCents: finCompCurrentPayCents(w),
      overridden: finCompOverrideCents(i) != null, methodKey: finCompMethodFor(i)
    };
  });
}
// The FY base year's own compensation cost, for the "vs FY{base}" comparison (§5.10).
//
// ⚠ Two things this has to get right, and both were wrong — together they reported a +34% jump
// under "No raise", which is the shape of the bug: no raise cannot cost a third more.
//
// (1) SAME COST CATEGORIES ON BOTH SIDES. The FY{target} total is salary + pension + disability +
//     health + employer FICA. The match here found only salary and health accounts, so pension and
//     payroll taxes were counted in the plan and never looked for in the base year — the plan was
//     answering a broader question than the figure it was subtracted from.
// (2) A FULL YEAR ON BOTH SIDES. totalActualCents for a base year still in progress is
//     year-to-date, and the plan is a whole year. So each account resolves to its own full-year
//     BUDGET when it has one, and otherwise to its actual annualized the way the Planning tab
//     annualizes (52 / weeks elapsed) — the same rule, so the two pages cannot disagree.
//
// Deliberately NOT a bare /insurance|benefit/: "52040 Insurance" is property cover and doubled
// this figure. Deliberately not /concordia/ either — "Concordia Children's Services" is
// benevolence, not staff cost.
var FIN_COMP_BASELINE_RE = /salar|payroll|compensation|wages|health|medical|dental|vision|disabilit|pension|retirement|\bfica\b|social security/i;
// Of those, the ones charged for the whole staff on a single line. Order matters against the line
// above: "59040 Payroll Taxes" matches /payroll/ there and must still be read as a pooled tax, not
// as somebody's wages — hence /tax/ here.
var FIN_COMP_POOLED_RE = /health|medical|dental|vision|disabilit|pension|retirement|\bfica\b|social security|tax/i;
function finCompBaselineDetail() {
  var empty = { cents: 0, rows: [], prorated: false, weeks: 52 };
  if (!_finPlanBaseTree) return empty;
  var leaves = [];
  (function walk(nodes) {
    (nodes || []).forEach(function(n) {
      if (!n.children.length && !FIN_REVENUE_CLASSES[n.classification]) leaves.push(n);
      walk(n.children);
    });
  })(_finPlanBaseTree);
  var now = new Date();
  var weeks = (_finPlanBaseYear === now.getFullYear()) ? finWeeksElapsedInYear(now) : 52;
  var prorated = weeks < 52;
  // Who on the counted roster is paid from each account code. This is what makes the comparison
  // like-for-like: the FY{target} total covers exactly the counted roster, so a base-year SALARY
  // account that no rostered worker is paid from is a different population's wages — a departed
  // worker, a vacant post, or someone deliberately excluded as paid from another budget. Left in,
  // it makes the base year look bigger than the plan and a raise read as a saving.
  var rosterByCode = {};
  finCompCountedEntries().forEach(function(e) {
    var code = String(e.w.accountCode || '').trim();
    if (!code) return;
    (rosterByCode[code] = rosterByCode[code] || []).push(e.w.name || '(unnamed)');
  });
  var rows = leaves.filter(function(n) { return FIN_COMP_BASELINE_RE.test(n.label || ''); }).map(function(n) {
    var label = n.label || '';
    var actual = n.totalActualCents || 0;
    var codeMatch = String(label).match(/^\s*(\d{3,8})/);
    var code = codeMatch ? codeMatch[1] : '';
    var row = {
      label: label, code: code,
      // A pooled cost (pension, health, employer taxes) is charged for the whole staff on one
      // line and cannot be split per person, so it is never attributed to a roster worker.
      kind: FIN_COMP_POOLED_RE.test(label) ? 'benefit' : 'salary',
      rosterNames: rosterByCode[code] || []
    };
    if (n.hasBudgetInfo && n.totalBudgetCents) { row.cents = n.totalBudgetCents; row.basis = 'budget'; }
    else if (actual && prorated) { row.cents = Math.round(actual * (52 / weeks)); row.basis = 'annualized'; }
    else { row.cents = actual; row.basis = 'actual'; }
    return row;
  }).filter(function(r) { return r.cents; });
  rows.sort(function(a, b) { return b.cents - a.cents; });
  var unmatched = rows.filter(function(r) { return r.kind === 'salary' && !r.rosterNames.length; });
  // The restriction is only offered when at least one salary account IS attributed. With an
  // unlinked roster nothing would match, and applying it would silently delete the whole salary
  // side of the base year — a worse number than the one it set out to fix.
  var canRosterOnly = unmatched.length > 0 && rows.some(function(r) { return r.kind === 'salary' && r.rosterNames.length; });
  var rosterOnly = canRosterOnly && !!_finCompBaselineRosterOnly;
  var counted = rosterOnly ? rows.filter(function(r) { return !(r.kind === 'salary' && !r.rosterNames.length); }) : rows;
  return {
    cents: counted.reduce(function(s, r) { return s + r.cents; }, 0),
    rows: rows, countedRows: counted, unmatchedRows: unmatched,
    unmatchedCents: unmatched.reduce(function(s, r) { return s + r.cents; }, 0),
    canRosterOnly: canRosterOnly, rosterOnly: rosterOnly, prorated: prorated, weeks: weeks,
    // Whether anything was ACTUALLY annualized, as opposed to the base year merely being in
    // progress. An account with its own full-year budget is used as-is, so a ledger with budgets
    // throughout annualizes nothing and must not be labelled as though it had.
    anyAnnualized: counted.some(function(r) { return r.basis === 'annualized'; }),
    salaryCents: counted.reduce(function(t, r) { return t + (r.kind === 'salary' ? r.cents : 0); }, 0),
    benefitCents: counted.reduce(function(t, r) { return t + (r.kind === 'benefit' ? r.cents : 0); }, 0)
  };
}
// ── The base year computed from the ROSTER, not read from the ledger ──────────────────────────
//
// The ledger basis compares two different POPULATIONS. FY{target} is what the counted roster costs;
// the ledger figure is every dollar in any account named like payroll or health, which at this
// church also carries daycare/MDO staff, supply preachers and nursery wages. Measured against the
// same seven people the church's own 2026 figures give $428,844 while the ledger gives $468,834 —
// a $40k gap that is entirely population, not arithmetic. And it cannot be corrected account by
// account: pooled benefit accounts (health, pension, employer taxes) are charged for the whole
// staff on one line and can never be attributed to a person.
//
// So this basis runs the SAME model over the SAME roster with the base year's own rates and the
// health plan in force then. "No raise" therefore lands at exactly 0% by construction, and any
// movement left is a real change — the pension going 10.70% to 11.70%, the premium renewal —
// which is the number a council actually needs.
//
// Assumptions it makes, all stated on screen: each worker's coverage tier and minister status were
// the same in the base year, and their base-year pay is whatever "current pay" resolves to (their
// linked account's budget, or a typed figure).
var _finCompBaseYearBasis = 'roster';   // 'roster' | 'ledger'
var _finCompBasePlanOption = 'current'; // the health plan in force in the base year
function finCompRosterBaselineDetail() {
  var rows = finCompCountedEntries().map(function(e) {
    var w = e.w;
    var salaryCents = finCompCurrentPayCents(w);
    var b = finCompBenefits(w, salaryCents, { year: _finPlanBaseYear, planOption: _finCompBasePlanOption });
    return { name: w.name || '(unnamed)', salaryCents: salaryCents, benefits: b, cents: salaryCents + b.totalCents };
  });
  var salaryCents = rows.reduce(function(t, r) { return t + r.salaryCents; }, 0);
  var benefitCents = rows.reduce(function(t, r) { return t + r.benefits.totalCents; }, 0);
  return {
    basis: 'roster', rows: rows, salaryCents: salaryCents, benefitCents: benefitCents,
    cents: salaryCents + benefitCents,
    pensionCents: rows.reduce(function(t, r) { return t + r.benefits.pensionCents; }, 0),
    healthCents: rows.reduce(function(t, r) { return t + r.benefits.healthCents; }, 0),
    disabilityCents: rows.reduce(function(t, r) { return t + r.benefits.disabilityCents; }, 0),
    ficaCents: rows.reduce(function(t, r) { return t + r.benefits.ficaCents; }, 0),
    planOption: _finCompBasePlanOption
  };
}
// Whichever basis is active. The other one stays available so the note can show both.
function finCompActiveBaseline() {
  return _finCompBaseYearBasis === 'ledger' ? finCompBaselineDetail() : finCompRosterBaselineDetail();
}
function finCompBaselineCents() { return finCompActiveBaseline().cents; }
function finCompTotals(computed) {
  // Externally funded workers are carried by another budget — see finCompIsExternallyFunded — so
  // every figure below is over the counted roster only.
  var counted = finCompCountedEntries().map(function(e) { return computed[e.i]; });
  var salaryCents = counted.reduce(function(s, c) { return s + c.salaryCents; }, 0);
  var benefitsCents = counted.reduce(function(s, c) { return s + c.benefits.totalCents; }, 0);
  var baseline = finCompActiveBaseline();
  var totalCents = salaryCents + benefitsCents;
  return {
    salaryCents: salaryCents, benefitsCents: benefitsCents, totalCents: totalCents,
    baseline: baseline, baselineCents: baseline.cents, deltaCents: totalCents - baseline.cents,
    currentCents: counted.reduce(function(s, c) { return s + c.currentCents; }, 0),
    worksheetCents: counted.reduce(function(s, c) { return s + (c.worksheetCents || 0); }, 0),
    healthCents: counted.reduce(function(s, c) { return s + c.benefits.healthCents; }, 0)
  };
}

// ── Concordia Plans ranges (§4.4, §5.8). Stored on the roster row as w.concordia, keyed
// churchMarketLow/Mid/High etc. — a range only COUNTS once it has a real lower and higher figure,
// so a half-typed row can never skew a chart or a verdict.
function finCompUsableRanges(w) {
  var c = w.concordia || {};
  return FIN_CONCORDIA_RANGE_KEYS.map(function(r) {
    return {
      key: r.key, label: r.label,
      lowCents: finConcordiaParseMoneyCents(c[r.key + 'Low']),
      midCents: finConcordiaParseMoneyCents(c[r.key + 'Mid']),
      highCents: finConcordiaParseMoneyCents(c[r.key + 'High'])
    };
  }).filter(function(r) { return r.lowCents > 0 && r.highCents > r.lowCents; });
}
function finCompLcmsRange(w) {
  var u = finCompUsableRanges(w);
  return u.filter(function(r) { return /LCMS/i.test(r.label); })[0] || u[0] || null;
}
function finCompRatioColor(ratio) {
  return ratio >= 0.995 ? 'var(--sage-text)' : ratio >= 0.95 ? 'var(--deep-amber)' : 'var(--danger)';
}
function finCompVsScale(salaryCents, worksheetCents) {
  if (!worksheetCents) return { text: '&mdash;', color: 'var(--warm-gray)' };
  var diff = salaryCents - worksheetCents;
  return {
    text: Math.abs(diff) < 50000 ? 'at scale' : finCompMoneySigned(diff) + ' (' + Math.round(salaryCents / worksheetCents * 100) + '% of scale)',
    color: finCompRatioColor(salaryCents / worksheetCents)
  };
}
function finCompVsMedian(salaryCents, midCents) {
  if (!midCents) return { text: 'no report', color: 'var(--warm-gray)' };
  var diff = salaryCents - midCents;
  return {
    text: Math.abs(diff) < 50000 ? 'at median' : finCompMoneySigned(diff) + ' (' + Math.round(salaryCents / midCents * 100) + '% of median)',
    color: finCompRatioColor(salaryCents / midCents)
  };
}
// Verdict chips (§5.8), in priority order.
function finCompVerdict(w, salaryCents) {
  var usable = finCompUsableRanges(w);
  var lcms = finCompLcmsRange(w);
  if (!lcms) return { text: 'No published range', bg: 'var(--linen)', color: 'var(--warm-meta)', matchLabel: '', midCents: null };
  var midCents = lcms.midCents || lcms.lowCents;
  var belowAll = usable.every(function(r) { return salaryCents < r.lowCents; });
  var vsMid = salaryCents - midCents;
  var out = { matchLabel: 'Set to LCMS midpoint (' + finCompMoney(midCents) + ')', midCents: midCents };
  if (belowAll) { out.text = 'Below every published range'; out.bg = 'var(--chip-negative-bg)'; out.color = 'var(--danger)'; }
  else if (salaryCents < lcms.lowCents) { out.text = 'Below the LCMS range'; out.bg = 'var(--chip-negative-bg)'; out.color = 'var(--danger)'; }
  else if (Math.abs(vsMid) / midCents < 0.03) { out.text = 'At the LCMS midpoint'; out.bg = 'var(--pale-sage)'; out.color = 'var(--sage-text)'; }
  else if (vsMid > 0) { out.text = finCompMoneySigned(vsMid) + ' above the LCMS midpoint'; out.bg = 'var(--pale-sage)'; out.color = 'var(--sage-text)'; }
  else { out.text = finCompMoneySigned(vsMid) + ' vs the LCMS midpoint'; out.bg = 'var(--warm-surface-header)'; out.color = 'var(--deep-amber)'; }
  return out;
}
// The LCMS-median total covers ONLY the workers who have a report, and says how many — otherwise
// a missing report silently reads as being under median (§5.8).
function finCompMedianTotal(computed) {
  var med = 0, pay = 0, n = 0;
  finCompCountedEntries().forEach(function(e) {
    var w = e.w, i = e.i;
    var l = finCompLcmsRange(w);
    if (l && l.midCents) { med += l.midCents; pay += computed[i].salaryCents; n++; }
  });
  if (!med) return { text: '&mdash;', color: 'var(--warm-gray)', count: 0, medCents: 0 };
  return {
    text: finCompMoneySigned(pay - med) + ' (' + Math.round(pay / med * 100) + '% of median, ' + n + ' with report' + (n === 1 ? '' : 's') + ')',
    color: finCompRatioColor(pay / med), count: n, medCents: med
  };
}
// Cost to bring every below-scale worker up to the district worksheet figure (§5.11). Health
// premiums do not move with salary, so they are excluded.
function finCompFullScaleGap(computed) {
  var salaryGapCents = 0, benefitsGapCents = 0;
  finCompCountedEntries().forEach(function(e) {
    var w = e.w, c = computed[e.i];
    var gap = Math.max(0, (c.worksheetCents || 0) - c.salaryCents);
    if (!gap) return;
    // A cash-only worker draws no pension or disability, so raising their salary adds neither —
    // only the employer FICA that follows any wage.
    var cashOnly = finCompIsCashOnly(w);
    var pensionRate = cashOnly ? 0 : finCompPensionRate(_finPlanTargetYear).rate;
    var disRate = cashOnly ? 0 : finCompDisabilityRate(_finPlanTargetYear, !!w.hasDependents).rate;
    salaryGapCents += gap;
    benefitsGapCents += Math.round(gap * (pensionRate + disRate + (w.selfEmployedFica ? 0 : finCompFicaRate())));
  });
  return { salaryGapCents: salaryGapCents, benefitsGapCents: benefitsGapCents, totalCents: salaryGapCents + benefitsGapCents };
}
// Div-based range bars (§5.9) — one shared dollar scale per worker so every bar and marker line
// up. Positioned divs inside a track, not SVG: they reflow without recomputation and print.
function finCompBarScale(valuesCents, padFraction) {
  var lo = Math.min.apply(null, valuesCents), hi = Math.max.apply(null, valuesCents);
  var pad = (hi - lo) * (padFraction || 0.08) || 1;
  var min = lo - pad, max = hi + pad;
  return function(v) { return ((v - min) / (max - min) * 100).toFixed(2) + '%'; };
}

// ── Budget-line options. A worker links to one expense leaf of the church budget tree by its
// leading account code; that account's full-year Budget line is their current pay.
function finCompAccountOptions(selectedCode) {
  var leaves = [];
  (function walk(nodes) { (nodes || []).forEach(function(n) { if (!n.children.length && n.classification !== 'Income') leaves.push(n); walk(n.children); }); })(_finPlanBaseTree);
  var seen = {}, opts = [{ code: '', label: 'Not linked to a budget line' }];
  leaves.forEach(function(n) {
    var m = String(n.label).match(/^\s*(\d{3,8})/);
    if (!m || seen[m[1]]) return;
    seen[m[1]] = true;
    opts.push({ code: m[1], label: n.label });
  });
  if (selectedCode && !seen[selectedCode]) opts.push({ code: selectedCode, label: selectedCode + ' (not in this year&#39;s budget)' });
  return opts;
}
function finCompExpenseLeaves() {
  var leaves = [];
  (function walk(nodes) { (nodes || []).forEach(function(n) { if (!n.children.length && n.classification !== 'Income') leaves.push(n); walk(n.children); }); })(_finPlanBaseTree);
  return leaves;
}

// ── Shell ──────────────────────────────────────────────────────────────────────────────────
function finCompMethodSummary() {
  var base = finCompBaseSalary(_finPlanTargetYear);
  var plan = finComputeHealthPlanTotalCents(_finHealthPlanSelectedOption);
  return 'Salaries by ' + finCompMethodLongLabel(_finCompMethod)
    + ' &middot; district base $' + finFmtMoney(base.dollars)
    + ' &middot; pension ' + finCompPctFmt(finCompPensionRate(_finPlanTargetYear).rate)
    + ' &middot; ' + esc(plan ? plan.label : 'no plan selected')
    + ' &middot; ' + finCompCountedCount() + ' worker' + (finCompCountedCount() === 1 ? '' : 's')
    + (finCompExternallyFundedWorkers().length ? ' &middot; ' + finCompExternallyFundedWorkers().length + ' paid from another budget' : '');
}
function finRenderCompensation() {
  var el = document.getElementById('fin-comp-root');
  if (!el) return;
  var yearLabelEl = document.getElementById('fin-comp-year-label');
  if (yearLabelEl) yearLabelEl.textContent = _finPlanTargetYear;
  if (!_finSalaryRoster.length) {
    el.innerHTML = finCompHeaderHtml(finCompTotals([]))
      + '<div class="fin-card" style="margin-top:14px;"><div class="fin-card-title">No staff on the roster yet</div>'
      + '<p class="fin-card-sub">Add the church&#39;s called and employed workers to start planning FY' + _finPlanTargetYear + ' compensation.</p>'
      + (finCompIsAdmin() ? '<button class="btn-primary" onclick="finCompAddWorker()">+ Add a staff member</button>' : '')
      + '</div>';
    return;
  }
  if (_finCompSelected >= _finSalaryRoster.length) _finCompSelected = _finSalaryRoster.length - 1;
  var computed = finCompComputeAll();
  var totals = finCompTotals(computed);
  var body = _finCompView === 'plan' ? finCompRenderPlan(computed, totals)
    : _finCompView === 'fairness' ? finCompRenderFairness(computed)
    : _finCompView === 'health' ? finCompRenderHealth(computed, totals)
    : _finCompView === 'rates' ? finCompRenderRates()
    : finCompRenderCouncil(computed, totals);
  el.innerHTML = finCompHeaderHtml(totals) + body + '<div id="fin-comp-print-root" class="fin-comp-print-root"></div>';
}
function finCompHeaderHtml(totals) {
  var pct = totals.baselineCents ? (totals.deltaCents / totals.baselineCents * 100) : null;
  var pills = FIN_COMP_VIEWS.map(function(v) {
    var active = _finCompView === v.key;
    return '<span class="fin-comp-pill' + (active ? ' active' : '') + '" onclick="finCompSetView(' + jsAttr(v.key) + ')">' + v.label + '</span>';
  }).join('');
  return '<div class="fin-comp-shell">'
    + '<div class="fin-comp-titlebar">'
    + '<div><div class="fin-comp-title">Compensation Planner &mdash; FY' + _finPlanTargetYear + '</div>'
    + '<div class="fin-comp-subtitle">' + finCompMethodSummary() + '</div></div>'
    + '<div class="fin-comp-actions">'
    + '<button class="btn-secondary" onclick="finCompPrintCouncil()">Print for Council</button>'
    + (finCompIsAdmin() ? '<button class="btn-primary" onclick="finCompSendToBudget()">Send to FY' + _finPlanTargetYear + ' budget</button>' : '')
    + '</div></div>'
    + '<div class="fin-comp-strip">'
    + '<div><div class="fin-comp-strip-lbl">Cash salaries</div><div class="fin-comp-strip-val">' + finCompMoney(totals.salaryCents) + '</div></div>'
    + '<div><div class="fin-comp-strip-lbl">Benefits &amp; taxes</div><div class="fin-comp-strip-val">' + finCompMoney(totals.benefitsCents) + '</div></div>'
    + '<div><div class="fin-comp-strip-lbl">FY' + _finPlanTargetYear + ' total</div><div class="fin-comp-strip-val">' + finCompMoney(totals.totalCents) + '</div></div>'
    + '<div class="fin-comp-strip-delta"><div class="fin-comp-strip-lbl">vs FY' + _finPlanBaseYear + ' ' + finCompMoney(totals.baselineCents)
    + (totals.baseline && totals.baseline.anyAnnualized ? ' (annualized)' : '') + '</div>'
    + '<div class="fin-comp-strip-val gold">' + (totals.baselineCents ? finCompMoneySigned(totals.deltaCents) + ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%)' : '&mdash;') + '</div></div>'
    + '</div>'
    + '<div class="fin-comp-pills">' + pills + '</div>'
    + (_finCompToast ? '<div class="fin-comp-toast"><span>' + esc(_finCompToast) + '</span><span onclick="finCompDismissToast()" style="cursor:pointer;opacity:.7;">&times;</span></div>' : '')
    + '</div>';
}
function finCompSetView(view) { _finCompView = view; finRenderCompensation(); }
function finCompDismissToast() { _finCompToast = ''; finRenderCompensation(); }
function finCompSay(msg) { _finCompToast = msg; }

// ── View 1 — Set pay ───────────────────────────────────────────────────────────────────────
function finCompRenderPlan(computed, totals) {
  var chips = FIN_COMP_METHODS.map(function(k) {
    return '<span class="fin-comp-chip' + (_finCompMethod === k ? ' active' : '') + '" onclick="finCompApplyMethodToAll(' + jsAttr(k) + ')">' + esc(finCompMethodLabel(k)) + '</span>';
  }).join('');
  var heads = FIN_COMP_METHODS.map(function(k) {
    var active = _finCompMethod === k;
    return '<th class="fin-comp-th num' + (active ? ' active' : '') + '" onclick="finCompApplyMethodToAll(' + jsAttr(k) + ')" title="Apply to everyone">' + esc(finCompMethodLabel(k)) + '</th>';
  }).join('');
  var rows = _finSalaryRoster.map(function(w, i) {
    var c = computed[i];
    var activeKey = c.methodKey;
    var cells = FIN_COMP_METHODS.map(function(k) {
      var v = finCompMethodSalaryCents(w, k);
      var isActive = !c.overridden && activeKey === k;
      var isEdited = c.overridden && activeKey === k;
      var cls = 'fin-comp-td num' + (isActive ? ' active' : '') + (isEdited ? ' edited' : '');
      return '<td class="' + cls + '" onclick="finCompPickMethod(' + i + ',' + jsAttr(k) + ')">'
        + (v == null ? '&mdash;' : (isEdited ? finCompMoney(c.salaryCents) + ' &#9998;' : finCompMoney(v))) + '</td>';
    }).join('');
    var vs = finCompVsScale(c.salaryCents, c.worksheetCents);
    var selected = (i === _finCompSelected && _finCompDrawerOpen);
    return '<tr class="fin-comp-row' + (selected ? ' selected' : '') + '">'
      + '<td class="fin-comp-td" style="cursor:pointer;" onclick="finCompSelectWorker(' + i + ')">'
      + '<div style="font-weight:700;color:var(--color-navy);">' + esc(w.name || '(unnamed)') + '</div>'
      + '<div style="font-size:.72rem;color:var(--warm-gray);">' + esc(w.position || 'Role not set') + ' &middot; acct ' + esc(w.accountCode || '&mdash;')
      + (finCompIsPartTime(w) ? ' &middot; <span style="color:var(--deep-amber);font-weight:700;">' + finCompFtePct(w) + '% time</span>' : '')
      + (finCompIsCashOnly(w) ? ' &middot; <span style="color:var(--warm-meta);">cash only</span>' : '')
      + (finCompIsExternallyFunded(w) ? ' &middot; <span style="color:var(--deep-amber);font-weight:700;">paid from another budget</span>' : '') + '</div></td>'
      + cells
      + '<td class="fin-comp-td" style="font-size:.76rem;font-weight:600;color:' + vs.color + ';" title="District scale ' + (c.worksheetCents ? finCompMoney(c.worksheetCents) : 'not available') + (finCompIsPartTime(w) ? ' (pro-rated to ' + finCompFtePct(w) + '% time)' : '') + '">' + vs.text + (finCompIsPartTime(w) ? '<br><span style="font-weight:400;color:var(--warm-gray);">at ' + finCompFtePct(w) + '% time</span>' : '') + '</td>'
      + '<td class="fin-comp-td num" style="font-weight:700;">' + finCompMoney(c.churchCostCents) + '</td>'
      + '</tr>';
  }).join('');
  var methodTotals = FIN_COMP_METHODS.map(function(k) {
    var t = finCompCountedEntries().reduce(function(s, e) { return s + (finCompMethodSalaryCents(e.w, k) || 0); }, 0);
    return '<td class="fin-comp-td num' + (_finCompMethod === k ? ' active' : '') + '">' + finCompMoney(t) + '</td>';
  }).join('');
  var scaleTotal = finCompVsScale(totals.salaryCents, totals.worksheetCents);
  var base = finCompBaseSalary(_finPlanTargetYear);
  var table = '<div style="overflow-x:auto;"><table class="fin-comp-table" style="min-width:760px;">'
    + '<thead><tr><th class="fin-comp-th">Worker</th>' + heads
    + '<th class="fin-comp-th">Vs. district scale</th><th class="fin-comp-th num">Total comp.</th></tr></thead>'
    + '<tbody>' + rows
    + (finCompIsAdmin() ? '<tr><td colspan="' + (FIN_COMP_METHODS.length + 3) + '" style="padding:9px 6px;"><span class="fin-comp-add" onclick="finCompAddWorker()"><span class="fin-comp-add-plus">+</span> Add a staff member</span></td></tr>' : '')
    + '<tr class="fin-comp-total-row"><td class="fin-comp-td">Total</td>' + methodTotals
    + '<td class="fin-comp-td" style="font-size:.76rem;font-weight:600;color:' + scaleTotal.color + ';" title="District scale ' + finCompMoney(totals.worksheetCents) + '">' + scaleTotal.text + '</td>'
    + '<td class="fin-comp-td num">' + finCompMoney(totals.totalCents) + '</td></tr>'
    + '</tbody></table></div>';
  var customBox = '<label style="display:inline-flex;align-items:center;gap:5px;font-size:.74rem;color:var(--warm-gray);">custom '
    + '<input type="text" inputmode="decimal" id="fin-comp-custom-pct" value="' + (Number(_finCompCustomPct) || 0) + '" oninput="finCompCustomPctChange(finSanitizeDecimalInput(this))" style="width:52px;text-align:right;">%</label>'
    + '<label style="display:inline-flex;align-items:center;gap:5px;font-size:.74rem;color:var(--warm-gray);">of scale '
    + '<input type="text" inputmode="decimal" id="fin-comp-scale-pct" value="' + (Number(_finCompScalePct) || 0) + '" oninput="finCompScalePctChange(finSanitizeDecimalInput(this))" style="width:52px;text-align:right;">%</label>';
  return '<div class="fin-comp-plan-grid' + (_finCompDrawerOpen ? '' : ' closed') + '">'
    + '<div class="fin-card" style="min-width:0;">'
    + '<div class="fin-comp-chiprow">'
    + '<span class="fin-comp-chiprow-lbl">Applied to everyone</span>'
    + '<span style="display:flex;gap:6px;flex-wrap:wrap;">' + chips + '</span>'
    + finCompReadOnly(customBox)
    + '<span style="font-size:.74rem;color:var(--warm-gray);">Click a column for everyone, a cell for one person, or type an exact figure in the panel.</span>'
    + (finCompOverrideCount() ? '<span class="fin-comp-link" onclick="finCompClearOverrides()">&#8634; clear ' + finCompOverrideCount() + ' hand-set figure(s)</span>' : '')
    + '</div>'
    + table
    + finCompRenderBaselineNote(totals)
    + '<div class="fin-comp-cardfoot">'
    + '<span style="font-size:.74rem;color:var(--warm-gray);">District Scale = the District Compensation Worksheet &mdash; base $' + finFmtMoney(base.dollars) + ' &times; each worker&#39;s role/experience multiplier. <span class="fin-comp-link" onclick="finCompSetView(&quot;rates&quot;)">Rates for this year</span></span>'
    + '<button class="btn-primary" onclick="finCompSetView(&quot;fairness&quot;)">Next: check fairness &rarr;</button>'
    + '</div></div>'
    + (_finCompDrawerOpen ? finCompRenderDrawer(computed) : '')
    + '</div>';
}
// "vs FY{base}" is a comparison between two figures the reader cannot see, so it prints its own
// working: which ledger accounts were counted, on what basis, and what the plan side holds. A
// percentage nobody can check is a percentage nobody should act on — the FIN63 lesson, where a
// card said "no budget is on file" without naming what it had looked for.
//
// ⚠ The single most common reason this comparison misleads is POPULATION, not arithmetic: the
// plan covers exactly the counted roster, while the base year covers whoever the church actually
// paid. A salary account nobody on the roster is paid from is therefore called out by name and
// figure, with a one-click way to leave it out — that is how a no-raise plan came to read as a
// 6% SAVING, which is as wrong as the 34% increase before it and wrong in the other direction.
// Shown whichever basis is active. The roster basis prints its own working — the same model that
// produced FY{target}, run at FY{base} rates — and keeps the ledger figure visible underneath with
// the difference named, so switching basis never hides a number that was there a moment ago.
function finCompRenderRosterBaselineNote(totals) {
  var r = totals.baseline;
  var ledger = finCompBaselineDetail();
  var planLabel = (HEALTH_PLAN_QUOTE_2027.options[r.planOption] || {}).label || r.planOption;
  var salDelta = totals.salaryCents - r.salaryCents;
  var benDelta = totals.benefitsCents - r.benefitCents;
  function row(label, base, plan) {
    var d = plan - base;
    return '<tr><td style="padding:2px 8px 2px 0;">' + label + '</td>'
      + '<td style="padding:2px 8px;text-align:right;">' + finCompMoney(base) + '</td>'
      + '<td style="padding:2px 8px;text-align:right;">' + finCompMoney(plan) + '</td>'
      + '<td style="padding:2px 0 2px 8px;text-align:right;font-weight:700;color:' + (d === 0 ? 'var(--warm-gray)' : 'var(--charcoal)') + ';">' + (d === 0 ? 'no change' : finCompMoneySigned(d)) + '</td></tr>';
  }
  return '<div class="fin-comp-basis">'
    + finCompRenderBasisPicker()
    + '<b>FY' + _finPlanBaseYear + ' is the same ' + finCompCountedCount() + ' worker(s), costed at FY' + _finPlanBaseYear + ' rates.</b> '
    + 'Same model as FY' + _finPlanTargetYear + ' &mdash; each worker&rsquo;s current pay, pension at '
    + finCompPctFmt(finCompPensionRate(_finPlanBaseYear).rate) + ', disability, employer FICA, and the health plan in force then ('
    + esc(planLabel) + '). So &ldquo;No raise&rdquo; lands at nothing changed, and anything left is a real rate or premium move.'
    + '<table style="border-collapse:collapse;font-size:.78rem;margin:8px 0;">'
    + '<thead><tr><th style="text-align:left;padding:2px 8px 2px 0;color:var(--warm-gray);font-weight:600;"></th>'
    + '<th style="text-align:right;padding:2px 8px;color:var(--warm-gray);font-weight:600;">FY' + _finPlanBaseYear + '</th>'
    + '<th style="text-align:right;padding:2px 8px;color:var(--warm-gray);font-weight:600;">FY' + _finPlanTargetYear + '</th>'
    + '<th style="text-align:right;padding:2px 0 2px 8px;color:var(--warm-gray);font-weight:600;">Change</th></tr></thead><tbody>'
    + row('Cash salaries', r.salaryCents, totals.salaryCents)
    + row('Benefits &amp; taxes', r.benefitCents, totals.benefitsCents)
    + '</tbody></table>'
    + '<div style="font-size:.72rem;color:var(--warm-gray);">'
    + (salDelta === 0 ? 'Salaries are unchanged, as expected under this method. ' : '')
    + (benDelta !== 0 ? 'Benefits move ' + finCompMoneySigned(benDelta) + ' on rates alone &mdash; pension ' + finCompPctFmt(finCompPensionRate(_finPlanBaseYear).rate) + ' &rarr; ' + finCompPctFmt(finCompPensionRate(_finPlanTargetYear).rate) + ', plus the premium renewal.' : '')
    + '</div>'
    + '<div style="font-size:.72rem;color:var(--warm-gray);margin-top:8px;border-top:1px solid var(--warm-row-divider);padding-top:6px;">'
    + 'For reference, the FY' + _finPlanBaseYear + ' <b>ledger</b> spent ' + finCompMoney(ledger.cents)
    + ' across every account named like payroll or health &mdash; ' + finCompMoney(Math.abs(ledger.cents - r.cents))
    + (ledger.cents > r.cents ? ' more' : ' less') + ' than these ' + finCompCountedCount() + ' worker(s) cost. '
    + 'That is a different population (daycare and MDO staff, supply preachers, nursery wages sit in the same accounts), which is why it is not what the plan is measured against. '
    + '<span class="fin-comp-link" onclick="finCompSetBaseYearBasis(&quot;ledger&quot;)">Compare against the ledger instead</span></div>'
    + '</div>';
}
function finCompRenderBasisPicker() {
  function pill(key, label) {
    var active = _finCompBaseYearBasis === key;
    return '<span class="fin-comp-pill' + (active ? ' active' : '') + '"' + (active ? '' : ' onclick="finCompSetBaseYearBasis(' + jsAttr(key) + ')"') + '>' + label + '</span>';
  }
  return '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">'
    + '<span style="font-size:.74rem;color:var(--warm-gray);">Compare FY' + _finPlanTargetYear + ' against:</span>'
    + pill('roster', 'the same roster at FY' + _finPlanBaseYear + ' rates')
    + pill('ledger', 'FY' + _finPlanBaseYear + ' ledger accounts')
    + '</div>';
}
function finCompSetBaseYearBasis(key) {
  _finCompBaseYearBasis = (key === 'ledger') ? 'ledger' : 'roster';
  finCompSay(_finCompBaseYearBasis === 'roster'
    ? 'Comparing against the same roster costed at FY' + _finPlanBaseYear + ' rates.'
    : 'Comparing against the FY' + _finPlanBaseYear + ' ledger accounts.');
  finRerenderPlanningPreserveFocus();
}
function finCompSetBasePlanOption(key) {
  _finCompBasePlanOption = key;
  finRerenderPlanningPreserveFocus();
}
function finCompRenderBaselineNote(totals) {
  if (totals.baseline && totals.baseline.basis === 'roster') return finCompRenderRosterBaselineNote(totals);
  var b = totals.baseline || { rows: [], unmatchedRows: [], countedRows: [], prorated: false, weeks: 52 };
  var planParts = 'cash salaries ' + finCompMoney(totals.salaryCents) + ' + benefits &amp; taxes ' + finCompMoney(totals.benefitsCents)
    + ' (pension, disability, health, employer FICA)';
  if (!b.rows.length) {
    return '<div class="fin-comp-basis"><b>vs FY' + _finPlanBaseYear + ':</b> no compensation accounts were found in the FY' + _finPlanBaseYear
      + ' church ledger, so there is nothing to compare against. FY' + _finPlanTargetYear + ' is ' + planParts
      + '. Import or sync that year on the Church Report tab first.</div>';
  }
  function list(rows) {
    return '<ul class="fin-comp-basis-list">' + rows.map(function(r) {
      return '<li>' + esc(r.label) + ' &middot; ' + finCompMoney(r.cents)
        + ' <span style="color:var(--warm-gray);">(' + r.basis
        + (r.rosterNames.length ? ' &middot; ' + esc(r.rosterNames.join(', ')) : '') + ')</span></li>';
    }).join('') + '</ul>';
  }
  var matchedSalary = b.rows.filter(function(r) { return r.kind === 'salary' && r.rosterNames.length; });
  var pooled = b.rows.filter(function(r) { return r.kind === 'benefit'; });
  // Which SIDE the difference is on, before the account list. A single net figure ("-6.1%") cannot
  // tell you whether the salaries disagree or the benefits do, and those have completely different
  // causes — a salary gap is usually an account in the ledger that no rostered worker is paid from,
  // a benefits gap is usually the ledger carrying coverage the roster does not model. Splitting it
  // turns "the total is wrong" into one line to look at.
  var salDelta = totals.salaryCents - b.salaryCents;
  var benDelta = totals.benefitsCents - b.benefitCents;
  function cmpRow(label, planCents, baseCents, delta) {
    var color = delta === 0 ? 'var(--warm-gray)' : (delta > 0 ? 'var(--charcoal)' : 'var(--deep-amber)');
    return '<tr><td style="padding:2px 8px 2px 0;">' + label + '</td>'
      + '<td class="num" style="padding:2px 8px;text-align:right;">' + finCompMoney(baseCents) + '</td>'
      + '<td class="num" style="padding:2px 8px;text-align:right;">' + finCompMoney(planCents) + '</td>'
      + '<td class="num" style="padding:2px 0 2px 8px;text-align:right;font-weight:700;color:' + color + ';">' + finCompMoneySigned(delta) + '</td></tr>';
  }
  var split = '<table style="border-collapse:collapse;font-size:.78rem;margin:8px 0;">'
    + '<thead><tr><th style="text-align:left;padding:2px 8px 2px 0;color:var(--warm-gray);font-weight:600;">Where the difference is</th>'
    + '<th style="text-align:right;padding:2px 8px;color:var(--warm-gray);font-weight:600;">FY' + _finPlanBaseYear + ' ledger</th>'
    + '<th style="text-align:right;padding:2px 8px;color:var(--warm-gray);font-weight:600;">FY' + _finPlanTargetYear + ' plan</th>'
    + '<th style="text-align:right;padding:2px 0 2px 8px;color:var(--warm-gray);font-weight:600;">Difference</th></tr></thead><tbody>'
    + cmpRow('Salaries', totals.salaryCents, b.salaryCents, salDelta)
    + cmpRow('Benefits &amp; taxes', totals.benefitsCents, b.benefitCents, benDelta)
    + '</tbody></table>'
    + '<div style="font-size:.72rem;color:var(--warm-gray);margin-bottom:6px;">'
    + (Math.abs(benDelta) > Math.abs(salDelta)
        ? 'Most of the gap is on the <b>benefits</b> side: the FY' + _finPlanBaseYear + ' ledger carries ' + finCompMoney(Math.abs(benDelta)) + ' ' + (benDelta < 0 ? 'more' : 'less') + ' in pension, health and employer taxes than this plan computes. That usually means the ledger accounts cover people or coverage the roster does not model &mdash; check the pooled accounts listed below against who is actually on the plan in step 3.'
        : 'Most of the gap is on the <b>salary</b> side: the FY' + _finPlanBaseYear + ' ledger carries ' + finCompMoney(Math.abs(salDelta)) + ' ' + (salDelta < 0 ? 'more' : 'less') + ' in wages than this plan. That usually means a salary account nobody on this roster is paid from &mdash; see the unmatched accounts below.')
    + '</div>';
  var out = '<div class="fin-comp-basis">'
    + finCompRenderBasisPicker()
    + '<b>How the FY' + _finPlanBaseYear + ' comparison is figured.</b> '
    + 'FY' + _finPlanTargetYear + ' is ' + planParts + ', for the ' + finCompCountedCount() + ' worker(s) counted above. '
    + 'FY' + _finPlanBaseYear + ' is the same cost categories from the church ledger.'
    + split;
  if (matchedSalary.length) {
    out += '<div class="fin-comp-basis-h">Salaries for people on this roster</div>' + list(matchedSalary);
  }
  if (pooled.length) {
    out += '<div class="fin-comp-basis-h">Pooled benefits &amp; taxes (charged for the whole staff on one line, so they cannot be split per person)</div>' + list(pooled);
  }
  if (b.unmatchedRows.length) {
    out += '<div class="fin-comp-basis-h warn">Salaries for people NOT on this roster &mdash; ' + finCompMoney(b.unmatchedCents)
      + (b.rosterOnly ? ' (not counted)' : ' (counted)') + '</div>'
      + '<div>No worker counted above is paid from ' + (b.unmatchedRows.length === 1 ? 'this account' : 'these accounts')
      + '. That is a departed or vacant post, a worker missing from the roster, or someone excluded as paid from another budget'
      + ' &mdash; and while it is counted, the base year covers more people than the plan does, so the plan reads cheaper than it is.</div>'
      + list(b.unmatchedRows)
      + (finCompIsAdmin()
          ? '<div><span class="fin-comp-link" onclick="finCompToggleBaselineRosterOnly()">'
            + (b.rosterOnly ? '&#8634; count these accounts again' : 'Leave these out and compare like for like &rarr;') + '</span></div>'
          : '');
  } else {
    out += '<div>Every salary account found is one a worker counted above is paid from, so both sides cover the same people.</div>';
  }
  out += '<div style="margin-top:7px;">'
    + (b.prorated
        ? 'FY' + _finPlanBaseYear + ' is still in progress (' + b.weeks.toFixed(0) + ' weeks in), so an account with no budget on file is annualized from its actual &mdash; the same 52/weeks the Planning tab uses. Both sides are a full year. '
        : 'FY' + _finPlanBaseYear + ' is complete, so these are its own full-year figures. ')
    + '<b>What this still cannot see:</b> an account the church names in some other way is not counted at all, '
    + 'and a pooled benefit line covers everyone the church paid that year, including anyone listed above as not on this roster.'
    + '</div></div>';
  return out;
}
function finCompToggleBaselineRosterOnly() {
  _finCompBaselineRosterOnly = !_finCompBaselineRosterOnly;
  finCompSay(_finCompBaselineRosterOnly
    ? 'FY' + _finPlanBaseYear + ' now counts only the accounts this roster is paid from.'
    : 'FY' + _finPlanBaseYear + ' now counts every compensation account.');
  finSalaryScheduleAutoSave();
  finRerenderPlanningPreserveFocus();
}
// The worker drawer. Re-rendered wholesale on every selection (not value-patched) so every
// <select>/<checkbox> follows the selected worker — the controlled-select trap called out in the
// handoff; emitted selected/checked attributes are what make that correct here.
function finCompRenderDrawer(computed) {
  var i = _finCompSelected, w = _finSalaryRoster[i], c = computed[i];
  var b = c.benefits;
  var acctOptions = finCompAccountOptions(w.accountCode).map(function(a) {
    return '<option value="' + esc(a.code) + '"' + (String(a.code) === String(w.accountCode || '') ? ' selected' : '') + '>' + esc(a.label) + '</option>';
  }).join('');
  var trackSet = w.role === 'commissioned' ? LCMS_COMMISSIONED_TRACKS : w.role === 'other' ? LCMS_OTHER_WORKER_TRACKS : null;
  var trackField = trackSet ? '<label class="fin-comp-field">' + (w.role === 'commissioned' ? 'Education track (district scale)' : 'Worker type (district scale)')
    + '<select onchange="finCompWorkerChange(' + i + ',&quot;trackKey&quot;,this.value)">'
    + Object.keys(trackSet).map(function(k) { return '<option value="' + k + '"' + (k === w.trackKey ? ' selected' : '') + '>' + esc(trackSet[k].label) + '</option>'; }).join('')
    + '</select></label>' : '';
  var eduField = '<label class="fin-comp-field">Education<select onchange="finCompWorkerChange(' + i + ',&quot;education&quot;,this.value)">'
    + FIN_COMP_EDUCATION.map(function(e) { return '<option value="' + e.key + '"' + ((w.education || 'none') === e.key ? ' selected' : '') + '>' + esc(e.label) + '</option>'; }).join('')
    + '</select></label>';
  var attendanceField = w.role === 'pastor' ? '<label class="fin-comp-field">Attendance band<select onchange="finCompAttendanceChange(' + i + ',this.value)">'
    + LCMS_ATTENDANCE_BONUS_BANDS.map(function(band) {
        var mid = (band.range[0] + band.range[1]) / 2;
        var on = band.key === 'none' ? !Number(w.attendanceBonus) : Math.abs(mid - (Number(w.attendanceBonus) || 0)) < 0.001;
        return '<option value="' + mid + '"' + (on ? ' selected' : '') + '>' + esc(band.label) + (band.key === 'none' ? '' : ' (+' + (mid * 100).toFixed(1) + '%)') + '</option>';
      }).join('') + '</select></label>' : '';
  var stipendKey = w.responsibilityStipendKey || 'none';
  var stipendField = '<label class="fin-comp-field">Responsibility stipend<select onchange="finCompStipendChange(' + i + ',this.value)">'
    + LCMS_RESPONSIBILITY_STIPENDS.map(function(s) {
        return '<option value="' + s.key + '"' + (s.key === stipendKey ? ' selected' : '') + '>' + esc(s.label)
          + (s.key === 'none' ? '' : ' (+' + (s.range[0] * 100).toFixed(0) + '&ndash;' + (s.range[1] * 100).toFixed(0) + '%)') + '</option>';
      }).join('') + '</select></label>';
  var stipendPctField = stipendKey !== 'none'
    ? '<label class="fin-comp-field">Stipend used %<input type="text" inputmode="decimal" id="fin-comp-stipend-pct-' + i + '" value="' + (Math.round((Number(w.responsibilityStipend) || 0) * 10000) / 100) + '" oninput="finCompStipendPctChange(' + i + ',finSanitizeDecimalInput(this))"></label>'
    : '';
  var stipendDef = LCMS_RESPONSIBILITY_STIPENDS.filter(function(s) { return s.key === stipendKey; })[0];
  var stipendNote = (stipendDef && stipendKey !== 'none')
    ? '<div class="fin-comp-note">Published range +' + (stipendDef.range[0] * 100).toFixed(0) + '% to +' + (stipendDef.range[1] * 100).toFixed(0) + '% &mdash; midpoint used, adjust within the range.</div>' : '';
  var roleNote = w.role === 'pastor'
    ? 'Pastors are scaled by years of service alone; education is recorded for the call documents and Concordia&#39;s tool.'
    : w.role === 'commissioned'
      ? 'The district scales commissioned workers by education track &mdash; that track is what changes the District Compensation Worksheet figure.'
      : 'The district publishes a separate scale per job type. Education is recorded but does not change the figure.';
  var payEntered = w.actualSalaryCents != null;
  var acctPayCents = finAccountBudgetCentsForCode(w.accountCode);
  var overridden = c.overridden;
  var salaryBox = '<input type="text" inputmode="decimal" id="fin-comp-salary-' + i + '" value="' + (overridden ? _finCompOverrides[i] : Math.round(c.salaryCents / 100)) + '" oninput="finCompSalaryOverride(' + i + ',finPlanSanitizeWholeDollarInput(this))" style="width:104px;text-align:right;font-weight:700;' + (overridden ? 'background:var(--warm-surface-header);border:1.5px solid var(--color-gold);' : '') + '">';
  // Each part is escaped on its own and then joined with the separator MARKUP. Building the whole
  // string with "&middot;" inside it and escaping the result turns the separator into literal text
  // on the page — escape data, never markup.
  var meta = [w.position, w.yearsExperience + ' yrs', finCompEducationLabel(w), trackSet && trackSet[w.trackKey] ? trackSet[w.trackKey].label : '', w.accountCode ? 'budget line ' + w.accountCode : 'no budget line']
    .filter(Boolean).map(function(part) { return esc(String(part)); }).join(' &middot; ');
  var base = finCompBaseSalary(_finPlanTargetYear);
  var fields = '<div class="fin-comp-fieldgrid">'
    + '<label class="fin-comp-field">Name<input type="text" id="fin-comp-name-' + i + '" value="' + esc(w.name || '') + '" oninput="finCompWorkerChange(' + i + ',&quot;name&quot;,this.value)"></label>'
    + '<label class="fin-comp-field">Position<input type="text" id="fin-comp-position-' + i + '" value="' + esc(w.position || '') + '" oninput="finCompWorkerChange(' + i + ',&quot;position&quot;,this.value)"></label>'
    + '<label class="fin-comp-field" style="grid-column:1/-1;">Budget line<select onchange="finCompWorkerChange(' + i + ',&quot;accountCode&quot;,this.value)">' + acctOptions + '</select></label>'
    + '<label class="fin-comp-field" style="grid-column:1/-1;">FY' + _finPlanBaseYear + ' current pay'
    + '<span style="display:inline-flex;align-items:center;gap:8px;">'
    + '<input type="text" inputmode="decimal" id="fin-comp-curpay-' + i + '" value="' + (payEntered ? Math.round(w.actualSalaryCents / 100) : '') + '" placeholder="' + (acctPayCents != null ? Math.round(acctPayCents / 100) : 'not set') + '" oninput="finCompCurrentPayChange(' + i + ',finPlanSanitizeWholeDollarInput(this))" style="width:120px;text-align:right;' + (payEntered ? 'background:var(--warm-surface-header);border:1.5px solid var(--color-gold);font-weight:700;' : '') + '">'
    + (payEntered ? '<a href="javascript:void(0)" onclick="finCompClearCurrentPay(' + i + ')" style="font-size:.72rem;">&#8634; use the budget line</a>' : '')
    + '</span></label>'
    + '</div>'
    + '<div class="fin-comp-note" style="color:' + ((payEntered || w.accountCode) ? 'var(--warm-gray)' : 'var(--deep-amber)') + ';">'
    + (payEntered
        ? 'Current pay is entered by hand, so the &ldquo;no raise&rdquo; column and every % growth are computed off ' + finCompMoney(w.actualSalaryCents) + ' rather than the budget line. Use this when a worker&#39;s wages sit inside a line shared with other staff.'
        : w.accountCode
          ? 'FY' + _finPlanBaseYear + ' current pay reads the whole Budget figure on ' + esc(w.accountCode) + '. If other staff are paid from that same line, type this worker&#39;s own wage above instead.'
          : 'Not linked and nothing entered &mdash; current pay reads as $0, so &ldquo;no raise&rdquo; and every % growth will too. Link a budget line or type the wage above.')
    + '</div>'
    + '<div class="fin-comp-drawer-h">District Compensation Worksheet inputs</div>'
    + '<div class="fin-comp-fieldgrid">'
    + '<label class="fin-comp-field">Role<select onchange="finCompRoleChange(' + i + ',this.value)">'
    + '<option value="pastor"' + (w.role === 'pastor' ? ' selected' : '') + '>Pastor</option>'
    + '<option value="commissioned"' + (w.role === 'commissioned' ? ' selected' : '') + '>Commissioned</option>'
    + '<option value="other"' + (w.role === 'other' ? ' selected' : '') + '>Other worker</option>'
    + '</select></label>'
    + eduField + trackField
    + '<label class="fin-comp-field">Years of service<input type="text" inputmode="numeric" id="fin-comp-years-' + i + '" value="' + (Number(w.yearsExperience) || 0) + '" oninput="finCompYearsChange(' + i + ',finPlanSanitizeWholeDollarInput(this))"></label>'
    + attendanceField + stipendField + stipendPctField
    + '<label class="fin-comp-field">Time worked<span style="display:inline-flex;align-items:center;gap:4px;"><input type="text" inputmode="decimal" id="fin-comp-fte-' + i + '" value="' + finCompFtePct(w) + '" oninput="finCompFteChange(' + i + ',finSanitizeDecimalInput(this))"><span style="color:var(--warm-gray);">% of full time</span></span></label>'
    + '<label class="fin-comp-field">Health coverage<select onchange="finCompSetHealthTier(' + i + ',this.value)"' + (finCompIsCashOnly(w) ? ' disabled' : '') + '>'
    + FIN_HEALTH_TIERS.map(function(t) { return '<option value="' + t.key + '"' + (finCompHealthTier(w) === t.key ? ' selected' : '') + '>' + esc(t.label) + '</option>'; }).join('')
    + '<option value="optout"' + (finCompHealthTier(w) === 'optout' ? ' selected' : '') + '>Opts out (cash)</option>'
    + '</select></label>'
    + '</div>'
    + '<label class="fin-comp-inline-check" style="margin:6px 0 0;"><input type="checkbox" onchange="finCompCashOnlyToggle(' + i + ',this.checked)"' + (finCompIsCashOnly(w) ? ' checked' : '') + '> Cash salary only &mdash; no pension, disability or health</label>'
    + '<label class="fin-comp-inline-check" style="margin:6px 0 0;"><input type="checkbox" onchange="finCompExternallyFundedToggle(' + i + ',this.checked)"' + (finCompIsExternallyFunded(w) ? ' checked' : '') + (finCompIsAdmin() ? '' : ' disabled') + '> Paid from another budget &mdash; keep on the roster but leave out of every church figure</label>'
    + (finCompIsExternallyFunded(w) ? '<div style="font-size:.72rem;color:var(--deep-amber);margin-top:4px;">Costed elsewhere: this worker is in no total on this tab or in the Council report. The FY' + _finPlanBaseYear + ' comparison figure still comes from the church payroll accounts as they stand.</div>' : '')
    + (finCompIsCashOnly(w)
        ? '<div class="fin-comp-note">Concordia\u2019s plans have an hours floor, so a very part-time worker draws none of them. Employer FICA still applies &mdash; it is owed on any wage however few the hours.</div>'
        : (finCompIsPartTime(w) ? '<div class="fin-comp-note">At ' + finCompFtePct(w) + '% of full time this worker is still shown as benefits-eligible. Tick the box above if they are not.</div>' : ''))
    + '<div class="fin-comp-note">' + roleNote + '</div>' + stipendNote;
  return '<div class="fin-card fin-comp-drawer">'
    + '<div class="fin-comp-drawer-hd">'
    + '<div><div class="fin-comp-chiprow-lbl">Selected worker</div>'
    + '<div class="fin-comp-drawer-name">' + esc(w.name || '(unnamed)') + '</div>'
    + '<div class="fin-comp-note">' + meta + '</div></div>'
    + '<span onclick="finCompCloseDrawer()" style="font-size:20px;color:var(--warm-gray);cursor:pointer;">&times;</span></div>'
    + '<div class="fin-comp-tiles">'
    + '<div class="fin-comp-tile"><span class="fin-comp-tile-lbl">FY' + _finPlanBaseYear + '</span><span class="fin-comp-tile-val">' + finCompMoney(c.currentCents) + '</span></div>'
    + '<div class="fin-comp-tile teal"><span class="fin-comp-tile-lbl">FY' + _finPlanTargetYear + '</span><span class="fin-comp-tile-val">' + finCompMoney(c.salaryCents) + '</span></div>'
    + '<div class="fin-comp-tile"><span class="fin-comp-tile-lbl">Per paycheck</span><span class="fin-comp-tile-val">' + finCompMoney(c.salaryCents / FIN_SALARY_PAY_PERIODS) + '</span></div>'
    + '<div class="fin-comp-tile"><span class="fin-comp-tile-lbl">Church cost</span><span class="fin-comp-tile-val">' + finCompMoney(c.churchCostCents) + '</span></div>'
    + '</div>'
    + finCompReadOnly(fields)
    + '<div class="fin-comp-bar cream"><span>District Compensation Worksheet result' + (finCompIsPartTime(w) ? ' <span style="font-size:.72rem;">at ' + finCompFtePct(w) + '% time</span>' : '') + '</span><b>$' + finFmtMoney(base.dollars) + ' &times; ' + finCompMultiplier(w).toFixed(3) + (finCompIsPartTime(w) ? ' &times; ' + finCompFtePct(w) + '%' : '') + ' = ' + (c.worksheetCents == null ? '&mdash;' : finCompMoney(c.worksheetCents)) + '</b></div>'
    + '<div class="fin-comp-bar page"><span>FY' + _finPlanTargetYear + ' salary</span><span style="display:inline-flex;align-items:center;gap:8px;"><span style="color:var(--warm-gray);">$</span>'
    + finCompReadOnly(salaryBox)
    + (overridden ? '<span class="fin-comp-link" onclick="finCompClearOverride(' + i + ')">&#8634;</span>' : '') + '</span></div>'
    + '<div class="fin-comp-paylist">'
    + '<div class="fin-comp-drawer-h" style="border-top:1px solid var(--warm-row-divider);padding-top:12px;">What the church pays</div>'
    + finCompPayRow('Cash salary', finCompMoney(c.salaryCents))
    + finCompPayRow('Pension ' + (b.cashOnly ? '' : finCompPctFmt(finCompPensionRate(_finPlanTargetYear).rate)), b.cashOnly ? '<span style="color:var(--warm-gray);font-weight:400;">not eligible</span>' : finCompMoney(b.pensionCents))
    + finCompPayRow('Health', b.cashOnly ? '<span style="color:var(--warm-gray);font-weight:400;">not eligible</span>' : finCompMoney(b.healthCents))
    + finCompPayRow('Disability' + (b.cashOnly ? '' : ' <label class="fin-comp-inline-check"><input type="checkbox" onchange="finCompDependentsToggle(' + i + ',this.checked)"' + (w.hasDependents ? ' checked' : '') + (finCompIsAdmin() ? '' : ' disabled') + '> dependents</label>'), b.cashOnly ? '<span style="color:var(--warm-gray);font-weight:400;">not eligible</span>' : finCompMoney(b.disabilityCents))
    + finCompPayRow('Employer FICA <label class="fin-comp-inline-check"><input type="checkbox" onchange="finCompSecaToggle(' + i + ',this.checked)"' + (w.selfEmployedFica ? ' checked' : '') + (finCompIsAdmin() ? '' : ' disabled') + '> minister</label>', finCompMoney(b.ficaCents))
    + (w.selfEmployedFica ? '<div class="fin-comp-seca"><span>Employer half the worker covers themselves &mdash; ' + finCompPctFmt(finCompFicaRate()) + ' of ' + finCompMoney(c.salaryCents) + '<br><span style="font-size:.7rem;color:var(--warm-meta);">As a minister they pay SECA, so this employer share comes out of their own pay. It is in no total below. The employee half is not shown; everyone pays that.</span></span><b style="color:var(--deep-amber);">&minus;' + finCompMoney(b.secaSelfCents) + '</b></div>' : '')
    + '<div class="fin-comp-payrow total"><span>Total</span><b>' + finCompMoney(c.churchCostCents) + '</b></div>'
    + '</div>'
    + (finCompIsAdmin() ? '<button class="btn-secondary" style="margin-top:10px;font-size:.74rem;color:var(--danger);" onclick="finCompRemoveWorker(' + i + ')">Remove this worker</button>' : '')
    + '</div>';
}
function finCompPayRow(label, value) {
  return '<div class="fin-comp-payrow"><span>' + label + '</span><b>' + value + '</b></div>';
}
var FIN_COMP_EDUCATION = [
  { key: 'none', label: 'Not recorded' },
  { key: 'hs', label: 'High school' },
  { key: 'associates', label: 'Associate&#39;s' },
  { key: 'bachelors', label: 'Bachelor&#39;s' },
  { key: 'masters', label: 'Master&#39;s' },
  { key: 'mdiv', label: 'M.Div.' },
  { key: 'doctorate', label: 'Doctorate' }
];
function finCompEducationLabel(w) {
  var e = FIN_COMP_EDUCATION.filter(function(x) { return x.key === (w.education || 'none'); })[0];
  return e && e.key !== 'none' ? e.label : '';
}

// ── View 2 — Check fairness ────────────────────────────────────────────────────────────────
function finCompRenderFairness(computed) {
  var withReports = _finSalaryRoster.filter(function(w) { return finCompUsableRanges(w).length; }).length;
  var reportDates = {};
  _finSalaryRoster.forEach(function(w) { var d = (w.concordia || {}).asOfDate; if (d) reportDates[d] = true; });
  var dateList = Object.keys(reportDates);
  var blocks = _finSalaryRoster.map(function(w, i) {
    var c = computed[i];
    var usable = finCompUsableRanges(w);
    var verdict = finCompVerdict(w, c.salaryCents);
    var delta = c.salaryCents - c.currentCents;
    var bars = '';
    if (usable.length) {
      var vals = [c.salaryCents, c.currentCents];
      usable.forEach(function(r) { vals.push(r.lowCents, r.highCents); });
      var pct = finCompBarScale(vals, 0.08);
      bars = usable.map(function(r) {
        return '<div class="fin-comp-rangerow">'
          + '<span class="fin-comp-rangelbl">' + esc(r.label) + '</span>'
          + '<div class="fin-comp-track">'
          + '<div class="fin-comp-fill" style="left:' + pct(r.lowCents) + ';right:' + (100 - parseFloat(pct(r.highCents))).toFixed(2) + '%;"></div>'
          + (r.midCents ? '<div class="fin-comp-tick mid" style="left:' + pct(r.midCents) + ';"></div>' : '')
          + '<div class="fin-comp-tick salary" style="left:' + pct(c.salaryCents) + ';"></div>'
          + '</div>'
          + '<span class="fin-comp-rangenum">' + finCompMoney(r.lowCents) + ' &ndash; ' + finCompMoney(r.highCents) + (r.midCents ? ' &middot; mid ' + finCompMoney(r.midCents) : '') + '</span>'
          + '</div>';
      }).join('');
      bars = '<div class="fin-comp-ranges">' + bars + '</div>';
    } else {
      bars = '<div class="fin-comp-noreport">No Concordia Plans report on file for this position &mdash; compared against the District Compensation Worksheet figure ('
        + (c.worksheetCents == null ? 'not available' : finCompMoney(c.worksheetCents)) + ') only. '
        + '<span class="fin-comp-link" onclick="finCompSetView(&quot;rates&quot;)">Add the ranges</span></div>';
    }
    return '<div class="fin-comp-fairblock">'
      + '<div class="fin-comp-fairhd">'
      + '<div><div style="font-size:1rem;font-weight:700;color:var(--color-navy);">' + esc(w.name || '(unnamed)')
      + ((w.concordia || {}).position ? ' <span style="font-weight:400;font-size:.78rem;color:var(--warm-gray);">' + esc(w.concordia.position) + '</span>' : '') + '</div>'
      + '<div style="font-size:.76rem;color:var(--warm-gray);">FY' + _finPlanBaseYear + ' ' + finCompMoney(c.currentCents) + ' &rarr; FY' + _finPlanTargetYear + ' <b style="color:var(--charcoal);">' + finCompMoney(c.salaryCents) + '</b> &middot; '
      + (delta === 0 ? 'no change' : finCompMoneySigned(delta) + (c.currentCents ? ' (' + (delta / c.currentCents * 100).toFixed(1) + '%)' : '')) + '</div></div>'
      + '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
      + '<span class="fin-comp-verdict" style="background:' + verdict.bg + ';color:' + verdict.color + ';">' + verdict.text + '</span>'
      + (verdict.matchLabel && finCompIsAdmin() ? '<span class="fin-comp-link" onclick="finCompMatchMidpoint(' + i + ')">' + verdict.matchLabel + '</span>' : '')
      + '</div></div>'
      + bars + '</div>';
  }).join('');
  return '<div class="fin-card">'
    + '<div class="fin-comp-cardhd">'
    + '<div class="fin-card-title" style="margin:0;">Is it fair?</div>'
    + '<div style="font-size:.78rem;color:var(--warm-gray);">Concordia Plans Decision Support reports'
    + (dateList.length === 1 ? ', run ' + esc(dateList[0]) : '') + ' &middot; ' + withReports + ' of ' + _finSalaryRoster.length + ' workers have a report on file</div>'
    + '</div>'
    + '<div class="fin-comp-legend">'
    + '<span><span class="fin-comp-swatch fill"></span> published range (lower&ndash;higher)</span>'
    + '<span><span class="fin-comp-swatch mid"></span> midpoint</span>'
    + '<span><span class="fin-comp-swatch salary"></span> your FY' + _finPlanTargetYear + ' figure</span>'
    + '</div>'
    + blocks
    + '<div class="fin-comp-cardfoot" style="border-top:1px solid var(--warm-row-divider);padding-top:14px;">'
    + '<button class="btn-secondary" onclick="finCompSetView(&quot;plan&quot;)">&larr; Back to pay</button>'
    + '<button class="btn-primary" onclick="finCompSetView(&quot;health&quot;)">Next: health plan &rarr;</button>'
    + '</div></div>';
}

// ── View 3 — Health plan ───────────────────────────────────────────────────────────────────
// Premium entry lives on "This year's rates"; here you choose the plan the church covers in full
// and who sits on which tier. The full "is it worth it for the worker?" breakeven explanation
// (unchanged math) stays available behind a disclosure.
var FIN_COMP_PLAN_KEYS = ['renewal', 'option1', 'option2', 'option3'];
var FIN_COMP_PLAN_TAGS = {
  renewal: 'Same plan design as today, new rates',
  option1: 'Richest plan &middot; not embedded',
  option2: 'Middle plan &middot; not embedded',
  option3: 'Leanest plan &middot; embedded individual limits'
};
// Derived from the option's own embedded flag rather than hand-written per plan, so the badge
// can never disagree with the maths it describes. Under a non-embedded plan there is no individual
// sub-limit inside family coverage at all — one member can satisfy the whole family deductible
// alone — so its "single" figures are the self-only-contract deductible, not a per-person cap on a
// family contract. Saying so on the row is the whole point of the badge.
function finHealthEmbeddedBadge(optionKey) {
  var opt = HEALTH_PLAN_QUOTE_2027.options[optionKey];
  if (!opt) return '';
  return opt.embedded
    ? '<span class="fin-comp-embed-badge emb" title="Each family member has their own limit inside the family limit. Once a member meets their own deductible they start paying coinsurance, even if the family deductible has not been met.">Embedded</span>'
    : '<span class="fin-comp-embed-badge agg" title="One true family deductible — no individual limits. Family members pool expenses and one person can pay the full amount on behalf of the family. The single figures below apply to self-only coverage, not as a per-person cap within family coverage.">Non-embedded</span>';
}
function finCompPlanQuoteField(optionKey, field) {
  var ov = (_finHealthPlanPremiumOverrides[optionKey] || {})[field];
  return ov != null ? ov : HEALTH_PLAN_QUOTE_2027.options[optionKey][field];
}
// What ONE household's premium difference is between two options — the figure the "is it worth it
// for the worker" analysis turns on, since the church covers Renewal in full and a worker choosing
// another option pays the gap. Now read straight off the two tier rates rather than divided out of
// a group total, so it stays right when the roster is not all one tier. Family tier, because that
// is the household the framing is about; dental and vision are the same across the renewal options
// and cancel, but are included so the "current" option compares honestly too.
function finCompPerHouseholdDiffCents(fromKey, toKey, tierKey) {
  var tier = tierKey || 'family';
  var from = finHealthTierMonthlyCents(fromKey, tier), to = finHealthTierMonthlyCents(toKey, tier);
  if (from == null || to == null) return 0;
  var dv = function(k) { return finCompPlanQuoteField(k, 'dentalCents') + finCompPlanQuoteField(k, 'visionCents'); };
  var enrolled = Math.max(1, finCompEnrolledCount());
  return (to - from) * 12 + Math.round((dv(toKey) - dv(fromKey)) / enrolled);
}
function finCompRenderHealth(computed, totals) {
  var counts = finCompEnrollmentCounts();
  var cards = FIN_COMP_PLAN_KEYS.map(function(key) {
    var calc = finComputeHealthPlanTotalCents(key, null, counts);
    if (!calc) return '';
    var active = key === _finHealthPlanSelectedOption;
    var perHousehold = finCompPerHouseholdDiffCents('renewal', key);
    var note = key === 'renewal' ? 'Church covers this in full'
      : perHousehold > 0 ? 'Worker pays ' + finCompMoney(perHousehold) + '/yr more'
      : 'Worker saves ' + finCompMoney(Math.abs(perHousehold)) + '/yr';
    var noteColor = key === 'renewal' || perHousehold <= 0 ? 'var(--sage-text)' : 'var(--danger)';
    return '<div class="fin-comp-plancard' + (active ? ' active' : '') + '" onclick="finCompPickPlan(' + jsAttr(key) + ')">'
      + '<div style="display:flex;align-items:center;gap:8px;"><span class="fin-comp-radio' + (active ? ' active' : '') + '"></span>'
      + '<span style="font-size:.82rem;font-weight:700;color:var(--color-navy);">' + esc(calc.label) + '</span></div>'
      + '<div style="font-size:20px;font-weight:800;color:var(--color-navy);font-variant-numeric:tabular-nums;">' + finCompMoney(calc.totalCents) + '</div>'
      + '<div style="font-size:.72rem;color:var(--warm-gray);">Deductible ' + finCompMoney(finCompPlanQuoteField(key, 'deductibleIndividualCents')) + ' single / ' + finCompMoney(finCompPlanQuoteField(key, 'deductibleFamilyCents')) + ' family'
      + '<br>Out-of-pocket max ' + finCompMoney(finCompPlanQuoteField(key, 'oopMaxIndividualCents')) + ' single / ' + finCompMoney(finCompPlanQuoteField(key, 'oopMaxFamilyCents')) + ' family</div>'
      + '<div style="font-size:.74rem;font-weight:700;color:' + noteColor + ';">' + note + '</div>'
      + '<div style="font-size:.7rem;color:var(--warm-meta);">' + FIN_COMP_PLAN_TAGS[key] + '</div>'
      + '</div>';
  }).join('');
  var planLabel = (finComputeHealthPlanTotalCents(_finHealthPlanSelectedOption) || {}).label || '';
  var rows = _finSalaryRoster.map(function(w, i) {
    var tier = finCompHealthTier(w), b = computed[i].benefits;
    var costCell, basis;
    if (finCompIsCashOnly(w)) {
      costCell = '<span style="color:var(--warm-gray);font-weight:400;">&mdash;</span>';
      basis = 'Cash salary only at ' + finCompFtePct(w) + '% time &mdash; below the hours floor for the group plan.';
      return '<tr style="opacity:.7;"><td class="fin-comp-td"><div style="font-weight:700;">' + esc(w.name || '(unnamed)') + '</div><div style="font-size:.72rem;color:var(--warm-gray);">' + esc(w.position || '') + '</div></td>'
        + '<td class="fin-comp-td"><span style="font-size:.78rem;color:var(--warm-gray);">Not eligible</span></td>'
        + '<td class="fin-comp-td num" style="font-weight:700;">' + costCell + '</td>'
        + '<td class="fin-comp-td" style="font-size:.76rem;color:var(--warm-gray);">' + basis + '</td></tr>';
    }
    if (tier !== 'optout') {
      var tierRate = finHealthTierMonthlyCents(_finHealthPlanSelectedOption, tier) || 0;
      var enrolledN = Math.max(1, finCompEnrolledCount());
      if (w.employeeOnlyPremiumCents != null) {
        costCell = finCompReadOnly('<span style="display:inline-flex;align-items:center;gap:3px;justify-content:flex-end;"><span style="color:var(--warm-gray);font-weight:400;">$</span>'
          + '<input type="text" inputmode="decimal" id="fin-comp-eo-' + i + '" value="' + (w.employeeOnlyPremiumCents / 100) + '" placeholder="0.00" oninput="finCompEmployeeOnlyChange(' + i + ',finSanitizeDecimalInput(this))" style="width:88px;text-align:right;font-weight:700;"></span>');
        basis = 'Hand-entered premium, overriding the ' + esc(finCompHealthTierLabel(tier)) + ' rate. <span class="fin-comp-link" onclick="finCompEmployeeOnlyChange(' + i + ',&quot;&quot;)">use the quote</span>';
      } else {
        costCell = finCompMoney(b.healthCents);
        basis = esc(finCompHealthTierLabel(tier)) + ' rate ' + finCompMoneyCents(tierRate) + '/mo &times; 12, plus dental and vision shared across ' + enrolledN + ' enrolled';
      }
    } else {
      costCell = finCompReadOnly('<span style="display:inline-flex;align-items:center;gap:3px;justify-content:flex-end;"><span style="color:var(--warm-gray);font-weight:400;">$</span>'
        + '<input type="text" inputmode="decimal" id="fin-comp-optout-' + i + '" value="' + (w.healthOptOutOverrideCents != null ? (w.healthOptOutOverrideCents / 100) : '') + '" placeholder="' + (finCompOptOutCents() / 100).toFixed(2) + '" oninput="finCompOptOutChange(' + i + ',finSanitizeDecimalInput(this))" style="width:88px;text-align:right;font-weight:700;"></span>');
      basis = 'Opt-out cash &mdash; default ' + finCompMoney(finCompOptOutCents()) + ' from this year&#39;s rates';
    }
    return '<tr><td class="fin-comp-td"><div style="font-weight:700;">' + esc(w.name || '(unnamed)') + '</div><div style="font-size:.72rem;color:var(--warm-gray);">' + esc(w.position || '') + '</div></td>'
      + '<td class="fin-comp-td"><select onchange="finCompSetHealthTier(' + i + ',this.value)"' + (finCompIsAdmin() ? '' : ' disabled') + '>'
      + FIN_HEALTH_TIERS.map(function(t) { return '<option value="' + t.key + '"' + (tier === t.key ? ' selected' : '') + '>' + esc(t.label) + '</option>'; }).join('')
      + '<option value="optout"' + (tier === 'optout' ? ' selected' : '') + '>Opts out (cash)</option>'
      + '</select></td>'
      + '<td class="fin-comp-td num" style="font-weight:700;">' + costCell + '</td>'
      + '<td class="fin-comp-td" style="font-size:.76rem;color:var(--warm-gray);">' + basis + '</td></tr>';
  }).join('');
  var liveCounts = finCompEnrollmentCounts();
  var enrolledTotal = finCompEnrolledCount();
  var enrolBreakdown = FIN_HEALTH_TIERS.filter(function(t) { return liveCounts[t.key] > 0; })
    .map(function(t) { return liveCounts[t.key] + ' ' + t.label; }).join(', ') || 'nobody';
  var table = '<div style="overflow-x:auto;"><table class="fin-comp-table" style="min-width:700px;">'
    + '<thead><tr><th class="fin-comp-th">Worker</th><th class="fin-comp-th">Coverage</th><th class="fin-comp-th num">Church cost</th><th class="fin-comp-th">Where the figure comes from</th></tr></thead>'
    + '<tbody>' + rows
    + '<tr class="fin-comp-total-row"><td class="fin-comp-td" colspan="2">Total health cost</td>'
    + '<td class="fin-comp-td num">' + finCompMoney(totals.healthCents) + '</td>'
    + '<td class="fin-comp-td" style="font-size:.74rem;font-weight:400;color:var(--warm-gray);">Group quote at this enrollment ('
    + esc(enrolBreakdown) + ') is ' + finCompMoney(finComputeHealthPlanTotalCents(_finHealthPlanSelectedOption, null, liveCounts).totalCents)
    + ' across ' + enrolledTotal + ' contract' + (enrolledTotal === 1 ? '' : 's') + '; opt-out cash and any hand-entered premium are on top.</td></tr>'
    + '</tbody></table></div>';
  return '<div class="fin-card">'
    + '<div class="fin-comp-cardhd">'
    + '<div class="fin-card-title" style="margin:0;">Group health plan</div>'
    + '<div style="font-size:.78rem;color:var(--warm-gray);">Premiums are entered in <span class="fin-comp-link" onclick="finCompSetView(&quot;rates&quot;)">this year&#39;s rates</span>; here you choose the plan and who sits on which tier.</div>'
    + '</div>'
    + '<div class="fin-comp-plangrid">' + cards + '</div>'
    + table
    + finCompBreakevenHtml()
    + '<div class="fin-comp-cardfoot">'
    + '<button class="btn-secondary" onclick="finCompSetView(&quot;fairness&quot;)">&larr; Back to fairness</button>'
    + '<button class="btn-primary" onclick="finCompSetView(&quot;council&quot;)">Next: Council summary &rarr;</button>'
    + '</div></div>';
}
// The "is it worth it for the worker?" analysis, unchanged in maths (finComputePlanOOPCents,
// finComputeHealthPlanFamilyBreakevenCents, finComputeHealthPlanSingleClaimantDeltaCents,
// finHealthPlanEffectiveLoneClaimantTermsCents), now behind a disclosure instead of always open.
function finCompBreakevenHtml() {
  if (_finHealthPlanSelectedOption === 'renewal') return '';
  var calc = finComputeHealthPlanTotalCents(_finHealthPlanSelectedOption);
  var baseline = finComputeHealthPlanTotalCents('renewal');
  if (!calc || !baseline) return '';
  var perHouseholdDiffCents = finCompPerHouseholdDiffCents('renewal', _finHealthPlanSelectedOption);
  var renewalOpt = finHealthPlanResolvedOption('renewal'), selOpt = finHealthPlanResolvedOption(_finHealthPlanSelectedOption);
  var rate = HEALTH_PLAN_QUOTE_2027.coinsuranceRate;
  var renewalLone = finHealthPlanEffectiveLoneClaimantTermsCents('renewal'), selLone = finHealthPlanEffectiveLoneClaimantTermsCents(_finHealthPlanSelectedOption);
  var members = _finHealthFamilySize;
  function row(label, a, bb) {
    return '<tr><td style="padding:2px 6px;">' + label + '</td><td style="text-align:right;padding:2px 6px;">' + finCompMoney(a) + '</td><td style="text-align:right;padding:2px 6px;">' + finCompMoney(bb) + '</td></tr>';
  }
  var body = '', tableRows = '';
  if (perHouseholdDiffCents > 0) {
    var breakevenCents = finComputeHealthPlanFamilyBreakevenCents('renewal', _finHealthPlanSelectedOption, perHouseholdDiffCents);
    var single = finComputeHealthPlanSingleClaimantDeltaCents('renewal', _finHealthPlanSelectedOption, 100000000);
    if (breakevenCents != null) {
      tableRows += row('At the breakeven (' + finCompMoney(breakevenCents) + ' total cost of care, spread across ' + members + ' family members)',
        finComputeFamilyOOPCents(renewalOpt, rate, breakevenCents, members),
        finComputeFamilyOOPCents(selOpt, rate, breakevenCents, members));
    }
    tableRows += row('Worst case, costs spread across the family', renewalOpt.oopMaxFamilyCents, selOpt.oopMaxFamilyCents);
    tableRows += row('Worst case, one family member alone', renewalLone.oopMaxCents, selLone.oopMaxCents);
    body = 'The church fully covers Renewal; choosing this option means the worker personally pays the ' + finCompMoney(perHouseholdDiffCents) + '/yr extra premium. '
      + (breakevenCents != null
        ? 'If their household&#39;s costs are spread across 2+ family members, that extra premium pays them back once the household&#39;s <i>total cost of care for the year</i> (what providers bill &mdash; not what the family pays out of pocket, which stays capped well below this) reaches about <b>' + finCompMoney(breakevenCents) + '</b>.'
        : 'It never fully pays the worker back in reduced out-of-pocket costs at any level of care, even spread across the whole family.')
      + (single != null ? ' If one family member alone accounts for all the costs, this option ' + (single > 0 ? 'never breaks even &mdash; it costs them up to ' + finCompMoney(single) + ' more even in a worst-case year' : (single < 0 ? 'still comes out ahead by up to ' + finCompMoney(Math.abs(single)) + ' in a worst-case year' : 'comes out exactly even in a worst-case year')) + '.' : '');
  } else if (perHouseholdDiffCents < 0) {
    var familyWorstCaseCents = finComputeFamilyOOPCents(selOpt, rate, 100000000, members)
      - finComputeFamilyOOPCents(renewalOpt, rate, 100000000, members);
    tableRows += row('Worst case, costs spread across the family', renewalOpt.oopMaxFamilyCents, selOpt.oopMaxFamilyCents);
    tableRows += row('Worst case, one family member alone', renewalLone.oopMaxCents, selLone.oopMaxCents);
    body = 'The church fully covers Renewal; this cheaper option would save the worker ' + finCompMoney(Math.abs(perHouseholdDiffCents)) + '/yr in premium &mdash; guaranteed, claim or no claim. '
      + 'The tradeoff is a higher deductible/out-of-pocket max: in a worst-case year with costs spread across the family it could cost up to <b>' + finCompMoney(Math.abs(familyWorstCaseCents)) + (familyWorstCaseCents > 0 ? ' more' : ' less') + '</b> out of pocket than Renewal'
      + (Math.abs(familyWorstCaseCents) < Math.abs(perHouseholdDiffCents)
        ? ', which is smaller than the guaranteed premium saving &mdash; so even in a bad year this option comes out ahead for the worker.'
        : ', which is larger than the guaranteed premium saving &mdash; so a genuinely bad year could cost the worker more overall.');
  } else {
    return '';
  }
  // Shown only when it can actually change a figure — see finHealthFamilySizeMatters. Offering a
  // picker that provably cannot move any number is the control-that-does-nothing trap.
  var sizeMatters = finHealthFamilySizeMatters(renewalOpt) || finHealthFamilySizeMatters(selOpt);
  var sizePicker = sizeMatters
    ? '<div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
      + '<label style="font-size:.72rem;">Family members assumed <select onchange="finCompFamilySizeChange(this.value)"' + (finCompIsAdmin() ? '' : ' disabled') + '>'
      + [1,2,3,4,5,6].map(function(n) { return '<option value="' + n + '"' + (n === members ? ' selected' : '') + '>' + n + '</option>'; }).join('')
      + '</select></label>'
      + '<span style="font-size:.7rem;color:var(--warm-meta);max-width:520px;">On an <b>embedded</b> plan each member has their own limit inside the family one and starts paying coinsurance once they personally meet it, so how many people share the costs changes the total.</span></div>'
    : '<div style="margin-top:8px;font-size:.7rem;color:var(--warm-meta);max-width:560px;">The spread-across-the-family row assumes costs are shared rather than falling on one person. How many people share them makes no difference on these plans: every option sets the family deductible at exactly twice the single one, so two or more people always reach the pooled family limit at the same point. The two rows below therefore bracket the real range &mdash; costs shared, versus one member alone.</div>';
  return '<details class="fin-comp-details"><summary>Is it worth it for the worker?</summary>'
    + '<div style="padding:8px 2px 2px;font-size:.75rem;color:var(--warm-gray);">' + body + sizePicker
    + '<table style="width:100%;border-collapse:collapse;font-size:.72rem;margin-top:8px;max-width:520px;">'
    + '<thead><tr><th style="text-align:left;padding:2px 6px;">What the family would actually pay</th><th style="text-align:right;padding:2px 6px;">Renewal</th><th style="text-align:right;padding:2px 6px;">' + esc(selOpt.label) + '</th></tr></thead>'
    + '<tbody>' + tableRows + '</tbody></table></div></details>';
}

// ── View 4 — This year's rates ─────────────────────────────────────────────────────────────
function finCompRatesYear() { return _finCompRefYear == null ? _finPlanTargetYear : Number(_finCompRefYear); }
function finCompRefRow(year) { return _finSalaryReferenceByYear[year] || {}; }
function finCompRateInput(field, year, suffix, width) {
  var row = finCompRefRow(year);
  var raw = row[field];
  var shown = raw == null ? '' : (suffix === '%' ? finFmtPctInput(raw) : raw / 100);
  return '<span style="display:inline-flex;align-items:center;gap:3px;">'
    + (suffix === '$' ? '<span style="color:var(--warm-gray);font-weight:400;">$</span>' : '')
    + '<input type="text" inputmode="decimal" id="fin-comp-ref-' + field + '-' + year + '" value="' + shown + '" oninput="finCompRefChange(' + year + ',' + jsAttr(field) + ',finSanitizeDecimalInput(this))" style="width:' + (width || 110) + 'px;font-weight:700;">'
    + (suffix === '%' ? '<span style="color:var(--warm-gray);font-weight:400;">%</span>' : '') + '</span>';
}
function finCompRenderRates() {
  var year = finCompRatesYear();
  var refRow = finCompRefRow(year);
  var baseInfo = finCompBaseSalary(year);
  var prevBase = finCompBaseSalary(year - 1);
  var thisBaseEntered = refRow.baseSalaryCents != null;
  var historyYears = Object.keys(LCMS_MO_BASE_SALARY_BY_YEAR).map(Number)
    .concat(Object.keys(_finSalaryReferenceByYear).map(Number))
    .filter(function(y, i, a) { return a.indexOf(y) === i && isFinite(y); }).sort(function(a, b) { return a - b; });
  var chips = historyYears.map(function(y) {
    var v = finCompBaseSalary(y);
    var on = y === year;
    return '<span class="fin-comp-histchip' + (on ? ' active' : '') + '">' + y + ' &middot; ' + (v.dollars ? '$' + finFmtMoney(v.dollars) : 'not set') + '</span>';
  }).join('');
  var cagr = finLcmsHistoricalAvgGrowthPct();
  var yearOptions = [_finPlanBaseYear, _finPlanTargetYear, _finPlanTargetYear + 1].filter(function(y, i, a) { return a.indexOf(y) === i; }).map(function(y) {
    var known = finCompBaseSalary(y);
    return '<option value="' + y + '"' + (y === year ? ' selected' : '') + '>FY' + y + (known.exact ? '' : ' (not yet published)') + '</option>';
  }).join('');
  var changeFmt = (thisBaseEntered || baseInfo.exact) && prevBase.dollars
    ? finCompMoneySigned(Math.round((baseInfo.dollars - prevBase.dollars) * 100)) + ' (' + ((baseInfo.dollars - prevBase.dollars) / prevBase.dollars * 100).toFixed(2) + '%)'
    : '&mdash;';
  var districtCard = '<div class="fin-card">'
    + '<div class="fin-card-title" style="font-size:20px;">District guidelines</div>'
    + '<div class="fin-card-sub">LCMS Missouri District, FY' + year + '. Only the base salary changes each year &mdash; the role, education and experience multiplier tables stay fixed.</div>'
    + '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;">'
    + '<label class="fin-comp-reflabel">Base salary, FY' + year + finCompRateInput('baseSalaryCents', year, '$', 130) + '</label>'
    + '<div class="fin-comp-reflabel">Change from last year<span style="font-size:.92rem;font-weight:700;color:var(--charcoal);padding:7px 0;font-variant-numeric:tabular-nums;">' + changeFmt + '</span></div>'
    + '</div>'
    // Never silently substitute (§5.7). Three states, deliberately distinct: an entered figure
    // says nothing; a year the published table already covers gets a neutral note (it is a real
    // district figure, just one shipped with the app rather than typed in); only a genuine
    // carry-forward from an earlier year gets the amber warning.
    + (thisBaseEntered ? ''
        : baseInfo.exact
          ? '<div class="fin-comp-note" style="margin-top:10px;">Nothing entered for FY' + year + ' &mdash; using the published district figure already on file, $' + finFmtMoney(baseInfo.dollars) + '. Type this year&#39;s paper in above to override it.</div>'
          : '<div class="fin-comp-warn">No figure entered for FY' + year + ' yet &mdash; the planner is carrying $' + finFmtMoney(baseInfo.dollars) + ' forward from FY' + baseInfo.sourceYear + '. Enter the real number as soon as the district paper arrives.</div>')
    + '<div style="margin-top:12px;"><div class="fin-comp-reflabel-hd">Base salary history</div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">' + chips + '</div>'
    + '<div style="font-size:.74rem;color:var(--warm-gray);margin-top:6px;">Averages ' + (cagr * 100).toFixed(2) + '%/yr since ' + historyYears[0] + '.</div></div>'
    + '<label class="fin-comp-reflabel" style="margin-top:12px;">Source document'
    + '<input type="text" id="fin-comp-ref-districtSource-' + year + '" value="' + esc(refRow.districtSource || '') + '" placeholder="' + esc(finCompSourceDoc('districtSource')) + '" oninput="finCompRefTextChange(' + year + ',&quot;districtSource&quot;,this.value)" style="width:100%;font-weight:400;">'
    + '</label></div>';
  var concordiaCard = '<div class="fin-card">'
    + '<div class="fin-card-title" style="font-size:20px;">Concordia Plans rates</div>'
    + '<div class="fin-card-sub">Percentages of salary, the same for every worker. From the church&#39;s own participation overview.</div>'
    + '<div class="fin-comp-rategrid">'
    + '<label class="fin-comp-reflabel">Pension (Traditional)' + finCompRateInput('pensionPct', year, '%', 100) + '</label>'
    + '<label class="fin-comp-reflabel">Employer FICA' + finCompRateInput('ficaPct', year, '%', 100) + '</label>'
    + '<label class="fin-comp-reflabel">Disability &mdash; with dependents' + finCompRateInput('disabilityDepsPct', year, '%', 100) + '</label>'
    + '<label class="fin-comp-reflabel">Disability &mdash; without' + finCompRateInput('disabilityNoDepsPct', year, '%', 100) + '</label>'
    + '<label class="fin-comp-reflabel">Social Security COLA' + finCompRateInput('ssaColaPct', year, '%', 100) + '</label>'
    + '<label class="fin-comp-reflabel">Health opt-out cash' + finCompRateInput('healthOptOutCents', year, '$', 100) + '</label>'
    + '</div>'
    + '<div style="font-size:.76rem;color:var(--warm-gray);margin-top:10px;">Announced each autumn for the following year &mdash; the Social Security COLA in October, the Concordia Plans rates with the renewal packet. Blank uses '
    + 'pension ' + finCompPctFmt(finConcordiaPensionRateFor(year).rate) + ', FICA ' + finCompPctFmt(LCMS_EMPLOYER_FICA_RATE) + ', disability ' + finCompPctFmt(finConcordiaDisabilityRateFor(year, true).rate) + '/' + finCompPctFmt(finConcordiaDisabilityRateFor(year, false).rate) + ', COLA ' + finCompPctFmt(SSA_COLA_REFERENCE_PCT) + '.</div>'
    + '<label class="fin-comp-reflabel" style="margin-top:12px;">Source document'
    + '<input type="text" id="fin-comp-ref-concordiaSource-' + year + '" value="' + esc(refRow.concordiaSource || '') + '" placeholder="' + esc(finCompSourceDoc('concordiaSource')) + '" oninput="finCompRefTextChange(' + year + ',&quot;concordiaSource&quot;,this.value)" style="width:100%;font-weight:400;">'
    + '</label></div>';
  // Typed the way Concordia publishes it: one MONTHLY rate per coverage tier, per plan option. The
  // enrollment count beside each tier is read off the roster, not typed — it is the same thing as
  // the count column on the packet's own Enrollment and Rates block, and letting it be typed twice
  // is how the two quietly stop agreeing.
  var liveCounts = finCompEnrollmentCounts();
  var quoteRows = FIN_COMP_PLAN_KEYS.map(function(key) {
    var calc = finComputeHealthPlanTotalCents(key, null, liveCounts);
    function box(field, width) {
      var ov = (_finHealthPlanPremiumOverrides[key] || {})[field];
      return '<input type="text" inputmode="decimal" id="fin-comp-quote-' + key + '-' + field + '" value="' + (ov != null ? (ov / 100) : '') + '" placeholder="' + (HEALTH_PLAN_QUOTE_2027.options[key][field] / 100).toFixed(2) + '" oninput="finCompQuoteChange(' + jsAttr(key) + ',' + jsAttr(field) + ',finSanitizeDecimalInput(this))" style="width:' + width + 'px;text-align:right;">';
    }
    var tierBoxes = FIN_HEALTH_TIERS.map(function(t) {
      var ov = ((_finHealthPlanPremiumOverrides[key] || {}).tiersMonthlyCents || {})[t.key];
      var quoted = (HEALTH_PLAN_QUOTE_2027.options[key].tiersMonthlyCents || {})[t.key];
      return '<td class="fin-comp-td num"><input type="text" inputmode="decimal" id="fin-comp-tier-' + key + '-' + t.key + '" value="' + (ov != null ? (ov / 100) : '') + '" placeholder="' + (quoted == null ? '' : (quoted / 100).toFixed(2)) + '" oninput="finCompTierRateChange(' + jsAttr(key) + ',' + jsAttr(t.key) + ',finSanitizeDecimalInput(this))" style="width:88px;text-align:right;"></td>';
    }).join('');
    return '<tr' + (key === _finHealthPlanSelectedOption ? ' class="fin-comp-quote-active"' : '') + '>'
      + '<td class="fin-comp-td"><div style="font-weight:700;color:var(--color-navy);">' + esc(calc.label) + '</div><div style="font-size:.72rem;color:var(--warm-gray);">' + FIN_COMP_PLAN_TAGS[key] + '</div><div style="margin-top:3px;">' + finHealthEmbeddedBadge(key) + '</div></td>'
      + tierBoxes
      + '<td class="fin-comp-td num">' + box('dentalCents', 86) + '</td>'
      + '<td class="fin-comp-td num">' + box('visionCents', 86) + '</td>'
      + '<td class="fin-comp-td num">' + box('deductibleIndividualCents', 82) + '</td>'
      + '<td class="fin-comp-td num">' + box('deductibleFamilyCents', 82) + '</td>'
      + '<td class="fin-comp-td num">' + box('oopMaxIndividualCents', 82) + '</td>'
      + '<td class="fin-comp-td num">' + box('oopMaxFamilyCents', 82) + '</td>'
      + '<td class="fin-comp-td num" style="font-weight:700;">' + finCompMoneyCents(calc.monthlyCents) + '</td>'
      + '<td class="fin-comp-td num" style="font-weight:700;">' + finCompMoney(calc.totalCents) + '</td></tr>';
  }).join('');
  var enrolCells = FIN_HEALTH_TIERS.map(function(t) {
    return '<td class="fin-comp-td num" style="font-weight:700;color:var(--color-navy);">' + liveCounts[t.key] + '</td>';
  }).join('');
  var quoteCard = '<div class="fin-card">'
    + '<div class="fin-comp-cardhd">'
    + '<div><div class="fin-card-title" style="font-size:20px;margin:0;">Health plan quote, FY' + year + '</div>'
    + '<div class="fin-card-sub" style="margin:0;">Type the renewal packet&#39;s Enrollment and Rates block straight in &mdash; one <b>monthly</b> rate per coverage tier, per option. Dental and vision are not tier-priced in the packet, so they stay annual figures for the whole group and are shared evenly across whoever is enrolled. Total monthly is the packet&#39;s own Total Monthly Cost (medical only, at the enrollment below); total annual adds dental and vision. Who sits on which tier is set per worker in step 1.</div></div>'
    + '<div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">'
    + '<label class="fin-comp-reflabel">Quote reference<input type="text" id="fin-comp-ref-quoteSource-' + year + '" value="' + esc(finCompRefRow(year).quoteSource || '') + '" placeholder="' + esc(finCompSourceDoc('quoteSource')) + '" oninput="finCompRefTextChange(' + year + ',&quot;quoteSource&quot;,this.value)" style="width:260px;font-weight:400;"></label>'
    + '</div></div>'
    + '<div style="overflow-x:auto;"><table class="fin-comp-table" style="min-width:1320px;">'
    + '<thead><tr><th class="fin-comp-th">Plan option</th>'
    + FIN_HEALTH_TIERS.map(function(t) { return '<th class="fin-comp-th num">' + esc(t.label) + ' / mo</th>'; }).join('')
    + '<th class="fin-comp-th num">Dental / yr<br><span style="font-weight:400;text-transform:none;">per worker</span></th><th class="fin-comp-th num">Vision / yr<br><span style="font-weight:400;text-transform:none;">per worker</span></th>'
    + '<th class="fin-comp-th num">Deductible &mdash; single</th><th class="fin-comp-th num">Deductible &mdash; family</th>'
    + '<th class="fin-comp-th num">Out-of-pocket max &mdash; single</th><th class="fin-comp-th num">Out-of-pocket max &mdash; family</th>'
    + '<th class="fin-comp-th num">Total monthly</th><th class="fin-comp-th num">Total annual</th></tr></thead>'
    + '<tbody>' + quoteRows
    + '<tr class="fin-comp-total-row"><td class="fin-comp-td">Enrolled now</td>' + enrolCells
    + '<td class="fin-comp-td" colspan="7" style="font-size:.74rem;font-weight:400;color:var(--warm-gray);">Counted from the roster &mdash; change a worker&#39;s tier in step 1. Cash-only workers are below the hours floor and are not contracts.</td>'
    + '<td class="fin-comp-td num">' + finCompEnrolledCount() + ' contract' + (finCompEnrolledCount() === 1 ? '' : 's') + '</td></tr>'
    + '</tbody></table></div>'
    + '<div style="font-size:.72rem;color:var(--warm-gray);margin-top:6px;max-width:940px;"><b>Embedded</b> &mdash; each family member has their own limit inside the family limit; no one member contributes more than the single figure toward the family deductible, and once they meet it they start paying coinsurance even if the family deductible has not been met. <b>Non-embedded</b> &mdash; one true family deductible with no individual limits: members pool expenses and one person can pay the full family amount alone. On a non-embedded option the single figures below apply to a <i>self-only contract</i>, not as a per-person cap inside family coverage.</div>'
    + '<div class="fin-comp-bar mist"><span style="font-weight:700;color:var(--color-navy);">Plan the church covers in full:</span>'
    + '<span style="display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap;"><select onchange="finCompPickPlan(this.value)"' + (finCompIsAdmin() ? '' : ' disabled') + '>'
    + FIN_COMP_PLAN_KEYS.map(function(k) { var c = finComputeHealthPlanTotalCents(k); return '<option value="' + k + '"' + (k === _finHealthPlanSelectedOption ? ' selected' : '') + '>' + esc(c.label) + ' &middot; ' + finCompMoney(c.totalCents) + '</option>'; }).join('')
    + '</select><span style="font-size:.78rem;color:var(--warm-gray);">Anyone choosing another option pays the difference themselves.</span></span></div>'
    + '</div>';
  var marketCard = '<div class="fin-card">'
    + '<div class="fin-comp-cardhd">'
    + '<div><div class="fin-card-title" style="font-size:20px;margin:0;">Market comparison data</div>'
    + '<div class="fin-card-sub" style="margin:0;">Run Concordia Plans&#39; Compensation Decision Support Tool once a year per worker and type the four ranges in here &mdash; there is no feed for it. These are what step 2 charts against. The District pair only prints on a pastor report; leave it blank otherwise.</div></div>'
    + '<a href="https://tc.cbiz.com/CompToolCPS/Login" target="_blank" rel="noopener" style="font-size:.78rem;font-weight:700;">Open the Compensation Decision Support Tool &rarr;</a></div>'
    + _finSalaryRoster.map(function(w, i) {
        var c = w.concordia || {};
        var onFile = finCompUsableRanges(w).length;
        var rangeRows = FIN_CONCORDIA_RANGE_KEYS.map(function(r) {
          function box(part) {
            return '<input type="text" id="fin-comp-range-' + i + '-' + r.key + part + '" value="' + esc(c[r.key + part] == null ? '' : c[r.key + part]) + '" placeholder="&mdash;" oninput="finCompRangeChange(' + i + ',' + jsAttr(r.key + part) + ',this.value)" style="width:100px;text-align:right;">';
          }
          return '<tr' + (/LCMS/i.test(r.label) ? ' class="fin-comp-lcms-row"' : '') + '>'
            + '<td class="fin-comp-td" style="color:var(--warm-ink-label);font-weight:600;">' + esc(r.label) + '</td>'
            + '<td class="fin-comp-td num">' + box('Low') + '</td>'
            + '<td class="fin-comp-td num">' + box('Mid') + '</td>'
            + '<td class="fin-comp-td num">' + box('High') + '</td></tr>';
        }).join('');
        return '<div class="fin-comp-fairblock">'
          + '<div style="display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;">'
          + '<span style="font-size:.95rem;font-weight:700;color:var(--color-navy);min-width:150px;">' + esc(w.name || '(unnamed)') + '</span>'
          + '<label class="fin-comp-reflabel">Position on the report<input type="text" id="fin-comp-cpos-' + i + '" value="' + esc(c.position || '') + '" oninput="finCompRangeChange(' + i + ',&quot;position&quot;,this.value)" style="width:300px;font-weight:400;"></label>'
          + '<label class="fin-comp-reflabel">Report date<input type="text" id="fin-comp-cdate-' + i + '" value="' + esc(c.asOfDate || '') + '" placeholder="mm/dd/yyyy" oninput="finCompRangeChange(' + i + ',&quot;asOfDate&quot;,this.value)" style="width:110px;font-weight:400;"></label>'
          + '<span style="font-size:.74rem;font-weight:600;padding-bottom:6px;color:' + (onFile ? 'var(--sage-text)' : 'var(--deep-amber)') + ';">'
          + (onFile ? onFile + ' of 4 ranges on file' : 'No report on file &mdash; compared to the District Compensation Worksheet only') + '</span>'
          + '</div>'
          + '<div style="overflow-x:auto;"><table class="fin-comp-table" style="min-width:560px;">'
          + '<thead><tr><th class="fin-comp-th">Range</th><th class="fin-comp-th num">Lower pay</th><th class="fin-comp-th num">Midpoint pay</th><th class="fin-comp-th num">Higher pay</th></tr></thead>'
          + '<tbody>' + rangeRows + '</tbody></table></div></div>';
      }).join('')
    + '<div style="font-size:.74rem;color:var(--warm-gray);margin-top:10px;">The LCMS row (shaded) is the one the fairness verdicts are measured against &mdash; it is the LCMS-only comparison, so it is the fairest single yardstick for a called worker.</div>'
    + '</div>';
  return '<div style="display:flex;flex-direction:column;gap:16px;">'
    + '<div class="fin-comp-ratesbanner">'
    + '<div><div style="font-size:.9rem;font-weight:700;color:var(--warm-ink-label);">Everything that changes once a year lives here.</div>'
    + '<div style="font-size:.78rem;color:var(--warm-meta);">Enter each new paper as it arrives; every figure on the other tabs recomputes. Nothing here is per-worker.</div></div>'
    + '<div style="display:flex;align-items:center;gap:8px;"><span class="fin-comp-reflabel-hd">Rates for</span>'
    + '<select class="fin-comp-yearsel" onchange="finCompRatesYearChange(this.value)">' + yearOptions + '</select></div>'
    + '</div>'
    + finCompReadOnly('<div class="fin-comp-ratesgrid">' + districtCard + concordiaCard + '</div>' + quoteCard + marketCard)
    + '</div>';
}

// What the one "Benefits & taxes" figure is actually made of. Pure — no DOM. The four components
// are exactly the ones finCompBenefits sums, so the parts always reconcile to the tile above them;
// a breakdown that doesn't add up to the total on the same screen is worse than none. Counts come
// with each line because the interesting question at a council meeting is usually "how many people
// is that covering", and because a $0 line reads as an error unless it says nobody is on it.
function finCompBenefitBreakdown(computed) {
  var entries = finCompCountedEntries();
  function sum(pick) { return entries.reduce(function(t, e) { return t + pick(computed[e.i].benefits); }, 0); }
  function count(test) { return entries.reduce(function(t, e) { return t + (test(computed[e.i].benefits, e.w) ? 1 : 0); }, 0); }
  var rows = [
    { key: 'pension', label: 'Pension &mdash; Concordia Retirement Plan',
      note: finCompPctFmt(finCompPensionRate(_finPlanTargetYear).rate) + ' of cash salary',
      cents: sum(function(b) { return b.pensionCents; }),
      people: count(function(b) { return b.pensionCents > 0; }) },
    { key: 'health', label: 'Health plan',
      note: 'group premium, opt-out cash and hand-entered employee-only premiums combined',
      cents: sum(function(b) { return b.healthCents; }),
      people: count(function(b) { return b.healthCents > 0; }) },
    { key: 'disability', label: 'Disability &amp; survivor',
      note: finCompPctFmt(finCompDisabilityRate(_finPlanTargetYear, false).rate) + ' of cash salary, '
        + finCompPctFmt(finCompDisabilityRate(_finPlanTargetYear, true).rate) + ' with dependents',
      cents: sum(function(b) { return b.disabilityCents; }),
      people: count(function(b) { return b.disabilityCents > 0; }) },
    { key: 'fica', label: 'Employer FICA',
      note: finCompPctFmt(finCompFicaRate()) + ' of cash salary; a minister pays their own SECA instead',
      cents: sum(function(b) { return b.ficaCents; }),
      people: count(function(b) { return b.ficaCents > 0; }) }
  ];
  return {
    rows: rows,
    totalCents: rows.reduce(function(t, r) { return t + r.cents; }, 0),
    // Not a church cost and in no total — carried so the page can say so rather than leave a
    // reader wondering why the ministers' FICA line looks short.
    secaSelfCents: entries.reduce(function(t, e) {
      return t + (e.w.selfEmployedFica ? computed[e.i].benefits.secaSelfCents : 0);
    }, 0),
    countedCount: entries.length
  };
}
// Names who is being left out and why, wherever a total could otherwise look short. Also states
// the one thing the flag deliberately does not touch — the FY base-year comparison, which is read
// off the church's real payroll accounts, not off this roster.
function finCompExcludedNote() {
  var ex = finCompExternallyFundedWorkers();
  if (!ex.length) return '';
  return '<div style="font-size:.74rem;color:var(--warm-gray);margin-top:6px;">Not counted above: '
    + ex.map(function(w) { return '<b style="color:var(--charcoal);">' + esc(w.name || '(unnamed)') + '</b>' + (w.position ? ' (' + esc(w.position) + ')' : ''); }).join(', ')
    + ' &mdash; paid from another budget. Their salary and every employer cost on it sit in that section, not this one. The FY' + _finPlanBaseYear
    + ' comparison figure is still read from the church payroll accounts as they stand, so if any of that pay runs through those accounts it is in the comparison but not in the FY' + _finPlanTargetYear + ' plan.</div>';
}
function finCompRenderBenefitBreakdown(computed, totals) {
  var bd = finCompBenefitBreakdown(computed);
  var rows = bd.rows.map(function(r) {
    var share = bd.totalCents ? Math.round(r.cents / bd.totalCents * 100) : 0;
    return '<tr class="fin-comp-row"><td class="fin-comp-td"><div style="font-weight:700;">' + r.label + '</div>'
      + '<div style="font-size:.74rem;color:var(--warm-gray);">' + r.note + '</div></td>'
      + '<td class="fin-comp-td num" style="color:var(--warm-gray);">' + r.people + ' of ' + bd.countedCount + '</td>'
      + '<td class="fin-comp-td num" style="font-weight:700;">' + finCompMoney(r.cents) + '</td>'
      + '<td class="fin-comp-td num" style="color:var(--warm-gray);">' + share + '%</td></tr>';
  }).join('');
  return '<div style="margin-top:22px;">'
    + '<div style="font-weight:700;font-size:1rem;color:var(--color-navy);margin-bottom:2px;">What makes up ' + finCompMoney(totals.benefitsCents) + ' of benefits &amp; taxes</div>'
    + '<div style="font-size:.74rem;color:var(--warm-gray);margin-bottom:8px;">Every employer cost on top of cash salary, across the ' + bd.countedCount + ' worker' + (bd.countedCount === 1 ? '' : 's') + ' this budget carries. These four lines are the whole of it &mdash; they add to the Benefits &amp; taxes figure above.</div>'
    + '<div style="overflow-x:auto;"><table class="fin-comp-table" style="min-width:620px;font-size:.86rem;">'
    + '<thead><tr><th class="fin-comp-th">Cost</th><th class="fin-comp-th num">Workers</th><th class="fin-comp-th num">FY' + _finPlanTargetYear + '</th><th class="fin-comp-th num">Share</th></tr></thead>'
    + '<tbody>' + rows
    + '<tr class="fin-comp-total-row"><td class="fin-comp-td">Total benefits &amp; taxes</td><td class="fin-comp-td"></td>'
    + '<td class="fin-comp-td num">' + finCompMoney(bd.totalCents) + '</td><td class="fin-comp-td num">100%</td></tr>'
    + '</tbody></table></div>'
    + finCompExcludedNote()
    + (bd.secaSelfCents ? '<div style="font-size:.74rem;color:var(--warm-gray);margin-top:6px;">Ministers pay the employer half of Social Security themselves &mdash; ' + finCompMoney(bd.secaSelfCents) + ' at these salaries. That is their cost, not the church&#39;s, and is in no figure above.</div>' : '')
    + '</div>';
}
// ── View 5 — Council summary ───────────────────────────────────────────────────────────────
function finCompCouncilRows(computed) {
  return _finSalaryRoster.map(function(w, i) {
    var c = computed[i];
    var delta = c.salaryCents - c.currentCents;
    var lcms = finCompLcmsRange(w);
    var vsScale = finCompVsScale(c.salaryCents, c.worksheetCents);
    // Concordia's published ranges are full-time figures. Holding a 20%-time wage against one
    // would print an alarming red number that means nothing, so a part-timer's median comparison
    // is suppressed rather than computed.
    var vsMed = finCompIsPartTime(w)
      ? { text: 'part-time &mdash; not comparable', color: 'var(--warm-gray)' }
      : finCompVsMedian(c.salaryCents, lcms && lcms.midCents);
    // An externally funded worker still gets a row — the point of the flag is that their pay stays
    // visible — but their figures are grayed and in no total, and the scale/median columns are
    // blanked rather than filled with a comparison this budget is not making.
    if (finCompIsExternallyFunded(w)) {
      return '<tr class="fin-comp-row" style="color:var(--warm-gray);"><td class="fin-comp-td"><div style="font-weight:700;">' + esc(w.name || '(unnamed)') + '</div>'
        + '<div style="font-size:.74rem;">' + esc(w.position || '') + ' &middot; <span style="color:var(--deep-amber);font-weight:700;">paid from another budget</span></div></td>'
        + '<td class="fin-comp-td num">' + finCompMoney(c.currentCents) + '</td>'
        + '<td class="fin-comp-td num">' + finCompMoney(c.salaryCents) + '</td>'
        + '<td class="fin-comp-td num">&mdash;</td>'
        + '<td class="fin-comp-td" colspan="2" style="font-size:.78rem;">Costed in another section &mdash; in no total here</td>'
        + '<td class="fin-comp-td num">&mdash;</td></tr>';
    }
    return '<tr class="fin-comp-row"><td class="fin-comp-td"><div style="font-weight:700;">' + esc(w.name || '(unnamed)') + '</div>'
      + '<div style="font-size:.74rem;color:var(--warm-gray);">' + esc(w.position || '')
      + (finCompIsPartTime(w) ? ' &middot; ' + finCompFtePct(w) + '% time' : '') + '</div></td>'
      + '<td class="fin-comp-td num" style="color:var(--warm-gray);">' + finCompMoney(c.currentCents) + '</td>'
      + '<td class="fin-comp-td num" style="font-weight:700;">' + finCompMoney(c.salaryCents) + '</td>'
      + '<td class="fin-comp-td num">' + (delta === 0 ? 'no change' : finCompMoneySigned(delta)) + '</td>'
      + '<td class="fin-comp-td" style="font-size:.78rem;font-weight:600;color:' + vsScale.color + ';" title="District scale ' + (c.worksheetCents ? finCompMoney(c.worksheetCents) : 'not available') + '">' + vsScale.text + '</td>'
      + '<td class="fin-comp-td" style="font-size:.78rem;font-weight:600;color:' + vsMed.color + ';" title="LCMS market median ' + (lcms && lcms.midCents ? finCompMoney(lcms.midCents) : 'no report') + '">' + vsMed.text + '</td>'
      + '<td class="fin-comp-td num" style="font-weight:700;">' + finCompMoney(c.churchCostCents) + '</td></tr>';
  }).join('');
}
function finCompRenderCouncil(computed, totals) {
  var pct = totals.baselineCents ? (totals.deltaCents / totals.baselineCents * 100) : null;
  var scaleTotal = finCompVsScale(totals.salaryCents, totals.worksheetCents);
  var medTotal = finCompMedianTotal(computed);
  var salaryDelta = totals.salaryCents - totals.currentCents;
  return '<div class="fin-card" style="padding:28px 32px;">'
    + '<div class="fin-comp-cardhd">'
    + '<div><div class="fin-card-title" style="font-size:26px;margin:0;">FY' + _finPlanTargetYear + ' Compensation &mdash; Council summary</div>'
    + '<div class="fin-card-sub" style="margin:0;">' + finCompMethodSummary() + '</div></div>'
    + '<button class="btn-secondary" onclick="finCompPrintCouncil()">Print</button></div>'
    + '<div class="fin-comp-counciltiles">'
    + '<div class="fin-comp-ctile"><span class="fin-comp-tile-lbl">Cash salaries</span><span class="fin-comp-ctile-val">' + finCompMoney(totals.salaryCents) + '</span></div>'
    + '<div class="fin-comp-ctile"><span class="fin-comp-tile-lbl">Benefits &amp; taxes</span><span class="fin-comp-ctile-val">' + finCompMoney(totals.benefitsCents) + '</span></div>'
    + '<div class="fin-comp-ctile mist"><span class="fin-comp-tile-lbl teal">FY' + _finPlanTargetYear + ' total</span><span class="fin-comp-ctile-val">' + finCompMoney(totals.totalCents) + '</span></div>'
    + '<div class="fin-comp-ctile navy"><span class="fin-comp-tile-lbl">vs FY' + _finPlanBaseYear + ' ' + finCompMoney(totals.baselineCents) + '</span>'
    + '<span class="fin-comp-ctile-val gold">' + (totals.baselineCents ? finCompMoneySigned(totals.deltaCents) + ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%)' : '&mdash;') + '</span></div>'
    + '</div>'
    + '<div style="overflow-x:auto;"><table class="fin-comp-table" style="min-width:860px;font-size:.86rem;">'
    + '<thead><tr><th class="fin-comp-th">Worker</th><th class="fin-comp-th num">FY' + _finPlanBaseYear + '</th><th class="fin-comp-th num">FY' + _finPlanTargetYear + '</th>'
    + '<th class="fin-comp-th num">Change</th><th class="fin-comp-th">Vs. district scale</th><th class="fin-comp-th">Vs. LCMS median</th><th class="fin-comp-th num">Total cost</th></tr></thead>'
    + '<tbody>' + finCompCouncilRows(computed)
    + '<tr class="fin-comp-total-row"><td class="fin-comp-td">Total</td>'
    + '<td class="fin-comp-td num" style="color:var(--warm-gray);">' + finCompMoney(totals.currentCents) + '</td>'
    + '<td class="fin-comp-td num">' + finCompMoney(totals.salaryCents) + '</td>'
    + '<td class="fin-comp-td num">' + (salaryDelta === 0 ? 'no change' : finCompMoneySigned(salaryDelta)) + '</td>'
    + '<td class="fin-comp-td" style="font-size:.78rem;font-weight:600;color:' + scaleTotal.color + ';" title="District scale ' + finCompMoney(totals.worksheetCents) + '">' + scaleTotal.text + '</td>'
    + '<td class="fin-comp-td" style="font-size:.78rem;font-weight:600;color:' + medTotal.color + ';" title="LCMS market median ' + finCompMoney(medTotal.medCents) + '">' + medTotal.text + '</td>'
    + '<td class="fin-comp-td num">' + finCompMoney(totals.totalCents) + '</td></tr>'
    + '</tbody></table></div>'
    + finCompRenderBenefitBreakdown(computed, totals)
    + '<div style="font-size:.78rem;color:var(--warm-gray);border-top:1px solid var(--warm-row-divider);padding-top:14px;margin-top:14px;">Built on '
    + esc(finCompSourceDoc('districtSource')) + ' &middot; ' + esc(finCompSourceDoc('concordiaSource')) + ' &middot; ' + esc(finCompSourceDoc('quoteSource')) + '</div>'
    + '</div>';
}

// ── Interactions (§7.1). Every one of them ends in finRerenderPlanningPreserveFocus(), which
// re-renders, restores focus/caret/scroll AND schedules the existing ~800ms debounced autosave —
// the reported bug was that nothing on this tab autosaved at all.
function finCompApplyMethodToAll(key) {
  _finCompMethod = key;
  _finCompPerWorkerMethod = {};
  _finCompOverrides = {};
  finCompSay(finCompMethodLabel(key) + ' applied to all ' + finCompCountedCount() + ' worker' + (finCompCountedCount() === 1 ? '' : 's') + '.');
  finRerenderPlanningPreserveFocus();
}
function finCompPickMethod(i, key) {
  _finCompPerWorkerMethod[i] = key;
  delete _finCompOverrides[i];
  _finCompSelected = i;
  var w = _finSalaryRoster[i];
  finCompSay((w.name || 'Worker ' + (i + 1)) + ' → ' + finCompMethodLabel(key) + ' (' + finCompMoney(finCompMethodSalaryCents(w, key)) + ').');
  finRerenderPlanningPreserveFocus();
}
function finCompSelectWorker(i) { _finCompSelected = i; _finCompDrawerOpen = true; finRerenderPlanningPreserveFocus(); }
function finCompCloseDrawer() { _finCompDrawerOpen = false; finRerenderPlanningPreserveFocus(); }
function finCompAddWorker() {
  _finSalaryRoster.push({
    name: 'New staff member', position: 'Role not set', role: 'other', trackKey: 'secretary',
    yearsExperience: 0, responsibilityStipend: 0, responsibilityStipendKey: 'none', attendanceBonus: 0,
    education: 'none', selfEmployedFica: false, hasDependents: false, healthMode: 'optout',
    healthEnrolled: false, accountCode: '', ftePct: 100, cashOnly: false, concordia: {}
  });
  _finCompSelected = _finSalaryRoster.length - 1;
  _finCompDrawerOpen = true;
  _finCompView = 'plan';
  finCompSay('Row added — set the role and years of service in the panel.');
  finRerenderPlanningPreserveFocus();
}
function finCompRemoveWorker(i) {
  var name = _finSalaryRoster[i] && _finSalaryRoster[i].name;
  _finSalaryRoster.splice(i, 1);
  // Per-worker method/override maps are keyed by roster INDEX, so a splice would silently shift
  // every later worker's settings onto their neighbor. Rebuild both against the new indexes.
  var method = {}, ov = {};
  Object.keys(_finCompPerWorkerMethod).forEach(function(k) { var n = Number(k); if (n < i) method[n] = _finCompPerWorkerMethod[k]; else if (n > i) method[n - 1] = _finCompPerWorkerMethod[k]; });
  Object.keys(_finCompOverrides).forEach(function(k) { var n = Number(k); if (n < i) ov[n] = _finCompOverrides[k]; else if (n > i) ov[n - 1] = _finCompOverrides[k]; });
  _finCompPerWorkerMethod = method;
  _finCompOverrides = ov;
  if (_finCompSelected >= _finSalaryRoster.length) _finCompSelected = Math.max(0, _finSalaryRoster.length - 1);
  finCompSay((name || 'Worker') + ' removed.');
  finRerenderPlanningPreserveFocus();
}
function finCompWorkerChange(i, field, value) {
  _finSalaryRoster[i][field] = value;
  finRerenderPlanningPreserveFocus();
}
function finCompYearsChange(i, value) {
  _finSalaryRoster[i].yearsExperience = Math.max(0, parseInt(value, 10) || 0);
  finRerenderPlanningPreserveFocus();
}
// Changing role resets the track to that role's default and zeroes the attendance bonus for a
// non-pastor (§7.1); the SECA default follows the role's IRS classification, still overridable.
function finCompRoleChange(i, role) {
  var w = _finSalaryRoster[i];
  w.role = role;
  w.trackKey = role === 'commissioned' ? 'ma' : role === 'other' ? 'secretary' : '';
  if (role !== 'pastor') w.attendanceBonus = 0;
  w.selfEmployedFica = finDefaultSelfEmployedFica(role);
  finRerenderPlanningPreserveFocus();
}
function finCompStipendChange(i, key) {
  var s = LCMS_RESPONSIBILITY_STIPENDS.filter(function(x) { return x.key === key; })[0];
  _finSalaryRoster[i].responsibilityStipendKey = key;
  _finSalaryRoster[i].responsibilityStipend = s ? (s.range[0] + s.range[1]) / 2 : 0;
  finRerenderPlanningPreserveFocus();
}
function finCompStipendPctChange(i, value) {
  _finSalaryRoster[i].responsibilityStipend = (parseFloat(value) || 0) / 100;
  finRerenderPlanningPreserveFocus();
}
function finCompAttendanceChange(i, value) {
  _finSalaryRoster[i].attendanceBonus = parseFloat(value) || 0;
  finRerenderPlanningPreserveFocus();
}
// Dependents drives the disability rate and, for an enrolled worker, whether they draw from the
// group Family-tier quote or need an employee-only premium entered (§7.1).
function finCompDependentsToggle(i, checked) {
  var w = _finSalaryRoster[i];
  w.hasDependents = !!checked;
  // It no longer moves anyone between coverage tiers. When there were only two (Family / Employee
  // only) a dependents flag implied the tier; with the four Concordia prices it does not — Self &
  // Spouse and Self & Child are both "has dependents" and are priced differently — so inferring one
  // would silently overwrite a tier the admin chose. Dependents now only drives the disability rate.
  finRerenderPlanningPreserveFocus();
}
function finCompFteChange(i, value) {
  var pct = parseFloat(value);
  _finSalaryRoster[i].ftePct = (isFinite(pct) && pct > 0) ? Math.min(100, pct) : 100;
  finRerenderPlanningPreserveFocus();
}
function finCompCashOnlyToggle(i, checked) {
  _finSalaryRoster[i].cashOnly = !!checked;
  finRerenderPlanningPreserveFocus();
}
// A hand-entered FY-base current pay, for a worker whose wages sit INSIDE a shared budget line —
// the daycare director inside the daycare payroll account, say. Linking them to that account would
// read the whole line (several people's wages) as one person's pay; leaving them unlinked would
// read nothing. Either way "No raise", COLA and Custom would all be computed off a wrong number.
// An entered figure beats the account lookup for this worker only; everyone else is unaffected.
function finCompCurrentPayChange(i, value) {
  var w = _finSalaryRoster[i];
  var n = parseFloat(String(value == null ? '' : value).replace(/[^0-9.]/g, ''));
  if (String(value || '').trim() === '' || !isFinite(n)) delete w.actualSalaryCents;
  else w.actualSalaryCents = Math.round(n * 100);
  finRerenderPlanningPreserveFocus();
}
function finCompClearCurrentPay(i) {
  delete _finSalaryRoster[i].actualSalaryCents;
  finRerenderPlanningPreserveFocus();
}
function finCompExternallyFundedToggle(i, checked) {
  _finSalaryRoster[i].externallyFunded = !!checked;
  finCompSay(checked
    ? (_finSalaryRoster[i].name || 'That worker') + ' is now left out of every church figure.'
    : (_finSalaryRoster[i].name || 'That worker') + ' is counted in the church figures again.');
  finRerenderPlanningPreserveFocus();
}
function finCompSecaToggle(i, checked) {
  _finSalaryRoster[i].selfEmployedFica = !!checked;
  finRerenderPlanningPreserveFocus();
}
function finCompSalaryOverride(i, value) {
  _finCompOverrides[i] = value;
  finRerenderPlanningPreserveFocus();
}
function finCompClearOverride(i) { delete _finCompOverrides[i]; finRerenderPlanningPreserveFocus(); }
function finCompClearOverrides() {
  _finCompOverrides = {};
  finCompSay('Hand-set figures cleared.');
  finRerenderPlanningPreserveFocus();
}
function finCompCustomPctChange(value) {
  _finCompCustomPct = parseFloat(value) || 0;
  _finCompMethod = 'custom';
  finRerenderPlanningPreserveFocus();
}
function finCompScalePctChange(value) {
  _finCompScalePct = parseFloat(value) || 0;
  _finCompMethod = 'scalepct';
  finRerenderPlanningPreserveFocus();
}
function finCompMatchMidpoint(i) {
  var w = _finSalaryRoster[i];
  var lcms = finCompLcmsRange(w);
  if (!lcms || !lcms.midCents) return;
  var target = finRoundSalaryCents(lcms.midCents);
  _finCompOverrides[i] = String(Math.round(target / 100));
  finCompSay((w.name || 'Worker') + ' set to the LCMS midpoint — ' + finCompMoney(target) + '.');
  finRerenderPlanningPreserveFocus();
}
function finCompPickPlan(key) {
  _finHealthPlanSelectedOption = key;
  finRerenderPlanningPreserveFocus();
}
// The spread-cost refinement can only change a figure when (members x single deductible) is less
// than the family deductible — below that, members are still inside their own limits and the
// pooled family deductible has not bound yet. Every option in the current quote sets family at
// exactly 2x single, so that is true only at 1 member, which is the lone-claimant case modelled
// separately: for this quote the member count provably cannot move any number. Derived rather
// than hardcoded, so a future quote with a different family-to-single ratio turns the control
// back on by itself instead of needing a code change.
function finHealthFamilySizeMatters(opt) {
  return !!(opt && opt.embedded && opt.deductibleFamilyCents > 2 * opt.deductibleIndividualCents);
}
function finCompFamilySizeChange(value) {
  var n = Math.max(1, Math.floor(parseFloat(value) || 1));
  _finHealthFamilySize = n;
  finRerenderPlanningPreserveFocus();
}
function finCompEmployeeOnlyChange(i, value) {
  var cents = value === '' ? null : Math.round(parseFloat(value) * 100);
  _finSalaryRoster[i].employeeOnlyPremiumCents = (cents == null || !isFinite(cents)) ? null : cents;
  finRerenderPlanningPreserveFocus();
}
function finCompOptOutChange(i, value) {
  var cents = value === '' ? null : Math.round(parseFloat(value) * 100);
  _finSalaryRoster[i].healthOptOutOverrideCents = (cents == null || !isFinite(cents)) ? null : cents;
  finRerenderPlanningPreserveFocus();
}
// Reference figures. Percent fields store a FRACTION (0.117), money fields store CENTS — the two
// shapes the rest of the app already uses, so nothing downstream has to know which box it came from.
var FIN_COMP_PCT_REF_FIELDS = { pensionPct: 1, ficaPct: 1, disabilityDepsPct: 1, disabilityNoDepsPct: 1, ssaColaPct: 1 };
function finCompRefChange(year, field, value) {
  if (!_finSalaryReferenceByYear[year]) _finSalaryReferenceByYear[year] = {};
  var row = _finSalaryReferenceByYear[year];
  if (value === '' || !isFinite(parseFloat(value))) { delete row[field]; finRerenderPlanningPreserveFocus(); return; }
  row[field] = FIN_COMP_PCT_REF_FIELDS[field] ? (parseFloat(value) / 100) : Math.round(parseFloat(value) * 100);
  finRerenderPlanningPreserveFocus();
}
function finCompRefTextChange(year, field, value) {
  if (!_finSalaryReferenceByYear[year]) _finSalaryReferenceByYear[year] = {};
  if (value === '') delete _finSalaryReferenceByYear[year][field];
  else _finSalaryReferenceByYear[year][field] = value;
  // No re-render: provenance text feeds no computation, so rebuilding the DOM mid-type would only
  // risk the focus-loss class of bug. It still has to persist.
  finSalaryScheduleAutoSave();
}
function finCompRatesYearChange(v) { _finCompRefYear = Number(v); finRenderCompensation(); }
function finCompQuoteChange(optionKey, field, value) {
  if (!_finHealthPlanPremiumOverrides[optionKey]) _finHealthPlanPremiumOverrides[optionKey] = {};
  var cents = value === '' ? null : Math.round(parseFloat(value) * 100);
  if (cents == null || !isFinite(cents)) delete _finHealthPlanPremiumOverrides[optionKey][field];
  else _finHealthPlanPremiumOverrides[optionKey][field] = cents;
  finRerenderPlanningPreserveFocus();
}
// One tier's monthly rate for one plan option. Typing over a rate also clears any legacy annual
// medicalCents override for that option — otherwise the old flat figure would keep winning and the
// tier rates the admin just typed would appear to do nothing, which is the invisible-stuck-state
// bug this codebase has hit before.
function finCompTierRateChange(optionKey, tierKey, value) {
  if (!_finHealthPlanPremiumOverrides[optionKey]) _finHealthPlanPremiumOverrides[optionKey] = {};
  var row = _finHealthPlanPremiumOverrides[optionKey];
  if (!row.tiersMonthlyCents) row.tiersMonthlyCents = {};
  var cents = value === '' ? null : Math.round(parseFloat(value) * 100);
  if (cents == null || !isFinite(cents)) delete row.tiersMonthlyCents[tierKey];
  else row.tiersMonthlyCents[tierKey] = cents;
  delete row.medicalCents;
  finRerenderPlanningPreserveFocus();
}
function finCompRangeChange(i, field, value) {
  if (!_finSalaryRoster[i].concordia) _finSalaryRoster[i].concordia = {};
  _finSalaryRoster[i].concordia[field] = value;
  // Same reasoning as finCompRefTextChange: these are hand-copied off a PDF and typing into them
  // must not fight a re-render. They DO feed the fairness charts, which are on another view.
  finSalaryScheduleAutoSave();
}
// "Send to FY budget" — writes the whole compensation total into the Planning tab's FY-target
// Projected column for whichever salary account looks right, exactly as the old Apply-to-Plan did.
function finCompSendToBudget() {
  var totals = finCompTotals(finCompComputeAll());
  var leaves = finCompExpenseLeaves();
  var target = _finSalaryTargetCategory
    || (leaves.filter(function(n) { return /salar|payroll|compensation|wages/i.test(n.label); })[0] || {}).path;
  if (!target) { finCompSay('No salary account found in the FY' + _finPlanBaseYear + ' budget to apply this to.'); finRenderCompensation(); return; }
  _finSalaryTargetCategory = target;
  _finPlanEdits[target] = (totals.totalCents / 100).toFixed(2);
  finCompSay(finCompMoney(totals.totalCents) + ' sent to the FY' + _finPlanTargetYear + ' Planning budget — click Save Changes there to keep it.');
  finRerenderPlanningPreserveFocus();
  finRenderPlanning();
}

// ── The Council report (§8) ────────────────────────────────────────────────────────────────
// A flowing printable document that regenerates from the same data — deliberately NOT the
// workspace with the chrome hidden, because the layout is genuinely different (a drafted motion,
// a page per worker, full range tables). Rendered into #fin-comp-print-root, then body gets
// .printing-comp so the print stylesheet shows that one element and nothing else.
function finCompPrintCouncil() {
  var root = document.getElementById('fin-comp-print-root');
  if (!root) return;
  var computed = finCompComputeAll();
  root.innerHTML = finCompCouncilReportHtml(computed, finCompTotals(computed));
  document.body.classList.add('printing-comp');
  // Same cleanup shape as printBoardPage(): afterprint fires in every browser that supports it,
  // and the timeout is the fallback for the ones that don't (and for a cancelled dialog), so the
  // page can never be left stuck in print mode.
  var cleanup = function() {
    document.body.classList.remove('printing-comp');
    if (root) root.innerHTML = '';
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(function() { window.print(); setTimeout(cleanup, 1000); }, 60);
}
function finCompReportTile(label, value, cls) {
  return '<div class="fin-comp-rpt-tile ' + (cls || '') + '"><div class="fin-comp-rpt-tile-lbl">' + label + '</div><div class="fin-comp-rpt-tile-val">' + value + '</div></div>';
}
function finCompCouncilReportHtml(computed, totals) {
  var pct = totals.baselineCents ? (totals.deltaCents / totals.baselineCents * 100) : 0;
  var gap = finCompFullScaleGap(computed);
  var medTotal = finCompMedianTotal(computed);
  var planCalc = finComputeHealthPlanTotalCents(_finHealthPlanSelectedOption, null, finCompEnrollmentCounts());
  var scaleRatio = totals.worksheetCents ? Math.round(totals.salaryCents / totals.worksheetCents * 100) : null;
  var salaryShare = totals.totalCents ? Math.round(totals.salaryCents / totals.totalCents * 100) : 0;
  var altTotalCents = totals.totalCents + gap.totalCents;
  var altPct = totals.baselineCents ? (altTotalCents - totals.baselineCents) / totals.baselineCents * 100 : 0;
  // Part 1 — cover
  var salaryRows = _finSalaryRoster.map(function(w, i) {
    var c = computed[i];
    var ratio = c.worksheetCents ? Math.round(c.salaryCents / c.worksheetCents * 100) : null;
    if (finCompIsExternallyFunded(w)) {
      return '<tr class="mut"><td><b>' + esc(w.name || '(unnamed)') + '</b><br><span class="mut">' + esc(w.position || '') + ' &middot; paid from another budget</span></td>'
        + '<td class="n mut">' + finCompMoney(c.currentCents) + '</td><td class="n mut">' + finCompMoney(c.salaryCents) + '</td>'
        + '<td class="n mut">&mdash;</td><td class="n mut">&mdash;</td><td class="n mut">&mdash;</td><td class="n mut">&mdash;</td>'
        + '<td class="n mut">not in this budget</td></tr>';
    }
    return '<tr><td><b>' + esc(w.name || '(unnamed)') + '</b><br><span class="mut">' + esc(w.position || '') + ' &middot; ' + (Number(w.yearsExperience) || 0) + ' yrs'
      + (w.accountCode ? ' &middot; acct ' + esc(w.accountCode) : '') + '</span></td>'
      + '<td class="n mut">' + finCompMoney(c.currentCents) + '</td>'
      + '<td class="n b">' + finCompMoney(c.salaryCents) + '</td>'
      + '<td class="n">' + (c.salaryCents === c.currentCents ? 'no change' : finCompMoneySigned(c.salaryCents - c.currentCents)) + '</td>'
      + '<td class="n mut">' + finCompMoney(c.salaryCents / FIN_SALARY_PAY_PERIODS) + '</td>'
      + '<td class="n mut">' + (c.worksheetCents == null ? '&mdash;' : finCompMoney(c.worksheetCents)) + '</td>'
      + '<td class="n b" style="color:' + (ratio == null ? 'var(--warm-gray)' : finCompRatioColor(c.salaryCents / c.worksheetCents)) + ';">' + (ratio == null ? '&mdash;' : ratio + '%') + '</td>'
      + '<td class="n b">' + finCompMoney(c.churchCostCents) + '</td></tr>';
  }).join('');
  var cover = '<div class="fin-comp-rpt-kicker">Church Council &middot; Compensation</div>'
    + '<h1 class="fin-comp-rpt-h1">Fiscal Year ' + _finPlanTargetYear + ' Compensation Plan</h1>'
    + '<div class="fin-comp-rpt-sub">' + finCompCountedCount() + ' called and employed worker' + (finCompCountedCount() === 1 ? '' : 's')
    + ' &middot; salaries set by ' + finCompMethodLongLabel(_finCompMethod)
    + ' &middot; pension ' + finCompPctFmt(finCompPensionRate(_finPlanTargetYear).rate)
    + ' &middot; health plan: ' + esc(planCalc ? planCalc.label : 'none selected') + '</div>'
    + '<div class="fin-comp-rpt-tiles kt">'
    + finCompReportTile('Cash salaries', finCompMoney(totals.salaryCents))
    + finCompReportTile('Benefits &amp; taxes', finCompMoney(totals.benefitsCents))
    + finCompReportTile('FY' + _finPlanTargetYear + ' total', finCompMoney(totals.totalCents), 'mist')
    + finCompReportTile('vs FY' + _finPlanBaseYear + ' ' + finCompMoney(totals.baselineCents),
        (totals.baselineCents ? finCompMoneySigned(totals.deltaCents) + ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%)' : '&mdash;'), 'navy')
    + '</div>'
    + '<div class="fin-comp-rpt-motion kt"><div class="fin-comp-rpt-motion-h">Recommended motion</div>'
    + '<div>That the Church Council approve FY' + _finPlanTargetYear + ' compensation of <b>' + finCompMoney(totals.totalCents) + '</b> for '
    + finCompCountedCount() + ' worker' + (finCompCountedCount() === 1 ? '' : 's')
    + (totals.baselineCents ? ' &mdash; a ' + pct.toFixed(1) + '% ' + (totals.deltaCents >= 0 ? 'increase over' : 'decrease from') + ' FY' + _finPlanBaseYear + ' compensation of ' + finCompMoney(totals.baselineCents) + (totals.baseline && totals.baseline.prorated ? ', annualized' : '') : '')
    + ' &mdash; applying ' + finCompMethodLongLabel(_finCompMethod) + ' to each worker&#39;s salary, continuing the Concordia Retirement Plan at '
    + finCompPctFmt(finCompPensionRate(_finPlanTargetYear).rate)
    + ', and ' + (planCalc ? 'setting the group health plan to ' + esc(planCalc.label) + ' at ' + finCompMoney(planCalc.totalCents) : 'making no change to the group health plan') + '.</div></div>'
    + finCompRenderBaselineNote(totals)
    + '<h2 class="fin-comp-rpt-h2">What Council is being asked to weigh</h2>'
    + '<p class="fin-comp-rpt-p">Three separate questions sit behind the single number above. <b>How much of a raise</b> &mdash; a COLA keeps existing salaries level with inflation, while the district&#39;s own published scale is a benchmark. <b>Whether our pay is fair</b> &mdash; measured against the LCMS Missouri District scale and against Concordia Plans&#39; published pay ranges for each role. <b>What it costs</b> &mdash; salary is ' + salaryShare + '% of the total; pension, health, disability and employer taxes are the rest.</p>'
    + '<p class="fin-comp-rpt-p">The plan below pays <b>' + (scaleRatio == null ? 'an unknown share of' : scaleRatio + '% of') + ' the district scale</b> in total'
    + (medTotal.count ? ', and sits <b>' + medTotal.text.replace(/^[+−]\$[\d,]+ \(/, '').replace(/\)$/, '') + '</b> for the ' + medTotal.count + ' worker' + (medTotal.count === 1 ? '' : 's') + ' with a Concordia Plans report on file' : '')
    + '. ' + (gap.totalCents
        ? 'Bringing every worker to full district scale would cost an additional <b>' + finCompMoney(gap.salaryGapCents) + '</b> in salary and <b>' + finCompMoney(gap.benefitsGapCents) + '</b> in the benefits that follow it &mdash; pension, disability and, for non-ministers, employer FICA; health premiums do not move with salary &mdash; for a total of <b>' + finCompMoney(gap.totalCents) + '</b> on top of what is proposed here. That is an alternative, not the plan: it would take FY' + _finPlanTargetYear + ' compensation from the recommended <b>' + finCompMoney(totals.totalCents) + '</b> (' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%) to <b>' + finCompMoney(altTotalCents) + '</b> (' + (altPct >= 0 ? '+' : '') + altPct.toFixed(1) + '%).'
        : 'Every worker is already at or above the district scale, so there is no cost-to-full-scale alternative to weigh.') + '</p>'
    + '<h2 class="fin-comp-rpt-h2">Salary plan by worker</h2>'
    + '<table class="fin-comp-rpt-table kt"><thead><tr><th>Worker</th><th class="n">FY' + _finPlanBaseYear + '</th><th class="n">FY' + _finPlanTargetYear + '</th><th class="n">Change</th><th class="n">Per paycheck</th><th class="n">District scale</th><th class="n">% of scale</th><th class="n">Church cost</th></tr></thead>'
    + '<tbody>' + salaryRows
    + '<tr class="tot"><td>Total</td><td class="n">' + finCompMoney(totals.currentCents) + '</td><td class="n">' + finCompMoney(totals.salaryCents) + '</td>'
    + '<td class="n">' + finCompMoneySigned(totals.salaryCents - totals.currentCents) + '</td><td class="n">&mdash;</td>'
    + '<td class="n">' + finCompMoney(totals.worksheetCents) + '</td><td class="n">' + (scaleRatio == null ? '&mdash;' : scaleRatio + '%') + '</td>'
    + '<td class="n">' + finCompMoney(totals.totalCents) + '</td></tr></tbody></table>'
    // Same four-line breakdown the Council summary screen shows under its table, so the printed
    // page and the screen answer "what is the benefits figure made of" identically.
    + '<h2 class="fin-comp-rpt-h2">What makes up ' + finCompMoney(totals.benefitsCents) + ' of benefits &amp; taxes</h2>'
    + '<table class="fin-comp-rpt-table kt"><thead><tr><th>Cost</th><th class="n">Workers</th><th class="n">FY' + _finPlanTargetYear + '</th><th class="n">Share</th></tr></thead><tbody>'
    + (function() {
        var bd = finCompBenefitBreakdown(computed);
        return bd.rows.map(function(r) {
          return '<tr><td>' + r.label + '<br><span class="mut">' + r.note + '</span></td>'
            + '<td class="n mut">' + r.people + ' of ' + bd.countedCount + '</td>'
            + '<td class="n b">' + finCompMoney(r.cents) + '</td>'
            + '<td class="n mut">' + (bd.totalCents ? Math.round(r.cents / bd.totalCents * 100) : 0) + '%</td></tr>';
        }).join('')
        + '<tr class="tot"><td>Total benefits &amp; taxes</td><td class="n"></td><td class="n">' + finCompMoney(bd.totalCents) + '</td><td class="n">100%</td></tr>';
      })()
    + '</tbody></table>'
    + (finCompExternallyFundedWorkers().length
        ? '<p class="fin-comp-rpt-p mut">Not counted in any figure above: '
          + finCompExternallyFundedWorkers().map(function(w) { return esc(w.name || '(unnamed)') + (w.position ? ' (' + esc(w.position) + ')' : ''); }).join(', ')
          + ' &mdash; paid from another budget, and costed in that section.</p>'
        : '');
  // Part 2 — worker by worker
  var workerPages = _finSalaryRoster.map(function(w, i) {
    if (finCompIsExternallyFunded(w)) return '';
    var c = computed[i], b = c.benefits;
    var usable = finCompUsableRanges(w);
    var lcms = finCompLcmsRange(w);
    var verdict = finCompVerdict(w, c.salaryCents);
    var rangeTable = usable.length
      ? '<table class="fin-comp-rpt-table kt"><thead><tr><th>Range</th><th class="n">Lower</th><th class="n">Midpoint</th><th class="n">Higher</th><th class="n">This plan vs. midpoint</th></tr></thead><tbody>'
        + usable.map(function(r) {
            var vs = r.midCents ? c.salaryCents - r.midCents : null;
            return '<tr' + (/LCMS/i.test(r.label) ? ' class="lcms"' : '') + '><td>' + esc(r.label) + '</td><td class="n">' + finCompMoney(r.lowCents) + '</td>'
              + '<td class="n">' + (r.midCents ? finCompMoney(r.midCents) : '&mdash;') + '</td><td class="n">' + finCompMoney(r.highCents) + '</td>'
              + '<td class="n">' + (vs == null ? '&mdash;' : finCompMoneySigned(vs)) + '</td></tr>';
          }).join('') + '</tbody></table>'
      : '<p class="fin-comp-rpt-p mut">No Concordia Plans report on file for this position &mdash; compared against the District Compensation Worksheet figure only.</p>';
    var read = usable.length
      ? esc(w.name || 'This worker') + ' is ' + verdict.text.toLowerCase().replace(/^below/, 'below') + ', and '
        + finCompVsScale(c.salaryCents, c.worksheetCents).text.replace(/^at scale$/, 'sits at the district scale') + ' against the district worksheet figure of '
        + (c.worksheetCents == null ? 'an unavailable figure' : finCompMoney(c.worksheetCents)) + '.'
      : esc(w.name || 'This worker') + ' has no market report on file; against the district worksheet figure of '
        + (c.worksheetCents == null ? 'an unavailable figure' : finCompMoney(c.worksheetCents)) + ' this plan is ' + finCompVsScale(c.salaryCents, c.worksheetCents).text + '.';
    return '<div class="fin-comp-rpt-worker kt">'
      + '<h2 class="fin-comp-rpt-h2">' + esc(w.name || '(unnamed)') + '<span class="mut" style="font-weight:400;font-size:10pt;"> &mdash; ' + esc(w.position || '') + '</span></h2>'
      + '<table class="fin-comp-rpt-table kt"><tbody>'
      + '<tr><td>Cash salary</td><td class="n b">' + finCompMoney(c.salaryCents) + '</td></tr>'
      + (b.cashOnly
          ? '<tr><td colspan="2" class="mut">Cash salary only at ' + finCompFtePct(w) + '% of full time &mdash; below the hours floor for the Concordia pension, disability and health plans. Employer FICA still applies.</td></tr>'
          : '<tr><td>Pension ' + finCompPctFmt(finCompPensionRate(_finPlanTargetYear).rate) + '</td><td class="n">' + finCompMoney(b.pensionCents) + '</td></tr>'
            + '<tr><td>Health &mdash; ' + esc(finCompIsCashOnly(w) ? 'not eligible' : finCompHealthTierLabel(finCompHealthTier(w)).toLowerCase()) + '</td><td class="n">' + finCompMoney(b.healthCents) + '</td></tr>'
            + '<tr><td>Disability &amp; survivor' + (w.hasDependents ? ' (with dependents)' : '') + '</td><td class="n">' + finCompMoney(b.disabilityCents) + '</td></tr>')
      + '<tr><td>Employer FICA' + (w.selfEmployedFica ? ' &mdash; none; a minister pays their own SECA' : '') + '</td><td class="n">' + finCompMoney(b.ficaCents) + '</td></tr>'
      + '<tr class="tot"><td>Total church cost</td><td class="n">' + finCompMoney(c.churchCostCents) + '</td></tr>'
      + '</tbody></table>'
      + (w.selfEmployedFica ? '<p class="fin-comp-rpt-p mut">As a minister for Social Security purposes, ' + esc(w.name || 'this worker') + ' pays the employer half of FICA themselves &mdash; ' + finCompMoney(b.secaSelfCents) + ' at this salary. That is not a church cost and is in no total above.</p>' : '')
      + rangeTable
      + '<p class="fin-comp-rpt-p">' + read + '</p>'
      + '</div>';
  }).join('');
  // Part 3 — group health plan
  var rptCounts = finCompEnrollmentCounts();
  var planRows = FIN_COMP_PLAN_KEYS.map(function(key) {
    var calc = finComputeHealthPlanTotalCents(key, null, rptCounts);
    var perHousehold = finCompPerHouseholdDiffCents('renewal', key);
    return '<tr' + (key === _finHealthPlanSelectedOption ? ' class="lcms"' : '') + '><td>' + esc(calc.label) + '</td>'
      + FIN_HEALTH_TIERS.map(function(t) { return '<td class="n">' + finCompMoneyCents(finHealthTierMonthlyCents(key, t.key) || 0) + '</td>'; }).join('')
      + '<td class="n">' + finCompMoney(calc.dentalCents) + '</td><td class="n">' + finCompMoney(calc.visionCents) + '</td>'
      + '<td class="n">' + finCompMoney(finCompPlanQuoteField(key, 'deductibleFamilyCents')) + '</td><td class="n">' + finCompMoney(finCompPlanQuoteField(key, 'oopMaxFamilyCents')) + '</td>'
      + '<td class="n b">' + finCompMoney(calc.totalCents) + '</td>'
      + '<td class="n">' + (key === 'renewal' ? '&mdash;' : finCompMoneySigned(perHousehold) + '/worker') + '</td></tr>';
  }).join('');
  var tierRows = _finSalaryRoster.map(function(w, i) {
    if (finCompIsExternallyFunded(w)) return '';
    var tier = finCompHealthTier(w);
    var rate = finHealthTierMonthlyCents(_finHealthPlanSelectedOption, tier);
    return '<tr><td>' + esc(w.name || '(unnamed)') + '</td>'
      + '<td>' + (finCompIsCashOnly(w) ? 'Not eligible &mdash; ' + finCompFtePct(w) + '% time' : esc(finCompHealthTierLabel(tier))) + '</td>'
      + '<td class="n">' + finCompMoney(computed[i].benefits.healthCents) + '</td>'
      + '<td class="mut">' + (finCompIsCashOnly(w) ? 'Below the hours floor for the group plan'
          : tier === 'optout' ? 'Opt-out cash from this year&#39;s rates'
          : w.employeeOnlyPremiumCents != null ? 'Hand-entered premium'
          : finCompMoneyCents(rate || 0) + '/mo &times; 12, plus a share of dental and vision') + '</td></tr>';
  }).join('');
  var healthPage = '<div class="fin-comp-rpt-page">'
    + '<h2 class="fin-comp-rpt-h2">Group health plan</h2>'
    + '<table class="fin-comp-rpt-table kt"><thead><tr><th>Option</th>'
    + FIN_HEALTH_TIERS.map(function(t) { return '<th class="n">' + esc(t.label) + ' / mo</th>'; }).join('')
    + '<th class="n">Dental</th><th class="n">Vision</th><th class="n">Family deductible</th><th class="n">Out-of-pocket max</th><th class="n">Total premium</th><th class="n">vs Renewal</th></tr></thead><tbody>' + planRows + '</tbody></table>'
    + '<p class="fin-comp-rpt-p">The church covers ' + esc(planCalc ? planCalc.label : 'the selected plan') + ' in full. A worker who chooses another option pays the premium difference themselves &mdash; the last column above, per worker per year.</p>'
    + '<table class="fin-comp-rpt-table kt"><thead><tr><th>Worker</th><th>Coverage</th><th class="n">Church cost</th><th>Basis</th></tr></thead><tbody>' + tierRows
    + '<tr class="tot"><td colspan="2">Total health cost</td><td class="n">' + finCompMoney(totals.healthCents) + '</td><td></td></tr></tbody></table></div>';
  // Part 4 — reference figures used
  var refRows = [
    ['District base salary, FY' + _finPlanTargetYear, '$' + finFmtMoney(finCompBaseSalary(_finPlanTargetYear).dollars), finCompSourceDoc('districtSource'), (function() { var p = finCompBaseSalary(_finPlanTargetYear - 1); return p.dollars ? finCompMoneySigned(Math.round((finCompBaseSalary(_finPlanTargetYear).dollars - p.dollars) * 100)) + ' from FY' + (_finPlanTargetYear - 1) : '&mdash;'; })()],
    ['Concordia pension (Traditional)', finCompPctFmt(finCompPensionRate(_finPlanTargetYear).rate), finCompSourceDoc('concordiaSource'), finCompPctFmt(finCompPensionRate(_finPlanBaseYear).rate) + ' in FY' + _finPlanBaseYear],
    ['Disability &amp; survivor &mdash; with dependents', finCompPctFmt(finCompDisabilityRate(_finPlanTargetYear, true).rate), finCompSourceDoc('concordiaSource'), ''],
    ['Disability &amp; survivor &mdash; without', finCompPctFmt(finCompDisabilityRate(_finPlanTargetYear, false).rate), finCompSourceDoc('concordiaSource'), ''],
    ['Employer FICA', finCompPctFmt(finCompFicaRate()), 'IRS employer OASDI 6.20% + Medicare 1.45%', ''],
    ['Social Security COLA', finCompPctFmt(finCompSsaRate()), 'Social Security Administration, announced each October', ''],
    ['Health opt-out cash', finCompMoney(finCompOptOutCents()), 'Set by the congregation', ''],
    ['Group health quote', finCompMoney(planCalc ? planCalc.totalCents : 0) + ' over ' + finCompEnrolledCount() + ' contract' + (finCompEnrolledCount() === 1 ? '' : 's'), finCompSourceDoc('quoteSource'), '']
  ].map(function(r) {
    return '<tr><td>' + r[0] + '</td><td class="n b">' + r[1] + '</td><td class="mut">' + esc(r[2]) + '</td><td class="mut">' + r[3] + '</td></tr>';
  }).join('');
  var withReports = _finSalaryRoster.filter(function(w) { return finCompUsableRanges(w).length; }).length;
  var refPage = '<div class="fin-comp-rpt-page">'
    + '<h2 class="fin-comp-rpt-h2">Reference figures used</h2>'
    + '<table class="fin-comp-rpt-table kt"><thead><tr><th>Figure</th><th class="n">Value</th><th>Source document</th><th>Change</th></tr></thead><tbody>' + refRows + '</tbody></table>'
    + '<p class="fin-comp-rpt-p mut">' + withReports + ' of ' + _finSalaryRoster.length + ' roster worker' + (_finSalaryRoster.length === 1 ? ' has' : 's have')
    + ' a Concordia Plans Compensation Decision Support report on file. Where a worker has none, this plan is measured against the District Compensation Worksheet alone.</p></div>';
  return '<div class="fin-comp-rpt">'
    + '<div class="fin-comp-rpt-hd"><span>Timothy Lutheran Church &middot; St. Louis</span><span>FY' + _finPlanTargetYear + ' Compensation Report &middot; prepared for Church Council</span></div>'
    + cover
    + workerPages
    + healthPage + refPage
    + '<div class="fin-comp-rpt-ft">Built from ' + esc(finCompSourceDoc('districtSource')) + ', ' + esc(finCompSourceDoc('concordiaSource')) + ', and ' + esc(finCompSourceDoc('quoteSource')) + '.</div>'
    + '</div>';
}

// ── 3277 Ivanhoe Multi-Year Forecast (kept separate from Church Budget Planning — the property
// has no "budget" concept to commit into, just actuals reported by AHRA; this is read-only and
// entirely client-side, extending the single-year forecast already on the Commercial Property
// tab into an adjustable growth-rate projection over several years). ──────────────────────────
function finRenderPropertyMultiYearForecast() {
  // Mounts inside the Planning page's outlook row (see finRenderPlanningOutlook), so it is
  // rendered after finRenderPlanning() has rebuilt that container.
  var el = document.getElementById('fin-plan-property-mount');
  if (!el) return;
  if (!_finProperty) { el.innerHTML = '<div class="fin-card"><p style="font-size:.85rem;color:var(--warm-gray);margin:0;">Loading property forecast…</p></div>'; return; }
  // The base-period control re-renders this whole card, so the other control values live in
  // module state rather than only in the DOM — otherwise changing the base silently resets the
  // growth/years/capital inputs and snaps the disclosure shut under the reader.
  var baseOpts = finComputePropertyBaseOptions(_finProperty);
  var chosen = baseOpts.filter(function(b) { return b.key === _finPmfBaseKey; })[0] || baseOpts[0];
  var baseArg = { baseAnnualCents: chosen ? chosen.annualCents : undefined };
  var f = finComputeRemittableForecast(_finProperty, {
    years: 3, growthPct: 0.02, baseAnnualCents: baseArg.baseAnnualCents, capitalAllowanceCents: finPmfCapitalCents(),
  });
  var payoffYear = f.payoffYear;
  // The first year clear of the mortgage. Read through the same model rather than hand-rolled,
  // so the "after payoff" claim cannot drift from the year-by-year table below it.
  var postPayoff = payoffYear
    ? finComputeRemittableForecast(_finProperty, { years: 1, growthPct: 0.02, startYear: payoffYear + 1,
        baseAnnualCents: baseArg.baseAnnualCents, capitalAllowanceCents: finPmfCapitalCents() }).rows[0]
    : null;

  // Four tiles first — three forecast years and the payoff year — because that is the whole
  // answer for most readers; the year-by-year table and its assumptions sit behind a disclosure.
  var growthForTiles = 0.02;
  function tile(label, value, positive) {
    return '<div class="fin-mini-tile' + (positive ? ' positive' : '') + '">'
      + '<div class="fin-eyebrow"' + (positive ? ' style="color:var(--sage-text);"' : '') + '>' + label + '</div>'
      + '<div class="fin-mini-tile-val">' + value + '</div></div>';
  }
  var tiles = '';
  f.rows.forEach(function(r) { tiles += tile(String(r.year), finMoney0Signed(r.remittableCents), false); });
  tiles += tile('Loan paid off', payoffYear ? String(payoffYear) : '—', true);

  // The reconciliation, on the face of the card rather than behind the disclosure — the whole
  // reason this card was wrong is that a single number hid what it had and had not taken out.
  var r0 = f.rows[0];
  function reconRow(label, cents, negative, strong) {
    var amount = negative ? '&minus; ' + finMoney0(Math.abs(cents)) : finMoney0Signed(cents);
    var colored = negative || (strong && cents < 0);
    return '<div style="display:flex;justify-content:space-between;gap:16px;padding:3px 0;'
      + (strong ? 'font-weight:700;border-top:1px solid var(--border);margin-top:4px;padding-top:6px;' : '') + '">'
      + '<span>' + label + '</span>'
      + '<span style="font-variant-numeric:tabular-nums;' + (colored ? 'color:var(--danger);' : '') + '">' + amount + '</span></div>';
  }
  var reconHtml = '<div style="font-size:12.5px;color:var(--warm-ink-label);">'
    + '<div style="font-weight:700;margin-bottom:4px;">How ' + r0.year + ' gets to that number</div>'
    + reconRow('Net income (grown ' + (growthForTiles * 100).toFixed(0) + '% from ' + esc(chosen ? chosen.label.toLowerCase() : 'the base period') + ')', r0.netIncomeCents, false)
    + reconRow('Mortgage principal &mdash; cash out, but never an expense', r0.principalCents, true)
    + (r0.capitalCents
        ? reconRow('Capital allowance &mdash; capitalized, so never an expense either', r0.capitalCents, true)
        : reconRow('Capital allowance &mdash; none assumed; set one below', 0, false))
    + reconRow('Remittable to the church', r0.remittableCents, false, true)
    + '</div>';

  // The base period is the biggest lever on the answer, so it sits on the face of the card with
  // every option's own figure visible — not buried in the disclosure showing one number.
  var baseHtml = baseOpts.length > 1
    ? '<div style="margin-top:14px;font-size:12.5px;">'
      + '<div style="font-weight:700;color:var(--warm-ink-label);margin-bottom:6px;">Projected from</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
      + baseOpts.map(function(b) {
          var on = chosen && b.key === chosen.key;
          return '<button type="button" onclick="finPmfSetBase(' + jsAttr(b.key) + ')" aria-pressed="' + (on ? 'true' : 'false')
            + '" style="text-align:left;cursor:pointer;border:1px solid ' + (on ? 'var(--color-navy)' : 'var(--border)')
            + ';background:' + (on ? 'var(--color-navy)' : 'var(--white)') + ';color:' + (on ? 'var(--white)' : 'var(--warm-ink-label)')
            + ';border-radius:8px;padding:7px 10px;font-size:12px;font-family:inherit;">'
            + '<span style="display:block;font-weight:700;">' + esc(b.label) + '</span>'
            + '<span style="display:block;font-variant-numeric:tabular-nums;">' + finMoney0(b.annualCents) + '/yr</span></button>';
        }).join('')
      + '</div>'
      + (chosen && chosen.caveat ? '<p style="font-size:11.5px;color:var(--warm-gray);margin:7px 0 0;">' + chosen.caveat
          + (chosen.range ? ' <span style="white-space:nowrap;">(' + esc(chosen.range) + ')</span>' : '') + '</p>' : '')
      + '</div>'
    : '';

  // A negative headline is the finding, not an error — say so in words, so it does not read as
  // a broken card. The mortgage is the whole story: it is nearly all of what the property earns.
  var verdictHtml = r0.remittableCents < 0
    ? '<div class="fin-note-box" style="margin-top:10px;"><b>Read this as: the property does not currently fund a distribution out of its own earnings.</b> '
      + 'It earns roughly ' + finMoney0(r0.netIncomeCents) + ' a year, but the mortgage alone takes ' + finMoney0(r0.principalCents)
      + ' of that in principal. Anything sent to the church in the meantime comes out of accumulated cash, not the year&rsquo;s income. '
      + (postPayoff ? 'That changes once the loan is paid off around ' + payoffYear + ', after which the same building clears roughly '
        + finMoney0Signed(postPayoff.remittableCents) + ' a year on these assumptions.' : '')
      + '</div>'
    : '';

  // Actual distributions, as a reality check against the projection directly above them.
  var dists = {};
  (_finProperty.distributions || []).forEach(function(dd) {
    var yr = String(dd.period || '').slice(0, 4);
    if (yr) dists[yr] = (dists[yr] || 0) + (dd.amount_cents || 0);
  });
  var distYears = Object.keys(dists).sort();
  var actualHtml = distYears.length
    ? '<div class="fin-note-box" style="margin-top:12px;"><b>Actually sent to the church:</b> '
      + distYears.map(function(yr) { return yr + ' ' + finMoney0(dists[yr]); }).join(' &middot; ')
      + '. A projection that does not land near this range is measuring something other than remittable cash.</div>'
    : '';

  var insuranceCents = ((_finProperty.meta || {}).insurance || {}).allocated_total_annual_cents || 0;
  var memoHtml = insuranceCents
    ? '<p style="font-size:.72rem;color:var(--warm-gray);margin:10px 0 0;"><i>Memo, not deducted above: the church also pays roughly $'
      + finFmtMoney(insuranceCents / 100) + '/yr of allocated insurance for this building off the master policy. It is left out here because the church budget already carries it as its own expense line.</i></p>'
    : '';

  // What this property has actually spent on capital, shown beside the input rather than silently
  // assumed. Every entry is a finished one-off, so the default is nothing — but the history and
  // the reserve AHRA has not funded are both named, so choosing nothing stays a real choice.
  var capitalNote;
  if (!f.capital.entries) {
    capitalNote = 'No capital entries are recorded for this property, so there is no spending history to base an allowance on.';
  } else {
    capitalNote = 'This property has spent $' + finFmtMoney(f.capital.totalCents / 100) + ' over '
      + f.capital.years.toFixed(1) + ' years ($' + finFmtMoney(f.capital.cents / 100) + '/yr), all of it on one-off projects rather than recurring work.';
  }
  capitalNote += ' AHRA&rsquo;s own paint, asphalt and concrete reserve exists but is funded at $0, so exterior work is a real future cost nothing is currently setting money aside for.';

  var inputsHtml = '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px;">'
    + '<label style="font-size:.75rem;color:var(--warm-gray);">Annual Growth Assumption %<br><input type="number" id="fin-pmf-growth" step="0.1" value="' + _finPmfGrowthPct + '" oninput="finPmfInputChanged()" style="width:100px;"></label>'
    + '<label style="font-size:.75rem;color:var(--warm-gray);">Years to Project<br><input type="number" id="fin-pmf-years" value="' + _finPmfYears + '" min="1" max="30" oninput="finPmfInputChanged()" style="width:90px;"></label>'
    + '<label style="font-size:.75rem;color:var(--warm-gray);">Capital Allowance $/yr<br><input type="number" id="fin-pmf-capital" step="500" value="' + Math.round(finPmfCapitalCents() / 100) + '" oninput="finPmfInputChanged()" style="width:120px;"></label>'
    + '</div>'
    + '<p style="font-size:.72rem;color:var(--warm-gray);margin:0 0 10px;">Grows operating income (net income before interest, $'
    + finFmtMoney(f.baseOperatingCents / 100) + '/yr from ' + esc(chosen ? chosen.label.toLowerCase() : 'the base period') + ') at the rate above, since rents grow but a fixed mortgage payment does not. Interest and principal come from amortizing the confirmed loan balance, so both fall to zero once it is paid off'
    + (payoffYear ? ' around ' + payoffYear : '') + '. Property tax is not deducted &mdash; the bill is already an expense inside net income. ' + capitalNote + '</p>'
    + '<div id="fin-pmf-table"></div>';
  el.innerHTML = '<div class="fin-card">'
    + '<div class="fin-card-title" style="font-size:20px;">3277 Ivanhoe forecast</div>'
    + '<div class="fin-card-sub">Cash the property can actually remit &mdash; net income less mortgage principal and capital spending, at ' + (growthForTiles * 100).toFixed(0) + '% growth.</div>'
    + '<div class="fin-grid-4">' + tiles + '</div>'
    + baseHtml
    + '<div class="fin-note-box" style="margin-top:14px;">' + reconHtml + '</div>'
    + verdictHtml
    + actualHtml
    + finPropertyLoanWarningHtml(_finProperty)
    + memoHtml
    + '<details style="margin-top:10px;"' + (_finPmfDetailsOpen ? ' open' : '') + ' ontoggle="_finPmfDetailsOpen=this.open;"><summary class="fin-disclosure">Year by year, and the assumptions behind it</summary>'
    + '<div style="margin-top:10px;">' + inputsHtml + '</div></details>'
    + '</div>';
  finRenderPropertyMultiYearTable();
}
// Control state for the forecast card. Held here, not only in the DOM, because changing the base
// period re-renders the whole card — reading the inputs back off a subtree that is about to be
// replaced would reset them every time.
var _finPmfBaseKey = 'trailing12';
var _finPmfGrowthPct = 2;
var _finPmfYears = 10;
// null means "not touched on this screen yet" — resolve to the property's own saved capital
// assumption instead. A hardcoded 0 here would have this card and the Commercial Property tab
// quote different cash for the same year, which is the whole reason that assumption is resolved in
// one place. Once somebody types in the box the typed figure wins, as a live what-if.
var _finPmfCapitalCents = null;
function finPmfCapitalCents() {
  if (_finPmfCapitalCents != null) return _finPmfCapitalCents;
  return finComputePropertyCapitalAllowanceCents(_finProperty).cents;
}
var _finPmfDetailsOpen = false;
function finPmfSetBase(key) {
  _finPmfBaseKey = key;
  finRenderPropertyMultiYearForecast();
}
// Capture the inputs before re-rendering anything, so a base switch keeps them.
// Growth and capital both move the headline tiles and the reconciliation, not just the table, so
// this re-renders the whole card — through the same focus/caret/scroll-preserving wrapper the
// Compensation tab uses, since a full re-render on every keystroke otherwise drops focus and
// scrolls the page (FIN20/FIN52).
function finPmfInputChanged() {
  var growthEl = document.getElementById('fin-pmf-growth');
  var yearsEl = document.getElementById('fin-pmf-years');
  var capEl = document.getElementById('fin-pmf-capital');
  if (growthEl && isFinite(parseFloat(growthEl.value))) _finPmfGrowthPct = parseFloat(growthEl.value);
  if (yearsEl && isFinite(parseInt(yearsEl.value, 10))) _finPmfYears = parseInt(yearsEl.value, 10);
  if (capEl) _finPmfCapitalCents = isFinite(parseFloat(capEl.value)) ? Math.round(parseFloat(capEl.value) * 100) : 0;
  finPmfRerenderPreserveFocus();
}
function finPmfRerenderPreserveFocus() {
  var active = document.activeElement;
  var activeId = active && active.id;
  var activeValue = active && typeof active.value === 'string' ? active.value : null;
  var selStart = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
  var selEnd = active && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;
  var scrollY = window.scrollY;
  var contentArea = document.querySelector('.content-area');
  var contentScrollTop = contentArea ? contentArea.scrollTop : null;
  finRenderPropertyMultiYearForecast();
  if (activeId) {
    var restored = document.getElementById(activeId);
    if (restored) {
      restored.focus();
      if (activeValue != null && restored.value !== activeValue) restored.value = activeValue;
      if (selStart != null && restored.setSelectionRange) {
        try { restored.setSelectionRange(selStart, selEnd); } catch (e) { /* not text-selectable, ignore */ }
      }
    }
  }
  window.scrollTo(0, scrollY);
  if (contentArea && contentScrollTop != null) contentArea.scrollTop = contentScrollTop;
}
// Reads the same finComputeRemittableForecast rows the tiles do — it used to re-derive the math
// from three window globals, which is exactly how the table and the card came to disagree.
function finRenderPropertyMultiYearTable() {
  var tableEl = document.getElementById('fin-pmf-table');
  if (!tableEl || !_finProperty) return;
  // Reads the same module state the tiles above were built from, so the two cannot disagree.
  var baseOpts = finComputePropertyBaseOptions(_finProperty);
  var chosen = baseOpts.filter(function(b) { return b.key === _finPmfBaseKey; })[0] || baseOpts[0];
  var f = finComputeRemittableForecast(_finProperty, {
    years: _finPmfYears,
    growthPct: _finPmfGrowthPct / 100,
    capitalAllowanceCents: finPmfCapitalCents(),
    baseAnnualCents: chosen ? chosen.annualCents : undefined,
  });
  var rows = '';
  f.rows.forEach(function(r) {
    rows += '<tr' + (r.isPostPayoff ? ' style="background:var(--linen);"' : '') + '>'
      + '<td style="padding:4px 8px;">' + r.year + (r.isPostPayoff ? ' <span style="font-size:.68rem;color:var(--warm-gray);">(post-payoff)</span>' : '') + '</td>'
      + '<td style="padding:4px 8px;text-align:right;">' + finMoney0Signed(r.netIncomeCents) + '</td>'
      + '<td style="padding:4px 8px;text-align:right;color:var(--warm-gray);">' + (r.principalCents ? '&minus; ' + finMoney0(r.principalCents) : '&mdash;') + '</td>'
      + '<td style="padding:4px 8px;text-align:right;color:var(--warm-gray);">' + (r.capitalCents ? '&minus; ' + finMoney0(r.capitalCents) : '&mdash;') + '</td>'
      + '<td style="padding:4px 8px;text-align:right;font-weight:700;' + (r.remittableCents < 0 ? 'color:var(--danger);' : '') + '">' + finMoney0Signed(r.remittableCents) + '</td></tr>';
  });
  tableEl.innerHTML = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr>'
    + '<th style="text-align:left;padding:4px 8px;">Year</th>'
    + '<th style="text-align:right;padding:4px 8px;">Net income</th>'
    + '<th style="text-align:right;padding:4px 8px;">Principal</th>'
    + '<th style="text-align:right;padding:4px 8px;">Capital</th>'
    + '<th style="text-align:right;padding:4px 8px;">Remittable</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}
`;
