export function buildSyntheticBoardPacket({ summary, churchReport, churchTrends, giving }) {
  if (!summary?.balanceSheet || !churchReport?.totals || !Array.isArray(churchTrends) || churchTrends.length < 2
    || !giving?.totals || !giving?.reconciliation || giving.reconciliation.totalsMatch !== true
    || !Number.isInteger(churchReport.fiscalYear)
    || !Number.isInteger(churchReport.totals.actualNetCents)
    || !Number.isInteger(churchReport.totals.budgetNetCents)
    || !Number.isInteger(giving.reconciliation.sourceRecordCount)
    || giving.reconciliation.sourceRecordCount < 0) {
    throw new Error('Synthetic board packet inputs invalid');
  }
  const currentTrend = churchTrends.at(-1);
  const priorTrend = churchTrends.at(-2);
  if (currentTrend.fiscal_year !== churchReport.fiscalYear
    || ![currentTrend.net_cents, priorTrend.net_cents].every(Number.isInteger)) {
    throw new Error('Synthetic board packet periods invalid');
  }
  const integerOrNull = (value) => Number.isInteger(value) ? value : null;
  const assetsCents = integerOrNull(summary.balanceSheet.assets_cents);
  const liabilitiesCents = integerOrNull(summary.balanceSheet.liabilities_cents);
  const netAssetsCents = integerOrNull(summary.balanceSheet.equity_cents);
  const givingNetCents = integerOrNull(giving.totals.netCents);
  if ([assetsCents, liabilitiesCents, netAssetsCents, givingNetCents].includes(null)) {
    throw new Error('Synthetic board packet amounts invalid');
  }
  const equationDifferenceCents = assetsCents - liabilitiesCents - netAssetsCents;
  if (equationDifferenceCents !== 0) throw new Error('Synthetic board packet position unreconciled');
  const operatingVarianceCents = churchReport.totals.actualNetCents - churchReport.totals.budgetNetCents;
  return {
    fiscalYear: churchReport.fiscalYear,
    operating: {
      actualNetCents: churchReport.totals.actualNetCents,
      budgetNetCents: churchReport.totals.budgetNetCents,
      varianceCents: operatingVarianceCents,
      disposition: operatingVarianceCents === 0
        ? 'on budget'
        : operatingVarianceCents > 0 ? 'favorable' : 'unfavorable',
    },
    position: { assetsCents, liabilitiesCents, netAssetsCents, equationDifferenceCents },
    giving: {
      netCents: givingNetCents,
      sourceRecordCount: giving.reconciliation.sourceRecordCount,
      reconciled: true,
    },
    trend: {
      priorFiscalYear: priorTrend.fiscal_year,
      currentFiscalYear: currentTrend.fiscal_year,
      priorNetCents: priorTrend.net_cents,
      currentNetCents: currentTrend.net_cents,
      changeCents: currentTrend.net_cents - priorTrend.net_cents,
    },
    ready: true,
  };
}
