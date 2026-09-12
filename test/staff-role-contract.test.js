import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';
import { resetAccessJwtCacheForTests } from '../src/access-jwt.js';

// Same RSA-JWT test harness as test/giving-quick-entry-contract.test.js — mirrors that
// endpoint's real identity-verification pattern, since staff-role-v1 exists specifically so
// apps/finance's shell can enforce its own section access the same honest way.
const TEAM = 'timothystl.cloudflareaccess.com';
const AUD = 'test-audience-tag';
const PATH = '/api/contracts/staff-role-v1';
const CERTS_URL = `https://${TEAM}/cdn-cgi/access/certs`;

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_baseline.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0008_app_users_email.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return { async first() { return sqlite.prepare(sql).get(...args); } };
        },
        async first() { return sqlite.prepare(sql).get(); },
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

describe('GET /api/contracts/staff-role-v1', () => {
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

  async function get({ env, token, contractKey = 'right-secret' }) {
    const req = new Request(`https://connect.example${PATH}`, {
      headers: {
        'X-Contract-Key': contractKey,
        ...(token !== undefined ? { 'Cf-Access-Jwt-Assertion': token } : {}),
      },
    });
    return handleContractsServiceApi(req, env, PATH);
  }

  it('returns only the role for a verified identity with a matching active account', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'grace', email: 'grace@timothystl.org', role: 'compensation' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('grace@timothystl.org'));
    const res = await get({ env: baseEnv(db), token });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ role: 'compensation' });
  });

  it('never returns username or email, only role', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('sarah@timothystl.org'));
    const res = await get({ env: baseEnv(db), token });
    const body = await res.json();
    expect(Object.keys(body)).toEqual(['role']);
  });

  it('rejects when the shared X-Contract-Key is wrong, before ever looking at identity', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('sarah@timothystl.org'));
    const res = await get({ env: baseEnv(db), token, contractKey: 'wrong-secret' });
    expect(res.status).toBe(401);
  });

  it('rejects a missing or invalid Access assertion even with a correct contract key', async () => {
    const db = makeTestDb();
    const noToken = await get({ env: baseEnv(db) });
    expect(noToken.status).toBe(401);
    const garbage = await get({ env: baseEnv(db), token: 'not-a-jwt' });
    expect(garbage.status).toBe(401);
  });

  it('rejects an identity Access verifies but that has no matching Connect account', async () => {
    const db = makeTestDb();
    const token = await signToken(keyPair.privateKey, kid, accessPayload('nobody@timothystl.org'));
    const res = await get({ env: baseEnv(db), token });
    expect(res.status).toBe(403);
  });

  it('rejects a deactivated Connect account even with an otherwise-valid identity', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'former', email: 'former@timothystl.org', role: 'finance', active: 0 });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('former@timothystl.org'));
    const res = await get({ env: baseEnv(db), token });
    expect(res.status).toBe(403);
  });

  it('returns 503 when Connect has not been configured with the Access team/audience yet', async () => {
    const db = makeTestDb();
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    const token = await signToken(keyPair.privateKey, kid, accessPayload('sarah@timothystl.org'));
    const env = { DB: db, FINANCE_CONTRACT_API_KEY: 'right-secret' }; // no FINANCE_ACCESS_* set
    const res = await get({ env, token });
    expect(res.status).toBe(503);
  });
});
