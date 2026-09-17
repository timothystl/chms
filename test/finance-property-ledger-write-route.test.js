import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../apps/finance/shell.js';
import { PROPERTY_LEDGER_WRITES_FLAG_KEY } from '../apps/finance/property-ledger-write-service.js';

// Same minimal D1-shaped wrapper around node:sqlite used elsewhere in this suite (see
// test/finance-property-ledger-write-service.test.js, test/finance-property.test.js, and
// test/finance-compensation-plan-write-route.test.js) -- Finance's OWN schema, from
// apps/finance/migrations/0001_finance_foundation.sql.
const foundationSql = readFileSync(new URL('../apps/finance/migrations/0001_finance_foundation.sql', import.meta.url), 'utf8');

function makeFinanceDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(foundationSql);
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              const r = sqlite.prepare(sql).run(...args);
              return { meta: { last_row_id: Number(r.lastInsertRowid) } };
            },
            async first() { return sqlite.prepare(sql).get(...args) ?? null; },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async first() { return sqlite.prepare(sql).get() ?? null; },
        async all() { return { results: sqlite.prepare(sql).all() }; },
        async run() { sqlite.prepare(sql).run(); return { meta: {} }; },
      };
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
    _raw: sqlite,
  };
}

function baseEnv() {
  return { ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha', FINANCE_DB: makeFinanceDb() };
}

function enableWrites(db) {
  db._raw.prepare('INSERT INTO finance_settings (key, value) VALUES (?, ?)').run(PROPERTY_LEDGER_WRITES_FLAG_KEY, '1');
}

function roleEnv(role, env = baseEnv()) {
  return {
    ...env,
    CONNECT_SERVICE: { async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role }), { status: 200 });
      return new Response('not found', { status: 404 });
    } },
    FINANCE_CONTRACT_API_KEY: 'test-secret',
  };
}

function postJson(path, body, env, accessJwt = 'signed.jwt.here') {
  return worker.fetch(new Request(`https://finance.test${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessJwt !== undefined ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {}),
    },
    body: JSON.stringify(body),
  }), env);
}

const ROUTES = [
  ['/api/v1/property-reserve-entry', { reserve_key: 'property_tax', report_month: '2026-01', contribution: '950' }],
  ['/api/v1/property-reserve-disbursement-entry', { reserve_key: 'property_tax', period_key: '2026', amount: '100' }],
  ['/api/v1/property-distribution-entry', { period: '2026-01', amount: '500' }],
  ['/api/v1/property-capital-ledger-entry', { amount: '100', payee: 'Vail Contracting LLC' }],
];

describe('Property ledger write routes -- off by default', () => {
  it('answers "not yet enabled" (503) on every route when the flag is off -- the default, real-production state today -- even for a verified admin', async () => {
    const env = roleEnv('admin');
    for (const [path, body] of ROUTES) {
      const res = await postJson(path, body, env);
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe('not_yet_enabled');
    }
  });

  it('stays "not yet enabled" even with no Access identity at all -- the flag check runs before any role check', async () => {
    const res = await postJson('/api/v1/property-distribution-entry', { period: '2026-01', amount: '500' }, baseEnv(), undefined);
    expect(res.status).toBe(503);
  });

  it('rejects a non-POST method on every route with 405 and Allow: POST, flag and role notwithstanding', async () => {
    const env = roleEnv('admin');
    enableWrites(env.FINANCE_DB);
    for (const [path] of ROUTES) {
      const res = await worker.fetch(new Request(`https://finance.test${path}`), env);
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    }
  });
});

describe('Property ledger write routes -- admin-only, once enabled', () => {
  it('once enabled, still 403s an unverified caller (no Access identity at all)', async () => {
    const env = baseEnv();
    enableWrites(env.FINANCE_DB);
    const res = await postJson('/api/v1/property-distribution-entry', { period: '2026-01', amount: '500' }, env, undefined);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Access denied: editing property financials requires admin access');
  });

  it('once enabled, 403s a verified role other than admin (e.g. "finance")', async () => {
    const env = roleEnv('finance');
    enableWrites(env.FINANCE_DB);
    const res = await postJson('/api/v1/property-distribution-entry', { period: '2026-01', amount: '500' }, env);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Access denied: editing property financials requires admin access');
  });

  it('once enabled, rejects an invalid JSON body with 400', async () => {
    const env = roleEnv('admin');
    enableWrites(env.FINANCE_DB);
    const res = await worker.fetch(new Request('https://finance.test/api/v1/property-distribution-entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
      body: 'not json',
    }), env);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid JSON body');
  });

  it('once enabled, rejects a validation failure with 400 and the same error message legacy uses', async () => {
    const env = roleEnv('admin');
    enableWrites(env.FINANCE_DB);
    const res = await postJson('/api/v1/property-distribution-entry', { period: '2026', amount: '500' }, env);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('period must be YYYY-MM');
  });

  it('once enabled, a verified admin writes a real distribution row', async () => {
    const env = roleEnv('admin');
    enableWrites(env.FINANCE_DB);
    const res = await postJson('/api/v1/property-distribution-entry', { period: '2026-03', amount: '5000' }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const row = env.FINANCE_DB._raw.prepare("SELECT amount_cents FROM finance_property_distributions WHERE property_key='ivanhoe' AND period='2026-03'").get();
    expect(row.amount_cents).toBe(500000);
  });

  it('once enabled, a verified admin writes a real reserve monthly entry, carrying the running balance forward across two calls', async () => {
    const env = roleEnv('admin');
    enableWrites(env.FINANCE_DB);
    const jan = await postJson('/api/v1/property-reserve-entry', { reserve_key: 'property_tax', report_month: '2026-01', contribution: '950' }, env);
    expect(await jan.json()).toEqual({ ok: true, reserve_before_cents: 0, reserve_after_cents: 95000 });
    const feb = await postJson('/api/v1/property-reserve-entry', { reserve_key: 'property_tax', report_month: '2026-02', contribution: '950' }, env);
    expect(await feb.json()).toEqual({ ok: true, reserve_before_cents: 95000, reserve_after_cents: 190000 });
  });

  it('once enabled, a verified admin writes a real reserve disbursement entry, independent of (and not blocked by) the reserve schedule balance', async () => {
    const env = roleEnv('admin');
    enableWrites(env.FINANCE_DB);
    await postJson('/api/v1/property-reserve-entry', { reserve_key: 'property_tax', report_month: '2026-01', contribution: '100' }, env);
    const res = await postJson('/api/v1/property-reserve-disbursement-entry', { reserve_key: 'property_tax', period_key: '2026', amount: '10000' }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const row = env.FINANCE_DB._raw.prepare("SELECT amount_cents FROM finance_property_reserve_disbursements WHERE property_key='ivanhoe' AND reserve_key='property_tax' AND period_key='2026'").get();
    expect(row.amount_cents).toBe(1000000);
  });

  it('once enabled, a verified admin writes a real capital-ledger entry with an assigned id and sort_order', async () => {
    const env = roleEnv('admin');
    enableWrites(env.FINANCE_DB);
    const res = await postJson('/api/v1/property-capital-ledger-entry', { entry_date: '2024-10-07', amount: '5400', payee: 'Vail Contracting LLC' }, env);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(typeof json.id).toBe('number');
    const row = env.FINANCE_DB._raw.prepare('SELECT amount_cents, sort_order FROM finance_property_capital_ledger WHERE property_key=?').get('ivanhoe');
    expect(row.amount_cents).toBe(540000);
    expect(row.sort_order).toBe(0);
  });
});
