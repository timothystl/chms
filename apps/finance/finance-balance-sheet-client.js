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

// ── Real transport for connect.finance-church-balances-xlsx-import-relay.v1 (a write) ──────────
// Same shape as finance-church-report-client.js's postConnectChurchBudgetXlsxImport, for the
// Balance Sheet / Statement of Financial Position .xlsx import -- relays an uploaded file to
// Connect's own contract endpoint (src/api-contracts-service.js), which parses AND persists it in
// one call via importChurchBalancesXlsx (src/api-finance.js). `body` is `{ file_base64 }` --
// shell.js has already read the browser's multipart upload and base64-encoded the bytes before
// calling this; the fiscal year and as-of date come from the workbook itself, exactly as legacy
// determines them, so there is no separate form field for either.
const WRITE_REQUEST_TIMEOUT_MS_BALANCES = 4000;

export async function postConnectChurchBalancesXlsxImport(env, accessJwt, body) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/finance-church-balances-xlsx-import-v1';
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
      signal: AbortSignal.timeout(WRITE_REQUEST_TIMEOUT_MS_BALANCES),
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
