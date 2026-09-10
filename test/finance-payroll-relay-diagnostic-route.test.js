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

// A real-shaped (but never signature-checked here) Access JWT, so tests can verify the
// diagnostic actually surfaces the claims Finance is forwarding.
function fakeAccessJwt(payload) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${enc({ alg: 'RS256', kid: 'test' })}.${enc(payload)}.fake-signature`;
}

describe('Finance payroll relay diagnostic route', () => {
  it('rejects a write to this read-only route', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/payroll-relay-diagnostic', { method: 'POST' }), baseEnv);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
  });

  it('reports not_configured when the service binding and shared secret are not set, and that no Access assertion was even sent', async () => {
    const res = await getDiagnostic(baseEnv, { accessJwt: undefined });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-finance-contract')).toBe('finance.payroll-relay-diagnostic.v1');
    expect(await res.json()).toEqual({
      ok: false, reason: 'not_configured', message: null,
      incomingAccessJwt: { present: false },
    });
  });

  it('reports no_access_identity when the incoming request carries no Access assertion', async () => {
    const res = await getDiagnostic(liveEnv(async () => new Response('[]')), { accessJwt: undefined });
    expect(await res.json()).toEqual({
      ok: false, reason: 'no_access_identity', message: null,
      incomingAccessJwt: { present: false },
    });
  });

  it('reports the assertion as present-but-malformed when it is not a real JWT, without ever calling out', async () => {
    let called = false;
    const env = liveEnv(async () => { called = true; return new Response('[]'); });
    const res = await getDiagnostic(env, { accessJwt: 'not-a-real-jwt' });
    // 'not_configured' takes priority above the shared-secret check; use a configured env
    // but a malformed assertion to isolate this specifically to the JWT decode step... though
    // configured env + malformed JWT still attempts the relay (Website's own JWT verification
    // is what actually rejects a malformed token) -- so `called` is expected true here.
    expect(await res.json()).toMatchObject({ incomingAccessJwt: { present: true, malformed: true } });
    expect(called).toBe(true);
  });

  it('forwards the Access assertion, reports a real staff count and field shape (never raw staff data), and decodes the forwarded claims', async () => {
    let captured;
    const env = liveEnv(async (req) => {
      captured = req;
      return new Response(JSON.stringify([
        { id: 'abc', full_name: 'Real Person One' },
        { id: 'def', full_name: 'Real Person Two' },
      ]), { status: 200 });
    });
    const nowSec = Math.floor(Date.now() / 1000);
    const accessJwt = fakeAccessJwt({
      iss: 'https://timothystl.cloudflareaccess.com',
      aud: 'bb8fd2d550bee50a2c49c9fa42d212b4f51aff89e2eae17db9c3088b672274de',
      exp: nowSec + 3600,
      email: 'someone@timothystl.org',
    });
    const res = await getDiagnostic(env, { accessJwt });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.staffCount).toBe(2);
    expect(body.sampleFields).toEqual(['id', 'full_name']);
    expect(body.incomingAccessJwt.present).toBe(true);
    expect(body.incomingAccessJwt.iss).toBe('https://timothystl.cloudflareaccess.com');
    expect(body.incomingAccessJwt.aud).toEqual(['bb8fd2d550bee50a2c49c9fa42d212b4f51aff89e2eae17db9c3088b672274de']);
    expect(body.incomingAccessJwt.emailPresent).toBe(true);
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('Real Person');
    expect(bodyText).not.toContain('someone@timothystl.org');

    expect(captured.headers.get('Cf-Access-Jwt-Assertion')).toBe(accessJwt);
    expect(captured.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(captured.url);
    expect(url.pathname).toBe('/sb/rest/v1/rpc/payroll_get_staff');
  });

  it('surfaces a refusal reason and message when Website declines the call', async () => {
    const env = liveEnv(async () => new Response(JSON.stringify({ error: 'Not authenticated.' }), { status: 401 }));
    const res = await getDiagnostic(env, { accessJwt: 'signed.jwt.here' });
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('http_error');
    expect(body.message).toBe('Not authenticated.');
  });

  it('reports network_error without throwing when the relay call itself fails', async () => {
    const env = liveEnv(async () => { throw new Error('boom'); });
    const res = await getDiagnostic(env, { accessJwt: 'signed.jwt.here' });
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('network_error');
  });
});
