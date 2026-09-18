import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';

const baseEnv = { ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha' };

function liveEnv(fetchImpl) {
  return { ...baseEnv, CONNECT_SERVICE: { fetch: fetchImpl }, FINANCE_CONTRACT_API_KEY: 'test-secret' };
}

// Every name/dollar figure below is entirely fabricated for this test -- never a real production
// value.
const RAW_PLAN = {
  roster: [
    { name: 'Test Worker A', position: 'Fictional Director', accountCode: '', role: 'other', trackKey: '',
      education: 'bachelors', yearsExperience: 3, responsibilityStipend: 0, attendanceBonus: 0,
      selfEmployedFica: false, hasDependents: false, healthEnrolled: true, hideFromCouncil: false,
      actualSalaryCents: 5000000 },
  ],
  compMethod: 'flat',
};

// Answers both staff-role-v1 (so canEditCompensation resolves) and finance-compensation-plan-v1
// (so the Plan page renders the real editor instead of falling back to a synthetic reader) -- the
// same two calls a real page load makes. Any other path (the write itself, or a live report fetch
// this test doesn't care about) goes to `otherFetchImpl`.
function roleEnv(role, otherFetchImpl, { plan = RAW_PLAN } = {}) {
  return liveEnv(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role }), { status: 200 });
    if (url.pathname === '/api/contracts/finance-compensation-plan-v1') return new Response(JSON.stringify({ data: plan }), { status: 200 });
    return otherFetchImpl(req);
  });
}

function postAction(env, { accessJwt, action = 'add', index, body } = {}) {
  const params = new URLSearchParams({
    action, name: 'New Worker', position: 'Youth Director', accountCode: '', role: 'other', trackKey: '',
    education: '', yearsExperience: '0', responsibilityStipend: '0', attendanceBonus: '0', actualSalary: '48000',
    ...(index !== undefined ? { index: String(index) } : {}),
    ...body,
  });
  return worker.fetch(new Request('https://finance.test/api/v1/connect-compensation-plan-write', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(accessJwt !== undefined ? { 'Cf-Access-Jwt-Assertion': accessJwt } : {}),
    },
    body: params.toString(),
  }), env);
}

describe('Finance Compensation Plan — roster editor and relay route', () => {
  it('rejects the wrong method on the write-only route with an Allow header naming only POST', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-compensation-plan-write'), baseEnv);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('does not show the roster editor when the viewer role is not verified', async () => {
    const res = await worker.fetch(new Request('https://finance.test/?section=compensation'), baseEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-compensation-plan-write');
  });

  it('does not show the roster editor for a council viewer -- council keeps its own narrower overlay, not this route', async () => {
    const env = roleEnv('council', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=compensation', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).not.toContain('/api/v1/connect-compensation-plan-write');
  });

  it('shows the roster editor for a verified admin viewer, with the current worker listed', async () => {
    const env = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=compensation', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).toContain('<form method="POST" action="/api/v1/connect-compensation-plan-write">');
    expect(html).toContain('Test Worker A');
    expect(html).toContain('name="name"');
  });

  it('shows the roster editor for a verified compensation-role viewer too', async () => {
    const env = roleEnv('compensation', async () => new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://finance.test/?section=compensation', {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), env);
    const html = await res.text();
    expect(html).toContain('<form method="POST" action="/api/v1/connect-compensation-plan-write">');
  });

  it('redirects to a not_configured error when the service binding and shared secret are not set', async () => {
    const res = await postAction(baseEnv, { accessJwt: 'whatever' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.pathname).toBe('/');
    expect(location.searchParams.get('section')).toBe('compensation');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('not_configured');
  });

  it('redirects to a no_access_identity error when the incoming request carries no Access assertion', async () => {
    const res = await postAction(liveEnv(async () => new Response('{}')), { accessJwt: undefined });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('no_access_identity');
  });

  it('adds a new worker: fetches the current plan, appends the new worker, and resubmits the whole merged plan', async () => {
    let capturedWrite;
    const env = liveEnv(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/contracts/finance-compensation-plan-v1') return new Response(JSON.stringify({ data: RAW_PLAN }), { status: 200 });
      if (url.pathname === '/api/contracts/finance-compensation-write-v1') {
        capturedWrite = req;
        return new Response(JSON.stringify({ ok: true, savedBy: 'andrew' }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url.pathname}`);
    });
    const res = await postAction(env, { accessJwt: 'signed.jwt.here', action: 'add' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('status')).toBe('ok');

    expect(capturedWrite.headers.get('Cf-Access-Jwt-Assertion')).toBe('signed.jwt.here');
    expect(capturedWrite.headers.get('X-Contract-Key')).toBe('test-secret');
    const sentBody = JSON.parse(await capturedWrite.text());
    expect(sentBody.compMethod).toBe('flat');
    expect(sentBody.roster).toHaveLength(2);
    expect(sentBody.roster[0]).toEqual(RAW_PLAN.roster[0]);
    expect(sentBody.roster[1]).toMatchObject({ name: 'New Worker', position: 'Youth Director', actualSalaryCents: 4800000 });
  });

  it('edits an existing worker in place at its index, leaving the rest of the plan untouched', async () => {
    let capturedWrite;
    const env = liveEnv(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/contracts/finance-compensation-plan-v1') return new Response(JSON.stringify({ data: RAW_PLAN }), { status: 200 });
      if (url.pathname === '/api/contracts/finance-compensation-write-v1') {
        capturedWrite = req;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url.pathname}`);
    });
    const res = await postAction(env, {
      accessJwt: 'signed.jwt.here', action: 'edit', index: 0,
      body: { name: 'Test Worker A (renamed)', actualSalary: '52000' },
    });
    expect(res.status).toBe(303);
    const sentBody = JSON.parse(await capturedWrite.text());
    expect(sentBody.roster).toHaveLength(1);
    expect(sentBody.roster[0]).toMatchObject({ name: 'Test Worker A (renamed)', actualSalaryCents: 5200000 });
  });

  it('removes a worker at its index and reindexes the per-worker override maps to match', async () => {
    let capturedWrite;
    const planWithTwo = {
      roster: [RAW_PLAN.roster[0], { ...RAW_PLAN.roster[0], name: 'Test Worker B' }],
      compPerWorkerMethod: { 0: 'scale', 1: 'custom' },
    };
    const env = liveEnv(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/contracts/finance-compensation-plan-v1') return new Response(JSON.stringify({ data: planWithTwo }), { status: 200 });
      if (url.pathname === '/api/contracts/finance-compensation-write-v1') {
        capturedWrite = req;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url.pathname}`);
    });
    const res = await postAction(env, { accessJwt: 'signed.jwt.here', action: 'remove', index: 0 });
    expect(res.status).toBe(303);
    const sentBody = JSON.parse(await capturedWrite.text());
    expect(sentBody.roster).toEqual([{ ...RAW_PLAN.roster[0], name: 'Test Worker B' }]);
    expect(sentBody.compPerWorkerMethod).toEqual({ 0: 'custom' });
  });

  it('redirects with invalid_index when editing/removing an index that does not exist in the current plan', async () => {
    const env = liveEnv(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/contracts/finance-compensation-plan-v1') return new Response(JSON.stringify({ data: RAW_PLAN }), { status: 200 });
      throw new Error('the write endpoint should never be reached');
    });
    const res = await postAction(env, { accessJwt: 'signed.jwt.here', action: 'edit', index: 5 });
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('invalid_index');
  });

  it('redirects to an error when the current-plan fetch itself fails, and never calls the write endpoint', async () => {
    const env = liveEnv(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/contracts/finance-compensation-plan-v1') return new Response(JSON.stringify({ error: 'nope' }), { status: 403 });
      throw new Error('the write endpoint should never be reached');
    });
    const res = await postAction(env, { accessJwt: 'signed.jwt.here' });
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('http_error');
  });

  it('redirects with the refusal reason when Connect declines the write, and shows it back on the page', async () => {
    const env = liveEnv(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/contracts/finance-compensation-plan-v1') return new Response(JSON.stringify({ data: RAW_PLAN }), { status: 200 });
      if (url.pathname === '/api/contracts/finance-compensation-write-v1') {
        return new Response(JSON.stringify({ error: 'Access denied: editing the salary planner requires admin access' }), { status: 403 });
      }
      throw new Error(`Unexpected fetch: ${url.pathname}`);
    });
    const res = await postAction(env, { accessJwt: 'signed.jwt.here' });
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('status')).toBe('error');
    expect(location.searchParams.get('reason')).toBe('http_error');
    expect(location.searchParams.get('message')).toBe('Access denied: editing the salary planner requires admin access');

    const shownEnv = roleEnv('admin', async () => new Response('not found', { status: 404 }));
    const shown = await worker.fetch(new Request(location.toString(), {
      headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt.here' },
    }), shownEnv);
    const html = await shown.text();
    expect(html).toContain('Not saved: Access denied: editing the salary planner requires admin access');
  });

  it('redirects with a network_error reason when the write relay call itself fails, never throwing', async () => {
    const env = liveEnv(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/contracts/finance-compensation-plan-v1') return new Response(JSON.stringify({ data: RAW_PLAN }), { status: 200 });
      throw new Error('boom');
    });
    const res = await postAction(env, { accessJwt: 'signed.jwt.here' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location'), 'https://finance.test');
    expect(location.searchParams.get('reason')).toBe('network_error');
  });
});
