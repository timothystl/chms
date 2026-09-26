// connect.finance-health.v1 — everything Connect's legacy Financial Health tab shows, as finished
// aggregate figures (see src/api-finance-health-contract.js). Fund names, account-group labels and
// household COUNTS only: no donor, person, or household is ever named, so council may read it.
const CONTRACT = 'connect.finance-health.v1';
const ROOT_KEYS = [
  'contract', 'dataClassification', 'sourceProduct', 'consumerProduct', 'currency', 'fiscalYear',
  'generatedAt', 'hasLedger', 'revenueStreams', 'giving', 'designatedFunds', 'flowDiagram', 'church',
  'daycare', 'property', 'waitingFamilies', 'givingPace', 'cash', 'fiveYearMix', 'overPace', 'targets',
  'appeal', 'levers',
];
const STREAMS = ['donor', 'earned', 'passive', 'restricted'];
const DISPLAY_STREAMS = new Set(['donor', 'earned', 'passive']);
const CASH_SOURCES = new Set(['manual', 'balance_sheet', 'quickbooks', 'none']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

const isInt = (v) => Number.isInteger(v);
const isNonNegInt = (v) => Number.isInteger(v) && v >= 0;
const isNullableInt = (v) => v === null || Number.isInteger(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isText = (v) => typeof v === 'string';

function isDateTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function checkList(errors, value, name, keys, check) {
  if (!Array.isArray(value)) { errors.push(`${name} must be an array`); return; }
  value.forEach((item, index) => {
    if (!hasExactKeys(item, keys)) errors.push(`${name}[${index}] must contain exactly ${keys.join(', ')}`);
    else check(item, `${name}[${index}]`);
  });
}

function checkLadder(errors, value, name) {
  if (!hasExactKeys(value, ['targetCents', 'tiers', 'totalCents', 'totalHouseholds'])) { errors.push(`${name} must be an appeal ladder`); return; }
  if (!isNonNegInt(value.targetCents) || !isNonNegInt(value.totalCents) || !isNonNegInt(value.totalHouseholds)) errors.push(`${name} totals must be nonnegative integers`);
  checkList(errors, value.tiers, `${name}.tiers`, ['askCents', 'households', 'raisesCents'], (t, at) => {
    if (!isNonNegInt(t.askCents) || !isNonNegInt(t.households) || t.raisesCents !== t.askCents * t.households) errors.push(`${at} must be a whole-household ask row`);
  });
  if (Array.isArray(value.tiers) && value.tiers.every(isRecord)) {
    if (value.tiers.reduce((s, t) => s + t.raisesCents, 0) !== value.totalCents) errors.push(`${name}.totalCents must equal its rows`);
    if (value.tiers.reduce((s, t) => s + t.households, 0) !== value.totalHouseholds) errors.push(`${name}.totalHouseholds must equal its rows`);
    if (value.totalCents < value.targetCents) errors.push(`${name} must cover its target`);
  }
}

export function validateFinanceHealthV1(value) {
  const errors = [];
  if (!hasExactKeys(value, ROOT_KEYS)) return { ok: false, errors: ['root must contain exactly the financial-health fields'] };
  if (value.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
  if (value.dataClassification !== 'aggregate') errors.push('dataClassification must be aggregate');
  if (value.sourceProduct !== 'connect') errors.push('sourceProduct must be connect');
  if (value.consumerProduct !== 'finance') errors.push('consumerProduct must be finance');
  if (value.currency !== 'USD') errors.push('currency must be USD');
  if (!isInt(value.fiscalYear) || value.fiscalYear < 2000 || value.fiscalYear > 2100) errors.push('fiscalYear must be a 4-digit integer year');
  if (!isDateTime(value.generatedAt)) errors.push('generatedAt must be an RFC 3339 UTC timestamp');
  if (typeof value.hasLedger !== 'boolean') errors.push('hasLedger must be boolean');

  const rs = value.revenueStreams;
  if (!hasExactKeys(rs, ['totalCents', 'streams', 'unmapped']) || !hasExactKeys(rs.streams, STREAMS)) {
    errors.push('revenueStreams must carry totalCents, the four streams, and unmapped');
  } else {
    if (!isInt(rs.totalCents)) errors.push('revenueStreams.totalCents must be integer cents');
    let sum = 0;
    for (const key of STREAMS) {
      const s = rs.streams[key];
      if (!hasExactKeys(s, ['cents', 'budgetCents', 'groups']) || !isInt(s.cents) || !isInt(s.budgetCents)) { errors.push(`revenueStreams.streams.${key} is malformed`); continue; }
      sum += s.cents;
      checkList(errors, s.groups, `revenueStreams.streams.${key}.groups`, ['label', 'cents', 'budgetCents'], (g, at) => {
        if (!isText(g.label) || !isInt(g.cents) || !isInt(g.budgetCents)) errors.push(`${at} is malformed`);
      });
    }
    if (isInt(rs.totalCents) && sum !== rs.totalCents) errors.push('revenueStreams.totalCents must equal the four streams');
    checkList(errors, rs.unmapped, 'revenueStreams.unmapped', ['label', 'cents', 'defaultedTo'], (u, at) => {
      if (!isText(u.label) || !isInt(u.cents) || !STREAMS.includes(u.defaultedTo)) errors.push(`${at} is malformed`);
    });
  }

  const giving = value.giving;
  if (!hasExactKeys(giving, ['givingCents', 'givingHouseholds', 'donorBands'])) errors.push('giving must carry givingCents, givingHouseholds, donorBands');
  else {
    if (!isInt(giving.givingCents) || !isNonNegInt(giving.givingHouseholds)) errors.push('giving totals are malformed');
    checkList(errors, giving.donorBands, 'giving.donorBands', ['label', 'households'], (b, at) => {
      if (!isText(b.label) || !isNonNegInt(b.households)) errors.push(`${at} is malformed`);
    });
  }

  const df = value.designatedFunds;
  if (!hasExactKeys(df, ['funds', 'designatedGivenCents', 'operatingGivenCents', 'balanceCents', 'asOfDate'])) errors.push('designatedFunds is malformed');
  else {
    if (!isInt(df.designatedGivenCents) || !isInt(df.operatingGivenCents) || !isNullableInt(df.balanceCents) || !isText(df.asOfDate)) errors.push('designatedFunds totals are malformed');
    checkList(errors, df.funds, 'designatedFunds.funds', ['code', 'label', 'givenCents', 'balanceCents'], (f, at) => {
      if (!isText(f.code) || !isText(f.label) || !isInt(f.givenCents) || !isNullableInt(f.balanceCents)) errors.push(`${at} is malformed`);
    });
    if (isInt(giving?.givingCents) && isInt(df.designatedGivenCents) && isInt(df.operatingGivenCents)
      && df.designatedGivenCents + df.operatingGivenCents !== giving.givingCents) errors.push('designated plus operating giving must equal recorded giving');
  }

  const flow = value.flowDiagram;
  if (!hasExactKeys(flow, ['sources', 'streams', 'expenses', 'totalRevenueCents', 'totalExpenseCents', 'netCents'])) errors.push('flowDiagram is malformed');
  else {
    checkList(errors, flow.sources, 'flowDiagram.sources', ['id', 'label', 'stream', 'cents'], (s, at) => {
      if (!isText(s.id) || !isText(s.label) || !DISPLAY_STREAMS.has(s.stream) || !isNonNegInt(s.cents)) errors.push(`${at} is malformed`);
    });
    checkList(errors, flow.streams, 'flowDiagram.streams', ['id', 'cents'], (s, at) => {
      if (!DISPLAY_STREAMS.has(s.id) || !isNonNegInt(s.cents)) errors.push(`${at} is malformed`);
    });
    checkList(errors, flow.expenses, 'flowDiagram.expenses', ['id', 'label', 'note', 'cents'], (e, at) => {
      if (!isText(e.id) || !isText(e.label) || !isText(e.note) || !isInt(e.cents)) errors.push(`${at} is malformed`);
    });
    if (!isInt(flow.totalRevenueCents) || !isInt(flow.totalExpenseCents) || flow.netCents !== flow.totalRevenueCents - flow.totalExpenseCents) errors.push('flowDiagram totals must reconcile');
    if (Array.isArray(flow.sources) && flow.sources.every(isRecord) && flow.sources.reduce((s, x) => s + x.cents, 0) !== flow.totalRevenueCents) errors.push('flowDiagram sources must sum to total revenue');
  }

  const church = value.church;
  const CHURCH_KEYS = ['incomeActualCents', 'incomeBudgetCents', 'expenseActualCents', 'expenseBudgetCents', 'netActualCents', 'netBudgetCents', 'projection'];
  if (!hasExactKeys(church, CHURCH_KEYS)) errors.push('church is malformed');
  else {
    if (!CHURCH_KEYS.slice(0, 6).every((k) => isInt(church[k]))) errors.push('church amounts must be integer cents');
    const p = church.projection;
    if (!hasExactKeys(p, ['available', 'method', 'projectedNetCents']) || typeof p.available !== 'boolean'
      || (p.available ? !(isText(p.method) && isInt(p.projectedNetCents)) : !(p.method === null && p.projectedNetCents === null))) errors.push('church.projection is malformed');
  }

  const dc = value.daycare;
  if (dc !== null) {
    if (!hasExactKeys(dc, ['year', 'available', 'incomeActualCents', 'expenseActualCents', 'netActualCents', 'allocatedSharedCostsCents'])) errors.push('daycare is malformed');
    else if (!isInt(dc.year) || typeof dc.available !== 'boolean' || !isInt(dc.incomeActualCents) || !isInt(dc.expenseActualCents)
      || !isNonNegInt(dc.allocatedSharedCostsCents) || dc.netActualCents !== dc.incomeActualCents - dc.expenseActualCents) errors.push('daycare figures must be integer cents that reconcile');
  }

  const pr = value.property;
  if (pr !== null) {
    if (!hasExactKeys(pr, ['distributableCents', 'distributablePeriod', 'reservesOnHandCents', 'reservesSource', 'reservesPeriod', 'occupancyPct', 'occupancyMonths', 'distributedThisYear'])) errors.push('property is malformed');
    else {
      if (!isNullableInt(pr.distributableCents) || (pr.distributableCents === null) !== (pr.distributablePeriod === null)
        || (pr.distributablePeriod !== null && !isText(pr.distributablePeriod))) errors.push('property distributable figure is malformed');
      if (!isInt(pr.reservesOnHandCents) || !['ahra_total', 'ledger'].includes(pr.reservesSource)
        || (pr.reservesSource === 'ahra_total' ? !isText(pr.reservesPeriod) : pr.reservesPeriod !== null)) errors.push('property reserves are malformed');
      if (!isNullableInt(pr.occupancyPct) || !isNonNegInt(pr.occupancyMonths) || pr.occupancyMonths > 12) errors.push('property occupancy is malformed');
      if (!hasExactKeys(pr.distributedThisYear, ['year', 'cents']) || !isInt(pr.distributedThisYear.year) || !isInt(pr.distributedThisYear.cents)) errors.push('property.distributedThisYear is malformed');
    }
  }

  if (!(value.waitingFamilies === null || isNonNegInt(value.waitingFamilies))) errors.push('waitingFamilies must be a count or null');

  const gp = value.givingPace;
  if (!hasExactKeys(gp, ['scope', 'throughMonth', 'monthly', 'budgetCents', 'budgetCode', 'budgetAccounts', 'budgetCodePinned', 'excludedCents'])) errors.push('givingPace is malformed');
  else {
    if (!['general_fund', 'all_funds'].includes(gp.scope)) errors.push('givingPace.scope must be general_fund or all_funds');
    if (!isInt(gp.throughMonth) || gp.throughMonth < 1 || gp.throughMonth > 12) errors.push('givingPace.throughMonth must be 1-12');
    checkList(errors, gp.monthly, 'givingPace.monthly', ['month', 'cents'], (m, at) => {
      if (!isInt(m.month) || m.month < 1 || m.month > 12 || !isInt(m.cents)) errors.push(`${at} is malformed`);
    });
    if (!isNullableInt(gp.budgetCents) || !isText(gp.budgetCode) || typeof gp.budgetCodePinned !== 'boolean' || !isInt(gp.excludedCents)
      || !Array.isArray(gp.budgetAccounts) || gp.budgetAccounts.some((a) => !isText(a))) errors.push('givingPace budget fields are malformed');
  }

  const cash = value.cash;
  if (!hasExactKeys(cash, ['available', 'onHandCents', 'avgMonthlyExpenseCents', 'policyFloorMonths', 'monthsOfCash', 'floorCents', 'gapToFloorCents', 'source', 'accounts', 'asOfDate', 'daycareExcludedCents'])) errors.push('cash is malformed');
  else {
    if (typeof cash.available !== 'boolean' || !isNullableInt(cash.onHandCents) || !isNonNegInt(cash.avgMonthlyExpenseCents)
      || !(isNum(cash.policyFloorMonths) && cash.policyFloorMonths >= 0) || !CASH_SOURCES.has(cash.source)
      || !Array.isArray(cash.accounts) || cash.accounts.some((a) => !isText(a)) || !isText(cash.asOfDate) || !isInt(cash.daycareExcludedCents)) errors.push('cash fields are malformed');
    if (cash.available) {
      if (!isNum(cash.monthsOfCash) || !isNonNegInt(cash.floorCents) || !isNonNegInt(cash.gapToFloorCents) || !isInt(cash.onHandCents)) errors.push('an available runway needs its derived figures');
    } else if (cash.monthsOfCash !== null || cash.floorCents !== null || cash.gapToFloorCents !== null) errors.push('an unavailable runway must use null derived figures');
  }

  if (value.fiveYearMix !== null) {
    checkList(errors, value.fiveYearMix, 'fiveYearMix', ['year', 'totalCents', 'donorCents', 'earnedCents', 'passiveCents'], (y, at) => {
      if (!isInt(y.year) || !isInt(y.totalCents) || !isInt(y.donorCents) || !isInt(y.earnedCents) || !isInt(y.passiveCents)
        || y.donorCents + y.earnedCents + y.passiveCents !== y.totalCents) errors.push(`${at} must be integer cents that sum to the year`);
    });
    if (Array.isArray(value.fiveYearMix) && value.fiveYearMix.length > 5) errors.push('fiveYearMix holds at most five years');
  }

  checkList(errors, value.overPace, 'overPace', ['label', 'overCents'], (o, at) => {
    if (!isText(o.label) || !isInt(o.overCents) || o.overCents <= 0) errors.push(`${at} is malformed`);
  });

  const t = value.targets;
  if (!hasExactKeys(t, ['gapCents', 'reserveGapCents', 'projectedCents']) || !isNonNegInt(t.gapCents) || !isNonNegInt(t.reserveGapCents) || !isInt(t.projectedCents)
    || t.gapCents !== Math.max(0, -t.projectedCents)) errors.push('targets must be the gap and reserve gap');

  const appeal = value.appeal;
  if (!hasExactKeys(appeal, ['gap', 'gapReserves'])) errors.push('appeal must carry both scopes');
  else {
    checkLadder(errors, appeal.gap, 'appeal.gap');
    checkLadder(errors, appeal.gapReserves, 'appeal.gapReserves');
    if (isRecord(t) && isRecord(appeal.gap) && isRecord(appeal.gapReserves)
      && (appeal.gap.targetCents !== t.gapCents || appeal.gapReserves.targetCents !== t.gapCents + t.reserveGapCents)) errors.push('appeal targets must match targets');
  }

  const levers = value.levers;
  if (!hasExactKeys(levers, ['cutCents', 'distributionCents', 'residualGapCents', 'residualGapReservesCents'])
    || !isNonNegInt(levers.cutCents) || !isInt(levers.distributionCents) || !isNonNegInt(levers.residualGapCents) || !isNonNegInt(levers.residualGapReservesCents)) errors.push('levers are malformed');

  return { ok: errors.length === 0, errors };
}

export function acceptFinanceHealthV1(value) {
  const validation = validateFinanceHealthV1(value);
  if (!validation.ok) throw new Error(`Invalid ${CONTRACT}: ${validation.errors.join('; ')}`);
  return structuredClone(value);
}
