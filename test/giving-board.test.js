import { describe, it, expect } from 'vitest';
import { bucketGivingMethod, projectYearEnd, sundaysElapsedInYear, spreadBudgetYtd, computeConcentration } from '../src/api-utils.js';

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
  it('returns actual when through December', () => {
    expect(projectYearEnd(800000, 500000, 900000, 12)).toEqual({ projected: 800000, method: 'actual' });
  });
  it('scales by prior-year seasonal shape when prior data exists', () => {
    // YTD 401300 through June, prior year gave 395300 through June and 839000 full year
    const r = projectYearEnd(401300, 395300, 839000, 6);
    expect(r.method).toBe('seasonal');
    expect(r.projected).toBe(Math.round(401300 * (839000 / 395300))); // ≈ 851,432
  });
  it('falls back to straight-line when no prior data', () => {
    const r = projectYearEnd(300000, 0, 0, 6);
    expect(r.method).toBe('linear');
    expect(r.projected).toBe(600000);
  });
  it('handles prior full < prior cum defensively via linear', () => {
    const r = projectYearEnd(100000, 200000, 100000, 6); // priorFull < priorCum → linear
    expect(r.method).toBe('linear');
    expect(r.projected).toBe(200000);
  });
  it('extrapolates off Sundays elapsed when given and there is no prior-year data', () => {
    // 26 weeks of giving through June -> 300000 cents so far. 13 Sundays elapsed -> 52/13 = 4x.
    const r = projectYearEnd(300000, 0, 0, 6, 13);
    expect(r.method).toBe('linear-weekly');
    expect(r.projected).toBe(1200000);
  });
  it('prefers the seasonal path over the weekly fallback when prior-year data exists', () => {
    const r = projectYearEnd(401300, 395300, 839000, 6, 26);
    expect(r.method).toBe('seasonal');
  });
});

describe('sundaysElapsedInYear', () => {
  it('counts every Sunday from Jan 1 through the last day of the given month (2026)', () => {
    expect(sundaysElapsedInYear(2026, 1)).toBe(4);
    expect(sundaysElapsedInYear(2026, 6)).toBe(26);
    expect(sundaysElapsedInYear(2026, 12)).toBe(52);
  });
  it('respects a leap-year February', () => {
    expect(sundaysElapsedInYear(2024, 2)).toBe(8);
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
