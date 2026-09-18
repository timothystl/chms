import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';

const baseEnv = { ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha' };

function liveEnv(fetchImpl) {
  return { ...baseEnv, CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

const LIVE_PROPERTY_LEDGERS = {
  contract: 'connect.finance-property-ledgers.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  propertyKey: 'ivanhoe', generatedAt: '2026-09-15T12:00:00Z',
  capital: [],
  repairs: [{
    entryDate: '2027-01-15', category: 'HVAC', description: 'Replace rooftop unit',
    amountCents: 450000, payee: 'Acme HVAC', capitalized: false,
  }],
  totals: { capitalCents: 0, repairsCents: 450000 },
};

// Answers both staff-role-v1 (so canManagePropertyRepairs resolves) and
// finance-property-ledgers-v1 (so Work orders renders live) -- the same two calls a real page
// load makes.
function roleEnv(role, writeFetchImpl) {
  return liveEnv(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role }), { status: 200 });
    if (url.pathname === '/api/contracts/finance-property-ledgers-v1') return new Response(JSON.stringify(LIVE_PROPERTY_LEDGERS), { status: 200 });
    return writeFetchImpl(req);
  });
}

function postForm(env, { accessJwt, body } = {}) {
  const params = new URLSearchParams({
    entry_date: '2027-01-15', category: 'HVAC', description: 'Replace rooftop unit', amount: '4500', payee: 'Acme HVAC',
    ...body,
  });
  return worker.fetch(new Request('https://finance.test/api/v1/connect-property-repair-write', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(accessJwt !== undefined ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {}),
    },
    body: params.toString(),
  }), env);
}

describe('Commercial Property — repair entry form and relay route', () => {
  it('rejects the wrong method on the write-only route with an Allow header naming only POST', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-property-repair-write'), baseEnv);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('does not show the entry form when the viewer role is not verified', async () => {
    const res = await worker.fetch(new Request('https://finance.test/?section=property&page=work-orders'), baseEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-property-repair-write');
  });

  it('does not show the entry form for a finance-role viewer -- admin-only, matching the legacy route', async () => {
    const env = roleEnv('finance', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=property&page=work-orders', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-property-repair-write');
  });

  it('shows the entry form for a verified admin viewer', async () => {
    const env = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=property&page=work-orders', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).toContain('<form method="POST" action="/api/v1/connect-property-repair-write">');
    expect(html).toContain('name="category"');
    expect(html).toContain('name="amount"');
  });

  it('redirects to a not_configured error when the service binding and shared secret are not set', async () => {
    const res = await postForm(baseEnv, { accessJwt: 'whatever' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.pathname).toBe('/');
    expect(location.searchParams.get('section')).toBe('property');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('not_configured');
  });

  it('redirects to a no_access_identity error when the incoming request carries no Access assertion', async () => {
    const res = await postForm(liveEnv(async () => new Response('{}')), { accessJwt: undefined });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('no_access_identity');
  });

  it('forwards the Access assertion and form fields, and redirects to status=ok on success', async () => {
    let captured;
    const env = liveEnv(async (req) => {
      captured = req;
      return new Response(JSON.stringify({ ok: true, id: 7, savedBy: 'andrew' }), { status: 200 });
    });
    const res = await postForm(env, { accessJwt: 'signed.jwt.here', body: { capitalized: 'on' } });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('section')).toBe('property');
    expect(location.searchParams.get('page')).toBe('work-orders');
    expect(location.searchParams.get('status')).toBe('ok');

    expect(captured.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
    expect(captured.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(captured.url);
    expect(url.pathname).toBe('/api/contracts/finance-property-repair-write-v1');
    const sentBody = JSON.parse(await captured.text());
    expect(sentBody).toEqual({
      entry_date: '2027-01-15', category: 'HVAC', description: 'Replace rooftop unit',
      amount: '4500', payee: 'Acme HVAC', capitalized: true,
    });

    const shownEnv = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const shown = await worker.fetch(new Request(location.toString(), { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), shownEnv);
    const html = await shown.text();
    expect(html).toContain('Saved in Connect.');
  });

  it('sends capitalized: false when the checkbox is not checked', async () => {
    let captured;
    const env = liveEnv(async (req) => { captured = req; return new Response(JSON.stringify({ ok: true }), { status: 200 }); });
    await postForm(env, { accessJwt: 'signed.jwt.here' });
    const sentBody = JSON.parse(await captured.text());
    expect(sentBody.capitalized).toBe(false);
  });

  it('redirects with the refusal reason when Connect declines the entry, and shows it back on the page', async () => {
    const env = liveEnv(async () => new Response(JSON.stringify({ error: 'Access denied: editing property financials requires admin access' }), { status: 403 }));
    const res = await postForm(env, { accessJwt: 'signed.jwt.here' });
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('http_error');
    expect(location.searchParams.get('message')).toBe('Access denied: editing property financials requires admin access');

    const shownEnv = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const shown = await worker.fetch(new Request(location.toString(), { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), shownEnv);
    const html = await shown.text();
    expect(html).toContain('Not saved: Access denied: editing property financials requires admin access');
  });

  it('redirects with a network_error reason when the relay call itself fails, never throwing', async () => {
    const env = liveEnv(async () => { throw new Error('boom'); });
    const res = await postForm(env, { accessJwt: 'signed.jwt.here' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('network_error');
  });
});
