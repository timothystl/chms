import { describe, it, expect } from 'vitest';
import worker from '../tlc-volunteer-worker.js';
import { DEPLOY_VERSION } from '../src/frontend/js-core.js';
import { PUBLIC_HTML, PUBLIC_APP_CSS, PUBLIC_APP_JS } from '../src/html-templates.js';

// P25-G (LOAD6): serve.timothystl.org's PUBLIC_HTML inlined ~57 KB of CSS and ~80 KB of
// JS with no Cache-Control at all, identical for every visitor, re-downloaded whole on
// every page view of the church's public front door. Both are now pulled out into their
// own ?v=DEPLOY_VERSION immutable routes, same pattern as /admin/app.css and
// /admin/app-*.js (CR1).

// initDb runs before routing for these two new routes' non-cacheable branch (they're
// hoisted above it same as P25-B, but a stub DB costs nothing either way here).
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
    new Request('https://serve.timothystl.org' + path + (v === undefined ? '' : '?v=' + v)),
    ENV
  );

describe('PUBLIC_HTML no longer inlines the big CSS/JS blocks', () => {
  it('is dramatically smaller than before the split', () => {
    // Was ~204.5 KB (CR10's measurement); should now be roughly PUBLIC_APP_CSS/JS smaller.
    expect(PUBLIC_HTML.length).toBeLessThan(100_000);
    expect(PUBLIC_HTML).not.toContain('<style>');
    expect(PUBLIC_HTML).not.toMatch(/<script>[\s\S]{1000,}/); // no large inline script left
  });

  it('references the two new external routes with the deploy version', () => {
    expect(PUBLIC_HTML).toContain('<link rel="stylesheet" href="/serve-app.css?v=' + DEPLOY_VERSION + '">');
    expect(PUBLIC_HTML).toContain('<script src="/serve-app.js?v=' + DEPLOY_VERSION + '"></script>');
  });

  it('PUBLIC_APP_CSS/JS hold real, substantial content', () => {
    expect(PUBLIC_APP_CSS.length).toBeGreaterThan(20_000);
    expect(PUBLIC_APP_JS.length).toBeGreaterThan(20_000);
  });
});

describe('/serve-app.css and /serve-app.js follow the same cache policy as the admin assets', () => {
  it('serves immutable for the current version', async () => {
    for (const p of ['/serve-app.css', '/serve-app.js']) {
      const r = await get(p, DEPLOY_VERSION);
      expect(r.status, p).toBe(200);
      expect(r.headers.get('Cache-Control'), p).toBe('public, max-age=31536000, immutable');
    }
  });

  it('refuses to be cached with no version or a mismatched version', async () => {
    for (const p of ['/serve-app.css', '/serve-app.js']) {
      expect((await get(p)).headers.get('Cache-Control'), p).toBe('no-store');
      expect((await get(p, '99.99.99')).headers.get('Cache-Control'), p).toBe('no-store');
    }
  });

  it('still serves the real body in every case, only the caching differs', async () => {
    const css = await (await get('/serve-app.css', DEPLOY_VERSION)).text();
    expect(css).toBe(PUBLIC_APP_CSS);
    const js = await (await get('/serve-app.js', DEPLOY_VERSION)).text();
    expect(js).toBe(PUBLIC_APP_JS);
  });

  it('keeps the right content types', async () => {
    expect((await get('/serve-app.css', DEPLOY_VERSION)).headers.get('Content-Type')).toMatch(/text\/css/);
    expect((await get('/serve-app.js', DEPLOY_VERSION)).headers.get('Content-Type')).toMatch(/javascript/);
  });
});
