// ── Real transport for connect.finance-budget.v1 ────────────────────────────────────────────
// Same shape as finance-chart-of-accounts-client.js: a service-binding call to Connect's
// server-to-server contract endpoint, never throws, resolves to { ok: false, reason } on any
// failure so the caller (budget-report-service.js) can fall back to the local synthetic fixture.
import { acceptFinanceBudgetV1 } from './finance-budget-consumer.js';

const REQUEST_TIMEOUT_MS = 4000;

export async function fetchLiveFinanceBudget(env, fiscalYear) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };

  const url = `https://connect.timothystl.org/api/contracts/finance-budget-v1?fiscal_year=${encodeURIComponent(fiscalYear)}`;
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
    return { ok: true, budget: acceptFinanceBudgetV1(payload) };
  } catch (e) {
    return { ok: false, reason: 'contract_validation_failed', detail: e?.message || String(e) };
  }
}

// Budget is planning for a year ahead, and there is no picker on this staging page yet, so this
// needs no input from the caller -- the next calendar year, matching both the current real
// production plan (FY2027, checked 2026-09-14) and the committed synthetic fixture (also FY2027).
export function defaultLiveBudgetFiscalYear(now = new Date()) {
  return now.getUTCFullYear() + 1;
}

// ── Real transport for connect.finance-budget-write-relay.v1 (a write) ──────
// Relays a hand-typed Budget Plan edit to Connect's own contract endpoint
// (src/api-contracts-service.js), which is the only place the row is actually written --
// Finance never stores a copy. `accessJwt` is the Cf-Access-Jwt-Assertion value from the
// ORIGINAL incoming request (Cloudflare Access already attached it there); Connect independently
// verifies that signature to learn who is acting and checks their real Connect role (admin or
// council only, same as the legacy in-Connect Budget Planner) -- this call carries it through, it
// does not decide who is authorized. Same never-throws, always-{ok,reason}-labeled shape as
// postConnectGivingQuickEntry in connect-giving-client.js.
const WRITE_REQUEST_TIMEOUT_MS = 4000;

export async function postConnectFinanceBudgetWrite(env, accessJwt, rows) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-budget-write-v1';
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
      body: JSON.stringify({ rows }),
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
