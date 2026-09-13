import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migrateNonFinanceSettingsFromConfig } from '../src/db.js';

// Minimal D1-shaped wrapper around node:sqlite, same pattern as test/finance-settings-migration.test.js.
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE chms_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`);
  sqlite.exec(`CREATE TABLE giving_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  sqlite.exec(`CREATE TABLE import_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
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

describe('migrateNonFinanceSettingsFromConfig', () => {
  it('moves Giving-domain and Import keys out of chms_config into their own tables, and marks itself done', async () => {
    const db = makeTestDb();
    db._raw.exec(`INSERT INTO chms_config (key,value) VALUES
      ('giving_impact_statements_json','[{"monthly_cents":5000,"label":"feeds a family"}]'),
      ('giving_letter_template','<p>Dear {{name}}</p>'),
      ('giving_midyear_letter_template','<p>Midyear {{name}}</p>'),
      ('online_giving_url','https://give.example.org'),
      ('breeze_statuses_seen','["active","inactive"]'),
      ('member_types','["Member","Visitor"]'),
      ('schema_fingerprint','abc123')`);

    await migrateNonFinanceSettingsFromConfig(db);

    const givingKeys = ['giving_impact_statements_json', 'giving_letter_template', 'giving_midyear_letter_template', 'online_giving_url'];
    for (const key of givingKeys) {
      expect(db._raw.prepare('SELECT value FROM giving_settings WHERE key=?').get(key), key).toBeTruthy();
      expect(db._raw.prepare('SELECT value FROM chms_config WHERE key=?').get(key), key).toBeFalsy();
    }
    expect(db._raw.prepare("SELECT value FROM import_settings WHERE key='breeze_statuses_seen'").get()).toBeTruthy();
    expect(db._raw.prepare("SELECT value FROM chms_config WHERE key='breeze_statuses_seen'").get()).toBeFalsy();

    // member_types is genuinely cross-domain (Admin + Import) with no single clear owner yet --
    // deliberately left in chms_config, not moved.
    expect(db._raw.prepare("SELECT value FROM chms_config WHERE key='member_types'").get().value).toBe('["Member","Visitor"]');
    expect(db._raw.prepare("SELECT value FROM giving_settings WHERE key='member_types'").get()).toBeFalsy();
    expect(db._raw.prepare("SELECT value FROM import_settings WHERE key='member_types'").get()).toBeFalsy();

    // Untouched: genuinely shared/system keys never move.
    expect(db._raw.prepare("SELECT value FROM chms_config WHERE key='schema_fingerprint'").get().value).toBe('abc123');

    expect(db._raw.prepare("SELECT value FROM chms_config WHERE key='non_finance_settings_migrated_v1'").get().value).toBe('1');
  });

  it('is idempotent — a second run is a no-op once the marker is set', async () => {
    const db = makeTestDb();
    db._raw.exec(`INSERT INTO chms_config (key,value) VALUES ('online_giving_url','https://give.example.org')`);
    await migrateNonFinanceSettingsFromConfig(db);
    db._raw.exec(`INSERT INTO chms_config (key,value) VALUES ('online_giving_url','https://sneaky-reinsert.example.org')`);
    await migrateNonFinanceSettingsFromConfig(db);
    expect(db._raw.prepare("SELECT value FROM giving_settings WHERE key='online_giving_url'").get().value)
      .toBe('https://give.example.org');
  });

  it('does nothing on a fresh database with no matching keys to move', async () => {
    const db = makeTestDb();
    await migrateNonFinanceSettingsFromConfig(db);
    expect(db._raw.prepare("SELECT value FROM chms_config WHERE key='non_finance_settings_migrated_v1'").get().value).toBe('1');
    expect(db._raw.prepare('SELECT COUNT(*) AS n FROM giving_settings').get().n).toBe(0);
    expect(db._raw.prepare('SELECT COUNT(*) AS n FROM import_settings').get().n).toBe(0);
  });
});
