// ── Real transport for connect.staff-role-v1 ────────────────────────────────
// Asks Connect (src/api-contracts-service.js) who the caller really is, via the same
// CONNECT_SERVICE service binding + Cf-Access-Jwt-Assertion forwarding already used by
// connect-giving-client.js for the Giving quick-entry write. Connect independently verifies the
// Access JWT signature against Access's own published keys and looks up the role itself; this
// call only carries the answer back to Finance's own section gating (see parity-manifest.js's
// `permission` field) -- it never decides who is authorized.
//
// Never throws. Every failure mode -- the binding/key not configured, no Access identity on the
// incoming request, a network error, a non-200 response (no matching/active account, or Access
// verification not configured on Connect's side), or malformed JSON -- resolves to
// { ok: false, reason }. Only a genuinely verified identity resolves to { ok: true, role }.

const REQUEST_TIMEOUT_MS = 9000;

export async function fetchVerifiedRole(env, accessJwt) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };
  // One retry for a failure that is Connect's momentary trouble (a timeout, a dropped connection,
  // or a 5xx while it restarts after a release). A refusal (401/403) is final and never retried.
  // A timeout is not retried: a second wait would only double the delay before the answer.
  const first = await requestVerifiedRole(binding, key, accessJwt);
  const transient = first.reason === 'network_error' ? !first.timedOut : first.reason === 'http_error' && first.status >= 500;
  if (first.ok || !transient) return first;
  return requestVerifiedRole(binding, key, accessJwt);
}

async function requestVerifiedRole(binding, key, accessJwt) {

  const url = 'https://connect.timothystl.org/api/contracts/staff-role-v1';
  let res;
  try {
    res = await binding.fetch(new Request(url, {
      headers: { 'X-Contract-Key': key, 'Cf-Access-Jwt-Assertion': accessJwt, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }));
  } catch (e) {
    return { ok: false, reason: 'network_error', timedOut: e?.name === 'TimeoutError' || e?.name === 'AbortError', detail: e?.message || String(e) };
  }
  if (!res.ok) return { ok: false, reason: 'http_error', status: res.status };

  let payload;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  if (!payload || typeof payload.role !== 'string' || !payload.role) return { ok: false, reason: 'invalid_role' };
  return {
    ok: true,
    role: payload.role,
    ...(payload.permissions && typeof payload.permissions === 'object' && !Array.isArray(payload.permissions)
      ? { permissions: payload.permissions } : {}),
    ...(typeof payload.identity === 'string' && payload.identity.trim()
      ? { identity: payload.identity.trim().toLowerCase() } : {}),
    ...(typeof payload.username === 'string' && payload.username.trim()
      ? { username: payload.username.trim() } : {}),
  };
}

// Current Connect permissions are part of the verified role response. Missing
// or unknown permissions deny; the narrow compensation role is not configurable.
export const NO_FINANCE_ACCESS_ROLES = Object.freeze(['member', 'volunteer']);
export function roleCanAccessSection(role, section, permissions = {}) {
  if (role === 'admin') return true;
  if (role === 'compensation') return section.permission === 'compensation';
  if (!['finance', 'staff', 'council'].includes(role)) return false;
  if (section.permission === 'admin') return false;
  if (section.permission === 'compensation' && role !== 'council') return false;
  const item = ['giving', 'giving-analytics'].includes(section.id) ? 'giving' : section.permission;
  const canRead = key => (key === 'giving' ? ['anon', 'view', 'edit'] : ['view', 'edit']).includes(permissions[key]);
  if (!canRead(item)) return false;
  // Gift Entry names donors on every page, so totals-only Giving access (council) does not open it.
  if (section.id === 'giving' && !['view', 'edit'].includes(permissions.giving)) return false;
  // These composite reports include the Giving summary as well as accounting.
  if (['health', 'charts', 'packet'].includes(section.id) && !canRead('giving')) return false;
  return true;
}
