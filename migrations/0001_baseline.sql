-- ── Baseline schema as of 2026-04-23 ─────────────────────────────────────────
-- This file represents the complete database schema at the point IN7 was
-- adopted.  It is safe to run against an existing production database because
-- every statement uses CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
-- New installations can be bootstrapped with:
--   wrangler d1 migrations apply tlc-volunteer-db --remote

-- ── Scheduler tables ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS serve_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  event_date   TEXT    NOT NULL DEFAULT '',
  hidden       INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  use_time_slots INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS serve_roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  slots       INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  role_date   TEXT    NOT NULL DEFAULT '',
  start_time  TEXT    NOT NULL DEFAULT '',
  end_time    TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS signups (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     INTEGER,
  role_id      INTEGER,
  ministry     TEXT    NOT NULL DEFAULT '',
  name         TEXT    NOT NULL,
  email        TEXT    NOT NULL DEFAULT '',
  phone        TEXT    NOT NULL DEFAULT '',
  roles        TEXT    NOT NULL DEFAULT '[]',
  service      TEXT    NOT NULL DEFAULT '',
  sundays      TEXT    NOT NULL DEFAULT '[]',
  shirt_wanted INTEGER NOT NULL DEFAULT 0,
  shirt_size   TEXT    NOT NULL DEFAULT '',
  notes        TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signup_slots (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  signup_id INTEGER NOT NULL,
  role_id   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduler_data (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── ChMS tables ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS households (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT    NOT NULL DEFAULT '',
  address1  TEXT    NOT NULL DEFAULT '',
  address2  TEXT    NOT NULL DEFAULT '',
  city      TEXT    NOT NULL DEFAULT '',
  state     TEXT    NOT NULL DEFAULT 'MO',
  zip       TEXT    NOT NULL DEFAULT '',
  notes     TEXT    NOT NULL DEFAULT '',
  created_at TEXT   NOT NULL DEFAULT (datetime('now')),
  breeze_id TEXT    NOT NULL DEFAULT '',
  photo_url TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS people (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name          TEXT    NOT NULL DEFAULT '',
  last_name           TEXT    NOT NULL DEFAULT '',
  email               TEXT    NOT NULL DEFAULT '',
  phone               TEXT    NOT NULL DEFAULT '',
  address1            TEXT    NOT NULL DEFAULT '',
  address2            TEXT    NOT NULL DEFAULT '',
  city                TEXT    NOT NULL DEFAULT '',
  state               TEXT    NOT NULL DEFAULT 'MO',
  zip                 TEXT    NOT NULL DEFAULT '',
  member_type         TEXT    NOT NULL DEFAULT 'visitor',
  dob                 TEXT    NOT NULL DEFAULT '',
  baptism_date        TEXT    NOT NULL DEFAULT '',
  confirmation_date   TEXT    NOT NULL DEFAULT '',
  anniversary_date    TEXT    NOT NULL DEFAULT '',
  household_id        INTEGER,
  family_role         TEXT    NOT NULL DEFAULT '',
  photo_url           TEXT    NOT NULL DEFAULT '',
  notes               TEXT    NOT NULL DEFAULT '',
  breeze_id           TEXT    NOT NULL DEFAULT '',
  active              INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  deceased            INTEGER NOT NULL DEFAULT 0,
  death_date          TEXT    NOT NULL DEFAULT '',
  public_directory    INTEGER NOT NULL DEFAULT 1,
  envelope_number     TEXT    NOT NULL DEFAULT '',
  last_seen_date      TEXT    NOT NULL DEFAULT '',
  gender              TEXT    NOT NULL DEFAULT '',
  marital_status      TEXT    NOT NULL DEFAULT '',
  dir_hide_address    INTEGER NOT NULL DEFAULT 0,
  dir_hide_phone      INTEGER NOT NULL DEFAULT 0,
  dir_hide_email      INTEGER NOT NULL DEFAULT 0,
  baptized            INTEGER NOT NULL DEFAULT 0,
  confirmed           INTEGER NOT NULL DEFAULT 0,
  status              TEXT    NOT NULL DEFAULT 'active',
  last_reviewed_at    TEXT    NOT NULL DEFAULT '',
  first_contact_date  TEXT    NOT NULL DEFAULT '',
  followup_status     TEXT    NOT NULL DEFAULT '',
  followup_notes      TEXT    NOT NULL DEFAULT '',
  first_gift_noted    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_people_household ON people(household_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_people_breeze ON people(breeze_id) WHERE breeze_id != '';
CREATE INDEX IF NOT EXISTS idx_people_name ON people(last_name, first_name);

CREATE TABLE IF NOT EXISTS tags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  color       TEXT    NOT NULL DEFAULT '#5C8FA8',
  description TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  breeze_id   TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS person_tags (
  person_id INTEGER NOT NULL,
  tag_id    INTEGER NOT NULL,
  PRIMARY KEY (person_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_person_tags_person ON person_tags(person_id);

CREATE TABLE IF NOT EXISTS funds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  breeze_id   TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS giving_batches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_date  TEXT    NOT NULL DEFAULT '',
  description TEXT    NOT NULL DEFAULT '',
  closed      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS giving_entries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id          INTEGER NOT NULL,
  person_id         INTEGER,
  fund_id           INTEGER NOT NULL,
  amount            INTEGER NOT NULL DEFAULT 0,
  method            TEXT    NOT NULL DEFAULT 'cash',
  check_number      TEXT    NOT NULL DEFAULT '',
  notes             TEXT    NOT NULL DEFAULT '',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  breeze_id         TEXT    NOT NULL DEFAULT '',
  contribution_date TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_giving_batch ON giving_entries(batch_id);
CREATE INDEX IF NOT EXISTS idx_giving_person ON giving_entries(person_id);

CREATE TABLE IF NOT EXISTS worship_services (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  service_date        TEXT    NOT NULL DEFAULT '',
  service_time        TEXT    NOT NULL DEFAULT '',
  service_name        TEXT    NOT NULL DEFAULT '',
  service_type        TEXT    NOT NULL DEFAULT 'sunday',
  attendance          INTEGER NOT NULL DEFAULT 0,
  communion           INTEGER NOT NULL DEFAULT 0,
  notes               TEXT    NOT NULL DEFAULT '',
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  breeze_instance_id  TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_ws_date ON worship_services(service_date);

CREATE TABLE IF NOT EXISTS chms_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS church_register (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  type           TEXT    NOT NULL DEFAULT '',
  event_date     TEXT    NOT NULL DEFAULT '',
  name           TEXT    NOT NULL DEFAULT '',
  name2          TEXT    NOT NULL DEFAULT '',
  officiant      TEXT    NOT NULL DEFAULT '',
  notes          TEXT    NOT NULL DEFAULT '',
  person_id      INTEGER,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  record_type    TEXT    NOT NULL DEFAULT '',
  dob            TEXT    NOT NULL DEFAULT '',
  place_of_birth TEXT    NOT NULL DEFAULT '',
  baptism_place  TEXT    NOT NULL DEFAULT '',
  father         TEXT    NOT NULL DEFAULT '',
  mother         TEXT    NOT NULL DEFAULT '',
  sponsors       TEXT    NOT NULL DEFAULT '',
  pdf_page       TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_register_type ON church_register(type, event_date);

CREATE TABLE IF NOT EXISTS follow_up_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id    INTEGER,
  type         TEXT    NOT NULL DEFAULT 'general',
  notes        TEXT    NOT NULL DEFAULT '',
  due_date     TEXT    NOT NULL DEFAULT '',
  completed    INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_followup_person ON follow_up_items(person_id);
CREATE INDEX IF NOT EXISTS idx_followup_open ON follow_up_items(completed, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT    NOT NULL DEFAULT (datetime('now')),
  action      TEXT    NOT NULL DEFAULT '',
  entity_type TEXT    NOT NULL DEFAULT '',
  entity_id   INTEGER,
  person_name TEXT    NOT NULL DEFAULT '',
  field       TEXT    NOT NULL DEFAULT '',
  old_value   TEXT    NOT NULL DEFAULT '',
  new_value   TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);

CREATE TABLE IF NOT EXISTS app_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  display_name  TEXT    NOT NULL DEFAULT '',
  role          TEXT    NOT NULL DEFAULT 'staff',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login    TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_app_users_username ON app_users(username);

CREATE TABLE IF NOT EXISTS organizations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL DEFAULT '',
  type         TEXT    NOT NULL DEFAULT '',
  contact_name TEXT    NOT NULL DEFAULT '',
  phone        TEXT    NOT NULL DEFAULT '',
  email        TEXT    NOT NULL DEFAULT '',
  website      TEXT    NOT NULL DEFAULT '',
  address1     TEXT    NOT NULL DEFAULT '',
  address2     TEXT    NOT NULL DEFAULT '',
  city         TEXT    NOT NULL DEFAULT '',
  state        TEXT    NOT NULL DEFAULT 'MO',
  zip          TEXT    NOT NULL DEFAULT '',
  notes        TEXT    NOT NULL DEFAULT '',
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_organizations_name ON organizations(name);

CREATE TABLE IF NOT EXISTS engagement_tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT    NOT NULL DEFAULT '',
  link_url     TEXT    NOT NULL DEFAULT '',
  week_key     TEXT    NOT NULL DEFAULT '',
  completed    INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT    NOT NULL DEFAULT '',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_engagement_tasks_week ON engagement_tasks(week_key);

CREATE TABLE IF NOT EXISTS prayer_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id       INTEGER,
  requester_name  TEXT    NOT NULL DEFAULT '',
  requester_email TEXT    NOT NULL DEFAULT '',
  request_text    TEXT    NOT NULL DEFAULT '',
  source          TEXT    NOT NULL DEFAULT 'manual',
  status          TEXT    NOT NULL DEFAULT 'open',
  resolution_note TEXT    NOT NULL DEFAULT '',
  submitted_at    TEXT    NOT NULL DEFAULT (date('now')),
  resolved_at     TEXT    NOT NULL DEFAULT '',
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prayer_requests_status ON prayer_requests(status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_prayer_requests_person ON prayer_requests(person_id);
