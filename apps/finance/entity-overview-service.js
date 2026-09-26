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
    || !/^\d{4}(?:-\d{2})?$/.test(daycare.period)
    || !requireIntegerAmounts([
      daycare?.totals?.incomeActualCents,
      daycare?.totals?.expenseActualCents,
      daycare?.totals?.netActualCents,
    ])
    || daycare.totals.incomeActualCents - daycare.totals.expenseActualCents !== daycare.totals.netActualCents
    || typeof property?.periodStart !== 'string'
    || typeof property?.periodEnd !== 'string'
    || !/^\d{4}(?:-\d{2})?$/.test(property.periodStart)
    || !/^\d{4}(?:-\d{2})?$/.test(property.periodEnd)
    || property.periodStart > property.periodEnd
    || !requireIntegerAmounts([
      property?.totals?.revenueCents,
      property?.totals?.expenseCents,
      property?.totals?.netIncomeCents,
    ])
    || property.totals.revenueCents - property.totals.expenseCents !== property.totals.netIncomeCents) {
    throw new Error('Entity overview inputs invalid');
  }

  return {
    consolidated: false,
    entities: [
      {
        id: 'church', label: 'Church', periodLabel: `FY${church.fiscalYear}`,
        incomeCents: church.totals.incomeActualCents,
        expenseCents: church.totals.expenseActualCents,
        resultCents: church.totals.actualNetCents, source: church.source || 'synthetic-fallback',
      },
      {
        id: 'daycare', label: 'Daycare', periodLabel: daycare.period,
        incomeCents: daycare.totals.incomeActualCents,
        expenseCents: daycare.totals.expenseActualCents,
        resultCents: daycare.totals.netActualCents, source: daycare.source || 'synthetic-fallback',
      },
      {
        id: 'property', label: 'Commercial Property',
        periodLabel: property.periodStart === property.periodEnd
          ? property.periodEnd : `${property.periodStart}–${property.periodEnd}`,
        incomeCents: property.totals.revenueCents,
        expenseCents: property.totals.expenseCents,
        resultCents: property.totals.netIncomeCents, source: property.source || 'synthetic-fallback',
      },
    ],
  };
}

// Connect's legacy Financial Health periods and formulas (connect.finance-health.v1): the church
// for this fiscal year from the church ledger (Income and Expenses classifications, with the
// year's full net income as the result), and the daycare for the current calendar year from its
// counted ledger rows plus the MDO share of utilities and insurance. Commercial Property keeps
// its own latest-year annual summary, the same "Annual Net" Connect's property figures state.
// A daycare year with nothing imported is reported as such, never as a $0 result.
export function buildHealthEntityOverview(health, property) {
  const church = {
    id: 'church', label: 'Church', periodLabel: `FY${health.fiscalYear}`, available: true,
    incomeCents: health.church.incomeActualCents,
    expenseCents: health.church.expenseActualCents,
    resultCents: health.church.netActualCents, source: 'live',
  };
  const dc = health.daycare;
  const daycare = dc && dc.available
    ? {
      id: 'daycare', label: 'Daycare', periodLabel: String(dc.year), available: true,
      incomeCents: dc.incomeActualCents, expenseCents: dc.expenseActualCents,
      resultCents: dc.netActualCents, source: 'live',
    }
    : {
      id: 'daycare', label: 'Daycare', periodLabel: dc ? String(dc.year) : 'This year', available: false, source: 'live',
      unavailableNote: dc ? `No ${dc.year} daycare figures imported yet.` : 'The daycare figures could not be read for this request — not a zero.',
    };
  const entities = [church, daycare];
  if (property) {
    entities.push({
      id: 'property', label: 'Commercial Property', available: true,
      periodLabel: property.periodStart === property.periodEnd ? property.periodEnd : `${property.periodStart}–${property.periodEnd}`,
      incomeCents: property.totals.revenueCents,
      expenseCents: property.totals.expenseCents,
      resultCents: property.totals.netIncomeCents, source: property.source || 'synthetic-fallback',
    });
  } else {
    entities.push({
      id: 'property', label: 'Commercial Property', periodLabel: 'Latest year', available: false, source: 'live',
      unavailableNote: 'The Commercial Property figures could not be read for this request — not a zero.',
    });
  }
  return { consolidated: false, fromHealthContract: true, entities };
}
