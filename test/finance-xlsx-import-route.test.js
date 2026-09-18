import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../apps/finance/shell.js';

// Same minimal D1-shaped wrapper around node:sqlite used elsewhere in this suite (see
// test/finance-property-ledger-write-route.test.js) -- Finance's OWN schema, from
// apps/finance/migrations/0001_finance_foundation.sql.
const foundationSql = readFileSync(new URL('../apps/finance/migrations/0001_finance_foundation.sql', import.meta.url), 'utf8');

function makeFinanceDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(foundationSql);
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
            async first() { return sqlite.prepare(sql).get(...args) ?? null; },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async first() { return sqlite.prepare(sql).get() ?? null; },
        async all() { return { results: sqlite.prepare(sql).all() }; },
        async run() { sqlite.prepare(sql).run(); return { meta: {} }; },
      };
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
    _raw: sqlite,
  };
}

function baseEnv() {
  return { ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha', FINANCE_DB: makeFinanceDb() };
}

function postJson(path, body, env) {
  return worker.fetch(new Request(`https://finance.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), env);
}

// ── Minimal ZIP writer (STORED entries) — same helper duplicated per this suite's existing
// per-file convention (see test/finance-xlsx-import-service.test.js, test/finance-property.test.js).
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xFF;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function buildTestXlsxZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const dataBuf = Buffer.from(content, 'utf8');
    const crc = crc32(dataBuf);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    chunks.push(localHeader, nameBuf, dataBuf);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([centralHeader, nameBuf]));
    offset += localHeader.length + nameBuf.length + dataBuf.length;
  }
  const centralBuf = Buffer.concat(central);
  const cdOffset = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);
  const full = Buffer.concat([...chunks, centralBuf, eocd]);
  return full.buffer.slice(full.byteOffset, full.byteOffset + full.byteLength);
}
function colLetter(idx) {
  let n = idx + 1, s = '';
  while (n > 0) { const rem = (n - 1) % 26; s = String.fromCharCode(65 + rem) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function cellXml(rowNum, colIdx, value) {
  if (value == null) return '';
  const ref = colLetter(colIdx) + rowNum;
  if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
  const esc = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<c r="${ref}" t="inlineStr"><is><t>${esc}</t></is></c>`;
}
function buildSheetXml(rows) {
  const rowsXml = rows.map((cells, i) => {
    const rowNum = i + 1;
    return `<row r="${rowNum}">${(cells || []).map((v, c) => cellXml(rowNum, c, v)).join('')}</row>`;
  }).join('');
  return `<?xml version="1.0"?><worksheet><sheetData>${rowsXml}</sheetData></worksheet>`;
}
function buildTestWorkbookBase64(gridRows) {
  const zip = buildTestXlsxZip({
    'xl/workbook.xml': `<?xml version="1.0"?><workbook><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': buildSheetXml(gridRows),
  });
  return Buffer.from(zip).toString('base64');
}

const CHURCH_XLSX_GRID = [
  ['January - December 2026'],
  ['', 'Actual', 'Budget'],
  ['Income'],
  ['   Contributions', 1000, 900],
];
const BALANCE_XLSX_GRID = [
  ['As of December 31, 2026'],
  ['', 'Total'],
  ['Assets'],
  ['   Cash', 6000],
];

const ROUTES = [
  ['/api/v1/import/church-xlsx', () => ({ file_base64: buildTestWorkbookBase64(CHURCH_XLSX_GRID) })],
  ['/api/v1/import/church-balances-xlsx', () => ({ file_base64: buildTestWorkbookBase64(BALANCE_XLSX_GRID) })],
];

describe('.xlsx import routes -- off by default', () => {
  it('answers 403 "not yet enabled" on every xlsx import route when the flag is off (the real production state today)', async () => {
    const env = baseEnv();
    for (const [path, makeBody] of ROUTES) {
      const res = await postJson(path, makeBody(), env);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toMatch(/not yet enabled/);
    }
  });

  it('rejects a non-JSON body with 400 before even checking the flag', async () => {
    const env = baseEnv();
    const res = await worker.fetch(new Request('https://finance.test/api/v1/import/church-xlsx', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not json',
    }), env);
    expect(res.status).toBe(400);
  });
});

describe('.xlsx import routes -- once enabled via finance_settings', () => {
  it('imports a real Church Budget vs. Actuals workbook end to end and records the import log', async () => {
    const env = baseEnv();
    env.FINANCE_DB._raw.prepare("INSERT INTO finance_settings (key,value) VALUES ('finance_xlsx_import_writes_enabled','1')").run();
    const res = await postJson('/api/v1/import/church-xlsx', { file_base64: buildTestWorkbookBase64(CHURCH_XLSX_GRID) }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, fiscalYear: 2026, imported: 2 });
    const rows = env.FINANCE_DB._raw.prepare(`SELECT * FROM finance_church_entries WHERE source='import_xlsx'`).all();
    expect(rows).toHaveLength(2);
    const log = env.FINANCE_DB._raw.prepare(`SELECT * FROM finance_import_log WHERE importer_key='church_budget_xlsx'`).get();
    expect(log).toBeTruthy();
  });

  it('imports a real Balance Sheet workbook end to end', async () => {
    const env = baseEnv();
    env.FINANCE_DB._raw.prepare("INSERT INTO finance_settings (key,value) VALUES ('finance_xlsx_import_writes_enabled','1')").run();
    const res = await postJson('/api/v1/import/church-balances-xlsx', { file_base64: buildTestWorkbookBase64(BALANCE_XLSX_GRID) }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, fiscalYear: 2026, asOfDate: 'December 31, 2026', imported: 2 });
    const rows = env.FINANCE_DB._raw.prepare(`SELECT * FROM finance_church_balances WHERE source='import_xlsx'`).all();
    expect(rows).toHaveLength(2);
  });

  it('still rejects an unrecognizable workbook with a clear 400, not a 500 or a silent write', async () => {
    const env = baseEnv();
    env.FINANCE_DB._raw.prepare("INSERT INTO finance_settings (key,value) VALUES ('finance_xlsx_import_writes_enabled','1')").run();
    const res = await postJson('/api/v1/import/church-xlsx', { file_base64: buildTestWorkbookBase64([['nothing recognizable']]) }, env);
    expect(res.status).toBe(400);
    const rows = env.FINANCE_DB._raw.prepare(`SELECT * FROM finance_church_entries`).all();
    expect(rows).toHaveLength(0);
  });
});
