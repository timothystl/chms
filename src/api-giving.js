// ── Giving Entries, Batches, Quick Entry API handlers ──────────────────────
import { json } from './auth.js';
import { isoWeekKey, LETTER_TYPES, mergeLetterRecipients, computeReceiptQueue, computeGivingPlateaus, fetchGivingPlateauRows, plateauWeeksElapsed, computeDepositTotals, batchDepositStatus, batchDepositStatusFromCounts } from './api-utils.js';

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
  // Deposit coverage comes in as correlated subqueries rather than a second LEFT JOIN — joining
  // both giving_entries and giving_deposit_lines in one GROUP BY would multiply the rows and
  // silently inflate every batch's total (n entries x m deposit lines).
  let sql = `SELECT gb.*, COUNT(ge.id) as entry_count, COALESCE(SUM(ge.amount),0) as total_cents,
             (SELECT COALESCE(SUM(dl.amount_cents),0) FROM giving_deposit_lines dl WHERE dl.batch_id=gb.id) as linked_cents,
             (SELECT COUNT(*) FROM giving_deposit_lines dl WHERE dl.batch_id=gb.id) as deposit_count,
             (SELECT COUNT(*) FROM giving_deposit_lines dl JOIN giving_deposits d ON d.id=dl.deposit_id
               WHERE dl.batch_id=gb.id AND d.bank_cents IS NULL) as unreconciled_count
             FROM giving_batches gb LEFT JOIN giving_entries ge ON ge.batch_id=gb.id`;
  const binds = [];
  if (status === 'open') { sql += ' WHERE gb.closed=0'; }
  else if (status === 'closed') { sql += ' WHERE gb.closed=1'; }
  sql += ' GROUP BY gb.id ORDER BY gb.batch_date DESC, gb.id DESC LIMIT 100';
  const rows = (await db.prepare(sql).bind(...binds).all()).results || [];
  const batches = rows.map(b => ({
    ...b,
    deposit_status: batchDepositStatusFromCounts(b.total_cents, b.linked_cents, b.deposit_count, b.unreconciled_count),
  }));
  return json({ batches });
}

// ── Offerings work queue ──────────────────────────────────────────────────
// The four counts above the Offerings master/detail. Derived, never stored: every figure is a
// live re-read of the same batches/deposits the panels below it show, so the queue can't claim
// work that has already been done (or miss work that was just created).
if (seg === 'giving/offerings-summary' && method === 'GET') {
  const yearStart = new Date().toISOString().slice(0, 4) + '-01-01';
  // "Awaiting deposit" is scoped to a recent window. Batch-to-deposit links only start existing
  // from this feature onward, so every historical batch is technically undeposited — counting
  // them would have the card announce years of money still in the safe on the day it ships.
  const awaitingDays = Math.min(365, Math.max(7, parseInt(url.searchParams.get('awaiting_days') || '90')));
  const awaitingSince = new Date(Date.now() - awaitingDays * 86400000).toISOString().slice(0, 10);
  const [openRes, awaitingRes, unrecRes, feeRes] = await Promise.all([
    // Counted but not posted — batches still open.
    db.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(t.cents),0) AS cents FROM (
         SELECT gb.id, COALESCE(SUM(ge.amount),0) AS cents
           FROM giving_batches gb LEFT JOIN giving_entries ge ON ge.batch_id=gb.id
          WHERE gb.closed=0 GROUP BY gb.id) t`
    ).first(),
    // Counted, but not all of it has reached a deposit yet (no line at all, or lines that don't
    // cover the batch total — a partial bank run leaves the remainder here too).
    db.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(t.gap),0) AS cents FROM (
         SELECT gb.id,
                COALESCE((SELECT SUM(ge.amount) FROM giving_entries ge WHERE ge.batch_id=gb.id),0)
                - COALESCE((SELECT SUM(dl.amount_cents) FROM giving_deposit_lines dl WHERE dl.batch_id=gb.id),0) AS gap
           FROM giving_batches gb WHERE gb.batch_date >= ?) t
        WHERE t.gap > 50`
    ).bind(awaitingSince).first(),
    // At the bank, but nobody has entered what the bank actually received. Windowed like
    // awaiting_deposit above: an old deposit left unreconciled under the earlier per-gift flow
    // would otherwise pin this card open forever and hold `earliest` at its date.
    db.prepare(
      `SELECT COUNT(*) AS n, MIN(deposit_date) AS earliest FROM giving_deposits
        WHERE bank_cents IS NULL AND deposit_date >= ?`
    ).bind(awaitingSince).first(),
    // Given - deposited across every deposit with a bank figure this year. Two rules matter:
    // a deposit with no bank figure is skipped entirely rather than counted as $0 fees (which
    // would read as a windfall), and "given" follows the same lines-else-gifts rule as the
    // deposit list — a deposit built the old per-gift way has no batch lines, and subtracting
    // its bank amount from zero would report a large negative fee. A deposit that holds NOTHING
    // is skipped outright for the same reason — there is no giving behind it to derive a fee
    // from, only a bank figure, and "given − bank" would be that figure negated.
    db.prepare(
      `SELECT COALESCE(SUM(
                CASE WHEN (SELECT COUNT(*) FROM giving_deposit_lines dl WHERE dl.deposit_id=d.id) > 0
                     THEN (SELECT COALESCE(SUM(dl.amount_cents),0) FROM giving_deposit_lines dl WHERE dl.deposit_id=d.id)
                     ELSE (SELECT COALESCE(SUM(ge.amount),0) FROM giving_entries ge WHERE ge.deposit_id=d.id)
                END - d.bank_cents),0) AS cents
         FROM giving_deposits d
        WHERE d.bank_cents IS NOT NULL AND d.deposit_date >= ?
          AND ((SELECT COUNT(*) FROM giving_deposit_lines dl WHERE dl.deposit_id=d.id) > 0
            OR (SELECT COUNT(*) FROM giving_entries ge WHERE ge.deposit_id=d.id) > 0)`
    ).bind(yearStart).first(),
  ]);
  return json({
    open_batches:          { count: openRes?.n || 0, cents: openRes?.cents || 0 },
    awaiting_deposit:      { count: awaitingRes?.n || 0, cents: awaitingRes?.cents || 0, days: awaitingDays },
    unreconciled_deposits: { count: unrecRes?.n || 0, earliest_date: unrecRes?.earliest || '' },
    fees_ytd:              { cents: feeRes?.cents || 0 },
  });
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
  // deposit_label: which bank deposit this gift's batch went out on. A batch split across two
  // deposits shows both, so a gift is never shown as belonging to one slip when it straddles.
  let sql = `SELECT ge.id, ge.amount, ge.method, ge.check_number, ge.batch_id,
              COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) as txn_date,
              f.name as fund_name,
              COALESCE(p.first_name||' '||p.last_name,'(anonymous)') as person_name,
              (SELECT GROUP_CONCAT(COALESCE(NULLIF(d.external_ref,''), d.deposit_date), ', ')
                 FROM giving_deposit_lines dl JOIN giving_deposits d ON d.id=dl.deposit_id
                WHERE dl.batch_id=ge.batch_id) as deposit_label
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
    // Bank deposits this batch is part of, plus — for each one — the OTHER batches sharing it,
    // so the reverse direction of the link is visible without leaving the batch.
    const links = (await db.prepare(
      `SELECT dl.deposit_id, dl.amount_cents, d.deposit_date, d.source, d.external_ref,
              d.bank_cents, d.status,
              (SELECT COALESCE(SUM(x.amount_cents),0) FROM giving_deposit_lines x WHERE x.deposit_id=d.id) AS deposit_given_cents
         FROM giving_deposit_lines dl
         JOIN giving_deposits d ON d.id=dl.deposit_id
        WHERE dl.batch_id=?
        ORDER BY d.deposit_date, d.id`
    ).bind(bid).all()).results || [];
    let siblings = [];
    if (links.length) {
      const ph = links.map(() => '?').join(',');
      siblings = (await db.prepare(
        `SELECT dl.deposit_id, dl.batch_id, dl.amount_cents, gb.batch_date, gb.description
           FROM giving_deposit_lines dl JOIN giving_batches gb ON gb.id=dl.batch_id
          WHERE dl.deposit_id IN (${ph}) AND dl.batch_id != ?
          ORDER BY gb.batch_date, gb.id`
      ).bind(...links.map(l => l.deposit_id), bid).all()).results || [];
    }
    const deposits = links.map(l => ({
      ...l,
      other_batches: siblings.filter(s => s.deposit_id === l.deposit_id),
    }));
    const totalCents = entries.reduce((s, e) => s + (e.amount || 0), 0);
    const depositStatus = batchDepositStatus(totalCents, deposits);
    return json({ ...batch, entries, total_cents: totalCents, deposits, deposit_status: depositStatus });
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
    // The deposit links go too — otherwise a deposit keeps claiming money from a batch that no
    // longer exists, and (because its list and detail queries reach the lines differently) the
    // two views of that deposit disagree forever with nothing to recompute them.
    await db.prepare('DELETE FROM giving_deposit_lines WHERE batch_id=?').bind(bid).run();
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

// ── Giving Nudges workspace ──────────────────────────────────────────────────
// The Plateaus & Nudges analysis is what decides WHO to write to and WHAT to ask; this turns
// that into a sendable recipient list. Same giver query and same computeGivingPlateaus call the
// report uses (fetchGivingPlateauRows — shared, not copied, so the letter can never address a
// different set of people than the report that was approved), joined to contact details and to
// the send ledger so a run is resumable and nobody is asked twice.
//
// Each recipient carries their figures in THEIR OWN rhythm (weekly/monthly/quarterly/annual, see
// classifyGivingCadence) rather than the weekly-equivalent the analysis normalises to — telling a
// monthly giver they give "$43 a week" reads as though nobody looked at their record.
if (seg === 'giving/nudges/status' && method === 'GET') {
  const year = parseInt(url.searchParams.get('year') || '', 10);
  if (!year || isNaN(year)) return json({ error: 'year required' }, 400);
  const scope = url.searchParams.get('scope') === 'person' ? 'person' : 'household';
  const fundId = parseInt(url.searchParams.get('fund_id') || '', 10) || 0;
  const channel = url.searchParams.get('channel') === 'print' ? 'print' : 'email';
  const optionKey = ['modest', 'standard', 'generous'].indexOf(url.searchParams.get('option') || 'standard');
  const optionIdx = optionKey < 0 ? 1 : optionKey;
  const lowFrequencyMax = Math.max(1, Math.min(parseInt(url.searchParams.get('low_frequency_max') || '3', 10) || 3, 51));

  const rows = await fetchGivingPlateauRows(db, { year, scope, fundId });
  let impactStatements = [];
  try {
    const impRow = await db.prepare("SELECT value FROM chms_config WHERE key='giving_impact_statements_json'").first();
    if (impRow?.value) impactStatements = JSON.parse(impRow.value);
  } catch {}
  const weeksElapsed = plateauWeeksElapsed(year);
  const analysis = computeGivingPlateaus(rows, { periodsElapsed: weeksElapsed, impactStatements, lowFrequencyMax });
  const givers = analysis.givers || [];

  // Contact details, in two bulk lookups rather than one per giver. A household writes to the
  // head's email (same preference order the letters workspace uses); a person writes to their own.
  const hhIds = givers.filter(g => g.link_kind === 'household').map(g => g.link_id);
  const personIds = givers.filter(g => g.link_kind === 'person').map(g => g.link_id);
  const contacts = new Map();
  // D1 caps parameters at ~100 per statement, so both lookups are chunked.
  for (let i = 0; i < hhIds.length; i += 80) {
    const chunk = hhIds.slice(i, i + 80);
    if (!chunk.length) continue;
    const res = (await db.prepare(
      `SELECT h.id,
              (SELECT p.email FROM people p WHERE p.household_id=h.id AND p.active=1 AND p.email != ''
                 ORDER BY CASE WHEN p.family_role='head' THEN 0 ELSE 1 END, p.id LIMIT 1) AS email,
              (SELECT p.first_name || ' ' || p.last_name FROM people p WHERE p.household_id=h.id AND p.active=1 AND p.email != ''
                 ORDER BY CASE WHEN p.family_role='head' THEN 0 ELSE 1 END, p.id LIMIT 1) AS recipient_name,
              (SELECT p.id FROM people p WHERE p.household_id=h.id AND p.active=1 AND p.email != ''
                 ORDER BY CASE WHEN p.family_role='head' THEN 0 ELSE 1 END, p.id LIMIT 1) AS recipient_person_id
         FROM households h WHERE h.id IN (${chunk.map(() => '?').join(',')})`
    ).bind(...chunk).all()).results || [];
    for (const r of res) contacts.set('h' + r.id, r);
  }
  for (let i = 0; i < personIds.length; i += 80) {
    const chunk = personIds.slice(i, i + 80);
    if (!chunk.length) continue;
    const res = (await db.prepare(
      `SELECT id, email, (first_name || ' ' || last_name) AS recipient_name, id AS recipient_person_id
         FROM people WHERE id IN (${chunk.map(() => '?').join(',')})`
    ).bind(...chunk).all()).results || [];
    for (const r of res) contacts.set('p' + r.id, r);
  }

  const sentRows = (await db.prepare(
    `SELECT recipient_key FROM giving_letter_sends
      WHERE year=? AND letter_type='nudge' AND channel=? AND recipient_key IS NOT NULL`
  ).bind(year, channel).all()).results || [];
  const sentKeys = new Set(sentRows.map(r => r.recipient_key));

  const recipients = givers.map(g => {
    const key = (g.link_kind === 'household' ? 'h' : 'p') + g.link_id;
    const c = contacts.get(key) || {};
    const opt = g.options[optionIdx] || g.options[g.options.length - 1] || null;
    return {
      recipient_key: key, kind: g.link_kind, id: g.link_id, name: g.name,
      email: c.email || '', has_email: !!c.email,
      recipient_name: c.recipient_name || g.name,
      recipient_person_id: c.recipient_person_id || (g.link_kind === 'person' ? g.link_id : null),
      sent: sentKeys.has(key),
      gifts: g.gifts, total_cents: g.total_cents,
      weekly_cents: g.weekly_cents,
      cadence: g.cadence, cadence_label: g.cadence_label, cadence_adverb: g.cadence_adverb,
      cadence_amount_cents: g.cadence_amount_cents,
      low_frequency: g.low_frequency, all_manual_methods: g.all_manual_methods,
      option: opt && {
        label: opt.label,
        target_cents: opt.target_cents,
        cadence_target_cents: opt.cadence_target_cents,
        cadence_delta_cents: opt.cadence_delta_cents,
        // Two annual figures, deliberately. cadence_annual_delta_cents is what the LETTER says,
        // rebuilt from the rounded cadence delta so it always reconciles with the "+$30 a month"
        // above it. annual_delta_cents is the analysis figure the Plateaus report totals on, kept
        // so the workspace and the report agree on the headline upside.
        cadence_annual_delta_cents: opt.cadence_annual_delta_cents,
        annual_delta_cents: opt.annual_delta_cents,
        impact_text: opt.impact_text,
      },
    };
  }).filter(r => r.option).sort((a, b) => b.total_cents - a.total_cents);

  const counts = {
    total: recipients.length,
    sent: recipients.filter(r => r.sent).length,
    unsent: recipients.filter(r => !r.sent).length,
    no_email: recipients.filter(r => !r.has_email).length,
  };
  return json({
    year, scope, channel, fund_id: fundId || null,
    option: ['modest', 'standard', 'generous'][optionIdx],
    partial: year === new Date().getUTCFullYear(),
    upside_annual_cents: recipients.filter(r => !r.sent).reduce((s, r) => s + (r.option.annual_delta_cents || 0), 0),
    recipients, counts,
  });
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

// ── Giving Deposits: deposit-centered reconciliation (native giving Phase 1) ──
// A deposit groups the gifts that make up one bank deposit. Reconciling it against the bank
// stamps its gifts complete ("not a complete gift until reconciled with the bank"). Fees are
// held per gift so a deposit totals to the net that actually hit the bank. Finance-gated;
// writes already require isFinance (guard at top of this handler).

// List deposits (optionally by status) with live rolled-up totals.
if (seg === 'giving/deposits' && method === 'GET') {
  const status = url.searchParams.get('status') || 'all';
  let where = '';
  const binds = [];
  if (status === 'open' || status === 'reconciled') { where = 'WHERE d.status=?'; binds.push(status); }
  const rows = (await db.prepare(
    `SELECT d.*,
            COUNT(ge.id) AS gift_count,
            COALESCE(SUM(ge.amount),0) AS gross_cents,
            COALESCE(SUM(ge.fee_cents),0) AS fee_cents,
            COALESCE(SUM(ge.amount),0) - COALESCE(SUM(ge.fee_cents),0) AS net_cents,
            (SELECT COALESCE(SUM(dl.amount_cents),0) FROM giving_deposit_lines dl WHERE dl.deposit_id=d.id) AS line_cents,
            (SELECT COUNT(*) FROM giving_deposit_lines dl WHERE dl.deposit_id=d.id) AS batch_count
       FROM giving_deposits d
       LEFT JOIN giving_entries ge ON ge.deposit_id=d.id
       ${where}
       GROUP BY d.id
       ORDER BY d.deposit_date DESC, d.id DESC
       LIMIT 200`
  ).bind(...binds).all()).results || [];
  // given_cents is the batch-line total when the deposit has lines (the Offerings workflow),
  // and the gift-assignment total otherwise (the older per-gift flow, still available on the
  // Deposits pill). Never their sum — a deposit built both ways would double-count itself.
  const deposits = rows.map(d => ({ ...d, given_cents: d.batch_count > 0 ? d.line_cents : d.gross_cents }));
  return json({ deposits });
}

// Batch ↔ deposit links. Upsert (POST) / delete (DELETE) one line; a deposit left with no lines
// AND no assigned gifts is deleted with it, so an abandoned "+ New deposit" click doesn't leave
// an empty slip behind for someone to reconcile later.
if (seg === 'giving/deposit-lines' && method === 'POST') {
  let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const depositId = parseInt(b.deposit_id), batchId = parseInt(b.batch_id);
  if (!Number.isInteger(depositId) || !Number.isInteger(batchId)) return json({ error: 'deposit_id and batch_id required' }, 400);
  const amount = Math.max(0, Math.round(Number(b.amount_cents) || 0));
  const dep = await db.prepare('SELECT id, status FROM giving_deposits WHERE id=?').bind(depositId).first();
  if (!dep) return json({ error: 'Deposit not found' }, 404);
  if (dep.status === 'reconciled') return json({ error: 'Deposit is reconciled — reopen it to change what it holds.' }, 409);
  const batch = await db.prepare('SELECT id FROM giving_batches WHERE id=?').bind(batchId).first();
  if (!batch) return json({ error: 'Batch not found' }, 404);
  await db.prepare(
    `INSERT INTO giving_deposit_lines (deposit_id, batch_id, amount_cents) VALUES (?,?,?)
     ON CONFLICT(deposit_id, batch_id) DO UPDATE SET amount_cents=excluded.amount_cents`
  ).bind(depositId, batchId, amount).run();
  return json({ ok: true });
}

if (seg === 'giving/deposit-lines' && method === 'DELETE') {
  const depositId = parseInt(url.searchParams.get('deposit_id'));
  const batchId   = parseInt(url.searchParams.get('batch_id'));
  if (!Number.isInteger(depositId) || !Number.isInteger(batchId)) return json({ error: 'deposit_id and batch_id required' }, 400);
  const dep = await db.prepare('SELECT id, status FROM giving_deposits WHERE id=?').bind(depositId).first();
  if (!dep) return json({ error: 'Deposit not found' }, 404);
  if (dep.status === 'reconciled') return json({ error: 'Deposit is reconciled — reopen it to change what it holds.' }, 409);
  await db.prepare('DELETE FROM giving_deposit_lines WHERE deposit_id=? AND batch_id=?').bind(depositId, batchId).run();
  const left = await db.prepare(
    `SELECT (SELECT COUNT(*) FROM giving_deposit_lines WHERE deposit_id=?) AS lines,
            (SELECT COUNT(*) FROM giving_entries WHERE deposit_id=?) AS gifts`
  ).bind(depositId, depositId).first();
  let depositDeleted = false;
  if ((left?.lines || 0) === 0 && (left?.gifts || 0) === 0) {
    await db.prepare('DELETE FROM giving_deposits WHERE id=?').bind(depositId).run();
    depositDeleted = true;
  }
  return json({ ok: true, deposit_deleted: depositDeleted });
}

// Deposits this batch is NOT already part of — the "add this batch to an existing deposit"
// picker in the batch detail.
if (seg === 'giving/deposit-options' && method === 'GET') {
  const batchId = parseInt(url.searchParams.get('batch_id'));
  const binds = [];
  let sql = `SELECT d.id, d.deposit_date, d.source, d.external_ref, d.bank_cents, d.status,
                    (SELECT COALESCE(SUM(dl.amount_cents),0) FROM giving_deposit_lines dl WHERE dl.deposit_id=d.id) AS given_cents,
                    (SELECT COUNT(*) FROM giving_deposit_lines dl WHERE dl.deposit_id=d.id) AS batch_count
               FROM giving_deposits d
              WHERE d.status='open'`;
  if (Number.isInteger(batchId)) {
    sql += ` AND NOT EXISTS (SELECT 1 FROM giving_deposit_lines dl WHERE dl.deposit_id=d.id AND dl.batch_id=?)`;
    binds.push(batchId);
  }
  sql += ` ORDER BY d.deposit_date DESC, d.id DESC LIMIT 50`;
  const deposits = (await db.prepare(sql).bind(...binds).all()).results || [];
  return json({ deposits });
}

if (seg === 'giving/deposits' && method === 'POST') {
  let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const src = ['check', 'cash', 'online', 'mixed'].includes(b.source) ? b.source : '';
  const r = await db.prepare(
    `INSERT INTO giving_deposits (deposit_date, source, processor, external_ref, notes)
     VALUES (?,?,?,?,?)`
  ).bind(b.deposit_date || '', src, b.processor || '', b.external_ref || '', b.notes || '').run();
  const id = r.meta?.last_row_id;
  // Optional: create the deposit already holding one batch. This is what "+ New deposit" and
  // "Assign the rest to a new deposit" in the batch detail do, so the deposit never exists in a
  // half-made state the work queue would immediately flag as unreconciled-and-empty.
  const batchId = parseInt(b.batch_id);
  if (Number.isInteger(batchId) && id) {
    const amount = Math.max(0, Math.round(Number(b.amount_cents) || 0));
    await db.prepare(
      `INSERT INTO giving_deposit_lines (deposit_id, batch_id, amount_cents) VALUES (?,?,?)
       ON CONFLICT(deposit_id, batch_id) DO UPDATE SET amount_cents=excluded.amount_cents`
    ).bind(id, batchId, amount).run();
  }
  return json({ ok: true, id });
}

const depMatch = seg.match(/^giving\/deposits\/(\d+)$/);
if (depMatch) {
  const did = parseInt(depMatch[1]);
  if (method === 'GET') {
    const dep = await db.prepare('SELECT * FROM giving_deposits WHERE id=?').bind(did).first();
    if (!dep) return json({ error: 'Not found' }, 404);
    const gifts = (await db.prepare(
      `SELECT ge.id, ge.amount, ge.fee_cents, ge.method, ge.source, ge.processor, ge.reconcile_status,
              ge.check_number, ge.external_txn_id,
              COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) AS gift_date,
              f.name AS fund_name,
              COALESCE(p.first_name||' '||p.last_name,'(anonymous)') AS person_name
         FROM giving_entries ge
         JOIN funds f ON ge.fund_id=f.id
         JOIN giving_batches gb ON ge.batch_id=gb.id
         LEFT JOIN people p ON ge.person_id=p.id
        WHERE ge.deposit_id=? ORDER BY ge.id`
    ).bind(did).all()).results || [];
    const totals = computeDepositTotals(gifts, dep.bank_cents);
    const lines = (await db.prepare(
      `SELECT dl.batch_id, dl.amount_cents, gb.batch_date, gb.description
         FROM giving_deposit_lines dl JOIN giving_batches gb ON gb.id=dl.batch_id
        WHERE dl.deposit_id=? ORDER BY gb.batch_date, gb.id`
    ).bind(did).all()).results || [];
    const lineCents = lines.reduce((s, l) => s + (l.amount_cents || 0), 0);
    return json({ ...dep, gifts, totals, lines, line_cents: lineCents, given_cents: lines.length ? lineCents : totals.gross_cents });
  }
  if (method === 'PATCH') {
    const dep = await db.prepare('SELECT * FROM giving_deposits WHERE id=?').bind(did).first();
    if (!dep) return json({ error: 'Not found' }, 404);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const allowed = { deposit_date: 's', source: 's', processor: 's', external_ref: 's', notes: 's', bank_cents: 'int' };
    const sets = [], binds = [];
    for (const [f, k] of Object.entries(allowed)) {
      if (!(f in b)) continue;
      let v = b[f];
      if (k === 's') v = String(v ?? '');
      else if (k === 'int') v = (v === null || v === '' || v === undefined) ? null : parseInt(v);
      sets.push(`${f}=?`); binds.push(v);
    }
    if (!sets.length) return json({ ok: true });
    binds.push(did);
    await db.prepare(`UPDATE giving_deposits SET ${sets.join(',')} WHERE id=?`).bind(...binds).run();
    return json({ ok: true });
  }
  if (method === 'DELETE') {
    const dep = await db.prepare('SELECT status FROM giving_deposits WHERE id=?').bind(did).first();
    if (!dep) return json({ error: 'Not found' }, 404);
    if (dep.status === 'reconciled') return json({ error: 'Reopen the deposit before deleting it.' }, 409);
    // Release its gifts back to unassigned; never delete the gifts themselves.
    await db.prepare("UPDATE giving_entries SET deposit_id=NULL, reconcile_status='recorded' WHERE deposit_id=?").bind(did).run();
    // Batch links go with it — the batches themselves fall back to "Needs deposit", which is
    // exactly true again once the slip they were on no longer exists.
    await db.prepare('DELETE FROM giving_deposit_lines WHERE deposit_id=?').bind(did).run();
    await db.prepare('DELETE FROM giving_deposits WHERE id=?').bind(did).run();
    return json({ ok: true });
  }
}

// Assign / unassign gifts to a deposit (only while it's open).
const depAssignMatch = seg.match(/^giving\/deposits\/(\d+)\/assign$/);
if (depAssignMatch && method === 'POST') {
  const did = parseInt(depAssignMatch[1]);
  const dep = await db.prepare('SELECT status FROM giving_deposits WHERE id=?').bind(did).first();
  if (!dep) return json({ error: 'Not found' }, 404);
  if (dep.status === 'reconciled') return json({ error: 'Deposit is reconciled — reopen it to change gifts.' }, 409);
  let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const ids = (Array.isArray(b.entry_ids) ? b.entry_ids : []).map(x => parseInt(x)).filter(Number.isInteger);
  const unassign = !!b.unassign;
  if (!ids.length) return json({ error: 'entry_ids required' }, 400);
  const stmts = [];
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const ph = chunk.map(() => '?').join(',');
    if (unassign) {
      stmts.push(db.prepare(`UPDATE giving_entries SET deposit_id=NULL, reconcile_status='recorded' WHERE id IN (${ph})`).bind(...chunk));
    } else {
      stmts.push(db.prepare(`UPDATE giving_entries SET deposit_id=?, reconcile_status='deposited' WHERE id IN (${ph})`).bind(did, ...chunk));
    }
  }
  await db.batch(stmts);
  return json({ ok: true, count: ids.length });
}

// Reconcile a deposit against the bank → stamps its gifts complete.
const depReconcileMatch = seg.match(/^giving\/deposits\/(\d+)\/reconcile$/);
if (depReconcileMatch && method === 'POST') {
  const did = parseInt(depReconcileMatch[1]);
  const dep = await db.prepare('SELECT * FROM giving_deposits WHERE id=?').bind(did).first();
  if (!dep) return json({ error: 'Not found' }, 404);
  let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const bankCents = (b.bank_cents === null || b.bank_cents === '' || b.bank_cents === undefined) ? null : parseInt(b.bank_cents);
  const gifts = (await db.prepare('SELECT amount, fee_cents FROM giving_entries WHERE deposit_id=?').bind(did).all()).results || [];
  const totals = computeDepositTotals(gifts, bankCents);
  await db.batch([
    db.prepare("UPDATE giving_deposits SET status='reconciled', bank_cents=?, reconciled_at=datetime('now') WHERE id=?").bind(bankCents, did),
    db.prepare("UPDATE giving_entries SET reconcile_status='reconciled' WHERE deposit_id=?").bind(did),
  ]);
  return json({ ok: true, totals });
}

const depReopenMatch = seg.match(/^giving\/deposits\/(\d+)\/reopen$/);
if (depReopenMatch && method === 'POST') {
  const did = parseInt(depReopenMatch[1]);
  const dep = await db.prepare('SELECT id FROM giving_deposits WHERE id=?').bind(did).first();
  if (!dep) return json({ error: 'Not found' }, 404);
  await db.batch([
    db.prepare("UPDATE giving_deposits SET status='open', reconciled_at=NULL WHERE id=?").bind(did),
    db.prepare("UPDATE giving_entries SET reconcile_status='deposited' WHERE deposit_id=?").bind(did),
  ]);
  return json({ ok: true });
}

// Gifts not yet attached to any deposit — the pool a deposit's gifts are drawn from.
// Optional date/batch filter so a whole weekly batch can be pulled in at once.
if (seg === 'giving/unassigned-gifts' && method === 'GET') {
  const from    = url.searchParams.get('from') || '';
  const to      = url.searchParams.get('to') || '';
  const batchId = url.searchParams.get('batch_id');
  let sql = `SELECT ge.id, ge.amount, ge.fee_cents, ge.method, ge.check_number, ge.source, ge.batch_id,
                    COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) AS gift_date,
                    f.name AS fund_name,
                    COALESCE(p.first_name||' '||p.last_name,'(anonymous)') AS person_name
               FROM giving_entries ge
               JOIN funds f ON ge.fund_id=f.id
               JOIN giving_batches gb ON ge.batch_id=gb.id
               LEFT JOIN people p ON ge.person_id=p.id
              WHERE ge.deposit_id IS NULL`;
  const binds = [];
  if (batchId) { sql += ` AND ge.batch_id=?`; binds.push(parseInt(batchId)); }
  if (from)    { sql += ` AND COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) >= ?`; binds.push(from); }
  if (to)      { sql += ` AND COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) <= ?`; binds.push(to); }
  sql += ` ORDER BY gift_date DESC, ge.id DESC LIMIT 500`;
  const gifts = (await db.prepare(sql).bind(...binds).all()).results || [];
  return json({ gifts });
}

  return null; // not handled
}
