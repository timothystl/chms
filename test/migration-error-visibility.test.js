import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initDb, _resetInitForTests } from '../src/db.js';

// Review finding, 2026-08-22: the runtime migration loop in _doInitDb caught every SQL error
// as if it only ever meant "column already exists" — `catch(e) { /* column already exists */ }`
// with nothing inspecting `e`. A genuine failure (typo, bad column/table reference, a real
// storage error) was indistinguishable from the expected, harmless "duplicate column name" a
// re-run always throws for an ALTER TABLE ADD COLUMN with no IF-NOT-EXISTS form in SQLite.
//
// The fix keeps the same fail-open behavior (this runs on every request via initDb — it must
// not throw the whole app down on a false positive) but now logs anything that ISN'T the
// expected duplicate-column/already-exists shape, so an unexpected migration failure is visible
// in Cloudflare's Worker logs instead of vanishing silently.

const forNodeSqlite = (sql) => sql.replace(/=""/g, "=''");

// Wraps a real in-memory SQLite DB so one specific statement can be forced to fail with an
// arbitrary error, while every other statement runs for real — proves the loop still completes
// the rest of migration/seeding around the injected failure.
function makeDbWithInjectedFailure(matchFragment, injectedMessage) {
  const sqlite = new DatabaseSync(':memory:');
  const stmtLog = [];
  const db = {
    prepare(sql) {
      const q = forNodeSqlite(sql);
      if (sql.includes(matchFragment)) {
        stmtLog.push(sql);
        return {
          bind: () => ({ run: async () => { throw new Error(injectedMessage); } }),
          run: async () => { throw new Error(injectedMessage); },
        };
      }
      const mk = (args) => ({
        async run() { const r = sqlite.prepare(q).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
        async first() { return sqlite.prepare(q).get(...args); },
        async all() { return { results: sqlite.prepare(q).all(...args) }; },
      });
      return { bind: (...args) => mk(args), ...mk([]) };
    },
    batch: async () => [],
  };
  return { db, sqlite, stmtLog };
}

beforeEach(() => _resetInitForTests());

describe('migration loop: unexpected errors are visible, expected ones stay silent', () => {
  it('logs a genuinely unexpected migration error (not swallowed silently)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A real, currently-shipped migration statement, made to fail with an error shape that is
    // NOT "duplicate column name" / "already exists" — e.g. a real storage/constraint failure.
    const { db } = makeDbWithInjectedFailure(
      "ALTER TABLE giving_entries ADD COLUMN deposit_id INTEGER",
      'SQLITE_IOERR: disk I/O error'
    );
    await initDb(db); // must not throw — this runs on every request
    const loggedUnexpected = errSpy.mock.calls.some(
      (call) => call.some((arg) => String(arg).includes('SQLITE_IOERR'))
    );
    expect(loggedUnexpected).toBe(true);
    errSpy.mockRestore();
  });

  it('does NOT log the expected "duplicate column name" re-run error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = makeDbWithInjectedFailure(
      "ALTER TABLE giving_entries ADD COLUMN deposit_id INTEGER",
      'duplicate column name: deposit_id'
    );
    await initDb(db);
    // Check specifically for the injected "duplicate column name" message text, not any log
    // mentioning "deposit_id" — a real downstream statement (e.g. the index on that column)
    // can legitimately fail for real once the injected column never actually got added to the
    // underlying SQLite table, and that unrelated failure SHOULD be logged.
    const loggedThisOne = errSpy.mock.calls.some(
      (call) => call.some((arg) => String(arg).includes('duplicate column name: deposit_id'))
    );
    expect(loggedThisOne).toBe(false);
    errSpy.mockRestore();
  });

  it('still completes the rest of init when one migration statement fails unexpectedly', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db, sqlite } = makeDbWithInjectedFailure(
      "ALTER TABLE giving_entries ADD COLUMN deposit_id INTEGER",
      'SQLITE_IOERR: disk I/O error'
    );
    await initDb(db);
    const row = sqlite.prepare("SELECT value FROM chms_config WHERE key='schema_fingerprint'").get();
    expect(row).toBeTruthy();
    vi.restoreAllMocks();
  });
});
