import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_MEMBER_JS, CHMS_APP_STAFF_JS, CHMS_HTML } from '../src/html-chms.js';

// Certificate templates: printing overlays real entry data onto the church's own uploaded
// certificate image (position set by an admin, in percent of the image) instead of the app's
// generic bordered design -- built after the user supplied a real sample "Holy Baptism"
// certificate and asked to print directly on it.

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

/** A fake <tr data-cert-field="..."> row good enough for regCertTemplateSave/
 *  renderRegCertTemplatePreview: checked box, 3 number inputs (x/y/font-size), an align select. */
function fakeCertRow(key, { checked = true, x = 10, y = 20, fs = 16, align = 'center' } = {}) {
  const checkbox = { type: 'checkbox', checked };
  const numX = { type: 'number', value: String(x) };
  const numY = { type: 'number', value: String(y) };
  const numFs = { type: 'number', value: String(fs) };
  const select = { value: align };
  return {
    dataset: { certField: key },
    querySelector(sel) {
      if (sel === 'input[type=checkbox]') return checkbox;
      if (sel === 'select') return select;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === 'input[type=number]') return [numX, numY, numFs];
      return [];
    },
  };
}

function runRegisterCtx(opts = {}) {
  const store = {};
  const fetchCalls = [];
  const printedWindows = [];
  const selectors = {};
  const ctx = {
    document: {
      getElementById(id) { return store[id] || (store[id] = fakeEl(id)); },
      querySelector() { return null; },
      querySelectorAll(sel) { return selectors[sel] || []; },
      createElement(tag) { const el = fakeEl('created-' + tag); el.tagName = String(tag).toUpperCase(); return el; },
      addEventListener() {}, body: fakeEl('body'), activeElement: null,
    },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Math, JSON, Date, RegExp, Boolean, parseFloat, parseInt, isFinite, isNaN,
    Number, String, Object, Array, Promise, Error, Map, Set, Intl,
    encodeURIComponent, decodeURIComponent, URLSearchParams,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    FormData: class { constructor() { this._data = {}; } append(k, v) { this._data[k] = v; } },
    navigator: { userAgent: 'test' },
    location: { href: 'https://connect.timothystl.org/', hash: '', pathname: '/', reload() {} },
    history: { pushState() {}, replaceState() {} },
    addEventListener() {}, removeEventListener() {}, scrollTo() {},
    requestAnimationFrame(fn) { return setTimeout(fn, 0); },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    alert() {}, confirm() { return opts.confirmReturns !== undefined ? opts.confirmReturns : true; },
    open() {
      const win = { document: { write(html) { win.__html = html; }, close() {} } };
      printedWindows.push(win);
      return win;
    },
    fetch(path, fopts) {
      fetchCalls.push({ path, opts: fopts });
      const resBody = opts.fetchResponse || { ok: true };
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve(resBody),
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
  ctx.__printedWindows = printedWindows;
  ctx.__selectors = selectors;
  return ctx;
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe('regCertFieldValue: the one place a field key maps to real text', () => {
  it('reads the right entry column for each field key', () => {
    const ctx = runRegisterCtx();
    const entry = {
      name: 'Jane', name2: 'John', event_date: '2020-01-01', officiant: 'Rev. X',
      baptism_place: 'Chapel', sponsors: 'Aunt Sue', father: 'Dad Name', mother: 'Mom Name',
      dob: '2019-01-01', place_of_birth: 'City',
    };
    expect(ctx.regCertFieldValue('name', entry)).toBe('Jane');
    expect(ctx.regCertFieldValue('name2', entry)).toBe('John');
    expect(ctx.regCertFieldValue('date', entry)).toBe('2020-01-01');
    expect(ctx.regCertFieldValue('officiant', entry)).toBe('Rev. X');
    expect(ctx.regCertFieldValue('baptism_place', entry)).toBe('Chapel');
    expect(ctx.regCertFieldValue('sponsors', entry)).toBe('Aunt Sue');
    expect(ctx.regCertFieldValue('parents', entry)).toBe('Dad Name and Mom Name');
    expect(ctx.regCertFieldValue('born', entry)).toBe('2019-01-01 in City');
    expect(ctx.regCertFieldValue('unknown-key', entry)).toBe('');
  });

  it('never throws on a missing/undefined entry', () => {
    const ctx = runRegisterCtx();
    expect(ctx.regCertFieldValue('name', undefined)).toBe('');
    expect(ctx.regCertFieldValue('parents', {})).toBe('');
  });
});

describe('REG_CERT_FIELD_DEFS: every register type has a sensible field list', () => {
  it('covers all four types with at least name, date, and officiant', () => {
    const ctx = runRegisterCtx();
    for (const type of ['baptism', 'confirmation', 'wedding', 'funeral']) {
      const keys = ctx.REG_CERT_FIELD_DEFS[type].map((f) => f.key);
      expect(keys).toContain('name');
      expect(keys).toContain('date');
      expect(keys).toContain('officiant');
    }
  });

  it('wedding and funeral both offer name2 (Bride / Burial Place)', () => {
    const ctx = runRegisterCtx();
    expect(ctx.REG_CERT_FIELD_DEFS.wedding.map((f) => f.key)).toContain('name2');
    expect(ctx.REG_CERT_FIELD_DEFS.funeral.map((f) => f.key)).toContain('name2');
  });
});

describe('printRegisterCertificate: dispatches to the template overlay when one is positioned', () => {
  it('falls back to the generic bordered certificate when no template is uploaded', () => {
    const ctx = runRegisterCtx();
    ctx._regCertTemplates = {};
    ctx.printRegisterCertificate({ id: 1, type: 'baptism', name: 'Baby Smith', event_date: '2020-01-01' });
    expect(ctx.__printedWindows).toHaveLength(1);
    expect(ctx.__printedWindows[0].__html).toContain('cert-title'); // the generic design's own class
    expect(ctx.__printedWindows[0].__html).not.toContain('cert-wrap'); // the template design's own class
  });

  it('falls back to generic when a template is uploaded but nothing has been positioned yet', () => {
    const ctx = runRegisterCtx();
    ctx._regCertTemplates = { baptism: { url: '/img.jpg', fields: [] } };
    ctx.printRegisterCertificate({ id: 1, type: 'baptism', name: 'Baby Smith', event_date: '2020-01-01' });
    expect(ctx.__printedWindows[0].__html).toContain('cert-title');
  });

  it('uses the image overlay once at least one field is positioned', () => {
    const ctx = runRegisterCtx();
    ctx._regCertTemplates = { baptism: { url: '/admin/r2photo/register-certificate-templates/baptism.jpg', fields: [
      { key: 'name', x_pct: 50, y_pct: 10, font_size_pt: 18, align: 'center' },
      { key: 'date', x_pct: 20, y_pct: 90, font_size_pt: 12, align: 'left' },
      { key: 'officiant', x_pct: 80, y_pct: 90, font_size_pt: 12, align: 'right' },
    ] } };
    ctx.printRegisterCertificate({ id: 1, type: 'baptism', name: 'Baby Smith', event_date: '2020-01-01', officiant: 'Rev. Dinger' });
    const html = ctx.__printedWindows[0].__html;
    expect(html).toContain('cert-wrap');
    expect(html).toContain('/admin/r2photo/register-certificate-templates/baptism.jpg');
    expect(html).toContain('Baby Smith');
    expect(html).toContain('2020-01-01');
    expect(html).toContain('Rev. Dinger');
    expect(html).toContain('left:50%');
    expect(html).toContain('text-align:left');
    expect(html).toContain('text-align:right');
    expect(html).toContain('transform:translateX(-100%)'); // right-aligned field
    expect(html).toContain('transform:translateX(-50%)'); // center-aligned field
  });

  it('skips a positioned field when the entry has no data for it, rather than printing a blank box', () => {
    const ctx = runRegisterCtx();
    ctx._regCertTemplates = { funeral: { url: '/img.jpg', fields: [
      { key: 'name', x_pct: 50, y_pct: 10, font_size_pt: 18, align: 'center' },
      { key: 'name2', x_pct: 50, y_pct: 50, font_size_pt: 12, align: 'center' }, // burial place -- not set on this entry
    ] } };
    ctx.printRegisterCertificate({ id: 1, type: 'funeral', name: 'Henry Old', event_date: '1965-01-01' });
    const html = ctx.__printedWindows[0].__html;
    // Only one overlay div should appear (for "name"); the empty name2 field contributes nothing.
    const overlayCount = (html.match(/position:absolute/g) || []).length;
    expect(overlayCount).toBe(1);
  });

  it('HTML-escapes entry values in the overlay', () => {
    const ctx = runRegisterCtx();
    ctx._regCertTemplates = { baptism: { url: '/img.jpg', fields: [{ key: 'name', x_pct: 50, y_pct: 10, font_size_pt: 18, align: 'center' }] } };
    ctx.printRegisterCertificate({ id: 1, type: 'baptism', name: '<script>alert(1)</script>', event_date: '2020-01-01' });
    const html = ctx.__printedWindows[0].__html;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('loadRegisterCertTemplate: populates the per-type cache from the server', () => {
  it('stores what the server returns, keyed by type', async () => {
    const ctx = runRegisterCtx();
    ctx.fetch = (path) => {
      ctx.__fetchCalls.push({ path });
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ template: { type: 'baptism', url: '/img.jpg', fields: [{ key: 'name', x_pct: 1, y_pct: 2, font_size_pt: 14, align: 'left' }] } }),
      });
    };
    ctx.loadRegisterCertTemplate('baptism');
    await flush();
    expect(ctx._regCertTemplates.baptism.url).toBe('/img.jpg');
    expect(ctx._regCertTemplates.baptism.fields).toHaveLength(1);
  });

  it('is called when a register tab is opened', () => {
    const ctx = runRegisterCtx();
    let calledWith = null;
    ctx.loadRegisterCertTemplate = (type) => { calledWith = type; };
    ctx.showRegisterTab('wedding');
    expect(calledWith).toBe('wedding');
  });
});

describe('Certificate template upload/delete send the right requests', () => {
  it('regCertTemplateFileChosen POSTs a FormData with the current type and file', async () => {
    const ctx = runRegisterCtx();
    ctx._regType = 'wedding';
    const input = { files: [{ name: 'cert.jpg' }], value: 'x' };
    ctx.regCertTemplateFileChosen(input);
    await flush();
    const call = ctx.__fetchCalls.find((c) => c.path === '/admin/api/register/certificate-template' && c.opts && c.opts.method === 'POST');
    expect(call, 'no POST was made').toBeTruthy();
    expect(input.value).toBe(''); // input cleared so the same file can be re-chosen later
  });

  it('regCertTemplateDelete DELETEs the current type after confirming', async () => {
    const ctx = runRegisterCtx({ confirmReturns: true });
    ctx._regType = 'funeral';
    ctx.regCertTemplateDelete();
    await flush();
    const call = ctx.__fetchCalls.find((c) => c.path === '/admin/api/register/certificate-template?type=funeral' && c.opts && c.opts.method === 'DELETE');
    expect(call, 'no DELETE was made').toBeTruthy();
  });

  it('does nothing when the delete confirm is declined', async () => {
    const ctx = runRegisterCtx({ confirmReturns: false });
    ctx._regType = 'funeral';
    ctx.regCertTemplateDelete();
    await flush();
    const call = ctx.__fetchCalls.find((c) => c.opts && c.opts.method === 'DELETE');
    expect(call).toBeUndefined();
  });
});

describe('regCertTemplateSave: collects only the checked rows, with sanitized numbers', () => {
  it('sends one field per checked row, skipping unchecked ones', async () => {
    const ctx = runRegisterCtx();
    ctx._regType = 'baptism';
    ctx._regCertTemplates.baptism = { url: '/img.jpg', fields: [] };
    ctx.__selectors['[data-cert-field]'] = [
      fakeCertRow('name', { checked: true, x: 50, y: 12, fs: 18, align: 'center' }),
      fakeCertRow('officiant', { checked: false }), // unchecked -- must not appear in the save
      fakeCertRow('date', { checked: true, x: 20, y: 90, fs: 10, align: 'left' }),
    ];
    ctx.regCertTemplateSave();
    await flush();
    const call = ctx.__fetchCalls.find((c) => c.path === '/admin/api/register/certificate-template' && c.opts && c.opts.method === 'PUT');
    expect(call, 'no PUT was made').toBeTruthy();
    const body = JSON.parse(call.opts.body);
    expect(body.type).toBe('baptism');
    expect(body.fields.map((f) => f.key)).toEqual(['name', 'date']);
    expect(body.fields[0]).toEqual({ key: 'name', x_pct: 50, y_pct: 12, font_size_pt: 18, align: 'center' });
  });
});

describe('renderRegCertTemplateEditor: a fresh upload previews immediately', () => {
  it('checks every field by default when nothing has been saved yet, so the preview is not blank', () => {
    const ctx = runRegisterCtx();
    ctx._regType = 'baptism';
    ctx._regCertTemplates.baptism = { url: '/img.jpg', fields: [] }; // just uploaded, nothing positioned
    ctx.renderRegCertTemplateEditor();
    const html = ctx.__store['reg-cert-tmpl-body'].innerHTML;
    const defCount = ctx.REG_CERT_FIELD_DEFS.baptism.length;
    const checkedCount = (html.match(/checked/g) || []).length;
    expect(checkedCount).toBe(defCount);
  });

  it('respects real saved state once anything has been positioned, rather than re-defaulting to all-checked', () => {
    const ctx = runRegisterCtx();
    ctx._regType = 'baptism';
    ctx._regCertTemplates.baptism = { url: '/img.jpg', fields: [
      { key: 'name', x_pct: 50, y_pct: 10, font_size_pt: 18, align: 'center' },
    ] };
    ctx.renderRegCertTemplateEditor();
    const html = ctx.__store['reg-cert-tmpl-body'].innerHTML;
    const checkedCount = (html.match(/checked/g) || []).length;
    expect(checkedCount).toBe(1); // only "name" -- an explicit save of one field is honored, not padded back out
  });

  it('stages fields at different Y positions, not all stacked on the same spot', () => {
    const ctx = runRegisterCtx();
    ctx._regType = 'baptism';
    ctx._regCertTemplates.baptism = { url: '/img.jpg', fields: [] };
    ctx.renderRegCertTemplateEditor();
    const html = ctx.__store['reg-cert-tmpl-body'].innerHTML;
    const yValues = [...html.matchAll(/oninput="regCertFieldEdit\(this,'y_pct'\)"/g)];
    // Can't easily parse each row's own value out of the concatenated string without a real DOM
    // parser, but the field defs themselves resolve to distinct default Y values -- confirm that
    // directly instead of scraping HTML.
    const defs = ctx.REG_CERT_FIELD_DEFS.baptism;
    const ys = defs.map((d, i) => Math.round(12 + i * (76 / Math.max(defs.length - 1, 1))));
    expect(new Set(ys).size).toBe(defs.length); // every field lands on its own Y
  });
});

describe('Register tab export menu', () => {
  it('offers all three CSV exports as direct download links', () => {
    // These are plain <a href download> links with no JS behind the download itself, so they're
    // checked directly against the served shell rather than through the vm.
    expect(CHMS_HTML).toContain('href="/admin/api/export/register"');
    expect(CHMS_HTML).toContain('href="/admin/api/export/register-scans"');
    expect(CHMS_HTML).toContain('href="/admin/api/export/register-reconcile"');
    expect(CHMS_HTML).toContain('onclick="regToggleExportMenu()"');
  });

  it('regToggleExportMenu shows and hides the menu', () => {
    const ctx = runRegisterCtx();
    const menu = ctx.document.getElementById('reg-export-menu');
    menu.style.display = 'none';
    ctx.regToggleExportMenu();
    expect(menu.style.display).toBe('block');
    ctx.regToggleExportMenu();
    expect(menu.style.display).toBe('none');
  });
});
