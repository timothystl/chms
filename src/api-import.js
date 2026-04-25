// ── Import, Config, Register, Export, Breeze Sync API handlers ──────────────
import { json } from './auth.js';
import { makeBreezeClient } from './breeze.js';
import { parseFundSplits, givingEntryId, isGivingDup } from './api-utils.js';

export async function handleImportApi(req, env, url, method, seg, db, isAdmin, isFinance, isStaff, canEdit) {

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
  const breeze = makeBreezeClient(env);
  if (!breeze) return json({ error: 'Breeze not configured' }, 503);
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
      const res = await breeze.attendance(svc.breeze_instance_id);
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
  const breeze = makeBreezeClient(env);
  if (!breeze) return json({ error: 'Breeze not configured' }, 503);
  const results = {};

  // Test account/list_log with contribution_added — raw object_json
  const logR = await breeze.auditLog({ action: 'contribution_added', limit: 5 });
  const logText = await logR.text();
  let logParsed = null; try { logParsed = JSON.parse(logText); } catch {}
  results.log_no_details = { status: logR.status, count: Array.isArray(logParsed) ? logParsed.length : null, sample: Array.isArray(logParsed) ? logParsed.slice(0, 3) : logText.slice(0, 500) };

  // Same but with details=1 — may include amount/fund/person
  const logDR = await breeze.auditLog({ action: 'contribution_added', details: 1, limit: 5 });
  const logDText = await logDR.text();
  let logDParsed = null; try { logDParsed = JSON.parse(logDText); } catch {}
  results.log_with_details = { status: logDR.status, count: Array.isArray(logDParsed) ? logDParsed.length : null, sample: Array.isArray(logDParsed) ? logDParsed.slice(0, 3) : logDText.slice(0, 500) };

  // Try undocumented Breeze fund endpoints
  for (const path of ['giving/funds', 'funds', 'giving/list_funds', 'giving/fund']) {
    try {
      const r = await breeze.get(path);
      const t = await r.text();
      let p = null; try { p = JSON.parse(t); } catch {}
      results['fund_endpoint_' + path.replace('/','_')] = { status: r.status, body: t.slice(0, 300), parsed_count: Array.isArray(p) ? p.length : (p ? 'object' : null) };
    } catch(e) { results['fund_endpoint_' + path.replace('/','_')] = { error: e.message }; }
  }

  // Check oldest contribution_added log entry (how far back does log go?)
  const oldestR = await breeze.auditLog({ action: 'contribution_added', limit: 1, start: '2010-01-01', end: '2021-01-01' });
  const oldestText = await oldestR.text();
  let oldestParsed = null; try { oldestParsed = JSON.parse(oldestText); } catch {}
  results.oldest_contribution_log = { status: oldestR.status, count: Array.isArray(oldestParsed) ? oldestParsed.length : null, sample: Array.isArray(oldestParsed) ? oldestParsed.slice(0,2) : oldestText.slice(0,300) };

  // Check bulk_import_contributions — historical data may have been bulk-imported
  const bulkR = await breeze.auditLog({ action: 'bulk_import_contributions', details: 1, limit: 5 });
  const bulkText = await bulkR.text();
  let bulkParsed = null; try { bulkParsed = JSON.parse(bulkText); } catch {}
  results.bulk_imports = { status: bulkR.status, count: Array.isArray(bulkParsed) ? bulkParsed.length : null, sample: Array.isArray(bulkParsed) ? bulkParsed.slice(0,3) : bulkText.slice(0,300) };

  // Try official /api/giving/list endpoint
  const glR = await breeze.givingList({ start: '2024-01-01', end: '2024-12-31', limit: 5 });
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

  for (const row of dataRows) {
    const pid = String(row[C.paymentId] || '').trim();
    if (!pid) { skipped++; skipBlank++; continue; }
    // Track how many times this payment ID appears in this CSV chunk.
    // Breeze exports one row per fund for split payments (same pid, different fund/amount).
    pidSeenInCsv[pid] = (pidSeenInCsv[pid] || 0) + 1;
    const nthOcc = pidSeenInCsv[pid];
    if (isGivingDup(pid, nthOcc, existingIds)) {
      skipped++; skipDup++; dupIds.push(pid + (nthOcc > 1 ? ' (row ' + nthOcc + ')' : '')); continue;
    }

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
      const entryId = givingEntryId(pid, nthOcc, isMulti ? si : -1);
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

// ── Breeze Full Audit Log Export (CSV) ───────────────────────────
// Returns every contribution-related event from Breeze's audit log as a CSV
// with all available fields. Purely diagnostic — does not write to DB.
if (seg === 'giving/breeze-audit-export' && method === 'GET') {
  if (!isFinance) return json({ error: 'Forbidden' }, 403);
  const breeze = makeBreezeClient(env);
  if (!breeze) return json({ error: 'Breeze not configured' }, 503);
  const qs  = new URL(req.url).searchParams;
  const start = qs.get('start') || (new Date().getFullYear() + '-01-01');
  const end   = qs.get('end')   || new Date().toISOString().slice(0, 10);
  const actionTypes = [
    'contribution_added', 'contribution_updated', 'contribution_deleted',
    'bulk_contributions_deleted', 'bulk_import_contributions',
    'batch_updated', 'batch_deleted',
  ];
  const allRaw = [];
  await Promise.allSettled(actionTypes.map(async action => {
    try {
      const r = await breeze.auditLog({ details: 1, limit: 10000, start, end, action });
      if (!r.ok) return;
      const rows = await r.json();
      if (Array.isArray(rows)) rows.forEach(e => allRaw.push({ ...e, _action: action }));
    } catch {}
  }));
  // Fetch giving/list for the same window — provides current amounts (post-edit), fund names, person names
  let glMap = new Map();
  try {
    const gr = await breeze.givingList({ start, end, details: 1, limit: 10000 });
    if (gr.ok) { const gl = await gr.json(); if (Array.isArray(gl)) gl.forEach(g => glMap.set(String(g.id), g)); }
  } catch {}
  // Load person breeze_id → local_id + name from DB
  const peopleRows = (await db.prepare('SELECT id, breeze_id, first_name, last_name FROM people WHERE breeze_id IS NOT NULL AND breeze_id != ""').all()).results || [];
  const personByBreezeId = {};
  peopleRows.forEach(p => { personByBreezeId[String(p.breeze_id)] = p; });

  allRaw.sort((a, b) => {
    const da = String(a.created_on || a.id || '');
    const db2 = String(b.created_on || b.id || '');
    return da < db2 ? -1 : da > db2 ? 1 : 0;
  });

  const csvCols = [
    'action_type','entry_id','payment_id','contribution_date',
    'breeze_person_id','local_person_id','first_name','last_name',
    'amount_audit','amount_current','method','check_number','note',
    'fund_1_id','fund_1_name','fund_1_amount',
    'fund_2_id','fund_2_name','fund_2_amount',
    'fund_3_id','fund_3_name','fund_3_amount',
    'batch_ref','batch_name_current',
  ];
  const esc2 = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [csvCols.join(',')];
  for (const e of allRaw) {
    let d = null; try { d = typeof e.details === 'string' ? JSON.parse(e.details) : e.details; } catch {}
    const pid = String(e.object_json || e.id || '');
    const gl  = glMap.get(pid);
    const breezePersonId = String(d?.person_id || gl?.person_id || '');
    const person = personByBreezeId[breezePersonId] || null;
    const rawFunds = Array.isArray(gl?.funds) ? gl.funds : [];
    // Fund fields: from giving/list if available (current), else from audit log details
    let fundLines = rawFunds.length > 0 ? rawFunds.map(f => ({
      id: String(f.fund_id || f.id || ''), name: f.fund_name || '', amount: f.amount || gl?.amount || ''
    })) : [];
    if (fundLines.length === 0 && d) {
      for (const [key, fid] of Object.entries(d)) {
        if (!key.startsWith('fund-') || !fid) continue;
        const uuid = key.slice(5);
        fundLines.push({ id: String(fid), name: d['fname-' + uuid] || '', amount: d['amount-' + uuid] || d.amount || '' });
      }
    }
    const f1 = fundLines[0] || {}; const f2 = fundLines[1] || {}; const f3 = fundLines[2] || {};
    const batchRef = d?.batch_num || d?.batch_edit_select || '';
    lines.push([
      e._action, e.id, pid,
      d?.date || gl?.paid_on?.slice(0,10) || '',
      breezePersonId,
      person?.id || '',
      gl?.first_name || person?.first_name || '',
      gl?.last_name  || person?.last_name  || '',
      d?.amount || '', gl?.amount || '',
      d?.method || gl?.method || '',
      d?.check_number || '',
      d?.note || gl?.note || '',
      f1.id || '', f1.name || '', f1.amount || '',
      f2.id || '', f2.name || '', f2.amount || '',
      f3.id || '', f3.name || '', f3.amount || '',
      batchRef,
      gl?.batch_name || (batchRef ? 'Breeze Batch #' + batchRef : ''),
    ].map(esc2).join(','));
  }
  const csv = lines.join('\r\n');
  return new Response(csv, { headers: {
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment; filename="breeze-audit-${start}-to-${end}.csv"`,
  }});
}

// ── Breeze Giving Sync (via account/list_log) ────────────────────
if (seg === 'import/breeze-giving' && method === 'POST') { try {
  const breeze = makeBreezeClient(env);
  if (!breeze) return json({ error: 'Breeze not configured' }, 503);
  let b = {}; try { b = await req.json(); } catch {}
  const start = b.start || (new Date().getFullYear() + '-01-01');
  const end   = b.end   || new Date().toISOString().slice(0, 10);
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
    const fRes = await breeze.funds();
    if (fRes.ok) {
      const fRaw = await fRes.text();
      if (fRaw.trim()) {
        const fData = JSON.parse(fRaw);
        const fArr = Array.isArray(fData) ? fData : (Array.isArray(fData?.funds) ? fData.funds : []);
        for (const f of fArr) { if (f.id && f.name) breezeFundNames[String(f.id)] = f.name; }
      }
    }
  } catch {} // best-effort — also populated from giving/list fund entries below

  // Fetch audit log entries — five action types in parallel:
  // 1. contribution_added  — manually keyed contributions
  // 2. bulk_import_contributions — processor batch imports (returns 0 for Tithely but kept for future)
  // 3. contribution_deleted / bulk_contributions_deleted — deleted entries we must NOT import.
  //    Use today as the upper bound (not `end`) so that a 2025 contribution deleted in 2026
  //    is still excluded from the 2025 sync.
  const today = new Date().toISOString().slice(0, 10);
  const [logRes1, logRes2, logRes3, logRes4, logRes5] = await Promise.all([
    breeze.auditLog({ details: 1, limit: 10000, start, end, action: 'contribution_added' }),
    breeze.auditLog({ details: 1, limit: 10000, start, end, action: 'bulk_import_contributions' }),
    breeze.auditLog({ details: 1, limit: 10000, start, end: today, action: 'contribution_deleted' }),
    breeze.auditLog({ details: 1, limit: 10000, start, end: today, action: 'bulk_contributions_deleted' }),
    breeze.auditLog({ details: 1, limit: 10000, start, end, action: 'contribution_updated' }),
  ]);
  if (!logRes1.ok) return json({ error: `Breeze log API error (contribution_added): ${logRes1.status}` }, 502);
  let entries1, entries2 = [], entries3 = [], entries4 = [], entries5 = [];
  try { entries1 = await logRes1.json(); } catch { return json({ error: 'Invalid JSON from Breeze log (contribution_added)' }, 502); }
  if (!Array.isArray(entries1)) return json({ error: 'Unexpected response format', raw: String(entries1).slice(0,200) }, 502);
  if (logRes2.ok) { try { const r = await logRes2.json(); if (Array.isArray(r)) entries2 = r; } catch {} }
  if (logRes3.ok) { try { const r = await logRes3.json(); if (Array.isArray(r)) entries3 = r; } catch {} }
  if (logRes4.ok) { try { const r = await logRes4.json(); if (Array.isArray(r)) entries4 = r; } catch {} }
  if (logRes5.ok) { try { const r = await logRes5.json(); if (Array.isArray(r)) entries5 = r; } catch {} }
  // Build set of payment IDs that were deleted in Breeze — never import these
  const deletedPaymentIds = new Set([...entries3, ...entries4].map(e => String(e.object_json || e.id)));
  // contribution_updated events — used after import to correct already-imported entries
  const updatedEntries = entries5;
  // Merge contribution_added + bulk_import_contributions, deduplicate, exclude deleted
  const seenLogIds = new Set(entries1.map(e => String(e.object_json || e.id)));
  const entries = [...entries1, ...entries2.filter(e => !seenLogIds.has(String(e.object_json || e.id)))]
    .filter(e => !deletedPaymentIds.has(String(e.object_json || e.id)));

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
    deletedCount: deletedPaymentIds.size,
    contributionUpdatedCount: updatedEntries.length,
    bulkImportSample: entries2.slice(0, 3).map(e => ({ id: e.id, object_json: e.object_json, details_keys: Object.keys(e.details || e.description || {}) })),
    givingListSample: [],
    auditLogSample: [],
    breezeFundNamesAfterHarvest: null,
    unresolvedFundIds: [],
  };
  let glRaw = [];
  try {
    // Use the sync window (with grace period) instead of all-time. The all-time
    // range with limit=10000 was silently truncating early-year entries — a church
    // with 15,000+ all-time contributions loses ~2025-01 entries entirely.
    // A single year has ~3,000 contributions, safely under the 10,000 limit.
    const glRes = await breeze.givingList({ start: lateStart, end, details: 1, limit: 10000 });
    if (glRes.ok) {
      const gl = await glRes.json();
      if (Array.isArray(gl)) {
        glRaw = gl;
        // Capture raw structure of first 3 entries for diagnostics
        diag.givingListSample = gl.slice(0, 3).map(g => ({
          id: g.id,
          date: g.date,
          amount: g.amount,
          fund_id: g.fund_id,
          fund_name: g.fund_name,
          fund: g.fund,
          funds: g.funds,
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

  // Build payment-ID → giving/list record map so Pass 2 can use current (post-edit) amounts
  // instead of stale original amounts from contribution_added events.
  const glByPaymentId = new Map();
  for (const g of glRaw) { glByPaymentId.set(String(g.id), g); }

  // Supplement audit log with giving/list entries not captured there (e.g. Tithely batch imports).
  // giving/list id == audit log object_json (both are the Breeze payment ID), so seenLogIds deduplicates.
  const glSupplementEntries = [];
  for (const g of glRaw) {
    const pid = String(g.id);
    if (seenLogIds.has(pid)) continue;
    const date = (g.paid_on || g.date || '').slice(0, 10);
    if (!date || date < lateStart || date > end) continue;
    // Build synthetic details object matching audit log structure so existing helpers work
    const fundFields = {};
    const gFunds = Array.isArray(g.funds) ? g.funds : [];
    if (gFunds.length === 0) {
      fundFields['fund-'] = 'default';
    } else if (gFunds.length === 1) {
      fundFields['fund-'] = String(gFunds[0].fund_id || gFunds[0].id || '');
    } else {
      gFunds.forEach((f, i) => {
        fundFields[`fund-gl${i}`] = String(f.fund_id || f.id || '');
        if (f.amount) fundFields[`amount-gl${i}`] = String(f.amount);
      });
    }
    glSupplementEntries.push({
      id: pid,
      object_json: pid,
      details: JSON.stringify({
        person_id: String(g.person_id || ''),
        amount: String(g.amount || '0'),
        method: g.method || '',
        check_number: '',
        date,
        note: g.note || '',
        batch_num: g.num || '',
        ...fundFields,
      }),
    });
    seenLogIds.add(pid);
  }
  diag.givingListSupplementCount = glSupplementEntries.length;

  // Contributions = audit log entries + giving/list supplement (Tithely and other non-logged imports)
  const allEntries = [...entries, ...glSupplementEntries];
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

  // Ghost fund redirects: map deleted/retired Breeze fund IDs to their replacement.
  // These IDs no longer appear in /api/funds or giving/list, so they can never be
  // resolved automatically — hardcode them here so new contributions get the right fund.
  // Safe to redirect fundByBreezeId here; only affects contributions not yet imported
  // (already-imported entries use seenIds to skip). Manual Edit Gift fixes existing ones.
  const GHOST_FUND_REDIRECTS = {
    '1771128': '1718214', // deleted fund → General Fund
  };
  for (const [ghostId, realId] of Object.entries(GHOST_FUND_REDIRECTS)) {
    if (fundByBreezeId[realId]) fundByBreezeId[ghostId] = fundByBreezeId[realId];
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
    const batchNum = d.batch_num || d.batch_edit_select;
    const batchKey = batchNum ? `Breeze Batch #${batchNum}` : `Breeze Import ${date}`;
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
        const r1 = await breeze.fund(fid);
        if (r1.ok) {
          const raw1 = await r1.text();
          if (raw1.trim()) {
            const d1 = JSON.parse(raw1);
            name = d1?.name || d1?.fund_name || (Array.isArray(d1) && d1[0]?.name) || '';
          }
        }
        // Fallback: GET /api/giving/list?fund_id={id}&limit=1 — harvest name from a sample contribution
        if (!name) {
          const r2 = await breeze.givingList({ fund_id: fid, limit: 1 });
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
          const r = await breeze.fund(fid);
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
      const batchNum2 = d.batch_num || d.batch_edit_select;
      const batchKey = batchNum2 ? `Breeze Batch #${batchNum2}` : `Breeze Import ${date}`;
      const batchId  = batchByDesc[batchKey];
      if (!batchId) { errors.push({ id: entry.id, error: 'batch not found: ' + batchKey }); skipped++; continue; }

      // Use giving/list current data if available — overrides stale audit log amounts for edited contributions.
      // giving/list id == audit log object_json (payment ID), so the map lookup is exact.
      const glEntry = glByPaymentId.get(contribId);
      let fundLines;
      if (glEntry && Array.isArray(glEntry.funds) && glEntry.funds.length > 0) {
        const totalAmt = String(glEntry.amount || d.amount || '0');
        fundLines = glEntry.funds.map(f => ({
          breezeFundId: String(f.fund_id || f.id || 'default'),
          amount: f.amount ? String(f.amount) : totalAmt,
          fundName: f.name || f.fund_name || breezeFundNames[String(f.fund_id || f.id || '')] || '',
        }));
      } else {
        // No giving/list match: use audit log data, but prefer giving/list total if present
        fundLines = extractFunds(d, glEntry ? String(glEntry.amount || d.amount || '0') : (d.amount || '0'));
      }
      for (const fl of fundLines) {
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

  // ── Correction pass: apply contribution_updated edits to already-imported entries ──
  // Uses giving/list current data (glByPaymentId) as the source of truth for edited amounts/dates.
  // Fetches existing rows in bulk (chunked), scales multi-fund splits proportionally.
  let corrected = 0;
  if (updatedEntries.length > 0) {
    const updatedPaymentIds = [...new Set(updatedEntries.map(e => String(e.object_json || e.id)).filter(Boolean))];
    if (updatedPaymentIds.length > 0) {
      const existingMap = {};
      for (let i = 0; i < updatedPaymentIds.length; i += 90) {
        const chunk = updatedPaymentIds.slice(i, i + 90);
        const placeholders = chunk.map(() => '?').join(',');
        const rows = (await db.prepare(
          `SELECT id, amount, contribution_date, breeze_id FROM giving_entries WHERE breeze_id IN (${placeholders})`
        ).bind(...chunk).all()).results || [];
        rows.forEach(r => {
          if (!existingMap[r.breeze_id]) existingMap[r.breeze_id] = [];
          existingMap[r.breeze_id].push(r);
        });
      }
      const correctionOps = [];
      for (const paymentId of updatedPaymentIds) {
        const glCurrent = glByPaymentId.get(paymentId);
        if (!glCurrent) continue;
        const newAmtCents = Math.round(parseFloat(glCurrent.amount || '0') * 100);
        if (!newAmtCents) continue;
        const existingRows = existingMap[paymentId] || [];
        if (existingRows.length === 0) continue;
        const newDate = (glCurrent.paid_on || glCurrent.date || '').slice(0, 10) || null;
        const existingTotal = existingRows.reduce((s, r) => s + (r.amount || 0), 0);
        if (existingTotal === newAmtCents && (!newDate || existingRows[0].contribution_date === newDate)) continue;
        if (existingRows.length === 1) {
          correctionOps.push(
            db.prepare('UPDATE giving_entries SET amount=?, contribution_date=COALESCE(?,contribution_date) WHERE id=?')
              .bind(newAmtCents, newDate || null, existingRows[0].id)
          );
        } else {
          // Multi-fund split: scale each row proportionally to new total
          const scale = existingTotal > 0 ? newAmtCents / existingTotal : 1;
          for (const row of existingRows) {
            correctionOps.push(
              db.prepare('UPDATE giving_entries SET amount=?, contribution_date=COALESCE(?,contribution_date) WHERE id=?')
                .bind(Math.round((row.amount || 0) * scale), newDate || null, row.id)
            );
          }
        }
        corrected++;
      }
      for (let i = 0; i < correctionOps.length; i += 100) {
        await db.batch(correctionOps.slice(i, i + 100));
      }
    }
  }
  diag.correctedCount = corrected;

  // ── Orphan cleanup pass ───────────────────────────────────────────────────
  // When Breeze edits a contribution it creates a NEW payment ID. The supplement
  // pass already imported the corrected version from giving/list; this pass removes
  // the old stale entry whose breeze_id no longer appears in giving/list.
  // Safety condition: only delete if a current replacement exists for the same
  // person+date — this prevents removing entries that Breeze fully deleted.
  let orphansRemoved = 0;
  {
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

    if (toDelete.length > 0) {
      const deleteOps = [];
      for (let i = 0; i < toDelete.length; i += 90) {
        const chunk = toDelete.slice(i, i + 90);
        const placeholders = chunk.map(() => '?').join(',');
        deleteOps.push(
          db.prepare(`DELETE FROM giving_entries WHERE id IN (${placeholders})`).bind(...chunk.map(r => r.id))
        );
      }
      for (let i = 0; i < deleteOps.length; i += 10) {
        const results = await db.batch(deleteOps.slice(i, i + 10));
        for (const r of results) orphansRemoved += r.meta?.changes || 0;
      }
    }
    diag.orphansRemoved = orphansRemoved;
    diag.orphanCandidates = orphaned.length;
  }

  // ── Report contributions tied to still-unresolved "Breeze Fund XXXXX" funds ──
  const ghostFundContribs = (await db.prepare(
    `SELECT ge.contribution_date, ge.amount, ge.method, ge.notes, ge.breeze_id,
            f.name AS fund_name, f.breeze_id AS fund_breeze_id
     FROM giving_entries ge
     JOIN funds f ON f.id = ge.fund_id
     WHERE f.name LIKE 'Breeze Fund %'
     ORDER BY ge.contribution_date DESC`
  ).all()).results || [];

  return json({ ok: true, imported, lateImported, corrected, orphansRemoved, skipped, skippedDateFilter, lateEntries, ghostFundContribs, dupesRemoved, fundsRenamed, fundsMade, batchesMade, breezeFundsFound: Object.keys(breezeFundNames).length, givingListFundHarvest, givingListFiltered, seenIdsCount: seenIds.size, errors: errors.slice(0, 20), total: allEntries.length, from_log: entries.length, date_range: { start, end }, lateGraceDays: 45, diagnostics: diag });
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
  const breeze = makeBreezeClient(env);
  if (!breeze) return json({ error: 'Breeze not configured' }, 503);

  // Fetch real fund names from Breeze
  const breezeFundNames = {};
  let fetchError = null;
  let rawBody = '';
  let httpStatus = 0;
  try {
    const fRes = await breeze.funds();
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
      const glRes = await breeze.givingList({ start: fiveYrsAgo, end: today, details: 1, limit: 100 });
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
        const r = await breeze.fund(f.breeze_id);
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
  const breeze = makeBreezeClient(env);
  if (!breeze) return json({ error: 'Breeze not configured' }, 503);
  // Fetch profile field definitions
  const profileRes = await breeze.profile();
  let profileFields = []; try { profileFields = await profileRes.json(); } catch {}
  // Fetch 50 people and skip organizations (no last_name)
  const pRes = await breeze.people('details=1&limit=50&offset=0');
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
    const tr = await breeze.tags();
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
      const pr2 = await breeze.people('details=1&limit=50&offset=50');
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
  const breeze = makeBreezeClient(env);
  if (!breeze) return json({ error: 'Breeze not configured' }, 503);
  let b = {}; try { b = await req.json(); } catch {}
  const phase = b.phase || 'list';

  if (phase === 'list') {
    // Fetch all tags from Breeze and upsert records. Returns tag list for frontend to iterate.
    const tagRes = await breeze.tags();
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
        const memRes = await breeze.people(`filter_json=${filterJson}&limit=${tagLimit}&offset=${tagOffset}`);
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
  const breeze = makeBreezeClient(env);
  if (!breeze) return json({ error: 'Breeze not configured (BREEZE_SUBDOMAIN / BREEZE_API_KEY missing)' }, 503);
  const subdomain = breeze.subdomain; // needed for photo CDN URL construction below
  let b = {}; try { b = await req.json(); } catch {}
  const breezeId = String(b.breeze_id || '').trim();
  if (!breezeId) return json({ error: 'breeze_id is required' }, 400);

  // Fetch the individual person from Breeze.
  // Try /api/people/{id}?details=1 first (standard RESTful form).
  // Breeze may return a single object OR an array with one element depending on version.
  // Fall back to the list endpoint with a filter if the individual fetch returns no details.
  let p = null;
  let fetchDebug = {};
  {
    const pRes = await breeze.person(breezeId);
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
    const listRes = await breeze.people(`details=1&limit=1&filter_json=${encodeURIComponent(JSON.stringify({person_id:breezeId}))}`);
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
    const pr = await breeze.profile();
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
  const breeze = makeBreezeClient(env);
  if (!breeze) return json({ error: 'Breeze not configured (BREEZE_SUBDOMAIN / BREEZE_API_KEY missing)' }, 503);
  const subdomain = breeze.subdomain; // needed for photo CDN URL construction below
  let b = {}; try { b = await req.json(); } catch {}
  const offset = parseInt(b.offset || 0);
  const limit  = 100;
  const res = await breeze.people(`details=1&limit=${limit}&offset=${offset}`);
  if (!res.ok) return json({ error: `Breeze API error: ${res.status}` }, 502);
  let people; try { people = await res.json(); } catch { return json({ error: 'Breeze returned invalid JSON' }, 502); }
  if (!Array.isArray(people)) return json({ done: true, imported: 0, updated: 0, errors: [] });
  // Dynamically discover field IDs from /api/profile
  let profileFields = [];
  try {
    const pr = await breeze.profile();
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
