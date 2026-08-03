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

const MOBILE_BLOCK = (() => {
  const m = HTML_HEAD.match(/@media\(max-width:767px\)\{[\s\S]*?\n\}/);
  return m ? m[0] : '';
})();

/** The declarations for `selector` within a CSS chunk, or '' if the rule isn't there. */
function ruleFor(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(esc + '\\{([^}]*)\\}'));
  return m ? m[1] : '';
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

describe('mobile People pagination is reachable', () => {
  it('finds the 767px block at all', () => {
    expect(MOBILE_BLOCK).not.toBe('');
  });

  it('stops .ppl-master-detail claiming vertical space it has no content for', () => {
    expect(ruleFor(MOBILE_BLOCK, '.ppl-master-detail')).toContain('flex:0 0 auto');
  });

  it('stops .ppl-list-col clipping the pager out of existence', () => {
    // This is the declaration that actually made the button unreachable.
    expect(ruleFor(MOBILE_BLOCK, '.ppl-list-col')).toContain('overflow:visible');
  });

  it('orders the pager after the list, so it reads as pagination not a header', () => {
    expect(ruleFor(MOBILE_BLOCK, '.contact-list')).toContain('order:1');
    expect(ruleFor(MOBILE_BLOCK, '.ppl-master-detail')).toContain('order:2');
  });

  it('keeps the mobile list from being shrunk by a competing flex sibling', () => {
    expect(ruleFor(MOBILE_BLOCK, '.contact-list')).toContain('flex:0 0 auto');
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
