// Relay for connect.finance-planning-basis.v1: the fiscal year's budget plan lines, each sorted
// into the group a planning scenario adjusts. Aggregate budget lines only; Finance keeps no copy.
// Never throws.
const REQUEST_TIMEOUT_MS = 6000;

export async function fetchPlanningBasis(env, fiscalYear) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  let res;
  try {
    res = await binding.fetch(new Request(`https://connect.timothystl.org/api/contracts/finance-planning-basis-v1?fiscal_year=${encodeURIComponent(fiscalYear)}`, {
      headers: { 'X-Contract-Key': key, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }));
  } catch (e) {
    return { ok: false, reason: 'network_error', detail: e?.message || String(e) };
  }
  if (!res.ok) return { ok: false, reason: 'http_error', status: res.status };
  let payload;
  try { payload = await res.json(); } catch { return { ok: false, reason: 'invalid_json' }; }
  if (payload?.contract !== 'connect.finance-planning-basis.v1' || !Array.isArray(payload.lines)
    || payload.lines.some((l) => typeof l.category !== 'string' || !['Income', 'Expenses'].includes(l.classification)
      || !Number.isInteger(l.plannedAmountCents) || typeof l.group !== 'string')) {
    return { ok: false, reason: 'contract_validation_failed' };
  }
  return { ok: true, basis: payload };
}

export function describePlanningBasisFailure(result) {
  switch (result?.reason) {
    case 'not_configured': return 'The connection to Connect is not configured in this environment.';
    case 'network_error': return 'Connect could not be reached. Try again in a moment.';
    case 'http_error': return `Connect answered with an error (${result.status}).`;
    default: return 'Connect returned an unexpected response.';
  }
}
