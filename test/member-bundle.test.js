import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import {
  CHMS_APP_MEMBER_JS, CHMS_APP_STAFF_JS, CHMS_APP_EXT_JS, CHMS_APP_FINANCE_JS, CHMS_APP_CORE_JS,
  CHMS_HTML, chmsHtmlForRole, SW_JS,
} from '../src/html-chms.js';

// Role gating in this app is visibility, not payload: applyRoleUI() sets a `role-member` class
// on <body> and CSS hides the tabs, but every role was served the same ~1.8MB of JS — Finance,
// Giving, Tuition Aid and all — because the cached bundles are shared across users and so
// cannot vary by role. A member account can only ever reach the directory, and is typically on
// a phone.
//
// app-core.js is now split along the role line into app-member.js (core + people + households)
// and app-staff.js (settings + dashboard + register), and the SHELL — which is per-request and
// no-store — decides which tags to emit.
//
// The failure mode this guards is a ReferenceError at load: the member bundle referencing a
// global that only exists in one of the bundles it no longer ships with. That is why the
// central test here actually EXECUTES app-member.js on its own rather than grepping it.

/** Minimal DOM good enough to let the bundles evaluate and a tab render. */
function fakeEl(id) {
  const e = {
    id, tagName: 'DIV', style: {}, dataset: {}, children: [], _classes: new Set(),
    innerHTML: '', textContent: '', value: '', hidden: false, checked: false,
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {},
    scrollIntoView() {}, click() {}, closest() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 100 }; },
  };
  e.classList = {
    add: (...c) => c.forEach((x) => e._classes.add(x)),
    remove: (...c) => c.forEach((x) => e._classes.delete(x)),
    contains: (c) => e._classes.has(c),
    toggle: (c, on) => (on === undefined
      ? (e._classes.has(c) ? e._classes.delete(c) : e._classes.add(c))
      : (on ? e._classes.add(c) : e._classes.delete(c))),
  };
  return e;
}

/**
 * Build a context and run the given bundles in the order the shell emits them.
 * Records every script the app asks the browser to load, so the lazy path is observable.
 */
function runBundles(bundles) {
  const store = {};
  const injected = [];
  const ctx = {
    document: {
      getElementById(id) { return store[id] || (store[id] = fakeEl(id)); },
      querySelector() { return null; }, querySelectorAll() { return []; },
      createElement(tag) {
        const el = fakeEl('created-' + tag);
        el.tagName = String(tag).toUpperCase();
        return el;
      },
      addEventListener() {}, body: fakeEl('body'), activeElement: null,
    },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Math, JSON, Date, RegExp, Boolean, parseFloat, parseInt, isFinite, isNaN,
    Number, String, Object, Array, Promise, Error, Map, Set, Intl,
    encodeURIComponent, decodeURIComponent, URLSearchParams,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'test' },
    location: { href: 'https://connect.timothystl.org/', hash: '', pathname: '/', reload() {} },
    history: { pushState() {}, replaceState() {} },
    addEventListener() {}, removeEventListener() {}, scrollTo() {},
    requestAnimationFrame(fn) { return setTimeout(fn, 0); },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    alert() {}, confirm() { return false; },
    fetch: () => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ people: [], total: 0, tags: [], types: [], role: 'member' }),
      text: () => Promise.resolve(''),
    }),
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  // Appending a <script> is how both lazy loaders pull code in. Record the src and resolve, so
  // a test can assert WHICH bundles a member is sent to fetch without a real network.
  ctx.document.body.appendChild = function (el) {
    if (el && el.tagName === 'SCRIPT' && el.src) {
      injected.push(el.src);
      setTimeout(() => { if (typeof el.onload === 'function') el.onload(); }, 0);
    }
    return el;
  };
  vm.createContext(ctx);
  for (const [name, code] of bundles) {
    vm.runInContext(code, ctx, { filename: name });
  }
  ctx.__injected = injected;
  return ctx;
}

const memberCtx = () => runBundles([['app-member.js', CHMS_APP_MEMBER_JS]]);
const fullCtx = () => runBundles([
  ['app-member.js', CHMS_APP_MEMBER_JS],
  ['app-staff.js', CHMS_APP_STAFF_JS],
  ['app-ext.js', CHMS_APP_EXT_JS],
]);

/**
 * The bare function calls inside the window 'load' handler's .finally() — i.e. the work that
 * runs on every page load for every role. Read out of the shipped bundle rather than listed by
 * hand, so a new boot call that the member bundle cannot satisfy fails here instead of on a
 * member's phone.
 */
function bootCalls() {
  // CR3 moved loadTags()/loadMemberTypes() out of the .finally() block to fire in parallel
  // with /me (neither reads _userRole) — so the boot calls this test cares about now span two
  // segments: the plain top-level statements right before the api('/admin/api/me') call, and
  // the original .finally() block. Scanning only .finally() would silently stop covering the
  // two calls that moved, which is exactly the kind of drift this test exists to catch.
  const meAt = CHMS_APP_MEMBER_JS.indexOf("api('/admin/api/me')");
  expect(meAt, 'boot /me call not found — has js-core been restructured?').toBeGreaterThan(-1);
  const fetchRoleAt = CHMS_APP_MEMBER_JS.lastIndexOf('// Fetch role first', meAt);
  expect(fetchRoleAt, 'pre-/me boot comment not found — has js-core been restructured?').toBeGreaterThan(-1);
  const preBlock = CHMS_APP_MEMBER_JS.slice(fetchRoleAt, meAt);

  const finallyAt = CHMS_APP_MEMBER_JS.indexOf('.finally(function() {');
  expect(finallyAt, 'boot .finally() block not found — has js-core been restructured?').toBeGreaterThan(-1);
  const finallyBlock = CHMS_APP_MEMBER_JS.slice(finallyAt, CHMS_APP_MEMBER_JS.indexOf('\n  });', finallyAt));

  const all = [], memberReached = [];
  const scan = (block, indent) => {
    const re = new RegExp('^ {' + indent + '}(if \\(([^)]*)\\) )?([a-zA-Z_$][\\w$]*)\\(', 'gm');
    for (const m of block.matchAll(re)) {
      const [, , guard, name] = m;
      if (name === 'if') continue;
      all.push(name);
      // loadFunds is deliberately skipped for a member (funds are giving data — a guaranteed
      // 403), so it is not required to be in the member bundle. Honor that guard rather than
      // demanding every boot call be present, which would block a legitimate future move.
      if (!(guard && /_userRole\s*!==\s*'member'/.test(guard))) memberReached.push(name);
    }
  };
  scan(preBlock, 2);
  scan(finallyBlock, 4);
  return { all: [...new Set(all)], memberReached: [...new Set(memberReached)] };
}

describe('app-member.js stands on its own', () => {
  it('evaluates with no other bundle present', () => {
    // Necessary but not sufficient: a reference to a global that lives in another bundle only
    // throws when it RUNS, so this catches a parse/top-level failure and the boot test below
    // catches the rest.
    expect(() => memberCtx()).not.toThrow();
  });

  it('can run every boot call a member session actually reaches', () => {
    const ctx = memberCtx();
    const { all, memberReached } = bootCalls();
    // Sanity-check the extraction itself, so an empty list can never pass silently.
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(memberReached).toContain('loadMemberTypes');
    // The guard is real and still there — if loadFunds ever loses it, this list grows and the
    // loop below starts demanding it, which is the correct outcome.
    expect(all).toContain('loadFunds');
    for (const fn of memberReached) {
      expect(typeof ctx[fn], fn + '() runs on every member load but is not in the member bundle')
        .toBe('function');
      expect(() => ctx[fn](), fn + '() threw during boot').not.toThrow();
    }
  });

  it('defines the shared state the People views read', () => {
    const ctx = memberCtx();
    for (const fn of ['api', 'esc', 'showTab', 'applyRoleUI', 'applyPermissionUI']) {
      expect(typeof ctx[fn], fn + ' is missing from the member bundle').toBe('function');
    }
    // Read by the People filter chip label and the person-edit type <select>.
    expect(Array.isArray(ctx._memberTypes)).toBe(true);
  });

  it('renders the one tab a member can open', () => {
    const ctx = memberCtx();
    ctx.applyRoleUI('member', 'A Member', { finance: false, staff: false, register: false, reports: false });
    expect(() => ctx.showTab('people')).not.toThrow();
    expect(typeof ctx.loadPeople).toBe('function');
  });

  it('redirects a member away from tabs whose code it does not ship', () => {
    const ctx = memberCtx();
    ctx.applyRoleUI('member', '', { finance: false, staff: false, register: false, reports: false });
    // showTab rewrites any non-people target to 'people' for a member BEFORE reaching the
    // per-tab load call — which is what keeps loadDashboard/givSetView/loadFinance, none of
    // which are in this bundle, from ever being evaluated.
    for (const tab of ['home', 'giving', 'finance', 'attendance', 'households', 'settings']) {
      expect(() => ctx.showTab(tab), 'showTab(' + tab + ') threw').not.toThrow();
    }
  });

  it('does not carry the code a member cannot reach', () => {
    const ctx = memberCtx();
    for (const fn of ['loadFinance', 'givSetView', 'loadTuitionAid', 'loadAttendance',
                      'loadSettings', 'loadDashboard', 'loadRegister', 'initReports']) {
      expect(typeof ctx[fn], fn + ' leaked into the member bundle').toBe('undefined');
    }
  });
});

describe('Reports for a member is lazy, not missing', () => {
  it('fetches the other two bundles, in shell order, on first open', async () => {
    const ctx = memberCtx();
    ctx.applyRoleUI('member', '', { finance: false, staff: false, register: false, reports: true });
    ctx.showTab('reports');
    await new Promise((r) => setTimeout(r, 5));
    const names = ctx.__injected.map((s) => s.split('?')[0]);
    expect(names).toEqual(['/admin/app-staff.js', '/admin/app-ext.js']);
  });

  it('asks once, however many times the tab is opened', async () => {
    const ctx = memberCtx();
    ctx.applyRoleUI('member', '', { finance: false, staff: false, register: false, reports: true });
    ctx.showTab('reports');
    ctx.showTab('reports');
    ctx.showTab('reports');
    await new Promise((r) => setTimeout(r, 5));
    expect(ctx.__injected.length).toBe(2);
  });

  it('is inert for a role that already has the code', async () => {
    const ctx = fullCtx();
    ctx.applyRoleUI('admin', '', null);
    ctx.showTab('reports');
    await new Promise((r) => setTimeout(r, 5));
    expect(ctx.__injected).toEqual([]);
  });
});

describe('the split loses nothing', () => {
  it('member + staff is exactly the old app-core', () => {
    expect(CHMS_APP_CORE_JS).toBe(CHMS_APP_MEMBER_JS + '\n' + CHMS_APP_STAFF_JS);
  });

  it('defines the same globals the unsplit app did', () => {
    const globalsOf = (s) => new Set([
      ...[...s.matchAll(/^(?:async )?function ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
      ...[...s.matchAll(/^(?:var|let|const) ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
    ]);
    const halves = new Set([...globalsOf(CHMS_APP_MEMBER_JS), ...globalsOf(CHMS_APP_STAFF_JS)]);
    for (const n of globalsOf(CHMS_APP_CORE_JS)) {
      expect(halves.has(n), n + ' was dropped by the split').toBe(true);
    }
  });

  it('keeps the full app a single global scope — no name is defined twice', () => {
    // Concatenated bundles share one scope, so a duplicated top-level name would silently
    // shadow. This held before the split and has to keep holding after it. P25-E adds a
    // fourth bundle (finance), which loads on top of the other three at runtime (never
    // standalone), so it has to be checked against all of them too.
    const seen = new Map();
    for (const [name, code] of [['member', CHMS_APP_MEMBER_JS], ['staff', CHMS_APP_STAFF_JS],
                                ['ext', CHMS_APP_EXT_JS], ['finance', CHMS_APP_FINANCE_JS]]) {
      for (const m of code.matchAll(/^(?:async )?function ([A-Za-z_$][\w$]*)/gm)) {
        expect(seen.has(m[1]) ? m[1] + ' also in ' + seen.get(m[1]) : '').toBe('');
        seen.set(m[1], name);
      }
    }
  });
});

describe('P25-E: Finance split out of app-ext.js along the permission line', () => {
  const financeCtx = () => runBundles([
    ['app-member.js', CHMS_APP_MEMBER_JS],
    ['app-staff.js', CHMS_APP_STAFF_JS],
    ['app-ext.js', CHMS_APP_EXT_JS],
  ]);

  it('is never in the shell\'s eager script tags, for any role', () => {
    // Unlike the member/staff split, this is not a role-line cut: nobody's landing tab is
    // Finance, so app-finance.js is fetched lazily for every role, admin included.
    for (const role of ['admin', 'finance', 'staff', 'council', 'member', null, undefined, 'future-role']) {
      expect(chmsHtmlForRole(role), String(role)).not.toMatch(/app-finance\.js/);
    }
  });

  it('does not carry finance code before it is loaded', () => {
    const ctx = financeCtx();
    expect(typeof ctx.loadFinance, 'loadFinance leaked into app-ext.js').toBe('undefined');
    expect(typeof ctx.finShowSection, 'finShowSection leaked into app-ext.js').toBe('undefined');
  });

  it('fetches app-finance.js the first time the Finance tab is opened', async () => {
    const ctx = financeCtx();
    ctx.applyRoleUI('finance', '', { finance: true, staff: false, register: false, reports: true });
    ctx.showTab('finance');
    await new Promise((r) => setTimeout(r, 5));
    expect(ctx.__injected.map((s) => s.split('?')[0])).toEqual(['/admin/app-finance.js']);
  });

  it('asks once, however many times the Finance tab is opened', async () => {
    const ctx = financeCtx();
    ctx.applyRoleUI('finance', '', { finance: true, staff: false, register: false, reports: true });
    ctx.showTab('finance');
    ctx.showTab('finance');
    ctx.showTab('finance');
    await new Promise((r) => setTimeout(r, 5));
    expect(ctx.__injected.length).toBe(1);
  });

  it('loading Finance does not shadow or lose anything the rest of the app defines', () => {
    // The one real bug class this kind of split can introduce (per CR9's own precedent):
    // a global landing in the wrong half, or a name the finance bundle happens to reuse.
    const ctx = financeCtx();
    vm.runInContext(CHMS_APP_FINANCE_JS, ctx, { filename: 'app-finance.js' });
    expect(typeof ctx.loadFinance).toBe('function');
    expect(typeof ctx.finShowSection).toBe('function');
    // esc() (core) and givSetView() (ext) must still resolve correctly after finance loads on
    // top — i.e. finance did not redeclare either and silently shadow it.
    expect(ctx.esc('<b>')).toBe('&lt;b&gt;');
    expect(typeof ctx.givSetView).toBe('function');
  });

  it('Giving’s Reports view loads Finance on demand too, since it calls into Finance’s chart helpers', async () => {
    // The one real cross-module coupling found before shipping this split: js-giving.js's
    // 'reports' view calls finInitGivingReports() unconditionally. A giving-only account
    // (giving:edit, finance:none) must not hit a ReferenceError opening it. Uses the admin
    // role purely so permView('giving') short-circuits true — this harness's stub fetch
    // never populates the granular _perm matrix the way a real /me response would. The three
    // sibling calls in that same branch (loadBoardReport/givPopulateFundSelect/givAnalysisInit)
    // need real fund/report data this minimal DOM harness doesn't provide — stubbed out here
    // since they are unrelated to what this test is checking.
    const ctx = financeCtx();
    ctx.applyRoleUI('admin', '', null);
    ctx.loadBoardReport = () => {};
    ctx.givPopulateFundSelect = () => {};
    ctx.givAnalysisInit = () => {};
    expect(() => ctx.givSetView('reports')).not.toThrow();
    await new Promise((r) => setTimeout(r, 5));
    expect(ctx.__injected.map((s) => s.split('?')[0])).toEqual(['/admin/app-finance.js']);
  });
});

describe('the shell decides, because the cached assets cannot', () => {
  const tags = (h) => (h.match(/app-[a-z]+\.js/g) || []);

  it('sends a member one bundle', () => {
    expect(tags(chmsHtmlForRole('member'))).toEqual(['app-member.js']);
  });

  it('sends every other role all three, in load order', () => {
    for (const role of ['admin', 'finance', 'staff', 'council']) {
      expect(tags(chmsHtmlForRole(role)), role).toEqual(['app-member.js', 'app-staff.js', 'app-ext.js']);
    }
  });

  it('fails safe on an unrecognized role', () => {
    // Under-serving scripts to a real user breaks their app; over-serving to a member costs
    // bytes. An unknown role must land on the harmless side.
    for (const role of [null, undefined, '', 'future-role']) {
      expect(tags(chmsHtmlForRole(role)), String(role)).toEqual(
        ['app-member.js', 'app-staff.js', 'app-ext.js']);
    }
  });

  it('markup is identical whichever role asked — only the script tags differ', () => {
    const strip = (h) => h.replace(/<script src="\/admin\/app-[a-z]+\.js\?v=[^"]*"><\/script>\n/g, '');
    expect(strip(chmsHtmlForRole('member'))).toBe(strip(CHMS_HTML));
  });

  it('is meaningfully smaller for a member', () => {
    const B = (s) => Buffer.byteLength(s);
    const member = B(chmsHtmlForRole('member')) + B(CHMS_APP_MEMBER_JS);
    const full = B(CHMS_HTML) + B(CHMS_APP_MEMBER_JS) + B(CHMS_APP_STAFF_JS) + B(CHMS_APP_EXT_JS);
    expect(member).toBeLessThan(full * 0.45);
  });
});

describe('the rest of the plumbing followed the rename', () => {
  const worker = fs.readFileSync(new URL('../tlc-volunteer-worker.js', import.meta.url), 'utf8');

  it('the worker serves both new bundles', () => {
    expect(worker).toMatch(/path === '\/admin\/app-member\.js'/);
    expect(worker).toMatch(/path === '\/admin\/app-staff\.js'/);
    expect(worker).toMatch(/path === '\/admin\/app-ext\.js'/);
  });

  it('nothing still points at the retired app-core.js route', () => {
    // The path, not the word: both files still mention app-core.js in comments explaining what
    // the split replaced, and that prose should not be what fails.
    expect(worker).not.toContain('/admin/app-core.js');
    expect(CHMS_HTML).not.toContain('app-core.js');
    expect(SW_JS).not.toContain('/admin/app-core.js');
  });

  it('the service worker caches the bundles that now exist', () => {
    // These are the immutable ?v= assets. Missing one here means a relaunch re-fetches it,
    // which is exactly the cost the member split exists to remove.
    for (const p of ['/admin/app-member.js', '/admin/app-staff.js', '/admin/app-ext.js', '/admin/app.css']) {
      expect(SW_JS, p + ' is not cached by the service worker').toContain(p);
    }
  });

  it('the shell serves the role, not a constant', () => {
    // Two routes render the app shell; both have to ask.
    const calls = worker.match(/chmsHtmlForRole\(auth\.role\)/g) || [];
    expect(calls.length).toBe(2);
    expect(worker).not.toMatch(/html\(CHMS_HTML/);
  });
});
