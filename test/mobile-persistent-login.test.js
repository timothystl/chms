import { describe, it, expect, vi } from 'vitest';
import worker from '../tlc-volunteer-worker.js';
import { handleAdminLogin } from '../src/api-admin.js';
import { authCookieHeader, hashPassword } from '../src/auth.js';

// Reported 2026-08-28: staff/admin had to log back into the app on their phone every time,
// unlike a normal app that stays signed in on a trusted personal device. The member tier
// already had a persistent 30-day session (see session-lifetime.test.js) — this extends the
// same treatment to any role when the request comes from a phone (isPhoneUserAgent, read from
// the request's own User-Agent), so a desktop/shared-computer session is unchanged. These
// tests drive the REAL login handler and the REAL worker.fetch() end to end (not just the
// idleTimeoutFor/authCookieHeader units already covered in session-lifetime.test.js), so a
// wiring mistake — forgetting to pass `req` through to refreshAuthCookie, or the login route
// not actually reading the User-Agent — shows up as the wrong shell/cookie actually served.

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DAY = 24 * 60 * 60 * 1000;

function makeKvStore() {
  const store = new Map();
  return {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

function envWithUser(user) {
  const stmt = (sql) => ({
    bind: (...args) => ({
      first: async () => (/FROM app_users/.test(sql)
        ? (user && user.username.toLowerCase() === String(args[0]).toLowerCase() ? user : null)
        : null),
      all: async () => ({ results: [] }),
      run: async () => ({ meta: {} }),
    }),
    first: async () => null,
    all: async () => ({ results: [] }),
    run: async () => ({ meta: {} }),
  });
  return {
    ADMIN_PASSWORD: 'break-glass-pw',
    SESSION_SECRET: 'test-session-secret',
    RSVP_STORE: makeKvStore(),
    DB: {
      prepare: (sql) => stmt(sql),
      batch: async () => [],
      exec: async () => ({}),
    },
  };
}

const loginReq = (username, password, ua) =>
  new Request('https://connect.timothystl.org/admin/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'CF-Connecting-IP': '203.0.113.7',
      ...(ua ? { 'User-Agent': ua } : {}),
    },
    body: new URLSearchParams({ username, password }).toString(),
  });

describe('login mints a persistent cookie for a phone, a session-only one for a desktop', () => {
  it('sets Max-Age on the login response cookie when the login comes from a phone', async () => {
    const env = envWithUser({ id: 1, username: 'andrew', password_hash: await hashPassword('pw'), role: 'admin', active: 1 });
    const res = await handleAdminLogin(loginReq('andrew', 'pw', IPHONE_UA), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Set-Cookie')).toMatch(/Max-Age=\d+/);
  });

  it('leaves the login response cookie without Max-Age on a desktop browser', async () => {
    const env = envWithUser({ id: 1, username: 'andrew', password_hash: await hashPassword('pw'), role: 'admin', active: 1 });
    const res = await handleAdminLogin(loginReq('andrew', 'pw', DESKTOP_UA), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Set-Cookie')).not.toMatch(/Max-Age/);
  });

  it('same behavior for the break-glass admin login, not just a DB account', async () => {
    const env = envWithUser(null);
    const mobile = await handleAdminLogin(loginReq('admin', 'break-glass-pw', IPHONE_UA), env);
    expect(mobile.headers.get('Set-Cookie')).toMatch(/Max-Age/);
    const desktop = await handleAdminLogin(loginReq('admin', 'break-glass-pw', DESKTOP_UA), env);
    expect(desktop.headers.get('Set-Cookie')).not.toMatch(/Max-Age/);
  });
});

describe('a real request through the worker honors the phone-only long window', () => {
  async function agedStaffCookie(env, ageMs, isMobile) {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.now() - ageMs));
      return (await authCookieHeader(env, 'staff', 'jdoe', isMobile)).split(';')[0];
    } finally {
      vi.useRealTimers();
    }
  }

  it('a 10-day-old staff cookie is accepted on a phone and refreshed with Max-Age again', async () => {
    const env = envWithUser({ id: 2, username: 'jdoe', password_hash: 'x', role: 'staff', active: 1 });
    const cookie = await agedStaffCookie(env, 10 * DAY, true);
    const res = await worker.fetch(new Request('https://connect.timothystl.org/admin/api/me', {
      headers: { cookie, 'User-Agent': IPHONE_UA },
    }), env);
    expect(res.status).toBe(200);
    // refreshAuthCookie re-mints on every authenticated response — confirms the worker entry
    // point actually threads the request's User-Agent through, not just authCookieHeader itself.
    expect(res.headers.get('Set-Cookie')).toMatch(/Max-Age=\d+/);
  });

  it('the same 10-day-old staff cookie is rejected when replayed from a desktop browser', async () => {
    const env = envWithUser({ id: 2, username: 'jdoe', password_hash: 'x', role: 'staff', active: 1 });
    const cookie = await agedStaffCookie(env, 10 * DAY, true);
    const res = await worker.fetch(new Request('https://connect.timothystl.org/admin/api/me', {
      headers: { cookie, 'User-Agent': DESKTOP_UA },
    }), env);
    expect(res.status).toBe(401);
  });

  it('a fresh staff cookie on a desktop still works as before (unchanged behavior)', async () => {
    const env = envWithUser({ id: 2, username: 'jdoe', password_hash: 'x', role: 'staff', active: 1 });
    const cookie = await agedStaffCookie(env, 30 * 60 * 1000, false);
    const res = await worker.fetch(new Request('https://connect.timothystl.org/admin/api/me', {
      headers: { cookie, 'User-Agent': DESKTOP_UA },
    }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).not.toMatch(/Max-Age/);
  });
});
