-- Relationalizes the Scheduler's two RSVP-confirmation blobs (scheduler_data keys
-- 'ws_rsvp_tokens' and 'ws_confirmations') into real tables.
--
-- Both blobs lived only in a browser's localStorage until an admin's browser happened to save,
-- at which point that browser's ENTIRE local copy overwrote the shared D1 row wholesale. Two
-- different admin sessions (or the same admin on two devices, or a browser that reloaded a
-- stale copy) could each hold a different, incomplete view of "who has which RSVP link" --
-- and whichever one saved last silently dropped everyone the others knew about. That is what
-- caused a real volunteer's confirmed RSVP to never show up anywhere, on any device, no matter
-- how many times "Sync Confirmations" was clicked: the browser doing the syncing had no record
-- of that volunteer's token to even ask the server about.
--
-- These two tables replace both blobs as the source of truth. Person ids are the Scheduler's
-- own client-generated ids (as used throughout the still-blob-based ws_schedule_v2/ws_people --
-- see scheduler_volunteers/migrations/0020 for the newer, real people.id-based identity; the
-- two id spaces are not yet unified), so no REFERENCES constraint to `people` here.
CREATE TABLE IF NOT EXISTS scheduler_rsvp_tokens (
  person_id  TEXT PRIMARY KEY,           -- Scheduler's client-generated person id (e.g. "p1275")
  token      TEXT NOT NULL UNIQUE,       -- the private code in the volunteer's email link
  name       TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scheduler_rsvp_tokens_token ON scheduler_rsvp_tokens(token);

CREATE TABLE IF NOT EXISTS scheduler_confirmations (
  date_iso   TEXT NOT NULL,
  role       TEXT NOT NULL,
  svc        TEXT NOT NULL,              -- '8am' | '10:45am' | 'shared'
  status     TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'confirmed' | 'needs_changes' | 'declined'
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date_iso, role, svc)
);
CREATE INDEX IF NOT EXISTS idx_scheduler_confirmations_date ON scheduler_confirmations(date_iso);
