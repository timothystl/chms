// ── AUTH ─────────────────────────────────────────────────────────────
// Uses HMAC-SHA256 to sign a timestamp. The cookie value is `<timestamp>.<base64url-sig>`.
// This prevents the cookie from being forged without knowing env.ADMIN_PASSWORD.
export async function isAuthed(req, env) {
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/vol_auth=([^;\s]+)/);
  if (!m) return false;
  const [ts, sig] = m[1].split('.');
  if (!ts || !sig) return false;
  if (Date.now() - parseInt(ts, 10) > 8 * 60 * 60 * 1000) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(env.ADMIN_PASSWORD || ''),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    return await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(ts));
  } catch { return false; }
}
export async function authCookieHeader(env) {
  const ts = Date.now().toString();
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.ADMIN_PASSWORD || ''),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ts));
  const b64url = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const exp = new Date(Date.now() + 8 * 60 * 60 * 1000).toUTCString();
  return `vol_auth=${ts}.${b64url}; Path=/; Expires=${exp}; HttpOnly; Secure; SameSite=Strict`;
}

// ── UTILITIES ─────────────────────────────────────────────────────────
// Security headers applied to every response
export const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // Tight CSP — no external scripts, no eval; inline styles/scripts are
  // required by the SPA so 'unsafe-inline' is the pragmatic choice here.
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src * data:; connect-src 'self'; frame-ancestors 'none';",
};
export function html(content, status = 200, extraHeaders = {}) {
  return new Response(content, {
    status,
    headers: { 'Content-Type': 'text/html;charset=UTF-8', ...SEC_HEADERS, ...extraHeaders }
  });
}
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...SEC_HEADERS }
  });
}
export function redirect(url) {
  return new Response('', { status: 302, headers: { Location: url } });
}
export function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
export function escHtml(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── SCHEDULER BACKEND: CORS headers ──────────────────────────────────────────
export const SCHED_CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Worker-Secret, X-Resend-Key, X-Email-From, X-Breeze-Subdomain, X-Breeze-Api-Key',
};
