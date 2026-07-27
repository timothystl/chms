// ── Admin API handlers ─────────────────────────────────────────────────────────
import { html, json, isAuthed, authCookieHeader, getAuthRole, getAuthInfo, hashPassword, verifyPassword } from './auth.js';
import { handleChmsApi } from './api-chms.js';
import { LOGIN_HTML } from './html-templates.js';
import { randHex, authCardPage, getRolePermissions, permissionsForRole } from './api-utils.js';
import { sendBirthdayEmails, sendAnniversaryEmails, sendBirthdayTexts, sendAnniversaryTexts } from './api-emails.js';
import { applyXmasMarketDefaults, handleVolunteerTemplates, handleSignupLinkPerson, handleSignupSendEmail, handleSchedulerVolunteersApi } from './api-scheduler.js';

// Event short-link slug: lowercase, alphanumeric + hyphens only, capped at 64 chars
// (matches the worker's /<slug> route allowlist regex — a longer slug would save fine
// here but its short link would silently never match and 404).
function normalizeSlug(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64);
}

// Bare single-segment routes the public worker already serves (or reserves for the
// scheduler/admin/member surfaces) — a matching event slug would shadow the real route.
const RESERVED_SLUGS = ['scheduler', 'chms', 'portal', 'admin', 'api', 'rsvp', 'volunteer', 'serve', 'connect', 'email', 'member', 'member-setup'];

export const SCHEDULER_KEYS = [
  'ws_people','ws_schedule_v2','ws_history','ws_last_served',
  'ws_schedule_overrides','ws_confirmations','ws_rsvp_tokens',
  'ws_sun_labels','ws_breeze_settings','ws_readings','ws_breeze_event_map'
];
export async function handleSchedulerDataApi(req, env, url, method) {
  // Guard the whole scheduler data surface — it holds raw Breeze/Resend/worker secrets
  // (ws_breeze_settings) and can overwrite the entire schedule, not just read it.
  const schedRole = await getAuthRole(req, env);
  if (schedRole !== 'admin' && schedRole !== 'staff') return json({ error: 'Access denied' }, 403);
  const seg = url.pathname.replace('/admin/api/scheduler/', '').replace(/\/$/, '');

  // GET /admin/api/scheduler/export
  if (seg === 'export' && method === 'GET') {
    const rows = await env.DB.prepare('SELECT key, value FROM scheduler_data').all();
    const out = {};
    for (const r of (rows.results || [])) {
      try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
    }
    return new Response(JSON.stringify(out, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="scheduler_export.json"'
      }
    });
  }

  // GET /admin/api/scheduler/data
  if (seg === 'data' && method === 'GET') {
    const rows = await env.DB.prepare('SELECT key, value FROM scheduler_data').all();
    const out = {};
    for (const r of (rows.results || [])) {
      try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
    }
    return json(out);
  }

  // POST /admin/api/scheduler/data  (bulk upsert — accepts full snapshot)
  if (seg === 'data' && method === 'POST') {
    let body; try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const stmt = env.DB.prepare(
      "INSERT OR REPLACE INTO scheduler_data (key, value, updated_at) VALUES (?, ?, datetime('now'))"
    );
    const ops = [];
    for (const k of SCHEDULER_KEYS) {
      if (body[k] !== undefined) ops.push(stmt.bind(k, JSON.stringify(body[k])));
    }
    if (ops.length) await env.DB.batch(ops);
    return json({ ok: true, saved: ops.length });
  }

  // GET /admin/api/scheduler/data/:key
  if (seg.startsWith('data/') && method === 'GET') {
    const key = seg.slice(5);
    const row = await env.DB.prepare('SELECT value FROM scheduler_data WHERE key=?').bind(key).first();
    if (!row) return json({ error: 'Not found' }, 404);
    try { return json(JSON.parse(row.value)); } catch { return json(row.value); }
  }

  // POST /admin/api/scheduler/data/:key
  if (seg.startsWith('data/') && method === 'POST') {
    const key = seg.slice(5);
    if (!SCHEDULER_KEYS.includes(key)) return json({ error: 'Unknown key' }, 400);
    let body; try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const value = body.value !== undefined ? body.value : body;
    await env.DB.prepare(
      "INSERT OR REPLACE INTO scheduler_data (key, value, updated_at) VALUES (?, ?, datetime('now'))"
    ).bind(key, JSON.stringify(value)).run();
    return json({ ok: true });
  }

  // GET /admin/api/scheduler/config
  if (seg === 'config' && method === 'GET') {
    const db = env.DB;
    const [tagRow, replyRow] = await Promise.all([
      db.prepare("SELECT value FROM chms_config WHERE key='scheduler_tag_ids'").first(),
      db.prepare("SELECT value FROM chms_config WHERE key='scheduler_reply_to'").first(),
    ]);
    let tagIds = [];
    try { tagIds = JSON.parse(tagRow?.value || '[]'); } catch {}
    return json({
      subdomain: env.BREEZE_SUBDOMAIN || '',
      emailFrom: env.EMAIL_FROM || '',
      workerUrl: new URL(req.url).origin,
      tagIds,
      replyTo: replyRow?.value || '',
      // Presence flags so the scheduler UI can render accurate
      // "configured / not configured" state instead of hardcoded labels.
      hasBreezeApiKey:  !!env.BREEZE_API_KEY,
      hasResendKey:     !!env.RESEND_API_KEY,
      hasWorkerSecret:  !!env.WORKER_SECRET,
    });
  }

  // PUT /admin/api/scheduler/config
  if (seg === 'config' && method === 'PUT') {
    const db = env.DB;
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const ops = [];
    if (Array.isArray(b.tagIds))
      ops.push(db.prepare("INSERT INTO chms_config(key,value) VALUES('scheduler_tag_ids',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(b.tagIds)));
    if (typeof b.replyTo === 'string')
      ops.push(db.prepare("INSERT INTO chms_config(key,value) VALUES('scheduler_reply_to',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(b.replyTo));
    if (ops.length) await db.batch(ops);
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, 404);
}

// ── ADMIN LOGIN ───────────────────────────────────────────────────────
export async function handleAdminLogin(req, env) {
  // ── Rate limiting: max 10 attempts per IP per 15-minute window ──────
  const ip = req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || 'unknown';
  const WINDOW_MS = 15 * 60 * 1000;
  const MAX_ATTEMPTS = 10;
  const rlKey = `rl_login:${ip}:${Math.floor(Date.now() / WINDOW_MS)}`;
  if (env.RSVP_STORE) {
    const attempts = parseInt(await env.RSVP_STORE.get(rlKey) || '0', 10);
    if (attempts >= MAX_ATTEMPTS) {
      return html(LOGIN_HTML.replace('<!--ERROR-->', '<p style="color:#c0392b;margin-bottom:1rem;">Too many login attempts. Please wait 15 minutes and try again.</p>'), 429);
    }
  }
  // ── Credential check ────────────────────────────────────────────────
  let body; try { body = await req.text(); } catch { body = ''; }
  const params = new URLSearchParams(body);
  const adminPassword   = env.ADMIN_PASSWORD   || '';
  const financePassword = env.FINANCE_PASSWORD || '';
  const staffPassword   = env.STAFF_PASSWORD   || '';
  const memberPassword  = env.MEMBER_PASSWORD  || '';
  const adminEmail      = (env.ADMIN_EMAIL || '').toLowerCase().trim();
  if (!adminPassword) {
    return html(LOGIN_HTML.replace('<!--ERROR-->', '<p style="color:#c0392b;margin-bottom:1rem;">Admin password is not configured. Set the <code>ADMIN_PASSWORD</code> secret in the Cloudflare Dashboard.</p>'));
  }
  const submittedUser = (params.get('username') || '').trim().toLowerCase();
  const submittedPass = params.get('password') || '';
  if (!submittedUser) {
    return html(LOGIN_HTML.replace('<!--ERROR-->', '<p style="color:#c0392b;margin-bottom:1rem;">Username is required.</p>'));
  }
  let matchedRole = null;
  let matchedUsername = '';

  // ── 1. Check app_users table ─────────────────────────────────────
  if (env.DB) {
    const dbUser = await env.DB.prepare(
      `SELECT id, username, password_hash, role, active FROM app_users WHERE LOWER(username)=? LIMIT 1`
    ).bind(submittedUser).first().catch(() => null);
    if (dbUser && dbUser.active && await verifyPassword(submittedPass, dbUser.password_hash)) {
      matchedRole     = dbUser.role;
      matchedUsername = dbUser.username;
      await env.DB.prepare(`UPDATE app_users SET last_login=datetime('now') WHERE id=?`)
        .bind(dbUser.id).run().catch(() => {});
    }
  }

  // ── 2. Fall back to ADMIN_PASSWORD env-var (break-glass / initial setup) ──
  // This path bypasses the app_users table entirely. If a DB user named "admin" is
  // deactivated, this env-var credential still grants full admin access. It exists
  // only for initial setup and locked-out recovery — rotate it after first DB user is created.
  if (!matchedRole && submittedUser === 'admin' && submittedPass === adminPassword) {
    matchedRole = 'admin';
  }

  if (matchedRole) {
    if (env.RSVP_STORE) await env.RSVP_STORE.delete(rlKey).catch(() => {});
    return new Response('', { status: 302, headers: {
      Location: '/chms',
      'Set-Cookie': await authCookieHeader(env, matchedRole, matchedUsername)
    }});
  }
  // Increment failed-attempt counter (expires after 20 minutes to clean up)
  if (env.RSVP_STORE) {
    const cur = parseInt(await env.RSVP_STORE.get(rlKey) || '0', 10);
    await env.RSVP_STORE.put(rlKey, String(cur + 1), { expirationTtl: 20 * 60 }).catch(() => {});
  }
  return html(LOGIN_HTML.replace('<!--ERROR-->', '<p style="color:#c0392b;margin-bottom:1rem;">Incorrect password. Please try again.</p>'));
}

// ── ADMIN API ─────────────────────────────────────────────────────────
export async function handleAdminApi(req, env, url, method) {
  const seg = url.pathname.replace('/admin/api/', '');

  // ── Current user info ─────────────────────────────────────────────
  if (seg === 'me' && method === 'GET') {
    const info = await getAuthInfo(req, env);
    const role = info ? info.role : null;
    const username = info ? info.username : '';
    const roleLabels = { admin: 'Administrator', finance: 'Finance', staff: 'Staff', member: 'Member (read-only)' };
    // Try to get display_name from DB if we have a username
    let displayName = roleLabels[role] || 'Unknown';
    if (username && env.DB) {
      const u = await env.DB.prepare(`SELECT display_name FROM app_users WHERE LOWER(username)=?`)
        .bind(username.toLowerCase()).first().catch(() => null);
      if (u && u.display_name) displayName = u.display_name;
    }
    // Only the caller's own resolved flags — not the whole cross-role matrix, which is
    // admin-only (config/role-permissions) since it's the access-control definition itself,
    // not informational config. Lets the frontend hide tabs a role's admin-configured
    // permissions don't grant, without exposing what other roles can/can't do.
    const permissions = role && env.DB ? permissionsForRole(await getRolePermissions(env.DB), role) : null;
    return json({ role: role || 'unknown', username, display_name: displayName, permissions });
  }

  // SC6 Phase 1: relationalized scheduler volunteers (real people rows) — must be checked
  // before the generic 'scheduler/' blob-store dispatch below, which would otherwise swallow it.
  if (seg.startsWith('scheduler/volunteers')) return handleSchedulerVolunteersApi(req, env, url, method);
  if (seg.startsWith('scheduler/')) return handleSchedulerDataApi(req, env, url, method);

  // ── Email triggers (admin only) — manual test / emergency resend ──────────
  if (seg === 'email/run-birthday' && method === 'POST') {
    const reqRole = await getAuthRole(req, env);
    if (reqRole !== 'admin') return json({ error: 'Access denied' }, 403);
    try {
      const result = await sendBirthdayEmails(env);
      return json(result);
    } catch (e) { return json({ error: e.message }, 500); }
  }
  if (seg === 'email/run-anniversary' && method === 'POST') {
    const reqRole = await getAuthRole(req, env);
    if (reqRole !== 'admin') return json({ error: 'Access denied' }, 403);
    try {
      const result = await sendAnniversaryEmails(env);
      return json(result);
    } catch (e) { return json({ error: e.message }, 500); }
  }
  if (seg === 'sms/run-birthday' && method === 'POST') {
    const reqRole = await getAuthRole(req, env);
    if (reqRole !== 'admin') return json({ error: 'Access denied' }, 403);
    try { return json(await sendBirthdayTexts(env)); } catch (e) { return json({ error: e.message }, 500); }
  }
  if (seg === 'sms/run-anniversary' && method === 'POST') {
    const reqRole = await getAuthRole(req, env);
    if (reqRole !== 'admin') return json({ error: 'Access denied' }, 403);
    try { return json(await sendAnniversaryTexts(env)); } catch (e) { return json({ error: e.message }, 500); }
  }

  // ── Users management (admin only) ────────────────────────────────
  if (seg.startsWith('users')) {
    const reqRole = await getAuthRole(req, env);
    if (reqRole !== 'admin') return json({ error: 'Access denied' }, 403);

    // GET /admin/api/users — list all users
    if (seg === 'users' && method === 'GET') {
      const rows = (await env.DB.prepare(
        `SELECT id, username, display_name, email, role, active, created_at, last_login FROM app_users ORDER BY username`
      ).all()).results || [];
      return json({ users: rows });
    }

    // POST /admin/api/users — create user
    if (seg === 'users' && method === 'POST') {
      let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const username = (b.username || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (!username) return json({ error: 'Username is required' }, 400);
      if (!b.password || b.password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
      const validRoles = ['admin', 'finance', 'staff', 'office', 'member'];
      const role = validRoles.includes(b.role) ? b.role : 'staff';
      const email = (b.email || '').trim().toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Invalid email address' }, 400);
      const existing = await env.DB.prepare(`SELECT id FROM app_users WHERE LOWER(username)=?`).bind(username).first();
      if (existing) return json({ error: 'Username already exists' }, 409);
      const hash = await hashPassword(b.password);
      const r = await env.DB.prepare(
        `INSERT INTO app_users (username, password_hash, display_name, email, role) VALUES (?,?,?,?,?)`
      ).bind(username, hash, b.display_name || '', email, role).run();
      return json({ ok: true, id: r.meta?.last_row_id });
    }

    // PUT /admin/api/users/:id — update user
    const umatch = seg.match(/^users\/(\d+)$/);
    if (umatch && method === 'PUT') {
      const uid = parseInt(umatch[1]);
      let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const validRoles = ['admin', 'finance', 'staff', 'office', 'member'];
      const role = validRoles.includes(b.role) ? b.role : undefined;
      // Build update
      const fields = [];
      const vals = [];
      if (b.display_name !== undefined) { fields.push('display_name=?'); vals.push(b.display_name || ''); }
      if (b.email !== undefined) {
        const email = (b.email || '').trim().toLowerCase();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Invalid email address' }, 400);
        fields.push('email=?'); vals.push(email);
      }
      if (role)                          { fields.push('role=?');         vals.push(role); }
      if (b.active !== undefined)        { fields.push('active=?');       vals.push(b.active ? 1 : 0); }
      if (b.password) {
        if (b.password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
        fields.push('password_hash=?');
        vals.push(await hashPassword(b.password));
      }
      if (!fields.length) return json({ error: 'Nothing to update' }, 400);
      vals.push(uid);
      await env.DB.prepare(`UPDATE app_users SET ${fields.join(',')} WHERE id=?`).bind(...vals).run();
      return json({ ok: true });
    }

    // DELETE /admin/api/users/:id
    if (umatch && method === 'DELETE') {
      const uid = parseInt(umatch[1]);
      await env.DB.prepare(`DELETE FROM app_users WHERE id=?`).bind(uid).run();
      return json({ ok: true });
    }
  }

  if (seg === 'signups' && method === 'GET') {
    const ministry = url.searchParams.get('ministry') || '';
    let q = 'SELECT s.*, e.name as event_name FROM signups s LEFT JOIN serve_events e ON s.event_id=e.id';
    const binds = [];
    if (ministry && ministry !== 'all') { q += ' WHERE s.ministry=?'; binds.push(ministry); }
    q += ' ORDER BY s.created_at DESC';
    const rows = await env.DB.prepare(q).bind(...binds).all();
    // Bulk-load slot details and linked person names to avoid N+1 queries
    const signupList = rows.results || [];
    const signupIds = signupList.map(s => s.id).filter(Boolean);
    const personIds = [...new Set(signupList.map(s => s.person_id).filter(Boolean))];

    const slotsBySignup = {};
    if (signupIds.length) {
      const ph = signupIds.map(() => '?').join(',');
      const allSlots = (await env.DB.prepare(
        `SELECT ss.signup_id, r.name, r.role_date, r.start_time, r.end_time
         FROM signup_slots ss JOIN serve_roles r ON ss.role_id=r.id
         WHERE ss.signup_id IN (${ph})`
      ).bind(...signupIds).all()).results || [];
      for (const sl of allSlots) {
        if (!slotsBySignup[sl.signup_id]) slotsBySignup[sl.signup_id] = [];
        slotsBySignup[sl.signup_id].push({ name: sl.name || '', role_date: sl.role_date || '', start_time: sl.start_time || '', end_time: sl.end_time || '' });
      }
    }
    const personNames = {};
    if (personIds.length) {
      const ph = personIds.map(() => '?').join(',');
      const allPeople = (await env.DB.prepare(
        `SELECT id, first_name, last_name FROM people WHERE id IN (${ph})`
      ).bind(...personIds).all()).results || [];
      for (const p of allPeople) {
        personNames[p.id] = ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
      }
    }

    const signups = signupList.map(function(s) {
      return {
        id: s.id, event_id: s.event_id, role_id: s.role_id,
        ministry: s.ministry || '', name: s.name || '', email: s.email || '',
        phone: s.phone || '', roles: s.roles || '[]', service: s.service || '',
        sundays: s.sundays || '[]', shirt_wanted: s.shirt_wanted || 0,
        shirt_size: s.shirt_size || '', notes: s.notes || '',
        created_at: s.created_at || '', event_name: s.event_name || null,
        person_id: s.person_id || null, contact_count: s.contact_count || 0,
        contacted_at: s.contacted_at || '',
        status: s.status || 'new',
        sms_reminder_opt_in: s.sms_reminder_opt_in || 0,
        linked_person_name: s.person_id ? (personNames[s.person_id] || '') : '',
        slot_details: slotsBySignup[s.id] || [],
      };
    });
    return json({ signups });
  }

  if (seg.startsWith('signups/') && method === 'DELETE') {
    const sigRole = await getAuthRole(req, env);
    if (sigRole !== 'admin' && sigRole !== 'staff') return json({ error: 'Access denied' }, 403);
    const id = parseInt(seg.split('/')[1]);
    await env.DB.prepare('DELETE FROM signup_slots WHERE signup_id=?').bind(id).run();
    await env.DB.prepare('DELETE FROM signups WHERE id=?').bind(id).run();
    return json({ ok: true });
  }

  // PUT /admin/api/signups/:id/status — { status: 'new'|'contacted'|'confirmed'|'declined' }
  const statusMatch = seg.match(/^signups\/(\d+)\/status$/);
  if (statusMatch && method === 'PUT') {
    const sigRole = await getAuthRole(req, env);
    if (sigRole !== 'admin' && sigRole !== 'staff') return json({ error: 'Access denied' }, 403);
    const VALID_STATUS = ['new', 'contacted', 'confirmed', 'declined'];
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!VALID_STATUS.includes(b.status)) return json({ error: 'Invalid status' }, 400);
    await env.DB.prepare('UPDATE signups SET status=? WHERE id=?').bind(b.status, parseInt(statusMatch[1])).run();
    return json({ ok: true });
  }

  if (seg === 'events' && method === 'GET') {
    const events = await env.DB.prepare('SELECT * FROM serve_events ORDER BY sort_order,event_date,id').all();
    const eventList = events.results || [];
    const eventIds = eventList.map(e => e.id).filter(Boolean);

    const rolesByEvent = {};
    const fillCounts = {};
    if (eventIds.length) {
      const ph = eventIds.map(() => '?').join(',');
      const allRoles = (await env.DB.prepare(
        `SELECT * FROM serve_roles WHERE event_id IN (${ph}) ORDER BY role_date,sort_order,id`
      ).bind(...eventIds).all()).results || [];
      for (const r of allRoles) {
        if (!rolesByEvent[r.event_id]) rolesByEvent[r.event_id] = [];
        rolesByEvent[r.event_id].push(r);
      }
      const roleIds = allRoles.map(r => r.id).filter(Boolean);
      if (roleIds.length) {
        const rph = roleIds.map(() => '?').join(',');
        const counts = (await env.DB.prepare(
          `SELECT role_id, COUNT(*) as n FROM signup_slots WHERE role_id IN (${rph}) GROUP BY role_id`
        ).bind(...roleIds).all()).results || [];
        for (const c of counts) fillCounts[c.role_id] = c.n;
      }
    }

    const result = eventList.map(function(ev) {
      const roles = (rolesByEvent[ev.id] || []).map(function(r) {
        return { ...r, filled_count: fillCounts[r.id] || 0 };
      });
      return { ...ev, roles: applyXmasMarketDefaults(ev.name, roles) };
    });
    return json({ events: result });
  }

  if (seg === 'events' && method === 'POST') {
    const evRole = await getAuthRole(req, env);
    if (evRole !== 'admin' && evRole !== 'staff') return json({ error: 'Access denied' }, 403);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const useTimeSlots = (b.use_time_slots === undefined || b.use_time_slots === null) ? 1 : (b.use_time_slots ? 1 : 0);
    const slug = normalizeSlug(b.slug);
    if (slug) {
      if (RESERVED_SLUGS.includes(slug)) return json({ error: 'That short link is reserved for site navigation' }, 409);
      const taken = await env.DB.prepare('SELECT id FROM serve_events WHERE slug=?').bind(slug).first();
      if (taken) return json({ error: 'That short link is already used by another event' }, 409);
    }
    try {
      const r = await env.DB.prepare(
        'INSERT INTO serve_events (name,description,event_date,sort_order,use_time_slots,slug) VALUES (?,?,?,?,?,?)'
      ).bind(b.name||'New Event', b.description||'', b.event_date||'', b.sort_order||0, useTimeSlots, slug).run();
      return json({ ok: true, id: r.meta?.last_row_id });
    } catch (e) {
      if (slug && String(e?.message || '').includes('UNIQUE constraint')) {
        return json({ error: 'That short link is already used by another event' }, 409);
      }
      throw e;
    }
  }

  if (seg.startsWith('events/') && !seg.includes('/roles') && method === 'PUT') {
    const evRole = await getAuthRole(req, env);
    if (evRole !== 'admin' && evRole !== 'staff') return json({ error: 'Access denied' }, 403);
    const id = parseInt(seg.split('/')[1]);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const useTimeSlots = (b.use_time_slots === undefined || b.use_time_slots === null) ? 1 : (b.use_time_slots ? 1 : 0);
    const slug = normalizeSlug(b.slug);
    if (slug) {
      if (RESERVED_SLUGS.includes(slug)) return json({ error: 'That short link is reserved for site navigation' }, 409);
      const taken = await env.DB.prepare('SELECT id FROM serve_events WHERE slug=? AND id!=?').bind(slug, id).first();
      if (taken) return json({ error: 'That short link is already used by another event' }, 409);
    }
    try {
      await env.DB.prepare(
        'UPDATE serve_events SET name=?,description=?,event_date=?,hidden=?,sort_order=?,use_time_slots=?,slug=? WHERE id=?'
      ).bind(b.name, b.description||'', b.event_date||'', b.hidden?1:0, b.sort_order||0, useTimeSlots, slug, id).run();
      return json({ ok: true });
    } catch (e) {
      if (slug && String(e?.message || '').includes('UNIQUE constraint')) {
        return json({ error: 'That short link is already used by another event' }, 409);
      }
      throw e;
    }
  }

  if (seg.startsWith('events/') && !seg.includes('/roles') && method === 'DELETE') {
    const evRole = await getAuthRole(req, env);
    if (evRole !== 'admin' && evRole !== 'staff') return json({ error: 'Access denied' }, 403);
    const id = parseInt(seg.split('/')[1]);
    const roles = await env.DB.prepare('SELECT id FROM serve_roles WHERE event_id=?').bind(id).all();
    for (const r of (roles.results||[])) {
      await env.DB.prepare('DELETE FROM signup_slots WHERE role_id=?').bind(r.id).run();
    }
    await env.DB.prepare('DELETE FROM serve_roles WHERE event_id=?').bind(id).run();
    await env.DB.prepare('DELETE FROM serve_events WHERE id=?').bind(id).run();
    return json({ ok: true });
  }

  if (seg.match(/^events\/\d+\/roles$/) && method === 'POST') {
    const roleGuard = await getAuthRole(req, env);
    if (roleGuard !== 'admin' && roleGuard !== 'staff') return json({ error: 'Access denied' }, 403);
    const evId = parseInt(seg.split('/')[1]);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const r = await env.DB.prepare(
      'INSERT INTO serve_roles (event_id,name,description,slots,sort_order,role_date,start_time,end_time) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(evId, b.name||'New Role', b.description||'', b.slots||0, b.sort_order||0,
           b.role_date||'', b.start_time||'', b.end_time||'').run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }

  if (seg.match(/^events\/\d+\/roles\/\d+$/) && method === 'PUT') {
    const roleGuard = await getAuthRole(req, env);
    if (roleGuard !== 'admin' && roleGuard !== 'staff') return json({ error: 'Access denied' }, 403);
    const parts = seg.split('/'); const rid = parseInt(parts[3]);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    await env.DB.prepare(
      'UPDATE serve_roles SET name=?,description=?,slots=?,sort_order=?,role_date=?,start_time=?,end_time=? WHERE id=?'
    ).bind(b.name, b.description||'', b.slots||0, b.sort_order||0,
           b.role_date||'', b.start_time||'', b.end_time||'', rid).run();
    return json({ ok: true });
  }

  if (seg.match(/^events\/\d+\/roles\/\d+$/) && method === 'DELETE') {
    const roleGuard = await getAuthRole(req, env);
    if (roleGuard !== 'admin' && roleGuard !== 'staff') return json({ error: 'Access denied' }, 403);
    const parts = seg.split('/'); const rid = parseInt(parts[3]);
    await env.DB.prepare('DELETE FROM signup_slots WHERE role_id=?').bind(rid).run();
    await env.DB.prepare('DELETE FROM serve_roles WHERE id=?').bind(rid).run();
    return json({ ok: true });
  }

  if (seg.match(/^events\/\d+\/roster$/) && method === 'GET') {
    const evId = parseInt(seg.split('/')[1]);
    const ev = await env.DB.prepare('SELECT * FROM serve_events WHERE id=?').bind(evId).first();
    if (!ev) return json({ error: 'Not found' }, 404);
    const roles = await env.DB.prepare(
      'SELECT * FROM serve_roles WHERE event_id=? ORDER BY role_date,sort_order,id'
    ).bind(evId).all();
    const roster = [];
    for (const role of (roles.results || [])) {
      const vols = await env.DB.prepare(
        'SELECT s.name, s.email, s.phone FROM signup_slots ss JOIN signups s ON ss.signup_id=s.id WHERE ss.role_id=? ORDER BY s.name'
      ).bind(role.id).all();
      roster.push({
        id: role.id, name: role.name, description: role.description || '',
        role_date: role.role_date || '', start_time: role.start_time || '',
        end_time: role.end_time || '', slots: role.slots || 0,
        volunteers: (vols.results || []).map(function(v) {
          return { name: v.name, email: v.email, phone: v.phone || '' };
        }),
      });
    }
    return json({ event: { id: ev.id, name: ev.name, event_date: ev.event_date }, roster });
  }

  if (seg === 'export.csv' && method === 'GET') {
    const ministry = url.searchParams.get('ministry') || '';
    let q = 'SELECT s.*, e.name as event_name FROM signups s LEFT JOIN serve_events e ON s.event_id=e.id';
    const binds = [];
    if (ministry && ministry !== 'all') { q += ' WHERE s.ministry=?'; binds.push(ministry); }
    q += ' ORDER BY s.created_at DESC';
    const rows = await env.DB.prepare(q).bind(...binds).all();
    const cols = ['id','ministry','name','email','phone','roles','service','sundays','shirt_wanted','shirt_size','notes','event_name','created_at'];
    let csv = cols.join(',') + '\n';
    for (const r of (rows.results || [])) {
      csv += cols.map(c => {
        const v = r[c] == null ? '' : String(r[c]);
        return v.includes(',') || v.includes('"') || v.includes('\n') ? '"' + v.replace(/"/g,'""') + '"' : v;
      }).join(',') + '\n';
    }
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="volunteers-${new Date().toISOString().slice(0,10)}.csv"`
      }
    });
  }

  // ── Push broadcast ────────────────────────────────────────────────
  if (seg === 'push-broadcast' && method === 'POST') {
    const pbRole = await getAuthRole(req, env);
    if (pbRole !== 'admin' && pbRole !== 'staff') return json({ error: 'Access denied' }, 403);
    const { broadcastWebPush } = await import('./push-sender.js');
    let body;
    try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }
    const title    = (body?.title || '').trim();
    const bodyText = (body?.body  || '').trim();
    if (!title) return json({ error: 'title required' }, 400);
    const result = await broadcastWebPush({ title, body: bodyText, url: '/portal' }, env)
      .catch(e => ({ error: e.message }));
    return json(result);
  }

  // ── ChMS API dispatch ─────────────────────────────────────────────
  if (seg.startsWith('people') || seg.startsWith('households') ||
      seg.startsWith('tags')   || seg.startsWith('funds')      ||
      seg.startsWith('giving') || seg.startsWith('reports/')   ||
      seg.startsWith('import/') || seg.startsWith('attendance') ||
      seg.startsWith('register') || seg.startsWith('config')   ||
      seg.startsWith('followup') || seg.startsWith('audit')    ||
      seg.startsWith('organizations') || seg.startsWith('export/') ||
      seg.startsWith('prayer-requests') || seg.startsWith('engagement') ||
      seg.startsWith('utils/')         || seg.startsWith('tuition-aid') ||
      seg.startsWith('finance')        || seg.startsWith('brevo') ||
      seg === 'dashboard'      || seg === 'board'              ||
      seg === 'directory') {
    try {
      const role = await getAuthRole(req, env);
      if (!role) return json({ error: 'Unauthorized' }, 401);
      return await handleChmsApi(req, env, url, method, seg, role);
    } catch (e) {
      console.error('ChMS API error [' + method + ' ' + seg + ']:', e?.message, e?.stack);
      return json({ error: 'Internal server error. Please try again.' }, 500);
    }
  }

  // ── Volunteer email templates ────────────────────────────────────────
  if (seg.startsWith('volunteer-templates')) {
    const role = await getAuthRole(req, env);
    if (!role) return json({ error: 'Access denied' }, 403);
    if (method !== 'GET' && role !== 'admin' && role !== 'staff') return json({ error: 'Access denied' }, 403);
    return handleVolunteerTemplates(req, env, url, method);
  }

  // ── Signup: link to person ────────────────────────────────────────────
  const linkMatch = seg.match(/^signups\/(\d+)\/link-person$/);
  if (linkMatch && method === 'POST') {
    const role = await getAuthRole(req, env);
    if (role !== 'admin' && role !== 'staff') return json({ error: 'Access denied' }, 403);
    return handleSignupLinkPerson(req, env, parseInt(linkMatch[1]));
  }

  // ── Signup: send email ────────────────────────────────────────────────
  const sendMatch = seg.match(/^signups\/(\d+)\/send-email$/);
  if (sendMatch && method === 'POST') {
    const role = await getAuthRole(req, env);
    if (role !== 'admin' && role !== 'staff') return json({ error: 'Access denied' }, 403);
    return handleSignupSendEmail(req, env, parseInt(sendMatch[1]));
  }

  // ── Ministry Roles CRUD ───────────────────────────────────────────────
  if (seg === 'ministry-roles' && method === 'GET') {
    const ministry = url.searchParams.get('ministry') || '';
    let q = 'SELECT * FROM ministry_roles';
    const binds = [];
    if (ministry) { q += ' WHERE ministry=?'; binds.push(ministry); }
    q += ' ORDER BY sort_order, id';
    const rows = await env.DB.prepare(q).bind(...binds).all();
    return json({ roles: rows.results || [] });
  }

  if (seg === 'ministry-roles' && method === 'POST') {
    const mrRole = await getAuthRole(req, env);
    if (mrRole !== 'admin' && mrRole !== 'staff') return json({ error: 'Access denied' }, 403);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!b.name || !b.ministry) return json({ error: 'name and ministry required' }, 400);
    const VALID_MIN = ['worship','education','acceptance','outreach','general','lasm','wol','cfna'];
    if (!VALID_MIN.includes(b.ministry)) return json({ error: 'Invalid ministry' }, 400);
    const r = await env.DB.prepare(
      'INSERT INTO ministry_roles (ministry,name,description,commitment,training,sort_order,active) VALUES (?,?,?,?,?,?,1)'
    ).bind(b.ministry, b.name.trim(), b.description||'', b.commitment||'', b.training||'', b.sort_order||0).run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }

  if (seg.match(/^ministry-roles\/\d+$/) && method === 'PUT') {
    const mrRole = await getAuthRole(req, env);
    if (mrRole !== 'admin' && mrRole !== 'staff') return json({ error: 'Access denied' }, 403);
    const id = parseInt(seg.split('/')[1]);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    await env.DB.prepare(
      'UPDATE ministry_roles SET name=?,description=?,commitment=?,training=?,sort_order=?,active=? WHERE id=?'
    ).bind(b.name||'', b.description||'', b.commitment||'', b.training||'', b.sort_order||0, b.active===false?0:1, id).run();
    return json({ ok: true });
  }

  if (seg.match(/^ministry-roles\/\d+$/) && method === 'DELETE') {
    const mrRole = await getAuthRole(req, env);
    if (mrRole !== 'admin' && mrRole !== 'staff') return json({ error: 'Access denied' }, 403);
    const id = parseInt(seg.split('/')[1]);
    await env.DB.prepare('DELETE FROM ministry_roles WHERE id=?').bind(id).run();
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, 404);
}

// ── Public: ministry roles (no auth required) ─────────────────────────────────
export async function handleApiMinistryRoles(env, url) {
  const ministry = url.searchParams.get('ministry') || '';
  let q = 'SELECT id,ministry,name,description,commitment,training,sort_order FROM ministry_roles WHERE active=1';
  const binds = [];
  if (ministry) { q += ' AND ministry=?'; binds.push(ministry); }
  q += ' ORDER BY sort_order, id';
  const rows = await env.DB.prepare(q).bind(...binds).all();
  return json({ roles: rows.results || [] });
}

// ── Forgot password / reset (public) ─────────────────────────────────────────

async function _sendResetEmail(env, to, displayName, resetUrl) {
  const key = env.RESEND_API_KEY || '';
  const from = env.EMAIL_FROM || '';
  if (!key || !from) return { ok: false, error: 'Resend not configured' };
  const safeName = String(displayName || '').replace(/[&<>"]/g, '');
  const text = `Hi ${safeName || 'there'},\n\nA password reset was requested for your Connect account. ` +
    `Click the link below to set a new password. This link expires in 1 hour.\n\n${resetUrl}\n\n` +
    `If you didn't request this, ignore this email — your password won't change.\n\n— Timothy Lutheran Church`;
  const htmlBody = `<!DOCTYPE html><html><body style="font-family:Georgia,serif;background:#FAF7F0;margin:0;padding:32px 16px;">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px 32px;border:1px solid #E8E0D0;">
      <p style="font-size:1.1rem;color:#0A3C5C;font-weight:600;">Reset your Connect password</p>
      <p style="color:#3D3530;line-height:1.6;">Hi ${safeName || 'there'},</p>
      <p style="color:#3D3530;line-height:1.6;">A password reset was requested for your account. Click the button below to set a new password. This link expires in 1 hour.</p>
      <p style="margin:24px 0;"><a href="${resetUrl}" style="display:inline-block;background:#1E2D4A;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Reset password</a></p>
      <p style="color:#7A6E60;font-size:.85rem;">If you didn't request this, ignore this email — your password won't change.</p>
      <p style="color:#7A6E60;font-size:.8rem;margin-top:24px;border-top:1px solid #E8E0D0;padding-top:16px;">Timothy Lutheran Church &middot; 6704 Fyler Ave, St. Louis, MO 63139</p>
    </div></body></html>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: 'Reset your Connect password', text, html: htmlBody,
        reply_to: env.REPLY_TO_EMAIL || 'office@timothystl.org' }),
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.message || String(res.status) };
  } catch (e) { return { ok: false, error: e.message }; }
}

// POST /admin/forgot-password — form-encoded {username}. Always returns 200 so
// attackers can't enumerate accounts. Caller (login page) shows a generic
// "if an account exists, an email was sent" message regardless.
export async function handleForgotPassword(req, env) {
  if (!env.RSVP_STORE) return json({ ok: true });
  let body = ''; try { body = await req.text(); } catch {}
  const params = new URLSearchParams(body);
  const ident = (params.get('username') || '').trim().toLowerCase();
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `pw_reset_rl:${ip}`;
  const cur = parseInt(await env.RSVP_STORE.get(rlKey) || '0', 10);
  if (cur >= 5) return json({ ok: true });
  await env.RSVP_STORE.put(rlKey, String(cur + 1), { expirationTtl: 15 * 60 });

  if (!ident) return json({ ok: true });
  const u = await env.DB.prepare(
    `SELECT id, username, display_name, email, active FROM app_users
     WHERE (LOWER(username)=? OR LOWER(email)=?) AND active=1 LIMIT 1`
  ).bind(ident, ident).first().catch(() => null);
  if (!u || !u.email) return json({ ok: true });

  const token = randHex(32);
  await env.RSVP_STORE.put(`pw_reset:${token}`, JSON.stringify({
    user_id: u.id, username: u.username, ts: Date.now(),
  }), { expirationTtl: 3600 });
  const url = new URL(req.url);
  const resetUrl = `${url.origin}/admin/reset?token=${token}`;
  await _sendResetEmail(env, u.email, u.display_name || u.username, resetUrl).catch(() => {});
  return json({ ok: true });
}

// GET /admin/reset?token=... — serves the password-reset form.
// POST /admin/reset — form-encoded {token, password, password2}; updates DB.
export async function handleResetPassword(req, env, url) {
  const page = (title, inner) => authCardPage(title, `<div class="wm-display">ChMS</div>
      <div class="wm-sub">Reset password</div>
      ${inner}
      <div style="text-align:center;margin-top:1rem;"><a href="/chms">Back to sign in</a></div>`);

  if (req.method === 'GET') {
    const token = url.searchParams.get('token') || '';
    if (!token) return page('Reset', `<div class="msg err">No reset token provided.</div>`);
    if (!env.RSVP_STORE) return page('Reset', `<div class="msg err">Reset is unavailable.</div>`);
    const raw = await env.RSVP_STORE.get(`pw_reset:${token}`);
    if (!raw) return page('Reset', `<div class="msg err">This reset link has expired or is invalid.</div>`);
    return page('Reset', `<form method="POST" action="/admin/reset" onsubmit="var b=this.querySelector('.btn');b.disabled=true;b.textContent='Saving…';">
      <input type="hidden" name="token" value="${token}">
      <div class="field"><label>New password</label><input type="password" name="password" minlength="8" autofocus required></div>
      <div class="field"><label>Confirm password</label><input type="password" name="password2" minlength="8" required></div>
      <button class="btn" type="submit">Set new password</button>
    </form>`);
  }

  if (req.method === 'POST') {
    let body = ''; try { body = await req.text(); } catch {}
    const params = new URLSearchParams(body);
    const token = (params.get('token') || '').trim();
    const password = params.get('password') || '';
    const password2 = params.get('password2') || '';
    if (!token) return page('Reset', `<div class="msg err">Missing token.</div>`);
    if (password.length < 8) return page('Reset', `<div class="msg err">Password must be at least 8 characters.</div>`);
    if (password !== password2) return page('Reset', `<div class="msg err">Passwords do not match.</div>`);
    if (!env.RSVP_STORE) return page('Reset', `<div class="msg err">Reset is unavailable.</div>`);
    const raw = await env.RSVP_STORE.get(`pw_reset:${token}`);
    if (!raw) return page('Reset', `<div class="msg err">This reset link has expired or is invalid.</div>`);
    let rec; try { rec = JSON.parse(raw); } catch { return page('Reset', `<div class="msg err">Invalid token.</div>`); }
    if (!rec.user_id) return page('Reset', `<div class="msg err">Invalid token.</div>`);
    const hash = await hashPassword(password);
    await env.DB.prepare(`UPDATE app_users SET password_hash=? WHERE id=?`).bind(hash, rec.user_id).run();
    await env.RSVP_STORE.delete(`pw_reset:${token}`).catch(() => {});
    return page('Reset', `<div class="msg ok">Password updated. <a href="/chms">Sign in</a> with your new password.</div>`);
  }

  return page('Reset', `<div class="msg err">Method not allowed.</div>`);
}

