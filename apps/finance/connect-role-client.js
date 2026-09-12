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
const REQUEST_TIMEOUT_MS = 4000;

export async function fetchVerifiedRole(env, accessJwt) {
  const binding = env.CONNECT_SERVICE;
  const key = env.FINANCE_CONTRACT_API_KEY;
  if (!binding || !key) return { ok: false, reason: 'not_configured' };
  if (!accessJwt) return { ok: false, reason: 'no_access_identity' };

  const url = 'https://connect.timothystl.org/api/contracts/staff-role-v1';
  let res;
  try {
    res = await binding.fetch(new Request(url, {
      headers: { 'X-Contract-Key': key, 'Cf-Access-Jwt-Assertion': accessJwt, Accept: 'application/json' },
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
  if (!payload || typeof payload.role !== 'string' || !payload.role) return { ok: false, reason: 'invalid_role' };
  return { ok: true, role: payload.role };
}

// Roles that have zero Finance access in the real (legacy) system -- api-chms.js routes every
// other role either into handleFinanceApi or its own narrow non-Finance branch, but 'member' and
// 'volunteer' have no route into Finance at all. Kept separate from the 'compensation'-only
// restriction below since this is a total denial, not a narrowing to one section.
export const NO_FINANCE_ACCESS_ROLES = Object.freeze(['member', 'volunteer']);

// Whether a verified role may see the given parity-manifest section. Deliberately conservative:
// only tightens the two cases this pass has real, verified evidence for (member/volunteer get
// nothing; compensation gets only the compensation-tagged section) -- it does NOT attempt to
// replicate the legacy per-item admin/finance/staff/council permission matrix inside
// apps/finance's coarser 4-tag permission model, which is separate, larger work.
export function roleCanAccessSection(role, section) {
  if (NO_FINANCE_ACCESS_ROLES.includes(role)) return false;
  if (role === 'compensation') return section.permission === 'compensation';
  return true;
}
