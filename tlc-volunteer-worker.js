// Timothy Lutheran Church — Volunteer Sign-Up Worker
// Deploy to: volunteer.timothystl.org
// Admin at: volunteer.timothystl.org/admin
// Admin password is set via ADMIN_PASSWORD environment variable in Cloudflare Dashboard.
// v2 — modular build (src/)

// ── Imports ────────────────────────────────────────────────────────────────────
import { html, json, isAuthed, getAuthInfo, refreshAuthCookie, SCHED_CORS } from './src/auth.js';
import { initDb } from './src/db.js';
import { LCMS_CALENDAR_JSON } from './src/lectionary.js';
import {
  handleApiEvents, handleSignup, handleCalendar,
  handleVolunteerPending, handleVolunteerGeneralPending, handleVolunteerEventPending,
  handleSchedEmailSend, handleSchedRsvpStore, handleSchedRsvpSync,
  handleSchedRsvpPortal, handleSchedRsvp, handleSchedBreezeProxy,
} from './src/api-scheduler.js';
import { handleAdminLogin, handleAdminApi, handleForgotPassword, handleResetPassword, handleApiMinistryRoles } from './src/api-admin.js';
import { handleIntakeApi } from './src/api-intake.js';
import { LOGIN_HTML, PUBLIC_HTML, ADMIN_HTML } from './src/html-templates.js';
import { CHMS_HTML, CHMS_MANIFEST_JSON, SW_JS, BACKLOG_HTML } from './src/html-chms.js';
import { PORTAL_HTML, PORTAL_MANIFEST_JSON } from './src/portal-html.js';
import { PRIVACY_HTML, TERMS_HTML } from './src/legal-pages.js';
import { PORTAL_SW_JS } from './src/portal-sw-js.js';
import { handleMemberApi, getMemberAuth } from './src/api-member.js';
import { sendBirthdayEmails, sendAnniversaryEmails, sendBirthdayTexts, sendAnniversaryTexts, centralDayOfWeek } from './src/api-emails.js';
import { sendWebPush } from './src/push-sender.js';

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
      const [bday, ann, bdaySms, annSms, prune, schedPush] = await Promise.all([
        sendBirthdayEmails(env).catch(e => ({ error: e.message })),
        sendAnniversaryEmails(env).catch(e => ({ error: e.message })),
        sendBirthdayTexts(env).catch(e => ({ error: e.message })),
        sendAnniversaryTexts(env).catch(e => ({ error: e.message })),
        pruneAuditLog(env.DB).catch(e => ({ error: e.message })),
        sendScheduleReminders(env).catch(e => ({ error: e.message })),
      ]);
      console.log('Daily cron:', JSON.stringify({ birthdays: bday, anniversaries: ann, birthday_sms: bdaySms, anniversary_sms: annSms, audit_prune: prune, schedule_push: schedPush }));
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
      url: '/portal',
      tag: 'schedule-reminder-' + tomorrowISO,
    }, env).catch(() => ({ ok: false }));

    if (result.ok) sent++; else failed++;
  }

  return { sent, failed };
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
    const isChmsHost = host === 'chms.timothystl.org';

    // CORS preflight for scheduler backend routes
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: SCHED_CORS });

    if (path === '/favicon.svg' && method === 'GET') {
      const fRes = await fetch('https://raw.githubusercontent.com/timothystl/chms/main/favicon.svg', { cf: { cacheEverything: true, cacheTtl: 86400 } });
      return new Response(fRes.ok ? fRes.body : '', { status: fRes.ok ? 200 : 404, headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
    }
    // App icons (TLC Gather mark) — proxied from the repo so they update on deploy.
    if (path.startsWith('/icons/') && method === 'GET') {
      const m = path.match(/^\/icons\/(icon-(?:16|32|180|192|512|512-maskable)\.png|tlc-gather-icon\.svg)$/);
      if (m) {
        const fRes = await fetch('https://raw.githubusercontent.com/timothystl/chms/main/icons/' + m[1], { cf: { cacheEverything: true, cacheTtl: 86400 } });
        const ct = m[1].endsWith('.svg') ? 'image/svg+xml' : 'image/png';
        return new Response(fRes.ok ? fRes.body : '', { status: fRes.ok ? 200 : 404, headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400' } });
      }
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
    if ((path === '/' || path === '/index.html') && method === 'GET') {
      if (isChmsHost) {
        if (!await isAuthed(req, env)) return html(LOGIN_HTML);
        return html(CHMS_HTML, 200, { 'Cache-Control': 'no-store, no-cache, must-revalidate' });
      }
      return html(PUBLIC_HTML);
    }
    if (path === '/api/events' && method === 'GET') return handleApiEvents(env);
    if (path === '/api/ministry-roles' && method === 'GET') return handleApiMinistryRoles(env, url);
    if (path === '/volunteer/signup' && method === 'POST') {
      try {
        return await handleSignup(req, env);
      } catch (e) {
        console.error('Signup error:', e);
        return json({ ok: false, error: 'Server error. Please try again or contact the church office.' }, 500);
      }
    }
    if (path.match(/^\/volunteer\/calendar\/\d+$/) && method === 'GET') return handleCalendar(env, path);
    if (path === '/admin/login' && method === 'POST') return handleAdminLogin(req, env);
    if (path === '/admin/forgot-password' && method === 'POST') return handleForgotPassword(req, env);
    if (path === '/admin/reset' && (method === 'GET' || method === 'POST')) return handleResetPassword(req, env, url);
    if (path === '/admin/logout') {
      return new Response(null, { status: 302, headers: {
        'Location': isChmsHost ? '/' : '/admin',
        'Set-Cookie': 'vol_auth=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict'
      }});
    }
    if (path === '/admin' && method === 'GET') {
      if (!await isAuthed(req, env)) return html(LOGIN_HTML);
      return new Response(null, { status: 302, headers: { 'Location': isChmsHost ? '/' : '/chms' } });
    }
    // Permanent redirect: old volunteer.timothystl.org/chms → chms.timothystl.org
    if (!isChmsHost && path === '/chms' && method === 'GET') {
      return new Response(null, { status: 301, headers: { 'Location': 'https://chms.timothystl.org' } });
    }
    // ── Member portal ──────────────────────────────────────────────────
    // SPA at /portal (no auth check — the SPA handles login client-side)
    if (path === '/portal' || path === '/portal/') {
      return html(PORTAL_HTML, 200, { 'Cache-Control': 'no-store, no-cache, must-revalidate' });
    }
    // Verify token routes — handled server-side (renders set-password form)
    if (path.startsWith('/portal/verify/')) {
      try {
        return await handleMemberApi(req, env, path, method);
      } catch (e) {
        console.error('Portal verify error [' + method + ' ' + path + ']:', e?.message, e?.stack);
        return html('<p>Something went wrong. Please request a new invite link.</p>', 500);
      }
    }
    if (path === '/portal.webmanifest') {
      return new Response(PORTAL_MANIFEST_JSON, {
        headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=86400' }
      });
    }
    if (path === '/portal-sw.js') {
      return new Response(PORTAL_SW_JS, {
        headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache, no-store' }
      });
    }
    // Member R2 photo proxy — uses tlc-member cookie instead of admin cookie
    if (path.startsWith('/member/r2photo/') && method === 'GET') {
      if (!(await getMemberAuth(req, env))) return new Response('Unauthorized', { status: 401 });
      if (!env.PHOTOS) return new Response('Not configured', { status: 503 });
      const r2Key = decodeURIComponent(path.slice('/member/r2photo/'.length));
      if (!r2Key) return new Response('Missing key', { status: 400 });
      const obj = await env.PHOTOS.get(r2Key);
      if (!obj) return new Response('Not found', { status: 404 });
      return new Response(obj.body, {
        headers: { 'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg', 'Cache-Control': 'private, max-age=86400' }
      });
    }
    // Member API (uses tlc-member cookie; no admin auth required)
    if (path.startsWith('/member/')) {
      try {
        return await handleMemberApi(req, env, path, method);
      } catch (e) {
        console.error('Member API error [' + method + ' ' + path + ']:', e?.message, e?.stack);
        return json({ error: 'Internal server error' }, 500);
      }
    }
    // Public intake endpoints (gated by X-Intake-Key header, NOT user session).
    // Called server-to-server from the timothystl.org admin worker.
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
    // Serve at root on chms.timothystl.org, or at /chms on any host (staging, etc.)
    if ((path === '/chms' || (isChmsHost && path === '/')) && method === 'GET') {
      if (!await isAuthed(req, env)) return html(LOGIN_HTML);
      return html(CHMS_HTML, 200, { 'Cache-Control': 'no-store, no-cache, must-revalidate' });
    }
    if (path === '/chms.webmanifest') {
      return new Response(CHMS_MANIFEST_JSON, {
        headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=86400' }
      });
    }
    if (path === '/admin/backlog' && method === 'GET') {
      if (!await isAuthed(req, env)) return html(LOGIN_HTML);
      return html(BACKLOG_HTML, 200, { 'Cache-Control': 'no-store, no-cache, must-revalidate' });
    }
    // ── R2 photo serve — requires auth ───────────────────────────────
    if (path.startsWith('/admin/r2photo/') && method === 'GET') {
      if (!await isAuthed(req, env)) return new Response('Unauthorized', { status: 401 });
      if (!env.PHOTOS) return new Response('Photo storage not configured', { status: 503 });
      const r2Key = decodeURIComponent(path.slice('/admin/r2photo/'.length));
      if (!r2Key) return new Response('Missing key', { status: 400 });
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
    if (!isChmsHost && method === 'GET' && /^\/[a-z0-9-]{1,64}$/.test(path)) {
      const evRow = await env.DB.prepare('SELECT id FROM serve_events WHERE slug=? AND hidden=0').bind(path.slice(1)).first();
      if (evRow) return new Response(null, { status: 302, headers: { 'Location': '/#event-' + evRow.id, 'Cache-Control': 'no-store' } });
    }

    // ── Scheduler backend routes — require admin cookie OR WORKER_SECRET ──────
    // These endpoints expose volunteer PII and church database access; they must
    // never be publicly reachable without authentication.
    const workerSecret = env.WORKER_SECRET || '';
    const reqSecret    = req.headers.get('X-Worker-Secret') || '';
    const schedAuthed  = (workerSecret && reqSecret === workerSecret)
                         || await isAuthed(req, env);
    if (!schedAuthed) return json({ error: 'Unauthorized' }, 401);

    if (path === '/volunteer/pending'         && method === 'GET') return handleVolunteerPending(env);
    if (path === '/volunteer/general-pending' && method === 'GET') return handleVolunteerGeneralPending(env);
    if (path === '/volunteer/event-pending'   && method === 'GET') return handleVolunteerEventPending(env);
    if (path === '/email/send'   && method === 'POST') return handleSchedEmailSend(req, env);
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
      // links to it (confirmed: the only reference was in ADMIN_HTML, itself dead/unserved).
      // The embedded Scheduler tab inside ChMS (src/scheduler-inline.js) is now the only
      // supported way to use the scheduler — redirect any direct hit here into it.
      return new Response(null, { status: 302, headers: { 'Location': 'https://chms.timothystl.org/#scheduler', 'Cache-Control': 'no-store' } });
    }
    return new Response('Not Found', { status: 404 });
}
