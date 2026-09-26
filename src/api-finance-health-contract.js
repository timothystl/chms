// ── connect.finance-health.v1 — everything Connect's legacy Financial Health tab shows ───────
// Finance's Financial Health section renders the same page Connect's legacy tab does
// (finRenderHealth in src/frontend/js-finance.js). This contract hands it the same figures,
// computed by the same code:
//
//   - The church year comes from readChurchThisYear — the exact payload the legacy tab fetches
//     from finance/church/this-year (revenue streams, designated funds, flow diagram, giving pace,
//     cash runway, year-end projection, giving households and donor bands).
//   - The five-year mix comes from buildChurchMultiYear (finance/church/multi-year).
//   - The daycare engine card comes from the daycare ledger plus readDaycareAllocation
//     (finance/daycare + finance/daycare/allocation), the Ivanhoe card, levers and decisions from
//     readPropertyPayload (finance/property/ivanhoe), and the waiting-family count from
//     readDaycareRooms (finance/daycare/rooms).
//
// The legacy tab derives a handful of figures in the browser from those payloads (the daycare
// year aggregate, the Ivanhoe distributable/reserve/occupancy figures, the over-pace expense
// categories, the fundraising targets and the lever arithmetic). Those derivations are ported
// below, function for function, and are named after the js-finance.js function each mirrors, so
// Finance renders from finished figures and never re-derives any of them.
//
// Served by Connect, never from Finance's own database: the payload reads Giving tables
// (giving_monthly_fund_totals, funds and the annual household rollups) that stay in Connect.
// Aggregate only — fund names and household COUNTS, never a donor, so it is council-safe.
import { json } from './auth.js';
import { validateFinanceHealthV1 } from '../contracts/validators/finance-health-consumer.js';
import {
  readChurchThisYear, buildChurchMultiYear, readDaycareAllocation, readDaycareRooms, readPropertyPayload,
  computeAppealLadder, REVENUE_STREAMS,
} from './api-finance.js';

const CONTRACT = 'connect.finance-health.v1';
const PROPERTY_KEY = 'ivanhoe';
// finRenderLeverCards/finRenderDecisions: an expense category is "over pace" once it is more than
// $1,500 ahead of where the calendar says it should be.
const OVER_PACE_THRESHOLD_CENTS = 150000;
// FIN_DAYCARE_COUNTED_SOURCES / finIsIncomeCategory in js-finance.js.
const DAYCARE_COUNTED_SOURCES = new Set(['church_budget_import', 'manual_budget_override']);
const isDaycareIncomeCategory = (category) => String(category || '').trim().toLowerCase() === 'tuition income';

function utcYear(now) { return now.getUTCFullYear(); }

// finElapsedYearPct: the share of the year gone; a past or future year has no "expected by now".
export function elapsedYearFraction(year, now) {
  if (year !== utcYear(now)) return 1;
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  return (now.getTime() - start) / (end - start);
}

// finAggregateDaycareByYear, for the one year the engine card reads. Actuals only (the card never
// shows a budget), in integer cents rather than the browser's dollars. The MDO share of the
// church's utilities and insurance is added to expenses exactly as the legacy aggregate adds it.
export function computeDaycareYear(entries, allocationForYear, year) {
  const key = String(year);
  let seen = false, incomeActualCents = 0, expenseActualCents = 0;
  for (const e of entries || []) {
    if (!DAYCARE_COUNTED_SOURCES.has(e.source)) continue;
    if (String(e.period || '').slice(0, 4) !== key) continue;
    seen = true;
    const isBudget = e.entry_type === 'budget';
    if (isBudget) continue;
    const cents = Number(e.amount_cents) || 0;
    if (isDaycareIncomeCategory(e.category || 'Uncategorized')) incomeActualCents += cents;
    else expenseActualCents += cents;
  }
  if (!seen) return { year, available: false, incomeActualCents: 0, expenseActualCents: 0, netActualCents: 0, allocatedSharedCostsCents: 0 };
  const allocatedSharedCostsCents = allocationForYear
    ? (allocationForYear.mdoUtilityCents || 0) + (allocationForYear.mdoInsuranceCents || 0) : 0;
  expenseActualCents += allocatedSharedCostsCents;
  return {
    year, available: true, incomeActualCents, expenseActualCents,
    netActualCents: incomeActualCents - expenseActualCents, allocatedSharedCostsCents,
  };
}

const byPeriod = (a, b) => (a.period < b.period ? -1 : 1);

// finComputeLatestDistributionAmount, finPropertyLatestReserveMonth,
// finComputePropertyReservesOnHandCents, finComputePropertyKpis (occupancy) and
// finComputeDistributedThisYear, over the same Ivanhoe payload.
export function computePropertyHealth(payload, now) {
  const monthly = (payload.monthly || []).slice().sort(byPeriod);
  let distributable = null;
  for (let i = monthly.length - 1; i >= 0; i--) {
    if (monthly[i].available_for_distribution_cents != null) {
      distributable = { period: String(monthly[i].period), cents: monthly[i].available_for_distribution_cents };
      break;
    }
  }
  const latest = monthly.length ? monthly[monthly.length - 1] : null;
  let reservesOnHandCents = 0, reservesSource = 'ledger', reservesPeriod = null;
  if (latest && latest.reserve_balance_cents != null) {
    reservesOnHandCents = latest.reserve_balance_cents;
    reservesSource = 'ahra_total';
    reservesPeriod = String(latest.period);
  } else {
    for (const key of Object.keys(payload.reserves || {})) {
      const rows = payload.reserves[key];
      if (rows && rows.length) reservesOnHandCents += (rows[rows.length - 1].reserve_after_cents || 0);
    }
    reservesOnHandCents += payload.meta?.reserves?.base_minimum_cents || 0;
  }
  const trailing = monthly.slice(-12);
  let occSum = 0, occCount = 0;
  for (const m of trailing) if (m.occupancy_pct != null) { occSum += m.occupancy_pct; occCount++; }
  const year = utcYear(now);
  const distributedThisYearCents = (payload.distributions || [])
    .filter((d) => String(d.period || '').slice(0, 4) === String(year))
    .reduce((sum, d) => sum + (d.amount_cents || 0), 0);
  return {
    distributableCents: distributable ? distributable.cents : null,
    distributablePeriod: distributable ? distributable.period : null,
    reservesOnHandCents,
    reservesSource,
    reservesPeriod,
    occupancyPct: occCount ? Math.round(occSum / occCount * 100) : null,
    occupancyMonths: trailing.length,
    distributedThisYear: { year, cents: distributedThisYearCents },
  };
}

// finBuildTreeFromFlatRows: each account's own amount rolled up through its nearest stored
// ancestor, so a group label with no posting of its own never drops a child out of the totals.
export function buildChurchTree(rows) {
  const nodeByPath = new Map();
  const roots = [];
  for (const r of rows || []) {
    nodeByPath.set(r.category_path, {
      label: r.account_name, classification: r.classification,
      ownActualCents: r.own_actual_cents || 0, ownBudgetCents: r.own_budget_cents,
      totalActualCents: 0, totalBudgetCents: 0, children: [],
    });
  }
  for (const r of rows || []) {
    const node = nodeByPath.get(r.category_path);
    const segments = String(r.category_path).split(':');
    let parent = null;
    for (let i = segments.length - 1; i > 0; i--) {
      const candidate = nodeByPath.get(segments.slice(0, i).join(':'));
      if (candidate) { parent = candidate; break; }
    }
    if (parent) parent.children.push(node); else roots.push(node);
  }
  const total = (node) => {
    let actual = node.ownActualCents, budget = node.ownBudgetCents || 0;
    for (const child of node.children) { total(child); actual += child.totalActualCents; budget += child.totalBudgetCents; }
    node.totalActualCents = actual;
    node.totalBudgetCents = budget;
  };
  roots.forEach(total);
  return roots;
}

// The overPace list finRenderLeverCards and finRenderDecisions both build: every budgeted expense
// category more than $1,500 ahead of the calendar, largest first. `overCents` keeps the browser's
// unrounded difference until the very end, so the lever total matches the legacy page's sum.
export function computeOverPace(entries, elapsedFraction) {
  const expenseRoot = buildChurchTree(entries).find((n) => n.classification === 'Expenses');
  const raw = ((expenseRoot && expenseRoot.children) || [])
    .map((n) => ({ label: n.label, diff: n.totalActualCents - n.totalBudgetCents * elapsedFraction, hasBudget: n.totalBudgetCents > 0 }))
    .filter((x) => x.hasBudget && x.diff > OVER_PACE_THRESHOLD_CENTS)
    .sort((a, b) => b.diff - a.diff);
  return {
    categories: raw.map((x) => ({ label: String(x.label || ''), overCents: Math.round(x.diff) })),
    totalOverCents: raw.reduce((sum, x) => sum + x.diff, 0),
  };
}

// finHealthTargets: the operating gap to close and the distance to the reserve floor, derived
// once so every "what should we do" card states the same two numbers.
export function computeHealthTargets(thisYear) {
  const net = thisYear.netIncome || { actualCents: 0 };
  const projectedCents = (thisYear.yoy && thisYear.yoy.available) ? thisYear.yoy.net.projectedFullYearCents : net.actualCents;
  const gapCents = Math.max(0, -projectedCents);
  const reserveGapCents = (thisYear.cash && thisYear.cash.available) ? (thisYear.cash.gapToFloorCents || 0) : 0;
  return { gapCents, reserveGapCents, projectedCents };
}

function ladder(targetCents) {
  const l = computeAppealLadder(targetCents);
  return { targetCents, tiers: l.tiers, totalCents: l.totalCents, totalHouseholds: l.totalHouseholds };
}

function streamOut(stream) {
  const s = stream || { cents: 0, budgetCents: 0, groups: [] };
  return {
    cents: s.cents || 0,
    budgetCents: s.budgetCents || 0,
    groups: (s.groups || []).map((g) => ({ label: String(g.label), cents: g.cents || 0, budgetCents: g.budgetCents || 0 })),
  };
}

function classTotals(summary, key) {
  const t = (summary.classificationTotals || {})[key] || { actualCents: 0, budgetCents: 0 };
  return { actualCents: t.actualCents || 0, budgetCents: t.budgetCents || 0 };
}

async function readOptional(read) {
  try { return await read(); } catch { return null; }
}

export async function buildFinanceHealthV1(db, { fiscalYear, now = new Date() }) {
  const d = await readChurchThisYear(db, fiscalYear);
  // Each of these is a separate card on the legacy page, which fetches each independently and
  // renders what it can when one fails; null here is "could not be read", never a zero.
  const [multiYear, daycareEntries, allocation, rooms, property] = await Promise.all([
    readOptional(() => buildChurchMultiYear(db, null)),
    readOptional(async () => (await db.prepare(
      'SELECT period, category, entry_type, amount_cents, source FROM finance_daycare_entries ORDER BY period ASC'
    ).all()).results || []),
    readOptional(() => readDaycareAllocation(db, [utcYear(now)])),
    readOptional(() => readDaycareRooms(db, null)),
    readOptional(() => readPropertyPayload(db, PROPERTY_KEY)),
  ]);

  const income = classTotals(d, 'Income');
  const expenses = classTotals(d, 'Expenses');
  const net = d.netIncome || { actualCents: 0, budgetCents: 0 };
  const projection = (d.yoy && d.yoy.available)
    ? { available: true, method: String(d.yoy.net.method || ''), projectedNetCents: d.yoy.net.projectedFullYearCents }
    : { available: false, method: null, projectedNetCents: null };

  const daycareYear = utcYear(now);
  const daycare = daycareEntries
    ? computeDaycareYear(daycareEntries, allocation ? allocation.allocation[String(daycareYear)] || allocation.allocation[daycareYear] : null, daycareYear)
    : null;
  const propertyHealth = property ? computePropertyHealth(property, now) : null;

  const overPace = computeOverPace(d.entries, elapsedYearFraction(fiscalYear, now));
  const targets = computeHealthTargets(d);
  const distributionCents = propertyHealth?.distributableCents || 0;
  const residual = (targetCents) => Math.max(0, Math.round(targetCents - overPace.totalOverCents - distributionCents));

  const fiveYearMix = multiYear
    ? multiYear.years.slice(-5).map((year) => {
      const s = multiYear.streamsByYear[year];
      const cents = (key) => (s && s.streams[key] ? s.streams[key].cents || 0 : 0);
      return {
        year,
        totalCents: s ? s.totalCents || 0 : 0,
        // Display streams: restricted income drawn inside donor, as finDisplayStreams does.
        donorCents: cents('donor') + cents('restricted'),
        earnedCents: cents('earned'),
        passiveCents: cents('passive'),
      };
    })
    : null;

  const rs = d.revenueStreams || { streams: {}, totalCents: 0, unmapped: [] };
  const pace = d.givingPace || {};
  const cash = d.cash || { available: false };
  const flow = d.flowDiagram || { sources: [], streams: [], expenses: [], totalRevenueCents: 0, totalExpenseCents: 0, netCents: 0 };
  const designated = d.designatedFunds || { funds: [], designatedGivenCents: 0, operatingGivenCents: 0, balanceCents: null, asOfDate: '' };

  return {
    contract: CONTRACT,
    dataClassification: 'aggregate',
    sourceProduct: 'connect',
    consumerProduct: 'finance',
    currency: 'USD',
    fiscalYear,
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    hasLedger: (d.entries || []).length > 0,
    revenueStreams: {
      totalCents: rs.totalCents || 0,
      streams: Object.fromEntries(REVENUE_STREAMS.map((key) => [key, streamOut(rs.streams[key])])),
      unmapped: (rs.unmapped || []).map((u) => ({ label: String(u.label), cents: u.cents || 0, defaultedTo: u.defaultedTo })),
    },
    giving: {
      givingCents: d.givingCents || 0,
      givingHouseholds: d.givingHouseholds || 0,
      donorBands: (d.donorBands || []).map((b) => ({ label: b.label, households: b.households || 0 })),
    },
    designatedFunds: {
      funds: designated.funds.map((f) => ({ code: f.code, label: String(f.label || ''), givenCents: f.givenCents || 0, balanceCents: f.balanceCents })),
      designatedGivenCents: designated.designatedGivenCents || 0,
      operatingGivenCents: designated.operatingGivenCents || 0,
      balanceCents: designated.balanceCents,
      asOfDate: designated.asOfDate || '',
    },
    flowDiagram: {
      sources: flow.sources.map((s) => ({ id: s.id, label: String(s.label), stream: s.stream, cents: s.cents })),
      streams: flow.streams.map((s) => ({ id: s.id, cents: s.cents })),
      expenses: flow.expenses.map((e) => ({ id: e.id, label: e.label, note: e.note || '', cents: e.cents })),
      totalRevenueCents: flow.totalRevenueCents,
      totalExpenseCents: flow.totalExpenseCents,
      netCents: flow.netCents,
    },
    church: {
      incomeActualCents: income.actualCents,
      incomeBudgetCents: income.budgetCents,
      expenseActualCents: expenses.actualCents,
      expenseBudgetCents: expenses.budgetCents,
      netActualCents: net.actualCents || 0,
      netBudgetCents: net.budgetCents || 0,
      projection,
    },
    daycare,
    property: propertyHealth,
    waitingFamilies: rooms && rooms.available ? rooms.occupancy.waitingFamilies : null,
    givingPace: {
      scope: pace.scope === 'general_fund' ? 'general_fund' : 'all_funds',
      throughMonth: fiscalYear === utcYear(now) ? now.getUTCMonth() + 1 : 12,
      monthly: (d.givingMonthly || []).map((m) => ({ month: m.month, cents: m.cents || 0 })),
      budgetCents: pace.budgetCents == null ? null : pace.budgetCents,
      budgetCode: pace.budgetCode || '',
      budgetAccounts: (pace.budgetAccounts || []).map(String),
      budgetCodePinned: !!pace.budgetCodePinned,
      excludedCents: pace.excludedCents || 0,
    },
    cash: {
      available: !!cash.available,
      onHandCents: cash.onHandCents == null ? null : cash.onHandCents,
      avgMonthlyExpenseCents: cash.avgMonthlyExpenseCents || 0,
      policyFloorMonths: cash.policyFloorMonths,
      monthsOfCash: cash.available ? cash.monthsOfCash : null,
      floorCents: cash.available ? cash.floorCents : null,
      gapToFloorCents: cash.available ? cash.gapToFloorCents : null,
      source: cash.source,
      accounts: cash.accounts || [],
      asOfDate: cash.asOfDate || '',
      daycareExcludedCents: cash.daycareExcludedCents || 0,
    },
    fiveYearMix,
    overPace: overPace.categories,
    targets,
    appeal: {
      gap: ladder(targets.gapCents),
      gapReserves: ladder(targets.gapCents + targets.reserveGapCents),
    },
    levers: {
      cutCents: Math.round(overPace.totalOverCents),
      distributionCents,
      residualGapCents: residual(targets.gapCents),
      residualGapReservesCents: residual(targets.gapCents + targets.reserveGapCents),
    },
  };
}

export async function respondWithFinanceHealthV1(url, db) {
  const fiscalYearStr = url.searchParams.get('fiscal_year');
  if (!/^\d{4}$/.test(String(fiscalYearStr || ''))) return json({ error: 'fiscal_year is required as a 4-digit year' }, 400);
  const health = await buildFinanceHealthV1(db, { fiscalYear: Number(fiscalYearStr), now: new Date() });
  const validation = validateFinanceHealthV1(health);
  if (!validation.ok) return json({ error: 'Internal: assembled financial health failed contract validation', details: validation.errors }, 500);
  return json(health);
}
