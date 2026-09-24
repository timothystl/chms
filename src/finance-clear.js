// D1 cannot transact across owners. Clear the derived cache first, then the
// authoritative entries; report completed steps so a fresh preview can resume.
export const CHURCH_CLEAR_TABLES = ['finance_qb_snapshot', 'finance_church_entries'];
export async function clearChurchReport(db, confirmCounts) {
  const actual = {};
  for (const table of CHURCH_CLEAR_TABLES) {
    actual[table] = (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first())?.n || 0;
  }
  if (CHURCH_CLEAR_TABLES.some(t => confirmCounts[t] !== actual[t])) {
    return { status: 409, error: 'Confirmation mismatch — data has changed. Reload the preview and confirm again.', actual };
  }
  const cleared = {};
  for (const table of CHURCH_CLEAR_TABLES) {
    try {
      // The count check and delete are one atomic statement in each owner.
      const result = await db.prepare(`DELETE FROM ${table} WHERE (SELECT COUNT(*) FROM ${table}) = ?`).bind(actual[table]).run();
      const changes = result.meta?.changes ?? result.changes;
      if (changes !== actual[table]) {
        return { status: 409, error: 'Data changed while clearing. Some steps may have completed; reload the preview and confirm the remaining data.', cleared, remaining: table };
      }
      cleared[table] = changes;
    } catch {
      return { status: 503, error: 'Clearing stopped before all steps were confirmed. Reload the preview to see the remaining data before retrying.', cleared, remaining: table };
    }
  }
  return { ok: true, cleared };
}
