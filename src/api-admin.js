// ── Admin API handlers ─────────────────────────────────────────────────────────
import { html, json, isAuthed, authCookieHeader, getAuthRole, getAuthInfo, hashPassword, verifyPassword } from './auth.js';
import { handleChmsApi } from './api-chms.js';
import { LOGIN_HTML } from './html-templates.js';

export const SCHEDULER_KEYS = [
  'ws_people','ws_schedule_v2','ws_history','ws_last_served',
  'ws_schedule_overrides','ws_confirmations','ws_rsvp_tokens',
  'ws_sun_labels','ws_breeze_settings','ws_readings','ws_breeze_event_map'
];
export async function handleSchedulerDataApi(req, env, url, method) {
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
    return json({ role: role || 'unknown', username, display_name: displayName });
  }

  if (seg.startsWith('scheduler/')) return handleSchedulerDataApi(req, env, url, method);

  // ── Users management (admin only) ────────────────────────────────
  if (seg.startsWith('users')) {
    const reqRole = await getAuthRole(req, env);
    if (reqRole !== 'admin') return json({ error: 'Access denied' }, 403);

    // GET /admin/api/users — list all users
    if (seg === 'users' && method === 'GET') {
      const rows = (await env.DB.prepare(
        `SELECT id, username, display_name, role, active, created_at, last_login FROM app_users ORDER BY username`
      ).all()).results || [];
      return json({ users: rows });
    }

    // POST /admin/api/users — create user
    if (seg === 'users' && method === 'POST') {
      let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const username = (b.username || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (!username) return json({ error: 'Username is required' }, 400);
      if (!b.password || b.password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
      const validRoles = ['admin', 'finance', 'staff', 'member'];
      const role = validRoles.includes(b.role) ? b.role : 'staff';
      const existing = await env.DB.prepare(`SELECT id FROM app_users WHERE LOWER(username)=?`).bind(username).first();
      if (existing) return json({ error: 'Username already exists' }, 409);
      const hash = await hashPassword(b.password);
      const r = await env.DB.prepare(
        `INSERT INTO app_users (username, password_hash, display_name, role) VALUES (?,?,?,?)`
      ).bind(username, hash, b.display_name || '', role).run();
      return json({ ok: true, id: r.meta?.last_row_id });
    }

    // PUT /admin/api/users/:id — update user
    const umatch = seg.match(/^users\/(\d+)$/);
    if (umatch && method === 'PUT') {
      const uid = parseInt(umatch[1]);
      let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const validRoles = ['admin', 'finance', 'staff', 'member'];
      const role = validRoles.includes(b.role) ? b.role : undefined;
      // Build update
      const fields = [];
      const vals = [];
      if (b.display_name !== undefined) { fields.push('display_name=?'); vals.push(b.display_name || ''); }
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
    // Attach slot details; map to plain objects to ensure JSON serializability
    const signups = [];
    for (const s of (rows.results || [])) {
      const slotRows = await env.DB.prepare(
        `SELECT r.name, r.role_date, r.start_time, r.end_time FROM signup_slots ss JOIN serve_roles r ON ss.role_id=r.id WHERE ss.signup_id=?`
      ).bind(s.id).all();
      signups.push({
        id: s.id, event_id: s.event_id, role_id: s.role_id,
        ministry: s.ministry || '', name: s.name || '', email: s.email || '',
        phone: s.phone || '', roles: s.roles || '[]', service: s.service || '',
        sundays: s.sundays || '[]', shirt_wanted: s.shirt_wanted || 0,
        shirt_size: s.shirt_size || '', notes: s.notes || '',
        created_at: s.created_at || '', event_name: s.event_name || null,
        slot_details: (slotRows.results || []).map(function(sl) {
          return { name: sl.name || '', role_date: sl.role_date || '', start_time: sl.start_time || '', end_time: sl.end_time || '' };
        }),
      });
    }
    return json({ signups });
  }

  if (seg.startsWith('signups/') && method === 'DELETE') {
    const id = parseInt(seg.split('/')[1]);
    await env.DB.prepare('DELETE FROM signup_slots WHERE signup_id=?').bind(id).run();
    await env.DB.prepare('DELETE FROM signups WHERE id=?').bind(id).run();
    return json({ ok: true });
  }

  if (seg === 'events' && method === 'GET') {
    const events = await env.DB.prepare('SELECT * FROM serve_events ORDER BY sort_order,event_date,id').all();
    const result = [];
    for (const ev of (events.results || [])) {
      const roles = await env.DB.prepare(
        'SELECT * FROM serve_roles WHERE event_id=? ORDER BY role_date,sort_order,id'
      ).bind(ev.id).all();
      const rolesWithFill = [];
      for (const role of (roles.results || [])) {
        const filled = await env.DB.prepare('SELECT COUNT(*) as n FROM signup_slots WHERE role_id=?').bind(role.id).first();
        rolesWithFill.push({ ...role, filled_count: filled?.n || 0 });
      }
      result.push({ ...ev, roles: applyXmasMarketDefaults(ev.name, rolesWithFill) });
    }
    return json({ events: result });
  }

  if (seg === 'events' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const useTimeSlots = (b.use_time_slots === undefined || b.use_time_slots === null) ? 1 : (b.use_time_slots ? 1 : 0);
    const r = await env.DB.prepare(
      'INSERT INTO serve_events (name,description,event_date,sort_order,use_time_slots) VALUES (?,?,?,?,?)'
    ).bind(b.name||'New Event', b.description||'', b.event_date||'', b.sort_order||0, useTimeSlots).run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }

  if (seg.startsWith('events/') && !seg.includes('/roles') && method === 'PUT') {
    const id = parseInt(seg.split('/')[1]);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const useTimeSlots = (b.use_time_slots === undefined || b.use_time_slots === null) ? 1 : (b.use_time_slots ? 1 : 0);
    await env.DB.prepare(
      'UPDATE serve_events SET name=?,description=?,event_date=?,hidden=?,sort_order=?,use_time_slots=? WHERE id=?'
    ).bind(b.name, b.description||'', b.event_date||'', b.hidden?1:0, b.sort_order||0, useTimeSlots, id).run();
    return json({ ok: true });
  }

  if (seg.startsWith('events/') && !seg.includes('/roles') && method === 'DELETE') {
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
    const evId = parseInt(seg.split('/')[1]);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const r = await env.DB.prepare(
      'INSERT INTO serve_roles (event_id,name,description,slots,sort_order,role_date,start_time,end_time) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(evId, b.name||'New Role', b.description||'', b.slots||0, b.sort_order||0,
           b.role_date||'', b.start_time||'', b.end_time||'').run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }

  if (seg.match(/^events\/\d+\/roles\/\d+$/) && method === 'PUT') {
    const parts = seg.split('/'); const rid = parseInt(parts[3]);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    await env.DB.prepare(
      'UPDATE serve_roles SET name=?,description=?,slots=?,sort_order=?,role_date=?,start_time=?,end_time=? WHERE id=?'
    ).bind(b.name, b.description||'', b.slots||0, b.sort_order||0,
           b.role_date||'', b.start_time||'', b.end_time||'', rid).run();
    return json({ ok: true });
  }

  if (seg.match(/^events\/\d+\/roles\/\d+$/) && method === 'DELETE') {
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

  // ── ChMS API dispatch ─────────────────────────────────────────────
  if (seg.startsWith('people') || seg.startsWith('households') ||
      seg.startsWith('tags')   || seg.startsWith('funds')      ||
      seg.startsWith('giving') || seg.startsWith('reports/')   ||
      seg.startsWith('import/') || seg.startsWith('attendance') ||
      seg.startsWith('register') || seg.startsWith('config')   ||
      seg.startsWith('followup') || seg.startsWith('audit')    ||
      seg.startsWith('organizations') ||
      seg === 'dashboard'      || seg === 'board'              ||
      seg === 'directory') {
    try {
      const role = await getAuthRole(req, env);
      return await handleChmsApi(req, env, url, method, seg, role || 'admin');
    } catch (e) {
      console.error('ChMS API error [' + method + ' ' + seg + ']:', e?.message, e?.stack);
      return json({ error: 'Internal server error. Please try again.' }, 500);
    }
  }

  return json({ error: 'Not found' }, 404);
}

