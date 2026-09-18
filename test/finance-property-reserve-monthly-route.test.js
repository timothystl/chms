import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';

const baseEnv = { ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha' };

function liveEnv(fetchImpl) {
  return { ...baseEnv, CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

const LIVE_PROPERTY_RESERVES = {
  contract: 'connect.finance-property-reserves.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  propertyKey: 'ivanhoe', generatedAt: '2026-09-15T12:00:00Z',
  reserves: [{
    reserveKey: 'property_tax', reportMonth: '2027-01', taxYear: 2027, targetEstimateCents: 1140000,
    reserveBeforeCents: 0, contributionCents: 95000, reserveAfterCents: 95000, fundedPct: 8.333333333333332, note: '',
  }],
  reserveDisbursements: [],
  distributions: [{ period: '2027-01', amountCents: 500000 }],
};

// Answers both staff-role-v1 (so canManagePropertyLedgers resolves) and finance-property-reserves-v1
// (so Reserve & distribution renders live, the same two calls a real page load makes -- otherwise
// the page falls back to a synthetic read that needs a FINANCE_DB binding this test env doesn't
// carry).
function roleEnv(role, writeFetchImpl) {
  return liveEnv(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role }), { status: 200 });
    if (url.pathname === '/api/contracts/finance-property-reserves-v1') return new Response(JSON.stringify(LIVE_PROPERTY_RESERVES), { status: 200 });
    return writeFetchImpl(req);
  });
}

function postForm(env, { accessJwt, body } = {}) {
  const params = new URLSearchParams({
    reserve_key: 'property_tax', report_month: '2027-01', tax_year: '2027',
    target_estimate: '11400', contribution: '950',
    ...body,
  });
  return worker.fetch(new Request('https://finance.test/api/v1/connect-property-reserve-monthly-write', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(accessJwt !== undefined ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {}),
    },
    body: params.toString(),
  }), env);
}

describe('Commercial Property — reserve schedule entry form and relay route', () => {
  it('rejects the wrong method on the write-only route with an Allow header naming only POST', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-property-reserve-monthly-write'), baseEnv);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('does not show the entry form when the viewer role is not verified', async () => {
    const res = await worker.fetch(new Request('https://finance.test/?section=property&page=reserve-distribution'), baseEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-property-reserve-monthly-write');
  });

  it('does not show the entry form for a finance-role viewer -- admin-only, matching the legacy route', async () => {
    const env = roleEnv('finance', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=property&page=reserve-distribution', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-property-reserve-monthly-write');
  });

  it('shows the entry form for a verified admin viewer, alongside the disbursement form', async () => {
    const env = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=property&page=reserve-distribution', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).toContain('<form method="POST" action="/api/v1/connect-property-reserve-monthly-write">');
    expect(html).toContain('name="report_month"');
    expect(html).toContain('name="contribution"');
    expect(html).toContain('<form method="POST" action="/api/v1/connect-property-reserve-disbursement-write">');
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
      return new Response(JSON.stringify({ ok: true, savedBy: 'andrew', reserve_before_cents: 0, reserve_after_cents: 95000 }), { status: 200 });
    });
    const res = await postForm(env, { accessJwt: 'signed.jwt.here' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('section')).toBe('property');
    expect(location.searchParams.get('page')).toBe('reserve-distribution');
    expect(location.searchParams.get('status')).toBe('ok');

    expect(captured.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
    expect(captured.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(captured.url);
    expect(url.pathname).toBe('/api/contracts/finance-property-reserve-monthly-write-v1');
    const sentBody = JSON.parse(await captured.text());
    expect(sentBody).toEqual({
      reserve_key: 'property_tax', report_month: '2027-01', tax_year: '2027',
      target_estimate: '11400', contribution: '950', reserve_before: '', note: '',
    });

    const shownEnv = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const shown = await worker.fetch(new Request(location.toString(), { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), shownEnv);
    const html = await shown.text();
    expect(html).toContain('Saved in Connect.');
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
