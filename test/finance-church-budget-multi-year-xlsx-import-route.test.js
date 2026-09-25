import { DEFAULT_ROLE_PERMISSIONS } from '../src/api-utils.js';
import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';

const baseEnv = { ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha' };

function liveEnv(fetchImpl) {
  return { ...baseEnv, CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

// Same live trend fixture as test/finance-alpha-shell.test.js's own -- the 'trend' page's
// synthetic fallback reads Finance's own FINANCE_DB, which these route tests never provision, so
// the live trend contract has to be answered (not just staff-role-v1) or the page renders its
// generic "Data unavailable" placeholder instead of the form under test.
const VALID_LIVE_TREND = {
  contract: 'connect.finance-church-report-trend.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  generatedAt: '2026-09-15T12:00:00Z',
  years: [
    {
      fiscalYear: 2027, incomeActualCents: 1000000, expenseActualCents: 900000,
      otherIncomeActualCents: 0, otherExpenseActualCents: 0, costOfGoodsSoldActualCents: 0,
      netIncomeActualCents: 100000, accountCount: 4,
    },
  ],
  reconciliation: { yearCount: 1, totalsMatch: true },
};

// Answers staff-role-v1 (so canImportChurchMultiYear resolves) and finance-church-report-trend-v1
// (so the 'trend' page renders live instead of falling back to the synthetic DB reader).
function roleEnv(role, writeFetchImpl, granted = {}) {
  return liveEnv(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role, permissions: { ...DEFAULT_ROLE_PERMISSIONS[role], ...granted } }), { status: 200 });
    if (url.pathname === '/api/contracts/finance-church-report-trend-v1') return new Response(JSON.stringify(VALID_LIVE_TREND), { status: 200 });
    return writeFetchImpl(req);
  });
}

function fakeXlsxFile(content = 'PK\x03\x04fake-budget-multi-year-xlsx-bytes') {
  return new File([content], 'budget-multi-year.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function postFile(env, { accessJwt, file } = {}) {
  const form = new FormData();
  if (file !== null) form.set('file', file === undefined ? fakeXlsxFile() : file);
  return worker.fetch(new Request('https://finance.test/api/v1/connect-church-budget-multi-year-xlsx-import-write', {
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

describe('Church Report — Budget by Year multi-year .xlsx import form and relay route', () => {
  it('rejects the wrong method on the write-only route with an Allow header naming only POST', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-church-budget-multi-year-xlsx-import-write'), baseEnv);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('does not show the import form when the viewer role is not verified', async () => {
    const res = await worker.fetch(new Request('https://finance.test/?section=church&page=trend'), baseEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-church-budget-multi-year-xlsx-import-write');
    expect(html).not.toContain('/api/v1/connect-church-budget-multi-year-xlsx-preview');
  });

  it('shows the import form for an admin viewer (imports are admin-only, 2026-09-25)', async () => {
    const env = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=church&page=trend', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).toContain('<form method="POST" action="/api/v1/connect-church-budget-multi-year-xlsx-preview" enctype="multipart/form-data">');
    expect(html).toContain('type="file"');
    expect(html).toContain('name="file"');

    const overviewRes = await worker.fetch(new Request('https://finance.test/?section=church&page=overview', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const overviewHtml = await overviewRes.text();
    expect(overviewHtml).not.toContain('/api/v1/connect-church-budget-multi-year-xlsx-import-write');
  });

  it('hides the import form from council and finance viewers, even with finance edit access', async () => {
    const env = roleEnv('council', async () => new Response('not found', { status: 404 }), { finance: 'edit' });
    const res = await worker.fetch(new Request('https://finance.test/?section=church&page=trend', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-church-budget-multi-year-xlsx-preview');
    const financeEnv = roleEnv('finance', async () => new Response('not found', { status: 404 }));
    const financeRes = await worker.fetch(new Request('https://finance.test/?section=church&page=trend', { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), financeEnv);
    expect(await financeRes.text()).not.toContain('/api/v1/connect-church-budget-multi-year-xlsx-preview');
  });

  it('redirects to a no_file error when no file was attached', async () => {
    const res = await postFile(liveEnv(async () => new Response('{}')), { accessJwt: 'signed.jwt.here', file: null });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('section')).toBe('church');
    expect(location.searchParams.get('page')).toBe('trend');
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
    expect(location.searchParams.get('section')).toBe('church');
    expect(location.searchParams.get('page')).toBe('trend');
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
      return new Response(JSON.stringify({ ok: true, years: [2026, 2027], imported: 8, savedBy: 'andrew' }), { status: 200 });
    });
    const content = 'PK\x03\x04fake-budget-multi-year-xlsx-bytes';
    const res = await postFile(env, { accessJwt: 'signed.jwt.here', file: fakeXlsxFile(content) });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('section')).toBe('church');
    expect(location.searchParams.get('page')).toBe('trend');
    expect(location.searchParams.get('status')).toBe('ok');

    expect(captured.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
    expect(captured.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(captured.url);
    expect(url.pathname).toBe('/api/contracts/finance-church-budget-multi-year-xlsx-import-v1');
    const sentBody = JSON.parse(await captured.text());
    expect(sentBody.file_base64).toBe(await bytesToBase64FromString(content));

    const shownEnv = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const shown = await worker.fetch(new Request(location.toString(), { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), shownEnv);
    const html = await shown.text();
    expect(html).toContain('Imported into Connect.');
  });

  it('redirects with the refusal reason when Connect declines the import, and shows it back on the page', async () => {
    const env = liveEnv(async () => new Response(JSON.stringify({ error: 'Access denied' }), { status: 403 }));
    const res = await postFile(env, { accessJwt: 'signed.jwt.here' });
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('http_error');
    expect(location.searchParams.get('message')).toBe('Access denied');

    const shownEnv = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const shown = await worker.fetch(new Request(location.toString(), { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), shownEnv);
    const html = await shown.text();
    expect(html).toContain('Not imported: Access denied');
  });

  it('redirects with a network_error reason when the relay call itself fails, never throwing', async () => {
    const env = liveEnv(async () => { throw new Error('boom'); });
    const res = await postFile(env, { accessJwt: 'signed.jwt.here' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('network_error');
  });
});
