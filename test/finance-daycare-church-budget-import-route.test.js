import { DEFAULT_ROLE_PERMISSIONS } from '../src/api-utils.js';
import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';

const baseEnv = { ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha' };

function liveEnv(fetchImpl) {
  return { ...baseEnv, CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

const LIVE_DAYCARE_REPORT = {
  contract: 'connect.finance-daycare-report.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  fiscalYear: 2027, generatedAt: '2026-09-15T12:00:00Z',
  categories: [
    { category: 'Tuition Income', classification: 'Income', actualCents: 5000000, budgetCents: 4800000 },
    { category: 'Payroll', classification: 'Expenses', actualCents: 3000000, budgetCents: 2900000 },
  ],
  allocation: {
    utilityPct: 0.1, insurancePct: 0.05, churchUtilityActualCents: 1000000, churchInsuranceActualCents: 2000000,
    mdoUtilityCents: 100000, mdoInsuranceCents: 100000,
  },
  totals: { incomeActualCents: 5000000, incomeBudgetCents: 4800000, expenseActualCents: 3000000, expenseBudgetCents: 2900000, netActualCents: 2000000, netBudgetCents: 1900000 },
  reconciliation: { categoryCount: 2, incomeCategoryCount: 1, expenseCategoryCount: 1, totalsMatch: true },
};

// Answers both staff-role-v1 (so canRecordDaycareEntry resolves) and finance-daycare-report-v1
// (so Actuals detail renders live) -- the same two calls a real page load makes.
function roleEnv(role, writeFetchImpl) {
  return liveEnv(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role, permissions: DEFAULT_ROLE_PERMISSIONS[role] }), { status: 200 });
    if (url.pathname === '/api/contracts/finance-daycare-report-v1') return new Response(JSON.stringify(LIVE_DAYCARE_REPORT), { status: 200 });
    return writeFetchImpl(req);
  });
}

function postForm(env, { accessJwt, body } = {}) {
  const params = new URLSearchParams({
    year: '2025',
    ...body,
  });
  return worker.fetch(new Request('https://finance.test/api/v1/connect-daycare-church-budget-import-write', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(accessJwt !== undefined ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {}),
    },
    body: params.toString(),
  }), env);
}

describe('Daycare Report — Church-Budget import form and relay route', () => {
  it('rejects the wrong method on the write-only route with an Allow header naming only POST', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-daycare-church-budget-import-write'), baseEnv);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('does not show the import form when the viewer role is not verified (fail-closed on the write UI)', async () => {
    const res = await worker.fetch(new Request('https://finance.test/?section=daycare&page=actuals'), baseEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-daycare-church-budget-import-write');
  });

  it('shows the import form for any verified role that can reach the Daycare section, e.g. finance', async () => {
    const env = roleEnv('finance', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=daycare&page=actuals', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).toContain('<form method="POST" action="/api/v1/connect-daycare-church-budget-import-write">');
    expect(html).toContain('name="year"');
  });

  it('redirects to a not_configured error when the service binding and shared secret are not set', async () => {
    const res = await postForm(baseEnv, { accessJwt: 'whatever' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.pathname).toBe('/');
    expect(location.searchParams.get('section')).toBe('daycare');
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
      return new Response(JSON.stringify({ ok: true, year: 2025, imported: 2, savedBy: 'andrew' }), { status: 200 });
    });
    const res = await postForm(env, { accessJwt: 'signed.jwt.here' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('section')).toBe('daycare');
    expect(location.searchParams.get('page')).toBe('actuals');
    expect(location.searchParams.get('status')).toBe('ok');

    expect(captured.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
    expect(captured.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(captured.url);
    expect(url.pathname).toBe('/api/contracts/finance-daycare-church-budget-import-write-v1');
    const sentBody = JSON.parse(await captured.text());
    expect(sentBody).toEqual({ year: '2025' });

    const shownEnv = roleEnv('finance', async () => new Response('not found', { status: 404 }));
    const shown = await worker.fetch(new Request(location.toString(), { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), shownEnv);
    const html = await shown.text();
    expect(html).toContain('Imported from the Church Budget in Connect.');
  });

  it('redirects with the refusal reason when Connect declines the import, and shows it back on the page', async () => {
    const env = liveEnv(async () => new Response(JSON.stringify({ error: 'No imported Church Budget found for 2025.' }), { status: 400 }));
    const res = await postForm(env, { accessJwt: 'signed.jwt.here' });
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('http_error');
    expect(location.searchParams.get('message')).toBe('No imported Church Budget found for 2025.');

    const shownEnv = roleEnv('finance', async () => new Response('not found', { status: 404 }));
    const shown = await worker.fetch(new Request(location.toString(), { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), shownEnv);
    const html = await shown.text();
    expect(html).toContain('Not imported: No imported Church Budget found for 2025.');
  });

  it('redirects with a network_error reason when the relay call itself fails, never throwing', async () => {
    const env = liveEnv(async () => { throw new Error('boom'); });
    const res = await postForm(env, { accessJwt: 'signed.jwt.here' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('network_error');
  });
});
