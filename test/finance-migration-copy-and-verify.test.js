import { describe, expect, it } from 'vitest';
import { MIGRATABLE_TABLES, getTableConfig } from '../apps/finance/migration/table-registry.js';
import { computeRowChecksum, canonicalRowKey, rowIdentity } from '../apps/finance/migration/checksum.js';
import {
  sqlLiteral, buildUpsertStatements, verifyRowCount, verifyChecksums, copyAndVerifyTable,
} from '../apps/finance/migration/copy-and-verify.js';

// Everything here runs against in-memory fixture arrays standing in for "the real database" --
// no real D1, staging, or production database is read or written by this test file.

describe('table-registry', () => {
  it('lists exactly the 13 non-finance_settings tables the Stage 0 reconciliation named as schema-matching', () => {
    const names = MIGRATABLE_TABLES.map((t) => t.name).sort();
    expect(names).toEqual([
      'finance_budget_plan', 'finance_church_balances', 'finance_church_entries',
      'finance_daycare_entries', 'finance_daycare_rooms', 'finance_import_log',
      'finance_property_budget_monthly', 'finance_property_capital_ledger',
      'finance_property_distributions', 'finance_property_monthly',
      'finance_property_repairs', 'finance_property_reserve_disbursements',
      'finance_property_reserves',
    ].sort());
  });

  it('never includes finance_settings or the retired QuickBooks tables', () => {
    const names = MIGRATABLE_TABLES.map((t) => t.name);
    expect(names).not.toContain('finance_settings');
    expect(names).not.toContain('finance_qb_connection');
    expect(names).not.toContain('finance_qb_snapshot');
  });

  it('throws for an unknown table name rather than silently returning undefined', () => {
    expect(() => getTableConfig('finance_settings')).toThrow(/not a Stage 1 migratable table/);
  });
});

describe('checksum', () => {
  it('is identical for two rows with the same column values in different key orders', () => {
    const columns = ['id', 'category_path', 'own_actual_cents'];
    const a = { id: 1, category_path: 'Expenses:Utilities', own_actual_cents: 5000 };
    const b = { own_actual_cents: 5000, id: 1, category_path: 'Expenses:Utilities' };
    expect(computeRowChecksum(columns, a)).toBe(computeRowChecksum(columns, b));
  });

  it('changes when any tracked column value changes', () => {
    const columns = ['id', 'own_actual_cents'];
    const a = { id: 1, own_actual_cents: 5000 };
    const b = { id: 1, own_actual_cents: 5001 };
    expect(computeRowChecksum(columns, a)).not.toBe(computeRowChecksum(columns, b));
  });

  it('treats null and undefined the same, and does not collide numbers with similar strings', () => {
    const columns = ['own_budget_cents'];
    expect(canonicalRowKey(columns, { own_budget_cents: null }))
      .toBe(canonicalRowKey(columns, {}));
    expect(computeRowChecksum(columns, { own_budget_cents: 5 }))
      .not.toBe(computeRowChecksum(columns, { own_budget_cents: '5' }));
  });

  it('rowIdentity joins multi-column conflict keys deterministically and distinguishes ties', () => {
    const a = rowIdentity(['property_key', 'period'], { property_key: 'ivanhoe', period: '2026-06' });
    const b = rowIdentity(['property_key', 'period'], { property_key: 'ivan', period: 'hoe2026-06' });
    expect(a).not.toBe(b);
    expect(a).toBe(rowIdentity(['property_key', 'period'], { property_key: 'ivanhoe', period: '2026-06' }));
  });
});

describe('sqlLiteral', () => {
  it('escapes single quotes for safe inline SQL', () => {
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'");
  });
  it('renders null/undefined as NULL and numbers unquoted', () => {
    expect(sqlLiteral(null)).toBe('NULL');
    expect(sqlLiteral(undefined)).toBe('NULL');
    expect(sqlLiteral(1200)).toBe('1200');
  });
  it('refuses non-finite numbers rather than emitting broken SQL', () => {
    expect(() => sqlLiteral(NaN)).toThrow();
    expect(() => sqlLiteral(Infinity)).toThrow();
  });
});

describe('buildUpsertStatements', () => {
  it('returns nothing for an empty source (never generates a no-op write)', () => {
    expect(buildUpsertStatements('finance_import_log', [])).toEqual([]);
  });

  it('generates an ON CONFLICT upsert keyed on the table\'s declared conflict columns', () => {
    const rows = [{ importer_key: 'church_qbo', last_imported_at: '2026-09-01T00:00:00Z', note: '' }];
    const [sql] = buildUpsertStatements('finance_import_log', rows);
    expect(sql).toContain('INSERT INTO finance_import_log');
    expect(sql).toContain("ON CONFLICT(importer_key) DO UPDATE SET");
    expect(sql).toContain("last_imported_at=excluded.last_imported_at");
    // The conflict column itself must never appear in its own SET list.
    expect(sql).not.toMatch(/importer_key=excluded\.importer_key/);
  });

  it("copies finance_church_entries.source exactly as stored, never re-defaulting to apps/finance's 'import' default", () => {
    // Production's real default is 'qbo_sync' (src/db.js); a straight copy must preserve whatever
    // is actually on each row (here, a mix), not overwrite it with any schema-level default from
    // either side.
    const rows = [
      { id: 1, fiscal_year: 2026, period_month: 6, classification: 'Income', category_path: 'Income:Offerings',
        account_name: 'Offerings', depth: 0, has_children: 0, own_actual_cents: 500000, own_budget_cents: null,
        account_qbo_id: '', source: 'qbo_sync', notes: '', synced_at: '2026-07-01T00:00:00Z', created_at: '2026-07-01T00:00:00Z' },
      { id: 2, fiscal_year: 2026, period_month: 6, classification: 'Expenses', category_path: 'Expenses:Utilities',
        account_name: 'Utilities', depth: 0, has_children: 0, own_actual_cents: 120000, own_budget_cents: 150000,
        account_qbo_id: '', source: 'manual_adjustment', notes: 'bookkeeper correction', synced_at: '', created_at: '2026-07-02T00:00:00Z' },
    ];
    const [sql] = buildUpsertStatements('finance_church_entries', rows);
    expect(sql).toContain("'qbo_sync'");
    expect(sql).toContain("'manual_adjustment'");
    expect(sql).not.toContain("'import'");
  });

  it('chunks large row sets into multiple statements', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ importer_key: `k${i}`, last_imported_at: '2026-01-01', note: '' }));
    const statements = buildUpsertStatements('finance_import_log', rows, { chunkSize: 2 });
    expect(statements).toHaveLength(3);
  });
});

describe('verifyRowCount / verifyChecksums', () => {
  const table = 'finance_import_log';
  const row = (key, note = '') => ({ importer_key: key, last_imported_at: '2026-01-01', note });

  it('reports ok when source and destination match exactly', () => {
    const source = [row('a'), row('b')];
    const dest = [row('a'), row('b')];
    expect(verifyRowCount(source, dest)).toEqual({ ok: true, sourceCount: 2, destCount: 2 });
    expect(verifyChecksums(table, source, dest).ok).toBe(true);
  });

  it('detects a missing row in the destination', () => {
    const source = [row('a'), row('b')];
    const dest = [row('a')];
    const result = verifyChecksums(table, source, dest);
    expect(result.ok).toBe(false);
    expect(result.missingInDest).toEqual(['b']);
  });

  it('detects a value mismatch even when counts match', () => {
    const source = [row('a', 'source note')];
    const dest = [row('a', 'DIFFERENT note')];
    expect(verifyRowCount(source, dest).ok).toBe(true);
    const result = verifyChecksums(table, source, dest);
    expect(result.ok).toBe(false);
    expect(result.mismatched).toEqual(['a']);
  });

  it('detects an extra row present only in the destination', () => {
    const source = [row('a')];
    const dest = [row('a'), row('b')];
    const result = verifyChecksums(table, source, dest);
    expect(result.ok).toBe(false);
    expect(result.extraInDest).toEqual(['b']);
  });
});

// An in-memory fake transport standing in for "the real database", proving the orchestration is
// idempotent/safely re-runnable without ever touching a real D1 binding.
function makeFakeD1(tableName, conflictColumns) {
  const store = new Map();
  const SEP = String.fromCharCode(31);
  const keyOf = (row) => conflictColumns.map((c) => String(row[c])).join(SEP);
  return {
    seed(rows) { for (const r of rows) store.set(keyOf(r), { ...r }); },
    snapshot() { return [...store.values()]; },
    // Applies generated SQL by re-parsing it back into row objects would be redundant with
    // copy-and-verify.js itself, so this fake instead exposes an `apply(rows)` the test wires up
    // directly, matching how a real destination would end up after wrangler ran the same SQL.
    apply(rows) { for (const r of rows) store.set(keyOf(r), { ...r }); },
  };
}

describe('copyAndVerifyTable (in-memory transport)', () => {
  it('copies all source rows to an empty destination and verifies clean', async () => {
    const tableName = 'finance_import_log';
    const sourceRows = [
      { importer_key: 'church_qbo', last_imported_at: '2026-09-01T00:00:00Z', note: 'first run' },
      { importer_key: 'daycare_api', last_imported_at: '2026-09-02T00:00:00Z', note: '' },
    ];
    const dest = makeFakeD1(tableName, ['importer_key']);
    let writeCallCount = 0;
    const result = await copyAndVerifyTable(tableName, {
      readSourceRows: async () => sourceRows,
      readDestRows: async () => dest.snapshot(),
      writeStatements: async () => { writeCallCount += 1; dest.apply(sourceRows); },
    });
    expect(writeCallCount).toBe(1);
    expect(result.ok).toBe(true);
    expect(result.sourceRowCount).toBe(2);
    expect(result.count).toEqual({ ok: true, sourceCount: 2, destCount: 2 });
    expect(result.checksum.ok).toBe(true);
  });

  it('is idempotent: re-running against an already-populated destination does not duplicate rows or change the verified outcome', async () => {
    const tableName = 'finance_property_monthly';
    const sourceRows = [
      { property_key: 'ivanhoe', period: '2026-06', occupancy_pct: 0.95, total_revenue_cents: 4000000,
        total_expenses_cents: 2500000, net_income_cents: 1500000, net_operating_income_cents: 1800000,
        available_for_distribution_cents: 1200000, reserve_balance_cents: 900000, source_report: 'ahra',
        updated_at: '2026-07-01T00:00:00Z', loan_payment_cents: 378303, interest_expense_cents: 95205 },
    ];
    const dest = makeFakeD1(tableName, ['property_key', 'period']);
    const transport = {
      readSourceRows: async () => sourceRows,
      readDestRows: async () => dest.snapshot(),
      writeStatements: async () => { dest.apply(sourceRows); },
    };
    const first = await copyAndVerifyTable(tableName, transport);
    const second = await copyAndVerifyTable(tableName, transport);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(dest.snapshot()).toHaveLength(1);
  });

  it('an upsert overwrites a stale destination row with the current source value rather than leaving it out of date', async () => {
    const tableName = 'finance_import_log';
    const dest = makeFakeD1(tableName, ['importer_key']);
    dest.seed([{ importer_key: 'church_qbo', last_imported_at: '2026-08-01T00:00:00Z', note: 'stale' }]);
    const freshSource = [{ importer_key: 'church_qbo', last_imported_at: '2026-09-01T00:00:00Z', note: 'current' }];
    const result = await copyAndVerifyTable(tableName, {
      readSourceRows: async () => freshSource,
      readDestRows: async () => dest.snapshot(),
      writeStatements: async () => { dest.apply(freshSource); },
    });
    expect(result.ok).toBe(true);
    expect(dest.snapshot()).toEqual(freshSource);
  });

  it('reports a real failure honestly when the destination write silently drops a row', async () => {
    const tableName = 'finance_import_log';
    const sourceRows = [
      { importer_key: 'church_qbo', last_imported_at: '2026-09-01T00:00:00Z', note: '' },
      { importer_key: 'daycare_api', last_imported_at: '2026-09-02T00:00:00Z', note: '' },
    ];
    const dest = makeFakeD1(tableName, ['importer_key']);
    const result = await copyAndVerifyTable(tableName, {
      readSourceRows: async () => sourceRows,
      // Simulate a broken write that only applies the first row.
      readDestRows: async () => dest.snapshot(),
      writeStatements: async () => { dest.apply([sourceRows[0]]); },
    });
    expect(result.ok).toBe(false);
    expect(result.count.ok).toBe(false);
    expect(result.checksum.missingInDest).toEqual(['daycare_api']);
  });
});
