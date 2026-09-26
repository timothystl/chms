-- Append-only record of completed Finance imports. The existing finance_import_log remains the
-- one-row-per-importer freshness index; this table supplies the human-readable history page.
CREATE TABLE IF NOT EXISTS finance_import_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  importer_key TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_import_history_event
  ON finance_import_history (importer_key, imported_at, note);

CREATE INDEX IF NOT EXISTS finance_import_history_recent
  ON finance_import_history (imported_at DESC, id DESC);
