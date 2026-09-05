import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleReportsApi } from '../src/api-reports.js';

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE giving_batches(id INTEGER PRIMARY KEY,batch_date TEXT NOT NULL DEFAULT '');
    CREATE TABLE funds(id INTEGER PRIMARY KEY,name TEXT NOT NULL DEFAULT '');
    CREATE TABLE people(id INTEGER PRIMARY KEY,first_name TEXT,last_name TEXT,member_type TEXT,household_id INTEGER);
    CREATE TABLE giving_entries(id INTEGER PRIMARY KEY,batch_id INTEGER,person_id INTEGER,
      fund_id INTEGER,amount INTEGER,contribution_date TEXT NOT NULL DEFAULT '');
    INSERT INTO giving_batches VALUES(1,'2026-01-01');
    INSERT INTO funds VALUES(1,'General Fund');
    INSERT INTO people VALUES
      (1,'Alice','Able','member',10),(2,'Bob','Baker','member',11),(3,'Org','Gift','organization',12);
  `);
  sqlite.exec(readFileSync(new URL('../migrations/0044_giving_monthly_fund_totals.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0045_giving_year_person_totals.sql', import.meta.url), 'utf8'));
  const insert = sqlite.prepare(
    'INSERT INTO giving_entries(batch_id,person_id,fund_id,amount,contribution_date) VALUES(1,?,?,?,?)'
  );
  insert.run(1,1,10000,'2025-01-01');
  insert.run(1,1,10000,'2025-02-01');
  insert.run(2,1,5000,'2025-03-01');
  insert.run(1,1,20000,'2026-01-01');
  insert.run(3,1,90000,'2026-02-01');
  insert.run(null,1,30000,'2026-03-01');

  const sqlLog = [];
  const db = {
    prepare(sql) {
      sqlLog.push(sql);
      const bound = args => ({
        async run() { sqlite.prepare(sql).run(...args); },
        async first() { return sqlite.prepare(sql).get(...args); },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      });
      return { bind: (...args) => bound(args), ...bound([]) };
    },
    async batch(statements) { for (const statement of statements) await statement.run(); },
  };
  return { db, sqlLog };
}

async function loadInsights(db) {
  const url = new URL('https://x/admin/api/reports/giving-insights?year=2026');
  const response = await handleReportsApi({}, {}, url, 'GET', 'reports/giving-insights', db, true, true, true, true);
  return response.json();
}

describe('giving insights read models', () => {
  it('serves the month-by-month Giving Trend tile from monthly summaries', async () => {
    const { db, sqlLog } = setup();
    sqlLog.length = 0;
    const url = new URL('https://x/admin/api/reports/giving-trend?years=2025,2026');
    const response = await handleReportsApi({}, {}, url, 'GET', 'reports/giving-trend', db, true, true, true, true);
    const result = await response.json();

    expect(result.monthly['2025']).toEqual([
      { month: '01', total_cents: 10000 },
      { month: '02', total_cents: 10000 },
      { month: '03', total_cents: 5000 },
    ]);
    expect(sqlLog.filter(sql => /FROM giving_entries/.test(sql))).toHaveLength(0);
  });

  it('preserves top, lapsed, frequency, and trend semantics', async () => {
    const { db } = setup();
    const result = await loadInsights(db);

    expect(result.top_givers.map(row => [row.id,row.gifts,row.total_cents])).toEqual([
      [3,1,90000], [1,1,20000],
    ]);
    expect(result.lapsed.map(row => [row.id,row.prior_gifts,row.prior_total_cents])).toEqual([[2,1,5000]]);
    expect(result.frequency.map(bucket => bucket.n)).toEqual([2,0,0,0,0]);
    expect(result.trend.slice(-2)).toEqual([
      { year: 2025, gifts: 3, givers: 2, total_cents: 25000, avg_gift_cents: 8333, avg_giver_cents: 12500 },
      { year: 2026, gifts: 3, givers: 2, total_cents: 140000, avg_gift_cents: 46667, avg_giver_cents: 70000 },
    ]);
  });

  it('scans each requested year once, then never reads individual gifts normally', async () => {
    const { db, sqlLog } = setup();
    await loadInsights(db);
    expect(sqlLog.filter(sql => /FROM giving_entries/.test(sql))).toHaveLength(5);

    sqlLog.length = 0;
    await loadInsights(db);
    expect(sqlLog.filter(sql => /FROM giving_entries/.test(sql))).toHaveLength(0);
    expect(sqlLog.some(sql => /giving_year_person_totals/.test(sql))).toBe(true);
    expect(sqlLog.some(sql => /giving_monthly_fund_totals/.test(sql))).toBe(true);
  });

  it('keeps normal reads bounded when the ledger grows to production size', async () => {
    const { db, sqlLog } = setup();
    // The small semantic fixture above is sufficient for correctness; this guard pins the
    // architecture instead: a 20,000-gift ledger must not appear in any normal-read query.
    // (The test wrapper deliberately exposes no raw handle, so add the scale through D1-shaped
    // statements and keep the assertion on the SQL boundary that determines billed row reads.)
    const statements = [];
    for (let i = 0; i < 20000; i++) {
      statements.push(db.prepare(
        'INSERT INTO giving_entries(batch_id,person_id,fund_id,amount,contribution_date) VALUES(1,1,1,100,?)'
      ).bind(`${2026}-${String((i % 12) + 1).padStart(2,'0')}-15`));
    }
    for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100));
    await loadInsights(db);

    sqlLog.length = 0;
    const result = await loadInsights(db);
    expect(result.trend.at(-1).gifts).toBe(20003);
    expect(sqlLog.filter(sql => /FROM giving_entries/.test(sql))).toHaveLength(0);
  }, 15000);
});
