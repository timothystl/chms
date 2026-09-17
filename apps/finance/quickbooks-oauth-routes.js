// ── QuickBooks OAuth/sync route handlers — Finance-owned design (DESIGN + DARK CODE) ───────────
//
// NOT WIRED. This module is not imported by shell.js, not listed in route-manifest.js, and not
// referenced by wrangler.finance.jsonc/wrangler.finance.staging.jsonc (no new binding or secret
// name here has been added to either config file). It exists to show, concretely, how the
// connect/callback/disconnect/sync endpoints described in apps/finance/README.md's changelog
// would be built from quickbooks-oauth-client.js + quickbooks-token-service.js +
// quickbooks-budget-merge.js, so that work does not have to be redesigned from scratch when a
// real cutover is approved. It has never been exercised against the real QuickBooks account, and
// nothing here should be registered in route-manifest.js/shell.js without:
//   1. Andrew's separate, explicit approval for this specific authentication/configuration
//      change (see AGENTS.md's access rules), and
//   2. the Intuit app-registration decision described in quickbooks-oauth-client.js's header
//      comment (reuse Connect's existing app + add a redirect URI, or register a new one), and
//   3. resolving the dual-writer refresh-token-rotation hazard also described there — Finance's
//      connection should not run at the same time as Connect's live one against the same company
//      unless they use genuinely separate Intuit app credentials.
//
// Every handler takes `(req, url, env, db, ctx)` and returns a Response, mirroring the shape
// shell.js's own route dispatch already uses for its two existing write exceptions
// (giving-quick-entry-v1, payroll-hours-save-v1 — see FINANCE_ROUTE_MANIFEST's `writer: true`
// convention in route-manifest.js). `ctx.isAdmin` is a boolean the caller must resolve through
// Finance's own real role verification (see connect-role-client.js's roleCanAccessSection) before
// calling in — exactly like legacy's `isAdmin` parameter in src/api-finance.js, which is resolved
// once per request in api-chms.js and threaded down rather than re-checked here. This module does
// not resolve identity itself.
//
// State storage: CSRF state for the OAuth handshake lives in the `finance_qb_oauth_state` D1
// table added by migrations/0008_finance_qb_connection.sql, not a KV namespace — see that
// migration's own comment for why (apps/finance has no KV binding today, and
// test/finance-alpha-shell.test.js asserts one must not exist in the alpha shell config).

import { getAuthorizeUrl, exchangeCodeForTokens, revokeToken, refreshTokens, makeQboClient, qboConfigured } from './quickbooks-oauth-client.js';
import { ensureFreshAccessToken } from './quickbooks-token-service.js';
import { mergeCurrentYearBudgetAndActual, fetchQboJson } from './quickbooks-budget-merge.js';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — same window the legacy RSVP_STORE KV entry uses

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

async function getConnection(db) {
  return await db.prepare('SELECT * FROM finance_qb_connection WHERE id=1').first();
}

// ── GET /api/v1/qb/connect (design path — not a real registered route) ─────────────────────────
export async function handleConnect(req, url, env, db, ctx) {
  if (!ctx?.isAdmin) return jsonResponse({ error: 'Access denied: connecting QuickBooks requires admin access' }, 403);
  if (!qboConfigured(env)) return jsonResponse({ error: 'QuickBooks is not configured for Finance. An admin must add FINANCE_QB_CLIENT_ID and FINANCE_QB_CLIENT_SECRET.' }, 503);

  const state = ctx.randomUUID ? ctx.randomUUID() : crypto.randomUUID();
  const nowMs = ctx.now ? ctx.now() : Date.now();
  const expiresAt = new Date(nowMs + STATE_TTL_MS).toISOString();
  try {
    await db.prepare('INSERT INTO finance_qb_oauth_state (state, expires_at) VALUES (?,?)').bind(state, expiresAt).run();
  } catch {
    // Fail CLOSED, exactly like legacy's `if (!env.RSVP_STORE)` check — a state that can't be
    // persisted is no CSRF protection at all, so refuse to start the flow rather than proceed
    // without one.
    return jsonResponse({ error: 'QuickBooks connect is temporarily unavailable (state store not writable)' }, 503);
  }

  const redirectUri = new URL('/api/v1/qb/callback', url.origin).toString();
  const authorizeUrl = await getAuthorizeUrl(env, redirectUri, state, ctx.fetchImpl);
  return new Response(null, { status: 302, headers: { Location: authorizeUrl } });
}

// ── GET /api/v1/qb/callback (design path — not a real registered route) ────────────────────────
export async function handleCallback(req, url, env, db, ctx) {
  if (!ctx?.isAdmin) return jsonResponse({ error: 'Access denied' }, 403);
  const code = url.searchParams.get('code');
  const realmId = url.searchParams.get('realmId');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');
  if (oauthError) return jsonResponse({ error: 'qb_error', reason: oauthError }, 400);
  if (!code || !realmId || !state) return jsonResponse({ error: 'qb_error', reason: 'missing_params' }, 400);

  const stateRow = await db.prepare('SELECT state, expires_at FROM finance_qb_oauth_state WHERE state=?').bind(state).first();
  if (!stateRow) return jsonResponse({ error: 'qb_error', reason: 'invalid_or_expired_state' }, 400);
  await db.prepare('DELETE FROM finance_qb_oauth_state WHERE state=?').bind(state).run();
  const nowMs = ctx.now ? ctx.now() : Date.now();
  if (new Date(stateRow.expires_at).getTime() < nowMs) return jsonResponse({ error: 'qb_error', reason: 'invalid_or_expired_state' }, 400);

  const redirectUri = new URL('/api/v1/qb/callback', url.origin).toString();
  let tokens;
  try { tokens = await exchangeCodeForTokens(env, code, redirectUri, ctx.fetchImpl); }
  catch (e) { return jsonResponse({ error: 'qb_error', reason: e.message }, 502); }

  const environment = env.FINANCE_QB_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production';
  const accessExpiresAt = new Date(nowMs + (tokens.expires_in || 3600) * 1000).toISOString();
  const refreshExpiresAt = new Date(nowMs + (tokens.x_refresh_token_expires_in || 8640000) * 1000).toISOString();

  let companyName = '';
  try {
    const client = makeQboClient(env, { realm_id: realmId, access_token: tokens.access_token, environment }, ctx.fetchImpl);
    const ciRes = await client.companyInfo();
    if (ciRes.ok) { const ci = await ciRes.json(); companyName = ci?.CompanyInfo?.CompanyName || ''; }
  } catch { /* non-fatal — connection still succeeds without a display name, same as legacy */ }

  await db.prepare(
    `INSERT INTO finance_qb_connection (id, realm_id, company_name, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, environment, connected_at, last_synced_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, datetime('now'), '')
     ON CONFLICT(id) DO UPDATE SET realm_id=excluded.realm_id, company_name=excluded.company_name,
       access_token=excluded.access_token, refresh_token=excluded.refresh_token,
       access_token_expires_at=excluded.access_token_expires_at, refresh_token_expires_at=excluded.refresh_token_expires_at,
       environment=excluded.environment, connected_at=datetime('now')`
  ).bind(realmId, companyName, tokens.access_token, tokens.refresh_token, accessExpiresAt, refreshExpiresAt, environment).run();

  return jsonResponse({ ok: true, companyName });
}

// ── POST /api/v1/qb/disconnect (design path — not a real registered route) ─────────────────────
export async function handleDisconnect(req, url, env, db, ctx) {
  if (!ctx?.isAdmin) return jsonResponse({ error: 'Access denied: disconnecting QuickBooks requires admin access' }, 403);
  const conn = await getConnection(db);
  if (conn?.refresh_token) await revokeToken(env, conn.refresh_token, ctx.fetchImpl);
  await db.prepare('DELETE FROM finance_qb_connection WHERE id=1').run();
  await db.prepare("DELETE FROM finance_qb_snapshot").run();
  return jsonResponse({ ok: true });
}

// ── POST /api/v1/qb/sync (design path — not a real registered route) ───────────────────────────
// Deliberately bounded scope compared to legacy's finance/qb/sync: this fetches and caches the
// Budget+Actual reconstruction and account balances into finance_qb_snapshot only. It does NOT
// attempt to design a Finance-owned equivalent of finance_church_entries/persistChurchEntries —
// whether Finance should become a second writer of accounting actuals (versus staying a reader of
// Connect's versioned contracts, per AGENTS.md's "Giving remains authoritative in Connect...
// Finance must eventually consume versioned summaries, not become a second writer" principle,
// which is written about Giving but raises the identical question for Church/Budget actuals) is a
// separate, larger product decision this task was not asked to make and this code does not make.
export async function handleSync(req, url, env, db, ctx) {
  if (!ctx?.isAdmin) return jsonResponse({ error: 'Access denied: syncing QuickBooks requires admin access' }, 403);
  const conn = await getConnection(db);
  if (!conn || !conn.realm_id) return jsonResponse({ error: 'QuickBooks is not connected yet.' }, 400);

  let fresh;
  try {
    fresh = await ensureFreshAccessToken(env, db, conn, { refreshTokensFn: (e, rt) => refreshTokens(e, rt, ctx.fetchImpl), now: ctx.now });
  } catch (e) {
    return jsonResponse({ error: 'QuickBooks re-authentication failed — try disconnecting and reconnecting. (' + e.message + ')' }, 502);
  }

  const client = makeQboClient(env, fresh, ctx.fetchImpl);
  const year = ctx.now ? new Date(ctx.now()).getFullYear() : new Date().getFullYear();
  const warnings = [];
  const preferredBudgetRow = await db.prepare("SELECT value FROM finance_settings WHERE key='finance_qb_selected_budget_id'").first();
  const preferredBudgetId = preferredBudgetRow?.value || null;

  const currentYearMerge = await mergeCurrentYearBudgetAndActual(client, year, warnings, preferredBudgetId);
  const accounts = await fetchQboJson('Account balances', client.accounts(), warnings);

  const syncedAt = new Date(ctx.now ? ctx.now() : Date.now()).toISOString();
  const ops = [];
  if (currentYearMerge) {
    const budgetVsActual = {
      Columns: { Column: [{ ColTitle: 'Account' }, { ColTitle: 'Actual' }, { ColTitle: 'Budget' }, { ColTitle: 'Over Budget By' }] },
      Rows: { Row: currentYearMerge.rows },
      _synthesized: true,
    };
    ops.push(db.prepare(
      `INSERT INTO finance_qb_snapshot (key,value,synced_at) VALUES ('budget_vs_actual',?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, synced_at=excluded.synced_at`
    ).bind(JSON.stringify(budgetVsActual), syncedAt));
  } else {
    warnings.push('Budget vs Actual: could not build a Budget vs Actual reconstruction this sync.');
  }
  if (accounts) {
    ops.push(db.prepare(
      `INSERT INTO finance_qb_snapshot (key,value,synced_at) VALUES ('accounts',?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, synced_at=excluded.synced_at`
    ).bind(JSON.stringify(accounts), syncedAt));
  }
  ops.push(db.prepare('UPDATE finance_qb_connection SET last_synced_at=? WHERE id=1').bind(syncedAt));
  if (ops.length) await db.batch(ops);

  return jsonResponse({ ok: true, syncedAt, warnings, fetched: { budgetVsActual: !!currentYearMerge, accounts: !!accounts } });
}
