import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleSchedBreezeProxy } from '../src/api-scheduler.js';

// Review finding (SEC21(c) / P22-F(c)): handleSchedBreezeProxy falls back to a caller-supplied
// X-Breeze-Subdomain header (a CORS-allowlisted request) and interpolated it straight into the
// upstream hostname with no validation. Inert while BREEZE_SUBDOMAIN is set (env always wins),
// but a latent SSRF that would carry BREEZE_API_KEY to an attacker-chosen host the moment that
// env var is ever unset. Fixed with a /^[a-z0-9-]+$/ check before it's used.

let outbound = [];
let realFetch;
beforeEach(() => {
  outbound = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    outbound.push(String(u));
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

function req(headers) {
  return new Request('https://connect.timothystl.org/api/people', { headers });
}

describe('handleSchedBreezeProxy: X-Breeze-Subdomain fallback is validated', () => {
  it('refuses a malicious subdomain header and never calls fetch', async () => {
    const env = { BREEZE_API_KEY: 'SECRET-KEY' }; // no BREEZE_SUBDOMAIN — header fallback is live
    const url = new URL('https://connect.timothystl.org/api/people');
    const r = await handleSchedBreezeProxy(
      req({ 'X-Breeze-Subdomain': 'evil.attacker.com/x', 'X-Breeze-Api-Key': 'k' }),
      env,
      url
    );
    expect(r.status).toBe(400);
    expect(outbound.length).toBe(0);
  });

  it('still proxies a legitimate alphanumeric-hyphen subdomain', async () => {
    const env = { BREEZE_API_KEY: 'SECRET-KEY' };
    const url = new URL('https://connect.timothystl.org/api/people');
    const r = await handleSchedBreezeProxy(
      req({ 'X-Breeze-Subdomain': 'timothystl', 'X-Breeze-Api-Key': 'k' }),
      env,
      url
    );
    expect(r.status).toBe(200);
    expect(outbound.length).toBe(1);
    expect(outbound[0]).toMatch(/^https:\/\/timothystl\.breezechms\.com\//);
  });
});
