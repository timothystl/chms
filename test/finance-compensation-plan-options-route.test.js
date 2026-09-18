import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../apps/finance/shell.js';
import { COMPENSATION_PLAN_WRITE_FLAG_KEY } from '../apps/finance/compensation-plan-write-service.js';

// Same minimal D1-shaped wrapper and role-mocking pattern as
// test/finance-compensation-plan-write-route.test.js (the sibling route this shares its flag with).
function makeFinanceDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE finance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
  sqlite.exec(readFileSync(new URL('../apps/finance/migrations/0007_finance_compensation_worker_plan.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../apps/finance/migrations/0009_finance_compensation_plan_options.sql', import.meta.url), 'utf8'));
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

// A fake but correctly-SHAPED JWT (header.payload.signature) carrying an `email` claim --
// approverEmailFromJwt (payroll-section.js) reads this claim WITHOUT verifying the signature (the
// real access decision already happened via the mocked CONNECT_SERVICE role check above; see that
// function's own header comment), so this is enough to exercise the council-draft route's identity
// derivation end to end without a real Access token.
function fakeJwtWithEmail(email) {
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'none' })}.${b64url({ email })}.sig`;
}
const COUNCIL_JWT = fakeJwtWithEmail('elder-one@example.org');

function postJson(path, env, body, accessJwt = 'signed.jwt.here') {
  return worker.fetch(new Request(`https://finance.test${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessJwt !== undefined ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {}),
    },
    body: JSON.stringify(body),
  }), env);
}

describe('POST /api/v1/compensation-plan-options-save — global raise-plan options route', () => {
  it('answers "not yet enabled" when the flag is off, even for a verified admin', async () => {
    const env = roleEnv('admin');
    const res = await postJson('/api/v1/compensation-plan-options-save', env, { fiscalYear: 2027, options: { compCustomPct: 3 } });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('not_yet_enabled');
  });

  it('once enabled, still 403s an unverified caller', async () => {
    const env = baseEnv();
    enableFlag(env.FINANCE_DB);
    const res = await postJson('/api/v1/compensation-plan-options-save', env, { fiscalYear: 2027, options: {} }, undefined);
    expect(res.status).toBe(403);
  });

  it('once enabled, a verified admin can save and it lands in finance_compensation_plan_options', async () => {
    const env = roleEnv('admin');
    enableFlag(env.FINANCE_DB);
    const res = await postJson('/api/v1/compensation-plan-options-save', env, { fiscalYear: 2027, options: { compCustomPct: 4.5, compScalePct: null, compBaselineRosterOnly: true } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const row = env.FINANCE_DB._raw.prepare('SELECT * FROM finance_compensation_plan_options WHERE fiscal_year=2027').get();
    expect(row.comp_custom_pct).toBe(4.5);
    expect(row.comp_baseline_roster_only).toBe(1);
  });

  it('once enabled, a verified council caller is refused end-to-end -- council uses the draft route instead', async () => {
    const env = roleEnv('council');
    enableFlag(env.FINANCE_DB);
    const res = await postJson('/api/v1/compensation-plan-options-save', env, { fiscalYear: 2027, options: { compCustomPct: 99 } });
    expect(res.status).toBe(403);
    expect(env.FINANCE_DB._raw.prepare('SELECT COUNT(*) AS n FROM finance_compensation_plan_options').get().n).toBe(0);
  });
});

describe('POST /api/v1/compensation-council-draft-save — private per-council-member draft route', () => {
  it('answers "not yet enabled" when the flag is off', async () => {
    const env = roleEnv('council');
    const res = await postJson('/api/v1/compensation-council-draft-save', env, { fiscalYear: 2027, options: {}, workerOverrides: {} });
    expect(res.status).toBe(503);
  });

  it('once enabled, a verified admin is refused -- only council has a private draft', async () => {
    const env = roleEnv('admin');
    enableFlag(env.FINANCE_DB);
    const res = await postJson('/api/v1/compensation-council-draft-save', env, { fiscalYear: 2027, options: {}, workerOverrides: {} });
    expect(res.status).toBe(403);
  });

  it('once enabled, a verified council caller can save a draft keyed to their own verified role identity end to end', async () => {
    const env = roleEnv('council');
    enableFlag(env.FINANCE_DB);
    const res = await postJson('/api/v1/compensation-council-draft-save', env, {
      fiscalYear: 2027, options: { compCustomPct: 6 }, workerOverrides: { pastor_a: { adjustmentPct: 2 } },
    }, COUNCIL_JWT);
    expect(res.status).toBe(200);
    const rows = env.FINANCE_DB._raw.prepare('SELECT * FROM finance_compensation_council_draft WHERE fiscal_year=2027').all();
    expect(rows).toHaveLength(1);
    expect(rows[0].comp_custom_pct).toBe(6);
    expect(JSON.parse(rows[0].worker_overrides)).toEqual({ pastor_a: { adjustmentPct: 2 } });
    // Never touches the shared table.
    expect(env.FINANCE_DB._raw.prepare('SELECT COUNT(*) AS n FROM finance_compensation_worker_plan').get().n).toBe(0);
  });

  it('rejects malformed workerOverrides with a 400, not a silent partial write', async () => {
    const env = roleEnv('council');
    enableFlag(env.FINANCE_DB);
    const res = await postJson('/api/v1/compensation-council-draft-save', env, {
      fiscalYear: 2027, options: {}, workerOverrides: { pastor_a: { compMethod: 'made_up' } },
    }, COUNCIL_JWT);
    expect(res.status).toBe(400);
    expect(env.FINANCE_DB._raw.prepare('SELECT COUNT(*) AS n FROM finance_compensation_council_draft').get().n).toBe(0);
  });
});
