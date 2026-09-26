import { acceptFinanceHealthV1 } from '../../contracts/validators/finance-health-consumer.js';

// connect.finance-health.v1 needs Giving's household rollups and fund totals, so Connect always
// answers it (local-contract-reads.js deliberately does not list it). One contract, one timeout:
// the Financial Health page renders what else it has, with an honest note, when this fails.
const REQUEST_TIMEOUT_MS = 6000;

export async function fetchLiveFinanceHealth(env, fiscalYear) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  let response;
  try {
    response = await binding.fetch(new Request(
      `https://connect.timothystl.org/api/contracts/finance-health-v1?fiscal_year=${encodeURIComponent(fiscalYear)}`,
      { headers: { 'X-Contract-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    ));
  } catch (error) {
    return { ok: false, reason: 'network_error', detail: error?.message || String(error) };
  }
  if (!response.ok) return { ok: false, reason: 'http_error', status: response.status };
  let payload;
  try { payload = await response.json(); } catch { return { ok: false, reason: 'invalid_json' }; }
  try { return { ok: true, health: acceptFinanceHealthV1(payload) }; }
  catch (error) { return { ok: false, reason: 'contract_validation_failed', detail: error?.message || String(error) }; }
}
