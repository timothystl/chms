export function buildOperatingBridge(church) {
  const incomeCents = church?.totals?.incomeActualCents;
  const expenseCents = church?.totals?.expenseActualCents;
  const resultCents = church?.totals?.actualNetCents;
  if (!Number.isInteger(church?.fiscalYear)
    || ![incomeCents, expenseCents, resultCents].every(Number.isInteger)
    || incomeCents < 0
    || expenseCents < 0
    || incomeCents - expenseCents !== resultCents) {
    throw new Error('Synthetic operating bridge inputs invalid');
  }
  return {
    fiscalYear: church.fiscalYear,
    incomeCents,
    expenseCents,
    resultCents,
    resultLabel: resultCents >= 0 ? 'Surplus' : 'Deficit',
    resultMagnitudeCents: Math.abs(resultCents),
    reconciled: true,
    interpretation: 'arithmetic_bridge_only',
  };
}
