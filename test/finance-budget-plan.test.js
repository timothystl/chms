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
