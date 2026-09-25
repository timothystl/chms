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


describe('Gift Entry batch contracts (giving-batch-*-v1)', () => {
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

  const env = (db) => ({ DB: db, FINANCE_CONTRACT_API_KEY: 'right-secret', FINANCE_ACCESS_TEAM_DOMAIN: TEAM, FINANCE_ACCESS_AUD: AUD });
  async function call(db, path, { email = 'sarah@timothystl.org', method = 'GET', body, query = '' } = {}) {
    const token = await signToken(keyPair.privateKey, kid, accessPayload(email));
    const req = new Request(`https://connect.example${path}${query}`, {
      method,
      headers: { 'X-Contract-Key': 'right-secret', 'Cf-Access-Jwt-Assertion': token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return handleContractsServiceApi(req, env(db), path);
  }
  const write = (db, body, email) => call(db, '/api/contracts/giving-batch-write-v1', { method: 'POST', body, email });
  function setup() {
    const db = makeTestDb();
    const general = insertFund(db, 'General Fund');
    const missions = insertFund(db, 'Missions');
    insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
    insertUser(db, { username: 'carl', email: 'carl@timothystl.org', role: 'council' });
    db._raw.prepare("INSERT INTO people (first_name, last_name, envelope_number) VALUES ('Walter','Krause','212'), ('Anna','Schreiber','')").run();
    return { db, general, missions };
  }

  it('creates a batch, adds a split gift and loose cash, and reports totals by fund and method', async () => {
    const { db, general, missions } = setup();
    const created = await (await write(db, { op: 'create_batch', batch_date: '2026-09-27', description: 'Sunday · plate & envelopes' })).json();
    expect(created.batch_id).toBeGreaterThan(0);
    const person = db._raw.prepare("SELECT id FROM people WHERE envelope_number='212'").get().id;
    const split = await write(db, { op: 'add_gift', batch_id: created.batch_id, person_id: person, method: 'check', check_number: '2207', notes: 'In memory', splits: [{ fund_id: general, amount: '100' }, { fund_id: missions, amount: '50.25' }] });
    expect(split.status).toBe(200);
    expect((await split.json()).ids).toHaveLength(2);
    await write(db, { op: 'add_gift', batch_id: created.batch_id, method: 'cash', splits: [{ fund_id: general, amount: '114' }] });

    const ws = await (await call(db, '/api/contracts/giving-batch-workspace-v1', { query: `?batch_id=${created.batch_id}&q=212` })).json();
    expect(ws.batch.total_cents).toBe(26425);
    expect(ws.batch.entries).toHaveLength(3);
    expect(ws.batch.entries[0]).toMatchObject({ person_name: 'Walter Krause', check_number: '2207', gift_date: '2026-09-27' });
    expect(ws.batch.entries[2].person_name).toBe('');
    expect(ws.batch.fund_totals).toEqual([{ fund_name: 'General Fund', cents: 21400 }, { fund_name: 'Missions', cents: 5025 }]);
    expect(ws.batch.method_totals).toEqual(expect.arrayContaining([{ method: 'check', cents: 15025 }, { method: 'cash', cents: 11400 }]));
    expect(ws.people.map((p) => p.last_name)).toEqual(['Krause']);
    expect(ws.open_batches.map((b) => b.id)).toContain(created.batch_id);
    expect(ws.funds.map((f) => f.name)).toEqual(expect.arrayContaining(['General Fund', 'Missions']));
    const audit = db._raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'giving_batch_%_via_finance' AND new_value='sarah@timothystl.org'").get().n;
    expect(audit).toBe(3);
  });

  it('validates gifts and locks a closed batch', async () => {
    const { db, general } = setup();
    const { batch_id } = await (await write(db, { op: 'create_batch', batch_date: '2026-09-27' })).json();
    expect((await write(db, { op: 'add_gift', batch_id, splits: [{ fund_id: general, amount: '0' }] })).status).toBe(400);
    expect((await write(db, { op: 'add_gift', batch_id, splits: [{ fund_id: 999, amount: '5' }] })).status).toBe(400);
    expect((await write(db, { op: 'add_gift', batch_id, person_id: 9999, splits: [{ fund_id: general, amount: '5' }] })).status).toBe(400);
    const ok = await (await write(db, { op: 'add_gift', batch_id, splits: [{ fund_id: general, amount: '5' }] })).json();
    await write(db, { op: 'close_batch', batch_id });
    expect((await write(db, { op: 'add_gift', batch_id, splits: [{ fund_id: general, amount: '5' }] })).status).toBe(409);
    expect((await write(db, { op: 'remove_gift', entry_id: ok.ids[0] })).status).toBe(409);
    await write(db, { op: 'reopen_batch', batch_id });
    expect((await write(db, { op: 'remove_gift', entry_id: ok.ids[0] })).status).toBe(200);
  });

  it('deposits a closed batch and reconciles the deposit against the bank', async () => {
    const { db, general } = setup();
    const { batch_id } = await (await write(db, { op: 'create_batch', batch_date: '2026-09-20' })).json();
    await write(db, { op: 'add_gift', batch_id, splits: [{ fund_id: general, amount: '812' }] });
    expect((await write(db, { op: 'deposit_batch', batch_id, deposit_date: '2026-09-21' })).status).toBe(409);
    await write(db, { op: 'close_batch', batch_id });
    const dep = await (await write(db, { op: 'deposit_batch', batch_id, deposit_date: '2026-09-21', external_ref: 'Deposit 09/21', source: 'check' })).json();
    expect(dep.deposit_id).toBeGreaterThan(0);
    expect((await write(db, { op: 'deposit_batch', batch_id, deposit_date: '2026-09-21' })).status).toBe(409);
    let ledger = await (await call(db, '/api/contracts/giving-batch-ledger-v1')).json();
    expect(ledger.batches[0].deposit_status.key).toBe('unreconciled');
    expect(ledger.deposits[0]).toMatchObject({ line_cents: 81200, status: 'open', external_ref: 'Deposit 09/21' });
    expect((await write(db, { op: 'reconcile_deposit', deposit_id: dep.deposit_id, bank_amount: '812.00' })).status).toBe(200);
    ledger = await (await call(db, '/api/contracts/giving-batch-ledger-v1')).json();
    expect(ledger.deposits[0]).toMatchObject({ status: 'reconciled', bank_cents: 81200 });
    expect(ledger.batches[0].deposit_status.key).toBe('deposited');
    await write(db, { op: 'reopen_deposit', deposit_id: dep.deposit_id });
    expect((await (await call(db, '/api/contracts/giving-batch-ledger-v1')).json()).deposits[0].status).toBe('open');
  });

  it('refuses council (anonymous-only Giving) for reads and writes, and unknown identities', async () => {
    const { db } = setup();
    expect((await call(db, '/api/contracts/giving-batch-workspace-v1', { email: 'carl@timothystl.org' })).status).toBe(403);
    expect((await call(db, '/api/contracts/giving-batch-ledger-v1', { email: 'carl@timothystl.org' })).status).toBe(403);
    expect((await write(db, { op: 'create_batch', batch_date: '2026-09-27' }, 'carl@timothystl.org')).status).toBe(403);
    expect((await call(db, '/api/contracts/giving-batch-workspace-v1', { email: 'nobody@example.com' })).status).toBe(403);
    expect(db._raw.prepare('SELECT COUNT(*) AS n FROM giving_batches').get().n).toBe(0);
  });
});
