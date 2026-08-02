// ── AUTH ─────────────────────────────────────────────────────────────
// Cookie formats (all HMAC-SHA256 signed with ADMIN_PASSWORD):
//   4-part: `<ts>.<role>.<username>.<sig>`  sig covers `ts.role.username`
//   3-part: `<ts>.<role>.<sig>`             sig covers `ts.role`
//   2-part: `<ts>.<sig>`                    sig covers `ts`  (legacy admin)
// Username may be empty string for env-var logins.
//
// Session behavior:
//   - Cookie is a session cookie (no Expires) so it dies on browser close.
//   - The ts embedded in the cookie is the LAST activity time; it's refreshed
//     on every authenticated request via `refreshAuthCookie` wrapper in the
//     worker entry. If no request arrives within IDLE_TIMEOUT_MS, the cookie
//     is rejected and the user is forced back to the login page.
export const IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours

// Per-request memoization. A single API request resolves auth several times over —
// the worker entry (for the sliding-cookie refresh), the /admin/api/ gate, and again
// inside the handler dispatch — and each resolution costs an HMAC verify plus a D1
// round-trip against app_users. Keying the in-flight promise off the Request object
// collapses those to one. WeakMap so entries are collected with the request; nothing is
// shared between requests, so a deactivation still takes effect on the very next one.
const _authCache = new WeakMap();

// Parse and verify the auth cookie. Returns { role, username } or null.
export async function getAuthInfo(req, env) {
  const cached = _authCache.get(req);
  if (cached) return cached;
  const p = _resolveAuthInfo(req, env);
  _authCache.set(req, p);
  return p;
}

async function _resolveAuthInfo(req, env) {
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/vol_auth=([^;\s]+)/);
  if (!m) return null;
  const parts = m[1].split('.');
  let ts, role, username = '', sig;
  if (parts.length === 4) {
    [ts, role, username, sig] = parts;
  } else if (parts.length === 3) {
    [ts, role, sig] = parts;
  } else if (parts.length === 2) {
    [ts, sig] = parts;
    role = 'admin';
  } else {
    return null;
  }
  if (!ts || !sig) return null;
  if (Date.now() - parseInt(ts, 10) > IDLE_TIMEOUT_MS) return null;
  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(env.ADMIN_PASSWORD || ''),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const payload = parts.length === 4 ? `${ts}.${role}.${username}`
                  : parts.length === 3 ? `${ts}.${role}`
                  : ts;
    const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload));
    if (!valid) return null;
  } catch { return null; }
  // Live-check DB-backed sessions on every request so a deactivation or role change takes
  // effect immediately instead of only on next login — the cookie's `role` claim is only
  // trusted as-signed for env-var/break-glass logins (no username, no DB row to check).
  // Authorization always uses the CURRENT DB role, not the possibly-stale cookie value.
  if (username && env.DB) {
    const dbUser = await env.DB.prepare(
      `SELECT active, role FROM app_users WHERE LOWER(username)=? LIMIT 1`
    ).bind(username.toLowerCase()).first().catch(() => undefined);
    if (dbUser === undefined) return null; // DB error — fail closed
    if (!dbUser || !dbUser.active) return null;
    return { role: dbUser.role, username };
  }
  return { role, username };
}
export async function getAuthRole(req, env) {
  const info = await getAuthInfo(req, env);
  return info ? info.role : null;
}
export async function isAuthed(req, env) {
  return (await getAuthInfo(req, env)) !== null;
}
// username must be alphanumeric/underscore/hyphen only (no dots)
export async function authCookieHeader(env, role = 'admin', username = '') {
  const ts = Date.now().toString();
  const safeUser = username.replace(/[^a-zA-Z0-9_-]/g, '');
  const payload = safeUser ? `${ts}.${role}.${safeUser}` : `${ts}.${role}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.ADMIN_PASSWORD || ''),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const b64url = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const cookieVal = safeUser ? `${ts}.${role}.${safeUser}.${b64url}` : `${ts}.${role}.${b64url}`;
  // Session cookie (no Expires/Max-Age) — browser discards on close.
  // SameSite=Lax (not Strict): the QuickBooks OAuth callback (FIN1) lands back on this app via
  // a cross-site-initiated top-level GET redirect from Intuit's consent screen — SameSite=Strict
  // silently drops the cookie on exactly that kind of request, breaking the whole connect flow.
  // Lax still blocks the cookie on cross-site subresource/POST requests (the real CSRF risk);
  // the OAuth flow itself is separately CSRF-protected via the single-use `state` parameter.
  return `vol_auth=${cookieVal}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

// Wrap an authenticated response with a refreshed Set-Cookie so the idle
// timeout rolls forward with activity. Skips refresh if the response is
// already setting vol_auth (login/logout handle their own cookie).
export async function refreshAuthCookie(response, authInfo, env) {
  if (!authInfo || !response) return response;
  const existing = response.headers.get('Set-Cookie') || '';
  if (existing.includes('vol_auth=')) return response;
  const newCookie = await authCookieHeader(env, authInfo.role, authInfo.username);
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', newCookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// ── PASSWORD HASHING (PBKDF2-SHA256) ────────────────────────────────
// Stored format: `pbkdf2:<saltHex>:<hashHex>`
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    keyMaterial, 256
  );
  const toHex = (buf) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${toHex(salt)}:${toHex(bits)}`;
}
export async function verifyPassword(password, stored) {
  try {
    const [, saltHex, hashHex] = stored.split(':');
    if (!saltHex || !hashHex) return false;
    const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
    const keyMaterial = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
      keyMaterial, 256
    );
    const testHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
    // Constant-time comparison
    if (testHex.length !== hashHex.length) return false;
    let diff = 0;
    for (let i = 0; i < testHex.length; i++) diff |= testHex.charCodeAt(i) ^ hashHex.charCodeAt(i);
    return diff === 0;
  } catch { return false; }
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
  // fonts.googleapis.com serves the @import CSS; fonts.gstatic.com serves the
  // actual font binary files; both are needed for Google Fonts to load.
  // img-src needs blob: (not just the '*' wildcard, which excludes the blob:/
  // data:/filesystem: schemes per the CSP spec) for the Scheduler's Print
  // Preview Copy/Download Image feature, which loads its rasterized SVG into
  // an <img> via a blob: URL (see SC7-FIX4 in CLAUDE.md).
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src * data: blob:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; frame-ancestors 'none';",
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
