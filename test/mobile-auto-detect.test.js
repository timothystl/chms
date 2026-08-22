import { describe, it, expect } from 'vitest';
import worker from '../tlc-volunteer-worker.js';
import { authCookieHeader } from '../src/auth.js';

// The phone-optimized experience is auto-served at the app's normal URL — no separate
// /admin or /mobile route — decided by wantsMobileShell() in tlc-volunteer-worker.js off
// the request's User-Agent, a `mob_pref=desktop` opt-out cookie, and role. These tests
// drive the real worker.fetch() end to end (same pattern as scheduler-route-authz.test.js)
// so a regression shows up as the wrong shell actually being served, not a unit test of
// an isolated helper that could drift from what the route wiring really does.

const SECRETS = { ADMIN_PASSWORD: 'test-signing-secret' };
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function envForRole(role) {
  const row = role ? { active: 1, role } : null;
  const stmt = { bind: () => stmt, first: async () => row, all: async () => ({ results: [] }), run: async () => ({ meta: {} }) };
  return { ...SECRETS, DB: { prepare: () => stmt, batch: async () => [] } };
}

async function cookieFor(role) {
  return (await authCookieHeader(envForRole(role), role, 'someone')).split(';')[0];
}

async function call(path, { role, ua = IPHONE_UA, extraCookie = '' } = {}) {
  const env = envForRole(role);
  const headers = {};
  if (ua) headers['User-Agent'] = ua;
  let cookie = role ? await cookieFor(role) : '';
  if (extraCookie) cookie = cookie ? cookie + '; ' + extraCookie : extraCookie;
  if (cookie) headers.cookie = cookie;
  return worker.fetch(new Request('https://connect.timothystl.org' + path, { headers }), env);
}

const MOBILE_TITLE = '<title>Connect — Mobile Admin</title>';
const DESKTOP_TITLE = '<title>Connect</title>';

describe('mobile auto-detect at the root URL', () => {
  it('serves the mobile shell to a phone User-Agent, staff role', async () => {
    const r = await call('/', { role: 'staff', ua: IPHONE_UA });
    const body = await r.text();
    expect(body).toContain(MOBILE_TITLE);
  });

  it('serves the desktop shell to a non-phone User-Agent, staff role', async () => {
    const r = await call('/', { role: 'staff', ua: DESKTOP_UA });
    const body = await r.text();
    expect(body).toContain(DESKTOP_TITLE);
    expect(body).not.toContain(MOBILE_TITLE);
  });

  it('serves the mobile shell to a member session on a phone (member is included)', async () => {
    const r = await call('/', { role: 'member', ua: IPHONE_UA });
    const body = await r.text();
    expect(body).toContain(MOBILE_TITLE);
  });

  it('serves the desktop shell to a volunteer session on a phone (its own separate tool)', async () => {
    const r = await call('/', { role: 'volunteer', ua: IPHONE_UA });
    const body = await r.text();
    expect(body).toContain(DESKTOP_TITLE);
  });

  it('?desktop=1 serves the desktop shell and plants the opt-out cookie', async () => {
    const r = await call('/?desktop=1', { role: 'staff', ua: IPHONE_UA });
    const body = await r.text();
    expect(body).toContain(DESKTOP_TITLE);
    expect(r.headers.get('Set-Cookie') || '').toContain('mob_pref=desktop');
  });

  it('a stored mob_pref=desktop cookie keeps serving the desktop shell on later visits (no bounce-back loop)', async () => {
    const r = await call('/', { role: 'staff', ua: IPHONE_UA, extraCookie: 'mob_pref=desktop' });
    const body = await r.text();
    expect(body).toContain(DESKTOP_TITLE);
  });

  it('the same behavior holds on the /chms alias path', async () => {
    const mobile = await call('/chms', { role: 'staff', ua: IPHONE_UA });
    expect(await mobile.text()).toContain(MOBILE_TITLE);
    const desktop = await call('/chms', { role: 'staff', ua: DESKTOP_UA });
    expect(await desktop.text()).toContain(DESKTOP_TITLE);
  });
});
