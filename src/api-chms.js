// ── ChMS (People & Giving) API handler ────────────────────────────────────────
import { json } from './auth.js';
import { isoWeekKey } from './api-utils.js';
import { handleHouseholdsApi } from './api-households.js';
import { handleImportApi } from './api-import.js';
import { handleReportsApi } from './api-reports.js';
import { handlePeopleApi } from './api-people.js';
import { handleGivingApi } from './api-giving.js';

export async function handleChmsApi(req, env, url, method, seg, role = 'admin') {
  const db = env.DB;

  // ── Role-based access control ────────────────────────────────────
  // Roles: admin | finance | staff | member
  //   admin   — full access
  //   finance — people CRUD + full giving; no attendance/register/followups
  //   staff   — people CRUD + attendance/register/followups/tags; no giving
  //   member  — GET people filtered to member_type='member' only
  const isAdmin   = role === 'admin';
  const isFinance = role === 'admin' || role === 'finance';
  const isStaff   = role === 'admin' || role === 'staff';
  const canEdit   = role === 'admin' || role === 'finance' || role === 'staff';

  // Giving and giving reports — finance+ only
  if ((seg.startsWith('giving') || seg.startsWith('reports/giving')) && !isFinance) {
    return json({ error: 'Access denied: giving data requires finance access' }, 403);
  }
  // Attendance, register, follow-ups, audit — staff+ only (NOT finance)
  if ((seg.startsWith('attendance') || seg.startsWith('register') ||
       seg.startsWith('followup') || seg.startsWith('audit')) && !isStaff) {
    return json({ error: 'Access denied' }, 403);
  }
  // Config (settings) — reads blocked for member; writes admin only
  if (seg.startsWith('config') && method !== 'GET' && !isAdmin) {
    return json({ error: 'Access denied: changing settings requires admin access' }, 403);
  }
  // Imports — admin only
  if (seg.startsWith('import/') && !isAdmin) {
    return json({ error: 'Access denied: imports require admin access' }, 403);
  }
  // Dev board — admin only
  if (seg === 'board' && !isAdmin) {
    return json({ error: 'Access denied' }, 403);
  }
  // Member role — GET people (filtered) + tags + member-types only; all writes blocked
  if (role === 'member') {
    const allowedSegs = seg.startsWith('people') || seg === 'tags' || seg === 'member-types';
    if (!allowedSegs) return json({ error: 'Access denied' }, 403);
    if (method !== 'GET') return json({ error: 'Access denied' }, 403);
  }
  // Write operations — require canEdit (not member)
  if (method !== 'GET' && !canEdit &&
      (seg.startsWith('people') || seg.startsWith('households') || seg.startsWith('tags') ||
       seg.startsWith('attendance') || seg.startsWith('register') || seg.startsWith('funds') ||
       seg.startsWith('organizations'))) {
    return json({ error: 'Access denied: editing requires staff or finance access' }, 403);
  }

  // ── Dashboard ────────────────────────────────────────────────────
  if (seg === 'dashboard' && method === 'GET') {
    // Membership counts by type — GROUP BY LOWER() to merge case variants (e.g. "member" vs "Member")
    const mtCfgRowDash = await db.prepare("SELECT value FROM chms_config WHERE key='member_types'").first();
    const configuredTypesDash = mtCfgRowDash ? JSON.parse(mtCfgRowDash.value) : ['Member','Friend','Visitor','Inactive','Organization','Other'];
    const typeNameMapDash = {};
    for (const t of configuredTypesDash) typeNameMapDash[t.toLowerCase()] = t;
    const typeCounts = (await db.prepare(
      `SELECT LOWER(member_type) as member_type, COUNT(*) as n FROM people WHERE active=1 GROUP BY LOWER(member_type) ORDER BY n DESC`
    ).all()).results || [];
    for (const r of typeCounts) r.member_type = typeNameMapDash[r.member_type] || (r.member_type.charAt(0).toUpperCase() + r.member_type.slice(1));
    const totalPeople = typeCounts.reduce(function(s,r){return s+r.n;},0);
    const totalHouseholds = (await db.prepare(`SELECT COUNT(*) as n FROM households`).first())?.n || 0;
    // DB1: member-only count for dashboard stat card
    const memberCount = (await db.prepare(
      `SELECT COUNT(*) as n FROM people WHERE active=1 AND LOWER(member_type)='member'`
    ).first())?.n || 0;
    // DB2: households that contain at least one member
    const memberHHCount = (await db.prepare(
      `SELECT COUNT(DISTINCT household_id) as n FROM people
       WHERE active=1 AND LOWER(member_type)='member'
         AND household_id IS NOT NULL AND household_id != ''`
    ).first())?.n || 0;
    // Added this month / this year
    const addedThisMonth = (await db.prepare(
      `SELECT COUNT(*) as n FROM people WHERE active=1 AND created_at >= date('now','start of month')`
    ).first())?.n || 0;
    const addedThisYear = (await db.prepare(
      `SELECT COUNT(*) as n FROM people WHERE active=1 AND created_at >= date('now','start of year')`
    ).first())?.n || 0;
    // Giving dashboard stats — General Fund only (funds whose name starts with '40085')
    const gfYtd = (await db.prepare(
      `SELECT COALESCE(SUM(ge.amount),0) as total FROM giving_entries ge
       JOIN giving_batches gb ON ge.batch_id=gb.id
       JOIN funds f ON ge.fund_id=f.id
       WHERE substr(COALESCE(NULLIF(ge.contribution_date,''),gb.batch_date),1,4)=strftime('%Y','now')
         AND f.name LIKE '40085%'`
    ).first())?.total || 0;
    const gfLastYearYtd = (await db.prepare(
      `SELECT COALESCE(SUM(ge.amount),0) as total FROM giving_entries ge
       JOIN giving_batches gb ON ge.batch_id=gb.id
       JOIN funds f ON ge.fund_id=f.id
       WHERE COALESCE(NULLIF(ge.contribution_date,''),gb.batch_date)
               BETWEEN strftime('%Y','now','-1 year')||'-01-01'
                   AND strftime('%Y-%m-%d','now','-1 year')
         AND f.name LIKE '40085%'`
    ).first())?.total || 0;
    const gfLastYearTotal = (await db.prepare(
      `SELECT COALESCE(SUM(ge.amount),0) as total FROM giving_entries ge
       JOIN giving_batches gb ON ge.batch_id=gb.id
       JOIN funds f ON ge.fund_id=f.id
       WHERE substr(COALESCE(NULLIF(ge.contribution_date,''),gb.batch_date),1,4)=cast(strftime('%Y','now')-1 as text)
         AND f.name LIKE '40085%'`
    ).first())?.total || 0;
    // DB4: Month-at-a-time birthdays & anniversaries (exclude visitor/inactive/other/org)
    const dashMonth = Math.max(1, Math.min(12, parseInt(url.searchParams.get('month') || '') || (new Date().getMonth() + 1)));
    const dashMonthStr = String(dashMonth).padStart(2, '0');
    const birthdays = (await db.prepare(
      `SELECT id, first_name, last_name, dob FROM people
       WHERE active=1 AND (status IS NULL OR status='active') AND dob != ''
         AND LOWER(member_type) = 'member'
         AND strftime('%m', dob) = ?
       ORDER BY strftime('%d', dob)`
    ).bind(dashMonthStr).all()).results || [];
    // DB4: fetch anniversaries with role+household so couples can be paired
    const annRows = (await db.prepare(
      `SELECT id, first_name, last_name, anniversary_date, family_role, household_id FROM people
       WHERE active=1 AND (status IS NULL OR status='active')
         AND (deceased=0 OR deceased IS NULL) AND anniversary_date != ''
         AND LOWER(member_type) NOT IN ('visitor','inactive','other','organization')
         AND strftime('%m', anniversary_date) = ?
         AND NOT EXISTS (
           SELECT 1 FROM people p2
           WHERE p2.household_id=people.household_id AND p2.id!=people.id
             AND (p2.deceased=1 OR p2.status='deceased') AND p2.family_role IN ('head','spouse')
         )
       ORDER BY strftime('%d', anniversary_date), household_id,
         CASE family_role WHEN 'head' THEN 0 WHEN 'spouse' THEN 1 ELSE 2 END`
    ).bind(dashMonthStr).all()).results || [];
    // Group same-household + same-date pairs into one entry ("Bob & Alice Johnson")
    const _annRoleOrder = { head: 0, spouse: 1, child: 2, other: 3 };
    const annGroupMap = new Map();
    for (const p of annRows) {
      const key = (p.household_id && p.household_id !== '') ? `${p.household_id}:${p.anniversary_date}` : `_${p.id}`;
      if (!annGroupMap.has(key)) annGroupMap.set(key, []);
      annGroupMap.get(key).push(p);
    }
    // For still-unpaired entries, try to find the household partner who may not have anniversary_date set.
    // Common Breeze pattern: only the head of household has the date; spouse field is blank.
    const unpairedHHIds = [...new Set(
      [...annGroupMap.values()]
        .filter(g => g.length === 1 && g[0].household_id)
        .map(g => g[0].household_id)
    )];
    if (unpairedHHIds.length > 0) {
      const ph = unpairedHHIds.map(() => '?').join(',');
      const partners = (await db.prepare(
        `SELECT id, first_name, last_name, anniversary_date, family_role, household_id
         FROM people WHERE active=1 AND (status IS NULL OR status='active')
           AND (deceased=0 OR deceased IS NULL) AND household_id IN (${ph})`
      ).bind(...unpairedHHIds).all()).results || [];
      const partnersByHH = {};
      for (const s of partners) {
        if (!partnersByHH[s.household_id]) partnersByHH[s.household_id] = [];
        partnersByHH[s.household_id].push(s);
      }
      for (const group of annGroupMap.values()) {
        if (group.length !== 1 || !group[0].household_id) continue;
        const existing = group[0];
        const candidates = (partnersByHH[existing.household_id] || []).filter(s => s.id !== existing.id);
        // Prefer head/spouse roles; fall back to any household member
        const partner = candidates.find(s => s.family_role === 'head' || s.family_role === 'spouse') || candidates[0];
        if (partner) group.push({ ...partner, anniversary_date: existing.anniversary_date });
      }
    }
    const anniversaries = [...annGroupMap.values()]
      .map(group => {
        group.sort((a, b) => (_annRoleOrder[a.family_role] ?? 4) - (_annRoleOrder[b.family_role] ?? 4) || a.id - b.id);
        return {
          id: group[0].id,
          first_name: group.map(p => p.first_name || '').filter(Boolean).join(' & '),
          last_name: group[0].last_name,
          anniversary_date: group[0].anniversary_date,
          paired: group.length > 1
        };
      })
      .sort((a, b) => a.anniversary_date.slice(5) < b.anniversary_date.slice(5) ? -1 : 1);
    // Recent additions
    const recentPeople = (await db.prepare(
      `SELECT p.id, p.first_name, p.last_name, p.member_type, p.created_at, h.name as household_name
       FROM people p LEFT JOIN households h ON p.household_id=h.id
       WHERE p.active=1 ORDER BY p.created_at DESC LIMIT 10`
    ).all()).results || [];
    // Most recent attendance
    // DB3: Last 2 services (show both Sunday services)
    const recentAttendance = (await db.prepare(
      `SELECT service_date, service_time, service_name, attendance
       FROM worship_services WHERE attendance > 0
       ORDER BY service_date DESC, service_time DESC LIMIT 2`
    ).all()).results || [];
    // Open follow-up items (pastoral queue)
    const followUpItems = (await db.prepare(
      `SELECT f.*, p.first_name, p.last_name FROM follow_up_items f
       LEFT JOIN people p ON p.id=f.person_id
       WHERE f.completed=0 ORDER BY f.created_at DESC LIMIT 50`
    ).all()).results || [];
    // First-time givers in the last 60 days (exclude dismissed records)
    const firstGivers = (await db.prepare(
      `SELECT p.id, p.first_name, p.last_name, MIN(COALESCE(NULLIF(ge.contribution_date,''),gb.batch_date)) as first_gift_date
       FROM giving_entries ge
       JOIN giving_batches gb ON ge.batch_id=gb.id
       JOIN people p ON p.id=ge.person_id
       WHERE p.first_gift_noted = 0
       GROUP BY ge.person_id
       HAVING first_gift_date >= date('now','-60 days')
       ORDER BY first_gift_date DESC LIMIT 20`
    ).all()).results || [];
    // People not seen recently (last_seen_date set more than 8 weeks ago, or never seen but added 8+ weeks ago)
    const notSeenRecently = (await db.prepare(
      `SELECT id, first_name, last_name, member_type, last_seen_date, created_at FROM people
       WHERE active=1 AND (
         (last_seen_date != '' AND last_seen_date < date('now','-56 days'))
       ) ORDER BY last_seen_date ASC LIMIT 20`
    ).all()).results || [];
    // Weekly review queue (DC1): small batch of stale visitor/friend records due for triage.
    // "Stale" = never reviewed OR last_reviewed_at older than 365 days.
    const reviewQueueBatch = (await db.prepare(
      `SELECT id, first_name, last_name, member_type, email, phone,
              created_at, last_reviewed_at, last_seen_date,
              (SELECT MAX(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date))
                 FROM giving_entries ge
                 JOIN giving_batches gb ON gb.id = ge.batch_id
                 WHERE ge.person_id = people.id) AS last_gift_date
       FROM people
       WHERE status='active'
         AND LOWER(member_type) NOT IN ('member','organization','')
         AND (last_reviewed_at = '' OR date(last_reviewed_at) < date('now','-365 days'))
       ORDER BY CASE WHEN last_reviewed_at = '' THEN 0 ELSE 1 END,
                last_reviewed_at ASC,
                created_at ASC
       LIMIT 5`
    ).all()).results || [];
    const reviewQueueTotal = (await db.prepare(
      `SELECT COUNT(*) AS n FROM people
       WHERE status='active'
         AND LOWER(member_type) NOT IN ('member','organization','')
         AND (last_reviewed_at = '' OR date(last_reviewed_at) < date('now','-365 days'))`
    ).first())?.n || 0;
    // New-contact follow-up queue (FU2/DB9)
    const followupQueueBatch = (await db.prepare(
      `SELECT id, first_name, last_name, member_type, email, phone,
              first_contact_date, followup_status, followup_notes
       FROM people
       WHERE status='active'
         AND first_contact_date != ''
         AND (followup_status IS NULL OR followup_status != 'done')
         AND LOWER(member_type) NOT IN ('member','organization')
       ORDER BY first_contact_date DESC, id DESC
       LIMIT 5`
    ).all()).results || [];
    const followupQueueTotal = (await db.prepare(
      `SELECT COUNT(*) AS n FROM people
       WHERE status='active'
         AND first_contact_date != ''
         AND (followup_status IS NULL OR followup_status != 'done')
         AND LOWER(member_type) NOT IN ('member','organization')`
    ).first())?.n || 0;
    // Weekly task checklist (engagement_tasks) — auto-seed defaults on first access each week
    let weeklyTasks = [], weeklyTasksWeek = '';
    if (canEdit) {
      weeklyTasksWeek = isoWeekKey();
      weeklyTasks = (await db.prepare(
        'SELECT * FROM engagement_tasks WHERE week_key=? ORDER BY sort_order, id'
      ).bind(weeklyTasksWeek).all()).results || [];
      if (!weeklyTasks.length) {
        const defaults = [
          'Review new visitors in the people list',
          'Send newsletter to new contacts',
          'Follow up with first-time givers',
          'Follow up with prayer requests',
          'Check in with members not seen recently',
        ];
        for (let i = 0; i < defaults.length; i++) {
          await db.prepare('INSERT INTO engagement_tasks(title,week_key,sort_order) VALUES(?,?,?)').bind(defaults[i], weeklyTasksWeek, i).run();
        }
        weeklyTasks = (await db.prepare(
          'SELECT * FROM engagement_tasks WHERE week_key=? ORDER BY sort_order, id'
        ).bind(weeklyTasksWeek).all()).results || [];
      }
    }
    // Open prayer requests (FU1) — staff+ sees these
    let prayerOpen = [], prayerOpenTotal = 0;
    if (canEdit) {
      prayerOpen = (await db.prepare(
        `SELECT pr.id, pr.person_id, pr.requester_name, pr.requester_email, pr.request_text,
                pr.source, pr.status, pr.submitted_at,
                p.first_name, p.last_name
         FROM prayer_requests pr
         LEFT JOIN people p ON p.id = pr.person_id
         WHERE pr.status IN ('open','praying')
         ORDER BY pr.submitted_at DESC, pr.id DESC
         LIMIT 5`
      ).all()).results || [];
      prayerOpenTotal = (await db.prepare(
        "SELECT COUNT(*) AS n FROM prayer_requests WHERE status IN ('open','praying')"
      ).first())?.n || 0;
    }
    return json({
      totalPeople, totalHouseholds, memberCount, memberHHCount,
      addedThisMonth, addedThisYear, dashMonth,
      typeCounts,
      // giving data: finance+ only (General Fund = funds starting with '40085')
      gfYtd:           isFinance ? gfYtd           : undefined,
      gfLastYearYtd:   isFinance ? gfLastYearYtd   : undefined,
      gfLastYearTotal: isFinance ? gfLastYearTotal  : undefined,
      firstGivers:     isFinance ? firstGivers     : [],
      // pastoral data: staff+ only
      followUpItems:   isStaff  ? followUpItems   : [],
      recentAttendance: isStaff ? recentAttendance : [],
      birthdays, anniversaries, recentPeople, notSeenRecently,
      // engagement review queue (DC1/DB9): any editor can use
      reviewQueue:     canEdit ? reviewQueueBatch : [],
      reviewQueueTotal: canEdit ? reviewQueueTotal : 0,
      // new-contact follow-up queue (FU2/DB9)
      followupQueue:   canEdit ? followupQueueBatch : [],
      followupQueueTotal: canEdit ? followupQueueTotal : 0,
      // weekly task checklist
      weeklyTasks, weeklyTasksWeek,
      // prayer requests (FU1)
      prayerOpen, prayerOpenTotal
    });
  }

  // ── People / Archive / Brevo / Photos / Follow-ups → api-people.js ────────
  if (seg.startsWith('people') || seg === 'member-types' ||
      seg.startsWith('brevo/') || seg.startsWith('followup') || seg === 'audit' || seg === 'audit/undo') {
    const result = await handlePeopleApi(req, env, url, method, seg, db, isAdmin, isFinance, isStaff, canEdit);
    if (result !== null) return result;
  }

  // ── Households / Organizations / Tags / Funds → api-households.js ─────────
  if (seg.startsWith('households') || seg.startsWith('organizations') ||
      seg.startsWith('tags') || seg.startsWith('funds')) {
    const result = await handleHouseholdsApi(req, env, url, method, seg, db, isAdmin, isFinance, isStaff, canEdit);
    if (result !== null) return result;
  }

  // ── Giving Entries / Batches / Quick Entry → api-giving.js ─────────────────
  if (seg.startsWith('giving') || seg.startsWith('giving/')) {
    const result = await handleGivingApi(req, env, url, method, seg, db, isAdmin, isFinance, isStaff, canEdit);
    if (result !== null) return result;
  }

  // ── Reports / Engagement / Prayer → api-reports.js ────────────────────────
  if (seg.startsWith('reports/') || seg.startsWith('engagement/') || seg.startsWith('prayer-requests') ||
      seg === 'giving/reconcile-orphans' || seg === 'giving/reconcile-diagnose' ||
      seg === 'giving/force-remove-orphans' ||
      (seg.startsWith('people/') && seg.endsWith('/dismiss-first-gift'))) {
    const result = await handleReportsApi(req, env, url, method, seg, db, isAdmin, isFinance, isStaff, canEdit);
    if (result !== null) return result;
  }

  // ── Attendance ───────────────────────────────────────────────────
  if (seg === 'attendance' && method === 'GET') {
    const from = url.searchParams.get('from') || (new Date().getFullYear() + '-01-01');
    const to   = url.searchParams.get('to')   || (new Date().getFullYear() + '-12-31');
    const type = url.searchParams.get('type') || '';
    const order = (url.searchParams.get('order') || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    let sql = 'SELECT * FROM worship_services WHERE service_date BETWEEN ? AND ?';
    const binds = [from, to];
    if (type) { sql += ' AND service_type=?'; binds.push(type); }
    sql += ` ORDER BY service_date ${order}, service_time ASC`;
    const rows = (await db.prepare(sql).bind(...binds).all()).results || [];
    const totalRow = await db.prepare('SELECT COUNT(*) as n FROM worship_services').first();
    return json({ services: rows, total_in_db: totalRow?.n ?? 0 });
  }

  if (seg === 'attendance' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const r = await db.prepare(
      `INSERT INTO worship_services (service_date,service_time,service_name,service_type,attendance,communion,notes)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(b.service_date||'',b.service_time||'',b.service_name||'',b.service_type||'sunday',
           parseInt(b.attendance)||0,parseInt(b.communion)||0,b.notes||'').run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }

  if (seg.match(/^attendance\/\d+$/) && method === 'PUT') {
    const id = parseInt(seg.split('/')[1]);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    // Merge with existing row so partial updates (attendance only) work
    const existing = await db.prepare('SELECT * FROM worship_services WHERE id=?').bind(id).first();
    if (!existing) return json({ error: 'Not found' }, 404);
    await db.prepare(
      `UPDATE worship_services SET service_date=?,service_time=?,service_name=?,service_type=?,attendance=?,communion=?,notes=? WHERE id=?`
    ).bind(
      b.service_date ?? existing.service_date,
      b.service_time ?? existing.service_time,
      b.service_name ?? existing.service_name,
      b.service_type ?? existing.service_type,
      b.attendance !== undefined ? parseInt(b.attendance)||0 : existing.attendance,
      b.communion !== undefined ? parseInt(b.communion)||0 : existing.communion,
      b.notes !== undefined ? b.notes : existing.notes,
      id
    ).run();
    return json({ ok: true });
  }

  if (seg.match(/^attendance\/\d+$/) && method === 'DELETE') {
    const id = parseInt(seg.split('/')[1]);
    await db.prepare('DELETE FROM worship_services WHERE id=?').bind(id).run();
    return json({ ok: true });
  }

  // Seed all Sundays for a year with 8:00 and 10:45 services (skips existing)
  if (seg === 'attendance/seed-year' && method === 'POST') {
    let b; try { b = await req.json(); } catch { b = {}; }
    const year = parseInt(b.year) || new Date().getFullYear();
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    // Find all Sundays in the year
    const sundays = [];
    const d = new Date(year, 0, 1);
    // Advance to first Sunday
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
    while (d.getFullYear() === year) {
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const dd = String(d.getDate()).padStart(2,'0');
      const dateStr = `${year}-${mm}-${dd}`;
      const name = `${months[d.getMonth()]} ${d.getDate()}`;
      sundays.push({ dateStr, name });
      d.setDate(d.getDate() + 7);
    }
    let inserted = 0, skipped = 0;
    for (const { dateStr, name } of sundays) {
      for (const time of ['08:00', '10:45']) {
        const exists = await db.prepare(
          'SELECT id FROM worship_services WHERE service_date=? AND service_time=?'
        ).bind(dateStr, time).first();
        if (exists) { skipped++; continue; }
        await db.prepare(
          `INSERT INTO worship_services (service_date,service_time,service_name,service_type,attendance,communion,notes)
           VALUES (?,?,?,?,0,0,?)`
        ).bind(dateStr, time, name, 'sunday', '').run();
        inserted++;
      }
    }
    return json({ ok: true, year, sundays: sundays.length, inserted, skipped });
  }

  if (seg === 'attendance/bulk-sunday' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const date = b.service_date || '';
    const name = b.service_name || '';
    const ids = [];
    for (const [time, att, com] of [['08:00', parseInt(b.att_8)||0, parseInt(b.com_8)||0], ['10:45', parseInt(b.att_1045)||0, parseInt(b.com_1045)||0]]) {
      const r = await db.prepare(
        `INSERT INTO worship_services (service_date,service_time,service_name,service_type,attendance,communion,notes)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(date, time, name, 'sunday', att, com, b.notes||'').run();
      ids.push(r.meta?.last_row_id);
    }
    return json({ ok: true, ids });
  }

  if (seg === 'attendance/sunday-name' && method === 'GET') {
    const date = url.searchParams.get('date') || '';
    // Check scheduler_data for custom label
    try {
      const row = await db.prepare("SELECT value FROM scheduler_data WHERE key='ws_sun_labels'").first();
      if (row?.value) {
        const labels = JSON.parse(row.value);
        if (labels[date]) return json({ name: labels[date] });
      }
    } catch {}
    return json({ name: '' });
  }

  if (seg === 'reports/attendance-summary' && method === 'GET') {
    const yearsParam = url.searchParams.get('years') || String(new Date().getFullYear());
    const years = yearsParam.split(',').map(y => y.trim()).filter(Boolean).slice(0, 6);
    // For each year, get monthly Sunday combined totals
    const result = {};
    for (const yr of years) {
      const rows = (await db.prepare(
        `SELECT strftime('%m', service_date) as month,
                ROUND(SUM(attendance) * 1.0 / COUNT(DISTINCT service_date)) as total,
                COUNT(DISTINCT service_date) as sundays,
                SUM(attendance) as monthly_total,
                SUM(CASE WHEN service_time='08:00' THEN attendance ELSE 0 END) as att_8,
                SUM(CASE WHEN service_time='10:45' THEN attendance ELSE 0 END) as att_1045
         FROM worship_services
         WHERE service_type='sunday' AND attendance > 0 AND substr(service_date,1,4)=?
         GROUP BY month ORDER BY month`
      ).bind(yr).all()).results || [];
      result[yr] = rows;
    }
    // Also per-year totals
    const totals = {};
    for (const yr of years) {
      const t = await db.prepare(
        `SELECT SUM(attendance) as total, COUNT(DISTINCT service_date) as sundays
         FROM worship_services WHERE service_type='sunday' AND attendance > 0 AND substr(service_date,1,4)=?`
      ).bind(yr).first();
      totals[yr] = t || { total: 0, sundays: 0 };
    }
    return json({ years, monthly: result, totals });
  }

  if (seg === 'reports/attendance-by-time' && method === 'GET') {
    const yearsParam = url.searchParams.get('years');
    if (yearsParam) {
      const years = yearsParam.split(',').map(y => y.trim()).filter(y => /^\d{4}$/.test(y)).slice(0, 10);
      const by_time_years = {};
      await Promise.all(years.map(async yr => {
        const rows = (await db.prepare(
          `SELECT service_time, service_type,
                  MAX(service_name) as service_name,
                  COUNT(*) as services, SUM(attendance) as total,
                  ROUND(AVG(attendance)) as avg_attendance
           FROM worship_services
           WHERE attendance > 0 AND service_date BETWEEN ? AND ?
           GROUP BY service_type, service_time ORDER BY service_type, service_time`
        ).bind(yr + '-01-01', yr + '-12-31').all()).results || [];
        by_time_years[yr] = rows;
      }));
      return json({ mode: 'multi-year', years, by_time_years });
    }
    const from = url.searchParams.get('from') || (new Date().getFullYear() + '-01-01');
    const to   = url.searchParams.get('to')   || (new Date().getFullYear() + '-12-31');
    const rows = (await db.prepare(
      `SELECT service_time, service_type,
              MAX(service_name) as service_name,
              COUNT(*) as services, SUM(attendance) as total,
              ROUND(AVG(attendance)) as avg_attendance
       FROM worship_services
       WHERE attendance > 0 AND service_date BETWEEN ? AND ?
       GROUP BY service_type, service_time ORDER BY service_type, service_time`
    ).bind(from, to).all()).results || [];
    // Sunday combined totals per date
    const sundays = (await db.prepare(
      `SELECT service_date, SUM(attendance) as combined,
              MIN(CASE WHEN service_time='08:00' THEN attendance END) as att_8,
              MIN(CASE WHEN service_time='10:45' THEN attendance END) as att_1045
       FROM worship_services
       WHERE service_type='sunday' AND attendance > 0 AND service_date BETWEEN ? AND ?
       GROUP BY service_date ORDER BY service_date ASC`
    ).bind(from, to).all()).results || [];
    return json({ mode: 'date-range', from, to, by_time: rows, sundays });
  }

  // ── Import / Config / Register / Export / Breeze Sync → api-import.js ──
  return await handleImportApi(req, env, url, method, seg, db, isAdmin, isFinance, isStaff, canEdit);
}

// ── ChMS SEED DEFAULTS ──────────────────────────────────────────────
