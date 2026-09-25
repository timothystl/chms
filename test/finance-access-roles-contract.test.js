import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';
import { resetAccessJwtCacheForTests } from '../src/access-jwt.js';

const TEAM = 'timothystl.cloudflareaccess.com';
const AUD = 'test-audience-tag';
const CERTS_URL = `https://${TEAM}/cdn-cgi/access/certs`;

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  // Every Connect migration, in order, so giving_entries/people/deposits carry their real columns.
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).filter((n) => n.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
  }
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



describe('connect.finance-access-roles.v1', () => {
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

  const path = '/api/contracts/finance-access-roles-v1';
  async function call(db, email) {
    const token = await signToken(keyPair.privateKey, kid, accessPayload(email));
    return handleContractsServiceApi(new Request(`https://connect.example${path}`, { headers: { 'X-Contract-Key': 'right-secret', 'Cf-Access-Jwt-Assertion': token } }),
      { DB: db, FINANCE_CONTRACT_API_KEY: 'right-secret', FINANCE_ACCESS_TEAM_DOMAIN: TEAM, FINANCE_ACCESS_AUD: AUD }, path);
  }
  function setup() {
    const db = makeTestDb();
    insertUser(db, { username: 'pastor', email: 'pastor@timothystl.org', role: 'admin' });
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    insertUser(db, { username: 'carl', email: 'carl@timothystl.org', role: 'council' });
    insertUser(db, { username: 'gone', email: 'gone@timothystl.org', role: 'council', active: 0 });
    db._raw.prepare("UPDATE app_users SET display_name='Carl Council' WHERE username='carl'").run();
    return db;
  }

  it('shows an admin every role, its permissions and who holds it, without emails', async () => {
    const res = await call(setup(), 'pastor@timothystl.org');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.names_included).toBe(true);
    const council = body.roles.find((r) => r.role === 'council');
    expect(council).toMatchObject({ people_count: 1, people: ['Carl Council'] });
    expect(council.permissions.giving).toBe('anon');
    expect(body.roles.find((r) => r.role === 'admin').permissions.giving).toBe('edit');
    expect(body.items.map((i) => i.key)).toContain('budget');
    expect(JSON.stringify(body)).not.toContain('@timothystl.org');
  });

  it('gives Finance users counts only, and refuses roles without Finance access', async () => {
    const db = setup();
    const body = await (await call(db, 'sarah@timothystl.org')).json();
    expect(body.names_included).toBe(false);
    expect(body.roles.find((r) => r.role === 'council')).not.toHaveProperty('people');
    expect(JSON.stringify(body)).not.toContain('Carl');
    expect((await call(db, 'carl@timothystl.org')).status).toBe(403);
    expect((await call(db, 'gone@timothystl.org')).status).toBe(403);
  });
});
