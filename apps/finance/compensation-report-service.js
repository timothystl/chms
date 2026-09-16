import { runBudgetedReadBatch } from './query-budget.js';
import { fetchLiveFinanceCompensation } from './finance-compensation-client.js';

// Roles allowed to see the LIVE (real, individually-identifiable) compensation roster, matching
// Andrew's explicit decision (2026-09-14) and production's own finance/planning/salary gate
// (financeSegItems in src/api-chms.js maps that segment to the 'compensation' item ALONE, not
// the blanket 'finance' item every other Finance segment gets) -- 'finance' and 'staff' are
// deliberately excluded here even though they may hold broad access to the rest of Finance.
export const COMPENSATION_LIVE_ALLOWED_ROLES = Object.freeze(['admin', 'council', 'compensation']);

export async function readSyntheticCompensationReport(db) {
  const sql = "SELECT fiscal_year, role_label, salary_cents, benefits_cents, adjustment_pct, basis, notes FROM finance_compensation_plan WHERE basis='synthetic_fixture' ORDER BY role_label";
  const { results } = await runBudgetedReadBatch(db, 'compensationReport', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length === 0 || rows.some((row) =>
    !Number.isInteger(row.fiscal_year)
    || typeof row.role_label !== 'string'
    || !row.role_label.startsWith('Synthetic ')
    || !Number.isInteger(row.salary_cents)
    || !Number.isInteger(row.benefits_cents)
    || typeof row.adjustment_pct !== 'number'
    || !Number.isFinite(row.adjustment_pct)
    || row.basis !== 'synthetic_fixture'
    || typeof row.notes !== 'string'
  )) throw new Error('Synthetic Compensation rows invalid');
  return rows.map((row) => ({ ...row }));
}

export function buildCompensationReportView(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.some((row) =>
    !Number.isInteger(row.fiscal_year)
    || typeof row.role_label !== 'string'
    || !row.role_label.startsWith('Synthetic ')
    || !Number.isInteger(row.salary_cents)
    || row.salary_cents < 0
    || !Number.isInteger(row.benefits_cents)
    || row.benefits_cents < 0
    || typeof row.adjustment_pct !== 'number'
    || !Number.isFinite(row.adjustment_pct)
    || row.adjustment_pct < 0
    || row.basis !== 'synthetic_fixture'
  )) throw new Error('Synthetic Compensation report rows invalid');
  const fiscalYear = rows[0].fiscal_year;
  if (rows.some((row) => row.fiscal_year !== fiscalYear)) throw new Error('Synthetic Compensation fiscal year mismatch');
  const salaryCents = rows.reduce((sum, row) => sum + row.salary_cents, 0);
  const benefitsCents = rows.reduce((sum, row) => sum + row.benefits_cents, 0);
  return { fiscalYear, rows, totals: { salaryCents, benefitsCents, totalCents: salaryCents + benefitsCents } };
}

// Tries the real connect.finance-compensation.v1 endpoint and falls back to the existing synthetic
// role-level fixture -- same never-throws, always-labeled pattern as balance-sheet-service.js's
// resolveBalanceSheet and daycare-report-service.js's resolveDaycareReport, with two deliberate
// differences. First, `roleVerified` is not optional plumbing, it is the actual safety gate. Every
// other live contract in this codebase is a church-wide or role-level aggregate with no per-person
// figure, so it is safe to attempt the live fetch unconditionally and let the contract's own
// X-Contract-Key check be the only gate. This contract carries real, individually-identifiable
// compensation data, and the X-Contract-Key check alone proves only that the CALL came from
// Finance's own Worker -- it says nothing about which human is looking at the rendered page. So
// the caller (shell.js) must independently verify, via Connect's own connect.staff-role-v1
// contract (connect-role-client.js's fetchVerifiedRole), that the viewer's role was positively
// confirmed AND is one of COMPENSATION_LIVE_ALLOWED_ROLES, and pass that boolean in here. Any other
// case -- verification not configured, verification failed, or a verified but disallowed role
// (plain finance/staff) -- is treated exactly like the live endpoint being unreachable: straight to
// the synthetic, role-level, no-identities fallback.
//
// Second, this takes the already-fetched `syntheticRows` rather than re-querying
// readSyntheticCompensationReport itself. shell.js already reads that fixture unconditionally for
// the Benchmarks/Benefits/Council sub-pages (which have no live equivalent -- see
// compensation-pages.js), so reusing it here avoids a second, redundant read of the same table on
// every request to this section instead of doubling the section's own query budget.
export async function resolveCompensationReport(env, syntheticRows, roleVerified) {
  if (!roleVerified) {
    return { source: 'synthetic-fallback', fallbackReason: 'role_not_verified_for_individual_data', rows: syntheticRows };
  }
  const result = await fetchLiveFinanceCompensation(env);
  if (result.ok) {
    return {
      source: 'live',
      workers: result.compensation.workers,
      totals: result.compensation.totals,
      generatedAt: result.compensation.generatedAt,
    };
  }
  return { source: 'synthetic-fallback', fallbackReason: result.reason, rows: syntheticRows };
}

export function buildCompensationCouncilSnapshot(report) {
  if (!report || !Number.isInteger(report.fiscalYear) || !Array.isArray(report.rows) || report.rows.length === 0) {
    throw new Error('Synthetic Compensation council report invalid');
  }
  const rebuilt = buildCompensationReportView(report.rows);
  if (!report.totals
    || report.fiscalYear !== rebuilt.fiscalYear
    || report.totals.salaryCents !== rebuilt.totals.salaryCents
    || report.totals.benefitsCents !== rebuilt.totals.benefitsCents
    || report.totals.totalCents !== rebuilt.totals.totalCents
  ) throw new Error('Synthetic Compensation council totals do not reconcile');

  const weightedAdjustmentPct = rebuilt.totals.salaryCents === 0
    ? 0
    : report.rows.reduce((sum, row) => sum + (row.salary_cents * row.adjustment_pct), 0) / rebuilt.totals.salaryCents;
  const benefitsSharePct = rebuilt.totals.totalCents === 0
    ? 0
    : (rebuilt.totals.benefitsCents / rebuilt.totals.totalCents) * 100;

  return {
    fiscalYear: rebuilt.fiscalYear,
    roleCount: report.rows.length,
    totals: { ...rebuilt.totals },
    weightedAdjustmentPct,
    benefitsSharePct,
    identitiesIncluded: false,
    reviewStatus: 'review_only',
    approved: false,
  };
}

// Real, honestly-scoped Council rollup -- for the SAME roles who already see the real per-person
// roster on the Plan page (admin/council/compensation; see COMPENSATION_LIVE_ALLOWED_ROLES above
// and compensation-pages.js's 'plan' branch). Deliberately NOT a live version of
// buildCompensationCouncilSnapshot above: the real contract carries no stored benefits_cents or
// adjustment_pct per worker (those are planning-tool assumptions, never a "compensation record" of
// a person -- see finance-compensation-consumer.js's header comment), so there is no honest
// benefitsSharePct/weightedAdjustmentPct to compute from it, and this never repurposes those field
// names to secretly mean something else. It surfaces only the real, already-stored aggregate facts
// the contract's own `totals` are built from: how many real workers are on the roster and how much
// of their current pay is hand-entered.
//
// hideFromCouncil is enforced HERE, not upstream: the contract producer (buildFinanceCompensationV1
// in src/api-contracts.js) is a service-to-service call with no end-user identity attached, so it
// intentionally does not filter by viewer role. Any Finance code rendering this data to an actual
// 'council' viewer must apply the same "never show a flagged worker to council" rule production's
// own Salary Planner already enforces for that exact role (see api-finance.js's
// finance/planning/salary GET handler and test/council-compensation-role.test.js). admin and the
// dedicated `compensation` role are deliberately NOT filtered here, matching that same precedent.
export function buildLiveCompensationCouncilSnapshot(compensationReportLive, viewerRole) {
  if (!compensationReportLive || compensationReportLive.source !== 'live' || !Array.isArray(compensationReportLive.workers)) {
    throw new Error('Live Compensation council snapshot requires a live compensation report');
  }
  const workers = viewerRole === 'council'
    ? compensationReportLive.workers.filter((w) => !w.hideFromCouncil)
    : compensationReportLive.workers;
  const entered = workers.filter((w) => w.currentPaySource === 'entered');
  if (entered.some((w) => !Number.isInteger(w.currentPayCents))) {
    throw new Error('Live Compensation council snapshot has an invalid entered current pay figure');
  }
  const enteredCurrentPayCents = entered.reduce((sum, w) => sum + w.currentPayCents, 0);
  return {
    source: 'live',
    generatedAt: compensationReportLive.generatedAt,
    workerCount: workers.length,
    enteredCurrentPayCount: entered.length,
    unenteredCurrentPayCount: workers.length - entered.length,
    enteredCurrentPayCents,
    identitiesIncluded: false,
    reviewStatus: 'review_only',
    approved: false,
  };
}
