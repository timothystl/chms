import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = new URL('../apps/finance/migrations/', import.meta.url);
const THIS_MIGRATION_FILE = '0008_finance_qb_connection.sql';
const sql = readFileSync(new URL(THIS_MIGRATION_FILE, MIGRATIONS_DIR), 'utf8');

// This migration is DESIGN + DARK CODE, not live — see its own header comment and
// apps/finance/README.md's changelog entry. These tests only confirm the schema shape is sound
// and isolated; they do not exercise any wired route (there is none) and do not touch the shared
// Connect database in any way.
describe('Finance-owned QuickBooks connection schema (dark/unwired)', () => {
  it('creates exactly the three new tables from an empty database, each starting empty', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(sql);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => name);
    expect(tables).toEqual(['finance_qb_connection', 'finance_qb_oauth_state', 'finance_qb_snapshot']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM finance_qb_connection').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM finance_qb_oauth_state').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM finance_qb_snapshot').get().n).toBe(0);
  });

  it('finance_qb_connection is field-for-field the same shape as legacy migrations/0016_finance.sql', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(sql);
    const columns = db.prepare('PRAGMA table_info(finance_qb_connection)').all().map((c) => c.name);
    expect(columns).toEqual([
      'id', 'realm_id', 'company_name', 'access_token', 'refresh_token',
      'access_token_expires_at', 'refresh_token_expires_at', 'environment', 'connected_at', 'last_synced_at',
    ]);
    // id=1 singleton enforced the same way legacy's table enforces it.
    db.exec("INSERT INTO finance_qb_connection (id) VALUES (1)");
    expect(() => db.exec("INSERT INTO finance_qb_connection (id) VALUES (2)")).toThrow();
  });

  it('finance_qb_oauth_state exists only because apps/finance has no KV namespace binding today', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(sql);
    const columns = db.prepare('PRAGMA table_info(finance_qb_oauth_state)').all().map((c) => c.name);
    expect(columns).toEqual(['state', 'created_at', 'expires_at']);
    db.exec("INSERT INTO finance_qb_oauth_state (state, expires_at) VALUES ('s1', '2026-01-01T00:10:00Z')");
    expect(() => db.exec("INSERT INTO finance_qb_oauth_state (state, expires_at) VALUES ('s1', '2026-01-01T00:20:00Z')")).toThrow();
  });

  // Reads whatever migration files actually precede this one on disk (rather than a hardcoded
  // list) so this test keeps working as other, unrelated Finance migrations land -- it only cares
  // that THIS migration adds exactly 3 new, uniquely-named tables on top of whatever came before.
  it('adds exactly 3 new, uniquely-named tables on top of every migration that precedes it, with no collision', () => {
    const allFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    const priorFiles = allFiles.filter((f) => f < THIS_MIGRATION_FILE);
    expect(priorFiles.length).toBeGreaterThan(0);
    expect(allFiles).toContain(THIS_MIGRATION_FILE);

    const db = new DatabaseSync(':memory:');
    for (const file of priorFiles) db.exec(readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8'));
    const beforeTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(({ name }) => name);

    db.exec(sql);
    const afterTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => name);

    expect(new Set(afterTables).size).toBe(afterTables.length); // no accidental name collision
    expect(afterTables.length).toBe(beforeTables.length + 3);
    expect(afterTables).toContain('finance_qb_connection');
    expect(afterTables).toContain('finance_qb_oauth_state');
    expect(afterTables).toContain('finance_qb_snapshot');
  });

  it('is never loaded by the Finance D1 foundation test (pinned to migration 0001 only) -- adding it here did not silently widen that pinned inventory', () => {
    const foundationTestSrc = readFileSync(new URL('../test/finance-d1-foundation.test.js', import.meta.url), 'utf8');
    expect(foundationTestSrc).not.toMatch(/finance_qb_connection\.sql/);
  });
});
