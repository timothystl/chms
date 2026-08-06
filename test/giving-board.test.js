import { describe, it, expect } from 'vitest';
import { bucketGivingMethod, projectYearEnd, sundaysElapsedThroughDate, sundaysInYear, nthSundayOfYear, periodAsOfDate, monthElapsedFraction, spreadBudgetYtd, computeConcentration } from '../src/api-utils.js';

describe('bucketGivingMethod', () => {
  it('buckets checks', () => {
    expect(bucketGivingMethod('check')).toBe('check');
    expect(bucketGivingMethod('Check')).toBe('check');
    expect(bucketGivingMethod('CHEQUE')).toBe('check');
  });
  it('buckets cash / loose plate', () => {
    expect(bucketGivingMethod('cash')).toBe('cash');
    expect(bucketGivingMethod('Loose Plate')).toBe('cash');
  });
  it('buckets electronic methods as ach', () => {
    for (const m of ['ach', 'online', 'card', 'credit card', 'eft', 'paypal', 'recurring'])
      expect(bucketGivingMethod(m)).toBe('ach');
  });
  it('everything else is other', () => {
    expect(bucketGivingMethod('stock')).toBe('other');
    expect(bucketGivingMethod('IRA')).toBe('other');
    expect(bucketGivingMethod('')).toBe('other');
    expect(bucketGivingMethod(null)).toBe('other');
    expect(bucketGivingMethod(undefined)).toBe('other');
  });
});

describe('projectYearEnd', () => {
  // Projects on a SUNDAY basis, not a month one. The month version compared a part-month of this
  // year against a whole month of last year and counted the current month's not-yet-happened
  // Sundays as elapsed — both errors pull the same way, so any date but a month end came out low.
  const base = { sundaysInYear: 52 };

  it('reports rather than projects once the year is done', () => {
    expect(projectYearEnd({ ...base, ytdCents: 800000, sundaysElapsed: 52 }))
      .toMatchObject({ projected: 800000, method: 'actual' });
  });

  it('scales by the prior year at the SAME NUMBER OF SUNDAYS', () => {
    const r = projectYearEnd({ ...base, ytdCents: 401300, priorSamePointCents: 395300, priorFullYearCents: 839000, sundaysElapsed: 26 });
    expect(r.method).toBe('seasonal');
    expect(r.projected).toBe(Math.round(401300 * (839000 / 395300)));
  });

  it('keeps a year that is running behind behind, rather than catching it up by December', () => {
    // 90% of last year's pace at the same point projects to 90% of last year's total.
    const r = projectYearEnd({ ...base, ytdCents: 9000000, priorSamePointCents: 10000000, priorFullYearCents: 16000000, sundaysElapsed: 32 });
    expect(r.projected).toBe(14400000);
  });

  it('falls back to this year\'s own average Sunday when there is no prior year', () => {
    const r = projectYearEnd({ ...base, ytdCents: 300000, sundaysElapsed: 13 });
    expect(r.method).toBe('linear-weekly');
    expect(r.projected).toBe(1200000);
  });

  it('handles a nonsensical prior year defensively instead of projecting a shrink', () => {
    const r = projectYearEnd({ ...base, ytdCents: 100000, priorSamePointCents: 200000, priorFullYearCents: 100000, sundaysElapsed: 26 });
    expect(r.method).toBe('linear-weekly');
    expect(r.projected).toBe(200000);
  });

  it('counts all 53 Sundays in a 53-Sunday year', () => {
    // Assuming 52 drops a real week of giving from the projection in those years.
    const r = projectYearEnd({ ytdCents: 3200000, sundaysElapsed: 32, sundaysInYear: 53 });
    expect(r.projected).toBe(5300000);
  });

  it('reports the basis it used, so a council figure can be checked', () => {
    const r = projectYearEnd({ ...base, ytdCents: 100000, sundaysElapsed: 32 });
    expect(r.sundays_elapsed).toBe(32);
    expect(r.sundays_in_year).toBe(52);
    expect(r.sundays_remaining).toBe(20);
  });
});

describe('the week basis', () => {
  it('treats an in-progress month as in-progress, not complete', () => {
    // This is the reported bug in one assertion.
    expect(periodAsOfDate(2026, 8, new Date('2026-08-14T12:00:00Z'))).toBe('2026-08-14');
    expect(periodAsOfDate(2026, 7, new Date('2026-08-14T12:00:00Z'))).toBe('2026-07-31');
  });

  it('counts Sundays to a date, and finds last year\'s matching Sunday', () => {
    expect(sundaysElapsedThroughDate(2026, '2026-08-14')).toBe(32);
    expect(nthSundayOfYear(2025, 32)).toBe('2025-08-10');
    // Past the last Sunday, a full year stays full.
    expect(nthSundayOfYear(2025, 99)).toBe('2025-12-31');
  });

  it('knows a 53-Sunday year from a 52-Sunday one', () => {
    expect(sundaysInYear(2026)).toBe(52);
    expect(sundaysInYear(2023)).toBe(53); // 2023 began on a Sunday
  });

  it('charges a part-month of budget rather than a whole one', () => {
    const shape = new Array(12).fill(1000);
    const whole = spreadBudgetYtd(120000, shape, 8, 1);
    const part = spreadBudgetYtd(120000, shape, 8, 0.45);
    expect(part).toBeLessThan(whole);
    expect(spreadBudgetYtd(120000, shape, 8)).toBe(whole); // default unchanged
    expect(monthElapsedFraction(2026, 8, '2026-08-14')).toBeCloseTo(14 / 31, 5);
    expect(monthElapsedFraction(2026, 7, '2026-08-14')).toBe(1); // a finished month
  });
});


describe('spreadBudgetYtd', () => {
  it('returns 0 when no budget', () => {
    expect(spreadBudgetYtd(0, [1, 2, 3], 6)).toBe(0);
  });
  it('spreads evenly when no prior-year shape', () => {
    expect(spreadBudgetYtd(120000, [], 6)).toBe(60000);       // half the year
    expect(spreadBudgetYtd(120000, new Array(12).fill(0), 3)).toBe(30000);
  });
  it('follows the prior-year seasonal shape (December carries it)', () => {
    // Prior year: 11 months of 100 and a December of 200 → total 1300, Dec = 15.4%
    const prior = [100,100,100,100,100,100,100,100,100,100,100,200];
    // Through November: cum = 1100 of 1300 → 84.6% of a 130000 budget
    expect(spreadBudgetYtd(130000, prior, 11)).toBe(Math.round(130000 * (1100 / 1300)));
    // Full year = whole budget
    expect(spreadBudgetYtd(130000, prior, 12)).toBe(130000);
  });
});

describe('computeConcentration', () => {
  it('handles empty input', () => {
    const c = computeConcentration([]);
    expect(c.households).toBe(0);
    expect(c.top10_pct).toBe(0);
    expect(c.half_households).toBe(0);
  });
  it('computes top-10 share, half-households, and 4 segments that sum to the grand total', () => {
    // 100 households: ten of 1000, then ninety of 100 → grand = 10000 + 9000 = 19000
    const totals = [];
    for (let i = 0; i < 10; i++) totals.push(1000);
    for (let i = 0; i < 90; i++) totals.push(100);
    const c = computeConcentration(totals);
    expect(c.households).toBe(100);
    expect(c.grand_total_cents).toBe(19000);
    expect(c.top10_cents).toBe(10000);
    expect(c.top10_pct).toBe(53); // 10000/19000
    // segments cover everyone and sum to grand total
    const segSum = c.segments.reduce((s, x) => s + x.cents, 0);
    expect(segSum).toBe(19000);
    const countSum = c.segments.reduce((s, x) => s + x.count, 0);
    expect(countSum).toBe(100);
    // half of 19000 = 9500; top 10 give 10000 ≥ 9500 → 10 households
    expect(c.half_households).toBe(10);
  });
  it('ignores zero/negative totals', () => {
    const c = computeConcentration([500, 0, -100, 300]);
    expect(c.households).toBe(2);
    expect(c.grand_total_cents).toBe(800);
  });
});

describe('the projection says what it is built on', () => {
  // A council figure nobody can check is worse than one they can argue with, and the basis is
  // precisely what was wrong before — so it is now carried through to the page.
  it('carries the Sunday basis onto the category block', async () => {
    const { buildBoardCategoryBlock } = await import('../src/api-utils.js');
    const b = buildBoardCategoryBlock({
      key: 'general', label: 'General Fund', hhLabel: 'Giving households',
      throughMonth: 8, sundaysElapsed: 32, sundaysInYear: 52, finalMonthFraction: 14 / 31,
      funds: [{ actual_cents: 100000, prior_cents: 90000, annual_budget_cents: 240000 }],
      curMonthly: new Array(12).fill(0), priorMonthly: new Array(12).fill(10000),
      householdTotals: [100000], householdsPrior: 1, methodBuckets: { check: 100000 },
    });
    expect(b.sundays_elapsed).toBe(32);
    expect(b.sundays_in_year).toBe(52);
    expect(b.sundays_remaining).toBe(20);
  });

  it('charges the part-month of budget the fraction describes', async () => {
    const { buildBoardCategoryBlock } = await import('../src/api-utils.js');
    const args = {
      key: 'general', label: 'General Fund', hhLabel: 'Giving households',
      throughMonth: 8, sundaysElapsed: 32, sundaysInYear: 52,
      funds: [{ actual_cents: 100000, prior_cents: 90000, annual_budget_cents: 1200000 }],
      curMonthly: new Array(12).fill(0), priorMonthly: new Array(12).fill(10000),
      householdTotals: [100000], householdsPrior: 1, methodBuckets: { check: 100000 },
    };
    const whole = buildBoardCategoryBlock({ ...args, finalMonthFraction: 1 }).budget_ytd_cents;
    const part = buildBoardCategoryBlock({ ...args, finalMonthFraction: 14 / 31 }).budget_ytd_cents;
    expect(part).toBeLessThan(whole);
    // ...and the shortfall it reports shrinks accordingly, rather than blaming the congregation
    // for a month that has not happened yet.
    const wholeVar = buildBoardCategoryBlock({ ...args, finalMonthFraction: 1 }).budget_variance_cents;
    const partVar = buildBoardCategoryBlock({ ...args, finalMonthFraction: 14 / 31 }).budget_variance_cents;
    expect(partVar).toBeGreaterThan(wholeVar);
  });
});
