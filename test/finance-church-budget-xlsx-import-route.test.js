import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';

const baseEnv = { ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha' };

function liveEnv(fetchImpl) {
  return { ...baseEnv, CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

const LIVE_CHURCH_REPORT = {
  contract: 'connect.finance-church-report.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  fiscalYear: 2027, generatedAt: '2026-09-15T12:00:00Z',
  accounts: [
    { classification: 'Expenses', categoryPath: 'Expenses:Utilities', accountName: 'Utilities', depth: 0, hasChildren: false, actualCents: 500000, budgetCents: 400000, source: 'import' },
  ],
  totals: {
    incomeActualCents: 0, incomeBudgetCents: 0, expenseActualCents: 500000, expenseBudgetCents: 400000,
    netIncomeActualCents: -500000, netIncomeBudgetCents: -400000, hasBudgetData: true,
  },
  reconciliation: {
    accountCount: 1, incomeCount: 0, expenseCount: 1, otherIncomeCount: 0, otherExpenseCount: 0,
    costOfGoodsSoldCount: 0, accountsWithBudgetCount: 1, totalsMatch: true,
  },
};

// Answers both staff-role-v1 (so canManageChurchReport resolves) and finance-church-report-v1 (so
// Budget vs actual renders live) -- the same two calls a real page load makes.
function roleEnv(role, writeFetchImpl) {
  return liveEnv(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role }), { status: 200 });
    if (url.pathname === '/api/contracts/finance-church-report-v1') return new Response(JSON.stringify(LIVE_CHURCH_REPORT), { status: 200 });
    return writeFetchImpl(req);
  });
}

function fakeXlsxFile(content = 'PK\x03\x04fake-xlsx-bytes-for-route-test') {
  return new File([content], 'budget.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function postFile(env, { accessJwt, file, fields } = {}) {
  const form = new FormData();
  if (file !== null) form.set('file', file === undefined ? fakeXlsxFile() : file);
  for (const [k, v] of Object.entries(fields || {})) form.set(k, v);
  return worker.fetch(new Request('https://finance.test/api/v1/connect-church-budget-xlsx-import-write', {
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

describe('Church Report — Budget vs. Actuals .xlsx import form and relay route', () => {
  it('rejects the wrong method on the write-only route with an Allow header naming only POST', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-church-budget-xlsx-import-write'), baseEnv);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('does not show the import form when the viewer role is not verified', async () => {
    const res = await worker.fetch(new Request('https://finance.test/?section=church&page=budget-actual'), baseEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-church-budget-xlsx-import-write');
    expect(html).not.toContain('/api/v1/connect-church-budget-xlsx-preview');
  });

  it('does not show the import form for a council viewer -- admin-only, same as the actual-figure correction form', async () => {
    const env = roleEnv('council', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=church&page=budget-actual', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-church-budget-xlsx-import-write');
    expect(html).not.toContain('/api/v1/connect-church-budget-xlsx-preview');
  });

  it('shows the import form for a verified admin viewer, only on Budget vs actual', async () => {
    const env = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=church&page=budget-actual', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).toContain('<form method="POST" action="/api/v1/connect-church-budget-xlsx-preview" enctype="multipart/form-data">');
    expect(html).toContain('type="file"');
    expect(html).toContain('name="file"');

    const overviewRes = await worker.fetch(new Request('https://finance.test/?section=church&page=overview', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const overviewHtml = await overviewRes.text();
    expect(overviewHtml).not.toContain('/api/v1/connect-church-budget-xlsx-import-write');
  });

  it('renders a no-write checkbox review from the protected preview relay', async () => {
    let captured;
    const env = liveEnv(async (request) => {
      captured = request;
      return new Response(JSON.stringify({
        ok: true, sheetName: 'Budget vs. Actuals FY27', fiscalYear: 2027, skipped: [],
        rows: [{ classification: 'Income', category_path: 'Income:Offerings', account_name: 'Offerings', depth: 1, has_children: false, own_actual_cents: 100000, own_budget_cents: 90000 }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const form = new FormData();
    form.set('file', fakeXlsxFile());
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-church-budget-xlsx-preview', {
      method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' }, body: form,
    }), env);
    expect(res.status).toBe(200);
    expect(new URL(captured.url).pathname).toBe('/api/contracts/finance-church-budget-xlsx-preview-v1');
    expect(captured.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
    const html = await res.text();
    expect(html).toContain('No data has been changed.');
    expect(html).toContain('FY2027');
    expect(html).toContain('Income:Offerings');
    expect(html).toContain('/api/v1/connect-church-budget-xlsx-commit');
  });

  it('commits only checked rows through the protected commit relay', async () => {
    let body;
    const env = liveEnv(async (request) => {
      body = await request.json();
      return new Response(JSON.stringify({ ok: true, fiscalYear: 2027, imported: 1 }), { status: 200 });
    });
    const selected = { classification: 'Income', category_path: 'Income:Offerings', account_name: 'Offerings', depth: 1, has_children: false, own_actual_cents: 100000, own_budget_cents: 90000 };
    const form = new FormData();
    form.set('fiscal_year', '2027');
    form.append('row', JSON.stringify(selected));
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-church-budget-xlsx-commit', {
      method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' }, body: form,
    }), env);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/?section=church&page=budget-actual&status=ok');
    expect(body).toEqual({ fiscal_year: '2027', rows: [selected] });
  });

  it('redirects to a no_file error when no file was attached', async () => {
    const res = await postFile(liveEnv(async () => new Response('{}')), { accessJwt: 'signed.jwt.here', file: null });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('section')).toBe('church');
    expect(location.searchParams.get('page')).toBe('budget-actual');
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
      return new Response(JSON.stringify({ ok: true, fiscalYear: 2027, imported: 4, savedBy: 'andrew' }), { status: 200 });
    });
    const content = 'PK\x03\x04fake-xlsx-bytes-for-route-test';
    const res = await postFile(env, { accessJwt: 'signed.jwt.here', file: fakeXlsxFile(content), fields: { fiscal_year_hint: '2027' } });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('section')).toBe('church');
    expect(location.searchParams.get('page')).toBe('budget-actual');
    expect(location.searchParams.get('status')).toBe('ok');

    expect(captured.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
    expect(captured.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(captured.url);
    expect(url.pathname).toBe('/api/contracts/finance-church-budget-xlsx-import-v1');
    const sentBody = JSON.parse(await captured.text());
    expect(sentBody.fiscal_year_hint).toBe('2027');
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
