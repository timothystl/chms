// Planning → Budget builder, v3 design. One table: each line of next year's plan beside last
// year's actual, this year's budget and this year's projection (connect.finance-budget-builder.v1),
// with the plan amount and the projection correction editable in place. Every save goes through the
// existing relay routes to Connect (budget-plan-write, base-projection-write, generate, generate-all,
// commit, remove); nothing here stores a copy.
import { escapeHtml as e } from './render-helpers.js';

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money = (cents) => (cents == null ? '—' : USD.format(Math.round(cents / 100)));
const signed = (cents) => `${cents < 0 ? '−' : '+'}${USD.format(Math.abs(Math.round(cents / 100)))}`;
const dollars = (cents) => (cents == null ? '' : String(Math.round(cents / 100)));
const TABS = [['grow', 'Grow every line'], ['project', 'Project one category'], ['commit', 'Commit to Church report']];

function href(params) {
  return `/?${new URLSearchParams({ section: 'planning', page: 'builder', ...params }).toString().replace(/&/g, '&amp;')}`;
}

function statusLine({ budgetEntryStatus, budgetEntryMessage, planOpKind, planOpStatus, planOpMessage, baseProjectionEntryStatus, baseProjectionEntryMessage }) {
  const verbs = { generate: 'Projection', 'generate-all': 'Grown lines', commit: 'Committed plan', remove: 'Removed line' };
  if (budgetEntryStatus === 'ok') return '<p class="status">Line saved in Connect.</p>';
  if (budgetEntryStatus === 'error') return `<p class="status status-error">Not saved: ${e(budgetEntryMessage || 'unknown error')}</p>`;
  if (baseProjectionEntryStatus === 'ok') return '<p class="status">Projection correction saved in Connect.</p>';
  if (baseProjectionEntryStatus === 'error') return `<p class="status status-error">Correction not saved: ${e(baseProjectionEntryMessage || 'unknown error')}</p>`;
  if (planOpStatus === 'ok') return `<p class="status">${e(verbs[planOpKind] || 'Change')} saved in Connect.</p>`;
  if (planOpStatus === 'error') return `<p class="status status-error">Not saved: ${e(planOpMessage || 'unknown error')}</p>`;
  return '';
}

export function summarizeBuilder(builder) {
  const sum = (cls, pick) => builder.lines.filter((l) => l.classification === cls).reduce((t, l) => t + (pick(l) || 0), 0);
  const plan = (l) => l.plan?.plannedAmountCents;
  const planned = builder.lines.filter((l) => l.plan);
  return {
    incomeCents: sum('Income', plan),
    expenseCents: sum('Expenses', plan),
    baseBudgetIncomeCents: sum('Income', (l) => l.baseBudgetCents),
    baseBudgetExpenseCents: sum('Expenses', (l) => l.baseBudgetCents),
    grown: planned.filter((l) => l.plan.basis === 'grown').length,
    manual: planned.filter((l) => l.plan.basis !== 'grown').length,
    planned: planned.length,
    unplanned: builder.lines.length - planned.length,
  };
}

function tabPanel(builder, tab) {
  const { targetYear, baseYear } = builder;
  const current = TABS.find(([k]) => k === tab)?.[0] || 'grow';
  const nav = `<div class="bb-tabs" role="tablist">${TABS.map(([k, label]) => (k === current
    ? `<span class="is-on" role="tab" aria-selected="true">${label}</span>`
    : `<a href="${href({ tab: k })}" role="tab">${label}</a>`)).join('')}</div>`;
  let body;
  if (current === 'project') {
    body = `<form method="POST" action="/api/v1/connect-budget-generate" class="bb-form">
        <label class="field"><span>Category</span><select name="category" required>${builder.lines.map((l) => `<option value="${e(l.category)}">${e(l.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Income or expense</span><select name="classification"><option value="Expenses">Expense</option><option value="Income">Income</option></select></label>
        <label class="field"><span>Starting amount ($)</span><input type="number" name="base_amount" step="1" min="0" required></label>
        <label class="field"><span>Growth per year (%)</span><input type="number" name="growth_percent" step="0.1" value="3" required></label>
        <label class="field"><span>Years</span><input name="target_years" value="${targetYear},${targetYear + 1},${targetYear + 2}" required></label>
        <button type="submit">Project this line</button>
      </form>
      <p class="muted-line">Compounds the starting amount once per listed year and saves each year as a grown line.</p>`;
  } else if (current === 'commit') {
    body = `<form method="POST" action="/api/v1/connect-budget-commit" class="bb-form">
        <input type="hidden" name="fiscal_year" value="${targetYear}">
        <button type="submit">Commit the FY${targetYear} plan to the Church report</button>
      </form>
      <p class="muted-line">The Church report then shows this plan as FY${targetYear}’s budget until real figures arrive. Re-commit after changing the plan.</p>`;
  } else {
    body = `<form method="POST" action="/api/v1/connect-budget-generate-all" class="bb-form">
        <input type="hidden" name="base_year" value="${baseYear}"><input type="hidden" name="target_year" value="${targetYear}">
        <label class="field"><span>Growth rate for every grown line (%)</span><input type="number" name="growth_percent" step="0.1" value="3" required></label>
        <button type="submit">Apply to every grown line</button>
      </form>
      <p class="muted-line">Grows each line from its FY${baseYear} ${builder.prorated ? 'projection (year-to-date actual extended to a full year)' : 'actual'}, or its budget when there is no actual. Manual lines are left alone.</p>`;
  }
  return `<div class="panel panel-spaced bb-tools">${nav}${body}</div>`;
}

function lineRow(l, builder, { canEditBudget, canManageBudgetPlan }) {
  const { targetYear, baseYear } = builder;
  const plan = l.plan;
  const change = plan && l.baseBudgetCents != null ? plan.plannedAmountCents - l.baseBudgetCents : null;
  const basis = !plan ? '<span class="bb-badge is-none">Not planned</span>'
    : plan.basis === 'grown' ? '<span class="bb-badge is-grown">Grown</span>' : '<span class="bb-badge is-manual">Manual</span>';
  const growth = plan && plan.basis === 'grown' && plan.growthPct != null ? `${plan.growthPct >= 0 ? '+' : ''}${(plan.growthPct * 100).toFixed(1).replace(/\.0$/, '')}%` : '—';
  const projected = canManageBudgetPlan
    ? `<form method="POST" action="/api/v1/connect-base-projection-write" class="bb-cell-form"><input type="hidden" name="year" value="${baseYear}"><input type="hidden" name="category" value="${e(l.category)}"><input type="number" name="amount" step="1" value="${dollars(l.projectedCents)}" aria-label="FY${baseYear} projection for ${e(l.name)}"${l.projectedOverridden ? ' class="is-corrected"' : ''}><button type="submit" class="link-button">Set</button></form>`
    : `${money(l.projectedCents)}${l.projectedOverridden ? ' <small>corrected</small>' : ''}`;
  const planCell = canEditBudget
    ? `<form method="POST" action="/api/v1/connect-budget-plan-write" class="bb-cell-form"><input type="hidden" name="category" value="${e(l.category)}"><input type="hidden" name="classification" value="${l.classification}"><input type="hidden" name="fiscal_year" value="${targetYear}"><input type="hidden" name="notes" value="${e(plan?.notes || '')}"><input type="number" name="planned_amount" step="1" min="0" value="${dollars(plan?.plannedAmountCents)}" aria-label="FY${targetYear} plan for ${e(l.name)}" required><button type="submit" class="link-button">Save</button></form>`
    : `<b>${money(plan?.plannedAmountCents)}</b>`;
  const remove = canManageBudgetPlan && plan
    ? `<form method="POST" action="/api/v1/connect-budget-plan-remove" class="bb-cell-form"><input type="hidden" name="category" value="${e(l.category)}"><input type="hidden" name="fiscal_year" value="${targetYear}"><button type="submit" class="link-button" title="Remove this line from the FY${targetYear} plan">Remove</button></form>` : '';
  return `<tr><td><b>${e(l.name)}</b><small>${e(l.category)}</small></td>
    <td>${money(l.priorActualCents)}</td><td>${money(l.baseBudgetCents)}</td><td>${projected}</td>
    <td>${basis}</td><td>${growth}</td><td>${planCell}</td>
    <td class="${change == null ? '' : change < 0 ? 'tone-bad' : 'tone-good'}">${change == null ? '—' : signed(change)}</td>
    <td class="bb-notes">${e(plan?.notes || '')}${remove}</td></tr>`;
}

export function renderBudgetBuilderPage({ builder, canEditBudget, canManageBudgetPlan, tab, statuses, councilViewer = false }) {
  const { targetYear, baseYear, priorYear } = builder;
  const t = summarizeBuilder(builder);
  const result = t.incomeCents - t.expenseCents;
  const baseResult = t.baseBudgetIncomeCents - t.baseBudgetExpenseCents;
  const banner = `<div class="bb-banner">
      <div><small>Planned income</small><strong>${money(t.incomeCents)}</strong><span>${signed(t.incomeCents - t.baseBudgetIncomeCents)} vs. FY${baseYear} budget</span></div>
      <div><small>Planned expenses</small><strong>${money(t.expenseCents)}</strong><span>${signed(t.expenseCents - t.baseBudgetExpenseCents)} vs. FY${baseYear} budget</span></div>
      <div><small>Planned result</small><strong>${signed(result)}</strong><span>FY${baseYear} budget: ${signed(baseResult)}</span></div>
      <div><small>Lines</small><strong>${t.planned}</strong><span>${t.grown} grown · ${t.manual} manual${t.unplanned ? ` · ${t.unplanned} not planned` : ''}</span></div>
    </div>`;
  const group = (cls, label) => {
    const rows = builder.lines.filter((l) => l.classification === cls);
    const sum = (pick) => rows.reduce((s, l) => s + (pick(l) || 0), 0);
    const plan = sum((l) => l.plan?.plannedAmountCents);
    const baseBudget = sum((l) => l.baseBudgetCents);
    return `<tr class="bb-group"><td colspan="9">${label}</td></tr>
      ${rows.map((l) => lineRow(l, builder, { canEditBudget, canManageBudgetPlan })).join('') || '<tr><td colspan="9" class="tone-muted">No lines.</td></tr>'}
      <tr class="bb-total"><td>Total ${label.toLowerCase()}</td><td>${money(sum((l) => l.priorActualCents))}</td><td>${money(baseBudget)}</td><td>${money(sum((l) => l.projectedCents))}</td><td></td><td></td><td>${money(plan)}</td><td class="${plan - baseBudget < 0 ? 'tone-bad' : 'tone-good'}">${signed(plan - baseBudget)}</td><td></td></tr>`;
  };
  const table = `<div class="panel panel-spaced list-panel"><div class="table-scroll"><table class="pm-table bb-table"><thead><tr>
      <th>Category</th><th>FY${String(priorYear).slice(2)} actual</th><th>FY${String(baseYear).slice(2)} budget</th><th>FY${String(baseYear).slice(2)} projected</th><th>Basis</th><th>Growth</th><th>FY${String(targetYear).slice(2)} plan</th><th>Change</th><th>Notes</th>
    </tr></thead><tbody>
      ${group('Income', 'Income')}
      ${group('Expenses', 'Expenses')}
      <tr class="bb-result"><td>Planned result</td><td></td><td>${signed(baseResult)}</td><td></td><td></td><td></td><td>${signed(result)}</td><td>${signed(result - baseResult)}</td><td></td></tr>
    </tbody></table></div></div>`;
  return `<p class="lede">The FY${targetYear} church budget plan. Each line is either grown from FY${baseYear}, entered by hand, or not planned yet. Saved to Connect’s budget plan; FY${baseYear} “projected” is ${builder.prorated ? `the year-to-date actual extended to a full year (week ${builder.throughWeek} of 52)` : 'the full-year actual'}, unless a correction has been set.</p>
    ${statusLine(statuses)}
    ${councilViewer ? '<p class="muted-line">This is the shared plan. A council member’s own changes to budget lines are kept as a private copy in Connect’s Budget Planner.</p>' : ''}
    ${banner}
    ${canManageBudgetPlan ? tabPanel(builder, tab) : ''}
    ${table}
    ${canEditBudget ? `<details class="panel panel-spaced edit-panel"><summary>Add a line that is not listed</summary>
      <form method="POST" action="/api/v1/connect-budget-plan-write" class="bb-form">
        <label class="field"><span>Category</span><input name="category" placeholder="e.g. Expenses:Utilities" required></label>
        <label class="field"><span>Income or expense</span><select name="classification"><option value="Expenses">Expense</option><option value="Income">Income</option></select></label>
        <input type="hidden" name="fiscal_year" value="${targetYear}">
        <label class="field"><span>FY${targetYear} plan ($)</span><input type="number" name="planned_amount" step="1" min="0" required></label>
        <label class="field"><span>Notes</span><input name="notes"></label>
        <button type="submit">Add line</button>
      </form></details>` : ''}`;
}

export const BUDGET_BUILDER_STYLES = `
    .bb-banner { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:18px; margin-top:16px; padding:20px 24px; border-radius:10px; background:var(--navy); color:#fff; }
    .bb-banner small { display:block; color:#C9D2E2; font-size:13px; }
    .bb-banner strong { display:block; font-size:28px; margin:4px 0; font-family:Outfit, sans-serif; }
    .bb-banner span { color:#C9D2E2; font-size:12px; }
    .bb-tabs { display:flex; gap:22px; border-bottom:1px solid #E3E7EE; margin:-6px 0 14px; }
    .bb-tabs a, .bb-tabs span { padding:10px 0; font-weight:600; font-size:14px; color:#4B5563; text-decoration:none; }
    .bb-tabs .is-on { color:var(--navy); border-bottom:2px solid #9A6B12; }
    .bb-form { display:flex; flex-wrap:wrap; gap:12px 16px; align-items:flex-end; }
    .bb-form button { margin-top:0; }
    .bb-table td, .bb-table th:not(:first-child) { text-align:right; white-space:nowrap; }
    .bb-table td:first-child, .bb-table td.bb-notes { text-align:left; white-space:normal; }
    .bb-table td:first-child { min-width:150px; }
    .bb-table th, .bb-table td { padding-left:8px; padding-right:8px; }
    .bb-table td:first-child small { display:block; color:#6B7280; font-size:11px; }
    .bb-table td.bb-notes { font-size:13px; color:#4B5563; min-width:120px; max-width:180px; }
    .bb-group td { font-weight:700; background:#F4F6F9; text-align:left !important; }
    .bb-total td { font-weight:700; border-top:1px solid #C3CDDD; }
    .bb-result td { font-weight:700; background:#FBF5E6; border-top:2px solid var(--navy); }
    .bb-badge { display:inline-block; padding:2px 10px; border-radius:999px; font-size:12px; font-weight:600; }
    .bb-badge.is-grown { background:#EEF0F4; color:#374151; }
    .bb-badge.is-manual { background:#FBF0D9; color:#8A5A0B; }
    .bb-badge.is-none { background:#fff; color:#9CA3AF; border:1px dashed #D5DAE3; }
    .bb-cell-form { display:inline-flex; align-items:center; gap:6px; margin:0; }
    .bb-cell-form input { width:88px; text-align:right; padding:4px 6px; }
    .bb-cell-form input.is-corrected { border-color:#C9962E; }
    .bb-cell-form button { margin-top:0; }
    .bb-notes .bb-cell-form { display:block; margin-top:4px; }
`;
