import { describe, it, expect } from 'vitest';
import worker from '../tlc-volunteer-worker.js';
import { authCookieHeader } from '../src/auth.js';
import { DEPLOY_VERSION } from '../src/frontend/js-core.js';

// Review finding (SEC21(e) / P22-F(e)): every versioned asset response
// (`Cache-Control: public, max-age=31536000, immutable`) was still wrapped by
// refreshAuthCookie, which appends a Set-Cookie on any authenticated request — riding a
// session cookie on a response any intermediate cache is invited to store, and incidentally
// defeating Cloudflare's own edge cache (it declines to cache a response carrying Set-Cookie).
//
// Fixed: refreshAuthCookie now skips wrapping a public+immutable response outright.

const ASSETS = ['/admin/app-member.js', '/admin/app-staff.js', '/admin/app-ext.js', '/admin/app.css'];

function envForRole(role) {
  const row = { active: 1, role };
  const stmt = { bind: () => stmt, first: async () => row, all: async () => ({ results: [] }), run: async () => ({ meta: {} }) };
  return {
    ADMIN_PASSWORD: 'test-signing-secret',
    DB: { prepare: () => stmt, batch: async () => [] },
  };
}

async function cookieFor(role) {
  return (await authCookieHeader(envForRole(role), role, 'someone')).split(';')[0];
}

describe('versioned immutable assets never carry a refreshed Set-Cookie', () => {
  it('answers an authenticated request with Cache-Control: immutable and no Set-Cookie', async () => {
    for (const p of ASSETS) {
      const env = envForRole('staff');
      const req = new Request('https://connect.timothystl.org' + p + '?v=' + DEPLOY_VERSION, {
        headers: { cookie: await cookieFor('staff') },
      });
      const r = await worker.fetch(req, env);
      expect(r.status, p).toBe(200);
      expect(r.headers.get('Cache-Control'), p).toMatch(/immutable/);
      expect(r.headers.get('Set-Cookie'), p).toBeNull();
    }
  });
});
