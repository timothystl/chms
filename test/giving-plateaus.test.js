import { describe, it, expect } from 'vitest';
import { givingNudgeTarget, computeGivingPlateaus } from '../src/api-utils.js';

describe('givingNudgeTarget', () => {
  it('matches the user-stated examples: 43→50, 83→100', () => {
    expect(givingNudgeTarget(43)).toBe(50);
    expect(givingNudgeTarget(83)).toBe(100);
  });

  it('always steps to the next clean rung strictly above the plateau', () => {
    expect(givingNudgeTarget(25)).toBe(30);   // already clean → next rung up
    expect(givingNudgeTarget(50)).toBe(60);
    expect(givingNudgeTarget(100)).toBe(125);
    expect(givingNudgeTarget(47)).toBe(50);
    expect(givingNudgeTarget(1)).toBe(10);
  });

  it('rounds up to the next $1,000 above the top ladder rung', () => {
    expect(givingNudgeTarget(5000)).toBe(6000);
    expect(givingNudgeTarget(5400)).toBe(6000);
    expect(givingNudgeTarget(6000)).toBe(7000);
  });
});

// Helper to build (person, day) rows quickly.
function row(person_id, name, dollars, member_type) {
  return { person_id, name, member_type: member_type || 'member', day_cents: dollars * 100 };
}

describe('computeGivingPlateaus', () => {
  it('finds the modal per-gift amount and nudges it to the next rung', () => {
    // Alice gives $43 four times, plus one odd $60.
    const rows = [
      row(1, 'Alice A', 43), row(1, 'Alice A', 43), row(1, 'Alice A', 43),
      row(1, 'Alice A', 43), row(1, 'Alice A', 60),
    ];
    const r = computeGivingPlateaus(rows, { minRepeat: 3 });
    expect(r.summary.plateaued_givers).toBe(1);
    const p = r.tiers[0].people[0];
    expect(p.plateau_cents).toBe(4300);
    expect(p.target_cents).toBe(5000);
    // Upside = ($50 − $43) × 5 gifts = $35/yr
    expect(p.upside_annual_cents).toBe(7 * 100 * 5);
    expect(r.summary.total_upside_annual_cents).toBe(3500);
  });

  it('screens out givers whose amount does not repeat enough', () => {
    // Bob gives 5 different amounts once each — no plateau.
    const rows = [
      row(2, 'Bob B', 20), row(2, 'Bob B', 35), row(2, 'Bob B', 41),
      row(2, 'Bob B', 55), row(2, 'Bob B', 70),
    ];
    const r = computeGivingPlateaus(rows, { minRepeat: 3 });
    expect(r.summary.plateaued_givers).toBe(0);
    expect(r.summary.variable_givers).toBe(1);
    expect(r.tiers.length).toBe(0);
  });

  it('groups people by nudge target into tiers', () => {
    const rows = [];
    // 3 people plateau at $43 → tier $50
    for (const id of [1, 2, 3]) for (let k = 0; k < 4; k++) rows.push(row(id, 'P' + id, 43));
    // 2 people plateau at $83 → tier $100
    for (const id of [4, 5]) for (let k = 0; k < 4; k++) rows.push(row(id, 'P' + id, 83));
    const r = computeGivingPlateaus(rows, { minRepeat: 3 });
    expect(r.tiers.length).toBe(2);
    const t50 = r.tiers.find(t => t.target_cents === 5000);
    const t100 = r.tiers.find(t => t.target_cents === 10000);
    expect(t50.num_people).toBe(3);
    expect(t100.num_people).toBe(2);
    // $50 tier upside: ($50−$43)×4 gifts × 3 people = $84
    expect(t50.upside_annual_cents).toBe(7 * 100 * 4 * 3);
    // $100 tier upside: ($100−$83)×4 gifts × 2 people = $136
    expect(t100.upside_annual_cents).toBe(17 * 100 * 4 * 2);
    // tiers sorted ascending by target
    expect(r.tiers[0].target_cents).toBeLessThan(r.tiers[1].target_cents);
  });

  it('aggregates same-day split gifts into one contribution amount', () => {
    // Carol gives $30 + $13 to two funds on each of 3 Sundays = $43/day plateau.
    const rows = [];
    for (let k = 0; k < 3; k++) {
      // The endpoint SUMs per (person, day), so the test provides the pre-summed day total.
      rows.push(row(6, 'Carol C', 43));
    }
    const r = computeGivingPlateaus(rows, { minRepeat: 3 });
    expect(r.tiers[0].people[0].plateau_cents).toBe(4300);
    expect(r.tiers[0].people[0].target_cents).toBe(5000);
  });

  it('tie-breaks the modal amount to the higher value (conservative upside)', () => {
    // Dan: $50 three times, $100 three times → tie, pick $100 (smaller nudge delta).
    const rows = [
      row(7, 'Dan D', 50), row(7, 'Dan D', 50), row(7, 'Dan D', 50),
      row(7, 'Dan D', 100), row(7, 'Dan D', 100), row(7, 'Dan D', 100),
    ];
    const r = computeGivingPlateaus(rows, { minRepeat: 3 });
    expect(r.tiers[0].people[0].plateau_cents).toBe(10000);
    expect(r.tiers[0].people[0].target_cents).toBe(12500);
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
    // Two spouses' combined household contribution: caller pre-sums per
    // (household, day) and tags the rows with the household link target.
    const hh = (dollars) => ({ person_id: 'h:12', name: 'Smith Household', link_id: 12, link_kind: 'household', day_cents: dollars * 100 });
    const rows = [hh(83), hh(83), hh(83), hh(120)];
    const r = computeGivingPlateaus(rows, { minRepeat: 3 });
    expect(r.summary.plateaued_givers).toBe(1);
    const p = r.tiers[0].people[0];
    expect(p.name).toBe('Smith Household');
    expect(p.link_kind).toBe('household');
    expect(p.link_id).toBe(12);
    expect(p.plateau_cents).toBe(8300);
    expect(p.target_cents).toBe(10000);
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
});
