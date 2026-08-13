import { describe, it, expect } from 'vitest';
import { HTML_HEAD } from '../src/frontend/html-head.js';
import { HTML_TABS_1 } from '../src/frontend/html-tabs.js';
import { JS_PEOPLE } from '../src/frontend/js-people.js';

// Phase C of the mobile scope (2026-08-04): the first pass aimed at what a phone user actually
// needs on Dashboard and People, rather than at defects. MOB1–MOB4 stopped things being broken;
// this is about them being usable.
//
// Deliberately NOT redone here, because it already worked: the person profile stacks and swaps
// its side rail for a dropdown at 900px, the People list becomes contact cards at 767px, and
// tapping one opens the full profile — a better mobile answer than the quickview panel, which
// stays hidden.

const STYLE = HTML_HEAD.slice(0, HTML_HEAD.indexOf('</style>'));

/** All @media(max-width:<bp>px) blocks, by brace counting (a regex mishandles single-line ones). */
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
const phoneBlock = blocks.find((b) => /#tab-people \.toolbar\{/.test(b.text));

/** The declaration that WINS for `prop` on `selector`, honoring source order. */
function winningDecl(selector, prop) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc + '\\{([^}]*)\\}', 'g');
  let m, winner = null;
  while ((m = re.exec(STYLE)) !== null) {
    const d = m[1].match(new RegExp('(?:^|;)\\s*' + prop + '\\s*:([^;]*)'));
    if (d) winner = d[1].trim();
  }
  return winner;
}

describe('People — search stays reachable', () => {
  it('makes the People toolbar sticky on phones', () => {
    expect(phoneBlock, 'no 767px block styles #tab-people .toolbar').toBeDefined();
    const m = phoneBlock.text.match(/#tab-people \.toolbar\{([^}]*)\}/);
    expect(m[1]).toMatch(/position:sticky/);
    expect(m[1]).toMatch(/top:0/);
  });

  it('gives it a background, or list cards would show through as they scroll under', () => {
    const m = phoneBlock.text.match(/#tab-people \.toolbar\{([^}]*)\}/);
    expect(m[1]).toMatch(/background:/);
  });

  it('is scoped to People, not every tab that uses .toolbar', () => {
    // The same bar appears on Households, Giving and others; this pass is chartered for two
    // screens, so it must not silently restyle the rest.
    //
    // Matching has to respect selector boundaries: a naive /\.toolbar\{/ also matches
    // "#tab-people .toolbar{", so it would find our own scoped rule and report the opposite of
    // the truth. Collect every rule whose selector list mentions .toolbar, then check the ones
    // that are BARE.
    const bare = [...STYLE.matchAll(/(?:^|[}\n;])([^{}\n]*\.toolbar[^{}\n]*)\{([^}]*)\}/g)]
      .filter((m) => m[1].split(',').some((sel) => sel.trim() === '.toolbar'));
    expect(bare.length, 'expected a base .toolbar rule to exist').toBeGreaterThan(0);
    for (const m of bare) expect(m[2], m[1]).not.toMatch(/position:sticky/);

    // ...and confirm the scoped one is the only place sticky is applied.
    const sticky = [...STYLE.matchAll(/([^{}\n]*\.toolbar[^{}\n]*)\{([^}]*position:sticky[^}]*)\}/g)];
    expect(sticky.length).toBe(1);
    expect(sticky[0][1].trim()).toBe('#tab-people .toolbar');
  });

  it('leaves the desktop toolbar alone', () => {
    const base = STYLE.replace(phoneBlock.text, '');
    expect(base).not.toMatch(/#tab-people \.toolbar\{/);
  });
});

describe('People — result count visible without scrolling to the bottom', () => {
  it('has a phone-only count element in the markup', () => {
    expect(HTML_TABS_1).toContain('id="p-count-mobile"');
  });

  it('is hidden on desktop and shown on phones', () => {
    // The pager already shows the count on desktop; duplicating it there is noise.
    expect(winningDecl('#p-count-mobile', 'display')).toBe('block'); // last decl = the phone one
    const base = STYLE.replace(phoneBlock.text, '');
    expect(base).toMatch(/#p-count-mobile\{display:none;\}/);
  });

  it('is fed by the same function that renders the pager, so the two cannot disagree', () => {
    const fn = JS_PEOPLE.slice(JS_PEOPLE.indexOf('function renderPeoplePager'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('p-count-mobile');
    expect(body).toMatch(/total/);
  });

  it('singularises one result and blanks at zero', () => {
    const fn = JS_PEOPLE.slice(JS_PEOPLE.indexOf('function renderPeoplePager'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/'1 person'/);
    expect(body).toMatch(/' people'/);
  });
});

describe('Dashboard — density on a phone', () => {
  const decl = (sel) => (phoneBlock.text.match(new RegExp(sel.replace(/[.]/g, '\\.') + '\\{([^}]*)\\}')) || [, ''])[1];

  it('tightens the grid gaps that were tuned for a 1440px desktop', () => {
    expect(decl('.dash-stats')).toMatch(/gap:1?\dpx/);
    expect(decl('.dash-row')).toMatch(/gap:1?\dpx/);
  });

  it('tightens card padding', () => {
    expect(decl('.dash-stat')).toMatch(/padding:/);
    expect(decl('.dash-card-hdr')).toMatch(/padding:/);
  });

  it('keeps stat tiles 2-up rather than collapsing to one column', () => {
    // 1-up would be legible but turns four numbers into four screens of scrolling.
    expect(winningDecl('.dash-stats', 'grid-template-columns')).toMatch(/1fr 1fr|repeat\(2/);
  });

  it('collapses the nested 2x2 tile grid, unreadable at ~85px a cell', () => {
    expect(decl('.dash-stat-quad-grid')).toMatch(/grid-template-columns:1fr/);
  });

  it('changes nothing on desktop', () => {
    const base = STYLE.replace(phoneBlock.text, '');
    expect(base).toMatch(/\.dash-stats\{[^}]*gap:20px/);       // original desktop gap intact
    expect(base).toMatch(/\.dash-stat-val\{[^}]*font-size:30px/);
  });
});

describe('placement', () => {
  it('sits before the MOB1 zoom block, which must stay last', () => {
    const zoom = blocks.find((b) => /font-size:16px!important/.test(b.text));
    expect(zoom.index).toBeGreaterThan(phoneBlock.index);
  });

  it('uses only the three agreed breakpoints', () => {
    const widths = [...new Set([...STYLE.matchAll(/@media ?\(max-width: ?(\d+)px\)/g)].map((m) => +m[1]))];
    expect(widths.sort((a, b) => a - b)).toEqual([767, 900, 1100]);
  });
});
