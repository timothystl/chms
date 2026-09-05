-- Named giving insights need one row per giver, not every individual gift. The table is rebuilt
-- lazily by ensureGivingYearRollups() when a year is dirty (or has never been materialized), so
-- deploying this migration does not perform an unbounded historical scan.
CREATE TABLE IF NOT EXISTS giving_year_person_totals (
  year           INTEGER NOT NULL,
  person_id      INTEGER NOT NULL,
  total_cents    INTEGER NOT NULL DEFAULT 0,
  gift_count     INTEGER NOT NULL DEFAULT 0,
  last_gift_date TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (year, person_id)
);

CREATE TABLE IF NOT EXISTS giving_year_person_rollup_ready (
  year         INTEGER PRIMARY KEY,
  refreshed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
