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
    { classification: 'Expenses', categoryPath: 'Expenses:60000 Programs', accountName: '60000 Programs', depth: 0, hasChildren: false, boardCategoryKey: 'programs', boardCategoryLabel: 'Programs', purposeTagId: 'youth', purposeTagLabel: 'Youth' },
    { classification: 'Expenses', categoryPath: 'Expenses:60010 Missions', accountName: '60010 Missions', depth: 0, hasChildren: false, boardCategoryKey: 'unassigned', boardCategoryLabel: 'Unassigned', purposeTagId: null, purposeTagLabel: null },
  ],
  reconciliation: { accountCount: 2, incomeCount: 0, expenseCount: 2, unassignedCount: 1 },
};

// Answers both staff-role-v1 (so canManagePurposeTags resolves) and finance-chart-of-accounts-v1
// (so the page renders live, including the current tag list derived from it) -- the same two calls
// a real page load makes.
function roleEnv(role, writeFetchImpl) {
  return liveEnv(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role }), { status: 200 });
    if (url.pathname === '/api/contracts/finance-chart-of-accounts-v1') return new Response(JSON.stringify(LIVE_CHART_OF_ACCOUNTS), { status: 200 });
    return writeFetchImpl(req);
  });
}

function postTagListForm(env, { accessJwt, body } = {}) {
  const params = new URLSearchParams({ tags: 'youth,Youth\n,Missions', ...body });
  return worker.fetch(new Request('https://finance.test/api/v1/connect-purpose-tags-write', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(accessJwt !== undefined ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {}),
    },
    body: params.toString(),
  }), env);
}

function postAssignForm(env, { accessJwt, body } = {}) {
  const params = new URLSearchParams({ category_path: 'Expenses:60010 Missions', purpose_tag_id: 'youth', ...body });
  return worker.fetch(new Request('https://finance.test/api/v1/connect-purpose-tags-write', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(accessJwt !== undefined ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {}),
    },
    body: params.toString(),
  }), env);
}

describe('Chart of Accounts — purpose-tag forms and relay route', () => {
  it('rejects the wrong method on the write-only route with an Allow header naming only POST', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-purpose-tags-write'), baseEnv);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('does not show either purpose-tag form when the viewer role is not verified', async () => {
    const res = await worker.fetch(new Request('https://finance.test/?section=accounts'), baseEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-purpose-tags-write');
  });

  it('does not show either purpose-tag form for a finance-role viewer -- admin-only', async () => {
    const env = roleEnv('finance', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=accounts', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-purpose-tags-write');
  });

  it('shows both purpose-tag forms for a verified admin viewer, the tag list prefilled from the current accounts', async () => {
    const env = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=accounts', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect((html.match(/action="\/api\/v1\/connect-purpose-tags-write"/g) || []).length).toBe(2);
    expect(html).toContain('name="tags"');
    expect(html).toContain('youth,Youth');
    expect(html).toContain('name="category_path"');
    expect(html).toContain('name="purpose_tag_id"');
    expect(html).toContain('<option value="youth">Youth</option>');
  });

  it('redirects to a not_configured error when the service binding and shared secret are not set', async () => {
    const res = await postTagListForm(baseEnv, { accessJwt: 'whatever' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.pathname).toBe('/');
    expect(location.searchParams.get('section')).toBe('accounts');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('not_configured');
  });

  it('redirects to a no_access_identity error when the incoming request carries no Access assertion', async () => {
    const res = await postTagListForm(liveEnv(async () => new Response('{}')), { accessJwt: undefined });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('no_access_identity');
  });

  it('parses the tag-list textarea into a full tags array, minting no id for a blank-id line', async () => {
    let captured;
    const env = liveEnv(async (req) => {
      captured = req;
      return new Response(JSON.stringify({ ok: true, tags: [], categories: {}, savedBy: 'andrew' }), { status: 200 });
    });
    const res = await postTagListForm(env, { accessJwt: 'signed.jwt.here' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('status')).toBe('ok');

    const url = new URL(captured.url);
    expect(url.pathname).toBe('/api/contracts/finance-purpose-tags-write-v1');
    const sentBody = JSON.parse(await captured.text());
    expect(sentBody).toEqual({ tags: [{ id: 'youth', label: 'Youth' }, { label: 'Missions' }] });
  });

  it('sends only categories, never tags, from the assignment form -- a merge, not a full replace', async () => {
    let captured;
    const env = liveEnv(async (req) => {
      captured = req;
      return new Response(JSON.stringify({ ok: true, tags: [], categories: {} }), { status: 200 });
    });
    const res = await postAssignForm(env, { accessJwt: 'signed.jwt.here' });
    expect(res.status).toBe(303);
    const sentBody = JSON.parse(await captured.text());
    expect(sentBody).toEqual({ categories: { 'Expenses:60010 Missions': 'youth' } });
    expect(sentBody.tags).toBeUndefined();
  });

  it('clears an assignment when no tag is selected', async () => {
    let captured;
    const env = liveEnv(async (req) => {
      captured = req;
      return new Response(JSON.stringify({ ok: true, tags: [], categories: {} }), { status: 200 });
    });
    await postAssignForm(env, { accessJwt: 'signed.jwt.here', body: { purpose_tag_id: '' } });
    const sentBody = JSON.parse(await captured.text());
    expect(sentBody).toEqual({ categories: { 'Expenses:60010 Missions': '' } });
  });

  it('redirects with the refusal reason when Connect declines the edit, and shows it back on the page', async () => {
    const env = liveEnv(async () => new Response(JSON.stringify({ error: 'Access denied: editing purpose tags requires admin access' }), { status: 403 }));
    const res = await postTagListForm(env, { accessJwt: 'signed.jwt.here' });
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('http_error');
    expect(location.searchParams.get('message')).toBe('Access denied: editing purpose tags requires admin access');

    const shownEnv = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const shown = await worker.fetch(new Request(location.toString(), { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' } }), shownEnv);
    const html = await shown.text();
    expect(html).toContain('Not saved: Access denied: editing purpose tags requires admin access');
  });

  it('redirects with a network_error reason when the relay call itself fails, never throwing', async () => {
    const env = liveEnv(async () => { throw new Error('boom'); });
    const res = await postTagListForm(env, { accessJwt: 'signed.jwt.here' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('network_error');
  });
});
