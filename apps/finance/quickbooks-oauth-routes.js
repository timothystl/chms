// ── QuickBooks connection and sync, owned by Finance ─────────────────────────────────────────────
// Andrew, 2026-09-25: the QuickBooks connection moves from Connect to Finance. These handlers are
// Finance's own connect / callback / disconnect / sync / sync-years / budget-selection, wired in
// shell.js behind FINANCE_QB_ENABLED ('1' turns them on; anything else answers "not enabled").
// Every table they touch lives in Finance's database (FINANCE_DB): finance_qb_connection,
// finance_qb_snapshot and finance_qb_oauth_state from migrations/0008, plus finance_settings and
// finance_church_entries, which the storage cutover already moved here.
//
// One refresh-token writer at every moment. Intuit rotates the refresh token on use, so two
// services holding the same connection would break each other. The cutover therefore never copies
// Connect's token: Connect is switched off (QBO_MANAGED_BY_FINANCE) and disconnected first, then an
// admin makes a fresh "Connect QuickBooks" consent here, giving Finance its own token. See
// docs/QUICKBOOKS_FINANCE_CUTOVER.md.
//
// Each handler takes `(req, url, env, db, ctx)`; `ctx.isAdmin` must come from Finance's verified
// role (connect-role-client.js). `ctx.fetchImpl` / `ctx.now` / `ctx.randomUUID` exist for tests.
// Sync mirrors legacy finance/qb/sync and finance/qb/sync-years (src/api-finance.js) step for step,
// including writing finance_church_entries under source 'qbo_sync'.

import { getAuthorizeUrl, exchangeCodeForTokens, revokeToken, refreshTokens, makeQboClient, qboConfigured } from './quickbooks-oauth-client.js';
import { ensureFreshAccessToken } from './quickbooks-token-service.js';
import { mergeCurrentYearBudgetAndActual, fetchQboJson } from './quickbooks-budget-merge.js';
import {
  flattenReportTree, makeCurrentYearExtractor, makeMonthlyExtractor, makeMultiYearExtractor,
  makeSingleYearActualExtractor, parseMonthColTitle, persistChurchEntries,
} from './quickbooks-church-sync.js';

const STATE_TTL_MS = 10 * 60 * 1000; // same window as legacy Connect's KV entry
const PNL_YEARS_BACK = 4;
export const QB_PAGE = '/?section=quickbooks&page=sync-status';

export function qbEnabled(env) {
  return env.FINANCE_QB_ENABLED === '1';
}

function back(params) {
  const query = new URLSearchParams({ section: 'quickbooks', page: 'sync-status', ...params });
  return new Response(null, { status: 303, headers: { Location: `/?${query.toString()}` } });
}

function refused(message) {
  return back({ qb: 'error', message });
}

export async function getConnection(db) {
  return await db.prepare('SELECT * FROM finance_qb_connection WHERE id=1').first();
}

// What the QuickBooks page shows about Finance's own connection. Never returns tokens.
export async function readConnectionSummary(db) {
  const row = await db.prepare('SELECT realm_id, company_name, environment, connected_at, last_synced_at, refresh_token_expires_at FROM finance_qb_connection WHERE id=1').first();
  if (!row || !row.realm_id) return { connected: false };
  return {
    connected: true, companyName: row.company_name || '', environment: row.environment || 'production',
    connectedAt: row.connected_at || '', lastSyncedAt: row.last_synced_at || '', reconnectBy: row.refresh_token_expires_at || '',
  };
}

async function freshClient(env, db, ctx) {
  const conn = await getConnection(db);
  if (!conn || !conn.realm_id) return { error: 'QuickBooks is not connected yet.' };
  try {
    const fresh = await ensureFreshAccessToken(env, db, conn, { refreshTokensFn: (e, rt) => refreshTokens(e, rt, ctx.fetchImpl), now: ctx.now });
    return { client: makeQboClient(env, fresh, ctx.fetchImpl) };
  } catch (e) {
    return { error: 'QuickBooks re-authentication failed — disconnect and connect again. (' + e.message + ')' };
  }
}

// GET /api/v1/qb/connect → Intuit consent screen.
export async function handleConnect(req, url, env, db, ctx) {
  if (!ctx?.isAdmin) return refused('Only admins can connect QuickBooks.');
  if (!qboConfigured(env)) return refused('QuickBooks credentials are not configured for Finance (FINANCE_QB_CLIENT_ID and FINANCE_QB_CLIENT_SECRET).');
  const state = ctx.randomUUID ? ctx.randomUUID() : crypto.randomUUID();
  const nowMs = ctx.now ? ctx.now() : Date.now();
  try {
    await db.prepare('INSERT INTO finance_qb_oauth_state (state, expires_at) VALUES (?,?)').bind(state, new Date(nowMs + STATE_TTL_MS).toISOString()).run();
  } catch {
    // Fail closed: a state that cannot be stored is no CSRF protection.
    return refused('QuickBooks connect is temporarily unavailable (state store not writable).');
  }
  const redirectUri = new URL('/api/v1/qb/callback', url.origin).toString();
  const authorizeUrl = await getAuthorizeUrl(env, redirectUri, state, ctx.fetchImpl);
  return new Response(null, { status: 302, headers: { Location: authorizeUrl } });
}

// GET /api/v1/qb/callback ← Intuit, after consent.
export async function handleCallback(req, url, env, db, ctx) {
  if (!ctx?.isAdmin) return refused('Only admins can connect QuickBooks.');
  const code = url.searchParams.get('code');
  const realmId = url.searchParams.get('realmId');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');
  if (oauthError) return refused(`QuickBooks declined the connection (${oauthError}).`);
  if (!code || !realmId || !state) return refused('QuickBooks returned an incomplete response.');

  const stateRow = await db.prepare('SELECT state, expires_at FROM finance_qb_oauth_state WHERE state=?').bind(state).first();
  if (!stateRow) return refused('This connection attempt expired or was not started here. Try again.');
  await db.prepare('DELETE FROM finance_qb_oauth_state WHERE state=?').bind(state).run();
  const nowMs = ctx.now ? ctx.now() : Date.now();
  if (new Date(stateRow.expires_at).getTime() < nowMs) return refused('This connection attempt expired. Try again.');

  const redirectUri = new URL('/api/v1/qb/callback', url.origin).toString();
  let tokens;
  try { tokens = await exchangeCodeForTokens(env, code, redirectUri, ctx.fetchImpl); }
  catch (e) { return refused('QuickBooks did not accept the connection: ' + e.message); }

  const environment = env.FINANCE_QB_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production';
  const accessExpiresAt = new Date(nowMs + (tokens.expires_in || 3600) * 1000).toISOString();
  const refreshExpiresAt = new Date(nowMs + (tokens.x_refresh_token_expires_in || 8640000) * 1000).toISOString();

  let companyName = '';
  try {
    const client = makeQboClient(env, { realm_id: realmId, access_token: tokens.access_token, environment }, ctx.fetchImpl);
    const ciRes = await client.companyInfo();
    if (ciRes.ok) { const ci = await ciRes.json(); companyName = ci?.CompanyInfo?.CompanyName || ''; }
  } catch { /* the connection still succeeds without a display name, as in legacy */ }

  await db.prepare(
    `INSERT INTO finance_qb_connection (id, realm_id, company_name, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, environment, connected_at, last_synced_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, datetime('now'), '')
     ON CONFLICT(id) DO UPDATE SET realm_id=excluded.realm_id, company_name=excluded.company_name,
       access_token=excluded.access_token, refresh_token=excluded.refresh_token,
       access_token_expires_at=excluded.access_token_expires_at, refresh_token_expires_at=excluded.refresh_token_expires_at,
       environment=excluded.environment, connected_at=datetime('now')`
  ).bind(realmId, companyName, tokens.access_token, tokens.refresh_token, accessExpiresAt, refreshExpiresAt, environment).run();

  return back({ qb: 'connected' });
}

// POST /api/v1/qb/disconnect
export async function handleDisconnect(req, url, env, db, ctx) {
  if (!ctx?.isAdmin) return refused('Only admins can disconnect QuickBooks.');
  const conn = await getConnection(db);
  if (conn?.refresh_token) await revokeToken(env, conn.refresh_token, ctx.fetchImpl);
  await db.prepare('DELETE FROM finance_qb_connection WHERE id=1').run();
  await db.prepare('DELETE FROM finance_qb_snapshot').run();
  return back({ qb: 'disconnected' });
}

// POST /api/v1/qb/sync — legacy finance/qb/sync, step for step.
export async function syncQuickbooks(env, db, ctx) {
  const { client, error } = await freshClient(env, db, ctx);
  if (error) return { ok: false, error };
  const year = new Date(ctx.now ? ctx.now() : Date.now()).getFullYear();
  const warnings = [];
  const preferredBudgetRow = await db.prepare("SELECT value FROM finance_settings WHERE key='finance_qb_selected_budget_id'").first();
  const preferredBudgetId = preferredBudgetRow?.value || null;

  // The trusted reconstruction (Budget entity + date-scoped P&L). The native BudgetVsActuals report
  // is called only so a genuine failure still shows as a warning; its figures are never used.
  const currentYearMerge = await mergeCurrentYearBudgetAndActual(client, year, warnings, preferredBudgetId);
  const nativeBudgetVsActual = await fetchQboJson(
    'Budget vs Actual (native report)',
    client.budgetVsActual({ start_date: `${year}-01-01`, end_date: `${year}-12-31` }),
    warnings,
    `make sure a Budget for ${year} exists in QuickBooks under Settings > Budgeting`
  );
  if (nativeBudgetVsActual) warnings.push('Budget vs Actual: QuickBooks\' native report responded, but its figures are not used — the reconstructed report is used instead (the native report is unsupported by Intuit and has returned unreliable totals).');
  let budgetVsActual = null;
  if (currentYearMerge) {
    budgetVsActual = {
      Columns: { Column: [{ ColTitle: 'Account' }, { ColTitle: 'Actual' }, { ColTitle: 'Budget' }, { ColTitle: 'Over Budget By' }] },
      Rows: { Row: currentYearMerge.rows },
      _synthesized: true,
    };
  } else if (!nativeBudgetVsActual) {
    warnings.push('Budget vs Actual: could not build any Budget vs Actual data this sync — both the native report and the Budget-entity reconstruction failed.');
  }
  const accounts = await fetchQboJson('Account balances', client.accounts(), warnings);
  const profitAndLoss = await fetchQboJson(
    'Profit & Loss (multi-year)',
    client.profitAndLoss({ start_date: `${year - PNL_YEARS_BACK}-01-01`, end_date: `${year}-12-31`, summarize_column_by: 'Year' }),
    warnings
  );
  const profitAndLossMonthly = await fetchQboJson(
    'Profit & Loss (monthly, current + prior year)',
    client.profitAndLoss({ start_date: `${year - 1}-01-01`, end_date: `${year}-12-31`, summarize_column_by: 'Month' }),
    warnings
  );

  const syncedAt = new Date(ctx.now ? ctx.now() : Date.now()).toISOString();
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

  // Church Report entries. As in legacy, the multi-year pass writes PRIOR years only (the current
  // year comes from the budget-merged tree), which avoids double-counting when the two report
  // shapes name an account differently; monthly rows use period_month 1-12.
  const churchRows = [];
  if (profitAndLoss && profitAndLoss.Rows) {
    // Column 0 is the account-name column (cells[0]); the extractors index years from cells[1],
    // so they must be given the data columns only. Passing every column shifted each year onto
    // the next year's figures.
    const cols = ((profitAndLoss.Columns && profitAndLoss.Columns.Column) || []).slice(1);
    const colYears = cols.map((c) => { const m = /(\d{4})/.exec(c.ColTitle || ''); const y = m ? parseInt(m[1], 10) : null; return (y === year) ? null : y; });
    flattenReportTree(profitAndLoss.Rows.Row, [], null, makeMultiYearExtractor(colYears), churchRows);
  }
  if (currentYearMerge) flattenReportTree(currentYearMerge.rows, [], null, makeCurrentYearExtractor(year), churchRows);
  if (profitAndLossMonthly && profitAndLossMonthly.Rows) {
    // Same for monthly columns: data columns only, or each month takes the next month's figure.
    const monthCols = ((profitAndLossMonthly.Columns && profitAndLossMonthly.Columns.Column) || []).slice(1);
    const colPeriods = monthCols.map((c) => parseMonthColTitle(c.ColTitle || ''));
    flattenReportTree(profitAndLossMonthly.Rows.Row, [], null, makeMonthlyExtractor(colPeriods), churchRows);
  }
  await persistChurchEntries(db, churchRows, syncedAt);
  await db.prepare('UPDATE finance_qb_connection SET last_synced_at=? WHERE id=1').bind(syncedAt).run();
  return { ok: true, syncedAt, warnings, churchEntriesSynced: churchRows.length };
}

export async function handleSync(req, url, env, db, ctx) {
  if (!ctx?.isAdmin) return refused('Only admins can sync QuickBooks.');
  const result = await syncQuickbooks(env, db, ctx);
  if (!result.ok) return refused(result.error);
  return back({ qb: 'synced', rows: String(result.churchEntriesSynced), warnings: String(result.warnings.length) });
}

// POST /api/v1/qb/sync-years — legacy finance/qb/sync-years: actuals only, for chosen years.
export async function syncQuickbooksYears(env, db, ctx, requestedYears) {
  const thisYear = new Date(ctx.now ? ctx.now() : Date.now()).getFullYear();
  const years = [...new Set((requestedYears || []).map((y) => parseInt(y, 10)))].filter(Number.isFinite);
  if (!years.length) return { ok: false, error: 'Choose at least one year to sync.' };
  if (years.some((y) => y < 2000 || y > thisYear + 1)) return { ok: false, error: 'One of the years is not plausible.' };
  const { client, error } = await freshClient(env, db, ctx);
  if (error) return { ok: false, error };
  const warnings = [];
  const churchRows = [];
  for (const year of years.sort((a, b) => a - b)) {
    const pnl = await fetchQboJson(`Profit & Loss (${year})`, client.profitAndLoss({ start_date: `${year}-01-01`, end_date: `${year}-12-31` }), warnings);
    if (pnl && pnl.Rows) flattenReportTree(pnl.Rows.Row, [], null, makeSingleYearActualExtractor(year), churchRows);
  }
  const syncedAt = new Date(ctx.now ? ctx.now() : Date.now()).toISOString();
  await persistChurchEntries(db, churchRows, syncedAt);
  return { ok: true, syncedAt, warnings, years, churchEntriesSynced: churchRows.length };
}

export async function handleSyncYears(req, url, env, db, ctx) {
  if (!ctx?.isAdmin) return refused('Only admins can sync QuickBooks.');
  let form;
  try { form = await req.formData(); } catch { return refused('Invalid request.'); }
  const result = await syncQuickbooksYears(env, db, ctx, form.getAll('fiscal_year'));
  if (!result.ok) return refused(result.error);
  return back({ qb: 'synced', rows: String(result.churchEntriesSynced), warnings: String(result.warnings.length) });
}

// Budget list for the page (legacy GET finance/qb/budgets). Refreshes the token like any read.
export async function listQuickbooksBudgets(env, db, ctx) {
  const { client, error } = await freshClient(env, db, ctx);
  if (error) return { ok: false, error };
  const warnings = [];
  const budgetsData = await fetchQboJson('Budget entity', client.budgets(), warnings);
  const budgets = (budgetsData?.QueryResponse?.Budget || []).map((b) => ({
    id: String(b.Id), name: b.Name || '(unnamed budget)', startDate: b.StartDate || '', endDate: b.EndDate || '',
    entryType: b.BudgetEntryType || '', active: !!b.Active,
  }));
  const selectedRow = await db.prepare("SELECT value FROM finance_settings WHERE key='finance_qb_selected_budget_id'").first();
  return { ok: true, budgets, selectedBudgetId: selectedRow?.value || null, warnings };
}

// POST /api/v1/qb/budget-select — legacy PATCH finance/qb/budgets.
export async function handleBudgetSelect(req, url, env, db, ctx) {
  if (!ctx?.isAdmin) return refused('Only admins can choose the QuickBooks budget.');
  let form;
  try { form = await req.formData(); } catch { return refused('Invalid request.'); }
  const raw = String(form.get('budget_id') || '').trim();
  if (raw && !/^[A-Za-z0-9_-]{1,64}$/.test(raw)) return refused('That budget id is not valid.');
  if (!raw) await db.prepare("DELETE FROM finance_settings WHERE key='finance_qb_selected_budget_id'").run();
  else await db.prepare(
    `INSERT INTO finance_settings (key,value) VALUES ('finance_qb_selected_budget_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).bind(raw).run();
  return back({ qb: 'budget_saved' });
}
