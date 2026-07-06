-- Signups status workflow: new -> contacted -> confirmed (or declined)
ALTER TABLE signups ADD COLUMN status TEXT NOT NULL DEFAULT 'new';
-- Public sign-up: opt-in flag for a manual staff reminder before the volunteer's shift
ALTER TABLE signups ADD COLUMN sms_reminder_opt_in INTEGER NOT NULL DEFAULT 0;
