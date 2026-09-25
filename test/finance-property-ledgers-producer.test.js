import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildFinancePropertyLedgersV1 } from '../src/api-contracts.js';
import { validateFinancePropertyLedgersV1 } from '../contracts/validators/finance-property-ledgers-consumer.js';

// finance_property_capital_ledger/finance_property_repairs are migrations/0023 (production
// ledger), not part of migrations/0001_baseline.sql -- same reason Property Valuation's producer
// test adds finance_settings as EXTRA_SCHEMA. Column-for-column identical to that migration's
// real CREATE TABLE statements.
const EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS finance_property_capital_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, property_key TEXT NOT NULL DEFAULT 'ivanhoe',
  entry_date TEXT NOT NULL DEFAULT '', amount_cents INTEGER NOT NULL DEFAULT 0,
  payee TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  check_ref TEXT NOT NULL DEFAULT '', project TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS finance_property_repairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, property_key TEXT NOT NULL DEFAULT 'ivanhoe',
  entry_date TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER, payee TEXT NOT NULL DEFAULT '', capitalized INTEGER NOT NULL DEFAULT 0
);
`;

function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_baseline.sql', import.meta.url), 'utf8'));
  sqlite.exec(EXTRA_SCHEMA);
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { sqlite.prepare(sql).run(...args); },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async run(...args) { sqlite.prepare(sql).run(...args); },
        async first(...args) { return sqlite.prepare(sql).get(...args); },
        async all(...args) { return { results: sqlite.prepare(sql).all(...args) }; },
      };
    },
    _raw: sqlite,
  };
}

describe('buildFinancePropertyLedgersV1', () => {
  it('reflects real-shaped capital/repairs rows -- an empty entry_date, a month-only entry_date, and a null repair amount -- and produces a valid contract', async () => {
    const db = makeTestDb();
    // Real id=1 row confirmed live 2026-09-15: an opening-balance entry with no date at all.
    db._raw.prepare(`INSERT INTO finance_property_capital_ledger (property_key,entry_date,amount_cents,payee,description,check_ref,project,sort_order) VALUES (?,?,?,?,?,?,?,?)`)
      .run('ivanhoe', '', 988700, 'Unknown (predates available reports)', 'Opening balance', '', '1st-floor apartment renovation', 0);
    // Real id=2 row: a month-only entry_date, and a null (not-yet-billed) amount.
    db._raw.prepare(`INSERT INTO finance_property_repairs (property_key,entry_date,category,description,amount_cents,payee,capitalized) VALUES (?,?,?,?,?,?,?)`)
      .run('ivanhoe', '2024-11', 'Roof', 'Roof leak during heavy rains', null, 'Innovative Roofing', 0);
    db._raw.prepare(`INSERT INTO finance_property_repairs (property_key,entry_date,category,description,amount_cents,payee,capitalized) VALUES (?,?,?,?,?,?,?)`)
      .run('ivanhoe', '2024-09-11', 'Appliance', 'Appliance replacement', 77598, 'Slyman Bros', 0);

    const result = await buildFinancePropertyLedgersV1(db, { propertyKey: 'ivanhoe', now: new Date('2026-09-15T12:00:00Z') });
    const validation = validateFinancePropertyLedgersV1(result);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);

    expect(result.capital).toHaveLength(1);
    expect(result.capital[0].entryDate).toBe('');
    expect(result.capital[0].amountCents).toBe(988700);

    expect(result.repairs).toHaveLength(2);
    const roofRow = result.repairs.find((r) => r.entryDate === '2024-11');
    expect(roofRow.amountCents).toBeNull();
    expect(roofRow.capitalized).toBe(false);

    expect(result.totals).toEqual({ capitalCents: 988700, repairsCents: 77598 });
    // Row ids travel so Finance can target the legacy per-row DELETE routes.
    expect(result.capital[0].id).toBe(1);
    expect(result.repairs.map((r) => r.id).sort()).toEqual([1, 2]);
  });

  it('answers with a valid, empty contract (not a 500) when nothing has been recorded for this property yet', async () => {
    const db = makeTestDb();
    const result = await buildFinancePropertyLedgersV1(db, { propertyKey: 'ivanhoe', now: new Date('2026-09-15T12:00:00Z') });
    expect(result.capital).toEqual([]);
    expect(result.repairs).toEqual([]);
    expect(result.totals).toEqual({ capitalCents: 0, repairsCents: 0 });
    expect(validateFinancePropertyLedgersV1(result).ok).toBe(true);
  });

  it('does not leak a different property\'s rows into this property\'s contract', async () => {
    const db = makeTestDb();
    db._raw.prepare(`INSERT INTO finance_property_capital_ledger (property_key,entry_date,amount_cents,project) VALUES (?,?,?,?)`)
      .run('ivanhoe', '2026-01-01', 100, 'Real project');
    db._raw.prepare(`INSERT INTO finance_property_capital_ledger (property_key,entry_date,amount_cents,project) VALUES (?,?,?,?)`)
      .run('other', '2026-01-01', 999999, 'Someone else\'s project');
    const result = await buildFinancePropertyLedgersV1(db, { propertyKey: 'ivanhoe', now: new Date('2026-09-15T12:00:00Z') });
    expect(result.capital).toHaveLength(1);
    expect(result.capital[0].amountCents).toBe(100);
  });
});
