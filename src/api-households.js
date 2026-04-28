// ── Households, Organizations, Tags, Funds API handlers ──────────────────────
import { json } from './auth.js';
import { disambiguateHHName } from './api-utils.js';

export async function handleHouseholdsApi(req, env, url, method, seg, db, isAdmin, canEdit) {

  // ── Households ────────────────────────────────────────────────────
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
  // Returns both rows from the `organizations` table AND people whose
  // member_type is 'organization' — those person-records are otherwise
  // hidden from the People list, so without this the user can't see them.
  // Each row carries a `source` of 'org' or 'person' so the frontend can
  // route edits to the correct modal/endpoint.
  if (seg === 'organizations' && method === 'GET') {
    const q = url.searchParams.get('q') || '';
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const limit = parseInt(url.searchParams.get('limit') || '25');
    const showInactive = url.searchParams.get('inactive') === '1';
    const orgActive = showInactive ? '' : 'AND o.active=1';
    const personActive = showInactive ? '' : "AND p.active=1 AND p.status NOT IN ('archived','deceased')";
    const like = `%${q}%`;

    const unionSql = `
      SELECT 'org' AS source, o.id AS id, o.name AS name, o.type AS type,
             o.contact_name AS contact_name, o.phone AS phone, o.email AS email,
             o.website AS website, o.address1 AS address1, o.address2 AS address2,
             o.city AS city, o.state AS state, o.zip AS zip, o.notes AS notes,
             o.active AS active
      FROM organizations o
      WHERE (o.name LIKE ? OR o.contact_name LIKE ? OR o.city LIKE ?) ${orgActive}
      UNION ALL
      SELECT 'person' AS source, p.id AS id, p.first_name AS name,
             '' AS type,
             '' AS contact_name, p.phone AS phone, p.email AS email,
             '' AS website, p.address1 AS address1, p.address2 AS address2,
             p.city AS city, p.state AS state, p.zip AS zip, p.notes AS notes,
             p.active AS active
      FROM people p
      WHERE LOWER(p.member_type)='organization'
        AND (p.first_name LIKE ? OR p.city LIKE ?) ${personActive}
    `;

    const [countRow, listRows] = await Promise.all([
      db.prepare(
        `SELECT (
          (SELECT COUNT(*) FROM organizations o WHERE (o.name LIKE ? OR o.contact_name LIKE ? OR o.city LIKE ?) ${orgActive})
          +
          (SELECT COUNT(*) FROM people p WHERE LOWER(p.member_type)='organization' AND (p.first_name LIKE ? OR p.city LIKE ?) ${personActive})
        ) AS n`
      ).bind(like, like, like, like, like).first(),
      db.prepare(`SELECT * FROM (${unionSql}) ORDER BY name LIMIT ? OFFSET ?`)
        .bind(like, like, like, like, like, limit, offset).all()
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

  return null; // not handled — caller should return 404
}
