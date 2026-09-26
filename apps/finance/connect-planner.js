// ── Connect's Compensation Planner, running inside Finance ────────────────────────────────────
// Andrew, 2026-09-26: "add connect tabs to the finance so I can see both side by side in practice
// and then cut what doesn't work." This serves Connect's own Salary Planner -- the unchanged
// front-end code from src/frontend (1 · Set pay, 2 · Check fairness, 3 · Health plan, This year's
// rates, Council summary) -- as a Finance page, shown in a frame on Compensation → Connect planner.
//
// Nothing about the planner is re-implemented here. The page loads Connect's own scripts and
// stylesheet, then points the planner's data calls (its `api()` helper) at Finance routes that relay
// to the same permission-checked Connect contracts the rest of Finance uses:
//   - the saved plan: finance-compensation-plan-v1 (read) and finance-compensation-write-v1 (save),
//     so Connect re-verifies the viewer's identity and role on every request;
//   - the base-year ledger: connect.finance-church-report.v1, reshaped into the rows the planner's
//     own tree builder reads, for current pay from each worker's budget line;
//   - board categories and purpose tags: connect.finance-board-layout.v1.
// A council member's changes are saved as their private draft in Finance's own database, the same
// row the Plan page's draft editor writes (compensation-council-overlay.js), because Connect no
// longer accepts council writes to the plan.
//
// Connect's page start-up (session check, navigation, service worker) never runs here: the shim
// below drops the bundle's window load/popstate listeners before the scripts are evaluated, and the
// boot script starts only the planner.
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS, CHMS_APP_FINANCE_JS, CHMS_APP_CSS } from '../../src/html-chms.js';

export const CONNECT_PLANNER_JS = `${CHMS_APP_CORE_JS}\n${CHMS_APP_EXT_JS}\n${CHMS_APP_FINANCE_JS}\n`;
export const CONNECT_PLANNER_CSS = CHMS_APP_CSS;

// Scripts are Connect's own (with inline handlers), so this page, unlike the rest of Finance, runs
// script. It may only be framed by Finance itself and may only call back to Finance.
export const CONNECT_PLANNER_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";

// The role the planner renders for. Admin and compensation edit the shared plan; council edits a
// private draft when their compensation permission is edit, and otherwise only views.
export function plannerViewer(roleResult) {
  if (!roleResult || !roleResult.ok) return null;
  const role = roleResult.role;
  if (!['admin', 'compensation', 'council'].includes(role)) return null;
  const compensation = roleResult.permissions && roleResult.permissions.compensation;
  return { role, permissions: { compensation: compensation === 'edit' ? 'edit' : 'view' } };
}

// connect.finance-church-report.v1 accounts as the flat rows Connect's /finance/church/this-year
// returns, which finBuildTreeFromFlatRows reads (the same mapping compensation-projection.js uses).
export function churchYearFromReport(report) {
  const accounts = Array.isArray(report && report.accounts) ? report.accounts : [];
  return {
    entries: accounts.map((a) => ({
      category_path: a.categoryPath, account_name: a.accountName, classification: a.classification,
      depth: a.depth, own_actual_cents: a.actualCents, own_budget_cents: a.budgetCents,
    })),
  };
}

const COUNCIL_METHODS = ['none', 'worksheet', 'scalepct', 'cola', 'custom'];
// A council member's save from the planner, reduced to the fields their draft may hold.
export function councilDraftFromPlan(body) {
  const b = body && typeof body === 'object' ? body : {};
  const draft = {};
  if (COUNCIL_METHODS.includes(b.compMethod)) draft.compMethod = b.compMethod;
  if (b.compPerWorkerMethod && typeof b.compPerWorkerMethod === 'object') {
    draft.compPerWorkerMethod = Object.fromEntries(Object.entries(b.compPerWorkerMethod)
      .filter(([k, v]) => /^\d+$/.test(k) && COUNCIL_METHODS.includes(v)));
  }
  for (const field of ['compCustomPct', 'compScalePct']) {
    const n = Number(b[field]);
    if (b[field] != null && Number.isFinite(n)) draft[field] = n;
  }
  if (b.compBaselineRosterOnly != null) draft.compBaselineRosterOnly = Boolean(b.compBaselineRosterOnly);
  return draft;
}

const safeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

// Runs before Connect's scripts: Connect's start-up is attached to window load/popstate/hashchange,
// so those registrations are skipped while the bundle evaluates.
const SHIM = `(function(){var add=window.addEventListener;window.addEventListener=function(t,f,o){if(t==='load'||t==='popstate'||t==='hashchange')return;return add.call(window,t,f,o);};window.__finRestoreListeners=function(){window.addEventListener=add;};})();`;

// Runs after them: sets the viewer, routes the planner's data calls to Finance, loads the base-year
// ledger and chart of accounts presentation, then loads and renders the planner.
const BOOT = `(function(){
  window.__finRestoreListeners();
  var cfg = window.__FIN_PLANNER__;
  _userRole = cfg.role;
  _perm = cfg.permissions;
  var routes = {
    '/admin/api/finance/planning/salary': '/api/v1/connect-planner/salary',
    '/admin/api/finance/planning/board-categories': '/api/v1/connect-planner/board-categories',
    '/admin/api/finance/planning/purpose-tags': '/api/v1/connect-planner/purpose-tags'
  };
  function call(path, opts) {
    return fetch(path, opts || {}).then(function(r) {
      return r.json().catch(function() { return {}; }).then(function(d) {
        if (!r.ok) throw new Error((d && d.error) || ('Request failed (' + r.status + ')'));
        return d;
      });
    });
  }
  api = function(path, opts) {
    var method = ((opts && opts.method) || 'GET').toUpperCase();
    var base = path.split('?')[0];
    if (base === '/admin/api/finance/planning/salary' && method !== 'GET') {
      return call('/api/v1/connect-planner/salary-save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: opts.body });
    }
    if (base === '/admin/api/finance/church/this-year') {
      return call('/api/v1/connect-planner/church-year?' + (path.split('?')[1] || ''));
    }
    if (routes[base] && method === 'GET') return call(routes[base]);
    return Promise.reject(new Error('Not available in Finance'));
  };
  // "Send to FY budget" fills Connect's Budget Planner table, which is not on this page.
  finCompSendToBudget = function() {
    finCompSay('In Finance, enter this total on Planning → Budget builder.');
    finRenderCompensation();
  };
  _finPlanBaseYear = cfg.baseYear;
  _finPlanTargetYear = cfg.baseYear + 1;
  Promise.all([
    api('/admin/api/finance/church/this-year?year=' + _finPlanBaseYear).catch(function() { return { entries: [] }; }),
    api('/admin/api/finance/planning/board-categories').catch(function() { return {}; }),
    api('/admin/api/finance/planning/purpose-tags').catch(function() { return {}; })
  ]).then(function(r) {
    _finPlanBaseTree = finReorganizeChurchTree(finBuildTreeFromFlatRows((r[0] && r[0].entries) || []));
    var c = r[1] || {};
    _finPlanBoardCats = { revenue: c.revenue || {}, expense: c.expense || {}, revenueLabels: c.revenueLabels || {}, expenseLabels: c.expenseLabels || {}, donorWrapperLabel: c.donorWrapperLabel || '', accountLabels: c.accountLabels || {} };
    finApplyAccountLabelOverrides(_finPlanBaseTree);
    var t = r[2] || {};
    _finPurposeTags = { tags: Array.isArray(t.tags) ? t.tags : [], categories: t.categories || {} };
    if (cfg.ledgerNote) {
      var note = document.getElementById('fin-planner-note');
      if (note) { note.textContent = cfg.ledgerNote; note.style.display = 'block'; }
    }
    _finSalaryLoaded = true;
    return finLoadSalaryPlannerData();
  }).then(function() {
    finRenderCompensation();
  }).catch(function(err) {
    var el = document.getElementById('fin-comp-root');
    if (el) el.textContent = 'The planner could not load: ' + (err && err.message || err);
  });
})();`;

export function renderConnectPlannerPage({ viewer, baseYear, version }) {
  const v = encodeURIComponent(version || 'dev');
  const note = viewer.role === 'council'
    ? (viewer.permissions.compensation === 'edit'
      ? 'Your changes here are your private draft, the same one as Plan → Your raise-plan draft. The shared plan is not changed.'
      : 'View only.')
    : '';
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Compensation Planner (Connect)</title>
<link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,400;0,600;0,700;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/connect-planner/app.css?v=${v}">
<style>html,body{background:var(--warm-bg,#F3F7FA);margin:0}body{padding:16px 20px 40px}#fin-planner-note{display:none;margin:0 0 12px;padding:10px 14px;border-radius:8px;background:#FBF5E6;color:#5c4410;font-size:.85rem}</style>
</head><body>
<div id="error-boundary" style="display:none"></div>
<p id="fin-planner-note">${note ? note.replace(/</g, '&lt;') : ''}</p>
<div id="fin-panel-compensation"><div id="fin-comp-root">Loading…</div></div>
<script>window.__FIN_PLANNER__=${safeJson({ role: viewer.role, permissions: viewer.permissions, baseYear, ledgerNote: note })};${SHIM}</script>
<script src="/connect-planner/app.js?v=${v}"></script>
<script>${BOOT}</script>
</body></html>`;
}
