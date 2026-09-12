import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migrateFinanceSettingsFromConfig } from '../src/db.js';

// Minimal D1-shaped wrapper around node:sqlite, same pattern as test/finance-property.test.js.
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE chms_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`);
  sqlite.exec(`CREATE TABLE finance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
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
        async run() { sqlite.prepare(sql).run(); },
        async first() { return sqlite.prepare(sql).get(); },
        async all() { return { results: sqlite.prepare(sql).all() }; },
      };
    },
    _raw: sqlite,
  };
}

describe('migrateFinanceSettingsFromConfig', () => {
  it('moves every Finance-owned key (including wildcard council overlays) out of chms_config, and marks itself done', async () => {
    const db = makeTestDb();
    db._raw.exec(`INSERT INTO chms_config (key,value) VALUES
      ('finance_property_ivanhoe_meta','{"loan":{"balance_cents":1}}'),
      ('finance_cash_policy','{"policy_floor_months":3}'),
      ('finance_salary_planner','{"roster":[]}'),
      ('finance_budget_council_elder1','{"2026":{}}'),
      ('finance_salary_planner_council_elder1','{"compMethod":"custom"}'),
      ('schema_fingerprint','abc123'),
      ('giving_breeze_dedupe_v1','1')`);

    await migrateFinanceSettingsFromConfig(db);

    const moved = ['finance_property_ivanhoe_meta', 'finance_cash_policy', 'finance_salary_planner',
      'finance_budget_council_elder1', 'finance_salary_planner_council_elder1'];
    for (const key of moved) {
      expect(db._raw.prepare('SELECT value FROM finance_settings WHERE key=?').get(key), key).toBeTruthy();
      expect(db._raw.prepare('SELECT value FROM chms_config WHERE key=?').get(key), key).toBeFalsy();
    }
    expect(JSON.parse(db._raw.prepare("SELECT value FROM finance_settings WHERE key='finance_cash_policy'").get().value))
      .toEqual({ policy_floor_months: 3 });

    // Untouched: genuinely shared/system keys never move.
    expect(db._raw.prepare("SELECT value FROM chms_config WHERE key='schema_fingerprint'").get().value).toBe('abc123');
    expect(db._raw.prepare("SELECT value FROM chms_config WHERE key='giving_breeze_dedupe_v1'").get().value).toBe('1');
    expect(db._raw.prepare("SELECT value FROM finance_settings WHERE key='schema_fingerprint'").get()).toBeFalsy();

    expect(db._raw.prepare("SELECT value FROM chms_config WHERE key='finance_settings_migrated_v1'").get().value).toBe('1');
  });

  it('is idempotent — a second run is a no-op once the marker is set', async () => {
    const db = makeTestDb();
    db._raw.exec(`INSERT INTO chms_config (key,value) VALUES ('finance_cash_policy','{"policy_floor_months":3}')`);
    await migrateFinanceSettingsFromConfig(db);
    // Simulate an admin re-editing the setting directly in chms_config after the migration ran
    // (shouldn't happen in practice, but proves the marker actually short-circuits re-copying).
    db._raw.exec(`INSERT INTO chms_config (key,value) VALUES ('finance_cash_policy','{"policy_floor_months":6}')`);
    await migrateFinanceSettingsFromConfig(db);
    expect(JSON.parse(db._raw.prepare("SELECT value FROM finance_settings WHERE key='finance_cash_policy'").get().value))
      .toEqual({ policy_floor_months: 3 });
  });

  it('does nothing on a fresh database with no Finance keys to move', async () => {
    const db = makeTestDb();
    await migrateFinanceSettingsFromConfig(db);
    expect(db._raw.prepare("SELECT value FROM chms_config WHERE key='finance_settings_migrated_v1'").get().value).toBe('1');
    expect(db._raw.prepare('SELECT COUNT(*) AS n FROM finance_settings').get().n).toBe(0);
  });
});
