import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initDb, _resetInitForTests } from '../src/db.js';

// P24-B: two staff opening the dashboard the same Monday morning both found an empty
// engagement_tasks list for the new week and both ran the five-INSERT seed, leaving ten
// rows instead of five. Fixed with a UNIQUE(title, week_key) index (migrations/0037,
// also applied as a runtime migration in db.js) plus INSERT OR IGNORE instead of plain
// INSERT, batched via db.batch() instead of five serial awaits.
//
// This runs the real initDb (so the real migration applies) against real SQLite, then
// simulates the race directly against that schema — not a copy of the schema.

const forNodeSqlite = (sql) => sql.replace(/=""/g, "=''");

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  const db = {
    prepare(sql) {
      const q = forNodeSqlite(sql);
      const mk = (args) => ({
        async run() {
          const r = sqlite.prepare(q).run(...args);
          return { meta: { last_row_id: Number(r.lastInsertRowid) } };
        },
        async first() { return sqlite.prepare(q).get(...args); },
        async all() { return { results: sqlite.prepare(q).all(...args) }; },
      });
      return { bind: (...args) => mk(args), ...mk([]) };
    },
    async batch(stmts) {
      // Real D1 batch semantics: run all statements, return an array of results — good
      // enough here since the seed only cares that all five attempted inserts land (or are
      // ignored) before the follow-up SELECT.
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
  return { db, sqlite };
}

const DEFAULTS = [
  'Review new visitors in the people list',
  'Send newsletter to new contacts',
  'Follow up with first-time givers',
  'Follow up with prayer requests',
  'Check in with members not seen recently',
];

async function seedOnce(db, weekKey) {
  await db.batch(DEFAULTS.map((title, i) =>
    db.prepare('INSERT OR IGNORE INTO engagement_tasks(title,week_key,sort_order) VALUES(?,?,?)').bind(title, weekKey, i)
  ));
}

beforeEach(() => _resetInitForTests());

describe('engagement_tasks weekly-seed race (P24-B)', () => {
  it('a second concurrent seed for the same week does not duplicate the five defaults', async () => {
    const { db, sqlite } = makeDb();
    await initDb(db);

    const weekKey = '2026-W35';
    // Two staff both find the week empty and both seed — exactly the reported race.
    await seedOnce(db, weekKey);
    await seedOnce(db, weekKey);

    const rows = sqlite.prepare('SELECT title FROM engagement_tasks WHERE week_key=? ORDER BY sort_order').all(weekKey);
    expect(rows.length).toBe(5);
    expect(rows.map((r) => r.title)).toEqual(DEFAULTS);
  });

  it('seeding a different week is unaffected by another week already being seeded', async () => {
    const { db, sqlite } = makeDb();
    await initDb(db);

    await seedOnce(db, '2026-W35');
    await seedOnce(db, '2026-W36');

    const w35 = sqlite.prepare('SELECT COUNT(*) AS n FROM engagement_tasks WHERE week_key=?').get('2026-W35');
    const w36 = sqlite.prepare('SELECT COUNT(*) AS n FROM engagement_tasks WHERE week_key=?').get('2026-W36');
    expect(w35.n).toBe(5);
    expect(w36.n).toBe(5);
  });

  it('the migration dedupes a database that already has real duplicate rows from the old race', async () => {
    const { db, sqlite } = makeDb();
    await initDb(db);

    // Simulate a database that already suffered the pre-fix bug: insert the same
    // (title, week_key) pair twice via plain INSERT, bypassing the unique index by
    // dropping it first (as if this were an older schema mid-migration).
    sqlite.exec('DROP INDEX IF EXISTS idx_engagement_tasks_title_week');
    sqlite.prepare("INSERT INTO engagement_tasks(title,week_key,sort_order) VALUES('Dup task','2026-W35',0)").run();
    sqlite.prepare("INSERT INTO engagement_tasks(title,week_key,sort_order) VALUES('Dup task','2026-W35',0)").run();
    const before = sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_tasks WHERE title='Dup task'").get();
    expect(before.n).toBe(2);

    // Re-running the migration (a fresh isolate against this now-corrupted DB) should
    // dedup and re-establish the unique index. Force the fingerprint fast-path off so the
    // migration list actually re-runs, matching a real "older schema, first boot after this
    // fix deploys" isolate rather than one that's already current.
    sqlite.exec("DELETE FROM chms_config WHERE key='schema_fingerprint'");
    _resetInitForTests();
    await initDb(db);

    const after = sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_tasks WHERE title='Dup task'").get();
    expect(after.n).toBe(1);
    const idx = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_engagement_tasks_title_week'").get();
    expect(idx).toBeTruthy();
  });
});
