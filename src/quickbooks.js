// QuickBooks Online API client — OAuth 2.0 + Reports/Query API.
// Mirrors the makeBreezeClient pattern in src/breeze.js: returns raw fetch Responses so
// callers keep their own .json()/error handling. Unlike Breeze (a static API key), QBO uses
// per-connection OAuth tokens obtained via user consent and refreshed over time, so those
// live in the finance_qb_connection D1 table rather than as a Worker secret — only
// QB_CLIENT_ID/QB_CLIENT_SECRET (the Intuit Developer app credentials) are env secrets.
const AUTH_URL   = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL  = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const SCOPE      = 'com.intuit.quickbooks.accounting';
const MINOR_VERSION = '65';

export function qboConfigured(env) {
  return !!(env.QB_CLIENT_ID && env.QB_CLIENT_SECRET);
}

function apiBase(environment, realmId) {
  const host = environment === 'sandbox' ? 'sandbox-quickbooks.api.intuit.com' : 'quickbooks.api.intuit.com';
  return `https://${host}/v3/company/${realmId}`;
}

function basicAuthHeader(env) {
  return 'Basic ' + btoa(`${env.QB_CLIENT_ID}:${env.QB_CLIENT_SECRET}`);
}

// Step 1 of the OAuth Authorization Code flow — send the admin's browser here.
export function getAuthorizeUrl(env, redirectUri, state) {
  const params = new URLSearchParams({
    client_id: env.QB_CLIENT_ID,
    response_type: 'code',
    scope: SCOPE,
    redirect_uri: redirectUri,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function tokenRequest(env, bodyParams) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': basicAuthHeader(env),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: bodyParams.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `QuickBooks token request failed (${res.status})`);
  return data; // { access_token, refresh_token, expires_in, x_refresh_token_expires_in, token_type }
}

// Step 2 — exchange the ?code= Intuit sent back to our callback for real tokens.
export function exchangeCodeForTokens(env, code, redirectUri) {
  return tokenRequest(env, new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }));
}

// Access tokens last ~1hr; refresh tokens last ~100 days and rotate on each use.
export function refreshTokens(env, refreshToken) {
  return tokenRequest(env, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }));
}

// Best-effort revoke on disconnect — failures are non-fatal since we delete our copy either way.
export async function revokeToken(env, token) {
  if (!token) return;
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'Authorization': basicAuthHeader(env), 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ token }),
  }).catch(() => {});
}

// Data client for a connected company. `conn` needs realm_id, access_token, environment.
// Returns null if not enough info to build a request (mirrors makeBreezeClient's null-when-
// unconfigured convention). Callers are responsible for refreshing an expired access_token
// before calling this (see ensureFreshAccessToken in api-finance.js).
export function makeQboClient(env, conn) {
  if (!conn || !conn.realm_id || !conn.access_token) return null;
  const base = apiBase(conn.environment, conn.realm_id);

  function get(path) {
    return fetch(`${base}${path}`, {
      headers: { 'Authorization': `Bearer ${conn.access_token}`, 'Accept': 'application/json' },
    });
  }

  return {
    // Used right after connecting to display the company's real name instead of just the realmId.
    companyInfo: () => get(`/companyinfo/${conn.realm_id}?minorversion=${MINOR_VERSION}`),

    // Bank/other account balances — CurrentBalance is a decimal dollar amount as QBO returns it,
    // not integer cents (unlike this app's own giving_entries convention).
    accounts: () => get(`/query?query=${encodeURIComponent(
      "SELECT Id, Name, AccountType, AccountSubType, CurrentBalance, Classification FROM Account WHERE Active = true MAXRESULTS 200"
    )}&minorversion=${MINOR_VERSION}`),

    // Standard QBO report endpoint. Requires the company to already have a Budget set up in
    // QuickBooks (Settings > Budgeting) — if none exists QBO returns an error we surface as-is
    // rather than guessing. Response is QBO's generic Columns/Rows report shape; render it
    // generically on the frontend rather than assuming fixed column semantics, since QBO's
    // exact column set for this report can vary by account/report params.
    budgetVsActual: (params) => get(`/reports/BudgetVsActual?${new URLSearchParams(params)}&minorversion=${MINOR_VERSION}`),
  };
}
