import { describe, it, expect } from 'vitest';
import { callPayrollProxy } from '../apps/finance/payroll-proxy-client.js';
import { PAYROLL_RPC_FNS } from '../apps/finance/payroll-rpc-fns.js';

function envWith(fetchImpl) {
  return { PAYROLL_SERVICE: { fetch: fetchImpl }, FINANCE_PAYROLL_CONTRACT_KEY: 'test-secret' };
}

describe('callPayrollProxy', () => {
  it('is not_configured when the service binding or shared secret is missing', async () => {
    expect(await callPayrollProxy({ FINANCE_PAYROLL_CONTRACT_KEY: 'x' }, 'jwt', 'payroll_get_staff', {}))
      .toEqual({ ok: false, reason: 'not_configured' });
    expect(await callPayrollProxy({ PAYROLL_SERVICE: { fetch: async () => new Response('{}') } }, 'jwt', 'payroll_get_staff', {}))
      .toEqual({ ok: false, reason: 'not_configured' });
  });

  it('is no_access_identity when there is no Access JWT to forward, without ever calling out', async () => {
    let called = false;
    const env = envWith(async () => { called = true; return new Response('[]'); });
    const result = await callPayrollProxy(env, '', 'payroll_get_staff', {});
    expect(result).toEqual({ ok: false, reason: 'no_access_identity' });
    expect(called).toBe(false);
  });

  it('rejects a function name outside the allowlist, without ever calling out', async () => {
    let called = false;
    const env = envWith(async () => { called = true; return new Response('[]'); });
    const result = await callPayrollProxy(env, 'signed.jwt.here', 'payroll_drop_all_tables', {});
    expect(result).toEqual({ ok: false, reason: 'unknown_function' });
    expect(called).toBe(false);
  });

  it('accepts every real function name in the mirrored allowlist', () => {
    expect(PAYROLL_RPC_FNS).toContain('payroll_get_staff');
    expect(PAYROLL_RPC_FNS).toContain('payroll_save_hours');
    expect(PAYROLL_RPC_FNS).toContain('payroll_approve_period');
    expect(PAYROLL_RPC_FNS.length).toBe(17);
  });

  it('POSTs to the right RPC path with the shared secret, the forwarded JWT, and the Supabase anon headers', async () => {
    let capturedRequest;
    const env = envWith(async (req) => {
      capturedRequest = req;
      return new Response(JSON.stringify([{ id: 'abc', name: 'Sarah' }]), { status: 200 });
    });
    const result = await callPayrollProxy(env, 'signed.jwt.here', 'payroll_get_staff', {});
    expect(result.ok).toBe(true);
    expect(result.result).toEqual([{ id: 'abc', name: 'Sarah' }]);
    expect(capturedRequest.method).toBe('POST');
    expect(capturedRequest.headers.get('X-Contract-Key')).toBe('test-secret');
    expect(capturedRequest.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
    expect(capturedRequest.headers.get('apikey')).toBeTruthy();
    expect(capturedRequest.headers.get('Authorization')).toBe(`Bearer ${capturedRequest.headers.get('apikey')}`);
    const url = new URL(capturedRequest.url);
    expect(url.pathname).toBe('/sb/rest/v1/rpc/payroll_get_staff');
  });

  it('sends the given params as the JSON body, never adding p_secret itself', async () => {
    let capturedBody;
    const env = envWith(async (req) => {
      capturedBody = JSON.parse(await req.text());
      return new Response('{}', { status: 200 });
    });
    await callPayrollProxy(env, 'signed.jwt.here', 'payroll_save_hours', { p_staff_id: '1', p_period_start: '2026-01-01', p_hours_worked: 40 });
    expect(capturedBody).toEqual({ p_staff_id: '1', p_period_start: '2026-01-01', p_hours_worked: 40 });
    expect(capturedBody.p_secret).toBeUndefined();
  });

  it('fails closed, not throws, on a network error', async () => {
    const env = envWith(async () => { throw new Error('boom'); });
    const result = await callPayrollProxy(env, 'signed.jwt.here', 'payroll_get_staff', {});
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('network_error');
  });

  it("surfaces Website's own refusal message on a non-200 response, rather than a bare status", async () => {
    const env = envWith(async () => new Response(JSON.stringify({ error: 'Not authenticated.', code: 'UNAUTHENTICATED' }), { status: 401 }));
    const result = await callPayrollProxy(env, 'signed.jwt.here', 'payroll_get_staff', {});
    expect(result).toEqual({ ok: false, reason: 'http_error', status: 401, message: 'Not authenticated.' });
  });

  it('surfaces the period-lock message (409) the same way as any other refusal', async () => {
    const env = envWith(async () => new Response(JSON.stringify({ message: 'This period is approved and locked.' }), { status: 409 }));
    const result = await callPayrollProxy(env, 'signed.jwt.here', 'payroll_save_hours', { p_period_start: '2026-01-01' });
    expect(result).toEqual({ ok: false, reason: 'http_error', status: 409, message: 'This period is approved and locked.' });
  });

  it('fails closed on malformed JSON instead of assuming success or failure, keeping a preview of the real body', async () => {
    const env = envWith(async () => new Response('not json', { status: 200 }));
    const result = await callPayrollProxy(env, 'signed.jwt.here', 'payroll_get_staff', {});
    expect(result).toEqual({ ok: false, reason: 'invalid_json', status: 200, bodyPreview: 'not json' });
  });

  it('truncates a long non-JSON body to a short preview', async () => {
    const env = envWith(async () => new Response('x'.repeat(500), { status: 502 }));
    const result = await callPayrollProxy(env, 'signed.jwt.here', 'payroll_get_staff', {});
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_json');
    expect(result.status).toBe(502);
    expect(result.bodyPreview).toHaveLength(200);
  });
});
