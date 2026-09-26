// Relay for connect.finance-board-layout.v1: the saved board categories, heading and account
// renames, and purpose tags that lay out the Budget builder and the Chart of Accounts editor.
// Structural only; Finance keeps no copy. Never throws.
const REQUEST_TIMEOUT_MS = 4000;

export async function fetchBoardLayout(env) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  let res;
  try {
    res = await binding.fetch(new Request('https://connect.timothystl.org/api/contracts/finance-board-layout-v1', {
      headers: { 'X-Contract-Key': key, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }));
  } catch (e) {
    return { ok: false, reason: 'network_error', detail: e?.message || String(e) };
  }
  if (!res.ok) return { ok: false, reason: 'http_error', status: res.status };
  let payload;
  try { payload = await res.json(); } catch { return { ok: false, reason: 'invalid_json' }; }
  const cats = payload?.boardCategories;
  const tags = payload?.purposeTags;
  if (payload?.contract !== 'connect.finance-board-layout.v1' || !cats || typeof cats !== 'object' || !tags || !Array.isArray(tags.tags)) {
    return { ok: false, reason: 'contract_validation_failed' };
  }
  return { ok: true, layout: payload };
}
