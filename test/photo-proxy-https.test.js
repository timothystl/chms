import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../tlc-volunteer-worker.js';
import { authCookieHeader } from '../src/auth.js';

// SEC21(d): /admin/photo-proxy checked the hostname but not the scheme, despite its own
// comment saying "Only proxy HTTPS URLs" — an http:// (or other-scheme) URL to a
// breezechms.com-shaped hostname was proxied anyway. Fixed by checking parsed.protocol
// before the hostname allowlist.

const SECRETS = { ADMIN_PASSWORD: 'test-signing-secret' };

function envFor(role) {
  const row = { active: 1, role };
  const stmt = { bind: () => stmt, first: async () => row, all: async () => ({ results: [] }), run: async () => ({ meta: {} }) };
  return {
    ...SECRETS,
    DB: { prepare: () => stmt, batch: async () => [] },
    RSVP_STORE: { get: async () => null, put: async () => {}, delete: async () => {} },
  };
}

async function cookieFor(role) {
  return (await authCookieHeader(envFor(role), role, 'someone')).split(';')[0];
}

let outbound = [];
let realFetch;
beforeEach(() => {
  outbound = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    outbound.push(String(u && u.url ? u.url : u));
    return new Response('fake-image-bytes', { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

async function callPhotoProxy(photoUrl) {
  const env = envFor('staff');
  const req = new Request('https://connect.timothystl.org/admin/photo-proxy?url=' + encodeURIComponent(photoUrl), {
    headers: { cookie: await cookieFor('staff') },
  });
  return worker.fetch(req, env);
}

describe('GET /admin/photo-proxy — scheme enforcement', () => {
  it('403s a plain-http Breeze-shaped URL instead of proxying it', async () => {
    const r = await callPhotoProxy('http://timothystl.breezechms.com/photo.jpg');
    expect(r.status).toBe(403);
    expect(outbound.length).toBe(0);
  });

  it('403s a non-Breeze https URL (existing hostname allowlist still applies)', async () => {
    const r = await callPhotoProxy('https://evil.example.com/photo.jpg');
    expect(r.status).toBe(403);
    expect(outbound.length).toBe(0);
  });

  it('still proxies a real https Breeze photo URL', async () => {
    const r = await callPhotoProxy('https://timothystl.breezechms.com/photo.jpg');
    expect(r.status).toBe(200);
    expect(outbound.length).toBeGreaterThan(0);
  });
});
