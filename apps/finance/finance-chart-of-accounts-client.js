// ── Real transport for connect.finance-chart-of-accounts.v1 ─────────────────────────────────
// Same shape as finance-data-status-client.js: a service-binding call to Connect's
// server-to-server contract endpoint, never throws, resolves to { ok: false, reason } on any
// failure so the caller (accounts-report-service.js) can fall back to the local synthetic fixture.
import { acceptFinanceChartOfAccountsV1 } from './finance-chart-of-accounts-consumer.js';

const REQUEST_TIMEOUT_MS = 4000;

export async function fetchLiveFinanceChartOfAccounts(env) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-chart-of-accounts-v1';
  let res;
  try {
    res = await binding.fetch(new Request(url, {
      headers: { 'X-Contract-Key': key, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }));
  } catch (e) {
    return { ok: false, reason: 'network_error', detail: e?.message || String(e) };
  }
  if (!res.ok) return { ok: false, reason: 'http_error', status: res.status };

  let payload;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  try {
    return { ok: true, chartOfAccounts: acceptFinanceChartOfAccountsV1(payload) };
  } catch (e) {
    return { ok: false, reason: 'contract_validation_failed', detail: e?.message || String(e) };
  }
}

// ── Real transport for connect.finance-board-categories-write-relay.v1 (a write) ────────────
// Relays a hand-picked board-category assignment (or a leaf-label rename) to Connect's own
// contract endpoint (src/api-contracts-service.js), which is the only place it is actually
// written -- Finance never stores a copy. `accessJwt` is the Cf-Access-Jwt-Assertion value from
// the ORIGINAL incoming request; Connect independently verifies that signature and checks the
// real Connect role (admin only, same as the legacy in-Connect Chart of Accounts) -- this call
// carries it through, it does not decide who is authorized. `body` is MERGED into whatever is
// already saved (see applyBoardCategoryMerge's own comment in src/api-finance.js), so a caller
// only needs to send the one field it's changing. Same never-throws, always-{ok,reason}-labeled
// shape as postConnectFinanceBudgetWrite in finance-budget-client.js.
const WRITE_REQUEST_TIMEOUT_MS = 4000;

export async function postConnectBoardCategoriesWrite(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-board-categories-write-v1';
  let res;
  try {
    res = await binding.fetch(new Request(url, {
      method: 'POST',
      headers: {
        'X-Contract-Key': key,
        'Cf-Access-Jwt-Assertion': accessJwt,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(WRITE_REQUEST_TIMEOUT_MS),
    }));
  } catch (e) {
    return { ok: false, reason: 'network_error', detail: e?.message || String(e) };
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  if (!res.ok) return { ok: false, reason: 'http_error', status: res.status, message: payload?.error };
  return { ok: true, result: payload };
}
