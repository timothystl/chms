import { runBudgetedReadBatch } from './query-budget.js';
import { fetchLiveFinanceDataStatus } from './finance-data-status-client.js';

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

// Tries the real connect.finance-data-status.v1 endpoint; falls back to the existing synthetic
// fixture row whenever the live call isn't configured yet or fails for any reason -- same
// never-throws, always-labeled pattern as shell.js's resolveGivingSummary. `db` here is Finance's
// own FINANCE_DB, used only for the synthetic fallback path.
export async function resolveDataStatus(env, db) {
  const result = await fetchLiveFinanceDataStatus(env);
  if (result.ok) {
    const { imports, quickbooks } = result.status;
    return {
      row: {
        importer_key: 'connect-live',
        last_imported_at: imports.mostRecentImportAt || result.status.generatedAt,
        note: imports.importerCount === 1
          ? '1 importer recorded in Connect'
          : `${imports.importerCount} importers recorded in Connect`,
      },
      source: 'live',
      productionConnected: true,
      writerConnected: quickbooks.connected,
    };
  }
  const row = await readSyntheticDataStatus(db);
  return {
    row,
    source: 'synthetic-fallback',
    productionConnected: false,
    writerConnected: false,
    fallbackReason: result.reason,
  };
}

// Unchanged signature/behavior for a bare synthetic row (flags default to the isolated-staging
// posture every existing caller/test already expects); resolveDataStatus's live path passes
// `flags` explicitly to report the real connection state instead.
export function buildDataStatusView(row, now = new Date(), flags = {}) {
  const { productionConnected = false, writerConnected = false } = flags;
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
    productionConnected,
    writerConnected,
    freshnessWindowDays,
    ageDays,
    freshness: ageDays > freshnessWindowDays ? 'stale' : 'current',
  };
}
