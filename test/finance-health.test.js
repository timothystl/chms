import { describe, it, expect } from 'vitest';
import {
  classifyRevenueStream,
  revenueGroupLabel,
  computeRevenueStreams,
  computeMoneyFlow,
  computeCashRunway,
  operatingCashFromAccounts,
  operatingCashFromBalanceSheet,
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

  it('defaults an unrecognized group to earned, never to donor', () => {
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

  it('routes money given for a purpose to restricted, not to donor', () => {
    // Restricted dollars arrive from donors but cannot be redirected, so counting them as donor
    // revenue would overstate exactly what this page exists to state honestly.
    expect(classifyRevenueStream('Altar Guild').stream).toBe('restricted');
    expect(classifyRevenueStream('Restricted Income').stream).toBe('restricted');
    expect(classifyRevenueStream('49 Designated Gifts').stream).toBe('restricted');
  });

  it('does not read "Unrestricted" as restricted', () => {
    expect(classifyRevenueStream('Unrestricted Offerings').stream).toBe('donor');
  });
});

// Every parser in api-finance.js puts the classification in segment 0 of category_path, so the
// group a human can classify is segment 1. Reading segment 0 collapsed the whole chart of accounts
// into one group named "Income" and defaulted the entire budget to earned — reported live as a
// 100%-earned revenue mix with $0 donor revenue.
describe('revenueGroupLabel', () => {
  it('skips the classification segment the importers prepend', () => {
    expect(revenueGroupLabel('Income:40 Offerings:41 Plate')).toBe('40 Offerings');
    expect(revenueGroupLabel('Other Income:42 Passive Income:Endowment')).toBe('42 Passive Income');
    expect(revenueGroupLabel('Revenue:Facility Rental')).toBe('Facility Rental');
  });

  it('leaves a path that does not start with a classification alone', () => {
    expect(revenueGroupLabel('40 Offerings:41 Plate')).toBe('40 Offerings');
  });

  it('falls back to the account name when there is no path', () => {
    expect(revenueGroupLabel('', 'Sunday Offering')).toBe('Sunday Offering');
    expect(revenueGroupLabel('', '')).toBe('');
  });

  it('keeps a bare classification row as its own label rather than dropping its money', () => {
    // The section-header row carries no own amount by construction, but returning '' here would
    // silently discard any that ever did.
    expect(revenueGroupLabel('Income')).toBe('Income');
  });
});

describe('computeRevenueStreams', () => {
  // Paths carry the leading classification segment exactly as every importer writes it.
  const entries = [
    row({ category_path: 'Income:40 Offerings:41 Plate', own_actual_cents: 30000000, own_budget_cents: 32000000 }),
    row({ category_path: 'Income:40 Offerings:42 Pledged', own_actual_cents: 13500000, own_budget_cents: 14000000 }),
    row({ category_path: 'Income:57 MDO Tuition', own_actual_cents: 60000000 }),
    row({ classification: 'Other Income', category_path: 'Other Income:42 Passive Income:Endowment', own_actual_cents: 8000000 }),
    row({ classification: 'Expenses', category_path: 'Expenses:58 Salaries', own_actual_cents: 40000000 }),
  ];

  it('groups by the account group under the classification, not by leaf account', () => {
    const { streams } = computeRevenueStreams(entries, {});
    // The two Offerings leaves roll into one group a human can actually classify.
    expect(streams.donor.groups).toHaveLength(1);
    expect(streams.donor.groups[0].label).toBe('40 Offerings');
    expect(streams.donor.cents).toBe(43500000);
  });

  it('does not collapse the whole chart of accounts into one "Income" group', () => {
    // The live regression: with every path sharing the classification as segment 0, all revenue
    // landed in one unrecognized group and defaulted to earned — donor read $0 at 0%.
    const { streams, map } = computeRevenueStreams(entries, {});
    expect(Object.keys(map).sort()).toEqual(['40 Offerings', '42 Passive Income', '57 MDO Tuition']);
    expect(streams.earned.cents, 'earned must not swallow the offerings').toBe(60000000);
    expect(streams.donor.cents).toBeGreaterThan(0);
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

  it('keeps restricted income out of donor revenue and out of the total nowhere', () => {
    const withRestricted = entries.concat([
      row({ category_path: 'Income:Altar Guild:Flowers', own_actual_cents: 200000 }),
    ]);
    const { streams, totalCents } = computeRevenueStreams(withRestricted, {});
    expect(streams.restricted.cents).toBe(200000);
    expect(streams.donor.cents, 'a designated gift is not spendable donor revenue').toBe(43500000);
    expect(totalCents, 'restricted still counts toward total revenue').toBe(43500000 + 60000000 + 8000000 + 200000);
  });

  it('sums every stream into the total, so no stream can be silently dropped', () => {
    const { streams, totalCents } = computeRevenueStreams(entries, {});
    const summed = REVENUE_STREAMS.reduce((s, k) => s + streams[k].cents, 0);
    expect(summed).toBe(totalCents);
  });

  it('does not ask for a decision about a group holding no money', () => {
    // The classification header row (path === the classification alone) carries no own amount and
    // would otherwise sit in the editor forever as one unconfirmed group named "Income".
    const withHeader = entries.concat([row({ category_path: 'Income', own_actual_cents: 0 })]);
    const { unmapped } = computeRevenueStreams(withHeader, {});
    expect(unmapped.map((u) => u.label)).not.toContain('Income');
  });

  it('returns a resolved stream for every group, guessed or confirmed', () => {
    // The Church Report groups its own account tree from this map, so a group missing here would
    // silently stay ungrouped on that page.
    const { map } = computeRevenueStreams(entries, { '57 MDO Tuition': 'passive' });
    expect(map['57 MDO Tuition'], 'an override must win in the map too').toBe('passive');
    expect(map['40 Offerings']).toBe('donor');
    expect(map['42 Passive Income']).toBe('passive');
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

// This church's operating account is "11027 Lindell Checking xx9105" — the fixture is that real
// shape, including the sibling asset accounts a loose match could wrongly sweep in.
describe('operatingCashFromBalanceSheet', () => {
  const rows = [
    { classification: 'Assets', account_name: 'Current Assets', has_children: 1, own_balance_cents: 0, as_of_date: '12/31/2026' },
    { classification: 'Assets', account_name: '11027 Lindell Checking xx9105', has_children: 0, own_balance_cents: 18450000, as_of_date: '12/31/2026' },
    { classification: 'Assets', account_name: '11040 Daycare Checking xx2201', has_children: 0, own_balance_cents: 3200000, as_of_date: '12/31/2026' },
    { classification: 'Assets', account_name: '12010 Thrivent Endowment', has_children: 0, own_balance_cents: 20572408, as_of_date: '12/31/2026' },
    { classification: 'Liabilities', account_name: '11027 Lindell Checking offset', has_children: 0, own_balance_cents: 999, as_of_date: '12/31/2026' },
  ];

  it('reads exactly the account it was told to, by code', () => {
    const cash = operatingCashFromBalanceSheet(rows, '11027');
    expect(cash.cents).toBe(18450000);
    expect(cash.accounts).toEqual(['11027 Lindell Checking xx9105']);
    expect(cash.asOfDate).toBe('12/31/2026');
  });

  it('never counts a liability line, however it is named', () => {
    // The code match is a string prefix; without the Assets guard the liability row above would
    // be added straight into cash on hand.
    expect(operatingCashFromBalanceSheet(rows, '11027').cents).toBe(18450000);
  });

  it('falls back to a name match, and names every account it summed', () => {
    const cash = operatingCashFromBalanceSheet(rows, '');
    expect(cash.cents).toBe(18450000 + 3200000);
    // Both are surfaced so an unpinned match that swept in the daycare account is visible on the
    // card rather than buried in the total.
    expect(cash.accounts).toHaveLength(2);
  });

  it('leaves endowments and reserves out — they are not operating cash', () => {
    expect(operatingCashFromBalanceSheet(rows, '').accounts.join(' ')).not.toMatch(/Endowment/);
  });

  // Rewritten 2026-09-05. The previous fixture gave a parent the SAME own_balance_cents as its
  // only child and asserted the parent was skipped — but that shape is one no balance-sheet
  // parser in this app produces. Every stored row holds its OWN non-cumulative amount, never a
  // "Total for X" subtotal (FIN6's rule, restated at extractMdoDaycareEntries and
  // computeRevenueStreams), which is why computeBalanceSummary() sums every row — parents
  // included — and still reconciles Assets = Liabilities + Equity to the cent, as it does for all
  // eight of this church's imported years. Skipping parents outright was therefore deleting real
  // money: "11027 Lindell Checking xx9105" has a $0.00 "11030 Cash on hand" nested under it in
  // the multi-year Financial Position export, so $116,693.30 of 2026 operating cash read as ~$0.
  // What is still guarded, and is the real risk, is an empty grouping header being swept in.
  it('counts a parent account that holds money of its own, once, alongside its child', () => {
    const withParent = [
      { classification: 'Assets', account_name: '11027 Lindell Checking xx9105', has_children: 1, own_balance_cents: 11669330, as_of_date: '' },
      { classification: 'Assets', account_name: '11030 Checking - petty', has_children: 0, own_balance_cents: 500, as_of_date: '' },
    ];
    const got = operatingCashFromBalanceSheet(withParent, '');
    expect(got.cents).toBe(11669330 + 500);
    expect(got.accounts).toHaveLength(2);
  });

  it('drops an empty grouping header, so it is neither summed nor named as an account', () => {
    const withHeader = [
      { classification: 'Assets', account_name: '11000 Checking Accounts', has_children: 1, own_balance_cents: 0, as_of_date: '' },
      { classification: 'Assets', account_name: '11027 Lindell Checking', has_children: 0, own_balance_cents: 18450000, as_of_date: '' },
    ];
    const got = operatingCashFromBalanceSheet(withHeader, '');
    expect(got.cents).toBe(18450000);
    expect(got.accounts).toEqual(['11027 Lindell Checking']);
  });

  it('returns null when nothing matches, so the card can say the source is unknown', () => {
    expect(operatingCashFromBalanceSheet(rows, '99999')).toBeNull();
    expect(operatingCashFromBalanceSheet([], '')).toBeNull();
    expect(operatingCashFromBalanceSheet(null, '')).toBeNull();
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
