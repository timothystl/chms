import { describe, it, expect } from 'vitest';
import { computeGivingBands, GIVING_BAND_FLOORS_WEEKLY_CENTS } from '../src/api-utils.js';

// helper: a giver with a given annual total in dollars
const g = (dollars) => ({ total_cents: Math.round(dollars * 100) });

describe('computeGivingBands', () => {
  it('places a $50/wk giver ($2,600/yr) in the $50–74 band and models a +$10/wk uplift', () => {
    const r = computeGivingBands([g(2600)], { freq: 'weekly', periodsElapsed: 52, upliftCents: 1000 });
    const band = r.bands.find(b => b.n > 0);
    expect(band.low_cents).toBe(5000);   // $50/wk floor
    expect(band.high_cents).toBe(7500);  // < $75/wk
    expect(band.avg_per_period_cents).toBe(5000); // $50/wk
    // +$10/wk × 52 = $520/yr for that one household
    expect(band.uplift_annual_cents).toBe(1000 * 52);
    expect(r.summary.uplift_annual_cents).toBe(52000);
  });

  it('annualized current giving reconciles to the actual total for a full year', () => {
    const r = computeGivingBands([g(2600), g(5200)], { freq: 'weekly', periodsElapsed: 52, upliftCents: 0 });
    expect(r.summary.total_cents).toBe(780000);
    expect(r.summary.current_annualized_cents).toBe(780000); // /52 then *52
    expect(r.summary.givers).toBe(2);
  });

  it('uplift annualizes over a full year even when the period is partial (current year)', () => {
    // Half a year elapsed: pace = total/26, but the uplift still uses 52 weeks.
    const r = computeGivingBands([g(1300)], { freq: 'weekly', periodsElapsed: 26, upliftCents: 1000 });
    const band = r.bands.find(b => b.n > 0);
    expect(band.avg_per_period_cents).toBe(5000);  // $1,300 / 26 wk = $50/wk pace
    expect(band.uplift_annual_cents).toBe(52000);  // +$10/wk × 52, not × 26
  });

  it('uses monthly floors and cadence in monthly mode', () => {
    // $600/yr = $50/mo → the $0–99/mo band; +$40/mo × 12 = $480/yr
    const r = computeGivingBands([g(600)], { freq: 'monthly', periodsElapsed: 12, upliftCents: 4000 });
    const band = r.bands.find(b => b.n > 0);
    expect(band.low_cents).toBe(0);
    expect(band.high_cents).toBe(10000); // < $100/mo
    expect(band.avg_per_period_cents).toBe(5000); // $50/mo
    expect(band.uplift_annual_cents).toBe(4000 * 12);
  });

  it('puts very large givers in the open-ended top band', () => {
    const r = computeGivingBands([g(52000)], { freq: 'weekly', periodsElapsed: 52, upliftCents: 0 });
    const top = r.bands[r.bands.length - 1];
    expect(top.high_cents).toBeNull();
    expect(top.low_cents).toBe(GIVING_BAND_FLOORS_WEEKLY_CENTS[GIVING_BAND_FLOORS_WEEKLY_CENTS.length - 1]); // $500/wk
    expect(top.n).toBe(1); // $52,000/52 = $1,000/wk
  });

  it('ignores zero/negative totals', () => {
    const r = computeGivingBands([g(2600), g(0), { total_cents: -500 }], { freq: 'weekly', periodsElapsed: 52, upliftCents: 1000 });
    expect(r.summary.givers).toBe(1);
  });

  it('distributes multiple givers across the right bands', () => {
    // three at ~$25/wk, two at ~$100/wk
    const rows = [g(1300), g(1300), g(1300), g(5200), g(5200)];
    const r = computeGivingBands(rows, { freq: 'weekly', periodsElapsed: 52, upliftCents: 1000 });
    const b25  = r.bands.find(b => b.low_cents === 2500);
    const b100 = r.bands.find(b => b.low_cents === 10000);
    expect(b25.n).toBe(3);
    expect(b100.n).toBe(2);
    expect(r.summary.givers).toBe(5);
    // total uplift = 5 households × $10/wk × 52 = $2,600
    expect(r.summary.uplift_annual_cents).toBe(5 * 1000 * 52);
  });
});
