import { runBudgetedReadBatch } from './query-budget.js';
import { fetchLiveFinanceChurchReport, defaultLiveChurchReportFiscalYear } from './finance-church-report-client.js';

const CLASSIFICATIONS = new Set(['Income', 'Expenses']);

export async function readSyntheticChurchReport(db) {
  const sql = "SELECT fiscal_year, classification, account_name, own_actual_cents, own_budget_cents FROM finance_church_entries WHERE source='synthetic_fixture' AND fiscal_year=(SELECT MAX(fiscal_year) FROM finance_church_entries WHERE source='synthetic_fixture') ORDER BY classification, account_name";
  const { results } = await runBudgetedReadBatch(db, 'churchReport', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length === 0 || rows.some((row) =>
    !Number.isInteger(row.fiscal_year)
    || !CLASSIFICATIONS.has(row.classification)
    || typeof row.account_name !== 'string'
    || !Number.isInteger(row.own_actual_cents)
    || !Number.isInteger(row.own_budget_cents)
  )) throw new Error('Synthetic Church Report rows invalid');
  return rows.map((row) => ({ ...row }));
}

export async function readSyntheticChurchTrends(db) {
  const sql = "SELECT fiscal_year, SUM(CASE WHEN classification='Income' THEN own_actual_cents ELSE 0 END) AS income_cents, SUM(CASE WHEN classification='Expenses' THEN own_actual_cents ELSE 0 END) AS expense_cents FROM finance_church_entries WHERE source='synthetic_fixture' GROUP BY fiscal_year ORDER BY fiscal_year";
  const { results } = await runBudgetedReadBatch(db, 'churchTrends', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length < 2 || rows.some((row) =>
    !Number.isInteger(row.fiscal_year)
    || !Number.isInteger(row.income_cents)
    || !Number.isInteger(row.expense_cents)
  )) throw new Error('Synthetic Church trend rows invalid');
  return rows.map((row) => ({ ...row, net_cents: row.income_cents - row.expense_cents }));
}

// Tries the real connect.finance-church-report.v1 endpoint for the current fiscal year; falls back
// to the existing synthetic fixture whenever the live call isn't configured yet or fails for any
// reason -- same never-throws, always-labeled pattern as budget-report-service.js's
// resolveBudgetReport. `db` here is Finance's own FINANCE_DB, used only for the synthetic fallback
// path. Only the 'church' section's overview/income-expense/budget-actual pages use this; the
// 'trend' page (multi-year) and the Financial Health/Charts/Packet sections that also read
// churchReport remain on the synthetic reader below -- out of scope for this contract, the same way
// Budget's own live slice left editing and growth scenarios out of scope.
export async function resolveChurchReport(env, db) {
  const fiscalYear = defaultLiveChurchReportFiscalYear();
  const result = await fetchLiveFinanceChurchReport(env, fiscalYear);
  if (result.ok) {
    return {
      source: 'live',
      fiscalYear: result.report.fiscalYear,
      accounts: result.report.accounts,
      totals: result.report.totals,
    };
  }
  const rows = await readSyntheticChurchReport(db);
  return { source: 'synthetic-fallback', fallbackReason: result.reason, rows };
}

// Live view builder -- honest about budgetCents being genuinely nullable per account (real data,
// confirmed 2026-09-14: accounts commonly have an actual with no budget on file even within one
// winning source/year), unlike the synthetic fixture's own readSyntheticChurchReport, which asserts
// every row's budget is a non-null integer. A null budget renders '--' rather than a fabricated $0
// comparison (see church-pages.js's renderLiveChurchRows).
export function buildLiveChurchReportView(accounts, fiscalYear, totals) {
  if (!Number.isInteger(fiscalYear)) throw new Error('Live Church Report requires a fiscal year');
  const income = accounts.filter((a) => a.classification === 'Income');
  const expenses = accounts.filter((a) => a.classification === 'Expenses');
  return {
    fiscalYear,
    income,
    expenses,
    totals: {
      incomeActualCents: totals.incomeActualCents,
      expenseActualCents: totals.expenseActualCents,
      actualNetCents: totals.netIncomeActualCents,
      budgetNetCents: totals.netIncomeBudgetCents,
    },
    hasBudgetData: totals.hasBudgetData,
  };
}

export function buildChurchReportView(rows) {
  const income = rows.filter((row) => row.classification === 'Income');
  const expenses = rows.filter((row) => row.classification === 'Expenses');
  const sum = (items, key) => items.reduce((total, row) => total + row[key], 0);
  const incomeActualCents = sum(income, 'own_actual_cents');
  const expenseActualCents = sum(expenses, 'own_actual_cents');
  const incomeBudgetCents = sum(income, 'own_budget_cents');
  const expenseBudgetCents = sum(expenses, 'own_budget_cents');
  return {
    fiscalYear: rows[0]?.fiscal_year || null,
    income,
    expenses,
    totals: {
      incomeActualCents,
      expenseActualCents,
      actualNetCents: incomeActualCents - expenseActualCents,
      budgetNetCents: incomeBudgetCents - expenseBudgetCents,
    },
  };
}
