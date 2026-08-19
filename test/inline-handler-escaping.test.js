import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { CHMS_APP_MEMBER_JS, CHMS_APP_STAFF_JS, CHMS_APP_EXT_JS } from '../src/html-chms.js';

// SEC13/SEC14, 2026-08-19 — and this is the FOURTH appearance of one bug: VUXBUG2 (2026-07-06),
// SW11 (2026-07-11), REV1 (2026-07-11), now SEC13/SEC14. Every time it has been fixed at the
// call site and every time it has come back somewhere else, so this file guards the class
// rather than the instances.
//
// The mechanism, once, so nobody has to rediscover it: a browser HTML-decodes an attribute's
// value BEFORE the JS parser sees it. So escaping that runs before JSON.stringify is undone at
// exactly the wrong moment — `esc()` turns `"` into `&quot;`, JSON.stringify cannot see that
// and does not escape it, and the parser decodes it back into a real quote INSIDE the string
// literal. The value breaks out of its own argument and whatever follows executes.
//
// Reachability is not theoretical. `POST /serve/signup` is fully public and takes `name` with
// no character filter, and `POST /api/intake/connect-card` (the website contact form) is the
// same for person names. Both land in lists an admin opens.

const FRONTEND_DIR = new URL('../src/frontend/', import.meta.url);
const files = fs.readdirSync(FRONTEND_DIR).filter((f) => f.endsWith('.js'));
const sources = files.map((f) => [f, fs.readFileSync(new URL(f, FRONTEND_DIR), 'utf8')]);

/**
 * Code lines only. Pure comment lines are skipped so that jsAttr's own doc comment — which
 * has to spell out the broken forms to be any use — does not trip its own guard. A trailing
 * comment on a line of code is left alone rather than stripped: `//` appears inside plenty of
 * URL string literals here, and a naive strip would blind the scan to real code.
 */
function codeLines(src) {
  return src.split('\n').map((line, i) => [line, i + 1])
    .filter(([line]) => !/^\s*(\/\/|\*|\/\*)/.test(line));
}

describe('no pre-escaped value is ever placed into a JS string context', () => {
  it('never composes jsAttr with esc', () => {
    // jsAttr(esc(x)) is the SEC13 shape: esc's &quot; survives JSON.stringify untouched and
    // decodes back into a quote. jsAttr already escapes; passing it an escaped value is the bug.
    const hits = [];
    for (const [f, src] of sources) {
      for (const [line, n] of codeLines(src)) {
        if (/jsAttr\(\s*esc\(/.test(line)) hits.push(f + ':' + n);
      }
    }
    expect(hits, 'jsAttr(esc(...)) — pass the RAW value').toEqual([]);
  });

  it('never puts an esc() result between &#39; delimiters inside a handler', () => {
    // The SEC14 shape: onclick="fn(&#39;' + esc(name) + '&#39;)". esc's own &#39; decodes to a
    // real apostrophe and closes the literal.
    const hits = [];
    for (const [f, src] of sources) {
      for (const [line, n] of codeLines(src)) {
        if (/&#39;'\s*\+\s*esc\(/.test(line) || /&quot;'\s*\+\s*esc\(/.test(line)) {
          hits.push(f + ':' + n);
        }
      }
    }
    expect(hits, "esc() between &#39; delimiters — use jsAttr(raw) instead").toEqual([]);
  });

  it('has no leftover .replace(/\\x27/g,...) sanitizers that are already no-ops', () => {
    // Three of the five SEC14 sites carried `.replace(/'/g,'&#39;')` on a value that had
    // already been esc()'d, so it could never match anything. It read as protection and was
    // the reason the sites looked reviewed.
    const hits = [];
    for (const [f, src] of sources) {
      for (const [line, n] of codeLines(src)) {
        if (/&#39;'\s*\+\s*[A-Za-z_$][\w.$]*\.replace\(/.test(line)) hits.push(f + ':' + n);
      }
    }
    expect(hits, 'hand-rolled quote replacement feeding a handler argument').toEqual([]);
  });
});

// ── The real helper, run against hostile input ──────────────────────────────────────────
// Source scans catch the shapes we know about. This catches the helper being wrong, which is
// what actually happened: the previous volJsAttr escaped the quotes it added but not a literal
// "&quot;" already inside the value, so it was injectable on its own.

function loadJsAttr() {
  // Evaluate the real shipped member bundle rather than re-declaring the helper here — the
  // point is to test what is served. It registers listeners at top level, so it needs just
  // enough of a DOM to load; nothing below calls anything that touches one.
  const el = () => ({
    style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, appendChild(c) { return c; }, setAttribute() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    innerHTML: '', textContent: '', value: '', dataset: {},
  });
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Math, JSON, Date, RegExp, Boolean, parseFloat, parseInt, isFinite, isNaN,
    Number, String, Object, Array, Promise, Error, Map, Set, Intl,
    encodeURIComponent, decodeURIComponent, URLSearchParams,
    document: {
      getElementById: () => el(), createElement: () => el(),
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, body: el(),
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'test' },
    location: { href: 'https://connect.timothystl.org/', hash: '', pathname: '/' },
    history: { replaceState() {}, pushState() {} },
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_MEMBER_JS, ctx, { filename: 'app-member.js' });
  return { jsAttr: ctx.jsAttr, esc: ctx.esc };
}

/** What a browser does to an attribute value before handing it to the JS parser. */
function htmlDecodeAttr(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const HOSTILE = [
  'Smith',
  "O'Brien",
  'A");globalThis.__PWNED=1;//',
  "A');globalThis.__PWNED=1;//",
  'A&quot;);globalThis.__PWNED=1;//',   // ⚠ the one the old volJsAttr fell to
  'A&#39;);globalThis.__PWNED=1;//',
  'back\\slash',
  'trailing\\',
  '"\\");globalThis.__PWNED=1;//',
  '<img src=x onerror=globalThis.__PWNED=1>',
  'a&amp;b',
  '</script><script>globalThis.__PWNED=1</script>',
  '',
];

describe('jsAttr survives hostile values in a real handler-attribute round trip', () => {
  const { jsAttr } = loadJsAttr();

  it('is defined exactly once, and in the bundle a member actually gets', () => {
    // js-households.js calls it and ships in app-member.js, so a member session must have it.
    // Two definitions across bundles would mean one silently wins — the exact failure mode
    // CR9's split introduced once already.
    const all = CHMS_APP_MEMBER_JS + CHMS_APP_STAFF_JS + CHMS_APP_EXT_JS;
    expect((all.match(/function jsAttr\(/g) || []).length).toBe(1);
    expect(/function jsAttr\(/.test(CHMS_APP_MEMBER_JS)).toBe(true);
  });

  for (const payload of HOSTILE) {
    it('round-trips exactly and executes nothing: ' + JSON.stringify(payload), () => {
      const attr = 'sink(' + jsAttr(payload) + ')';
      const js = htmlDecodeAttr(attr);
      const ctx = { __PWNED: 0, received: undefined, sink(v) { ctx.received = v; } };
      vm.createContext(ctx);
      vm.runInContext(js, ctx);
      expect(ctx.__PWNED, 'code executed outside the string literal').toBe(0);
      expect(ctx.received, 'value did not survive the round trip').toBe(payload);
    });
  }

  it('produces an attribute value that cannot close a double-quoted attribute', () => {
    for (const payload of HOSTILE) {
      expect(jsAttr(payload).includes('"'), JSON.stringify(payload)).toBe(false);
    }
  });

  it('coerces undefined/null to an empty string rather than the literal undefined', () => {
    expect(htmlDecodeAttr(jsAttr(undefined))).toBe('""');
    expect(htmlDecodeAttr(jsAttr(null))).toBe('null');
  });
});
