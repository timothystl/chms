import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleImportApi } from '../src/api-import.js';

// Scanned register-page images (see migrations/0040_register_scan_pages.sql): lets a
// church_register row's own `pdf_page` field link to the scanned book page it was
// transcribed from — useful since the register is AI-transcribed from book scans.

function makeDb() {
  const raw = new DatabaseSync(':memory:');
  const db = {
    prepare(sql) {
      const st = raw.prepare(sql);
      let binds = [];
      const api = {
        bind(...a) { binds = a; return api; },
        all() { return Promise.resolve({ results: st.all(...binds) }); },
        first() { return Promise.resolve(st.get(...binds) ?? null); },
        run() { const r = st.run(...binds); return Promise.resolve({ meta: { last_row_id: r.lastInsertRowid, changes: r.changes } }); },
      };
      return api;
    },
  };
  raw.exec(`
    CREATE TABLE register_scan_pages(id INTEGER PRIMARY KEY, type TEXT, page TEXT, r2_key TEXT,
      uploaded_at TEXT DEFAULT (datetime('now')));
    CREATE UNIQUE INDEX idx_register_scan_type_page ON register_scan_pages(type, page);
  `);
  return db;
}

function fakePhotos() {
  const store = new Map();
  return {
    store,
    put(key, buf, opts) { store.set(key, { buf, ct: opts?.httpMetadata?.contentType }); return Promise.resolve(); },
    get(key) { return Promise.resolve(store.has(key) ? { body: store.get(key).buf } : null); },
    delete(key) { store.delete(key); return Promise.resolve(); },
  };
}

// Minimal JPEG magic bytes, enough for validateImageUpload's signature sniff.
function jpegFile(name) {
  const bytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return { name, size: bytes.length, arrayBuffer: () => Promise.resolve(bytes.buffer) };
}

function req(method, formData) {
  return { method, formData: () => Promise.resolve(formData) };
}

function fd(obj) {
  return { get: (k) => (k in obj ? obj[k] : null) };
}

describe('register/scans', () => {
  it('uploads a page image and lists it back by type', async () => {
    const db = makeDb();
    const env = { PHOTOS: fakePhotos() };
    const uploadRes = await handleImportApi(
      req('POST', fd({ type: 'baptism', page: '42', file: jpegFile('042.jpg') })),
      env, new URL('http://x/'), 'POST', 'register/scans', db, true, true, true, true
    );
    const uploadBody = await uploadRes.json();
    expect(uploadBody.ok).toBe(true);
    expect(uploadBody.url).toBe('/admin/r2photo/register-scans/baptism/42.jpg');

    const listRes = await handleImportApi(
      { method: 'GET' }, env, new URL('http://x/?type=baptism'), 'GET', 'register/scans', db, true, true, true, true
    );
    const listBody = await listRes.json();
    expect(listBody.pages).toHaveLength(1);
    expect(listBody.pages[0].page).toBe('42');
  });

  it('re-uploading the same (type, page) replaces the image, not adds a duplicate', async () => {
    const db = makeDb();
    const env = { PHOTOS: fakePhotos() };
    await handleImportApi(req('POST', fd({ type: 'baptism', page: '42', file: jpegFile('a.jpg') })), env, new URL('http://x/'), 'POST', 'register/scans', db, true, true, true, true);
    await handleImportApi(req('POST', fd({ type: 'baptism', page: '42', file: jpegFile('b.jpg') })), env, new URL('http://x/'), 'POST', 'register/scans', db, true, true, true, true);
    const listRes = await handleImportApi({ method: 'GET' }, env, new URL('http://x/?type=baptism'), 'GET', 'register/scans', db, true, true, true, true);
    const listBody = await listRes.json();
    expect(listBody.pages).toHaveLength(1);
  });

  it('rejects an unrecognized register type', async () => {
    const db = makeDb();
    const env = { PHOTOS: fakePhotos() };
    const res = await handleImportApi(
      req('POST', fd({ type: 'spam', page: '1', file: jpegFile('x.jpg') })),
      env, new URL('http://x/'), 'POST', 'register/scans', db, true, true, true, true
    );
    expect(res.status).toBe(400);
  });

  it('deletes a scan and its R2 object', async () => {
    const db = makeDb();
    const env = { PHOTOS: fakePhotos() };
    const upload = await (await handleImportApi(req('POST', fd({ type: 'confirmation', page: '7', file: jpegFile('x.jpg') })), env, new URL('http://x/'), 'POST', 'register/scans', db, true, true, true, true)).json();
    expect(env.PHOTOS.store.size).toBe(1);
    await handleImportApi({ method: 'DELETE' }, env, new URL('http://x/'), 'DELETE', 'register/scans/' + upload.id, db, true, true, true, true);
    expect(env.PHOTOS.store.size).toBe(0);
    const listBody = await (await handleImportApi({ method: 'GET' }, env, new URL('http://x/?type=confirmation'), 'GET', 'register/scans', db, true, true, true, true)).json();
    expect(listBody.pages).toHaveLength(0);
  });

  it('separates pages by register type — a baptism p.42 does not collide with a confirmation p.42', async () => {
    const db = makeDb();
    const env = { PHOTOS: fakePhotos() };
    await handleImportApi(req('POST', fd({ type: 'baptism', page: '42', file: jpegFile('a.jpg') })), env, new URL('http://x/'), 'POST', 'register/scans', db, true, true, true, true);
    await handleImportApi(req('POST', fd({ type: 'confirmation', page: '42', file: jpegFile('b.jpg') })), env, new URL('http://x/'), 'POST', 'register/scans', db, true, true, true, true);
    const baptismList = await (await handleImportApi({ method: 'GET' }, env, new URL('http://x/?type=baptism'), 'GET', 'register/scans', db, true, true, true, true)).json();
    expect(baptismList.pages).toHaveLength(1);
    const allList = await (await handleImportApi({ method: 'GET' }, env, new URL('http://x/'), 'GET', 'register/scans', db, true, true, true, true)).json();
    expect(allList.pages).toHaveLength(2);
  });
});
