import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';

const baseEnv = { ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha' };

function liveEnv(fetchImpl) {
  return { ...baseEnv, CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

function postEntry(env, { accessJwt, body } = {}) {
  const params = new URLSearchParams({
    date: '2026-01-15', fund_id: '9', amount: '50.00', method: 'check', check_number: '', person_id: '', notes: '',
    ...body,
  });
  return worker.fetch(new Request('https://finance.test/api/v1/connect-giving-quick-entry', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(accessJwt !== undefined ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {}),
    },
    body: params.toString(),
  }), env);
}

describe('Finance Giving Entry — form and relay route', () => {
  it('renders the entry form on the Giving Entry section, listing funds from the resolved giving summary', async () => {
    const res = await worker.fetch(new Request('https://finance.test/?section=giving'), baseEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<form method="POST" action="/api/v1/connect-giving-quick-entry">');
    expect(html).toContain('name="fund_id"');
    expect(html).toContain('name="amount"');
    expect(html).toContain('name="date"');
    // Falls back to the committed synthetic fixture's funds when live isn't configured (same as Health).
    expect(html).not.toContain('No funds available');
  });

  it('rejects the wrong method on the write-only route with an Allow header naming only POST', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-giving-quick-entry'), baseEnv);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('still rejects writes to every other route -- only the one declared path accepts POST', async () => {
    const res = await worker.fetch(new Request('https://finance.test/', { method: 'POST' }), baseEnv);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
  });

  it('relaxes the CSP only to allow this one same-origin form to submit, changing nothing else', async () => {
    const res = await worker.fetch(new Request('https://finance.test/'), baseEnv);
    const csp = res.headers.get('content-security-policy');
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('script-src');
  });

  it('redirects to a not_configured error when the service binding and shared secret are not set', async () => {
    const res = await postEntry(baseEnv, { accessJwt: 'whatever' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.pathname).toBe('/');
    expect(location.searchParams.get('section')).toBe('giving');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('not_configured');
  });

  it('redirects to a no_access_identity error when the incoming request carries no Access assertion', async () => {
    const res = await postEntry(liveEnv(async () => new Response('{}')), { accessJwt: undefined });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('no_access_identity');
  });

  it('forwards the Access assertion and form fields, and redirects to status=ok on success', async () => {
    let captured;
    const env = liveEnv(async (req) => {
      captured = req;
      return new Response(JSON.stringify({ id: 42, batch_id: 7, enteredBy: 'sarah' }), { status: 200 });
    });
    const res = await postEntry(env, { accessJwt: 'signed.jwt.here', body: { fund_id: '9', amount: '75.00' } });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('status')).toBe('ok');

    expect(captured.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
    expect(captured.headers.get('X-Contract-Key')).toBe('test-secret');
    const sentBody = JSON.parse(await captured.text());
    expect(sentBody).toMatchObject({ date: '2026-01-15', fund_id: '9', amount: '75.00', method: 'check' });

    const shown = await worker.fetch(new Request('https://finance.test/?section=giving&status=ok'), baseEnv);
    const html = await shown.text();
    expect(html).toContain('Recorded in Connect.');
  });

  it('redirects with the refusal reason when Connect declines the entry, and shows it back on the page', async () => {
    const env = liveEnv(async () => new Response(JSON.stringify({ error: 'Access denied' }), { status: 403 }));
    const res = await postEntry(env, { accessJwt: 'signed.jwt.here' });
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('http_error');
    expect(location.searchParams.get('message')).toBe('Access denied');

    const shown = await worker.fetch(new Request(location.toString()), baseEnv);
    const html = await shown.text();
    expect(html).toContain('Not recorded: Access denied');
  });

  it('redirects with a network_error reason when the relay call itself fails, never throwing', async () => {
    const env = liveEnv(async () => { throw new Error('boom'); });
    const res = await postEntry(env, { accessJwt: 'signed.jwt.here' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('network_error');
  });
});
