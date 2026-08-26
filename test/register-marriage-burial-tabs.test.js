import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_MEMBER_JS, CHMS_APP_STAFF_JS, CHMS_HTML } from '../src/html-chms.js';

// Marriages and Burials tabs on the Church Register, added alongside the existing Baptisms and
// Confirmations tabs so old wedding/funeral records can be entered and searched the same way.
// Baptisms/Confirmations keep the exact same form (every baptism-specific field shown) they
// always had -- only the two new types get a leaner form (name + a second name field relabeled
// per type, no father/mother/sponsors/DOB), since reusing those baptism-only fields for a burial
// (e.g. a date of death written into the "Date of Birth" input) would make the register list
// mislabel it "b. <date>" -- see the comment on _regLabels in js-register.js.

/** Minimal DOM good enough to let the bundles evaluate and the register form logic run. */
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

function runRegisterCtx() {
  const store = {};
  const fetchCalls = [];
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
    alert() {}, confirm() { return false; },
    fetch(path, opts) {
      fetchCalls.push({ path, opts });
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ ok: true, id: 1 }),
        text: () => Promise.resolve(''),
      });
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_MEMBER_JS, ctx, { filename: 'app-member.js' });
  vm.runInContext(CHMS_APP_STAFF_JS, ctx, { filename: 'app-staff.js' });
  ctx.__store = store;
  ctx.__fetchCalls = fetchCalls;
  return ctx;
}

async function flush() {
  // Let the api()/fetch promise chain settle.
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
}

describe('Register: Marriages and Burials tabs exist in the shell', () => {
  it('has tab buttons for both new types alongside the existing two', () => {
    expect(CHMS_HTML).toMatch(/data-rtab="baptism"[^>]*>Baptisms</);
    expect(CHMS_HTML).toMatch(/data-rtab="confirmation"[^>]*>Confirmations</);
    expect(CHMS_HTML).toMatch(/data-rtab="wedding"[^>]*onclick="showRegisterTab\('wedding'\)"[^>]*>Marriages</);
    expect(CHMS_HTML).toMatch(/data-rtab="funeral"[^>]*onclick="showRegisterTab\('funeral'\)"[^>]*>Burials</);
  });

  it('offers wedding and burial as import types', () => {
    const importBlock = CHMS_HTML.slice(CHMS_HTML.indexOf('id="reg-import-type"'), CHMS_HTML.indexOf('id="reg-import-type"') + 400);
    expect(importBlock).toContain('<option value="wedding">Marriages</option>');
    expect(importBlock).toContain('<option value="funeral">Burials</option>');
  });

  it('has a second-name field, hidden by default (baptism is the initial tab)', () => {
    const wrap = CHMS_HTML.match(/<div class="field" id="reg-field-name2"[^>]*>/);
    expect(wrap, 'reg-field-name2 wrapper not found').toBeTruthy();
    expect(wrap[0]).toMatch(/display:\s*none/);
    expect(CHMS_HTML).toContain('id="reg-name2"');
  });

  it('the destructive register/clear route is gone from the client too', () => {
    expect(CHMS_HTML).not.toContain('register/clear');
  });
});

describe('Register: per-type form fields (driven through the real bundle)', () => {
  it('wedding shows Groom/Bride and hides the baptism-only fields', () => {
    const ctx = runRegisterCtx();
    ctx.showRegisterTab('wedding');
    expect(ctx.__store['reg-name-lbl'].textContent).toBe('Groom');
    expect(ctx.__store['reg-name2-lbl'].textContent).toBe('Bride');
    expect(ctx.__store['reg-field-name2'].style.display).toBe('');
    expect(ctx.__store['reg-baptism-fields'].style.display).toBe('none');
  });

  it('funeral shows Name of Deceased / Burial Place and hides the baptism-only fields', () => {
    const ctx = runRegisterCtx();
    ctx.showRegisterTab('funeral');
    expect(ctx.__store['reg-name-lbl'].textContent).toBe('Name of Deceased');
    expect(ctx.__store['reg-name2-lbl'].textContent).toBe('Burial Place');
    expect(ctx.__store['reg-field-name2'].style.display).toBe('');
    expect(ctx.__store['reg-baptism-fields'].style.display).toBe('none');
  });

  it('baptism is unchanged: no second-name field, all baptism fields shown', () => {
    const ctx = runRegisterCtx();
    // Land on wedding first, then back to baptism -- proves the toggle actually flips both ways.
    ctx.showRegisterTab('wedding');
    ctx.showRegisterTab('baptism');
    expect(ctx.__store['reg-name-lbl'].textContent).toBe('Name Baptized');
    expect(ctx.__store['reg-field-name2'].style.display).toBe('none');
    expect(ctx.__store['reg-baptism-fields'].style.display).toBe('');
  });

  it('confirmation is unchanged: no second-name field, all baptism fields still shown', () => {
    const ctx = runRegisterCtx();
    ctx.showRegisterTab('confirmation');
    expect(ctx.__store['reg-name-lbl'].textContent).toBe('Name Confirmed');
    expect(ctx.__store['reg-field-name2'].style.display).toBe('none');
    expect(ctx.__store['reg-baptism-fields'].style.display).toBe('');
  });
});

describe('Register: saving a Marriage/Burial entry sends the second name', () => {
  it('saveRegisterEntry sends name2 (Bride) on the wedding tab', async () => {
    const ctx = runRegisterCtx();
    ctx.showRegisterTab('wedding');
    ctx.__store['reg-name'].value = 'John Smith';
    ctx.__store['reg-name2'].value = 'Jane Doe';
    ctx.__store['reg-date'].value = '1955-06-04';
    ctx.saveRegisterEntry();
    await flush();
    const call = ctx.__fetchCalls.find((c) => c.path === '/admin/api/register');
    expect(call, 'no POST to /admin/api/register was made').toBeTruthy();
    const body = JSON.parse(call.opts.body);
    expect(body.type).toBe('wedding');
    expect(body.name).toBe('John Smith');
    expect(body.name2).toBe('Jane Doe');
  });

  it('saveRegisterEntry sends name2 (Burial Place) on the funeral tab', async () => {
    const ctx = runRegisterCtx();
    ctx.showRegisterTab('funeral');
    ctx.__store['reg-name'].value = 'Henry Old';
    ctx.__store['reg-name2'].value = 'Resurrection Cemetery';
    ctx.__store['reg-date'].value = '1962-02-14';
    ctx.saveRegisterEntry();
    await flush();
    const call = ctx.__fetchCalls.find((c) => c.path === '/admin/api/register');
    expect(call, 'no POST to /admin/api/register was made').toBeTruthy();
    const body = JSON.parse(call.opts.body);
    expect(body.type).toBe('funeral');
    expect(body.name).toBe('Henry Old');
    expect(body.name2).toBe('Resurrection Cemetery');
  });

  it('openRegisterEdit populates the second-name field from the entry, not from sponsors', () => {
    const ctx = runRegisterCtx();
    ctx.showRegisterTab('wedding');
    ctx._regEntries = [{ id: 42, type: 'wedding', name: 'John Smith', name2: 'Jane Doe', sponsors: '', event_date: '1955-06-04' }];
    ctx.openRegisterEdit(42);
    expect(ctx.__store['reg-name2'].value).toBe('Jane Doe');
    // Sponsors is hidden for this type and must not silently pick up the Bride's name.
    expect(ctx.__store['reg-sponsors'].value).toBe('');
  });
});

describe('Register import: column detection recognizes wedding/burial headers', () => {
  it('maps Groom/Bride/Wedding Date columns', () => {
    const ctx = runRegisterCtx();
    const sel = ctx.document.getElementById('reg-import-type');
    sel.value = 'wedding';
    const csv = 'Groom,Bride,Wedding Date,Officiant\nJohn Smith,Jane Doe,06/04/1955,Rev. Pastor';
    const parsed = ctx.parseRegImportFile(csv, 'weddings.csv');
    expect(parsed.error).toBeFalsy();
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].name).toBe('John Smith');
    expect(parsed.rows[0].name2).toBe('Jane Doe');
    expect(parsed.rows[0].event_date).toBe('1955-06-04');
  });

  it('maps Name of Deceased/Burial Place/Burial Date columns', () => {
    const ctx = runRegisterCtx();
    const sel = ctx.document.getElementById('reg-import-type');
    sel.value = 'funeral';
    const csv = 'Name of Deceased,Burial Place,Burial Date,Officiant\nHenry Old,Resurrection Cemetery,02/14/1962,Rev. Pastor';
    const parsed = ctx.parseRegImportFile(csv, 'burials.csv');
    expect(parsed.error).toBeFalsy();
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].name).toBe('Henry Old');
    expect(parsed.rows[0].name2).toBe('Resurrection Cemetery');
    expect(parsed.rows[0].event_date).toBe('1962-02-14');
  });
});
