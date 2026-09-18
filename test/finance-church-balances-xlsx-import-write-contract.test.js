import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';
import { resetAccessJwtCacheForTests } from '../src/access-jwt.js';

const TEAM = 'timothystl.cloudflareaccess.com';
const AUD = 'test-audience-tag';
const PATH = '/api/contracts/finance-church-balances-xlsx-import-v1';
const CERTS_URL = `https://${TEAM}/cdn-cgi/access/certs`;

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_baseline.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0008_app_users_email.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0019_finance_church_balances.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0034_finance_workspace_v3.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              const r = sqlite.prepare(sql).run(...args);
              return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } };
            },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async first() { return sqlite.prepare(sql).get(); },
        async all() { return { results: sqlite.prepare(sql).all() }; },
      };
    },
    async batch(stmts) { for (const s of stmts) await s.run(); },
    _raw: sqlite,
  };
}

function insertUser(db, { username, email, role, active = 1 }) {
  db._raw.prepare(
    `INSERT INTO app_users (username, password_hash, role, active, email) VALUES (?,?,?,?,?)`
  ).run(username, 'irrelevant-hash', role, active, email);
}

// ── Minimal RSA JWT helpers, mirroring test/finance-budget-write-contract.test.js ──
function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJson(obj) { return b64url(new TextEncoder().encode(JSON.stringify(obj))); }
async function makeKeyPair() {
  return crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify']
  );
}
async function signToken(privateKey, kid, payload) {
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}
function accessPayload(email, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { email, iss: `https://${TEAM}`, aud: AUD, exp: now + 3600, iat: now, ...overrides };
}

// ── Same minimal, uncompressed (stored) .xlsx-shaped ZIP builder as
// test/finance-church-budget-xlsx-import-write-contract.test.js -- test infrastructure only.
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function buildStoredZip(files) {
  const enc = new TextEncoder();
  const entries = Object.entries(files).map(([filename, content]) => {
    const nameBytes = enc.encode(filename);
    const dataBytes = enc.encode(content);
    return { nameBytes, dataBytes, crc: crc32(dataBytes) };
  });

  const localChunks = [];
  const offsets = [];
  let offset = 0;
  for (const e of entries) {
    offsets.push(offset);
    const header = new ArrayBuffer(30);
    const dv = new DataView(header);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint32(14, e.crc, true);
    dv.setUint32(18, e.dataBytes.length, true);
    dv.setUint32(22, e.dataBytes.length, true);
    dv.setUint16(26, e.nameBytes.length, true);
    dv.setUint16(28, 0, true);
    const chunk = new Uint8Array(30 + e.nameBytes.length + e.dataBytes.length);
    chunk.set(new Uint8Array(header), 0);
    chunk.set(e.nameBytes, 30);
    chunk.set(e.dataBytes, 30 + e.nameBytes.length);
    localChunks.push(chunk);
    offset += chunk.length;
  }
  const localTotal = offset;

  const centralChunks = entries.map((e, i) => {
    const header = new ArrayBuffer(46);
    const dv = new DataView(header);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint16(14, 0, true);
    dv.setUint32(16, e.crc, true);
    dv.setUint32(20, e.dataBytes.length, true);
    dv.setUint32(24, e.dataBytes.length, true);
    dv.setUint16(28, e.nameBytes.length, true);
    dv.setUint16(30, 0, true);
    dv.setUint16(32, 0, true);
    dv.setUint16(34, 0, true);
    dv.setUint16(36, 0, true);
    dv.setUint32(38, 0, true);
    dv.setUint32(42, offsets[i], true);
    const chunk = new Uint8Array(46 + e.nameBytes.length);
    chunk.set(new Uint8Array(header), 0);
    chunk.set(e.nameBytes, 46);
    return chunk;
  });
  const centralTotal = centralChunks.reduce((s, c) => s + c.length, 0);

  const eocdBuf = new ArrayBuffer(22);
  const eocdDv = new DataView(eocdBuf);
  eocdDv.setUint32(0, 0x06054b50, true);
  eocdDv.setUint16(8, entries.length, true);
  eocdDv.setUint16(10, entries.length, true);
  eocdDv.setUint32(12, centralTotal, true);
  eocdDv.setUint32(16, localTotal, true);

  const out = new Uint8Array(localTotal + centralTotal + 22);
  let p = 0;
  for (const c of localChunks) { out.set(c, p); p += c.length; }
  for (const c of centralChunks) { out.set(c, p); p += c.length; }
  out.set(new Uint8Array(eocdBuf), p);
  return out;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function cellStr(ref, text) { return `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`; }
function cellNum(ref, n) { return n == null ? '' : `<c r="${ref}"><v>${n}</v></c>`; }
function xmlRow(n, cells) { return `<row r="${n}">${cells.join('')}</row>`; }

const RELS_XML = `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="http://x" Target="worksheets/sheet1.xml"/></Relationships>`;

function buildBalanceSheetXlsx({ asOfLine = 'As of December 31, 2027', basisLine = 'Cash Basis Tuesday, July 28, 2026 03:11 PM GMT-05:00' } = {}) {
  const workbookXml = `<?xml version="1.0"?><workbook><sheets><sheet name="Balance Sheet" r:id="rId1"/></sheets></workbook>`;
  const sheetXml = `<?xml version="1.0"?><worksheet><sheetData>
${xmlRow(1, [cellStr('A1', 'Statement of Financial Position')])}
${xmlRow(2, [cellStr('A2', asOfLine)])}
${xmlRow(3, [cellStr('B3', 'Total')])}
${xmlRow(4, [cellStr('A4', 'Assets'), cellNum('B4', 5000)])}
${xmlRow(5, [cellStr('A5', '   Cash'), cellNum('B5', 5000)])}
${xmlRow(6, [cellStr('A6', 'Total Assets')])}
${xmlRow(7, [cellStr('A7', 'Liabilities'), cellNum('B7', 1000)])}
${xmlRow(8, [cellStr('A8', '   Accounts Payable'), cellNum('B8', 1000)])}
${xmlRow(9, [cellStr('A9', 'Total Liabilities')])}
${xmlRow(10, [cellStr('A10', 'Equity'), cellNum('B10', 4000)])}
${xmlRow(11, [cellStr('A11', '   Net Assets'), cellNum('B11', 4000)])}
${xmlRow(12, [cellStr('A12', 'Total Equity')])}
${xmlRow(13, [cellStr('A13', 'Liabilities and Equity')])}
${xmlRow(14, [cellStr('A14', basisLine)])}
</sheetData></worksheet>`;
  return buildStoredZip({
    'xl/workbook.xml': workbookXml,
    'xl/_rels/workbook.xml.rels': RELS_XML,
    'xl/worksheets/sheet1.xml': sheetXml,
  });
}

describe('POST /api/contracts/finance-church-balances-xlsx-import-v1', () => {
  let keyPair, jwk, kid, originalFetch;

  beforeEach(async () => {
    resetAccessJwtCacheForTests();
    originalFetch = globalThis.fetch;
    kid = 'test-kid';
    keyPair = await makeKeyPair();
    jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    jwk.kid = kid;
    globalThis.fetch = async (url) => {
      if (String(url) === CERTS_URL) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
      throw new Error(`Unexpected fetch in test: ${url}`);
    };
  });

  afterEach(() => { globalThis.fetch = originalFetch; });

  function baseEnv(db) {
    return { DB: db, FINANCE_CONTRACT_API_KEY: 'right-secret', FINANCE_ACCESS_TEAM_DOMAIN: TEAM, FINANCE_ACCESS_AUD: AUD };
  }

  async function post({ env, token, contractKey = 'right-secret', body }) {
    const req = new Request(`https://connect.example${PATH}`, {
      method: 'POST',
      headers: { 'X-Contract-Key': contractKey, ...(token !== undefined ? { 'Cf-Access-Jwt-Assertion': token } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return handleContractsServiceApi(req, env, PATH);
  }

  it('saves real rows for an admin user, tagged source=import, the right fiscal year and as-of date', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const fileBase64 = bytesToBase64(buildBalanceSheetXlsx());

    const res = await post({ env: baseEnv(db), token, body: { file_base64: fileBase64 } });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toMatchObject({ ok: true, fiscalYear: 2027, asOfDate: 'December 31, 2027', basis: 'Cash', imported: 6, savedBy: 'root' });

    const rows = db._raw.prepare(`SELECT * FROM finance_church_balances WHERE source='import' AND fiscal_year=2027`).all();
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.as_of_date === 'December 31, 2027')).toBe(true);
    const cash = rows.find((r) => r.account_name === 'Cash');
    expect(cash.own_balance_cents).toBe(500000);

    const logRow = db._raw.prepare(`SELECT note FROM finance_import_log WHERE importer_key='church_balance'`).get();
    expect(logRow.note).toBe('FY2027');
  });

  it('rejects an oversized upload before ever parsing it', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const oversized = 'a'.repeat(Math.ceil((15 * 1024 * 1024 + 1) / 3) * 4);
    const res = await post({ env: baseEnv(db), token, body: { file_base64: oversized } });
    expect(res.status).toBe(413);
    expect(db._raw.prepare('SELECT * FROM finance_church_balances').all()).toHaveLength(0);
  });

  it('rejects invalid/non-xlsx bytes with a specific 400 message', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { file_base64: bytesToBase64(new TextEncoder().encode('not a zip')) } });
    expect(res.status).toBe(400);
    const out = await res.json();
    expect(out.error).toMatch(/Could not read this file as an Excel workbook/);
    expect(db._raw.prepare('SELECT * FROM finance_church_balances').all()).toHaveLength(0);
  });

  it('rejects a missing file_base64', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: {} });
    expect(res.status).toBe(400);
  });

  it('rejects a finance-role user -- only admin may import church financial data, same as the legacy route', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('sarah@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { file_base64: bytesToBase64(buildBalanceSheetXlsx()) } });
    expect(res.status).toBe(403);
    expect(db._raw.prepare('SELECT * FROM finance_church_balances').all()).toHaveLength(0);
  });

  it('rejects when the shared X-Contract-Key is wrong, before ever looking at identity', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, contractKey: 'wrong-secret', body: { file_base64: bytesToBase64(buildBalanceSheetXlsx()) } });
    expect(res.status).toBe(401);
  });

  it('rejects a missing or invalid Access assertion even with a correct contract key', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const noToken = await post({ env: baseEnv(db), body: { file_base64: bytesToBase64(buildBalanceSheetXlsx()) } });
    expect(noToken.status).toBe(401);
    const garbage = await post({ env: baseEnv(db), token: 'not-a-jwt', body: { file_base64: bytesToBase64(buildBalanceSheetXlsx()) } });
    expect(garbage.status).toBe(401);
  });

  it('rejects a deactivated Connect account even with an otherwise-valid identity', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'former', email: 'former@timothystl.org', role: 'admin', active: 0 });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('former@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { file_base64: bytesToBase64(buildBalanceSheetXlsx()) } });
    expect(res.status).toBe(403);
  });

  it('returns 503 when Connect has not been configured with the Access team/audience yet', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const env = { DB: db, FINANCE_CONTRACT_API_KEY: 'right-secret' };
    const res = await post({ env, token, body: { file_base64: bytesToBase64(buildBalanceSheetXlsx()) } });
    expect(res.status).toBe(503);
  });
});
