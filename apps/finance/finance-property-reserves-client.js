// ── Real transport for connect.finance-property-reserves.v1 ────────────────────────────────────
// Same shape as finance-property-valuation-client.js / finance-balance-sheet-client.js: a service-
// binding call to Connect's server-to-server contract endpoint, never throws, resolves to
// { ok: false, reason } on any failure so the caller (property-report-service.js) can fall back
// to the local synthetic fixture.
import { acceptFinancePropertyReservesV1 } from './finance-property-reserves-consumer.js';
import { DEFAULT_LIVE_PROPERTY_KEY } from './finance-property-valuation-client.js';

const REQUEST_TIMEOUT_MS = 4000;

export async function fetchLiveFinancePropertyReserves(env, propertyKey = DEFAULT_LIVE_PROPERTY_KEY) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };

  const url = `https://connect.timothystl.org/api/contracts/finance-property-reserves-v1?property_key=${encodeURIComponent(propertyKey)}`;
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
    return { ok: true, reserves: acceptFinancePropertyReservesV1(payload) };
  } catch (e) {
    return { ok: false, reason: 'contract_validation_failed', detail: e?.message || String(e) };
  }
}

// ── Real transport for connect.finance-property-distribution-write-relay.v1 (a write) ──────
// Relays a hand-typed period/amount distribution row to Connect's own contract endpoint
// (src/api-contracts-service.js), which is the only place it is actually written -- Finance never
// stores a copy. `accessJwt` is the Cf-Access-Jwt-Assertion value from the ORIGINAL incoming
// request; Connect independently verifies that signature and checks the real Connect role (admin
// only, same as the legacy in-Connect Distributions page) -- this call carries it through, it does
// not decide who is authorized. The property key is fixed to 'ivanhoe' on Connect's own side,
// never taken from this call. Same never-throws, always-{ok,reason}-labeled shape as
// postConnectFinanceBudgetWrite in finance-budget-client.js.
const WRITE_REQUEST_TIMEOUT_MS = 4000;

export async function postConnectPropertyDistributionWrite(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-property-distribution-write-v1';
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

// ── Real transport for connect.finance-property-reserve-monthly-write-relay.v1 (a write) ───
// Relays a hand-typed named-reserve monthly schedule row (report month, target estimate,
// contribution, optional explicit reserve-before override, tax year, note) to Connect's own
// contract endpoint (src/api-contracts-service.js), which is the only place it is actually
// written -- Finance never stores a copy. Same accessJwt pass-through and 'ivanhoe'-only property
// key as postConnectPropertyDistributionWrite above; the reserve key is carried in `body` since
// there is no URL path segment on a contract relay, and Connect's own handler re-validates it.
export async function postConnectPropertyReserveMonthlyWrite(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-property-reserve-monthly-write-v1';
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

// ── Real transport for connect.finance-property-reserve-disbursement-write-relay.v1 (a write) ──
// Relays a hand-typed named-reserve disbursement log row (period key, amount, paid-via report
// month, note) to Connect's own contract endpoint (src/api-contracts-service.js), which is the
// only place it is actually written -- Finance never stores a copy. Same accessJwt pass-through,
// 'ivanhoe'-only property key, and body-carried reserve key as
// postConnectPropertyReserveMonthlyWrite above.
export async function postConnectPropertyReserveDisbursementWrite(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-property-reserve-disbursement-write-v1';
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
