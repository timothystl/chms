import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_MEMBER_JS, CHMS_APP_STAFF_JS } from '../src/html-chms.js';

// Print Certificate: entering a register record and printing its certificate happen in one
// step (offered right after a NEW entry is saved), and an old record can get a certificate
// printed retroactively from its row in the list. Re-saving an EDIT never re-prompts -- the
// point is that the register alone should be able to tell whether a certificate was ever
// actually handed out, and re-offering on every routine correction would defeat that.

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

function runRegisterCtx(opts = {}) {
  const store = {};
  const fetchCalls = [];
  const printedWindows = [];
  const ctx = {
    document: {
      getElementById(id) { return store[id] || (store[id] = fakeEl(id)); },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      createElement(tag) { const el = fakeEl('created-' + tag); el.tagName = String(tag).toUpperCase(); return el; },
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
    alert() {},
    confirm(msg) { ctx.__confirmCalls.push(msg); return opts.confirmReturns !== undefined ? opts.confirmReturns : true; },
    open() {
      const win = { document: { write(html) { win.__html = html; }, close() {} } };
      printedWindows.push(win);
      return win;
    },
    fetch(path, fopts) {
      fetchCalls.push({ path, opts: fopts });
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ ok: true, id: 77 }),
        text: () => Promise.resolve(''),
      });
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.__confirmCalls = [];
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_MEMBER_JS, ctx, { filename: 'app-member.js' });
  vm.runInContext(CHMS_APP_STAFF_JS, ctx, { filename: 'app-staff.js' });
  ctx.__store = store;
  ctx.__fetchCalls = fetchCalls;
  ctx.__printedWindows = printedWindows;
  return ctx;
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe('Certificates: shell markup', () => {
  it('every register row gets a Certificate button alongside Edit/Delete', () => {
    // Rendered at runtime by renderRegisterList(), not baked into the static shell -- check the
    // real served script, not CHMS_HTML.
    expect(CHMS_APP_STAFF_JS).toContain("onclick=\"printCertificateForId('+e.id+')\"");
  });
});

describe('Certificates: per-type wording (driven through the real bundle)', () => {
  it('baptism certificate names the sacrament and any recorded sponsors/parents', () => {
    const ctx = runRegisterCtx();
    const html = ctx.regCertBodyHtml({
      type: 'baptism', name: 'Baby Smith', event_date: '2020-01-05', baptism_place: 'Timothy Lutheran',
      officiant: 'Dinger', father: 'John Smith', mother: 'Jane Smith', sponsors: 'Aunt Sue',
    });
    expect(html).toContain('Baby Smith');
    expect(html).toContain('baptized');
    expect(html).toContain('Timothy Lutheran');
    expect(html).toContain('Aunt Sue');
    expect(html).toContain('John Smith and Jane Smith');
  });

  it('wedding certificate names both the groom and the bride', () => {
    const ctx = runRegisterCtx();
    const html = ctx.regCertBodyHtml({ type: 'wedding', name: 'John Smith', name2: 'Jane Doe', event_date: '1955-06-04', officiant: 'Dinger' });
    expect(html).toContain('John Smith');
    expect(html).toContain('Jane Doe');
    expect(html).toMatch(/united in Holy Matrimony/i);
  });

  it('funeral certificate names the deceased and the burial place', () => {
    const ctx = runRegisterCtx();
    const html = ctx.regCertBodyHtml({ type: 'funeral', name: 'Henry Old', name2: 'Resurrection Cemetery', event_date: '1962-02-14' });
    expect(html).toContain('Henry Old');
    expect(html).toContain('Resurrection Cemetery');
  });

  it('confirmation certificate names the witnesses when recorded', () => {
    const ctx = runRegisterCtx();
    const html = ctx.regCertBodyHtml({ type: 'confirmation', name: 'Teen Smith', event_date: '2020-05-01', sponsors: 'Elder Jones' });
    expect(html).toContain('Teen Smith');
    expect(html).toContain('confirmed');
    expect(html).toContain('Elder Jones');
  });

  it('each type gets its own certificate title', () => {
    const ctx = runRegisterCtx();
    expect(ctx.regCertTitle('baptism')).toMatch(/Baptism/);
    expect(ctx.regCertTitle('confirmation')).toMatch(/Confirmation/);
    expect(ctx.regCertTitle('wedding')).toMatch(/Marriage/);
    expect(ctx.regCertTitle('funeral')).toMatch(/Burial/);
  });
});

describe('Certificates: printing an old record from its row', () => {
  it('printCertificateForId opens a window with that entry\'s name and title', () => {
    const ctx = runRegisterCtx();
    ctx._regEntries = [{ id: 5, type: 'baptism', name: 'Old Timer', event_date: '1965-03-01', pdf_page: '12' }];
    ctx.printCertificateForId(5);
    expect(ctx.__printedWindows).toHaveLength(1);
    const html = ctx.__printedWindows[0].__html;
    expect(html).toContain('Old Timer');
    expect(html).toContain('Certificate of Holy Baptism');
    expect(html).toContain('Register p.12');
  });

  it('a missing id does not crash and does not open a window', () => {
    const ctx = runRegisterCtx();
    ctx._regEntries = [];
    ctx.printCertificateForId(999);
    expect(ctx.__printedWindows).toHaveLength(0);
  });
});

describe('Certificates: offered right after saving a NEW entry, not after an edit', () => {
  it('prompts and prints when a brand-new entry is saved and the prompt is accepted', async () => {
    const ctx = runRegisterCtx({ confirmReturns: true });
    ctx.showRegisterTab('baptism');
    ctx.__store['reg-name'].value = 'New Baby';
    ctx.__store['reg-date'].value = '2026-08-26';
    ctx._regEditId = null; // not an edit
    ctx.saveRegisterEntry();
    await flush();
    expect(ctx.__confirmCalls.length).toBeGreaterThan(0);
    expect(ctx.__printedWindows).toHaveLength(1);
    expect(ctx.__printedWindows[0].__html).toContain('New Baby');
  });

  it('does not print when the prompt is declined', async () => {
    const ctx = runRegisterCtx({ confirmReturns: false });
    ctx.showRegisterTab('baptism');
    ctx.__store['reg-name'].value = 'New Baby';
    ctx.__store['reg-date'].value = '2026-08-26';
    ctx._regEditId = null;
    ctx.saveRegisterEntry();
    await flush();
    expect(ctx.__confirmCalls.length).toBeGreaterThan(0);
    expect(ctx.__printedWindows).toHaveLength(0);
  });

  it('never prompts when saving an EDIT to an existing entry', async () => {
    const ctx = runRegisterCtx({ confirmReturns: true });
    ctx.showRegisterTab('baptism');
    ctx.__store['reg-name'].value = 'Existing Person';
    ctx.__store['reg-date'].value = '2020-01-01';
    ctx._regEditId = 42; // editing, not creating
    ctx.saveRegisterEntry();
    await flush();
    expect(ctx.__confirmCalls).toHaveLength(0);
    expect(ctx.__printedWindows).toHaveLength(0);
  });
});
