import { describe, it, expect } from 'vitest';
import { HTML_HEAD } from '../src/frontend/html-head.js';
import * as tabs from '../src/frontend/html-tabs.js';
import { JS_VOLUNTEERS } from '../src/frontend/js-volunteers.js';

// VOL-MOB1 (2026-08-14). Reported from a phone: the Volunteers tab "doesn't seem like it is
// rendering as native and more like it is in a window."
//
// Measured against the real built app in a browser before writing this: a signup row laid its
// name block and its action cluster side by side in one flex row, and the cluster is
// `flex-shrink:0`, so it pushed ~100px past the card. `.vol-shell` is `overflow:hidden` (it has
// to be — it clips the navy sub-nav to the card's own radius), so that overflow was CLIPPED
// rather than scrollable: Link / Email / Remove were invisible and unreachable on a phone, with
// no scrollbar hinting they existed. That clipping is the "window" the report describes.
//
// The fix could not be a media-query override, because an inline style beats a media query
// (VUX15/MOB1). The row's layout declarations had to MOVE out of the inline attribute onto a
// class first — carried over verbatim so desktop computes identically — and only then can the
// phone rule stack them.
//
// There is no layout engine here, so these assert the mechanism and the declarations rather than
// measuring a render.

const STYLE = HTML_HEAD.slice(0, HTML_HEAD.indexOf('</style>'));
const MARKUP = tabs.HTML_TABS_1 + tabs.HTML_TABS_2;

/** All @media(max-width:<bp>px) blocks, by brace counting — see attendance-mobile.test.js. */
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
    out.push(css.slice(i, j + 1));
    i = css.indexOf(open, j + 1);
  }
  return out;
}

const PHONE = mediaBlocks(STYLE, 767).join('\n');

/** The declaration body of an exact selector, outside any media block. */
function baseDecl(selector) {
  // strip media blocks so we only see base rules
  let css = STYLE;
  for (const b of mediaBlocks(STYLE, 767).concat(mediaBlocks(STYLE, 900), mediaBlocks(STYLE, 1100))) {
    css = css.replace(b, '');
  }
  const re = new RegExp('(^|[\\n}])\\s*' + selector.replace(/[.#]/g, '\\$&') + '\\s*{([^}]*)}');
  const m = css.match(re);
  return m ? m[2] : null;
}

describe('VOL-MOB1 — signup rows must not be clipped by the shell on a phone', () => {
  it('the shell still clips, which is why the row had to be fixed rather than allowed to overflow', () => {
    // If this ever stops being true the failure mode changes (content would scroll, not vanish),
    // and the reasoning in these tests would need revisiting.
    const shell = MARKUP.match(/class="vol-shell"[^>]*style="([^"]*)"/);
    expect(shell, 'the .vol-shell element should still carry its inline style').not.toBeNull();
    expect(shell[1]).toContain('overflow:hidden');
  });

  it('the renderer emits classes, not inline layout, for the two rows that overflowed', () => {
    expect(JS_VOLUNTEERS).toContain('class="vol-sig-head"');
    expect(JS_VOLUNTEERS).toContain('class="vol-sig-actions"');
    expect(JS_VOLUNTEERS).toContain('class="vol-tpl-row"');
    // The exact inline strings that used to defeat any media query must be gone.
    expect(JS_VOLUNTEERS).not.toContain('display:flex;align-items:flex-start;justify-content:space-between;gap:10px;');
    expect(JS_VOLUNTEERS).not.toContain('gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;');
  });

  it('desktop layout is unchanged — the classes carry the old inline values verbatim', () => {
    const head = baseDecl('.vol-sig-head');
    expect(head).toContain('display:flex');
    expect(head).toContain('align-items:flex-start');
    expect(head).toContain('justify-content:space-between');
    expect(head).toContain('gap:10px');
    const actions = baseDecl('.vol-sig-actions');
    expect(actions).toContain('flex-shrink:0');
    expect(actions).toContain('justify-content:flex-end');
    expect(actions).toContain('gap:6px');
  });

  it('the phone rule stacks both rows so the action buttons stay inside the card', () => {
    expect(PHONE).toMatch(/\.vol-sig-head\s*,\s*\.vol-tpl-row\{[^}]*flex-direction:column/);
    expect(PHONE).toMatch(/\.vol-sig-actions\{[^}]*width:100%/);
    expect(PHONE).toMatch(/\.vol-sig-actions\{[^}]*justify-content:flex-start/);
  });

  it('the identity block can shrink, so a long email cannot push the row wide again', () => {
    expect(baseDecl('.vol-sig-ident')).toContain('min-width:0');
    expect(JS_VOLUNTEERS).toContain('class="vol-sig-ident"');
  });
});

describe('VOL-MOB1 — the tab stops padding twice on a phone', () => {
  it('the wrapper carries its padding on a class, not inline (a media query cannot beat inline)', () => {
    expect(MARKUP).toContain('<div class="vol-tab-wrap">');
    expect(MARKUP).not.toContain('style="padding:16px 20px;max-width:1100px;"');
    const wrap = baseDecl('.vol-tab-wrap');
    expect(wrap).toContain('padding:16px 20px');
    expect(wrap).toContain('max-width:1100px');
  });

  it('phone trims both the panel and the wrapper, so the shell is not inset 44px each side', () => {
    // #id beats .tab-panel, so this needs no !important — assert it is the id that is used.
    expect(PHONE).toMatch(/#tab-volunteers\{padding:[^}]*\}/);
    expect(PHONE).toMatch(/\.vol-tab-wrap\{padding:0/);
    const panelPad = PHONE.match(/#tab-volunteers\{padding:([^;}]*)/)[1];
    const px = panelPad.trim().split(/\s+/).map((v) => parseInt(v, 10));
    expect(Math.max(...px)).toBeLessThan(24); // less than .tab-panel's own 20px 24px
  });
});

describe('VOL-MOB1 — the sub-nav fits a 390px phone instead of scrolling mid-word', () => {
  // Measured in a real browser: at 390px the four items overshot by 4px, so the strip scrolled
  // and clipped "Signups" in half. Tightening padding/gap buys ~28px. Narrower phones still
  // scroll, which is what overflow-x is for — so that must stay.
  it('keeps the horizontal scroll as the fallback for narrower phones', () => {
    expect(PHONE).toMatch(/\.vol-subnav\{[^}]*overflow-x:auto/);
    expect(PHONE).toMatch(/\.vol-subnav\{[^}]*flex-wrap:nowrap/);
  });

  it('is tighter than the desktop rail so 390px fits', () => {
    const sub = PHONE.match(/\.vol-subnav\{([^}]*)\}/)[1];
    const pad = sub.match(/padding:([^;]*)/)[1].trim();
    expect(Math.max(...pad.split(/\s+/).map((v) => parseInt(v, 10)))).toBeLessThanOrEqual(10);
    expect(parseInt(sub.match(/gap:(\d+)/)[1], 10)).toBeLessThanOrEqual(4);
    const btn = PHONE.match(/\.vol-subtab-btn\{([^}]*)\}/)[1];
    expect(btn).toMatch(/padding:8px\b/);
    // the desktop rail is roomier — if these ever converge the phone saving is gone
    expect(baseDecl('.vol-subtab-btn')).toContain('padding:8px 10px');
  });
});
