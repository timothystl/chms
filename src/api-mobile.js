// ── Mobile Admin API ────────────────────────────────────────────────────────
// Backs the phone-optimized experience (see src/mobile-admin-html.js — served
// automatically at the app's normal URL on a phone, no separate page route) — splash,
// dashboard, people directory, person detail. Deliberately its own small handler
// rather than routed through handleChmsApi's per-item ACCESS_GATE: this composes data
// across attendance + follow_up_items + prayer_requests + people/households in a few
// purpose-built endpoints shaped exactly for the phone screens, instead of asking the
// mobile frontend to make (and reconcile) several general-purpose API calls.
import { json } from './auth.js';
import { getRolePermissions, permissionsForRole, disambiguateHHName } from './api-utils.js';
import { recordQuickGivingEntry } from './api-giving.js';
import { schedKvPut } from './api-scheduler.js';
import { LCMS_CALENDAR_JSON } from './lectionary.js';

// Who this surface is for. `member` is allowed — the phone experience IS the member's
// only view of the directory now, not an add-on — but every attendance/follow-up/prayer
// section below stays gated by the real per-role permission matrix (member's ceiling on
// those items is hard-'none', see MEMBER_ALLOWED_ITEMS in api-utils.js), and the people
// endpoints apply the same member_type/public_directory/dir_hide_* restriction the main
// People API already enforces for a member session. `volunteer` (the read-only Volunteers
// admin screen) is a different tool entirely and gets a flat 403, not a partially-empty
// page.
function mobileAllowed(role) {
  return role === 'admin' || role === 'finance' || role === 'staff' || role === 'council' || role === 'member';
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const iso = dateStr.length === 10 ? dateStr + 'T00:00:00' : dateStr.replace(' ', 'T');
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diffMs = Date.now() - t;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return Math.max(mins, 0) + 'm';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h';
  const days = Math.floor(hours / 24);
  if (days < 30) return days + 'd';
  const months = Math.floor(days / 30);
  return months + 'mo';
}

// Most recent Sunday including today — the Sunday whose attendance a staffer would be
// entering on any given day of that week (the day of, or the days right after).
function currentSundayISO() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

// The Sunday a phone user actually wants to see for "who's serving": today if today IS
// Sunday, otherwise the next upcoming one. Deliberately NOT currentSundayISO() above — that
// one intentionally looks backward (the Sunday whose attendance you're still entering days
// later); the Scheduler screen looks forward instead.
function nextOrCurrentSundayISO() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay();
  if (dow !== 0) d.setUTCDate(d.getUTCDate() + (7 - dow));
  return d.toISOString().slice(0, 10);
}

// Mirrors PER_ROLES/SHARED_ROLES in src/scheduler-html.js — that file is the desktop
// Scheduler's own source of truth for these two lists, but it's a giant client-side
// template-literal blob (not an importable module), so this is a deliberate, small,
// hand-kept-in-sync duplication rather than a shared-module refactor. If a role is ever
// added/renamed on the desktop Scheduler, update both places.
const SCHED_PER_ROLES = ['Elder', 'Acolyte', 'PowerPoint', 'Lector', 'Liturgist'];
const SCHED_SHARED_ROLES = ['Preacher', 'Childrens Message'];
const SCHED_SVC_LABELS = { '8am': '8:00 AM', '10:45am': '10:45 AM' };

// Parsed once per isolate. Same source the desktop Scheduler's own
// /scheduler/lcms_calendar.json route serves — see tlc-volunteer-worker.js — so this can't
// drift from what the desktop tab shows. Deliberately does NOT apply a per-date manual
// override: those live only in each browser's localStorage (ws_readings in scheduler-html.js),
// never synced to the Worker, so there is nothing server-side to read them from. The LCMS
// default is what's shown here; a hand-edited reading for one date won't be reflected until
// that gets a real server-side home.
let _lectCalendar = null;
function lectCalendar() {
  if (!_lectCalendar) {
    try { _lectCalendar = JSON.parse(LCMS_CALENDAR_JSON).calendar || {}; } catch { _lectCalendar = {}; }
  }
  return _lectCalendar;
}
// Mirrors tidyReadingRef() in scheduler-html.js: display-only whitespace cleanup around the
// LCMS lectionary's parenthetical optional-verse markers, not a change to which verses are read.
function tidyReadingRef(r) {
  return String(r || '').replace(/\(\s*/g, '(').replace(/\s*\)/g, ')').replace(/\s+/g, ' ').trim();
}
function readingsForDate(dateISO) {
  const e = lectCalendar()[dateISO];
  if (!e) return null;
  const out = {
    sunday_name: String(e.sundayName || '').replace(/\(prop(\d+)\)/i, '(Proper $1)'),
    ot: tidyReadingRef(e.ot), epistle: tidyReadingRef(e.epistle),
    gospel: tidyReadingRef(e.gospel), psalm: tidyReadingRef(e.psalm),
  };
  return (out.ot || out.epistle || out.gospel || out.psalm) ? out : null;
}

function composeAddress(p) {
  const line1 = [p.address1, p.address2].filter(Boolean).join(' ');
  const cityStateZip = [[p.city, p.state].filter(Boolean).join(', '), p.zip].filter(Boolean).join(' ');
  return [line1, cityStateZip].filter(Boolean).join(', ');
}

function familyRoleLabel(role) {
  const map = { head: 'Head of Household', spouse: 'Spouse', child: 'Child' };
  return map[String(role || '').toLowerCase()] || 'Family';
}

// Shared by the read view (GET this-sunday) and the two write actions below (remind/reassign)
// so all three build the exact same shape from the exact same blobs — a write endpoint that
// computed its own smaller response could drift from what the read view considers "the
// current state" and leave the mobile screen showing something the server no longer agrees with.
async function loadSchedulerBlobs(db) {
  const blobRows = (await db.prepare(
    `SELECT key, value, updated_at FROM scheduler_data WHERE key IN ('ws_schedule_v2','ws_people','ws_confirmations')`
  ).all()).results || [];
  const blobs = {};
  let confirmationsAsOf = null;
  for (const r of blobRows) {
    try { blobs[r.key] = JSON.parse(r.value); } catch { blobs[r.key] = null; }
    if (r.key === 'ws_confirmations') confirmationsAsOf = r.updated_at || null;
  }
  return {
    months: (blobs.ws_schedule_v2 && typeof blobs.ws_schedule_v2 === 'object') ? blobs.ws_schedule_v2 : {},
    people: Array.isArray(blobs.ws_people) ? blobs.ws_people : [],
    confirmations: (blobs.ws_confirmations && typeof blobs.ws_confirmations === 'object') ? blobs.ws_confirmations : {},
    confirmationsAsOf,
  };
}

function buildSundayPayload(dateISO, state) {
  const peopleById = {};
  for (const p of state.people) if (p && p.id != null) peopleById[String(p.id)] = p;
  function personOf(pid) {
    if (pid == null) return null;
    const p = peopleById[String(pid)];
    return { id: pid, name: p ? (p.name || '') : '(unknown)' };
  }
  function statusOf(roleName, svc) {
    return state.confirmations[`${dateISO}|${roleName}|${svc}`] || 'pending';
  }
  // The picker for "assign to someone else" — same roster the schedule itself was built
  // against, not the full People directory (a name not in this list was never an eligible
  // candidate for these roles to begin with).
  const roster = state.people
    .filter(p => p && p.id != null && p.name)
    .map(p => ({ id: p.id, name: p.name }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const readings = readingsForDate(dateISO);

  const monthKey = dateISO.slice(0, 7);
  const monthRows = (state.months[monthKey] && Array.isArray(state.months[monthKey].rows)) ? state.months[monthKey].rows : [];
  const row = monthRows.find(r => r && r.dateISO === dateISO);

  if (!row) {
    return { date_iso: dateISO, has_schedule: false, readings, roster };
  }

  // A holiday falling on a Sunday (e.g. Christmas) is stored as its own "special" row
  // shape instead of a regular Sunday row — a lower-confidence secondary path (this
  // shape is rarer and less exercised than the regular Sunday one below), but cheap to
  // support since the data already carries what's needed.
  if (row.type === 'special') {
    const services = (Array.isArray(row.services) ? row.services : []).map(s => {
      const svcKey = s.time || 'shared';
      return {
        time: s.time || '',
        roles: (Array.isArray(s.roles) ? s.roles : []).map(roleName => ({
          role: roleName,
          person: personOf(s.assignments ? s.assignments[roleName] : null),
          status: statusOf(roleName, svcKey),
        })),
      };
    });
    let filled = 0, total = 0;
    for (const s of services) for (const r2 of s.roles) { total++; if (r2.person) filled++; }
    return {
      date_iso: dateISO, has_schedule: true, kind: 'special', name: row.name || '',
      confirmations_as_of: state.confirmationsAsOf,
      services, counts: { filled, open: total - filled, total },
      readings, roster,
    };
  }

  const assignments = (row.assignments && typeof row.assignments === 'object') ? row.assignments : {};
  const services = ['8am', '10:45am'].map(svc => ({
    svc, svc_label: SCHED_SVC_LABELS[svc] || svc,
    roles: SCHED_PER_ROLES.map(roleName => ({
      role: roleName,
      person: personOf(assignments[roleName] ? assignments[roleName][svc] : null),
      status: statusOf(roleName, svc),
    })),
  }));
  const sharedRoles = SCHED_SHARED_ROLES.map(roleName => ({
    role: roleName,
    person: personOf(assignments[roleName] ? assignments[roleName].shared : null),
    status: statusOf(roleName, 'shared'),
  }));
  let filled = 0, total = 0;
  for (const s of services) for (const r2 of s.roles) { total++; if (r2.person) filled++; }
  for (const r2 of sharedRoles) { total++; if (r2.person) filled++; }

  return {
    date_iso: dateISO, has_schedule: true, kind: 'sunday',
    ordinal: row.ordinal || null, label: row.label || '',
    confirmations_as_of: state.confirmationsAsOf,
    services, shared_roles: sharedRoles,
    counts: { filled, open: total - filled, total },
    readings, roster,
  };
}

export async function handleMobileApi(req, env, url, method, role) {
  const db = env.DB;
  if (!mobileAllowed(role)) return json({ error: 'Access denied' }, 403);

  const isAdmin = role === 'admin';
  const isMemberRole = role === 'member';
  const perms = await getRolePermissions(db);
  const rolePerms = permissionsForRole(perms, role);
  const canView = (item) => isAdmin || (rolePerms[item] || 'none') !== 'none';
  const canEditItem = (item) => isAdmin || (rolePerms[item] || 'none') === 'edit';
  // Follow-up items live behind `followups`; prayer requests reuse the People/Households
  // "canEdit" definition the prayer-requests endpoint itself gates on (api-reports.js).
  // Both are already hard-'none' for member (MEMBER_ALLOWED_ITEMS in api-utils.js), so
  // isMemberRole doesn't need to be threaded into these — canView/canEditBaseline already
  // resolve correctly for them.
  const canEditBaseline = isAdmin || role === 'finance' || role === 'staff' || role === 'council';
  // `giving` carries a fourth level, 'anon' (aggregate totals only, no donor named — the level
  // council runs on). canView()'s plain !=='none' check would wrongly admit it here: every
  // endpoint below shows or writes an individually-identified gift, so 'anon' must be treated
  // the same as 'none' — the same rule api-reports.js's isAnonSafeGivingSeg() allowlist exists to
  // enforce, restated for this handler because it never routes through that allowlist.
  const givingLevel = isAdmin ? 'edit' : (rolePerms.giving || 'none');
  const canViewGivingNamed = givingLevel === 'view' || givingLevel === 'edit';
  const canEditGiving = givingLevel === 'edit';

  const seg = url.pathname.replace('/admin/api/mobile/', '').replace(/\/+$/, '');

  // ── Dashboard: today's Sunday services + people count + follow-ups feed ──
  if (seg === 'dashboard' && method === 'GET') {
    const sundayDate = currentSundayISO();
    const sundayLabel = new Date(sundayDate + 'T12:00:00Z')
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

    const canViewAttendance = canView('attendance');
    let services = [
      { time: '08:00', label: '8:00am', count: null, id: null },
      { time: '10:45', label: '10:45am', count: null, id: null },
    ];
    if (canViewAttendance) {
      const rows = (await db.prepare(
        `SELECT id, service_time, attendance FROM worship_services
         WHERE service_date=? AND service_type='sunday'`
      ).bind(sundayDate).all()).results || [];
      const byTime = {};
      for (const r of rows) byTime[r.service_time] = r;
      services = services.map(s => {
        const r = byTime[s.time];
        return r ? { ...s, count: r.attendance, id: r.id } : s;
      });
    }

    // A member's own People screen is scoped to the visible directory (member_type='member'
    // AND public_directory=1, same as GET mobile/people below) — the shortcut's count has to
    // match what tapping it actually shows, not the whole congregation's roster.
    const peopleTotalRow = isMemberRole
      ? await db.prepare(
          `SELECT COUNT(*) as n FROM people WHERE active=1 AND LOWER(member_type)='member' AND public_directory=1`
        ).first()
      : await db.prepare(
          `SELECT COUNT(*) as n FROM people WHERE active=1 AND LOWER(member_type)!='organization'`
        ).first();
    const peopleTotal = peopleTotalRow?.n || 0;

    const canViewFollowups = canView('followups');
    const followups = [];
    let openFollowupCount = 0;
    if (canViewFollowups) {
      const rows = (await db.prepare(
        `SELECT f.id, f.type, f.notes, f.created_at, p.first_name, p.last_name
         FROM follow_up_items f LEFT JOIN people p ON p.id=f.person_id
         WHERE f.completed=0 ORDER BY f.created_at DESC LIMIT 10`
      ).all()).results || [];
      for (const r of rows) {
        const name = [r.first_name, r.last_name].filter(Boolean).join(' ');
        followups.push({
          kind: 'followup', id: r.id,
          title: name ? `Follow up — ${name}` : 'Follow up',
          subtitle: r.notes || '',
          date: r.created_at, time_ago: timeAgo(r.created_at), done: false,
        });
      }
      const cnt = await db.prepare(`SELECT COUNT(*) as n FROM follow_up_items WHERE completed=0`).first();
      openFollowupCount += cnt?.n || 0;
    }
    if (canEditBaseline) {
      const rows = (await db.prepare(
        `SELECT id, requester_name, request_text, submitted_at, status FROM prayer_requests
         WHERE status IN ('open','praying') ORDER BY submitted_at DESC LIMIT 10`
      ).all()).results || [];
      for (const r of rows) {
        followups.push({
          kind: 'prayer', id: r.id,
          title: r.requester_name ? `Prayer request — ${r.requester_name}` : 'Prayer request',
          subtitle: r.request_text ? `"${r.request_text.slice(0, 80)}"` : '',
          date: r.submitted_at, time_ago: timeAgo(r.submitted_at), done: false,
        });
      }
      const cnt = await db.prepare(`SELECT COUNT(*) as n FROM prayer_requests WHERE status IN ('open','praying')`).first();
      openFollowupCount += cnt?.n || 0;
    }
    followups.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    return json({
      sunday_date: sundayDate,
      sunday_label: sundayLabel,
      services,
      can_view_attendance: canViewAttendance,
      can_edit_attendance: canEditItem('attendance'),
      people_total: peopleTotal,
      can_view_followups: canViewFollowups || canEditBaseline,
      can_view_giving: canViewGivingNamed,
      can_view_scheduler: role === 'admin' || role === 'staff',
      followups: followups.slice(0, 8),
      open_followup_count: openFollowupCount,
    });
  }

  // ── Scheduler: read-only view of the current/upcoming Sunday's assignments ──
  // Deliberately narrower than mobileAllowed() above (which also admits finance/council/
  // member) — mirrors handleSchedulerDataApi's own gate exactly (api-admin.js), since the
  // desktop Scheduler tab itself is admin/staff only and this is just a phone-shaped read
  // view onto the same data, not a new grant of access. Schedule data lives as JSON blobs
  // in the generic scheduler_data key/value table (ws_schedule_v2/ws_people/
  // ws_confirmations) — there's no relational schema for it to query directly.
  if (seg === 'scheduler/this-sunday' && method === 'GET') {
    if (role !== 'admin' && role !== 'staff') return json({ error: 'Access denied' }, 403);
    const dateISO = nextOrCurrentSundayISO();
    const state = await loadSchedulerBlobs(db);
    return json(buildSundayPayload(dateISO, state));
  }

  // ── Scheduler: resend a confirmation-request email for one assignment ──────
  // Same admin/staff-only gate as the read view above — this is the same data, just written
  // to instead of read. Deliberately a smaller email than the desktop "Email Assignments"
  // panel (no ICS attachment, no fetched ESV full text, no per-recipient send log) — those
  // depend on state that only exists in the browser that opened the desktop Scheduler
  // (rsvpTokens/readings overrides in localStorage). A fresh RSVP token minted per send is
  // simpler than trying to reuse one, and just as valid — the /rsvp link only cares that the
  // token in RSVP_STORE matches, not that it's the first one ever issued for this person.
  if (seg === 'scheduler/remind' && method === 'POST') {
    if (role !== 'admin' && role !== 'staff') return json({ error: 'Access denied' }, 403);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const dateISO = String(b.date_iso || '');
    const roleName = String(b.role || '');
    const svc = String(b.svc || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || !roleName || !svc) return json({ error: 'Invalid request' }, 400);

    const resendKey = env.RESEND_API_KEY || '';
    const emailFrom = env.EMAIL_FROM || '';
    if (!resendKey || !emailFrom) return json({ error: 'Email is not configured on the Worker (RESEND_API_KEY / EMAIL_FROM missing)' }, 500);

    const state = await loadSchedulerBlobs(db);
    const payload = buildSundayPayload(dateISO, state);
    if (!payload.has_schedule) return json({ error: 'No schedule for this date' }, 404);

    let target = null;
    for (const s of (payload.services || [])) {
      const svcKey = payload.kind === 'special' ? (s.time || 'shared') : s.svc;
      if (svcKey !== svc) continue;
      target = s.roles.find(r2 => r2.role === roleName) || null;
    }
    if (!target && svc === 'shared' && payload.shared_roles) {
      target = payload.shared_roles.find(r2 => r2.role === roleName) || null;
    }
    if (!target || !target.person) return json({ error: 'That role has no one assigned' }, 400);

    const personBlob = state.people.find(p => p && String(p.id) === String(target.person.id));
    const email = (personBlob && (personBlob.email || personBlob.secondEmail)) || '';
    if (!email) return json({ error: (target.person.name || 'This volunteer') + ' has no email address on file.' }, 400);

    const token = Array.from(crypto.getRandomValues(new Uint8Array(20)), n => n.toString(16).padStart(2, '0')).join('');
    const dateLabel = new Date(dateISO + 'T12:00:00Z')
      .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
    const svcLabel = svc === 'shared' ? 'Both Services' : (SCHED_SVC_LABELS[svc] || svc);

    await schedKvPut(env, token, {
      token, name: target.person.name, personId: target.person.id, email, notifyEmail: '',
      assignments: [{ date: dateLabel, dateISO, svc: svcLabel, role: roleName }],
      responses: {},
    });

    const rsvpBase = url.origin;
    const text = `Hello ${target.person.name},\n\n`
      + `This is a reminder of your worship service assignment at Timothy Lutheran Church:\n\n`
      + `  • ${dateLabel} — ${svcLabel}: ${roleName}\n\n`
      + `Please confirm your availability:\n`
      + `  Yes, I'll be there: ${rsvpBase}/rsvp?token=${encodeURIComponent(token)}&idx=0&status=confirmed\n`
      + `  I need a change:  ${rsvpBase}/rsvp?token=${encodeURIComponent(token)}&idx=0&status=needs_changes\n\n`
      + `Thank you for serving!\n\nTimothy Lutheran Church`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: emailFrom, to: email, subject: `Reminder: ${roleName} — ${dateLabel}`, text }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return json({ error: errData.message || 'Could not send the reminder email' }, 502);
    }
    return json({ ok: true, sent_to: email });
  }

  // ── Scheduler: reassign a role to a different person, or open it back up ───
  // Writes straight into the same scheduler_data blobs the desktop Scheduler reads and
  // writes wholesale (SCHEDULER_KEYS / handleSchedulerDataApi in api-admin.js) — there's no
  // row-level locking on that table, so a desktop tab that still has last week's schedule
  // loaded in memory and saves after this runs would silently overwrite it. Same
  // last-write-wins exposure that already exists between two desktop tabs; not something
  // this endpoint introduces.
  if (seg === 'scheduler/reassign' && method === 'POST') {
    if (role !== 'admin' && role !== 'staff') return json({ error: 'Access denied' }, 403);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const dateISO = String(b.date_iso || '');
    const roleName = String(b.role || '');
    const svc = String(b.svc || '');
    const rawPersonId = (b.person_id === null || b.person_id === undefined || b.person_id === '') ? null : b.person_id;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || !roleName || !svc) return json({ error: 'Invalid request' }, 400);

    const state = await loadSchedulerBlobs(db);
    const monthKey = dateISO.slice(0, 7);
    const monthRows = (state.months[monthKey] && Array.isArray(state.months[monthKey].rows)) ? state.months[monthKey].rows : [];
    const row = monthRows.find(r2 => r2 && r2.dateISO === dateISO);
    if (!row) return json({ error: 'No schedule for this date' }, 404);

    // A person id has to come from the same roster the schedule was built against — the
    // legacy ws_people blob, not the real `people` table (see the SC6 Phase 1 comment above
    // handleSchedulerVolunteersApi in api-scheduler.js: this hasn't been relationalized yet, so
    // a ws_people id and a `people.id` are not interchangeable). Using the roster entry's own
    // `.id` rather than the raw request value also preserves whatever type (string/number) the
    // blob already stores, instead of introducing a string where a number was expected.
    let personId = null;
    if (rawPersonId != null) {
      const match = state.people.find(p => p && String(p.id) === String(rawPersonId));
      if (!match) return json({ error: 'Unknown person' }, 400);
      personId = match.id;
    }

    let svcKey;
    if (row.type === 'special') {
      const s = (Array.isArray(row.services) ? row.services : []).find(x => (x.time || 'shared') === svc);
      if (!s || !Array.isArray(s.roles) || !s.roles.includes(roleName)) return json({ error: 'Unknown role for this service' }, 400);
      if (!s.assignments || typeof s.assignments !== 'object') s.assignments = {};
      if (personId == null) delete s.assignments[roleName]; else s.assignments[roleName] = personId;
      svcKey = svc;
    } else {
      const isShared = SCHED_SHARED_ROLES.includes(roleName);
      const isPerSvc = SCHED_PER_ROLES.includes(roleName) && (svc === '8am' || svc === '10:45am');
      if (!isShared && !isPerSvc) return json({ error: 'Unknown role/service combination' }, 400);
      if (!row.assignments || typeof row.assignments !== 'object') row.assignments = {};
      const key = isShared ? 'shared' : svc;
      if (!row.assignments[roleName] || typeof row.assignments[roleName] !== 'object') row.assignments[roleName] = {};
      if (personId == null) delete row.assignments[roleName][key]; else row.assignments[roleName][key] = personId;
      svcKey = key;
    }

    // The old assignment's confirmation no longer means anything once the person changes —
    // whoever is in the role now hasn't replied to anything yet.
    delete state.confirmations[`${dateISO}|${roleName}|${svcKey}`];

    await db.prepare(
      `INSERT OR REPLACE INTO scheduler_data (key, value, updated_at) VALUES ('ws_schedule_v2', ?, datetime('now'))`
    ).bind(JSON.stringify(state.months)).run();
    await db.prepare(
      `INSERT OR REPLACE INTO scheduler_data (key, value, updated_at) VALUES ('ws_confirmations', ?, datetime('now'))`
    ).bind(JSON.stringify(state.confirmations)).run();
    state.confirmationsAsOf = new Date().toISOString().slice(0, 19).replace('T', ' ');

    return json(buildSundayPayload(dateISO, state));
  }

  // ── Attendance quick-entry: upsert one service's count for one date ──────
  if (seg === 'attendance' && method === 'POST') {
    if (!canEditItem('attendance')) return json({ error: 'Access denied' }, 403);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const date = String(b.date || '');
    const time = String(b.time || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'Invalid date' }, 400);
    if (time !== '08:00' && time !== '10:45') return json({ error: 'Invalid service time' }, 400);
    const count = Math.max(0, parseInt(b.count, 10) || 0);
    const existing = await db.prepare(
      `SELECT id FROM worship_services WHERE service_date=? AND service_time=?`
    ).bind(date, time).first();
    let id;
    if (existing) {
      await db.prepare(`UPDATE worship_services SET attendance=? WHERE id=?`).bind(count, existing.id).run();
      id = existing.id;
    } else {
      const r = await db.prepare(
        `INSERT INTO worship_services (service_date,service_time,service_name,service_type,attendance,communion,notes)
         VALUES (?,?,?,?,?,0,'')`
      ).bind(date, time, '', 'sunday', count).run();
      id = r.meta?.last_row_id;
    }
    return json({ ok: true, id, count });
  }

  // ── Attendance history: recent services of any type, for browsing/editing ──
  if (seg === 'attendance/history' && method === 'GET') {
    if (!canView('attendance')) return json({ error: 'Access denied' }, 403);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 100);
    const rows = (await db.prepare(
      `SELECT id, service_date, service_time, service_name, service_type, attendance, communion
       FROM worship_services ORDER BY service_date DESC, service_time DESC LIMIT ?`
    ).bind(limit).all()).results || [];
    return json({ services: rows, can_edit: canEditItem('attendance') });
  }

  // ── Attendance entry: create a service of any type (special/midweek, or a ──
  // Sunday row outside the two standard times) — the quick dashboard card above
  // covers only the two known Sunday slots, this is the general form.
  if (seg === 'attendance/entry' && method === 'POST') {
    if (!canEditItem('attendance')) return json({ error: 'Access denied' }, 403);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const date = String(b.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'Invalid date' }, 400);
    const type = ['sunday', 'special', 'midweek'].includes(b.type) ? b.type : 'special';
    const name = String(b.name || '').slice(0, 200);
    const time = String(b.time || '');
    const count = Math.max(0, parseInt(b.count, 10) || 0);
    const communion = Math.max(0, parseInt(b.communion, 10) || 0);
    const r = await db.prepare(
      `INSERT INTO worship_services (service_date,service_time,service_name,service_type,attendance,communion,notes)
       VALUES (?,?,?,?,?,?,'')`
    ).bind(date, time, name, type, count, communion).run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }

  // ── Attendance entry: edit/delete an existing service row ──────────────────
  const attEntryMatch = seg.match(/^attendance\/entry\/(\d+)$/);
  if (attEntryMatch && (method === 'PATCH' || method === 'DELETE')) {
    if (!canEditItem('attendance')) return json({ error: 'Access denied' }, 403);
    const id = parseInt(attEntryMatch[1], 10);
    if (method === 'DELETE') {
      await db.prepare(`DELETE FROM worship_services WHERE id=?`).bind(id).run();
      return json({ ok: true });
    }
    const existing = await db.prepare(`SELECT * FROM worship_services WHERE id=?`).bind(id).first();
    if (!existing) return json({ error: 'Not found' }, 404);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const count = b.count !== undefined ? Math.max(0, parseInt(b.count, 10) || 0) : existing.attendance;
    const communion = b.communion !== undefined ? Math.max(0, parseInt(b.communion, 10) || 0) : existing.communion;
    const name = b.name !== undefined ? String(b.name).slice(0, 200) : existing.service_name;
    await db.prepare(
      `UPDATE worship_services SET attendance=?, communion=?, service_name=? WHERE id=?`
    ).bind(count, communion, name, id).run();
    return json({ ok: true });
  }

  // ── Giving: funds picker, recent entries, quick entry ───────────────────────
  // 'anon' (the level council runs on) is deliberately NOT enough for any of these — every
  // one shows or writes a named gift. See canViewGivingNamed/canEditGiving above.
  if (seg === 'giving/funds' && method === 'GET') {
    if (!canViewGivingNamed) return json({ error: 'Access denied' }, 403);
    const rows = (await db.prepare(
      `SELECT id, name FROM funds WHERE active=1 ORDER BY sort_order, name`
    ).all()).results || [];
    return json({ funds: rows, can_edit: canEditGiving });
  }

  if (seg === 'giving/recent' && method === 'GET') {
    if (!canViewGivingNamed) return json({ error: 'Access denied' }, 403);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '15', 10) || 15, 50);
    const rows = (await db.prepare(
      `SELECT ge.id, ge.amount, ge.method, ge.fund_id, ge.check_number, gb.closed as batch_closed,
              COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) as txn_date,
              f.name as fund_name,
              COALESCE(p.first_name||' '||p.last_name,'(anonymous)') as person_name
       FROM giving_entries ge
       JOIN funds f ON ge.fund_id=f.id
       JOIN giving_batches gb ON ge.batch_id=gb.id
       LEFT JOIN people p ON ge.person_id=p.id
       ORDER BY txn_date DESC, ge.id DESC LIMIT ?`
    ).bind(limit).all()).results || [];
    return json({ entries: rows });
  }

  if (seg === 'giving/entry' && method === 'POST') {
    if (!canEditGiving) return json({ error: 'Access denied' }, 403);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const result = await recordQuickGivingEntry(db, b);
    if (result.error) return json({ error: result.error }, 400);
    return json({ ok: true, id: result.id, batch_id: result.batch_id });
  }

  // ── Giving: edit/delete a recently recorded entry ───────────────────────────
  // Mirrors PUT/DELETE giving/entries/:id in api-giving.js (the desktop "Edit Gift" modal) —
  // same closed-batch guard, so a correction from a phone can't touch a batch that's already
  // been posted/deposited. Deliberately doesn't touch `notes`: the mobile quick-entry form
  // never collects one, and clobbering it to '' on every edit would silently erase whatever a
  // desktop user wrote there.
  const givEntryMatch = seg.match(/^giving\/entry\/(\d+)$/);
  if (givEntryMatch && (method === 'PATCH' || method === 'DELETE')) {
    if (!canEditGiving) return json({ error: 'Access denied' }, 403);
    const eid = parseInt(givEntryMatch[1], 10);
    const entry = await db.prepare(
      `SELECT ge.id, gb.closed FROM giving_entries ge JOIN giving_batches gb ON ge.batch_id=gb.id WHERE ge.id=?`
    ).bind(eid).first();
    if (!entry) return json({ error: 'Not found' }, 404);
    if (entry.closed) return json({ error: 'That batch is closed — edit it from the full Giving tab.' }, 409);
    if (method === 'DELETE') {
      await db.prepare('DELETE FROM giving_entries WHERE id=?').bind(eid).run();
      return json({ ok: true });
    }
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const amtCents = Math.round(parseFloat(b.amount || 0) * 100);
    if (!b.fund_id) return json({ error: 'fund_id required' }, 400);
    if (!Number.isFinite(amtCents) || amtCents <= 0) return json({ error: 'Amount must be positive' }, 400);
    await db.prepare(
      `UPDATE giving_entries SET fund_id=?, amount=?, method=?, check_number=?, contribution_date=? WHERE id=?`
    ).bind(parseInt(b.fund_id, 10), amtCents, b.method || 'cash', b.check_number || '', b.date || '', eid).run();
    return json({ ok: true });
  }

  // ── Follow-ups: toggle done/undone ────────────────────────────────────────
  if (seg === 'followups/toggle' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const id = parseInt(b.id, 10);
    if (!Number.isInteger(id)) return json({ error: 'Invalid id' }, 400);
    if (b.kind === 'followup') {
      if (!canEditItem('followups')) return json({ error: 'Access denied' }, 403);
      const row = await db.prepare(`SELECT completed FROM follow_up_items WHERE id=?`).bind(id).first();
      if (!row) return json({ error: 'Not found' }, 404);
      const done = !row.completed;
      await db.prepare(
        `UPDATE follow_up_items SET completed=?, completed_at=? WHERE id=?`
      ).bind(done ? 1 : 0, done ? new Date().toISOString() : '', id).run();
      return json({ ok: true, done });
    }
    if (b.kind === 'prayer') {
      if (!canEditBaseline) return json({ error: 'Access denied' }, 403);
      const row = await db.prepare(`SELECT status FROM prayer_requests WHERE id=?`).bind(id).first();
      if (!row) return json({ error: 'Not found' }, 404);
      const done = row.status === 'open' || row.status === 'praying';
      const newStatus = done ? 'answered' : 'open';
      const resolvedAt = done ? new Date().toISOString().slice(0, 10) : '';
      await db.prepare(`UPDATE prayer_requests SET status=?, resolved_at=? WHERE id=?`)
        .bind(newStatus, resolvedAt, id).run();
      return json({ ok: true, done });
    }
    return json({ error: 'Invalid kind' }, 400);
  }

  // ── People directory ──────────────────────────────────────────────────────
  // Member-role scoping is enforced on the QUERY, not just by redacting the rows that come
  // back — same reasoning as the main People API (api-people.js): a client-controlled
  // member_type param must not be trusted to browse outside a member's own visible slice.
  if (seg === 'people' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    const memberType = isMemberRole ? 'member' : (url.searchParams.get('member_type') || '');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '40', 10) || 40, 100);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);
    let where = `p.active=1 AND LOWER(p.member_type)!='organization'`;
    const binds = [];
    if (q) {
      where += ` AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.preferred_name LIKE ?)`;
      const like = '%' + q + '%';
      binds.push(like, like, like);
    }
    if (memberType) { where += ` AND LOWER(p.member_type)=LOWER(?)`; binds.push(memberType); }
    // Opted-out-of-the-directory people (SEC16/P22-A) never appear to a member viewer.
    if (isMemberRole) where += ' AND p.public_directory=1';
    const rows = (await db.prepare(
      `SELECT p.id, p.first_name, p.last_name, p.preferred_name, p.member_type, p.phone, p.email,
              p.dir_hide_phone, p.dir_hide_email,
              p.household_id, (SELECT COUNT(*) FROM people hp WHERE hp.household_id=p.household_id AND hp.active=1) as household_size
       FROM people p WHERE ${where}
       ORDER BY p.last_name ASC, p.first_name ASC LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset).all()).results || [];
    const people = rows.map(r => ({
      id: r.id,
      name: [r.preferred_name || r.first_name, r.last_name].filter(Boolean).join(' '),
      member_type: r.member_type || '',
      phone: (isMemberRole && r.dir_hide_phone) ? '' : (r.phone || ''),
      email: (isMemberRole && r.dir_hide_email) ? '' : (r.email || ''),
      household_size: r.household_id ? (r.household_size || 1) : 0,
    }));
    let total;
    if (offset === 0 && rows.length < limit) {
      total = rows.length;
    } else {
      const t = await db.prepare(`SELECT COUNT(*) as n FROM people p WHERE ${where}`).bind(...binds).first();
      total = t?.n || rows.length;
    }
    return json({ people, total, offset, limit });
  }

  // ── Person detail (+ household, for map/contact/household card) ──────────
  const pMatch = seg.match(/^people\/(\d+)$/);
  if (pMatch && method === 'GET') {
    const id = parseInt(pMatch[1], 10);
    const p = await db.prepare(
      `SELECT * FROM people WHERE id=? AND active=1`
    ).bind(id).first();
    if (!p) return json({ error: 'Not found' }, 404);
    // A member can only open a person who'd actually appear in their own directory list —
    // same predicate as GET people above, checked again here so a guessed id can't reach
    // someone outside that slice (an org record, a visitor, someone who's opted out).
    if (isMemberRole && (String(p.member_type || '').toLowerCase() !== 'member' || !p.public_directory)) {
      return json({ error: 'Not found' }, 404);
    }
    const hidePhone = isMemberRole && p.dir_hide_phone;
    const hideEmail = isMemberRole && p.dir_hide_email;
    const hideAddress = isMemberRole && p.dir_hide_address;
    const address = hideAddress ? '' : composeAddress(p);
    let household = [];
    if (p.household_id) {
      const hhWhere = isMemberRole
        ? 'household_id=? AND id!=? AND active=1 AND public_directory=1'
        : 'household_id=? AND id!=? AND active=1';
      const rows = (await db.prepare(
        `SELECT id, first_name, last_name, family_role FROM people
         WHERE ${hhWhere} ORDER BY family_role='head' DESC, first_name ASC`
      ).bind(p.household_id, id).all()).results || [];
      household = rows.map(r => ({
        id: r.id, name: [r.first_name, r.last_name].filter(Boolean).join(' '),
        rel: familyRoleLabel(r.family_role),
      }));
    }
    const phone = hidePhone ? '' : (p.phone || '');
    return json({
      id: p.id,
      name: [p.preferred_name || p.first_name, p.last_name].filter(Boolean).join(' '),
      member_type: p.member_type || '',
      phone, phone_raw: phone.replace(/[^\d]/g, ''),
      email: hideEmail ? '' : (p.email || ''),
      address,
      map_url: address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : '',
      household,
      household_id: p.household_id || null,
    });
  }

  // ── Households: browse + detail ─────────────────────────────────────────
  // Read-only for now (Phase 3 of MOB-ADMIN4) — the desktop household editor (address, photo,
  // name) isn't ported here yet. Viewing follows the exact same rule the People screens already
  // apply: a member never sees a household (or a member within one) that has opted out of the
  // directory (SEC16/P22-A), and a household visible only through opted-out members 404s outright
  // rather than leaking its name/address through a guessed id.
  if (seg === 'households' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10) || 30, 100);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);
    let where = `1=1`;
    const binds = [];
    if (q) { where += ` AND (h.name LIKE ? OR h.city LIKE ?)`; const like = '%' + q + '%'; binds.push(like, like); }
    if (isMemberRole) where += ` AND h.id IN (SELECT household_id FROM people WHERE active=1 AND public_directory=1 AND household_id IS NOT NULL)`;
    const rows = (await db.prepare(
      `SELECT h.id, h.name, h.city,
              (SELECT COUNT(*) FROM people p WHERE p.household_id=h.id AND p.active=1${isMemberRole ? ' AND p.public_directory=1' : ''}) as member_count,
              (SELECT p2.first_name FROM people p2 WHERE p2.household_id=h.id AND p2.active=1 AND p2.family_role='head'${isMemberRole ? ' AND p2.public_directory=1' : ''} LIMIT 1) as head_first_name
       FROM households h WHERE ${where}
       ORDER BY h.name ASC LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset).all()).results || [];
    const dupNameSet = new Set(
      ((await db.prepare(`SELECT LOWER(name) as n FROM households GROUP BY LOWER(name) HAVING COUNT(*)>1`).all()).results || []).map(r => r.n)
    );
    const households = rows.map(r => ({
      id: r.id,
      name: (dupNameSet.has((r.name || '').toLowerCase()) && r.head_first_name) ? disambiguateHHName(r.name, r.head_first_name) : r.name,
      city: r.city || '',
      member_count: r.member_count || 0,
    }));
    let total;
    if (offset === 0 && rows.length < limit) {
      total = rows.length;
    } else {
      const t = await db.prepare(`SELECT COUNT(*) as n FROM households h WHERE ${where}`).bind(...binds).first();
      total = t?.n || rows.length;
    }
    return json({ households, total, offset, limit });
  }

  const hhMatch = seg.match(/^households\/(\d+)$/);
  if (hhMatch && method === 'GET') {
    const hid = parseInt(hhMatch[1], 10);
    const h = await db.prepare(`SELECT * FROM households WHERE id=?`).bind(hid).first();
    if (!h) return json({ error: 'Not found' }, 404);
    const members = (await db.prepare(
      `SELECT id, first_name, last_name, family_role, phone, email, dir_hide_phone, dir_hide_email, public_directory
       FROM people WHERE household_id=? AND active=1 ORDER BY family_role='head' DESC, first_name ASC`
    ).bind(hid).all()).results || [];
    const visible = isMemberRole ? members.filter(m => m.public_directory === 1) : members;
    if (isMemberRole && !visible.length) return json({ error: 'Not found' }, 404);
    let name = h.name;
    const dup = await db.prepare(`SELECT COUNT(*) as n FROM households WHERE LOWER(name)=LOWER(?) AND id!=?`).bind(h.name, hid).first();
    if (dup?.n > 0) {
      const head = visible.find(m => m.family_role === 'head') || visible[0];
      if (head?.first_name) name = disambiguateHHName(h.name, head.first_name);
    }
    const address = composeAddress(h);
    return json({
      id: h.id,
      name,
      address,
      map_url: address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : '',
      members: visible.map(m => ({
        id: m.id,
        name: [m.first_name, m.last_name].filter(Boolean).join(' '),
        rel: familyRoleLabel(m.family_role),
        phone: (isMemberRole && m.dir_hide_phone) ? '' : (m.phone || ''),
        email: (isMemberRole && m.dir_hide_email) ? '' : (m.email || ''),
      })),
    });
  }

  return json({ error: 'Not found' }, 404);
}
