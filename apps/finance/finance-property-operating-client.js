// ── Real transport for connect.finance-property-operating.v1 ───────────────────────────────────
// Same shape as finance-property-valuation-client.js / finance-balance-sheet-client.js: a service-
// binding call to Connect's server-to-server contract endpoint, never throws, resolves to
// { ok: false, reason } on any failure so the caller (property-report-service.js) can fall back
// to the local synthetic fixture.
import { acceptFinancePropertyOperatingV1 } from './finance-property-operating-consumer.js';
import { DEFAULT_LIVE_PROPERTY_KEY } from './finance-property-valuation-client.js';

const REQUEST_TIMEOUT_MS = 4000;

export async function fetchLiveFinancePropertyOperating(env, propertyKey = DEFAULT_LIVE_PROPERTY_KEY) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };

  const url = `https://connect.timothystl.org/api/contracts/finance-property-operating-v1?property_key=${encodeURIComponent(propertyKey)}`;
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
    return { ok: true, operating: acceptFinancePropertyOperatingV1(payload) };
  } catch (e) {
    return { ok: false, reason: 'contract_validation_failed', detail: e?.message || String(e) };
  }
}

// ── Real transport for connect.finance-property-monthly-write-relay.v1 (a write) ───────────
// Relays a hand-typed monthly financials row (revenue/expenses/NOI/reserve balance/loan payment
// for one property/period) to Connect's own contract endpoint (src/api-contracts-service.js),
// which is the only place the row is actually written -- Finance never stores a copy. `accessJwt`
// is the Cf-Access-Jwt-Assertion value from the ORIGINAL incoming request; Connect independently
// verifies that signature and checks the real Connect role (admin only, same as the legacy
// in-Connect Property Operating Results) -- this call carries it through, it does not decide who
// is authorized. The property key is fixed to 'ivanhoe' on Connect's own side (only property that
// exists today), never taken from this call. Same never-throws, always-{ok,reason}-labeled shape
// as postConnectFinanceBudgetWrite in finance-budget-client.js.
const WRITE_REQUEST_TIMEOUT_MS = 4000;

export async function postConnectPropertyMonthlyWrite(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-property-monthly-write-v1';
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

// ── Real transport for connect.finance-property-monthly-remove-relay.v1 (a write) ──────────
// Relays a request to remove one property/period's monthly financials row to Connect's own
// contract endpoint (src/api-contracts-service.js), which is the only place the row is actually
// removed -- Finance never stores a copy. Same never-throws, always-{ok,reason}-labeled shape, and
// same admin-only/'ivanhoe'-hardcoded-on-Connect's-side reasoning, as postConnectPropertyMonthlyWrite
// above. Removing a period that was never recorded is a silent no-op, matching the legacy
// in-Connect Property Operating Results' own DELETE route exactly.
export async function postConnectPropertyMonthlyRemove(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-property-monthly-remove-v1';
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

// ── Real transport for connect.finance-property-monthly-import-csv-write-relay.v1 (a write) ──
// Relays a pasted-in AHRA monthly-financials CSV (a plain string field, not a file upload -- see
// importPropertyMonthlyCsv's own header comment in src/api-finance.js) to Connect's own contract
// endpoint, which is the only place the rows are actually written -- Finance never stores a copy.
// Same never-throws, always-{ok,reason}-labeled shape as postConnectPropertyMonthlyWrite above.
export async function postConnectPropertyMonthlyImportCsvWrite(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-property-monthly-import-csv-v1';
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
