-- The Data & Imports screen derives a last-imported timestamp for legacy imports that predate
-- finance_import_log. Without an index, MAX(synced_at) for one source scans every imported
-- account/year row. Production measured 47,520 rows read for four status checks (11,880 each).
--
-- Leading with source narrows to the requested importer; synced_at supplies MAX directly from
-- the covering index, so no finance_church_entries table rows need to be visited.
CREATE INDEX IF NOT EXISTS idx_church_entries_source_synced
  ON finance_church_entries(source, synced_at);
