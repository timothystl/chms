// ── Households, Organizations, Tags, Funds API handlers ──────────────────────
import { json } from './auth.js';
import { disambiguateHHName } from './api-utils.js';

// `role` is appended LAST deliberately: SW4 was a real bug caused by this function being called
// with more arguments than its signature declared, so a value silently landed in the wrong slot.
// Adding at the end means every existing positional argument keeps its meaning.
export async function handleHouseholdsApi(req, env, url, method, seg, db, isAdmin, canEdit, role) {

  // ── Households ────────────────────────────────────────────────────
  if (seg === 'households' && method === 'GET') {
    const q = '%' + (url.searchParams.get('q') || '') + '%';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const sort = url.searchParams.get('sort') || 'name';
    const hhMemberTypeRaw = (url.searchParams.get('member_type') || '').toLowerCase().trim();
    const validMemberTypes = ['member','visitor','regular_attender','friend'];
    const hhMemberType = validMemberTypes.includes(hhMemberTypeRaw) ? hhMemberTypeRaw : '';
    const orderBy = sort === 'members_desc' ? 'member_count DESC, h.name'
                  : sort === 'members_asc'  ? 'member_count ASC, h.name'
                  : 'h.name';
    // HV1: optional member-type filter — only show households with ≥1 person of the given type
    const mtSubquery = hhMemberType
      ? `AND h.id IN (SELECT household_id FROM people WHERE active=1 AND LOWER(member_type)=? AND household_id IS NOT NULL AND household_id != '')`
      : '';
    const countBinds = hhMemberType ? [q,q,q,hhMemberType] : [q,q,q];
    const countRow = await db.prepare(
      `SELECT COUNT(*) as n FROM households h WHERE (h.name LIKE ? OR h.address1 LIKE ? OR h.city LIKE ?) ${mtSubquery}`
    ).bind(...countBinds).first();
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
    ).bind(...(hhMemberType ? [q,q,q,hhMemberType,limit,offset] : [q,q,q,limit,offset])).all()).results || [];
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
        `SELECT id,first_name,last_name,member_type,family_role,phone,email,photo_url,envelope_number,anniversary_date FROM people WHERE household_id=? AND active=1 ORDER BY family_role,last_name`
      ).bind(hid).all()).results || [];
      // Household-level envelope # / anniversary: prefer the head of household, else any member with a value set.
      const headMember = members.find(m => m.family_role === 'head') || members[0] || {};
      const envelope_number = headMember.envelope_number || (members.find(m => m.envelope_number) || {}).envelope_number || '';
      const anniversary_date = headMember.anniversary_date || (members.find(m => m.anniversary_date) || {}).anniversary_date || '';
      // HQ4: compute display_name if another household shares this name
      let display_name = h.name;
      if (h.name) {
        const dup = await db.prepare(`SELECT COUNT(*) as n FROM households WHERE LOWER(name)=LOWER(?) AND id!=?`).bind(h.name, hid).first();
        if (dup?.n > 0) {
          const head = members.find(m => m.family_role === 'head') || members[0];
          if (head?.first_name) display_name = disambiguateHHName(h.name, head.first_name);
        }
      }
      // Member-role viewers get the family-chip essentials and nothing else. Returning the
      // full shape here would hand a member this household's giving history, envelope number,
      // anniversary, private household notes, and every member's phone/email regardless of
      // their own dir_hide_* opt-outs — none of which memberSafeView would ever have let
      // through on the person endpoints. The early return also skips the giving query
      // entirely rather than running it and discarding the result.
      if (role === 'member') {
        return json({
          id: h.id,
          name: h.name || '',
          display_name,
          photo_url: h.photo_url || '',
          members: members.map((m) => ({
            id: m.id,
            first_name: m.first_name || '',
            last_name: m.last_name || '',
            photo_url: m.photo_url || '',
            member_type: m.member_type || '',
          })),
        });
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
      return json({ ...h, members, display_name, giving_years: givingYears, envelope_number, anniversary_date });
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
    // Fetch best candidate per headless household in one query (spouse preferred, else min id)
    const hhIds = headless.map(h => h.id);
    let fixed = 0;
    if (hhIds.length) {
      const ph = hhIds.map(() => '?').join(',');
      const candidates = (await db.prepare(
        `SELECT household_id,
                COALESCE(MIN(CASE WHEN family_role='spouse' THEN id END), MIN(id)) AS best_id
         FROM people WHERE household_id IN (${ph}) AND active=1
         GROUP BY household_id`
      ).bind(...hhIds).all()).results || [];
      const updateStmts = candidates
        .filter(r => r.best_id)
        .map(r => db.prepare(`UPDATE people SET family_role='head' WHERE id=?`).bind(r.best_id));
      if (updateStmts.length) {
        await db.batch(updateStmts);
        fixed = updateStmts.length;
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

  // ── Copy a household member's photo into the household record ─────
  const hhUseMember = seg.match(/^households\/(\d+)\/use-member-photo$/);
  if (hhUseMember && method === 'POST') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    const hid = parseInt(hhUseMember[1]);
    let b = {}; try { b = await req.json(); } catch {}
    const memberId = parseInt(b.member_id || 0);
    if (!memberId) return json({ error: 'member_id required' }, 400);
    const m = await db.prepare(
      'SELECT photo_url FROM people WHERE id=? AND household_id=? AND active=1'
    ).bind(memberId, hid).first();
    if (!m) return json({ error: 'Member not found in this household' }, 404);
    if (!m.photo_url) return json({ error: 'That member has no photo' }, 400);
    await db.prepare('UPDATE households SET photo_url=? WHERE id=?').bind(m.photo_url, hid).run();
    return json({ ok: true, photo_url: m.photo_url });
  }

  // ── Apply household photo to members (per-household) ─────────────
  // Mirror of sync-address: only members with NO photo get the household photo,
  // never clobbering an individual's manual-upload or Breeze-synced photo.
  // Smart fallback: if the household has no photo but its head does, the
  // head's photo is promoted to the household first, then cascaded.
  const hhApplyPhoto = seg.match(/^households\/(\d+)\/apply-photo-to-members$/);
  if (hhApplyPhoto && method === 'POST') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    const hid = parseInt(hhApplyPhoto[1]);
    const hh = await db.prepare('SELECT photo_url FROM households WHERE id=?').bind(hid).first();
    if (!hh) return json({ error: 'Household not found' }, 404);
    let photoUrl = hh.photo_url || '';
    if (!photoUrl) {
      const head = await db.prepare(
        `SELECT photo_url FROM people
         WHERE household_id=? AND family_role='head' AND active=1
           AND COALESCE(photo_url,'') != '' LIMIT 1`
      ).bind(hid).first();
      if (head && head.photo_url) {
        photoUrl = head.photo_url;
        await db.prepare('UPDATE households SET photo_url=? WHERE id=?').bind(photoUrl, hid).run();
      }
    }
    if (!photoUrl) return json({ ok: false, error: 'No photo on household or head of household' }, 400);
    const r = await db.prepare(
      `UPDATE people SET photo_url=?
       WHERE household_id=? AND active=1 AND COALESCE(photo_url,'')=''`
    ).bind(photoUrl, hid).run();
    return json({ ok: true, updated: r.meta?.changes ?? 0 });
  }

  // ── Apply household photo to members (all households, admin) ─────
  // Two-pass: (1) backfill household.photo_url from head's photo where the
  // household has none, then (2) cascade to members with empty photo_url.
  if (seg === 'households/apply-photo-to-members-all' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Admin only' }, 403);
    await db.prepare(
      `UPDATE households
         SET photo_url = (
           SELECT photo_url FROM people
            WHERE household_id = households.id
              AND family_role='head' AND active=1
              AND COALESCE(photo_url,'') != ''
            LIMIT 1
         )
       WHERE COALESCE(photo_url,'') = ''
         AND EXISTS (
           SELECT 1 FROM people
            WHERE household_id = households.id
              AND family_role='head' AND active=1
              AND COALESCE(photo_url,'') != ''
         )`
    ).run();
    const r = await db.prepare(
      `UPDATE people
         SET photo_url = (SELECT h.photo_url FROM households h WHERE h.id = people.household_id)
       WHERE active=1
         AND COALESCE(photo_url,'')=''
         AND household_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM households h
            WHERE h.id = people.household_id
              AND COALESCE(h.photo_url,'') != ''
         )`
    ).run();
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
    // Gift count/total per fund — lets the Manage Funds screen show which funds are actually
    // safe to deactivate (0 gifts, e.g. leftover placeholder Breeze funds) vs. ones with history.
    const stats = (await db.prepare(
      `SELECT fund_id, COUNT(*) cnt, COALESCE(SUM(amount),0) total_cents FROM giving_entries GROUP BY fund_id`
    ).all()).results || [];
    const statMap = new Map(stats.map(s => [s.fund_id, s]));
    const funds = rows.map(f => {
      const s = statMap.get(f.id) || { cnt: 0, total_cents: 0 };
      return { ...f, entry_count: s.cnt, total_cents: s.total_cents };
    });
    return json({ funds });
  }
  if (seg === 'funds' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied' }, 403);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const r = await db.prepare(
      `INSERT INTO funds (name,description,active,sort_order) VALUES (?,?,?,?)`
    ).bind(b.name||'New Fund',b.description||'',b.active==null?1:b.active?1:0,b.sort_order||0).run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }
  const fundmatch = seg.match(/^funds\/(\d+)$/);
  if (fundmatch) {
    if (method === 'PUT') {
      if (!isAdmin) return json({ error: 'Access denied' }, 403);
      let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      // budget_annual_cents is optional: only overwrite it when the caller sends it, so a plain
      // name/active edit from the Manage Funds card never clobbers a budget set elsewhere.
      if (b.budget_annual_cents != null) {
        const budget = Math.max(0, Math.round(Number(b.budget_annual_cents) || 0));
        await db.prepare(`UPDATE funds SET name=?,description=?,active=?,sort_order=?,budget_annual_cents=? WHERE id=?`)
          .bind(b.name||'',b.description||'',b.active?1:0,b.sort_order||0,budget,parseInt(fundmatch[1])).run();
      } else {
        await db.prepare(`UPDATE funds SET name=?,description=?,active=?,sort_order=? WHERE id=?`)
          .bind(b.name||'',b.description||'',b.active?1:0,b.sort_order||0,parseInt(fundmatch[1])).run();
      }
      return json({ ok: true });
    }
  }

  // ── Duplicate fund finder + merge (admin only) ──────────────────────
  if (seg === 'funds/duplicates' && method === 'GET') {
    if (!isAdmin) return json({ error: 'Access denied' }, 403);
    const funds = (await db.prepare('SELECT * FROM funds ORDER BY name,id').all()).results || [];
    const stats = (await db.prepare(
      `SELECT fund_id, COUNT(*) cnt, COALESCE(SUM(amount),0) total_cents
       FROM giving_entries GROUP BY fund_id`
    ).all()).results || [];
    const statMap = new Map(stats.map(s => [s.fund_id, s]));
    const groups = new Map();
    for (const f of funds) {
      const key = (f.name || '').trim().toLowerCase();
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      const s = statMap.get(f.id) || { cnt: 0, total_cents: 0 };
      groups.get(key).push({
        id: f.id, name: f.name, description: f.description, active: !!f.active,
        breeze_id: f.breeze_id || '', sort_order: f.sort_order,
        entry_count: s.cnt, total_cents: s.total_cents
      });
    }
    const duplicates = [...groups.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([, rows]) => {
        const sorted = rows.sort((a, b) => b.total_cents - a.total_cents);
        return { name: sorted[0].name, funds: sorted };
      });
    // Possible duplicates: different names, same leading numeric fund code (e.g.
    // "25010 Concordia Children's Services" / "25010 Concordia Children – Distribution Check").
    // Grouped separately (not auto-merged) since the names genuinely differ and a human
    // needs to confirm they're really the same fund before merging.
    const prefixGroups = new Map();
    for (const f of funds) {
      const m = /^(\d{4,})\b/.exec((f.name || '').trim());
      if (!m) continue;
      const prefix = m[1];
      if (!prefixGroups.has(prefix)) prefixGroups.set(prefix, []);
      const s = statMap.get(f.id) || { cnt: 0, total_cents: 0 };
      prefixGroups.get(prefix).push({
        id: f.id, name: f.name, description: f.description, active: !!f.active,
        breeze_id: f.breeze_id || '', sort_order: f.sort_order,
        entry_count: s.cnt, total_cents: s.total_cents
      });
    }
    const possible_duplicates = [...prefixGroups.entries()]
      .filter(([, rows]) => rows.length > 1 && new Set(rows.map(r => r.name.trim().toLowerCase())).size > 1)
      .map(([prefix, rows]) => {
        const sorted = rows.sort((a, b) => b.total_cents - a.total_cents);
        return { prefix, funds: sorted };
      });
    return json({ duplicates, possible_duplicates });
  }
  if (seg === 'funds/merge' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied' }, 403);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const keepId = parseInt(b.keep_id);
    const removeIds = Array.isArray(b.remove_ids) ? b.remove_ids.map(x => parseInt(x)).filter(Number.isInteger) : [];
    if (!Number.isInteger(keepId) || !removeIds.length || removeIds.includes(keepId)) {
      return json({ error: 'Invalid keep_id/remove_ids' }, 400);
    }
    const keepFund = await db.prepare('SELECT id FROM funds WHERE id=?').bind(keepId).first();
    if (!keepFund) return json({ error: 'keep_id fund not found' }, 404);
    let movedEntries = 0;
    for (const rid of removeIds) {
      const r = await db.prepare('UPDATE giving_entries SET fund_id=? WHERE fund_id=?').bind(keepId, rid).run();
      movedEntries += r.meta?.changes || 0;
      await db.prepare('DELETE FROM funds WHERE id=?').bind(rid).run();
    }
    await db.prepare(
      `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value) VALUES(?,?,?,?,?,?,?)`
    ).bind('merge_funds', 'fund', keepId, '', 'merged_from',
           JSON.stringify(removeIds), String(movedEntries)).run();
    return json({ ok: true, moved_entries: movedEntries });
  }

  return null; // not handled — caller should return 404
}
