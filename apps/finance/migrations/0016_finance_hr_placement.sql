-- HR & Staff placement: which organization a staff member belongs to (the church, or MDO,
-- whose director sits outside the church staff org), and the ministry team a
-- person serves on (e.g. VBS, Sunday School) so the org chart can group volunteers. Kept in its
-- own table so it is created additively beside finance_hr_people. A person with no row here is
-- church staff (or a key volunteer) with no team.

CREATE TABLE IF NOT EXISTS finance_hr_person_placement (
  person_id INTEGER PRIMARY KEY REFERENCES finance_hr_people(id),
  organization TEXT NOT NULL DEFAULT 'church' CHECK (organization IN ('church', 'mdo')),
  ministry_team TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT ''
);
