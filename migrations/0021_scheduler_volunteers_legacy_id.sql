-- SC6 Phase 2: track which client-generated `ws_people` id (the old scheduler_data blob's
-- localStorage-era identity) a scheduler_volunteers row was migrated from, so the migration
-- preview can be re-run safely — an already-migrated legacy person is never offered again.
ALTER TABLE scheduler_volunteers ADD COLUMN migrated_from_legacy_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_scheduler_volunteers_legacy_id ON scheduler_volunteers(migrated_from_legacy_id);
