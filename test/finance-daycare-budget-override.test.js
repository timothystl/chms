import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleFinanceApi } from '../src/api-finance.js';

// Minimal D1-shaped wrapper around node:sqlite, same pattern as test/finance-property.test.js.
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE chms_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`);
  sqlite.exec(readFileSync(new URL('../migrations/0018_finance_church_entries.sql', import.meta.url), 'utf8'));
  sqlite.exec(`CREATE TABLE finance_daycare_entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    period       TEXT    NOT NULL DEFAULT '',
    category     TEXT    NOT NULL DEFAULT '',
    entry_type   TEXT    NOT NULL DEFAULT 'actual',
    amount_cents INTEGER NOT NULL DEFAULT 0,
    notes        TEXT    NOT NULL DEFAULT '',
    source       TEXT    NOT NULL DEFAULT 'manual',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
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
function daycareRows(db) { return db._raw.prepare('SELECT * FROM finance_daycare_entries ORDER BY category, entry_type').all(); }
function churchRow(fiscal_year, category_path, account_name, own_actual_cents) {
  return { fiscal_year, period_month: 0, classification: 'Expenses', category_path, account_name, depth: 1, has_children: 0, own_actual_cents, own_budget_cents: null, source: 'qbo_sync' };
}
function insertChurchRow(db, r) {
  db._raw.prepare(
    `INSERT INTO finance_church_entries (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source, synced_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`
  ).run(r.fiscal_year, r.period_month, r.classification, r.category_path, r.account_name, r.depth, r.has_children, r.own_actual_cents, r.own_budget_cents, r.source);
}

describe('finance/daycare/budget-override (directly-editable Budget cell)', () => {
  it('requires admin', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({ year: 2025, category: 'Tuition Income', budget: '300000' }), {}, new URL('https://x/'), 'POST', 'finance/daycare/budget-override', db, false, true);
    expect(res.status).toBe(403);
  });

  it('saves a budget override for one (year, category) cell', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi(makeReq({ year: 2025, category: 'Tuition Income', budget: '300000' }), {}, new URL('https://x/'), 'POST', 'finance/daycare/budget-override', db, true, true);
    expect(res.status).toBe(200);
    const rows = daycareRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ period: '2025', category: 'Tuition Income', entry_type: 'budget', amount_cents: 30000000, source: 'manual_budget_override' });
  });

  it('re-saving the same cell REPLACES the prior override instead of appending', async () => {
    const db = makeTestDb();
    await handleFinanceApi(makeReq({ year: 2025, category: 'Tuition Income', budget: '100000' }), {}, new URL('https://x/'), 'POST', 'finance/daycare/budget-override', db, true, true);
    await handleFinanceApi(makeReq({ year: 2025, category: 'Tuition Income', budget: '150000' }), {}, new URL('https://x/'), 'POST', 'finance/daycare/budget-override', db, true, true);
    const rows = daycareRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_cents).toBe(15000000);
  });

  it('an empty budget clears the override instead of inserting $0', async () => {
    const db = makeTestDb();
    await handleFinanceApi(makeReq({ year: 2025, category: 'Tuition Income', budget: '100000' }), {}, new URL('https://x/'), 'POST', 'finance/daycare/budget-override', db, true, true);
    await handleFinanceApi(makeReq({ year: 2025, category: 'Tuition Income', budget: '' }), {}, new URL('https://x/'), 'POST', 'finance/daycare/budget-override', db, true, true);
    expect(daycareRows(db)).toHaveLength(0);
  });

  it('does not touch entries from other sources (e.g. a church_budget_import actual row)', async () => {
    const db = makeTestDb();
    db._raw.prepare(`INSERT INTO finance_daycare_entries (period,category,entry_type,amount_cents,source) VALUES ('2025','Tuition Income','actual',28500000,'church_budget_import')`).run();
    await handleFinanceApi(makeReq({ year: 2025, category: 'Tuition Income', budget: '300000' }), {}, new URL('https://x/'), 'POST', 'finance/daycare/budget-override', db, true, true);
    const rows = daycareRows(db);
    expect(rows).toHaveLength(2);
    expect(rows.some(r => r.source === 'church_budget_import' && r.entry_type === 'actual')).toBe(true);
    expect(rows.some(r => r.source === 'manual_budget_override' && r.entry_type === 'budget')).toBe(true);
  });
});

describe('finance/daycare/allocation-config', () => {
  it('defaults to 50%/50% when nothing has been saved', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/daycare/allocation-config', db, true, true);
    const data = await res.json();
    expect(data).toEqual({ utilityPct: 0.5, insurancePct: 0.5 });
  });

  it('requires admin to update, and persists the new percentages', async () => {
    const db = makeTestDb();
    const denied = await handleFinanceApi(makeReq({ utilityPct: 0.5, insurancePct: 0.5 }), {}, new URL('https://x/'), 'PUT', 'finance/daycare/allocation-config', db, false, true);
    expect(denied.status).toBe(403);
    const ok = await handleFinanceApi(makeReq({ utilityPct: 0.3, insurancePct: 0.6 }), {}, new URL('https://x/'), 'PUT', 'finance/daycare/allocation-config', db, true, true);
    expect(ok.status).toBe(200);
    const getRes = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/daycare/allocation-config', db, true, true);
    expect(await getRes.json()).toEqual({ utilityPct: 0.3, insurancePct: 0.6 });
  });
});

describe('finance/daycare/allocation (live-computed from real church entries)', () => {
  it('computes the MDO share of church Utilities/Insurance actuals per requested year', async () => {
    const db = makeTestDb();
    insertChurchRow(db, churchRow(2025, 'Expenses:34 Utilities:34010 Electric', 'Electric', 1000000));
    insertChurchRow(db, churchRow(2025, 'Expenses:35 Insurance', 'Insurance', 400000));
    insertChurchRow(db, churchRow(2026, 'Expenses:34 Utilities:34010 Electric', 'Electric', 1200000));
    insertChurchRow(db, churchRow(2026, 'Expenses:35 Insurance', 'Insurance', 500000));

    const res = await handleFinanceApi({}, {}, new URL('https://x/?years=2025,2026'), 'GET', 'finance/daycare/allocation', db, true, true);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.utilityPct).toBe(0.5);
    expect(data.allocation[2025]).toEqual({ utilityActualCents: 1000000, insuranceActualCents: 400000, mdoUtilityCents: 500000, mdoInsuranceCents: 200000 });
    expect(data.allocation[2026]).toEqual({ utilityActualCents: 1200000, insuranceActualCents: 500000, mdoUtilityCents: 600000, mdoInsuranceCents: 250000 });
  });

  it('requires a years param', async () => {
    const db = makeTestDb();
    const res = await handleFinanceApi({}, {}, new URL('https://x/'), 'GET', 'finance/daycare/allocation', db, true, true);
    expect(res.status).toBe(400);
  });
});
