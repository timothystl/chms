// ── Reports, Engagement, Prayer API handlers ─────────────────────────────────
import { json } from './auth.js';
import { makeBreezeClient } from './breeze.js';
import { isoWeekKey } from './api-utils.js';

export async function handleReportsApi(req, env, url, method, seg, db, isAdmin, isFinance, isStaff, canEdit) {

// ── Reports ──────────────────────────────────────────────────────
if (seg === 'reports/people-insights' && method === 'GET') {
  const scope = url.searchParams.get('scope') || 'member'; // 'member' | 'active'
  const scopeWhere = scope === 'member'
    ? `status='active' AND LOWER(member_type)='member'`
    : `status='active' AND LOWER(member_type) != 'organization'`;

  const now = new Date();
  // 24-month window start (first day of month 24 months ago)
  const cutoff24mo = new Date(now.getFullYear() - 2, now.getMonth(), 1).toISOString().slice(0, 10);
  const cutoff5yr  = String(now.getFullYear() - 4);

  const [
    newContactsRaw,
    typeTrendRaw,
    ageRows,
    genderRows,
    hhSizeRaw,
    pipelineRows,
    noHHRow,
  ] = await Promise.all([
    // New contacts by month (last 24 months) — use first_contact_date, fall back to created_at
    db.prepare(
      `SELECT substr(COALESCE(NULLIF(first_contact_date,''), created_at), 1, 7) AS month,
              COUNT(*) AS n
       FROM people
       WHERE ${scopeWhere}
         AND COALESCE(NULLIF(first_contact_date,''), created_at) >= ?
       GROUP BY month ORDER BY month ASC`
    ).bind(cutoff24mo).all().then(r => r.results || []),

    // Member-type by year of first contact (last 5 years)
    db.prepare(
      `SELECT substr(COALESCE(NULLIF(first_contact_date,''), created_at), 1, 4) AS year,
              member_type, COUNT(*) AS n
       FROM people
       WHERE ${scopeWhere}
         AND substr(COALESCE(NULLIF(first_contact_date,''), created_at), 1, 4) >= ?
       GROUP BY year, member_type ORDER BY year ASC, n DESC`
    ).bind(cutoff5yr).all().then(r => r.results || []),

    // Age distribution
    db.prepare(
      `SELECT CASE
         WHEN dob='' OR dob IS NULL THEN 'unknown'
         WHEN (julianday('now')-julianday(dob))/365.25 < 18 THEN 'under_18'
         WHEN (julianday('now')-julianday(dob))/365.25 < 30 THEN 'a18_29'
         WHEN (julianday('now')-julianday(dob))/365.25 < 45 THEN 'a30_44'
         WHEN (julianday('now')-julianday(dob))/365.25 < 65 THEN 'a45_64'
         ELSE 'a65_plus'
       END AS age_group, COUNT(*) AS n
       FROM people
       WHERE ${scopeWhere}
       GROUP BY age_group`
    ).all().then(r => r.results || []),

    // Gender
    db.prepare(
      `SELECT CASE WHEN gender='' OR gender IS NULL THEN 'Unknown' ELSE gender END AS g,
              COUNT(*) AS n
       FROM people
       WHERE ${scopeWhere}
       GROUP BY g ORDER BY n DESC`
    ).all().then(r => r.results || []),

    // Household sizes
    db.prepare(
      `SELECT household_id, COUNT(*) AS size
       FROM people
       WHERE ${scopeWhere} AND household_id IS NOT NULL AND household_id != 0
       GROUP BY household_id`
    ).all().then(r => r.results || []),

    // Baptism/confirmation pipeline (always members only)
    db.prepare(
      `SELECT baptized, confirmed, COUNT(*) AS n
       FROM people
       WHERE status='active' AND LOWER(member_type)='member'
       GROUP BY baptized, confirmed`
    ).all().then(r => r.results || []),

    // People with no household
    db.prepare(
      `SELECT COUNT(*) AS n FROM people
       WHERE ${scopeWhere}
         AND (household_id IS NULL OR household_id = 0)`
    ).first(),
  ]);

  // Build household size buckets
  const hhBuckets = { single: 0, couple: 0, small: 0, large: 0 };
  for (const r of hhSizeRaw) {
    const s = r.size || 0;
    if (s === 1)       hhBuckets.single++;
    else if (s === 2)  hhBuckets.couple++;
    else if (s <= 4)   hhBuckets.small++;
    else               hhBuckets.large++;
  }
  hhBuckets.no_household = noHHRow?.n || 0;

  // Sacramental pipeline
  const pipeline = { neither: 0, baptized_only: 0, confirmed_only: 0, both: 0 };
  for (const r of pipelineRows) {
    const b = r.baptized ? 1 : 0, c = r.confirmed ? 1 : 0;
    if (!b && !c) pipeline.neither += r.n;
    else if (b && !c) pipeline.baptized_only += r.n;
    else if (!b && c) pipeline.confirmed_only += r.n;
    else pipeline.both += r.n;
  }

  // Normalise age groups into ordered array
  const ageOrder = [
    { key: 'under_18', label: 'Under 18' }, { key: 'a18_29', label: '18–29' },
    { key: 'a30_44',   label: '30–44' },    { key: 'a45_64', label: '45–64' },
    { key: 'a65_plus', label: '65+' },       { key: 'unknown', label: 'Unknown (no DOB)' },
  ];
  const ageMap = {};
  for (const r of ageRows) ageMap[r.age_group] = r.n || 0;
  const ageBuckets = ageOrder.map(a => ({ ...a, n: ageMap[a.key] || 0 }));

  return json({
    scope,
    new_contacts: newContactsRaw,
    member_type_trend: typeTrendRaw,
    age_groups: ageBuckets,
    gender: genderRows,
    household_sizes: hhBuckets,
    sacramental_pipeline: pipeline,
  });
}

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
  // R1: Age-group breakdown (only among active, non-organization)
  const ageSql = `
    SELECT
      CASE
        WHEN dob = '' OR dob IS NULL THEN 'unknown'
        WHEN (julianday('now') - julianday(dob)) / 365.25 < 18 THEN 'under_18'
        WHEN (julianday('now') - julianday(dob)) / 365.25 < 30 THEN 'a18_29'
        WHEN (julianday('now') - julianday(dob)) / 365.25 < 45 THEN 'a30_44'
        WHEN (julianday('now') - julianday(dob)) / 365.25 < 65 THEN 'a45_64'
        ELSE 'a65_plus'
      END AS age_group,
      COUNT(*) AS n
    FROM people
    WHERE status='active' AND LOWER(member_type) != 'organization'
    GROUP BY age_group`;
  const ageRows = (await db.prepare(ageSql).all()).results || [];
  const ageMap = {};
  for (const r of ageRows) ageMap[r.age_group] = r.n || 0;
  const ageBuckets = [
    { key: 'under_18', label: 'Under 18', n: ageMap.under_18 || 0 },
    { key: 'a18_29',   label: '18–29',    n: ageMap.a18_29   || 0 },
    { key: 'a30_44',   label: '30–44',    n: ageMap.a30_44   || 0 },
    { key: 'a45_64',   label: '45–64',    n: ageMap.a45_64   || 0 },
    { key: 'a65_plus', label: '65+',      n: ageMap.a65_plus || 0 },
    { key: 'unknown',  label: 'Unknown (no DOB)', n: ageMap.unknown || 0 },
  ];
  return json({ counts, total, tag_counts: tagCounts, age_groups: ageBuckets });
}

// ── Engagement review queue (DC1/DB9) ───────────────────────────────
// Returns a small weekly batch of stale visitor/friend records for triage:
// archive, engage, promote, or dismiss. Goal: process the whole DB over a year.
if (seg === 'engagement/review-queue' && method === 'GET') {
  const limit     = Math.min(parseInt(url.searchParams.get('limit') || '5', 10) || 5, 50);
  const maxAgeDays = parseInt(url.searchParams.get('stale_days') || '365', 10) || 365;
  const rows = (await db.prepare(
    `SELECT id, first_name, last_name, member_type, email, phone, created_at,
            last_reviewed_at, last_seen_date, first_contact_date,
            (SELECT MAX(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date))
               FROM giving_entries ge
               JOIN giving_batches gb ON gb.id = ge.batch_id
               WHERE ge.person_id = people.id) AS last_gift_date
     FROM people
     WHERE status='active'
       AND LOWER(member_type) NOT IN ('member','organization','')
       AND (last_reviewed_at = ''
            OR date(last_reviewed_at) < date('now', '-' || ? || ' days'))
     ORDER BY CASE WHEN last_reviewed_at = '' THEN 0 ELSE 1 END,
              last_reviewed_at ASC,
              created_at ASC
     LIMIT ?`
  ).bind(maxAgeDays, limit).all()).results || [];
  const totalPending = (await db.prepare(
    `SELECT COUNT(*) AS n FROM people
     WHERE status='active'
       AND LOWER(member_type) NOT IN ('member','organization','')
       AND (last_reviewed_at = ''
            OR date(last_reviewed_at) < date('now', '-' || ? || ' days'))`
  ).bind(maxAgeDays).first())?.n || 0;
  return json({ people: rows, total_pending: totalPending, stale_days: maxAgeDays });
}

// Mark a person as reviewed (sets last_reviewed_at = today). Editors+ only.
if (seg === 'engagement/mark-reviewed' && method === 'POST') {
  if (!canEdit) return json({ error: 'Access denied' }, 403);
  let b = {}; try { b = await req.json(); } catch {}
  const pid = parseInt(b.person_id, 10);
  if (!pid) return json({ error: 'person_id required' }, 400);
  await db.prepare(`UPDATE people SET last_reviewed_at = date('now') WHERE id = ?`).bind(pid).run();
  return json({ ok: true });
}

// ── New-contact follow-up queue (FU2) ────────────────────────────────
// Non-members with a first_contact_date set and followup_status != 'done',
// newest-first. Feeds the dashboard "New Contacts" card.
if (seg === 'engagement/followup-queue' && method === 'GET') {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 100);
  const rows = (await db.prepare(
    `SELECT id, first_name, last_name, member_type, email, phone,
            first_contact_date, followup_status, followup_notes, created_at
     FROM people
     WHERE status='active'
       AND first_contact_date != ''
       AND (followup_status IS NULL OR followup_status != 'done')
       AND LOWER(member_type) NOT IN ('member','organization')
     ORDER BY first_contact_date DESC, id DESC
     LIMIT ?`
  ).bind(limit).all()).results || [];
  const total = (await db.prepare(
    `SELECT COUNT(*) AS n FROM people
     WHERE status='active'
       AND first_contact_date != ''
       AND (followup_status IS NULL OR followup_status != 'done')
       AND LOWER(member_type) NOT IN ('member','organization')`
  ).first())?.n || 0;
  return json({ people: rows, total });
}

// Update follow-up state on a person. Editors+ only.
// Body: { person_id, followup_status?, followup_notes?, first_contact_date? }
if (seg === 'engagement/update-followup' && method === 'POST') {
  if (!canEdit) return json({ error: 'Access denied' }, 403);
  let b = {}; try { b = await req.json(); } catch {}
  const pid = parseInt(b.person_id, 10);
  if (!pid) return json({ error: 'person_id required' }, 400);
  const sets = [], binds = [];
  if (b.followup_status !== undefined) {
    const allowed = ['', 'new', 'in_progress', 'done'];
    if (!allowed.includes(b.followup_status)) return json({ error: 'Invalid followup_status' }, 400);
    sets.push('followup_status = ?'); binds.push(b.followup_status);
  }
  if (b.followup_notes !== undefined) {
    sets.push('followup_notes = ?'); binds.push(String(b.followup_notes).slice(0, 2000));
  }
  if (b.first_contact_date !== undefined) {
    const fcd = String(b.first_contact_date || '');
    if (fcd && !/^\d{4}-\d{2}-\d{2}$/.test(fcd)) return json({ error: 'Invalid first_contact_date' }, 400);
    sets.push('first_contact_date = ?'); binds.push(fcd);
  }
  if (!sets.length) return json({ error: 'Nothing to update' }, 400);
  binds.push(pid);
  await db.prepare(`UPDATE people SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return json({ ok: true });
}

// ── Weekly engagement task checklist ────────────────────────────────
// GET  /admin/api/engagement/tasks?week=YYYY-MM-DD
// POST /admin/api/engagement/tasks  { title, link_url?, week_key }
// PUT  /admin/api/engagement/tasks/:id  { completed?, title?, link_url? }
// DELETE /admin/api/engagement/tasks/:id
if (seg === 'engagement/tasks' && method === 'GET') {
  if (!canEdit) return json({ error: 'Access denied' }, 403);
  const currentWeekKey = isoWeekKey();
  const weekKey = url.searchParams.get('week') || currentWeekKey;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) return json({ error: 'Invalid week format' }, 400);
  let tasks = (await db.prepare(
    'SELECT * FROM engagement_tasks WHERE week_key=? ORDER BY sort_order, id'
  ).bind(weekKey).all()).results || [];

  // Auto-seed the current week when it has no tasks yet.
  // Copy from the prior week if it had tasks; otherwise seed hardcoded defaults.
  if (tasks.length === 0 && weekKey === currentWeekKey) {
    const priorDate = new Date(weekKey + 'T12:00:00Z');
    priorDate.setUTCDate(priorDate.getUTCDate() - 7);
    const priorKey  = priorDate.toISOString().slice(0, 10);
    const priorRows = (await db.prepare(
      'SELECT title, link_url FROM engagement_tasks WHERE week_key=? ORDER BY sort_order, id'
    ).bind(priorKey).all()).results || [];

    const seeds = priorRows.length > 0
      ? priorRows.map(function(t) { return { title: t.title, link_url: t.link_url || '' }; })
      : [
          { title: 'Pray for people prayer cards', link_url: '' },
          { title: 'Work through member list',     link_url: '' },
        ];

    await db.batch(seeds.map(function(s, i) {
      return db.prepare('INSERT INTO engagement_tasks(title,link_url,week_key,sort_order) VALUES(?,?,?,?)')
        .bind(s.title, s.link_url, weekKey, i);
    }));
    tasks = (await db.prepare(
      'SELECT * FROM engagement_tasks WHERE week_key=? ORDER BY sort_order, id'
    ).bind(weekKey).all()).results || [];
  }

  return json({ tasks, week_key: weekKey });
}
if (seg === 'engagement/tasks' && method === 'POST') {
  if (!canEdit) return json({ error: 'Access denied' }, 403);
  let b = {}; try { b = await req.json(); } catch {}
  const title = String(b.title || '').trim().slice(0, 200);
  if (!title) return json({ error: 'title required' }, 400);
  const weekKey = String(b.week_key || isoWeekKey());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) return json({ error: 'Invalid week_key' }, 400);
  const linkUrl = String(b.link_url || '').slice(0, 500);
  const maxOrder = (await db.prepare(
    'SELECT MAX(sort_order) AS m FROM engagement_tasks WHERE week_key=?'
  ).bind(weekKey).first())?.m ?? -1;
  const r = await db.prepare(
    'INSERT INTO engagement_tasks(title,link_url,week_key,sort_order) VALUES(?,?,?,?)'
  ).bind(title, linkUrl, weekKey, (maxOrder || 0) + 1).run();
  return json({ ok: true, id: r.meta.last_row_id });
}
const etMatch = seg.match(/^engagement\/tasks\/(\d+)$/);
if (etMatch && method === 'PUT') {
  if (!canEdit) return json({ error: 'Access denied' }, 403);
  let b = {}; try { b = await req.json(); } catch {}
  const tid = parseInt(etMatch[1]);
  const sets = [], binds = [];
  if (b.title !== undefined) { sets.push('title=?'); binds.push(String(b.title || '').trim().slice(0, 200)); }
  if (b.link_url !== undefined) { sets.push('link_url=?'); binds.push(String(b.link_url || '').slice(0, 500)); }
  if (b.completed !== undefined) {
    sets.push('completed=?'); binds.push(b.completed ? 1 : 0);
    sets.push('completed_at=?'); binds.push(b.completed ? new Date().toISOString().slice(0, 10) : '');
  }
  if (!sets.length) return json({ error: 'Nothing to update' }, 400);
  binds.push(tid);
  await db.prepare(`UPDATE engagement_tasks SET ${sets.join(',')} WHERE id=?`).bind(...binds).run();
  return json({ ok: true });
}
if (etMatch && method === 'DELETE') {
  if (!canEdit) return json({ error: 'Access denied' }, 403);
  const tid = parseInt(etMatch[1]);
  await db.prepare('DELETE FROM engagement_tasks WHERE id=?').bind(tid).run();
  return json({ ok: true });
}

// Dismiss a person from the First-Time Givers dashboard card
const dismissFGMatch = seg.match(/^people\/(\d+)\/dismiss-first-gift$/);
if (dismissFGMatch && method === 'POST') {
  if (!canEdit) return json({ error: 'Access denied' }, 403);
  const pid = parseInt(dismissFGMatch[1]);
  await db.prepare('UPDATE people SET first_gift_noted=1 WHERE id=?').bind(pid).run();
  return json({ ok: true });
}

// ── Prayer Requests (FU1) ───────────────────────────────────────────
// GET  /admin/api/prayer-requests?status=open|praying|answered|closed|all
// POST /admin/api/prayer-requests                 { person_id?, requester_name?, requester_email?, request_text, submitted_at? }
// PUT  /admin/api/prayer-requests/:id             { status?, resolution_note?, request_text? }
// DELETE /admin/api/prayer-requests/:id
if (seg === 'prayer-requests' && method === 'GET') {
  if (!canEdit) return json({ error: 'Access denied' }, 403);
  const status = url.searchParams.get('status') || 'open';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 500);
  let where = '';
  const binds = [];
  if (status === 'open')      { where = "pr.status = 'open'"; }
  else if (status === 'praying') { where = "pr.status = 'praying'"; }
  else if (status === 'answered') { where = "pr.status = 'answered'"; }
  else if (status === 'closed')   { where = "pr.status = 'closed'"; }
  else if (status === 'active')   { where = "pr.status IN ('open','praying')"; }
  else { where = '1=1'; } // 'all'
  const rows = (await db.prepare(
    `SELECT pr.id, pr.person_id, pr.requester_name, pr.requester_email, pr.request_text,
            pr.source, pr.status, pr.resolution_note, pr.submitted_at, pr.resolved_at, pr.created_at,
            p.first_name, p.last_name
     FROM prayer_requests pr
     LEFT JOIN people p ON p.id = pr.person_id
     WHERE ${where}
     ORDER BY pr.submitted_at DESC, pr.id DESC
     LIMIT ?`
  ).bind(...binds, limit).all()).results || [];
  return json({ requests: rows });
}
if (seg === 'prayer-requests' && method === 'POST') {
  if (!canEdit) return json({ error: 'Access denied' }, 403);
  let b = {}; try { b = await req.json(); } catch {}
  const text = String(b.request_text || '').trim().slice(0, 5000);
  if (!text) return json({ error: 'request_text required' }, 400);
  const pid = b.person_id ? parseInt(b.person_id, 10) : null;
  const reqName  = String(b.requester_name  || '').trim().slice(0, 200);
  const reqEmail = String(b.requester_email || '').trim().slice(0, 200);
  const submittedAt = b.submitted_at && /^\d{4}-\d{2}-\d{2}/.test(String(b.submitted_at))
    ? String(b.submitted_at).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const r = await db.prepare(
    `INSERT INTO prayer_requests(person_id, requester_name, requester_email, request_text, source, submitted_at, status)
     VALUES(?, ?, ?, ?, 'manual', ?, 'open')`
  ).bind(pid, reqName, reqEmail, text, submittedAt).run();
  return json({ ok: true, id: r.meta.last_row_id });
}
if (seg === 'prayer-requests/export.csv' && method === 'GET') {
  if (!canEdit) return json({ error: 'Access denied' }, 403);
  const statusParam = url.searchParams.get('status') || 'all';
  const allowed = ['open', 'praying', 'answered', 'closed', 'active', 'all'];
  if (!allowed.includes(statusParam)) return json({ error: 'Invalid status' }, 400);
  let where = '1=1';
  if (statusParam === 'active')        where = "pr.status IN ('open','praying')";
  else if (statusParam !== 'all')      where = "pr.status = '" + statusParam + "'";
  const rows = (await db.prepare(
    `SELECT pr.submitted_at, pr.requester_name, pr.requester_email,
            pr.status, pr.resolution_note, pr.resolved_at,
            pr.request_text, pr.source,
            p.first_name, p.last_name
     FROM prayer_requests pr
     LEFT JOIN people p ON p.id = pr.person_id
     WHERE ${where}
     ORDER BY pr.submitted_at DESC, pr.id DESC`
  ).all()).results || [];
  const cols = ['date','name','email','status','resolution_note','resolved_at','request','source'];
  let csv = cols.join(',') + '\n';
  for (const r of rows) {
    const name = r.person_id
      ? ((r.first_name || '') + ' ' + (r.last_name || '')).trim()
      : (r.requester_name || '');
    const vals = [
      r.submitted_at || '', name, r.requester_email || '',
      r.status || '', r.resolution_note || '', r.resolved_at || '',
      r.request_text || '', r.source || '',
    ];
    csv += vals.map(function(v) {
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',') + '\n';
  }
  return new Response(csv, { headers: {
    'Content-Type': 'text/csv',
    'Content-Disposition': 'attachment; filename="prayer-requests-' + new Date().toISOString().slice(0,10) + '.csv"',
  }});
}
const prMatch = seg.match(/^prayer-requests\/(\d+)$/);
if (prMatch && method === 'PUT') {
  if (!canEdit) return json({ error: 'Access denied' }, 403);
  let b = {}; try { b = await req.json(); } catch {}
  const prid = parseInt(prMatch[1]);
  const sets = [], binds = [];
  if (b.status !== undefined) {
    const allowed = ['open', 'praying', 'answered', 'closed'];
    if (!allowed.includes(b.status)) return json({ error: 'Invalid status' }, 400);
    sets.push('status=?'); binds.push(b.status);
    if (b.status === 'answered' || b.status === 'closed') {
      sets.push('resolved_at=?'); binds.push(new Date().toISOString().slice(0, 10));
    } else {
      sets.push("resolved_at=''");
    }
  }
  if (b.resolution_note !== undefined) {
    sets.push('resolution_note=?'); binds.push(String(b.resolution_note || '').slice(0, 2000));
  }
  if (b.request_text !== undefined) {
    sets.push('request_text=?'); binds.push(String(b.request_text || '').slice(0, 5000));
  }
  if (!sets.length) return json({ error: 'Nothing to update' }, 400);
  binds.push(prid);
  await db.prepare(`UPDATE prayer_requests SET ${sets.join(',')} WHERE id=?`).bind(...binds).run();
  return json({ ok: true });
}
if (prMatch && method === 'DELETE') {
  if (!canEdit) return json({ error: 'Access denied' }, 403);
  const prid = parseInt(prMatch[1]);
  await db.prepare('DELETE FROM prayer_requests WHERE id=?').bind(prid).run();
  return json({ ok: true });
}

// ── Contact info completeness (R5) ──────────────────────────────────
// Counts of active members/attenders missing each contact field, with
// optional drill-down list via ?field=email|phone|address|dob|photo
if (seg === 'reports/contact-completeness' && method === 'GET') {
  const scope = url.searchParams.get('scope') || 'active'; // 'active' | 'member'
  const field = url.searchParams.get('field') || '';
  let where = "status='active'";
  if (scope === 'member') where += " AND LOWER(member_type)='member'";
  // Exclude organizations from contact-completeness counts (they often lack personal data intentionally)
  where += " AND LOWER(member_type) != 'organization'";
  if (field) {
    let cond;
    if (field === 'email')   cond = "email=''";
    else if (field === 'phone')   cond = "phone=''";
    else if (field === 'address') cond = "address1='' AND city=''";
    else if (field === 'dob')     cond = "dob=''";
    else if (field === 'photo')   cond = "photo_url=''";
    else return json({ error: 'Unknown field' }, 400);
    const rows = (await db.prepare(
      `SELECT id, first_name, last_name, member_type, email, phone, address1, city, state, zip, dob, photo_url
       FROM people WHERE ${where} AND ${cond}
       ORDER BY last_name, first_name LIMIT 500`
    ).all()).results || [];
    return json({ field, scope, people: rows });
  }
  const row = await db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN email=''                THEN 1 ELSE 0 END) AS missing_email,
            SUM(CASE WHEN phone=''                THEN 1 ELSE 0 END) AS missing_phone,
            SUM(CASE WHEN address1='' AND city='' THEN 1 ELSE 0 END) AS missing_address,
            SUM(CASE WHEN dob=''                  THEN 1 ELSE 0 END) AS missing_dob,
            SUM(CASE WHEN photo_url=''            THEN 1 ELSE 0 END) AS missing_photo
     FROM people WHERE ${where}`
  ).first();
  return json({
    scope,
    total:            row?.total           || 0,
    missing_email:    row?.missing_email   || 0,
    missing_phone:    row?.missing_phone   || 0,
    missing_address:  row?.missing_address || 0,
    missing_dob:      row?.missing_dob     || 0,
    missing_photo:    row?.missing_photo   || 0,
  });
}

// ── Giving insights (R2) ────────────────────────────────────────────
// Top givers, lapsed givers (gave prior year, not this year), giving
// frequency distribution, average-gift trend by year. Finance-gated.
if (seg === 'reports/giving-insights' && method === 'GET') {
  const year   = parseInt(url.searchParams.get('year') || '', 10);
  if (!year || isNaN(year)) return json({ error: 'year required' }, 400);
  const topN   = Math.min(parseInt(url.searchParams.get('top') || '25', 10) || 25, 100);
  const start  = year + '-01-01';
  const end    = year + '-12-31';
  const pStart = (year - 1) + '-01-01';
  const pEnd   = (year - 1) + '-12-31';

  // Canonical effective date: contribution_date falls back to batch_date
  const effDate = "COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date)";

  // Top givers in `year`
  const topGivers = (await db.prepare(
    `SELECT p.id, p.first_name, p.last_name, p.member_type,
            COUNT(*) AS gifts, SUM(ge.amount) AS total_cents
     FROM giving_entries ge
     JOIN giving_batches gb ON gb.id = ge.batch_id
     JOIN people p ON p.id = ge.person_id
     WHERE ${effDate} >= ? AND ${effDate} <= ?
     GROUP BY p.id
     ORDER BY total_cents DESC
     LIMIT ?`
  ).bind(start, end, topN).all()).results || [];

  // Lapsed givers: gave in prior year, nothing in this year
  const lapsed = (await db.prepare(
    `SELECT p.id, p.first_name, p.last_name, p.member_type,
            SUM(ge.amount)       AS prior_total_cents,
            COUNT(*)             AS prior_gifts,
            MAX(${effDate})      AS last_gift_date
     FROM giving_entries ge
     JOIN giving_batches gb ON gb.id = ge.batch_id
     JOIN people p ON p.id = ge.person_id
     WHERE ${effDate} >= ? AND ${effDate} <= ?
       AND p.id NOT IN (
         SELECT DISTINCT ge2.person_id
         FROM giving_entries ge2
         JOIN giving_batches gb2 ON gb2.id = ge2.batch_id
         WHERE COALESCE(NULLIF(ge2.contribution_date,''), gb2.batch_date) >= ?
           AND COALESCE(NULLIF(ge2.contribution_date,''), gb2.batch_date) <= ?
       )
     GROUP BY p.id
     ORDER BY prior_total_cents DESC`
  ).bind(pStart, pEnd, start, end).all()).results || [];

  // Frequency distribution — bucket each giver by # of gifts this year
  const freqRaw = (await db.prepare(
    `SELECT person_id, COUNT(*) AS gifts
     FROM giving_entries ge
     JOIN giving_batches gb ON gb.id = ge.batch_id
     WHERE ${effDate} >= ? AND ${effDate} <= ?
     GROUP BY person_id`
  ).bind(start, end).all()).results || [];
  const buckets = [
    { label: '1 gift',       min: 1,  max: 1,   n: 0 },
    { label: '2–5 gifts',    min: 2,  max: 5,   n: 0 },
    { label: '6–12 gifts',   min: 6,  max: 12,  n: 0 },
    { label: '13–26 gifts',  min: 13, max: 26,  n: 0 },
    { label: '27+ gifts',    min: 27, max: 9e9, n: 0 },
  ];
  for (const r of freqRaw) {
    const g = r.gifts || 0;
    for (const b of buckets) { if (g >= b.min && g <= b.max) { b.n++; break; } }
  }

  // Average-gift trend — last 5 years ending in `year`
  const trendYears = [];
  for (let y = year - 4; y <= year; y++) trendYears.push(y);
  const trendRows = [];
  for (const y of trendYears) {
    const s = y + '-01-01', e = y + '-12-31';
    const r = await db.prepare(
      `SELECT COUNT(*) AS gifts, COUNT(DISTINCT ge.person_id) AS givers, SUM(ge.amount) AS total_cents
       FROM giving_entries ge
       JOIN giving_batches gb ON gb.id = ge.batch_id
       WHERE ${effDate} >= ? AND ${effDate} <= ?`
    ).bind(s, e).first();
    const gifts  = r?.gifts  || 0;
    const givers = r?.givers || 0;
    const tot    = r?.total_cents || 0;
    trendRows.push({
      year: y,
      gifts, givers,
      total_cents: tot,
      avg_gift_cents:  gifts  > 0 ? Math.round(tot / gifts)  : 0,
      avg_giver_cents: givers > 0 ? Math.round(tot / givers) : 0,
    });
  }

  return json({
    year,
    top_givers: topGivers,
    lapsed,
    frequency:  buckets,
    trend:      trendRows,
  });
}

// ── Giving × Attendance overlay (R8) ────────────────────────────────
// Weekly buckets: attendance (sum per week) and giving (sum per week).
// Week = Sunday of that week (derived from service_date / effective gift date).
// Finance-gated (matches reports/giving-*).
if (seg === 'reports/giving-vs-attendance' && method === 'GET') {
  const from = url.searchParams.get('from') || '';
  const to   = url.searchParams.get('to')   || '';
  if (!from || !to) return json({ error: 'from and to required' }, 400);
  // Include special services too (not just service_type='sunday') so Christmas etc. land in the week
  const attRows = (await db.prepare(
    `SELECT date(service_date, '-' || strftime('%w', service_date) || ' days') AS week_start,
            SUM(attendance) AS total_att
     FROM worship_services
     WHERE attendance > 0 AND service_date BETWEEN ? AND ?
     GROUP BY week_start
     ORDER BY week_start`
  ).bind(from, to).all()).results || [];
  const effDate = "COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date)";
  const giveRows = (await db.prepare(
    `SELECT date(${effDate}, '-' || strftime('%w', ${effDate}) || ' days') AS week_start,
            SUM(ge.amount) AS total_cents,
            COUNT(DISTINCT ge.person_id) AS givers
     FROM giving_entries ge
     JOIN giving_batches gb ON gb.id = ge.batch_id
     WHERE ${effDate} BETWEEN ? AND ?
     GROUP BY week_start
     ORDER BY week_start`
  ).bind(from, to).all()).results || [];
  const byWeek = {};
  for (const r of attRows) byWeek[r.week_start] = { week_start: r.week_start, attendance: r.total_att || 0, giving_cents: 0, givers: 0 };
  for (const r of giveRows) {
    if (!byWeek[r.week_start]) byWeek[r.week_start] = { week_start: r.week_start, attendance: 0, giving_cents: 0, givers: 0 };
    byWeek[r.week_start].giving_cents = r.total_cents || 0;
    byWeek[r.week_start].givers = r.givers || 0;
  }
  const weeks = Object.values(byWeek).sort((a,b) => a.week_start.localeCompare(b.week_start));
  return json({ from, to, weeks });
}


if (seg === 'reports/giving-summary' && method === 'GET') {
  const from = url.searchParams.get('from') || new Date().getFullYear() + '-01-01';
  const to   = url.searchParams.get('to')   || new Date().getFullYear() + '-12-31';
  const [rowsResult, giverResult, txnResult, methodResult] = await Promise.all([
    db.prepare(
      `SELECT f.name as fund_name, COUNT(ge.id) as contributions, COALESCE(SUM(ge.amount),0) as total_cents
       FROM funds f LEFT JOIN giving_entries ge ON ge.fund_id=f.id
       LEFT JOIN giving_batches gb ON ge.batch_id=gb.id
       WHERE f.active=1
         AND COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) BETWEEN ? AND ?
       GROUP BY f.id ORDER BY f.sort_order, f.name`
    ).bind(from, to).all(),
    db.prepare(
      `SELECT COUNT(DISTINCT ge.person_id) as n
       FROM giving_entries ge
       LEFT JOIN giving_batches gb ON ge.batch_id=gb.id
       WHERE COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) BETWEEN ? AND ?
         AND ge.person_id IS NOT NULL`
    ).bind(from, to).first(),
    db.prepare(
      `SELECT COUNT(ge.id) as n
       FROM giving_entries ge
       LEFT JOIN giving_batches gb ON ge.batch_id=gb.id
       WHERE COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) BETWEEN ? AND ?`
    ).bind(from, to).first(),
    db.prepare(
      `SELECT ge.method, COUNT(ge.id) as contributions, COALESCE(SUM(ge.amount),0) as total_cents
       FROM giving_entries ge
       LEFT JOIN giving_batches gb ON ge.batch_id=gb.id
       WHERE COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) BETWEEN ? AND ?
       GROUP BY ge.method ORDER BY total_cents DESC`
    ).bind(from, to).all(),
  ]);
  const rows = rowsResult.results || [];
  const grand = rows.reduce((s,r) => s + r.total_cents, 0);
  // R1: Giving by age group (joining on person's dob)
  const ageRows = (await db.prepare(
    `SELECT
       CASE
         WHEN p.dob = '' OR p.dob IS NULL THEN 'unknown'
         WHEN (julianday('now') - julianday(p.dob)) / 365.25 < 18 THEN 'under_18'
         WHEN (julianday('now') - julianday(p.dob)) / 365.25 < 30 THEN 'a18_29'
         WHEN (julianday('now') - julianday(p.dob)) / 365.25 < 45 THEN 'a30_44'
         WHEN (julianday('now') - julianday(p.dob)) / 365.25 < 65 THEN 'a45_64'
         ELSE 'a65_plus'
       END AS age_group,
       COUNT(DISTINCT p.id) AS givers,
       COUNT(ge.id)         AS contributions,
       COALESCE(SUM(ge.amount), 0) AS total_cents
     FROM giving_entries ge
     LEFT JOIN giving_batches gb ON ge.batch_id = gb.id
     LEFT JOIN people p ON p.id = ge.person_id
     WHERE COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) BETWEEN ? AND ?
     GROUP BY age_group`
  ).bind(from, to).all()).results || [];
  const ageMap = {};
  for (const r of ageRows) ageMap[r.age_group] = r;
  const ageBuckets = ['under_18','a18_29','a30_44','a45_64','a65_plus','unknown'].map(function(k) {
    const label = { under_18:'Under 18', a18_29:'18–29', a30_44:'30–44', a45_64:'45–64', a65_plus:'65+', unknown:'Unknown (no DOB)' }[k];
    const r = ageMap[k] || {};
    return { key: k, label, givers: r.givers || 0, contributions: r.contributions || 0, total_cents: r.total_cents || 0 };
  });
  return json({
    from, to, rows, grand_total_cents: grand,
    total_givers: giverResult?.n ?? 0,
    total_transactions: txnResult?.n ?? 0,
    by_method: methodResult.results || [],
    by_age_group: ageBuckets,
  });
}

// Standalone orphan cleanup: find DB entries whose breeze_id no longer exists in Breeze
// for a given date range and remove them (same safety check as the sync orphan pass).
if (seg === 'giving/reconcile-orphans' && method === 'POST') { try {
  const breeze = makeBreezeClient(env);
  if (!breeze) return json({ error: 'Breeze not configured' }, 503);
  let b = {}; try { b = await req.json(); } catch {}
  const start = b.start || '';
  const end   = b.end   || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
    return json({ error: 'start and end (YYYY-MM-DD) required' }, 400);
  }
  const lateStartObj = new Date(start);
  lateStartObj.setDate(lateStartObj.getDate() - 45);
  const lateStart = lateStartObj.toISOString().slice(0, 10);

  const glRes = await breeze.givingList({ start: lateStart, end, details: 1, limit: 10000 });
  if (!glRes.ok) return json({ error: 'Breeze API error: ' + glRes.status }, 502);
  const glData = await glRes.json();
  const glByPaymentId = new Map();
  if (Array.isArray(glData)) {
    for (const p of glData) { if (p.id) glByPaymentId.set(String(p.id), true); }
  }

  const winRows = (await db.prepare(
    `SELECT ge.id, ge.breeze_id, ge.person_id, ge.contribution_date
     FROM giving_entries ge
     WHERE ge.contribution_date >= ? AND ge.contribution_date <= ? AND ge.breeze_id != ''`
  ).bind(lateStart, end).all()).results || [];

  const orphaned = winRows.filter(r => !glByPaymentId.has(r.breeze_id));
  const currentKeys = new Set(
    winRows.filter(r => glByPaymentId.has(r.breeze_id))
      .map(r => `${r.person_id}::${r.contribution_date}`)
  );
  const toDelete = orphaned.filter(r => currentKeys.has(`${r.person_id}::${r.contribution_date}`));

  let orphansRemoved = 0;
  if (toDelete.length > 0) {
    const deleteOps = [];
    for (let i = 0; i < toDelete.length; i += 90) {
      const chunk = toDelete.slice(i, i + 90);
      deleteOps.push(
        db.prepare(`DELETE FROM giving_entries WHERE id IN (${chunk.map(() => '?').join(',')})`)
          .bind(...chunk.map(r => r.id))
      );
    }
    for (let i = 0; i < deleteOps.length; i += 10) {
      const results = await db.batch(deleteOps.slice(i, i + 10));
      for (const r of results) orphansRemoved += r.meta?.changes || 0;
    }
  }
  return json({ ok: true, orphanCandidates: orphaned.length, orphansRemoved,
    breezePaymentsChecked: glByPaymentId.size, dbEntriesChecked: winRows.length });
} catch (e) { return json({ error: 'Reconcile error: ' + e.message }, 500); } }

// Diagnostic: list every DB giving_entry in a date range, classified by
// whether its breeze_id still exists in Breeze's giving/list. Use this to
// find the source of Giving-by-Fund discrepancies with Breeze. Read-only.
if (seg === 'giving/reconcile-diagnose' && method === 'GET') { try {
  const breeze = makeBreezeClient(env);
  if (!breeze) return json({ error: 'Breeze not configured' }, 503);
  const from = url.searchParams.get('from') || '';
  const to   = url.searchParams.get('to')   || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return json({ error: 'from and to (YYYY-MM-DD) required' }, 400);
  }
  // Match the sync's 45-day grace window when fetching Breeze payments so
  // an early-year contribution logged within that grace isn't flagged.
  const lateStartObj = new Date(from);
  lateStartObj.setDate(lateStartObj.getDate() - 45);
  const lateStart = lateStartObj.toISOString().slice(0, 10);

  const glRes = await breeze.givingList({ start: lateStart, end: to, details: 1, limit: 10000 });
  if (!glRes.ok) return json({ error: 'Breeze API error: ' + glRes.status }, 502);
  const glData = await glRes.json();
  const glIds = new Set();
  const glPayments = [];
  if (Array.isArray(glData)) {
    for (const p of glData) {
      if (p.id != null) glIds.add(String(p.id));
      glPayments.push(p);
    }
  }

  // All DB rows whose effective gift date lands in [from, to], matching the
  // Giving-by-Fund report's date-coalesce logic exactly.
  const rows = (await db.prepare(
    `SELECT ge.id, ge.person_id, ge.fund_id, ge.amount, ge.breeze_id, ge.batch_id,
            ge.method, ge.check_number, ge.notes,
            ge.contribution_date AS raw_contribution_date,
            COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) AS gift_date,
            gb.batch_date, gb.description AS batch_desc, gb.closed AS batch_closed,
            p.first_name, p.last_name, p.breeze_id AS person_breeze_id,
            f.name AS fund_name, f.breeze_id AS fund_breeze_id
     FROM giving_entries ge
     LEFT JOIN giving_batches gb ON ge.batch_id = gb.id
     LEFT JOIN people p         ON ge.person_id = p.id
     LEFT JOIN funds f          ON ge.fund_id   = f.id
     WHERE COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) BETWEEN ? AND ?
     ORDER BY f.name, gift_date, ge.id`
  ).bind(from, to).all()).results || [];

  // Classify each row. Split-row suffixes (`12345-2`) come from the older
  // CSV importer — check their base pid against Breeze too.
  const classify = bid => {
    if (!bid) return { key: 'no_breeze_id', inBreeze: false };
    if (glIds.has(bid)) return { key: 'in_breeze', inBreeze: true };
    const m = bid.match(/^(\d+)-(\d+)$/);
    if (m) return glIds.has(m[1])
      ? { key: 'split_suffix_base_in_breeze', inBreeze: true, basePid: m[1] }
      : { key: 'split_suffix_orphan',         inBreeze: false, basePid: m[1] };
    return { key: 'orphan', inBreeze: false };
  };

  // Twin detection: an orphan with a sibling row sharing person+date+amount
  // (sometimes with different breeze_ids) is almost certainly a duplicate
  // left behind by a previous import format.
  const keyByPDA = {};
  for (const r of rows) {
    if (!r.person_id) continue;
    const k = `${r.person_id}|${r.gift_date}|${r.amount}`;
    (keyByPDA[k] = keyByPDA[k] || []).push(r.id);
  }

  const enriched = rows.map(r => {
    const c = classify(r.breeze_id || '');
    const twinKey = r.person_id ? `${r.person_id}|${r.gift_date}|${r.amount}` : '';
    const twinIds = twinKey ? (keyByPDA[twinKey] || []).filter(id => id !== r.id) : [];
    return {
      id: r.id,
      person_id: r.person_id,
      person_name: [r.first_name, r.last_name].filter(Boolean).join(' ') || '(unlinked)',
      person_breeze_id: r.person_breeze_id || '',
      fund_id: r.fund_id,
      fund_name: r.fund_name || '(no fund)',
      fund_breeze_id: r.fund_breeze_id || '',
      amount_cents: r.amount,
      contribution_date: r.raw_contribution_date || '',
      gift_date: r.gift_date,
      batch_id: r.batch_id,
      batch_desc: r.batch_desc || '',
      batch_date: r.batch_date || '',
      batch_closed: !!r.batch_closed,
      breeze_id: r.breeze_id || '',
      method: r.method || '',
      check_number: r.check_number || '',
      notes: r.notes || '',
      classification: c.key,
      in_breeze_giving_list: c.inBreeze,
      base_payment_id: c.basePid || '',
      twin_entry_ids: twinIds,
    };
  });

  // Per-fund summary: highlight exactly which funds carry extras.
  const fundSummary = {};
  for (const r of enriched) {
    const k = r.fund_name;
    if (!fundSummary[k]) fundSummary[k] = {
      fund_id: r.fund_id, fund_name: r.fund_name, fund_breeze_id: r.fund_breeze_id,
      total_count: 0, total_cents: 0,
      matched_count: 0, matched_cents: 0,
      extras_count: 0, extras_cents: 0,
      by_class: {},
    };
    const s = fundSummary[k];
    s.total_count++; s.total_cents += r.amount_cents;
    if (r.in_breeze_giving_list) { s.matched_count++; s.matched_cents += r.amount_cents; }
    else { s.extras_count++; s.extras_cents += r.amount_cents; }
    s.by_class[r.classification] = (s.by_class[r.classification] || 0) + 1;
  }
  const fundSummaryList = Object.values(fundSummary)
    .sort((a, b) => b.extras_cents - a.extras_cents || b.total_cents - a.total_cents);

  const classification_counts = enriched.reduce((acc, r) => {
    acc[r.classification] = (acc[r.classification] || 0) + 1;
    return acc;
  }, {});

  const extras = enriched.filter(r => !r.in_breeze_giving_list);

  // Breeze-side view: which payments exist in giving/list but have 0 rows
  // in the DB? These are the inverse problem (missing imports, not extras).
  const dbBreezeIds = new Set(enriched.map(r => r.breeze_id).filter(Boolean));
  const missingFromDb = [];
  for (const p of glPayments) {
    const pid = String(p.id);
    if (dbBreezeIds.has(pid)) continue;
    // Exclude payments whose paid_on date is outside the [from,to] window
    const paid = (p.paid_on || p.date || '').slice(0, 10);
    if (!paid || paid < from || paid > to) continue;
    missingFromDb.push({
      breeze_id: pid,
      date: paid,
      amount: p.amount,
      person_id: p.person_id,
      person_name: [p.first_name, p.last_name].filter(Boolean).join(' '),
      fund_names: Array.isArray(p.funds) ? p.funds.map(f => f.name || f.fund_name).filter(Boolean) : [],
    });
  }

  return json({
    ok: true,
    from, to, lateStart,
    db_row_count: enriched.length,
    db_total_cents: enriched.reduce((s, r) => s + r.amount_cents, 0),
    breeze_payment_count: glIds.size,
    extras_count: extras.length,
    extras_total_cents: extras.reduce((s, r) => s + r.amount_cents, 0),
    missing_from_db_count: missingFromDb.length,
    classification_counts,
    fund_summary: fundSummaryList,
    extras,
    missing_from_db: missingFromDb.slice(0, 200),
  });
} catch (e) { return json({ error: 'Diagnose error: ' + e.message }, 500); } }

// Force-remove orphans: delete giving_entries whose breeze_id is not in
// Breeze's giving/list for the window — without reconcile-orphans' safety
// "current replacement exists for same person+date" check. Admin-only.
// The caller must include the exact count and total cents returned by the
// diagnose endpoint; the server recomputes and aborts if they disagree, so
// the button can't run against stale data.
if (seg === 'giving/force-remove-orphans' && method === 'POST') { try {
  if (!isAdmin) return json({ error: 'Access denied: force-remove requires admin' }, 403);
  const breeze = makeBreezeClient(env);
  if (!breeze) return json({ error: 'Breeze not configured' }, 503);
  let b = {}; try { b = await req.json(); } catch {}
  const start = b.start || '';
  const end   = b.end   || '';
  const confirmCount = Number.isInteger(b.confirm_count) ? b.confirm_count : NaN;
  const confirmCents = Number.isInteger(b.confirm_cents) ? b.confirm_cents : NaN;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
    return json({ error: 'start and end (YYYY-MM-DD) required' }, 400);
  }
  if (!Number.isFinite(confirmCount) || !Number.isFinite(confirmCents)) {
    return json({ error: 'confirm_count and confirm_cents (integers) required' }, 400);
  }
  const lateStartObj = new Date(start);
  lateStartObj.setDate(lateStartObj.getDate() - 45);
  const lateStart = lateStartObj.toISOString().slice(0, 10);

  const glRes = await breeze.givingList({ start: lateStart, end, details: 1, limit: 10000 });
  if (!glRes.ok) return json({ error: 'Breeze API error: ' + glRes.status }, 502);
  const glData = await glRes.json();
  const glIds = new Set();
  if (Array.isArray(glData)) {
    for (const p of glData) if (p.id != null) glIds.add(String(p.id));
  }
  // Truncation safeguard: a tiny giving/list likely means the API call failed
  // or returned partial data — refuse rather than mass-delete in that case.
  const MIN_BREEZE_PAYMENTS = 100;
  if (glIds.size < MIN_BREEZE_PAYMENTS) {
    return json({ error: `Aborted: Breeze giving/list returned only ${glIds.size} payments (threshold ${MIN_BREEZE_PAYMENTS}) — refusing to mass-delete on a likely truncated response.` }, 409);
  }

  // Use the same date-coalesce logic as the diagnose endpoint so the count
  // we compute matches what the user confirmed.
  const rows = (await db.prepare(
    `SELECT ge.id, ge.amount, ge.breeze_id, ge.person_id, ge.fund_id,
            COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) AS gift_date
     FROM giving_entries ge
     LEFT JOIN giving_batches gb ON ge.batch_id = gb.id
     WHERE COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) BETWEEN ? AND ?
       AND ge.breeze_id != ''`
  ).bind(start, end).all()).results || [];

  // Split-suffix `pid-N` rows: match if base pid is in Breeze.
  const isOrphan = bid => {
    if (!bid) return false;
    if (glIds.has(bid)) return false;
    const m = bid.match(/^(\d+)-(\d+)$/);
    if (m && glIds.has(m[1])) return false;
    return true;
  };
  const orphans = rows.filter(r => isOrphan(r.breeze_id));
  const actualCount = orphans.length;
  const actualCents = orphans.reduce((s, r) => s + (r.amount || 0), 0);

  if (actualCount !== confirmCount || actualCents !== confirmCents) {
    return json({
      error: 'Confirmation mismatch — data has changed since diagnose ran. Re-run Diagnose and try again.',
      expected: { count: confirmCount, cents: confirmCents },
      actual:   { count: actualCount,  cents: actualCents },
    }, 409);
  }
  if (actualCount === 0) {
    return json({ ok: true, removed: 0, removed_cents: 0 });
  }

  // Delete in chunks of 90 ids (D1 ~100 param limit).
  const deleteOps = [];
  for (let i = 0; i < orphans.length; i += 90) {
    const chunk = orphans.slice(i, i + 90);
    const placeholders = chunk.map(() => '?').join(',');
    deleteOps.push(
      db.prepare(`DELETE FROM giving_entries WHERE id IN (${placeholders})`)
        .bind(...chunk.map(r => r.id))
    );
  }
  let removed = 0;
  for (let i = 0; i < deleteOps.length; i += 10) {
    const results = await db.batch(deleteOps.slice(i, i + 10));
    for (const r of results) removed += r.meta?.changes || 0;
  }
  await db.prepare(
    'DELETE FROM giving_batches WHERE id NOT IN (SELECT DISTINCT batch_id FROM giving_entries)'
  ).run();

  // Record the action so this irreversible op is traceable. Store the list
  // of removed ids in new_value so the removal can be audited later.
  try {
    await db.prepare(
      `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value) VALUES(?,?,?,?,?,?,?)`
    ).bind('force_remove_orphans','giving_entries', null,'', start + ' to ' + end,
           String(actualCents),
           JSON.stringify({ count: actualCount, ids: orphans.map(r => r.id).slice(0, 500) })).run();
  } catch {}

  return json({ ok: true, removed, removed_cents: actualCents, breezePaymentsChecked: glIds.size });
} catch (e) { return json({ error: 'Force-remove error: ' + e.message }, 500); } }

if (seg === 'reports/giving-trend' && method === 'GET') {
  if (!isFinance) return json({ error: 'Forbidden' }, 403);
  const yearsParam = url.searchParams.get('years') || String(new Date().getFullYear());
  const years = yearsParam.split(',').map(y => y.trim()).filter(y => /^\d{4}$/.test(y)).slice(0, 10);
  if (!years.length) return json({ error: 'No valid years' }, 400);
  const placeholders = years.map(() => '?').join(',');
  const rows = (await db.prepare(
    `SELECT substr(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date),1,4) as yr,
            substr(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date),6,2) as mo,
            SUM(ge.amount) as total_cents
     FROM giving_entries ge
     JOIN giving_batches gb ON ge.batch_id=gb.id
     WHERE substr(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date),1,4) IN (${placeholders})
     GROUP BY yr, mo ORDER BY yr, mo`
  ).bind(...years).all()).results || [];
  const monthly = {};
  years.forEach(y => { monthly[y] = []; });
  rows.forEach(r => {
    if (monthly[r.yr]) monthly[r.yr].push({ month: r.mo, total_cents: r.total_cents });
  });
  return json({ years, monthly });
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


  return null; // not handled
}
