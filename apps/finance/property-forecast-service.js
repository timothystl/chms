import { runBudgetedReadBatch } from './query-budget.js';
import { fetchLiveFinancePropertyForecast } from './finance-property-forecast-client.js';

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

// Tries the real connect.finance-property-forecast.v1 endpoint for the default property (3277
// Ivanhoe); falls back to the caller's own already-fetched synthetic readSyntheticPropertyForecast
// rows whenever the live call isn't configured yet or fails for any reason -- same never-throws,
// always-labeled pattern as resolvePropertyReport above. Takes the synthetic rows as a parameter
// rather than re-reading them itself, for the same query-budget reason resolvePropertyReport does
// (propertyForecast is already unconditionally fetched for every 'property'-section page load --
// see query-budget.js's own per-request statement-count discipline).
export async function resolvePropertyForecast(env, syntheticRows) {
  const result = await fetchLiveFinancePropertyForecast(env);
  if (result.ok) {
    return {
      source: 'live',
      propertyKey: result.forecast.propertyKey,
      forecastYear: result.forecast.forecastYear,
      periods: result.forecast.periods,
      totals: result.forecast.totals,
    };
  }
  return { source: 'synthetic-fallback', fallbackReason: result.reason, rows: syntheticRows };
}

// Live view builder -- honest about two things the synthetic-only buildPropertyForecastView above
// hard-asserts and the live contract cannot guarantee: that there is exactly one 12-month year on
// file, and that every period reconciles exactly. Real production data (checked 2026-09-16) has
// exactly one complete year today, but a future import could legitimately add a partial year, a
// second year, or a non-reconciling row (see finance-property-forecast-consumer.js's header
// comment) -- this never throws for any of those; a missing forecastYear renders as
// hasForecastYear:false with empty rows, and a non-reconciling total renders through
// totals.reconciled:false rather than being rejected.
export function buildLivePropertyForecastView(periods, forecastYear, totals) {
  const rows = forecastYear === null ? [] : periods.filter((p) => p.period.startsWith(String(forecastYear)));
  return {
    hasForecastYear: forecastYear !== null,
    fiscalYear: forecastYear,
    rows,
    totals,
  };
}
