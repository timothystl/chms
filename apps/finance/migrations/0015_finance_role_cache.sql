-- The last role Connect confirmed for each signed-in person, so Finance can still open read-only
-- pages when Connect is slow or unreachable. Connect stays the only place roles are managed; a row
-- here is refreshed on every successful check and is used for at most seven days after it.

CREATE TABLE IF NOT EXISTS finance_role_cache (
  identity TEXT PRIMARY KEY CHECK (length(trim(identity)) > 0),
  role TEXT NOT NULL,
  permissions_json TEXT NOT NULL DEFAULT '{}',
  username TEXT NOT NULL DEFAULT '',
  verified_at TEXT NOT NULL DEFAULT (datetime('now'))
);
