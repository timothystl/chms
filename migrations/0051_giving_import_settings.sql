-- Same split as migrations/0050_finance_settings.sql, applied to Giving's and Import's own
-- chms_config keys (see migrateNonFinanceSettingsFromConfig in src/db.js for the one-time
-- data move).
CREATE TABLE IF NOT EXISTS giving_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS import_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
