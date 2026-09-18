import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';

const baseEnv = { ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha' };

function liveEnv(fetchImpl) {
  return { ...baseEnv, CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

const LIVE_CHART_OF_ACCOUNTS = {
  contract: 'connect.finance-chart-of-accounts.v1', dataClassification: 'structural',
  sourceProduct: 'connect', consumerProduct: 'finance', generatedAt: '2026-09-15T12:00:00Z',
  accounts: [
    { classification: 'Expenses', categoryPath: 'Expenses:60000 Programs', accountName: '60000 Programs', depth: 0, hasChildren: false, boardCategoryKey: 'unassigned', boardCategoryLabel: 'Unassigned', purposeTagId: null, purposeTagLabel: null },
  ],
  reconciliation: { accountCount: 1, incomeCount: 0, expenseCount: 1, unassignedCount: 1 },
};

// Answers both staff-role-v1 (so canManageBoardCategories resolves) and
// finance-chart-of-accounts-v1 (so the page renders live) -- the same two calls a real page load
// makes.
function roleEnv(role, writeFetchImpl) {
  return liveEnv(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role }), { status: 200 });
    if (url.pathname === '/api/contracts/finance-chart-of-accounts-v1') return new Response(JSON.stringify(LIVE_CHART_OF_ACCOUNTS), { status: 200 });
    return writeFetchImpl(req);
  });
}

function postForm(env, { accessJwt, body } = {}) {
  const params = new URLSearchParams({
    category_path: 'Expenses:60000 Programs', board_category: 'programs',
    ...body,
  });
  return worker.fetch(new Request('https://finance.test/api/v1/connect-board-categories-write', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(accessJwt !== undefined ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {}),
    },
    body: params.toString(),
  }), env);
}

describe('Chart of Accounts — board-category assignment form and relay route', () => {
  it('rejects the wrong method on the write-only route with an Allow header naming only POST', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-board-categories-write'), baseEnv);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('does not show the assignment form when the viewer role is not verified', async () => {
    const res = await worker.fetch(new Request('https://finance.test/?section=accounts'), baseEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-board-categories-write');
  });

  it('does not show the assignment form for a finance-role viewer -- admin-only, unlike Budget override-bulk', async () => {
    const env = roleEnv('finance', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=accounts', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-board-categories-write');
  });

  it('shows the assignment form for a verified admin viewer', async () => {
    const env = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=accounts', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).toContain('<form method="POST" action="/api/v1/connect-board-categories-write">');
    expect(html).toContain('name="category_path"');
    expect(html).toContain('name="board_category"');
  });

  it('redirects to a not_configured error when the service binding and shared secret are not set', async () => {
    const res = await postForm(baseEnv, { accessJwt: 'whatever' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.pathname).toBe('/');
    expect(location.searchParams.get('section')).toBe('accounts');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('not_configured');
  });

  it('redirects to a no_access_identity error when the incoming request carries no Access assertion', async () => {
    const res = await postForm(liveEnv(async () => new Response('{}')), { accessJwt: undefined });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('no_access_identity');
  });

  it('routes an expense-category selection into the expense map', async () => {
    let captured;
    const env = liveEnv(async (req) => {
      captured = req;
      return new Response(JSON.stringify({ ok: true, savedBy: 'andrew' }), { status: 200 });
    });
    const res = await postForm(env, { accessJwt: 'signed.jwt.here', body: { board_category: 'programs' } });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('status')).toBe('ok');
    const sentBody = JSON.parse(await captured.text());
    expect(sentBody).toEqual({ expense: { 'Expenses:60000 Programs': 'programs' } });
  });

  it('routes a revenue-category selection into the revenue map', async () => {
    let captured;
    const env = liveEnv(async (req) => {
      captured = req;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const res = await postForm(env, {
      accessJwt: 'signed.jwt.here',
      body: { category_path: 'Income:40000 Contributions', board_category: 'donor' },
    });
    expect(res.status).toBe(303);
    const sentBody = JSON.parse(await captured.text());
    expect(sentBody).toEqual({ revenue: { 'Income:40000 Contributions': 'donor' } });
  });

  it('clears the assignment from both maps when no category is selected', async () => {
    let captured;
    const env = liveEnv(async (req) => {
      captured = req;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const res = await postForm(env, { accessJwt: 'signed.jwt.here', body: { board_category: '' } });
    expect(res.status).toBe(303);
    const sentBody = JSON.parse(await captured.text());
    expect(sentBody).toEqual({ revenue: { 'Expenses:60000 Programs': '' }, expense: { 'Expenses:60000 Programs': '' } });
  });

  it('redirects with the refusal reason when Connect declines the assignment, and shows it back on the page', async () => {
    const env = liveEnv(async () => new Response(JSON.stringify({ error: 'Access denied: editing the chart of accounts requires admin access' }), { status: 403 }));
    const res = await postForm(env, { accessJwt: 'signed.jwt.here' });
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('http_error');
    expect(location.searchParams.get('message')).toBe('Access denied: editing the chart of accounts requires admin access');

    const shownEnv = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const shown = await worker.fetch(new Request(location.toString(), { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), shownEnv);
    const html = await shown.text();
    expect(html).toContain('Not saved: Access denied: editing the chart of accounts requires admin access');
  });

  it('redirects with a network_error reason when the relay call itself fails, never throwing', async () => {
    const env = liveEnv(async () => { throw new Error('boom'); });
    const res = await postForm(env, { accessJwt: 'signed.jwt.here' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('network_error');
  });
});
