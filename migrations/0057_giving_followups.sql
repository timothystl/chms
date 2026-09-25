-- Giving nudges (Finance v3): a pastoral follow-up list found from giving patterns -- a first gift
-- to thank, a regular giver who has stopped, a pledge running behind. The nudges themselves are
-- computed on read from giving_entries and pledges; this table only remembers who a nudge was
-- handed to and whether it was done, so a finished one stays finished. One row per
-- (kind, subject, episode): the episode names the occurrence (a first-gift date, a half-year),
-- so a household that stops giving again next year surfaces as a new nudge. Nothing here sends
-- anything; sending stays in Connect's Giving → Communications.
CREATE TABLE IF NOT EXISTS giving_followups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT    NOT NULL,
  subject_key TEXT    NOT NULL,
  episode     TEXT    NOT NULL,
  assigned_to TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'open',
  done_at     TEXT    NOT NULL DEFAULT '',
  done_by     TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_giving_followups_identity ON giving_followups(kind, subject_key, episode);
