-- SC6 Phase 1: relationalize Scheduler volunteers onto real `people` rows instead of the
-- client-side localStorage/D1-blob-store model (scheduler_data key 'ws_people'). One row per
-- person who is a Scheduler volunteer; person_id is the real people.id, not a client-generated
-- string id, so a Scheduler volunteer IS a real ChMS person record — no separate identity, no
-- Breeze lookup needed to find them (search happens against the real `people` table directly).
CREATE TABLE IF NOT EXISTS scheduler_volunteers (
  person_id             INTEGER PRIMARY KEY REFERENCES people(id),
  reminder_email        TEXT    NOT NULL DEFAULT '',  -- optional override; falls back to people.email when blank
  roles                 TEXT    NOT NULL DEFAULT '[]', -- JSON array, e.g. ["Elder","Lector"]
  primary_for           TEXT    NOT NULL DEFAULT '[]', -- JSON array — always-first-for roles
  preferred_sundays     TEXT    NOT NULL DEFAULT '[]', -- JSON array of ints 1-5; [] = any Sunday
  service_preference    TEXT    NOT NULL DEFAULT 'both', -- 'both' | '8am' | '10:45am'
  role_sunday_overrides TEXT    NOT NULL DEFAULT '{}', -- JSON object {role: [ints]}
  blackout_dates        TEXT    NOT NULL DEFAULT '[]', -- JSON array of ISO dates
  absence_start         TEXT    NOT NULL DEFAULT '',
  absence_until         TEXT    NOT NULL DEFAULT '',
  active                INTEGER NOT NULL DEFAULT 1,    -- 0 = removed from the volunteer pool, link kept for history
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scheduler_volunteers_active ON scheduler_volunteers(active);
