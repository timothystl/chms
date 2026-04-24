// ── People, Follow-up, Archive, Brevo Sync, Photos API handlers ────────────
import { json } from './auth.js';
import { brevoUpsertContact, brevoBulkSync, brevoGetListContacts } from './api-emails.js';
import { disambiguateHHName } from './api-utils.js';

export async function handlePeopleApi(req, env, url, method, seg, db, isAdmin, isFinance, isStaff, canEdit) {

// ── People ──────────────────────────────────────────────────────
if (seg === 'people' && method === 'GET') {
  const q = url.searchParams.get('q') || '';
  const mt = url.searchParams.get('member_type') || '';
  const tagId = url.searchParams.get('tag_id') || '';
  const tagIdsRaw = url.searchParams.get('tag_ids') || '';
  const archivedView = url.searchParams.get('archived') === '1';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const SORT_COLS = { last_name: 'p.last_name', first_name: 'p.first_name', member_type: 'p.member_type', created_at: 'p.created_at', household: 'h.name' };
  const sortCol = SORT_COLS[url.searchParams.get('sort') || ''] || 'p.last_name';
  const sortDir = url.searchParams.get('dir') === 'desc' ? 'DESC' : 'ASC';
  const like = '%' + q + '%';
  let where;
  const binds = [like, like, like, like];
  if (archivedView) {
    where = `p.status IN ('archived','deceased') AND LOWER(p.member_type) != 'organization'
      AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.email LIKE ? OR p.phone LIKE ?)`;
  } else {
    where = `p.active=1 AND (p.status IS NULL OR p.status='active') AND LOWER(p.member_type) != 'organization'
      AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.email LIKE ? OR p.phone LIKE ?)`;
  }
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
  // FU2: auto-set first_contact_date = today for new manually-added people
  // (not imported from Breeze — those keep their Breeze-supplied dates or blank).
  // Explicit empty string in body overrides the auto-default.
  let firstContactDate = b.first_contact_date;
  if (firstContactDate === undefined || firstContactDate === null) {
    firstContactDate = b.breeze_id ? '' : new Date().toISOString().slice(0,10);
  }
  const r = await db.prepare(
    `INSERT INTO people (first_name,last_name,email,phone,address1,address2,city,state,zip,
     member_type,dob,baptism_date,confirmation_date,anniversary_date,death_date,deceased,
     household_id,family_role,photo_url,notes,breeze_id,gender,marital_status,first_contact_date,sms_opt_in)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(b.first_name||'',b.last_name||'',b.email||'',b.phone||'',
         b.address1||'',b.address2||'',b.city||'',b.state||'MO',b.zip||'',
         b.member_type||'visitor',b.dob||'',b.baptism_date||'',
         b.confirmation_date||'',b.anniversary_date||'',b.death_date||'',b.deceased?1:0,
         b.household_id||null,b.family_role||'',b.photo_url||'',b.notes||'',b.breeze_id||'',
         b.gender||'',b.marital_status||'', firstContactDate||'', b.sms_opt_in?1:0
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
       dir_hide_address=?,dir_hide_phone=?,dir_hide_email=?,baptized=?,confirmed=?,sms_opt_in=? WHERE id=?`
    ).bind(b.first_name||'',b.last_name||'',b.email||'',b.phone||'',
           b.address1||'',b.address2||'',b.city||'',b.state||'MO',b.zip||'',
           b.member_type||'visitor',b.dob||'',b.baptism_date||'',
           b.confirmation_date||'',b.anniversary_date||'',b.death_date||'',b.deceased?1:0,
           b.household_id||null,b.family_role||'',b.photo_url||'',b.notes||'',
           b.public_directory!=null?(b.public_directory?1:0):1,
           b.envelope_number||'',b.last_seen_date||'',b.gender||'',b.marital_status||'',
           b.dir_hide_address?1:0, b.dir_hide_phone?1:0, b.dir_hide_email?1:0,
           b.baptized?1:0, b.confirmed?1:0, b.sms_opt_in?1:0, pid
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
    // Auto-sync to Brevo if email changed and person is a member
    const newEmail = (b.email || '').trim().toLowerCase();
    const oldEmail = (oldPerson?.email || '').trim().toLowerCase();
    if (newEmail && newEmail !== oldEmail && (b.member_type || '').toLowerCase() === 'member') {
      brevoUpsertContact(env, b.email.trim(), b.first_name || '', b.last_name || '').catch(() => {});
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

// ── Archive / unarchive / deceased ──────────────────────────────────
const archiveMatch = seg.match(/^people\/(\d+)\/(archive|unarchive|deceased)$/);
if (archiveMatch && method === 'POST') {
  if (!canEdit) return json({ error: 'Access denied' }, 403);
  const pid = parseInt(archiveMatch[1]);
  const action = archiveMatch[2];
  const person = await db.prepare('SELECT * FROM people WHERE id=?').bind(pid).first();
  if (!person) return json({ error: 'Person not found' }, 404);

  if (action === 'archive') {
    await db.prepare(`UPDATE people SET status='archived', active=0 WHERE id=?`).bind(pid).run();
    await db.prepare(`INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
      VALUES('update','person',?,?,?,'active','archived')`
    ).bind(pid, `${person.first_name} ${person.last_name}`, 'status').run();
  } else if (action === 'unarchive') {
    await db.prepare(`UPDATE people SET status='active', active=1, deceased=0 WHERE id=?`).bind(pid).run();
    await db.prepare(`INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
      VALUES('update','person',?,?,?,'archived','active')`
    ).bind(pid, `${person.first_name} ${person.last_name}`, 'status').run();
  } else if (action === 'deceased') {
    if (!isAdmin && !isStaff) return json({ error: 'Access denied' }, 403);
    const today = new Date().toISOString().slice(0, 10);
    await db.prepare(`UPDATE people SET status='deceased', deceased=1, death_date=?, active=0 WHERE id=?`)
      .bind(today, pid).run();
    await db.prepare(`INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
      VALUES('update','person',?,?,?,'active','deceased')`
    ).bind(pid, `${person.first_name} ${person.last_name}`, 'status').run();
    // If this person was the household head, promote spouse or first remaining active member
    if (person.household_id && person.family_role === 'head') {
      const members = (await db.prepare(
        `SELECT id, family_role FROM people
         WHERE household_id=? AND id!=? AND active=1 AND (status IS NULL OR status='active')
         ORDER BY CASE family_role WHEN 'spouse' THEN 0 ELSE 1 END, id`
      ).bind(person.household_id, pid).all()).results || [];
      if (members.length > 0) {
        await db.prepare(`UPDATE people SET family_role='head' WHERE id=?`).bind(members[0].id).run();
      }
    }
  }
  return json({ ok: true });
}

// ── Brevo newsletter sync (EM1) ──────────────────────────────────────────
if (seg === 'brevo/sync-contact' && method === 'POST') {
  if (!isStaff) return json({ error: 'Access denied' }, 403);
  let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!b.email) return json({ error: 'email required' }, 400);
  const result = await brevoUpsertContact(env, b.email, b.first_name || '', b.last_name || '');
  return json(result);
}

if (seg === 'brevo/bulk-sync' && method === 'POST') {
  if (!isAdmin) return json({ error: 'Access denied' }, 403);
  const members = (await db.prepare(
    `SELECT first_name, last_name, email FROM people
     WHERE active=1 AND (status IS NULL OR status='active')
       AND LOWER(member_type)='member' AND email != ''`
  ).all()).results || [];
  if (!members.length) return json({ ok: true, count: 0, message: 'No members with email addresses found.' });
  const result = await brevoBulkSync(env, members.map(m => ({ email: m.email, firstName: m.first_name, lastName: m.last_name })));
  return json(result);
}

if (seg === 'brevo/reconcile' && method === 'GET') {
  if (!isAdmin) return json({ error: 'Access denied' }, 403);
  const members = (await db.prepare(
    `SELECT id, first_name, last_name, email FROM people
     WHERE active=1 AND (status IS NULL OR status='active')
       AND LOWER(member_type)='member' AND email != ''
     ORDER BY last_name, first_name`
  ).all()).results || [];
  const brevoResult = await brevoGetListContacts(env);
  if (!brevoResult.ok) return json({ error: brevoResult.error }, 502);
  const brevoSet = new Set(brevoResult.emails);
  const chmsSet = new Set(members.map(m => m.email.toLowerCase()));
  const missingFromBrevo = members.filter(m => !brevoSet.has(m.email.toLowerCase()));
  const inBrevoNotChms = brevoResult.emails.filter(e => !chmsSet.has(e));
  return json({
    chms_member_count: members.length,
    brevo_list_count: brevoResult.emails.length,
    missing_from_brevo: missingFromBrevo,
    in_brevo_not_chms: inBrevoNotChms,
  });
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

// ── Households / Organizations / Tags / Funds → api-households.js ──
if (seg.startsWith('households') || seg.startsWith('organizations') ||
    seg.startsWith('tags') || seg.startsWith('funds')) {
  const result = await handleHouseholdsApi(req, env, url, method, seg, db, isAdmin, canEdit);
  if (result !== null) return result;
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

  return null; // not handled
}
