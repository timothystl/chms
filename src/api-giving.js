// ── Giving Entries, Batches, Quick Entry API handlers ──────────────────────
import { json } from './auth.js';

export async function handleGivingApi(req, env, url, method, seg, db, isAdmin, isFinance, isStaff, canEdit) {

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
    const r = await db.prepare(
      `INSERT INTO giving_entries (batch_id,person_id,fund_id,amount,method,check_number,notes)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(bid,b.person_id||null,b.fund_id,amtCents,b.method||'cash',b.check_number||'',b.notes||'').run();
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

  return null; // not handled
}
