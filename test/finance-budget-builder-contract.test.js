import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { buildFinanceBudgetBuilderV1 } from '../src/api-budget-builder-contracts.js';
import { handleContractsServiceApi } from '../src/api-contracts-service.js';

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).filter((n) => n.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
  }
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    async run() { sqlite.prepare(sql).run(...args); return {}; },
    async first() { return sqlite.prepare(sql).get(...args); },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  return { prepare: (sql) => statement(sql), _raw: sqlite };
}

function seed(db) {
  const entry = db._raw.prepare(`INSERT INTO finance_church_entries (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source, synced_at)
    VALUES (?, 0, ?, ?, ?, 1, ?, ?, ?, ?, '2026-09-01')`);
  // FY2025 actuals
  entry.run(2025, 'Income', 'Income:Offerings', 'Offerings', 0, 91845000, 96000000, 'import');
  entry.run(2025, 'Expenses', 'Expenses:Utilities', 'Utilities', 0, 8390000, 8800000, 'import');
  // FY2026: in progress; a parent row that must be left out; an override on utilities' actual
  entry.run(2026, 'Income', 'Income', 'Income', 1, 50000000, 96000000, 'qbo_sync');
  entry.run(2026, 'Income', 'Income:Offerings', 'Offerings', 0, 50000000, 96000000, 'qbo_sync');
  entry.run(2026, 'Expenses', 'Expenses:Utilities', 'Utilities', 0, 4000000, 8800000, 'qbo_sync');
  entry.run(2026, 'Expenses', 'Expenses:Missions', 'Missions', 0, 0, 9600000, 'qbo_sync');
  const plan = db._raw.prepare(`INSERT INTO finance_budget_plan (category, classification, fiscal_year, planned_amount_cents, basis, growth_pct, base_amount_cents, notes) VALUES (?, ?, 2027, ?, ?, ?, ?, ?)`);
  plan.run('Income:Offerings', 'Income', 94600400, 'grown', 0.03, 91845000, '');
  plan.run('Expenses:Missions', 'Expenses', 9600000, 'manual', null, null, 'Council goal');
  plan.run('Expenses:New line', 'Expenses', 100000, 'manual', null, null, '');
  db._raw.prepare(`INSERT INTO finance_settings (key, value) VALUES ('finance_base_proj_overrides', ?)`).run(JSON.stringify({ 2026: { 'Expenses:Utilities': 8424000 } }));
}

describe('connect.finance-budget-builder.v1', () => {
  it('lines up each plan line with the prior actual, base budget and base projection', async () => {
    const db = makeDb();
    seed(db);
    const b = await buildFinanceBudgetBuilderV1(db, { targetYear: 2027, now: new Date(2026, 8, 20) });
    expect(b).toMatchObject({ targetYear: 2027, baseYear: 2026, priorYear: 2025, prorated: true });
    const by = Object.fromEntries(b.lines.map((l) => [l.category, l]));
    expect(Object.keys(by)).not.toContain('Income');
    expect(b.lines[0].classification).toBe('Income');
    expect(by['Income:Offerings']).toMatchObject({ name: 'Offerings', priorActualCents: 91845000, baseBudgetCents: 96000000, projectedOverridden: false });
    // Sep 20 is about week 37.6, so the year-to-date actual is extended by roughly 52/37.6.
    expect(by['Income:Offerings'].projectedCents / (50000000 * (52 / b.throughWeek))).toBeCloseTo(1, 2);
    expect(by['Income:Offerings'].plan).toMatchObject({ plannedAmountCents: 94600400, basis: 'grown', growthPct: 0.03 });
    expect(by['Expenses:Utilities']).toMatchObject({ projectedCents: 8424000, projectedOverridden: true, plan: null });
    expect(by['Expenses:Missions']).toMatchObject({ projectedCents: 9600000, plan: { basis: 'manual', notes: 'Council goal' } });
    expect(by['Expenses:New line']).toMatchObject({ name: 'New line', priorActualCents: null, baseBudgetCents: null, projectedCents: null });
  });

  it('uses the full actual once the base year is over, and requires the key and a year', async () => {
    const db = makeDb();
    seed(db);
    const b = await buildFinanceBudgetBuilderV1(db, { targetYear: 2027, now: new Date(2027, 1, 1) });
    expect(b.prorated).toBe(false);
    expect(b.lines.find((l) => l.category === 'Income:Offerings').projectedCents).toBe(50000000);
    const call = (q, key = 'k') => handleContractsServiceApi(new Request(`https://c.example/api/contracts/finance-budget-builder-v1${q}`, { headers: { 'X-Contract-Key': key } }), { DB: db, FINANCE_CONTRACT_API_KEY: 'k' }, '/api/contracts/finance-budget-builder-v1');
    expect((await call('?target_year=2027')).status).toBe(200);
    expect((await call('?target_year=x')).status).toBe(400);
    expect((await call('?target_year=2027', 'bad')).status).toBe(401);
  });
});
