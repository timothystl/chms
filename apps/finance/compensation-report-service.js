import { runBudgetedReadBatch } from './query-budget.js';

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
