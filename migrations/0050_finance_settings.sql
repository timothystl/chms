-- Finance's own settings store, split out of the shared chms_config table (see
-- migrateFinanceSettingsFromConfig in src/db.js for the one-time data move). Same shape as
-- apps/finance/migrations/0001_finance_foundation.sql's finance_settings, so the eventual
-- physical Finance split has one less schema to reconcile.
CREATE TABLE IF NOT EXISTS finance_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
