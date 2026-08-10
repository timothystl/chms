import { describe, it, expect } from 'vitest';
import { handleChmsApi } from '../src/api-chms.js';

// The Council role holds giving:'anon' — aggregate giving figures, never a donor's identity.
// resolveRolePermissions/isAnonSafeGivingSeg are unit-tested in role-permissions.test.js;
// what matters here is the gate in handleChmsApi that actually turns that level into a 403,
// because that is the only thing standing between a council login and a donor's name.
//
// The mock DB answers the one config read the gate needs and then throws a sentinel on any
// further query. So a request that gets past the gate reports itself by exploding — which
// is how the "these ARE reachable" assertions below prove the gate isn't just refusing
// everything and passing vacuously.
const REACHED_HANDLER = 'REACHED_HANDLER';
function mockDb(configJson) {
  return {
    prepare(sql) {
      if (String(sql).includes('role_permissions_json')) {
        return { first: async () => (configJson ? { value: configJson } : null) };
      }
      throw new Error(REACHED_HANDLER);
    },
    batch() { throw new Error(REACHED_HANDLER); },
  };
}

// Returns { status, body } for a request that got a response, or { reached: true } for one
// that made it as far as a real DB query.
async function call(seg, { role = 'council', method = 'GET', config = null } = {}) {
  const env = { DB: mockDb(config) };
  const url = new URL('https://connect.example/admin/api/' + seg);
  const req = { json: async () => ({}) };
  try {
    const res = await handleChmsApi(req, env, url, method, seg, role);
    return { status: res.status, body: await res.json() };
  } catch (e) {
    if (e && e.message === REACHED_HANDLER) return { reached: true };
    throw e;
  }
}

// Past the gate. Either the sentinel fired (a real handler ran a query) or the handler
// answered on its own — a 400 for a missing `year` is still the handler, not the gate.
// Anything but a 403 means the request was not refused.
async function expectAllowed(seg, opts, label) {
  const r = await call(seg, opts);
  expect(r.reached === true || r.status !== 403, label || seg).toBe(true);
}

describe('council / anonymous giving gate', () => {
  it('lets the aggregate giving reports through', async () => {
    for (const seg of [
      'giving/stats',
      'reports/giving-summary',
      'reports/giving-by-method',
      'reports/giving-trend',
      'reports/giving-multiyear',
      'reports/giving-distribution',
      'reports/giving-vs-attendance',
      'reports/giving-board',
    ]) {
      await expectAllowed(seg);
    }
  });

  it('refuses every giving endpoint that can name a donor', async () => {
    for (const seg of [
      'giving', 'giving/batches', 'giving/batches/7/entries', 'giving/transactions',
      'giving/deposits', 'giving/unassigned-gifts', 'giving/letters/status',
      'giving/nudges/status', 'giving/receipts/queue', 'giving/reconcile-diagnose',
      'reports/giving-insights', 'reports/giving-yoy', 'reports/giving-plateaus',
      'reports/giving-bands', 'reports/giving-statement',
    ]) {
      const r = await call(seg);
      expect(r.status, seg).toBe(403);
      expect(r.body.error, seg).toMatch(/totals only/);
    }
  });

  it('refuses to WRITE even an allowlisted giving endpoint', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await call('giving/stats', { method });
      expect(r.status, method).toBe(403);
    }
  });

  it('still lets council read the Finance workspace and the Reports tab', async () => {
    await expectAllowed('finance/church/this-year');
    await expectAllowed('reports/membership');
    await expectAllowed('register');
  });

  it('does not let council write Finance — it is view-only there', async () => {
    const r = await call('finance/planning/salary', { method: 'PUT' });
    expect(r.status).toBe(403);
  });

  it('gives finance and admin the per-donor endpoints council is refused', async () => {
    for (const role of ['admin', 'finance']) {
      await expectAllowed('giving/batches', { role }, 'giving/batches as ' + role);
      await expectAllowed('reports/giving-insights', { role }, 'insights as ' + role);
    }
  });

  it('refuses a staff role every giving endpoint, aggregate included', async () => {
    // staff defaults to giving:'none' — anon is strictly more than nothing, so the aggregate
    // reports must NOT have become open to everyone as a side effect.
    for (const seg of ['giving/stats', 'reports/giving-summary', 'giving/batches']) {
      expect((await call(seg, { role: 'staff' })).status, seg).toBe(403);
    }
  });

  it('honors an admin upgrading council to full giving access', async () => {
    const config = JSON.stringify({ council: { giving: 'view' } });
    await expectAllowed('reports/giving-insights', { config });
    await expectAllowed('giving/batches', { config });
    // …and still refuses the writes, since 'view' is not 'edit'.
    expect((await call('giving/batches', { config, method: 'POST' })).status).toBe(403);
  });

  it('honors an admin revoking giving from council entirely', async () => {
    const config = JSON.stringify({ council: { giving: 'none' } });
    const r = await call('reports/giving-summary', { config });
    expect(r.status).toBe(403);
    // The plain denial, not the anon-specific one — the role has no giving access at all.
    expect(r.body.error).toBe('Access denied');
  });

  it('treats a pre-rename `office` config row as council’s', async () => {
    const config = JSON.stringify({ office: { giving: 'view' } });
    await expectAllowed('giving/batches', { config });
  });
});

// The gate covers the giving endpoints. An individual's giving also surfaces OUTSIDE them —
// `giving_12mo` on the person profile, and the First-Time Givers list on the dashboard —
// which is why handleChmsApi computes a strict `isFinance` that is false for anon. Nothing
// above exercises that, so these do: they assert the query is never even issued, rather than
// that its result was dropped somewhere downstream.
function recordingDb(person) {
  const sqls = [];
  const stmt = (value) => ({
    bind: () => stmt(value),
    first: async () => value,
    all: async () => ({ results: [] }),
    run: async () => ({ meta: {} }),
  });
  return {
    sqls,
    prepare(sql) {
      sqls.push(String(sql));
      if (String(sql).includes('role_permissions_json')) return stmt(null);
      if (String(sql).includes('FROM giving_entries')) return stmt({ total: 123456 });
      if (String(sql).includes('FROM people p')) return stmt(person);
      return stmt({ n: 0 });
    },
    batch: async () => [],
  };
}

describe("a person's own giving total on the profile", () => {
  const person = { id: 5, first_name: 'Ada', last_name: 'Lovelace', member_type: 'member', household_id: null };

  async function fetchProfile(role) {
    const db = recordingDb(person);
    const url = new URL('https://connect.example/admin/api/people/5');
    const res = await handleChmsApi({ json: async () => ({}) }, { DB: db }, url, 'GET', 'people/5', role);
    return { body: await res.json(), queriedGiving: db.sqls.some(s => s.includes('FROM giving_entries')) };
  }

  it('is never queried for council, and comes back zero', async () => {
    const r = await fetchProfile('council');
    expect(r.queriedGiving).toBe(false);
    expect(r.body.giving_12mo).toBe(0);
  });

  it('is still queried and returned for finance', async () => {
    const r = await fetchProfile('finance');
    expect(r.queriedGiving).toBe(true);
    expect(r.body.giving_12mo).toBe(123456);
  });

  it('leaves council the rest of the directory record', async () => {
    const r = await fetchProfile('council');
    expect(r.body.first_name).toBe('Ada');
  });
});
