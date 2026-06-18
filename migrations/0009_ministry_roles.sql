-- Ministry Roles: ongoing volunteer roles per ministry category.
-- Separate from serve_roles (which are time-slotted slots within an event).
-- These are the standing roles listed on each ministry page of volunteer.timothystl.org.
CREATE TABLE IF NOT EXISTS ministry_roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ministry    TEXT    NOT NULL DEFAULT '',
  name        TEXT    NOT NULL DEFAULT '',
  description TEXT    NOT NULL DEFAULT '',
  commitment  TEXT    NOT NULL DEFAULT '',
  training    TEXT    NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
