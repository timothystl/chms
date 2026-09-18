import { buildBudgetReportView, buildLiveBudgetReportView } from './budget-report-service.js';
import { escapeHtml, formatCents, formatSignedCents, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';

export function renderBudgetRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.classification)}</td><td>${escapeHtml(row.category)}</td><td>${formatCents(row.base_amount_cents)}</td><td>${(row.growth_pct * 100).toFixed(1)}%</td><td>${formatCents(row.planned_amount_cents)}</td><td>${formatSignedCents(row.changeCents)}</td><td>${escapeHtml(row.notes)}</td></tr>`).join('');
}

// Live rows carry the contract's own camelCase shape (see budget-report-service.js's
// buildLiveBudgetReportView) rather than the synthetic reader's snake_case row shape -- the two
// are not equivalent for Budget the way they are for Chart of Accounts, since real categories can
// be basis 'manual' with no base/growth at all. A category without a growth basis renders '--' in
// those cells rather than a fabricated 0%/$0 comparison.
//
// A per-row Delete action (admin only, matching the legacy DELETE finance/planning/church/
// :category/:year route's own gate) is appended as a last column when `canManageBudgetPlan` --
// never shown to council, who may only hand-correct a planned amount, not remove a category from
// the shared plan outright.
export function renderLiveBudgetRows(rows, fiscalYear, canManageBudgetPlan) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.classification)}</td><td>${escapeHtml(row.category)}</td><td>${row.hasBasis ? formatCents(row.baseAmountCents) : '—'}</td><td>${row.hasBasis ? `${(row.growthPct * 100).toFixed(1)}%` : '—'}</td><td>${formatCents(row.plannedAmountCents)}</td><td>${row.changeCents === null ? '—' : formatSignedCents(row.changeCents)}</td><td>${escapeHtml(row.basis === 'grown' ? 'Grown from base' : 'Manual entry')}</td><td>${escapeHtml(row.notes)}</td>${canManageBudgetPlan ? `<td><form method="POST" action="/api/v1/connect-budget-plan-remove" style="display:inline">
      <input type="hidden" name="category" value="${escapeHtml(row.category)}"><input type="hidden" name="fiscal_year" value="${escapeHtml(String(fiscalYear))}">
      <button type="submit" onclick="return confirm('Remove ${escapeHtml(row.category)} from the FY${escapeHtml(String(fiscalYear))} plan?')">Delete</button>
    </form></td>` : ''}</tr>`).join('');
}

// Manual edit/save for one category+fiscal-year row -- relayed live to Connect's real
// finance_budget_plan table (see finance-budget-write-v1 in src/api-contracts-service.js), never
// stored in Finance's own database. Deliberately scoped to one row per submit, matching Gift
// Entry's own single-entry form (gift-entry-pages.js) rather than an inline-editable whole table;
// re-submitting the same category and fiscal year upserts that row, same as the legacy in-Connect
// Budget Planner. Shown regardless of whether the table above rendered live or synthetic-fallback
// data -- the write itself always goes live, independent of what this particular page load's read
// happened to return.
function renderBudgetEditForm(fiscalYear, budgetEntryStatus, budgetEntryMessage) {
  return `<section aria-label="Edit a Budget Plan category">
    ${renderSectionHeading({ eyebrow: 'Budget builder', heading: 'Edit a category', badge: 'Relayed live to Connect' })}
    ${budgetEntryStatus === 'ok' ? '<p class="status">Saved in Connect.</p>' : ''}
    ${budgetEntryStatus === 'error' ? `<p class="status status-error">Not saved: ${escapeHtml(budgetEntryMessage || 'unknown error')}</p>` : ''}
    <form method="POST" action="/api/v1/connect-budget-plan-write">
      <div class="grid form-grid">
        <div class="field"><label for="bp-category">Category</label><input id="bp-category" type="text" name="category" placeholder="e.g. Expenses:Utilities" required></div>
        <div class="field"><label for="bp-classification">Classification</label><select id="bp-classification" name="classification"><option value="Expenses" selected>Expenses</option><option value="Income">Income</option></select></div>
        <div class="field"><label for="bp-year">Fiscal year</label><input id="bp-year" type="number" name="fiscal_year" min="2000" max="2100" value="${escapeHtml(String(fiscalYear))}" required></div>
        <div class="field"><label for="bp-amount">Planned amount ($, whole dollars)</label><input id="bp-amount" type="number" name="planned_amount" step="1" min="0" placeholder="0" required></div>
      </div>
      <div class="field"><label for="bp-notes">Notes</label><input id="bp-notes" type="text" name="notes" placeholder="optional"></div>
      <button type="submit">Save category</button>
    </form>
    <p>This writes directly into Connect's own <code>finance_budget_plan</code> table — the same table the legacy in-Connect Budget Planner edits, using its exact same validation and upsert behavior (re-saving the same category and fiscal year replaces that row rather than adding a second one). Finance never stores a copy. Only Connect's own admin and council roles may save; Connect independently re-verifies your identity and role for every request.</p>
  </section>`;
}

// Admin-only bulk plan generation, relayed live to Connect's finance/planning/church/generate-all
// route -- one plan row per real Chart of Accounts line, grown off a base year's own actual (or
// budget, if the base year has no actual yet) by a single flat growth rate. Re-running for the
// same target year replaces every 'grown' row for that year (a prior manual override on any one
// category is untouched, matching the legacy route's own upsert behavior).
function renderBudgetGenerateAllForm(baseYear, targetYear, planOpStatus, planOpMessage, planOpKind) {
  return `<section aria-label="Generate the whole Budget Plan from a base year">
    ${renderSectionHeading({ eyebrow: 'Budget builder', heading: 'Generate the whole plan from a base year', badge: 'Relayed live to Connect' })}
    ${planOpKind === 'generate-all' && planOpStatus === 'ok' ? '<p class="status">Generated in Connect.</p>' : ''}
    ${planOpKind === 'generate-all' && planOpStatus === 'error' ? `<p class="status status-error">Not generated: ${escapeHtml(planOpMessage || 'unknown error')}</p>` : ''}
    <form method="POST" action="/api/v1/connect-budget-generate-all">
      <div class="grid form-grid">
        <div class="field"><label for="bga-base">Base year</label><input id="bga-base" type="number" name="base_year" min="2000" max="2100" value="${escapeHtml(String(baseYear))}" required></div>
        <div class="field"><label for="bga-target">Target year</label><input id="bga-target" type="number" name="target_year" min="2000" max="2100" value="${escapeHtml(String(targetYear))}" required></div>
        <div class="field"><label for="bga-growth">Growth rate (fraction, e.g. 0.03 for 3%)</label><input id="bga-growth" type="number" name="growth_pct" step="0.001" value="0" required></div>
      </div>
      <button type="submit">Generate every category</button>
    </form>
    <p><small>Every account with an actual or budget figure in the base year gets one plan row for the target year, replacing any existing 'grown' row for that same category and year. A base year still in progress is annualized (projected forward from its year-to-date figure) before the growth rate applies, matching Church Report's own precedence rules. Use Edit a category afterward to hand-correct individual lines.</small></p>
  </section>`;
}

// Admin-only single-category compounding multi-year projection, relayed live to Connect's
// finance/planning/church/generate route -- distinct from generate-all above, which grows every
// real account line at once from a base year's actual/budget; this instead grows ONE hand-typed
// category from a hand-typed starting dollar amount, compounding across a list of target years.
function renderBudgetGenerateForm(targetYear, planOpStatus, planOpMessage, planOpKind) {
  return `<section aria-label="Generate a multi-year projection for one category">
    ${renderSectionHeading({ eyebrow: 'Budget builder', heading: 'Generate a multi-year projection for one category', badge: 'Relayed live to Connect' })}
    ${planOpKind === 'generate' && planOpStatus === 'ok' ? '<p class="status">Generated in Connect.</p>' : ''}
    ${planOpKind === 'generate' && planOpStatus === 'error' ? `<p class="status status-error">Not generated: ${escapeHtml(planOpMessage || 'unknown error')}</p>` : ''}
    <form method="POST" action="/api/v1/connect-budget-generate">
      <div class="grid form-grid">
        <div class="field"><label for="bg-category">Category</label><input id="bg-category" type="text" name="category" placeholder="e.g. Expenses:Utilities" required></div>
        <div class="field"><label for="bg-classification">Classification</label><select id="bg-classification" name="classification"><option value="Expenses" selected>Expenses</option><option value="Income">Income</option></select></div>
        <div class="field"><label for="bg-base">Starting amount ($, whole dollars)</label><input id="bg-base" type="number" name="base_amount" step="1" min="0" required></div>
        <div class="field"><label for="bg-growth">Growth rate (fraction, e.g. 0.03 for 3%)</label><input id="bg-growth" type="number" name="growth_pct" step="0.001" value="0" required></div>
        <div class="field"><label for="bg-years">Target years (comma-separated, e.g. ${targetYear},${targetYear + 1},${targetYear + 2})</label><input id="bg-years" type="text" name="target_years" placeholder="${targetYear},${targetYear + 1}" required></div>
      </div>
      <button type="submit">Generate projection</button>
    </form>
    <p><small>Compounds the starting amount by the growth rate once per listed year (in order), upserting one 'grown' row per year -- a later hand-typed edit on any one of those years replaces just that year's row without touching the others.</small></p>
  </section>`;
}

// Admin-only plan finalization, relayed live to Connect's finance/planning/church/commit route --
// wholesale-replaces this fiscal year's placeholder 'plan_committed' rows in finance_church_entries
// with the current plan, so Church Report can show it as a budget before any real actual/QuickBooks
// data exists for that year.
function renderBudgetCommitForm(targetYear, planOpStatus, planOpMessage, planOpKind) {
  return `<section aria-label="Commit the Budget Plan into Church Report">
    ${renderSectionHeading({ eyebrow: 'Budget builder', heading: 'Commit this plan into Church Report', badge: 'Relayed live to Connect' })}
    ${planOpKind === 'commit' && planOpStatus === 'ok' ? '<p class="status">Committed in Connect.</p>' : ''}
    ${planOpKind === 'commit' && planOpStatus === 'error' ? `<p class="status status-error">Not committed: ${escapeHtml(planOpMessage || 'unknown error')}</p>` : ''}
    <form method="POST" action="/api/v1/connect-budget-commit">
      <div class="grid form-grid">
        <div class="field"><label for="bc-year">Fiscal year</label><input id="bc-year" type="number" name="fiscal_year" min="2000" max="2100" value="${escapeHtml(String(targetYear))}" required></div>
      </div>
      <button type="submit">Commit plan</button>
    </form>
    <p><small>Replaces every prior committed placeholder for this fiscal year with the plan as it stands right now (own_actual_cents=0 -- there's no actual yet, that's the whole point). Re-commit after editing the plan to avoid leaving stale categories behind.</small></p>
  </section>`;
}

// Admin-only whole-dollar correction to one category's "FY{base} Projected" column, for one
// fiscal year -- relayed live to Connect's real finance_settings key finance_base_proj_overrides
// (see finance-base-projection-write-v1 in src/api-contracts-service.js), never stored in
// Finance's own database. One category per submit, same shape as Daycare Report's own Budget-cell
// override form; leaving the amount blank clears any existing override for that category and year.
function renderBaseProjectionForm(fiscalYear, entryStatus, entryMessage) {
  return `<section aria-label="Correct a Projected figure">
    ${renderSectionHeading({ eyebrow: 'Budget builder', heading: 'Correct a Projected figure', badge: 'Relayed live to Connect' })}
    ${entryStatus === 'ok' ? '<p class="status">Saved in Connect.</p>' : ''}
    ${entryStatus === 'error' ? `<p class="status status-error">Not saved: ${escapeHtml(entryMessage || 'unknown error')}</p>` : ''}
    <form method="POST" action="/api/v1/connect-base-projection-write">
      <div class="grid form-grid">
        <div class="field"><label for="bpj-year">Fiscal year</label><input id="bpj-year" type="number" name="year" min="2000" max="2100" value="${escapeHtml(String(fiscalYear))}" required></div>
        <div class="field"><label for="bpj-category">Category</label><input id="bpj-category" type="text" name="category" placeholder="e.g. Expenses:Utilities" required></div>
        <div class="field"><label for="bpj-amount">Projected amount ($, whole dollars -- blank clears)</label><input id="bpj-amount" type="number" name="amount" step="1"></div>
      </div>
      <button type="submit">Save Projected correction</button>
    </form>
    <p><small>Corrects one category's own "FY${escapeHtml(String(fiscalYear))} Projected" figure -- the automatic actual-to-date annualization for the year still in progress -- without touching finance_budget_plan (a future year's plan) or the account's real posted actual. Only Connect's own admin role may save; Connect independently re-verifies your identity and role for every request.</small></p>
  </section>`;
}

export function renderPlanningPage(pageId, {
  budgetReport, canEditBudget, budgetEntryStatus, budgetEntryMessage,
  canManageBudgetPlan, planOpStatus, planOpMessage, planOpKind,
  baseProjectionEntryStatus, baseProjectionEntryMessage,
}) {
  if (pageId === 'compensation-link') {
    return `<section class="report" aria-label="Planning compensation link">
      ${renderSectionHeading({ eyebrow: 'Planning', heading: 'Compensation planning', badge: 'See Compensation' })}
      <p>Compensation planning (salary plan, benefits &amp; taxes, benchmarks, and the council snapshot) lives in its own <a href="/?section=compensation">Compensation</a> workspace, since it has its own <code>compensation</code> permission separate from Budget.</p>
    </section>`;
  }
  // 'builder' (default)
  const isLive = budgetReport.source === 'live';
  if (isLive) {
    const view = buildLiveBudgetReportView(budgetReport.categories, budgetReport.fiscalYear);
    return `<section class="report" aria-label="Budget Plan">
      ${renderSectionHeading({ eyebrow: 'Budget builder', heading: `Plan for fiscal year ${view.fiscalYear}`, badge: 'Live from Connect' })}
      ${renderKpiCards([
        { label: 'Planned result', value: formatSignedCents(view.totals.plannedNetCents), hint: `Income ${formatCents(view.totals.plannedIncomeCents)} · expenses ${formatCents(view.totals.plannedExpenseCents)}` },
        { label: 'Categories planned', value: String(view.counts.categoryCount), hint: `${view.counts.grownCount} grown from a base · ${view.counts.manualCount} manually entered` },
      ])}
      ${renderTable({ head: ['Classification', 'Category', 'Base amount', 'Growth', 'Planned amount', 'Change', 'Basis', 'Notes', ...(canManageBudgetPlan ? [''] : [])], rows: renderLiveBudgetRows(view.rows, view.fiscalYear, canManageBudgetPlan) })}
      <p><small>Fetched live from Connect's real, structural finance_budget_plan table via the finance-budget contract. ${view.counts.categoryCount === 0 ? `No plan exists yet for fiscal year ${view.fiscalYear}.` : `Base amount and growth only show for categories generated from a growth rate ('grown') -- most of today's real plan was entered directly ('manual') and has no base to compare against.`}</small></p>
      ${canEditBudget ? renderBudgetEditForm(view.fiscalYear, budgetEntryStatus, budgetEntryMessage) : ''}
      ${canManageBudgetPlan ? renderBudgetGenerateAllForm(view.fiscalYear - 1, view.fiscalYear, planOpStatus, planOpMessage, planOpKind) : ''}
      ${canManageBudgetPlan ? renderBudgetGenerateForm(view.fiscalYear, planOpStatus, planOpMessage, planOpKind) : ''}
      ${canManageBudgetPlan ? renderBudgetCommitForm(view.fiscalYear, planOpStatus, planOpMessage, planOpKind) : ''}
      ${canManageBudgetPlan ? renderBaseProjectionForm(view.fiscalYear, baseProjectionEntryStatus, baseProjectionEntryMessage) : ''}
    </section>`;
  }
  const report = buildBudgetReportView(budgetReport.rows);
  return `<section class="report" aria-label="Synthetic Budget Report">
    ${renderSectionHeading({ eyebrow: 'Budget builder', heading: `Plan for fiscal year ${report.fiscalYear}`, badge: 'Synthetic staging' })}
    ${renderKpiCards([
      { label: 'Base result', value: formatSignedCents(report.totals.baseNetCents), hint: `Income ${formatCents(report.totals.baseIncomeCents)} · expenses ${formatCents(report.totals.baseExpenseCents)}` },
      { label: 'Planned result', value: formatSignedCents(report.totals.plannedNetCents), hint: `Income ${formatCents(report.totals.plannedIncomeCents)} · expenses ${formatCents(report.totals.plannedExpenseCents)}` },
      { label: 'Outlook change', value: formatSignedCents(report.totals.netChangeCents), hint: `${report.totals.reconciled ? 'Planned totals reconcile' : 'Review required'} · read-only preview` },
    ])}
    ${renderTable({ head: ['Classification', 'Category', 'Base amount', 'Growth', 'Planned amount', 'Change', 'Notes'], rows: renderBudgetRows(report.rows) })}
    <p><small>The committed synthetic fixture (the live endpoint is not configured or did not answer${budgetReport.fallbackReason ? `: ${escapeHtml(budgetReport.fallbackReason)}` : ''}).</small></p>
    ${canEditBudget ? renderBudgetEditForm(report.fiscalYear, budgetEntryStatus, budgetEntryMessage) : ''}
    ${canManageBudgetPlan ? renderBudgetGenerateAllForm(report.fiscalYear - 1, report.fiscalYear, planOpStatus, planOpMessage, planOpKind) : ''}
    ${canManageBudgetPlan ? renderBudgetGenerateForm(report.fiscalYear, planOpStatus, planOpMessage, planOpKind) : ''}
    ${canManageBudgetPlan ? renderBudgetCommitForm(report.fiscalYear, planOpStatus, planOpMessage, planOpKind) : ''}
    ${canManageBudgetPlan ? renderBaseProjectionForm(report.fiscalYear, baseProjectionEntryStatus, baseProjectionEntryMessage) : ''}
  </section>`;
}
