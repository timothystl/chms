import { describe, it, expect } from 'vitest';
import { HTML_HEAD } from '../src/frontend/html-head.js';
import { HTML_TABS_1 } from '../src/frontend/html-tabs.js';

// Reported 2026-08-03: on a phone the People list stopped at the C names with no next-page
// button. The list was fine — it was a full first page of 25 — but the pager was gone.
//
// Mechanism: #p-pager lives inside .ppl-list-col > .ppl-master-detail, while the mobile list
// (.contact-list) is a SIBLING of .ppl-master-detail. Under 767px, #p-grid and #p-card-grid are
// display:none, so the master-detail subtree holds nothing visible but the pager — yet still
// claimed flex:1. With a full page of contact cards already overflowing the tab panel there was
// no free space to grow into, so it collapsed to zero height and .ppl-list-col's overflow:hidden
// clipped the pager away. A phone user could never reach page 2.

/**
 * All @media(max-width:<bp>px) blocks, extracted by counting braces.
 *
 * A regex cannot do this. The obvious `[\s\S]*?\n\}` fails on single-line blocks: it matches the
 * opening one, finds no line-starting `}` inside it, and runs on for hundreds of lines to the
 * next one — swallowing unrelated base rules. That silently made an earlier version of these
 * tests read the wrong CSS entirely (it found a base `width:56px` rule and reported it as the
 * mobile override). MOB3's breakpoint consolidation is what exposed it, by putting a single-line
 * block and a multi-line block on the same breakpoint for the first time.
 */
function mediaBlocks(css, bp) {
  const open = '@media(max-width:' + bp + 'px){';
  const out = [];
  let i = css.indexOf(open);
  while (i !== -1) {
    let depth = 0, j = i + open.length - 1;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}' && --depth === 0) break;
    }
    out.push({ text: css.slice(i, j + 1), index: i });
    i = css.indexOf(open, j + 1);
  }
  return out;
}

// MOB3 consolidated eleven breakpoints into three, so there are now many 767px blocks rather
// than one. Pick the block that actually carries the mobile contact-card rules — matching
// merely the FIRST would silently test the wrong one.
const MOBILE_BLOCK = (mediaBlocks(HTML_HEAD, 767)
  .find((b) => /#p-grid,#p-card-grid/.test(b.text)) || { text: '' }).text;

/** The declarations for `selector` within a CSS chunk, or '' if the rule isn't there. */
function ruleFor(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(esc + '\\{([^}]*)\\}'));
  return m ? m[1] : '';
}

/**
 * Which declaration actually WINS for `prop` on `selector`, honouring source order.
 *
 * This exists because the first version of this fix shipped broken and the tests still passed.
 * They asserted the override was *present in a media block* and that the base rule was
 * *present outside it* — both true, and both irrelevant, because the base rule came LATER in
 * the stylesheet. A media query adds no specificity, so the later base rule won and the
 * override did nothing. Presence is not effect; only source order decides between two
 * same-specificity rules.
 */
function winningDecl(selector, prop) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc + '\\{([^}]*)\\}', 'g');
  let m, winner = null;
  while ((m = re.exec(HTML_HEAD)) !== null) {
    const d = m[1].match(new RegExp('(?:^|;)\\s*' + prop + '\\s*:([^;]*)'));
    if (d) winner = d[1].trim(); // later match overwrites — mirrors the cascade
  }
  return winner;
}

describe('DOM assumption the fix depends on', () => {
  it('has the mobile contact list as a SIBLING of .ppl-master-detail, not a child', () => {
    const md = HTML_TABS_1.indexOf('class="ppl-master-detail"');
    const cl = HTML_TABS_1.indexOf('id="p-contact-list"');
    const pager = HTML_TABS_1.indexOf('id="p-pager"');
    expect(md).toBeGreaterThan(-1);
    expect(cl).toBeGreaterThan(-1);
    // The pager sits inside the master-detail subtree; the mobile list comes after it entirely.
    expect(pager).toBeGreaterThan(md);
    expect(cl).toBeGreaterThan(pager);
  });
});

describe('mobile People pagination actually wins the cascade', () => {
  // These assert the WINNING declaration, not merely that a rule exists somewhere. The
  // presence-only version of these tests passed against a completely broken fix.
  it('finds the 767px block at all', () => {
    expect(MOBILE_BLOCK).not.toBe('');
  });

  it('stops .ppl-master-detail claiming vertical space it has no content for', () => {
    expect(winningDecl('.ppl-master-detail', 'flex')).toBe('0 0 auto');
  });

  it('stops .ppl-list-col clipping the pager out of existence', () => {
    // The single declaration that made the button unreachable.
    expect(winningDecl('.ppl-list-col', 'overflow')).toBe('visible');
  });

  it('orders the pager after the list, so it reads as pagination not a header', () => {
    expect(winningDecl('.contact-list', 'order')).toBe('1');
    expect(winningDecl('.ppl-master-detail', 'order')).toBe('2');
  });

  it('keeps the mobile list from being shrunk by a competing flex sibling', () => {
    expect(winningDecl('.contact-list', 'flex')).toBe('0 0 auto');
  });

  it('places both overrides after the base rules they have to beat', () => {
    // The specific defect that shipped: a media query adds no specificity, so an override
    // written before the base rule loses outright.
    for (const sel of ['.ppl-master-detail', '.ppl-list-col']) {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const positions = [...HTML_HEAD.matchAll(new RegExp(esc + '\\{', 'g'))].map((m) => m.index);
      expect(positions.length, sel + ' should have a base rule and an override').toBeGreaterThan(1);
      const baseIdx = HTML_HEAD.indexOf(sel + '{flex:1');
      const overrideIdx = Math.max(...positions);
      if (baseIdx > -1) expect(overrideIdx, sel).toBeGreaterThan(baseIdx);
    }
  });
});

describe('the fix targets only selectors that can actually win', () => {
  // #p-pager carries an inline justify-content/padding. An inline style beats a media-query
  // rule, so a #p-pager rule here would be silently dead — the VUX15 bug, and the reason CR4
  // tracks inline styles as a blocker for systematic mobile work. Assert we didn't add one.
  it('adds no #p-pager rule that an inline style would defeat', () => {
    expect(MOBILE_BLOCK).not.toMatch(/#p-pager\{/);
  });

  it('confirms #p-pager really does carry the conflicting inline style', () => {
    const tag = HTML_TABS_1.match(/<div id="p-pager"[^>]*>/)[0];
    expect(tag).toContain('style=');
    expect(tag).toMatch(/justify-content:center/);
  });
});

describe('desktop layout is untouched', () => {
  // The base rules live outside the media query and must keep their original values, or the
  // desktop master-detail stops working.
  const base = HTML_HEAD.replace(MOBILE_BLOCK, '');
  // Base rules must still declare the desktop values; the mobile block overrides them later.

  it('keeps .ppl-master-detail at flex:1 outside the mobile block', () => {
    expect(ruleFor(base, '.ppl-master-detail')).toContain('flex:1');
  });

  it('keeps .ppl-list-col clipping outside the mobile block', () => {
    expect(ruleFor(base, '.ppl-list-col')).toContain('overflow:hidden');
  });

  it('still hides the desktop grids on mobile', () => {
    expect(MOBILE_BLOCK).toMatch(/#p-grid,#p-card-grid[^}]*display:none!important/);
  });
});
