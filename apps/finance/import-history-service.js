import { ensureFinanceOwnedSchema } from './finance-owned-schema.js';

const IMPORTER_LABELS = Object.freeze({
  church_budget: 'Budget (single year)',
  church_monthly_pnl: 'Monthly P&L',
  church_activity_multi: 'Statement of Activity (multi-year)',
  church_budget_multi: 'Budget by Year (multi-year)',
  church_balance: 'Balance Sheet',
  church_balance_multi: 'Financial Position (multi-year)',
  property_monthly_csv: 'AHRA monthly financials',
  property_budget_xlsx: 'AHRA budget detail',
  daycare_church_budget: 'MDO accounts from church budget',
  daycare_bulk: 'Daycare bulk paste',
});

export async function readImportHistory(db, limit = 200) {
  if (!db || !(await ensureFinanceOwnedSchema(db, 'importHistory'))) {
    return { ok: false, error: 'Import history storage is unavailable.' };
  }
  // Preserve the latest pre-history event for each importer as an honest baseline. New imports
  // append directly in recordImport(); this backfill is idempotent through the unique index.
  await db.prepare(
    `INSERT OR IGNORE INTO finance_import_history (importer_key, imported_at, note)
     SELECT importer_key, last_imported_at, note FROM finance_import_log
     WHERE importer_key != 'synthetic_fixture' AND last_imported_at != ''`
  ).run();
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const { results = [] } = await db.prepare(
    `SELECT id, importer_key, imported_at, note
     FROM finance_import_history ORDER BY imported_at DESC, id DESC LIMIT ?`
  ).bind(safeLimit).all();
  return {
    ok: true,
    rows: results.map((row) => ({
      id: row.id,
      importerKey: row.importer_key,
      importerLabel: IMPORTER_LABELS[row.importer_key] || row.importer_key,
      importedAt: row.imported_at,
      note: row.note || '',
    })),
  };
}
