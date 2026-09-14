import { runBudgetedReadBatch } from './query-budget.js';
import { fetchLiveFinanceDaycareReport, defaultLiveDaycareReportFiscalYear } from './finance-daycare-client.js';

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

// Tries the real connect.finance-daycare-report.v1 endpoint for the current fiscal year; falls back
// to the existing synthetic fixture (rows + allocation) whenever the live call isn't configured yet
// or fails for any reason -- same never-throws, always-labeled pattern as church-report-service.js's
// resolveChurchReport. `db` here is Finance's own FINANCE_DB, used only for the synthetic fallback
// path. Only the 'daycare' section's overview/actuals/budget-comparison/shared-costs pages use this
// -- the 'health' section's own still-synthetic daycareReport usage in shell.js is unchanged and out
// of scope for this contract, the same way Church Report's own live slice left Health/Charts/Packet
// on the synthetic reader.
export async function resolveDaycareReport(env, db) {
  const fiscalYear = defaultLiveDaycareReportFiscalYear();
  const result = await fetchLiveFinanceDaycareReport(env, fiscalYear);
  if (result.ok) {
    return {
      source: 'live',
      fiscalYear: result.report.fiscalYear,
      categories: result.report.categories,
      allocation: result.report.allocation,
      totals: result.report.totals,
    };
  }
  const rows = await readSyntheticDaycareReport(db);
  const allocation = await readSyntheticDaycareAllocation(db);
  return { source: 'synthetic-fallback', fallbackReason: result.reason, rows, allocation };
}

// Live view builder -- the live contract's shape is NOT equivalent to the synthetic fixture's: the
// synthetic rows are one row per (period, category, entry_type), classification derived by a loose
// /tuition/i regex, with Utilities/Insurance allocation lines added on afterward as extra rows; the
// live contract already carries one row per category with both actualCents and budgetCents, a
// closed classification (exact 'Tuition Income' match), and the allocation folded into those same
// two categories server-side. Reusing buildDaycareReportView's rows shape here would silently
// misrender live data, so this is its own builder, matching buildLiveChurchReportView's precedent.
export function buildLiveDaycareReportView(categories, fiscalYear, totals) {
  if (!Number.isInteger(fiscalYear)) throw new Error('Live Daycare Report requires a fiscal year');
  return {
    period: String(fiscalYear),
    categories,
    totals: {
      incomeActualCents: totals.incomeActualCents,
      expenseActualCents: totals.expenseActualCents,
      netActualCents: totals.netActualCents,
      incomeBudgetCents: totals.incomeBudgetCents,
      expenseBudgetCents: totals.expenseBudgetCents,
      netBudgetCents: totals.netBudgetCents,
    },
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
