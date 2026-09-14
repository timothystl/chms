import { buildCompensationCouncilSnapshot, buildCompensationReportView } from './compensation-report-service.js';
import { buildCompensationBenchmarkView } from './compensation-benchmark-service.js';
import { buildCompensationBenefitsView } from './compensation-benefits-service.js';
import { escapeHtml, formatCents, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';

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

export function renderCompensationPage(pageId, { compensationReport, compensationReportLive, compensationBenchmarks, compensationBenefits }) {
  const report = buildCompensationReportView(compensationReport);

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
  // 'plan' (default) -- the one page of this section with a live equivalent (the real, per-person
  // finance-salary-planner roster). Benchmarks/Benefits/Council above are unchanged: they are
  // built around a role-level rollup this real roster does not (and, at 7 real workers, safely
  // cannot) produce -- see finance-compensation-consumer.js's header comment -- so they keep
  // reading the synthetic role-level fixture regardless of whether the plan page below is live.
  if (compensationReportLive && compensationReportLive.source === 'live') {
    const { workers, totals } = compensationReportLive;
    return `<section class="report" aria-label="Compensation Report plan">
      ${renderSectionHeading({ eyebrow: 'Compensation', heading: 'Per-person compensation roster', badge: 'Live from Connect' })}
      ${renderKpiCards([
        { label: 'Workers on roster', value: String(totals.workerCount) },
        { label: 'Current pay entered', value: String(totals.enteredCurrentPayCount), hint: `${totals.unenteredCurrentPayCount} read from a linked budget line or not yet set` },
        { label: 'Entered current pay total', value: formatCents(totals.enteredCurrentPayCents), hint: 'Sum of hand-entered current-pay figures only' },
      ])}
      ${renderTable({ head: ['Name', 'Position', 'Current pay', 'Source'], rows: renderLiveCompensationWorkerRows(workers) })}
      <p>Real, individually-identifiable compensation data -- restricted to the admin, council, and compensation roles. See Benefits &amp; taxes, Benchmarks, and Council snapshot for the still-synthetic, role-level rest of the compensation picture.</p>
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
