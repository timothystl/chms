import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../apps/finance/shell.js';
import { COMPENSATION_PLAN_WRITE_FLAG_KEY } from '../apps/finance/compensation-plan-write-service.js';

function makeFinanceDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE finance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
  sqlite.exec(readFileSync(new URL('../apps/finance/migrations/0007_finance_compensation_worker_plan.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
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

function enableFlag(db) {
  db._raw.prepare('INSERT INTO finance_settings (key, value) VALUES (?, ?)').run(COMPENSATION_PLAN_WRITE_FLAG_KEY, '1');
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

function postSave(env, body, accessJwt = 'signed.jwt.here') {
  return worker.fetch(new Request('https://finance.test/api/v1/compensation-plan-save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessJwt !== undefined ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {}),
    },
    body: JSON.stringify(body),
  }), env);
}

const WORKER_ROW = {
  workerKey: 'pastor_a', name: 'Pastor A', roleLabel: 'Senior Pastor',
  salaryCents: 7000000, benefitsCents: 1500000, compMethod: 'cola', adjustmentPct: 3.0,
  hideFromCouncil: false, notes: '',
};

describe('POST /api/v1/compensation-plan-save — route wiring', () => {
  it('rejects the wrong method with an Allow header naming only POST', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/compensation-plan-save'), baseEnv());
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('answers "not yet enabled" when the flag is off -- the default, real-production state today -- even for a verified admin', async () => {
    const env = roleEnv('admin');
    const res = await postSave(env, { fiscalYear: 2027, rows: [WORKER_ROW] });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('not_yet_enabled');
  });

  it('stays "not yet enabled" even with no Access identity at all -- the flag check runs before any role check', async () => {
    const res = await postSave(baseEnv(), { fiscalYear: 2027, rows: [WORKER_ROW] }, undefined);
    expect(res.status).toBe(503);
  });

  it('once enabled, still 403s an unverified caller', async () => {
    const env = baseEnv();
    enableFlag(env.FINANCE_DB);
    const res = await postSave(env, { fiscalYear: 2027, rows: [WORKER_ROW] }, undefined);
    expect(res.status).toBe(403);
  });

  it('once enabled, 403s a verified role outside admin/council/compensation (e.g. plain finance)', async () => {
    const env = roleEnv('finance');
    enableFlag(env.FINANCE_DB);
    const res = await postSave(env, { fiscalYear: 2027, rows: [WORKER_ROW] });
    expect(res.status).toBe(403);
  });

  it('once enabled, a verified admin can create a worker row', async () => {
    const env = roleEnv('admin');
    enableFlag(env.FINANCE_DB);
    const res = await postSave(env, { fiscalYear: 2027, rows: [WORKER_ROW] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, saved: 1 });
    const row = env.FINANCE_DB._raw.prepare('SELECT * FROM finance_compensation_worker_plan WHERE worker_key=?').get('pastor_a');
    expect(row.salary_cents).toBe(7000000);
  });

  it('once enabled, a verified council viewer can never write a hideFromCouncil worker row (isolation holds end-to-end through the HTTP route)', async () => {
    const adminEnv = roleEnv('admin');
    enableFlag(adminEnv.FINANCE_DB);
    await postSave(adminEnv, { fiscalYear: 2027, rows: [
      WORKER_ROW,
      { workerKey: 'sensitive_1', name: 'Sensitive Worker', roleLabel: 'Confidential', salaryCents: 9000000, benefitsCents: 2000000, compMethod: 'custom', adjustmentPct: 5, hideFromCouncil: true, notes: '' },
    ] });

    const councilEnv = roleEnv('council', { ...adminEnv, FINANCE_DB: adminEnv.FINANCE_DB });
    const visibleEdit = await postSave(councilEnv, { fiscalYear: 2027, rows: [{ workerKey: 'pastor_a', compMethod: 'scale', adjustmentPct: 4 }] });
    expect(visibleEdit.status).toBe(200);

    const hiddenEdit = await postSave(councilEnv, { fiscalYear: 2027, rows: [{ workerKey: 'sensitive_1', compMethod: 'scale', adjustmentPct: 50 }] });
    expect(hiddenEdit.status).toBe(403);
    const hiddenBody = await hiddenEdit.json();
    expect(hiddenBody.error).toBe('Access denied: you may not edit this worker row');

    const hiddenRow = adminEnv.FINANCE_DB._raw.prepare('SELECT comp_method, adjustment_pct FROM finance_compensation_worker_plan WHERE worker_key=?').get('sensitive_1');
    expect(hiddenRow.comp_method).toBe('custom');
    expect(hiddenRow.adjustment_pct).toBe(5);
  });
});
