import { describe, it, expect, beforeEach } from 'vitest';
import { SW_JS } from '../src/html-chms.js';

// MOB4. The service worker was installable but effectively inert on the live hostname:
//   - its navigation fallback checked `url.pathname === '/chms'`, the pre-CONN6 path, so on
//     connect.timothystl.org (where the app is served at `/`) it never ran;
//   - nothing ever wrote the shell into a cache, so the `caches.match('/chms')` fallback
//     always missed even at /chms;
//   - STATIC_ASSETS precached only the manifest, leaving ~1.3MB of already-immutable
//     app JS/CSS re-fetched over the network on every launch.
//
// These run the ACTUAL generated worker source (SW_JS after interpolation), not a
// reimplementation, inside a minimal ServiceWorkerGlobalScope stand-in.

const ORIGIN = 'https://connect.timothystl.org';

/** Normalize a Request|string cache key to an absolute URL string. */
const keyOf = (r) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).toString();

function loadWorker({ networkFails = false, respond } = {}) {
  const listeners = {};
  const store = new Map(); // cacheName -> Map(url -> Response)
  const fetchLog = [];

  const openCache = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return {
      addAll: async (urls) => { for (const u of urls) m.set(keyOf(u), new Response('precached')); },
      put: async (req, resp) => { m.set(keyOf(req), resp); },
      match: async (req) => m.get(keyOf(req)),
    };
  };

  const caches = {
    open: async (name) => openCache(name),
    keys: async () => [...store.keys()],
    delete: async (name) => store.delete(name),
    match: async (req) => {
      for (const m of store.values()) {
        const hit = m.get(keyOf(req));
        if (hit) return hit;
      }
      return undefined;
    },
  };

  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
    location: { origin: ORIGIN },
  };

  const fakeFetch = async (req) => {
    fetchLog.push(keyOf(req));
    if (networkFails) throw new TypeError('Failed to fetch');
    return respond ? respond(keyOf(req)) : new Response('from-network', { status: 200 });
  };

  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Response', 'Headers', 'URL', SW_JS)(
    self, caches, fakeFetch, Response, Headers, URL
  );

  const fire = async (type, event) => {
    let held;
    const ev = {
      ...event,
      respondWith: (p) => { held = p; },
      waitUntil: (p) => { held = p; },
    };
    await listeners[type](ev);
    return held;
  };

  const request = (path, method = 'GET') =>
    new Request(new URL(path, ORIGIN).toString(), { method });

  return { fire, request, caches, store, fetchLog, listeners };
}

describe('service worker — app shell', () => {
  it('handles the root path, which is where the app actually lives on Connect', async () => {
    const sw = loadWorker();
    const res = await sw.fire('fetch', { request: sw.request('/') });
    expect(res).toBeDefined(); // undefined would mean it fell through, unhandled
    expect(await (await res).text()).toBe('from-network');
  });

  it('still handles /chms, for staging and any non-Connect host', async () => {
    const sw = loadWorker();
    const res = await sw.fire('fetch', { request: sw.request('/chms') });
    expect(res).toBeDefined();
  });

  it('caches the shell on a successful load, so the fallback has something to find', async () => {
    const sw = loadWorker();
    await (await sw.fire('fetch', { request: sw.request('/') }));
    await new Promise((r) => setTimeout(r, 0)); // cache.put is fire-and-forget
    expect(await sw.caches.match('/')).toBeDefined();
  });

  it('serves the cached shell when the network is gone', async () => {
    const online = loadWorker();
    await (await online.fire('fetch', { request: online.request('/') }));
    await new Promise((r) => setTimeout(r, 0));
    const warmed = online.store;

    const offline = loadWorker({ networkFails: true });
    for (const [k, v] of warmed) offline.store.set(k, v); // same device, now offline
    const res = await (await offline.fire('fetch', { request: offline.request('/') }));
    expect(await res.text()).toBe('from-network'); // i.e. the previously cached copy
  });

  it('shows a real offline page rather than a browser error on a cold first launch', async () => {
    const sw = loadWorker({ networkFails: true });
    const res = await (await sw.fire('fetch', { request: sw.request('/') }));
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('Offline');
  });

  it('does not cache a failed shell response', async () => {
    const sw = loadWorker({ respond: () => new Response('nope', { status: 500 }) });
    await (await sw.fire('fetch', { request: sw.request('/') }));
    await new Promise((r) => setTimeout(r, 0));
    expect(await sw.caches.match('/')).toBeUndefined();
  });
});

describe('service worker — immutable versioned assets', () => {
  const ASSETS = ['/admin/app-core.js', '/admin/app-ext.js', '/admin/app.css'];

  it('caches each on first fetch and serves from cache thereafter', async () => {
    for (const path of ASSETS) {
      const sw = loadWorker();
      const url = path + '?v=1.119.0';
      await (await sw.fire('fetch', { request: sw.request(url) }));
      await new Promise((r) => setTimeout(r, 0));
      expect(sw.fetchLog.length).toBe(1);

      await (await sw.fire('fetch', { request: sw.request(url) }));
      // Second request must be served from cache — no additional network hit. This is the
      // ~1.3MB that previously came down on every single launch.
      expect(sw.fetchLog.length).toBe(1);
    }
  });

  it('treats a different ?v= as a different asset, so a deploy is picked up', async () => {
    const sw = loadWorker();
    await (await sw.fire('fetch', { request: sw.request('/admin/app-core.js?v=1.119.0') }));
    await new Promise((r) => setTimeout(r, 0));
    await (await sw.fire('fetch', { request: sw.request('/admin/app-core.js?v=1.120.0') }));
    expect(sw.fetchLog.length).toBe(2);
  });
});

describe('service worker — lifecycle and scope', () => {
  it('evicts caches from previous deploys on activate', async () => {
    const sw = loadWorker();
    sw.store.set('chms-static-1.118.0', new Map());
    sw.store.set('chms-api-v1', new Map());
    await sw.fire('install', {});
    await sw.fire('activate', {});
    await new Promise((r) => setTimeout(r, 0));
    const names = await sw.caches.keys();
    expect(names).not.toContain('chms-static-1.118.0');
    expect(names).toContain('chms-api-v1'); // API cache is not version-scoped
  });

  it('versions its static cache by the current DEPLOY_VERSION', async () => {
    const sw = loadWorker();
    await sw.fire('install', {});
    await new Promise((r) => setTimeout(r, 0));
    expect((await sw.caches.keys()).some((k) => /^chms-static-\d+\.\d+\.\d+$/.test(k))).toBe(true);
  });

  it('ignores cross-origin requests entirely', async () => {
    const sw = loadWorker();
    const res = await sw.fire('fetch', {
      request: new Request('https://fonts.gstatic.com/x.woff2'),
    });
    expect(res).toBeUndefined();
  });

  it('never intercepts a non-GET request', async () => {
    const sw = loadWorker();
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(await sw.fire('fetch', { request: sw.request('/admin/api/people', m) })).toBeUndefined();
    }
  });
});

describe('service worker — offline people list (pre-existing behavior preserved)', () => {
  it('flags a cached people response so the UI can show the offline banner', async () => {
    const online = loadWorker({ respond: () => new Response('{"people":[]}', { status: 200 }) });
    await (await online.fire('fetch', { request: online.request('/admin/api/people') }));
    await new Promise((r) => setTimeout(r, 0));

    const offline = loadWorker({ networkFails: true });
    for (const [k, v] of online.store) offline.store.set(k, v);
    const res = await (await offline.fire('fetch', { request: offline.request('/admin/api/people') }));
    expect(res.headers.get('X-From-Cache')).toBe('true');
  });

  it('returns the offline sentinel when nothing is cached', async () => {
    const sw = loadWorker({ networkFails: true });
    const res = await (await sw.fire('fetch', { request: sw.request('/admin/api/people') }));
    expect(res.status).toBe(503);
    expect(JSON.parse(await res.text()).offline).toBe(true);
  });
});
