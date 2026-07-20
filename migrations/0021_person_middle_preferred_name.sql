-- Add middle name and preferred/goes-by name fields to people.
ALTER TABLE people ADD COLUMN middle_name TEXT NOT NULL DEFAULT '';
ALTER TABLE people ADD COLUMN preferred_name TEXT NOT NULL DEFAULT '';
