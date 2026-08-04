import { describe, it, expect } from 'vitest';
import { HTML_HEAD } from '../src/frontend/html-head.js';

// MOB3 (2026-08-04). The stylesheet had ELEVEN max-width breakpoints — 480/520/600/700/720/767/
// 800/820/900/1000/1100 — each added for one feature. Nothing was broken by that, but layouts
// switched at inconsistent widths as a device rotated, and there was no shared definition of
// "phone" for new responsive work to target. Consolidated to three.
//
// This test is the thing that keeps it at three. Without it the count creeps back up one
// feature at a time, exactly as it did the first time.

const STYLE = HTML_HEAD.slice(0, HTML_HEAD.indexOf('</style>'));
const TIERS = [767, 900, 1100];

const widths = [...STYLE.matchAll(/@media ?\(max-width: ?(\d+)px\)/g)].map((m) => Number(m[1]));

describe('MOB3 — three breakpoints, and only three', () => {
  it('uses no max-width outside the agreed tiers', () => {
    const stray = [...new Set(widths)].filter((w) => !TIERS.includes(w)).sort((a, b) => a - b);
    expect(stray, 'add responsive CSS at 767/900/1100 — do not invent a fourth tier').toEqual([]);
  });

  it('still actually has responsive rules at each tier', () => {
    for (const t of TIERS) {
      expect(widths.filter((w) => w === t).length, t + 'px').toBeGreaterThan(0);
    }
  });

  it('documents the tiers in the stylesheet itself', () => {
    // So the next person adding a media query sees the rule before writing a fourth one.
    expect(STYLE).toContain('RESPONSIVE BREAKPOINTS');
    for (const t of TIERS) expect(STYLE).toContain('max-width:' + t + 'px');
  });
});

describe('MOB3 — consolidation did not change which rule wins', () => {
  // Blocks were rewritten in place rather than merged, precisely so source order is untouched.
  // These spot-check the fixes made earlier in the same session, which all depend on placement.
  it('keeps the mobile pagination override after its base rule', () => {
    const base = STYLE.indexOf('.ppl-list-col{flex:1');
    const override = STYLE.lastIndexOf('.ppl-list-col{overflow:visible');
    expect(base).toBeGreaterThan(-1);
    expect(override).toBeGreaterThan(base);
  });

  it('keeps the MOB1 16px rule last', () => {
    const zoom = STYLE.indexOf('font-size:16px!important');
    expect(zoom).toBeGreaterThan(-1);
    // Nothing responsive may follow it, or an later same-specificity rule could undo it.
    const after = [...STYLE.slice(zoom).matchAll(/@media ?\(max-width: ?\d+px\)/g)];
    expect(after.length).toBe(0);
  });

  it('still hides the desktop people grids on phones', () => {
    expect(STYLE).toMatch(/#p-grid,#p-card-grid[^}]*display:none!important/);
  });
});
