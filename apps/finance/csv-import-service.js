// ── Finance-owned CSV import writes (Church, Balance, Daycare, Property Budget) ────────────────
//
// This is the first capability in the new Finance app that writes to Finance's OWN database
// (FINANCE_DB) rather than relaying a write to Connect/Website (see route-manifest.js's
// `giving-quick-entry-v1`/`budget-plan-write-v1`/payroll relays) or reading a synthetic fixture.
// It is a deliberate, narrow port of four of legacy Connect's real import write paths
// (`src/api-finance.js`'s `finance/church/import`, `finance/church/balances/import`,
// `finance/daycare/bulk`, and the AHRA `finance/property/:key/budget-import`/
// `finance/property/:key/monthly-import-csv` routes) — CSV only here, not the ~750-line server-
// side .xlsx grid reader legacy also has for the Church/Balance Excel exports. Every write below
// is gated OFF by default (see `isCsvImportWritesEnabled`) — this ships code-complete and tested,
// not reachable in production, pending a later, separately-approved cutover stage.
//
// `apps/finance` never imports from the legacy `src/` tree (confirmed: no existing file in this
// directory does) — that boundary is the whole point of splitting Finance out. So the CSV
// tokenizer and thousands-comma-aware money parser below are PORTED (same algorithm, not a
// weaker rewrite), not imported, from `src/api-utils.js`'s `parseCsvRows` and
// `src/api-finance.js`'s local `dollarsToCents` — see each function's own comment for exactly
// what bug each one avoids and why a naive rewrite would reintroduce it.
//
// "Never fabricate a number" (see e.g. `church-report-service.js`, `render-helpers.js`) applies
// here as: a cell that cannot be read as a real amount is a hard validation error for the whole
// import, never a silently-substituted 0 or null. This is intentionally STRICTER than legacy's
// own `dollarsToCents`, which returns 0 for anything non-numeric — legacy accepts that for
// hand-verified report exports; a fresh CSV write path with no human preview step should fail
// loudly instead of quietly writing a wrong zero into a ledger.

// Full-text CSV reader, quote-aware across the WHOLE input rather than splitting into lines first
// — splitting first corrupts a quoted field that itself contains a newline (or a bare \r/\n
// inside quotes) into extra bogus rows, since the split never sees the surrounding quotes. Ported
// verbatim from `src/api-utils.js`'s `parseCsvRows` (same algorithm — see that function's own
// comment for the embedded-newline bug this avoids). Returns an array of cell-string-array rows;
// a row consisting of a single empty cell (a genuinely blank source line) is dropped.
export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(cur); cur = ''; continue; }
    if (ch === '\r') { if (s[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; continue; }
    if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; continue; }
    cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

// Strips thousands-separator commas ("9,765.27") before parsing — ported from
// `src/api-finance.js`'s local `dollarsToCents`, which exists because `parseFloat` alone stops at
// the first comma, silently truncating a pasted report figure down to its leading digits (e.g.
// "9,765.27" -> 9) rather than failing loudly. Unlike that legacy helper (which returns 0 for
// anything non-numeric), this returns `null` for a value that cannot be read as a real number —
// see this module's header comment on why an import write path fails closed instead of
// fabricating a zero. Returns `{ cents: null }` (not an error) for a blank string when `optional`
// is true, since several columns below (own_budget, notes, has_children) are genuinely optional.
export function parseMoneyCents(raw, { optional = false } = {}) {
  const s = String(raw == null ? '' : raw).trim();
  if (s === '') return optional ? { cents: null } : { error: 'is required' };
  const cleaned = s.replace(/,/g, '').replace(/^\$/, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return { error: `is not a valid amount ("${raw}")` };
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return { error: `is not a valid amount ("${raw}")` };
  return { cents: Math.round(n * 100) };
}

// Header-indexed CSV reader shared by every parser below — same shape as legacy's
// `parsePropertyMonthlyCsv` (lower-cased, trimmed header names; a `get(col)` accessor per row).
function readCsvWithHeader(text, requiredCols) {
  const allRows = parseCsvRows(text);
  if (!allRows.length) return { error: 'Empty file.' };
  const header = allRows[0].map((h) => String(h || '').trim().toLowerCase());
  const idx = {};
  header.forEach((h, i) => { idx[h] = i; });
  for (const col of requiredCols) {
    if (!(col in idx)) return { error: `Missing required column "${col}".` };
  }
  const dataRows = allRows.slice(1).map((cells, i) => ({
    lineNumber: i + 2, // header is line 1; first data row is line 2
    get: (col) => (idx[col] != null ? cells[idx[col]] : undefined),
  }));
  return { dataRows };
}

const TRUTHY = new Set(['1', 'true', 'yes', 'y']);
function parseBool(raw) {
  return TRUTHY.has(String(raw == null ? '' : raw).trim().toLowerCase());
}

function parseDepth(raw, lineNumber, errors) {
  const s = String(raw == null ? '' : raw).trim();
  if (!/^\d+$/.test(s)) { errors.push(`Row ${lineNumber}: "depth" must be a whole number (got "${raw}")`); return 0; }
  return parseInt(s, 10);
}

function requireNonEmpty(raw, col, lineNumber, errors) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) errors.push(`Row ${lineNumber}: "${col}" is required`);
  return s;
}

// ── Church Report: annual Budget-vs-Actuals CSV import (writes finance_church_entries) ─────────
// CSV columns: classification (Income/Expenses), category_path, account_name, depth,
// has_children (optional), own_actual, own_budget (optional). `fiscal_year` is a single request
// parameter (one file = one fiscal year), matching legacy's `finance/church/import` commit step.
const CHURCH_CLASSIFICATIONS = { income: 'Income', expenses: 'Expenses' };
const CHURCH_ENTRIES_REQUIRED_COLS = ['classification', 'category_path', 'account_name', 'depth', 'own_actual'];

export function parseChurchEntriesCsv(text) {
  const read = readCsvWithHeader(text, CHURCH_ENTRIES_REQUIRED_COLS);
  if (read.error) return { rows: [], errors: [read.error] };
  const errors = [];
  const rows = [];
  for (const { lineNumber, get } of read.dataRows) {
    const classificationRaw = requireNonEmpty(get('classification'), 'classification', lineNumber, errors);
    const classification = CHURCH_CLASSIFICATIONS[classificationRaw.toLowerCase()];
    if (classificationRaw && !classification) errors.push(`Row ${lineNumber}: "classification" must be "Income" or "Expenses" (got "${classificationRaw}")`);
    const categoryPath = requireNonEmpty(get('category_path'), 'category_path', lineNumber, errors);
    const accountName = requireNonEmpty(get('account_name'), 'account_name', lineNumber, errors);
    const depth = parseDepth(get('depth'), lineNumber, errors);
    const hasChildren = parseBool(get('has_children'));
    const actual = parseMoneyCents(get('own_actual'));
    if (actual.error) errors.push(`Row ${lineNumber}: "own_actual" ${actual.error}`);
    const budget = parseMoneyCents(get('own_budget'), { optional: true });
    if (budget.error) errors.push(`Row ${lineNumber}: "own_budget" ${budget.error}`);
    if (errors.length) continue;
    rows.push({
      classification, category_path: categoryPath, account_name: accountName, depth,
      has_children: hasChildren, own_actual_cents: actual.cents, own_budget_cents: budget.cents,
    });
  }
  return { rows: errors.length ? [] : rows, errors };
}

// Wholesale-replaces source='import_csv' rows for exactly one fiscal year, the same
// re-import-is-idempotent delete-then-insert pattern as legacy's `persistChurchEntriesImport` —
// scoped to its own 'import_csv' source so it can never touch 'synthetic_fixture', 'qbo_sync', or
// (once ported) a future xlsx 'import' row for the same account. `period_month` is always 0
// (annual), matching the annual Budget-vs-Actuals shape.
export async function persistChurchEntriesCsvImport(db, rows, fiscalYear, importedAt) {
  const ops = [db.prepare(`DELETE FROM finance_church_entries WHERE source='import_csv' AND fiscal_year=?`).bind(fiscalYear)];
  for (const r of rows) {
    ops.push(db.prepare(
      `INSERT INTO finance_church_entries
         (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source, synced_at)
       VALUES (?,0,?,?,?,?,?,?,?,'import_csv',?)
       ON CONFLICT(fiscal_year, period_month, category_path, source) DO UPDATE SET
         classification=excluded.classification, account_name=excluded.account_name, depth=excluded.depth,
         has_children=excluded.has_children, own_actual_cents=excluded.own_actual_cents,
         own_budget_cents=excluded.own_budget_cents, synced_at=excluded.synced_at`
    ).bind(fiscalYear, r.classification, r.category_path, r.account_name, r.depth, r.has_children ? 1 : 0, r.own_actual_cents, r.own_budget_cents, importedAt));
  }
  await db.batch(ops);
}

// ── Balance Sheet: Statement of Financial Position CSV import (writes finance_church_balances) ─
// CSV columns: classification (Assets/Liabilities/Equity), category_path, account_name, depth,
// has_children (optional), own_balance. `fiscal_year`/`as_of_date` are request parameters (one
// file = one point-in-time snapshot), matching legacy's `finance/church/balances/import`.
const BALANCE_CLASSIFICATIONS = { assets: 'Assets', liabilities: 'Liabilities', equity: 'Equity' };
const CHURCH_BALANCES_REQUIRED_COLS = ['classification', 'category_path', 'account_name', 'depth', 'own_balance'];

export function parseChurchBalancesCsv(text) {
  const read = readCsvWithHeader(text, CHURCH_BALANCES_REQUIRED_COLS);
  if (read.error) return { rows: [], errors: [read.error] };
  const errors = [];
  const rows = [];
  for (const { lineNumber, get } of read.dataRows) {
    const classificationRaw = requireNonEmpty(get('classification'), 'classification', lineNumber, errors);
    const classification = BALANCE_CLASSIFICATIONS[classificationRaw.toLowerCase()];
    if (classificationRaw && !classification) errors.push(`Row ${lineNumber}: "classification" must be "Assets", "Liabilities", or "Equity" (got "${classificationRaw}")`);
    const categoryPath = requireNonEmpty(get('category_path'), 'category_path', lineNumber, errors);
    const accountName = requireNonEmpty(get('account_name'), 'account_name', lineNumber, errors);
    const depth = parseDepth(get('depth'), lineNumber, errors);
    const hasChildren = parseBool(get('has_children'));
    const balance = parseMoneyCents(get('own_balance'));
    if (balance.error) errors.push(`Row ${lineNumber}: "own_balance" ${balance.error}`);
    if (errors.length) continue;
    rows.push({
      classification, category_path: categoryPath, account_name: accountName, depth,
      has_children: hasChildren, own_balance_cents: balance.cents,
    });
  }
  return { rows: errors.length ? [] : rows, errors };
}

// Wholesale-replaces source='import_csv' rows for exactly one fiscal year — same
// re-import-is-idempotent pattern as `persistChurchEntriesCsvImport` above and legacy's
// `persistChurchBalancesImport`, scoped to its own 'import_csv' source.
export async function persistChurchBalancesCsvImport(db, rows, fiscalYear, asOfDate, importedAt) {
  const ops = [db.prepare(`DELETE FROM finance_church_balances WHERE source='import_csv' AND fiscal_year=?`).bind(fiscalYear)];
  for (const r of rows) {
    ops.push(db.prepare(
      `INSERT INTO finance_church_balances
         (fiscal_year, as_of_date, classification, category_path, account_name, depth, has_children, own_balance_cents, source, synced_at)
       VALUES (?,?,?,?,?,?,?,?,'import_csv',?)
       ON CONFLICT(fiscal_year, category_path, source) DO UPDATE SET
         as_of_date=excluded.as_of_date, classification=excluded.classification, account_name=excluded.account_name,
         depth=excluded.depth, has_children=excluded.has_children, own_balance_cents=excluded.own_balance_cents,
         synced_at=excluded.synced_at`
    ).bind(fiscalYear, asOfDate, r.classification, r.category_path, r.account_name, r.depth, r.has_children ? 1 : 0, r.own_balance_cents, importedAt));
  }
  await db.batch(ops);
}

// ── Daycare: category actuals/budget CSV import (writes finance_daycare_entries) ───────────────
// CSV columns: period (YYYY or YYYY-MM), category, entry_type (actual/budget, defaults to
// actual), amount, notes (optional). Same fields as legacy's `finance/daycare/bulk` paste-in
// route, but read from an uploaded CSV instead of a JSON array, and — unlike that legacy route,
// which plain-inserts with no source tag distinct from a hand-typed row (see
// `src/api-finance.js`'s own comment on why `daycare_bulk` is left out of its derived-import-date
// list: "there is no signal that separates an import from hand entry") — this tags every row
// `source='import_csv'` and wholesale-replaces per period, so re-uploading a corrected file
// replaces rather than duplicates, the same idempotent-re-import guarantee the other three
// importers in this file already give.
const DAYCARE_ENTRIES_REQUIRED_COLS = ['period', 'category', 'amount'];

export function parseDaycareEntriesCsv(text) {
  const read = readCsvWithHeader(text, DAYCARE_ENTRIES_REQUIRED_COLS);
  if (read.error) return { rows: [], errors: [read.error] };
  const errors = [];
  const rows = [];
  for (const { lineNumber, get } of read.dataRows) {
    const period = String(get('period') || '').trim();
    if (!/^\d{4}(-\d{2})?$/.test(period)) errors.push(`Row ${lineNumber}: "period" must be YYYY or YYYY-MM (got "${period}")`);
    const category = requireNonEmpty(get('category'), 'category', lineNumber, errors);
    const entryTypeRaw = String(get('entry_type') || '').trim().toLowerCase();
    if (entryTypeRaw && entryTypeRaw !== 'actual' && entryTypeRaw !== 'budget') errors.push(`Row ${lineNumber}: "entry_type" must be "actual" or "budget" (got "${get('entry_type')}")`);
    const entryType = entryTypeRaw === 'budget' ? 'budget' : 'actual';
    const amount = parseMoneyCents(get('amount'));
    if (amount.error) errors.push(`Row ${lineNumber}: "amount" ${amount.error}`);
    if (errors.length) continue;
    rows.push({ period, category, entry_type: entryType, amount_cents: amount.cents, notes: String(get('notes') || '').trim() });
  }
  return { rows: errors.length ? [] : rows, errors };
}

export async function persistDaycareEntriesCsvImport(db, rows, importedAt) {
  const periods = [...new Set(rows.map((r) => r.period))];
  const ops = periods.map((p) => db.prepare(`DELETE FROM finance_daycare_entries WHERE source='import_csv' AND period=?`).bind(p));
  for (const r of rows) {
    ops.push(db.prepare(
      `INSERT INTO finance_daycare_entries (period, category, entry_type, amount_cents, notes, source, created_at) VALUES (?,?,?,?,?,'import_csv',?)`
    ).bind(r.period, r.category, r.entry_type, r.amount_cents, r.notes, importedAt));
  }
  await db.batch(ops);
}

// ── Commercial Property: monthly budget CSV import (writes finance_property_budget_monthly) ────
// CSV columns: period (YYYY-MM), revenue, expenses. `net_income` is always computed as
// revenue-minus-expenses (never read from the CSV, and never independently supplied) — same
// arithmetic legacy's AHRA xlsx importer uses in `parsePropertyBudgetDetailGrid`
// (`netIncomeCents: revenueCents - expensesCents`), so the two importers can never disagree on
// what net income means for the same revenue/expense figures. `property_key` is a request
// parameter (defaults to the schema's own default, 'ivanhoe'), not a CSV column, matching
// legacy's `finance/property/:propertyKey/budget-import` (the property is part of the URL).
const PROPERTY_BUDGET_REQUIRED_COLS = ['period', 'revenue', 'expenses'];

export function parsePropertyBudgetMonthlyCsv(text) {
  const read = readCsvWithHeader(text, PROPERTY_BUDGET_REQUIRED_COLS);
  if (read.error) return { rows: [], errors: [read.error] };
  const errors = [];
  const rows = [];
  for (const { lineNumber, get } of read.dataRows) {
    const period = String(get('period') || '').trim();
    if (!/^\d{4}-\d{2}$/.test(period)) errors.push(`Row ${lineNumber}: "period" must be YYYY-MM (got "${period}")`);
    const revenue = parseMoneyCents(get('revenue'));
    if (revenue.error) errors.push(`Row ${lineNumber}: "revenue" ${revenue.error}`);
    const expenses = parseMoneyCents(get('expenses'));
    if (expenses.error) errors.push(`Row ${lineNumber}: "expenses" ${expenses.error}`);
    if (errors.length) continue;
    rows.push({ period, revenue_cents: revenue.cents, expenses_cents: expenses.cents, net_income_cents: revenue.cents - expenses.cents });
  }
  return { rows: errors.length ? [] : rows, errors };
}

// Upserts one row per (property_key, period) — same ON CONFLICT shape as legacy's AHRA import
// (`finance/property/:key/budget-import` in src/api-finance.js), tagged `source='import_csv'` to
// keep this CSV path's provenance distinct from a future ported xlsx importer that might reuse
// legacy's literal 'ahra_import' tag for the same table.
export async function persistPropertyBudgetMonthlyCsvImport(db, rows, propertyKey, importedAt) {
  const ops = rows.map((r) => db.prepare(
    `INSERT INTO finance_property_budget_monthly (property_key, period, revenue_cents, expenses_cents, net_income_cents, source, updated_at)
     VALUES (?,?,?,?,?,'import_csv',?)
     ON CONFLICT(property_key, period) DO UPDATE SET revenue_cents=excluded.revenue_cents, expenses_cents=excluded.expenses_cents, net_income_cents=excluded.net_income_cents, source=excluded.source, updated_at=excluded.updated_at`
  ).bind(propertyKey, r.period, r.revenue_cents, r.expenses_cents, r.net_income_cents, importedAt));
  await db.batch(ops);
}

// ── Shared import-log bookkeeping (writes finance_import_log) ──────────────────────────────────
// Same upsert-by-importer-key shape and same "logging failure must never fail an already-
// succeeded import" discipline as legacy's `recordImport` in src/api-finance.js.
export async function recordFinanceImport(db, importerKey, note, importedAt) {
  try {
    await db.prepare(
      `INSERT INTO finance_import_log (importer_key,last_imported_at,note) VALUES (?,?,?)
       ON CONFLICT(importer_key) DO UPDATE SET last_imported_at=excluded.last_imported_at, note=excluded.note`
    ).bind(importerKey, importedAt, note || '').run();
  } catch { /* the import itself succeeded; staleness bookkeeping must never fail it */ }
}

// ── Off-by-default production gate ──────────────────────────────────────────────────────────────
// Every route in this file is a genuine FINANCE_DB writer, unlike everything else in the app (see
// this module's header comment). Per the sequenced rollout plan, this ships code-complete and
// fully tested but NOT reachable in production: a real request hits this gate before any parsing
// or writing happens, and gets a clear "not yet enabled" response instead of a write. Checked in
// two places, either of which turns it on — an env var (for a staging/ops toggle that needs no DB
// write) or a `finance_settings` row (for a toggle an admin can flip without a deploy) — and BOTH
// default to off: an absent env var and an absent/non-'1' settings row both mean disabled. Any
// error reading the settings row (including no FINANCE_DB binding at all) also means disabled —
// this fails closed, never open.
export async function isCsvImportWritesEnabled(env, db) {
  if (env && (env.FINANCE_CSV_IMPORT_WRITES_ENABLED === '1' || env.FINANCE_CSV_IMPORT_WRITES_ENABLED === 'true')) return true;
  if (!db) return false;
  try {
    const row = await db.prepare("SELECT value FROM finance_settings WHERE key='finance_csv_import_writes_enabled'").first();
    return !!row && row.value === '1';
  } catch {
    return false;
  }
}

export const CSV_IMPORT_WRITES_DISABLED_MESSAGE =
  'CSV import writes are not yet enabled. This capability is code-complete and tested but ' +
  'intentionally gated off pending a later, separately-approved production cutover stage.';

// ── Request-level orchestration (parse → validate → persist → log), one per import type ────────
// Each function is pure with respect to HTTP: it takes the already-parsed JSON body and the
// FINANCE_DB binding, and returns a plain result object `{ ok, status, ... }` for shell.js to turn
// into a Response — shell.js owns all HTTP/Response concerns (headers, JSON encoding), exactly
// like every other handler in this app.
function badRequest(error, details) {
  return details ? { ok: false, status: 400, error, details } : { ok: false, status: 400, error };
}

export async function runChurchEntriesCsvImport(env, db, body) {
  if (!(await isCsvImportWritesEnabled(env, db))) return { ok: false, status: 403, error: CSV_IMPORT_WRITES_DISABLED_MESSAGE };
  const fiscalYear = parseInt(body && body.fiscal_year, 10);
  if (!Number.isFinite(fiscalYear)) return badRequest('fiscal_year is required');
  if (typeof (body && body.csv) !== 'string' || !body.csv.trim()) return badRequest('csv is required');
  const { rows, errors } = parseChurchEntriesCsv(body.csv);
  if (errors.length) return badRequest('Could not read this CSV.', errors);
  if (!rows.length) return badRequest('No data rows found in this CSV.');
  const importedAt = new Date().toISOString();
  try {
    await persistChurchEntriesCsvImport(db, rows, fiscalYear, importedAt);
  } catch (e) {
    return { ok: false, status: 500, error: `Could not save ${rows.length} row(s) for FY${fiscalYear}: ${e && e.message ? e.message : String(e)}` };
  }
  await recordFinanceImport(db, 'church_budget_csv', `FY${fiscalYear}`, importedAt);
  return { ok: true, status: 200, fiscalYear, imported: rows.length };
}

export async function runChurchBalancesCsvImport(env, db, body) {
  if (!(await isCsvImportWritesEnabled(env, db))) return { ok: false, status: 403, error: CSV_IMPORT_WRITES_DISABLED_MESSAGE };
  const fiscalYear = parseInt(body && body.fiscal_year, 10);
  if (!Number.isFinite(fiscalYear)) return badRequest('fiscal_year is required');
  const asOfDate = String((body && body.as_of_date) || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) return badRequest('as_of_date is required and must be YYYY-MM-DD');
  if (typeof (body && body.csv) !== 'string' || !body.csv.trim()) return badRequest('csv is required');
  const { rows, errors } = parseChurchBalancesCsv(body.csv);
  if (errors.length) return badRequest('Could not read this CSV.', errors);
  if (!rows.length) return badRequest('No data rows found in this CSV.');
  const importedAt = new Date().toISOString();
  try {
    await persistChurchBalancesCsvImport(db, rows, fiscalYear, asOfDate, importedAt);
  } catch (e) {
    return { ok: false, status: 500, error: `Could not save ${rows.length} balance row(s) for FY${fiscalYear}: ${e && e.message ? e.message : String(e)}` };
  }
  await recordFinanceImport(db, 'church_balance_csv', `FY${fiscalYear}`, importedAt);
  return { ok: true, status: 200, fiscalYear, asOfDate, imported: rows.length };
}

export async function runDaycareEntriesCsvImport(env, db, body) {
  if (!(await isCsvImportWritesEnabled(env, db))) return { ok: false, status: 403, error: CSV_IMPORT_WRITES_DISABLED_MESSAGE };
  if (typeof (body && body.csv) !== 'string' || !body.csv.trim()) return badRequest('csv is required');
  const { rows, errors } = parseDaycareEntriesCsv(body.csv);
  if (errors.length) return badRequest('Could not read this CSV.', errors);
  if (!rows.length) return badRequest('No data rows found in this CSV.');
  const importedAt = new Date().toISOString();
  try {
    await persistDaycareEntriesCsvImport(db, rows, importedAt);
  } catch (e) {
    return { ok: false, status: 500, error: `Could not save ${rows.length} row(s): ${e && e.message ? e.message : String(e)}` };
  }
  const periods = [...new Set(rows.map((r) => r.period))].sort();
  await recordFinanceImport(db, 'daycare_bulk_csv', periods.length === 1 ? periods[0] : `${periods[0]}–${periods[periods.length - 1]}`, importedAt);
  return { ok: true, status: 200, periods, imported: rows.length };
}

export async function runPropertyBudgetMonthlyCsvImport(env, db, body) {
  if (!(await isCsvImportWritesEnabled(env, db))) return { ok: false, status: 403, error: CSV_IMPORT_WRITES_DISABLED_MESSAGE };
  const propertyKey = String((body && body.property_key) || 'ivanhoe').trim();
  if (!propertyKey) return badRequest('property_key must not be blank');
  if (typeof (body && body.csv) !== 'string' || !body.csv.trim()) return badRequest('csv is required');
  const { rows, errors } = parsePropertyBudgetMonthlyCsv(body.csv);
  if (errors.length) return badRequest('Could not read this CSV.', errors);
  if (!rows.length) return badRequest('No data rows found in this CSV.');
  const importedAt = new Date().toISOString();
  try {
    await persistPropertyBudgetMonthlyCsvImport(db, rows, propertyKey, importedAt);
  } catch (e) {
    return { ok: false, status: 500, error: `Could not save ${rows.length} month(s) for ${propertyKey}: ${e && e.message ? e.message : String(e)}` };
  }
  await recordFinanceImport(db, 'property_budget_csv', `${propertyKey}: ${rows.length} month(s)`, importedAt);
  return { ok: true, status: 200, propertyKey, imported: rows.length };
}
