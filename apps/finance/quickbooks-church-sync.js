// ── QuickBooks → Church Report entries: Finance-owned port ───────────────────────────────────
// Verbatim copy of the pure helpers legacy Connect's finance/qb/sync and finance/qb/sync-years use
// to turn QuickBooks reports into finance_church_entries rows (src/api-finance.js:
// dollarsToCents, normalizeChurchClassification, the column extractors, parseMonthColTitle,
// flattenReportTree and persistChurchEntries). Finance becomes the only QuickBooks writer at the
// cutover (Andrew, 2026-09-25), so it needs its own copy rather than importing Connect code;
// test/finance-quickbooks-church-sync.test.js checks every function against Connect's original.
// After the cutover, Connect's copies are removed and this is the only one.

const RUNNING_SUBTOTAL_LABEL_RE = /^(Gross Profit|Net Operating (Income|Revenue)|Net Other (Income|Revenue)|Net (Income|Revenue))$/i;

export function dollarsToCents(v) {
  // Strips thousands-separator commas ("9,765.27") before parsing — parseFloat alone stops at
  // the first comma, silently truncating a pasted report figure down to its leading digits
  // (e.g. "9,765.27" -> 9) rather than failing loudly. A real property-report copy/paste is
  // exactly the kind of input this needs to tolerate.
  const n = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

const CHURCH_CLASSIFICATION_SYNONYMS = {
  revenue: 'Income', income: 'Income',
  expenditures: 'Expenses', expenses: 'Expenses',
  'cost of goods sold': 'Cost of Goods Sold', cogs: 'Cost of Goods Sold',
  'other income': 'Other Income', 'other revenue': 'Other Income',
  'other expenses': 'Other Expenses', 'other expenditures': 'Other Expenses',
};
export function normalizeChurchClassification(label) {
  const key = (label || '').trim().toLowerCase();
  return CHURCH_CLASSIFICATION_SYNONYMS[key] || (label || '').trim();
}

export function makeCurrentYearExtractor(year) {
  return (cells) => [{ fiscal_year: year, own_actual_cents: dollarsToCents(cells[1]?.value), own_budget_cents: dollarsToCents(cells[2]?.value) }];
}
// `colYears[i]` is the fiscal year for cells[i] (cells[0] is always the account name) — pass
// `null` for any column that isn't a real year (e.g. a trailing "Total" column) to skip it.
export function makeMultiYearExtractor(colYears) {
  return (cells) => colYears.map((year, i) => year == null ? null : {
    fiscal_year: year,
    own_actual_cents: dollarsToCents(cells[i + 1]?.value),
    own_budget_cents: null,
  }).filter(Boolean);
}
// A plain (non-summarized) ProfitAndLoss report requested for exactly one year has only 2
// columns (Account, Amount) — unlike makeCurrentYearExtractor, which expects a 3rd Budget
// column from the Budget-entity-merged tree. Used by the per-fiscal-year "Sync Selected Years"
// route (finance/qb/sync-years), which deliberately never touches Budget data — see that route.
export function makeSingleYearActualExtractor(year) {
  return (cells) => [{ fiscal_year: year, own_actual_cents: dollarsToCents(cells[1]?.value), own_budget_cents: null }];
}

// QBO's monthly-column ColTitle format is "Jan 2026", "Feb 2026", etc. Returns null for any
// title that doesn't match (e.g. a trailing "Total" column), so callers can skip it the same
// way makeMultiYearExtractor skips non-year columns.
const MONTH_ABBR = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
export function parseMonthColTitle(title) {
  const m = /^([A-Za-z]{3})\w*\s+(\d{4})$/.exec((title || '').trim());
  if (!m) return null;
  const month = MONTH_ABBR[m[1]];
  if (!month) return null;
  return { year: parseInt(m[2], 10), month };
}

// `colPeriods[i]` is the {year, month} for cells[i] (or null to skip, e.g. a trailing "Total"
// column) — only current + prior year are ever requested (see the sync handler), to bound sync
// cost, so this never runs against a full multi-year window.
export function makeMonthlyExtractor(colPeriods) {
  return (cells) => colPeriods.map((p, i) => p == null ? null : {
    fiscal_year: p.year,
    period_month: p.month,
    own_actual_cents: dollarsToCents(cells[i + 1]?.value),
    own_budget_cents: null,
  }).filter(Boolean);
}

export function flattenReportTree(rows, pathPrefix, classification, extractAmounts, out) {
  out = out || [];
  pathPrefix = pathPrefix || [];
  for (const row of (rows || [])) {
    if (row.type === 'Section') {
      const label = row.Header?.ColData?.[0]?.value || '';
      // A top-level Section IS the classification — but this company's live QuickBooks report
      // labels its sections "Revenue"/"Expenditures" (not QuickBooks' internal "Income"/
      // "Expenses"), the same real-world quirk normalizeChurchClassification() already handles
      // for the Excel-import path (see its own comment above). Without this, live-synced rows'
      // classification never matches FIN_CHURCH_CLASS_ORDER's keys client-side, so the Income
      // group silently sorts to the bottom and the Revenue/Earned-Income/Restricted-Income
      // regrouping (finReorganizeChurchTree) never fires for synced data — reported 2026-07-28
      // right after CHURCH_SOURCE_PRIORITY started preferring qbo_sync over a hand-imported
      // file, which is what made the pre-existing gap in this function visible for the first
      // time (the import path was always normalized; the live-sync path never was).
      const newClass = classification || normalizeChurchClassification(label);
      const newPath = pathPrefix.concat(label);
      const children = row.Rows?.Row || [];
      const headerCells = row.Header?.ColData;
      if (headerCells && headerCells.length >= 2) {
        for (const amt of extractAmounts(headerCells)) out.push(makeFlatRow(newPath, newClass, children.length > 0, amt));
      }
      flattenReportTree(children, newPath, newClass, extractAmounts, out);
    } else {
      const cells = row.ColData;
      if (!cells || cells.length < 2) continue; // bare label row, e.g. an empty "Other Income"
      const label = cells[0]?.value || '';
      if (RUNNING_SUBTOTAL_LABEL_RE.test(label)) continue;
      const newPath = pathPrefix.concat(label);
      for (const amt of extractAmounts(cells)) out.push(makeFlatRow(newPath, classification, false, amt));
    }
  }
  return out;
}
function makeFlatRow(path, classification, hasChildren, amt) {
  return {
    fiscal_year: amt.fiscal_year,
    period_month: amt.period_month || 0, // 0 = annual (see migrations/0018_finance_church_entries.sql)
    classification,
    category_path: path.join(':'),
    account_name: path[path.length - 1],
    depth: path.length - 1,
    has_children: hasChildren ? 1 : 0,
    own_actual_cents: amt.own_actual_cents,
    own_budget_cents: amt.own_budget_cents,
  };
}

export async function persistChurchEntries(db, rows, syncedAt) {
  if (!rows.length) return;
  const years = [...new Set(rows.map(r => r.fiscal_year))];
  const ops = years.map(y => db.prepare(`DELETE FROM finance_church_entries WHERE source='qbo_sync' AND fiscal_year=?`).bind(y));
  for (const r of rows) {
    ops.push(db.prepare(
      `INSERT INTO finance_church_entries
         (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source, synced_at)
       VALUES (?,?,?,?,?,?,?,?,?,'qbo_sync',?)
       ON CONFLICT(fiscal_year, period_month, category_path, source) DO UPDATE SET
         classification=excluded.classification, account_name=excluded.account_name, depth=excluded.depth,
         has_children=excluded.has_children, own_actual_cents=excluded.own_actual_cents,
         own_budget_cents=excluded.own_budget_cents, synced_at=excluded.synced_at`
    ).bind(r.fiscal_year, r.period_month || 0, r.classification, r.category_path, r.account_name, r.depth, r.has_children, r.own_actual_cents, r.own_budget_cents, syncedAt));
  }
  await db.batch(ops);
}
