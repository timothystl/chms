import { describe, it, expect, vi } from 'vitest';
import {
  getAuthInfo, authCookieHeader, idleTimeoutForRole,
  IDLE_TIMEOUT_MS, MEMBER_IDLE_TIMEOUT_MS,
} from '../src/auth.js';

// Reported 2026-08-03: "Login is not persistent" — a member opening the directory from a
// Tithe.ly Church App weblink tab had to sign in on essentially every visit. Two independent
// causes, both policy choices in this file: the cookie was issued with no Max-Age (so any
// browser or in-app webview discarded it on close), and the idle window was 8 hours for every
// role (so a member checking the directory next Sunday was expired regardless).
//
// Members now get a persistent, 30-day sliding session. Every other role is unchanged.

function mockEnv(userRow) {
  return {
    SESSION_SECRET: 'test-signing-secret',
    DB: {
      prepare: () => ({ bind: () => ({ first: async () => userRow }) }),
    },
  };
}

const req = (cookie) =>
  new Request('https://connect.timothystl.org/admin/api/people', { headers: { cookie } });

/**
 * Mint a genuinely old cookie by moving the clock back and signing there, rather than
 * editing the timestamp afterwards — the HMAC covers `ts.role.username`, so a rewritten
 * timestamp fails signature verification and every case would pass for the wrong reason
 * (rejected as forged, not as expired).
 */
async function agedCookie(env, role, username, ageMs) {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date(Date.now() - ageMs));
    const fresh = await authCookieHeader(env, role, username);
    return fresh.split(';')[0];
  } finally {
    vi.useRealTimers();
  }
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('idleTimeoutForRole', () => {
  it('gives member the long window and everyone else the short one', () => {
    expect(idleTimeoutForRole('member')).toBe(MEMBER_IDLE_TIMEOUT_MS);
    for (const r of ['admin', 'finance', 'staff', 'office']) {
      expect(idleTimeoutForRole(r)).toBe(IDLE_TIMEOUT_MS);
    }
  });

  it('fails safe to the short window for an unknown or missing role', () => {
    expect(idleTimeoutForRole(undefined)).toBe(IDLE_TIMEOUT_MS);
    expect(idleTimeoutForRole('')).toBe(IDLE_TIMEOUT_MS);
    expect(idleTimeoutForRole('Member')).toBe(IDLE_TIMEOUT_MS); // exact match only
  });

  it('keeps the member window meaningfully longer than the staff one', () => {
    expect(MEMBER_IDLE_TIMEOUT_MS).toBeGreaterThan(IDLE_TIMEOUT_MS);
    expect(MEMBER_IDLE_TIMEOUT_MS).toBe(30 * DAY);
  });
});

describe('authCookieHeader — persistence', () => {
  it('sets Max-Age for a member so a webview keeps the cookie after close', async () => {
    const env = mockEnv({ active: 1, role: 'member' });
    const c = await authCookieHeader(env, 'member', 'jsmith');
    expect(c).toContain('Max-Age=' + Math.floor(MEMBER_IDLE_TIMEOUT_MS / 1000));
  });

  it('leaves every other role a session cookie that dies with the browser', async () => {
    const env = mockEnv({ active: 1, role: 'staff' });
    for (const r of ['admin', 'finance', 'staff', 'office']) {
      expect(await authCookieHeader(env, r, 'jdoe')).not.toContain('Max-Age');
    }
  });

  it('keeps the existing security attributes on both paths', async () => {
    const env = mockEnv({ active: 1, role: 'member' });
    for (const r of ['member', 'staff']) {
      const c = await authCookieHeader(env, r, 'u');
      expect(c).toContain('HttpOnly');
      expect(c).toContain('Secure');
      expect(c).toContain('SameSite=Lax');
      expect(c).toContain('Path=/');
    }
  });
});

describe('getAuthInfo — idle window by role', () => {
  it('accepts a member cookie well past the old 8-hour limit', async () => {
    const env = mockEnv({ active: 1, role: 'member' });
    const c = await agedCookie(env, 'member', 'jsmith', 20 * DAY);
    expect(await getAuthInfo(req(c), env)).toEqual({ role: 'member', username: 'jsmith' });
  });

  it('still expires a member cookie past 30 days', async () => {
    const env = mockEnv({ active: 1, role: 'member' });
    const c = await agedCookie(env, 'member', 'jsmith', 31 * DAY);
    expect(await getAuthInfo(req(c), env)).toBeNull();
  });

  it('leaves the staff window at 8 hours — unchanged by this fix', async () => {
    const env = mockEnv({ active: 1, role: 'staff' });
    expect(await getAuthInfo(req(await agedCookie(env, 'staff', 'jdoe', 7 * HOUR)), env))
      .toEqual({ role: 'staff', username: 'jdoe' });
    expect(await getAuthInfo(req(await agedCookie(env, 'staff', 'jdoe', 9 * HOUR)), env))
      .toBeNull();
  });

  // The privilege case: the first gate reads the role the cookie was signed with, which may
  // no longer be the user's role. Authorization uses the CURRENT DB role, so the session
  // lifetime has to tighten alongside it — otherwise a promoted member would hold staff
  // permissions on a 30-day cookie.
  it('re-gates to the short window when the DB role is no longer member', async () => {
    const promoted = mockEnv({ active: 1, role: 'staff' });
    const c = await agedCookie(promoted, 'member', 'jsmith', 10 * DAY);
    expect(await getAuthInfo(req(c), promoted)).toBeNull();
  });

  it('still honors the member window when the DB agrees they are a member', async () => {
    const env = mockEnv({ active: 1, role: 'member' });
    const c = await agedCookie(env, 'member', 'jsmith', 10 * DAY);
    expect(await getAuthInfo(req(c), env)).not.toBeNull();
  });

  it('revokes a deactivated member immediately, regardless of cookie lifetime', async () => {
    const env = mockEnv({ active: 0, role: 'member' });
    const c = await agedCookie(env, 'member', 'jsmith', 1 * HOUR);
    expect(await getAuthInfo(req(c), env)).toBeNull();
  });

  it('rejects a cookie whose role was edited to buy the longer window', async () => {
    const env = mockEnv({ active: 1, role: 'member' });
    // Sign a genuinely 10-day-old *staff* cookie, then rewrite only the role claim to
    // `member` to try to buy the 30-day window. The HMAC covers ts.role.username, so this
    // must fail verification. Timestamp is left untouched so the signature is the only
    // thing under test here.
    const aged = await agedCookie(env, 'staff', 'jdoe', 10 * DAY);
    const parts = aged.replace('vol_auth=', '').split('.');
    parts[1] = 'member';
    expect(await getAuthInfo(req('vol_auth=' + parts.join('.')), env)).toBeNull();
  });
});
