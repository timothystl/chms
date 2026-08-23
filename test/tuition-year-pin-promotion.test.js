import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS } from '../src/html-chms.js';

// TAP6 / P28-E: a per-year pin made while a year was still "next year" (offset > 0) sat inert
// forever once base_school_year advanced and that year became "current" (offset 0) —
// tapSplitFor/tapOutsideAidFor/tapFamPctFor/tapLhsAwardFor deliberately never consult a pin at
// offset 0, since a stale pin overriding a fresh live edit made after rollover would have no way
// to reconcile against the edit. Fixed with a one-time promotion pass on bundle load: any pin
// matching the CURRENT year's label is copied into the master row via the same PATCH path a live
// edit already uses — the hot offset-0 read path itself is untouched.

function makeCtx() {
  const fetchCalls = [];
  const el = (id) => ({
    id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false,
    files: [], classList: { add() {}, remove() {}, contains() { return false; } },
    appendChild() {}, addEventListener() {}, querySelector() { return null; },
    querySelectorAll() { return []; }, setAttribute() {}, focus() {},
  });
  const store = {};
  const ctx = {
    document: {
      getElementById(id) { return store[id] || (store[id] = el(id)); },
      querySelector() { return null; }, querySelectorAll() { return []; },
      createElement: () => el('x'), addEventListener() {}, body: el('body'), activeElement: null,
    },
    console, setTimeout, clearTimeout, Math, JSON, Date, parseFloat, parseInt, isFinite,
    Number, String, Object, Array, Promise, encodeURIComponent, decodeURIComponent,
    localStorage: { getItem() { return null; }, setItem() {} },
    FormData: class { append() {} }, navigator: {}, location: { href: '', hash: '' },
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, requestAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
    fetch: (url, opts) => {
      fetchCalls.push({ url, opts });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_CORE_JS, ctx, { filename: 'app-core.js' });
  vm.runInContext(CHMS_APP_EXT_JS, ctx, { filename: 'app-ext.js' });
  ctx._fetchCalls = fetchCalls;
  return ctx;
}

function baseStudent(over) {
  return Object.assign({
    id: 1, family: 'Knapp', child: 'Lawrence', is_pipeline: 0, base_grade: '5',
    outside_aid_cents: 0, fam_pct: null, touched: 0, lhs_award_cents: 0,
    attends_lhs: 1, timothy_award_exact_cents: null, family_owed_exact_cents: null,
    timothy_award_override_cents: null, family_owed_override_cents: null, note: '',
  }, over || {});
}

async function flushDebounce() {
  // tapDebouncedSave/tapSavePinDebounced use a 500ms setTimeout; advance real time so the vm's
  // real (not faked) timers fire and the fetch call actually happens.
  await new Promise((r) => setTimeout(r, 600));
}

describe('promoting a pin into the master row once its year becomes current', () => {
  it('copies outside aid, family %, and the LHS award from a pin matching the new current year', async () => {
    const ctx = makeCtx();
    ctx.tapApplyBundle({
      config: { base_school_year: '2027' },
      students: [baseStudent()],
      studentYears: [{
        student_id: 1, school_year: '2027-28', grade: '', note: '',
        outside_aid_cents: 150000, fam_pct: 40, lhs_award_cents: 0,
        timothy_award_cents: null, family_owed_cents: null,
      }],
    });
    const s = ctx._tapRoster[0];
    expect(s.outsideAid).toBe(1500);
    expect(s.famPct).toBe(40);
    expect(s.touched).toBe(true);

    await flushDebounce();
    const patch = ctx._fetchCalls.find((c) => c.url === '/admin/api/tuition-aid/students/1');
    expect(patch, 'promotion must persist to the server, not just update in-memory state').toBeTruthy();
    const body = JSON.parse(patch.opts.body);
    expect(body).toMatchObject({ outside_aid_cents: 150000, fam_pct: 40, touched: 1 });
  });

  it('promotes an exact-dollar Timothy Award pin as a live override', async () => {
    const ctx = makeCtx();
    ctx.tapApplyBundle({
      config: { base_school_year: '2027' },
      students: [baseStudent()],
      studentYears: [{
        student_id: 1, school_year: '2027-28', grade: '', note: '',
        outside_aid_cents: null, fam_pct: null, lhs_award_cents: null,
        timothy_award_cents: 250000, family_owed_cents: 100000,
      }],
    });
    const s = ctx._tapRoster[0];
    expect(s.timothyAwardOverride).toBe(2500);
    expect(s.familyOwedOverride).toBe(1000);
  });

  it('does not touch a student with no pin for the current year', async () => {
    const ctx = makeCtx();
    ctx.tapApplyBundle({
      config: { base_school_year: '2027' },
      students: [baseStudent({ outside_aid_cents: 20000 })],
      studentYears: [{
        student_id: 1, school_year: '2028-29', grade: '', note: '', // a DIFFERENT year
        outside_aid_cents: 999900, fam_pct: 90, lhs_award_cents: 0,
        timothy_award_cents: null, family_owed_cents: null,
      }],
    });
    const s = ctx._tapRoster[0];
    expect(s.outsideAid).toBe(200);
    expect(s.touched).toBe(false);
  });

  it('never overwrites a student already touched or overridden before promotion runs', async () => {
    // The exact guard that keeps this idempotent and keeps a real live edit from being clobbered
    // by an older plan on the next reload.
    const ctx = makeCtx();
    ctx.tapApplyBundle({
      config: { base_school_year: '2027' },
      students: [baseStudent({ touched: 1, fam_pct: 55, outside_aid_cents: 30000 })],
      studentYears: [{
        student_id: 1, school_year: '2027-28', grade: '', note: '',
        outside_aid_cents: 150000, fam_pct: 40, lhs_award_cents: 0,
        timothy_award_cents: null, family_owed_cents: null,
      }],
    });
    const s = ctx._tapRoster[0];
    expect(s.outsideAid).toBe(300);
    expect(s.famPct).toBe(55);
  });

  it('skips pipeline entrants entirely', async () => {
    const ctx = makeCtx();
    ctx.tapApplyBundle({
      config: { base_school_year: '2027' },
      students: [baseStudent({ is_pipeline: 1 })],
      studentYears: [{
        student_id: 1, school_year: '2027-28', grade: '', note: '',
        outside_aid_cents: 150000, fam_pct: 40, lhs_award_cents: 0,
        timothy_award_cents: null, family_owed_cents: null,
      }],
    });
    const s = ctx._tapRoster[0];
    expect(s.outsideAid).toBe(0);
    expect(s.touched).toBe(false);
  });
});
