-- Facilities photos and documents: equipment photos, nameplate labels, scanned service orders and
-- invoices attached to an asset, recurring maintenance task, service entry, or capital project.
-- The bytes live in Finance's own R2 bucket (binding FACILITY_FILES); this table is the index and
-- the only way a file is found or served. content_type is decided from the file's own bytes on
-- upload, never from what the browser claimed.

CREATE TABLE IF NOT EXISTS finance_facility_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_type TEXT NOT NULL CHECK (record_type IN ('asset', 'pm_task', 'service', 'project')),
  record_id INTEGER NOT NULL CHECK (record_id > 0),
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  caption TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS finance_facility_files_record ON finance_facility_files (record_type, record_id, id);
