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
  const fiscalYear = rows[0].fiscal_year;
  if (rows.some((row) => row.fiscal_year !== fiscalYear)) throw new Error('Synthetic Compensation fiscal year mismatch');
  const salaryCents = rows.reduce((sum, row) => sum + row.salary_cents, 0);
  const benefitsCents = rows.reduce((sum, row) => sum + row.benefits_cents, 0);
  return { fiscalYear, rows, totals: { salaryCents, benefitsCents, totalCents: salaryCents + benefitsCents } };
}
