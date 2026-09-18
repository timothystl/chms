import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';
import { resetAccessJwtCacheForTests } from '../src/access-jwt.js';

const TEAM = 'timothystl.cloudflareaccess.com';
const AUD = 'test-audience-tag';
const PATH = '/api/contracts/finance-property-capital-ledger-write-v1';
const CERTS_URL = `https://${TEAM}/cdn-cgi/access/certs`;

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_baseline.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0008_app_users_email.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0022_finance_property.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0023_finance_property_reserves.sql', import.meta.url), 'utf8'));
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

const ROW = { entry_date: '2024-10-07', amount: '5400', payee: 'Vail Contracting LLC', description: 'renovation', project: 'Apartment renovation' };

describe('POST /api/contracts/finance-property-capital-ledger-write-v1', () => {
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

  it('saves a real capital-ledger entry for an admin user, always under the fixed ivanhoe property key', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));

    const res = await post({ env: baseEnv(db), token, body: ROW });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.ok).toBe(true);
    expect(out.savedBy).toBe('root');
    expect(out.id).toBeGreaterThan(0);

    const row = db._raw.prepare('SELECT * FROM finance_property_capital_ledger WHERE id=?').get(out.id);
    expect(row.property_key).toBe('ivanhoe');
    expect(row.amount_cents).toBe(540000);
    expect(row.payee).toBe('Vail Contracting LLC');
    expect(row.project).toBe('Apartment renovation');
    expect(row.sort_order).toBe(0);
  });

  it('auto-increments sort_order from this property\'s current max, same as the legacy route', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const r1 = await (await post({ env: baseEnv(db), token, body: ROW })).json();
    const r2 = await (await post({ env: baseEnv(db), token, body: { entry_date: '2024-10-19', amount: '2302.25', payee: 'SS Stone', description: 'countertop', project: 'Apartment renovation' } })).json();
    const row1 = db._raw.prepare('SELECT sort_order FROM finance_property_capital_ledger WHERE id=?').get(r1.id);
    const row2 = db._raw.prepare('SELECT sort_order FROM finance_property_capital_ledger WHERE id=?').get(r2.id);
    expect(row1.sort_order).toBe(0);
    expect(row2.sort_order).toBe(1);
  });

  it('ignores a client-supplied property_key -- the property is always ivanhoe on Connect\'s side', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { ...ROW, property_key: 'some-other-property' } });
    expect(res.status).toBe(200);
    expect(db._raw.prepare(`SELECT DISTINCT property_key FROM finance_property_capital_ledger`).all()).toEqual([{ property_key: 'ivanhoe' }]);
  });

  it('rejects an invalid amount, the same way the legacy route would', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { ...ROW, amount: 'abc' } });
    expect(res.status).toBe(400);
    expect(db._raw.prepare('SELECT * FROM finance_property_capital_ledger').all()).toHaveLength(0);
  });

  it('rejects an entry_date not in YYYY, YYYY-MM, or YYYY-MM-DD shape', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: { ...ROW, entry_date: '10/07/2024' } });
    expect(res.status).toBe(400);
    expect(db._raw.prepare('SELECT * FROM finance_property_capital_ledger').all()).toHaveLength(0);
  });

  it('accepts YYYY, YYYY-MM, and YYYY-MM-DD entry_date shapes', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    for (const entry_date of ['2024', '2024-10', '2024-10-07']) {
      const res = await post({ env: baseEnv(db), token, body: { ...ROW, entry_date } });
      expect(res.status).toBe(200);
    }
  });

  it('rejects a finance-role user -- only admin may edit property financials, same as the legacy route', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('sarah@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: ROW });
    expect(res.status).toBe(403);
    expect(db._raw.prepare('SELECT * FROM finance_property_capital_ledger').all()).toHaveLength(0);
  });

  it('rejects when the shared X-Contract-Key is wrong, before ever looking at identity', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, contractKey: 'wrong-secret', body: ROW });
    expect(res.status).toBe(401);
  });

  it('rejects a missing or invalid Access assertion even with a correct contract key', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const noToken = await post({ env: baseEnv(db), body: ROW });
    expect(noToken.status).toBe(401);
    const garbage = await post({ env: baseEnv(db), token: 'not-a-jwt', body: ROW });
    expect(garbage.status).toBe(401);
  });

  it('rejects a deactivated Connect account even with an otherwise-valid identity', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'former', email: 'former@timothystl.org', role: 'admin', active: 0 });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('former@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, body: ROW });
    expect(res.status).toBe(403);
  });

  it('returns 503 when Connect has not been configured with the Access team/audience yet', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const env = { DB: db, FINANCE_CONTRACT_API_KEY: 'right-secret' };
    const res = await post({ env, token, body: ROW });
    expect(res.status).toBe(503);
  });
});
