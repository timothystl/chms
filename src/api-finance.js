// ── Finance Overview API handlers ──────────────────────────────────────────
// Finance-only feature (gated in api-chms.js, same as Tuition Aid). Unifies:
//  (1) QuickBooks Online — Budget vs Actual + account balances, via a real OAuth connection
//  (2) Daycare — manual entries, since the daycare app has no known export/API yet
// QBO amounts are kept as QBO returns them (decimal dollars) rather than converted to this
// app's integer-cents convention — they're display-only, never combined arithmetically with
// giving_entries/tuition figures.
import { json } from './auth.js';
import { getAuthorizeUrl, exchangeCodeForTokens, refreshTokens, revokeToken, makeQboClient, qboConfigured } from './quickbooks.js';
import { makeDaycareClient, daycareConfigured } from './daycare.js';

const CALLBACK_PATH = '/admin/api/finance/qb/callback';

async function getConnection(db) {
  return await db.prepare('SELECT * FROM finance_qb_connection WHERE id=1').first();
}

// Refreshes the access token if it's expired or about to be (within 2 minutes), persisting
// the new tokens. QBO rotates the refresh token on every use, so the old one must be replaced.
async function ensureFreshAccessToken(env, db, conn) {
  const expiresAtMs = conn.access_token_expires_at ? new Date(conn.access_token_expires_at).getTime() : 0;
  if (expiresAtMs - Date.now() > 2 * 60 * 1000) return conn;
  const refreshed = await refreshTokens(env, conn.refresh_token);
  const now = Date.now();
  const accessExpiresAt = new Date(now + (refreshed.expires_in || 3600) * 1000).toISOString();
  const refreshExpiresAt = new Date(now + (refreshed.x_refresh_token_expires_in || 8640000) * 1000).toISOString();
  await db.prepare(
    `UPDATE finance_qb_connection SET access_token=?, refresh_token=?, access_token_expires_at=?, refresh_token_expires_at=? WHERE id=1`
  ).bind(refreshed.access_token, refreshed.refresh_token, accessExpiresAt, refreshExpiresAt).run();
  return { ...conn, access_token: refreshed.access_token, refresh_token: refreshed.refresh_token,
           access_token_expires_at: accessExpiresAt, refresh_token_expires_at: refreshExpiresAt };
}

// Redirect target uses a query param (not a hash query) so the SPA's hash-based tab router
// (which expects '#finance' exactly, see showTab()) is untouched — the frontend reads the
// oauth result from location.search separately (see finCheckOauthReturn in js-finance.js).
function redirectToApp(url, qsParam, qsValue) {
  return new Response(null, { status: 302, headers: { Location: `${url.origin}/?${qsParam}=${encodeURIComponent(qsValue)}#finance` } });
}

// Merges a single leaf/subtotal row's budget amount in, by exact account-name match against
// the Budget entity. `ctx.budgetIdsByName` tracks how many DISTINCT account IDs share a given
// display name — the same account legitimately appears many times (one BudgetDetail line per
// month), which is NOT a collision, but two genuinely different accounts in different parent
// categories can share a bare name (e.g. an Income sub-account and an unrelated Expense
// sub-account both named "Plants and Soil" — confirmed against a real QuickBooks P&L export).
// Only merge when the name unambiguously maps to one account; otherwise leave it at $0 and flag
// it, rather than silently attributing one account's budget to a different account.
export function mergeLeafCells(cells, ctx) {
  const name = cells[0]?.value || '';
  const actual = Number(cells[cells.length - 1]?.value);
  const actualAmt = Number.isFinite(actual) ? actual : 0;
  const ids = ctx.budgetIdsByName.get(name);
  let budgetAmt = 0;
  if (ids && ids.size > 1) ctx.ambiguousNames.add(name);
  else if (ctx.budgetByName.has(name)) budgetAmt = ctx.budgetByName.get(name);
  return {
    cells: [{ value: name }, { value: actualAmt.toFixed(2) }, { value: budgetAmt.toFixed(2) }, { value: (actualAmt - budgetAmt).toFixed(2) }],
    budget: budgetAmt,
  };
}
// Merges one Section row (recursing into its children first), then derives the section's own
// subtotal (Summary row) as its own direct-posting amount (a parent account can carry postings
// of its own in addition to its sub-accounts, e.g. "Job Expenses" itself plus a nested "Job
// Materials" sub-section) PLUS every descendant's budget, summed bottom-up — this reproduces
// QBO's own "Total for X" math without needing to name-match the subtotal row itself (whose
// label, e.g. "Total for Job Materials", never appears verbatim in the Budget entity).
export function mergeSection(row, ctx) {
  const child = mergeTree(row.Rows?.Row, ctx);
  let ownBudget = 0;
  let newHeaderCells = row.Header?.ColData;
  if (newHeaderCells && newHeaderCells.length >= 2) {
    const m = mergeLeafCells(newHeaderCells, ctx);
    newHeaderCells = m.cells;
    ownBudget = m.budget;
  }
  const sectionBudget = ownBudget + child.budgetSum;
  let newSummaryCells = row.Summary?.ColData;
  if (newSummaryCells && newSummaryCells.length >= 2) {
    const actual = Number(newSummaryCells[newSummaryCells.length - 1]?.value) || 0;
    newSummaryCells = [newSummaryCells[0], { value: actual.toFixed(2) }, { value: sectionBudget.toFixed(2) }, { value: (actual - sectionBudget).toFixed(2) }];
  }
  return {
    row: {
      type: 'Section',
      Header: newHeaderCells ? { ColData: newHeaderCells } : row.Header,
      Rows: { Row: child.rows },
      Summary: newSummaryCells ? { ColData: newSummaryCells } : row.Summary,
    },
    budget: sectionBudget,
  };
}
// Recursively merges budget amounts into an arbitrarily-nested Section/Data row tree.
export function mergeTree(rows, ctx) {
  let budgetSum = 0;
  const out = (rows || []).map(row => {
    if (row.type === 'Section') {
      const { row: newRow, budget } = mergeSection(row, ctx);
      budgetSum += budget;
      return newRow;
    }
    const cells = row.ColData;
    if (!cells || cells.length < 2) return row; // label-only row with no amount column — leave untouched
    const m = mergeLeafCells(cells, ctx);
    budgetSum += m.budget;
    return { ColData: m.cells };
  });
  return { rows: out, budgetSum };
}
// Top-level P&L rows alternate Sections (Income / Cost of Goods Sold / Expenses / Other Income
// / Other Expenses — QBO's fixed, universal classification names, not custom labels) with flat
// running-subtotal rows (Gross Profit / Net Operating Income / Net Other Income / Net Income).
// "Other Income" starts a second, independent running total that only merges back in at "Net
// Income" — this is standard P&L structure, confirmed against a real exported QuickBooks report.
export function mergeProfitAndLossTree(rows, ctx) {
  let mainBudget = 0, otherBudget = 0, inOtherThread = false;
  return (rows || []).map(row => {
    if (row.type === 'Section') {
      const label = row.Header?.ColData?.[0]?.value || '';
      if (label === 'Other Income') inOtherThread = true;
      const { row: newRow, budget } = mergeSection(row, ctx);
      if (inOtherThread) otherBudget += budget; else mainBudget += budget;
      return newRow;
    }
    const cells = row.ColData;
    if (!cells || cells.length < 2) return row;
    const label = cells[0]?.value || '';
    const actual = Number(cells[cells.length - 1]?.value) || 0;
    const budgetVal = label === 'Net Income' ? (mainBudget + otherBudget) : (inOtherThread ? otherBudget : mainBudget);
    return { ColData: [{ value: label }, { value: actual.toFixed(2) }, { value: budgetVal.toFixed(2) }, { value: (actual - budgetVal).toFixed(2) }] };
  });
}

// Rows whose label is one of these are QuickBooks' own computed running subtotals (Gross
// Profit, Net Operating Income, etc.) rather than a real account — flattenReportTree() skips
// them, since they're always re-derivable from the classification totals at query time.
const RUNNING_SUBTOTAL_LABELS = new Set(['Gross Profit', 'Net Operating Income', 'Net Other Income', 'Net Income']);

function dollarsToCents(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// extractAmounts(cells) => array of {fiscal_year, own_actual_cents, own_budget_cents} — an array
// (not a single value) so the SAME tree-walk works for both a single-year budget-merged tree
// (1 result per node, cells = [Account,Actual,Budget,OverBudget]) and a multi-year actuals-only
// tree (N results per node, one per year column, cells = [Account,Year1,...,YearN]).
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

// Flattens a merged/plain QuickBooks Columns/Rows report tree into flat rows ready for
// finance_church_entries — one row per (real account node, fiscal year), holding only that
// node's own non-cumulative amount. Never emits a "Total for X" subtotal row (there isn't one in
// the tree to begin with — those live in row.Summary, which this deliberately never reads) or a
// running-subtotal row (Gross Profit et al, filtered via RUNNING_SUBTOTAL_LABELS) — both are
// always re-derivable from the stored per-account rows at query time.
export function flattenReportTree(rows, pathPrefix, classification, extractAmounts, out) {
  out = out || [];
  pathPrefix = pathPrefix || [];
  for (const row of (rows || [])) {
    if (row.type === 'Section') {
      const label = row.Header?.ColData?.[0]?.value || '';
      const newClass = classification || label; // a top-level Section IS the classification
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
      if (RUNNING_SUBTOTAL_LABELS.has(label)) continue;
      const newPath = pathPrefix.concat(label);
      for (const amt of extractAmounts(cells)) out.push(makeFlatRow(newPath, classification, false, amt));
    }
  }
  return out;
}
function makeFlatRow(path, classification, hasChildren, amt) {
  return {
    fiscal_year: amt.fiscal_year,
    classification,
    category_path: path.join(':'),
    account_name: path[path.length - 1],
    depth: path.length - 1,
    has_children: hasChildren ? 1 : 0,
    own_actual_cents: amt.own_actual_cents,
    own_budget_cents: amt.own_budget_cents,
  };
}

// Wholesale-replaces source='qbo_sync' rows for exactly the fiscal years present in `rows`
// (mirrors the finance_daycare_entries sync's per-period delete+insert pattern), scoped to only
// the years actually being rewritten so a partial sync failure never wipes years an earlier,
// separate flatten pass already wrote correctly. `rows` should already be in the desired
// write-order — when two rows share a (fiscal_year, category_path) key (e.g. a multi-year
// actuals-only row and a richer current-year budget-merge row for the same year), the one
// inserted LATER in the array wins via ON CONFLICT DO UPDATE.
export async function persistChurchEntries(db, rows, syncedAt) {
  if (!rows.length) return;
  const years = [...new Set(rows.map(r => r.fiscal_year))];
  const ops = years.map(y => db.prepare(`DELETE FROM finance_church_entries WHERE source='qbo_sync' AND fiscal_year=?`).bind(y));
  for (const r of rows) {
    ops.push(db.prepare(
      `INSERT INTO finance_church_entries
         (fiscal_year, period_month, classification, category_path, account_name, depth, has_children, own_actual_cents, own_budget_cents, source, synced_at)
       VALUES (?,0,?,?,?,?,?,?,?,'qbo_sync',?)
       ON CONFLICT(fiscal_year, period_month, category_path, source) DO UPDATE SET
         classification=excluded.classification, account_name=excluded.account_name, depth=excluded.depth,
         has_children=excluded.has_children, own_actual_cents=excluded.own_actual_cents,
         own_budget_cents=excluded.own_budget_cents, synced_at=excluded.synced_at`
    ).bind(r.fiscal_year, r.classification, r.category_path, r.account_name, r.depth, r.has_children, r.own_actual_cents, r.own_budget_cents, syncedAt));
  }
  await db.batch(ops);
}

// Fetches the Budget entity + a single current-year ProfitAndLoss report and merges them into
// one tree, via the same collision-safe mergeProfitAndLossTree() used everywhere else in this
// file. This is the one trusted place that produces a current-year Budget+Actual merged tree —
// used both by buildBudgetVsActualFallback() (when QuickBooks' own BudgetVsActual REPORT
// endpoint fails) and by the finance/qb/sync handler to populate finance_church_entries
// (always, regardless of whether the real report succeeded — its own column shape isn't
// guaranteed to match what this function's known 4-column Account/Actual/Budget/OverBudget
// shape assumes, so persistence never flattens it directly).
// ⚠ The exact Budget entity field names (BudgetDetail/AccountRef/Amount) are based on Intuit's
// published schema but could not be confirmed against a live response while building this (docs
// site blocked automated fetches) — if this returns no usable data, check the real shape of a
// `SELECT * FROM Budget` response against what's read below and adjust field names accordingly.
async function mergeCurrentYearBudgetAndActual(client, year, warnings) {
  const budgetsData = await fetchQboJson('Budget entity', client.budgets(), warnings);
  if (!budgetsData) return null;
  const budgetList = budgetsData?.QueryResponse?.Budget || [];
  const budget = budgetList.find(b => (b.StartDate || '').startsWith(String(year))) || budgetList[0];
  if (!budget) { warnings.push(`Budget entity: no Budget found for ${year}`); return null; }

  const plData = await fetchQboJson(
    'Profit and Loss (current year)',
    client.profitAndLoss({ start_date: `${year}-01-01`, end_date: `${year}-12-31` }),
    warnings
  );
  if (!plData || !plData.Rows) return null;

  // Sum by name (a single account legitimately has one BudgetDetail line per month), but also
  // track distinct account IDs per name so a genuine name collision across different accounts
  // can be told apart from ordinary multi-month lines for the same account.
  const budgetByName = new Map();
  const budgetIdsByName = new Map();
  for (const line of (budget.BudgetDetail || [])) {
    const name = line?.AccountRef?.name;
    const id = line?.AccountRef?.value;
    const amt = Number(line?.Amount);
    if (!name || !Number.isFinite(amt)) continue;
    budgetByName.set(name, (budgetByName.get(name) || 0) + amt);
    if (!budgetIdsByName.has(name)) budgetIdsByName.set(name, new Set());
    if (id != null) budgetIdsByName.get(name).add(id);
  }
  if (!budgetByName.size) { warnings.push('Budget entity: found a Budget but no usable BudgetDetail line items'); return null; }

  const ambiguousNames = new Set();
  const rows = mergeProfitAndLossTree(plData.Rows.Row, { budgetByName, budgetIdsByName, ambiguousNames });
  if (ambiguousNames.size) {
    warnings.push(
      `Budget vs Actual: ${ambiguousNames.size} account name(s) appear on more than one account in different categories (e.g. sub-accounts sharing a name across Income and Expenses) — shown as $0 budget rather than guessed which one: ${[...ambiguousNames].slice(0, 5).join(', ')}${ambiguousNames.size > 5 ? '…' : ''}`
    );
  }
  return { rows };
}

// Fallback for when the BudgetVsActual REPORT endpoint itself is blocked (hit a persistent
// "5020 Permission Denied" error during live testing even with a verified Budget and Company
// Admin access) but entity-level/other-report access still works. Wraps
// mergeCurrentYearBudgetAndActual()'s merged tree in the same Columns/Rows report shape the
// frontend already renders generically, so no frontend changes are needed to display it.
async function buildBudgetVsActualFallback(client, year, warnings) {
  const merged = await mergeCurrentYearBudgetAndActual(client, year, warnings);
  if (!merged) return null;
  return {
    Columns: { Column: [{ ColTitle: 'Account' }, { ColTitle: 'Actual' }, { ColTitle: 'Budget' }, { ColTitle: 'Over Budget By' }] },
    Rows: { Row: merged.rows },
    _synthesized: true,
  };
}

// Wraps a QuickBooks Accounting API call with the error-handling Intuit's own developer
// questionnaire asks about: captures the `intuit_tid` response header (Intuit's recommended
// field for support tickets), parses the structured Fault.Error[] body QBO returns on failure
// instead of just surfacing a bare HTTP status, and logs the full detail server-side (visible
// via `wrangler tail`/the Cloudflare dashboard) so a failure can be diagnosed without needing
// to reproduce it live.
async function fetchQboJson(label, resPromise, warnings, hint) {
  let r;
  try { r = await resPromise; }
  catch (e) {
    console.error(`[QuickBooks sync] ${label} request failed:`, e);
    warnings.push(`${label}: ${e.message}`);
    return null;
  }
  const tid = r.headers.get('intuit_tid') || '';
  if (r.ok) return await r.json();
  const fault = await r.json().catch(() => null);
  const faultError = fault?.Fault?.Error?.[0];
  const detail = [faultError?.Message, faultError?.Detail].filter(Boolean).join(' — ');
  console.error(`[QuickBooks sync] ${label} failed:`, { status: r.status, intuit_tid: tid, code: faultError?.code, message: faultError?.Message, detail: faultError?.Detail });
  warnings.push(
    `${label} (HTTP ${r.status}${tid ? `, intuit_tid ${tid}` : ''}${faultError?.code ? `, error code ${faultError.code}` : ''})`
    + (detail ? `: ${detail}` : '')
    + (hint ? ` — ${hint}` : '')
  );
  return null;
}

// Given all finance_church_entries rows for a set of years (any source), resolves per-year
// source precedence: a year with any 'import' or 'manual' row uses ONLY those rows (an import is
// always a deliberate override/backfill — see migrations/0018_finance_church_entries.sql); a
// year with only 'qbo_sync' rows uses those. One bulk query + JS grouping, not a correlated
// subquery per year, matching this app's existing performance conventions.
export function resolveChurchYearPrecedence(rows) {
  const bySourceThenYear = new Map(); // year -> { hasOverride, rows }
  for (const r of rows) {
    if (!bySourceThenYear.has(r.fiscal_year)) bySourceThenYear.set(r.fiscal_year, { hasOverride: false, rows: [] });
    const bucket = bySourceThenYear.get(r.fiscal_year);
    if (r.source !== 'qbo_sync') bucket.hasOverride = true;
    bucket.rows.push(r);
  }
  const out = [];
  for (const { hasOverride, rows: yearRows } of bySourceThenYear.values()) {
    out.push(...(hasOverride ? yearRows.filter(r => r.source !== 'qbo_sync') : yearRows.filter(r => r.source === 'qbo_sync')));
  }
  return out;
}

// Rolls a year's precedence-resolved flat rows up into per-classification actual/budget totals
// plus the derived running-subtotal figures (Gross Profit, Net Operating Income, Net Other
// Income, Net Income) — the same arithmetic mergeProfitAndLossTree() computes over a live tree,
// now computed over persisted rows instead. own_budget_cents is null when no budget is known for
// an account (as opposed to a real $0) — hasBudgetData is true only if at least one row in the
// year has a non-null budget, so the caller can show "no budget data" honestly instead of $0.
export function computeYearSummary(rows) {
  const byClass = {};
  let hasBudgetData = false;
  for (const r of rows) {
    if (!byClass[r.classification]) byClass[r.classification] = { actualCents: 0, budgetCents: 0 };
    byClass[r.classification].actualCents += r.own_actual_cents;
    if (r.own_budget_cents != null) { byClass[r.classification].budgetCents += r.own_budget_cents; hasBudgetData = true; }
  }
  const get = c => byClass[c] || { actualCents: 0, budgetCents: 0 };
  const income = get('Income'), cogs = get('Cost of Goods Sold'), expenses = get('Expenses'),
        otherIncome = get('Other Income'), otherExpenses = get('Other Expenses');
  const grossProfit = { actualCents: income.actualCents - cogs.actualCents, budgetCents: income.budgetCents - cogs.budgetCents };
  const netOperatingIncome = { actualCents: grossProfit.actualCents - expenses.actualCents, budgetCents: grossProfit.budgetCents - expenses.budgetCents };
  const netOtherIncome = { actualCents: otherIncome.actualCents - otherExpenses.actualCents, budgetCents: otherIncome.budgetCents - otherExpenses.budgetCents };
  const netIncome = { actualCents: netOperatingIncome.actualCents + netOtherIncome.actualCents, budgetCents: netOperatingIncome.budgetCents + netOtherIncome.budgetCents };
  return { classificationTotals: byClass, grossProfit, netOperatingIncome, netOtherIncome, netIncome, hasBudgetData };
}

export async function handleFinanceApi(req, env, url, method, seg, db, isAdmin, isFinance) {
  if (!isFinance) return json({ error: 'Access denied: finance data requires finance access' }, 403);

  // ── QuickBooks connection status ─────────────────────────────────────
  if (seg === 'finance/status' && method === 'GET') {
    const conn = await getConnection(db);
    const daycareSyncRow = await db.prepare("SELECT value FROM chms_config WHERE key='daycare_last_synced_at'").first();
    return json({
      configured: qboConfigured(env),
      connected: !!(conn && conn.realm_id),
      companyName: conn?.company_name || '',
      environment: conn?.environment || 'production',
      connectedAt: conn?.connected_at || '',
      lastSyncedAt: conn?.last_synced_at || '',
      daycareConfigured: daycareConfigured(env),
      daycareLastSyncedAt: daycareSyncRow?.value || '',
    });
  }

  // ── Begin OAuth: redirect the admin's browser to Intuit's consent screen ──
  if (seg === 'finance/qb/connect' && method === 'GET') {
    if (!isAdmin) return json({ error: 'Access denied: connecting QuickBooks requires admin access' }, 403);
    if (!qboConfigured(env)) return json({ error: 'QuickBooks is not configured. An admin must add QB_CLIENT_ID and QB_CLIENT_SECRET (see SECRETS.md).' }, 503);
    const redirectUri = new URL(CALLBACK_PATH, url.origin).toString();
    const state = crypto.randomUUID();
    if (env.RSVP_STORE) await env.RSVP_STORE.put(`qb_oauth_state:${state}`, '1', { expirationTtl: 600 });
    return new Response(null, { status: 302, headers: { Location: await getAuthorizeUrl(env, redirectUri, state) } });
  }

  // ── OAuth callback: Intuit redirects here with ?code&realmId&state ────
  if (seg === 'finance/qb/callback' && method === 'GET') {
    if (!isAdmin) return json({ error: 'Access denied' }, 403);
    const code = url.searchParams.get('code');
    const realmId = url.searchParams.get('realmId');
    const state = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');
    if (oauthError) return redirectToApp(url, 'qb_error', oauthError);
    if (!code || !realmId || !state) return redirectToApp(url, 'qb_error', 'missing_params');
    if (env.RSVP_STORE) {
      const stateOk = await env.RSVP_STORE.get(`qb_oauth_state:${state}`);
      if (!stateOk) return redirectToApp(url, 'qb_error', 'invalid_or_expired_state');
      await env.RSVP_STORE.delete(`qb_oauth_state:${state}`);
    }
    const redirectUri = new URL(CALLBACK_PATH, url.origin).toString();
    let tokens;
    try { tokens = await exchangeCodeForTokens(env, code, redirectUri); }
    catch (e) { return redirectToApp(url, 'qb_error', e.message); }
    const environment = env.QB_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production';
    const now = Date.now();
    const accessExpiresAt = new Date(now + (tokens.expires_in || 3600) * 1000).toISOString();
    const refreshExpiresAt = new Date(now + (tokens.x_refresh_token_expires_in || 8640000) * 1000).toISOString();
    let companyName = '';
    try {
      const client = makeQboClient(env, { realm_id: realmId, access_token: tokens.access_token, environment });
      const ciRes = await client.companyInfo();
      if (ciRes.ok) { const ci = await ciRes.json(); companyName = ci?.CompanyInfo?.CompanyName || ''; }
    } catch { /* non-fatal — connection still succeeds without a display name */ }
    await db.prepare(
      `INSERT INTO finance_qb_connection (id, realm_id, company_name, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, environment, connected_at, last_synced_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, datetime('now'), '')
       ON CONFLICT(id) DO UPDATE SET realm_id=excluded.realm_id, company_name=excluded.company_name,
         access_token=excluded.access_token, refresh_token=excluded.refresh_token,
         access_token_expires_at=excluded.access_token_expires_at, refresh_token_expires_at=excluded.refresh_token_expires_at,
         environment=excluded.environment, connected_at=datetime('now')`
    ).bind(realmId, companyName, tokens.access_token, tokens.refresh_token, accessExpiresAt, refreshExpiresAt, environment).run();
    return redirectToApp(url, 'qb_connected', '1');
  }

  // ── Disconnect ──────────────────────────────────────────────────────
  if (seg === 'finance/qb/disconnect' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied: disconnecting QuickBooks requires admin access' }, 403);
    const conn = await getConnection(db);
    if (conn?.refresh_token) await revokeToken(env, conn.refresh_token);
    await db.prepare('DELETE FROM finance_qb_connection WHERE id=1').run();
    await db.prepare("DELETE FROM finance_qb_snapshot").run();
    return json({ ok: true });
  }

  // ── Sync: pull Budget vs Actual + account balances, cache them ────────
  if (seg === 'finance/qb/sync' && method === 'POST') {
    const conn = await getConnection(db);
    if (!conn || !conn.realm_id) return json({ error: 'QuickBooks is not connected yet.' }, 400);
    let fresh;
    try { fresh = await ensureFreshAccessToken(env, db, conn); }
    catch (e) { return json({ error: 'QuickBooks re-authentication failed — try disconnecting and reconnecting. (' + e.message + ')' }, 502); }
    const client = makeQboClient(env, fresh);
    const year = new Date().getFullYear();
    const warnings = [];

    // Built once via our own trusted merge pipeline (known, tested Columns shape) — used both
    // to persist finance_church_entries below (always) and as the Overview tab's fallback
    // display when QuickBooks' own BudgetVsActual report call fails. Never flatten the real
    // budgetVsActual report itself into finance_church_entries: its exact column layout isn't
    // guaranteed to match this function's known 4-column shape.
    const currentYearMerge = await mergeCurrentYearBudgetAndActual(client, year, warnings);

    let budgetVsActual = await fetchQboJson(
      'Budget vs Actual',
      client.budgetVsActual({ start_date: `${year}-01-01`, end_date: `${year}-12-31` }),
      warnings,
      `make sure a Budget for ${year} exists in QuickBooks under Settings > Budgeting`
    );
    if (!budgetVsActual && currentYearMerge) {
      budgetVsActual = {
        Columns: { Column: [{ ColTitle: 'Account' }, { ColTitle: 'Actual' }, { ColTitle: 'Budget' }, { ColTitle: 'Over Budget By' }] },
        Rows: { Row: currentYearMerge.rows },
        _synthesized: true,
      };
      warnings.push('Budget vs Actual: showing data reconstructed from the raw Budget entity + Profit and Loss report instead, since the standard report endpoint failed above.');
    }
    const accounts = await fetchQboJson('Account balances', client.accounts(), warnings);
    // Board-level "Church Report": one P&L column per calendar year over a 5-year trailing
    // window (matches the app's existing 5-year convention, e.g. AT6's multi-year attendance
    // comparison). No Budget setup required — P&L is actuals-only.
    const PNL_YEARS_BACK = 4;
    const profitAndLoss = await fetchQboJson(
      'Profit & Loss (multi-year)',
      client.profitAndLoss({ start_date: `${year - PNL_YEARS_BACK}-01-01`, end_date: `${year}-12-31`, summarize_column_by: 'Year' }),
      warnings
    );
    const syncedAt = new Date().toISOString();
    const ops = [];
    if (budgetVsActual) ops.push(db.prepare(
      `INSERT INTO finance_qb_snapshot (key,value,synced_at) VALUES ('budget_vs_actual',?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, synced_at=excluded.synced_at`
    ).bind(JSON.stringify(budgetVsActual), syncedAt));
    if (accounts) ops.push(db.prepare(
      `INSERT INTO finance_qb_snapshot (key,value,synced_at) VALUES ('accounts',?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, synced_at=excluded.synced_at`
    ).bind(JSON.stringify(accounts), syncedAt));
    if (ops.length) await db.batch(ops);

    // ── Persist into finance_church_entries ────────────────────────────
    // Order matters: multi-year (actuals-only) rows are flattened FIRST, then the current-year
    // budget-merge rows SECOND, so the richer current-year row's ON CONFLICT DO UPDATE
    // overwrites whatever the multi-year pass just wrote for that same year — see
    // migrations/0018_finance_church_entries.sql for the full design rationale.
    const churchRows = [];
    if (profitAndLoss && profitAndLoss.Rows) {
      const cols = (profitAndLoss.Columns && profitAndLoss.Columns.Column) || [];
      const colYears = cols.map(c => { const m = /(\d{4})/.exec(c.ColTitle || ''); return m ? parseInt(m[1], 10) : null; });
      flattenReportTree(profitAndLoss.Rows.Row, [], null, makeMultiYearExtractor(colYears), churchRows);
    }
    if (currentYearMerge) {
      flattenReportTree(currentYearMerge.rows, [], null, makeCurrentYearExtractor(year), churchRows);
    }
    await persistChurchEntries(db, churchRows, syncedAt);

    await db.prepare('UPDATE finance_qb_connection SET last_synced_at=? WHERE id=1').bind(syncedAt).run();
    return json({ ok: true, syncedAt, warnings, fetched: { budgetVsActual: !!budgetVsActual, accounts: !!accounts, profitAndLoss: !!profitAndLoss }, churchEntriesSynced: churchRows.length });
  }

  // ── Overview: cached QBO data + daycare summary, for the Finance tab ──
  if (seg === 'finance/overview' && method === 'GET') {
    const conn = await getConnection(db);
    const snapRows = (await db.prepare('SELECT key,value,synced_at FROM finance_qb_snapshot').all()).results || [];
    const snaps = {};
    for (const s of snapRows) { try { snaps[s.key] = { data: JSON.parse(s.value), syncedAt: s.synced_at }; } catch { /* skip corrupt cache row */ } }
    return json({
      connected: !!(conn && conn.realm_id),
      companyName: conn?.company_name || '',
      lastSyncedAt: conn?.last_synced_at || '',
      budgetVsActual: snaps.budget_vs_actual?.data || null,
      budgetSyncedAt: snaps.budget_vs_actual?.syncedAt || '',
      accounts: snaps.accounts?.data || null,
      accountsSyncedAt: snaps.accounts?.syncedAt || '',
      daycareAccounts: snaps.daycare_accounts?.data || null,
      daycareAccountsSyncedAt: snaps.daycare_accounts?.syncedAt || '',
    });
  }

  // ── Daycare — pull from the daycare app's finance API, if configured ──
  // Wholesale-replaces only source='daycare_api' rows for the periods present in the
  // response, leaving any hand-entered ('manual') rows untouched — see SECRETS.md for the
  // response contract the daycare app's /api/finance/summary endpoint must implement.
  if (seg === 'finance/daycare/sync' && method === 'POST') {
    const client = makeDaycareClient(env);
    if (!client) return json({ error: 'The daycare app is not configured. Add DAYCARE_API_URL and DAYCARE_API_KEY (see SECRETS.md).' }, 503);
    let res;
    try { res = await client.summary(); }
    catch (e) { return json({ error: 'Could not reach the daycare app: ' + e.message }, 502); }
    if (!res.ok) return json({ error: `Daycare app returned HTTP ${res.status}` }, 502);
    let data; try { data = await res.json(); } catch { return json({ error: 'Daycare app returned invalid JSON' }, 502); }
    const rows = Array.isArray(data.budget) ? data.budget : [];
    const periods = [...new Set(rows.map(r => r.period).filter(p => /^\d{4}-\d{2}$/.test(p)))];
    const ops = [];
    if (periods.length) {
      const placeholders = periods.map(() => '?').join(',');
      ops.push(db.prepare(`DELETE FROM finance_daycare_entries WHERE source='daycare_api' AND period IN (${placeholders})`).bind(...periods));
    }
    let imported = 0;
    for (const r of rows) {
      if (!/^\d{4}-\d{2}$/.test(r.period) || !r.category || (r.type !== 'actual' && r.type !== 'budget')) continue;
      const cents = Math.round(Number(r.amount_cents));
      if (!Number.isFinite(cents)) continue;
      ops.push(db.prepare(
        `INSERT INTO finance_daycare_entries (period,category,entry_type,amount_cents,source) VALUES (?,?,?,?,'daycare_api')`
      ).bind(r.period, String(r.category).trim(), r.type, cents));
      imported++;
    }
    if (ops.length) await db.batch(ops);
    const syncedAt = new Date().toISOString();
    await db.prepare(
      `INSERT INTO chms_config (key,value) VALUES ('daycare_last_synced_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).bind(syncedAt).run();
    // Cache accounts too, alongside the QBO ones, so the balances table can show both.
    if (Array.isArray(data.accounts)) {
      await db.prepare(
        `INSERT INTO finance_qb_snapshot (key,value,synced_at) VALUES ('daycare_accounts',?,?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, synced_at=excluded.synced_at`
      ).bind(JSON.stringify(data.accounts), syncedAt).run();
    }
    return json({ ok: true, syncedAt, imported, periods });
  }

  // ── Daycare — manual entries (no known API/export yet) ────────────────
  if (seg === 'finance/daycare' && method === 'GET') {
    const rows = (await db.prepare('SELECT * FROM finance_daycare_entries ORDER BY period DESC, category ASC, id DESC').all()).results || [];
    return json({ entries: rows });
  }

  if (seg === 'finance/daycare' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!b.period || !/^\d{4}(-\d{2})?$/.test(b.period)) return json({ error: 'Period must be YYYY or YYYY-MM' }, 400);
    if (!b.category || !String(b.category).trim()) return json({ error: 'Category is required' }, 400);
    const amountCents = Math.round(Number(b.amount_cents));
    if (!Number.isFinite(amountCents)) return json({ error: 'Invalid amount' }, 400);
    const entryType = b.entry_type === 'budget' ? 'budget' : 'actual';
    const r = await db.prepare(
      `INSERT INTO finance_daycare_entries (period,category,entry_type,amount_cents,notes) VALUES (?,?,?,?,?)`
    ).bind(b.period, String(b.category).trim(), entryType, amountCents, b.notes || '').run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }

  const dcMatch = seg.match(/^finance\/daycare\/(\d+)$/);
  if (dcMatch && method === 'PUT') {
    const id = parseInt(dcMatch[1], 10);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const existing = await db.prepare('SELECT * FROM finance_daycare_entries WHERE id=?').bind(id).first();
    if (!existing) return json({ error: 'Not found' }, 404);
    if (b.period !== undefined && !/^\d{4}(-\d{2})?$/.test(b.period)) return json({ error: 'Period must be YYYY or YYYY-MM' }, 400);
    const amountCents = b.amount_cents !== undefined ? Math.round(Number(b.amount_cents)) : existing.amount_cents;
    if (!Number.isFinite(amountCents)) return json({ error: 'Invalid amount' }, 400);
    await db.prepare(
      `UPDATE finance_daycare_entries SET period=?, category=?, entry_type=?, amount_cents=?, notes=? WHERE id=?`
    ).bind(
      b.period ?? existing.period,
      b.category !== undefined ? String(b.category).trim() : existing.category,
      b.entry_type === 'budget' ? 'budget' : (b.entry_type === 'actual' ? 'actual' : existing.entry_type),
      amountCents, b.notes ?? existing.notes, id
    ).run();
    return json({ ok: true });
  }
  if (dcMatch && method === 'DELETE') {
    await db.prepare('DELETE FROM finance_daycare_entries WHERE id=?').bind(parseInt(dcMatch[1], 10)).run();
    return json({ ok: true });
  }

  // ── Church Report v2: This Year — persisted-table read, no live QuickBooks call ────────
  if (seg === 'finance/church/this-year' && method === 'GET') {
    const year = parseInt(url.searchParams.get('year'), 10) || new Date().getFullYear();
    const allRows = (await db.prepare('SELECT * FROM finance_church_entries WHERE fiscal_year=?').bind(year).all()).results || [];
    const entries = resolveChurchYearPrecedence(allRows);
    const summary = computeYearSummary(entries);
    const givingRow = await db.prepare(
      `SELECT COALESCE(SUM(amount),0) AS total FROM giving_entries WHERE contribution_date BETWEEN ? AND ?`
    ).bind(`${year}-01-01`, `${year}-12-31`).first();
    return json({
      year,
      entries,
      ...summary,
      givingCents: givingRow?.total || 0,
    });
  }

  // ── Church Report v2: Multi-Year — persisted-table read, one bulk query + JS grouping ──
  if (seg === 'finance/church/multi-year' && method === 'GET') {
    const yearsParam = url.searchParams.get('years');
    const currentYear = new Date().getFullYear();
    const years = yearsParam
      ? yearsParam.split(',').map(y => parseInt(y, 10)).filter(Number.isFinite)
      : [currentYear - 4, currentYear - 3, currentYear - 2, currentYear - 1, currentYear];
    if (!years.length) return json({ error: 'No valid years requested' }, 400);
    const placeholders = years.map(() => '?').join(',');
    const allRows = (await db.prepare(`SELECT * FROM finance_church_entries WHERE fiscal_year IN (${placeholders})`).bind(...years).all()).results || [];
    const resolved = resolveChurchYearPrecedence(allRows);
    const byYear = {};
    years.forEach(y => { byYear[y] = computeYearSummary(resolved.filter(r => r.fiscal_year === y)); });
    return json({ years, byYear });
  }

  return null;
}
