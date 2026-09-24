import { DEFAULT_ROLE_PERMISSIONS } from '../src/api-utils.js';
import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';

const baseEnv = { ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha' };

function liveEnv(fetchImpl) {
  return { ...baseEnv, CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

const LIVE_BUDGET_PAYLOAD = {
  contract: 'connect.finance-budget.v1', dataClassification: 'aggregate', sourceProduct: 'connect', consumerProduct: 'finance',
  currency: 'USD', fiscalYear: 2027, generatedAt: '2026-09-14T12:00:00Z',
  categories: [{
    category: 'Income:Offerings:General Fund', classification: 'Income', plannedAmountCents: 130000000,
    basis: 'manual', growthPct: null, baseAmountCents: null, notes: '',
  }],
  totals: { plannedIncomeCents: 130000000, plannedExpenseCents: 0, plannedNetCents: 130000000 },
  reconciliation: { categoryCount: 1, incomeCount: 1, expenseCount: 0, manualCount: 1, grownCount: 0, totalsMatch: true },
};

// Answers both staff-role-v1 (so canEditBudget resolves) and finance-budget-v1 (so the planning
// section renders live instead of falling back to a synthetic reader that needs a FINANCE_DB
// binding this test suite doesn't set up) -- the same two calls a real page load makes.
function roleEnv(role, writeFetchImpl, granted = {}) {
  return liveEnv(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role, permissions: { ...DEFAULT_ROLE_PERMISSIONS[role], ...granted } }), { status: 200 });
    if (url.pathname === '/api/contracts/finance-budget-v1') return new Response(JSON.stringify(LIVE_BUDGET_PAYLOAD), { status: 200 });
    return writeFetchImpl(req);
  });
}

function postRow(env, { accessJwt, body } = {}) {
  const params = new URLSearchParams({
    category: 'Expenses:Utilities', fiscal_year: '2027', classification: 'Expenses', planned_amount: '20600', notes: '',
    ...body,
  });
  return worker.fetch(new Request('https://finance.test/api/v1/connect-budget-plan-write', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(accessJwt !== undefined ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {}),
    },
    body: params.toString(),
  }), env);
}

describe('Finance Budget Planner — edit form and relay route', () => {
  it('rejects the wrong method on the write-only route with an Allow header naming only POST', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-budget-plan-write'), baseEnv);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('does not show the edit form when the viewer role is not verified (fail-closed on the write UI, not just the write itself)', async () => {
    const res = await worker.fetch(new Request('https://finance.test/?section=planning'), baseEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-budget-plan-write');
  });

  it('does not show the edit form for a finance-role viewer -- same admin/council-only gate as the legacy Budget Planner', async () => {
    const env = roleEnv('finance', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=planning', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-budget-plan-write');
  });

  it('shows the edit form for a verified admin viewer', async () => {
    const env = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=planning', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).toContain('<form method="POST" action="/api/v1/connect-budget-plan-write">');
    expect(html).toContain('name="category"');
    expect(html).toContain('name="fiscal_year"');
    expect(html).toContain('name="planned_amount"');
  });

  it('shows the edit form for a council viewer explicitly granted budget edit access', async () => {
    const env = roleEnv('council', async () => new Response('not found', { status: 404 }), { budget: 'edit' });
    const res = await worker.fetch(new Request('https://finance.test/?section=planning', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).toContain('<form method="POST" action="/api/v1/connect-budget-plan-write">');
  });

  it('redirects to a not_configured error when the service binding and shared secret are not set', async () => {
    const res = await postRow(baseEnv, { accessJwt: 'whatever' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.pathname).toBe('/');
    expect(location.searchParams.get('section')).toBe('planning');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('not_configured');
  });

  it('redirects to a no_access_identity error when the incoming request carries no Access assertion', async () => {
    const res = await postRow(liveEnv(async () => new Response('{}')), { accessJwt: undefined });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('no_access_identity');
  });

  it('forwards the Access assertion and form fields as a one-row batch, and redirects to status=ok on success', async () => {
    let captured;
    const env = liveEnv(async (req) => {
      captured = req;
      return new Response(JSON.stringify({ ok: true, saved: 1, savedBy: 'andrew' }), { status: 200 });
    });
    const res = await postRow(env, { accessJwt: 'signed.jwt.here', body: { planned_amount: '75000' } });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('status')).toBe('ok');

    expect(captured.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
    expect(captured.headers.get('X-Contract-Key')).toBe('test-secret');
    const sentBody = JSON.parse(await captured.text());
    expect(sentBody).toEqual({ rows: [{ category: 'Expenses:Utilities', fiscal_year: '2027', classification: 'Expenses', planned_amount: '75000', notes: '' }] });

    // Reloading the page after the redirect is a normal authenticated request too -- Cloudflare
    // Access attaches the same JWT header to every request once signed in, not just the POST.
    const shownEnv = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const shown = await worker.fetch(new Request('https://finance.test/?section=planning&status=ok', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), shownEnv);
    const html = await shown.text();
    expect(html).toContain('Saved in Connect.');
  });

  it('redirects with the refusal reason when Connect declines the edit, and shows it back on the page', async () => {
    const env = liveEnv(async () => new Response(JSON.stringify({ error: 'Access denied: editing budget plans requires admin access' }), { status: 403 }));
    const res = await postRow(env, { accessJwt: 'signed.jwt.here' });
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('http_error');
    expect(location.searchParams.get('message')).toBe('Access denied: editing budget plans requires admin access');

    const shownEnv = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const shown = await worker.fetch(new Request(location.toString(), {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), shownEnv);
    const html = await shown.text();
    expect(html).toContain('Not saved: Access denied: editing budget plans requires admin access');
  });

  it('redirects with a network_error reason when the relay call itself fails, never throwing', async () => {
    const env = liveEnv(async () => { throw new Error('boom'); });
    const res = await postRow(env, { accessJwt: 'signed.jwt.here' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('network_error');
  });
});
