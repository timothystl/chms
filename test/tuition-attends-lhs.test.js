import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleTuitionAidApi, tapAttendsLhsDefaultTrue, tapAttendsLhsFlag } from '../src/api-tuition-aid.js';
import { CHMS_APP_EXT_JS } from '../src/html-chms.js';

// Reported: unchecking "Plans to attend LHS" on the Tuition Aid planner does not save — the box
// comes back checked after a reload.
//
// The cause was the coercion the value passed through on the way into the database. Every
// attends_lhs write bound `v === false ? 0 : 1`, an identity test against the BOOLEAN false — but
// the frontend sends this field as 1/0 (tapSetAttendsLHS: `attends_lhs: checked ? 1 : 0`), and in
// JavaScript `0 === false` is false. So an explicit "no" fell to the `: 1` branch and stored a
// yes. Nothing looked wrong at the time: the local UI state is set by the caller before the save,
// so the checkbox obeyed the click and only reverted on the next load.
//
// It could only ever be a no-op, never a wrong-direction save, which is why "the checkbox does
// nothing" is the exact symptom: the row already held 1, and 1 is what got written back.

describe('attends_lhs coercion', () => {
  it('reads 0 as no — the form the frontend actually sends', () => {
    // The whole bug, in one line. The old `v === false ? 0 : 1` returned 1 here.
    expect(tapAttendsLhsFlag(0)).toBe(0);
    expect(tapAttendsLhsFlag(1)).toBe(1);
  });

  it('reads booleans too, in case a caller sends them', () => {
    expect(tapAttendsLhsFlag(false)).toBe(0);
    expect(tapAttendsLhsFlag(true)).toBe(1);
  });

  it('does not let a JSON string flip the answer', () => {
    // '0' and 'false' are truthy strings; a bare truthiness test stores the opposite of the ask.
    expect(tapAttendsLhsFlag('0')).toBe(0);
    expect(tapAttendsLhsFlag('false')).toBe(0);
    expect(tapAttendsLhsFlag('1')).toBe(1);
  });

  it('defaults a new student to yes only when the field is absent', () => {
    // On CREATE the column means "still planning to attend LHS once they get there", true until
    // somebody says otherwise — but an explicit 0 at create time must still be honored.
    expect(tapAttendsLhsDefaultTrue(undefined)).toBe(1);
    expect(tapAttendsLhsDefaultTrue(null)).toBe(1);
    expect(tapAttendsLhsDefaultTrue(0)).toBe(0);
    expect(tapAttendsLhsDefaultTrue(false)).toBe(0);
    expect(tapAttendsLhsDefaultTrue(1)).toBe(1);
  });
});

// ── The real route, against a real database ─────────────────────────────────
function makeTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  // Baseline first: tuition_students carries foreign keys into people/households.
  for (const f of ['0001_baseline', '0014_tuition_aid_planner', '0015_tuition_year_history', '0017_tuition_timothy_override']) {
    sqlite.exec(readFileSync(new URL(`../migrations/${f}.sql`, import.meta.url), 'utf8'));
  }
  return {
    prepare(sql) {
      const run = (args) => sqlite.prepare(sql).run(...args);
      return {
        bind(...args) {
          return {
            async run() { return { meta: { last_row_id: run(args).lastInsertRowid } }; },
            async first() { return sqlite.prepare(sql).get(...args); },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async run() { return { meta: { last_row_id: run([]).lastInsertRowid } }; },
        async first() { return sqlite.prepare(sql).get(); },
        async all() { return { results: sqlite.prepare(sql).all() }; },
      };
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
    _raw: sqlite,
  };
}

function call(db, { method = 'GET', seg, body }) {
  const req = { json: async () => body };
  return handleTuitionAidApi(req, {}, new URL('https://x/admin/api/' + seg), method, seg, db, true);
}

async function newStudent(db) {
  const r = await (await call(db, { method: 'POST', seg: 'tuition-aid/students', body: { family: 'Knapp', child: 'Lawrence' } })).json();
  return r.id;
}

const attendsOf = (db, id) => db._raw.prepare('SELECT attends_lhs FROM tuition_students WHERE id=?').get(id).attends_lhs;

describe('unchecking "Plans to attend LHS" (the reported bug)', () => {
  it('persists the uncheck through the real PATCH route', async () => {
    const db = makeTestDb();
    const id = await newStudent(db);
    expect(attendsOf(db, id)).toBe(1); // default: yes

    // Exactly what tapSetAttendsLHS sends when the box is unchecked.
    await call(db, { method: 'PATCH', seg: `tuition-aid/students/${id}`, body: { attends_lhs: 0 } });
    expect(attendsOf(db, id)).toBe(0);
  });

  it('checks the box back on again', async () => {
    const db = makeTestDb();
    const id = await newStudent(db);
    await call(db, { method: 'PATCH', seg: `tuition-aid/students/${id}`, body: { attends_lhs: 0 } });
    await call(db, { method: 'PATCH', seg: `tuition-aid/students/${id}`, body: { attends_lhs: 1 } });
    expect(attendsOf(db, id)).toBe(1);
  });

  it('survives being merged with another field in the same debounce window', async () => {
    // tapDebouncedSave merges pending fields per student, so a quick uncheck-then-edit arrives as
    // one PATCH carrying both. The uncheck must not be lost on the way through.
    const db = makeTestDb();
    const id = await newStudent(db);
    await call(db, { method: 'PATCH', seg: `tuition-aid/students/${id}`, body: { attends_lhs: 0, outside_aid_cents: 50000 } });
    const row = db._raw.prepare('SELECT attends_lhs, outside_aid_cents FROM tuition_students WHERE id=?').get(id);
    expect(row).toMatchObject({ attends_lhs: 0, outside_aid_cents: 50000 });
  });

  it('persists the uncheck through the bulk route too', async () => {
    const db = makeTestDb();
    const id = await newStudent(db);
    await call(db, { method: 'POST', seg: 'tuition-aid/students/bulk', body: { updates: [{ id, attends_lhs: 0 }] } });
    expect(attendsOf(db, id)).toBe(0);
  });

  it('is read back as false by the students bundle the planner loads', async () => {
    // The frontend maps this with `attendsLHS: r.attends_lhs !== 0`, and a departed 8th grader is
    // shown as "Departed" rather than rolled into next year's LHS awards — so a wrong 1 here is a
    // budget figure, not just a checkbox.
    const db = makeTestDb();
    const id = await newStudent(db);
    await call(db, { method: 'PATCH', seg: `tuition-aid/students/${id}`, body: { attends_lhs: 0 } });
    const bundle = await (await call(db, { seg: 'tuition-aid/students' })).json();
    expect(bundle.students.find(s => s.id === id).attends_lhs).toBe(0);
  });

  it('leaves attends_lhs alone when the PATCH does not mention it', async () => {
    const db = makeTestDb();
    const id = await newStudent(db);
    await call(db, { method: 'PATCH', seg: `tuition-aid/students/${id}`, body: { attends_lhs: 0 } });
    await call(db, { method: 'PATCH', seg: `tuition-aid/students/${id}`, body: { fam_pct: 40 } });
    expect(attendsOf(db, id)).toBe(0);
  });
});

// ── The Family Share % slider is gone ────────────────────────────────────────
describe('K-8 Family Share % is a typed figure, not a slider', () => {
  const src = CHMS_APP_EXT_JS;

  it('renders no range input in the K-8 planner rows', () => {
    const cell = src.match(/tapOutsideAidChange\(this,[\s\S]{0,700}?tap-slider-caption/);
    expect(cell).not.toBeNull();
    expect(cell[0]).not.toContain('type="range"');
    expect(cell[0]).toContain('max="100"');
  });

  it('keeps the number box, so the percentage is still editable', () => {
    expect(src).toContain('tapSliderChange(this,');
  });

  it('keeps the LHS award slider, which is dollars and was not the ask', () => {
    expect(src).toMatch(/type="range"[\s\S]{0,80}step="25"/);
  });

  it('does not write the clamped value back into the box being typed in', () => {
    // Rewriting a focused input's own value mid-keystroke is the controlled-input round-trip that
    // made the Finance boxes type backward (FIN52). With the range gone there is no second
    // control left to mirror, so there is nothing legitimate left to write either.
    const fn = src.match(/function tapSliderChange\([\s\S]*?\n\}/)[0];
    expect(fn).not.toContain('nums[0].value');
    expect(fn).toContain('Math.min(100,');
  });

  it('still flags the K-8 rows red when the budget is blown', () => {
    // The over-budget class used to ride the range input. Dropping that selector along with the
    // slider would have silently removed the per-row signal.
    const fn = src.match(/document\.querySelectorAll\('#tap-k8-body[^\n]*/)[0];
    expect(fn).toContain('input[type=number]');
    expect(fn).toContain("'over'");
  });
});
