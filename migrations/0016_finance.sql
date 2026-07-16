-- Finance Overview: QuickBooks Online OAuth connection + cached report snapshots,
-- plus manual daycare financial entries (no known daycare-app API/export yet).
-- See src/api-finance.js and src/quickbooks.js.

CREATE TABLE IF NOT EXISTS finance_qb_connection (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  realm_id                 TEXT    NOT NULL DEFAULT '',
  company_name             TEXT    NOT NULL DEFAULT '',
  access_token             TEXT    NOT NULL DEFAULT '',
  refresh_token            TEXT    NOT NULL DEFAULT '',
  access_token_expires_at  TEXT    NOT NULL DEFAULT '',
  refresh_token_expires_at TEXT    NOT NULL DEFAULT '',
  environment              TEXT    NOT NULL DEFAULT 'production',
  connected_at             TEXT    NOT NULL DEFAULT '',
  last_synced_at           TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS finance_qb_snapshot (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  synced_at  TEXT NOT NULL DEFAULT ''
);

-- 'source' distinguishes staff-entered rows ('manual', always editable/deletable by hand)
-- from rows pulled in automatically from the daycare app's own finance API ('daycare_api',
-- overwritten wholesale on each sync rather than hand-edited).
CREATE TABLE IF NOT EXISTS finance_daycare_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  period       TEXT    NOT NULL DEFAULT '',
  category     TEXT    NOT NULL DEFAULT '',
  entry_type   TEXT    NOT NULL DEFAULT 'actual',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  notes        TEXT    NOT NULL DEFAULT '',
  source       TEXT    NOT NULL DEFAULT 'manual',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_finance_daycare_period ON finance_daycare_entries(period);
