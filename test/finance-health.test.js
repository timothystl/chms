import { describe, it, expect } from 'vitest';
import {
  classifyRevenueStream,
  computeRevenueStreams,
  computeMoneyFlow,
  computeCashRunway,
  operatingCashFromAccounts,
  computeAppealLadder,
  computeRoomOccupancy,
  REVENUE_STREAMS,
} from '../src/api-finance.js';

// Finance Workspace v3 (2026-08 "Finance overview framing" handoff). The Financial Health page
// makes one substantive claim — that donor revenue is the only stream the board can move — and
// every figure supporting it comes from the pure functions below. These tests pin the arithmetic
// and, more importantly, the honesty guarantees: unmapped groups are surfaced rather than
// silently guessed, outflows always sum to total expenses, and a runway with no data reports
// "unavailable" rather than an infinite one.

const row = (o) => ({
  classification: 'Income', category_path: '', account_name: '',
  own_actual_cents: 0, own_budget_cents: null, ...o,
});

describe('classifyRevenueStream', () => {
  it('reads the obvious names without any configuration', () => {
    expect(classifyRevenueStream('40 Offerings & Contributions').stream).toBe('donor');
    expect(classifyRevenueStream('57 MDO Tuition').stream).toBe('earned');
    expect(classifyRevenueStream('42 Passive Income').stream).toBe('passive');
    expect(classifyRevenueStream('44 Facility Rentals').stream).toBe('earned');
  });

  it('defaults an unrecognised group to earned, never to donor', () => {
    // Overstating donor revenue overstates how much of the budget the board can influence,
    // which is the one claim the whole page is built to make honestly.
    const r = classifyRevenueStream('91 Miscellaneous Widgets');
    expect(r.stream).toBe('earned');
    expect(r.mapped, 'a guess must never report itself as confirmed').toBe(false);
  });

  it('lets an admin override the guess, and says the answer was confirmed', () => {
    const r = classifyRevenueStream('91 Miscellaneous Widgets', { '91 Miscellaneous Widgets': 'donor' });
    expect(r.stream).toBe('donor');
    expect(r.mapped).toBe(true);
  });

  it('ignores an override naming a stream that does not exist', () => {
    expect(classifyRevenueStream('40 Offerings', { '40 Offerings': 'magic' }).stream).toBe('donor');
  });
});

describe('computeRevenueStreams', () => {
  const entries = [
    row({ category_path: '40 Offerings:41 Plate', own_actual_cents: 30000000, own_budget_cents: 32000000 }),
    row({ category_path: '40 Offerings:42 Pledged', own_actual_cents: 13500000, own_budget_cents: 14000000 }),
    row({ category_path: '57 MDO Tuition', own_actual_cents: 60000000 }),
    row({ classification: 'Other Income', category_path: '42 Passive Income:Endowment', own_actual_cents: 8000000 }),
    row({ classification: 'Expenses', category_path: '58 Salaries', own_actual_cents: 40000000 }),
  ];

  it('groups by the top level of the account path, not by leaf account', () => {
    const { streams } = computeRevenueStreams(entries, {});
    // The two Offerings leaves roll into one group a human can actually classify.
    expect(streams.donor.groups).toHaveLength(1);
    expect(streams.donor.groups[0].label).toBe('40 Offerings');
    expect(streams.donor.cents).toBe(43500000);
  });

  it('ignores expense rows entirely', () => {
    const { totalCents } = computeRevenueStreams(entries, {});
    expect(totalCents, 'salaries must not count as revenue').toBe(43500000 + 60000000 + 8000000);
  });

  it('carries budget alongside actual, for the giving-pace line', () => {
    const { streams, totalBudgetCents } = computeRevenueStreams(entries, {});
    expect(streams.donor.budgetCents).toBe(46000000);
    expect(streams.earned.budgetCents, 'a null budget is not a zero budget summed in').toBe(0);
    expect(totalBudgetCents).toBe(46000000);
  });

  it('reports every group it had to guess at', () => {
    const { unmapped } = computeRevenueStreams(entries, {});
    const labels = unmapped.map((u) => u.label);
    expect(labels).toContain('40 Offerings');
    expect(unmapped.every((u) => REVENUE_STREAMS.includes(u.defaultedTo))).toBe(true);
  });

  it('stops reporting a group as guessed once an admin confirms it', () => {
    const { unmapped } = computeRevenueStreams(entries, {
      '40 Offerings': 'donor', '57 MDO Tuition': 'earned', '42 Passive Income': 'passive',
    });
    expect(unmapped).toEqual([]);
  });

  it('moves the money when the override disagrees with the guess', () => {
    const { streams } = computeRevenueStreams(entries, { '57 MDO Tuition': 'passive' });
    expect(streams.earned.cents).toBe(0);
    expect(streams.passive.cents).toBe(60000000 + 8000000);
  });
});

describe('computeMoneyFlow', () => {
  const entries = [
    row({ classification: 'Expenses', category_path: '58 Salaries', own_actual_cents: 40000000 }),
    row({ classification: 'Expenses', category_path: '57 MDO Expenses:Payroll', own_actual_cents: 35000000 }),
    row({ classification: 'Expenses', account_name: "Mother's Day Out Supplies", category_path: '60 Supplies', own_actual_cents: 500000 }),
    row({ classification: 'Other Expenses', category_path: '70 Interest', own_actual_cents: 1000000 }),
    row({ classification: 'Income', category_path: '40 Offerings', own_actual_cents: 99900000 }),
  ];

  it('splits outflow into MDO and everything else', () => {
    const f = computeMoneyFlow(entries);
    expect(f.mdoOutCents).toBe(35500000);
    expect(f.churchOutCents).toBe(41000000);
  });

  it('always reconciles: the two halves are total expenses, with nothing unaccounted for', () => {
    const f = computeMoneyFlow(entries);
    expect(f.mdoOutCents + f.churchOutCents).toBe(f.totalOutCents);
    expect(f.totalOutCents, 'income must not leak into the outflow').toBe(76500000);
  });

  it('matches MDO on the account name as well as the path', () => {
    // The Supplies row sits under "60 Supplies" but is named Mother's Day Out — it is an MDO cost.
    const f = computeMoneyFlow([entries[2]]);
    expect(f.mdoOutCents).toBe(500000);
    expect(f.churchOutCents).toBe(0);
  });
});

describe('computeCashRunway', () => {
  it('divides cash on hand by the average month', () => {
    const r = computeCashRunway({ onHandCents: 21480000, expensesYtdCents: 63770000, monthsElapsed: 7, policyFloorMonths: 3 });
    expect(r.available).toBe(true);
    expect(r.avgMonthlyExpenseCents).toBe(9110000);
    expect(r.monthsOfCash).toBeCloseTo(2.358, 2);
  });

  it('states the dollar gap to the floor, and zero once it is cleared', () => {
    const short = computeCashRunway({ onHandCents: 21480000, expensesYtdCents: 63770000, monthsElapsed: 7, policyFloorMonths: 3 });
    expect(short.floorCents).toBe(27330000);
    expect(short.gapToFloorCents).toBe(5850000);
    const fine = computeCashRunway({ onHandCents: 40000000, expensesYtdCents: 63770000, monthsElapsed: 7, policyFloorMonths: 3 });
    expect(fine.gapToFloorCents, 'above the floor is not a negative gap').toBe(0);
  });

  it('reports unavailable rather than an infinite runway when there is nothing to divide by', () => {
    // A church with no expense actuals loaded would otherwise get months = Infinity, which reads
    // as reassuring when it actually means "we have no data".
    expect(computeCashRunway({ onHandCents: 5000000, expensesYtdCents: 0, monthsElapsed: 7, policyFloorMonths: 3 }).available).toBe(false);
    expect(computeCashRunway({ onHandCents: null, expensesYtdCents: 63770000, monthsElapsed: 7, policyFloorMonths: 3 }).available).toBe(false);
  });

  it('never divides by a zero month count', () => {
    const r = computeCashRunway({ onHandCents: 1000000, expensesYtdCents: 500000, monthsElapsed: 0, policyFloorMonths: 3 });
    expect(Number.isFinite(r.avgMonthlyExpenseCents)).toBe(true);
  });
});

describe('operatingCashFromAccounts', () => {
  const payload = { QueryResponse: { Account: [
    { Name: 'Operating Checking', CurrentBalance: 154321.55 },
    { Name: 'Building Reserve Savings', CurrentBalance: 60478.45 },
    { Name: 'Accounts Receivable', CurrentBalance: 9999 },
  ] } };

  it('sums checking, savings and reserve accounts into cents', () => {
    expect(operatingCashFromAccounts(payload).cents).toBe(21480000);
  });

  it('leaves out accounts that are neither', () => {
    expect(operatingCashFromAccounts(payload).matched).toBe(2);
  });

  it('returns null when nothing matched, so the caller can say the source is unknown', () => {
    expect(operatingCashFromAccounts({ QueryResponse: { Account: [{ Name: 'Payroll Liabilities', CurrentBalance: 1 }] } })).toBeNull();
    expect(operatingCashFromAccounts(null)).toBeNull();
  });
});

describe('computeAppealLadder', () => {
  it('asks whole households, and totals from those rows', () => {
    const l = computeAppealLadder(7350000); // $73,500
    expect(l.tiers.every((t) => Number.isInteger(t.households))).toBe(true);
    const summed = l.tiers.reduce((s, t) => s + t.raisesCents, 0);
    expect(l.totalCents, 'the stated total must be the ladder, not the raw target').toBe(summed);
  });

  it('always covers at least the target it was built for', () => {
    for (const target of [100000, 1500000, 7350000, 25000000]) {
      expect(computeAppealLadder(target).totalCents).toBeGreaterThanOrEqual(target);
    }
  });

  it('scales households with the target', () => {
    const small = computeAppealLadder(1000000);
    const big = computeAppealLadder(10000000);
    expect(big.totalHouseholds).toBeGreaterThan(small.totalHouseholds);
  });

  it('returns an empty ladder for nothing to raise', () => {
    expect(computeAppealLadder(0).tiers).toEqual([]);
    expect(computeAppealLadder(-500).totalCents).toBe(0);
  });
});

describe('computeRoomOccupancy', () => {
  const rooms = [
    { room_name: 'Bee Room', capacity_per_day: 12, avg_daily_enrolled: 10.7, waitlist_families: 20, seasonal: 0 },
    { room_name: 'Owl Room', capacity_per_day: 11, avg_daily_enrolled: 5.6, waitlist_families: 0, seasonal: 0 },
    { room_name: 'Summer Camp', capacity_per_day: 25, avg_daily_enrolled: 13.5, waitlist_families: 0, seasonal: 1 },
  ];

  it('counts seats on one basis only, excluding the seasonal room', () => {
    const o = computeRoomOccupancy(rooms);
    expect(o.totalSeats, 'Summer Camp must not inflate the year-round capacity basis').toBe(23);
    expect(o.filledSeats).toBe(16);
    expect(o.seasonalRooms).toEqual(['Summer Camp']);
  });

  it('still counts a seasonal room\'s waiting families', () => {
    const o = computeRoomOccupancy(rooms.concat([{ room_name: 'Camp 2', capacity_per_day: 5, avg_daily_enrolled: 1, waitlist_families: 3, seasonal: 1 }]));
    expect(o.waitingFamilies).toBe(23);
  });

  it('reports open seats only in the rooms that are actually under-filled', () => {
    // This is the number behind "the ask is staff, not building" — it must not include a room
    // that is nearly full, or the claim collapses.
    const o = computeRoomOccupancy(rooms);
    expect(o.openSeatsUnderfilled).toBe(5); // Owl only: 11 - 5.6 = 5.4 -> 5
  });

  it('returns a null percentage rather than dividing by zero seats', () => {
    expect(computeRoomOccupancy([]).overallPct).toBeNull();
    expect(computeRoomOccupancy(null).totalSeats).toBe(0);
  });
});
