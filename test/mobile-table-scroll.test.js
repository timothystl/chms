import { describe, it, expect } from 'vitest';
import { HTML_HEAD } from '../src/frontend/html-head.js';
import * as tabs from '../src/frontend/html-tabs.js';
import { JS_REPORTS } from '../src/frontend/js-reports.js';
import { JS_FINANCE } from '../src/frontend/js-finance.js';
import { JS_ATTENDANCE } from '../src/frontend/js-attendance.js';

// MOB2 (2026-08-04). 55 of the app's 99 tables had no horizontal scroll container. A bare wide
// table does not scroll — it widens the PAGE, so the layout shifts and the user can pan the whole
// UI sideways with no way back.
//
// Fixed with one descendant rule rather than 55 markup edits, because 65 of the 99 tables carry
// no CSS class at all (built with inline styles in JS string concat), so a class-targeted rule
// would reach barely a third.

const STYLE = HTML_HEAD.slice(0, HTML_HEAD.indexOf('</style>'));

/** All @media(max-width:<bp>px) blocks, by brace counting — see mobile-input-zoom.test.js. */
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

const blocks = mediaBlocks(STYLE, 767);
const tableBlock = blocks.find((b) => /table[^{]*\{[^}]*overflow-x:auto/.test(b.text));

describe('MOB2 — wide tables scroll on phones', () => {
  it('has a phone-scoped rule making tables their own scroll container', () => {
    expect(tableBlock, 'no 767px block sets overflow-x on tables').toBeDefined();
    expect(tableBlock.text).toMatch(/display:block/);
    expect(tableBlock.text).toMatch(/overflow-x:auto/);
  });

  it('reaches tables regardless of class, since 65 of 99 have none', () => {
    // A class-targeted rule would miss two thirds of them. Must be a descendant selector.
    expect(tableBlock.text).toMatch(/\.content-area table/);
    expect(tableBlock.text).toMatch(/\.modal table/);
  });

  it('covers the containers tables actually live in', () => {
    // .content-area holds the tab panels, profile view and household/organization views; modals
    // are position:fixed and sit outside it.
    for (const sel of ['.content-area', '.modal']) expect(tableBlock.text).toContain(sel);
  });

  it('excludes .dir-table, whose sticky header display:block would defeat', () => {
    expect(tableBlock.text).toMatch(/:not\(\.dir-table\)/);
    // Confirm the premise: that table really does use a sticky header.
    expect(STYLE).toMatch(/\.dir-table th\{[^}]*position:sticky/);
  });

  it('changes nothing on desktop', () => {
    const base = STYLE.replace(tableBlock.text, '');
    expect(base).not.toMatch(/\.content-area table/);
  });

  it('does not force nowrap, so a table that can fit still fits', () => {
    expect(tableBlock.text).not.toMatch(/white-space:nowrap/);
  });
});

describe('MOB2 — the problem it fixes was real and is now covered', () => {
  const bareCount = (src) => {
    let bare = 0;
    for (const m of src.matchAll(/<table/g)) {
      const before = src.slice(Math.max(0, m.index - 260), m.index);
      if (!/overflow-x: ?auto/.test(before)) bare++;
    }
    return bare;
  };

  it('confirms many tables still ship with no wrapper of their own', () => {
    // The rule is what protects these; the markup was deliberately not edited.
    const total = bareCount(JS_REPORTS) + bareCount(JS_FINANCE) + bareCount(JS_ATTENDANCE);
    expect(total, 'if this hits 0 the CSS rule may no longer be needed').toBeGreaterThan(20);
  });

  it('confirms most tables carry no class for a rule to target', () => {
    const src = JS_REPORTS + JS_FINANCE + JS_ATTENDANCE + tabs.HTML_TABS_1 + tabs.HTML_TABS_2;
    let noClass = 0, withClass = 0;
    for (const m of src.matchAll(/<table([^>]*)>/g)) {
      (/class="/.test(m[1]) ? (withClass++) : (noClass++));
    }
    expect(noClass).toBeGreaterThan(withClass);
  });
});

describe('MOB2 — why placement is NOT load-bearing here, unlike MOB1', () => {
  // Worth stating explicitly, because the instinct after v1.121.4 is "put it last or it loses".
  // That mattered there because the override and its base rule had EQUAL specificity, so source
  // order decided. Here the only base rule touching overflow on a table selector is
  // `.reg-table{overflow:hidden}` — one class, specificity (0,1,0) — while this rule is
  // `.content-area table`, a class plus an element, (0,1,1). Higher specificity wins regardless
  // of order. Asserting an ordering constraint that does not exist would be a test that passes
  // for no reason; these assert the actual mechanism instead.
  it('is the only rule setting overflow on a table, apart from .reg-table', () => {
    const overflowOnTables = [...STYLE.matchAll(/([^{};@\/*\n]*table[^{\n]*)\{([^}]*)\}/g)]
      .filter((m) => /(?:^|;)\s*overflow/.test(m[2]))
      .map((m) => m[1].trim());
    expect(overflowOnTables).toContain('.reg-table');
  });

  it('out-specifies .reg-table, so its overflow:hidden cannot win on the x axis', () => {
    // class + element beats class alone. If this selector is ever narrowed to a bare class,
    // .reg-table would start winning again depending on order — hence the check.
    expect(tableBlock.text).toMatch(/\.content-area table/);
    expect(STYLE).toMatch(/\.reg-table\{[^}]*overflow:hidden/);
  });

  it('does not displace the MOB1 zoom rule from last position', () => {
    const zoom = blocks.find((b) => /font-size:16px!important/.test(b.text));
    expect(zoom).toBeDefined();
    expect(zoom.index).toBeGreaterThan(tableBlock.index);
  });
});
