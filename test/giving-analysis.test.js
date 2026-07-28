import { describe, it, expect } from 'vitest';
import { computeGivingDistribution, inflationAdjustCents, CPI_U_ANNUAL } from '../src/api-utils.js';

describe('computeGivingDistribution', () => {
  it('returns zeros for no givers', () => {
    const d = computeGivingDistribution([]);
    expect(d.givers).toBe(0);
    expect(d.total_cents).toBe(0);
    expect(d.mean_cents).toBe(0);
    expect(d.median_cents).toBe(0);
    expect(d.top10_share_pct).toBe(0);
  });

  it('computes mean and median (odd count)', () => {
    // totals: $100, $200, $900 -> mean 400, median 200
    const d = computeGivingDistribution([
      { total_cents: 10000 }, { total_cents: 20000 }, { total_cents: 90000 },
    ]);
    expect(d.givers).toBe(3);
    expect(d.total_cents).toBe(120000);
    expect(d.mean_cents).toBe(40000);
    expect(d.median_cents).toBe(20000);
  });

  it('computes median for an even count as the mid-pair average', () => {
    const d = computeGivingDistribution([
      { total_cents: 10000 }, { total_cents: 20000 },
      { total_cents: 30000 }, { total_cents: 50000 },
    ]);
    expect(d.median_cents).toBe(25000); // (20000+30000)/2
  });

  it('ignores non-positive and non-numeric totals', () => {
    const d = computeGivingDistribution([
      { total_cents: 10000 }, { total_cents: 0 }, { total_cents: -500 }, { total_cents: null },
    ]);
    expect(d.givers).toBe(1);
    expect(d.total_cents).toBe(10000);
  });

  it('top-10% share sums the largest tenth of givers (min 1)', () => {
    const rows = [];
    for (let i = 1; i <= 10; i++) rows.push({ total_cents: i * 10000 }); // 100..1000
    const d = computeGivingDistribution(rows);
    // total = 5500 dollars; top 1 giver = 1000 -> 1000/5500 = 18.18%
    expect(d.top10_givers).toBe(1);
    expect(d.top10_share_pct).toBeCloseTo(18.2, 1);
  });

  it('buckets givers into tiers with giver+total percentages', () => {
    const d = computeGivingDistribution([
      { total_cents: 5000 },    // Under $100
      { total_cents: 150000 },  // $1k tier
      { total_cents: 3000000 }, // $25k+ tier
    ]);
    const under100 = d.tiers.find(t => t.label === 'Under $100');
    expect(under100.givers).toBe(1);
    const top = d.tiers[d.tiers.length - 1];
    expect(top.high_cents).toBeNull();
    expect(top.givers).toBe(1);
    const totalPct = d.tiers.reduce((s, t) => s + t.total_pct, 0);
    expect(totalPct).toBeGreaterThan(99);
    expect(totalPct).toBeLessThan(101);
  });
});

describe('inflationAdjustCents', () => {
  it('scales up prior-year dollars into a later year by CPI ratio', () => {
    // $1000 of 2019 giving in 2024 dollars = 1000 * (313.689/255.657)
    const out = inflationAdjustCents(100000, 2019, 2024);
    expect(out).toBe(Math.round(100000 * (CPI_U_ANNUAL[2024] / CPI_U_ANNUAL[2019])));
    expect(out).toBeGreaterThan(100000);
  });

  it('returns the same year unchanged', () => {
    expect(inflationAdjustCents(50000, 2023, 2023)).toBe(50000);
  });

  it('returns input unchanged when a year has no known CPI', () => {
    expect(inflationAdjustCents(50000, 1990, 2024)).toBe(50000);
    expect(inflationAdjustCents(50000, 2024, 2099)).toBe(50000);
  });
});
