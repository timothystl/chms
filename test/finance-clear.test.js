import { it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { clearChurchReport } from '../src/finance-clear.js';
import { financeStorageDb } from '../src/finance-storage.js';
import { wrapDbForAttribution, namedQuery } from '../src/db-attribution.js';
function database() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('CREATE TABLE finance_church_entries(id INTEGER); CREATE TABLE finance_qb_snapshot(id INTEGER);');
  const db = { raw, beforeRun: null, prepare(sql) {
    const statement = (args = []) => ({ bind: (...values) => statement(values),
      async first() { return raw.prepare(sql).get(...args); },
      async run() { db.beforeRun?.(sql); return { meta: raw.prepare(sql).run(...args) }; },
    });
    return statement();
  } };
  return db;
}
function setup(mode = 'finance') {
  const DB = database(), FINANCE_DB = database();
  const finance = mode === 'finance' ? FINANCE_DB : DB;
  DB.raw.exec('INSERT INTO finance_qb_snapshot VALUES(1)');
  finance.raw.exec('INSERT INTO finance_church_entries VALUES(1),(2)');
  return { DB, FINANCE_DB, finance, db: financeStorageDb({ DB, FINANCE_DB, FINANCE_STORAGE_MODE: mode }), counts: { finance_qb_snapshot: 1, finance_church_entries: 2 } };
}
it.each(['finance','connect'])('clears only the two report tables in %s mode', async mode => {
  const x = setup(mode);
  expect(await clearChurchReport(x.db, x.counts)).toEqual({ ok: true, cleared: x.counts });
  expect(x.DB.raw.prepare('SELECT COUNT(*) AS n FROM finance_qb_snapshot').get().n).toBe(0);
  expect(x.finance.raw.prepare('SELECT COUNT(*) AS n FROM finance_church_entries').get().n).toBe(0);
});
it('refuses stale confirmation before either delete', async () => {
  const x = setup();
  expect((await clearChurchReport(x.db, {})).status).toBe(409);
  expect(x.DB.raw.prepare('SELECT COUNT(*) AS n FROM finance_qb_snapshot').get().n).toBe(1);
});
it('reports partial progress and resumes only after fresh confirmation', async () => {
  const x = setup(); x.finance.beforeRun = () => { throw new Error('unavailable'); };
  expect(await clearChurchReport(x.db, x.counts)).toMatchObject({ status: 503, cleared: { finance_qb_snapshot: 1 }, remaining: 'finance_church_entries' });
  x.finance.beforeRun = null;
  expect((await clearChurchReport(x.db, x.counts)).status).toBe(409);
  expect((await clearChurchReport(x.db, { ...x.counts, finance_qb_snapshot: 0 })).ok).toBe(true);
});
it('does not clear entries when cache deletion fails, or delete a changed row count', async () => {
  const x = setup(); x.DB.beforeRun = () => { throw new Error('unavailable'); };
  expect((await clearChurchReport(x.db, x.counts)).cleared).toEqual({});
  x.DB.beforeRun = null;
  x.finance.beforeRun = () => { x.finance.raw.exec('INSERT INTO finance_church_entries VALUES(3)'); };
  expect((await clearChurchReport(x.db, x.counts)).status).toBe(409);
  expect(x.finance.raw.prepare('SELECT COUNT(*) AS n FROM finance_church_entries').get().n).toBe(3);
});
it('shares attribution and budgets across owners without double-counting or leaking between requests', () => {
  const x = setup();
  const first = wrapDbForAttribution(x.DB);
  const db = financeStorageDb({ DB: first.db, FINANCE_DB: x.FINANCE_DB, FINANCE_STORAGE_MODE: 'finance' });
  namedQuery(db, 'report', 'SELECT * FROM finance_church_entries', { limit: 1 });
  expect(() => namedQuery(db, 'report', 'SELECT * FROM finance_qb_snapshot', { limit: 1 })).toThrow(/budget exceeded/);
  db.prepare('SELECT * FROM finance_qb_snapshot');
  expect(first.counter.queries).toBe(2);
  expect(first.counter.names).toEqual(['report']);
  const next = wrapDbForAttribution(x.DB);
  const nextDb = financeStorageDb({ DB: next.db, FINANCE_DB: x.FINANCE_DB, FINANCE_STORAGE_MODE: 'finance' });
  namedQuery(nextDb, 'report', 'SELECT * FROM finance_church_entries', { limit: 1 });
  expect(next.counter.queries).toBe(1);
});
