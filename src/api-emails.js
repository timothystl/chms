// EM2 — Birthday and anniversary emails via Resend
// Uses RESEND_API_KEY and EMAIL_FROM from env (already present for scheduler).
// Called by the daily cron handler in tlc-volunteer-worker.js and by admin trigger endpoints.

// ── Brevo helpers (EM1) ──────────────────────────────────────────────────────

export async function brevoUpsertContact(env, email, firstName, lastName) {
  const apiKey = env.BREVO_API_KEY || '';
  const listId = parseInt(env.BREVO_LIST_ID || '0');
  if (!apiKey || !listId) return { ok: false, error: 'Brevo not configured (missing BREVO_API_KEY or BREVO_LIST_ID)' };
  try {
    const res = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        attributes: { FIRSTNAME: firstName || '', LASTNAME: lastName || '' },
        listIds: [listId],
        updateEnabled: true,
      }),
    });
    if (res.status === 201 || res.status === 204) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.message || String(res.status) };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Per-contact newsletter status: does this email exist in Brevo, and is it in
// our newsletter list? Used to show the correct profile button state.
export async function brevoContactStatus(env, email) {
  const apiKey = env.BREVO_API_KEY || '';
  const listId = parseInt(env.BREVO_LIST_ID || '0');
  if (!apiKey || !listId) return { ok: false, error: 'Brevo not configured (missing BREVO_API_KEY or BREVO_LIST_ID)' };
  try {
    const res = await fetch('https://api.brevo.com/v3/contacts/' + encodeURIComponent(email), {
      headers: { 'api-key': apiKey },
    });
    if (res.status === 404) return { ok: true, exists: false, subscribed: false };
    if (!res.ok) { const d = await res.json().catch(() => ({})); return { ok: false, error: d.message || String(res.status) }; }
    const data = await res.json();
    const lists = data.listIds || [];
    return { ok: true, exists: true, subscribed: lists.indexOf(listId) >= 0 };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Remove a contact from the newsletter list (does not delete the contact itself).
export async function brevoRemoveFromList(env, email) {
  const apiKey = env.BREVO_API_KEY || '';
  const listId = parseInt(env.BREVO_LIST_ID || '0');
  if (!apiKey || !listId) return { ok: false, error: 'Brevo not configured (missing BREVO_API_KEY or BREVO_LIST_ID)' };
  try {
    const res = await fetch('https://api.brevo.com/v3/contacts/lists/' + listId + '/contacts/remove', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails: [email] }),
    });
    if (res.status === 201 || res.status === 204) return { ok: true };
    const d = await res.json().catch(() => ({}));
    return { ok: false, error: d.message || String(res.status) };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function brevoBulkSync(env, contacts) {
  // contacts: [{ email, firstName, lastName }, ...]
  const apiKey = env.BREVO_API_KEY || '';
  const listId = parseInt(env.BREVO_LIST_ID || '0');
  if (!apiKey || !listId) return { ok: false, error: 'Brevo not configured' };
  try {
    const res = await fetch('https://api.brevo.com/v3/contacts/import', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listIds: [listId],
        jsonBody: contacts.map(c => ({
          email: c.email,
          attributes: { FIRSTNAME: c.firstName || '', LASTNAME: c.lastName || '' },
        })),
        updateExistingContacts: true,
        emptyContactsAttributes: false,
      }),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, processId: data.processId, count: contacts.length } : { ok: false, error: data.message || String(res.status) };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function brevoGetListContacts(env) {
  const apiKey = env.BREVO_API_KEY || '';
  const listId = parseInt(env.BREVO_LIST_ID || '0');
  if (!apiKey || !listId) return { ok: false, error: 'Brevo not configured' };
  const emails = [];
  let offset = 0;
  const limit = 500;
  try {
    while (true) {
      const res = await fetch(
        `https://api.brevo.com/v3/contacts/lists/${listId}/contacts?limit=${limit}&offset=${offset}&sort=asc`,
        { headers: { 'api-key': apiKey } }
      );
      if (!res.ok) { const d = await res.json().catch(() => ({})); return { ok: false, error: d.message || String(res.status) }; }
      const data = await res.json();
      const batch = data.contacts || [];
      for (const c of batch) { if (c.email) emails.push(c.email.toLowerCase()); }
      if (batch.length < limit) break;
      offset += limit;
    }
    return { ok: true, emails };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── Brevo Transactional Email (giving statements/mid-year updates) ───────────
// Newsletter/contact-list sync above uses Brevo's Contacts API; this is a separate Brevo
// product (Transactional Email) — same account/API key, different endpoint. Church chose
// Brevo over Resend for these sends specifically: its free tier caps at 300/day vs Resend's
// 100/day, and the giving-letter volume here is sporadic (a few batch sends a year) rather
// than a steady daily load, so there's plenty of headroom alongside the one weekly
// newsletter also going out through this same Brevo account.
export async function sendBrevoTransactionalEmail(env, { toEmail, toName, subject, html, fromName, fromEmail }) {
  const apiKey = env.BREVO_API_KEY || '';
  if (!apiKey) return { ok: false, error: 'BREVO_API_KEY not set in Worker environment', status: 500 };
  if (!fromEmail) return { ok: false, error: 'church_from_email not configured in Settings', status: 400 };
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        sender: { name: fromName || 'Timothy Lutheran Church', email: fromEmail },
        to: [{ email: toEmail, name: toName || undefined }],
        subject: subject || 'Your Giving Statement',
        htmlContent: html,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Brevo returns 429 for rate/quota limits; also sniff the error code/message as a
      // fallback since exact shapes vary. Surfaced distinctly so the batch-send loop can stop
      // immediately instead of burning through every remaining recipient one at a time.
      const rateLimited = res.status === 429 || /rate.?limit|quota|daily limit/i.test(String(data.code || '') + ' ' + String(data.message || ''));
      return { ok: false, error: data.message || 'Brevo error', rate_limited: rateLimited, status: res.status === 429 ? 429 : 500 };
    }
    return { ok: true, id: data.messageId };
  } catch (e) { return { ok: false, error: e.message, status: 500 }; }
}

// Central Time MM-DD for "today" — independent of when the cron/test fires.
// Uses Intl with America/Chicago so DST is handled automatically.
function centralTodayMMDD() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const mm = parts.find(p => p.type === 'month').value;
  const dd = parts.find(p => p.type === 'day').value;
  return `${mm}-${dd}`;
}

// Central Time day-of-week (0=Sun..6=Sat).
function centralDayOfWeek(d) {
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', weekday: 'short',
  }).format(d || new Date());
  return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[wd];
}

// Central Time YYYY-MM-DD for "today".
function centralTodayISO() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const yyyy = parts.find(p => p.type === 'year').value;
  const mm = parts.find(p => p.type === 'month').value;
  const dd = parts.find(p => p.type === 'day').value;
  return `${yyyy}-${mm}-${dd}`;
}

// Central Time YYYY-MM-DD for a stored `ts` value (audit_log.ts is UTC datetime('now')).
function centralDateOf(tsUtc) {
  const d = new Date(tsUtc.replace(' ', 'T') + 'Z');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const yyyy = parts.find(p => p.type === 'year').value;
  const mm = parts.find(p => p.type === 'month').value;
  const dd = parts.find(p => p.type === 'day').value;
  return `${yyyy}-${mm}-${dd}`;
}

// SW9: audit_log.ts is stored as UTC, but the dedup check needs "already sent today" in
// Central time (matching the Central-time eligibility queries) — a plain `date(ts)=date('now')`
// SQL comparison is UTC-vs-UTC and drifts a day off from Central once evening rolls past the
// UTC date boundary (~6-7pm Central), which could let an admin's manual re-trigger duplicate
// a send the 9am-Central cron already made earlier that day. Widen the SQL window (cheap, uses
// the ts index) and do the exact Central-calendar-day match in JS, where DST is handled by Intl.
async function alreadySentTodayCentral(db, action) {
  const todayCentral = centralTodayISO();
  const rows = ((await db.prepare(
    `SELECT entity_id, ts FROM audit_log WHERE action=? AND ts >= datetime('now','-2 days')`
  ).bind(action).all()).results || []);
  return new Set(
    rows.filter(r => centralDateOf(r.ts) === todayCentral).map(r => String(r.entity_id))
  );
}

// Escape user-provided strings before embedding in email HTML (BG3 defense-in-depth).
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { centralDayOfWeek };

async function sendResend(env, to, subject, text, htmlBody, replyTo) {
  const key = env.RESEND_API_KEY || '';
  const from = env.EMAIL_FROM || '';
  if (!key || !from) return { ok: false, error: 'Resend not configured (missing RESEND_API_KEY or EMAIL_FROM)' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text, html: htmlBody, reply_to: replyTo || env.REPLY_TO_EMAIL || 'office@timothystl.org' }),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, id: data.id } : { ok: false, error: data.message || String(res.status) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Email templates ──────────────────────────────────────────────────────────

const CHURCH_FOOTER = `
  <div style="margin-top:32px;padding-top:20px;border-top:1px solid #E8E0D0;font-size:.8rem;color:#7A6E60;text-align:center;">
    Timothy Lutheran Church &middot; 6704 Fyler Ave, St. Louis, MO 63139
  </div>`;

function emailShell(body) {
  return `<!DOCTYPE html><html><body style="font-family:Georgia,serif;background:#FAF7F0;margin:0;padding:32px 16px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px 32px;border:1px solid #E8E0D0;">
    ${body}${CHURCH_FOOTER}
  </div></body></html>`;
}

function birthdayHtml(firstName) {
  const n = esc(firstName);
  return emailShell(`
    <p style="font-size:1.2rem;color:#0A3C5C;font-weight:600;margin-bottom:16px;">Happy Birthday, ${n}!</p>
    <p style="color:#3D3530;line-height:1.7;">Wishing you a very blessed and joyful birthday. May God's grace and love surround you today and throughout the year ahead.</p>
    <p style="color:#3D3530;line-height:1.7;margin-top:16px;">With warm regards,<br>Your friends at Timothy Lutheran Church</p>`);
}

function birthdayText(firstName) {
  return `Happy Birthday, ${firstName}!\n\nWishing you a very blessed and joyful birthday. May God's grace and love surround you today and throughout the year ahead.\n\nWith warm regards,\nTimothy Lutheran Church\n6704 Fyler Ave, St. Louis, MO 63139`;
}

function anniversaryHtml(name1, name2) {
  const n1 = esc(name1), n2 = name2 ? esc(name2) : null;
  const greeting = n2 ? `Happy Anniversary, ${n1} and ${n2}!` : `Happy Anniversary, ${n1}!`;
  const salutation = n2 ? `Dear ${n1} and ${n2},` : `Dear ${n1},`;
  return emailShell(`
    <p style="font-size:1.2rem;color:#0A3C5C;font-weight:600;margin-bottom:16px;">${greeting}</p>
    <p style="color:#3D3530;line-height:1.7;">${salutation}</p>
    <p style="color:#3D3530;line-height:1.7;margin-top:8px;">Wishing you a blessed anniversary. May God continue to strengthen and bless your marriage with joy, love, and grace.</p>
    <p style="color:#3D3530;line-height:1.7;margin-top:16px;">With warm regards,<br>Your friends at Timothy Lutheran Church</p>`);
}

function anniversaryText(name1, name2) {
  const greeting = name2 ? `Happy Anniversary, ${name1} and ${name2}!` : `Happy Anniversary, ${name1}!`;
  const salutation = name2 ? `Dear ${name1} and ${name2},` : `Dear ${name1},`;
  return `${greeting}\n\n${salutation}\n\nWishing you a blessed anniversary. May God continue to strengthen and bless your marriage with joy, love, and grace.\n\nWith warm regards,\nTimothy Lutheran Church\n6704 Fyler Ave, St. Louis, MO 63139`;
}

// ── SMS helpers (SMS1) ──────────────────────────────────────────────────────

function normalizePhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return null;
}

async function sendTwilioSms(env, to, content) {
  const sid = env.TWILIO_ACCOUNT_SID || '';
  if (!sid) return { ok: false, error: 'Twilio not configured (missing TWILIO_ACCOUNT_SID)' };
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    const body = new URLSearchParams({ To: to, From: env.TWILIO_PHONE_NUMBER || '', Body: content });
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(sid + ':' + (env.TWILIO_AUTH_TOKEN || '')),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true } : { ok: false, error: data.message || String(res.status) };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function sendBirthdayTexts(env) {
  const db = env.DB;
  const todayMMDD = centralTodayMMDD();
  const alreadySent = await alreadySentTodayCentral(db, 'birthday_sms_sent');
  const people = (await db.prepare(
    `SELECT id, first_name, last_name, phone FROM people
     WHERE active=1 AND (status IS NULL OR status='active') AND (deceased=0 OR deceased IS NULL)
       AND sms_opt_in=1 AND phone != '' AND dob != ''
       AND LOWER(member_type) NOT IN ('visitor','inactive','other','organization')
       AND strftime('%m-%d', dob) = ?`
  ).bind(todayMMDD).all()).results || [];
  let sent = 0, skipped = 0;
  const errors = [];
  const targets = [];
  for (const p of people) {
    if (alreadySent.has(String(p.id))) { skipped++; continue; }
    const e164 = normalizePhone(p.phone);
    if (!e164) { errors.push(`${p.first_name} ${p.last_name}: invalid phone ${p.phone}`); continue; }
    targets.push({ p, e164 });
  }
  const results = await Promise.all(targets.map(({ p, e164 }) =>
    sendTwilioSms(env, e164, `Happy Birthday, ${p.first_name}! Wishing you a blessed day. - Timothy Lutheran Church`)
      .then(r => ({ p, r }))));
  const auditStmts = [];
  for (const { p, r } of results) {
    if (r.ok) {
      sent++;
      auditStmts.push(db.prepare(
        `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,new_value) VALUES(?,?,?,?,?,?)`
      ).bind('birthday_sms_sent', 'person', p.id, `${p.first_name} ${p.last_name}`.trim(), 'phone', p.phone));
    } else errors.push(`${p.first_name} ${p.last_name}: ${r.error}`);
  }
  if (auditStmts.length) await db.batch(auditStmts);
  return { sent, skipped, errors, total: people.length };
}

export async function sendAnniversaryTexts(env) {
  const db = env.DB;
  const todayMMDD = centralTodayMMDD();
  const alreadySent = await alreadySentTodayCentral(db, 'anniversary_sms_sent');
  const rows = (await db.prepare(
    `SELECT id, first_name, last_name, phone, anniversary_date, family_role, household_id FROM people
     WHERE active=1 AND (status IS NULL OR status='active') AND (deceased=0 OR deceased IS NULL)
       AND sms_opt_in=1 AND phone != '' AND anniversary_date != ''
       AND LOWER(member_type) NOT IN ('visitor','inactive','other','organization')
       AND LOWER(marital_status) != 'widowed'
       AND household_id IS NOT NULL AND household_id != ''
       AND strftime('%m-%d', anniversary_date) = ?
       AND NOT EXISTS (
         SELECT 1 FROM people p2
         WHERE p2.household_id=people.household_id AND p2.id!=people.id
           AND (p2.deceased=1 OR p2.status='deceased') AND p2.family_role IN ('head','spouse')
       )
     ORDER BY household_id, CASE family_role WHEN 'head' THEN 0 WHEN 'spouse' THEN 1 ELSE 2 END`
  ).bind(todayMMDD).all()).results || [];
  const hhMap = new Map();
  for (const p of rows) {
    const key = p.household_id ? String(p.household_id) : `_${p.id}`;
    if (!hhMap.has(key)) hhMap.set(key, []);
    hhMap.get(key).push(p);
  }
  let sent = 0, skipped = 0;
  const errors = [];
  const sends = []; // { hhKey, p, content, members, name2, p1 }
  for (const members of hhMap.values()) {
    const p1 = members[0];
    const dedupeKey = String(p1.household_id || p1.id);
    if (alreadySent.has(dedupeKey)) { skipped++; continue; }
    if (members.length < 2) { skipped++; continue; }
    const name2 = members[1].first_name;
    const greeting = `Happy Anniversary, ${p1.first_name} and ${name2}!`;
    const content = `${greeting} Wishing you a blessed anniversary. - Timothy Lutheran Church`;
    for (const p of members) {
      const e164 = normalizePhone(p.phone);
      if (!e164) continue;
      sends.push({ p1, p, e164, content, name2, members });
    }
  }
  const results = await Promise.all(sends.map(s =>
    sendTwilioSms(env, s.e164, s.content).then(r => ({ s, r }))));
  const householdSent = new Map();
  for (const { s, r } of results) {
    if (r.ok) { sent++; householdSent.set(String(s.p1.household_id || s.p1.id), s); }
    else errors.push(`${s.p.first_name}: ${r.error}`);
  }
  const auditStmts = [];
  for (const s of householdSent.values()) {
    auditStmts.push(db.prepare(
      `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,new_value) VALUES(?,?,?,?,?,?)`
    ).bind('anniversary_sms_sent', 'household', s.p1.household_id || s.p1.id,
      `${s.p1.first_name}${s.name2 ? ' & ' + s.name2 : ''}`, 'phone',
      s.members.map(p => p.phone).filter(Boolean).join(', ')));
  }
  if (auditStmts.length) await db.batch(auditStmts);
  return { sent, skipped, errors, total: rows.length };
}

// ── Birthday sends ───────────────────────────────────────────────────────────

export async function sendBirthdayEmails(env) {
  const db = env.DB;
  const todayMMDD = centralTodayMMDD();

  // Dedup: skip anyone already emailed today
  const alreadySent = await alreadySentTodayCentral(db, 'birthday_email_sent');

  const people = (await db.prepare(
    `SELECT id, first_name, last_name, email FROM people
     WHERE active=1 AND (status IS NULL OR status='active')
       AND (deceased=0 OR deceased IS NULL)
       AND LOWER(member_type) NOT IN ('visitor','inactive','other','organization')
       AND email != '' AND dob != ''
       AND strftime('%m-%d', dob) = ?`
  ).bind(todayMMDD).all()).results || [];

  let sent = 0, skipped = 0;
  const errors = [];
  const targets = people.filter(p => {
    if (alreadySent.has(String(p.id))) { skipped++; return false; }
    return true;
  });
  const results = await Promise.all(targets.map(p =>
    sendResend(env, p.email, `Happy Birthday, ${p.first_name}!`,
      birthdayText(p.first_name), birthdayHtml(p.first_name))
      .then(r => ({ p, r }))));
  const auditStmts = [];
  for (const { p, r } of results) {
    if (r.ok) {
      sent++;
      auditStmts.push(db.prepare(
        `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,new_value) VALUES(?,?,?,?,?,?)`
      ).bind('birthday_email_sent', 'person', p.id, `${p.first_name} ${p.last_name}`.trim(), 'email', p.email));
    } else errors.push(`${p.first_name} ${p.last_name}: ${r.error}`);
  }
  if (auditStmts.length) await db.batch(auditStmts);
  return { sent, skipped, errors, total: people.length };
}

// ── Anniversary sends ────────────────────────────────────────────────────────

export async function sendAnniversaryEmails(env) {
  const db = env.DB;
  const todayMMDD = centralTodayMMDD();

  // Dedup keyed by household_id (couples) or person_id (solo)
  const alreadySent = await alreadySentTodayCentral(db, 'anniversary_email_sent');

  const rows = (await db.prepare(
    `SELECT id, first_name, last_name, email, anniversary_date, family_role, household_id FROM people
     WHERE active=1 AND (status IS NULL OR status='active')
       AND (deceased=0 OR deceased IS NULL) AND anniversary_date != ''
       AND LOWER(member_type) NOT IN ('visitor','inactive','other','organization')
       AND LOWER(marital_status) != 'widowed'
       AND household_id IS NOT NULL AND household_id != ''
       AND strftime('%m-%d', anniversary_date) = ?
       AND NOT EXISTS (
         SELECT 1 FROM people p2
         WHERE p2.household_id=people.household_id AND p2.id!=people.id
           AND (p2.deceased=1 OR p2.status='deceased') AND p2.family_role IN ('head','spouse')
       )
     ORDER BY household_id, CASE family_role WHEN 'head' THEN 0 WHEN 'spouse' THEN 1 ELSE 2 END`
  ).bind(todayMMDD).all()).results || [];

  // Group by household
  const hhMap = new Map();
  for (const p of rows) {
    const key = p.household_id ? String(p.household_id) : `_${p.id}`;
    if (!hhMap.has(key)) hhMap.set(key, []);
    hhMap.get(key).push(p);
  }

  let sent = 0, skipped = 0;
  const errors = [];

  // Flatten into independent send tasks so we can fire them in parallel,
  // then attribute results back to their household for audit logging.
  const sends = []; // { kind: 'shared'|'split'|'solo', hhKey, p1, p2, person, partner, to, subject, text, html, errLabel }
  const hhInfo = new Map(); // hhKey -> { p1, p2, members } for audit log composition

  for (const members of hhMap.values()) {
    const p1 = members[0];
    const dedupeKey = String(p1.household_id || p1.id);
    if (alreadySent.has(dedupeKey)) { skipped++; continue; }
    const hhKey = p1.household_id || p1.id;

    if (members.length >= 2) {
      const p2 = members[1];
      hhInfo.set(String(hhKey), { p1, p2, members });
      const sharedEmail = p1.email && p2.email && p1.email === p2.email;
      if (sharedEmail) {
        sends.push({
          kind: 'shared', hhKey, p1, p2,
          to: p1.email, subject: `Happy Anniversary, ${p1.first_name} and ${p2.first_name}!`,
          text: anniversaryText(p1.first_name, p2.first_name),
          html: anniversaryHtml(p1.first_name, p2.first_name),
          errLabel: `${p1.first_name} & ${p2.first_name}`,
        });
      } else {
        for (const [person, partner] of [[p1, p2], [p2, p1]]) {
          if (!person.email) continue;
          sends.push({
            kind: 'split', hhKey, p1, p2, person, partner,
            to: person.email, subject: `Happy Anniversary, ${person.first_name}!`,
            text: anniversaryText(person.first_name, partner.first_name),
            html: anniversaryHtml(person.first_name, partner.first_name),
            errLabel: person.first_name,
          });
        }
      }
    } else {
      // No living household partner found — skip solo anniversary sends
      skipped++;
      continue;
    }
  }

  const results = await Promise.all(sends.map(s =>
    sendResend(env, s.to, s.subject, s.text, s.html).then(r => ({ s, r }))));

  // Track which households had at least one successful send.
  const householdOk = new Set();
  for (const { s, r } of results) {
    if (r.ok) { sent++; householdOk.add(String(s.hhKey) + ':' + s.kind + ':' + (s.person?.id || '')); }
    else errors.push(`${s.errLabel}: ${r.error}`);
  }

  // Compose one audit-log row per household that succeeded.
  const auditStmts = [];
  const audited = new Set();
  for (const { s, r } of results) {
    if (!r.ok) continue;
    const key = String(s.hhKey);
    if (audited.has(key)) continue;
    audited.add(key);
    if (s.kind === 'solo') {
      const p1 = s.p1;
      auditStmts.push(db.prepare(
        `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,new_value) VALUES(?,?,?,?,?,?)`
      ).bind('anniversary_email_sent', 'person', p1.id,
        `${p1.first_name} ${p1.last_name}`.trim(), 'email', p1.email));
    } else {
      const info = hhInfo.get(key);
      const p1 = info.p1, p2 = info.p2;
      const emails = s.kind === 'shared' ? p1.email : [p1.email, p2.email].filter(Boolean).join(', ');
      auditStmts.push(db.prepare(
        `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,new_value) VALUES(?,?,?,?,?,?)`
      ).bind('anniversary_email_sent', 'household', s.hhKey,
        `${p1.first_name} & ${p2.first_name}`, 'email', emails));
    }
  }
  if (auditStmts.length) await db.batch(auditStmts);
  return { sent, skipped, errors, total: rows.length };
}

