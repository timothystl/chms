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

function composeAddress(p) {
  const line1 = [p.address1, p.address2].filter(Boolean).join(' ');
  const cityStateZip = [[p.city, p.state].filter(Boolean).join(', '), p.zip].filter(Boolean).join(' ');
  return [line1, cityStateZip].filter(Boolean).join(', ');
}

function familyRoleLabel(role) {
  const map = { head: 'Head of Household', spouse: 'Spouse', child: 'Child' };
  return map[String(role || '').toLowerCase()] || 'Family';
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
    const blobRows = (await db.prepare(
      `SELECT key, value, updated_at FROM scheduler_data WHERE key IN ('ws_schedule_v2','ws_people','ws_confirmations')`
    ).all()).results || [];
    const blobs = {};
    let confirmationsAsOf = null;
    for (const r of blobRows) {
      try { blobs[r.key] = JSON.parse(r.value); } catch { blobs[r.key] = null; }
      if (r.key === 'ws_confirmations') confirmationsAsOf = r.updated_at || null;
    }
    const months = (blobs.ws_schedule_v2 && typeof blobs.ws_schedule_v2 === 'object') ? blobs.ws_schedule_v2 : {};
    const people = Array.isArray(blobs.ws_people) ? blobs.ws_people : [];
    const confirmations = (blobs.ws_confirmations && typeof blobs.ws_confirmations === 'object') ? blobs.ws_confirmations : {};
    const peopleById = {};
    for (const p of people) if (p && p.id != null) peopleById[String(p.id)] = p;

    function personOf(pid) {
      if (pid == null) return null;
      const p = peopleById[String(pid)];
      return { id: pid, name: p ? (p.name || '') : '(unknown)' };
    }
    function statusOf(roleName, svc) {
      return confirmations[`${dateISO}|${roleName}|${svc}`] || 'pending';
    }

    const monthKey = dateISO.slice(0, 7);
    const monthRows = (months[monthKey] && Array.isArray(months[monthKey].rows)) ? months[monthKey].rows : [];
    const row = monthRows.find(r => r && r.dateISO === dateISO);

    if (!row) {
      return json({ date_iso: dateISO, has_schedule: false });
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
      return json({
        date_iso: dateISO, has_schedule: true, kind: 'special', name: row.name || '',
        confirmations_as_of: confirmationsAsOf,
        services, counts: { filled, open: total - filled, total },
      });
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

    return json({
      date_iso: dateISO, has_schedule: true, kind: 'sunday',
      ordinal: row.ordinal || null, label: row.label || '',
      confirmations_as_of: confirmationsAsOf,
      services, shared_roles: sharedRoles,
      counts: { filled, open: total - filled, total },
    });
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
      `SELECT ge.id, ge.amount, ge.method,
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
