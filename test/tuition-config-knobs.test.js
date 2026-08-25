import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS } from '../src/html-chms.js';

// P28-D/TAP3: eight tuition-aid planner config knobs (base tuition rate, growth %, LHS rates,
// the $2,000 floor, the 50% cap, the pipeline default %, and the base school year) were only
// ever settable via a direct PATCH /admin/api/tuition-aid/config call — no Settings UI. This adds
// one, reusing the exact tapCfgNum(key, default) reads already scattered through this file, so a
// value entered here is picked up everywhere with no other code change.

function makeCtx(configOverrides) {
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
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ config: configOverrides || {}, history: [], students: [], yearRates: [], studentYears: [] }),
      });
    },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_CORE_JS, ctx, { filename: 'app-core.js' });
  vm.runInContext(CHMS_APP_EXT_JS, ctx, { filename: 'app-ext.js' });
  ctx._fetchCalls = fetchCalls;
  ctx._store = store;
  return ctx;
}

async function flushDebounce() {
  await new Promise((r) => setTimeout(r, 50));
}

const CONFIG_FIELDS = [
  ['tuition_base_cents', 'cents'], ['tuition_growth_pct', 'pct'],
  ['lhs_standard_rate_cents', 'cents'], ['lhs_max_award_cents', 'cents'],
  ['timothy_min_award_cents', 'cents'], ['family_share_cap_pct', 'pct'],
  ['default_pipeline_fam_pct', 'pct'], ['base_school_year', 'year'],
];

describe('tuition-aid config knobs (P28-D)', () => {
  it('renders every field from stored config, converting cents to dollars for display', () => {
    const ctx = makeCtx();
    ctx.tapApplyBundle({
      config: {
        tuition_base_cents: '900000', tuition_growth_pct: '5',
        lhs_standard_rate_cents: '130000', lhs_max_award_cents: '260000',
        timothy_min_award_cents: '210000', family_share_cap_pct: '55',
        default_pipeline_fam_pct: '45', base_school_year: '2027',
      },
      students: [],
    });
    ctx.tapRenderConfigBox();
    expect(ctx._store['tap-cfg-tuition_base_cents'].value).toBe(9000);
    expect(ctx._store['tap-cfg-tuition_growth_pct'].value).toBe(5);
    expect(ctx._store['tap-cfg-lhs_standard_rate_cents'].value).toBe(1300);
    expect(ctx._store['tap-cfg-lhs_max_award_cents'].value).toBe(2600);
    expect(ctx._store['tap-cfg-timothy_min_award_cents'].value).toBe(2100);
    expect(ctx._store['tap-cfg-family_share_cap_pct'].value).toBe(55);
    expect(ctx._store['tap-cfg-default_pipeline_fam_pct'].value).toBe(45);
    expect(ctx._store['tap-cfg-base_school_year'].value).toBe(2027);
  });

  it('falls back to the documented defaults when nothing is stored yet', () => {
    const ctx = makeCtx();
    ctx.tapApplyBundle({ config: {}, students: [] });
    ctx.tapRenderConfigBox();
    expect(ctx._store['tap-cfg-tuition_base_cents'].value).toBe(8500);
    expect(ctx._store['tap-cfg-tuition_growth_pct'].value).toBe(6);
    expect(ctx._store['tap-cfg-lhs_standard_rate_cents'].value).toBe(1200);
    expect(ctx._store['tap-cfg-lhs_max_award_cents'].value).toBe(2500);
    expect(ctx._store['tap-cfg-timothy_min_award_cents'].value).toBe(2000);
    expect(ctx._store['tap-cfg-family_share_cap_pct'].value).toBe(50);
    expect(ctx._store['tap-cfg-default_pipeline_fam_pct'].value).toBe(50);
    expect(ctx._store['tap-cfg-base_school_year'].value).toBe(2026);
  });

  for (const [key, kind] of CONFIG_FIELDS) {
    if (key === 'base_school_year') continue; // covered separately below — it also reloads
    it('saves ' + key + ' converting ' + kind + ' correctly and updates local state', async () => {
      const ctx = makeCtx();
      ctx.tapApplyBundle({ config: {}, students: [] });
      ctx.document.getElementById('tap-cfg-' + key).value = kind === 'cents' ? '12.34' : '7';
      ctx.tapSaveConfigField(key);
      await flushDebounce();
      const call = ctx._fetchCalls.find((c) => c.url === '/admin/api/tuition-aid/config');
      expect(call, key + ' must PATCH the config endpoint').toBeTruthy();
      const body = JSON.parse(call.opts.body);
      const expected = kind === 'cents' ? 1234 : 7;
      expect(body.values[key]).toBe(expected);
      expect(ctx._tapConfig[key]).toBe(String(expected));
    });
  }

  it('refuses to save a negative or non-numeric value', async () => {
    const ctx = makeCtx();
    ctx.tapApplyBundle({ config: {}, students: [] });
    ctx.document.getElementById('tap-cfg-tuition_growth_pct').value = '-5';
    ctx.tapSaveConfigField('tuition_growth_pct');
    await flushDebounce();
    expect(ctx._fetchCalls.find((c) => c.url === '/admin/api/tuition-aid/config')).toBeUndefined();
  });

  it('changing base_school_year re-fetches the whole bundle rather than patching state in place', async () => {
    // The one field where a local re-render isn't enough: base_school_year moves what "current
    // year" (offset 0) means for every student, and tapApplyBundle expects raw server rows, not
    // the already-transformed in-memory roster — the only safe fix is a full reload.
    const ctx = makeCtx({ base_school_year: '2027' });
    ctx.tapApplyBundle({ config: { base_school_year: '2026' }, students: [] });
    ctx.document.getElementById('tap-cfg-base_school_year').value = '2027';
    ctx.tapSaveConfigField('base_school_year');
    await flushDebounce();
    const reload = ctx._fetchCalls.filter((c) => c.url === '/admin/api/tuition-aid/students');
    expect(reload.length, 'must re-fetch the students bundle after changing the base year').toBe(1);
  });
});
