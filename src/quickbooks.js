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

    // The Reports API's "TransactionList" report -- a flat, one-row-per-transaction report
    // (unlike the account-tree Columns/Rows shape of budgetVsActual/profitAndLoss above), built
    // for exactly the plain "what is this, what account, how much, when" read Andrew asked for.
    // Deliberately no explicit `columns` param: leaving it off returns QBO's own default column
    // set (Date/Transaction Type/Num/Name/Memo/Account/Amount), for the same "don't hardcode a
    // column list that might not match live behavior" reason budgetVsActual's comment above
    // gives -- see parseQboTransactionListReport in api-finance.js, which reads columns back out
    // by metadata rather than position. Caller-supplied start_date/end_date are required (no
    // default window baked in here -- see finance/qb/transactions in api-finance.js for the one
    // this app applies before calling in).
    transactionList: (params) => get(`/reports/TransactionList?${new URLSearchParams(params)}&minorversion=${MINOR_VERSION}`),
  };
}

// -- Deep link back into QuickBooks Online's own UI --------------------------------------------
// Satisfies "a way to go from Finance back to QuickBooks to make changes" without building any
// write-back API of our own: https://qbo.intuit.com/app/<slug>?txnId=<id> opens that exact
// transaction in QBO's own edit screen, in whatever QBO company session is already active in the
// admin's browser. Deliberately no realmId in the URL -- these are undocumented Intuit SPA
// routes, not part of the public REST API, and nothing found while building this confirmed a
// company-id query param is honored there, so nothing is asserted here that wasn't confirmed;
// finance_qb_connection.realm_id is still returned by finance/qb/transactions in api-finance.js
// in case a caller ever needs it for something added later.
// The slug is keyed off the *display* label QuickBooks' own reports use for a transaction's type
// (e.g. "Bill", "Check", "Journal Entry") -- exactly what the TransactionList report's
// Transaction Type column returns -- not the raw API entity name, since a report row is what
// this feature actually has to work from.
// IMPORTANT -- not yet verified against a live QuickBooks company as of this writing (see the PR
// that added this and finance/qb/transactions' route comment): this repo already hit exactly
// this kind of gap once, with BudgetVsActuals' real report name turning out to differ from what
// every public write-up assumed (see AGENTS.md / FIN2). Spot-check at least one real transaction
// of each type actually in use here before fully trusting every slug below; an unmapped or wrong
// type simply gets no link (see buildQboTransactionUrl's null return) rather than a broken one.
const QBO_TXN_URL_SLUGS = {
  'invoice': 'invoice',
  'estimate': 'estimate',
  'sales receipt': 'salesreceipt',
  'refund receipt': 'refundreceipt',
  'credit memo': 'creditmemo',
  'payment': 'recvpayment',
  'bill': 'bill',
  'expense': 'expense',
  'check': 'check',
  'credit card credit': 'creditcardcredit',
  'vendor credit': 'vendorcredit',
  'purchase order': 'purchaseorder',
  'bill payment': 'billpaymentcheck',
  'bill payment (check)': 'billpaymentcheck',
  'bill payment (credit card)': 'billpaymentcreditcard',
  'journal entry': 'journal',
  'deposit': 'deposit',
  'transfer': 'transfer',
};

export function buildQboTransactionUrl(txnType, txnId) {
  if (txnId == null || txnId === '') return null;
  if (!txnType) return null;
  const slug = QBO_TXN_URL_SLUGS[String(txnType).trim().toLowerCase()];
  if (!slug) return null;
  return `https://qbo.intuit.com/app/${slug}?txnId=${encodeURIComponent(String(txnId))}`;
}
