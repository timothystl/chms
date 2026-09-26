// ── Real transport for connect.finance-balance-sheet-trend.v1 ───────────────────────────────
// Same shape as finance-balance-sheet-client.js: a service-binding call to Connect's server-to-
// server contract endpoint, never throws, resolves to { ok: false, reason } on any failure so the
// caller (balance-sheet-service.js's resolveBalanceSheetTrend) can fall back to the local
// synthetic fixture. No fiscal_year query param -- unlike the single-year contract, this one has
// no per-year selection. By default it names every fiscal year on file; an optional
// { fromYear, toYear } window (the multi-year page's From/To range) asks for exactly those years.
import { acceptFinanceBalanceSheetTrendV1 } from '../../contracts/validators/finance-balance-sheet-trend-consumer.js';

const REQUEST_TIMEOUT_MS = 4000;

export async function fetchLiveFinanceBalanceSheetTrend(env, { fromYear = null, toYear = null } = {}) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };

  const windowed = Number.isInteger(fromYear) && Number.isInteger(toYear);
  const url = 'https://connect.timothystl.org/api/contracts/finance-balance-sheet-trend-v1'
    + (windowed ? `?from_year=${encodeURIComponent(fromYear)}&to_year=${encodeURIComponent(toYear)}` : '');
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
    return { ok: true, trend: acceptFinanceBalanceSheetTrendV1(payload) };
  } catch (e) {
    return { ok: false, reason: 'contract_validation_failed', detail: e?.message || String(e) };
  }
}
