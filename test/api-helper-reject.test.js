import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { JS_CORE } from '../src/frontend/js-core.js';

// P24-A (retires LOAD9). api() used to resolve instead of reject on a server error whenever
// `opts` was passed — i.e. on every write (POST/PUT/PATCH/DELETE) — so a failed save's
// {error:...} body flowed straight into the caller's `.then(function(d) {...})` success
// handler as though the request had succeeded. This is the mechanism behind the SAC1/SAC3
// "Save failed with no reason" reports. Extracts the real `frontendAppRootPath`/`api` source
// (not a reimplementation) and runs it in a vm with a stubbed fetch, so this test fails against
// the real pre-fix behavior, not a paraphrase of it.

function extractHelpers() {
  const start = JS_CORE.indexOf('// ── HELPERS');
  const end = JS_CORE.indexOf('function openPersonDetail');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return JS_CORE.slice(start, end);
}

function makeSandbox({ hostname = 'connect.timothystl.org', fetchImpl } = {}) {
  const sandbox = {
    location: { hostname, href: '' },
    fetch: fetchImpl,
    console,
    Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(extractHelpers(), sandbox);
  return sandbox;
}

function jsonResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

describe('api() rejects on any non-2xx response, write or read (P24-A)', () => {
  it('rejects a POST (opts passed) whose response is a 403 with an error body', async () => {
    const sandbox = makeSandbox({
      fetchImpl: async () => jsonResponse(403, { error: 'Access denied' }),
    });
    await expect(
      sandbox.api('/admin/api/people/1', { method: 'PUT', body: '{}' })
    ).rejects.toThrow('Access denied');
  });

  it('resolves a POST whose response is 200 (the fix does not just always reject)', async () => {
    const sandbox = makeSandbox({
      fetchImpl: async () => jsonResponse(200, { ok: true, id: 42 }),
    });
    const result = await sandbox.api('/admin/api/people', { method: 'POST', body: '{}' });
    expect(result).toEqual({ ok: true, id: 42 });
  });

  it('still rejects a GET (no opts) on a non-2xx response, as it always did', async () => {
    const sandbox = makeSandbox({
      fetchImpl: async () => jsonResponse(500, { error: 'Server error' }),
    });
    await expect(sandbox.api('/admin/api/people/1')).rejects.toThrow('Server error');
  });

  it('falls back to a status-coded message when the error body carries no error field', async () => {
    const sandbox = makeSandbox({
      fetchImpl: async () => jsonResponse(413, {}),
    });
    await expect(
      sandbox.api('/admin/api/giving/batches', { method: 'POST', body: '{}' })
    ).rejects.toThrow('Request failed (413)');
  });

  it('redirects to the Connect root and rejects with Unauthorized on a 401, regardless of opts', async () => {
    const sandbox = makeSandbox({
      hostname: 'connect.timothystl.org',
      fetchImpl: async () => jsonResponse(401, { error: 'no session' }),
    });
    await expect(
      sandbox.api('/admin/api/people/1', { method: 'DELETE' })
    ).rejects.toThrow('Unauthorized');
    expect(sandbox.location.href).toBe('/');
  });

  it('redirects to /chms (not the bare root) on a non-Connect host', () => {
    const sandbox = makeSandbox({ hostname: 'chms.timothystl.org' });
    expect(sandbox.frontendAppRootPath()).toBe('/chms');
  });
});
