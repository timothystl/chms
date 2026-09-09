import { runBudgetedReadBatch } from './query-budget.js';

export async function readSyntheticDataStatus(db) {
  const sql = "SELECT importer_key, last_imported_at, note FROM finance_import_log WHERE importer_key='synthetic_fixture'";
  const { results } = await runBudgetedReadBatch(db, 'dataStatus', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Synthetic Data status row invalid');
  const row = rows[0];
  if (row.importer_key !== 'synthetic_fixture'
    || typeof row.last_imported_at !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(row.last_imported_at)
    || typeof row.note !== 'string') throw new Error('Synthetic Data status row invalid');
  return { ...row };
}

export function buildDataStatusView(row, now = new Date()) {
  const importedAtMs = Date.parse(row.last_imported_at);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(importedAtMs) || !Number.isFinite(nowMs) || importedAtMs > nowMs) {
    throw new Error('Synthetic Data freshness timestamps invalid');
  }
  const freshnessWindowDays = 30;
  const ageDays = Math.floor((nowMs - importedAtMs) / 86400000);
  return {
    source: row.importer_key,
    lastImportedAt: row.last_imported_at,
    note: row.note,
    productionConnected: false,
    writerConnected: false,
    freshnessWindowDays,
    ageDays,
    freshness: ageDays > freshnessWindowDays ? 'stale' : 'current',
  };
}
