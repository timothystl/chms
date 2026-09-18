// Core copy-and-verify logic for the 13 schema-matching Stage 1 tables (see table-registry.js).
//
// This module is intentionally D1-transport-agnostic: it only knows how to turn an array of
// plain-object rows into idempotent SQL, and how to compare two arrays of rows for count/checksum
// equality. Reading the source and applying the generated SQL to the destination is the caller's
// job -- see cli.js for the actual `wrangler d1 execute` transport this project uses (a one-time
// admin script, per AGENTS.md's preference for no new live HTTP endpoint on the Worker for a
// one-time operation), and the tests in
// ../../../test/finance-migration-copy-and-verify.test.js for the in-memory transport used to
// exercise this file without touching any real D1 database.
import { getTableConfig } from './table-registry.js';
import { computeRowChecksum, rowIdentity } from './checksum.js';

// SQLite/D1 string-literal escaping. Every value copy-and-verify.js writes comes from a `SELECT *`
// off the source table (never from unvalidated external input), but every string is still escaped
// rather than trusted, since these statements are generated as plain SQL text for
// `wrangler d1 execute --file=...` rather than sent as bound parameters.
export function sqlLiteral(value) {
  if (value === undefined || value === null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Refusing to write non-finite number ${value} into generated SQL`);
    return String(value);
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;
}

// One idempotent multi-row upsert statement per chunk of `rows`. ON CONFLICT(...) DO UPDATE means
// re-running this against a destination that already has some or all of these rows updates them
// in place instead of erroring or duplicating -- the "safely re-runnable" requirement.
export function buildUpsertStatements(tableName, rows, { chunkSize = 200 } = {}) {
  const table = getTableConfig(tableName);
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const updateAssignments = table.columns
    .filter((col) => !table.conflictColumns.includes(col))
    .map((col) => `${col}=excluded.${col}`)
    .join(', ');
  const statements = [];
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const valuesSql = chunk
      .map((row) => `(${table.columns.map((col) => sqlLiteral(row[col])).join(', ')})`)
      .join(',\n  ');
    // A table with no columns outside its conflict key (never true here, but kept safe) would
    // produce an empty SET list; DO NOTHING is the correct idempotent behavior for that case.
    const conflictClause = updateAssignments
      ? `ON CONFLICT(${table.conflictColumns.join(', ')}) DO UPDATE SET ${updateAssignments}`
      : `ON CONFLICT(${table.conflictColumns.join(', ')}) DO NOTHING`;
    statements.push(
      `INSERT INTO ${tableName} (${table.columns.join(', ')}) VALUES\n  ${valuesSql}\n${conflictClause};`
    );
  }
  return statements;
}

export function verifyRowCount(sourceRows, destRows) {
  const sourceCount = sourceRows.length;
  const destCount = destRows.length;
  return { ok: sourceCount === destCount, sourceCount, destCount };
}

// Row-level checksum comparison, joined on each table's declared conflict-key columns (not
// row/statement order, which D1 does not guarantee). Reports exactly what's wrong -- missing,
// extra, or present-but-different -- rather than a single pass/fail bit, so a real reconciliation
// run has something actionable to look at.
export function verifyChecksums(tableName, sourceRows, destRows) {
  const table = getTableConfig(tableName);
  const sourceByKey = new Map(sourceRows.map((row) => [rowIdentity(table.conflictColumns, row), row]));
  const destByKey = new Map(destRows.map((row) => [rowIdentity(table.conflictColumns, row), row]));
  const mismatched = [];
  const missingInDest = [];
  for (const [key, sourceRow] of sourceByKey) {
    const destRow = destByKey.get(key);
    if (!destRow) { missingInDest.push(key); continue; }
    const sourceSum = computeRowChecksum(table.columns, sourceRow);
    const destSum = computeRowChecksum(table.columns, destRow);
    if (sourceSum !== destSum) mismatched.push(key);
  }
  const extraInDest = [...destByKey.keys()].filter((key) => !sourceByKey.has(key));
  return {
    ok: mismatched.length === 0 && missingInDest.length === 0 && extraInDest.length === 0,
    mismatched, missingInDest, extraInDest,
  };
}

// Orchestrates one table's copy against injected read/write functions, so the same function
// backs both the real `wrangler d1 execute` CLI transport and the in-memory tests. `writeStatements`
// is expected to apply every statement to the destination (a no-op call when there is nothing to
// copy). `readDestRows` is called AFTER the write so verification reflects what's actually there.
export async function copyAndVerifyTable(tableName, { readSourceRows, readDestRows, writeStatements, chunkSize }) {
  const sourceRows = await readSourceRows(tableName);
  const statements = buildUpsertStatements(tableName, sourceRows, { chunkSize });
  if (statements.length > 0) await writeStatements(tableName, statements);
  const destRows = await readDestRows(tableName);
  const countResult = verifyRowCount(sourceRows, destRows);
  const checksumResult = verifyChecksums(tableName, sourceRows, destRows);
  return {
    table: tableName,
    sourceRowCount: sourceRows.length,
    statementsApplied: statements.length,
    count: countResult,
    checksum: checksumResult,
    ok: countResult.ok && checksumResult.ok,
  };
}
