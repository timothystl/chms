// ── Scheduler & Volunteer API handlers ────────────────────────────────────────
import { json, SCHED_CORS, getAuthRole, timingSafeEqual } from './auth.js';
import { XMAS_MARKET_ROLES } from './db.js';

// Centralized office reply-to so it can be overridden via env.
function officeEmail(env) { return (env && env.REPLY_TO_EMAIL) || 'office@timothystl.org'; }

// Ring admin staff's phones via the website repo's existing web-push relay
// (admin.timothystl.org/api/push/notify → pushToAllSubscribers), rather than
// building a second push_subscriptions table + a second RFC 8291/8292
// implementation in this repo. Same shared-secret pattern as the ChMS intake
// key, just the other direction — this Worker is the caller here. Always
// best-effort: a missing ADMIN_PUSH_API_KEY, a network hiccup, or the relay
// itself being down must never turn into a failed sign-up or a failed RSVP
// response, so this never throws and its result is never awaited by a caller
// that would otherwise wait on it.
export async function notifyAdminPush(env, { title, body, tag, url }) {
  const key = env.ADMIN_PUSH_API_KEY || '';
  if (!key) return;
  await fetch('https://admin.timothystl.org/api/push/notify', {
    method: 'POST',
    headers: { 'X-Push-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, tag, url }),
  }).catch(() => { /* non-fatal, per file convention (see the Resend calls below) */ });
}

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

// ── CHRISTMAS MARKET SIGNUP SUMMARY (cross-Worker, read-only) ─────────
// GET /api/signups/christmasmarket/summary
//
// Serves the website repo's (admin.timothystl.org) Christmas Market admin screen,
// which shows a read-only "Volunteers" tab. Server-to-server only — no browser
// calls it, so there are no CORS headers here (matching /api/intake/*), and auth
// is the same shared-secret header the intake routes already use:
// X-Intake-Key matching env.CHMS_INTAKE_API_KEY, NOT a user session.
//
// It returns volunteer names AND email addresses, so the shared secret is not
// optional — a missing key on this Worker answers 503 rather than serving PII.

const XMAS_MARKET_SLUG = 'christmasmarket';
const XMAS_MARKET_NAME = 'Christmas Market';

// "Fri Dec 4" from a stored YYYY-MM-DD. Parsed as UTC and formatted as UTC so the
// label can never slide a day depending on where the Worker happens to run.
function marketDateLabel(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

// A shift's human label. The market runs across two days (setup Friday, market
// Saturday) and several roles repeat at different times on both, so the date has
// to be part of the label or the caller cannot tell one shift from another.
export function marketShiftLabel(role) {
  const date = marketDateLabel(role.role_date || '');
  const start = (role.start_time || '').trim();
  const end = (role.end_time || '').trim();
  let time = '';
  if (start && end) time = start + ' – ' + end;
  else if (start) time = start;
  else if (end) time = 'until ' + end;
  if (date && time) return date + ', ' + time;
  if (date) return date;
  if (time) return time;
  return role.name || 'Shift';
}

// Pure shaping step, so the grouping/counting rules are testable without a DB.
// roles: serve_roles rows (already ordered) ; peopleByRole: Map role_id -> [{name,email}]
export function buildMarketSummary(roles, peopleByRole) {
  const byName = new Map();
  let openShifts = 0;
  for (const role of roles) {
    const people = peopleByRole.get(role.id) || [];
    const filled = people.length;
    // slots = 0 means "no capacity recorded" (the column's default), which is a
    // different fact from "nobody is needed" — report it as null rather than 0 so
    // the caller never renders a shift as fully staffed when nothing was ever set.
    const needed = Number(role.slots) > 0 ? Number(role.slots) : null;
    if (needed !== null && filled < needed) openShifts++;
    const name = role.name || 'Volunteers';
    if (!byName.has(name)) byName.set(name, { name, shifts: [] });
    byName.get(name).shifts.push({
      label: marketShiftLabel(role),
      needed,
      filled,
      people,
    });
  }
  return { roles: Array.from(byName.values()), openShifts };
}

// ⚠ Every response here (success and error alike) carries `Cache-Control: no-store`.
// This route sat directly behind Cloudflare's default edge caching with no explicit
// header at all — a first hit that pre-dated the route's own deployment (a generic
// 404 from the Worker's bottom catch-all) could be cached at the calling colo and
// keep answering long after the real route existed, while a different colo (or a
// caller with `cache: 'no-store'` on its own fetch) saw the correct, current answer.
// See the website repo's Volunteers-tab investigation for the symptom this caused:
// an external curl succeeded while the live admin screen kept reporting the old 404.
function noStoreJson(data, status = 200) {
  return json(data, status, { 'Cache-Control': 'no-store' });
}

export async function handleChristmasMarketSummary(req, env) {
  const expectedKey = env.CHMS_INTAKE_API_KEY || '';
  if (!expectedKey) return noStoreJson({ error: 'Intake not configured' }, 503);
  if (!(await timingSafeEqual(req.headers.get('X-Intake-Key') || '', expectedKey))) {
    return noStoreJson({ error: 'Unauthorized' }, 401);
  }

  const empty = { open: false, signedUp: 0, openShifts: 0, roles: [] };

  // Resolve the event by its admin-managed short-link slug first, falling back to
  // the seeded name. The slug is what an admin can change; the name is what
  // src/db.js seeds and migrates against, so either alone would be brittle.
  const ev = await env.DB.prepare(
    "SELECT id, hidden FROM serve_events WHERE slug=? OR name=? ORDER BY (slug=?) DESC, id LIMIT 1"
  ).bind(XMAS_MARKET_SLUG, XMAS_MARKET_NAME, XMAS_MARKET_SLUG).first();
  // No such event yet — a valid state the caller has to render as "not open yet",
  // so this is a 200 with an empty shape, never an error.
  if (!ev) return noStoreJson(empty);

  const roleRows = await env.DB.prepare(
    'SELECT id, name, slots, sort_order, role_date, start_time, end_time FROM serve_roles WHERE event_id=? ORDER BY role_date, sort_order, id'
  ).bind(ev.id).all();
  const roles = applyXmasMarketDefaults(XMAS_MARKET_NAME, roleRows.results || []);

  // One join for every signed-up person, rather than a query per shift.
  const slotRows = await env.DB.prepare(
    `SELECT ss.role_id, s.name, s.email
       FROM signup_slots ss
       JOIN serve_roles sr ON sr.id = ss.role_id
       JOIN signups      s  ON s.id  = ss.signup_id
      WHERE sr.event_id = ?
      ORDER BY s.name, s.id`
  ).bind(ev.id).all();
  const peopleByRole = new Map();
  for (const r of (slotRows.results || [])) {
    if (!peopleByRole.has(r.role_id)) peopleByRole.set(r.role_id, []);
    peopleByRole.get(r.role_id).push({ name: r.name || '', email: r.email || '' });
  }

  // One row per person per event (the signup POST refuses a second one for the
  // same email), so this counts people, not shifts — somebody taking three shifts
  // is one volunteer.
  const signedUp = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM signups WHERE event_id=?'
  ).bind(ev.id).first();

  const shaped = buildMarketSummary(roles, peopleByRole);
  return noStoreJson({
    open: !ev.hidden,
    signedUp: signedUp?.n || 0,
    openShifts: shaped.openShifts,
    roles: shaped.roles,
  });
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

  const eventId = data.event_id || 0;
  const roleIds = Array.isArray(data.role_ids) ? data.role_ids : [];
  const requestedLabels = Array.isArray(data.roles) ? data.roles.map(String) : [];

  // Someone coming back to pick up an additional shift, or to volunteer in
  // one more way, should see what they already have on file and have the
  // new thing added to it — not be told an email is "already used" and
  // locked out. Find any prior sign-up for this same person + this same
  // event (or, off-event, any prior ministry-interest sign-up of theirs)
  // and merge into it instead of rejecting the request outright.
  const existing = eventId
    ? await env.DB.prepare('SELECT * FROM signups WHERE email=? AND event_id=? ORDER BY id DESC LIMIT 1').bind(email, eventId).first()
    : await env.DB.prepare("SELECT * FROM signups WHERE email=? AND (event_id IS NULL OR event_id=0) ORDER BY id DESC LIMIT 1").bind(email).first();

  let existingRoleIds = [];
  let existingLabels = [];
  if (existing) {
    const rows = await env.DB.prepare('SELECT role_id FROM signup_slots WHERE signup_id=?').bind(existing.id).all();
    existingRoleIds = (rows.results || []).map(r => r.role_id);
    try { existingLabels = JSON.parse(existing.roles || '[]'); } catch { existingLabels = []; }
  }
  const newRoleIds = roleIds.filter(rid => !existingRoleIds.includes(rid));
  const newLabels  = requestedLabels.filter(l => !existingLabels.includes(l));

  // Validate slot availability for any newly requested time-slotted roles
  // (skip ones the existing sign-up, if any, already holds — re-submitting
  // a shift you already have shouldn't fail just because it's now full).
  for (const rid of newRoleIds) {
    const role   = await env.DB.prepare('SELECT slots FROM serve_roles WHERE id=?').bind(rid).first();
    const filled = await env.DB.prepare('SELECT COUNT(*) as n FROM signup_slots WHERE role_id=?').bind(rid).first();
    if (role && role.slots > 0 && (filled?.n || 0) >= role.slots) {
      return json({ ok: false, error: 'One or more selected shifts are now full. Please refresh and try again.' }, 409);
    }
  }

  let signupId, merged, alreadySignedUp, allRoleIds, allRoleLabels;

  if (existing) {
    signupId = existing.id;
    merged = newRoleIds.length > 0 || newLabels.length > 0;
    allRoleIds = existingRoleIds.concat(newRoleIds);
    allRoleLabels = existingLabels.concat(newLabels);
    if (merged) {
      for (const rid of newRoleIds) {
        await env.DB.prepare('INSERT INTO signup_slots (signup_id,role_id) VALUES (?,?)').bind(signupId, rid).run();
      }
      const combinedMinistries = Array.from(new Set(
        (existing.ministry || '').split(',').map(s => s.trim()).filter(Boolean)
          .concat((data.ministry || '').split(',').map(s => s.trim()).filter(Boolean))
      )).join(', ') || existing.ministry;
      const newNoteText = (data.notes || '').trim();
      const combinedNotes = (newNoteText && newNoteText !== (existing.notes || '').trim())
        ? [existing.notes, newNoteText].filter(Boolean).join('\n')
        : (existing.notes || '');
      await env.DB.prepare('UPDATE signups SET roles=?, ministry=?, phone=?, notes=? WHERE id=?')
        .bind(JSON.stringify(allRoleLabels), combinedMinistries, existing.phone || (data.phone || ''), combinedNotes, signupId)
        .run();
    }
    alreadySignedUp = !merged;
  } else {
    merged = false;
    alreadySignedUp = false;
    allRoleIds = roleIds;
    allRoleLabels = requestedLabels.length ? requestedLabels : roleIds.map(String);
    const r = await env.DB.prepare(
      `INSERT INTO signups (event_id,role_id,ministry,name,email,phone,roles,service,sundays,shirt_wanted,shirt_size,notes,sms_reminder_opt_in)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      eventId, data.role_id || 0,
      data.ministry || '', name, email, data.phone || '',
      JSON.stringify(allRoleLabels),
      data.service || '', JSON.stringify(data.sundays || []),
      data.shirt_wanted ? 1 : 0, data.shirt_size || '', data.notes || '',
      data.sms_reminder_opt_in ? 1 : 0
    ).run();
    signupId = r.meta?.last_row_id;
    for (const rid of roleIds) {
      await env.DB.prepare('INSERT INTO signup_slots (signup_id,role_id) VALUES (?,?)')
        .bind(signupId, rid).run();
    }
  }

  // Send confirmation email to volunteer (non-fatal if email is not
  // configured). Skipped when nothing actually changed (already_signed_up)
  // so re-submitting the identical form twice doesn't send a second email.
  const resendKey = env.RESEND_API_KEY || '';
  const emailFrom = env.EMAIL_FROM || '';
  if (resendKey && emailFrom && email && !alreadySignedUp) {
    const ministry = data.ministry || 'general';
    const ministryLabels = { worship: 'Worship', events: 'Community Events', education: 'Christian Education',
      acceptance: 'Acceptance Ministry', outreach: 'Outreach', transportation: 'Transportation Ministry',
      lasm: 'LASM', wol: 'Word of Life', cfna: 'CFNA', general: 'General Interest' };
    const ministryLabel = ministryLabels[ministry] || ministry;
    const rolesList = allRoleLabels.length ? allRoleLabels.join(', ') : '';
    const rolesLine = rolesList ? `\nRoles/shifts on file: ${rolesList}` : '';
    const intro = merged
      ? `Thanks — we've added this to your existing sign-up at Timothy Lutheran Church!`
      : `Thank you for signing up to volunteer at Timothy Lutheran Church!`;
    const text = `Hi ${name},\n\n${intro}\n\n`
      + `Ministry: ${ministryLabel}${rolesLine}\n\n`
      + `We'll be in touch soon with more details. If you have any questions, reply to this email.\n\n`
      + `God's blessings,\nTimothy Lutheran Church\n6704 Fyler Ave, St. Louis, MO 63139\noffice@timothystl.org`;
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: emailFrom, to: email, reply_to: officeEmail(env),
        subject: merged ? 'Added to your sign-up at Timothy!' : 'Thanks for signing up to serve at Timothy!', text }),
    }).catch(() => { /* non-fatal */ });
  }

  // Notify the office of the new sign-up, if enabled in Settings — only for
  // a genuinely new addition, not a no-op resubmit of what's already on file.
  if (resendKey && emailFrom && !alreadySignedUp) {
    const notifyRow = await env.DB.prepare("SELECT value FROM chms_config WHERE key='notify_new_signup'").first();
    if (notifyRow && notifyRow.value === '1') {
      const notifyEmailRow = await env.DB.prepare("SELECT value FROM chms_config WHERE key='volunteer_public_email'").first();
      const notifyTo = (notifyEmailRow && notifyEmailRow.value) || officeEmail(env);
      const rolesList = allRoleLabels.length ? allRoleLabels.join(', ') : '';
      const notifyText = `${merged ? 'Additional volunteer sign-up' : 'New volunteer sign-up'}:\n\nName: ${name}\nEmail: ${email}\nPhone: ${data.phone || '(none)'}\nMinistry: ${data.ministry || '(none)'}${rolesList ? `\nRoles/shifts on file: ${rolesList}` : ''}${data.notes ? `\nNotes: ${data.notes}` : ''}`;
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: emailFrom, to: notifyTo, reply_to: email,
          subject: `${merged ? 'Additional volunteer sign-up' : 'New volunteer sign-up'}: ${name}`, text: notifyText }),
      }).catch(() => { /* non-fatal */ });
    }
  }

  // Ring admin staff's phones, alongside the office-notification email above
  // (independent of whether notify_new_signup is on — this is the sidebar
  // "Notifications" opt-in, a different audience than volunteer_public_email).
  if (!alreadySignedUp) {
    await notifyAdminPush(env, {
      title: merged ? 'Volunteer sign-up updated' : 'New volunteer sign-up',
      body: name + (merged ? ' added a shift' : ' signed up') + (data.ministry ? ' — ' + data.ministry : ''),
      tag: 'connect-signup',
      url: '/#volunteers',
    });
  }

  return json({
    ok: true,
    signup_id: signupId,
    merged,
    already_signed_up: alreadySignedUp,
    all_role_ids: allRoleIds,
    all_roles: allRoleLabels,
  });
}

// ── Retroactive duplicate sign-up cleanup ───────────────────────────────────
// Before handleSignup started merging a second sign-up onto an existing one
// (same email + same event, or off-event the same email), it created a
// disconnected second `signups` row instead. These two helpers find and
// consolidate rows already sitting in that state, using the identical merge
// rule handleSignup now applies to a live resubmit — so history ends up in
// the same shape new sign-ups already land in. Used by the admin-only
// GET/POST /admin/api/signups/duplicates|merge-duplicates routes.

// Groups existing signups sharing the same (email, event) key — the exact
// key handleSignup now uses to find "an existing sign-up to merge into".
export async function findDuplicateSignupGroups(env) {
  const rows = (await env.DB.prepare('SELECT * FROM signups ORDER BY id ASC').all()).results || [];
  const byKey = new Map();
  for (const r of rows) {
    const email = (r.email || '').trim().toLowerCase();
    if (!email) continue; // nothing to key duplicates on
    const eventId = r.event_id || 0;
    const key = eventId ? `e:${eventId}:${email}` : `m:${email}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }
  const groups = [];
  for (const groupRows of byKey.values()) {
    if (groupRows.length < 2) continue;
    const eventId = groupRows[0].event_id || 0;
    let eventName = null;
    if (eventId) {
      const ev = await env.DB.prepare('SELECT name FROM serve_events WHERE id=?').bind(eventId).first();
      eventName = ev ? ev.name : null;
    }
    groups.push({
      email: groupRows[0].email,
      eventId,
      eventName,
      ministry: (groupRows.map(r => r.ministry).find(Boolean)) || '',
      rows: groupRows,
    });
  }
  return groups;
}

// Merges N duplicate signup rows (already known to share an email+event key)
// into the oldest one, deletes the rest, and returns how many rows were
// removed. Role labels and ministries union together; slots move onto the
// canonical row (skipping one it already holds, so a shared slot never
// double-books); a duplicate further along the contact pipeline than the
// canonical row (e.g. already "confirmed") is never silently reset to "new".
export async function mergeDuplicateSignupGroup(env, rows) {
  const sorted = rows.slice().sort((a, b) => a.id - b.id);
  const canonical = sorted[0];
  const dupes = sorted.slice(1);
  if (!dupes.length) return 0;

  const STATUS_RANK = { new: 0, contacted: 1, confirmed: 2, declined: 2 };
  let roleLabels; try { roleLabels = JSON.parse(canonical.roles || '[]'); } catch { roleLabels = []; }
  let ministries = (canonical.ministry || '').split(',').map(s => s.trim()).filter(Boolean);
  let phone = canonical.phone || '';
  let notesParts = canonical.notes ? [canonical.notes] : [];
  let personId = canonical.person_id || null;
  let contactCount = canonical.contact_count || 0;
  let contactedAt = canonical.contacted_at || '';
  let smsOptIn = canonical.sms_reminder_opt_in || 0;
  let status = canonical.status || 'new';

  for (const d of dupes) {
    let dLabels; try { dLabels = JSON.parse(d.roles || '[]'); } catch { dLabels = []; }
    for (const l of dLabels) if (!roleLabels.includes(l)) roleLabels.push(l);
    for (const m of (d.ministry || '').split(',').map(s => s.trim()).filter(Boolean)) {
      if (!ministries.includes(m)) ministries.push(m);
    }
    if (!phone && d.phone) phone = d.phone;
    if (d.notes && !notesParts.includes(d.notes)) notesParts.push(d.notes);
    if (!personId && d.person_id) personId = d.person_id;
    contactCount += d.contact_count || 0;
    if (d.contacted_at && d.contacted_at > contactedAt) contactedAt = d.contacted_at;
    if (d.sms_reminder_opt_in) smsOptIn = 1;
    if ((STATUS_RANK[d.status || 'new'] || 0) > (STATUS_RANK[status] || 0)) status = d.status;

    const slotRows = (await env.DB.prepare('SELECT role_id FROM signup_slots WHERE signup_id=?').bind(d.id).all()).results || [];
    for (const sl of slotRows) {
      const already = await env.DB.prepare('SELECT id FROM signup_slots WHERE signup_id=? AND role_id=?').bind(canonical.id, sl.role_id).first();
      if (!already) {
        await env.DB.prepare('INSERT INTO signup_slots (signup_id,role_id) VALUES (?,?)').bind(canonical.id, sl.role_id).run();
      }
    }
    await env.DB.prepare('DELETE FROM signup_slots WHERE signup_id=?').bind(d.id).run();
    await env.DB.prepare('DELETE FROM signups WHERE id=?').bind(d.id).run();
  }

  await env.DB.prepare(
    'UPDATE signups SET roles=?, ministry=?, phone=?, notes=?, person_id=?, contact_count=?, contacted_at=?, sms_reminder_opt_in=?, status=? WHERE id=?'
  ).bind(
    JSON.stringify(roleLabels), ministries.join(', '), phone, notesParts.join('\n'),
    personId, contactCount, contactedAt, smsOptIn, status, canonical.id
  ).run();

  return dupes.length;
}

// Same-name, same-event (or same off-event ministry pool) groups where the
// EMAILS DIFFER — e.g. someone signed up once from a personal address and
// once from a work address. findDuplicateSignupGroups can't see these (it
// keys strictly on email, the same key handleSignup uses for a live merge),
// and a shared name alone isn't proof of a shared person, so these are
// never auto-merged — only surfaced for a human to confirm via
// mergeSignupsByIds. A group already fully covered by the exact-email
// grouping (every row shares one email) is excluded, since it's not a
// "different email" case at all.
export async function findPossibleDuplicateSignupGroups(env) {
  const rows = (await env.DB.prepare('SELECT * FROM signups ORDER BY id ASC').all()).results || [];
  const byKey = new Map();
  for (const r of rows) {
    const name = (r.name || '').trim().toLowerCase();
    if (!name) continue;
    const eventId = r.event_id || 0;
    const key = eventId ? `e:${eventId}:${name}` : `m:${name}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }
  const groups = [];
  for (const groupRows of byKey.values()) {
    const emails = new Set(groupRows.map(r => (r.email || '').trim().toLowerCase()).filter(Boolean));
    if (groupRows.length < 2 || emails.size < 2) continue;
    const eventId = groupRows[0].event_id || 0;
    let eventName = null;
    if (eventId) {
      const ev = await env.DB.prepare('SELECT name FROM serve_events WHERE id=?').bind(eventId).first();
      eventName = ev ? ev.name : null;
    }
    groups.push({
      name: groupRows[0].name,
      eventId,
      eventName,
      ministry: (groupRows.map(r => r.ministry).find(Boolean)) || '',
      rows: groupRows,
    });
  }
  return groups;
}

// Merges an admin-picked, arbitrary set of signup ids — the general case
// behind a manual "these are the same person" decision (different emails,
// a nickname vs. a legal name, etc.), reusing the identical consolidation
// rule as the automatic email-keyed merge above.
export async function mergeSignupsByIds(env, ids) {
  const rows = [];
  for (const id of ids) {
    const r = await env.DB.prepare('SELECT * FROM signups WHERE id=?').bind(id).first();
    if (r) rows.push(r);
  }
  if (rows.length < 2) return { removed: 0, canonicalId: null };
  const canonicalId = rows.slice().sort((a, b) => a.id - b.id)[0].id;
  const removed = await mergeDuplicateSignupGroup(env, rows);
  return { removed, canonicalId };
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

// ── /esv/passage ─────────────────────────────────────────────────────────────
// Server-side proxy to Crossway's ESV API so the key never reaches a browser —
// and because the embedded scheduler runs under CSP connect-src 'self', which
// blocks a direct call to api.esv.org outright.
//
// Licensing, from Crossway's own API terms: free for non-commercial personal,
// church and ministry use; the text MAY be redistributed by email; up to 500
// verses per query; 5,000 queries/day, 1,000/hour, 60/minute.
//
// Three attribution requirements, each met deliberately:
//   1. "With each quotation, include the letters ESV" — include-short-copyright.
//   2. The full Crossway notice must appear — printed once per email by the
//      caller (once, rather than after every passage, which is what
//      include-copyright would do).
//   3. A link to www.esv.org — every reference in the email is one.
//
// Nothing is cached. Crossway does not document a caching allowance, and a
// church sending a couple of dozen assignment emails a week sits far under the
// daily limit, so there is nothing to buy by storing their text on our side.
export async function handleEsvPassage(req, env, url) {
  const key = env.ESV_API_KEY || '';
  // Not an error — it is the default state, and the caller falls back to a link.
  if (!key) return schedJson({ configured: false, passages: [] });

  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return schedJson({ error: 'Missing q' }, 400);
  if (q.length > 200) return schedJson({ error: 'Reference too long' }, 400);

  const api = new URL('https://api.esv.org/v3/passage/text/');
  api.searchParams.set('q', q);
  api.searchParams.set('include-passage-references', 'false'); // the email prints its own
  api.searchParams.set('include-verse-numbers', 'true');
  api.searchParams.set('include-first-verse-numbers', 'true');
  api.searchParams.set('include-footnotes', 'false');          // callouts with no footnote text
  api.searchParams.set('include-headings', 'true');
  api.searchParams.set('include-short-copyright', 'true');     // the "(ESV)" on each quotation
  api.searchParams.set('include-copyright', 'false');          // full notice printed once instead
  api.searchParams.set('indent-paragraphs', '0');
  api.searchParams.set('indent-poetry-lines', '2');

  let res;
  try {
    res = await fetch(api.toString(), { headers: { 'Authorization': 'Token ' + key } });
  } catch (e) {
    return schedJson({ configured: true, error: 'Could not reach the ESV API: ' + String(e) }, 502);
  }
  let data;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || !data) {
    const msg = (data && (data.detail || data.error)) || ('ESV API returned ' + res.status);
    return schedJson({ configured: true, error: msg }, res.status === 401 ? 401 : 502);
  }
  return schedJson({
    configured: true,
    query:      data.query || q,
    passages:   Array.isArray(data.passages) ? data.passages : [],
  });
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
  // Push notification only for confirmed/declined — the two decisions
  // (per the "volunteer confirms/declines" ask). needs_changes is a
  // still-in-progress state, not yet a resolved outcome worth a buzz.
  if (status === 'confirmed' || status === 'declined') {
    const statusLabel = formatRsvpStatus(status) || status;
    await notifyAdminPush(env, {
      title: 'Scheduler: ' + statusLabel,
      body: (record.name || 'A volunteer') + ' ' + (status === 'confirmed' ? 'confirmed' : 'declined') + ' their worship service assignment.',
      tag: 'connect-rsvp',
      url: '/#scheduler',
    });
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
