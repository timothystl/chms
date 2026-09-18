import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';

const baseEnv = { ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha' };

function liveEnv(fetchImpl) {
  return { ...baseEnv, CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

const LIVE_PROPERTY_OPERATING = {
  contract: 'connect.finance-property-operating.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  propertyKey: 'ivanhoe', generatedAt: '2026-09-15T12:00:00Z',
  periods: [{
    period: '2027-01', occupancyPct: 0.9, totalRevenueCents: 1000000, totalExpensesCents: 400000,
    netIncomeCents: 600000, netOperatingIncomeCents: 650000, availableForDistributionCents: 500000,
    reserveBalanceCents: 2500000, loanPaymentCents: 120000, interestExpenseCents: 40000, sourceReport: 'finance-app',
  }],
  annualSummary: [{
    year: 2027, totalRevenueCents: 1000000, totalExpensesCents: 400000, netIncomeCents: 600000,
    avgOccupancyPct: 0.9, confirmedDistributionsCents: 0, expenseMonthsDerived: 0, notes: '',
  }],
};

// Answers both staff-role-v1 (so canManagePropertyMonthly resolves) and
// finance-property-operating-v1 (so Operating results renders live).
function roleEnv(role, writeFetchImpl) {
  return liveEnv(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role }), { status: 200 });
    if (url.pathname === '/api/contracts/finance-property-operating-v1') return new Response(JSON.stringify(LIVE_PROPERTY_OPERATING), { status: 200 });
    return writeFetchImpl(req);
  });
}

const CSV = 'period,total_revenue,operating_expenses,net_operating_income,non_operating_expenses,net_income\n'
  + '2026-06,9765.27,-3505.43,6259.84,-957.05,5302.79\n';

function postForm(env, { accessJwt, body } = {}) {
  const params = new URLSearchParams({ csv: CSV, source_report: 'csv_import', ...body });
  return worker.fetch(new Request('https://finance.test/api/v1/connect-property-monthly-import-csv-write', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(accessJwt !== undefined ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {}),
    },
    body: params.toString(),
  }), env);
}

describe('Commercial Property — bulk monthly-financials CSV import form and relay route', () => {
  it('rejects the wrong method on the write-only route with an Allow header naming only POST', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-property-monthly-import-csv-write'), baseEnv);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('does not show the import form when the viewer role is not verified', async () => {
    const res = await worker.fetch(new Request('https://finance.test/?section=property&page=operating-results'), baseEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-property-monthly-import-csv-write');
  });

  it('does not show the import form for a finance-role viewer -- admin-only, matching the legacy route', async () => {
    const env = roleEnv('finance', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=property&page=operating-results', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-property-monthly-import-csv-write');
  });

  it('shows the import form for a verified admin viewer, alongside the single-month form', async () => {
    const env = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=property&page=operating-results', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).toContain('<form method="POST" action="/api/v1/connect-property-monthly-import-csv-write">');
    expect(html).toContain('name="csv"');
    expect(html).toContain('<form method="POST" action="/api/v1/connect-property-monthly-write">');
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

  it('forwards the Access assertion and the pasted CSV, and redirects to status=ok on success', async () => {
    let captured;
    const env = liveEnv(async (req) => {
      captured = req;
      return new Response(JSON.stringify({ ok: true, imported: 1, periods: ['2026-06'], savedBy: 'andrew' }), { status: 200 });
    });
    const res = await postForm(env, { accessJwt: 'signed.jwt.here' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('section')).toBe('property');
    expect(location.searchParams.get('page')).toBe('operating-results');
    expect(location.searchParams.get('status')).toBe('ok');

    expect(captured.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
    expect(captured.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(captured.url);
    expect(url.pathname).toBe('/api/contracts/finance-property-monthly-import-csv-v1');
    const sentBody = JSON.parse(await captured.text());
    expect(sentBody).toEqual({ csv: CSV, source_report: 'csv_import' });

    const shownEnv = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const shown = await worker.fetch(new Request(location.toString(), { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), shownEnv);
    const html = await shown.text();
    expect(html).toContain('Imported into Connect.');
  });

  it('redirects with the refusal reason when Connect declines the import, and shows it back on the page', async () => {
    const env = liveEnv(async () => new Response(JSON.stringify({ error: 'Access denied: editing property financials requires admin access' }), { status: 403 }));
    const res = await postForm(env, { accessJwt: 'signed.jwt.here' });
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
    const res = await postForm(env, { accessJwt: 'signed.jwt.here' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('network_error');
  });
});
