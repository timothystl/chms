import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';
import { resetAccessJwtCacheForTests } from '../src/access-jwt.js';

const TEAM = 'timothystl.cloudflareaccess.com';
const AUD = 'test-audience-tag';
const PATH = '/api/contracts/finance-budget-write-v1';
const CERTS_URL = `https://${TEAM}/cdn-cgi/access/certs`;

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_baseline.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0008_app_users_email.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0024_finance_budget_plan.sql', import.meta.url), 'utf8'));
  sqlite.exec(`CREATE TABLE finance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
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

// ── Minimal RSA JWT helpers, mirroring test/access-jwt.test.js and test/giving-quick-entry-contract.test.js ──
function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJson(obj) { return b64url(new TextEncoder().encode(JSON.stringify(obj))); }

async function makeKeyPair() {
  return crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
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

const ROW = { category: 'Expenses:Utilities', fiscal_year: 2027, classification: 'Expenses', planned_amount: '20600' };

describe('POST /api/contracts/finance-budget-write-v1', () => {
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
    return {
      DB: db,
      FINANCE_CONTRACT_API_KEY: 'right-secret',
      FINANCE_ACCESS_TEAM_DOMAIN: TEAM,
      FINANCE_ACCESS_AUD: AUD,
    };
  }

  async function post({ env, token, contractKey = 'right-secret', body }) {
    const req = new Request(`https://connect.example${PATH}`, {
      method: 'POST',
      headers: {
        'X-Contract-Key': contractKey,
        ...(token !== undefined ? { 'Cf-Access-Jwt-Assertion': token } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body || {}),
    });
    return handleContractsServiceApi(req, env, PATH);
  }

  it('saves a real row for an admin user with a valid Access identity, into the real shared table', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));

    const res = await post({ env: baseEnv(db), token, body: { rows: [ROW] } });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toEqual({ ok: true, saved: 1, savedBy: 'root' });

    const row = db._raw.prepare('SELECT * FROM finance_budget_plan WHERE category=? AND fiscal_year=?').get('Expenses:Utilities', 2027);
    expect(row.planned_amount_cents).toBe(2060000);
    expect(row.basis).toBe('manual');

    const audit = db._raw.prepare(
      `SELECT action, entity_type, field, new_value FROM audit_log WHERE action='budget_plan_write_via_finance'`
    ).get();
    expect(audit).toEqual({
      action: 'budget_plan_write_via_finance', entity_type: 'finance_budget_plan',
      field: 'saved_by', new_value: 'admin@timothystl.org',
    });
  });

  it('denies a council budget write when budget permission is not granted', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'boardmember', email: 'board@timothystl.org', role: 'council' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('board@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { rows: [ROW] } });
    expect(res.status).toBe(403);
    expect(db._raw.prepare('SELECT * FROM finance_budget_plan').all()).toHaveLength(0);
  });

  it('forks council into their own overlay, never touching the shared table -- same as the legacy route', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'boardmember', email: 'board@timothystl.org', role: 'council' });
    db._raw.prepare("INSERT INTO chms_config(key,value) VALUES('role_permissions_json',?)").run(JSON.stringify({ council: { budget: 'edit' } }));
    const token = await signToken(keyPair.privateKey, kid, accessPayload('board@timothystl.org'));

    const res = await post({ env: baseEnv(db), token, body: { rows: [ROW] } });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toEqual({ ok: true, saved: 1, savedBy: 'boardmember' });

    expect(db._raw.prepare('SELECT * FROM finance_budget_plan').all()).toHaveLength(0);
    const overlay = db._raw.prepare("SELECT value FROM finance_settings WHERE key='finance_budget_council_boardmember'").get();
    expect(JSON.parse(overlay.value)).toEqual({
      '2027': { 'Expenses:Utilities': { planned_amount_cents: 2060000, classification: 'Expenses', notes: '' } },
    });
  });

  it('rejects a finance-role user -- only admin or council may write, same as the legacy route', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('sarah@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { rows: [ROW] } });
    expect(res.status).toBe(403);
    expect(db._raw.prepare('SELECT * FROM finance_budget_plan').all()).toHaveLength(0);
  });

  it('rejects when the shared X-Contract-Key is wrong, before ever looking at identity', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, contractKey: 'wrong-secret', body: { rows: [ROW] } });
    expect(res.status).toBe(401);
  });

  it('rejects a missing or invalid Access assertion even with a correct contract key', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const noToken = await post({ env: baseEnv(db), body: { rows: [ROW] } });
    expect(noToken.status).toBe(401);
    const garbage = await post({ env: baseEnv(db), token: 'not-a-jwt', body: { rows: [ROW] } });
    expect(garbage.status).toBe(401);
  });

  it('rejects an identity Access verifies but that has no matching Connect account', async () => {
    const db = makeTestDb();
    const token = await signToken(keyPair.privateKey, kid, accessPayload('nobody@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { rows: [ROW] } });
    expect(res.status).toBe(403);
  });

  it('rejects a deactivated Connect account even with an otherwise-valid identity', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'former', email: 'former@timothystl.org', role: 'admin', active: 0 });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('former@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { rows: [ROW] } });
    expect(res.status).toBe(403);
  });

  it('returns 503 when Connect has not been configured with the Access team/audience yet', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const env = { DB: db, FINANCE_CONTRACT_API_KEY: 'right-secret' }; // no FINANCE_ACCESS_* set
    const res = await post({ env, token, body: { rows: [ROW] } });
    expect(res.status).toBe(503);
  });

  it('still applies the same validation as the human override-bulk route (missing category -> 400, saving nothing)', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { rows: [{ fiscal_year: 2027, planned_amount: '100' }] } });
    expect(res.status).toBe(400);
    expect(db._raw.prepare('SELECT * FROM finance_budget_plan').all()).toHaveLength(0);
  });

  it('re-saving the same category and fiscal year upserts rather than duplicating, same as the legacy route', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    await post({ env: baseEnv(db), token, body: { rows: [ROW] } });
    await post({ env: baseEnv(db), token, body: { rows: [{ ...ROW, planned_amount: '30000' }] } });
    const rows = db._raw.prepare('SELECT * FROM finance_budget_plan').all();
    expect(rows).toHaveLength(1);
    expect(rows[0].planned_amount_cents).toBe(3000000);
  });
});
