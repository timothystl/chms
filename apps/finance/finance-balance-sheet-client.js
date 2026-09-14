// ── Real transport for connect.finance-balance-sheet.v1 ─────────────────────────────────────
// Same shape as finance-church-report-client.js / finance-budget-client.js: a service-binding
// call to Connect's server-to-server contract endpoint, never throws, resolves to
// { ok: false, reason } on any failure so the caller (balance-sheet-service.js) can fall back to
// the local synthetic fixture.
import { acceptFinanceBalanceSheetV1 } from './finance-balance-sheet-consumer.js';

const REQUEST_TIMEOUT_MS = 4000;

export async function fetchLiveFinanceBalanceSheet(env, fiscalYear) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };

  const url = `https://connect.timothystl.org/api/contracts/finance-balance-sheet-v1?fiscal_year=${encodeURIComponent(fiscalYear)}`;
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
    return { ok: true, balanceSheet: acceptFinanceBalanceSheetV1(payload) };
  } catch (e) {
    return { ok: false, reason: 'contract_validation_failed', detail: e?.message || String(e) };
  }
}

// Balance Sheet's "Position" view is the current calendar year -- matching production's own
// default (`finance/church/balances?year=` falls back to `new Date().getFullYear()` with no
// query param), the same convention as Church Report's own "This Year" default rather than
// Budget's year-ahead default.
export function defaultLiveBalanceSheetFiscalYear(now = new Date()) {
  return now.getUTCFullYear();
}
