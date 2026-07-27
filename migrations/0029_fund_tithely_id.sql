-- Tithe.ly fund ID, hand-entered by an admin per fund — mirrors breeze_id (used to match
-- Breeze fund IDs during giving sync) but for the website's give.timothystl.org giving page.
-- Exposed read-only via GET /api/intake/funds so the website repo's Giving tab can suggest
-- both the fund name AND its Tithe.ly ID instead of just the name.
ALTER TABLE funds ADD COLUMN tithely_fund_id TEXT NOT NULL DEFAULT '';
