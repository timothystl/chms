import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';

const baseEnv = { ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha' };

function liveEnv(fetchImpl) {
  return { ...baseEnv, PAYROLL_SERVICE: { fetch: fetchImpl }, FINANCE_PAYROLL_CONTRACT_KEY: 'test-secret' };
}

function getDiagnostic(env, { accessJwt } = {}) {
  return worker.fetch(new Request('https://finance.test/api/v1/payroll-relay-diagnostic', {
    headers: accessJwt !== undefined ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {},
  }), env);
}

describe('Finance payroll relay diagnostic route', () => {
  it('rejects a write to this read-only route', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/payroll-relay-diagnostic', { method: 'POST' }), baseEnv);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
  });

  it('reports not_configured when the service binding and shared secret are not set', async () => {
    const res = await getDiagnostic(baseEnv, { accessJwt: 'whatever' });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-finance-contract')).toBe('finance.payroll-relay-diagnostic.v1');
    expect(await res.json()).toEqual({ ok: false, reason: 'not_configured', message: null });
  });

  it('reports no_access_identity when the incoming request carries no Access assertion', async () => {
    const res = await getDiagnostic(liveEnv(async () => new Response('[]')), { accessJwt: undefined });
    expect(await res.json()).toEqual({ ok: false, reason: 'no_access_identity', message: null });
  });

  it('forwards the Access assertion and reports a real staff count and field shape, never raw staff data', async () => {
    let captured;
    const env = liveEnv(async (req) => {
      captured = req;
      return new Response(JSON.stringify([
        { id: 'abc', full_name: 'Real Person One' },
        { id: 'def', full_name: 'Real Person Two' },
      ]), { status: 200 });
    });
    const res = await getDiagnostic(env, { accessJwt: 'signed.jwt.here' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, staffCount: 2, sampleFields: ['id', 'full_name'] });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('Real Person');

    expect(captured.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
    expect(captured.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(captured.url);
    expect(url.pathname).toBe('/sb/rest/v1/rpc/payroll_get_staff');
  });

  it('surfaces a refusal reason and message when Website declines the call', async () => {
    const env = liveEnv(async () => new Response(JSON.stringify({ error: 'Not authenticated.' }), { status: 401 }));
    const res = await getDiagnostic(env, { accessJwt: 'signed.jwt.here' });
    expect(await res.json()).toEqual({ ok: false, reason: 'http_error', message: 'Not authenticated.' });
  });

  it('reports network_error without throwing when the relay call itself fails', async () => {
    const env = liveEnv(async () => { throw new Error('boom'); });
    const res = await getDiagnostic(env, { accessJwt: 'signed.jwt.here' });
    expect(await res.json()).toEqual({ ok: false, reason: 'network_error', message: null });
  });
});
