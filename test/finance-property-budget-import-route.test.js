import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';

const baseEnv = { ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha' };

function liveEnv(fetchImpl) {
  return { ...baseEnv, CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

// No complete 12-month forecast year on file -- a normal, valid state (see
// finance-property-forecast-consumer.js's own header comment) that still renders the import form,
// since the form is shown regardless of which of the three 'forecast' page branches rendered.
const LIVE_PROPERTY_FORECAST_EMPTY = {
  contract: 'connect.finance-property-forecast.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  propertyKey: 'ivanhoe', generatedAt: '2026-09-15T12:00:00Z',
  forecastYear: null, periods: [], totals: { revenueCents: 0, expensesCents: 0, netIncomeCents: 0, reconciled: true },
};

// Answers both staff-role-v1 (so canManagePropertyLedgers resolves) and
// finance-property-forecast-v1 (so Run-rate forecast renders live).
function roleEnv(role, writeFetchImpl) {
  return liveEnv(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role }), { status: 200 });
    if (url.pathname === '/api/contracts/finance-property-forecast-v1') return new Response(JSON.stringify(LIVE_PROPERTY_FORECAST_EMPTY), { status: 200 });
    return writeFetchImpl(req);
  });
}

function fakeXlsxFile(content = 'PK\x03\x04fake-xlsx-bytes-for-route-test') {
  return new File([content], 'budget-detail.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function postFile(env, { accessJwt, file } = {}) {
  const form = new FormData();
  if (file !== null) form.set('file', file === undefined ? fakeXlsxFile() : file);
  return worker.fetch(new Request('https://finance.test/api/v1/connect-property-budget-import-write', {
    method: 'POST',
    headers: { ...(accessJwt !== undefined ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {}) },
    body: form,
  }), env);
}

async function bytesToBase64FromString(s) {
  const bytes = new TextEncoder().encode(s);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

describe('Commercial Property — AHRA Budget Detail .xlsx import form and relay route', () => {
  it('rejects the wrong method on the write-only route with an Allow header naming only POST', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-property-budget-import-write'), baseEnv);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('does not show the import form when the viewer role is not verified', async () => {
    const res = await worker.fetch(new Request('https://finance.test/?section=property&page=forecast'), baseEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-property-budget-import-write');
  });

  it('does not show the import form for a finance-role viewer -- admin-only, matching the legacy route', async () => {
    const env = roleEnv('finance', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=property&page=forecast', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-property-budget-import-write');
  });

  it('shows the import form for a verified admin viewer, only on Run-rate forecast', async () => {
    const env = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=property&page=forecast', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).toContain('<form method="POST" action="/api/v1/connect-property-budget-import-write" enctype="multipart/form-data">');
    expect(html).toContain('type="file"');
    expect(html).toContain('name="file"');

    const overviewRes = await worker.fetch(new Request('https://finance.test/?section=property&page=overview', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const overviewHtml = await overviewRes.text();
    expect(overviewHtml).not.toContain('/api/v1/connect-property-budget-import-write');
  });

  it('redirects to a no_file error when no file was attached', async () => {
    const res = await postFile(liveEnv(async () => new Response('{}')), { accessJwt: 'signed.jwt.here', file: null });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('section')).toBe('property');
    expect(location.searchParams.get('page')).toBe('forecast');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('no_file');
  });

  it('redirects to a too_large error for a file over 15 MB, without ever calling the relay', async () => {
    let called = false;
    const env = liveEnv(async () => { called = true; return new Response('{}'); });
    const bigFile = new File([new Uint8Array(15 * 1024 * 1024 + 1)], 'huge.xlsx');
    const res = await postFile(env, { accessJwt: 'signed.jwt.here', file: bigFile });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('too_large');
    expect(called).toBe(false);
  });

  it('redirects to a not_configured error when the service binding and shared secret are not set', async () => {
    const res = await postFile(baseEnv, { accessJwt: 'whatever' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.pathname).toBe('/');
    expect(location.searchParams.get('section')).toBe('property');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('not_configured');
  });

  it('redirects to a no_access_identity error when the incoming request carries no Access assertion', async () => {
    const res = await postFile(liveEnv(async () => new Response('{}')), { accessJwt: undefined });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('no_access_identity');
  });

  it('base64-encodes the uploaded bytes, forwards the Access assertion, and redirects to status=ok on success', async () => {
    let captured;
    const env = liveEnv(async (req) => {
      captured = req;
      return new Response(JSON.stringify({ ok: true, imported: 2, savedBy: 'andrew' }), { status: 200 });
    });
    const content = 'PK\x03\x04fake-xlsx-bytes-for-route-test';
    const res = await postFile(env, { accessJwt: 'signed.jwt.here', file: fakeXlsxFile(content) });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('section')).toBe('property');
    expect(location.searchParams.get('page')).toBe('forecast');
    expect(location.searchParams.get('status')).toBe('ok');

    expect(captured.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
    expect(captured.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(captured.url);
    expect(url.pathname).toBe('/api/contracts/finance-property-budget-import-v1');
    const sentBody = JSON.parse(await captured.text());
    expect(sentBody.file_base64).toBe(await bytesToBase64FromString(content));

    const shownEnv = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const shown = await worker.fetch(new Request(location.toString(), { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), shownEnv);
    const html = await shown.text();
    expect(html).toContain('Imported into Connect.');
  });

  it('redirects with the refusal reason when Connect declines the import, and shows it back on the page', async () => {
    const env = liveEnv(async () => new Response(JSON.stringify({ error: 'Access denied: editing property financials requires admin access' }), { status: 403 }));
    const res = await postFile(env, { accessJwt: 'signed.jwt.here' });
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('http_error');
    expect(location.searchParams.get('message')).toBe('Access denied: editing property financials requires admin access');

    const shownEnv = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const shown = await worker.fetch(new Request(location.toString(), { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), shownEnv);
    const html = await shown.text();
    expect(html).toContain('Not imported: Access denied: editing property financials requires admin access');
  });

  it('redirects with a network_error reason when the relay call itself fails, never throwing', async () => {
    const env = liveEnv(async () => { throw new Error('boom'); });
    const res = await postFile(env, { accessJwt: 'signed.jwt.here' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('network_error');
  });
});
