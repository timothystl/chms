import { describe, it, expect } from 'vitest';
import { fetchVerifiedRole, roleCanAccessSection, NO_FINANCE_ACCESS_ROLES } from '../apps/finance/connect-role-client.js';

function envWith(fetchImpl) {
  return { CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

describe('fetchVerifiedRole', () => {
  it('is not_configured when the service binding is missing', async () => {
    const result = await fetchVerifiedRole({ FINANCE_CONTRACT_API_KEY: 'x' }, 'jwt');
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('is not_configured when the shared secret is missing', async () => {
    const result = await fetchVerifiedRole({ CONNECT_SERVICE: { fetch: async () => new Response('{}') } }, 'jwt');
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('is no_access_identity when there is no Access JWT to forward, without ever calling out', async () => {
    let called = false;
    const env = envWith(async () => { called = true; return new Response('{}'); });
    const result = await fetchVerifiedRole(env, '');
    expect(result).toEqual({ ok: false, reason: 'no_access_identity' });
    expect(called).toBe(false);
  });

  it('sends the shared secret and forwarded Access JWT, and accepts a valid response', async () => {
    let capturedRequest;
    const env = envWith(async (req) => {
      capturedRequest = req;
      return new Response(JSON.stringify({ role: 'compensation' }), { status: 200 });
    });
    const result = await fetchVerifiedRole(env, 'signed.jwt.here');
    expect(result).toEqual({ ok: true, role: 'compensation' });
    expect(capturedRequest.headers.get('X-Contract-Key')).toBe('test-secret');
    expect(capturedRequest.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
    const url = new URL(capturedRequest.url);
    expect(url.pathname).toBe('/api/contracts/staff-role-v1');
  });

  it('fails closed, not throws, on a network error', async () => {
    const env = envWith(async () => { throw new Error('boom'); });
    const result = await fetchVerifiedRole(env, 'signed.jwt.here');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('network_error');
  });

  it('fails closed on a non-200 response (e.g. no matching/active Connect account)', async () => {
    const env = envWith(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 403 }));
    const result = await fetchVerifiedRole(env, 'signed.jwt.here');
    expect(result).toEqual({ ok: false, reason: 'http_error', status: 403 });
  });

  it('fails closed on malformed JSON instead of assuming success or failure', async () => {
    const env = envWith(async () => new Response('not json', { status: 200 }));
    const result = await fetchVerifiedRole(env, 'signed.jwt.here');
    expect(result).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('fails closed on a well-formed but empty/missing role, rather than trusting the wire blindly', async () => {
    const env = envWith(async () => new Response(JSON.stringify({}), { status: 200 }));
    const result = await fetchVerifiedRole(env, 'signed.jwt.here');
    expect(result).toEqual({ ok: false, reason: 'invalid_role' });
    const env2 = envWith(async () => new Response(JSON.stringify({ role: '' }), { status: 200 }));
    expect(await fetchVerifiedRole(env2, 'signed.jwt.here')).toEqual({ ok: false, reason: 'invalid_role' });
  });
});

describe('roleCanAccessSection', () => {
  const compensationSection = { id: 'compensation', permission: 'compensation' };
  const financeSection = { id: 'church', permission: 'finance' };
  const payrollSection = { id: 'payroll', permission: 'admin' };

  it('denies member and volunteer everything, whatever the section', () => {
    for (const role of NO_FINANCE_ACCESS_ROLES) {
      expect(roleCanAccessSection(role, compensationSection)).toBe(false);
      expect(roleCanAccessSection(role, financeSection)).toBe(false);
      expect(roleCanAccessSection(role, payrollSection)).toBe(false);
    }
  });

  it('restricts compensation to only the compensation-tagged section', () => {
    expect(roleCanAccessSection('compensation', compensationSection)).toBe(true);
    expect(roleCanAccessSection('compensation', financeSection)).toBe(false);
    expect(roleCanAccessSection('compensation', payrollSection)).toBe(false);
  });

  it('leaves every other known role unrestricted by this pass (admin/finance/staff/council)', () => {
    for (const role of ['admin', 'finance', 'staff', 'council']) {
      expect(roleCanAccessSection(role, compensationSection)).toBe(true);
      expect(roleCanAccessSection(role, financeSection)).toBe(true);
      expect(roleCanAccessSection(role, payrollSection)).toBe(true);
    }
  });
});
