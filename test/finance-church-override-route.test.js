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
// Income & expense detail renders live) -- the same two calls a real page load makes.
function roleEnv(role, writeFetchImpl) {
  return liveEnv(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role }), { status: 200 });
    if (url.pathname === '/api/contracts/finance-church-report-v1') return new Response(JSON.stringify(LIVE_CHURCH_REPORT), { status: 200 });
    return writeFetchImpl(req);
  });
}

function postForm(env, { accessJwt, body } = {}) {
  const params = new URLSearchParams({
    year: '2027', category: 'Expenses:Utilities', classification: 'Expenses', account_name: 'Utilities', amount: '5000',
    ...body,
  });
  return worker.fetch(new Request('https://finance.test/api/v1/connect-church-actual-override', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(accessJwt !== undefined ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {}),
    },
    body: params.toString(),
  }), env);
}

describe('Church Report — actual-figure correction form and relay route', () => {
  it('rejects the wrong method on the write-only route with an Allow header naming only POST', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-church-actual-override'), baseEnv);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('does not show the correction form when the viewer role is not verified', async () => {
    const res = await worker.fetch(new Request('https://finance.test/?section=church&page=income-expense'), baseEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-church-actual-override');
  });

  it('does not show the correction form for a council viewer -- admin-only, unlike Budget override-bulk', async () => {
    const env = roleEnv('council', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=church&page=income-expense', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-church-actual-override');
  });

  it('shows the correction form for a verified admin viewer, only on Income & expense detail', async () => {
    const env = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=church&page=income-expense', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).toContain('<form method="POST" action="/api/v1/connect-church-actual-override">');
    expect(html).toContain('name="category"');
    expect(html).toContain('name="amount"');

    const overviewRes = await worker.fetch(new Request('https://finance.test/?section=church&page=overview', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const overviewHtml = await overviewRes.text();
    expect(overviewHtml).not.toContain('/api/v1/connect-church-actual-override');
  });

  it('redirects to a not_configured error when the service binding and shared secret are not set', async () => {
    const res = await postForm(baseEnv, { accessJwt: 'whatever' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.pathname).toBe('/');
    expect(location.searchParams.get('section')).toBe('church');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('not_configured');
  });

  it('redirects to a no_access_identity error when the incoming request carries no Access assertion', async () => {
    const res = await postForm(liveEnv(async () => new Response('{}')), { accessJwt: undefined });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('no_access_identity');
  });

  it('forwards the Access assertion and form fields as a one-row batch, and redirects to status=ok on success', async () => {
    let captured;
    const env = liveEnv(async (req) => {
      captured = req;
      return new Response(JSON.stringify({ ok: true, year: 2027, saved: 1, savedBy: 'andrew' }), { status: 200 });
    });
    const res = await postForm(env, { accessJwt: 'signed.jwt.here', body: { amount: '7500' } });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('section')).toBe('church');
    expect(location.searchParams.get('page')).toBe('income-expense');
    expect(location.searchParams.get('status')).toBe('ok');

    expect(captured.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
    expect(captured.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(captured.url);
    expect(url.pathname).toBe('/api/contracts/finance-church-actual-override-v1');
    const sentBody = JSON.parse(await captured.text());
    expect(sentBody).toEqual({
      year: '2027', rows: [{ category: 'Expenses:Utilities', classification: 'Expenses', account_name: 'Utilities', amount: '7500' }],
    });

    const shownEnv = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const shown = await worker.fetch(new Request(location.toString(), { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), shownEnv);
    const html = await shown.text();
    expect(html).toContain('Saved in Connect.');
  });

  it('redirects with the refusal reason when Connect declines the edit, and shows it back on the page', async () => {
    const env = liveEnv(async () => new Response(JSON.stringify({ error: 'Access denied: correcting an actual figure requires admin access' }), { status: 403 }));
    const res = await postForm(env, { accessJwt: 'signed.jwt.here' });
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('http_error');
    expect(location.searchParams.get('message')).toBe('Access denied: correcting an actual figure requires admin access');

    const shownEnv = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const shown = await worker.fetch(new Request(location.toString(), { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), shownEnv);
    const html = await shown.text();
    expect(html).toContain('Not saved: Access denied: correcting an actual figure requires admin access');
  });

  it('redirects with a network_error reason when the relay call itself fails, never throwing', async () => {
    const env = liveEnv(async () => { throw new Error('boom'); });
    const res = await postForm(env, { accessJwt: 'signed.jwt.here' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('network_error');
  });
});
