/**
 * breeze-proxy-worker.js
 * Cloudflare Worker — Worship Scheduler backend
 *
 * Environment variables (set in Cloudflare Dashboard → Worker → Settings → Variables):
 *   WORKER_SECRET   — optional shared secret; if set, all requests must include
 *                     X-Worker-Secret header matching this value
 *   BREEZE_SUBDOMAIN — your Breeze subdomain (e.g. "mychurch" for mychurch.breezechms.com)
 *                      Can also be passed per-request via X-Breeze-Subdomain header
 *   BREEZE_API_KEY  — your Breeze API key
 *                      Can also be passed per-request via X-Breeze-Api-Key header
 *   RESEND_API_KEY  — Resend API key (re_xxxxxxxx) for sending notification emails
 *   EMAIL_FROM      — verified sender address (e.g. dinger@reminder.timothystl.org)
 *   NOTIFY_EMAIL    — admin email address to receive volunteer signup notifications
 *
 * KV namespace binding (Cloudflare Dashboard → Worker → KV Namespace Bindings):
 *   RSVP_KV         — KV namespace for storing RSVP tokens and responses
 *                     (also stores pending worship volunteer signups under wv:pending:* keys)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Worker-Secret, X-Resend-Key, X-Email-From, X-Breeze-Subdomain, X-Breeze-Api-Key',
};

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ── Secret check (skip for volunteer-facing endpoints) ───────────────────
    const isPublic = path === '/rsvp' || path.startsWith('/rsvp/portal') || path === '/volunteer/signup';
    if (!isPublic && env.WORKER_SECRET) {
      const secret = request.headers.get('X-Worker-Secret') || '';
      if (secret !== env.WORKER_SECRET) {
        return json({ error: 'Unauthorized' }, 401);
      }
    }

    // ── Route ─────────────────────────────────────────────────────────────────
    if (path === '/volunteer/signup' && request.method === 'POST') {
      return handleVolunteerSignup(request, env);
    }
    if (path === '/volunteer/pending' && request.method === 'GET') {
      return handleVolunteerPending(request, env);
    }
    if (path === '/volunteer/claim' && request.method === 'POST') {
      return handleVolunteerClaim(request, env);
    }
    if (path === '/email/send' && request.method === 'POST') {
      return handleEmailSend(request, env);
    }
    if (path === '/rsvp/store' && request.method === 'POST') {
      return handleRsvpStore(request, env);
    }
    if (path === '/rsvp/sync' && request.method === 'POST') {
      return handleRsvpSync(request, env);
    }
    if (path === '/rsvp/portal') {
      return handleRsvpPortal(request, env);
    }
    if (path === '/rsvp') {
      return handleRsvp(request, env);
    }
    // Breeze API proxy — accepts both /breeze/* and /api/* prefixes
    if (path.startsWith('/breeze/') || path.startsWith('/api/')) {
      return handleBreezeProxy(request, env, url);
    }

    return json({ error: 'Not found' }, 404);
  },
};

// ── /email/send ───────────────────────────────────────────────────────────────
async function handleEmailSend(request, env) {
  const resendKey = request.headers.get('X-Resend-Key') || env.RESEND_API_KEY || '';
  const emailFrom = request.headers.get('X-Email-From') || env.EMAIL_FROM || '';
  if (!resendKey) return json({ error: 'Missing Resend API key' }, 400);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const payload = {
    from:     emailFrom || body.from || '',
    to:       body.to,
    subject:  body.subject,
    text:     body.text,
    html:     body.html,
    reply_to: body.reply_to || undefined,
  };
  if (body.attachments) payload.attachments = body.attachments;

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  const data = await res.json();
  return json(data, res.status);
}

// ── /rsvp/store ───────────────────────────────────────────────────────────────
// Stores volunteer token data so the /rsvp endpoint can look it up later.
async function handleRsvpStore(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { token, name, personId, notifyEmail, assignments } = body;
  if (!token) return json({ error: 'Missing token' }, 400);

  const existing = await kvGet(env, token);
  const record = existing || { token, name, personId, notifyEmail: notifyEmail || '', assignments: assignments || [], responses: {} };

  // Update fields that may have changed on re-send
  record.name        = name        || record.name;
  record.personId    = personId    || record.personId;
  record.notifyEmail = notifyEmail || record.notifyEmail;
  record.assignments = assignments || record.assignments;

  await kvPut(env, token, record);
  return json({ ok: true });
}

// ── /rsvp ─────────────────────────────────────────────────────────────────────
// Volunteer clicks a link in their email.  Updates KV, then emails the admin.
async function handleRsvp(request, env) {
  const url    = new URL(request.url);
  const token  = url.searchParams.get('token')  || '';
  const status = url.searchParams.get('status') || '';
  const idx    = url.searchParams.get('idx');    // null = all assignments

  if (!token || !status) return htmlPage('Error', '<p>Invalid link.</p>');

  const record = await kvGet(env, token);
  if (!record) return htmlPage('Not Found', '<p>This link has expired or is invalid.</p>');

  const validStatuses = ['confirmed', 'needs_changes', 'declined'];
  if (!validStatuses.includes(status)) return htmlPage('Error', '<p>Unknown status.</p>');

  // Update responses in KV
  if (idx !== null && idx !== undefined) {
    const i = parseInt(idx, 10);
    if (!isNaN(i) && record.assignments[i]) {
      record.assignments[i].status = status;
    }
  } else {
    record.assignments.forEach(function(a) { a.status = status; });
  }
  record.overallStatus = status;
  record.updatedAt     = new Date().toISOString();
  await kvPut(env, token, record);

  // ── Send admin notification ────────────────────────────────────────────────
  const notifyEmail = record.notifyEmail || '';
  if (notifyEmail) {
    const resendKey = env.RESEND_API_KEY || '';
    const emailFrom = env.EMAIL_FROM     || '';
    if (resendKey && emailFrom) {
      const statusLabel = status === 'confirmed'     ? '✓ Confirmed'
                        : status === 'needs_changes' ? '⚠ Needs Changes'
                        : '✗ Declined';
      const assignmentLines = record.assignments.map(function(a) {
        var svcLabel = a.svc === '8am' ? '8:00 AM' : a.svc === '10:45am' ? '10:45 AM' : a.svc;
        return '  • ' + a.date + ' — ' + svcLabel + ' — ' + a.role;
      }).join('\n');

      const subject = 'Worship Scheduler: ' + record.name + ' — ' + statusLabel;
      const text    = record.name + ' responded to their worship service assignments.\n\n'
                    + 'Status: ' + statusLabel + '\n\n'
                    + 'Assignments:\n' + assignmentLines + '\n\n'
                    + 'View schedule: ' + url.origin + '/rsvp/portal?token=' + encodeURIComponent(token);

      await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from:    emailFrom,
          to:      notifyEmail,
          subject: subject,
          text:    text,
        }),
      }).catch(function() { /* non-fatal — volunteer still sees success */ });
    }
  }

  // ── Confirmation page for the volunteer ───────────────────────────────────
  const msgMap = {
    confirmed:     { h: 'Thank you!',          b: "You're confirmed. We look forward to serving with you." },
    needs_changes: { h: 'Got it!',             b: "We'll be in touch to work out the details." },
    declined:      { h: 'Response recorded.',  b: "We'll find someone else for these dates. Thank you for letting us know." },
  };
  const msg = msgMap[status] || { h: 'Response recorded.', b: '' };
  return htmlPage(msg.h, '<p>' + msg.b + '</p>');
}

// ── /rsvp/sync ────────────────────────────────────────────────────────────────
// Frontend polls this to pull volunteer responses into localStorage.
async function handleRsvpSync(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const tokens = body.tokens || [];
  const results = {};

  await Promise.all(tokens.map(async function(token) {
    const record = await kvGet(env, token);
    if (!record) return;
    results[token] = {
      status:      record.overallStatus || 'pending',
      name:        record.name          || '',
      updatedAt:   record.updatedAt     || '',
      assignments: (record.assignments  || []).map(function(a) {
        return { dateISO: a.dateISO, svc: a.svc, role: a.role, status: a.status || 'pending' };
      }),
    };
  }));

  return json(results);
}

// ── /rsvp/portal ─────────────────────────────────────────────────────────────
// Volunteer views their full schedule and can update each assignment.
async function handleRsvpPortal(request, env) {
  const url   = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  if (!token) return htmlPage('Error', '<p>Missing token.</p>');

  const record = await kvGet(env, token);
  if (!record) return htmlPage('Not Found', '<p>This link has expired or is invalid.</p>');

  const rows = (record.assignments || []).map(function(a, i) {
    const svcLabel = a.svc === '8am' ? '8:00 AM' : a.svc === '10:45am' ? '10:45 AM' : a.svc;
    const cfUrl    = url.origin + '/rsvp?token=' + encodeURIComponent(token) + '&idx=' + i + '&status=confirmed';
    const ncUrl    = url.origin + '/rsvp?token=' + encodeURIComponent(token) + '&idx=' + i + '&status=needs_changes';
    const st       = a.status || 'pending';
    const stLabel  = st === 'confirmed' ? '✓ Confirmed' : st === 'needs_changes' ? '⚠ Needs Changes' : '';
    return '<tr>'
      + '<td style="padding:8px 12px;border-bottom:1px solid #eee;">' + esc(a.date)    + '</td>'
      + '<td style="padding:8px 12px;border-bottom:1px solid #eee;">' + esc(svcLabel)  + '</td>'
      + '<td style="padding:8px 12px;border-bottom:1px solid #eee;">' + esc(a.role)    + '</td>'
      + '<td style="padding:8px 12px;border-bottom:1px solid #eee;color:#555;">' + esc(stLabel) + '</td>'
      + '<td style="padding:8px 12px;border-bottom:1px solid #eee;">'
      +   '<a href="' + cfUrl + '" style="margin-right:8px;color:#27ae60;">✓ Confirm</a>'
      +   '<a href="' + ncUrl + '" style="color:#e67e22;">⚠ Change</a>'
      + '</td>'
      + '</tr>';
  }).join('');

  const body = '<h2 style="margin-bottom:4px;">Hello, ' + esc(record.name) + '</h2>'
    + '<p style="color:#555;margin-bottom:20px;">Your upcoming worship service assignments:</p>'
    + '<table style="border-collapse:collapse;width:100%;font-size:.9rem;">'
    + '<thead><tr>'
    + '<th style="text-align:left;padding:8px 12px;background:#f5f6fa;">Date</th>'
    + '<th style="text-align:left;padding:8px 12px;background:#f5f6fa;">Service</th>'
    + '<th style="text-align:left;padding:8px 12px;background:#f5f6fa;">Role</th>'
    + '<th style="text-align:left;padding:8px 12px;background:#f5f6fa;">Status</th>'
    + '<th style="text-align:left;padding:8px 12px;background:#f5f6fa;">Response</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table>';

  return htmlPage('Your Worship Schedule', body);
}

// ── Breeze API proxy ──────────────────────────────────────────────────────────
// Accepts both /breeze/* and /api/* prefixes from the frontend.
// Credentials are read from Cloudflare env vars with per-request header fallback.
async function handleBreezeProxy(request, env, url) {
  const breezeSubdomain = env.BREEZE_SUBDOMAIN
    || request.headers.get('X-Breeze-Subdomain') || '';
  const breezeApiKey = env.BREEZE_API_KEY
    || request.headers.get('X-Breeze-Api-Key') || '';
  if (!breezeSubdomain || !breezeApiKey) return json({ error: 'Breeze not configured' }, 500);

  // Strip /breeze or /api prefix — both map to Breeze's /api endpoint
  const breezePath = url.pathname.replace(/^\/(breeze|api)/, '');
  const breezeUrl  = 'https://' + breezeSubdomain + '.breezechms.com/api' + breezePath + url.search;

  const res = await fetch(breezeUrl, {
    method:  request.method,
    headers: { 'Api-key': breezeApiKey, 'Content-Type': 'application/json' },
    body:    request.method !== 'GET' ? request.body : undefined,
  });
  const data = await res.text();
  return new Response(data, {
    status:  res.status,
    headers: { ...CORS_HEADERS, 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
  });
}

// ── /volunteer/signup ─────────────────────────────────────────────────────
// Public endpoint — called from volunteer.html when someone submits a form.
// Sends an admin notification email; worship signups are also queued in KV.
async function handleVolunteerSignup(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { name, email, phone, ministry, roles, service, sundays, notes } = body;
  if (!name || !email) return json({ error: 'Missing name or email' }, 400);

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const submittedAt = new Date().toISOString();
  const record = { id, name, email, phone: phone || '', ministry: ministry || 'general',
    roles: roles || [], service: service || '', sundays: sundays || [],
    notes: notes || '', submittedAt };

  // Store worship signups in KV so the scheduler can import them
  if (ministry === 'worship' && env.RSVP_KV) {
    await env.RSVP_KV.put('wv:pending:' + id, JSON.stringify(record), { expirationTtl: 60 * 60 * 24 * 365 });
  }

  // Send admin notification email
  const notifyEmail = env.NOTIFY_EMAIL || '';
  const resendKey   = env.RESEND_API_KEY || '';
  const emailFrom   = env.EMAIL_FROM || '';
  if (notifyEmail && resendKey && emailFrom) {
    const labels = { worship: 'Worship', events: 'Community Events', education: 'Christian Education',
      acceptance: 'Acceptance Ministry', outreach: 'Outreach', general: 'General Interest' };
    const ministryLabel = labels[ministry] || ministry;
    const rolesList = (roles && roles.length) ? roles.join(', ') : '(none selected)';
    let details = '';
    if (service)              details += 'Service preference: ' + service + '\n';
    if (sundays && sundays.length) details += 'Preferred Sundays: ' + sundays.map(function(s) {
      return s + (['1','2','3'].includes(s) ? ['st','nd','rd'][+s-1] : 'th') + ' Sunday';
    }).join(', ') + '\n';
    if (phone)                details += 'Phone: ' + phone + '\n';
    if (notes)                details += 'Notes: ' + notes + '\n';

    const text = 'New volunteer signup — ' + ministryLabel + '\n\n'
      + 'Name:  ' + name + '\n'
      + 'Email: ' + email + '\n'
      + details
      + 'Roles: ' + rolesList + '\n'
      + (ministry === 'worship' ? '\nThis person is in the pending worship queue — open the scheduler to import them.\n' : '');

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: emailFrom, to: notifyEmail,
        subject: 'New volunteer: ' + name + ' (' + ministryLabel + ')', text }),
    }).catch(function() { /* non-fatal */ });
  }

  return json({ ok: true });
}

// ── /volunteer/pending ────────────────────────────────────────────────────
// Returns all pending worship volunteer signups from KV (admin-only).
async function handleVolunteerPending(request, env) {
  if (!env.RSVP_KV) return json({ volunteers: [] });
  const list = await env.RSVP_KV.list({ prefix: 'wv:pending:' });
  const volunteers = await Promise.all(
    list.keys.map(async function(k) {
      const raw = await env.RSVP_KV.get(k.name);
      return raw ? JSON.parse(raw) : null;
    })
  );
  return json({ volunteers: volunteers.filter(Boolean) });
}

// ── /volunteer/claim ──────────────────────────────────────────────────────
// Removes a pending worship volunteer from the KV queue (admin-only).
async function handleVolunteerClaim(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { id } = body;
  if (!id) return json({ error: 'Missing id' }, 400);
  if (env.RSVP_KV) await env.RSVP_KV.delete('wv:pending:' + id);
  return json({ ok: true });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function json(data, status) {
  return new Response(JSON.stringify(data), {
    status:  status || 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function htmlPage(title, bodyContent) {
  const html = '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + esc(title) + ' — Timothy Lutheran</title>'
    + '<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;color:#222;}'
    + 'h1{color:#2c3e6b;}a{color:#2c3e6b;}</style></head>'
    + '<body><h1>' + esc(title) + '</h1>' + bodyContent + '</body></html>';
  return new Response(html, { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'text/html;charset=utf-8' } });
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function kvGet(env, key) {
  if (!env.RSVP_KV) return null;
  try {
    const raw = await env.RSVP_KV.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function kvPut(env, key, value) {
  if (!env.RSVP_KV) return;
  // Keep tokens for 1 year
  await env.RSVP_KV.put(key, JSON.stringify(value), { expirationTtl: 31536000 });
}
