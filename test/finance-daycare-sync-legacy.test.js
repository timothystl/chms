// Regression coverage for the legacy in-Connect routes this batch extracted into shared
// functions (editDaycareEntry/removeDaycareEntry/syncDaycareFromApi/syncDaycareRoomsFromApi),
// exercised directly through handleFinanceApi -- same pattern as
// test/finance-daycare-budget-override.test.js and the Alpha.50 budget-import regression block
// in test/finance-property.test.js. None of these three routes had a dedicated legacy-route test
// before this batch.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleFinanceApi } from '../src/api-finance.js';

const DAYCARE_URL = 'https://daycare.example/api/finance/summary';
const ROOMS_URL = 'https://daycare.example/api/finance/rooms';

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_baseline.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0008_app_users_email.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0016_finance.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0034_finance_workspace_v3.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0050_finance_settings.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async first() { return sqlite.prepare(sql).get(); },
        async all() { return { results: sqlite.prepare(sql).all() }; },
      };
    },
    async batch(stmts) { for (const s of stmts) await s.run(); },
    _raw: sqlite,
  };
}
function makeReq(body) { return { json: async () => body }; }
function insertEntry(db, row) {
  const r = db._raw.prepare(
    `INSERT INTO finance_daycare_entries (period,category,entry_type,amount_cents,notes,source) VALUES (?,?,?,?,?,?)`
  ).run(row.period, row.category, row.entry_type, row.amount_cents, row.notes || '', row.source || 'manual');
  return Number(r.lastInsertRowid);
}

describe('finance/daycare/:id (PUT edit / DELETE remove)', () => {
  it('PUT edits only the fields sent, keeping the rest, and returns {ok:true}', async () => {
    const db = makeTestDb();
    const id = insertEntry(db, { period: '2027', category: 'Tuition Income', entry_type: 'actual', amount_cents: 500000, notes: 'first' });
    const res = await handleFinanceApi(makeReq({ amount_cents: 750000 }), {}, new URL('https://x/'), 'PUT', `finance/daycare/${id}`, db, true, true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const row = db._raw.prepare('SELECT period, category, entry_type, amount_cents, notes FROM finance_daycare_entries WHERE id=?').get(id);
    expect(row).toEqual({ period: '2027', category: 'Tuition Income', entry_type: 'actual', amount_cents: 750000, notes: 'first' });
  });

  it('PUT returns 404 for a nonexistent id', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({ amount_cents: 100 }), {}, new URL('https://x/'), 'PUT', 'finance/daycare/999999', db, true, true);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('PUT rejects an invalid period, saving nothing', async () => {
    const db = makeTestDb();
    const id = insertEntry(db, { period: '2027', category: 'Payroll', entry_type: 'actual', amount_cents: 100 });
    const res = await handleFinanceApi(makeReq({ period: 'garbage' }), {}, new URL('https://x/'), 'PUT', `finance/daycare/${id}`, db, true, true);
    expect(res.status).toBe(400);
    const row = db._raw.prepare('SELECT period FROM finance_daycare_entries WHERE id=?').get(id);
    expect(row.period).toBe('2027');
  });

  it('DELETE removes an existing entry and returns {ok:true}', async () => {
    const db = makeTestDb();
    const id = insertEntry(db, { period: '2027', category: 'Payroll', entry_type: 'actual', amount_cents: 100 });
    const res = await handleFinanceApi(makeReq({}), {}, new URL('https://x/'), 'DELETE', `finance/daycare/${id}`, db, true, true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(db._raw.prepare('SELECT * FROM finance_daycare_entries WHERE id=?').get(id)).toBeUndefined();
  });

  it('DELETE on a nonexistent id is a silent no-op, still returning {ok:true}', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({}), {}, new URL('https://x/'), 'DELETE', 'finance/daycare/999999', db, true, true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  // No role check of its own -- the blanket ACCESS_GATE is what gates this route in production
  // (financeSegItems), not an isAdmin check inside the handler itself. Passing isAdmin=false here
  // still succeeds, proving the route has no such internal check.
  it('has no role check of its own -- a non-admin caller still succeeds', async () => {
    const db = makeTestDb();
    const id = insertEntry(db, { period: '2027', category: 'Payroll', entry_type: 'actual', amount_cents: 100 });
    const res = await handleFinanceApi(makeReq({ notes: 'ok' }), {}, new URL('https://x/'), 'PUT', `finance/daycare/${id}`, db, false, true);
    expect(res.status).toBe(200);
  });
});

describe('finance/daycare/sync (pull money figures from the daycare app)', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns the same "not configured" error the route always has when no env vars are set, with no role check', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({}), {}, new URL('https://x/'), 'POST', 'finance/daycare/sync', db, false, true);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'The daycare app is not configured. Add DAYCARE_API_URL and DAYCARE_API_KEY (see SECRETS.md).' });
  });

  it('pulls and wholesale-replaces daycare_api rows for the periods returned', async () => {
    globalThis.fetch = async (url) => {
      if (String(url) === DAYCARE_URL) {
        return new Response(JSON.stringify({
          budget: [{ period: '2027-01', category: 'Tuition Income', type: 'actual', amount_cents: 500000 }],
          accounts: [{ code: '40010' }],
        }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const db = makeTestDb();
    const env = { DAYCARE_API_URL: DAYCARE_URL, DAYCARE_API_KEY: 'secret' };
    const res = await handleFinanceApi(makeReq({}), env, new URL('https://x/'), 'POST', 'finance/daycare/sync', db, false, true);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.ok).toBe(true);
    expect(out.imported).toBe(1);
    const rows = db._raw.prepare(`SELECT period, amount_cents FROM finance_daycare_entries WHERE source='daycare_api'`).all();
    expect(rows).toEqual([{ period: '2027-01', amount_cents: 500000 }]);
  });
});

describe('finance/daycare/rooms/sync (pull room-level figures from the daycare app, admin-only)', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('requires admin', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({}), {}, new URL('https://x/'), 'POST', 'finance/daycare/rooms/sync', db, false, true);
    expect(res.status).toBe(403);
  });

  it('returns the same "not configured" error the route always has when DAYCARE_ROOMS_API_URL is unset', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({}), {}, new URL('https://x/'), 'POST', 'finance/daycare/rooms/sync', db, true, true);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Daycare app room API is not configured (DAYCARE_ROOMS_API_URL)' });
  });

  it('pulls and wholesale-replaces one period\'s rooms', async () => {
    globalThis.fetch = async (url) => {
      if (String(url) === ROOMS_URL) {
        return new Response(JSON.stringify({
          period: '2027-01',
          rooms: [{ name: 'Toddler A', capacity_per_day: 12, avg_daily_enrolled: 10, billed_cents: 500000, labor_cost_cents: 300000, waitlist_families: 2, seasonal: false }],
        }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const db = makeTestDb();
    const env = { DAYCARE_ROOMS_API_URL: ROOMS_URL, DAYCARE_API_KEY: 'secret' };
    const res = await handleFinanceApi(makeReq({}), env, new URL('https://x/'), 'POST', 'finance/daycare/rooms/sync', db, true, true);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toEqual({ ok: true, period: '2027-01', rooms: 1, syncedAt: out.syncedAt });
    const rows = db._raw.prepare('SELECT room_name, billed_cents FROM finance_daycare_rooms WHERE period=?').all('2027-01');
    expect(rows).toEqual([{ room_name: 'Toddler A', billed_cents: 500000 }]);
  });
});
