import { describe, it, expect } from 'vitest';
import { getAuthInfo, getAuthRole, isAuthed, authCookieHeader } from '../src/auth.js';

// Minimal D1 stand-in that counts how many times app_users is queried.
function mockEnv(userRow, counter) {
  return {
    SESSION_SECRET: 'test-signing-secret',
    DB: {
      prepare() {
        return {
          bind() {
            return {
              first: async () => { counter.n++; return userRow; },
            };
          },
        };
      },
    },
  };
}

function reqWithCookie(cookie) {
  return new Request('https://connect.timothystl.org/admin/api/dashboard', {
    headers: cookie ? { cookie } : {},
  });
}

describe('getAuthInfo per-request memoization', () => {
  it('resolves the DB-backed session exactly once for repeated calls on one Request', async () => {
    const counter = { n: 0 };
    const env = mockEnv({ active: 1, role: 'staff' }, counter);
    const cookie = await authCookieHeader(env, 'staff', 'jdoe');
    const req = reqWithCookie(cookie.split(';')[0]);

    // Mirrors a real request: worker entry, the /admin/api/ gate, then handler dispatch.
    const a = await getAuthInfo(req, env);
    const authed = await isAuthed(req, env);
    const role = await getAuthRole(req, env);

    expect(a).toEqual({ role: 'staff', username: 'jdoe' });
    expect(authed).toBe(true);
    expect(role).toBe('staff');
    expect(counter.n).toBe(1);
  });

  it('does not share resolution between two different Requests', async () => {
    const counter = { n: 0 };
    const env = mockEnv({ active: 1, role: 'staff' }, counter);
    const cookie = (await authCookieHeader(env, 'staff', 'jdoe')).split(';')[0];

    await getAuthInfo(reqWithCookie(cookie), env);
    await getAuthInfo(reqWithCookie(cookie), env);

    expect(counter.n).toBe(2);
  });

  it('still returns the CURRENT db role, not the role signed into the cookie', async () => {
    const counter = { n: 0 };
    const env = mockEnv({ active: 1, role: 'member' }, counter);
    // Cookie was signed while the user was staff; DB has since demoted them.
    const cookie = (await authCookieHeader(env, 'staff', 'jdoe')).split(';')[0];

    expect(await getAuthRole(reqWithCookie(cookie), env)).toBe('member');
  });

  it('still fails closed for a deactivated user', async () => {
    const counter = { n: 0 };
    const env = mockEnv({ active: 0, role: 'admin' }, counter);
    const cookie = (await authCookieHeader(env, 'admin', 'jdoe')).split(';')[0];

    expect(await getAuthInfo(reqWithCookie(cookie), env)).toBe(null);
  });

  it('rejects a cookie signed with a different secret', async () => {
    const counter = { n: 0 };
    const signingEnv = mockEnv({ active: 1, role: 'admin' }, counter);
    const cookie = (await authCookieHeader(signingEnv, 'admin', 'jdoe')).split(';')[0];

    const otherEnv = mockEnv({ active: 1, role: 'admin' }, counter);
    otherEnv.SESSION_SECRET = 'a-different-secret';

    expect(await getAuthInfo(reqWithCookie(cookie), otherEnv)).toBe(null);
  });
});
