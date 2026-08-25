-- P28-C / PL1b: pledge tracking. One pledge per person per fiscal year (a household could
-- pledge as a family, but pledges are recorded per adult who makes the commitment, matching
-- how giving itself is recorded per person, not per household). No fund column -- a pledge
-- names an annual dollar amount, not a designation; if that's ever needed it's a later column,
-- not a redesign, since every reader here only cares about the total.
CREATE TABLE IF NOT EXISTS pledges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES people(id),
  fiscal_year INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pledges_person_year ON pledges(person_id, fiscal_year);
