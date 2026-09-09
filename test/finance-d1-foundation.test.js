import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../apps/finance/migrations/0001_finance_foundation.sql', import.meta.url), 'utf8');
const compensationSql = readFileSync(new URL('../apps/finance/migrations/0002_finance_compensation_staging.sql', import.meta.url), 'utf8');
const fixtures = readFileSync(new URL('../apps/finance/fixtures/0001_synthetic_staging.sql', import.meta.url), 'utf8');
const compensationFixtures = readFileSync(new URL('../apps/finance/fixtures/0002_synthetic_compensation.sql', import.meta.url), 'utf8');
const historyFixtures = readFileSync(new URL('../apps/finance/fixtures/0003_synthetic_church_history.sql', import.meta.url), 'utf8');
const expected = [
  'finance_budget_plan', 'finance_church_balances', 'finance_church_entries',
  'finance_compensation_plan', 'finance_daycare_entries', 'finance_daycare_rooms', 'finance_import_log',
  'finance_property_budget_monthly', 'finance_property_capital_ledger',
  'finance_property_distributions', 'finance_property_monthly', 'finance_property_repairs',
  'finance_property_reserve_disbursements', 'finance_property_reserves', 'finance_settings',
];

describe('Finance isolated D1 foundation', () => {
  it('creates exactly the Finance-owned tables from an empty database', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(sql);
    db.exec(compensationSql);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => name);
    expect(tables).toEqual(expected);
    for (const table of expected) expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n).toBe(0);
  });

  it('does not recreate shared or retired credential stores', () => {
    expect(sql).not.toMatch(/CREATE TABLE\s+(chms_config|funds|giving_|finance_qb_connection|finance_qb_snapshot)/i);
    expect(sql).not.toMatch(/access_token|refresh_token|realm_id/i);
  });

  it('loads deterministic synthetic controls without personal or production markers', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(sql);
    db.exec(compensationSql);
    db.exec(fixtures);
    db.exec(compensationFixtures);
    db.exec(historyFixtures);
    expect(db.prepare('SELECT SUM(own_actual_cents) AS n FROM finance_church_entries').get().n).toBe(38800000);
    expect(db.prepare('SELECT COUNT(DISTINCT fiscal_year) AS n FROM finance_church_entries').get().n).toBe(2);
    expect(db.prepare('SELECT SUM(own_balance_cents) AS n FROM finance_church_balances').get().n).toBe(60000000);
    expect(db.prepare('SELECT COUNT(*) AS n FROM finance_daycare_rooms').get().n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM finance_compensation_plan').get().n).toBe(2);
    expect(db.prepare("SELECT value FROM finance_settings WHERE key='fixture_label'").get().value).toBe('SYNTHETIC-NO-PRODUCTION-DATA');
    expect(fixtures).not.toMatch(/@|access_token|refresh_token|realm_id/i);
    expect(compensationFixtures).not.toMatch(/@|access_token|refresh_token|realm_id/i);
    expect(historyFixtures).not.toMatch(/@|access_token|refresh_token|realm_id/i);
  });
});
