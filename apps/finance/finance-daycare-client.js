// ── Real transport for connect.finance-daycare-report.v1 ────────────────────────────────────
// Same shape as finance-church-report-client.js / finance-balance-sheet-client.js: a service-binding
// call to Connect's server-to-server contract endpoint, never throws, resolves to
// { ok: false, reason } on any failure so the caller (daycare-report-service.js) can fall back to
// the local synthetic fixture.
import { acceptFinanceDaycareReportV1 } from './finance-daycare-consumer.js';

const REQUEST_TIMEOUT_MS = 4000;

export async function fetchLiveFinanceDaycareReport(env, fiscalYear) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };

  const url = `https://connect.timothystl.org/api/contracts/finance-daycare-report-v1?fiscal_year=${encodeURIComponent(fiscalYear)}`;
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
    return { ok: true, report: acceptFinanceDaycareReportV1(payload) };
  } catch (e) {
    return { ok: false, reason: 'contract_validation_failed', detail: e?.message || String(e) };
  }
}

// The Daycare Report's fiscal year is a calendar year, exactly like Church Report's own "This
// Year" default (finance_daycare_entries.period is always a bare 4-digit year for the two counted
// sources -- see src/api-contracts.js's module comment) -- matching production's own default.
export function defaultLiveDaycareReportFiscalYear(now = new Date()) {
  return now.getUTCFullYear();
}

// ── Real transport for connect.finance-daycare-entry-relay.v1 (a write) ─────────────────────
// Relays a hand-typed daycare entry to Connect's own contract endpoint
// (src/api-contracts-service.js), which is the only place the row is actually written -- Finance
// never stores a copy. `accessJwt` is the Cf-Access-Jwt-Assertion value from the ORIGINAL
// incoming request; Connect independently verifies that signature and checks the real Connect
// permissions (edit on finance, budget, or compensation -- same as the legacy in-Connect Daycare
// Report) -- this call carries it through, it does not decide who is authorized. Same
// never-throws, always-{ok,reason}-labeled shape as postConnectGivingQuickEntry in
// connect-giving-client.js.
const WRITE_REQUEST_TIMEOUT_MS = 4000;

export async function postConnectFinanceDaycareEntry(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-daycare-entry-v1';
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

// ── Real transport for connect.finance-daycare-allocation-config-write-relay.v1 (a write) ───
// Relays a hand-edited { utilityPct, insurancePct } cost-share config to Connect's own contract
// endpoint (src/api-contracts-service.js), which is the only place it is actually written --
// Finance never stores a copy. `accessJwt` is the Cf-Access-Jwt-Assertion value from the ORIGINAL
// incoming request; Connect independently verifies that signature and checks the real Connect
// role (admin only, same as the legacy in-Connect Daycare Report's shared-costs config) -- this
// call carries it through, it does not decide who is authorized. Same never-throws,
// always-{ok,reason}-labeled shape as postConnectFinanceDaycareEntry above.
export async function postConnectDaycareAllocationConfigWrite(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-daycare-allocation-config-write-v1';
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

// ── Real transport for connect.finance-daycare-budget-override-write-relay.v1 (a write) ─────
// Relays a hand-typed per-(year,category) Budget-cell override to Connect's own contract endpoint
// (src/api-contracts-service.js), which is the only place it is actually written -- Finance never
// stores a copy. Same accessJwt pass-through and admin-only role check on Connect's side as
// postConnectDaycareAllocationConfigWrite above.
export async function postConnectDaycareBudgetOverrideWrite(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-daycare-budget-override-write-v1';
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

// ── Real transport for connect.finance-daycare-bulk-write-relay.v1 (a write) ────────────────
// Relays a pasted-in array of { period, category, amount_cents, entry_type, notes } rows to
// Connect's own contract endpoint (src/api-contracts-service.js), which is the only place they
// are actually written -- Finance never stores a copy. `accessJwt` is forwarded the same way as
// postConnectFinanceDaycareEntry above; Connect's own permission check (edit on any of
// finance/budget/compensation, not a simple role-name check) is what actually decides whether the
// write is allowed.
export async function postConnectDaycareBulkWrite(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-daycare-bulk-write-v1';
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

// ── Real transport for connect.finance-daycare-church-budget-import-write-relay.v1 (a write) ──
// Relays a { year } re-derivation request to Connect's own contract endpoint
// (src/api-contracts-service.js), which re-extracts MDO-tagged accounts from that year's already-
// imported Church Budget and wholesale-replaces this year's church_budget_import rows -- the only
// place this is actually done; Finance never stores a copy. Same accessJwt pass-through and
// looser blanket-permission check on Connect's side as postConnectDaycareBulkWrite above.
export async function postConnectDaycareChurchBudgetImportWrite(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-daycare-church-budget-import-write-v1';
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

// ── Real transport for connect.finance-daycare-entry-edit-relay.v1 (a write) ────────────────
// Relays a partial-update edit for one existing daycare entry (by id) to Connect's own contract
// endpoint (src/api-contracts-service.js), which is the only place the row is actually written --
// Finance never stores a copy. Same accessJwt pass-through and looser blanket-permission check on
// Connect's side (edit on any of finance/budget/compensation) as postConnectFinanceDaycareEntry
// above -- the legacy finance/daycare/:id PUT route carries no role check of its own beyond that.
export async function postConnectDaycareEntryEdit(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-daycare-entry-edit-v1';
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

// ── Real transport for connect.finance-daycare-entry-remove-relay.v1 (a write) ──────────────
// Relays a removal-by-id for one existing daycare entry to Connect's own contract endpoint
// (src/api-contracts-service.js), which is the only place the row is actually removed -- Finance
// never stores a copy. Same accessJwt pass-through and looser blanket-permission check on
// Connect's side as postConnectDaycareEntryEdit above -- the legacy finance/daycare/:id DELETE
// route carries no role check of its own beyond that.
export async function postConnectDaycareEntryRemove(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-daycare-entry-remove-v1';
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

// ── Real transport for connect.finance-daycare-sync-relay.v1 (a write) ──────────────────────
// Triggers Connect's own pull from the daycare app's finance API (src/api-contracts-service.js),
// which is the only place the sync actually runs and finance_daycare_entries is actually written
// -- Finance never stores a copy. Same accessJwt pass-through and looser blanket-permission check
// on Connect's side as postConnectDaycareEntryEdit above -- the legacy finance/daycare/sync route
// carries no role check of its own beyond that. If the daycare app itself is not configured on
// Connect's side (DAYCARE_API_URL/DAYCARE_API_KEY), Connect's own contract handler returns the
// exact same "not configured" message the legacy route already returns -- that comes back here as
// an ordinary `http_error` (never `not_configured`, which is reserved for THIS transport's own
// binding/secret being unset), so the caller can show the real Connect-side reason rather than a
// generic relay failure.
export async function postConnectDaycareSync(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-daycare-sync-v1';
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
      body: JSON.stringify(body || {}),
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

// ── Real transport for connect.finance-daycare-rooms-sync-relay.v1 (a write) ────────────────
// Triggers Connect's own pull from the daycare app's room-level finance API
// (src/api-contracts-service.js), which is the only place the sync actually runs and
// finance_daycare_rooms is actually written -- Finance never stores a copy. Admin-only on
// Connect's side, matching the legacy finance/daycare/rooms/sync route's own gate exactly. Same
// "not configured" pass-through as postConnectDaycareSync above.
export async function postConnectDaycareRoomsSync(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-daycare-rooms-sync-v1';
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
      body: JSON.stringify(body || {}),
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
