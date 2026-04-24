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

async function sendResend(env, to, subject, text, htmlBody) {
  const key = env.RESEND_API_KEY || '';
  const from = env.EMAIL_FROM || '';
  if (!key || !from) return { ok: false, error: 'Resend not configured (missing RESEND_API_KEY or EMAIL_FROM)' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text, html: htmlBody, reply_to: 'office@timothystl.org' }),
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
  return emailShell(`
    <p style="font-size:1.2rem;color:#0A3C5C;font-weight:600;margin-bottom:16px;">Happy Birthday, ${firstName}!</p>
    <p style="color:#3D3530;line-height:1.7;">Wishing you a very blessed and joyful birthday. May God's grace and love surround you today and throughout the year ahead.</p>
    <p style="color:#3D3530;line-height:1.7;margin-top:16px;">With warm regards,<br>Your friends at Timothy Lutheran Church</p>`);
}

function birthdayText(firstName) {
  return `Happy Birthday, ${firstName}!\n\nWishing you a very blessed and joyful birthday. May God's grace and love surround you today and throughout the year ahead.\n\nWith warm regards,\nTimothy Lutheran Church\n6704 Fyler Ave, St. Louis, MO 63139`;
}

function anniversaryHtml(name1, name2) {
  const greeting = name2 ? `Happy Anniversary, ${name1} and ${name2}!` : `Happy Anniversary, ${name1}!`;
  const salutation = name2 ? `Dear ${name1} and ${name2},` : `Dear ${name1},`;
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

// ── Brevo SMS helpers (SMS1) ─────────────────────────────────────────────────

function normalizePhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return null;
}

async function sendBrevoSms(env, to, content) {
  const apiKey = env.BREVO_API_KEY || '';
  if (!apiKey) return { ok: false, error: 'Brevo not configured (missing BREVO_API_KEY)' };
  try {
    const res = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: 'TimothyLC', recipient: to, content, type: 'transactional' }),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true } : { ok: false, error: data.message || String(res.status) };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function sendBirthdayTexts(env) {
  const db = env.DB;
  const todayMMDD = new Date().toISOString().slice(5, 10);
  const alreadySent = new Set(
    ((await db.prepare(
      `SELECT entity_id FROM audit_log WHERE action='birthday_sms_sent' AND date(ts)=date('now')`
    ).all()).results || []).map(r => String(r.entity_id))
  );
  const people = (await db.prepare(
    `SELECT id, first_name, last_name, phone FROM people
     WHERE active=1 AND (status IS NULL OR status='active') AND sms_opt_in=1 AND phone != '' AND dob != ''
       AND LOWER(member_type) NOT IN ('visitor','inactive','other','organization')
       AND strftime('%m-%d', dob) = ?`
  ).bind(todayMMDD).all()).results || [];
  let sent = 0, skipped = 0;
  const errors = [];
  for (const p of people) {
    if (alreadySent.has(String(p.id))) { skipped++; continue; }
    const e164 = normalizePhone(p.phone);
    if (!e164) { errors.push(`${p.first_name} ${p.last_name}: invalid phone ${p.phone}`); continue; }
    const result = await sendBrevoSms(env, e164,
      `Happy Birthday, ${p.first_name}! Wishing you a blessed day. - Timothy Lutheran Church`);
    if (result.ok) {
      sent++;
      await db.prepare(
        `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,new_value) VALUES(?,?,?,?,?,?)`
      ).bind('birthday_sms_sent', 'person', p.id, `${p.first_name} ${p.last_name}`.trim(), 'phone', p.phone).run();
    } else {
      errors.push(`${p.first_name} ${p.last_name}: ${result.error}`);
    }
  }
  return { sent, skipped, errors, total: people.length };
}

export async function sendAnniversaryTexts(env) {
  const db = env.DB;
  const todayMMDD = new Date().toISOString().slice(5, 10);
  const alreadySent = new Set(
    ((await db.prepare(
      `SELECT entity_id FROM audit_log WHERE action='anniversary_sms_sent' AND date(ts)=date('now')`
    ).all()).results || []).map(r => String(r.entity_id))
  );
  const rows = (await db.prepare(
    `SELECT id, first_name, last_name, phone, anniversary_date, family_role, household_id FROM people
     WHERE active=1 AND (status IS NULL OR status='active') AND (deceased=0 OR deceased IS NULL)
       AND sms_opt_in=1 AND phone != '' AND anniversary_date != ''
       AND LOWER(member_type) NOT IN ('visitor','inactive','other','organization')
       AND strftime('%m-%d', anniversary_date) = ?
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
  for (const members of hhMap.values()) {
    const p1 = members[0];
    const dedupeKey = String(p1.household_id || p1.id);
    if (alreadySent.has(dedupeKey)) { skipped++; continue; }
    const name2 = members.length >= 2 ? members[1].first_name : null;
    const greeting = name2 ? `Happy Anniversary, ${p1.first_name} and ${name2}!` : `Happy Anniversary, ${p1.first_name}!`;
    const content = `${greeting} Wishing you a blessed anniversary. - Timothy Lutheran Church`;
    let householdSent = false;
    for (const p of members) {
      const e164 = normalizePhone(p.phone);
      if (!e164) continue;
      const result = await sendBrevoSms(env, e164, content);
      if (result.ok) { sent++; householdSent = true; }
      else errors.push(`${p.first_name}: ${result.error}`);
    }
    if (householdSent) {
      await db.prepare(
        `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,new_value) VALUES(?,?,?,?,?,?)`
      ).bind('anniversary_sms_sent', 'household', p1.household_id || p1.id,
        `${p1.first_name}${name2 ? ' & ' + name2 : ''}`, 'phone',
        members.map(p => p.phone).filter(Boolean).join(', ')).run();
    }
  }
  return { sent, skipped, errors, total: rows.length };
}

// ── Birthday sends ───────────────────────────────────────────────────────────

export async function sendBirthdayEmails(env) {
  const db = env.DB;
  const todayMMDD = new Date().toISOString().slice(5, 10); // "MM-DD"

  // Dedup: skip anyone already emailed today
  const alreadySent = new Set(
    ((await db.prepare(
      `SELECT entity_id FROM audit_log WHERE action='birthday_email_sent' AND date(ts)=date('now')`
    ).all()).results || []).map(r => String(r.entity_id))
  );

  const people = (await db.prepare(
    `SELECT id, first_name, last_name, email FROM people
     WHERE active=1 AND (status IS NULL OR status='active')
       AND LOWER(member_type) NOT IN ('visitor','inactive','other','organization')
       AND email != '' AND dob != ''
       AND strftime('%m-%d', dob) = ?`
  ).bind(todayMMDD).all()).results || [];

  let sent = 0, skipped = 0;
  const errors = [];
  for (const p of people) {
    if (alreadySent.has(String(p.id))) { skipped++; continue; }
    const result = await sendResend(env, p.email,
      `Happy Birthday, ${p.first_name}!`,
      birthdayText(p.first_name), birthdayHtml(p.first_name));
    if (result.ok) {
      sent++;
      await db.prepare(
        `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,new_value) VALUES(?,?,?,?,?,?)`
      ).bind('birthday_email_sent', 'person', p.id, `${p.first_name} ${p.last_name}`.trim(), 'email', p.email).run();
    } else {
      errors.push(`${p.first_name} ${p.last_name}: ${result.error}`);
    }
  }
  return { sent, skipped, errors, total: people.length };
}

// ── Anniversary sends ────────────────────────────────────────────────────────

export async function sendAnniversaryEmails(env) {
  const db = env.DB;
  const todayMMDD = new Date().toISOString().slice(5, 10); // "MM-DD"

  // Dedup keyed by household_id (couples) or person_id (solo)
  const alreadySent = new Set(
    ((await db.prepare(
      `SELECT entity_id FROM audit_log WHERE action='anniversary_email_sent' AND date(ts)=date('now')`
    ).all()).results || []).map(r => String(r.entity_id))
  );

  const rows = (await db.prepare(
    `SELECT id, first_name, last_name, email, anniversary_date, family_role, household_id FROM people
     WHERE active=1 AND (status IS NULL OR status='active')
       AND (deceased=0 OR deceased IS NULL) AND anniversary_date != ''
       AND LOWER(member_type) NOT IN ('visitor','inactive','other','organization')
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

  for (const members of hhMap.values()) {
    const p1 = members[0];
    const dedupeKey = String(p1.household_id || p1.id);
    if (alreadySent.has(dedupeKey)) { skipped++; continue; }

    if (members.length >= 2) {
      const p2 = members[1];
      const sharedEmail = p1.email && p2.email && p1.email === p2.email;
      if (sharedEmail) {
        // One email addressed to both
        const result = await sendResend(env, p1.email,
          `Happy Anniversary, ${p1.first_name} and ${p2.first_name}!`,
          anniversaryText(p1.first_name, p2.first_name),
          anniversaryHtml(p1.first_name, p2.first_name));
        if (result.ok) {
          sent++;
          await db.prepare(
            `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,new_value) VALUES(?,?,?,?,?,?)`
          ).bind('anniversary_email_sent', 'household', p1.household_id,
            `${p1.first_name} & ${p2.first_name}`, 'email', p1.email).run();
        } else {
          errors.push(`${p1.first_name} & ${p2.first_name}: ${result.error}`);
        }
      } else {
        // Separate emails — send to each who has an address
        for (const [person, partner] of [[p1, p2], [p2, p1]]) {
          if (!person.email) continue;
          const result = await sendResend(env, person.email,
            `Happy Anniversary, ${person.first_name}!`,
            anniversaryText(person.first_name, partner.first_name),
            anniversaryHtml(person.first_name, partner.first_name));
          if (result.ok) {
            sent++;
          } else {
            errors.push(`${person.first_name}: ${result.error}`);
          }
        }
        // Log once for the household (dedup key)
        if (!errors.find(e => e.startsWith(p1.first_name + ':') || e.startsWith(p2.first_name + ':'))) {
          await db.prepare(
            `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,new_value) VALUES(?,?,?,?,?,?)`
          ).bind('anniversary_email_sent', 'household', p1.household_id,
            `${p1.first_name} & ${p2.first_name}`, 'email', [p1.email, p2.email].filter(Boolean).join(', ')).run();
        }
      }
    } else {
      // Solo person with anniversary set
      if (!p1.email) continue;
      const result = await sendResend(env, p1.email,
        `Happy Anniversary, ${p1.first_name}!`,
        anniversaryText(p1.first_name, null),
        anniversaryHtml(p1.first_name, null));
      if (result.ok) {
        sent++;
        await db.prepare(
          `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,new_value) VALUES(?,?,?,?,?,?)`
        ).bind('anniversary_email_sent', 'person', p1.id,
          `${p1.first_name} ${p1.last_name}`.trim(), 'email', p1.email).run();
      } else {
        errors.push(`${p1.first_name}: ${result.error}`);
      }
    }
  }
  return { sent, skipped, errors, total: rows.length };
}
