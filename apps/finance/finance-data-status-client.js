// ── Real transport for connect.finance-data-status.v1 ───────────────────────
// Same shape as connect-giving-client.js's fetchLiveConnectGivingSummary: a service-binding call
// to Connect's server-to-server contract endpoint, never throws, resolves to
// { ok: false, reason } on any failure so the caller can fall back to the local synthetic status.
import { acceptFinanceDataStatusV1 } from './finance-data-status-consumer.js';

const REQUEST_TIMEOUT_MS = 4000;

export async function fetchLiveFinanceDataStatus(env) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-data-status-v1';
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
    return { ok: true, status: acceptFinanceDataStatusV1(payload) };
  } catch (e) {
    return { ok: false, reason: 'contract_validation_failed', detail: e?.message || String(e) };
  }
}
