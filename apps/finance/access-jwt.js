// Finance's own copy of Connect's Cloudflare Access JWT verification (src/access-jwt.js), kept
// identical in behavior: Finance is a separate Worker and does not import Connect's source. Finance
// uses it only to know who is signed in when Connect cannot answer the role check, so a role Connect
// confirmed recently can still be applied (role-cache.js).

const JWKS_CACHE_MS = 60 * 60 * 1000; // Access rotates signing keys infrequently.

// Module-scope cache, reused across requests handled by the same Worker isolate.
// Keyed by team domain so a stale cache can't leak across a config change in tests.
let jwksCache = null; // { teamDomain, keys: Map<kid, CryptoKey>, fetchedAt }

function base64UrlToUint8Array(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeJson(b64url) {
  return JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(b64url)));
}

async function fetchJwks(teamDomain, fetchImpl) {
  if (jwksCache && jwksCache.teamDomain === teamDomain && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_MS) {
    return jwksCache.keys;
  }
  const res = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs fetch failed: ${res.status}`);
  const { keys } = await res.json();
  const imported = new Map();
  for (const jwk of keys || []) {
    if (!jwk.kid) continue;
    imported.set(jwk.kid, await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    ));
  }
  jwksCache = { teamDomain, keys: imported, fetchedAt: Date.now() };
  return imported;
}

/**
 * Verifies a Cloudflare Access JWT and returns the verified, lowercased email, or
 * null on any failure. `teamDomain` is the Access team's `*.cloudflareaccess.com`
 * host; `audience` is the target Access application's AUD tag. Both come from
 * Cloudflare's dashboard, not from anything in the request.
 */
export async function verifyAccessJwt(token, { teamDomain, audience, fetchImpl = fetch, now = () => Date.now() } = {}) {
  if (!token || !teamDomain || !audience) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header, payload;
  try {
    header = base64UrlDecodeJson(headerB64);
    payload = base64UrlDecodeJson(payloadB64);
  } catch {
    return null;
  }
  // Pin the algorithm ourselves rather than trusting header.alg for key selection --
  // otherwise an attacker could set alg:"none" or point at a key of a different type.
  if (header.alg !== 'RS256' || !header.kid) return null;

  let keys;
  try {
    keys = await fetchJwks(teamDomain, fetchImpl);
  } catch {
    return null;
  }
  let key = keys.get(header.kid);
  if (!key) {
    // Signing keys rotated since our cache was populated -- refetch once before giving up.
    jwksCache = null;
    try { keys = await fetchJwks(teamDomain, fetchImpl); } catch { return null; }
    key = keys.get(header.kid);
  }
  if (!key) return null;

  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  let signature;
  try { signature = base64UrlToUint8Array(sigB64); } catch { return null; }
  const valid = await crypto.subtle
    .verify({ name: 'RSASSA-PKCS1-v1_5' }, key, signature, signedData)
    .catch(() => false);
  if (!valid) return null;

  const nowSec = now() / 1000;
  if (typeof payload.exp !== 'number' || payload.exp < nowSec) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > nowSec) return null;
  if (payload.iss !== `https://${teamDomain}`) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(audience)) return null;
  if (!payload.email || typeof payload.email !== 'string') return null;

  return payload.email.toLowerCase();
}

/** Test-only: clears the module-scope JWKS cache so tests don't leak state into each other. */
export function resetAccessJwtCacheForTests() {
  jwksCache = null;
}
