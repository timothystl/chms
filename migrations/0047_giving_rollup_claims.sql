-- Serialize lazy yearly-giving rebuilds across Worker isolates. Inserting a claim and clearing
-- the dirty marker happen in one SQLite statement (via the trigger), so a gift committed after
-- the claim recreates the marker and cannot be lost when the current rebuild finishes.
CREATE TABLE IF NOT EXISTS giving_year_rollup_claims (
  year       INTEGER PRIMARY KEY,
  token      TEXT NOT NULL,
  claimed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS trg_giving_year_rollup_claim_begin
AFTER INSERT ON giving_year_rollup_claims
BEGIN
  DELETE FROM giving_rollup_dirty WHERE year=NEW.year;
END;
