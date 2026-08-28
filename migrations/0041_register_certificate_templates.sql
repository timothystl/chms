-- One background certificate image per register type (baptism/confirmation/wedding/funeral),
-- with a list of positioned fields (name/date/officiant/etc, each an x/y percent offset) so
-- printing a certificate overlays the real entry data directly onto the church's own design
-- instead of the app's generic bordered layout. `fields_json` is a JSON array of
-- {key, x_pct, y_pct, font_size_pt, align} -- see printRegisterCertificate() in js-register.js.
CREATE TABLE IF NOT EXISTS register_certificate_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT    NOT NULL UNIQUE,
  r2_key      TEXT    NOT NULL,
  fields_json TEXT    NOT NULL DEFAULT '[]',
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
