// QuickBooks Online API client — OAuth 2.0 + Reports/Query API.
// Mirrors the makeBreezeClient pattern in src/breeze.js: returns raw fetch Responses so
// callers keep their own .json()/error handling. Unlike Breeze (a static API key), QBO uses
// per-connection OAuth tokens obtained via user consent and refreshed over time, so those
// live in the finance_qb_connection D1 table rather than as a Worker secret — only
// QB_CLIENT_ID/QB_CLIENT_SECRET (the Intuit Developer app credentials) are env secrets.
const SCOPE = 'com.intuit.quickbooks.accounting';
const MINOR_VERSION = '65';

// OAuth/OpenID endpoints are resolved from Intuit's own discovery documents rather than
// hardcoded, per Intuit's recommendation — this keeps the app correct automatically if Intuit
// ever rotates these URLs. See https://developer.intuit.com/.../oauth-2.0/discovery-documents.
const DISCOVERY_URL_PROD    = 'https://developer.api.intuit.com/.well-known/openid_configuration';
const DISCOVERY_URL_SANDBOX = 'https://developer.api.intuit.com/.well-known/openid_sandbox_configuration';

// Only used if the discovery document fetch itself fails (network hiccup) — these are the
// same values Intuit's discovery document currently returns, kept as a last-resort fallback
// so a transient outage on Intuit's discovery endpoint doesn't take down the whole OAuth flow.
const FALLBACK_ENDPOINTS = {
  authorization_endpoint: 'https://appcenter.intuit.com/connect/oauth2',
  token_endpoint: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
  revocation_endpoint: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
};

// Cached per-Worker-isolate (reset on cold start) — the discovery document is effectively
// static, so there's no need to refetch it on every OAuth call.
let _discoveryCache = null; // { endpoints, environment, fetchedAt }
const DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;

async function getDiscoveryEndpoints(env) {
  const environment = env.QB_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production';
  if (_discoveryCache && _discoveryCache.environment === environment && (Date.now() - _discoveryCache.fetchedAt) < DISCOVERY_TTL_MS) {
    return _discoveryCache.endpoints;
  }
  const url = environment === 'sandbox' ? DISCOVERY_URL_SANDBOX : DISCOVERY_URL_PROD;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`discovery document fetch failed (${res.status})`);
    const doc = await res.json();
    const endpoints = {
      authorization_endpoint: doc.authorization_endpoint || FALLBACK_ENDPOINTS.authorization_endpoint,
      token_endpoint: doc.token_endpoint || FALLBACK_ENDPOINTS.token_endpoint,
      revocation_endpoint: doc.revocation_endpoint || FALLBACK_ENDPOINTS.revocation_endpoint,
    };
    _discoveryCache = { endpoints, environment, fetchedAt: Date.now() };
    return endpoints;
  } catch {
    return FALLBACK_ENDPOINTS;
  }
}

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
export async function getAuthorizeUrl(env, redirectUri, state) {
  const { authorization_endpoint } = await getDiscoveryEndpoints(env);
  const params = new URLSearchParams({
    client_id: env.QB_CLIENT_ID,
    response_type: 'code',
    scope: SCOPE,
    redirect_uri: redirectUri,
    state,
  });
  return `${authorization_endpoint}?${params.toString()}`;
}

async function tokenRequest(env, bodyParams) {
  const { token_endpoint } = await getDiscoveryEndpoints(env);
  const res = await fetch(token_endpoint, {
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
  const { revocation_endpoint } = await getDiscoveryEndpoints(env);
  await fetch(revocation_endpoint, {
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
    // NOTE (2026-07-28): this was "BudgetVsActual" (singular) for the entire time this app had
    // a persistent 5020 Permission Denied on this call (see FIN2) — QuickBooks' real canned
    // report name is "BudgetVsActuals" (plural), confirmed by the user against a live community
    // report of the same undocumented endpoint. A misnamed report is a very plausible explanation
    // for a misleading "Permission Denied" instead of a clean 404 — worth re-testing against a
    // live sync before assuming the report is still broken.
    budgetVsActual: (params) => get(`/reports/BudgetVsActuals?${new URLSearchParams(params)}&minorversion=${MINOR_VERSION}`),

    // Fallback data sources for when budgetVsActual itself is blocked (hit a persistent 5020
    // Permission Denied on the report endpoint during live testing even with a verified Budget
    // and Company Admin access — see FIN2/api-finance.js buildBudgetVsActualFallback). Entity
    // Query API calls and the standard ProfitAndLoss report sometimes have different permission
    // enforcement than the BudgetVsActual report specifically, so these may succeed where it fails.
    budgets: () => get(`/query?query=${encodeURIComponent('SELECT * FROM Budget')}&minorversion=${MINOR_VERSION}`),

    // Standard Profit & Loss report — also used with summarize_column_by=Year and a multi-year
    // date range so QBO returns one column per calendar year in a single call, for the
    // board-level "Church Report" year-over-year view (see finance/qb/sync). Same generic
    // Columns/Rows shape as budgetVsActual; no Budget setup required (P&L is actuals-only).
    profitAndLoss: (params) => get(`/reports/ProfitAndLoss?${new URLSearchParams(params)}&minorversion=${MINOR_VERSION}`),
  };
}
