import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import {
  handleSchedulerDataApi, stripServerManagedSettings, SERVER_MANAGED_SETTING_KEYS,
} from '../src/api-admin.js';
import { scrubServerManagedSchedulerSecrets } from '../src/db.js';
import { CHMS_SCHEDULER_JS, CHMS_SCHEDULER_HTML } from '../src/html-chms.js';

// SEC17 / P22-B, 2026-08-19. `ws_breeze_settings` stored the Breeze API key and WORKER_SECRET
// next to real settings, and `GET /admin/api/scheduler/data` returns the scheduler_data table
// wholesale to admin OR STAFF (the bar SW1 set). So both were readable by every staff login.
//
// WORKER_SECRET is the one that matters: it is the `X-Worker-Secret` bypass credential for the
// scheduler backend routes, it never expires, and it cannot be revoked per-user — it outlives
// deactivating the account it leaked to. Both values live in the Worker's env and are read
// from there; the copies here were never consumed by anything.

const SECRETS = { apiKey: 'BREEZE-KEY', workerSecret: 'WORKER-SECRET', resendKey: 'RESEND-KEY', emailFrom: 'x@y.z' };
const KEEP = { subdomain: 'timothystl', workerUrl: 'https://connect.timothystl.org', tagIds: [1, 2], replyTo: 'office@x.org', officeEmail: 'o@x.org' };

describe('the strip helper itself', () => {
  it('removes every server-managed key and keeps everything else', () => {
    const out = stripServerManagedSettings({ ...KEEP, ...SECRETS });
    for (const k of SERVER_MANAGED_SETTING_KEYS) expect(out, k).not.toHaveProperty(k);
    expect(out).toEqual(KEEP);
  });

  it('does not mutate its input, and passes non-objects through', () => {
    const input = { ...SECRETS };
    stripServerManagedSettings(input);
    expect(input.apiKey).toBe('BREEZE-KEY');
    expect(stripServerManagedSettings(null)).toBe(null);
    expect(stripServerManagedSettings('str')).toBe('str');
  });
});

// ── The authoritative guarantee: the server refuses to persist them ────────────────────────
describe('the write paths strip, so a stale client cannot put them back', () => {
  let sqlite, env;
  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`CREATE TABLE scheduler_data (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
                 CREATE TABLE app_users (id INTEGER PRIMARY KEY, username TEXT, role TEXT, active INTEGER);`);
    const db = {
      prepare(sql) {
        const mk = (args) => ({
          async run() { sqlite.prepare(sql).run(...args); return { meta: {} }; },
          async first() { return sqlite.prepare(sql).get(...args); },
          async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        });
        return { bind: (...a) => mk(a), ...mk([]) };
      },
      batch: async (stmts) => Promise.all(stmts.map((s) => s.run())),
    };
    env = { DB: db, ADMIN_PASSWORD: 'pw', SESSION_SECRET: 'pw' };
  });

  const stored = () => {
    const row = sqlite.prepare("SELECT value FROM scheduler_data WHERE key='ws_breeze_settings'").get();
    return row ? JSON.parse(row.value) : null;
  };

  // handleSchedulerDataApi resolves the role itself; a signed cookie is not needed because
  // getAuthRole reads app_users, so the request just carries no cookie and we stub the role
  // check by inserting an admin row and passing the cookie-free request through a role shim.
  const post = async (path, body) => {
    const url = new URL('https://connect.timothystl.org/admin/api/scheduler/' + path);
    const req = new Request(url, {
      method: 'POST', headers: { 'X-Worker-Secret': 'unused', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return handleSchedulerDataApi(req, env, url, 'POST');
  };

  it('strips on the bulk snapshot write', async () => {
    // Needs an admin session; without one the handler 403s and the test would pass vacuously,
    // so assert the write actually happened before asserting what it contains.
    sqlite.prepare("INSERT INTO app_users VALUES (1,'admin','admin',1)").run();
    const { authCookieHeader } = await import('../src/auth.js');
    const cookie = (await authCookieHeader(env, 'admin', 'admin')).split(';')[0];
    const url = new URL('https://connect.timothystl.org/admin/api/scheduler/data');
    const res = await handleSchedulerDataApi(
      new Request(url, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ws_breeze_settings: { ...KEEP, ...SECRETS } }) }),
      env, url, 'POST'
    );
    expect(res.status).toBe(200);
    expect(stored(), 'nothing was written').not.toBeNull();
    expect(stored()).toEqual(KEEP);
  });

  it('strips on the per-key write', async () => {
    sqlite.prepare("INSERT INTO app_users VALUES (1,'admin','admin',1)").run();
    const { authCookieHeader } = await import('../src/auth.js');
    const cookie = (await authCookieHeader(env, 'admin', 'admin')).split(';')[0];
    const url = new URL('https://connect.timothystl.org/admin/api/scheduler/data/ws_breeze_settings');
    const res = await handleSchedulerDataApi(
      new Request(url, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: { ...KEEP, ...SECRETS } }) }),
      env, url, 'POST'
    );
    expect(res.status).toBe(200);
    expect(stored()).toEqual(KEEP);
  });

  it('leaves other scheduler keys untouched', async () => {
    sqlite.prepare("INSERT INTO app_users VALUES (1,'admin','admin',1)").run();
    const { authCookieHeader } = await import('../src/auth.js');
    const cookie = (await authCookieHeader(env, 'admin', 'admin')).split(';')[0];
    const url = new URL('https://connect.timothystl.org/admin/api/scheduler/data');
    await handleSchedulerDataApi(
      new Request(url, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ws_people: [{ id: 'p1', apiKey: 'not-a-secret-here' }] }) }),
      env, url, 'POST'
    );
    const row = sqlite.prepare("SELECT value FROM scheduler_data WHERE key='ws_people'").get();
    // Only ws_breeze_settings is scrubbed — an unrelated key named apiKey on a person record
    // is data, not a credential, and must survive.
    expect(JSON.parse(row.value)[0].apiKey).toBe('not-a-secret-here');
  });
});

// ── Removing what is already stored ────────────────────────────────────────────────────────
describe('the one-time scrub', () => {
  let sqlite, db;
  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec("CREATE TABLE scheduler_data (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);");
    db = {
      prepare(sql) {
        const mk = (args) => ({
          async run() { sqlite.prepare(sql).run(...args); return { meta: {} }; },
          async first() { return sqlite.prepare(sql).get(...args); },
          async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        });
        return { bind: (...a) => mk(a), ...mk([]) };
      },
    };
  });
  const put = (v) => sqlite.prepare("INSERT INTO scheduler_data VALUES ('ws_breeze_settings',?, '')").run(JSON.stringify(v));
  const get = () => JSON.parse(sqlite.prepare("SELECT value FROM scheduler_data WHERE key='ws_breeze_settings'").get().value);

  it('removes secrets already in the table and keeps the real settings', async () => {
    put({ ...KEEP, ...SECRETS });
    await scrubServerManagedSchedulerSecrets(db);
    expect(get()).toEqual(KEEP);
  });

  it('is idempotent and leaves a clean row alone', async () => {
    put({ ...KEEP });
    await scrubServerManagedSchedulerSecrets(db);
    await scrubServerManagedSchedulerSecrets(db);
    expect(get()).toEqual(KEEP);
  });

  it('survives a missing row and unparseable JSON', async () => {
    await expect(scrubServerManagedSchedulerSecrets(db)).resolves.toBeUndefined();
    sqlite.prepare("INSERT INTO scheduler_data VALUES ('ws_breeze_settings','not json','')").run();
    await expect(scrubServerManagedSchedulerSecrets(db)).resolves.toBeUndefined();
  });
});

// ── The client half, run out of the real shipped bundle ────────────────────────────────────
describe('the scheduler client neither keeps nor sends them', () => {
  function loadClient(seed) {
    const store = { ws_breeze_settings: JSON.stringify(seed) };
    const ctx = {
      console, JSON, Object, Array, String, Number, Boolean, Math, Date, RegExp, Promise, Error, Map, Set, Intl,
      parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
      setTimeout, clearTimeout, setInterval, clearInterval,
      localStorage: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
      },
      __store: store,
    };
    ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    // Only the two storage functions are needed; evaluating the whole embed bundle would need
    // a DOM. Extracted from the REAL shipped source so this cannot drift from what ships.
    const src = CHMS_SCHEDULER_JS;
    const start = src.indexOf('var SERVER_MANAGED_SETTING_KEYS');
    const end = src.indexOf('\n', src.indexOf('function saveBreezeSettings'));
    expect(start, 'strip helper not found in the shipped bundle').toBeGreaterThan(-1);
    vm.runInContext(src.slice(start, end), ctx, { filename: 'scheduler-embed.js' });
    return ctx;
  }

  it('strips secrets on read, even from a blob written by an older build', () => {
    const ctx = loadClient({ ...KEEP, ...SECRETS });
    const s = ctx.getBreezeSettings();
    for (const k of Object.keys(SECRETS)) expect(s, k).not.toHaveProperty(k);
    expect(s.subdomain).toBe('timothystl');
  });

  it('strips secrets on write, so they never reach localStorage or the D1 push', () => {
    const ctx = loadClient({});
    ctx.saveBreezeSettings({ ...KEEP, ...SECRETS });
    const written = JSON.parse(ctx.__store.ws_breeze_settings);
    expect(written).toEqual(KEEP);
    expect(ctx.__store.ws_breeze_settings).not.toContain('WORKER-SECRET');
  });

  it('does not mutate the caller\'s object on save', () => {
    const ctx = loadClient({});
    const mine = { ...KEEP, apiKey: 'BREEZE-KEY' };
    ctx.saveBreezeSettings(mine);
    expect(mine.apiKey).toBe('BREEZE-KEY');
  });

  it('sends no X-Breeze-Api-Key header from the shipped bundle', () => {
    // The proxy prefers env.BREEZE_API_KEY over the header, so it was ignored in practice —
    // sending it only risked putting the key in a request log.
    // Matched as a header KEY being set, not as a bare substring — the explanatory comment
    // above breezeGet names the header, and a scan that trips on its own documentation is the
    // trap this repo hit in Phase 21.
    expect(CHMS_SCHEDULER_JS).not.toMatch(/['"]X-Breeze-Api-Key['"]\s*:/);
  });

  it('has no settings input that would collect a secret the app then discards', () => {
    // A field that silently throws away what you type is worse than no field. The Settings
    // screen shows these as "configured on server" from the config endpoint instead.
    // ⚠ Both halves: the input lives in the MARKUP bundle and the read in the JS one, so
    // checking only the JS misses a restored field entirely (it did, on the first draft).
    for (const id of ['breeze-apikey', 'breeze-worker-secret', 'email-resend-key', 'email-from']) {
      expect(CHMS_SCHEDULER_HTML, 'markup: ' + id).not.toContain('id="' + id + '"');
      expect(CHMS_SCHEDULER_JS, 'js: ' + id).not.toContain("'" + id + "'");
    }
  });
});
