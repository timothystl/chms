// ── Real transport for connect.finance-compensation.v1 ──────────────────────────────────────
// Same shape as finance-balance-sheet-client.js / finance-daycare-client.js: a service-binding
// call to Connect's server-to-server contract endpoint, never throws, resolves to
// { ok: false, reason } on any failure so the caller (compensation-report-service.js) can fall
// back to the local synthetic fixture.
//
// No fiscal_year query param -- the salary planner is not fiscal-year-scoped (it is a standing
// roster of current staff, not a per-year plan; see api-finance.js's own comment on
// SALARY_PLANNER_KEY), so unlike Budget/Church Report/Balance Sheet/Daycare Report this contract
// takes no parameters at all.
import { acceptFinanceCompensationV1 } from './finance-compensation-consumer.js';

const REQUEST_TIMEOUT_MS = 4000;

export async function fetchLiveFinanceCompensation(env) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-compensation-v1';
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
    return { ok: true, compensation: acceptFinanceCompensationV1(payload) };
  } catch (e) {
    return { ok: false, reason: 'contract_validation_failed', detail: e?.message || String(e) };
  }
}

// ── Real transport for connect.finance-compensation-write-relay.v1 (a write) ────────────────
// Relays a Salary Planner save to Connect's own contract endpoint (src/api-contracts-service.js),
// which is the only place the plan is actually stored -- Finance never keeps a copy. `accessJwt`
// is the Cf-Access-Jwt-Assertion value from the ORIGINAL incoming request; Connect independently
// verifies that signature and checks the real Connect role (admin, compensation, or council only,
// same gate as the legacy in-Connect Salary Planner) -- this call carries it through, it does not
// decide who is authorized.
//
// `body` must be the COMPLETE planner state (the same whole-object shape the legacy PUT
// finance/planning/salary route accepts), not a partial edit -- admin/compensation saves REPLACE
// the entire stored plan wholesale (see applySalaryPlannerWrite in api-finance.js), so a caller
// that only fills in one field would silently wipe out every other worker/setting already saved.
// Council is the one exception: only COUNCIL_EDITABLE_FIELDS survive server-side regardless of
// what else this body carries.
//
// Never throws. Every failure mode -- the binding/key not configured, no Access identity on the
// incoming request, a network error, a non-200 response, or malformed JSON -- resolves to
// { ok: false, reason }. Only a genuinely accepted save resolves to { ok: true, result }.
export async function postConnectFinanceCompensationWrite(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-compensation-write-v1';
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

// ── Real transport for connect.finance-compensation-plan-relay.v1 (the raw, editable state) ──
// Fetches the SAME raw plan shape postConnectFinanceCompensationWrite expects back on save --
// not the normalized connect.finance-compensation.v1 reporting contract (fetchLiveFinanceCompensation
// above), which has a different, display-oriented per-worker shape and cannot be resubmitted as a
// save. The editor calls this first, applies one change, and resubmits the COMPLETE result --
// fetch-edit-resubmit, exactly like every other manual-edit form in this app, just against a
// whole-object save instead of a single row.
//
// Never throws. Every failure mode -- the binding/key not configured, no Access identity on the
// incoming request, a network error, a non-200 response (including a real "not authorized for
// this role" refusal), or malformed JSON -- resolves to { ok: false, reason }. Only a genuinely
// accepted read resolves to { ok: true, data } (`data` is null when nothing has been saved yet,
// matching the legacy route's own "no plan yet" shape).
export async function fetchConnectSalaryPlannerState(env, accessJwt) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-compensation-plan-v1';
  let res;
  try {
    res = await binding.fetch(new Request(url, {
      headers: { 'X-Contract-Key': key, 'Cf-Access-Jwt-Assertion': accessJwt, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
  return { ok: true, data: payload?.data ?? null };
}
