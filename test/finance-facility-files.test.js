import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../apps/finance/shell.js';
import { cleanFileName, sniffContentType } from '../apps/finance/facility-files.js';
import { saveFacilityAsset, saveFacilityPmTask, saveFacilityProject } from '../apps/finance/facilities-service.js';

const sql = (name) => readFileSync(new URL(`../apps/finance/migrations/${name}`, import.meta.url), 'utf8');

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(sql('0010_finance_facilities.sql'));
  sqlite.exec(sql('0012_finance_facility_files.sql'));
  const statement = (text, args = []) => ({
    sql: text,
    bind: (...next) => statement(text, next),
    async run() { const r = sqlite.prepare(text).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    async first() { return sqlite.prepare(text).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(text).all(...args) }; },
  });
  const db = {
    prepare: (text) => statement(text),
    async batch(stmts) {
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(/^\s*SELECT/i.test(s.sql) ? await s.all() : await s.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { db, sqlite };
}

// An R2-shaped bucket kept in memory.
function makeBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, bytes, options) { objects.set(key, { bytes: new Uint8Array(bytes), contentType: options?.httpMetadata?.contentType }); },
    async get(key) { const o = objects.get(key); return o ? { body: o.bytes, size: o.bytes.byteLength } : null; },
    async head(key) { const o = objects.get(key); return o ? { size: o.bytes.byteLength } : null; },
    async delete(key) { objects.delete(key); },
  };
}

const JPEG = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 74, 70, 73, 70, 0, 1]);
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n');
const adminRole = { role: 'admin', identity: 'office@example.com', permissions: { finance: 'edit', giving: 'edit' } };
const viewer = { role: 'finance', permissions: { finance: 'view', giving: 'view' } };

function envFor(role, db, bucket) {
  return {
    ENVIRONMENT: 'production', RELEASE_SHA: 'test', FINANCE_DB: db, FINANCE_CONTRACT_API_KEY: 'k', FACILITY_FILES: bucket,
    CONNECT_SERVICE: { fetch: async () => (role ? new Response(JSON.stringify(role)) : new Response('{}', { status: 403 })) },
  };
}

function upload(path, fields, files = [], headers = {}) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  for (const [name, bytes, type] of files) body.append('files', new File([bytes], name, { type }));
  return new Request(`https://finance.test${path}`, {
    method: 'POST', body,
    headers: { 'Cf-Access-Jwt-Assertion': 'jwt', 'Sec-Fetch-Site': 'same-origin', ...headers },
  });
}

const get = (path, role, db, bucket) => worker.fetch(new Request(`https://finance.test${path}`, { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } }), envFor(role, db, bucket));

describe('Facilities photos and documents', () => {
  it('recognizes photos and PDFs by their bytes, not their names', () => {
    expect(sniffContentType(JPEG)).toBe('image/jpeg');
    expect(sniffContentType(PDF)).toBe('application/pdf');
    expect(sniffContentType(new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))).toBe('image/png');
    expect(sniffContentType(new TextEncoder().encode('\0\0\0\x18ftypheic\0\0'))).toBe('image/heic');
    expect(sniffContentType(new TextEncoder().encode('<html><script>'))).toBeNull();
    expect(cleanFileName('C:\\photos\\"rtu"<1>.jpg')).toBe('rtu1.jpg');
    expect(cleanFileName('', 'application/pdf')).toBe('file.pdf');
  });

  it('attaches a photo to an asset, shows it on the record, and serves it only to Facilities viewers', async () => {
    const { db, sqlite } = makeDb();
    const bucket = makeBucket();
    const { id } = await saveFacilityAsset(db, { name: 'RTU #1', category: 'HVAC', installed_month: '2015-05', expected_life_years: '20' });
    const res = await worker.fetch(upload('/api/v1/facilities/file-upload', { record_type: 'asset', record_id: String(id), caption: 'Nameplate', return_page: 'assets', return_asset: String(id) }, [['label.jpg', JPEG, 'image/jpeg']]), envFor(adminRole, db, bucket));
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(`/?section=facilities&page=assets&status=ok&asset=${id}`);
    const row = sqlite.prepare('SELECT * FROM finance_facility_files').get();
    expect(row).toMatchObject({ record_type: 'asset', record_id: id, content_type: 'image/jpeg', caption: 'Nameplate', file_name: 'label.jpg', created_by: 'office@example.com' });
    expect(row.object_key).toMatch(new RegExp(`^facilities/asset/${id}/[0-9a-f-]{36}\\.jpg$`));
    expect(bucket.objects.get(row.object_key).bytes).toEqual(JPEG);

    const page = await (await get(`/?section=facilities&page=assets&asset=${id}`, adminRole, db, bucket)).text();
    expect(page).toContain(`<img src="/api/v1/facilities/file?id=${row.id}" alt="Nameplate"`);
    expect(page).toContain('action="/api/v1/facilities/file-upload" enctype="multipart/form-data"');
    const viewerPage = await (await get(`/?section=facilities&page=assets&asset=${id}`, viewer, db, bucket)).text();
    expect(viewerPage).toContain(`/api/v1/facilities/file?id=${row.id}`);
    expect(viewerPage).not.toContain('file-upload');
    expect(viewerPage).not.toContain('file-remove');

    const file = await get(`/api/v1/facilities/file?id=${row.id}`, viewer, db, bucket);
    expect(file.status).toBe(200);
    expect(file.headers.get('Content-Type')).toBe('image/jpeg');
    expect(file.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(file.headers.get('Cache-Control')).toBe('private, max-age=3600');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(JPEG);
    expect((await get(`/api/v1/facilities/file?id=${row.id}`, { role: 'staff', permissions: { finance: 'none' } }, db, bucket)).status).toBe(403);
    expect((await get(`/api/v1/facilities/file?id=${row.id}`, null, db, bucket)).status).toBe(403);
    expect((await get('/api/v1/facilities/file?id=999', adminRole, db, bucket)).status).toBe(404);
    expect((await get('/api/v1/facilities/file?id=abc', adminRole, db, bucket)).status).toBe(404);
  });

  it('refuses files that are not photos or PDFs, view-only roles, and oversized posts, storing nothing', async () => {
    const { db, sqlite } = makeDb();
    const bucket = makeBucket();
    const { id } = await saveFacilityAsset(db, { name: 'Boiler', category: 'Boilers', installed_month: '2014-09', expected_life_years: '25' });
    const fields = { record_type: 'asset', record_id: String(id), return_page: 'assets', return_asset: String(id) };
    const fake = await worker.fetch(upload('/api/v1/facilities/file-upload', fields, [['photo.jpg', new TextEncoder().encode('<script>alert(1)</script>'), 'image/jpeg']]), envFor(adminRole, db, bucket));
    expect(fake.headers.get('Location')).toContain('reason=invalid');
    expect(fake.headers.get('Location')).toContain(`page=assets`);
    expect(fake.headers.get('Location')).toContain(`asset=${id}`);
    const denied = await worker.fetch(upload('/api/v1/facilities/file-upload', fields, [['a.jpg', JPEG, 'image/jpeg']]), envFor(viewer, db, bucket));
    expect(denied.headers.get('Location')).toContain('reason=access_denied');
    const big = await worker.fetch(upload('/api/v1/facilities/file-upload', fields, [['a.jpg', JPEG, 'image/jpeg']], { 'Content-Length': String(200 * 1024 * 1024) }), envFor(adminRole, db, bucket));
    expect(big.headers.get('Location')).toContain('reason=too_large');
    const missing = await worker.fetch(upload('/api/v1/facilities/file-upload', { ...fields, record_id: '999' }, [['a.jpg', JPEG, 'image/jpeg']]), envFor(adminRole, db, bucket));
    expect(missing.headers.get('Location')).toContain('reason=invalid');
    const noStorage = await worker.fetch(upload('/api/v1/facilities/file-upload', fields, [['a.jpg', JPEG, 'image/jpeg']]), envFor(adminRole, db, undefined));
    expect(new URL(noStorage.headers.get('Location'), 'https://finance.test').searchParams.get('message')).toBe('Photo storage is not set up yet.');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM finance_facility_files').get().n).toBe(0);
    expect(bucket.objects.size).toBe(0);
  });

  it('attaches a scanned service order while logging service, and removing the entry removes its files', async () => {
    const { db, sqlite } = makeDb();
    const bucket = makeBucket();
    const res = await worker.fetch(upload('/api/v1/facilities/service-log', { service_date: '2026-09-20', service_type: 'Repair', description: 'Pump replaced', cost: '480' }, [['order.pdf', PDF, 'application/pdf'], ['after.jpg', JPEG, 'image/jpeg']]), envFor(adminRole, db, bucket));
    const entryId = sqlite.prepare('SELECT id FROM finance_facility_service_log').get().id;
    expect(res.headers.get('Location')).toBe(`/?section=facilities&page=service-history&status=ok&entry=${entryId}`);
    expect(sqlite.prepare("SELECT content_type FROM finance_facility_files WHERE record_type = 'service' ORDER BY id").all().map((r) => r.content_type)).toEqual(['application/pdf', 'image/jpeg']);
    const entryPage = await (await get(`/?section=facilities&page=service-history&entry=${entryId}`, adminRole, db, bucket)).text();
    expect(entryPage).toContain('Service order, invoice &amp; photos');
    expect(entryPage).toContain('<span class="doc-badge">PDF</span>');
    const list = await (await get('/?section=facilities&page=service-history', adminRole, db, bucket)).text();
    expect(list).toContain('2 files');
    const pdfId = sqlite.prepare("SELECT id FROM finance_facility_files WHERE content_type = 'application/pdf'").get().id;
    const pdf = await get(`/api/v1/facilities/file?id=${pdfId}`, adminRole, db, bucket);
    expect(pdf.headers.get('Content-Type')).toBe('application/pdf');
    expect(pdf.headers.get('Content-Security-Policy')).toBeNull();

    // A bad file refuses the whole entry, so no half-saved history is left behind.
    const bad = await worker.fetch(upload('/api/v1/facilities/service-log', { service_date: '2026-09-21', service_type: 'Repair', description: 'Other' }, [['x.jpg', new Uint8Array([1, 2, 3]), 'image/jpeg']]), envFor(adminRole, db, bucket));
    expect(bad.headers.get('Location')).toContain('reason=invalid');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM finance_facility_service_log').get().n).toBe(1);

    const remove = new Request('https://finance.test/api/v1/facilities/service-remove', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': 'jwt', 'Sec-Fetch-Site': 'same-origin' }, body: new URLSearchParams({ id: String(entryId) }) });
    expect((await worker.fetch(remove, envFor(adminRole, db, bucket))).headers.get('Location')).toContain('status=ok');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM finance_facility_files').get().n).toBe(0);
    expect(bucket.objects.size).toBe(0);
  });

  it('attaches to recurring tasks and projects, and removes a single file', async () => {
    const { db, sqlite } = makeDb();
    const bucket = makeBucket();
    const task = await saveFacilityPmTask(db, { name: 'HVAC filters', interval_months: '3' });
    const project = await saveFacilityProject(db, { name: 'Roof', status: 'Planned', target_month: '2027-06', cost: '90000' });
    const taskRes = await worker.fetch(upload('/api/v1/facilities/file-upload', { record_type: 'pm_task', record_id: String(task.id) }, [['contract.pdf', PDF, 'application/pdf']]), envFor(adminRole, db, bucket));
    expect(taskRes.headers.get('Location')).toBe(`/?section=facilities&page=preventive-maintenance&status=ok&task=${task.id}`);
    const projRes = await worker.fetch(upload('/api/v1/facilities/file-upload', { record_type: 'project', record_id: String(project.id) }, [['bid.jpg', JPEG, 'image/jpeg']]), envFor(adminRole, db, bucket));
    expect(projRes.headers.get('Location')).toBe(`/?section=facilities&page=capital-projects&status=ok&project=${project.id}`);
    const taskPage = await (await get(`/?section=facilities&page=preventive-maintenance&task=${task.id}`, adminRole, db, bucket)).text();
    expect(taskPage).toContain('<h2>HVAC filters</h2>');
    expect(taskPage).toContain('contract.pdf');
    const projects = await (await get('/?section=facilities&page=capital-projects', viewer, db, bucket)).text();
    expect(projects).toContain('Photos &amp; documents (1)');
    expect(projects).toContain('class="thumb-row"');

    const fileId = sqlite.prepare("SELECT id FROM finance_facility_files WHERE record_type = 'project'").get().id;
    const key = sqlite.prepare('SELECT object_key FROM finance_facility_files WHERE id = ?').get(fileId).object_key;
    const removed = await worker.fetch(new Request('https://finance.test/api/v1/facilities/file-remove', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': 'jwt', 'Sec-Fetch-Site': 'same-origin' }, body: new URLSearchParams({ id: String(fileId) }) }), envFor(adminRole, db, bucket));
    expect(removed.headers.get('Location')).toBe(`/?section=facilities&page=capital-projects&status=ok&project=${project.id}`);
    expect(bucket.objects.has(key)).toBe(false);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM finance_facility_files').get().n).toBe(1);
  });
});
