// Stage 1 data-migration table registry -- the 13 production `finance_*` tables that
// 2026-09-13's schema-compatibility diff and 2026-09-17's Stage 0 reconciliation found to be an
// exact or near-exact schema match against apps/finance's `migrations/0001_finance_foundation.sql`.
// See architecture/evidence/2026-09-13-finance-schema-compatibility-diff.md and
// architecture/evidence/2026-09-17-finance-data-migration-stage0-reconciliation.md (in the private
// digital-architecture repo) for the row counts and comparison this registry is built from.
//
// `finance_settings` is deliberately NOT here. Per both evidence documents, it needs a per-key
// translation pass (see settings-translation.js), not a generic physical copy -- two of its keys
// hold real per-worker compensation data that must never be copied as a raw blob. The two retired
// QuickBooks tables (`finance_qb_connection`, `finance_qb_snapshot`) are excluded by design;
// apps/finance has no equivalent for either.
//
// Every entry names:
//   - `columns`: the full ordered column list, copied exactly as stored -- including `source`, so
//     a table like `finance_church_entries` keeps each row's real provenance value (e.g.
//     'qbo_sync') instead of silently adopting apps/finance's schema-level default ('import').
//     copy-and-verify.js never applies a column default of its own; it only ever writes the value
//     actually present on the source row.
//   - `conflictColumns`: the column(s) copy-and-verify.js's upsert keys off of, so re-running the
//     copy against a destination that already has some or all of these rows updates them in place
//     rather than duplicating them. For tables with an `id INTEGER PRIMARY KEY AUTOINCREMENT`
//     source column, that same id is preserved on write (never regenerated) precisely so the
//     upsert target stays stable across repeated runs.

export const MIGRATABLE_TABLES = Object.freeze([
  {
    name: 'finance_church_entries',
    columns: ['id', 'fiscal_year', 'period_month', 'classification', 'category_path', 'account_name',
      'depth', 'has_children', 'own_actual_cents', 'own_budget_cents', 'account_qbo_id', 'source',
      'notes', 'synced_at', 'created_at'],
    conflictColumns: ['id'],
  },
  {
    name: 'finance_church_balances',
    columns: ['id', 'fiscal_year', 'as_of_date', 'classification', 'category_path', 'account_name',
      'depth', 'has_children', 'own_balance_cents', 'source', 'synced_at', 'created_at'],
    conflictColumns: ['id'],
  },
  {
    name: 'finance_daycare_entries',
    columns: ['id', 'period', 'category', 'entry_type', 'amount_cents', 'notes', 'source', 'created_at'],
    conflictColumns: ['id'],
  },
  {
    name: 'finance_budget_plan',
    columns: ['category', 'classification', 'fiscal_year', 'planned_amount_cents', 'basis',
      'growth_pct', 'base_amount_cents', 'notes', 'updated_at'],
    conflictColumns: ['category', 'fiscal_year'],
  },
  {
    name: 'finance_property_monthly',
    columns: ['property_key', 'period', 'occupancy_pct', 'total_revenue_cents', 'total_expenses_cents',
      'net_income_cents', 'net_operating_income_cents', 'available_for_distribution_cents',
      'reserve_balance_cents', 'source_report', 'updated_at', 'loan_payment_cents', 'interest_expense_cents'],
    conflictColumns: ['property_key', 'period'],
  },
  {
    name: 'finance_property_reserves',
    columns: ['property_key', 'reserve_key', 'report_month', 'tax_year', 'target_estimate_cents',
      'reserve_before_cents', 'contribution_cents', 'reserve_after_cents', 'note'],
    conflictColumns: ['property_key', 'reserve_key', 'report_month'],
  },
  {
    name: 'finance_property_budget_monthly',
    columns: ['property_key', 'period', 'revenue_cents', 'expenses_cents', 'net_income_cents',
      'source', 'updated_at'],
    conflictColumns: ['property_key', 'period'],
  },
  {
    name: 'finance_property_repairs',
    columns: ['id', 'property_key', 'entry_date', 'category', 'description', 'amount_cents',
      'payee', 'capitalized'],
    conflictColumns: ['id'],
  },
  {
    name: 'finance_property_capital_ledger',
    columns: ['id', 'property_key', 'entry_date', 'amount_cents', 'payee', 'description',
      'check_ref', 'project', 'sort_order'],
    conflictColumns: ['id'],
  },
  {
    name: 'finance_property_distributions',
    columns: ['id', 'property_key', 'period', 'amount_cents'],
    conflictColumns: ['id'],
  },
  {
    name: 'finance_import_log',
    columns: ['importer_key', 'last_imported_at', 'note'],
    conflictColumns: ['importer_key'],
  },
  {
    name: 'finance_property_reserve_disbursements',
    columns: ['id', 'property_key', 'reserve_key', 'period_key', 'amount_cents',
      'paid_via_report_month', 'note'],
    conflictColumns: ['id'],
  },
  {
    name: 'finance_daycare_rooms',
    columns: ['id', 'period', 'room_name', 'capacity_per_day', 'avg_daily_enrolled', 'billed_cents',
      'labor_cost_cents', 'waitlist_families', 'seasonal', 'synced_at'],
    conflictColumns: ['id'],
  },
]);

export function getTableConfig(tableName) {
  const table = MIGRATABLE_TABLES.find((t) => t.name === tableName);
  if (!table) {
    throw new Error(`${tableName} is not a Stage 1 migratable table. finance_settings needs settings-translation.js instead; ` +
      `finance_qb_connection/finance_qb_snapshot have no apps/finance equivalent and are excluded by design.`);
  }
  return table;
}
