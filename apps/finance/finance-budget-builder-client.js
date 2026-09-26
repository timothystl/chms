// Relay for connect.finance-budget-builder.v1: each line of the target year's budget plan beside
// its prior-year actual, base-year budget and base-year projection. Aggregate lines only; Finance
// keeps no copy. Never throws.
const REQUEST_TIMEOUT_MS = 6000;

export async function fetchBudgetBuilder(env, targetYear) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  let res;
  try {
    res = await binding.fetch(new Request(`https://connect.timothystl.org/api/contracts/finance-budget-builder-v1?target_year=${encodeURIComponent(targetYear)}`, {
      headers: { 'X-Contract-Key': key, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }));
  } catch (e) {
    return { ok: false, reason: 'network_error', detail: e?.message || String(e) };
  }
  if (!res.ok) return { ok: false, reason: 'http_error', status: res.status };
  let payload;
  try { payload = await res.json(); } catch { return { ok: false, reason: 'invalid_json' }; }
  if (payload?.contract !== 'connect.finance-budget-builder.v1' || !Array.isArray(payload.lines)) return { ok: false, reason: 'contract_validation_failed' };
  return { ok: true, builder: payload };
}
