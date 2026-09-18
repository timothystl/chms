-- Stax Giving mockup v2 (see docs/STAX_GIVING_MOCKUP.md): multi-fund gifts, richer donor
-- contact fields for matching, and a way to curate which funds appear on the public form
-- without loading every budget line.

-- Separate from `active` on purpose: `active` already means "not retired" for every other
-- giving screen (Manage Funds, quick entry, imports). Reusing it for "show on the public giving
-- form" would have put every one of those budget-line funds in front of a donor. Defaults to 0
-- (opt-in) -- after this deploys, staff must explicitly turn funds on via the new
-- /admin/giving/stax-mockup/funds screen before anything appears on the public form again.
ALTER TABLE funds ADD COLUMN public_giving INTEGER NOT NULL DEFAULT 0;

-- Structured payer name/address, replacing the single free-text name the mockup collected
-- before -- better donor matching, and a first/last split the Stax /customer call no longer has
-- to guess at by splitting on whitespace.
ALTER TABLE giving_stax_unmatched ADD COLUMN payer_first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE giving_stax_unmatched ADD COLUMN payer_last_name TEXT NOT NULL DEFAULT '';
ALTER TABLE giving_stax_unmatched ADD COLUMN payer_address_line1 TEXT NOT NULL DEFAULT '';
ALTER TABLE giving_stax_unmatched ADD COLUMN payer_city TEXT NOT NULL DEFAULT '';
ALTER TABLE giving_stax_unmatched ADD COLUMN payer_state TEXT NOT NULL DEFAULT '';
ALTER TABLE giving_stax_unmatched ADD COLUMN payer_zip TEXT NOT NULL DEFAULT '';

-- Groups the N schedule rows a single "multiple gifts, split across funds" recurring signup
-- creates, so staff can see they were set up together. Blank for a single-fund schedule (most
-- of them) and for every row created before this column existed.
ALTER TABLE giving_stax_recurring_schedules ADD COLUMN schedule_group TEXT NOT NULL DEFAULT '';
