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

export async function readSyntheticDaycareAllocation(db) {
  const statements = [
    "SELECT key, value FROM finance_settings WHERE key IN ('daycare_utility_pct','daycare_insurance_pct') ORDER BY key",
    "SELECT account_name, own_actual_cents FROM finance_church_entries WHERE source='synthetic_fixture' AND fiscal_year=(SELECT MAX(fiscal_year) FROM finance_church_entries WHERE source='synthetic_fixture') AND (account_name='Synthetic Utilities' OR account_name='Synthetic Insurance') ORDER BY account_name",
  ];
  const { results } = await runBudgetedReadBatch(db, 'daycareAllocation', statements);
  const settings = results[0]?.results;
  const sourceRows = results[1]?.results;
  if (!Array.isArray(settings) || settings.length !== 2 || !Array.isArray(sourceRows) || sourceRows.length !== 2) {
    throw new Error('Synthetic Daycare allocation inputs invalid');
  }
  const pct = Object.fromEntries(settings.map((row) => [row.key, Number(row.value)]));
  const source = Object.fromEntries(sourceRows.map((row) => [row.account_name, row.own_actual_cents]));
  if (![pct.daycare_utility_pct, pct.daycare_insurance_pct].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    || ![source['Synthetic Utilities'], source['Synthetic Insurance']].every(Number.isInteger)) {
    throw new Error('Synthetic Daycare allocation inputs invalid');
  }
  return {
    utility_pct: pct.daycare_utility_pct,
    insurance_pct: pct.daycare_insurance_pct,
    utility_source_cents: source['Synthetic Utilities'],
    insurance_source_cents: source['Synthetic Insurance'],
    utility_allocated_cents: Math.round(source['Synthetic Utilities'] * pct.daycare_utility_pct),
    insurance_allocated_cents: Math.round(source['Synthetic Insurance'] * pct.daycare_insurance_pct),
  };
}

export function buildDaycareReportView(rows, allocation = null) {
  const period = rows[0].period;
  if (rows.some((row) => row.period !== period)) throw new Error('Synthetic Daycare Report period mismatch');
  const categories = rows.map((row) => ({ ...row, classification: /tuition/i.test(row.category) ? 'Income' : 'Expenses' }));
  if (allocation) categories.push(
    { period, category: 'Utilities allocation', entry_type: 'actual', amount_cents: allocation.utility_allocated_cents, classification: 'Expenses' },
    { period, category: 'Insurance allocation', entry_type: 'actual', amount_cents: allocation.insurance_allocated_cents, classification: 'Expenses' },
  );
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
