import { runBudgetedReadBatch } from './query-budget.js';

export async function readSyntheticPropertyDistributions(db) {
  const sql = "SELECT period, amount_cents FROM finance_property_distributions WHERE property_key='synthetic-property' ORDER BY period";
  const { results } = await runBudgetedReadBatch(db, 'propertyDistributions', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length === 0 || rows.some((row) =>
    typeof row.period !== 'string'
    || !/^\d{4}-\d{2}$/.test(row.period)
    || !Number.isInteger(row.amount_cents)
  )) throw new Error('Synthetic Commercial Property distribution rows invalid');
  return rows.map((row) => ({ ...row }));
}

export function buildPropertyDistributionsView(rows) {
  const totalCents = rows.reduce((sum, row) => sum + row.amount_cents, 0);
  return {
    rows,
    totals: {
      distributionCents: totalCents,
      distributionCount: rows.length,
      averageCents: rows.length > 0 ? Math.round(totalCents / rows.length) : 0,
    },
  };
}
