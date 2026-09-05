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

const EMPTY_YEAR_STATS = { giving_households: 0, giver_count: 0, band_high: 0, band_mid: 0, band_low: 0 };

async function readYearState(db, year) {
  const [dirty, stats, peopleReady] = await Promise.all([
    db.prepare('SELECT year FROM giving_rollup_dirty WHERE year=?').bind(year).first(),
    db.prepare('SELECT * FROM giving_year_stats WHERE year=?').bind(year).first(),
    db.prepare('SELECT 1 AS ready FROM giving_year_person_rollup_ready WHERE year=?').bind(year).first(),
  ]);
  return { dirty, stats, peopleReady };
}

export async function ensureGivingYearRollups(db, year) {
  let { dirty, stats, peopleReady } = await readYearState(db, year);
  if (!dirty && stats && peopleReady) return stats;

  // A crashed request must not block this year forever. INSERT OR IGNORE + RETURNING is the
  // database-level mutex: only one Worker isolate receives a row and scans the gift ledger.
  await db.prepare(
    `DELETE FROM giving_year_rollup_claims
      WHERE year=? AND claimed_at < datetime('now','-2 minutes')`
  ).bind(year).run();
  const token = `${Date.now()}-${Math.random()}`;
  const claim = await db.prepare(
    `INSERT OR IGNORE INTO giving_year_rollup_claims(year,token,claimed_at)
     VALUES(?,?,datetime('now')) RETURNING token`
  ).bind(year, token).first();

  if (!claim) {
    // Existing complete summaries are safe to serve briefly while another request refreshes.
    if (stats && peopleReady) return stats;
    // The first-ever materialization has no safe fallback. Wait briefly for its owner rather
    // than returning an empty chart or attempting the same expensive rebuild concurrently.
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 25));
      const active = await db.prepare(
        'SELECT 1 AS active FROM giving_year_rollup_claims WHERE year=?'
      ).bind(year).first();
      if (!active) {
        ({ dirty, stats, peopleReady } = await readYearState(db, year));
        if (!dirty && stats && peopleReady) return stats;
        return ensureGivingYearRollups(db, year);
      }
    }
    ({ stats } = await readYearState(db, year));
    return stats || EMPTY_YEAR_STATS;
  }

  let rebuilt = false;
  try {
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
    ]);
    stats = await db.prepare('SELECT * FROM giving_year_stats WHERE year=?').bind(year).first();
    rebuilt = true;
  } finally {
    // The claim trigger cleared the old dirty marker atomically. If a gift changed during the
    // rebuild, its new marker remains for the next request. A failed rebuild explicitly restores
    // a marker before releasing the claim so it is always retryable.
    if (!rebuilt) {
      await db.prepare(
        `INSERT INTO giving_rollup_dirty(year,dirtied_at) VALUES(?,datetime('now'))
         ON CONFLICT(year) DO UPDATE SET dirtied_at=excluded.dirtied_at`
      ).bind(year).run();
    }
    await db.prepare(
      'DELETE FROM giving_year_rollup_claims WHERE year=? AND token=?'
    ).bind(year, token).run();
  }
  return stats || EMPTY_YEAR_STATS;
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
