import { runBudgetedReadBatch } from './query-budget.js';

const CLASSIFICATIONS = new Set(['Income', 'Expenses']);

export async function readSyntheticBudgetReport(db) {
  const sql = "SELECT category, classification, fiscal_year, planned_amount_cents, basis, notes FROM finance_budget_plan WHERE basis='synthetic_fixture' ORDER BY classification, category";
  const { results } = await runBudgetedReadBatch(db, 'budgetReport', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length === 0 || rows.some((row) =>
    typeof row.category !== 'string'
    || !CLASSIFICATIONS.has(row.classification)
    || !Number.isInteger(row.fiscal_year)
    || !Number.isInteger(row.planned_amount_cents)
    || row.basis !== 'synthetic_fixture'
    || typeof row.notes !== 'string'
  )) throw new Error('Synthetic Budget rows invalid');
  return rows.map((row) => ({ ...row }));
}

export function buildBudgetReportView(rows) {
  const fiscalYear = rows[0].fiscal_year;
  if (rows.some((row) => row.fiscal_year !== fiscalYear)) throw new Error('Synthetic Budget fiscal year mismatch');
  const sum = (classification) => rows.filter((row) => row.classification === classification)
    .reduce((total, row) => total + row.planned_amount_cents, 0);
  const incomeCents = sum('Income');
  const expenseCents = sum('Expenses');
  return { fiscalYear, rows, totals: { incomeCents, expenseCents, netCents: incomeCents - expenseCents } };
}
