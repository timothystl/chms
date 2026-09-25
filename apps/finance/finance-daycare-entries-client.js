// ── Real transport for connect.finance-daycare-entries.v1 ─────────────────────────────────────
// Same shape as finance-data-status-client.js: a service-binding read that never throws and
// resolves to { ok: false, reason } on any failure, so the Daycare actuals page can simply omit its
// entry list rather than break.
import { acceptFinanceDaycareEntriesV1 } from '../../contracts/validators/finance-daycare-entries-consumer.js';

const REQUEST_TIMEOUT_MS = 4000;

export async function fetchLiveFinanceDaycareEntries(env, fiscalYear) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!/^\d{4}$/.test(String(fiscalYear))) return { ok: false, reason: 'invalid_fiscal_year' };

  const url = `https://connect.timothystl.org/api/contracts/finance-daycare-entries-v1?fiscal_year=${fiscalYear}`;
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
    return { ok: true, entries: acceptFinanceDaycareEntriesV1(payload).entries };
  } catch (e) {
    return { ok: false, reason: 'contract_validation_failed', detail: e?.message || String(e) };
  }
}
