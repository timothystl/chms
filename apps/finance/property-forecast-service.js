import { runBudgetedReadBatch } from './query-budget.js';

export async function readSyntheticPropertyForecast(db) {
  const sql = "SELECT property_key, period, revenue_cents, expenses_cents, net_income_cents, source FROM finance_property_budget_monthly WHERE property_key='synthetic-property' AND source='synthetic_fixture' AND period LIKE '2027-%' ORDER BY period";
  const { results } = await runBudgetedReadBatch(db, 'propertyForecast', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length !== 12 || rows.some((row, index) =>
    row.property_key !== 'synthetic-property'
    || row.period !== `2027-${String(index + 1).padStart(2, '0')}`
    || !Number.isInteger(row.revenue_cents) || row.revenue_cents < 0
    || !Number.isInteger(row.expenses_cents) || row.expenses_cents < 0
    || !Number.isInteger(row.net_income_cents)
    || row.net_income_cents !== row.revenue_cents - row.expenses_cents
    || row.source !== 'synthetic_fixture'
  )) throw new Error('Synthetic Commercial Property forecast rows invalid');
  return rows.map((row) => ({ ...row }));
}

export function buildPropertyForecastView(rows) {
  if (!Array.isArray(rows) || rows.length !== 12) throw new Error('Synthetic Commercial Property forecast incomplete');
  const revenueCents = rows.reduce((sum, row) => sum + row.revenue_cents, 0);
  const expenseCents = rows.reduce((sum, row) => sum + row.expenses_cents, 0);
  const netIncomeCents = rows.reduce((sum, row) => sum + row.net_income_cents, 0);
  if (netIncomeCents !== revenueCents - expenseCents) throw new Error('Synthetic Commercial Property forecast does not reconcile');
  return { fiscalYear: 2027, rows, totals: { revenueCents, expenseCents, netIncomeCents }, reconciled: true };
}
