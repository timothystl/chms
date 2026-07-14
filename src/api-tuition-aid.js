// ── Tuition Aid Planner API handlers ──────────────────────────────────────
// Finance-only feature (gated in api-chms.js). Money is stored/returned as integer cents;
// the frontend converts to dollars only at display time, matching the giving-entries convention.
import { json } from './auth.js';

const STUDENT_FIELDS = [
  'person_id', 'household_id', 'family', 'child', 'is_pipeline', 'base_grade', 'birth_year',
  'outside_aid_cents', 'fam_pct', 'fam_pct_orig', 'touched', 'lhs_award_cents',
  'lhs_award_orig_cents', 'attends_lhs', 'timothy_award_exact_cents', 'family_owed_exact_cents',
  'note', 'active', 'sort_order',
];

async function fillFromPerson(db, b) {
  if (!b.person_id) return b;
  const p = await db.prepare('SELECT id, first_name, last_name, household_id FROM people WHERE id=?').bind(b.person_id).first();
  if (!p) return b;
  return { ...b, family: p.last_name || b.family || '', child: p.first_name || b.child || '', household_id: p.household_id ?? b.household_id ?? null };
}

export async function handleTuitionAidApi(req, env, url, method, seg, db, isFinance) {
  if (!isFinance) return json({ error: 'Access denied' }, 403);

  // ── Full bundle: students + config + history ────────────────────────
  if (seg === 'tuition-aid/students' && method === 'GET') {
    const students = (await db.prepare(
      `SELECT * FROM tuition_students WHERE active=1 ORDER BY sort_order, id`
    ).all()).results || [];
    const configRows = (await db.prepare(`SELECT key, value FROM tuition_config`).all()).results || [];
    const config = {};
    for (const r of configRows) config[r.key] = r.value;
    const history = (await db.prepare(
      `SELECT school_year, tuition_cents, family_pct FROM tuition_history ORDER BY sort_order, id`
    ).all()).results || [];
    return json({ students, config, history });
  }

  // ── Create student / pipeline entrant ────────────────────────────────
  if (seg === 'tuition-aid/students' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!b.is_pipeline && !b.family && !b.person_id) return json({ error: 'Family name or a linked person is required' }, 400);
    if (b.is_pipeline && !b.family) return json({ error: 'Family name is required' }, 400);
    if (b.is_pipeline && !b.birth_year) return json({ error: 'Birth year is required for a pipeline entrant' }, 400);
    b = await fillFromPerson(db, b);
    const maxSort = await db.prepare(`SELECT COALESCE(MAX(sort_order),-1) as m FROM tuition_students`).first();
    const famPct = Number.isInteger(b.fam_pct) ? b.fam_pct : 50;
    const lhsAward = Number.isInteger(b.lhs_award_cents) ? b.lhs_award_cents : 120000;
    const r = await db.prepare(
      `INSERT INTO tuition_students
        (person_id,household_id,family,child,is_pipeline,base_grade,birth_year,outside_aid_cents,
         fam_pct,fam_pct_orig,lhs_award_cents,lhs_award_orig_cents,attends_lhs,note,sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      b.person_id || null, b.household_id || null, b.family || '', b.child || '',
      b.is_pipeline ? 1 : 0, b.base_grade || '', b.birth_year || null,
      b.outside_aid_cents || 0, famPct, famPct, lhsAward, lhsAward,
      b.attends_lhs === false ? 0 : 1, b.note || '', (maxSort?.m ?? -1) + 1
    ).run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }

  // ── Bulk update (Apply Policy / Auto-Balance / Reset — one round trip) ──
  if (seg === 'tuition-aid/students/bulk' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const updates = Array.isArray(b.updates) ? b.updates : [];
    if (!updates.length) return json({ ok: true, updated: 0 });
    const stmts = [];
    for (const u of updates) {
      const id = parseInt(u.id);
      if (!Number.isInteger(id)) continue;
      const sets = [];
      const binds = [];
      for (const f of STUDENT_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(u, f)) {
          sets.push(`${f}=?`);
          binds.push(f === 'is_pipeline' || f === 'touched' || f === 'active' ? (u[f] ? 1 : 0)
            : f === 'attends_lhs' ? (u[f] === false ? 0 : 1)
            : u[f]);
        }
      }
      if (!sets.length) continue;
      sets.push(`updated_at=datetime('now')`);
      binds.push(id);
      stmts.push(db.prepare(`UPDATE tuition_students SET ${sets.join(',')} WHERE id=?`).bind(...binds));
    }
    if (stmts.length) await db.batch(stmts);
    return json({ ok: true, updated: stmts.length });
  }

  // ── Single row update ─────────────────────────────────────────────────
  const smatch = seg.match(/^tuition-aid\/students\/(\d+)$/);
  if (smatch) {
    const id = parseInt(smatch[1]);
    if (method === 'PATCH') {
      let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      if (Object.prototype.hasOwnProperty.call(b, 'person_id') && b.person_id) {
        b = await fillFromPerson(db, b);
      }
      const sets = [];
      const binds = [];
      for (const f of STUDENT_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(b, f)) {
          sets.push(`${f}=?`);
          binds.push(f === 'is_pipeline' || f === 'touched' || f === 'active' ? (b[f] ? 1 : 0)
            : f === 'attends_lhs' ? (b[f] === false ? 0 : 1)
            : b[f]);
        }
      }
      if (!sets.length) return json({ error: 'No fields to update' }, 400);
      sets.push(`updated_at=datetime('now')`);
      binds.push(id);
      await db.prepare(`UPDATE tuition_students SET ${sets.join(',')} WHERE id=?`).bind(...binds).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await db.prepare(`UPDATE tuition_students SET active=0, updated_at=datetime('now') WHERE id=?`).bind(id).run();
      return json({ ok: true });
    }
  }

  // ── Config knobs ───────────────────────────────────────────────────────
  if (seg === 'tuition-aid/config' && method === 'PATCH') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const values = b.values && typeof b.values === 'object' ? b.values : {};
    const stmts = Object.entries(values).map(([k, v]) =>
      db.prepare(`INSERT INTO tuition_config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(k, String(v))
    );
    if (stmts.length) await db.batch(stmts);
    return json({ ok: true });
  }

  // ── Historical chart data (replace-all) ─────────────────────────────────
  if (seg === 'tuition-aid/history' && method === 'PUT') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const rows = Array.isArray(b.rows) ? b.rows : [];
    const stmts = [db.prepare(`DELETE FROM tuition_history`)];
    rows.forEach((r, i) => {
      stmts.push(db.prepare(
        `INSERT INTO tuition_history (school_year,tuition_cents,family_pct,sort_order) VALUES (?,?,?,?)`
      ).bind(r.school_year || '', Math.round(r.tuition_cents || 0), r.family_pct || 0, i));
    });
    await db.batch(stmts);
    return json({ ok: true });
  }

  return null;
}
