// ── People, Follow-up, Archive, Brevo Sync, Photos API handlers ────────────
import { json, hashPassword } from './auth.js';
import { brevoUpsertContact, brevoBulkSync, brevoGetListContacts, brevoContactStatus, brevoRemoveFromList } from './api-emails.js';
import { disambiguateHHName, normalizePhone, randHex, escLite, authCardPage } from './api-utils.js';
import { makeBreezeClient } from './breeze.js';

// ── Member-directory view (Connect) ───────────────────────────────────────────
// Explicit allowlist (not a blacklist) for what a role='member' viewer sees of another
// person's record — a future new `people` column defaults to NOT being exposed to
// members until someone deliberately adds it here. Strips staff-only fields (notes,
// tags, breeze_id, etc.) entirely and respects each person's own dir_hide_* opt-outs.
function memberSafeView(p, householdDisplayName) {
  return {
    id: p.id,
    first_name: p.first_name || '',
    last_name: p.last_name || '',
    middle_name: p.middle_name || '',
    preferred_name: p.preferred_name || '',
    photo_url: p.photo_url || '',
    household_id: p.household_id || null,
    household_name: p.household_name || '',
    household_display_name: householdDisplayName || null,
    household_photo_url: p.household_photo_url || '',
    family_role: p.family_role || '',
    email: p.dir_hide_email ? '' : (p.email || ''),
    phone: p.dir_hide_phone ? '' : (p.phone || ''),
    address1: p.dir_hide_address ? '' : (p.address1 || ''),
    address2: p.dir_hide_address ? '' : (p.address2 || ''),
    city: p.dir_hide_address ? '' : (p.city || ''),
    state: p.dir_hide_address ? '' : (p.state || ''),
    zip: p.dir_hide_address ? '' : (p.zip || ''),
    dob: p.dir_hide_dob ? '' : (p.dob || ''),
    anniversary_date: p.dir_hide_anniversary ? '' : (p.anniversary_date || ''),
    tags: [],
  };
}

// ── Photo upload validation ──────────────────────────────────────────────────
// Validates a multipart-form image File against size limit and magic-byte
// signature. file.type from FormData is client-supplied and spoofable.
export async function validateImageUpload(file, maxBytes = 8 * 1024 * 1024) {
  if (!file || !file.size) return { ok: false, status: 400, error: 'No file provided' };
  if (file.size > maxBytes) return { ok: false, status: 413, error: 'Image too large (max 8 MB)' };
  const buf = await file.arrayBuffer();
  const b = new Uint8Array(buf, 0, Math.min(16, buf.byteLength));
  let kind = null;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) kind = { ct: 'image/jpeg', ext: 'jpg' };
  else if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) kind = { ct: 'image/png', ext: 'png' };
  else if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) kind = { ct: 'image/gif', ext: 'gif' };
  else if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
           b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) kind = { ct: 'image/webp', ext: 'webp' };
  if (!kind) return { ok: false, status: 400, error: 'File is not a recognized image (JPEG/PNG/GIF/WebP)' };
  return { ok: true, buf, ...kind };
}

// ── Breeze reverse-sync helpers ──────────────────────────────────────────────

// Returns cached {email, phone, address} field IDs, discovering them from a
// sample person if the cache is empty. Returns {} if discovery fails.
async function getBreezeFieldIds(db, breeze) {
  const cached = await db.prepare("SELECT value FROM chms_config WHERE key='breeze_contact_field_ids'").first();
  if (cached?.value) {
    try { return JSON.parse(cached.value); } catch {}
  }
  const fieldIds = {};
  const sample = await db.prepare("SELECT breeze_id FROM people WHERE breeze_id!='' AND active=1 LIMIT 1").first();
  if (!sample) return fieldIds;
  try {
    const pr = await breeze.person(sample.breeze_id);
    if (!pr.ok) return fieldIds;
    const pd = await pr.json();
    const details = (Array.isArray(pd) ? pd[0] : pd)?.details || {};
    for (const [key, val] of Object.entries(details)) {
      if (!Array.isArray(val)) continue;
      for (const item of val) {
        if (!item || typeof item !== 'object') continue;
        const ft = item.field_type || '';
        if ((ft === 'email_primary' || ft === 'email') && !fieldIds.email) fieldIds.email = key;
        else if ((ft === 'phone' || ft.startsWith('phone')) && !fieldIds.phone) fieldIds.phone = key;
        else if ((ft === 'address_primary' || ft === 'address') && !fieldIds.address) fieldIds.address = key;
      }
    }
    if (fieldIds.email || fieldIds.phone || fieldIds.address) {
      await db.prepare("INSERT OR REPLACE INTO chms_config(key,value) VALUES('breeze_contact_field_ids',?)")
        .bind(JSON.stringify(fieldIds)).run();
    }
  } catch {}
  return fieldIds;
}

// Builds the fields_json array for a Breeze add/update call from known field IDs and a person object.
function buildBreezeContactFields(fieldIds, person) {
  const fields = [];
  if (fieldIds.email && person.email)
    fields.push({ field_id: fieldIds.email, field_type: 'email_primary', response: 'true', details: { address: person.email } });
  if (fieldIds.phone && person.phone)
    fields.push({ field_id: fieldIds.phone, field_type: 'phone', response: 'true', details: { phone_number: person.phone } });
  if (fieldIds.address && person.address1)
    fields.push({ field_id: fieldIds.address, field_type: 'address_primary', response: 'true',
      details: { street_address: person.address1, city: person.city || '', state: person.state || '', zip: person.zip || '' } });
  return fields;
}

// ── Reverse sync of date / sacramental fields (app → Breeze) ─────────────────
// Local column → the Breeze profile-field name candidates used to discover the
// writable field id. Names mirror the inbound sync's findFieldPS() lists so the
// same Breeze field is read and written. Fallback substrings prefer a name that
// also contains "date" (so we never write the boolean "Baptized"/"Confirmed"
// companion field by mistake).
const BREEZE_DATE_FIELD_SPECS = [
  { key: 'dob',               names: ['birthdate','birth date','dob','date of birth','birthday','age and birthdate','age'], fallbacks: ['birth','birthday','age'] },
  { key: 'baptism_date',      names: ['baptism date','baptismal date','date of baptism','baptized date','date baptized','baptism (date)','baptism (adult)','baptism (infant)','baptism_date','baptism','baptized'], fallbacks: ['baptism','baptized','baptismal'] },
  { key: 'confirmation_date', names: ['confirmation date','affirmation date','date of confirmation','date affirmed','date confirmed','date of affirmation','affirmation of baptism','confirmation (date)','confirmation_date'], fallbacks: ['confirmation','confirmed','affirm'] },
  { key: 'anniversary_date',  names: ['anniversary date','anniversary','anniversary_date','wedding anniversary','wedding date'], fallbacks: ['anniversary','wedding'] },
];

// Discover (and cache) the Breeze profile-field ids for the date fields above so
// we can WRITE them back. Cache key is separate from the contact-field cache.
async function getBreezeDateFieldIds(db, breeze) {
  const cached = await db.prepare("SELECT value FROM chms_config WHERE key='breeze_date_field_ids'").first();
  if (cached?.value) { try { return JSON.parse(cached.value); } catch {} }
  const out = {};
  let profileFields = [];
  try { const pr = await breeze.profile(); if (pr.ok) profileFields = await pr.json(); } catch { return out; }
  const allFields = [];
  const flatten = (fields) => {
    for (const f of (Array.isArray(fields) ? fields : [])) {
      if (Array.isArray(f.fields) && f.fields.length > 0) flatten(f.fields);
      else allFields.push(f);
    }
  };
  for (const section of (Array.isArray(profileFields) ? profileFields : [])) flatten(section.fields || []);
  if (!allFields.length) return out;
  const findField = (names, fallbacks) => {
    const ns = names.map(n => n.toLowerCase());
    let found = allFields.find(f => ns.includes((f.name || '').toLowerCase()));
    if (!found && fallbacks.length) {
      found = allFields.find(f => { const fn = (f.name || '').toLowerCase(); return fallbacks.some(s => fn.includes(s)) && fn.includes('date'); });
      if (!found) found = allFields.find(f => fallbacks.some(s => (f.name || '').toLowerCase().includes(s)));
    }
    return found;
  };
  for (const spec of BREEZE_DATE_FIELD_SPECS) {
    const f = findField(spec.names, spec.fallbacks);
    if (f) out[spec.key] = { id: String(f.field_id || f.id), type: f.field_type || 'date' };
  }
  if (Object.keys(out).length) {
    await db.prepare("INSERT OR REPLACE INTO chms_config(key,value) VALUES('breeze_date_field_ids',?)").bind(JSON.stringify(out)).run();
  }
  return out;
}

// Build fields_json entries for the date fields that actually changed. An empty
// value is sent as an empty response, which clears the field in Breeze — this is
// format-agnostic and is the important path for propagating a deletion. Setting a
// non-empty date sends YYYY-MM-DD (Breeze's ISO date format). Year-unknown
// sentinels (0001-MM-DD) can't be represented in Breeze, so they're skipped.
function buildBreezeDateFields(dateFieldIds, person, changedKeys) {
  const fields = [];
  for (const spec of BREEZE_DATE_FIELD_SPECS) {
    if (!changedKeys.includes(spec.key)) continue;
    const meta = dateFieldIds[spec.key];
    if (!meta || !meta.id) continue; // never learned this field's id — don't guess
    const val = String(person[spec.key] ?? '').slice(0, 10);
    if (val && val.indexOf('0001-') === 0) continue; // year-unknown sentinel — leave Breeze untouched
    fields.push({ field_id: meta.id, field_type: meta.type || 'date', response: val });
  }
  return fields;
}

// Push a newly-created local person to Breeze, then store the returned breeze_id.
// Fire-and-forget: call with .catch(() => {}) — failures are silent.
async function autoPushPersonToBreeze(env, db, personId, person) {
  const breeze = makeBreezeClient(env);
  if (!breeze) return;
  const fieldIds = await getBreezeFieldIds(db, breeze);
  const fields = buildBreezeContactFields(fieldIds, person);
  const res = await breeze.addPerson(
    person.first_name || '', person.last_name || '',
    fields.length ? JSON.stringify(fields) : undefined
  );
  if (!res.ok) return;
  let raw; try { raw = await res.json(); } catch { return; }
  const breezeId = String(raw?.id || raw?.person_id || '');
  if (!breezeId) return;
  await db.prepare('UPDATE people SET breeze_id=? WHERE id=?').bind(breezeId, personId).run();
  const name = [person.first_name, person.last_name].filter(Boolean).join(' ');
  await db.prepare(
    `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
     VALUES('auto_push_to_breeze','person',?,?,'breeze_id',?,?)`
  ).bind(personId, name, '', breezeId).run();
}

// Push updated contact fields for an existing person to Breeze.
// Fire-and-forget: call with .catch(() => {}) — failures are silent.
async function autoUpdatePersonInBreeze(env, db, breezeId, person, changedDateKeys = [], personId = 0) {
  const breeze = makeBreezeClient(env);
  if (!breeze) return;
  const fieldIds = await getBreezeFieldIds(db, breeze);
  const fields = buildBreezeContactFields(fieldIds, person);
  if (changedDateKeys.length) {
    const dateIds = await getBreezeDateFieldIds(db, breeze);
    fields.push(...buildBreezeDateFields(dateIds, person, changedDateKeys));
  }
  const res = await breeze.updatePerson(
    breezeId,
    person.first_name || '', person.last_name || '',
    fields.length ? JSON.stringify(fields) : undefined
  );
  // Record date/sacramental reverse-sync attempts so they can be verified in
  // production (the exact Breeze date-field write format can't be tested here).
  if (changedDateKeys.length) {
    const name = [person.first_name, person.last_name].filter(Boolean).join(' ');
    await db.prepare(
      `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
       VALUES('reverse_sync_breeze','person',?,?,?,?,?)`
    ).bind(personId || 0, name, changedDateKeys.join(','), '', (res && res.ok) ? 'pushed' : 'failed').run().catch(() => {});
  }
}

export async function handlePeopleApi(req, env, url, method, seg, db, isAdmin, isFinance, isStaff, canEdit, canRegister = isStaff) {

// ── People ──────────────────────────────────────────────────────
if (seg === 'people' && method === 'GET') {
  const q = url.searchParams.get('q') || '';
  const mt = url.searchParams.get('member_type') || '';
  const tagId = url.searchParams.get('tag_id') || '';
  const tagIdsRaw = url.searchParams.get('tag_ids') || '';
  const archivedView = url.searchParams.get('archived') === '1';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const SORT_COLS = { last_name: 'p.last_name', first_name: 'p.first_name', member_type: 'p.member_type', created_at: 'p.created_at', household: 'h.name', dob: 'p.dob', baptism: 'p.baptism_date', confirmation: 'p.confirmation_date', anniversary: 'p.anniversary_date' };
  const sortCol = SORT_COLS[url.searchParams.get('sort') || ''] || 'p.last_name';
  const sortDir = url.searchParams.get('dir') === 'desc' ? 'DESC' : 'ASC';
  const like = '%' + q + '%';
  let where;
  // Only constrain on the search-LIKE clause when the user actually typed
  // something. Otherwise rows with NULL first_name/last_name/email/phone
  // (legacy imports — schema says NOT NULL DEFAULT '' but old rows can
  // still be NULL) get silently dropped from totals, causing membership
  // counts to disagree with reports.
  const binds = [];
  // Envelope search: match the current number and any prior number (envelope_history is a
  // JSON array of strings, so a LIKE on the raw JSON finds an old envelope too).
  const searchClause = q ? ` AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.preferred_name LIKE ? OR p.email LIKE ? OR p.phone LIKE ? OR p.envelope_number LIKE ? OR p.envelope_history LIKE ?)` : '';
  if (q) binds.push(like, like, like, like, like, like, like);
  if (archivedView) {
    where = `p.status IN ('archived','deceased') AND LOWER(p.member_type) != 'organization'` + searchClause;
  } else {
    where = `p.active=1 AND LOWER(p.member_type) != 'organization'` + searchClause;
  }
  // Member role can only see people with member_type='member'
  if (!canEdit) { where += ` AND LOWER(p.member_type)='member'`; }
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
  // Positive gender filter
  const genderFilter = url.searchParams.get('gender') || '';
  if (genderFilter === 'Unknown') {
    where += ` AND (p.gender IS NULL OR p.gender='')`;
  } else if (genderFilter) {
    where += ' AND p.gender=?'; binds.push(genderFilter);
  }
  // Positive age range filter
  const ageRange = url.searchParams.get('age_range') || '';
  // Exclude year-unknown sentinel ('0001-MM-DD') from age math — those dates
  // have no computable age and would always land in the oldest bucket otherwise.
  const ageRangeClauses = {
    under_18: `(p.dob != '' AND p.dob IS NOT NULL AND p.dob NOT LIKE '0001-%' AND (julianday('now')-julianday(p.dob))/365.25 < 18)`,
    '18_29':  `(p.dob != '' AND p.dob IS NOT NULL AND p.dob NOT LIKE '0001-%' AND (julianday('now')-julianday(p.dob))/365.25 >= 18 AND (julianday('now')-julianday(p.dob))/365.25 < 30)`,
    '30_44':  `(p.dob != '' AND p.dob IS NOT NULL AND p.dob NOT LIKE '0001-%' AND (julianday('now')-julianday(p.dob))/365.25 >= 30 AND (julianday('now')-julianday(p.dob))/365.25 < 45)`,
    '45_64':  `(p.dob != '' AND p.dob IS NOT NULL AND p.dob NOT LIKE '0001-%' AND (julianday('now')-julianday(p.dob))/365.25 >= 45 AND (julianday('now')-julianday(p.dob))/365.25 < 65)`,
    '65_plus':`(p.dob != '' AND p.dob IS NOT NULL AND p.dob NOT LIKE '0001-%' AND (julianday('now')-julianday(p.dob))/365.25 >= 65)`,
  };
  if (ageRangeClauses[ageRange]) where += ' AND ' + ageRangeClauses[ageRange];
  // Household size filter (matches People Insights buckets)
  const hhSize = url.searchParams.get('household_size') || '';
  const hhSizeClauses = {
    single:       `hh_sz.n = 1`,
    couple:       `hh_sz.n = 2`,
    small:        `hh_sz.n BETWEEN 3 AND 4`,
    large:        `hh_sz.n >= 5`,
    no_household: `(p.household_id IS NULL OR p.household_id=0)`,
  };
  const needHhJoin = hhSize && hhSize !== 'no_household' && hhSizeClauses[hhSize];
  if (hhSizeClauses[hhSize]) where += ' AND ' + hhSizeClauses[hhSize];
  // When filtering by household size, join a pre-aggregated subquery instead of
  // using per-row correlated subqueries which scan the whole table for each candidate.
  const hhJoin = needHhJoin
    ? ' JOIN (SELECT household_id, COUNT(*) as n FROM people WHERE active=1 GROUP BY household_id) hh_sz ON hh_sz.household_id=p.household_id'
    : '';
  // Baptism & Confirmation status filter
  const sacrament = url.searchParams.get('sacrament') || '';
  const sacramentClauses = {
    both:            `(p.baptized=1 AND p.confirmed=1)`,
    baptized_only:   `(p.baptized=1 AND p.confirmed=0)`,
    confirmed_only:  `(p.baptized=0 AND p.confirmed=1)`,
    neither:         `(p.baptized=0 AND p.confirmed=0)`,
  };
  if (sacramentClauses[sacrament]) where += ' AND ' + sacramentClauses[sacrament];
  // Total count
  const countRow = await db.prepare(`SELECT COUNT(*) as n FROM people p${hhJoin} WHERE ${where}`).bind(...binds).first();
  const total = countRow?.n || 0;
  // Paged results
  const rows = (await db.prepare(
    `SELECT p.*, h.name as household_name FROM people p
     LEFT JOIN households h ON p.household_id=h.id${hhJoin}
     WHERE ${where} ORDER BY ${sortCol} ${sortDir}, p.last_name ASC, p.first_name ASC LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all()).results || [];
  // Batch-load tags for all returned people in a single query (avoids N+1) — skipped
  // entirely for member-role viewers, who never see tags (memberSafeView strips them).
  const ids = rows.map(r => r.id);
  const tagsByPerson = {};
  if (canEdit && ids.length) {
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
  const people = rows.map(p => {
    const householdDisplayName = hhDisambigMap[p.household_id] || p.household_name || null;
    if (!canEdit) return memberSafeView(p, householdDisplayName);
    return { ...p, tags: tagsByPerson[p.id] || [], household_display_name: householdDisplayName };
  });
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
    `INSERT INTO people (first_name,last_name,middle_name,preferred_name,email,phone,address1,address2,city,state,zip,
     member_type,dob,baptism_date,confirmation_date,anniversary_date,death_date,deceased,
     household_id,family_role,photo_url,notes,breeze_id,gender,marital_status,first_contact_date,sms_opt_in)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(b.first_name||'',b.last_name||'',b.middle_name||'',b.preferred_name||'',b.email||'',normalizePhone(b.phone||''),
         b.address1||'',b.address2||'',b.city||'',b.state||'MO',b.zip||'',
         (b.member_type||'visitor').toLowerCase(),b.dob||'',b.baptism_date||'',
         b.confirmation_date||'',b.anniversary_date||'',b.death_date||'',b.deceased?1:0,
         b.household_id||null,b.family_role||'',b.photo_url||'',b.notes||'',b.breeze_id||'',
         b.gender||'',b.marital_status||'', firstContactDate||'', b.sms_opt_in?1:0
  ).run();
  const personId = r.meta?.last_row_id;
  if (Array.isArray(b.tag_ids) && b.tag_ids.length) {
    await db.batch(b.tag_ids.map(tid =>
      db.prepare('INSERT OR IGNORE INTO person_tags(person_id,tag_id) VALUES(?,?)').bind(personId, tid)
    )).catch(() => {});
  }
  // Auto-push to Breeze for manually-added people (not Breeze imports which already have breeze_id).
  if (!b.breeze_id) autoPushPersonToBreeze(env, db, personId, b).catch(() => {});
  return json({ ok: true, id: personId });
}

if (seg === 'people/bulk-member-type' && method === 'POST') {
  if (!isStaff) return json({ error: 'Access denied' }, 403);
  let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Boolean) : [];
  const mt = (b.member_type || '').toLowerCase();
  if (!ids.length || !mt) return json({ error: 'ids and member_type required' }, 400);
  const CHUNK = 89;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    await db.prepare(`UPDATE people SET member_type=? WHERE id IN (${placeholders})`).bind(mt, ...chunk).run();
  }
  return json({ ok: true, updated: ids.length });
}

// Bulk apply tag changes across many people in a single request.
// Body: { ids: number[], add: number[], remove: number[] }
if (seg === 'people/bulk-tags' && method === 'POST') {
  if (!isStaff) return json({ error: 'Insufficient permissions' }, 403);
  let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Boolean) : [];
  const add = Array.isArray(b.add) ? b.add.map(Number).filter(Boolean) : [];
  const remove = Array.isArray(b.remove) ? b.remove.map(Number).filter(Boolean) : [];
  if (!ids.length) return json({ error: 'ids required' }, 400);
  if (!add.length && !remove.length) return json({ error: 'add or remove required' }, 400);
  const stmts = [];
  const CHUNK = 80;
  if (remove.length) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const ph = chunk.map(() => '?').join(',');
      const tagPh = remove.map(() => '?').join(',');
      stmts.push(db.prepare(
        `DELETE FROM person_tags WHERE person_id IN (${ph}) AND tag_id IN (${tagPh})`
      ).bind(...chunk, ...remove));
    }
  }
  if (add.length) {
    // Use OR IGNORE to skip already-present (person_id, tag_id) pairs.
    for (const pid of ids) {
      for (const tid of add) {
        stmts.push(db.prepare(
          'INSERT OR IGNORE INTO person_tags(person_id, tag_id) VALUES(?, ?)'
        ).bind(pid, tid));
      }
    }
  }
  if (stmts.length) await db.batch(stmts);
  return json({ ok: true, people: ids.length, added: add.length, removed: remove.length });
}

// Bulk-mark baptized / confirmed flags (date-unknown). Body: {ids, baptized: 'set'|'unset', confirmed: 'set'|'unset'}
if (seg === 'people/bulk-sacrament' && method === 'POST') {
  if (!isStaff) return json({ error: 'Insufficient permissions' }, 403);
  let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Boolean) : [];
  const bap = b.baptized === 'set' ? 1 : b.baptized === 'unset' ? 0 : null;
  const con = b.confirmed === 'set' ? 1 : b.confirmed === 'unset' ? 0 : null;
  if (!ids.length) return json({ error: 'ids required' }, 400);
  if (bap === null && con === null) return json({ error: 'no action selected' }, 400);
  const result = { ids: ids.length, baptized_updated: 0, confirmed_updated: 0 };
  const CHUNK = 90;
  if (bap !== null) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const ph = chunk.map(() => '?').join(',');
      const r = await db.prepare(`UPDATE people SET baptized=?, locally_edited=1 WHERE id IN (${ph})`).bind(bap, ...chunk).run();
      result.baptized_updated += r.meta?.changes ?? 0;
    }
  }
  if (con !== null) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const ph = chunk.map(() => '?').join(',');
      const r = await db.prepare(`UPDATE people SET confirmed=?, locally_edited=1 WHERE id IN (${ph})`).bind(con, ...chunk).run();
      result.confirmed_updated += r.meta?.changes ?? 0;
    }
  }
  return json({ ok: true, ...result });
}

// Bulk communications opt-in: flips sms_opt_in and/or pushes addresses to Brevo
// in a single call. body: { ids: [], sms: 'in'|'out'|null, newsletter: 'add'|null }
if (seg === 'people/bulk-comm-opt' && method === 'POST') {
  if (!isStaff) return json({ error: 'Insufficient permissions' }, 403);
  let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Boolean) : [];
  const sms = b.sms === 'in' ? 1 : b.sms === 'out' ? 0 : null;
  const newsletter = b.newsletter === 'add';
  if (!ids.length) return json({ error: 'ids required' }, 400);
  if (sms === null && !newsletter) return json({ error: 'no action selected' }, 400);
  const result = { ids: ids.length, sms_updated: 0, newsletter_added: 0, newsletter_skipped_no_email: 0, newsletter_error: '' };
  // Chunk to stay under D1's ~100 param limit
  const CHUNK = 90;
  if (sms !== null) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const ph = chunk.map(() => '?').join(',');
      const r = await db.prepare(`UPDATE people SET sms_opt_in=?, locally_edited=1 WHERE id IN (${ph})`).bind(sms, ...chunk).run();
      result.sms_updated += r.meta?.changes ?? 0;
    }
  }
  if (newsletter) {
    const contacts = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const ph = chunk.map(() => '?').join(',');
      const rows = (await db.prepare(
        `SELECT id, first_name, last_name, email FROM people WHERE id IN (${ph})`
      ).bind(...chunk).all()).results || [];
      for (const r of rows) {
        const em = (r.email || '').trim();
        if (!em) { result.newsletter_skipped_no_email++; continue; }
        contacts.push({ email: em, firstName: r.first_name || '', lastName: r.last_name || '' });
      }
    }
    if (contacts.length) {
      const sync = await brevoBulkSync(env, contacts);
      if (sync.ok) result.newsletter_added = contacts.length;
      else result.newsletter_error = sync.error || 'unknown';
    }
  }
  return json({ ok: true, ...result });
}

const pmatch = seg.match(/^people\/(\d+)$/);
if (pmatch) {
  const pid = parseInt(pmatch[1]);
  if (method === 'GET') {
    const p = await db.prepare(
      `SELECT p.*, h.name as household_name, h.photo_url as household_photo_url FROM people p
       LEFT JOIN households h ON p.household_id=h.id WHERE p.id=?`
    ).bind(pid).first();
    if (!p) return json({ error: 'Not found' }, 404);
    // Member role can only view actual members
    if (!canEdit && (p.member_type || '').toLowerCase() !== 'member') {
      return json({ error: 'Not found' }, 404);
    }
    // Tags are staff-only — never fetched for a member-role viewer (memberSafeView
    // strips them anyway, but skip the query entirely rather than fetch-then-discard).
    const tags = canEdit ? (await db.prepare(
      `SELECT t.id,t.name,t.color FROM tags t JOIN person_tags pt ON pt.tag_id=t.id WHERE pt.person_id=?`
    ).bind(pid).all()).results || [] : [];
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
    // Member-role viewers get the same directory-safe allowlist as the list endpoint
    // (strips notes, breeze_id, and other staff-only fields; respects dir_hide_* opt-outs)
    // instead of the full row.
    if (!canEdit) {
      return json(memberSafeView(p, household_display_name));
    }
    return json({ ...p, tags, giving_12mo: giving12mo, household_display_name });
  }
  if (method === 'PUT') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    // Capture old values for audit log
    const oldPerson = await db.prepare('SELECT * FROM people WHERE id=?').bind(pid).first();
    await db.prepare(
      `UPDATE people SET first_name=?,last_name=?,middle_name=?,preferred_name=?,email=?,phone=?,address1=?,address2=?,
       city=?,state=?,zip=?,member_type=?,dob=?,baptism_date=?,confirmation_date=?,
       anniversary_date=?,death_date=?,deceased=?,household_id=?,family_role=?,photo_url=?,notes=?,
       public_directory=?,envelope_number=?,last_seen_date=?,gender=?,marital_status=?,
       dir_hide_address=?,dir_hide_phone=?,dir_hide_email=?,dir_hide_dob=?,dir_hide_anniversary=?,
       baptized=?,confirmed=?,sms_opt_in=?,locally_edited=1 WHERE id=?`
    ).bind(b.first_name||'',b.last_name||'',b.middle_name||'',b.preferred_name||'',b.email||'',normalizePhone(b.phone||''),
           b.address1||'',b.address2||'',b.city||'',b.state||'MO',b.zip||'',
           (b.member_type||'visitor').toLowerCase(),b.dob||'',b.baptism_date||'',
           b.confirmation_date||'',b.anniversary_date||'',b.death_date||'',b.deceased?1:0,
           b.household_id||null,b.family_role||'',b.photo_url||'',b.notes||'',
           b.public_directory!=null?(b.public_directory?1:0):1,
           b.envelope_number||'',b.last_seen_date||'',b.gender||'',b.marital_status||'',
           b.dir_hide_address?1:0, b.dir_hide_phone?1:0, b.dir_hide_email?1:0,
           b.dir_hide_dob?1:0, b.dir_hide_anniversary?1:0,
           b.baptized?1:0, b.confirmed?1:0, b.sms_opt_in?1:0, pid
    ).run();
    if (Array.isArray(b.tag_ids)) {
      const tagStmts = [db.prepare('DELETE FROM person_tags WHERE person_id=?').bind(pid)];
      for (const tid of b.tag_ids) {
        tagStmts.push(db.prepare('INSERT OR IGNORE INTO person_tags(person_id,tag_id) VALUES(?,?)').bind(pid, tid));
      }
      await db.batch(tagStmts).catch(() => {});
    }
    // Propagate anniversary_date to a household spouse who doesn't have one set.
    // Only fills living partners who have NOT been locally edited, so a partner
    // who deliberately cleared their own anniversary is never silently refilled.
    if (b.anniversary_date && b.household_id && ['head','spouse'].includes(b.family_role||'')) {
      try {
        await db.prepare(
          `UPDATE people SET anniversary_date=?
           WHERE household_id=? AND id!=? AND (anniversary_date='' OR anniversary_date IS NULL)
             AND locally_edited=0 AND (deceased=0 OR deceased IS NULL)
             AND family_role IN ('head','spouse') AND active=1`
        ).bind(b.anniversary_date, b.household_id, pid).run();
      } catch {}
    }
    // Write audit log entries for changed fields
    if (oldPerson) {
      const personName = [(oldPerson.first_name||b.first_name||''), (oldPerson.last_name||b.last_name||'')].filter(Boolean).join(' ');
      const auditFields = ['first_name','last_name','middle_name','preferred_name','email','phone','address1','address2','city','state','zip',
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
    // Auto-update Breeze if name/contact or date/sacramental info changed and the
    // person is already in Breeze. Date fields (incl. clears) are pushed too so a
    // deletion in the app propagates back instead of being re-imported on next sync.
    const breezeId = oldPerson?.breeze_id || '';
    if (breezeId) {
      const breezeFields = ['first_name','last_name','email','phone','address1','address2','city','state','zip'];
      const contactChanged = breezeFields.some(f => String(oldPerson[f] ?? '') !== String(b[f] ?? ''));
      const dateKeys = ['dob','baptism_date','confirmation_date','anniversary_date'];
      const changedDateKeys = dateKeys.filter(f => String(oldPerson[f] ?? '') !== String(b[f] ?? ''));
      if (contactChanged || changedDateKeys.length) {
        autoUpdatePersonInBreeze(env, db, breezeId, b, changedDateKeys, pid).catch(() => {});
      }
    }
    return json({ ok: true });
  }
  if (method === 'PATCH') {
    // Sparse update — only fields present in the body are touched. Used by
    // small UI actions (mark seen, tag-only save, add-to-household) so they
    // don't have to round-trip the full snapshot and risk overwriting fields
    // changed concurrently.
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const oldPerson = await db.prepare('SELECT * FROM people WHERE id=?').bind(pid).first();
    if (!oldPerson) return json({ error: 'Person not found' }, 404);
    const allowed = {
      first_name:'s', last_name:'s', middle_name:'s', preferred_name:'s', email:'s', phone:'phone', address1:'s', address2:'s',
      city:'s', state:'s', zip:'s', member_type:'lower', dob:'s', baptism_date:'s',
      confirmation_date:'s', anniversary_date:'s', death_date:'s', deceased:'bool',
      household_id:'int_or_null', family_role:'s', photo_url:'s', notes:'s',
      public_directory:'bool', envelope_number:'s', last_seen_date:'s', gender:'s',
      marital_status:'s', dir_hide_address:'bool', dir_hide_phone:'bool',
      dir_hide_email:'bool', dir_hide_dob:'bool', dir_hide_anniversary:'bool',
      baptized:'bool', confirmed:'bool', sms_opt_in:'bool',
    };
    const sets = [], binds = [];
    for (const [field, kind] of Object.entries(allowed)) {
      if (!(field in b)) continue;
      let v = b[field];
      if (kind === 's')              v = String(v ?? '');
      else if (kind === 'lower')     v = String(v ?? '').toLowerCase();
      else if (kind === 'phone')     v = normalizePhone(String(v ?? ''));
      else if (kind === 'bool')      v = v ? 1 : 0;
      else if (kind === 'int_or_null') v = (v === null || v === '' || v === undefined) ? null : parseInt(v);
      sets.push(`${field}=?`); binds.push(v);
    }
    if (sets.length) {
      sets.push('locally_edited=1');
      binds.push(pid);
      await db.prepare(`UPDATE people SET ${sets.join(',')} WHERE id=?`).bind(...binds).run();
    }
    if (Array.isArray(b.tag_ids)) {
      const tagStmts = [db.prepare('DELETE FROM person_tags WHERE person_id=?').bind(pid)];
      for (const tid of b.tag_ids) {
        tagStmts.push(db.prepare('INSERT OR IGNORE INTO person_tags(person_id,tag_id) VALUES(?,?)').bind(pid, tid));
      }
      await db.batch(tagStmts).catch(() => {});
    }
    const personName = [oldPerson.first_name, oldPerson.last_name].filter(Boolean).join(' ');
    const auditStmt = db.prepare(
      `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value) VALUES(?,?,?,?,?,?,?)`
    );
    const auditOps = [];
    for (const field of Object.keys(allowed)) {
      if (!(field in b)) continue;
      const ov = String(oldPerson[field] ?? '');
      const nv = String(b[field] ?? '');
      if (ov !== nv) auditOps.push(auditStmt.bind('update','person',pid,personName,field,ov,nv));
    }
    if (auditOps.length) await db.batch(auditOps);
    // Reverse-sync to Breeze any date/sacramental (or contact) fields present in
    // this sparse update — mirrors the PUT path so a PATCH clear also propagates.
    const patchBreezeId = oldPerson.breeze_id || '';
    if (patchBreezeId) {
      const dateKeys = ['dob','baptism_date','confirmation_date','anniversary_date'];
      const changedDateKeys = dateKeys.filter(f => (f in b) && String(oldPerson[f] ?? '') !== String(b[f] ?? ''));
      const contactFields = ['first_name','last_name','email','phone','address1','address2','city','state','zip'];
      const contactChanged = contactFields.some(f => (f in b) && String(oldPerson[f] ?? '') !== String(b[f] ?? ''));
      if (changedDateKeys.length || contactChanged) {
        const person = { first_name: oldPerson.first_name, last_name: oldPerson.last_name, ...b };
        autoUpdatePersonInBreeze(env, db, patchBreezeId, person, changedDateKeys, pid).catch(() => {});
      }
    }
    return json({ ok: true });
  }
  if (method === 'DELETE') {
    const hard = url.searchParams.get('hard') === 'true';
    if (hard && !isAdmin) return json({ error: 'Access denied: permanent delete requires admin access' }, 403);
    if (hard) {
      await db.prepare('DELETE FROM person_tags WHERE person_id=?').bind(pid).run();
      await db.prepare('DELETE FROM giving_entries WHERE person_id=?').bind(pid).run();
      await db.prepare('DELETE FROM follow_up_items WHERE person_id=?').bind(pid).run();
      await db.prepare('DELETE FROM audit_log WHERE entity_id=? AND entity_type=?').bind(pid, 'person').run();
      await db.prepare('DELETE FROM people WHERE id=?').bind(pid).run();
    } else {
      await db.prepare("UPDATE people SET active=0, status='archived' WHERE id=?").bind(pid).run();
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
    const personName = [person.first_name, person.last_name].filter(Boolean).join(' ');
    await db.prepare(`INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
      VALUES('update','person',?,?,?,'active','archived')`
    ).bind(pid, personName, 'status').run();
  } else if (action === 'unarchive') {
    await db.prepare(`UPDATE people SET status='active', active=1, deceased=0 WHERE id=?`).bind(pid).run();
    const personName = [person.first_name, person.last_name].filter(Boolean).join(' ');
    await db.prepare(`INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
      VALUES('update','person',?,?,?,'archived','active')`
    ).bind(pid, personName, 'status').run();
  } else if (action === 'deceased') {
    if (!isAdmin && !isStaff) return json({ error: 'Access denied' }, 403);
    const today = new Date().toISOString().slice(0, 10);
    await db.prepare(`UPDATE people SET status='deceased', deceased=1, death_date=?, active=0 WHERE id=?`)
      .bind(today, pid).run();
    const personName = [person.first_name, person.last_name].filter(Boolean).join(' ');
    await db.prepare(`INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
      VALUES('update','person',?,?,?,'active','deceased')`
    ).bind(pid, personName, 'status').run();
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

if (seg === 'brevo/contact-status' && method === 'GET') {
  if (!isStaff) return json({ error: 'Access denied' }, 403);
  const email = url.searchParams.get('email') || '';
  if (!email) return json({ error: 'email required' }, 400);
  return json(await brevoContactStatus(env, email));
}

if (seg === 'brevo/remove-contact' && method === 'POST') {
  if (!isStaff) return json({ error: 'Access denied' }, 403);
  let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!b.email) return json({ error: 'email required' }, 400);
  return json(await brevoRemoveFromList(env, b.email));
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

// ── Push person to Breeze (manual reverse sync) ─────────────────────────────
const pushToBreezeMatch = seg.match(/^people\/(\d+)\/push-to-breeze$/);
if (pushToBreezeMatch && method === 'POST') {
  if (!canEdit) return json({ error: 'Access denied' }, 403);
  const pid = parseInt(pushToBreezeMatch[1]);
  const person = await db.prepare('SELECT * FROM people WHERE id=?').bind(pid).first();
  if (!person) return json({ error: 'Person not found' }, 404);
  if (person.breeze_id) return json({ error: 'Person already has a Breeze ID — use Sync Breeze instead' }, 409);

  const breeze = makeBreezeClient(env);
  if (!breeze) return json({ error: 'Breeze not configured' }, 503);

  const fieldIds = await getBreezeFieldIds(db, breeze);
  const fields = buildBreezeContactFields(fieldIds, person);

  const res = await breeze.addPerson(
    person.first_name || '', person.last_name || '',
    fields.length ? JSON.stringify(fields) : undefined
  );

  let raw; try { raw = await res.json(); } catch { raw = {}; }
  if (!res.ok) return json({ error: 'Breeze API error', details: raw }, 502);

  const breezeId = String(raw?.id || raw?.person_id || '');
  if (!breezeId) return json({ error: 'Breeze returned no person ID', raw }, 502);

  await db.prepare('UPDATE people SET breeze_id=? WHERE id=?').bind(breezeId, pid).run();
  const personName = [person.first_name, person.last_name].filter(Boolean).join(' ');
  await db.prepare(
    `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
     VALUES('push_to_breeze','person',?,?,'breeze_id',?,?)`
  ).bind(pid, personName, '', breezeId).run();

  return json({ ok: true, breeze_id: breezeId, fields_sent: fields.length });
}

// ── Person photo upload ──────────────────────────────────────────
const photoMatch = seg.match(/^people\/(\d+)\/photo$/);
if (photoMatch && method === 'POST') {
  if (!canRegister) return json({ error: 'Insufficient permissions' }, 403);
  if (!env.PHOTOS) return json({ error: 'Photo storage not configured — create R2 bucket tlc-chms-photos' }, 503);
  const pid = parseInt(photoMatch[1]);
  let file;
  try { const fd = await req.formData(); file = fd.get('photo'); } catch { return json({ error: 'Invalid form data' }, 400); }
  const v = await validateImageUpload(file);
  if (!v.ok) return json({ error: v.error }, v.status);
  const r2Key = `people/${pid}/photo.${v.ext}`;
  await env.PHOTOS.put(r2Key, v.buf, { httpMetadata: { contentType: v.ct } });
  const photoUrl = `/admin/r2photo/${r2Key}`;
  await db.prepare('UPDATE people SET photo_url=? WHERE id=?').bind(photoUrl, pid).run();
  return json({ ok: true, photo_url: photoUrl });
}
// Copy a photo URL into this person's record. Used by the "pick from family"
// picker to apply a household member's photo or the household photo to this
// person without re-uploading. Sets locally_edited=1.
if (photoMatch && method === 'PUT') {
  if (!canRegister) return json({ error: 'Insufficient permissions' }, 403);
  const pid = parseInt(photoMatch[1]);
  let body = {}; try { body = await req.json(); } catch {}
  const newUrl = String(body.photo_url || '').trim();
  if (!newUrl) return json({ error: 'photo_url required' }, 400);
  // Light validation: only accept R2 paths or breezechms.com URLs (matches what
  // the rest of the app produces). Prevents arbitrary URL injection.
  const ok = newUrl.startsWith('/admin/r2photo/') || newUrl.includes('breezechms.com');
  if (!ok) return json({ error: 'Unsupported photo URL' }, 400);
  await db.prepare('UPDATE people SET photo_url=?, locally_edited=1 WHERE id=?').bind(newUrl, pid).run();
  return json({ ok: true, photo_url: newUrl });
}
// Remove a person's photo: clears photo_url and deletes any R2 objects under
// people/{pid}/ and people/breeze_*/ for this person. Sync no longer
// re-populates because locally_edited=1 is set on every profile save.
if (photoMatch && method === 'DELETE') {
  if (!canRegister) return json({ error: 'Insufficient permissions' }, 403);
  const pid = parseInt(photoMatch[1]);
  const row = await db.prepare('SELECT photo_url, breeze_id FROM people WHERE id=?').bind(pid).first();
  if (!row) return json({ error: 'Person not found' }, 404);
  await db.prepare('UPDATE people SET photo_url=?, locally_edited=1 WHERE id=?').bind('', pid).run();
  if (env.PHOTOS) {
    const keys = [
      `people/${pid}/photo.jpg`,
      `people/${pid}/photo.png`,
      `people/${pid}/photo.webp`,
    ];
    if (row.breeze_id) keys.push(`people/breeze_${row.breeze_id}/photo.jpg`);
    for (const k of keys) { try { await env.PHOTOS.delete(k); } catch {} }
  }
  return json({ ok: true });
}

// ── Household photo upload ───────────────────────────────────────
const hhPhotoMatch = seg.match(/^households\/(\d+)\/photo$/);
if (hhPhotoMatch && method === 'POST') {
  if (!canEdit) return json({ error: 'Access denied' }, 403);
  if (!env.PHOTOS) return json({ error: 'Photo storage not configured' }, 503);
  const hid = parseInt(hhPhotoMatch[1]);
  let file;
  try { const fd = await req.formData(); file = fd.get('photo'); } catch { return json({ error: 'Invalid form data' }, 400); }
  const v = await validateImageUpload(file);
  if (!v.ok) return json({ error: v.error }, v.status);
  const r2Key = `households/${hid}/photo.${v.ext}`;
  await env.PHOTOS.put(r2Key, v.buf, { httpMetadata: { contentType: v.ct } });
  const photoUrl = `/admin/r2photo/${r2Key}`;
  await db.prepare('UPDATE households SET photo_url=? WHERE id=?').bind(photoUrl, hid).run();
  return json({ ok: true, photo_url: photoUrl });
}
// Remove a household's photo (DB clear + R2 delete)
if (hhPhotoMatch && method === 'DELETE') {
  if (!canEdit) return json({ error: 'Access denied' }, 403);
  const hid = parseInt(hhPhotoMatch[1]);
  const row = await db.prepare('SELECT photo_url FROM households WHERE id=?').bind(hid).first();
  if (!row) return json({ error: 'Household not found' }, 404);
  await db.prepare('UPDATE households SET photo_url=? WHERE id=?').bind('', hid).run();
  if (env.PHOTOS) {
    for (const k of [`households/${hid}/photo.jpg`, `households/${hid}/photo.png`, `households/${hid}/photo.webp`]) {
      try { await env.PHOTOS.delete(k); } catch {}
    }
  }
  return json({ ok: true });
}

// ── Households / Organizations / Tags / Funds → api-households.js ──
if (seg.startsWith('households') || seg.startsWith('organizations') ||
    seg.startsWith('tags') || seg.startsWith('funds')) {
  const result = await handleHouseholdsApi(req, env, url, method, seg, db, isAdmin, canEdit);
  if (result !== null) return result;
}

// ── Follow-up items ─────────────────────────────────────────────
if (seg === 'followup' && method === 'GET') {
  if (!isStaff) return json({ error: 'Access denied' }, 403);
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
  if (!isStaff) return json({ error: 'Access denied' }, 403);
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
  if (!isAdmin) return json({ error: 'Access denied' }, 403);
  let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!Number.isInteger(b.id)) return json({ error: 'Invalid id' }, 400);
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

// ── Connect member invite (Phase 2) ──────────────────────────────────────────
// Staff-initiated invite → member sets a password → account activates as role='member'.
// Uses the same RSVP_STORE token pattern as forgot-password/reset above, rather than
// the old /portal system's D1-table tokens. The app_users row is only created (or
// reactivated) when the member actually completes setup — an invite that's never
// opened never leaves a half-account with an unusable password sitting in the DB.

async function _sendMemberInviteEmail(env, to, displayName, setupUrl) {
  const key = env.RESEND_API_KEY || '';
  const from = env.EMAIL_FROM || '';
  if (!key || !from) return { ok: false, error: 'Resend not configured' };
  const safeName = escLite(displayName).replace(/&amp;/g, '&'); // plain-text email body, not HTML
  const text = `Hi ${safeName || 'there'},\n\nYou've been invited to Connect, Timothy Lutheran Church's member ` +
    `directory, where you can look up other members and keep your own contact info up to date. Click the link ` +
    `below to set a password and get started. This link expires in 7 days.\n\n${setupUrl}\n\n— Timothy Lutheran Church`;
  const htmlBody = `<!DOCTYPE html><html><body style="font-family:Georgia,serif;background:#FAF7F0;margin:0;padding:32px 16px;">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px 32px;border:1px solid #E8E0D0;">
      <p style="font-size:1.1rem;color:#0A3C5C;font-weight:600;">You're invited to Connect</p>
      <p style="color:#3D3530;line-height:1.6;">Hi ${escLite(displayName) || 'there'},</p>
      <p style="color:#3D3530;line-height:1.6;">You've been invited to Connect, Timothy Lutheran Church's member directory, where you can look up other members and keep your own contact info up to date. Click the button below to set a password. This link expires in 7 days.</p>
      <p style="margin:24px 0;"><a href="${setupUrl}" style="display:inline-block;background:#1E2D4A;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Set up your account</a></p>
      <p style="color:#7A6E60;font-size:.8rem;margin-top:24px;border-top:1px solid #E8E0D0;padding-top:16px;">Timothy Lutheran Church &middot; 6704 Fyler Ave, St. Louis, MO 63139</p>
    </div></body></html>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: "You're invited to Connect — Timothy Lutheran Church", text, html: htmlBody,
        reply_to: env.REPLY_TO_EMAIL || 'office@timothystl.org' }),
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.message || String(res.status) };
  } catch (e) { return { ok: false, error: e.message }; }
}

// POST /admin/api/people/:id/invite — caller (api-chms.js) already checked canEdit.
export async function handleSendMemberInvite(env, personId) {
  if (!env.RSVP_STORE) return json({ error: 'Invite system not configured' }, 503);
  const p = await env.DB.prepare(
    `SELECT id, first_name, last_name, email, member_type, status FROM people WHERE id=?`
  ).bind(personId).first();
  if (!p) return json({ error: 'Person not found' }, 404);
  if ((p.member_type || '').toLowerCase() !== 'member') return json({ error: 'Only members can be invited to Connect' }, 400);
  if (p.status && p.status !== 'active') return json({ error: 'Person is not active' }, 400);
  if (!p.email) return json({ error: 'Person has no email address' }, 400);

  const token = randHex(32);
  const displayName = [p.first_name, p.last_name].filter(Boolean).join(' ');
  await env.RSVP_STORE.put(`member_invite:${token}`, JSON.stringify({
    person_id: p.id, email: p.email.toLowerCase().trim(), display_name: displayName, ts: Date.now(),
  }), { expirationTtl: 7 * 24 * 3600 });

  const setupUrl = `https://connect.timothystl.org/member-setup?token=${token}`;
  const sendResult = await _sendMemberInviteEmail(env, p.email, displayName, setupUrl);
  if (!sendResult.ok) return json({ error: sendResult.error || 'Could not send invite email' }, 502);
  return json({ ok: true, email: p.email });
}

// GET /member-setup?token=... — serves the "set your password" form for a Connect invite.
// POST /member-setup — form-encoded {token, password, password2}; creates or reactivates
// the role='member' app_users account linked to the invited person.
export async function handleMemberSetup(req, env, url) {
  const page = (title, inner) => authCardPage(title, `<div class="wm-display">Connect</div>
      <div class="wm-sub">${escLite(title)}</div>
      ${inner}`);

  if (req.method === 'GET') {
    const token = url.searchParams.get('token') || '';
    if (!token || !env.RSVP_STORE) return page('Set up your account', `<div class="msg err">This invite link is invalid.</div>`);
    const raw = await env.RSVP_STORE.get(`member_invite:${token}`);
    if (!raw) return page('Set up your account', `<div class="msg err">This invite link has expired or was already used. Ask the church office to resend it.</div>`);
    let rec; try { rec = JSON.parse(raw); } catch { return page('Set up your account', `<div class="msg err">Invalid invite link.</div>`); }
    return page('Set up your account', `<p style="color:#3D3530;font-size:.9rem;margin-bottom:1.25rem;">Setting up an account for <strong>${escLite(rec.display_name)}</strong> (${escLite(rec.email)}).</p>
      <form method="POST" action="/member-setup" onsubmit="var b=this.querySelector('.btn');b.disabled=true;b.textContent='Saving…';">
        <input type="hidden" name="token" value="${escLite(token)}">
        <div class="field"><label>Password</label><input type="password" name="password" minlength="8" autofocus required></div>
        <div class="field"><label>Confirm password</label><input type="password" name="password2" minlength="8" required></div>
        <button class="btn" type="submit">Set up account</button>
      </form>`);
  }

  if (req.method === 'POST') {
    let body = ''; try { body = await req.text(); } catch {}
    const params = new URLSearchParams(body);
    const token = (params.get('token') || '').trim();
    const password = params.get('password') || '';
    const password2 = params.get('password2') || '';
    if (!token) return page('Set up your account', `<div class="msg err">Missing token.</div>`);
    if (password.length < 8) return page('Set up your account', `<div class="msg err">Password must be at least 8 characters.</div>`);
    if (password !== password2) return page('Set up your account', `<div class="msg err">Passwords do not match.</div>`);
    if (!env.RSVP_STORE) return page('Set up your account', `<div class="msg err">Invite system is unavailable.</div>`);
    const raw = await env.RSVP_STORE.get(`member_invite:${token}`);
    if (!raw) return page('Set up your account', `<div class="msg err">This invite link has expired or was already used. Ask the church office to resend it.</div>`);
    let rec; try { rec = JSON.parse(raw); } catch { return page('Set up your account', `<div class="msg err">Invalid invite link.</div>`); }

    const hash = await hashPassword(password);
    const existing = await env.DB.prepare(
      `SELECT id, people_id FROM app_users WHERE people_id=? OR LOWER(username)=?`
    ).bind(rec.person_id, rec.email).first();
    if (existing && existing.people_id && existing.people_id !== rec.person_id) {
      return page('Set up your account', `<div class="msg err">This email is already associated with a different account. Contact the church office.</div>`);
    }
    if (existing) {
      await env.DB.prepare(
        `UPDATE app_users SET password_hash=?, role='member', people_id=?, active=1, email=? WHERE id=?`
      ).bind(hash, rec.person_id, rec.email, existing.id).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO app_users (username, password_hash, display_name, email, role, people_id, active) VALUES (?,?,?,?,'member',?,1)`
      ).bind(rec.email, hash, rec.display_name || '', rec.email, rec.person_id).run();
    }
    await env.RSVP_STORE.delete(`member_invite:${token}`).catch(() => {});
    return page('Set up your account', `<div class="msg ok">Account set up! <a href="https://connect.timothystl.org/">Sign in to Connect</a>.</div>`);
  }

  return page('Set up your account', `<div class="msg err">Method not allowed.</div>`);
}

