import { runBudgetedReadBatch } from './query-budget.js';

const INTEGER_FIELDS = [
  'total_revenue_cents', 'total_expenses_cents', 'net_income_cents',
  'net_operating_income_cents', 'available_for_distribution_cents', 'reserve_balance_cents',
];

export async function readSyntheticPropertyReport(db) {
  const sql = "SELECT property_key, period, occupancy_pct, total_revenue_cents, total_expenses_cents, net_income_cents, net_operating_income_cents, available_for_distribution_cents, reserve_balance_cents FROM finance_property_monthly WHERE source_report='synthetic_fixture' ORDER BY period";
  const { results } = await runBudgetedReadBatch(db, 'propertyReport', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length === 0 || rows.some((row) =>
    row.property_key !== 'synthetic-property'
    || typeof row.period !== 'string'
    || !/^\d{4}-\d{2}$/.test(row.period)
    || typeof row.occupancy_pct !== 'number'
    || !Number.isFinite(row.occupancy_pct)
    || INTEGER_FIELDS.some((field) => !Number.isInteger(row[field]))
  )) throw new Error('Synthetic Commercial Property rows invalid');
  return rows.map((row) => ({ ...row }));
}

export async function readSyntheticPropertyReserves(db) {
  const sql = "SELECT reserve_key, report_month, tax_year, target_estimate_cents, reserve_before_cents, contribution_cents, reserve_after_cents, note FROM finance_property_reserves WHERE property_key='synthetic-property' ORDER BY reserve_key, report_month";
  const { results } = await runBudgetedReadBatch(db, 'propertyReserves', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length < 2 || rows.some((row, index) =>
    row.reserve_key !== 'property_tax'
    || typeof row.report_month !== 'string'
    || !/^\d{4}-\d{2}$/.test(row.report_month)
    || !Number.isInteger(row.tax_year)
    || !Number.isInteger(row.target_estimate_cents)
    || !Number.isInteger(row.reserve_before_cents)
    || !Number.isInteger(row.contribution_cents)
    || !Number.isInteger(row.reserve_after_cents)
    || row.reserve_after_cents !== row.reserve_before_cents + row.contribution_cents
    || typeof row.note !== 'string'
    || (index > 0 && row.reserve_before_cents !== rows[index - 1].reserve_after_cents)
  )) throw new Error('Synthetic Commercial Property reserve rows invalid');
  return rows.map((row) => ({
    ...row,
    funded_pct: row.target_estimate_cents > 0 ? row.reserve_after_cents / row.target_estimate_cents * 100 : 0,
  }));
}

export async function readSyntheticPropertyLedgers(db) {
  const statements = [
    "SELECT entry_date, amount_cents, payee, description, project FROM finance_property_capital_ledger WHERE property_key='synthetic-property' ORDER BY entry_date, id",
    "SELECT entry_date, category, description, amount_cents, payee, capitalized FROM finance_property_repairs WHERE property_key='synthetic-property' ORDER BY entry_date, id",
  ];
  const { results } = await runBudgetedReadBatch(db, 'propertyLedgers', statements);
  const capital = results[0]?.results;
  const repairs = results[1]?.results;
  if (!Array.isArray(capital) || capital.length === 0 || capital.some((row) =>
    typeof row.entry_date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(row.entry_date)
    || !Number.isInteger(row.amount_cents)
    || row.amount_cents < 0
    || ['payee', 'description', 'project'].some((field) => typeof row[field] !== 'string')
  )) throw new Error('Synthetic Commercial Property capital rows invalid');
  if (!Array.isArray(repairs) || repairs.length === 0 || repairs.some((row) =>
    typeof row.entry_date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(row.entry_date)
    || !Number.isInteger(row.amount_cents)
    || row.amount_cents < 0
    || ![0, 1].includes(row.capitalized)
    || ['category', 'description', 'payee'].some((field) => typeof row[field] !== 'string')
  )) throw new Error('Synthetic Commercial Property repair rows invalid');
  return {
    capital: capital.map((row) => ({ ...row })),
    repairs: repairs.map((row) => ({ ...row })),
    totals: {
      capital_cents: capital.reduce((sum, row) => sum + row.amount_cents, 0),
      repairs_cents: repairs.reduce((sum, row) => sum + row.amount_cents, 0),
    },
  };
}

export function buildPropertyReportView(rows) {
  const totals = (field) => rows.reduce((sum, row) => sum + row[field], 0);
  return {
    propertyKey: rows[0].property_key,
    periodStart: rows[0].period,
    periodEnd: rows.at(-1).period,
    averageOccupancyPct: rows.reduce((sum, row) => sum + row.occupancy_pct, 0) / rows.length,
    rows,
    totals: {
      revenueCents: totals('total_revenue_cents'),
      expenseCents: totals('total_expenses_cents'),
      netIncomeCents: totals('net_income_cents'),
      distributableCents: totals('available_for_distribution_cents'),
      latestReserveCents: rows.at(-1).reserve_balance_cents,
    },
  };
}
