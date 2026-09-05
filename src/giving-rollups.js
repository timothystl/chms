// Compact read models for giving. Raw gifts remain the transaction ledger; normal dashboards
// read these summaries. A year is rebuilt only after a gift or household classification changes.
export const REFRESH_GIVING_YEAR_PEOPLE_SQL = `
  INSERT INTO giving_year_person_totals(year, person_id, total_cents, gift_count, last_gift_date)
  SELECT ?, ge.person_id, SUM(ge.amount), COUNT(*), MAX(ge.contribution_date)
    FROM giving_entries ge
   WHERE ge.contribution_date BETWEEN ? AND ?
     AND ge.person_id IS NOT NULL
   GROUP BY ge.person_id`;

export const REFRESH_GIVING_YEAR_HOUSEHOLDS_SQL = `
  INSERT INTO giving_year_household_totals(year, household_key, total_cents, giver_count)
  SELECT ?, CASE WHEN p.household_id IS NOT NULL AND p.household_id != 0
                 THEN 'h:' || p.household_id ELSE 'p:' || p.id END,
         SUM(yp.total_cents), COUNT(*)
    FROM giving_year_person_totals yp JOIN people p ON p.id=yp.person_id
   WHERE yp.year=?
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
  const peopleReady = await db.prepare(
    'SELECT 1 AS ready FROM giving_year_person_rollup_ready WHERE year=?'
  ).bind(year).first();
  if (dirty || !stats || !peopleReady) {
    const start = `${year}-01-01`, end = `${year}-12-31`;
    await db.batch([
      db.prepare('DELETE FROM giving_year_person_totals WHERE year=?').bind(year),
      db.prepare(REFRESH_GIVING_YEAR_PEOPLE_SQL).bind(year, start, end),
      db.prepare('DELETE FROM giving_year_household_totals WHERE year=?').bind(year),
      db.prepare(REFRESH_GIVING_YEAR_HOUSEHOLDS_SQL).bind(year, year),
      db.prepare(REFRESH_GIVING_YEAR_STATS_SQL).bind(year, year),
      db.prepare(
        `INSERT INTO giving_year_person_rollup_ready(year,refreshed_at) VALUES(?,datetime('now'))
         ON CONFLICT(year) DO UPDATE SET refreshed_at=excluded.refreshed_at`
      ).bind(year),
      db.prepare('DELETE FROM giving_rollup_dirty WHERE year=?').bind(year),
    ]);
    stats = await db.prepare('SELECT * FROM giving_year_stats WHERE year=?').bind(year).first();
  }
  return stats || { giving_households: 0, giver_count: 0, band_high: 0, band_mid: 0, band_low: 0 };
}

export async function loadGivingYearTrendRows(db, years) {
  const cleanYears = [...new Set(years.map(Number).filter(Number.isInteger))];
  if (!cleanYears.length) return [];
  await Promise.all(cleanYears.map(year => ensureGivingYearRollups(db, year)));
  const placeholders = cleanYears.map(() => '?').join(',');
  const firstYear = Math.min(...cleanYears);
  const lastYear = Math.max(...cleanYears);
  const [totalsResult, giversResult] = await Promise.all([
    db.prepare(
      `SELECT CAST(substr(month,1,4) AS INTEGER) AS year,
              COALESCE(SUM(gift_count),0) AS gifts,
              COALESCE(SUM(total_cents),0) AS total_cents
         FROM giving_monthly_fund_totals
        WHERE month BETWEEN ? AND ?
        GROUP BY CAST(substr(month,1,4) AS INTEGER)`
    ).bind(`${firstYear}-01`, `${lastYear}-12`).all(),
    db.prepare(
      `SELECT year, COUNT(*) AS givers
         FROM giving_year_person_totals
        WHERE year IN (${placeholders}) GROUP BY year`
    ).bind(...cleanYears).all(),
  ]);
  const byYear = new Map(cleanYears.map(year => [year, { year, gifts: 0, givers: 0, total_cents: 0 }]));
  for (const row of totalsResult.results || []) Object.assign(byYear.get(Number(row.year)), row);
  for (const row of giversResult.results || []) byYear.get(Number(row.year)).givers = row.givers || 0;
  return cleanYears.map(year => byYear.get(year));
}
