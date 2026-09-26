-- Scheduler send log: one row per email the Scheduler hands to Resend through POST /email/send
-- (assignment emails, weekly reminders, open-slot requests, the office copy). Answers "did this
-- volunteer's email actually go out?" without leaving Connect: who it went to, when, whether
-- Resend accepted it, Resend's message id, and — when staff press "Check delivery" — Resend's
-- latest delivery event for it (delivered, bounced, complained, ...). No message bodies are
-- stored. Rows older than about 13 months are pruned by the send path itself.
CREATE TABLE IF NOT EXISTS scheduler_email_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sent_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  recipients        TEXT    NOT NULL DEFAULT '',
  volunteer_name    TEXT    NOT NULL DEFAULT '',
  kind              TEXT    NOT NULL DEFAULT '',
  subject           TEXT    NOT NULL DEFAULT '',
  accepted          INTEGER NOT NULL DEFAULT 0,
  resend_id         TEXT    NOT NULL DEFAULT '',
  error             TEXT    NOT NULL DEFAULT '',
  delivery_status   TEXT    NOT NULL DEFAULT '',
  status_checked_at TEXT    NOT NULL DEFAULT '',
  sent_by           TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_scheduler_email_log_sent_at ON scheduler_email_log(sent_at);
