-- Scanned page images for the Church Register (baptism/confirmation/wedding/funeral/
-- anniversary books), keyed by the same page number staff already type into a register
-- entry's own `pdf_page` field. Lets a register row (e.g. "p.42") link straight to the
-- scanned page it came from -- useful since the register is AI-transcribed from book
-- scans and a transcription may need to be checked against the original page.
CREATE TABLE IF NOT EXISTS register_scan_pages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT    NOT NULL,
  page        TEXT    NOT NULL,
  r2_key      TEXT    NOT NULL,
  uploaded_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_register_scan_type_page ON register_scan_pages(type, page);
