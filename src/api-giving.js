// ── Giving Entries, Batches, Quick Entry API handlers ──────────────────────
import { json } from './auth.js';
import { isoWeekKey, LETTER_TYPES, mergeLetterRecipients, computeReceiptQueue } from './api-utils.js';

export async function handleGivingApi(req, env, url, method, seg, db, isAdmin, isFinance, isStaff, canEdit) {

if (method !== 'GET' && !isFinance) return json({ error: 'Access denied' }, 403);

// ── Giving Entries — list for a person ──────────────────────────
if (seg === 'giving' && method === 'GET') {
  const personId = url.searchParams.get('person_id');
  const year     = url.searchParams.get('year') || '';
  const limit    = Math.min(parseInt(url.searchParams.get('limit') || '500'), 2000);
  if (!personId) return json({ error: 'person_id required' }, 400);
  let sql = `SELECT ge.id, ge.amount, ge.method, ge.check_number, ge.notes,
              ge.fund_id, ge.batch_id, gb.closed as batch_closed, gb.description as batch_description,
              COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) as contribution_date,
              f.name as fund_name
             FROM giving_entries ge
             JOIN funds f ON ge.fund_id=f.id
             JOIN giving_batches gb ON ge.batch_id=gb.id
             WHERE ge.person_id=?`;
  const binds = [parseInt(personId)];
  if (year) {
    sql += ` AND substr(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date),1,4)=?`;
    binds.push(year);
  }
  sql += ` ORDER BY COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) DESC, ge.id DESC LIMIT ?`;
  binds.push(limit);
  const entries = (await db.prepare(sql).bind(...binds).all()).results || [];
  return json({ entries });
}

// ── Giving Batches ───────────────────────────────────────────────
if (seg === 'giving/batches' && method === 'GET') {
  const status = url.searchParams.get('status') || 'all';
  let sql = `SELECT gb.*, COUNT(ge.id) as entry_count, COALESCE(SUM(ge.amount),0) as total_cents
             FROM giving_batches gb LEFT JOIN giving_entries ge ON ge.batch_id=gb.id`;
  const binds = [];
  if (status === 'open') { sql += ' WHERE gb.closed=0'; }
  else if (status === 'closed') { sql += ' WHERE gb.closed=1'; }
  sql += ' GROUP BY gb.id ORDER BY gb.batch_date DESC, gb.id DESC LIMIT 100';
  const rows = (await db.prepare(sql).bind(...binds).all()).results || [];
  return json({ batches: rows });
}

// ── Giving tab overview stat tiles (This Week / This Month / YTD / Givers) ──
if (seg === 'giving/stats' && method === 'GET') {
  const weekStart  = isoWeekKey();
  const monthStart = new Date().toISOString().slice(0, 7) + '-01';
  const yearStart  = new Date().toISOString().slice(0, 4) + '-01-01';
  const row = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN d>=? THEN amount END),0) as week_total,
      COALESCE(SUM(CASE WHEN d>=? THEN amount END),0) as month_total,
      COALESCE(SUM(CASE WHEN d>=? THEN amount END),0) as ytd_total,
      COUNT(DISTINCT CASE WHEN d>=? AND person_id IS NOT NULL THEN person_id END) as givers
    FROM (
      SELECT ge.amount as amount, ge.person_id as person_id,
             COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) as d
      FROM giving_entries ge JOIN giving_batches gb ON ge.batch_id=gb.id
    )
    WHERE d>=?`
  ).bind(weekStart, monthStart, yearStart, yearStart, yearStart).first();
  return json({
    weekTotal: row?.week_total || 0,
    monthTotal: row?.month_total || 0,
    ytdTotal: row?.ytd_total || 0,
    givers: row?.givers || 0
  });
}

// ── Flat transaction view (Batches/Transactions toggle) — fund + date-range filterable ──
if (seg === 'giving/transactions' && method === 'GET') {
  const fundId = url.searchParams.get('fund_id');
  const from   = url.searchParams.get('from') || '';
  const to     = url.searchParams.get('to') || '';
  const limit  = Math.min(parseInt(url.searchParams.get('limit') || '200'), 500);
  let sql = `SELECT ge.id, ge.amount, ge.method, ge.check_number, ge.batch_id,
              COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) as txn_date,
              f.name as fund_name,
              COALESCE(p.first_name||' '||p.last_name,'(anonymous)') as person_name
             FROM giving_entries ge
             JOIN funds f ON ge.fund_id=f.id
             JOIN giving_batches gb ON ge.batch_id=gb.id
             LEFT JOIN people p ON ge.person_id=p.id
             WHERE 1=1`;
  const binds = [];
  if (fundId) { sql += ` AND ge.fund_id=?`; binds.push(parseInt(fundId)); }
  if (from)   { sql += ` AND COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) >= ?`; binds.push(from); }
  if (to)     { sql += ` AND COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) <= ?`; binds.push(to); }
  sql += ` ORDER BY txn_date DESC, ge.id DESC LIMIT ?`;
  binds.push(limit);
  const transactions = (await db.prepare(sql).bind(...binds).all()).results || [];
  return json({ transactions });
}

if (seg === 'giving/batches' && method === 'POST') {
  let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const r = await db.prepare(
    `INSERT INTO giving_batches (batch_date,description) VALUES (?,?)`
  ).bind(b.batch_date||'',b.description||'').run();
  return json({ ok: true, id: r.meta?.last_row_id });
}

const batchMatch = seg.match(/^giving\/batches\/(\d+)$/);
if (batchMatch) {
  const bid = parseInt(batchMatch[1]);
  if (method === 'GET') {
    const batch = await db.prepare('SELECT * FROM giving_batches WHERE id=?').bind(bid).first();
    if (!batch) return json({ error: 'Not found' }, 404);
    const entries = (await db.prepare(
      `SELECT ge.*, f.name as fund_name,
       COALESCE(p.first_name||' '||p.last_name,'(anonymous)') as person_name
       FROM giving_entries ge
       JOIN funds f ON ge.fund_id=f.id
       LEFT JOIN people p ON ge.person_id=p.id
       WHERE ge.batch_id=? ORDER BY ge.id`
    ).bind(bid).all()).results || [];
    return json({ ...batch, entries });
  }
  if (method === 'PUT') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    await db.prepare(`UPDATE giving_batches SET batch_date=?,description=?,closed=? WHERE id=?`)
      .bind(b.batch_date||'',b.description||'',b.closed?1:0,bid).run();
    return json({ ok: true });
  }
  if (method === 'DELETE') {
    const batch = await db.prepare('SELECT closed FROM giving_batches WHERE id=?').bind(bid).first();
    if (!batch) return json({ error: 'Not found' }, 404);
    if (batch.closed) return json({ error: 'Cannot delete a closed batch.' }, 409);
    await db.prepare('DELETE FROM giving_entries WHERE batch_id=?').bind(bid).run();
    await db.prepare('DELETE FROM giving_batches WHERE id=?').bind(bid).run();
    return json({ ok: true });
  }
}

const entriesMatch = seg.match(/^giving\/batches\/(\d+)\/entries$/);
if (entriesMatch) {
  const bid = parseInt(entriesMatch[1]);
  if (method === 'GET') {
    const entries = (await db.prepare(
      `SELECT ge.*, f.name as fund_name,
       COALESCE(p.first_name||' '||p.last_name,'(anonymous)') as person_name
       FROM giving_entries ge
       JOIN funds f ON ge.fund_id=f.id
       LEFT JOIN people p ON ge.person_id=p.id
       WHERE ge.batch_id=? ORDER BY ge.id`
    ).bind(bid).all()).results || [];
    return json({ entries });
  }
  if (method === 'POST') {
    const batch = await db.prepare('SELECT closed FROM giving_batches WHERE id=?').bind(bid).first();
    if (!batch) return json({ error: 'Batch not found' }, 404);
    if (batch.closed) return json({ error: 'Batch is closed.' }, 409);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const amtCents = Math.round(parseFloat(b.amount || 0) * 100);
    if (!b.fund_id) return json({ error: 'fund_id required' }, 400);
    if (amtCents <= 0) return json({ error: 'Amount must be positive' }, 400);
    const r = await db.prepare(
      `INSERT INTO giving_entries (batch_id,person_id,fund_id,amount,method,check_number,notes)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(bid,b.person_id||null,parseInt(b.fund_id),amtCents,b.method||'cash',b.check_number||'',b.notes||'').run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }
}

const entryDelMatch = seg.match(/^giving\/entries\/(\d+)$/);
if (entryDelMatch && method === 'PUT') {
  const eid = parseInt(entryDelMatch[1]);
  const entry = await db.prepare(
    `SELECT ge.id, gb.closed FROM giving_entries ge JOIN giving_batches gb ON ge.batch_id=gb.id WHERE ge.id=?`
  ).bind(eid).first();
  if (!entry) return json({ error: 'Not found' }, 404);
  if (entry.closed) return json({ error: 'Batch is closed.' }, 409);
  let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const amtCents = Math.round(parseFloat(b.amount || 0) * 100);
  if (amtCents <= 0) return json({ error: 'Amount must be positive' }, 400);
  await db.prepare(
    `UPDATE giving_entries SET fund_id=?,amount=?,method=?,check_number=?,notes=?,contribution_date=? WHERE id=?`
  ).bind(parseInt(b.fund_id), amtCents, b.method||'cash', b.check_number||'', b.notes||'', b.date||'', eid).run();
  return json({ ok: true });
}
if (entryDelMatch && method === 'DELETE') {
  const eid = parseInt(entryDelMatch[1]);
  const entry = await db.prepare(
    `SELECT ge.id, gb.closed FROM giving_entries ge JOIN giving_batches gb ON ge.batch_id=gb.id WHERE ge.id=?`
  ).bind(eid).first();
  if (!entry) return json({ error: 'Not found' }, 404);
  if (entry.closed) return json({ error: 'Batch is closed.' }, 409);
  await db.prepare('DELETE FROM giving_entries WHERE id=?').bind(eid).run();
  return json({ ok: true });
}

// ── Quick Gift Entry (auto-creates open batch for the month) ─────
if (seg === 'giving/quick-entry' && method === 'POST') {
  let b = {}; try { b = await req.json(); } catch {}
  const { person_id, fund_id, amount, method: payMethod, date, notes, check_number } = b;
  if (!fund_id || !amount || !date) return json({ error: 'fund_id, amount, and date required' }, 400);
  const amtCents = Math.round(parseFloat(amount) * 100);
  if (amtCents <= 0) return json({ error: 'Amount must be positive' }, 400);
  // Find or create an open manual-entry batch for this month
  const monthKey  = String(date).slice(0, 7);
  const batchDesc = 'Manual Entry ' + monthKey;
  let existBatch = await db.prepare(
    `SELECT id FROM giving_batches WHERE description=? AND closed=0 LIMIT 1`
  ).bind(batchDesc).first();
  let batchId;
  if (existBatch) {
    batchId = existBatch.id;
  } else {
    const br = await db.prepare(
      `INSERT INTO giving_batches (batch_date, description, closed) VALUES (?,?,0)`
    ).bind(date, batchDesc).run();
    batchId = br.meta?.last_row_id;
  }
  const er = await db.prepare(
    `INSERT INTO giving_entries (batch_id,person_id,fund_id,amount,method,check_number,notes,contribution_date)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(batchId, person_id ? parseInt(person_id) : null, parseInt(fund_id),
         amtCents, payMethod || 'cash', check_number || '', notes || '', date).run();
  return json({ ok: true, id: er.meta?.last_row_id, batch_id: batchId });
}

// ── Letters & Statements workspace (GIV-R2) ──────────────────────────────────
// Resolves the recipient list for a letter type server-side (no "Load Givers" step) and
// annotates each recipient with whether it's already been sent on the requested channel,
// so the workspace can show real per-recipient status and resume an interrupted run.
if (seg === 'giving/letters/status' && method === 'GET') {
  const year = parseInt(url.searchParams.get('year')) || new Date().getFullYear();
  const letterType = url.searchParams.get('letter_type') || 'year_end';
  const channel = url.searchParams.get('channel') === 'print' ? 'print' : 'email';
  const cfg = LETTER_TYPES[letterType];
  if (!cfg) return json({ error: 'Unknown letter_type' }, 400);
  const scope = url.searchParams.get('scope') || cfg.defaultScope;
  const empty = { year, letter_type: letterType, channel, scope, recipients: [], counts: { total: 0, sent: 0, unsent: 0, no_email: 0 } };
  if (scope === 'none') return json(empty);

  let givers = [];
  if (scope === 'givers' || scope === 'both') {
    givers = (await db.prepare(
      `SELECT p.id, p.first_name, p.last_name, p.email, p.household_id, SUM(ge.amount) as total_cents
       FROM people p
       JOIN giving_entries ge ON ge.person_id=p.id
       JOIN giving_batches gb ON ge.batch_id=gb.id
       WHERE p.active=1
         AND substr(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date),1,4)=?
       GROUP BY p.id ORDER BY p.last_name, p.first_name`
    ).bind(String(year)).all()).results || [];
  }
  let households = [];
  if (scope === 'member_households' || scope === 'both') {
    households = (await db.prepare(
      `SELECT h.id, h.name,
              (SELECT p2.email FROM people p2 WHERE p2.household_id=h.id AND p2.active=1 AND p2.email != ''
                 ORDER BY CASE WHEN p2.family_role='head' THEN 0 ELSE 1 END, p2.id LIMIT 1) as recipient_email,
              (SELECT p2.first_name || ' ' || p2.last_name FROM people p2 WHERE p2.household_id=h.id AND p2.active=1 AND p2.email != ''
                 ORDER BY CASE WHEN p2.family_role='head' THEN 0 ELSE 1 END, p2.id LIMIT 1) as recipient_name,
              (SELECT p3.id FROM people p3 WHERE p3.household_id=h.id AND p3.active=1 AND p3.email != ''
                 ORDER BY CASE WHEN p3.family_role='head' THEN 0 ELSE 1 END, p3.id LIMIT 1) as recipient_person_id,
              COALESCE((SELECT SUM(ge.amount) FROM giving_entries ge
                          JOIN giving_batches gb ON ge.batch_id=gb.id
                          JOIN people p4 ON ge.person_id=p4.id
                         WHERE p4.household_id=h.id
                           AND substr(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date),1,4)=?), 0) as total_cents
       FROM households h
       WHERE EXISTS (SELECT 1 FROM people p WHERE p.household_id=h.id AND p.active=1 AND LOWER(p.member_type)='member')
       ORDER BY h.name`
    ).bind(String(year)).all()).results || [];
  }
  const sentRows = (await db.prepare(
    `SELECT recipient_key FROM giving_letter_sends
      WHERE year=? AND letter_type=? AND channel=? AND recipient_key IS NOT NULL`
  ).bind(year, letterType, channel).all()).results || [];
  const sentKeys = new Set(sentRows.map(r => r.recipient_key));
  const merged = mergeLetterRecipients(givers, households, scope, sentKeys, channel);
  // Thread the household's resolved recipient person id back onto each household row so the
  // frontend can render/send its statement without a second lookup.
  const hhPid = {};
  for (const h of households) hhPid['h' + h.id] = h.recipient_person_id || null;
  for (const r of merged.recipients) {
    if (r.kind === 'household') r.recipient_person_id = hhPid[r.recipient_key] || null;
  }
  return json({ year, letter_type: letterType, channel, scope, ...merged });
}

// Record a letter send/print without emailing (print channel, or marking an emailed letter
// done from a path that didn't go through giving/send-statement). Idempotent on the
// (recipient_key, year, letter_type, channel) identity. `unmark:true` removes the record.
if (seg === 'giving/letters/mark' && method === 'POST') {
  let b = {}; try { b = await req.json(); } catch {}
  const { person_id, household_id, year, letter_type, recipient_key, unmark } = b;
  const channel = b.channel === 'print' ? 'print' : 'email';
  if (!recipient_key || !year || !letter_type) return json({ error: 'recipient_key, year, letter_type required' }, 400);
  if (!LETTER_TYPES[letter_type]) return json({ error: 'Unknown letter_type' }, 400);
  if (unmark) {
    await db.prepare(
      `DELETE FROM giving_letter_sends WHERE recipient_key=? AND year=? AND letter_type=? AND channel=?`
    ).bind(recipient_key, Number(year), letter_type, channel).run();
    return json({ ok: true, unmarked: true });
  }
  await db.prepare(
    `INSERT INTO giving_letter_sends(person_id, household_id, year, letter_type, channel, recipient_key, sent_at)
     VALUES(?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(recipient_key, year, letter_type, channel) WHERE recipient_key IS NOT NULL
     DO UPDATE SET sent_at=excluded.sent_at, person_id=excluded.person_id, household_id=excluded.household_id`
  ).bind(person_id ? parseInt(person_id) : 0, household_id ? parseInt(household_id) : null,
         Number(year), letter_type, channel, recipient_key).run();
  return json({ ok: true });
}

// ── Thank-you receipt queue (GIV-R4 / A) ─────────────────────────────────────
// Donations in a date range that warrant a manual thank-you: any donation >= threshold
// (default $250) OR a donor's first-ever recorded gift. Donations are grouped per
// person+date (split-fund gifts summed) so one donation event = one receipt, keyed
// 'ge<person>:<date>'. Reuses giving/letters/mark + giving/send-statement to send/track.
if (seg === 'giving/receipts/queue' && method === 'GET') {
  const now = new Date();
  const from = url.searchParams.get('from') || (now.toISOString().slice(0, 7) + '-01');
  const to   = url.searchParams.get('to')   || now.toISOString().slice(0, 10);
  const thresholdCents = Math.max(0, parseInt(url.searchParams.get('threshold_cents') || '25000', 10) || 25000);
  const includeFirstGift = url.searchParams.get('first_gift') !== '0';
  const effDate = "COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date)";

  // Donation events in range (one row per person per day, split funds summed).
  const rows = (await db.prepare(
    `SELECT ge.person_id AS person_id,
            ${effDate} AS gift_date,
            SUM(ge.amount) AS amount_cents,
            MAX(p.first_name || ' ' || p.last_name) AS name,
            MAX(p.email) AS email,
            MAX(p.household_id) AS household_id,
            GROUP_CONCAT(DISTINCT f.name) AS funds
       FROM giving_entries ge
       JOIN giving_batches gb ON gb.id = ge.batch_id
       JOIN people p ON p.id = ge.person_id
       JOIN funds f ON f.id = ge.fund_id
      WHERE ${effDate} >= ? AND ${effDate} <= ?
        AND ge.person_id IS NOT NULL
        AND LOWER(COALESCE(p.member_type,'')) != 'organization'
      GROUP BY ge.person_id, ${effDate}`
  ).bind(from, to).all()).results || [];

  // Each candidate donor's earliest-ever gift date (to flag first-time gifts).
  const firstGiftDateByPerson = {};
  const pids = [...new Set(rows.map(r => r.person_id).filter(v => v != null))];
  for (let i = 0; i < pids.length; i += 90) {
    const chunk = pids.slice(i, i + 90);
    const ph = chunk.map(() => '?').join(',');
    const mins = (await db.prepare(
      `SELECT ge.person_id AS person_id, MIN(${effDate}) AS first_date
         FROM giving_entries ge JOIN giving_batches gb ON gb.id = ge.batch_id
        WHERE ge.person_id IN (${ph})
        GROUP BY ge.person_id`
    ).bind(...chunk).all()).results || [];
    for (const m of mins) firstGiftDateByPerson[m.person_id] = m.first_date;
  }

  // Already-thanked donations (any channel).
  const sentRows = (await db.prepare(
    `SELECT recipient_key FROM giving_letter_sends
      WHERE letter_type='thank_you' AND recipient_key IS NOT NULL`
  ).all()).results || [];
  const sentKeys = new Set(sentRows.map(r => r.recipient_key));

  const result = computeReceiptQueue(rows, { thresholdCents, includeFirstGift, firstGiftDateByPerson, sentKeys });
  return json({ from, to, threshold_cents: thresholdCents, first_gift: includeFirstGift, ...result });
}

  return null; // not handled
}
