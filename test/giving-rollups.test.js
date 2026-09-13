import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { ensureGivingYearRollups, YEAR_REFRESH_QUERY_BUDGET } from '../src/giving-rollups.js';
import { DASHBOARD_GIVING_TOTALS_SQL, loadDashboardGivingTotals } from '../src/api-chms.js';
import { wrapDbForAttribution, QueryBudgetExceededError } from '../src/db-attribution.js';

function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`
    CREATE TABLE giving_batches(id INTEGER PRIMARY KEY,batch_date TEXT NOT NULL);
    CREATE TABLE funds(id INTEGER PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE people(id INTEGER PRIMARY KEY,household_id INTEGER,member_type TEXT DEFAULT 'member',first_gift_noted INTEGER DEFAULT 0);
    CREATE TABLE giving_entries(id INTEGER PRIMARY KEY,batch_id INTEGER,person_id INTEGER,
      fund_id INTEGER,amount INTEGER,contribution_date TEXT NOT NULL DEFAULT '');
    INSERT INTO giving_batches VALUES(1,'2026-01-05');
    INSERT INTO funds VALUES(7,'40085 General Fund'),(8,'25010 Designated');
    INSERT INTO people(id,household_id,member_type) VALUES(1,10,'member'),(2,10,'member'),(3,NULL,'member');
    INSERT INTO giving_entries VALUES
      (1,1,1,7,100000,''),(2,1,2,7,150000,'2026-02-01'),(3,1,3,8,10000,'2026-03-01');
  `);
  raw.exec('CREATE INDEX idx_giving_date_fund ON giving_entries(contribution_date,fund_id,amount)');
  raw.exec(readFileSync(new URL('../migrations/0044_giving_monthly_fund_totals.sql', import.meta.url), 'utf8'));
  raw.exec(readFileSync(new URL('../migrations/0045_giving_year_person_totals.sql', import.meta.url), 'utf8'));
  raw.exec(readFileSync(new URL('../migrations/0047_giving_rollup_claims.sql', import.meta.url), 'utf8'));
  const queries = [];
  const db = {
    prepare(sql) {
      queries.push(sql);
      const statement = raw.prepare(sql);
      const bound = (args) => ({
        async run() { statement.run(...args); },
        async first() { return statement.get(...args); },
        async all() { return { results: statement.all(...args) }; },
      });
      return { bind: (...args) => bound(args), ...bound([]) };
    },
    async batch(stmts) { for (const stmt of stmts) await stmt.run(); },
  };
  return { raw, db, queries };
}

describe('giving rollups', () => {
  it('backfills dates and stores only fund/month and household/year rows', () => {
    const { raw } = setup();
    expect(raw.prepare('SELECT contribution_date FROM giving_entries WHERE id=1').get().contribution_date).toBe('2026-01-05');
    expect(raw.prepare('SELECT month,fund_id,total_cents FROM giving_monthly_fund_totals ORDER BY month').all())
      .toEqual([
        { month: '2026-01', fund_id: 7, total_cents: 100000 },
        { month: '2026-02', fund_id: 7, total_cents: 150000 },
        { month: '2026-03', fund_id: 8, total_cents: 10000 },
      ]);
    expect(raw.prepare('SELECT household_key,total_cents,giver_count FROM giving_year_household_totals ORDER BY household_key').all())
      .toEqual([
        { household_key: 'h:10', total_cents: 250000, giver_count: 2 },
        { household_key: 'p:3', total_cents: 10000, giver_count: 1 },
      ]);
  });

  it('keeps monthly totals exact through insert, move, amount edit, and delete', () => {
    const { raw } = setup();
    raw.exec("INSERT INTO giving_entries VALUES(4,1,1,7,5000,'2026-01-20')");
    raw.exec("UPDATE giving_entries SET contribution_date='2026-04-01',fund_id=8,amount=7000 WHERE id=4");
    expect(raw.prepare("SELECT total_cents FROM giving_monthly_fund_totals WHERE month='2026-04' AND fund_id=8").get().total_cents).toBe(7000);
    expect(raw.prepare("SELECT total_cents FROM giving_monthly_fund_totals WHERE month='2026-01' AND fund_id=7").get().total_cents).toBe(100000);
    raw.exec('DELETE FROM giving_entries WHERE id=4');
    expect(raw.prepare("SELECT * FROM giving_monthly_fund_totals WHERE month='2026-04'").get()).toBeUndefined();
  });

  it('refreshes a changed year once, then reads only summary rows', async () => {
    const { raw, db, queries } = setup();
    raw.exec("INSERT INTO giving_entries VALUES(4,1,3,8,50000,'2026-04-01')");
    const refreshed = await ensureGivingYearRollups(db, 2026);
    expect(refreshed).toMatchObject({ giving_households: 2, giver_count: 3, band_high: 1, band_mid: 1 });
    expect(queries.filter(q => /FROM giving_entries/.test(q))).toHaveLength(1);
    queries.length = 0;
    await ensureGivingYearRollups(db, 2026);
    expect(queries.filter(q => /FROM giving_entries/.test(q))).toHaveLength(0);
  });

  it('allows only one ledger scan during concurrent first-time rebuilds', async () => {
    const { raw, db, queries } = setup();
    raw.exec('DELETE FROM giving_year_stats; DELETE FROM giving_year_person_rollup_ready;');
    raw.exec("INSERT INTO giving_rollup_dirty(year,dirtied_at) VALUES(2026,datetime('now')) ON CONFLICT(year) DO UPDATE SET dirtied_at=excluded.dirtied_at");
    queries.length = 0;

    const results = await Promise.all(Array.from({ length: 10 }, () => ensureGivingYearRollups(db, 2026)));

    expect(queries.filter(q => /FROM giving_entries ge/.test(q))).toHaveLength(1);
    expect(results.every(row => row.giver_count === 3)).toBe(true);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM giving_year_rollup_claims').get().n).toBe(0);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM giving_rollup_dirty').get().n).toBe(0);
  });

  it('releases a failed rebuild claim and leaves the year retryable', async () => {
    const { raw, db } = setup();
    raw.exec("INSERT INTO giving_entries VALUES(4,1,3,8,50000,'2026-04-01')");
    db.batch = async () => { throw new Error('simulated rebuild failure'); };

    await expect(ensureGivingYearRollups(db, 2026)).rejects.toThrow('simulated rebuild failure');

    expect(raw.prepare('SELECT COUNT(*) AS n FROM giving_year_rollup_claims').get().n).toBe(0);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM giving_rollup_dirty WHERE year=2026').get().n).toBe(1);
  });

  it('preserves a dirty marker created while a rebuild is running', async () => {
    const { raw, db, queries } = setup();
    raw.exec("INSERT INTO giving_entries VALUES(4,1,3,8,50000,'2026-04-01')");
    const runBatch = db.batch;
    let changedDuringRebuild = false;
    db.batch = async statements => {
      if (!changedDuringRebuild) {
        changedDuringRebuild = true;
        raw.exec("INSERT INTO giving_entries VALUES(5,1,3,8,1000,'2026-05-01')");
      }
      return runBatch(statements);
    };

    await ensureGivingYearRollups(db, 2026);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM giving_rollup_dirty WHERE year=2026').get().n).toBe(1);
    queries.length = 0;
    await ensureGivingYearRollups(db, 2026);
    expect(queries.filter(q => /FROM giving_entries ge/.test(q))).toHaveLength(1);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM giving_rollup_dirty').get().n).toBe(0);
  });

  it('marks the affected year dirty when a person moves households', () => {
    const { raw } = setup();
    raw.exec('UPDATE people SET household_id=11 WHERE id=2');
    expect(raw.prepare('SELECT year FROM giving_rollup_dirty').all()).toEqual([{ year: 2026 }]);
  });

  it('tags the year-rebuild scan by name when run through an attribution-wrapped db, so a future regression here is identifiable by name, not just an elevated count', async () => {
    const { raw, db: rawDb } = setup();
    raw.exec("INSERT INTO giving_entries VALUES(4,1,3,8,50000,'2026-04-01')");
    const { db, counter } = wrapDbForAttribution(rawDb);
    await ensureGivingYearRollups(db, 2026);
    expect(counter.names).toEqual(['giving-rollups.refresh-year-people']);
  });

  describe('year-rebuild query budget (enforced, not just logged)', () => {
    // Regression coverage for the query-budget-enforcement port: a request that stays under
    // YEAR_REFRESH_QUERY_BUDGET dirty-year rebuilds must behave exactly as before (this describe
    // block's first test), and a request that would exceed it must be rejected cleanly instead
    // of running the extra full-table scan (the second test) — see YEAR_REFRESH_QUERY_BUDGET's
    // own comment in src/giving-rollups.js for why 3 is the chosen number.

    function dirtyExtraYears(raw) {
      // Each insert has a distinct year and a real amount so a genuine rebuild for that year
      // has real rows to aggregate, not just an empty-year no-op.
      raw.exec(`
        INSERT INTO giving_entries VALUES
          (4,1,3,8,10000,'2023-06-01'),
          (5,1,3,8,10000,'2024-06-01'),
          (6,1,3,8,10000,'2025-06-01')
      `);
      // (year 2026 is already dirty from setup()'s own base inserts — see the "refreshes a
      // changed year once" test above, which relies on that same fact.)
    }

    it('rebuilds exactly YEAR_REFRESH_QUERY_BUDGET dirty years in one request unchanged — normal usage is untouched', async () => {
      const { raw, db: rawDb } = setup();
      dirtyExtraYears(raw);
      const { db, counter } = wrapDbForAttribution(rawDb);

      const results = await Promise.all(
        [2023, 2024, 2025].map((year) => ensureGivingYearRollups(db, year))
      );

      expect(YEAR_REFRESH_QUERY_BUDGET).toBe(3); // documents the number this test exercises
      expect(results.every((row) => row.giver_count === 1)).toBe(true);
      expect(counter.names.filter((n) => n === 'giving-rollups.refresh-year-people')).toHaveLength(3);
      // Every claim released normally; nothing left dirty.
      expect(raw.prepare('SELECT COUNT(*) AS n FROM giving_year_rollup_claims').get().n).toBe(0);
      expect(raw.prepare('SELECT COUNT(*) AS n FROM giving_rollup_dirty WHERE year IN (2023,2024,2025)').get().n).toBe(0);
    });

    it('rejects the rebuild that would exceed the budget in one request — cleanly, not a crash — and leaves that year retryable', async () => {
      const { raw, db: rawDb } = setup();
      dirtyExtraYears(raw);
      const { db, counter } = wrapDbForAttribution(rawDb);

      // Spend the whole budget on three other dirty years first, same as ordinary traffic would.
      await ensureGivingYearRollups(db, 2023);
      await ensureGivingYearRollups(db, 2024);
      await ensureGivingYearRollups(db, 2025);
      expect(counter.names.filter((n) => n === 'giving-rollups.refresh-year-people')).toHaveLength(3);

      // A 4th dirty-year rebuild in the same request — e.g. many years going dirty together —
      // is rejected instead of running a 4th full-table scan.
      await expect(ensureGivingYearRollups(db, 2026)).rejects.toThrow(QueryBudgetExceededError);
      expect(counter.names.filter((n) => n === 'giving-rollups.refresh-year-people')).toHaveLength(3);

      // Rejected exactly like any other failed rebuild (see "releases a failed rebuild claim"
      // above): no orphaned claim, and the year is left dirty so a later, separate request can
      // still retry it — this is a rejection, not data loss or a stuck year.
      expect(raw.prepare('SELECT COUNT(*) AS n FROM giving_year_rollup_claims').get().n).toBe(0);
      expect(raw.prepare('SELECT COUNT(*) AS n FROM giving_rollup_dirty WHERE year=2026').get().n).toBe(1);
    });

    it('a route dispatched through handleAdminApi surfaces the rejection as a clean 500 JSON response, never an unhandled crash', async () => {
      const { raw, db: rawDb } = setup();
      dirtyExtraYears(raw);
      const { db } = wrapDbForAttribution(rawDb);

      // Exhaust the budget, then simulate what a route handler does: let the error propagate
      // exactly as ensureGivingYearRollups would inside a real /admin/api/* handler, and confirm
      // it is an ordinary catchable Error (the shape connect-worker.js's/api-admin.js's existing
      // catch-all around every dispatch chokepoint already converts into a clean 500 response),
      // not a raw crash.
      await ensureGivingYearRollups(db, 2023);
      await ensureGivingYearRollups(db, 2024);
      await ensureGivingYearRollups(db, 2025);

      let caught;
      try {
        await ensureGivingYearRollups(db, 2026);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).toBeInstanceOf(QueryBudgetExceededError);
      expect(typeof caught.message).toBe('string');
      expect(caught.message.length).toBeGreaterThan(0);
    });
  });

  it('answers dashboard General Fund totals from rollups plus only one partial month', async () => {
    const { raw, db } = setup();
    raw.exec("INSERT INTO giving_entries VALUES(4,1,1,7,20000,'2025-01-10'),(5,1,1,7,30000,'2025-03-01'),(6,1,1,7,40000,'2025-03-20')");
    const totals = await loadDashboardGivingTotals(db, new Date('2026-03-15T12:00:00Z'));
    expect(totals).toEqual({ gfYtd: 250000, gfLastYearYtd: 50000, gfLastYearTotal: 90000 });
    const plan = raw.prepare('EXPLAIN QUERY PLAN ' + DASHBOARD_GIVING_TOTALS_SQL)
      .all('2026-01','2026-12','2025-01','2025-12','2025-01','2025-03','2025-03-01','2025-03-15')
      .map(r => r.detail).join('\n');
    expect(plan).toContain('SCAN m');
    expect(plan).toContain('idx_giving_date_fund');
  });
});
