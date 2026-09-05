// Compact read models for giving. Raw gifts remain the transaction ledger; normal dashboards
// read these summaries. A year is rebuilt only after a gift or household classification changes.
export const REFRESH_GIVING_YEAR_HOUSEHOLDS_SQL = `
  INSERT INTO giving_year_household_totals(year, household_key, total_cents, giver_count)
  SELECT ?, CASE WHEN p.household_id IS NOT NULL AND p.household_id != 0
                 THEN 'h:' || p.household_id ELSE 'p:' || p.id END,
         SUM(ge.amount), COUNT(DISTINCT ge.person_id)
    FROM giving_entries ge JOIN people p ON p.id=ge.person_id
   WHERE ge.contribution_date BETWEEN ? AND ?
     AND LOWER(COALESCE(p.member_type,'')) != 'organization'
   GROUP BY 2`;

export const REFRESH_GIVING_YEAR_STATS_SQL = `
  INSERT INTO giving_year_stats
    (year, giving_households, giver_count, band_high, band_mid, band_low, refreshed_at)
  SELECT ?, COUNT(*),
         COALESCE(SUM(giver_count),0),
         COALESCE(SUM(CASE WHEN total_cents>=200000 THEN 1 ELSE 0 END),0),
         COALESCE(SUM(CASE WHEN total_cents>=50000 AND total_cents<200000 THEN 1 ELSE 0 END),0),
         COALESCE(SUM(CASE WHEN total_cents>0 AND total_cents<50000 THEN 1 ELSE 0 END),0),
         datetime('now')
    FROM giving_year_household_totals WHERE year=?
  ON CONFLICT(year) DO UPDATE SET
    giving_households=excluded.giving_households, giver_count=excluded.giver_count,
    band_high=excluded.band_high, band_mid=excluded.band_mid, band_low=excluded.band_low,
    refreshed_at=excluded.refreshed_at`;

export async function ensureGivingYearRollups(db, year) {
  const dirty = await db.prepare('SELECT year FROM giving_rollup_dirty WHERE year=?').bind(year).first();
  let stats = await db.prepare('SELECT * FROM giving_year_stats WHERE year=?').bind(year).first();
  if (dirty || !stats) {
    const start = `${year}-01-01`, end = `${year}-12-31`;
    await db.batch([
      db.prepare('DELETE FROM giving_year_household_totals WHERE year=?').bind(year),
      db.prepare(REFRESH_GIVING_YEAR_HOUSEHOLDS_SQL).bind(year, start, end),
      db.prepare(REFRESH_GIVING_YEAR_STATS_SQL).bind(year, year),
      db.prepare('DELETE FROM giving_rollup_dirty WHERE year=?').bind(year),
    ]);
    stats = await db.prepare('SELECT * FROM giving_year_stats WHERE year=?').bind(year).first();
  }
  return stats || { giving_households: 0, giver_count: 0, band_high: 0, band_mid: 0, band_low: 0 };
}
