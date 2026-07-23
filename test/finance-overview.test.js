import { describe, it, expect } from 'vitest';
import { computeIncomeExpenseMonthlyTrend, parsePropertyBudgetDetailGrid, findPropertyBudgetDetailSheet } from '../src/api-finance.js';

describe('computeIncomeExpenseMonthlyTrend', () => {
  it('returns unavailable with no rows', () => {
    expect(computeIncomeExpenseMonthlyTrend([], 6, { classificationTotals: {} })).toEqual({ available: false, months: [] });
  });

  it('splits actual (through throughMonth) vs projected remainder', () => {
    const rows = [
      { period_month: 1, classification: 'Income', own_actual_cents: 10000 },
      { period_month: 1, classification: 'Expenses', own_actual_cents: 4000 },
      { period_month: 2, classification: 'Income', own_actual_cents: 12000 },
      { period_month: 2, classification: 'Expenses', own_actual_cents: 5000 },
    ];
    const summary = { classificationTotals: { Income: { budgetCents: 120000 }, Expenses: { budgetCents: 48000 } } };
    const result = computeIncomeExpenseMonthlyTrend(rows, 2, summary);
    expect(result.available).toBe(true);
    expect(result.months).toHaveLength(12);
    expect(result.months[0]).toEqual({ month: 1, incomeCents: 10000, expenseCents: 4000, projected: false });
    expect(result.months[1]).toEqual({ month: 2, incomeCents: 12000, expenseCents: 5000, projected: false });
    // remaining budget spread evenly over the 10 remaining months
    const remainingIncome = 120000 - 22000; // 98000 / 10 = 9800
    const remainingExpense = 48000 - 9000; // 39000 / 10 = 3900
    expect(result.months[2]).toEqual({ month: 3, incomeCents: remainingIncome / 10, expenseCents: remainingExpense / 10, projected: true });
    expect(result.months[11].projected).toBe(true);
  });

  it('never projects negative when actuals already exceed budget', () => {
    const rows = [{ period_month: 1, classification: 'Expenses', own_actual_cents: 100000 }];
    const summary = { classificationTotals: { Expenses: { budgetCents: 50000 } } };
    const result = computeIncomeExpenseMonthlyTrend(rows, 1, summary);
    expect(result.months[1].expenseCents).toBe(0);
  });
});

describe('parsePropertyBudgetDetailGrid (AHRA Budget Detail export)', () => {
  const grid = [
    ['Budget Detail'],
    ['Account Name', 'Jan 2026', 'Feb 2026', 'Total', 'Percent'],
    ['    RENTAL INCOME'],
    ['        Rent Income', 8278.5, 8278.5, 16557, 84.49],
    ['Total Budgeted Operating Income', 9797.75, 9797.75, 19595.5, 100],
    ['    REPAIRS & MAINTENANCE'],
    ['Total Budgeted Operating Expense', 4627.04, 4617.19, 9244.23, 100],
    ['Net Operating Income', 5170.71, 5180.56, 10351.27, 100],
  ];

  it('finds the sheet by its Account Name / month header row', () => {
    const sheets = [{ name: 'Sheet1', grid }];
    expect(findPropertyBudgetDetailSheet(sheets)).toBe(sheets[0]);
    expect(findPropertyBudgetDetailSheet([{ name: 'Empty', grid: [['foo']] }])).toBeNull();
  });

  it('extracts revenue/expense/net per month from the two rollup rows', () => {
    const { months } = parsePropertyBudgetDetailGrid(grid);
    expect(months).toEqual([
      { period: '2026-01', revenueCents: 979775, expensesCents: 462704, netIncomeCents: 979775 - 462704 },
      { period: '2026-02', revenueCents: 979775, expensesCents: 461719, netIncomeCents: 979775 - 461719 },
    ]);
  });

  it('returns no months when the rollup rows are missing', () => {
    const badGrid = [['Account Name', 'Jan 2026'], ['Rent Income', 100]];
    expect(parsePropertyBudgetDetailGrid(badGrid)).toEqual({ months: [] });
  });
});
