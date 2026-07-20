// ── Scheduler & Volunteer API handlers ────────────────────────────────────────
import { json, SCHED_CORS, getAuthRole } from './auth.js';
import { XMAS_MARKET_ROLES } from './db.js';

// Centralized office reply-to so it can be overridden via env.
function officeEmail(env) { return (env && env.REPLY_TO_EMAIL) || 'office@timothystl.org'; }

// Pretty service time from internal token.
function formatServiceTime(svc) {
  if (svc === '8am') return '8:00 AM';
  if (svc === '10:45am') return '10:45 AM';
  return svc;
}

// Pretty RSVP status label.
function formatRsvpStatus(s) {
  if (s === 'confirmed') return '✓ Confirmed';
  if (s === 'needs_changes') return '⚠ Needs Changes';
  if (s === 'declined') return '✗ Declined';
  return '';
}


// ── XMAS MARKET TIME FALLBACK ─────────────────────────────────────────
// For roles where D1 has empty start_time, overlay XMAS_MARKET_ROLES data
// using sort_order as the index. Allows the schedule to show even if the
// migration hasn't propagated yet in D1's eventual-consistency model.
export function applyXmasMarketDefaults(evName, roles) {
  if (evName !== 'Christmas Market') return roles;
  return roles.map(function(role) {
    if (role.start_time) return role;
    const xr = (role.sort_order >= 0 && role.sort_order < XMAS_MARKET_ROLES.length)
      ? XMAS_MARKET_ROLES[role.sort_order] : null;
    if (!xr) return role;
    return Object.assign({}, role, { role_date: role.role_date || xr.role_date, start_time: xr.start_time, end_time: xr.end_time });
  });
}

// ── PUBLIC API: GET /api/events ───────────────────────────────────────
export async function handleApiEvents(env) {
  const events = await env.DB.prepare(
    'SELECT * FROM serve_events WHERE hidden=0 ORDER BY sort_order,event_date,id'
  ).all();
  const result = [];
  for (const ev of (events.results || [])) {
    const roles = await env.DB.prepare(
      'SELECT * FROM serve_roles WHERE event_id=? ORDER BY role_date,sort_order,id'
    ).bind(ev.id).all();
    const rolesWithFill = [];
    for (const role of (roles.results || [])) {
      const filled = await env.DB.prepare(
        'SELECT COUNT(*) as n FROM signup_slots WHERE role_id=?'
      ).bind(role.id).first();
      rolesWithFill.push({ ...role, filled_count: filled?.n || 0 });
    }
    result.push({ ...ev, roles: applyXmasMarketDefaults(ev.name, rolesWithFill) });
  }
  return json({ events: result });
}

// ── RATE LIMITING ─────────────────────────────────────────────────────
// Allows max 10 signups per IP per hour using KV as a counter store.
export async function checkSignupRateLimit(env, req) {
  if (!env.RSVP_STORE) return true;
  try {
    const ip = req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || 'unknown';
    const key = 'rl:signup:' + ip;
    const current = await env.RSVP_STORE.get(key);
    const count = current ? parseInt(current, 10) : 0;
    if (count >= 10) return false;
    await env.RSVP_STORE.put(key, String(count + 1), { expirationTtl: 3600 });
    return true;
  } catch (e) {
    console.error('Rate limit check error (allowing request):', e);
    return true; // fail open — don't block signups due to KV errors
  }
}

// ── PUBLIC API: POST /serve/signup (was /volunteer/signup — old path still aliased) ──
export async function handleSignup(req, env) {
  if (!await checkSignupRateLimit(env, req)) {
    return json({ ok: false, error: 'Too many submissions. Please try again later.' }, 429);
  }
  let data;
  try { data = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
  const name  = (data.name || '').trim();
  const email = (data.email || '').trim().toLowerCase();
  if (!name || !email) return json({ ok: false, error: 'Name and email required' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'Please enter a valid email address.' }, 400);

  // Duplicate signup check: same email + same event
  if (data.event_id) {
    const dup = await env.DB.prepare(
      'SELECT id FROM signups WHERE email=? AND event_id=? LIMIT 1'
    ).bind(email, data.event_id).first();
    if (dup) return json({ ok: false, error: "You've already signed up for this event. Contact us if you need to make changes." }, 409);
  }

  // Validate slot availability for time-slotted signups
  const roleIds = Array.isArray(data.role_ids) ? data.role_ids : [];
  for (const rid of roleIds) {
    const role   = await env.DB.prepare('SELECT slots FROM serve_roles WHERE id=?').bind(rid).first();
    const filled = await env.DB.prepare('SELECT COUNT(*) as n FROM signup_slots WHERE role_id=?').bind(rid).first();
    if (role && role.slots > 0 && (filled?.n || 0) >= role.slots) {
      return json({ ok: false, error: 'One or more selected shifts are now full. Please refresh and try again.' }, 409);
    }
  }

  const r = await env.DB.prepare(
    `INSERT INTO signups (event_id,role_id,ministry,name,email,phone,roles,service,sundays,shirt_wanted,shirt_size,notes,sms_reminder_opt_in)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    data.event_id || 0, data.role_id || 0,
    data.ministry || '', name, email, data.phone || '',
    JSON.stringify(data.roles || roleIds.map(String)),
    data.service || '', JSON.stringify(data.sundays || []),
    data.shirt_wanted ? 1 : 0, data.shirt_size || '', data.notes || '',
    data.sms_reminder_opt_in ? 1 : 0
  ).run();
  const signupId = r.meta?.last_row_id;

  for (const rid of roleIds) {
    await env.DB.prepare('INSERT INTO signup_slots (signup_id,role_id) VALUES (?,?)')
      .bind(signupId, rid).run();
  }

  // Send confirmation email to volunteer (non-fatal if email is not configured)
  const resendKey = env.RESEND_API_KEY || '';
  const emailFrom = env.EMAIL_FROM || '';
  if (resendKey && emailFrom && email) {
    const ministry = data.ministry || 'general';
    const ministryLabels = { worship: 'Worship', events: 'Community Events', education: 'Christian Education',
      acceptance: 'Acceptance Ministry', outreach: 'Outreach', transportation: 'Transportation Ministry',
      lasm: 'LASM', wol: 'Word of Life', cfna: 'CFNA', general: 'General Interest' };
    const ministryLabel = ministryLabels[ministry] || ministry;
    const rolesList = (data.roles && data.roles.length) ? data.roles.join(', ') : '';
    const rolesLine = rolesList ? `\nRoles/shifts selected: ${rolesList}` : '';
    const text = `Hi ${name},\n\nThank you for signing up to volunteer at Timothy Lutheran Church!\n\n`
      + `Ministry: ${ministryLabel}${rolesLine}\n\n`
      + `We'll be in touch soon with more details. If you have any questions, reply to this email.\n\n`
      + `God's blessings,\nTimothy Lutheran Church\n6704 Fyler Ave, St. Louis, MO 63139\noffice@timothystl.org`;
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: emailFrom, to: email, reply_to: officeEmail(env),
        subject: 'Thanks for signing up to serve at Timothy!', text }),
    }).catch(() => { /* non-fatal */ });
  }

  // Notify the office of the new sign-up, if enabled in Settings
  if (resendKey && emailFrom) {
    const notifyRow = await env.DB.prepare("SELECT value FROM chms_config WHERE key='notify_new_signup'").first();
    if (notifyRow && notifyRow.value === '1') {
      const notifyEmailRow = await env.DB.prepare("SELECT value FROM chms_config WHERE key='volunteer_public_email'").first();
      const notifyTo = (notifyEmailRow && notifyEmailRow.value) || officeEmail(env);
      const rolesList = (data.roles && data.roles.length) ? data.roles.join(', ') : '';
      const notifyText = `New volunteer sign-up:\n\nName: ${name}\nEmail: ${email}\nPhone: ${data.phone || '(none)'}\nMinistry: ${data.ministry || '(none)'}${rolesList ? `\nRoles/shifts: ${rolesList}` : ''}${data.notes ? `\nNotes: ${data.notes}` : ''}`;
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: emailFrom, to: notifyTo, reply_to: email,
          subject: `New volunteer sign-up: ${name}`, text: notifyText }),
      }).catch(() => { /* non-fatal */ });
    }
  }

  return json({ ok: true, signup_id: signupId });
}

// ── ICAL DOWNLOAD: GET /serve/calendar/:id (was /volunteer/calendar/:id — aliased) ──
export async function handleCalendar(env, path) {
  const signupId = parseInt(path.split('/').pop());
  const signup = await env.DB.prepare('SELECT * FROM signups WHERE id=?').bind(signupId).first();
  if (!signup) return new Response('Not found', { status: 404 });

  const slots = await env.DB.prepare(`
    SELECT ss.role_id, r.name as role_name, r.description, r.role_date, r.start_time, r.end_time, e.name as event_name
    FROM signup_slots ss
    JOIN serve_roles r ON ss.role_id = r.id
    JOIN serve_events e ON r.event_id = e.id
    WHERE ss.signup_id = ?
  `).bind(signupId).all();

  const ical = generateIcal(signup, slots.results || []);
  return new Response(ical, {
    headers: {
      'Content-Type': 'text/calendar;charset=UTF-8',
      'Content-Disposition': `attachment; filename="tlc-volunteer-shifts.ics"`
    }
  });
}

function parseIcalTime(dateStr, timeStr) {
  // dateStr: "2026-12-04", timeStr: "9:00 AM"
  if (!dateStr || !timeStr) return null;
  const [y, mo, d] = dateStr.split('-');
  const parts = timeStr.trim().split(' ');
  const [hStr, mStr] = parts[0].split(':');
  const ampm = (parts[1] || '').toUpperCase();
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return `${y}${mo}${d}T${String(h).padStart(2,'0')}${String(m).padStart(2,'0')}00`;
}

function generateIcal(signup, slots) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//Timothy Lutheran Church//Volunteer Sign-Up//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-TIMEZONE:America/Chicago',
  ];
  for (const slot of slots) {
    const dtstart = parseIcalTime(slot.role_date, slot.start_time);
    const dtend   = parseIcalTime(slot.role_date, slot.end_time);
    if (!dtstart || !dtend) continue;
    const desc = (slot.description || '').replace(/\n/g,'\\n').replace(/,/g,'\\,');
    lines.push(
      'BEGIN:VEVENT',
      `UID:tlc-${signup.id}-${slot.role_id}@timothystl.org`,
      `DTSTART;TZID=America/Chicago:${dtstart}`,
      `DTEND;TZID=America/Chicago:${dtend}`,
      `SUMMARY:${slot.event_name} – ${slot.role_name}`,
      `DESCRIPTION:${desc}`,
      'LOCATION:Timothy Lutheran Church\\, 6704 Fyler Ave\\, St. Louis\\, MO 63139',
      `ORGANIZER;CN=Timothy Lutheran Church:mailto:office@timothystl.org`,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// ── SCHEDULER DATA API ────────────────────────────────────────────────
// All endpoints require vol_auth cookie (same auth as /admin).
// v2 — redeploy to ensure worker picks up Phase 1 code
// GET  /admin/api/scheduler/data          → full snapshot as JSON object
// POST /admin/api/scheduler/data          → bulk upsert (import / full save)
// GET  /admin/api/scheduler/data/:key     → single key value
// POST /admin/api/scheduler/data/:key     → save single key { value: ... }
// GET  /admin/api/scheduler/export        → download full snapshot as file

// ── SCHEDULER BACKEND HANDLERS ──────────────────────────────────────────────
// Breeze API proxy, email sending, and RSVP for the worship scheduler.

export function schedJson(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { ...SCHED_CORS, 'Content-Type': 'application/json' },
  });
}

export function schedHtmlPage(title, bodyContent) {
  const e = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const content = '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + e(title) + ' — Timothy Lutheran</title>'
    + '<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;color:#222;}'
    + 'h1{color:#2c3e6b;}a{color:#2c3e6b;}</style></head>'
    + '<body><h1>' + e(title) + '</h1>' + bodyContent + '</body></html>';
  return new Response(content, { status: 200, headers: { ...SCHED_CORS, 'Content-Type': 'text/html;charset=utf-8' } });
}

export async function schedKvGet(env, key) {
  if (!env.RSVP_STORE) return null;
  try { const raw = await env.RSVP_STORE.get(key); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}

export async function schedKvPut(env, key, value) {
  if (!env.RSVP_STORE) return;
  await env.RSVP_STORE.put(key, JSON.stringify(value), { expirationTtl: 31536000 });
}

// ── /email/send ──────────────────────────────────────────────────────────────
export async function handleSchedEmailSend(req, env) {
  // env is the single source of truth — set RESEND_API_KEY + EMAIL_FROM on
  // the Worker and rotate them there. The X-Resend-Key / X-Email-From
  // headers are no longer read; old scheduler UI builds may still send them
  // but they're ignored.
  const resendKey = env.RESEND_API_KEY || '';
  const emailFrom = env.EMAIL_FROM || '';
  if (!resendKey) return schedJson({ error: 'RESEND_API_KEY not set on the Worker' }, 500);
  if (!emailFrom) return schedJson({ error: 'EMAIL_FROM not set on the Worker' }, 500);
  let body;
  try { body = await req.json(); } catch { return schedJson({ error: 'Invalid JSON' }, 400); }
  const payload = { from: emailFrom || body.from || '', to: body.to, subject: body.subject,
                    text: body.text, html: body.html, reply_to: body.reply_to || undefined };
  if (body.attachments) payload.attachments = body.attachments;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  return schedJson(data, res.status);
}

// ── /rsvp/store ──────────────────────────────────────────────────────────────
export async function handleSchedRsvpStore(req, env) {
  let body;
  try { body = await req.json(); } catch { return schedJson({ error: 'Invalid JSON' }, 400); }
  const { token, name, personId, email, notifyEmail, assignments } = body;
  if (!token) return schedJson({ error: 'Missing token' }, 400);
  const existing = await schedKvGet(env, token);
  const record = existing || { token, name, personId, email: email||'', notifyEmail: notifyEmail||'', assignments: assignments||[], responses: {} };
  record.name        = name        || record.name;
  record.personId    = personId    || record.personId;
  record.email       = email       || record.email;
  record.notifyEmail = notifyEmail || record.notifyEmail;
  record.assignments = assignments || record.assignments;
  await schedKvPut(env, token, record);
  return schedJson({ ok: true });
}

// ── /rsvp/sync ───────────────────────────────────────────────────────────────
export async function handleSchedRsvpSync(req, env) {
  let body;
  try { body = await req.json(); } catch { return schedJson({ error: 'Invalid JSON' }, 400); }
  const tokens = body.tokens || [];
  const results = {};
  await Promise.all(tokens.map(async function(token) {
    const record = await schedKvGet(env, token);
    if (!record) return;
    results[token] = {
      status:      record.overallStatus || 'pending',
      name:        record.name          || '',
      updatedAt:   record.updatedAt     || '',
      assignments: (record.assignments  || []).map(function(a) {
        return { dateISO: a.dateISO, svc: a.svc, role: a.role, status: a.status || 'pending' };
      }),
    };
  }));
  return schedJson(results);
}

// ── /serve/pending (was /volunteer/pending — aliased) ──────────────────────────
// Returns worship-role signups (ministry='worship', no specific event)
export async function handleVolunteerPending(env) {
  try {
    const rows = await env.DB.prepare(
      `SELECT id, name, email, phone, roles, service, sundays, notes, created_at
       FROM signups WHERE ministry='worship' AND (event_id IS NULL OR event_id=0)
       ORDER BY created_at DESC`
    ).all();
    const volunteers = (rows.results || []).map(function(r) {
      return {
        id: r.id, name: r.name, email: r.email, phone: r.phone || '',
        roles: safeJsonParse(r.roles, []),
        service: r.service || 'both',
        sundays: safeJsonParse(r.sundays, []),
        notes: r.notes || '',
        submittedAt: r.created_at,
      };
    });
    return schedJson({ volunteers });
  } catch(e) {
    return schedJson({ error: String(e) }, 500);
  }
}

// ── /serve/general-pending (was /volunteer/general-pending — aliased) ──────────
// Returns general/ministry signups (not worship, no specific event)
export async function handleVolunteerGeneralPending(env) {
  try {
    const rows = await env.DB.prepare(
      `SELECT id, name, email, phone, roles, ministry, notes, created_at
       FROM signups WHERE ministry!='worship' AND (event_id IS NULL OR event_id=0)
       ORDER BY created_at DESC`
    ).all();
    const volunteers = (rows.results || []).map(function(r) {
      return {
        id: r.id, name: r.name, email: r.email, phone: r.phone || '',
        roles: safeJsonParse(r.roles, []),
        ministry: r.ministry || '',
        notes: r.notes || '',
        submittedAt: r.created_at,
      };
    });
    return schedJson({ volunteers });
  } catch(e) {
    return schedJson({ error: String(e) }, 500);
  }
}

// ── /serve/event-pending (was /volunteer/event-pending — aliased) ──────────────
// Returns event-specific signups (event_id > 0)
export async function handleVolunteerEventPending(env) {
  try {
    const rows = await env.DB.prepare(
      `SELECT s.id, s.name, s.email, s.phone, s.roles, s.notes, s.created_at,
              s.event_id, e.name AS event_name
       FROM signups s
       LEFT JOIN serve_events e ON e.id = s.event_id
       WHERE s.event_id IS NOT NULL AND s.event_id > 0
       ORDER BY s.created_at DESC`
    ).all();
    const volunteers = (rows.results || []).map(function(r) {
      return {
        id: r.id, name: r.name, email: r.email, phone: r.phone || '',
        roles: safeJsonParse(r.roles, []),
        eventId: r.event_id,
        eventName: r.event_name || '',
        notes: r.notes || '',
        submittedAt: r.created_at,
      };
    });
    return schedJson({ volunteers });
  } catch(e) {
    return schedJson({ error: String(e) }, 500);
  }
}

function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// ── /rsvp/portal ─────────────────────────────────────────────────────────────
export async function handleSchedRsvpPortal(req, env, url) {
  const token = url.searchParams.get('token') || '';
  if (!token) return schedHtmlPage('Error', '<p>Missing token.</p>');
  const record = await schedKvGet(env, token);
  if (!record) return schedHtmlPage('Not Found', '<p>This link has expired or is invalid.</p>');
  const e = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const rows = (record.assignments || []).map(function(a, i) {
    const svcLabel = formatServiceTime(a.svc);
    const cfUrl = url.origin+'/rsvp?token='+encodeURIComponent(token)+'&idx='+i+'&status=confirmed';
    const ncUrl = url.origin+'/rsvp?token='+encodeURIComponent(token)+'&idx='+i+'&status=needs_changes';
    const dcUrl = url.origin+'/rsvp?token='+encodeURIComponent(token)+'&idx='+i+'&status=declined';
    const st = a.status||'pending';
    const stLabel = formatRsvpStatus(st);
    return '<tr>'
      +'<td style="padding:8px 12px;border-bottom:1px solid #eee;">'+e(a.date)+'</td>'
      +'<td style="padding:8px 12px;border-bottom:1px solid #eee;">'+e(svcLabel)+'</td>'
      +'<td style="padding:8px 12px;border-bottom:1px solid #eee;">'+e(a.role)+'</td>'
      +'<td style="padding:8px 12px;border-bottom:1px solid #eee;color:#555;">'+e(stLabel)+'</td>'
      +'<td style="padding:8px 12px;border-bottom:1px solid #eee;">'
      +'<a href="'+e(cfUrl)+'" style="margin-right:8px;color:#27ae60;">✓ Confirm</a>'
      +'<a href="'+e(ncUrl)+'" style="margin-right:8px;color:#e67e22;">⚠ Change</a>'
      +'<a href="'+e(dcUrl)+'" style="color:#c0392b;">✗ Decline</a>'
      +'</td></tr>';
  }).join('');
  const body = '<h2 style="margin-bottom:4px;">Hello, '+e(record.name)+'</h2>'
    +'<p style="color:#555;margin-bottom:20px;">Your upcoming worship service assignments:</p>'
    +'<table style="border-collapse:collapse;width:100%;font-size:.9rem;">'
    +'<thead><tr>'
    +'<th style="text-align:left;padding:8px 12px;background:#f5f6fa;">Date</th>'
    +'<th style="text-align:left;padding:8px 12px;background:#f5f6fa;">Service</th>'
    +'<th style="text-align:left;padding:8px 12px;background:#f5f6fa;">Role</th>'
    +'<th style="text-align:left;padding:8px 12px;background:#f5f6fa;">Status</th>'
    +'<th style="text-align:left;padding:8px 12px;background:#f5f6fa;">Response</th>'
    +'</tr></thead><tbody>'+rows+'</tbody></table>';
  return schedHtmlPage('Your Worship Schedule', body);
}

// ── /rsvp ────────────────────────────────────────────────────────────────────
export async function handleSchedRsvp(req, env, url) {
  const token  = url.searchParams.get('token')  || '';
  const status = url.searchParams.get('status') || '';
  const idx    = url.searchParams.get('idx');
  if (!token || !status) return schedHtmlPage('Error', '<p>Invalid link.</p>');
  const record = await schedKvGet(env, token);
  if (!record) return schedHtmlPage('Not Found', '<p>This link has expired or is invalid.</p>');
  if (!['confirmed','needs_changes','declined'].includes(status)) return schedHtmlPage('Error', '<p>Unknown status.</p>');
  if (idx !== null && idx !== undefined) {
    const i = parseInt(idx, 10);
    if (!isNaN(i) && record.assignments[i]) record.assignments[i].status = status;
  } else {
    record.assignments.forEach(function(a) { a.status = status; });
  }
  record.overallStatus = status;
  record.updatedAt = new Date().toISOString();
  await schedKvPut(env, token, record);
  // Notify admin (non-fatal)
  const notifyEmail = record.notifyEmail || '';
  if (notifyEmail) {
    const resendKey = env.RESEND_API_KEY || '';
    const emailFrom = env.EMAIL_FROM || '';
    if (resendKey && emailFrom) {
      const statusLabel = formatRsvpStatus(status) || status;
      const assignmentLines = (record.assignments||[]).map(function(a) {
        return '  • '+a.date+' — '+formatServiceTime(a.svc)+' — '+a.role;
      }).join('\n');
      const notifPayload = { from: emailFrom, to: notifyEmail,
        subject: 'Worship Scheduler: '+record.name+' — '+statusLabel,
        text: record.name+' responded to their worship service assignments.\n\nStatus: '+statusLabel+'\n\nAssignments:\n'+assignmentLines,
      };
      if (record.email) notifPayload.reply_to = record.email;
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer '+resendKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(notifPayload),
      }).catch(function(){});
    }
  }
  const msgMap = {
    confirmed:     { h: 'Thank you!',         b: "You're confirmed. We look forward to serving with you." },
    needs_changes: { h: 'Got it!',            b: "We'll be in touch to work out the details." },
    declined:      { h: 'Response recorded.', b: "We'll find someone else for these dates. Thank you for letting us know." },
  };
  const msg = msgMap[status] || { h: 'Response recorded.', b: '' };
  return schedHtmlPage(msg.h, '<p>'+msg.b+'</p>');
}

// ── Breeze API proxy (/api/* and /breeze/*) ───────────────────────────────────
export async function handleSchedBreezeProxy(req, env, url) {
  const breezeSubdomain = env.BREEZE_SUBDOMAIN || req.headers.get('X-Breeze-Subdomain') || '';
  const breezeApiKey    = env.BREEZE_API_KEY    || req.headers.get('X-Breeze-Api-Key')    || '';
  if (!breezeSubdomain || !breezeApiKey) return schedJson({ error: 'Breeze not configured' }, 500);
  const breezePath = url.pathname.replace(/^\/(breeze|api)/, '');
  const breezeUrl  = 'https://'+breezeSubdomain+'.breezechms.com/api'+breezePath+url.search;
  const res = await fetch(breezeUrl, {
    method:  req.method,
    headers: { 'Api-key': breezeApiKey, 'Content-Type': 'application/json' },
    body:    req.method !== 'GET' ? req.body : undefined,
  });
  const data = await res.text();
  return new Response(data, {
    status:  res.status,
    headers: { ...SCHED_CORS, 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
  });
}

// ── VOLUNTEER EMAIL TEMPLATES ─────────────────────────────────────────────
// GET    /admin/api/volunteer-templates
// POST   /admin/api/volunteer-templates
// PUT    /admin/api/volunteer-templates/:id
// DELETE /admin/api/volunteer-templates/:id
export async function handleVolunteerTemplates(req, env, url, method) {
  const db = env.DB;
  const seg = url.pathname.replace('/admin/api/volunteer-templates', '').replace(/^\//, '');
  const idPart = seg ? parseInt(seg) : 0;

  if (!seg && method === 'GET') {
    const rows = (await db.prepare('SELECT * FROM volunteer_email_templates ORDER BY ministry, name').all()).results || [];
    return json({ templates: rows });
  }

  if (!seg && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!b.name || !b.subject || !b.body) return json({ error: 'name, subject, and body are required' }, 400);
    const r = await db.prepare(
      `INSERT INTO volunteer_email_templates (name, ministry, subject, body) VALUES (?,?,?,?)`
    ).bind(b.name.trim(), b.ministry || '', b.subject.trim(), b.body.trim()).run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }

  if (idPart && method === 'PUT') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    await db.prepare(
      `UPDATE volunteer_email_templates SET name=?, ministry=?, subject=?, body=? WHERE id=?`
    ).bind(b.name || '', b.ministry || '', b.subject || '', b.body || '', idPart).run();
    return json({ ok: true });
  }

  if (idPart && method === 'DELETE') {
    await db.prepare('DELETE FROM volunteer_email_templates WHERE id=?').bind(idPart).run();
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, 404);
}

// ── SIGNUP: LINK TO PERSON ────────────────────────────────────────────────
// POST /admin/api/signups/:id/link-person
// Body: { person_id: number } — link to existing person
//    OR { create: true } — create new visitor from signup data
export async function handleSignupLinkPerson(req, env, signupId) {
  const db = env.DB;
  const signup = await db.prepare('SELECT * FROM signups WHERE id=?').bind(signupId).first();
  if (!signup) return json({ error: 'Signup not found' }, 404);

  let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  if (b.create) {
    // Split "First Last" into parts; anything after first word is last name
    const parts = (signup.name || '').trim().split(/\s+/);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ');
    const r = await db.prepare(
      `INSERT INTO people (first_name, last_name, email, phone, member_type, first_contact_date)
       VALUES (?,?,?,?,?,date('now'))`
    ).bind(firstName, lastName, signup.email || '', signup.phone || '', 'visitor').run();
    const personId = r.meta?.last_row_id;
    await db.prepare('UPDATE signups SET person_id=? WHERE id=?').bind(personId, signupId).run();
    return json({ ok: true, person_id: personId, created: true });
  }

  if (b.person_id) {
    const exists = await db.prepare('SELECT id FROM people WHERE id=?').bind(b.person_id).first();
    if (!exists) return json({ error: 'Person not found' }, 404);
    await db.prepare('UPDATE signups SET person_id=? WHERE id=?').bind(b.person_id, signupId).run();
    return json({ ok: true, person_id: b.person_id, created: false });
  }

  if (b.person_id === null || b.unlink) {
    await db.prepare('UPDATE signups SET person_id=NULL WHERE id=?').bind(signupId).run();
    return json({ ok: true, person_id: null });
  }

  return json({ error: 'person_id or create:true required' }, 400);
}

// ── SIGNUP: SEND EMAIL ────────────────────────────────────────────────────
// POST /admin/api/signups/:id/send-email
// Body: { subject: string, body: string, reply_to?: string }
export async function handleSignupSendEmail(req, env, signupId) {
  const db = env.DB;
  const signup = await db.prepare('SELECT * FROM signups WHERE id=?').bind(signupId).first();
  if (!signup) return json({ error: 'Signup not found' }, 404);

  const email = (signup.email || '').trim();
  if (!email) return json({ error: 'This volunteer has no email address' }, 400);

  let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const subject = (b.subject || '').trim();
  const body    = (b.body    || '').trim();
  if (!subject || !body) return json({ error: 'subject and body are required' }, 400);

  const resendKey = env.RESEND_API_KEY || '';
  const emailFrom = env.EMAIL_FROM || '';
  if (!resendKey || !emailFrom) return json({ error: 'Email not configured (RESEND_API_KEY / EMAIL_FROM missing)' }, 500);

  const replyTo = (b.reply_to || officeEmail(env)).trim();
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: emailFrom, to: email, reply_to: replyTo, subject, text: body }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return json({ error: 'Resend error: ' + errText }, 502);
  }

  await db.prepare(
    `UPDATE signups SET contacted_at=datetime('now'), contact_count=contact_count+1, status=CASE WHEN status='new' THEN 'contacted' ELSE status END WHERE id=?`
  ).bind(signupId).run();

  await db.prepare(
    `INSERT INTO audit_log (action, object_type, object_id, object_json) VALUES ('volunteer_email_sent', 'signup', ?, ?)`
  ).bind(signupId, JSON.stringify({ to: email, subject })).run().catch(() => {});

  return json({ ok: true });
}

// ── SCHEDULER VOLUNTEERS (SC6 Phase 1) ────────────────────────────────────
// Relationalized replacement for the scheduler_data blob's 'ws_people' key — a Scheduler
// volunteer IS a real `people` row (person_id), not a separate client-generated identity.
// Phase 1 is additive only: this table is not yet read/written by the Scheduler UI, so
// shipping it changes no live behavior. Person search for linking reuses the existing
// GET /admin/api/people?q= endpoint — no Breeze lookup involved.
function parseJsonArray(v, fallback) {
  if (v === undefined) return fallback;
  if (Array.isArray(v)) return v;
  return fallback;
}
function parseJsonObject(v, fallback) {
  if (v === undefined) return fallback;
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  return fallback;
}
const SCHED_SERVICE_PREFS = ['both', '8am', '10:45am'];

function volunteerRowOut(row) {
  return {
    person_id: row.person_id,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    photo_url: row.photo_url,
    reminder_email: row.reminder_email,
    roles: JSON.parse(row.roles || '[]'),
    primary_for: JSON.parse(row.primary_for || '[]'),
    preferred_sundays: JSON.parse(row.preferred_sundays || '[]'),
    service_preference: row.service_preference,
    role_sunday_overrides: JSON.parse(row.role_sunday_overrides || '{}'),
    blackout_dates: JSON.parse(row.blackout_dates || '[]'),
    absence_start: row.absence_start,
    absence_until: row.absence_until,
    active: !!row.active,
    migrated_from_legacy_id: row.migrated_from_legacy_id || '',
  };
}

const VOLUNTEER_SELECT = `SELECT sv.*, p.first_name, p.last_name, p.email, p.photo_url
  FROM scheduler_volunteers sv JOIN people p ON p.id = sv.person_id`;

// Shared upsert used by both the direct POST endpoint and the migration-commit flow.
// migrated_from_legacy_id is only ever written on the initial INSERT — a later re-POST/PATCH
// of the same person never touches it, so provenance of a migrated row is permanent.
async function upsertVolunteer(db, personId, fields, legacyId) {
  await db.prepare(
    `INSERT INTO scheduler_volunteers
      (person_id, reminder_email, roles, primary_for, preferred_sundays, service_preference,
       role_sunday_overrides, blackout_dates, absence_start, absence_until, active,
       migrated_from_legacy_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'))
     ON CONFLICT(person_id) DO UPDATE SET
       reminder_email=excluded.reminder_email, roles=excluded.roles, primary_for=excluded.primary_for,
       preferred_sundays=excluded.preferred_sundays, service_preference=excluded.service_preference,
       role_sunday_overrides=excluded.role_sunday_overrides, blackout_dates=excluded.blackout_dates,
       absence_start=excluded.absence_start, absence_until=excluded.absence_until,
       active=1, updated_at=datetime('now')`
  ).bind(
    personId, fields.reminder_email || '', JSON.stringify(fields.roles || []), JSON.stringify(fields.primary_for || []),
    JSON.stringify(fields.preferred_sundays || []), SCHED_SERVICE_PREFS.includes(fields.service_preference) ? fields.service_preference : 'both',
    JSON.stringify(fields.role_sunday_overrides || {}), JSON.stringify(fields.blackout_dates || []),
    fields.absence_start || '', fields.absence_until || '', legacyId || ''
  ).run();
}

// Splits "First Last" the same way handleSignupLinkPerson does — anything after the first
// word becomes the last name.
function splitLegacyName(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}

// Suggests a real `people` match for one legacy ws_people entry. Never picks silently for the
// admin — 'ambiguous_name'/'fuzzy' with multiple candidates leave `suggested` null so the UI
// must ask a human. `people` rows: {id, first_name, last_name, email, breeze_id, photo_url}.
export function matchLegacyVolunteer(legacy, people) {
  if (legacy.breezePersonId) {
    const exact = people.filter(function(p) { return p.breeze_id && p.breeze_id === String(legacy.breezePersonId); });
    if (exact.length) return { confidence: 'breeze_id', suggested: exact[0], candidates: exact };
  }
  const { firstName, lastName } = splitLegacyName(legacy.name);
  const fnLower = firstName.toLowerCase(), lnLower = lastName.toLowerCase();
  const exactName = people.filter(function(p) {
    return p.first_name.toLowerCase() === fnLower && p.last_name.toLowerCase() === lnLower;
  });
  if (exactName.length === 1) return { confidence: 'exact_name', suggested: exactName[0], candidates: exactName };
  if (exactName.length > 1) return { confidence: 'ambiguous_name', suggested: null, candidates: exactName };

  const emailLower = (legacy.email || '').toLowerCase();
  const fuzzy = people.filter(function(p) {
    return (lnLower && p.last_name.toLowerCase() === lnLower) || (emailLower && p.email.toLowerCase() === emailLower);
  });
  if (fuzzy.length) return { confidence: 'fuzzy', suggested: fuzzy.length === 1 ? fuzzy[0] : null, candidates: fuzzy.slice(0, 5) };

  return { confidence: 'none', suggested: null, candidates: [] };
}

export async function handleSchedulerVolunteersApi(req, env, url, method) {
  // Same guard as the rest of the scheduler admin surface (SW1) — this links/edits real
  // people records for scheduling purposes, not a read-only report.
  const role = await getAuthRole(req, env);
  if (role !== 'admin' && role !== 'staff') return json({ error: 'Access denied' }, 403);

  const db = env.DB;
  const seg = url.pathname.replace('/admin/api/scheduler/volunteers', '').replace(/^\//, '').replace(/\/$/, '');
  const personId = seg ? parseInt(seg, 10) : 0;

  // GET /admin/api/scheduler/volunteers[?active=0]  (default: active only)
  if (!seg && method === 'GET') {
    const includeInactive = url.searchParams.get('active') === '0' || url.searchParams.get('active') === 'all';
    const rows = (await db.prepare(
      VOLUNTEER_SELECT + (includeInactive ? '' : ' WHERE sv.active=1') + ' ORDER BY p.last_name, p.first_name'
    ).all()).results || [];
    return json({ volunteers: rows.map(volunteerRowOut) });
  }

  // POST /admin/api/scheduler/volunteers  { person_id, roles?, primary_for?, ... }
  // Creates the link if it doesn't exist, or reactivates + updates it if it does.
  if (!seg && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const pid = parseInt(b.person_id, 10);
    if (!pid) return json({ error: 'person_id is required' }, 400);
    const person = await db.prepare('SELECT id FROM people WHERE id=?').bind(pid).first();
    if (!person) return json({ error: 'Person not found' }, 404);

    await upsertVolunteer(db, pid, {
      reminder_email: b.reminder_email,
      roles: parseJsonArray(b.roles, []),
      primary_for: parseJsonArray(b.primary_for, []),
      preferred_sundays: parseJsonArray(b.preferred_sundays, []),
      service_preference: b.service_preference,
      role_sunday_overrides: parseJsonObject(b.role_sunday_overrides, {}),
      blackout_dates: parseJsonArray(b.blackout_dates, []),
      absence_start: b.absence_start,
      absence_until: b.absence_until,
    }, '');

    const row = await db.prepare(VOLUNTEER_SELECT + ' WHERE sv.person_id=?').bind(pid).first();
    return json({ ok: true, volunteer: volunteerRowOut(row) });
  }

  // PATCH /admin/api/scheduler/volunteers/:personId  — sparse update, only touches fields present
  if (personId && method === 'PATCH') {
    const existing = await db.prepare('SELECT * FROM scheduler_volunteers WHERE person_id=?').bind(personId).first();
    if (!existing) return json({ error: 'Volunteer not found' }, 404);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

    const fields = [];
    const binds = [];
    function set(col, val) { fields.push(col + '=?'); binds.push(val); }
    if (b.reminder_email !== undefined) set('reminder_email', b.reminder_email || '');
    if (b.roles !== undefined) set('roles', JSON.stringify(parseJsonArray(b.roles, [])));
    if (b.primary_for !== undefined) set('primary_for', JSON.stringify(parseJsonArray(b.primary_for, [])));
    if (b.preferred_sundays !== undefined) set('preferred_sundays', JSON.stringify(parseJsonArray(b.preferred_sundays, [])));
    if (b.service_preference !== undefined) {
      set('service_preference', SCHED_SERVICE_PREFS.includes(b.service_preference) ? b.service_preference : 'both');
    }
    if (b.role_sunday_overrides !== undefined) set('role_sunday_overrides', JSON.stringify(parseJsonObject(b.role_sunday_overrides, {})));
    if (b.blackout_dates !== undefined) set('blackout_dates', JSON.stringify(parseJsonArray(b.blackout_dates, [])));
    if (b.absence_start !== undefined) set('absence_start', b.absence_start || '');
    if (b.absence_until !== undefined) set('absence_until', b.absence_until || '');
    if (b.active !== undefined) set('active', b.active ? 1 : 0);
    if (!fields.length) return json({ error: 'No fields to update' }, 400);

    fields.push("updated_at=datetime('now')");
    binds.push(personId);
    await db.prepare(`UPDATE scheduler_volunteers SET ${fields.join(', ')} WHERE person_id=?`).bind(...binds).run();

    const row = await db.prepare(VOLUNTEER_SELECT + ' WHERE sv.person_id=?').bind(personId).first();
    return json({ ok: true, volunteer: volunteerRowOut(row) });
  }

  // DELETE /admin/api/scheduler/volunteers/:personId — soft delete (removes from the active
  // volunteer pool but keeps the row, so historical schedule rows keyed by person_id still
  // resolve to a real name instead of an orphaned reference).
  if (personId && method === 'DELETE') {
    const existing = await db.prepare('SELECT person_id FROM scheduler_volunteers WHERE person_id=?').bind(personId).first();
    if (!existing) return json({ error: 'Volunteer not found' }, 404);
    await db.prepare("UPDATE scheduler_volunteers SET active=0, updated_at=datetime('now') WHERE person_id=?").bind(personId).run();
    return json({ ok: true });
  }

  // GET /admin/api/scheduler/volunteers/migration-preview
  // Reads the legacy scheduler_data 'ws_people' blob and, for each entry not already migrated,
  // suggests a real people-table match — never auto-commits anything.
  if (seg === 'migration-preview' && method === 'GET') {
    const legacyRow = await db.prepare(`SELECT value FROM scheduler_data WHERE key='ws_people'`).first();
    let legacyPeople = [];
    try { legacyPeople = JSON.parse(legacyRow?.value || '[]'); } catch { legacyPeople = []; }
    if (!Array.isArray(legacyPeople)) legacyPeople = [];

    const migratedRows = (await db.prepare(
      `SELECT migrated_from_legacy_id FROM scheduler_volunteers WHERE migrated_from_legacy_id != ''`
    ).all()).results || [];
    const migratedIds = new Set(migratedRows.map(function(r) { return r.migrated_from_legacy_id; }));

    const pendingLegacy = legacyPeople.filter(function(lp) { return lp && lp.id && !migratedIds.has(String(lp.id)); });

    const people = (await db.prepare(
      `SELECT id, first_name, last_name, email, breeze_id, photo_url FROM people WHERE active=1`
    ).all()).results || [];

    const pending = pendingLegacy.map(function(lp) {
      const match = matchLegacyVolunteer(lp, people);
      return {
        legacy_id: String(lp.id),
        name: lp.name || '',
        email: lp.email || '',
        breeze_person_id: lp.breezePersonId || '',
        roles: Array.isArray(lp.roles) ? lp.roles : [],
        primary_for: Array.isArray(lp.primaryFor) ? lp.primaryFor : [],
        match: match,
      };
    });

    return json({
      pending: pending,
      already_migrated_count: migratedIds.size,
      total_legacy: legacyPeople.length,
    });
  }

  // POST /admin/api/scheduler/volunteers/migration-commit
  // Body: { mappings: [ { legacy_id, action: 'link'|'create'|'skip', person_id? } ] }
  // Client only supplies the per-legacy-id decision — roles/preferences/etc. are always
  // re-read from the legacy blob server-side, never trusted from the request body.
  if (seg === 'migration-commit' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const mappings = Array.isArray(b.mappings) ? b.mappings : [];
    if (!mappings.length) return json({ error: 'mappings is required' }, 400);

    const legacyRow = await db.prepare(`SELECT value FROM scheduler_data WHERE key='ws_people'`).first();
    let legacyPeople = [];
    try { legacyPeople = JSON.parse(legacyRow?.value || '[]'); } catch { legacyPeople = []; }
    if (!Array.isArray(legacyPeople)) legacyPeople = [];
    const legacyById = {};
    legacyPeople.forEach(function(lp) { if (lp && lp.id) legacyById[String(lp.id)] = lp; });

    let linked = 0, created = 0, skipped = 0;
    const errors = [];

    for (const m of mappings) {
      const legacyId = String(m.legacy_id || '');
      const legacy = legacyById[legacyId];
      if (!legacy) { errors.push({ legacy_id: legacyId, error: 'Legacy entry not found' }); continue; }
      if (m.action === 'skip' || !m.action) { skipped++; continue; }

      const fields = {
        roles: Array.isArray(legacy.roles) ? legacy.roles : [],
        primary_for: Array.isArray(legacy.primaryFor) ? legacy.primaryFor : [],
        preferred_sundays: Array.isArray(legacy.preferredSundays) ? legacy.preferredSundays : [],
        service_preference: SCHED_SERVICE_PREFS.includes(legacy.servicePreference) ? legacy.servicePreference : 'both',
        role_sunday_overrides: (legacy.roleSundayOverrides && typeof legacy.roleSundayOverrides === 'object') ? legacy.roleSundayOverrides : {},
        blackout_dates: Array.isArray(legacy.blackoutDates) ? legacy.blackoutDates : [],
        absence_start: legacy.absenceStart || '',
        absence_until: legacy.absenceUntil || '',
        reminder_email: legacy.email || '',
      };

      let personId;
      if (m.action === 'link') {
        personId = parseInt(m.person_id, 10);
        if (!personId) { errors.push({ legacy_id: legacyId, error: 'person_id is required for link' }); continue; }
        const person = await db.prepare('SELECT id FROM people WHERE id=?').bind(personId).first();
        if (!person) { errors.push({ legacy_id: legacyId, error: 'Person not found' }); continue; }
        // Refuse to silently overwrite a different legacy migration already linked to this person.
        const already = await db.prepare(
          'SELECT migrated_from_legacy_id FROM scheduler_volunteers WHERE person_id=?'
        ).bind(personId).first();
        if (already && already.migrated_from_legacy_id && already.migrated_from_legacy_id !== legacyId) {
          errors.push({ legacy_id: legacyId, error: 'Person is already linked from a different legacy volunteer (#' + already.migrated_from_legacy_id + ')' });
          continue;
        }
      } else if (m.action === 'create') {
        const { firstName, lastName } = splitLegacyName(legacy.name);
        const r = await db.prepare(
          `INSERT INTO people (first_name, last_name, email, member_type, first_contact_date)
           VALUES (?, ?, ?, 'visitor', date('now'))`
        ).bind(firstName, lastName, legacy.email || '').run();
        personId = r.meta?.last_row_id;
      } else {
        errors.push({ legacy_id: legacyId, error: 'Unknown action: ' + m.action });
        continue;
      }

      await upsertVolunteer(db, personId, fields, legacyId);
      if (m.action === 'create') created++; else linked++;
    }

    return json({ ok: true, linked: linked, created: created, skipped: skipped, errors: errors });
  }

  return json({ error: 'Not found' }, 404);
}
