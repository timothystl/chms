// ── Real transport for connect.giving-summary.v1 ────────────────────────────
// Calls Connect's server-to-server contract endpoint (src/api-contracts-service.js
// in this same repo) via a Cloudflare service binding, the same in-process,
// no-DNS pattern the website repo already relies on for its own cross-Worker
// calls (see website/admin/market.js's comment on env.VOLUNTEER_WORKER).
//
// Never throws. Every failure mode — the binding or key not configured yet,
// a network error, a non-200 response, malformed JSON, or a payload that
// fails Finance's own real contract validation — resolves to
// { ok: false, reason } so the caller can fall back to the committed
// synthetic fixture instead of breaking the page. Only a real target
// (accepted, validated data) resolves to { ok: true, summary }.
import { acceptConnectGivingSummaryV1 } from './connect-giving-consumer.js';

const REQUEST_TIMEOUT_MS = 4000;

export async function fetchLiveConnectGivingSummary(env, { startDate, endDate }) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };

  const url = `https://connect.timothystl.org/api/contracts/connect-giving-summary-v1?from=${startDate}&to=${endDate}`;
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
    return { ok: true, summary: acceptConnectGivingSummaryV1(payload) };
  } catch (e) {
    return { ok: false, reason: 'contract_validation_failed', detail: e?.message || String(e) };
  }
}

// A trailing year-to-date window ending yesterday (UTC) — the live producer refuses a period
// ending today or later (its data isn't final until the day closes), and this needs no input
// from the caller since there is no date picker on this preview.
export function defaultLiveGivingPeriod(now = new Date()) {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const endDate = yesterday.toISOString().slice(0, 10);
  const startDate = `${yesterday.getUTCFullYear()}-01-01`;
  return { startDate, endDate };
}
