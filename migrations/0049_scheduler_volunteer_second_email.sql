-- A volunteer notification can now go to a second address too — a parent's email
-- alongside a child volunteer's own, or vice versa. Additive only: when set, every
-- email the Scheduler sends to this person (assignment emails, weekly reminders,
-- open-slot requests) also goes to this address; reminder_email/the person's own
-- ChMS email is unaffected.
ALTER TABLE scheduler_volunteers ADD COLUMN second_email TEXT NOT NULL DEFAULT '';
