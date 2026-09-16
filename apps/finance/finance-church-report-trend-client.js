// ── Real transport for connect.finance-church-report-trend.v1 ──────────────────────────────────
// Same shape as finance-church-report-client.js: a service-binding call to Connect's server-to-
// server contract endpoint, never throws, resolves to { ok: false, reason } on any failure so the
// caller (church-report-service.js's resolveChurchTrend) can fall back to the local synthetic
// fixture. No query parameters -- the trend is inherently the whole multi-year history on file, not
// one period a caller names.
import { acceptFinanceChurchReportTrendV1 } from './finance-church-report-trend-consumer.js';

const REQUEST_TIMEOUT_MS = 4000;

export async function fetchLiveFinanceChurchReportTrend(env) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-church-report-trend-v1';
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
    return { ok: true, trend: acceptFinanceChurchReportTrendV1(payload) };
  } catch (e) {
    return { ok: false, reason: 'contract_validation_failed', detail: e?.message || String(e) };
  }
}
