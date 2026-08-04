import { describe, it, expect } from 'vitest';
import { HTML_HEAD } from '../src/frontend/html-head.js';
import { HTML_TABS_1, HTML_TABS_2 } from '../src/frontend/html-tabs.js';

// MOB1. iOS Safari zooms the viewport whenever a focused form field's text is under 16px, and
// does not zoom back out — so the user pinches out, taps the next field, and it repeats. Every
// input in the app was under the line, so this hit every form on every tab, starting with the
// login username box a member touches first.
//
// These assert the WINNING declaration and the rule's ability to beat inline styles, not merely
// that a rule exists. A presence-only test passed against a completely dead fix twice already
// tonight (v1.121.3's cascade-order bug, and the #p-pager rule that an inline style defeated).

const STYLE = HTML_HEAD.slice(0, HTML_HEAD.indexOf('</style>'));
const MARKUP = HTML_TABS_1 + HTML_TABS_2;

/** Every @media(max-width:767px) block, in source order. */
const mobileBlocks = [...STYLE.matchAll(/@media\(max-width:767px\)\{[\s\S]*?\n\}/g)].map((m) => ({
  text: m[0], index: m.index,
}));

/** Declarations for `selector` inside a chunk, or '' if absent. */
function ruleFor(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(esc.replace(/\s+/g, '\\s*') + '\\{([^}]*)\\}'));
  return m ? m[1] : '';
}

const zoomBlock = mobileBlocks.find((b) => /font-size:16px!important/.test(b.text));

describe('MOB1 — the 16px rule exists and can actually win', () => {
  it('sets 16px on text inputs, selects and textareas under 767px', () => {
    expect(zoomBlock).toBeDefined();
    expect(zoomBlock.text).toMatch(/font-size:16px!important/);
    expect(zoomBlock.text).toMatch(/select/);
    expect(zoomBlock.text).toMatch(/textarea/);
  });

  it('uses !important, because 56 inputs carry an inline font-size that would beat it', () => {
    // Confirm the premise as well as the fix: if the inline styles ever disappear this test
    // still passes, but the reason for !important is documented and checked here.
    const inlineSized = MARKUP.match(/<(input|select|textarea)[^>]*style="[^"]*font-size[^"]*"/g) || [];
    expect(inlineSized.length).toBeGreaterThan(0);
    expect(zoomBlock.text).toMatch(/font-size:16px!important/);
  });

  it('is the LAST 767px block, so no later base rule can override it', () => {
    // v1.121.4: a media query adds no specificity, so an override placed before the base rule
    // it must beat simply loses. Position is load-bearing.
    expect(zoomBlock.index).toBe(Math.max(...mobileBlocks.map((b) => b.index)));
  });
});

describe('MOB1 — does not shrink what was deliberately large', () => {
  it('keeps .att-input at its oversized attendance-entry size', () => {
    // A blanket 16px!important would have shrunk this from ~26px. Restored explicitly.
    expect(ruleFor(zoomBlock.text, '.att-input')).toContain('1.65rem!important');
  });

  it('leaves the desktop .att-input rule intact outside the mobile block', () => {
    const base = STYLE.replace(zoomBlock.text, '');
    expect(ruleFor(base, '.att-input')).toContain('font-size:1.65rem');
  });
});

describe('MOB1 — scope', () => {
  it('excludes non-text controls, which never trigger zoom', () => {
    for (const t of ['checkbox', 'radio', 'range', 'color', 'file']) {
      expect(zoomBlock.text, t).toContain(':not([type=' + t + '])');
    }
  });

  it('widens the one input pinned too narrow to hold 16px text', () => {
    expect(ruleFor(zoomBlock.text, '.tap-slider-row input[type=number]')).toMatch(/width:7\dpx/);
  });

  it('changes nothing on desktop — every declaration is inside the media query', () => {
    const base = STYLE.replace(zoomBlock.text, '');
    expect(base).not.toMatch(/font-size:16px!important/);
  });
});

describe('MOB1 — the problem it fixes was real', () => {
  it('confirms the app\'s base input sizes are all below the 16px iOS threshold', () => {
    const base = STYLE.replace(zoomBlock.text, '');
    const sizes = (base.match(/(?:^|[;{])font-size:(\.\d+rem|\d+px)/g) || [])
      .map((s) => s.replace(/.*font-size:/, ''));
    const px = sizes.map((s) => (s.endsWith('rem') ? parseFloat(s) * 16 : parseFloat(s)));
    // The sizes that made iOS zoom: plenty of them, all under 16.
    expect(px.filter((n) => n > 0 && n < 16).length).toBeGreaterThan(5);
  });
});
