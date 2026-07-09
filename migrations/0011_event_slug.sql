-- Events: optional short URL slug (e.g. "christmasmarket") so an event can be
-- linked/promoted at volunteer.timothystl.org/<slug> instead of a bare #event-<id>.
ALTER TABLE serve_events ADD COLUMN slug TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_serve_events_slug ON serve_events(slug) WHERE slug != '';
