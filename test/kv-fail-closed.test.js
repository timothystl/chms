import { describe, it, expect } from 'vitest';
import { handleAdminLogin } from '../src/api-admin.js';
import { handleIntakeApi } from '../src/api-intake.js';
import { handleFinanceApi } from '../src/api-finance.js';

// P22-E (retires SEC20). Three call sites treated a missing RSVP_STORE (KV binding) as "skip
// the check" rather than "refuse" — login rate limiting, intake rate limiting, and QuickBooks
// OAuth `state` CSRF validation. A misconfigured environment silently lost brute-force
// protection, spam protection, and CSRF protection on the connect flow with nothing logged and
// nothing visible on screen. All three now fail CLOSED: refuse the request/flow instead of
// waving it through. Each test below is run first against code WITHOUT the fix reachable (by
// asserting the exact pre-fix behavior would have looked different) is impractical without a
// revert, so non-vacuousness is established by also proving the WITH-store path still works
// normally (i.e. the fix didn't just always refuse).

function makeKvStore() {
  const store = new Map();
  return {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    _store: store,
  };
}

describe('login rate limiting fails closed with no RSVP_STORE', () => {
  const loginReq = () => new Request('https://connect.timothystl.org/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '203.0.113.50' },
    body: new URLSearchParams({ username: 'admin', password: 'correct-horse-battery-staple' }).toString(),
  });

  it('refuses (503) even a correct password when RSVP_STORE is missing', async () => {
    const env = { ADMIN_PASSWORD: 'correct-horse-battery-staple', DB: null };
    const res = await handleAdminLogin(loginReq(), env);
    expect(res.status).toBe(503);
    expect(res.headers.get('Set-Cookie')).toBeFalsy();
  });

  it('still accepts the correct password when RSVP_STORE IS present (fix does not just always refuse)', async () => {
    const env = { ADMIN_PASSWORD: 'correct-horse-battery-staple', SESSION_SECRET: 'test-signing-secret', RSVP_STORE: makeKvStore(), DB: null };
    const res = await handleAdminLogin(loginReq(), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Set-Cookie')).toBeTruthy();
  });
});

describe('intake rate limiting fails closed with no RSVP_STORE', () => {
  const req = () => new Request('https://x/api/intake/prayer', {
    method: 'POST',
    headers: { 'X-Intake-Key': 'the-real-key', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Jane', message: 'Please pray for my family.' }),
  });

  it('refuses (429) a well-authenticated, well-formed submission when RSVP_STORE is missing', async () => {
    const env = { CHMS_INTAKE_API_KEY: 'the-real-key', DB: null };
    const res = await handleIntakeApi(req(), env, '/api/intake/prayer');
    expect(res.status).toBe(429);
  });

  it('still accepts a well-formed submission when RSVP_STORE IS present (fix does not just always refuse)', async () => {
    const inserted = [];
    const db = {
      prepare: (sql) => ({
        bind: (...args) => ({
          first: async () => null,
          run: async () => { inserted.push({ sql, args }); return { meta: { last_row_id: 1 } }; },
        }),
      }),
    };
    const env = { CHMS_INTAKE_API_KEY: 'the-real-key', RSVP_STORE: makeKvStore(), DB: db };
    const res = await handleIntakeApi(req(), env, '/api/intake/prayer');
    expect(res.status).toBe(200);
    expect(inserted.length).toBe(1);
  });
});

describe('QuickBooks OAuth state validation fails closed with no RSVP_STORE', () => {
  const qboEnv = (extra = {}) => ({
    QB_CLIENT_ID: 'id', QB_CLIENT_SECRET: 'secret', ...extra,
  });

  it('refuses to start the connect flow (503, no redirect to Intuit) when RSVP_STORE is missing', async () => {
    const url = new URL('https://connect.timothystl.org/admin/api/finance/qb/connect');
    const res = await handleFinanceApi(
      new Request(url), qboEnv(), url, 'GET', 'finance/qb/connect', null, /* isAdmin */ true, /* isFinance */ true
    );
    expect(res.status).toBe(503);
    expect(res.headers.get('Location')).toBeFalsy();
  });

  it('starts the connect flow normally (302 to Intuit) when RSVP_STORE IS present', async () => {
    const url = new URL('https://connect.timothystl.org/admin/api/finance/qb/connect');
    const store = makeKvStore();
    const res = await handleFinanceApi(
      new Request(url), qboEnv({ RSVP_STORE: store }), url, 'GET', 'finance/qb/connect', null, true, true
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('http');
    expect(store._store.size).toBe(1);
  });

  it('refuses the callback (redirects with an error, never trusts state) when RSVP_STORE is missing', async () => {
    const url = new URL('https://connect.timothystl.org/admin/api/finance/qb/callback?code=abc&realmId=1&state=forged');
    const res = await handleFinanceApi(
      new Request(url), qboEnv(), url, 'GET', 'finance/qb/callback', null, true, true
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('qb_error=state_store_unavailable');
  });

  it('rejects a callback whose state was never minted, even when RSVP_STORE IS present', async () => {
    const url = new URL('https://connect.timothystl.org/admin/api/finance/qb/callback?code=abc&realmId=1&state=forged');
    const res = await handleFinanceApi(
      new Request(url), qboEnv({ RSVP_STORE: makeKvStore() }), url, 'GET', 'finance/qb/callback', null, true, true
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('qb_error=invalid_or_expired_state');
  });
});
