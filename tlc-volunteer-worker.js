// Timothy Lutheran Church — Volunteer Sign-Up Worker
// Deploy to: serve.timothystl.org (renamed 2026-07-20 from volunteer.timothystl.org — full
// cutover, old hostname no longer resolves)
// Admin at: connect.timothystl.org (renamed 2026-07-22 from chms.timothystl.org, which
// still resolves and 301-redirects here for old bookmarks)
// Admin password is set via ADMIN_PASSWORD environment variable in Cloudflare Dashboard.
// v2 — modular build (src/)

// ── Imports ────────────────────────────────────────────────────────────────────
import { html, json, isAuthed, getAuthInfo, getAuthRole, refreshAuthCookie, SCHED_CORS, isConnectHost, appRootPath } from './src/auth.js';
import { initDb } from './src/db.js';
import { LCMS_CALENDAR_JSON } from './src/lectionary.js';
import {
  handleApiEvents, handleSignup, handleCalendar,
  handleVolunteerPending, handleVolunteerGeneralPending, handleVolunteerEventPending,
  handleSchedEmailSend, handleSchedRsvpStore, handleSchedRsvpSync, handleEsvPassage,
  handleSchedRsvpPortal, handleSchedRsvp, handleSchedBreezeProxy,
  handleChristmasMarketSummary,
} from './src/api-scheduler.js';
import { handleAdminLogin, handleAdminApi, handleForgotPassword, handleResetPassword, handleApiMinistryRoles } from './src/api-admin.js';
import { handleIntakeApi } from './src/api-intake.js';
import { handleMemberSetup } from './src/api-people.js';
import { LOGIN_HTML, PUBLIC_HTML } from './src/html-templates.js';
import { chmsHtmlForRole, CHMS_MANIFEST_JSON, SW_JS, BACKLOG_HTML, CHMS_APP_MEMBER_JS, CHMS_APP_STAFF_JS, CHMS_APP_EXT_JS, CHMS_APP_CSS, CHMS_SCHEDULER_HTML, CHMS_SCHEDULER_JS } from './src/html-chms.js';
import { DEPLOY_VERSION } from './src/frontend/js-core.js';
import { PRIVACY_HTML, TERMS_HTML } from './src/legal-pages.js';
import { sendBirthdayEmails, sendAnniversaryEmails, sendBirthdayTexts, sendAnniversaryTexts, centralDayOfWeek } from './src/api-emails.js';
import { sendWebPush } from './src/push-sender.js';
import { notifyAdminPush } from './src/api-scheduler.js';

// Key prefixes the /admin/r2photo/ proxy is allowed to serve. The R2 bucket is shared with
// non-photo objects (branding assets, and per the backup runbook, full D1 SQL dumps under
// backups/), so the proxy must never take an arbitrary caller-supplied key.
const R2_PHOTO_PREFIXES = ['people/', 'households/', 'branding/'];

// ── MAIN FETCH HANDLER ────────────────────────────────────────────────
export default {
  async fetch(req, env) {
    try {
      // Check auth once up front so we can refresh the cookie on every
      // authenticated response (sliding idle timeout). Re-parsing inside
      // handlers via isAuthed() is cheap (HMAC verify on a short string).
      const authInfo = await getAuthInfo(req, env).catch(() => null);
      const response = await _fetch(req, env);
      return await refreshAuthCookie(response, authInfo, env);
    } catch (e) {
      // Last-resort catch: prevents Cloudflare from returning its HTML error page.
      // All internal handlers have their own try/catch; this only fires for truly
      // unexpected exceptions (e.g. a broken env binding, or a very rare V8 crash).
      console.error('Unhandled worker exception:', e?.message, e?.stack);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try { await initDb(env.DB); } catch (e) { console.error('Cron DB init error:', e.message); return; }
      const [bday, ann, bdaySms, annSms, prune, schedPush, unfilledPush] = await Promise.all([
        sendBirthdayEmails(env).catch(e => ({ error: e.message })),
        sendAnniversaryEmails(env).catch(e => ({ error: e.message })),
        sendBirthdayTexts(env).catch(e => ({ error: e.message })),
        sendAnniversaryTexts(env).catch(e => ({ error: e.message })),
        pruneAuditLog(env.DB).catch(e => ({ error: e.message })),
        sendScheduleReminders(env).catch(e => ({ error: e.message })),
        checkUnfilledShifts(env).catch(e => ({ error: e.message })),
      ]);
      console.log('Daily cron:', JSON.stringify({ birthdays: bday, anniversaries: ann, birthday_sms: bdaySms, anniversary_sms: annSms, audit_prune: prune, schedule_push: schedPush, unfilled_shifts_push: unfilledPush }));
    })());
  },
};

async function pruneAuditLog(db) {
  // Email/SMS dedup entries only need to exist for the same day — purge after 60 days.
  const r1 = await db.prepare(
    `DELETE FROM audit_log
     WHERE action IN ('birthday_email_sent','anniversary_email_sent','birthday_sms_sent','anniversary_sms_sent')
       AND ts < datetime('now','-60 days')`
  ).run();
  // All other audit entries kept for 1 year (covers financial / destructive actions).
  const r2 = await db.prepare(
    `DELETE FROM audit_log
     WHERE action NOT IN ('birthday_email_sent','anniversary_email_sent','birthday_sms_sent','anniversary_sms_sent')
       AND ts < datetime('now','-365 days')`
  ).run();
  return { email_dedup_deleted: r1.meta?.changes ?? 0, general_deleted: r2.meta?.changes ?? 0 };
}

// Send push notifications to members assigned to serve tomorrow.
// Only sends on Saturdays (day 6) — reminding about Sunday assignments.
async function sendScheduleReminders(env) {
  // Only run on Saturdays in Central time (cron fires at 14:00 UTC daily).
  const now = new Date();
  if (centralDayOfWeek(now) !== 6) return { skipped: 'not Saturday' };
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return { skipped: 'no VAPID keys' };
  if (!env.RSVP_STORE) return { skipped: 'no KV store' };

  // Next Sunday's ISO date in Central time.
  const tomorrowISO = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  // Fetch schedule from KV
  let schedule = [];
  try {
    const raw = await env.RSVP_STORE.get('ws_schedule_v2');
    if (raw) schedule = JSON.parse(raw);
  } catch { return { skipped: 'KV error' }; }

  if (!Array.isArray(schedule)) return { skipped: 'no schedule data' };

  // Collect breeze_ids assigned on that Sunday
  const assignedIds = new Set();
  for (const row of schedule) {
    const dateISO = (typeof row.date === 'string' ? row.date : new Date(row.date).toISOString()).slice(0, 10);
    if (dateISO !== tomorrowISO) continue;
    if (row.type === 'sunday') {
      for (const svcs of Object.values(row.assignments || {})) {
        for (const pid of Object.values(svcs || {})) {
          if (pid) assignedIds.add(String(pid));
        }
      }
    }
  }

  if (!assignedIds.size) return { sent: 0, skipped: 'no assignments tomorrow' };

  // Find member-portal users who have a push subscription AND a breeze_id in assignedIds
  const candidates = await env.DB.prepare(
    "SELECT u.push_subscription, p.first_name, p.breeze_id FROM app_users u JOIN people p ON p.id=u.people_id WHERE u.push_subscription!='' AND u.active=1 AND p.breeze_id!='' AND p.status='active'"
  ).all();

  let sent = 0, failed = 0;
  for (const row of (candidates.results || [])) {
    if (!assignedIds.has(row.breeze_id)) continue;
    let sub;
    try { sub = JSON.parse(row.push_subscription); } catch { continue; }
    if (!sub?.endpoint) continue;

    const result = await sendWebPush(sub, {
      title: 'Reminder: You\'re serving tomorrow!',
      body: 'Hi ' + (row.first_name || 'there') + ', you have a volunteer assignment this Sunday. See you at church!',
      url: '/',
      tag: 'schedule-reminder-' + tomorrowISO,
    }, env).catch(() => ({ ok: false }));

    if (result.ok) sent++; else failed++;
  }

  return { sent, failed };
}

// Push an admin-facing summary when an upcoming Sunday (within the next 7
// days) still has an open assignment slot. Runs off the same daily cron and
// the same `ws_schedule_v2` KV blob as sendScheduleReminders — that blob is
// the only place "who's assigned to what" lives server-side. **Deliberately
// does NOT cover "unconfirmed"** (an assignment made but not yet RSVP'd) —
// RSVP status lives in per-token records in RSVP_STORE with no index/prefix
// linking a token back to its schedule row, so there's no reliable way to
// enumerate "still-pending" responses from the Worker side without adding a
// whole new indexing scheme. Confirm/decline pushes (see handleSchedRsvp)
// cover the moment a volunteer DOES respond; a stale, never-responded
// assignment is a gap left for a future pass if it turns out to matter.
// Fires once/day while any slot for the coming week is open — not deduped
// beyond that, so it repeats daily until filled, same as a real to-do would.
async function checkUnfilledShifts(env) {
  if (!env.RSVP_STORE) return { skipped: 'no KV store' };
  let schedule = [];
  try {
    const raw = await env.RSVP_STORE.get('ws_schedule_v2');
    if (raw) schedule = JSON.parse(raw);
  } catch { return { skipped: 'KV error' }; }
  if (!Array.isArray(schedule)) return { skipped: 'no schedule data' };

  const now = new Date();
  const todayISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now);
  const weekOutISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' })
    .format(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));

  const openDates = new Set();
  for (const row of schedule) {
    if (row.type !== 'sunday') continue;
    const dateISO = (typeof row.date === 'string' ? row.date : new Date(row.date).toISOString()).slice(0, 10);
    if (dateISO < todayISO || dateISO > weekOutISO) continue;
    for (const svcs of Object.values(row.assignments || {})) {
      if (Object.values(svcs || {}).some((pid) => !pid)) { openDates.add(dateISO); break; }
    }
  }
  if (!openDates.size) return { open: 0 };

  await notifyAdminPush(env, {
    title: 'Open worship service slots',
    body: openDates.size === 1
      ? 'One Sunday in the next week still has an open role to fill.'
      : openDates.size + ' Sundays in the next week still have an open role to fill.',
    tag: 'connect-unfilled',
    url: '/#scheduler',
  });
  return { open: openDates.size };
}

// The exact set of paths whose real (non-OPTIONS) handlers emit SCHED_CORS — see CR7(b)
// above. `/scheduler*` is deliberately excluded: it's cookie-auth-only and never emits
// SCHED_CORS on any of its responses (LCMS calendar JSON or the retired-page redirect).
// ⚠ `/api/*` needs its own exclusion list, not just `/api/events` — several `/api/*`
// sub-routes (ministry-roles, the Christmas Market summary, everything under
// `/api/intake/`) are matched ABOVE the generic breeze-proxy catch-all below and never
// reach it, so they never emit SCHED_CORS either (confirmed against a verification
// harness that caught `/api/intake/funds` being wrongly included on the first pass).
function isSchedCorsPath(path) {
  if (path === '/rsvp' || path.startsWith('/rsvp/portal') || path === '/rsvp/store' || path === '/rsvp/sync') return true;
  if (path === '/serve/pending' || path === '/serve/general-pending' || path === '/serve/event-pending') return true;
  if (path === '/volunteer/pending' || path === '/volunteer/general-pending' || path === '/volunteer/event-pending') return true;
  if (path === '/email/send' || path === '/esv/passage') return true;
  if (path.startsWith('/breeze/')) return true;
  if (path.startsWith('/api/')) {
    if (path === '/api/events' || path === '/api/ministry-roles') return false;
    if (path === '/api/signups/christmasmarket/summary') return false;
    if (path.startsWith('/api/intake/')) return false;
    return true;
  }
  return false;
}

async function _fetch(req, env) {
    try {
      await initDb(env.DB);
    } catch (e) {
      return new Response('DB init error: ' + e.message, { status: 500 });
    }

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const method = req.method.toUpperCase();
    const host = url.hostname;
    // Connect (2026-07-22) — connect.timothystl.org replaced chms.timothystl.org as the
    // single hostname for the whole app (staff and members alike); role='member' accounts
    // are limited to a filtered read-only view by the existing role-based tab-hiding in the
    // frontend, not by a separate hostname (an earlier two-host design, Phase 1, was tried
    // and dropped in favor of this simpler single-host approach — see CLAUDE.md). The old
    // chms.timothystl.org hostname is kept alive below purely to 301-redirect bookmarks.
    const isChmsHost = isConnectHost(url);
    const isLegacyChmsHost = host === 'chms.timothystl.org';

    // CORS preflight for scheduler backend routes only (CR7(b)) — this used to answer
    // OPTIONS on every path in the app with Access-Control-Allow-Origin: '*', which is
    // wider than any of those other routes ever needed: none of them echo SCHED_CORS on
    // their real (non-OPTIONS) response, so a preflight succeeding for them was already
    // useless — the actual request would arrive with no CORS headers and fail cross-origin
    // regardless. Narrowed to the exact set of paths whose real handlers do emit SCHED_CORS
    // (schedJson()/schedHtmlPage() in src/api-scheduler.js) — kept in sync with the route
    // matches below by hand, since there's no single dispatch table to derive it from.
    if (req.method === 'OPTIONS' && isSchedCorsPath(path)) {
      return new Response(null, { status: 204, headers: SCHED_CORS });
    }

    if (path === '/favicon.svg' && method === 'GET') {
      const fRes = await fetch('https://raw.githubusercontent.com/timothystl/chms/main/favicon.svg?v=' + DEPLOY_VERSION, { cf: { cacheEverything: true, cacheTtl: 86400 } });
      return new Response(fRes.ok ? fRes.body : '', { status: fRes.ok ? 200 : 404, headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
    }
    // App icons (Connect mark) — proxied from the repo so they update on deploy.
    // The ?v= is load-bearing: Cloudflare keys the subrequest cache on the upstream URL, so
    // without it a redeploy keeps serving the previously cached artwork for the full 24h TTL.
    if (path.startsWith('/icons/') && method === 'GET') {
      const m = path.match(/^\/icons\/(icon-(?:16|32|180|192|512|512-maskable)\.png|connect-(?:mark|lockup)\.png)$/);
      if (m) {
        const fRes = await fetch('https://raw.githubusercontent.com/timothystl/chms/main/icons/' + m[1] + '?v=' + DEPLOY_VERSION, { cf: { cacheEverything: true, cacheTtl: 86400 } });
        const ct = m[1].endsWith('.svg') ? 'image/svg+xml' : 'image/png';
        return new Response(fRes.ok ? fRes.body : '', { status: fRes.ok ? 200 : 404, headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400' } });
      }
    }
    // Self-hosted TinyMCE (giving-letter template editors) — same proxy-from-repo pattern as
    // /icons/ above, so the editor loads same-origin under the existing CSP (script-src 'self')
    // with no third-party CDN and no tiny.cloud API key. Files live in vendor/tinymce/ in this
    // repo (a hand-picked minimal subset of the npm package — core/model/theme/icons/oxide skin
    // + lists/image/link/code plugins only, not the full ~12MB package).
    if (path.startsWith('/admin/vendor/tinymce/') && method === 'GET') {
      const rel = path.slice('/admin/vendor/tinymce/'.length);
      if (!/^[\w./-]+\.(js|css)$/.test(rel) || rel.includes('..')) return new Response('Not found', { status: 404 });
      const fRes = await fetch('https://raw.githubusercontent.com/timothystl/chms/main/vendor/tinymce/' + rel, { cf: { cacheEverything: true, cacheTtl: 86400 } });
      const ct = rel.endsWith('.css') ? 'text/css' : 'application/javascript';
      return new Response(fRes.ok ? fRes.body : '', { status: fRes.ok ? 200 : 404, headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400' } });
    }
    // Public site header/drawer logo — proxied + cached the same way, instead of inlining
    // ~115KB of base64 into every page's HTML.
    if (path === '/header-logo.png' && method === 'GET') {
      const fRes = await fetch('https://raw.githubusercontent.com/timothystl/chms/main/header-logo.png', { cf: { cacheEverything: true, cacheTtl: 86400 } });
      return new Response(fRes.ok ? fRes.body : '', { status: fRes.ok ? 200 : 404, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
    }
    // Public privacy policy / terms of use — no auth required. Referenced from third-party
    // integration setup (e.g. QuickBooks Online's app registration form requires these URLs).
    if (path === '/privacy' && method === 'GET') return html(PRIVACY_HTML);
    if (path === '/terms' && method === 'GET') return html(TERMS_HTML);
    // Old chms.timothystl.org hostname → 301 to connect.timothystl.org (page views only,
    // same treatment volunteer.timothystl.org→serve.timothystl.org would have gotten had
    // that rename needed a hostname redirect — this one does, since staff have
    // chms.timothystl.org bookmarked).
    if (isLegacyChmsHost && method === 'GET' && (path === '/' || path === '/index.html' || path === '/chms')) {
      return new Response(null, { status: 301, headers: { 'Location': 'https://connect.timothystl.org' + url.search } });
    }
    if ((path === '/' || path === '/index.html') && method === 'GET') {
      if (isChmsHost) {
        const auth = await getAuthInfo(req, env);
        if (!auth) return html(LOGIN_HTML);
        return html(chmsHtmlForRole(auth.role), 200, { 'Cache-Control': 'no-store, no-cache, must-revalidate' });
      }
      return html(PUBLIC_HTML);
    }
    if (path === '/api/events' && method === 'GET') return handleApiEvents(env);
    if (path === '/api/ministry-roles' && method === 'GET') return handleApiMinistryRoles(env, url);
    // Renamed 2026-07-20 to /serve/* (matching the serve.timothystl.org brand); the old
    // /volunteer/* paths are kept working indefinitely as aliases — nothing shared them
    // externally, but there's no reason to break an already-open browser tab that hasn't
    // refetched PUBLIC_HTML/the scheduler bundle yet.
    if ((path === '/serve/signup' || path === '/volunteer/signup') && method === 'POST') {
      try {
        return await handleSignup(req, env);
      } catch (e) {
        console.error('Signup error:', e);
        return json({ ok: false, error: 'Server error. Please try again or contact the church office.' }, 500);
      }
    }
    if ((path.match(/^\/serve\/calendar\/\d+$/) || path.match(/^\/volunteer\/calendar\/\d+$/)) && method === 'GET') return handleCalendar(env, path);
    if (path === '/admin/login' && method === 'POST') return handleAdminLogin(req, env);
    if (path === '/admin/forgot-password' && method === 'POST') return handleForgotPassword(req, env);
    if (path === '/admin/reset' && (method === 'GET' || method === 'POST')) return handleResetPassword(req, env, url);
    // Connect member invite setup (Phase 2) — public, token-gated, same pattern as
    // /admin/reset above.
    if (path === '/member-setup' && (method === 'GET' || method === 'POST')) return handleMemberSetup(req, env, url);
    if (path === '/admin/logout') {
      return new Response(null, { status: 302, headers: {
        'Location': isChmsHost ? '/' : '/admin',
        'Set-Cookie': 'vol_auth=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict'
      }});
    }
    if (path === '/admin' && method === 'GET') {
      if (!await isAuthed(req, env)) return html(LOGIN_HTML);
      return new Response(null, { status: 302, headers: { 'Location': appRootPath(url) } });
    }
    // Permanent redirect: old serve.timothystl.org/chms (or any other non-primary host) → connect.timothystl.org
    if (!isChmsHost && !isLegacyChmsHost && path === '/chms' && method === 'GET') {
      return new Response(null, { status: 301, headers: { 'Location': 'https://connect.timothystl.org' } });
    }
    // Note: the standalone /portal member system (separate tlc-member cookie, its own
    // SPA) was retired 2026-07-20 in favor of the tiered role='member' login on
    // connect.timothystl.org above — see CLAUDE.md's Connect Phase 1 entry. Its source
    // (src/api-member.js, portal-html.js, portal-sw-js.js) is kept unimported/unrouted
    // rather than deleted, since its invite-token/email-verification logic is meant to
    // be adapted for the real member-tier invite flow in Phase 2.
    // Public intake endpoints (gated by X-Intake-Key header, NOT user session).
    // Called server-to-server from the timothystl.org admin worker.
    // Read-only Christmas Market signup summary for the website repo's admin
    // (admin.timothystl.org → Christmas Market → Volunteers). Same X-Intake-Key
    // shared secret as /api/intake/* — see handleChristmasMarketSummary. Must stay
    // ABOVE the /api/* Breeze-proxy catch-all further down or it never matches.
    if (path === '/api/signups/christmasmarket/summary' && method === 'GET') {
      try {
        return await handleChristmasMarketSummary(req, env);
      } catch (e) {
        console.error('Market summary error:', e?.message, e?.stack);
        return json({ error: 'Internal server error' }, 500, { 'Cache-Control': 'no-store' });
      }
    }
    if (path.startsWith('/api/intake/')) {
      try {
        return await handleIntakeApi(req, env, path);
      } catch (e) {
        console.error('Intake API error [' + method + ' ' + path + ']:', e?.message, e?.stack);
        return json({ error: 'Internal server error' }, 500);
      }
    }
    if (path.startsWith('/admin/api/')) {
      if (!await isAuthed(req, env)) return json({ error: 'Unauthorized' }, 401);
      try {
        return await handleAdminApi(req, env, url, method);
      } catch (e) {
        // Log full detail server-side, never expose internals to the client
        console.error('Admin API error [' + method + ' ' + path + ']:', e?.message, e?.stack);
        return json({ error: 'Internal server error. Please try again.' }, 500);
      }
    }
    // ── ChMS (People & Giving) ─────────────────────────────────────────
    // Serve at root on connect.timothystl.org, or at /chms on any host (staging, etc.)
    if ((path === '/chms' || (isChmsHost && path === '/')) && method === 'GET') {
      const auth = await getAuthInfo(req, env);
      if (!auth) return html(LOGIN_HTML);
      if (auth.role === 'member') {
        return new Response(null, { status: 302, headers: { 'Location': 'https://connect.timothystl.org/' } });
      }
      return html(chmsHtmlForRole(auth.role), 200, { 'Cache-Control': 'no-store, no-cache, must-revalidate' });
    }
    if (path === '/chms.webmanifest') {
      return new Response(CHMS_MANIFEST_JSON, {
        headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=86400' }
      });
    }
    // ── ChMS app JS — split out of CHMS_HTML so the browser can cache it across page loads
    // instead of re-downloading ~968KB on every single visit (CHMS_HTML itself stays
    // no-store, since it's the auth-gated per-user shell). No auth check needed: this is
    // client-side UI code only, no secrets or data — same security model as the manifest and
    // service worker above. The ?v= query param is DEPLOY_VERSION, so a version bump busts this
    // cache automatically; `immutable` tells the browser to skip revalidation entirely for the
    // life of that version.
    // ── Versioned-asset cache policy ────────────────────────────────────────────────
    // These assets are cached for a year as `immutable`, keyed by ?v=DEPLOY_VERSION. That is
    // correct once a deploy has fully rolled out — but Cloudflare rolls out per-colo, so during
    // the window there are edges still running the PREVIOUS worker. If one of them answers a
    // request for the NEW ?v= value, its stale body gets pinned under the new URL as immutable,
    // and every later request for that version gets last version's asset. For a year.
    //
    // That is not hypothetical: it happened on the v1.126.0 and v1.127.0 deploys (see NOTES.md),
    // where app.css?v=<new> served the previous stylesheet while a throwaway probe URL returned
    // the correct one. Any user who loads the page mid-rollout can do the same to their own edge.
    //
    // Fix: only allow caching when the version being asked for is the version this worker
    // actually IS. A mismatch in either direction means the body cannot be correct for that URL,
    // so it must not be stored. Once the rollout completes, every request matches and normal
    // long-lived caching resumes with no other change.
    const assetCacheControl = () =>
      url.searchParams.get('v') === DEPLOY_VERSION
        ? 'public, max-age=31536000, immutable'
        : 'no-store';

    // app-member.js is what a member session gets on its own; every other role gets it plus
    // app-staff.js and app-ext.js. Together the first two are the old app-core.js, which no
    // longer has a route — nothing has ever linked to it but this worker, and the shell that
    // referenced it is served no-store, so there is no stale page that could still ask for it.
    if (path === '/admin/app-member.js') {
      return new Response(CHMS_APP_MEMBER_JS, {
        headers: { 'Content-Type': 'application/javascript', 'Cache-Control': assetCacheControl() }
      });
    }
    if (path === '/admin/app-staff.js') {
      return new Response(CHMS_APP_STAFF_JS, {
        headers: { 'Content-Type': 'application/javascript', 'Cache-Control': assetCacheControl() }
      });
    }
    if (path === '/admin/app-ext.js') {
      return new Response(CHMS_APP_EXT_JS, {
        headers: { 'Content-Type': 'application/javascript', 'Cache-Control': assetCacheControl() }
      });
    }
    // ── ChMS app CSS + lazy-loaded Scheduler embed — same rationale and same caching model
    // as the two app JS routes above: static client-side UI with no secrets or data, pulled
    // out of the no-store shell so the browser can keep it across page loads.
    if (path === '/admin/app.css') {
      return new Response(CHMS_APP_CSS, {
        headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': assetCacheControl() }
      });
    }
    if (path === '/admin/scheduler-embed.html') {
      // Fetched by js-core.js and injected into #tab-scheduler. nosniff + DENY are set
      // explicitly here (the raw asset routes bypass the html()/json() helpers that would
      // normally apply SEC_HEADERS) since unlike the JS/CSS routes this one is markup a
      // browser would happily render if navigated to directly.
      return new Response(CHMS_SCHEDULER_HTML, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
        }
      });
    }
    if (path === '/admin/scheduler-embed.js') {
      return new Response(CHMS_SCHEDULER_JS, {
        headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=31536000, immutable' }
      });
    }
    if (path === '/admin/backlog' && method === 'GET') {
      // Admin-only, matching the GET/POST /admin/api/board endpoints this page talks to.
      // Previously any authenticated role (including member) could load the page; the data
      // calls behind it still 403'd, so this just aligns the page with its own API.
      const backlogAuth = await getAuthInfo(req, env);
      if (!backlogAuth) return html(LOGIN_HTML);
      if (backlogAuth.role !== 'admin') return html('<h1>Not found</h1>', 404);
      return html(BACKLOG_HTML, 200, { 'Cache-Control': 'no-store, no-cache, must-revalidate' });
    }
    // ── Letterhead logo — deliberately UNAUTHENTICATED, unlike /admin/r2photo/ below. Shown at
    // the top of giving letters; outbound HTML emails need a real fetchable image URL since
    // an email client can't attach a session cookie. Just a logo, no sensitive data, so the
    // lack of auth here is intentional, not an oversight. Uploaded via the admin-gated
    // POST/DELETE /admin/api/config/letterhead-logo (src/api-import.js).
    if (path === '/admin/letterhead-logo' && method === 'GET') {
      const row = await env.DB.prepare("SELECT value FROM chms_config WHERE key='letterhead_logo_ext'").first();
      if (!row?.value || !env.PHOTOS) return new Response('Not found', { status: 404 });
      const obj = await env.PHOTOS.get(`branding/letterhead-logo.${row.value}`);
      if (!obj) return new Response('Not found', { status: 404 });
      const ctMap = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
      return new Response(obj.body, {
        headers: { 'Content-Type': ctMap[row.value] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' }
      });
    }
    // ── R2 photo serve — requires auth ───────────────────────────────
    if (path.startsWith('/admin/r2photo/') && method === 'GET') {
      if (!await isAuthed(req, env)) return new Response('Unauthorized', { status: 401 });
      if (!env.PHOTOS) return new Response('Photo storage not configured', { status: 503 });
      const r2Key = decodeURIComponent(path.slice('/admin/r2photo/'.length));
      if (!r2Key) return new Response('Missing key', { status: 400 });
      // Restrict to the prefixes this app actually writes photos under (see api-people.js /
      // api-import.js). Without this the proxy hands ANY authenticated caller — including a
      // role='member' directory account, the lowest tier — any object in the bucket by key,
      // and the documented D1 backup runbook stores full database dumps in this same bucket
      // under backups/ (see CLAUDE.md "D1 Backup & Restore", Option 3).
      if (!R2_PHOTO_PREFIXES.some(p => r2Key.startsWith(p))) {
        return new Response('Not found', { status: 404 });
      }
      const obj = await env.PHOTOS.get(r2Key);
      if (!obj) return new Response('Not found', { status: 404 });
      return new Response(obj.body, {
        headers: {
          'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
          'Cache-Control': 'private, max-age=86400',
        }
      });
    }

    // ── Breeze photo proxy — requires auth, forwards to Breeze CDN with API key ──
    if (path === '/admin/photo-proxy' && method === 'GET') {
      if (!await isAuthed(req, env)) return json({ error: 'Unauthorized' }, 401);
      const photoUrl = url.searchParams.get('url');
      if (!photoUrl) return json({ error: 'url param required' }, 400);
      // Only proxy HTTPS URLs from known Breeze domains
      let parsed;
      try { parsed = new URL(photoUrl); } catch { return json({ error: 'Invalid URL' }, 400); }
      if (!parsed.hostname.endsWith('.breezechms.com') && parsed.hostname !== 'breezechms.com') {
        return json({ error: 'Only Breeze photo URLs may be proxied' }, 403);
      }
      const apiKey = env.BREEZE_API_KEY || '';
      // Try multiple auth strategies: no-auth first (public CDN), then API key header,
      // then API key as query param. Use the first response that returns an actual image.
      const attempts = [
        () => fetch(photoUrl),
        () => apiKey ? fetch(photoUrl, { headers: { 'Api-key': apiKey } }) : null,
        () => apiKey ? fetch(photoUrl + (photoUrl.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(apiKey)) : null,
      ];
      let upstream = null;
      for (const attempt of attempts) {
        const res = attempt ? await attempt() : null;
        if (!res) continue;
        const ct = res.headers.get('Content-Type') || '';
        if (res.ok && ct.startsWith('image/')) { upstream = res; break; }
        // If no image yet, keep trying (response body is consumed so we can't reuse)
      }
      if (!upstream) {
        // All attempts failed — return 404 so img onerror fires and shows initials
        return new Response('Photo not available', { status: 404, headers: { 'Cache-Control': 'no-store' } });
      }
      const ct = upstream.headers.get('Content-Type') || 'image/jpeg';
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          'Content-Type': ct,
          'Cache-Control': 'private, max-age=3600',
          'Access-Control-Allow-Origin': 'same-origin'
        }
      });
    }
    if (path === '/sw.js') {
      return new Response(SW_JS, {
        headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache, no-store' }
      });
    }

    // ── Public volunteer-facing RSVP endpoints (linked directly from emails) ──
    if (path.startsWith('/rsvp/portal'))               return handleSchedRsvpPortal(req, env, url);
    if (path === '/rsvp')                              return handleSchedRsvp(req, env, url);

    // ── Event short links (admin-managed, e.g. /christmasmarket) ──────────────
    // Anything else that looks like a single bare path segment gets checked against
    // serve_events.slug before falling through to the (auth-gated) routes below —
    // this must stay a narrow allowlist-style match, not a general SPA catch-all.
    // Deliberately not filtered on `hidden` — a hidden event's short link still
    // resolves, to the same #event-<id> page, which renders a locked
    // "registrations on hold" state instead of the signup form. Only a
    // genuinely nonexistent/removed slug falls through to whatever's below.
    if (!isChmsHost && !isLegacyChmsHost && method === 'GET' && /^\/[a-z0-9-]{1,64}$/.test(path)) {
      const evRow = await env.DB.prepare('SELECT id FROM serve_events WHERE slug=?').bind(path.slice(1)).first();
      if (evRow) {
        return new Response(null, { status: 302, headers: { 'Location': '/#event-' + evRow.id, 'Cache-Control': 'no-store' } });
      }
    }

    // ── Scheduler backend routes — require admin/staff cookie OR WORKER_SECRET ──────
    // These endpoints expose volunteer PII, the church's Resend mail credentials and a
    // full read/write proxy to the Breeze database.
    //
    // ⚠ AUTHENTICATION IS NOT AUTHORIZATION HERE, and that distinction is the whole point
    // of this block. Until 2026-08-19 the only gate was `isAuthed()`, which was correct when
    // every session belonged to staff — but the `role='member'` tier (CONN1/CONN2) made it
    // false. A congregant's read-only directory cookie satisfied `isAuthed()`, so it reached
    // `POST /email/send` (arbitrary mail sent as the church's verified EMAIL_FROM, an
    // outright phishing primitive) and the Breeze proxy (any method, any path, carrying
    // BREEZE_API_KEY — giving, notes, everyone the member view deliberately filters out).
    // Both were confirmed reachable against the real worker with a real member cookie
    // before this fix; see SEC11/SEC12 in CLAUDE.md.
    //
    // SW1/SW2 hardened the `/admin/api/scheduler/*` siblings to admin/staff in v1.9.0 and
    // these non-`/admin/api/` routes were never revisited. Same bar is applied here, so the
    // two halves of the scheduler's own API agree. The Scheduler TAB is admin-only
    // (`showTab` in js-core.js, plus `require-admin` on the sidebar item), so `staff` is
    // deliberately a superset of what any UI can actually reach — it exists so a staff
    // account granted scheduler data through SW1's endpoint is not half-authorized here.
    //
    // ⚠ The X-Worker-Secret bypass must keep working: the scheduler's own server-to-server
    // calls ride it (`_workerHeaders()` in scheduler-html.js), and it predates cookie auth.
    const workerSecret = env.WORKER_SECRET || '';
    const reqSecret    = req.headers.get('X-Worker-Secret') || '';
    const hasWorkerSecret = !!(workerSecret && reqSecret === workerSecret);
    // getAuthRole is memoized per request (see auth.js `_authCache`), so this costs nothing
    // beyond the isAuthed() call it replaces.
    const schedRole    = hasWorkerSecret ? null : await getAuthRole(req, env);
    const schedAuthed  = hasWorkerSecret || schedRole !== null;
    if (!schedAuthed) return json({ error: 'Unauthorized' }, 401);
    const schedPrivileged = hasWorkerSecret || schedRole === 'admin' || schedRole === 'staff';

    // Everything in this block except /esv/passage is admin/staff-only. Listed once, as a
    // set, rather than as a guard per handler — a route added to the block below without a
    // matching entry here fails CLOSED only if it is also added here, so the companion test
    // (test/scheduler-route-authz.test.js) asserts the two lists stay in step.
    // /esv/passage stays open to any authenticated role: it returns public Scripture text
    // and holds no PII, and the ESV key never leaves the server.
    const isPrivilegedSchedPath =
         path === '/serve/pending'         || path === '/volunteer/pending'
      || path === '/serve/general-pending' || path === '/volunteer/general-pending'
      || path === '/serve/event-pending'   || path === '/volunteer/event-pending'
      || path === '/email/send'
      || path === '/rsvp/store'
      || path === '/rsvp/sync'
      || path.startsWith('/breeze/')
      || (path.startsWith('/api/') && path !== '/api/events');
    if (isPrivilegedSchedPath && !schedPrivileged) {
      return json({ error: 'Access denied' }, 403);
    }

    if ((path === '/serve/pending'         || path === '/volunteer/pending')         && method === 'GET') return handleVolunteerPending(env);
    if ((path === '/serve/general-pending' || path === '/volunteer/general-pending') && method === 'GET') return handleVolunteerGeneralPending(env);
    if ((path === '/serve/event-pending'   || path === '/volunteer/event-pending')   && method === 'GET') return handleVolunteerEventPending(env);
    if (path === '/email/send'   && method === 'POST') return handleSchedEmailSend(req, env);
    if (path === '/esv/passage'  && method === 'GET')  return handleEsvPassage(req, env, url);
    if (path === '/rsvp/store'   && method === 'POST') return handleSchedRsvpStore(req, env);
    if (path === '/rsvp/sync'    && method === 'POST') return handleSchedRsvpSync(req, env);
    // Breeze API proxy: /api/* (except /api/events handled above) and /breeze/*
    if (path.startsWith('/breeze/') || (path.startsWith('/api/') && path !== '/api/events')) {
      return handleSchedBreezeProxy(req, env, url);
    }

    if (path.startsWith('/scheduler')) {
      if (!await isAuthed(req, env)) return html(LOGIN_HTML);
      // /scheduler/lcms_calendar.json is a live data endpoint the EMBEDDED scheduler tab
      // fetches at runtime (see scheduler-inline.js) — keep this working regardless of the
      // standalone-page retirement below.
      if (url.pathname === '/scheduler/lcms_calendar.json') {
        return new Response(LCMS_CALENDAR_JSON, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      // The standalone scheduler page is retired — it carried its own pre-rebrand "Steel &
      // Amber" visual identity that was never brought forward, and nothing in the live app
      // links to it (confirmed: the only reference was in the now-deleted dead ADMIN_HTML
      // export — see CR7(c) — which was itself never routed to anything).
      // The embedded Scheduler tab inside ChMS (src/scheduler-inline.js) is now the only
      // supported way to use the scheduler — redirect any direct hit here into it.
      return new Response(null, { status: 302, headers: { 'Location': 'https://connect.timothystl.org/#scheduler', 'Cache-Control': 'no-store' } });
    }
    // ⚠ Cache-Control: no-store here is load-bearing, not decoration. This is the final
    // catch-all for every unmatched path — including a route added AFTER this Worker's
    // first deploy of it, whose earliest hit (before the route existed) would otherwise
    // be a plain 404 with no cache directive at all. Cloudflare's edge can hold onto that
    // per-colo, so one caller's requests (always routed through the same nearby colo) keep
    // seeing a stale "Not Found" long after the real route is live and answering correctly
    // to a request landing at a different colo. See the Christmas Market volunteer-summary
    // investigation (`handleChristmasMarketSummary`) for the exact symptom this caused.
    return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}
