import { acceptFinanceCashRunwayV1 } from '../../contracts/validators/finance-cash-runway-consumer.js';

const REQUEST_TIMEOUT_MS = 4000;

export async function fetchLiveFinanceCashRunway(env, fiscalYear) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  let response;
  try {
    response = await binding.fetch(new Request(
      `https://connect.timothystl.org/api/contracts/finance-cash-runway-v1?fiscal_year=${encodeURIComponent(fiscalYear)}`,
      { headers: { 'X-Contract-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    ));
  } catch (error) {
    return { ok: false, reason: 'network_error', detail: error?.message || String(error) };
  }
  if (!response.ok) return { ok: false, reason: 'http_error', status: response.status };
  let payload;
  try { payload = await response.json(); } catch { return { ok: false, reason: 'invalid_json' }; }
  try { return { ok: true, runway: acceptFinanceCashRunwayV1(payload) }; }
  catch (error) { return { ok: false, reason: 'contract_validation_failed', detail: error?.message || String(error) }; }
}
