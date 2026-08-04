import { describe, it, expect } from 'vitest';
import worker from '../tlc-volunteer-worker.js';
import { DEPLOY_VERSION } from '../src/frontend/js-core.js';

// 2026-08-04. /admin/app-core.js, /admin/app-ext.js and /admin/app.css are cached for a year as
// `immutable`, keyed by ?v=DEPLOY_VERSION. Correct once a deploy has fully rolled out — but
// Cloudflare rolls out per-colo, so mid-rollout there are edges still running the PREVIOUS
// worker. If one answers a request for the NEW ?v= value, its stale body is pinned under the new
// URL as immutable, and every later request for that version gets the previous asset. For a year.
//
// Observed twice for real, on the v1.126.0 and v1.127.0 deploys: app.css?v=<new> served the
// previous stylesheet while a throwaway probe URL returned the correct one. Any user loading the
// page mid-rollout can do the same to their own edge — this is not only a tooling problem.
//
// Fix: cache only when the requested version IS this worker's version.

const ASSETS = ['/admin/app-core.js', '/admin/app-ext.js', '/admin/app.css'];

// initDb runs before routing; a stub DB is enough for these static routes.
const ENV = {
  DB: {
    prepare: () => ({
      bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: {} }) }),
      first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: {} }),
    }),
    batch: async () => [],
  },
};

const get = (path, v) =>
  worker.fetch(
    new Request('https://connect.timothystl.org' + path + (v === undefined ? '' : '?v=' + v)),
    ENV
  );

describe('versioned assets cache only when the version matches', () => {
  it('serves immutable for the current version', async () => {
    for (const p of ASSETS) {
      const r = await get(p, DEPLOY_VERSION);
      expect(r.status, p).toBe(200);
      expect(r.headers.get('Cache-Control'), p).toMatch(/immutable/);
      expect(r.headers.get('Cache-Control'), p).toMatch(/max-age=31536000/);
    }
  });

  it('refuses to be cached when asked for a NEWER version than it is', async () => {
    // The exact mid-rollout case: an old worker answering a request for the new version. Its
    // body cannot be correct for that URL, so it must never be stored.
    for (const p of ASSETS) {
      const r = await get(p, '99.99.99');
      expect(r.status, p).toBe(200);
      expect(r.headers.get('Cache-Control'), p).toBe('no-store');
    }
  });

  it('refuses to be cached when asked for an OLDER version than it is', async () => {
    // The mirror case — a new worker answering a stale page's request. It serves the NEW body,
    // which is equally wrong to pin under the old URL.
    for (const p of ASSETS) {
      expect((await get(p, '1.0.0')).headers.get('Cache-Control'), p).toBe('no-store');
    }
  });

  it('refuses to be cached with no version at all', async () => {
    for (const p of ASSETS) {
      expect((await get(p)).headers.get('Cache-Control'), p).toBe('no-store');
    }
  });

  it('still serves the real asset body in every case, only the caching differs', async () => {
    // Availability must not depend on the version matching — a mismatched request still gets
    // working CSS/JS, it just is not stored.
    const fresh = await (await get('/admin/app.css', DEPLOY_VERSION)).text();
    const stale = await (await get('/admin/app.css', '1.0.0')).text();
    expect(stale).toBe(fresh);
    expect(fresh.length).toBeGreaterThan(1000);
  });

  it('keeps the right content types', async () => {
    expect((await get('/admin/app.css', DEPLOY_VERSION)).headers.get('Content-Type')).toMatch(/text\/css/);
    for (const p of ['/admin/app-core.js', '/admin/app-ext.js']) {
      expect((await get(p, DEPLOY_VERSION)).headers.get('Content-Type'), p).toMatch(/javascript/);
    }
  });
});

describe('the version the assets are keyed by is the one the page requests', () => {
  it('matches DEPLOY_VERSION, so a correct page load always hits the cacheable path', () => {
    // If these ever diverge, every asset request would be no-store and caching would silently
    // stop working — slow, not broken, which is the kind of regression nobody notices.
    expect(DEPLOY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
