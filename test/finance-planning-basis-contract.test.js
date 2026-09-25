import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
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

const call = (db, query, key = 'right-secret') => handleContractsServiceApi(
  new Request(`https://connect.example/api/contracts/finance-planning-basis-v1${query}`, { headers: { 'X-Contract-Key': key } }),
  { DB: db, FINANCE_CONTRACT_API_KEY: 'right-secret' },
  '/api/contracts/finance-planning-basis-v1',
);

describe('connect.finance-planning-basis.v1', () => {
  it('returns the plan lines sorted into scenario groups, honoring saved mappings', async () => {
    const db = makeDb();
    const insert = db._raw.prepare("INSERT INTO finance_budget_plan (category, classification, fiscal_year, planned_amount_cents, basis) VALUES (?, ?, 2027, ?, 'manual')");
    insert.run('Offerings', 'Income', 94600400);
    insert.run('Ivanhoe distributions', 'Income', 14688000);
    insert.run('Mothers Day Out tuition', 'Income', 9984000);
    insert.run('Special gifts', 'Income', 500000);
    insert.run('Salaries', 'Expenses', 74420600);
    insert.run('Building maintenance', 'Expenses', 26208000);
    insert.run('Worship', 'Expenses', 3000000);
    db._raw.prepare("INSERT INTO finance_settings (key, value) VALUES ('finance_revenue_streams', ?)").run(JSON.stringify({ map: { 'Special gifts': 'restricted' } }));
    const res = await call(db, '?fiscal_year=2027');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract).toBe('connect.finance-planning-basis.v1');
    const group = Object.fromEntries(body.lines.map((l) => [l.category, l.group]));
    expect(group).toEqual({
      Offerings: 'donor', 'Ivanhoe distributions': 'passive', 'Mothers Day Out tuition': 'earned', 'Special gifts': 'restricted',
      Salaries: 'salaries', 'Building maintenance': 'property', Worship: 'programs',
    });
    expect(body.totals).toEqual({ plannedIncomeCents: 94600400 + 14688000 + 9984000 + 500000, plannedExpenseCents: 74420600 + 26208000 + 3000000 });
  });

  it('requires the contract key and a fiscal year', async () => {
    const db = makeDb();
    expect((await call(db, '?fiscal_year=2027', 'wrong')).status).toBe(401);
    expect((await call(db, '?fiscal_year=abc')).status).toBe(400);
    expect((await (await call(db, '?fiscal_year=2027')).json()).lines).toEqual([]);
  });
});
