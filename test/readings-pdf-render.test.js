import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SCHEDULER_HTML } from '../src/scheduler-html.js';

// The readings PDF is hand-built — no library — so "it looks like a PDF" is not
// enough: a wrong xref offset or a stray byte produces a file that greps fine
// and opens in nothing. These tests run the real generator out of the shipped
// script and then hand the bytes to an actual PDF parser (pypdf), asserting the
// words come back out and the geometry stays inside the page.
//
// Skipped automatically when pypdf is unavailable, so the suite still runs on a
// machine without it — but it is the check that matters here, so a skip is a
// real loss of coverage rather than a pass.

const SERVED_JS = (SCHEDULER_HTML.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';

function pythonWithPypdf() {
  try {
    // pypdf pulls in `cryptography` for encrypted files; that import panics in
    // this image, and we never write an encrypted PDF, so it is stubbed out.
    execFileSync('python3', ['-c', 'import sys; sys.modules["cryptography"]=None; import pypdf'],
      { stdio: 'ignore' });
    return true;
  } catch { return false; }
}
const HAVE_PYPDF = pythonWithPypdf();

function fakeEl(id) {
  const e = {
    id, style: {}, dataset: {}, _attrs: {}, innerHTML: '', textContent: '', value: '',
    checked: false, disabled: false,
    appendChild() {}, removeChild() {}, remove() {},
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k] ?? null; },
    removeAttribute() {}, addEventListener() {}, removeEventListener() {},
    focus() {}, blur() {}, scrollIntoView() {}, click() {},
    closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 100 }; },
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
  };
  e.parentNode = { setAttribute() {}, removeAttribute() {}, appendChild() {}, parentNode: { appendChild() {} } };
  return e;
}

function scheduler() {
  const els = {}, store = {};
  const ctx = {
    document: {
      getElementById: (id) => els[id] || (els[id] = fakeEl(id)),
      querySelector: () => null, querySelectorAll: () => [],
      createElement: () => fakeEl('x'), addEventListener() {},
      body: fakeEl('body'), documentElement: fakeEl('html'), activeElement: null,
    },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    Math, JSON, Date, RegExp, Boolean, parseFloat, parseInt, isFinite, isNaN,
    Number, String, Object, Array, Promise, Error, Map, Set, Intl,
    encodeURIComponent, decodeURIComponent, URLSearchParams,
    alert() {}, confirm: () => true,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    unescape: globalThis.unescape,
    crypto: { getRandomValues: (a) => a }, navigator: { userAgent: 'test' },
    localStorage: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
    URL: { createObjectURL: () => 'blob:', revokeObjectURL() {} }, Blob: class {},
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  ctx.window.location = { origin: 'https://connect.timothystl.org', href: '', search: '' };
  ctx.window.addEventListener = () => {}; ctx.window.removeEventListener = () => {};
  ctx.window.open = () => null;
  ctx.window.innerWidth = 1200; ctx.window.innerHeight = 900;
  ctx.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  vm.createContext(ctx);
  vm.runInContext(SERVED_JS, ctx, { filename: 'scheduler-served.js' });
  ctx.lectCalendar = {
    '2026-08-16': {
      sundayName: '12th Sunday after Pentecost (prop15)', series: 'A',
      psalm: 'Psalm 122 ( 6 )', ot: 'Isaiah 2:1-5',
      epistle: 'Romans 13:( 8-10 ) 11-14', gospel: 'Matthew 21:1-11',
    },
  };
  return ctx;
}

const ASSIGNMENTS = [{ date: 'Aug 16, 2026', dateISO: '2026-08-16', svc: '8am', role: 'Lector' }];

// Realistic ESV prose: curly quotes, an em dash, bracketed verse numbers, and
// the "(ESV)" the API's short copyright appends.
const OT = '[1] The word that Isaiah the son of Amoz saw concerning Judah and Jerusalem. '
  + '[2] It shall come to pass in the latter days that the mountain of the house of the LORD '
  + 'shall be established as the highest of the mountains, and all the nations shall flow to it, '
  + '[3] and many peoples shall come, and say: “Come, let us go up to the mountain of the LORD, '
  + 'to the house of the God of Jacob, that he may teach us his ways”—and we shall walk in his paths. (ESV)';
const EPISTLE = '[11] Besides this you know the time, that the hour has come for you to wake from sleep. (ESV)';

function renderText(pdfBinary) {
  const file = path.join(os.tmpdir(), 'readings-test-' + process.pid + '.pdf');
  fs.writeFileSync(file, Buffer.from(pdfBinary, 'binary'));
  try {
    const out = execFileSync('python3', ['-c', `
import sys, json
sys.modules["cryptography"] = None
from pypdf import PdfReader
r = PdfReader(${JSON.stringify(file)})
print(json.dumps({
  "pages": len(r.pages),
  "text": "\\n".join((p.extract_text() or "") for p in r.pages),
  "last": r.pages[-1].extract_text() or "",
  "boxes": [[float(p.mediabox.width), float(p.mediabox.height)] for p in r.pages],
}))
`], { encoding: 'utf8' });
    return JSON.parse(out);
  } finally { fs.rmSync(file, { force: true }); }
}

// These two need no PDF library — they read the bytes we just wrote — so they
// run everywhere, including CI. They are the checks that catch a file which
// greps fine but opens in nothing.
describe('readings PDF structure (no parser needed)', () => {
  it('keeps every drawn line inside the text column', () => {
    // Measured from the content streams, not trusted from the wrap function —
    // a wrong font width would push text under the margin and only show up here.
    const ctx = scheduler();
    const pdf = ctx.buildReadingsPdfFor({ name: 'L' }, ASSIGNMENTS,
      { 'Isaiah 2:1-5': OT, 'Romans 13:11-14': EPISTLE });
    const COLUMN = 612 - 72 - 72;
    let checked = 0;
    const re = /\/(FR|FB) (\d+(?:\.\d+)?) Tf (\d+(?:\.\d+)?) (\d+(?:\.\d+)?) Td \((.*?)\) Tj/g;
    let m;
    while ((m = re.exec(pdf))) {
      const size = parseFloat(m[2]);
      const x = parseFloat(m[3]), y = parseFloat(m[4]);
      const bs = String.fromCharCode(92);
      const text = m[5].split(bs + '(').join('(').split(bs + ')').join(')').split(bs + bs).join(bs);
      expect(ctx.pdfTextWidth(text, size)).toBeLessThanOrEqual(COLUMN);
      expect(x).toBeGreaterThanOrEqual(72);
      expect(y).toBeGreaterThanOrEqual(60);       // never below the bottom margin
      expect(y).toBeLessThanOrEqual(792 - 72);    // nor above the top one
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('has an xref table whose offsets really point at their objects', () => {
    // pypdf silently REBUILDS a broken xref, so parsing successfully does not
    // prove the table is right — and a reader that does not rebuild would fail
    // to open the file. Check the offsets by hand.
    const ctx = scheduler();
    const pdf = ctx.buildReadingsPdfFor({ name: 'L' }, ASSIGNMENTS,
      { 'Isaiah 2:1-5': OT, 'Romans 13:11-14': EPISTLE });

    const startxref = parseInt(pdf.slice(pdf.lastIndexOf('startxref') + 9).trim(), 10);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');

    const header = /xref\n0 (\d+)\n/.exec(pdf.slice(startxref));
    const size = parseInt(header[1], 10);
    expect(pdf).toContain('/Size ' + size);

    const entries = pdf.slice(startxref + header.index + header[0].length)
      .split('\n').slice(0, size);
    expect(entries[0]).toContain('65535 f');
    for (let id = 1; id < size; id++) {
      const off = parseInt(entries[id].slice(0, 10), 10);
      expect(pdf.slice(off, off + String(id).length + 6)).toBe(id + ' 0 obj');
    }
  });
});

describe.skipIf(!HAVE_PYPDF)('readings PDF, parsed by a real PDF reader', () => {
  it('opens, and every word put in comes back out', () => {
    const ctx = scheduler();
    const pdf = ctx.buildReadingsPdfFor({ name: 'Larry Hawkins' }, ASSIGNMENTS,
      { 'Isaiah 2:1-5': OT, 'Romans 13:11-14': EPISTLE });
    const r = renderText(pdf);

    expect(r.pages).toBe(1);
    expect(r.boxes[0]).toEqual([612, 792]);      // US Letter
    expect(r.text).toContain('Timothy Lutheran Church');
    expect(r.text).toContain('Larry Hawkins');
    expect(r.text).toContain('Aug 16, 2026');
    expect(r.text).toContain('Lector');
    expect(r.text).toContain('Isaiah 2:1-5');
    expect(r.text).toContain('Romans 13:(8-10) 11-14');   // optional verses kept
    expect(r.text).toContain('the son of Amoz');
    expect(r.text).toContain('Besides this you know the time');
  });

  it('preserves the curly quotes and em dash rather than mangling them', () => {
    const ctx = scheduler();
    const pdf = ctx.buildReadingsPdfFor({ name: 'L' }, ASSIGNMENTS, { 'Isaiah 2:1-5': OT });
    const r = renderText(pdf);
    expect(r.text).toContain('“Come, let us go up');
    expect(r.text).toContain('his ways”—and');
    expect(r.text).not.toContain('?');           // nothing fell through to the placeholder
  });

  it('carries the Crossway notice, with its ® and © intact', () => {
    const ctx = scheduler();
    const pdf = ctx.buildReadingsPdfFor({ name: 'L' }, ASSIGNMENTS, { 'Isaiah 2:1-5': OT });
    const r = renderText(pdf);
    expect(r.text).toContain('ESV® Bible');
    expect(r.text).toContain('© 2001 by Crossway');
    expect(r.text).toContain('All rights reserved');
  });

  it('breaks across pages, ending with the notice, when the readings are long', () => {
    const ctx = scheduler();
    const long = Array.from({ length: 40 }, () => OT).join(' ');
    const pdf = ctx.buildReadingsPdfFor({ name: 'L' }, ASSIGNMENTS, { 'Isaiah 2:1-5': long });
    const r = renderText(pdf);
    expect(r.pages).toBeGreaterThan(1);
    expect(r.last).toContain('Crossway');
    r.boxes.forEach((b) => expect(b).toEqual([612, 792]));
  });



  it('stays a small attachment', () => {
    const ctx = scheduler();
    const att = ctx.readingsPdfAttachment({ name: 'L' }, ASSIGNMENTS,
      { 'Isaiah 2:1-5': OT, 'Romans 13:11-14': EPISTLE });
    const bytes = Buffer.from(att.content, 'base64').length;
    expect(bytes).toBeLessThan(20 * 1024);        // no embedded font, so a few KB
    expect(bytes).toBeGreaterThan(500);
  });
});
