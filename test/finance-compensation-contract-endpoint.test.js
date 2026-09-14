import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleChmsApi } from '../src/api-chms.js';

// ── Access gate: same sentinel-DB technique as test/finance-balance-sheet-contract-endpoint.test.js ──
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

const SEG = 'contracts/finance-compensation-v1';

async function call(role, { config = null } = {}) {
  const env = { DB: mockDb(config) };
  const url = new URL(`https://connect.example/admin/api/${SEG}`);
  const req = { json: async () => ({}), headers: { get: () => null } };
  try {
    const res = await handleChmsApi(req, env, url, 'GET', SEG, role);
    return { status: res.status, body: await res.json() };
  } catch (e) {
    if (e && e.message === REACHED_HANDLER) return { reached: true };
    throw e;
  }
}

describe('contracts/finance-compensation-v1 access gate', () => {
  // Unlike every ACCESS_GATE contract test before it, this one is gated by the dedicated
  // 'compensation' item (financeSegItems-style, single item -- see src/api-chms.js), NOT the
  // blanket 'finance' item every other contract in this file uses. Default DEFAULT_ROLE_PERMISSIONS
  // (src/api-utils.js) already gives 'finance' and 'council' compensation:'edit' out of the box
  // (mirroring finance/planning/salary's own real, pre-existing default access -- this is not new
  // behavior introduced by this contract), so both reach the real handler by default, same as admin.
  it('lets admin, finance, and council reach the real handler by default (default compensation permission is edit for all three)', async () => {
    for (const role of ['admin', 'finance', 'council']) {
      const r = await call(role);
      expect(r.reached, role).toBe(true);
    }
  });

  it('refuses staff by default (default compensation permission is none)', async () => {
    const r = await call('staff');
    expect(r.status).toBe(403);
  });

  it('refuses member and volunteer outright', async () => {
    for (const role of ['member', 'volunteer']) {
      const r = await call(role);
      expect(r.status, role).toBe(403);
    }
  });

  // The dedicated `compensation` ROLE (distinct from the 'compensation' permission ITEM every
  // configurable role above can hold) never reaches this ACCESS_GATE loop at all -- it
  // short-circuits earlier in handleChmsApi with its own hardcoded allowlist. Covered by its own
  // allowlist test below, not this describe block.

  // The real proof this gate checks the 'compensation' item specifically, not the blanket
  // 'finance' item every other contract in this file uses: grant a role full 'finance' access
  // while explicitly leaving its 'compensation' permission at 'none'. If the code were mistakenly
  // checking 'finance' here (as every one of the six contracts before this one correctly does),
  // this request would wrongly succeed.
  it('denies a role with full finance access but no compensation permission -- proving the gate checks "compensation", not "finance"', async () => {
    const config = JSON.stringify({
      staff: { giving: 'none', tuitionaid: 'none', finance: 'edit', compensation: 'none', budget: 'none', directory: 'edit', attendance: 'edit', followups: 'edit', audit: 'none', register: 'edit', reports: 'view' },
    });
    const r = await call('staff', { config });
    expect(r.status).toBe(403);
  });

  // The mirror image: a role with NO blanket 'finance' access at all, but with 'compensation'
  // explicitly granted, still reaches the handler -- proving 'finance' alone is neither necessary
  // nor sufficient here, only 'compensation' is checked.
  it('allows a role with compensation permission explicitly granted despite having no finance permission at all', async () => {
    const config = JSON.stringify({
      staff: { giving: 'none', tuitionaid: 'none', finance: 'none', compensation: 'view', budget: 'none', directory: 'edit', attendance: 'edit', followups: 'edit', audit: 'none', register: 'edit', reports: 'view' },
    });
    const r = await call('staff', { config });
    expect(r.reached).toBe(true);
  });
});

// ── The dedicated `compensation` ROLE -- a completely separate mechanism from the permission item
// above. It short-circuits before ACCESS_GATE with its own hardcoded allowlist (see the
// role === 'compensation' block near the top of handleChmsApi), so it needs its own allowlist
// entry for this contract segment, added alongside its existing finance/planning/salary entry.
describe('contracts/finance-compensation-v1 -- dedicated `compensation` role', () => {
  it('can read the contract (GET only, part of its narrow Compensation Planner allowlist)', async () => {
    const r = await call('compensation');
    expect(r.reached).toBe(true);
  });
});

// ── Full HTTP path with a real seeded database ──────────────────────────────────────────────
const EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS finance_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_baseline.sql', import.meta.url), 'utf8'));
  sqlite.exec(EXTRA_SCHEMA);
  return {
    prepare(sql) {
      return {
        async run(...args) { sqlite.prepare(sql).run(...args); },
        async first(...args) { return sqlite.prepare(sql).get(...args); },
        async all(...args) { return { results: sqlite.prepare(sql).all(...args) }; },
        bind(...args) {
          return {
            async run() { sqlite.prepare(sql).run(...args); },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
      };
    },
    _raw: sqlite,
  };
}

describe('contracts/finance-compensation-v1 real handler', () => {
  it('returns a real 200 empty-roster contract when nothing has ever been saved', async () => {
    const env = { DB: makeTestDb() };
    const url = new URL(`https://connect.example/admin/api/${SEG}`);
    const req = { json: async () => ({}), headers: { get: () => null } };
    const res = await handleChmsApi(req, env, url, 'GET', SEG, 'admin');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract).toBe('connect.finance-compensation.v1');
    expect(body.workers).toEqual([]);
  });

  it('reflects a real-shaped roster, with a fabricated name and dollar figure', async () => {
    const db = makeTestDb();
    db._raw.prepare(
      `INSERT INTO finance_settings (key, value) VALUES ('finance_salary_planner', ?)`
    ).run(JSON.stringify({ roster: [{ name: 'Test Worker A', position: 'Fictional Director', actualSalaryCents: 5000000 }] }));
    const env = { DB: db };
    const url = new URL(`https://connect.example/admin/api/${SEG}`);
    const req = { json: async () => ({}), headers: { get: () => null } };
    const res = await handleChmsApi(req, env, url, 'GET', SEG, 'admin');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workers).toHaveLength(1);
    expect(body.workers[0]).toMatchObject({ name: 'Test Worker A', currentPayCents: 5000000, currentPaySource: 'entered' });
  });
});
