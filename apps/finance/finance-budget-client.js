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
