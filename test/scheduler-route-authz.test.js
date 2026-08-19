import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import worker from '../tlc-volunteer-worker.js';
import { authCookieHeader } from '../src/auth.js';

// SEC11/SEC12, 2026-08-19. The scheduler backend routes sat behind a single gate whose whole
// content was `isAuthed(req, env)`. That was correct while every session belonged to staff.
// The `role='member'` tier made it false: a congregant's read-only directory cookie satisfies
// isAuthed(), so it reached
//
//   POST /email/send  → arbitrary mail through Resend, sent as the church's verified
//                       EMAIL_FROM. A phishing primitive with the church's own domain behind it.
//   /api/*, /breeze/* → the Breeze proxy, ANY method and ANY path, carrying BREEZE_API_KEY.
//                       Read and write on the church's entire Breeze database.
//   /serve/*-pending  → volunteer names, emails, phones, free-text notes.
//
// Both criticals were confirmed against the real worker with a real signed member cookie
// before the fix. These tests drive the same path, so they fail if the gate is ever loosened
// back to authentication-only.

const SECRETS = {
  ADMIN_PASSWORD: 'test-signing-secret',
  WORKER_SECRET:  'test-worker-secret',
  BREEZE_SUBDOMAIN: 'timothystl',
  BREEZE_API_KEY: 'SECRET-BREEZE-KEY',
  RESEND_API_KEY: 'SECRET-RESEND-KEY',
  EMAIL_FROM: 'Timothy Lutheran <noreply@timothystl.org>',
};

// A DB stub that answers whatever role the test is impersonating. getAuthInfo live-checks
// app_users on every request (SW3), so this has to return an active row or every cookie is
// rejected and the tests would pass for the wrong reason.
function envForRole(role) {
  const row = role ? { active: 1, role } : null;
  const stmt = {
    bind: () => stmt,
    first: async () => row,
    all: async () => ({ results: [] }),
    run: async () => ({ meta: {} }),
  };
  return {
    ...SECRETS,
    DB: { prepare: () => stmt, batch: async () => [] },
    RSVP_STORE: {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    },
  };
}

async function cookieFor(role) {
  return (await authCookieHeader(envForRole(role), role, 'someone')).split(';')[0];
}

// Every request that would leave the Worker is captured instead of sent, so a regression
// shows up as "the church's API key went somewhere" rather than as a silent network call.
let outbound = [];
let realFetch;
beforeEach(() => {
  outbound = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    outbound.push({ url: String(u && u.url ? u.url : u), init: o || {} });
    return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const call = (path, { role = null, secret = false, method = 'GET', body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (secret) headers['X-Worker-Secret'] = SECRETS.WORKER_SECRET;
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return (async () => {
    if (role) init.headers.cookie = await cookieFor(role);
    return worker.fetch(new Request('https://connect.timothystl.org' + path, init), envForRole(role));
  })();
};

// The routes the gate must cover, in the shape the worker matches them.
const PRIVILEGED = [
  ['GET',  '/serve/pending'],
  ['GET',  '/serve/general-pending'],
  ['GET',  '/serve/event-pending'],
  ['GET',  '/volunteer/pending'],
  ['GET',  '/volunteer/general-pending'],
  ['GET',  '/volunteer/event-pending'],
  ['POST', '/email/send'],
  ['POST', '/rsvp/store'],
  ['POST', '/rsvp/sync'],
  ['GET',  '/api/people?limit=1'],
  ['GET',  '/breeze/people'],
];

describe('scheduler backend routes: authentication is not authorization', () => {
  it('403s every privileged route for a member session', async () => {
    for (const [method, path] of PRIVILEGED) {
      const r = await call(path, { role: 'member', method, body: method === 'POST' ? {} : undefined });
      expect(r.status, method + ' ' + path).toBe(403);
    }
  });

  it('never lets a member session reach Resend or Breeze', async () => {
    // The status code is the contract; this is the consequence, and it is the part that
    // actually matters — a 403 that still made the upstream call would leak the key anyway.
    await call('/email/send', { role: 'member', method: 'POST', body: { to: 'v@example.com', subject: 'x', html: 'x' } });
    await call('/api/people?limit=1', { role: 'member' });
    expect(outbound).toEqual([]);
  });

  it('403s a council session too — the gate is admin/staff, not "any logged-in role"', async () => {
    for (const role of ['member', 'council', 'finance']) {
      const r = await call('/email/send', { role, method: 'POST', body: {} });
      expect(r.status, role).toBe(403);
    }
  });

  it('401s, not 403s, with no session at all', async () => {
    for (const [method, path] of PRIVILEGED) {
      const r = await call(path, { method, body: method === 'POST' ? {} : undefined });
      expect(r.status, method + ' ' + path).toBe(401);
    }
  });

  it('still lets admin and staff through', async () => {
    for (const role of ['admin', 'staff']) {
      const r = await call('/serve/pending', { role });
      expect(r.status, role).toBe(200);
    }
  });

  it('⚠ keeps the X-Worker-Secret bypass working — the scheduler rides it server-to-server', async () => {
    const r = await call('/serve/pending', { secret: true });
    expect(r.status).toBe(200);
  });

  it('leaves /esv/passage open to any authenticated role', async () => {
    // Public Scripture text, no PII, and the ESV key never leaves the server. Deliberately
    // NOT privileged; if this starts 403ing, the gate was widened too far.
    const r = await call('/esv/passage?ref=John+3:16', { role: 'member' });
    expect(r.status).not.toBe(403);
  });

  it('does not turn an unknown path into a 403 for a member', async () => {
    // The privileged set is a list, not "everything after the gate". A blanket guard would
    // have swallowed the 404 catch-all, whose no-store header is load-bearing.
    const r = await call('/no-such-route-here', { role: 'member' });
    expect(r.status).toBe(404);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('the privileged-path list and the routes below it stay in step', () => {
  it('every route handled after the gate is either privileged or a documented exception', () => {
    // Source-derived rather than hand-listed: a route added to the block without a matching
    // entry in isPrivilegedSchedPath is exactly the regression that created SEC11/SEC12, and
    // it would be invisible to the behavioral tests above.
    const src = fs.readFileSync(new URL('../tlc-volunteer-worker.js', import.meta.url), 'utf8');
    const gateAt = src.indexOf('const isPrivilegedSchedPath');
    const endAt = src.indexOf("if (path.startsWith('/scheduler'))");
    expect(gateAt, 'gate marker').toBeGreaterThan(0);
    expect(endAt, 'end marker').toBeGreaterThan(gateAt);

    const listBlock = src.slice(gateAt, src.indexOf('if (isPrivilegedSchedPath', gateAt));
    const routeBlock = src.slice(src.indexOf('if (isPrivilegedSchedPath', gateAt), endAt);

    const listed = new Set([...listBlock.matchAll(/path === '([^']+)'/g)].map((m) => m[1]));
    const handled = new Set([...routeBlock.matchAll(/path === '([^']+)'/g)].map((m) => m[1]));

    // /esv/passage is the one deliberate exception; everything else must be in the list.
    const EXEMPT = new Set(['/esv/passage']);
    const ungated = [...handled].filter((p) => !listed.has(p) && !EXEMPT.has(p));
    expect(ungated, 'routes after the gate with no privileged-list entry').toEqual([]);

    // And the prefix matches the list claims are really the ones the block dispatches.
    expect(listBlock).toContain("path.startsWith('/breeze/')");
    expect(routeBlock).toContain("path.startsWith('/breeze/')");
  });
});
