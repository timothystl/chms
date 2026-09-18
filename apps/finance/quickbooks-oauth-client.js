// ── QuickBooks Online OAuth/Data API client — Finance-owned port (DESIGN + DARK CODE) ──────────
//
// NOT WIRED. Nothing in shell.js, route-manifest.js, or any deployed Finance route imports this
// file. It exists so the hard, error-prone parts of a real QuickBooks connection (OAuth token
// exchange/refresh, the Reports/Query API request shapes) are ported and unit-testable ahead of
// time, without ever making a live request to *.intuit.com/*.quickbooks.com or requiring real
// QB_CLIENT_ID/QB_CLIENT_SECRET credentials. See apps/finance/README.md's changelog entry and
// test/finance-quickbooks-unwired.test.js (which asserts this module is never imported by any
// wired file) for the full picture. Actually connecting this to the real QuickBooks account needs
// Andrew's separate explicit approval — see the note above `getAuthorizeUrl` about the Intuit
// app-registration question that approval would also need to resolve.
//
// This is a faithful port of src/quickbooks.js (the legacy Connect implementation that DID
// connect successfully in production once, on 2026-07-28 — see AGENTS.md), adapted only so every
// network call goes through an injectable `fetchImpl` parameter (defaulting to the real global
// `fetch`) instead of calling `fetch` directly. That is the one change from the legacy file, and
// it exists purely so tests can supply a mocked HTTP response and assert on the exact request
// this code would have sent, without a network dependency or a heavier mocking framework.
//
// Design note — env var names: this intentionally reads FINANCE_QB_CLIENT_ID/
// FINANCE_QB_CLIENT_SECRET/FINANCE_QB_ENVIRONMENT (NOT the legacy QB_CLIENT_ID/QB_CLIENT_SECRET/
// QB_ENVIRONMENT names Connect's Worker already uses), and expects a REDIRECT URI on
// finance.timothystl.org (e.g. https://finance.timothystl.org/api/v1/qb/callback — the exact path
// is whatever quickbooks-oauth-routes.js's caller mounts it at, since that module is not wired to
// any route today either). Whether the value behind FINANCE_QB_CLIENT_ID should be:
//   (a) the SAME Intuit app/client_id Connect already uses (SECRETS.md's QB_CLIENT_ID), with
//       Andrew adding finance.timothystl.org's callback URL as an additional allowed Redirect URI
//       on that existing Intuit app registration, or
//   (b) a NEW, separate Intuit app registration dedicated to Finance, with its own client_id/
//       secret,
// is an open product/security decision, not something this code resolves. (a) is less Intuit-side
// setup but means Finance and Connect would share one OAuth app registration; (b) is cleaner
// isolation but is more work in Intuit's developer dashboard. Either way it is a change only
// Andrew can make in Intuit's developer dashboard — this agent has no QuickBooks/Intuit
// credentials and has not attempted it.
//
// Design hazard worth flagging loudly: QuickBooks rotates the OAuth refresh token on every use.
// If Connect's Worker and Finance's Worker ever both held an active, independently-refreshing
// connection to the SAME QuickBooks company at the same time, whichever one refreshes second
// invalidates the refresh token the other one just stored, silently breaking that other
// connection the next time it tries to refresh. Finance's own connection (this module) should
// only ever be turned on either (1) after Connect's existing production connection is
// deliberately disconnected, or (2) using a genuinely separate Intuit app registration (option
// (b) above) so the two token lifecycles never collide. This is exactly the kind of
// authentication/configuration decision this task was told not to make unilaterally.

const SCOPE = 'com.intuit.quickbooks.accounting';
const MINOR_VERSION = '65';

const DISCOVERY_URL_PROD = 'https://developer.api.intuit.com/.well-known/openid_configuration';
const DISCOVERY_URL_SANDBOX = 'https://developer.api.intuit.com/.well-known/openid_sandbox_configuration';

// Same last-resort fallback values as src/quickbooks.js, kept in sync manually (there is no
// shared module between the legacy Worker and apps/finance today — see AGENTS.md's overhaul
// checkpoint on code normalization being unfinished work).
const FALLBACK_ENDPOINTS = Object.freeze({
  authorization_endpoint: 'https://appcenter.intuit.com/connect/oauth2',
  token_endpoint: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
  revocation_endpoint: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
});

// Deliberately NOT module-level cached across calls the way src/quickbooks.js caches per-isolate
// (`_discoveryCache`) — a fresh, explicit cache object is threaded through by the caller instead,
// so tests never share hidden state between cases and a real Worker deployment can still choose
// to keep one alive across requests by holding onto the object it gets back.
const DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;

export function qboConfigured(env) {
  return !!(env.FINANCE_QB_CLIENT_ID && env.FINANCE_QB_CLIENT_SECRET);
}

function apiBase(environment, realmId) {
  const host = environment === 'sandbox' ? 'sandbox-quickbooks.api.intuit.com' : 'quickbooks.api.intuit.com';
  return `https://${host}/v3/company/${realmId}`;
}

function basicAuthHeader(env) {
  return 'Basic ' + btoa(`${env.FINANCE_QB_CLIENT_ID}:${env.FINANCE_QB_CLIENT_SECRET}`);
}

export async function getDiscoveryEndpoints(env, fetchImpl = fetch, cache = null) {
  const environment = env.FINANCE_QB_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production';
  if (cache && cache.value && cache.value.environment === environment && (Date.now() - cache.value.fetchedAt) < DISCOVERY_TTL_MS) {
    return cache.value.endpoints;
  }
  const url = environment === 'sandbox' ? DISCOVERY_URL_SANDBOX : DISCOVERY_URL_PROD;
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`discovery document fetch failed (${res.status})`);
    const doc = await res.json();
    const endpoints = {
      authorization_endpoint: doc.authorization_endpoint || FALLBACK_ENDPOINTS.authorization_endpoint,
      token_endpoint: doc.token_endpoint || FALLBACK_ENDPOINTS.token_endpoint,
      revocation_endpoint: doc.revocation_endpoint || FALLBACK_ENDPOINTS.revocation_endpoint,
    };
    if (cache) cache.value = { endpoints, environment, fetchedAt: Date.now() };
    return endpoints;
  } catch {
    return FALLBACK_ENDPOINTS;
  }
}

// Step 1 of the OAuth Authorization Code flow — send the admin's browser here.
export async function getAuthorizeUrl(env, redirectUri, state, fetchImpl = fetch, cache = null) {
  const { authorization_endpoint } = await getDiscoveryEndpoints(env, fetchImpl, cache);
  const params = new URLSearchParams({
    client_id: env.FINANCE_QB_CLIENT_ID,
    response_type: 'code',
    scope: SCOPE,
    redirect_uri: redirectUri,
    state,
  });
  return `${authorization_endpoint}?${params.toString()}`;
}

async function tokenRequest(env, bodyParams, fetchImpl, cache) {
  const { token_endpoint } = await getDiscoveryEndpoints(env, fetchImpl, cache);
  const res = await fetchImpl(token_endpoint, {
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
export function exchangeCodeForTokens(env, code, redirectUri, fetchImpl = fetch, cache = null) {
  return tokenRequest(env, new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }), fetchImpl, cache);
}

// Access tokens last ~1hr; refresh tokens last ~100 days and rotate on each use (see the
// dual-writer collision warning at the top of this file).
export function refreshTokens(env, refreshToken, fetchImpl = fetch, cache = null) {
  return tokenRequest(env, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }), fetchImpl, cache);
}

// Best-effort revoke on disconnect — failures are non-fatal since the caller deletes its own
// stored copy either way.
export async function revokeToken(env, token, fetchImpl = fetch, cache = null) {
  if (!token) return;
  const { revocation_endpoint } = await getDiscoveryEndpoints(env, fetchImpl, cache);
  await fetchImpl(revocation_endpoint, {
    method: 'POST',
    headers: { 'Authorization': basicAuthHeader(env), 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ token }),
  }).catch(() => {});
}

// Data client for a connected company. `conn` needs realm_id, access_token, environment. Returns
// null if not enough info to build a request. Callers are responsible for refreshing an expired
// access_token first — see quickbooks-token-service.js's ensureFreshAccessToken.
export function makeQboClient(env, conn, fetchImpl = fetch) {
  if (!conn || !conn.realm_id || !conn.access_token) return null;
  const base = apiBase(conn.environment, conn.realm_id);

  function get(path) {
    return fetchImpl(`${base}${path}`, {
      headers: { 'Authorization': `Bearer ${conn.access_token}`, 'Accept': 'application/json' },
    });
  }

  return {
    companyInfo: () => get(`/companyinfo/${conn.realm_id}?minorversion=${MINOR_VERSION}`),
    accounts: () => get(`/query?query=${encodeURIComponent(
      "SELECT Id, Name, AccountType, AccountSubType, CurrentBalance, Classification FROM Account WHERE Active = true MAXRESULTS 200"
    )}&minorversion=${MINOR_VERSION}`),
    // See src/quickbooks.js's own comment history (and AGENTS.md's FIN2 note) on why this is
    // "BudgetVsActuals" (plural) — Intuit's real canned report name — and why its own numbers are
    // never trusted even when the call itself succeeds; kept here only so a genuine failure is
    // still observable in a sync's warnings, exactly like the legacy sync does.
    budgetVsActual: (params) => get(`/reports/BudgetVsActuals?${new URLSearchParams(params)}&minorversion=${MINOR_VERSION}`),
    budgets: () => get(`/query?query=${encodeURIComponent('SELECT * FROM Budget')}&minorversion=${MINOR_VERSION}`),
    profitAndLoss: (params) => get(`/reports/ProfitAndLoss?${new URLSearchParams(params)}&minorversion=${MINOR_VERSION}`),
    transactionList: (params) => get(`/reports/TransactionList?${new URLSearchParams(params)}&minorversion=${MINOR_VERSION}`),
  };
}
