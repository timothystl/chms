-- Finance Workspace redesign (2026-08, "Finance overview framing" handoff).
--
-- 1. finance_daycare_rooms — room-level monthly aggregates from the daycare app, backing the
--    rebuilt Daycare Report (Screen 3 / prototype 5a). Deliberately narrow: four figures plus a
--    waitlist count per room per period, and nothing else. No rosters, schedules or clock records
--    cross the boundary. Replaced wholesale per period on each sync, the same pattern
--    finance/daycare/sync already uses for the money rows.
--
--    seasonal=1 marks a room (Summer Camp) that is excluded from the "X of Y daily seats filled"
--    capacity basis, so the headline utilisation figure is one basis only rather than mixing a
--    year-round room with a seasonal one.
CREATE TABLE IF NOT EXISTS finance_daycare_rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL,                     -- YYYY-MM
  room_name TEXT NOT NULL,
  capacity_per_day REAL,
  avg_daily_enrolled REAL,
  billed_cents INTEGER,
  labor_cost_cents INTEGER,
  waitlist_families INTEGER NOT NULL DEFAULT 0,
  seasonal INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL DEFAULT '',
  UNIQUE(period, room_name)
);
CREATE INDEX IF NOT EXISTS idx_finance_daycare_rooms_period ON finance_daycare_rooms(period);

-- 2. finance_import_log — one row per importer, holding only when it last ran. Backs the Data &
--    Imports tab's staleness column, which is the whole point of that tab: seeing that a feed has
--    gone stale without opening the report it feeds. Deliberately not an audit trail (audit_log
--    already exists for that) — just the latest timestamp per importer key.
CREATE TABLE IF NOT EXISTS finance_import_log (
  importer_key TEXT PRIMARY KEY,
  last_imported_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
