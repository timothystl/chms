import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initDb, _resetInitForTests } from '../src/db.js';

// Reported 2026-08-04: "The website is taking a long time to open. This seems to be an ongoing
// problem. Longer than any other website."
//
// Measured against production: ~6.5–7.0s TTFB on a cold isolate vs ~0.2s on a warm one, for a
// 5 KB login page. Cause: _doInitDb applies ~220 statements serially, each its own D1 round
// trip — every CREATE TABLE/INDEX in DB_INIT, ~84 ALTER TABLE migrations (each of which throws
// "duplicate column" on an already-migrated database and is swallowed), then a dozen seeds. All
// idempotent, so on a live database nearly every statement is a no-op — but it was awaited
// before the Worker served a single byte, and initDb's memoization is per-ISOLATE, so every
// cold isolate paid it again.
//
// These run the real initDb against real SQLite and count statements actually executed.

/**
 * Dialect shim: 39 statements in db.js use double-quoted string literals (e.g. `start_time=""`).
 * SQLite's legacy DQS misfeature accepts those, and D1 has it enabled — production runs fine.
 * node:sqlite compiles with it OFF, so it reads `""` as an identifier and errors "no such
 * column". Rewriting only empty double-quoted strings to single quotes lets the REAL init run
 * here; it changes no semantics. (Those 39 statements do depend on a SQLite misfeature, which
 * is worth knowing but is not this change's problem to fix.)
 */
const forNodeSqlite = (sql) => sql.replace(/=""/g, "=''");

function makeCountingDb() {
  const sqlite = new DatabaseSync(':memory:');
  const stats = { count: 0, sql: [] };
  const tally = (sql) => { stats.count++; stats.sql.push(sql); };
  const db = {
    prepare(sql) {
      const q = forNodeSqlite(sql);
      const mk = (args) => ({
        async run() {
          tally(sql);
          const r = sqlite.prepare(q).run(...args);
          return { meta: { last_row_id: Number(r.lastInsertRowid) } };
        },
        async first() { tally(sql); return sqlite.prepare(q).get(...args); },
        async all() { tally(sql); return { results: sqlite.prepare(q).all(...args) }; },
      });
      return { bind: (...args) => mk(args), ...mk([]) };
    },
    batch: async () => [],
  };
  return { db, stats, sqlite };
}

beforeEach(() => _resetInitForTests());

describe('cold-start DB init', () => {
  it('does the full schema build on a brand-new database', async () => {
    const { db, stats } = makeCountingDb();
    await initDb(db);
    // The real cost the user was paying: hundreds of serial round trips.
    expect(stats.count).toBeGreaterThan(150);
    expect(stats.sql.some((s) => /CREATE TABLE/.test(s))).toBe(true);
    expect(stats.sql.some((s) => /ALTER TABLE/.test(s))).toBe(true);
  });

  it('records a schema fingerprint once the build succeeds', async () => {
    const { db, sqlite } = makeCountingDb();
    await initDb(db);
    const row = sqlite.prepare("SELECT value FROM chms_config WHERE key='schema_fingerprint'").get();
    expect(row).toBeTruthy();
    expect(row.value).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
  });

  it('collapses a already-current database to a single round trip', async () => {
    // The fix. A fresh isolate against an already-migrated database is the common case in
    // production — every cold start, all day — and it used to redo all ~220 statements.
    const { db, stats, sqlite } = makeCountingDb();
    await initDb(db);
    const firstRun = stats.count;

    _resetInitForTests();            // simulate a brand-new Worker isolate...
    stats.count = 0; stats.sql = []; // ...hitting the SAME database
    await initDb(db);

    expect(stats.count).toBe(1);
    expect(stats.sql[0]).toMatch(/schema_fingerprint/);
    expect(firstRun).toBeGreaterThan(150);
    void sqlite;
  });

  it('still re-runs everything if the fingerprint does not match', async () => {
    // Guards the real risk of a fast path: silently skipping a migration someone just added.
    // The fingerprint is derived from the source of _doInitDb and every seed, so any edit
    // changes it — simulated here by corrupting the stored value.
    const { db, stats, sqlite } = makeCountingDb();
    await initDb(db);
    sqlite.prepare("UPDATE chms_config SET value='stale' WHERE key='schema_fingerprint'").run();

    _resetInitForTests();
    stats.count = 0;
    await initDb(db);

    expect(stats.count).toBeGreaterThan(150);
  });

  it('re-runs when the marker row is missing entirely', async () => {
    const { db, stats, sqlite } = makeCountingDb();
    await initDb(db);
    sqlite.prepare("DELETE FROM chms_config WHERE key='schema_fingerprint'").run();

    _resetInitForTests();
    stats.count = 0;
    await initDb(db);

    expect(stats.count).toBeGreaterThan(150);
  });

  it('is memoized within one isolate, so concurrent requests init once', async () => {
    const solo = makeCountingDb();
    await initDb(solo.db);
    const oneInit = solo.stats.count;

    _resetInitForTests();
    const concurrent = makeCountingDb();
    await Promise.all([initDb(concurrent.db), initDb(concurrent.db), initDb(concurrent.db)]);

    // Three concurrent callers share one in-flight init rather than tripling the work.
    expect(concurrent.stats.count).toBe(oneInit);
    expect(concurrent.stats.count).toBeLessThan(oneInit * 2);
  });

  it('shows how much work the fast path actually avoids', async () => {
    // Documents the measured scale of the problem, so a future change that quietly inflates
    // cold-start cost shows up as a failing number rather than a slow website.
    const { db, stats } = makeCountingDb();
    await initDb(db);
    const full = stats.count;

    _resetInitForTests();
    stats.count = 0;
    await initDb(db);

    expect(full).toBeGreaterThan(400);   // ~463 serial D1 round trips on a cold isolate
    expect(stats.count).toBe(1);         // ...now one, when the schema is already current
  });
});
