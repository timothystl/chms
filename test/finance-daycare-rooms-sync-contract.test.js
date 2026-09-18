import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';
import { resetAccessJwtCacheForTests } from '../src/access-jwt.js';

const TEAM = 'timothystl.cloudflareaccess.com';
const AUD = 'test-audience-tag';
const PATH = '/api/contracts/finance-daycare-rooms-sync-v1';
const CERTS_URL = `https://${TEAM}/cdn-cgi/access/certs`;
const ROOMS_URL = 'https://daycare.example/api/finance/rooms';

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_baseline.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0008_app_users_email.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0016_finance.sql', import.meta.url), 'utf8'));
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

const ROOMS_PAYLOAD = {
  period: '2027-01',
  rooms: [
    { name: 'Toddler A', capacity_per_day: 12, avg_daily_enrolled: 10, billed_cents: 500000, labor_cost_cents: 300000, waitlist_families: 2, seasonal: false },
  ],
};

describe('POST /api/contracts/finance-daycare-rooms-sync-v1', () => {
  let keyPair, jwk, kid, originalFetch;

  beforeEach(async () => {
    resetAccessJwtCacheForTests();
    originalFetch = globalThis.fetch;
    kid = 'test-kid';
    keyPair = await makeKeyPair();
    jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    jwk.kid = kid;
  });

  afterEach(() => { globalThis.fetch = originalFetch; });

  function mockFetch({ roomsStatus = 200, roomsBody = ROOMS_PAYLOAD } = {}) {
    globalThis.fetch = async (url) => {
      if (String(url) === CERTS_URL) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
      if (String(url) === ROOMS_URL) return new Response(JSON.stringify(roomsBody), { status: roomsStatus });
      throw new Error(`Unexpected fetch in test: ${url}`);
    };
  }

  function baseEnv(db) {
    return {
      DB: db, FINANCE_CONTRACT_API_KEY: 'right-secret', FINANCE_ACCESS_TEAM_DOMAIN: TEAM, FINANCE_ACCESS_AUD: AUD,
      DAYCARE_ROOMS_API_URL: ROOMS_URL, DAYCARE_API_KEY: 'daycare-secret',
    };
  }

  async function post({ env, token, contractKey = 'right-secret' }) {
    const req = new Request(`https://connect.example${PATH}`, {
      method: 'POST',
      headers: { 'X-Contract-Key': contractKey, ...(token !== undefined ? { 'Cf-Access-Jwt-Assertion': token } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    return handleContractsServiceApi(req, env, PATH);
  }

  it('pulls and wholesale-replaces one period\'s rooms for an admin user, always under the fixed ivanhoe property key', async () => {
    mockFetch();
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));

    const res = await post({ env: baseEnv(db), token });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.ok).toBe(true);
    expect(out.period).toBe('2027-01');
    expect(out.rooms).toBe(1);
    expect(out.savedBy).toBe('root');

    const rows = db._raw.prepare('SELECT room_name, billed_cents FROM finance_daycare_rooms WHERE period=?').all('2027-01');
    expect(rows).toEqual([{ room_name: 'Toddler A', billed_cents: 500000 }]);
  });

  it('rejects a finance-role user -- only admin may sync daycare room data, same as the legacy route', async () => {
    mockFetch();
    const db = makeTestDb();
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('sarah@timothystl.org'));
    const res = await post({ env: baseEnv(db), token });
    expect(res.status).toBe(403);
    expect(db._raw.prepare('SELECT * FROM finance_daycare_rooms').all()).toHaveLength(0);
  });

  it('rejects a council-role user -- room sync is admin-only, unlike the money sync', async () => {
    mockFetch();
    const db = makeTestDb();
    insertUser(db, { username: 'boardmember', email: 'board@timothystl.org', role: 'council' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('board@timothystl.org'));
    const res = await post({ env: baseEnv(db), token });
    expect(res.status).toBe(403);
  });

  it('surfaces the exact same "not configured" message the legacy route itself returns when the daycare rooms API has no env vars set on Connect\'s side', async () => {
    mockFetch();
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const env = { DB: db, FINANCE_CONTRACT_API_KEY: 'right-secret', FINANCE_ACCESS_TEAM_DOMAIN: TEAM, FINANCE_ACCESS_AUD: AUD };
    const res = await post({ env, token });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Daycare app room API is not configured (DAYCARE_ROOMS_API_URL)' });
  });

  it('passes through an upstream daycare-app HTTP error as a 502, not a relay-specific failure', async () => {
    mockFetch({ roomsStatus: 500, roomsBody: {} });
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const res = await post({ env: baseEnv(db), token });
    expect(res.status).toBe(502);
  });

  it('rejects when the shared X-Contract-Key is wrong, before ever looking at identity', async () => {
    mockFetch();
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const res = await post({ env: baseEnv(db), token, contractKey: 'wrong-secret' });
    expect(res.status).toBe(401);
  });

  it('rejects a missing or invalid Access assertion even with a correct contract key', async () => {
    mockFetch();
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const noToken = await post({ env: baseEnv(db) });
    expect(noToken.status).toBe(401);
    const garbage = await post({ env: baseEnv(db), token: 'not-a-jwt' });
    expect(garbage.status).toBe(401);
  });

  it('rejects an identity Access verifies but that has no matching Connect account', async () => {
    mockFetch();
    const db = makeTestDb();
    const token = await signToken(keyPair.privateKey, kid, accessPayload('nobody@timothystl.org'));
    const res = await post({ env: baseEnv(db), token });
    expect(res.status).toBe(403);
  });

  it('rejects a deactivated Connect account even with an otherwise-valid identity', async () => {
    mockFetch();
    const db = makeTestDb();
    insertUser(db, { username: 'former', email: 'former@timothystl.org', role: 'admin', active: 0 });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('former@timothystl.org'));
    const res = await post({ env: baseEnv(db), token });
    expect(res.status).toBe(403);
  });

  it('returns 503 when Connect has not been configured with the Access team/audience yet', async () => {
    mockFetch();
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const env = { DB: db, FINANCE_CONTRACT_API_KEY: 'right-secret', DAYCARE_ROOMS_API_URL: ROOMS_URL, DAYCARE_API_KEY: 'daycare-secret' };
    const res = await post({ env, token });
    expect(res.status).toBe(503);
  });
});
