function requireIntegerAmounts(values) {
  return values.every(Number.isInteger);
}

export function buildEntityOverview({ church, daycare, property }) {
  if (!Number.isInteger(church?.fiscalYear)
    || !requireIntegerAmounts([
      church?.totals?.incomeActualCents,
      church?.totals?.expenseActualCents,
      church?.totals?.actualNetCents,
    ])
    || church.totals.incomeActualCents - church.totals.expenseActualCents !== church.totals.actualNetCents
    || typeof daycare?.period !== 'string'
    || !/^\d{4}-\d{2}$/.test(daycare.period)
    || !requireIntegerAmounts([
      daycare?.totals?.incomeActualCents,
      daycare?.totals?.expenseActualCents,
      daycare?.totals?.netActualCents,
    ])
    || daycare.totals.incomeActualCents - daycare.totals.expenseActualCents !== daycare.totals.netActualCents
    || typeof property?.periodStart !== 'string'
    || typeof property?.periodEnd !== 'string'
    || !/^\d{4}-\d{2}$/.test(property.periodStart)
    || !/^\d{4}-\d{2}$/.test(property.periodEnd)
    || property.periodStart > property.periodEnd
    || !requireIntegerAmounts([
      property?.totals?.revenueCents,
      property?.totals?.expenseCents,
      property?.totals?.netIncomeCents,
    ])
    || property.totals.revenueCents - property.totals.expenseCents !== property.totals.netIncomeCents) {
    throw new Error('Synthetic entity overview inputs invalid');
  }

  return {
    consolidated: false,
    entities: [
      {
        id: 'church', label: 'Church', periodLabel: `FY${church.fiscalYear}`,
        incomeCents: church.totals.incomeActualCents,
        expenseCents: church.totals.expenseActualCents,
        resultCents: church.totals.actualNetCents,
      },
      {
        id: 'daycare', label: 'Daycare', periodLabel: daycare.period,
        incomeCents: daycare.totals.incomeActualCents,
        expenseCents: daycare.totals.expenseActualCents,
        resultCents: daycare.totals.netActualCents,
      },
      {
        id: 'property', label: 'Commercial Property',
        periodLabel: property.periodStart === property.periodEnd
          ? property.periodEnd : `${property.periodStart}–${property.periodEnd}`,
        incomeCents: property.totals.revenueCents,
        expenseCents: property.totals.expenseCents,
        resultCents: property.totals.netIncomeCents,
      },
    ],
  };
}
