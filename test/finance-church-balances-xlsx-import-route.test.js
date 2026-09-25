import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';

const baseEnv = { ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha' };

function liveEnv(fetchImpl) {
  return { ...baseEnv, CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

const LIVE_BALANCE_SHEET = {
  contract: 'connect.finance-balance-sheet.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  fiscalYear: 2027, asOfDate: 'December 31, 2027', generatedAt: '2026-09-15T12:00:00Z',
  accounts: [
    { classification: 'Assets', categoryPath: 'Assets:Cash', accountName: 'Cash', depth: 0, hasChildren: false, ownBalanceCents: 500000 },
    { classification: 'Liabilities', categoryPath: 'Liabilities:Accounts Payable', accountName: 'Accounts Payable', depth: 0, hasChildren: false, ownBalanceCents: 100000 },
    { classification: 'Equity', categoryPath: 'Equity:Net Assets', accountName: 'Net Assets', depth: 0, hasChildren: false, ownBalanceCents: 400000 },
  ],
  totals: {
    assetsCents: 500000, liabilitiesCents: 100000, equityCents: 400000,
    currentAssetsCents: 0, fixedAssetsCents: 0, otherAssetsCents: 500000,
    liabilitiesPlusEquityCents: 500000, balancedCents: 0,
  },
  equityReclass: {
    donorRestrictedCents: 0, unrestrictedCents: 400000, totalEquityCents: 400000,
    breakdown: {
      perpetual: { label: 'Perpetual endowments', cents: 0 },
      purpose_time: { label: 'Purpose/time restricted', cents: 0 },
      designated: { label: 'Designated ministry/purpose funds', cents: 0 },
    },
    unclassified: [],
  },
  reconciliation: { accountCount: 3, assetsCount: 1, liabilitiesCount: 1, equityCount: 1, unclassifiedEquityCount: 0, totalsMatch: true },
};

// Answers both staff-role-v1 (so canManageBalanceImport resolves) and finance-balance-sheet-v1 (so
// Position renders live) -- the same two calls a real page load makes.
function roleEnv(role, writeFetchImpl) {
  return liveEnv(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role }), { status: 200 });
    if (url.pathname === '/api/contracts/finance-balance-sheet-v1') return new Response(JSON.stringify(LIVE_BALANCE_SHEET), { status: 200 });
    return writeFetchImpl(req);
  });
}

function fakeXlsxFile(content = 'PK\x03\x04fake-balance-xlsx-bytes') {
  return new File([content], 'balances.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function postFile(env, { accessJwt, file } = {}) {
  const form = new FormData();
  if (file !== null) form.set('file', file === undefined ? fakeXlsxFile() : file);
  return worker.fetch(new Request('https://finance.test/api/v1/connect-church-balances-xlsx-import-write', {
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

describe('Balance Sheet — Statement of Financial Position .xlsx import form and relay route', () => {
  it('rejects the wrong method on the write-only route with an Allow header naming only POST', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-church-balances-xlsx-import-write'), baseEnv);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('does not show the import form when the viewer role is not verified', async () => {
    const res = await worker.fetch(new Request('https://finance.test/?section=balance&page=position'), baseEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-church-balances-xlsx-import-write');
    expect(html).not.toContain('/api/v1/connect-church-balances-xlsx-preview');
  });

  it('does not show the import form for a council viewer -- admin-only', async () => {
    const env = roleEnv('council', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=balance&page=position', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-church-balances-xlsx-import-write');
    expect(html).not.toContain('/api/v1/connect-church-balances-xlsx-preview');
  });

  it('shows the import form for a verified admin viewer, only on the Position page', async () => {
    const env = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=balance&page=position', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).toContain('<form method="POST" action="/api/v1/connect-church-balances-xlsx-preview" enctype="multipart/form-data">');
    expect(html).toContain('type="file"');
    expect(html).toContain('name="file"');

    const detailRes = await worker.fetch(new Request('https://finance.test/?section=balance&page=account-detail', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const detailHtml = await detailRes.text();
    expect(detailHtml).not.toContain('/api/v1/connect-church-balances-xlsx-import-write');
  });

  it('renders a no-write checkbox review from the protected preview relay', async () => {
    let captured;
    const env = liveEnv(async (request) => {
      captured = request;
      return new Response(JSON.stringify({
        ok: true, sheetName: 'Balance Sheet', fiscalYear: 2027, asOfDate: 'December 31, 2027', basis: 'Cash', skipped: [],
        rows: [{ classification: 'Assets', category_path: 'Assets:Cash', account_name: 'Cash', depth: 1, has_children: false, own_balance_cents: 500000 }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const form = new FormData();
    form.set('file', fakeXlsxFile());
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-church-balances-xlsx-preview', {
      method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' }, body: form,
    }), env);
    expect(res.status).toBe(200);
    expect(new URL(captured.url).pathname).toBe('/api/contracts/finance-church-balances-xlsx-preview-v1');
    expect(captured.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
    const html = await res.text();
    expect(html).toContain('No data has been changed.');
    expect(html).toContain('December 31, 2027');
    expect(html).toContain('Assets:Cash');
    expect(html).toContain('/api/v1/connect-church-balances-xlsx-commit');
  });

  it('commits only checked rows and preserves the workbook as-of date', async () => {
    let body;
    const env = liveEnv(async (request) => {
      body = await request.json();
      return new Response(JSON.stringify({ ok: true, fiscalYear: 2027, imported: 1 }), { status: 200 });
    });
    const selected = { classification: 'Assets', category_path: 'Assets:Cash', account_name: 'Cash', depth: 1, has_children: false, own_balance_cents: 500000 };
    const form = new FormData();
    form.set('fiscal_year', '2027');
    form.set('as_of_date', 'December 31, 2027');
    form.append('row', JSON.stringify(selected));
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-church-balances-xlsx-commit', {
      method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' }, body: form,
    }), env);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/?section=balance&page=position&status=ok');
    expect(body).toEqual({ fiscal_year: '2027', as_of_date: 'December 31, 2027', rows: [selected] });
  });

  it('redirects to a no_file error when no file was attached', async () => {
    const res = await postFile(liveEnv(async () => new Response('{}')), { accessJwt: 'signed.jwt.here', file: null });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('section')).toBe('balance');
    expect(location.searchParams.get('page')).toBe('position');
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
    expect(location.searchParams.get('section')).toBe('balance');
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
      return new Response(JSON.stringify({ ok: true, fiscalYear: 2027, asOfDate: 'December 31, 2027', basis: 'Cash', imported: 6, savedBy: 'andrew' }), { status: 200 });
    });
    const content = 'PK\x03\x04fake-balance-xlsx-bytes';
    const res = await postFile(env, { accessJwt: 'signed.jwt.here', file: fakeXlsxFile(content) });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('section')).toBe('balance');
    expect(location.searchParams.get('page')).toBe('position');
    expect(location.searchParams.get('status')).toBe('ok');

    expect(captured.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
    expect(captured.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(captured.url);
    expect(url.pathname).toBe('/api/contracts/finance-church-balances-xlsx-import-v1');
    const sentBody = JSON.parse(await captured.text());
    expect(sentBody.file_base64).toBe(await bytesToBase64FromString(content));

    const shownEnv = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const shown = await worker.fetch(new Request(location.toString(), { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), shownEnv);
    const html = await shown.text();
    expect(html).toContain('Imported into Connect.');
  });

  it('redirects with the refusal reason when Connect declines the import, and shows it back on the page', async () => {
    const env = liveEnv(async () => new Response(JSON.stringify({ error: 'Access denied: importing church financial data requires admin access' }), { status: 403 }));
    const res = await postFile(env, { accessJwt: 'signed.jwt.here' });
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('http_error');
    expect(location.searchParams.get('message')).toBe('Access denied: importing church financial data requires admin access');

    const shownEnv = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const shown = await worker.fetch(new Request(location.toString(), { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), shownEnv);
    const html = await shown.text();
    expect(html).toContain('Not imported: Access denied: importing church financial data requires admin access');
  });

  it('redirects with a network_error reason when the relay call itself fails, never throwing', async () => {
    const env = liveEnv(async () => { throw new Error('boom'); });
    const res = await postFile(env, { accessJwt: 'signed.jwt.here' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('network_error');
  });
});
