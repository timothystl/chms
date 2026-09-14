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
