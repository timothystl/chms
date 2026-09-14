// ── Real transport for connect.finance-property-valuation.v1 ───────────────────────────────────
// Same shape as finance-balance-sheet-client.js / finance-church-report-client.js: a service-
// binding call to Connect's server-to-server contract endpoint, never throws, resolves to
// { ok: false, reason } on any failure so the caller (property-report-service.js) can fall back
// to the local synthetic fixture.
import { acceptFinancePropertyValuationV1 } from './finance-property-valuation-consumer.js';

const REQUEST_TIMEOUT_MS = 4000;

// 3277 Ivanhoe is the only property Finance/Connect track today (see
// FINANCE_PROPERTY_IVANHOE_META in src/db.js) -- matching production's own
// `finance/property/ivanhoe` route default.
export const DEFAULT_LIVE_PROPERTY_KEY = 'ivanhoe';

export async function fetchLiveFinancePropertyValuation(env, propertyKey = DEFAULT_LIVE_PROPERTY_KEY) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };

  const url = `https://connect.timothystl.org/api/contracts/finance-property-valuation-v1?property_key=${encodeURIComponent(propertyKey)}`;
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
    return { ok: true, valuation: acceptFinancePropertyValuationV1(payload) };
  } catch (e) {
    return { ok: false, reason: 'contract_validation_failed', detail: e?.message || String(e) };
  }
}
