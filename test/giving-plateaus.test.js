import { describe, it, expect } from 'vitest';
import { computeNudgeOptions, pickImpactPhrase, computeGivingPlateaus } from '../src/api-utils.js';

describe('computeNudgeOptions', () => {
  it('offers a gentler percentage step as the base amount grows — the core fix', () => {
    // A $5/wk giver can reasonably be asked to double ($5→$10, the Generous
    // option); the same %-style ask at $2,500/wk would be +$2,500/wk, which
    // this deliberately avoids — the top tier caps out around +12%.
    const low = computeNudgeOptions(5);
    const high = computeNudgeOptions(2500);
    expect(low.map(o => o.target_dollars)).toEqual([7, 8, 10]);
    expect(low[2].pct_increase).toBe(100); // Generous = the "5→10" case is still available
    expect(high.map(o => o.target_dollars)).toEqual([2600, 2700, 2800]);
    // Every option for the $2,500 giver stays under 15% — nowhere near doubling.
    high.forEach(o => expect(o.pct_increase).toBeLessThan(15));
  });

  it('matches the user-stated examples as one of the three options, not a forced single jump', () => {
    const opts43 = computeNudgeOptions(43);
    const opts83 = computeNudgeOptions(83);
    expect(opts43.map(o => o.target_dollars)).toEqual([50, 56, 66]);
    expect(opts83.map(o => o.target_dollars)).toEqual([95, 100, 115]);
  });

  it('is not thrown off by floating-point noise in the percentage math', () => {
    // 100 * 1.10 === 110.00000000000001 in IEEE 754 — regression guard for
    // the ceil-to-increment step overshooting to the next whole increment.
    expect(computeNudgeOptions(100).map(o => o.target_dollars)).toEqual([110, 120, 140]);
  });

  it('always returns 3 strictly increasing options, each above the base', () => {
    for (const base of [1, 5, 20, 43, 83, 100, 250, 1000, 2500, 10000]) {
      const opts = computeNudgeOptions(base);
      expect(opts.length).toBe(3);
      let prev = base;
      for (const o of opts) {
        expect(o.target_dollars).toBeGreaterThan(prev);
        expect(o.delta_dollars).toBe(o.target_dollars - base);
        prev = o.target_dollars;
      }
    }
  });

  it('returns an empty array for a non-positive base', () => {
    expect(computeNudgeOptions(0)).toEqual([]);
    expect(computeNudgeOptions(-5)).toEqual([]);
  });
});

describe('pickImpactPhrase', () => {
  const statements = [
    { monthly_cents: 1000, label: 'a week of coffee hour supplies' },
    { monthly_cents: 1800, label: 'one more week of Tuition Aid support' },
    { monthly_cents: 5000, label: 'a family food pantry box' },
  ];

  it('picks the richest statement the delta actually clears', () => {
    // monthly_cents thresholds are already in cents — 1800 = $18/mo, matching
    // the user's own "if you gave $18 more a month" example.
    expect(pickImpactPhrase(1800, statements)).toBe('one more week of Tuition Aid support');
    expect(pickImpactPhrase(4999, statements)).toBe('one more week of Tuition Aid support');
    expect(pickImpactPhrase(5000, statements)).toBe('a family food pantry box');
  });

  it('returns null when nothing qualifies or none are configured', () => {
    expect(pickImpactPhrase(500, statements)).toBeNull();
    expect(pickImpactPhrase(999999, [])).toBeNull();
    expect(pickImpactPhrase(999999, null)).toBeNull();
  });

  it('never fabricates a phrase — ignores malformed entries instead of guessing', () => {
    const dirty = [{ monthly_cents: 1000 }, { label: 'no amount' }, { monthly_cents: 0, label: 'zero' }];
    expect(pickImpactPhrase(999999, dirty)).toBeNull();
  });
});

// Helper to build (person, day) rows quickly.
function row(person_id, name, dollars, member_type) {
  return { person_id, name, member_type: member_type || 'member', day_cents: dollars * 100 };
}

describe('computeGivingPlateaus', () => {
  it('finds the modal per-gift amount and attaches 3 nudge options', () => {
    // Alice gives $43 four times, plus one odd $60.
    const rows = [
      row(1, 'Alice A', 43), row(1, 'Alice A', 43), row(1, 'Alice A', 43),
      row(1, 'Alice A', 43), row(1, 'Alice A', 60),
    ];
    const r = computeGivingPlateaus(rows, { minRepeat: 3 });
    expect(r.summary.plateaued_givers).toBe(1);
    const p = r.tiers[0].people[0];
    expect(p.plateau_cents).toBe(4300);
    expect(p.options.map(o => o.target_cents)).toEqual([5000, 5600, 6600]);
    // Primary/tier-grouping fields mirror the Standard (middle) option.
    expect(p.target_cents).toBe(5600);
    expect(p.weekly_increase_cents).toBe(1300);
    // Upside = ($56 − $43) × 5 gifts = $65/yr
    expect(p.upside_annual_cents).toBe(1300 * 5);
  });

  it('screens out givers whose amount does not repeat enough, but keeps them visible as occasional givers', () => {
    // Bob gives 5 different amounts once each — no plateau.
    const rows = [
      row(2, 'Bob B', 20), row(2, 'Bob B', 35), row(2, 'Bob B', 41),
      row(2, 'Bob B', 55), row(2, 'Bob B', 70),
    ];
    const r = computeGivingPlateaus(rows, { minRepeat: 3 });
    expect(r.summary.plateaued_givers).toBe(0);
    expect(r.summary.variable_givers).toBe(1);
    expect(r.tiers.length).toBe(0);
    expect(r.occasional_givers.length).toBe(1);
    expect(r.occasional_givers[0].name).toBe('Bob B');
    expect(r.occasional_givers[0].total_cents).toBe((20+35+41+55+70) * 100);
    expect(r.occasional_givers[0].gifts).toBe(5);
  });

  it('sorts occasional givers by total descending and reports a truncation count', () => {
    const rows = [];
    for (let i = 0; i < 3; i++) rows.push(row(100 + i, 'Small ' + i, 5 + i)); // small one-off gifts
    rows.push(row(200, 'Big One-Timer', 9000));
    const r = computeGivingPlateaus(rows, { minRepeat: 3, occasionalCap: 2 });
    expect(r.occasional_givers_total).toBe(4);
    expect(r.occasional_givers.length).toBe(2);
    expect(r.occasional_givers[0].name).toBe('Big One-Timer');
  });

  it('groups people by their Standard option into tiers', () => {
    const rows = [];
    // 3 people plateau at $43 → Standard tier $56
    for (const id of [1, 2, 3]) for (let k = 0; k < 4; k++) rows.push(row(id, 'P' + id, 43));
    // 2 people plateau at $83 → Standard tier $100
    for (const id of [4, 5]) for (let k = 0; k < 4; k++) rows.push(row(id, 'P' + id, 83));
    const r = computeGivingPlateaus(rows, { minRepeat: 3 });
    expect(r.tiers.length).toBe(2);
    const t56 = r.tiers.find(t => t.target_cents === 5600);
    const t100 = r.tiers.find(t => t.target_cents === 10000);
    expect(t56.num_people).toBe(3);
    expect(t100.num_people).toBe(2);
    // tiers sorted ascending by target
    expect(r.tiers[0].target_cents).toBeLessThan(r.tiers[1].target_cents);
    // Modest/Generous aggregate ranges are present and bracket Standard.
    expect(t56.upside_modest_annual_cents).toBeLessThanOrEqual(t56.upside_annual_cents);
    expect(t56.upside_generous_annual_cents).toBeGreaterThanOrEqual(t56.upside_annual_cents);
  });

  it('aggregates same-day split gifts into one contribution amount (no fund discounted)', () => {
    // Carol gives $30 General + $13 Tuition Aid on each of 3 Sundays — the
    // caller's SQL sums same-day/same-giver rows across every fund before
    // this function ever sees them, so this arrives pre-summed as $43/day.
    const rows = [];
    for (let k = 0; k < 3; k++) rows.push(row(6, 'Carol C', 43));
    const r = computeGivingPlateaus(rows, { minRepeat: 3 });
    expect(r.tiers[0].people[0].plateau_cents).toBe(4300);
  });

  it('tie-breaks the modal amount to the higher value (conservative upside)', () => {
    // Dan: $50 three times, $100 three times → tie, pick $100.
    const rows = [
      row(7, 'Dan D', 50), row(7, 'Dan D', 50), row(7, 'Dan D', 50),
      row(7, 'Dan D', 100), row(7, 'Dan D', 100), row(7, 'Dan D', 100),
    ];
    const r = computeGivingPlateaus(rows, { minRepeat: 3 });
    expect(r.tiers[0].people[0].plateau_cents).toBe(10000);
  });

  it('builds a per-dollar distribution histogram', () => {
    const rows = [];
    for (const id of [1, 2]) for (let k = 0; k < 3; k++) rows.push(row(id, 'P' + id, 43));
    for (let k = 0; k < 3; k++) rows.push(row(3, 'P3', 83));
    const r = computeGivingPlateaus(rows, { minRepeat: 3 });
    expect(r.distribution).toEqual([
      { plateau_dollars: 43, n: 2 },
      { plateau_dollars: 83, n: 1 },
    ]);
  });

  it('defaults link fields to the person when not provided', () => {
    const rows = [row(9, 'Fay F', 50), row(9, 'Fay F', 50), row(9, 'Fay F', 50)];
    const p = computeGivingPlateaus(rows, { minRepeat: 3 }).tiers[0].people[0];
    expect(p.link_kind).toBe('person');
    expect(p.link_id).toBe(9);
  });

  it('carries household link fields through (household scope)', () => {
    const hh = (dollars) => ({ person_id: 'h:12', name: 'Smith Household', link_id: 12, link_kind: 'household', day_cents: dollars * 100 });
    const rows = [hh(83), hh(83), hh(83), hh(120)];
    const r = computeGivingPlateaus(rows, { minRepeat: 3 });
    expect(r.summary.plateaued_givers).toBe(1);
    const p = r.tiers[0].people[0];
    expect(p.name).toBe('Smith Household');
    expect(p.link_kind).toBe('household');
    expect(p.link_id).toBe(12);
    expect(p.plateau_cents).toBe(8300);
  });

  it('ignores zero/negative day totals', () => {
    const rows = [
      row(8, 'Eve E', 43), row(8, 'Eve E', 43), row(8, 'Eve E', 43),
      row(8, 'Eve E', 0), row(8, 'Eve E', -20),
    ];
    const r = computeGivingPlateaus(rows, { minRepeat: 3 });
    const p = r.tiers[0].people[0];
    expect(p.plateau_cents).toBe(4300);
    expect(p.gifts).toBe(3); // the 0 and -20 rows are dropped
  });

  it('attaches an impact phrase to an option when its monthly delta clears a configured statement', () => {
    // $43/wk plateau: Standard option delta is $13/wk → $13*52/12 ≈ $56.33/mo.
    const impactStatements = [{ monthly_cents: 5000, label: 'a week of Food Pantry groceries' }];
    const rows = [row(1, 'Alice A', 43), row(1, 'Alice A', 43), row(1, 'Alice A', 43)];
    const r = computeGivingPlateaus(rows, { minRepeat: 3, impactStatements });
    const standard = r.tiers[0].people[0].options[1];
    expect(standard.impact_text).toBe('a week of Food Pantry groceries');
    // Modest option's smaller delta ($7/wk ≈ $30/mo) doesn't clear the $50/mo threshold.
    expect(r.tiers[0].people[0].options[0].impact_text).toBeNull();
  });

  it('never shows an impact phrase when no statements are configured', () => {
    const rows = [row(1, 'Alice A', 43), row(1, 'Alice A', 43), row(1, 'Alice A', 43)];
    const r = computeGivingPlateaus(rows, { minRepeat: 3 });
    r.tiers[0].people[0].options.forEach(o => expect(o.impact_text).toBeNull());
  });
});
