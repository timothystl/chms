// ── ChMS (People & Giving) API handler ────────────────────────────────────────
import { html, json } from './auth.js';

// Disambiguate household display names when multiple households share the same name.
// "Smith Family" + "John" → "John Smith Family"; "Smith" + "John" → "John Smith"
function disambiguateHHName(name, headFirst) {
  if (!headFirst) return name;
  const m = name.match(/^(.*?)\s*Family\s*$/i);
  return m ? (headFirst + ' ' + m[1].trim() + ' Family') : (headFirst + ' ' + name);
}

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
    // Giving this year vs last year
    const givingThisYear = (await db.prepare(
      `SELECT COALESCE(SUM(ge.amount),0) as total FROM giving_entries ge
       JOIN giving_batches gb ON ge.batch_id=gb.id
       WHERE substr(COALESCE(NULLIF(ge.contribution_date,''),gb.batch_date),1,4)=strftime('%Y','now')`
    ).first())?.total || 0;
    const givingLastYear = (await db.prepare(
      `SELECT COALESCE(SUM(ge.amount),0) as total FROM giving_entries ge
       JOIN giving_batches gb ON ge.batch_id=gb.id
       WHERE substr(COALESCE(NULLIF(ge.contribution_date,''),gb.batch_date),1,4)=cast(strftime('%Y','now')-1 as text)`
    ).first())?.total || 0;
    // DB4: Month-at-a-time birthdays & anniversaries (exclude visitor/inactive/other/org)
    const dashMonth = Math.max(1, Math.min(12, parseInt(url.searchParams.get('month') || '') || (new Date().getMonth() + 1)));
    const dashMonthStr = String(dashMonth).padStart(2, '0');
    const birthdays = (await db.prepare(
      `SELECT id, first_name, last_name, dob FROM people
       WHERE active=1 AND dob != ''
         AND LOWER(member_type) NOT IN ('visitor','inactive','other','organization')
         AND strftime('%m', dob) = ?
       ORDER BY strftime('%d', dob)`
    ).bind(dashMonthStr).all()).results || [];
    // DB4: fetch anniversaries with role+household so couples can be paired
    const annRows = (await db.prepare(
      `SELECT id, first_name, last_name, anniversary_date, family_role, household_id FROM people
       WHERE active=1 AND (deceased=0 OR deceased IS NULL) AND anniversary_date != ''
         AND LOWER(member_type) NOT IN ('visitor','inactive','other','organization')
         AND strftime('%m', anniversary_date) = ?
         AND NOT EXISTS (
           SELECT 1 FROM people p2
           WHERE p2.household_id=people.household_id AND p2.id!=people.id
             AND p2.deceased=1 AND p2.family_role IN ('head','spouse')
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
         FROM people WHERE active=1 AND (deceased=0 OR deceased IS NULL) AND household_id IN (${ph})`
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
      `SELECT service_date, service_name, attendance
       FROM worship_services WHERE attendance > 0
       ORDER BY service_date DESC, service_time DESC LIMIT 2`
    ).all()).results || [];
    // Open follow-up items (pastoral queue)
    const followUpItems = (await db.prepare(
      `SELECT f.*, p.first_name, p.last_name FROM follow_up_items f
       LEFT JOIN people p ON p.id=f.person_id
       WHERE f.completed=0 ORDER BY f.created_at DESC LIMIT 50`
    ).all()).results || [];
    // First-time givers in the last 60 days
    const firstGivers = (await db.prepare(
      `SELECT p.id, p.first_name, p.last_name, MIN(COALESCE(NULLIF(ge.contribution_date,''),gb.batch_date)) as first_gift_date
       FROM giving_entries ge
       JOIN giving_batches gb ON ge.batch_id=gb.id
       JOIN people p ON p.id=ge.person_id
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
    return json({
      totalPeople, totalHouseholds, memberCount, memberHHCount,
      addedThisMonth, addedThisYear, dashMonth,
      typeCounts,
      // giving data: finance+ only
      givingThisYear:  isFinance ? givingThisYear  : undefined,
      givingLastYear:  isFinance ? givingLastYear  : undefined,
      firstGivers:     isFinance ? firstGivers     : [],
      // pastoral data: staff+ only
      followUpItems:   isStaff  ? followUpItems   : [],
      recentAttendance: isStaff ? recentAttendance : [],
      birthdays, anniversaries, recentPeople, notSeenRecently
    });
  }

  // ── People ──────────────────────────────────────────────────────
  if (seg === 'people' && method === 'GET') {
    const q = url.searchParams.get('q') || '';
    const mt = url.searchParams.get('member_type') || '';
    const tagId = url.searchParams.get('tag_id') || '';
    const tagIdsRaw = url.searchParams.get('tag_ids') || '';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const SORT_COLS = { last_name: 'p.last_name', first_name: 'p.first_name', member_type: 'p.member_type', created_at: 'p.created_at', household: 'h.name' };
    const sortCol = SORT_COLS[url.searchParams.get('sort') || ''] || 'p.last_name';
    const sortDir = url.searchParams.get('dir') === 'desc' ? 'DESC' : 'ASC';
    const like = '%' + q + '%';
    let where = `p.active=1 AND LOWER(p.member_type) != 'organization'
      AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.email LIKE ? OR p.phone LIKE ?)`;
    const binds = [like, like, like, like];
    // Member role can only see people with member_type='member'
    if (role === 'member') { where += ` AND LOWER(p.member_type)='member'`; }
    if (mt) { where += ' AND LOWER(p.member_type)=LOWER(?)'; binds.push(mt); }
    if (tagId) { where += ' AND p.id IN (SELECT person_id FROM person_tags WHERE tag_id=?)'; binds.push(tagId); }
    // Multi-tag AND filter: each tag must match separately
    const tagIds = tagIdsRaw ? tagIdsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    for (const tid of tagIds) {
      where += ' AND p.id IN (SELECT person_id FROM person_tags WHERE tag_id=?)';
      binds.push(tid);
    }
    // Missing-field AND filter: validate each value against allowlist to prevent injection
    const missingClauses = {
      dob:          `(p.dob IS NULL OR p.dob='')`,
      gender:       `(p.gender IS NULL OR p.gender='')`,
      photo:        `(p.photo_url IS NULL OR p.photo_url='')`,
      anniversary:  `(p.anniversary_date IS NULL OR p.anniversary_date='')`,
      baptism:      `(p.baptism_date IS NULL OR p.baptism_date='')`,
      confirmation: `(p.confirmation_date IS NULL OR p.confirmation_date='')`,
      email:        `(p.email IS NULL OR p.email='')`,
      phone:        `(p.phone IS NULL OR p.phone='')`,
      address:      `(p.address1 IS NULL OR p.address1='')`,
    };
    const missingFieldsRaw = url.searchParams.get('missing_fields') || '';
    for (const f of missingFieldsRaw.split(',').map(s => s.trim()).filter(Boolean)) {
      if (missingClauses[f]) where += ' AND ' + missingClauses[f];
    }
    // Total count
    const countRow = await db.prepare(`SELECT COUNT(*) as n FROM people p WHERE ${where}`).bind(...binds).first();
    const total = countRow?.n || 0;
    // Paged results
    const rows = (await db.prepare(
      `SELECT p.*, h.name as household_name FROM people p
       LEFT JOIN households h ON p.household_id=h.id
       WHERE ${where} ORDER BY ${sortCol} ${sortDir}, p.last_name ASC, p.first_name ASC LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset).all()).results || [];
    // Batch-load tags for all returned people in a single query (avoids N+1)
    const ids = rows.map(r => r.id);
    const tagsByPerson = {};
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      const allTagRows = (await db.prepare(
        `SELECT pt.person_id, t.id, t.name, t.color FROM tags t
         JOIN person_tags pt ON pt.tag_id=t.id WHERE pt.person_id IN (${ph})`
      ).bind(...ids).all()).results || [];
      for (const tr of allTagRows) {
        if (!tagsByPerson[tr.person_id]) tagsByPerson[tr.person_id] = [];
        tagsByPerson[tr.person_id].push({ id: tr.id, name: tr.name, color: tr.color });
      }
    }
    // HQ4: disambiguate household names that are shared across multiple households
    const hhIdsUniq = [...new Set(rows.map(r => r.household_id).filter(Boolean))];
    const hhDisambigMap = {};
    if (hhIdsUniq.length) {
      const ph2 = hhIdsUniq.map(() => '?').join(',');
      const dRows = (await db.prepare(
        `SELECT h.id, h.name,
         COALESCE(
           (SELECT p2.first_name FROM people p2 WHERE p2.household_id=h.id AND p2.active=1 AND p2.family_role='head' LIMIT 1),
           (SELECT p2.first_name FROM people p2 WHERE p2.household_id=h.id AND p2.active=1 ORDER BY p2.id LIMIT 1)
         ) as head_first_name
         FROM households h WHERE h.id IN (${ph2})
         AND LOWER(h.name) IN (SELECT LOWER(name) FROM households GROUP BY LOWER(name) HAVING COUNT(*)>1)`
      ).bind(...hhIdsUniq).all()).results || [];
      for (const r of dRows) hhDisambigMap[r.id] = disambiguateHHName(r.name, r.head_first_name);
    }
    const people = rows.map(p => ({
      ...p,
      tags: tagsByPerson[p.id] || [],
      household_display_name: hhDisambigMap[p.household_id] || p.household_name || null
    }));
    return json({ people, total, offset, limit });
  }

  if (seg === 'people' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const r = await db.prepare(
      `INSERT INTO people (first_name,last_name,email,phone,address1,address2,city,state,zip,
       member_type,dob,baptism_date,confirmation_date,anniversary_date,death_date,deceased,
       household_id,family_role,photo_url,notes,breeze_id,gender,marital_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(b.first_name||'',b.last_name||'',b.email||'',b.phone||'',
           b.address1||'',b.address2||'',b.city||'',b.state||'MO',b.zip||'',
           b.member_type||'visitor',b.dob||'',b.baptism_date||'',
           b.confirmation_date||'',b.anniversary_date||'',b.death_date||'',b.deceased?1:0,
           b.household_id||null,b.family_role||'',b.photo_url||'',b.notes||'',b.breeze_id||'',
           b.gender||'',b.marital_status||''
    ).run();
    const personId = r.meta?.last_row_id;
    if (Array.isArray(b.tag_ids)) {
      for (const tid of b.tag_ids) {
        try { await db.prepare('INSERT OR IGNORE INTO person_tags(person_id,tag_id) VALUES(?,?)').bind(personId,tid).run(); } catch {}
      }
    }
    return json({ ok: true, id: personId });
  }

  if (seg === 'people/bulk-member-type' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Boolean) : [];
    const mt = b.member_type || '';
    if (!ids.length || !mt) return json({ error: 'ids and member_type required' }, 400);
    const placeholders = ids.map(() => '?').join(',');
    await db.prepare(`UPDATE people SET member_type=? WHERE id IN (${placeholders})`).bind(mt, ...ids).run();
    return json({ ok: true, updated: ids.length });
  }

  const pmatch = seg.match(/^people\/(\d+)$/);
  if (pmatch) {
    const pid = parseInt(pmatch[1]);
    if (method === 'GET') {
      const p = await db.prepare(
        `SELECT p.*, h.name as household_name FROM people p
         LEFT JOIN households h ON p.household_id=h.id WHERE p.id=?`
      ).bind(pid).first();
      if (!p) return json({ error: 'Not found' }, 404);
      // Member role can only view actual members
      if (role === 'member' && (p.member_type || '').toLowerCase() !== 'member') {
        return json({ error: 'Not found' }, 404);
      }
      const tags = (await db.prepare(
        `SELECT t.id,t.name,t.color FROM tags t JOIN person_tags pt ON pt.tag_id=t.id WHERE pt.person_id=?`
      ).bind(pid).all()).results || [];
      let giving12mo = 0;
      if (isFinance) {
        const giving12 = await db.prepare(
          `SELECT COALESCE(SUM(ge.amount),0) as total FROM giving_entries ge
           JOIN giving_batches gb ON ge.batch_id=gb.id
           WHERE ge.person_id=? AND gb.batch_date >= date('now','-12 months')`
        ).bind(pid).first();
        giving12mo = giving12?.total || 0;
      }
      // HQ4: disambiguate if this household name is shared with another household
      let household_display_name = p.household_name || null;
      if (p.household_id && p.household_name) {
        const dup2 = await db.prepare(`SELECT COUNT(*) as n FROM households WHERE LOWER(name)=LOWER(?) AND id!=?`).bind(p.household_name, p.household_id).first();
        if (dup2?.n > 0) {
          const hd = await db.prepare(`SELECT first_name FROM people WHERE household_id=? AND active=1 ORDER BY CASE family_role WHEN 'head' THEN 0 ELSE 1 END, id LIMIT 1`).bind(p.household_id).first();
          if (hd?.first_name) household_display_name = disambiguateHHName(p.household_name, hd.first_name);
        }
      }
      return json({ ...p, tags, giving_12mo: giving12mo, household_display_name });
    }
    if (method === 'PUT') {
      let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      // Capture old values for audit log
      const oldPerson = await db.prepare('SELECT * FROM people WHERE id=?').bind(pid).first();
      await db.prepare(
        `UPDATE people SET first_name=?,last_name=?,email=?,phone=?,address1=?,address2=?,
         city=?,state=?,zip=?,member_type=?,dob=?,baptism_date=?,confirmation_date=?,
         anniversary_date=?,death_date=?,deceased=?,household_id=?,family_role=?,photo_url=?,notes=?,
         public_directory=?,envelope_number=?,last_seen_date=?,gender=?,marital_status=?,
         dir_hide_address=?,dir_hide_phone=?,dir_hide_email=?,baptized=?,confirmed=? WHERE id=?`
      ).bind(b.first_name||'',b.last_name||'',b.email||'',b.phone||'',
             b.address1||'',b.address2||'',b.city||'',b.state||'MO',b.zip||'',
             b.member_type||'visitor',b.dob||'',b.baptism_date||'',
             b.confirmation_date||'',b.anniversary_date||'',b.death_date||'',b.deceased?1:0,
             b.household_id||null,b.family_role||'',b.photo_url||'',b.notes||'',
             b.public_directory!=null?(b.public_directory?1:0):1,
             b.envelope_number||'',b.last_seen_date||'',b.gender||'',b.marital_status||'',
             b.dir_hide_address?1:0, b.dir_hide_phone?1:0, b.dir_hide_email?1:0,
             b.baptized?1:0, b.confirmed?1:0, pid
      ).run();
      if (Array.isArray(b.tag_ids)) {
        await db.prepare('DELETE FROM person_tags WHERE person_id=?').bind(pid).run();
        for (const tid of b.tag_ids) {
          try { await db.prepare('INSERT OR IGNORE INTO person_tags(person_id,tag_id) VALUES(?,?)').bind(pid,tid).run(); } catch {}
        }
      }
      // Propagate anniversary_date to household spouse if they don't have one set
      if (b.anniversary_date && b.household_id && ['head','spouse'].includes(b.family_role||'')) {
        try {
          await db.prepare(
            `UPDATE people SET anniversary_date=?
             WHERE household_id=? AND id!=? AND (anniversary_date='' OR anniversary_date IS NULL)
               AND family_role IN ('head','spouse') AND active=1`
          ).bind(b.anniversary_date, b.household_id, pid).run();
        } catch {}
      }
      // Write audit log entries for changed fields
      if (oldPerson) {
        const personName = [(oldPerson.first_name||b.first_name||''), (oldPerson.last_name||b.last_name||'')].filter(Boolean).join(' ');
        const auditFields = ['first_name','last_name','email','phone','address1','address2','city','state','zip',
          'member_type','dob','baptism_date','confirmation_date','anniversary_date','death_date','deceased',
          'household_id','family_role','notes','public_directory','envelope_number','last_seen_date',
          'gender','marital_status'];
        const auditStmt = db.prepare(
          `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value) VALUES(?,?,?,?,?,?,?)`
        );
        const ops = [];
        for (const f of auditFields) {
          const ov = String(oldPerson[f] ?? '');
          const nv = String(b[f] ?? '');
          if (ov !== nv) ops.push(auditStmt.bind('update','person',pid,personName,f,ov,nv));
        }
        if (ops.length) await db.batch(ops);
      }
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      const hard = url.searchParams.get('hard') === 'true';
      if (hard && !isAdmin) return json({ error: 'Access denied: permanent delete requires admin access' }, 403);
      if (hard) {
        await db.prepare('DELETE FROM person_tags WHERE person_id=?').bind(pid).run();
        await db.prepare('DELETE FROM people WHERE id=?').bind(pid).run();
      } else {
        await db.prepare('UPDATE people SET active=0 WHERE id=?').bind(pid).run();
      }
      return json({ ok: true });
    }
  }

  // ── Person photo upload ──────────────────────────────────────────
  const photoMatch = seg.match(/^people\/(\d+)\/photo$/);
  if (photoMatch && method === 'POST') {
    if (!isStaff) return json({ error: 'Insufficient permissions' }, 403);
    if (!env.PHOTOS) return json({ error: 'Photo storage not configured — create R2 bucket tlc-chms-photos' }, 503);
    const pid = parseInt(photoMatch[1]);
    let file;
    try { const fd = await req.formData(); file = fd.get('photo'); } catch { return json({ error: 'Invalid form data' }, 400); }
    if (!file || !file.size) return json({ error: 'No file provided' }, 400);
    const ct = file.type || 'image/jpeg';
    if (!ct.startsWith('image/')) return json({ error: 'File must be an image' }, 400);
    const ext = ct === 'image/png' ? 'png' : ct === 'image/webp' ? 'webp' : 'jpg';
    const r2Key = `people/${pid}/photo.${ext}`;
    await env.PHOTOS.put(r2Key, await file.arrayBuffer(), { httpMetadata: { contentType: ct } });
    const photoUrl = `/admin/r2photo/${r2Key}`;
    await db.prepare('UPDATE people SET photo_url=? WHERE id=?').bind(photoUrl, pid).run();
    return json({ ok: true, photo_url: photoUrl });
  }

  // ── Household photo upload ───────────────────────────────────────
  const hhPhotoMatch = seg.match(/^households\/(\d+)\/photo$/);
  if (hhPhotoMatch && method === 'POST') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    if (!env.PHOTOS) return json({ error: 'Photo storage not configured' }, 503);
    const hid = parseInt(hhPhotoMatch[1]);
    let file;
    try { const fd = await req.formData(); file = fd.get('photo'); } catch { return json({ error: 'Invalid form data' }, 400); }
    if (!file || !file.size) return json({ error: 'No file provided' }, 400);
    const ct = file.type || 'image/jpeg';
    if (!ct.startsWith('image/')) return json({ error: 'File must be an image' }, 400);
    const ext = ct === 'image/png' ? 'png' : ct === 'image/webp' ? 'webp' : 'jpg';
    const r2Key = `households/${hid}/photo.${ext}`;
    await env.PHOTOS.put(r2Key, await file.arrayBuffer(), { httpMetadata: { contentType: ct } });
    const photoUrl = `/admin/r2photo/${r2Key}`;
    await db.prepare('UPDATE households SET photo_url=? WHERE id=?').bind(photoUrl, hid).run();
    return json({ ok: true, photo_url: photoUrl });
  }

  // ── Households ──────────────────────────────────────────────────
  if (seg === 'households' && method === 'GET') {
    const q = '%' + (url.searchParams.get('q') || '') + '%';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const sort = url.searchParams.get('sort') || 'name';
    const hhMemberType = (url.searchParams.get('member_type') || '').toLowerCase().trim();
    const orderBy = sort === 'members_desc' ? 'member_count DESC, h.name'
                  : sort === 'members_asc'  ? 'member_count ASC, h.name'
                  : 'h.name';
    // HV1: optional member-type filter — only show households with ≥1 person of the given type
    const mtSubquery = hhMemberType
      ? `AND h.id IN (SELECT household_id FROM people WHERE active=1 AND LOWER(member_type)='${hhMemberType}' AND household_id IS NOT NULL AND household_id != '')`
      : '';
    const countRow = await db.prepare(
      `SELECT COUNT(*) as n FROM households h WHERE (h.name LIKE ? OR h.address1 LIKE ? OR h.city LIKE ?) ${mtSubquery}`
    ).bind(q,q,q).first();
    const total = countRow?.n || 0;
    const rows = (await db.prepare(
      `SELECT h.*, COUNT(p.id) as member_count,
        (SELECT p2.id   FROM people p2 WHERE p2.household_id=h.id AND p2.active=1 AND p2.family_role='head' LIMIT 1) as head_person_id,
        COALESCE(
          (SELECT p2.first_name FROM people p2 WHERE p2.household_id=h.id AND p2.active=1 AND p2.family_role='head' LIMIT 1),
          (SELECT p2.first_name FROM people p2 WHERE p2.household_id=h.id AND p2.active=1 ORDER BY p2.id LIMIT 1)
        ) as head_first_name,
        (SELECT p3.id   FROM people p3 WHERE p3.household_id=h.id AND p3.active=1 ORDER BY p3.id LIMIT 1) as first_person_id
       FROM households h
       LEFT JOIN people p ON p.household_id=h.id AND p.active=1
       WHERE (h.name LIKE ? OR h.address1 LIKE ? OR h.city LIKE ?) ${mtSubquery}
       GROUP BY h.id ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    ).bind(q,q,q,limit,offset).all()).results || [];
    // HQ4: compute display_name for households whose name is shared by another household
    const dupNameSet = new Set(
      ((await db.prepare(`SELECT LOWER(name) as n FROM households GROUP BY LOWER(name) HAVING COUNT(*)>1`).all()).results || []).map(r => r.n)
    );
    for (const r of rows) {
      r.display_name = dupNameSet.has((r.name||'').toLowerCase()) && r.head_first_name
        ? disambiguateHHName(r.name, r.head_first_name)
        : r.name;
    }
    return json({ households: rows, total, offset, limit });
  }

  if (seg === 'households' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const r = await db.prepare(
      `INSERT INTO households (name,address1,address2,city,state,zip,notes,photo_url) VALUES (?,?,?,?,?,?,?,?)`
    ).bind(b.name||'',b.address1||'',b.address2||'',b.city||'',b.state||'MO',b.zip||'',b.notes||'',b.photo_url||'').run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }

  const hmatch = seg.match(/^households\/(\d+)$/);
  if (hmatch) {
    const hid = parseInt(hmatch[1]);
    if (method === 'GET') {
      const h = await db.prepare('SELECT * FROM households WHERE id=?').bind(hid).first();
      if (!h) return json({ error: 'Not found' }, 404);
      const members = (await db.prepare(
        `SELECT id,first_name,last_name,member_type,family_role,phone,email FROM people WHERE household_id=? AND active=1 ORDER BY family_role,last_name`
      ).bind(hid).all()).results || [];
      // HQ4: compute display_name if another household shares this name
      let display_name = h.name;
      if (h.name) {
        const dup = await db.prepare(`SELECT COUNT(*) as n FROM households WHERE LOWER(name)=LOWER(?) AND id!=?`).bind(h.name, hid).first();
        if (dup?.n > 0) {
          const head = members.find(m => m.family_role === 'head') || members[0];
          if (head?.first_name) display_name = disambiguateHHName(h.name, head.first_name);
        }
      }
      // H3: household giving summary — last 5 years, grouped by year
      const givingYears = (await db.prepare(
        `SELECT substr(COALESCE(NULLIF(ge.contribution_date,''),gb.batch_date),1,4) as yr,
                SUM(ge.amount) as total_cents
         FROM giving_entries ge
         JOIN giving_batches gb ON ge.batch_id=gb.id
         JOIN people p ON ge.person_id=p.id
         WHERE p.household_id=? AND p.active=1
         GROUP BY yr ORDER BY yr DESC LIMIT 5`
      ).bind(hid).all()).results || [];
      return json({ ...h, members, display_name, giving_years: givingYears });
    }
    if (method === 'PUT') {
      let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      await db.prepare(
        `UPDATE households SET name=?,address1=?,address2=?,city=?,state=?,zip=?,notes=?,photo_url=? WHERE id=?`
      ).bind(b.name||'',b.address1||'',b.address2||'',b.city||'',b.state||'MO',b.zip||'',b.notes||'',b.photo_url||'',hid).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      const count = await db.prepare('SELECT COUNT(*) as n FROM people WHERE household_id=? AND active=1').bind(hid).first();
      if (count?.n > 0) return json({ error: 'Household has active members; reassign them first.' }, 409);
      await db.prepare('DELETE FROM households WHERE id=?').bind(hid).run();
      return json({ ok: true });
    }
  }

  // ── HQ4: Household head quality scan ────────────────────────────
  if (seg === 'households/no-head-count' && method === 'GET') {
    const row = await db.prepare(
      `SELECT COUNT(DISTINCT h.id) as cnt FROM households h
       JOIN people p ON p.household_id=h.id AND p.active=1
       WHERE NOT EXISTS (
         SELECT 1 FROM people p2 WHERE p2.household_id=h.id AND p2.active=1 AND p2.family_role='head'
       )`
    ).first();
    return json({ count: row?.cnt ?? 0 });
  }
  if (seg === 'households/fix-heads' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied' }, 403);
    const headless = (await db.prepare(
      `SELECT DISTINCT h.id FROM households h
       JOIN people p ON p.household_id=h.id AND p.active=1
       WHERE NOT EXISTS (
         SELECT 1 FROM people p2 WHERE p2.household_id=h.id AND p2.active=1 AND p2.family_role='head'
       )`
    ).all()).results || [];
    let fixed = 0;
    for (const hh of headless) {
      const candidate = await db.prepare(
        `SELECT id FROM people WHERE household_id=? AND active=1
         ORDER BY CASE family_role WHEN 'spouse' THEN 0 ELSE 1 END, id LIMIT 1`
      ).bind(hh.id).first();
      if (candidate) {
        await db.prepare(`UPDATE people SET family_role='head' WHERE id=?`).bind(candidate.id).run();
        fixed++;
      }
    }
    return json({ ok: true, fixed, total_headless: headless.length });
  }

  // ── Household address sync ──────────────────────────────────────
  const hhsync = seg.match(/^households\/(\d+)\/sync-address$/);
  if (hhsync && method === 'POST') {
    const hid = parseInt(hhsync[1]);
    let b = {}; try { b = await req.json(); } catch {}
    // Push address to members who have no address — never overwrite existing individual addresses
    const r = await db.prepare(
      `UPDATE people SET address1=?,city=?,state=?,zip=?
       WHERE household_id=? AND active=1 AND (COALESCE(address1,'')='')`
    ).bind(b.address1||'',b.city||'',b.state||'MO',b.zip||'',hid).run();
    return json({ ok: true, updated: r.meta?.changes ?? 0 });
  }

  // ── Organizations ────────────────────────────────────────────────
  if (seg === 'organizations' && method === 'GET') {
    const q = url.searchParams.get('q') || '';
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const limit = parseInt(url.searchParams.get('limit') || '25');
    const showInactive = url.searchParams.get('inactive') === '1';
    const activeClause = showInactive ? '' : 'AND active=1';
    const like = `%${q}%`;
    const [countRow, listRows] = await Promise.all([
      db.prepare(`SELECT COUNT(*) as n FROM organizations WHERE (name LIKE ? OR contact_name LIKE ? OR city LIKE ?) ${activeClause}`).bind(like, like, like).first(),
      db.prepare(`SELECT * FROM organizations WHERE (name LIKE ? OR contact_name LIKE ? OR city LIKE ?) ${activeClause} ORDER BY name LIMIT ? OFFSET ?`).bind(like, like, like, limit, offset).all()
    ]);
    return json({ organizations: listRows.results || [], total: countRow?.n || 0, offset, limit });
  }
  if (seg === 'organizations' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!b.name?.trim()) return json({ error: 'Name is required' }, 400);
    const r = await db.prepare(
      `INSERT INTO organizations (name,type,contact_name,phone,email,website,address1,address2,city,state,zip,notes,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`
    ).bind(b.name.trim(), b.type||'', b.contact_name||'', b.phone||'', b.email||'', b.website||'', b.address1||'', b.address2||'', b.city||'', b.state||'MO', b.zip||'', b.notes||'').run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }
  const orgMatch = seg.match(/^organizations\/(\d+)$/);
  if (orgMatch) {
    const oid = parseInt(orgMatch[1]);
    if (method === 'GET') {
      const o = await db.prepare('SELECT * FROM organizations WHERE id=?').bind(oid).first();
      if (!o) return json({ error: 'Not found' }, 404);
      return json(o);
    }
    if (method === 'PUT') {
      let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      if (!b.name?.trim()) return json({ error: 'Name is required' }, 400);
      await db.prepare(
        `UPDATE organizations SET name=?,type=?,contact_name=?,phone=?,email=?,website=?,address1=?,address2=?,city=?,state=?,zip=?,notes=?,active=? WHERE id=?`
      ).bind(b.name.trim(), b.type||'', b.contact_name||'', b.phone||'', b.email||'', b.website||'', b.address1||'', b.address2||'', b.city||'', b.state||'MO', b.zip||'', b.notes||'', b.active===false?0:1, oid).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await db.prepare('DELETE FROM organizations WHERE id=?').bind(oid).run();
      return json({ ok: true });
    }
  }

  // ── Follow-up items ─────────────────────────────────────────────
  if (seg === 'followup' && method === 'GET') {
    const completed = url.searchParams.get('completed') === '1' ? 1 : 0;
    const personId = url.searchParams.get('person_id');
    let rows;
    if (personId) {
      rows = (await db.prepare(
        `SELECT f.*, p.first_name, p.last_name FROM follow_up_items f
         LEFT JOIN people p ON p.id=f.person_id
         WHERE f.person_id=? ORDER BY f.created_at DESC LIMIT 100`
      ).bind(parseInt(personId)).all()).results || [];
    } else {
      rows = (await db.prepare(
        `SELECT f.*, p.first_name, p.last_name FROM follow_up_items f
         LEFT JOIN people p ON p.id=f.person_id
         WHERE f.completed=? ORDER BY f.created_at DESC LIMIT 200`
      ).bind(completed).all()).results || [];
    }
    return json({ items: rows });
  }
  if (seg === 'followup' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const r = await db.prepare(
      `INSERT INTO follow_up_items(person_id,type,notes,due_date) VALUES(?,?,?,?)`
    ).bind(b.person_id||null, b.type||'general', b.notes||'', b.due_date||'').run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }
  const fmatch = seg.match(/^followup\/(\d+)$/);
  if (fmatch) {
    const fid = parseInt(fmatch[1]);
    if (method === 'PUT') {
      let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      if (b.completed) {
        await db.prepare(`UPDATE follow_up_items SET completed=1, completed_at=datetime('now') WHERE id=?`).bind(fid).run();
      } else {
        await db.prepare(
          `UPDATE follow_up_items SET type=?,notes=?,due_date=?,completed=0,completed_at='' WHERE id=?`
        ).bind(b.type||'general', b.notes||'', b.due_date||'', fid).run();
      }
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await db.prepare('DELETE FROM follow_up_items WHERE id=?').bind(fid).run();
      return json({ ok: true });
    }
  }
  // Audit log
  if (seg === 'audit' && method === 'GET') {
    const entityId = url.searchParams.get('entity_id');
    const entityType = url.searchParams.get('entity_type') || 'person';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    let rows;
    if (entityId) {
      rows = (await db.prepare(
        `SELECT * FROM audit_log WHERE entity_type=? AND entity_id=? ORDER BY ts DESC LIMIT ?`
      ).bind(entityType, parseInt(entityId), limit).all()).results || [];
    } else {
      rows = (await db.prepare(
        `SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?`
      ).bind(limit).all()).results || [];
    }
    return json({ entries: rows });
  }
  if (seg === 'audit/undo' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const entry = await db.prepare('SELECT * FROM audit_log WHERE id=?').bind(b.id).first();
    if (!entry) return json({ error: 'Audit entry not found' }, 404);
    if (entry.entity_type !== 'person') return json({ error: 'Only person edits can be undone' }, 400);
    // Revert: set the field back to old_value
    const allowedFields = ['first_name','last_name','email','phone','address1','address2','city','state','zip',
      'member_type','dob','baptism_date','confirmation_date','anniversary_date','death_date','deceased',
      'notes','public_directory','envelope_number','last_seen_date'];
    if (!allowedFields.includes(entry.field)) return json({ error: 'Cannot undo this field' }, 400);
    await db.prepare(`UPDATE people SET ${entry.field}=? WHERE id=?`)
      .bind(entry.old_value, entry.entity_id).run();
    // Log the undo itself
    await db.prepare(
      `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value) VALUES(?,?,?,?,?,?,?)`
    ).bind('undo','person',entry.entity_id,entry.person_name,entry.field,entry.new_value,entry.old_value).run();
    return json({ ok: true });
  }

  // ── Tags ────────────────────────────────────────────────────────
  if (seg === 'tags' && method === 'GET') {
    const rows = (await db.prepare(
      `SELECT t.*, COUNT(pt.person_id) as person_count FROM tags t
       LEFT JOIN person_tags pt ON pt.tag_id=t.id
       GROUP BY t.id ORDER BY t.name`
    ).all()).results || [];
    return json({ tags: rows });
  }
  if (seg === 'tags' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const r = await db.prepare(
      `INSERT INTO tags (name,color,description) VALUES (?,?,?)`
    ).bind(b.name||'New Tag',b.color||'#5C8FA8',b.description||'').run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }
  const tmatch = seg.match(/^tags\/(\d+)$/);
  if (tmatch) {
    const tid = parseInt(tmatch[1]);
    if (method === 'PUT') {
      let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      await db.prepare(`UPDATE tags SET name=?,color=?,description=? WHERE id=?`)
        .bind(b.name||'',b.color||'#5C8FA8',b.description||'',tid).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await db.prepare('DELETE FROM person_tags WHERE tag_id=?').bind(tid).run();
      await db.prepare('DELETE FROM tags WHERE id=?').bind(tid).run();
      return json({ ok: true });
    }
  }

  // ── Funds ────────────────────────────────────────────────────────
  if (seg === 'funds' && method === 'GET') {
    const rows = (await db.prepare('SELECT * FROM funds ORDER BY sort_order,name').all()).results || [];
    return json({ funds: rows });
  }
  if (seg === 'funds' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const r = await db.prepare(
      `INSERT INTO funds (name,description,active,sort_order) VALUES (?,?,?,?)`
    ).bind(b.name||'New Fund',b.description||'',b.active?1:1,b.sort_order||0).run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }
  const fundmatch = seg.match(/^funds\/(\d+)$/);
  if (fundmatch) {
    if (method === 'PUT') {
      let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      await db.prepare(`UPDATE funds SET name=?,description=?,active=?,sort_order=? WHERE id=?`)
        .bind(b.name||'',b.description||'',b.active?1:0,b.sort_order||0,parseInt(fundmatch[1])).run();
      return json({ ok: true });
    }
  }

  // ── Giving Entries — list for a person ──────────────────────────
  if (seg === 'giving' && method === 'GET') {
    const personId = url.searchParams.get('person_id');
    const year     = url.searchParams.get('year') || '';
    const limit    = Math.min(parseInt(url.searchParams.get('limit') || '500'), 2000);
    if (!personId) return json({ error: 'person_id required' }, 400);
    let sql = `SELECT ge.id, ge.amount, ge.method, ge.check_number, ge.notes,
                ge.fund_id, ge.batch_id, gb.closed as batch_closed, gb.description as batch_description,
                COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) as contribution_date,
                f.name as fund_name
               FROM giving_entries ge
               JOIN funds f ON ge.fund_id=f.id
               JOIN giving_batches gb ON ge.batch_id=gb.id
               WHERE ge.person_id=?`;
    const binds = [parseInt(personId)];
    if (year) {
      sql += ` AND substr(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date),1,4)=?`;
      binds.push(year);
    }
    sql += ` ORDER BY COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) DESC, ge.id DESC LIMIT ?`;
    binds.push(limit);
    const entries = (await db.prepare(sql).bind(...binds).all()).results || [];
    return json({ entries });
  }

  // ── Giving Batches ───────────────────────────────────────────────
  if (seg === 'giving/batches' && method === 'GET') {
    const status = url.searchParams.get('status') || 'all';
    let sql = `SELECT gb.*, COUNT(ge.id) as entry_count, COALESCE(SUM(ge.amount),0) as total_cents
               FROM giving_batches gb LEFT JOIN giving_entries ge ON ge.batch_id=gb.id`;
    const binds = [];
    if (status === 'open') { sql += ' WHERE gb.closed=0'; }
    else if (status === 'closed') { sql += ' WHERE gb.closed=1'; }
    sql += ' GROUP BY gb.id ORDER BY gb.batch_date DESC, gb.id DESC LIMIT 100';
    const rows = (await db.prepare(sql).bind(...binds).all()).results || [];
    return json({ batches: rows });
  }

  if (seg === 'giving/batches' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const r = await db.prepare(
      `INSERT INTO giving_batches (batch_date,description) VALUES (?,?)`
    ).bind(b.batch_date||'',b.description||'').run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }

  const batchMatch = seg.match(/^giving\/batches\/(\d+)$/);
  if (batchMatch) {
    const bid = parseInt(batchMatch[1]);
    if (method === 'GET') {
      const batch = await db.prepare('SELECT * FROM giving_batches WHERE id=?').bind(bid).first();
      if (!batch) return json({ error: 'Not found' }, 404);
      const entries = (await db.prepare(
        `SELECT ge.*, f.name as fund_name,
         COALESCE(p.first_name||' '||p.last_name,'(anonymous)') as person_name
         FROM giving_entries ge
         JOIN funds f ON ge.fund_id=f.id
         LEFT JOIN people p ON ge.person_id=p.id
         WHERE ge.batch_id=? ORDER BY ge.id`
      ).bind(bid).all()).results || [];
      return json({ ...batch, entries });
    }
    if (method === 'PUT') {
      let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      await db.prepare(`UPDATE giving_batches SET batch_date=?,description=?,closed=? WHERE id=?`)
        .bind(b.batch_date||'',b.description||'',b.closed?1:0,bid).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      const batch = await db.prepare('SELECT closed FROM giving_batches WHERE id=?').bind(bid).first();
      if (!batch) return json({ error: 'Not found' }, 404);
      if (batch.closed) return json({ error: 'Cannot delete a closed batch.' }, 409);
      await db.prepare('DELETE FROM giving_entries WHERE batch_id=?').bind(bid).run();
      await db.prepare('DELETE FROM giving_batches WHERE id=?').bind(bid).run();
      return json({ ok: true });
    }
  }

  const entriesMatch = seg.match(/^giving\/batches\/(\d+)\/entries$/);
  if (entriesMatch) {
    const bid = parseInt(entriesMatch[1]);
    if (method === 'GET') {
      const entries = (await db.prepare(
        `SELECT ge.*, f.name as fund_name,
         COALESCE(p.first_name||' '||p.last_name,'(anonymous)') as person_name
         FROM giving_entries ge
         JOIN funds f ON ge.fund_id=f.id
         LEFT JOIN people p ON ge.person_id=p.id
         WHERE ge.batch_id=? ORDER BY ge.id`
      ).bind(bid).all()).results || [];
      return json({ entries });
    }
    if (method === 'POST') {
      const batch = await db.prepare('SELECT closed FROM giving_batches WHERE id=?').bind(bid).first();
      if (!batch) return json({ error: 'Batch not found' }, 404);
      if (batch.closed) return json({ error: 'Batch is closed.' }, 409);
      let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const amtCents = Math.round(parseFloat(b.amount || 0) * 100);
      const r = await db.prepare(
        `INSERT INTO giving_entries (batch_id,person_id,fund_id,amount,method,check_number,notes)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(bid,b.person_id||null,b.fund_id,amtCents,b.method||'cash',b.check_number||'',b.notes||'').run();
      return json({ ok: true, id: r.meta?.last_row_id });
    }
  }

  const entryDelMatch = seg.match(/^giving\/entries\/(\d+)$/);
  if (entryDelMatch && method === 'PUT') {
    const eid = parseInt(entryDelMatch[1]);
    const entry = await db.prepare(
      `SELECT ge.id, gb.closed FROM giving_entries ge JOIN giving_batches gb ON ge.batch_id=gb.id WHERE ge.id=?`
    ).bind(eid).first();
    if (!entry) return json({ error: 'Not found' }, 404);
    if (entry.closed) return json({ error: 'Batch is closed.' }, 409);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const amtCents = Math.round(parseFloat(b.amount || 0) * 100);
    if (amtCents <= 0) return json({ error: 'Amount must be positive' }, 400);
    await db.prepare(
      `UPDATE giving_entries SET fund_id=?,amount=?,method=?,check_number=?,notes=?,contribution_date=? WHERE id=?`
    ).bind(parseInt(b.fund_id), amtCents, b.method||'cash', b.check_number||'', b.notes||'', b.date||'', eid).run();
    return json({ ok: true });
  }
  if (entryDelMatch && method === 'DELETE') {
    const eid = parseInt(entryDelMatch[1]);
    const entry = await db.prepare(
      `SELECT ge.id, gb.closed FROM giving_entries ge JOIN giving_batches gb ON ge.batch_id=gb.id WHERE ge.id=?`
    ).bind(eid).first();
    if (!entry) return json({ error: 'Not found' }, 404);
    if (entry.closed) return json({ error: 'Batch is closed.' }, 409);
    await db.prepare('DELETE FROM giving_entries WHERE id=?').bind(eid).run();
    return json({ ok: true });
  }

  // ── Quick Gift Entry (auto-creates open batch for the month) ─────
  if (seg === 'giving/quick-entry' && method === 'POST') {
    let b = {}; try { b = await req.json(); } catch {}
    const { person_id, fund_id, amount, method: payMethod, date, notes, check_number } = b;
    if (!fund_id || !amount || !date) return json({ error: 'fund_id, amount, and date required' }, 400);
    const amtCents = Math.round(parseFloat(amount) * 100);
    if (amtCents <= 0) return json({ error: 'Amount must be positive' }, 400);
    // Find or create an open manual-entry batch for this month
    const monthKey  = String(date).slice(0, 7);
    const batchDesc = 'Manual Entry ' + monthKey;
    let existBatch = await db.prepare(
      `SELECT id FROM giving_batches WHERE description=? AND closed=0 LIMIT 1`
    ).bind(batchDesc).first();
    let batchId;
    if (existBatch) {
      batchId = existBatch.id;
    } else {
      const br = await db.prepare(
        `INSERT INTO giving_batches (batch_date, description, closed) VALUES (?,?,0)`
      ).bind(date, batchDesc).run();
      batchId = br.meta?.last_row_id;
    }
    const er = await db.prepare(
      `INSERT INTO giving_entries (batch_id,person_id,fund_id,amount,method,check_number,notes,contribution_date)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(batchId, person_id ? parseInt(person_id) : null, parseInt(fund_id),
           amtCents, payMethod || 'cash', check_number || '', notes || '', date).run();
    return json({ ok: true, id: er.meta?.last_row_id, batch_id: batchId });
  }

  // ── Reports ──────────────────────────────────────────────────────
  if (seg === 'reports/membership' && method === 'GET') {
    const dbCounts = (await db.prepare(
      `SELECT member_type, COUNT(*) as n FROM people WHERE active=1 GROUP BY member_type ORDER BY n DESC`
    ).all()).results || [];
    // Merge with configured types so all types appear (even those with 0 members)
    const cfgRow = await db.prepare("SELECT value FROM chms_config WHERE key='member_types'").first();
    const DEFAULT_MEMBER_TYPES = ['Member','Attender','Visitor','Vietnamese Congregation','Other'];
    const configuredTypes = cfgRow ? JSON.parse(cfgRow.value) : DEFAULT_MEMBER_TYPES;
    const countMap = {};
    for (const r of dbCounts) countMap[(r.member_type||'').toLowerCase()] = { raw: r.member_type, n: r.n };
    const counts = configuredTypes.map(t => {
      const key = t.toLowerCase().replace(/\s+/g,'-');
      const found = countMap[key] || countMap[t.toLowerCase()] || {};
      return { member_type: t, n: found.n || 0 };
    });
    // Also include any DB types not in config
    for (const r of dbCounts) {
      const alreadyIn = configuredTypes.some(t => t.toLowerCase().replace(/\s+/g,'-') === (r.member_type||'').toLowerCase() || t.toLowerCase() === (r.member_type||'').toLowerCase());
      if (!alreadyIn) counts.push({ member_type: r.member_type, n: r.n });
    }
    const total = counts.reduce((s,r) => s + r.n, 0);
    const tagCounts = (await db.prepare(
      `SELECT t.name, COUNT(DISTINCT pt.person_id) as n FROM tags t
       LEFT JOIN person_tags pt ON pt.tag_id=t.id GROUP BY t.id ORDER BY t.name`
    ).all()).results || [];
    return json({ counts, total, tag_counts: tagCounts });
  }

  if (seg === 'reports/giving-summary' && method === 'GET') {
    const from = url.searchParams.get('from') || new Date().getFullYear() + '-01-01';
    const to   = url.searchParams.get('to')   || new Date().getFullYear() + '-12-31';
    const rows = (await db.prepare(
      `SELECT f.name as fund_name, COUNT(ge.id) as contributions, COALESCE(SUM(ge.amount),0) as total_cents
       FROM funds f LEFT JOIN giving_entries ge ON ge.fund_id=f.id
       LEFT JOIN giving_batches gb ON ge.batch_id=gb.id
       WHERE f.active=1
         AND COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) BETWEEN ? AND ?
       GROUP BY f.id ORDER BY f.sort_order, f.name`
    ).bind(from,to).all()).results || [];
    const grand = rows.reduce((s,r) => s + r.total_cents, 0);
    return json({ from, to, rows, grand_total_cents: grand });
  }

  if (seg === 'reports/giving-by-method' && method === 'GET') {
    const from = url.searchParams.get('from') || new Date().getFullYear() + '-01-01';
    const to   = url.searchParams.get('to')   || new Date().getFullYear() + '-12-31';
    const rows = (await db.prepare(
      `SELECT ge.method, COUNT(ge.id) as contributions, COALESCE(SUM(ge.amount),0) as total_cents
       FROM giving_entries ge
       WHERE COALESCE(NULLIF(ge.contribution_date,''), (SELECT batch_date FROM giving_batches WHERE id=ge.batch_id)) BETWEEN ? AND ?
       GROUP BY ge.method ORDER BY total_cents DESC`
    ).bind(from,to).all()).results || [];
    const grand = rows.reduce((s,r) => s + r.total_cents, 0);
    return json({ from, to, rows, grand_total_cents: grand });
  }

  if (seg === 'reports/giving-statement' && method === 'GET' && url.searchParams.get('list_givers') === '1') {
    const year = url.searchParams.get('year') || new Date().getFullYear();
    const givers = (await db.prepare(
      `SELECT p.id, p.first_name, p.last_name, p.email,
              SUM(ge.amount) as total_cents
       FROM people p
       JOIN giving_entries ge ON ge.person_id=p.id
       JOIN giving_batches gb ON ge.batch_id=gb.id
       WHERE p.active=1 AND p.email != ''
         AND substr(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date),1,4)=?
       GROUP BY p.id ORDER BY p.last_name, p.first_name`
    ).bind(String(year)).all()).results || [];
    return json({ givers });
  }

  if (seg === 'reports/giving-statement' && method === 'GET') {
    const personId = url.searchParams.get('person_id');
    const year = url.searchParams.get('year') || new Date().getFullYear();
    if (!personId) return json({ error: 'person_id required' }, 400);
    const person = await db.prepare('SELECT * FROM people WHERE id=?').bind(personId).first();
    if (!person) return json({ error: 'Person not found' }, 404);
    const entries = (await db.prepare(
      `SELECT ge.amount, ge.method, ge.notes, f.name as fund_name,
              COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) as gift_date
       FROM giving_entries ge
       JOIN funds f ON ge.fund_id=f.id
       JOIN giving_batches gb ON ge.batch_id=gb.id
       WHERE ge.person_id=?
         AND substr(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date),1,4)=?
       ORDER BY gift_date, ge.id`
    ).bind(personId, String(year)).all()).results || [];
    const total = entries.reduce((s,e) => s + e.amount, 0);
    if (url.searchParams.get('format') === 'csv') {
      let csv = 'Date,Fund,Amount,Method\n';
      for (const e of entries) {
        csv += `${e.gift_date},${e.fund_name},$${(e.amount/100).toFixed(2)},${e.method}\n`;
      }
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="giving-statement-${person.last_name}-${year}.csv"`
        }
      });
    }
    return json({ person, year, entries, total_cents: total });
  }

  if (seg === 'reports/giving-statement-household' && method === 'GET') {
    const householdId = url.searchParams.get('household_id');
    const year = url.searchParams.get('year') || new Date().getFullYear();
    if (!householdId) return json({ error: 'household_id required' }, 400);
    const household = await db.prepare('SELECT * FROM households WHERE id=?').bind(householdId).first();
    if (!household) return json({ error: 'Household not found' }, 404);
    const members = (await db.prepare(
      `SELECT id, first_name, last_name, email FROM people WHERE household_id=? AND active=1 ORDER BY family_role, last_name`
    ).bind(householdId).all()).results || [];
    const entries = (await db.prepare(
      `SELECT ge.amount, ge.method, f.name as fund_name,
              COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) as gift_date,
              p.first_name, p.last_name
       FROM giving_entries ge
       JOIN funds f ON ge.fund_id=f.id
       JOIN giving_batches gb ON ge.batch_id=gb.id
       JOIN people p ON ge.person_id=p.id
       WHERE p.household_id=?
         AND substr(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date),1,4)=?
       ORDER BY gift_date, p.last_name, ge.id`
    ).bind(householdId, String(year)).all()).results || [];
    const total = entries.reduce((s,e) => s + e.amount, 0);
    return json({ household, members, year, entries, total_cents: total });
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
    return json({ from, to, by_time: rows, sundays });
  }

  // ── Attendance TSV Import ─────────────────────────────────────────
  if (seg === 'import/attendance-tsv' && method === 'POST') {
    let body = ''; try { body = await req.text(); } catch {}
    if (!body.trim()) return json({ error: 'Empty body' }, 400);
    const lines = body.split(/\r?\n/);
    const dataLines = lines.filter((l, i) => i > 0 && l.trim());
    const today = new Date().toISOString().slice(0, 10);

    // Pre-load all existing date+time keys to avoid per-row SELECT queries
    const existing = new Set(
      ((await db.prepare('SELECT service_date, service_time FROM worship_services').all()).results || [])
        .map(r => r.service_date + '|' + r.service_time)
    );

    const classifyService = (name, timeStr) => {
      const n = (name || '').toLowerCase();
      const h = parseInt((timeStr || '').split(':')[0] || '0');
      if (n.includes('vietnamese')) return null;
      if (n.includes('early service') || n.includes('8:00') || n.includes('8am') || n.includes('8 am') || (h === 8))
        return { type: 'sunday', time: '08:00' };
      if (n.includes('late service') || n.includes('10:45') || n.includes('10am') || n.includes('10 am') || (h === 10 && timeStr && timeStr.includes('45')))
        return { type: 'sunday', time: '10:45' };
      if (n.includes('advent') || n.includes('lent') || n.includes('ash wednesday') ||
          n.includes('wednesday') || n.includes('midweek') || n.includes('vesper'))
        return { type: 'midweek', time: timeStr || '' };
      if (n.includes('funeral') || n.includes('easter vigil') || n.includes('good friday') ||
          n.includes('christmas eve') || n.includes('thanksgiving') || n.includes('installation') ||
          n.includes('ordination') || n.includes('wedding') || n.includes('special'))
        return { type: 'special', time: timeStr || '' };
      return { type: 'special', time: timeStr || '' };
    };

    let imported = 0, skipped = 0, skippedFuture = 0;
    const inserts = [];
    const attDelim = lines[0] && lines[0].includes('\t') ? '\t' : ',';

    // Parse a date string from Breeze export into { date: 'YYYY-MM-DD', time: 'HH:MM' }
    // Handles: '2023-04-02 08:00:00', '2023-04-02T08:00', '4/2/2023 8:00 AM', '04/02/2023'
    const parseBreezeDatetime = (raw) => {
      if (!raw) return null;
      raw = raw.trim().replace(/^"/, '').replace(/"$/, '');
      // ISO-style: 2023-04-02 or 2023-04-02T08:00
      if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        return { date: raw.slice(0, 10), time: raw.slice(11, 16) || '' };
      }
      // US-style: 4/2/2023 8:00 AM or 04/02/2023
      const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i);
      if (m) {
        const yyyy = m[3], mm = m[1].padStart(2,'0'), dd = m[2].padStart(2,'0');
        let hh = parseInt(m[4] || '0'), min = (m[5] || '00');
        const ampm = (m[6] || '').toUpperCase();
        if (ampm === 'PM' && hh < 12) hh += 12;
        if (ampm === 'AM' && hh === 12) hh = 0;
        return { date: yyyy+'-'+mm+'-'+dd, time: hh.toString().padStart(2,'0')+':'+min };
      }
      return null;
    };

    for (const line of dataLines) {
      const cols = line.split(attDelim);
      if (cols.length < 4) continue;
      const instanceId = (cols[1] || '').trim().replace(/^"|"$/g,'');
      const name       = (cols[2] || '').trim().replace(/^"|"$/g,'');
      const startRaw   = (cols[3] || '').trim().replace(/^"|"$/g,'');
      if (!startRaw) continue;
      const parsed = parseBreezeDatetime(startRaw);
      if (!parsed) continue;
      const datePart = parsed.date;
      const timePart = parsed.time;
      if (datePart > today) { skippedFuture++; continue; }
      const cls = classifyService(name, timePart);
      if (!cls) { skipped++; continue; }
      const key = datePart + '|' + cls.time;
      if (existing.has(key)) { skipped++; continue; }
      existing.add(key); // prevent duplicates within the same file
      inserts.push(db.prepare(
        `INSERT INTO worship_services (service_date,service_time,service_name,service_type,attendance,communion,notes,breeze_instance_id)
         VALUES (?,?,?,?,0,0,?,?)`
      ).bind(datePart, cls.time, name, cls.type, '', instanceId));
      imported++;
    }

    // Batch inserts in groups of 100 to stay within query limits
    for (let i = 0; i < inserts.length; i += 100) {
      await db.batch(inserts.slice(i, i + 100));
    }
    const sampleLine = dataLines[0] || '';
    const sampleCols = sampleLine.split(attDelim);
    return json({ ok: true, imported, skipped, skippedFuture, total: dataLines.length,
      sample: { raw: sampleLine.slice(0,120), col3: (sampleCols[3]||'').slice(0,40), parsed: parseBreezeDatetime((sampleCols[3]||'')) } });
  }

  // ── Simple Attendance CSV Import ─────────────────────────────────
  // Accepts 3-column TSV/CSV: date(YYYY-MM-DD), service_name, attendance
  if (seg === 'import/attendance-simple' && method === 'POST') {
    let body = ''; try { body = await req.text(); } catch {}
    if (!body.trim()) return json({ error: 'Empty body' }, 400);
    const lines = body.split(/\r?\n/).filter(l => l.trim());
    const delim = lines[0].includes('\t') ? '\t' : ',';
    const dataLines = lines[0].toLowerCase().includes('date') ? lines.slice(1) : lines;

    const classify = name => {
      const n = (name || '').toLowerCase();
      const late = n.includes('(late)') || n.includes('7pm') || n.includes('19:');
      if (n.includes('sunday') && (n.includes('8am') || n.includes('8:00'))) return { type: 'sunday', time: '08:00' };
      if (n.includes('sunday') && (n.includes('10:45') || n.includes('10am'))) return { type: 'sunday', time: '10:45' };
      if (n.includes('sunday') && (n.includes('combined') || n.includes('canva'))) return { type: 'sunday', time: '09:00', combo: true };
      if (n.includes('5pm') || n.includes('17:00')) return { type: n.includes('sunday') ? 'sunday' : 'midweek', time: '17:00' };
      if (n.includes('7pm') || n.includes('19:00')) return { type: n.includes('sunday') ? 'sunday' : 'midweek', time: '19:00' };
      const specialNames = ['maundy thursday','good friday','easter vigil','christmas day','installation','ordination','wedding','funeral'];
      if (specialNames.some(s => n.includes(s))) return { type: 'special', time: late ? '19:00' : '10:00' };
      if (n.includes('christmas eve')) return { type: 'special', time: late ? '22:00' : '17:00' };
      if (n.includes('thanksgiving')) return { type: 'special', time: late ? '19:00' : '17:00' };
      const midweekNames = ['ash wednesday','midweek','advent','lent','vesper','wednesday'];
      if (midweekNames.some(s => n.includes(s))) return { type: 'midweek', time: late ? '19:00' : '17:00' };
      return { type: 'special', time: late ? '19:00' : '10:00' };
    };

    // Pre-load existing records keyed by date|time → id
    const existingMap = {};
    for (const r of (await db.prepare('SELECT id, service_date, service_time FROM worship_services').all()).results || [])
      existingMap[r.service_date + '|' + r.service_time] = r.id;

    // Pass 1: parse and classify all rows, group by date
    let skipped = 0;
    const byDateRows = {};
    for (const line of dataLines) {
      const cols = line.split(delim).map(c => c.trim().replace(/^"|"$/g, ''));
      if (cols.length < 3) continue;
      const date = cols[0], name = cols[1], att = parseInt(cols[2]) || 0;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; continue; }
      const cls = classify(name);
      if (!byDateRows[date]) byDateRows[date] = [];
      byDateRows[date].push({ cls, name, att, date });
    }

    // Pass 2: for each date, drop combined-avg rows when split services exist
    const filteredRows = [];
    for (const [, rows] of Object.entries(byDateRows)) {
      const hasSplit = rows.some(r => r.cls.time === '08:00' || r.cls.time === '10:45');
      for (const r of rows) {
        if (r.cls.combo && hasSplit) { skipped++; continue; }
        filteredRows.push(r);
      }
    }

    let imported = 0, updated = 0, combinedUsed = 0;
    const ops = [];
    const seen = new Set();
    for (const { cls, name, att, date } of filteredRows) {
      const key = date + '|' + cls.time;
      if (seen.has(key)) { skipped++; continue; }
      seen.add(key);
      if (cls.combo) combinedUsed++;
      const existingId = existingMap[key];
      if (existingId) {
        ops.push(db.prepare('UPDATE worship_services SET attendance=?,service_name=?,service_type=? WHERE id=?')
          .bind(att, name, cls.type, existingId));
        updated++;
      } else {
        ops.push(db.prepare(
          'INSERT INTO worship_services (service_date,service_time,service_name,service_type,attendance,communion,notes) VALUES (?,?,?,?,?,0,"")'
        ).bind(date, cls.time, name, cls.type, att));
        imported++;
      }
    }
    for (let i = 0; i < ops.length; i += 100) await db.batch(ops.slice(i, i + 100));
    return json({ ok: true, imported, updated, skipped, combinedUsed, total: dataLines.length });
  }

  // ── Breeze Attendance Count Sync ─────────────────────────────────
  // Fetches actual headcounts from Breeze for imported service instances
  if (seg === 'import/breeze-attendance-sync' && method === 'POST') {
    const subdomain = env.BREEZE_SUBDOMAIN;
    const apiKey    = env.BREEZE_API_KEY;
    if (!subdomain || !apiKey) return json({ error: 'Breeze not configured' }, 503);
    const hdrs = { 'Api-key': apiKey };
    // Find services that have a breeze_instance_id (all, not just zeros, so re-sync is safe)
    let b = {}; try { b = await req.json(); } catch {}
    const onlyEmpty = b.only_empty !== false; // default: only sync where attendance=0
    let whereClause = "breeze_instance_id != ''";
    if (onlyEmpty) whereClause += ' AND attendance = 0';
    const services = (await db.prepare(
      `SELECT id, breeze_instance_id, service_date, service_time FROM worship_services WHERE ${whereClause} ORDER BY service_date DESC`
    ).all()).results || [];
    if (services.length === 0) return json({ ok: true, synced: 0, failed: 0, message: 'No services with Breeze instance IDs found. Re-import the TSV first.' });
    let synced = 0, failed = 0;
    const errors = [];
    for (const svc of services) {
      try {
        const res = await fetch(
          `https://${subdomain}.breezechms.com/api/events/attendance/list?instance_id=${svc.breeze_instance_id}&type=anonymous`,
          { headers: hdrs }
        );
        if (!res.ok) {
          const errText = await res.text().catch(() => res.status);
          errors.push({ instance_id: svc.breeze_instance_id, date: svc.service_date, time: svc.service_time, error: `HTTP ${res.status}: ${errText}`.slice(0,120) });
          failed++; continue;
        }
        const data = await res.json();
        // Anonymous response is an array of check-in records; count = length
        // or may return [{count: N}] - handle both
        let count = 0;
        if (Array.isArray(data)) {
          if (data.length > 0 && typeof data[0] === 'object' && 'count' in data[0]) {
            count = parseInt(data[0].count) || 0;
          } else {
            count = data.length;
          }
        }
        if (count > 0) {
          await db.prepare('UPDATE worship_services SET attendance=? WHERE id=?').bind(count, svc.id).run();
          synced++;
        }
      } catch(e) {
        errors.push({ instance_id: svc.breeze_instance_id, date: svc.service_date, time: svc.service_time, error: String(e).slice(0,120) });
        failed++;
      }
    }
    return json({ ok: true, synced, failed, errors: errors.slice(0, 20), total: services.length });
  }

  // ── Breeze Giving Debug ──────────────────────────────────────────
  if (seg === 'import/breeze-giving-debug' && method === 'GET') {
    const subdomain = env.BREEZE_SUBDOMAIN;
    const apiKey    = env.BREEZE_API_KEY;
    if (!subdomain || !apiKey) return json({ error: 'Breeze not configured' }, 503);
    const hdrs = { 'Api-key': apiKey };
    const results = {};

    // Test account/list_log with contribution_added — raw object_json
    const logR = await fetch(
      `https://${subdomain}.breezechms.com/api/account/list_log?action=contribution_added&limit=5`,
      { headers: hdrs }
    );
    const logText = await logR.text();
    let logParsed = null; try { logParsed = JSON.parse(logText); } catch {}
    results.log_no_details = { status: logR.status, count: Array.isArray(logParsed) ? logParsed.length : null, sample: Array.isArray(logParsed) ? logParsed.slice(0, 3) : logText.slice(0, 500) };

    // Same but with details=1 — may include amount/fund/person
    const logDR = await fetch(
      `https://${subdomain}.breezechms.com/api/account/list_log?action=contribution_added&details=1&limit=5`,
      { headers: hdrs }
    );
    const logDText = await logDR.text();
    let logDParsed = null; try { logDParsed = JSON.parse(logDText); } catch {}
    results.log_with_details = { status: logDR.status, count: Array.isArray(logDParsed) ? logDParsed.length : null, sample: Array.isArray(logDParsed) ? logDParsed.slice(0, 3) : logDText.slice(0, 500) };

    // Try undocumented Breeze fund endpoints
    for (const path of ['giving/funds', 'funds', 'giving/list_funds', 'giving/fund']) {
      try {
        const r = await fetch(`https://${subdomain}.breezechms.com/api/${path}`, { headers: hdrs });
        const t = await r.text();
        let p = null; try { p = JSON.parse(t); } catch {}
        results['fund_endpoint_' + path.replace('/','_')] = { status: r.status, body: t.slice(0, 300), parsed_count: Array.isArray(p) ? p.length : (p ? 'object' : null) };
      } catch(e) { results['fund_endpoint_' + path.replace('/','_')] = { error: e.message }; }
    }

    // Check oldest contribution_added log entry (how far back does log go?)
    const oldestR = await fetch(
      `https://${subdomain}.breezechms.com/api/account/list_log?action=contribution_added&limit=1&start=2010-01-01&end=2021-01-01`,
      { headers: hdrs }
    );
    const oldestText = await oldestR.text();
    let oldestParsed = null; try { oldestParsed = JSON.parse(oldestText); } catch {}
    results.oldest_contribution_log = { status: oldestR.status, count: Array.isArray(oldestParsed) ? oldestParsed.length : null, sample: Array.isArray(oldestParsed) ? oldestParsed.slice(0,2) : oldestText.slice(0,300) };

    // Check bulk_import_contributions — historical data may have been bulk-imported
    const bulkR = await fetch(
      `https://${subdomain}.breezechms.com/api/account/list_log?action=bulk_import_contributions&details=1&limit=5`,
      { headers: hdrs }
    );
    const bulkText = await bulkR.text();
    let bulkParsed = null; try { bulkParsed = JSON.parse(bulkText); } catch {}
    results.bulk_imports = { status: bulkR.status, count: Array.isArray(bulkParsed) ? bulkParsed.length : null, sample: Array.isArray(bulkParsed) ? bulkParsed.slice(0,3) : bulkText.slice(0,300) };

    // Try official /api/giving/list endpoint
    const glR = await fetch(
      `https://${subdomain}.breezechms.com/api/giving/list?start=2024-01-01&end=2024-12-31&limit=5`,
      { headers: hdrs }
    );
    const glText = await glR.text();
    let glParsed = null; try { glParsed = JSON.parse(glText); } catch {}
    results.giving_list = { status: glR.status, count: Array.isArray(glParsed) ? glParsed.length : null, sample: Array.isArray(glParsed) ? glParsed.slice(0,3) : glText.slice(0,500) };

    return json(results);
  }

  // ── ChMS Config ──────────────────────────────────────────────────
  const DEFAULT_MEMBER_TYPES = ['Member','Associate','Friend','Visitor','Inactive','Organization'];
  if (seg === 'config/member-types' && method === 'GET') {
    const row = await db.prepare("SELECT value FROM chms_config WHERE key='member_types'").first();
    const types = row ? JSON.parse(row.value) : DEFAULT_MEMBER_TYPES;
    return json({ types });
  }
  if (seg === 'config/member-types' && method === 'PUT') {
    let b = {}; try { b = await req.json(); } catch {}
    const types = (b.types || []).map(t => String(t).trim()).filter(Boolean);
    if (!types.length) return json({ error: 'At least one type required' }, 400);
    await db.prepare("INSERT INTO chms_config(key,value) VALUES('member_types',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .bind(JSON.stringify(types)).run();
    return json({ ok: true, types });
  }

  if (seg === 'config/member-type-map' && method === 'GET') {
    const mapRow  = await db.prepare("SELECT value FROM chms_config WHERE key='member_type_map'").first();
    const seenRow = await db.prepare("SELECT value FROM chms_config WHERE key='breeze_statuses_seen'").first();
    return json({
      map:  mapRow  ? JSON.parse(mapRow.value)  : {},
      seen: seenRow ? JSON.parse(seenRow.value) : []
    });
  }
  if (seg === 'config/member-type-map' && method === 'PUT') {
    let b = {}; try { b = await req.json(); } catch {}
    await db.prepare("INSERT INTO chms_config(key,value) VALUES('member_type_map',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .bind(JSON.stringify(b.map || {})).run();
    return json({ ok: true });
  }

  if (seg === 'config/church' && method === 'GET') {
    const keys = ['church_ein','church_from_name','church_from_email','giving_letter_template','church_name'];
    const rows = (await db.prepare(`SELECT key, value FROM chms_config WHERE key IN (${keys.map(()=>'?').join(',')})`).bind(...keys).all()).results || [];
    const config = {};
    for (const r of rows) config[r.key] = r.value;
    return json(config);
  }
  if (seg === 'config/church' && method === 'PUT') {
    let b = {}; try { b = await req.json(); } catch {}
    const allowed = ['church_ein','church_from_name','church_from_email','giving_letter_template','church_name'];
    for (const k of allowed) {
      // Only save non-empty values — preserves existing config if user saves with a blank field
      if (b[k]) {
        await db.prepare("INSERT INTO chms_config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(k, String(b[k])).run();
      }
    }
    return json({ ok: true });
  }

  // ── Church Register ──────────────────────────────────────────────
  if (seg === 'register' && method === 'GET') {
    const rtype = url.searchParams.get('type');
    let rsql = 'SELECT * FROM church_register';
    const rparams = [];
    if (rtype) { rsql += ' WHERE type=?'; rparams.push(rtype); }
    rsql += ' ORDER BY event_date DESC, id DESC';
    const rrows = (await db.prepare(rsql).bind(...rparams).all()).results || [];
    return json({ entries: rrows });
  }
  if (seg === 'register' && method === 'POST') {
    let rb = {}; try { rb = await req.json(); } catch {}
    if (!rb.type || !rb.name) return json({ error: 'type and name required' }, 400);
    const rr = await db.prepare(
      `INSERT INTO church_register (type,event_date,name,name2,officiant,notes,person_id,
        record_type,dob,place_of_birth,baptism_place,father,mother,sponsors,pdf_page)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(rb.type||'', rb.event_date||'', rb.name||'', rb.name2||'', rb.officiant||'', rb.notes||'', rb.person_id||null,
      rb.record_type||'', rb.dob||'', rb.place_of_birth||'', rb.baptism_place||'',
      rb.father||'', rb.mother||'', rb.sponsors||'', rb.pdf_page||'').run();
    return json({ ok: true, id: rr.meta.last_row_id });
  }
  if (seg === 'register/batch' && method === 'POST') {
    let rows = []; try { rows = await req.json(); } catch {}
    if (!Array.isArray(rows) || !rows.length) return json({ error: 'expected array' }, 400);
    let imported = 0, errors = 0;
    const stmt = db.prepare(
      `INSERT INTO church_register (type,event_date,name,name2,officiant,notes,
        record_type,dob,place_of_birth,baptism_place,father,mother,sponsors,pdf_page)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    for (const rb of rows) {
      try {
        await stmt.bind(rb.type||'', rb.event_date||'', rb.name||'', rb.name2||'', rb.officiant||'', rb.notes||'',
          rb.record_type||'', rb.dob||'', rb.place_of_birth||'', rb.baptism_place||'',
          rb.father||'', rb.mother||'', rb.sponsors||'', rb.pdf_page||'').run();
        imported++;
      } catch(e) { errors++; }
    }
    return json({ ok: true, imported, errors });
  }
  const regDelMatch = seg.match(/^register\/(\d+)$/);
  if (regDelMatch && method === 'PUT') {
    const rid = parseInt(regDelMatch[1]);
    let rb2 = {}; try { rb2 = await req.json(); } catch {}
    await db.prepare(
      `UPDATE church_register SET event_date=?,name=?,name2=?,officiant=?,notes=?,
        record_type=?,dob=?,place_of_birth=?,baptism_place=?,father=?,mother=?,sponsors=?,pdf_page=? WHERE id=?`
    ).bind(rb2.event_date||'', rb2.name||'', rb2.name2||'', rb2.officiant||'', rb2.notes||'',
      rb2.record_type||'', rb2.dob||'', rb2.place_of_birth||'', rb2.baptism_place||'',
      rb2.father||'', rb2.mother||'', rb2.sponsors||'', rb2.pdf_page||'', rid).run();
    return json({ ok: true });
  }
  if (regDelMatch && method === 'DELETE') {
    await db.prepare('DELETE FROM church_register WHERE id=?').bind(parseInt(regDelMatch[1])).run();
    return json({ ok: true });
  }
  if (seg === 'register/clear' && method === 'POST') {
    let b = {}; try { b = await req.json(); } catch {}
    const validTypes = ['baptism','confirmation','wedding'];
    if (!validTypes.includes(b.type)) return json({ error: 'type must be baptism, confirmation, or wedding' }, 400);
    const r = await db.prepare('DELETE FROM church_register WHERE type=?').bind(b.type).run();
    return json({ ok: true, deleted: r.meta?.changes ?? 0 });
  }

  if (seg === 'import/register-from-people' && method === 'POST') {
    let b = {}; try { b = await req.json(); } catch {}
    const cutoff = b.cutoff || '1900-01-01';
    const types = Array.isArray(b.types) ? b.types : ['baptism','confirmation'];
    let imported = 0, skipped = 0;

    if (types.includes('baptism')) {
      const people = (await db.prepare(
        `SELECT id, first_name, last_name, dob, baptism_date FROM people
         WHERE active=1 AND baptism_date >= ? AND baptism_date != ''`
      ).bind(cutoff).all()).results || [];
      const stmt = db.prepare(
        `INSERT INTO church_register (type,event_date,name,dob,person_id) VALUES ('baptism',?,?,?,?)`
      );
      for (const p of people) {
        const fullName = ((p.first_name||'')+' '+(p.last_name||'')).trim();
        // Skip if already in register by person_id link OR by matching name+date (catches manual entries)
        const existing = await db.prepare(
          `SELECT id FROM church_register WHERE type='baptism' AND (person_id=? OR (event_date=? AND name=?))`
        ).bind(p.id, p.baptism_date, fullName).first();
        if (existing) { skipped++; continue; }
        await stmt.bind(p.baptism_date, fullName, p.dob||'', p.id).run();
        imported++;
      }
    }

    if (types.includes('confirmation')) {
      const people = (await db.prepare(
        `SELECT id, first_name, last_name, dob, confirmation_date FROM people
         WHERE active=1 AND confirmation_date >= ? AND confirmation_date != ''`
      ).bind(cutoff).all()).results || [];
      const stmt = db.prepare(
        `INSERT INTO church_register (type,event_date,name,dob,person_id) VALUES ('confirmation',?,?,?,?)`
      );
      for (const p of people) {
        const fullName = ((p.first_name||'')+' '+(p.last_name||'')).trim();
        const existing = await db.prepare(
          `SELECT id FROM church_register WHERE type='confirmation' AND (person_id=? OR (event_date=? AND name=?))`
        ).bind(p.id, p.confirmation_date, fullName).first();
        if (existing) { skipped++; continue; }
        await stmt.bind(p.confirmation_date, fullName, p.dob||'', p.id).run();
        imported++;
      }
    }

    return json({ ok: true, imported, skipped });
  }

  // ── Dev Board (Kanban) ───────────────────────────────────────────
  // ── Directory HTML (for print view) — grouped by household ─────
  if (seg === 'directory' && method === 'GET') {
    const e = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    // D1: type filter — hardcoded SQL clauses to avoid D1 IN-binding bugs
    const typesParam = (url.searchParams.get('types') || 'member').toLowerCase().trim();
    // Build a safe literal IN clause — values are from our own switch, not raw user input
    let typeClause;
    if (typesParam === 'member,attender' || typesParam === 'attender,member') {
      typeClause = `LOWER(member_type) IN ('member','attender')`;
    } else if (typesParam === 'all') {
      typeClause = `LOWER(member_type) NOT IN ('organization','inactive')`;
    } else {
      // default: member only
      typeClause = `LOWER(member_type) = 'member'`;
    }

    // Step 1: find household IDs containing ≥1 person with a qualifying member_type
    const qualHHRows = (await db.prepare(
      `SELECT DISTINCT household_id FROM people
       WHERE active=1 AND household_id IS NOT NULL AND household_id != ''
         AND ${typeClause}`
    ).all()).results || [];
    const qualHHIds = qualHHRows.map(r => r.household_id).filter(Boolean);

    // Step 2: fetch ALL people in qualifying households (show whole family)
    // Integer IDs interpolated directly — no injection risk
    let hhPeople = [];
    if (qualHHIds.length) {
      const hhIn = qualHHIds.join(',');
      hhPeople = (await db.prepare(
        `SELECT p.id, p.first_name, p.last_name, p.email, p.phone,
                p.address1, p.city, p.state, p.zip, p.family_role, p.member_type,
                p.household_id, h.name as household_name,
                p.dir_hide_address, p.dir_hide_phone, p.dir_hide_email, p.photo_url
         FROM people p JOIN households h ON p.household_id=h.id
         WHERE p.active=1 AND p.public_directory=1
           AND p.household_id IN (${hhIn})
         ORDER BY CASE p.family_role WHEN 'head' THEN 0 WHEN 'spouse' THEN 1 WHEN 'child' THEN 2 ELSE 3 END,
                  p.last_name, p.first_name`
      ).all()).results || [];
    }

    // Step 3: solo individuals (no household) who qualify directly
    const solos = (await db.prepare(
      `SELECT p.id, p.first_name, p.last_name, p.email, p.phone,
              p.address1, p.city, p.state, p.zip, p.member_type,
              p.dir_hide_address, p.dir_hide_phone, p.dir_hide_email, p.photo_url
       FROM people p
       WHERE p.active=1 AND p.public_directory=1
         AND (p.household_id IS NULL OR p.household_id='')
         AND ${typeClause}
       ORDER BY p.last_name, p.first_name`
    ).all()).results || [];

    // Group hhPeople by household_id
    const hhMap = new Map();
    for (const p of hhPeople) {
      if (!hhMap.has(p.household_id)) hhMap.set(p.household_id, []);
      hhMap.get(p.household_id).push(p);
    }

    // Build a unified sorted list of entries (household or solo)
    const bgColors = ['#2E7EA6','#C9973A','#5A9E6F','#9B59B6','#E87040'];
    const avatarHtml = (person, size=38) => {
      if (person.photo_url) {
        return `<img src="${e(person.photo_url)}" width="${size}" height="${size}" style="border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'">`;
      }
      const ini = ((person.first_name||'').charAt(0)+(person.last_name||'').charAt(0)).toUpperCase();
      const bg = bgColors[person.id % bgColors.length];
      return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:#fff;display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*.38)}px;font-weight:700;flex-shrink:0;">${ini}</div>`;
    };

    const hhEntries = [...hhMap.values()].map(members => {
      const head = members.find(m => m.family_role === 'head') || members[0];
      return { type:'hh', members, head, sortName: (head.last_name||head.first_name||'').toUpperCase() };
    });
    const soloEntries = solos.map(p => ({
      type:'solo', person:p, sortName: (p.last_name||p.first_name||'').toUpperCase()
    }));
    const allEntries = [...hhEntries, ...soloEntries]
      .sort((a,b) => a.sortName < b.sortName ? -1 : a.sortName > b.sortName ? 1 : 0);

    let rows = '', entryCount = 0, lastLetter = '';
    for (const entry of allEntries) {
      const letter = (entry.sortName.charAt(0) || '#').toUpperCase();
      if (letter !== lastLetter) {
        rows += `<div class="letter-hdr">${e(letter)}</div>`;
        lastLetter = letter;
      }
      if (entry.type === 'hh') {
        const { members, head } = entry;
        const spouse   = members.find(m => m.family_role === 'spouse');
        const children = members.filter(m => m.family_role !== 'head' && m.family_role !== 'spouse');
        let dispName = head.last_name
          ? e(head.last_name) + ', ' + [head.first_name, spouse ? spouse.first_name : ''].filter(Boolean).map(e).join(' &amp; ')
          : e(head.first_name || '');
        // D2: respect per-field privacy of household head
        const addr  = !head.dir_hide_address ? [head.address1,head.city,((head.state||'')+(head.zip?' '+head.zip:'')).trim()].filter(Boolean).map(e).join(', ') : '';
        const phone = !head.dir_hide_phone   ? e(head.phone || (spouse && !spouse.dir_hide_phone ? spouse.phone : '') || '') : '';
        const email = !head.dir_hide_email   ? e(head.email || (spouse && !spouse.dir_hide_email ? spouse.email : '') || '') : '';
        const contact = [addr,phone,email].filter(Boolean).join('<br>');
        const childList = children.length ? `<div class="members">${children.map(c=>e(c.first_name||c.last_name||'')).join(', ')}</div>` : '';
        rows += `<div class="hh"><div class="hh-row">${avatarHtml(head)}<div><div class="name">${dispName}</div>${childList}${contact?`<div class="contact">${contact}</div>`:''}</div></div></div>`;
      } else {
        const p = entry.person;
        const name = p.last_name ? e(p.last_name)+(p.first_name?', '+e(p.first_name):'') : e(p.first_name||'(unnamed)');
        const addr  = !p.dir_hide_address ? [p.address1,p.city,((p.state||'')+(p.zip?' '+p.zip:'')).trim()].filter(Boolean).map(e).join(', ') : '';
        const phone = !p.dir_hide_phone   ? e(p.phone||'') : '';
        const email = !p.dir_hide_email   ? e(p.email||'') : '';
        const contact = [addr,phone,email].filter(Boolean).join('<br>');
        rows += `<div class="hh"><div class="hh-row">${avatarHtml(p)}<div><div class="name">${name}</div>${contact?`<div class="contact">${contact}</div>`:''}</div></div></div>`;
      }
      entryCount++;
    }

    const churchNameRow = await db.prepare("SELECT value FROM chms_config WHERE key='church_name'").first();
    const churchName = churchNameRow?.value || 'Timothy Lutheran Church';

    // D1: type filter buttons shown on the print page
    const filterBtns = [['member','Members only'],['member,attender','Members + Attenders'],['all','All eligible']].map(([v,lbl])=>{
      const active = typesParam === v;
      return `<a href="?types=${encodeURIComponent(v)}" style="padding:5px 12px;background:${active?'#1E2D4A':'#e8e0d8'};color:${active?'#fff':'#333'};border-radius:4px;text-decoration:none;font-size:12px;white-space:nowrap;">${lbl}</a>`;
    }).join('');

    const dirHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Church Directory — ${e(churchName)}</title>
<style>
*{box-sizing:border-box;}
body{font-family:Georgia,serif;font-size:11pt;color:#222;margin:0;padding:20px;}
h1{font-size:20pt;margin:0 0 3px;font-family:Georgia,serif;}
.subtitle{font-size:10pt;color:#666;margin-bottom:18px;}
.grid{columns:2;column-gap:32px;}
.letter-hdr{font-size:15pt;font-weight:bold;color:#1E2D4A;border-bottom:2px solid #1E2D4A;
  margin:18px 0 8px;padding-bottom:2px;break-after:avoid;column-span:all;line-height:1;}
.hh{break-inside:avoid;page-break-inside:avoid;margin-bottom:11px;padding-bottom:11px;border-bottom:1px solid #e8e0d8;}
.hh-row{display:flex;gap:9px;align-items:flex-start;}
.name{font-weight:bold;font-size:10.5pt;line-height:1.2;}
.members{font-size:8.5pt;color:#555;margin-top:1px;}
.contact{font-size:8.5pt;color:#444;margin-top:3px;line-height:1.45;}
.toolbar{background:#f5f0ea;padding:11px 14px;border-radius:8px;margin-bottom:18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
@media print{
  .toolbar{display:none;}
  body{margin:1.2cm 1.5cm;padding:0;}
  .grid{columns:2;}
  .letter-hdr{break-after:avoid;}
}
@media screen{body{max-width:980px;margin:0 auto;padding:28px 20px;}}
</style></head><body>
<div class="toolbar">
  <button onclick="window.print()" style="padding:6px 16px;background:#1E2D4A;color:#fff;border:none;border-radius:5px;font-size:13px;cursor:pointer;font-family:inherit;">&#128438; Print / Save PDF</button>
  <div style="display:flex;gap:6px;flex-wrap:wrap;">${filterBtns}</div>
  <span style="font-size:11px;color:#888;margin-left:auto;">${entryCount} entries &bull; ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</span>
</div>
<h1>Church Directory</h1>
<div class="subtitle">${e(churchName)} &nbsp;&bull;&nbsp; ${new Date().toLocaleDateString('en-US',{month:'long',year:'numeric'})}</div>
<div class="grid">${rows||'<p style="color:#999;column-span:all;">No directory entries found.</p>'}</div>
</body></html>`;
    return new Response(dirHtml, { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' } });
  }

  if (seg === 'board' && method === 'GET') {
    const row = await db.prepare("SELECT value FROM chms_config WHERE key='dev_board'").first();
    return json({ data: row ? row.value : null });
  }
  if (seg === 'board' && method === 'PUT') {
    let body = ''; try { body = await req.text(); } catch {}
    if (!body) return json({ error: 'Empty body' }, 400);
    await db.prepare("INSERT INTO chms_config(key,value) VALUES('dev_board',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .bind(body).run();
    return json({ ok: true });
  }

  // ── Giving CSV Import ────────────────────────────────────────────
  // Accepts a Breeze giving export CSV with columns:
  // Payment ID, Date, Batch Number, Batch Name, Person ID, First Name,
  // Last Name, Envelope, Amount, Fund(s), Method, Check Number, Note
  if (seg === 'import/giving-csv' && method === 'POST') { try {
    let body = ''; try { body = await req.text(); } catch {}
    if (!body.trim()) return json({ error: 'Empty body' }, 400);

    // Full CSV parser (handles quoted fields containing commas/newlines)
    const parseCSV = text => {
      const rows = [];
      let cur = [], field = '', inQ = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') { inQ = !inQ; continue; }
        if (inQ) { field += c; continue; }
        if (c === ',') { cur.push(field.trim()); field = ''; continue; }
        if (c === '\n' || (c === '\r' && text[i+1] === '\n')) {
          if (c === '\r') i++;
          cur.push(field.trim()); rows.push(cur); cur = []; field = '';
          continue;
        }
        if (c === '\r') continue;
        field += c;
      }
      if (field || cur.length) { cur.push(field.trim()); rows.push(cur); }
      return rows.filter(r => r.some(c => c));
    };

    const rows = parseCSV(body);
    if (rows.length < 2) return json({ error: 'No data rows found' }, 400);

    // Map header names to column indices (case-insensitive)
    const hdr = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim());
    const col = (...names) => { for (const n of names) { const i = hdr.indexOf(n); if (i >= 0) return i; } return -1; };
    const C = {
      paymentId:   col('payment id'),
      date:        col('date'),
      batchNum:    col('batch number', 'batch'),
      batchName:   col('batch name'),
      personId:    col('person id'),
      amount:      col('amount'),
      fund:        col('fund s', 'fund', 'funds'),
      method:      col('method id', 'method'),
      checkNumber: col('check number'),
      note:        col('note', 'notes'),
    };
    if (C.paymentId < 0 || C.date < 0 || C.amount < 0)
      return json({ error: 'Missing required columns: Payment ID, Date, Amount' }, 400);

    const dataRows = rows.slice(1).filter(r => r[C.paymentId] && r[C.paymentId].trim());

    const parseDate = s => {
      const m = (s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      return m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : (s||'').slice(0,10);
    };
    const payMethod = t => {
      const s = (t||'').toLowerCase();
      if (s === 'cash') return 'cash';
      if (s.includes('check')) return 'check';
      if (s.includes('credit') || s.includes('card') || s.includes('online') || s.includes('egiving')) return 'card';
      if (s === 'ach' || s.includes('bank') || s.includes('eft') || s.includes('electronic')) return 'ach';
      return 'other';
    };

    // Pre-load caches
    const existingIds = new Set(
      ((await db.prepare("SELECT breeze_id FROM giving_entries WHERE breeze_id != ''").all()).results || [])
        .map(r => String(r.breeze_id))
    );
    const personByBreezeId = {};
    for (const p of (await db.prepare('SELECT id, breeze_id FROM people WHERE breeze_id != ""').all()).results || [])
      personByBreezeId[String(p.breeze_id)] = p.id;
    // Batch lookup: extract number from any existing batch description
    const batchByNum = {};
    for (const bt of (await db.prepare('SELECT id, description FROM giving_batches').all()).results || []) {
      const m = (bt.description || '').match(/(\d+)/);
      if (m) batchByNum[m[1]] = bt.id;
    }
    const fundByName = {};
    for (const f of (await db.prepare('SELECT id, name FROM funds').all()).results || [])
      fundByName[f.name.toLowerCase().trim()] = f.id;

    let imported = 0, skipped = 0, skipBlank = 0, skipDup = 0, skipZero = 0, fundsMade = 0, batchesMade = 0;
    const dupIds = [];
    const pidSeenInCsv = {}; // tracks nth occurrence of each payment ID in this chunk
    const ops = [];

    // Parse Breeze fund strings into per-fund splits.
    // Handles Breeze CSV format: "40085 General Fund" or "40085 General Fund (160.00), 49094 Tuition Aid (40.00)"
    // Also handles colon format: "General Fund: $160.00, Tuition Aid: $40.00"
    const parseFundSplits = (fundStr, totalCents) => {
      const s = (fundStr || '').trim();
      if (!s || s.toLowerCase() === 'nan') return [{ name: 'General Fund', cents: totalCents }];
      // Breeze CSV format: starts with numeric fund ID prefix e.g. "40085 General Fund (160.00)"
      // Keep the full name including the number; strip only the trailing amount in parens.
      if (/^\d+\s/.test(s)) {
        const parts = s.split(/,\s*(?=\d)/);
        const splits = parts.map(p => {
          const m = p.trim().match(/^(.+?)(?:\s+\(([0-9.]+)\))?\s*$/);
          return m ? { name: m[1].trim(), cents: m[2] ? Math.round(parseFloat(m[2]) * 100) : null } : null;
        }).filter(Boolean);
        if (splits.length > 1) return splits.map(f => ({ name: f.name, cents: f.cents ?? 0 }));
        if (splits.length === 1) return [{ name: splits[0].name, cents: totalCents }];
      }
      // Colon format: "General Fund: $160.00"
      if (/:\s*\$?[0-9]/.test(s)) {
        const parts = s.split(/,\s*(?=\S)/);
        const splits = [];
        for (const p of parts) {
          const m = p.trim().match(/^([^:]+?):\s*\$?([0-9.]+)\s*$/);
          if (m) splits.push({ name: m[1].trim(), cents: Math.round(parseFloat(m[2]) * 100) });
        }
        if (splits.length > 1) return splits;
        if (splits.length === 1) return [{ name: splits[0].name, cents: totalCents }];
      }
      return [{ name: s, cents: totalCents }];
    };

    for (const row of dataRows) {
      const pid = String(row[C.paymentId] || '').trim();
      if (!pid) { skipped++; skipBlank++; continue; }
      // Track how many times this payment ID appears in this CSV chunk.
      // Breeze exports one row per fund for split payments (same pid, different fund/amount).
      // First occurrence: check pid and pid-1. Subsequent: check pid-N.
      pidSeenInCsv[pid] = (pidSeenInCsv[pid] || 0) + 1;
      const nthOcc = pidSeenInCsv[pid];
      const isDup = nthOcc === 1
        ? (existingIds.has(pid) || existingIds.has(pid + '-1'))
        : existingIds.has(pid + '-' + nthOcc);
      if (isDup) { skipped++; skipDup++; dupIds.push(pid + (nthOcc > 1 ? ' (row ' + nthOcc + ')' : '')); continue; }

      const date      = parseDate(C.date >= 0 ? row[C.date] : '');
      const batchNum  = C.batchNum >= 0  ? (row[C.batchNum]  || '').trim() : '';
      const batchName = C.batchName >= 0 ? (row[C.batchName] || '').trim() : '';
      const personBId = (C.personId >= 0  ? (row[C.personId]  || '').trim() : '').replace(/\.0$/, '');
      const amtStr    = (C.amount >= 0   ? row[C.amount]     : '0').replace(/[$, ]/g, '');
      const cents     = Math.round(parseFloat(amtStr || '0') * 100);
      const fundStr   = C.fund >= 0 ? (row[C.fund] || '') : '';
      const method    = payMethod(C.method >= 0 ? row[C.method] : '');
      const checkNum  = C.checkNumber >= 0 ? (row[C.checkNumber] || '') : '';
      const note      = C.note >= 0 ? (row[C.note] || '') : '';

      if (cents === 0) { skipped++; skipZero++; continue; }

      const personId = personByBreezeId[personBId] ?? null;

      // Get or create batch
      const batchDesc = batchNum
        ? ('Batch #' + batchNum + (batchName ? ' \u2013 ' + batchName : ''))
        : ('CSV Import ' + date.slice(0, 7));
      let batchId = batchByNum[batchNum || batchDesc] ?? null;
      if (!batchId) {
        const r = await db.prepare(
          'INSERT INTO giving_batches (batch_date, description, closed) VALUES (?,?,1)'
        ).bind(date, batchDesc).run();
        batchId = r.meta?.last_row_id;
        batchByNum[batchNum || batchDesc] = batchId;
        batchesMade++;
      }

      const fundSplits = parseFundSplits(fundStr, cents);
      const isMulti = fundSplits.length > 1;

      for (let si = 0; si < fundSplits.length; si++) {
        const { name: fName, cents: fCents } = fundSplits[si];
        // Multi-fund single row: pid-1, pid-2 … (parseFundSplits split)
        // Multi-row split (Breeze per-fund rows): pid (1st row), pid-2 (2nd), pid-3 (3rd)
        const entryId = isMulti ? (pid + '-' + (si + 1)) : (nthOcc === 1 ? pid : pid + '-' + nthOcc);
        const fundKey = fName.toLowerCase().trim();
        if (!fundByName[fundKey]) {
          const r = await db.prepare(
            "INSERT INTO funds (name, breeze_id, active, sort_order) VALUES (?,?,1,99)"
          ).bind(fName, '').run();
          fundByName[fundKey] = r.meta?.last_row_id;
          fundsMade++;
        }
        ops.push(db.prepare(
          `INSERT INTO giving_entries (batch_id,person_id,fund_id,amount,method,check_number,notes,breeze_id,contribution_date)
           VALUES (?,?,?,?,?,?,?,?,?)`
        ).bind(batchId, personId, fundByName[fundKey], fCents, method, checkNum, note, entryId, date));
        existingIds.add(entryId);
      }
      imported++;
    }

    for (let i = 0; i < ops.length; i += 100) await db.batch(ops.slice(i, i + 100));
    await db.prepare(
      'DELETE FROM giving_batches WHERE id NOT IN (SELECT DISTINCT batch_id FROM giving_entries)'
    ).run();

    return json({ ok: true, imported, skipped, skipBlank, skipDup, skipZero, fundsMade, batchesMade, total: dataRows.length, dupIds });
  } catch (e) { return json({ ok: false, error: e.message }, 500); } }

  // ── Giving Reset ──────────────────────────────────────────────────
  if (seg === 'giving/all' && method === 'DELETE') { try {
    if (!isAdmin) return json({ error: 'Access denied: giving reset requires admin access' }, 403);
    await db.batch([
      db.prepare('DELETE FROM giving_entries'),
      db.prepare('DELETE FROM giving_batches'),
    ]);
    return json({ ok: true });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
  }

  if (seg === 'giving/by-year' && method === 'DELETE') { try {
    if (!isAdmin) return json({ error: 'Access denied' }, 403);
    const year = url.searchParams.get('year') || '';
    if (!/^\d{4}$/.test(year)) return json({ error: 'Invalid year' }, 400);
    const del = await db.prepare(
      `DELETE FROM giving_entries
       WHERE contribution_date LIKE ? OR batch_id IN (
         SELECT id FROM giving_batches WHERE batch_date LIKE ?
       )`
    ).bind(year + '-%', year + '-%').run();
    await db.prepare(
      'DELETE FROM giving_batches WHERE id NOT IN (SELECT DISTINCT batch_id FROM giving_entries)'
    ).run();
    return json({ ok: true, deleted: del.meta?.changes ?? 0, year });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
  }

  if (seg === 'funds/all' && method === 'DELETE') { try {
    if (!isAdmin) return json({ error: 'Access denied' }, 403);
    const r = await db.prepare('DELETE FROM funds').run();
    return json({ ok: true, deleted: r.meta?.changes ?? 0 });
  } catch (e) { return json({ ok: false, error: e.message }, 500); }
  }

  // ── Look up giving entries by payment ID (breeze_id prefix) ─────────
  if (seg === 'giving/by-payment-id' && method === 'GET') {
    if (!isFinance) return json({ error: 'Access denied' }, 403);
    const pid = url.searchParams.get('pid') || '';
    if (!pid) return json({ error: 'pid required' }, 400);
    const rows = (await db.prepare(
      `SELECT ge.breeze_id, ge.amount, ge.contribution_date, ge.method,
              f.name as fund_name,
              p.first_name, p.last_name,
              gb.description as batch_desc
       FROM giving_entries ge
       LEFT JOIN funds f ON f.id=ge.fund_id
       LEFT JOIN people p ON p.id=ge.person_id
       LEFT JOIN giving_batches gb ON gb.id=ge.batch_id
       WHERE ge.breeze_id=? OR ge.breeze_id LIKE ?
       ORDER BY ge.breeze_id`
    ).bind(pid, pid + '-%').all()).results || [];
    return json({ rows });
  }

  // ── Prune empty batches ───────────────────────────────────────────
  if (seg === 'giving/prune-empty-batches' && method === 'POST') {
    const r = await db.prepare(
      'DELETE FROM giving_batches WHERE id NOT IN (SELECT DISTINCT batch_id FROM giving_entries)'
    ).run();
    return json({ ok: true, deleted: r.meta?.changes ?? 0 });
  }

  // ── Export endpoints ─────────────────────────────────────────────
  if (seg.startsWith('export/') && method === 'GET') {
    const csvEsc = v => {
      const s = String(v == null ? '' : v);
      return (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r'))
        ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csvRow = arr => arr.map(csvEsc).join(',');

    if (seg === 'export/people') {
      if (!isAdmin) return json({ error: 'Access denied' }, 403);
      const rows = (await db.prepare(`
        SELECT p.first_name, p.last_name, p.email, p.phone,
               p.address1, p.address2, p.city, p.state, p.zip,
               p.member_type, p.family_role, p.gender, p.marital_status,
               p.dob, p.baptism_date, p.confirmation_date, p.anniversary_date,
               p.death_date, p.notes, p.breeze_id, p.active,
               h.name as household_name
        FROM people p LEFT JOIN households h ON p.household_id=h.id
        ORDER BY p.last_name, p.first_name
      `).all()).results || [];
      const lines = [csvRow(['First Name','Last Name','Email','Phone','Address','Address 2','City','State','ZIP','Member Type','Family Role','Household','Gender','Marital Status','DOB','Baptism Date','Confirmation Date','Anniversary Date','Death Date','Active','Notes','Breeze ID'])];
      for (const r of rows)
        lines.push(csvRow([r.first_name,r.last_name,r.email,r.phone,r.address1,r.address2,r.city,r.state,r.zip,r.member_type,r.family_role,r.household_name,r.gender,r.marital_status,r.dob,r.baptism_date,r.confirmation_date,r.anniversary_date,r.death_date,r.active?'Yes':'No',r.notes,r.breeze_id]));
      return new Response(lines.join('\r\n'), { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="people-export.csv"' } });
    }

    if (seg === 'export/giving') {
      if (!isFinance) return json({ error: 'Access denied' }, 403);
      const year = url.searchParams.get('year') || '';
      let sql = `SELECT COALESCE(NULLIF(ge.contribution_date,''),gb.batch_date) as gift_date,
                        p.first_name, p.last_name,
                        f.name as fund_name,
                        ge.amount, ge.method, ge.check_number, ge.notes,
                        gb.description as batch_desc, ge.breeze_id
                 FROM giving_entries ge
                 LEFT JOIN people p ON ge.person_id=p.id
                 JOIN funds f ON ge.fund_id=f.id
                 JOIN giving_batches gb ON ge.batch_id=gb.id`;
      const binds = [];
      if (year) { sql += ` WHERE substr(COALESCE(NULLIF(ge.contribution_date,''),gb.batch_date),1,4)=?`; binds.push(year); }
      sql += ` ORDER BY gift_date, gb.id, ge.id`;
      const rows = (await db.prepare(sql).bind(...binds).all()).results || [];
      const fmtAmt = c => (c / 100).toFixed(2);
      const lines = [csvRow(['Date','First Name','Last Name','Fund','Amount','Method','Check #','Batch','Notes','Breeze ID'])];
      for (const r of rows)
        lines.push(csvRow([r.gift_date,r.first_name||'',r.last_name||'',r.fund_name,fmtAmt(r.amount),r.method,r.check_number||'',r.batch_desc,r.notes||'',r.breeze_id||'']));
      const filename = year ? `giving-${year}.csv` : 'giving-all.csv';
      return new Response(lines.join('\r\n'), { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${filename}"` } });
    }

    if (seg === 'export/register') {
      if (!isAdmin) return json({ error: 'Access denied' }, 403);
      const rows = (await db.prepare(`
        SELECT type, event_date, name, name2, officiant, dob, place_of_birth, baptism_place,
               father, mother, sponsors, notes, record_type, pdf_page
        FROM church_register ORDER BY event_date, type, id
      `).all()).results || [];
      const lines = [csvRow(['Type','Date','Name','Name 2','Officiant','DOB','Place of Birth','Baptism Place','Father','Mother','Sponsors','Notes','Record Type','PDF Page'])];
      for (const r of rows)
        lines.push(csvRow([r.type,r.event_date,r.name,r.name2||'',r.officiant||'',r.dob||'',r.place_of_birth||'',r.baptism_place||'',r.father||'',r.mother||'',r.sponsors||'',r.notes||'',r.record_type||'',r.pdf_page||'']));
      return new Response(lines.join('\r\n'), { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="register-export.csv"' } });
    }
  }

  // ── Send Giving Statement via Resend ─────────────────────────────
  if (seg === 'giving/send-statement' && method === 'POST') {
    let b = {}; try { b = await req.json(); } catch {}
    const { to_email, to_name, subject, html_body } = b;
    if (!to_email || !html_body) return json({ error: 'to_email and html_body required' }, 400);
    const fromNameRow = await db.prepare("SELECT value FROM chms_config WHERE key='church_from_name'").first();
    const fromEmailRow = await db.prepare("SELECT value FROM chms_config WHERE key='church_from_email'").first();
    const fromName = fromNameRow?.value || 'Timothy Lutheran Church';
    const fromEmail = fromEmailRow?.value || '';
    if (!fromEmail) return json({ error: 'church_from_email not configured in Settings' }, 400);
    const apiKey = env.RESEND_API_KEY;
    if (!apiKey) return json({ error: 'RESEND_API_KEY not set in Worker environment' }, 500);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, to: [to_email], subject: subject || 'Your Giving Statement', html: html_body })
    });
    const rd = await res.json();
    if (!res.ok) return json({ error: rd.message || 'Resend error' }, 500);
    return json({ ok: true, id: rd.id });
  }

  // ── Breeze Fund List (with giving totals for mapping UI) ─────────
  if (seg === 'import/breeze-fund-list' && method === 'GET') {
    const rows = (await db.prepare(
      `SELECT f.id, f.name, f.breeze_id,
              COUNT(ge.id) as gifts,
              COALESCE(SUM(ge.amount),0) as total_cents
       FROM funds f
       LEFT JOIN giving_entries ge ON ge.fund_id=f.id
       WHERE f.breeze_id != ''
       GROUP BY f.id ORDER BY total_cents DESC`
    ).all()).results || [];
    const real = (await db.prepare(
      "SELECT id, name FROM funds WHERE breeze_id='' OR breeze_id IS NULL ORDER BY sort_order, name"
    ).all()).results || [];
    const subdomain = env.BREEZE_SUBDOMAIN || '';
    return json({ breeze_funds: rows, real_funds: real, breeze_subdomain: subdomain });
  }

  // ── Fund Mapping (re-link or rename Breeze fund placeholders) ────
  if (seg === 'import/map-funds' && method === 'POST') {
    // Body: { mappings: [ { from_id: 5, to_id: 1, rename: 'General Fund' }, ... ] }
    // to_id + rename both optional:
    //   to_id set   → merge entries into existing fund, delete placeholder
    //   rename set  → just rename the placeholder fund in place
    let b = {}; try { b = await req.json(); } catch {}
    const mappings = b.mappings || [];
    if (!mappings.length) return json({ error: 'No mappings provided' }, 400);
    let moved = 0, renamed = 0;
    for (const { from_id, to_id, rename } of mappings) {
      if (!from_id) continue;
      if (to_id && to_id !== from_id) {
        // Merge: move all entries to target fund, delete placeholder
        const r = await db.prepare('UPDATE giving_entries SET fund_id=? WHERE fund_id=?').bind(to_id, from_id).run();
        moved += r.meta?.changes ?? 0;
        await db.prepare('DELETE FROM funds WHERE id=? AND breeze_id != ""').bind(from_id).run();
      } else if (rename && rename.trim()) {
        // Rename: update fund name and clear the breeze_id placeholder prefix
        await db.prepare("UPDATE funds SET name=?, breeze_id='' WHERE id=?").bind(rename.trim(), from_id).run();
        renamed++;
      }
    }
    return json({ ok: true, entries_moved: moved, renamed });
  }

  // ── Breeze Giving Sync (via account/list_log) ────────────────────
  if (seg === 'import/breeze-giving' && method === 'POST') { try {
    const subdomain = env.BREEZE_SUBDOMAIN;
    const apiKey    = env.BREEZE_API_KEY;
    if (!subdomain || !apiKey) return json({ error: 'Breeze not configured' }, 503);
    let b = {}; try { b = await req.json(); } catch {}
    const start = b.start || (new Date().getFullYear() + '-01-01');
    const end   = b.end   || new Date().toISOString().slice(0, 10);
    const hdrs = { 'Api-key': apiKey };
    // G9: accept contributions whose log date falls in this window but whose contribution
    // date is up to 45 days before start (covers Dec entries logged in Jan of the next year).
    // seenIds prevents double-import if the prior year was also synced.
    const lateStartObj = new Date(start);
    lateStartObj.setDate(lateStartObj.getDate() - 45);
    const lateStart = lateStartObj.toISOString().slice(0, 10);

    // Pre-fetch all Breeze fund names so we never create "Breeze Fund XXXXX" placeholders.
    // /api/funds returns empty for some accounts — also harvested from giving/list below.
    const breezeFundNames = {};
    try {
      const fRes = await fetch(`https://${subdomain}.breezechms.com/api/funds`, { headers: hdrs });
      if (fRes.ok) {
        const fRaw = await fRes.text();
        if (fRaw.trim()) {
          const fData = JSON.parse(fRaw);
          const fArr = Array.isArray(fData) ? fData : (Array.isArray(fData?.funds) ? fData.funds : []);
          for (const f of fArr) { if (f.id && f.name) breezeFundNames[String(f.id)] = f.name; }
        }
      }
    } catch {} // best-effort — also populated from giving/list fund entries below

    // Fetch audit log entries — two action types in parallel:
    // 1. contribution_added  — manually keyed contributions
    // 2. bulk_import_contributions — Tithely (and other processor) batch imports land here
    const logBase = `https://${subdomain}.breezechms.com/api/account/list_log?details=1&limit=10000&start=${start}&end=${end}`;
    const [logRes1, logRes2] = await Promise.all([
      fetch(logBase + '&action=contribution_added',        { headers: hdrs }),
      fetch(logBase + '&action=bulk_import_contributions', { headers: hdrs }),
    ]);
    if (!logRes1.ok) return json({ error: `Breeze log API error (contribution_added): ${logRes1.status}` }, 502);
    let entries1, entries2 = [];
    try { entries1 = await logRes1.json(); } catch { return json({ error: 'Invalid JSON from Breeze log (contribution_added)' }, 502); }
    if (!Array.isArray(entries1)) return json({ error: 'Unexpected response format', raw: String(entries1).slice(0,200) }, 502);
    // bulk_import_contributions is best-effort — don't fail the whole sync if it errors
    if (logRes2.ok) { try { const r = await logRes2.json(); if (Array.isArray(r)) entries2 = r; } catch {} }
    // Merge and deduplicate by object_json (payment ID). contribution_added wins on collision.
    const seenLogIds = new Set(entries1.map(e => String(e.object_json || e.id)));
    const entries = [...entries1, ...entries2.filter(e => !seenLogIds.has(String(e.object_json || e.id)))];

    // Pull from /api/giving/list solely to harvest fund names (breezeFundNames map).
    // We do NOT import these as contributions — the audit log above is the authoritative
    // contribution source.  Using giving/list as a second contribution source caused
    // double-counting because the two endpoints use different IDs for the same payment.
    let givingListFiltered = 0;
    let givingListFundHarvest = 0;
    const diag = {
      apiFundsCount: Object.keys(breezeFundNames).length,
      apiFundsSample: Object.entries(breezeFundNames).slice(0, 5).map(([id, name]) => ({ id, name })),
      contributionAddedCount: entries1.length,
      bulkImportCount: entries2.length,
      bulkImportSample: entries2.slice(0, 3).map(e => ({ id: e.id, object_json: e.object_json, details_keys: Object.keys(e.details || e.description || {}) })),
      givingListSample: [],
      auditLogSample: [],
      breezeFundNamesAfterHarvest: null,
      unresolvedFundIds: [],
    };
    try {
      // Wide fixed date range — Breeze returns empty without date params.
      // Using 2020-01-01 to today captures all-time fund names regardless of sync window.
      const glHarvestEnd = new Date().toISOString().slice(0, 10);
      const glUrl = `https://${subdomain}.breezechms.com/api/giving/list?start=2020-01-01&end=${glHarvestEnd}&details=1&limit=10000`;
      const glRes = await fetch(glUrl, { headers: hdrs });
      if (glRes.ok) {
        const gl = await glRes.json();
        if (Array.isArray(gl)) {
          // Capture raw structure of first 3 entries for diagnostics
          diag.givingListSample = gl.slice(0, 3).map(g => ({
            id: g.id,
            date: g.date,
            amount: g.amount,
            fund_id: g.fund_id,
            fund_name: g.fund_name,
            fund: g.fund,
            funds: g.funds,
            // Show all keys present
            keys: Object.keys(g),
          }));
          for (const g of gl) {
            // Harvest fund names — handle both 'funds' array and top-level fund_id/fund_name
            const rawFunds = Array.isArray(g.funds) ? g.funds :
                             (g.fund && typeof g.fund === 'object' ? [g.fund] :
                             (g.fund_id ? [{ id: g.fund_id, name: g.fund_name || g.fund || '' }] : []));
            for (const f of rawFunds) {
              const fname = f.name || f.fund_name || '';
              // f.fund_id is the actual Breeze fund ID; f.id is a per-payment row ID — always prefer fund_id
              const fid = String(f.fund_id || f.id || '');
              if (fid && fname) { breezeFundNames[fid] = fname; givingListFundHarvest++; }
            }
          }
        }
      }
    } catch (e) { /* giving/list is best-effort — fund names only */ }

    // Record all harvested fund names after both /api/funds and giving/list
    diag.breezeFundNamesAfterHarvest = Object.entries(breezeFundNames).map(([id, name]) => ({ id, name }));

    // All contributions come from the audit log only.
    const allEntries = entries;
    if (allEntries.length === 0) return json({ ok: true, imported: 0, skipped: 0, total: 0, date_range: { start, end } });

    // Capture raw audit log details for first 3 entries
    diag.auditLogSample = allEntries.slice(0, 3).map(e => {
      let d = null;
      try { d = JSON.parse(e.details); } catch {}
      return {
        entry_id: e.id,
        object_json: e.object_json,
        details_keys: d ? Object.keys(d) : [],
        details_fund_fields: d ? Object.entries(d).filter(([k]) => k.startsWith('fund') || k.startsWith('fname') || k.startsWith('amount')).reduce((o, [k, v]) => { o[k] = v; return o; }, {}) : {},
        details_raw_snippet: e.details ? String(e.details).slice(0, 500) : '',
      };
    });

    // Helpers
    const parseDetails = raw => { try { return JSON.parse(raw); } catch { return null; } };
    const extractFunds = (d, total) => {
      const lines = [];
      for (const [key, fid] of Object.entries(d)) {
        if (!key.startsWith('fund-') || !fid) continue;
        const uuid = key.slice(5);
        const splitAmt = d['amount-' + uuid];
        const fundName = d['fname-' + uuid] || '';
        lines.push({ breezeFundId: String(fid), amount: (splitAmt && parseFloat(splitAmt) > 0) ? splitAmt : total, fundName });
      }
      return lines.length > 0 ? lines : [{ breezeFundId: 'default', amount: total, fundName: '' }];
    };
    const payMethod = t => {
      const s = (t || '').toLowerCase();
      if (s === 'cash') return 'cash'; if (s === 'check') return 'check';
      if (s.includes('credit') || s.includes('card') || s.includes('online')) return 'card';
      if (s === 'ach' || s.includes('bank') || s.includes('eft')) return 'ach';
      return 'other';
    };
    const parseDate = s => {
      const m = (s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      return m ? m[3] + '-' + m[1].padStart(2,'0') + '-' + m[2].padStart(2,'0') : (s || start).slice(0,10);
    };

    // ── Deduplicate any existing rows caused by prior double-imports ────
    // Keeps the lowest-id row for each (breeze_id, fund_id) pair.
    const dupeResult = await db.prepare(
      `DELETE FROM giving_entries
       WHERE breeze_id != '' AND id NOT IN (
         SELECT MIN(id) FROM giving_entries WHERE breeze_id != '' GROUP BY breeze_id, fund_id
       )`
    ).run();
    const dupesRemoved = dupeResult.meta?.changes || 0;

    // ── Pre-load caches to avoid per-row DB round trips ──────────────
    // Existing contribution IDs → skip set (also tracks IDs seen this run)
    const seenIds = new Set(
      ((await db.prepare("SELECT breeze_id FROM giving_entries WHERE breeze_id != ''").all()).results || [])
        .map(r => r.breeze_id)
    );
    // People: breeze_id → local id
    const personByBreezeId = {};
    for (const p of (await db.prepare('SELECT id, breeze_id FROM people WHERE breeze_id != ""').all()).results || [])
      personByBreezeId[p.breeze_id] = p.id;
    // Batches: description → local id
    const batchByDesc = {};
    for (const bt of (await db.prepare('SELECT id, description FROM giving_batches').all()).results || [])
      batchByDesc[bt.description] = bt.id;
    // Funds: breeze_id → local id; also name → local id for fallback matching
    const fundByBreezeId = {};
    const fundByName = {};
    for (const f of (await db.prepare('SELECT id, name, breeze_id FROM funds').all()).results || []) {
      if (f.breeze_id) fundByBreezeId[f.breeze_id] = f.id;
      fundByName[f.name.toLowerCase().trim()] = f.id;
    }

    // ── Harvest fund names from audit log details (covers merged/deleted funds) ──
    // The audit log stores fname-{uuid} at log time — this name survives even when
    // Breeze merges or deletes a fund, so no API endpoint returns it any more.
    for (const entry of allEntries) {
      const d = parseDetails(entry.details);
      if (!d) continue;
      for (const fl of extractFunds(d, d.amount || '0')) {
        if (fl.breezeFundId !== 'default' && fl.fundName && !breezeFundNames[fl.breezeFundId]) {
          breezeFundNames[fl.breezeFundId] = fl.fundName;
        }
      }
    }

    // ── Batch-fix any placeholder fund names ("Breeze Fund XXXXX") ──────
    // Runs after giving/list harvest (breezeFundNames populated) AND after
    // fundByBreezeId is loaded, so we can match existing DB funds by breeze_id.
    let fundsRenamed = 0;
    {
      const fixOps = [];
      const fixMeta = [];
      for (const [breezeId, localId] of Object.entries(fundByBreezeId)) {
        const realName = breezeFundNames[breezeId];
        if (!realName) continue;
        fixOps.push(db.prepare("UPDATE funds SET name=? WHERE id=? AND name LIKE 'Breeze Fund %'").bind(realName, localId));
        fixMeta.push({ breezeId, localId, realName });
      }
      if (fixOps.length) {
        const results = await db.batch(fixOps);
        results.forEach((r, i) => {
          if (r.meta?.changes) { fundsRenamed++; fundByName[fixMeta[i].realName.toLowerCase().trim()] = fixMeta[i].localId; }
        });
      }
    }

    // ── Pass 1: pre-scan entries to collect needed batches and funds ──
    // This lets us batch-create everything before the main loop, avoiding
    // per-entry sequential D1 awaits that blow through the invocation limit.
    const newBatchesNeeded = new Map();  // batchKey -> {date, desc}
    const batchDateFixes   = new Map();  // batchKey -> date (existing batches whose date may need correction)
    const newFundsNeeded   = new Map();  // breezeFundId -> resolved name

    for (const entry of allEntries) {
      const contribId = String(entry.object_json || entry.id);
      if (seenIds.has(contribId)) continue;
      const d = parseDetails(entry.details);
      if (!d) continue;
      const date     = parseDate(d.date);
      // Exclude entries whose contribution date is truly out of range.
      // Entries within the 45-day grace window before `start` are imported
      // with their actual contribution date (G9 fix — covers Dec entries logged in Jan).
      if (date < lateStart || date > end) continue;
      const batchKey = d.batch_num ? `Breeze Batch #${d.batch_num}` : `Breeze Import ${date}`;
      if (!batchByDesc[batchKey]) {
        if (!newBatchesNeeded.has(batchKey)) newBatchesNeeded.set(batchKey, { date, desc: batchKey });
      } else {
        batchDateFixes.set(batchKey, date); // deduplicated — last date wins, fine
      }
      for (const fl of extractFunds(d, d.amount || '0')) {
        if (!fundByBreezeId[fl.breezeFundId]) {
          const bName = fl.fundName || breezeFundNames[fl.breezeFundId] || (fl.breezeFundId === 'default' ? 'General Fund' : `Breeze Fund ${fl.breezeFundId}`);
          const existing = newFundsNeeded.get(fl.breezeFundId);
          if (!existing || existing.startsWith('Breeze Fund ')) newFundsNeeded.set(fl.breezeFundId, bName);
        }
      }
    }

    // Record which fund IDs will be created as placeholders (for diagnostics)
    diag.unresolvedFundIds = [...newFundsNeeded.entries()]
      .filter(([, name]) => name.startsWith('Breeze Fund '))
      .map(([id, name]) => ({ id, placeholderName: name, inBreezeHarvest: !!breezeFundNames[id] }));

    // ── Batch-create new batches ────────────────────────────────────
    let batchesMade = 0;
    if (newBatchesNeeded.size) {
      const keys = [...newBatchesNeeded.keys()];
      const ops  = keys.map(k => db.prepare('INSERT INTO giving_batches (batch_date, description, closed) VALUES (?,?,1)').bind(newBatchesNeeded.get(k).date, k));
      const res  = await db.batch(ops);
      keys.forEach((k, i) => { batchByDesc[k] = res[i].meta?.last_row_id; batchesMade++; });
    }

    // ── Batch-fix existing batch dates (once per batch, not per entry) ─
    if (batchDateFixes.size) {
      const ops = [...batchDateFixes.entries()]
        .filter(([k]) => batchByDesc[k])
        .map(([k, date]) => db.prepare("UPDATE giving_batches SET batch_date=? WHERE id=? AND (batch_date='' OR batch_date=?)").bind(date, batchByDesc[k], start));
      if (ops.length) await db.batch(ops);
    }

    // ── Resolve unknown fund names individually from Breeze ─────────
    // For any fund that would be named "Breeze Fund XXXXX", try a direct
    // API lookup. This is a one-time cost per fund — once the name is in
    // the DB, subsequent syncs find it by breeze_id without extra calls.
    const placeholderIds = [...newFundsNeeded.entries()]
      .filter(([, name]) => name.startsWith('Breeze Fund '))
      .map(([id]) => id);
    if (placeholderIds.length > 0) {
      await Promise.allSettled(placeholderIds.map(async fid => {
        try {
          // Try GET /api/funds/{id} first
          let name = '';
          const r1 = await fetch(`https://${subdomain}.breezechms.com/api/funds/${fid}`, { headers: hdrs });
          if (r1.ok) {
            const raw1 = await r1.text();
            if (raw1.trim()) {
              const d1 = JSON.parse(raw1);
              name = d1?.name || d1?.fund_name || (Array.isArray(d1) && d1[0]?.name) || '';
            }
          }
          // Fallback: GET /api/giving/list?fund_id={id}&limit=1 — harvest name from a sample contribution
          if (!name) {
            const r2 = await fetch(`https://${subdomain}.breezechms.com/api/giving/list?fund_id=${fid}&limit=1`, { headers: hdrs });
            if (r2.ok) {
              const raw2 = await r2.text();
              if (raw2.trim()) {
                const d2 = JSON.parse(raw2);
                const g = Array.isArray(d2) ? d2[0] : null;
                if (g) {
                  const f = (Array.isArray(g.funds) ? g.funds : []).find(f => String(f.fund_id || f.id) === fid);
                  name = f?.name || f?.fund_name || g?.fund_name || '';
                }
              }
            }
          }
          if (name) { breezeFundNames[fid] = name; newFundsNeeded.set(fid, name); }
        } catch {}
      }));
    }

    // ── Batch-create/link new funds ─────────────────────────────────
    let fundsMade = 0;
    {
      const linkOps = [], linkMeta = [], createOps = [], createMeta = [];
      for (const [breezeFundId, bName] of newFundsNeeded) {
        const nameKey = bName.toLowerCase().trim();
        if (fundByName[nameKey]) {
          fundByBreezeId[breezeFundId] = fundByName[nameKey];
          linkOps.push(db.prepare('UPDATE funds SET breeze_id=? WHERE id=? AND (breeze_id IS NULL OR breeze_id="")').bind(breezeFundId, fundByName[nameKey]));
          linkMeta.push({ breezeFundId });
        } else {
          createOps.push(db.prepare('INSERT INTO funds (name, breeze_id, active, sort_order) VALUES (?,?,1,99)').bind(bName, breezeFundId));
          createMeta.push({ breezeFundId, nameKey });
        }
      }
      if (linkOps.length) await db.batch(linkOps);
      if (createOps.length) {
        const res = await db.batch(createOps);
        createMeta.forEach(({ breezeFundId, nameKey }, i) => {
          const id = res[i].meta?.last_row_id;
          fundByBreezeId[breezeFundId] = id;
          fundByName[nameKey] = id;
          fundsMade++;
        });
      }
    }

    // ── Resolve fund names for late-entry fund IDs ──────────────────
    // Pass 1 skips date-filtered entries, so their fund IDs never go through
    // the individual lookup path. Resolve them now so lateEntries shows
    // real names instead of raw Breeze IDs.
    {
      const lateFundIds = new Set();
      for (const entry of allEntries) {
        const d = parseDetails(entry.details);
        if (!d) continue;
        const date = parseDate(d.date);
        if (date >= start && date <= end) continue;
        for (const fl of extractFunds(d, d.amount || '0')) {
          if (fl.breezeFundId !== 'default' && !breezeFundNames[fl.breezeFundId]) {
            lateFundIds.add(fl.breezeFundId);
          }
        }
      }
      if (lateFundIds.size) {
        await Promise.allSettled([...lateFundIds].map(async fid => {
          if (!/^\d+$/.test(fid)) return;
          try {
            const r = await fetch(`https://${subdomain}.breezechms.com/api/funds/${fid}`, { headers: hdrs });
            if (r.ok) {
              const fd = await r.json();
              const name = fd?.name || fd?.fund_name || (Array.isArray(fd) && fd[0]?.name) || '';
              if (name) breezeFundNames[fid] = name;
            }
          } catch (e) {
            diag.lateFundFetchWarnings = diag.lateFundFetchWarnings || [];
            diag.lateFundFetchWarnings.push(`fund ${fid}: ${e.message}`);
          }
        }));
      }
    }

    // ── Pass 2: build entry inserts (no D1 calls in this loop) ──────
    let imported = 0, lateImported = 0, skipped = 0, skippedDateFilter = 0;
    const errors = [];
    const lateEntries = [];
    const entryInserts = [];

    for (const entry of allEntries) {
      try {
        const contribId = String(entry.object_json || entry.id);
        if (seenIds.has(contribId)) { skipped++; continue; }
        seenIds.add(contribId);
        const d = parseDetails(entry.details);
        if (!d) { skipped++; continue; }

        const personId = personByBreezeId[String(d.person_id || '')] ?? null;
        const method   = payMethod(d.method);
        const checkNum = d.check_number || '';
        const notes    = d.note || '';
        const date     = parseDate(d.date);

        // Truly out-of-range entries (older than the 45-day grace window, or future-dated)
        if (date < lateStart || date > end) {
          skippedDateFilter++;
          for (const fl of extractFunds(d, d.amount || '0')) {
            lateEntries.push({
              date,
              amount: parseFloat(fl.amount || '0').toFixed(2),
              fund: breezeFundNames[fl.breezeFundId] || fl.fundName || fl.breezeFundId,
              method: d.method || '',
              person_id: d.person_id || '',
              breeze_id: contribId,
            });
          }
          continue;
        }

        // Import the entry — whether it's in-window (date >= start) or a grace-window
        // late entry (lateStart <= date < start). Contribution date is stored as-is.
        const batchKey = d.batch_num ? `Breeze Batch #${d.batch_num}` : `Breeze Import ${date}`;
        const batchId  = batchByDesc[batchKey];
        if (!batchId) { errors.push({ id: entry.id, error: 'batch not found: ' + batchKey }); skipped++; continue; }

        for (const fl of extractFunds(d, d.amount || '0')) {
          const cents  = Math.round(parseFloat(fl.amount || '0') * 100);
          const fundId = fundByBreezeId[fl.breezeFundId];
          if (!fundId) { errors.push({ id: entry.id, error: 'fund not found: ' + fl.breezeFundId }); continue; }
          entryInserts.push(
            db.prepare(
              `INSERT INTO giving_entries (batch_id,person_id,fund_id,amount,method,check_number,notes,breeze_id,contribution_date)
               VALUES (?,?,?,?,?,?,?,?,?)`
            ).bind(batchId, personId, fundId, cents, method, checkNum, notes, contribId, date)
          );
        }
        if (date < start) lateImported++; else imported++;
      } catch (e) { errors.push({ id: entry.id, error: e.message }); }
    }

    // ── Flush all entry inserts in batches of 100 ────────────────────
    for (let i = 0; i < entryInserts.length; i += 100) {
      await db.batch(entryInserts.slice(i, i + 100));
    }

    // ── Prune any batches that ended up with no entries ──────────────
    await db.prepare(
      'DELETE FROM giving_batches WHERE id NOT IN (SELECT DISTINCT batch_id FROM giving_entries)'
    ).run();

    // ── Report contributions tied to still-unresolved "Breeze Fund XXXXX" funds ──
    const ghostFundContribs = (await db.prepare(
      `SELECT ge.contribution_date, ge.amount, ge.method, ge.notes, ge.breeze_id,
              f.name AS fund_name, f.breeze_id AS fund_breeze_id
       FROM giving_entries ge
       JOIN funds f ON f.id = ge.fund_id
       WHERE f.name LIKE 'Breeze Fund %'
       ORDER BY ge.contribution_date DESC`
    ).all()).results || [];

    return json({ ok: true, imported, lateImported, skipped, skippedDateFilter, lateEntries, ghostFundContribs, dupesRemoved, fundsRenamed, fundsMade, batchesMade, breezeFundsFound: Object.keys(breezeFundNames).length, givingListFundHarvest, givingListFiltered, seenIdsCount: seenIds.size, errors: errors.slice(0, 20), total: allEntries.length, from_log: entries.length, date_range: { start, end }, lateGraceDays: 45, diagnostics: diag });
  } catch (givingErr) {
    return json({ error: 'Giving sync error: ' + givingErr.message }, 500);
  } }

  // ── Breeze Giving CSV Import ─────────────────────────────────────
  // Accepts the TSV export from Breeze (Contributions > Export)
  // Fund(s) format: "40085 General Fund" or "40085 General Fund (160.00), 49094 Tuition Aid (40.00)"
  if (seg === 'import/breeze-giving-csv' && method === 'POST') { try {
    const csvText = (await req.text()).trim();
    if (!csvText) return json({ error: 'No CSV data provided' }, 400);

    const lines = csvText.split('\n').map(l => l.trimEnd()).filter(l => l.trim());
    if (lines.length < 2) return json({ error: 'No data rows found' }, 400);

    // Detect delimiter (tab vs comma) from header line
    const delim = lines[0].includes('\t') ? '\t' : ',';
    const header = lines[0].split(delim).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
    const col = name => header.findIndex(h => h === name.toLowerCase());
    const iDate = col('date'), iPaymentId = col('payment id');
    const iPersonId = col('person id'), iAmount = col('amount'), iFunds = col('fund(s)');
    // "Batch Number" in newer exports, "Batch" in older ones
    const iBatch = col('batch number') >= 0 ? col('batch number') : col('batch');
    // Optional columns present in newer exports
    const iMethod = col('method'), iCheckNum = col('check number'), iNote = col('note');
    if ([iDate, iBatch, iPaymentId, iAmount, iFunds].some(i => i < 0))
      return json({ error: 'Missing columns. Expected: Date, Batch/Batch Number, Payment ID, Amount, Fund(s)' }, 400);

    const parseMethod = t => {
      const s = (t || '').toLowerCase();
      if (s === 'cash') return 'cash';
      if (s.startsWith('check')) return 'check';
      if (s.includes('ach') || s.includes('bank') || s.includes('eft')) return 'ach';
      if (s.includes('card') || s.includes('credit') || s.includes('online')) return 'card';
      return 'other';
    };

    // Parse "40085 General Fund" or "40085 General Fund (160.00), 49094 Tuition Aid (40.00)"
    const parseFunds = (fundsStr, totalStr) => {
      // Split on commas only when followed by a digit (next fund ID)
      const parts = fundsStr.split(/,\s*(?=\d)/);
      const results = [];
      for (const part of parts) {
        const m = part.trim().match(/^(\d+)\s+(.+?)(?:\s+\(([0-9.]+)\))?\s*$/);
        if (!m) continue;
        results.push({ breezeFundId: m[1], fundName: m[2].trim(), amount: m[3] || null });
      }
      if (results.length === 0) return [{ breezeFundId: 'default', fundName: 'General Fund', amount: totalStr }];
      if (results.length === 1 && !results[0].amount) results[0].amount = totalStr;
      return results;
    };

    // Pre-load caches
    const existingIds = new Set(
      ((await db.prepare("SELECT breeze_id FROM giving_entries WHERE breeze_id != ''").all()).results || [])
        .map(r => r.breeze_id)
    );
    const personByBreezeId = {};
    for (const p of (await db.prepare('SELECT id, breeze_id FROM people WHERE breeze_id != ""').all()).results || [])
      personByBreezeId[p.breeze_id] = p.id;
    const batchByDesc = {};
    for (const bt of (await db.prepare('SELECT id, description FROM giving_batches').all()).results || [])
      batchByDesc[bt.description] = bt.id;
    const fundByBreezeId = {};
    const fundByName = {};
    for (const f of (await db.prepare('SELECT id, name, breeze_id FROM funds').all()).results || []) {
      if (f.breeze_id) fundByBreezeId[f.breeze_id] = f.id;
      fundByName[f.name.toLowerCase().trim()] = f.id;
    }

    let imported = 0, skipped = 0;
    const errors = [];
    const entryInserts = [];
    // Normalize M/D/YYYY or MM/DD/YYYY → YYYY-MM-DD for correct year filtering
    const normDate = d => {
      if (!d) return '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      return m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : d;
    };

    for (let i = 1; i < lines.length; i++) {
      try {
        const cols = delim === '\t' ? lines[i].split('\t') : lines[i].split(',');
        const paymentId = (cols[iPaymentId] || '').replace(/['"]/g, '').trim();
        if (!paymentId) continue;
        if (existingIds.has(paymentId)) { skipped++; continue; }

        const date = normDate((cols[iDate] || '').replace(/['"]/g, '').trim());
        const batchNum = (cols[iBatch] || '').replace(/['"]/g, '').trim();
        const personBreezeId = iPersonId >= 0 ? (cols[iPersonId] || '').replace(/['"]/g, '').trim() : '';
        const amountStr = (cols[iAmount] || '').replace(/[$\s'"]/g, '');
        const fundsStr = (cols[iFunds] || '').replace(/^["']|["']$/g, '').trim();
        const methodRaw = iMethod >= 0 ? (cols[iMethod] || '').replace(/['"]/g, '').trim() : '';
        const checkNum = iCheckNum >= 0 ? (cols[iCheckNum] || '').replace(/['"]/g, '').trim() : '';
        const note = iNote >= 0 ? (cols[iNote] || '').replace(/['"]/g, '').trim() : '';

        const totalAmount = parseFloat(amountStr) || 0;
        const method = parseMethod(methodRaw);
        const personId = personBreezeId ? (personByBreezeId[personBreezeId] ?? null) : null;
        const batchKey = batchNum ? `Breeze Batch #${batchNum}` : `Breeze Import ${date}`;

        if (!batchByDesc[batchKey]) {
          const r = await db.prepare('INSERT INTO giving_batches (batch_date, description, closed) VALUES (?,?,1)')
            .bind(date, batchKey).run();
          batchByDesc[batchKey] = r.meta?.last_row_id;
        }
        const batchId = batchByDesc[batchKey];

        for (const fl of parseFunds(fundsStr, String(totalAmount))) {
          const cents = Math.round(parseFloat(fl.amount || '0') * 100);
          if (!fundByBreezeId[fl.breezeFundId]) {
            const fname = fl.fundName || `Breeze Fund ${fl.breezeFundId}`;
            const nameKey = fname.toLowerCase().trim();
            if (fundByName[nameKey]) {
              // Fund exists by name (may have no breeze_id yet) — link it
              fundByBreezeId[fl.breezeFundId] = fundByName[nameKey];
              await db.prepare('UPDATE funds SET breeze_id=? WHERE id=? AND (breeze_id IS NULL OR breeze_id="")').bind(fl.breezeFundId, fundByName[nameKey]).run();
            } else {
              const r = await db.prepare('INSERT INTO funds (name, breeze_id, active, sort_order) VALUES (?,?,1,99)')
                .bind(fname, fl.breezeFundId).run();
              fundByBreezeId[fl.breezeFundId] = r.meta?.last_row_id;
              fundByName[nameKey] = fundByBreezeId[fl.breezeFundId];
            }
          } else if (fl.fundName) {
            // Fund already exists — if it has a placeholder name, fix it using the real CSV name
            const existId = fundByBreezeId[fl.breezeFundId];
            await db.prepare("UPDATE funds SET name=? WHERE id=? AND name LIKE 'Breeze Fund %'")
              .bind(fl.fundName, existId).run();
          }
          entryInserts.push(
            db.prepare(
              `INSERT INTO giving_entries (batch_id,person_id,fund_id,amount,method,check_number,notes,breeze_id,contribution_date)
               VALUES (?,?,?,?,?,?,?,?,?)`
            ).bind(batchId, personId, fundByBreezeId[fl.breezeFundId], cents, method, checkNum, note, paymentId, date)
          );
        }
        imported++;
      } catch(e) { errors.push({ row: i, error: e.message }); }
    }

    for (let i = 0; i < entryInserts.length; i += 100) {
      await db.batch(entryInserts.slice(i, i + 100));
    }
    return json({ ok: true, imported, skipped, errors: errors.slice(0, 20), total: lines.length - 1 });
  } catch (csvErr) {
    return json({ error: 'CSV import error: ' + csvErr.message }, 500);
  } }

  // ── Clear Bad Tag Assignments ─────────────────────────────────────
  if (seg === 'import/clear-person-tags' && method === 'POST') {
    const r = await db.prepare('DELETE FROM person_tags').run();
    return json({ ok: true, deleted: r.meta?.changes ?? 0 });
  }

  // ── Restore active=1 for all Breeze-imported people ──────────────
  // Emergency recovery: sets active=1 for every person that has a breeze_id.
  // Use after a deactivation bug wipes everyone from the system.
  if (seg === 'import/restore-breeze-active' && method === 'POST') {
    const r = await db.prepare(`UPDATE people SET active=1 WHERE breeze_id != '' AND breeze_id IS NOT NULL`).run();
    return json({ ok: true, restored: r.meta?.changes ?? 0 });
  }

  // ── Fix Fund Names ───────────────────────────────────────────────
  // Fetches /api/funds from Breeze and renames any local funds whose name
  // still starts with "Breeze Fund " to the real Breeze fund name.
  if (seg === 'import/fix-fund-names' && method === 'POST') { try {
    const subdomain = env.BREEZE_SUBDOMAIN;
    const apiKey    = env.BREEZE_API_KEY;
    if (!subdomain || !apiKey) return json({ error: 'Breeze not configured' }, 503);
    const hdrs = { 'Api-key': apiKey };

    // Fetch real fund names from Breeze
    const breezeFundNames = {};
    let fetchError = null;
    let rawBody = '';
    let httpStatus = 0;
    try {
      const fRes = await fetch(`https://${subdomain}.breezechms.com/api/funds`, { headers: hdrs });
      httpStatus = fRes.status;
      rawBody = await fRes.text();
      if (fRes.ok) {
        if (!rawBody.trim()) {
          fetchError = 'Breeze /api/funds returned empty body (status ' + httpStatus + ')';
        } else {
          let fData;
          try { fData = JSON.parse(rawBody); }
          catch (pe) { fetchError = 'Breeze /api/funds returned non-JSON: ' + rawBody.slice(0, 200); }
          if (fData) {
            const fArr = Array.isArray(fData) ? fData : (Array.isArray(fData?.funds) ? fData.funds : null);
            if (fArr) {
              for (const f of fArr) { if (f.id && f.name) breezeFundNames[String(f.id)] = f.name; }
            } else {
              fetchError = 'Unexpected /api/funds format: ' + rawBody.slice(0, 200);
            }
          }
        }
      } else {
        fetchError = `Breeze /api/funds returned ${httpStatus}: ` + rawBody.slice(0, 200);
      }
    } catch (e) { fetchError = 'fetch threw: ' + e.message; }

    // /api/funds returned empty — fall back to harvesting names from recent giving entries
    let glDiag = null;
    if (Object.keys(breezeFundNames).length === 0) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const fiveYrsAgo = (new Date().getFullYear() - 5) + '-01-01';
        const glRes = await fetch(
          `https://${subdomain}.breezechms.com/api/giving/list?start=${fiveYrsAgo}&end=${today}&details=1&limit=100`,
          { headers: hdrs }
        );
        if (glRes.ok) {
          const glRaw = await glRes.text();
          let gl = null; try { gl = glRaw.trim() ? JSON.parse(glRaw) : null; } catch {}
          const glArr = Array.isArray(gl) ? gl : null;
          // Capture structure of first entry for diagnostics
          glDiag = glArr ? { count: glArr.length, first_entry_keys: glArr[0] ? Object.keys(glArr[0]) : [], first_funds: JSON.stringify(glArr[0]?.funds ?? glArr[0]?.fund ?? 'n/a').slice(0, 300) } : { raw_preview: glRaw.slice(0, 300) };
          if (glArr) {
            for (const g of glArr) {
              const funds = Array.isArray(g.funds) ? g.funds : (g.fund_id ? [{ id: g.fund_id, name: g.fund_name || g.fund || '' }] : []);
              for (const f of funds) {
                const fname = f.name || f.fund_name || '';
                const fid = String(f.id || f.fund_id || '');
                // Funds may be name-only (no id) per Breeze API design
                if (fname) breezeFundNames[fid || ('n:' + fname.toLowerCase().replace(/[^a-z0-9]+/g, '_'))] = fname;
              }
            }
          }
        }
      } catch (e) { glDiag = { error: e.message }; }
    }

    // Get all local funds with placeholder names
    const placeholderFunds = (await db.prepare(
      "SELECT id, name, breeze_id FROM funds WHERE name LIKE 'Breeze Fund %'"
    ).all()).results || [];

    // Try individual lookups for any placeholder fund whose ID wasn't resolved above
    const stillUnresolved = placeholderFunds.filter(f => f.breeze_id && !breezeFundNames[String(f.breeze_id)]);
    if (stillUnresolved.length > 0) {
      await Promise.allSettled(stillUnresolved.map(async f => {
        try {
          const r = await fetch(`https://${subdomain}.breezechms.com/api/funds/${f.breeze_id}`, { headers: hdrs });
          if (!r.ok) return;
          const raw = await r.text();
          if (!raw.trim()) return;
          const data = JSON.parse(raw);
          const name = data?.name || data?.fund_name || (Array.isArray(data) && data[0]?.name) || '';
          if (name) breezeFundNames[String(f.breeze_id)] = name;
        } catch {}
      }));
    }

    if (Object.keys(breezeFundNames).length === 0) {
      return json({ ok: false, needsManual: true, error: 'Breeze API did not return fund names — use manual mapping below', placeholderFunds, breezeFundsFound: 0, renamed: 0, httpStatus, glDiag });
    }

    let renamed = 0;
    const details = [];
    for (const f of placeholderFunds) {
      const realName = f.breeze_id ? breezeFundNames[String(f.breeze_id)] : null;
      if (!realName) {
        details.push({ id: f.id, old_name: f.name, breeze_id: f.breeze_id, status: 'no_match' });
        continue;
      }
      await db.prepare('UPDATE funds SET name=? WHERE id=?').bind(realName, f.id).run();
      details.push({ id: f.id, old_name: f.name, new_name: realName, breeze_id: f.breeze_id, status: 'renamed' });
      renamed++;
    }

    const noMatchFunds = details.filter(d => d.status === 'no_match');
    return json({ ok: true, breezeFundsFound: Object.keys(breezeFundNames).length, placeholderFundsFound: placeholderFunds.length, renamed, details, fetchError, noMatchFunds });
  } catch (e) { return json({ ok: false, error: e.message }, 500); } }

  // ── Manual Fund Renames ───────────────────────────────────────────
  if (seg === 'import/manual-fund-renames' && method === 'POST') { try {
    if (!isAdmin) return json({ error: 'Admin only' }, 403);
    let b = {}; try { b = await req.json(); } catch {}
    const updates = Array.isArray(b.updates) ? b.updates : [];
    let renamed = 0;
    for (const u of updates) {
      if (!u.id || !u.name) continue;
      await db.prepare('UPDATE funds SET name=? WHERE id=?').bind(String(u.name).trim(), u.id).run();
      renamed++;
    }
    return json({ ok: true, renamed });
  } catch (e) { return json({ ok: false, error: e.message }, 500); } }

  // ── Breeze Debug ─────────────────────────────────────────────────
  if (seg === 'import/breeze-debug' && method === 'GET') {
    const subdomain = env.BREEZE_SUBDOMAIN;
    const apiKey    = env.BREEZE_API_KEY;
    if (!subdomain || !apiKey) return json({ error: 'Breeze not configured' }, 503);
    const hdrs = { 'Api-key': apiKey };
    // Fetch profile field definitions
    const profileRes = await fetch(`https://${subdomain}.breezechms.com/api/profile`, { headers: hdrs });
    let profileFields = []; try { profileFields = await profileRes.json(); } catch {}
    // Fetch 50 people and skip organizations (no last_name)
    const pRes = await fetch(`https://${subdomain}.breezechms.com/api/people?details=1&limit=50&offset=0`, { headers: hdrs });
    if (!pRes.ok) return json({ error: `Breeze API error: ${pRes.status}` }, 502);
    let people; try { people = await pRes.json(); } catch { return json({ error: 'Invalid JSON' }, 502); }
    const members = (people || []).filter(p => p.last_name && p.last_name.trim());
    // Collect all field_types and sample values seen across actual member records
    const fieldMap = {};
    for (const p of members.slice(0, 5)) {
      for (const [key, val] of Object.entries(p.details || {})) {
        if (Array.isArray(val)) {
          for (const item of val) {
            if (item && item.field_type) {
              if (!fieldMap[item.field_type]) fieldMap[item.field_type] = { key, samples: [] };
              if (fieldMap[item.field_type].samples.length < 2) fieldMap[item.field_type].samples.push(item);
            }
          }
        } else if (val && typeof val === 'object' && val.name) {
          const ft = 'OBJECT:' + key;
          if (!fieldMap[ft]) fieldMap[ft] = { key, samples: [] };
          if (fieldMap[ft].samples.length < 2) fieldMap[ft].samples.push(val);
        } else if (typeof val === 'string' && val && val !== 'on') {
          const ft = 'STRING:' + key;
          if (!fieldMap[ft]) fieldMap[ft] = { key, samples: [] };
          if (fieldMap[ft].samples.length < 2) fieldMap[ft].samples.push(val);
        }
      }
    }
    // Confirm tag list endpoint
    const tagResults = {};
    try {
      const tr = await fetch(`https://${subdomain}.breezechms.com/api/tags/list_tags`, { headers: hdrs });
      const txt = await tr.text();
      let parsed; try { parsed = JSON.parse(txt); } catch {}
      tagResults['list_tags'] = { status: tr.status, count: Array.isArray(parsed) ? parsed.length : 0, sample: Array.isArray(parsed) ? parsed.slice(0,3) : null, note: 'tag-to-person assignments not available in Breeze REST API' };
    } catch(e) { tagResults['list_tags'] = { error: e.message }; }
    // Find a member WITH a family (non-empty family array)
    let familyMember = null;
    for (const m of members) {
      if (Array.isArray(m.family) && m.family.length > 0) { familyMember = m; break; }
    }
    // If none found in first 50 people, fetch one more page
    if (!familyMember) {
      try {
        const pr2 = await fetch(`https://${subdomain}.breezechms.com/api/people?details=1&limit=50&offset=50`, { headers: hdrs });
        const p2 = await pr2.json();
        for (const m of (p2||[])) {
          if (m.last_name && Array.isArray(m.family) && m.family.length > 0) { familyMember = m; break; }
        }
      } catch {}
    }
    return json({ field_types_in_members: fieldMap, tag_endpoints: tagResults, family_member_sample: familyMember ? { id: familyMember.id, name: familyMember.first_name+' '+familyMember.last_name, family: familyMember.family } : null });
  }

  // ── Breeze Tag-Only Sync ─────────────────────────────────────────
  // Two-phase design to stay under Cloudflare's subrequest limit per invocation:
  //   phase=list  → fetch all tags from Breeze, upsert locally, return tag list
  //   phase=sync  → clear + re-sync ONE tag's members (called once per tag by frontend)
  if (seg === 'import/breeze-sync-tags' && method === 'POST') { try {
    const subdomain = env.BREEZE_SUBDOMAIN;
    const apiKey    = env.BREEZE_API_KEY;
    if (!subdomain || !apiKey) return json({ error: 'Breeze not configured' }, 503);
    let b = {}; try { b = await req.json(); } catch {}
    const phase = b.phase || 'list';

    if (phase === 'list') {
      // Fetch all tags from Breeze and upsert records. Returns tag list for frontend to iterate.
      const tagRes = await fetch(`https://${subdomain}.breezechms.com/api/tags/list_tags`, { headers: { 'Api-key': apiKey } });
      if (!tagRes.ok) return json({ error: `Breeze API error: ${tagRes.status}` }, 502);
      let rawTags; try { rawTags = await tagRes.json(); } catch { return json({ error: 'Invalid JSON from Breeze' }, 502); }
      const allBreezeTags = Array.isArray(rawTags) ? rawTags : [];
      const tags = [];
      for (const t of allBreezeTags) {
        const bId = String(t.id);
        const tName = (t.name || '').trim();
        if (!tName) continue;
        let localId;
        const existing = await db.prepare('SELECT id FROM tags WHERE breeze_id=?').bind(bId).first();
        if (existing) {
          await db.prepare('UPDATE tags SET name=? WHERE breeze_id=?').bind(tName, bId).run();
          localId = existing.id;
        } else {
          const byName = await db.prepare('SELECT id FROM tags WHERE name=? AND (breeze_id="" OR breeze_id IS NULL)').bind(tName).first();
          if (byName) {
            await db.prepare('UPDATE tags SET breeze_id=? WHERE id=?').bind(bId, byName.id).run();
            localId = byName.id;
          } else {
            const r = await db.prepare('INSERT INTO tags (name, breeze_id) VALUES (?,?)').bind(tName, bId).run();
            localId = r.meta?.last_row_id;
          }
        }
        if (localId) tags.push({ breeze_id: bId, local_id: localId, name: tName });
      }
      return json({ ok: true, tags });
    }

    if (phase === 'sync') {
      // Sync a single tag's member assignments. Called once per tag by the frontend loop.
      const bTagId = String(b.tag_id || '');
      const localTagId = b.local_tag_id;
      if (!bTagId || !localTagId) return json({ ok: false, error: 'Missing tag_id or local_tag_id' }, 400);
      // Clear existing assignments so removals in Breeze are reflected locally
      await db.prepare('DELETE FROM person_tags WHERE tag_id=?').bind(localTagId).run();
      // Load all breeze_id→local_id mappings in ONE query to avoid per-person DB round trips
      const allPeople = (await db.prepare(
        `SELECT id, breeze_id FROM people WHERE breeze_id != '' AND breeze_id IS NOT NULL`
      ).all()).results || [];
      const breezeMap = new Map(allPeople.map(r => [String(r.breeze_id), r.id]));
      const filterJson = encodeURIComponent(`{"tag_contains": "y_${bTagId}"}`);
      let assignments = 0, tagOffset = 0;
      const tagLimit = 500;
      while (true) {
        let memText = '';
        try {
          const memRes = await fetch(
            `https://${subdomain}.breezechms.com/api/people?filter_json=${filterJson}&limit=${tagLimit}&offset=${tagOffset}`,
            { headers: { 'Api-key': apiKey } }
          );
          memText = await memRes.text();
        } catch { break; }
        if (!memText || !memText.trim()) break;
        let tagMembers = [];
        try {
          const parsed = JSON.parse(memText);
          tagMembers = Array.isArray(parsed) ? parsed : Object.values(parsed).filter(v => v && v.id);
        } catch { break; }
        if (!tagMembers.length) break;
        // Build insert statements using the in-memory map (no per-person DB calls)
        const insertStmts = [];
        for (const m of tagMembers) {
          const bPersonId = String(m.id || '');
          if (!bPersonId) continue;
          const localId = breezeMap.get(bPersonId);
          if (!localId) continue;
          insertStmts.push(db.prepare('INSERT OR IGNORE INTO person_tags (person_id, tag_id) VALUES (?,?)').bind(localId, localTagId));
          assignments++;
        }
        // Batch inserts in chunks of 100 (D1 batch limit)
        for (let i = 0; i < insertStmts.length; i += 100) {
          await db.batch(insertStmts.slice(i, i + 100));
        }
        if (tagMembers.length < tagLimit) break;
        tagOffset += tagLimit;
      }
      return json({ ok: true, assignments });
    }

    return json({ error: 'Unknown phase' }, 400);
  } catch (e) {
    return json({ ok: false, error: 'Tag sync error: ' + e.message }, 500);
  } }

  // ── Breeze Per-Person Sync ───────────────────────────────────────
  // Forces a demographic re-sync for a single person identified by their Breeze ID.
  // Returns detailed diagnostics: which profile fields matched, raw Breeze values,
  // and what was written to the database — useful for debugging field-mapping issues.
  if (seg === 'import/breeze-sync-person' && method === 'POST') { try {
    const subdomain = env.BREEZE_SUBDOMAIN;
    const apiKey    = env.BREEZE_API_KEY;
    if (!subdomain || !apiKey) return json({ error: 'Breeze not configured (BREEZE_SUBDOMAIN / BREEZE_API_KEY missing)' }, 503);
    let b = {}; try { b = await req.json(); } catch {}
    const breezeId = String(b.breeze_id || '').trim();
    if (!breezeId) return json({ error: 'breeze_id is required' }, 400);

    const hdrs = { 'Api-key': apiKey };

    // Fetch the individual person from Breeze.
    // Try /api/people/{id}?details=1 first (standard RESTful form).
    // Breeze may return a single object OR an array with one element depending on version.
    // Fall back to the list endpoint with a filter if the individual fetch returns no details.
    let p = null;
    let fetchDebug = {};
    {
      const pRes = await fetch(`https://${subdomain}.breezechms.com/api/people/${breezeId}?details=1`, { headers: hdrs });
      fetchDebug.single_status = pRes.status;
      if (pRes.ok) {
        let raw; try { raw = await pRes.json(); } catch { raw = null; }
        fetchDebug.single_type = Array.isArray(raw) ? 'array' : typeof raw;
        // Normalise: handle both single-object and wrapped-array responses
        if (Array.isArray(raw)) p = raw[0] || null;
        else if (raw && raw.id) p = raw;
        else if (raw && raw.person) p = raw.person; // some versions wrap in {person: {...}}
        fetchDebug.single_has_id = !!(p && p.id);
        fetchDebug.single_detail_keys = p ? Object.keys(p.details || {}).length : 0;
      }
    }
    // If individual fetch returned no usable details, try the list endpoint filtered by Breeze ID.
    // This is the same call as the bulk import and is known to include details.
    if (!p || Object.keys(p.details || {}).length === 0) {
      const listRes = await fetch(
        `https://${subdomain}.breezechms.com/api/people?details=1&limit=1&filter_json=${encodeURIComponent(JSON.stringify({person_id:breezeId}))}`,
        { headers: hdrs }
      );
      fetchDebug.list_status = listRes.status;
      if (listRes.ok) {
        let listRaw; try { listRaw = await listRes.json(); } catch { listRaw = null; }
        const arr = Array.isArray(listRaw) ? listRaw : [];
        fetchDebug.list_count = arr.length;
        if (arr.length > 0 && arr[0].id) p = arr[0];
      }
    }
    if (!p || !p.id) return json({ error: 'Person not found in Breeze', breezeId, fetchDebug }, 404);

    // Fetch profile field definitions to discover field IDs
    let profileFields = [];
    try {
      const pr = await fetch(`https://${subdomain}.breezechms.com/api/profile`, { headers: hdrs });
      if (pr.ok) profileFields = await pr.json();
    } catch {}

    // Flatten all fields (same logic as bulk import)
    const allFields = [];
    const extractFieldsPS = (fields) => {
      for (const f of (Array.isArray(fields) ? fields : [])) {
        if (Array.isArray(f.fields) && f.fields.length > 0) extractFieldsPS(f.fields);
        else allFields.push(f);
      }
    };
    for (const section of (Array.isArray(profileFields) ? profileFields : [])) extractFieldsPS(section.fields || []);

    // Smart field finder — same logic as bulk import (prefers date fields in fallback)
    const findFieldPS = (names, fallbackSubstrings = []) => {
      const ns = names.map(n => n.toLowerCase());
      let found = allFields.find(f => ns.includes((f.name||'').toLowerCase()));
      if (!found && fallbackSubstrings.length) {
        found = allFields.find(f => {
          const fn = (f.name||'').toLowerCase();
          return fallbackSubstrings.some(s => fn.includes(s)) && fn.includes('date');
        });
        if (!found) found = allFields.find(f => fallbackSubstrings.some(s => (f.name||'').toLowerCase().includes(s)));
      }
      return found;
    };

    // "Age and Birthdate" is Breeze's built-in age field that also stores birthdate
    const F_DOB_FIELD      = findFieldPS(['birthdate','birth date','dob','date of birth','birthday','age and birthdate','age'], ['birth','birthday','age']);
    const F_BAPTISM_FIELD  = findFieldPS(['baptism date','baptismal date','date of baptism','baptized date','date baptized','baptism (date)','baptism (adult)','baptism (infant)','baptism_date','baptism','baptized'], ['baptism','baptized','baptismal']);
    // "Confirmed" is a dropdown field; "Confirmation Date" is the actual date field — only match date-specific names
    const F_CONFIRM_FIELD  = findFieldPS(['confirmation date','affirmation date','date of confirmation','date affirmed','date confirmed','date of affirmation','affirmation of baptism','confirmation (date)','confirmation_date'], ['confirmation','confirmed','affirm']);
    const F_ANNIV_FIELD    = findFieldPS(['anniversary date','anniversary','anniversary_date','wedding anniversary','wedding date'], ['anniversary','wedding']);
    const F_GENDER_FIELD   = findFieldPS(['gender','sex','gender identity'], ['gender','sex']);
    const F_MARITAL_FIELD    = findFieldPS(['marital status','marital','marriage status','civil status','married']);
    const F_STATUS_FIELD_PS  = findFieldPS(['status','member status','membership status','fellowship status','church status','member type','church membership','congregational status','person status'], ['status','membership']);
    const F_ENVELOPE_FIELD_PS = findFieldPS(['envelope number','envelope','giving number','contribution number'], ['envelope']);
    const F_DEATH_FIELD_PS   = findFieldPS(['death date','date of death','date passed','date deceased'], ['death','passed']);
    const F_DECEASED_FIELD_PS = findFieldPS(['deceased','passed away'], ['deceased']);

    // Use field_id if present — some Breeze instances use a separate field_id as the details key
    const fieldKeyPS = (f) => f ? String(f.field_id || f.id) : '';
    const F_DOB          = fieldKeyPS(F_DOB_FIELD);
    const F_BAPTISM      = fieldKeyPS(F_BAPTISM_FIELD);
    const F_CONFIRMATION = fieldKeyPS(F_CONFIRM_FIELD);
    const F_ANNIVERSARY  = fieldKeyPS(F_ANNIV_FIELD);
    const F_GENDER       = fieldKeyPS(F_GENDER_FIELD);
    const F_MARITAL      = fieldKeyPS(F_MARITAL_FIELD);
    const F_STATUS_PS    = fieldKeyPS(F_STATUS_FIELD_PS);
    const F_ENVELOPE_PS  = fieldKeyPS(F_ENVELOPE_FIELD_PS);
    const F_DEATH_PS     = fieldKeyPS(F_DEATH_FIELD_PS);
    const F_DECEASED_PS  = fieldKeyPS(F_DECEASED_FIELD_PS);
    const BREEZE_TYPE_FIELD_PS = '1076274773';
    const BREEZE_TYPE_NUMS_PS  = { '1': 'Member', '2': 'Attender', '3': 'Visitor' };

    const toISOPS = s => {
      if (!s || typeof s !== 'string') return '';
      const clean = s.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
      const slash = clean.split('/');
      if (slash.length === 3 && slash[2].length === 4)
        return slash[2] + '-' + slash[0].padStart(2,'0') + '-' + slash[1].padStart(2,'0');
      try { const d = new Date(clean); if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10); } catch {}
      return '';
    };
    const extractDatePS = (raw) => {
      if (!raw) return '';
      if (typeof raw === 'string') return raw;
      const obj = Array.isArray(raw) ? raw[0] : raw;
      // Also check birth_date/birthday — Breeze "Age and Birthdate" field returns these keys
      if (obj && typeof obj === 'object') return obj.date || obj.birth_date || obj.birthday || obj.value || obj.name || '';
      return '';
    };
    const optionIdToNamePS = {};
    for (const f of allFields) {
      for (const opt of (Array.isArray(f.options) ? f.options : [])) {
        if (opt.id && opt.name) optionIdToNamePS[String(opt.id)] = opt.name;
      }
    }
    const extractNamePS = (raw) => {
      const obj = Array.isArray(raw) ? raw[0] : raw;
      if (obj && typeof obj === 'object') return obj.name || obj.value || '';
      if (typeof raw === 'string' && raw) return optionIdToNamePS[raw] || raw;
      return '';
    };

    // Load configured member types + map for status resolution
    const mtCfgRowPS = await db.prepare("SELECT value FROM chms_config WHERE key='member_types'").first();
    const configuredMemberTypesPS = mtCfgRowPS ? JSON.parse(mtCfgRowPS.value) : ['Member','Attender','Visitor','Vietnamese Congregation','Other'];
    const mtMapRowPS = await db.prepare("SELECT value FROM chms_config WHERE key='member_type_map'").first();
    const memberTypeMapPS = mtMapRowPS ? JSON.parse(mtMapRowPS.value) : {};

    const details = p.details || {};
    const fn = (p.first_name || '').trim();
    const ln = (p.last_name  || '').trim();

    // Demographic dates, gender, marital
    const dob             = toISOPS(p.birth_date || extractDatePS(details[F_DOB]) || extractDatePS(details['birthdate']) || '');
    const baptismDate     = toISOPS(extractDatePS(details[F_BAPTISM]) || extractDatePS(details['baptism_date']) || extractDatePS(details['baptism']) || '');
    const confirmDate     = toISOPS(extractDatePS(details[F_CONFIRMATION]) || extractDatePS(details['confirmation_date']) || extractDatePS(details['confirmation']) || '');
    const anniversaryDate = toISOPS(extractDatePS(details[F_ANNIVERSARY]) || extractDatePS(details['anniversary_date']) || extractDatePS(details['anniversary']) || '');
    const gender          = (F_GENDER  ? extractNamePS(details[F_GENDER])  : '') || extractNamePS(details['gender'])  || extractNamePS(details['sex']) || '';
    const maritalStatus   = (F_MARITAL ? extractNamePS(details[F_MARITAL]) : '') || extractNamePS(details['marital_status']) || extractNamePS(details['marital']) || '';

    // Deceased + death date
    const deathDateRaw = extractDatePS(details[F_DEATH_PS]) || extractDatePS(details[F_DECEASED_PS]) || '';
    const deathDate    = toISOPS(deathDateRaw);
    const deceasedRaw  = details[F_DECEASED_PS];
    const deceasedFlag = p.deceased ? 1 : deathDate ? 1
      : (deceasedRaw && typeof deceasedRaw === 'string' && deceasedRaw !== '0' && deceasedRaw !== 'false') ? 1
      : (deceasedRaw && typeof deceasedRaw === 'object' && (deceasedRaw.value || deceasedRaw.name)) ? 1 : 0;

    // Envelope number
    const envelopeNumber = F_ENVELOPE_PS ? (extractNamePS(details[F_ENVELOPE_PS]) || extractDatePS(details[F_ENVELOPE_PS]) || '') : (p.envelope_number || '');

    // Status / member type — same 3-step resolution as bulk import
    let statusNamePS = '';
    if (F_STATUS_PS) statusNamePS = extractNamePS(details[F_STATUS_PS]);
    if (!statusNamePS) {
      for (const [dk, val] of Object.entries(details)) {
        if (dk === BREEZE_TYPE_FIELD_PS) continue;
        const candidate = extractNamePS(val);
        if (!candidate) continue;
        const cl = candidate.toLowerCase();
        if (configuredMemberTypesPS.some(t => t.toLowerCase() === cl) || memberTypeMapPS[candidate] || memberTypeMapPS[cl]) {
          statusNamePS = candidate; break;
        }
      }
    }
    if (!statusNamePS && !F_STATUS_FIELD_PS) {
      const builtinRaw = details[BREEZE_TYPE_FIELD_PS];
      if (builtinRaw !== undefined) {
        const bs = extractNamePS(builtinRaw);
        statusNamePS = BREEZE_TYPE_NUMS_PS[bs] || memberTypeMapPS[bs] || memberTypeMapPS[bs.toLowerCase()] || bs;
      }
    }
    const mappedRawPS  = statusNamePS ? (memberTypeMapPS[statusNamePS] || memberTypeMapPS[statusNamePS.toLowerCase()] || null) : null;
    const mappedTypePS = mappedRawPS ? (configuredMemberTypesPS.find(t => t.toLowerCase() === mappedRawPS.toLowerCase()) || mappedRawPS) : null;
    const memberType   = mappedTypePS || (statusNamePS ? configuredMemberTypesPS.find(t => t.toLowerCase() === statusNamePS.toLowerCase()) : null) || '';

    // Contact info from typed detail arrays
    let email = '', phone = '';
    let addr  = { street: '', city: '', state: '', zip: '' };
    for (const val of Object.values(details)) {
      if (!Array.isArray(val)) continue;
      for (const item of val) {
        if (!item || typeof item !== 'object') continue;
        const ft = item.field_type || '';
        if ((ft === 'email_primary' || ft === 'email') && !email) email = (item.address || '').trim();
        else if ((ft === 'phone' || ft.startsWith('phone')) && !phone) phone = (item.phone_number || '').trim();
        else if ((ft === 'address_primary' || ft === 'address') && !addr.street)
          addr = { street: (item.street_address||'').trim(), city: (item.city||'').trim(), state: (item.state||'').trim(), zip: (item.zip||'').trim() };
      }
    }

    // Photo
    const GENERIC_PAT_PS = ['/generic/', 'silhouette', 'no-photo', 'placeholder', 'default-avatar', 'profile-generic'];
    let photoUrl = '';
    const rawPathPS = (typeof p.path === 'string' && p.path) ? p.path : (typeof p.photo === 'string' && p.photo ? p.photo : '');
    if (rawPathPS && !GENERIC_PAT_PS.some(pat => rawPathPS.toLowerCase().includes(pat))) {
      photoUrl = `https://${subdomain}.breezechms.com/${rawPathPS.replace(/^\/+/, '')}`;
    } else if (typeof p.thumb === 'string' && p.thumb.startsWith('https://') &&
               p.thumb.includes('breezechms.com') &&
               !GENERIC_PAT_PS.some(pat => p.thumb.toLowerCase().includes(pat))) {
      photoUrl = p.thumb;
    }

    // Household from p.family — look up by breeze_id only, don't create new from per-person sync
    let familyRole = '', householdId = null;
    if (Array.isArray(p.family) && p.family.length > 0) {
      const selfMember = p.family.find(m => String(m.person_id) === String(p.id));
      if (selfMember) {
        const rn = (selfMember.role_name || '').toLowerCase();
        if (rn.includes('head')) familyRole = 'head';
        else if (rn.includes('spouse') || rn.includes('wife') || rn.includes('husband')) familyRole = 'spouse';
        else if (rn.includes('child') || rn.includes('son') || rn.includes('daughter')) familyRole = 'child';
        else if (rn) familyRole = 'other';
      }
      const bFamilyId = String(p.family[0].family_id || '');
      if (bFamilyId) {
        const hhRow = await db.prepare('SELECT id FROM households WHERE breeze_id=?').bind(bFamilyId).first();
        if (hhRow) householdId = hhRow.id;
      }
    }

    // Find this person in the local DB
    const localPerson = await db.prepare(
      'SELECT id FROM people WHERE breeze_id=?'
    ).bind(breezeId).first();

    if (!localPerson) return json({ ok: false, error: 'Person not found in local database — run a full Breeze import first', fetch_debug: fetchDebug });

    // Full sync — name/contact/member_type always overwrite; dates/photo only update when non-empty
    await db.prepare(
      `UPDATE people SET
       first_name        = CASE WHEN ? != '' THEN ? ELSE first_name        END,
       last_name         = CASE WHEN ? != '' THEN ? ELSE last_name         END,
       email             = CASE WHEN ? != '' THEN ? ELSE email             END,
       phone             = CASE WHEN ? != '' THEN ? ELSE phone             END,
       address1          = CASE WHEN ? != '' THEN ? ELSE address1          END,
       city              = CASE WHEN ? != '' THEN ? ELSE city              END,
       state             = CASE WHEN ? != '' THEN ? ELSE state             END,
       zip               = CASE WHEN ? != '' THEN ? ELSE zip               END,
       member_type       = CASE WHEN ? != '' THEN ? ELSE member_type       END,
       family_role       = CASE WHEN ? != '' THEN ? ELSE family_role       END,
       household_id      = CASE WHEN ? IS NOT NULL THEN ? ELSE household_id END,
       dob               = CASE WHEN ? != '' THEN ? ELSE dob               END,
       baptism_date      = CASE WHEN ? != '' THEN ? ELSE baptism_date      END,
       confirmation_date = CASE WHEN ? != '' THEN ? ELSE confirmation_date END,
       anniversary_date  = CASE WHEN ? != '' THEN ? ELSE anniversary_date  END,
       gender            = CASE WHEN ? != '' THEN ? ELSE gender            END,
       marital_status    = CASE WHEN ? != '' THEN ? ELSE marital_status    END,
       photo_url         = CASE WHEN ? != '' THEN ? ELSE photo_url         END,
       deceased          = CASE WHEN ? = 1 THEN 1 ELSE deceased            END,
       death_date        = CASE WHEN ? != '' THEN ? ELSE death_date        END,
       envelope_number   = CASE WHEN ? != '' THEN ? ELSE envelope_number   END
       WHERE breeze_id=?`
    ).bind(
      fn,fn, ln,ln, email,email, phone,phone,
      addr.street,addr.street, addr.city,addr.city, addr.state,addr.state, addr.zip,addr.zip,
      memberType,memberType, familyRole,familyRole, householdId,householdId,
      dob,dob, baptismDate,baptismDate, confirmDate,confirmDate, anniversaryDate,anniversaryDate,
      gender,gender, maritalStatus,maritalStatus, photoUrl,photoUrl,
      deceasedFlag, deathDate,deathDate, envelopeNumber,envelopeNumber,
      breezeId
    ).run();

    const summary = 'Synced from Breeze:'
      + '\nName: "' + fn + ' ' + ln + '"'
      + '\nEmail: "' + email + '"  Phone: "' + phone + '"'
      + '\nAddress: "' + addr.street + ', ' + addr.city + ', ' + addr.state + ' ' + addr.zip + '"'
      + '\nMember type: "' + memberType + '" (Breeze status: "' + statusNamePS + '")'
      + '\nFamily role: "' + familyRole + '"  Household ID: ' + (householdId || 'none')
      + '\nDOB: "' + dob + '"  Baptism: "' + baptismDate + '"  Confirmation: "' + confirmDate + '"'
      + '\nAnniversary: "' + anniversaryDate + '"  Gender: "' + gender + '"  Marital: "' + maritalStatus + '"'
      + '\nDeceased: ' + deceasedFlag + '  Death date: "' + deathDate + '"'
      + '\nEnvelope: "' + envelopeNumber + '"'
      + '\nPhoto URL: "' + (photoUrl || '(none — p.path=' + (p.path||'') + (p.photo ? ', p.photo='+p.photo : '') + ')') + '"'
      + '\nFetch: single=' + (fetchDebug.single_status||'?') + (fetchDebug.list_status ? ', list='+fetchDebug.list_status : '')
      + '\nProfile fields: ' + allFields.length
      + '\nAll profile field names:\n' + allFields.map(f => '  ' + f.id + ': ' + f.name).join('\n');

    return json({
      ok: true,
      updated: { fn, ln, email, phone, addr, memberType, familyRole, householdId,
                 dob, baptismDate, confirmDate, anniversaryDate, gender, maritalStatus,
                 photoUrl, deceasedFlag, deathDate, envelopeNumber },
      summary
    });
  } catch (syncErr) {
    return json({ ok: false, error: 'Sync error: ' + syncErr.message }, 500);
  } }

  // ── Breeze Import ────────────────────────────────────────────────
  if (seg === 'import/breeze' && method === 'POST') { try {
    const subdomain = env.BREEZE_SUBDOMAIN;
    const apiKey    = env.BREEZE_API_KEY;
    if (!subdomain || !apiKey) return json({ error: 'Breeze not configured (BREEZE_SUBDOMAIN / BREEZE_API_KEY missing)' }, 503);
    let b = {}; try { b = await req.json(); } catch {}
    const offset = parseInt(b.offset || 0);
    const limit  = 100;
    const res = await fetch(
      `https://${subdomain}.breezechms.com/api/people?details=1&limit=${limit}&offset=${offset}`,
      { headers: { 'Api-key': apiKey } }
    );
    if (!res.ok) return json({ error: `Breeze API error: ${res.status}` }, 502);
    let people; try { people = await res.json(); } catch { return json({ error: 'Breeze returned invalid JSON' }, 502); }
    if (!Array.isArray(people)) return json({ done: true, imported: 0, updated: 0, errors: [] });
    // Dynamically discover field IDs from /api/profile
    let profileFields = [];
    try {
      const pr = await fetch(`https://${subdomain}.breezechms.com/api/profile`, { headers: { 'Api-key': apiKey } });
      if (pr.ok) profileFields = await pr.json();
    } catch {}
    // Flatten all fields from all sections (handles Breeze sub-sections up to 2 levels deep)
    const allFields = [];
    const extractFields = (fields) => {
      for (const f of (Array.isArray(fields) ? fields : [])) {
        if (Array.isArray(f.fields) && f.fields.length > 0) {
          // This entry is a sub-section — recurse into it
          extractFields(f.fields);
        } else {
          allFields.push(f);
        }
      }
    };
    for (const section of (Array.isArray(profileFields) ? profileFields : [])) {
      extractFields(section.fields || []);
    }
    const findField = (names, fallbackSubstrings = []) => {
      const ns = names.map(n => n.toLowerCase());
      // 1. Exact name match
      let found = allFields.find(f => ns.includes((f.name||'').toLowerCase()));
      // 2. Substring fallback — prefer fields whose name also contains "date" to avoid
      //    matching notes/checkbox fields (e.g. "Baptism Notes" when seeking baptism date)
      if (!found && fallbackSubstrings.length) {
        found = allFields.find(f => {
          const fn = (f.name||'').toLowerCase();
          return fallbackSubstrings.some(s => fn.includes(s)) && fn.includes('date');
        });
        // 3. Any field containing the fallback substring (last resort)
        if (!found) {
          found = allFields.find(f => fallbackSubstrings.some(s => (f.name||'').toLowerCase().includes(s)));
        }
      }
      return found;
    };
    const F_STATUS_FIELD   = findField(['status','member status','membership status','fellowship status','church status','member type','church membership','congregational status','person status','participation status','attendance status'], ['status','membership']);
    // "Age and Birthdate" is Breeze's built-in age field that also stores birthdate
    const F_DOB_FIELD      = findField(['birthdate','birth date','dob','date of birth','birthday','age and birthdate','age'], ['birth','birthday','age']);
    // LCMS-specific: "Baptismal Date", "Date Baptized", "Baptism (Adult/Infant)"
    const F_BAPTISM_FIELD  = findField(['baptism date','baptismal date','date of baptism','baptized date','date baptized','baptism (date)','baptism (adult)','baptism (infant)','baptism_date','baptism','baptized'], ['baptism','baptized','baptismal']);
    // "Confirmed" is a dropdown; "Confirmation Date" is the date — only match date-specific names exactly
    const F_CONFIRM_FIELD  = findField(['confirmation date','affirmation date','date of confirmation','date affirmed','date confirmed','date of affirmation','affirmation of baptism','confirmation (date)','confirmation_date'], ['confirmation','confirmed','affirm']);
    const F_ANNIV_FIELD    = findField(['anniversary date','anniversary','anniversary_date','wedding anniversary','wedding date'], ['anniversary','wedding']);
    // Gender needs substring fallback — some Breeze instances label it "M/F", "Sex", etc.
    const F_GENDER_FIELD   = findField(['gender','sex','gender identity'], ['gender','sex']);
    const F_MARITAL_FIELD  = findField(['marital status','marital','marriage status','civil status','married']);
    const F_DECEASED_FIELD = findField(['deceased','is deceased','date deceased','date of death','death'], ['deceased','death']);
    const F_DEATH_FIELD    = findField(['death date','date of death','date deceased','died'], ['death date','date of death','died']);
    const F_ENVELOPE_FIELD = findField(['envelope number','envelope #','envelope','giving number','contribution number','giving envelope'], ['envelope']);
    // Use field_id when present — some Breeze instances use a separate field_id as the details key.
    // Fall back to id. Use '' so details[''] is always undefined (never matches a real key).
    const fk = (f) => f ? String(f.field_id || f.id) : '';
    const F_STATUS       = fk(F_STATUS_FIELD);
    const F_DOB          = fk(F_DOB_FIELD);
    const F_BAPTISM      = fk(F_BAPTISM_FIELD);
    const F_CONFIRMATION = fk(F_CONFIRM_FIELD);
    const F_ANNIVERSARY  = fk(F_ANNIV_FIELD);
    const F_GENDER       = fk(F_GENDER_FIELD);
    const F_MARITAL      = fk(F_MARITAL_FIELD);
    const F_DECEASED     = fk(F_DECEASED_FIELD);
    const F_DEATH_DATE   = fk(F_DEATH_FIELD);
    const F_ENVELOPE     = fk(F_ENVELOPE_FIELD);
    // Breeze's built-in person-type field ID (not returned by /api/profile).
    // Values 1/2/3 are Breeze's universal numeric IDs for Member/Attender/Visitor.
    const BREEZE_TYPE_FIELD = '1076274773';
    // Diagnostic: capture sample details from first real person to debug field key mismatches
    let sampleDetailKeys = null;
    let sampleStatusRaw = null;
    let sampleDetailEntries = null;
    let sampleTopLevelKeys = null;
    const firstPerson = people.find(p => p.last_name && p.last_name.trim());
    if (firstPerson && offset === 0) {
      const d0 = firstPerson.details || {};
      sampleDetailKeys = Object.keys(d0).slice(0, 20);
      sampleStatusRaw = F_STATUS ? d0[F_STATUS] : undefined;
      // Capture key→value preview for each detail entry so we can identify the status field
      // Use String(JSON.stringify(v)) to guard against JSON.stringify returning undefined
      // for non-serializable values (which would crash .slice).
      sampleDetailEntries = Object.entries(d0).slice(0, 10).map(([k, v]) => ({
        key: k,
        val: (String(JSON.stringify(v) ?? '')).slice(0, 120)
      }));
      // Also capture the raw built-in person-type field value if present
      const builtinDiagVal = d0[BREEZE_TYPE_FIELD];
      if (builtinDiagVal !== undefined) {
        sampleDetailEntries.unshift({ key: BREEZE_TYPE_FIELD + ' (built-in type)', val: String(JSON.stringify(builtinDiagVal) ?? '').slice(0, 120) });
      }
      // Capture top-level person keys (excluding details/family which are large)
      sampleTopLevelKeys = Object.entries(firstPerson)
        .filter(([k]) => k !== 'details' && k !== 'family')
        .map(([k, v]) => ({ key: k, val: (String(JSON.stringify(v) ?? '')).slice(0, 80) }));
    }
    // Convert MM/DD/YYYY, M/D/YYYY, or YYYY-MM-DD to YYYY-MM-DD
    const toISO = s => {
      if (!s || typeof s !== 'string') return '';
      const clean = s.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
      // M/D/YYYY or MM/DD/YYYY
      const slash = clean.split('/');
      if (slash.length === 3 && slash[2].length === 4)
        return slash[2] + '-' + slash[0].padStart(2,'0') + '-' + slash[1].padStart(2,'0');
      // Try JS Date as last resort (handles "January 1, 2000" etc.)
      try {
        const d = new Date(clean);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      } catch {}
      return '';
    };
    // Load configured member types for direct matching
    const mtCfgRow = await db.prepare("SELECT value FROM chms_config WHERE key='member_types'").first();
    const configuredMemberTypes = mtCfgRow ? JSON.parse(mtCfgRow.value) : ['Member','Attender','Visitor','Vietnamese Congregation','Other'];
    // Load user-defined Breeze status → local member type map
    const mtMapRow = await db.prepare("SELECT value FROM chms_config WHERE key='member_type_map'").first();
    const memberTypeMap = mtMapRow ? JSON.parse(mtMapRow.value) : {};
    // Build option-ID → name map from ALL profile field options (handles numeric option IDs like 1=Member)
    const optionIdToName = {};
    for (const f of allFields) {
      for (const opt of (Array.isArray(f.options) ? f.options : [])) {
        if (opt.id && opt.name) optionIdToName[String(opt.id)] = opt.name;
      }
    }
    // Numeric ID → display name for Breeze's built-in person-type field.
    // Values 1/2/3 are universal; 4 and above are church-specific custom statuses.
    // Unknown numeric IDs pass through as-is so the admin can map them via
    // Settings → Breeze Status Mapping → Member Type Map.
    const BREEZE_TYPE_NUMS  = { '1': 'Member', '2': 'Attender', '3': 'Visitor' };
    // Helper: extract status name from a raw detail value (array, object, or string)
    const extractName = (raw) => {
      const obj = Array.isArray(raw) ? raw[0] : raw;
      if (obj && typeof obj === 'object') return obj.name || obj.value || '';
      if (typeof raw === 'string' && raw) return optionIdToName[raw] || raw;
      return '';
    };
    // No statuses are skipped — all Breeze records are imported regardless of status.
    const SKIP_STATUSES = new Set();
    const statusesSeen = new Set();
    let imported = 0, updated = 0, skipped = 0;
    const errors = [];
    // Track breeze_ids seen this batch; accumulated across batches in chms_config
    // so we can deactivate people removed from Breeze on the final batch.
    const seenBreezeIds = new Set();
    for (const p of people) {
      try {
        const fn = (p.first_name || '').trim();
        const ln = (p.last_name  || '').trim();
        const details = p.details || {};
        // Status / member type — resolution order:
        // 1. Profile-based field ID lookup (custom "status" field from /api/profile) — most accurate
        // 2. Scan all detail values (excluding the built-in type field) for a name matching a
        //    configured member type or the user-defined map
        // 3. Breeze's built-in person-type field (ID 1076274773) — ONLY when no custom status
        //    field was found in the profile at all (some Breeze instances have no custom field).
        //    When a custom field exists but a person has no value, default to 'Other' instead —
        //    the built-in field returns 1=Member for nearly everyone and causes over-counting.
        let statusName = '';
        // 1. Profile-based custom status field
        if (F_STATUS) {
          statusName = extractName(details[F_STATUS]);
        }
        // 2. Scan all detail values for any that look like a configured member type,
        //    but skip the built-in type field key (it maps to Member for most people)
        if (!statusName) {
          for (const [detailKey, val] of Object.entries(details)) {
            if (detailKey === BREEZE_TYPE_FIELD) continue;
            const candidate = extractName(val);
            if (!candidate) continue;
            const cl = candidate.toLowerCase();
            if (configuredMemberTypes.some(t => t.toLowerCase() === cl) ||
                memberTypeMap[candidate] || memberTypeMap[cl]) {
              statusName = candidate;
              break;
            }
          }
        }
        // 3. Built-in type field — only when no custom status field exists in this Breeze instance
        if (!statusName && !F_STATUS_FIELD) {
          const builtinRaw = details[BREEZE_TYPE_FIELD];
          if (builtinRaw !== undefined) {
            const builtinStr = extractName(builtinRaw);
            statusName = BREEZE_TYPE_NUMS[builtinStr]
                      || memberTypeMap[builtinStr]
                      || memberTypeMap[builtinStr.toLowerCase()]
                      || builtinStr;
          }
        }
        if (SKIP_STATUSES.has(statusName.toLowerCase())) { skipped++; continue; }
        if (statusName) statusesSeen.add(statusName);
        // Use user-defined map first, then direct name match, then 'Other'
        // Normalize mappedType against configuredMemberTypes to ensure consistent casing in the DB.
        const mappedRaw = statusName ? (memberTypeMap[statusName] || memberTypeMap[statusName.toLowerCase()] || null) : null;
        const mappedType = mappedRaw ? (configuredMemberTypes.find(t => t.toLowerCase() === mappedRaw.toLowerCase()) || mappedRaw) : null;
        const matched = mappedType || (statusName ? configuredMemberTypes.find(t => t.toLowerCase() === statusName.toLowerCase()) : null);
        // Default to 'Other' when no status found — never fall back to the first configured
        // type (which is typically 'Member'), as that causes blank-status people to be
        // incorrectly imported as members.
        const memberType = matched || 'Other';
        // Dates — Breeze may return as a plain string, an object {date/value:"..."}, or an array.
        // extractDate unwraps all formats before passing to toISO.
        // Also check p.birth_date top-level field which Breeze exposes directly.
        const extractDate = (raw) => {
          if (!raw) return '';
          if (typeof raw === 'string') return raw;
          const obj = Array.isArray(raw) ? raw[0] : raw;
          // Also check birth_date/birthday — Breeze "Age and Birthdate" field returns these keys
          if (obj && typeof obj === 'object') return obj.date || obj.birth_date || obj.birthday || obj.value || obj.name || '';
          return '';
        };
        const dob             = toISO(p.birth_date || extractDate(details[F_DOB]) || extractDate(details['birthdate']) || '');
        const baptismDate     = toISO(extractDate(details[F_BAPTISM])       || extractDate(details['baptism_date'])     || extractDate(details['baptism'])     || '');
        const confirmDate     = toISO(extractDate(details[F_CONFIRMATION])  || extractDate(details['confirmation_date'])|| extractDate(details['confirmation']) || '');
        const anniversaryDate = toISO(extractDate(details[F_ANNIVERSARY])   || extractDate(details['anniversary_date']) || extractDate(details['anniversary'])  || '');
        // Deceased flag and death date — Breeze may store as a checkbox field or date field.
        // Also check p.deceased top-level if Breeze exposes it directly.
        const deathDateRaw = extractDate(details[F_DEATH_DATE]) || extractDate(details[F_DECEASED]) || '';
        const deathDate    = toISO(deathDateRaw);
        // Treat as deceased if: top-level flag, a death date was found, or the deceased field
        // has a truthy non-date value (e.g. checkbox returning "1" or "true").
        const deceasedRaw  = details[F_DECEASED];
        const deceasedFlag = p.deceased ? 1
          : deathDate ? 1
          : (deceasedRaw && typeof deceasedRaw === 'string' && deceasedRaw !== '0' && deceasedRaw !== 'false') ? 1
          : (deceasedRaw && typeof deceasedRaw === 'object' && (deceasedRaw.value || deceasedRaw.name)) ? 1
          : 0;
        // Envelope number (profile field or top-level)
        const envelopeNumber = F_ENVELOPE ? (extractName(details[F_ENVELOPE]) || extractDate(details[F_ENVELOPE]) || '') : (p.envelope_number || '');
        // Gender and marital status — check profile field ID first, then literal keys
        const gender        = (F_GENDER  ? extractName(details[F_GENDER])  : '') || extractName(details['gender'])        || extractName(details['sex'])     || '';
        const maritalStatus = (F_MARITAL ? extractName(details[F_MARITAL]) : '') || extractName(details['marital_status']) || extractName(details['marital']) || '';
        // Photo: build full URL from p.path (relative path on Breeze CDN).
        // p.photo may also carry the relative path; p.thumb is sometimes a full URL.
        // Strip leading slashes from relative paths to avoid double-slash URLs.
        const GENERIC_PAT = ['/generic/', 'silhouette', 'no-photo', 'placeholder', 'default-avatar', 'profile-generic'];
        let photoUrl = '';
        const rawPath = (typeof p.path === 'string' && p.path) ? p.path : (typeof p.photo === 'string' && p.photo ? p.photo : '');
        if (rawPath && !GENERIC_PAT.some(pat => rawPath.toLowerCase().includes(pat))) {
          photoUrl = `https://${subdomain}.breezechms.com/${rawPath.replace(/^\/+/, '')}`;
        } else if (typeof p.thumb === 'string' && p.thumb.startsWith('https://') &&
                   p.thumb.includes('breezechms.com') &&
                   !GENERIC_PAT.some(pat => p.thumb.toLowerCase().includes(pat))) {
          photoUrl = p.thumb;
        }
        // Email, phone, address (from typed arrays)
        let email = '', phone = '';
        let addr = { street: '', city: '', state: '', zip: '' };
        for (const val of Object.values(details)) {
          if (!Array.isArray(val)) continue;
          for (const item of val) {
            if (!item || typeof item !== 'object') continue;
            const ft = item.field_type || '';
            if ((ft === 'email_primary' || ft === 'email') && !email)
              email = (item.address || '').trim();
            else if ((ft === 'phone' || ft.startsWith('phone')) && !phone)
              phone = (item.phone_number || '').trim();
            else if ((ft === 'address_primary' || ft === 'address') && !addr.street)
              addr = { street: (item.street_address||'').trim(), city: (item.city||'').trim(), state: (item.state||'').trim(), zip: (item.zip||'').trim() };
          }
        }
        // Family role + household from p.family array
        let familyRole = '', householdId = null;
        if (Array.isArray(p.family) && p.family.length > 0) {
          const self = p.family.find(m => String(m.person_id) === String(p.id));
          if (self) {
            const rn = (self.role_name || '').toLowerCase();
            if (rn.includes('head')) familyRole = 'head';
            else if (rn.includes('spouse') || rn.includes('wife') || rn.includes('husband')) familyRole = 'spouse';
            else if (rn.includes('child') || rn.includes('son') || rn.includes('daughter')) familyRole = 'child';
            else if (rn) familyRole = 'other';
          }
          // Household: keyed by Breeze family_id
          const bFamilyId = String(p.family[0].family_id || '');
          if (bFamilyId) {
            const hhRow = await db.prepare('SELECT id FROM households WHERE breeze_id=?').bind(bFamilyId).first();
            if (hhRow) {
              householdId = hhRow.id;
            } else {
              // Name from head of household's last name, fallback to this person's last name
              const head = p.family.find(m => (m.role_name||'').toLowerCase().includes('head'));
              const hhName = (head ? (head.details?.last_name || ln) : ln) + ' Family';
              const r = await db.prepare(
                'INSERT INTO households (name, address1, city, state, zip, breeze_id) VALUES (?,?,?,?,?,?)'
              ).bind(hhName, addr.street, addr.city, addr.state, addr.zip, bFamilyId).run();
              householdId = r.meta?.last_row_id;
            }
          }
          // If this person is the head of household and has a photo, update the household photo.
          // Always update (not just when empty) so the household photo stays in sync with Breeze.
          if (householdId && familyRole === 'head' && photoUrl) {
            await db.prepare(
              `UPDATE households SET photo_url=? WHERE id=?`
            ).bind(photoUrl, householdId).run();
          }
        }
        seenBreezeIds.add(String(p.id));
        const existing = await db.prepare('SELECT id FROM people WHERE breeze_id=?').bind(String(p.id)).first();
        if (existing) {
          // Use COALESCE(NULLIF(newVal,''),existingCol) for date + photo fields so that
          // manually-entered data and any values Breeze doesn't return are never wiped.
          // Contact/name/member fields are always overwritten (Breeze is authoritative for those).
          await db.prepare(
            `UPDATE people SET first_name=?,last_name=?,email=?,phone=?,
             address1=?,city=?,state=?,zip=?,member_type=?,household_id=?,
             dob=COALESCE(NULLIF(?,''),dob),
             baptism_date=COALESCE(NULLIF(?,''),baptism_date),
             confirmation_date=COALESCE(NULLIF(?,''),confirmation_date),
             anniversary_date=COALESCE(NULLIF(?,''),anniversary_date),
             family_role=?,
             photo_url=COALESCE(NULLIF(?,''),photo_url),
             gender=COALESCE(NULLIF(?,''),gender),
             marital_status=COALESCE(NULLIF(?,''),marital_status),
             deceased=CASE WHEN ?=1 THEN 1 ELSE deceased END,
             death_date=COALESCE(NULLIF(?,''),death_date),
             envelope_number=COALESCE(NULLIF(?,''),envelope_number),
             active=1
             WHERE breeze_id=?`
          ).bind(fn,ln,email,phone,addr.street,addr.city,addr.state,addr.zip,memberType,householdId,
                 dob,baptismDate,confirmDate,anniversaryDate,familyRole,
                 photoUrl,gender,maritalStatus,deceasedFlag,deathDate,envelopeNumber,String(p.id)).run();
          updated++;
        } else {
          await db.prepare(
            `INSERT INTO people
             (first_name,last_name,email,phone,address1,city,state,zip,breeze_id,member_type,
              household_id,dob,baptism_date,confirmation_date,anniversary_date,family_role,photo_url,
              gender,marital_status,deceased,death_date,envelope_number)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
          ).bind(fn,ln,email,phone,addr.street,addr.city,addr.state,addr.zip,String(p.id),memberType,
                 householdId,dob,baptismDate,confirmDate,anniversaryDate,familyRole,photoUrl,
                 gender,maritalStatus,deceasedFlag,deathDate,envelopeNumber).run();
          imported++;
        }
      } catch (e) { errors.push({ breeze_id: p.id, error: e.message }); }
    }
    const done = people.length < limit;
    // Persist newly-seen Breeze statuses
    if (statusesSeen.size > 0) {
      try {
        const existingSeenRow = await db.prepare("SELECT value FROM chms_config WHERE key='breeze_statuses_seen'").first();
        const existingSeen = existingSeenRow ? new Set(JSON.parse(existingSeenRow.value)) : new Set();
        statusesSeen.forEach(s => existingSeen.add(s));
        await db.prepare("INSERT INTO chms_config(key,value) VALUES('breeze_statuses_seen',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
          .bind(JSON.stringify([...existingSeen])).run();
      } catch {}
    }
    // Accumulate seen breeze_ids across batches so the final batch can deactivate missing people.
    // On first batch (offset===0) we reset the accumulator; on subsequent batches we append.
    let deactivated = 0;
    try {
      const accKey = 'breeze_sync_seen_ids';
      const existing = offset === 0 ? new Set() : new Set(
        JSON.parse((await db.prepare(`SELECT value FROM chms_config WHERE key='${accKey}'`).first())?.value || '[]')
      );
      seenBreezeIds.forEach(id => existing.add(id));
      await db.prepare(`INSERT INTO chms_config(key,value) VALUES('${accKey}',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
        .bind(JSON.stringify([...existing])).run();
      if (done && existing.size > 0) {
        // Deactivate people whose breeze_id was not seen in any batch this run.
        // Correct approach: find the TO-DEACTIVATE set in JS, then chunk with IN (not NOT IN).
        // Using chunked NOT IN on the seen set is wrong — each chunk deactivates everyone
        // outside that small chunk, wiping the entire database.
        const allActivePeople = (await db.prepare(
          `SELECT breeze_id FROM people WHERE active=1 AND breeze_id != '' AND breeze_id IS NOT NULL`
        ).all()).results || [];
        const toDeactivate = allActivePeople.map(r => r.breeze_id).filter(id => !existing.has(id));
        if (toDeactivate.length > 0) {
          const chunkSize = 90;
          for (let ci = 0; ci < toDeactivate.length; ci += chunkSize) {
            const chunk = toDeactivate.slice(ci, ci + chunkSize);
            const idList = chunk.map(() => '?').join(',');
            const r = await db.prepare(
              `UPDATE people SET active=0 WHERE active=1 AND breeze_id IN (${idList})`
            ).bind(...chunk).run();
            deactivated += r.meta?.changes ?? 0;
          }
        }
      }
    } catch {}
    // Propagate anniversary dates within households: if one spouse has the date and the
    // other doesn't, copy it over so both records are consistent.
    let anniversaryPropagated = 0;
    try {
      const ar = await db.prepare(
        `UPDATE people SET anniversary_date=(
           SELECT p2.anniversary_date FROM people p2
           WHERE p2.household_id=people.household_id AND p2.id!=people.id
             AND p2.anniversary_date!='' AND p2.family_role IN ('head','spouse')
           LIMIT 1
         )
         WHERE active=1 AND (anniversary_date='' OR anniversary_date IS NULL)
           AND family_role IN ('head','spouse') AND household_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM people p2 WHERE p2.household_id=people.household_id
               AND p2.id!=people.id AND p2.anniversary_date!=''
               AND p2.family_role IN ('head','spouse')
           )`
      ).run();
      anniversaryPropagated = ar.meta?.changes ?? 0;
    } catch {}
    // Tag sync removed from people import — it times out the Worker when run inline.
    // The frontend auto-triggers runBreezeTagSync() after the final people batch.
    return json({ ok: true, imported, updated, skipped, deactivated, anniversaryPropagated, errors, done, next_offset: offset + people.length, status_field: F_STATUS_FIELD ? { id: F_STATUS_FIELD.id, name: F_STATUS_FIELD.name } : null, statuses_seen: [...statusesSeen], _diag: offset === 0 ? { status_field_id: F_STATUS, dob_field: F_DOB_FIELD ? {id: F_DOB_FIELD.id, name: F_DOB_FIELD.name} : null, baptism_field: F_BAPTISM_FIELD ? {id: F_BAPTISM_FIELD.id, name: F_BAPTISM_FIELD.name} : null, confirmation_field: F_CONFIRM_FIELD ? {id: F_CONFIRM_FIELD.id, name: F_CONFIRM_FIELD.name} : null, deceased_field: F_DECEASED_FIELD ? {id: F_DECEASED_FIELD.id, name: F_DECEASED_FIELD.name} : null, death_date_field: F_DEATH_FIELD ? {id: F_DEATH_FIELD.id, name: F_DEATH_FIELD.name} : null, envelope_field: F_ENVELOPE_FIELD ? {id: F_ENVELOPE_FIELD.id, name: F_ENVELOPE_FIELD.name} : null, sample_detail_keys: sampleDetailKeys, sample_status_raw: sampleStatusRaw, sample_detail_entries: sampleDetailEntries, sample_top_level_keys: sampleTopLevelKeys, all_profile_fields: allFields.map(f=>({id:String(f.id),name:f.name})) } : undefined });
  } catch (importErr) {
    return json({ ok: false, error: 'Bulk import error: ' + importErr.message, _stack: (importErr.stack||'').slice(0, 500) }, 500);
  } }

  return json({ error: 'Not found' }, 404);
}

// ── ChMS SEED DEFAULTS ──────────────────────────────────────────────
