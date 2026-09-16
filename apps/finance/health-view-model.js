// Hoisted so shell.js can render the same, purely-static decision framing even when `summary` (and
// so the rest of this view) could not be read for this request (see synthetic-read-guard.js) --
// these three rows describe fixed board-authority boundaries, not fetched data, so there is nothing
// dishonest about still showing them while every data-backed card on the same page says "unavailable".
export const FINANCE_HEALTH_DECISIONS = Object.freeze([
  { stream: 'Donor income', authority: 'Full control', action: 'Set the ask and stewardship plan' },
  { stream: 'Earned income', authority: 'Reported, not managed', action: 'Review operating performance' },
  { stream: 'Passive income', authority: 'Timing decision', action: 'Decide distribution timing' },
]);

export function buildFinancialHealthView(summary, giving) {
  const incomeActualCents = Number(summary.church.income_actual_cents || 0);
  const expenseActualCents = Number(summary.church.expense_actual_cents || 0);
  const incomeBudgetCents = Number(summary.church.income_budget_cents || 0);
  const expenseBudgetCents = Number(summary.church.expense_budget_cents || 0);
  const actualNetCents = incomeActualCents - expenseActualCents;
  const budgetNetCents = incomeBudgetCents - expenseBudgetCents;

  return {
    operating: {
      incomeActualCents,
      expenseActualCents,
      actualNetCents,
      budgetNetCents,
      varianceCents: actualNetCents - budgetNetCents,
    },
    position: {
      assetsCents: Number(summary.balanceSheet.assets_cents || 0),
      liabilitiesCents: Number(summary.balanceSheet.liabilities_cents || 0),
      netAssetsCents: Number(summary.balanceSheet.equity_cents || 0),
    },
    giving: {
      grossCents: Number(giving.totals.grossCents || 0),
      refundCents: Number(giving.totals.refundCents || 0),
      netCents: Number(giving.totals.netCents || 0),
      sourceRecordCount: Number(giving.reconciliation.sourceRecordCount || 0),
      reconciled: giving.reconciliation.totalsMatch === true,
    },
    decisions: FINANCE_HEALTH_DECISIONS,
  };
}
