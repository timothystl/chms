import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleChmsApi } from '../src/api-chms.js';

// P28-C / PL1b: pledge tracking. One row per person per fiscal year
// (pledges.person_id, fiscal_year), gated on isFinance since a pledge is
// giving-related data -- the same reasoning that already keeps giving_12mo
// off the person profile for a role that only sees anonymized totals.

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT ''
  )`);
  sqlite.exec(`CREATE TABLE giving_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_date TEXT NOT NULL DEFAULT ''
  )`);
  sqlite.exec(`CREATE TABLE giving_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL,
    person_id INTEGER,
    amount INTEGER NOT NULL DEFAULT 0
  )`);
  sqlite.exec(`CREATE TABLE pledges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL,
    fiscal_year INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  sqlite.exec(`CREATE UNIQUE INDEX idx_pledges_person_year ON pledges(person_id, fiscal_year)`);
  sqlite.exec(`CREATE TABLE chms_config (key TEXT PRIMARY KEY, value TEXT)`);
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              const r = sqlite.prepare(sql).run(...args);
              return { meta: { last_row_id: Number(r.lastInsertRowid) } };
            },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async run() { sqlite.prepare(sql).run(); },
        async first() { return sqlite.prepare(sql).get(); },
        async all() { return { results: sqlite.prepare(sql).all() }; },
      };
    },
    async batch(stmts) { return Promise.all(stmts.map((s) => s.run())); },
    _raw: sqlite,
  };
}

function req(body) { return { json: async () => body }; }

async function call(db, role, method, seg, body) {
  const env = { DB: db };
  const url = new URL('https://connect.timothystl.org/admin/api/' + seg);
  return handleChmsApi(req(body || {}), env, url, method, seg, role);
}

describe('pledge tracking (P28-C)', () => {
  let db;
  beforeEach(() => {
    db = makeTestDb();
    db._raw.prepare("INSERT INTO people (id, first_name, last_name) VALUES (1, 'Jane', 'Doe')").run();
  });

  it('records a new pledge and reads it back with the actual giving for that year', async () => {
    db._raw.prepare("INSERT INTO giving_batches (id, batch_date) VALUES (1, '2026-03-01')").run();
    db._raw.prepare('INSERT INTO giving_entries (batch_id, person_id, amount) VALUES (1, 1, 50000)').run();

    const post = await call(db, 'finance', 'POST', 'people/1/pledges', { fiscal_year: 2026, amount_cents: 120000 });
    expect(post.status).toBe(200);

    const get = await call(db, 'finance', 'GET', 'people/1/pledges');
    const body = await get.json();
    expect(body.pledges).toHaveLength(1);
    expect(body.pledges[0]).toMatchObject({ fiscal_year: 2026, amount_cents: 120000, actual_cents: 50000 });
  });

  it('upserts on a second POST for the same person+year rather than duplicating', async () => {
    await call(db, 'admin', 'POST', 'people/1/pledges', { fiscal_year: 2026, amount_cents: 100000 });
    await call(db, 'admin', 'POST', 'people/1/pledges', { fiscal_year: 2026, amount_cents: 150000, note: 'raised at stewardship drive' });
    const body = await (await call(db, 'admin', 'GET', 'people/1/pledges')).json();
    expect(body.pledges).toHaveLength(1);
    expect(body.pledges[0].amount_cents).toBe(150000);
  });

  it('refuses a negative amount', async () => {
    const r = await call(db, 'admin', 'POST', 'people/1/pledges', { fiscal_year: 2026, amount_cents: -500 });
    expect(r.status).toBe(400);
    expect(db._raw.prepare('SELECT COUNT(*) AS n FROM pledges').get().n).toBe(0);
  });

  it('refuses a nonsense fiscal_year', async () => {
    const r = await call(db, 'admin', 'POST', 'people/1/pledges', { fiscal_year: 'soon', amount_cents: 1000 });
    expect(r.status).toBe(400);
  });

  it('404s a pledge write against a person that does not exist', async () => {
    const r = await call(db, 'admin', 'POST', 'people/999/pledges', { fiscal_year: 2026, amount_cents: 1000 });
    expect(r.status).toBe(404);
  });

  it('deletes a pledge for a specific year', async () => {
    await call(db, 'admin', 'POST', 'people/1/pledges', { fiscal_year: 2026, amount_cents: 100000 });
    const del = await call(db, 'admin', 'DELETE', 'people/1/pledges/2026');
    expect(del.status).toBe(200);
    const body = await (await call(db, 'admin', 'GET', 'people/1/pledges')).json();
    expect(body.pledges).toHaveLength(0);
  });

  it('gates every pledge route on isFinance -- a role that cannot see individual giving cannot see a pledge either', async () => {
    // council holds giving:'anon' by default (totals only, no per-donor data), the exact
    // role isFinance is designed to exclude.
    const getR = await call(db, 'council', 'GET', 'people/1/pledges');
    expect(getR.status).toBe(403);
    const postR = await call(db, 'council', 'POST', 'people/1/pledges', { fiscal_year: 2026, amount_cents: 1000 });
    expect(postR.status).toBe(403);
    expect(db._raw.prepare('SELECT COUNT(*) AS n FROM pledges').get().n).toBe(0);
  });

  it('refuses a member session outright, same as every other giving-shaped route', async () => {
    const r = await call(db, 'member', 'GET', 'people/1/pledges');
    expect(r.status).not.toBe(200);
  });
});
