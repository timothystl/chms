// ── ChMS (People & Giving) API handler ────────────────────────────────────────
import { html, json } from './auth.js';

export async function handleChmsApi(req, env, url, method, seg) {
  const db = env.DB;

  // ── Dashboard ────────────────────────────────────────────────────
  if (seg === 'dashboard' && method === 'GET') {
    // Membership counts by type
    const typeCounts = (await db.prepare(
      `SELECT member_type, COUNT(*) as n FROM people WHERE active=1 GROUP BY member_type ORDER BY n DESC`
    ).all()).results || [];
    const totalPeople = typeCounts.reduce(function(s,r){return s+r.n;},0);
    const totalHouseholds = (await db.prepare(`SELECT COUNT(*) as n FROM households`).first())?.n || 0;
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
    // Upcoming birthdays — next 60 days
    const birthdays = (await db.prepare(
      `SELECT id, first_name, last_name, dob FROM people
       WHERE active=1 AND dob != ''
         AND cast(strftime('%j', date(substr(dob,1,4)||'-'||substr(dob,6,2)||'-'||substr(dob,9,2))) as integer)
           BETWEEN cast(strftime('%j','now') as integer)
             AND cast(strftime('%j','now') as integer)+60
       ORDER BY cast(strftime('%m%d', dob) as integer)
       LIMIT 15`
    ).all()).results || [];
    // Recent additions
    const recentPeople = (await db.prepare(
      `SELECT p.id, p.first_name, p.last_name, p.member_type, p.created_at, h.name as household_name
       FROM people p LEFT JOIN households h ON p.household_id=h.id
       WHERE p.active=1 ORDER BY p.created_at DESC LIMIT 10`
    ).all()).results || [];
    // Most recent attendance
    const recentAttendance = (await db.prepare(
      `SELECT service_date, service_name, attendance
       FROM worship_services WHERE attendance > 0
       ORDER BY service_date DESC LIMIT 5`
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
      totalPeople, totalHouseholds, addedThisMonth, addedThisYear,
      typeCounts, givingThisYear, givingLastYear,
      birthdays, recentPeople, recentAttendance,
      followUpItems, firstGivers, notSeenRecently
    });
  }

  // ── People ──────────────────────────────────────────────────────
  if (seg === 'people' && method === 'GET') {
    const q = url.searchParams.get('q') || '';
    const mt = url.searchParams.get('member_type') || '';
    const tagId = url.searchParams.get('tag_id') || '';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const like = '%' + q + '%';
    let where = `p.active=1
      AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.email LIKE ? OR p.phone LIKE ?)`;
    const binds = [like, like, like, like];
    if (mt) { where += ' AND p.member_type=?'; binds.push(mt); }
    if (tagId) { where += ' AND p.id IN (SELECT person_id FROM person_tags WHERE tag_id=?)'; binds.push(tagId); }
    // Total count
    const countRow = await db.prepare(`SELECT COUNT(*) as n FROM people p WHERE ${where}`).bind(...binds).first();
    const total = countRow?.n || 0;
    // Paged results
    const rows = (await db.prepare(
      `SELECT p.*, h.name as household_name FROM people p
       LEFT JOIN households h ON p.household_id=h.id
       WHERE ${where} ORDER BY p.last_name, p.first_name LIMIT ? OFFSET ?`
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
    const people = rows.map(p => ({ ...p, tags: tagsByPerson[p.id] || [] }));
    return json({ people, total, offset, limit });
  }

  if (seg === 'people' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const r = await db.prepare(
      `INSERT INTO people (first_name,last_name,email,phone,address1,address2,city,state,zip,
       member_type,dob,baptism_date,confirmation_date,anniversary_date,death_date,deceased,
       household_id,family_role,photo_url,notes,breeze_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(b.first_name||'',b.last_name||'',b.email||'',b.phone||'',
           b.address1||'',b.address2||'',b.city||'',b.state||'MO',b.zip||'',
           b.member_type||'visitor',b.dob||'',b.baptism_date||'',
           b.confirmation_date||'',b.anniversary_date||'',b.death_date||'',b.deceased?1:0,
           b.household_id||null,b.family_role||'',b.photo_url||'',b.notes||'',b.breeze_id||''
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
      const tags = (await db.prepare(
        `SELECT t.id,t.name,t.color FROM tags t JOIN person_tags pt ON pt.tag_id=t.id WHERE pt.person_id=?`
      ).bind(pid).all()).results || [];
      const giving12 = await db.prepare(
        `SELECT COALESCE(SUM(ge.amount),0) as total FROM giving_entries ge
         JOIN giving_batches gb ON ge.batch_id=gb.id
         WHERE ge.person_id=? AND gb.batch_date >= date('now','-12 months')`
      ).bind(pid).first();
      return json({ ...p, tags, giving_12mo: giving12?.total || 0 });
    }
    if (method === 'PUT') {
      let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      // Capture old values for audit log
      const oldPerson = await db.prepare('SELECT * FROM people WHERE id=?').bind(pid).first();
      await db.prepare(
        `UPDATE people SET first_name=?,last_name=?,email=?,phone=?,address1=?,address2=?,
         city=?,state=?,zip=?,member_type=?,dob=?,baptism_date=?,confirmation_date=?,
         anniversary_date=?,death_date=?,deceased=?,household_id=?,family_role=?,photo_url=?,notes=?,
         public_directory=?,envelope_number=?,last_seen_date=? WHERE id=?`
      ).bind(b.first_name||'',b.last_name||'',b.email||'',b.phone||'',
             b.address1||'',b.address2||'',b.city||'',b.state||'MO',b.zip||'',
             b.member_type||'visitor',b.dob||'',b.baptism_date||'',
             b.confirmation_date||'',b.anniversary_date||'',b.death_date||'',b.deceased?1:0,
             b.household_id||null,b.family_role||'',b.photo_url||'',b.notes||'',
             b.public_directory!=null?(b.public_directory?1:0):1,
             b.envelope_number||'',b.last_seen_date||'',pid
      ).run();
      if (Array.isArray(b.tag_ids)) {
        await db.prepare('DELETE FROM person_tags WHERE person_id=?').bind(pid).run();
        for (const tid of b.tag_ids) {
          try { await db.prepare('INSERT OR IGNORE INTO person_tags(person_id,tag_id) VALUES(?,?)').bind(pid,tid).run(); } catch {}
        }
      }
      // Write audit log entries for changed fields
      if (oldPerson) {
        const personName = [(oldPerson.first_name||b.first_name||''), (oldPerson.last_name||b.last_name||'')].filter(Boolean).join(' ');
        const auditFields = ['first_name','last_name','email','phone','address1','address2','city','state','zip',
          'member_type','dob','baptism_date','confirmation_date','anniversary_date','death_date','deceased',
          'household_id','family_role','notes','public_directory','envelope_number','last_seen_date'];
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
      if (hard) {
        await db.prepare('DELETE FROM person_tags WHERE person_id=?').bind(pid).run();
        await db.prepare('DELETE FROM people WHERE id=?').bind(pid).run();
      } else {
        await db.prepare('UPDATE people SET active=0 WHERE id=?').bind(pid).run();
      }
      return json({ ok: true });
    }
  }

  // ── Households ──────────────────────────────────────────────────
  if (seg === 'households' && method === 'GET') {
    const q = '%' + (url.searchParams.get('q') || '') + '%';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const countRow = await db.prepare(
      `SELECT COUNT(*) as n FROM households h WHERE h.name LIKE ? OR h.address1 LIKE ? OR h.city LIKE ?`
    ).bind(q,q,q).first();
    const total = countRow?.n || 0;
    const rows = (await db.prepare(
      `SELECT h.*, COUNT(p.id) as member_count FROM households h
       LEFT JOIN people p ON p.household_id=h.id AND p.active=1
       WHERE h.name LIKE ? OR h.address1 LIKE ? OR h.city LIKE ?
       GROUP BY h.id ORDER BY h.name LIMIT ? OFFSET ?`
    ).bind(q,q,q,limit,offset).all()).results || [];
    return json({ households: rows, total, offset, limit });
  }

  if (seg === 'households' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const r = await db.prepare(
      `INSERT INTO households (name,address1,address2,city,state,zip,notes) VALUES (?,?,?,?,?,?,?)`
    ).bind(b.name||'',b.address1||'',b.address2||'',b.city||'',b.state||'MO',b.zip||'',b.notes||'').run();
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
      return json({ ...h, members });
    }
    if (method === 'PUT') {
      let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      await db.prepare(
        `UPDATE households SET name=?,address1=?,address2=?,city=?,state=?,zip=?,notes=? WHERE id=?`
      ).bind(b.name||'',b.address1||'',b.address2||'',b.city||'',b.state||'MO',b.zip||'',b.notes||'',hid).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      const count = await db.prepare('SELECT COUNT(*) as n FROM people WHERE household_id=? AND active=1').bind(hid).first();
      if (count?.n > 0) return json({ error: 'Household has active members; reassign them first.' }, 409);
      await db.prepare('DELETE FROM households WHERE id=?').bind(hid).run();
      return json({ ok: true });
    }
  }

  // ── Household address sync ──────────────────────────────────────
  const hhsync = seg.match(/^households\/(\d+)\/sync-address$/);
  if (hhsync && method === 'POST') {
    const hid = parseInt(hhsync[1]);
    let b = {}; try { b = await req.json(); } catch {}
    // Apply address from one person to all active members of household
    await db.prepare(
      `UPDATE people SET address1=?,city=?,state=?,zip=? WHERE household_id=? AND active=1`
    ).bind(b.address1||'',b.city||'',b.state||'MO',b.zip||'',hid).run();
    return json({ ok: true });
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
       GROUP BY service_date ORDER BY service_date DESC`
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
      if (b[k] !== undefined) {
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
    const cutoff = b.cutoff || '2020-01-01';
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
        const existing = await db.prepare(
          `SELECT id FROM church_register WHERE person_id=? AND type='baptism'`
        ).bind(p.id).first();
        if (existing) { skipped++; continue; }
        await stmt.bind(p.baptism_date, ((p.first_name||'')+' '+(p.last_name||'')).trim(), p.dob||'', p.id).run();
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
        const existing = await db.prepare(
          `SELECT id FROM church_register WHERE person_id=? AND type='confirmation'`
        ).bind(p.id).first();
        if (existing) { skipped++; continue; }
        await stmt.bind(p.confirmation_date, ((p.first_name||'')+' '+(p.last_name||'')).trim(), p.dob||'', p.id).run();
        imported++;
      }
    }

    return json({ ok: true, imported, skipped });
  }

  // ── Dev Board (Kanban) ───────────────────────────────────────────
  // ── Directory HTML (for print view) ─────────────────────────────
  if (seg === 'directory' && method === 'GET') {
    const people = (await db.prepare(
      `SELECT p.first_name, p.last_name, p.email, p.phone, p.address1, p.city, p.state, p.zip,
              p.member_type, h.name as household_name
       FROM people p LEFT JOIN households h ON p.household_id=h.id
       WHERE p.active=1 AND p.public_directory=1
       ORDER BY p.last_name, p.first_name`
    ).all()).results || [];
    const e = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const rows = people.map(p => {
      const name = p.last_name || p.first_name
        ? (p.last_name ? e(p.last_name) + (p.first_name ? ', ' + e(p.first_name) : '') : e(p.first_name))
        : '(unnamed)';
      const addr = [p.address1, p.city, ((p.state||'')+(p.zip?' '+p.zip:'')).trim()].filter(Boolean).map(e).join(', ');
      const contact = [addr, p.phone ? e(p.phone) : '', p.email ? e(p.email) : ''].filter(Boolean).join('<br>');
      return `<div class="person"><div class="name">${name}</div>`
        + (p.member_type && p.member_type !== 'visitor' ? `<div class="meta">${e(p.member_type)}</div>` : '')
        + (contact ? `<div class="contact">${contact}</div>` : '')
        + '</div>';
    }).join('');
    const dirHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Church Directory — Timothy Lutheran</title>
<style>
body{font-family:Georgia,serif;font-size:12pt;color:#222;margin:2cm;}
h1{font-size:18pt;margin:0 0 4px;} .subtitle{font-size:10pt;color:#666;margin-bottom:20px;}
.grid{columns:2;column-gap:28px;}
.person{break-inside:avoid;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #ddd;}
.name{font-weight:bold;font-size:11pt;} .meta{font-size:9pt;color:#777;text-transform:capitalize;}
.contact{font-size:9pt;color:#444;margin-top:2px;line-height:1.5;}
@media print{body{margin:1cm;} .no-print{display:none;}}
@media screen{body{max-width:900px;margin:40px auto;padding:0 20px;}}
</style></head><body>
<div class="no-print" style="margin-bottom:20px;display:flex;gap:12px;align-items:center;">
  <button onclick="window.print()" style="padding:8px 18px;background:#1E2D4A;color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer;">Print / Save PDF</button>
  <span style="font-size:13px;color:#666;">${people.length} people listed &nbsp;&bull;&nbsp; Printed ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</span>
</div>
<h1>Church Directory</h1>
<div class="subtitle">Timothy Lutheran Church &nbsp;&bull;&nbsp; ${new Date().toLocaleDateString('en-US',{month:'long',year:'numeric'})}</div>
<div class="grid">${rows || '<p style="color:#999;">No public directory entries found.</p>'}</div>
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
  if (seg === 'import/giving-csv' && method === 'POST') {
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
      batchNum:    col('batch number'),
      batchName:   col('batch name'),
      personId:    col('person id'),
      amount:      col('amount'),
      fund:        col('fund s', 'fund', 'funds'),
      method:      col('method'),
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
    const ops = [];

    // Parse "40085 General Fund: $160.00, 49094 Tuition Aid: $40.00" into per-fund splits
    const parseFundSplits = (fundStr, totalCents) => {
      const s = (fundStr || '').trim();
      if (!s) return [{ name: 'General Fund', cents: totalCents }];
      if (/:\s*\$?[0-9]/.test(s)) {
        const parts = s.split(/,\s*(?=\S)/);
        const splits = [];
        for (const p of parts) {
          const m = p.trim().match(/^((?:\d+\s+)?[^:]+?):\s*\$?([0-9.]+)\s*$/);
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
      if (existingIds.has(pid) || existingIds.has(pid + '-1')) { skipped++; skipDup++; continue; }

      const date      = parseDate(C.date >= 0 ? row[C.date] : '');
      const batchNum  = C.batchNum >= 0  ? (row[C.batchNum]  || '').trim() : '';
      const batchName = C.batchName >= 0 ? (row[C.batchName] || '').trim() : '';
      const personBId = C.personId >= 0  ? (row[C.personId]  || '').trim() : '';
      const amtStr    = (C.amount >= 0   ? row[C.amount]     : '0').replace(/[$, ]/g, '');
      const cents     = Math.round(parseFloat(amtStr || '0') * 100);
      const fundStr   = C.fund >= 0 ? (row[C.fund] || '') : '';
      const method    = payMethod(C.method >= 0 ? row[C.method] : '');
      const checkNum  = C.checkNumber >= 0 ? (row[C.checkNumber] || '') : '';
      const note      = C.note >= 0 ? (row[C.note] || '') : '';

      if (cents <= 0) { skipped++; skipZero++; continue; }

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
        const entryId = isMulti ? pid + '-' + (si + 1) : pid;
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

    return json({ ok: true, imported, skipped, skipBlank, skipDup, skipZero, fundsMade, batchesMade, total: dataRows.length });
  }

  // ── Giving Reset ──────────────────────────────────────────────────
  if (seg === 'giving/all' && method === 'DELETE') {
    await db.batch([
      db.prepare('DELETE FROM giving_entries'),
      db.prepare('DELETE FROM giving_batches'),
    ]);
    return json({ ok: true });
  }

  // ── Prune empty batches ───────────────────────────────────────────
  if (seg === 'giving/prune-empty-batches' && method === 'POST') {
    const r = await db.prepare(
      'DELETE FROM giving_batches WHERE id NOT IN (SELECT DISTINCT batch_id FROM giving_entries)'
    ).run();
    return json({ ok: true, deleted: r.meta?.changes ?? 0 });
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
    return json({ breeze_funds: rows, real_funds: real });
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
  if (seg === 'import/breeze-giving' && method === 'POST') {
    const subdomain = env.BREEZE_SUBDOMAIN;
    const apiKey    = env.BREEZE_API_KEY;
    if (!subdomain || !apiKey) return json({ error: 'Breeze not configured' }, 503);
    let b = {}; try { b = await req.json(); } catch {}
    const start = b.start || (new Date().getFullYear() + '-01-01');
    const end   = b.end   || new Date().toISOString().slice(0, 10);
    const hdrs = { 'Api-key': apiKey };

    // Fetch log entries
    const logUrl = `https://${subdomain}.breezechms.com/api/account/list_log?action=contribution_added&details=1&limit=3000&start=${start}&end=${end}`;
    const logRes = await fetch(logUrl, { headers: hdrs });
    if (!logRes.ok) return json({ error: `Breeze log API error: ${logRes.status}` }, 502);
    let entries; try { entries = await logRes.json(); } catch { return json({ error: 'Invalid JSON from Breeze log' }, 502); }
    if (!Array.isArray(entries)) return json({ error: 'Unexpected response format', raw: String(entries).slice(0,200) }, 502);

    // Also pull from the official /api/giving/list endpoint to catch
    // bulk-imported historical contributions that never appear in the audit log.
    // Normalize to the same shape as audit log entries so the same processing loop handles both.
    let givingListEntries = [];
    try {
      const glUrl = `https://${subdomain}.breezechms.com/api/giving/list?start=${start}&end=${end}&limit=10000`;
      const glRes = await fetch(glUrl, { headers: hdrs });
      if (glRes.ok) {
        const gl = await glRes.json();
        if (Array.isArray(gl)) {
          // Giving list returns one row per gift (possibly with fund splits nested).
          // Normalize to audit-log shape: { id, object_json, details: JSON string }
          for (const g of gl) {
            const id = String(g.id || g.payment_id || '');
            if (!id) continue;
            // Build a details object matching what the audit log parser expects
            const funds = Array.isArray(g.funds) ? g.funds : [];
            const d = { person_id: String(g.person_id || ''), amount: String(g.amount || '0'),
                        method: g.method_type_name || g.method || '', check_number: g.check_number || '',
                        note: g.note || g.notes || '', date: g.date || '', batch_num: g.batch_number || g.batch_num || '' };
            // Embed fund splits as fund-{id}/amount-{id} keys (audit log format)
            if (funds.length > 0) {
              for (const f of funds) {
                const fid = String(f.id || f.fund_id || '');
                if (fid) { d['fund-' + fid] = fid; d['amount-' + fid] = String(f.amount || g.amount || '0'); }
              }
            }
            givingListEntries.push({ id, object_json: id, details: JSON.stringify(d), _from_giving_list: true });
          }
        }
      }
    } catch (e) { /* giving/list is best-effort; audit log is primary */ }

    // Merge: giving list entries first so audit log can overwrite with richer data if same ID appears in both
    const allEntries = [...givingListEntries, ...entries];
    if (allEntries.length === 0) return json({ ok: true, imported: 0, skipped: 0, total: 0, date_range: { start, end } });

    // Helpers
    const parseDetails = raw => { try { return JSON.parse(raw); } catch { return null; } };
    const extractFunds = (d, total) => {
      const lines = [];
      for (const [key, fid] of Object.entries(d)) {
        if (!key.startsWith('fund-') || !fid) continue;
        const uuid = key.slice(5);
        const splitAmt = uuid ? d['amount-' + uuid] : null;
        lines.push({ breezeFundId: String(fid), amount: (splitAmt && parseFloat(splitAmt) > 0) ? splitAmt : total });
      }
      return lines.length > 0 ? lines : [{ breezeFundId: 'default', amount: total }];
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

    // ── Pre-load caches to avoid per-row DB round trips ──────────────
    // Existing contribution IDs → skip set
    const existingIds = new Set(
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
    // Funds: breeze_id → local id
    const fundByBreezeId = {};
    for (const f of (await db.prepare('SELECT id, breeze_id FROM funds WHERE breeze_id != ""').all()).results || [])
      fundByBreezeId[f.breeze_id] = f.id;

    // ── Process entries, collect inserts ─────────────────────────────
    let imported = 0, skipped = 0;
    const errors = [];
    const entryInserts = []; // deferred until all lookups done

    for (const entry of allEntries) {
      try {
        const contribId = String(entry.object_json || entry.id);
        if (existingIds.has(contribId)) { skipped++; continue; }
        const d = parseDetails(entry.details);
        if (!d) { skipped++; continue; }

        const personId   = personByBreezeId[String(d.person_id || '')] ?? null;
        const method     = payMethod(d.method);
        const checkNum   = d.check_number || '';
        const notes      = d.note || '';
        const date       = parseDate(d.date);
        const batchKey   = d.batch_num ? `Breeze Batch #${d.batch_num}` : `Breeze Import ${date}`;

        // Get or create batch (sequential since we need the ID)
        if (!batchByDesc[batchKey]) {
          const r = await db.prepare(
            'INSERT INTO giving_batches (batch_date, description, closed) VALUES (?,?,1)'
          ).bind(date, batchKey).run();
          batchByDesc[batchKey] = r.meta?.last_row_id;
        } else {
          // Update batch_date if it was set to wrong date (e.g. from a prior sync using range start)
          await db.prepare(
            "UPDATE giving_batches SET batch_date=? WHERE id=? AND (batch_date='' OR batch_date=?)"
          ).bind(date, batchByDesc[batchKey], start).run();
        }
        const batchId = batchByDesc[batchKey];

        for (const fl of extractFunds(d, d.amount || '0')) {
          const cents = Math.round(parseFloat(fl.amount || '0') * 100);
          if (!fundByBreezeId[fl.breezeFundId]) {
            const fname = fl.breezeFundId === 'default' ? 'General Fund' : `Breeze Fund ${fl.breezeFundId}`;
            const r = await db.prepare(
              'INSERT INTO funds (name, breeze_id, active, sort_order) VALUES (?,?,1,99)'
            ).bind(fname, fl.breezeFundId).run();
            fundByBreezeId[fl.breezeFundId] = r.meta?.last_row_id;
          }
          entryInserts.push(
            db.prepare(
              `INSERT INTO giving_entries (batch_id,person_id,fund_id,amount,method,check_number,notes,breeze_id,contribution_date)
               VALUES (?,?,?,?,?,?,?,?,?)`
            ).bind(batchId, personId, fundByBreezeId[fl.breezeFundId], cents, method, checkNum, notes, contribId, date)
          );
        }
        imported++;
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

    return json({ ok: true, imported, skipped, errors: errors.slice(0, 20), total: allEntries.length, from_log: entries.length, from_giving_list: givingListEntries.length, date_range: { start, end } });
  }

  // ── Breeze Giving CSV Import ─────────────────────────────────────
  // Accepts the TSV export from Breeze (Contributions > Export)
  // Fund(s) format: "40085 General Fund" or "40085 General Fund (160.00), 49094 Tuition Aid (40.00)"
  if (seg === 'import/breeze-giving-csv' && method === 'POST') {
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
    for (const f of (await db.prepare('SELECT id, breeze_id FROM funds WHERE breeze_id != ""').all()).results || [])
      fundByBreezeId[f.breeze_id] = f.id;

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
            // Use the real fund name from the CSV, not a generic placeholder
            const fname = fl.fundName || `Breeze Fund ${fl.breezeFundId}`;
            const r = await db.prepare('INSERT INTO funds (name, breeze_id, active, sort_order) VALUES (?,?,1,99)')
              .bind(fname, fl.breezeFundId).run();
            fundByBreezeId[fl.breezeFundId] = r.meta?.last_row_id;
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
  }

  // ── Clear Bad Tag Assignments ─────────────────────────────────────
  if (seg === 'import/clear-person-tags' && method === 'POST') {
    const r = await db.prepare('DELETE FROM person_tags').run();
    return json({ ok: true, deleted: r.meta?.changes ?? 0 });
  }

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

  // ── Breeze Import ────────────────────────────────────────────────
  if (seg === 'import/breeze' && method === 'POST') {
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
    const findField = (names) => {
      const ns = names.map(n => n.toLowerCase());
      return allFields.find(f => ns.includes((f.name||'').toLowerCase()));
    };
    const F_STATUS_FIELD   = findField(['status','member status','membership status','fellowship status','church status','member type','church membership','congregational status','person status','participation status','attendance status']);
    const F_DOB_FIELD      = findField(['birthdate','birth date','dob','date of birth','birthday']);
    const F_BAPTISM_FIELD  = findField(['baptism date','baptism','baptism_date','date of baptism','baptized']);
    const F_CONFIRM_FIELD  = findField(['confirmation date','confirmation','confirmation_date','date of confirmation','confirmed']);
    const F_ANNIV_FIELD    = findField(['anniversary date','anniversary','anniversary_date','wedding anniversary','wedding date']);
    // Use empty string as fallback so details[''] is always undefined — never accidentally match a real field
    const F_STATUS       = F_STATUS_FIELD  ? String(F_STATUS_FIELD.id)  : '';
    const F_DOB          = F_DOB_FIELD     ? String(F_DOB_FIELD.id)     : '';
    const F_BAPTISM      = F_BAPTISM_FIELD ? String(F_BAPTISM_FIELD.id) : '';
    const F_CONFIRMATION = F_CONFIRM_FIELD ? String(F_CONFIRM_FIELD.id) : '';
    const F_ANNIVERSARY  = F_ANNIV_FIELD   ? String(F_ANNIV_FIELD.id)   : '';
    // Diagnostic: capture sample details from first real person to debug field key mismatches
    let sampleDetailKeys = null;
    let sampleStatusRaw = null;
    let sampleDetailEntries = null;
    const firstPerson = people.find(p => p.last_name && p.last_name.trim());
    if (firstPerson && offset === 0) {
      const d0 = firstPerson.details || {};
      sampleDetailKeys = Object.keys(d0).slice(0, 20);
      sampleStatusRaw = F_STATUS ? d0[F_STATUS] : undefined;
      // Capture key→value preview for each detail entry so we can identify the status field
      sampleDetailEntries = Object.entries(d0).slice(0, 10).map(([k, v]) => ({
        key: k,
        val: JSON.stringify(v).slice(0, 120)
      }));
    }
    // Convert MM/DD/YYYY or YYYY-MM-DD to YYYY-MM-DD
    const toISO = s => {
      if (!s) return '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const parts = s.split('/');
      if (parts.length === 3) return parts[2] + '-' + parts[0].padStart(2,'0') + '-' + parts[1].padStart(2,'0');
      return '';
    };
    // Load configured member types for direct matching
    const mtCfgRow = await db.prepare("SELECT value FROM chms_config WHERE key='member_types'").first();
    const configuredMemberTypes = mtCfgRow ? JSON.parse(mtCfgRow.value) : ['Member','Attender','Visitor','Vietnamese Congregation','Other'];
    // Load user-defined Breeze status → local member type map
    const mtMapRow = await db.prepare("SELECT value FROM chms_config WHERE key='member_type_map'").first();
    const memberTypeMap = mtMapRow ? JSON.parse(mtMapRow.value) : {};
    // Skip non-person status types
    const SKIP_STATUSES = new Set(['organization','christmas market','egg hunt','renter','mdo']);
    const statusesSeen = new Set();
    let imported = 0, updated = 0, skipped = 0;
    const errors = [];
    for (const p of people) {
      try {
        const fn = (p.first_name || '').trim();
        const ln = (p.last_name  || '').trim();
        const details = p.details || {};
        // Status / member type — Breeze returns as object, array, or string
        const statusRaw = details[F_STATUS];
        const statusObj = Array.isArray(statusRaw) ? statusRaw[0] : statusRaw;
        const statusName = (statusObj && statusObj.name) ? statusObj.name
                         : (typeof statusRaw === 'string' ? statusRaw : '');
        if (SKIP_STATUSES.has(statusName.toLowerCase())) { skipped++; continue; }
        if (statusName) statusesSeen.add(statusName);
        // Use user-defined map first, then direct name match, then 'Other'
        const mappedType = statusName ? (memberTypeMap[statusName] || memberTypeMap[statusName.toLowerCase()] || null) : null;
        const matched = mappedType || (statusName ? configuredMemberTypes.find(t => t.toLowerCase() === statusName.toLowerCase()) : null);
        const memberType = matched || (configuredMemberTypes.includes('Other') ? 'Other' : configuredMemberTypes[0] || 'Other');
        // Dates (stored as plain strings under their field ID key)
        const dob          = toISO(details[F_DOB]          || details['birthdate'] || '');
        const baptismDate  = toISO(details[F_BAPTISM]       || '');
        const confirmDate  = toISO(details[F_CONFIRMATION]  || '');
        const anniversaryDate = toISO(details[F_ANNIVERSARY] || '');
        // Photo (Breeze returns thumb at top level)
        const photoUrl = (p.thumb || p.thumbnail || p.photo || '').trim();
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
        }
        const existing = await db.prepare('SELECT id FROM people WHERE breeze_id=?').bind(String(p.id)).first();
        if (existing) {
          await db.prepare(
            `UPDATE people SET first_name=?,last_name=?,email=?,phone=?,
             address1=?,city=?,state=?,zip=?,member_type=?,household_id=?,
             dob=?,baptism_date=?,confirmation_date=?,anniversary_date=?,family_role=?,photo_url=?
             WHERE breeze_id=?`
          ).bind(fn,ln,email,phone,addr.street,addr.city,addr.state,addr.zip,memberType,householdId,
                 dob,baptismDate,confirmDate,anniversaryDate,familyRole,photoUrl,String(p.id)).run();
          updated++;
        } else {
          await db.prepare(
            `INSERT INTO people
             (first_name,last_name,email,phone,address1,city,state,zip,breeze_id,member_type,
              household_id,dob,baptism_date,confirmation_date,anniversary_date,family_role,photo_url)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
          ).bind(fn,ln,email,phone,addr.street,addr.city,addr.state,addr.zip,String(p.id),memberType,
                 householdId,dob,baptismDate,confirmDate,anniversaryDate,familyRole,photoUrl).run();
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
    // On the final batch, sync tags and tag assignments from Breeze
    let tagsSynced = 0, tagAssignments = 0;
    if (done) {
      try {
        // 1. Fetch all tags
        const tagRes = await fetch(`https://${subdomain}.breezechms.com/api/tags/list_tags`, { headers: { 'Api-key': apiKey } });
        const tagText = await tagRes.text();
        let allTags = [];
        try { allTags = JSON.parse(tagText); } catch {}
        if (Array.isArray(allTags)) {
          for (const t of allTags) {
            const bId = String(t.id);
            const tName = (t.name || '').trim();
            if (!tName) continue;
            const existing = await db.prepare('SELECT id FROM tags WHERE breeze_id=?').bind(bId).first();
            if (existing) {
              await db.prepare('UPDATE tags SET name=? WHERE breeze_id=?').bind(tName, bId).run();
            } else {
              // Check by name in case it was created manually
              const byName = await db.prepare('SELECT id FROM tags WHERE name=? AND (breeze_id="" OR breeze_id IS NULL)').bind(tName).first();
              if (byName) {
                await db.prepare('UPDATE tags SET breeze_id=? WHERE id=?').bind(bId, byName.id).run();
              } else {
                await db.prepare('INSERT INTO tags (name, breeze_id) VALUES (?,?)').bind(tName, bId).run();
              }
            }
            tagsSynced++;
          }
          // 2. Tag-to-person assignments using filter_json with y_ prefix (Breeze quirk)
          for (const t of allTags) {
            const bTagId = String(t.id);
            const tagRow = await db.prepare('SELECT id FROM tags WHERE breeze_id=?').bind(bTagId).first();
            if (!tagRow) continue;
            const localTagId = tagRow.id;
            // Breeze requires y_ prefix + space after colon in filter_json
            const filterJson = encodeURIComponent(`{"tag_contains": "y_${bTagId}"}`);
            let tagOffset = 0;
            const tagLimit = 500;
            while (true) {
              const memRes = await fetch(
                `https://${subdomain}.breezechms.com/api/people?filter_json=${filterJson}&limit=${tagLimit}&offset=${tagOffset}`,
                { headers: { 'Api-key': apiKey } }
              );
              const memText = await memRes.text();
              if (!memText || !memText.trim()) break;
              let tagMembers = [];
              try {
                const parsed = JSON.parse(memText);
                // Breeze may return array or numbered object
                tagMembers = Array.isArray(parsed) ? parsed : Object.values(parsed);
              } catch { break; }
              if (!tagMembers.length) break;
              for (const m of tagMembers) {
                if (!m.last_name || !m.last_name.trim()) continue;
                const bPersonId = String(m.id || '');
                if (!bPersonId) continue;
                const personRow = await db.prepare('SELECT id FROM people WHERE breeze_id=?').bind(bPersonId).first();
                if (!personRow) continue;
                try {
                  await db.prepare('INSERT OR IGNORE INTO person_tags (person_id, tag_id) VALUES (?,?)').bind(personRow.id, localTagId).run();
                  tagAssignments++;
                } catch {}
              }
              if (tagMembers.length < tagLimit) break;
              tagOffset += tagLimit;
            }
          }
        }
      } catch (e) { errors.push({ tag_sync_error: e.message }); }
    }
    return json({ ok: true, imported, updated, skipped, errors, done, next_offset: offset + people.length, tags_synced: tagsSynced, tag_assignments: tagAssignments, status_field: F_STATUS_FIELD ? { id: F_STATUS_FIELD.id, name: F_STATUS_FIELD.name } : null, statuses_seen: [...statusesSeen], _diag: offset === 0 ? { status_field_id: F_STATUS, sample_detail_keys: sampleDetailKeys, sample_status_raw: sampleStatusRaw, sample_detail_entries: sampleDetailEntries, all_profile_fields: allFields.map(f=>({id:String(f.id),name:f.name})) } : undefined });
  }

  return json({ error: 'Not found' }, 404);
}

// ── ChMS SEED DEFAULTS ──────────────────────────────────────────────
