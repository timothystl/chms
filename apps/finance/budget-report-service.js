import { runBudgetedReadBatch } from './query-budget.js';

const CLASSIFICATIONS = new Set(['Income', 'Expenses']);

export async function readSyntheticBudgetReport(db) {
  const sql = "SELECT category, classification, fiscal_year, base_amount_cents, growth_pct, planned_amount_cents, basis, notes FROM finance_budget_plan WHERE basis='synthetic_fixture' ORDER BY classification, category";
  const { results } = await runBudgetedReadBatch(db, 'budgetReport', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length === 0 || rows.some((row) =>
    typeof row.category !== 'string'
    || !CLASSIFICATIONS.has(row.classification)
    || !Number.isInteger(row.fiscal_year)
    || !Number.isInteger(row.base_amount_cents)
    || row.base_amount_cents < 0
    || typeof row.growth_pct !== 'number'
    || !Number.isFinite(row.growth_pct)
    || row.growth_pct < -1
    || row.growth_pct > 10
    || !Number.isInteger(row.planned_amount_cents)
    || row.planned_amount_cents < 0
    || Math.round(row.base_amount_cents * (1 + row.growth_pct)) !== row.planned_amount_cents
    || row.basis !== 'synthetic_fixture'
    || typeof row.notes !== 'string'
  )) throw new Error('Synthetic Budget rows invalid');
  return rows.map((row) => ({ ...row }));
}

export function buildBudgetReportView(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Synthetic Budget rows required');
  const fiscalYear = rows[0].fiscal_year;
  if (rows.some((row) => row.fiscal_year !== fiscalYear)) throw new Error('Synthetic Budget fiscal year mismatch');
  const sum = (classification, field) => rows.filter((row) => row.classification === classification)
    .reduce((total, row) => total + row[field], 0);
  const baseIncomeCents = sum('Income', 'base_amount_cents');
  const baseExpenseCents = sum('Expenses', 'base_amount_cents');
  const plannedIncomeCents = sum('Income', 'planned_amount_cents');
  const plannedExpenseCents = sum('Expenses', 'planned_amount_cents');
  const baseNetCents = baseIncomeCents - baseExpenseCents;
  const plannedNetCents = plannedIncomeCents - plannedExpenseCents;
  return {
    fiscalYear,
    rows: rows.map((row) => ({
      ...row,
      changeCents: row.planned_amount_cents - row.base_amount_cents,
    })),
    totals: {
      baseIncomeCents,
      baseExpenseCents,
      baseNetCents,
      plannedIncomeCents,
      plannedExpenseCents,
      plannedNetCents,
      netChangeCents: plannedNetCents - baseNetCents,
      reconciled: plannedIncomeCents - plannedExpenseCents === plannedNetCents,
    },
  };
}
