// Timothy Lutheran Church — Volunteer Sign-Up Worker
// Deploy to: volunteer.timothystl.org
// Admin at: volunteer.timothystl.org/admin
// Admin password is set via ADMIN_PASSWORD environment variable in Cloudflare Dashboard.
// v2 — modular build (src/)

// ── Imports ────────────────────────────────────────────────────────────────────
import { html, json, isAuthed, getAuthInfo, refreshAuthCookie, SCHED_CORS } from './src/auth.js';
import { initDb } from './src/db.js';
import { LCMS_CALENDAR_JSON } from './src/lectionary.js';
import { SCHEDULER_HTML } from './src/scheduler-html.js';
import {
  handleApiEvents, handleSignup, handleCalendar,
  handleVolunteerPending, handleVolunteerGeneralPending, handleVolunteerEventPending,
  handleSchedEmailSend, handleSchedRsvpStore, handleSchedRsvpSync,
  handleSchedRsvpPortal, handleSchedRsvp, handleSchedBreezeProxy,
} from './src/api-scheduler.js';
import { handleAdminLogin, handleAdminApi } from './src/api-admin.js';
import { handleIntakeApi } from './src/api-intake.js';
import { LOGIN_HTML, PUBLIC_HTML, ADMIN_HTML } from './src/html-templates.js';
import { CHMS_HTML, CHMS_MANIFEST_JSON, SW_JS, BACKLOG_HTML } from './src/html-chms.js';
import { sendBirthdayEmails, sendAnniversaryEmails, sendBirthdayTexts, sendAnniversaryTexts } from './src/api-emails.js';

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
      const [bday, ann, bdaySms, annSms, prune] = await Promise.all([
        sendBirthdayEmails(env).catch(e => ({ error: e.message })),
        sendAnniversaryEmails(env).catch(e => ({ error: e.message })),
        sendBirthdayTexts(env).catch(e => ({ error: e.message })),
        sendAnniversaryTexts(env).catch(e => ({ error: e.message })),
        pruneAuditLog(env.DB).catch(e => ({ error: e.message })),
      ]);
      console.log('Daily cron:', JSON.stringify({ birthdays: bday, anniversaries: ann, birthday_sms: bdaySms, anniversary_sms: annSms, audit_prune: prune }));
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

async function _fetch(req, env) {
    try {
      await initDb(env.DB);
    } catch (e) {
      return new Response('DB init error: ' + e.message, { status: 500 });
    }

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const method = req.method.toUpperCase();

    // CORS preflight for scheduler backend routes
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: SCHED_CORS });

    if (path === '/favicon.svg' && method === 'GET') {
      const fRes = await fetch('https://raw.githubusercontent.com/timothystl/volunteer/main/favicon.svg', { cf: { cacheEverything: true, cacheTtl: 86400 } });
      return new Response(fRes.ok ? fRes.body : '', { status: fRes.ok ? 200 : 404, headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
    }
    if ((path === '/' || path === '/index.html') && method === 'GET') return html(PUBLIC_HTML);
    if (path === '/api/events' && method === 'GET') return handleApiEvents(env);
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
    if (path === '/admin/logout') {
      return new Response(null, { status: 302, headers: {
        'Location': '/admin',
        'Set-Cookie': 'vol_auth=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict'
      }});
    }
    if (path === '/admin' && method === 'GET') {
      if (!await isAuthed(req, env)) return html(LOGIN_HTML);
      // Redirect authenticated users to CHMS (Volunteers tab is integrated there)
      return new Response(null, { status: 302, headers: { 'Location': '/chms' } });
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
    if (path === '/chms' && method === 'GET') {
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
        // All attempts failed — return a transparent 1×1 GIF so onerror fires gracefully
        const gif = new Uint8Array([71,73,70,56,57,97,1,0,1,0,128,0,0,0,0,0,255,255,255,33,249,4,0,0,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,59]);
        return new Response(gif, { status: 200, headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' } });
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
      // /scheduler/lcms_calendar.json is served inline (bundled) for reliability.
      if (url.pathname === '/scheduler/lcms_calendar.json') {
        return new Response(LCMS_CALENDAR_JSON, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      // scheduler/index.html is bundled inline to avoid stale-cache from GitHub raw CDN.
      // When loaded with ?embedded=1 (inside the ChMS SPA iframe), inject the
      // body.embedded class server-side so the login screen and outer chrome
      // are hidden by CSS regardless of client-side JS execution.
      let body = SCHEDULER_HTML;
      if (url.searchParams.has('embedded')) {
        body = body.replace('<body>', '<body class="embedded">');
      }
      return new Response(body, { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store, no-cache, must-revalidate' } });
    }
    return new Response('Not Found', { status: 404 });
}
