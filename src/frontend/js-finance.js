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
    finRenderConnection();
    finRenderBudget(overview);
    finRenderAccounts(overview);
    finRenderDaycare();
    finRenderChurchReport();
    finRenderDaycareReport();
    finLoadProperty();
    finLoadPlanning();
    finLoadOverviewDomain();
  }).catch(function(err) {
    if (err && err.message === 'Unauthorized') return;
    loadingEl.textContent = 'Could not load finance data.';
  });
}

// ── Sub-nav: Overview / Church Report / Daycare Report ─────────────────────────────────
// Button active-state is handled by the shared renderFinanceSubnav() (js-core.js) re-render,
// driven by showTab()'s _finActiveNavId — this only toggles panel visibility.
function finShowSection(section) {
  ['overview', 'church', 'daycare', 'property', 'planning', 'compensation'].forEach(function(s) {
    var panel = document.getElementById('fin-panel-' + s);
    if (panel) panel.style.display = (s === section) ? '' : 'none';
  });
}

// ── Overview dashboard (Finance Workspace redesign, 2026-07) ────────────────────────────────
// A glance-level "are we on budget?" view, switchable between the three domains this church
// actually tracks money for (Church Operating / Daycare / Commercial Property) — NOT a giving-
// fund selector (the design handoff's mockup showed a fund <select>, but this app's Church
// Report data is QuickBooks-chart-of-accounts based, one ledger, with no per-giving-fund budget
// to select between; the three real domains are what the switcher actually maps to). Church and
// Daycare both have a real per-category budget, so they get the full layout (KPIs + "are we on
// budget?" pace panel + trend + year-end projection); Property has no line-item budget to pace
// against (it's landlord actuals/reserves), so it gets KPIs + the revenue/expense trend only.
var _finOverviewDomain = 'church';
var _finOverviewChurchData = null;
var _finOverviewDrillOpen = null; // single-open drilldown category path, church/daycare pace panel
function finOverviewSetDomain(domain) {
  _finOverviewDomain = domain;
  _finOverviewDrillOpen = null;
  finLoadOverviewDomain();
}
function finLoadOverviewDomain() {
  var root = document.getElementById('fin-ov-dashboard');
  if (!root) return;
  root.innerHTML = 'Loading…';
  if (_finOverviewDomain === 'church') {
    var year = new Date().getFullYear();
    api('/admin/api/finance/church/this-year?year=' + year).then(function(d) {
      _finOverviewChurchData = d;
      finRenderOverviewChurch(d);
    }).catch(function() { root.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">Could not load Church Report data.</p>'; });
  } else if (_finOverviewDomain === 'daycare') {
    finRenderOverviewDaycare();
  } else if (_finOverviewDomain === 'property') {
    if (_finProperty) finRenderOverviewProperty(_finProperty);
    else root.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">Loading property data…</p>';
  }
}
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
function finRenderPacePanel(categories, elapsedPct) {
  var elapsedLabel = Math.round(elapsedPct * 100) + '%';
  var rows = categories.map(function(cat) {
    var hasBudget = cat.budgetCents > 0;
    var spentPct = hasBudget ? cat.actualCents / cat.budgetCents : 0;
    var expectedByNowCents = cat.budgetCents * elapsedPct;
    var diffCents = cat.actualCents - expectedByNowCents;
    var status = 'ok', statusLabel = 'On pace', barClass = '';
    if (hasBudget && cat.actualCents > cat.budgetCents) { status = 'over'; statusLabel = 'Over budget'; barClass = 'over'; }
    else if (hasBudget && diffCents > 150000) { status = 'warn'; statusLabel = 'Over pace'; barClass = 'warn'; }
    else if (!hasBudget) { statusLabel = 'No budget'; }
    var chipClass = status === 'over' ? 'fin-chip-negative' : status === 'warn' ? 'fin-chip-warn' : hasBudget ? 'fin-chip-positive' : 'fin-chip-info';
    var open = _finOverviewDrillOpen === cat.path;
    var insetHtml = '';
    if (open && cat.children && cat.children.length) {
      insetHtml = '<div class="fin-pace-inset">' + cat.children.map(function(c) {
        return '<div class="fin-pace-inset-row"><span>' + esc(c.label) + '</span><span>$' + finFmtMoney(c.actualCents/100) + (c.budgetCents > 0 ? ' / $' + finFmtMoney(c.budgetCents/100) : '') + '</span></div>';
      }).join('') + '</div>';
    }
    return '<div class="fin-pace-row' + (open ? ' open' : '') + '" onclick="finOverviewToggleDrill(\'' + esc(cat.path).replace(/'/g, "\\'") + '\')">'
      + '<div class="fin-pace-row-hdr">'
      + '<span><span class="fin-pace-caret">&#9656;</span><span class="fin-pace-label">' + esc(cat.label) + '</span></span>'
      + '<span class="fin-pace-figs">$' + finFmtMoney(cat.actualCents/100) + (hasBudget ? ' / $' + finFmtMoney(cat.budgetCents/100) : '') + ' &nbsp; <span class="fin-chip ' + chipClass + ' fin-pace-status">' + statusLabel + '</span></span>'
      + '</div>'
      + (hasBudget ? '<div class="fin-pace-bar-track"><div class="fin-pace-bar-fill ' + barClass + '" style="width:' + Math.min(100, spentPct*100) + '%;"></div><div class="fin-pace-marker" style="left:' + (elapsedPct*100) + '%;"></div></div>' : '')
      + insetHtml
      + '</div>';
  }).join('');
  return '<div class="fin-card" style="margin-bottom:22px;">'
    + '<div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:10px;">'
    + '<div><div class="fin-card-title">Are we on budget?</div><div class="fin-card-sub" style="margin-bottom:0;">Click a category to see its line items. A bar past the vertical line means spending faster than the calendar.</div></div>'
    + '<div style="font-size:.78rem;color:var(--warm-gray);white-space:nowrap;"><span style="color:var(--color-teal);">&#9632;</span> Spent &nbsp;|&nbsp; <span style="color:var(--color-navy);">&#124;</span> Expected by now (' + elapsedLabel + ')</div>'
    + '</div>'
    + '<div style="margin-top:10px;">' + (rows || '<p style="font-size:.85rem;color:var(--warm-gray);">No expense categories with budget data yet.</p>') + '</div>'
    + '</div>';
}
function finOverviewToggleDrill(path) {
  _finOverviewDrillOpen = (_finOverviewDrillOpen === path) ? null : path;
  finLoadOverviewDomain();
}
function finRenderTrendChart(months, title) {
  if (!months || !months.length) return '';
  var maxVal = 1;
  months.forEach(function(m) { maxVal = Math.max(maxVal, m.incomeCents/100, m.expenseCents/100); });
  var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var bars = months.map(function(m) {
    var incH = Math.max(2, (m.incomeCents/100) / maxVal * 100);
    var expH = Math.max(2, (m.expenseCents/100) / maxVal * 100);
    return '<div class="fin-trend-month"><div class="fin-trend-bar' + (m.projected ? ' projected' : '') + '" style="height:' + incH + '%;" title="Income ' + monthNames[m.month-1] + ': $' + finFmtMoney(m.incomeCents/100) + '"></div>'
      + '<div class="fin-trend-bar expense' + (m.projected ? ' projected' : '') + '" style="height:' + expH + '%;" title="Expenses ' + monthNames[m.month-1] + ': $' + finFmtMoney(m.expenseCents/100) + '"></div></div>';
  }).join('');
  var labels = months.map(function(m) { return '<span>' + monthNames[m.month-1] + '</span>'; }).join('');
  return '<div class="fin-card">'
    + '<div class="fin-card-title" style="font-size:18px;">' + esc(title) + '</div>'
    + '<div style="font-size:.78rem;color:var(--warm-gray);margin-bottom:6px;"><span style="color:var(--color-teal);">&#9632;</span> Income &nbsp; <span style="color:var(--color-gold);">&#9632;</span> Expenses &nbsp; <span style="opacity:.5;">(faded = projected)</span></div>'
    + '<div class="fin-trend-chart">' + bars + '</div>'
    + '<div class="fin-trend-labels">' + labels + '</div>'
    + '</div>';
}
function finRenderYearEndProjection(income, expenses, isStraightLineEstimate) {
  function bar(label, cls, series) {
    if (!series) return '';
    var maxVal = Math.max(series.projectedFullYearCents, series.currentYtdCents, 1);
    var actualPct = Math.min(100, series.currentYtdCents / maxVal * 100);
    var projPct = Math.min(100, series.projectedFullYearCents / maxVal * 100);
    return '<div class="fin-yearend-bar-row ' + cls + '">'
      + '<div class="fin-yearend-bar-lbl"><span>' + label + '</span><span>$' + finFmtMoney(series.projectedFullYearCents/100) + ' projected</span></div>'
      + '<div class="fin-yearend-bar-track"><div class="fin-yearend-bar-projected" style="width:' + projPct + '%;"></div><div class="fin-yearend-bar-actual" style="width:' + actualPct + '%;position:absolute;top:0;left:0;"></div></div>'
      + '</div>';
  }
  var netProjected = (income ? income.projectedFullYearCents : 0) - (expenses ? expenses.projectedFullYearCents : 0);
  var netCls = netProjected >= 0 ? 'positive' : 'negative';
  return '<div class="fin-card">'
    + '<div class="fin-card-title" style="font-size:18px;">Year-End Projection</div>'
    + (income || expenses
      ? bar('Income', 'income', income) + bar('Expenses', 'expense', expenses)
        + '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--warm-row-divider);"><div class="fin-kpi-lbl">Projected surplus / (deficit)</div><div class="fin-navy-val ' + netCls + '" style="color:' + (netProjected >= 0 ? 'var(--sage-text)' : 'var(--danger)') + ';">' + finFmtSigned(netProjected) + '</div></div>'
        + (isStraightLineEstimate ? '<div style="margin-top:8px;font-size:.74rem;color:var(--warm-gray);">Straight-line estimate — no monthly-granularity sync/import data for this year or last year to project the real seasonal pattern from.</div>' : '')
      : '<p style="font-size:.82rem;color:var(--warm-gray);">Not yet available — needs at least one month of monthly-granularity QuickBooks sync data for this year and last year.</p>')
    + '</div>';
}
function finRenderBalancesRow() {
  var overview = _finOverview || {};
  var qboList = ((overview.accounts && overview.accounts.QueryResponse && overview.accounts.QueryResponse.Account) || []);
  function sumMatching(re) {
    return qboList.filter(function(a) { return re.test(a.Name || ''); }).reduce(function(s, a) { return s + (Number(a.CurrentBalance) || 0); }, 0);
  }
  var checking = sumMatching(/checking/i);
  var savings = sumMatching(/saving|reserve/i);
  var reserves = _finProperty ? finComputePropertyReservesOnHandCents(_finProperty) / 100 : 0;
  return '<div class="fin-balance-row">'
    + '<div class="fin-balance-card"><div class="fin-balance-icon">&#127974;</div><div><div class="fin-balance-lbl">Operating Checking</div><div class="fin-balance-val">$' + finFmtMoney(checking) + '</div></div></div>'
    + '<div class="fin-balance-card"><div class="fin-balance-icon">&#128737;</div><div><div class="fin-balance-lbl">Reserves &amp; Savings</div><div class="fin-balance-val">$' + finFmtMoney(savings) + '</div></div></div>'
    + '<div class="fin-balance-card"><div class="fin-balance-icon">&#127968;</div><div><div class="fin-balance-lbl">Ivanhoe Property Reserves</div><div class="fin-balance-val">$' + finFmtMoney(reserves) + '</div></div></div>'
    + '</div>'
    + '<p style="font-size:.72rem;color:var(--warm-gray);margin-top:8px;">Checking/Savings are a best-effort match on QuickBooks account name — see the full Account Balances table below for the authoritative list.</p>';
}

function finRenderOverviewChurch(d) {
  var root = document.getElementById('fin-ov-dashboard');
  var capEl = document.getElementById('fin-ov-caption');
  var pillEl = document.getElementById('fin-ov-sync-pill');
  if (!root) return;
  var elapsedPct = finElapsedYearPct(d.year);
  if (capEl) capEl.textContent = 'Church Operating — ' + d.year + ' · As of today · ' + Math.round(elapsedPct*100) + '% of the fiscal year elapsed';
  if (pillEl) { pillEl.style.display = _finStatus.connected ? 'inline-flex' : 'none'; pillEl.textContent = 'QuickBooks synced ' + (_finOverview.accountsSyncedAt ? finFmtTs(_finOverview.accountsSyncedAt) : 'never'); }

  var income = d.classificationTotals.Income || { actualCents: 0, budgetCents: 0 };
  var expenses = d.classificationTotals.Expenses || { actualCents: 0, budgetCents: 0 };
  var net = d.netIncome || { actualCents: 0, budgetCents: 0 };
  var netVariance = net.actualCents - net.budgetCents;

  var kpis = [
    { lbl: 'Net Position YTD', val: finFmtSigned(net.actualCents), cls: net.actualCents >= 0 ? 'positive' : 'negative',
      chip: d.hasBudgetData ? (finFmtSigned(netVariance) + ' vs. budget') : null, chipCls: netVariance >= 0 ? 'fin-chip-positive' : 'fin-chip-negative', border: net.actualCents >= 0 ? 'var(--sage)' : 'var(--danger)' },
    { lbl: 'Income YTD', val: '$' + finFmtMoney(income.actualCents/100), chip: income.budgetCents > 0 ? (Math.round(income.actualCents/income.budgetCents*100) + '% of $' + finFmtMoney(income.budgetCents/100) + ' budget') : null, chipCls: 'fin-chip-info', border: 'var(--color-teal)' },
    { lbl: 'Expenses YTD', val: '$' + finFmtMoney(expenses.actualCents/100), chip: expenses.budgetCents > 0 ? (Math.round(expenses.actualCents/expenses.budgetCents*100) + '% of $' + finFmtMoney(expenses.budgetCents/100) + ' budget') : null, chipCls: 'fin-chip-warn', border: 'var(--color-gold)' },
    { lbl: 'Projected Year-End', val: d.yoy && d.yoy.available ? finFmtSigned(d.yoy.net.projectedFullYearCents) : '—', chip: d.yoy && d.yoy.available ? ((d.yoy.net.projectedFullYearCents >= 0 ? 'Surplus' : 'Deficit') + ' est. Dec 31' + (d.yoy.seasonal === false ? ' (straight-line estimate)' : '')) : 'Not yet available', chipCls: (d.yoy && d.yoy.available && d.yoy.net.projectedFullYearCents >= 0) ? 'fin-chip-positive' : 'fin-chip-negative', border: (d.yoy && d.yoy.available && d.yoy.net.projectedFullYearCents < 0) ? 'var(--danger)' : 'var(--sage)' },
  ];
  var kpiHtml = '<div class="fin-kpi-grid">' + kpis.map(function(k) {
    return '<div class="fin-kpi-card" style="border-top-color:' + k.border + ';"><div class="fin-kpi-lbl">' + k.lbl + '</div><div class="fin-kpi-val">' + k.val + '</div>'
      + (k.chip ? '<span class="fin-chip ' + k.chipCls + '">' + k.chip + '</span>' : '') + '</div>';
  }).join('') + '</div>';

  var tree = finReorganizeChurchTree(finBuildTreeFromFlatRows(d.entries));
  var expenseRoot = tree.filter(function(n) { return n.classification === 'Expenses'; })[0];
  var categories = ((expenseRoot && expenseRoot.children) || []).map(function(n) {
    return {
      path: n.path, label: n.label, actualCents: n.totalActualCents, budgetCents: n.totalBudgetCents,
      children: (n.children || []).map(function(c) { return { label: c.label, actualCents: c.totalActualCents, budgetCents: c.totalBudgetCents }; }),
    };
  }).sort(function(a, b) { return b.actualCents - a.actualCents; });
  var paceHtml = finRenderPacePanel(categories, elapsedPct);

  var trendHtml = (d.monthlyTrend && d.monthlyTrend.available) ? finRenderTrendChart(d.monthlyTrend.months, 'Income vs. Expenses') : '<div class="fin-card"><div class="fin-card-title" style="font-size:18px;">Income vs. Expenses</div><p style="font-size:.82rem;color:var(--warm-gray);">Not yet available — needs monthly-granularity QuickBooks sync data for this year.</p></div>';
  var projHtml = finRenderYearEndProjection(d.yoy && d.yoy.available ? d.yoy.income : null, d.yoy && d.yoy.available ? d.yoy.expenses : null, d.yoy && d.yoy.available === true && d.yoy.seasonal === false);

  root.innerHTML = kpiHtml + paceHtml
    + '<div style="display:grid;grid-template-columns:1.5fr 1fr;gap:22px;margin-bottom:22px;">' + trendHtml + projHtml + '</div>'
    + '<div class="fin-card-title" style="font-size:18px;margin-bottom:10px;">Balances</div>' + finRenderBalancesRow();
}

function finRenderOverviewDaycare() {
  var root = document.getElementById('fin-ov-dashboard');
  var capEl = document.getElementById('fin-ov-caption');
  var pillEl = document.getElementById('fin-ov-sync-pill');
  if (!root) return;
  if (pillEl) pillEl.style.display = 'none';
  var agg = finAggregateDaycareByYear(_finDaycare, _finDaycareAllocation ? _finDaycareAllocation.allocation : null);
  var year = String(new Date().getFullYear());
  var y = agg.byYear[year];
  var elapsedPct = finElapsedYearPct(new Date().getFullYear());
  if (capEl) capEl.textContent = 'Daycare (MDO) — ' + year + ' · As of today · ' + Math.round(elapsedPct*100) + '% of the fiscal year elapsed';
  if (!y) { root.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">No daycare data yet for ' + year + '. Sync or add entries below.</p>'; return; }
  if (!_finDaycareAllocation && !_finDaycareAllocationLoading) finLoadDaycareAllocation([year]);

  var netVariance = y.netActual - y.netBudget;
  var kpis = [
    { lbl: 'Net Position YTD', val: finFmtSigned(netVariance >= 0 ? y.netActual : y.netActual) === undefined ? '' : (y.netActual >= 0 ? '+' : '-') + '$' + finFmtMoney(Math.abs(y.netActual)), chip: y.netBudget ? ((netVariance >= 0 ? '+' : '-') + '$' + finFmtMoney(Math.abs(netVariance)) + ' vs. budget') : null, chipCls: netVariance >= 0 ? 'fin-chip-positive' : 'fin-chip-negative', border: y.netActual >= 0 ? 'var(--sage)' : 'var(--danger)' },
    { lbl: 'Income YTD', val: '$' + finFmtMoney(y.incomeActual), chip: y.incomeBudget ? (Math.round(y.incomeActual/y.incomeBudget*100) + '% of $' + finFmtMoney(y.incomeBudget) + ' budget') : null, chipCls: 'fin-chip-info', border: 'var(--color-teal)' },
    { lbl: 'Expenses YTD', val: '$' + finFmtMoney(y.expenseActual), chip: y.expenseBudget ? (Math.round(y.expenseActual/y.expenseBudget*100) + '% of $' + finFmtMoney(y.expenseBudget) + ' budget') : null, chipCls: 'fin-chip-warn', border: 'var(--color-gold)' },
    { lbl: 'Net Budgeted (Full Year)', val: '$' + finFmtMoney(y.netBudget), chip: null, border: 'var(--color-navy)' },
  ];
  var kpiHtml = '<div class="fin-kpi-grid">' + kpis.map(function(k) {
    return '<div class="fin-kpi-card" style="border-top-color:' + k.border + ';"><div class="fin-kpi-lbl">' + k.lbl + '</div><div class="fin-kpi-val">' + k.val + '</div>'
      + (k.chip ? '<span class="fin-chip ' + k.chipCls + '">' + k.chip + '</span>' : '') + '</div>';
  }).join('') + '</div>';

  var categories = Object.keys(y.categories).filter(function(c) { return !finIsIncomeCategory(c); }).map(function(c) {
    return { path: c, label: c, actualCents: Math.round(y.categories[c].actual*100), budgetCents: Math.round(y.categories[c].budget*100), children: [] };
  }).sort(function(a, b) { return b.actualCents - a.actualCents; });
  var paceHtml = finRenderPacePanel(categories, elapsedPct);

  root.innerHTML = kpiHtml + paceHtml + '<p style="font-size:.78rem;color:var(--warm-gray);">Full year-by-year detail is in the <b>Daycare Report</b> tab.</p>';
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

function finRenderOverviewProperty(d) {
  var root = document.getElementById('fin-ov-dashboard');
  var capEl = document.getElementById('fin-ov-caption');
  var pillEl = document.getElementById('fin-ov-sync-pill');
  if (!root) return;
  if (pillEl) pillEl.style.display = 'none';
  if (capEl) capEl.textContent = '3277 Ivanhoe — Commercial Property';
  var kpiHtml = finRenderKpiGrid(finComputePropertyKpis(d));

  var chartMonthly = (d.monthly || []).slice().sort(function(a,b){ return a.period < b.period ? -1 : 1; }).slice(-12);
  var budgetByPeriod = {};
  (d.budgetMonthly || []).forEach(function(b) { budgetByPeriod[b.period] = b; });
  var hasBudget = chartMonthly.some(function(m) { return budgetByPeriod[m.period]; });
  var series = hasBudget
    ? [{ key: 'rev', label: 'Revenue', color: '#2E7EA6' }, { key: 'revB', label: 'Rev. Budget', color: '#9FC7DA' }, { key: 'exp', label: 'Expenses', color: '#C9973A' }, { key: 'expB', label: 'Exp. Budget', color: '#E4CB99' }]
    : [{ key: 'rev', label: 'Revenue', color: '#2E7EA6' }, { key: 'exp', label: 'Expenses', color: '#C9973A' }];
  var chartHtml = chartMonthly.length ? renderGroupedBarChart({
    chartH: 200,
    title: 'Revenue vs. Expenses (last ' + chartMonthly.length + ' months)' + (hasBudget ? ' — vs. AHRA budget' : ''),
    groups: chartMonthly.map(function(m) { return { key: m.period, label: m.period.slice(2) }; }),
    series: series,
    value: function(g, s) {
      var m = chartMonthly.filter(function(x) { return x.period === g; })[0];
      var b = budgetByPeriod[g];
      if (s === 'rev') return m.total_revenue_cents == null ? null : m.total_revenue_cents/100;
      if (s === 'exp') return m.total_expenses_cents == null ? null : m.total_expenses_cents/100;
      if (s === 'revB') return b ? b.revenue_cents/100 : null;
      if (s === 'expB') return b ? b.expenses_cents/100 : null;
      return null;
    },
    tooltip: function(g, s, v) { return g + ': $' + finFmtMoney(v); },
  }) : '<p style="font-size:.85rem;color:var(--warm-gray);">No monthly data yet.</p>';

  root.innerHTML = kpiHtml + '<div class="fin-card">' + chartHtml + '</div>'
    + '<p style="font-size:.78rem;color:var(--warm-gray);margin-top:12px;">Full reserves, capital ledger, valuation calculator, and forecast are in the <b>Commercial Property</b> tab.</p>';
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
    document.getElementById('fin-dc-cb-preview').innerHTML = '';
    return api('/admin/api/finance/daycare').then(function(d2) {
      _finDaycare = d2.entries || [];
      finRenderDaycare();
      finRenderDaycareReport();
      if (_finOverviewDomain === 'daycare') finRenderOverviewDaycare();
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
    if (_finOverviewDomain === 'daycare') finRenderOverviewDaycare();
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
  cellEl.innerHTML = '<input type="number" step="0.01" class="fin-editable-input" value="' + esc(current) + '" style="width:90px;text-align:right;" onblur="finDaycareBudgetCellSave(' + year + ',' + volJsAttr(cat) + ',this)" onkeydown="if(event.key===\'Enter\')this.blur();">';
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
    if (_finOverviewDomain === 'daycare') finRenderOverviewDaycare();
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
function finRenderDaycareReport() {
  var el = document.getElementById('fin-daycare-report');
  if (!el) return;
  var allocationByYear = _finDaycareAllocation ? _finDaycareAllocation.allocation : null;
  var agg = finAggregateDaycareByYear(_finDaycare, allocationByYear);
  _finDaycareAgg = agg;
  var otherSourceWarning = finRenderDaycareOtherSourceWarning();
  if (!agg.years.length) {
    el.innerHTML = otherSourceWarning + '<p style="font-size:.85rem;color:var(--warm-gray);">No daycare data yet from the church Budget import. Use "Import from Church Budget (MDO accounts)" in the Overview tab.</p>';
    return;
  }
  if (!_finDaycareAllocation && !_finDaycareAllocationLoading) finLoadDaycareAllocation(agg.years);
  var isAdminUI = (_userRole === 'admin');
  function moneyCell(v, muted) {
    return '<td style="text-align:right;padding:5px 8px;' + (muted ? 'color:var(--warm-gray);' : '') + '">$' + finFmtMoney(v) + '</td>';
  }
  // Budget is directly editable (click to edit) for every category except the two live-derived
  // ones (Utilities/Insurance) — those are always computed from the church side, editing them
  // wouldn't mean anything since finAggregateDaycareByYear recomputes their budget from the
  // allocation percentage as well as any override, matching the "actual only" phrasing this was
  // built to.
  function budgetCell(year, cat, v, editable) {
    if (!editable) return moneyCell(v, true);
    return '<td style="text-align:right;padding:5px 8px;color:var(--warm-gray);cursor:pointer;" data-raw="' + (v || '') + '" title="Click to edit" onclick="finDaycareBudgetCellEdit(' + year + ',' + volJsAttr(cat) + ',this)">$' + finFmtMoney(v) + '</td>';
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
    return '<tr><td style="padding:5px 8px;">' + esc(cat) + (isDerived ? ' <span style="font-size:.68rem;color:var(--warm-gray);" title="Live % of church actual — see the note above">(derived)</span>' : '') + '</td>' + cells + '</tr>';
  }).join('');
  function summaryRow(label, actualKey, budgetKey, bold) {
    var cells = agg.years.map(function(y) {
      var b = agg.byYear[y];
      return moneyCell(b[actualKey]) + moneyCell(b[budgetKey], true);
    }).join('');
    return '<tr' + (bold ? ' style="font-weight:700;border-top:2px solid var(--navy);"' : ' style="font-weight:600;border-top:1px solid var(--border);"') + '>'
      + '<td style="padding:5px 8px;">' + label + '</td>' + cells + '</tr>';
  }
  el.innerHTML = otherSourceWarning
    + finRenderDaycareAllocationConfig()
    + (isAdminUI ? '<p style="font-size:.75rem;color:var(--warm-gray);margin:0 0 10px;">Actual always comes from "Import from Church Budget (MDO accounts)" in the Overview tab — the single source of truth. Click any Budget figure below to edit it directly — useful for a past year whose real budget isn\'t in an imported file.</p>' : '')
    + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead><tr>' + yearHead1 + '</tr><tr style="border-bottom:2px solid var(--navy);">' + yearHead2 + '</tr></thead>'
    + '<tbody>' + catRows
    + summaryRow('Total Income', 'incomeActual', 'incomeBudget', false)
    + summaryRow('Total Expenses', 'expenseActual', 'expenseBudget', false)
    + summaryRow('Net Income', 'netActual', 'netBudget', true)
    + '</tbody></table></div>';
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
// (3) Altar Guild is grouped under a new "Restricted Income" heading,
// (4) any account named "Sales" is hidden from this tree (note: the Church Report's own
//     Total Revenue stat card is computed server-side from ALL rows including Sales, so that
//     one figure and this detail tree can disagree by whatever Sales posted — say so if Sales
//     should be excluded from the real total too, not just hidden here).
// Applied to a cloned copy so the original tree (and any cached totals elsewhere) is untouched.
function finSetNodeDepth(node, depth) {
  node.depth = depth;
  (node.children || []).forEach(function(c) { finSetNodeDepth(c, depth + 1); });
}
function finRemoveNodesByLabel(nodes, labelRe) {
  for (var i = nodes.length - 1; i >= 0; i--) {
    if (labelRe.test(nodes[i].label)) { nodes.splice(i, 1); }
    else { finRemoveNodesByLabel(nodes[i].children, labelRe); }
  }
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
function finReorganizeChurchTree(roots) {
  var cloned = JSON.parse(JSON.stringify(roots || []));
  finRemoveNodesByLabel(cloned, /^sales$/i);
  var earnedChildren = finExtractNodesByLabel(cloned, /^(facility rental|fundraisers|mdo)$/i);
  var restrictedChildren = finExtractNodesByLabel(cloned, /^altar guild$/i);
  var incomeRoot = cloned.filter(function(n) { return n.classification === 'Income'; })[0];
  if (incomeRoot) {
    if (earnedChildren.length) incomeRoot.children.push(finMakeGroupNode('Earned Income', 'Income', earnedChildren));
    if (restrictedChildren.length) incomeRoot.children.push(finMakeGroupNode('Restricted Income', 'Income', restrictedChildren));
    incomeRoot.label = 'Revenue';
  }
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
function finRenderDetailTreeRows(nodes, html) {
  html = html || [];
  (nodes || []).forEach(function(node) {
    var bold = node.children.length > 0;
    html.push('<tr' + (bold ? ' style="font-weight:700;"' : '') + '>'
      + '<td style="padding:5px 8px 5px ' + (10 + node.depth * 16) + 'px;color:' + (bold ? 'var(--charcoal)' : 'var(--warm-ink-label)') + ';">' + esc(node.label) + '</td>'
      + '<td style="text-align:right;padding:5px 8px;">$' + finFmtMoney(node.totalActualCents / 100) + '</td>'
      + '<td style="text-align:right;padding:5px 8px;color:var(--warm-gray);">' + (node.hasBudgetInfo ? '$' + finFmtMoney(node.totalBudgetCents / 100) : '—') + '</td>'
      + finVarianceCell(node.totalActualCents, node.hasBudgetInfo ? node.totalBudgetCents : null, node.classification)
      + '</tr>');
    finRenderDetailTreeRows(node.children, html);
  });
  return html;
}
// A bold "Total X" row for one top-level classification node (Revenue/Expenses/etc), styled to
// read as a subtotal beneath its own account lines rather than a header above them.
function finRenderChurchTotalRow(node, label) {
  return '<tr style="font-weight:700;border-top:1px solid var(--warm-border);background:var(--warm-surface-page);"><td style="padding:6px 8px;">' + esc(label) + '</td>'
    + '<td style="text-align:right;padding:6px 8px;">$' + finFmtMoney(node.totalActualCents / 100) + '</td>'
    + '<td style="text-align:right;padding:6px 8px;color:var(--warm-gray);">' + (node.hasBudgetInfo ? '$' + finFmtMoney(node.totalBudgetCents / 100) : '—') + '</td>'
    + finVarianceCell(node.totalActualCents, node.hasBudgetInfo ? node.totalBudgetCents : null, node.classification)
    + '</tr>';
}
// Full account-detail table body for the Church Report: each top-level classification's own
// account lines first, with its "Total X" subtotal moved to the END of that section (not a
// header row above it, per the board's preferred reading order). The grand-total Net Income
// figure — mirroring the same actual/budget/remaining shown in the summary card above, so the
// two can never disagree — is rendered separately as a full-width navy bar (finRenderNetIncomeBar),
// matching the Finance Workspace handoff's footer treatment, not as a table row.
function finRenderChurchDetailBody(tree, netIncome, hasBudgetData) {
  var html = [];
  (tree || []).forEach(function(root) {
    html = html.concat(finRenderDetailTreeRows(root.children));
    html.push(finRenderChurchTotalRow(root, 'Total ' + root.label));
  });
  return html.join('');
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

function finSetChurchReportMode(mode) {
  _finChurchMode = mode;
  var yearEl = document.getElementById('fin-church-year-view');
  var multiEl = document.getElementById('fin-church-multiyear-view');
  var balEl = document.getElementById('fin-church-balances-view');
  if (yearEl) yearEl.style.display = mode === 'year' ? '' : 'none';
  if (multiEl) multiEl.style.display = mode === 'multiyear' ? '' : 'none';
  if (balEl) balEl.style.display = mode === 'balances' ? '' : 'none';
  var yearBtn = document.getElementById('fin-church-mode-year');
  var multiBtn = document.getElementById('fin-church-mode-multiyear');
  var balBtn = document.getElementById('fin-church-mode-balances');
  if (yearBtn) yearBtn.classList.toggle('active', mode === 'year');
  if (multiBtn) multiBtn.classList.toggle('active', mode === 'multiyear');
  if (balBtn) balBtn.classList.toggle('active', mode === 'balances');
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
    _finChurchThisYearData = d;
    finRenderChurchThisYear(d);
  }).catch(function(err) {
    if (err && err.message === 'Unauthorized') return;
    el.innerHTML = '<p style="font-size:.85rem;color:var(--danger);">Could not load this year’s church data.</p>';
  });
}

// One This Year summary card: actual figure, plus (only if any budget is known for the year)
// the annual budget, remaining amount, and a simple over/under progress bar.
function finChurchSummaryCard(label, totals, hasBudget) {
  var actual = totals.actualCents, budget = totals.budgetCents;
  var remaining = budget - actual;
  var pct = budget > 0 ? Math.round(actual * 100 / budget) : null;
  var borderColor = /revenue|income/i.test(label) && !/net/i.test(label) ? 'var(--color-teal)' : /expense/i.test(label) ? 'var(--color-gold)' : (remaining >= 0 ? 'var(--sage)' : 'var(--danger)');
  var html = '<div class="fin-kpi-card" style="flex:1;min-width:170px;border-top-color:' + borderColor + ';">'
    + '<div class="fin-kpi-lbl">' + label + '</div>'
    + '<div class="fin-kpi-val">$' + finFmtMoney(actual / 100) + '</div>';
  if (hasBudget) {
    var chipCls = remaining < 0 ? 'fin-chip-negative' : 'fin-chip-positive';
    html += '<span class="fin-chip ' + chipCls + '">' + (remaining < 0 ? 'Over by $' + finFmtMoney(-remaining / 100) : '$' + finFmtMoney(remaining / 100) + ' remaining') + '</span>'
      + '<div class="fin-kpi-sub">Budget: $' + finFmtMoney(budget / 100) + '</div>';
    if (pct != null) {
      var barColor = pct > 100 ? 'var(--danger)' : pct > 85 ? 'var(--color-gold)' : 'var(--color-teal)';
      html += '<div class="fin-pace-bar-track" style="margin-top:8px;"><div class="fin-pace-bar-fill" style="width:' + Math.min(100, pct) + '%;background:' + barColor + ';"></div></div>';
    }
  } else {
    html += '<div class="fin-kpi-sub">No budget data for this year</div>';
  }
  return html + '</div>';
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
function finRenderChurchThisYear(d) {
  var el = document.getElementById('fin-church-year-view');
  if (!el) return;
  if (!d || !d.entries || !d.entries.length) {
    el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">No church report data yet for ' + d.year + '. Connect QuickBooks in the Overview tab and click "Sync Now".</p>';
    return;
  }
  var income = d.classificationTotals['Income'] || { actualCents: 0, budgetCents: 0 };
  var expenses = d.classificationTotals['Expenses'] || { actualCents: 0, budgetCents: 0 };
  var asOfDate = finChurchAsOfDate(d.entries);
  var html = '<div style="font-size:.78rem;color:var(--warm-gray);margin-bottom:12px;">' + d.year + (asOfDate ? ' &bull; YTD actuals as of ' + asOfDate : '') + '</div>'
    + '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:18px;">'
    + finChurchSummaryCard('Total Revenue', income, d.hasBudgetData)
    + finChurchSummaryCard('Total Expenses', expenses, d.hasBudgetData)
    + finChurchSummaryCard('Net Income', d.netIncome, d.hasBudgetData)
    + '</div>'
    + '<div style="font-size:.82rem;color:var(--warm-gray);background:var(--linen);border-radius:8px;padding:10px 14px;margin-bottom:18px;">'
    + '<b>Giving (ChMS records):</b> $' + finFmtMoney(d.givingCents / 100)
    + ' <span style="font-size:.75rem;">— shown for reference only. QuickBooks’ Revenue figure above reflects what has cleared the bank and been fully recorded, so timing differences from ChMS’s own recorded giving are expected, not a discrepancy to chase.</span>'
    + (d.givingByFund && d.givingByFund.length ? '<table style="width:100%;border-collapse:collapse;font-size:.78rem;margin-top:8px;">'
        + d.givingByFund.map(function(f) {
            return '<tr><td style="padding:2px 8px 2px 0;">' + esc(f.fundName) + '</td><td style="padding:2px 0;text-align:right;">$' + finFmtMoney(f.cents / 100) + '</td></tr>';
          }).join('')
        + '</table>' : '')
    + '</div>'
    + finRenderYoyBlock(d.yoy)
    + finRenderSuppliesChart(d);

  var tree = finReorganizeChurchTree(finBuildTreeFromFlatRows(d.entries));
  var incomePie = finPieItemsFromTree(tree, 'Income', 'totalActualCents');
  var expensePie = finPieItemsFromTree(tree, 'Expenses', 'totalActualCents');
  if (incomePie.length || expensePie.length) {
    html += '<div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:18px;">'
      + '<div style="flex:1;min-width:280px;"><h4 style="margin:0 0 8px;font-family:var(--font-head);color:var(--steel-anchor);font-size:.9rem;">Revenue Sources</h4>'
      + (incomePie.length ? renderPieChart(incomePie, 170) : '<p style="font-size:.82rem;color:var(--warm-gray);">No revenue data yet.</p>') + '</div>'
      + '<div style="flex:1;min-width:280px;"><h4 style="margin:0 0 8px;font-family:var(--font-head);color:var(--steel-anchor);font-size:.9rem;">Expense Categories</h4>'
      + (expensePie.length ? renderPieChart(expensePie, 170) : '<p style="font-size:.82rem;color:var(--warm-gray);">No expense data yet.</p>') + '</div>'
      + '</div>';
  }
  html += '<details><summary style="font-size:.82rem;color:var(--warm-gray);cursor:pointer;">Full account detail' + (asOfDate ? ' <span style="font-weight:400;">— YTD as of ' + esc(asOfDate) + '</span>' : '') + '</summary>'
    + '<div class="fin-card" style="padding:0;overflow:hidden;margin-top:10px;">'
    + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead><tr style="background:var(--warm-surface-header);"><th style="text-align:left;padding:8px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);">Account</th><th style="text-align:right;padding:8px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);">YTD Actual</th><th style="text-align:right;padding:8px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);">Budget</th><th style="text-align:right;padding:8px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-meta);">Variance</th></tr></thead>'
    + '<tbody>' + finRenderChurchDetailBody(tree, d.netIncome, d.hasBudgetData) + '</tbody></table></div>'
    + finRenderNetIncomeBar(d.netIncome, d.hasBudgetData)
    + '</div></details>';
  el.innerHTML = html;
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
  var rowsDef = [{ label: 'Total Revenue', key: 'Income' }, { label: 'Cost of Goods Sold', key: 'Cost of Goods Sold' }, { label: 'Total Expenses', key: 'Expenses' }];
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
function finLoadChurchBalances(year) {
  year = year || new Date().getFullYear();
  var el = document.getElementById('fin-church-balances-view');
  if (!el) return;
  el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">Loading…</p>';
  Promise.all([
    api('/admin/api/finance/church/balances?year=' + year),
    api('/admin/api/finance/church/balances/multi-year'),
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
function finRenderChurchBalances(d, multiYear) {
  var el = document.getElementById('fin-church-balances-view');
  if (!el) return;
  if (!d || !d.rows || !d.rows.length) {
    el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">No balance sheet imported yet for ' + d.year + '. Click "Import Balance Sheet" above to upload one.</p>';
    return;
  }
  var s = d.summary;
  var offCents = s.balancedCents;
  var checkHtml = Math.abs(offCents) < 1
    ? '<span style="color:var(--sage);">✓ Balances (Assets = Liabilities + Equity)</span>'
    : '<span style="color:var(--danger);">⚠ Off by $' + finFmtMoney(Math.abs(offCents) / 100) + ' — check the import for a missing or misclassified account.</span>';
  var html = '<div style="font-size:.78rem;color:var(--warm-gray);margin-bottom:12px;">As of ' + esc(d.asOfDate || d.year) + '</div>'
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
      statusEl.textContent = 'Parsed "' + d.sheetName + '" — fiscal year ' + d.fiscalYear + ', ' + d.months.length + ' month(s), ' + d.rows.length + ' account/month row(s).'
        + (d.skipped.length ? ' ' + d.skipped.length + ' line(s) not recognized as accounts (shown below).' : '');
      previewEl.innerHTML = finChurchRenderMonthlyImportPreview(d);
      confirmBtn.style.display = '';
    })
    .catch(function(err) {
      if (err.message !== 'Unauthorized') statusEl.textContent = 'Error: ' + err.message;
    });
}

function finChurchRenderMonthlyImportPreview(d) {
  var byPath = {};
  var order = [];
  d.rows.forEach(function(r) {
    if (!byPath[r.category_path]) { byPath[r.category_path] = { row: r, months: {} }; order.push(r.category_path); }
    byPath[r.category_path].months[r.period_month] = r.own_actual_cents;
  });
  var monthHeaders = d.months.map(function(m) { return '<th style="text-align:right;padding:4px 6px;">' + m + '</th>'; }).join('');
  var rowsHtml = order.map(function(path) {
    var entry = byPath[path];
    var cells = d.months.map(function(m) {
      var v = entry.months[m];
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
    + monthHeaders + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>'
    + skippedHtml;
}

function finChurchConfirmMonthlyImport() {
  if (!_finChurchMonthlyImportPreview) return;
  var btn = document.getElementById('fin-church-monthly-import-confirm-btn');
  btn.disabled = true;
  api('/admin/api/finance/church/monthly-import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fiscal_year: _finChurchMonthlyImportPreview.fiscalYear, rows: _finChurchMonthlyImportPreview.rows }),
  }).then(function(d) {
    btn.disabled = false;
    if (d && d.error) { finToast('Import failed: ' + d.error); return; }
    closeModal('fin-church-monthly-import-modal');
    finToast('Imported ' + d.imported + ' monthly row(s) for ' + d.fiscalYear + '.');
    finRenderChurchReport();
    if (_finOverviewDomain === 'church') finLoadOverviewDomain();
  }).catch(function(err) {
    btn.disabled = false;
    if (err && err.message !== 'Unauthorized') finToast('Import failed: ' + (err.message || 'Unknown error'));
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
    if (_finOverviewDomain === 'church') finLoadOverviewDomain();
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
    (d.givingByFund || []).forEach(function(f) {
      rows.push(['  ' + f.fundName, (f.cents / 100).toFixed(2)]);
    });
  } else if (_finChurchMode === 'multiyear' && _finChurchMultiYearData) {
    var md = _finChurchMultiYearData;
    var years = md.years || [];
    rows.push(['Category'].concat(years));
    [['Total Revenue', 'Income'], ['Cost of Goods Sold', 'Cost of Goods Sold'], ['Total Expenses', 'Expenses']].forEach(function(rd) {
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
function finCsvCell(v) {
  var s = String(v == null ? '' : v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function finDownloadCsv(filename, rows) {
  var csv = rows.map(function(r) { return r.map(finCsvCell).join(','); }).join('\n');
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
    finRenderDaycareMdoNote();
    if (_finOverviewDomain === 'property') finRenderOverviewProperty(d);
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

// ── Cash Flow & Mortgage Payoff Forecast ─────────────────────────────────────────────────────
// Amortizes the loan forward from its current balance/rate/payment to estimate a payoff date,
// then projects post-payoff annual cash flow using the trailing-12-month average net income.
// The "post-payoff" figure ASSUMES the mortgage payment is already being subtracted somewhere
// in AHRA's reported Net Income — that assumption is stated in the UI rather than hidden,
// since it wasn't independently confirmed against AHRA's own bookkeeping.
function finComputeMortgageAmortization(loan) {
  if (!loan || !loan.balance_cents || !loan.interest_rate_pct || !loan.monthly_payment_cents) return null;
  var balance = loan.balance_cents, monthlyRate = loan.interest_rate_pct / 12, payment = loan.monthly_payment_cents;
  var months = 0, totalInterestCents = 0;
  while (balance > 0 && months < 600) {
    var interest = balance * monthlyRate;
    var principal = payment - interest;
    if (principal <= 0) return null; // payment doesn't cover interest — can't project a payoff
    balance -= principal;
    totalInterestCents += interest;
    months++;
  }
  var payoffDate = new Date();
  payoffDate.setMonth(payoffDate.getMonth() + months);
  return { months: months, totalInterestCents: Math.round(totalInterestCents), payoffDate: payoffDate };
}
function finRenderPropertyForecast(d) {
  var loan = (d.meta && d.meta.loan) || {};
  var monthly = (d.monthly || []).slice().sort(function(a,b){ return a.period < b.period ? -1 : 1; }).slice(-12);
  var withNet = monthly.filter(function(m) { return m.net_income_cents != null || m.net_operating_income_cents != null; });
  var avgMonthlyCents = withNet.length
    ? withNet.reduce(function(sum, m) { return sum + (m.net_income_cents != null ? m.net_income_cents : m.net_operating_income_cents); }, 0) / withNet.length
    : 0;
  var avgAnnualCents = avgMonthlyCents * 12;
  var amort = finComputeMortgageAmortization(loan);
  var statsHtml = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin:10px 0;">'
    + '<div class="rpt-stat"><div class="rpt-stat-num">$' + finFmtMoney(avgAnnualCents/100) + '</div><div class="rpt-stat-lbl">Avg. Annual Net Income (trailing 12mo)</div></div>'
    + (amort
      ? '<div class="rpt-stat"><div class="rpt-stat-num">' + amort.payoffDate.toLocaleDateString('en-US', {month:'short', year:'numeric'}) + '</div><div class="rpt-stat-lbl">Projected Mortgage Payoff (~' + amort.months + ' mo)</div></div>'
        + '<div class="rpt-stat"><div class="rpt-stat-num">$' + finFmtMoney(amort.totalInterestCents/100) + '</div><div class="rpt-stat-lbl">Remaining Interest</div></div>'
        + '<div class="rpt-stat"><div class="rpt-stat-num">$' + finFmtMoney((avgAnnualCents + (loan.annual_debt_service_cents||0))/100) + '</div><div class="rpt-stat-lbl">Potential Annual Net Income After Payoff</div></div>'
      : '')
    + '</div>';
  var note = amort
    ? '<p style="font-size:.72rem;color:var(--warm-gray);margin:0 0 4px;"><i>"Potential Annual Net Income After Payoff" assumes the current annual debt service ($' + finFmtMoney((loan.annual_debt_service_cents||0)/100) + ') is already being paid out of the reported Net Income above — that hasn’t been independently confirmed against AHRA’s bookkeeping, so treat this as a planning estimate, not a guarantee.</i></p>'
    : '<p style="font-size:.72rem;color:var(--warm-gray);margin:0 0 4px;">Mortgage payoff can’t be projected — the loan balance, interest rate, or monthly payment isn’t set (or the payment doesn’t cover the interest).</p>';
  return '<h4 style="margin:18px 0 8px;font-size:.9rem;">Cash Flow &amp; Mortgage Payoff Forecast</h4>' + statsHtml + note;
}

// ── Editable Valuation Calculator (income-capitalization method — the same formula and
// itemization as AHRA's actual valuation worksheet, 3277_Ivanhoe_Valuation_2.xlsx: a per-tenant
// rent roll + itemized operating costs, reconciled exactly against that worksheet). Lets staff
// update rents, costs, vacancy, management fee %, and cap rate themselves going forward without
// needing AHRA's spreadsheet — saves via the existing meta PATCH route (no new backend route). ──
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
var _finValRentRoll = [];
function finRenderValuationCalculator(d, isAdminUI) {
  var val = (d.meta && d.meta.valuation) || {};
  _finValRentRoll = (val.rent_roll || []).map(function(r) { return { tenant: r.tenant || '', sqft: r.sqft || 0, annual_rent_cents: r.annual_rent_cents || 0 }; });
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

  var statsHtml = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin:10px 0;" id="fin-val-output">'
    + '<div class="rpt-stat"><div class="rpt-stat-num" id="fin-val-gross">$' + finFmtMoney((val.gross_rental_income_cents||0)/100) + '</div><div class="rpt-stat-lbl">Gross Rental Income</div></div>'
    + '<div class="rpt-stat"><div class="rpt-stat-num" id="fin-val-costs">$' + finFmtMoney((val.total_operating_costs_incl_mgmt_fee_cents||0)/100) + '</div><div class="rpt-stat-lbl">Total Operating Costs</div></div>'
    + '<div class="rpt-stat"><div class="rpt-stat-num" id="fin-val-noi">$' + finFmtMoney((val.net_operating_income_cents||0)/100) + '</div><div class="rpt-stat-lbl">Net Operating Income</div></div>'
    + '<div class="rpt-stat"><div class="rpt-stat-num" id="fin-val-cv">$' + finFmtMoney((val.capitalized_value_cents||0)/100) + '</div><div class="rpt-stat-lbl">Capitalized Value</div></div>'
    + '</div>';

  var actionsHtml = isAdminUI
    ? '<button class="btn-primary" style="font-size:.78rem;padding:5px 12px;" onclick="finValSave()">Save Valuation</button> <span id="fin-val-save-msg" style="font-size:.75rem;color:var(--warm-gray);margin-left:8px;"></span>'
    : '';
  var asOf = val.as_of_date ? '<p style="font-size:.72rem;color:var(--warm-gray);margin:0 0 8px;">As of ' + esc(val.as_of_date) + '.</p>' : '';

  return '<h4 style="margin:18px 0 8px;font-size:.9rem;">Valuation Calculator</h4>' + asOf
    + '<div style="font-weight:600;font-size:.82rem;margin:0 0 6px;">Rent Roll</div>'
    + finRenderRentRollTable(isAdminUI)
    + (isAdminUI ? '<button class="btn-secondary" style="font-size:.75rem;padding:3px 10px;margin-top:6px;" onclick="finValAddTenant()">+ Add Tenant</button>' : '')
    + '<div style="font-weight:600;font-size:.82rem;margin:14px 0 6px;">Operating Costs</div>'
    + '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">' + opCostInputs + '</div>'
    + assumptionsHtml + statsHtml + actionsHtml;
}
function finRenderRentRollTable(isAdminUI) {
  var rows = _finValRentRoll.map(function(r, i) {
    return '<tr>'
      + '<td style="padding:3px 6px;"><input type="text" id="fin-val-rr-' + i + '-tenant" value="' + esc(r.tenant) + '" oninput="finValRentRollFieldChange(' + i + ',\'tenant\',this.value)" ' + (isAdminUI ? '' : 'disabled') + ' style="width:160px;"></td>'
      + '<td style="padding:3px 6px;"><input type="number" id="fin-val-rr-' + i + '-sqft" value="' + r.sqft + '" oninput="finValRentRollFieldChange(' + i + ',\'sqft\',this.value)" ' + (isAdminUI ? '' : 'disabled') + ' style="width:90px;"></td>'
      + '<td style="padding:3px 6px;"><input type="number" id="fin-val-rr-' + i + '-rent" step="0.01" value="' + (r.annual_rent_cents/100) + '" oninput="finValRentRollFieldChange(' + i + ',\'annual_rent_cents\',this.value)" ' + (isAdminUI ? '' : 'disabled') + ' style="width:120px;"></td>'
      + (isAdminUI ? '<td style="padding:3px 6px;"><button class="btn-secondary" style="font-size:.7rem;padding:2px 6px;color:var(--danger);" onclick="finValRemoveTenant(' + i + ')">Remove</button></td>' : '')
      + '</tr>';
  }).join('');
  return '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;" id="fin-val-rentroll-table">'
    + '<thead style="border-bottom:1px solid var(--border);"><tr><th style="text-align:left;padding:4px 6px;">Tenant</th><th style="text-align:left;padding:4px 6px;">SF</th><th style="text-align:left;padding:4px 6px;">Annual Rent ($)</th>' + (isAdminUI ? '<th></th>' : '') + '</tr></thead>'
    + '<tbody id="fin-val-rentroll-body">' + (rows || '<tr><td colspan="4" style="padding:6px;color:var(--warm-gray);">No tenants recorded yet.</td></tr>') + '</tbody></table></div>';
}
function finValRentRollFieldChange(i, field, value) {
  if (!_finValRentRoll[i]) return;
  _finValRentRoll[i][field] = field === 'tenant' ? value : (field === 'annual_rent_cents' ? Math.round((parseFloat(value)||0) * 100) : (parseInt(value, 10) || 0));
  finValRecompute();
}
function finValAddTenant() {
  _finValRentRoll.push({ tenant: '', sqft: 0, annual_rent_cents: 0 });
  document.getElementById('fin-val-rentroll-body').outerHTML = finRenderRentRollTable(true).match(/<tbody[\s\S]*<\/tbody>/)[0];
  finValRecompute();
}
function finValRemoveTenant(i) {
  _finValRentRoll.splice(i, 1);
  document.getElementById('fin-val-rentroll-body').outerHTML = finRenderRentRollTable(true).match(/<tbody[\s\S]*<\/tbody>/)[0];
  finValRecompute();
}
function finValReadInputs() {
  var opCosts = {};
  FIN_VAL_OP_COST_FIELDS.forEach(function(f) {
    var el = document.getElementById('fin-val-oc-' + f[0]);
    opCosts[f[0]] = el ? Math.round((parseFloat(el.value)||0) * 100) : 0;
  });
  return {
    rentRoll: _finValRentRoll,
    utility_reimbursement_cents: Math.round((parseFloat(document.getElementById('fin-val-utilreimb').value)||0) * 100),
    vacancy_rate_pct: (parseFloat(document.getElementById('fin-val-vacancy').value)||0) / 100,
    operating_costs: opCosts,
    management_fee_pct: (parseFloat(document.getElementById('fin-val-mgmtfee').value)||0) / 100,
    cap_rate: parseFloat(document.getElementById('fin-val-caprate').value) || 0,
  };
}
function finValRecompute() {
  var out = finComputePropertyValuation(finValReadInputs());
  document.getElementById('fin-val-gross').textContent = '$' + finFmtMoney(out.grossRentalIncomeCents/100);
  document.getElementById('fin-val-costs').textContent = '$' + finFmtMoney(out.totalOperatingCostsCents/100);
  document.getElementById('fin-val-noi').textContent = '$' + finFmtMoney(out.noiCents/100);
  document.getElementById('fin-val-cv').textContent = '$' + finFmtMoney(out.capitalizedValueCents/100);
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
      if (textEl) textEl.value = '';
      finLoadProperty();
    })
    .catch(function(err) { if (statusEl) statusEl.textContent = err && err.message || 'Import failed.'; });
}

// "Available for Distribution" — the Finance Workspace handoff's Property-tab navy footer bar:
// this year's net income, less what was set aside into reserves and committed to capital
// projects this year. A computed ESTIMATE for planning purposes — distinct from "Distributions
// to Church" below, which is the actual historical record of amounts already sent.
function finComputeAvailableForDistribution(d) {
  var year = new Date().getFullYear();
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
  return { year: year, annualNetCents: annualNetCents, reserveContribCents: reserveContribCents, capitalCents: capitalCents, availableCents: annualNetCents - reserveContribCents - capitalCents };
}
// "Amount Dispersed" — this calendar year's actual confirmed distributions already sent to the
// church (from the Distributions to Church record below), distinct from the estimate above.
function finComputeDistributedThisYear(d) {
  var year = new Date().getFullYear();
  var cents = (d.distributions || []).filter(function(dd) { return String(dd.period || '').slice(0, 4) === String(year); })
    .reduce(function(sum, dd) { return sum + (dd.amount_cents || 0); }, 0);
  return { year: year, cents: cents };
}
function finRenderAvailableForDistributionBar(d) {
  var a = finComputeAvailableForDistribution(d);
  var dispersed = finComputeDistributedThisYear(d);
  // The KPI row above shows two other reserve/distribution figures that intentionally differ from
  // this one; spell out the relationship here so the page doesn't look like it contradicts itself.
  var onHand = finComputePropertyReservesOnHandCents(d);
  var latestDist = finComputeLatestDistributionAmount(d);
  var recon = '';
  if (onHand) recon += 'The &ldquo;Reserves On-Hand&rdquo; tile above ($' + finFmtMoney(onHand/100) + ') is the total reserve <i>balance</i> AHRA is holding, including the flat base-minimum cash cushion carried over from prior years &mdash; not the same thing as the ' + a.year + ' contributions deducted here.';
  if (latestDist) recon += (recon ? ' ' : '') + 'The &ldquo;Distribution Amount&rdquo; tile ($' + finFmtMoney(latestDist.cents/100) + ') is AHRA&rsquo;s own cash-on-hand-minus-reserves figure for ' + latestDist.period + ' alone; this card is a full-year accrual estimate, so the two will not agree.';
  return '<div class="fin-navy-card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px;margin:18px 0;">'
    + '<div style="max-width:340px;"><div class="fin-card-title" style="font-size:18px;">Available for Distribution</div>'
    + '<div style="font-size:.8rem;color:rgba(255,255,255,.75);">' + a.year + ' net income, less amounts set aside for reserves and committed to capital projects this year. An estimate for planning — see "Distributions to Church" below for the actual record.</div>'
    + (recon ? '<div style="font-size:.72rem;color:rgba(255,255,255,.6);margin-top:8px;">' + recon + '</div>' : '')
    + '<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.3);"><div style="font-size:.75rem;color:rgba(255,255,255,.75);">Amount Dispersed (' + dispersed.year + ', confirmed)</div><div class="fin-navy-val positive" style="font-size:22px;">$' + finFmtMoney(dispersed.cents/100) + '</div></div>'
    + '</div>'
    + '<div style="text-align:right;">'
    + '<div style="font-size:.82rem;color:rgba(255,255,255,.75);">Annual Net (' + a.year + ' YTD) &nbsp; $' + finFmtMoney(a.annualNetCents/100) + '</div>'
    + '<div style="font-size:.82rem;color:var(--negative-on-navy);">&minus; Reserve contributions (' + a.year + ') &nbsp; $' + finFmtMoney(a.reserveContribCents/100) + '</div>'
    + '<div style="font-size:.82rem;color:var(--negative-on-navy);">&minus; Capital spend (' + a.year + ') &nbsp; $' + finFmtMoney(a.capitalCents/100) + '</div>'
    + '<div style="border-top:1px solid rgba(255,255,255,.3);margin:6px 0;"></div>'
    + '<div class="fin-navy-val ' + (a.availableCents >= 0 ? 'positive' : 'negative') + '" style="font-size:30px;">$' + finFmtMoney(a.availableCents/100) + '</div>'
    + '</div></div>';
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
function finRenderProperty(d) {
  var el = document.getElementById('fin-property-root');
  if (!el || !d) return;
  var meta = d.meta || {};
  var prop = meta.property || {};
  var val = meta.valuation || {};
  var loan = meta.loan || {};
  var isAdminUI = (_userRole === 'admin');

  var kpiHtml = finRenderKpiGrid(finComputePropertyKpis(d));

  var mortgageRemaining = finComputeMortgageRemainingCents(loan, d.monthly || []);
  var valueCents = val.capitalized_value_cents || 0;
  var equityCents = mortgageRemaining.cents != null ? (valueCents - mortgageRemaining.cents) : null;
  var ltvPct = (valueCents && mortgageRemaining.cents != null) ? (mortgageRemaining.cents / valueCents) : null;

  var statsHtml = '<h4 style="margin:0 0 8px;font-size:.85rem;color:var(--warm-meta);">Valuation &amp; Equity</h4><div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">'
    + '<div class="rpt-stat"><div class="rpt-stat-num">$' + finFmtMoney(valueCents/100) + '</div><div class="rpt-stat-lbl">Valuation</div></div>'
    + '<div class="rpt-stat"><div class="rpt-stat-num">$' + finFmtMoney((mortgageRemaining.cents||0)/100) + '</div><div class="rpt-stat-lbl">Mortgage Remaining' + (mortgageRemaining.asOf ? ' <span style="font-weight:400;">(as of ' + esc(mortgageRemaining.asOf) + ')</span>' : '') + '</div></div>'
    + '<div class="rpt-stat"><div class="rpt-stat-num">' + (equityCents != null ? '$' + finFmtMoney(equityCents/100) : '—') + '</div><div class="rpt-stat-lbl">Equity</div></div>'
    + '<div class="rpt-stat"><div class="rpt-stat-num">' + (ltvPct != null ? (ltvPct*100).toFixed(1) + '%' : '—') + '</div><div class="rpt-stat-lbl">Loan-to-Value</div></div>'
    + '</div>'
    + (mortgageRemaining.monthsApplied.length ? '<p style="font-size:.72rem;color:var(--warm-gray);margin:-10px 0 16px;">Mortgage Remaining rolled forward from the $' + finFmtMoney((loan.balance_cents||0)/100) + ' lender-confirmed balance (' + esc(loan.balance_as_of_date) + ') using ' + mortgageRemaining.monthsApplied.length + ' month(s) of real principal payments (' + mortgageRemaining.monthsApplied.map(esc).join(', ') + ') — no new lender confirmation needed.</p>' : '');

  var infoHtml = '<p style="font-size:.82rem;color:var(--warm-gray);margin:0 0 4px;"><b>' + esc(prop.name || '3277 Ivanhoe') + '</b> — ' + esc(prop.type || '') + '. Owned by ' + esc(prop.owner || 'Timothy Lutheran Church') + '. Managed by ' + esc(prop.property_manager || '') + '.</p>'
    + (val.as_of_date ? '<p style="font-size:.75rem;color:var(--warm-gray);margin:0 0 2px;">Valuation as of ' + esc(val.as_of_date) + ' (' + esc(val.method || '') + ').</p>' : '')
    + (loan.note ? '<p style="font-size:.75rem;color:var(--warm-gray);margin:0 0 2px;"><i>' + esc(loan.note) + '</i></p>' : '')
    + ((prop.known_data_gaps && prop.known_data_gaps.length) ? '<p style="font-size:.75rem;color:var(--warm-gray);margin:0 0 2px;">Known data gaps: ' + prop.known_data_gaps.map(esc).join(', ') + '.</p>' : '')
    + (prop.pre_ahra_history_note ? '<p style="font-size:.75rem;color:var(--warm-gray);margin:8px 0 0;">' + esc(prop.pre_ahra_history_note) + '</p>' : '');

  // Annual summary
  var years = (d.annualSummary || []).slice().sort(function(a,b){ return b.year - a.year; });
  var annualRows = years.map(function(y) {
    return '<tr><td style="padding:6px 8px;font-weight:600;">' + y.year + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">$' + finFmtMoney(y.total_revenue_cents/100) + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">$' + finFmtMoney(y.total_expenses_cents/100) + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">$' + finFmtMoney(y.net_income_cents/100) + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">' + (y.avg_occupancy_pct != null ? (y.avg_occupancy_pct*100).toFixed(1)+'%' : '—') + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">$' + finFmtMoney(y.confirmed_distributions_cents/100) + '</td>'
      + '<td style="padding:6px 8px;font-size:.78rem;color:var(--warm-gray);">' + esc(y.notes || '') + '</td></tr>';
  }).join('');
  var annualHtml = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr><th style="text-align:left;padding:6px 8px;">Year</th><th style="text-align:right;padding:6px 8px;">Revenue</th><th style="text-align:right;padding:6px 8px;">Expenses</th><th style="text-align:right;padding:6px 8px;">Net Income</th><th style="text-align:right;padding:6px 8px;">Avg Occ.</th><th style="text-align:right;padding:6px 8px;">Distributions to Church</th><th style="text-align:left;padding:6px 8px;">Notes</th></tr></thead>'
    + '<tbody>' + (annualRows || '<tr><td colspan="7" style="padding:10px;color:var(--warm-gray);">No data yet.</td></tr>') + '</tbody>'
    + '</table></div>';

  // Monthly financials
  var monthly = (d.monthly || []).slice().sort(function(a,b){ return a.period < b.period ? 1 : -1; });
  function cell(cents) { return cents == null ? '<span style="color:var(--warm-gray);">—</span>' : '$' + finFmtMoney(cents/100); }
  var monthRows = monthly.map(function(m) {
    return '<tr><td style="padding:5px 8px;font-weight:600;">' + esc(m.period) + '</td>'
      + '<td style="padding:5px 8px;text-align:right;">' + (m.occupancy_pct != null ? (m.occupancy_pct*100).toFixed(1)+'%' : '—') + '</td>'
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
    + '<tbody>' + (monthRows || '<tr><td colspan="9" style="padding:10px;color:var(--warm-gray);">No months recorded yet.</td></tr>') + '</tbody>'
    + '</table></div>';

  // Distributions to church
  var dists = (d.distributions || []).slice().sort(function(a,b){ return a.period < b.period ? 1 : -1; });
  var distRows = dists.map(function(dd) {
    return '<tr><td style="padding:5px 8px;">' + esc(dd.period) + '</td><td style="padding:5px 8px;text-align:right;">$' + finFmtMoney(dd.amount_cents/100) + '</td>'
      + (isAdminUI ? '<td style="padding:5px 8px;"><button class="btn-secondary" style="font-size:.72rem;padding:2px 6px;color:var(--danger);" onclick="finPropertyDeleteDistribution(\'' + esc(dd.period) + '\')">Delete</button></td>' : '') + '</tr>';
  }).join('');
  var distHtml = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr><th style="text-align:left;padding:6px 8px;">Period</th><th style="text-align:right;padding:6px 8px;">Amount</th>' + (isAdminUI ? '<th></th>' : '') + '</tr></thead>'
    + '<tbody>' + (distRows || '<tr><td colspan="3" style="padding:10px;color:var(--warm-gray);">No distributions recorded yet.</td></tr>') + '</tbody>'
    + '</table></div>'
    + (isAdminUI ? '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:10px;">'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Period<br><input type="text" id="fin-prop-dist-period" placeholder="2026-07" style="width:100px;"></label>'
      + '<label style="font-size:.75rem;color:var(--warm-gray);">Amount ($)<br><input type="number" id="fin-prop-dist-amount" step="0.01" style="width:110px;"></label>'
      + '<button class="btn-primary" style="font-size:.78rem;padding:5px 12px;" onclick="finPropertyAddDistribution()">+ Add</button>'
      + '</div>' : '');

  var budgetImportHtml = isAdminUI
    ? '<div style="margin-bottom:16px;padding:10px 14px;background:var(--warm-surface-page);border-radius:10px;">'
      + '<label style="font-size:.78rem;color:var(--warm-gray);font-weight:600;">Import Budget (AHRA "Budget Detail" export) <input type="file" accept=".xlsx" onchange="finPropertyBudgetImportFileSelected(this)" style="display:block;margin-top:4px;"></label>'
      + '<div id="fin-property-budget-import-status" style="font-size:.76rem;color:var(--warm-gray);margin-top:6px;"></div>'
      + '</div>'
    : '';

  var monthlyCsvImportHtml = isAdminUI
    ? '<div id="fin-property-monthly-csv-panel" style="display:none;margin:8px 0 14px;padding:10px 14px;background:var(--warm-surface-page);border-radius:10px;">'
      + '<label style="font-size:.78rem;color:var(--warm-gray);font-weight:600;">Paste the AHRA report\'s "monthly financials" CSV row(s) below (same header row as ' +
        '<code>period,occupancy_pct,total_revenue,operating_expenses,...</code>) to add or update those months in one step, instead of typing each field into the modal.</label>'
      + '<textarea id="fin-property-monthly-csv-text" rows="4" style="width:100%;font-family:monospace;font-size:.76rem;margin-top:6px;" placeholder="period,occupancy_pct,total_revenue,operating_expenses,net_operating_income,non_operating_expenses,net_income,...\n2026-06,100,9765.27,-3505.43,6259.84,-957.05,5302.79,..."></textarea>'
      + '<div style="margin-top:8px;"><button class="btn-primary" style="font-size:.78rem;padding:4px 10px;" onclick="finPropertyImportMonthlyCsv()">Import</button> '
      + '<span id="fin-property-monthly-csv-status" style="font-size:.76rem;color:var(--warm-gray);margin-left:8px;"></span></div>'
      + '</div>'
    : '';

  el.innerHTML = kpiHtml
    + '<div style="margin-bottom:16px;">' + infoHtml + '</div>'
    + statsHtml
    + budgetImportHtml
    + finRenderPropertyCharts(d)
    + finRenderPropertyForecast(d)
    + finRenderValuationCalculator(d, isAdminUI)
    + '<h4 style="margin:0 0 8px;font-size:.9rem;">Annual Summary</h4>' + annualHtml
    + '<h4 style="margin:18px 0 8px;display:flex;align-items:center;justify-content:space-between;font-size:.9rem;"><span>Monthly Financials</span>' + (isAdminUI ? '<span><button class="btn-secondary" style="font-size:.78rem;padding:4px 10px;margin-right:6px;" onclick="finPropertyToggleMonthlyCsvPanel()">Import CSV</button><button class="btn-primary" style="font-size:.78rem;padding:4px 10px;" onclick="finPropertyOpenMonthModal()">+ Add Month</button></span>' : '') + '</h4>'
    + monthlyCsvImportHtml
    + monthlyHtml
    + '<h4 style="margin:18px 0 8px;font-size:.9rem;">Distributions to Church</h4>' + distHtml
    + finRenderBaseMinimumReserve(d, isAdminUI)
    + finRenderPropertyTaxReserve(d, isAdminUI)
    + finRenderCapitalImprovements(d, isAdminUI)
    + finRenderRepairs(d, isAdminUI)
    + finRenderAvailableForDistributionBar(d)
    + finRenderInsuranceAllocation(d);
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
      if (saved.healthPlanContracts != null) _finHealthPlanContracts = saved.healthPlanContracts;
      if (saved.compMethod) _finCompMethod = saved.compMethod;
      if (saved.compPerWorkerMethod && typeof saved.compPerWorkerMethod === 'object') _finCompPerWorkerMethod = saved.compPerWorkerMethod;
      if (saved.compOverrides && typeof saved.compOverrides === 'object') _finCompOverrides = saved.compOverrides;
      if (saved.compCustomPct != null) _finCompCustomPct = saved.compCustomPct;
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
    // district-formula behaviour is the separate District Scale column.
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
    healthPlanOption: _finHealthPlanSelectedOption, healthPlanContracts: _finHealthPlanContracts,
    compMethod: _finCompMethod, compPerWorkerMethod: _finCompPerWorkerMethod,
    compOverrides: _finCompOverrides, compCustomPct: _finCompCustomPct,
    referenceByYear: _finSalaryReferenceByYear, healthPlanPremiumOverrides: _finHealthPlanPremiumOverrides
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

  var yearPickerHtml = '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px;">'
    + '<label style="font-size:.72rem;color:var(--warm-gray);">Base Year (actual/budget source)<br><input type="number" id="fin-plan-base-year" value="' + _finPlanBaseYear + '" onchange="finPlanChangeBaseYear()" style="width:100px;"></label>'
    + '<label style="font-size:.72rem;color:var(--warm-gray);">Projecting For<br><input type="number" id="fin-plan-target-year" value="' + _finPlanTargetYear + '" onchange="finPlanChangeTargetYear()" style="width:100px;"></label>'
    + '</div>';

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
  function walk(nodes) {
    (nodes || []).forEach(function(node) {
      var planRow = finPlanFindRow(node.path);
      var editedVal = _finPlanEdits[node.path];
      var cellVal = editedVal !== undefined ? editedVal : (planRow ? String(Math.round(planRow.planned_amount_cents/100)) : '');
      var bold = node.children.length > 0;
      var projCents = projectedCentsByPath[node.path] || 0;
      var projectedCell = bold
        ? '<td style="text-align:right;padding:4px 8px;">' + (projCents ? '$' + finFmtMoney(projCents/100) : '<span style="color:var(--warm-gray);">—</span>') + '</td>'
        : '<td style="text-align:right;padding:4px 8px;">' + (isAdminUI
            ? '<input type="text" inputmode="numeric" id="' + finPlanCellId('fin-plan-cell', node.path) + '" value="' + cellVal + '" class="fin-editable-input" style="width:100px;text-align:right;" oninput="finPlanEditCell(' + volJsAttr(node.path) + ', finPlanSanitizeWholeDollarInput(this))">'
            : (cellVal !== '' ? '$' + finFmtMoney(parseFloat(cellVal)) : '<span style="color:var(--warm-gray);">—</span>')) + '</td>';
      var baseEditedVal = _finPlanBaseProjEdits[node.path];
      var baseCellVal = baseEditedVal !== undefined ? baseEditedVal : String(Math.round((baseProjByPath[node.path] || 0)/100));
      var baseProjectedCell = bold
        ? '<td style="text-align:right;padding:4px 8px;color:var(--warm-ink-label);">$' + finFmtMoney((baseProjByPath[node.path] || 0)/100) + '</td>'
        : '<td style="text-align:right;padding:4px 8px;">' + (isAdminUI
            ? '<input type="text" inputmode="numeric" id="' + finPlanCellId('fin-baseproj-cell', node.path) + '" value="' + baseCellVal + '" class="fin-editable-input" style="width:100px;text-align:right;color:var(--warm-ink-label);" oninput="finPlanEditBaseProjCell(' + volJsAttr(node.path) + ', finPlanSanitizeWholeDollarInput(this))">'
            : '$' + finFmtMoney((baseProjByPath[node.path] || 0)/100)) + '</td>';
      rowsHtml.push('<tr' + (bold ? ' style="font-weight:700;"' : '') + '>'
        + '<td style="padding:4px 8px 4px ' + (10 + node.depth * 16) + 'px;">' + esc(node.label) + '</td>'
        + '<td style="text-align:right;padding:4px 8px;">' + (node.hasBudgetInfo ? '$' + finFmtMoney(node.totalBudgetCents/100) : '<span style="color:var(--warm-gray);">—</span>') + '</td>'
        + '<td style="text-align:right;padding:4px 8px;">$' + finFmtMoney(node.totalActualCents/100) + '</td>'
        + baseProjectedCell
        + projectedCell
        + deltaCell(node.totalBudgetCents, projCents)
        + '</tr>');
      walk(node.children);
    });
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
  walk(revenueRoots);
  if (revenueRoots.length) rowsHtml.push(subtotalRow('Total Revenue', sumRoots(revenueRoots, 'totalBudgetCents'), revenueRoots.some(function(n){return n.hasBudgetInfo;}), sumRoots(revenueRoots, 'totalActualCents'), baseRevenueProjCents, revenueProjectedCents));
  walk(expenseRoots);
  if (expenseRoots.length) rowsHtml.push(subtotalRow('Total Expenses', sumRoots(expenseRoots, 'totalBudgetCents'), expenseRoots.some(function(n){return n.hasBudgetInfo;}), sumRoots(expenseRoots, 'totalActualCents'), baseExpenseProjCents, expenseProjectedCents));
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

  var tableHtml = '<div class="fin-card" style="padding:0;overflow:hidden;overflow-x:auto;">'
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
      + '<button class="btn-secondary" style="font-size:.78rem;padding:5px 12px;" onclick="finPlanGenerateAll()">Generate All (overwrites every Projected value below)</button>'
      + '<button class="btn-primary" style="font-size:.78rem;padding:5px 12px;" onclick="finPlanSaveAll()">Save Changes</button>'
      + '<button class="btn-secondary" style="font-size:.78rem;padding:5px 12px;" onclick="finPlanCommit()">Commit FY' + _finPlanTargetYear + ' to Real Budget</button>'
      + '</div>'
      + '<div id="fin-plan-msg" style="font-size:.75rem;color:var(--warm-gray);margin-top:6px;"></div>'
    : '';

  var projectedNetCard = '<div class="fin-navy-card">'
    + '<div class="fin-card-title" style="font-size:18px;">FY' + _finPlanTargetYear + ' Projected Net</div>'
    + '<div class="fin-navy-label" style="margin-top:10px;">Projected Revenue</div><div style="font-size:18px;font-weight:700;">$' + finFmtMoney(projectedRevenueCents/100) + '</div>'
    + '<div class="fin-navy-label" style="margin-top:8px;">Planned Expenses</div><div style="font-size:18px;font-weight:700;">$' + finFmtMoney(projectedExpenseCents/100) + '</div>'
    + '<div style="border-top:1px solid rgba(255,255,255,.3);margin:10px 0;"></div>'
    + '<div class="fin-navy-label">Surplus / (Deficit)</div><div class="fin-navy-val ' + (projectedNetCents >= 0 ? 'positive' : 'negative') + '">' + finFmtSigned(projectedNetCents) + '</div>'
    + '</div>';

  el.innerHTML = yearPickerHtml
    + '<div style="display:grid;grid-template-columns:1.35fr 1fr;gap:22px;align-items:start;margin-bottom:22px;">'
    + '<div>' + tableHtml + actionsHtml + '</div>'
    + projectedNetCard
    + '</div>'
    + finRenderPlanningOutlook(projectedRevenueCents, projectedExpenseCents);
}
// Three-year outlook (Finance Workspace handoff, Planning section): current target year plus 3
// forward years, income growing 2.5%/yr and expenses 3%/yr beyond the target year — the handoff's
// own stated assumption, not independently derived. A quick "does this trend stay healthy"
// glance, not a substitute for actually re-planning each year in the table above.
function finRenderPlanningOutlook(baseRevenueCents, baseExpenseCents) {
  var years = [];
  var rev = baseRevenueCents, exp = baseExpenseCents;
  for (var i = 0; i < 4; i++) {
    years.push({ year: _finPlanTargetYear + i, revenueCents: rev, expenseCents: exp, netCents: rev - exp });
    rev = Math.round(rev * 1.025);
    exp = Math.round(exp * 1.03);
  }
  var maxAbs = Math.max(1, Math.max.apply(null, years.map(function(y) { return Math.abs(y.netCents); })));
  var barsHtml = years.map(function(y) {
    var pct = Math.abs(y.netCents) / maxAbs * 100;
    var positive = y.netCents >= 0;
    return '<div style="flex:1;text-align:center;">'
      + '<div style="height:120px;display:flex;align-items:flex-end;justify-content:center;">'
      + '<div style="width:60%;height:' + Math.max(2, pct) + '%;border-radius:4px 4px 0 0;background:' + (positive ? 'var(--sage)' : 'var(--danger)') + ';"></div>'
      + '</div>'
      + '<div style="font-size:.8rem;font-weight:700;margin-top:6px;color:' + (positive ? 'var(--sage-text)' : 'var(--danger)') + ';">' + finFmtSigned(y.netCents) + '</div>'
      + '<div style="font-size:.75rem;color:var(--warm-meta);">FY' + y.year + '</div>'
      + '</div>';
  }).join('');
  return '<div class="fin-card" style="margin-bottom:22px;">'
    + '<div class="fin-card-title" style="font-size:18px;">Three-Year Outlook</div>'
    + '<div class="fin-card-sub">Income +2.5%/yr, expenses +3%/yr after FY' + _finPlanTargetYear + '.</div>'
    + '<div style="display:flex;gap:10px;">' + barsHtml + '</div>'
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
var HEALTH_PLAN_QUOTE_2027 = {
  effectiveYear: 2027,
  enrollmentContracts: 2, // 2 Family-tier employee contracts — every total below is for both combined
  coinsuranceRate: 0.20,  // "Coinsurance 20%" — the same for every option in this quote
  options: {
    current: { label: 'Current — Healthy Me HSA-C (BCBS)', medicalCents: 4529664, dentalCents: 289464, visionCents: 147168, embedded: true, deductibleFamilyCents: 700000, oopMaxFamilyCents: 1400000, deductibleIndividualCents: 350000, oopMaxIndividualCents: 700000 },
    renewal: { label: 'Renewal — Stay in Current Plan (Healthy Me HSA-C)', medicalCents: 4922400, dentalCents: 304680, visionCents: 147168, embedded: true, deductibleFamilyCents: 800000, oopMaxFamilyCents: 1600000, deductibleIndividualCents: 400000, oopMaxIndividualCents: 800000 },
    option1: { label: 'Option 1 — Healthy Me HSA-A (BCBS)', medicalCents: 5731560, dentalCents: 304680, visionCents: 147168, embedded: false, deductibleFamilyCents: 400000, oopMaxFamilyCents: 800000, deductibleIndividualCents: 200000, oopMaxIndividualCents: 400000 },
    option2: { label: 'Option 2 — Healthy Me HSA-B (BCBS)', medicalCents: 5252040, dentalCents: 304680, visionCents: 147168, embedded: false, deductibleFamilyCents: 600000, oopMaxFamilyCents: 850000, deductibleIndividualCents: 300000, oopMaxIndividualCents: 600000 },
    option3: { label: 'Option 3 — Healthy Me HSA-D (BCBS)', medicalCents: 4413264, dentalCents: 304680, visionCents: 147168, embedded: true, deductibleFamilyCents: 1100000, oopMaxFamilyCents: 1700000, deductibleIndividualCents: 550000, oopMaxIndividualCents: 850000 }
  }
};
// { [optionKey]: { medicalCents, dentalCents, visionCents } } — an admin can override any of the
// 3 premium lines for any plan option (the quote is a fixed 2027 snapshot; a future year's renewal
// quote will have different real numbers), unset fields fall back to the quote's own figure.
var _finHealthPlanPremiumOverrides = {};
// Pure — no DOM — returns the Medical/Dental/Vision breakdown + total annual employer cost in
// cents for one of the HEALTH_PLAN_QUOTE_2027 options (after applying any admin override on top
// of the quote's own figures), or null for an unrecognized key.
function finComputeHealthPlanTotalCents(optionKey, premiumOverrides) {
  var opt = HEALTH_PLAN_QUOTE_2027.options[optionKey];
  if (!opt) return null;
  var ov = (premiumOverrides || (typeof _finHealthPlanPremiumOverrides !== 'undefined' ? _finHealthPlanPremiumOverrides : {}))[optionKey] || {};
  var medicalCents = ov.medicalCents != null ? ov.medicalCents : opt.medicalCents;
  var dentalCents = ov.dentalCents != null ? ov.dentalCents : opt.dentalCents;
  var visionCents = ov.visionCents != null ? ov.visionCents : opt.visionCents;
  var totalCents = medicalCents + dentalCents + visionCents;
  var overridden = ov.medicalCents != null || ov.dentalCents != null || ov.visionCents != null;
  return { label: opt.label, medicalCents: medicalCents, dentalCents: dentalCents, visionCents: visionCents, totalCents: totalCents, overridden: overridden };
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
// Pure — no DOM — the deductible/OOP-max that actually applies to ONE family member who alone
// accounts for all of a family contract's costs: the plan's own individual figures if it's
// embedded (each person protected separately), or its family figures if not (no individual
// sub-limit — a lone claimant has to clear the same aggregate threshold as the whole family).
function finHealthPlanEffectiveLoneClaimantTermsCents(optionKey) {
  var opt = HEALTH_PLAN_QUOTE_2027.options[optionKey];
  if (!opt) return null;
  return opt.embedded
    ? { deductibleCents: opt.deductibleIndividualCents, oopMaxCents: opt.oopMaxIndividualCents }
    : { deductibleCents: opt.deductibleFamilyCents, oopMaxCents: opt.oopMaxFamilyCents };
}
// Pure — no DOM — the total family-wide annual medical spend (in cents, assumed spread across 2+
// family members so the FAMILY deductible/OOP-max apply, not a single person's) at which moving
// from fromKey to toKey starts saving more in reduced out-of-pocket costs than the extra premium
// costs (perHouseholdPremiumDiffCents, positive = toKey costs more per household per year). Returns
// null if the plan never breaks even even at a very high spend level (e.g. toKey's premium is
// higher with no compensating deductible/OOP-max improvement at all).
function finComputeHealthPlanFamilyBreakevenCents(fromKey, toKey, perHouseholdPremiumDiffCents) {
  var from = HEALTH_PLAN_QUOTE_2027.options[fromKey], to = HEALTH_PLAN_QUOTE_2027.options[toKey];
  if (!from || !to) return null;
  var rate = HEALTH_PLAN_QUOTE_2027.coinsuranceRate;
  function savings(spendCents) {
    return finComputePlanOOPCents(from.deductibleFamilyCents, from.oopMaxFamilyCents, rate, spendCents)
         - finComputePlanOOPCents(to.deductibleFamilyCents, to.oopMaxFamilyCents, rate, spendCents);
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
var FIN_COMP_METHODS = ['none', 'worksheet', 'cola', 'custom'];
var _finCompView = 'plan';
var _finCompMethod = 'cola';          // roster-wide method; a per-worker entry below overrides it
var _finCompPerWorkerMethod = {};     // roster index -> method key
var _finCompOverrides = {};           // roster index -> hand-typed dollars string (beats any method)
var _finCompCustomPct = 3.5;
var _finCompSelected = 0;
var _finCompDrawerOpen = true;
var _finCompRefYear = null;           // which year the rates view is editing; null = the target year
var _finCompToast = '';
// Whole-dollar money, the way every figure in this planner is presented (finFmtMoney's two
// decimals are right for an accounting report and wrong for a salary you can say out loud).
function finCompMoney(cents) {
  return '$' + Math.round((Number(cents) || 0) / 100).toLocaleString('en-US');
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
  var rate = key === 'cola' ? finCompSsaRate() : (Number(_finCompCustomPct) || 0) / 100;
  return finRoundSalaryCents(Math.round(finCompCurrentPayCents(w) * (1 + rate)));
}
function finCompMethodLabel(key) {
  if (key === 'none') return 'No raise';
  if (key === 'worksheet') return 'District Scale';
  if (key === 'cola') return 'COLA ' + (finCompSsaRate() * 100).toFixed(1) + '%';
  return 'Custom ' + (Number(_finCompCustomPct) || 0).toFixed(1) + '%';
}
function finCompMethodLongLabel(key) {
  if (key === 'none') return 'no raise';
  if (key === 'worksheet') return 'the District Compensation Worksheet';
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
// Group contracts — the quote is one congregation-wide premium for N Family-tier contracts, so a
// family-tier worker's cost is an even split of it. Clamped to 1 so an emptied box can't divide
// by zero (§7.4).
var _finHealthPlanContracts = null;
function finCompContractCount() {
  var n = _finHealthPlanContracts != null ? _finHealthPlanContracts : HEALTH_PLAN_QUOTE_2027.enrollmentContracts;
  return Math.max(1, Math.floor(Number(n) || 0) || 1);
}
// Pure — no DOM — an even per-contract share of the selected plan's total employer cost, used as
// each FAMILY-tier worker's health line. The quote is one congregation-wide total for N Family-tier
// contracts, not individually priced per worker, so an even split is the practical estimate.
function finHealthPlanPerContractCents(optionKey) {
  var calc = finComputeHealthPlanTotalCents(optionKey);
  if (!calc) return 0;
  return Math.round(calc.totalCents / finCompContractCount());
}
// What the church pays for one worker (§5.5). Pension and disability apply to every salaried
// worker regardless of FICA status; a minister's employer FICA is $0 and the employer half they
// cover themselves is carried separately for display only — never added to a total.
function finCompBenefits(w, salaryCents) {
  var pensionRate = finCompPensionRate(_finPlanTargetYear).rate;
  var disRate = finCompDisabilityRate(_finPlanTargetYear, !!w.hasDependents).rate;
  var ficaRate = finCompFicaRate();
  var mode = finCompHealthMode(w);
  var cashOnly = finCompIsCashOnly(w);
  var healthCents = cashOnly ? 0
    : mode === 'family' ? finHealthPlanPerContractCents(_finHealthPlanSelectedOption)
    : mode === 'employee' ? (w.employeeOnlyPremiumCents || 0)
    : (w.healthOptOutOverrideCents != null ? w.healthOptOutOverrideCents : finCompOptOutCents());
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
// The FY base-year ACTUAL across the accounts that really are compensation (§5.10). Deliberately
// NOT a bare /insurance|benefit/ — "52040 Insurance" is property cover and doubled this figure.
function finCompBaselineCents() {
  if (!_finPlanBaseTree) return 0;
  var leaves = [];
  (function walk(nodes) { (nodes || []).forEach(function(n) { if (!n.children.length && n.classification !== 'Income') leaves.push(n); walk(n.children); }); })(_finPlanBaseTree);
  return leaves.filter(function(n) { return /salar|payroll|compensation|wages/i.test(n.label) || /health|medical|dental|vision|disability/i.test(n.label); })
    .reduce(function(sum, n) { return sum + (n.totalActualCents || 0); }, 0);
}
function finCompTotals(computed) {
  var salaryCents = computed.reduce(function(s, c) { return s + c.salaryCents; }, 0);
  var benefitsCents = computed.reduce(function(s, c) { return s + c.benefits.totalCents; }, 0);
  var baselineCents = finCompBaselineCents();
  var totalCents = salaryCents + benefitsCents;
  return {
    salaryCents: salaryCents, benefitsCents: benefitsCents, totalCents: totalCents,
    baselineCents: baselineCents, deltaCents: totalCents - baselineCents,
    currentCents: computed.reduce(function(s, c) { return s + c.currentCents; }, 0),
    worksheetCents: computed.reduce(function(s, c) { return s + (c.worksheetCents || 0); }, 0),
    healthCents: computed.reduce(function(s, c) { return s + c.benefits.healthCents; }, 0)
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
  _finSalaryRoster.forEach(function(w, i) {
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
  _finSalaryRoster.forEach(function(w, i) {
    var c = computed[i];
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
    + ' &middot; ' + _finSalaryRoster.length + ' worker' + (_finSalaryRoster.length === 1 ? '' : 's');
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
    return '<span class="fin-comp-pill' + (active ? ' active' : '') + '" onclick="finCompSetView(' + volJsAttr(v.key) + ')">' + v.label + '</span>';
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
    + '<div class="fin-comp-strip-delta"><div class="fin-comp-strip-lbl">vs FY' + _finPlanBaseYear + ' actual ' + finCompMoney(totals.baselineCents) + '</div>'
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
    return '<span class="fin-comp-chip' + (_finCompMethod === k ? ' active' : '') + '" onclick="finCompApplyMethodToAll(' + volJsAttr(k) + ')">' + esc(finCompMethodLabel(k)) + '</span>';
  }).join('');
  var heads = FIN_COMP_METHODS.map(function(k) {
    var active = _finCompMethod === k;
    return '<th class="fin-comp-th num' + (active ? ' active' : '') + '" onclick="finCompApplyMethodToAll(' + volJsAttr(k) + ')" title="Apply to everyone">' + esc(finCompMethodLabel(k)) + '</th>';
  }).join('');
  var rows = _finSalaryRoster.map(function(w, i) {
    var c = computed[i];
    var activeKey = c.methodKey;
    var cells = FIN_COMP_METHODS.map(function(k) {
      var v = finCompMethodSalaryCents(w, k);
      var isActive = !c.overridden && activeKey === k;
      var isEdited = c.overridden && activeKey === k;
      var cls = 'fin-comp-td num' + (isActive ? ' active' : '') + (isEdited ? ' edited' : '');
      return '<td class="' + cls + '" onclick="finCompPickMethod(' + i + ',' + volJsAttr(k) + ')">'
        + (v == null ? '&mdash;' : (isEdited ? finCompMoney(c.salaryCents) + ' &#9998;' : finCompMoney(v))) + '</td>';
    }).join('');
    var vs = finCompVsScale(c.salaryCents, c.worksheetCents);
    var selected = (i === _finCompSelected && _finCompDrawerOpen);
    return '<tr class="fin-comp-row' + (selected ? ' selected' : '') + '">'
      + '<td class="fin-comp-td" style="cursor:pointer;" onclick="finCompSelectWorker(' + i + ')">'
      + '<div style="font-weight:700;color:var(--color-navy);">' + esc(w.name || '(unnamed)') + '</div>'
      + '<div style="font-size:.72rem;color:var(--warm-gray);">' + esc(w.position || 'Role not set') + ' &middot; acct ' + esc(w.accountCode || '&mdash;')
      + (finCompIsPartTime(w) ? ' &middot; <span style="color:var(--deep-amber);font-weight:700;">' + finCompFtePct(w) + '% time</span>' : '')
      + (finCompIsCashOnly(w) ? ' &middot; <span style="color:var(--warm-meta);">cash only</span>' : '') + '</div></td>'
      + cells
      + '<td class="fin-comp-td" style="font-size:.76rem;font-weight:600;color:' + vs.color + ';" title="District scale ' + (c.worksheetCents ? finCompMoney(c.worksheetCents) : 'not available') + (finCompIsPartTime(w) ? ' (pro-rated to ' + finCompFtePct(w) + '% time)' : '') + '">' + vs.text + (finCompIsPartTime(w) ? '<br><span style="font-weight:400;color:var(--warm-gray);">at ' + finCompFtePct(w) + '% time</span>' : '') + '</td>'
      + '<td class="fin-comp-td num" style="font-weight:700;">' + finCompMoney(c.churchCostCents) + '</td>'
      + '</tr>';
  }).join('');
  var methodTotals = FIN_COMP_METHODS.map(function(k) {
    var t = _finSalaryRoster.reduce(function(s, w) { return s + (finCompMethodSalaryCents(w, k) || 0); }, 0);
    return '<td class="fin-comp-td num' + (_finCompMethod === k ? ' active' : '') + '">' + finCompMoney(t) + '</td>';
  }).join('');
  var scaleTotal = finCompVsScale(totals.salaryCents, totals.worksheetCents);
  var base = finCompBaseSalary(_finPlanTargetYear);
  var table = '<div style="overflow-x:auto;"><table class="fin-comp-table" style="min-width:760px;">'
    + '<thead><tr><th class="fin-comp-th">Worker</th>' + heads
    + '<th class="fin-comp-th">Vs. district scale</th><th class="fin-comp-th num">Total comp.</th></tr></thead>'
    + '<tbody>' + rows
    + (finCompIsAdmin() ? '<tr><td colspan="7" style="padding:9px 6px;"><span class="fin-comp-add" onclick="finCompAddWorker()"><span class="fin-comp-add-plus">+</span> Add a staff member</span></td></tr>' : '')
    + '<tr class="fin-comp-total-row"><td class="fin-comp-td">Total</td>' + methodTotals
    + '<td class="fin-comp-td" style="font-size:.76rem;font-weight:600;color:' + scaleTotal.color + ';" title="District scale ' + finCompMoney(totals.worksheetCents) + '">' + scaleTotal.text + '</td>'
    + '<td class="fin-comp-td num">' + finCompMoney(totals.totalCents) + '</td></tr>'
    + '</tbody></table></div>';
  var customBox = '<label style="display:inline-flex;align-items:center;gap:5px;font-size:.74rem;color:var(--warm-gray);">custom '
    + '<input type="text" inputmode="decimal" id="fin-comp-custom-pct" value="' + (Number(_finCompCustomPct) || 0) + '" oninput="finCompCustomPctChange(finSanitizeDecimalInput(this))" style="width:52px;text-align:right;">%</label>';
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
    + '<div class="fin-comp-cardfoot">'
    + '<span style="font-size:.74rem;color:var(--warm-gray);">District Scale = the District Compensation Worksheet &mdash; base $' + finFmtMoney(base.dollars) + ' &times; each worker&#39;s role/experience multiplier. <span class="fin-comp-link" onclick="finCompSetView(&quot;rates&quot;)">Rates for this year</span></span>'
    + '<button class="btn-primary" onclick="finCompSetView(&quot;fairness&quot;)">Next: check fairness &rarr;</button>'
    + '</div></div>'
    + (_finCompDrawerOpen ? finCompRenderDrawer(computed) : '')
    + '</div>';
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
  var overridden = c.overridden;
  var salaryBox = '<input type="text" inputmode="decimal" id="fin-comp-salary-' + i + '" value="' + (overridden ? _finCompOverrides[i] : Math.round(c.salaryCents / 100)) + '" oninput="finCompSalaryOverride(' + i + ',finPlanSanitizeWholeDollarInput(this))" style="width:104px;text-align:right;font-weight:700;' + (overridden ? 'background:var(--warm-surface-header);border:1.5px solid var(--color-gold);' : '') + '">';
  var meta = [w.position, w.yearsExperience + ' yrs', finCompEducationLabel(w), trackSet && trackSet[w.trackKey] ? trackSet[w.trackKey].label : '', w.accountCode ? 'budget line ' + w.accountCode : 'no budget line'].filter(Boolean).join(' &middot; ');
  var base = finCompBaseSalary(_finPlanTargetYear);
  var fields = '<div class="fin-comp-fieldgrid">'
    + '<label class="fin-comp-field">Name<input type="text" id="fin-comp-name-' + i + '" value="' + esc(w.name || '') + '" oninput="finCompWorkerChange(' + i + ',&quot;name&quot;,this.value)"></label>'
    + '<label class="fin-comp-field">Position<input type="text" id="fin-comp-position-' + i + '" value="' + esc(w.position || '') + '" oninput="finCompWorkerChange(' + i + ',&quot;position&quot;,this.value)"></label>'
    + '<label class="fin-comp-field" style="grid-column:1/-1;">Budget line<select onchange="finCompWorkerChange(' + i + ',&quot;accountCode&quot;,this.value)">' + acctOptions + '</select></label>'
    + '</div>'
    + '<div class="fin-comp-note" style="color:' + (w.accountCode ? 'var(--warm-gray)' : 'var(--deep-amber)') + ';">'
    + (w.accountCode
        ? 'FY' + _finPlanBaseYear + ' figure and the &ldquo;no raise&rdquo; column read from ' + esc(w.accountCode) + '; the plan total is applied back to it.'
        : 'Not linked &mdash; the FY' + _finPlanBaseYear + ' figure has to be typed by hand and nothing is applied back to the budget.')
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
    + '<label class="fin-comp-field">Health coverage<select onchange="finCompSetHealthMode(' + i + ',this.value)"' + (finCompIsCashOnly(w) ? ' disabled' : '') + '>'
    + '<option value="family"' + (finCompHealthMode(w) === 'family' ? ' selected' : '') + '>Family</option>'
    + '<option value="employee"' + (finCompHealthMode(w) === 'employee' ? ' selected' : '') + '>Employee only</option>'
    + '<option value="optout"' + (finCompHealthMode(w) === 'optout' ? ' selected' : '') + '>Opts out (cash)</option>'
    + '</select></label>'
    + '</div>'
    + '<label class="fin-comp-inline-check" style="margin:6px 0 0;"><input type="checkbox" onchange="finCompCashOnlyToggle(' + i + ',this.checked)"' + (finCompIsCashOnly(w) ? ' checked' : '') + '> Cash salary only &mdash; no pension, disability or health</label>'
    + (finCompIsCashOnly(w)
        ? '<div class="fin-comp-note">Concordia\u2019s plans have an hours floor, so a very part-time worker draws none of them. Employer FICA still applies &mdash; it is owed on any wage however few the hours.</div>'
        : (finCompIsPartTime(w) ? '<div class="fin-comp-note">At ' + finCompFtePct(w) + '% of full time this worker is still shown as benefits-eligible. Tick the box above if they are not.</div>' : ''))
    + '<div class="fin-comp-note">' + roleNote + '</div>' + stipendNote;
  return '<div class="fin-card fin-comp-drawer">'
    + '<div class="fin-comp-drawer-hd">'
    + '<div><div class="fin-comp-chiprow-lbl">Selected worker</div>'
    + '<div class="fin-comp-drawer-name">' + esc(w.name || '(unnamed)') + '</div>'
    + '<div class="fin-comp-note">' + esc(meta) + '</div></div>'
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
function finCompPlanQuoteField(optionKey, field) {
  var ov = (_finHealthPlanPremiumOverrides[optionKey] || {})[field];
  return ov != null ? ov : HEALTH_PLAN_QUOTE_2027.options[optionKey][field];
}
function finCompRenderHealth(computed, totals) {
  var renewalTotal = finComputeHealthPlanTotalCents('renewal').totalCents;
  var cards = FIN_COMP_PLAN_KEYS.map(function(key) {
    var calc = finComputeHealthPlanTotalCents(key);
    if (!calc) return '';
    var active = key === _finHealthPlanSelectedOption;
    var perHousehold = Math.round((calc.totalCents - renewalTotal) / finCompContractCount());
    var note = key === 'renewal' ? 'Church covers this in full'
      : perHousehold > 0 ? 'Worker pays ' + finCompMoney(perHousehold) + '/yr more'
      : 'Worker saves ' + finCompMoney(Math.abs(perHousehold)) + '/yr';
    var noteColor = key === 'renewal' || perHousehold <= 0 ? 'var(--sage-text)' : 'var(--danger)';
    return '<div class="fin-comp-plancard' + (active ? ' active' : '') + '" onclick="finCompPickPlan(' + volJsAttr(key) + ')">'
      + '<div style="display:flex;align-items:center;gap:8px;"><span class="fin-comp-radio' + (active ? ' active' : '') + '"></span>'
      + '<span style="font-size:.82rem;font-weight:700;color:var(--color-navy);">' + esc(calc.label) + '</span></div>'
      + '<div style="font-size:20px;font-weight:800;color:var(--color-navy);font-variant-numeric:tabular-nums;">' + finCompMoney(calc.totalCents) + '</div>'
      + '<div style="font-size:.72rem;color:var(--warm-gray);">Family deductible ' + finCompMoney(finCompPlanQuoteField(key, 'deductibleFamilyCents'))
      + ' &middot; out-of-pocket max ' + finCompMoney(finCompPlanQuoteField(key, 'oopMaxFamilyCents')) + '</div>'
      + '<div style="font-size:.74rem;font-weight:700;color:' + noteColor + ';">' + note + '</div>'
      + '<div style="font-size:.7rem;color:var(--warm-meta);">' + FIN_COMP_PLAN_TAGS[key] + '</div>'
      + '</div>';
  }).join('');
  var planLabel = (finComputeHealthPlanTotalCents(_finHealthPlanSelectedOption) || {}).label || '';
  var rows = _finSalaryRoster.map(function(w, i) {
    var mode = finCompHealthMode(w), b = computed[i].benefits;
    var costCell, basis;
    if (finCompIsCashOnly(w)) {
      costCell = '<span style="color:var(--warm-gray);font-weight:400;">&mdash;</span>';
      basis = 'Cash salary only at ' + finCompFtePct(w) + '% time &mdash; below the hours floor for the group plan.';
      return '<tr style="opacity:.7;"><td class="fin-comp-td"><div style="font-weight:700;">' + esc(w.name || '(unnamed)') + '</div><div style="font-size:.72rem;color:var(--warm-gray);">' + esc(w.position || '') + '</div></td>'
        + '<td class="fin-comp-td"><span style="font-size:.78rem;color:var(--warm-gray);">Not eligible</span></td>'
        + '<td class="fin-comp-td num" style="font-weight:700;">' + costCell + '</td>'
        + '<td class="fin-comp-td" style="font-size:.76rem;color:var(--warm-gray);">' + basis + '</td></tr>';
    }
    if (mode === 'family') {
      costCell = finCompMoney(b.healthCents);
      basis = 'Group ' + esc(planLabel) + ' quote &divide; ' + finCompContractCount() + ' contract' + (finCompContractCount() === 1 ? '' : 's');
    } else if (mode === 'employee') {
      costCell = finCompReadOnly('<span style="display:inline-flex;align-items:center;gap:3px;justify-content:flex-end;"><span style="color:var(--warm-gray);font-weight:400;">$</span>'
        + '<input type="text" inputmode="decimal" id="fin-comp-eo-' + i + '" value="' + (w.employeeOnlyPremiumCents != null ? (w.employeeOnlyPremiumCents / 100) : '') + '" placeholder="0.00" oninput="finCompEmployeeOnlyChange(' + i + ',finSanitizeDecimalInput(this))" style="width:88px;text-align:right;font-weight:700;"></span>');
      basis = 'Employee-only premium &mdash; no group quote for this tier, enter the real figure';
    } else {
      costCell = finCompReadOnly('<span style="display:inline-flex;align-items:center;gap:3px;justify-content:flex-end;"><span style="color:var(--warm-gray);font-weight:400;">$</span>'
        + '<input type="text" inputmode="decimal" id="fin-comp-optout-' + i + '" value="' + (w.healthOptOutOverrideCents != null ? (w.healthOptOutOverrideCents / 100) : '') + '" placeholder="' + (finCompOptOutCents() / 100).toFixed(2) + '" oninput="finCompOptOutChange(' + i + ',finSanitizeDecimalInput(this))" style="width:88px;text-align:right;font-weight:700;"></span>');
      basis = 'Opt-out cash &mdash; default ' + finCompMoney(finCompOptOutCents()) + ' from this year&#39;s rates';
    }
    return '<tr><td class="fin-comp-td"><div style="font-weight:700;">' + esc(w.name || '(unnamed)') + '</div><div style="font-size:.72rem;color:var(--warm-gray);">' + esc(w.position || '') + '</div></td>'
      + '<td class="fin-comp-td"><select onchange="finCompSetHealthMode(' + i + ',this.value)"' + (finCompIsAdmin() ? '' : ' disabled') + '>'
      + '<option value="family"' + (mode === 'family' ? ' selected' : '') + '>Family</option>'
      + '<option value="employee"' + (mode === 'employee' ? ' selected' : '') + '>Employee only</option>'
      + '<option value="optout"' + (mode === 'optout' ? ' selected' : '') + '>Opts out (cash)</option>'
      + '</select></td>'
      + '<td class="fin-comp-td num" style="font-weight:700;">' + costCell + '</td>'
      + '<td class="fin-comp-td" style="font-size:.76rem;color:var(--warm-gray);">' + basis + '</td></tr>';
  }).join('');
  var familyCount = _finSalaryRoster.filter(function(w) { return finCompHealthMode(w) === 'family'; }).length;
  var table = '<div style="overflow-x:auto;"><table class="fin-comp-table" style="min-width:700px;">'
    + '<thead><tr><th class="fin-comp-th">Worker</th><th class="fin-comp-th">Coverage</th><th class="fin-comp-th num">Church cost</th><th class="fin-comp-th">Where the figure comes from</th></tr></thead>'
    + '<tbody>' + rows
    + '<tr class="fin-comp-total-row"><td class="fin-comp-td" colspan="2">Total health cost</td>'
    + '<td class="fin-comp-td num">' + finCompMoney(totals.healthCents) + '</td>'
    + '<td class="fin-comp-td" style="font-size:.74rem;font-weight:400;color:var(--warm-gray);">Group quote ' + finCompMoney(finComputeHealthPlanTotalCents(_finHealthPlanSelectedOption).totalCents)
    + ' covers ' + familyCount + ' family contract' + (familyCount === 1 ? '' : 's') + '; the rest are entered figures.</td></tr>'
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
  var perHouseholdDiffCents = Math.round((calc.totalCents - baseline.totalCents) / finCompContractCount());
  var renewalOpt = HEALTH_PLAN_QUOTE_2027.options.renewal, selOpt = HEALTH_PLAN_QUOTE_2027.options[_finHealthPlanSelectedOption];
  var rate = HEALTH_PLAN_QUOTE_2027.coinsuranceRate;
  var renewalLone = finHealthPlanEffectiveLoneClaimantTermsCents('renewal'), selLone = finHealthPlanEffectiveLoneClaimantTermsCents(_finHealthPlanSelectedOption);
  function row(label, a, bb) {
    return '<tr><td style="padding:2px 6px;">' + label + '</td><td style="text-align:right;padding:2px 6px;">' + finCompMoney(a) + '</td><td style="text-align:right;padding:2px 6px;">' + finCompMoney(bb) + '</td></tr>';
  }
  var body = '', tableRows = '';
  if (perHouseholdDiffCents > 0) {
    var breakevenCents = finComputeHealthPlanFamilyBreakevenCents('renewal', _finHealthPlanSelectedOption, perHouseholdDiffCents);
    var single = finComputeHealthPlanSingleClaimantDeltaCents('renewal', _finHealthPlanSelectedOption, 100000000);
    if (breakevenCents != null) {
      tableRows += row('At the breakeven (' + finCompMoney(breakevenCents) + ' total cost of care, spread across the family)',
        finComputePlanOOPCents(renewalOpt.deductibleFamilyCents, renewalOpt.oopMaxFamilyCents, rate, breakevenCents),
        finComputePlanOOPCents(selOpt.deductibleFamilyCents, selOpt.oopMaxFamilyCents, rate, breakevenCents));
    }
    tableRows += row('Worst case, costs spread across the family', renewalOpt.oopMaxFamilyCents, selOpt.oopMaxFamilyCents);
    tableRows += row('Worst case, one family member alone', renewalLone.oopMaxCents, selLone.oopMaxCents);
    body = 'The church fully covers Renewal; choosing this option means the worker personally pays the ' + finCompMoney(perHouseholdDiffCents) + '/yr extra premium. '
      + (breakevenCents != null
        ? 'If their household&#39;s costs are spread across 2+ family members, that extra premium pays them back once the household&#39;s <i>total cost of care for the year</i> (what providers bill &mdash; not what the family pays out of pocket, which stays capped well below this) reaches about <b>' + finCompMoney(breakevenCents) + '</b>.'
        : 'It never fully pays the worker back in reduced out-of-pocket costs at any level of care, even spread across the whole family.')
      + (single != null ? ' If one family member alone accounts for all the costs, this option ' + (single > 0 ? 'never breaks even &mdash; it costs them up to ' + finCompMoney(single) + ' more even in a worst-case year' : (single < 0 ? 'still comes out ahead by up to ' + finCompMoney(Math.abs(single)) + ' in a worst-case year' : 'comes out exactly even in a worst-case year')) + '.' : '');
  } else if (perHouseholdDiffCents < 0) {
    var familyWorstCaseCents = finComputePlanOOPCents(selOpt.deductibleFamilyCents, selOpt.oopMaxFamilyCents, rate, 100000000)
      - finComputePlanOOPCents(renewalOpt.deductibleFamilyCents, renewalOpt.oopMaxFamilyCents, rate, 100000000);
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
  return '<details class="fin-comp-details"><summary>Is it worth it for the worker?</summary>'
    + '<div style="padding:8px 2px 2px;font-size:.75rem;color:var(--warm-gray);">' + body
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
    + '<input type="text" inputmode="decimal" id="fin-comp-ref-' + field + '-' + year + '" value="' + shown + '" oninput="finCompRefChange(' + year + ',' + volJsAttr(field) + ',finSanitizeDecimalInput(this))" style="width:' + (width || 110) + 'px;font-weight:700;">'
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
  var quoteRows = FIN_COMP_PLAN_KEYS.map(function(key) {
    var calc = finComputeHealthPlanTotalCents(key);
    function box(field, width) {
      var ov = (_finHealthPlanPremiumOverrides[key] || {})[field];
      return '<input type="text" inputmode="decimal" id="fin-comp-quote-' + key + '-' + field + '" value="' + (ov != null ? (ov / 100) : '') + '" placeholder="' + (HEALTH_PLAN_QUOTE_2027.options[key][field] / 100).toFixed(2) + '" oninput="finCompQuoteChange(' + volJsAttr(key) + ',' + volJsAttr(field) + ',finSanitizeDecimalInput(this))" style="width:' + width + 'px;text-align:right;">';
    }
    return '<tr' + (key === _finHealthPlanSelectedOption ? ' class="fin-comp-quote-active"' : '') + '>'
      + '<td class="fin-comp-td"><div style="font-weight:700;color:var(--color-navy);">' + esc(calc.label) + '</div><div style="font-size:.72rem;color:var(--warm-gray);">' + FIN_COMP_PLAN_TAGS[key] + '</div></td>'
      + '<td class="fin-comp-td num">' + box('medicalCents', 96) + '</td>'
      + '<td class="fin-comp-td num">' + box('dentalCents', 86) + '</td>'
      + '<td class="fin-comp-td num">' + box('visionCents', 86) + '</td>'
      + '<td class="fin-comp-td num">' + box('deductibleFamilyCents', 82) + '</td>'
      + '<td class="fin-comp-td num">' + box('oopMaxFamilyCents', 82) + '</td>'
      + '<td class="fin-comp-td num" style="font-weight:700;">' + finCompMoney(calc.totalCents) + '</td>'
      + '<td class="fin-comp-td num" style="color:var(--warm-gray);">' + finCompMoney(Math.round(calc.totalCents / finCompContractCount())) + '</td></tr>';
  }).join('');
  var quoteCard = '<div class="fin-card">'
    + '<div class="fin-comp-cardhd">'
    + '<div><div class="fin-card-title" style="font-size:20px;margin:0;">Health plan quote, FY' + year + '</div>'
    + '<div class="fin-card-sub" style="margin:0;">One group premium for the whole church, not a per-worker rate. Type each line off the renewal packet; the cost per family contract is the total split by the number of contracts.</div></div>'
    + '<div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">'
    + '<label class="fin-comp-reflabel">Family contracts<input type="text" inputmode="numeric" id="fin-comp-contracts" value="' + finCompContractCount() + '" oninput="finCompContractsChange(finPlanSanitizeWholeDollarInput(this))" style="width:70px;font-weight:700;"></label>'
    + '<label class="fin-comp-reflabel">Quote reference<input type="text" id="fin-comp-ref-quoteSource-' + year + '" value="' + esc(finCompRefRow(year).quoteSource || '') + '" placeholder="' + esc(finCompSourceDoc('quoteSource')) + '" oninput="finCompRefTextChange(' + year + ',&quot;quoteSource&quot;,this.value)" style="width:260px;font-weight:400;"></label>'
    + '</div></div>'
    + '<div style="overflow-x:auto;"><table class="fin-comp-table" style="min-width:860px;">'
    + '<thead><tr><th class="fin-comp-th">Plan option</th><th class="fin-comp-th num">Medical</th><th class="fin-comp-th num">Dental</th><th class="fin-comp-th num">Vision</th>'
    + '<th class="fin-comp-th num">Family deductible</th><th class="fin-comp-th num">Out-of-pocket max</th><th class="fin-comp-th num">Total premium</th><th class="fin-comp-th num">Per contract</th></tr></thead>'
    + '<tbody>' + quoteRows + '</tbody></table></div>'
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
            return '<input type="text" id="fin-comp-range-' + i + '-' + r.key + part + '" value="' + esc(c[r.key + part] == null ? '' : c[r.key + part]) + '" placeholder="&mdash;" oninput="finCompRangeChange(' + i + ',' + volJsAttr(r.key + part) + ',this.value)" style="width:100px;text-align:right;">';
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
  finCompSay(finCompMethodLabel(key) + ' applied to all ' + _finSalaryRoster.length + ' worker' + (_finSalaryRoster.length === 1 ? '' : 's') + '.');
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
  // every later worker's settings onto their neighbour. Rebuild both against the new indexes.
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
  if (finCompHealthMode(w) !== 'optout') { w.healthMode = checked ? 'family' : 'employee'; w.healthEnrolled = true; }
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
function finCompContractsChange(v) {
  _finHealthPlanContracts = v === '' ? null : Math.max(1, parseInt(v, 10) || 1);
  finRerenderPlanningPreserveFocus();
}
function finCompQuoteChange(optionKey, field, value) {
  if (!_finHealthPlanPremiumOverrides[optionKey]) _finHealthPlanPremiumOverrides[optionKey] = {};
  var cents = value === '' ? null : Math.round(parseFloat(value) * 100);
  if (cents == null || !isFinite(cents)) delete _finHealthPlanPremiumOverrides[optionKey][field];
  else _finHealthPlanPremiumOverrides[optionKey][field] = cents;
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
  var planCalc = finComputeHealthPlanTotalCents(_finHealthPlanSelectedOption);
  var scaleRatio = totals.worksheetCents ? Math.round(totals.salaryCents / totals.worksheetCents * 100) : null;
  var salaryShare = totals.totalCents ? Math.round(totals.salaryCents / totals.totalCents * 100) : 0;
  var altTotalCents = totals.totalCents + gap.totalCents;
  var altPct = totals.baselineCents ? (altTotalCents - totals.baselineCents) / totals.baselineCents * 100 : 0;
  // Part 1 — cover
  var salaryRows = _finSalaryRoster.map(function(w, i) {
    var c = computed[i];
    var ratio = c.worksheetCents ? Math.round(c.salaryCents / c.worksheetCents * 100) : null;
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
    + '<div class="fin-comp-rpt-sub">' + _finSalaryRoster.length + ' called and employed worker' + (_finSalaryRoster.length === 1 ? '' : 's')
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
    + _finSalaryRoster.length + ' worker' + (_finSalaryRoster.length === 1 ? '' : 's')
    + (totals.baselineCents ? ' &mdash; a ' + pct.toFixed(1) + '% ' + (totals.deltaCents >= 0 ? 'increase over' : 'decrease from') + ' FY' + _finPlanBaseYear + ' actual spending' : '')
    + ' &mdash; applying ' + finCompMethodLongLabel(_finCompMethod) + ' to each worker&#39;s salary, continuing the Concordia Retirement Plan at '
    + finCompPctFmt(finCompPensionRate(_finPlanTargetYear).rate)
    + ', and ' + (planCalc ? 'setting the group health plan to ' + esc(planCalc.label) + ' at ' + finCompMoney(planCalc.totalCents) : 'making no change to the group health plan') + '.</div></div>'
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
    + '<td class="n">' + finCompMoney(totals.totalCents) + '</td></tr></tbody></table>';
  // Part 2 — worker by worker
  var workerPages = _finSalaryRoster.map(function(w, i) {
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
            + '<tr><td>Health &mdash; ' + (finCompHealthMode(w) === 'family' ? 'family tier, group quote split' : finCompHealthMode(w) === 'employee' ? 'employee-only premium' : 'opt-out cash') + '</td><td class="n">' + finCompMoney(b.healthCents) + '</td></tr>'
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
  var renewalTotal = finComputeHealthPlanTotalCents('renewal').totalCents;
  var planRows = FIN_COMP_PLAN_KEYS.map(function(key) {
    var calc = finComputeHealthPlanTotalCents(key);
    var perHousehold = Math.round((calc.totalCents - renewalTotal) / finCompContractCount());
    return '<tr' + (key === _finHealthPlanSelectedOption ? ' class="lcms"' : '') + '><td>' + esc(calc.label) + '</td>'
      + '<td class="n">' + finCompMoney(calc.medicalCents) + '</td><td class="n">' + finCompMoney(calc.dentalCents) + '</td><td class="n">' + finCompMoney(calc.visionCents) + '</td>'
      + '<td class="n">' + finCompMoney(finCompPlanQuoteField(key, 'deductibleFamilyCents')) + '</td><td class="n">' + finCompMoney(finCompPlanQuoteField(key, 'oopMaxFamilyCents')) + '</td>'
      + '<td class="n b">' + finCompMoney(calc.totalCents) + '</td>'
      + '<td class="n">' + (key === 'renewal' ? '&mdash;' : finCompMoneySigned(perHousehold) + '/worker') + '</td></tr>';
  }).join('');
  var tierRows = _finSalaryRoster.map(function(w, i) {
    var mode = finCompHealthMode(w);
    return '<tr><td>' + esc(w.name || '(unnamed)') + '</td>'
      + '<td>' + (finCompIsCashOnly(w) ? 'Not eligible &mdash; ' + finCompFtePct(w) + '% time' : mode === 'family' ? 'Family' : mode === 'employee' ? 'Employee only' : 'Opts out (cash)') + '</td>'
      + '<td class="n">' + finCompMoney(computed[i].benefits.healthCents) + '</td>'
      + '<td class="mut">' + (mode === 'family' ? 'Group quote &divide; ' + finCompContractCount() + ' contracts' : mode === 'employee' ? 'Entered employee-only premium' : 'Opt-out cash from this year&#39;s rates') + '</td></tr>';
  }).join('');
  var healthPage = '<div class="fin-comp-rpt-page">'
    + '<h2 class="fin-comp-rpt-h2">Group health plan</h2>'
    + '<table class="fin-comp-rpt-table kt"><thead><tr><th>Option</th><th class="n">Medical</th><th class="n">Dental</th><th class="n">Vision</th><th class="n">Family deductible</th><th class="n">Out-of-pocket max</th><th class="n">Total premium</th><th class="n">vs Renewal</th></tr></thead><tbody>' + planRows + '</tbody></table>'
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
    ['Group health quote', finCompMoney(planCalc ? planCalc.totalCents : 0) + ' over ' + finCompContractCount() + ' contract' + (finCompContractCount() === 1 ? '' : 's'), finCompSourceDoc('quoteSource'), '']
  ].map(function(r) {
    return '<tr><td>' + r[0] + '</td><td class="n b">' + r[1] + '</td><td class="mut">' + esc(r[2]) + '</td><td class="mut">' + r[3] + '</td></tr>';
  }).join('');
  var withReports = _finSalaryRoster.filter(function(w) { return finCompUsableRanges(w).length; }).length;
  var refPage = '<div class="fin-comp-rpt-page">'
    + '<h2 class="fin-comp-rpt-h2">Reference figures used</h2>'
    + '<table class="fin-comp-rpt-table kt"><thead><tr><th>Figure</th><th class="n">Value</th><th>Source document</th><th>Change</th></tr></thead><tbody>' + refRows + '</tbody></table>'
    + '<p class="fin-comp-rpt-p mut">' + withReports + ' of ' + _finSalaryRoster.length + ' worker' + (_finSalaryRoster.length === 1 ? ' has' : 's have')
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
  var el = document.getElementById('fin-plan-property-root');
  if (!el) return;
  if (!_finProperty) { el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">Loading…</p>'; return; }
  var loan = (_finProperty.meta && _finProperty.meta.loan) || {};
  var monthly = (_finProperty.monthly || []).slice().sort(function(a,b){ return a.period < b.period ? -1 : 1; }).slice(-12);
  var withNet = monthly.filter(function(m) { return m.net_income_cents != null || m.net_operating_income_cents != null; });
  var avgAnnualCents = withNet.length
    ? (withNet.reduce(function(sum, m) { return sum + (m.net_income_cents != null ? m.net_income_cents : m.net_operating_income_cents); }, 0) / withNet.length) * 12
    : 0;
  var amort = finComputeMortgageAmortization(loan);
  var payoffYear = amort ? amort.payoffDate.getFullYear() : null;

  var inputsHtml = '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px;">'
    + '<label style="font-size:.75rem;color:var(--warm-gray);">Annual Growth Assumption %<br><input type="number" id="fin-pmf-growth" step="0.1" value="2" oninput="finRenderPropertyMultiYearTable()" style="width:100px;"></label>'
    + '<label style="font-size:.75rem;color:var(--warm-gray);">Years to Project<br><input type="number" id="fin-pmf-years" value="10" min="1" max="30" oninput="finRenderPropertyMultiYearTable()" style="width:90px;"></label>'
    + '</div>'
    + '<p style="font-size:.72rem;color:var(--warm-gray);margin:0 0 10px;">Starts from the trailing-12-month average annual net income ($' + finFmtMoney(avgAnnualCents/100) + ') and compounds the growth assumption above. ' + (payoffYear ? 'The mortgage is projected to pay off around ' + payoffYear + ' — years from then on add back the current annual debt service ($' + finFmtMoney((loan.annual_debt_service_cents||0)/100) + '), on the same assumption noted in the Commercial Property tab.' : 'No mortgage payoff projection is available, so debt service is not added back in any year.') + '</p>'
    + '<div id="fin-pmf-table"></div>';
  el.innerHTML = inputsHtml;
  window._finPmfAvgAnnualCents = avgAnnualCents;
  window._finPmfPayoffYear = payoffYear;
  window._finPmfAnnualDebtServiceCents = loan.annual_debt_service_cents || 0;
  finRenderPropertyMultiYearTable();
}
function finRenderPropertyMultiYearTable() {
  var tableEl = document.getElementById('fin-pmf-table');
  if (!tableEl) return;
  var growthPct = (parseFloat(document.getElementById('fin-pmf-growth').value) || 0) / 100;
  var numYears = parseInt(document.getElementById('fin-pmf-years').value, 10) || 10;
  var avgAnnualCents = window._finPmfAvgAnnualCents || 0;
  var payoffYear = window._finPmfPayoffYear;
  var debtServiceCents = window._finPmfAnnualDebtServiceCents || 0;
  var startYear = new Date().getFullYear() + 1;
  var rows = '';
  for (var i = 0; i < numYears; i++) {
    var year = startYear + i;
    var projectedCents = Math.round(avgAnnualCents * Math.pow(1 + growthPct, i + 1));
    var afterPayoff = payoffYear && year >= payoffYear;
    var totalCents = projectedCents + (afterPayoff ? debtServiceCents : 0);
    rows += '<tr' + (afterPayoff ? ' style="background:var(--linen);"' : '') + '><td style="padding:4px 8px;">' + year + (afterPayoff ? ' <span style="font-size:.68rem;color:var(--warm-gray);">(post-payoff)</span>' : '') + '</td><td style="padding:4px 8px;text-align:right;">$' + finFmtMoney(totalCents/100) + '</td></tr>';
  }
  tableEl.innerHTML = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;">'
    + '<thead style="border-bottom:2px solid var(--navy);"><tr><th style="text-align:left;padding:4px 8px;">Year</th><th style="text-align:right;padding:4px 8px;">Projected Annual Net Income</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div>';
}
`;
