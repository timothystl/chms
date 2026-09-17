import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';
import { resetAccessJwtCacheForTests } from '../src/access-jwt.js';

const TEAM = 'timothystl.cloudflareaccess.com';
const AUD = 'test-audience-tag';
const PATH = '/api/contracts/finance-compensation-plan-v1';
const CERTS_URL = `https://${TEAM}/cdn-cgi/access/certs`;

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_baseline.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0008_app_users_email.sql', import.meta.url), 'utf8'));
  sqlite.exec(`CREATE TABLE finance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
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

function saveSharedPlan(db, plan) {
  db._raw.prepare(`INSERT INTO finance_settings (key,value) VALUES ('finance_salary_planner', ?)`).run(JSON.stringify(plan));
}

// ── Minimal RSA JWT helpers, mirroring test/finance-compensation-write-contract.test.js ──
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

describe('GET /api/contracts/finance-compensation-plan-v1', () => {
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

  async function get({ env, token, contractKey = 'right-secret' }) {
    const req = new Request(`https://connect.example${PATH}`, {
      headers: { 'X-Contract-Key': contractKey, ...(token !== undefined ? { 'Cf-Access-Jwt-Assertion': token } : {}) },
    });
    return handleContractsServiceApi(req, env, PATH);
  }

  it('returns the real stored plan for an admin', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    saveSharedPlan(db, { roster: [{ name: 'Test Worker' }], compMethod: 'flat' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));

    const res = await get({ env: baseEnv(db), token });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.data).toEqual({ roster: [{ name: 'Test Worker' }], compMethod: 'flat' });
  });

  it('returns null when nothing has been saved yet', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const res = await get({ env: baseEnv(db), token });
    const out = await res.json();
    expect(out.data).toBeNull();
  });

  it('drops a worker flagged hideFromCouncil for a council viewer, and reindexes the per-worker override maps to match', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'boardmember', email: 'board@timothystl.org', role: 'council' });
    saveSharedPlan(db, {
      roster: [
        { name: 'Visible Worker' },
        { name: 'Hidden Worker', hideFromCouncil: true },
        { name: 'Another Visible Worker' },
      ],
      compPerWorkerMethod: { 0: 'scale', 1: 'custom', 2: 'flat' },
    });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('board@timothystl.org'));

    const res = await get({ env: baseEnv(db), token });
    const out = await res.json();
    expect(out.data.roster).toEqual([{ name: 'Visible Worker' }, { name: 'Another Visible Worker' }]);
    // Old index 2 ("Another Visible Worker") re-maps to new index 1, since old index 1 was dropped.
    expect(out.data.compPerWorkerMethod).toEqual({ 0: 'scale', 1: 'flat' });
  });

  it("layers council's own saved overlay fields on top of the shared plan, never the reverse", async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'boardmember', email: 'board@timothystl.org', role: 'council' });
    saveSharedPlan(db, { roster: [{ name: 'Test Worker' }], compMethod: 'flat', compScalePct: 0.02 });
    db._raw.prepare(`INSERT INTO finance_settings (key,value) VALUES ('finance_salary_planner_council_boardmember', ?)`)
      .run(JSON.stringify({ compMethod: 'scale', compScalePct: 0.03 }));
    const token = await signToken(keyPair.privateKey, kid, accessPayload('board@timothystl.org'));

    const res = await get({ env: baseEnv(db), token });
    const out = await res.json();
    expect(out.data.compMethod).toBe('scale');
    expect(out.data.compScalePct).toBe(0.03);
    expect(out.data.roster).toEqual([{ name: 'Test Worker' }]); // seed facts unchanged
  });

  it('returns the compensation-role fork once one exists, not the shared admin/finance plan', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'comper', email: 'comp@timothystl.org', role: 'compensation' });
    saveSharedPlan(db, { roster: [{ name: 'Admin Plan Worker' }] });
    db._raw.prepare(`INSERT INTO finance_settings (key,value) VALUES ('finance_salary_planner_compensation', ?)`)
      .run(JSON.stringify({ roster: [{ name: 'Compensation Draft Worker' }] }));
    const token = await signToken(keyPair.privateKey, kid, accessPayload('comp@timothystl.org'));

    const res = await get({ env: baseEnv(db), token });
    const out = await res.json();
    expect(out.data.roster[0].name).toBe('Compensation Draft Worker');
  });

  it('rejects a finance-role user -- only admin, compensation, or council may read the raw plan', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('sarah@timothystl.org'));
    const res = await get({ env: baseEnv(db), token });
    expect(res.status).toBe(403);
  });

  it('rejects when the shared X-Contract-Key is wrong, before ever looking at identity', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const res = await get({ env: baseEnv(db), token, contractKey: 'wrong-secret' });
    expect(res.status).toBe(401);
  });

  it('rejects a missing or invalid Access assertion even with a correct contract key', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const noToken = await get({ env: baseEnv(db) });
    expect(noToken.status).toBe(401);
    const garbage = await get({ env: baseEnv(db), token: 'not-a-jwt' });
    expect(garbage.status).toBe(401);
  });

  it('rejects a deactivated Connect account even with an otherwise-valid identity', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'former', email: 'former@timothystl.org', role: 'admin', active: 0 });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('former@timothystl.org'));
    const res = await get({ env: baseEnv(db), token });
    expect(res.status).toBe(403);
  });

  it('returns 503 when Connect has not been configured with the Access team/audience yet', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
    const env = { DB: db, FINANCE_CONTRACT_API_KEY: 'right-secret' }; // no FINANCE_ACCESS_* set
    const res = await get({ env, token });
    expect(res.status).toBe(503);
  });
});
