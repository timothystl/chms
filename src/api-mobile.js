// ── Mobile Admin API ────────────────────────────────────────────────────────
// Backs the phone-optimized admin experience at /admin/mobile (splash, dashboard,
// people directory, person detail). Deliberately its own small handler rather than
// routed through handleChmsApi's per-item ACCESS_GATE: this composes data across
// attendance + follow_up_items + prayer_requests + people/households in a few
// purpose-built endpoints shaped exactly for the phone screens, instead of asking the
// mobile frontend to make (and reconcile) several general-purpose API calls.
import { json } from './auth.js';
import { getRolePermissions, permissionsForRole } from './api-utils.js';

// Who this surface is for: the roles that would plausibly be on their phone doing a
// quick attendance count or checking follow-ups. Same exclusion as everywhere else in
// the app — member (filtered directory) and volunteer (read-only Volunteers screen)
// have no reason to be here and get a flat 403, not a partially-empty page.
function mobileAllowed(role) {
  return role === 'admin' || role === 'finance' || role === 'staff' || role === 'council';
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
  const perms = await getRolePermissions(db);
  const rolePerms = permissionsForRole(perms, role);
  const canView = (item) => isAdmin || (rolePerms[item] || 'none') !== 'none';
  const canEditItem = (item) => isAdmin || (rolePerms[item] || 'none') === 'edit';
  // Follow-up items live behind `followups`; prayer requests reuse the People/Households
  // "canEdit" definition the prayer-requests endpoint itself gates on (api-reports.js).
  const canEditBaseline = isAdmin || role === 'finance' || role === 'staff' || role === 'council';

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

    const peopleTotalRow = await db.prepare(
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
      can_edit_attendance: canEditItem('attendance'),
      people_total: peopleTotal,
      can_view_followups: canViewFollowups || canEditBaseline,
      followups: followups.slice(0, 8),
      open_followup_count: openFollowupCount,
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
  if (seg === 'people' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    const memberType = url.searchParams.get('member_type') || '';
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
    const rows = (await db.prepare(
      `SELECT p.id, p.first_name, p.last_name, p.preferred_name, p.member_type, p.phone, p.email,
              p.household_id, (SELECT COUNT(*) FROM people hp WHERE hp.household_id=p.household_id AND hp.active=1) as household_size
       FROM people p WHERE ${where}
       ORDER BY p.last_name ASC, p.first_name ASC LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset).all()).results || [];
    const people = rows.map(r => ({
      id: r.id,
      name: [r.preferred_name || r.first_name, r.last_name].filter(Boolean).join(' '),
      member_type: r.member_type || '',
      phone: r.phone || '', email: r.email || '',
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
    const address = composeAddress(p);
    let household = [];
    if (p.household_id) {
      const rows = (await db.prepare(
        `SELECT id, first_name, last_name, family_role FROM people
         WHERE household_id=? AND id!=? AND active=1 ORDER BY family_role='head' DESC, first_name ASC`
      ).bind(p.household_id, id).all()).results || [];
      household = rows.map(r => ({
        id: r.id, name: [r.first_name, r.last_name].filter(Boolean).join(' '),
        rel: familyRoleLabel(r.family_role),
      }));
    }
    return json({
      id: p.id,
      name: [p.preferred_name || p.first_name, p.last_name].filter(Boolean).join(' '),
      member_type: p.member_type || '',
      phone: p.phone || '', phone_raw: (p.phone || '').replace(/[^\d]/g, ''),
      email: p.email || '',
      address,
      map_url: address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : '',
      household,
    });
  }

  return json({ error: 'Not found' }, 404);
}
