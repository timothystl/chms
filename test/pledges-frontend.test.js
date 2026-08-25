import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_MEMBER_JS } from '../src/html-chms.js';

// P28-C / PL1b: the person profile's Giving tab gets a Pledges card (year / pledged / given /
// %) fed by the new people/:id/pledges endpoint, loaded alongside the existing gift entries.

function makeCtx() {
  const fetchCalls = [];
  const el = (id) => ({
    id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
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
    Number, String, Object, Array, Promise, encodeURIComponent, decodeURIComponent, confirm: () => true,
    alert: () => {},
    localStorage: { getItem() { return null; }, setItem() {} },
    FormData: class { append() {} }, navigator: {}, location: { href: '', hash: '' },
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, requestAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    fetch: (url, opts) => {
      fetchCalls.push({ url, opts });
      if (String(url).startsWith('/admin/api/people/') && String(url).endsWith('/pledges') && (!opts || !opts.method)) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ pledges: [
          { fiscal_year: 2026, amount_cents: 120000, actual_cents: 60000 },
        ] }) });
      }
      if (String(url).includes('/admin/api/giving?')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ entries: [] }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_MEMBER_JS, ctx, { filename: 'app-member.js' });
  ctx._fetchCalls = fetchCalls;
  ctx._store = store;
  return ctx;
}

async function flush() { await new Promise((r) => setTimeout(r, 20)); }

describe('person profile pledges card (P28-C)', () => {
  it('loads pledges alongside gift entries and renders the Pledges card', async () => {
    const ctx = makeCtx();
    ctx.allFunds = [];
    ctx.loadPvGiving(1);
    await flush();
    const html = ctx._store['ptab-giving'].innerHTML;
    expect(html).toContain('Pledges');
    expect(html).toContain('$1200.00');
  });

  it('renderPvPledgesCard shows pledged/given/percent for a loaded pledge', () => {
    const ctx = makeCtx();
    ctx._pvPledges = [{ fiscal_year: 2026, amount_cents: 120000, actual_cents: 60000 }];
    const html = ctx.renderPvPledgesCard(1);
    expect(html).toContain('2026');
    expect(html).toContain('$1200.00');
    expect(html).toContain('$600.00');
    expect(html).toContain('50%');
  });

  it('renderPvPledgesCard shows a no-pledges message when empty', () => {
    const ctx = makeCtx();
    ctx._pvPledges = [];
    const html = ctx.renderPvPledgesCard(1);
    expect(html).toContain('No pledges recorded');
  });

  it('submitPvPledge posts the typed year and dollar amount converted to cents', async () => {
    const ctx = makeCtx();
    ctx.document.getElementById('pledge-year').value = '2027';
    ctx.document.getElementById('pledge-amount').value = '1500.50';
    ctx._pvPledges = [];
    ctx.submitPvPledge(1);
    await flush();
    const call = ctx._fetchCalls.find((c) => c.url === '/admin/api/people/1/pledges' && c.opts && c.opts.method === 'POST');
    expect(call, 'must POST the pledges endpoint').toBeTruthy();
    const body = JSON.parse(call.opts.body);
    expect(body).toEqual({ fiscal_year: 2027, amount_cents: 150050 });
  });

  it('refuses to submit a negative pledge amount without sending a request', async () => {
    const ctx = makeCtx();
    ctx.document.getElementById('pledge-year').value = '2027';
    ctx.document.getElementById('pledge-amount').value = '-5';
    ctx.submitPvPledge(1);
    await flush();
    expect(ctx._fetchCalls.find((c) => c.opts && c.opts.method === 'POST')).toBeUndefined();
  });

  it('deletePvPledge DELETEs the specific year', async () => {
    const ctx = makeCtx();
    ctx._pvPledges = [];
    ctx.deletePvPledge(1, 2026);
    await flush();
    const call = ctx._fetchCalls.find((c) => c.url === '/admin/api/people/1/pledges/2026');
    expect(call, 'must DELETE the specific pledge year').toBeTruthy();
    expect(call.opts.method).toBe('DELETE');
  });
});
