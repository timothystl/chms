-- Finance-owned QuickBooks Online OAuth connection + sync cache — DESIGN/DARK CODE, NOT LIVE.
--
-- This migration adds Finance's OWN copy of the OAuth/token-storage schema that legacy Connect's
-- src/api-finance.js already runs in production against the shared chms D1 (finance_qb_connection,
-- finance_qb_snapshot — see migrations/0016_finance.sql at the repository root). These are
-- separate tables in Finance's OWN isolated D1 (FINANCE_DB / timothy-finance-db-staging /
-- timothy-finance-db-production), never the shared Connect database, and are not read or written
-- by any wired route today — see quickbooks-oauth-client.js, quickbooks-token-service.js,
-- quickbooks-budget-merge.js and quickbooks-oauth-routes.js (all new in this same change, all
-- unimported by shell.js/route-manifest.js) and apps/finance/README.md's changelog entry for the
-- full picture.
--
-- Historical note: this exact table was deliberately left out of every apps/finance migration
-- through 0007 — see the negative assertions in test/finance-d1-foundation.test.js pinned to
-- migration 0001 ("does not recreate shared or retired credential stores" / must not match
-- access_token|refresh_token|realm_id) — precisely because standing up credential storage for a
-- second, independent QuickBooks connection is an authentication/configuration decision, not a
-- schema convenience. Adding it here is the follow-up design work for that decision. It does not
-- by itself connect anything, spend an Intuit API call, or become reachable from any deployed
-- route. Actually connecting Finance to the real QuickBooks account additionally requires
-- Andrew's separate explicit approval and, most likely, a change on the Intuit app-registration
-- side (a redirect URI for https://finance.timothystl.org/... alongside or instead of the legacy
-- Worker's /admin/api/finance/qb/callback) that only Andrew can make in the Intuit developer
-- dashboard — see quickbooks-oauth-client.js's header comment for the two ways that could go.

-- Singleton row (id=1), field-for-field the same shape as the legacy finance_qb_connection table
-- in migrations/0016_finance.sql, so a future token migration from the legacy connection (should
-- Finance ever become the authoritative writer) is a straight column copy rather than a reshape.
CREATE TABLE IF NOT EXISTS finance_qb_connection (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  realm_id                 TEXT    NOT NULL DEFAULT '',
  company_name             TEXT    NOT NULL DEFAULT '',
  access_token             TEXT    NOT NULL DEFAULT '',
  refresh_token            TEXT    NOT NULL DEFAULT '',
  access_token_expires_at  TEXT    NOT NULL DEFAULT '',
  refresh_token_expires_at TEXT    NOT NULL DEFAULT '',
  environment              TEXT    NOT NULL DEFAULT 'production',
  connected_at             TEXT    NOT NULL DEFAULT '',
  last_synced_at           TEXT    NOT NULL DEFAULT ''
);

-- Same cached-report-blob shape as legacy's finance_qb_snapshot — raw QuickBooks report JSON
-- (the Budget vs Actual reconstruction, account balances) keyed by a short label, refreshed
-- wholesale on each sync rather than diffed.
CREATE TABLE IF NOT EXISTS finance_qb_snapshot (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  synced_at  TEXT NOT NULL DEFAULT ''
);

-- Legacy Connect stores OAuth CSRF state in the RSVP_STORE KV namespace (see api-finance.js's
-- finance/qb/connect handler) and fails closed when that binding is missing. apps/finance's own
-- wrangler config has no KV namespace bound today (see wrangler.finance.staging.jsonc and
-- test/finance-alpha-shell.test.js's assertion that kv_namespaces must not exist in the alpha
-- shell) — adding one is itself a deploy-affecting Worker configuration change, so this design
-- uses a short-lived D1 table instead of introducing a new binding for a feature that is not
-- wired to anything yet. A real implementation must still fail closed exactly like the legacy KV
-- check does when this table can't be written, and must delete a state row the moment it is
-- consumed (or reject a replay outright) — see quickbooks-oauth-routes.js's handleConnect/
-- handleCallback.
CREATE TABLE IF NOT EXISTS finance_qb_oauth_state (
  state       TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);
