// ── Real transport for connect.finance-property-ledgers.v1 ─────────────────────────────────────
// Same shape as finance-property-valuation-client.js / finance-balance-sheet-client.js: a service-
// binding call to Connect's server-to-server contract endpoint, never throws, resolves to
// { ok: false, reason } on any failure so the caller (property-report-service.js) can fall back
// to the local synthetic fixture.
import { acceptFinancePropertyLedgersV1 } from './finance-property-ledgers-consumer.js';
import { DEFAULT_LIVE_PROPERTY_KEY } from './finance-property-valuation-client.js';

const REQUEST_TIMEOUT_MS = 4000;

export async function fetchLiveFinancePropertyLedgers(env, propertyKey = DEFAULT_LIVE_PROPERTY_KEY) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };

  const url = `https://connect.timothystl.org/api/contracts/finance-property-ledgers-v1?property_key=${encodeURIComponent(propertyKey)}`;
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
    return { ok: true, ledgers: acceptFinancePropertyLedgersV1(payload) };
  } catch (e) {
    return { ok: false, reason: 'contract_validation_failed', detail: e?.message || String(e) };
  }
}

// ── Real transport for connect.finance-property-repair-write-relay.v1 (a write) ────────────
// Relays a hand-typed repairs & maintenance log entry to Connect's own contract endpoint
// (src/api-contracts-service.js), which is the only place it is actually written -- Finance never
// stores a copy. `accessJwt` is the Cf-Access-Jwt-Assertion value from the ORIGINAL incoming
// request; Connect independently verifies that signature and checks the real Connect role (admin
// only, same as the legacy in-Connect Work orders page) -- this call carries it through, it does
// not decide who is authorized. The property key is fixed to 'ivanhoe' on Connect's own side,
// never taken from this call. Same never-throws, always-{ok,reason}-labeled shape as
// postConnectFinanceBudgetWrite in finance-budget-client.js.
const WRITE_REQUEST_TIMEOUT_MS = 4000;

export async function postConnectPropertyRepairWrite(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-property-repair-write-v1';
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

// ── Real transport for connect.finance-property-capital-ledger-write-relay.v1 (a write) ─────
// Relays a hand-typed capital-improvements ledger entry to Connect's own contract endpoint
// (src/api-contracts-service.js), which is the only place it is actually written -- Finance never
// stores a copy. `accessJwt` is the Cf-Access-Jwt-Assertion value from the ORIGINAL incoming
// request; Connect independently verifies that signature and checks the real Connect role (admin
// only, same as the legacy in-Connect Capital improvements page) -- this call carries it through,
// it does not decide who is authorized. The property key is fixed to 'ivanhoe' on Connect's own
// side, never taken from this call. Same never-throws, always-{ok,reason}-labeled shape as
// postConnectPropertyRepairWrite above.
export async function postConnectPropertyCapitalLedgerWrite(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-property-capital-ledger-write-v1';
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
