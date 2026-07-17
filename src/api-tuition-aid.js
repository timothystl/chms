// ── Tuition Aid Planner API handlers ──────────────────────────────────────
// Finance-only feature (gated in api-chms.js). Money is stored/returned as integer cents;
// the frontend converts to dollars only at display time, matching the giving-entries convention.
import { json } from './auth.js';

const STUDENT_FIELDS = [
  'person_id', 'household_id', 'family', 'child', 'is_pipeline', 'base_grade', 'birth_year',
  'outside_aid_cents', 'fam_pct', 'fam_pct_orig', 'touched', 'lhs_award_cents',
  'lhs_award_orig_cents', 'attends_lhs', 'timothy_award_exact_cents', 'family_owed_exact_cents',
  'timothy_award_override_cents', 'family_owed_override_cents',
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

  // ── Full bundle: students + config + history + year rates + per-student year pins ──
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
    const yearRates = (await db.prepare(
      `SELECT school_year, tuition_cents FROM tuition_year_rates ORDER BY school_year`
    ).all()).results || [];
    // Joined against tuition_students (regardless of active) so a pin for a since-graduated
    // or removed student still carries a family/child name for past-year/history display.
    const studentYears = (await db.prepare(
      `SELECT sy.*, s.family, s.child, s.is_pipeline, s.person_id
       FROM tuition_student_years sy JOIN tuition_students s ON sy.student_id = s.id
       ORDER BY sy.school_year, s.sort_order, s.id`
    ).all()).results || [];
    return json({ students, config, history, yearRates, studentYears });
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
         fam_pct,fam_pct_orig,lhs_award_cents,lhs_award_orig_cents,attends_lhs,note,active,sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      b.person_id || null, b.household_id || null, b.family || '', b.child || '',
      b.is_pipeline ? 1 : 0, b.base_grade || '', b.birth_year || null,
      b.outside_aid_cents || 0, famPct, famPct, lhsAward, lhsAward,
      b.attends_lhs === false ? 0 : 1, b.note || '', b.active === false ? 0 : 1, (maxSort?.m ?? -1) + 1
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

  // ── Per-year tuition rate override (global — one rate applies to every student that year) ──
  if (seg.match(/^tuition-aid\/year-rates\/[^/]+$/) && method === 'PUT') {
    const schoolYear = decodeURIComponent(seg.slice('tuition-aid/year-rates/'.length));
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const cents = Math.round(b.tuition_cents);
    if (!Number.isFinite(cents) || cents < 0) return json({ error: 'Invalid tuition_cents' }, 400);
    await db.prepare(
      `INSERT INTO tuition_year_rates (school_year,tuition_cents,updated_at) VALUES (?,?,datetime('now'))
       ON CONFLICT(school_year) DO UPDATE SET tuition_cents=excluded.tuition_cents, updated_at=datetime('now')`
    ).bind(schoolYear, cents).run();
    return json({ ok: true });
  }

  const YEAR_PIN_FIELDS = ['grade', 'outside_aid_cents', 'fam_pct', 'timothy_award_cents', 'family_owed_cents', 'lhs_award_cents', 'note'];

  // ── Per-student per-year pin (outside aid / awards that differ year to year) ────────
  const ymatch = seg.match(/^tuition-aid\/students\/(\d+)\/years\/([^/]+)$/);
  if (ymatch) {
    const studentId = parseInt(ymatch[1]);
    const schoolYear = decodeURIComponent(ymatch[2]);
    if (method === 'PUT') {
      let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const existing = await db.prepare(
        `SELECT * FROM tuition_student_years WHERE student_id=? AND school_year=?`
      ).bind(studentId, schoolYear).first();
      const merged = {};
      for (const f of YEAR_PIN_FIELDS) {
        merged[f] = Object.prototype.hasOwnProperty.call(b, f) ? b[f] : (existing ? existing[f] : (f === 'grade' || f === 'note' ? '' : null));
      }
      await db.prepare(
        `INSERT INTO tuition_student_years (student_id,school_year,grade,outside_aid_cents,fam_pct,timothy_award_cents,family_owed_cents,lhs_award_cents,note,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))
         ON CONFLICT(student_id,school_year) DO UPDATE SET
           grade=excluded.grade, outside_aid_cents=excluded.outside_aid_cents, fam_pct=excluded.fam_pct,
           timothy_award_cents=excluded.timothy_award_cents, family_owed_cents=excluded.family_owed_cents,
           lhs_award_cents=excluded.lhs_award_cents, note=excluded.note, updated_at=datetime('now')`
      ).bind(studentId, schoolYear, merged.grade, merged.outside_aid_cents, merged.fam_pct,
        merged.timothy_award_cents, merged.family_owed_cents, merged.lhs_award_cents, merged.note).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await db.prepare(`DELETE FROM tuition_student_years WHERE student_id=? AND school_year=?`).bind(studentId, schoolYear).run();
      return json({ ok: true });
    }
  }

  // ── Bulk per-year pin upsert (Apply Policy / Auto-Balance / Reset when viewing a
  //    non-current year — one round trip instead of N) ────────────────────────────
  if (seg === 'tuition-aid/year-pins/bulk' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const schoolYear = String(b.school_year || '');
    const updates = Array.isArray(b.updates) ? b.updates : [];
    if (!schoolYear || !updates.length) return json({ ok: true, updated: 0 });
    const ids = updates.map(u => parseInt(u.student_id)).filter(Number.isInteger);
    const existingRows = ids.length ? (await db.prepare(
      `SELECT * FROM tuition_student_years WHERE school_year=? AND student_id IN (${ids.map(() => '?').join(',')})`
    ).bind(schoolYear, ...ids).all()).results || [] : [];
    const existingById = {};
    for (const r of existingRows) existingById[r.student_id] = r;
    const stmts = [];
    for (const u of updates) {
      const studentId = parseInt(u.student_id);
      if (!Number.isInteger(studentId)) continue;
      const existing = existingById[studentId];
      const merged = {};
      for (const f of YEAR_PIN_FIELDS) {
        merged[f] = Object.prototype.hasOwnProperty.call(u, f) ? u[f] : (existing ? existing[f] : (f === 'grade' || f === 'note' ? '' : null));
      }
      stmts.push(db.prepare(
        `INSERT INTO tuition_student_years (student_id,school_year,grade,outside_aid_cents,fam_pct,timothy_award_cents,family_owed_cents,lhs_award_cents,note,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))
         ON CONFLICT(student_id,school_year) DO UPDATE SET
           grade=excluded.grade, outside_aid_cents=excluded.outside_aid_cents, fam_pct=excluded.fam_pct,
           timothy_award_cents=excluded.timothy_award_cents, family_owed_cents=excluded.family_owed_cents,
           lhs_award_cents=excluded.lhs_award_cents, note=excluded.note, updated_at=datetime('now')`
      ).bind(studentId, schoolYear, merged.grade, merged.outside_aid_cents, merged.fam_pct,
        merged.timothy_award_cents, merged.family_owed_cents, merged.lhs_award_cents, merged.note));
    }
    if (stmts.length) await db.batch(stmts);
    return json({ ok: true, updated: stmts.length });
  }

  // ── Bulk import of per-student history from an uploaded workbook (parsed client-side) ──
  // Each entry may carry any subset of YEAR_PIN_FIELDS (a K-8 year sets grade/outside_aid/
  // timothy_award/family_owed; an LHS year sets grade/lhs_award only) — fields not present in
  // a given entry are left as whatever already exists for that (student, year), same merge
  // semantics as the year-pins/bulk endpoint, so a K-8-only re-import can't blow away an
  // LHS award pinned for the same student in a different year, and vice versa.
  if (seg === 'tuition-aid/import-history' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const records = Array.isArray(b.records) ? b.records.slice(0, 500) : [];
    let created = 0, updated = 0, unchanged = 0, newStudents = 0;
    for (const rec of records) {
      const family = String(rec?.family || '').trim().slice(0, 100);
      const child = String(rec?.child || '').trim().slice(0, 100);
      if (!family && !child) continue;
      const entries = Array.isArray(rec.entries) ? rec.entries.slice(0, 20) : [];
      if (!entries.length) continue;
      let s = await db.prepare(`SELECT id FROM tuition_students WHERE family=? AND child=?`).bind(family, child).first();
      if (!s) {
        const maxSort = await db.prepare(`SELECT COALESCE(MAX(sort_order),-1) as m FROM tuition_students`).first();
        const r = await db.prepare(
          `INSERT INTO tuition_students (family,child,is_pipeline,fam_pct,fam_pct_orig,lhs_award_cents,lhs_award_orig_cents,attends_lhs,active,sort_order)
           VALUES (?,?,0,50,50,120000,120000,1,0,?)`
        ).bind(family, child, (maxSort?.m ?? -1) + 1).run();
        s = { id: r.meta?.last_row_id };
        newStudents++;
      }
      for (const entry of entries) {
        const schoolYear = String(entry?.school_year || '').trim().slice(0, 20);
        if (!schoolYear) continue;
        const existing = await db.prepare(
          `SELECT * FROM tuition_student_years WHERE student_id=? AND school_year=?`
        ).bind(s.id, schoolYear).first();
        const merged = {};
        let changed = !existing;
        for (const f of YEAR_PIN_FIELDS) {
          if (Object.prototype.hasOwnProperty.call(entry, f)) {
            merged[f] = entry[f];
            if (existing && existing[f] !== entry[f]) changed = true;
          } else {
            merged[f] = existing ? existing[f] : (f === 'grade' || f === 'note' ? '' : null);
          }
        }
        await db.prepare(
          `INSERT INTO tuition_student_years (student_id,school_year,grade,outside_aid_cents,fam_pct,timothy_award_cents,family_owed_cents,lhs_award_cents,note,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))
           ON CONFLICT(student_id,school_year) DO UPDATE SET
             grade=excluded.grade, outside_aid_cents=excluded.outside_aid_cents, fam_pct=excluded.fam_pct,
             timothy_award_cents=excluded.timothy_award_cents, family_owed_cents=excluded.family_owed_cents,
             lhs_award_cents=excluded.lhs_award_cents, note=excluded.note, updated_at=datetime('now')`
        ).bind(s.id, schoolYear, merged.grade, merged.outside_aid_cents, merged.fam_pct,
          merged.timothy_award_cents, merged.family_owed_cents, merged.lhs_award_cents, merged.note).run();
        if (!existing) created++;
        else if (changed) updated++;
        else unchanged++;
      }
    }
    return json({ ok: true, created, updated, unchanged, newStudents });
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
