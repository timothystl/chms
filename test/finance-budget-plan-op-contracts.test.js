import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';
import { resetAccessJwtCacheForTests } from '../src/access-jwt.js';

const TEAM = 'timothystl.cloudflareaccess.com';
const AUD = 'test-audience-tag';
const CERTS_URL = `https://${TEAM}/cdn-cgi/access/certs`;

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_baseline.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0008_app_users_email.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0018_finance_church_entries.sql', import.meta.url), 'utf8'));
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

function insertChurchEntry(db, { fiscalYear, category, actualCents = 0, budgetCents = 0 }) {
  db._raw.prepare(
    `INSERT INTO finance_church_entries
       (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source, synced_at)
     VALUES (?,0,'Expenses',?,?,0,0,?,?,'qbo_sync',datetime('now'))`
  ).run(fiscalYear, category, category, actualCents, budgetCents);
}

function insertBudgetPlanRow(db, { category, fiscalYear, plannedCents }) {
  db._raw.prepare(
    `INSERT INTO finance_budget_plan (category,classification,fiscal_year,planned_amount_cents,basis,updated_at)
     VALUES (?,?,?,?,'manual',datetime('now'))`
  ).run(category, 'Expenses', fiscalYear, plannedCents);
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

describe('Budget Plan generate/generate-all/commit/remove relay contracts', () => {
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

  async function post(path, { env, token, body }) {
    const req = new Request(`https://connect.example${path}`, {
      method: 'POST',
      headers: { 'X-Contract-Key': 'right-secret', ...(token !== undefined ? { 'Cf-Access-Jwt-Assertion': token } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return handleContractsServiceApi(req, env, path);
  }

  describe('POST /api/contracts/finance-budget-generate-v1', () => {
    it('compounds a base amount across target years for an admin', async () => {
      const db = makeTestDb();
      insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
      const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
      const res = await post('/api/contracts/finance-budget-generate-v1', {
        env: baseEnv(db), token,
        body: { category: 'Expenses:Utilities', base_amount: 10000, growth_pct: 0.1, target_years: [2027, 2028] },
      });
      expect(res.status).toBe(200);
      const out = await res.json();
      expect(out).toEqual({ ok: true, years: [2027, 2028], savedBy: 'root' });
      const rows = db._raw.prepare('SELECT fiscal_year, planned_amount_cents, basis FROM finance_budget_plan ORDER BY fiscal_year').all();
      expect(rows).toEqual([
        { fiscal_year: 2027, planned_amount_cents: 1100000, basis: 'grown' },
        { fiscal_year: 2028, planned_amount_cents: 1210000, basis: 'grown' },
      ]);
    });

    it('rejects a council user -- generate is admin-only, unlike override-bulk', async () => {
      const db = makeTestDb();
      insertUser(db, { username: 'boardmember', email: 'board@timothystl.org', role: 'council' });
      const token = await signToken(keyPair.privateKey, kid, accessPayload('board@timothystl.org'));
      const res = await post('/api/contracts/finance-budget-generate-v1', {
        env: baseEnv(db), token, body: { category: 'x', base_amount: 100, growth_pct: 0, target_years: [2027] },
      });
      expect(res.status).toBe(403);
    });

    it('rejects an invalid body the same way the legacy route would', async () => {
      const db = makeTestDb();
      insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
      const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
      const res = await post('/api/contracts/finance-budget-generate-v1', {
        env: baseEnv(db), token, body: { category: '', base_amount: 100, growth_pct: 0, target_years: [2027] },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/contracts/finance-budget-generate-all-v1', () => {
    it('grows every real account line from the base year for an admin', async () => {
      const db = makeTestDb();
      insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
      insertChurchEntry(db, { fiscalYear: 2026, category: 'Expenses:Utilities', actualCents: 100000 });
      const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
      const res = await post('/api/contracts/finance-budget-generate-all-v1', {
        env: baseEnv(db), token, body: { base_year: 2026, target_year: 2027, growth_pct: 0.05, through_week: 52 },
      });
      expect(res.status).toBe(200);
      const out = await res.json();
      expect(out.ok).toBe(true);
      expect(out.generated).toBe(1);
      expect(out.savedBy).toBe('root');
      const row = db._raw.prepare('SELECT * FROM finance_budget_plan WHERE fiscal_year=2027').get();
      expect(row.planned_amount_cents).toBe(105000);
      expect(row.basis).toBe('grown');
    });

    it('rejects a base year with no real Church Budget data', async () => {
      const db = makeTestDb();
      insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
      const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
      const res = await post('/api/contracts/finance-budget-generate-all-v1', {
        env: baseEnv(db), token, body: { base_year: 2026, target_year: 2027, growth_pct: 0.05 },
      });
      expect(res.status).toBe(400);
    });

    it('rejects a finance-role user -- generate-all is admin-only', async () => {
      const db = makeTestDb();
      insertUser(db, { username: 'sarah', email: 'sarah@timothystl.org', role: 'finance' });
      const token = await signToken(keyPair.privateKey, kid, accessPayload('sarah@timothystl.org'));
      const res = await post('/api/contracts/finance-budget-generate-all-v1', {
        env: baseEnv(db), token, body: { base_year: 2026, target_year: 2027, growth_pct: 0 },
      });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/contracts/finance-budget-commit-v1', () => {
    it('commits the current plan into finance_church_entries as a placeholder for an admin', async () => {
      const db = makeTestDb();
      insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
      insertBudgetPlanRow(db, { category: 'Expenses:Utilities', fiscalYear: 2027, plannedCents: 500000 });
      const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
      const res = await post('/api/contracts/finance-budget-commit-v1', {
        env: baseEnv(db), token, body: { fiscal_year: 2027 },
      });
      expect(res.status).toBe(200);
      const out = await res.json();
      expect(out).toEqual({ ok: true, fiscalYear: 2027, committed: 1, savedBy: 'root' });
      const row = db._raw.prepare(`SELECT * FROM finance_church_entries WHERE source='plan_committed' AND fiscal_year=2027`).get();
      expect(row.own_budget_cents).toBe(500000);
      expect(row.own_actual_cents).toBe(0);
    });

    it('rejects a fiscal year with no plan rows', async () => {
      const db = makeTestDb();
      insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
      const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
      const res = await post('/api/contracts/finance-budget-commit-v1', { env: baseEnv(db), token, body: { fiscal_year: 2027 } });
      expect(res.status).toBe(400);
    });

    it('rejects a council user -- commit is admin-only', async () => {
      const db = makeTestDb();
      insertUser(db, { username: 'boardmember', email: 'board@timothystl.org', role: 'council' });
      const token = await signToken(keyPair.privateKey, kid, accessPayload('board@timothystl.org'));
      const res = await post('/api/contracts/finance-budget-commit-v1', { env: baseEnv(db), token, body: { fiscal_year: 2027 } });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/contracts/finance-budget-remove-v1', () => {
    it('removes one category/fiscal_year row for an admin', async () => {
      const db = makeTestDb();
      insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
      insertBudgetPlanRow(db, { category: 'Expenses:Utilities', fiscalYear: 2027, plannedCents: 500000 });
      const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
      const res = await post('/api/contracts/finance-budget-remove-v1', {
        env: baseEnv(db), token, body: { category: 'Expenses:Utilities', fiscal_year: 2027 },
      });
      expect(res.status).toBe(200);
      const out = await res.json();
      expect(out).toEqual({ ok: true, savedBy: 'root' });
      expect(db._raw.prepare('SELECT * FROM finance_budget_plan').all()).toHaveLength(0);
    });

    it('rejects a missing category or fiscal_year', async () => {
      const db = makeTestDb();
      insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
      const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
      const res = await post('/api/contracts/finance-budget-remove-v1', { env: baseEnv(db), token, body: { category: '' } });
      expect(res.status).toBe(400);
    });

    it('rejects a council user -- remove is admin-only', async () => {
      const db = makeTestDb();
      insertUser(db, { username: 'boardmember', email: 'board@timothystl.org', role: 'council' });
      const token = await signToken(keyPair.privateKey, kid, accessPayload('board@timothystl.org'));
      const res = await post('/api/contracts/finance-budget-remove-v1', {
        env: baseEnv(db), token, body: { category: 'x', fiscal_year: 2027 },
      });
      expect(res.status).toBe(403);
    });

    it('rejects when the shared X-Contract-Key is wrong, before ever looking at identity', async () => {
      const db = makeTestDb();
      insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
      const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
      const req = new Request('https://connect.example/api/contracts/finance-budget-remove-v1', {
        method: 'POST',
        headers: { 'X-Contract-Key': 'wrong-secret', 'Cf-Access-Jwt-Assertion': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'x', fiscal_year: 2027 }),
      });
      const res = await handleContractsServiceApi(req, baseEnv(db), '/api/contracts/finance-budget-remove-v1');
      expect(res.status).toBe(401);
    });

    it('returns 503 when Connect has not been configured with the Access team/audience yet', async () => {
      const db = makeTestDb();
      insertUser(db, { username: 'root', email: 'admin@timothystl.org', role: 'admin' });
      const token = await signToken(keyPair.privateKey, kid, accessPayload('admin@timothystl.org'));
      const env = { DB: db, FINANCE_CONTRACT_API_KEY: 'right-secret' };
      const res = await post('/api/contracts/finance-budget-remove-v1', { env, token, body: { category: 'x', fiscal_year: 2027 } });
      expect(res.status).toBe(503);
    });
  });
});
