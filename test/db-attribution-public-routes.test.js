import { describe, it, expect } from 'vitest';
import worker from '../connect-worker.js';

// Overhaul goal 5 (observability): db-attribution.js's wrapper originally only covered
// /admin/api/* (via handleAdminApi in api-admin.js) — chms's public /api/*, /rsvp/*,
// /breeze/*, and scheduler routes, reachable only through the top-level _fetch dispatch in
// connect-worker.js, had no attribution at all. These tests drive worker.fetch() end to
// end against a public route to prove the wrap added to _fetch actually reaches it, rather
// than asserting against an isolated helper that could drift from what the route wiring does.

const SECRETS = { ADMIN_PASSWORD: 'test-signing-secret', SESSION_SECRET: 'test-signing-secret' };

function makeEnv({ delayMs = 0 } = {}) {
  const stmt = {
    bind: () => stmt,
    first: async () => null,
    async all() {
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      return { results: [] };
    },
    run: async () => ({ meta: {} }),
  };
  return { ...SECRETS, DB: { prepare: () => stmt, batch: async () => [] } };
}

async function callMinistryRoles(env) {
  const req = new Request('https://connect.timothystl.org/api/ministry-roles');
  return worker.fetch(req, env);
}

describe('public (non-/admin/api/*) routes get D1 attribution too', () => {
  it('logs d1_query_attribution, keyed by the full path, for a slow public route', async () => {
    const logs = [];
    const orig = console.log;
    console.log = (...args) => logs.push(args);
    let res;
    try {
      res = await callMinistryRoles(makeEnv({ delayMs: 600 }));
    } finally {
      console.log = orig;
    }
    expect(res.status).toBe(200);
    const line = logs.find(l => l[0] === 'd1_query_attribution');
    expect(line).toBeDefined();
    const payload = JSON.parse(line[1]);
    expect(payload.route).toBe('/api/ministry-roles');
    expect(payload.method).toBe('GET');
    expect(payload.elapsed_ms).toBeGreaterThan(500);
  });

  it('does not log for the same route on an ordinary, fast response (negative case)', async () => {
    const logs = [];
    const orig = console.log;
    console.log = (...args) => logs.push(args);
    try {
      const res = await callMinistryRoles(makeEnv());
      expect(res.status).toBe(200);
    } finally {
      console.log = orig;
    }
    expect(logs.find(l => l[0] === 'd1_query_attribution')).toBeUndefined();
  });
});
