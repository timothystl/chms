import { describe, it, expect, beforeEach } from 'vitest';
import vm from 'node:vm';
import { SW_JS, CHMS_APP_MEMBER_JS } from '../src/html-chms.js';

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
      // Real Cache Storage hands back a fresh Response every time. Returning the stored object
      // itself meant a second read of the same entry saw an already-consumed body — which is a
      // bug in this fake, not in the worker.
      match: async (req) => { const r = m.get(keyOf(req)); return r ? r.clone() : undefined; },
    };
  };

  const caches = {
    open: async (name) => openCache(name),
    keys: async () => [...store.keys()],
    delete: async (name) => store.delete(name),
    match: async (req) => {
      for (const m of store.values()) {
        const hit = m.get(keyOf(req));
        if (hit) return hit.clone();
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

  // respondWith and waitUntil are tracked separately: P22-D's sign-out handler deliberately
  // uses waitUntil ALONE, so that the navigation itself is never intercepted. A harness that
  // collapsed the two could not tell that apart from intercepting it.
  const last = { responded: undefined, waited: [] };
  const fire = async (type, event) => {
    let responded;
    const waited = [];
    const ev = {
      ...event,
      respondWith: (p) => { responded = p; },
      waitUntil: (p) => { waited.push(p); },
    };
    await listeners[type](ev);
    last.responded = responded;
    last.waited = waited;
    if (responded !== undefined) return responded;
    return waited.length ? Promise.all(waited) : undefined;
  };

  const request = (path, method = 'GET') =>
    new Request(new URL(path, ORIGIN).toString(), { method });

  return { fire, request, caches, store, fetchLog, listeners, last };
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
    // P22-D: keyed by role now, not by the bare '/'. Nothing has told the worker a role
    // yet in this test, so it lands under the explicit 'unknown' bucket.
    expect(await sw.caches.match('/__chms/shell/unknown')).toBeDefined();
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
    expect(await sw.caches.match('/__chms/shell/unknown')).toBeUndefined();
  });
});

describe('service worker — immutable versioned assets', () => {
  const ASSETS = ['/admin/app-member.js', '/admin/app-staff.js', '/admin/app-ext.js', '/admin/app.css'];

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
    await (await sw.fire('fetch', { request: sw.request('/admin/app-member.js?v=1.119.0') }));
    await new Promise((r) => setTimeout(r, 0));
    await (await sw.fire('fetch', { request: sw.request('/admin/app-member.js?v=1.120.0') }));
    expect(sw.fetchLog.length).toBe(2);
  });
});

describe('service worker — lifecycle and scope', () => {
  it('evicts caches from previous deploys on activate', async () => {
    const sw = loadWorker();
    sw.store.set('chms-static-1.118.0', new Map());
    sw.store.set('chms-api-1.118.0', new Map());
    sw.store.set('chms-api-v1', new Map()); // the pre-P22-D unversioned name
    await sw.fire('install', {});
    await sw.fire('activate', {});
    await new Promise((r) => setTimeout(r, 0));
    const names = await sw.caches.keys();
    expect(names).not.toContain('chms-static-1.118.0');
    // SEC19/P22-D: the API cache holds the directory — names, emails, phones, addresses — and
    // used to be deliberately exempt from this eviction under a fixed 'chms-api-v1' name, so it
    // outlived every deploy. Both the old fixed name and a prior deploy's copy must go now.
    expect(names).not.toContain('chms-api-v1');
    expect(names).not.toContain('chms-api-1.118.0');
  });

  it('versions the API cache by DEPLOY_VERSION, like the static one', async () => {
    const sw = loadWorker({ respond: () => new Response('{"people":[]}', { status: 200 }) });
    await (await sw.fire('fetch', { request: sw.request('/admin/api/people') }));
    await new Promise((r) => setTimeout(r, 0));
    const apiNames = (await sw.caches.keys()).filter((k) => k.startsWith('chms-api-'));
    expect(apiNames).toHaveLength(1);
    expect(apiNames[0]).toMatch(/^chms-api-\d+\.\d+\.\d+$/);
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

// ── P22-D / SEC19 ────────────────────────────────────────────────────────────────────────────
// Two separate problems, both about cached data outliving the session that fetched it:
//   1. /admin/api/people responses (the whole directory) were written to a cache that was
//      never versioned and never purged by anything — not by a deploy, not by signing out.
//   2. The shell was cached under the bare key '/', with a comment saying it "interpolates
//      nothing per-user". CR9 made that false: chmsHtmlForRole() emits one script tag for a
//      member and three for everyone else.
// These drive the real generated worker, same as every test above.

const warmPeople = async (sw) => {
  await (await sw.fire('fetch', { request: sw.request('/admin/api/people') }));
  await new Promise((r) => setTimeout(r, 0));
};

describe('service worker — sign-out purges cached data (SEC19)', () => {
  it('deletes every chms cache when the user signs out', async () => {
    const sw = loadWorker({ respond: () => new Response('{"people":[{"last_name":"Dinger"}]}', { status: 200 }) });
    await warmPeople(sw);
    await (await sw.fire('fetch', { request: sw.request('/') }));
    await new Promise((r) => setTimeout(r, 0));
    expect((await sw.caches.keys()).length).toBeGreaterThan(0);

    await sw.fire('fetch', { request: sw.request('/admin/logout') });
    expect((await sw.caches.keys()).filter((k) => k.startsWith('chms-'))).toHaveLength(0);
    // and the directory is genuinely gone, not merely unreachable by name
    expect(await sw.caches.match('/admin/api/people')).toBeUndefined();
  });

  it('does not intercept the sign-out navigation itself', async () => {
    // The purge must never be able to break signing out. waitUntil only — no respondWith, so
    // the browser handles the 302 exactly as it would with no worker installed.
    const sw = loadWorker();
    await sw.fire('fetch', { request: sw.request('/admin/logout') });
    expect(sw.last.responded).toBeUndefined();
    expect(sw.last.waited.length).toBe(1);
    expect(sw.fetchLog).toHaveLength(0);
  });

  it('leaves caches belonging to anything else on the origin alone', async () => {
    const sw = loadWorker();
    sw.store.set('some-other-app-v3', new Map());
    await sw.fire('fetch', { request: sw.request('/admin/logout') });
    expect(await sw.caches.keys()).toContain('some-other-app-v3');
  });

  it('purges when the session expires without a sign-out click', async () => {
    // The shared-office case: nobody signs out, the tab just sits there until the cookie dies.
    // A 401 from the API is the first moment the worker can know the session ended.
    const sw = loadWorker({ respond: () => new Response('{"people":[]}', { status: 200 }) });
    await warmPeople(sw);
    expect(await sw.caches.match('/admin/api/people')).toBeDefined();

    const expired = loadWorker({ respond: () => new Response('{"error":"Unauthorized"}', { status: 401 }) });
    for (const [k, v] of sw.store) expired.store.set(k, v);
    await (await expired.fire('fetch', { request: expired.request('/admin/api/people') }));
    await new Promise((r) => setTimeout(r, 0));
    expect((await expired.caches.keys()).filter((k) => k.startsWith('chms-'))).toHaveLength(0);
  });

  it('purges on an explicit message from the page', async () => {
    const sw = loadWorker({ respond: () => new Response('{"people":[]}', { status: 200 }) });
    await warmPeople(sw);
    await sw.fire('message', { data: { type: 'chms-logout' } });
    expect((await sw.caches.keys()).filter((k) => k.startsWith('chms-'))).toHaveLength(0);
  });
});

describe('service worker — the cached shell is keyed by role (SEC19)', () => {
  const tellRole = async (sw, role) => {
    await sw.fire('message', { data: { type: 'chms-role', role } });
  };

  it('caches the shell under whichever role the page reported', async () => {
    const sw = loadWorker();
    await tellRole(sw, 'staff');
    await (await sw.fire('fetch', { request: sw.request('/') }));
    await new Promise((r) => setTimeout(r, 0));
    expect(await sw.caches.match('/__chms/shell/staff')).toBeDefined();
    expect(await sw.caches.match('/__chms/shell/member')).toBeUndefined();
    expect(await sw.caches.match('/')).toBeUndefined();
  });

  it('never serves one role the shell that was cached for another', async () => {
    // A staff member used this browser, then a member signs in on the same device and goes
    // offline. Before P22-D the member's relaunch got the staff shell — three script tags,
    // including the whole Finance workspace.
    const staff = loadWorker({ respond: () => new Response('STAFF SHELL', { status: 200 }) });
    await tellRole(staff, 'staff');
    await (await staff.fire('fetch', { request: staff.request('/') }));
    await new Promise((r) => setTimeout(r, 0));

    const offline = loadWorker({ networkFails: true });
    for (const [k, v] of staff.store) offline.store.set(k, v);
    await tellRole(offline, 'member');
    const res = await (await offline.fire('fetch', { request: offline.request('/') }));
    const body = await res.text();
    expect(body).not.toContain('STAFF SHELL');
    expect(res.status).toBe(503);
    expect(body).toContain('Offline');
  });

  it('serves the cached shell back to the same role offline', async () => {
    const online = loadWorker({ respond: () => new Response('MEMBER SHELL', { status: 200 }) });
    await tellRole(online, 'member');
    await (await online.fire('fetch', { request: online.request('/') }));
    await new Promise((r) => setTimeout(r, 0));

    const offline = loadWorker({ networkFails: true });
    for (const [k, v] of online.store) offline.store.set(k, v);
    const res = await (await offline.fire('fetch', { request: offline.request('/') }));
    expect(await res.text()).toBe('MEMBER SHELL'); // marker rode along in the same cache
  });

  it('sanitizes the role before it reaches a cache key', async () => {
    // Any page on this origin can postMessage. The value is concatenated into a key, so it is
    // stripped to letters rather than trusted.
    const sw = loadWorker();
    await tellRole(sw, '../../admin?x=1');
    await (await sw.fire('fetch', { request: sw.request('/') }));
    await new Promise((r) => setTimeout(r, 0));
    const keys = [...sw.store.values()].flatMap((m) => [...m.keys()]);
    expect(keys.some((k) => k.includes('..'))).toBe(false);
    expect(keys.some((k) => k.endsWith('/__chms/shell/adminx'))).toBe(true);
  });

  it('falls back to a named bucket when no role has been reported', async () => {
    const sw = loadWorker();
    await tellRole(sw, '');
    await (await sw.fire('fetch', { request: sw.request('/') }));
    await new Promise((r) => setTimeout(r, 0));
    expect(await sw.caches.match('/__chms/shell/unknown')).toBeDefined();
  });
});

// The role-keyed shell above is only worth anything if the page actually names its role. This
// runs the REAL shipped member bundle and calls the REAL applyRoleUI, because a keying scheme
// whose one input is never sent is indistinguishable from no keying at all.
describe('app bundle — tells the service worker which role it is (P22-D)', () => {
  const el = () => {
    const e = { style: {}, textContent: '', _c: new Set(), appendChild: (x) => x, setAttribute() {} };
    e.classList = {
      add: (...c) => c.forEach((x) => e._c.add(x)),
      remove: (...c) => c.forEach((x) => e._c.delete(x)),
      contains: (c) => e._c.has(c),
      toggle: () => {},
    };
    return e;
  };

  async function applyRole(role, { serviceWorker = true, active = true } = {}) {
    const posted = [];
    const ctx = {
      document: {
        getElementById: () => el(),
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => el(),
        addEventListener() {},
        body: el(),
      },
      console: { log() {}, warn() {}, error() {} },
      setTimeout, clearTimeout, setInterval, clearInterval,
      Math, JSON, Date, RegExp, Number, String, Object, Array, Promise, Error, Map, Set, Intl,
      Boolean, parseFloat, parseInt, isFinite, isNaN,
      encodeURIComponent, decodeURIComponent, URLSearchParams,
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      location: { href: 'https://connect.timothystl.org/', hash: '', pathname: '/', reload() {} },
      history: { pushState() {}, replaceState() {} },
      addEventListener() {}, removeEventListener() {}, scrollTo() {},
      requestAnimationFrame: (fn) => setTimeout(fn, 0),
      matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
      alert() {}, confirm: () => false,
      fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
      navigator: serviceWorker
        ? {
            userAgent: 'test',
            serviceWorker: {
              register: () => Promise.resolve(),
              ready: Promise.resolve(active ? { active: { postMessage: (m) => posted.push(m) } } : {}),
            },
          }
        : { userAgent: 'test' },
    };
    ctx.window = ctx;
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(CHMS_APP_MEMBER_JS, ctx, { filename: 'app-member.js' });
    ctx.applyRoleUI(role, 'Test User', {});
    await new Promise((r) => setTimeout(r, 0));
    return posted;
  }

  it('posts the resolved role once the worker is ready', async () => {
    expect(await applyRole('member')).toEqual([{ type: 'chms-role', role: 'member' }]);
    expect(await applyRole('staff')).toEqual([{ type: 'chms-role', role: 'staff' }]);
  });

  it('survives a browser with no service worker at all', async () => {
    // Uncaught here would break sign-in, not just caching.
    await expect(applyRole('staff', { serviceWorker: false })).resolves.toEqual([]);
  });

  it('survives a registration that is not active yet', async () => {
    await expect(applyRole('staff', { active: false })).resolves.toEqual([]);
  });
});
