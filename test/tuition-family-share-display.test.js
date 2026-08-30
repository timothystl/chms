import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS } from '../src/html-chms.js';

// Reported bug: a K-8 student's Family Share % box showed 81% while Family Owed showed $0.00.
// Root cause — fam_pct is stored/back-derived as (outside aid + family owed) / tuition (see the
// seed formula in db.js and tapPctFromFamilyOwed), which only means "the family's assigned
// share" while outside aid is smaller than that share. Once outside aid alone covers it, family
// owed floors at $0 and the stored % just reflects how much outside aid the family has, not
// anything about their own responsibility — reading as contradictory next to "$0 owed".
//
// Fix (display-only, per the user's chosen option): once a family's actual owed amount is $0,
// show the true effective % (family owed / tuition = 0%) instead of the inflated stored number.
// Every stored dollar amount and the underlying fam_pct field are untouched.

function makeCtx() {
  const el = (id) => ({
    id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false,
    files: [], classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
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
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_CORE_JS, ctx, { filename: 'app-core.js' });
  vm.runInContext(CHMS_APP_EXT_JS, ctx, { filename: 'app-ext.js' });
  ctx._store = store;
  return ctx;
}

function pctInputValue(html, studentId) {
  // Isolate the <tr> for this student's Timothy Award input id, then pull the preceding
  // Family Share % <input>'s value out of that row.
  const rowStart = html.indexOf('id="tap-k8award-' + studentId + '"');
  expect(rowStart, 'row for student ' + studentId + ' must be rendered').toBeGreaterThan(-1);
  const rowHtmlBefore = html.slice(0, rowStart);
  const trStart = rowHtmlBefore.lastIndexOf('<tr');
  const segment = html.slice(trStart, rowStart);
  const m = segment.match(/oninput="tapSliderChange\(this,\d+\)">%/);
  expect(m, 'must find the % input in this row').toBeTruthy();
  const valueMatch = segment.slice(0, m.index).match(/value="(-?\d+)"[^>]*$/);
  expect(valueMatch, 'must find a value attribute right before the % input').toBeTruthy();
  return +valueMatch[1];
}

describe('tuition-aid Family Share % display (family-share-calc-bug)', () => {
  it('shows the true effective 0% when outside aid already covers the assigned share (Daniel Dinger repro)', () => {
    const ctx = makeCtx();
    ctx.tapApplyBundle({
      config: {},
      students: [{
        id: 3, family: 'Dinger', child: 'Daniel', is_pipeline: 0, base_grade: '3',
        outside_aid_cents: 690000, fam_pct: 81, fam_pct_orig: 81, touched: 0,
        timothy_award_exact_cents: 160000, family_owed_exact_cents: 0,
        lhs_award_cents: 0, lhs_award_orig_cents: 0, attends_lhs: 1,
      }],
    });
    ctx.tapRenderPlannerTables();
    const html = ctx._store['tap-k8-body'].innerHTML;
    expect(pctInputValue(html, 3)).toBe(0);
    // The underlying stored policy value is untouched by this display fix.
    expect(ctx.tapById(3).famPct).toBe(81);
    // Nor are the dollar amounts changed.
    expect(html).toContain('id="tap-k8award-3"');
    const idIdx = html.indexOf('id="tap-k8award-3"');
    const tagStart = html.lastIndexOf('<input', idIdx);
    const awardTag = html.slice(tagStart, idIdx);
    expect(awardTag.match(/value="(\d+)"/)[1]).toBe('1600');
    expect(html).toMatch(/\$0\.00/);
  });

  it('leaves the % box showing the real assigned share when the family still owes something', () => {
    const ctx = makeCtx();
    ctx.tapApplyBundle({
      config: {},
      students: [{
        id: 2, family: 'Enderle', child: 'Charlotte', is_pipeline: 0, base_grade: '2',
        outside_aid_cents: 600000, fam_pct: 76, fam_pct_orig: 76, touched: 0,
        timothy_award_exact_cents: 200000, family_owed_exact_cents: 50000,
        lhs_award_cents: 0, lhs_award_orig_cents: 0, attends_lhs: 1,
      }],
    });
    ctx.tapRenderPlannerTables();
    const html = ctx._store['tap-k8-body'].innerHTML;
    expect(pctInputValue(html, 2)).toBe(76);
  });

  it('reflects the true effective % for a family with no outside aid whose Timothy award covers 100% (edge case)', () => {
    // outsideAid=0, timothyAward=tuition, familyOwed=0 => stored fam_pct is a nonsensical 100%
    // under the old (outsideAid+familyOwed)/tuition formula; the fix must show 0%, matching what
    // the family actually pays.
    const ctx = makeCtx();
    ctx.tapApplyBundle({
      config: {},
      students: [{
        id: 9, family: 'FullScholar', child: 'Kid', is_pipeline: 0, base_grade: '4',
        outside_aid_cents: 0, fam_pct: 100, fam_pct_orig: 100, touched: 0,
        timothy_award_exact_cents: 850000, family_owed_exact_cents: 0,
        lhs_award_cents: 0, lhs_award_orig_cents: 0, attends_lhs: 1,
      }],
    });
    ctx.tapRenderPlannerTables();
    const html = ctx._store['tap-k8-body'].innerHTML;
    expect(pctInputValue(html, 9)).toBe(0);
  });

  it('sorting by Family Share % orders rows by the displayed (effective) percentage, not the hidden stored one', () => {
    const ctx = makeCtx();
    ctx.tapApplyBundle({
      config: {},
      students: [
        { id: 3, family: 'Dinger', child: 'Daniel', is_pipeline: 0, base_grade: '3',
          outside_aid_cents: 690000, fam_pct: 81, fam_pct_orig: 81, touched: 0,
          timothy_award_exact_cents: 160000, family_owed_exact_cents: 0,
          lhs_award_cents: 0, lhs_award_orig_cents: 0, attends_lhs: 1 },
        { id: 2, family: 'Enderle', child: 'Charlotte', is_pipeline: 0, base_grade: '2',
          outside_aid_cents: 600000, fam_pct: 76, fam_pct_orig: 76, touched: 0,
          timothy_award_exact_cents: 200000, family_owed_exact_cents: 50000,
          lhs_award_cents: 0, lhs_award_orig_cents: 0, attends_lhs: 1 },
      ],
    });
    ctx.tapSortK8Pct(); // dir 1 (ascending) on first click
    const html = ctx._store['tap-k8-body'].innerHTML;
    // Displayed order should be Dinger (effective 0%) before Enderle (76%), even though
    // Dinger's stored fam_pct (81) is numerically higher than Enderle's (76).
    expect(html.indexOf('id="tap-k8award-3"')).toBeLessThan(html.indexOf('id="tap-k8award-2"'));
  });
});
