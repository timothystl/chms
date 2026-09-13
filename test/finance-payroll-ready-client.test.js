import { describe, it, expect } from 'vitest';
import { postPayrollReadyNotification } from '../apps/finance/payroll-ready-client.js';

const PERIOD = { periodStart: '2026-01-01', periodLabel: 'Period 2026-01-01' };

function envWith(fetchImpl) {
  return { PAYROLL_SERVICE: { fetch: fetchImpl }, FINANCE_PAYROLL_CONTRACT_KEY: 'test-secret' };
}

describe('postPayrollReadyNotification', () => {
  it('is not_configured when the service binding or shared secret is missing', async () => {
    expect(await postPayrollReadyNotification({ FINANCE_PAYROLL_CONTRACT_KEY: 'x' }, 'jwt', PERIOD))
      .toEqual({ ok: false, reason: 'not_configured' });
    expect(await postPayrollReadyNotification({ PAYROLL_SERVICE: { fetch: async () => new Response('{}') } }, 'jwt', PERIOD))
      .toEqual({ ok: false, reason: 'not_configured' });
  });

  it('is no_access_identity when there is no Access JWT to forward, without ever calling out', async () => {
    let called = false;
    const env = envWith(async () => { called = true; return new Response('{}'); });
    const result = await postPayrollReadyNotification(env, '', PERIOD);
    expect(result).toEqual({ ok: false, reason: 'no_access_identity' });
    expect(called).toBe(false);
  });

  it('POSTs the period with the shared secret and the forwarded Access JWT, and accepts a valid response', async () => {
    let capturedRequest;
    let capturedBody;
    const env = envWith(async (req) => {
      capturedRequest = req;
      capturedBody = JSON.parse(await req.text());
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });
    const result = await postPayrollReadyNotification(env, 'signed.jwt.here', PERIOD);
    expect(result).toEqual({ ok: true });
    expect(capturedRequest.method).toBe('POST');
    expect(capturedRequest.headers.get('X-Contract-Key')).toBe('test-secret');
    expect(capturedRequest.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
    const url = new URL(capturedRequest.url);
    expect(url.pathname).toBe('/api/push/payroll-ready');
    expect(capturedBody).toEqual(PERIOD);
  });

  it('fails closed, not throws, on a network error', async () => {
    const env = envWith(async () => { throw new Error('boom'); });
    const result = await postPayrollReadyNotification(env, 'signed.jwt.here', PERIOD);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('network_error');
  });

  it("surfaces Website's own refusal message on a non-200 response, rather than a bare status", async () => {
    const env = envWith(async () => new Response(JSON.stringify({ error: 'Access denied.' }), { status: 403 }));
    const result = await postPayrollReadyNotification(env, 'signed.jwt.here', PERIOD);
    expect(result).toEqual({ ok: false, reason: 'http_error', status: 403, message: 'Access denied.' });
  });

  it('fails closed on malformed JSON instead of assuming success or failure', async () => {
    const env = envWith(async () => new Response('not json', { status: 200 }));
    const result = await postPayrollReadyNotification(env, 'signed.jwt.here', PERIOD);
    expect(result).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('a second call for an already-notified period still resolves ok (Website dedupes, this never treats it as an error)', async () => {
    const env = envWith(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    const result = await postPayrollReadyNotification(env, 'signed.jwt.here', PERIOD);
    expect(result).toEqual({ ok: true });
  });
});
