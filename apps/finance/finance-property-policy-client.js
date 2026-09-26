import { acceptFinancePropertyPolicyV1 } from '../../contracts/validators/finance-property-policy-consumer.js';

const REQUEST_TIMEOUT_MS = 4000;

export async function fetchFinancePropertyPolicy(env, propertyKey = 'ivanhoe') {
  if (!env.CONNECT_SERVICE || !env.FINANCE_CONTRACT_API_KEY) return { ok: false, reason: 'not_configured' };
  const url = `https://connect.timothystl.org/api/contracts/finance-property-policy-v1?property_key=${encodeURIComponent(propertyKey)}`;
  let response;
  try {
    response = await env.CONNECT_SERVICE.fetch(new Request(url, {
      headers: { 'X-Contract-Key': env.FINANCE_CONTRACT_API_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }));
  } catch (error) {
    return { ok: false, reason: 'network_error', detail: error?.message || String(error) };
  }
  if (!response.ok) return { ok: false, reason: 'http_error', status: response.status };
  let payload;
  try { payload = await response.json(); } catch { return { ok: false, reason: 'invalid_json' }; }
  try { return { ok: true, policy: acceptFinancePropertyPolicyV1(payload) }; }
  catch (error) { return { ok: false, reason: 'contract_validation_failed', detail: error?.message || String(error) }; }
}
