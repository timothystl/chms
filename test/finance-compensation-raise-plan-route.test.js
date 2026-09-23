import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../apps/finance/shell.js';
import { COMPENSATION_PLAN_WRITE_FLAG_KEY } from '../apps/finance/compensation-plan-write-service.js';

function makeFinanceDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE finance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
  sqlite.exec(readFileSync(new URL('../apps/finance/migrations/0007_finance_compensation_worker_plan.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../apps/finance/migrations/0009_finance_compensation_raise_plan.sql', import.meta.url), 'utf8'));
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

// Same unverified-email-claim JWT shape approverEmailFromJwt (payroll-section.js) reads --
// see compensation-council-draft-service.js's header comment for why this is the identity
// source used to key a council member's private draft.
function fakeJwt(email) {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ email })).toString('base64url');
  return `${header}.${payload}.sig`;
}

function roleEnv(role, env = baseEnv(), email = 'someone@timothystl.org') {
  return {
    ...env,
    CONNECT_SERVICE: { async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role, identity: email }), { status: 200 });
      return new Response('not found', { status: 404 });
    } },
    FINANCE_CONTRACT_API_KEY: 'test-secret',
    __accessJwt: fakeJwt(email),
  };
}

function postJson(path, env, body) {
  return worker.fetch(new Request(`https://finance.test${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.__accessJwt !== undefined ? { 'Cf-Access-Jwt-Assertion': env.__accessJwt } : {}),
    },
    body: JSON.stringify(body),
  }), env);
}

describe('POST /api/v1/compensation-raise-plan-save -- route wiring', () => {
  it('rejects the wrong method with an Allow header naming only POST', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/compensation-raise-plan-save'), baseEnv());
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('answers "not yet enabled" when the flag is off, even for a verified admin', async () => {
    const env = roleEnv('admin');
    const res = await postJson('/api/v1/compensation-raise-plan-save', env, { fiscalYear: 2027, customPct: 3, scalePct: 2, baselineRosterOnly: false });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('not_yet_enabled');
  });

  it('once enabled, 403s a verified council role -- this route is admin/compensation only', async () => {
    const env = roleEnv('council');
    enableFlag(env.FINANCE_DB);
    const res = await postJson('/api/v1/compensation-raise-plan-save', env, { fiscalYear: 2027, customPct: 3, scalePct: 2, baselineRosterOnly: false });
    expect(res.status).toBe(403);
  });

  it('once enabled, 403s an unverified caller (no Access identity at all)', async () => {
    const env = baseEnv();
    enableFlag(env.FINANCE_DB);
    const res = await worker.fetch(new Request('https://finance.test/api/v1/compensation-raise-plan-save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fiscalYear: 2027, customPct: 3, scalePct: 2, baselineRosterOnly: false }),
    }), env);
    expect(res.status).toBe(403);
  });

  it('once enabled, a verified admin can save the global row end to end', async () => {
    const env = roleEnv('admin');
    enableFlag(env.FINANCE_DB);
    const res = await postJson('/api/v1/compensation-raise-plan-save', env, { fiscalYear: 2027, customPct: 3.5, scalePct: 2.5, baselineRosterOnly: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, fiscalYear: 2027 });
    const row = env.FINANCE_DB._raw.prepare('SELECT * FROM finance_compensation_raise_plan_options WHERE fiscal_year=2027').get();
    expect(row).toMatchObject({ custom_pct: 3.5, scale_pct: 2.5, baseline_roster_only: 1, updated_by_role: 'admin' });
  });

  it('once enabled, a verified compensation-role caller can also save', async () => {
    const env = roleEnv('compensation');
    enableFlag(env.FINANCE_DB);
    const res = await postJson('/api/v1/compensation-raise-plan-save', env, { fiscalYear: 2027, customPct: 1, scalePct: 1, baselineRosterOnly: false });
    expect(res.status).toBe(200);
  });

  it('rejects an invalid JSON body with 400', async () => {
    const env = roleEnv('admin');
    enableFlag(env.FINANCE_DB);
    const res = await worker.fetch(new Request('https://finance.test/api/v1/compensation-raise-plan-save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': env.__accessJwt }, body: 'not json',
    }), env);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/compensation-council-draft-save -- route wiring', () => {
  it('rejects the wrong method with an Allow header naming only POST', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/compensation-council-draft-save'), baseEnv());
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('answers "not yet enabled" when the flag is off, even for a verified council role', async () => {
    const env = roleEnv('council');
    const res = await postJson('/api/v1/compensation-council-draft-save', env, { fiscalYear: 2027, customPct: 3 });
    expect(res.status).toBe(503);
  });

  it('once enabled, 403s a verified admin -- this route is council only', async () => {
    const env = roleEnv('admin');
    enableFlag(env.FINANCE_DB);
    const res = await postJson('/api/v1/compensation-council-draft-save', env, { fiscalYear: 2027, customPct: 3 });
    expect(res.status).toBe(403);
  });

  it('once enabled, a verified council viewer can save a private draft, and it never touches the shared worker-plan table', async () => {
    const env = roleEnv('council', baseEnv(), 'alice@timothystl.org');
    enableFlag(env.FINANCE_DB);
    const res = await postJson('/api/v1/compensation-council-draft-save', env, {
      fiscalYear: 2027, customPct: 4, scalePct: 3, baselineRosterOnly: true,
      workerOverrides: { pastor_a: { compMethod: 'custom', adjustmentPct: 7 } },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, fiscalYear: 2027 });
    const draftRow = env.FINANCE_DB._raw.prepare('SELECT * FROM finance_compensation_council_draft').get();
    expect(draftRow.council_identity).toBe('alice@timothystl.org');
    expect(env.FINANCE_DB._raw.prepare('SELECT COUNT(*) AS n FROM finance_compensation_worker_plan').get().n).toBe(0);
  });

  it('uses only the verified identity even when the forwarded token claims another email', async () => {
    const env=roleEnv('council',baseEnv(),'verified@example.com'); enableFlag(env.FINANCE_DB);
    env.__accessJwt=fakeJwt('other@example.com');
    const res=await postJson('/api/v1/compensation-council-draft-save',env,{fiscalYear:2027,customPct:1});
    expect(res.status).toBe(200);
    expect(env.FINANCE_DB._raw.prepare('SELECT council_identity FROM finance_compensation_council_draft').get().council_identity).toBe('verified@example.com');
  });

  it('rejects an older role-only contract rather than deriving a private identity from the token', async () => {
    const env=roleEnv('council'); enableFlag(env.FINANCE_DB);
    env.CONNECT_SERVICE.fetch=async()=>new Response(JSON.stringify({role:'council'}));
    expect((await postJson('/api/v1/compensation-council-draft-save',env,{fiscalYear:2027})).status).toBe(403);
    expect(env.FINANCE_DB._raw.prepare('SELECT COUNT(*) AS n FROM finance_compensation_council_draft').get().n).toBe(0);
  });

  it('two different council members end to end get two isolated draft rows, keyed by their verified contract identity', async () => {
    const sharedDb = makeFinanceDb();
    enableFlag(sharedDb);
    const aliceEnv = roleEnv('council', { ENVIRONMENT: 'staging', FINANCE_DB: sharedDb }, 'alice@timothystl.org');
    const bobEnv = roleEnv('council', { ENVIRONMENT: 'staging', FINANCE_DB: sharedDb }, 'bob@timothystl.org');

    await postJson('/api/v1/compensation-council-draft-save', aliceEnv, { fiscalYear: 2027, customPct: 1 });
    await postJson('/api/v1/compensation-council-draft-save', bobEnv, { fiscalYear: 2027, customPct: 2 });

    const rows = sharedDb._raw.prepare('SELECT council_identity, custom_pct FROM finance_compensation_council_draft ORDER BY council_identity').all();
    expect(rows).toEqual([
      { council_identity: 'alice@timothystl.org', custom_pct: 1 },
      { council_identity: 'bob@timothystl.org', custom_pct: 2 },
    ]);
  });

  it('rejects an invalid JSON body with 400', async () => {
    const env = roleEnv('council');
    enableFlag(env.FINANCE_DB);
    const res = await worker.fetch(new Request('https://finance.test/api/v1/compensation-council-draft-save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': env.__accessJwt }, body: 'not json',
    }), env);
    expect(res.status).toBe(400);
  });

  it('rejects a validation error from the service layer (e.g. a malformed workerOverrides entry) with 400', async () => {
    const env = roleEnv('council');
    enableFlag(env.FINANCE_DB);
    const res = await postJson('/api/v1/compensation-council-draft-save', env, { fiscalYear: 2027, workerOverrides: { 'bad key': {} } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid workerKey/);
  });
});
