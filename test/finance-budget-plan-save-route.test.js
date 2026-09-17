import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../apps/finance/shell.js';
import { BUDGET_PLAN_WRITES_ENABLED_KEY } from '../apps/finance/budget-plan-write-service.js';

// Real Finance-owned schema, exactly as apps/finance/migrations/0001_finance_foundation.sql
// defines it -- this is FINANCE_DB, never the shared Connect D1.
function makeFinanceDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../apps/finance/migrations/0001_finance_foundation.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async run() { sqlite.prepare(sql).run(); },
        async first() { return sqlite.prepare(sql).get(); },
        async all() { return { results: sqlite.prepare(sql).all() }; },
      };
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
    _raw: sqlite,
  };
}

function enableWrites(db) {
  db._raw.prepare('INSERT INTO finance_settings (key,value) VALUES (?,?)').run(BUDGET_PLAN_WRITES_ENABLED_KEY, '1');
}

function baseEnv(financeDb, roleFetchImpl) {
  return {
    ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha',
    FINANCE_DB: financeDb,
    ...(roleFetchImpl ? { CONNECT_SERVICE: { fetch: roleFetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' } : {}),
  };
}

function roleFetch(role) {
  return async () => new Response(JSON.stringify({ role }), { status: 200 });
}

function postSave(env, { accessJwt = 'signed.jwt.here', body } = {}) {
  return worker.fetch(new Request('https://finance.test/api/v1/budget-plan-save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessJwt !== undefined ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {}),
    },
    body: JSON.stringify(body ?? { rows: [{ category: 'Expenses:Utilities', fiscal_year: 2027, planned_amount: '20600' }] }),
  }), env);
}

describe('Budget builder edit/save route — POST /api/v1/budget-plan-save', () => {
  it('rejects the wrong method with an Allow header naming only POST', async () => {
    const db = makeFinanceDb();
    const res = await worker.fetch(new Request('https://finance.test/api/v1/budget-plan-save'), baseEnv(db));
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('is off by default: a fresh database with no finance_settings flag returns not_yet_enabled, and writes nothing', async () => {
    const db = makeFinanceDb();
    const res = await postSave(baseEnv(db, roleFetch('admin')));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('not_yet_enabled');
    expect(db._raw.prepare('SELECT * FROM finance_budget_plan').all()).toHaveLength(0);
  });

  it('stays disabled for a non-"1" flag value, even one that looks truthy', async () => {
    const db = makeFinanceDb();
    db._raw.prepare('INSERT INTO finance_settings (key,value) VALUES (?,?)').run(BUDGET_PLAN_WRITES_ENABLED_KEY, 'true');
    const res = await postSave(baseEnv(db, roleFetch('admin')));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('not_yet_enabled');
  });

  it('checks the enablement gate before role verification -- a non-admin also gets not_yet_enabled while the flag is off, not access_denied', async () => {
    const db = makeFinanceDb();
    const res = await postSave(baseEnv(db, roleFetch('member')));
    expect((await res.json()).error).toBe('not_yet_enabled');
  });

  it('once enabled, denies a request with no verifiable Access identity (no CONNECT_SERVICE configured)', async () => {
    const db = makeFinanceDb();
    enableWrites(db);
    const res = await postSave(baseEnv(db)); // no CONNECT_SERVICE/key at all
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('access_denied');
    expect(db._raw.prepare('SELECT * FROM finance_budget_plan').all()).toHaveLength(0);
  });

  it('once enabled, denies a verified non-admin role (e.g. finance, staff, council)', async () => {
    const db = makeFinanceDb();
    enableWrites(db);
    for (const role of ['finance', 'staff', 'council', 'member', 'volunteer', 'compensation']) {
      const res = await postSave(baseEnv(db, roleFetch(role)));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe('access_denied');
    }
    expect(db._raw.prepare('SELECT * FROM finance_budget_plan').all()).toHaveLength(0);
  });

  it('once enabled, rejects a malformed JSON body', async () => {
    const db = makeFinanceDb();
    enableWrites(db);
    const res = await worker.fetch(new Request('https://finance.test/api/v1/budget-plan-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
      body: 'not json{{{',
    }), baseEnv(db, roleFetch('admin')));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_json');
  });

  it('once enabled, rejects the whole batch if one row is malformed, writing nothing', async () => {
    const db = makeFinanceDb();
    enableWrites(db);
    const res = await postSave(baseEnv(db, roleFetch('admin')), { body: { rows: [
      { category: 'Expenses:Utilities', fiscal_year: 2027, planned_amount: '20600' },
      { category: '', fiscal_year: 2027, planned_amount: '100' },
    ] } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_rows');
    expect(db._raw.prepare('SELECT * FROM finance_budget_plan').all()).toHaveLength(0);
  });

  it('an admin, once enabled, successfully saves rows into FINANCE_DB\'s finance_budget_plan', async () => {
    const db = makeFinanceDb();
    enableWrites(db);
    const res = await postSave(baseEnv(db, roleFetch('admin')), { body: { rows: [
      { category: 'Expenses:Utilities', classification: 'Expenses', fiscal_year: 2027, planned_amount: '20600' },
      { category: 'Income:Offerings', classification: 'Income', fiscal_year: 2027, planned_amount: '500000' },
    ] } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, saved: 2 });
    expect(res.headers.get('x-finance-contract')).toBe('finance.budget-plan-save.v1');
    const rows = db._raw.prepare('SELECT * FROM finance_budget_plan ORDER BY category').all();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.category === 'Expenses:Utilities').planned_amount_cents).toBe(2060000);
    expect(rows.find((r) => r.category === 'Income:Offerings').planned_amount_cents).toBe(50000000);
    rows.forEach((r) => expect(r.basis).toBe('manual'));
  });

  it('re-saving the same category/fiscal_year replaces the row rather than duplicating it', async () => {
    const db = makeFinanceDb();
    enableWrites(db);
    const env = baseEnv(db, roleFetch('admin'));
    await postSave(env, { body: { rows: [{ category: 'Expenses:Utilities', fiscal_year: 2027, planned_amount: '20600' }] } });
    await postSave(env, { body: { rows: [{ category: 'Expenses:Utilities', fiscal_year: 2027, planned_amount: '21500' }] } });
    const rows = db._raw.prepare('SELECT * FROM finance_budget_plan').all();
    expect(rows).toHaveLength(1);
    expect(rows[0].planned_amount_cents).toBe(2150000);
  });
});
