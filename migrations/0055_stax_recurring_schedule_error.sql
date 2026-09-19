-- Every recurring-schedule row on the new admin screen (added in #1052) was showing
-- "Needs setup" with no reason why the Stax /scheduled-invoices call failed — the code only
-- ever recorded pending_manual_setup, never what Stax actually said. Andrew hit this live: all
-- of his test schedules came back "Needs setup" with nothing to diagnose from. This column
-- captures Stax's status/message (or the thrown error) so staff — and future debugging — can
-- tell a wrong endpoint/path from a bad payload from an auth failure, instead of guessing.
ALTER TABLE giving_stax_recurring_schedules ADD COLUMN stax_error TEXT NOT NULL DEFAULT '';
