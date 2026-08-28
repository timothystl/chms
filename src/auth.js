// ── AUTH ─────────────────────────────────────────────────────────────
// Cookie formats (all HMAC-SHA256 signed with SESSION_SECRET — see P23-A below):
//   4-part: `<ts>.<role>.<username>.<sig>`  sig covers `ts.role.username`
//   3-part: `<ts>.<role>.<sig>`             sig covers `ts.role`
//   2-part: `<ts>.<sig>`                    sig covers `ts`  (legacy admin)
// Username may be empty string for env-var logins.
//
// P23-A (SEC15): cookies used to be signed with ADMIN_PASSWORD — a human-chosen password
// that is also the break-glass LOGIN credential, so anyone holding a valid cookie (down to
// the lowest-trust `member` role, on their own phone) held HMAC(ADMIN_PASSWORD, knownPayload)
// and could grind it offline at their leisure. Recovering it forges a cookie for ANY role and
// hands over the break-glass login too. Signing now uses a separate, high-entropy
// `SESSION_SECRET` that has no other purpose — compromising a forged cookie no longer also
// compromises the break-glass admin password, and rotating one no longer force-logs-out
// break-glass recovery along with everyone else (see SECRETS.md).
//
// ⚠ FAILS CLOSED, not open: with no SESSION_SECRET set, sessionSigningKey() throws rather than
// falling back to an empty-string HMAC key (which HMAC accepts and would be a well-known,
// trivially-forgeable key). That means every login and every already-issued cookie stops
// working the moment this ships until `wrangler secret put SESSION_SECRET` is run — a
// deliberate, one-time, whole-app outage rather than a silent downgrade. Shipped on a day
// nobody is expected to be logged in, by explicit choice, rather than threading a
// dual-key accept-either transition through this file.
async function sessionSigningKey(env, usage) {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET not configured');
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, [usage]
  );
}
//
// Session behavior:
//   - A desktop/laptop session (any role but member) is a plain session cookie (no Expires)
//     that dies on browser close, with an IDLE_TIMEOUT_MS idle window. A member, or anyone on
//     a phone (see isPhoneUserAgent below), gets a persistent cookie on the longer window
//     instead — see PERSISTENT_IDLE_TIMEOUT_MS.
//   - The ts embedded in the cookie is the LAST activity time; it's refreshed
//     on every authenticated request via `refreshAuthCookie` wrapper in the
//     worker entry. If no request arrives within the applicable idle window, the cookie
//     is rejected and the user is forced back to the login page.
export const IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours

// True for a phone-shaped User-Agent (iPhone/iPod/Android Mobile/Windows Phone). A phone is a
// personal device carried in a pocket, not a shared office terminal, so it gets the same
// "don't make me log in every time" treatment as the member tier below, regardless of role —
// reported directly: staff opening the app on their own phone had to sign back in on
// essentially every visit, which is not how an app on a personal device behaves. Defined once
// here (not duplicated in tlc-volunteer-worker.js, which also uses it to pick the mobile vs.
// desktop shell) so the two can't drift apart.
export function isPhoneUserAgent(req) {
  const ua = req.headers.get('User-Agent') || '';
  return /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua);
}

// Members, and anyone on a phone, get a much longer, *persistent* session than staff on a
// desktop or laptop. Two different jobs:
//
//   staff/office/finance/admin on a desktop or laptop — a shared office computer, giving
//     records, member PII, financial reports. A short idle window and a cookie that dies
//     with the browser is the right posture and stays unchanged there.
//
//   anyone on a phone (any role) — a personal device, not shared, not left logged in on a
//     public terminal. Same reasoning as member below: a session cookie plus an 8-hour
//     window means logging in on essentially every visit, which is the thing that kills
//     "use it like an app" on a phone outright.
//
//   member specifically — a read-only, self-redacting directory view (see memberSafeView in
//     api-people.js), often opened for fifteen seconds from a Tithe.ly Church App weblink
//     tab. Gets the long window on every device, not just a phone — a member's own laptop
//     carries no more access than their phone does, so there's no reason to treat it
//     differently.
//
// The phone signal is read from the CURRENT request's User-Agent, not baked into the cookie,
// so a cookie minted on a phone is still only honored for the short window if it somehow shows
// up on a request from a desktop browser, and a staff cookie that starts out on a desktop
// picks up the long window (via refreshAuthCookie's per-request re-mint) the moment it's used
// from a phone instead — no separate "remember this device" step needed.
//
// The longer window changes only HOW LONG a valid, unexpired-by-activity cookie is honored —
// not WHAT it can do (full role permissions either way, same as an 8-hour cookie already
// grants). Revocation is unaffected: _resolveAuthInfo live-checks app_users.active/.role on
// every single request, so deactivating or demoting someone kills their session on the very
// next request no matter how long the cookie is nominally good for.
export const PERSISTENT_IDLE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Idle window for a session: the long, persistent window for a member (any device) or
 *  anyone on a phone (any role); the short, browser-close-scoped window for everyone else. */
export function idleTimeoutFor(role, isMobile) {
  return (role === 'member' || isMobile) ? PERSISTENT_IDLE_TIMEOUT_MS : IDLE_TIMEOUT_MS;
}

// ── Hostname helpers ────────────────────────────────────────────────
// The app is served at the ROOT path on connect.timothystl.org, but at /chms on every
// other host (staging, workers.dev). Anything that redirects a browser *into* the app has
// to pick the right one, and the cost of getting it wrong is silent: the user lands on a
// path that still works, so nothing errors — they just never end up on the canonical URL,
// and /chms is what accumulates in their history and bookmarks.
//
// This lives here, in the module both the worker entry and api-admin.js already depend on,
// specifically so the hostname is stated ONCE. The CONN6 rename (chms.timothystl.org →
// connect.timothystl.org, app moved from /chms to /) had to update every redirect
// individually, and the post-login redirect in handleAdminLogin was missed for ~12 days
// because the knowledge was spread across two files with no shared definition.
export const CONNECT_HOST = 'connect.timothystl.org';

/** True when this request arrived on the hostname that serves the app at `/`. */
export function isConnectHost(reqOrUrl) {
  try {
    const u = typeof reqOrUrl === 'string' ? new URL(reqOrUrl)
      : reqOrUrl instanceof URL ? reqOrUrl
      : new URL(reqOrUrl.url);
    return u.hostname === CONNECT_HOST;
  } catch { return false; }
}

/** The in-app landing path for this request's host: `/` on Connect, `/chms` elsewhere. */
export function appRootPath(reqOrUrl) {
  return isConnectHost(reqOrUrl) ? '/' : '/chms';
}

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
  // The device signal comes from THIS request, not the cookie, so it can't be forged by
  // editing the cookie (see isPhoneUserAgent's comment above).
  const isMobile = isPhoneUserAgent(req);
  // First gate uses the role claimed by the cookie. That claim is trustworthy *as a claim*
  // — it's covered by the HMAC below, so it can't be edited to buy a longer window without
  // invalidating the signature. It is not necessarily the user's CURRENT role, though, so
  // the effective role gets re-checked against its own window after the DB lookup.
  const age = Date.now() - parseInt(ts, 10);
  if (age > idleTimeoutFor(role, isMobile)) return null;
  try {
    // Throws if SESSION_SECRET is unset — caught below, same as any other verify failure,
    // which is exactly the fail-closed behavior wanted here (never falls back to a
    // well-known empty-string key).
    const key = await sessionSigningKey(env, 'verify');
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
    // Re-gate against the CURRENT role's window. Without this, a member promoted to staff
    // would keep riding their old 30-day member cookie while holding staff permissions —
    // the authorization below correctly uses the new role, so the session lifetime has to
    // tighten with it. Always re-checked (not just on a role change) so the two can't drift.
    if (age > idleTimeoutFor(dbUser.role, isMobile)) return null;
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
// Throws if SESSION_SECRET is unset — callers that mint a fresh cookie from a login handler
// need to catch this and show an operator-facing message; refreshAuthCookie's caller never
// hits it in practice (see its own comment).
export async function authCookieHeader(env, role = 'admin', username = '', isMobile = false) {
  const ts = Date.now().toString();
  const safeUser = username.replace(/[^a-zA-Z0-9_-]/g, '');
  const payload = safeUser ? `${ts}.${role}.${safeUser}` : `${ts}.${role}`;
  const key = await sessionSigningKey(env, 'sign');
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const b64url = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const cookieVal = safeUser ? `${ts}.${role}.${safeUser}.${b64url}` : `${ts}.${role}.${b64url}`;
  // Members (any device) and anyone on a phone get Max-Age so the cookie survives the
  // browser/webview closing; a desktop/laptop session for every other role stays a session
  // cookie that dies on close. Without Max-Age a Tithe.ly Church App weblink tab (or any
  // in-app mobile browser) drops the cookie the moment the view is dismissed, so staff on
  // their own phone would re-authenticate on essentially every visit — the same problem the
  // member tier already had. Max-Age is re-sent on each request by refreshAuthCookie, so the
  // window slides forward with use rather than expiring at a fixed wall-clock time from first
  // login.
  const maxAge = (role === 'member' || isMobile)
    ? `; Max-Age=${Math.floor(PERSISTENT_IDLE_TIMEOUT_MS / 1000)}` : '';
  // SameSite=Lax (not Strict): the QuickBooks OAuth callback (FIN1) lands back on this app via
  // a cross-site-initiated top-level GET redirect from Intuit's consent screen — SameSite=Strict
  // silently drops the cookie on exactly that kind of request, breaking the whole connect flow.
  // Lax still blocks the cookie on cross-site subresource/POST requests (the real CSRF risk);
  // the OAuth flow itself is separately CSRF-protected via the single-use `state` parameter.
  return `vol_auth=${cookieVal}; Path=/; HttpOnly; Secure; SameSite=Lax${maxAge}`;
}

// Wrap an authenticated response with a refreshed Set-Cookie so the idle
// timeout rolls forward with activity. Skips refresh if the response is
// already setting vol_auth (login/logout handle their own cookie).
// `req` (optional) supplies the device signal for the persistent-window decision — omitting
// it just means the refreshed cookie falls back to the short desktop window, never the wrong
// direction (a phone-carried cookie losing its persistence is the safe failure here, not a
// desktop cookie gaining 30 days it shouldn't have).
export async function refreshAuthCookie(response, authInfo, env, req) {
  if (!authInfo || !response) return response;
  const existing = response.headers.get('Set-Cookie') || '';
  if (existing.includes('vol_auth=')) return response;
  // Every versioned asset route (app-core.js/app-ext.js/app.css/scheduler-embed.*) answers
  // `Cache-Control: public, max-age=31536000, immutable` so Cloudflare's edge can cache it —
  // but a response carrying Set-Cookie is never edge-cached at all, silently defeating that,
  // and it puts a session cookie on a response any intermediate cache is invited to store.
  // A public/immutable response never needs the idle-timeout cookie refresh anyway (its own
  // request already carried a fresh cookie in, if any) — skip the wrapper entirely for these.
  const cacheControl = response.headers.get('Cache-Control') || '';
  if (/\bpublic\b/.test(cacheControl) && /\bimmutable\b/.test(cacheControl)) return response;
  // authInfo non-null here means getAuthInfo already verified a cookie against SESSION_SECRET
  // moments ago in the same request, so this can't throw in practice — but a refresh failing
  // should never turn an otherwise-good response into a 500, so fall back to the unrefreshed
  // response rather than let a thrown error propagate up to the worker's top-level catch.
  let newCookie;
  try {
    newCookie = await authCookieHeader(env, authInfo.role, authInfo.username, req ? isPhoneUserAgent(req) : false);
  } catch {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', newCookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// ── SHARED-SECRET COMPARISON ────────────────────────────────────────
// A plain `a !== b` on a shared API key leaks its length and lets a byte-by-byte
// timing attack narrow it down one position at a time. Hashing both sides first
// (SHA-256, fixed-length digest either way) and XOR-accumulating every byte with
// no early exit removes both the length signal and the position signal — the
// standard constant-time-compare pattern, using only Web Crypto (no Node-only
// crypto.timingSafeEqual, which Workers doesn't guarantee). Used for the two
// server-to-server shared secrets in this app (X-Intake-Key, ADMIN_PUSH_API_KEY)
// — not for user passwords, which already go through PBKDF2 below.
export async function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a || '')),
    crypto.subtle.digest('SHA-256', enc.encode(b || '')),
  ]);
  const bufA = new Uint8Array(digestA), bufB = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
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
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...SEC_HEADERS, ...extraHeaders }
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
