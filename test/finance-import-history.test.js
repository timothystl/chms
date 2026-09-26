import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readImportHistory } from '../apps/finance/import-history-service.js';
import { resetEnsuredSchemasForTests } from '../apps/finance/finance-owned-schema.js';

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE finance_import_log (
    importer_key TEXT PRIMARY KEY, last_imported_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT ''
  )`);
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    async run() { sqlite.prepare(sql).run(...args); return { meta: {} }; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  return {
    sqlite,
    prepare: (sql) => statement(sql),
    async batch(statements) { for (const item of statements) await item.run(); return []; },
  };
}

beforeEach(() => resetEnsuredSchemasForTests());

describe('Finance import history', () => {
  it('backfills each retained latest status once and returns newest first', async () => {
    const db = makeDb();
    db.sqlite.exec(`
      INSERT INTO finance_import_log VALUES ('church_budget','2026-09-20T12:00:00Z','FY2027');
      INSERT INTO finance_import_log VALUES ('property_monthly_csv','2026-09-21T12:00:00Z','2026-08');
      INSERT INTO finance_import_log VALUES ('synthetic_fixture','2026-09-22T12:00:00Z','not production');
    `);
    const first = await readImportHistory(db);
    const second = await readImportHistory(db);
    expect(first.ok).toBe(true);
    expect(first.rows.map((row) => row.importerLabel)).toEqual(['AHRA monthly financials', 'Budget (single year)']);
    expect(second.rows).toHaveLength(2);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS count FROM finance_import_history').get().count).toBe(2);
  });

  it('preserves append-only events and enforces the requested limit', async () => {
    const db = makeDb();
    await readImportHistory(db);
    db.sqlite.exec(`
      INSERT INTO finance_import_history (importer_key, imported_at, note) VALUES
        ('daycare_bulk','2026-09-20T12:00:00Z','10 rows'),
        ('daycare_bulk','2026-09-21T12:00:00Z','12 rows');
    `);
    const result = await readImportHistory(db, 1);
    expect(result.rows).toEqual([expect.objectContaining({ importerLabel: 'Daycare bulk paste', note: '12 rows' })]);
  });
});
