// ── Public form intake ────────────────────────────────────────────────
// Server-to-server endpoints called by the public website Worker after a
// visitor submits /contact or /prayer. The caller MUST include the header
//   X-Intake-Key: <CHMS_INTAKE_API_KEY>
// where the value matches the CHMS_INTAKE_API_KEY secret on this Worker.
//
// Routes (mounted in tlc-volunteer-worker.js before the auth gate):
//   POST /api/intake/connect-card   — contact-card / "connect" form
//   POST /api/intake/prayer         — prayer request form
//
// Body shape (JSON, see README comments on each handler for fields).
// Both endpoints store a raw payload copy in `intake_submissions` so bad
// inputs can be replayed after a fix.

import { json } from './auth.js';

const MAX_BODY_BYTES = 16 * 1024; // 16 KB — ample for either form

// Constant-time string compare (same-length only; we pad before comparing).
function timingSafeEqual(a, b) {
  const as = String(a || ''), bs = String(b || '');
  const len = Math.max(as.length, bs.length);
  let diff = as.length ^ bs.length;
  for (let i = 0; i < len; i++) {
    diff |= (as.charCodeAt(i) || 0) ^ (bs.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function authorizeIntake(req, env) {
  const expected = env.CHMS_INTAKE_API_KEY || '';
  if (!expected) return { ok: false, status: 503, error: 'Intake not configured' };
  const got = req.headers.get('X-Intake-Key') || '';
  if (!got || !timingSafeEqual(got, expected)) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: true };
}

async function readJsonBody(req) {
  const cl = parseInt(req.headers.get('content-length') || '0', 10);
  if (cl && cl > MAX_BODY_BYTES) throw new Error('Payload too large');
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new Error('Payload too large');
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function normalizeEmail(s) { return String(s || '').trim().toLowerCase(); }
function normalizePhone(s) { return String(s || '').replace(/\D+/g, ''); }
function clip(s, n) { return String(s || '').slice(0, n); }

// Try to find an existing active person by email, then by phone.
async function findExistingPerson(db, email, phone) {
  const e = normalizeEmail(email);
  if (e) {
    const hit = await db.prepare(
      `SELECT * FROM people WHERE LOWER(email) = ? AND active = 1 LIMIT 1`
    ).bind(e).first();
    if (hit) return { person: hit, match: 'email' };
  }
  const p = normalizePhone(phone);
  if (p && p.length >= 10) {
    const hit = await db.prepare(
      `SELECT * FROM people WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone,'-',''),' ',''),'(',''),')','') LIKE ?
       AND active = 1 LIMIT 1`
    ).bind('%' + p.slice(-10)).first();
    if (hit) return { person: hit, match: 'phone' };
  }
  return { person: null, match: '' };
}

async function logIntake(db, kind, remoteIp, payload, processed, error, personId, prayerId) {
  try {
    await db.prepare(
      `INSERT INTO intake_submissions
        (kind, remote_ip, payload_json, processed, error_message, person_id, prayer_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      kind,
      clip(remoteIp, 64),
      clip(JSON.stringify(payload || {}), 8000),
      processed ? 1 : 0,
      clip(error || '', 500),
      personId || null,
      prayerId || null
    ).run();
  } catch (e) {
    console.error('intake_submissions insert failed:', e?.message);
  }
}

// ── /api/intake/connect-card ─────────────────────────────────────────
// Expected body:
//   {
//     first_name, last_name, email, phone,
//     address1?, address2?, city?, state?, zip?,
//     notes?,              // free-text from form's "message" / "how can we help"
//     interests?: string[],// optional tags, appended to notes
//     source?: string      // e.g. "website_contact_form"
//   }
// Behavior: create or merge a `people` row, seed FU2 follow-up fields,
// and return { ok, person_id, merged: true|false }.
async function handleConnectCard(req, env) {
  const db = env.DB;
  const ip = req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || '';
  let body;
  try { body = await readJsonBody(req); }
  catch (e) {
    await logIntake(db, 'connect_card', ip, { raw: 'parse_failed' }, 0, e.message, null, null);
    return json({ error: 'Invalid JSON' }, 400);
  }

  const first = clip(body.first_name, 100).trim();
  const last  = clip(body.last_name, 100).trim();
  const email = clip(body.email, 200).trim();
  const phone = clip(body.phone, 50).trim();

  // Require at least a name and one way to reach the person.
  if (!(first || last) || !(email || phone)) {
    await logIntake(db, 'connect_card', ip, body, 0, 'missing_required_fields', null, null);
    return json({ error: 'Need a name and at least one of email or phone' }, 400);
  }

  const interests = Array.isArray(body.interests) ? body.interests.filter(Boolean).map(String) : [];
  const noteLines = [];
  if (body.notes) noteLines.push(String(body.notes));
  if (interests.length) noteLines.push('Interests: ' + interests.join(', '));
  if (body.source) noteLines.push('(Source: ' + String(body.source) + ')');
  const noteText = clip(noteLines.join('\n'), 2000);

  const { person, match } = await findExistingPerson(db, email, phone);
  let personId;
  let merged = false;

  if (person) {
    merged = true;
    personId = person.id;
    // Only fill blanks — never overwrite curated data with form input.
    const updates = [];
    const binds = [];
    function setIfBlank(col, val) {
      if (val && !(person[col] || '').trim()) { updates.push(col + '=?'); binds.push(val); }
    }
    setIfBlank('first_name', first);
    setIfBlank('last_name', last);
    setIfBlank('email', email);
    setIfBlank('phone', phone);
    setIfBlank('address1', clip(body.address1, 200).trim());
    setIfBlank('address2', clip(body.address2, 200).trim());
    setIfBlank('city', clip(body.city, 100).trim());
    setIfBlank('state', clip(body.state, 50).trim());
    setIfBlank('zip', clip(body.zip, 20).trim());
    if (!person.first_contact_date) { updates.push('first_contact_date=?'); binds.push(new Date().toISOString().slice(0, 10)); }
    if (!person.followup_status) { updates.push('followup_status=?'); binds.push('new'); }
    if (noteText) {
      const combined = person.notes ? (person.notes + '\n\n[' + new Date().toISOString().slice(0, 10) + ' web form]\n' + noteText) : noteText;
      updates.push('notes=?'); binds.push(clip(combined, 4000));
    }
    if (updates.length) {
      binds.push(personId);
      await db.prepare(`UPDATE people SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
    }
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const res = await db.prepare(
      `INSERT INTO people
        (first_name, last_name, email, phone, address1, address2, city, state, zip,
         member_type, notes, active, status, first_contact_date, followup_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, 'new')`
    ).bind(
      first, last, email, phone,
      clip(body.address1, 200).trim(), clip(body.address2, 200).trim(),
      clip(body.city, 100).trim(), clip(body.state, 50).trim() || 'MO', clip(body.zip, 20).trim(),
      'visitor', noteText, today
    ).run();
    personId = res.meta?.last_row_id;
  }

  const displayName = [first, last].filter(Boolean).join(' ');
  await db.prepare(
    `INSERT INTO audit_log (action, entity_type, entity_id, person_name, field, old_value, new_value)
     VALUES (?, 'person', ?, ?, ?, '', ?)`
  ).bind(
    merged ? 'intake_merge' : 'intake_create',
    personId,
    displayName,
    'connect_card',
    clip(body.source || 'website', 200)
  ).run();

  await logIntake(db, 'connect_card', ip, body, 1, '', personId, null);
  return json({ ok: true, person_id: personId, merged, match: match || '' });
}

// ── /api/intake/prayer ───────────────────────────────────────────────
// Expected body:
//   {
//     name, email?, phone?,
//     request,                 // required — the prayer text
//     is_urgent?: boolean,
//     share_publicly?: boolean,
//     source?: string
//   }
// Behavior: inserts a prayer_requests row; best-effort links to an
// existing person by email/phone. Does NOT create a person record.
async function handlePrayer(req, env) {
  const db = env.DB;
  const ip = req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || '';
  let body;
  try { body = await readJsonBody(req); }
  catch (e) {
    await logIntake(db, 'prayer', ip, { raw: 'parse_failed' }, 0, e.message, null, null);
    return json({ error: 'Invalid JSON' }, 400);
  }

  const request = clip(body.request, 4000).trim();
  if (!request) {
    await logIntake(db, 'prayer', ip, body, 0, 'missing_request', null, null);
    return json({ error: 'request text is required' }, 400);
  }

  const name  = clip(body.name, 200).trim();
  const email = clip(body.email, 200).trim();
  const phone = clip(body.phone, 50).trim();
  const isUrgent = body.is_urgent ? 1 : 0;
  const sharePublicly = body.share_publicly ? 1 : 0;
  const source = clip(body.source || 'website', 200);

  // Best-effort link to an existing person; anonymous requests are allowed.
  let personId = null;
  if (email || phone) {
    const { person } = await findExistingPerson(db, email, phone);
    if (person) personId = person.id;
  }

  const res = await db.prepare(
    `INSERT INTO prayer_requests
      (person_id, submitter_name, submitter_email, submitter_phone,
       request_text, is_urgent, share_publicly, status, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?)`
  ).bind(personId, name, email, phone, request, isUrgent, sharePublicly, source).run();
  const prayerId = res.meta?.last_row_id;

  await db.prepare(
    `INSERT INTO audit_log (action, entity_type, entity_id, person_name, field, old_value, new_value)
     VALUES ('create', 'prayer_request', ?, ?, 'request', '', ?)`
  ).bind(prayerId, name || '(anonymous)', clip(request, 500)).run();

  await logIntake(db, 'prayer', ip, body, 1, '', personId, prayerId);
  return json({ ok: true, prayer_id: prayerId, linked_person_id: personId });
}

// Entry point — dispatches on the path segment after /api/intake/.
export async function handleIntake(req, env, path) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const auth = authorizeIntake(req, env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  try {
    if (path === '/api/intake/connect-card') return await handleConnectCard(req, env);
    if (path === '/api/intake/prayer')       return await handlePrayer(req, env);
    return json({ error: 'Unknown intake endpoint' }, 404);
  } catch (e) {
    console.error('Intake error [' + path + ']:', e?.message, e?.stack);
    return json({ error: 'Internal server error' }, 500);
  }
}
