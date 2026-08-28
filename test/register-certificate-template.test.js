import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleImportApi } from '../src/api-import.js';

// Certificate templates: an admin-uploaded background image per register type, with a
// positioned-field list, so printing a certificate overlays real entry data onto the church's
// own design instead of the app's generic bordered layout.

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
    CREATE TABLE register_certificate_templates(
      id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL UNIQUE, r2_key TEXT NOT NULL,
      fields_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT DEFAULT (datetime('now')));
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

function fd(obj) { return { get: (k) => (k in obj ? obj[k] : null) }; }
function postReq(formData) { return { method: 'POST', formData: () => Promise.resolve(formData) }; }
function jsonReq(method, body) { return { method, json: () => Promise.resolve(body) }; }

const ADMIN = [true, false, false, false];
const NOT_ADMIN = [false, true, true, true];

describe('GET /register/certificate-template', () => {
  it('returns null when nothing has been uploaded yet', async () => {
    const db = makeDb();
    const res = await handleImportApi({ method: 'GET' }, {}, new URL('http://x/register/certificate-template?type=baptism'), 'GET', 'register/certificate-template', db, ...NOT_ADMIN);
    const body = await res.json();
    expect(body.template).toBeNull();
  });

  it('rejects an unrecognized type', async () => {
    const db = makeDb();
    const res = await handleImportApi({ method: 'GET' }, {}, new URL('http://x/register/certificate-template?type=nope'), 'GET', 'register/certificate-template', db, ...NOT_ADMIN);
    expect(res.status).toBe(400);
  });

  it('is readable by a non-admin (printing needs it)', async () => {
    const db = makeDb();
    await db.prepare('INSERT INTO register_certificate_templates(type, r2_key) VALUES(?,?)').bind('baptism', 'register-certificate-templates/baptism.jpg').run();
    const res = await handleImportApi({ method: 'GET' }, {}, new URL('http://x/register/certificate-template?type=baptism'), 'GET', 'register/certificate-template', db, ...NOT_ADMIN);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.template.url).toBe('/admin/r2photo/register-certificate-templates/baptism.jpg');
  });
});

describe('POST /register/certificate-template', () => {
  it('uploads a new template with empty fields', async () => {
    const db = makeDb();
    const env = { PHOTOS: fakePhotos() };
    const res = await handleImportApi(postReq(fd({ type: 'baptism', file: jpegFile('cert.jpg') })), env, new URL('http://x/register/certificate-template'), 'POST', 'register/certificate-template', db, ...ADMIN);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.fields).toEqual([]);
    expect(env.PHOTOS.store.size).toBe(1);
  });

  it('refuses a non-admin', async () => {
    const db = makeDb();
    const env = { PHOTOS: fakePhotos() };
    const res = await handleImportApi(postReq(fd({ type: 'baptism', file: jpegFile('cert.jpg') })), env, new URL('http://x/register/certificate-template'), 'POST', 'register/certificate-template', db, ...NOT_ADMIN);
    expect(res.status).toBe(403);
  });

  it('re-uploading a refined image keeps the existing field positions', async () => {
    const db = makeDb();
    const env = { PHOTOS: fakePhotos() };
    await handleImportApi(postReq(fd({ type: 'baptism', file: jpegFile('v1.jpg') })), env, new URL('http://x/register/certificate-template'), 'POST', 'register/certificate-template', db, ...ADMIN);
    await handleImportApi(jsonReq('PUT', { type: 'baptism', fields: [{ key: 'name', x_pct: 50, y_pct: 20 }] }), env, new URL('http://x/register/certificate-template'), 'PUT', 'register/certificate-template', db, ...ADMIN);
    // Re-upload a "more refined" version of the same image.
    const res2 = await handleImportApi(postReq(fd({ type: 'baptism', file: jpegFile('v2.jpg') })), env, new URL('http://x/register/certificate-template'), 'POST', 'register/certificate-template', db, ...ADMIN);
    const body2 = await res2.json();
    expect(body2.fields).toHaveLength(1);
    expect(body2.fields[0].key).toBe('name');
  });
});

describe('PUT /register/certificate-template', () => {
  it('saves positioned fields, sanitized', async () => {
    const db = makeDb();
    await db.prepare('INSERT INTO register_certificate_templates(type, r2_key) VALUES(?,?)').bind('baptism', 'k').run();
    const res = await handleImportApi(
      jsonReq('PUT', { type: 'baptism', fields: [
        { key: 'name', x_pct: '50.5', y_pct: 12, font_size_pt: '18', align: 'left' },
        { key: 'date', x_pct: 20, y_pct: 90, align: 'bogus' }, // unrecognized align falls back to center
        { notKey: 'ignored' }, // no key -- dropped
      ] }),
      {}, new URL('http://x/register/certificate-template'), 'PUT', 'register/certificate-template', db, ...ADMIN
    );
    const body = await res.json();
    expect(body.fields).toHaveLength(2);
    expect(body.fields[0]).toEqual({ key: 'name', x_pct: 50.5, y_pct: 12, font_size_pt: 18, align: 'left' });
    expect(body.fields[1].align).toBe('center');
  });

  it('404s when no template exists yet for that type', async () => {
    const db = makeDb();
    const res = await handleImportApi(jsonReq('PUT', { type: 'baptism', fields: [] }), {}, new URL('http://x/register/certificate-template'), 'PUT', 'register/certificate-template', db, ...ADMIN);
    expect(res.status).toBe(404);
  });

  it('refuses a non-admin', async () => {
    const db = makeDb();
    await db.prepare('INSERT INTO register_certificate_templates(type, r2_key) VALUES(?,?)').bind('baptism', 'k').run();
    const res = await handleImportApi(jsonReq('PUT', { type: 'baptism', fields: [] }), {}, new URL('http://x/register/certificate-template'), 'PUT', 'register/certificate-template', db, ...NOT_ADMIN);
    expect(res.status).toBe(403);
  });
});

describe('DELETE /register/certificate-template', () => {
  it('removes the template row and its R2 object', async () => {
    const db = makeDb();
    const env = { PHOTOS: fakePhotos() };
    await env.PHOTOS.put('register-certificate-templates/baptism.jpg', new Uint8Array([1]));
    await db.prepare('INSERT INTO register_certificate_templates(type, r2_key) VALUES(?,?)').bind('baptism', 'register-certificate-templates/baptism.jpg').run();
    const res = await handleImportApi({ method: 'DELETE' }, env, new URL('http://x/register/certificate-template?type=baptism'), 'DELETE', 'register/certificate-template', db, ...ADMIN);
    expect((await res.json()).ok).toBe(true);
    expect(env.PHOTOS.store.size).toBe(0);
    const remaining = (await db.prepare('SELECT * FROM register_certificate_templates').all()).results;
    expect(remaining).toHaveLength(0);
  });

  it('refuses a non-admin', async () => {
    const db = makeDb();
    const res = await handleImportApi({ method: 'DELETE' }, {}, new URL('http://x/register/certificate-template?type=baptism'), 'DELETE', 'register/certificate-template', db, ...NOT_ADMIN);
    expect(res.status).toBe(403);
  });
});
