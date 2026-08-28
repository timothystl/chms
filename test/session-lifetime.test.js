import { describe, it, expect, vi } from 'vitest';
import {
  getAuthInfo, authCookieHeader, idleTimeoutFor, isPhoneUserAgent,
  IDLE_TIMEOUT_MS, PERSISTENT_IDLE_TIMEOUT_MS,
} from '../src/auth.js';

// Reported 2026-08-03: "Login is not persistent" — a member opening the directory from a
// Tithe.ly Church App weblink tab had to sign in on essentially every visit. Two independent
// causes, both policy choices in this file: the cookie was issued with no Max-Age (so any
// browser or in-app webview discarded it on close), and the idle window was 8 hours for every
// role (so a member checking the directory next Sunday was expired regardless).
//
// Reported again 2026-08-28, this time from staff: "auto log out... on the mobile version of
// the app I don't want to have to log in every time... it should function like an app." Same
// underlying cause, one level up — the persistent-cookie treatment only ever looked at ROLE
// (member vs. everyone else), so a staff/admin account on their own phone still got bounced
// out of the app every 8 hours even though it's a personal device, not a shared office
// terminal. The fix generalizes the member-only behavior to a DEVICE signal: anyone on a
// phone (isPhoneUserAgent, read from the request's own User-Agent) now gets the same
// persistent, 30-day sliding session member already had — a desktop/laptop session for a
// non-member role is unchanged.

function mockEnv(userRow) {
  return {
    SESSION_SECRET: 'test-signing-secret',
    DB: {
      prepare: () => ({ bind: () => ({ first: async () => userRow }) }),
    },
  };
}

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const req = (cookie, ua = '') =>
  new Request('https://connect.timothystl.org/admin/api/people', {
    headers: ua ? { cookie, 'User-Agent': ua } : { cookie },
  });

/**
 * Mint a genuinely old cookie by moving the clock back and signing there, rather than
 * editing the timestamp afterwards — the HMAC covers `ts.role.username`, so a rewritten
 * timestamp fails signature verification and every case would pass for the wrong reason
 * (rejected as forged, not as expired).
 */
async function agedCookie(env, role, username, ageMs, isMobile = false) {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date(Date.now() - ageMs));
    const fresh = await authCookieHeader(env, role, username, isMobile);
    return fresh.split(';')[0];
  } finally {
    vi.useRealTimers();
  }
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('isPhoneUserAgent', () => {
  it('recognizes a phone User-Agent', () => {
    expect(isPhoneUserAgent(req('', IPHONE_UA))).toBe(true);
  });
  it('does not flag a desktop User-Agent', () => {
    expect(isPhoneUserAgent(req('', DESKTOP_UA))).toBe(false);
  });
  it('does not flag a missing User-Agent', () => {
    expect(isPhoneUserAgent(req(''))).toBe(false);
  });
});

describe('idleTimeoutFor', () => {
  it('gives member the long window on any device', () => {
    expect(idleTimeoutFor('member', false)).toBe(PERSISTENT_IDLE_TIMEOUT_MS);
    expect(idleTimeoutFor('member', true)).toBe(PERSISTENT_IDLE_TIMEOUT_MS);
  });

  it('gives every other role the long window too, but only on a phone', () => {
    for (const r of ['admin', 'finance', 'staff', 'office']) {
      expect(idleTimeoutFor(r, true)).toBe(PERSISTENT_IDLE_TIMEOUT_MS);
      expect(idleTimeoutFor(r, false)).toBe(IDLE_TIMEOUT_MS);
    }
  });

  it('fails safe to the short window for an unknown or missing role on a desktop', () => {
    expect(idleTimeoutFor(undefined, false)).toBe(IDLE_TIMEOUT_MS);
    expect(idleTimeoutFor('', false)).toBe(IDLE_TIMEOUT_MS);
    expect(idleTimeoutFor('Member', false)).toBe(IDLE_TIMEOUT_MS); // exact match only
  });

  it('keeps the persistent window meaningfully longer than the desktop one', () => {
    expect(PERSISTENT_IDLE_TIMEOUT_MS).toBeGreaterThan(IDLE_TIMEOUT_MS);
    expect(PERSISTENT_IDLE_TIMEOUT_MS).toBe(30 * DAY);
  });
});

describe('authCookieHeader — persistence', () => {
  it('sets Max-Age for a member so a webview keeps the cookie after close', async () => {
    const env = mockEnv({ active: 1, role: 'member' });
    const c = await authCookieHeader(env, 'member', 'jsmith');
    expect(c).toContain('Max-Age=' + Math.floor(PERSISTENT_IDLE_TIMEOUT_MS / 1000));
  });

  it('sets Max-Age for any role when the login/refresh came from a phone', async () => {
    const env = mockEnv({ active: 1, role: 'staff' });
    for (const r of ['admin', 'finance', 'staff', 'office']) {
      const c = await authCookieHeader(env, r, 'jdoe', true);
      expect(c).toContain('Max-Age=' + Math.floor(PERSISTENT_IDLE_TIMEOUT_MS / 1000));
    }
  });

  it('leaves a desktop/laptop session for every non-member role a cookie that dies with the browser', async () => {
    const env = mockEnv({ active: 1, role: 'staff' });
    for (const r of ['admin', 'finance', 'staff', 'office']) {
      expect(await authCookieHeader(env, r, 'jdoe')).not.toContain('Max-Age');
      expect(await authCookieHeader(env, r, 'jdoe', false)).not.toContain('Max-Age');
    }
  });

  it('keeps the existing security attributes on every path', async () => {
    const env = mockEnv({ active: 1, role: 'member' });
    for (const [r, mobile] of [['member', false], ['staff', false], ['staff', true]]) {
      const c = await authCookieHeader(env, r, 'u', mobile);
      expect(c).toContain('HttpOnly');
      expect(c).toContain('Secure');
      expect(c).toContain('SameSite=Lax');
      expect(c).toContain('Path=/');
    }
  });
});

describe('getAuthInfo — idle window by role and device', () => {
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

  it('leaves a desktop staff session at 8 hours — unchanged by this fix', async () => {
    const env = mockEnv({ active: 1, role: 'staff' });
    expect(await getAuthInfo(req(await agedCookie(env, 'staff', 'jdoe', 7 * HOUR), DESKTOP_UA), env))
      .toEqual({ role: 'staff', username: 'jdoe' });
    expect(await getAuthInfo(req(await agedCookie(env, 'staff', 'jdoe', 9 * HOUR), DESKTOP_UA), env))
      .toBeNull();
  });

  // The actual reported bug: staff on their own phone, well past 8 hours, should stay in.
  it('accepts a staff cookie well past 8 hours when the request comes from a phone', async () => {
    const env = mockEnv({ active: 1, role: 'staff' });
    const c = await agedCookie(env, 'staff', 'jdoe', 20 * DAY, true);
    expect(await getAuthInfo(req(c, IPHONE_UA), env)).toEqual({ role: 'staff', username: 'jdoe' });
  });

  it('still expires a phone staff cookie past 30 days', async () => {
    const env = mockEnv({ active: 1, role: 'admin' });
    const c = await agedCookie(env, 'admin', 'jdoe', 31 * DAY, true);
    expect(await getAuthInfo(req(c, IPHONE_UA), env)).toBeNull();
  });

  // The device signal is read from the CURRENT request, not stored on the cookie — a cookie
  // that started life on a phone doesn't get to keep the long window on a desktop browser.
  it('does not honor the long window on a desktop request, even for a cookie minted on a phone', async () => {
    const env = mockEnv({ active: 1, role: 'staff' });
    const c = await agedCookie(env, 'staff', 'jdoe', 20 * DAY, true);
    expect(await getAuthInfo(req(c, DESKTOP_UA), env)).toBeNull();
    expect(await getAuthInfo(req(c), env)).toBeNull(); // no UA at all — same as desktop
  });

  // The privilege case: the first gate reads the role the cookie was signed with, which may
  // no longer be the user's role. Authorization uses the CURRENT DB role, so the session
  // lifetime has to tighten alongside it — otherwise a promoted member would hold staff
  // permissions on a 30-day cookie.
  it('re-gates to the short window when the DB role is no longer member (desktop request)', async () => {
    const promoted = mockEnv({ active: 1, role: 'staff' });
    const c = await agedCookie(promoted, 'member', 'jsmith', 10 * DAY);
    expect(await getAuthInfo(req(c, DESKTOP_UA), promoted)).toBeNull();
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

  it('revokes a deactivated staff account immediately even on the long phone window', async () => {
    const env = mockEnv({ active: 0, role: 'staff' });
    const c = await agedCookie(env, 'staff', 'jdoe', 1 * HOUR, true);
    expect(await getAuthInfo(req(c, IPHONE_UA), env)).toBeNull();
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
