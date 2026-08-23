import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../tlc-volunteer-worker.js';
import { DEPLOY_VERSION } from '../src/frontend/js-core.js';

// P25-B (LOAD7): initDb(env.DB) used to run before ANY route, including a set of pure
// static/proxy asset routes that touch no database at all — a favicon fetch on a cold
// isolate paid a full D1 round trip for nothing. Those routes are now served before
// initDb() runs.
//
// A DB stub that throws on first use proves this directly: if any of these routes still
// called initDb() first, the request would 500 with "DB init error" instead of serving
// the asset.

function throwingDbEnv() {
  const boom = () => { throw new Error('DB touched — should never happen for a pure asset route'); };
  return {
    DB: {
      prepare: boom,
      batch: boom,
    },
  };
}

const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  global.fetch = async () => new Response('fake-upstream-body', { status: 200 });
});
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

const PURE_ASSET_PATHS = [
  '/favicon.svg',
  '/icons/icon-192.png',
  '/admin/vendor/tinymce/tinymce.js',
  '/header-logo.png',
  '/admin/app-member.js',
  '/admin/app-staff.js',
  '/admin/app-ext.js',
  '/admin/app.css',
];

describe('pure asset routes never touch D1 (P25-B)', () => {
  it('serves every pure asset route with a DB stub that throws on any use', async () => {
    for (const p of PURE_ASSET_PATHS) {
      const req = new Request('https://connect.timothystl.org' + p + '?v=' + DEPLOY_VERSION);
      const res = await worker.fetch(req, throwingDbEnv());
      expect(res.status, p).not.toBe(500);
      const body = await res.text();
      expect(body, p).not.toMatch(/DB init error/);
    }
  });

  it('sanity check: a route that does need the DB fails against the same throwing stub', async () => {
    // Proves the harness itself is wired correctly — a route reached only via initDb()
    // really does surface the thrown error, so the pure-asset test above isn't vacuously
    // passing because the stub is inert.
    const req = new Request('https://serve.timothystl.org/');
    const res = await worker.fetch(req, throwingDbEnv());
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toMatch(/DB init error/);
  });
});
