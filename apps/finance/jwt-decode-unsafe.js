// ── Unverified JWT claim decode -- diagnostics only, never authorization ────
// Reads the claims out of a Cf-Access-Jwt-Assertion token WITHOUT checking its
// signature, expiry, issuer, or audience. This must never be used to decide
// whether a caller is who they claim to be -- that's verifyAccessJwt's job
// (chms/src/access-jwt.js), which this file does not touch or replace.
//
// This exists only so the temporary payroll relay diagnostic (see
// route-manifest.js) can show what a JWT Finance is actually forwarding
// *claims* to be, so a real verification failure on Website's side (which
// deliberately never says which check failed) can be narrowed down from
// the Finance side, without needing any change to Website's auth code.
//
// Never throws: any malformed input returns null.
function base64UrlDecodeText(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function decodeJwtClaimsUnsafe(token) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) return null;
  let payload;
  try {
    payload = JSON.parse(base64UrlDecodeText(parts[1]));
  } catch {
    return null;
  }
  const aud = Array.isArray(payload.aud) ? payload.aud : (payload.aud ? [payload.aud] : []);
  return {
    iss: typeof payload.iss === 'string' ? payload.iss : null,
    aud,
    expiresInSeconds: typeof payload.exp === 'number' ? Math.round(payload.exp - Date.now() / 1000) : null,
    emailPresent: typeof payload.email === 'string' && payload.email.length > 0,
  };
}
