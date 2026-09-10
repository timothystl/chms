import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';
import { resetAccessJwtCacheForTests } from '../src/access-jwt.js';

const TEAM = 'timothystl.cloudflareaccess.com';
const AUD = 'test-audience-tag';
const PATH = '/api/contracts/giving-quick-entry-v1';
const CERTS_URL = `https://${TEAM}/cdn-cgi/access/certs`;

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_baseline.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0008_app_users_email.sql', import.meta.url), 'utf8'));
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
    _raw: sqlite,
  };
}

function insertUser(db, { username, email, role, active = 1 }) {
  db._raw.prepare(
    `INSERT INTO app_users (username, password_hash, role, active, email) VALUES (?,?,?,?,?)`
  ).run(username, 'irrelevant-hash', role, active, email);
}

function insertFund(db, name) {
  db._raw.prepare('INSERT INTO funds (name) VALUES (?)').run(name);
  return db._raw.prepare('SELECT id FROM funds WHERE name=?').get(name).id;
}

// ── Minimal RSA JWT helpers, mirroring test/access-jwt.test.js ─────────────
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

describe('POST /api/contracts/giving-quick-entry-v1', () => {
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

  it('records a real gift for a finance-role user with a valid Access identity', async () => {
    const db = makeTestDb();
    const fundId = insertFund(db, 'General Fund');
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('sarah@timothystl.org'));

    const res = await post({ env: baseEnv(db), token, body: { fund_id: fundId, amount: '50.00', date: '2026-01-15' } });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.id).toBeGreaterThan(0);
    expect(out.batch_id).toBeGreaterThan(0);
    expect(out.enteredBy).toBe('sarah');

    const entry = db._raw.prepare('SELECT amount, fund_id FROM giving_entries WHERE id=?').get(out.id);
    expect(entry).toEqual({ amount: 5000, fund_id: fundId });

    const audit = db._raw.prepare(
      `SELECT action, entity_type, entity_id, field, new_value FROM audit_log WHERE action='giving_quick_entry_via_finance'`
    ).get();
    expect(audit).toEqual({
      action: 'giving_quick_entry_via_finance', entity_type: 'giving_entries',
      entity_id: out.id, field: 'entered_by', new_value: 'sarah@timothystl.org',
    });
  });

  it('rejects when the shared X-Contract-Key is wrong, before ever looking at identity', async () => {
    const db = makeTestDb();
    const fundId = insertFund(db, 'General Fund');
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('sarah@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, contractKey: 'wrong-secret', body: { fund_id: fundId, amount: '10', date: '2026-01-15' } });
    expect(res.status).toBe(401);
  });

  it('rejects a missing or invalid Access assertion even with a correct contract key', async () => {
    const db = makeTestDb();
    const fundId = insertFund(db, 'General Fund');
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    const noToken = await post({ env: baseEnv(db), body: { fund_id: fundId, amount: '10', date: '2026-01-15' } });
    expect(noToken.status).toBe(401);
    const garbage = await post({ env: baseEnv(db), token: 'not-a-jwt', body: { fund_id: fundId, amount: '10', date: '2026-01-15' } });
    expect(garbage.status).toBe(401);
  });

  it('rejects an identity Access verifies but that has no matching Connect account', async () => {
    const db = makeTestDb();
    const fundId = insertFund(db, 'General Fund');
    const token = await signToken(keyPair.privateKey, kid, accessPayload('nobody@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { fund_id: fundId, amount: '10', date: '2026-01-15' } });
    expect(res.status).toBe(403);
  });

  it('rejects a deactivated Connect account even with an otherwise-valid identity', async () => {
    const db = makeTestDb();
    const fundId = insertFund(db, 'General Fund');
    insertUser(db, { username: 'former', email: 'former@timothystl.org', role: 'finance', active: 0 });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('former@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { fund_id: fundId, amount: '10', date: '2026-01-15' } });
    expect(res.status).toBe(403);
  });

  it('rejects a role whose giving permission is not edit-level (staff defaults to none)', async () => {
    const db = makeTestDb();
    const fundId = insertFund(db, 'General Fund');
    insertUser(db, { username: 'greeter', email: 'greeter@timothystl.org', role: 'staff' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('greeter@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { fund_id: fundId, amount: '10', date: '2026-01-15' } });
    expect(res.status).toBe(403);
  });

  it('rejects council even though it can view aggregate giving, preserving the anon-only rule', async () => {
    const db = makeTestDb();
    const fundId = insertFund(db, 'General Fund');
    insertUser(db, { username: 'boardmember', email: 'board@timothystl.org', role: 'council' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('board@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { fund_id: fundId, amount: '10', date: '2026-01-15' } });
    expect(res.status).toBe(403);
  });

  it('allows admin unconditionally, the same as the desktop route', async () => {
    const db = makeTestDb();
    const fundId = insertFund(db, 'General Fund');
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { fund_id: fundId, amount: '10', date: '2026-01-15' } });
    expect(res.status).toBe(200);
  });

  it('returns 503 when Connect has not been configured with the Access team/audience yet', async () => {
    const db = makeTestDb();
    const fundId = insertFund(db, 'General Fund');
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('sarah@timothystl.org'));
    const env = { DB: db, FINANCE_CONTRACT_API_KEY: 'right-secret' }; // no FINANCE_ACCESS_* set
    const res = await post({ env, token, body: { fund_id: fundId, amount: '10', date: '2026-01-15' } });
    expect(res.status).toBe(503);
  });

  it('still applies the same validation as the human quick-entry route (missing fund_id -> 400)', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('sarah@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { amount: '10', date: '2026-01-15' } });
    expect(res.status).toBe(400);
  });
});
