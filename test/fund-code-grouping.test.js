import { describe, it, expect, beforeEach } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS, CHMS_APP_FINANCE_JS } from '../src/html-chms.js';

// Funds are named "<code> <label>" and this church deliberately keeps several names under one
// code — "40085 General Fund", "40085 Lent", "40085 Retirement Distribution" are all the General
// Fund. Every per-fund view combines on that leading code, and the rule lives in exactly one
// place (groupRowsByFundCode, js-core.js) so the Giving by Fund report, the board fund table, the
// council narrative and the Church Report's giving reference cannot print different fund lines
// for the same money. These tests run the real helper and the real renderers out of the built
// bundle rather than a copy of the logic.

function makeCtx() {
  const store = {};
  const el = () => ({
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, contains() { return false; } },
    appendChild() {}, addEventListener() {}, querySelector() { return null; },
    querySelectorAll() { return []; }, getAttribute() { return null; }, setAttribute() {},
  });
  const document = {
    getElementById(id) { return store[id] || null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement: el, addEventListener() {}, body: el(), documentElement: el(), activeElement: null,
  };
  const ctx = {
    document, console, setTimeout, clearTimeout, Math, JSON, Date, parseFloat, parseInt, isFinite,
    Number, String, Object, Array, encodeURIComponent, decodeURIComponent,
    localStorage: { getItem() { return null; }, setItem() {} },
    fetch: () => Promise.reject(new Error('no network in tests')),
    navigator: {}, location: { href: '', hash: '' },
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, requestAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_CORE_JS, ctx, { filename: 'app-core.js' });
  vm.runInContext(CHMS_APP_EXT_JS, ctx, { filename: 'app-ext.js' });
  vm.runInContext(CHMS_APP_FINANCE_JS, ctx, { filename: 'app-finance.js' });
  ctx.__store = store;
  return ctx;
}

// The real shape of the screenshot that prompted this: three separate 40085 lines, plus a fund
// with no numeric code at all, plus a lone coded fund.
const GIVING_BY_FUND = [
  { fundName: '40085 General Fund', cents: 21246128 },
  { fundName: '25010 Concordia Children’s Services', cents: 3975882 },
  { fundName: '40085 Retirement Distribution', cents: 2342464 },
  { fundName: '42040 Commercial Property Income', cents: 400000 },
  { fundName: '40085 Lent', cents: 109800 },
  { fundName: 'Other', cents: 23807 },
];

let ctx;
beforeEach(() => { ctx = makeCtx(); });

describe('groupRowsByFundCode', () => {
  const group = (rows) => ctx.groupRowsByFundCode(rows, (f) => f.fundName, (f) => f.cents);

  it('combines every fund sharing a leading code into one group', () => {
    const g = group(GIVING_BY_FUND).find((x) => x.code === '40085');
    expect(g.rows).toHaveLength(3);
    expect(g.total).toBe(21246128 + 2342464 + 109800);
  });

  it('labels a combined group with its highest-total member, not the bare code', () => {
    const g = group(GIVING_BY_FUND).find((x) => x.code === '40085');
    expect(g.label).toBe('40085 General Fund');
  });

  it('keeps a fund with no numeric code as its own line rather than merging all uncoded funds', () => {
    const rows = GIVING_BY_FUND.concat([{ fundName: 'Memorials', cents: 5000 }]);
    const uncoded = group(rows).filter((x) => x.code === null);
    expect(uncoded.map((x) => x.label)).toEqual(['Other', 'Memorials']);
    expect(uncoded.every((x) => x.rows.length === 1)).toBe(true);
  });

  it('preserves the input order of first appearance and loses no money', () => {
    const groups = group(GIVING_BY_FUND);
    expect(groups.map((x) => x.label)).toEqual([
      '40085 General Fund', '25010 Concordia Children’s Services',
      '42040 Commercial Property Income', 'Other',
    ]);
    expect(groups.reduce((s, x) => s + x.total, 0))
      .toBe(GIVING_BY_FUND.reduce((s, f) => s + f.cents, 0));
  });

  it('handles an empty or missing list', () => {
    expect(group([])).toEqual([]);
    expect(group(null)).toEqual([]);
  });

  it('does not treat a code embedded later in the name as a leading code', () => {
    const g = group([{ fundName: 'Gift to 40085 General', cents: 100 }]);
    expect(g[0].code).toBe(null);
  });
});

describe('Church Report giving reference (the view in the report)', () => {
  it('shows one combined line per code, with the members hidden behind it', () => {
    const html = ctx.finGivingFundGroupRows(GIVING_BY_FUND);
    // The combined General Fund figure is the one visible 40085 total.
    expect(html).toContain('$236,983.92'); // 212,461.28 + 23,424.64 + 1,098.00
    expect(html).toContain('40085 General Fund <span style="color:var(--warm-gray);">(3 funds)</span>');
    // Its members are present but collapsed, so no detail is lost.
    const memberRows = html.split('class="fin-giv-grp-row"').length - 1;
    expect(memberRows).toBe(3);
    expect(html).toContain('padding:3px 8px 3px 18px;color:var(--warm-gray);">40085 Lent');
  });

  it('renders a single-fund code and an uncoded fund as plain rows', () => {
    const html = ctx.finGivingFundGroupRows(GIVING_BY_FUND);
    expect(html).toContain('<tr><td style="padding:3px 8px 3px 0;">Other</td>');
    expect(html).toContain('<tr><td style="padding:3px 8px 3px 0;">42040 Commercial Property Income</td>');
  });

  it('expanding a group flips the member rows and the chevron', () => {
    const rows = [{ style: { display: 'none' } }, { style: { display: 'none' } }];
    rows.forEach = Array.prototype.forEach.bind(rows);
    const chevron = { innerHTML: '&#9656;' };
    ctx.document.querySelectorAll = (sel) => (sel.includes('data-grp="0"') ? rows : []);
    ctx.__store['fin-giv-grp-chevron-0'] = chevron;
    ctx.finToggleGivingFundGroup(0);
    expect(rows.every((r) => r.style.display === '')).toBe(true);
    expect(chevron.innerHTML).toBe('&#9662;');
    ctx.finToggleGivingFundGroup(0);
    expect(rows.every((r) => r.style.display === 'none')).toBe(true);
    expect(chevron.innerHTML).toBe('&#9656;');
  });
});

describe('the council narrative fund table', () => {
  const FUNDS = [
    { name: '40085 General Fund', actual_cents: 21246128, prior_cents: 20000000, budget_ytd_cents: 22000000, variance_cents: -753872 },
    { name: '40085 Lent', actual_cents: 109800, prior_cents: 90000, budget_ytd_cents: null, variance_cents: null },
    { name: 'Other', actual_cents: 23807, prior_cents: 0, budget_ytd_cents: null, variance_cents: null },
  ];

  it('prints one combined line per code — no expansion exists on paper', () => {
    const html = ctx.boardNarrativeHtml({
      kpis: { given_ytd_cents: 21379735, given_ytd_prior_cents: 20090000, budget_ytd_cents: 22000000, budget_variance_cents: -620265, funds: FUNDS },
      categories: {}, fund_categories: [], funds: FUNDS, year: 2026, prior_year: 2025,
      concentration: { top10_pct: 32 },
      method_mix: [{ key: 'check', pct: 40 }, { key: 'ach', pct: 35 }, { key: 'cash', pct: 5 }],
      households: {}, church_name: 'Timothy Lutheran',
    });
    expect(html).toContain('40085 General Fund');
    expect(html).not.toContain('40085 Lent');
    // Combined YTD and combined prior year, both including Lent.
    expect(html).toContain('$213,559');
    expect(html).toContain('$200,900');
  });
});
