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

// Answers both staff-role-v1 (so canManageBudgetPlan resolves) and finance-budget-v1 (so the
// planning section renders live) -- the same two calls a real page load makes. Any other path
// (the operation's own write, which each test mocks individually) goes to `opFetchImpl`.
function roleEnv(role, opFetchImpl) {
  return liveEnv(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role }), { status: 200 });
    if (url.pathname === '/api/contracts/finance-budget-v1') return new Response(JSON.stringify(LIVE_BUDGET_PAYLOAD), { status: 200 });
    return opFetchImpl(req);
  });
}

function postForm(env, path, { accessJwt, body } = {}) {
  const params = new URLSearchParams(body || {});
  return worker.fetch(new Request(`https://finance.test${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(accessJwt !== undefined ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {}),
    },
    body: params.toString(),
  }), env);
}

describe('Budget Plan generate/generate-all/commit/remove routes', () => {
  for (const [path, method] of [
    ['/api/v1/connect-budget-generate', 'GET'], ['/api/v1/connect-budget-generate-all', 'GET'],
    ['/api/v1/connect-budget-commit', 'GET'], ['/api/v1/connect-budget-plan-remove', 'GET'],
  ]) {
    it(`rejects ${method} on the write-only route ${path} with an Allow header naming only POST`, async () => {
      const res = await worker.fetch(new Request(`https://finance.test${path}`, { method }), baseEnv);
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    });
  }

  it('does not show the generate/commit forms or the per-row remove action for a council viewer -- these stay admin-only', async () => {
    const env = roleEnv('council', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=planning', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-budget-generate-all');
    expect(html).not.toContain('/api/v1/connect-budget-generate"');
    expect(html).not.toContain('/api/v1/connect-budget-commit');
    expect(html).not.toContain('/api/v1/connect-budget-plan-remove');
    // The manual edit/save form (admin OR council) should still be there.
    expect(html).toContain('/api/v1/connect-budget-plan-write');
  });

  it('shows the generate/generate-all/commit forms and a per-row remove action for a verified admin viewer', async () => {
    const env = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=planning', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).toContain('<form method="POST" action="/api/v1/connect-budget-generate-all">');
    expect(html).toContain('<form method="POST" action="/api/v1/connect-budget-generate">');
    expect(html).toContain('<form method="POST" action="/api/v1/connect-budget-commit">');
    expect(html).toContain('action="/api/v1/connect-budget-plan-remove"');
  });

  describe('generate', () => {
    it('forwards the form as a generate op, and redirects to op=generate&status=ok on success', async () => {
      let captured;
      const env = liveEnv(async (req) => {
        captured = req;
        return new Response(JSON.stringify({ ok: true, years: [2027, 2028], savedBy: 'andrew' }), { status: 200 });
      });
      const res = await postForm(env, '/api/v1/connect-budget-generate', {
        accessJwt: 'signed.jwt.here',
        body: { category: 'Expenses:Utilities', classification: 'Expenses', base_amount: '1000', growth_pct: '0.1', target_years: '2027,2028', notes: '' },
      });
      expect(res.status).toBe(303);
      const location = new URL(res.headers.get('location'), 'https://finance.test');
      expect(location.searchParams.get('op')).toBe('generate');
      expect(location.searchParams.get('status')).toBe('ok');

      const url = new URL(captured.url);
      expect(url.pathname).toBe('/api/contracts/finance-budget-generate-v1');
      const sentBody = JSON.parse(await captured.text());
      expect(sentBody).toEqual({
        category: 'Expenses:Utilities', classification: 'Expenses', base_amount: '1000', growth_pct: '0.1',
        target_years: ['2027', '2028'], notes: '',
      });
    });
  });

  describe('generate-all', () => {
    it('forwards the form as a generate-all op, and redirects to op=generate-all&status=ok on success', async () => {
      let captured;
      const env = liveEnv(async (req) => {
        captured = req;
        return new Response(JSON.stringify({ ok: true, generated: 12, savedBy: 'andrew' }), { status: 200 });
      });
      const res = await postForm(env, '/api/v1/connect-budget-generate-all', {
        accessJwt: 'signed.jwt.here',
        body: { base_year: '2026', target_year: '2027', growth_pct: '0.03' },
      });
      expect(res.status).toBe(303);
      const location = new URL(res.headers.get('location'), 'https://finance.test');
      expect(location.searchParams.get('op')).toBe('generate-all');
      expect(location.searchParams.get('status')).toBe('ok');
      const url = new URL(captured.url);
      expect(url.pathname).toBe('/api/contracts/finance-budget-generate-all-v1');
    });

    it('redirects with the refusal reason when Connect declines, and shows it back on the page', async () => {
      const env = liveEnv(async () => new Response(JSON.stringify({ error: 'No Church Budget data found for 2026' }), { status: 400 }));
      const res = await postForm(env, '/api/v1/connect-budget-generate-all', {
        accessJwt: 'signed.jwt.here', body: { base_year: '2026', target_year: '2027', growth_pct: '0.03' },
      });
      const location = new URL(res.headers.get('location'), 'https://finance.test');
      expect(location.searchParams.get('op')).toBe('generate-all');
      expect(location.searchParams.get('status')).toBe('error');
      expect(location.searchParams.get('message')).toBe('No Church Budget data found for 2026');

      const shownEnv = roleEnv('admin', async () => new Response('not found', { status: 404 }));
      const shown = await worker.fetch(new Request(location.toString(), { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), shownEnv);
      const html = await shown.text();
      expect(html).toContain('Not generated: No Church Budget data found for 2026');
    });
  });

  describe('commit', () => {
    it('forwards the form as a commit op, and redirects to op=commit&status=ok on success', async () => {
      let captured;
      const env = liveEnv(async (req) => {
        captured = req;
        return new Response(JSON.stringify({ ok: true, fiscalYear: 2027, committed: 12, savedBy: 'andrew' }), { status: 200 });
      });
      const res = await postForm(env, '/api/v1/connect-budget-commit', { accessJwt: 'signed.jwt.here', body: { fiscal_year: '2027' } });
      expect(res.status).toBe(303);
      const location = new URL(res.headers.get('location'), 'https://finance.test');
      expect(location.searchParams.get('op')).toBe('commit');
      expect(location.searchParams.get('status')).toBe('ok');
      const url = new URL(captured.url);
      expect(url.pathname).toBe('/api/contracts/finance-budget-commit-v1');
    });
  });

  describe('remove', () => {
    it('forwards the form as a remove op, and redirects to op=remove&status=ok on success', async () => {
      let captured;
      const env = liveEnv(async (req) => {
        captured = req;
        return new Response(JSON.stringify({ ok: true, savedBy: 'andrew' }), { status: 200 });
      });
      const res = await postForm(env, '/api/v1/connect-budget-plan-remove', {
        accessJwt: 'signed.jwt.here', body: { category: 'Expenses:Utilities', fiscal_year: '2027' },
      });
      expect(res.status).toBe(303);
      const location = new URL(res.headers.get('location'), 'https://finance.test');
      expect(location.searchParams.get('op')).toBe('remove');
      expect(location.searchParams.get('status')).toBe('ok');
      const url = new URL(captured.url);
      expect(url.pathname).toBe('/api/contracts/finance-budget-remove-v1');
      const sentBody = JSON.parse(await captured.text());
      expect(sentBody).toEqual({ category: 'Expenses:Utilities', fiscal_year: '2027' });
    });

    it('redirects to a not_configured error when the service binding and shared secret are not set', async () => {
      const res = await postForm(baseEnv, '/api/v1/connect-budget-plan-remove', {
        accessJwt: 'whatever', body: { category: 'x', fiscal_year: '2027' },
      });
      expect(res.status).toBe(303);
      const location = new URL(res.headers.get('location'), 'https://finance.test');
      expect(location.searchParams.get('op')).toBe('remove');
      expect(location.searchParams.get('reason')).toBe('not_configured');
    });

    it('redirects with a network_error reason when the relay call itself fails, never throwing', async () => {
      const env = liveEnv(async () => { throw new Error('boom'); });
      const res = await postForm(env, '/api/v1/connect-budget-plan-remove', {
        accessJwt: 'signed.jwt.here', body: { category: 'x', fiscal_year: '2027' },
      });
      expect(res.status).toBe(303);
      const location = new URL(res.headers.get('location'), 'https://finance.test');
      expect(location.searchParams.get('reason')).toBe('network_error');
    });
  });
});
