// ── Real transport for connect.finance-church-report.v1 ─────────────────────────────────────
// Same shape as finance-chart-of-accounts-client.js / finance-budget-client.js: a service-binding
// call to Connect's server-to-server contract endpoint, never throws, resolves to
// { ok: false, reason } on any failure so the caller (church-report-service.js) can fall back to
// the local synthetic fixture.
import { acceptFinanceChurchReportV1 } from './finance-church-report-consumer.js';

const REQUEST_TIMEOUT_MS = 4000;

export async function fetchLiveFinanceChurchReport(env, fiscalYear) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };

  const url = `https://connect.timothystl.org/api/contracts/finance-church-report-v1?fiscal_year=${encodeURIComponent(fiscalYear)}`;
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
    return { ok: true, report: acceptFinanceChurchReportV1(payload) };
  } catch (e) {
    return { ok: false, reason: 'contract_validation_failed', detail: e?.message || String(e) };
  }
}

// Church Report's "This Year" view is the current calendar year -- matching production's own
// default (`finance/church/this-year?year=` falls back to `new Date().getFullYear()` with no
// query param) rather than a fiscal year ahead the way Budget planning looks forward.
export function defaultLiveChurchReportFiscalYear(now = new Date()) {
  return now.getUTCFullYear();
}

// ── Real transport for connect.finance-church-actual-override-relay.v1 (a write) ────────────
// Relays a hand-typed actual-figure correction to Connect's own contract endpoint
// (src/api-contracts-service.js), which is the only place the correction is actually written --
// Finance never stores a copy. `accessJwt` is the Cf-Access-Jwt-Assertion value from the ORIGINAL
// incoming request; Connect independently verifies that signature and checks the real Connect
// role (admin only, same as the legacy in-Connect Church Report) -- this call carries it through,
// it does not decide who is authorized. Same never-throws, always-{ok,reason}-labeled shape as
// postConnectFinanceBudgetWrite in finance-budget-client.js.
const WRITE_REQUEST_TIMEOUT_MS = 4000;

export async function postConnectFinanceChurchActualOverride(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-church-actual-override-v1';
  let res;
  try {
    res = await binding.fetch(new Request(url, {
      method: 'POST',
      headers: {
        'X-Contract-Key': key,
        'Cf-Access-Jwt-Assertion': accessJwt,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(WRITE_REQUEST_TIMEOUT_MS),
    }));
  } catch (e) {
    return { ok: false, reason: 'network_error', detail: e?.message || String(e) };
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  if (!res.ok) return { ok: false, reason: 'http_error', status: res.status, message: payload?.error };
  return { ok: true, result: payload };
}

// ── Real transport for connect.finance-church-budget-xlsx-import-relay.v1 (a write) ────────────
// Relays an uploaded "Budget vs. Actuals" .xlsx to Connect's own contract endpoint
// (src/api-contracts-service.js), which parses AND persists it in one call -- see
// importChurchBudgetXlsx's own header comment in src/api-finance.js for why this collapses
// legacy's separate preview-then-commit steps into one request. `body` is
// `{ fiscal_year_hint, file_base64 }` -- shell.js has already read the browser's multipart upload
// and base64-encoded the bytes before calling this; `fiscal_year_hint` is optional and never
// trusted over the workbook's own fiscal year (the parser derives it from the sheet itself, same
// as legacy). Same never-throws, always-{ok,reason}-labeled shape as
// postConnectFinanceChurchActualOverride above.
export async function postConnectChurchBudgetXlsxImport(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-church-budget-xlsx-import-v1';
  let res;
  try {
    res = await binding.fetch(new Request(url, {
      method: 'POST',
      headers: {
        'X-Contract-Key': key,
        'Cf-Access-Jwt-Assertion': accessJwt,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(WRITE_REQUEST_TIMEOUT_MS),
    }));
  } catch (e) {
    return { ok: false, reason: 'network_error', detail: e?.message || String(e) };
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  if (!res.ok) return { ok: false, reason: 'http_error', status: res.status, message: payload?.error };
  return { ok: true, result: payload };
}
