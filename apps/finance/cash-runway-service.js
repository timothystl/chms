import { runBudgetedReadBatch } from './query-budget.js';

export async function readSyntheticCashRunway(db) {
  const statements = [
    "SELECT fiscal_year, as_of_date, account_name, own_balance_cents AS operating_cash_cents FROM finance_church_balances WHERE source='synthetic_fixture' AND classification='Assets' AND account_name='Synthetic Cash' AND fiscal_year=(SELECT MAX(fiscal_year) FROM finance_church_balances WHERE source='synthetic_fixture')",
    "SELECT fiscal_year, COALESCE(SUM(own_actual_cents),0) AS annual_expense_cents FROM finance_church_entries WHERE source='synthetic_fixture' AND classification='Expenses' AND fiscal_year=(SELECT MAX(fiscal_year) FROM finance_church_entries WHERE source='synthetic_fixture') GROUP BY fiscal_year",
  ];
  const { results } = await runBudgetedReadBatch(db, 'cashRunway', statements);
  const cash = results[0]?.results;
  const expenses = results[1]?.results;
  if (!Array.isArray(cash) || cash.length !== 1 || !Array.isArray(expenses) || expenses.length !== 1) {
    throw new Error('Synthetic cash runway inputs invalid');
  }
  const cashRow = cash[0];
  const expenseRow = expenses[0];
  if (!Number.isInteger(cashRow.fiscal_year)
    || cashRow.fiscal_year !== expenseRow.fiscal_year
    || typeof cashRow.as_of_date !== 'string'
    || typeof cashRow.account_name !== 'string'
    || !Number.isInteger(cashRow.operating_cash_cents)
    || cashRow.operating_cash_cents < 0
    || !Number.isInteger(expenseRow.annual_expense_cents)
    || expenseRow.annual_expense_cents <= 0) {
    throw new Error('Synthetic cash runway inputs invalid');
  }
  return { ...cashRow, annual_expense_cents: expenseRow.annual_expense_cents };
}

export function buildCashRunwayView(input) {
  const monthlyExpenseCents = input.annual_expense_cents / 12;
  const runwayMonths = input.operating_cash_cents / monthlyExpenseCents;
  if (!Number.isFinite(monthlyExpenseCents) || !Number.isFinite(runwayMonths)) {
    throw new Error('Synthetic cash runway calculation invalid');
  }
  return {
    fiscalYear: input.fiscal_year,
    asOfDate: input.as_of_date,
    accountName: input.account_name,
    operatingCashCents: input.operating_cash_cents,
    annualExpenseCents: input.annual_expense_cents,
    monthlyExpenseCents,
    runwayMonths,
  };
}
