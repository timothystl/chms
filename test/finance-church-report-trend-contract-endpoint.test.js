import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleChmsApi } from '../src/api-chms.js';

// ── Access gate: same sentinel-DB technique as test/finance-church-report-contract-endpoint.test.js.
// This segment relies on the SAME `contracts/finance-church-report` prefix rule the single-year
// contract uses (see src/api-chms.js's ACCESS_GATE comment on exactly this) -- no separate rule
// was added, so this test also proves that reuse actually works for the real segment string.
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

const SEG = 'contracts/finance-church-report-trend-v1';

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

describe('contracts/finance-church-report-trend-v1 access gate', () => {
  it('lets admin and finance reach the real handler (plain finance item, same as every other Finance segment)', async () => {
    for (const role of ['admin', 'finance']) {
      const r = await call(role);
      expect(r.reached, role).toBe(true);
    }
  });

  it('refuses staff by default (default finance permission is none)', async () => {
    const r = await call('staff');
    expect(r.status).toBe(403);
  });

  it('refuses council, member, and volunteer outright', async () => {
    for (const role of ['council', 'member', 'volunteer']) {
      const r = await call(role);
      expect(r.status, role).toBe(403);
    }
  });
});

// ── Full HTTP path with a real seeded database ──────────────────────────────────────────────
const EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS finance_church_entries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  fiscal_year       INTEGER NOT NULL,
  period_month      INTEGER NOT NULL DEFAULT 0,
  classification    TEXT    NOT NULL,
  category_path     TEXT    NOT NULL,
  account_name      TEXT    NOT NULL,
  depth             INTEGER NOT NULL DEFAULT 0,
  has_children      INTEGER NOT NULL DEFAULT 0,
  own_actual_cents  INTEGER NOT NULL DEFAULT 0,
  own_budget_cents  INTEGER,
  account_qbo_id    TEXT    NOT NULL DEFAULT '',
  source            TEXT    NOT NULL DEFAULT 'qbo_sync',
  notes             TEXT    NOT NULL DEFAULT '',
  synced_at         TEXT    NOT NULL DEFAULT '',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(fiscal_year, period_month, category_path, source)
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

describe('contracts/finance-church-report-trend-v1 real handler', () => {
  it('returns a real 200 empty-years contract when nothing is on file, with no query parameters required', async () => {
    const env = { DB: makeTestDb() };
    const url = new URL(`https://connect.example/admin/api/${SEG}`);
    const req = { json: async () => ({}), headers: { get: () => null } };
    const res = await handleChmsApi(req, env, url, 'GET', SEG, 'admin');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract).toBe('connect.finance-church-report-trend.v1');
    expect(body.years).toEqual([]);
  });

  it('reflects real multi-year church-entry rows, ascending by fiscal year', async () => {
    const db = makeTestDb();
    db._raw.prepare(
      `INSERT INTO finance_church_entries (fiscal_year, classification, category_path, account_name, own_actual_cents, own_budget_cents, source)
       VALUES (?,?,?,?,?,?,?)`
    ).run(2026, 'Income', 'Income:40000 Contributions', '40000 Contributions', 1300000, 1250000, 'import');
    db._raw.prepare(
      `INSERT INTO finance_church_entries (fiscal_year, classification, category_path, account_name, own_actual_cents, own_budget_cents, source)
       VALUES (?,?,?,?,?,?,?)`
    ).run(2025, 'Income', 'Income:40000 Contributions', '40000 Contributions', 900000, 850000, 'import_activity');
    const env = { DB: db };
    const url = new URL(`https://connect.example/admin/api/${SEG}`);
    const req = { json: async () => ({}), headers: { get: () => null } };
    const res = await handleChmsApi(req, env, url, 'GET', SEG, 'admin');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.years.map((y) => y.fiscalYear)).toEqual([2025, 2026]);
    expect(body.years.find((y) => y.fiscalYear === 2026)).toMatchObject({ incomeActualCents: 1300000 });
  });
});
