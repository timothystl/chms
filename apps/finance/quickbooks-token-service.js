// ── QuickBooks token refresh — Finance-owned port of ensureFreshAccessToken (DESIGN + DARK CODE) ─
//
// NOT WIRED. See quickbooks-oauth-client.js's header comment for the full "why a port, why dark"
// context; this file is the same situation, writing against the `finance_qb_connection` table
// added by migrations/0008_finance_qb_connection.sql. This is a faithful port of the `ensureFreshAccessToken`
// function in src/api-finance.js — the one piece of legacy code AGENTS.md confirms has never run
// again since the connection was made on 2026-07-28 (`last_synced_at` never moved past 21 seconds
// post-connect). Porting it now, before it is ever exercised a second time even in legacy, is
// deliberate: it is small, security-sensitive, and easy to get subtly wrong (wrong expiry math,
// forgetting the refresh token rotates, a persistence race), so it gets its own focused tests here
// against mocked HTTP responses rather than being reinvented later under time pressure during an
// actual cutover.
//
// Every I/O boundary is an explicit parameter:
//   - `refreshTokensFn(env, refreshToken)` performs the actual HTTP call (see
//     quickbooks-oauth-client.js's `refreshTokens`, itself built on an injectable `fetchImpl` —
//     tests here inject a stub, not a live network call).
//   - `db` is a D1-shaped object (`.prepare(sql).bind(...args).run()`), exactly like the one
//     Cloudflare Workers hand a route at request time — tests pass an in-memory fake.
//   - `now()` returns the current epoch millis, defaulting to `Date.now`, so expiry-boundary tests
//     don't depend on wall-clock time.
// Nothing here ever imports or calls the real global `fetch` directly.

const REFRESH_SKEW_MS = 2 * 60 * 1000; // same 2-minute-early refresh window as the legacy function

// Returns `conn` unchanged if the current access token still has more than REFRESH_SKEW_MS left;
// otherwise refreshes via `refreshTokensFn`, persists the rotated tokens to `db`, and returns the
// updated connection row. Throws whatever `refreshTokensFn` throws (a failed refresh means the
// connection needs to be redone — the caller is expected to surface that as a
// "reconnect QuickBooks" error, exactly like every legacy route that calls
// ensureFreshAccessToken already does).
export async function ensureFreshAccessToken(env, db, conn, { refreshTokensFn, now = () => Date.now() } = {}) {
  if (typeof refreshTokensFn !== 'function') {
    throw new TypeError('ensureFreshAccessToken requires an explicit refreshTokensFn (see quickbooks-oauth-client.js\'s refreshTokens) — there is no default network-calling implementation here on purpose.');
  }
  const expiresAtMs = conn.access_token_expires_at ? new Date(conn.access_token_expires_at).getTime() : 0;
  const nowMs = now();
  if (expiresAtMs - nowMs > REFRESH_SKEW_MS) return conn;

  const refreshed = await refreshTokensFn(env, conn.refresh_token);
  const accessExpiresAt = new Date(nowMs + (refreshed.expires_in || 3600) * 1000).toISOString();
  const refreshExpiresAt = new Date(nowMs + (refreshed.x_refresh_token_expires_in || 8640000) * 1000).toISOString();

  await db.prepare(
    `UPDATE finance_qb_connection SET access_token=?, refresh_token=?, access_token_expires_at=?, refresh_token_expires_at=? WHERE id=1`
  ).bind(refreshed.access_token, refreshed.refresh_token, accessExpiresAt, refreshExpiresAt).run();

  return {
    ...conn,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token,
    access_token_expires_at: accessExpiresAt,
    refresh_token_expires_at: refreshExpiresAt,
  };
}
