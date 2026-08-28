import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleImportApi } from '../src/api-import.js';

// Read-only exports for reviewing the register's page numbers against the scanned-page image
// library -- built after a live report that some page numbers and images weren't lining up.
// Neither endpoint writes anything; they only ever SELECT.

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
    CREATE TABLE church_register (
      id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT DEFAULT '', event_date TEXT DEFAULT '',
      name TEXT DEFAULT '', name2 TEXT DEFAULT '', officiant TEXT DEFAULT '', notes TEXT DEFAULT '',
      person_id INTEGER, created_at TEXT DEFAULT (datetime('now')), record_type TEXT DEFAULT '',
      dob TEXT DEFAULT '', place_of_birth TEXT DEFAULT '', baptism_place TEXT DEFAULT '',
      father TEXT DEFAULT '', mother TEXT DEFAULT '', sponsors TEXT DEFAULT '', pdf_page TEXT DEFAULT ''
    );
    CREATE TABLE register_scan_pages(id INTEGER PRIMARY KEY, type TEXT, page TEXT, r2_key TEXT,
      uploaded_at TEXT DEFAULT (datetime('now')));
  `);
  return db;
}

function parseCsv(text) {
  const lines = text.split('\r\n').filter(Boolean);
  const header = lines[0].split(',').map((h) => h.replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map((line) => {
    // Simple splitter good enough for this codebase's own csvRow quoting (fields with commas
    // are always wrapped in quotes by csvRow).
    const cells = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && !inQ) inQ = true;
      else if (ch === '"' && inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"' && inQ) inQ = false;
      else if (ch === ',' && !inQ) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    const obj = {};
    header.forEach((h, i) => { obj[h] = cells[i]; });
    return obj;
  });
  return { header, rows };
}

const req = { method: 'GET' };
const ADMIN = [true, false, false, false]; // isAdmin, isFinance, isStaff, canEdit
const NOT_ADMIN = [false, true, true, true];

describe('GET /export/register-scans', () => {
  it('lists every uploaded scan page with its URL', async () => {
    const db = makeDb();
    await db.prepare('INSERT INTO register_scan_pages(type,page,r2_key) VALUES(?,?,?)').bind('baptism', '42', 'register-scans/baptism/42.jpg').run();
    await db.prepare('INSERT INTO register_scan_pages(type,page,r2_key) VALUES(?,?,?)').bind('baptism', '43', 'register-scans/baptism/43.jpg').run();
    const res = await handleImportApi(req, {}, new URL('http://x/export/register-scans'), 'GET', 'export/register-scans', db, ...ADMIN);
    expect(res.status).toBe(200);
    const text = await res.text();
    const { rows } = parseCsv(text);
    expect(rows).toHaveLength(2);
    expect(rows[0].Type).toBe('baptism');
    expect(rows[0].Page).toBe('42');
    expect(rows[0]['Image URL']).toBe('/admin/r2photo/register-scans/baptism/42.jpg');
  });

  it('refuses a non-admin', async () => {
    const db = makeDb();
    const res = await handleImportApi(req, {}, new URL('http://x/export/register-scans'), 'GET', 'export/register-scans', db, ...NOT_ADMIN);
    expect(res.status).toBe(403);
  });
});

describe('GET /export/register-reconcile', () => {
  it('flags a page with entries but no scan', async () => {
    const db = makeDb();
    await db.prepare(`INSERT INTO church_register(type,event_date,name,pdf_page) VALUES(?,?,?,?)`)
      .bind('baptism', '1990-01-01', 'Jane Doe', '42').run();
    const res = await handleImportApi(req, {}, new URL('http://x/export/register-reconcile'), 'GET', 'export/register-reconcile', db, ...ADMIN);
    const { rows } = parseCsv(await res.text());
    const row = rows.find((r) => r.Page === '42');
    expect(row.Status).toBe('Missing scan image');
    expect(row['Entries On This Page']).toBe('1');
    expect(row['Entry Names']).toBe('Jane Doe');
    expect(row['Scan Uploaded']).toBe('No');
  });

  it('flags a scan with no matching register entries', async () => {
    const db = makeDb();
    await db.prepare('INSERT INTO register_scan_pages(type,page,r2_key) VALUES(?,?,?)').bind('baptism', '99', 'register-scans/baptism/99.jpg').run();
    const res = await handleImportApi(req, {}, new URL('http://x/export/register-reconcile'), 'GET', 'export/register-reconcile', db, ...ADMIN);
    const { rows } = parseCsv(await res.text());
    const row = rows.find((r) => r.Page === '99');
    expect(row.Status).toBe('Scan has no matching entries');
    expect(row['Entries On This Page']).toBe('0');
    expect(row['Scan Uploaded']).toBe('Yes');
    expect(row['Scan URL']).toBe('/admin/r2photo/register-scans/baptism/99.jpg');
  });

  it('marks a page OK when both an entry and a scan exist', async () => {
    const db = makeDb();
    await db.prepare(`INSERT INTO church_register(type,event_date,name,pdf_page) VALUES(?,?,?,?)`)
      .bind('baptism', '1990-01-01', 'Jane Doe', '42').run();
    await db.prepare('INSERT INTO register_scan_pages(type,page,r2_key) VALUES(?,?,?)').bind('baptism', '42', 'register-scans/baptism/42.jpg').run();
    const res = await handleImportApi(req, {}, new URL('http://x/export/register-reconcile'), 'GET', 'export/register-reconcile', db, ...ADMIN);
    const { rows } = parseCsv(await res.text());
    const row = rows.find((r) => r.Page === '42');
    expect(row.Status).toBe('OK');
    expect(row['Scan Uploaded']).toBe('Yes');
  });

  it('counts multiple entries sharing a page and joins their names', async () => {
    const db = makeDb();
    await db.prepare(`INSERT INTO church_register(type,event_date,name,pdf_page) VALUES(?,?,?,?)`)
      .bind('baptism', '1990-01-01', 'Jane Doe', '42').run();
    await db.prepare(`INSERT INTO church_register(type,event_date,name,pdf_page) VALUES(?,?,?,?)`)
      .bind('baptism', '1990-01-02', 'John Roe', '42').run();
    const res = await handleImportApi(req, {}, new URL('http://x/export/register-reconcile'), 'GET', 'export/register-reconcile', db, ...ADMIN);
    const { rows } = parseCsv(await res.text());
    const row = rows.find((r) => r.Page === '42');
    expect(row['Entries On This Page']).toBe('2');
    expect(row['Entry Names']).toContain('Jane Doe');
    expect(row['Entry Names']).toContain('John Roe');
  });

  it('keeps different register types with the same page number separate', async () => {
    const db = makeDb();
    await db.prepare(`INSERT INTO church_register(type,event_date,name,pdf_page) VALUES(?,?,?,?)`)
      .bind('baptism', '1990-01-01', 'Jane Doe', '5').run();
    await db.prepare('INSERT INTO register_scan_pages(type,page,r2_key) VALUES(?,?,?)').bind('funeral', '5', 'register-scans/funeral/5.jpg').run();
    const res = await handleImportApi(req, {}, new URL('http://x/export/register-reconcile'), 'GET', 'export/register-reconcile', db, ...ADMIN);
    const { rows } = parseCsv(await res.text());
    const baptismRow = rows.find((r) => r.Page === '5' && r.Type === 'baptism');
    const funeralRow = rows.find((r) => r.Page === '5' && r.Type === 'funeral');
    expect(baptismRow.Status).toBe('Missing scan image');
    expect(funeralRow.Status).toBe('Scan has no matching entries');
  });

  it('refuses a non-admin', async () => {
    const db = makeDb();
    const res = await handleImportApi(req, {}, new URL('http://x/export/register-reconcile'), 'GET', 'export/register-reconcile', db, ...NOT_ADMIN);
    expect(res.status).toBe(403);
  });
});
