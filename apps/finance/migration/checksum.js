// Row-level checksum used by copy-and-verify.js to confirm the destination physically matches the
// source after a copy -- not just the same row count, but the same values in every copied column.
import { createHash } from 'node:crypto';

// Field separator / null sentinel built at runtime (rather than written as literal escape
// sequences in this source file) purely so this file stays plain, printable ASCII on disk. Both
// are non-printable control characters chosen to make an accidental collision with real column
// data (account names, notes, category paths, etc.) practically impossible.
const FIELD_SEP = String.fromCharCode(31); // ASCII unit separator
const NULL_SENTINEL = String.fromCharCode(0); // ASCII NUL

// A stable, order-independent-of-object-key-order serialization: always walk `table.columns` in
// the registry's own declared order, so the checksum only ever depends on column values, never on
// how a particular row object happened to be constructed. `undefined` and `null` are folded to the
// same sentinel so a driver that omits a null column and one that returns it explicitly as `null`
// still checksum identically.
export function canonicalRowKey(columns, row) {
  return columns.map((col) => {
    const value = row[col];
    if (value === undefined || value === null) return NULL_SENTINEL;
    return typeof value === 'number' ? `n:${value}` : `s:${value}`;
  }).join(FIELD_SEP);
}

export function computeRowChecksum(columns, row) {
  return createHash('sha256').update(canonicalRowKey(columns, row)).digest('hex');
}

// The conflict-key tuple (e.g. `id`, or `property_key<SEP>period`) used both as the SQL upsert
// target and as the join key when comparing source vs. destination rows during verification.
export function rowIdentity(conflictColumns, row) {
  return conflictColumns.map((col) => String(row[col])).join(FIELD_SEP);
}
