import { runBudgetedReadBatch } from './query-budget.js';

export async function readSyntheticDaycareReport(db) {
  const sql = "SELECT period, category, entry_type, amount_cents FROM finance_daycare_entries WHERE source='synthetic_fixture' ORDER BY period, category, entry_type";
  const { results } = await runBudgetedReadBatch(db, 'daycareReport', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length === 0 || rows.some((row) =>
    typeof row.period !== 'string'
    || !/^\d{4}(-\d{2})?$/.test(row.period)
    || typeof row.category !== 'string'
    || !['actual', 'budget'].includes(row.entry_type)
    || !Number.isInteger(row.amount_cents)
  )) throw new Error('Synthetic Daycare Report rows invalid');
  return rows.map((row) => ({ ...row }));
}

export function buildDaycareReportView(rows) {
  const period = rows[0].period;
  if (rows.some((row) => row.period !== period)) throw new Error('Synthetic Daycare Report period mismatch');
  const categories = rows.map((row) => ({ ...row, classification: /tuition/i.test(row.category) ? 'Income' : 'Expenses' }));
  const sum = (classification, entryType) => categories
    .filter((row) => row.classification === classification && row.entry_type === entryType)
    .reduce((total, row) => total + row.amount_cents, 0);
  const incomeActualCents = sum('Income', 'actual');
  const expenseActualCents = sum('Expenses', 'actual');
  const incomeBudgetCents = sum('Income', 'budget');
  const expenseBudgetCents = sum('Expenses', 'budget');
  return {
    period,
    categories,
    totals: {
      incomeActualCents,
      expenseActualCents,
      netActualCents: incomeActualCents - expenseActualCents,
      incomeBudgetCents,
      expenseBudgetCents,
      netBudgetCents: incomeBudgetCents - expenseBudgetCents,
    },
  };
}
