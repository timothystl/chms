import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';
import {
  buildFinanceHealthV1, computeDaycareYear, computeOverPace, computePropertyHealth, elapsedYearFraction,
} from '../src/api-finance-health-contract.js';
import { buildChurchThisYear } from '../src/api-finance.js';
import { validateFinanceHealthV1, acceptFinanceHealthV1 } from '../contracts/validators/finance-health-consumer.js';
import { withLocalContractReads } from '../apps/finance/local-contract-reads.js';
import { makeDb, seed } from './finance-health-fixture.js';

// The ledger in finance-health-fixture.js is small enough to check by hand:
//   Income  $50,000 Sunday Offering + $1,000 Altar Guild + $8,000 Hall Rental + $30,000 MDO Tuition
//   Expense $40,000 Pastor Salary + $6,000 Electric + $4,000 Insurance + $40,000 MDO Wages
//   Net −$1,000 through July, projected straight-line to −$1,714.29 for the year.

describe('connect.finance-health.v1', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-07-01T12:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('builds the legacy Financial Health figures from the same payloads, and validates', async () => {
    const db = makeDb();
    seed(db);
    const health = await buildFinanceHealthV1(db, { fiscalYear: 2026, now: new Date() });
    expect(validateFinanceHealthV1(health)).toEqual({ ok: true, errors: [] });

    // Same computation the legacy tab fetches from finance/church/this-year.
    const legacy = await buildChurchThisYear(db, 2026);
    expect(health.revenueStreams.totalCents).toBe(legacy.revenueStreams.totalCents);
    expect(health.revenueStreams.streams.donor.cents).toBe(5000000);
    expect(health.revenueStreams.streams.restricted.cents).toBe(100000);
    expect(health.revenueStreams.streams.earned.cents).toBe(3800000);
    expect(health.giving).toEqual({ givingCents: 1950000, givingHouseholds: 40, donorBands: legacy.donorBands });
    expect(health.designatedFunds).toMatchObject({ designatedGivenCents: 250000, operatingGivenCents: 1700000, balanceCents: 700000, asOfDate: '2026-06-30' });
    expect(health.flowDiagram.totalRevenueCents).toBe(8900000);
    expect(health.flowDiagram.netCents).toBe(legacy.flowDiagram.netCents);

    expect(health.church).toMatchObject({ incomeActualCents: 8900000, expenseActualCents: 9000000, netActualCents: -100000 });
    expect(health.church.projection).toEqual({ available: true, method: 'straight-line-annual', projectedNetCents: Math.round(-100000 * 12 / 7) });
    expect(health.givingPace).toMatchObject({ scope: 'general_fund', throughMonth: 7, budgetCents: 12000000, excludedCents: 250000, budgetCodePinned: false });
    expect(health.givingPace.monthly.slice(0, 3).map((m) => m.cents)).toEqual([900000, 800000, 0]);

    // Church-only burn: $50,000 of non-MDO expense over 7 months; MDO wages stay out.
    expect(health.cash).toMatchObject({ available: true, onHandCents: 2000000, avgMonthlyExpenseCents: 714286, policyFloorMonths: 3, source: 'balance_sheet', daycareExcludedCents: 4000000 });
    expect(health.cash.gapToFloorCents).toBe(714286 * 3 - 2000000);

    // Daycare: counted sources only, plus half the church's utilities and insurance actuals.
    expect(health.daycare).toEqual({ year: 2026, available: true, incomeActualCents: 3000000, expenseActualCents: 2600000 + 300000 + 200000, netActualCents: 3000000 - 3100000, allocatedSharedCostsCents: 500000 });
    expect(health.property).toEqual({
      distributableCents: 1500000, distributablePeriod: '2026-05', reservesOnHandCents: 1035833, reservesSource: 'ahra_total',
      reservesPeriod: '2026-06', occupancyPct: 95, occupancyMonths: 2, distributedThisYear: { year: 2026, cents: 500000 },
    });
    expect(health.waitingFamilies).toBe(5);
    expect(health.fiveYearMix.map((y) => y.year)).toEqual([2025, 2026]);
    expect(health.fiveYearMix[1]).toEqual({ year: 2026, totalCents: 8900000, donorCents: 5100000, earnedCents: 3800000, passiveCents: 0 });

    const elapsed = elapsedYearFraction(2026, new Date());
    expect(health.overPace).toEqual([{ label: '60 Salaries', overCents: Math.round(4000000 - 6000000 * elapsed) }]);
    expect(health.targets).toEqual({ gapCents: 171429, reserveGapCents: 142858, projectedCents: -171429 });
    expect(health.appeal.gap.targetCents).toBe(171429);
    expect(health.appeal.gapReserves.targetCents).toBe(171429 + 142858);
    expect(health.levers.cutCents).toBe(health.overPace[0].overCents);
    expect(health.levers.distributionCents).toBe(1500000);
    expect(health.levers.residualGapReservesCents).toBe(0);
  });

  it('is served by Connect through the contract key, and never by Finance locally', async () => {
    const db = makeDb();
    seed(db);
    const env = { DB: db, FINANCE_CONTRACT_API_KEY: 'right-secret' };
    const call = (key, query = '?fiscal_year=2026') => handleContractsServiceApi(
      new Request(`https://connect.example/api/contracts/finance-health-v1${query}`, { headers: { 'X-Contract-Key': key } }), env, '/api/contracts/finance-health-v1');
    expect((await call('wrong')).status).toBe(401);
    expect((await call('right-secret', '')).status).toBe(400);
    const res = await call('right-secret');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(acceptFinanceHealthV1(body).contract).toBe('connect.finance-health.v1');
    // Council-safe: no donor, person or household identity anywhere in the payload.
    expect(JSON.stringify(body)).not.toMatch(/person_id|household_id|first_name|last_name|email/);

    // Finance's local reads never answer it; the request always reaches Connect.
    let reachedConnect = false;
    const wrapped = withLocalContractReads({
      FINANCE_LOCAL_CONTRACT_READS: '1', FINANCE_DB: db,
      CONNECT_SERVICE: { async fetch() { reachedConnect = true; return new Response('{}'); } },
    });
    await wrapped.CONNECT_SERVICE.fetch(new Request('https://connect.timothystl.org/api/contracts/finance-health-v1?fiscal_year=2026'));
    expect(reachedConnect).toBe(true);
  });

  it('reads the Ivanhoe reserve ledger plus the base minimum when AHRA reported no total', () => {
    const now = new Date('2026-07-01T12:00:00Z');
    const result = computePropertyHealth({
      monthly: [{ period: '2026-06', occupancy_pct: null, reserve_balance_cents: null, available_for_distribution_cents: null }],
      reserves: { tax: [{ reserve_after_cents: 100 }, { reserve_after_cents: 300 }], capital: [{ reserve_after_cents: 50 }] },
      meta: { reserves: { base_minimum_cents: 1000 } },
      distributions: [{ period: '2025-12', amount_cents: 999 }],
    }, now);
    expect(result).toMatchObject({ distributableCents: null, distributablePeriod: null, reservesOnHandCents: 1350, reservesSource: 'ledger', reservesPeriod: null, occupancyPct: null });
    expect(result.distributedThisYear).toEqual({ year: 2026, cents: 0 });
  });

  it('reports a year with no counted daycare rows as unavailable, not as a zero', () => {
    expect(computeDaycareYear([{ period: '2026', category: 'Payroll', entry_type: 'actual', amount_cents: 5, source: 'manual' }], null, 2026).available).toBe(false);
  });

  it('only counts budgeted categories more than $1,500 ahead of the calendar', () => {
    const rows = [
      { category_path: 'Expenses', account_name: 'Expenses', classification: 'Expenses', own_actual_cents: 0, own_budget_cents: null },
      { category_path: 'Expenses:A', account_name: 'A', classification: 'Expenses', own_actual_cents: 600000, own_budget_cents: 1000000 },
      { category_path: 'Expenses:B', account_name: 'B', classification: 'Expenses', own_actual_cents: 900000, own_budget_cents: null },
    ];
    expect(computeOverPace(rows, 0.5).categories).toEqual([]);
    expect(computeOverPace(rows, 0.4).categories).toEqual([{ label: 'A', overCents: 200000 }]);
  });
});
