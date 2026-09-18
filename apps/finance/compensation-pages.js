import { buildCompensationCouncilSnapshot, buildCompensationReportView, buildLiveCompensationCouncilSnapshot, filterCompensationWorkersForViewer, summarizeCompensationWorkers } from './compensation-report-service.js';
import { buildCompensationBenchmarkView } from './compensation-benchmark-service.js';
import { buildCompensationBenefitsView } from './compensation-benefits-service.js';
import { escapeHtml, formatCents, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';
import { renderCompensationPlanEditor } from './compensation-editor-pages.js';

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

export function renderCompensationPage(pageId, {
  compensationReport, compensationReportLive, compensationBenchmarks, compensationBenefits, viewerRole,
  compensationPlanRaw, canEditCompensation, editIndex, entryStatus, entryMessage,
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
    return renderCompensationPlanEditor(compensationPlanRaw.data, editIndex, entryStatus, entryMessage);
  }
  const editUnavailableNote = (pageId === 'plan' && canEditCompensation && compensationPlanRaw && !compensationPlanRaw.ok)
    ? `<p class="status status-pending">Editing is unavailable right now: ${escapeHtml(compensationPlanRaw.message || compensationPlanRaw.reason || 'unknown error')}.</p>`
    : '';
  const report = buildCompensationReportView(compensationReport);

  // Benchmarks and Benefits stay synthetic for every role, unconditionally -- unlike Plan and
  // Council below, no honest live version of either exists to switch to. Benchmarks needs a real
  // external district/market salary reference; the only "benchmark" concept anywhere in this
  // codebase is finCompWorksheetCents (src/frontend/js-finance.js), a live computation off LCMS
  // pay-scale multiplier tables, per WORKER, not a stored per-role figure, and porting that whole
  // table-driven calculation server-side is separate, larger work this contract's own producer
  // comment (src/api-contracts.js) already declines to duplicate. There is no other real benchmark
  // source anywhere in Connect (checked finance_compensation_benchmarks and its one fixture-only
  // migration/fixture pair -- every row is source_kind='synthetic_fixture'). Benefits needs a real
  // per-role Pension/Group health/Disability/Employer-taxes DOLLAR breakdown; those figures
  // (pensionCents/healthCents/disabilityCents in js-finance.js) are likewise computed client-side
  // from formulas and rate/health-tier tables for the currently-viewed target year, never stored --
  // there is nothing in finance_settings or the real contract to read them from. Fabricating either
  // from real salary data (e.g. "120% of current pay" or a guessed split of benefits_cents) would
  // be exactly the kind of invented number this codebase's every other contract avoids, so both
  // pages keep reading the same synthetic role-level fixture regardless of viewer role.
  if (pageId === 'benchmarks') {
    const benchmark = buildCompensationBenchmarkView(report, compensationBenchmarks);
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
    const benefits = buildCompensationBenefitsView(report, compensationBenefits);
    return `<section class="report" aria-label="Synthetic Compensation Report benefits and taxes">
      ${renderSectionHeading({ eyebrow: 'Benefits &amp; taxes', heading: 'What the benefits plan contains', badge: `${benefits.reconciled ? 'Reconciled' : 'Review required'} · role-only` })}
      ${renderTable({ head: ['Component', 'Amount', 'Share of benefits', 'Roles covered'], rows: renderCompensationBenefitRows(benefits.rows, benefits.totalCents) })}
      <p>The component total is ${formatCents(benefits.totalCents)} and must exactly match the benefits plan. No personal identities are included.</p>
    </section>`;
  }
  if (pageId === 'council') {
    // Unlike Benchmarks/Benefits above, a real council rollup IS possible for the roles who
    // already see this same roster, per person, on the Plan page -- see
    // buildLiveCompensationCouncilSnapshot's own header comment in compensation-report-service.js
    // for exactly which real fields it uses and which synthetic-only fields (benefitsSharePct,
    // weightedAdjustmentPct) it deliberately does not try to reconstruct.
    if (compensationReportLive && compensationReportLive.source === 'live') {
      const council = buildLiveCompensationCouncilSnapshot(compensationReportLive, viewerRole);
      return `<section class="report" aria-label="Compensation Report council snapshot">
        ${renderSectionHeading({ eyebrow: 'Council review snapshot', heading: 'Real roster decision context', badge: 'Live from Connect · review-only · not approved' })}
        ${renderKpiCards([
          { label: 'Workers on roster', value: String(council.workerCount), hint: viewerRole === 'council' ? 'Excludes any worker not shown to council' : 'Real per-person roster, aggregated' },
          { label: 'Current pay entered', value: String(council.enteredCurrentPayCount), hint: `${council.unenteredCurrentPayCount} read from a linked budget line or not yet set` },
          { label: 'Entered current pay total', value: formatCents(council.enteredCurrentPayCents), hint: 'Sum of hand-entered current-pay figures only' },
        ])}
        <p>Real, aggregate roster facts only -- restricted to the admin, council, and compensation roles who already see this same data, per person, on the Plan page. No benefits-share or weighted-adjustment figure is shown here: those are planning assumptions Connect does not store per worker, so this page never estimates or reconstructs them.</p>
      </section>`;
    }
    const council = buildCompensationCouncilSnapshot(report);
    return `<section class="report" aria-label="Synthetic Compensation Report council snapshot">
      ${renderSectionHeading({ eyebrow: 'Council review snapshot', heading: 'Plan-level decision context', badge: 'Role-only · review-only · not approved' })}
      ${renderKpiCards([
        { label: 'Roles represented', value: String(council.roleCount), hint: 'No personal identities' },
        { label: 'Benefits share', value: `${council.benefitsSharePct.toFixed(1)}%`, hint: 'Of total planned compensation' },
        { label: 'Weighted adjustment', value: `${council.weightedAdjustmentPct.toFixed(1)}%`, hint: 'Salary-weighted planning assumption' },
      ])}
    </section>`;
  }
  // 'plan' (default) -- the first page of this section with a live equivalent (the real,
  // per-person finance-salary-planner roster). Benchmarks and Benefits above are unchanged and
  // stay synthetic for every role: they are built around a role-level rollup this real roster does
  // not (and, at 7 real workers, safely cannot) produce, and no honest real substitute exists for
  // either (see the comment above the 'benchmarks'/'benefits' branches). Council above now has its
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
      <p>Real, individually-identifiable compensation data -- restricted to the admin, council, and compensation roles. See Council snapshot for a real aggregate view, and Benefits &amp; taxes / Benchmarks for the still-synthetic, role-level rest of the compensation picture.</p>
      ${editUnavailableNote}
    </section>`;
  }
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
    <p>See Benefits &amp; taxes, Benchmarks, and Council snapshot for the rest of the compensation picture.</p>
    ${fallbackNote}
  </section>`;
}
