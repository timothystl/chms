import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { handleAdminLogin } from '../src/api-admin.js';
import { hashPassword } from '../src/auth.js';

// P22-G / SEC22. handleAdminLogin used to read four env vars it never referenced again:
// FINANCE_PASSWORD, STAFF_PASSWORD, MEMBER_PASSWORD and ADMIN_EMAIL. Three of them read like
// live per-role logins. They were not — but nothing in the codebase said so, and the only way
// to know was to trace every use of a local const to the end of a 60-line function.
//
// Deleting them is a no-op by definition, so the tests that matter are the ones proving the
// BEHAVIOR was already what the names suggested it was not: setting FINANCE_PASSWORD grants
// nobody anything, before or after. The source scan at the bottom is the part that keeps it
// that way.

const ADMIN_PW = 'correct-horse-battery-staple';

/** A login POST, form-encoded exactly as the real login page submits it. */
const loginReq = (username, password) =>
  new Request('https://connect.timothystl.org/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '203.0.113.7' },
    body: new URLSearchParams({ username, password }).toString(),
  });

/** env with every role-password variable set, to prove none of them is an authentication path. */
function envWith(users = []) {
  return {
    ADMIN_PASSWORD: ADMIN_PW,
    FINANCE_PASSWORD: 'finance-pw',
    STAFF_PASSWORD: 'staff-pw',
    MEMBER_PASSWORD: 'member-pw',
    ADMIN_EMAIL: 'Timothy Lutheran <noreply@timothystl.org>',
    // No RSVP_STORE: rate limiting is out of scope here (that is P22-E) and its absence
    // keeps these runs independent of each other.
    DB: {
      prepare: (sql) => ({
        bind: (...args) => ({
          first: async () => (/FROM app_users/.test(sql)
            ? users.find((u) => u.username.toLowerCase() === String(args[0]).toLowerCase()) || null
            : null),
          run: async () => ({}),
        }),
      }),
    },
  };
}

const signedIn = (res) => res.status === 302 && !!res.headers.get('Set-Cookie');

describe('admin login — the role-password env vars were never a login (SEC22)', () => {
  for (const [role, pw] of [['finance', 'finance-pw'], ['staff', 'staff-pw'], ['member', 'member-pw']]) {
    it('rejects ' + role + ' / ' + role.toUpperCase() + '_PASSWORD', async () => {
      const res = await handleAdminLogin(loginReq(role, pw), envWith());
      expect(signedIn(res)).toBe(false);
      expect(await res.text()).toContain('Incorrect password');
    });
  }

  it('rejects a role password submitted against the admin username', async () => {
    const res = await handleAdminLogin(loginReq('admin', 'finance-pw'), envWith());
    expect(signedIn(res)).toBe(false);
  });
});

describe('admin login — the credentials that are real still work', () => {
  it('accepts the break-glass ADMIN_PASSWORD', async () => {
    const res = await handleAdminLogin(loginReq('admin', ADMIN_PW), envWith());
    expect(signedIn(res)).toBe(true);
    expect(res.headers.get('Location')).toBe('/');
  });

  it('accepts an active app_users account', async () => {
    const env = envWith([
      { id: 3, username: 'Jinah', password_hash: await hashPassword('her-real-password'), role: 'staff', active: 1 },
    ]);
    expect(signedIn(await handleAdminLogin(loginReq('jinah', 'her-real-password'), env))).toBe(true);
    expect(signedIn(await handleAdminLogin(loginReq('jinah', 'wrong'), env))).toBe(false);
  });

  it('still refuses a deactivated account, role password or not', async () => {
    const env = envWith([
      { id: 4, username: 'former', password_hash: await hashPassword('x'), role: 'finance', active: 0 },
    ]);
    expect(signedIn(await handleAdminLogin(loginReq('former', 'x'), env))).toBe(false);
    expect(signedIn(await handleAdminLogin(loginReq('former', 'finance-pw'), env))).toBe(false);
  });

  it('refuses everyone when ADMIN_PASSWORD is unset, rather than falling back to a role password', async () => {
    const env = envWith();
    delete env.ADMIN_PASSWORD;
    const res = await handleAdminLogin(loginReq('finance', 'finance-pw'), env);
    expect(signedIn(res)).toBe(false);
    expect(await res.text()).toContain('ADMIN_PASSWORD');
  });
});

describe('admin login — no new env credential creeps back in', () => {
  // A role-password env var is an authentication path with no account behind it: nothing to
  // deactivate, nothing in app_users to audit, and no way to tell afterwards whose login it was.
  // That is why this is a scan and not just a behavior test — a dead one reads exactly like a
  // live one, which is how these four survived this long.
  const source = fs.readFileSync(new URL('../src/api-admin.js', import.meta.url), 'utf8');
  const fnStart = source.indexOf('export async function handleAdminLogin');
  const fnEnd = source.indexOf('\n}', source.indexOf('Incorrect password', fnStart));
  const body = source.slice(fnStart, fnEnd);

  it('reads exactly one password from env, and it is ADMIN_PASSWORD', () => {
    expect(fnStart).toBeGreaterThan(-1);
    const envPasswords = [...body.matchAll(/env\.([A-Z_]*PASSWORD[A-Z_]*)/g)].map((m) => m[1]);
    expect([...new Set(envPasswords)]).toEqual(['ADMIN_PASSWORD']);
  });

  it('carries no other credential-shaped env read', () => {
    const reads = [...body.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]);
    const credentialish = reads.filter((n) => /PASSWORD|SECRET|_KEY|TOKEN|EMAIL/.test(n));
    expect([...new Set(credentialish)]).toEqual(['ADMIN_PASSWORD']);
  });

  it('the four deleted names are gone from the whole module', () => {
    for (const name of ['FINANCE_PASSWORD', 'STAFF_PASSWORD', 'MEMBER_PASSWORD', 'ADMIN_EMAIL']) {
      // The comment explaining the removal names them; the code must not read them.
      expect(source).not.toMatch(new RegExp('env\\.' + name));
    }
  });
});
