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
