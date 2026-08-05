import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleFinanceApi } from '../src/api-finance.js';

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0018_finance_church_entries.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0024_finance_budget_plan.sql', import.meta.url), 'utf8'));
  sqlite.exec(`CREATE TABLE chms_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`);
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
    async batch(stmts) { for (const s of stmts) await s.run(); },
    _raw: sqlite,
  };
}
function makeReq(body) { return { json: async () => body }; }

describe('handleFinanceApi — Church Budget Planning', () => {
  it('generate() compounds a growth rate forward across the target years', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({
      category: 'Utilities', classification: 'Expenses', base_amount: '20000', growth_pct: 0.05, target_years: [2027, 2028, 2029],
    }), {}, new URL('https://x/'), 'POST', 'finance/planning/church/generate', db, true, true);
    expect(res.status).toBe(200);
    const rows = db._raw.prepare('SELECT * FROM finance_budget_plan ORDER BY fiscal_year').all();
    expect(rows).toHaveLength(3);
    expect(rows[0].fiscal_year).toBe(2027);
    expect(rows[0].planned_amount_cents).toBe(Math.round(2000000 * 1.05));
    expect(rows[1].planned_amount_cents).toBe(Math.round(2000000 * 1.05 * 1.05));
    expect(rows[2].planned_amount_cents).toBe(Math.round(2000000 * 1.05 * 1.05 * 1.05));
    rows.forEach(r => expect(r.basis).toBe('grown'));
  });

  it('override() replaces a single year without disturbing the other generated years', async () => {
    const db = makeTestDb();
    await handleFinanceApi(makeReq({ category: 'Utilities', base_amount: '20000', growth_pct: 0.05, target_years: [2027, 2028] }), {}, new URL('https://x/'), 'POST', 'finance/planning/church/generate', db, true, true);
    const res = await handleFinanceApi(makeReq({ category: 'Utilities', fiscal_year: 2027, planned_amount: '19000' }), {}, new URL('https://x/'), 'POST', 'finance/planning/church/override', db, true, true);
    expect(res.status).toBe(200);
    const rows = db._raw.prepare('SELECT * FROM finance_budget_plan ORDER BY fiscal_year').all();
    expect(rows.find(r => r.fiscal_year === 2027).planned_amount_cents).toBe(1900000);
    expect(rows.find(r => r.fiscal_year === 2027).basis).toBe('manual');
    expect(rows.find(r => r.fiscal_year === 2028).basis).toBe('grown'); // untouched
  });

  it('deletes a single category/year plan row', async () => {
    const db = makeTestDb();
    await handleFinanceApi(makeReq({ category: 'Insurance', fiscal_year: 2027, planned_amount: '15000' }), {}, new URL('https://x/'), 'POST', 'finance/planning/church/override', db, true, true);
    await handleFinanceApi({}, {}, new URL('https://x/'), 'DELETE', 'finance/planning/church/Insurance/2027', db, true, true);
    const rows = db._raw.prepare('SELECT * FROM finance_budget_plan').all();
    expect(rows).toHaveLength(0);
  });

  it('commit() writes every planned category for a year into finance_church_entries as plan_committed', async () => {
    const db = makeTestDb();
    await handleFinanceApi(makeReq({ category: 'Salaries & Benefits', classification: 'Expenses', fiscal_year: 2027, planned_amount: '250000' }), {}, new URL('https://x/'), 'POST', 'finance/planning/church/override', db, true, true);
    await handleFinanceApi(makeReq({ category: 'Utilities', classification: 'Expenses', fiscal_year: 2027, planned_amount: '20000' }), {}, new URL('https://x/'), 'POST', 'finance/planning/church/override', db, true, true);
    const res = await handleFinanceApi(makeReq({ fiscal_year: 2027 }), {}, new URL('https://x/'), 'POST', 'finance/planning/church/commit', db, true, true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.committed).toBe(2);
    const rows = db._raw.prepare("SELECT * FROM finance_church_entries WHERE source='plan_committed' AND fiscal_year=2027").all();
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.category_path === 'Utilities').own_budget_cents).toBe(2000000);
  });

  it('re-committing the same year wholesale-replaces the prior plan_committed rows, not duplicates them', async () => {
    const db = makeTestDb();
    await handleFinanceApi(makeReq({ category: 'Utilities', fiscal_year: 2027, planned_amount: '20000' }), {}, new URL('https://x/'), 'POST', 'finance/planning/church/override', db, true, true);
    await handleFinanceApi(makeReq({ fiscal_year: 2027 }), {}, new URL('https://x/'), 'POST', 'finance/planning/church/commit', db, true, true);
    await handleFinanceApi(makeReq({ category: 'Utilities', fiscal_year: 2027, planned_amount: '21000' }), {}, new URL('https://x/'), 'POST', 'finance/planning/church/override', db, true, true);
    await handleFinanceApi(makeReq({ fiscal_year: 2027 }), {}, new URL('https://x/'), 'POST', 'finance/planning/church/commit', db, true, true);
    const rows = db._raw.prepare("SELECT * FROM finance_church_entries WHERE source='plan_committed' AND fiscal_year=2027").all();
    expect(rows).toHaveLength(1);
    expect(rows[0].own_budget_cents).toBe(2100000);
  });

  it('commit() fails cleanly when no plan rows exist for the requested year', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({ fiscal_year: 2099 }), {}, new URL('https://x/'), 'POST', 'finance/planning/church/commit', db, true, true);
    expect(res.status).toBe(400);
  });

  it('rejects writes from a non-admin', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({ category: 'Utilities', fiscal_year: 2027, planned_amount: '1000' }), {}, new URL('https://x/'), 'POST', 'finance/planning/church/override', db, false, true);
    expect(res.status).toBe(403);
  });

  it('GET returns all plan rows', async () => {
    const db = makeTestDb();
    await handleFinanceApi(makeReq({ category: 'Utilities', fiscal_year: 2027, planned_amount: '20000' }), {}, new URL('https://x/'), 'POST', 'finance/planning/church/override', db, true, true);
    const res = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/planning/church', db, true, true);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
  });
});

describe('handleFinanceApi — generate-all (plan mirrors the real chart of accounts)', () => {
  function seedBaseYearAccounts(db) {
    db._raw.prepare(
      `INSERT INTO finance_church_entries (fiscal_year,period_month,classification,category_path,account_name,depth,has_children,own_actual_cents,own_budget_cents,source,synced_at)
       VALUES (2026,0,'Expenses','Expenses:Utilities','Utilities',0,0,2000000,1900000,'qbo_sync','2026-01-01')`
    ).run();
    db._raw.prepare(
      `INSERT INTO finance_church_entries (fiscal_year,period_month,classification,category_path,account_name,depth,has_children,own_actual_cents,own_budget_cents,source,synced_at)
       VALUES (2026,0,'Expenses','Expenses:Salaries & Benefits','Salaries & Benefits',0,0,25000000,25000000,'qbo_sync','2026-01-01')`
    ).run();
    // An account with no actual AND no budget yet this year — nothing real to grow from.
    db._raw.prepare(
      `INSERT INTO finance_church_entries (fiscal_year,period_month,classification,category_path,account_name,depth,has_children,own_actual_cents,own_budget_cents,source,synced_at)
       VALUES (2026,0,'Expenses','Expenses:New Line','New Line',0,0,0,NULL,'qbo_sync','2026-01-01')`
    ).run();
  }

  it('generates one plan row per real account, using actual (falling back to budget) as the base', async () => {
    const db = makeTestDb();
    seedBaseYearAccounts(db);
    // through_week: 52 = treat the base year as complete, so this test is unaffected by
    // proration (covered separately below) regardless of what today's real date happens to be.
    const res = await handleFinanceApi(makeReq({ base_year: 2026, target_year: 2027, growth_pct: 0.03, through_week: 52 }), {}, new URL('https://x/'), 'POST', 'finance/planning/church/generate-all', db, true, true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.generated).toBe(2); // "New Line" skipped — nothing to grow from
    const rows = db._raw.prepare("SELECT * FROM finance_budget_plan WHERE fiscal_year=2027 ORDER BY category").all();
    expect(rows).toHaveLength(2);
    const utilities = rows.find(r => r.category === 'Expenses:Utilities');
    expect(utilities.planned_amount_cents).toBe(Math.round(2000000 * 1.03));
    expect(utilities.base_amount_cents).toBe(2000000); // used actual, not budget
  });

  it('fails cleanly when the base year has no Church Budget data at all', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({ base_year: 2099, target_year: 2100, growth_pct: 0.03 }), {}, new URL('https://x/'), 'POST', 'finance/planning/church/generate-all', db, true, true);
    expect(res.status).toBe(400);
  });

  it('annualizes a partial-year actual before applying growth, when the base year is still in progress', async () => {
    const db = makeTestDb();
    seedBaseYearAccounts(db);
    // 22 weeks elapsed — Utilities' $20,000 YTD actual should be annualized to $47,272.73-ish
    // (20000 * 52/22) before the 3% growth is applied, not treated as if it were the full year.
    const res = await handleFinanceApi(makeReq({ base_year: 2026, target_year: 2027, growth_pct: 0.03, through_week: 22 }), {}, new URL('https://x/'), 'POST', 'finance/planning/church/generate-all', db, true, true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prorated).toBe(true);
    expect(body.throughWeek).toBe(22);
    const rows = db._raw.prepare("SELECT * FROM finance_budget_plan WHERE fiscal_year=2027 ORDER BY category").all();
    const utilities = rows.find(r => r.category === 'Expenses:Utilities');
    const annualizedActual = Math.round(2000000 * (52 / 22));
    expect(utilities.base_amount_cents).toBe(annualizedActual);
    expect(utilities.planned_amount_cents).toBe(Math.round(annualizedActual * 1.03));
  });

  it('does not prorate a fully complete base year (through_week: 52)', async () => {
    const db = makeTestDb();
    seedBaseYearAccounts(db);
    const res = await handleFinanceApi(makeReq({ base_year: 2026, target_year: 2027, growth_pct: 0.03, through_week: 52 }), {}, new URL('https://x/'), 'POST', 'finance/planning/church/generate-all', db, true, true);
    const body = await res.json();
    expect(body.prorated).toBe(false);
    const rows = db._raw.prepare("SELECT * FROM finance_budget_plan WHERE fiscal_year=2027 ORDER BY category").all();
    expect(rows.find(r => r.category === 'Expenses:Utilities').base_amount_cents).toBe(2000000); // unprorated
  });
});

describe('handleFinanceApi — weeksElapsedInYear (used for base-year annualization)', () => {
  it('counts a full year as 52 weeks', async () => {
    const { weeksElapsedInYear } = await import('../src/api-finance.js');
    expect(weeksElapsedInYear(new Date(2026, 11, 31))).toBe(52);
  });
  it('floors at 1 week elapsed even on Jan 1 (avoids an absurd 52x multiplier)', async () => {
    const { weeksElapsedInYear } = await import('../src/api-finance.js');
    expect(weeksElapsedInYear(new Date(2026, 0, 1))).toBe(1);
  });
  it('matches the reported Aug 5 example: 217 days elapsed = exactly 31 weeks', async () => {
    const { weeksElapsedInYear } = await import('../src/api-finance.js');
    expect(weeksElapsedInYear(new Date(2026, 7, 5))).toBe(31);
  });
});

describe('handleFinanceApi — base-projection overrides (FY{base} Projected column)', () => {
  it('GET returns an empty overrides object when nothing has been saved', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/planning/base-projection', db, true, true);
    const body = await res.json();
    expect(body.overrides).toEqual({});
  });

  it('PUT saves a whole-dollar override for a category in a given base year', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({ year: 2026, rows: [{ category: 'Expenses:47020 MDO Tuition', amount: '640000' }] }), {}, new URL('https://x/'), 'PUT', 'finance/planning/base-projection', db, true, true);
    expect(res.status).toBe(200);
    const getRes = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/planning/base-projection', db, true, true);
    const body = await getRes.json();
    expect(body.overrides['2026']['Expenses:47020 MDO Tuition']).toBe(64000000); // cents, whole dollars
  });

  it('rounds a fractional amount to the nearest whole dollar before storing cents', async () => {
    const db = makeTestDb();
    await handleFinanceApi(makeReq({ year: 2026, rows: [{ category: 'Expenses:Utilities', amount: '1999.6' }] }), {}, new URL('https://x/'), 'PUT', 'finance/planning/base-projection', db, true, true);
    const getRes = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/planning/base-projection', db, true, true);
    const body = await getRes.json();
    expect(body.overrides['2026']['Expenses:Utilities']).toBe(200000); // rounds to $2000, not $1999.60
  });

  it('an empty amount removes a previously-saved override', async () => {
    const db = makeTestDb();
    await handleFinanceApi(makeReq({ year: 2026, rows: [{ category: 'Expenses:Utilities', amount: '2000' }] }), {}, new URL('https://x/'), 'PUT', 'finance/planning/base-projection', db, true, true);
    await handleFinanceApi(makeReq({ year: 2026, rows: [{ category: 'Expenses:Utilities', amount: '' }] }), {}, new URL('https://x/'), 'PUT', 'finance/planning/base-projection', db, true, true);
    const getRes = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/planning/base-projection', db, true, true);
    const body = await getRes.json();
    expect(body.overrides['2026']['Expenses:Utilities']).toBeUndefined();
  });

  it('rejects a non-admin write', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({ year: 2026, rows: [{ category: 'Expenses:Utilities', amount: '2000' }] }), {}, new URL('https://x/'), 'PUT', 'finance/planning/base-projection', db, false, true);
    expect(res.status).toBe(403);
  });
});

describe('handleFinanceApi — override-bulk', () => {
  it('saves multiple edited rows in one call', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({ rows: [
      { category: 'Expenses:Utilities', classification: 'Expenses', fiscal_year: 2027, planned_amount: '20600' },
      { category: 'Expenses:Salaries & Benefits', classification: 'Expenses', fiscal_year: 2027, planned_amount: '257500' },
    ] }), {}, new URL('https://x/'), 'POST', 'finance/planning/church/override-bulk', db, true, true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(2);
    const rows = db._raw.prepare('SELECT * FROM finance_budget_plan ORDER BY category').all();
    expect(rows).toHaveLength(2);
    rows.forEach(r => expect(r.basis).toBe('manual'));
  });

  it('rejects the whole batch if one row is malformed, saving nothing', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({ rows: [
      { category: 'Expenses:Utilities', fiscal_year: 2027, planned_amount: '20600' },
      { category: '', fiscal_year: 2027, planned_amount: '100' },
    ] }), {}, new URL('https://x/'), 'POST', 'finance/planning/church/override-bulk', db, true, true);
    expect(res.status).toBe(400);
    const rows = db._raw.prepare('SELECT * FROM finance_budget_plan').all();
    expect(rows).toHaveLength(0);
  });
});
