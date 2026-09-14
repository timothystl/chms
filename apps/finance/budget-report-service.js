import { runBudgetedReadBatch } from './query-budget.js';
import { fetchLiveFinanceBudget, defaultLiveBudgetFiscalYear } from './finance-budget-client.js';

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

// Tries the real connect.finance-budget.v1 endpoint for next fiscal year; falls back to the
// existing synthetic fixture whenever the live call isn't configured yet or fails for any reason
// -- same never-throws, always-labeled pattern as accounts-report-service.js's
// resolveAccountsReport. `db` here is Finance's own FINANCE_DB, used only for the synthetic
// fallback path.
//
// Unlike resolveAccountsReport, this does NOT remap the live payload onto the synthetic reader's
// row shape: the two are not actually equivalent. Production's real finance_budget_plan rows
// (checked 2026-09-14) are all basis='manual' with growthPct/baseAmountCents null, while the
// synthetic fixture is basis='synthetic_fixture' with every row grown from a base and a growth
// rate -- forcing live data through buildBudgetReportView's base/growth arithmetic would either
// throw on the nulls or silently render a fabricated "0% growth from a $0 base" for every manually
// entered category. The live path gets its own view builder and render function below/in
// planning-pages.js instead of pretending the shapes match.
export async function resolveBudgetReport(env, db) {
  const fiscalYear = defaultLiveBudgetFiscalYear();
  const result = await fetchLiveFinanceBudget(env, fiscalYear);
  if (result.ok) {
    return { source: 'live', fiscalYear: result.budget.fiscalYear, categories: result.budget.categories };
  }
  const rows = await readSyntheticBudgetReport(db);
  return { source: 'synthetic-fallback', fallbackReason: result.reason, rows };
}

// Live view builder -- honest about which categories actually carry a base/growth assumption
// (today, in real data: none) rather than assuming every row was generated from one. A category
// with basis 'grown' shows its real base/growth/change; a 'manual' category shows '--' for those
// cells rather than a fabricated 0%/$0 comparison (see planning-pages.js's renderLiveBudgetRows).
export function buildLiveBudgetReportView(categories, fiscalYear) {
  if (!Number.isInteger(fiscalYear)) throw new Error('Live Budget report requires a fiscal year');
  const sum = (classification) => categories
    .filter((c) => c.classification === classification)
    .reduce((total, c) => total + c.plannedAmountCents, 0);
  const plannedIncomeCents = sum('Income');
  const plannedExpenseCents = sum('Expenses');
  const grownCount = categories.filter((c) => c.basis === 'grown').length;
  return {
    fiscalYear,
    rows: categories.map((c) => ({
      ...c,
      hasBasis: c.basis === 'grown' && c.baseAmountCents !== null && c.growthPct !== null,
      changeCents: (c.basis === 'grown' && c.baseAmountCents !== null) ? c.plannedAmountCents - c.baseAmountCents : null,
    })),
    totals: {
      plannedIncomeCents,
      plannedExpenseCents,
      plannedNetCents: plannedIncomeCents - plannedExpenseCents,
    },
    counts: {
      categoryCount: categories.length,
      grownCount,
      manualCount: categories.length - grownCount,
    },
  };
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
