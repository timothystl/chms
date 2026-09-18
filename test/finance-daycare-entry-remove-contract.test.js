import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';
import { resetAccessJwtCacheForTests } from '../src/access-jwt.js';

const TEAM = 'timothystl.cloudflareaccess.com';
const AUD = 'test-audience-tag';
const PATH = '/api/contracts/finance-daycare-entry-remove-v1';
const CERTS_URL = `https://${TEAM}/cdn-cgi/access/certs`;

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_baseline.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0008_app_users_email.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0016_finance.sql', import.meta.url), 'utf8'));
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

function insertEntry(db, row) {
  const r = db._raw.prepare(
    `INSERT INTO finance_daycare_entries (period,category,entry_type,amount_cents,notes) VALUES (?,?,?,?,?)`
  ).run(row.period, row.category, row.entry_type, row.amount_cents, row.notes || '');
  return Number(r.lastInsertRowid);
}

// ── Minimal RSA JWT helpers, mirroring test/finance-daycare-entry-contract.test.js ──
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

const ORIGINAL = { period: '2027', category: 'Tuition Income', entry_type: 'actual', amount_cents: 500000, notes: '' };

describe('POST /api/contracts/finance-daycare-entry-remove-v1', () => {
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

  it('removes a real entry for a finance-role user', async () => {
    const db = makeTestDb();
    const id = insertEntry(db, ORIGINAL);
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('sarah@timothystl.org'));

    const res = await post({ env: baseEnv(db), token, body: { id } });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toEqual({ ok: true, savedBy: 'sarah' });

    expect(db._raw.prepare('SELECT * FROM finance_daycare_entries WHERE id=?').get(id)).toBeUndefined();

    const audit = db._raw.prepare(`SELECT action, entity_type, entity_id, new_value FROM audit_log WHERE action='daycare_entry_remove_via_finance'`).get();
    expect(audit).toEqual({ action: 'daycare_entry_remove_via_finance', entity_type: 'finance_daycare_entries', entity_id: id, new_value: 'sarah@timothystl.org' });
  });

  it('allows council by default, since compensation defaults to edit and the looser gate accepts any of finance/budget/compensation', async () => {
    const db = makeTestDb();
    const id = insertEntry(db, ORIGINAL);
    insertUser(db, { username: 'boardmember', email: 'board@timothystl.org', role: 'council' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('board@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { id } });
    expect(res.status).toBe(200);
  });

  it('allows admin unconditionally', async () => {
    const db = makeTestDb();
    const id = insertEntry(db, ORIGINAL);
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { id } });
    expect(res.status).toBe(200);
  });

  it('rejects a staff-role user -- finance/budget/compensation all default to none for staff', async () => {
    const db = makeTestDb();
    const id = insertEntry(db, ORIGINAL);
    insertUser(db, { username: 'greeter', email: 'greeter@timothystl.org', role: 'staff' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('greeter@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { id } });
    expect(res.status).toBe(403);
    expect(db._raw.prepare('SELECT * FROM finance_daycare_entries WHERE id=?').get(id)).toBeDefined();
  });

  it('removing a nonexistent id succeeds as a no-op, same as the legacy route', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('sarah@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { id: 999999 } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, savedBy: 'sarah' });
  });

  it('rejects an id that is not a positive integer', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('sarah@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { id: 'nope' } });
    expect(res.status).toBe(400);
  });

  it('rejects when the shared X-Contract-Key is wrong, before ever looking at identity', async () => {
    const db = makeTestDb();
    const id = insertEntry(db, ORIGINAL);
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('sarah@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, contractKey: 'wrong-secret', body: { id } });
    expect(res.status).toBe(401);
  });

  it('rejects a missing or invalid Access assertion even with a correct contract key', async () => {
    const db = makeTestDb();
    const id = insertEntry(db, ORIGINAL);
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    const noToken = await post({ env: baseEnv(db), body: { id } });
    expect(noToken.status).toBe(401);
    const garbage = await post({ env: baseEnv(db), token: 'not-a-jwt', body: { id } });
    expect(garbage.status).toBe(401);
  });

  it('rejects an identity Access verifies but that has no matching Connect account', async () => {
    const db = makeTestDb();
    const id = insertEntry(db, ORIGINAL);
    const token = await signToken(keyPair.privateKey, kid, accessPayload('nobody@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { id } });
    expect(res.status).toBe(403);
  });

  it('rejects a deactivated Connect account even with an otherwise-valid identity', async () => {
    const db = makeTestDb();
    const id = insertEntry(db, ORIGINAL);
    insertUser(db, { username: 'former', email: 'former@timothystl.org', role: 'finance', active: 0 });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('former@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { id } });
    expect(res.status).toBe(403);
  });

  it('returns 503 when Connect has not been configured with the Access team/audience yet', async () => {
    const db = makeTestDb();
    const id = insertEntry(db, ORIGINAL);
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('sarah@timothystl.org'));
    const env = { DB: db, FINANCE_CONTRACT_API_KEY: 'right-secret' };
    const res = await post({ env, token, body: { id } });
    expect(res.status).toBe(503);
  });
});
