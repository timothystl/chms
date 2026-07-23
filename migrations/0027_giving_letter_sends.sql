-- Tracks which person got which year's giving letter (year_end / midyear), so batch sends
-- can resume after a Resend rate-limit interruption without re-sending duplicates, and so the
-- "Load Givers" list can show who's already been sent to.
CREATE TABLE IF NOT EXISTS giving_letter_sends (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   INTEGER NOT NULL,
  year        INTEGER NOT NULL,
  letter_type TEXT    NOT NULL,
  sent_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(person_id, year, letter_type)
);
