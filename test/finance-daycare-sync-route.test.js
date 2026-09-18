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

// Answers both staff-role-v1 (so canSyncDaycare resolves) and finance-daycare-report-v1
// (so Overview renders live) -- the same two calls a real page load makes.
function roleEnv(role, writeFetchImpl) {
  return liveEnv(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role }), { status: 200 });
    if (url.pathname === '/api/contracts/finance-daycare-report-v1') return new Response(JSON.stringify(LIVE_DAYCARE_REPORT), { status: 200 });
    return writeFetchImpl(req);
  });
}

function postForm(env, { accessJwt } = {}) {
  return worker.fetch(new Request('https://finance.test/api/v1/connect-daycare-sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(accessJwt !== undefined ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {}),
    },
    body: '',
  }), env);
}

describe('Daycare Report — "Sync now" (money) form and relay route', () => {
  it('rejects the wrong method on the write-only route with an Allow header naming only POST', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-daycare-sync'), baseEnv);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('does not show the sync form when the viewer role is not verified (fail-closed on the write UI)', async () => {
    const res = await worker.fetch(new Request('https://finance.test/?section=daycare'), baseEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-daycare-sync');
  });

  it('shows the sync form for any verified role that can reach the Daycare section, e.g. finance', async () => {
    const env = roleEnv('finance', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=daycare', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).toContain('<form method="POST" action="/api/v1/connect-daycare-sync">');
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

  it('forwards the Access assertion and redirects to status=ok on success', async () => {
    let captured;
    const env = liveEnv(async (req) => {
      captured = req;
      return new Response(JSON.stringify({ ok: true, syncedAt: '2026-09-18T00:00:00Z', imported: 4, periods: ['2027-01'], savedBy: 'andrew' }), { status: 200 });
    });
    const res = await postForm(env, { accessJwt: 'signed.jwt.here' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('section')).toBe('daycare');
    expect(location.searchParams.get('status')).toBe('ok');
    expect(location.searchParams.get('op')).toBeNull();

    expect(captured.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
    expect(captured.headers.get('X-Contract-Key')).toBe('test-secret');
    const url = new URL(captured.url);
    expect(url.pathname).toBe('/api/contracts/finance-daycare-sync-v1');

    const shownEnv = roleEnv('finance', async () => new Response('not found', { status: 404 }));
    const shown = await worker.fetch(new Request(location.toString(), { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), shownEnv);
    const html = await shown.text();
    expect(html).toContain('Synced in Connect.');
  });

  // The legacy finance/daycare/sync route itself surfaces "not configured" as an ordinary error
  // when the daycare app's own env vars aren't set on Connect's side -- this relay must show that
  // exact message rather than reword it into a generic relay failure.
  it('redirects with the refusal reason when Connect declines the sync (e.g. the daycare app is not configured there), and shows it back on the page', async () => {
    const env = liveEnv(async () => new Response(JSON.stringify({ error: 'The daycare app is not configured. Add DAYCARE_API_URL and DAYCARE_API_KEY (see SECRETS.md).' }), { status: 503 }));
    const res = await postForm(env, { accessJwt: 'signed.jwt.here' });
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('http_error');
    expect(location.searchParams.get('message')).toBe('The daycare app is not configured. Add DAYCARE_API_URL and DAYCARE_API_KEY (see SECRETS.md).');

    const shownEnv = roleEnv('finance', async () => new Response('not found', { status: 404 }));
    const shown = await worker.fetch(new Request(location.toString(), { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), shownEnv);
    const html = await shown.text();
    expect(html).toContain('Not synced: The daycare app is not configured. Add DAYCARE_API_URL and DAYCARE_API_KEY (see SECRETS.md).');
  });

  it('redirects with a network_error reason when the relay call itself fails, never throwing', async () => {
    const env = liveEnv(async () => { throw new Error('boom'); });
    const res = await postForm(env, { accessJwt: 'signed.jwt.here' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('network_error');
  });
});
