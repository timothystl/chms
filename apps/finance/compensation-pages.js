import { buildCompensationCouncilSnapshot, buildCompensationReportView, buildLiveCompensationCouncilSnapshot, filterCompensationWorkersForViewer, summarizeCompensationWorkers } from './compensation-report-service.js';
import { buildCompensationBenchmarkView } from './compensation-benchmark-service.js';
import { buildCompensationBenefitsView } from './compensation-benefits-service.js';
import { escapeHtml, formatCents, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';
import { COUNCIL_COMP_METHODS, COUNCIL_COMP_METHOD_LABELS } from './compensation-council-overlay.js';
import { renderCompensationPlanEditor } from './compensation-editor-pages.js';
import { renderBenchmarksPage, renderBenefitsTaxesPage, renderCouncilReport, renderProjectionSummary } from './compensation-council-report.js';
import { renderConcordiaRangesEditor, renderRaiseMethodsEditor, renderRatesPage } from './compensation-settings-pages.js';

// Which plan year the projection is for; a plain GET form, so the choice is a link like any other.
function renderPlanYearForm(pageId, projection) {
  const year = projection.model.targetYear;
  return `<form method="GET" action="/" class="inline-form" aria-label="Plan year">
    <input type="hidden" name="section" value="compensation"><input type="hidden" name="page" value="${pageId}">
    <label for="plan-year-${pageId}">Plan year</label>
    <input id="plan-year-${pageId}" type="number" name="plan_year" min="2000" max="2100" step="1" value="${year}">
    <button type="submit">Show</button>
    <small>Compared against FY${projection.model.baseYear}.</small>
  </form>`;
}

function renderProjectionUnavailable(projection) {
  return `<p class="status status-error">The raise projection could not be computed: ${escapeHtml(projection.message || 'unknown error')}.</p>`;
}

// The Plan page's projection under the editor or draft being shown.
function renderPlanProjection(projection, { councilDraft, viewerRole }) {
  if (!projection) return '';
  if (!projection.ok) return renderProjectionUnavailable(projection);
  const hidden = viewerRole === 'council' ? 0 : projection.model.roster.filter((w) => w && w.hideFromCouncil).length;
  const notes = [];
  if (hidden) notes.push(`Includes ${hidden} worker${hidden === 1 ? '' : 's'} hidden from council; the Council report leaves ${hidden === 1 ? 'that worker' : 'them'} out.`);
  notes.push('Methods, rates and the health plan come from the saved plan; the Council page has the full report with benefits, market ranges and the recommended motion.');
  return `${renderPlanYearForm('plan', projection)}${renderProjectionSummary(projection, {
    heading: councilDraft ? 'Projected salaries under your draft' : 'Projected salaries',
    badge: councilDraft ? 'Your draft · not the shared plan' : 'Computed from the saved plan',
    note: notes.join(' '),
  })}`;
}

export function renderCompensationRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.role_label)}</td><td>${formatCents(row.salary_cents)}</td><td>${formatCents(row.benefits_cents)}</td><td>${row.adjustment_pct.toFixed(1)}%</td></tr>`).join('');
}

export function renderCompensationBenchmarkRows(rows) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.roleLabel)}</td><td>${formatCents(row.salaryCents)}</td><td>${formatCents(row.benchmarkSalaryCents)}</td><td>${row.salaryToBenchmarkPct.toFixed(1)}%</td><td>${formatCents(row.gapCents)}</td></tr>`).join('');
}

export function renderCompensationBenefitRows(rows, totalCents) {
  return rows.map((row) => `<tr><td>${escapeHtml(row.componentLabel)}</td><td>${formatCents(row.amountCents)}</td><td>${totalCents === 0 ? '0.0' : (row.amountCents / totalCents * 100).toFixed(1)}%</td><td>${row.roleCount}</td></tr>`).join('');
}

// Live rows carry real names/positions -- see finance-compensation-consumer.js. currentPayCents is
// null (with currentPaySource explaining why) for a worker whose current pay is not hand-entered
// but instead lives on their linked Chart of Accounts budget line -- see this contract's producer
// comment (src/api-contracts.js) on why that figure is not re-derived here.
const CURRENT_PAY_SOURCE_LABELS = { entered: 'Entered', budget_line: 'From budget line', unset: 'Not set' };
export function renderLiveCompensationWorkerRows(workers) {
  return workers.map((w) => `<tr><td>${escapeHtml(w.name || '(unnamed)')}</td><td>${escapeHtml(w.position || 'Role not set')}</td><td>${w.currentPayCents != null ? formatCents(w.currentPayCents) : '—'}</td><td>${escapeHtml(CURRENT_PAY_SOURCE_LABELS[w.currentPaySource] || w.currentPaySource)}</td></tr>`).join('');
}

// Council's own raise-plan editor (Andrew, 2026-09-25): the legacy Salary Planner fields council may
// steer, saved as that member's private draft by compensation-council-overlay-save-v1. `plan` is
// Connect's plan contract as resolved for this council member -- workers hidden from council are
// already removed and their own saved draft is already laid over the shared plan.
export function renderCouncilOverlayEditor(plan, entryStatus, entryMessage) {
  const roster = Array.isArray(plan && plan.roster) ? plan.roster : [];
  const perWorker = (plan && plan.compPerWorkerMethod) || {};
  const planMethod = COUNCIL_COMP_METHODS.includes(plan && plan.compMethod) ? plan.compMethod : 'cola';
  const option = (value, label, selected) => `<option value="${value}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const methodOptions = (selected) => COUNCIL_COMP_METHODS.map((m) => option(m, COUNCIL_COMP_METHOD_LABELS[m], m === selected)).join('');
  const rows = roster.map((w, i) => `<tr><td>${escapeHtml((w && (w.name || w.position)) || `Staff member ${i + 1}`)}</td><td><select name="worker_method_${i}" aria-label="Raise method for ${escapeHtml((w && w.name) || `staff member ${i + 1}`)}">${option('default', 'Plan-wide method', !perWorker[i])}${methodOptions(perWorker[i])}</select></td></tr>`).join('');
  const num = (value) => (value === undefined || value === null || value === '' ? '' : escapeHtml(String(value)));
  return `<section aria-label="Your raise-plan draft">
    ${renderSectionHeading({ eyebrow: 'Compensation', heading: 'Your raise-plan draft', badge: 'Private to you' })}
    ${entryStatus === 'ok' ? '<p class="status">Draft saved.</p>' : ''}
    ${entryStatus === 'error' ? `<p class="status status-error">Not saved: ${escapeHtml(entryMessage || 'unknown error')}</p>` : ''}
    <p>Try raise methods without changing the shared plan. Only you see this draft; the staff roster and pay figures are not editable here.</p>
    <form method="POST" action="/api/v1/compensation-council-overlay-save">
      <div class="grid form-grid">
        <div class="field"><label for="cc-method">Plan-wide raise method</label><select id="cc-method" name="comp_method">${methodOptions(planMethod)}</select></div>
        <div class="field"><label for="cc-custom">Custom raise (%)</label><input id="cc-custom" type="number" name="comp_custom_pct" min="0" max="100" step="0.1" value="${num(plan && plan.compCustomPct)}"></div>
        <div class="field"><label for="cc-scale">Share of District Scale (%)</label><input id="cc-scale" type="number" name="comp_scale_pct" min="0" max="100" step="1" value="${num(plan && plan.compScalePct)}"></div>
        <div class="field"><label><input type="checkbox" name="comp_baseline_roster_only" value="1"${plan && plan.compBaselineRosterOnly ? ' checked' : ''}> Compare against the roster baseline only</label></div>
      </div>
      ${roster.length ? renderTable({ head: ['Staff member', 'Raise method'], rows }) : '<p>No staff members are shown to council.</p>'}
      <button type="submit">Save my draft</button>
    </form>
  </section>`;
}

export function renderCompensationPage(pageId, {
  compensationReport, compensationReportLive, compensationBenchmarks, compensationBenefits, viewerRole,
  compensationPlanRaw, canEditCompensation, editIndex, entryStatus, entryMessage, canEditCouncilOverlay = false,
  compensationProjection = null, planYear = null, refYear = null,
}) {
  // The real roster editor (compensation-editor-pages.js) takes over the Plan page entirely for
  // the admin/compensation roles it's built for, whenever shell.js's own fetch-edit-resubmit
  // relay (fetchConnectSalaryPlannerState) actually returned the raw plan -- never for council
  // (its real editing surface stays the separate, narrower raise-plan-field overlay) and never
  // when the relay failed, in which case this falls through to the read-only live/synthetic
  // views below. Checked before buildCompensationReportView() below (which needs a valid
  // synthetic `compensationReport` and throws on SYNTHETIC_UNAVAILABLE) because the editor never
  // reads the synthetic role-level report at all.
  if (pageId === 'plan' && canEditCompensation && compensationPlanRaw && compensationPlanRaw.ok) {
    return renderCompensationPlanEditor(compensationPlanRaw.data, editIndex, entryStatus, entryMessage)
      + renderRaiseMethodsEditor(compensationPlanRaw.data, compensationProjection, { planYear })
      + renderPlanProjection(compensationProjection, { councilDraft: false, viewerRole });
  }
  // Legacy's "This year's rates" and market comparison data: editable by admin/compensation,
  // shown read-only to the other roles allowed to read the saved plan.
  if (pageId === 'rates') {
    if (compensationProjection && compensationProjection.ok && compensationPlanRaw && compensationPlanRaw.ok) {
      return renderRatesPage(compensationProjection, compensationPlanRaw.data, {
        canEdit: Boolean(canEditCompensation), refYear, planYear, entryStatus, entryMessage,
      });
    }
    if (compensationProjection && !compensationProjection.ok) return renderProjectionUnavailable(compensationProjection);
    return `<p class="status status-error">Rates &amp; ranges are part of the saved compensation plan, which could not be read${compensationPlanRaw && !compensationPlanRaw.ok ? `: ${escapeHtml(compensationPlanRaw.message || compensationPlanRaw.reason || 'unknown error')}` : ''}.</p>`;
  }
  const editUnavailableNote = (pageId === 'plan' && canEditCompensation && compensationPlanRaw && !compensationPlanRaw.ok)
    ? `<p class="status status-pending">Editing is unavailable right now: ${escapeHtml(compensationPlanRaw.message || compensationPlanRaw.reason || 'unknown error')}.</p>`
    : '';
  const councilEditor = pageId === 'plan' && canEditCouncilOverlay && compensationPlanRaw
    ? (compensationPlanRaw.ok
      ? renderCouncilOverlayEditor(compensationPlanRaw.data, entryStatus, entryMessage)
      : `<p class="status status-pending">Your raise-plan draft is unavailable right now: ${escapeHtml(compensationPlanRaw.message || compensationPlanRaw.reason || 'unknown error')}.</p>`)
    : '';

  // With the saved plan (admin, council and compensation roles), both pages are built from the same
  // projection as the Council report: the LCMS Missouri District tables, the Concordia Plans rates
  // and health quote, and each worker's Concordia Compensation Decision Support ranges. The
  // synthetic role-level fixtures below remain only for viewers the saved plan is not shown to.
  if (pageId === 'benchmarks' && compensationProjection && compensationProjection.ok) {
    const rangesEditor = canEditCompensation && compensationPlanRaw && compensationPlanRaw.ok
      ? renderConcordiaRangesEditor(compensationPlanRaw.data, compensationProjection.model, { planYear, canEdit: true, returnPage: 'benchmarks' })
      : '';
    const status = entryStatus === 'ok' ? '<p class="status">Saved in Connect.</p>'
      : entryStatus === 'error' ? `<p class="status status-error">Not saved: ${escapeHtml(entryMessage || 'unknown error')}</p>` : '';
    return status + renderPlanYearForm('benchmarks', compensationProjection) + renderBenchmarksPage(compensationProjection) + rangesEditor;
  }
  if (pageId === 'benefits' && compensationProjection && compensationProjection.ok) {
    return renderPlanYearForm('benefits', compensationProjection) + renderBenefitsTaxesPage(compensationProjection);
  }
  if (['benchmarks', 'benefits'].includes(pageId) && compensationProjection && !compensationProjection.ok) {
    return renderProjectionUnavailable(compensationProjection);
  }
  if (['benchmarks', 'benefits'].includes(pageId) && compensationPlanRaw && !compensationPlanRaw.ok) {
    return `<p class="status status-error">This page is built from the saved compensation plan, which could not be read: ${escapeHtml(compensationPlanRaw.message || compensationPlanRaw.reason || 'unknown error')}. Nothing here is a real $0.</p>`;
  }
  if (pageId === 'benchmarks') {
    const benchmark = buildCompensationBenchmarkView(buildCompensationReportView(compensationReport), compensationBenchmarks);
    return `<section class="report" aria-label="Synthetic Compensation Report benchmarks">
      ${renderSectionHeading({ eyebrow: 'Benchmark comparison', heading: 'Salary against synthetic district-style reference', badge: 'Synthetic · not published guidance' })}
      ${renderKpiCards([
        { label: 'Planned salaries', value: formatCents(benchmark.totals.salaryCents) },
        { label: 'Benchmark salaries', value: formatCents(benchmark.totals.benchmarkSalaryCents), hint: `${benchmark.totals.salaryToBenchmarkPct.toFixed(1)}% of benchmark` },
        { label: 'Gap to benchmark', value: formatCents(benchmark.totals.gapCents), hint: 'Salary only · alternative, not the plan' },
      ])}
      ${renderTable({ head: ['Role', 'Planned salary', 'Benchmark salary', 'Share of benchmark', 'Gap'], rows: renderCompensationBenchmarkRows(benchmark.rows) })}
    </section>`;
  }
  if (pageId === 'benefits') {
    const benefits = buildCompensationBenefitsView(buildCompensationReportView(compensationReport), compensationBenefits);
    return `<section class="report" aria-label="Synthetic Compensation Report benefits and taxes">
      ${renderSectionHeading({ eyebrow: 'Benefits &amp; taxes', heading: 'What the benefits plan contains', badge: `${benefits.reconciled ? 'Reconciled' : 'Review required'} · role-only` })}
      ${renderTable({ head: ['Component', 'Amount', 'Share of benefits', 'Roles covered'], rows: renderCompensationBenefitRows(benefits.rows, benefits.totalCents) })}
      <p>The component total is ${formatCents(benefits.totalCents)} and must exactly match the benefits plan. No personal identities are included.</p>
    </section>`;
  }
  if (pageId === 'council' && compensationProjection && compensationProjection.ok) {
    return renderPlanYearForm('council', compensationProjection) + renderCouncilReport(compensationProjection);
  }
  if (pageId === 'council') {
    const projectionNote = compensationProjection ? renderProjectionUnavailable(compensationProjection)
      : (compensationPlanRaw && !compensationPlanRaw.ok ? `<p class="status status-pending">The Council report needs the saved plan, which could not be read: ${escapeHtml(compensationPlanRaw.message || compensationPlanRaw.reason || 'unknown error')}. The aggregate snapshot is shown instead.</p>` : '');
    // Unlike Benchmarks/Benefits above, a real council rollup IS possible for the roles who
    // already see this same roster, per person, on the Plan page -- see
    // buildLiveCompensationCouncilSnapshot's own header comment in compensation-report-service.js
    // for exactly which real fields it uses and which synthetic-only fields (benefitsSharePct,
    // weightedAdjustmentPct) it deliberately does not try to reconstruct.
    if (compensationReportLive && compensationReportLive.source === 'live') {
      const council = buildLiveCompensationCouncilSnapshot(compensationReportLive, viewerRole);
      return `${projectionNote}<section class="report" aria-label="Compensation Report council snapshot">
        ${renderSectionHeading({ eyebrow: 'Council review snapshot', heading: 'Real roster decision context', badge: 'Live from Connect · review-only · not approved' })}
        ${renderKpiCards([
          { label: 'Workers on roster', value: String(council.workerCount), hint: viewerRole === 'council' ? 'Excludes any worker not shown to council' : 'Real per-person roster, aggregated' },
          { label: 'Current pay entered', value: String(council.enteredCurrentPayCount), hint: `${council.unenteredCurrentPayCount} read from a linked budget line or not yet set` },
          { label: 'Entered current pay total', value: formatCents(council.enteredCurrentPayCents), hint: 'Sum of hand-entered current-pay figures only' },
        ])}
        <p>Real, aggregate roster facts only -- restricted to the admin, council, and compensation roles who already see this same data, per person, on the Plan page. No benefits-share or weighted-adjustment figure is shown here: those are planning assumptions Connect does not store per worker, so this page never estimates or reconstructs them.</p>
      </section>`;
    }
    const council = buildCompensationCouncilSnapshot(buildCompensationReportView(compensationReport));
    return `${projectionNote}<section class="report" aria-label="Synthetic Compensation Report council snapshot">
      ${renderSectionHeading({ eyebrow: 'Council review snapshot', heading: 'Plan-level decision context', badge: 'Role-only · review-only · not approved' })}
      ${renderKpiCards([
        { label: 'Roles represented', value: String(council.roleCount), hint: 'No personal identities' },
        { label: 'Benefits share', value: `${council.benefitsSharePct.toFixed(1)}%`, hint: 'Of total planned compensation' },
        { label: 'Weighted adjustment', value: `${council.weightedAdjustmentPct.toFixed(1)}%`, hint: 'Salary-weighted planning assumption' },
      ])}
    </section>`;
  }
  // 'plan' (default) -- the real, per-person finance-salary-planner roster. Benchmarks and Benefits
  // above are built from the same saved plan for the roles allowed to read it. Council above has its
  // own honest live rollup for the same allowed roles, built only from real, already-stored
  // aggregate facts -- see buildLiveCompensationCouncilSnapshot's header comment.
  //
  // A verified `council` viewer must never see a worker flagged `hideFromCouncil`, matching the
  // same rule production's own Salary Planner and this section's own Council page already enforce
  // for that role (see filterCompensationWorkersForViewer's header comment) -- the raw contract
  // fetch has no viewer identity attached and returns every worker, flagged or not, so this page
  // must filter here rather than trust the fetch to have done it. The KPI totals are recomputed
  // from the SAME filtered list (summarizeCompensationWorkers), never the raw contract `totals`,
  // so a hidden worker's entered pay can never leak into "Entered current pay total" either.
  if (compensationReportLive && compensationReportLive.source === 'live') {
    const workers = filterCompensationWorkersForViewer(compensationReportLive.workers, viewerRole);
    const totals = summarizeCompensationWorkers(workers);
    return `<section class="report" aria-label="Compensation Report plan">
      ${renderSectionHeading({ eyebrow: 'Compensation', heading: 'Per-person compensation roster', badge: 'Live from Connect' })}
      ${renderKpiCards([
        { label: 'Workers on roster', value: String(totals.workerCount), hint: viewerRole === 'council' ? 'Excludes any worker not shown to council' : undefined },
        { label: 'Current pay entered', value: String(totals.enteredCurrentPayCount), hint: `${totals.unenteredCurrentPayCount} read from a linked budget line or not yet set` },
        { label: 'Entered current pay total', value: formatCents(totals.enteredCurrentPayCents), hint: 'Sum of hand-entered current-pay figures only' },
      ])}
      ${renderTable({ head: ['Name', 'Position', 'Current pay', 'Source'], rows: renderLiveCompensationWorkerRows(workers) })}
      <p>Real, individually-identifiable compensation data -- restricted to the admin, council, and compensation roles. See Council report for the full raise projection, and Benefits &amp; taxes / Benchmarks for the still-synthetic, role-level rest of the compensation picture.</p>
      ${editUnavailableNote}
    </section>${councilEditor}${renderPlanProjection(compensationProjection, { councilDraft: canEditCouncilOverlay, viewerRole })}`;
  }
  // Built only here, for the synthetic fallback: production Finance carries no fixture, so building
  // it earlier made the whole Plan page "unavailable" even when the live roster had loaded.
  const report = buildCompensationReportView(compensationReport);
  const fallbackNote = compensationReportLive
    ? `<p><small>The committed synthetic fixture (the live endpoint is not configured or did not answer: ${escapeHtml(compensationReportLive.fallbackReason || 'unknown')}).</small></p>`
    : '';
  return `<section class="report" aria-label="Synthetic Compensation Report plan">
    ${renderSectionHeading({ eyebrow: 'Compensation', heading: `Role-level plan for fiscal year ${report.fiscalYear}`, badge: 'Synthetic staging' })}
    ${renderKpiCards([
      { label: 'Salary plan', value: formatCents(report.totals.salaryCents) },
      { label: 'Benefits plan', value: formatCents(report.totals.benefitsCents) },
      { label: 'Total compensation', value: formatCents(report.totals.totalCents), hint: 'No personal identities' },
    ])}
    ${renderTable({ head: ['Role', 'Salary', 'Benefits', 'Adjustment'], rows: renderCompensationRows(report.rows) })}
    <p>See Benefits &amp; taxes, Benchmarks, and Council report for the rest of the compensation picture.</p>
    ${fallbackNote}
  </section>`;
}
