import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../apps/finance/migrations/0001_finance_foundation.sql', import.meta.url), 'utf8');
const compensationSql = readFileSync(new URL('../apps/finance/migrations/0002_finance_compensation_staging.sql', import.meta.url), 'utf8');
const accountPresentationSql = readFileSync(new URL('../apps/finance/migrations/0003_finance_account_presentation.sql', import.meta.url), 'utf8');
const propertyValuationSql = readFileSync(new URL('../apps/finance/migrations/0004_finance_property_valuation.sql', import.meta.url), 'utf8');
const fixtures = readFileSync(new URL('../apps/finance/fixtures/0001_synthetic_staging.sql', import.meta.url), 'utf8');
const compensationFixtures = readFileSync(new URL('../apps/finance/fixtures/0002_synthetic_compensation.sql', import.meta.url), 'utf8');
const historyFixtures = readFileSync(new URL('../apps/finance/fixtures/0003_synthetic_church_history.sql', import.meta.url), 'utf8');
const balanceHistoryFixtures = readFileSync(new URL('../apps/finance/fixtures/0004_synthetic_balance_history.sql', import.meta.url), 'utf8');
const propertyReserveFixtures = readFileSync(new URL('../apps/finance/fixtures/0005_synthetic_property_reserves.sql', import.meta.url), 'utf8');
const daycareBudgetAllocationFixtures = readFileSync(new URL('../apps/finance/fixtures/0006_synthetic_daycare_budget_allocation.sql', import.meta.url), 'utf8');
const budgetOutlookFixtures = readFileSync(new URL('../apps/finance/fixtures/0007_synthetic_budget_outlook.sql', import.meta.url), 'utf8');
const accountPresentationFixtures = readFileSync(new URL('../apps/finance/fixtures/0008_synthetic_account_presentation.sql', import.meta.url), 'utf8');
const propertyValuationFixtures = readFileSync(new URL('../apps/finance/fixtures/0009_synthetic_property_valuation.sql', import.meta.url), 'utf8');
const expected = [
  'finance_account_presentation', 'finance_budget_plan', 'finance_church_balances', 'finance_church_entries',
  'finance_compensation_plan', 'finance_daycare_entries', 'finance_daycare_rooms', 'finance_import_log',
  'finance_property_budget_monthly', 'finance_property_capital_ledger',
  'finance_property_distributions', 'finance_property_monthly', 'finance_property_operating_costs',
  'finance_property_rent_roll', 'finance_property_repairs', 'finance_property_reserve_disbursements',
  'finance_property_reserves', 'finance_property_valuation_assumptions', 'finance_settings',
];

describe('Finance isolated D1 foundation', () => {
  it('creates exactly the Finance-owned tables from an empty database', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(sql);
    db.exec(compensationSql);
    db.exec(accountPresentationSql);
    db.exec(propertyValuationSql);
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
    db.exec(accountPresentationSql);
    db.exec(propertyValuationSql);
    db.exec(fixtures);
    db.exec(compensationFixtures);
    db.exec(historyFixtures);
    db.exec(balanceHistoryFixtures);
    db.exec(propertyReserveFixtures);
    db.exec(daycareBudgetAllocationFixtures);
    db.exec(budgetOutlookFixtures);
    db.exec(accountPresentationFixtures);
    db.exec(propertyValuationFixtures);
    expect(db.prepare('SELECT SUM(own_actual_cents) AS n FROM finance_church_entries').get().n).toBe(40500000);
    expect(db.prepare('SELECT COUNT(DISTINCT fiscal_year) AS n FROM finance_church_entries').get().n).toBe(2);
    expect(db.prepare('SELECT SUM(own_balance_cents) AS n FROM finance_church_balances').get().n).toBe(114000000);
    expect(db.prepare('SELECT COUNT(DISTINCT fiscal_year) AS n FROM finance_church_balances').get().n).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS n FROM finance_daycare_rooms').get().n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM finance_daycare_entries').get().n).toBe(4);
    expect(db.prepare('SELECT COUNT(*) AS n FROM finance_compensation_plan').get().n).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM finance_property_reserves WHERE property_key='synthetic-property'").get().n).toBe(3);
    expect(db.prepare("SELECT COUNT(*) AS n FROM finance_budget_plan WHERE basis='synthetic_fixture'").get().n).toBe(2);
    expect(db.prepare("SELECT SUM(planned_amount_cents - base_amount_cents) AS n FROM finance_budget_plan WHERE basis='synthetic_fixture'").get().n).toBe(2200000);
    expect(db.prepare("SELECT COUNT(*) AS n FROM finance_account_presentation WHERE source='synthetic_fixture'").get().n).toBe(2);
    expect(db.prepare("SELECT COUNT(DISTINCT purpose_tag_id) AS n FROM finance_account_presentation WHERE source='synthetic_fixture'").get().n).toBe(1);
    expect(db.prepare("SELECT SUM(annual_rent_cents) AS n FROM finance_property_rent_roll WHERE source='synthetic_fixture'").get().n).toBe(6000000);
    expect(db.prepare("SELECT SUM(annual_cost_cents) AS n FROM finance_property_operating_costs WHERE source='synthetic_fixture'").get().n).toBe(3000000);
    expect(db.prepare("SELECT value FROM finance_settings WHERE key='fixture_label'").get().value).toBe('SYNTHETIC-NO-PRODUCTION-DATA');
    expect(fixtures).not.toMatch(/@|access_token|refresh_token|realm_id/i);
    expect(compensationFixtures).not.toMatch(/@|access_token|refresh_token|realm_id/i);
    expect(historyFixtures).not.toMatch(/@|access_token|refresh_token|realm_id/i);
    expect(balanceHistoryFixtures).not.toMatch(/@|access_token|refresh_token|realm_id/i);
    expect(propertyReserveFixtures).not.toMatch(/@|access_token|refresh_token|realm_id/i);
    expect(daycareBudgetAllocationFixtures).not.toMatch(/@|access_token|refresh_token|realm_id/i);
    expect(budgetOutlookFixtures).not.toMatch(/@|access_token|refresh_token|realm_id/i);
    expect(accountPresentationFixtures).not.toMatch(/@|access_token|refresh_token|realm_id/i);
    expect(propertyValuationFixtures).not.toMatch(/@|access_token|refresh_token|realm_id/i);
  });
});
