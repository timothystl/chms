import { describe, it, expect } from 'vitest';
import { HTML_HEAD } from '../src/frontend/html-head.js';
import * as tabs from '../src/frontend/html-tabs.js';

// ATT-MOB1 (2026-08-10). Reported from a phone: the This Week attendance card ran off the right
// edge — the 8:00 field filled the screen, 10:45 sat past it, and entering a Sunday meant panning
// the whole page sideways.
//
// The cause is NOT the two-column grid itself. It is that a grid track of `1fr` is really
// `minmax(auto, 1fr)`, and that `auto` minimum is the item's CONTENT-based minimum size. For an
// <input> with no width attribute that minimum comes from its default `size` of 20 characters —
// and .att-input is deliberately 1.65rem (~26px) for thumb-friendly entry, so each field demands
// roughly 300px. Two of them cannot fit a phone, the card refuses to shrink, and the PAGE grows
// instead. `min-width:0` is what lets a fraction actually be a fraction.
//
// These tests assert that mechanism and the conditions that make it bite. There is no layout
// engine here, so the arithmetic below models the declared values rather than measuring a render.

const STYLE = HTML_HEAD.slice(0, HTML_HEAD.indexOf('</style>'));
const MARKUP = tabs.HTML_TABS_1 + tabs.HTML_TABS_2;

/** All @media(max-width:<bp>px) blocks, by brace counting — see mobile-table-scroll.test.js. */
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

/** Every declaration block naming an exact selector, in source order, so we can see who wins. */
function declBlocks(css, selector) {
  const out = [];
  const re = new RegExp('(^|[,{}\\s])' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(,[^{]*)?\\{([^}]*)\\}', 'g');
  let m;
  while ((m = re.exec(css)) !== null) out.push({ body: m[3], index: m.index });
  return out;
}

describe('ATT-MOB1 — the conditions that caused the overflow are still present', () => {
  // If any of these stop being true the fix may no longer be needed — but silently keeping a rule
  // that does nothing is worse than knowing. These pin the premise, not the fix.

  it('really does put both service fields in a two-fraction grid', () => {
    expect(STYLE).toMatch(/\.att-input-grid\{[^}]*grid-template-columns:1fr 1fr/);
  });

  it('really does ship the fields as bare <input>s with no width or size attribute', () => {
    const inputs = [...MARKUP.matchAll(/<input[^>]*class="att-input"[^>]*>/g)].map((m) => m[0]);
    expect(inputs.length, 'expected the 8:00 and 10:45 fields').toBe(2);
    for (const el of inputs) {
      expect(el, 'a size/width attribute would change the minimum this test models').not.toMatch(/\bsize=|\bwidth=/);
    }
  });

  it('really does keep the field font oversized on phones', () => {
    // This is what turns a 20-character default into ~300px. MOB1 restores it on purpose.
    const zoom = mediaBlocks(STYLE, 767).find((b) => /font-size:16px!important/.test(b.text));
    expect(zoom.text).toMatch(/\.att-input\{font-size:1\.65rem!important/);
  });

  it('shows the pair could not fit a phone without min-width:0', () => {
    // Arithmetic on the declared values, not a measurement: 20 characters is the HTML default
    // `size`, and a digit in a 26px font is comfortably over 12px wide even before padding.
    const fontPx = 1.65 * 16;
    const perFieldMinPx = 20 * fontPx * 0.5; // ~0.5em per digit is a deliberate UNDER-estimate
    expect(perFieldMinPx * 2).toBeGreaterThan(390); // widest phone in the report
  });
});

describe('ATT-MOB1 — the fix', () => {
  it('opts the entry fields out of the content-based minimum', () => {
    expect(STYLE, 'the whole fix').toMatch(/\.att-input-grid>\*\{[^}]*min-width:0/);
  });

  it('opts the input itself out too', () => {
    expect(STYLE).toMatch(/\.att-input\{[^}]*min-width:0/);
  });

  it('opts the cards out, so the same class of bug cannot widen the page from any other child', () => {
    expect(STYLE).toMatch(/\.att-row2>\*,\.att-row2b>\*\{[^}]*min-width:0/);
  });

  it('is not undone by a later rule on the same selectors', () => {
    // min-width is not shorthand-reachable, so only an explicit later declaration could lose it.
    for (const sel of ['.att-input', '.att-input-grid>*']) {
      const blocks = declBlocks(STYLE, sel).filter((b) => /min-width/.test(b.body));
      expect(blocks.length, sel + ' — a second min-width declaration would decide by order').toBe(1);
      expect(blocks[0].body).toMatch(/min-width:0/);
    }
  });
});

describe('ATT-MOB1 — what the fix deliberately did NOT do', () => {
  it('keeps both fields side by side at every width', () => {
    // Stacking would have fixed the scroll too, but it pushes Combined and Save Sunday down the
    // page — the card exists to enter both numbers and read the total in one glance.
    for (const bp of [767, 900, 1100]) {
      for (const b of mediaBlocks(STYLE, bp)) {
        expect(b.text, bp + 'px stacks the entry fields').not.toMatch(/\.att-input-grid\{[^}]*grid-template-columns:\s*1fr\s*[;}]/);
      }
    }
  });

  it('does not make the entry card a sideways scroller', () => {
    // Panning inside the card is the same problem in a smaller box, not a fix.
    const entry = declBlocks(STYLE, '.att-entry-card').concat(declBlocks(STYLE, '.att-input-grid'));
    for (const b of entry) expect(b.body).not.toMatch(/overflow-x:\s*auto/);
  });

  it('does not shrink the deliberately-large tap target', () => {
    expect(STYLE).toMatch(/\.att-input\{[^}]*height:60px/);
  });

  it('trims phone padding only inside the phone tier', () => {
    const phone = mediaBlocks(STYLE, 767).find((b) => /\.att-panel\{padding/.test(b.text));
    expect(phone, 'phone padding trim missing').toBeDefined();
    // The desktop value must survive outside it.
    expect(STYLE.replace(phone.text, '')).toMatch(/\.att-panel\{[^}]*padding:20px 24px 28px/);
  });

  it('adds no fourth breakpoint and leaves the MOB1 rule last', () => {
    const widths = [...STYLE.matchAll(/@media ?\(max-width: ?(\d+)px\)/g)].map((m) => Number(m[1]));
    expect([...new Set(widths)].filter((w) => ![767, 900, 1100].includes(w))).toEqual([]);
    const zoom = STYLE.indexOf('font-size:16px!important');
    expect([...STYLE.slice(zoom).matchAll(/@media ?\(max-width: ?\d+px\)/g)].length).toBe(0);
  });
});
