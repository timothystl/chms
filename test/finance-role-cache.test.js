import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import worker from '../apps/finance/shell.js';
import { resetEnsuredSchemasForTests } from '../apps/finance/finance-owned-schema.js';
import { resetAccessJwtCacheForTests } from '../apps/finance/access-jwt.js';
import { ROLE_CACHE_MAX_AGE_MS, resolvePageRole } from '../apps/finance/role-cache.js';

const TEAM = 'team.example.com';
const AUD = 'finance-aud';
const b64url = (buf) => Buffer.from(buf).toString('base64url');

let keyPair;
let publicJwk;
async function keys() {
  if (!keyPair) {
    keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    publicJwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'k1', alg: 'RS256' };
  }
}
async function jwt(claims) {
  await keys();
  const head = b64url(JSON.stringify({ alg: 'RS256', kid: 'k1' }));
  const body = b64url(JSON.stringify({ iss: `https://${TEAM}`, aud: [AUD], email: 'Admin@Example.org', exp: Math.floor(Date.now() / 1000) + 3600, ...claims }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}
const certsFetch = async () => new Response(JSON.stringify({ keys: [publicJwk] }));

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  const statement = (sql, args = []) => ({
    sql,
    bind: (...next) => statement(sql, next),
    async run() { sqlite.prepare(sql).run(...args); return { meta: {} }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  return { sqlite, prepare: (sql) => statement(sql), async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; } };
}

function makeEnv(db = makeDb()) {
  const state = { mode: 'ok' };
  const env = {
    ENVIRONMENT: 'production', FINANCE_CONTRACT_API_KEY: 'k', FINANCE_DB: db,
    FINANCE_ACCESS_TEAM_DOMAIN: TEAM, FINANCE_ACCESS_AUD: AUD,
    CONNECT_SERVICE: {
      async fetch(req) {
        const url = new URL(req.url);
        if (!url.pathname.endsWith('/staff-role-v1')) return new Response('{}', { status: 404 });
        if (state.mode === 'timeout') { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; }
        if (state.mode === '503') return new Response('{}', { status: 503 });
        if (state.mode === '403') return new Response(JSON.stringify({ error: 'No matching active Connect account' }), { status: 403 });
        return new Response(JSON.stringify({ role: 'admin', identity: 'admin@example.org', username: 'andrew', permissions: { finance: 'edit', giving: 'edit' } }));
      },
    },
  };
  return { env, db, state };
}

beforeEach(() => { resetEnsuredSchemasForTests(); resetAccessJwtCacheForTests(); });

describe('Finance role fallback', () => {
  it('saves each confirmed role and uses it when Connect times out', async () => {
    const { env, db, state } = makeEnv();
    const token = await jwt({});
    expect((await resolvePageRole(env, token, { fetchImpl: certsFetch })).role).toBe('admin');
    expect(db.sqlite.prepare('SELECT identity, role FROM finance_role_cache').get()).toEqual({ identity: 'admin@example.org', role: 'admin' });
    state.mode = 'timeout';
    const saved = await resolvePageRole(env, token, { fetchImpl: certsFetch });
    expect(saved).toMatchObject({ ok: true, role: 'admin', source: 'saved', identity: 'admin@example.org', permissions: { finance: 'edit', giving: 'edit' } });
    state.mode = '503';
    expect((await resolvePageRole(env, token, { fetchImpl: certsFetch })).source).toBe('saved');
  });

  it('never overrides a refusal from Connect', async () => {
    const { env, state } = makeEnv();
    const token = await jwt({});
    await resolvePageRole(env, token, { fetchImpl: certsFetch });
    state.mode = '403';
    expect(await resolvePageRole(env, token, { fetchImpl: certsFetch })).toMatchObject({ ok: false, status: 403 });
  });

  it('ignores a saved role older than seven days', async () => {
    const { env, db, state } = makeEnv();
    const token = await jwt({});
    await resolvePageRole(env, token, { fetchImpl: certsFetch });
    db.sqlite.prepare("UPDATE finance_role_cache SET verified_at = datetime('now', '-8 days')").run();
    state.mode = 'timeout';
    expect((await resolvePageRole(env, token, { fetchImpl: certsFetch })).ok).toBe(false);
    expect(ROLE_CACHE_MAX_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('needs a valid sign-in for this Finance app before using a saved role', async () => {
    const { env, state } = makeEnv();
    await resolvePageRole(env, await jwt({}), { fetchImpl: certsFetch });
    state.mode = 'timeout';
    for (const bad of [await jwt({ aud: ['other-app'] }), await jwt({ exp: Math.floor(Date.now() / 1000) - 10 }), await jwt({ email: 'someone.else@example.org' }), 'not.a.jwt']) {
      expect((await resolvePageRole(env, bad, { fetchImpl: certsFetch })).ok).toBe(false);
    }
  });

  it('opens the page with a notice when Connect cannot answer', async () => {
    const { env, state } = makeEnv();
    const token = await jwt({});
    // The page itself fetches Access's certs through the global fetch.
    const realFetch = globalThis.fetch;
    globalThis.fetch = certsFetch;
    try {
      await worker.fetch(new Request('https://finance.test/?section=property&page=acquisition', { headers: { 'Cf-Access-Jwt-Assertion': token } }), env);
      state.mode = 'timeout';
      const res = await worker.fetch(new Request('https://finance.test/?section=property&page=acquisition', { headers: { 'Cf-Access-Jwt-Assertion': token } }), env);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Connect unavailable');
      expect(html).toContain('6707 Fyler pro forma');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('keeps saves on the live check', async () => {
    const { env, state } = makeEnv();
    const token = await jwt({});
    await resolvePageRole(env, token, { fetchImpl: certsFetch });
    state.mode = 'timeout';
    const res = await worker.fetch(new Request('https://finance.test/api/v1/property/bank-rec-save', {
      method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': token, 'Sec-Fetch-Site': 'same-origin' },
      body: new URLSearchParams({ statement_month: '2026-08', statement_balance: '1', book_balance: '1' }),
    }), env);
    expect(res.headers.get('Location')).toContain('access_denied');
  });
});
